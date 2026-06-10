#!/usr/bin/env node
// Демо-сид: создаёт готовый проект с MVP-планом и воркфлоу ролей через HTTP API
// панели, чтобы на демонстрации сразу было что показать.
//
// Панель должна быть запущена (docker compose up / npm run ui).
//   node scripts/seed-demo.mjs
//   BASE_URL=http://127.0.0.1:4173 node scripts/seed-demo.mjs
//
// После сида в demo-режиме нажми «Симулировать субагентов» — роли пройдут
// пайплайн до «Готово» без расхода токенов. Реальную работу субагентов
// показывай в сессии Claude Code (модель A) через MCP-tools.

const BASE = process.env.BASE_URL || "http://127.0.0.1:4173";

async function api(path, options) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(`${path} -> ${res.status} ${data.error || ""}`);
  }
  return data;
}

const project = (await api("/api/projects", {
  method: "POST",
  body: JSON.stringify({
    name: "Demo: Task Tracker MVP",
    idea: "Минимальный трекер задач: создать задачу, отметить выполненной, фильтр по статусу.",
    targetAudience: "Небольшие команды и фрилансеры",
  }),
})).project;
console.log("создан проект:", project.id, "-", project.name);

await api(`/api/projects/${project.id}/decompose`, { method: "POST", body: "{}" });
console.log("MVP-план (draft) создан");

await api(`/api/projects/${project.id}/workflows`, {
  method: "POST",
  body: JSON.stringify({ roles: ["backend", "frontend", "qa", "docs"], createMissingTasks: true }),
});
console.log("воркфлоу ролей backend/frontend/qa/docs создан");

console.log("\nГотово. Открой панель:", BASE);
console.log("В demo-режиме жми «Симулировать субагентов» — пайплайн пройдёт без токенов.");
