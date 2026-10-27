import { api } from './api.js';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

const b64ToBytes = (s) => {
  const raw = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

// Kullanıcı jestiyle çağrılmalı (izin penceresi)
export async function enablePush(publicKey) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Bildirim izni verilmedi. Tarayıcı/telefon ayarlarından izin verebilirsin.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  const j = sub.toJSON();
  await api.pushSubscribe({ endpoint: j.endpoint, keys: j.keys });
  return sub;
}

// Bu cihazın aboneliğini sunucudan ve tarayıcıdan kaldırır
export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  try {
    await api.pushUnsubscribe(sub.endpoint);
  } catch {
    /* sunucuya ulaşılamazsa yine de yerelden kaldır */
  }
  await sub.unsubscribe().catch(() => {});
}

// Hesap geçişinden sonra: cihazda aktif abonelik varsa yeni (oturumdaki) kullanıcıya taşır
export async function moveSubscriptionToCurrentUser() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const sub = await Promise.race([currentSubscription(), new Promise((r) => setTimeout(() => r(null), 2500))]);
    if (!sub) return;
    const j = sub.toJSON();
    await api.pushSubscribe({ endpoint: j.endpoint, keys: j.keys });
  } catch {
    /* yoksay */
  }
}

// Çıkışta: yanlış kullanıcıya bildirim gitmesin. Sunucudaki kayıt silinir, tarayıcı aboneliği kalır;
// sonraki girişte (autoEnablePush) yeniden bağlanır, böylece bildirim ayarı çıkış-girişte bozulmaz.
export async function dropPushOnLogout() {
  try {
    if (!pushSupported()) return;
    await Promise.race([
      (async () => {
        const sub = await currentSubscription();
        if (sub) await api.pushUnsubscribe(sub.endpoint);
      })(),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    /* yoksay */
  }
}

// "Bu cihazda kapat" seçimi cihazda kullanıcı başına hatırlanır; varsayılan açık
const optKey = (id) => `push-optout-${id}`;
export function setPushOptOut(userId, off) {
  try { off ? localStorage.setItem(optKey(userId), '1') : localStorage.removeItem(optKey(userId)); } catch { /* yoksay */ }
}
const optedOut = (userId) => { try { return localStorage.getItem(optKey(userId)) === '1'; } catch { return false; } };

// Giriş/açılışta: kullanıcı kapatmadıysa bu cihazı bildirimlere bağlar. İzin penceresi yalnız
// prompt=true (kullanıcı jesti, ör. giriş butonu) ile açılır. Asla fırlatmaz.
export async function autoEnablePush(userId, { prompt = false } = {}) {
  try {
    if (!pushSupported() || optedOut(userId) || (isIos() && !isStandalone())) return;
    const k = await api.pushKey();
    if (!k?.enabled) return;
    if (Notification.permission === 'denied') return;
    if (Notification.permission === 'default' && !prompt) return;
    await enablePush(k.public_key);
  } catch {
    /* izin verilmedi ya da ağ yok: sessizce geç */
  }
}
