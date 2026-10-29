import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { norm } from './services/sources.js';

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
CREATE TABLE IF NOT EXISTS editions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  catalog_id INTEGER NOT NULL REFERENCES catalog(id) ON DELETE CASCADE,
  language TEXT,
  publisher TEXT,
  pub_norm TEXT NOT NULL DEFAULT '',
  pages INTEGER,
  year INTEGER,
  isbn TEXT,
  cover_url TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  language_guessed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_editions_catalog ON editions(catalog_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_editions_ext ON editions(source, external_id) WHERE external_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS edition_fetches (
  catalog_id INTEGER NOT NULL REFERENCES catalog(id) ON DELETE CASCADE,
  src TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (catalog_id, src)
);
CREATE TABLE IF NOT EXISTS series_seasons (
  catalog_id INTEGER NOT NULL REFERENCES catalog(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  episodes INTEGER NOT NULL,
  total_episodes INTEGER NOT NULL,
  runtime INTEGER,
  UNIQUE (catalog_id, season)
);
CREATE TABLE IF NOT EXISTS series_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  episodes INTEGER NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_series_progress_user ON series_progress(user_id, date);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_push_sub_user ON push_subscriptions(user_id);
CREATE TABLE IF NOT EXISTS account_links (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_links_group ON account_links(group_id);
CREATE TABLE IF NOT EXISTS push_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  own_events INTEGER NOT NULL DEFAULT 1,
  family_updates INTEGER NOT NULL DEFAULT 1,
  reminders INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS push_log (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, day)
);
CREATE TABLE IF NOT EXISTS book_ratings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_id INTEGER NOT NULL REFERENCES catalog(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, catalog_id, metric)
);
CREATE INDEX IF NOT EXISTS idx_book_ratings_cat ON book_ratings(catalog_id);
CREATE TABLE IF NOT EXISTS comment_reactions (
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);
CREATE TABLE IF NOT EXISTS comment_reaction_notified (
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (comment_id, user_id)
);
CREATE TABLE IF NOT EXISTS congrats (
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (sender_id, entry_id)
);
CREATE TABLE IF NOT EXISTS streak_days (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  PRIMARY KEY (user_id, date)
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

// Eski veritabanlarina sonradan eklenen kolonlar
const COLUMNS = [
  ['users', 'must_change', 'INTEGER NOT NULL DEFAULT 0'],
  ['entries', 'base_page', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'active', 'INTEGER NOT NULL DEFAULT 1'],
  ['catalog', 'listed', 'INTEGER NOT NULL DEFAULT 1'],
  ['catalog', 'norm', "TEXT NOT NULL DEFAULT ''"],
  ['catalog', 'wrong', 'INTEGER NOT NULL DEFAULT 0'], // admin 'yanlis kitap' isareti: aramada/ekleme cakismasinda yok sayilir
  ['reading_logs', 'estimated', 'INTEGER NOT NULL DEFAULT 0'],
  // v5 (YENI_ISTEKLER)
  ['users', 'name_changed', 'INTEGER NOT NULL DEFAULT 0'],
  ['entries', 'edition_id', 'INTEGER REFERENCES editions(id) ON DELETE SET NULL'],
  ['catalog', 'runtime', 'INTEGER'],
  ['catalog', 'show_status', 'TEXT'],
  ['catalog', 'seasons_fetched_at', 'INTEGER'],
  ['catalog', 'languages', 'TEXT'],
  ['catalog', 'edition_count', 'INTEGER'],
  ['catalog', 'runtime_checked', 'INTEGER'],
  // v5.1
  ['entries', 'finished_pages', 'INTEGER'], // bitti kitapta bitis aninda sabitlenen okunan toplam (baski degisince gecmis istatistik oynamaz)
  ['entries', 'finished_episodes', 'INTEGER'], // bitti dizide bitis aninda sabitlenen bolum / dakika
  ['entries', 'finished_minutes', 'INTEGER'],
  // v9
  ['catalog', 'genre', 'TEXT'], // kitap turu: 'kurgu' | 'felsefe' (puanlama metrikleri bu ture gore)
  ['reading_logs', 'no_streak', 'INTEGER NOT NULL DEFAULT 0'], // gecmise dolgu satiri: ortalamaya girer, seri/rekora girmez
  ['reading_logs', 'note', 'TEXT'], // otomatik 0 gibi satirlara dusulen not
  ['users', 'tz', 'TEXT'], // kisinin IANA saat dilimi (bos = sunucu saat dilimi)
];
function migrate(db) {
  for (const [table, col, def] of COLUMNS) {
    const have = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
    if (!have) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
  // Film sureleri bir kez sifirlanir ve Wikidata'dan yeniden hesaplanir (hatali/supheli degerler duzelsin; arka planda lazy-fill)
  if (!db.prepare("SELECT 1 FROM meta WHERE key='runtime_v2'").get()) {
    db.exec("UPDATE catalog SET runtime=NULL, runtime_checked=NULL WHERE type='movie' AND source='wikipedia'");
    db.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES ('runtime_v2', ?)").run(new Date().toISOString());
  }
  // Kiril basliklar da aranabilsin diye arama alani (norm) bir kez yeniden hesaplanir
  if (!db.prepare("SELECT 1 FROM meta WHERE key='norm_v2'").get()) {
    const upd = db.prepare('UPDATE catalog SET norm=? WHERE id=?');
    for (const r of db.prepare('SELECT id,title,author_or_creator FROM catalog').all()) upd.run(norm(`${r.title} ${r.author_or_creator || ''}`), r.id);
    db.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES ('norm_v2', ?)").run(new Date().toISOString());
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
