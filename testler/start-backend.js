// Izole test backend'i: PORT=4100, DB_PATH=testler/data/test.db. Kullanim: node testler/start-backend.js [--fresh]
const { spawn } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const db = path.join(__dirname, 'data', 'test.db');
fs.mkdirSync(path.dirname(db), { recursive: true });
if (process.argv.includes('--fresh')) for (const s of ['', '-wal', '-shm']) fs.rmSync(db + s, { force: true });
const env = { ...process.env, PORT: '4100', DB_PATH: db, ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'test-admin-123', NODE_ENV: 'development' };
const p = spawn('node', ['src/server.js'], { cwd: path.join(root, 'backend'), env, stdio: 'inherit' }); // backend.txt'ye gore duzelt
p.on('exit', c => process.exit(c ?? 0));
