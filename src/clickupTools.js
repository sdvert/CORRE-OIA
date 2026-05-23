'use strict'

const CLICKUP_API = 'https://api.clickup.com/api/v2'

function authHeaders() {
  return {
    'Authorization': process.env.CLICKUP_API_KEY,
    'Content-Type':  'application/json'
  }
}

async function api(method, path, body) {
  const res = await fetch(`${CLICKUP_API}${path}`, {
    method,
    headers: authHeaders(),
    body:    body ? JSON.stringify(body) : undefined
  })

  let data
  try   { data = await res.json() }
  catch { throw new Error(`ClickUp retornou resposta inválida (HTTP ${res.status})`) }

  if (!res.ok) throw new Error(data.err ?? data.error ?? `ClickUp API error ${res.status}`)

  return data
}

const CLICKUP_TOOLS = [
  {
    name: 'listar_listas_workspace',
    description: 'Retorna a estrutura completa do workspace ClickUp: spaces, folders e listas com seus IDs. Use SEMPRE que não souber o list_id de uma lista antes de criar ou listar tarefas.',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'listar_tarefas',
    description: 'Lista as tarefas de uma lista específica do ClickUp. Se não souber o list_id, chame listar_listas_workspace primeiro.',
    input_schema: {
      type: 'object',
      properties: {
        list_id:        { type: 'string',  description: 'ID numérico da lista do ClickUp' },
        status:         { type: 'string',  description: 'Filtrar por status exato (ex: "to do", "in progress", "done"). Omita para trazer todos.' },
        include_closed: { type: 'boolean', description: 'Se true, inclui tarefas concluídas. Padrão: false.' }
      },
      required: ['list_id']
    }
  },
  {
    name: 'buscar_tarefa',
    description: 'Busca tarefas por nome ou palavra-chave em todo o workspace. Use quando o usuário mencionar o nome de uma tarefa mas não souber o ID ou a lista.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto para buscar (nome da tarefa ou trecho do título)' }
      },
      required: ['query']
    }
  },
  {
    name: 'criar_tarefa',
    description: 'Cria uma nova tarefa em uma lista do ClickUp. Se não souber o list_id, chame listar_listas_workspace primeiro.',
    input_schema: {
      type: 'object',
      properties: {
        list_id:      { type: 'string',                      description: 'ID da lista onde a tarefa será criada' },
        name:         { type: 'string',                      description: 'Título da tarefa' },
        description:  { type: 'string',                      description: 'Descrição detalhada da tarefa (opcional)' },
        due_date:     { type: 'string',                      description: 'Data de vencimento no formato YYYY-MM-DD (opcional)' },
        priority:     { type: 'number',                      description: 'Prioridade: 1=urgente, 2=alta, 3=normal, 4=baixa (opcional)' },
        assignee_ids: { type: 'array', items: { type: 'number' }, description: 'IDs dos usuários responsáveis (opcional)' }
      },
      required: ['list_id', 'name']
    }
  },
  {
    name: 'atualizar_tarefa',
    description: 'Atualiza status, nome, descrição, prazo ou prioridade de uma tarefa existente. Use buscar_tarefa para encontrar o task_id se o usuário não souber.',
    input_schema: {
      type: 'object',
      properties: {
        task_id:     { type: 'string', description: 'ID da tarefa a atualizar' },
        status:      { type: 'string', description: 'Novo status (ex: "in progress", "done", "to do")' },
        name:        { type: 'string', description: 'Novo título (opcional)' },
        description: { type: 'string', description: 'Nova descrição (opcional)' },
        priority:    { type: 'number', description: 'Nova prioridade: 1=urgente, 2=alta, 3=normal, 4=baixa (opcional)' },
        due_date:    { type: 'string', description: 'Novo prazo no formato YYYY-MM-DD (opcional)' }
      },
      required: ['task_id']
    }
  },
  {
    name: 'comentar_tarefa',
    description: 'Adiciona um comentário de texto em uma tarefa do ClickUp.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'ID da tarefa' },
        comment: { type: 'string', description: 'Texto do comentário' }
      },
      required: ['task_id', 'comment']
    }
  },
  {
    name: 'buscar_tarefas_atrasadas',
    description: 'Lista tarefas com prazo vencido que ainda não foram concluídas, ordenadas pelas mais atrasadas. Útil para relatórios de atraso e follow-up.',
    input_schema: {
      type: 'object',
      properties: {
        list_id: { type: 'string', description: 'Limitar a uma lista específica (opcional). Se omitido, busca em todo o workspace.' }
      },
      required: []
    }
  }
]

async function listarListasWorkspace() {
  const teamId = requireTeamId()
  const { spaces = [] } = await api('GET', `/team/${teamId}/space?archived=false`)
  const result = []

  for (const space of spaces) {
    const entry = { space_id: space.id, space: space.name, listas_avulsas: [], folders: [] }

    const { lists: avulsas = [] } = await api('GET', `/space/${space.id}/list?archived=false`)
    entry.listas_avulsas = avulsas.map(l => ({ list_id: l.id, lista: l.name, tarefas: l.task_count ?? '?' }))

    const { folders = [] } = await api('GET', `/space/${space.id}/folder?archived=false`)
    for (const folder of folders) {
      entry.folders.push({
        folder_id: folder.id,
        folder:    folder.name,
        listas:    (folder.lists ?? []).map(l => ({ list_id: l.id, lista: l.name, tarefas: l.task_count ?? '?' }))
      })
    }

    result.push(entry)
  }

  return result
}

async function listarTarefas({ list_id, status, include_closed = false }) {
  const params = new URLSearchParams({ include_closed: String(include_closed) })
  if (status) params.append('statuses[]', status)
  const { tasks = [] } = await api('GET', `/list/${list_id}/task?${params}`)
  return tasks.map(formatTask)
}

async function buscarTarefa({ query }) {
  const teamId = requireTeamId()
  const params = new URLSearchParams({ query })
  const { tasks = [] } = await api('GET', `/team/${teamId}/task?${params}`)
  return tasks.map(formatTask)
}

async function criarTarefa({ list_id, name, description, due_date, priority = 3, assignee_ids }) {
  const body = { name, priority }
  if (description)          body.description = description
  if (due_date)             body.due_date    = new Date(due_date).getTime()
  if (assignee_ids?.length) body.assignees   = assignee_ids
  const data = await api('POST', `/list/${list_id}/task`, body)
  return formatTask(data)
}

async function atualizarTarefa({ task_id, status, name, description, priority, due_date }) {
  const body = {}
  if (status      !== undefined) body.status      = status
  if (name        !== undefined) body.name        = name
  if (description !== undefined) body.description = description
  if (priority    !== undefined) body.priority    = priority
  if (due_date    !== undefined) body.due_date    = new Date(due_date).getTime()
  const data = await api('PUT', `/task/${task_id}`, body)
  return formatTask(data)
}

async function comentarTarefa({ task_id, comment }) {
  await api('POST', `/task/${task_id}/comment`, { comment_text: comment })
  return { ok: true, task_id, mensagem: 'Comentário adicionado com sucesso.' }
}

async function buscarTarefasAtrasadas({ list_id } = {}) {
  const now    = Date.now()
  const params = new URLSearchParams({ include_closed: 'false', due_date_lt: String(now) })
  let tasks
  if (list_id) {
    ;({ tasks = [] } = await api('GET', `/list/${list_id}/task?${params}`))
  } else {
    const teamId = requireTeamId()
    ;({ tasks = [] } = await api('GET', `/team/${teamId}/task?${params}`))
  }
  return tasks
    .filter(t => t.due_date)
    .map(t => {
      const prazoMs    = parseInt(t.due_date, 10)
      const diasAtraso = Math.floor((now - prazoMs) / 86400000)
      return { ...formatTask(t), dias_atraso: diasAtraso }
    })
    .sort((a, b) => b.dias_atraso - a.dias_atraso)
}

function requireTeamId() {
  const id = process.env.CLICKUP_TEAM_ID
  if (!id) throw new Error('Variável CLICKUP_TEAM_ID não configurada no ambiente.')
  return id
}

const PRIORITY_LABEL = { 1: 'urgente', 2: 'alta', 3: 'normal', 4: 'baixa' }

function formatTask(t) {
  return {
    id:           t.id,
    nome:         t.name,
    status:       t.status?.status ?? null,
    lista:        t.list?.name     ?? null,
    responsaveis: (t.assignees ?? []).map(a => a.username),
    prazo:        t.due_date ? new Date(parseInt(t.due_date, 10)).toLocaleDateString('pt-BR') : null,
    prioridade:   PRIORITY_LABEL[t.priority] ?? null,
    url:          t.url ?? null
  }
}

async function executeTool(name, input) {
  try {
    switch (name) {
      case 'listar_listas_workspace':  return await listarListasWorkspace()
      case 'listar_tarefas':           return await listarTarefas(input)
      case 'buscar_tarefa':            return await buscarTarefa(input)
      case 'criar_tarefa':             return await criarTarefa(input)
      case 'atualizar_tarefa':         return await atualizarTarefa(input)
      case 'comentar_tarefa':          return await comentarTarefa(input)
      case 'buscar_tarefas_atrasadas': return await buscarTarefasAtrasadas(input)
      default: return { error: `Ferramenta desconhecida: ${name}` }
    }
  } catch (err) {
    console.error(`❌ Erro na ferramenta '${name}':`, err.message)
    return { error: err.message }
  }
}

module.exports = { CLICKUP_TOOLS, executeTool }
