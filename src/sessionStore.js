const Database = require('better-sqlite3')
const path = require('path')

const DB_PATH = process.env.DB_PATH || path.resolve('/app/data', 'sessions.db')

let db

function getDb() {
  if (!db) {
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')

    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        user_id   TEXT    PRIMARY KEY,
        history   TEXT    NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS metadata (
        user_id     TEXT PRIMARY KEY,
        first_seen  INTEGER,
        msg_count   INTEGER DEFAULT 0
      );
    `)

    console.log(`📦 Banco de dados iniciado em: ${DB_PATH}`)
  }
  return db
}

/**
 * Retorna o histórico de conversa de um usuário.
 * @param {string} userId - JID do WhatsApp (ex: 5511999999999@s.whatsapp.net)
 * @returns {Array} Array de mensagens { role, content }
 */
function getHistory(userId) {
  const database = getDb()
  const row = database
    .prepare('SELECT history FROM sessions WHERE user_id = ?')
    .get(userId)

  if (!row) return []

  try {
    return JSON.parse(row.history)
  } catch {
    return []
  }
}

/**
 * Salva o histórico de conversa de um usuário.
 * @param {string} userId
 * @param {Array} history
 */
function saveHistory(userId, history) {
  const database = getDb()
  const now = Date.now()

  database
    .prepare(`
      INSERT INTO sessions (user_id, history, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        history    = excluded.history,
        updated_at = excluded.updated_at
    `)
    .run(userId, JSON.stringify(history), now)

  // Atualiza metadata
  database
    .prepare(`
      INSERT INTO metadata (user_id, first_seen, msg_count)
      VALUES (?, ?, 1)
      ON CONFLICT(user_id) DO UPDATE SET
        msg_count = msg_count + 1
    `)
    .run(userId, now)
}

/**
 * Apaga o histórico de conversa de um usuário.
 * @param {string} userId
 */
function clearHistory(userId) {
  const database = getDb()
  database
    .prepare('UPDATE sessions SET history = ?, updated_at = ? WHERE user_id = ?')
    .run('[]', Date.now(), userId)
}

/**
 * Retorna estatísticas básicas do banco.
 */
function getStats() {
  const database = getDb()
  const users = database.prepare('SELECT COUNT(*) as count FROM sessions').get()
  const msgs = database.prepare('SELECT SUM(msg_count) as total FROM metadata').get()
  return {
    totalUsers: users.count,
    totalMessages: msgs.total || 0
  }
}

module.exports = { getHistory, saveHistory, clearHistory, getStats }
