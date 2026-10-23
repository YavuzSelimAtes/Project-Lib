import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(__dirname, '..', 'data');
export const DB_PATH = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(DATA_DIR, 'kutuphane.db');
export const COVERS_DIR = process.env.COVERS_DIR ? path.resolve(process.env.COVERS_DIR) : path.join(path.dirname(DB_PATH), 'covers');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  avatar TEXT NOT NULL DEFAULT '🙂',
  color TEXT NOT NULL DEFAULT '#6366f1',
  must_change INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('book','movie','series')),
  title TEXT NOT NULL,
  author_or_creator TEXT,
  year INTEGER,
  pages INTEGER,
  description TEXT,
  cover_url TEXT,
  external_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  seasons INTEGER,
  norm TEXT NOT NULL DEFAULT '',
  listed INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_ext ON catalog(source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_catalog_type ON catalog(type);
CREATE TABLE IF NOT EXISTS search_cache (
  key TEXT PRIMARY KEY,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('book','movie','series')),
  title TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'acik' CHECK (status IN ('acik','inceleniyor','tamamlandi','reddedildi')),
  admin_note TEXT,
  resolved_catalog_id INTEGER REFERENCES catalog(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_id INTEGER NOT NULL REFERENCES catalog(id),
  type TEXT NOT NULL CHECK (type IN ('book','movie','series')),
  status TEXT NOT NULL CHECK (status IN ('devam','bitti','birakildi','planlandi')),
  start_date TEXT,
  end_date TEXT,
  total_pages INTEGER,
  current_page INTEGER NOT NULL DEFAULT 0,
  base_page INTEGER NOT NULL DEFAULT 0,
  season INTEGER,
  episode INTEGER,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_user ON entries(user_id);
CREATE INDEX IF NOT EXISTS idx_entries_catalog ON entries(catalog_id);
CREATE TABLE IF NOT EXISTS reading_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  page_from INTEGER NOT NULL,
  page_to INTEGER NOT NULL,
  pages_read INTEGER NOT NULL,
  estimated INTEGER NOT NULL DEFAULT 0,
  UNIQUE (entry_id, date)
);
CREATE INDEX IF NOT EXISTS idx_logs_user_date ON reading_logs(user_id, date);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  asker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT,
  answered_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link_type TEXT,
  link_id INTEGER,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
`;

// Eski veritabanlarina sonradan eklenen kolonlar
const COLUMNS = [
  ['users', 'must_change', 'INTEGER NOT NULL DEFAULT 0'],
  ['entries', 'base_page', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'active', 'INTEGER NOT NULL DEFAULT 1'],
  ['catalog', 'listed', 'INTEGER NOT NULL DEFAULT 1'],
  ['catalog', 'norm', "TEXT NOT NULL DEFAULT ''"],
  ['reading_logs', 'estimated', 'INTEGER NOT NULL DEFAULT 0'],
];
function migrate(db) {
  for (const [table, col, def] of COLUMNS) {
    const have = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
    if (!have) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
}

export function openDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.mkdirSync(COVERS_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export const tx = (db, fn) => {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
};
