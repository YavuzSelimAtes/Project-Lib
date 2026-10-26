// Baskilar (editions): ayni eserin farkli dil/yayinevi/sayfa sayili baskilari
import { nowIso } from '../util.js';
import { norm, getJson, gbJson, gbVolume, googleAvailable, searchBooksOL } from './sources.js';
import { isoOf, langLabel, guessLanguage, NO_LANG_LABEL, validIso } from '../langs.js';

const TTL_MS = 7 * 24 * 3600 * 1000;
const PER_LANG_CAP = 40; // dil basina saklanan en fazla baski (en dolu olanlar once)
const NOLANG_CAP = 10;

// Kaynaklar Turkce yayinevlerini ASCII ("Is Bankasi Kultur Yayinlari") verebiliyor; bilinen sozcukler duzeltilir
const TR_WORDS = {
  bankasi: 'Bankası', kultur: 'Kültür', yayinlari: 'Yayınları', yayinlar: 'Yayınlar', yayinevi: 'Yayınevi', yayincilik: 'Yayıncılık',
  yayin: 'Yayın', turkiye: 'Türkiye', basimevi: 'Basımevi', matbaasi: 'Matbaası', kitabevi: 'Kitabevi', cocuk: 'Çocuk',
  dunya: 'Dünya', ozgur: 'Özgür', iletisim: 'İletişim', sanat: 'Sanat', kirmizi: 'Kırmızı', gunduz: 'Gündüz', ticaret: 'Ticaret',
};
const foldTr = (w) => w.replace(/İ/g, 'i').replace(/I/g, 'i').toLowerCase().replace(/ı/g, 'i').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u');
export function fixTrPublisher(p) {
  if (!p) return p;
  return p.replace(/\bIs Bankasi\b/gi, '\u0130\u015f Bankas\u0131').replace(/\p{L}+/gu, (w) => {
    const fixed = TR_WORDS[foldTr(w)];
    if (!fixed) return w;
    return w === w.toUpperCase() && w.length > 2 ? fixed.toLocaleUpperCase('tr') : fixed;
  });
}

export const editionOut = (r) => r && ({
  id: r.id, catalog_id: r.catalog_id, language: r.language, language_label: langLabel(r.language), publisher: fixTrPublisher(r.publisher),
  pages: r.pages, year: r.year, isbn: r.isbn, cover_url: r.cover_url, source: r.source, language_guessed: !!r.language_guessed,
});
// entry / feed / raf icinde kullanilan kisa ozet
export const editionBrief = (r) => (r ? { id: r.id, language: r.language, publisher: fixTrPublisher(r.publisher), pages: r.pages } : null);
export const getEdition = (db, id) => (id ? db.prepare('SELECT * FROM editions WHERE id=?').get(id) : null);

const cleanPub = (p) => {
  if (typeof p !== 'string') return null;
  const t = fixTrPublisher(p.replace(/\s+/g, ' ').trim().slice(0, 120));
  return t || null;
};
const intOrNull = (v, max = 20000) => (Number.isInteger(v) && v > 0 && v <= max ? v : null);

// Ayni baski (kaynak+dis kimlik) ya da ayni dil+yayinevi+sayfa varsa mevcut kaydi dondurur
export function findEdition(db, catalogId, e) {
  if (e.external_id) {
    const r = db.prepare('SELECT * FROM editions WHERE source=? AND external_id=?').get(e.source, e.external_id);
    if (r) return r;
  }
  const pn = norm(e.publisher || '');
  const rows = db.prepare('SELECT * FROM editions WHERE catalog_id=?').all(catalogId);
  // yayinevi adi birbirini iceriyorsa ("Is Bankasi Kultur Yayinlari" / "Turkiye Is Bankasi Kultur Yayinlari") ayni sayilir
  const samePub = (a) => a === pn || (!!a && !!pn && (a.includes(pn) || pn.includes(a)));
  return rows.find((r) => (r.language || null) === (e.language || null) && (r.pages || null) === (e.pages || null) && samePub(r.pub_norm)) || null;
}

// { language, publisher, pages, year, isbn, cover_url, source, external_id, language_guessed } -> { row, created }
export function insertEdition(db, catalogId, e) {
  const ex = findEdition(db, catalogId, e);
  if (ex) {
    // eksik bilgileri tamamla
    const sets = [];
    const args = [];
    if (!ex.isbn && e.isbn) { sets.push('isbn=?'); args.push(e.isbn); }
    if (!ex.cover_url && e.cover_url) { sets.push('cover_url=?'); args.push(e.cover_url); }
    if (!ex.year && e.year) { sets.push('year=?'); args.push(e.year); }
    if (sets.length) db.prepare(`UPDATE editions SET ${sets.join(',')} WHERE id=?`).run(...args, ex.id);
    return { row: db.prepare('SELECT * FROM editions WHERE id=?').get(ex.id), created: false };
  }
  const publisher = cleanPub(e.publisher);
  const info = db.prepare(`INSERT INTO editions (catalog_id,language,publisher,pub_norm,pages,year,isbn,cover_url,source,external_id,language_guessed,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    catalogId, e.language || null, publisher, norm(publisher || ''), intOrNull(e.pages), e.year || null, e.isbn || null, e.cover_url || null,
    e.source || 'manual', e.external_id || null, e.language_guessed ? 1 : 0, nowIso(),
  );
  mergeCatalogLanguages(db, catalogId, e.language ? [e.language] : []);
  // Gercek baski (yayinevi ya da sayfa) eklenince ayni dilin bos yer tutucu baskisi (yalniz dil) silinir; kayitlari yeni baskiya baglanir
  const newId = Number(info.lastInsertRowid);
  if (publisher || intOrNull(e.pages)) {
    const ph = db.prepare('SELECT id FROM editions WHERE catalog_id=? AND id<>? AND publisher IS NULL AND pages IS NULL AND isbn IS NULL AND COALESCE(language, \'\')=?').all(catalogId, newId, e.language || '');
    for (const p of ph) {
      db.prepare('UPDATE entries SET edition_id=? WHERE edition_id=?').run(newId, p.id);
      db.prepare('DELETE FROM editions WHERE id=?').run(p.id);
    }
  }
  return { row: db.prepare('SELECT * FROM editions WHERE id=?').get(newId), created: true };
}

// catalog.languages (virgullu) + baski dilleri
export function mergeCatalogLanguages(db, catalogId, langs, editionCount = null) {
  const cur = db.prepare('SELECT languages, edition_count FROM catalog WHERE id=?').get(catalogId);
  if (!cur) return;
  const set = new Set((cur.languages || '').split(',').filter(Boolean));
  for (const l of langs || []) if (l) set.add(l);
  const ec = Math.max(cur.edition_count || 0, editionCount || 0) || null;
  const next = [...set].join(',') || null;
  if (next !== (cur.languages || null) || ec !== (cur.edition_count || null)) db.prepare('UPDATE catalog SET languages=?, edition_count=? WHERE id=?').run(next, ec, catalogId);
}

// Arama sonucu icin kitap ozeti: diller, baski sayisi, yayinevleri
export function bookExtras(db, row) {
  const eds = db.prepare('SELECT language, publisher FROM editions WHERE catalog_id=? ORDER BY id').all(row.id);
  const languages = [...new Set([...(row.languages || '').split(',').filter(Boolean), ...eds.map((e) => e.language).filter(Boolean)])];
  const publishers = [...new Set(eds.map((e) => e.publisher).filter(Boolean))].slice(0, 3);
  return {
    languages,
    editions_count: Math.max(eds.length, row.edition_count || 0),
    publisher: publishers[0] || null,
    publishers,
  };
}

const sortEditions = (a, b) => {
  const bare = (x) => !x.publisher && !x.pages; // yer tutucu (yalniz dil) kartlar sona
  if (bare(a) !== bare(b)) return bare(a) ? 1 : -1;
  const s = (x) => (x.language ? 4 : 0) + (x.publisher && x.pages ? 2 : 0) + (x.pages ? 1 : 0);
  return s(b) - s(a) || (b.year || 0) - (a.year || 0) || a.id - b.id;
};

export function listEditions(db, catalogId, lang = null) {
  let rows = db.prepare('SELECT * FROM editions WHERE catalog_id=?').all(catalogId);
  rows.sort(sortEditions);
  const languages = summarizeLanguages(rows);
  const groups = groupEditions(rows.filter((r) => !lang || r.language === lang));
  if (lang) rows = rows.filter((r) => r.language === lang);
  return { editions: rows.map(editionOut), groups, languages };
}
// sira: Turkce, Ingilizce, sonra baski sayisina gore; dili bilinmeyenler en sonda
const LANG_RANK = (l) => (l === null ? 99 : l === 'tr' ? 0 : l === 'en' ? 1 : 2);
function summarizeLanguages(rows) {
  const m = new Map();
  for (const r of rows) m.set(r.language || null, (m.get(r.language || null) || 0) + 1);
  return [...m.entries()].sort((a, b) => LANG_RANK(a[0]) - LANG_RANK(b[0]) || b[1] - a[1]).map(([language, count]) => ({ language, label: language ? langLabel(language) : NO_LANG_LABEL, count }));
}
function groupEditions(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = r.language || null;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(editionOut(r));
  }
  return [...m.entries()].sort((a, b) => LANG_RANK(a[0]) - LANG_RANK(b[0]) || b[1].length - a[1].length)
    .map(([language, editions]) => ({ language, label: language ? langLabel(language) : NO_LANG_LABEL, count: editions.length, editions }));
}

// ---------- internetten doldurma ----------
const fetchedRecently = (db, catalogId, src) => {
  const r = db.prepare('SELECT fetched_at FROM edition_fetches WHERE catalog_id=? AND src=?').get(catalogId, src);
  return !!r && Date.now() - r.fetched_at < TTL_MS;
};
const markFetched = (db, catalogId, src) => db.prepare('INSERT OR REPLACE INTO edition_fetches (catalog_id,src,fetched_at) VALUES (?,?,?)').run(catalogId, src, Date.now());

async function olEditionCandidates(cat) {
  const base = `https://openlibrary.org/works/${encodeURIComponent(cat.external_id)}/editions.json`;
  const first = await getJson(`${base}?limit=200&offset=0`, 12000);
  const entries = [...(first.entries || [])];
  const size = Math.min(Number(first.size) || entries.length, 2000);
  const offsets = [];
  for (let o = 200; o < size; o += 200) offsets.push(o);
  const rest = await Promise.allSettled(offsets.map((o) => getJson(`${base}?limit=200&offset=${o}`, 12000)));
  for (const r of rest) if (r.status === 'fulfilled') entries.push(...(r.value.entries || []));
  const incomplete = rest.some((r) => r.status === 'rejected');
  const cands = [];
  for (const e of entries) {
    const publisher = cleanPub((e.publishers || [])[0]);
    const pages = intOrNull(e.number_of_pages);
    if (!publisher && !pages) continue;
    let language = isoOf((e.languages || [])[0]?.key);
    let guessed = false;
    if (!language) { language = guessLanguage(norm(publisher || '')); guessed = !!language; }
    if (!language && !(publisher && pages)) continue; // dili de yayinevi+sayfasi da eksik olan baski ise yaramaz
    const m = String(e.publish_date || '').match(/\b(1[5-9]\d\d|20\d\d)\b/);
    const cid = Array.isArray(e.covers) ? e.covers.find((c) => c > 0) : null;
    cands.push({
      language, language_guessed: guessed, publisher, pages, year: m ? Number(m[1]) : null,
      isbn: (e.isbn_13 || e.isbn_10 || [])[0] || null,
      cover_url: cid ? `https://covers.openlibrary.org/b/id/${cid}-M.jpg?default=false` : null,
      source: 'openlibrary', external_id: String(e.key || '').replace('/books/', '') || null,
    });
  }
  // ayni dil+yayinevi+sayfa tekrarlarini ele, dil basina en dolu olanlari tut
  const seen = new Map();
  for (const c of cands) {
    const k = `${c.language}|${norm(c.publisher || '')}|${c.pages || ''}`;
    const cur = seen.get(k);
    const sc = (x) => (x.isbn ? 1 : 0) + (x.cover_url ? 1 : 0) + (x.year ? 1 : 0);
    if (!cur || sc(c) > sc(cur)) seen.set(k, c);
  }
  const perLang = new Map();
  const out = [];
  const score = (x) => (x.publisher && x.pages ? 4 : 0) + (x.isbn ? 1 : 0) + (x.cover_url ? 1 : 0) + (x.year ? 1 : 0) + (x.language_guessed ? 0 : 1);
  for (const c of [...seen.values()].sort((a, b) => score(b) - score(a))) {
    const n = perLang.get(c.language) || 0;
    if (n >= (c.language ? PER_LANG_CAP : NOLANG_CAP)) continue;
    perLang.set(c.language, n + 1);
    out.push(c);
  }
  out.incomplete = incomplete;
  return out;
}

// Baslik birebir + yazar soyadi eslesen Open Library eserinin kimligi (yoksa null)
async function findOlWork(cat) {
  const author = (cat.author_or_creator || '').split(',')[0].trim();
  const sur = norm(author).split(' ').pop();
  const docs = await searchBooksOL(null, 8, null, { title: cat.title, author: author || undefined }).catch(() => []);
  const nt = norm(cat.title);
  const hit = docs.find((d) => norm(d.title) === nt && (!sur || norm(d.author_or_creator || '').includes(sur)));
  return hit ? hit.external_id : null;
}

async function gbEditionCandidates(cat, lang) {
  if (!googleAvailable()) throw new Error('Google Books kotasi dolu (gecici)');
  const author = (cat.author_or_creator || '').split(',')[0].trim();
  const title = cat.title.replace(/"/g, '');
  const q = `intitle:"${title}"${author ? ` inauthor:"${author.replace(/"/g, '')}"` : ''}`;
  const j = await gbJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=20&printType=books${lang ? `&langRestrict=${lang}` : ''}`, 8000);
  const sur = norm(author).split(' ').pop();
  const out = [];
  for (const i of j.items || []) {
    if (!i.volumeInfo?.title) continue;
    const v = gbVolume(i);
    if (sur && !norm(v.author_or_creator || '').includes(sur)) continue;
    if (!v.edition.pages && !v.edition.publisher) continue;
    out.push({ ...v.edition, language_guessed: false });
  }
  return out;
}

// Yerelde yoksa/eski ise Open Library + Google Books'tan doldurur. { attempted, ok, errors, fetched }
const lastTry = new Map(); // "katalog:kaynak" -> son deneme zamani (basarisiz da olsa 60 sn icinde tekrar denenmez)
export async function ensureEditions(db, cat, { lang = null, refresh = false, beforeFetch = null } = {}) {
  const errors = new Set();
  let attempted = 0;
  let succeeded = 0;
  let gated = false;
  const exec = async (name, srcKey, fn) => {
    if (!refresh && fetchedRecently(db, cat.id, srcKey)) return;
    const tk = `${cat.id}:${srcKey}`;
    if (!refresh && Date.now() - (lastTry.get(tk) || 0) < 60 * 1000) return;
    if (!gated) { gated = true; beforeFetch?.(); } // istek siniri (429) yalniz gercekten dis istek yapilacaksa
    lastTry.set(tk, Date.now());
    attempted++;
    try {
      const cands = await fn();
      for (const c of cands) insertEdition(db, cat.id, c);
      if (!cands.incomplete) markFetched(db, cat.id, srcKey); // bazi OL sayfalari dustuyse 7 gun onbellege ALINMAZ
      succeeded++;
    } catch (e) {
      const msg = e?.name === 'TimeoutError' ? 'zaman asimi' : e?.message || 'hata';
      if (!/HTTP (429|403)|kotasi/.test(msg)) errors.add(`${name}: ${msg}`); // Google kota hatasi bilinen durum: gosterilmez
    }
  };
  const jobs = [];
  if (cat.source === 'openlibrary' && cat.external_id) jobs.push(exec('openlibrary', 'ol', () => olEditionCandidates(cat)));
  else jobs.push(exec('openlibrary', 'ol', async () => { // OL baglantisi olmayan kayit (elle/Google): ayni baslik+yazarli OL eserini bul
    const id = await findOlWork(cat);
    return id ? olEditionCandidates({ external_id: id }) : [];
  }));
  // Google Books: diller SIRAYLA (kota/429 gorulunce digeri hic denenmez)
  const gbLangs = lang ? [lang] : [null, 'tr'];
  jobs.push((async () => { for (const l of gbLangs) { if (!googleAvailable()) break; await exec('googlebooks', `gb:${l || '*'}`, () => gbEditionCandidates(cat, l)); } })());
  await Promise.all(jobs);
  return { attempted: attempted > 0, ok: attempted === 0 || succeeded > 0, errors: [...errors], fetched: attempted > 0 };
}

export { validIso };
