# ══════════════════════════════════════════════════════════════════════════════
#  Stage 1 — Builder
# ══════════════════════════════════════════════════════════════════════════════
FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Força git:// → https:// (resolve exit code 128 em ambientes cloud)
# e ajusta timeouts do npm para compilação de módulos nativos
RUN git config --global url."https://".insteadOf git:// \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm config set fetch-retries 5

COPY package*.json ./

RUN npm install --omit=dev --no-audit --no-fund --legacy-peer-deps

# ══════════════════════════════════════════════════════════════════════════════
#  Stage 2 — Runtime
# ══════════════════════════════════════════════════════════════════════════════
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY src/          ./src/

RUN mkdir -p /app/auth_info /app/data

# Valores padrão — sobrescreva nas variáveis de ambiente do EasyPanel
ENV NODE_ENV=production
ENV AUTH_FOLDER=/app/auth_info
ENV DB_PATH=/app/data/sessions.db

HEALTHCHECK \
    --interval=30s \
    --timeout=10s  \
    --start-period=90s \
    --retries=3 \
    CMD node -e "process.exit(0)"

CMD ["node", "src/index.js"]
