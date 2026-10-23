import { createHash } from 'node:crypto';
import { COOKIE, hashPassword, verifyPassword, createSession, destroySession, toUser, requireUser, requireAdmin } from '../auth.js';
import { err, bad, str, oneOf, nowIso } from '../util.js';

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
    const display_name = str(b.display_name, { field: 'display_name', required: true, max: 40 });
    const password = parsePassword(b.password);
    const role = oneOf(b.role, ['admin', 'member'], { field: 'role' }) || 'member';
    const n = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    const avatar = parseAvatar(b.avatar) || EMOJIS[n % EMOJIS.length];
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
    const display_name = b.display_name !== undefined ? str(b.display_name, { field: 'display_name', required: true, max: 40 }) : u.display_name;
    const avatar = b.avatar !== undefined ? (parseAvatar(b.avatar) || u.avatar) : u.avatar;
    const color = b.color !== undefined ? (parseColor(b.color) || u.color) : u.color;
    const role = b.role !== undefined ? oneOf(b.role, ['admin', 'member'], { field: 'role', required: true }) : u.role;
    if (u.role === 'admin' && role !== 'admin') {
      if (db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get().c <= 1) throw bad('Son yonetici uyeye cevrilemez');
    }
    db.prepare('UPDATE users SET display_name=?,avatar=?,color=?,role=? WHERE id=?').run(display_name, avatar, color, role, id);
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
      return { ok: true, deactivated: false };
    }
    db.prepare('UPDATE users SET active=0 WHERE id=?').run(id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    return { ok: true, deactivated: true };
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
