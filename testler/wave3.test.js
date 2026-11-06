// 3. dalga: hikaye yorum/yanit, Bugun listesi, dizi gun gun. Temiz backend: node testler/start-backend.js --fresh
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
  const a = mk(), b = mk(), c = mk();
  for (const [u, n] of [[a, 'w3a'], [b, 'w3b'], [c, 'w3c']]) await u('POST', '/api/auth/register', acc(n));
  let r = await a('POST', '/api/groups', { name: 'W3' }); const gid = r.j.group.id;
  const db = new DatabaseSync(require('node:path').join(__dirname, 'data', 'test.db')); db.exec('PRAGMA busy_timeout=5000');
  const tok = db.prepare('SELECT invite_token t FROM groups WHERE id=?').get(gid).t;
  await b('POST', `/api/join/${tok}`, {});
  const aid = (await a('GET', '/api/auth/me')).j.user.id;
  db.prepare('UPDATE users SET story_author=1 WHERE id=?').run(aid);
  // ---- hikaye yorum
  r = await a('POST', '/api/stories', { title: 'W3 Hikaye', group_ids: [gid] }); t('hikaye', r.s === 201, r); const sid = r.j.story?.id || r.j.id;
  if (!db.prepare('SELECT 1 FROM story_groups WHERE story_id=?').get(sid)) db.prepare('INSERT INTO story_groups (story_id,group_id) VALUES (?,?)').run(sid, gid);
  r = await b('POST', `/api/stories/${sid}/comments`, { body: 'guzel hikaye' }); t('uye yorum yazar', r.s === 201, r); const c1 = r.j.comment.id;
  r = await c('POST', `/api/stories/${sid}/comments`, { body: 'x' }); t('grupsuz yorum yazamaz 404', r.s === 404, r);
  r = await a('GET', '/api/notifications'); t('yazara yorum bildirimi + hikaye linki', r.j.notifications.some((n) => n.kind === 'story_comment' && n.link?.type === 'story' && n.link.id === sid), r.j);
  r = await a('POST', `/api/stories/${sid}/comments`, { body: 'tesekkurler', parent_id: c1 }); t('yazar yanitlar', r.s === 201 && r.j.comment.parent_id === c1, r); const c2 = r.j.comment.id;
  r = await b('GET', '/api/notifications'); t('yorum sahibine yanit bildirimi', r.j.notifications.some((n) => n.kind === 'story_comment' && /yanıt/.test(n.title)), r.j);
  r = await b('POST', `/api/stories/${sid}/comments`, { body: 'yanita yanit', parent_id: c2 }); t('yanita yanit ust yorumun altina', r.s === 201 && r.j.comment.parent_id === c1, r);
  r = await b('GET', `/api/stories/${sid}/comments`); t('liste', r.j.comments.length === 3 && r.j.comments.filter((x) => x.parent_id === c1).length === 2, r.j);
  r = await b('DELETE', `/api/stories/${sid}/comments/${c2}`); t('baskasinin yorumunu silemez 403', r.s === 403, r);
  r = await a('DELETE', `/api/stories/${sid}/comments/${c1}`); t('yazar siler', r.s === 200, r);
  // ---- dizi gun gun
  const cat = Number(db.prepare("INSERT INTO catalog (type,title,norm,runtime,created_at) VALUES ('series','W3 Dizi','w3 dizi',40,?)").run(new Date().toISOString()).lastInsertRowid);
  db.prepare('INSERT INTO series_seasons (catalog_id,season,episodes,total_episodes,runtime) VALUES (?,?,?,?,?)').run(cat, 1, 3, 3, 40);
  db.prepare('INSERT INTO series_seasons (catalog_id,season,episodes,total_episodes,runtime) VALUES (?,?,?,?,?)').run(cat, 2, 4, 4, 40);
  r = await b('POST', '/api/entries', { catalog_id: cat, status: 'planlandi' }); t('dizi kaydi', r.s === 201, r); const eid = r.j.entry.id;
  const today = new Date(); const ymd = (d) => d.toISOString().slice(0, 10); const y = ymd(new Date(today.getTime() - 86400000));
  r = await b('POST', `/api/entries/${eid}/series-days`, { date: y, episodes: 2 }); t('dun 2 bolum', r.s === 200 && r.j.entry.season === 1 && r.j.entry.episode === 2 && r.j.entry.status === 'devam', r);
  r = await b('POST', `/api/entries/${eid}/series-days`, { episodes: 3 }); t('bugun 3 bolum sezon atlar', r.s === 200 && r.j.entry.season === 2 && r.j.entry.episode === 2, r.j?.entry);
  r = await b('POST', `/api/entries/${eid}/series-days`, { episodes: 5 }); t('fazla bolum 400', r.s === 400, r);
  r = await b('POST', `/api/entries/${eid}/series-days`, { date: '2999-01-01', episodes: 1 }); t('gelecek tarih 400', r.s === 400, r);
  r = await b('GET', `/api/entries/${eid}/series-days`); t('gun listesi', r.j.days.length === 2 && r.j.days.find((d) => d.date === y)?.episodes === 2, r.j);
  r = await a('POST', `/api/entries/${eid}/series-days`, { episodes: 1 }); t('baskasi ekleyemez 403', r.s === 403, r);
  // ---- bugun
  const book = Number(db.prepare("INSERT INTO catalog (type,title,pages,norm,created_at) VALUES ('book','W3 Kitap',300,'w3 kitap',?)").run(new Date().toISOString()).lastInsertRowid);
  r = await a('POST', '/api/entries', { catalog_id: book, status: 'devam', total_pages: 300 }); const be = r.j.entry.id;
  r = await a('POST', `/api/entries/${be}/progress`, { current_page: 40 }); t('a 40 sayfa', r.s === 200 || r.s === 201, r);
  r = await a('GET', `/api/today?group=${gid}`);
  const rows = r.j.rows;
  t('bugun: a 40 sayfa ilk', rows[0]?.user.display_name === 'w3a' && rows[0].pages === 40, r.j);
  t('bugun: b dizi bolumu (3 bugun) var', rows.some((x) => x.user.display_name === 'w3b' && x.episodes === 3), r.j);
  t('bugun: sira sayfa sonra dizi', rows.length === 2 && rows[1].user.display_name === 'w3b', r.j);
  r = await c('GET', `/api/today?group=${gid}`); t('grup disi bugun goremez', r.s === 403 || r.s === 404, r);
  console.log(fail ? `FAIL=${fail}` : 'fail=0'); process.exit(fail ? 1 : 0);
})();
