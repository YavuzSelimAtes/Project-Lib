// Bagli hesaplar: grup = birbirine sifresiz gecebilen hesaplar.
// Admin yalnizca tam 2 kisilik gruba (admin + kendi kullanici hesabi) girebilir.

// Pasif uyeleri, admin iceren ama tam 2 kisilik olmayan gruplari ve 2'den az uyeli gruplari temizler
export function pruneLinks(db) {
  db.prepare(`DELETE FROM account_links WHERE user_id IN (SELECT user_id FROM account_links l JOIN users u ON u.id=l.user_id WHERE u.active=0)`).run();
  db.prepare(`DELETE FROM account_links WHERE group_id IN (SELECT l.group_id FROM account_links l JOIN users u ON u.id=l.user_id GROUP BY l.group_id
    HAVING SUM(u.role='admin')>0 AND (SUM(u.kind<>'manager')<>2 OR SUM(u.role='admin')>1))`).run(); // grup yonetici hesaplari (kind='manager') sayilmaz
  db.prepare('DELETE FROM account_links WHERE group_id IN (SELECT group_id FROM account_links GROUP BY group_id HAVING COUNT(*)<2)').run();
}

// Kullaniciyi gruptan cikarir (pasife alma / admin yapma)
export function unlinkUser(db, userId) {
  db.prepare('DELETE FROM account_links WHERE user_id=?').run(userId);
  pruneLinks(db);
}

// Kullanicinin kendi grubundaki diger aktif uyeler
export function linkedUsers(db, userId) {
  return db.prepare(`SELECT u.* FROM account_links me JOIN account_links o ON o.group_id=me.group_id AND o.user_id<>me.user_id
    JOIN users u ON u.id=o.user_id WHERE me.user_id=? AND u.active=1
    AND NOT (u.kind='manager' AND (SELECT kind FROM users WHERE id=me.user_id)='manager') ORDER BY u.id`).all(userId); // yonetici hesaplar birbirine gecmez
}
