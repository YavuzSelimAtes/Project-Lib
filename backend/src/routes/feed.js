import { requireUser } from '../auth.js';
import { userToday, bad, date as vdate } from '../util.js';
import { oneOf, todayStr, addDays, nowIso, publicUser, round1 } from '../util.js';
import { entryAvg } from '../services/entries.js';
import { leaderboard, streaksOf } from '../services/stats.js';
import { editionBrief, getEdition } from '../services/editions.js';
import { seriesExtras } from '../services/seasons.js';
import { scopeGroup } from '../groups.js';
import { storiesFor } from './stories.js';

const CARD_MAX = 8; // kart basina en fazla 8 oge, kalani more_count
const TITLES = { record: 'Rekor', average: 'Gunluk ortalama', finished: 'En cok kitap bitiren', streak: 'Gunluk seri', best_streak: 'En uzun seri' };

export default async function routes(app) {
  const db = app.db;

  app.get('/api/feed', async (req) => {
    const me = requireUser(req);
    const groupId = scopeGroup(db, me, req.query.group); // yoksa: Hesabim (yalniz kendi kayitlarim)
    const today = todayStr();
    const movieFrom = new Date(Date.now() - 48 * 3600 * 1000).toISOString(); // EKLENME zamanindan 48 saat
    const doneFrom = addDays(today, -2); // biten kitap/dizi: son 3 gun
    // Yonetici hesabi kendi okumasi yoksa kartlardan gizlenir
    const users = (groupId
      ? db.prepare("SELECT u.id,u.display_name,u.avatar,u.color FROM users u JOIN group_members gm ON gm.user_id=u.id AND gm.group_id=? WHERE u.active=1 AND u.kind<>'manager' AND (u.role<>'admin' OR EXISTS (SELECT 1 FROM entries e WHERE e.user_id=u.id AND e.status<>'planlandi'))").all(groupId)
      : db.prepare('SELECT id,display_name,avatar,color FROM users WHERE id=?').all(me.id));
    const vis = groupId ? ' AND EXISTS (SELECT 1 FROM entry_groups eg WHERE eg.entry_id=e.id AND eg.group_id=?)' : ' AND e.user_id=?';
    const entries = db.prepare(`SELECT e.*, c.title, c.author_or_creator, c.year, c.cover_url, c.id AS cid, c.type AS ctype, ed.cover_url AS ed_cover
      FROM entries e JOIN catalog c ON c.id=e.catalog_id LEFT JOIN editions ed ON ed.id=e.edition_id
      WHERE ((e.type IN ('book','series') AND e.status='devam')
         OR (e.type IN ('book','series') AND e.status='bitti' AND e.end_date>=?)
         OR (e.type='movie' AND e.status='bitti' AND e.created_at>=?))${vis}`).all(doneFrom, movieFrom, groupId || me.id);
    const pagesToday = db.prepare('SELECT entry_id, SUM(pages_read) p FROM reading_logs WHERE date=? GROUP BY entry_id').all(today).filter((r) => entries.some((e) => e.id === r.entry_id));
    const ptMap = new Map(pagesToday.map((r) => [r.entry_id, r.p]));
    // tebrik sayisi: yalniz bu kapsamdaki kisilerden (grup uyeleri / kendim)
    const cg = new Map(db.prepare(`SELECT entry_id, COUNT(*) n, SUM(sender_id=?) mine FROM congrats WHERE ${groupId ? 'sender_id IN (SELECT user_id FROM group_members WHERE group_id=?)' : 'sender_id=?'} GROUP BY entry_id`).all(me.id, groupId || me.id).map((r) => [r.entry_id, r]));
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
        avg_pages_per_day: e.type === 'book' ? entryAvg(db, e).avg : null,
        updated_at: e.updated_at,
        ...(e.status === 'bitti' ? { congrats_count: cg.get(e.id)?.n || 0, i_congratulated: !!cg.get(e.id)?.mine } : {}),
        edition: e.edition_id ? editionBrief(getEdition(db, e.edition_id)) : null,
        ...(e.type === 'series' ? seriesExtras(db, e.cid, e.season) : {}),
      };
      byUser.get(e.user_id)?.push(item);
    }
    const stories = storiesFor(db, me, users.map((u) => u.id), groupId);
    const cards = users.map((u) => {
      const items = byUser.get(u.id).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      return { user: publicUser(u), current_streak: streaksOf(db, u.id).current, last_activity: items[0]?.updated_at || null, items: items.slice(0, CARD_MAX), stories: stories.get(u.id) || [], more_count: Math.max(0, items.length - CARD_MAX) };
    });
    cards.sort((a, b) => (b.last_activity || '').localeCompare(a.last_activity || '') || a.user.display_name.localeCompare(b.user.display_name, 'tr'));
    const activity = cards.flatMap((c) => c.items.map((i) => ({ user: c.user, ...i }))).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 30);
    return { generated_at: nowIso(), cards, activity };
  });

  // Bugun: grup uyeleri bugun (kendi saat dilimlerine gore) ne yapti. Sira: sayfa (cok->az), esitlikte dizi bolumu, sonra film. Gece 00'da kendiliginden sifirlanir (tarihe bagli).
  app.get('/api/today', async (req) => {
    const me = requireUser(req);
    const groupId = scopeGroup(db, me, req.query.group);
    const users = groupId
      ? db.prepare("SELECT u.id,u.display_name,u.avatar,u.color FROM users u JOIN group_members gm ON gm.user_id=u.id AND gm.group_id=? WHERE u.active=1 AND u.kind<>'manager'").all(groupId)
      : db.prepare('SELECT id,display_name,avatar,color FROM users WHERE id=?').all(me.id);
    const vis = groupId ? ' AND EXISTS (SELECT 1 FROM entry_groups eg WHERE eg.entry_id=e.id AND eg.group_id=?)' : ' AND e.user_id<>0';
    const va = (uid) => (groupId ? [uid, groupId] : [uid]);
    const rows = [];
    // ?date=YYYY-AA-GG gecmis bir gunu gosterir (hepsi icin ayni takvim gunu); bos ya da bugun ise herkes kendi saat dilimindeki bugunu
    const myToday = userToday(db, me.id);
    const asked = vdate(req.query.date, { field: 'date' });
    if (asked && asked > myToday) throw bad('Gelecek bir gun gosterilemez', { date: 'gelecek tarih' });
    const fixed = asked && asked < myToday ? asked : null;
    let day = fixed || myToday;
    for (const u of users) {
      if (!fixed) day = userToday(db, u.id);
      const logs = db.prepare(`SELECT e.id, c.title, SUM(l.pages_read) p FROM reading_logs l JOIN entries e ON e.id=l.entry_id JOIN catalog c ON c.id=e.catalog_id WHERE l.user_id=? AND l.date=?${vis.replace('e.user_id<>0', '1=1')} GROUP BY e.id HAVING p>0`).all(u.id, day, ...(groupId ? [groupId] : []));
      const eps = db.prepare(`SELECT e.id, c.title, SUM(s.episodes) n FROM series_progress s JOIN entries e ON e.id=s.entry_id JOIN catalog c ON c.id=e.catalog_id WHERE s.user_id=? AND s.date=?${vis.replace('e.user_id<>0', '1=1')} GROUP BY e.id HAVING n>0`).all(u.id, day, ...(groupId ? [groupId] : []));
      const done = db.prepare(`SELECT e.type, c.title FROM entries e JOIN catalog c ON c.id=e.catalog_id WHERE e.user_id=? AND e.status='bitti' AND e.end_date=?${vis.replace('e.user_id<>0', '1=1')}`).all(u.id, day, ...(groupId ? [groupId] : []));
      const movies = done.filter((d) => d.type === 'movie').map((d) => d.title);
      const finishedBooks = done.filter((d) => d.type === 'book').map((d) => d.title);
      const finishedSeries = done.filter((d) => d.type === 'series').map((d) => d.title);
      const pages = logs.reduce((s, x) => s + x.p, 0);
      const episodes = eps.reduce((s, x) => s + x.n, 0);
      if (!pages && !episodes && !movies.length && !finishedBooks.length && !finishedSeries.length) continue;
      rows.push({
        user: publicUser(u), pages, episodes, movies: movies.length, series_done: finishedSeries.length,
        did: [
          ...logs.map((x) => x.title), ...eps.map((x) => x.title), ...movies.map((t) => t + ' (film)'),
        ].filter((v, i, a) => a.indexOf(v) === i),
        finished: [...finishedBooks, ...finishedSeries.map((t) => t + ' (dizi)')],
      });
    }
    const sw = (r) => (r.episodes > 0 || r.series_done > 0 ? 1 : 0);
    rows.sort((a, b) => b.pages - a.pages || sw(b) - sw(a) || b.episodes - a.episodes || b.movies - a.movies || a.user.display_name.localeCompare(b.user.display_name, 'tr'));
    return { date: fixed || myToday, today: myToday, rows: rows.map((r, i) => ({ rank: i + 1, ...r })) };
  });

  for (const kind of ['record', 'average', 'finished', 'streak', 'best_streak']) {
    app.get(`/api/leaderboards/${kind}`, async (req) => {
      const me = requireUser(req);
      const groupId = scopeGroup(db, me, req.query.group);
      // seri liderliginde period yok sayilir (gecersiz deger bile hata vermez)
      const period = (kind === 'streak' || kind === 'best_streak') ? 'all' : (oneOf(req.query.period, ['all', 'year', 'month'], { field: 'period' }) || 'all');
      return { period, title: TITLES[kind], group_id: groupId, entries: leaderboard(db, kind, period, { groupId, meId: me.id }) };
    });
  }
}
