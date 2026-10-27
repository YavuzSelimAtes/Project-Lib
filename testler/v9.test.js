// v9: tebrik, kitap puanlama, "neden okumuyorsun", yorum tepkisi/bildirimi, genel kitaplik, acik gun (bugun yok). GERCEK backend (4100).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, daysAgo, RUN } = require('./lib/v5h');
const ctx = setup();
const { mkUser } = ctx;
let admin, cat, a, b, c;
const kinds = async (u, kind) => ((await u.c.get('/api/notifications')).json.notifications || []).filter((n) => n.kind === kind);

describe('v9', () => {
  before(async () => {
    await ctx.before(); admin = ctx.admin;
    const r = await admin.post('/api/admin/catalog', { type: 'book', title: `V9 Kitap ${RUN}`, author_or_creator: 'Çağlar Yazar', pages: 100 });
    assert.equal(r.status, 201, r.text);
    cat = r.json.item.id;
    a = await mkUser('a'); b = await mkUser('b'); c = await mkUser('c');
  });
  after(() => ctx.after());

  let entA, entB;
  test('kayit + tur + tebrik (idempotent, bildirim, feed bilgisi)', async () => {
    let r = await a.c.post('/api/entries', { catalog_id: cat, status: 'devam', genre: 'kurgu' });
    assert.equal(r.status, 201, r.text); entA = r.json.entry.id;
    assert.equal(r.json.entry.catalog.genre, 'kurgu');
    r = await b.c.post('/api/entries', { catalog_id: cat, status: 'devam', genre: 'xx' });
    assert.equal(r.status, 400);
    r = await b.c.post('/api/entries', { catalog_id: cat, status: 'devam' }); entB = r.json.entry.id;
    assert.equal((await b.c.post(`/api/entries/${entA}/congrats`)).status, 400); // bitmedi
    assert.equal((await a.c.post(`/api/entries/${entA}/progress`, { current_page: 100 })).status, 200);
    assert.equal((await a.c.post(`/api/entries/${entA}/congrats`)).status, 400); // kendini
    r = await b.c.post(`/api/entries/${entA}/congrats`);
    assert.equal(r.status, 200, r.text); assert.equal(r.json.already_sent, false); assert.equal(r.json.congrats_count, 1);
    r = await b.c.post(`/api/entries/${entA}/congrats`);
    assert.equal(r.json.already_sent, true); assert.equal(r.json.congrats_count, 1);
    const n = await kinds(a, 'congrats');
    assert.equal(n.length, 1); assert.match(n[0].title, /seni tebrik etti 🎉/);
    const f = (await b.c.get('/api/feed')).json;
    const item = f.cards.find((x) => x.user.id === a.id).items.find((i) => i.entry_id === entA);
    assert.equal(item.congrats_count, 1); assert.equal(item.i_congratulated, true);
    const f2 = (await c.c.get('/api/feed')).json.cards.find((x) => x.user.id === a.id).items.find((i) => i.entry_id === entA);
    assert.equal(f2.i_congratulated, false);
  });

  test('metrikler + puanlama + ortalamalar', async () => {
    const m = (await a.c.get('/api/book-metrics')).json;
    assert.equal(m.genres.kurgu.metrics.length, 5); assert.equal(m.genres.felsefe.metrics[0].key, 'onem');
    const full = (n) => ({ senaryo: n, akicilik: n, karakterler: n, dil: n, duygu: n });
    assert.equal((await c.c.put(`/api/catalog/${cat}/ratings`, { scores: full(3) })).status, 403); // kaydi yok
    assert.equal((await a.c.put(`/api/catalog/${cat}/ratings`, { scores: { senaryo: 5 } })).status, 400);
    assert.equal((await a.c.put(`/api/catalog/${cat}/ratings`, { scores: { ...full(5), dil: 6 } })).status, 400);
    assert.equal((await a.c.put(`/api/catalog/${cat}/ratings`, { scores: { ...full(5), onem: 3 } })).status, 400);
    let r = await a.c.put(`/api/catalog/${cat}/ratings`, { scores: full(5) });
    assert.equal(r.status, 200, r.text); assert.equal(r.json.average, 5);
    assert.equal((await b.c.put(`/api/catalog/${cat}/ratings`, { scores: full(3) })).status, 403); // devam ederken puan verilemez
    assert.equal((await b.c.patch(`/api/entries/${entB}`, { status: 'bitti' })).status, 200);
    r = await b.c.put(`/api/catalog/${cat}/ratings`, { scores: { ...full(3), dil: 1 } });
    assert.equal(r.json.count, 2); assert.equal(r.json.average, 3.8); // (25 + 13) / 10
    r = await a.c.put(`/api/catalog/${cat}/ratings`, { scores: full(4) }); // guncelleme
    assert.equal(r.json.count, 2); assert.equal(r.json.mine.average, 4);
    assert.equal(r.json.by_metric.dil, 2.5); assert.equal(r.json.by_user.length, 2);
    assert.equal((await a.c.patch(`/api/entries/${entA}`, { genre: 'felsefe' })).status, 409); // puanli kitapta tur degismez
  });

  test('yorum bildirimi + tepkiler', async () => {
    let r = await b.c.post(`/api/entries/${entA}/comments`, { body: 'ilk' });
    assert.equal(r.status, 201); const cid = r.json.comment.id;
    assert.equal((await kinds(a, 'comment')).length, 1);
    await c.c.post(`/api/entries/${entA}/comments`, { body: 'ikinci' }); // a (sahip) + b (onceki yorumcu) bilgilenir
    assert.equal((await kinds(a, 'comment')).length, 2);
    assert.equal((await kinds(b, 'comment')).length, 1);
    assert.equal((await kinds(c, 'comment')).length, 0);
    assert.equal((await a.c.put(`/api/comments/${cid}/reaction`, { emoji: '🙂' })).status, 400);
    r = await a.c.put(`/api/comments/${cid}/reaction`, { emoji: '🔥' });
    assert.deepEqual(r.json.reactions, { '🔥': 1 }); assert.equal(r.json.my_reaction, '🔥');
    r = await a.c.put(`/api/comments/${cid}/reaction`, { emoji: '👍' });
    assert.deepEqual(r.json.reactions, { '👍': 1 });
    await c.c.put(`/api/comments/${cid}/reaction`, { emoji: '👍' });
    r = await a.c.put(`/api/comments/${cid}/reaction`, { emoji: '👍' }); // kaldir
    assert.deepEqual(r.json.reactions, { '👍': 1 }); assert.equal(r.json.my_reaction, null);
    await a.c.put(`/api/comments/${cid}/reaction`, { emoji: '😂' }); // tekrar: yeni bildirim yok
    assert.equal((await kinds(b, 'comment_reaction')).length, 2); // a ve c (her biri 1 kez)
    await b.c.put(`/api/comments/${cid}/reaction`, { emoji: '❤️' }); // kendi yorumu: bildirim yok
    assert.equal((await kinds(b, 'comment_reaction')).length, 2);
    const list = (await a.c.get(`/api/entries/${entA}/comments`)).json.comments;
    assert.equal(list[0].my_reaction, '😂'); assert.equal(list[0].reactions['❤️'], 1);
  });

  test('genel kitaplik: arama, detay, birlesik yorum/soru', async () => {
    let r = await a.c.get('/api/library?q=caglar&limit=5'); // Turkce karakter duyarsiz (yazar adi)
    assert.equal(r.status, 200, r.text);
    const it = r.json.items.find((x) => x.id === cat);
    assert.ok(it, 'kitap listede'); assert.equal(it.readers_count, 2); assert.equal(it.finished_count, 2); assert.equal(it.reading_count, 0);
    assert.equal(it.rating_average, 3.3); assert.equal(it.genre, 'kurgu');
    assert.equal((await a.c.get('/api/library?q=yokboylekitap' + RUN)).json.total, 0);
    r = await a.c.get(`/api/library/${cat}`);
    assert.equal(r.json.readers.length, 2); assert.equal(r.json.comment_count, 2); assert.equal(r.json.rating.can_rate, true);
    r = await a.c.get(`/api/library/${cat}/comments?limit=1`);
    assert.equal(r.json.total, 2); assert.equal(r.json.comments.length, 1); assert.ok(r.json.comments[0].user.display_name);
    r = await c.c.post(`/api/entries/${entA}/questions`, { question: 'son?' }); assert.equal(r.status, 201);
    assert.equal((await a.c.get(`/api/library/${cat}/questions`)).json.total, 1);
  });

  test('admin: neden okumuyorsun', async () => {
    assert.equal((await a.c.get('/api/admin/reading-status')).status, 403);
    assert.equal((await a.c.post(`/api/admin/users/${b.id}/nudge`)).status, 403);
    const r = await admin.get('/api/admin/reading-status');
    const x = r.json.users.find((u) => u.user.id === c.id);
    assert.ok(x, 'c listede'); assert.equal(x.bugun_okumadi, true); assert.equal(x.aktif_kitap_yok, true);
    assert.equal((await admin.post(`/api/admin/users/${c.id}/nudge`)).status, 200);
    const again = await admin.post(`/api/admin/users/${c.id}/nudge`);
    assert.equal(again.status, 409); assert.equal(again.json.code, 'ALREADY_SENT');
    const n = await kinds(c, 'nudge'); assert.equal(n.length, 1); assert.match(n[0].title, /Neden okumuyorsun/);
    assert.equal((await admin.get('/api/admin/reading-status')).json.users.find((u) => u.user.id === c.id).nudged_today, true);
  });

  test('acik gunler: bugun yok; esit dagitilan gunler open degil', async () => {
    const u = await mkUser('d');
    const cat3 = (await admin.post('/api/admin/catalog', { type: 'book', title: `V9 Dagit ${RUN}`, pages: 300 })).json.item.id;
    let r = await u.c.post('/api/entries', { catalog_id: cat3, status: 'devam', current_page: 2, start_date: daysAgo(4), backfill: 'spread' });
    assert.equal(r.status, 201, r.text);
    r = await u.c.get(`/api/entries/${r.json.entry.id}/open-days`);
    assert.equal(r.status, 200);
    assert.ok(!JSON.stringify(r.json).includes('"open"'), JSON.stringify(r.json));
    const cat2 = (await admin.post('/api/admin/catalog', { type: 'book', title: `V9 Acik ${RUN}`, pages: 300 })).json.item.id;
    r = await u.c.post('/api/entries', { catalog_id: cat2, status: 'devam', start_date: daysAgo(3) });
    r = await u.c.get(`/api/entries/${r.json.entry.id}/open-days`);
    const dates = JSON.stringify(r.json);
    assert.ok(!dates.includes(`"${daysAgo(0)}"`), 'bugun yok: ' + dates);
    assert.ok(dates.includes(`"${daysAgo(1)}"`), 'dun var: ' + dates);
  });
});
