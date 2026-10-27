import { requireUser } from '../auth.js';
import { err, bad, str, int, nowIso, publicUser } from '../util.js';
import { notify } from '../services/notify.js';
import { getEntry } from '../services/entries.js';

export const REACTIONS = ['❤️', '👍', '😂', '😮', '🔥'];

export default async function routes(app) {
  const db = app.db;
  const userOf = (id) => publicUser(db.prepare('SELECT id,display_name,avatar,color FROM users WHERE id=?').get(id));
  const entryTitle = (e) => db.prepare('SELECT title FROM catalog WHERE id=?').get(e.catalog_id)?.title || 'kayit';

  const reactionsOf = (commentId, meId) => {
    const reactions = {};
    let my = null;
    for (const r of db.prepare('SELECT user_id,emoji FROM comment_reactions WHERE comment_id=?').all(commentId)) {
      reactions[r.emoji] = (reactions[r.emoji] || 0) + 1;
      if (r.user_id === meId) my = r.emoji;
    }
    return { reactions, my_reaction: my };
  };
  const commentOut = (c, meId = null) => ({ id: c.id, entry_id: c.entry_id, user_id: c.user_id, body: c.body, created_at: c.created_at, user: userOf(c.user_id), ...reactionsOf(c.id, meId) });
  const questionOut = (q) => {
    const e = getEntry(db, q.entry_id);
    const cat = db.prepare('SELECT id,title,type,cover_url FROM catalog WHERE id=?').get(e.catalog_id);
    return {
      id: q.id, entry_id: q.entry_id, asker_id: q.asker_id, question: q.question, answer: q.answer, answered_at: q.answered_at, created_at: q.created_at,
      asker: userOf(q.asker_id),
      entry: { id: e.id, user_id: e.user_id, catalog: cat, user: userOf(e.user_id) },
    };
  };
  const needEntry = (id) => {
    const e = getEntry(db, id);
    if (!e) throw err(404, 'Kayit bulunamadi');
    return e;
  };

  // ---- yorumlar ----
  app.get('/api/entries/:id/comments', async (req) => {
    const me = requireUser(req);
    const e = needEntry(Number(req.params.id));
    return { comments: db.prepare('SELECT * FROM comments WHERE entry_id=? ORDER BY id').all(e.id).map((c) => commentOut(c, me.id)) };
  });
  app.post('/api/entries/:id/comments', async (req, reply) => {
    const me = requireUser(req);
    const e = needEntry(Number(req.params.id));
    const body = str((req.body || {}).body, { field: 'body', required: true, max: 2000 });
    const info = db.prepare('INSERT INTO comments (entry_id,user_id,body,created_at) VALUES (?,?,?,?)').run(e.id, me.id, body, nowIso());
    // kayit sahibine + ayni kayitta daha once yorum yapmis diger kisilere (yazar haric, herkese en fazla 1 bildirim)
    const targets = new Set(db.prepare('SELECT DISTINCT user_id FROM comments WHERE entry_id=? AND user_id<>?').all(e.id, me.id).map((r) => r.user_id));
    if (e.user_id !== me.id) targets.add(e.user_id);
    for (const uid of targets) {
      const title = uid === e.user_id ? `${me.display_name}, "${entryTitle(e)}" kaydına yorum yazdı` : `${me.display_name}, yorum yazdığın "${entryTitle(e)}" kaydına yeni yorum yazdı`;
      notify(db, uid, { kind: 'comment', title, body: body.slice(0, 140), link: { type: 'entry', id: e.id } });
    }
    reply.code(201);
    return { comment: commentOut(db.prepare('SELECT * FROM comments WHERE id=?').get(info.lastInsertRowid), me.id) };
  });
  // Yorum tepkisi: kisi basina yorum basina 1 emoji. Ayni emoji = kaldir, farkli emoji = degistir. emoji:null da kaldirir.
  app.put('/api/comments/:id/reaction', async (req) => {
    const me = requireUser(req);
    const c = db.prepare('SELECT * FROM comments WHERE id=?').get(Number(req.params.id));
    if (!c) throw err(404, 'Yorum bulunamadi');
    const emoji = (req.body || {}).emoji;
    if (emoji !== null && emoji !== undefined && !REACTIONS.includes(emoji)) throw bad(`emoji su degerlerden biri olmali: ${REACTIONS.join(' ')}`, { emoji: 'gecersiz deger' });
    const cur = db.prepare('SELECT emoji FROM comment_reactions WHERE comment_id=? AND user_id=?').get(c.id, me.id);
    if (!emoji || cur?.emoji === emoji) {
      db.prepare('DELETE FROM comment_reactions WHERE comment_id=? AND user_id=?').run(c.id, me.id);
    } else {
      db.prepare('INSERT INTO comment_reactions (comment_id,user_id,emoji,created_at) VALUES (?,?,?,?) ON CONFLICT(comment_id,user_id) DO UPDATE SET emoji=excluded.emoji, created_at=excluded.created_at').run(c.id, me.id, emoji, nowIso());
      // bildirim: kendi yorumuna yok; ayni kisi+yorum icin yalnizca ilk tepkide (emoji degistirince / kaldirip tekrar basinca yeniden bildirilmez)
      if (c.user_id !== me.id && db.prepare('INSERT OR IGNORE INTO comment_reaction_notified (comment_id,user_id) VALUES (?,?)').run(c.id, me.id).changes) {
        notify(db, c.user_id, { kind: 'comment_reaction', title: `${me.display_name}, yorumuna ${emoji} tepkisi verdi`, body: c.body.slice(0, 140), link: { type: 'entry', id: c.entry_id } });
      }
    }
    return { comment_id: c.id, ...reactionsOf(c.id, me.id) };
  });
  // Genel kitaplik: bir kitaba (katalog) ait TUM kayitlardaki yorumlar / sorular birlestirilmis (sayfalama: limit<=100, offset)
  const page = (q) => ({ limit: Math.min(int(q.limit, { min: 1, max: 100, field: 'limit' }) || 30, 100), offset: int(q.offset, { min: 0, field: 'offset' }) || 0 });
  const needCat = (id) => { if (!db.prepare('SELECT 1 FROM catalog WHERE id=?').get(id)) throw err(404, 'Katalog kaydi bulunamadi'); };
  app.get('/api/library/:id/comments', async (req) => {
    const me = requireUser(req);
    const id = Number(req.params.id);
    needCat(id);
    const { limit, offset } = page(req.query);
    const total = db.prepare('SELECT COUNT(*) c FROM comments c JOIN entries e ON e.id=c.entry_id WHERE e.catalog_id=?').get(id).c;
    const rows = db.prepare('SELECT c.* FROM comments c JOIN entries e ON e.id=c.entry_id WHERE e.catalog_id=? ORDER BY c.id DESC LIMIT ? OFFSET ?').all(id, limit, offset);
    return { comments: rows.map((c) => commentOut(c, me.id)), total };
  });
  app.get('/api/library/:id/questions', async (req) => {
    requireUser(req);
    const id = Number(req.params.id);
    needCat(id);
    const { limit, offset } = page(req.query);
    const total = db.prepare('SELECT COUNT(*) c FROM questions q JOIN entries e ON e.id=q.entry_id WHERE e.catalog_id=?').get(id).c;
    const rows = db.prepare('SELECT q.* FROM questions q JOIN entries e ON e.id=q.entry_id WHERE e.catalog_id=? ORDER BY q.id DESC LIMIT ? OFFSET ?').all(id, limit, offset);
    return { questions: rows.map(questionOut), total };
  });
  app.delete('/api/comments/:id', async (req) => {
    const me = requireUser(req);
    const c = db.prepare('SELECT * FROM comments WHERE id=?').get(Number(req.params.id));
    if (!c) throw err(404, 'Yorum bulunamadi');
    if (c.user_id !== me.id && me.role !== 'admin') throw err(403, 'Bu yorumu silemezsiniz');
    db.prepare('DELETE FROM comments WHERE id=?').run(c.id);
    return { ok: true };
  });

  // ---- soru-cevap ----
  app.get('/api/entries/:id/questions', async (req) => {
    requireUser(req);
    const e = needEntry(Number(req.params.id));
    return { questions: db.prepare('SELECT * FROM questions WHERE entry_id=? ORDER BY id').all(e.id).map(questionOut) };
  });
  app.post('/api/entries/:id/questions', async (req, reply) => {
    const me = requireUser(req);
    const e = needEntry(Number(req.params.id));
    if (e.user_id === me.id) throw bad('Kendi kaydiniza soru soramazsiniz');
    const question = str((req.body || {}).question, { field: 'question', required: true, max: 1000 });
    const info = db.prepare('INSERT INTO questions (entry_id,asker_id,question,created_at) VALUES (?,?,?,?)').run(e.id, me.id, question, nowIso());
    notify(db, e.user_id, { kind: 'question_asked', title: `${me.display_name}, "${entryTitle(e)}" hakkinda soru sordu`, body: question.slice(0, 140), link: { type: 'entry', id: e.id } });
    reply.code(201);
    return { question: questionOut(db.prepare('SELECT * FROM questions WHERE id=?').get(info.lastInsertRowid)) };
  });
  app.patch('/api/questions/:id', async (req) => {
    const me = requireUser(req);
    const q = db.prepare('SELECT * FROM questions WHERE id=?').get(Number(req.params.id));
    if (!q) throw err(404, 'Soru bulunamadi');
    const e = getEntry(db, q.entry_id);
    if (e.user_id !== me.id && me.role !== 'admin') throw err(403, 'Bu soruyu sadece kayit sahibi cevaplayabilir');
    const answer = str((req.body || {}).answer, { field: 'answer', required: true, max: 2000 });
    const first = !q.answer;
    db.prepare('UPDATE questions SET answer=?, answered_at=? WHERE id=?').run(answer, nowIso(), q.id);
    if (first && q.asker_id !== me.id) {
      notify(db, q.asker_id, { kind: 'question_answered', title: `${me.display_name}, "${entryTitle(e)}" hakkindaki sorunuzu cevapladi`, body: answer.slice(0, 140), link: { type: 'entry', id: e.id } });
    }
    return { question: questionOut(db.prepare('SELECT * FROM questions WHERE id=?').get(q.id)) };
  });
  app.delete('/api/questions/:id', async (req) => {
    const me = requireUser(req);
    const q = db.prepare('SELECT * FROM questions WHERE id=?').get(Number(req.params.id));
    if (!q) throw err(404, 'Soru bulunamadi');
    if (q.asker_id !== me.id && me.role !== 'admin') throw err(403, 'Bu soruyu silemezsiniz');
    db.prepare('DELETE FROM questions WHERE id=?').run(q.id);
    return { ok: true };
  });
  app.get('/api/me/pending-questions', async (req) => {
    const me = requireUser(req);
    const rows = db.prepare(`SELECT q.* FROM questions q JOIN entries e ON e.id=q.entry_id
      WHERE e.user_id=? AND q.answer IS NULL ORDER BY q.id`).all(me.id);
    return { questions: rows.map(questionOut) };
  });
}
