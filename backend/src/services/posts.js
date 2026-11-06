import { nowIso, userToday } from '../util.js';

// Gundem paylasimlari. Gorunurluk okuma aninda kaydin/yorumun/puanin gruplarindan hesaplanir (routes/posts.js).
const eligible = (db, userId) => !!db.prepare("SELECT 1 FROM users WHERE id=? AND active=1 AND kind<>'manager'").get(userId);
const put = (db, p) => db.prepare('INSERT INTO posts (user_id,kind,entry_id,catalog_id,ref_id,day,data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
  .run(p.user_id, p.kind, p.entry_id ?? null, p.catalog_id ?? null, p.ref_id ?? null, p.day ?? null, p.data ? JSON.stringify(p.data) : null, nowIso(), nowIso());

// Gunluk okuma / izleme: ayni kisi+kayit+gun icin TEK kart; her yeni giriste yukari tasinir ve son artis yazilir ("25 sayfa daha okudu")
export function postRead(db, e, { pages = 0, episodes = 0 }) {
  try {
    if (!eligible(db, e.user_id) || (pages <= 0 && episodes <= 0)) return;
    const kind = e.type === 'book' ? 'read' : 'watch';
    const day = userToday(db, e.user_id);
    const prev = db.prepare('SELECT * FROM posts WHERE user_id=? AND entry_id=? AND kind=? AND day=?').get(e.user_id, e.id, kind, day);
    const last = kind === 'read' ? pages : episodes;
    if (prev) {
      const o = JSON.parse(prev.data || '{}');
      const data = { last, total: (o.total || 0) + last, times: (o.times || 1) + 1 };
      db.prepare('UPDATE posts SET data=?, updated_at=? WHERE id=?').run(JSON.stringify(data), nowIso(), prev.id);
    } else {
      put(db, { user_id: e.user_id, kind, entry_id: e.id, catalog_id: e.catalog_id, day, data: { last, total: last, times: 1 } });
    }
  } catch { /* gundem asla akisi bozmaz */ }
}

// Basladi / bitirdi: kayit basina bir kart (tekrarinda yukari tasinir)
export function postEvent(db, e, kind) {
  try {
    if (!eligible(db, e.user_id)) return;
    const data = { type: e.type, page: e.current_page || 0 };
    const prev = db.prepare('SELECT id FROM posts WHERE user_id=? AND entry_id=? AND kind=?').get(e.user_id, e.id, kind);
    if (prev) db.prepare('UPDATE posts SET data=?, updated_at=? WHERE id=?').run(JSON.stringify(data), nowIso(), prev.id);
    else put(db, { user_id: e.user_id, kind, entry_id: e.id, catalog_id: e.catalog_id, data });
  } catch { /* onemsiz */ }
}

// Yorum: yalniz bir gruba acik paylasilan yorumlar
export function postComment(db, commentId, e, userId) {
  try {
    if (!eligible(db, userId)) return;
    if (!db.prepare('SELECT 1 FROM comment_groups WHERE comment_id=? LIMIT 1').get(commentId)) return;
    put(db, { user_id: userId, kind: 'comment', entry_id: e.id, catalog_id: e.catalog_id, ref_id: commentId });
  } catch { /* onemsiz */ }
}

// Puan: kisi+kitap basina bir kart (puan guncellenince yukari tasinir)
export function postRating(db, userId, catalogId) {
  try {
    if (!eligible(db, userId)) return;
    if (!db.prepare('SELECT 1 FROM rating_groups WHERE user_id=? AND catalog_id=? LIMIT 1').get(userId, catalogId)) return;
    const prev = db.prepare("SELECT id FROM posts WHERE user_id=? AND catalog_id=? AND kind='rating'").get(userId, catalogId);
    if (prev) db.prepare('UPDATE posts SET updated_at=? WHERE id=?').run(nowIso(), prev.id);
    else put(db, { user_id: userId, kind: 'rating', catalog_id: catalogId });
  } catch { /* onemsiz */ }
}
export const dropRatingPost = (db, userId, catalogId) => db.prepare("DELETE FROM posts WHERE user_id=? AND catalog_id=? AND kind='rating'").run(userId, catalogId);
