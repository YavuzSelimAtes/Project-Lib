// Cok gruplu yapi: kayit, grup, katilim, gorunurluk, ayrilma. Calisan test backend'i gerekir (node testler/start-backend.js --fresh)
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
  const a = mk(), b = mk(), c = mk(), adm = mk();
  let r = await a('POST', '/api/auth/register', acc('ayse')); t('register 201 grupsuz', r.s === 201 && r.j.user.groups.length === 0, r);
  r = await a('POST', '/api/groups', { name: 'Ev' }); t('grup ac', r.s === 201 && r.j.group.role === 'owner', r); const gid = r.j.group.id;
  r = await mk()('POST', '/api/groups', { name: 'X' }); t('girissiz grup acamaz', r.s === 401, r);
  r = await a('GET', `/api/groups/${gid}/invite`); const tok = r.j.token; t('davet token', !!tok, r);
  r = await b('POST', '/api/auth/register', acc('veli')); t('ikinci hesap', r.s === 201, r);
  // kayit gorunurlugu: katalog satiri test DB'ye dogrudan eklenir
  const { DatabaseSync } = require('node:sqlite');
  const cdb = new DatabaseSync(require('node:path').join(__dirname, 'data', 'test.db'));
  const catId = Number(cdb.prepare("INSERT INTO catalog (type,title,pages,norm,created_at) VALUES ('book','Test Kitap',100,'test kitap',?)").run(new Date().toISOString()).lastInsertRowid); cdb.close();
  r = await b('POST', `/api/join/${tok}`, { share_existing: false }); t('giris yapmis katilir', r.s === 200 && r.j.user.groups.length === 1 && r.j.user.groups[0].role === 'member', r);
  r = await c('POST', `/api/join/${tok}`, { ...acc('mehmet'), share_existing: true }); t('girissiz hesap acip katilir', r.s === 201 && r.j.user.groups.length === 1, r);
  r = await b('GET', `/api/groups/${gid}`); t('uye listesi 3', r.s === 200 && r.j.group.members.length === 3, r);
  r = await mk()('GET', `/api/groups/${gid}`); t('girissiz goremez', r.s === 401, r);
  r = await adm('POST', '/api/auth/login', { username: 'admin', password: 'test-admin-123' });
  r = await adm('GET', `/api/groups/${gid}`); t('uye olmayan 404', r.s === 404, r);
  r = await b('GET', `/api/groups/${gid}/invite`); t('uye invite goremez 403', r.s === 403, r);
  r = await b('POST', `/api/groups/${gid}/leave`); t('uye ayrilir', r.s === 200, r);
  r = await a('POST', `/api/groups/${gid}/leave`); t('owner ayrilamaz', r.s === 400, r);
  r = await a('DELETE', `/api/groups/${gid}/members/${(await a('GET', '/api/auth/me')).j.user.id}`); t('owner kendini cikaramaz', r.s === 400, r);
  r = await b('DELETE', `/api/groups/${gid}/members/1`); t('uye cikaramaz', r.s === 404 || r.s === 403, r);
  const mid = (await c('GET', '/api/auth/me')).j.user.id;
  r = await a('DELETE', `/api/groups/${gid}/members/${mid}`); t('owner cikarir', r.s === 200, r);
  r = await a('POST', '/api/groups', { name: 'Is' }); t('ikinci grup', r.s === 201, r); const g2 = r.j.group.id;
  r = await a('POST', '/api/entries', { catalog_id: catId, status: 'devam' }); t('kayit olustu', r.s === 201, r); const eid = r.j.entry.id;
  r = await a('GET', `/api/entries/${eid}/groups`); t('varsayilan: tum gruplar gorunur', r.s === 200 && r.j.groups.length === 2 && r.j.groups.every((g) => g.visible), r);
  r = await a('PUT', `/api/entries/${eid}/groups`, { group_ids: [g2] }); t('sadece Is', r.s === 200 && r.j.groups.filter((g) => g.visible).map((g) => g.id).join() === String(g2), r);
  r = await a('PUT', `/api/entries/${eid}/groups`, { none: true }); t('hicbiri', r.j.groups.every((g) => !g.visible), r);
  r = await a('PUT', `/api/entries/${eid}/groups`, { all: true }); t('hepsi', r.j.groups.every((g) => g.visible), r);
  r = await a('PUT', `/api/entries/${eid}/groups`, { group_ids: [9999] }); t('uye olunmayan grup 400', r.s === 400, r);
  r = await b('GET', `/api/entries/${eid}/groups`); t('baskasinin kaydi 403', r.s === 403, r);
  // paylasim: share_existing=true ile katilan, mevcut kaydini gorunur kilar; false ile kilmaz
  const e2 = (await c('POST', '/api/entries', { catalog_id: catId, status: 'devam' })).j.entry.id;
  r = await c('POST', `/api/join/${(await a('GET', `/api/groups/${g2}/invite`)).j.token}`, { share_existing: true }); t('share_existing katilim', r.s === 200, r);
  r = await c('GET', `/api/entries/${e2}/groups`); t('mevcut kayit yeni grupta gorunur', r.j.groups.length === 1 && r.j.groups[0].visible, r);
  r = await c('POST', `/api/groups/${g2}/leave`); t('ayril', r.s === 200, r);
  r = await c('GET', `/api/entries/${e2}/groups`); t('ayrilinca kayit gruptan duser, kayit kalir', r.s === 200 && r.j.groups.length === 0, r);
  r = await a('PUT', `/api/groups/${gid}/name`, { name: 'Evimiz' }); t('ad degisir', r.s === 200 && r.j.group_name === 'Evimiz', r);
  // e-posta
  r = await a('PATCH', '/api/me/profile', { email: ' Ayse@Example.COM ' }); t('email kucuk harf', r.s === 200 && r.j.user.email === 'ayse@example.com', r);
  r = await b('PATCH', '/api/me/profile', { email: 'ayse@example.com' }); t('email benzersiz 409', r.s === 409, r);
  r = await b('PATCH', '/api/me/profile', { email: 'bozuk' }); t('email gecersiz 400', r.s === 400, r);
  r = await a('GET', '/api/auth/me'); t('me email', r.j.user.email === 'ayse@example.com', r);
  // hesap silme: ayse iki grubun owner'i; veli (b) gruba tekrar katilir -> Ev'e devredilir, Is'te kimse yok -> silinir
  await b('POST', `/api/join/${(await a('GET', `/api/groups/${gid}/invite`)).j.token}`, {});
  r = await a('DELETE', '/api/me', { password: 'yanlis' }); t('yanlis sifre 403', r.s === 403, r);
  r = await adm('DELETE', '/api/me', { password: 'test-admin-123' }); t('son admin silinemez', r.s === 400, r);
  r = await a('DELETE', '/api/me', { password: 'secret1' }); t('hesap silindi', r.s === 200, r);
  r = await a('GET', '/api/auth/me'); t('oturum kapandi', r.s === 401, r);
  r = await b('GET', '/api/groups'); t('owner devredildi, bos grup silindi', r.j.groups.length === 1 && r.j.groups[0].id === gid && r.j.groups[0].role === 'owner', r);
  const cdb2 = new (require('node:sqlite').DatabaseSync)(require('node:path').join(__dirname, 'data', 'test.db'));
  t('kayitlar silindi', cdb2.prepare("SELECT COUNT(*) c FROM entries WHERE id=?").get(eid).c === 0 && cdb2.prepare('SELECT COUNT(*) c FROM entry_groups WHERE entry_id=?').get(eid).c === 0, {}); cdb2.close();
  console.log('fail=' + fail);
  process.exit(fail ? 1 : 0);
})();
