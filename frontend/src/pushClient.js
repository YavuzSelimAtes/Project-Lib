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

// Çıkışta: yanlış kullanıcıya bildirim gitmesin
export async function dropPushOnLogout() {
  try {
    if (!pushSupported()) return;
    await Promise.race([disablePush(), new Promise((r) => setTimeout(r, 2500))]);
  } catch {
    /* yoksay */
  }
}
