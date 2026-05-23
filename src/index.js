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

let BOT_JID = null

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

  const chatJid = msg.key.remoteJid
  const inGroup = isGroup(chatJid)

  if (inGroup && !botMentioned(msg)) return

  const rawText = extractText(msg)
  if (!rawText?.trim()) return

  const text   = inGroup ? stripMention(rawText) : rawText
  if (!text) return

  const userId = inGroup ? (msg.key.participant ?? chatJid) : chatJid
  const label  = userId.split('@')[0]
  const prefix = inGroup ? '[GRUPO] ' : ''

  console.log(`📩 ${prefix}[${label}]: ${text}`)

  await sock.sendPresenceUpdate('composing', chatJid).catch(() => null)

  try {
    const reply = isCommand(text)
      ? await runCommand(text, userId)
      : await handleMessage(userId, text)

    // Sempre envia como quoted reply — garante roteamento correto mesmo para @lid
    await sock.sendMessage(chatJid, { text: reply }, { quoted: msg })

    console.log(`📤 ${prefix}[${label}]: ${reply.substring(0, 120)}${reply.length > 120 ? '…' : ''}`)

  } catch (err) {
    console.error(`❌ Erro [${label}]:`, err.message)
    const errMsg = `⚠️ ${err.message || 'Ocorreu um erro interno. Tente novamente.'}`
    await sock.sendMessage(chatJid, { text: errMsg }, { quoted: msg }).catch(() => null)
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
