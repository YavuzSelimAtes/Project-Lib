import { requireUser } from '../auth.js';
import { err, bad, int, date as vdate, oneOf, todayStr, nowIso, addDays, diffDays } from '../util.js';
import { tx } from '../db.js';
import { getEntry, entryOut, applyProgress, openDays, setDayPages, backfillLogs } from '../services/entries.js';
import { pickByKey } from '../services/catalog.js';
import { userStats } from '../services/stats.js';

const STATUSES = ['devam', 'bitti', 'birakildi', 'planlandi'];

// asAdminToo: silme gibi moderasyon islemlerinde admin de gecebilir; duzenleme sadece sahibine aittir
function owned(db, req, id, asAdminToo = false) {
  const e = getEntry(db, id);
  if (!e) throw err(404, 'Kayit bulunamadi');
  if (e.user_id !== req.user.id && !(asAdminToo && req.user.role === 'admin')) throw err(403, 'Bu kayit size ait degil');
  return e;
}
function ratingOf(v) {
  return v === null ? null : int(v, { min: 1, max: 5, field: 'rating' });
}

export default async function routes(app) {
  const db = app.db;

  app.get('/api/entries', async (req) => {
    requireUser(req);
    const q = req.query;
    const where = [];
    const args = [];
    if (q.user_id !== undefined) { where.push('user_id=?'); args.push(int(q.user_id, { field: 'user_id' })); }
    if (q.type) { where.push('type=?'); args.push(oneOf(q.type, ['book', 'movie', 'series'], { field: 'type' })); }
    if (q.status) { where.push('status=?'); args.push(oneOf(q.status, STATUSES, { field: 'status' })); }
    const limit = Math.min(int(q.limit, { min: 1, max: 500, field: 'limit' }) || 100, 500);
    const offset = int(q.offset, { min: 0, field: 'offset' }) || 0;
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = db.prepare(`SELECT COUNT(*) c FROM entries ${w}`).get(...args).c;
    const rows = db.prepare(`SELECT * FROM entries ${w} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
    return { entries: rows.map((e) => entryOut(db, e)), total };
  });

  app.get('/api/entries/:id', async (req) => {
    requireUser(req);
    const e = getEntry(db, Number(req.params.id));
    if (!e) throw err(404, 'Kayit bulunamadi');
    const logs = db.prepare('SELECT date,pages_read,page_from,page_to,estimated FROM reading_logs WHERE entry_id=? ORDER BY date').all(e.id).map((l) => ({ ...l, estimated: !!l.estimated }));
    return {
      entry: entryOut(db, e),
      logs,
      comment_count: db.prepare('SELECT COUNT(*) c FROM comments WHERE entry_id=?').get(e.id).c,
      question_count: db.prepare('SELECT COUNT(*) c FROM questions WHERE entry_id=?').get(e.id).c,
    };
  });

  app.post('/api/entries', async (req, reply) => {
    const me = requireUser(req);
    const b = req.body || {};
    let catId = b.catalog_key ? pickByKey(db, b.catalog_key)?.id : int(b.catalog_id, { field: 'catalog_id', required: true });
    if (!catId) throw bad('Katalog sonucunun suresi dolmus, aramayi tekrarlayin', { catalog_key: 'gecersiz' });
    const cat = db.prepare('SELECT * FROM catalog WHERE id=?').get(catId);
    if (!cat) throw err(404, 'Katalog kaydi bulunamadi', { catalog_id: 'yok' });
    const type = cat.type;
    const today = todayStr();
    const status = oneOf(b.status, STATUSES, { field: 'status' }) || (type === 'movie' ? 'bitti' : 'devam');
    if (status === 'devam' && db.prepare("SELECT 1 FROM entries WHERE user_id=? AND catalog_id=? AND status='devam'").get(me.id, catId)) {
      throw err(409, 'Bu kayit zaten "devam ediyor" olarak listenizde');
    }
    let start = vdate(b.start_date, { field: 'start_date' });
    let end = vdate(b.end_date, { field: 'end_date' });
    if (start && end && end < start) throw bad('Bitis tarihi baslangictan once olamaz', { end_date: 'baslangictan once' });
    let total = null;
    let cur = 0;
    let season = null;
    let episode = null;
    if (type === 'book') {
      total = b.total_pages !== undefined && b.total_pages !== null ? int(b.total_pages, { min: 1, max: 20000, field: 'total_pages' }) : cat.pages;
      cur = int(b.current_page, { min: 0, field: 'current_page' }) || 0;
      if (total && cur > total) throw bad('Sayfa, toplam sayfa sayisini asamaz', { current_page: 'toplamdan buyuk' });
      if (status === 'bitti' && total) cur = total;
    } else if (type === 'series') {
      season = int(b.season, { min: 1, max: 200, field: 'season' });
      episode = int(b.episode, { min: 1, max: 5000, field: 'episode' });
    }
    if (status === 'planlandi') { start = null; end = null; }
    else if (status === 'devam') { start = start || today; end = null; }
    else if (status === 'bitti') {
      end = end || today;
      // film: izlenme gunu; kitap/dizi: baslangic bilinmiyorsa bos kalir (ortalamaya girmez)
      if (type === 'movie') start = start || end;
    } else { start = start || today; }
    if (start && end && end < start) throw bad('Bitis tarihi baslangictan once olamaz', { end_date: 'baslangictan once' });
    if (start && start > today && status !== 'planlandi') throw bad('Baslangic tarihi gelecekte olamaz', { start_date: 'gelecek tarih' });
    if (end && end > today) throw bad('Bitis tarihi gelecekte olamaz', { end_date: 'gelecek tarih' });
    const rating = ratingOf(b.rating === undefined ? null : b.rating);
    const backfill = oneOf(b.backfill, ['none', 'manual', 'spread'], { field: 'backfill' }) || 'none';
    let backDays = [];
    if (backfill === 'manual' && b.days !== undefined) {
      if (!Array.isArray(b.days) || b.days.length > 120) throw bad('days dizi olmali (en fazla 120)', { days: 'gecersiz' });
      backDays = b.days.map((d) => ({ date: vdate(d?.date, { field: 'date', required: true }), pages: int(d?.pages, { min: 0, max: 20000, field: 'pages' }) || 0 }));
    }
    if (backfill !== 'none' && !(type === 'book' && status === 'devam' && cur > 0)) throw bad('backfill sadece current_page>0 olan, devam eden kitaplar icindir', { backfill: 'gecersiz' });
    const now = nowIso();
    const info = db.prepare(`INSERT INTO entries (user_id,catalog_id,type,status,start_date,end_date,total_pages,current_page,base_page,season,episode,rating,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(me.id, catId, type, status, start, end, total, cur, backfill !== 'none' || status === 'bitti' ? 0 : cur, season, episode, rating, now, now);
    if (backfill !== 'none') {
      try { backfillLogs(db, getEntry(db, info.lastInsertRowid), backfill, backDays); } catch (e) { db.prepare('DELETE FROM entries WHERE id=?').run(info.lastInsertRowid); throw e; }
    }
    reply.code(201);
    return { entry: entryOut(db, getEntry(db, info.lastInsertRowid)) };
  });

  app.patch('/api/entries/:id', async (req) => {
    requireUser(req);
    const id = Number(req.params.id);
    const e = owned(db, req, id);
    const b = req.body || {};
    const has = (k) => b[k] !== undefined;
    if (has('current_page')) throw bad('Sayfa ilerlemesi sadece POST /api/entries/:id/progress ile girilir', { current_page: 'progress ucunu kullanin' });
    const today = todayStr();
    const out = tx(db, () => {
      let cur = getEntry(db, id);
      const status = has('status') ? oneOf(b.status, STATUSES, { field: 'status', required: true }) : cur.status;
      let start = has('start_date') ? vdate(b.start_date, { field: 'start_date' }) : cur.start_date;
      let end = has('end_date') ? vdate(b.end_date, { field: 'end_date' }) : cur.end_date;
      let total = cur.total_pages;
      if (has('total_pages')) {
        if (cur.type !== 'book') throw bad('Sadece kitaplarda toplam sayfa olur');
        total = b.total_pages === null ? null : int(b.total_pages, { min: 1, max: 20000, field: 'total_pages' });
        if (total && cur.current_page > total) throw bad('Toplam sayfa, mevcut sayfadan kucuk olamaz', { total_pages: 'mevcut sayfadan kucuk' });
      }
      const season = has('season') ? int(b.season, { min: 1, max: 200, field: 'season' }) : cur.season;
      const episode = has('episode') ? int(b.episode, { min: 1, max: 5000, field: 'episode' }) : cur.episode;
      const rating = has('rating') ? ratingOf(b.rating) : cur.rating;
      if (status === 'devam' && cur.status !== 'devam' && db.prepare("SELECT 1 FROM entries WHERE user_id=? AND catalog_id=? AND status='devam' AND id<>?").get(cur.user_id, cur.catalog_id, id)) {
        throw err(409, 'Bu kayit zaten "devam ediyor" olarak listenizde');
      }
      if (status === 'devam') { end = null; start = start || today; }
      if (status === 'bitti') end = end || today;
      if (status === 'planlandi') { start = has('start_date') ? start : null; if (!has('end_date')) end = null; }
      if (start && end && end < start) throw bad('Bitis tarihi baslangictan once olamaz', { end_date: 'baslangictan once' });
      if (end && end > today) throw bad('Bitis tarihi gelecekte olamaz', { end_date: 'gelecek tarih' });
      if (start && start > today && status !== 'planlandi') throw bad('Baslangic tarihi gelecekte olamaz', { start_date: 'gelecek tarih' });
      if (start && has('start_date')) {
        const first = db.prepare('SELECT MIN(date) d FROM reading_logs WHERE entry_id=?').get(id).d;
        if (first && first < start) throw bad(`Baslangic tarihi, ilk okuma kaydindan (${first}) sonra olamaz`, { start_date: 'kayitlardan sonra' });
      }
      db.prepare('UPDATE entries SET status=?, start_date=?, end_date=?, total_pages=?, season=?, episode=?, rating=?, updated_at=? WHERE id=?')
        .run(status, start, end, total, season, episode, rating, nowIso(), id);
      cur = getEntry(db, id);
      if (cur.type === 'book') {
        let target = null;
        if (status === 'bitti' && cur.total_pages) target = cur.total_pages;
        else if (has('current_page')) target = int(b.current_page, { min: 0, field: 'current_page', required: true });
        if (target !== null && target !== cur.current_page) {
          if (!cur.total_pages && target > 0) throw bad('Once kitabin toplam sayfa sayisini girin', { total_pages: 'gerekli' });
          const d = has('date') && b.date ? vdate(b.date, { field: 'date' }) : (status === 'bitti' && cur.end_date) || today;
          applyProgress(db, cur, target, d, { estimate: status === 'bitti' && !has('current_page') });
          if (has('status') && status !== 'bitti') {
            const after = getEntry(db, id);
            if (!(status === 'devam' && after.status === 'bitti')) {
              db.prepare('UPDATE entries SET status=?, end_date=? WHERE id=?').run(status, status === 'devam' ? null : end, id);
            }
          }
        }
      }
      return getEntry(db, id);
    });
    return { entry: entryOut(db, out) };
  });

  app.delete('/api/entries/:id', async (req) => {
    requireUser(req);
    const e = owned(db, req, Number(req.params.id), true);
    db.prepare('DELETE FROM entries WHERE id=?').run(e.id);
    return { ok: true };
  });

  app.post('/api/entries/:id/progress', async (req) => {
    const me = requireUser(req);
    const e = getEntry(db, Number(req.params.id));
    if (!e) throw err(404, 'Kayit bulunamadi');
    if (e.user_id !== me.id) throw err(403, 'Sadece kendi kaydinizin ilerlemesini girebilirsiniz');
    if (e.type !== 'book') throw bad('Sayfa ilerlemesi sadece kitaplar icindir; diziler icin series-progress kullanin');
    const b = req.body || {};
    const cp = int(b.current_page, { min: 1, field: 'current_page', required: true });
    const d = vdate(b.date, { field: 'date' }) || todayStr();
    if (cp < e.current_page && b.confirm !== true) {
      throw err(400, `Sayfa ${e.current_page}'den ${cp}'e geriye gidiyor. Duzeltmek istiyorsaniz confirm:true gonderin`, { confirm: 'onay gerekli' }, 'CONFIRM_REQUIRED');
    }
    if (!e.total_pages) throw bad('Bu kitabin toplam sayfa sayisi yok. Once toplam sayfayi girin (PATCH total_pages)', { total_pages: 'gerekli' });
    const r = tx(db, () => applyProgress(db, getEntry(db, e.id), cp, d));
    const entry = getEntry(db, e.id);
    return { entry: entryOut(db, entry), delta: r.delta, pages_read_on_date: r.pagesOnDate, date: d, finished: r.finished, spread_days: r.spread, estimated: r.estimated };
  });

  // Gun gun okuma: "kac sayfa okudun?" diye sorulacak acik gunler
  app.get('/api/entries/:id/open-days', async (req) => {
    const me = requireUser(req);
    const e = getEntry(db, Number(req.params.id));
    if (!e) throw err(404, 'Kayit bulunamadi');
    if (e.user_id !== me.id) throw err(403, 'Sadece kendi kaydinizin gunlerini gorebilirsiniz');
    const days = openDays(db, e);
    return { days, count: days.length };
  });

  // Gun bazli sayfa girisi: { days:[{date, pages}], add?:true } ya da { skip_open:true } (acik gunlerin hepsi "okumadim")
  app.put('/api/entries/:id/day-logs', async (req) => {
    const me = requireUser(req);
    const id = Number(req.params.id);
    const e0 = getEntry(db, id);
    if (!e0) throw err(404, 'Kayit bulunamadi');
    if (e0.user_id !== me.id) throw err(403, 'Sadece kendi kaydinizin okumalarini girebilirsiniz');
    const b = req.body || {};
    let list = [];
    if (b.skip_open === true) list = openDays(db, e0).filter((d) => d.state === 'open').map((d) => ({ date: d.date, pages: 0 }));
    else {
      if (!Array.isArray(b.days) || !b.days.length || b.days.length > 120) throw bad('days: 1-120 ogeli dizi ya da skip_open:true gonderin');
      list = b.days.map((d) => ({ date: vdate(d?.date, { field: 'date', required: true }), pages: int(d?.pages, { min: 0, max: 20000, field: 'pages', required: true }) }));
    }
    list.sort((a, c) => a.date.localeCompare(c.date));
    tx(db, () => { for (const d of list) setDayPages(db, getEntry(db, id), d.date, d.pages, { add: b.add === true }); });
    const entry = entryOut(db, getEntry(db, id));
    return { entry, applied: list.length, open_days: openDays(db, getEntry(db, id)) };
  });

  app.post('/api/entries/:id/series-progress', async (req) => {
    const me = requireUser(req);
    const e = getEntry(db, Number(req.params.id));
    if (!e) throw err(404, 'Kayit bulunamadi');
    if (e.user_id !== me.id) throw err(403, 'Sadece kendi kaydinizi guncelleyebilirsiniz');
    if (e.type !== 'series') throw bad('Bu islem sadece diziler icindir');
    const b = req.body || {};
    const season = int(b.season, { min: 1, max: 200, field: 'season', required: true });
    const episode = int(b.episode, { min: 1, max: 5000, field: 'episode', required: true });
    let { status, start_date, end_date } = e;
    if (status === 'planlandi' || status === 'birakildi' || status === 'bitti') { status = 'devam'; end_date = null; }
    start_date = start_date || todayStr();
    db.prepare('UPDATE entries SET season=?, episode=?, status=?, start_date=?, end_date=?, updated_at=? WHERE id=?').run(season, episode, status, start_date, end_date, nowIso(), e.id);
    return { entry: entryOut(db, getEntry(db, e.id)) };
  });

  app.get('/api/users/:id/stats', async (req) => {
    requireUser(req);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.params.id));
    if (!u) throw err(404, 'Kullanici bulunamadi');
    const period = oneOf(req.query.period, ['all', 'year', 'month'], { field: 'period' }) || 'all';
    return userStats(db, u, period);
  });

  app.get('/api/users/:id/heatmap', async (req) => {
    requireUser(req);
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(id)) throw err(404, 'Kullanici bulunamadi');
    const n = Math.min(int(req.query.days, { min: 1, max: 730, field: 'days' }) || 90, 730);
    const from = addDays(todayStr(), -(n - 1));
    const days = db.prepare('SELECT date, SUM(pages_read) pages, MIN(estimated) real_flag FROM reading_logs WHERE user_id=? AND date>=? GROUP BY date HAVING pages>0 ORDER BY date').all(id, from).map((r) => ({ date: r.date, pages: r.pages, estimated: r.real_flag === 1 }));
    return { days };
  });
}
