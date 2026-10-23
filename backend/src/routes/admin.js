import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { requireAdmin } from '../auth.js';
import { todayStr } from '../util.js';

export default async function routes(app) {
  const db = app.db;

  // Tutarli SQLite kopyasi (VACUUM INTO: yazma sirasinda bile butun bir dosya uretir)
  app.get('/api/admin/backup', async (req, reply) => {
    requireAdmin(req);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kutuphane-yedek-'));
    const file = path.join(dir, 'yedek.db');
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const buf = fs.readFileSync(file);
    fs.rmSync(dir, { recursive: true, force: true });
    reply.header('Content-Type', 'application/vnd.sqlite3');
    reply.header('Content-Disposition', `attachment; filename="kutuphane-yedek-${todayStr()}.db"`);
    return reply.send(buf);
  });
}
