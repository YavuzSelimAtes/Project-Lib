// Demo veriye Gundem hareketi + hikaye ekler (seed-demo.js'den SONRA, backend 4100'de). Kullanim: node testler/seed-gundem.js
const { DatabaseSync } = require('node:sqlite');
const B = 'http://localhost:4100';
const mk = () => { let ck = ''; return async (m, p, body) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', cookie: ck }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0];
  return { s: r.status, j: await r.json().catch(() => null) };
}; };
const PW = 'Deneme123!';
(async () => {
  const U = {};
  for (const n of ['ayse', 'mehmet', 'elif', 'can']) { U[n] = mk(); const r = await U[n]('POST', '/api/auth/login', { username: n, password: PW }); if (r.s !== 200) throw new Error('giris ' + n); }
  const gid = (await U.ayse('GET', '/api/groups')).j.groups[0].id;
  const db = new DatabaseSync(require('node:path').join(__dirname, 'data', 'test.db')); db.exec('PRAGMA busy_timeout=5000');
  const log = [];
  for (const [n, pages] of [['mehmet', 25], ['can', 18], ['elif', 40]]) {
    const me = (await U[n]('GET', '/api/auth/me')).j.user.id;
    const es = (await U[n]('GET', `/api/entries?user_id=${me}&type=book&limit=100`)).j.entries.filter((e) => e.status === 'devam' && e.total_pages);
    if (!es.length) { log.push(n + ': devam eden kitap yok'); continue; }
    const e = es[0];
    const r = await U[n]('POST', `/api/entries/${e.id}/progress`, { current_page: Math.min(e.total_pages - 1, e.current_page + pages) });
    log.push(`${n}: ${e.catalog.title} +${pages} -> ${r.s}`);
    if (n === 'mehmet') { const r2 = await U[n]('POST', `/api/entries/${e.id}/progress`, { current_page: Math.min(e.total_pages - 1, e.current_page + pages + 12) }); log.push(`${n}: ikinci giris +12 -> ${r2.s}`); }
    if (n === 'elif') { const c = await U[n]('POST', `/api/entries/${e.id}/comments`, { body: 'Bu bolumden sonra elim kitaptan kopmadi!' }); log.push(`${n}: yorum -> ${c.s}`); }
  }
  // ayse hikaye yazari: 3 bolum
  const aid = (await U.ayse('GET', '/api/auth/me')).j.user.id;
  db.prepare('UPDATE users SET story_author=1 WHERE id=?').run(aid);
  let r = await U.ayse('POST', '/api/stories', { title: 'Gece Kutuphanesi', summary: 'Eski bir kutuphanenin gizemi', group_ids: [gid] });
  const sid = r.j.story?.id || r.j.id;
  if (!db.prepare('SELECT 1 FROM story_groups WHERE story_id=?').get(sid)) db.prepare('INSERT INTO story_groups (story_id,group_id) VALUES (?,?)').run(sid, gid);
  const ids = [];
  for (let i = 1; i <= 3; i++) {
    r = await U.ayse('POST', `/api/stories/${sid}/chapters`, { title: 'Bolum ' + i, body: 'Kutuphanenin kapisi gicirdayarak acildi. '.repeat(40), publish: true });
    ids.push(r.j.chapter?.id);
    db.prepare('UPDATE story_chapters SET published_at=? WHERE id=?').run(new Date().toISOString(), r.j.chapter?.id);
  }
  await U.mehmet('PUT', `/api/stories/${sid}/chapters/${ids[0]}/read`, { read: true });
  await U.mehmet('PUT', `/api/stories/${sid}/chapters/${ids[0]}/rating`, { score: 5 });
  await U.can('PUT', `/api/stories/${sid}/chapters/${ids[0]}/read`, { read: true });
  await U.can('PUT', `/api/stories/${sid}/chapters/${ids[0]}/rating`, { score: 4 });
  await U.can('PUT', `/api/stories/${sid}/chapters/${ids[1]}/read`, { read: true });
  log.push('hikaye ' + sid + ' (3 bolum, okuma/puan eklendi)');
  const g = await U.can('GET', `/api/gundem?group=${gid}`);
  console.log(log.join('\n')); console.log('gundem kart sayisi:', g.j.posts.length);
})();
