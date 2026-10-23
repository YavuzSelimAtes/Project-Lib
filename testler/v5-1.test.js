// v5.1 duzeltme turu testleri (BACKEND yazdi): E-28/E-46 biten kitapta baski, E-33 yer tutucu baski, E-35 gorunen ad,
// E-36 gecmise dolgu seriyi sisirmez, E-30/E-31 dizi stats donem kurali, E-32 pick/listed, H-026 isi haritasi, film suresi birimleri.
// Dis kaynak (TVMaze/Open Library) cevap vermezse ilgili test t.skip ile atlanir.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setup, istDay, sleep } = require('./lib/v5h');
const ctx = setup();
let admin;
const uniq = () => Math.random().toString(36).slice(2, 8);
const book = async (pages = 700) => (await admin.post('/api/admin/catalog', { type: 'book', title: 'V51-' + uniq(), pages })).json.item;

describe('v5.1', () => {
  before(async () => { await ctx.before(); admin = ctx.admin; });
  after(() => ctx.after());

  test('E-35 gorunen ad: gorunmez/kontrol/< > REDDEDILIR, admin ayni kural, ayni ad hak yakmaz', async () => {
    const u = await ctx.mkUser('e35');
    for (const bad of ['​​', 'Ali​Veli', 'Ali‮Veli', 'Ali\u0007Veli', '﻿Ali', 'A<b>li', '3 > 2 ad', '<3 kitap']) {
      const r = await u.c.patch('/api/me/profile', { display_name: bad });
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
    assert.equal((await u.c.get('/api/auth/me')).json.user.name_changed, false, 'reddedilen istek hak harcamamali');
    // admin: ayni normalize (HTML iceren ad 400, bosluklar daralir, 30 karakter siniri)
    const mk = (n, name) => admin.post('/api/admin/users', { username: `v51${n}${ctx.RUN}`, display_name: name, password: 'Deneme123!' });
    assert.equal((await mk('a', 'Mehmet <b>Ali</b>')).status, 400);
    assert.equal((await mk('b', 'Z'.repeat(31))).status, 400);
    assert.equal((await mk('c', 'Ali​X')).status, 400);
    const ok = await mk('d', '  Mehmet   Ali  ');
    assert.equal(ok.status, 201, ok.text);
    ctx.created.push(ok.json.user.id);
    assert.equal(ok.json.user.display_name, 'Mehmet Ali');
    assert.equal((await admin.patch(`/api/admin/users/${ok.json.user.id}`, { display_name: 'Ali <i>x</i>' })).status, 400);
    // NFC: birlesik/ayrik "e" ayni ad sayilir (tek kayit bicimi)
    const r = await u.c.patch('/api/me/profile', { display_name: 'Café Ad' });
    assert.equal(r.status, 200); assert.equal(r.json.user.display_name, 'Café Ad');
    const same = await u.c.patch('/api/me/profile', { display_name: 'Café Ad', color: '#0a0b0c' });
    assert.equal(same.status, 200, 'ayni (normalize edilmis) ad hak yakmaz / 409 vermez');
  });

  test('E-28/E-46 biten kitapta kucuk baskiya gecis 200; gecmis istatistik oynamaz; devam edende kural kalir', async () => {
    const u = await ctx.mkUser('e28');
    const cat = await book(700);
    const ed412 = (await admin.post(`/api/admin/catalog/${cat.id}/editions`, { language: 'tr', publisher: 'Kucuk Yay', pages: 412 })).json.edition;
    const ed600 = (await admin.post(`/api/admin/catalog/${cat.id}/editions`, { language: 'en', publisher: 'Mid Pub', pages: 900 })).json.edition;
    const e = (await u.c.post('/api/entries', { catalog_id: cat.id, total_pages: 700, status: 'bitti', start_date: istDay(3), end_date: istDay(0) })).json.entry;
    const before = (await u.c.get(`/api/users/${u.id}/stats`)).json;
    const r = await u.c.patch(`/api/entries/${e.id}`, { edition_id: ed412.id });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.entry.status, 'bitti'); assert.equal(r.json.entry.total_pages, 412); assert.equal(r.json.entry.current_page, 412);
    assert.equal(r.json.entry.percent, 100);
    const after = (await u.c.get(`/api/users/${u.id}/stats`)).json;
    assert.equal(after.total_pages, before.total_pages, 'gecmis okunan sayfa degismemeli');
    assert.equal(after.avg_pages_per_day, before.avg_pages_per_day);
    // buyuk baskiya gecis de gecmisi sisirmez
    const r2 = await u.c.patch(`/api/entries/${e.id}`, { edition_id: ed600.id });
    assert.equal(r2.status, 200); assert.equal(r2.json.entry.total_pages, 900);
    assert.equal((await u.c.get(`/api/users/${u.id}/stats`)).json.total_pages, before.total_pages);
    // acik total_pages ile de (biten kitap): kucultulebilir
    assert.equal((await u.c.patch(`/api/entries/${e.id}`, { total_pages: 300 })).json.entry.current_page, 300);
    // devam eden kitapta eski kural
    const d = (await u.c.post('/api/entries', { catalog_id: (await book(700)).id, total_pages: 700 })).json.entry;
    await u.c.post(`/api/entries/${d.id}/progress`, { current_page: 500 });
    const cat2 = (await u.c.get(`/api/entries/${d.id}`)).json.entry.catalog_id;
    const small = (await admin.post(`/api/admin/catalog/${cat2}/editions`, { language: 'tr', publisher: 'K', pages: 412 })).json.edition;
    assert.equal((await u.c.patch(`/api/entries/${d.id}`, { edition_id: small.id })).status, 400);
  });

  test('E-33 gercek baski eklenince bos yer tutucu silinir, kayitlar yeni baskiya baglanir; bos kart sona', async () => {
    const u = await ctx.mkUser('e33');
    const cat = await book(null);
    const ph = (await admin.post(`/api/admin/catalog/${cat.id}/editions`, { language: 'tr' })).json.edition;
    const en = (await admin.post(`/api/admin/catalog/${cat.id}/editions`, { language: 'tr', publisher: 'Once', pages: 100 })).json.edition;
    // yer tutucu zaten Once eklenince silinmis olmali (ayni dil)
    let list = (await u.c.get(`/api/catalog/${cat.id}/editions`)).json;
    assert.ok(!list.editions.some((x) => x.id === ph.id), 'yer tutucu silinmeli');
    const cat2 = await book(null);
    const ph2 = (await admin.post(`/api/admin/catalog/${cat2.id}/editions`, { language: 'tr' })).json.edition;
    const ent = (await u.c.post('/api/entries', { catalog_id: cat2.id, edition_id: ph2.id, total_pages: 250 })).json.entry;
    const real = (await admin.post(`/api/admin/catalog/${cat2.id}/editions`, { language: 'tr', publisher: 'Gercek', pages: 250 })).json.edition;
    const got = (await u.c.get(`/api/entries/${ent.id}`)).json.entry;
    assert.equal(got.edition_id, real.id, 'kayit yeni baskiya baglanmali');
    assert.equal(got.total_pages, 250);
    list = (await u.c.get(`/api/catalog/${cat2.id}/editions`)).json;
    assert.deepEqual(list.editions.map((x) => x.id), [real.id]);
    assert.ok(en.id);
  });

  test('H-026 isi haritasi: ayni gunde gercek + tahmini -> pages gercek, estimated:false, estimated_pages ayri', async () => {
    const u = await ctx.mkUser('h26');
    const a = (await u.c.post('/api/entries', { catalog_id: (await book(900)).id, total_pages: 900, start_date: istDay(3) })).json.entry;
    const r = await u.c.put(`/api/entries/${a.id}/day-logs`, { days: [{ date: istDay(1), pages: 15 }] });
    assert.equal(r.status, 200, r.text);
    const b = await u.c.post('/api/entries', { catalog_id: (await book(900)).id, total_pages: 900, start_date: istDay(2), current_page: 10, backfill: 'spread' });
    assert.equal(b.status, 201, b.text);
    const hm = (await u.c.get(`/api/users/${u.id}/heatmap?days=10`)).json.days;
    const d = hm.find((x) => x.date === istDay(1));
    assert.equal(d.pages, 15); assert.equal(d.estimated, false); assert.equal(d.estimated_pages, 5);
    const only = hm.find((x) => x.date === istDay(2));
    assert.equal(only.estimated, true); assert.equal(only.pages, 5);
  });

  test('E-36 gecmise dolgu (backfill/day-logs, 7 gunden eski) seri ve rekora girmez, ortalamaya girer', async () => {
    const u = await ctx.mkUser('e36');
    const days = Array.from({ length: 30 }, (_, i) => ({ date: istDay(30 - i), pages: 1 }));
    const r = await u.c.post('/api/entries', { catalog_id: (await book(1000)).id, total_pages: 1000, start_date: istDay(30), current_page: 60, backfill: 'manual', days });
    assert.equal(r.status, 201, r.text);
    const st = (await u.c.get(`/api/users/${u.id}/stats`)).json;
    assert.ok(st.longest_streak >= 1 && st.longest_streak <= 8, 'seri sisirilmemeli: ' + st.longest_streak);
    assert.ok(st.record == null || st.record.pages <= 1, 'rekor kalan sayfalar yuzunden sismemeli: ' + JSON.stringify(st.record));
    assert.ok(st.total_pages >= 60, 'ortalama/toplam gecmisi sayar');
    // PUT day-logs ile 20 gun onceki gun de seriye girmez
    const e2 = (await u.c.post('/api/entries', { catalog_id: (await book(1000)).id, total_pages: 1000, start_date: istDay(25) })).json.entry;
    await u.c.put(`/api/entries/${e2.id}/day-logs`, { days: Array.from({ length: 10 }, (_, i) => ({ date: istDay(25 - i), pages: 5 })) });
    assert.ok((await u.c.get(`/api/users/${u.id}/stats`)).json.longest_streak <= 8);
  });

  test('film suresi: Wikidata P2047 birimleri dakikaya dogru cevrilir; makul olmayan (<20, >600) null', async () => {
    const m = await import(pathToFileURL(path.resolve(__dirname, '../backend/src/services/sources.js')).href);
    const ent = (amount, unit) => ({ claims: { P2047: [{ rank: 'normal', mainsnak: { datavalue: { value: { amount, unit: 'http://www.wikidata.org/entity/' + unit } } } }] } });
    assert.equal(m.wdRuntimeMinutes(ent('+148', 'Q7727')), 148);
    assert.equal(m.wdRuntimeMinutes(ent('+8880', 'Q11574')), 148);
    assert.equal(m.wdRuntimeMinutes(ent('+2.5', 'Q25235')), 150);
    assert.equal(m.wdRuntimeMinutes(ent('+11', 'Q7727')), null, '11 dk supheli');
    assert.equal(m.wdRuntimeMinutes(ent('+700', 'Q7727')), null, '700 dk supheli');
    assert.equal(m.wdRuntimeMinutes(ent('+148', 'Q577')), null, 'bilinmeyen birim');
    assert.equal(m.wdRuntimeMinutes({}), null);
  });

  describe('dizi (TVMaze)', () => {
    let catId = null;
    before(async () => {
      const s = await admin.get('/api/catalog/search?type=series&q=Breaking%20Bad');
      const hit = (s.json.items || []).find((i) => String(i.external_id) === '169' && i.source === 'tvmaze');
      if (!hit) return;
      if (hit.id) { catId = hit.id; return; }
      await sleep(300);
      const p = await admin.post('/api/catalog/pick', { key: hit.key });
      if (p.status < 300) catId = p.json.item.id;
    });
    test('E-30/E-31 donemli stats: devam eden dizide yalniz o donemde ilerleyen bolum; bitti bitis aninda tum bolumler', async (t) => {
      if (!catId) return t.skip('TVMaze erisilemedi');
      const seas = (await admin.get(`/api/catalog/${catId}/seasons`)).json;
      if (!seas.known) return t.skip('sezon bilgisi yok');
      const u = await ctx.mkUser('e30');
      const e = await u.c.post('/api/entries', { catalog_id: catId, season: 1, episode: 1 });
      assert.equal(e.status, 201, e.text);
      const eid = e.json.entry.id;
      const sp = await u.c.post(`/api/entries/${eid}/series-progress`, { season: 2, episode: 5 });
      assert.equal(sp.status, 200, sp.text);
      const s1 = seas.seasons[0].episodes;
      const all = (await u.c.get(`/api/users/${u.id}/stats?period=all`)).json;
      const month = (await u.c.get(`/api/users/${u.id}/stats?period=month`)).json;
      assert.equal(all.episodes_watched, s1 + 5);
      assert.equal(month.episodes_watched, s1 + 5 - 1, 'donemde yalniz ilerleyen bolum (kayit acilis konumu sayilmaz)');
      // bitti: tum bolumler, bitis aninda sabit
      const fin = await u.c.patch(`/api/entries/${eid}`, { status: 'bitti' });
      assert.equal(fin.status, 200, fin.text);
      const a2 = (await u.c.get(`/api/users/${u.id}/stats?period=all`)).json;
      const m2 = (await u.c.get(`/api/users/${u.id}/stats?period=month`)).json;
      assert.equal(a2.episodes_watched, seas.total_episodes);
      assert.equal(m2.episodes_watched, seas.total_episodes, 'bitis ayinda tum bolumler (sabit)');
    });
    test('seasons?refresh=1 calisir (200, known)', async (t) => {
      if (!catId) return t.skip('TVMaze erisilemedi');
      const r = await admin.get(`/api/catalog/${catId}/seasons?refresh=1`);
      assert.equal(r.status, 200, r.text); assert.equal(r.json.known, true);
    });
  });

  test('E-32 pick onizleme kaydi listed=0: admin listesinde/aramada gorunmez; kullanilinca kalici', async (t) => {
    const u = await ctx.mkUser('e32');
    const s = await u.c.get('/api/catalog/search?type=book&q=' + encodeURIComponent('Dune Frank Herbert'));
    const hit = (s.json.items || []).find((i) => i.key && !i.id);
    if (!hit) return t.skip('Open Library erisilemedi / sonuc yok');
    const p = await u.c.post('/api/catalog/pick', { key: hit.key });
    assert.equal(p.status, 201, p.text);
    const id = p.json.item.id;
    const q = encodeURIComponent(hit.title);
    const listed = (await admin.get(`/api/admin/catalog?type=book&q=${q}`)).json.items.map((x) => x.id);
    assert.ok(!listed.includes(id), 'pick kaydi varsayilan admin listesinde gorunmemeli');
    const all = (await admin.get(`/api/admin/catalog?type=book&q=${q}&unlisted=1`)).json.items.find((x) => x.id === id);
    assert.ok(all && all.listed === false);
    const en = await u.c.post('/api/entries', { catalog_id: id, total_pages: 400 });
    assert.equal(en.status, 201, en.text);
    const after = (await admin.get(`/api/admin/catalog?type=book&q=${q}`)).json.items.map((x) => x.id);
    assert.ok(after.includes(id), 'entry olusunca kalici (listed=1) olmali');
    assert.equal((await u.c.post('/api/catalog/pick', { key: 'yok-boyle-bir-anahtar' })).status, 404);
  });
});
