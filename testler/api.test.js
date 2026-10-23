// API testleri (node:test). Calistir: node --test testler/*.test.js   (backend 4100'de, seed-demo calismis olmali)
const test = require('node:test');
const assert = require('node:assert/strict');
const { Client, waitForServer, daysAgo } = require('./lib/client');
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'test-admin-123';
const PW = 'Deneme123!';
const U = (j, k) => (j && j[k]) ?? j;

let admin, member;
const uniq = () => 't' + Math.random().toString(36).slice(2, 8);

test.before(async () => {
  await waitForServer();
  admin = new Client();
  assert.equal((await admin.login('admin', ADMIN_PW)).status, 200);
  member = new Client();
  assert.equal((await member.login('ayse', PW)).status, 200, 'seed-demo calismis olmali');
});

async function freshBook(c, pages = 100, extra = {}) {
  const cat = await admin.post('/api/admin/catalog', { type: 'book', title: 'T-' + uniq(), author_or_creator: 'X', pages });
  const catId = U(cat.json, 'item').id;
  const r = await c.post('/api/entries', { catalog_id: catId, type: 'book', status: 'devam', start_date: daysAgo(5), total_pages: pages, ...extra });
  assert.ok(r.status < 300, r.text);
  return U(r.json, 'entry');
}

test.describe('Yetki', () => {
  test('girissiz uclar 401', async () => {
    const c = new Client();
    for (const p of ['/api/feed', '/api/entries', '/api/admin/users', '/api/leaderboards/record', '/api/notifications', '/api/me/pending-questions']) {
      const r = await c.get(p);
      assert.equal(r.status, 401, p);
    }
  });
  test('member /api/admin/* 403', async () => {
    for (const p of ['/api/admin/users', '/api/admin/requests']) assert.equal((await member.get(p)).status, 403, p);
    assert.equal((await member.post('/api/admin/users', { username: uniq(), password: PW, display_name: 'x' })).status, 403);
    assert.equal((await member.post('/api/admin/catalog', { type: 'book', title: 'x' })).status, 403);
  });
  test('IDOR: baska kullanicinin kaydi PATCH/DELETE/progress', async () => {
    const e = await freshBook(member);
    const other = new Client(); await other.login('mehmet', PW);
    assert.ok([403, 404].includes((await other.patch(`/api/entries/${e.id}`, { status: 'bitti' })).status));
    assert.ok([403, 404].includes((await other.post(`/api/entries/${e.id}/progress`, { current_page: 10 })).status));
    assert.ok([403, 404].includes((await other.del(`/api/entries/${e.id}`)).status));
  });
  test('yanlis sifre 401, sifre cevapta yok', async () => {
    const r = await new Client().post('/api/auth/login', { username: 'ayse', password: 'yanlis' });
    assert.equal(r.status, 401);
    const me = await member.get('/api/auth/me');
    assert.ok(!/password|hash|scrypt/i.test(me.text));
    const users = await admin.get('/api/admin/users');
    assert.ok(!/password_hash|scrypt/i.test(users.text), 'admin kullanici listesi hash sizdiriyor');
  });
  test('silinen kullanicinin oturumu gecersiz', async () => {
    const name = uniq();
    const r = await admin.post('/api/admin/users', { username: name, display_name: 'Gecici', password: PW, role: 'member' });
    assert.ok(r.status < 300, r.text);
    const id = U(r.json, 'user').id;
    const c = new Client(); await c.login(name, PW);
    assert.equal((await c.get('/api/auth/me')).status, 200);
    await admin.del(`/api/admin/users/${id}`);
    assert.equal((await c.get('/api/auth/me')).status, 401);
  });
  test('login rate limit', async () => {
    const c = new Client(); let got429 = false;
    for (let i = 0; i < 30 && !got429; i++) got429 = (await c.post('/api/auth/login', { username: 'rl-fixed', password: 'x' })).status === 429;
    assert.ok(got429, '30 yanlis denemede 429 yok');
  });
  test('ayni kullanici adi iki kez / harf duyarsiz', async () => {
    const n = uniq();
    assert.ok((await admin.post('/api/admin/users', { username: n, display_name: 'A', password: PW })).status < 300);
    assert.equal((await admin.post('/api/admin/users', { username: n, display_name: 'A', password: PW })).status, 409);
    assert.equal((await admin.post('/api/admin/users', { username: n.toUpperCase(), display_name: 'A', password: PW })).status, 409);
  });
});

test.describe('Ilerleme hesabi', () => {
  test('fark hesabi ve ayni gun toplama', async () => {
    const e = await freshBook(member, 200);
    const d = daysAgo(1);
    for (const p of [10, 30, 55]) assert.ok((await member.post(`/api/entries/${e.id}/progress`, { current_page: p, date: d })).status < 300);
    const logs = await member.get(`/api/entries/${e.id}`);
    assert.ok(/55/.test(logs.text));
  });
  test('gecersiz current_page reddedilir (400)', async () => {
    const e = await freshBook(member, 100);
    for (const v of [-1, 1.5, 'abc', null, '', 101, 1e12, [], {}]) {
      const r = await member.post(`/api/entries/${e.id}/progress`, { current_page: v });
      assert.ok(r.status === 400 || r.status === 422, `current_page=${JSON.stringify(v)} -> ${r.status}`);
    }
    assert.equal((await member.post(`/api/entries/${e.id}/progress`, {})).status, 400);
  });
  test('son sayfada otomatik bitti', async () => {
    const e = await freshBook(member, 50);
    await member.post(`/api/entries/${e.id}/progress`, { current_page: 50 });
    const r = await member.get(`/api/entries/${e.id}`);
    const en = U(r.json, 'entry');
    assert.equal(en.status, 'bitti');
    assert.ok(en.end_date);
  });
  test('tek sayfalik kitap / total_pages 0', async () => {
    const e = await freshBook(member, 1);
    assert.ok((await member.post(`/api/entries/${e.id}/progress`, { current_page: 1 })).status < 300);
    const cat = await admin.post('/api/admin/catalog', { type: 'book', title: 'T-' + uniq(), author_or_creator: 'X', pages: 0 });
    const r = await member.post('/api/entries', { catalog_id: U(cat.json, 'item').id, type: 'book', status: 'devam', start_date: daysAgo(2), total_pages: 0 });
    assert.ok(r.status < 500, 'total_pages=0 sunucu hatasi: ' + r.text);
  });
  test('tarih dogrulama', async () => {
    const cat = await admin.post('/api/admin/catalog', { type: 'book', title: 'T-' + uniq(), author_or_creator: 'X', pages: 100 });
    const id = U(cat.json, 'item').id;
    const bad = [
      { start_date: daysAgo(1), end_date: daysAgo(5) },
      { start_date: '2025-13-45' }, { start_date: 'dun' }, { start_date: '2999-01-01' },
    ];
    for (const b of bad) {
      const r = await member.post('/api/entries', { catalog_id: id, type: 'book', status: 'devam', total_pages: 100, ...b });
      assert.ok(r.status === 400 || r.status === 422, `${JSON.stringify(b)} -> ${r.status}`);
    }
  });
});

test.describe('Girdi', () => {
  test('bozuk JSON / yanlis content-type / bos govde 4xx, 5xx degil', async () => {
    const c = new Client();
    for (const o of [{ rawBody: '{bozuk', headers: { 'content-type': 'application/json' } }, { rawBody: 'a=b', headers: { 'content-type': 'text/plain' } }, { rawBody: '', headers: { 'content-type': 'application/json' } }]) {
      const r = await c.raw('POST', '/api/auth/login', o);
      assert.ok(r.status >= 400 && r.status < 500, `${o.rawBody} -> ${r.status}`);
      assert.ok(!/at .*\.js:\d+/.test(r.text), 'stack trace sizdi');
    }
  });
  test('XSS/SQLi/uzun/emoji yorum guvenli saklanir', async () => {
    const e = await freshBook(member);
    const payloads = ['<script>alert(1)</script>', "'; DROP TABLE users;--", 'ığüşöçİĞÜŞÖÇ 😀👍', 'a'.repeat(100000)];
    for (const body of payloads) {
      const r = await member.post(`/api/entries/${e.id}/comments`, { body });
      assert.ok(r.status < 500, `${body.slice(0, 20)} -> ${r.status}`);
    }
    assert.equal((await member.get('/api/auth/me')).status, 200);
    const list = await member.get(`/api/entries/${e.id}/comments`);
    assert.equal(list.status, 200);
    const stored = JSON.stringify(list.json);
    assert.ok(stored.includes('ığüşöçİĞÜŞÖÇ'), 'Turkce karakter bozuldu');
  });
});

test.describe('Feed ve liderlik', () => {
  test('feed: film 47s gorunur, 49s gorunmez; devam eden kitap gorunur', async () => {
    const f = await member.get('/api/feed');
    assert.equal(f.status, 200);
    const s = JSON.stringify(f.json);
    assert.ok(s.includes('Eşkıya') || s.includes('Hababam') || s.includes('Babam ve Oğlum'), 'bugunku/dunku film yok');
    assert.ok(!s.includes('Kurtlar Vadisi'), '60 gun onceki film feedde');
  });
  test('liderlik tablolari 200 ve siralama azalan', async () => {
    for (const k of ['record', 'average', 'finished']) {
      const r = await member.get(`/api/leaderboards/${k}`);
      assert.equal(r.status, 200, k);
      const rows = r.json.entries;
      assert.ok(Array.isArray(rows), k);
      const v = rows.map((x) => x.value);
      assert.deepEqual(v, [...v].sort((a, b) => b - a), k + ' sirasiz');
    }
  });
  test('rekor tablosu Elif 187', async () => {
    const r = await member.get('/api/leaderboards/record');
    const rows = r.json.entries;
    assert.equal(rows[0].value, 187);
  });
});
