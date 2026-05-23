'use strict'

const Database = require('better-sqlite3')
const path     = require('path')

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(process.cwd(), 'sessions.db')

let _db = null

function db() {
  if (_db) return _db

  _db = new Database(DB_PATH)
  _db.pragma('journal_mode = WAL')
  _db.pragma('synchronous  = NORMAL')
  _db.pragma('foreign_keys = ON')

  _db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      user_id    TEXT    PRIMARY KEY,
      history    TEXT    NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS metadata (
      user_id    TEXT    PRIMARY KEY,
      first_seen INTEGER NOT NULL DEFAULT 0,
      msg_count  INTEGER NOT NULL DEFAULT 0
    );
  `)

  console.log(`💾 Banco de dados: ${DB_PATH}`)
  return _db
}

function getHistory(userId) {
  const row = db()
    .prepare('SELECT history FROM sessions WHERE user_id = ?')
    .get(userId)

  if (!row) return []
  try   { return JSON.parse(row.history) }
  catch { return [] }
}

function saveHistory(userId, history) {
  const now = Date.now()

  db()
    .prepare(`
      INSERT INTO sessions (user_id, history, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        history    = excluded.history,
        updated_at = excluded.updated_at
    `)
    .run(userId, JSON.stringify(history), now)

  db()
    .prepare(`
      INSERT INTO metadata (user_id, first_seen, msg_count)
      VALUES (?, ?, 1)
      ON CONFLICT(user_id) DO UPDATE SET
        msg_count = msg_count + 1
    `)
    .run(userId, now)
}

function clearHistory(userId) {
  db()
    .prepare('UPDATE sessions SET history = ?, updated_at = ? WHERE user_id = ?')
    .run('[]', Date.now(), userId)
}

function getStats() {
  const { count } = db().prepare('SELECT COUNT(*) as count FROM sessions').get()
  const { total } = db().prepare('SELECT SUM(msg_count) as total FROM metadata').get()
  return {
    totalUsers:    count ?? 0,
    totalMessages: total ?? 0
  }
}

module.exports = { getHistory, saveHistory, clearHistory, getStats }
