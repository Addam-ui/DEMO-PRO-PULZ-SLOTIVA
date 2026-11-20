import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export const db = new DatabaseSync(path.join(config.dataDir, 'slotiva.db'));

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    email            TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    name             TEXT    NOT NULL,
    slug             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash    TEXT,
    google_sub       TEXT    UNIQUE,
    session_version  INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT    NOT NULL DEFAULT ${NOW},
    updated_at       TEXT    NOT NULL DEFAULT ${NOW},
    last_login_at    TEXT
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data     TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS google_connections (
    user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    google_email       TEXT    NOT NULL DEFAULT '',
    refresh_token      TEXT    NOT NULL,
    scope              TEXT    NOT NULL DEFAULT '',
    calendar_id        TEXT    NOT NULL DEFAULT 'primary',
    calendar_name      TEXT    NOT NULL DEFAULT '',
    busy_calendar_ids  TEXT    NOT NULL DEFAULT '[]',
    status             TEXT    NOT NULL DEFAULT 'ok',
    last_error         TEXT,
    last_sync          TEXT,
    connected_at       TEXT    NOT NULL DEFAULT ${NOW},
    updated_at         TEXT    NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash  TEXT    PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TEXT    NOT NULL,
    used_at     TEXT
  );

  CREATE TABLE IF NOT EXISTS services (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT    NOT NULL,
    description   TEXT    NOT NULL DEFAULT '',
    duration_min  INTEGER NOT NULL,
    price         INTEGER NOT NULL DEFAULT 0,
    color_id      TEXT    NOT NULL DEFAULT '9',
    active        INTEGER NOT NULL DEFAULT 1,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code            TEXT    NOT NULL UNIQUE,
    cancel_token    TEXT    NOT NULL UNIQUE,
    service_id      INTEGER REFERENCES services(id) ON DELETE SET NULL,
    service_name    TEXT    NOT NULL,
    color_id        TEXT    NOT NULL DEFAULT '9',
    price           INTEGER NOT NULL DEFAULT 0,
    start_utc       TEXT    NOT NULL,
    end_utc         TEXT    NOT NULL,
    customer_name   TEXT    NOT NULL,
    customer_email  TEXT    NOT NULL DEFAULT '',
    customer_phone  TEXT    NOT NULL DEFAULT '',
    note            TEXT    NOT NULL DEFAULT '',
    internal_note   TEXT    NOT NULL DEFAULT '',
    status          TEXT    NOT NULL DEFAULT 'confirmed',
    source          TEXT    NOT NULL DEFAULT 'web',
    google_event_id TEXT,
    google_pending  TEXT,
    google_error    TEXT,
    cancelled_at    TEXT,
    cancelled_by    TEXT,
    created_at      TEXT    NOT NULL DEFAULT ${NOW},
    updated_at      TEXT    NOT NULL DEFAULT ${NOW}
  );

  CREATE INDEX IF NOT EXISTS idx_services_user   ON services(user_id, sort_order);
  CREATE INDEX IF NOT EXISTS idx_bookings_user   ON bookings(user_id, start_utc);
  CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(user_id, status, start_utc);
  CREATE INDEX IF NOT EXISTS idx_bookings_event  ON bookings(google_event_id);
  CREATE INDEX IF NOT EXISTS idx_resets_user     ON password_resets(user_id);

  CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

/** Spustí funkci v transakci. Node je jednovláknový, takže synchronní blok je atomický. */
export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Aktuální čas ve formátu, ve kterém ukládáme časy (ISO 8601 UTC, lexikograficky řaditelné). */
export function nowIso() {
  return new Date().toISOString();
}

/* ───────────── migrace ─────────────
   Databáze vznikla dřív, než přibyly některé sloupce. Přidáme je, když chybí. */

const columns = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));

function addColumn(table, column, definition) {
  if (!columns(table).has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumn('users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'blocked_at', 'TEXT');
addColumn('users', 'note', "TEXT NOT NULL DEFAULT ''");
