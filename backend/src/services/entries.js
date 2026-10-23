import { addDays, diffDays, nowIso, round1, todayStr, publicUser, bad, err } from '../util.js';
import { catalogOut } from './catalog.js';

export const getEntry = (db, id) => db.prepare('SELECT * FROM entries WHERE id=?').get(id);

export const pagesReadOf = (db, e) => {
  if (e.type !== 'book' || e.status === 'planlandi') return 0;
  const base = e.base_page || 0; // kayit acilirken zaten okunmus sayfalar okuma sayilmaz
  if (e.status === 'bitti' && e.total_pages) return Math.max(0, e.total_pages - base);
  return Math.max(0, (e.current_page || 0) - base);
};

// Bir kitap kaydinin gun-bazli sayfa modeli: Map(date -> {real, est}) + aralik + kaynak
export function entryDayModel(db, e, today = todayStr()) {
  const logs = db.prepare('SELECT date,pages_read,estimated FROM reading_logs WHERE entry_id=? ORDER BY date').all(e.id);
  const days = new Map();
  let sumLogs = 0;
  let hasEst = false;
  for (const l of logs) {
    sumLogs += l.pages_read; // duzeltme (geri alma) satirlari negatif olabilir
    if (l.pages_read <= 0) continue;
    days.set(l.date, l.estimated ? { real: 0, est: l.pages_read } : { real: l.pages_read, est: 0 });
    if (l.estimated) hasEst = true;
  }
  const pagesRead = Math.max(pagesReadOf(db, e), sumLogs);
  const firstLog = logs[0]?.date;
  const lastLog = logs[logs.length - 1]?.date;
  const from = e.start_date || firstLog || todayStr(new Date(e.created_at));
  let to;
  if (e.status === 'devam') to = e.end_date || today;
  else to = e.end_date || lastLog || from;
  if (diffDays(from, to) < 0) to = from;
  const spanDays = diffDays(from, to) + 1;
  const remainder = pagesRead - sumLogs;
  if (remainder > 0.5 && spanDays > 0) {
    const free = [];
    for (let i = 0; i < spanDays; i++) {
      const d = addDays(from, i);
      if (!days.has(d)) free.push(d);
    }
    if (free.length) {
      const each = remainder / free.length;
      for (const d of free) days.set(d, { real: 0, est: each });
    } else {
      const last = days.get(to) || { real: 0, est: 0 };
      last.est += remainder;
      days.set(to, last);
    }
  }
  const hasRealLog = logs.some((l) => l.pages_read > 0 && !l.estimated);
  // Tarihi bilinmeyen (baslangic yok) ya da tek gunluk 'bitti' + gercek log yok -> ortalamaya GIRMEZ ('tarih yok')
  const excluded = (!e.start_date && logs.length === 0) || (e.status === 'bitti' && spanDays <= 1 && !hasRealLog);
  return { days, from, to, spanDays, pagesRead, remainder: Math.max(0, remainder), hasEst, hasLogs: logs.length > 0, excluded };
}

export function entryAvg(db, e, today = todayStr()) {
  if (e.type !== 'book') return { avg: null, source: null };
  const m = entryDayModel(db, e, today);
  if (e.status === 'planlandi' || !m.pagesRead) return { avg: null, source: null };
  if (m.excluded) return { avg: null, source: 'no_dates' };
  return { avg: round1(m.pagesRead / m.spanDays), source: m.remainder > 0.5 || m.hasEst ? 'estimated' : 'logs' };
}

export function entryOut(db, e, { withCatalog = true, withUser = true } = {}) {
  const out = {
    id: e.id, user_id: e.user_id, catalog_id: e.catalog_id, type: e.type, status: e.status,
    start_date: e.start_date, end_date: e.end_date, total_pages: e.total_pages, current_page: e.current_page,
    season: e.season, episode: e.episode, rating: e.rating, created_at: e.created_at, updated_at: e.updated_at,
    percent: null, avg_pages_per_day: null, avg_source: null,
  };
  if (e.type === 'book') {
    if (e.total_pages > 0) out.percent = e.status === 'bitti' ? 100 : Math.min(100, round1((e.current_page / e.total_pages) * 100));
    const a = entryAvg(db, e);
    out.avg_pages_per_day = a.avg;
    out.avg_source = a.source;
  }
  if (withCatalog) out.catalog = catalogOut(db.prepare('SELECT * FROM catalog WHERE id=?').get(e.catalog_id));
  if (withUser) out.user = publicUser(db.prepare('SELECT id,display_name,avatar,color FROM users WHERE id=?').get(e.user_id));
  return out;
}

// Gunluk ilerleme uygular (islem icinde cagrilmali). Entry satirini gunceller, sonuc dondurur.
export function applyProgress(db, e, currentPage, date, { estimate = false } = {}) {
  const today = todayStr();
  if (date > today) throw bad('Gelecek bir tarih icin ilerleme girilemez', { date: 'gelecek tarih' });
  if (e.start_date && date < e.start_date) throw bad('Tarih baslangic tarihinden once olamaz', { date: 'baslangictan once' });
  if (currentPage < 0) throw bad('Sayfa negatif olamaz', { current_page: 'negatif' });
  if (e.total_pages && currentPage > e.total_pages) throw bad(`Sayfa, toplam sayfa sayisini (${e.total_pages}) asamaz`, { current_page: 'toplamdan buyuk' });
  const delta = currentPage - e.current_page;
  const completing = !!e.total_pages && currentPage === e.total_pages && e.status !== 'bitti';
  if (delta === 0 && !completing) {
    const s = db.prepare('SELECT COALESCE(SUM(pages_read),0) s FROM reading_logs WHERE entry_id=? AND date=?').get(e.id, date).s;
    return { delta: 0, pagesOnDate: s, finished: false, spread: 1, estimated: false };
  }
  let spread = 1;
  let estimated = false;
  if (delta > 0) {
    // Son log gununden (log yoksa baslangic tarihinden) bu tarihe kadar atlanan gunler varsa fark o gunlere
    // esit bolunur ve 'tahmini' isaretlenir (rekora/seriye girmez). En fazla son 90 gun.
    const lastLog = db.prepare('SELECT MAX(date) d FROM reading_logs WHERE entry_id=?').get(e.id).d;
    let gapStart = lastLog ? (date > lastLog ? addDays(lastLog, 1) : null) : (e.start_date && e.start_date < date ? e.start_date : null);
    if (gapStart && gapStart < addDays(date, -89)) gapStart = addDays(date, -89);
    const n = gapStart ? diffDays(gapStart, date) + 1 : 1;
    if (n > 1) {
      const base = Math.floor(delta / n);
      const rest = delta % n;
      const ins = db.prepare('INSERT INTO reading_logs (entry_id,user_id,date,page_from,page_to,pages_read,estimated) VALUES (?,?,?,?,?,?,1)');
      let page = e.current_page;
      for (let i = 0; i < n; i++) {
        const p = base + (i >= n - rest ? 1 : 0);
        if (p <= 0) continue;
        ins.run(e.id, e.user_id, addDays(gapStart, i), page, page + p, p);
        page += p;
      }
      spread = n;
      estimated = true;
    } else {
      const row = db.prepare('SELECT * FROM reading_logs WHERE entry_id=? AND date=?').get(e.id, date);
      // Ilk guncelleme ve baslangic tarihi bilinmiyorsa (planlandi -> ilk ilerleme) onceki okuma bilinmez: tahmini
      const est = estimate || (!lastLog && !e.start_date) ? 1 : 0; // 'bitti' isaretiyle kapatilan kalan sayfalar tahmini sayilir (rekor sismesin)
      if (row) db.prepare('UPDATE reading_logs SET pages_read=pages_read+?, page_to=?, estimated=MAX(estimated,?) WHERE id=?').run(delta, currentPage, est, row.id);
      else db.prepare('INSERT INTO reading_logs (entry_id,user_id,date,page_from,page_to,pages_read,estimated) VALUES (?,?,?,?,?,?,?)').run(e.id, e.user_id, date, e.current_page, currentPage, delta, est);
      estimated = !!est;
    }
  } else if (delta < 0) {
    // Duzeltme: onay (confirm) route'ta istenir. Gecmis log'lar SILINMEZ; o gunun satirina negatif fark yazilir
    // (yazim hatasini sonra duzeltmek net sonucu bozmaz).
    const row = db.prepare('SELECT * FROM reading_logs WHERE entry_id=? AND date=?').get(e.id, date);
    if (row) db.prepare('UPDATE reading_logs SET pages_read=pages_read+?, page_to=? WHERE id=?').run(delta, currentPage, row.id);
    else db.prepare('INSERT INTO reading_logs (entry_id,user_id,date,page_from,page_to,pages_read,estimated) VALUES (?,?,?,?,?,?,0)').run(e.id, e.user_id, date, e.current_page, currentPage, delta);
  }
  let status = e.status;
  let start = e.start_date;
  let end = e.end_date;
  let finished = false;
  if (e.total_pages && currentPage === e.total_pages) {
    status = 'bitti';
    end = date;
    finished = true;
  } else if (delta !== 0 || status === 'planlandi') {
    if (status !== 'devam') { status = 'devam'; end = null; }
  }
  if (!start && status !== 'planlandi') start = date;
  if (status === 'devam') end = null;
  db.prepare('UPDATE entries SET current_page=?, status=?, start_date=?, end_date=?, updated_at=? WHERE id=?')
    .run(currentPage, status, start, end, nowIso(), e.id);
  const pagesOnDate = db.prepare('SELECT COALESCE(SUM(pages_read),0) s FROM reading_logs WHERE entry_id=? AND date=?').get(e.id, date).s;
  return { delta, pagesOnDate, finished, spread, estimated };
}

// ---------- gun gun okuma kaydi ----------
const OPEN_WINDOW = 90;

// Kullanicinin "kac sayfa okudun?" diye sorulabilecek gunleri: satiri hic olmayan ('open') ve
// tahmini ('estimated') gunler. 'Okumadim' (0) ve gercek girilmis gunler listelenmez.
export function openDays(db, e, today = todayStr()) {
  if (e.type !== 'book' || e.status === 'planlandi') return [];
  const rows = db.prepare('SELECT date,pages_read,estimated FROM reading_logs WHERE entry_id=?').all(e.id);
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const first = rows.length ? rows.map((r) => r.date).sort()[0] : null;
  let from = e.start_date || first || today;
  if (first && first < from) from = first;
  const to = e.status === 'devam' ? today : (e.end_date || today);
  if (diffDays(from, to) < 0) return [];
  if (diffDays(from, to) + 1 > OPEN_WINDOW) from = addDays(to, -(OPEN_WINDOW - 1));
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const r = byDate.get(d);
    if (!r) out.push({ date: d, state: 'open', pages: 0 });
    else if (r.estimated) out.push({ date: d, state: 'estimated', pages: r.pages_read });
  }
  return out;
}

// Tek gunun okunan sayfasini ayarla (pages>=0; 0 = okumadim). add=true ise mevcut gercek degere EKLER.
// Gercek (estimated=0) satir yazilir. Tahmini bir satir degistiriliyorsa fark diger tahmini satirlara dagitilir
// (kullanicinin "su an X. sayfadayim" bilgisi bozulmasin); dagitilacak satir yoksa current_page degisir.
export function setDayPages(db, e, date, pages, { add = false } = {}) {
  const today = todayStr();
  if (e.type !== 'book') throw bad('Gunluk sayfa kaydi sadece kitaplar icindir');
  if (!e.total_pages) throw bad('Once kitabin toplam sayfa sayisini girin', { total_pages: 'gerekli' });
  if (date > today) throw bad('Gelecek bir gun icin kayit girilemez', { date: 'gelecek tarih' });
  if (e.start_date && date < e.start_date) throw bad('Tarih baslangic tarihinden once olamaz', { date: 'baslangictan once' });
  const row = db.prepare('SELECT * FROM reading_logs WHERE entry_id=? AND date=?').get(e.id, date);
  const old = row ? row.pages_read : 0;
  const wasEst = !!row?.estimated;
  const next = add && row && !wasEst ? old + pages : pages;
  if (next < 0) throw bad('Sayfa negatif olamaz', { pages: 'negatif' });
  let diff = next - old;
  let current = e.current_page;
  if (wasEst && diff !== 0) {
    const others = db.prepare('SELECT * FROM reading_logs WHERE entry_id=? AND estimated=1 AND date<>? AND pages_read>0').all(e.id, date);
    if (others.length) {
      // diff>0: gunun payi artti -> diger tahminlerden dus; diff<0: artir
      let need = diff; // dusulecek miktar (negatifse eklenecek)
      const cap = others.reduce((a, r) => a + r.pages_read, 0);
      if (need > cap) throw bad(`Bu gun icin en fazla ${old + cap} sayfa girilebilir (kalan gunlerin tahmini sayfalari bu kadar)`, { pages: 'fazla' });
      const n = others.length;
      const order = [...others].sort((a, b) => b.date.localeCompare(a.date));
      const base = Math.trunc(need / n);
      let rest = need - base * n;
      for (const r of order) {
        let take = base + (rest > 0 ? 1 : rest < 0 ? -1 : 0);
        if (rest > 0) rest--; else if (rest < 0) rest++;
        take = Math.min(take, r.pages_read);
        db.prepare('UPDATE reading_logs SET pages_read=?, page_to=page_from+? WHERE id=?').run(r.pages_read - take, r.pages_read - take, r.id);
      }
      diff = 0;
    }
  }
  current += diff;
  if (current < 0) throw bad('Sayfa sayisi 0\'in altina dusemez', { pages: 'cok dusuk' });
  if (current > e.total_pages) throw bad(`Toplam sayfa sayisini (${e.total_pages}) asiyor`, { pages: 'toplamdan buyuk' });
  if (row) db.prepare('UPDATE reading_logs SET pages_read=?, page_from=?, page_to=?, estimated=0 WHERE id=?').run(next, Math.max(0, current - next), current, row.id);
  else db.prepare('INSERT INTO reading_logs (entry_id,user_id,date,page_from,page_to,pages_read,estimated) VALUES (?,?,?,?,?,?,0)').run(e.id, e.user_id, date, Math.max(0, current - next), current, next);
  db.prepare('DELETE FROM reading_logs WHERE entry_id=? AND estimated=1 AND pages_read=0').run(e.id);
  let status = e.status;
  let start = e.start_date;
  let end = e.end_date;
  if (!start) start = date;
  if (current === e.total_pages) {
    status = 'bitti';
    end = db.prepare('SELECT MAX(date) d FROM reading_logs WHERE entry_id=? AND pages_read>0').get(e.id).d || date;
  } else if (status !== 'devam' && (next > 0 || diff !== 0)) {
    status = 'devam';
    end = null;
  }
  db.prepare('UPDATE entries SET current_page=?, status=?, start_date=?, end_date=?, updated_at=? WHERE id=?').run(current, status, start, end, nowIso(), e.id);
  return { pages: next, date };
}
