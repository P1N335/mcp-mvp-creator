# syntax=docker/dockerfile:1
#
# Два режима (переключаются через env, см. docker-compose.yml / .env):
#
#  DEMO  (MVP_DEMO_MODE=1, по умолчанию) — панель + MCP-бэкенд. Субагенты
#        прогоняются в симуляции (provider manual), токены НЕ тратятся.
#
#  LIVE  (MVP_DEMO_MODE=0 + ANTHROPIC_API_KEY) — runner запускает настоящих
#        headless-субагентов Claude, которые реально собирают MVP в
#        /app/mvp-projects. Тратит токены. Для показа результата работодателю.

############################
# Стадия 1: сборка TS -> JS
############################
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

############################
# Стадия 2: рантайм
############################
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Claude Code CLI нужен LIVE-режиму (в DEMO не вызывается).
RUN npm install -g @anthropic-ai/claude-code \
  && npm cache clean --force

# Только прод-зависимости (@modelcontextprotocol/sdk, zod).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Артефакты сборки и описания субагентов/оркестратора.
COPY --from=build /app/build ./build
COPY .claude ./.claude
COPY CLAUDE.md ./CLAUDE.md
COPY scripts ./scripts

# Каталоги для bind-mount: SQLite и сгенерированные MVP.
RUN mkdir -p /app/data /app/mvp-projects \
  && chown -R node:node /app

# Не root: Claude Code блокирует bypass-permissions под root.
USER node

# Безопасные значения по умолчанию = DEMO (без токенов). LIVE включается из compose/.env.
ENV PORT=4173 \
    MVP_CONTROL_PANEL_DB=/app/data/mvp-control-panel.sqlite \
    MVP_PROJECTS_DIR=/app/mvp-projects \
    MVP_DEMO_MODE=1 \
    CLAUDE_PERMISSION_MODE=bypassPermissions

EXPOSE 4173

# Главный процесс — панель (UI). MCP-сервер (stdio) для сессии на хосте —
# через `docker compose run --rm -T mcp` или `docker exec`.
CMD ["node", "build/ui.js"]
