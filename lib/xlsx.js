// Leitor mínimo de .xlsx (sem dependências): devolve as abas como matrizes de valores.
// Um .xlsx é um zip de XMLs; usamos o diretório central do zip e o zlib do próprio Node.

import fs from 'node:fs';
import zlib from 'node:zlib';
import { decode } from './parse.js';

function unzip(buf) {
  // Fim do diretório central: assinatura 0x06054b50, procurada a partir do final.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('arquivo não é um .xlsx válido');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    files.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return (name) => {
    const f = files.get(name);
    if (!f) return null;
    const start = f.local + 30 + buf.readUInt16LE(f.local + 26) + buf.readUInt16LE(f.local + 28);
    const raw = buf.subarray(start, start + f.size);
    return (f.method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
  };
}

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const texts = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');

function colIndex(ref) {
  let n = 0;
  for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

// Retorna [{ name, rows: [[valor, ...], ...] }] — números como number, textos como string, vazios como null.
export function readXlsx(file) {
  const read = unzip(fs.readFileSync(file));
  const shared = [...(read('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const rels = new Map(
    [...(read('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]),
  );
  const sheets = [];
  for (const m of (read('xl/workbook.xml') ?? '').matchAll(/<sheet\b[^>]*>/g)) {
    const target = rels.get(attr(m[0], 'r:id'));
    if (!target) continue;
    const xml = read(target.startsWith('/') ? target.slice(1) : `xl/${target}`) ?? '';
    const rows = [];
    for (const row of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const r = +attr(row[1], 'r') - 1;
      const cells = (rows[r] = []);
      for (const c of row[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(c[1], 'r');
        const type = attr(c[1], 't');
        const body = c[2] ?? '';
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let value = null;
        if (type === 's') value = shared[+v] ?? null;
        else if (type === 'inlineStr') value = texts(body);
        else if (type === 'str' || type === 'e') value = v != null ? decode(v) : null;
        else if (type === 'b') value = v === '1';
        else if (v != null) value = Number(v);
        cells[colIndex(ref)] = value;
      }
    }
    sheets.push({ name: decode(attr(m[0], 'name') ?? ''), rows: Array.from(rows, (r) => r ?? []) });
  }
  return sheets;
}
