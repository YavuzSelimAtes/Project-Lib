// Geri bildirim: kayit + admin listesi + limit; mail SMTP yokken atlanir. Calisan test backend'i gerekir (node testler/start-backend.js --fresh).
// Mail icerigi gercek ag kullanmadan nodemailer transport'u taklit edilerek dogrulanir; "mail gitti" yolu icin 4102'de SMTP_TEST_JSON=1 sunucusu acilir.
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
  const a = mk(), adm = mk(), anon = mk();
  await a('POST', '/api/auth/register', acc('fbka'));
  await adm('POST', '/api/auth/login', { username: 'admin', password: 'test-admin-123' });
  let r = await anon('POST', '/api/feedback', { kind: 'oneri', message: 'x' }); t('girissiz 401', r.s === 401, r);
  r = await a('POST', '/api/feedback', { kind: 'sacma', message: 'x' }); t('gecersiz tur 400', r.s === 400, r);
  r = await a('POST', '/api/feedback', { kind: 'oneri', message: '   ' }); t('bos mesaj 400', r.s === 400, r);
  r = await a('POST', '/api/feedback', { kind: 'oneri', message: 'a'.repeat(2001) }); t('cok uzun 400', r.s === 400, r);
  r = await a('POST', '/api/feedback', { kind: 'oneri', message: '  Karanlik tema guzel olur  ', page: '/gruplar' }); t('basarili, SMTP yok -> emailed false', r.s === 200 && r.j.ok === true && r.j.emailed === false, r);
  r = await a('GET', '/api/admin/feedback'); t('normal kullanici listeleyemez 403', r.s === 403, r);
  r = await a('DELETE', '/api/admin/feedback/1'); t('normal kullanici silemez 403', r.s === 403, r);
  r = await adm('GET', '/api/admin/feedback'); const it = r.j.items?.[0];
  t('admin listesi', r.s === 200 && r.j.items.length === 1 && it.message === 'Karanlik tema guzel olur' && it.kind === 'oneri' && it.page === '/gruplar' && it.emailed === false && it.user.username === 'fbka' && it.user.kind === 'user', r);
  // yonetici hesap de gonderebilir
  const g = await a('POST', '/api/groups', { name: 'FB' }); const m = mk(); await m('POST', '/api/auth/login', { username: 'fbka', password: 'secret1' }); await m('POST', '/api/auth/switch', { user_id: g.j.manager_id });
  r = await m('POST', '/api/feedback', { kind: 'hata', message: 'Yonetici hesaptan hata' }); t('yonetici hesap gonderir', r.s === 200, r);
  r = await adm('GET', '/api/admin/feedback'); t('yeni -> eski, kullanici turu manager', r.j.items.length === 2 && r.j.items[0].kind === 'hata' && r.j.items[0].user.kind === 'manager', r);
  for (let i = 0; i < 4; i++) await a('POST', '/api/feedback', { kind: 'begendim', message: 'ok' + i });
  r = await a('POST', '/api/feedback', { kind: 'begendim', message: 'limit' }); t('6. mesaj 429', r.s === 429 && /saat/.test(r.j.error), r);
  r = await m('POST', '/api/feedback', { kind: 'hata', message: 'baska hesap limiti ayri' }); t('limit kisi basina', r.s === 200, r);
  r = await adm('DELETE', `/api/admin/feedback/${it.id}`); t('admin siler', r.s === 200, r);
  r = await adm('DELETE', `/api/admin/feedback/${it.id}`); t('olmayan 404', r.s === 404, r);

  // ---- mail icerigi: transport taklit edilir (ag yok) ----
  process.env.SMTP_TEST_JSON = '1'; process.env.FEEDBACK_TO = 'hedef@example.com';
  const { mailTransport, sendFeedbackMail } = await import('../backend/src/services/mail.js');
  const tr = mailTransport(); let sent = null; tr.sendMail = async (msg) => { sent = msg; return {}; };
  const ok = await sendFeedbackMail({ kind: 'oneri', message: 'Merhaba\r\nBcc: kotu@example.com <script>alert(1)</script>', page: '/x\r\nY', createdAt: '2026-01-01T00:00:00Z', user: { display_name: 'Ali <b>', username: 'ali', kind: 'manager' } });
  t('mail: gonderildi', ok === true && sent.to === 'hedef@example.com', sent);
  t('mail: konu tek satir, header enjeksiyonu yok', !/[\r\n]/.test(sent.subject) && sent.subject.startsWith('[Kutuphane] oneri: Merhaba'), sent.subject);
  t('mail: html kacisli', !sent.html.includes('<script>') && sent.html.includes('&lt;script&gt;') && sent.html.includes('Ali &lt;b&gt;'), sent.html);
  t('mail: govde kullanici/hesap turu/sayfa', sent.text.includes('@ali') && sent.text.includes('grup yöneticisi') && sent.text.includes('Sayfa: /x Y'), sent.text);
  tr.sendMail = async () => { throw new Error('smtp down'); };
  const ok2 = await sendFeedbackMail({ kind: 'hata', message: 'x', user: { display_name: 'a', username: 'a' }, createdAt: 'z' });
  t('mail hatasi firlatmaz, false', ok2 === false, ok2);

  // ---- SMTP_TEST_JSON=1 sunucusu: emailed true ----
  const { spawn } = require('node:child_process'), path = require('node:path'), fs = require('node:fs');
  const dbp = path.join(__dirname, 'data', 'fb.db');
  for (const s of ['', '-wal', '-shm']) fs.rmSync(dbp + s, { force: true });
  const p = spawn('node', ['src/server.js'], { cwd: path.join(__dirname, '..', 'backend'), env: { ...process.env, PORT: '4102', DB_PATH: dbp, ADMIN_PASSWORD: 'adm-test-123', SMTP_TEST_JSON: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await fetch('http://localhost:4102/api/auth/me'); break; } catch { await new Promise((x) => setTimeout(x, 250)); } }
  const c = mk('http://localhost:4102'); await c('POST', '/api/auth/register', acc('fbkb'));
  r = await c('POST', '/api/feedback', { kind: 'begendim', message: 'Harika' }); t('SMTP (json) varken emailed true', r.s === 200 && r.j.emailed === true, r);
  await new Promise((x) => { p.on('exit', x); p.kill(); });
  for (const s of ['', '-wal', '-shm']) fs.rmSync(dbp + s, { force: true });
  console.log('fail=' + fail);
  process.exit(fail ? 1 : 0);
})();
