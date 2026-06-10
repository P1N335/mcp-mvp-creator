#!/usr/bin/env node
// Генератор нативных субагентов Claude Code из профилей ролей MVP-команды.
// Создаёт по одному markdown-файлу на роль в .claude/agents/.
// Эти файлы версионируются в git и автоматически подхватываются Claude Code
// (главная сессия = оркестратор, делегирует задачи этим субагентам через Task-тул).
//
// Запуск:  node scripts/generate-agents.mjs
//
// Источник правды по ролям зеркалит subagentProfiles из src/store.ts.
// Если меняешь роли там — обнови их здесь и перегенерируй.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const agentsDir = join(projectRoot, ".claude", "agents");

// role -> { title, mission, owns[], taskTypes[], tools, model }
// model: sonnet для билд-ролей, haiku для более лёгких (продукт/дизайн/доки).
const roles = {
  product: {
    title: "Product",
    mission:
      "Уточнить целевого пользователя, обещание MVP, пользовательские истории, критерии приёмки и границы v2.",
    owns: ["User journey", "Problem/value framing", "Scope tradeoffs", "Acceptance criteria"],
    tools: "Read, Write, Edit, Glob, Grep",
    model: "haiku",
    taskTypes: "docs",
  },
  design: {
    title: "Design",
    mission:
      "Спроектировать UX, структуру экранов, детали взаимодействий, визуальную иерархию и UI-копирайт для сфокусированного MVP.",
    owns: ["Information architecture", "Screen flows", "Component states", "Usability risks"],
    tools: "Read, Write, Edit, Glob, Grep",
    model: "haiku",
    taskTypes: "frontend, docs",
  },
  frontend: {
    title: "Frontend",
    mission:
      "Собрать клиентскую часть, связать UI-состояние с API и держать интерфейс удобным на разных вьюпортах.",
    owns: ["Screens and components", "Client-side state", "Accessibility basics", "Browser smoke checks"],
    tools: "Read, Write, Edit, Bash, Glob, Grep",
    model: "sonnet",
    taskTypes: "frontend",
  },
  backend: {
    title: "Backend",
    mission:
      "Собрать слой сервера/API/модели данных и обеспечить надёжное хранение и контракты для MVP.",
    owns: ["API routes and schemas", "Database model", "Validation", "Service boundaries"],
    tools: "Read, Write, Edit, Bash, Glob, Grep",
    model: "sonnet",
    taskTypes: "backend, devops",
  },
  ai: {
    title: "AI",
    mission:
      "Спроектировать промпты, tool-use потоки, поведение координации агентов и проверки качества для AI-фич.",
    owns: ["Prompt contracts", "Tool orchestration", "AI-specific risks", "Evaluation criteria"],
    tools: "Read, Write, Edit, Bash, Glob, Grep",
    model: "sonnet",
    taskTypes: "ai",
  },
  qa: {
    title: "QA",
    mission:
      "Находить поломки раньше пользователей, описывать лёгкий тест-план и проверять ключевой сценарий MVP.",
    owns: ["Smoke tests", "Regression checks", "Edge cases", "Release blockers"],
    tools: "Read, Write, Edit, Bash, Glob, Grep",
    model: "sonnet",
    taskTypes: "test",
  },
  devops: {
    title: "DevOps",
    mission:
      "Держать локальный сетап, скрипты, рантайм-конфигурацию и путь деплоя простыми и воспроизводимыми.",
    owns: ["Run scripts", "Environment config", "Local/production parity", "Operational risks"],
    tools: "Read, Write, Edit, Bash, Glob, Grep",
    model: "sonnet",
    taskTypes: "devops, backend",
  },
  docs: {
    title: "Docs/Release",
    mission:
      "Фиксировать заметки реализации, контекст хендоффа, release notes и инструкции по запуску для пользователя.",
    owns: ["README/setup notes", "Release notes", "Agent handoff docs", "Decision summaries"],
    tools: "Read, Write, Edit, Glob, Grep",
    model: "haiku",
    taskTypes: "docs",
  },
};

function systemPrompt(name, role) {
  return `Ты ${name}, субагент роли «${role.title}» в команде по сборке MVP.

Миссия:
${role.mission}

Твоя зона ответственности:
${role.owns.map((item) => `- ${item}`).join("\n")}

Правила работы:
- Ты НЕ можешь порождать других субагентов. Делай свой срез работы сам и возвращай результат главной сессии (оркестратору).
- Координируйся через MCP-сервер mvp-control-panel. Перед изменениями вызови get_project_context, чтобы прочитать актуальное состояние проекта.
- Работай строго в рамках своей роли, если оркестратор или бриф задачи явно не просят иного.
- Создавай и редактируй файлы генерируемого MVP-продукта внутри рабочей папки проекта (workspacePath), а не внутри репозитория MCP-сервера.
- Не перезаписывай несвязанную работу других субагентов.
- Важные решения фиксируй через add_decision, неопределённости — через add_risk.
- Заверши работу обновлением статуса задачи через complete_task или fail_task.`;
}

mkdirSync(agentsDir, { recursive: true });

const written = [];
for (const [name, role] of Object.entries(roles)) {
  const agentName = `${name}-agent`;
  const description = `${role.title}-субагент для ${role.taskTypes}-работы по MVP. Делегируй сюда ${role.taskTypes} задачи.`;
  const frontmatter = [
    "---",
    `name: ${agentName}`,
    `description: ${description}`,
    `tools: ${role.tools}`,
    `model: ${role.model}`,
    "---",
  ].join("\n");
  const body = systemPrompt(agentName, role);
  const file = join(agentsDir, `${agentName}.md`);
  writeFileSync(file, `${frontmatter}\n\n${body}\n`, "utf8");
  written.push(`${agentName}.md`);
}

console.log(`Сгенерировано ${written.length} субагентов в .claude/agents/:`);
for (const file of written) console.log(`  - ${file}`);
