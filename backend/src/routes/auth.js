import { createHash } from 'node:crypto';
import { COOKIE, hashPassword, verifyPassword, createSession, destroySession, toUser, requireUser, requireAdmin } from '../auth.js';
import { err, bad, str, oneOf, nowIso, normalizeDisplayName } from '../util.js';
import { AVATAR_GROUPS, canonAvatar } from '../avatars.js';
import { linkedUsers, pruneLinks, unlinkUser } from '../links.js';

const attempts = new Map(); // anahtar -> {n, reset}
const WINDOW = 5 * 60 * 1000;
const MAX = 10;
const IP_MAX = 40; // ayni IP'den (kullanici adi degistirerek) 5 dk'da en fazla 40 basarisiz deneme
function checkRate(key, ipKey) {
  const now = Date.now();
  for (const [k, max] of [[key, MAX], [ipKey, IP_MAX]]) {
    const a = attempts.get(k);
    if (a && a.reset > now && a.n >= max) throw err(429, 'Cok fazla basarisiz deneme. Birkac dakika sonra tekrar deneyin');
  }
}
function failRate(key) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.reset <= now) attempts.set(key, { n: 1, reset: now + WINDOW });
  else a.n++;
  if (attempts.size > 5000) for (const [k, v] of attempts) if (v.reset <= now) attempts.delete(k);
}

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const PALETTE = ['#f97316', '#10b981', '#6366f1', '#ec4899', '#eab308', '#14b8a6', '#8b5cf6', '#ef4444'];
const EMOJIS = ['🦊', '🐼', '🦉', '🐙', '🦁', '🐸', '🐧', '🦄'];

function parsePassword(v, field = 'password') {
  if (typeof v !== 'string' || v.length < 6) throw bad('Sifre en az 6 karakter olmali', { [field]: 'en az 6 karakter' });
  if (v.length > 200) throw bad('Sifre cok uzun', { [field]: 'cok uzun' });
  return v;
}
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
function parseAvatar(v) {
  const a = str(v, { max: 16, field: 'avatar' });
  if (a && ([...segmenter.segment(a)].length > 3 || /[<>&"'\`]/.test(a))) throw bad('Avatar en fazla 3 karakterlik bir emoji olmali', { avatar: 'gecersiz' });
  return a;
}
// Avatar listedeki emojilerden biri olmali; kullanicinin mevcut (eski) avatari aynen kalabilir
function listedAvatar(v, current = null) {
  const a = parseAvatar(v);
  if (!a) throw bad('Avatar bos olamaz', { avatar: 'zorunlu' });
  if (current && a === current) return current;
  const c = canonAvatar(a);
  if (!c) throw bad('Avatar, listedeki emojilerden biri olmali (GET /api/avatars)', { avatar: 'listede yok' });
  return c;
}
function parseColor(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !COLOR_RE.test(v)) throw bad('Renk #rrggbb bicimde olmali', { color: 'gecersiz renk' });
  return v;
}

export default async function routes(app) {
  const db = app.db;

  app.post('/api/auth/login', async (req, reply) => {
    const b = req.body || {};
    const username = typeof b.username === 'string' ? b.username.trim().toLowerCase() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    if (!username || !password) throw bad('Kullanici adi ve sifre gerekli');
    const key = `${req.ip}|${username}`;
    const ipKey = `ip|${req.ip}`;
    checkRate(key, ipKey);
    const u = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    if (u && !u.active && (await verifyPassword(password, u.password_hash))) throw err(403, 'Bu hesap pasife alinmis, yoneticiyle gorusun');
    const ok = u && u.active ? await verifyPassword(password, u.password_hash) : (await hashPassword(password), false);
    if (!ok) {
      failRate(key);
      failRate(ipKey);
      throw err(401, 'Kullanici adi veya sifre hatali');
    }
    attempts.delete(key);
    const { token, maxAge } = createSession(db, u.id);
    reply.setCookie(COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', maxAge, secure: process.env.COOKIE_SECURE === '1' });
    return { user: toUser(u) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    requireUser(req);
    const t = req.cookies?.[COOKIE];
    if (t) destroySession(db, t);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ user: toUser(requireUser(req)) }));

  // ---- bagli hesaplar ----
  const linkedOut = (u) => ({ id: u.id, display_name: u.display_name, avatar: u.avatar, color: u.color });
  app.get('/api/auth/linked', async (req) => {
    const me = requireUser(req);
    return { accounts: linkedUsers(db, me.id).map(linkedOut) };
  });

  // Sifresiz gecis: yalnizca MEVCUT oturumdaki kullanicinin kendi grubundaki (aktif, admin olmayan) biri
  app.post('/api/auth/switch', async (req, reply) => {
    const me = requireUser(req);
    const id = Number((req.body || {}).user_id);
    if (!Number.isInteger(id) || id <= 0) throw bad('user_id gecersiz', { user_id: 'gecersiz' });
    if (id === me.id) throw bad('Zaten bu hesaptasiniz');
    const target = linkedUsers(db, me.id).find((u) => u.id === id);
    if (!target) throw err(403, 'Bu hesaba gecis yetkiniz yok');
    const old = req.cookies?.[COOKIE];
    const { token, maxAge } = createSession(db, target.id);
    if (old) destroySession(db, old);
    reply.setCookie(COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', maxAge, secure: process.env.COOKIE_SECURE === '1' });
    return { user: toUser(target) };
  });

  app.get('/api/avatars', async (req) => {
    requireUser(req);
    return { groups: AVATAR_GROUPS };
  });

  // Profil: avatar/renk serbest; gorunen ad SADECE BIR KEZ degisir (name_changed)
  app.patch('/api/me/profile', async (req) => {
    const me = requireUser(req);
    const b = req.body || {};
    const has = (k) => b[k] !== undefined;
    if (!has('avatar') && !has('color') && !has('display_name')) throw bad('Degistirilecek bir alan gonderin (avatar, color, display_name)');
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(me.id);
    let { avatar, color, display_name, name_changed } = row;
    if (has('avatar')) avatar = listedAvatar(b.avatar, row.avatar);
    if (has('color')) {
      const c = parseColor(b.color);
      if (!c) throw bad('Renk #rrggbb bicimde olmali', { color: 'zorunlu' });
      color = c.toLowerCase();
    }
    if (has('display_name')) {
      // gonderilen, kayitli adla birebir aynisiysa (eski/duzensiz kayitlar dahil) hak harcanmaz
      const n = b.display_name === row.display_name ? row.display_name : normalizeDisplayName(b.display_name);
      if (n !== row.display_name) {
        if (row.name_changed) throw err(409, 'Gorunen ad bir kez degistirilebilir.');
        display_name = n;
        name_changed = 1;
      }
    }
    db.prepare('UPDATE users SET avatar=?, color=?, display_name=?, name_changed=? WHERE id=?').run(avatar, color, display_name, name_changed, me.id);
    return { user: toUser(db.prepare('SELECT * FROM users WHERE id=?').get(me.id)) };
  });

  app.post('/api/auth/change-password', async (req) => {
    const me = requireUser(req);
    const b = req.body || {};
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(me.id);
    if (typeof b.old_password !== 'string' || !(await verifyPassword(b.old_password, row.password_hash))) {
      throw bad('Mevcut sifre hatali', { old_password: 'hatali' });
    }
    const np = parsePassword(b.new_password, 'new_password');
    db.prepare('UPDATE users SET password_hash=?, must_change=0 WHERE id=?').run(await hashPassword(np), me.id);
    db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(me.id, createHash('sha256').update(req.cookies?.[COOKIE] || '').digest('hex'));
    return { ok: true };
  });

  // ---- admin ----
  app.get('/api/admin/users', async (req) => {
    requireAdmin(req);
    const rows = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM entries e WHERE e.user_id=u.id) AS entry_count
      FROM users u ORDER BY u.id`).all();
    return { users: rows.map((r) => ({ ...toUser(r), entry_count: r.entry_count })) };
  });

  app.post('/api/admin/users', async (req, reply) => {
    requireAdmin(req);
    const b = req.body || {};
    const username = (str(b.username, { field: 'username', required: true, max: 32 }) || '').toLowerCase();
    if (!USERNAME_RE.test(username)) throw bad('Kullanici adi 3-32 karakter, sadece a-z 0-9 . _ - olabilir', { username: 'gecersiz' });
    if (b.display_name === undefined || b.display_name === null || b.display_name === '') throw bad('display_name zorunludur', { display_name: 'zorunlu' });
    const display_name = normalizeDisplayName(b.display_name, { min: 1 });
    const password = parsePassword(b.password);
    const role = oneOf(b.role, ['admin', 'member'], { field: 'role' }) || 'member';
    const n = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    const avatar = b.avatar !== undefined && b.avatar !== null && b.avatar !== '' ? listedAvatar(b.avatar) : EMOJIS[n % EMOJIS.length];
    const color = parseColor(b.color) || PALETTE[n % PALETTE.length];
    if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) throw err(409, 'Bu kullanici adi zaten alinmis', { username: 'alinmis' });
    const info = db.prepare('INSERT INTO users (username,display_name,password_hash,role,avatar,color,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(username, display_name, await hashPassword(password), role, avatar, color, nowIso());
    reply.code(201);
    return { user: toUser(db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid)) };
  });

  app.patch('/api/admin/users/:id', async (req) => {
    const me = requireAdmin(req);
    const id = Number(req.params.id);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!u) throw err(404, 'Kullanici bulunamadi');
    const b = req.body || {};
    const display_name = b.display_name !== undefined && b.display_name !== u.display_name ? normalizeDisplayName(b.display_name, { min: 1 }) : u.display_name;
    const avatar = b.avatar !== undefined && b.avatar !== null && b.avatar !== '' ? listedAvatar(b.avatar, u.avatar) : u.avatar;
    const color = b.color !== undefined ? (parseColor(b.color) || u.color) : u.color;
    const role = b.role !== undefined ? oneOf(b.role, ['admin', 'member'], { field: 'role', required: true }) : u.role;
    if (u.role === 'admin' && role !== 'admin') {
      if (db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get().c <= 1) throw bad('Son yonetici uyeye cevrilemez');
    }
    const nameChanged = b.reset_name_change === true ? 0 : u.name_changed;
    db.prepare('UPDATE users SET display_name=?,avatar=?,color=?,role=?,name_changed=? WHERE id=?').run(display_name, avatar, color, role, nameChanged, id);
    if (role === 'admin') unlinkUser(db, id); // admin hesaplar bagli grupta olamaz
    return { user: toUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)) };
  });

  app.post('/api/admin/users/:id/reset-password', async (req) => {
    requireAdmin(req);
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(id)) throw err(404, 'Kullanici bulunamadi');
    const pw = parsePassword((req.body || {}).password);
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await hashPassword(pw), id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    return { ok: true };
  });

  // Varsayilan: PASIFE ALMA (kayitlar/yorumlar korunur, giris kapanir, ana ekran ve listelerden kalkar).
  // ?hard=1 -> kalici silme (CASCADE).
  app.delete('/api/admin/users/:id', async (req) => {
    const me = requireAdmin(req);
    const id = Number(req.params.id);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!u) throw err(404, 'Kullanici bulunamadi');
    if (id === me.id) throw bad('Kendi hesabinizi silemezsiniz');
    if (u.role === 'admin' && u.active && db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1").get().c <= 1) throw bad('Son yonetici silinemez');
    if (req.query.hard === '1') {
      db.prepare('DELETE FROM users WHERE id=?').run(id);
      pruneLinks(db);
      return { ok: true, deactivated: false };
    }
    db.prepare('UPDATE users SET active=0 WHERE id=?').run(id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    db.prepare('DELETE FROM push_subscriptions WHERE user_id=?').run(id);
    unlinkUser(db, id);
    return { ok: true, deactivated: true };
  });

  // ---- admin: hesap baglantilari ----
  const groupsOut = () => {
    const rows = db.prepare(`SELECT l.group_id, u.id, u.display_name, u.username, u.avatar, u.color FROM account_links l JOIN users u ON u.id=l.user_id ORDER BY l.group_id, u.id`).all();
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.group_id)) m.set(r.group_id, { id: r.group_id, users: [] });
      m.get(r.group_id).users.push({ id: r.id, display_name: r.display_name, username: r.username, avatar: r.avatar, color: r.color });
    }
    return [...m.values()];
  };
  app.get('/api/admin/link-groups', async (req) => {
    requireAdmin(req);
    pruneLinks(db);
    return { groups: groupsOut() };
  });
  app.put('/api/admin/link-groups', async (req) => {
    requireAdmin(req);
    const ids = (req.body || {}).user_ids;
    if (!Array.isArray(ids) || ids.length > 50) throw bad('user_ids dizisi gerekli', { user_ids: 'gecersiz' });
    const uniq = [...new Set(ids.map(Number))];
    if (uniq.some((n) => !Number.isInteger(n) || n <= 0)) throw bad('user_ids gecersiz', { user_ids: 'gecersiz' });
    if (uniq.length < 2) throw bad('En az 2 hesap secin', { user_ids: 'en az 2' });
    const get = db.prepare('SELECT * FROM users WHERE id=?');
    for (const n of uniq) {
      const u = get.get(n);
      if (!u) throw err(404, 'Kullanici bulunamadi');
      if (u.role === 'admin') throw bad('Yonetici hesaplar baglanamaz', { user_ids: 'yonetici' });
      if (!u.active) throw bad('Pasif hesaplar baglanamaz', { user_ids: 'pasif' });
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      const gid = (db.prepare('SELECT COALESCE(MAX(group_id),0)+1 g FROM account_links').get().g);
      const up = db.prepare('INSERT INTO account_links (user_id,group_id) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET group_id=excluded.group_id');
      for (const n of uniq) up.run(n, gid);
      pruneLinks(db); // eski gruplarda tek kisi kalirsa temizlenir
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return { groups: groupsOut() };
  });
  app.delete('/api/admin/link-groups/:id', async (req) => {
    requireAdmin(req);
    const id = Number(req.params.id);
    const r = db.prepare('DELETE FROM account_links WHERE group_id=?').run(id);
    if (!r.changes) throw err(404, 'Grup bulunamadi');
    return { ok: true };
  });

  app.post('/api/admin/users/:id/activate', async (req) => {
    requireAdmin(req);
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(id)) throw err(404, 'Kullanici bulunamadi');
    db.prepare('UPDATE users SET active=1 WHERE id=?').run(id);
    return { user: toUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)) };
  });

  // ---- bildirimler ----
  app.get('/api/notifications', async (req) => {
    const me = requireUser(req);
    const rows = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100').all(me.id);
    const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(me.id).c;
    return {
      notifications: rows.map((r) => ({
        id: r.id, kind: r.kind, title: r.title, body: r.body,
        link: r.link_type ? { type: r.link_type, id: r.link_id } : null,
        is_read: !!r.is_read, created_at: r.created_at,
      })),
      unread,
    };
  });
  app.post('/api/notifications/read', async (req) => {
    const me = requireUser(req);
    const b = req.body || {};
    if (b.all) db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(me.id);
    else if (Array.isArray(b.ids)) {
      const st = db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=? AND id=?');
      for (const id of b.ids.slice(0, 500)) if (Number.isInteger(id)) st.run(me.id, id);
    } else throw bad('ids dizisi veya all:true gonderin');
    return { ok: true };
  });
}
