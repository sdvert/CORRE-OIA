'use strict'

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys')
const pino   = require('pino')
const qrcode = require('qrcode-terminal')
const { handleMessage }         = require('./claudeAgent')
const { isCommand, runCommand } = require('./commands')

const AUTH_FOLDER = process.env.AUTH_FOLDER || './auth_info'
const MAX_RETRIES = 12
const BASE_DELAY  = 3000
const MAX_DELAY   = 60000

const sleep   = ms => new Promise(r => setTimeout(r, ms))
const backoff = n  => Math.min(BASE_DELAY * Math.pow(1.6, n - 1), MAX_DELAY)
const isGroup = jid => jid?.endsWith('@g.us')
const isLid   = jid => jid?.endsWith('@lid')

let BOT_JID  = null
const lidMap = {}

function registerContact(c) {
  if (c?.lid && c?.id?.endsWith('@s.whatsapp.net')) {
    lidMap[c.lid] = c.id
  }
}

function resolveLid(jid) {
  if (!isLid(jid)) return jid
  return lidMap[jid] ?? jid   // usa @lid direto se não tiver mapa
}

function extractText(msg) {
  const m = msg.message
  if (!m) return null
  return (
    m.conversation                       ||
    m.extendedTextMessage?.text          ||
    m.imageMessage?.caption              ||
    m.videoMessage?.caption              ||
    null
  )
}

function botMentioned(msg) {
  if (!BOT_JID) return false
  const botNum = BOT_JID.split(':')[0].split('@')[0]
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ?? []
  if (mentioned.some(j => j.includes(botNum))) return true
  const text = extractText(msg)
  if (text?.includes('@' + botNum)) return true
  return false
}

function stripMention(text) {
  if (!BOT_JID || !text) return text
  const botNum = BOT_JID.split(':')[0].split('@')[0]
  return text.replace(new RegExp(`@${botNum}\\s*`, 'g'), '').trim()
}

async function processMessage(sock, msg) {
  if (msg.key.fromMe) return
  if (!msg.message)   return

  const rawJid  = msg.key.remoteJid
  const chatJid = resolveLid(rawJid)
  const inGroup = isGroup(chatJid)

  // ── DEBUG ──────────────────────────────────────────────────
  console.log(`🔍 remoteJid bruto : ${rawJid}`)
  console.log(`🔍 chatJid resolvido: ${chatJid}`)
  console.log(`🔍 lidMap entries  : ${Object.keys(lidMap).length}`)
  // ───────────────────────────────────────────────────────────

  if (inGroup && !botMentioned(msg)) return

  const rawText = extractText(msg)
  if (!rawText?.trim()) return

  const text = inGroup ? stripMention(rawText) : rawText
  if (!text) return

  const rawParticipant = msg.key.participant ?? chatJid
  const userId = inGroup ? resolveLid(rawParticipant) : chatJid
  const label  = userId.split('@')[0]
  const prefix = inGroup ? '[GRUPO] ' : ''

  console.log(`📩 ${prefix}[${label}]: ${text}`)

  await sock.sendPresenceUpdate('composing', chatJid).catch(() => null)

  try {
    const reply = isCommand(text)
      ? await runCommand(text, userId)
      : await handleMessage(userId, text)

    console.log(`🚀 Enviando para: ${chatJid}`)

    if (inGroup) {
      await sock.sendMessage(chatJid, { text: reply }, { quoted: msg })
    } else {
      await sock.sendMessage(chatJid, { text: reply })
    }

    console.log(`📤 ${prefix}[${label}]: ${reply.substring(0, 120)}${reply.length > 120 ? '…' : ''}`)

  } catch (err) {
    console.error(`❌ Erro ao enviar [${label}]:`, err.message)
    console.error(`❌ Stack:`, err.stack?.split('\n')[1] ?? '')
    const errMsg = `⚠️ ${err.message || 'Ocorreu um erro interno. Tente novamente.'}`
    if (inGroup) {
      await sock.sendMessage(chatJid, { text: errMsg }, { quoted: msg }).catch(() => null)
    } else {
      await sock.sendMessage(chatJid, { text: errMsg }).catch(() => null)
    }
  } finally {
    await sock.sendPresenceUpdate('paused', chatJid).catch(() => null)
  }
}

async function createConnection() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER)
  const { version }          = await fetchLatestBaileysVersion()

  console.log(`\n📡 Baileys v${version.join('.')} | Node ${process.version}`)

  const sock = makeWASocket({
    version,
    auth:                  state,
    logger:                pino({ level: 'silent' }),
    printQRInTerminal:     false,
    browser:               ['Claude Agent', 'Chrome', '1.0.0'],
    connectTimeoutMs:      60000,
    defaultQueryTimeoutMs: 60000,
    retryRequestDelayMs:   2000,
    maxMsgRetryCount:      3,
    getMessage:            async () => ({ conversation: '' })
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('contacts.upsert', contacts => {
    for (const c of contacts) registerContact(c)
    console.log(`📒 contacts.upsert: ${contacts.length} contatos | lidMap: ${Object.keys(lidMap).length}`)
  })
  sock.ev.on('contacts.update', updates => {
    for (const c of updates) registerContact(c)
    console.log(`📒 contacts.update: ${updates.length} | lidMap: ${Object.keys(lidMap).length}`)
  })
  sock.ev.on('messaging-history.set', ({ contacts = [] }) => {
    for (const c of contacts) registerContact(c)
    console.log(`📒 messaging-history.set: ${contacts.length} contatos | lidMap: ${Object.keys(lidMap).length}`)
  })

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return
    for (const msg of messages) {
      processMessage(sock, msg).catch(err =>
        console.error('⚠️  Erro não capturado:', err)
      )
    }
  })

  return new Promise(resolve => {
    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {

      if (qr) {
        console.log('\n📱 Escaneie o QR Code no WhatsApp:')
        console.log('   (Dispositivos vinculados → Vincular dispositivo)\n')
        qrcode.generate(qr, { small: true })
      }

      if (connection === 'open') {
        BOT_JID = sock.user?.id ?? null
        console.log(`\n✅ WhatsApp conectado!`)
        if (BOT_JID) console.log(`   Bot: @${BOT_JID.split(':')[0].split('@')[0]}`)
        console.log('📨 Aguardando mensagens…\n')
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode
        console.log(`❌ Conexão encerrada. Código: ${code ?? 'desconhecido'}`)
        resolve(code === DisconnectReason.loggedOut ? 'logged_out' : 'reconnect')
      }
    })
  })
}

async function main() {
  console.log('═══════════════════════════════════════')
  console.log('  WhatsApp + Claude Agent  🤖')
  console.log('═══════════════════════════════════════')
  console.log(`  Auth: ${AUTH_FOLDER}`)
  console.log(`  PID:  ${process.pid}`)
  console.log('═══════════════════════════════════════\n')

  let attempt = 0

  while (true) {
    try {
      const result = await createConnection()

      if (result === 'logged_out') {
        console.log('\n🚪 Sessão encerrada pelo usuário.')
        console.log('   Delete a pasta auth_info e reinicie para reconectar.')
        process.exit(0)
      }

      attempt++
      if (attempt > MAX_RETRIES) {
        console.error(`\n⛔ ${MAX_RETRIES} reconexões falharam. Encerrando.`)
        process.exit(1)
      }

      const ms = backoff(attempt)
      console.log(`🔄 Reconectando em ${Math.round(ms / 1000)}s… (${attempt}/${MAX_RETRIES})`)
      await sleep(ms)

    } catch (err) {
      attempt++
      console.error('\n💥 Erro fatal:', err.message)
      if (attempt > MAX_RETRIES) process.exit(1)
      await sleep(backoff(attempt))
    }
  }
}

const shutdown = sig => { console.log(`\n👋 ${sig}. Encerrando…`); process.exit(0) }
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))
process.on('unhandledRejection', reason => console.error('⚠️  Promise não tratada:', reason))

main()
