import { requireUser } from '../auth.js';
import { bad, nowIso } from '../util.js';
import { pushEnabled, publicKey, prefsOf, savePrefs } from '../services/push.js';

export default async function routes(app) {
  const db = app.db;

  app.get('/api/push/key', async (req) => {
    requireUser(req);
    return pushEnabled() ? { enabled: true, public_key: publicKey() } : { enabled: false, public_key: null };
  });

  app.post('/api/push/subscribe', async (req) => {
    const me = requireUser(req);
    const b = req.body || {};
    const { endpoint } = b;
    const p256dh = b.keys?.p256dh;
    const auth = b.keys?.auth;
    if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 1000) throw bad('endpoint gecersiz', { endpoint: 'gecersiz' });
    if (typeof p256dh !== 'string' || typeof auth !== 'string' || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) throw bad('keys gecersiz', { keys: 'gecersiz' });
    const ua = String(req.headers['user-agent'] || '').slice(0, 200);
    // Ayni cihaz baska kullaniciya aitse sahibi guncellenir
    db.prepare(`INSERT INTO push_subscriptions (user_id,endpoint,p256dh,auth,created_at,user_agent) VALUES (?,?,?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth, user_agent=excluded.user_agent`)
      .run(me.id, endpoint, p256dh, auth, nowIso(), ua);
    return { ok: true };
  });

  app.post('/api/push/unsubscribe', async (req) => {
    const me = requireUser(req);
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== 'string' || !endpoint) throw bad('endpoint gecersiz', { endpoint: 'gecersiz' });
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?').run(endpoint, me.id);
    return { ok: true };
  });

  app.get('/api/push/prefs', async (req) => {
    const me = requireUser(req);
    return { prefs: prefsOf(db, me.id) };
  });

  app.put('/api/push/prefs', async (req) => {
    const me = requireUser(req);
    const b = req.body || {};
    for (const k of ['own_events', 'family_updates', 'reminders']) {
      if (b[k] !== undefined && typeof b[k] !== 'boolean') throw bad(`${k} true/false olmali`, { [k]: 'gecersiz' });
    }
    return { prefs: savePrefs(db, me.id, b) };
  });
}
