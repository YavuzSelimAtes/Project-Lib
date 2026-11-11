// 4. dalga: Gundem, begeni/yorum, hikaye bolum puani/okudum, kitap karti adetleri. Temiz backend: node testler/start-backend.js --fresh
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
  for (const [u, n] of [[a, 'w4a'], [b, 'w4b'], [c, 'w4c']]) await u('POST', '/api/auth/register', acc(n));
  let r = await a('POST', '/api/groups', { name: 'W4' }); const gid = r.j.group.id;
  const db = new DatabaseSync(require('node:path').join(__dirname, 'data', 'test.db')); db.exec('PRAGMA busy_timeout=5000');
  const tok = db.prepare('SELECT invite_token t FROM groups WHERE id=?').get(gid).t;
  await b('POST', `/api/join/${tok}`, {});
  const aid = (await a('GET', '/api/auth/me')).j.user.id;
  const cat = Number(db.prepare("INSERT INTO catalog (type,title,pages,norm,created_at) VALUES ('book','W4 Kitap',300,'w4 kitap',?)").run(new Date().toISOString()).lastInsertRowid);
  r = await a('POST', '/api/entries', { catalog_id: cat, status: 'devam', total_pages: 300 }); const eid = r.j.entry.id;
  r = await b('GET', `/api/gundem?group=${gid}`); t('basladi karti', r.j.posts.some((p) => p.kind === 'started' && p.user.display_name === 'w4a'), r.j);
  // secilen baskinin kapagi Gundem'de gorunur (katalog kapagi yedek)
  const edId = Number(db.prepare("INSERT INTO editions (catalog_id,publisher,pub_norm,cover_url,source,created_at) VALUES (?,'Is Bankasi','is bankasi','/c/baski.jpg','manual',?)").run(cat, new Date().toISOString()).lastInsertRowid);
  db.prepare('UPDATE catalog SET cover_url=? WHERE id=?').run('/c/katalog.jpg', cat); db.prepare('UPDATE entries SET edition_id=? WHERE id=?').run(edId, eid);
  r = await b('GET', `/api/gundem?group=${gid}`); const sp = r.j.posts.find((p) => p.kind === 'started');
  t('gundem baski kapagi', sp?.catalog.cover_url === '/c/baski.jpg' && sp.catalog.cover_fallback === '/c/katalog.jpg', sp?.catalog);
  await a('POST', `/api/entries/${eid}/progress`, { current_page: 15 });
  r = await b('GET', `/api/gundem?group=${gid}`);
  let rd = r.j.posts.filter((p) => p.kind === 'read');
  t('okuma karti: 15 sayfa, en ustte', rd.length === 1 && rd[0].data.last === 15 && r.j.posts[0].kind === 'read', r.j.posts.map((p) => [p.kind, p.data]));
  await a('POST', `/api/entries/${eid}/progress`, { current_page: 40 });
  r = await b('GET', `/api/gundem?group=${gid}`); rd = r.j.posts.filter((p) => p.kind === 'read');
  t('ayni gun tek kart, son artis 25, toplam 40', rd.length === 1 && rd[0].data.last === 25 && rd[0].data.total === 40, rd);
  // yorum (gruba acik) -> kart
  r = await a('POST', `/api/entries/${eid}/comments`, { body: 'harika kitap' }); t('yorum', r.s === 201, r);
  r = await b('GET', `/api/gundem?group=${gid}`); const cp = r.j.posts[0];
  t('yorum karti en ustte', cp.kind === 'comment' && cp.comment?.body === 'harika kitap', r.j.posts[0]);
  // notu yorum olarak paylas -> kart
  r = await a('POST', '/api/notes', { catalog_id: cat, body: 'paylasilan not' }); r = await a('POST', `/api/notes/${r.j.note.id}/share`, {});
  r = await b('GET', `/api/gundem?group=${gid}`); t('paylasilan not gundemde', r.j.posts.some((p) => p.kind === 'comment' && p.comment?.body === 'paylasilan not'), r.j.posts.length);
  // gizli yorum kart olmaz
  r = await a('POST', `/api/entries/${eid}/comments`, { body: 'gizli', none: true });
  r = await b('GET', `/api/gundem?group=${gid}`); t('gizli yorum gundemde yok', !r.j.posts.some((p) => p.comment?.body === 'gizli'), r.j.posts.length);
  // begeni + yorum
  r = await b('POST', `/api/posts/${cp.id}/like`); t('begeni', r.s === 200 && r.j.like_count === 1 && r.j.i_liked, r);
  r = await a('GET', '/api/notifications'); t('sahibine begeni bildirimi', r.j.notifications.some((n) => n.kind === 'post_like'), r.j);
  r = await b('POST', `/api/posts/${cp.id}/like`); t('ikinci begeni sayiyi artirmaz', r.j.like_count === 1, r);
  r = await b('POST', `/api/posts/${cp.id}/comments`, { body: 'katiliyorum' }); t('post yorumu', r.s === 201, r);
  r = await a('GET', `/api/posts/${cp.id}/comments`); t('post yorum listesi', r.j.comments.length === 1 && r.j.comments[0].can_delete, r.j);
  r = await b('DELETE', `/api/posts/${cp.id}/like`); t('begeni geri', r.j.like_count === 0 && !r.j.i_liked, r);
  await b('POST', `/api/posts/${cp.id}/like`); await b('DELETE', `/api/posts/${cp.id}/like`); await b('POST', `/api/posts/${cp.id}/like`);
  r = await a('GET', '/api/notifications'); const pl = r.j.notifications.find((n) => n.kind === 'post_like');
  t('begeni bildirimi paylasima baglanir, kitap adi yazar', pl?.link?.type === 'post' && pl.link.id === cp.id && /“.+”/.test(pl.title), pl);
  r = await a('GET', `/api/posts/${cp.id}`); t('tek paylasim getirilir', r.s === 200 && r.j.post.id === cp.id, r);
  r = await c('GET', `/api/posts/${cp.id}`); t('grup disi tek paylasim 404', r.s === 404, r);
  r = await a('GET', '/api/notifications'); t('begen/geri al/begen: tek bildirim', r.j.notifications.filter((n) => n.kind === 'post_like').length === 1, r.j.notifications.filter((n) => n.kind === 'post_like').length);
  r = await b('DELETE', `/api/posts/${cp.id}/like`);
  r = await c('GET', `/api/posts/${cp.id}/comments`); t('grup disi post goremez 404', r.s === 404, r);
  r = await c('GET', `/api/gundem?group=${gid}`); t('grup disi gundem 403/404', r.s === 403 || r.s === 404, r);
  // bitir + puan
  await a('POST', `/api/entries/${eid}/progress`, { current_page: 300 });
  r = await a('PUT', `/api/catalog/${cat}/ratings`, { genre: 'kurgu', scores: { senaryo: 5, akicilik: 4, karakterler: 3, dil: 4, duygu: 4 } }); t('puan', r.s === 200, r);
  r = await b('GET', `/api/gundem?group=${gid}`);
  t('bitirdi + puan kartlari', r.j.posts.some((p) => p.kind === 'finished') && r.j.posts.find((p) => p.kind === 'rating')?.rating.average === 4, r.j.posts.map((p) => p.kind));
  t('sirali: en yeni en ustte', r.j.posts[0].kind === 'rating', r.j.posts.map((p) => p.kind));
  // kitap karti adetleri
  r = await b('GET', `/api/entries?user_id=${aid}&type=book`); const ce = r.j.entries.find((x) => x.id === eid);
  t('kart adetleri: yorum 2 (gizli gorunmez), puan 1', ce.comment_total === 2 && ce.rating_total === 1, ce);
  r = await a('GET', `/api/entries?user_id=${aid}&type=book`); t('sahibi kendi: yorum 3', r.j.entries.find((x) => x.id === eid).comment_total === 3, r.j.entries[0]);
  // hikaye bolum puani
  db.prepare('UPDATE users SET story_author=1 WHERE id=?').run(aid);
  r = await a('POST', '/api/stories', { title: 'W4 H', group_ids: [gid] }); const sid = r.j.story?.id || r.j.id;
  if (!db.prepare('SELECT 1 FROM story_groups WHERE story_id=?').get(sid)) db.prepare('INSERT INTO story_groups (story_id,group_id) VALUES (?,?)').run(sid, gid);
  r = await a('POST', `/api/stories/${sid}/chapters`, { title: 'Bolum 1', body: 'merhaba dunya', publish: true }); t('bolum', r.s === 201, r); const cid = r.j.chapter?.id;
  db.prepare("UPDATE story_chapters SET published_at=? WHERE id=?").run(new Date().toISOString(), cid);
  r = await b('PUT', `/api/stories/${sid}/chapters/${cid}/read`, { read: true }); t('okudum isareti + sayi', r.s === 200 && r.j.read_count === 1 && r.j.my_read, r);
  r = await b('PUT', `/api/stories/${sid}/chapters/${cid}/rating`, { score: 4 }); t('bolum puani', r.s === 200 && r.j.rating_avg === 4 && r.j.my_rating === 4, r);
  r = await a('PUT', `/api/stories/${sid}/chapters/${cid}/read`, { read: true }); t('yazar isaretleyemez 400', r.s === 400, r);
  r = await a('GET', `/api/stories/${sid}`); const ch = r.j.chapters[0]; t('hikaye detayinda sayilar', ch.read_count === 1 && ch.rating_count === 1 && ch.rating_avg === 4, ch);
  r = await b('PUT', `/api/stories/${sid}/chapters/${cid}/read`, { read: false }); t('okudum geri', r.j.read_count === 0 && !r.j.my_read, r);
  console.log(fail ? `FAIL=${fail}` : 'fail=0'); process.exit(fail ? 1 : 0);
})();
