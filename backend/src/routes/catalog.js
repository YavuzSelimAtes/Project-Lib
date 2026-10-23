import fs from 'node:fs';
import { requireUser, requireAdmin } from '../auth.js';
import { err, bad, str, int, oneOf, publicUser } from '../util.js';
import { catalogOut, searchLocal, onlineSearch, persistOnline, pickByKey, findExisting, insertCatalog, downloadCover, saveUploadedCover, coverFileFromUrl, normOf } from '../services/catalog.js';
import { bookWorkDescription } from '../services/sources.js';
import { entryOut } from '../services/entries.js';

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
    // Yan etkisiz: veritabanina YAZMAZ. Internet sonuclari id:null + key ile doner.
    const local = searchLocal(db, q, type, 50);
    searchLimit(me.id);
    const online = await onlineSearch(q, type);
    const items = local.map((r) => ({ ...catalogOut(r), key: null }));
    const seen = new Set(local.map((r) => r.id));
    for (const it of online.items) {
      const ex = findExisting(db, it);
      if (ex) {
        if (!seen.has(ex.id)) { seen.add(ex.id); items.push({ ...catalogOut(ex), key: null }); }
        continue;
      }
      items.push({
        id: null, key: it.key, type: it.type, title: it.title, author_or_creator: it.author_or_creator, year: it.year, pages: it.pages,
        description: it.description, cover_url: it.cover_remote, external_id: it.external_id, source: it.source, seasons: it.seasons, created_at: null,
      });
    }
    return {
      items: items.slice(0, limit),
      online: { ok: online.errors.length === 0, errors: online.errors },
      local_count: local.length,
    };
  });

  // Internet sonucunu sec -> kalici katalog kaydi
  app.post('/api/catalog/pick', async (req, reply) => {
    requireUser(req);
    const row = pickByKey(db, (req.body || {}).key);
    if (!row) throw err(404, 'Bu sonucun suresi dolmus, aramayi tekrarlayin');
    reply.code(201);
    return { item: catalogOut(row) };
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
    return { item: catalogOut(row), entries: entries.map((e) => entryOut(db, e, { withCatalog: false })) };
  });

  // ---- admin ----
  app.get('/api/admin/catalog', async (req) => {
    requireAdmin(req);
    const type = oneOf(req.query.type, TYPES, { field: 'type' });
    const q = str(req.query.q, { field: 'q' });
    const limit = Math.min(int(req.query.limit, { min: 1, max: 200, field: 'limit' }) || 50, 200);
    const offset = int(req.query.offset, { min: 0, field: 'offset' }) || 0;
    const use = (id) => db.prepare('SELECT COUNT(*) c FROM entries WHERE catalog_id=?').get(id).c;
    if (q) {
      const all = searchLocal(db, q, type, 10000);
      return { items: all.slice(offset, offset + limit).map((r) => ({ ...catalogOut(r), entry_count: use(r.id) })), total: all.length };
    }
    const where = type ? 'WHERE type=?' : '';
    const args = type ? [type] : [];
    const total = db.prepare(`SELECT COUNT(*) c FROM catalog ${where}`).get(...args).c;
    const rows = db.prepare(`SELECT * FROM catalog ${where} ORDER BY title COLLATE NOCASE LIMIT ? OFFSET ?`).all(...args, limit, offset);
    return { items: rows.map((r) => ({ ...catalogOut(r), entry_count: use(r.id) })), total };
  });

  app.post('/api/admin/catalog', async (req, reply) => {
    requireAdmin(req);
    const { fields, file } = await readBody(req);
    const data = parseCatalogFields(fields);
    const cover_url = (await resolveCover(fields, file)) ?? null;
    if (db.prepare('SELECT 1 FROM catalog WHERE type=? AND norm=?').get(data.type, normOf(data.title, data.author_or_creator))) {
      throw err(409, 'Bu kayit katalogda zaten var');
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
    // Tutarlilik: sayfa sayisi duzeltilirse eski degeri aynen kopyalamis kayitlarin total_pages'i de guncellenir
    // (elle degistirilmis olanlara ve yeni degerin altina dusen current_page'e dokunulmaz).
    if (cur.type === 'book' && next.pages && next.pages !== cur.pages) {
      db.prepare('UPDATE entries SET total_pages=? WHERE catalog_id=? AND (total_pages IS NULL OR total_pages=?) AND current_page<=?').run(next.pages, id, cur.pages ?? -1, next.pages);
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

  app.post('/api/admin/catalog/import', async (req, reply) => {
    requireAdmin(req);
    const b = req.body || {};
    const type = oneOf(b.type, TYPES, { field: 'type', required: true });
    const query = str(b.query, { field: 'query', required: true, min: 2, max: 200 });
    const limit = Math.min(int(b.limit, { min: 1, max: 10, field: 'limit' }) || 1, 10);
    const before = searchLocal(db, query, type, 50);
    const online = await onlineSearch(query, type);
    if (online.errors.length && !online.items.length && !before.length) throw err(502, `Internetten aranamadi (${online.errors.join('; ')})`, undefined, 'UPSTREAM');
    const seen = new Set();
    const items = [];
    for (const r of before) if (items.length < limit && !seen.has(r.id)) { seen.add(r.id); items.push(r); }
    for (const it of online.items) { // sadece ihtiyac duyulan kadari kalici kataloga alinir
      if (items.length >= limit) break;
      const r = persistOnline(db, it);
      if (!seen.has(r.id)) { seen.add(r.id); items.push(r); }
    }
    reply.code(items.length ? 201 : 200);
    return { items: items.map(catalogOut), online: { ok: online.errors.length === 0, errors: online.errors } };
  });
}
