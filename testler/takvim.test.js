// Tur bazli takvim ucu: GET /api/users/:id/calendar (kitap sayfa, dizi bolum, film adet, ilk kayit tarihleri).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, istDay } = require('./lib/v5h');
const ctx = setup();
let admin;
const uniq = () => Math.random().toString(36).slice(2, 8);

describe('takvim ucu', () => {
  before(async () => { await ctx.before(); admin = ctx.admin; });
  after(() => ctx.after());

  test('bos kullanici: days bos, first hepsi null', async () => {
    const u = await ctx.mkUser('tk0');
    const r = await u.c.get(`/api/users/${u.id}/calendar?from=${istDay(10)}&to=${istDay(0)}`);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.days, []);
    assert.deepEqual(r.json.first, { book: null, series: null, movie: null });
  });

  test('kitap sayfasi + film adedi gune yazilir, first dogru, aralik disi gelmez', async () => {
    const u = await ctx.mkUser('tk1');
    const cat = (await admin.post('/api/admin/catalog', { type: 'book', title: 'TK-' + uniq(), pages: 500 })).json.item;
    const e = (await u.c.post('/api/entries', { catalog_id: cat.id, total_pages: 500, start_date: istDay(20) })).json.entry;
    assert.equal((await u.c.put(`/api/entries/${e.id}/day-logs`, { days: [{ date: istDay(5), pages: 12 }, { date: istDay(15), pages: 7 }] })).status, 200);
    const mc = (await admin.post('/api/admin/catalog', { type: 'movie', title: 'TKF-' + uniq() })).json.item;
    const m = await u.c.post('/api/entries', { catalog_id: mc.id, type: 'movie', status: 'bitti', end_date: istDay(5) });
    assert.equal(m.status, 201, m.text);
    const r = await u.c.get(`/api/users/${u.id}/calendar?from=${istDay(10)}&to=${istDay(0)}`);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.days.length, 1, 'istDay(15) aralik disi');
    assert.deepEqual(r.json.days[0], { date: istDay(5), pages: 12, estimated: false, episodes: 0, movies: 1 });
    assert.equal(r.json.first.book, istDay(15));
    assert.equal(r.json.first.movie, istDay(5));
    assert.equal(r.json.first.series, null);
  });

  test('dogrulama: eksik/gecersiz tarih, ters aralik, 400 gunden genis aralik -> 400; olmayan uye -> 404', async () => {
    const u = await ctx.mkUser('tk2');
    for (const q of ['', `?from=${istDay(3)}`, '?from=x&to=y', `?from=${istDay(0)}&to=${istDay(3)}`, `?from=${istDay(500)}&to=${istDay(0)}`]) {
      assert.equal((await u.c.get(`/api/users/${u.id}/calendar${q}`)).status, 400, q);
    }
    assert.equal((await u.c.get(`/api/users/99999999/calendar?from=${istDay(3)}&to=${istDay(0)}`)).status, 404);
  });
});
