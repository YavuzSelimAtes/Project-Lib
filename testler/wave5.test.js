// 5. dalga: gecmis tarihli girisler Gundem'e dusuer (data.past), Bugun tablosunda gun secimi. Temiz backend: node testler/start-backend.js --fresh
const { DatabaseSync } = require('node:sqlite');
const B = 'http://localhost:4100';
const mk = () => { let ck = ''; return async (m, p, body) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', cookie: ck }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0];
  return { s: r.status, j: await r.json().catch(() => null) };
}; };
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log(ok ? 'OK  ' : 'FAIL', n, ok ? '' : JSON.stringify(x)); };
const acc = (u) => ({ username: u, display_name: u, password: 'secret1', avatar: '🦊' });
const shift = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
(async () => {
  const a = mk(), b = mk();
  for (const [u, n] of [[a, 'w5a'], [b, 'w5b']]) await u('POST', '/api/auth/register', acc(n));
  let r = await a('POST', '/api/groups', { name: 'W5' }); const gid = r.j.group.id;
  const db = new DatabaseSync(require('node:path').join(__dirname, 'data', 'test.db')); db.exec('PRAGMA busy_timeout=5000');
  await b('POST', `/api/join/${db.prepare('SELECT invite_token t FROM groups WHERE id=?').get(gid).t}`, {});
  r = await a('GET', `/api/today?group=${gid}`); const today = r.j.today;
  t('today alani', /^\d{4}-\d{2}-\d{2}$/.test(today) && r.j.date === today, r.j);
  const cat = Number(db.prepare("INSERT INTO catalog (type,title,pages,norm,created_at) VALUES ('book','W5 Kitap',600,'w5 kitap',?)").run(new Date().toISOString()).lastInsertRowid);
  r = await a('POST', '/api/entries', { catalog_id: cat, status: 'devam', total_pages: 600, start_date: shift(today, -12) }); const eid = r.j.entry.id;
  const card = async () => (await b('GET', `/api/gundem?group=${gid}`)).j.posts.filter((p) => p.kind === 'read');

  // 1) dune sayfa girildi -> kart olusur, data.past[dun]
  const y = shift(today, -1);
  r = await a('POST', `/api/entries/${eid}/progress`, { current_page: 20, date: y }); t('dunku giris 200', r.s === 200, r);
  let rd = await card();
  t('dunku giris gundemde: past[dun]=20, bugun alani yok', rd.length === 1 && rd[0].data.past?.[y] === 20 && !rd[0].data.last, rd);

  // 2) bugun de okundu -> ayni kart, bugunku alanlar + gecmis korunur
  await a('POST', `/api/entries/${eid}/progress`, { current_page: 30 });
  rd = await card();
  t('bugun eklenince ayni kart: last 10, past korundu', rd.length === 1 && rd[0].data.last === 10 && rd[0].data.total === 10 && rd[0].data.times === 1 && rd[0].data.past?.[y] === 20, rd);

  // 3) ayni gune tekrar -> toplanir
  await a('POST', `/api/entries/${eid}/progress`, { current_page: 35, date: y });
  rd = await card(); t('ayni gecmis gun toplanir (25)', rd[0].data.past[y] === 25 && rd.length === 1, rd[0].data);

  // 4) gun gun giris (3 gun) -> tek kartta uc tarih
  const d3 = [shift(today, -4), shift(today, -3), shift(today, -2)];
  r = await a('PUT', `/api/entries/${eid}/day-logs`, { days: [{ date: d3[0], pages: 5 }, { date: d3[1], pages: 6 }, { date: d3[2], pages: 7 }] }); t('day-logs 200', r.s === 200, r);
  rd = await card();
  t('uc gun tek kartta', rd.length === 1 && d3.every((d, i) => rd[0].data.past[d] === [5, 6, 7][i]), rd[0].data);

  // 5) azaltma / degisiklik yok kart sayisini bozmaz, sifir girisle past artmaz
  r = await a('PUT', `/api/entries/${eid}/day-logs`, { days: [{ date: d3[0], pages: 2 }] });
  rd = await card(); t('azaltma gundemi sismirmez', rd[0].data.past[d3[0]] === 5, rd[0].data);

  // 6) ikinci kitap: dunku giris (baska kart), kart girisin yapildigi anda en ustte
  const cat2 = Number(db.prepare("INSERT INTO catalog (type,title,pages,norm,created_at) VALUES ('book','W5 Iki',300,'w5 iki',?)").run(new Date().toISOString()).lastInsertRowid);
  r = await a('POST', '/api/entries', { catalog_id: cat2, status: 'devam', total_pages: 300, start_date: shift(today, -9) }); const e2 = r.j.entry.id;
  r = await a('POST', `/api/entries/${e2}/progress`, { current_page: 40, date: y }); t('ikinci kitap dunku giris', r.s === 200, r);
  r = await b('GET', `/api/gundem?group=${gid}`); const c2 = r.j.posts.find((p) => p.kind === 'read' && p.entry_id === e2);
  t('ikinci kitap ayri kart', c2?.data.past?.[y] === 40, r.j.posts.map((p) => [p.kind, p.entry_id, p.data]));

  // 7) kart girisin yapildigi anda en ustte
  r = await b('GET', `/api/gundem?group=${gid}`); t('en ustte son giris karti', r.j.posts[0].entry_id === e2, r.j.posts[0]);

  // 8) toplu (4+ gun) -> past 5 tarih; gundem ham veri
  const many = [-11, -10, -9, -8, -7].map((n) => shift(today, n));
  r = await a('PUT', `/api/entries/${eid}/day-logs`, { days: many.map((date) => ({ date, pages: 3 })) }); t('5 gunluk toplu giris', r.s === 200, r);
  rd = await card(); t('toplu giris past 9 tarih', Object.keys(rd[0].data.past).length === 9, rd[0].data);

  // 9) Bugun tablosu: gecmis gun
  r = await b('GET', `/api/today?group=${gid}&date=${y}`);
  const ra = r.j.rows.find((x) => x.user.display_name === 'w5a');
  t('?date=dun: tarih ve satir', r.s === 200 && r.j.date === y && r.j.today === today && ra && ra.pages >= 25, r.j);
  r = await b('GET', `/api/today?group=${gid}&date=${today}`); t('?date=bugun: bugun gibi', r.j.date === today && r.j.rows.some((x) => x.pages === 10), r.j);
  r = await b('GET', `/api/today?group=${gid}&date=${shift(today, 1)}`); t('gelecek tarih 400', r.s === 400, r);
  r = await b('GET', `/api/today?group=${gid}&date=abc`); t('bozuk tarih 400', r.s === 400, r);
  r = await b('GET', `/api/today?group=${gid}&date=${shift(today, -300)}`); t('cok eski gun bos satir', r.s === 200 && r.j.rows.length === 0, r);
  console.log(fail ? `FAIL=${fail}` : 'fail=0'); process.exit(fail ? 1 : 0);
})();
