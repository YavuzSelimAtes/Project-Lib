import { requireUser, requireAdmin } from '../auth.js';
import { err, bad, int, oneOf, todayStr, publicUser } from '../util.js';
import { norm } from '../services/sources.js';
import { notify } from '../services/notify.js';
import { catalogOut } from '../services/catalog.js';
import { getEntry } from '../services/entries.js';
import { GENRES, SCALE, ratingSummary, canRate, saveRatings } from '../services/ratings.js';
import { tx } from '../db.js';

const NUDGE_TEXT = 'Neden okumuyorsun? Bir sayfa bile olur 📖';

export default async function routes(app) {
  const db = app.db;
  const needBook = (id) => {
    const c = db.prepare('SELECT * FROM catalog WHERE id=?').get(id);
    if (!c) throw err(404, 'Katalog kaydi bulunamadi');
    if (c.type !== 'book') throw bad('Puanlama sadece kitaplar icindir');
    return c;
  };

  // ---- kitap puanlama ----
  app.get('/api/book-metrics', async (req) => {
    requireUser(req);
    return { scale: SCALE, genres: Object.fromEntries(Object.entries(GENRES).map(([k, g]) => [k, { label: g.label, metrics: g.metrics }])) };
  });
  const ratingOut = (userId, cat) => ({ ...ratingSummary(db, cat.id, userId), can_rate: canRate(db, userId, cat.id) });
  app.get('/api/catalog/:id/ratings', async (req) => {
    const me = requireUser(req);
    return ratingOut(me.id, needBook(Number(req.params.id)));
  });
  // Kural: kitap, kullanicinin listesinde 'devam' / 'bitti' / 'birakildi' olmali (sadece 'planlandi' yetmez). Tur yoksa genre ile secilir.
  // Secili turun TUM metrikleri gonderilmeli (1-5). Tekrar gonderim mevcut puani gunceller.
  app.put('/api/catalog/:id/ratings', async (req) => {
    const me = requireUser(req);
    const cat = needBook(Number(req.params.id));
    if (!canRate(db, me.id, cat.id)) throw err(403, 'Puan vermek için kitabı bitirmiş ya da bırakmış olmalısın');
    const b = req.body || {};
    tx(db, () => saveRatings(db, me.id, cat.id, b.genre, b.scores));
    return ratingOut(me.id, cat);
  });
  app.delete('/api/catalog/:id/ratings', async (req) => {
    const me = requireUser(req);
    const cat = needBook(Number(req.params.id));
    db.prepare('DELETE FROM book_ratings WHERE user_id=? AND catalog_id=?').run(me.id, cat.id);
    return ratingOut(me.id, cat);
  });

  // ---- tebrikler ----
  const WHAT = { book: 'kitabı bitirdiğin', series: 'diziyi bitirdiğin', movie: 'filmi izlediğin' };
  app.post('/api/entries/:id/congrats', async (req) => {
    const me = requireUser(req);
    const e = getEntry(db, Number(req.params.id));
    if (!e) throw err(404, 'Kayit bulunamadi');
    if (e.user_id === me.id) throw bad('Kendinizi tebrik edemezsiniz');
    if (e.status !== 'bitti') throw bad('Sadece bitmis kayitlar tebrik edilebilir');
    const ins = db.prepare('INSERT OR IGNORE INTO congrats (sender_id,entry_id,created_at) VALUES (?,?,?)').run(me.id, e.id, new Date().toISOString());
    const count = () => db.prepare('SELECT COUNT(*) c FROM congrats WHERE entry_id=?').get(e.id).c;
    if (!ins.changes) return { ok: true, already_sent: true, message: 'Zaten tebrik gonderdin', congrats_count: count(), i_congratulated: true };
    const title = db.prepare('SELECT title FROM catalog WHERE id=?').get(e.catalog_id)?.title;
    notify(db, e.user_id, { kind: 'congrats', title: `${me.display_name} ${WHAT[e.type]} için seni tebrik etti 🎉`, body: title, link: { type: 'entry', id: e.id } });
    return { ok: true, already_sent: false, congrats_count: count(), i_congratulated: true };
  });

  // ---- genel kitaplik ----
  // Listeye giren kitap: en az bir kullanicinin 'devam'/'bitti'/'birakildi' kaydi olan kitaplar (sadece planlananlar girmez)
  const LIB_FROM = `FROM catalog c JOIN entries e ON e.catalog_id=c.id AND e.status IN ('devam','bitti','birakildi') WHERE c.type='book'`;
  app.get('/api/library', async (req) => {
    requireUser(req);
    const q = req.query;
    const where = [];
    const args = [];
    const words = norm(q.q || '').split(' ').filter(Boolean).slice(0, 6);
    for (const w of words) { where.push("c.norm LIKE ? ESCAPE '\\'"); args.push(`%${w.replace(/[\\%_]/g, '\\$&')}%`); }
    const genre = oneOf(q.genre, ['kurgu', 'felsefe'], { field: 'genre' });
    if (genre) { where.push('c.genre=?'); args.push(genre); }
    const sort = oneOf(q.sort, ['recent', 'title', 'rating', 'readers'], { field: 'sort' }) || 'recent';
    const limit = Math.min(int(q.limit, { min: 1, max: 100, field: 'limit' }) || 30, 100);
    const offset = int(q.offset, { min: 0, field: 'offset' }) || 0;
    const w = where.length ? ' AND ' + where.join(' AND ') : '';
    const total = db.prepare(`SELECT COUNT(DISTINCT c.id) c ${LIB_FROM}${w}`).get(...args).c;
    const order = { recent: 'MAX(e.updated_at) DESC', title: 'c.title COLLATE NOCASE ASC', rating: 'rating_avg IS NULL, rating_avg DESC, c.title', readers: 'readers_count DESC, c.title' }[sort];
    const rows = db.prepare(`SELECT c.*, COUNT(DISTINCT e.user_id) readers_count,
        COUNT(DISTINCT CASE WHEN e.status='devam' THEN e.user_id END) reading_count,
        COUNT(DISTINCT CASE WHEN e.status='bitti' THEN e.user_id END) finished_count,
        (SELECT AVG(score) FROM book_ratings r WHERE r.catalog_id=c.id) rating_avg,
        (SELECT COUNT(DISTINCT user_id) FROM book_ratings r WHERE r.catalog_id=c.id) rating_count
      ${LIB_FROM}${w} GROUP BY c.id ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, offset);
    return { items: rows.map(libOut), total };
  });
  const libOut = (r) => ({
    ...catalogOut(r),
    readers_count: r.readers_count, reading_count: r.reading_count, finished_count: r.finished_count,
    rating_average: r.rating_avg == null ? null : Math.round(r.rating_avg * 100) / 100, rating_count: r.rating_count,
  });
  app.get('/api/library/:id', async (req) => {
    const me = requireUser(req);
    const id = Number(req.params.id);
    const row = db.prepare(`SELECT c.*, COUNT(DISTINCT e.user_id) readers_count,
        COUNT(DISTINCT CASE WHEN e.status='devam' THEN e.user_id END) reading_count,
        COUNT(DISTINCT CASE WHEN e.status='bitti' THEN e.user_id END) finished_count,
        (SELECT AVG(score) FROM book_ratings r WHERE r.catalog_id=c.id) rating_avg,
        (SELECT COUNT(DISTINCT user_id) FROM book_ratings r WHERE r.catalog_id=c.id) rating_count
      FROM catalog c LEFT JOIN entries e ON e.catalog_id=c.id AND e.status IN ('devam','bitti','birakildi') WHERE c.id=? AND c.type='book' GROUP BY c.id`).get(id);
    if (!row) throw err(404, 'Kitap bulunamadi');
    const readers = db.prepare(`SELECT e.id entry_id, e.status, e.user_id, u.display_name, u.avatar, u.color FROM entries e JOIN users u ON u.id=e.user_id
      WHERE e.catalog_id=? AND e.status IN ('devam','bitti','birakildi') ORDER BY e.updated_at DESC`).all(id)
      .map((r) => ({ entry_id: r.entry_id, status: r.status, user: publicUser({ id: r.user_id, display_name: r.display_name, avatar: r.avatar, color: r.color }) }));
    return {
      item: libOut(row), readers, rating: ratingOut(me.id, row),
      comment_count: db.prepare('SELECT COUNT(*) c FROM comments c JOIN entries e ON e.id=c.entry_id WHERE e.catalog_id=?').get(id).c,
      question_count: db.prepare('SELECT COUNT(*) c FROM questions q JOIN entries e ON e.id=q.entry_id WHERE e.catalog_id=?').get(id).c,
    }; // yorumlar / sorular: GET /api/library/:id/comments ve /questions (social.js)
  });

  // ---- yonetici: "neden okumuyorsun?" ----
  app.get('/api/admin/reading-status', async (req) => {
    requireAdmin(req);
    const today = todayStr();
    const all = req.query.all === '1' || req.query.all === 'true';
    const users = db.prepare("SELECT id,display_name,avatar,color FROM users WHERE active=1 AND role<>'admin' ORDER BY display_name COLLATE NOCASE").all();
    const out = users.map((u) => {
      const readToday = !!db.prepare('SELECT 1 FROM reading_logs WHERE user_id=? AND date=? AND pages_read>0').get(u.id, today);
      const activeBooks = db.prepare("SELECT COUNT(*) c FROM entries WHERE user_id=? AND type='book' AND status='devam'").get(u.id).c;
      const anyBook = !!db.prepare("SELECT 1 FROM entries WHERE user_id=? AND type='book'").get(u.id);
      return {
        user: publicUser(u), bugun_okumadi: !readToday, aktif_kitap_yok: activeBooks === 0, kitap_eklemedi: !anyBook, active_books: activeBooks,
        last_read_date: db.prepare('SELECT MAX(date) d FROM reading_logs WHERE user_id=? AND pages_read>0').get(u.id).d || null,
        nudged_today: !!db.prepare("SELECT 1 FROM push_log WHERE user_id=? AND kind='nudge' AND day=?").get(u.id, today),
      };
    });
    return { date: today, users: all ? out : out.filter((x) => x.bugun_okumadi || x.aktif_kitap_yok) };
  });
  app.post('/api/admin/users/:id/nudge', async (req) => {
    requireAdmin(req);
    const u = db.prepare('SELECT id,active FROM users WHERE id=?').get(Number(req.params.id));
    if (!u) throw err(404, 'Kullanici bulunamadi');
    if (!u.active) throw bad('Pasif kullaniciya bildirim gonderilemez');
    const today = todayStr();
    if (!db.prepare("INSERT OR IGNORE INTO push_log (user_id,kind,day) VALUES (?,'nudge',?)").run(u.id, today).changes) {
      throw err(409, 'Bu kişiye bugün zaten hatırlatma gönderildi', undefined, 'ALREADY_SENT');
    }
    notify(db, u.id, { kind: 'nudge', title: NUDGE_TEXT, link: null });
    return { ok: true, sent: true };
  });
}
