// Gundem (posts) ve takvim (reading_logs) ayni gune ayni sayfayi yazmali; current_page = base_page + toplam log.
// Calisan test backend'i gerekir (node testler/start-backend.js --fresh)
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const B = 'http://localhost:4100';
const mk = () => { let ck = ''; return async (m, p, body) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', cookie: ck }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0];
  return { s: r.status, j: await r.json().catch(() => null) };
}; };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return ymd(d); };
let seed = Number(process.env.SEED || 1);
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 12) % n; };
let fail = 0;
(async () => {
  const dbr = new DatabaseSync(path.join(__dirname, 'data', 'test.db'), { readOnly: true });
  const adm = mk();
  await adm('POST', '/api/auth/login', { username: 'admin', password: 'test-admin-123' });
  const u = mk();
  await u('POST', '/api/auth/register', { username: 'fz' + (Date.now() % 100000), display_name: 'fz', password: 'secret1', avatar: '🦊' });
  const RUNS = Number(process.env.RUNS || 40);
  for (let run = 0; run < RUNS; run++) {
    const cat = (await adm('POST', '/api/admin/catalog', { type: 'book', title: 'Fuzz ' + run + Date.now(), pages: 900 })).j.item.id;
    const startAgo = 4 + rnd(6);
    const pre = rnd(3) === 0 ? 0 : 1 + rnd(120); // sonradan eklenen kitap: baslangic sayfasi
    const body = { catalog_id: cat, status: 'devam', start_date: daysAgo(startAgo), current_page: pre };
    if (pre > 0) body.backfill = 'manual';
    const e = await u('POST', '/api/entries', body);
    if (e.s !== 201) { console.log('FAIL create', e); fail++; continue; }
    const id = e.j.entry.id;
    const ops = [];
    for (let k = 0; k < 12; k++) {
      const date = daysAgo(rnd(startAgo + 1));
      const kind = rnd(4);
      let r;
      if (kind === 0) { const n = 1 + rnd(40); ops.push(`ekle ${date} +${n}`); r = await u('PUT', `/api/entries/${id}/day-logs`, { days: [{ date, pages: n }], add: true }); }
      else if (kind === 1) { const cur = (await u('GET', `/api/entries/${id}`)).j.entry.current_page; const n = Math.min(899, cur + 1 + rnd(30)); ops.push(`sayfa ${n} @${date}`); r = await u('POST', `/api/entries/${id}/progress`, { current_page: n, date }); }
      else if (kind === 2) { const n = rnd(40); ops.push(`duzelt ${date} =${n}`); r = await u('PUT', `/api/entries/${id}/day-logs`, { days: [{ date, pages: n }], keep_current: true }); }
      else { const cur = (await u('GET', `/api/entries/${id}`)).j.entry.current_page; const n = Math.max(1, cur - 1 - rnd(15)); ops.push(`geri ${n} @${date}`); r = await u('POST', `/api/entries/${id}/progress`, { current_page: n, date, confirm: true }); }

      // her adimdan sonra degismezler
      const en = dbr.prepare('SELECT * FROM entries WHERE id=?').get(id);
      const sum = dbr.prepare('SELECT COALESCE(SUM(pages_read),0) s FROM reading_logs WHERE entry_id=?').get(id).s;
      const logs = new Map(dbr.prepare('SELECT date, SUM(pages_read) p FROM reading_logs WHERE entry_id=? GROUP BY date').all(id).map((x) => [x.date, x.p]));
      const posts = new Map();
      const today = daysAgo(0);
      for (const p of dbr.prepare("SELECT day,data FROM posts WHERE entry_id=? AND kind='read'").all(id)) {
        const d = JSON.parse(p.data || '{}');
        if (d.total) posts.set(p.day, (posts.get(p.day) || 0) + d.total);
        for (const [dt, n] of Object.entries(d.past || {})) posts.set(dt, (posts.get(dt) || 0) + n);
      }
      const problems = [];
      if (en.current_page !== (en.base_page || 0) + sum) problems.push(`current ${en.current_page} != base ${en.base_page}+logs ${sum}`);
      for (const dt of new Set([...logs.keys(), ...posts.keys()])) {
        const l = Math.max(0, logs.get(dt) || 0), p = posts.get(dt) || 0;
        if (l !== p) problems.push(`${dt}: log ${l} gundem ${p}`);
      }
      if (problems.length) { fail++; console.log(`FAIL run${run} (pre=${pre}, start=${startAgo}g once, ${body.backfill || '-'})\n   adimlar: ${ops.join(' | ')}\n   ${problems.join('; ')}`); break; }
    }
  }
  console.log('fail=' + fail);
  process.exit(fail ? 1 : 0);
})();
