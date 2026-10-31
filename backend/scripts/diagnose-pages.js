// Salt okunur teshis: bir kullanicinin kitaplarinda 'sayfa no' ile 'toplam okunan' neden farkli?
// Kullanim: node --disable-warning=ExperimentalWarning scripts/diagnose-pages.js <kullanici_adi> [DB_YOLU]
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const preReport = process.argv[2] === '--pre-report'; // tum kullanicilar: pre_pages migrate sonucu + belirsiz kayitlar
const username = preReport ? null : process.argv[2];
const dbPath = (preReport ? process.argv[3] : process.argv[3]) || process.env.DB_PATH || path.join(here, '..', 'data', 'kutuphane.db');
if (preReport) {
  const d = new DatabaseSync(dbPath, { readOnly: true });
  const sum = d.prepare("SELECT COUNT(*) n, COALESCE(SUM(pre_pages),0) p FROM entries WHERE pre_pages>0").get();
  const amb = d.prepare(`SELECT u.username, c.title, e.status, e.current_page, e.base_page, e.created_at,
      (SELECT COALESCE(SUM(pages_read),0) FROM reading_logs r WHERE r.entry_id=e.id) AS log_sum
    FROM entries e JOIN users u ON u.id=e.user_id JOIN catalog c ON c.id=e.catalog_id
    WHERE e.type='book' AND e.base_page>0 AND e.pre_pages=0 AND e.status<>'planlandi' ORDER BY e.id`).all();
  console.log(`pre_pages dolu kayit: ${sum.n} (toplam ${sum.p} sayfa)`);
  console.log(`BELIRSIZ (base_page>0, pre_pages=0; duzeltme mi ekleme mi ayirt edilemez): ${amb.length} kayit`);
  for (const r of amb.slice(0, 3)) console.log(`  - @${r.username} "${r.title}" [${r.status}] current=${r.current_page} base=${r.base_page} log_sum=${r.log_sum} olusturma=${r.created_at}`);
  process.exit(0);
}
if (!username) {
  console.error('Kullanim: node scripts/diagnose-pages.js <kullanici_adi> [DB_YOLU]');
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const u = db.prepare('SELECT id, username, display_name FROM users WHERE username=?').get(username);
if (!u) {
  console.error(`Kullanici bulunamadi: ${username}`);
  process.exit(1);
}

const rows = db
  .prepare(
    `SELECT e.id, c.title, e.status, e.current_page, e.base_page, e.total_pages,
            (SELECT COALESCE(SUM(pages_read),0) FROM reading_logs r WHERE r.entry_id=e.id) AS log_sum
     FROM entries e JOIN catalog c ON c.id=e.catalog_id
     WHERE e.user_id=? AND e.type='book' ORDER BY e.id`,
  )
  .all(u.id);

console.log(`Kullanici: ${u.display_name} (@${u.username}, id ${u.id})`);
let sumLogs = 0;
for (const r of rows) {
  const read = (r.status === 'bitti' ? r.total_pages ?? r.current_page : r.current_page) - (r.base_page || 0);
  sumLogs += r.log_sum;
  const note = r.base_page > 0 ? `  <- ${r.base_page}. sayfadan baslandi/duzeltildi, ilk ${r.base_page} sayfa 'okunan'a SAYILMAZ` : '';
  console.log(`- ${r.title} [${r.status}] sayfa no ${r.current_page}/${r.total_pages ?? '?'}, baslangic ${r.base_page || 0}, kayitlardan okunan ${r.log_sum}, hesaplanan ${read}${note}`);
}
console.log(`Gunluk kayitlarin toplami: ${sumLogs} sayfa`);
