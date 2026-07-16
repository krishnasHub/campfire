import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data')
const DB_PATH = join(DATA_DIR, 'campfire.db')

mkdirSync(DATA_DIR, { recursive: true })

export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ── Ordered schema migrations, tracked via PRAGMA user_version ────────────────
// Each entry migrates from index i to i+1. Append new steps; never edit old ones.
const MIGRATIONS = [
  // v0 -> v1: saves + append-only transcript
  (d) => {
    d.exec(`
      CREATE TABLE saves (
        sessionId     TEXT PRIMARY KEY,
        campaignId    TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'active',
        userName      TEXT,
        party         TEXT NOT NULL,          -- JSON: {userRoleId, assignments{roleId:botId}, locked}
        moods         TEXT NOT NULL,          -- JSON: {roleId:{wit,warmth,...}} (mutable anytime)
        gameState     TEXT NOT NULL,          -- JSON blob
        round         INTEGER NOT NULL DEFAULT 0,
        schemaVersion INTEGER NOT NULL DEFAULT 1,
        createdAt     TEXT NOT NULL,
        updatedAt     TEXT NOT NULL
      );
      CREATE TABLE transcript (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId TEXT NOT NULL REFERENCES saves(sessionId) ON DELETE CASCADE,
        round     INTEGER NOT NULL,
        idx       INTEGER NOT NULL,
        type      TEXT NOT NULL,
        payload   TEXT NOT NULL              -- JSON
      );
      CREATE INDEX idx_transcript_session ON transcript(sessionId, round, idx);
    `)
  },
  // v1 -> v2: character portraits, cached per campaign+role (reused across sessions)
  (d) => {
    d.exec(`
      CREATE TABLE portraits (
        key       TEXT PRIMARY KEY,   -- "<campaignId>:<roleId>"
        url       TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
    `)
  },
]

function migrate() {
  const current = db.pragma('user_version', { simple: true })
  for (let v = current; v < MIGRATIONS.length; v++) {
    const run = db.transaction(() => {
      MIGRATIONS[v](db)
      db.pragma(`user_version = ${v + 1}`)
    })
    run()
    console.log(`[db] migrated schema ${v} -> ${v + 1}`)
  }
}

migrate()

export default db
