// Bagli hesaplar: grup = birbirine sifresiz gecebilen hesaplar (admin hesaplar asla grupta olmaz)

// Grupta 2'den az (gecerli) uye kalan gruplari temizler
export function pruneLinks(db) {
  db.prepare(`DELETE FROM account_links WHERE user_id IN (SELECT user_id FROM account_links l JOIN users u ON u.id=l.user_id WHERE u.active=0 OR u.role='admin')`).run();
  db.prepare('DELETE FROM account_links WHERE group_id IN (SELECT group_id FROM account_links GROUP BY group_id HAVING COUNT(*)<2)').run();
}

// Kullaniciyi gruptan cikarir (pasife alma / admin yapma)
export function unlinkUser(db, userId) {
  db.prepare('DELETE FROM account_links WHERE user_id=?').run(userId);
  pruneLinks(db);
}

// Kullanicinin kendi grubundaki diger aktif, admin olmayan uyeler
export function linkedUsers(db, userId) {
  return db.prepare(`SELECT u.* FROM account_links me JOIN account_links o ON o.group_id=me.group_id AND o.user_id<>me.user_id
    JOIN users u ON u.id=o.user_id WHERE me.user_id=? AND u.active=1 AND u.role<>'admin' ORDER BY u.id`).all(userId);
}
