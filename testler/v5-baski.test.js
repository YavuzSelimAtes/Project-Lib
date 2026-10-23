// v5 madde 2: dil / yayinevi / baski (edition). GERCEK backend (4100) gerekir. Dis internet gerektirmez (admin ile baski eklenir).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, Client, daysAgo, RUN } = require('./lib/v5h');
const ctx = setup();
const { mkUser } = ctx;
let admin;

describe('v5-2 baski/dil', () => {
  let cat, ed300, ed100, edNull, edEn;
  before(async () => {
    await ctx.before(); admin = ctx.admin;
    const r = await admin.post('/api/admin/catalog', { type: 'book', title: `V5 Baski Kitabi ${RUN}`, author_or_creator: 'Test Yazar', pages: 250, year: 2000 });
    assert.equal(r.status, 201, r.text);
    cat = r.json.item.id;
    const mk = async (b) => { const x = await admin.post(`/api/admin/catalog/${cat}/editions`, b); assert.equal(x.status, 201, x.text); return x.json.edition; };
    ed300 = await mk({ language: 'tr', publisher: 'Test Yayinlari', pages: 300, year: 2015 });
    ed100 = await mk({ language: 'tr', publisher: 'Mini Yayinevi', pages: 100 });
    edNull = await mk({ language: 'tr', publisher: 'Sayfasiz Yayin' });
    edEn = await mk({ language: 'en', publisher: 'English House', pages: 450 });
  });
  after(() => ctx.after());

  test('admin baski ekle: dogrulama, yetki, tekrar 409', async () => {
    const u = await mkUser('edm');
    assert.equal((await u.c.post(`/api/admin/catalog/${cat}/editions`, { language: 'tr', pages: 5 })).status, 403);
    assert.equal((await new Client().post(`/api/admin/catalog/${cat}/editions`, { language: 'tr', pages: 5 })).status, 401);
    for (const bad of [{}, { pages: 'abc' }, { pages: -5 }, { pages: 0 }, { pages: 1.5 }, { pages: 10000000 }, { language: 'turkce-cok-uzun', pages: 5 }, { language: 'tr', pages: 5, cover_url: 'file:///etc/passwd' }, { language: 'tr', pages: 5, year: 99999 }]) {
      const r = await admin.post(`/api/admin/catalog/${cat}/editions`, bad);
      assert.equal(r.status, 400, `${JSON.stringify(bad)} -> ${r.status} ${r.text}`);
    }
    assert.equal((await admin.post(`/api/admin/catalog/${cat}/editions`, { language: 'tr', publisher: 'Test Yayinlari', pages: 300 })).status, 409);
    assert.equal((await admin.post('/api/admin/catalog/9999999/editions', { language: 'tr', pages: 5 })).status, 404);
    // film katalogu icin baski eklenemez
    const m = await admin.post('/api/admin/catalog', { type: 'movie', title: `V5 Film ${RUN}`, author_or_creator: 'Y', year: 2000 });
    assert.equal(m.status, 201);
    assert.equal((await admin.post(`/api/admin/catalog/${m.json.item.id}/editions`, { language: 'tr', pages: 5 })).status, 400);
    assert.equal((await admin.get(`/api/catalog/${m.json.item.id}/editions`)).status, 400);
  });

  test('GET /catalog/:id + /editions?lang= : dil filtresi, gruplar, languages filtreden bagimsiz', async () => {
    const u = await mkUser('edl');
    let r = await u.c.get(`/api/catalog/${cat}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.item.editions.length, 4); assert.equal(r.json.editions.length, 4);
    r = await u.c.get(`/api/catalog/${cat}/editions?lang=tr`);
    assert.equal(r.status, 200);
    assert.ok(r.json.editions.length >= 3 && r.json.editions.every((e) => e.language === 'tr'), 'yalniz tr');
    assert.ok(r.json.languages.find((l) => l.language === 'en'), 'languages filtreden bagimsiz olmali');
    const pages = r.json.editions.map((e) => e.pages);
    const firstNull = pages.indexOf(null);
    assert.ok(firstNull === -1 || pages.slice(firstNull).every((p) => p == null), 'sayfasi bos baski sona: ' + pages);
    r = await u.c.get(`/api/catalog/${cat}/editions?lang=en`);
    assert.ok(r.json.editions.every((e) => e.language === 'en') && r.json.editions.length >= 1);
    r = await u.c.get(`/api/catalog/${cat}/editions?lang=zz`);
    assert.equal(r.status, 200); assert.equal(r.json.editions.length, 0);
    assert.equal((await u.c.get(`/api/catalog/${cat}/editions?lang=turkish-lang`)).status, 400);
    assert.notEqual((await u.c.get(`/api/catalog/${cat}/editions?lang=%27%3BDROP`)).status, 500);
    assert.equal((await new Client().get(`/api/catalog/${cat}/editions`)).status, 401);
    assert.equal((await u.c.get('/api/catalog/99999999/editions')).status, 404);
  });

  test('entry ekle: baski -> total_pages baskidan; istekteki total_pages kazanir; sayfasiz baski -> null', async () => {
    const u = await mkUser('edn');
    let r = await u.c.post('/api/entries', { catalog_id: cat, type: 'book', status: 'devam', edition_id: ed300.id });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.entry.total_pages, 300); assert.equal(r.json.entry.edition_id, ed300.id);
    assert.equal(r.json.entry.edition.pages, 300); assert.equal(r.json.entry.edition.language, 'tr');
    await u.c.del(`/api/entries/${r.json.entry.id}`);
    r = await u.c.post('/api/entries', { catalog_id: cat, type: 'book', status: 'devam', edition_id: ed300.id, total_pages: 280 });
    assert.equal(r.status, 201); assert.equal(r.json.entry.total_pages, 280);
    await u.c.del(`/api/entries/${r.json.entry.id}`);
    r = await u.c.post('/api/entries', { catalog_id: cat, type: 'book', status: 'devam', edition_id: edNull.id });
    assert.equal(r.status, 201); assert.equal(r.json.entry.total_pages, null, 'sayfasiz baskida katalog sayfasi (250) varsayilmamali');
    await u.c.del(`/api/entries/${r.json.entry.id}`);
    r = await u.c.post('/api/entries', { catalog_id: cat, type: 'book', status: 'devam' });
    assert.equal(r.status, 201); assert.equal(r.json.entry.total_pages, 250); assert.equal(r.json.entry.edition, null);
  });

  test('entry ekle: baska eserin baskisi / olmayan / tip hatali edition_id -> 400; film kaydina baski -> 400', async () => {
    const u = await mkUser('edx');
    const other = await admin.post('/api/admin/catalog', { type: 'book', title: `V5 Diger ${RUN}`, author_or_creator: 'Z', pages: 99 });
    const oe = await admin.post(`/api/admin/catalog/${other.json.item.id}/editions`, { language: 'tr', publisher: 'Baska', pages: 77 });
    assert.equal(oe.status, 201);
    for (const bad of [oe.json.edition.id, 99999999, 'abc', 1.5, -1, [1], {}]) {
      const r = await u.c.post('/api/entries', { catalog_id: cat, type: 'book', status: 'devam', edition_id: bad });
      assert.equal(r.status, 400, `edition_id=${JSON.stringify(bad)} -> ${r.status} ${r.text}`);
    }
    const m = await admin.post('/api/admin/catalog', { type: 'movie', title: `V5 Film2 ${RUN}`, author_or_creator: 'Y', year: 2001 });
    const r = await u.c.post('/api/entries', { catalog_id: m.json.item.id, type: 'movie', status: 'bitti', edition_id: ed300.id });
    assert.equal(r.status, 400, 'film + edition_id: ' + r.text);
  });

  test('baski degistirme: sayfa < current_page -> 400 (degisiklik yok); yeterliyse total_pages guncellenir; null baglantiyi kaldirir', async () => {
    const u = await mkUser('edc');
    let r = await u.c.post('/api/entries', { catalog_id: cat, type: 'book', status: 'devam', edition_id: ed300.id, start_date: daysAgo(3) });
    const id = r.json.entry.id;
    r = await u.c.post(`/api/entries/${id}/progress`, { current_page: 150 });
    assert.equal(r.status, 200, r.text);
    r = await u.c.patch(`/api/entries/${id}`, { edition_id: ed100.id });
    assert.equal(r.status, 400); assert.match(r.json.error, /100 sayfa.*150/);
    let e = (await u.c.get(`/api/entries/${id}`)).json.entry;
    assert.equal(e.edition_id, ed300.id); assert.equal(e.total_pages, 300); assert.equal(e.current_page, 150);
    r = await u.c.post(`/api/entries/${id}/progress`, { current_page: 100, confirm: true });
    assert.equal(r.status, 200, r.text);
    r = await u.c.patch(`/api/entries/${id}`, { edition_id: ed100.id });
    assert.equal(r.status, 200, r.text); assert.equal(r.json.entry.total_pages, 100);
    r = await u.c.patch(`/api/entries/${id}`, { edition_id: edEn.id, total_pages: 460 });
    assert.equal(r.status, 200); assert.equal(r.json.entry.total_pages, 460);
    r = await u.c.patch(`/api/entries/${id}`, { edition_id: edNull.id });
    assert.equal(r.status, 200); assert.equal(r.json.entry.total_pages, 460);
    r = await u.c.patch(`/api/entries/${id}`, { edition_id: null });
    assert.equal(r.status, 200); assert.equal(r.json.entry.edition_id, null); assert.equal(r.json.entry.edition, null);
    e = (await u.c.get(`/api/entries/${id}`)).json.entry; assert.equal(e.current_page, 100);
  });

  test('biten kitapta baski degisimi: %100 kalir', async () => {
    const u = await mkUser('edf');
    let r = await u.c.post('/api/entries', { catalog_id: cat, type: 'book', status: 'bitti', start_date: daysAgo(5), end_date: daysAgo(2), edition_id: ed300.id });
    assert.equal(r.status, 201, r.text);
    const id = r.json.entry.id;
    r = await u.c.patch(`/api/entries/${id}`, { edition_id: edEn.id });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.entry.status, 'bitti'); assert.equal(r.json.entry.total_pages, 450);
    assert.equal(r.json.entry.current_page, 450);
  });

  test('IDOR: baskasinin kaydinin edition_id degistirilemez; anonim 401; olmayan kayit 404', async () => {
    const a = await mkUser('ida'), b = await mkUser('idb');
    const r = await a.c.post('/api/entries', { catalog_id: cat, type: 'book', status: 'devam', edition_id: ed300.id });
    const id = r.json.entry.id;
    const x = await b.c.patch(`/api/entries/${id}`, { edition_id: edEn.id });
    assert.ok([403, 404].includes(x.status), 'IDOR ' + x.status);
    const y0 = await b.c.patch(`/api/entries/${id}`, { edition_id: null });
    assert.ok([403, 404].includes(y0.status), 'IDOR null ' + y0.status);
    assert.equal((await a.c.get(`/api/entries/${id}`)).json.entry.edition_id, ed300.id);
    assert.equal((await new Client().patch(`/api/entries/${id}`, { edition_id: edEn.id })).status, 401);
    assert.equal((await a.c.patch('/api/entries/99999999', { edition_id: edEn.id })).status, 404);
    const y = await b.c.post('/api/entries', { catalog_id: cat, type: 'book', status: 'devam', user_id: a.id, edition_id: ed300.id });
    assert.equal(y.status, 201); assert.equal(y.json.entry.user_id, b.id);
  });

  test('admin baski sil: bagli kayitlar edition_id=null, total_pages korunur; uye silemez', async () => {
    const u = await mkUser('edd');
    const ne = await admin.post(`/api/admin/catalog/${cat}/editions`, { language: 'de', publisher: 'Silinecek', pages: 222 });
    const eid = ne.json.edition.id;
    const r = await u.c.post('/api/entries', { catalog_id: cat, type: 'book', status: 'devam', edition_id: eid });
    assert.equal(r.json.entry.total_pages, 222);
    assert.equal((await u.c.del(`/api/admin/editions/${eid}`)).status, 403);
    const d = await admin.del(`/api/admin/editions/${eid}`);
    assert.equal(d.status, 200, d.text); assert.equal(d.json.detached_entries, 1);
    const e = (await u.c.get(`/api/entries/${r.json.entry.id}`)).json.entry;
    assert.equal(e.edition_id, null); assert.equal(e.total_pages, 222);
    assert.equal((await admin.del(`/api/admin/editions/${eid}`)).status, 404);
    assert.ok((await admin.del('/api/admin/editions/abc')).status >= 400);
  });

  test('feed ve raf: edition ozeti gelir', async () => {
    const u = await mkUser('edf2');
    const r = await u.c.post('/api/entries', { catalog_id: cat, type: 'book', status: 'devam', edition_id: ed300.id, start_date: daysAgo(1) });
    await u.c.post(`/api/entries/${r.json.entry.id}/progress`, { current_page: 20 });
    const feed = (await u.c.get('/api/feed')).json;
    const card = feed.cards.find((c) => c.user.id === u.id);
    assert.ok(card, 'kart yok');
    const it = card.items.find((i) => i.catalog_id === cat || i.catalog?.id === cat);
    assert.ok(it && it.edition && it.edition.id === ed300.id && it.edition.pages === 300, 'feed item.edition: ' + JSON.stringify(it));
    const shelf = (await u.c.get(`/api/entries?user_id=${u.id}`)).json;
    const list = shelf.entries || shelf.items || shelf;
    assert.ok(list.some((e) => e.edition && e.edition.id === ed300.id), 'raf edition');
  });
});
