import { addDays, diffDays, round1, todayStr, publicUser } from '../util.js';
import { entryDayModel } from './entries.js';

export const MIN_AVG_DAYS = 3;

export function periodRange(period, today = todayStr()) {
  if (period === 'month') return { from: today.slice(0, 8) + '01', to: today };
  if (period === 'year') return { from: today.slice(0, 5) + '01-01', to: today };
  return { from: null, to: null };
}
const inRange = (d, r) => (!r.from || d >= r.from) && (!r.to || d <= r.to);

// Bir kullanicinin kitaplarindan gun-bazli birlesik model
export function userModel(db, userId, period = 'all', today = todayStr()) {
  const range = periodRange(period, today);
  const entries = db.prepare("SELECT * FROM entries WHERE user_id=? AND type='book' AND status<>'planlandi'").all(userId);
  const days = new Map(); // date -> {real, est, books:Set(title)}
  const spanDays = new Set();
  let finished = [];
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
    if (e.status === 'bitti' && e.end_date && inRange(e.end_date, range)) finished.push({ title, end_date: e.end_date });
  }
  for (const d of days.keys()) spanDays.add(d);
  let total = 0;
  for (const v of days.values()) total += v.real + v.est;
  return { days, spanDays, total, finished, range };
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

export function streaksOf(db, userId, today = todayStr()) {
  const rows = db.prepare('SELECT DISTINCT date FROM reading_logs WHERE user_id=? AND pages_read>0 AND estimated=0 ORDER BY date').all(userId).map((r) => r.date);
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
  return { current, longest, active: rows.length };
}

export function userStats(db, user, period = 'all') {
  const today = todayStr();
  const m = userModel(db, user.id, period, today);
  const st = streaksOf(db, user.id, today);
  const range = m.range;
  const inP = (d) => d && inRange(d, range);
  const movies = db.prepare("SELECT end_date FROM entries WHERE user_id=? AND type='movie' AND status='bitti'").all(user.id).filter((r) => period === 'all' || inP(r.end_date)).length;
  const seriesFinished = db.prepare("SELECT end_date FROM entries WHERE user_id=? AND type='series' AND status='bitti'").all(user.id).filter((r) => period === 'all' || inP(r.end_date)).length;
  const seriesActive = db.prepare("SELECT COUNT(*) c FROM entries WHERE user_id=? AND type='series' AND status='devam'").get(user.id).c;
  return {
    user: publicUser(user),
    total_pages: Math.round(m.total),
    books_finished: m.finished.length,
    movies_watched: movies,
    series_active: seriesActive,
    series_finished: seriesFinished,
    avg_pages_per_day: averageOf(m),
    record: recordOf(m),
    current_streak: st.current,
    longest_streak: st.longest,
    active_days: st.active,
  };
}

export function leaderboard(db, kind, period = 'all') {
  const users = db.prepare('SELECT * FROM users WHERE active=1').all();
  const rows = [];
  for (const u of users) {
    const m = userModel(db, u.id, period);
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
