// Armazenamento local: um arquivo JSON por post em data/posts/<tipo>/<id>.json.
// Um arquivo por post mantém o histórico do git pequeno: cada atualização só acrescenta os posts novos.

import fs from 'node:fs';
import path from 'node:path';
import { parseTvPost, parseRadioPost, decode, TV_MARKET_LABELS, RADIO_MARKET_LABELS } from './parse.js';

// Incremente quando o parser mudar: os posts salvos são reprocessados a partir do HTML guardado.
export const PARSER_VERSION = 2;

const PARSERS = { tv: parseTvPost, radio: parseRadioPost };
export const KINDS = Object.keys(PARSERS);

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(value));
  fs.renameSync(file + '.tmp', file);
}

export function openStore(dir) {
  const metaFile = path.join(dir, 'meta.json');
  const postFile = (kind, id) => path.join(dir, 'posts', kind, `${id}.json`);
  const posts = Object.fromEntries(KINDS.map((k) => [k, {}]));

  const save = (kind, id) => writeJson(postFile(kind, id), posts[kind][id]);

  // Migra o formato antigo (um único data/db.json) para um arquivo por post.
  const legacy = path.join(dir, 'db.json');
  if (fs.existsSync(legacy)) {
    const db = readJson(legacy, { posts: {} });
    for (const kind of KINDS) for (const [id, p] of Object.entries(db.posts?.[kind] ?? {})) writeJson(postFile(kind, id), p);
    writeJson(metaFile, { parserVersion: db.meta?.parserVersion });
    fs.unlinkSync(legacy);
  }

  for (const kind of KINDS) {
    const folder = path.join(dir, 'posts', kind);
    for (const name of fs.existsSync(folder) ? fs.readdirSync(folder) : []) {
      if (name.endsWith('.json')) posts[kind][name.slice(0, -5)] = readJson(path.join(folder, name), null);
    }
  }

  const meta = readJson(metaFile, {});
  if (meta.parserVersion !== PARSER_VERSION) {
    for (const kind of KINDS) {
      for (const [id, p] of Object.entries(posts[kind])) {
        if (p?.html == null) continue;
        p.data = PARSERS[kind]({ title: { rendered: p.title }, content: { rendered: p.html } });
        save(kind, id);
      }
    }
    writeJson(metaFile, { ...meta, parserVersion: PARSER_VERSION });
  }

  let payloadCache = null;

  return {
    posts,

    ingest(kind, post) {
      posts[kind][post.id] = {
        modified: post.modified,
        date: post.date,
        title: decode(post.title?.rendered ?? ''),
        link: post.link,
        html: post.content?.rendered ?? '',
        data: PARSERS[kind](post),
      };
      save(kind, post.id);
      payloadCache = null;
    },

    // Muda sempre que um post é incluído ou editado.
    version() {
      return KINDS.map((k) => {
        const list = Object.values(posts[k]).filter(Boolean);
        return `${list.length}:${list.reduce((m, p) => (p.modified > m ? p.modified : m), '')}`;
      }).join('|');
    },

    // Dados que o front-end consome.
    payload() {
      if (payloadCache) return payloadCache;
      // Uma semana pode ter sido publicada duas vezes: fica a versão modificada por último.
      const weeks = new Map();
      for (const [id, p] of Object.entries(posts.tv)) {
        if (!p?.data) continue;
        const prev = weeks.get(p.data.end);
        if (!prev || prev.modified < p.modified) {
          weeks.set(p.data.end, { id: +id, modified: p.modified, published: p.date, link: p.link, ...p.data });
        }
      }
      const radio = new Map();
      const radioPosts = Object.values(posts.radio).filter(Boolean).sort((a, b) => a.modified.localeCompare(b.modified));
      for (const p of radioPosts) {
        for (const r of p.data ?? []) radio.set(`${r.market}|${r.start}|${r.end}`, { ...r, published: p.date, link: p.link });
      }
      payloadCache = {
        tv: {
          weeks: [...weeks.values()].sort((a, b) => a.end.localeCompare(b.end)).map(({ modified, ...w }) => w),
          markets: TV_MARKET_LABELS,
        },
        radio: {
          rows: [...radio.values()].sort((a, b) => a.end.localeCompare(b.end) || a.market.localeCompare(b.market)),
          markets: RADIO_MARKET_LABELS,
        },
      };
      return payloadCache;
    },
  };
}
