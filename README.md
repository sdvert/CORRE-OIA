# 🤖 WhatsApp Claude Agent

Agente de IA para WhatsApp powered by **Claude (Anthropic)** + **Baileys**.  
Desenvolvido por **JVBOTS** para rodar em VPS com EasyPanel.

---

## ✨ Funcionalidades

- Responde mensagens do WhatsApp automaticamente usando Claude
- Mantém histórico de conversa por contato (contexto entre mensagens)
- Reconexão automática em caso de queda
- Persistência de sessão via SQLite
- Pronto para deploy no EasyPanel via Docker

---

## 🚀 Deploy no EasyPanel

### 1. Crie o app no EasyPanel
- Vá em **Apps → New App**
- Selecione **"From Source"** ou **"Dockerfile"**
- Aponte para este repositório

### 2. Configure volumes persistentes
No EasyPanel, em **Volumes**, adicione:

| Caminho no container | Descrição |
|---|---|
| `/app/auth_info` | Sessão do WhatsApp (evita escanear QR toda vez) |
| `/app/sessions.db` | Histórico de conversas |

### 3. Configure variável de ambiente
No EasyPanel, em **Environment**, adicione:

```
ANTHROPIC_API_KEY=sk-ant-SUA_CHAVE_AQUI
```

> Obtenha sua chave em: https://console.anthropic.com/

### 4. Faça o deploy e escaneie o QR Code
- Clique em **Deploy**
- Abra os **Logs** do app
- O QR Code vai aparecer em texto no terminal
- No WhatsApp: **Configurações → Dispositivos Conectados → Conectar dispositivo**
- Escaneie o QR Code

---

## 💻 Rodar localmente

```bash
# Clone o repositório
git clone https://github.com/sdvert/IAagent
cd IAagent

# Instale as dependências
npm install

# Configure o ambiente
cp .env.example .env
# Edite o .env com sua ANTHROPIC_API_KEY

# Inicie o bot
npm start
```

---

## 📁 Estrutura do projeto

```
whatsapp-agent/
├── src/
│   ├── index.js         # Conexão Baileys + loop de mensagens
│   ├── claudeAgent.js   # Integração com a API do Claude
│   └── sessionStore.js  # Persistência do histórico (SQLite)
├── .env.example         # Template de variáveis de ambiente
├── .gitignore
├── Dockerfile
├── package.json
└── README.md
```

---

## 🔁 Reconexão automática

O bot reconecta automaticamente até **5 vezes** em caso de queda.  
Se for deslogado (loggedOut), delete a pasta `auth_info/` e reinicie para gerar um novo QR.

---

## 🛡️ Segurança

- Nunca suba o arquivo `.env` para o Git
- A pasta `auth_info/` contém sua sessão do WhatsApp — mantenha privada
- O `.gitignore` já protege esses arquivos por padrão

---

## 📜 Licença

MIT — JVBOTS
