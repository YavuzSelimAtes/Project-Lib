import { randomBytes } from 'node:crypto';
import { requireUser } from '../auth.js';
import { err, bad, str, nowIso } from '../util.js';
import { DEFAULT_GROUP, memberRow, userGroups, addMember, removeMember } from '../groups.js';

export default async function routes(app) {
  const db = app.db;
  const newToken = () => randomBytes(18).toString('base64url');

  // Uyesi oldugum grubu getirir; uye degilse 404 (grubun varligi sizdirilmaz)
  const myGroup = (req, owner = false) => {
    const me = requireUser(req);
    const id = Number(req.params.id);
    const g = Number.isInteger(id) ? db.prepare('SELECT * FROM groups WHERE id=?').get(id) : null;
    const m = g && memberRow(db, g.id, me.id);
    if (!m) throw err(404, 'Grup bulunamadi');
    if (owner && m.role !== 'owner') throw err(403, 'Bu islem icin grup sahibi olmaniz gerekir');
    return { me, g, role: m.role };
  };
  const count = (gid) => db.prepare('SELECT COUNT(*) c FROM group_members WHERE group_id=?').get(gid).c;

  app.post('/api/groups', async (req, reply) => {
    const me = requireUser(req);
    const b = req.body || {};
    const name = str(b.name, { field: 'name', required: true, max: 40 });
    const share = b.share_existing === true;
    const id = Number(db.prepare('INSERT INTO groups (owner_id,invite_token,name,created_at) VALUES (?,?,?,?)').run(me.id, newToken(), name, nowIso()).lastInsertRowid);
    addMember(db, id, me.id, 'owner', share);
    reply.code(201);
    return { group: { id, name, role: 'owner', member_count: 1 } };
  });

  app.get('/api/groups', async (req) => {
    const me = requireUser(req);
    return { groups: userGroups(db, me.id).map((g) => ({ ...g, member_count: count(g.id) })) };
  });

  app.get('/api/groups/:id', async (req) => {
    const { g, role } = myGroup(req);
    const members = db.prepare(`SELECT u.id, u.username, u.display_name, u.avatar, u.color, m.role, m.joined_at FROM group_members m JOIN users u ON u.id=m.user_id
      WHERE m.group_id=? AND u.active=1 ORDER BY m.role='owner' DESC, m.joined_at, u.id`).all(g.id);
    return { group: { id: g.id, name: g.name || DEFAULT_GROUP, role, invite_name: g.invite_name || '', member_count: count(g.id), members } };
  });

  app.post('/api/groups/:id/leave', async (req) => {
    const { me, g, role } = myGroup(req);
    if (role === 'owner') throw bad('Grup sahibi gruptan ayrilamaz');
    removeMember(db, g.id, me.id);
    return { ok: true };
  });

  app.delete('/api/groups/:id/members/:userId', async (req) => {
    const { me, g } = myGroup(req, true);
    const uid = Number(req.params.userId);
    if (uid === me.id) throw bad('Grup sahibi kendini cikaramaz');
    if (!memberRow(db, g.id, uid)) throw err(404, 'Uye bulunamadi');
    removeMember(db, g.id, uid);
    return { ok: true };
  });

  // ---- davet linki / adlar (sadece sahip) ----
  app.get('/api/groups/:id/invite', async (req) => {
    const { g } = myGroup(req, true);
    return { token: g.invite_token, invite_name: g.invite_name || '' };
  });
  app.put('/api/groups/:id/invite-name', async (req) => {
    const { g } = myGroup(req, true);
    const name = str((req.body || {}).name, { field: 'name', max: 40 });
    db.prepare('UPDATE groups SET invite_name=? WHERE id=?').run(name || null, g.id);
    return { invite_name: name || '' };
  });
  app.post('/api/groups/:id/invite/regenerate', async (req) => {
    const { g } = myGroup(req, true);
    const token = newToken();
    db.prepare('UPDATE groups SET invite_token=? WHERE id=?').run(token, g.id);
    return { token };
  });
  app.put('/api/groups/:id/name', async (req) => {
    const { g } = myGroup(req, true);
    const name = str((req.body || {}).name, { field: 'name', max: 40 });
    db.prepare('UPDATE groups SET name=? WHERE id=?').run(name || null, g.id);
    return { group_name: name || DEFAULT_GROUP };
  });

  // ---- kayit gorunurlugu (sadece kayit sahibi, sadece uyesi oldugu gruplar) ----
  const myEntry = (req) => {
    const me = requireUser(req);
    const e = db.prepare('SELECT id,user_id FROM entries WHERE id=?').get(Number(req.params.id));
    if (!e) throw err(404, 'Kayit bulunamadi');
    if (e.user_id !== me.id) throw err(403, 'Bu kayit size ait degil');
    return { me, e };
  };
  const visibility = (e, me) => {
    const on = new Set(db.prepare('SELECT group_id FROM entry_groups WHERE entry_id=?').all(e.id).map((r) => r.group_id));
    return { entry_id: e.id, groups: userGroups(db, me.id).map((g) => ({ id: g.id, name: g.name, visible: on.has(g.id) })) };
  };
  app.get('/api/entries/:id/groups', async (req) => {
    const { me, e } = myEntry(req);
    return visibility(e, me);
  });
  // Govde: { group_ids: [..] } | { all: true } | { none: true }
  app.put('/api/entries/:id/groups', async (req) => {
    const { me, e } = myEntry(req);
    const b = req.body || {};
    const mine = userGroups(db, me.id).map((g) => g.id);
    let ids;
    if (b.all === true) ids = mine;
    else if (b.none === true) ids = [];
    else if (Array.isArray(b.group_ids) && b.group_ids.length <= 200) {
      ids = [...new Set(b.group_ids.map(Number))];
      if (ids.some((i) => !mine.includes(i))) throw bad('Sadece uyesi oldugunuz gruplar secilebilir', { group_ids: 'gecersiz' });
    } else throw bad('group_ids dizisi, all veya none gerekli', { group_ids: 'zorunlu' });
    db.prepare('DELETE FROM entry_groups WHERE entry_id=?').run(e.id);
    const ins = db.prepare('INSERT INTO entry_groups (entry_id,group_id) VALUES (?,?)');
    for (const gid of ids) ins.run(e.id, gid);
    return visibility(e, me);
  });
}
