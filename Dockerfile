FROM node:20-alpine

# Dependências nativas para better-sqlite3
RUN apk add --no-cache python3 make g++ sqlite

WORKDIR /app

# Copia manifests e instala dependências
COPY package*.json ./
RUN npm install --omit=dev

# Copia código fonte
COPY src/ ./src/

# Cria pastas que precisam de volume persistente
RUN mkdir -p /app/auth_info

# Expõe porta caso queira adicionar uma API HTTP futuramente
EXPOSE 3000

# Health check simples
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s \
  CMD node -e "require('fs').existsSync('./sessions.db') ? process.exit(0) : process.exit(1)"

CMD ["node", "src/index.js"]
