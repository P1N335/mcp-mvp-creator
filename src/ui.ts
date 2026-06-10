import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  addDecision,
  addRisk,
  buildAgentHandoff,
  buildReleaseNotes,
  buildSubagentPlan,
  claimTask,
  completeTask,
  createWorkflow,
  createDraftMvpPlan,
  createMvpSpec,
  createProject,
  createTask,
  databasePath,
  failTask,
  getCurrentProjectContext,
  getProjectContext,
  getProjectOrError,
  getWorkflowState,
  ensureProjectWorkspace,
  listReadyTasks,
  listProjects,
  projectRoot,
  projectWorkspaceRoot,
  updateTaskStatus,
  type AgentMode,
  type AgentTarget,
  type DecisionCategory,
  type DecisionImpact,
  type Priority,
  type ProjectStatus,
  type RiskSeverity,
  type RiskStatus,
  type TaskStatus,
  type TaskType,
  type SubagentRole,
  type AgentProvider,
} from "./store.js";

type JsonObject = Record<string, unknown>;
type RunnerProvider = "claude" | "manual";

function send(
  response: ServerResponse,
  statusCode: number,
  body: string,
  contentType: string,
) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendJson(response: ServerResponse, statusCode: number, data: unknown) {
  send(
    response,
    statusCode,
    JSON.stringify(data, null, 2),
    "application/json; charset=utf-8",
  );
}

function sendError(response: ServerResponse, statusCode: number, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  sendJson(response, statusCode, { ok: false, error: message });
}

async function readJson(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? (JSON.parse(text) as JsonObject) : {};
}

function stringField(body: JsonObject, key: string, fallback = "") {
  const value = body[key];
  return typeof value === "string" ? value.trim() : fallback;
}

function optionalStringField(body: JsonObject, key: string) {
  const value = stringField(body, key);
  return value ? value : undefined;
}

function linesField(body: JsonObject, key: string) {
  const value = body[key];

  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function runnerProviderFromValue(value: unknown): RunnerProvider {
  // Runner теперь Claude-only. "manual" = прогон без запуска внешнего агента,
  // всё остальное (включая исторический "auto"/"codex") трактуем как "claude".
  return value === "manual" ? "manual" : "claude";
}

function positiveIntegerField(value: unknown, fallback: number) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function isDemoMode() {
  const value = process.env.MVP_DEMO_MODE;
  return value === "1" || value === "true";
}

// В demo-режиме (модель A на демо) субагенты прогоняются в симуляции через
// provider "manual" — без запуска внешнего claude и без расхода токенов.
function defaultRunnerProvider(): RunnerProvider {
  return isDemoMode() ? "manual" : "claude";
}

function getState() {
  return {
    ok: true,
    databasePath,
    projectWorkspaceRoot,
    projects: listProjects(),
    currentContext: getCurrentProjectContext(),
    demoMode: isDemoMode(),
  };
}

function startRunnerProcess(input: {
  projectId: string;
  provider: RunnerProvider;
  once: boolean;
  maxParallel?: number;
  maxCycles?: number;
  stopWhenIdle?: boolean;
}) {
  const args = [
    "build/runner.js",
    "--project-id",
    input.projectId,
    "--provider",
    input.provider,
    "--max-parallel",
    String(input.maxParallel ?? 1),
  ];

  if (input.once) args.push("--once");
  if (input.stopWhenIdle) args.push("--stop-when-idle");
  if (input.maxCycles) args.push("--max-cycles", String(input.maxCycles));

  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  return {
    pid: child.pid,
    provider: input.provider,
    once: input.once,
    maxParallel: input.maxParallel ?? 1,
    maxCycles: input.maxCycles,
    stopWhenIdle: Boolean(input.stopWhenIdle),
  };
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) {
  const parts = url.pathname.split("/").filter(Boolean);
  const method = request.method ?? "GET";

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, databasePath, projectWorkspaceRoot, demoMode: isDemoMode() });
    return;
  }

  if (method === "GET" && url.pathname === "/api/state") {
    sendJson(response, 200, getState());
    return;
  }

  if (method === "POST" && url.pathname === "/api/projects") {
    const body = await readJson(request);
    const project = createProject({
      name: stringField(body, "name"),
      idea: stringField(body, "idea"),
      targetAudience: optionalStringField(body, "targetAudience"),
    });
    sendJson(response, 201, { ok: true, project });
    return;
  }

  if (parts[0] === "api" && parts[1] === "projects" && parts[2]) {
    const projectId = parts[2];

    if (method === "GET" && parts[3] === "context") {
      sendJson(response, 200, { ok: true, context: getProjectContext(projectId) });
      return;
    }

    if (method === "POST" && parts[3] === "open-workspace") {
      const project = getProjectOrError(projectId);
      const workspacePath = ensureProjectWorkspace(project);
      const command =
        process.platform === "win32"
          ? "explorer.exe"
          : process.platform === "darwin"
            ? "open"
            : "xdg-open";
      const args = [workspacePath];
      const child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      sendJson(response, 200, { ok: true, workspacePath });
      return;
    }

    if (method === "GET" && parts[3] === "workflow-state") {
      sendJson(response, 200, {
        ok: true,
        workflowState: getWorkflowState(projectId),
      });
      return;
    }

    if (method === "GET" && parts[3] === "runner-command") {
      const provider = runnerProviderFromValue(url.searchParams.get("provider"));
      const command = `npm run runner -- --project-id ${projectId} --once`;
      const loopCommand = `npm run runner -- --project-id ${projectId} --max-parallel 1`;
      sendJson(response, 200, {
        ok: true,
        provider,
        command,
        loopCommand,
      });
      return;
    }

    if (method === "POST" && parts[3] === "runner-process") {
      const body = await readJson(request);
      const provider = isDemoMode() ? "manual" : runnerProviderFromValue(body.provider);
      const once = body.once !== false;
      const runner = startRunnerProcess({
        projectId,
        provider,
        once,
        maxParallel: positiveIntegerField(body.maxParallel, 1),
        maxCycles: body.maxCycles ? positiveIntegerField(body.maxCycles, 8) : undefined,
        stopWhenIdle: Boolean(body.stopWhenIdle),
      });

      sendJson(response, 202, {
        ok: true,
        ...runner,
      });
      return;
    }

    if (method === "POST" && parts[3] === "start-generation") {
      const body = await readJson(request);
      const context = getProjectContext(projectId);
      const draftCreated = context.specs.length === 0;

      if (draftCreated) {
        createDraftMvpPlan(projectId);
      }

      const workflowState = getWorkflowState(projectId);
      const workflowCreated =
        workflowState.workflows.length === 0 ||
        workflowState.assignments.length === 0 ||
        workflowState.agentProfiles.length === 0;

      if (workflowCreated) {
        createWorkflow({
          projectId,
          roles: ["backend", "frontend", "qa", "docs"],
          createMissingTasks: true,
        });
      }

      const runner = startRunnerProcess({
        projectId,
        provider: defaultRunnerProvider(),
        once: false,
        maxParallel: positiveIntegerField(body.maxParallel, 1),
        maxCycles: positiveIntegerField(body.maxCycles, 8),
        stopWhenIdle: true,
      });

      sendJson(response, 202, {
        ok: true,
        draftCreated,
        workflowCreated,
        runner,
        workflowState: getWorkflowState(projectId),
      });
      return;
    }

    if (method === "POST" && parts[3] === "workflows") {
      const body = await readJson(request);
      const allowedRoles = [
        "orchestrator",
        "product",
        "design",
        "frontend",
        "backend",
        "ai",
        "qa",
        "devops",
        "docs",
      ];
      const roles = Array.isArray(body.roles)
        ? body.roles.filter((role): role is SubagentRole =>
            typeof role === "string" && allowedRoles.includes(role),
          )
        : undefined;
      const workflow = createWorkflow({
        projectId,
        name: optionalStringField(body, "name"),
        roles,
        createMissingTasks: body.createMissingTasks !== false,
      });
      sendJson(response, 201, { ok: true, workflow });
      return;
    }

    if (method === "POST" && parts[3] === "runner-step") {
      const readyTask = listReadyTasks({ projectId })[0];

      if (!readyTask) {
        sendJson(response, 200, { ok: true, idle: true });
        return;
      }

      const claim = claimTask({
        taskId: readyTask.task.id,
        role: readyTask.assignment?.role,
        provider: "manual",
        agentLabel: "UI manual runner step",
      });
      const completion = completeTask({
        runId: claim.run.id,
        summary: "Completed by UI manual runner step.",
        artifacts: [
          {
            kind: "note",
            title: "UI manual runner step",
            content:
              "This step verified orchestration without launching an external agent process.",
          },
        ],
      });
      sendJson(response, 200, { ok: true, idle: false, claim, completion });
      return;
    }

    if (method === "POST" && parts[3] === "decompose") {
      const draft = createDraftMvpPlan(projectId);
      sendJson(response, 201, { ok: true, draft });
      return;
    }

    if (method === "POST" && parts[3] === "spec") {
      const body = await readJson(request);
      const spec = createMvpSpec({
        projectId,
        summary: stringField(body, "summary"),
        inScope: linesField(body, "inScope"),
        outOfScope: linesField(body, "outOfScope"),
        userStories: linesField(body, "userStories"),
        risks: linesField(body, "risks"),
      });
      sendJson(response, 201, { ok: true, spec });
      return;
    }

    if (method === "POST" && parts[3] === "tasks") {
      const body = await readJson(request);
      const task = createTask({
        projectId,
        title: stringField(body, "title"),
        description: stringField(body, "description"),
        type: stringField(body, "type", "backend") as TaskType,
        priority: stringField(body, "priority", "medium") as Priority,
      });
      sendJson(response, 201, { ok: true, task });
      return;
    }

    if (method === "POST" && parts[3] === "decisions") {
      const body = await readJson(request);
      const decision = addDecision({
        projectId,
        title: stringField(body, "title"),
        decision: stringField(body, "decision"),
        category: stringField(body, "category", "product") as DecisionCategory,
        impact: stringField(body, "impact", "medium") as DecisionImpact,
        rationale: optionalStringField(body, "rationale"),
        alternatives: linesField(body, "alternatives"),
        owner: optionalStringField(body, "owner"),
      });
      sendJson(response, 201, { ok: true, decision });
      return;
    }

    if (method === "POST" && parts[3] === "risks") {
      const body = await readJson(request);
      const risk = addRisk({
        projectId,
        title: stringField(body, "title"),
        description: stringField(body, "description"),
        severity: stringField(body, "severity", "medium") as RiskSeverity,
        status: stringField(body, "status", "open") as RiskStatus,
        mitigation: optionalStringField(body, "mitigation"),
        owner: optionalStringField(body, "owner"),
      });
      sendJson(response, 201, { ok: true, risk });
      return;
    }

    if (method === "GET" && parts[3] === "release-notes") {
      const includeBacklog = url.searchParams.get("includeBacklog") === "true";
      const version = url.searchParams.get("version") ?? undefined;
      const releaseNotes = buildReleaseNotes(projectId, version, includeBacklog);
      sendJson(response, 200, { ok: true, releaseNotes });
      return;
    }

    if (method === "GET" && parts[3] === "agent-handoff") {
      const agent =
        url.searchParams.get("agent") === "claude" ? "claude" : "codex";
      const requestedMode = url.searchParams.get("mode");
      const mode =
        requestedMode === "plan" || requestedMode === "review"
          ? requestedMode
          : "build";
      const handoff = buildAgentHandoff({
        projectId,
        agent: agent as AgentTarget,
        mode: mode as AgentMode,
      });
      sendJson(response, 200, { ok: true, handoff });
      return;
    }

    if (method === "GET" && parts[3] === "subagent-plan") {
      const requestedMode = url.searchParams.get("mode");
      const mode =
        requestedMode === "plan" || requestedMode === "review"
          ? requestedMode
          : "build";
      const roles = url.searchParams
        .getAll("role")
        .filter((role): role is SubagentRole =>
          [
            "orchestrator",
            "product",
            "design",
            "frontend",
            "backend",
            "ai",
            "qa",
            "devops",
            "docs",
          ].includes(role),
        );
      const subagentPlan = buildSubagentPlan({
        projectId,
        mode: mode as AgentMode,
        roles: roles.length ? roles : undefined,
      });
      sendJson(response, 200, { ok: true, subagentPlan });
      return;
    }
  }

  if (parts[0] === "api" && parts[1] === "tasks" && parts[2]) {
    if (method === "PATCH" && parts[3] === "status") {
      const body = await readJson(request);
      const result = updateTaskStatus(
        parts[2],
        stringField(body, "status", "backlog") as TaskStatus,
      );

      if (!result) {
        sendJson(response, 404, { ok: false, error: "Task not found" });
        return;
      }

      sendJson(response, 200, { ok: true, task: result.task, audit: result.audit });
      return;
    }

    if (method === "POST" && parts[3] === "claim") {
      const body = await readJson(request);
      const claim = claimTask({
        taskId: parts[2],
        role: optionalStringField(body, "role") as SubagentRole | undefined,
        provider:
          (optionalStringField(body, "provider") as AgentProvider | undefined) ??
          "manual",
        agentLabel: optionalStringField(body, "agentLabel"),
        model: optionalStringField(body, "model"),
        command: optionalStringField(body, "command"),
        prompt: optionalStringField(body, "prompt"),
      });
      sendJson(response, 201, { ok: true, claim });
      return;
    }

    if (method === "POST" && parts[3] === "complete") {
      const body = await readJson(request);
      const completion = completeTask({
        taskId: parts[2],
        runId: optionalStringField(body, "runId"),
        summary: optionalStringField(body, "summary"),
      });
      sendJson(response, 200, { ok: true, completion });
      return;
    }

    if (method === "POST" && parts[3] === "fail") {
      const body = await readJson(request);
      const failure = failTask({
        taskId: parts[2],
        runId: optionalStringField(body, "runId"),
        error: stringField(body, "error", "Task failed"),
      });
      sendJson(response, 200, { ok: true, failure });
      return;
    }
  }

  sendJson(response, 404, { ok: false, error: "Not found" });
}

// --- Simple-only клиент -------------------------------------------------------
// Вся «продвинутая» админка (спеки/задачи/воркфлоу/риски/решения/субагенты/release)
// перенесена в src/ui.advanced.ts и доступна через `npm run ui:advanced`.
// В нативной модели субагентов оркестрацию ведёт сам Claude Code, поэтому здесь
// оставлен только пользовательский сценарий: описать идею -> следить за прогрессом
// -> открыть папку с результатом.
function html() {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MVP Control Panel</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    background: #0f1115; color: #e7e9ee; }
  header { padding: 16px 24px; border-bottom: 1px solid #232733; display: flex;
    align-items: baseline; gap: 12px; }
  header h1 { font-size: 17px; margin: 0; }
  header .muted { color: #8b93a7; font-size: 13px; }
  .layout { display: grid; grid-template-columns: 320px 1fr; gap: 20px; padding: 20px 24px;
    align-items: start; }
  .panel { background: #161922; border: 1px solid #232733; border-radius: 12px; padding: 16px; }
  .panel h2 { font-size: 14px; margin: 0 0 12px; text-transform: uppercase; letter-spacing: .04em;
    color: #8b93a7; }
  label { display: block; font-size: 13px; color: #b9c0d0; margin: 10px 0 4px; }
  input, textarea { width: 100%; background: #0f1115; border: 1px solid #2b3040; color: #e7e9ee;
    border-radius: 8px; padding: 8px 10px; font: inherit; }
  textarea { min-height: 70px; resize: vertical; }
  button { background: #2b3040; color: #e7e9ee; border: 1px solid #353b4d; border-radius: 8px;
    padding: 8px 14px; font: inherit; cursor: pointer; }
  button:hover { background: #353b4d; }
  button.primary { background: #3b82f6; border-color: #3b82f6; color: #fff; font-weight: 600; }
  button.primary:hover { background: #2f6fe0; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .check { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
  .check input { width: auto; }
  .project { padding: 10px 12px; border: 1px solid #232733; border-radius: 8px; margin-bottom: 8px;
    cursor: pointer; }
  .project:hover { border-color: #3b82f6; }
  .project.active { border-color: #3b82f6; background: #1a2030; }
  .project .name { font-weight: 600; }
  .project .idea { color: #8b93a7; font-size: 13px; margin-top: 2px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status { display: flex; justify-content: space-between; align-items: center; gap: 16px;
    margin-bottom: 16px; }
  .status .title { font-size: 16px; font-weight: 600; }
  .status .text { color: #8b93a7; font-size: 13px; margin-top: 4px; }
  .progress { height: 6px; background: #232733; border-radius: 999px; overflow: hidden; margin: 8px 0 16px; }
  .progress > span { display: block; height: 100%; background: #3b82f6; transition: width .3s; }
  .steps { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .step { border: 1px solid #232733; border-radius: 10px; padding: 12px; }
  .step.done { border-color: #2f9e6a; }
  .step.failed { border-color: #d9534f; }
  .step.running { border-color: #3b82f6; }
  .step .role { font-weight: 600; text-transform: capitalize; }
  .step .task { color: #8b93a7; font-size: 12px; margin: 4px 0 8px; min-height: 28px; }
  .pill { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 999px;
    background: #232733; color: #b9c0d0; margin-right: 4px; }
  .pill.done { background: #14422e; color: #7ee0a8; }
  .pill.failed, .pill.error { background: #4a1f1d; color: #f3a6a3; }
  .pill.running { background: #15315e; color: #9bc2ff; }
  .ws { display: flex; gap: 8px; margin-top: 10px; }
  .ws input { flex: 1; }
  .log { margin-top: 16px; max-height: 220px; overflow: auto; }
  .log .entry { border-bottom: 1px solid #1c2029; padding: 6px 0; font-size: 13px; }
  .log .entry .meta { color: #6b7280; font-size: 11px; }
  .empty { color: #6b7280; padding: 24px; text-align: center; }
  .spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid #3b82f6;
    border-top-color: transparent; border-radius: 50%; animation: spin .8s linear infinite;
    vertical-align: middle; margin-right: 6px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
    background: #232733; border: 1px solid #353b4d; padding: 10px 16px; border-radius: 8px;
    opacity: 0; transition: opacity .2s; pointer-events: none; }
  .toast.show { opacity: 1; }
</style>
</head>
<body>
<header>
  <h1>MVP Control Panel</h1>
  <span class="muted">Simple mode — опиши идею, агенты соберут MVP</span>
  <span id="mode-badge"></span>
</header>
<div class="layout">
  <aside class="panel">
    <h2>Новый проект</h2>
    <form id="project-form">
      <label>Название</label>
      <input name="name" required minlength="3" placeholder="Todo-трекер" />
      <label>Идея MVP</label>
      <textarea name="idea" required placeholder="Что делает продукт и для кого"></textarea>
      <label>Аудитория (опционально)</label>
      <input name="targetAudience" placeholder="Фрилансеры" />
      <label class="check"><input type="checkbox" name="autoStart" value="true" checked /> Сразу запустить агентов</label>
      <div class="row" style="margin-top:14px;">
        <button class="primary" type="submit">Создать проект</button>
        <button type="button" id="refresh">Обновить</button>
      </div>
    </form>
    <h2 style="margin-top:20px;">Проекты</h2>
    <div id="projects"></div>
  </aside>
  <main class="panel" id="workspace"><div class="empty">Создай или выбери проект слева</div></main>
</div>
<div class="toast" id="toast"></div>
<script>
  var ROLES = ['backend', 'frontend', 'qa', 'docs'];
  var state = { projects: [], selectedId: null, context: null, workflow: null, monitored: false, demoMode: false };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var toastTimer;
  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2000);
  }
  async function api(path, options) {
    var res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {}));
    var data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  async function loadState() {
    var data = await api('/api/state');
    state.projects = data.projects || [];
    state.demoMode = !!data.demoMode;
    if (!state.selectedId && data.currentContext) state.selectedId = data.currentContext.project.id;
    if (state.selectedId) await loadProject(state.selectedId);
    render();
  }
  async function loadProject(id) {
    state.selectedId = id;
    var ctx = await api('/api/projects/' + encodeURIComponent(id) + '/context');
    state.context = ctx.context;
    var wf = await api('/api/projects/' + encodeURIComponent(id) + '/workflow-state');
    state.workflow = wf.workflowState;
  }

  function stepForRole(role) {
    var wf = state.workflow, ctx = state.context;
    var assignment = wf.assignments.find(function (a) { return a.role === role; });
    var task = assignment ? ctx.tasks.find(function (t) { return t.id === assignment.taskId; })
      : ctx.tasks.find(function (t) {
          if (role === 'qa') return t.type === 'test';
          if (role === 'docs') return t.type === 'docs';
          return t.type === role;
        });
    var active = wf.activeRuns.find(function (r) { return r.role === role; });
    var latest = wf.recentRuns.find(function (r) { return r.role === role; });
    var ready = wf.readyTasks.some(function (rt) {
      return (rt.assignment && rt.assignment.role === role) || (task && rt.task.id === task.id);
    });
    if (active) return { role: role, task: task, provider: active.provider, status: 'running', label: 'Работает' };
    if (task && task.status === 'done') return { role: role, task: task, provider: latest && latest.provider, status: 'done', label: 'Готово' };
    if (latest && latest.status === 'failed') return { role: role, task: task, provider: latest.provider, status: 'failed', label: 'Нужно внимание' };
    if (task && (task.status === 'in_progress' || task.status === 'review')) return { role: role, task: task, provider: latest && latest.provider, status: 'running', label: 'В работе' };
    if (ready) return { role: role, task: task, provider: latest && latest.provider, status: 'queued', label: 'В очереди' };
    if (task) return { role: role, task: task, provider: latest && latest.provider, status: 'waiting', label: 'Ожидает' };
    return { role: role, task: null, provider: null, status: 'pending', label: 'Не начато' };
  }

  function statusText(steps, busy) {
    var wf = state.workflow;
    var active = wf.activeRuns[0];
    if (active) return { title: (active.role + ' агент работает'), text: active.provider + ' выполняет задачу субагента. Панель обновляется автоматически.' };
    if (state.monitored && wf.readyTasks.length) return { title: 'Агенты идут по очереди', text: 'Раннер активен и скоро возьмёт следующую готовую задачу.' };
    if (steps.some(function (s) { return s.status === 'failed'; })) return { title: 'Один агент требует внимания', text: 'Запусти npm run ui:advanced, чтобы посмотреть упавший прогон и логи.' };
    if (steps.every(function (s) { return s.status === 'done'; })) return { title: 'Генерация MVP завершена', text: 'Файлы готового продукта лежат в рабочей папке проекта.' };
    if (wf.workflows.length) return { title: 'Можно продолжить', text: 'Нажми «Сгенерировать MVP», чтобы продолжить воркфлоу агентов.' };
    return { title: 'Готово к генерации', text: 'Нажми «Сгенерировать MVP»: будет создан план, воркфлоу и запущены агенты.' };
  }

  function render() {
    var badge = document.getElementById('mode-badge');
    if (badge) badge.innerHTML = state.demoMode
      ? '<span class="pill" title="Субагенты прогоняются в симуляции, без вызова модели">DEMO · без токенов</span>'
      : '';
    document.getElementById('projects').innerHTML = state.projects.length
      ? state.projects.map(function (p) {
          return '<div class="project ' + (p.id === state.selectedId ? 'active' : '') + '" data-project="' + esc(p.id) + '">' +
            '<div class="name">' + esc(p.name) + '</div><div class="idea">' + esc(p.idea) + '</div></div>';
        }).join('')
      : '<div class="empty">Пока нет проектов</div>';

    var ws = document.getElementById('workspace');
    if (!state.context) { ws.innerHTML = '<div class="empty">Создай или выбери проект слева</div>'; return; }

    var steps = ROLES.map(stepForRole);
    var done = steps.filter(function (s) { return s.status === 'done'; }).length;
    var progress = Math.round((done / ROLES.length) * 100);
    var busy = state.workflow.activeRuns.length > 0 || (state.monitored && state.workflow.readyTasks.length > 0);
    var st = statusText(steps, busy);
    var logs = state.workflow.recentLogs.slice(0, 8);

    ws.innerHTML =
      '<div class="status"><div>' +
        '<div class="title">' + (busy ? '<span class="spinner"></span>' : '') + esc(st.title) + '</div>' +
        '<div class="text">' + esc(st.text) + '</div></div>' +
        '<button class="primary" id="generate">' + (state.demoMode ? 'Симулировать субагентов' : (state.workflow.workflows.length ? 'Продолжить' : 'Сгенерировать MVP')) + '</button>' +
      '</div>' +
      '<div class="progress"><span style="width:' + progress + '%"></span></div>' +
      '<div class="steps">' + steps.map(function (s) {
        var pill = s.status === 'done' ? 'done' : s.status === 'failed' ? 'failed' : s.status === 'running' ? 'running' : '';
        return '<div class="step ' + s.status + '"><div class="role">' + esc(s.role) +
          (s.status === 'running' ? ' <span class="spinner"></span>' : '') + '</div>' +
          '<div class="task">' + esc(s.task ? s.task.title : '—') + '</div>' +
          '<span class="pill ' + pill + '">' + esc(s.label) + '</span>' +
          (s.provider ? '<span class="pill">' + esc(s.provider) + '</span>' : '') + '</div>';
      }).join('') + '</div>' +
      '<div class="ws"><input id="ws-path" readonly value="' + esc(state.context.project.workspacePath) + '" />' +
        '<button id="open-ws">Открыть папку</button><button id="copy-ws">Копировать путь</button></div>' +
      '<div class="log">' + (logs.length ? logs.map(function (l) {
        return '<div class="entry"><span class="pill ' + esc(l.level) + '">' + esc(l.level) + '</span>' +
          '<span class="meta">' + esc(new Date(l.createdAt).toLocaleTimeString()) + '</span><div>' + esc(l.message) + '</div></div>';
      }).join('') : '<div class="empty">Пока нет активности агентов</div>') + '</div>';
  }

  async function startGeneration() {
    if (!state.selectedId) return;
    var r = await api('/api/projects/' + encodeURIComponent(state.selectedId) + '/start-generation', {
      method: 'POST', body: JSON.stringify({ maxParallel: 1, maxCycles: 8 })
    });
    state.monitored = true;
    await loadProject(state.selectedId); render();
    toast('Агенты запущены: PID ' + (r.runner && r.runner.pid));
    poll();
  }
  var pollTimer;
  function poll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async function () {
      if (!state.selectedId) return;
      await loadProject(state.selectedId); render();
      var wf = state.workflow;
      if (wf.activeRuns.length || wf.readyTasks.length) poll();
    }, 3000);
  }

  document.getElementById('project-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var fd = Object.fromEntries(new FormData(e.target).entries());
    var auto = fd.autoStart === 'true'; delete fd.autoStart;
    var data = await api('/api/projects', { method: 'POST', body: JSON.stringify(fd) });
    e.target.reset();
    await loadProject(data.project.id);
    await loadState();
    if (auto) await startGeneration(); else toast('Проект создан');
  });
  document.getElementById('refresh').addEventListener('click', function () { loadState().then(function () { toast('Обновлено'); }); });

  document.addEventListener('click', async function (e) {
    var proj = e.target.closest('[data-project]');
    if (proj) { await loadProject(proj.dataset.project); render(); return; }
    if (e.target.id === 'generate') { await startGeneration(); return; }
    if (e.target.id === 'open-ws') {
      await api('/api/projects/' + encodeURIComponent(state.selectedId) + '/open-workspace', { method: 'POST', body: '{}' });
      toast('Папка открыта'); return;
    }
    if (e.target.id === 'copy-ws') {
      await navigator.clipboard.writeText(document.getElementById('ws-path').value);
      toast('Путь скопирован'); return;
    }
  });

  loadState().catch(function (err) {
    document.getElementById('workspace').innerHTML = '<div class="empty">' + esc(err.message) + '</div>';
  });
</script>
</body>
</html>`;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    if ((request.method ?? "GET") === "GET" && url.pathname === "/") {
      send(response, 200, html(), "text/html; charset=utf-8");
      return;
    }

    send(response, 404, "Not found", "text/plain; charset=utf-8");
  } catch (error) {
    sendError(response, 500, error);
  }
}

function start(port: number, attempts = 0) {
  const server = createServer(handleRequest);

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE" && attempts < 20) {
      start(port + 1, attempts + 1);
      return;
    }

    throw error;
  });

  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    const actualPort =
      typeof address === "object" && address ? address.port : port;
    const mode = isDemoMode() ? "DEMO (manual, без токенов)" : "LIVE (реальные субагенты, токены)";
    console.error(`MVP Control Panel UI (Simple): http://127.0.0.1:${actualPort}`);
    console.error(`Режим: ${mode}`);
    console.error(`SQLite: ${databasePath}`);
    if (!isDemoMode() && !process.env.ANTHROPIC_API_KEY) {
      console.error(
        "ВНИМАНИЕ: LIVE-режим без ANTHROPIC_API_KEY — headless-субагенты не смогут авторизоваться. " +
        "Задай ключ или включи MVP_DEMO_MODE=1.",
      );
    }
  });
}

const preferredPort = Number.parseInt(process.env.PORT ?? "4173", 10);
start(Number.isFinite(preferredPort) ? preferredPort : 4173);
