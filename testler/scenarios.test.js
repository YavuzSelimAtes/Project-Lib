// Ek senaryolar: eszamanlilik, tarih sinirlari, uzun baslik, katalog. node --test testler/scenarios.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { Client, waitForServer, daysAgo } = require('./lib/client');
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'test-admin-123';
const uniq = () => 's' + Math.random().toString(36).slice(2, 8);
let admin;

async function member() {
  const n = uniq();
  const r = await admin.post('/api/admin/users', { username: n, display_name: n, password: 'Deneme123!' });
  assert.ok(r.status < 300, r.text);
  const c = new Client();
  await c.login(n, 'Deneme123!');
  c.id = r.json.user.id;
  return c;
}
async function book(c, pages, extra = {}, title) {
  const cat = await admin.post('/api/admin/catalog', { type: 'book', title: title || 'S-' + uniq(), pages });
  assert.ok(cat.status < 300, cat.text);
  const r = await c.post('/api/entries', { catalog_id: cat.json.item.id, total_pages: pages, ...extra });
  assert.ok(r.status < 300, r.text);
  return r.json.entry;
}

test.before(async () => {
  await waitForServer();
  admin = new Client();
  assert.equal((await admin.login('admin', ADMIN_PW)).status, 200);
});

test('eszamanli 20 progress: sunucu hatasi yok, log toplami = current_page', async () => {
  const c = await member();
  const e = await book(c, 1000, { start_date: daysAgo(2) });
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => c.post(`/api/entries/${e.id}/progress`, { current_page: (i + 1) * 10, confirm: true })));
  assert.ok(rs.every((r) => r.status < 500), rs.map((r) => r.status).join());
  const d = (await c.get(`/api/entries/${e.id}`)).json;
  assert.equal(d.logs.reduce((a, l) => a + l.pages_read, 0), d.entry.current_page, 'log toplami tutarsiz');
});
test('iki kullanici ayni anda ayni katalog ogesine kayit: ikisi de basarili, birbirini etkilemez', async () => {
  const a = await member();
  const b = await member();
  const cat = (await admin.post('/api/admin/catalog', { type: 'book', title: 'S-' + uniq(), pages: 100 })).json.item;
  const [ra, rb] = await Promise.all([a, b].map((c) => c.post('/api/entries', { catalog_id: cat.id, total_pages: 100, start_date: daysAgo(1) })));
  assert.ok(ra.status === 201 && rb.status === 201, ra.status + '/' + rb.status);
  await Promise.all([a.post(`/api/entries/${ra.json.entry.id}/progress`, { current_page: 40 }), b.post(`/api/entries/${rb.json.entry.id}/progress`, { current_page: 70 })]);
  assert.equal((await a.get(`/api/entries/${ra.json.entry.id}`)).json.entry.current_page, 40);
  assert.equal((await b.get(`/api/entries/${rb.json.entry.id}`)).json.entry.current_page, 70);
});
test('ayni kayit icin cift eszamanli ekleme: tek kayit (409)', async () => {
  const c = await member();
  const cat = (await admin.post('/api/admin/catalog', { type: 'book', title: 'S-' + uniq(), pages: 100 })).json.item;
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => c.post('/api/entries', { catalog_id: cat.id, total_pages: 100 })));
  const ok = rs.filter((r) => r.status === 201).length;
  assert.equal(ok, 1, rs.map((r) => r.status).join());
  assert.ok(rs.every((r) => r.status < 500));
});
test('tarih sinirlari: artik yil, yil sonu, dun/bugun, saat dilimi', async () => {
  const c = await member();
  const e = await book(c, 100, { start_date: '2024-12-30' });
  const ok = async (d, p) => c.post(`/api/entries/${e.id}/progress`, { current_page: p, date: d });
  assert.equal((await ok('2024-12-31', 10)).status, 200);
  assert.equal((await ok('2025-01-01', 20)).status, 200);
  const bad = await c.post('/api/entries', { catalog_id: (await admin.post('/api/admin/catalog', { type: 'book', title: 'S-' + uniq(), pages: 10 })).json.item.id, start_date: '2025-02-29' });
  assert.equal(bad.status, 400, '2025-02-29 gecerli kabul edildi');
  const leap = await c.post('/api/entries', { catalog_id: (await admin.post('/api/admin/catalog', { type: 'book', title: 'S-' + uniq(), pages: 10 })).json.item.id, start_date: '2024-02-29' });
  assert.equal(leap.status, 201, '2024-02-29 reddedildi: ' + leap.text);
  const t = await c.post(`/api/entries/${e.id}/progress`, { current_page: 30, date: daysAgo(0) });
  assert.equal(t.status, 200);
  assert.equal(t.json.date, daysAgo(0), 'bugunun tarihi Istanbul gunuyle uyusmuyor: ' + t.json.date);
});
test('uzun baslik: 300 karakter tamam, 301 400; Turkce buyuk/kucuk harf', async () => {
  const ok = await admin.post('/api/admin/catalog', { type: 'book', title: 'Ç'.repeat(300), pages: 10 });
  assert.equal(ok.status, 201, ok.text);
  assert.equal((await admin.post('/api/admin/catalog', { type: 'book', title: 'Ç'.repeat(301), pages: 10 })).status, 400);
  const t = 'ışıkİstanbul' + uniq();
  assert.equal((await admin.post('/api/admin/catalog', { type: 'book', title: t, pages: 10 })).status, 201);
  const c = await member();
  const r = await c.get('/api/catalog/search?q=' + encodeURIComponent(t.toUpperCase()) + '&type=book');
  assert.equal(r.status, 200);
});
test('katalog aramasi: internet hatasinda bile 200, items dizi, online alani var', async () => {
  const c = await member();
  const r = await c.get('/api/catalog/search?q=' + encodeURIComponent('zzqqxx' + uniq()) + '&type=movie');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.items) && r.json.online);
});
test('feed: eszamanli 30 istek hatasiz', async () => {
  const c = await member();
  const rs = await Promise.all(Array.from({ length: 30 }, () => c.get('/api/feed')));
  assert.ok(rs.every((r) => r.status === 200));
});
