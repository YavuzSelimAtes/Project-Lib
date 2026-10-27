import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { COVERS_DIR } from '../db.js';
import { nowIso, addDays, todayStr } from '../util.js';
import { norm, searchOnline, fetchMovieRuntimes, TIMEOUT } from './sources.js';
import { insertEdition, mergeCatalogLanguages } from './editions.js';
import { ensureSeasons } from './seasons.js';

const MAX_COVER = 5 * 1024 * 1024;

export const catalogOut = (r) => r && ({
  id: r.id, type: r.type, title: r.title, author_or_creator: r.author_or_creator, year: r.year, pages: r.pages,
  description: r.description, cover_url: r.cover_url, external_id: r.external_id, source: r.source, seasons: r.seasons,
  runtime: r.runtime ?? null, genre: r.genre ?? null, created_at: r.created_at, listed: !!r.listed, wrong: !!r.wrong,
});
export const normOf = (title, author) => norm(`${title} ${author || ''}`);

// ---------- guvenli indirme (SSRF korumali) ----------
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb');
}
async function assertPublicUrl(u) {
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('protokol');
  if (u.port && !['80', '443'].includes(u.port)) throw new Error('port');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('ozel adres');
    return;
  }
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('ozel adres');
}
// En fazla 3 yonlendirme; her adim yeniden dogrulanir. Govde MAX_COVER'i asarsa iptal.
async function safeGetBuffer(url, { maxBytes = MAX_COVER, timeout = Math.max(TIMEOUT, 8000) } = {}) {
  const signal = AbortSignal.timeout(timeout);
  let cur = new URL(url);
  for (let hop = 0; hop <= 3; hop++) {
    await assertPublicUrl(cur);
    const res = await fetch(cur, { signal, redirect: 'manual', headers: { 'User-Agent': 'AileKutuphanesi/1.0' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      cur = new URL(res.headers.get('location'), cur);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length'));
    if (len && len > maxBytes) throw new Error('cok buyuk');
    const chunks = [];
    let total = 0;
    for await (const c of res.body) {
      total += c.length;
      if (total > maxBytes) throw new Error('cok buyuk');
      chunks.push(c);
    }
    return Buffer.concat(chunks);
  }
  throw new Error('cok fazla yonlendirme');
}
// Dosya iceriginden (magic byte) tur: jpg/png/webp. SVG vb. reddedilir.
export function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return '.webp';
  return null;
}

// Uzak kapagi indir -> /api/covers/<dosya>. Basarisizsa null.
export async function downloadCover(url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const buf = await safeGetBuffer(url);
    if (buf.length < 500) return null; // 1x1 yer tutucu
    const ext = sniffImage(buf);
    return ext ? saveCoverBuffer(buf, ext) : null;
  } catch {
    return null;
  }
}
// Yuklenen dosyayi kaydet: icerik dogrulanir (mimetype'a guvenilmez). Gecersizse null.
export function saveUploadedCover(buf) {
  const ext = sniffImage(buf);
  return ext ? saveCoverBuffer(buf, ext) : null;
}
export function saveCoverBuffer(buf, ext) {
  fs.mkdirSync(COVERS_DIR, { recursive: true });
  const name = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 20) + ext;
  const file = path.join(COVERS_DIR, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
  return `/api/covers/${name}`;
}
export function coverFileFromUrl(u) {
  if (!u || !u.startsWith('/api/covers/')) return null;
  return path.join(COVERS_DIR, path.basename(u));
}

// ---------- arka planda kapak yerellestirme ----------
const queue = [];
let running = 0;
function pump(db) {
  while (running < 4 && queue.length) {
    const job = queue.shift();
    running++;
    downloadCover(job.remote)
      .then((local) => {
        if (local) db.prepare('UPDATE catalog SET cover_url=? WHERE id=? AND cover_url=?').run(local, job.id, job.remote);
      })
      .catch(() => {})
      .finally(() => { running--; pump(db); });
  }
}
function queueCover(db, id, remote) {
  queue.push({ id, remote });
  pump(db);
}

export function insertCatalog(db, it) {
  const info = db.prepare(`INSERT INTO catalog (type,title,author_or_creator,year,pages,description,cover_url,external_id,source,seasons,norm,listed,created_at,runtime,languages,edition_count)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    it.type, it.title, it.author_or_creator ?? null, it.year ?? null, it.pages ?? null, it.description ?? null, it.cover_url ?? null,
    it.external_id ?? null, it.source || 'manual', it.seasons ?? null, normOf(it.title, it.author_or_creator), it.listed === 0 ? 0 : 1, nowIso(),
    it.runtime ?? null, (it.languages || []).join(',') || null, it.edition_count ?? null,
  );
  return db.prepare('SELECT * FROM catalog WHERE id=?').get(info.lastInsertRowid);
}
export const markListed = (db, id) => db.prepare('UPDATE catalog SET listed=1 WHERE id=? AND listed=0').run(id);

export function searchLocal(db, q, type, limit, offset = 0, { listedOnly = false } = {}) {
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  const where = ['wrong=0', listedOnly ? 'listed=1' : '1=1'];
  const args = [];
  if (type) { where.push('type=?'); args.push(type); }
  // her kelime: baslik+yazar alaninda VEYA bir baskinin yayinevinde gecmeli
  for (const w of words) {
    where.push("(norm LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM editions ed WHERE ed.catalog_id=catalog.id AND ed.pub_norm LIKE ? ESCAPE '\\'))");
    const p = `%${w.replace(/[\\%_]/g, '\\$&')}%`;
    args.push(p, p);
  }
  const rows = db.prepare(`SELECT * FROM catalog WHERE ${where.join(' AND ')} LIMIT 300`).all(...args);
  const nq = words.join(' ');
  const score = (r) => {
    const t = norm(r.title);
    return (r.listed ? 0 : 4) + (t === nq ? 0 : t.startsWith(nq) ? 1 : t.includes(nq) ? 2 : 3);
  };
  rows.sort((a, b) => score(a) - score(b) || a.title.length - b.title.length);
  return rows.slice(offset, offset + limit);
}

// Arama yan etkisizdir: internet sonuclari sadece bellekte (10 dk) tutulur ve bir 'key' alir.
// Kullanici birini secince (pick / entries catalog_key / admin import) kalici katalog kaydi olusur.
const TTL = 10 * 60 * 1000;
const searchCache = new Map(); // q-anahtari -> {at, items, errors}
const pickCache = new Map(); // key -> {at, item}
const inflight = new Map();

export async function onlineSearch(q, type, opts = {}) {
  const ck = `${type || '*'}|${opts.lang || ''}|${norm(q)}`;
  const hit = searchCache.get(ck);
  if (hit && Date.now() - hit.at < TTL) return hit;
  if (inflight.has(ck)) return inflight.get(ck);
  const p = (async () => {
    const { items, errors } = await searchOnline(q, type, opts);
    const out = items.slice(0, 40).map((it) => {
      const key = crypto.randomBytes(9).toString('base64url');
      pickCache.set(key, { at: Date.now(), item: it });
      return { ...it, key };
    });
    const res = { at: Date.now(), items: out, errors };
    if (!errors.length) searchCache.set(ck, res);
    if (searchCache.size > 300) searchCache.clear();
    if (pickCache.size > 3000) for (const [k, v] of pickCache) if (Date.now() - v.at > TTL) pickCache.delete(k);
    return res;
  })().finally(() => inflight.delete(ck));
  inflight.set(ck, p);
  return p;
}

// Ham internet ogesini kalici kataloga al (varsa mevcut kaydi dondurur). Kapak arka planda yerellestirilir.
// opts.listed=0: onizleme amacli (pick) kayit -> kullanilana kadar aramada/gezmede gorunmez (kullanilinca markListed ile kalici olur)
export function persistOnline(db, it, { listed = 1 } = {}) {
  let row = findExisting(db, it);
  if (row) {
    if (listed) { markListed(db, row.id); row.listed = 1; }
    if (!row.cover_url && it.cover_remote) {
      db.prepare('UPDATE catalog SET cover_url=? WHERE id=?').run(it.cover_remote, row.id);
      row.cover_url = it.cover_remote;
      queueCover(db, row.id, it.cover_remote);
    }
    if (row.runtime == null && it.runtime) { db.prepare('UPDATE catalog SET runtime=? WHERE id=?').run(it.runtime, row.id); row.runtime = it.runtime; }
  } else {
    row = insertCatalog(db, { ...it, cover_url: it.cover_remote || null, listed: listed ? 1 : 0 });
    if (it.cover_remote) queueCover(db, row.id, it.cover_remote);
  }
  if (row.type === 'book') {
    if (it.edition) insertEdition(db, row.id, it.edition); // Google Books cildi = belirli bir baski
    mergeCatalogLanguages(db, row.id, it.languages || [], it.edition_count);
  }
  return row;
}
export function pickByKey(db, key, opts = {}) {
  const e = typeof key === 'string' ? pickCache.get(key) : null;
  if (!e) return null;
  if (Date.now() - e.at > TTL) { pickCache.delete(key); return null; } // 10 dk dolmus
  return persistOnline(db, e.item, opts);
}

// Kullanilmayan (entry/talep baglantisi olmayan) onizleme kayitlari 14 gunde silinir (kapak dosyasi da)
export function cleanupUnlisted(db, days = 14) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const rows = db.prepare("SELECT id, cover_url FROM catalog WHERE listed=0 AND created_at<? AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.catalog_id=catalog.id) AND NOT EXISTS (SELECT 1 FROM requests r WHERE r.resolved_catalog_id=catalog.id)").all(cutoff);
  for (const r of rows) {
    db.prepare('DELETE FROM catalog WHERE id=?').run(r.id);
    const f = coverFileFromUrl(r.cover_url);
    if (f && !db.prepare('SELECT 1 FROM catalog WHERE cover_url=? LIMIT 1').get(r.cover_url)) fs.promises.unlink(f).catch(() => {});
  }
  return rows.length;
}

// Katalog kaydi secildikten/eklendikten sonra eksik bilgileri tamamlar (asla firlatmaz):
//  dizi -> sezon/bolum sayilari; film -> sure (arka planda)
export async function finishPick(db, row) {
  try {
    if (row?.type === 'series') await ensureSeasons(db, row);
    else if (row?.type === 'movie') queueMovieRuntimes(db, [row.id]);
  } catch { /* onemsiz */ }
}

// ---------- film sureleri (Wikidata P2047) arka planda ----------
const RT_RETRY = 7 * 24 * 3600 * 1000;
const rtQueue = new Set();
let rtRunning = false;
export function queueMovieRuntimes(db, ids) {
  for (const id of ids) {
    try {
      const r = db.prepare('SELECT id,type,runtime,source,external_id,runtime_checked FROM catalog WHERE id=?').get(id);
      if (r && r.type === 'movie' && r.runtime == null && r.source === 'wikipedia' && /^Q\d+$/.test(r.external_id || '') && (!r.runtime_checked || Date.now() - r.runtime_checked > RT_RETRY)) rtQueue.add(id);
    } catch { return; }
  }
  if (rtQueue.size && !rtRunning) runRuntimeQueue(db);
}
async function runRuntimeQueue(db) {
  rtRunning = true;
  try {
    while (rtQueue.size) {
      const ids = [...rtQueue].slice(0, 25);
      for (const id of ids) rtQueue.delete(id);
      const rows = ids.map((id) => db.prepare('SELECT id, external_id FROM catalog WHERE id=?').get(id)).filter(Boolean);
      try {
        const m = await fetchMovieRuntimes(rows.map((r) => r.external_id));
        for (const r of rows) db.prepare('UPDATE catalog SET runtime=?, runtime_checked=? WHERE id=?').run(m.get(r.external_id) ?? null, Date.now(), r.id);
      } catch {
        // gecici hata: 30 dk sonra tekrar denenebilsin
        for (const r of rows) db.prepare('UPDATE catalog SET runtime_checked=? WHERE id=?').run(Date.now() - RT_RETRY + 30 * 60 * 1000, r.id);
      }
    }
  } catch { /* veritabani kapanmis olabilir */ } finally { rtRunning = false; }
}

export function findExisting(db, it) {
  if (it.external_id) {
    const r = db.prepare('SELECT * FROM catalog WHERE source=? AND external_id=?').get(it.source, it.external_id);
    if (r) return r;
  }
  // ayni tur + ayni baslik + ayni yazar/yonetmen (kaynaklar arasi tekrar onleme)
  const nt = norm(it.title);
  const cands = db.prepare('SELECT * FROM catalog WHERE type=? AND wrong=0 AND norm LIKE ?').all(it.type, `${nt}%`);
  const na = norm(it.author_or_creator || '');
  for (const c of cands) {
    if (norm(c.title) !== nt) continue;
    const ca = norm(c.author_or_creator || '');
    if (it.type === 'book') { if ((!na && !ca) || (na && ca && (na === ca || na.includes(ca) || ca.includes(na) || na.split(' ').pop() === ca.split(' ').pop()))) return c; } // yazari yalniz birinde bos olan kayitlar eslestirilmez
    else if (!it.year || !c.year || it.year === c.year) return c;
  }
  return null;
}

