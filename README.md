# MVP Control Panel MCP

Локальный MCP-сервер и панель управления для генерации быстрых MVP-продуктов из идеи с помощью согласованной работы субагентов Codex и Claude.

Проект позволяет:

- вести проекты, MVP-спеки, задачи, риски, решения и релизные заметки через MCP tools;
- хранить состояние проектов в SQLite;
- работать через локальный UI в двух режимах: Simple и Advanced;
- запускать routed runner для распределения задач между субагентами;
- автоматически переключать задачу между Codex и Claude, если агент уперся в token/context/session/rate/quota limit.

## Маршрутизация Агентов

- Backend: Claude
- Frontend: Claude, с fallback на Codex при resource limit
- QA: Codex, с fallback на Claude при resource limit
- Docs: Codex, с fallback на Claude при resource limit

Сгенерированные MVP-файлы по умолчанию создаются вне репозитория MCP-сервера:

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
- Codex CLI для задач Codex
- Claude Code CLI для задач Claude

## Установка

```bash
npm install
npm run build
```

## Запуск MCP-Сервера

```bash
npm start
```

Entrypoint MCP-сервера:

```txt
build/index.js
```

## Запуск Локального UI

```bash
npm run ui
```

Открыть:

```txt
http://127.0.0.1:4173
```

Simple mode предназначен для обычного сценария: пользователь описывает идею, создает MVP и наблюдает за прогрессом агентов.

Advanced mode открывает технический контроль: спеки, задачи, workflow, subagent briefs, команды runner, решения, риски и release notes.

## Запуск Agent Runner

Запустить одну routed-задачу:

```bash
npm run runner -- --project-id <projectId> --provider auto --once
```

Запустить runner до состояния idle:

```bash
npm run runner -- --project-id <projectId> --provider auto --stop-when-idle --max-cycles 8
```

Проверить routing без запуска агентов:

```bash
npm run runner -- --project-id <projectId> --provider auto --once --dry-run
```

## Пример Конфига MCP-Клиента

После clone/build укажите абсолютный путь к этому репозиторию.

```json
{
  "mcpServers": {
    "mvp-control-panel": {
      "command": "node",
      "args": ["C:/path/to/mcp-server/build/index.js"]
    }
  }
}
```

## Основные MCP Tools

- `create_project`
- `list_projects`
- `get_project_context`
- `create_mvp_spec`
- `create_task`
- `update_task_status`
- `add_decision`
- `add_risk`
- `generate_release_notes`
- `create_workflow`
- `list_ready_tasks`
- `claim_task`
- `complete_task`
- `fail_task`
- `list_subagents`
- `get_subagent_brief`
- `generate_subagent_plan`

## Примечания

- Runtime SQLite data намеренно исключена из git.
- `build/` создается командой `npm run build` и не хранится в репозитории.
- Локальные настройки Claude исключены из git.
