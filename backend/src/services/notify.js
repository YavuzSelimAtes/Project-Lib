import { nowIso } from '../util.js';
import { pushOwnEvent } from './push.js';

// iki kisinin ortak gruplari
export const commonGroups = (db, a, b) => db.prepare('SELECT a.group_id g FROM group_members a JOIN group_members b ON b.group_id=a.group_id AND b.user_id=? WHERE a.user_id=?').all(b, a).map((r) => r.g);
export const mutedGroups = (db, userId) => new Set(db.prepare('SELECT group_id FROM group_mutes WHERE user_id=?').all(userId).map((r) => r.group_id));

// from: bildirimi tetikleyen kisi (ortak gruplar bulunur) ya da groups: acik grup listesi. Ortak grup varsa ve HEPSI susturulmussa bildirim/push hic gitmez.
export function notify(db, userId, { kind, title, body = null, link = null, from = null, groups = null, push = true }) {
  const gs = groups || (from != null ? commonGroups(db, from, userId) : []);
  let gid = null;
  if (gs.length) {
    const muted = mutedGroups(db, userId);
    gid = gs.find((g) => !muted.has(g)) ?? null;
    if (gid == null) return;
  }
  db.prepare('INSERT INTO notifications (user_id,kind,title,body,link_type,link_id,is_read,created_at,group_id) VALUES (?,?,?,?,?,?,0,?,?)')
    .run(userId, kind, title, body, link?.type ?? null, link?.id ?? null, nowIso(), gid);
  if (push) pushOwnEvent(db, userId, { title, body }); // telefon bildirimi (kapaliysa / tercih kapaliysa hicbir sey yapmaz)
}

// Kayit bitince: kaydin gorunur oldugu gruplardaki diger uyelere uygulama ici bildirim (push ayri: familyFinishedPush)
export function familyFinishedNotify(db, e) {
  const t = db.prepare('SELECT title FROM catalog WHERE id=?').get(e.catalog_id)?.title || 'bir kayıt';
  const who = db.prepare('SELECT display_name FROM users WHERE id=?').get(e.user_id)?.display_name || 'Biri';
  const title = e.type === 'movie' ? `${who} '${t}' filmini izledi 🎬` : e.type === 'series' ? `${who} '${t}' dizisini bitirdi 🎉` : `${who} '${t}' kitabını bitirdi 🎉`;
  const rows = db.prepare('SELECT u.id, GROUP_CONCAT(eg.group_id) gids FROM users u JOIN group_members m ON m.user_id=u.id JOIN entry_groups eg ON eg.group_id=m.group_id AND eg.entry_id=? WHERE u.active=1 AND u.id<>? GROUP BY u.id').all(e.id, e.user_id);
  for (const r of rows) notify(db, r.id, { kind: 'finished', title, link: { type: 'entry', id: e.id }, groups: String(r.gids).split(',').map(Number), push: false });
}
