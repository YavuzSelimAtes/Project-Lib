import { requireUser } from '../auth.js';
import { err, bad, int, str, nowIso, publicUser } from '../util.js';
import { notify } from '../services/notify.js';
import { scopeGroup, viewerGroups, idList } from '../groups.js';

// Gundem: grup uyelerinin son hareketleri (en yeni uste), begeni ve yorum
export default async function routes(app) {
  const db = app.db;

  // Paylasimin bakan kisiye gorunurlugu (p.* uzerinden): kayit/yorum/puan gruplarindan; yazar hala o grubun uyesi ve aktif olmali
  const visSql = (gids) => {
    const L = idList(gids);
    return `(p.user_id IN (SELECT u.id FROM users u WHERE u.active=1 AND u.kind<>'manager') AND EXISTS (SELECT 1 FROM group_members gm WHERE gm.user_id=p.user_id AND gm.group_id IN (${L})) AND (
      (p.kind IN ('read','watch','started','finished') AND EXISTS (SELECT 1 FROM entry_groups eg WHERE eg.entry_id=p.entry_id AND eg.group_id IN (${L})))
      OR (p.kind='comment' AND EXISTS (SELECT 1 FROM comment_groups cg WHERE cg.comment_id=p.ref_id AND cg.group_id IN (${L})))
      OR (p.kind='rating' AND EXISTS (SELECT 1 FROM rating_groups rg WHERE rg.user_id=p.user_id AND rg.catalog_id=p.catalog_id AND rg.group_id IN (${L})))))`;
  };

  const out = (me, p) => {
    const cat = db.prepare('SELECT id,title,type,cover_url,author_or_creator FROM catalog WHERE id=?').get(p.catalog_id);
    const user = publicUser(db.prepare('SELECT id,display_name,avatar,color FROM users WHERE id=?').get(p.user_id));
    const o = {
      id: p.id, kind: p.kind, user, at: p.updated_at, created_at: p.created_at,
      catalog: cat ? { id: cat.id, title: cat.title, type: cat.type, cover_url: cat.cover_url, author: cat.author_or_creator } : null,
      entry_id: p.entry_id, data: p.data ? JSON.parse(p.data) : {},
      like_count: db.prepare('SELECT COUNT(*) c FROM post_likes WHERE post_id=?').get(p.id).c,
      i_liked: !!db.prepare('SELECT 1 FROM post_likes WHERE post_id=? AND user_id=?').get(p.id, me.id),
      comment_count: db.prepare('SELECT COUNT(*) c FROM post_comments WHERE post_id=?').get(p.id).c,
    };
    if (p.kind === 'comment') o.comment = db.prepare('SELECT id,body FROM comments WHERE id=?').get(p.ref_id) || null;
    if (p.kind === 'read' || p.kind === 'watch' || p.kind === 'started' || p.kind === 'finished') {
      const e = db.prepare('SELECT type,status,current_page,total_pages,season,episode FROM entries WHERE id=?').get(p.entry_id);
      if (e) o.entry = e;
    }
    if (p.kind === 'rating') {
      const rows = db.prepare('SELECT metric,score,comment FROM book_ratings WHERE user_id=? AND catalog_id=?').all(p.user_id, p.catalog_id);
      o.rating = { average: rows.length ? Math.round((rows.reduce((s, r) => s + r.score, 0) / rows.length) * 10) / 10 : null, comments: rows.filter((r) => r.comment).slice(0, 3).map((r) => ({ metric: r.metric, text: r.comment })) };
    }
    return o;
  };

  // ?group=ID (Gundem sekmesi), ?before=<updated_at>~<id> ile sayfalama
  app.get('/api/gundem', async (req) => {
    const me = requireUser(req);
    const gid = scopeGroup(db, me, req.query.group);
    const gids = viewerGroups(db, me.id, gid);
    if (!gids.length) return { posts: [], next: null };
    const limit = Math.min(int(req.query.limit, { min: 1, max: 50, field: 'limit' }) || 30, 50);
    let where = visSql(gids);
    const args = [];
    if (req.query.before) {
      const [at, id] = String(req.query.before).split('~');
      where += ' AND (p.updated_at < ? OR (p.updated_at = ? AND p.id < ?))';
      args.push(at, at, Number(id) || 0);
    }
    const rows = db.prepare(`SELECT p.* FROM posts p WHERE ${where} ORDER BY p.updated_at DESC, p.id DESC LIMIT ?`).all(...args, limit + 1);
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    return { posts: page.map((p) => out(me, p)), next: more ? `${page[page.length - 1].updated_at}~${page[page.length - 1].id}` : null };
  });

  const seePost = (me, id) => {
    const gids = viewerGroups(db, me.id, null);
    const p = gids.length ? db.prepare(`SELECT p.* FROM posts p WHERE p.id=? AND ${visSql(gids)}`).get(Number(id)) : null;
    if (!p) throw err(404, 'Paylasim bulunamadi');
    return p;
  };
  const linkOf = (p) => (p.entry_id ? { type: 'entry', id: p.entry_id } : null);

  app.post('/api/posts/:id/like', async (req) => {
    const me = requireUser(req);
    const p = seePost(me, req.params.id);
    const ins = db.prepare('INSERT OR IGNORE INTO post_likes (post_id,user_id,created_at) VALUES (?,?,?)').run(p.id, me.id, nowIso());
    // ayni kisi+paylasim icin yalnizca ilk begenide bildirim (begeniyi geri alip tekrar basinca yeniden bildirilmez)
    if (ins.changes && p.user_id !== me.id && db.prepare('INSERT OR IGNORE INTO post_like_notified (post_id,user_id) VALUES (?,?)').run(p.id, me.id).changes) notify(db, p.user_id, { from: me.id, kind: 'post_like', title: `${me.display_name} paylaşımını beğendi ❤️`, link: linkOf(p) });
    return { like_count: db.prepare('SELECT COUNT(*) c FROM post_likes WHERE post_id=?').get(p.id).c, i_liked: true };
  });
  app.delete('/api/posts/:id/like', async (req) => {
    const me = requireUser(req);
    const p = seePost(me, req.params.id);
    db.prepare('DELETE FROM post_likes WHERE post_id=? AND user_id=?').run(p.id, me.id);
    return { like_count: db.prepare('SELECT COUNT(*) c FROM post_likes WHERE post_id=?').get(p.id).c, i_liked: false };
  });

  const cOut = (me, p, c) => ({ id: c.id, body: c.body, created_at: c.created_at, user: publicUser(db.prepare('SELECT id,display_name,avatar,color FROM users WHERE id=?').get(c.user_id)), can_delete: c.user_id === me.id || p.user_id === me.id });
  app.get('/api/posts/:id/comments', async (req) => {
    const me = requireUser(req);
    const p = seePost(me, req.params.id);
    return { comments: db.prepare('SELECT * FROM post_comments WHERE post_id=? ORDER BY id').all(p.id).map((c) => cOut(me, p, c)) };
  });
  app.post('/api/posts/:id/comments', async (req, reply) => {
    const me = requireUser(req);
    const p = seePost(me, req.params.id);
    const body = str((req.body || {}).body, { field: 'body', required: true, max: 1000 });
    const info = db.prepare('INSERT INTO post_comments (post_id,user_id,body,created_at) VALUES (?,?,?,?)').run(p.id, me.id, body, nowIso());
    const targets = new Set(db.prepare('SELECT DISTINCT user_id FROM post_comments WHERE post_id=? AND user_id<>?').all(p.id, me.id).map((r) => r.user_id));
    if (p.user_id !== me.id) targets.add(p.user_id);
    for (const uid of targets) notify(db, uid, { from: me.id, kind: 'post_comment', title: uid === p.user_id ? `${me.display_name} paylaşımına yorum yazdı` : `${me.display_name} yorum yazdığın paylaşıma yorum yazdı`, body: body.slice(0, 140), link: linkOf(p) });
    reply.code(201);
    return { comment: cOut(me, p, db.prepare('SELECT * FROM post_comments WHERE id=?').get(info.lastInsertRowid)) };
  });
  app.delete('/api/posts/:id/comments/:cid', async (req) => {
    const me = requireUser(req);
    const p = seePost(me, req.params.id);
    const c = db.prepare('SELECT * FROM post_comments WHERE id=? AND post_id=?').get(Number(req.params.cid), p.id);
    if (!c) throw err(404, 'Yorum bulunamadi');
    if (c.user_id !== me.id && p.user_id !== me.id) throw err(403, 'Bu yorumu silemezsin');
    db.prepare('DELETE FROM post_comments WHERE id=?').run(c.id);
    return { ok: true };
  });
}
