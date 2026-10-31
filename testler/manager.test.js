// Grup yonetici hesabi: otomatik olusur, sifreyle girilmez, okumaz, gecisle yonetir; mevcut gruplar icin tek seferlik migrate.
// Calisan test backend'i gerekir (node testler/start-backend.js --fresh); migrate bolumu kendi gecici sunucusunu (4101) acar
const B = 'http://localhost:4100';
const mk = (base = B) => { let ck = ''; return async (m, p, body) => {
  const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', cookie: ck }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0];
  return { s: r.status, j: await r.json().catch(() => null) };
}; };
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log(ok ? 'OK  ' : 'FAIL', n, ok ? '' : JSON.stringify(x)); };
const acc = (u) => ({ username: u, display_name: u, password: 'secret1', avatar: '🦊' });
(async () => {
  const a = mk(), b = mk();
  await a('POST', '/api/auth/register', acc('mgra')); await b('POST', '/api/auth/register', acc('mgrb'));
  let r = await a('POST', '/api/groups', { name: 'Güzel Ev' });
  const gid = r.j.group.id, mid = r.j.manager_id;
  t('grup ac: uye + yonetici bagli', r.s === 201 && r.j.group.role === 'member' && r.j.group.manager.id === mid && r.j.group.manager.linked && r.j.group.member_count === 1, r);
  r = await a('GET', '/api/auth/linked'); const m = r.j.accounts.find((x) => x.id === mid);
  t('bagli hesaplar: yonetici isaretli', m && m.is_manager && m.kind === 'manager' && m.managed_group_id === gid && m.managed_group_name === 'Güzel Ev', r);
  const mc = mk();
  r = await mc('POST', '/api/auth/login', { username: 'guzel-ev-yonetici', password: 'secret1' }); t('yonetici sifreyle girilemez', r.s === 401, r);
  r = await mc('POST', '/api/auth/login', { username: 'guzel-ev-yonetici', password: '' }); t('bos sifre de olmaz', r.s === 400 || r.s === 401, r);
  r = await a('POST', '/api/auth/switch', { user_id: mid });
  t('gecis: user alanlari', r.s === 200 && r.j.user.is_manager && r.j.user.kind === 'manager' && r.j.user.managed_group_id === gid && r.j.user.display_name === 'Güzel Ev Yönetici', r);
  r = await a('GET', '/api/auth/me'); t('me: yonetici', r.j.user.is_manager && r.j.user.managed_group_id === gid, r);
  r = await a('GET', '/api/auth/linked'); t('yoneticiden kisisel hesaba donus listede', r.j.accounts.length === 1 && !r.j.accounts[0].is_manager, r);
  // grup ayarlari
  r = await a('GET', `/api/groups/${gid}/invite`); t('davet linki (groups)', r.s === 200 && !!r.j.token, r); const tok = r.j.token;
  r = await a('GET', '/api/admin/invite'); t('davet linki (admin/invite)', r.s === 200 && r.j.token === tok, r);
  r = await a('PUT', '/api/admin/group-name', { name: 'Yeni Ad' }); t('grup adi (admin/group-name)', r.s === 200 && r.j.group_name === 'Yeni Ad', r);
  r = await a('PUT', `/api/groups/${gid}/name`, { name: 'Ev' }); t('grup adi (groups)', r.s === 200, r);
  r = await a('GET', '/api/admin/requests'); t('istekler', r.s === 200, r);
  r = await a('GET', '/api/admin/catalog'); t('katalog listesi', r.s === 200, r);
  r = await a('POST', '/api/admin/catalog', { type: 'book', title: 'Yonetici Kitabi', pages: 50 }); t('katalog ekler', r.s === 201, r); const cat = r.j.item.id;
  r = await a('GET', `/api/groups/${gid}`); t('uye listesinde yonetici yok, okuyucu var', r.j.group.members.length === 1 && r.j.group.members[0].username === 'mgra' && r.j.group.manager.id === mid, r);
  // okuyucu degil
  r = await a('POST', '/api/entries', { catalog_id: cat, status: 'devam' }); t('kayit ekleyemez 403', r.s === 403 && r.j.code === 'MANAGER_READONLY', r);
  r = await a('POST', '/api/requests', { type: 'book', title: 'x' }); t('istek acamaz 403', r.s === 403, r);
  r = await a('POST', '/api/groups', { name: 'Y' }); t('yonetici grup acamaz 403', r.s === 403, r);
  r = await a('GET', `/api/leaderboards/record?group=${gid}`); t('liderlik acilir (yonetici yok)', r.s === 200 && !JSON.stringify(r.j).includes('guzel-ev'), r);
  r = await a('GET', `/api/feed?group=${gid}`); t('feed acilir', r.s === 200, r);
  // kisisel hesap: sadece uye, ayarlar yapamaz, kayit ekleyebilir
  r = await a('POST', '/api/auth/switch', { user_id: (await b('GET', '/api/auth/me')).j.user.id }); t('baskasina gecemez 403', r.s === 403, r);
  const a2 = mk(); await a2('POST', '/api/auth/login', { username: 'mgra', password: 'secret1' });
  r = await a2('GET', `/api/groups/${gid}/invite`); t('kisisel hesap davet goremez 403', r.s === 403, r);
  r = await a2('POST', '/api/entries', { catalog_id: cat, status: 'devam' }); t('kisisel hesap kayit ekler', r.s === 201, r);
  r = await a2('GET', '/api/admin/invite'); t('kisisel hesap admin/invite 403', r.s === 403, r);
  r = await b('POST', `/api/join/${tok}`, {}); t('katilim linki yonetici hesapla calisir', r.s === 200, r);
  r = await b('GET', `/api/groups/${gid}`); t('uye sayisi 2', r.j.group.member_count === 2 && r.j.group.members.length === 2, r);
  r = await b('GET', '/api/auth/linked'); t('b yonetici goremez (bagli degil)', r.j.accounts.length === 0, r);
  // ayrilinca baglanti duser; baska grubun yoneticisine baglanti kalir
  r = await a2('POST', '/api/groups', { name: 'Diger' }); const mid2 = r.j.manager_id;
  r = await a2('GET', '/api/auth/linked'); t('ayrilmadan once iki yonetici bagli', r.j.accounts.filter((x) => x.is_manager).length === 2, r);
  r = await a2('POST', `/api/groups/${gid}/leave`); t('gruptan ayrilir', r.s === 200, r);
  r = await a2('GET', '/api/auth/linked'); t('ayrilinca yonetici baglantisi duser, digeri kalir', r.j.accounts.filter((x) => x.is_manager).map((x) => x.id).join() === String(mid2), r);
  r = await a2('POST', '/api/auth/switch', { user_id: mid }); t('eski yoneticiye gecemez 403', r.s === 403, r);

  // ---- migrate: eski veri (sahip = kisisel hesap) -> yonetici hesap, bir kez ----
  const { DatabaseSync } = require('node:sqlite'), path = require('node:path'), fs = require('node:fs'), { spawn } = require('node:child_process');
  const dbp = path.join(__dirname, 'data', 'mig.db');
  for (const s of ['', '-wal', '-shm']) fs.rmSync(dbp + s, { force: true });
  const run = () => spawn('node', ['src/server.js'], { cwd: path.join(__dirname, '..', 'backend'), env: { ...process.env, PORT: '4101', DB_PATH: dbp, ADMIN_PASSWORD: 'adm-test-123' }, stdio: 'ignore' });
  const stop = (p) => new Promise((res) => { p.on('exit', res); p.kill(); });
  const wait = async () => { for (let i = 0; i < 40; i++) { try { await fetch('http://localhost:4101/api/auth/me'); return; } catch { await new Promise((r) => setTimeout(r, 250)); } } };
  let p = run(); await wait();
  const o = mk('http://localhost:4101'); await o('POST', '/api/auth/register', acc('eski'));
  await stop(p);
  let d = new DatabaseSync(dbp);
  const uid = d.prepare("SELECT id FROM users WHERE username='eski'").get().id, now = new Date().toISOString();
  d.prepare('INSERT INTO groups (owner_id,invite_token,name,created_at) VALUES (?,?,?,?)').run(uid, 'tok-eski-0123456789ab', 'Aile', now);
  d.prepare("INSERT INTO group_members (user_id,group_id,role,joined_at) VALUES (?,1,'owner',?)").run(uid, now);
  d.prepare("DELETE FROM meta WHERE key='group_managers_v1'").run(); d.close();
  p = run(); await wait();
  d = new DatabaseSync(dbp);
  const g = d.prepare('SELECT * FROM groups WHERE id=1').get(), mu = d.prepare('SELECT * FROM users WHERE id=?').get(g.owner_id);
  t('migrate: sahip yonetici hesap', mu.id !== uid && mu.kind === 'manager' && mu.username === 'aile-yonetici' && mu.display_name === 'Aile Yönetici', mu);
  t('migrate: eski sahip uye kaldi', d.prepare('SELECT role FROM group_members WHERE user_id=? AND group_id=1').get(uid).role === 'member' && d.prepare('SELECT role FROM group_members WHERE user_id=? AND group_id=1').get(mu.id).role === 'owner', {});
  t('migrate: baglandi', d.prepare('SELECT COUNT(DISTINCT group_id) c FROM account_links WHERE user_id IN (?,?)').get(uid, mu.id).c === 1, {});
  t('migrate: davet adi eski sahip', g.invite_name === 'eski', g);
  d.close(); await stop(p); p = run(); await wait();
  d = new DatabaseSync(dbp);
  t('migrate bir kez: ikinci acilista yeni hesap yok', d.prepare("SELECT COUNT(*) c FROM users WHERE kind='manager'").get().c === 1, {});
  d.close(); await stop(p);
  for (const s of ['', '-wal', '-shm']) fs.rmSync(dbp + s, { force: true });
  console.log('fail=' + fail);
  process.exit(fail ? 1 : 0);
})();
