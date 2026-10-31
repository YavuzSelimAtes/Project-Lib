import { requireUser, requireCatalogEditor } from '../auth.js';
import { err, bad, str, int, oneOf, nowIso, publicUser } from '../util.js';
import { catalogOut, markListed } from '../services/catalog.js';
import { notify } from '../services/notify.js';

const STATUSES = ['acik', 'inceleniyor', 'tamamlandi', 'reddedildi'];
// Grup sahibi yalniz sahibi oldugu gruplarin uyelerinin isteklerini gorur/cevaplar; platform yoneticisi hepsini
const scopeSql = (me) => me.role === 'admin' ? '1=1' : `user_id IN (SELECT user_id FROM group_members WHERE group_id IN (SELECT group_id FROM group_members WHERE user_id=${Number(me.id)} AND role='owner'))`;
const LABEL = { inceleniyor: 'incelemeye alindi', tamamlandi: 'tamamlandi', reddedildi: 'reddedildi', acik: 'tekrar acildi' };

export default async function routes(app) {
  const db = app.db;
  const out = (r) => r && ({
    id: r.id, user_id: r.user_id, type: r.type, title: r.title, note: r.note, status: r.status, admin_note: r.admin_note,
    resolved_catalog_id: r.resolved_catalog_id,
    resolved_catalog: r.resolved_catalog_id ? catalogOut(db.prepare('SELECT * FROM catalog WHERE id=?').get(r.resolved_catalog_id)) : null,
    created_at: r.created_at, updated_at: r.updated_at,
    user: publicUser(db.prepare('SELECT id,display_name,avatar,color FROM users WHERE id=?').get(r.user_id)),
  });

  app.post('/api/requests', async (req, reply) => {
    const me = requireUser(req);
    const b = req.body || {};
    const type = oneOf(b.type, ['book', 'movie', 'series'], { field: 'type', required: true });
    const title = str(b.title, { field: 'title', required: true, max: 300 });
    const note = str(b.note, { field: 'note', max: 1000 });
    const dup = db.prepare("SELECT 1 FROM requests WHERE user_id=? AND type=? AND lower(title)=lower(?) AND status IN ('acik','inceleniyor')").get(me.id, type, title);
    if (dup) throw err(409, 'Bu talebi zaten gonderdiniz, yonetici bakiyor');
    const now = nowIso();
    const info = db.prepare('INSERT INTO requests (user_id,type,title,note,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(me.id, type, title, note, 'acik', now, now);
    reply.code(201);
    return { request: out(db.prepare('SELECT * FROM requests WHERE id=?').get(info.lastInsertRowid)) };
  });

  app.get('/api/requests', async (req) => {
    const me = requireUser(req);
    return { requests: db.prepare('SELECT * FROM requests WHERE user_id=? ORDER BY id DESC').all(me.id).map(out) };
  });

  app.get('/api/admin/requests', async (req) => {
    const me = requireCatalogEditor(req);
    const sc = scopeSql(me);
    const status = oneOf(req.query.status, STATUSES, { field: 'status' });
    const rows = status
      ? db.prepare(`SELECT * FROM requests WHERE status=? AND ${sc} ORDER BY id DESC`).all(status)
      : db.prepare(`SELECT * FROM requests WHERE ${sc} ORDER BY id DESC`).all();
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const r of db.prepare('SELECT status, COUNT(*) c FROM requests WHERE ' + sc + ' GROUP BY status').all()) counts[r.status] = r.c;
    return { requests: rows.map(out), counts };
  });

  app.patch('/api/admin/requests/:id', async (req) => {
    const me = requireCatalogEditor(req);
    const id = Number(req.params.id);
    const r = db.prepare(`SELECT * FROM requests WHERE id=? AND ${scopeSql(me)}`).get(id);
    if (!r) throw err(404, 'Talep bulunamadi');
    const b = req.body || {};
    let status = b.status !== undefined ? oneOf(b.status, STATUSES, { field: 'status', required: true }) : r.status;
    const admin_note = b.admin_note !== undefined ? str(b.admin_note, { field: 'admin_note', max: 1000 }) : r.admin_note;
    let resolved = r.resolved_catalog_id;
    if (b.resolved_catalog_id !== undefined) {
      if (b.resolved_catalog_id === null) resolved = null;
      else {
        resolved = int(b.resolved_catalog_id, { field: 'resolved_catalog_id' });
        if (!db.prepare('SELECT 1 FROM catalog WHERE id=?').get(resolved)) throw bad('Katalog kaydi bulunamadi', { resolved_catalog_id: 'yok' });
        if (b.status === undefined) status = 'tamamlandi';
      }
    }
    if (status === 'tamamlandi' && !resolved) throw bad('Talebi tamamlamak icin once katalogdan bir kayit baglayin (resolved_catalog_id)', { resolved_catalog_id: 'gerekli' });
    db.prepare('UPDATE requests SET status=?, admin_note=?, resolved_catalog_id=?, updated_at=? WHERE id=?').run(status, admin_note, resolved, nowIso(), id);
    if (resolved) markListed(db, resolved); // taleple baglanan katalog kaydi kalici olur
    const changed = status !== r.status || resolved !== r.resolved_catalog_id || admin_note !== r.admin_note;
    if (changed && status !== 'acik') {
      const cat = resolved ? db.prepare('SELECT title FROM catalog WHERE id=?').get(resolved) : null;
      notify(db, r.user_id, {
        kind: 'request_update',
        title: `"${r.title}" talebiniz ${LABEL[status]}`,
        body: [cat ? `Katalogda: ${cat.title}` : null, admin_note].filter(Boolean).join(' - ') || null,
        link: resolved ? { type: 'catalog', id: resolved } : { type: 'request', id },
      });
    }
    return { request: out(db.prepare('SELECT * FROM requests WHERE id=?').get(id)) };
  });
}
