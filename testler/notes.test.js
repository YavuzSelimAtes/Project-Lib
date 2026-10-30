// Defterim (notlar), hedefler, yil ozeti, veri indirme, hesap silme. Calisan test backend'i gerekir (node testler/start-backend.js --fresh); testi tek seferde calistirin.
const B = 'http://localhost:4100';
const mk = () => { let ck = ''; return async (m, p, body, raw) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', cookie: ck }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0];
  if (raw) { const buf = Buffer.from(await r.arrayBuffer()); return { s: r.status, h: r.headers, text: buf.toString('utf8'), bom: buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf }; }
  return { s: r.status, j: await r.json().catch(() => null) };
}; };
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log(ok ? 'OK  ' : 'FAIL', n, ok ? '' : JSON.stringify(x)); };
const acc = (u) => ({ username: u, display_name: u, password: 'secret1', avatar: '🦊' });
(async () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(require('node:path').join(__dirname, 'data', 'test.db'));
  db.exec('PRAGMA busy_timeout=5000');
  const a = mk(), b = mk(), adm = mk();
  const id = async (u) => (await u('GET', '/api/auth/me')).j.user.id;
  for (const [u, n] of [[a, 'nota'], [b, 'notb']]) await u('POST', '/api/auth/register', acc(n));
  await adm('POST', '/api/auth/login', { username: 'admin', password: 'test-admin-123' });
  const g1 = (await a('POST', '/api/groups', { name: 'N1' })).j.group.id;
  const g2 = (await a('POST', '/api/groups', { name: 'N2' })).j.group.id;
  const tok = async (g) => (await a('GET', `/api/groups/${g}/invite`)).j.token;
  await b('POST', `/api/join/${await tok(g1)}`, {});
  const cat = async (title, type = 'book', pages = 200) => (await a('POST', '/api/admin/catalog', { type, title, pages })).j.item.id;
  const k1 = await cat('Defter Kitap Bir'), k2 = await cat('Defter Kitap Iki'), mv = await cat('Defter Film', 'movie', null);
  let r;

  // ---- not CRUD ----
  r = await a('GET', '/api/notes'); t('bos defter', r.s === 200 && r.j.notes.length === 0 && r.j.total === 0, r);
  r = await a('POST', '/api/notes', { catalog_id: k1, body: 'Ilk not', ref: 'Sayfa 45' }); t('not olusur 201', r.s === 201 && r.j.note.ref === 'Sayfa 45' && r.j.note.catalog.title === 'Defter Kitap Bir' && r.j.note.catalog.type === 'book', r);
  const n1 = r.j.note.id;
  r = await a('POST', '/api/notes', { catalog_id: k2, body: 'Ikinci kitap notu' }); const n2 = r.j.note.id;
  r = await a('POST', '/api/notes', { catalog_id: k1, body: 'Zeytin agaci hakkinda' }); const n3 = r.j.note.id;
  r = await a('POST', '/api/notes', { catalog_id: k1, body: '' }); t('bos govde 400', r.s === 400, r);
  r = await a('POST', '/api/notes', { catalog_id: k1, body: 'x'.repeat(5001) }); t('5001 karakter 400', r.s === 400, r);
  r = await a('POST', '/api/notes', { catalog_id: k1, body: 'x'.repeat(5000) }); t('5000 karakter olur', r.s === 201, r); const nBig = r.j.note.id;
  r = await a('POST', '/api/notes', { catalog_id: 999999, body: 'yok' }); t('olmayan katalog 400', r.s === 400, r);
  r = await a('POST', '/api/notes', { body: 'katalogsuz' }); t('catalog_id zorunlu 400', r.s === 400, r);
  r = await mk()('POST', '/api/notes', { catalog_id: k1, body: 'x' }); t('girissiz 401', r.s === 401, r);
  r = await a('POST', '/api/notes', { catalog_id: mv, body: 'film notu', ref: '01:12:30' }); t('kayitsiz film notu olur', r.s === 201 && r.j.note.ref === '01:12:30', r);
  const nFilm = r.j.note.id;
  await a('DELETE', `/api/notes/${nBig}`);
  r = await a('GET', '/api/notes'); t('liste en yeni once', r.j.notes.map((n) => n.id).join() === [nFilm, n3, n2, n1].join() && r.j.total === 4, r.j.notes.map((n) => n.id));
  r = await a('GET', `/api/notes?catalog_id=${k1}`); t('catalog_id filtresi', r.j.total === 2 && r.j.notes.every((n) => n.catalog_id === k1), r);
  r = await a('GET', '/api/notes?q=zeytin'); t('q govdede arar', r.j.total === 1 && r.j.notes[0].id === n3, r);
  r = await a('GET', '/api/notes?q=Kitap%20Iki'); t('q baslikta arar', r.j.total === 1 && r.j.notes[0].id === n2, r);
  r = await a('GET', '/api/notes?q=%25'); t('q joker karakteri kacar', r.j.total === 0, r);
  r = await a('GET', '/api/notes?limit=2&offset=1'); t('limit/offset', r.j.notes.length === 2 && r.j.total === 4, r);
  r = await a('PATCH', `/api/notes/${n1}`, { body: 'Guncel', ref: null }); t('PATCH govde+ref temizle', r.s === 200 && r.j.note.body === 'Guncel' && r.j.note.ref === null, r);
  r = await a('PATCH', `/api/notes/${n1}`, { ref: 'S2B3' }); t('PATCH yalniz ref', r.j.note.body === 'Guncel' && r.j.note.ref === 'S2B3', r);
  r = await a('PATCH', `/api/notes/${n1}`, { body: '' }); t('PATCH bos govde 400', r.s === 400, r);
  r = await b('GET', '/api/notes'); t('baskasi listede gormez', r.j.total === 0, r);
  r = await b('PATCH', `/api/notes/${n1}`, { body: 'hack' }); t('baskasi PATCH 404', r.s === 404, r);
  r = await b('DELETE', `/api/notes/${n1}`); t('baskasi DELETE 404', r.s === 404, r);
  r = await b('POST', `/api/notes/${n1}/share`, {}); t('baskasi share 404', r.s === 404, r);
  r = await adm('PATCH', `/api/notes/${n1}`, { body: 'hack' }); t('admin de baskasinin notuna 404', r.s === 404, r);
  r = await a('GET', '/api/notes'); t('not degismedi', r.j.notes.find((n) => n.id === n1).body === 'Guncel', r);

  // ---- paylasim ----
  r = await a('POST', `/api/notes/${n1}/share`, {}); t('kaydi yok 409', r.s === 409 && /kitaplığına/.test(JSON.stringify(r.j)), r);
  const eA = (await a('POST', '/api/entries', { catalog_id: k1, status: 'devam' })).j.entry.id;
  r = await a('PUT', `/api/entries/${eA}/groups`, { group_ids: [g1] }); t('kayit yalniz g1', r.s === 200, r);
  r = await a('POST', `/api/notes/${n1}/share`, { group_ids: [g2] }); t('gorunmeyen gruba 400', r.s === 400, r);
  r = await a('POST', `/api/notes/${n1}/share`, { group_ids: [g1] }); t('g1e paylas 201', r.s === 201 && r.j.comment.body === '[S2B3] Guncel' && r.j.comment.group_ids.join() === String(g1), r);
  const cm1 = r.j.comment.id;
  r = await b('GET', `/api/entries/${eA}/comments`); t('g1 uyesi yorumu gorur', r.j.comments.some((x) => x.id === cm1), r);
  r = await a('POST', `/api/notes/${n3}/share`, { none: true }); t('none: yalniz ben', r.s === 201 && r.j.comment.group_ids.length === 0 && r.j.comment.body === 'Zeytin agaci hakkinda', r);
  const cm2 = r.j.comment.id;
  r = await b('GET', `/api/entries/${eA}/comments`); t('none yorumu uyeye gorunmez', !r.j.comments.some((x) => x.id === cm2), r);
  r = await a('POST', `/api/notes/${n3}/share`, {}); t('varsayilan = kaydin gruplari', r.s === 201 && r.j.comment.group_ids.join() === String(g1), r);
  r = await a('POST', `/api/notes/${n3}/share`, { all: true }); t('all', r.s === 201, r);
  await a('PATCH', `/api/notes/${n2}`, { body: 'y'.repeat(2001) });
  await a('POST', '/api/entries', { catalog_id: k2, status: 'devam' });
  r = await a('POST', `/api/notes/${n2}/share`, {}); t('2000+ karakter 400', r.s === 400, r);
  r = await a('DELETE', `/api/notes/${n1}`); t('not silinir', r.s === 200, r);
  r = await b('GET', `/api/entries/${eA}/comments`); t('paylasilan yorum kalir', r.j.comments.some((x) => x.id === cm1), r);

  // ---- hedefler ----
  r = await a('GET', '/api/me/goals'); t('varsayilan hedef 0/0', r.s === 200 && r.j.goals.monthly_pages === 0 && r.j.goals.yearly_books === 0 && r.j.goals.month_pages === 0 && r.j.goals.year_books === 0, r);
  r = await a('PUT', '/api/me/goals', { monthly_pages: 300, yearly_books: 12 }); t('PUT hedef', r.s === 200 && r.j.goals.monthly_pages === 300 && r.j.goals.yearly_books === 12, r);
  r = await a('PUT', '/api/me/goals', { monthly_pages: 20001 }); t('aylik > 20000 400', r.s === 400, r);
  r = await a('PUT', '/api/me/goals', { yearly_books: 501 }); t('yillik > 500 400', r.s === 400, r);
  r = await a('PUT', '/api/me/goals', { yearly_books: -1 }); t('negatif 400', r.s === 400, r);
  r = await a('PUT', '/api/me/goals', { monthly_pages: 'abc' }); t('metin 400', r.s === 400, r);
  r = await a('PUT', '/api/me/goals', { yearly_books: 20 }); t('kismi PUT digerini korur', r.j.goals.monthly_pages === 300 && r.j.goals.yearly_books === 20, r);
  r = await a('PUT', '/api/me/goals', { monthly_pages: 0 }); t('0 = kapali', r.j.goals.monthly_pages === 0, r);
  r = await b('GET', '/api/me/goals'); t('hedefler kisiye ozel', r.j.goals.yearly_books === 0, r);
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  r = await a('POST', `/api/entries/${eA}/progress`, { current_page: 40 }); t('ilerleme girilir', r.s < 300, r);
  r = await a('GET', '/api/me/goals'); t('month_pages okunan sayfa', r.j.goals.month_pages === 40, r);
  const thisYear = Number(todayStr.slice(0, 4));

  // ---- yil ozeti ----
  r = await a('GET', '/api/me/year-summary'); t('bos yil ozeti alanlari', r.s === 200 && r.j.year === thisYear && r.j.finished.total === 0 && r.j.avg_rating === null && r.j.first_finished === null && Array.isArray(r.j.top_rated) && r.j.total_pages === 40, r);
  const yc = mk(); await yc('POST', '/api/auth/register', acc('noty')); const idy = await id(yc);
  const kk = []; for (let i = 1; i <= 4; i++) kk.push(await cat(`Yil Kitabi ${i}`, 'book', 100));
  const fin = [[kk[0], '2025-02-10', 5], [kk[1], '2025-02-20', 3], [kk[2], '2025-05-05', 4], [kk[3], '2025-12-31', 5]];
  const eids = [];
  for (const [ck, end, rt] of fin) {
    const x = await yc('POST', '/api/entries', { catalog_id: ck, status: 'bitti', start_date: end.slice(0, 8) + '01', end_date: end, rating: rt });
    t(`bitmis kayit ${end}`, x.s === 201 && x.j.entry.status === 'bitti', x);
    eids.push(x.j.entry?.id);
  }
  const fm = (await yc('POST', '/api/entries', { catalog_id: mv, status: 'bitti', end_date: '2025-07-01' })).j.entry;
  db.prepare('DELETE FROM reading_logs WHERE user_id=?').run(idy);
  const ins = db.prepare('INSERT OR REPLACE INTO reading_logs (entry_id,user_id,date,page_from,page_to,pages_read,estimated,no_streak,touched) VALUES (?,?,?,?,?,?,0,0,0)');
  ins.run(eids[0], idy, '2025-02-01', 0, 30, 30); ins.run(eids[0], idy, '2025-02-02', 30, 60, 30); ins.run(eids[0], idy, '2025-02-03', 60, 70, 10); ins.run(eids[1], idy, '2025-02-10', 0, 20, 20);
  ins.run(eids[2], idy, '2025-05-04', 0, 15, 15); ins.run(eids[2], idy, '2025-05-06', 15, 20, 5);
  r = await yc('GET', '/api/me/year-summary?year=2025'); const s = r.j;
  t('yil=2025 sayilar', r.s === 200 && s.year === 2025 && s.finished.books === 4 && s.finished.movies === (fm ? 1 : 0) && s.finished.total === 4 + (fm ? 1 : 0), s);
  t('toplam sayfa', s.total_pages === 110, s);
  t('en uzun seri 3', s.longest_streak === 3, s);
  t('en cok okunan ay', s.best_month && s.best_month.month === '2025-02' && s.best_month.pages === 90, s);
  t('ortalama puan', s.avg_rating === 4.3, s);
  t('top3 puana gore', s.top_rated.length === 3 && s.top_rated[0].title === 'Yil Kitabi 4' && s.top_rated[1].title === 'Yil Kitabi 1' && s.top_rated[2].title === 'Yil Kitabi 3', s.top_rated);
  t('ilk/son biten', s.first_finished?.end_date === '2025-02-10' && s.last_finished?.end_date === '2025-12-31', s);
  r = await yc('GET', '/api/me/year-summary?year=1800'); t('gecersiz yil 400', r.s === 400, r);
  r = await yc('GET', '/api/me/year-summary?year=2024'); t('bos yil', r.j.finished.total === 0 && r.j.total_pages === 0 && r.j.best_month === null, r.j);
  r = await a('GET', '/api/me/year-summary?year=2025'); t('baskasinin verisi karismaz', r.j.finished.total === 0, r.j);

  // ---- export ----
  await yc('POST', '/api/notes', { catalog_id: kk[0], body: 'export notu, virgullu "tirnakli"' });
  await yc('PUT', '/api/me/goals', { monthly_pages: 100, yearly_books: 5 });
  await yc('POST', `/api/entries/${eids[0]}/comments`, { body: 'export yorumu' });
  r = await yc('GET', '/api/me/export', null, true); let j; try { j = JSON.parse(r.text); } catch {}
  t('export varsayilan json + attachment', r.s === 200 && /attachment/.test(r.h.get('content-disposition')) && /json/.test(r.h.get('content-type')) && j, r.s);
  t('export icerigi', j && j.entries.length === 5 && j.entries[0].logs.length === 3 && j.comments.length === 1 && j.notes.length === 1 && j.goals.yearly_books === 5 && Array.isArray(j.ratings), j && Object.keys(j));
  t('export sadece kendi verisi', j && j.entries.every((e) => e.user_id === idy) && !JSON.stringify(j).includes('password'), j && j.user);
  r = await yc('GET', '/api/me/export?format=csv', null, true);
  const lines = r.text.replace(/^﻿/, '').trim().split('\r\n');
  t('csv BOM + attachment + satir sayisi', r.s === 200 && r.bom && /attachment/.test(r.h.get('content-disposition')) && /csv/.test(r.h.get('content-type')) && lines.length === 6 && /^id,type,title/.test(lines[0]), { s: r.s, n: lines.length });
  t('csv kayit satiri', lines.some((l) => l.includes('Yil Kitabi 4') && l.includes(',bitti,')), lines);
  r = await yc('GET', '/api/me/export?format=xml', null, true); t('gecersiz format 400', r.s === 400, r.s);
  r = await mk()('GET', '/api/me/export', null, true); t('export girissiz 401', r.s === 401, r.s);

  // ---- hesap silme ----
  const cnt = (tb) => db.prepare(`SELECT COUNT(*) c FROM ${tb} WHERE user_id=?`).get(idy).c;
  t('silmeden once not+hedef var', cnt('notes') === 1 && cnt('user_goals') === 1, 0);
  r = await yc('DELETE', '/api/me', { password: 'secret1' }); t('hesap silinir', r.s === 200, r);
  t('notlar ve hedefler gitti', cnt('notes') === 0 && cnt('user_goals') === 0 && cnt('entries') === 0, 0);
  r = await a('GET', '/api/notes'); t('digerinin notlari duruyor', r.j.total === 3, r);

  console.log(fail ? `\nFAIL=${fail}` : '\nfail=0');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
