// Grup kapsami: iki grup + ortak uye + gruba kapali kayit; feed, liderlik, kayit erisimi, yorum/puan gorunurlugu, katalog yetkisi.
// Calisan test backend'i gerekir (node testler/start-backend.js --fresh); testi tek seferde calistirin.
const B = process.env.TEST_API || 'http://localhost:4100';
const mk = () => { let ck = ''; return async (m, p, body) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', cookie: ck }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0];
  return { s: r.status, j: await r.json().catch(() => null) };
}; };
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log(ok ? 'OK  ' : 'FAIL', n, ok ? '' : JSON.stringify(x)); };
const acc = (u) => ({ username: u, display_name: u, password: 'secret1', avatar: '🦊' });
const SC = { senaryo: 4, akicilik: 4, karakterler: 4, dil: 4, duygu: 4 };
(async () => {
  const { DatabaseSync } = require('node:sqlite');
  const dbPath = process.env.TEST_DB || require('node:path').join(__dirname, 'data', 'test.db');
  const a = mk(), b = mk(), c = mk(), d = mk(), adm = mk();
  const id = async (u) => (await u('GET', '/api/auth/me')).j.user.id;
  for (const [u, n] of [[a, 'scpa'], [b, 'scpb'], [c, 'scpc'], [d, 'scpd']]) await u('POST', '/api/auth/register', acc(n));
  await adm('POST', '/api/auth/login', { username: 'admin', password: 'test-admin-123' });
  const [ida, idb, idc, idd] = [await id(a), await id(b), await id(c), await id(d)];
  const asMgr = async (u, name) => { const gr = await u('POST', '/api/groups', { name }); const m = mk(); await m('POST', '/api/auth/login', { username: 'scp' + (u === a ? 'a' : 'b'), password: 'secret1' }); await m('POST', '/api/auth/switch', { user_id: gr.j.manager_id }); return [gr.j.group.id, m]; };
  const [g1, ao] = await asMgr(a, 'G1'); // grup sahibi = yonetici hesap (ao / bo); a, b kisisel hesap ve sadece uye
  const [g2, bo] = await asMgr(b, 'G2');
  await c('POST', `/api/join/${(await ao('GET', `/api/groups/${g1}/invite`)).j.token}`, {});
  await c('POST', `/api/join/${(await bo('GET', `/api/groups/${g2}/invite`)).j.token}`, {});

  // ---- katalog yetkisi ----
  let r = await ao('POST', '/api/admin/catalog', { type: 'book', title: 'Kitap Bir', pages: 100 }); t('grup sahibi katalog ekler', r.s === 201, r); const cat1 = r.j.item.id;
  r = await ao('POST', '/api/admin/catalog', { type: 'book', title: 'Kitap Iki', pages: 100 }); const cat2 = r.j.item.id;
  r = await ao('POST', '/api/admin/catalog', { type: 'book', title: 'Kitap Uc', pages: 100 }); const cat3 = r.j.item.id;
  r = await c('POST', '/api/admin/catalog', { type: 'book', title: 'Uye Kitap', pages: 10 }); t('sade uye katalog ekleyemez 403', r.s === 403, r);
  r = await d('POST', '/api/admin/catalog', { type: 'book', title: 'Grupsuz Kitap', pages: 10 }); t('grupsuz katalog ekleyemez 403', r.s === 403, r);
  r = await bo('PATCH', `/api/admin/catalog/${cat1}`, { pages: 120 }); t('baska grup sahibi duzenler', r.s === 200 && r.j.item.pages === 120, r);
  r = await bo('POST', `/api/admin/catalog/${cat1}/editions`, { language: 'tr', publisher: 'Yayin', pages: 120 }); t('grup sahibi baski ekler', r.s === 201, r);
  r = await a('GET', '/api/admin/users'); t('grup sahibi /admin/users 403', r.s === 403, r);
  r = await adm('GET', '/api/admin/users'); t('platform admin /admin/users 200', r.s === 200, r);
  r = await a('POST', `/api/admin/users/${idc}/reset-password`, { password: 'yeni123' }); t('grup sahibi sifre sifirlayamaz', r.s === 403, r);
  r = await a('GET', '/api/admin/backup'); t('yedek platform admin', r.s === 403, r);
  const cdb = new DatabaseSync(dbPath);
  const legacy = Number(cdb.prepare("INSERT INTO catalog (type,title,pages,norm,created_at) VALUES ('book','Eski Kitap',50,'eski kitap',?)").run(new Date().toISOString()).lastInsertRowid);
  const legacy2 = Number(cdb.prepare("INSERT INTO catalog (type,title,pages,norm,created_at) VALUES ('book','Eski Iki',50,'eski iki',?)").run(new Date().toISOString()).lastInsertRowid);
  t('created_by yazildi', cdb.prepare('SELECT created_by FROM catalog WHERE id=?').get(cat1).created_by === (await id(ao)) && cdb.prepare('SELECT created_by FROM catalog WHERE id=?').get(legacy).created_by == null, {});
  r = await ao('DELETE', `/api/admin/catalog/${legacy}`); t('eski kaydi grup sahibi silemez 403', r.s === 403, r);
  r = await bo('DELETE', `/api/admin/catalog/${cat3}`); t('baskasinin ekledigini silemez 403', r.s === 403, r);
  r = await adm('DELETE', `/api/admin/catalog/${legacy}`); t('platform admin siler', r.s === 200, r);
  r = await ao('DELETE', `/api/admin/catalog/${cat3}`); t('kendi ekledigini (kayitsiz) siler', r.s === 200, r);

  // ---- kayitlar ----
  const ent = async (u, cat, status, groups) => { const x = await u('POST', '/api/entries', { catalog_id: cat, status }); if (x.s !== 201) return { bad: x }; if (groups) await u('PUT', `/api/entries/${x.j.entry.id}/groups`, groups); return x.j.entry.id; };
  const eA1 = await ent(a, cat1, 'devam');                  // G1'de gorunur
  const eA2 = await ent(a, cat2, 'devam', { none: true });  // kapali
  const eB1 = await ent(b, cat2, 'devam');                  // G2
  const eC1 = await ent(c, cat1, 'bitti');                  // G1 + G2
  const eC2 = await ent(c, legacy2, 'bitti', { none: true }); // kapali
  const eC3 = await ent(c, cat2, 'bitti', { group_ids: [g2] }); // yalniz G2
  r = await ao('DELETE', `/api/admin/catalog/${cat1}`); t('kaydi olan katalog silinemez (409)', r.s === 409, r);
  const ids = (j) => (j.cards || []).flatMap((x) => x.items.map((i) => i.entry_id));

  // ---- feed ----
  r = await a('GET', `/api/feed?group=${g1}`); t('feed G1: A ve C kayitlari, kapali/diger grup yok', r.s === 200 && ids(r.j).includes(eA1) && ids(r.j).includes(eC1) && !ids(r.j).includes(eA2) && !ids(r.j).includes(eC2) && !ids(r.j).includes(eB1) && !ids(r.j).includes(eC3), ids(r.j));
  t('feed G1 kartlarda yalniz G1 uyeleri', r.j.cards.every((x) => [ida, idc].includes(x.user.id)), r.j.cards.map((x) => x.user.id));
  r = await a('GET', '/api/feed'); t('feed grupsuz: yalniz kendi (Hesabim)', r.s === 200 && r.j.cards.length === 1 && r.j.cards[0].user.id === ida && ids(r.j).includes(eA1), r.j);
  r = await a('GET', `/api/feed?group=${g2}`); t('uye olmadigim grup 403', r.s === 403, r);
  r = await b('GET', `/api/feed?group=${g2}`); t('feed G2: B+C(G2) kayitlari', ids(r.j).includes(eB1) && ids(r.j).includes(eC1) && ids(r.j).includes(eC3) && !ids(r.j).includes(eA1) && !ids(r.j).includes(eC2), ids(r.j));
  t('feed G2 etkinlik sizdirmaz', r.j.activity.every((x) => [idb, idc].includes(x.user.id)), r.j.activity);

  // ---- liderlik ----
  r = await a('GET', `/api/leaderboards/finished?group=${g1}`); const cv = r.j.entries.find((x) => x.user.id === idc);
  t('liderlik G1: C yalniz gruba acik kayittan (1 kitap)', r.s === 200 && cv && cv.value === 1 && !r.j.entries.some((x) => x.user.id === idb), r.j);
  r = await c('GET', '/api/leaderboards/finished'); t('liderlik Hesabim: C tum kayitlardan (2) ve yalniz kendisi', r.j.entries.length === 1 && r.j.entries[0].value === 3, r.j);
  r = await a('GET', `/api/leaderboards/streak?group=${g2}`); t('liderlik uye olmadigim grup 403', r.s === 403, r);
  r = await b('GET', `/api/leaderboards/best_streak?group=${g2}`); t('seri liderligi gruba ozel', r.s === 200 && r.j.entries.every((x) => [idb, idc].includes(x.user.id)), r.j);

  // ---- kayit erisimi ----
  r = await b('GET', `/api/entries/${eA1}`); t('ortak grup yok -> 404', r.s === 404, r);
  r = await c('GET', `/api/entries/${eA1}`); t('ortak grupta gorunen -> 200', r.s === 200, r);
  r = await c('GET', `/api/entries/${eA2}`); t('kapali kayit ortak grupta bile 404', r.s === 404, r);
  r = await a('GET', `/api/entries/${eC1}`); t('A, C kaydini gorur', r.s === 200, r);
  r = await a('GET', `/api/entries/${eC3}`); t('A, yalniz G2 kaydini goremez', r.s === 404, r);
  r = await a('GET', `/api/entries/${eA2}`); t('sahibi kapali kaydi gorur', r.s === 200, r);
  r = await a('GET', `/api/entries?user_id=${idc}`); t('A -> C raf: yalniz G1 kayitlari', r.s === 200 && r.j.entries.map((x) => x.id).join() === String(eC1), r.j);
  r = await c('GET', `/api/entries?user_id=${idc}`); t('kendi raf: hepsi', r.j.entries.length === 3, r.j);
  r = await a('GET', `/api/entries?user_id=${idb}`); t('ortak grup yok raf 403', r.s === 403, r);
  r = await a('GET', `/api/entries`); t('user_id yok -> kendi kayitlarim', r.j.entries.every((x) => x.user_id === ida) && r.j.entries.length === 2, r.j);
  r = await a('GET', `/api/entries?group=${g1}`); t('grup kapsami tum gorunur kayitlar', r.j.entries.map((x) => x.id).sort().join() === [eA1, eC1].sort().join(), r.j.entries.map((x) => x.id));
  r = await a('GET', `/api/users/${idc}/stats`); t('stats ortak grup: yalniz G1 kaydi', r.s === 200 && r.j.books_finished === 1, r.j);
  r = await a('GET', `/api/users/${idb}/stats`); t('stats ortak grup yok 403', r.s === 403, r);
  r = await c('GET', `/api/users/${idc}/stats`); t('kendi stats tum kayit', r.j.books_finished === 3, r.j);
  r = await a('GET', `/api/users/${idb}/heatmap`); t('heatmap ortak grup yok 403', r.s === 403, r);
  r = await a('GET', `/api/users/${idc}/calendar?from=2026-01-01&to=2026-12-31`); t('calendar ortak grupta 200', r.s === 200, r);

  // ---- tebrik ----
  r = await b('POST', `/api/entries/${eC1}/congrats`); t('tebrik: ortak grupta gorunen 200', r.s === 200, r);
  r = await a('POST', `/api/entries/${eC3}/congrats`); t('tebrik: gorunmeyen kayit 404', r.s === 404, r);
  r = await b('POST', `/api/entries/${eA1}/congrats`); t('tebrik: ortak grup yok 404', r.s === 404, r);

  // ---- yorum gorunurlugu ----
  r = await c('POST', `/api/entries/${eC1}/comments`, { body: 'varsayilan' }); t('yorum varsayilan 201', r.s === 201 && r.j.comment.group_ids.length === 2, r); const cm1 = r.j.comment.id;
  r = await c('POST', `/api/entries/${eC1}/comments`, { body: 'sadece G1', group_ids: [g1] }); t('yorum tek grup', r.s === 201 && r.j.comment.group_ids.join() === String(g1), r); const cm2 = r.j.comment.id;
  r = await c('POST', `/api/entries/${eC1}/comments`, { body: 'sadece ben', none: true }); t('yorum sadece ben', r.s === 201 && r.j.comment.group_ids.length === 0, r); const cm3 = r.j.comment.id;
  r = await c('POST', `/api/entries/${eC1}/comments`, { body: 'x', group_ids: [99999] }); t('izinsiz grup 400', r.s === 400, r);
  r = await c('POST', `/api/entries/${eC3}/comments`, { body: 'x', group_ids: [g1] }); t('kaydin gorunmedigi gruba yorum acilamaz 400', r.s === 400, r);
  const lib = async (u, cat, q = '') => (await u('GET', `/api/library/${cat}/comments${q}`)).j.comments.map((x) => x.id).sort();
  t('kitap yorumlari A (G1)', (await lib(a, cat1)).join() === [cm1, cm2].sort().join(), await lib(a, cat1));
  t('kitap yorumlari B (G2)', (await lib(b, cat1)).join() === String(cm1), await lib(b, cat1));
  t('kitap yorumlari C (kendi: hepsi)', (await lib(c, cat1)).length === 3, await lib(c, cat1));
  t('kitap yorumlari D (grupsuz): hic', (await lib(d, cat1)).length === 0, await lib(d, cat1));
  r = await b('GET', `/api/entries/${eC1}/comments`); t('kayit yorumlari B', r.s === 200 && r.j.comments.length === 1, r.j);
  r = await d('GET', `/api/entries/${eC1}/comments`); t('kayit yorumlari D 404', r.s === 404, r);
  r = await b('PUT', `/api/comments/${cm2}/reaction`, { emoji: '👍' }); t('gorunmeyen yoruma tepki 404', r.s === 404, r);
  r = await a('PUT', `/api/comments/${cm1}/groups`, { all: true }); t('baskasinin yorumunun gorunurlugu degismez 403', r.s === 403, r);
  r = await c('PUT', `/api/comments/${cm3}/groups`, { all: true }); t('sonradan tum gruplara acilir', r.s === 200 && r.j.group_ids.length === 2, r);
  t('acilinca B de gorur', (await lib(b, cat1)).length === 2, await lib(b, cat1));
  r = await c('PUT', `/api/comments/${cm3}/groups`, { none: true }); t('sonradan kapatilir', r.j.group_ids.length === 0, r);
  r = await a('GET', `/api/library/${cat1}?group=${g1}`); t('kitap detayi G1: yorum sayisi 2', r.s === 200 && r.j.comment_count === 2, r.j);
  r = await a('GET', `/api/library/${cat1}`); t('kitap detayi okuyucular: yalniz gorunenler', r.j.readers.length === 2, r.j.readers);
  r = await b('GET', `/api/library/${cat1}`); t('kitap detayi B: A okuyucu degil, C var', r.j.readers.length === 1 && r.j.readers[0].user.id === idc, r.j.readers);

  // ---- puan gorunurlugu ----
  r = await c('PUT', `/api/catalog/${cat1}/ratings`, { genre: 'kurgu', scores: SC }); t('puan verildi (varsayilan tum gruplar)', r.s === 200 && r.j.mine_group_ids.length === 2, r);
  r = await a('GET', `/api/catalog/${cat1}/ratings`); t('A puani gorur', r.j.count === 1 && r.j.average === 4, r.j);
  r = await b('GET', `/api/catalog/${cat1}/ratings`); t('B puani gorur', r.j.count === 1, r.j);
  r = await d('GET', `/api/catalog/${cat1}/ratings`); t('D (grupsuz) puani gormez', r.j.count === 0 && r.j.average === null, r.j);
  r = await c('PUT', `/api/catalog/${cat1}/ratings/groups`, { group_ids: [g2] }); t('puan sadece G2', r.s === 200 && r.j.mine_group_ids.join() === String(g2), r);
  r = await a('GET', `/api/catalog/${cat1}/ratings`); t('A artik gormez', r.j.count === 0, r.j);
  r = await b('GET', `/api/catalog/${cat1}/ratings`); t('B hala gorur', r.j.count === 1, r.j);
  r = await a('GET', `/api/library?group=${g1}`); const it = r.j.items.find((x) => x.id === cat1); t('kitaplik G1: puan ortalamasi gizli', r.s === 200 && it && it.rating_count === 0 && it.readers_count === 2, it);
  r = await b('GET', `/api/library`); t('kitaplik Hesabim: yalniz kendi kitaplarim', r.j.items.every((x) => x.id === cat2), r.j.items.map((x) => x.id));
  r = await c('PUT', `/api/catalog/${cat1}/ratings/groups`, { none: true }); r = await b('GET', `/api/catalog/${cat1}/ratings`); t('puan sadece ben', r.j.count === 0, r.j);
  r = await a('GET', `/api/catalog/${cat1}`); t('katalog detayi: gorunen girdiler (A ve C)', r.j.entries.length === 2, r.j.entries.map((x) => x.user_id));
  r = await b('GET', `/api/catalog/${cat1}`); t('katalog detayi B: yalniz C girdisi', r.j.entries.length === 1 && r.j.entries[0].user_id === idc, r.j.entries.map((x) => x.user_id));

  // ---- istekler: grup sahibi yalniz kendi grubunun uyelerinin isteklerini gorur/cevaplar ----
  const rq = async (u, title) => (await u('POST', '/api/requests', { type: 'book', title })).j.request.id;
  const rC = await rq(c, 'Istek C'), rB = await rq(b, 'Istek B'), rD = await rq(d, 'Istek D');
  const rl = async (u) => (await u('GET', '/api/admin/requests')).j.requests.map((x) => x.id);
  let l = await rl(ao); t('istek: G1 sahibi A, C ve kendi grubunu gorur; B/D yok', l.includes(rC) && !l.includes(rB) && !l.includes(rD), l);
  l = await rl(bo); t('istek: G2 sahibi B, C ve B gorur; D yok', l.includes(rC) && l.includes(rB) && !l.includes(rD), l);
  l = await rl(adm); t('istek: platform admin hepsini gorur', [rC, rB, rD].every((x) => l.includes(x)), l);
  r = await ao('GET', '/api/admin/requests'); t('istek sayaclari kapsamli', Object.values(r.j.counts).reduce((x, y) => x + y, 0) === r.j.requests.length, r.j);
  r = await ao('PATCH', `/api/admin/requests/${rB}`, { status: 'inceleniyor' }); t('baska grubun istegine erisim 404', r.s === 404, r);
  r = await ao('PATCH', `/api/admin/requests/${rD}`, { status: 'inceleniyor' }); t('grupsuz kullanici istegine grup sahibi 404', r.s === 404, r);
  r = await ao('PATCH', `/api/admin/requests/${rC}`, { status: 'inceleniyor' }); t('kendi grubunun istegini cevaplar', r.s === 200, r);
  r = await adm('PATCH', `/api/admin/requests/${rD}`, { status: 'inceleniyor' }); t('platform admin her istegi cevaplar', r.s === 200, r);
  r = await c('GET', '/api/admin/requests'); t('sade uye admin istek listesi 403', r.s === 403, r);

  // ---- gruptan ayrilma ----
  r = await c('POST', `/api/groups/${g1}/leave`); t('C G1den ayrilir', r.s === 200, r);
  r = await a('GET', `/api/entries/${eC1}`); t('ayrilan kisinin kaydi artik 404', r.s === 404, r);
  t('ayrilinca yorum gorunmez', (await lib(a, cat1)).length === 0, await lib(a, cat1));
  r = await a('GET', `/api/feed?group=${g1}`); t('feed G1 ayrilani icermez', r.j.cards.every((x) => x.user.id === ida), r.j.cards.map((x) => x.user.id));
  // ---- sizinti denetimi: grup sahibi/uye siniri, davet linki yenileme, oturumsuz erisim, hesap silme artigi ----
  const anon = mk();
  const R2 = Math.random().toString(36).slice(2, 6);
  const ee = mk(); await ee('POST', '/api/auth/register', acc('scpe' + R2)); const ide = await id(ee);
  await ee('POST', `/api/join/${(await bo('GET', `/api/groups/${g2}/invite`)).j.token}`, {}); // E yalniz G2
  const eE = (await ee('POST', '/api/entries', { catalog_id: cat2, status: 'devam' })).j.entry.id;
  await ee('POST', `/api/entries/${eE}/comments`, { body: 'GIZLI' + R2 });
  await ee('POST', '/api/notes', { catalog_id: cat2, body: 'NOT' + R2 });
  r = await ee('POST', `/api/join/${(await ao('GET', `/api/groups/${g1}/invite`)).j.token}`, {}); t('E G1e de katilir', r.s < 300, r);
  for (const p of [`/api/entries/${eE}`, `/api/entries/${eE}/comments`, `/api/users/${ide}/stats`, `/api/users/${ide}/heatmap`, `/api/users/${ide}/calendar?from=2026-01-01&to=2026-12-31`, `/api/entries?user_id=${ide}`]) {
    r = await a('GET', p); t(`G1 sahibi A, E nin G2-yalniz verisine erisemez: ${p.slice(0, 40)}`, r.s === 404 || r.s === 403 || (r.s === 200 && !JSON.stringify(r.j).includes('GIZLI' + R2) && !(r.j.entries || []).length), r.s);
  }
  for (const p of [`/api/feed?group=${g1}`, `/api/library/${cat2}/comments?group=${g1}`, '/api/notes', '/api/me/export', `/api/groups/${g1}`]) { r = await a('GET', p); t('A: E nin yorum/notu sizmaz ' + p.slice(0, 40), !JSON.stringify(r.j).includes('GIZLI' + R2) && !JSON.stringify(r.j).includes('NOT' + R2), JSON.stringify(r.j).slice(0, 120)); }
  const oldTok = (await ao('GET', `/api/groups/${g1}/invite`)).j.token;
  r = await ao('POST', `/api/groups/${g1}/invite/regenerate`); t('davet linki yenilenir', r.s === 200 && r.j.token && r.j.token !== oldTok, r);
  r = await d('POST', `/api/join/${oldTok}`, {}); t('yenileme sonrasi eski link kullanilamaz', r.s >= 400, r);
  r = await anon('GET', `/api/join/${oldTok}`); t('eski link bilgi vermez', r.s >= 400, r);
  for (const p of ['/api/feed', '/api/entries', '/api/notes', '/api/me/export', '/api/groups', '/api/library', '/api/leaderboards/record', `/api/users/${ida}/stats`, `/api/entries/${eE}`, `/api/catalog/${cat1}/ratings`, '/api/admin/users', '/api/admin/backup']) { r = await anon('GET', p); t('oturumsuz 401 ' + p, r.s === 401, r.s); }
  r = await ee('DELETE', '/api/me', { password: 'secret1' }); t('E hesabini siler', r.s === 200, r);
  let left = 0; for (const tb of cdb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((x) => x.name)) if (tb !== 'users' && cdb.prepare(`PRAGMA table_info(${tb})`).all().some((c) => c.name === 'user_id')) left += cdb.prepare(`SELECT COUNT(*) c FROM ${tb} WHERE user_id=?`).get(ide).c;
  t('hesap silinince user_id tasiyan tablolarda artik yok', left === 0 && cdb.prepare('SELECT COUNT(*) c FROM entry_groups WHERE entry_id=?').get(eE).c === 0, left);
  cdb.close();
  console.log('fail=' + fail);
  process.exit(fail ? 1 : 0);
})();
