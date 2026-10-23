// v5.1 duzeltmelerinin BAGIMSIZ dogrulamasi (TEST ajani; backend'in kendi v5-1.test.js'inden ayri). GERCEK backend (4100) + canli TVMaze/Wikidata.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, Client, istDay, sleep } = require('./lib/v5h');
const ctx = setup();
let admin;
before(async () => { await ctx.before(); admin = ctx.admin; });
after(() => ctx.after());

describe('v5.1 profil gorunen ad (E-35)', () => {
  test('<, >, gorunmez/kontrol karakter 400 ve hak yakmaz; NFC/bosluk; ayni ad hak yakmaz; admin ayni kural', async () => {
    const u = await ctx.mkUser('n1');
    const bad = ['A<B', 'Ali>', '<b>Ali</b>', 'Ali​Veli', 'Ali‮Veli', '﻿Ali Veli', 'Ali\u0000Veli', 'Ali Veli', 'Ali­Veli', '‍‍‍', 'Ali⁠Veli', 'Ali\u0007Veli'];
    for (const b of bad) {
      const r = await u.c.patch('/api/me/profile', { display_name: b });
      assert.equal(r.status, 400, `${JSON.stringify(b)} -> ${r.status} ${r.text}`);
    }
    assert.equal((await u.c.get('/api/auth/me')).json.user.name_changed, false, 'reddedilen ad hak yakmamali');
    // ayni ad: normalize hali ayni -> hak yakmaz
    let r = await u.c.patch('/api/me/profile', { display_name: `  ${u.user.display_name.replace(' ', '   ')}  ` });
    assert.equal(r.status, 200); assert.equal(r.json.user.name_changed, false);
    // NFC + bosluk daraltma
    r = await u.c.patch('/api/me/profile', { display_name: '  Si̇ra   Küçük ' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.user.display_name, r.json.user.display_name.normalize('NFC'));
    assert.ok(!/\s{2}/.test(r.json.user.display_name) && r.json.user.display_name === r.json.user.display_name.trim());
    assert.equal(r.json.user.name_changed, true);
    // ayni (normalize) ad tekrar: 200, hala 1 hak kullanilmis
    assert.equal((await u.c.patch('/api/me/profile', { display_name: r.json.user.display_name })).status, 200);
    assert.equal((await u.c.patch('/api/me/profile', { display_name: 'Baska Ad' })).status, 409);
    // admin yolu
    for (const b of ['A<B', 'X​Y']) {
      assert.equal((await admin.post('/api/admin/users', { username: `v5x${b.length}bad${ctx.RUN}`, display_name: b, password: 'Deneme123!' })).status, 400, b);
      assert.equal((await admin.patch(`/api/admin/users/${u.id}`, { display_name: b })).status, 400, 'admin patch ' + b);
    }
    // 30 / 31 karakter siniri (grafem degil kod noktasi)
    const u2 = await ctx.mkUser('n2');
    assert.equal((await u2.c.patch('/api/me/profile', { display_name: 'A'.repeat(31) })).status, 400);
    assert.equal((await u2.c.patch('/api/me/profile', { display_name: 'Çş'.repeat(15) })).status, 200);
  });
});

describe('v5.1 isi haritasi (H-026)', () => {
  test('gercek + tahmini ayni gun: pages gercek, estimated:false, estimated_pages; yalniz tahmini: estimated:true', async () => {
    const u = await ctx.mkUser('hm');
    const cat = (await admin.post('/api/admin/catalog', { type: 'book', title: `V52 Isi ${ctx.RUN}`, author_or_creator: 'H', pages: 2000 })).json.item.id;
    const a = await u.c.post('/api/entries', { catalog_id: cat, type: 'book', status: 'devam', start_date: istDay(10), total_pages: 2000 });
    assert.equal((await u.c.put(`/api/entries/${a.json.entry.id}/day-logs`, { days: [{ date: istDay(2), pages: 15 }] })).status, 200);
    const cat2 = (await admin.post('/api/admin/catalog', { type: 'book', title: `V52 Isi2 ${ctx.RUN}`, author_or_creator: 'H', pages: 2000 })).json.item.id;
    const b = await u.c.post('/api/entries', { catalog_id: cat2, type: 'book', status: 'devam', start_date: istDay(4), total_pages: 2000, current_page: 40, backfill: 'spread' });
    assert.equal(b.status, 201, b.text);
    const days = (await u.c.get(`/api/users/${u.id}/heatmap?days=30`)).json.days;
    const d2 = days.find((d) => d.date === istDay(2)), d3 = days.find((d) => d.date === istDay(3));
    assert.equal(d2.pages, 15); assert.equal(d2.estimated, false); assert.equal(d2.estimated_pages, 10);
    assert.equal(d3.estimated, true); assert.equal(d3.pages, 10);
  });
});

describe('v5.1 pick/listed (E-32) ve baski yer tutucu (E-33)', () => {
  test('pick -> aramada id ile gorunmez, admin listesinde yok (?unlisted=1 ile var); entry olusunca kalici', async () => {
    const u = await ctx.mkUser('pk');
    const title = 'Dune Messiah';
    const s = await u.c.get('/api/catalog/search?type=book&q=' + encodeURIComponent(title));
    const hit = s.json.items.find((i) => !i.id && i.key);
    if (!hit) return; // internet yok
    const p = await u.c.post('/api/catalog/pick', { key: hit.key });
    assert.equal(p.status, 201, p.text);
    const id = (p.json.item || p.json).id;
    const s2 = await u.c.get('/api/catalog/search?type=book&q=' + encodeURIComponent(title));
    // Belgelenmis davranis: online sonuc yerelde (listed=0) zaten varsa ayni eser id'li gorunur; ama TEKRAR (cift) kayit olmamali
    const same = s2.json.items.filter((i) => i.id === id || (i.title === hit.title && i.author_or_creator === hit.author_or_creator));
    assert.equal(same.length, 1, 'ayni eser aramada tek kez gorunmeli (cift kayit yok)');
    const al = (await admin.get('/api/admin/catalog?limit=500')).json;
    const list = al.items || al.catalog || al;
    assert.ok(!list.some((i) => i.id === id), 'admin varsayilan listede olmamali');
    const al2 = (await admin.get('/api/admin/catalog?unlisted=1&limit=500')).json;
    const l2 = al2.items || al2.catalog || al2;
    const row = l2.find((i) => i.id === id);
    assert.ok(row && row.listed === false, 'unlisted=1 ile listed=false gelmeli');
    // kullanilinca kalici
    const e = await u.c.post('/api/entries', { catalog_id: id, type: 'book', status: 'planlandi' });
    assert.equal(e.status, 201, e.text);
    const s3 = await u.c.get('/api/catalog/search?type=book&q=' + encodeURIComponent(title));
    assert.ok(s3.json.items.some((i) => i.id === id), 'entry sonrasi aramada kalici gorunmeli');
    const l3 = (await admin.get('/api/admin/catalog?limit=500')).json; const ll = l3.items || l3.catalog || l3;
    assert.ok(ll.some((i) => i.id === id && i.listed !== false));
    // uydurma / eski key 404
    assert.equal((await u.c.post('/api/catalog/pick', { key: 'YOKYOKYOKYOK' })).status, 404);
  });

  test('yer tutucu baski: gercek baski eklenince silinir, kayitlar yeni baskiya baglanir (Hayta seed)', async () => {
    const u = await ctx.mkUser('ph');
    const s = await u.c.get('/api/catalog/search?type=book&q=' + encodeURIComponent('Hayta Anil Basili'));
    const it = s.json.items.find((i) => i.id && /hayta/i.test(i.title) && /ba[sş][ıi]l[ıi]/i.test(i.author_or_creator || ''));
    assert.ok(it, 'seed Hayta yok');
    const eds0 = (await u.c.get(`/api/catalog/${it.id}`)).json.editions;
    const ph = eds0.find((e) => !e.publisher && !e.pages);
    if (!ph) return; // baska test zaten doldurmus (tekrar kosu)
    const e = await u.c.post('/api/entries', { catalog_id: it.id, type: 'book', status: 'devam', edition_id: ph.id, total_pages: 120 });
    assert.equal(e.status, 201, e.text);
    const ne = await admin.post(`/api/admin/catalog/${it.id}/editions`, { language: 'tr', publisher: 'V52 Yayinlari', pages: 120 });
    assert.equal(ne.status, 201, ne.text);
    const eds = (await u.c.get(`/api/catalog/${it.id}`)).json.editions;
    assert.ok(!eds.some((x) => x.id === ph.id), 'bos yer tutucu silinmeli');
    const en = (await u.c.get(`/api/entries/${e.json.entry.id}`)).json.entry;
    assert.equal(en.edition_id, ne.json.edition.id, 'entry yeni baskiya baglanmali');
    assert.equal(en.total_pages, 120);
    assert.equal((await admin.del(`/api/admin/editions/${ne.json.edition.id}`)).status, 200);
  });
});

describe('v5.1 biten kitapta baski degisimi (E-28/E-46)', () => {
  test('bitti kalan kitapta baski/total_pages her yone; okunan sayfa istatistigi eski degerde sabit; log uretilmez', async () => {
    const u = await ctx.mkUser('bk');
    const cat = (await admin.post('/api/admin/catalog', { type: 'book', title: `V52 Biten ${ctx.RUN}`, author_or_creator: 'B', pages: 300 })).json.item.id;
    const e300 = (await admin.post(`/api/admin/catalog/${cat}/editions`, { language: 'tr', publisher: 'A', pages: 300 })).json.edition.id;
    const e100 = (await admin.post(`/api/admin/catalog/${cat}/editions`, { language: 'tr', publisher: 'B', pages: 100 })).json.edition.id;
    const e500 = (await admin.post(`/api/admin/catalog/${cat}/editions`, { language: 'en', publisher: 'C', pages: 500 })).json.edition.id;
    const r = await u.c.post('/api/entries', { catalog_id: cat, type: 'book', status: 'bitti', start_date: istDay(10), end_date: istDay(5), edition_id: e300 });
    assert.equal(r.status, 201, r.text);
    const id = r.json.entry.id;
    const st0 = (await u.c.get(`/api/users/${u.id}/stats`)).json;
    const logs0 = (await u.c.get(`/api/users/${u.id}/heatmap?days=60`)).json.days.length;
    for (const [ed, pages] of [[e100, 100], [e500, 500], [e300, 300]]) {
      const x = await u.c.patch(`/api/entries/${id}`, { edition_id: ed });
      assert.equal(x.status, 200, x.text);
      assert.equal(x.json.entry.status, 'bitti'); assert.equal(x.json.entry.total_pages, pages); assert.equal(x.json.entry.current_page, pages);
      const st = (await u.c.get(`/api/users/${u.id}/stats`)).json;
      assert.equal(st.total_pages, st0.total_pages, `baski ${pages}: toplam okunan sayfa sabit kalmali`);
      assert.equal(st.books_finished, st0.books_finished);
    }
    assert.equal((await u.c.get(`/api/users/${u.id}/heatmap?days=60`)).json.days.length, logs0, 'log uretilmemeli');
    // total_pages elle degisimi
    const y = await u.c.patch(`/api/entries/${id}`, { total_pages: 90 });
    assert.equal(y.status, 200, y.text); assert.equal(y.json.entry.current_page, 90); assert.equal(y.json.entry.status, 'bitti');
    // devam eden kitapta eski kural
    const d = await u.c.post('/api/entries', { catalog_id: cat, type: 'book', status: 'devam', start_date: istDay(3), edition_id: e300 });
    await u.c.post(`/api/entries/${d.json.entry.id}/progress`, { current_page: 150 });
    assert.equal((await u.c.patch(`/api/entries/${d.json.entry.id}`, { edition_id: e100 })).status, 400);
  });
});

describe('v5.1 film suresi', () => {
  test('bilinen filmlerin suresi dogru, hepsi 20..600 dk veya null; movie_minutes toplami; birim hatasi yok', async (t) => {
    const u = await ctx.mkUser('fm');
    const known = { 'Q25188': 148, 'Q47703': 175, 'Q44578': 194 }; // Baslangic, Baba, Titanik (Wikidata)
    const qs = ['Inception', 'The Godfather', 'Titanic', 'Coco', 'Matrix', 'Interstellar'];
    let sum = 0, added = 0, unknown = 0; const seen = [];
    for (const q of qs) {
      const s = await u.c.get('/api/catalog/search?type=movie&q=' + encodeURIComponent(q));
      assert.equal(s.status, 200);
      for (const i of s.json.items.slice(0, 5)) {
        if (i.runtime != null) { seen.push(`${i.title}:${i.runtime}`); assert.ok(i.runtime >= 20 && i.runtime <= 600, `${i.title} suresi ${i.runtime} (20-600 disi null olmali)`); }
        if (i.external_id && known[i.external_id] !== undefined) assert.equal(i.runtime, known[i.external_id], `${i.title} ${i.external_id}`);
      }
      const hit = s.json.items.find((i) => i.external_id && known[i.external_id] !== undefined) || s.json.items.find((i) => i.runtime);
      if (hit && added < 4) {
        const body = hit.id ? { catalog_id: hit.id } : { catalog_key: hit.key };
        const e = await u.c.post('/api/entries', { ...body, type: 'movie', status: 'bitti', end_date: istDay(0) });
        if (e.status === 201) { added++; if (hit.runtime) sum += hit.runtime; else unknown++; }
      }
      await sleep(500);
    }
    if (!added) return t.skip('Wikidata sonucu yok');
    let s;
    for (let i = 0; i < 6; i++) { s = (await u.c.get(`/api/users/${u.id}/stats?type=movie`)).json; if (s.movie_minutes === sum) break; await sleep(1500); }
    assert.equal(s.movie_minutes, sum, `movie_minutes ${s.movie_minutes} != ${sum} (${seen.join(', ')})`);
    assert.ok(s.movie_runtime_unknown >= unknown);
    console.log('# film sureleri: ' + seen.join(', ') + ' | toplam ' + s.movie_minutes);
  });
});

describe('v5.1 dizi stats period (E-30/E-31)', () => {
  test('devam: yalniz donemde kaydedilen ilerleme; bitti: bitis aninda tum bolumler sabit; all = konuma gore', async (t) => {
    const s = await admin.get('/api/catalog/search?type=series&q=Breaking%20Bad');
    const hit = s.json.items.find((i) => String(i.external_id) === '169');
    if (!hit) return t.skip('TVMaze yok');
    const cid = hit.id || (await admin.post('/api/catalog/pick', { key: hit.key })).json.item.id;
    const u = await ctx.mkUser('ds');
    const e = await u.c.post('/api/entries', { catalog_id: cid, type: 'series', status: 'devam', season: 1, episode: 2 });
    assert.equal(e.status, 201, e.text);
    let st = (await u.c.get(`/api/users/${u.id}/stats?type=series`)).json;
    assert.equal(st.episodes_watched, 2, 'all: konuma kadar');
    st = (await u.c.get(`/api/users/${u.id}/stats?type=series&period=month`)).json;
    assert.equal(st.episodes_watched, 0, 'kayit ACILIS konumu donemli sayima girmez');
    assert.equal((await u.c.post(`/api/entries/${e.json.entry.id}/series-progress`, { season: 1, episode: 6 })).status, 200);
    st = (await u.c.get(`/api/users/${u.id}/stats?type=series&period=month`)).json;
    assert.equal(st.episodes_watched, 4, 'ay: 2 -> 6 = 4 bolum'); assert.equal(st.series_minutes, 4 * 60);
    st = (await u.c.get(`/api/users/${u.id}/stats?type=series&period=year`)).json; assert.equal(st.episodes_watched, 4);
    st = (await u.c.get(`/api/users/${u.id}/stats?type=series`)).json; assert.equal(st.episodes_watched, 6);
    // sezon atlayarak ilerleme: S1B6 -> S2B3 = 1 (B7) + 3 = 4 bolum
    assert.equal((await u.c.post(`/api/entries/${e.json.entry.id}/series-progress`, { season: 2, episode: 3 })).status, 200);
    st = (await u.c.get(`/api/users/${u.id}/stats?type=series&period=month`)).json; assert.equal(st.episodes_watched, 8);
    // bitti: tum bolumler (62), bitis tarihi bugun -> ay/yil/all hepsinde 62; devam eden eski kayit bu ay saymaz (bitti oldugu icin tek kayit)
    assert.equal((await u.c.patch(`/api/entries/${e.json.entry.id}`, { status: 'bitti' })).status, 200);
    for (const p of ['all', 'month', 'year']) {
      st = (await u.c.get(`/api/users/${u.id}/stats?type=series&period=${p}`)).json;
      assert.equal(st.episodes_watched, 62, p); assert.equal(st.series_minutes, 62 * 60, p); assert.equal(st.series_finished, 1, p);
    }
    // gecmis bitis tarihli bitti dizi: month 0, year/all tam
    const u2 = await ctx.mkUser('ds2');
    const x = await u2.c.post('/api/entries', { catalog_id: cid, type: 'series', status: 'bitti', end_date: istDay(200) });
    assert.equal(x.status, 201, x.text);
    st = (await u2.c.get(`/api/users/${u2.id}/stats?type=series&period=month`)).json; assert.equal(st.episodes_watched, 0);
    st = (await u2.c.get(`/api/users/${u2.id}/stats?type=series&period=all`)).json; assert.equal(st.episodes_watched, 62);
  });
});
