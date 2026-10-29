// Ortak yardimcilar: tarih, hata, dogrulama
export class HttpError extends Error {
  constructor(status, message, code, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}
const CODES = { 400: 'VALIDATION', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 429: 'RATE_LIMIT' };
export const err = (status, message, fields, code) => new HttpError(status, message, code || CODES[status] || 'ERROR', fields);
export const bad = (message, fields) => err(400, message, fields);

export const TZ = process.env.TZ_NAME || 'Europe/Istanbul';
const fmts = new Map();
const fmtFor = (tz) => {
  if (!fmts.has(tz)) fmts.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }));
  return fmts.get(tz);
};
// tz verilmezse sunucu saat dilimi (TZ_NAME); kisiye ozel gun icin userToday(db, userId) kullan
export const todayStr = (d = new Date(), tz = TZ) => fmtFor(tz || TZ).format(d);
export const validTz = (tz) => {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return true; } catch { return false; }
};
// Kullanicinin kendi saat dilimine gore bugun (profilde ayarli degilse sunucu saat dilimi)
export const userToday = (db, userId, d = new Date()) => {
  const r = db.prepare('SELECT tz FROM users WHERE id=?').get(userId);
  return todayStr(d, r?.tz);
};

export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().startsWith(s);
const DAY = 86400000;
export const dayNum = (s) => Math.floor(Date.parse(s + 'T00:00:00Z') / DAY);
export const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
export const diffDays = (a, b) => dayNum(b) - dayNum(a); // b - a
export const nowIso = () => new Date().toISOString();

export const round1 = (n) => Math.round(n * 10) / 10;

export function str(v, { min = 0, max = 500, field = 'alan', required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${field} zorunludur`, { [field]: 'zorunlu' });
    return null;
  }
  if (typeof v !== 'string') throw bad(`${field} metin olmali`, { [field]: 'metin olmali' });
  const t = v.trim();
  if (!t && required) throw bad(`${field} zorunludur`, { [field]: 'zorunlu' });
  if (t.length < min) throw bad(`${field} en az ${min} karakter olmali`, { [field]: `en az ${min} karakter` });
  if (t.length > max) throw bad(`${field} en fazla ${max} karakter olabilir`, { [field]: `en fazla ${max} karakter` });
  return t || null;
}
export function int(v, { min = -1e12, max = 1e12, field = 'alan', required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${field} zorunludur`, { [field]: 'zorunlu' });
    return null;
  }
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n)) throw bad(`${field} tam sayi olmali`, { [field]: 'tam sayi olmali' });
  if (n < min || n > max) throw bad(max >= 1e12 ? `${field} en az ${min} olmali` : min <= -1e12 ? `${field} en fazla ${max} olabilir` : `${field} ${min} ile ${max} arasinda olmali`, { [field]: 'aralik disi' });
  return n;
}
export function date(v, { field = 'tarih', required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${field} zorunludur`, { [field]: 'zorunlu' });
    return null;
  }
  if (!isDate(v)) throw bad(`${field} YYYY-AA-GG biciminde olmali`, { [field]: 'gecersiz tarih' });
  return v;
}
export function oneOf(v, list, { field = 'alan', required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${field} zorunludur`, { [field]: 'zorunlu' });
    return null;
  }
  if (!list.includes(v)) throw bad(`${field} su degerlerden biri olmali: ${list.join(', ')}`, { [field]: 'gecersiz deger' });
  return v;
}
// Gorunen ad icin TEK ortak normalize fonksiyonu (profil + admin kullanici ekleme/duzenleme):
// NFC, bosluk benzerleri tek bosluga, trim; kontrol/gorunmez/biçim (zero-width, RTL override, BOM...) karakterler ve < > REDDEDILIR
// (sessizce silinmez). Uzunluk karakter (kod noktasi) olarak min-30.
export function normalizeDisplayName(v, { min = 2, max = 30, field = 'display_name' } = {}) {
  if (typeof v !== 'string') throw bad('Gorunen ad metin olmali', { [field]: 'metin olmali' });
  const s = v.normalize('NFC');
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cs}]/u.test(s.replace(/[\t\n\r]/g, ' '))) throw bad('Gorunen ad gorunmez ya da kontrol karakterleri iceremez', { [field]: 'gecersiz karakter' });
  if (/[<>]/.test(s)) throw bad('Gorunen ad < ve > karakterlerini iceremez', { [field]: 'gecersiz karakter' });
  const t = s.replace(/\s+/gu, ' ').trim();
  const n = [...t].length;
  if (n < min || n > max) throw bad(min > 1 ? `Gorunen ad ${min}-${max} karakter olmali` : `Gorunen ad en fazla ${max} karakter olabilir`, { [field]: `${min}-${max} karakter` });
  return t;
}
export const publicUser =(u) => u && ({ id: u.id, display_name: u.display_name, avatar: u.avatar, color: u.color });
