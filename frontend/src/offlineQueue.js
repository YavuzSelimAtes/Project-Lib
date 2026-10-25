// Cevrimdisi yazma kuyrugu (IndexedDB, kutuphanesiz). Yalnizca gunluk okuma/dizi ilerlemesi.
// sw.js ayni veritabanini ('kutuphane-queue'/'q') paylasir.
const DB = 'kutuphane-queue';
const STORE = 'q';
const SYNC_TAG = 'kutuphane-queue';

const QUEUEABLE = /^\/entries\/\d+\/(progress|series-progress|day-logs)$/;
export const isQueueable = (method, path) => (method === 'POST' || method === 'PUT') && QUEUEABLE.test(path);

const idb = () =>
  new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
const tx = (mode, fn) =>
  idb().then(
    (db) =>
      new Promise((res, rej) => {
        const t = db.transaction(STORE, mode);
        const out = fn(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          res(out.result);
        };
        t.onerror = () => rej(t.error);
      }),
  );

const changed = () => window.dispatchEvent(new Event('queue-changed'));
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const queueCount = () => tx('readonly', (s) => s.count()).catch(() => 0);

export async function enqueue(method, path, body) {
  // Gec gonderimde yanlis gune yazmasin: tarih yoksa simdi (yerel) bugunu sabitle
  let b = body;
  if (b && /\/progress$/.test(path) && !b.date) b = { ...b, date: localToday() };
  await tx('readwrite', (s) => s.add({ method, path, body: b, queued_at: Date.now() }));
  changed();
  navigator.serviceWorker?.ready.then((r) => r.sync?.register(SYNC_TAG)).catch(() => {});
}

let flushing = false;
// Sirayla gonder. Ag hatasi/5xx/401: dur, ogeleri koru. Diger 4xx: ogeyi at.
export async function flushQueue() {
  if (flushing || !navigator.onLine) return;
  const run = async () => {
    flushing = true;
    try {
      const items = (await tx('readonly', (s) => s.getAll())).sort((a, b) => a.id - b.id);
      for (const it of items) {
        let res;
        try {
          res = await fetch('/api' + it.path, {
            method: it.method,
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(it.body),
          });
        } catch {
          break;
        }
        if (res.status === 401 || res.status >= 500) break;
        if (!res.ok) console.warn('[kuyruk] kalıcı hata, atlandı', res.status, it.path);
        await tx('readwrite', (s) => s.delete(it.id));
        changed();
        if (res.ok) window.dispatchEvent(new Event('queue-flushed'));
      }
    } catch (e) {
      console.warn('[kuyruk]', e);
    } finally {
      flushing = false;
      changed();
    }
  };
  // Sekmeler/SW arasi cift gonderimi onlemek icin Web Locks (varsa)
  if (navigator.locks) await navigator.locks.request('kutuphane-queue-flush', run);
  else await run();
}
