import fs from 'node:fs';
import { requireUser, requireAdmin } from '../auth.js';
import { err, bad, str, int, oneOf, publicUser } from '../util.js';
import { markListed, catalogOut, searchLocal, onlineSearch, persistOnline, pickByKey, findExisting, insertCatalog, downloadCover, saveUploadedCover, coverFileFromUrl, normOf, finishPick } from '../services/catalog.js';
import { setGenre, ratingSummary } from '../services/ratings.js';
import { bookWorkDescription } from '../services/sources.js';
import { entryOut } from '../services/entries.js';
import { bookExtras, editionOut, ensureEditions, listEditions, insertEdition, findEdition } from '../services/editions.js';
import { ensureSeasons, seasonInfo } from '../services/seasons.js';
import { validIso } from '../langs.js';

function langParam(v) {
  const s = str(v, { field: 'lang', max: 3 });
  if (!s) return null;
  const l = s.toLowerCase();
  if (!validIso(l)) throw bad('lang iki harfli dil kodu olmali (ornek: tr, en)', { lang: 'gecersiz' });
  return l;
}

const TYPES = ['book', 'movie', 'series'];

// kullanici basina dakikada en fazla 30 internet aramasi
const searchHits = new Map();
function searchLimit(userId) {
  const now = Date.now();
  const arr = (searchHits.get(userId) || []).filter((t) => now - t < 60000);
  if (arr.length >= 30) throw err(429, 'Cok sik arama yaptiniz, bir dakika bekleyin');
  arr.push(now);
  searchHits.set(userId, arr);
}

// JSON veya multipart govdeyi {fields, file} olarak oku
async function readBody(req) {
  if (req.isMultipart && req.isMultipart()) {
    const fields = {};
    let file = null;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const buf = await part.toBuffer();
        if (part.file.truncated) throw bad('Kapak dosyasi cok buyuk (en fazla 5MB)', { cover: 'cok buyuk' });
        if (buf.length) file = { buf, mimetype: part.mimetype };
      } else fields[part.fieldname] = part.value;
    }
    return { fields, file };
  }
  return { fields: req.body || {}, file: null };
}

function parseCatalogFields(f, { partial = false } = {}) {
  const out = {};
  const has = (k) => f[k] !== undefined;
  if (!partial || has('type')) out.type = oneOf(f.type, TYPES, { field: 'type', required: true });
  if (!partial || has('title')) out.title = str(f.title, { field: 'title', required: true, max: 300 });
  if (!partial || has('author_or_creator')) out.author_or_creator = str(f.author_or_creator, { field: 'author_or_creator', max: 300 });
  if (!partial || has('year')) out.year = int(f.year, { field: 'year', min: 0, max: 2200 });
  if (!partial || has('pages')) out.pages = int(f.pages, { field: 'pages', min: 1, max: 20000 });
  if (!partial || has('description')) out.description = str(f.description, { field: 'description', max: 5000 });
  if (!partial || has('seasons')) out.seasons = int(f.seasons, { field: 'seasons', min: 1, max: 100 });
  return out;
}

async function resolveCover(f, file) {
  if (file) {
    const local = saveUploadedCover(file.buf);
    if (!local) throw bad('Kapak gecerli bir jpg, png veya webp dosyasi olmali', { cover: 'gecersiz tur' });
    return local;
  }
  if (f.cover_url) {
    if (typeof f.cover_url !== 'string') throw bad('cover_url metin olmali');
    if (f.cover_url.startsWith('/api/covers/')) return f.cover_url;
    if (!/^https?:\/\//i.test(f.cover_url)) throw bad('cover_url http/https olmali', { cover_url: 'gecersiz' });
    const local = await downloadCover(f.cover_url);
    if (!local) throw bad('Kapak indirilemedi; adresi kontrol edin ya da dosya yukleyin', { cover_url: 'indirilemedi' });
    return local;
  }
  return undefined;
}

export default async function routes(app) {
  const db = app.db;

  app.get('/api/catalog/search', async (req) => {
    const me = requireUser(req);
    const q = str(req.query.q, { field: 'q' }) || '';
    if (q.length < 2) throw bad('Arama icin en az 2 karakter girin', { q: 'en az 2 karakter' });
    const type = oneOf(req.query.type, TYPES, { field: 'type' });
    const limit = Math.min(int(req.query.limit, { min: 1, max: 50, field: 'limit' }) || 20, 50);
    const lang = langParam(req.query.lang);
    // Yan etkisiz: veritabanina YAZMAZ. Internet sonuclari id:null + key ile doner.
    // lang: bilinen dilleri olup lang'i icermeyen kitaplar elenir; dili bilinmeyenler kalir.
    const langOk = (languages) => !lang || !languages.length || languages.includes(lang);
    const bookOut = (r) => ({ ...catalogOut(r), key: null, ...(r.type === 'book' ? bookExtras(db, r) : {}) });
    const local = searchLocal(db, q, type, 50, 0, { listedOnly: true }).map(bookOut).filter((o) => o.type !== 'book' || langOk(o.languages));
    searchLimit(me.id);
    const online = await onlineSearch(q, type, { lang });
    const items = [...local];
    const seen = new Set(local.map((r) => r.id));
    for (const it of online.items) {
      const ex = findExisting(db, it);
      if (ex?.wrong) continue; // admin 'yanlis kitap' dedi
      if (ex) {
        if (!seen.has(ex.id)) {
          const o = bookOut(ex);
          if (ex.type === 'book') {
            o.languages = [...new Set([...o.languages, ...(it.languages || [])])];
            o.editions_count = Math.max(o.editions_count, it.edition_count || 0);
            if (!langOk(o.languages)) continue;
          }
          seen.add(ex.id);
          items.push(o);
        }
        continue;
      }
      items.push({
        id: null, key: it.key, type: it.type, title: it.title, author_or_creator: it.author_or_creator, year: it.year, pages: it.pages,
        description: it.description, cover_url: it.cover_remote, external_id: it.external_id, source: it.source, seasons: it.seasons,
        runtime: it.runtime ?? null, created_at: null,
        ...(it.type === 'book' ? {
          languages: it.languages || [], editions_count: it.edition_count || (it.edition ? 1 : 0),
          publisher: it.publisher || null, publishers: it.publishers || [],
        } : {}),
      });
    }
    return {
      items: items.slice(0, limit),
      online: { ok: online.errors.length === 0, errors: online.errors },
      local_count: local.length,
    };
  });

  // Internet sonucunu sec -> kalici katalog kaydi (dizi ise sezon/bolum bilgisi de cekilir)
  app.post('/api/catalog/pick', async (req, reply) => {
    requireUser(req);
    const row = pickByKey(db, (req.body || {}).key, { listed: 0 }); // onizleme: kullanilana (entry/talep/import) kadar aramada gorunmez
    if (!row) throw err(404, 'Bu sonucun suresi dolmus, aramayi tekrarlayin');
    await finishPick(db, row);
    reply.code(201);
    return { item: catalogOut(db.prepare('SELECT * FROM catalog WHERE id=?').get(row.id)) };
  });

  app.get('/api/catalog/:id', async (req) => {
    requireUser(req);
    let row = db.prepare('SELECT * FROM catalog WHERE id=?').get(Number(req.params.id));
    if (!row) throw err(404, 'Katalog kaydi bulunamadi');
    if (row.type === 'book' && !row.description && row.source === 'openlibrary' && row.external_id) {
      try {
        const d = await bookWorkDescription(row.external_id);
        if (d) { db.prepare('UPDATE catalog SET description=? WHERE id=?').run(d, row.id); row = { ...row, description: d }; }
      } catch { /* aciklama yoksa sorun degil */ }
    }
    const entries = db.prepare('SELECT * FROM entries WHERE catalog_id=? ORDER BY updated_at DESC').all(row.id);
    const editions = row.type === 'book' ? listEditions(db, row.id).editions : [];
    const rs = row.type === 'book' ? ratingSummary(db, row.id, req.user.id) : null;
    return { item: { ...catalogOut(row), editions, ...(rs ? { rating_average: rs.average, rating_count: rs.count } : {}) }, entries: entries.map((e) => entryOut(db, e, { withCatalog: false })), editions };
  });

  // Baskilar: yerelde yoksa/eskiyse Open Library + Google Books'tan doldurulur (7 gun onbellek)
  app.get('/api/catalog/:id/editions', async (req) => {
    const me = requireUser(req);
    const cat = db.prepare('SELECT * FROM catalog WHERE id=?').get(Number(req.params.id));
    if (!cat) throw err(404, 'Katalog kaydi bulunamadi');
    if (cat.type !== 'book') throw bad('Baski bilgisi sadece kitaplar icindir');
    const lang = langParam(req.query.lang);
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const online = await ensureEditions(db, cat, { lang, refresh, beforeFetch: () => searchLimit(me.id) }); // dis istek yapilacaksa dakikada 30 sinirina sayilir
    const list = listEditions(db, cat.id, lang);
    return { catalog_id: cat.id, lang, editions: list.editions, groups: list.groups, languages: list.languages, online: { ok: online.ok, errors: online.errors, fetched: online.fetched } };
  });

  // Dizi sezon/bolum sayilari (lazy-fill: TVMaze)
  app.get('/api/catalog/:id/seasons', async (req) => {
    requireUser(req);
    let cat = db.prepare('SELECT * FROM catalog WHERE id=?').get(Number(req.params.id));
    if (!cat) throw err(404, 'Katalog kaydi bulunamadi');
    if (cat.type !== 'series') throw bad('Sezon bilgisi sadece diziler icindir');
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true'; // zorla TVMaze'den tazele (30 sn'de bir)
    const online = await ensureSeasons(db, cat, refresh ? { force: true, timeout: 8000 } : { timeout: 5000 });
    cat = db.prepare('SELECT * FROM catalog WHERE id=?').get(cat.id);
    const info = seasonInfo(db, cat);
    return {
      catalog_id: cat.id, known: info.known,
      seasons: info.seasons.map((s) => ({ season: s.season, episodes: s.episodes, total_episodes: s.total_episodes, runtime: s.runtime })),
      total_seasons: info.total_seasons, total_episodes: info.total_episodes, runtime: info.runtime,
      online: { ok: online.ok, errors: online.errors },
    };
  });

  // ---- admin ----
  app.get('/api/admin/catalog', async (req) => {
    requireAdmin(req);
    const type = oneOf(req.query.type, TYPES, { field: 'type' });
    const q = str(req.query.q, { field: 'q' });
    const limit = Math.min(int(req.query.limit, { min: 1, max: 200, field: 'limit' }) || 50, 200);
    const offset = int(req.query.offset, { min: 0, field: 'offset' }) || 0;
    const use = (id) => db.prepare('SELECT COUNT(*) c FROM entries WHERE catalog_id=?').get(id).c;
    // varsayilan: yalniz kalici (listed=1) kayitlar; ?unlisted=1 -> kullanilmamis onizleme (pick) kayitlari da (listed alani doner)
    const unlisted = req.query.unlisted === '1';
    const out = (r) => ({ ...catalogOut(r), entry_count: use(r.id), listed: !!r.listed });
    if (q) {
      const all = searchLocal(db, q, type, 10000, 0, { listedOnly: !unlisted });
      return { items: all.slice(offset, offset + limit).map(out), total: all.length };
    }
    const conds = [];
    const args = [];
    if (type) { conds.push('type=?'); args.push(type); }
    if (!unlisted) conds.push('listed=1');
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = db.prepare(`SELECT COUNT(*) c FROM catalog ${where}`).get(...args).c;
    const rows = db.prepare(`SELECT * FROM catalog ${where} ORDER BY title COLLATE NOCASE LIMIT ? OFFSET ?`).all(...args, limit, offset);
    return { items: rows.map(out), total };
  });

  app.post('/api/admin/catalog', async (req, reply) => {
    requireAdmin(req);
    const { fields, file } = await readBody(req);
    const data = parseCatalogFields(fields);
    const cover_url = (await resolveCover(fields, file)) ?? null;
    // 'yanlis' isaretliler cakisma sayilmaz. Listelenmemis onizleme kaydi varsa o, elle girilen bilgiyle kalici hale gelir.
    const same = db.prepare('SELECT * FROM catalog WHERE type=? AND norm=? AND wrong=0').get(data.type, normOf(data.title, data.author_or_creator));
    if (same?.listed) throw err(409, 'Bu kayit katalogda zaten var');
    if (same) {
      const n = { ...same, ...data, cover_url: cover_url ?? same.cover_url };
      db.prepare('UPDATE catalog SET title=?,author_or_creator=?,year=?,pages=?,description=?,cover_url=?,seasons=?,listed=1 WHERE id=?')
        .run(n.title, n.author_or_creator, n.year, n.pages, n.description, n.cover_url, n.seasons, same.id);
      reply.code(201);
      return { item: catalogOut(db.prepare('SELECT * FROM catalog WHERE id=?').get(same.id)) };
    }
    const row = insertCatalog(db, { ...data, cover_url, source: 'manual' });
    reply.code(201);
    return { item: catalogOut(row) };
  });

  app.patch('/api/admin/catalog/:id', async (req) => {
    requireAdmin(req);
    const id = Number(req.params.id);
    const cur = db.prepare('SELECT * FROM catalog WHERE id=?').get(id);
    if (!cur) throw err(404, 'Katalog kaydi bulunamadi');
    const { fields, file } = await readBody(req);
    const data = parseCatalogFields(fields, { partial: true });
    if (data.type && data.type !== cur.type) throw bad('Katalog kaydinin turu degistirilemez; yeni kayit olusturun', { type: 'degistirilemez' });
    const cover = await resolveCover(fields, file);
    const next = { ...cur, ...data, ...(cover !== undefined ? { cover_url: cover } : {}) };
    db.prepare(`UPDATE catalog SET type=?,title=?,author_or_creator=?,year=?,pages=?,description=?,cover_url=?,seasons=?,norm=? WHERE id=?`)
      .run(next.type, next.title, next.author_or_creator, next.year, next.pages, next.description, next.cover_url, next.seasons, normOf(next.title, next.author_or_creator), id);
    if (fields.genre !== undefined && cur.type === 'book') setGenre(db, id, fields.genre);
    markListed(db, id); // admin duzenlediyse kalici
    // Tutarlilik: sayfa sayisi duzeltilirse eski degeri aynen kopyalamis kayitlarin total_pages'i de guncellenir
    // (elle degistirilmis olanlara ve yeni degerin altina dusen current_page'e dokunulmaz).
    if (cur.type === 'book' && next.pages && next.pages !== cur.pages) {
      db.prepare('UPDATE entries SET total_pages=? WHERE catalog_id=? AND edition_id IS NULL AND (total_pages IS NULL OR total_pages=?) AND current_page<=?').run(next.pages, id, cur.pages ?? -1, next.pages);
    }
    return { item: catalogOut(db.prepare('SELECT * FROM catalog WHERE id=?').get(id)) };
  });

  app.delete('/api/admin/catalog/:id', async (req) => {
    requireAdmin(req);
    const id = Number(req.params.id);
    const cur = db.prepare('SELECT * FROM catalog WHERE id=?').get(id);
    if (!cur) throw err(404, 'Katalog kaydi bulunamadi');
    if (db.prepare('SELECT 1 FROM entries WHERE catalog_id=? LIMIT 1').get(id)) throw err(409, 'Bu kayda bagli kullanici girdileri var, silinemez');
    db.prepare('DELETE FROM catalog WHERE id=?').run(id);
    const f = coverFileFromUrl(cur.cover_url);
    if (f && !db.prepare('SELECT 1 FROM catalog WHERE cover_url=? LIMIT 1').get(cur.cover_url)) fs.promises.unlink(f).catch(() => {});
    return { ok: true };
  });

  // Yanlis kitap isareti: kayit aramadan/gezmeden kalkar, elle ekleme ve sonraki otomatik eklemelerde cakisma yaratmaz
  app.post('/api/admin/catalog/:id/wrong', async (req) => {
    requireAdmin(req);
    const id = Number(req.params.id);
    const cur = db.prepare('SELECT * FROM catalog WHERE id=?').get(id);
    if (!cur) throw err(404, 'Katalog kaydi bulunamadi');
    const wrong = (req.body || {}).wrong === false ? 0 : 1;
    db.prepare('UPDATE catalog SET wrong=?, listed=? WHERE id=?').run(wrong, wrong ? 0 : 1, id);
    return { item: catalogOut(db.prepare('SELECT * FROM catalog WHERE id=?').get(id)) };
  });

  app.post('/api/admin/catalog/import', async (req, reply) => {
    requireAdmin(req);
    const b = req.body || {};
    const type = oneOf(b.type, TYPES, { field: 'type', required: true });
    const query = str(b.query, { field: 'query', required: true, min: 2, max: 200 });
    const limit = Math.min(int(b.limit, { min: 1, max: 10, field: 'limit' }) || 1, 10);
    const before = searchLocal(db, query, type, 50, 0, { listedOnly: true });
    const online = await onlineSearch(query, type);
    if (online.errors.length && !online.items.length && !before.length) throw err(502, `Internetten aranamadi (${online.errors.join('; ')})`, undefined, 'UPSTREAM');
    const seen = new Set();
    const items = [];
    for (const r of before) if (items.length < limit && !seen.has(r.id)) { seen.add(r.id); items.push(r); }
    for (const it of online.items) { // sadece ihtiyac duyulan kadari kalici kataloga alinir
      if (items.length >= limit) break;
      if (findExisting(db, it)?.wrong) continue; // yanlis isaretli kayit bir daha secilmez
      const r = persistOnline(db, it);
      if (!seen.has(r.id)) { seen.add(r.id); items.push(r); }
    }
    for (const r of items) await finishPick(db, r);
    reply.code(items.length ? 201 : 200);
    const preExisting = new Set(before.map((x) => x.id));
    return { items: items.map((r) => ({ ...catalogOut(db.prepare('SELECT * FROM catalog WHERE id=?').get(r.id)), already_in_catalog: preExisting.has(r.id) })), online: { ok: online.errors.length === 0, errors: online.errors } };
  });

  // ---- admin: baskilar ----
  app.post('/api/admin/catalog/:id/editions', async (req, reply) => {
    requireAdmin(req);
    const cat = db.prepare('SELECT * FROM catalog WHERE id=?').get(Number(req.params.id));
    if (!cat) throw err(404, 'Katalog kaydi bulunamadi');
    if (cat.type !== 'book') throw bad('Baski sadece kitaplara eklenir');
    const b = req.body || {};
    const language = langParam(b.language);
    const publisher = str(b.publisher, { field: 'publisher', max: 120 });
    const pages = int(b.pages, { field: 'pages', min: 1, max: 20000 });
    const year = int(b.year, { field: 'year', min: 1000, max: 2200 });
    const isbn = str(b.isbn, { field: 'isbn', max: 20 });
    if (!language && !publisher && !pages) throw bad('Dil, yayinevi veya sayfa sayisindan en az biri gerekli');
    let cover_url = null;
    if (b.cover_url) cover_url = await resolveCover({ cover_url: b.cover_url }, null);
    const probe = { language, publisher, pages, source: 'manual', external_id: null };
    if (findEdition(db, cat.id, probe)) throw err(409, 'Bu dil, yayinevi ve sayfa sayisiyla bir baski zaten var');
    const { row } = insertEdition(db, cat.id, { language, publisher, pages, year, isbn, cover_url, source: 'manual', external_id: null });
    reply.code(201);
    return { edition: editionOut(row) };
  });

  app.delete('/api/admin/editions/:id', async (req) => {
    requireAdmin(req);
    const id = Number(req.params.id);
    const ed = db.prepare('SELECT * FROM editions WHERE id=?').get(id);
    if (!ed) throw err(404, 'Baski bulunamadi');
    const detached = db.prepare('SELECT COUNT(*) c FROM entries WHERE edition_id=?').get(id).c;
    db.prepare('UPDATE entries SET edition_id=NULL WHERE edition_id=?').run(id);
    db.prepare('DELETE FROM editions WHERE id=?').run(id);
    return { ok: true, detached_entries: detached };
  });
}
