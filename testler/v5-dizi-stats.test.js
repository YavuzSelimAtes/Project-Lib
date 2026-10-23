// v5 madde 4 (dizi sezon/bolum) ve 6 (tur bazli stats). GERCEK backend (4100) + canli TVMaze/Wikidata (nazik, az istek).
// Dis kaynak cevap vermezse ilgili test t.skip ile atlanir (uygulama hatasi sayilmaz).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, Client, istDay, sleep } = require('./lib/v5h');
const ctx = setup();
let admin;
const cats = {}; // ad -> {id, external_id}

async function pickSeries(title, tvmazeId) {
  const s = await admin.get('/api/catalog/search?type=series&q=' + encodeURIComponent(title));
  const hit = (s.json.items || []).find((i) => String(i.external_id) === String(tvmazeId) && i.source === 'tvmaze');
  if (!hit) return null;
  if (hit.id) return { id: hit.id, external_id: tvmazeId };
  const p = await admin.post('/api/catalog/pick', { key: hit.key });
  if (p.status >= 300) return null;
  return { id: (p.json.item || p.json).id, external_id: tvmazeId };
}
async function tvmazeRef(showId) {
  try {
    const res = await fetch(`https://api.tvmaze.com/shows/${showId}/episodes`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const eps = await res.json();
    const today = istDay(0), by = {};
    for (const e of eps) {
      if (e.number == null) continue; // ozel bolumler haric
      const b = (by[e.season] ??= { pub: 0, all: 0 });
      b.all++; if (e.airdate && e.airdate <= today) b.pub++;
    }
    return Object.fromEntries(Object.entries(by).filter(([, v]) => v.pub >= 1).map(([k, v]) => [Number(k), v.pub]));
  } catch { return null; }
}

describe('v5-4 dizi sezon/bolum', () => {
  before(async () => {
    await ctx.before(); admin = ctx.admin;
    cats.bb = await pickSeries('Breaking Bad', 169); await sleep(500);
    cats.dark = await pickSeries('Dark', 17861); await sleep(500);
    cats.my = await pickSeries('Muhteşem Yüzyıl', 5858);
  });
  after(() => ctx.after());

  for (const [k, label, tv] of [['bb', 'Breaking Bad', 169], ['dark', 'Dark', 17861], ['my', 'Muhtesem Yuzyil', 5858]]) {
    test(`${label}: /seasons sezon+bolum sayilari TVMaze ile ayni`, async (t) => {
      if (!cats[k]) return t.skip('TVMaze aramasi sonuc vermedi');
      const ref = await tvmazeRef(tv);
      if (!ref) return t.skip('TVMaze erisilemedi');
      const u = await ctx.mkUser('dz' + k);
      const r = await u.c.get(`/api/catalog/${cats[k].id}/seasons`);
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.known, true);
      const got = Object.fromEntries(r.json.seasons.map((s) => [s.season, s.episodes]));
      assert.deepEqual(got, ref, `${label} sezon->bolum`);
      assert.equal(r.json.total_seasons, Object.keys(ref).length);
      assert.equal(r.json.total_episodes, Object.values(ref).reduce((a, b) => a + b, 0));
      const cat = (await u.c.get(`/api/catalog/${cats[k].id}`)).json.item;
      assert.equal(cat.seasons, Object.keys(ref).length, 'katalog.seasons');
      assert.ok(cat.runtime > 0, 'katalog.runtime');
    });
  }

  test('olmayan sezon/bolum: POST, PATCH, series-progress 400 + Turkce mesaj; son bolum kabul', async (t) => {
    if (!cats.bb) return t.skip('Breaking Bad yok');
    const u = await ctx.mkUser('dzv');
    const C = cats.bb.id;
    const bad = [[{ season: 6, episode: 1 }, /5 sezon var/], [{ season: 1, episode: 8 }, /1\. sezon 7 bolumden/], [{ season: 5, episode: 17 }, /5\. sezon 16 bolumden/],
      [{ season: 0, episode: 1 }], [{ season: -1, episode: 1 }], [{ season: 1.5, episode: 1 }], [{ season: 'a', episode: 1 }], [{ season: 1, episode: 0 }], [{ season: 1, episode: 'x' }],
      [{ season: 99999999, episode: 1 }], [{ episode: 3 }, /sezonu da secin/]];
    for (const [b, re] of bad) {
      const r = await u.c.post('/api/entries', { catalog_id: C, type: 'series', status: 'devam', ...b });
      assert.equal(r.status, 400, `POST ${JSON.stringify(b)} -> ${r.status} ${r.text}`);
      if (re) assert.match(r.json.error, re);
    }
    // son bolum
    let r = await u.c.post('/api/entries', { catalog_id: C, type: 'series', status: 'devam', season: 5, episode: 16 });
    assert.equal(r.status, 201, r.text);
    const e = r.json.entry;
    assert.equal(e.season_count, 5); assert.equal(e.episode_count, 16); assert.equal(e.seasons_unknown, false);
    // hizli guncelleme (series-progress) sinirlari
    for (const [b, re] of [[{ season: 3, episode: 14 }, /3\. sezon 13 bolumden/], [{ season: 6, episode: 1 }, /5 sezon var/], [{ season: 5, episode: 17 }, /16 bolumden/], [{ episode: 5 }], [{ season: 1 }]]) {
      const x = await u.c.post(`/api/entries/${e.id}/series-progress`, b);
      assert.equal(x.status, 400, `series-progress ${JSON.stringify(b)} -> ${x.status}`);
      if (re) assert.match(x.json.error, re);
    }
    for (const [s, ep, ec] of [[3, 13, 13], [1, 7, 7], [2, 1, 13], [5, 16, 16]]) {
      const x = await u.c.post(`/api/entries/${e.id}/series-progress`, { season: s, episode: ep });
      assert.equal(x.status, 200, x.text); assert.equal(x.json.entry.season, s); assert.equal(x.json.entry.episode, ep); assert.equal(x.json.entry.episode_count, ec);
    }
    // PATCH
    for (const b of [{ season: 5, episode: 99 }, { season: 9 }, { episode: 20 }]) assert.equal((await u.c.patch(`/api/entries/${e.id}`, b)).status, 400, JSON.stringify(b));
    assert.equal((await u.c.patch(`/api/entries/${e.id}`, { season: 1, episode: 7 })).status, 200);
    // 1. sezona gecince 16. bolum tutarsiz olurdu
    assert.equal((await u.c.patch(`/api/entries/${e.id}`, { season: 5, episode: 16 })).status, 200);
    assert.equal((await u.c.patch(`/api/entries/${e.id}`, { season: 1 })).status, 400, 'sezon degisince mevcut bolum sinira uymali');
    // bitti + olmayan sezon
    assert.equal((await u.c.post('/api/entries', { catalog_id: C, type: 'series', status: 'bitti', season: 9, episode: 1 })).status, 400);
    // baskasinin kaydi
    const o = await ctx.mkUser('dzo');
    assert.ok([403, 404].includes((await o.c.post(`/api/entries/${e.id}/series-progress`, { season: 1, episode: 1 })).status));
  });

  test('sezon bilgisi olmayan (manuel) dizi: serbest giris + seasons_unknown=true; kitap/film icin /seasons 400', async () => {
    const u = await ctx.mkUser('dzm');
    const c = await admin.post('/api/admin/catalog', { type: 'series', title: `V5 Manuel Dizi ${ctx.RUN}`, author_or_creator: 'Y', year: 2001 });
    assert.equal(c.status, 201);
    const s = await u.c.get(`/api/catalog/${c.json.item.id}/seasons`);
    assert.equal(s.status, 200); assert.equal(s.json.known, false); assert.deepEqual(s.json.seasons, []);
    const r = await u.c.post('/api/entries', { catalog_id: c.json.item.id, type: 'series', status: 'devam', season: 12, episode: 99 });
    assert.equal(r.status, 201, r.text); assert.equal(r.json.entry.seasons_unknown, true);
    assert.equal((await u.c.get('/api/catalog/2/seasons')).status, 400);
    assert.equal((await u.c.get('/api/catalog/99999999/seasons')).status, 404);
    assert.equal((await new Client().get(`/api/catalog/${c.json.item.id}/seasons`)).status, 401);
  });
});

describe('v5-6 tur bazli istatistik', () => {
  after(() => ctx.after());
  let bbId, darkId, myId, manualSeries, manualMovie, filmKey = {};
  before(async () => {
    await ctx.before(); admin = ctx.admin;
    bbId = cats.bb?.id; darkId = cats.dark?.id; myId = cats.my?.id;
    const c = await admin.post('/api/admin/catalog', { type: 'series', title: `V5 Stats Manuel Dizi ${ctx.RUN}`, author_or_creator: 'Y', year: 2001 });
    manualSeries = c.json.item.id;
    const m = await admin.post('/api/admin/catalog', { type: 'movie', title: `V5 Stats Manuel Film ${ctx.RUN}`, author_or_creator: 'Y', year: 2001 });
    manualMovie = m.json.item.id;
    for (const [name, q, qid] of [['inception', 'Inception', 'Q25188'], ['titanic', 'Titanic', 'Q44578']]) {
      const s = await admin.get('/api/catalog/search?type=movie&q=' + encodeURIComponent(q));
      const hit = (s.json.items || []).find((i) => i.external_id === qid);
      if (hit && (hit.key || hit.id)) filmKey[name] = { ref: hit.id ? { catalog_id: hit.id } : { catalog_key: hit.key }, runtime: hit.runtime };
      await sleep(600);
    }
  });

  test('type parametresi: all|book|series|movie gecerli ve echo; gecersiz 400; verilmezse all', async () => {
    const u = await ctx.mkUser('sty');
    for (const t of ['all', 'book', 'series', 'movie']) {
      const r = await u.c.get(`/api/users/${u.id}/stats?type=${t}`);
      assert.equal(r.status, 200); assert.equal(r.json.type, t);
      for (const f of ['books_finished', 'total_pages', 'series_finished', 'episodes_watched', 'series_minutes', 'movies_watched', 'movie_minutes']) assert.equal(r.json[f], 0, `${t}.${f} bos kullanicida 0 olmali`);
    }
    assert.equal((await u.c.get(`/api/users/${u.id}/stats`)).json.type, 'all');
    for (const bad of ['bad', 'BOOK', "all'--", '1']) assert.equal((await u.c.get(`/api/users/${u.id}/stats?type=${encodeURIComponent(bad)}`)).status, 400, bad);
  });

  test('episodes_watched / series_minutes elle hesap (devam: konuma kadar, bitti: tum bolumler, bilinmeyen dizi: 0 + episodes_unknown)', async (t) => {
    if (!(bbId && darkId && myId)) return t.skip('TVMaze dizileri yok');
    const u = await ctx.mkUser('stse');
    const add = async (b) => { const r = await u.c.post('/api/entries', { type: 'series', ...b }); assert.equal(r.status, 201, r.text); return r.json.entry; };
    // Breaking Bad: sezon bolum sayilari 7,13,13,13,16 ; sure 60
    await add({ catalog_id: bbId, status: 'devam', season: 3, episode: 5 });          // 7+13+5 = 25 bolum * 60 = 1500
    // Dark: 10,8,8 ; sure 50,57,64 ; bitti -> 26 bolum, 10*50+8*57+8*64 = 1468
    await add({ catalog_id: darkId, status: 'bitti' });
    // Muhtesem Yuzyil: 24,39,40,36 ; sure 90 ; S1E10 -> 10 * 90 = 900
    await add({ catalog_id: myId, status: 'devam', season: 1, episode: 10 });
    let s = (await u.c.get(`/api/users/${u.id}/stats?type=series`)).json;
    assert.equal(s.episodes_watched, 25 + 26 + 10);
    assert.equal(s.series_minutes, 1500 + 1468 + 900);
    assert.equal(s.series_finished, 1); assert.equal(s.series_active, 2);
    assert.equal(s.episodes_unknown, false);
    // sezon bilgisi olmayan dizi: tahmin yok, 0 sayilir
    await add({ catalog_id: manualSeries, status: 'devam', season: 2, episode: 3 });
    s = (await u.c.get(`/api/users/${u.id}/stats?type=series`)).json;
    assert.equal(s.episodes_watched, 61); assert.equal(s.episodes_unknown, true);
    // type diger alanlari etkilemez: hepsi her zaman doner
    const all = (await u.c.get(`/api/users/${u.id}/stats?type=all`)).json;
    assert.equal(all.episodes_watched, 61); assert.equal(all.series_minutes, 3868);
    // hizli guncelleme son bolume: BB S5E16 -> 62 bolum
    const bb = (await u.c.get(`/api/entries?user_id=${u.id}&type=series`)).json;
    const list = bb.entries || bb.items || bb;
    const bbEntry = list.find((e) => (e.catalog_id ?? e.catalog?.id) === bbId);
    assert.equal((await u.c.post(`/api/entries/${bbEntry.id}/series-progress`, { season: 5, episode: 16 })).status, 200);
    s = (await u.c.get(`/api/users/${u.id}/stats?type=series`)).json;
    assert.equal(s.episodes_watched, 62 + 26 + 10); assert.equal(s.series_minutes, 62 * 60 + 1468 + 900);
  });

  test('movie_minutes: yalniz bitmis filmlerin runtime toplami; suresi bilinmeyen 0 + movie_runtime_unknown; planlandi sayilmaz; period', async (t) => {
    if (!filmKey.inception || !filmKey.titanic) return t.skip('Wikidata film sonuclari yok');
    const u = await ctx.mkUser('stmv');
    const old = istDay(200);
    let r = await u.c.post('/api/entries', { ...filmKey.inception.ref, type: 'movie', status: 'bitti', end_date: istDay(0) });
    assert.equal(r.status, 201, r.text);
    r = await u.c.post('/api/entries', { ...filmKey.titanic.ref, type: 'movie', status: 'bitti', end_date: old });
    assert.equal(r.status, 201, r.text);
    r = await u.c.post('/api/entries', { catalog_id: manualMovie, type: 'movie', status: 'bitti', end_date: istDay(1) });
    assert.equal(r.status, 201, r.text);
    const planned = await u.c.post('/api/entries', { ...filmKey.titanic.ref, type: 'movie', status: 'planlandi' });
    assert.ok([201, 409].includes(planned.status), planned.text);
    const ri = filmKey.inception.runtime, rt = filmKey.titanic.runtime;
    assert.ok(ri > 0 && rt > 0);
    let s = (await u.c.get(`/api/users/${u.id}/stats?type=movie`)).json;
    assert.equal(s.movies_watched, 3); assert.equal(s.movie_minutes, ri + rt); assert.equal(s.movie_runtime_unknown, 1);
    s = (await u.c.get(`/api/users/${u.id}/stats?type=movie&period=month`)).json;
    assert.equal(s.movies_watched, 2); assert.equal(s.movie_minutes, ri);
    s = (await u.c.get(`/api/users/${u.id}/stats?type=movie&period=year`)).json;
    assert.ok(s.movie_minutes === ri || s.movie_minutes === ri + rt, 'year: ' + s.movie_minutes);
  });

  test('kitap alanlari type=book ile ayni; film/dizi kayitlari kitap sayilarini bozmaz', async () => {
    const u = await ctx.mkUser('stbk');
    const cat = (await admin.post('/api/admin/catalog', { type: 'book', title: `V5 Stats Kitap ${ctx.RUN}`, author_or_creator: 'K', pages: 200 })).json.item.id;
    const b = await u.c.post('/api/entries', { catalog_id: cat, type: 'book', status: 'devam', start_date: istDay(3), total_pages: 200 });
    assert.equal((await u.c.post(`/api/entries/${b.json.entry.id}/progress`, { current_page: 200 })).status, 200);
    await u.c.post('/api/entries', { catalog_id: manualMovie, type: 'movie', status: 'bitti', end_date: istDay(0) });
    const s = (await u.c.get(`/api/users/${u.id}/stats?type=book`)).json;
    assert.equal(s.books_finished, 1); assert.equal(s.total_pages, 200); assert.equal(s.movies_watched, 1);
    const a = (await u.c.get(`/api/users/${u.id}/stats`)).json;
    for (const k of ['books_finished', 'total_pages', 'movies_watched', 'series_finished', 'current_streak', 'longest_streak', 'avg_pages_per_day']) assert.equal(a[k], s[k], k);
    // baska kullanicinin stats'ini goruntuleme serbest (U), ama giris sart
    assert.equal((await new Client().get(`/api/users/${u.id}/stats?type=book`)).status, 401);
    assert.equal((await u.c.get('/api/users/99999999/stats?type=book')).status, 404);
  });
});
