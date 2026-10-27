import { requireUser } from '../auth.js';
import { oneOf, todayStr, addDays, nowIso, publicUser, round1 } from '../util.js';
import { entryAvg } from '../services/entries.js';
import { leaderboard, streaksOf } from '../services/stats.js';
import { editionBrief, getEdition } from '../services/editions.js';
import { seriesExtras } from '../services/seasons.js';

const CARD_MAX = 8; // kart basina en fazla 8 oge, kalani more_count
const TITLES = { record: 'Rekor', average: 'Gunluk ortalama', finished: 'En cok kitap bitiren', streak: 'Gunluk seri', best_streak: 'En uzun seri' };

export default async function routes(app) {
  const db = app.db;

  app.get('/api/feed', async (req) => {
    const me = requireUser(req);
    const today = todayStr();
    const movieFrom = new Date(Date.now() - 48 * 3600 * 1000).toISOString(); // EKLENME zamanindan 48 saat
    const doneFrom = addDays(today, -2); // biten kitap/dizi: son 3 gun
    // Yonetici hesabi kendi okumasi yoksa kartlardan gizlenir
    const users = db.prepare("SELECT id,display_name,avatar,color FROM users u WHERE active=1 AND (role<>'admin' OR EXISTS (SELECT 1 FROM entries e WHERE e.user_id=u.id AND e.status<>'planlandi'))").all();
    const entries = db.prepare(`SELECT e.*, c.title, c.author_or_creator, c.year, c.cover_url, c.id AS cid, c.type AS ctype, ed.cover_url AS ed_cover
      FROM entries e JOIN catalog c ON c.id=e.catalog_id LEFT JOIN editions ed ON ed.id=e.edition_id
      WHERE (e.type IN ('book','series') AND e.status='devam')
         OR (e.type IN ('book','series') AND e.status='bitti' AND e.end_date>=?)
         OR (e.type='movie' AND e.status='bitti' AND e.created_at>=?)`).all(doneFrom, movieFrom);
    const pagesToday = db.prepare('SELECT entry_id, SUM(pages_read) p FROM reading_logs WHERE date=? GROUP BY entry_id').all(today);
    const ptMap = new Map(pagesToday.map((r) => [r.entry_id, r.p]));
    const cg = new Map(db.prepare('SELECT entry_id, COUNT(*) n, SUM(sender_id=?) mine FROM congrats GROUP BY entry_id').all(me.id).map((r) => [r.entry_id, r]));
    const byUser = new Map(users.map((u) => [u.id, []]));
    for (const e of entries) {
      let kind;
      if (e.type === 'movie') kind = 'watched_movie';
      else if (e.type === 'book') kind = e.status === 'devam' ? 'reading' : 'finished_book';
      else kind = e.status === 'devam' ? 'watching_series' : 'finished_series';
      const item = {
        kind, entry_id: e.id, status: e.status,
        catalog: { id: e.cid, type: e.ctype, title: e.title, author_or_creator: e.author_or_creator, year: e.year, cover_url: e.ed_cover || e.cover_url, cover_fallback: e.ed_cover ? e.cover_url : undefined },
        current_page: e.type === 'book' ? e.current_page : null,
        total_pages: e.total_pages,
        percent: e.type === 'book' && e.total_pages > 0 ? (e.status === 'bitti' ? 100 : Math.min(100, round1((e.current_page / e.total_pages) * 100))) : null,
        season: e.season, episode: e.episode, start_date: e.start_date, end_date: e.end_date, rating: e.rating,
        pages_today: e.type === 'book' ? (ptMap.get(e.id) || 0) : null,
        avg_pages_per_day: e.type === 'book' ? entryAvg(db, e, today).avg : null,
        updated_at: e.updated_at,
        ...(e.status === 'bitti' ? { congrats_count: cg.get(e.id)?.n || 0, i_congratulated: !!cg.get(e.id)?.mine } : {}),
        edition: e.edition_id ? editionBrief(getEdition(db, e.edition_id)) : null,
        ...(e.type === 'series' ? seriesExtras(db, e.cid, e.season) : {}),
      };
      byUser.get(e.user_id)?.push(item);
    }
    const cards = users.map((u) => {
      const items = byUser.get(u.id).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      return { user: publicUser(u), current_streak: streaksOf(db, u.id, today).current, last_activity: items[0]?.updated_at || null, items: items.slice(0, CARD_MAX), more_count: Math.max(0, items.length - CARD_MAX) };
    });
    cards.sort((a, b) => (b.last_activity || '').localeCompare(a.last_activity || '') || a.user.display_name.localeCompare(b.user.display_name, 'tr'));
    const activity = cards.flatMap((c) => c.items.map((i) => ({ user: c.user, ...i }))).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 30);
    return { generated_at: nowIso(), cards, activity };
  });

  for (const kind of ['record', 'average', 'finished', 'streak', 'best_streak']) {
    app.get(`/api/leaderboards/${kind}`, async (req) => {
      requireUser(req);
      // seri liderliginde period yok sayilir (gecersiz deger bile hata vermez)
      const period = (kind === 'streak' || kind === 'best_streak') ? 'all' : (oneOf(req.query.period, ['all', 'year', 'month'], { field: 'period' }) || 'all');
      return { period, title: TITLES[kind], entries: leaderboard(db, kind, period) };
    });
  }
}
