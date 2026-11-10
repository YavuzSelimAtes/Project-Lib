// Sorular gruba gore filtrelenir. Calisan test backend'i gerekir (node testler/start-backend.js --fresh)
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
  const { DatabaseSync } = require('node:sqlite');
  const own = mk(), jr = mk(), md = mk(), out = mk();
  const ids = {};
  for (const [n, c] of [['sahip', own], ['junior', jr], ['medine', md]]) { const r = await c('POST', '/api/auth/register', acc(n)); ids[n] = r.j.user.id; }
  const db = new DatabaseSync(require('node:path').join(__dirname, 'data', 'test.db')); const now = new Date().toISOString();
  const grp = (n) => { const id = Number(db.prepare("INSERT INTO groups (owner_id,invite_token,name,created_at) VALUES (?,?,?,?)").run(ids.sahip, require('node:crypto').randomBytes(8).toString('hex'), n, now).lastInsertRowid); return id; };
  const gA = grp('A'), gB = grp('B');
  const mem = (u, g) => db.prepare("INSERT OR IGNORE INTO group_members (user_id,group_id,role,joined_at) VALUES (?,?,'member',?)").run(u, g, now);
  mem(ids.sahip, gA); mem(ids.sahip, gB); mem(ids.junior, gA); mem(ids.medine, gB);
  const cat = Number(db.prepare("INSERT INTO catalog (type,title,pages,norm,created_at) VALUES ('book','Guns',100,'guns',?)").run(now).lastInsertRowid);
  let r = await own('POST', '/api/entries', { catalog_id: cat, status: 'devam' }); const eid = r.j.entry.id;
  db.prepare('INSERT OR IGNORE INTO entry_groups (entry_id,group_id) VALUES (?,?)').run(eid, gA); db.prepare('INSERT OR IGNORE INTO entry_groups (entry_id,group_id) VALUES (?,?)').run(eid, gB); db.close();
  r = await jr('POST', `/api/entries/${eid}/questions`, { question: 'junior sorusu' }); t('junior sorar', r.s === 201, r);
  r = await md('POST', `/api/entries/${eid}/questions`, { question: 'medine sorusu' }); t('medine sorar', r.s === 201, r);
  const qs = async (c, p) => (await c('GET', p)).j.questions.map((q) => q.question).sort().join('|');
  t('medine entry: yalniz kendi sorusu', await qs(md, `/api/entries/${eid}/questions`) === 'medine sorusu', await qs(md, `/api/entries/${eid}/questions`));
  t('medine kutuphane: yalniz kendi sorusu', await qs(md, `/api/library/${cat}/questions`) === 'medine sorusu', await qs(md, `/api/library/${cat}/questions`));
  t('junior kutuphane: yalniz kendi sorusu', await qs(jr, `/api/library/${cat}/questions`) === 'junior sorusu', 0);
  t('sahip ikisini de gorur', await qs(own, `/api/entries/${eid}/questions`) === 'junior sorusu|medine sorusu', 0);
  r = await md('GET', `/api/library/${cat}`); t('medine soru sayisi 1', r.j.question_count === 1, r.j);
  console.log(fail ? `${fail} FAIL` : 'HEPSI OK'); process.exit(fail ? 1 : 0);
})();
