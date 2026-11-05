import { requireUser } from '../auth.js';
import { err, bad, int, str, nowIso, publicUser } from '../util.js';
import { notify } from '../services/notify.js';
import { userGroups, idList } from '../groups.js';

// Hikayeler: yazar (users.story_author) bolum bolum yayinlar; story_groups'taki gruplarin uyeleri okur.
// Okuma yeri story_progress'te karakter konumu (pos) olarak tutulur: ekran boyutu degisse de dogru sayfa bulunur.
export default async function routes(app) {
  const db = app.db;

  const authorOnly = (me) => {
    if (!me.story_author) throw err(403, 'Hikaye yazma yetkin yok');
  };
  const storyRow = (id) => {
    const s = db.prepare('SELECT * FROM stories WHERE id=?').get(Number(id));
    if (!s) throw err(404, 'Hikaye bulunamadi');
    return s;
  };
  // Yazar her zaman gorur; digerleri sadece story_groups ile ortak grubu varsa
  const canRead = (me, s) => s.user_id === me.id || !!db.prepare('SELECT 1 FROM story_groups sg JOIN group_members gm ON gm.group_id=sg.group_id AND gm.user_id=? WHERE sg.story_id=?').get(me.id, s.id);
  const readable = (me, id) => {
    const s = storyRow(id);
    if (!canRead(me, s)) throw err(404, 'Hikaye bulunamadi');
    return s;
  };
  const mineStory = (me, id) => {
    authorOnly(me);
    const s = storyRow(id);
    if (s.user_id !== me.id) throw err(404, 'Hikaye bulunamadi');
    return s;
  };
  const chapterRow = (storyId, cid) => {
    const c = db.prepare('SELECT * FROM story_chapters WHERE id=? AND story_id=?').get(Number(cid), storyId);
    if (!c) throw err(404, 'Bolum bulunamadi');
    return c;
  };
  const color = (v) => {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw bad('Renk #rrggbb olmali', { color: 'gecersiz' });
    return v.toLowerCase();
  };
  const chapterOut = (c, withBody) => ({ id: c.id, n: c.n, title: c.title, published_at: c.published_at, updated_at: c.updated_at, ...(withBody ? { body: c.body } : {}) });

  // Yazar bir bolumu ilk kez yayinlayinca hikayenin gruplarindaki uyeler bilgilendirilir
  const announce = (me, s, c) => {
    const members = db.prepare('SELECT DISTINCT gm.user_id FROM story_groups sg JOIN group_members gm ON gm.group_id=sg.group_id WHERE sg.story_id=? AND gm.user_id<>?').all(s.id, me.id);
    for (const m of members) notify(db, m.user_id, { from: me.id, kind: 'story', title: `${me.display_name}, “${s.title}” hikayesine yeni bölüm ekledi`, body: c.title.slice(0, 140), link: { type: 'story', id: s.id } });
  };

  app.get('/api/stories/:id', async (req) => {
    const me = requireUser(req);
    const s = readable(me, req.params.id);
    const own = s.user_id === me.id;
    const chapters = db.prepare(`SELECT * FROM story_chapters WHERE story_id=? ${own ? '' : 'AND published_at IS NOT NULL'} ORDER BY n`).all(s.id);
    const author = db.prepare('SELECT id,display_name,avatar,color FROM users WHERE id=?').get(s.user_id);
    const prog = db.prepare('SELECT chapter_id, pos FROM story_progress WHERE story_id=? AND user_id=?').get(s.id, me.id);
    return {
      story: { id: s.id, title: s.title, summary: s.summary, color: s.color, updated_at: s.updated_at, author: publicUser(author), mine: own },
      chapters: chapters.map((c) => chapterOut(c, true)),
      progress: prog ? { chapter_id: prog.chapter_id, pos: prog.pos } : null,
    };
  });

  app.post('/api/stories', async (req, reply) => {
    const me = requireUser(req);
    authorOnly(me);
    const b = req.body || {};
    const title = str(b.title, { field: 'title', required: true, max: 120 });
    const summary = str(b.summary, { field: 'summary', max: 600 });
    const now = nowIso();
    const id = db.prepare('INSERT INTO stories (user_id,title,summary,color,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(me.id, title, summary, color(b.color) || '#8a3a1f', now, now).lastInsertRowid;
    for (const g of userGroups(db, me.id)) db.prepare('INSERT OR IGNORE INTO story_groups (story_id,group_id) VALUES (?,?)').run(id, g.id);
    reply.code(201);
    return { id: Number(id) };
  });

  app.patch('/api/stories/:id', async (req) => {
    const me = requireUser(req);
    const s = mineStory(me, req.params.id);
    const b = req.body || {};
    const title = b.title !== undefined ? str(b.title, { field: 'title', required: true, max: 120 }) : s.title;
    const summary = b.summary !== undefined ? str(b.summary, { field: 'summary', max: 600 }) : s.summary;
    const col = b.color !== undefined ? color(b.color) || s.color : s.color;
    db.prepare('UPDATE stories SET title=?, summary=?, color=?, updated_at=? WHERE id=?').run(title, summary, col, nowIso(), s.id);
    return { ok: true };
  });

  app.delete('/api/stories/:id', async (req) => {
    const me = requireUser(req);
    const s = mineStory(me, req.params.id);
    db.prepare('DELETE FROM stories WHERE id=?').run(s.id);
    return { ok: true };
  });

  app.post('/api/stories/:id/chapters', async (req, reply) => {
    const me = requireUser(req);
    const s = mineStory(me, req.params.id);
    const b = req.body || {};
    const title = str(b.title, { field: 'title', required: true, max: 120 });
    const body = str(b.body, { field: 'body', required: true, max: 80000 });
    const now = nowIso();
    const n = (db.prepare('SELECT MAX(n) m FROM story_chapters WHERE story_id=?').get(s.id).m || 0) + 1;
    const publish = b.publish === true;
    const id = db.prepare('INSERT INTO story_chapters (story_id,n,title,body,published_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(s.id, n, title, body, publish ? now : null, now, now).lastInsertRowid;
    db.prepare('UPDATE stories SET updated_at=? WHERE id=?').run(now, s.id);
    if (publish) announce(me, s, { title });
    reply.code(201);
    return { chapter: chapterOut(chapterRow(s.id, id), true) };
  });

  app.patch('/api/stories/:id/chapters/:cid', async (req) => {
    const me = requireUser(req);
    const s = mineStory(me, req.params.id);
    const c = chapterRow(s.id, req.params.cid);
    const b = req.body || {};
    const title = b.title !== undefined ? str(b.title, { field: 'title', required: true, max: 120 }) : c.title;
    const body = b.body !== undefined ? str(b.body, { field: 'body', required: true, max: 80000 }) : c.body;
    const now = nowIso();
    let published = c.published_at;
    let firstPublish = false;
    if (b.published === true && !published) { published = now; firstPublish = true; }
    if (b.published === false) published = null;
    db.prepare('UPDATE story_chapters SET title=?, body=?, published_at=?, updated_at=? WHERE id=?').run(title, body, published, now, c.id);
    db.prepare('UPDATE stories SET updated_at=? WHERE id=?').run(now, s.id);
    if (firstPublish) announce(me, s, { title });
    return { chapter: chapterOut(chapterRow(s.id, c.id), true) };
  });

  app.delete('/api/stories/:id/chapters/:cid', async (req) => {
    const me = requireUser(req);
    const s = mineStory(me, req.params.id);
    const c = chapterRow(s.id, req.params.cid);
    db.prepare('DELETE FROM story_chapters WHERE id=?').run(c.id);
    // numaralar sirali kalsin
    const rest = db.prepare('SELECT id FROM story_chapters WHERE story_id=? ORDER BY n').all(s.id);
    rest.forEach((r, i) => db.prepare('UPDATE story_chapters SET n=? WHERE id=?').run(i + 1, r.id));
    return { ok: true };
  });

  // Okuma yeri: bolum + o bolumdeki karakter konumu
  // ---- yorumlar: hikayeyi okuyabilen herkes yazar; yanit tek seviye (yanita yanit ust yorumun altina duser) ----
  const commentOut = (me, s, c) => ({
    id: c.id, parent_id: c.parent_id, body: c.body, created_at: c.created_at,
    user: publicUser(db.prepare('SELECT id,display_name,avatar,color FROM users WHERE id=?').get(c.user_id)),
    can_delete: c.user_id === me.id || s.user_id === me.id,
  });
  app.get('/api/stories/:id/comments', async (req) => {
    const me = requireUser(req);
    const s = readable(me, req.params.id);
    return { comments: db.prepare('SELECT * FROM story_comments WHERE story_id=? ORDER BY id').all(s.id).map((c) => commentOut(me, s, c)) };
  });
  app.post('/api/stories/:id/comments', async (req, reply) => {
    const me = requireUser(req);
    const s = readable(me, req.params.id);
    const b = req.body || {};
    const body = str(b.body, { field: 'body', required: true, max: 2000 });
    let parent = null;
    if (b.parent_id != null) {
      parent = db.prepare('SELECT * FROM story_comments WHERE id=? AND story_id=?').get(Number(b.parent_id), s.id);
      if (!parent) throw bad('Yanitlanan yorum bulunamadi', { parent_id: 'gecersiz' });
      if (parent.parent_id) parent = db.prepare('SELECT * FROM story_comments WHERE id=?').get(parent.parent_id);
    }
    const info = db.prepare('INSERT INTO story_comments (story_id,user_id,parent_id,body,created_at) VALUES (?,?,?,?,?)').run(s.id, me.id, parent?.id ?? null, body, nowIso());
    const targets = new Set();
    if (s.user_id !== me.id) targets.add(s.user_id);
    if (parent && parent.user_id !== me.id) targets.add(parent.user_id);
    for (const uid of targets) {
      const title = parent && uid === parent.user_id ? `${me.display_name}, “${s.title}” hikayesindeki yorumuna yanıt verdi` : `${me.display_name}, “${s.title}” hikayesine yorum yazdı`;
      notify(db, uid, { from: me.id, kind: 'story_comment', title, body: body.slice(0, 140), link: { type: 'story', id: s.id } });
    }
    reply.code(201);
    return { comment: commentOut(me, s, db.prepare('SELECT * FROM story_comments WHERE id=?').get(info.lastInsertRowid)) };
  });
  app.delete('/api/stories/:id/comments/:cid', async (req) => {
    const me = requireUser(req);
    const s = readable(me, req.params.id);
    const c = db.prepare('SELECT * FROM story_comments WHERE id=? AND story_id=?').get(Number(req.params.cid), s.id);
    if (!c) throw err(404, 'Yorum bulunamadi');
    if (c.user_id !== me.id && s.user_id !== me.id) throw err(403, 'Bu yorumu silemezsin');
    db.prepare('DELETE FROM story_comments WHERE id=?').run(c.id);
    return { ok: true };
  });

  app.put('/api/stories/:id/progress', async (req) => {
    const me = requireUser(req);
    const s = readable(me, req.params.id);
    const b = req.body || {};
    const cid = int(b.chapter_id, { field: 'chapter_id', min: 1, required: true });
    const pos = int(b.pos, { field: 'pos', min: 0, max: 1e7 }) ?? 0;
    if (!db.prepare('SELECT 1 FROM story_chapters WHERE id=? AND story_id=?').get(cid, s.id)) throw bad('Bolum bulunamadi', { chapter_id: 'bulunamadi' });
    db.prepare(`INSERT INTO story_progress (story_id,user_id,chapter_id,pos,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(story_id,user_id) DO UPDATE SET chapter_id=excluded.chapter_id, pos=excluded.pos, updated_at=excluded.updated_at`).run(s.id, me.id, cid, pos, nowIso());
    return { ok: true };
  });
}

// Ana sayfa kartlari icin: gorunen hikayelerin ozeti (yazar kendi hikayesini hic bolum yayinlanmasa da gorur)
export function storiesFor(db, me, authorIds, groupId) {
  const out = new Map();
  if (!authorIds.length) return out;
  const scope = groupId ? `sg.group_id=${Math.trunc(Number(groupId))}` : `sg.group_id IN (${idList(userGroups(db, me.id).map((g) => g.id))})`;
  const rows = db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM story_chapters c WHERE c.story_id=s.id AND c.published_at IS NOT NULL) pub,
      (SELECT MAX(published_at) FROM story_chapters c WHERE c.story_id=s.id) last_pub,
      (SELECT chapter_id FROM story_progress p WHERE p.story_id=s.id AND p.user_id=?) read_ch
    FROM stories s WHERE s.user_id IN (${idList(authorIds)}) AND (s.user_id=? OR EXISTS (SELECT 1 FROM story_groups sg WHERE sg.story_id=s.id AND ${scope}))
    ORDER BY s.updated_at DESC`).all(me.id, me.id);
  for (const r of rows) {
    if (r.user_id !== me.id && r.pub === 0) continue; // hic bolum yayinlanmadiysa baskasi gormez
    const list = out.get(r.user_id) || [];
    list.push({ id: r.id, title: r.title, summary: r.summary, color: r.color, chapters: r.pub, updated_at: r.last_pub || r.updated_at, started: !!r.read_ch });
    out.set(r.user_id, list);
  }
  return out;
}
