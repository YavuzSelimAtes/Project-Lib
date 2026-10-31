// Kitap eklenirken zaten okunmus baslangic sayfasi (pre_pages): donemin toplamina eklenir, gun duzeltmesi hala dusurur.
// Calisan test backend'i gerekir (node testler/start-backend.js --fresh)
const B = 'http://localhost:4100';
const mk = () => { let ck = ''; return async (m, p, body) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', cookie: ck }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0];
  return { s: r.status, j: await r.json().catch(() => null) };
}; };
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log(ok ? 'OK  ' : 'FAIL', n, ok ? '' : JSON.stringify(x)); };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return ymd(d); };
(async () => {
  const u = mk(), adm = mk();
  await u('POST', '/api/auth/register', { username: 'prep', display_name: 'prep', password: 'secret1', avatar: '🦊' });
  await adm('POST', '/api/auth/login', { username: 'admin', password: 'test-admin-123' });
  const uid = (await u('GET', '/api/auth/me')).j.user.id;
  const book = async (title, pages = 300) => (await adm('POST', '/api/admin/catalog', { type: 'book', title, pages })).j.item.id;
  const year = new Date().getFullYear();
  const yearPages = async (y = year) => (await u('GET', `/api/me/year-summary?year=${y}`)).j.total_pages;
  const monthPages = async () => (await u('GET', '/api/me/goals')).j.goals.month_pages;
  const allPages = async () => (await u('GET', `/api/users/${uid}/stats?period=all`)).j.total_pages;
  t('basta hepsi 0', (await yearPages()) === 0 && (await monthPages()) === 0 && (await allPages()) === 0, {});

  // 1) bu ay 17. sayfadan eklenir
  let r = await u('POST', '/api/entries', { catalog_id: await book('Pre Bir'), status: 'devam', current_page: 17 }); t('17. sayfadan eklendi', r.s === 201, r);
  t('yil ozeti +17', (await yearPages()) === 17, await yearPages());
  t('aylik hedef +17', (await monthPages()) === 17, await monthPages());
  t('genel toplam +17', (await allPages()) === 17, await allPages());
  const st = (await u('GET', `/api/users/${uid}/stats?period=all`)).j;
  t('gunluk ortalama/rekor etkilenmez', !st.avg_pages_per_day && !st.record, st);

  // 2) gecen yil baslayan kitap: bu yila/aya girmez, gecen yila ve geneline girer
  r = await u('POST', '/api/entries', { catalog_id: await book('Pre Iki'), status: 'devam', current_page: 40, start_date: `${year - 1}-06-01` }); t('gecen yil baslayan eklendi', r.s === 201, r);
  t('bu yil degismez', (await yearPages()) === 17, await yearPages());
  t('gecen yil +40', (await yearPages(year - 1)) === 40, await yearPages(year - 1));
  t('bu ay degismez', (await monthPages()) === 17, await monthPages());
  t('genel toplam 57', (await allPages()) === 57, await allPages());

  // 3) gun duzeltmesi hala toplami dusurur (base_page yolu): 2 gun x 30 sayfa, bir gun 10'a indirilir
  const e3 = await u('POST', '/api/entries', { catalog_id: await book('Pre Uc'), status: 'devam', start_date: daysAgo(3), current_page: 60, backfill: 'manual', days: [{ date: daysAgo(2), pages: 30 }, { date: daysAgo(1), pages: 30 }] });
  t('gunluk kayitli kitap', e3.s === 201, e3);
  const before = await yearPages(); // 17 + 60 gunluk kayit (pre yok: backfill var)
  t('backfill kitabinda pre yok', before === 77, before);
  r = await u('PUT', `/api/entries/${e3.j.entry.id}/day-logs`, { days: [{ date: daysAgo(1), pages: 10 }], keep_current: true }); t('duzeltme', r.s === 200, r);
  t('duzeltme toplami 20 dusurur, pre degismez', (await yearPages()) === before - 20 && (await allPages()) === 57 + 40, { y: await yearPages(), a: await allPages() });

  console.log('fail=' + fail);
  process.exit(fail ? 1 : 0);
})();
