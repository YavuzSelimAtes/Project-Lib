// v5 madde 3: aranan 5 kitap. GERCEK backend (4100) + canli Open Library (nazik: az istek, arada bekleme).
// Not: c/d/e kitaplari dis kaynaklarda yok; yalniz backend'in kurator listesi (seed-extra) ile bulunur.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, Client, sleep } = require('./lib/v5h');
const ctx = setup();
let u;

const norm = (s) => String(s || '').toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
async function search(q, extra = '') {
  const r = await u.c.get('/api/catalog/search?type=book&q=' + encodeURIComponent(q) + extra);
  assert.equal(r.status, 200, `${q}: ${r.status} ${r.text}`);
  await sleep(400);
  return r.json.items;
}
const find = (items, titleRe, authorRe) => items.findIndex((i) => titleRe.test(norm(i.title)) && (!authorRe || authorRe.test(norm(i.author_or_creator))));

describe('v5-3 aranan 5 kitap', () => {
  before(async () => { await ctx.before(); u = await ctx.mkUser('ar'); });
  after(() => ctx.after());

  const cases = [
    // [sorgu, baslik regex, yazar regex, tavan sira]
    ['Hayvanlardan Tanrilara / Yuval Noah', /^hayvanlardan tanrilara$/, /harari/, 0],
    ['Hayvanlardan Tanrilara', /^hayvanlardan tanrilara$/, /harari/, 0],
    ['hayvanlardan tanrilara harari', /^hayvanlardan tanrilara$/, /harari/, 0],
    ['Hayvanlardan Tanrılara - Yuval Noah Harari', /^hayvanlardan tanrilara$/, /harari/, 0],
    ['Harari, Hayvanlardan Tanrilara', /^hayvanlardan tanrilara$/, /harari/, 0],
    ['Anna Karenina is bankasi', /^anna karenina$/, /tolstoy/, 0],
    ['Anna Karenina İş Bankası', /^anna karenina$/, /tolstoy/, 0],
    ['Dikkat Kaygan Zemin', /^dikkat kaygan zemin$/, /sakir/, 0],
    ['Dikkat Kaygan Zemin Kral Şakir', /^dikkat kaygan zemin$/, /sakir/, 0],
    ['Dunyayi Okuyan Cocuk', /^dunyayi okuyan cocuk$/, /arik/, 0],
    ['Dünyayı Okuyan Çocuk Mert Arık', /^dunyayi okuyan cocuk$/, /arik/, 0],
    ['Dunyayi Okuyan Cocuk Mert Arik', /^dunyayi okuyan cocuk$/, /arik/, 0],
    ['Hayta Anil Basili', /^hayta$/, /basili/, 0],
    ['Hayta - Anil Basili', /^hayta$/, /basili/, 0],
  ];
  for (const [q, tre, are, maxIdx] of cases) {
    test(`"${q}" sonuc listesinde ve ilk sirada`, async () => {
      const items = await search(q);
      const i = find(items, tre, are);
      assert.ok(i >= 0, `bulunamadi; sonuclar: ${items.slice(0, 5).map((x) => `${x.title} / ${x.author_or_creator}`).join(' | ')}`);
      assert.ok(i <= maxIdx, `sira ${i} (beklenen <= ${maxIdx})`);
      assert.ok(items[i].id, 'yerel kayit (id) olmali: kurator listesi/yerel katalog');
    });
  }

  test('yalniz "Hayta" gibi cok genel aramada kurator kaydi (Anil Basili) yine de listede', async () => {
    const items = await search('Hayta');
    assert.ok(find(items, /^hayta$/, /basili/) >= 0, 'Hayta (Anil Basili) yok: ' + items.slice(0, 5).map((x) => x.title + '/' + x.author_or_creator).join(' | '));
  });

  test('Turkce baski: Hayvanlardan Tanrilara icin /editions TR 412 sayfa; Anna Karenina icin Is Bankasi baskisi (1062 sayfa) gelir', async () => {
    const h = (await search('Hayvanlardan Tanrilara')).find((i) => /hayvanlardan tanrilara/.test(norm(i.title)));
    const eh = await u.c.get(`/api/catalog/${h.id}/editions?lang=tr`);
    assert.equal(eh.status, 200);
    assert.ok(eh.json.editions.some((e) => e.language === 'tr' && e.pages === 412), 'TR 412 sayfa baski yok: ' + JSON.stringify(eh.json.editions.map((e) => [e.publisher, e.pages])));
    const a = (await search('Anna Karenina is bankasi')).find((i) => i.id);
    const ea = await u.c.get(`/api/catalog/${a.id}/editions?lang=tr`);
    const ib = ea.json.editions.filter((e) => /bankas/i.test(norm(e.publisher || '')));
    assert.ok(ib.length >= 1, 'Is Bankasi baskisi yok');
    assert.ok(ib.some((e) => e.pages === 1062), 'Is Bankasi 1062 sayfa yok: ' + JSON.stringify(ib.map((e) => [e.publisher, e.pages])));
  });

  test('c/d/e: kitap eklenir, sayfa sayisi bilinmediginden total_pages null (uydurma sayfa yok)', async () => {
    for (const [q, re] of [['Dikkat Kaygan Zemin Kral Sakir', /dikkat kaygan/], ['Dunyayi Okuyan Cocuk Mert Arik', /dunyayi okuyan/], ['Hayta Anil Basili', /^hayta$/]]) {
      const it = (await search(q)).find((i) => i.id && re.test(norm(i.title)));
      assert.ok(it, q);
      const r = await u.c.post('/api/entries', { catalog_id: it.id, type: 'book', status: 'planlandi' });
      assert.equal(r.status, 201, r.text);
      assert.equal(r.json.entry.total_pages, null, `${q}: sayfa uydurulmus`);
      await u.c.del(`/api/entries/${r.json.entry.id}`);
    }
  });

  test('lang filtresi: lang=tr/en/gecersiz; "/" "-" tek basina 400; SQL/LIKE joker guvenli; uzun sorgu', async () => {
    const tr = await search('Sapiens Harari', '&lang=tr');
    const en = await search('Sapiens Harari', '&lang=en');
    for (const i of tr) if (i.languages?.length) assert.ok(i.languages.includes('tr'), `tr filtresi: ${i.title} ${i.languages}`);
    for (const i of en) if (i.languages?.length) assert.ok(i.languages.includes('en'), `en filtresi: ${i.title} ${i.languages}`);
    assert.equal((await u.c.get('/api/catalog/search?type=book&q=sapiens&lang=turkish')).status, 400);
    for (const q of ['/', ' / ', '-', ' ', '']) assert.equal((await u.c.get('/api/catalog/search?type=book&q=' + encodeURIComponent(q))).status, 400, JSON.stringify(q));
    for (const q of ["'; DROP TABLE catalog;--", '%%__', '\\', 'x'.repeat(600)]) {
      const r = await u.c.get('/api/catalog/search?type=book&q=' + encodeURIComponent(q));
      assert.ok([200, 400].includes(r.status), `${q.slice(0, 20)} -> ${r.status}`);
    }
    assert.equal((await u.c.get('/api/catalog/search?type=book&q=abc')).status, 200); // katalog hala ayakta
    assert.equal((await new Client().get('/api/catalog/search?type=book&q=abc')).status, 401);
  });
});
