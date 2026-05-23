'use strict'

const Anthropic = require('@anthropic-ai/sdk')
const { getHistory, saveHistory } = require('./sessionStore')
const { CLICKUP_TOOLS, executeTool } = require('./clickupTools')

const MODEL          = 'claude-sonnet-4-5'
const MAX_TOKENS     = 2048
const MAX_HISTORY    = 30
const MAX_TOOL_LOOPS = 15

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `Você é um assistente inteligente disponível via WhatsApp, com acesso ao ClickUp para gerenciar projetos e tarefas.

## Personalidade
- Responda sempre em português brasileiro, de forma natural e amigável
- Seja direto e objetivo — mensagens de WhatsApp devem ser concisas
- Use formatação simples: evite markdown pesado, prefira texto limpo e listas com "•"
- Nunca invente informações. Se não souber, diga claramente
- Demonstre proatividade: quando fizer algo no ClickUp, confirme o que foi feito

## Assistente Geral
Você pode ajudar com qualquer coisa:
- Perguntas gerais, dúvidas e explicações
- Redação, revisão, tradução e análise de textos
- Programação, depuração de código e arquitetura
- Cálculos, planilhas e análise de dados
- Brainstorming, planejamento e organização

## Integração com ClickUp
Quando o usuário pedir para gerenciar tarefas, projetos ou equipes, USE as ferramentas disponíveis. Regras:

1. Se não souber o ID de uma lista, use listar_listas_workspace primeiro
2. Ao listar tarefas, resuma de forma legível — nunca cole IDs brutos na resposta
3. Ao criar ou atualizar uma tarefa, confirme com: nome, status e link da tarefa
4. Ao buscar, prefira buscar_tarefa quando o usuário mencionar um nome específico
5. Datas devem ser no formato YYYY-MM-DD internamente, mas apresentadas em pt-BR ao usuário

## Regras de formato
- Listas de tarefas: use bullet "•" com nome, status e prazo
- Confirmações de criação: inclua sempre o link da tarefa
- Erros do ClickUp: explique o que aconteceu de forma simples, sem jargão técnico
- Respostas longas: divida em seções curtas com emojis para facilitar a leitura no mobile`

async function handleMessage(userId, userText) {
  const history = getHistory(userId)

  const messages = [
    ...history,
    { role: 'user', content: userText }
  ]

  let finalText = ''
  let loops = 0

  while (loops < MAX_TOOL_LOOPS) {
    loops++

    let response
    try {
      response = await client.messages.create({
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        system:     SYSTEM_PROMPT,
        tools:      CLICKUP_TOOLS,
        messages
      })
    } catch (err) {
      throwReadableError(err)
    }

    const { stop_reason, content } = response

    if (stop_reason === 'end_turn') {
      finalText = textFrom(content)
      break
    }

    if (stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content })

      const toolResults = []

      for (const block of content) {
        if (block.type !== 'tool_use') continue

        console.log(`🔧 [Claude → ClickUp] ${block.name}`, JSON.stringify(block.input))

        const result    = await executeTool(block.name, block.input)
        const resultStr = JSON.stringify(result, null, 2)

        console.log(`✅ [ClickUp → Claude] ${block.name}: ${resultStr.substring(0, 200)}`)

        toolResults.push({
          type:        'tool_result',
          tool_use_id: block.id,
          content:     resultStr
        })
      }

      messages.push({ role: 'user', content: toolResults })
      continue
    }

    finalText = textFrom(content) || '⚠️ Resposta incompleta. Tente reformular sua mensagem.'
    break
  }

  if (!finalText) {
    finalText = '⚠️ Não consegui gerar uma resposta. Tente novamente.'
  }

  const newHistory = [
    ...history,
    { role: 'user',      content: userText  },
    { role: 'assistant', content: finalText }
  ].slice(-MAX_HISTORY)

  saveHistory(userId, newHistory)

  return finalText
}

function textFrom(content) {
  return (content ?? [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim()
}

function throwReadableError(err) {
  const status = err.status ?? err.statusCode
  if (status === 401) throw new Error('Chave da API Anthropic inválida ou não configurada.')
  if (status === 429) throw new Error('Muitas requisições. Aguarde um momento e tente novamente.')
  if (status === 529) throw new Error('API sobrecarregada. Tente novamente em instantes.')
  if (status >= 500)  throw new Error('Erro interno na API Anthropic. Tente novamente.')
  throw err
}

module.exports = { handleMessage }
