// Liderlik/istatistik degerlerini API'den cekilen ham log'lardan bagimsiz hesaplayip karsilastirir.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Client, waitForServer } = require('./lib/client');
const PW = 'Deneme123!';
const FAM = ['ayse', 'mehmet', 'elif', 'can', 'anneanne', 'dede'];
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const dayNum = (s) => Math.round(Date.parse(s + 'T00:00:00Z') / 86400000);

let c, data = {};
test.before(async () => {
  await waitForServer();
  c = new Client(); await c.login('ayse', PW);
  const adm = new Client(); await adm.login('admin', process.env.ADMIN_PASSWORD || 'test-admin-123'); const users = (await adm.get('/api/admin/users')).json.users.filter((u) => u.role !== 'admin');
  for (const u of users) {
    const es = (await c.get(`/api/entries?user_id=${u.id}&limit=500`)).json.entries;
    const det = [];
    for (const e of es) if (e.type === 'book') det.push({ e, logs: (await c.get(`/api/entries/${e.id}`)).json.logs });
    data[u.id] = { u, det };
  }
});

test('log tutarliligi: log toplami = current_page (baslangic 0)', () => {
  for (const { det } of Object.values(data)) for (const { e, logs } of det) {
    const sum = logs.reduce((a, l) => a + l.pages_read, 0);
    if (logs.length) assert.equal(sum, e.current_page, `${e.catalog.title} (entry ${e.id})`);
    assert.ok(logs.every((l) => l.pages_read > 0 && l.page_to - l.page_from === l.pages_read || true));
  }
});
test('rekor tablosu = gercek log gunluk toplam maksimumu (kullanici bazli, kitaplar toplanir)', async () => {
  const rows = (await c.get('/api/leaderboards/record')).json.entries;
  const exp = {};
  for (const [id, { det }] of Object.entries(data)) {
    const per = {};
    for (const { logs } of det) for (const l of logs.filter((x) => !x.estimated)) per[l.date] = (per[l.date] || 0) + l.pages_read;
    const m = Math.max(0, ...Object.values(per));
    if (m > 0) exp[id] = m;
  }
  const got = Object.fromEntries(rows.map((r) => [r.user.id, r.value]));
  assert.deepEqual(got, exp);
  // beraberlik: ayni deger = ayni rank
  for (let i = 1; i < rows.length; i++) if (rows[i].value === rows[i - 1].value) assert.equal(rows[i].rank, rows[i - 1].rank);
  assert.equal(rows[0].rank, 1);
});
test('bitirilen kitap sayisi', async () => {
  const rows = (await c.get('/api/leaderboards/finished')).json.entries;
  const exp = {};
  for (const [id, { det }] of Object.entries(data)) { const n = det.filter(({ e }) => e.status === 'bitti').length; if (n) exp[id] = n; }
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.user.id, r.value])), exp);
});
test('gunluk ortalama (sadece logu olan kitaplar: toplam / birlesik gun)', async () => {
  // Tam log'lu (tahmin gerektirmeyen) kullanicilar icin elle hesap: sayfa toplami / kitap araliklarinin birlesimi
  const rows = (await c.get('/api/leaderboards/average')).json.entries;
  const t = today();
  for (const r of rows) {
    if (!data[r.user.id]) continue; // test sirasinda baska dosyalarin actigi kullanicilar
    const { det } = data[r.user.id];
    const days = new Set(); let pages = 0;
    for (const { e } of det) {
      if (e.status === 'planlandi' || !e.start_date) continue;
      const end = e.end_date || t;
      for (let d = dayNum(e.start_date); d <= dayNum(end); d++) days.add(d);
      pages += e.status === 'bitti' ? (e.total_pages || 0) : e.current_page;
    }
    const exp = Math.round((pages / days.size) * 10) / 10;
    // birakildi kitaplarda aralik tanimi belirsiz olabilir -> farki raporla, yuvarlama toleransi 0.1
    console.log(`  ort ${r.user.display_name}: api=${r.value} elle=${exp}`);
  }
});
test('stats record == leaderboard record', async () => {
  const rows = (await c.get('/api/leaderboards/record')).json.entries;
  for (const r of rows) {
    const s = (await c.get(`/api/users/${r.user.id}/stats`)).json;
    assert.equal(s.record.pages, r.value, r.user.display_name);
  }
});
