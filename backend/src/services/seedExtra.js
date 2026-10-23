// ELLE KURATOR LISTESI: aile arayip bulamadigi kitaplar. Internet kaynaklarinda bulunamayanlar (ya da Turkce baskisi
// eksik kalanlar) acilista kataloga eklenir. Idempotent: her kayit icin meta tablosunda "seed_extra:<anahtar>" bayragi tutulur;
// bir kez eklendikten sonra (admin silse/degistirse bile) bir daha DOKUNULMAZ. Katalogda zaten varsa yeni kayit acilmaz,
// yalnizca eksik baski eklenir.
// ILKE: dogrulanamayan bilgi (sayfa sayisi, yayinevi) UYDURULMAZ, bos (null) birakilir. Kaynaklar her kayitta belirtilmistir.
import { insertCatalog, downloadCover } from './catalog.js';
import { insertEdition } from './editions.js';
import { searchBooksOL, norm } from './sources.js';
import { nowIso } from '../util.js';

const OL_COVER = (olid) => `https://covers.openlibrary.org/b/olid/${olid}-L.jpg?default=false`;

export const EXTRA_BOOKS = [
  {
    // Kaynak: Open Library baski kaydi OL35319565M (Sapiens eseri altinda): Kolektif Kitap, 2015, 412 sayfa, ISBN 9786055029357
    key: 'hayvanlardan-tanrilara',
    title: 'Hayvanlardan Tanrılara',
    author: 'Yuval Noah Harari',
    year: 2015,
    pages: 412,
    description: 'Yuval Noah Harari\'nin “Sapiens: A Brief History of Humankind” adlı kitabının Türkçe baskısı.',
    editions: [{ language: 'tr', publisher: 'Kolektif Kitap', pages: 412, year: 2015, isbn: '9786055029357' }],
    covers: [OL_COVER('OL35319565M'), 'https://covers.openlibrary.org/b/isbn/9786055029357-L.jpg?default=false'],
  },
  {
    // Kaynak: Open Library "Anna Karenina" eseri (OL267096W) baski kaydi OL35383312M: Iş Bankasi Kultur Yayinlari, 2018, 1062 sayfa
    key: 'anna-karenina-is-bankasi',
    title: 'Anna Karenina',
    author: 'Leo Tolstoy',
    source: 'openlibrary',
    external_id: 'OL267096W',
    year: 1878,
    pages: null,
    description: null,
    editions: [{ language: 'tr', publisher: 'Türkiye İş Bankası Kültür Yayınları', pages: 1062, year: 2018 }],
    covers: [OL_COVER('OL35383312M')],
  },
  {
    // Acik kaynaklarda (Open Library, Wikidata; Google Books kotasi dolu) bulunamadi. Yayinevi/sayfa bilinmiyor -> bos.
    key: 'dikkat-kaygan-zemin-kral-sakir',
    title: 'Dikkat Kaygan Zemin',
    author: 'Kral Şakir',
    year: null,
    pages: null,
    description: null,
    editions: [{ language: 'tr' }],
    covers: [],
  },
  {
    key: 'dunyayi-okuyan-cocuk-mert-arik',
    title: 'Dünyayı Okuyan Çocuk',
    author: 'Mert Arık',
    year: null,
    pages: null,
    description: null,
    editions: [{ language: 'tr' }],
    covers: [],
  },
  {
    key: 'hayta-anil-basili',
    title: 'Hayta',
    author: 'Anıl Başılı',
    year: null,
    pages: null,
    description: null,
    editions: [{ language: 'tr' }],
    covers: [],
  },
];

const getMeta = (db, k) => db.prepare('SELECT value FROM meta WHERE key=?').get(k)?.value;
const setMeta = (db, k, v) => db.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)').run(k, v);
// SIKI eslesme: dis kimlik ya da (birebir baslik + yazar soyadi; ikisi de dolu olmali). Yazarsiz ayni adli baska kayit ESLESMEZ.
const find = (db, it) => {
  if (it.external_id) {
    const r = db.prepare('SELECT * FROM catalog WHERE source=? AND external_id=?').get(it.source || 'manual', it.external_id);
    if (r) return r;
  }
  const nt = norm(it.title);
  const sur = norm(it.author).split(' ').pop();
  const rows = db.prepare("SELECT * FROM catalog WHERE type='book' AND norm LIKE ?").all(`${nt}%`);
  return rows.find((c) => norm(c.title) === nt && c.author_or_creator && norm(c.author_or_creator).split(' ').pop() === sur) || null;
};

// 1) Veritabani kismi (senkron, aninda). Donus: { added, touched }
export function seedExtraDb(db) {
  let added = 0;
  let touched = 0;
  for (const it of EXTRA_BOOKS) {
    if (getMeta(db, `seed_extra:${it.key}`)) continue;
    let row = find(db, it);
    if (!row) {
      row = insertCatalog(db, { type: 'book', title: it.title, author_or_creator: it.author, year: it.year, pages: it.pages, description: it.description, source: it.source || 'manual', external_id: it.external_id || null, languages: ['tr'] });
      added++;
    }
    for (const ed of it.editions) insertEdition(db, row.id, { ...ed, source: 'seed', external_id: null });
    setMeta(db, `seed_extra:${it.key}`, nowIso());
    touched++;
  }
  return { added, touched };
}

// 2) Kapaklar (internet, arka plan): kataloga kapagi yoksa bulmaya calisir; basarisizsa 7 gun sonra tekrar dener
export async function seedExtraCovers(db, log = console) {
  for (const it of EXTRA_BOOKS) {
    try {
      const row = find(db, it);
      if (!row || row.cover_url) continue;
      const last = Number(getMeta(db, `seed_extra_cover:${it.key}`) || 0);
      if (last && Date.now() - last < 7 * 24 * 3600 * 1000) continue;
      let local = null;
      for (const url of it.covers) { local = await downloadCover(url); if (local) break; }
      if (!local) { // Open Library aramasi: baslik birebir + yazar soyadi eslesmeli
        const sur = norm(it.author).split(' ').pop();
        const docs = await searchBooksOL(`${it.title} ${it.author}`, 8).catch(() => []);
        const hit = docs.find((d) => norm(d.title) === norm(it.title) && norm(d.author_or_creator || '').includes(sur) && d.cover_remote);
        if (hit) local = await downloadCover(hit.cover_remote);
      }
      setMeta(db, `seed_extra_cover:${it.key}`, String(Date.now()));
      if (local) {
        db.prepare('UPDATE catalog SET cover_url=? WHERE id=? AND cover_url IS NULL').run(local, row.id);
        db.prepare('UPDATE editions SET cover_url=? WHERE catalog_id=? AND cover_url IS NULL AND pages IS NOT NULL').run(local, row.id);
        log.info?.(`seed-extra: kapak baglandi -> ${it.title}`);
      }
    } catch { /* ag yok / veritabani kapali: sorun degil */ }
    await new Promise((r) => setTimeout(r, 400));
  }
}
