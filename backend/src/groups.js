import { randomBytes } from 'node:crypto';
import { nowIso, err, bad } from './util.js';
import { pruneLinks } from './links.js';

export const DEFAULT_GROUP = 'Aile Kütüphanesi';

export const memberRow = (db, groupId, userId) => db.prepare('SELECT * FROM group_members WHERE group_id=? AND user_id=?').get(groupId, userId);

// Kullanicinin gruplari (katilis sirasina gore; ilki 'birincil' grup)
export const userGroups = (db, userId) => db.prepare(`SELECT g.id, g.name, m.role FROM group_members m JOIN groups g ON g.id=m.group_id
  WHERE m.user_id=? ORDER BY m.joined_at, g.id`).all(userId).map((g) => ({ id: g.id, name: g.name || DEFAULT_GROUP, role: g.role }));

// Kullanicinin sahibi oldugu ilk grup (eski /api/admin/* uclari bunu kullanir); yoksa olusturur
export function ownedGroup(db, userId, token) {
  let g = db.prepare("SELECT g.* FROM groups g JOIN group_members m ON m.group_id=g.id AND m.user_id=? AND m.role='owner' ORDER BY g.id").get(userId);
  if (!g) {
    const id = Number(db.prepare('INSERT INTO groups (owner_id,invite_token,created_at) VALUES (?,?,?)').run(userId, token, nowIso()).lastInsertRowid);
    addMember(db, id, userId, 'owner');
    g = db.prepare('SELECT * FROM groups WHERE id=?').get(id);
  }
  return g;
}

// Grup yonetici hesabi: grubun sahibi olur (sifreyle girilemez), kurucu kisisel hesaba baglanir (gecis), kurucu grupta uye kalir.
// Tek basina transaction acmaz: cagiran tx icinde olmali ya da tek cagri olarak kullanmali
export function createManager(db, g, creatorId) {
  const now = nowIso();
  const creator = db.prepare('SELECT * FROM users WHERE id=?').get(creatorId);
  const name = g.name || DEFAULT_GROUP;
  const slug = (name.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 18).replace(/-+$/, '')) || 'grup';
  let username = `${slug}-yonetici`;
  for (let i = 2; db.prepare('SELECT 1 FROM users WHERE username=?').get(username); i++) username = `${slug}-yonetici${i}`;
  const hash = `locked$${randomBytes(16).toString('hex')}`; // verifyPassword hicbir sifreyi kabul etmez
  const id = Number(db.prepare("INSERT INTO users (username,display_name,password_hash,role,avatar,color,kind,created_at) VALUES (?,?,?,?,?,?,'manager',?)")
    .run(username, `${name} Yönetici`.slice(0, 60), hash, 'member', '🔑', '#64748b', now).lastInsertRowid);
  db.prepare("UPDATE group_members SET role='member' WHERE group_id=? AND user_id=?").run(g.id, creatorId);
  if (!g.invite_name && creator) db.prepare('UPDATE groups SET invite_name=? WHERE id=?').run(creator.display_name, g.id);
  db.prepare('UPDATE groups SET owner_id=? WHERE id=?').run(id, g.id);
  addMember(db, g.id, id, 'owner');
  const link = db.prepare('SELECT group_id FROM account_links WHERE user_id=?').get(creatorId);
  const lg = link ? link.group_id : db.prepare('SELECT COALESCE(MAX(group_id),0)+1 g FROM account_links').get().g;
  const up = db.prepare('INSERT INTO account_links (user_id,group_id) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET group_id=excluded.group_id');
  up.run(creatorId, lg);
  up.run(id, lg);
  return id;
}

// Grubun yonetici hesabi (yoksa null)
export const managerOf = (db, groupId) => db.prepare("SELECT u.id,u.display_name,u.avatar,u.color FROM groups g JOIN users u ON u.id=g.owner_id WHERE g.id=? AND u.kind='manager'").get(groupId) || null;

export function addMember(db, groupId, userId, role = 'member', shareExisting = false) {
  db.prepare('INSERT OR IGNORE INTO group_members (user_id,group_id,role,joined_at) VALUES (?,?,?,?)').run(userId, groupId, role, nowIso());
  if (shareExisting) db.prepare('INSERT OR IGNORE INTO entry_groups (entry_id,group_id) SELECT id,? FROM entries WHERE user_id=?').run(groupId, userId);
}

// Uyelik biter: kisinin kayitlari o gruptan duser, kayitlarin kendisi kalir
export function removeMember(db, groupId, userId) {
  db.prepare('DELETE FROM entry_groups WHERE group_id=? AND entry_id IN (SELECT id FROM entries WHERE user_id=?)').run(groupId, userId);
  db.prepare('DELETE FROM comment_groups WHERE group_id=? AND comment_id IN (SELECT id FROM comments WHERE user_id=?)').run(groupId, userId);
  db.prepare('DELETE FROM rating_groups WHERE group_id=? AND user_id=?').run(groupId, userId);
  db.prepare('DELETE FROM group_members WHERE group_id=? AND user_id=?').run(groupId, userId);
  // Gruptan ayrilan kisinin bu grubun yonetici hesabina baglantisi duser (baska grup yoneticilerine baglantisi kalir)
  const mgr = managerOf(db, groupId);
  const lg = mgr && db.prepare('SELECT group_id FROM account_links WHERE user_id=?').get(mgr.id);
  if (lg && db.prepare('SELECT 1 FROM account_links WHERE user_id=? AND group_id=?').get(userId, lg.group_id)) {
    const stay = db.prepare(`SELECT 1 FROM account_links l JOIN group_members m ON m.user_id=l.user_id AND m.group_id=? JOIN users u ON u.id=l.user_id
      WHERE l.group_id=? AND u.kind<>'manager' AND u.active=1 LIMIT 1`).get(groupId, lg.group_id);
    if (!stay) { db.prepare('DELETE FROM account_links WHERE user_id=?').run(mgr.id); pruneLinks(db); }
  }
}

// Yeni kayit: varsayilan olarak kisinin tum gruplarinda gorunur
export function defaultEntryGroups(db, entryId, userId) {
  db.prepare('INSERT OR IGNORE INTO entry_groups (entry_id,group_id) SELECT ?,group_id FROM group_members WHERE user_id=?').run(entryId, userId);
}

// ---- Kapsam (?group=) yardimcilari ----
// Istekteki ?group=<id>: yoksa null (Hesabim = kisinin kendi kayitlari); uye degilse 403
export function scopeGroup(db, me, raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw err(400, 'group gecersiz', { group: 'gecersiz' });
  if (!memberRow(db, id, me.id)) throw err(403, 'Bu grubun uyesi degilsiniz');
  return id;
}
export const idList = (ids) => (ids.length ? ids.map((i) => Math.trunc(Number(i))).join(',') : 'NULL'); // sadece tamsayi, SQL'e gomulur
// Bakan kisinin gorebilecegi gruplar: group verilmisse yalniz o, yoksa tum uyelikleri
export const viewerGroups = (db, meId, groupId) => (groupId ? [groupId] : userGroups(db, meId).map((g) => g.id));
// Iki kisinin ortak gruplari
export const commonGroups = (db, a, b) => db.prepare('SELECT m1.group_id FROM group_members m1 JOIN group_members m2 ON m2.group_id=m1.group_id AND m2.user_id=? WHERE m1.user_id=?').all(b, a).map((r) => r.group_id);
// Bakan kisi bu kaydi gorebilir mi: kendi kaydi ya da kayit, bakanin uye oldugu (groupId verilmisse yalniz o) bir grupta gorunur
export function canSeeEntry(db, meId, e, groupId = null) {
  if (e.user_id === meId && !groupId) return true;
  return !!db.prepare(`SELECT 1 FROM entry_groups eg JOIN group_members m ON m.group_id=eg.group_id AND m.user_id=?
    WHERE eg.entry_id=? ${groupId ? 'AND eg.group_id=?' : ''} LIMIT 1`).get(...[meId, e.id, ...(groupId ? [groupId] : [])]);
}
export function needSeeEntry(db, meId, id, groupId = null) {
  const e = db.prepare('SELECT * FROM entries WHERE id=?').get(id);
  if (!e || !canSeeEntry(db, meId, e, groupId)) throw err(404, 'Kayit bulunamadi');
  return e;
}
// Bakan kisinin (grup kapsamina gore) gorebildigi kayit kosulu: e.* uzerinden. groupId yoksa bakanin tum gruplari + kendi kayitlari (all=true) ya da yalniz kendi kayitlari
export function entryVisibleSql(meId, groupIds, { own = true, alias = 'e' } = {}) {
  const g = `EXISTS (SELECT 1 FROM entry_groups eg WHERE eg.entry_id=${alias}.id AND eg.group_id IN (${idList(groupIds)}))`;
  return own ? `(${alias}.user_id=${Math.trunc(meId)} OR ${g})` : g;
}
// Yorum/puan gorunurluk satirlari
export function commentVisibleSql(meId, groupIds, alias = 'c') {
  return `(${alias}.user_id=${Math.trunc(meId)} OR EXISTS (SELECT 1 FROM comment_groups cg JOIN entry_groups eg ON eg.entry_id=${alias}.entry_id AND eg.group_id=cg.group_id
    WHERE cg.comment_id=${alias}.id AND cg.group_id IN (${idList(groupIds)})))`;
}
export function ratingVisibleSql(meId, groupIds, alias = 'r') {
  return `(${alias}.user_id=${Math.trunc(meId)} OR EXISTS (SELECT 1 FROM rating_groups rg JOIN entries e2 ON e2.user_id=rg.user_id AND e2.catalog_id=rg.catalog_id JOIN entry_groups eg ON eg.entry_id=e2.id AND eg.group_id=rg.group_id
    WHERE rg.user_id=${alias}.user_id AND rg.catalog_id=${alias}.catalog_id AND rg.group_id IN (${idList(groupIds)})))`;
}
// Bir kaydin gorunur oldugu gruplar
export const entryGroupIds = (db, entryId) => db.prepare('SELECT group_id FROM entry_groups WHERE entry_id=?').all(entryId).map((r) => r.group_id);

// Yorum / puan gorunurlugu: body { group_ids } | { all: true } | { none: true }; allowed disina cikilamaz. undefined => varsayilan (allowed)
export function parseVisibility(b, allowed) {
  if (b.none === true) return [];
  if (Array.isArray(b.group_ids) && b.group_ids.length <= 200) {
    const ids = [...new Set(b.group_ids.map(Number))];
    if (ids.some((i) => !allowed.includes(i))) throw bad('Sadece kaydin gorunur oldugu ve uyesi oldugunuz gruplar secilebilir', { group_ids: 'gecersiz' });
    return ids;
  }
  if (b.all === true || b.group_ids === undefined) return allowed;
  throw bad('group_ids dizisi, all veya none olmali', { group_ids: 'gecersiz' });
}
// Yorumun gruplari: kayit gorunur gruplar ∩ yazarin uyelikleri
export const commentAllowedGroups = (db, entryId, userId) => entryGroupIds(db, entryId).filter((g) => memberRow(db, g, userId));
export function setCommentGroups(db, commentId, ids) {
  db.prepare('DELETE FROM comment_groups WHERE comment_id=?').run(commentId);
  const ins = db.prepare('INSERT OR IGNORE INTO comment_groups (comment_id,group_id) VALUES (?,?)');
  for (const g of ids) ins.run(commentId, g);
}
export const commentGroupIds = (db, commentId) => db.prepare('SELECT group_id FROM comment_groups WHERE comment_id=? ORDER BY group_id').all(commentId).map((r) => r.group_id);
// Puanin izin verilen gruplari: kisinin bu katalogdaki kayitlarinin gorunur oldugu gruplar
export const ratingAllowedGroups = (db, userId, catalogId) => db.prepare(`SELECT DISTINCT eg.group_id FROM entries e JOIN entry_groups eg ON eg.entry_id=e.id
  JOIN group_members m ON m.group_id=eg.group_id AND m.user_id=e.user_id WHERE e.user_id=? AND e.catalog_id=?`).all(userId, catalogId).map((r) => r.group_id);
export function setRatingGroups(db, userId, catalogId, ids) {
  db.prepare('DELETE FROM rating_groups WHERE user_id=? AND catalog_id=?').run(userId, catalogId);
  const ins = db.prepare('INSERT OR IGNORE INTO rating_groups (user_id,catalog_id,group_id) VALUES (?,?,?)');
  for (const g of ids) ins.run(userId, catalogId, g);
}
export const ratingGroupIds = (db, userId, catalogId) => db.prepare('SELECT group_id FROM rating_groups WHERE user_id=? AND catalog_id=? ORDER BY group_id').all(userId, catalogId).map((r) => r.group_id);

// Katalog duzenleyicisi: platform yoneticisi ya da herhangi bir grubun sahibi
export const isGroupOwner = (db, userId) => !!db.prepare("SELECT 1 FROM group_members WHERE user_id=? AND role='owner' LIMIT 1").get(userId);
