// Aile Kutuphanesi service worker: uygulama kabugu onbellegi + cevrimdisi yazma kuyrugu (Background Sync).
// Surum degisince CACHE adini arttir; eski onbellekler activate'te silinir.
const CACHE = 'kutuphane-v4';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/badge-96.png', '/icon-512.png', '/apple-touch-icon.png', '/brand.png', '/favicon-32.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return; // API her zaman agdan

  if (req.mode === 'navigate') {
    // Ag oncelikli; cevrimdisiyken onbellekteki index.html
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put('/', res.clone()));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Build ciktilari (hash'li /assets) ve ikonlar: onbellek oncelikli, yoksa ag + kaydet
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && (url.pathname.startsWith('/assets/') || /\.(png|webmanifest|svg|ico|woff2?)$/.test(url.pathname))) {
            caches.open(CACHE).then((c) => c.put(req, res.clone()));
          }
          return res;
        }),
    ),
  );
});

// ---- Background Sync: kuyruk (IndexedDB) ayni veritabanini sayfayla paylasir ----
const DB = 'kutuphane-queue';
const STORE = 'q';
const idb = () =>
  new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
const tx = (db, mode, fn) =>
  new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out.result);
    t.onerror = () => rej(t.error);
  });

async function flush() {
  const db = await idb();
  const items = await tx(db, 'readonly', (s) => s.getAll());
  for (const it of items.sort((a, b) => a.id - b.id)) {
    let res;
    try {
      res = await fetch('/api' + it.path, {
        method: it.method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(it.body),
      });
    } catch {
      throw new Error('network'); // sirayla dur, sync yeniden denesin
    }
    if (res.status === 401) throw new Error('auth'); // giris yapilinca sayfa tekrar dener
    if (res.ok || (res.status >= 400 && res.status < 500)) {
      if (!res.ok) console.warn('[kuyruk] kalici hata, atlandi', res.status, it.path);
      await tx(db, 'readwrite', (s) => s.delete(it.id));
    } else {
      throw new Error('server'); // 5xx: yeniden dene
    }
  }
}

self.addEventListener('sync', (e) => {
  if (e.tag !== 'kutuphane-queue') return;
  // Kilit: sayfadaki flush ile ayni anda calisip cift gonderimi onler
  const run = () => flush();
  e.waitUntil(navigator.locks ? navigator.locks.request('kutuphane-queue-flush', run) : run());
});

// ---- Web Push ----
self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || 'Aile Kütüphanesi', {
      body: d.body || '',
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      tag: d.tag || undefined,
      data: { url: d.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const w = list.find((c) => c.url.startsWith(self.location.origin));
      if (w) return w.focus().then((c) => (c && 'navigate' in c && c.url !== url ? c.navigate(url) : c));
      return self.clients.openWindow(url);
    }),
  );
});
