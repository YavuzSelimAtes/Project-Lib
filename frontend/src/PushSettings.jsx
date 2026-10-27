import { useEffect, useState } from 'react';
import { api } from './api.js';
import { setPushOptOut, pushSupported, isIos, isStandalone, currentSubscription, enablePush, disablePush } from './pushClient.js';

const PREFS = [
  ['own_events', 'Yorum, soru ve talep bildirimleri'],
  ['family_updates', 'Aile güncellemeleri'],
  ['reminders', 'Hatırlatmalar'],
];

export default function PushSettings({ uid }) {
  const [key, setKey] = useState(null); // null: yükleniyor, false: sunucuda kapalı
  const [sub, setSub] = useState(false);
  const [prefs, setPrefs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const k = await api.pushKey();
        if (!alive) return;
        if (!k?.enabled) return setKey(false);
        setKey(k.public_key);
        const [s, p] = await Promise.all([currentSubscription().catch(() => null), api.pushPrefs()]);
        if (!alive) return;
        setSub(!!s);
        setPrefs(p.prefs);
      } catch {
        if (alive) setKey(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!key) return null; // yükleniyor ya da sunucuda push kapalı: bölüm gizli

  const needsInstall = isIos() && !isStandalone();
  const unsupported = !pushSupported();
  const denied = !unsupported && Notification.permission === 'denied';

  const run = async (fn) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (x) {
      setMsg(x.message || 'İşlem başarısız oldu.');
    } finally {
      setBusy(false);
    }
  };
  const turnOn = () => run(async () => { await enablePush(key); setPushOptOut(uid, false); setSub(true); });
  const turnOff = () => run(async () => { await disablePush(); setPushOptOut(uid, true); setSub(false); });
  const toggle = (k) => {
    const before = prefs;
    const next = { ...prefs, [k]: !prefs[k] };
    setPrefs(next);
    api.pushSetPrefs({ [k]: next[k] }).then((r) => setPrefs(r.prefs), () => { setPrefs(before); setMsg('Tercih kaydedilemedi.'); });
  };

  return (
    <div className="field" style={{ marginTop: 16 }} role="group" aria-label="Bildirimler">
      <span>Bildirimler</span>
      {needsInstall ? (
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          iPhone'da bildirim için önce Paylaş → Ana Ekrana Ekle ile kur, sonra uygulamayı ana ekrandan açıp buradan bildirimleri aç.
        </p>
      ) : unsupported ? (
        <p className="small muted" style={{ margin: '4px 0 0' }}>Bu tarayıcı bildirimleri desteklemiyor.</p>
      ) : (
        <>
          <p className="small muted" style={{ margin: '4px 0 6px' }} aria-live="polite">
            {sub ? '✅ Bu cihazda bildirimler açık.' : denied ? '🚫 Bildirim izni engellenmiş; tarayıcı ayarlarından izin ver.' : 'Bu cihazda bildirimler kapalı.'}
          </p>
          <div className="row">
            {sub ? (
              <button type="button" className="btn small ghost" disabled={busy} onClick={turnOff}>
                Bu cihazda kapat
              </button>
            ) : (
              <button type="button" className="btn small" disabled={busy || denied} onClick={turnOn}>
                Bu cihazda bildirimleri aç
              </button>
            )}
          </div>
          {sub && prefs && (
            <div style={{ marginTop: 8 }}>
              {PREFS.map(([k, label]) => (
                <label key={k} className="small" style={{ display: 'block', margin: '4px 0' }}>
                  <input type="checkbox" checked={!!prefs[k]} onChange={() => toggle(k)} /> {label}
                </label>
              ))}
            </div>
          )}
        </>
      )}
      {msg && (
        <p className="small" style={{ color: 'var(--danger)', margin: '6px 0 0' }} role="alert">
          {msg}
        </p>
      )}
    </div>
  );
}
