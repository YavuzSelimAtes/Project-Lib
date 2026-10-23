// Internet katalog kaynaklari (API anahtari gerektirmeyen). Hepsi hata verirse bos dizi + hata mesaji doner.
const UA = 'AileKutuphanesi/1.0 (aile ici kucuk uygulama; iletisim: yerel)';
export const TIMEOUT = Number(process.env.FETCH_TIMEOUT_MS) || 6000;

// Nazik kullanim: wikimedia konaklarina istekler arasi en az 300ms (429 almamak icin sirayla gider)
const GAP = { 'www.wikidata.org': 300, 'commons.wikimedia.org': 300 };
const chains = new Map();
function throttle(url) {
  const host = new URL(url).hostname;
  const gap = GAP[host];
  if (!gap) return Promise.resolve();
  const prev = chains.get(host) || Promise.resolve();
  const next = prev.then(() => new Promise((r) => setTimeout(r, gap)));
  chains.set(host, next);
  return next;
}

export async function getJson(url, timeout = TIMEOUT, retry = true) {
  await throttle(url);
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (res.status === 429 && retry) {
    const wait = Math.min(Number(res.headers.get('retry-after')) || 2, Number(process.env.RETRY_AFTER_MAX_S) || 3) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return getJson(url, timeout, false);
  }
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

const stripHtml = (s) => (s ? s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : null);
const clip = (s, n = 1200) => (s && s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

// Turkce karakterleri sadelestirip kucult (arama icin)
export function norm(s) {
  return String(s || '')
    .replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

// Kiril harfli yazar adlarini Latin harflere cevir (aile 'Dostoyevski' arar, 'Достоевский' degil)
const CYR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'c', ш: 's', щ: 'sc', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya' };
export function latinize(s) {
  if (!s || !/[Ѐ-ӿ]/.test(s)) return s;
  return s.replace(/[Ѐ-ӿ]/g, (ch) => {
    const lo = ch.toLowerCase();
    const t = CYR[lo];
    if (t === undefined) return ch;
    return ch === lo ? t : t.charAt(0).toUpperCase() + t.slice(1);
  });
}

// ---------- KITAP: Open Library (+ Google Books yedek) ----------
export async function searchBooksOL(q, limit = 10, lang = null) {
  const fields = 'key,title,author_name,first_publish_year,number_of_pages_median,cover_i,edition_count';
  const j = await getJson(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=${limit}&fields=${fields}${lang ? `&language=${lang}` : ''}`);
  return (j.docs || []).filter((d) => d.title).map((d) => ({
    type: 'book',
    title: d.title,
    author_or_creator: latinize((d.author_name || []).slice(0, 2).join(', ')) || null,
    year: d.first_publish_year || null,
    pages: d.number_of_pages_median || null,
    description: null,
    cover_remote: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg?default=false` : null,
    external_id: d.key.replace('/works/', ''),
    source: 'openlibrary',
    seasons: null,
  }));
}
export async function searchBooksGoogle(q, limit = 10) {
  const j = await getJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=${limit}&printType=books`);
  return (j.items || []).filter((i) => i.volumeInfo?.title).map((i) => {
    const v = i.volumeInfo;
    const img = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || null;
    return {
      type: 'book',
      title: v.title + (v.subtitle ? `: ${v.subtitle}` : ''),
      author_or_creator: latinize((v.authors || []).slice(0, 2).join(', ')) || null,
      year: v.publishedDate ? Number(String(v.publishedDate).slice(0, 4)) || null : null,
      pages: v.pageCount || null,
      description: clip(stripHtml(v.description)),
      cover_remote: img ? img.replace('http://', 'https://').replace('zoom=1', 'zoom=2') : null,
      external_id: i.id,
      source: 'googlebooks',
      seasons: null,
    };
  });
}
export async function bookWorkDescription(externalId) {
  const j = await getJson(`https://openlibrary.org/works/${externalId}.json`, 4000);
  const d = typeof j.description === 'string' ? j.description : j.description?.value;
  return clip(stripHtml(d));
}

// ---------- DIZI: TVMaze ----------
export async function searchSeries(q, limit = 8) {
  const j = await getJson(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`);
  const items = (Array.isArray(j) ? j : []).slice(0, limit).map(({ show: s }) => ({
    type: 'series',
    title: s.name,
    author_or_creator: s.network?.name || s.webChannel?.name || null,
    year: s.premiered ? Number(s.premiered.slice(0, 4)) : null,
    pages: null,
    description: clip(stripHtml(s.summary)),
    cover_remote: s.image?.original || s.image?.medium || null,
    external_id: String(s.id),
    source: 'tvmaze',
    seasons: null,
  }));
  // sezon sayisi (en fazla ilk 5, hata olursa bos birak)
  await Promise.all(items.slice(0, 5).map(async (it) => {
    try {
      const s = await getJson(`https://api.tvmaze.com/shows/${it.external_id}/seasons`, 4000);
      if (Array.isArray(s) && s.length) it.seasons = s.length;
    } catch { /* yoksay */ }
  }));
  return items;
}

// ---------- FILM: Wikidata (+ Wikipedia ozeti) ----------
const WD = 'https://www.wikidata.org/w/api.php';
const FILM_RE = /film|movie|sinema|animasyon|animated/i;
const FILM_CLASSES = new Set(['Q11424', 'Q202866', 'Q24862', 'Q24869', 'Q229390', 'Q20650540', 'Q226730', 'Q93204', 'Q1259759', 'Q116476516']);
async function wdSearch(q, lang, limit) {
  const j = await getJson(`${WD}?action=wbsearchentities&search=${encodeURIComponent(q)}&language=${lang}&uselang=${lang}&type=item&limit=${limit}&format=json&origin=*`);
  return (j.search || []).filter((x) => FILM_RE.test(x.description || ''));
}
export async function searchMovies(q, limit = 8) {
  const [tr, en] = await Promise.allSettled([wdSearch(q, 'tr', 20), wdSearch(q, 'en', 20)]);
  if (tr.status === 'rejected' && en.status === 'rejected') throw tr.reason;
  const ids = [];
  for (const r of [tr, en]) if (r.status === 'fulfilled') for (const x of r.value) if (!ids.includes(x.id)) ids.push(x.id);
  const top = ids.slice(0, 20);
  if (!top.length) return [];
  const j = await getJson(`${WD}?action=wbgetentities&ids=${top.join('|')}&props=labels|descriptions|claims|sitelinks&languages=tr|en&sitefilter=trwiki|enwiki&format=json&origin=*`);
  const isFilm = (e) => (e.claims?.P31 || []).some((c) => FILM_CLASSES.has(c.mainsnak?.datavalue?.value?.id));
  const ents = top.map((id) => j.entities?.[id]).filter((e) => e && isFilm(e)).slice(0, limit);
  // yonetmen etiketleri
  const dirIds = new Set();
  for (const e of ents) for (const c of e.claims?.P57 || []) { const v = c.mainsnak?.datavalue?.value?.id; if (v) dirIds.add(v); }
  const dirNames = {};
  if (dirIds.size) {
    try {
      const d = await getJson(`${WD}?action=wbgetentities&ids=${[...dirIds].slice(0, 40).join('|')}&props=labels&languages=tr|en&format=json&origin=*`);
      for (const [id, v] of Object.entries(d.entities || {})) dirNames[id] = v.labels?.tr?.value || v.labels?.en?.value;
    } catch { /* yoksay */ }
  }
  const items = ents.map((e) => {
    const title = e.labels?.tr?.value || e.labels?.en?.value;
    if (!title) return null;
    const t = e.claims?.P577?.[0]?.mainsnak?.datavalue?.value?.time;
    const year = t ? Number(t.slice(1, 5)) : null;
    const img = e.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    const dirs = (e.claims?.P57 || []).map((c) => dirNames[c.mainsnak?.datavalue?.value?.id]).filter(Boolean).slice(0, 2);
    const wiki = e.sitelinks?.trwiki ? { lang: 'tr', title: e.sitelinks.trwiki.title } : e.sitelinks?.enwiki ? { lang: 'en', title: e.sitelinks.enwiki.title } : null;
    return {
      type: 'movie',
      title,
      author_or_creator: dirs.join(', ') || null,
      year,
      pages: null,
      description: e.descriptions?.tr?.value || e.descriptions?.en?.value || null,
      cover_remote: img ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(img)}?width=500` : null,
      external_id: e.id,
      source: 'wikipedia',
      seasons: null,
      _wiki: wiki,
    };
  }).filter(Boolean);
  // Wikipedia ozeti + (poster yoksa) sayfa gorseli
  await Promise.all(items.slice(0, 6).map(async (it) => {
    if (!it._wiki) return;
    try {
      const s = await getJson(`https://${it._wiki.lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(it._wiki.title.replace(/ /g, '_'))}`, 4000);
      if (s.extract) it.description = clip(s.extract);
      if (!it.cover_remote && s.thumbnail?.source) it.cover_remote = s.thumbnail.source;
    } catch { /* yoksay */ }
  }));
  for (const it of items) delete it._wiki;
  return items;
}

// Tek giris: turu ve sorguyu al; {items, errors}
export async function searchOnline(q, type) {
  const errors = [];
  const jobs = [];
  const run = (name, fn, t) => jobs.push(fn().then((items) => items, (e) => { errors.push(`${name}: ${e?.name === 'TimeoutError' ? 'zaman asimi' : e?.message || 'hata'}`); return []; }).then((items) => items.map((i) => ({ ...i, type: t }))));
  if (!type || type === 'book') {
    run('openlibrary', async () => {
      let items = [];
      let e1;
      try { items = await searchBooksOL(q); } catch (e) { e1 = e; }
      if (items.length < 3) {
        try { items = items.concat(await searchBooksGoogle(q, 6)); } catch { if (e1) throw e1; }
      }
      return items;
    }, 'book');
  }
  if (!type || type === 'series') run('tvmaze', () => searchSeries(q), 'series');
  if (!type || type === 'movie') run('wikidata', () => searchMovies(q), 'movie');
  const all = (await Promise.all(jobs)).flat();
  // Ayni eserin birden cok baskisini tek sonuca indir (tur + sade baslik + yazar soyadi); kapagi/sayfasi olan kalir
  const best = new Map();
  const surname = (a) => norm(a || '').split(' ').pop();
  for (const it of all) {
    const k = `${it.type}|${norm(it.title)}|${it.type === 'book' ? surname(it.author_or_creator) : it.year || ''}`;
    const cur = best.get(k);
    const score = (x) => (x.cover_remote ? 2 : 0) + (x.pages ? 1 : 0) + (x.description ? 1 : 0);
    if (!cur || score(it) > score(cur)) best.set(k, it);
  }
  return { items: [...best.values()], errors };
}
