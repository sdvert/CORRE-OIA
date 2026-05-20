const Anthropic = require('@anthropic-ai/sdk')
const { getHistory, saveHistory } = require('./sessionStore')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `Você é um assistente inteligente disponível via WhatsApp.

Regras de comportamento:
- Responda sempre em português brasileiro, de forma clara e natural
- Seja direto e objetivo — mensagens de WhatsApp devem ser curtas quando possível
- Use formatação simples: evite markdown pesado, prefira texto limpo
- Você pode ajudar com: perguntas gerais, redação, análise de texto, cálculos, programação, tradução, e muito mais
- Se não souber algo, diga claramente
- Não invente informações ou fatos

Identidade:
- Você é um agente de IA baseado no Claude da Anthropic
- Não revele detalhes técnicos da sua implementação, apenas que é um assistente de IA`

// Máximo de tokens de resposta
const MAX_TOKENS = 1024

// Máximo de mensagens no histórico por usuário
const MAX_HISTORY = 20

async function handleMessage(userId, userText) {
  const history = await getHistory(userId)

  // Adiciona a mensagem do usuário ao histórico
  history.push({ role: 'user', content: userText })

  let assistantText = ''

  try {
    const response = await client.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: history
    })

    assistantText = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim()

    if (!assistantText) {
      assistantText = 'Não consegui gerar uma resposta. Tente reformular sua mensagem.'
    }

  } catch (err) {
    // Remove a mensagem do usuário do histórico em caso de erro de API
    history.pop()
    await saveHistory(userId, history)

    if (err.status === 401) throw new Error('API Key inválida ou não configurada.')
    if (err.status === 429) throw new Error('Limite de requisições atingido. Aguarde um momento.')
    if (err.status === 500) throw new Error('Erro interno da API Anthropic. Tente novamente.')
    throw err
  }

  // Adiciona resposta ao histórico e salva
  history.push({ role: 'assistant', content: assistantText })

  // Mantém apenas as últimas N mensagens para controlar o tamanho do contexto
  const trimmed = history.slice(-MAX_HISTORY)
  await saveHistory(userId, trimmed)

  return assistantText
}

// Limpa o histórico de um usuário (pode ser chamado via comando especial)
async function clearHistory(userId) {
  const { saveHistory } = require('./sessionStore')
  await saveHistory(userId, [])
}

module.exports = { handleMessage, clearHistory }
