'use strict'

/**
 * commands.js — Comandos especiais do bot
 *
 * Processados ANTES de ir ao Claude, por isso:
 *  - Zero latência (sem chamada de API)
 *  - Zero custo de tokens
 *  - Funcionam mesmo se a API estiver fora
 */

const { clearHistory, getStats } = require('./sessionStore')

// ─── Registro de comandos ─────────────────────────────────────────────────────
// Cada entrada: prefixo (lowercase) → função handler(userId) → string
const REGISTRY = {
  '/ajuda':   cmdAjuda,
  '/help':    cmdAjuda,
  '/limpar':  cmdLimpar,
  '/clear':   cmdLimpar,
  '/status':  cmdStatus,
  '/ping':    cmdPing,
}

// ─── Detecção ─────────────────────────────────────────────────────────────────
/**
 * Retorna true se o texto for um comando registrado.
 */
function isCommand(text) {
  if (!text?.trim()) return false
  const word = text.trim().toLowerCase().split(/\s+/)[0]
  return word in REGISTRY
}

/**
 * Executa o comando correspondente ao texto e retorna a resposta.
 */
async function runCommand(text, userId) {
  const word    = text.trim().toLowerCase().split(/\s+/)[0]
  const handler = REGISTRY[word]
  if (!handler) {
    return '❓ Comando desconhecido. Digite */ajuda* para ver os comandos disponíveis.'
  }
  return handler(userId)
}

// ─── Handlers ─────────────────────────────────────────────────────────────────
function cmdAjuda() {
  return [
    '🤖 *Claude Agent — Ajuda*',
    '',
    '*Comandos disponíveis:*',
    '/ajuda  → Exibe esta mensagem',
    '/limpar → Apaga o histórico da conversa',
    '/status → Mostra informações do bot',
    '/ping   → Testa se o bot está respondendo',
    '',
    '*Integração com ClickUp:*',
    'Basta pedir em português natural, por exemplo:',
    '• "liste as tarefas do projeto X"',
    '• "crie a tarefa Y na lista Z com prazo sexta"',
    '• "mude o status da tarefa X para concluída"',
    '• "quais tarefas estão atrasadas?"',
    '• "comente na tarefa X: revisado e aprovado"',
    '• "mostre a estrutura do meu workspace"',
    '',
    '*Assistente geral:*',
    '• Responde perguntas e dúvidas',
    '• Redação, revisão e tradução de textos',
    '• Análise de dados e planilhas',
    '• Programação e resolução de problemas',
    '• Qualquer coisa que você precisar!',
    '',
    '_Em grupos: mencione @bot para ativar_',
  ].join('\n')
}

function cmdLimpar(userId) {
  clearHistory(userId)
  return '🗑️ Histórico apagado! A próxima mensagem começa uma conversa nova.'
}

function cmdStatus() {
  const stats  = getStats()
  const up     = process.uptime()
  const horas  = Math.floor(up / 3600)
  const min    = Math.floor((up % 3600) / 60)
  const mem    = Math.round(process.memoryUsage().rss / 1024 / 1024)

  return [
    '📊 *Status do Bot*',
    '',
    `✅ Online há ${horas}h ${min}min`,
    `👥 Usuários com histórico: ${stats.totalUsers}`,
    `💬 Total de mensagens: ${stats.totalMessages}`,
    `💾 Memória: ${mem} MB`,
    `🤖 Modelo: Claude Sonnet`,
    `📱 WhatsApp: Conectado`,
  ].join('\n')
}

function cmdPing() {
  return '🏓 Pong! Bot online e respondendo.'
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = { isCommand, runCommand }
