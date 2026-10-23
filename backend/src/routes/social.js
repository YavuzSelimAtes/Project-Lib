import { requireUser } from '../auth.js';
import { err, bad, str, nowIso, publicUser } from '../util.js';
import { notify } from '../services/notify.js';
import { getEntry } from '../services/entries.js';

export default async function routes(app) {
  const db = app.db;
  const userOf = (id) => publicUser(db.prepare('SELECT id,display_name,avatar,color FROM users WHERE id=?').get(id));
  const entryTitle = (e) => db.prepare('SELECT title FROM catalog WHERE id=?').get(e.catalog_id)?.title || 'kayit';

  const commentOut = (c) => ({ id: c.id, entry_id: c.entry_id, user_id: c.user_id, body: c.body, created_at: c.created_at, user: userOf(c.user_id) });
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
    requireUser(req);
    const e = needEntry(Number(req.params.id));
    return { comments: db.prepare('SELECT * FROM comments WHERE entry_id=? ORDER BY id').all(e.id).map(commentOut) };
  });
  app.post('/api/entries/:id/comments', async (req, reply) => {
    const me = requireUser(req);
    const e = needEntry(Number(req.params.id));
    const body = str((req.body || {}).body, { field: 'body', required: true, max: 2000 });
    const info = db.prepare('INSERT INTO comments (entry_id,user_id,body,created_at) VALUES (?,?,?,?)').run(e.id, me.id, body, nowIso());
    if (e.user_id !== me.id) {
      notify(db, e.user_id, { kind: 'comment', title: `${me.display_name}, "${entryTitle(e)}" kaydina yorum yazdi`, body: body.slice(0, 140), link: { type: 'entry', id: e.id } });
    }
    reply.code(201);
    return { comment: commentOut(db.prepare('SELECT * FROM comments WHERE id=?').get(info.lastInsertRowid)) };
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
