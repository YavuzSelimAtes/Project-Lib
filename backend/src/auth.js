import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { err, nowIso } from './util.js';

const scrypt = promisify(crypto.scrypt);
export const COOKIE = 'kutuphane_sid';
const SESSION_DAYS = 30;

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
export async function verifyPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(keyHex, 'hex');
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
}
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)').run(sha(token), userId, nowIso(), expires);
  return { token, maxAge: SESSION_DAYS * 86400 };
}
export const destroySession = (db, token) => db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(token));
export function userFromToken(db, token) {
  if (!token) return null;
  return db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1').get(sha(token), nowIso()) || null;
}
export const toUser = (u) => u && ({ id: u.id, username: u.username, display_name: u.display_name, role: u.role, avatar: u.avatar, color: u.color, must_change_pw: !!u.must_change, active: !!u.active, name_changed: !!u.name_changed, created_at: u.created_at });

export function requireUser(req) {
  if (!req.user) throw err(401, 'Giris yapmaniz gerekiyor');
  return req.user;
}
export function requireAdmin(req) {
  requireUser(req);
  if (req.user.role !== 'admin') throw err(403, 'Bu islem icin yonetici yetkisi gerekir');
  return req.user;
}
