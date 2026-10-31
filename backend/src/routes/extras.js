import { requireUser, requireGroupAdmin } from '../auth.js';
import { err, bad, int, oneOf, todayStr, userToday, publicUser } from '../util.js';
import { norm } from '../services/sources.js';
import { notify } from '../services/notify.js';
import { catalogOut } from '../services/catalog.js';
import { getEntry } from '../services/entries.js';
import { GENRES, SCALE, ratingSummary, canRate, saveRatings } from '../services/ratings.js';
import { tx } from '../db.js';
import { scopeGroup, viewerGroups, needSeeEntry, entryVisibleSql, commentVisibleSql, ratingVisibleSql, ratingAllowedGroups, parseVisibility, setRatingGroups } from '../groups.js';

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
  const ratingOut = (userId, cat, groupId = null) => ({ ...ratingSummary(db, cat.id, userId, groupId ? [groupId] : null), can_rate: canRate(db, userId, cat.id), allowed_group_ids: ratingAllowedGroups(db, userId, cat.id) });
  app.get('/api/catalog/:id/ratings', async (req) => {
    const me = requireUser(req);
    return ratingOut(me.id, needBook(Number(req.params.id)), scopeGroup(db, me, req.query.group));
  });
  // Kural: kitap, kullanicinin listesinde 'devam' / 'bitti' / 'birakildi' olmali (sadece 'planlandi' yetmez). Tur yoksa genre ile secilir.
  // Secili turun TUM metrikleri gonderilmeli (1-5). Tekrar gonderim mevcut puani gunceller.
  app.put('/api/catalog/:id/ratings', async (req) => {
    const me = requireUser(req);
    const cat = needBook(Number(req.params.id));
    if (!canRate(db, me.id, cat.id)) throw err(403, 'Puan vermek için kitabı bitirmiş ya da bırakmış olmalısın');
    const b = req.body || {};
    // gorunurluk: group_ids / all / none verilirse uygulanir; ilk puanda varsayilan = kaydin gorunur oldugu tum gruplar; sonraki guncellemede mevcut secim korunur
    const spec = b.group_ids !== undefined || b.all === true || b.none === true;
    const had = !!db.prepare('SELECT 1 FROM book_ratings WHERE user_id=? AND catalog_id=? LIMIT 1').get(me.id, cat.id);
    const allowed = ratingAllowedGroups(db, me.id, cat.id);
    const groups = spec ? parseVisibility(b, allowed) : (had ? null : allowed);
    tx(db, () => { saveRatings(db, me.id, cat.id, b.genre, b.scores); if (groups) setRatingGroups(db, me.id, cat.id, groups); });
    return ratingOut(me.id, cat);
  });
  // Puanin gorunurlugunu sonradan degistir: { group_ids: [..] } | { all: true } | { none: true }
  app.put('/api/catalog/:id/ratings/groups', async (req) => {
    const me = requireUser(req);
    const cat = needBook(Number(req.params.id));
    if (!db.prepare('SELECT 1 FROM book_ratings WHERE user_id=? AND catalog_id=? LIMIT 1').get(me.id, cat.id)) throw err(404, 'Bu kitaba puaniniz yok');
    const b = req.body || {};
    if (b.group_ids === undefined && b.all !== true && b.none !== true) throw bad('group_ids dizisi, all veya none gerekli', { group_ids: 'zorunlu' });
    setRatingGroups(db, me.id, cat.id, parseVisibility(b, ratingAllowedGroups(db, me.id, cat.id)));
    return ratingOut(me.id, cat);
  });
  app.delete('/api/catalog/:id/ratings', async (req) => {
    const me = requireUser(req);
    const cat = needBook(Number(req.params.id));
    db.prepare('DELETE FROM book_ratings WHERE user_id=? AND catalog_id=?').run(me.id, cat.id);
    setRatingGroups(db, me.id, cat.id, []);
    return ratingOut(me.id, cat);
  });

  // ---- tebrikler ----
  const WHAT = { book: 'kitabı bitirdiğin', series: 'diziyi bitirdiğin', movie: 'filmi izlediğin' };
  app.post('/api/entries/:id/congrats', async (req) => {
    const me = requireUser(req);
    const e = needSeeEntry(db, me.id, Number(req.params.id), scopeGroup(db, me, req.query.group)); // yalniz ortak grupta gorunen kayit tebrik edilir
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
  // Kapsam: ?group= varsa o gruba acik kayitlar; yoksa Hesabim (list: yalniz kendi kayitlarim; detay: kendi + tum gruplarimda gorunenler)
  const libFrom = (visSql) => `FROM catalog c JOIN entries e ON e.catalog_id=c.id AND e.status IN ('devam','bitti','birakildi') AND ${visSql} WHERE c.type='book'`;
  app.get('/api/library', async (req) => {
    const me = requireUser(req);
    const q = req.query;
    const groupId = scopeGroup(db, me, q.group);
    const LIB_FROM = libFrom(groupId ? entryVisibleSql(me.id, [groupId], { own: false }) : `e.user_id=${me.id}`);
    const rv = ratingVisibleSql(me.id, viewerGroups(db, me.id, groupId), 'r');
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
    const rows = db.prepare(`SELECT c.*, (SELECT status FROM entries WHERE user_id=? AND catalog_id=c.id ORDER BY id DESC LIMIT 1) my_status, COUNT(DISTINCT e.user_id) readers_count,
        COUNT(DISTINCT CASE WHEN e.status='devam' THEN e.user_id END) reading_count,
        COUNT(DISTINCT CASE WHEN e.status='bitti' THEN e.user_id END) finished_count,
        (SELECT AVG(score) FROM book_ratings r WHERE r.catalog_id=c.id AND ${rv}) rating_avg,
        (SELECT COUNT(DISTINCT user_id) FROM book_ratings r WHERE r.catalog_id=c.id AND ${rv}) rating_count
      ${LIB_FROM}${w} GROUP BY c.id ORDER BY ${order} LIMIT ? OFFSET ?`).all(me.id, ...args, limit, offset);
    return { items: rows.map(libOut), total };
  });
  const libOut = (r) => ({
    ...catalogOut(r), my_status: r.my_status ?? null, // kendi rafimdaki durum (hicbir kaydim yoksa null)
    readers_count: r.readers_count, reading_count: r.reading_count, finished_count: r.finished_count,
    rating_average: r.rating_avg == null ? null : Math.round(r.rating_avg * 100) / 100, rating_count: r.rating_count,
  });
  app.get('/api/library/:id', async (req) => {
    const me = requireUser(req);
    const id = Number(req.params.id);
    const groupId = scopeGroup(db, me, req.query.group);
    const gids = viewerGroups(db, me.id, groupId);
    const vis = entryVisibleSql(me.id, gids, { own: !groupId });
    const rv = ratingVisibleSql(me.id, gids, 'r');
    const row = db.prepare(`SELECT c.*, COUNT(DISTINCT e.user_id) readers_count,
        COUNT(DISTINCT CASE WHEN e.status='devam' THEN e.user_id END) reading_count,
        COUNT(DISTINCT CASE WHEN e.status='bitti' THEN e.user_id END) finished_count,
        (SELECT AVG(score) FROM book_ratings r WHERE r.catalog_id=c.id AND ${rv}) rating_avg,
        (SELECT COUNT(DISTINCT user_id) FROM book_ratings r WHERE r.catalog_id=c.id AND ${rv}) rating_count
      FROM catalog c LEFT JOIN entries e ON e.catalog_id=c.id AND e.status IN ('devam','bitti','birakildi') AND ${vis} WHERE c.id=? AND c.type='book' GROUP BY c.id`).get(id);
    if (!row) throw err(404, 'Kitap bulunamadi');
    const readers = db.prepare(`SELECT e.id entry_id, e.status, e.user_id, u.display_name, u.avatar, u.color FROM entries e JOIN users u ON u.id=e.user_id
      WHERE e.catalog_id=? AND e.status IN ('devam','bitti','birakildi') AND ${vis} ORDER BY e.updated_at DESC`).all(id)
      .map((r) => ({ entry_id: r.entry_id, status: r.status, user: publicUser({ id: r.user_id, display_name: r.display_name, avatar: r.avatar, color: r.color }) }));
    return {
      item: { ...libOut(row), my_status: db.prepare('SELECT status FROM entries WHERE user_id=? AND catalog_id=? ORDER BY id DESC LIMIT 1').get(me.id, id)?.status ?? null }, readers, rating: ratingOut(me.id, row, groupId),
      comment_count: db.prepare(`SELECT COUNT(*) c FROM comments c JOIN entries e ON e.id=c.entry_id WHERE e.catalog_id=? AND ${commentVisibleSql(me.id, gids)}`).get(id).c,
      question_count: db.prepare(`SELECT COUNT(*) c FROM questions q JOIN entries e ON e.id=q.entry_id WHERE e.catalog_id=? AND ${vis}`).get(id).c,
    }; // yorumlar / sorular: GET /api/library/:id/comments ve /questions (social.js)
  });

  // ---- yonetici: "neden okumuyorsun?" ----
  // Platform yoneticisi herkesi, grup yonetici hesabi yalniz kendi grubunun uyelerini gorur/hatirlatir
  const managedGroupId = (me) => me.kind === 'manager' ? db.prepare('SELECT id FROM groups WHERE owner_id=?').get(me.id)?.id ?? 0 : null;
  const inScope = (me, userId) => {
    const gid = managedGroupId(me);
    return gid === null || !!db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(gid, userId);
  };
  app.get('/api/admin/reading-status', async (req) => {
    const me = requireGroupAdmin(req);
    const today = todayStr();
    const all = req.query.all === '1' || req.query.all === 'true';
    const gid = managedGroupId(me);
    const users = db.prepare(`SELECT id,display_name,avatar,color FROM users WHERE active=1 AND role<>'admin' AND kind<>'manager'
        ${gid === null ? '' : 'AND id IN (SELECT user_id FROM group_members WHERE group_id=?)'} ORDER BY display_name COLLATE NOCASE`).all(...(gid === null ? [] : [gid]));
    const out = users.map((u) => {
      const readToday = !!db.prepare('SELECT 1 FROM reading_logs WHERE user_id=? AND date=? AND pages_read>0').get(u.id, userToday(db, u.id));
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
    const me = requireGroupAdmin(req);
    const u = db.prepare("SELECT id,active FROM users WHERE id=? AND kind<>'manager'").get(Number(req.params.id));
    if (!u || !inScope(me, u.id)) throw err(404, 'Kullanici bulunamadi');
    if (!u.active) throw bad('Pasif kullaniciya bildirim gonderilemez');
    const today = todayStr();
    if (!db.prepare("INSERT OR IGNORE INTO push_log (user_id,kind,day) VALUES (?,'nudge',?)").run(u.id, today).changes) {
      throw err(409, 'Bu kişiye bugün zaten hatırlatma gönderildi', undefined, 'ALREADY_SENT');
    }
    notify(db, u.id, { kind: 'nudge', title: NUDGE_TEXT, link: null });
    return { ok: true, sent: true };
  });
}
