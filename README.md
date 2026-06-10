# MVP Control Panel MCP

Локальный MCP-сервер и панель управления для генерации быстрых MVP-продуктов из идеи
с помощью согласованной работы субагентов **Claude Code**.

Проект позволяет:

- вести проекты, MVP-спеки, задачи, риски, решения и release notes через MCP tools;
- хранить состояние проектов в SQLite;
- следить за прогрессом через лёгкий локальный UI (Simple mode);
- оркестрировать сборку MVP нативными субагентами Claude Code.

## Модель оркестрации: нативные субагенты Claude Code

Главная сессия Claude Code = **оркестратор**. Она читает состояние проекта через MCP,
планирует задачи и делегирует их субагентам-ролям через Task-тул. Роли описаны как
markdown-файлы в `.claude/agents/` и подхватываются автоматически.

> Важное ограничение Claude Code: субагенты **не могут порождать других субагентов**.
> Поэтому дирижирует именно главная сессия, а субагенты делают свой срез и возвращают
> результат. Инструкция оркестратора — в `CLAUDE.md`.

Роли субагентов: `product`, `design`, `frontend`, `backend`, `ai`, `qa`, `devops`, `docs`.

Перегенерировать файлы агентов из профилей ролей:

```bash
npm run gen:agents
```

Сгенерированные MVP-файлы создаются вне репозитория MCP-сервера:

```txt
C:\Users\FSOS\mvp-projects
```

Путь можно переопределить:

```bash
MVP_PROJECTS_DIR=/path/to/mvp-projects
```

## Требования

- Node.js с поддержкой `node:sqlite`
- npm
- Claude Code CLI

## Установка

```bash
npm install
npm run build
```

## Подключение MCP-серверов к Claude Code

В корне лежит `.mcp.json` — он подключает к Claude Code два сервера:

- `mvp-control-panel` — этот локальный stdio-сервер (источник правды по проекту);
- `github` — внешний GitHub MCP (пуш готового MVP в репозиторий, issues/PR).

Для GitHub MCP нужен персональный токен в переменной окружения `GITHUB_TOKEN`:

```bash
# Windows PowerShell
$env:GITHUB_TOKEN = "ghp_xxx"
```

Альтернатива `.mcp.json` — добавить сервер командой:

```bash
claude mcp add --transport http github https://api.githubcopilot.com/mcp/ \
  --header "Authorization: Bearer ghp_xxx"
```

Проверить подключение из сессии Claude Code: команда `/mcp`.

## Запуск MCP-сервера

```bash
npm start          # entrypoint: build/index.js
```

## Запуск локального UI

```bash
npm run ui         # Simple mode: http://127.0.0.1:4173
```

Simple mode: пользователь описывает идею, нажимает «Сгенерировать MVP» и следит
за прогрессом агентов и логами.

Расширенная админ-панель (спеки, задачи, воркфлоу, риски, решения, subagent briefs,
release notes) сохранена отдельно и при необходимости запускается так:

```bash
npm run ui:advanced
```

## Основные MCP Tools

- `create_project`, `list_projects`, `get_project_context`
- `create_mvp_spec`, `create_task`, `update_task_status`
- `add_decision`, `add_risk`, `generate_release_notes`
- `create_workflow`, `list_ready_tasks`, `claim_task`, `complete_task`, `fail_task`
- `list_subagents`, `get_subagent_brief`, `generate_subagent_plan`

## Примечания

- `.claude/agents/*.md` и `CLAUDE.md` версионируются в git и описывают команду субагентов.
- Runtime SQLite data (`data/`) намеренно исключена из git.
- `build/` создаётся командой `npm run build` и не хранится в репозитории.
- Альтернативная архитектура B (параллельные headless `claude`/`codex` процессы) живёт в
  `src/runner.ts`. В нативной модели субагентов раннер не нужен; оставлен как опция.

## Развёртывание через Docker Compose

Один образ — два режима, переключаются через `.env` (compose читает его сам).

| Режим | Что делает | Токены | Что нужно |
|-------|-----------|--------|-----------|
| **DEMO** (по умолчанию) | Субагенты прогоняются в симуляции (provider `manual`) | нет | ничего |
| **LIVE** | Раннер запускает настоящих headless-субагентов Claude, которые реально собирают MVP в `./mvp-projects` | да | `ANTHROPIC_API_KEY` |

`./data` — SQLite-состояние, `./mvp-projects` — результат (виден на хосте). UI: http://127.0.0.1:4173

### DEMO — показать механику оркестрации без токенов

```bash
mkdir -p data mvp-projects
docker compose up -d --build
npm run seed:demo            # засеять демо-проект (панель должна быть запущена)
```

В шапке бейдж «DEMO · без токенов». Жми **«Симулировать субагентов»** — роли
проходят пайплайн до «Готово». Никакого `claude`, нулевой расход.

### LIVE — реальный MVP, собранный субагентами (для работодателя)

```bash
cp .env.example .env
#   в .env:  MVP_DEMO_MODE=0  и  ANTHROPIC_API_KEY=sk-ant-...
docker compose up -d --build
```

Теперь кнопка «Сгенерировать MVP» запускает headless-субагентов Claude внутри
контейнера: они пишут настоящий код проекта в `./mvp-projects/<проект>`, а панель
показывает прогресс по ролям. Готовый продукт открываешь прямо из `./mvp-projects`.

> Тратит токены Anthropic. Раннер запускает по headless-`claude` на каждую готовую
> задачу (`backend`/`frontend`/`qa`/`docs`). LIVE-команду headless-запуска стоит
> один раз проверить на своей машине с реальным ключом.

### Модель A — оркестрация в интерактивной сессии Claude Code

Альтернатива раннеру: дирижирует сама сессия Claude Code на хосте через MCP.
Сервис `mcp` (stdio) делит ту же БД:

```bash
docker compose run --rm -T mcp        # ручная проверка stdio
```

`.mcp.json` на хосте:

```json
{
  "mcpServers": {
    "mvp-control-panel": {
      "command": "docker",
      "args": ["compose", "run", "--rm", "-T", "mcp"]
    }
  }
}
```

Дальше: запусти `claude`, проверь `/mcp` и `/agents`, попроси «собери MVP для проекта X».
Главная сессия (оркестратор, см. `CLAUDE.md`) прочитает контекст через
`get_project_context` и делегирует субагентам (`backend-agent`, `frontend-agent`,
`qa-agent`, `docs-agent`) через Task-тул. Токены тратит только эта сессия.

### Заметки

- Контейнер работает не от root (Claude Code блокирует bypass-permissions под root).
- `node:sqlite` требует Node ≥ 22.5 — базовый образ `node:22-slim` это покрывает.
- DEMO ↔ LIVE переключается только переменными в `.env`, пересборка образа не нужна
  (но в LIVE первый раз собери с `--build`, чтобы образ содержал Claude CLI).
