// v5 madde 5 (GET /leaderboards/streak) ve 7 (seri yalniz kitap). GERCEK backend (4100).
// Seri verisi, API ile kurulan gercek (estimated=0) gunlerden ELLE hesaplanir; "bugun" Europe/Istanbul gunudur.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, Client, istDay } = require('./lib/v5h');
const ctx = setup();
let admin, cat;

// u icin bir kitap kaydi acip verilen gunlere (gun-oncesi: sayfa) gercek log yazar
async function readDays(u, daysAgoToPages, { startAgo = 12 } = {}) {
  const r = await u.c.post('/api/entries', { catalog_id: cat, type: 'book', status: 'devam', start_date: istDay(startAgo), total_pages: 5000 });
  assert.equal(r.status, 201, r.text);
  const days = Object.entries(daysAgoToPages).map(([ago, pages]) => ({ date: istDay(+ago), pages }));
  const p = await u.c.put(`/api/entries/${r.json.entry.id}/day-logs`, { days });
  assert.equal(p.status, 200, p.text);
  return r.json.entry.id;
}
const rowOf = (lb, id) => lb.json.entries.find((e) => e.user.id === id);

describe('v5-5 seri liderligi', () => {
  before(async () => {
    await ctx.before(); admin = ctx.admin;
    const r = await admin.post('/api/admin/catalog', { type: 'book', title: `V5 Seri Kitabi ${ctx.RUN}`, author_or_creator: 'S', pages: 5000 });
    cat = r.json.item.id;
  });
  after(() => ctx.after());

  test('bugun/dun/atlanan gun/tahmini gun/0 sayfa: elle hesapla ile ayni; siralama value desc, longest desc', async () => {
    const A = await ctx.mkUser('sa'), B = await ctx.mkUser('sb'), C = await ctx.mkUser('sc'), D = await ctx.mkUser('sd'), E = await ctx.mkUser('se'), F = await ctx.mkUser('sf');
    // A: bugun,dun,2 gun once okudu; 3 gun once YOK; 4..7 okudu  -> guncel 3, en uzun 4
    await readDays(A, { 0: 10, 1: 10, 2: 10, 4: 10, 5: 10, 6: 10, 7: 10 });
    // B: bugun okumadi; dun, 2, 3 gun once okudu -> guncel 3 (dun surer), en uzun 3
    await readDays(B, { 1: 10, 2: 10, 3: 10 });
    // C: sadece 2 ve 3 gun once -> bugun/dun yok -> 0 (listede olmaz)
    await readDays(C, { 2: 10, 3: 10 });
    // D: bugun 10 sayfa, dun "okumadim" (0 sayfa), 2 gun once 10 -> guncel 1, en uzun 1
    await readDays(D, { 0: 10, 1: 0, 2: 10 });
    // E: A ile ayni desen (beraberlik: ayni rank)
    await readDays(E, { 0: 5, 1: 5, 2: 5, 4: 5, 5: 5, 6: 5, 7: 5 });
    // F: tahmini gunler: gecmis baslangicta 'spread' backfill -> tahmini satirlar, seriye SAYILMAZ
    const f = await F.c.post('/api/entries', { catalog_id: cat, type: 'book', status: 'devam', start_date: istDay(5), total_pages: 5000, current_page: 50, backfill: 'spread' });
    assert.equal(f.status, 201, f.text);

    const lb = await A.c.get('/api/leaderboards/streak');
    assert.equal(lb.status, 200);
    assert.equal(lb.json.period, 'all');
    const row = (u) => rowOf(lb, u.id);
    assert.equal(row(A).value, 3); assert.equal(row(A).detail.longest, 4); assert.equal(row(A).detail.last_date, istDay(0));
    assert.equal(row(B).value, 3); assert.equal(row(B).detail.longest, 3); assert.equal(row(B).detail.last_date, istDay(1));
    assert.equal(row(C), undefined, 'bugun/dun yok -> listede olmamali');
    assert.equal(row(D).value, 1); assert.equal(row(D).detail.longest, 1, '0 sayfalik gun seriyi bozar/saymaz');
    assert.equal(row(E).value, 3); assert.equal(row(E).detail.longest, 4);
    assert.equal(row(F), undefined, 'tahmini gunler seriye sayilmamali');
    assert.equal(row(A).rank, row(E).rank);
    assert.ok(row(B).rank > row(A).rank); assert.ok(row(D).rank > row(B).rank);
    const mine = lb.json.entries.filter((e) => [A, B, D, E].some((u) => u.id === e.user.id)).map((e) => e.user.id);
    assert.ok(mine.indexOf(B.id) > Math.max(mine.indexOf(A.id), mine.indexOf(E.id)));
    assert.ok(lb.json.entries.every((e) => e.value > 0));
    assert.ok(!lb.json.entries.some((e) => e.user.id === 1));
    for (let i = 1; i < lb.json.entries.length; i++) {
      const p = lb.json.entries[i - 1], c = lb.json.entries[i];
      assert.ok(p.value > c.value || (p.value === c.value && p.detail.longest >= c.detail.longest), 'siralama bozuk');
    }
    for (const u of [A, B, D]) {
      const s = await u.c.get(`/api/users/${u.id}/stats`);
      assert.equal(s.json.current_streak, row(u).value); assert.equal(s.json.longest_streak, row(u).detail.longest);
    }
    const sF = await F.c.get(`/api/users/${F.id}/stats`);
    assert.equal(sF.json.current_streak, 0);
  });

  test('period parametresi yok sayilir; giris gerekir', async () => {
    const u = await ctx.mkUser('sp');
    const a = await u.c.get('/api/leaderboards/streak'), b = await u.c.get('/api/leaderboards/streak?period=month'), c = await u.c.get('/api/leaderboards/streak?period=zzz');
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    assert.deepEqual(b.json, a.json);
    assert.ok(c.status === 200 || c.status === 400);
    assert.equal((await new Client().get('/api/leaderboards/streak')).status, 401);
  });

  test('seed-demo verisi: gercek (estimated=0) gunlerden elle hesaplanan seri == API (aile uyeleri)', async () => {
    const users = (await admin.get('/api/admin/users')).json.users.filter((u) => ['ayse', 'mehmet', 'elif', 'can', 'anneanne', 'dede'].includes(u.username));
    if (!users.length) return;
    const today = istDay(0), yday = istDay(1);
    const lb = await admin.get('/api/leaderboards/streak');
    for (const u of users) {
      const h = (await admin.get(`/api/users/${u.id}/heatmap?days=400`)).json.days;
      const real = new Set(h.filter((d) => !d.estimated && d.pages > 0).map((d) => d.date));
      const sorted = [...real].sort();
      let longest = 0, run = 0, prev = null;
      for (const d of sorted) {
        run = prev && Math.round((Date.parse(d) - Date.parse(prev)) / 86400e3) === 1 ? run + 1 : 1;
        longest = Math.max(longest, run); prev = d;
      }
      let cur = 0;
      if (real.has(today) || real.has(yday)) {
        let day = real.has(today) ? 0 : 1;
        while (real.has(istDay(day))) { cur++; day++; }
      }
      const s = (await admin.get(`/api/users/${u.id}/stats`)).json;
      assert.equal(s.current_streak, cur, `${u.username} guncel seri`);
      assert.equal(s.longest_streak, longest, `${u.username} en uzun seri`);
      const row = rowOf(lb, u.id);
      assert.equal(row ? row.value : 0, cur, `${u.username} liderlik`);
      if (row) assert.equal(row.detail.longest, longest);
    }
  });

  test('madde 7: dizi/film izlemek seriyi etkilemez (yalniz kitap reading_logs)', async () => {
    const u = await ctx.mkUser('s7');
    const s1 = await u.c.post('/api/entries', { catalog_id: 45, type: 'series', status: 'devam', season: 1, episode: 3 });
    assert.equal(s1.status, 201, s1.text);
    const m = await admin.post('/api/admin/catalog', { type: 'movie', title: `V5 S7 Film ${ctx.RUN}`, author_or_creator: 'Y', year: 2001 });
    await u.c.post('/api/entries', { catalog_id: m.json.item.id, type: 'movie', status: 'bitti', end_date: istDay(0) });
    await u.c.post(`/api/entries/${s1.json.entry.id}/series-progress`, { season: 1, episode: 5 });
    const a = (await u.c.get(`/api/users/${u.id}/stats`)).json;
    assert.equal(a.current_streak, 0); assert.equal(a.longest_streak, 0); assert.equal(a.active_days, 0);
    assert.equal(rowOf(await u.c.get('/api/leaderboards/streak'), u.id), undefined);
    const card = (await u.c.get('/api/feed')).json.cards.find((c) => c.user.id === u.id);
    assert.ok(!card || !card.current_streak, 'feed kartinda seri olmamali');
  });
});
