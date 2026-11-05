// 2. dalga: bildirim arsivi/susturma/bitirdi bildirimi, puan yorumu, raf duzeni, katalog yetkisi. Temiz backend: node testler/start-backend.js --fresh
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
(async () => {
  const a = mk(), b = mk();
  await a('POST', '/api/auth/register', acc('w2a')); await b('POST', '/api/auth/register', acc('w2b'));
  let r = await a('POST', '/api/groups', { name: 'W2' }); const gid = r.j.group.id;
  const db = new DatabaseSync(require('node:path').join(__dirname, 'data', 'test.db'));
  db.exec('PRAGMA busy_timeout=5000');
  const tok = db.prepare('SELECT invite_token t FROM groups WHERE id=?').get(gid).t;
  r = await b('POST', `/api/join/${tok}`, {}); t('katilim', r.s === 200, r);
  const cat = Number(db.prepare("INSERT INTO catalog (type,title,pages,norm,created_at) VALUES ('book','W2 Kitap',100,'w2 kitap',?)").run(new Date().toISOString()).lastInsertRowid);
  // a kitabi bitirir -> b'ye 'finished' bildirimi
  r = await a('POST', '/api/entries', { catalog_id: cat, status: 'bitti', end_date: new Date().toISOString().slice(0, 10) }); t('kayit bitti', r.s === 201, r); const eid = r.j.entry.id;
  r = await b('GET', '/api/notifications'); const n = r.j.notifications.find((x) => x.kind === 'finished');
  t('bitirdi bildirimi + link + grup', !!n && n.link?.type === 'entry' && n.link.id === eid && n.group_id === gid, r.j);
  // susturma
  r = await b('PUT', `/api/notifications/groups/${gid}`, { muted: true }); t('sustur', r.s === 200, r);
  r = await b('GET', '/api/notifications/settings'); t('ayar listesi', r.j.groups.find((g) => g.id === gid)?.muted === true, r);
  const before = (await b('GET', '/api/notifications')).j.notifications.length;
  r = await a('POST', '/api/entries', { catalog_id: cat + 0, status: 'bitti' }); // ayni kitap 2. kayit olmayabilir; asil kontrol tebrik/yorum
  r = await b('POST', `/api/entries/${eid}/comments`, { body: 'guzel' }); // b yorumu; a'ya gitmeli (a susturmadi)
  r = await a('GET', '/api/notifications'); t('yorum bildirimi a\'ya gitti', r.j.notifications.some((x) => x.kind === 'comment' && x.link?.id === eid), r.j);
  r = await a('POST', `/api/entries/${eid}/comments`, { body: 'tesekkur' }); // a yorumu; b susturdu -> gitmemeli
  const after = (await b('GET', '/api/notifications')).j.notifications.length;
  t('susturulan grupta bildirim gelmez', after === before, { before, after });
  await b('PUT', `/api/notifications/groups/${gid}`, { muted: false });
  // arsiv: 6 gun onceki bildirim
  db.prepare("UPDATE notifications SET created_at=? WHERE kind='finished'").run(new Date(Date.now() - 6 * 86400000).toISOString());
  r = await b('GET', '/api/notifications'); t('5 gunden eski aktif listede yok', !r.j.notifications.some((x) => x.kind === 'finished'), r.j);
  r = await b('GET', '/api/notifications?archived=1&q=bitir'); t('arsivde aranir', r.j.notifications.some((x) => x.kind === 'finished'), r.j);
  r = await b('GET', '/api/notifications?archived=1&q=zzzyok'); t('arsiv arama sonuc yok', r.j.notifications.length === 0, r.j);
  // tebrik: b a'yi tebrik eder, a kimlerden aldigini gorur; b detayda i_congratulated
  r = await b('POST', `/api/entries/${eid}/congrats`); t('tebrik', r.s === 200, r);
  r = await a('GET', `/api/entries/${eid}`); t('sahibi tebrik listesi', r.j.entry.congrats_from?.length === 1 && r.j.entry.congrats_from[0].display_name === 'w2b', r.j.entry);
  r = await b('GET', `/api/entries/${eid}`); t('tebrik eden detayda sent', r.j.entry.i_congratulated === true && !r.j.entry.congrats_from, r.j.entry);
  // puan + yorum
  r = await a('PUT', `/api/catalog/${cat}/ratings`, { genre: 'kurgu', scores: { senaryo: 5, akicilik: 4, karakterler: 3, dil: 4, duygu: 5 }, comments: { senaryo: 'cok iyi', dil: '' } }); t('puan+yorum', r.s === 200, r);
  r = await b('GET', `/api/catalog/${cat}/ratings`); const bu = r.j.by_user.find((u) => u.user.display_name === 'w2a');
  t('kisi bazli puan + yorum', bu && bu.scores.senaryo === 5 && bu.comments.senaryo === 'cok iyi' && !bu.comments.dil && r.j.by_metric.senaryo === 5, r.j);
  r = await a('PUT', `/api/catalog/${cat}/ratings`, { scores: { senaryo: 2, akicilik: 4, karakterler: 3, dil: 4, duygu: 5 } }); // yorum gonderilmedi -> korunur
  r = await a('GET', `/api/catalog/${cat}/ratings`); t('duzenleme: puan degisir, yorum korunur', r.j.mine.scores.senaryo === 2 && r.j.mine.comments.senaryo === 'cok iyi', r.j.mine);
  // raf duzeni
  r = await a('PUT', '/api/me/shelf', { frame: '#112233', order: [eid], books: { [eid]: { color: '#aa0000', style: 'foil' } } }); t('raf kaydi', r.s === 200, r);
  r = await a('PUT', '/api/me/shelf', { books: { [eid]: { style: 'x' } } }); t('gecersiz stil 400', r.s === 400, r);
  // katalog yetkisi
  r = await a('POST', '/api/admin/catalog', { type: 'book', title: 'X', pages: 10 }); t('uye katalog ekleyemez', r.s === 403, r);
  console.log(fail ? `FAIL=${fail}` : 'fail=0'); process.exit(fail ? 1 : 0);
})();
