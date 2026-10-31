import { requireUser, requireAdmin } from '../auth.js';
import { err, bad, str, oneOf, nowIso } from '../util.js';
import { sendFeedbackMail } from '../services/mail.js';

const LIMIT = 5; // kisi basina saatte
export default async function routes(app) {
  const db = app.db;

  app.post('/api/feedback', async (req) => {
    const me = requireUser(req);
    const b = req.body || {};
    const kind = oneOf(b.kind, ['oneri', 'hata', 'begendim'], { field: 'kind', required: true });
    const message = str(b.message, { field: 'message', required: true, min: 1, max: 2000 });
    const page = str(b.page, { field: 'page', max: 200 });
    if (!message) throw bad('Mesaj bos olamaz', { message: 'zorunlu' });
    const since = new Date(Date.now() - 3600 * 1000).toISOString();
    if (db.prepare('SELECT COUNT(*) c FROM feedback WHERE user_id=? AND created_at>?').get(me.id, since).c >= LIMIT) throw err(429, 'Çok fazla mesaj gönderdiniz, bir saat sonra tekrar deneyin');
    const createdAt = nowIso();
    const id = Number(db.prepare('INSERT INTO feedback (user_id,kind,message,page,emailed,created_at) VALUES (?,?,?,?,0,?)').run(me.id, kind, message, page, createdAt).lastInsertRowid);
    const emailed = await sendFeedbackMail({ kind, message, page, createdAt, user: me }, req.log);
    if (emailed) db.prepare('UPDATE feedback SET emailed=1 WHERE id=?').run(id);
    return { ok: true, emailed };
  });

  app.get('/api/admin/feedback', async (req) => {
    requireAdmin(req);
    const rows = db.prepare(`SELECT f.*, u.display_name, u.username, u.kind ukind FROM feedback f LEFT JOIN users u ON u.id=f.user_id ORDER BY f.id DESC LIMIT 500`).all();
    return { items: rows.map((r) => ({ id: r.id, kind: r.kind, message: r.message, page: r.page, created_at: r.created_at, emailed: !!r.emailed, user: { id: r.user_id, display_name: r.display_name, username: r.username, kind: r.ukind || 'user' } })) };
  });

  app.delete('/api/admin/feedback/:id', async (req) => {
    requireAdmin(req);
    if (!db.prepare('DELETE FROM feedback WHERE id=?').run(Number(req.params.id)).changes) throw err(404, 'Mesaj bulunamadi');
    return { ok: true };
  });
}
