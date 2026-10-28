// Busca posts novos ou editados na API pública do WordPress de fifty5blue.com.

const API = 'https://www.fifty5blue.com/pt/wp-json/wp/v2/posts';
const USER_AGENT = 'OBOPE-Dashboard/1.0 (painel de audiencia; leitura da API publica)';
const CATEGORIES = { tv: 39, radio: 98 }; // "Audiência TV" e "Audiência de Rádio"
const LABELS = { tv: 'TV', radio: 'Rádio' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(kind, page, perPage) {
  const url =
    `${API}?categories=${CATEGORIES[kind]}&per_page=${perPage}&page=${page}` +
    '&orderby=modified&order=desc&_fields=id,date,modified,title,link,content';
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(60000),
  });
  if (res.status === 400) return { posts: [], totalPages: 0 }; // página além do fim
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${LABELS[kind]} (página ${page})`);
  return { posts: await res.json(), totalPages: +(res.headers.get('x-wp-totalpages') ?? 1) };
}

// Percorre os posts do mais recentemente modificado para o mais antigo e para
// assim que encontra um post já conhecido e inalterado.
async function syncKind(store, kind, { delayMs, onProgress }) {
  const known = store.posts[kind];
  const perPage = Object.keys(known).length ? 10 : 100;
  let added = 0;
  let updated = 0;
  for (let page = 1; ; page++) {
    onProgress?.(`${LABELS[kind]}: página ${page}`);
    const { posts, totalPages } = await fetchPage(kind, page, perPage);
    let reachedKnown = false;
    for (const p of posts) {
      const prev = known[p.id];
      if (prev && prev.modified === p.modified) {
        reachedKnown = true;
        continue;
      }
      prev ? updated++ : added++;
      store.ingest(kind, p);
    }
    if (reachedKnown || !posts.length || page >= totalPages) break;
    await sleep(delayMs);
  }
  return { added, updated };
}

// delayMs: pausa entre requisições. O robots.txt do site pede "Crawl-delay: 10".
export async function sync(store, { delayMs = 10000, onProgress } = {}) {
  const tv = await syncKind(store, 'tv', { delayMs, onProgress });
  await sleep(delayMs);
  const radio = await syncKind(store, 'radio', { delayMs, onProgress });
  return { tv, radio, changed: tv.added + tv.updated + radio.added + radio.updated > 0 };
}
