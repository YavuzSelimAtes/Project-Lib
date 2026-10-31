import { addDays, diffDays, round1, todayStr, userToday, publicUser } from '../util.js';
import { entryDayModel, prePagesDate } from './entries.js';
import { seasonRows, watchedOf, ensureSeasons } from './seasons.js';
import { queueMovieRuntimes } from './catalog.js';

export const MIN_AVG_DAYS = 3;

export function periodRange(period, today = todayStr()) {
  if (period === 'month') return { from: today.slice(0, 8) + '01', to: today };
  if (period === 'year') return { from: today.slice(0, 5) + '01-01', to: today };
  return { from: null, to: null };
}
const inRange = (d, r) => (!r.from || d >= r.from) && (!r.to || d <= r.to);

// Bir kullanicinin kitaplarindan gun-bazli birlesik model
// scope: null (tum kayitlar) ya da (sutun) => SQL kosulu; gruba acik kayitlarla sinirlar. groupScope(ids) ile uretilir
export const groupScope = (groupIds) => (col) => `${col} IN (SELECT entry_id FROM entry_groups WHERE group_id IN (${groupIds.length ? groupIds.map((g) => Math.trunc(Number(g))).join(',') : 'NULL'}))`;
const sc = (scope, col) => (scope ? ` AND ${scope(col)}` : '');

export function userModel(db, userId, period = 'all', today = userToday(db, userId), scope = null) {
  const range = periodRange(period, today);
  const entries = db.prepare(`SELECT * FROM entries WHERE user_id=? AND type='book' AND status<>'planlandi'${sc(scope, 'id')}`).all(userId);
  const days = new Map(); // date -> {real, est, books:Set(title)}
  const spanDays = new Set();
  let finished = [];
  let pre = 0; // eklemedeki baslangic sayfalari (donemde baslayan kitaplar): sadece toplama, gun/ortalama/rekora girmez
  const titles = new Map();
  for (const e of entries) {
    const m = entryDayModel(db, e, today);
    const usable = !m.excluded; // baslangici bilinmeyen kitap ortalamaya/gune girmez
    const title = (titles.get(e.catalog_id) ?? titles.set(e.catalog_id, db.prepare('SELECT title FROM catalog WHERE id=?').get(e.catalog_id)?.title).get(e.catalog_id));
    if (usable) for (let i = 0; i < m.spanDays; i++) {
      const d = addDays(m.from, i);
      if (inRange(d, range)) spanDays.add(d);
    }
    if (usable) for (const [d, v] of m.days) {
      if (!inRange(d, range)) continue;
      const cur = days.get(d) || { real: 0, est: 0, books: new Set() };
      cur.real += v.real;
      cur.est += v.est;
      if (v.real > 0 && title) cur.books.add(title);
      days.set(d, cur);
    }
    if (e.pre_pages > 0 && (period === 'all' || inRange(prePagesDate(e), range))) pre += e.pre_pages;
    if (e.status === 'bitti' && e.end_date && inRange(e.end_date, range)) finished.push({ title, end_date: e.end_date });
  }
  for (const d of days.keys()) spanDays.add(d);
  let total = 0;
  for (const v of days.values()) total += v.real + v.est;
  return { days, spanDays, total, pre, totalPages: total + pre, finished, range }; // total: gunluk ortalama tabani; totalPages: gorunen toplam
}

export function averageOf(model) {
  if (!model.spanDays.size || model.total <= 0) return null;
  return round1(model.total / model.spanDays.size);
}

export function recordOf(model) {
  let best = null;
  for (const [d, v] of model.days) {
    if (v.real <= 0) continue;
    if (!best || v.real > best.pages || (v.real === best.pages && d < best.date)) best = { pages: v.real, date: d, books: [...v.books] };
  }
  return best;
}

// Seri gunleri: gercek okuma gunleri + kullanicinin kendi guncelledigi (tahmini isaretli) gunler; esit bolunen/dolgu gunler sayilmaz
export function streakDates(db, userId) {
  return db.prepare('SELECT DISTINCT date FROM reading_logs WHERE user_id=? AND pages_read>0 AND no_streak=0 AND (estimated=0 OR touched=1) ORDER BY date').all(userId).map((r) => r.date);
}

export function streaksOf(db, userId, today = userToday(db, userId)) {
  const rows = streakDates(db, userId);
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const d of rows) {
    run = prev && diffDays(prev, d) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = d;
  }
  let current = 0;
  if (prev && diffDays(prev, today) <= 1) current = run;
  return { current, longest, active: rows.length, last_date: prev };
}

// Dizi/film istatistikleri (period: bitis tarihi periyotta olan kayitlar; devam/birakildi dizilerde son guncelleme gunu)
export function mediaStats(db, userId, period, today = todayStr(), scope = null) {
  const range = periodRange(period, today);
  const inP = (d) => period === 'all' || (!!d && inRange(d, range));
  const dayOf = (iso) => (iso ? todayStr(new Date(iso)) : null);
  let episodes = 0;
  let minutes = 0;
  let unknown = false;
  const series = db.prepare(`SELECT e.*, c.runtime AS crt FROM entries e JOIN catalog c ON c.id=e.catalog_id WHERE e.user_id=? AND e.type='series' AND e.status<>'planlandi'${sc(scope, 'e.id')}`).all(userId);
  const rowsCache = new Map();
  const progSum = db.prepare('SELECT COALESCE(SUM(episodes),0) ep, COALESCE(SUM(minutes),0) mn FROM series_progress WHERE entry_id=? AND (? IS NULL OR date>=?) AND (? IS NULL OR date<=?)');
  for (const e of series) {
    if (!rowsCache.has(e.catalog_id)) rowsCache.set(e.catalog_id, seasonRows(db, e.catalog_id));
    const rows = rowsCache.get(e.catalog_id);
    if (e.status === 'bitti') {
      // bitis aninda sabitlenen toplam (yeni sezon sonradan sisirmesin); sabitlenmemis eski kayit ilk hesapta sabitlenir
      let eps = e.finished_episodes;
      let mins = e.finished_minutes;
      if (eps == null) {
        const w = watchedOf(rows, e, e.crt);
        if (w.unknown) { if (inP(e.end_date)) unknown = true; continue; }
        eps = w.episodes; mins = w.minutes;
        db.prepare('UPDATE entries SET finished_episodes=?, finished_minutes=? WHERE id=?').run(eps, mins, e.id);
      }
      if (inP(e.end_date)) { episodes += eps; minutes += mins; }
    } else if (period === 'all') {
      const w = watchedOf(rows, e, e.crt);
      if (w.unknown) unknown = true;
      episodes += w.episodes;
      minutes += w.minutes;
    } else {
      // devam/birakildi + donem filtresi: yalniz O DONEMDE kaydedilen bolum ilerlemesi (series_progress); ilerleme gunlugu olmayan eski kayitlar sayilmaz
      const p = progSum.get(e.id, range.from, range.from, range.to, range.to);
      episodes += Math.max(0, p.ep);
      minutes += Math.max(0, p.mn);
    }
  }
  const movies = db.prepare(`SELECT e.end_date, c.runtime FROM entries e JOIN catalog c ON c.id=e.catalog_id WHERE e.user_id=? AND e.type='movie' AND e.status='bitti'${sc(scope, 'e.id')}`).all(userId).filter((m) => inP(m.end_date));
  let movieMinutes = 0;
  let movieUnknown = 0;
  for (const m of movies) {
    if (m.runtime > 0) movieMinutes += m.runtime;
    else movieUnknown++;
  }
  return { episodes_watched: episodes, series_minutes: Math.round(minutes), movie_minutes: movieMinutes, episodes_unknown: unknown, movie_runtime_unknown: movieUnknown };
}

// Arka planda eksik dizi sezon bilgisi / film suresi doldurur (istatistik cagrisini bekletmez)
export function backfillMediaInfo(db, userId) {
  try {
    const sers = db.prepare("SELECT DISTINCT c.* FROM entries e JOIN catalog c ON c.id=e.catalog_id WHERE e.user_id=? AND e.type='series' AND c.source='tvmaze' AND c.seasons_fetched_at IS NULL").all(userId);
    const movs = db.prepare("SELECT DISTINCT c.id FROM entries e JOIN catalog c ON c.id=e.catalog_id WHERE e.user_id=? AND e.type='movie' AND e.status='bitti' AND c.runtime IS NULL").all(userId).map((r) => r.id);
    if (movs.length) queueMovieRuntimes(db, movs);
    if (sers.length) (async () => { for (const c of sers) { try { await ensureSeasons(db, c); } catch { /* onemsiz */ } } })();
  } catch { /* veritabani kapanmis olabilir */ }
}

export function userStats(db, user, period = 'all', scope = null) {
  const today = userToday(db, user.id);
  const m = userModel(db, user.id, period, today, scope);
  const st = streaksOf(db, user.id, today);
  const range = m.range;
  const inP = (d) => d && inRange(d, range);
  const movies = db.prepare(`SELECT end_date FROM entries WHERE user_id=? AND type='movie' AND status='bitti'${sc(scope, 'id')}`).all(user.id).filter((r) => period === 'all' || inP(r.end_date)).length;
  const seriesFinished = db.prepare(`SELECT end_date FROM entries WHERE user_id=? AND type='series' AND status='bitti'${sc(scope, 'id')}`).all(user.id).filter((r) => period === 'all' || inP(r.end_date)).length;
  const seriesActive = db.prepare(`SELECT COUNT(*) c FROM entries WHERE user_id=? AND type='series' AND status='devam'${sc(scope, 'id')}`).get(user.id).c;
  return {
    user: publicUser(user),
    total_pages: Math.round(m.totalPages),
    books_finished: m.finished.length,
    movies_watched: movies,
    series_active: seriesActive,
    series_finished: seriesFinished,
    avg_pages_per_day: averageOf(m),
    record: recordOf(m),
    current_streak: st.current,
    longest_streak: st.longest,
    active_days: st.active,
    ...mediaStats(db, user.id, period, today, scope),
  };
}

// Gunluk seri liderligi: value = guncel seri (gun), detail = {longest, last_date}. period yok sayilir.
function streakBoard(db, users) {
  const rows = [];
  for (const u of users) {
    const s = streaksOf(db, u.id);
    if (s.current > 0) rows.push({ user: publicUser(u), value: s.current, detail: { longest: s.longest, last_date: s.last_date } });
  }
  rows.sort((a, b) => b.value - a.value || b.detail.longest - a.detail.longest || a.user.display_name.localeCompare(b.user.display_name, 'tr'));
  let rank = 0;
  return rows.map((r, i) => {
    if (i === 0 || r.value !== rows[i - 1].value || r.detail.longest !== rows[i - 1].detail.longest) rank = i + 1;
    return { rank, ...r };
  });
}

// En uzun seri liderligi: value = gecmisteki en uzun seri (gun), detail = {current, last_date}. period yok sayilir.
function bestStreakBoard(db, users) {
  const rows = [];
  for (const u of users) {
    const s = streaksOf(db, u.id);
    if (s.longest > 0) rows.push({ user: publicUser(u), value: s.longest, detail: { current: s.current, last_date: s.last_date } });
  }
  rows.sort((a, b) => b.value - a.value || b.detail.current - a.detail.current || a.user.display_name.localeCompare(b.user.display_name, 'tr'));
  let rank = 0;
  return rows.map((r, i) => {
    if (i === 0 || r.value !== rows[i - 1].value) rank = i + 1;
    return { rank, ...r };
  });
}

// groupId: grubun uyeleri, sadece gruba acik kayitlardan (seri ise kisinin tum kayitlarindan); groupId yoksa yalniz meId (Hesabim)
export function leaderboard(db, kind, period = 'all', { groupId = null, meId = null } = {}) {
  const users = groupId
    ? db.prepare('SELECT u.* FROM users u JOIN group_members m ON m.user_id=u.id AND m.group_id=? WHERE u.active=1 AND u.kind<>\'manager\'').all(groupId)
    : db.prepare('SELECT * FROM users WHERE active=1 AND id=?').all(meId);
  const scope = groupId ? groupScope([groupId]) : null;
  if (kind === 'streak') return streakBoard(db, users);
  if (kind === 'best_streak') return bestStreakBoard(db, users);
  const rows = [];
  for (const u of users) {
    const m = userModel(db, u.id, period, undefined, scope);
    let value = 0;
    let detail = {};
    if (kind === 'record') {
      const r = recordOf(m);
      if (r) { value = r.pages; detail = { date: r.date, books: r.books.slice(0, 5), books_total: r.books.length }; }
    } else if (kind === 'average') {
      const a = m.spanDays.size >= MIN_AVG_DAYS ? averageOf(m) : null; // az veriyle liste oynanmasin
      if (a) { value = a; detail = { total_pages: Math.round(m.total), days: m.spanDays.size }; }
    } else {
      value = m.finished.length;
      const titles = m.finished.sort((a, b) => a.end_date.localeCompare(b.end_date)).map((f) => f.title);
      detail = { books: titles.slice(-5), books_total: titles.length };
    }
    if (value > 0) rows.push({ user: publicUser(u), value, detail });
  }
  rows.sort((a, b) => b.value - a.value || a.user.display_name.localeCompare(b.user.display_name, 'tr'));
  let rank = 0;
  return rows.map((r, i) => {
    if (i === 0 || r.value !== rows[i - 1].value) rank = i + 1;
    return { rank, ...r };
  });
}
