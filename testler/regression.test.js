// Elestirmen E-24 listesi + onceki H hatalari icin regresyon. node --test testler/regression.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Client, waitForServer, daysAgo } = require('./lib/client');
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'test-admin-123';
const DB = path.join(__dirname, 'data', 'test.db');
const uniq = () => 'r' + Math.random().toString(36).slice(2, 8);
let admin;

async function newMember() {
  const name = uniq();
  const r = await admin.post('/api/admin/users', { username: name, display_name: 'Reg ' + name, password: 'Deneme123!', role: 'member' });
  assert.ok(r.status < 300, r.text);
  const c = new Client();
  assert.equal((await c.login(name, 'Deneme123!')).status, 200);
  c.id = r.json.user.id; c.name = name;
  return c;
}
async function newBook(c, pages, extra = {}) {
  const cat = await admin.post('/api/admin/catalog', { type: 'book', title: 'R-' + uniq(), pages });
  const r = await c.post('/api/entries', { catalog_id: cat.json.item.id, total_pages: pages, ...extra });
  assert.ok(r.status < 300, r.text);
  return r.json.entry;
}
const recordOf = async (c) => (await c.get(`/api/users/${c.id}/stats`)).json.record;
const rows = async (c, k) => (await c.get(`/api/leaderboards/${k}`)).json.entries;

test.before(async () => {
  await waitForServer();
  admin = new Client();
  assert.equal((await admin.login('admin', ADMIN_PW)).status, 200);
});

test('(a) 3 gun atlayip tek guncelleme rekoru sisirmez', async () => {
  const c = await newMember();
  const e = await newBook(c, 300, { start_date: daysAgo(3) });
  const r = await c.post(`/api/entries/${e.id}/progress`, { current_page: 90 });
  assert.equal(r.status, 200);
  assert.ok(r.json.pages_read_on_date < 90, `pages_read_on_date=${r.json.pages_read_on_date}`);
  const rec = await recordOf(c);
  assert.ok(!rec || rec.pages < 90, 'rekor sisti: ' + JSON.stringify(rec));
});
test('(b) planlandi -> ilk ilerleme 300. sayfa rekor olmaz', async () => {
  const c = await newMember();
  const e = await newBook(c, 500, { status: 'planlandi' });
  assert.equal((await c.post(`/api/entries/${e.id}/progress`, { current_page: 300 })).status, 200);
  const rec = await recordOf(c);
  assert.ok(!rec || rec.pages < 300, 'rekor: ' + JSON.stringify(rec));
});
test('(c) bitti isaretiyle 800 sayfa rekora girmez', async () => {
  const c = await newMember();
  const e = await newBook(c, 800, { start_date: daysAgo(10) });
  assert.equal((await c.patch(`/api/entries/${e.id}`, { status: 'bitti' })).status, 200);
  const rec = await recordOf(c);
  assert.ok(!rec || rec.pages < 800, 'rekor: ' + JSON.stringify(rec));
});
test('(d) gecmisten eklenen bitmis kitap ortalamayi bozmaz (E-15)', async () => {
  const c = await newMember();
  await newBook(c, 300, { status: 'bitti', start_date: daysAgo(30), end_date: daysAgo(20) });
  const row = (await rows(c, 'average')).find((x) => x.user.id === c.id);
  assert.ok(row && row.value < 40, 'ortalama: ' + (row && row.value)); // 300/11 = 27.3
});
test('(d2) tarihsiz (bugun) eklenen bitmis kitap 1 gunde 300 sayfa sayilmaz', async () => {
  const c = await newMember();
  await newBook(c, 300, { status: 'bitti' });
  const row = (await rows(c, 'average')).find((x) => x.user.id === c.id);
  assert.ok(!row || row.value < 100, 'ortalama: ' + (row && row.value));
  const rec = await recordOf(c);
  assert.ok(!rec || rec.pages < 300, 'rekor: ' + JSON.stringify(rec));
});
test('(e) bos/gecersiz progress log silmez', async () => {
  const c = await newMember();
  const e = await newBook(c, 200, { start_date: daysAgo(1) });
  await c.post(`/api/entries/${e.id}/progress`, { current_page: 50, date: daysAgo(1) });
  const before = (await c.get(`/api/entries/${e.id}`)).json.logs.length;
  for (const body of [{}, { current_page: '' }, { current_page: null }, { current_page: 'x' }, { current_page: -1 }, { current_page: 1.5 }]) {
    const r = await c.post(`/api/entries/${e.id}/progress`, body);
    assert.equal(r.status, 400, JSON.stringify(body) + ' -> ' + r.status);
  }
  const d = (await c.get(`/api/entries/${e.id}`)).json;
  assert.equal(d.logs.length, before);
  assert.equal(d.entry.current_page, 50);
});
test('(e2) current_page=0 tum gecmisi sessizce silmemeli', async () => {
  const c = await newMember();
  const e = await newBook(c, 200, { start_date: daysAgo(3) });
  for (const [p, d] of [[20, 3], [40, 2], [60, 1]]) await c.post(`/api/entries/${e.id}/progress`, { current_page: p, date: daysAgo(d) });
  const r = await c.post(`/api/entries/${e.id}/progress`, { current_page: 0 });
  const logs = (await c.get(`/api/entries/${e.id}`)).json.logs;
  assert.ok(r.status === 400 || logs.length > 0, `0 gonderildi: ${r.status}, kalan log: ${logs.length}`);
});
test('(e3) geriye gidis gecmis gunlerin log satirlarini silmez', async () => {
  const c = await newMember();
  const e = await newBook(c, 200, { start_date: daysAgo(3) });
  for (const [p, d] of [[20, 3], [40, 2], [60, 1]]) await c.post(`/api/entries/${e.id}/progress`, { current_page: p, date: daysAgo(d) });
  await c.post(`/api/entries/${e.id}/progress`, { current_page: 50 });
  const logs = (await c.get(`/api/entries/${e.id}`)).json.logs;
  assert.equal(logs.length, 3, 'log satiri sayisi: ' + logs.length);
});
test('(f) X-Forwarded-For degistirerek giris limiti asilamaz', async () => {
  const u = uniq();
  let hit = false;
  for (let i = 0; i < 25 && !hit; i++) {
    const r = await new Client().raw('POST', '/api/auth/login', { body: { username: u, password: 'x' + i }, headers: { 'x-forwarded-for': `10.9.${i}.${i + 1}` } });
    hit = r.status === 429;
  }
  assert.ok(hit, '25 yanlis denemede 429 yok');
});
test('(g) film: eklenme zamanindan 48 saat (47s gorunur, 49s degil)', async () => {
  const c = await newMember();
  const mk = async () => {
    const cat = await admin.post('/api/admin/catalog', { type: 'movie', title: 'FM-' + uniq() });
    const e = (await c.post('/api/entries', { catalog_id: cat.json.item.id })).json.entry;
    return { id: e.id, title: cat.json.item.title };
  };
  const m47 = await mk();
  const m49 = await mk();
  const db = new DatabaseSync(DB);
  const iso = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  db.prepare('update entries set created_at=?, updated_at=? where id=?').run(iso(47), iso(47), m47.id);
  db.prepare('update entries set created_at=?, updated_at=? where id=?').run(iso(49), iso(49), m49.id);
  db.close();
  const s = JSON.stringify((await c.get('/api/feed')).json);
  assert.ok(s.includes(m47.title), '47 saat once eklenen film gorunmuyor');
  assert.ok(!s.includes(m49.title), '49 saat once eklenen film hala gorunuyor');
});
test('(h) yonetici hesabi feed ve liderlikte yok (E-21)', async () => {
  const c = await newMember();
  const feed = (await c.get('/api/feed')).json;
  assert.ok(!feed.cards.some((x) => x.user.id === 1), 'feed kartinda admin');
  for (const k of ['record', 'average', 'finished']) assert.ok(!(await rows(c, k)).some((x) => x.user.id === 1), k + ' tablosunda admin');
});
test('(i) kapak yolu ..%5c ve yanlis content-type 500 vermez', async () => {
  const r = await new Client().get('/api/covers/..%5c..%5cpackage.json');
  assert.ok(r.status < 500, 'covers -> ' + r.status);
  const x = await new Client().raw('POST', '/api/auth/login', { rawBody: '<a/>', headers: { 'content-type': 'application/xml' } });
  assert.ok(x.status < 500, 'xml -> ' + x.status);
});
test('H-003 devam+end_date<start_date', async () => {
  const c = await newMember();
  const cat = await admin.post('/api/admin/catalog', { type: 'book', title: 'R-' + uniq(), pages: 100 });
  const r = await c.post('/api/entries', { catalog_id: cat.json.item.id, status: 'devam', start_date: daysAgo(1), end_date: '2000-01-01' });
  assert.equal(r.status, 400);
});
test('H-007 feed kartinda oge siniri', async () => {
  const c = await newMember();
  for (let i = 0; i < 15; i++) await newBook(c, 100, { start_date: daysAgo(1) });
  const card = (await c.get('/api/feed')).json.cards.find((x) => x.user.id === c.id);
  assert.ok(card.items.length <= 12, 'kart oge sayisi: ' + card.items.length);
});

test('v4: geri gidis confirm ister, onayla log silmez, net sayfa dogru', async () => {
  const c = await newMember();
  const e = await newBook(c, 200, { start_date: daysAgo(3) });
  for (const [p, d] of [[20, 3], [40, 2], [60, 1]]) await c.post(`/api/entries/${e.id}/progress`, { current_page: p, date: daysAgo(d) });
  const r1 = await c.post(`/api/entries/${e.id}/progress`, { current_page: 30 });
  assert.equal(r1.status, 400);
  assert.equal(r1.json.code, 'CONFIRM_REQUIRED');
  const r2 = await c.post(`/api/entries/${e.id}/progress`, { current_page: 30, confirm: true });
  assert.equal(r2.status, 200);
  const d = (await c.get(`/api/entries/${e.id}`)).json;
  assert.equal(d.entry.current_page, 30);
  assert.ok(d.logs.length >= 3, 'log sayisi ' + d.logs.length);
  assert.equal(d.logs.reduce((a, l) => a + l.pages_read, 0), 30);
});
test('v4: current_page=0 400', async () => {
  const c = await newMember();
  const e = await newBook(c, 100, { start_date: daysAgo(1) });
  assert.equal((await c.post(`/api/entries/${e.id}/progress`, { current_page: 0 })).status, 400);
});
test('v4: kapak ..%5c 404, xml 415, 1.5MB govde 413', async () => {
  assert.equal((await new Client().get('/api/covers/..%5c..%5cpackage.json')).status, 404);
  assert.equal((await new Client().raw('POST', '/api/auth/login', { rawBody: '<a/>', headers: { 'content-type': 'application/xml' } })).status, 415);
  const c = await newMember(); const e = await newBook(c, 100);
  assert.equal((await c.post(`/api/entries/${e.id}/comments`, { body: 'x'.repeat(1.5e6) })).status, 413);
});
test('v4: kullanici adi degistirerek IP limiti (40/5dk) sonunda 429 (SPRAY=1; sonrasi 5 dk IP kilitler)', { skip: !process.env.SPRAY }, async () => {
  let hit = 0;
  for (let i = 0; i < 60 && !hit; i++) if ((await new Client().post('/api/auth/login', { username: 'spray' + i + uniq(), password: 'x' })).status === 429) hit = i + 1;
  assert.ok(hit && hit <= 45, 'ilk 429: ' + hit);
});
test('v4: backend frontend/dist sunuyor (SPA)', async () => {
  const r = await new Client().get('/liderlik', { headers: { accept: 'text/html' } });
  assert.equal(r.status, 200);
  assert.ok(/<div id="root"|<html/i.test(r.text));
});
