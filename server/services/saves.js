// ─────────────────────────────────────────────────────────────────────────────
// SAVES — SQLite CRUD over db.js. A `saves` row holds party/moods/gameState as JSON
// columns; the `transcript` table is append-only. Each round commits state + transcript
// in a single transaction (atomic). Moods are freely mutable any time.
// ─────────────────────────────────────────────────────────────────────────────
import db from './db.js'

const nowIso = () => new Date().toISOString()

const hydrate = (row) => row && {
  ...row,
  party: JSON.parse(row.party),
  moods: JSON.parse(row.moods),
  gameState: JSON.parse(row.gameState),
}

export function createSave({ sessionId, campaignId, userName, party, moods, gameState }) {
  const ts = nowIso()
  db.prepare(`
    INSERT INTO saves (sessionId, campaignId, status, userName, party, moods, gameState, round, schemaVersion, createdAt, updatedAt)
    VALUES (@sessionId, @campaignId, 'active', @userName, @party, @moods, @gameState, 0, 1, @ts, @ts)
  `).run({
    sessionId, campaignId, userName: userName || null,
    party: JSON.stringify(party), moods: JSON.stringify(moods), gameState: JSON.stringify(gameState), ts,
  })
  return loadSave(sessionId)
}

export function loadSave(sessionId) {
  return hydrate(db.prepare('SELECT * FROM saves WHERE sessionId = ?').get(sessionId))
}

export function listSaves() {
  return db.prepare(
    'SELECT sessionId, campaignId, status, userName, round, createdAt, updatedAt FROM saves ORDER BY updatedAt DESC'
  ).all()
}

export function updateMoods(sessionId, moods) {
  const info = db.prepare('UPDATE saves SET moods = @m, updatedAt = @ts WHERE sessionId = @id')
    .run({ m: JSON.stringify(moods), ts: nowIso(), id: sessionId })
  return info.changes > 0
}

// Persist a completed round: update the live state row + append its transcript entries,
// atomically in one transaction (replaces file rewrite).
export function commitRound(sessionId, { gameState, round, status, transcriptEntries = [] }) {
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE saves SET gameState = @gs, round = @round, status = COALESCE(@status, status), updatedAt = @ts
      WHERE sessionId = @id
    `).run({ gs: JSON.stringify(gameState), round, status: status || null, ts: nowIso(), id: sessionId })
    const ins = db.prepare('INSERT INTO transcript (sessionId, round, idx, type, payload) VALUES (?, ?, ?, ?, ?)')
    transcriptEntries.forEach((e, i) => ins.run(sessionId, round, i, e.type || 'entry', JSON.stringify(e)))
  })
  tx()
}

export function loadTranscript(sessionId) {
  return db.prepare('SELECT round, idx, type, payload FROM transcript WHERE sessionId = ? ORDER BY round, idx')
    .all(sessionId)
    .map(r => ({ round: r.round, idx: r.idx, ...JSON.parse(r.payload) }))
}

export function deleteSave(sessionId) {
  // foreign_keys = ON + ON DELETE CASCADE removes the transcript rows too
  return db.prepare('DELETE FROM saves WHERE sessionId = ?').run(sessionId).changes > 0
}

// ── Character portraits (cached per campaign+role) ────────────────────────────
export function getPortrait(key) {
  return db.prepare('SELECT url FROM portraits WHERE key = ?').get(key)?.url || null
}
export function setPortrait(key, url) {
  db.prepare('INSERT OR REPLACE INTO portraits (key, url, createdAt) VALUES (?, ?, ?)').run(key, url, nowIso())
}
