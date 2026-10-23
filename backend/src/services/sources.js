// Internet katalog kaynaklari (API anahtari gerektirmeyen). Hepsi hata verirse bos dizi + hata mesaji doner.
import { todayStr } from '../util.js';
import { isoOf, ISO2OL } from '../langs.js';
const UA = 'AileKutuphanesi/1.0 (aile ici kucuk uygulama; iletisim: yerel)';
export const TIMEOUT = Number(process.env.FETCH_TIMEOUT_MS) || 6000;

// Google Books anahtarsiz kotasi sik dolar (429): bir kez 429/403 alinca 10 dk boyunca hic denenmez (bos beklemeyi onler)
let gbBlockedUntil = 0;
export const googleAvailable = () => Date.now() >= gbBlockedUntil;
export async function gbJson(url, timeout = TIMEOUT) {
  if (!googleAvailable()) throw new Error('Google Books kotasi dolu (gecici)');
  try {
    return await getJson(url, timeout, false);
  } catch (e) {
    if (/HTTP (429|403)/.test(String(e.message))) gbBlockedUntil = Date.now() + 10 * 60 * 1000;
    throw e;
  }
}

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
  return latinize(String(s || ''))
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
// "Baslik / Yazar", "Baslik - Yazar", "Baslik, Yazar", "Baslik | Yazar" -> {title, author}; digerleri duz sorgu
export function splitQuery(q) {
  const s = String(q || '').trim();
  const parts = s.split(/\s+[/\-–—|]\s+|\s*[/|]\s*|\s*,\s*/).map((x) => x.trim()).filter(Boolean);
  if (parts.length === 2) return { plain: parts.join(' '), title: parts[0], author: parts[1] };
  return { plain: parts.length ? parts.join(' ') : s, title: null, author: null };
}
const uniq = (a) => [...new Set(a)];

// extra: { title, author } verilirse alan bazli arama (title=&author=)
export async function searchBooksOL(q, limit = 10, lang = null, extra = {}) {
  const fields = 'key,title,author_name,first_publish_year,number_of_pages_median,cover_i,edition_count,language,publisher';
  const p = extra.title ? `title=${encodeURIComponent(extra.title)}${extra.author ? `&author=${encodeURIComponent(extra.author)}` : ''}` : `q=${encodeURIComponent(q)}`;
  const j = await getJson(`https://openlibrary.org/search.json?${p}&limit=${limit}&fields=${fields}${lang ? `&language=${lang}` : ''}`);
  return (j.docs || []).filter((d) => d.title).map((d) => {
    const publishers = d.edition_count <= 3 ? (d.publisher || []).slice(0, 3) : []; // cok baskili eserde yayinevi listesi ayirt edici degil
    return {
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
      languages: uniq((d.language || []).map(isoOf).filter(Boolean)),
      edition_count: d.edition_count || null,
      publishers,
      publisher: publishers[0] || null,
    };
  });
}
// extra: { lang:'tr' (langRestrict), intitle, inauthor }
export async function searchBooksGoogle(q, limit = 10, extra = {}) {
  const query = extra.intitle ? `intitle:"${extra.intitle}"${extra.inauthor ? ` inauthor:"${extra.inauthor}"` : ''}` : q;
  const j = await gbJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=${limit}&printType=books${extra.lang ? `&langRestrict=${extra.lang}` : ''}`);
  return (j.items || []).filter((i) => i.volumeInfo?.title).map((i) => gbVolume(i));
}
// Google Books cildi -> katalog ogesi (+ baski bilgisi)
export function gbVolume(i) {
  const v = i.volumeInfo;
  const img = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || null;
  const year = v.publishedDate ? Number(String(v.publishedDate).slice(0, 4)) || null : null;
  const isbn = (v.industryIdentifiers || []).find((x) => x.type === 'ISBN_13')?.identifier || (v.industryIdentifiers || []).find((x) => x.type === 'ISBN_10')?.identifier || null;
  const language = isoOf(v.language);
  const cover = img ? img.replace('http://', 'https://').replace('zoom=1', 'zoom=2') : null;
  return {
    type: 'book',
    title: v.title + (v.subtitle ? `: ${v.subtitle}` : ''),
    author_or_creator: latinize((v.authors || []).slice(0, 2).join(', ')) || null,
    year,
    pages: v.pageCount || null,
    description: clip(stripHtml(v.description)),
    cover_remote: cover,
    external_id: i.id,
    source: 'googlebooks',
    seasons: null,
    languages: language ? [language] : [],
    edition_count: null,
    publishers: v.publisher ? [v.publisher] : [],
    publisher: v.publisher || null,
    edition: { language, publisher: v.publisher || null, pages: v.pageCount || null, year, isbn, cover_url: cover, external_id: i.id, source: 'googlebooks' },
  };
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

// Dizinin gercek sezon/bolum sayilari: TVMaze /shows/:id?embed=episodes
//  - ozel bolumler (number null) haric
//  - bolum, airdate <= bugun ise YAYINLANMIS sayilir; airdate bos ise sadece dizi 'Ended' ise sayilir
//  - sezon suresi: bolum surelerinin ortalamasi (yoksa dizi suresi)
export async function fetchShowSeasons(tvmazeId, timeout = 5000) {
  const j = await getJson(`https://api.tvmaze.com/shows/${encodeURIComponent(tvmazeId)}?embed=episodes`, timeout);
  const eps = j?._embedded?.episodes;
  if (!Array.isArray(eps)) throw new Error('bolum listesi alinamadi');
  const today = todayStr();
  const ended = j.status === 'Ended';
  const showRt = j.averageRuntime || j.runtime || null;
  const by = new Map();
  for (const e of eps) {
    if (e.number == null || e.season == null) continue;
    const s = by.get(e.season) || { season: e.season, episodes: 0, total_episodes: 0, rts: [] };
    s.total_episodes++;
    const published = e.airdate ? e.airdate <= today : ended;
    if (published) {
      s.episodes++;
      if (e.runtime) s.rts.push(e.runtime);
    }
    by.set(e.season, s);
  }
  const seasons = [...by.values()].sort((a, b) => a.season - b.season).map((s) => ({
    season: s.season, episodes: s.episodes, total_episodes: s.total_episodes,
    runtime: s.rts.length ? Math.round(s.rts.reduce((a, b) => a + b, 0) / s.rts.length) : showRt,
  }));
  return { seasons, runtime: showRt, status: j.status || null };
}

// ---------- FILM: Wikidata (+ Wikipedia ozeti) ----------
const WD = 'https://www.wikidata.org/w/api.php';
// P2047 (sure): birim dakika (Q7727), saniye (Q11574) ya da saat (Q25235) olabilir -> dakika
export const MIN_MOVIE_MIN = 20;
export const MAX_MOVIE_MIN = 600;
export function wdRuntimeMinutes(entity) {
  const cl = entity?.claims?.P2047;
  if (!Array.isArray(cl) || !cl.length) return null;
  const c = cl.find((x) => x.rank === 'preferred') || cl.find((x) => x.rank !== 'deprecated') || null;
  const v = c?.mainsnak?.datavalue?.value;
  if (!v) return null;
  const amount = Number(v.amount);
  const unit = String(v.unit || '').split('/').pop();
  const mins = unit === 'Q7727' ? amount : unit === 'Q11574' ? amount / 60 : unit === 'Q25235' ? amount * 60 : null;
  if (mins === null || !Number.isFinite(mins)) return null;
  const r = Math.round(mins);
  // makul aralik: 20-600 dk. Disindakiler (kisa film/klip ya da hatali birim) SUPHELI sayilir -> null (bilinmiyor), uydurulmaz
  return r >= MIN_MOVIE_MIN && r <= MAX_MOVIE_MIN ? r : null;
}
// Wikidata Q numaralarindan film sureleri: Map(id -> dakika|null). Uzak hata -> firlatir.
export async function fetchMovieRuntimes(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25);
    const j = await getJson(`${WD}?action=wbgetentities&ids=${batch.join('|')}&props=claims&format=json&origin=*`);
    for (const id of batch) out.set(id, wdRuntimeMinutes(j.entities?.[id]));
  }
  return out;
}
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
      runtime: wdRuntimeMinutes(e),
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

// Kitap aramasi: Open Library (duz, Turkce, baslik/yazar alanli) + Google Books (kota doluysa atlanir)
async function searchBooksAll(q, lang) {
  const sp = splitQuery(q);
  const olLang = lang ? ISO2OL[lang] || null : null;
  const calls = [];
  if (lang) calls.push(searchBooksOL(sp.plain, 12, olLang));
  else { calls.push(searchBooksOL(sp.plain, 12)); calls.push(searchBooksOL(sp.plain, 8, 'tur')); } // Turkce baskilari olan eserler de gelsin
  if (sp.title) calls.push(searchBooksOL(null, 10, olLang, { title: sp.title, author: sp.author }));
  const res = await Promise.allSettled(calls);
  const items = res.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  const olFailed = res.every((r) => r.status === 'rejected');
  let gbErr = null;
  if (googleAvailable() && (lang || items.length < 5)) {
    const g = [];
    g.push(searchBooksGoogle(sp.plain, 8, { lang: lang || null }));
    if (sp.title) g.push(searchBooksGoogle(null, 8, { lang: lang || null, intitle: sp.title, inauthor: sp.author }));
    if (!lang && items.length < 5) g.push(searchBooksGoogle(sp.plain, 8, { lang: 'tr' }));
    const gr = await Promise.allSettled(g);
    for (const r of gr) if (r.status === 'fulfilled') items.push(...r.value); else gbErr = r.reason;
    if (olFailed && gr.every((r) => r.status === 'rejected')) throw res[0].reason;
  } else if (olFailed) throw res[0].reason;
  if (gbErr && olFailed) throw gbErr;
  return items;
}

// Tek giris: turu ve sorguyu al; {items, errors}. opts.lang: kitaplarda dil filtresi/arama dili (iki harf)
export async function searchOnline(q, type, opts = {}) {
  const lang = opts.lang || null;
  const errors = [];
  const jobs = [];
  const run = (name, fn, t) => jobs.push(fn().then((items) => items, (e) => { errors.push(`${name}: ${e?.name === 'TimeoutError' ? 'zaman asimi' : e?.message || 'hata'}`); return []; }).then((items) => items.map((i) => ({ ...i, type: t }))));
  if (!type || type === 'book') run('openlibrary', () => searchBooksAll(q, lang), 'book');
  if (!type || type === 'series') run('tvmaze', () => searchSeries(q), 'series');
  if (!type || type === 'movie') run('wikidata', () => searchMovies(q), 'movie');
  const all = (await Promise.all(jobs)).flat();
  // Ayni eserin birden cok baskisini tek sonuca indir (tur + sade baslik + yazar soyadi); kapagi/sayfasi olan kalir,
  // dil/yayinevi/baski sayisi bilgileri birlestirilir
  const best = new Map();
  const surname = (a) => norm(a || '').split(' ').pop();
  const score = (x) => (x.cover_remote ? 2 : 0) + (x.pages ? 1 : 0) + (x.description ? 1 : 0);
  for (const it of all) {
    const k = `${it.type}|${norm(it.title)}|${it.type === 'book' ? surname(it.author_or_creator) : it.year || ''}`;
    const cur = best.get(k);
    if (!cur) { best.set(k, it); continue; }
    const keep = score(it) > score(cur) ? it : cur;
    const other = keep === it ? cur : it;
    if (it.type === 'book') {
      keep.languages = uniq([...(keep.languages || []), ...(other.languages || [])]);
      keep.edition_count = Math.max(keep.edition_count || 0, other.edition_count || 0) || null;
      keep.publishers = uniq([...(keep.publishers || []), ...(other.publishers || [])]).slice(0, 3);
      keep.publisher = keep.publisher || other.publisher || keep.publishers[0] || null;
    }
    best.set(k, keep);
  }
  let items = [...best.values()];
  if (lang) items = items.filter((it) => it.type !== 'book' || !it.languages?.length || it.languages.includes(lang));
  // Kitaplari sorgu kelimelerini (baslik+yazar+yayinevi) ne kadar kapsadiklarina gore sirala (kararli sira)
  const words = norm(q).split(' ').filter(Boolean);
  const rel = (it) => {
    const hay = norm(`${it.title} ${it.author_or_creator || ''} ${(it.publishers || []).join(' ')}`);
    return words.filter((w) => hay.includes(w)).length;
  };
  // Baslik/yazar/yayinevinde sorgu kelimelerinin HIC gecmedigi ve tek baskili sonuclar (acik kaynakta bulanik eslesme, orn. 'Kuran-i Kerim') elenir;
  // cok baskili eserler kalir (baska bir baskinin adiyla eslesmis olabilir: 'Hayvanlardan Tanrilara' -> Sapiens)
  const books = items.filter((i) => i.type === 'book').map((it, i) => ({ it, i, r: rel(it) })).filter((x) => x.r > 0 || (x.it.edition_count || 0) > 1).sort((a, b) => b.r - a.r || a.i - b.i).map((x) => x.it);
  items = [...books, ...items.filter((i) => i.type !== 'book')];
  return { items, errors };
}
