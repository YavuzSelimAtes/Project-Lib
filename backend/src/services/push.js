// Web Push (telefon bildirimleri). VAPID anahtari yoksa sessizce kapalidir; hicbir akis bozulmaz.
import webpush from 'web-push';
import { todayStr, addDays, TZ } from '../util.js';
import { streaksOf } from './stats.js';
import { openDays } from './entries.js';

let enabled = false;
export const pushEnabled = () => enabled;
export const publicKey = () => process.env.VAPID_PUBLIC_KEY || null;

export function initPush(log) {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    log?.warn?.('Web Push kapali: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY ayarlanmamis (npx web-push generate-vapid-keys).');
    return false;
  }
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@localhost.invalid', pub, priv);
    enabled = true;
  } catch (e) {
    log?.warn?.(`Web Push kapali: VAPID anahtarlari gecersiz (${e.message})`);
  }
  return enabled;
}

const PREF_COLS = ['own_events', 'family_updates', 'reminders'];
// Tercih satiri yoksa hepsi acik sayilir
export function prefsOf(db, userId) {
  const r = db.prepare('SELECT own_events,family_updates,reminders FROM push_prefs WHERE user_id=?').get(userId);
  return r ? { own_events: !!r.own_events, family_updates: !!r.family_updates, reminders: !!r.reminders } : { own_events: true, family_updates: true, reminders: true };
}
export function savePrefs(db, userId, patch) {
  const cur = prefsOf(db, userId);
  for (const k of PREF_COLS) if (typeof patch[k] === 'boolean') cur[k] = patch[k];
  db.prepare(`INSERT INTO push_prefs (user_id,own_events,family_updates,reminders) VALUES (?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET own_events=excluded.own_events, family_updates=excluded.family_updates, reminders=excluded.reminders`)
    .run(userId, +cur.own_events, +cur.family_updates, +cur.reminders);
  return cur;
}

// Fire-and-forget: await edilmez, hata firlatmaz.
export function sendPush(db, userId, { title, body = '', url = '/', tag = undefined }) {
  if (!enabled) return;
  (async () => {
    const subs = db.prepare('SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=?').all(userId);
    if (!subs.length) return;
    const payload = JSON.stringify({ title, body, url, tag });
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 });
      } catch (e) {
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          try { db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(s.endpoint); } catch { /* onemsiz */ }
        } else console.warn(`[push] gonderilemedi (${e?.statusCode || e?.code || e?.message})`);
      }
    }));
  })().catch(() => {});
}

// notify() kancasi: uygulama ici bildirim ayni anda push olarak da gider (own_events aciksa)
export function pushOwnEvent(db, userId, { title, body }) {
  if (!enabled) return;
  try {
    if (prefsOf(db, userId).own_events) sendPush(db, userId, { title, body: body || '', url: '/', tag: 'own' });
  } catch { /* push asla akisi bozmaz */ }
}

// ---- Aile guncellemeleri ----
const THROTTLE_MS = 2 * 3600 * 1000;
const lastProgress = new Map(); // userId -> son push zamani (bellekte; yeniden baslayinca sifirlanir)

function familyTargets(db, exceptUserId) {
  return db.prepare(`SELECT u.id FROM users u LEFT JOIN push_prefs p ON p.user_id=u.id
    WHERE u.active=1 AND u.id<>? AND COALESCE(p.family_updates,1)=1 AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id=u.id)`).all(exceptUserId);
}
const nameOf = (db, id) => db.prepare('SELECT display_name FROM users WHERE id=?').get(id)?.display_name || 'Biri';
const titleOf = (db, e) => db.prepare('SELECT title FROM catalog WHERE id=?').get(e.catalog_id)?.title || 'bir kayıt';

// Bugun okuma kaydedildi (cagiran yalnizca tarihi bugun olan gercek ilerlemede cagirir)
export function familyProgressPush(db, e, { now = Date.now() } = {}) {
  if (!enabled) return;
  try {
    const last = lastProgress.get(e.user_id) || 0;
    if (now - last < THROTTLE_MS) return;
    const targets = familyTargets(db, e.user_id);
    if (!targets.length) return;
    const total = db.prepare('SELECT COALESCE(SUM(pages_read),0) s FROM reading_logs WHERE user_id=? AND date=?').get(e.user_id, todayStr()).s;
    if (total <= 0) return;
    lastProgress.set(e.user_id, now);
    const body = `${nameOf(db, e.user_id)} bugün toplam ${total} sayfa okudu 📖 (${titleOf(db, e)})`;
    for (const t of targets) sendPush(db, t.id, { title: 'Aile Kütüphanesi', body, url: '/', tag: `progress-${e.user_id}` });
  } catch { /* onemsiz */ }
}

// Kitap / film / dizi bitirildi (throttle yok)
export function familyFinishedPush(db, e) {
  if (!enabled) return;
  try {
    const targets = familyTargets(db, e.user_id);
    if (!targets.length) return;
    const t = titleOf(db, e);
    const who = nameOf(db, e.user_id);
    const body = e.type === 'movie' ? `${who} '${t}' filmini izledi 🎬` : e.type === 'series' ? `${who} '${t}' dizisini bitirdi 🎉` : `${who} '${t}' kitabını bitirdi 🎉`;
    for (const x of targets) sendPush(db, x.id, { title: 'Aile Kütüphanesi', body, url: '/', tag: `finished-${e.id}` });
  } catch { /* onemsiz */ }
}

// ---- Hatirlaticilar ----
export const localHour = (d = new Date()) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(d)) % 24;

const claim = (db, userId, kind, day) => db.prepare('INSERT OR IGNORE INTO push_log (user_id,kind,day) VALUES (?,?,?)').run(userId, kind, day).changes === 1;

// Kontrol turu: hangi kullaniciya hangi hatirlatici gidecek. `send` verilerek test edilebilir.
export function runReminders(db, now = new Date(), { send = sendPush, eveningHour = Number(process.env.REMINDER_HOUR) || 20 } = {}) {
  const today = todayStr(now);
  const hour = localHour(now);
  const users = db.prepare(`SELECT u.id FROM users u LEFT JOIN push_prefs p ON p.user_id=u.id
    WHERE u.active=1 AND COALESCE(p.reminders,1)=1 AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id=u.id)`).all();
  for (const { id } of users) {
    try {
      if (hour >= eveningHour) {
        const reading = db.prepare("SELECT 1 FROM entries WHERE user_id=? AND type='book' AND status='devam'").get(id);
        const readToday = db.prepare('SELECT 1 FROM reading_logs WHERE user_id=? AND date=? AND pages_read>0').get(id, today);
        if (reading && !readToday && claim(db, id, 'evening', today)) {
          const s = streaksOf(db, id, today).current;
          send(db, id, { title: 'Bugün okudun mu? 📚', body: s > 0 ? `${s} günlük serin bozulmasın 🔥` : 'Birkaç sayfa bile olsa bugünü kaydet.', url: '/', tag: 'evening' });
        }
      }
      if (hour >= 10) {
        let n = 0;
        for (const e of db.prepare("SELECT * FROM entries WHERE user_id=? AND type='book' AND status='devam'").all(id)) {
          n += openDays(db, e, today).filter((d) => d.state === 'open' && d.date < today).length;
        }
        if (n > 0 && claim(db, id, 'open_days', today)) {
          send(db, id, { title: 'Doldurulmamış günler', body: `${n} günü doldurmadın, tek dokunuşla tamamla`, url: '/', tag: 'open-days' });
        }
      }
    } catch { /* bir kullanicinin hatasi digerlerini durdurmasin */ }
  }
  db.prepare('DELETE FROM push_log WHERE day<?').run(addDays(today, -7));
}

// Zamanlayici: ~10 dk; testte (NODE_ENV=test) ya da REMINDERS=0 ile calismaz. Donen fonksiyon temizler.
export function startReminders(db, log) {
  if (!enabled || process.env.NODE_ENV === 'test' || process.env.REMINDERS === '0') return () => {};
  const tick = () => { try { runReminders(db); } catch (e) { log?.warn?.(`hatirlatici turu basarisiz: ${e.message}`); } };
  const first = setTimeout(tick, 60 * 1000);
  const iv = setInterval(tick, 10 * 60 * 1000);
  first.unref(); iv.unref();
  return () => { clearTimeout(first); clearInterval(iv); };
}
