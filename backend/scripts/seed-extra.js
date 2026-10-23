// Elle kurator listesi (aile arayip bulamadigi kitaplar). Uygulama acilisinda zaten otomatik calisir;
// elle calistirmak icin:  npm run seed:extra      (tekrar calistirmak guvenlidir)
import { openDb } from '../src/db.js';
import { seedExtraDb, seedExtraCovers } from '../src/services/seedExtra.js';

const db = openDb();
const r = seedExtraDb(db);
console.log(`seed-extra: ${r.added} yeni katalog kaydi, ${r.touched} kayit islendi (daha once islenenler atlanir).`);
await seedExtraCovers(db, console);
console.log('seed-extra: bitti.');
db.close();
