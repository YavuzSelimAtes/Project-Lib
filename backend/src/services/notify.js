import { nowIso } from '../util.js';

export function notify(db, userId, { kind, title, body = null, link = null }) {
  db.prepare('INSERT INTO notifications (user_id,kind,title,body,link_type,link_id,is_read,created_at) VALUES (?,?,?,?,?,?,0,?)')
    .run(userId, kind, title, body, link?.type ?? null, link?.id ?? null, nowIso());
}
