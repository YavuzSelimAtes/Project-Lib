import { requireUser } from '../auth.js';
import { err, bad, str, int, nowIso, userToday, diffDays } from '../util.js';
import { notify } from '../services/notify.js';
import { catalogOut } from '../services/catalog.js';
import { streakDates } from '../services/stats.js';
import { tx } from '../db.js';
import { parseVisibility, commentAllowedGroups, setCommentGroups, commentGroupIds, idList } from '../groups.js';

// Kisi sayfasi: Defterim (ozel notlar), hedefler, yil ozeti, veri indirme. Hepsi yalniz oturum sahibinin verisi.
export default async function routes(app) {
  const db = app.db;

  const noteOut = (n) => ({
    id: n.id, catalog_id: n.catalog_id, body: n.body, ref: n.ref, created_at: n.created_at, updated_at: n.updated_at,
    catalog: { id: n.catalog_id, title: n.title, type: n.type, cover_url: n.cover_url, author_or_creator: n.author_or_creator },
  });
  const NOTE_SQL = 'SELECT n.*, c.title, c.type, c.cover_url, c.author_or_creator FROM notes n JOIN catalog c ON c.id=n.catalog_id';
  const myNote = (me, id) => {
    const n = db.prepare(`${NOTE_SQL} WHERE n.id=? AND n.user_id=?`).get(Number(id), me.id);
    if (!n) throw err(404, 'Not bulunamadi');
    return n;
  };
  const likeEsc = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

  // ---- Defterim ----
  app.get('/api/notes', async (req) => {
    const me = requireUser(req);
    const q = req.query || {};
    const where = ['n.user_id=?'];
    const args = [me.id];
    if (q.catalog_id !== undefined && q.catalog_id !== '') { where.push('n.catalog_id=?'); args.push(int(q.catalog_id, { field: 'catalog_id', min: 1 })); }
    const text = typeof q.q === 'string' ? q.q.trim().slice(0, 100) : '';
    if (text) { where.push("(n.body LIKE ? ESCAPE '\\' OR c.title LIKE ? ESCAPE '\\')"); const l = `%${likeEsc(text)}%`; args.push(l, l); }
    const limit = Math.min(200, int(q.limit, { min: 1, max: 1000, field: 'limit' }) ?? 50);
    const offset = int(q.offset, { min: 0, field: 'offset' }) ?? 0;
    const w = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) c FROM notes n JOIN catalog c ON c.id=n.catalog_id WHERE ${w}`).get(...args).c;
    const rows = db.prepare(`${NOTE_SQL} WHERE ${w} ORDER BY n.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
    return { notes: rows.map(noteOut), total };
  });
  app.post('/api/notes', async (req, reply) => {
    const me = requireUser(req);
    const b = req.body || {};
    const catalogId = int(b.catalog_id, { field: 'catalog_id', min: 1, required: true });
    if (!db.prepare('SELECT 1 FROM catalog WHERE id=?').get(catalogId)) throw bad('Kayit bulunamadi', { catalog_id: 'bulunamadi' });
    const body = str(b.body, { field: 'body', required: true, max: 5000 });
    const ref = str(b.ref, { field: 'ref', max: 100 });
    const now = nowIso();
    const id = db.prepare('INSERT INTO notes (user_id,catalog_id,body,ref,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(me.id, catalogId, body, ref, now, now).lastInsertRowid;
    reply.code(201);
    return { note: noteOut(myNote(me, id)) };
  });
  app.patch('/api/notes/:id', async (req) => {
    const me = requireUser(req);
    const n = myNote(me, req.params.id);
    const b = req.body || {};
    const body = b.body !== undefined ? str(b.body, { field: 'body', required: true, max: 5000 }) : n.body;
    const ref = b.ref !== undefined ? str(b.ref, { field: 'ref', max: 100 }) : n.ref;
    db.prepare('UPDATE notes SET body=?, ref=?, updated_at=? WHERE id=?').run(body, ref, nowIso(), n.id);
    return { note: noteOut(myNote(me, n.id)) };
  });
  app.delete('/api/notes/:id', async (req) => {
    const me = requireUser(req);
    const n = myNote(me, req.params.id);
    db.prepare('DELETE FROM notes WHERE id=?').run(n.id);
    return { ok: true };
  });
  // Notu yorum olarak paylas (yorum akisi ve gorunurluk kurallari POST /api/entries/:id/comments ile ayni)
  app.post('/api/notes/:id/share', async (req, reply) => {
    const me = requireUser(req);
    const n = myNote(me, req.params.id);
    const e = db.prepare('SELECT * FROM entries WHERE user_id=? AND catalog_id=? ORDER BY id DESC LIMIT 1').get(me.id, n.catalog_id);
    if (!e) throw err(409, 'Önce kitabı kitaplığına ekle');
    const body = n.ref ? `[${n.ref}] ${n.body}` : n.body;
    if (body.length > 2000) throw bad('Not yorum olarak paylaşılamayacak kadar uzun (en fazla 2000 karakter)', { body: 'cok uzun' });
    const groups = parseVisibility(req.body || {}, commentAllowedGroups(db, e.id, me.id));
    const cid = tx(db, () => {
      const i = Number(db.prepare('INSERT INTO comments (entry_id,user_id,body,created_at) VALUES (?,?,?,?)').run(e.id, me.id, body, nowIso()).lastInsertRowid);
      setCommentGroups(db, i, groups);
      return i;
    });
    const audience = new Set(groups.length ? db.prepare(`SELECT DISTINCT user_id FROM group_members WHERE group_id IN (${idList(groups)})`).all().map((r) => r.user_id) : []);
    const targets = new Set(db.prepare('SELECT DISTINCT user_id FROM comments WHERE entry_id=? AND user_id<>?').all(e.id, me.id).map((r) => r.user_id).filter((u) => audience.has(u)));
    if (e.user_id !== me.id && audience.has(e.user_id)) targets.add(e.user_id);
    for (const uid of targets) {
      const title = uid === e.user_id ? `${me.display_name}, "${n.title}" kaydına yorum yazdı` : `${me.display_name}, yorum yazdığın "${n.title}" kaydına yeni yorum yazdı`;
      notify(db, uid, { kind: 'comment', title, body: body.slice(0, 140), link: { type: 'entry', id: e.id } });
    }
    reply.code(201);
    const c = db.prepare('SELECT * FROM comments WHERE id=?').get(cid);
    return { comment: { id: c.id, entry_id: c.entry_id, user_id: c.user_id, body: c.body, created_at: c.created_at, group_ids: commentGroupIds(db, c.id) } };
  });

  // ---- Hedefler ----
  const goalsOut = (me) => {
    const g = db.prepare('SELECT * FROM user_goals WHERE user_id=?').get(me.id);
    const today = userToday(db, me.id);
    const month = today.slice(0, 7);
    const year = today.slice(0, 4);
    return {
      monthly_pages: g?.monthly_pages ?? 0,
      yearly_books: g?.yearly_books ?? 0,
      month_pages: db.prepare('SELECT COALESCE(SUM(pages_read),0) s FROM reading_logs WHERE user_id=? AND date>=? AND date<=?').get(me.id, `${month}-01`, today).s,
      year_books: db.prepare("SELECT COUNT(*) c FROM entries WHERE user_id=? AND type='book' AND status='bitti' AND end_date>=? AND end_date<=?").get(me.id, `${year}-01-01`, today).c,
    };
  };
  app.get('/api/me/goals', async (req) => ({ goals: goalsOut(requireUser(req)) }));
  app.put('/api/me/goals', async (req) => {
    const me = requireUser(req);
    const b = req.body || {};
    const cur = db.prepare('SELECT * FROM user_goals WHERE user_id=?').get(me.id);
    const mp = b.monthly_pages !== undefined ? int(b.monthly_pages, { field: 'monthly_pages', min: 0, max: 20000, required: true }) : (cur?.monthly_pages ?? 0);
    const yb = b.yearly_books !== undefined ? int(b.yearly_books, { field: 'yearly_books', min: 0, max: 500, required: true }) : (cur?.yearly_books ?? 0);
    db.prepare(`INSERT INTO user_goals (user_id,monthly_pages,yearly_books,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET monthly_pages=excluded.monthly_pages, yearly_books=excluded.yearly_books, updated_at=excluded.updated_at`).run(me.id, mp, yb, nowIso());
    return { goals: goalsOut(me) };
  });

  // ---- Yil ozeti ----
  app.get('/api/me/year-summary', async (req) => {
    const me = requireUser(req);
    const today = userToday(db, me.id);
    const year = int(req.query?.year, { field: 'year', min: 1900, max: 2200 }) ?? Number(today.slice(0, 4));
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const fin = db.prepare(`SELECT e.id, e.catalog_id, e.type, e.end_date, e.rating, c.title, c.cover_url, c.author_or_creator FROM entries e JOIN catalog c ON c.id=e.catalog_id
      WHERE e.user_id=? AND e.status='bitti' AND e.end_date>=? AND e.end_date<=? ORDER BY e.end_date, e.id`).all(me.id, from, to);
    const item = (r) => r && ({ entry_id: r.id, catalog_id: r.catalog_id, title: r.title, type: r.type, cover_url: r.cover_url, author_or_creator: r.author_or_creator, end_date: r.end_date, rating: r.rating });
    const count = (t) => fin.filter((r) => r.type === t).length;
    const logs = db.prepare('SELECT date, pages_read FROM reading_logs WHERE user_id=? AND date>=? AND date<=?').all(me.id, from, to);
    const byMonth = new Map();
    let pages = 0;
    for (const l of logs) {
      pages += l.pages_read;
      const m = l.date.slice(0, 7);
      byMonth.set(m, (byMonth.get(m) || 0) + l.pages_read);
    }
    let best = null;
    for (const [m, p] of [...byMonth].sort()) if (p > 0 && (!best || p > best.pages)) best = { month: m, pages: p };
    let longest = 0;
    let run = 0;
    let prev = null;
    for (const d of streakDates(db, me.id).filter((x) => x >= from && x <= to)) {
      run = prev && diffDays(prev, d) === 1 ? run + 1 : 1;
      if (run > longest) longest = run;
      prev = d;
    }
    const rated = fin.filter((r) => r.rating);
    const top = [...rated].sort((a, b) => b.rating - a.rating || (a.end_date < b.end_date ? 1 : -1) || b.id - a.id).slice(0, 3);
    return {
      year,
      finished: { total: fin.length, books: count('book'), movies: count('movie'), series: count('series') },
      total_pages: pages,
      longest_streak: longest,
      best_month: best,
      avg_rating: rated.length ? Math.round((rated.reduce((s, r) => s + r.rating, 0) / rated.length) * 10) / 10 : null,
      top_rated: top.map(item),
      first_finished: item(fin[0]) || null,
      last_finished: item(fin[fin.length - 1]) || null,
    };
  });

  // ---- Veri indirme ----
  const csvCell = (v) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // tablo programlarinda formul calismasin
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  app.get('/api/me/export', async (req, reply) => {
    const me = requireUser(req);
    const format = req.query?.format ?? 'json';
    if (format !== 'json' && format !== 'csv') throw bad('format json veya csv olmali', { format: 'gecersiz' });
    const entries = db.prepare(`SELECT e.*, c.title, c.author_or_creator, c.year, c.pages FROM entries e JOIN catalog c ON c.id=e.catalog_id WHERE e.user_id=? ORDER BY e.id`).all(me.id);
    const stamp = userToday(db, me.id);
    if (format === 'csv') {
      const cols = ['id', 'type', 'title', 'author_or_creator', 'year', 'status', 'start_date', 'end_date', 'total_pages', 'current_page', 'season', 'episode', 'rating', 'created_at', 'updated_at'];
      const lines = [cols.join(',')];
      for (const e of entries) lines.push(cols.map((c) => csvCell(e[c])).join(','));
      reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="kutuphane-${stamp}.csv"`);
      return '﻿' + lines.join('\r\n') + '\r\n';
    }
    const logs = db.prepare('SELECT entry_id,date,page_from,page_to,pages_read,estimated FROM reading_logs WHERE user_id=? ORDER BY date, id').all(me.id);
    const logsBy = new Map();
    for (const l of logs) (logsBy.get(l.entry_id) || logsBy.set(l.entry_id, []).get(l.entry_id)).push(l);
    const out = {
      exported_at: nowIso(),
      user: { id: me.id, username: me.username, display_name: me.display_name },
      entries: entries.map((e) => ({ ...e, logs: logsBy.get(e.id) || [] })),
      ratings: db.prepare('SELECT b.catalog_id, c.title, b.metric, b.score, b.updated_at FROM book_ratings b JOIN catalog c ON c.id=b.catalog_id WHERE b.user_id=? ORDER BY b.catalog_id, b.metric').all(me.id),
      comments: db.prepare('SELECT id, entry_id, body, created_at FROM comments WHERE user_id=? ORDER BY id').all(me.id),
      notes: db.prepare('SELECT n.id, n.catalog_id, c.title, n.body, n.ref, n.created_at, n.updated_at FROM notes n JOIN catalog c ON c.id=n.catalog_id WHERE n.user_id=? ORDER BY n.id').all(me.id),
      goals: goalsOut(me),
    };
    reply.header('content-type', 'application/json; charset=utf-8').header('content-disposition', `attachment; filename="kutuphane-${stamp}.json"`);
    return JSON.stringify(out, null, 2);
  });
}
