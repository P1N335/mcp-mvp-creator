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
type RunnerProvider = AgentProvider | "auto";

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
  if (value === "auto" || value === "codex" || value === "claude" || value === "manual") {
    return value;
  }

  return "auto";
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

function getState() {
  return {
    ok: true,
    databasePath,
    projectWorkspaceRoot,
    projects: listProjects(),
    currentContext: getCurrentProjectContext(),
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
    sendJson(response, 200, { ok: true, databasePath, projectWorkspaceRoot });
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
      const command = `npm run runner -- --project-id ${projectId} --provider ${provider} --once`;
      const loopCommand = `npm run runner -- --project-id ${projectId} --provider ${provider} --max-parallel 1`;
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
      const provider = runnerProviderFromValue(body.provider);
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
        provider: "auto",
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

function html() {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MVP Control Panel</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f8;
      --panel: #ffffff;
      --panel-soft: #f1f5f4;
      --text: #1e2428;
      --muted: #68737d;
      --line: #d9e0df;
      --teal: #0f766e;
      --teal-soft: #d9f2ee;
      --amber: #a16207;
      --rose: #be123c;
      --indigo: #4338ca;
      --shadow: 0 10px 24px rgba(20, 31, 36, 0.08);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      letter-spacing: 0;
    }

    button, input, textarea, select {
      font: inherit;
    }

    button {
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      cursor: pointer;
    }

    button:hover { border-color: #9fb1ad; }

    button.primary {
      background: var(--teal);
      border-color: var(--teal);
      color: #ffffff;
    }

    button.warn {
      color: var(--amber);
      border-color: #e2c06d;
      background: #fffaf0;
    }

    button.subtle {
      color: var(--muted);
      background: #ffffff;
    }

    input, textarea, select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #ffffff;
      color: var(--text);
      padding: 9px 10px;
      min-height: 36px;
    }

    textarea {
      min-height: 96px;
      resize: vertical;
      line-height: 1.45;
    }

    label {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }

    .check-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .check-row input {
      width: auto;
      min-height: 0;
    }

    .brand-actions {
      display: grid;
      justify-items: end;
      gap: 8px;
    }

    .mode-toggle {
      display: inline-grid;
      grid-template-columns: 1fr 1fr;
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      background: #ffffff;
    }

    .mode-toggle button {
      min-height: 32px;
      border: 0;
      border-radius: 0;
      padding: 0 10px;
      color: var(--muted);
      background: transparent;
    }

    .mode-toggle button.active {
      color: #ffffff;
      background: var(--teal);
      font-weight: 750;
    }

    .app {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 300px minmax(0, 1fr);
    }

    .sidebar {
      border-right: 1px solid var(--line);
      background: #fbfbfa;
      padding: 18px;
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      gap: 18px;
      min-height: 100vh;
    }

    .brand {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .brand h1 {
      margin: 0;
      font-size: 18px;
      line-height: 1.15;
    }

    .db {
      color: var(--muted);
      font-size: 11px;
      word-break: break-all;
    }

    .new-project {
      display: grid;
      gap: 10px;
    }

    .project-list {
      display: grid;
      align-content: start;
      gap: 8px;
      overflow: auto;
    }

    .project-button {
      width: 100%;
      text-align: left;
      min-height: 62px;
      padding: 10px;
      background: #ffffff;
    }

    .project-button.active {
      border-color: var(--teal);
      box-shadow: inset 3px 0 0 var(--teal);
      background: var(--teal-soft);
    }

    .project-name {
      font-weight: 750;
      margin-bottom: 4px;
    }

    .project-idea {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    .main {
      min-width: 0;
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
    }

    .topbar {
      min-height: 76px;
      padding: 18px 24px;
      background: var(--panel);
      border-bottom: 1px solid var(--line);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }

    .topbar h2 {
      margin: 0 0 4px;
      font-size: 22px;
      line-height: 1.2;
    }

    .topbar p {
      margin: 0;
      color: var(--muted);
      line-height: 1.35;
      max-width: 820px;
    }

    .tabs {
      display: flex;
      gap: 6px;
      padding: 10px 24px;
      border-bottom: 1px solid var(--line);
      background: #fbfbfa;
      overflow-x: auto;
    }

    body[data-mode="simple"] .tabs {
      display: none;
    }

    body[data-mode="simple"] .advanced-actions,
    body[data-mode="simple"] .new-project .check-row {
      display: none;
    }

    body[data-mode="simple"] .workspace {
      padding-top: 24px;
    }

    .tab {
      padding: 0 12px;
      white-space: nowrap;
    }

    .tab.active {
      color: var(--teal);
      border-color: var(--teal);
      background: var(--teal-soft);
      font-weight: 700;
    }

    .workspace {
      min-height: 0;
      overflow: auto;
      padding: 20px 24px 28px;
    }

    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.8fr);
      gap: 18px;
      align-items: start;
    }

    .section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 16px;
      margin-bottom: 16px;
    }

    .section h3 {
      margin: 0 0 12px;
      font-size: 15px;
    }

    .form-grid {
      display: grid;
      gap: 12px;
    }

    .two {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }

    .metric-row {
      display: grid;
      grid-template-columns: repeat(5, minmax(96px, 1fr));
      gap: 10px;
    }

    .metric {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-soft);
      padding: 12px;
      min-height: 72px;
    }

    .metric strong {
      display: block;
      font-size: 24px;
      line-height: 1;
      margin-bottom: 8px;
    }

    .metric span {
      color: var(--muted);
      font-size: 12px;
    }

    .item-list {
      display: grid;
      gap: 10px;
    }

    .item {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #ffffff;
      padding: 12px;
    }

    .item-title {
      font-weight: 750;
      margin-bottom: 5px;
    }

    .item-text {
      color: var(--muted);
      line-height: 1.45;
      white-space: pre-wrap;
    }

    .meta {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 10px;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 0 8px;
      border-radius: 999px;
      background: #eef2ff;
      color: var(--indigo);
      font-size: 12px;
      font-weight: 650;
    }

    .pill.high, .pill.critical { background: #ffe4e6; color: var(--rose); }
    .pill.medium { background: #fef3c7; color: var(--amber); }
    .pill.done, .pill.resolved { background: var(--teal-soft); color: var(--teal); }

    .board {
      display: grid;
      grid-template-columns: repeat(4, minmax(180px, 1fr));
      gap: 12px;
    }

    .column {
      min-width: 0;
      background: #f8faf9;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
    }

    .column h4 {
      margin: 0 0 10px;
      font-size: 13px;
      color: var(--muted);
    }

    .task-card {
      background: #ffffff;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      margin-bottom: 8px;
    }

    .release-box {
      min-height: 460px;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
      line-height: 1.45;
    }

    .empty {
      color: var(--muted);
      border: 1px dashed var(--line);
      border-radius: 8px;
      padding: 18px;
      background: #ffffff;
    }

    .simple-shell {
      max-width: 1180px;
      margin: 0 auto;
    }

    .status-panel {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 16px;
      align-items: center;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 18px;
      margin-bottom: 16px;
    }

    .status-title {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0 0 6px;
      font-size: 20px;
      line-height: 1.2;
    }

    .spinner {
      width: 18px;
      height: 18px;
      border: 2px solid #b9d9d4;
      border-top-color: var(--teal);
      border-radius: 50%;
      animation: spin 780ms linear infinite;
      flex: 0 0 auto;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .progress-line {
      height: 8px;
      overflow: hidden;
      border-radius: 999px;
      background: #e6eceb;
    }

    .progress-line span {
      display: block;
      height: 100%;
      width: var(--progress, 0%);
      border-radius: inherit;
      background: var(--teal);
      transition: width 220ms ease;
    }

    .agent-steps {
      display: grid;
      grid-template-columns: repeat(4, minmax(150px, 1fr));
      gap: 10px;
    }

    .agent-step {
      display: grid;
      gap: 8px;
      min-height: 106px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #ffffff;
      padding: 12px;
    }

    .agent-step.running {
      border-color: var(--teal);
      box-shadow: inset 3px 0 0 var(--teal);
    }

    .agent-step.failed {
      border-color: #fecdd3;
      box-shadow: inset 3px 0 0 var(--rose);
    }

    .agent-step.done {
      background: #f1fbf8;
    }

    .live-log {
      max-height: 260px;
      overflow: auto;
    }

    .toast {
      position: fixed;
      right: 18px;
      bottom: 18px;
      min-width: 220px;
      max-width: 420px;
      background: #172026;
      color: #ffffff;
      border-radius: 8px;
      padding: 12px 14px;
      box-shadow: var(--shadow);
      opacity: 0;
      transform: translateY(8px);
      pointer-events: none;
      transition: opacity 120ms ease, transform 120ms ease;
    }

    .toast.show {
      opacity: 1;
      transform: translateY(0);
    }

    @media (max-width: 1100px) {
      .app { grid-template-columns: 1fr; }
      .sidebar { min-height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
      .grid { grid-template-columns: 1fr; }
      .metric-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .board { grid-template-columns: 1fr 1fr; }
      .agent-steps { grid-template-columns: 1fr 1fr; }
    }

    @media (max-width: 680px) {
      .topbar { align-items: flex-start; flex-direction: column; }
      .two { grid-template-columns: 1fr; }
      .board { grid-template-columns: 1fr; }
      .metric-row { grid-template-columns: 1fr; }
      .status-panel { grid-template-columns: 1fr; }
      .agent-steps { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">
        <div>
          <h1>MVP Control Panel</h1>
          <div class="db" id="database-path"></div>
        </div>
        <div class="brand-actions">
          <div class="mode-toggle" aria-label="UI mode">
            <button type="button" data-ui-mode="simple">Simple</button>
            <button type="button" data-ui-mode="advanced">Advanced</button>
          </div>
          <button id="refresh-button" title="Обновить">Refresh</button>
        </div>
      </div>

      <form class="new-project" id="project-form">
        <label>Название
          <input id="project-name" name="name" maxlength="120" required>
        </label>
        <label>Идея
          <textarea id="project-idea" name="idea" maxlength="2000" required></textarea>
        </label>
        <label>Аудитория
          <input id="project-audience" name="targetAudience" maxlength="500">
        </label>
        <label class="check-row">
          <input id="project-auto-start" name="autoStart" type="checkbox" value="true" checked>
          Start agents after create
        </label>
        <button class="primary" type="submit">Create MVP</button>
      </form>

      <div class="project-list" id="project-list"></div>
    </aside>

    <main class="main">
      <header class="topbar" id="topbar"></header>
      <nav class="tabs" id="tabs"></nav>
      <section class="workspace" id="workspace"></section>
    </main>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    const statuses = ["backlog", "in_progress", "review", "done"];
    const statusLabels = {
      backlog: "Backlog",
      in_progress: "In progress",
      review: "Review",
      done: "Done"
    };
    let state = null;
    let selectedProjectId = localStorage.getItem("mvp.selectedProjectId");
    let uiMode = localStorage.getItem("mvp.uiMode") || "simple";
    let activeTab = localStorage.getItem("mvp.activeTab") || "overview";
    if (activeTab === "agents") activeTab = "subagents";
    let selectedSubagentMode = localStorage.getItem("mvp.selectedSubagentMode") || "build";
    let selectedSubagentRoles = (localStorage.getItem("mvp.selectedSubagentRoles") || "backend,frontend,qa,docs")
      .split(",")
      .filter(Boolean);
    let monitoredProjectId = localStorage.getItem("mvp.monitoredProjectId") || null;
    let monitoredSince = Number.parseInt(localStorage.getItem("mvp.monitoredSince") || "0", 10);
    let generationPollTimer = null;
    let quietPolls = 0;

    const els = {
      databasePath: document.getElementById("database-path"),
      projectForm: document.getElementById("project-form"),
      projectList: document.getElementById("project-list"),
      refreshButton: document.getElementById("refresh-button"),
      topbar: document.getElementById("topbar"),
      tabs: document.getElementById("tabs"),
      workspace: document.getElementById("workspace"),
      toast: document.getElementById("toast")
    };

    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function lines(items) {
      return (items || []).join("\\n");
    }

    function toast(message) {
      els.toast.textContent = message;
      els.toast.classList.add("show");
      window.setTimeout(() => els.toast.classList.remove("show"), 1800);
    }

    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {})
        }
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Request failed");
      }
      return data;
    }

    function selectedContext() {
      if (!selectedProjectId) return null;
      const project = state.projects.find((item) => item.id === selectedProjectId);
      if (!project) return null;
      return state.contextCache?.[selectedProjectId] || null;
    }

    async function refreshContext(projectId) {
      if (!projectId) return null;
      const data = await api("/api/projects/" + encodeURIComponent(projectId) + "/context");
      state.contextCache = state.contextCache || {};
      state.contextCache[projectId] = data.context;
      return data.context;
    }

    async function refreshWorkflowState(projectId) {
      if (!projectId) return null;
      const data = await api("/api/projects/" + encodeURIComponent(projectId) + "/workflow-state");
      state.workflowCache = state.workflowCache || {};
      state.workflowCache[projectId] = data.workflowState;
      return data.workflowState;
    }

    function cachedWorkflowState(projectId) {
      return state?.workflowCache?.[projectId] || null;
    }

    function setUiMode(mode) {
      uiMode = mode === "advanced" ? "advanced" : "simple";
      localStorage.setItem("mvp.uiMode", uiMode);
      document.body.dataset.mode = uiMode;
      render();
    }

    function setModeButtons() {
      document.body.dataset.mode = uiMode;
      document.querySelectorAll("[data-ui-mode]").forEach((button) => {
        button.classList.toggle("active", button.dataset.uiMode === uiMode);
      });
    }

    function markGenerationMonitored(projectId) {
      monitoredProjectId = projectId;
      monitoredSince = Date.now();
      quietPolls = 0;
      localStorage.setItem("mvp.monitoredProjectId", monitoredProjectId);
      localStorage.setItem("mvp.monitoredSince", String(monitoredSince));
      startGenerationPolling();
    }

    function clearGenerationMonitor() {
      monitoredProjectId = null;
      monitoredSince = 0;
      quietPolls = 0;
      localStorage.removeItem("mvp.monitoredProjectId");
      localStorage.removeItem("mvp.monitoredSince");
      if (generationPollTimer) {
        window.clearInterval(generationPollTimer);
        generationPollTimer = null;
      }
    }

    function shouldKeepPolling(workflowState, projectId) {
      if (!workflowState) return false;
      if (workflowState.activeRuns.length > 0) {
        quietPolls = 0;
        return true;
      }

      const isFreshMonitor =
        monitoredProjectId === projectId &&
        monitoredSince &&
        Date.now() - monitoredSince < 30 * 60 * 1000;

      if (isFreshMonitor && workflowState.readyTasks.length > 0) {
        quietPolls += 1;
        return quietPolls <= 24;
      }

      return false;
    }

    function monitorActiveWorkflow(projectId, workflowState) {
      if (!workflowState?.activeRuns.length) return;
      if (monitoredProjectId !== projectId) {
        monitoredProjectId = projectId;
        monitoredSince = Date.now();
        localStorage.setItem("mvp.monitoredProjectId", monitoredProjectId);
        localStorage.setItem("mvp.monitoredSince", String(monitoredSince));
      }
      startGenerationPolling();
    }

    function startGenerationPolling() {
      if (generationPollTimer || !monitoredProjectId) return;

      generationPollTimer = window.setInterval(async () => {
        if (!monitoredProjectId) {
          clearGenerationMonitor();
          return;
        }

        try {
          await refreshContext(monitoredProjectId);
          const workflowState = await refreshWorkflowState(monitoredProjectId);
          if (selectedProjectId === monitoredProjectId) await render();
          if (!shouldKeepPolling(workflowState, monitoredProjectId)) clearGenerationMonitor();
        } catch (error) {
          console.error(error);
        }
      }, 2500);
    }

    async function refresh() {
      const data = await api("/api/state");
      const previousCache = state?.contextCache || {};
      const previousWorkflowCache = state?.workflowCache || {};
      state = { ...data, contextCache: previousCache, workflowCache: previousWorkflowCache };
      els.databasePath.textContent = data.databasePath;

      if (!selectedProjectId && data.currentContext) {
        selectedProjectId = data.currentContext.project.id;
      }

      if (!selectedProjectId && data.projects[0]) {
        selectedProjectId = data.projects[0].id;
      }

      if (selectedProjectId && !data.projects.some((project) => project.id === selectedProjectId)) {
        selectedProjectId = data.projects[0]?.id || null;
      }

      if (selectedProjectId) {
        localStorage.setItem("mvp.selectedProjectId", selectedProjectId);
        await refreshContext(selectedProjectId);
      }

      render();
      if (monitoredProjectId) startGenerationPolling();
    }

    function renderProjects() {
      if (!state.projects.length) {
        els.projectList.innerHTML = '<div class="empty">Пока пусто</div>';
        return;
      }

      els.projectList.innerHTML = state.projects.map((project) => \`
        <button class="project-button \${project.id === selectedProjectId ? "active" : ""}" data-project-id="\${escapeHtml(project.id)}">
          <div class="project-name">\${escapeHtml(project.name)}</div>
          <div class="project-idea">\${escapeHtml(project.idea)}</div>
        </button>
      \`).join("");
    }

    function renderTopbar(context) {
      if (!context) {
        els.topbar.innerHTML = '<div><h2>Новый MVP</h2><p>Запишите идею слева.</p></div>';
        return;
      }

      els.topbar.innerHTML = \`
        <div>
          <h2>\${escapeHtml(context.project.name)}</h2>
          <p>\${escapeHtml(context.project.idea)}</p>
        </div>
        <div class="actions">
          <button class="primary" id="generate-mvp-button">Generate MVP</button>
          <div class="actions advanced-actions">
          <button class="warn" id="draft-button">Draft spec</button>
          <button id="workflow-button">Workflow</button>
          <button id="subagents-button">Subagents</button>
          <button id="release-button">Release notes</button>
          </div>
        </div>
      \`;
    }

    function renderTabs(context) {
      if (!context || uiMode === "simple") {
        els.tabs.innerHTML = "";
        return;
      }

      const tabs = [
        ["overview", "Обзор"],
        ["spec", "Spec"],
        ["tasks", "Tasks"],
        ["workflow", "Workflow"],
        ["decisions", "Decisions"],
        ["risks", "Risks"],
        ["subagents", "Subagents"],
        ["release", "Release"]
      ];

      els.tabs.innerHTML = tabs.map(([id, label]) => \`
        <button class="tab \${activeTab === id ? "active" : ""}" data-tab="\${id}">\${label}</button>
      \`).join("");
    }

    function renderOverview(context) {
      const latestSpec = context.specs[0];
      return \`
        <div class="grid">
          <div>
            <section class="section">
              <h3>Состояние</h3>
              <div class="metric-row">
                <div class="metric"><strong>\${context.specs.length}</strong><span>Specs</span></div>
                <div class="metric"><strong>\${context.tasks.length}</strong><span>Tasks</span></div>
                <div class="metric"><strong>\${context.decisions.length}</strong><span>Decisions</span></div>
                <div class="metric"><strong>\${context.risks.length}</strong><span>Risks</span></div>
                <div class="metric"><strong>\${context.tasks.filter((task) => task.status === "done").length}</strong><span>Done</span></div>
              </div>
            </section>
            <section class="section">
              <div class="actions" style="justify-content: space-between; margin-bottom: 10px;">
                <h3 style="margin: 0;">Workspace</h3>
                <div class="actions">
                  <button id="open-workspace-button">Open folder</button>
                  <button id="copy-workspace-button">Copy path</button>
                </div>
              </div>
              <input id="workspace-path-input" value="\${escapeHtml(context.project.workspacePath)}" readonly>
              <div class="item-text" style="margin-top: 8px;">Generated MVP files are written here by Claude and Codex subagents.</div>
            </section>
            <section class="section">
              <h3>Последняя роспись</h3>
              \${latestSpec ? \`
                <div class="item-text">\${escapeHtml(latestSpec.summary)}</div>
                <div class="meta">
                  <span class="pill">\${latestSpec.inScope.length} scope</span>
                  <span class="pill">\${latestSpec.userStories.length} stories</span>
                  <span class="pill medium">\${latestSpec.risks.length} risks</span>
                </div>
              \` : '<div class="empty">Нет spec</div>'}
            </section>
          </div>
          <aside>
            <section class="section">
              <h3>Открытые риски</h3>
              <div class="item-list">
                \${context.risks.filter((risk) => risk.status !== "resolved").slice(0, 5).map(renderRiskItem).join("") || '<div class="empty">Нет открытых рисков</div>'}
              </div>
            </section>
          </aside>
        </div>
      \`;
    }

    const simpleRoles = ["backend", "frontend", "qa", "docs"];
    const simpleRoleLabels = {
      backend: "Backend",
      frontend: "Frontend",
      qa: "QA",
      docs: "Docs"
    };

    function renderSimpleWelcome() {
      return [
        '<div class="simple-shell">',
        '<section class="status-panel">',
        '<div>',
        '<h2 class="status-title">Describe an MVP idea</h2>',
        '<div class="item-text">Use the form on the left. In Simple mode the system drafts the plan, creates the agent workflow, and starts the routed runner automatically.</div>',
        '</div>',
        '</section>',
        '</div>'
      ].join("");
    }

    function latestRunForRole(workflowState, role) {
      return workflowState.recentRuns.find((run) => run.role === role);
    }

    function taskForRole(context, workflowState, role) {
      const assignment = workflowState.assignments.find((item) => item.role === role);
      if (assignment) return context.tasks.find((task) => task.id === assignment.taskId);
      return context.tasks.find((task) => {
        if (role === "qa") return task.type === "test";
        if (role === "docs") return task.type === "docs";
        return task.type === role;
      });
    }

    function simpleStepForRole(context, workflowState, role) {
      const activeRun = workflowState.activeRuns.find((run) => run.role === role);
      const task = taskForRole(context, workflowState, role);
      const latestRun = latestRunForRole(workflowState, role);
      const ready = workflowState.readyTasks.some((readyTask) =>
        readyTask.assignment?.role === role || readyTask.task.id === task?.id
      );

      if (activeRun) return { role, task, provider: activeRun.provider, status: "running", label: "Running" };
      if (task?.status === "done") return { role, task, provider: latestRun?.provider, status: "done", label: "Done" };
      if (latestRun?.status === "failed") return { role, task, provider: latestRun.provider, status: "failed", label: "Needs attention" };
      if (task?.status === "in_progress" || task?.status === "review") {
        return { role, task, provider: latestRun?.provider, status: "running", label: statusLabels[task.status] };
      }
      if (ready) return { role, task, provider: latestRun?.provider, status: "queued", label: "Queued" };
      if (task) return { role, task, provider: latestRun?.provider, status: "waiting", label: "Waiting" };
      return { role, task: null, provider: null, status: "pending", label: "Pending" };
    }

    function renderSimpleStep(step) {
      const title = step.task?.title || simpleRoleLabels[step.role];
      const pillClass = step.status === "done" ? "done" : step.status === "failed" ? "critical" : "";
      return [
        '<div class="agent-step ' + escapeHtml(step.status) + '">',
        '<div class="actions" style="justify-content: space-between;">',
        '<div class="item-title">' + escapeHtml(simpleRoleLabels[step.role]) + '</div>',
        step.status === "running" ? '<span class="spinner"></span>' : "",
        '</div>',
        '<div class="item-text">' + escapeHtml(title) + '</div>',
        '<div class="meta">',
        '<span class="pill ' + pillClass + '">' + escapeHtml(step.label) + '</span>',
        step.provider ? '<span class="pill">' + escapeHtml(step.provider) + '</span>' : "",
        '</div>',
        '</div>'
      ].join("");
    }

    function simpleStatusText(workflowState, steps, isMonitored) {
      const activeRun = workflowState.activeRuns[0];
      if (activeRun) {
        return {
          title: (simpleRoleLabels[activeRun.role] || activeRun.role) + " agent is working",
          text: activeRun.provider + " is running a subagent task. The panel refreshes automatically."
        };
      }

      if (isMonitored && workflowState.readyTasks.length > 0) {
        return {
          title: "Agents are moving through the queue",
          text: "The runner is active and will claim the next ready task shortly."
        };
      }

      if (steps.some((step) => step.status === "failed")) {
        return {
          title: "One agent needs attention",
          text: "Open Advanced mode to inspect the failed run, logs, and prompt output."
        };
      }

      if (steps.every((step) => step.status === "done")) {
        return {
          title: "MVP generation finished",
          text: "The generated product files are in the project workspace."
        };
      }

      if (workflowState.workflows.length > 0) {
        return {
          title: "Ready to continue",
          text: "Click Generate MVP to continue the routed agent workflow."
        };
      }

      return {
        title: "Ready to generate",
        text: "Click Generate MVP to draft the plan, create the workflow, and start the agents."
      };
    }

    async function renderSimple(context) {
      const workflowState = await refreshWorkflowState(context.project.id);
      monitorActiveWorkflow(context.project.id, workflowState);
      const steps = simpleRoles.map((role) => simpleStepForRole(context, workflowState, role));
      const doneCount = steps.filter((step) => step.status === "done").length;
      const progress = Math.round((doneCount / simpleRoles.length) * 100);
      const isMonitored =
        monitoredProjectId === context.project.id &&
        monitoredSince &&
        Date.now() - monitoredSince < 30 * 60 * 1000;
      const isBusy = workflowState.activeRuns.length > 0 || (isMonitored && workflowState.readyTasks.length > 0);
      const status = simpleStatusText(workflowState, steps, isMonitored);
      const latestLogs = workflowState.recentLogs.slice(0, 8);
      const logHtml = latestLogs.map((log) => [
        '<div class="item">',
        '<div class="meta" style="margin-top: 0;">',
        '<span class="pill ' + escapeHtml(log.level) + '">' + escapeHtml(log.level) + '</span>',
        '<span class="pill">' + escapeHtml(new Date(log.createdAt).toLocaleTimeString()) + '</span>',
        '</div>',
        '<div class="item-text" style="margin-top: 8px;">' + escapeHtml(log.message) + '</div>',
        '</div>'
      ].join("")).join("") || '<div class="empty">No agent activity yet</div>';

      els.workspace.innerHTML = [
        '<div class="simple-shell">',
        '<section class="status-panel">',
        '<div>',
        '<h2 class="status-title">' + (isBusy ? '<span class="spinner"></span>' : "") + escapeHtml(status.title) + '</h2>',
        '<div class="item-text">' + escapeHtml(status.text) + '</div>',
        '</div>',
        '<button class="primary" id="generate-mvp-button">' + (workflowState.workflows.length ? "Continue" : "Generate MVP") + '</button>',
        '</section>',
        '<section class="section">',
        '<div class="actions" style="justify-content: space-between; margin-bottom: 12px;">',
        '<h3 style="margin: 0;">Agent progress</h3>',
        '<span class="pill">' + progress + '%</span>',
        '</div>',
        '<div class="progress-line" style="--progress: ' + progress + '%"><span></span></div>',
        '<div class="agent-steps" style="margin-top: 14px;">' + steps.map(renderSimpleStep).join("") + '</div>',
        '</section>',
        '<div class="grid">',
        '<section class="section">',
        '<div class="actions" style="justify-content: space-between; margin-bottom: 10px;">',
        '<h3 style="margin: 0;">Workspace</h3>',
        '<div class="actions">',
        '<button id="open-workspace-button">Open folder</button>',
        '<button id="copy-workspace-button">Copy path</button>',
        '</div>',
        '</div>',
        '<input id="workspace-path-input" value="' + escapeHtml(context.project.workspacePath) + '" readonly>',
        '<div class="item-text" style="margin-top: 8px;">Generated files are written here by the routed subagents.</div>',
        '</section>',
        '<section class="section">',
        '<h3>Live log</h3>',
        '<div class="item-list live-log">' + logHtml + '</div>',
        '</section>',
        '</div>',
        '</div>'
      ].join("");
    }

    function renderSpec(context) {
      const latestSpec = context.specs[0];
      return \`
        <div class="grid">
          <section class="section">
            <h3>MVP spec</h3>
            <form class="form-grid" id="spec-form">
              <label>Summary
                <textarea name="summary" required>\${escapeHtml(latestSpec?.summary || "")}</textarea>
              </label>
              <label>In scope
                <textarea name="inScope">\${escapeHtml(lines(latestSpec?.inScope))}</textarea>
              </label>
              <label>Out of scope
                <textarea name="outOfScope">\${escapeHtml(lines(latestSpec?.outOfScope))}</textarea>
              </label>
              <label>User stories
                <textarea name="userStories">\${escapeHtml(lines(latestSpec?.userStories))}</textarea>
              </label>
              <label>Risks
                <textarea name="risks">\${escapeHtml(lines(latestSpec?.risks))}</textarea>
              </label>
              <div class="actions">
                <button class="primary" type="submit">Save spec</button>
                <button class="warn" type="button" id="draft-spec-button">Draft spec</button>
              </div>
            </form>
          </section>
          <aside class="section">
            <h3>История</h3>
            <div class="item-list">
              \${context.specs.map((spec) => \`
                <div class="item">
                  <div class="item-title">\${escapeHtml(new Date(spec.createdAt).toLocaleString())}</div>
                  <div class="item-text">\${escapeHtml(spec.summary)}</div>
                </div>
              \`).join("") || '<div class="empty">Нет spec</div>'}
            </div>
          </aside>
        </div>
      \`;
    }

    function renderTasks(context) {
      return \`
        <div class="grid">
          <section class="section">
            <h3>Task board</h3>
            <div class="board">
              \${statuses.map((status) => \`
                <div class="column">
                  <h4>\${statusLabels[status]}</h4>
                  \${context.tasks.filter((task) => task.status === status).map(renderTaskCard).join("") || '<div class="empty">Пусто</div>'}
                </div>
              \`).join("")}
            </div>
          </section>
          <aside class="section">
            <h3>Новая задача</h3>
            <form class="form-grid" id="task-form">
              <label>Title
                <input name="title" required>
              </label>
              <label>Description
                <textarea name="description" required></textarea>
              </label>
              <div class="two">
                <label>Type
                  <select name="type">
                    <option value="frontend">frontend</option>
                    <option value="backend">backend</option>
                    <option value="ai">ai</option>
                    <option value="test">test</option>
                    <option value="docs">docs</option>
                    <option value="devops">devops</option>
                  </select>
                </label>
                <label>Priority
                  <select name="priority">
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="low">low</option>
                  </select>
                </label>
              </div>
              <button class="primary" type="submit">Add task</button>
            </form>
          </aside>
        </div>
      \`;
    }

    function renderTaskCard(task) {
      return \`
        <div class="task-card">
          <div class="item-title">\${escapeHtml(task.title)}</div>
          <div class="item-text">\${escapeHtml(task.description)}</div>
          <div class="meta">
            <span class="pill \${escapeHtml(task.priority)}">\${escapeHtml(task.priority)}</span>
            <span class="pill">\${escapeHtml(task.type)}</span>
          </div>
          <label style="margin-top: 10px;">Status
            <select data-task-status="\${escapeHtml(task.id)}">
              \${statuses.map((status) => \`<option value="\${status}" \${status === task.status ? "selected" : ""}>\${statusLabels[status]}</option>\`).join("")}
            </select>
          </label>
        </div>
      \`;
    }

    async function renderWorkflow(context) {
      const data = await api(
        "/api/projects/" + encodeURIComponent(context.project.id) + "/workflow-state"
      );
      const autoRunner = await api(
        "/api/projects/" + encodeURIComponent(context.project.id) + "/runner-command?provider=auto"
      );
      const runner = await api(
        "/api/projects/" + encodeURIComponent(context.project.id) + "/runner-command?provider=codex"
      );
      const claudeRunner = await api(
        "/api/projects/" + encodeURIComponent(context.project.id) + "/runner-command?provider=claude"
      );
      const workflowState = data.workflowState;
      monitorActiveWorkflow(context.project.id, workflowState);
      const tasksById = Object.fromEntries(context.tasks.map((task) => [task.id, task]));
      const roleProviders = workflowState.roleProviders || {};
      const routingRoles = ["backend", "frontend", "qa", "docs"];

      els.workspace.innerHTML = \`
        <div class="grid">
          <section class="section">
            <div class="actions" style="justify-content: space-between; margin-bottom: 12px;">
              <h3 style="margin: 0;">Workflow orchestration</h3>
              <div class="actions">
                <button class="primary" id="create-workflow-button">Create workflow</button>
                <button id="auto-runner-step-button">Run routed task</button>
                <button id="manual-runner-step-button">Manual runner step</button>
              </div>
            </div>
            <div class="metric-row" style="margin-bottom: 14px;">
              <div class="metric"><strong>\${workflowState.workflows.length}</strong><span>Workflows</span></div>
              <div class="metric"><strong>\${workflowState.readyTasks.length}</strong><span>Ready</span></div>
              <div class="metric"><strong>\${workflowState.activeRuns.length}</strong><span>Active runs</span></div>
              <div class="metric"><strong>\${workflowState.dependencies.length}</strong><span>Dependencies</span></div>
              <div class="metric"><strong>\${workflowState.artifacts.length}</strong><span>Artifacts</span></div>
            </div>
            <section style="margin-bottom: 16px;">
              <h3>Ready tasks</h3>
              <div class="item-list">
                \${workflowState.readyTasks.map((ready) => \`
                  <div class="item">
                    <div class="actions" style="justify-content: space-between;">
                      <div>
                        <div class="item-title">\${escapeHtml(ready.task.title)}</div>
                        <div class="item-text">\${escapeHtml(ready.task.description)}</div>
                      </div>
                      <button data-claim-task="\${escapeHtml(ready.task.id)}">Claim</button>
                    </div>
                    <div class="meta">
                      <span class="pill">\${escapeHtml(ready.assignment?.role || ready.task.type)}</span>
                      <span class="pill">\${escapeHtml(roleProviders[ready.assignment?.role || ready.task.type] || "auto")}</span>
                      <span class="pill \${escapeHtml(ready.task.priority)}">\${escapeHtml(ready.task.priority)}</span>
                      <span class="pill">\${ready.dependencies.length} deps</span>
                    </div>
                  </div>
                \`).join("") || '<div class="empty">No ready tasks. Create a workflow or complete blocking tasks.</div>'}
              </div>
            </section>
            <section>
              <h3>Active runs</h3>
              <div class="item-list">
                \${workflowState.activeRuns.map((run) => \`
                  <div class="item">
                    <div class="actions" style="justify-content: space-between;">
                      <div>
                        <div class="item-title">\${escapeHtml(tasksById[run.taskId]?.title || run.taskId)}</div>
                        <div class="item-text">\${escapeHtml(run.role)} via \${escapeHtml(run.provider)} · \${escapeHtml(run.status)}</div>
                      </div>
                      <div class="actions">
                        <button data-complete-task="\${escapeHtml(run.taskId)}" data-run-id="\${escapeHtml(run.id)}">Complete</button>
                        <button data-fail-task="\${escapeHtml(run.taskId)}" data-run-id="\${escapeHtml(run.id)}">Fail</button>
                      </div>
                    </div>
                    <div class="meta">
                      <span class="pill">\${escapeHtml(run.id.slice(0, 8))}</span>
                      <span class="pill">\${escapeHtml(new Date(run.createdAt).toLocaleString())}</span>
                    </div>
                  </div>
                \`).join("") || '<div class="empty">No active runs</div>'}
              </div>
            </section>
          </section>
          <aside>
            <section class="section">
              <h3>Role routing</h3>
              <div class="item-list">
                \${routingRoles.map((role) => \`
                  <div class="item">
                    <div class="actions" style="justify-content: space-between;">
                      <div class="item-title">\${escapeHtml(role)}</div>
                      <span class="pill">\${escapeHtml(roleProviders[role] || "auto")}</span>
                    </div>
                  </div>
                \`).join("")}
              </div>
            </section>
            <section class="section">
              <h3>Runner commands</h3>
              <div class="form-grid">
                <label>Auto routed once
                  <input id="auto-runner-command" value="\${escapeHtml(autoRunner.command)}" readonly>
                </label>
                <label>Auto routed loop
                  <input id="auto-runner-loop-command" value="\${escapeHtml(autoRunner.loopCommand)}" readonly>
                </label>
                <label>Codex once
                  <input id="codex-runner-command" value="\${escapeHtml(runner.command)}" readonly>
                </label>
                <label>Claude once
                  <input id="claude-runner-command" value="\${escapeHtml(claudeRunner.command)}" readonly>
                </label>
                <div class="actions">
                  <button id="copy-auto-runner-button">Copy Auto</button>
                  <button id="copy-codex-runner-button">Copy Codex</button>
                  <button id="copy-claude-runner-button">Copy Claude</button>
                </div>
              </div>
            </section>
            <section class="section">
              <h3>Recent runs</h3>
              <div class="item-list">
                \${workflowState.recentRuns.slice(0, 8).map((run) => \`
                  <div class="item">
                    <div class="item-title">\${escapeHtml(tasksById[run.taskId]?.title || run.taskId)}</div>
                    <div class="item-text">\${escapeHtml(run.role)} · \${escapeHtml(run.provider)} · \${escapeHtml(run.status)}</div>
                    \${run.error ? \`<div class="item-text">\${escapeHtml(run.error)}</div>\` : ""}
                  </div>
                \`).join("") || '<div class="empty">No runs yet</div>'}
              </div>
            </section>
            <section class="section">
              <h3>Latest logs</h3>
              <div class="item-list">
                \${workflowState.recentLogs.slice(0, 8).map((log) => \`
                  <div class="item">
                    <div class="item-title">\${escapeHtml(log.level)}</div>
                    <div class="item-text">\${escapeHtml(log.message)}</div>
                  </div>
                \`).join("") || '<div class="empty">No logs yet</div>'}
              </div>
            </section>
            <section class="section">
              <h3>Artifacts</h3>
              <div class="item-list">
                \${workflowState.artifacts.slice(0, 8).map((artifact) => \`
                  <div class="item">
                    <div class="item-title">\${escapeHtml(artifact.title)}</div>
                    <div class="item-text">\${escapeHtml(artifact.kind)}\${artifact.uri ? " · " + escapeHtml(artifact.uri) : ""}</div>
                  </div>
                \`).join("") || '<div class="empty">No artifacts yet</div>'}
              </div>
            </section>
          </aside>
        </div>
      \`;
    }

    function renderDecisions(context) {
      return \`
        <div class="grid">
          <section class="section">
            <h3>Decisions</h3>
            <div class="item-list">
              \${context.decisions.map(renderDecisionItem).join("") || '<div class="empty">Нет решений</div>'}
            </div>
          </section>
          <aside class="section">
            <h3>Новое решение</h3>
            <form class="form-grid" id="decision-form">
              <label>Title
                <input name="title" required>
              </label>
              <label>Decision
                <textarea name="decision" required></textarea>
              </label>
              <label>Rationale
                <textarea name="rationale"></textarea>
              </label>
              <div class="two">
                <label>Category
                  <select name="category">
                    <option value="product">product</option>
                    <option value="technical">technical</option>
                    <option value="design">design</option>
                    <option value="business">business</option>
                    <option value="process">process</option>
                  </select>
                </label>
                <label>Impact
                  <select name="impact">
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="low">low</option>
                  </select>
                </label>
              </div>
              <label>Owner
                <input name="owner">
              </label>
              <label>Alternatives
                <textarea name="alternatives"></textarea>
              </label>
              <button class="primary" type="submit">Add decision</button>
            </form>
          </aside>
        </div>
      \`;
    }

    function renderDecisionItem(decision) {
      return \`
        <div class="item">
          <div class="item-title">\${escapeHtml(decision.title)}</div>
          <div class="item-text">\${escapeHtml(decision.decision)}</div>
          \${decision.rationale ? \`<div class="item-text">\${escapeHtml(decision.rationale)}</div>\` : ""}
          <div class="meta">
            <span class="pill">\${escapeHtml(decision.category)}</span>
            <span class="pill \${escapeHtml(decision.impact)}">\${escapeHtml(decision.impact)}</span>
            \${decision.owner ? \`<span class="pill">\${escapeHtml(decision.owner)}</span>\` : ""}
          </div>
        </div>
      \`;
    }

    function renderRisks(context) {
      return \`
        <div class="grid">
          <section class="section">
            <h3>Risks</h3>
            <div class="item-list">
              \${context.risks.map(renderRiskItem).join("") || '<div class="empty">Нет рисков</div>'}
            </div>
          </section>
          <aside class="section">
            <h3>Новый риск</h3>
            <form class="form-grid" id="risk-form">
              <label>Title
                <input name="title" required>
              </label>
              <label>Description
                <textarea name="description" required></textarea>
              </label>
              <label>Mitigation
                <textarea name="mitigation"></textarea>
              </label>
              <div class="two">
                <label>Severity
                  <select name="severity">
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="critical">critical</option>
                    <option value="low">low</option>
                  </select>
                </label>
                <label>Status
                  <select name="status">
                    <option value="open">open</option>
                    <option value="mitigating">mitigating</option>
                    <option value="accepted">accepted</option>
                    <option value="resolved">resolved</option>
                  </select>
                </label>
              </div>
              <label>Owner
                <input name="owner">
              </label>
              <button class="primary" type="submit">Add risk</button>
            </form>
          </aside>
        </div>
      \`;
    }

    function renderRiskItem(risk) {
      return \`
        <div class="item">
          <div class="item-title">\${escapeHtml(risk.title)}</div>
          <div class="item-text">\${escapeHtml(risk.description)}</div>
          \${risk.mitigation ? \`<div class="item-text">\${escapeHtml(risk.mitigation)}</div>\` : ""}
          <div class="meta">
            <span class="pill \${escapeHtml(risk.severity)}">\${escapeHtml(risk.severity)}</span>
            <span class="pill \${escapeHtml(risk.status)}">\${escapeHtml(risk.status)}</span>
            \${risk.owner ? \`<span class="pill">\${escapeHtml(risk.owner)}</span>\` : ""}
          </div>
        </div>
      \`;
    }

    function subagentRoleControl(role, label) {
      return \`
        <label style="display: flex; align-items: center; gap: 8px; color: var(--text); font-size: 13px;">
          <input type="checkbox" data-subagent-role="\${role}" \${selectedSubagentRoles.includes(role) ? "checked" : ""} style="width: auto; min-height: auto;">
          \${label}
        </label>
      \`;
    }

    async function renderSubagents(context) {
      const params = new URLSearchParams();
      params.set("mode", selectedSubagentMode);
      selectedSubagentRoles.forEach((role) => params.append("role", role));
      const data = await api(
        "/api/projects/" +
          encodeURIComponent(context.project.id) +
          "/subagent-plan?" +
          params.toString()
      );
      const plan = data.subagentPlan;
      const firstCall = JSON.stringify(plan.recommendedFirstToolCall, null, 2);

      els.workspace.innerHTML = \`
        <div class="grid">
          <section class="section">
            <div class="actions" style="justify-content: space-between; margin-bottom: 12px;">
              <h3 style="margin: 0;">Subagent squad</h3>
              <div class="actions">
                <button id="copy-subagents-all-button">Copy all briefs</button>
                <button id="copy-subagents-first-call-button">Copy MCP call</button>
              </div>
            </div>
            <div class="form-grid" style="margin-bottom: 14px;">
              <label>Mode
                <select id="subagent-mode-select">
                  <option value="build" \${plan.mode === "build" ? "selected" : ""}>Build</option>
                  <option value="plan" \${plan.mode === "plan" ? "selected" : ""}>Plan</option>
                  <option value="review" \${plan.mode === "review" ? "selected" : ""}>Review</option>
                </select>
              </label>
              <div style="border: 1px solid var(--line); border-radius: 8px; background: #f8faf9; padding: 12px;">
                <h3 style="margin-bottom: 10px;">Roles</h3>
                <div class="two">
                  \${subagentRoleControl("orchestrator", "Orchestrator")}
                  \${subagentRoleControl("product", "Product")}
                  \${subagentRoleControl("design", "Design")}
                  \${subagentRoleControl("frontend", "Frontend")}
                  \${subagentRoleControl("backend", "Backend")}
                  \${subagentRoleControl("ai", "AI")}
                  \${subagentRoleControl("qa", "QA")}
                  \${subagentRoleControl("devops", "DevOps")}
                  \${subagentRoleControl("docs", "Docs/Release")}
                </div>
              </div>
            </div>
            <div class="item-list">
              \${plan.briefs.map((brief, index) => \`
                <div class="item">
                  <div class="actions" style="justify-content: space-between; margin-bottom: 10px;">
                    <div>
                      <div class="item-title">\${escapeHtml(brief.title)}</div>
                      <div class="item-text">\${escapeHtml(brief.agentName)} · \${escapeHtml(brief.provider)} · \${escapeHtml(brief.nativeKind)}</div>
                      <div class="item-text">\${escapeHtml(brief.mission)}</div>
                    </div>
                    <div class="actions">
                      <button data-copy-subagent-prompt="\${index}">Copy brief</button>
                      <button data-copy-subagent-command="\${index}">Copy launch</button>
                    </div>
                  </div>
                  <div class="meta">
                    <span class="pill">\${escapeHtml(brief.agentName)}</span>
                    <span class="pill">\${escapeHtml(brief.provider)}</span>
                    <span class="pill">\${escapeHtml(brief.nativeKind)}</span>
                    \${brief.taskTypes.map((type) => \`<span class="pill">\${escapeHtml(type)}</span>\`).join("")}
                    <span class="pill \${brief.relevantTasks.length ? "medium" : ""}">\${brief.relevantTasks.length} tasks</span>
                  </div>
                  <textarea class="release-box" data-subagent-prompt="\${index}" readonly style="min-height: 260px; margin-top: 10px;">\${escapeHtml(brief.prompt)}</textarea>
                  <input data-subagent-command="\${index}" value="\${escapeHtml(brief.launchCommand)}" readonly style="margin-top: 8px;">
                </div>
              \`).join("")}
            </div>
          </section>
          <aside>
            <section class="section">
              <h3>MCP coordination</h3>
              <div class="form-grid">
                <label>Server
                  <input value="\${escapeHtml(plan.mcpServerName)}" readonly>
                </label>
                <label>Project ID
                  <input id="subagents-project-id" value="\${escapeHtml(plan.projectId)}" readonly>
                </label>
                <label>Resource
                  <input id="subagents-resource-uri" value="\${escapeHtml(plan.resourceUri)}" readonly>
                </label>
                <label>First MCP call
                  <textarea id="subagents-first-call" readonly>\${escapeHtml(firstCall)}</textarea>
                </label>
                <textarea id="subagents-combined-prompt" readonly style="display: none;">\${escapeHtml(plan.combinedPrompt)}</textarea>
                <div class="actions">
                  <button id="copy-subagents-resource-button">Copy resource</button>
                </div>
              </div>
            </section>
          </aside>
        </div>
      \`;
    }

    async function renderRelease(context) {
      const data = await api("/api/projects/" + encodeURIComponent(context.project.id) + "/release-notes?includeBacklog=true");
      els.workspace.innerHTML = \`
        <section class="section">
          <div class="actions" style="justify-content: space-between; margin-bottom: 12px;">
            <h3 style="margin: 0;">Release notes</h3>
            <button id="copy-release-button">Copy</button>
          </div>
          <textarea class="release-box" id="release-notes" readonly>\${escapeHtml(data.releaseNotes.markdown)}</textarea>
        </section>
      \`;
    }

    async function renderWorkspace(context) {
      if (!context) {
        els.workspace.innerHTML = renderSimpleWelcome();
        return;
      }

      if (uiMode === "simple") {
        await renderSimple(context);
        return;
      }

      if (activeTab === "overview") els.workspace.innerHTML = renderOverview(context);
      if (activeTab === "spec") els.workspace.innerHTML = renderSpec(context);
      if (activeTab === "tasks") els.workspace.innerHTML = renderTasks(context);
      if (activeTab === "workflow") await renderWorkflow(context);
      if (activeTab === "decisions") els.workspace.innerHTML = renderDecisions(context);
      if (activeTab === "risks") els.workspace.innerHTML = renderRisks(context);
      if (activeTab === "subagents") await renderSubagents(context);
      if (activeTab === "release") await renderRelease(context);
    }

    async function render() {
      const context = selectedContext();
      setModeButtons();
      renderProjects();
      renderTopbar(context);
      renderTabs(context);
      await renderWorkspace(context);
    }

    function formData(form) {
      return Object.fromEntries(new FormData(form).entries());
    }

    async function createDraft() {
      if (!selectedProjectId) return;
      await api("/api/projects/" + encodeURIComponent(selectedProjectId) + "/decompose", { method: "POST", body: "{}" });
      await refreshContext(selectedProjectId);
      activeTab = "spec";
      localStorage.setItem("mvp.activeTab", activeTab);
      render();
      toast("Draft saved");
    }

    async function startGeneration(projectId) {
      const result = await api("/api/projects/" + encodeURIComponent(projectId) + "/start-generation", {
        method: "POST",
        body: JSON.stringify({ maxParallel: 1, maxCycles: 8 })
      });
      markGenerationMonitored(projectId);
      await refreshContext(projectId);
      await refreshWorkflowState(projectId);
      if (uiMode === "advanced") {
        activeTab = "workflow";
        localStorage.setItem("mvp.activeTab", activeTab);
      }
      await render();
      toast("Agents started: " + result.runner.pid);
      window.setTimeout(async () => {
        await refreshContext(projectId);
        await refreshWorkflowState(projectId);
        render();
      }, 3000);
      return result;
    }

    els.projectForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const body = formData(form);
      const shouldAutoStart = body.autoStart === "true";
      delete body.autoStart;
      const data = await api("/api/projects", { method: "POST", body: JSON.stringify(body) });
      selectedProjectId = data.project.id;
      localStorage.setItem("mvp.selectedProjectId", selectedProjectId);
      form.reset();
      await refresh();
      if (shouldAutoStart) {
        await startGeneration(selectedProjectId);
      } else {
        toast("Project created");
      }
    });

    els.refreshButton.addEventListener("click", () => refresh().then(() => toast("Updated")));

    document.addEventListener("click", async (event) => {
      const modeButton = event.target.closest("[data-ui-mode]");
      if (modeButton) {
        setUiMode(modeButton.dataset.uiMode);
        return;
      }

      const projectButton = event.target.closest("[data-project-id]");
      if (projectButton) {
        selectedProjectId = projectButton.dataset.projectId;
        localStorage.setItem("mvp.selectedProjectId", selectedProjectId);
        await refreshContext(selectedProjectId);
        render();
        return;
      }

      const tabButton = event.target.closest("[data-tab]");
      if (tabButton) {
        activeTab = tabButton.dataset.tab;
        localStorage.setItem("mvp.activeTab", activeTab);
        render();
        return;
      }

      if (event.target.id === "draft-button" || event.target.id === "draft-spec-button") {
        await createDraft();
        return;
      }

      if (event.target.id === "generate-mvp-button") {
        const context = selectedContext();
        if (!context) return;
        await startGeneration(context.project.id);
        return;
      }

      if (event.target.id === "workflow-button") {
        activeTab = "workflow";
        localStorage.setItem("mvp.activeTab", activeTab);
        render();
        return;
      }

      if (event.target.id === "open-workspace-button") {
        const context = selectedContext();
        if (!context) return;
        await api("/api/projects/" + encodeURIComponent(context.project.id) + "/open-workspace", {
          method: "POST",
          body: "{}"
        });
        toast("Workspace opened");
        return;
      }

      if (event.target.id === "copy-workspace-button") {
        const input = document.getElementById("workspace-path-input");
        await navigator.clipboard.writeText(input.value);
        toast("Workspace path copied");
        return;
      }

      if (event.target.id === "create-workflow-button") {
        const context = selectedContext();
        if (!context) return;
        await api("/api/projects/" + encodeURIComponent(context.project.id) + "/workflows", {
          method: "POST",
          body: JSON.stringify({
            roles: ["backend", "frontend", "qa", "docs"],
            createMissingTasks: true
          })
        });
        await refreshContext(context.project.id);
        render();
        toast("Workflow created");
        return;
      }

      if (event.target.id === "manual-runner-step-button") {
        const context = selectedContext();
        if (!context) return;
        const result = await api("/api/projects/" + encodeURIComponent(context.project.id) + "/runner-step", {
          method: "POST",
          body: "{}"
        });
        await refreshContext(context.project.id);
        render();
        toast(result.idle ? "No ready tasks" : "Runner step completed");
        return;
      }

      if (event.target.id === "auto-runner-step-button") {
        const context = selectedContext();
        if (!context) return;
        const result = await api("/api/projects/" + encodeURIComponent(context.project.id) + "/runner-process", {
          method: "POST",
          body: JSON.stringify({ provider: "auto", once: true })
        });
        markGenerationMonitored(context.project.id);
        await refreshContext(context.project.id);
        await refreshWorkflowState(context.project.id);
        render();
        toast("Routed runner started: " + result.pid);
        window.setTimeout(async () => {
          await refreshContext(context.project.id);
          await refreshWorkflowState(context.project.id);
          render();
        }, 2000);
        return;
      }

      if (event.target.id === "copy-auto-runner-button") {
        const command = document.getElementById("auto-runner-command");
        await navigator.clipboard.writeText(command.value);
        toast("Auto runner copied");
        return;
      }

      if (event.target.id === "copy-codex-runner-button") {
        const command = document.getElementById("codex-runner-command");
        await navigator.clipboard.writeText(command.value);
        toast("Codex runner copied");
        return;
      }

      if (event.target.id === "copy-claude-runner-button") {
        const command = document.getElementById("claude-runner-command");
        await navigator.clipboard.writeText(command.value);
        toast("Claude runner copied");
        return;
      }

      const claimTaskButton = event.target.closest("[data-claim-task]");
      if (claimTaskButton) {
        await api("/api/tasks/" + encodeURIComponent(claimTaskButton.dataset.claimTask) + "/claim", {
          method: "POST",
          body: JSON.stringify({ provider: "manual", agentLabel: "UI manual run" })
        });
        await refreshContext(selectedProjectId);
        render();
        toast("Task claimed");
        return;
      }

      const completeTaskButton = event.target.closest("[data-complete-task]");
      if (completeTaskButton) {
        await api("/api/tasks/" + encodeURIComponent(completeTaskButton.dataset.completeTask) + "/complete", {
          method: "POST",
          body: JSON.stringify({
            runId: completeTaskButton.dataset.runId,
            summary: "Completed manually from the local UI."
          })
        });
        await refreshContext(selectedProjectId);
        render();
        toast("Task completed");
        return;
      }

      const failTaskButton = event.target.closest("[data-fail-task]");
      if (failTaskButton) {
        await api("/api/tasks/" + encodeURIComponent(failTaskButton.dataset.failTask) + "/fail", {
          method: "POST",
          body: JSON.stringify({
            runId: failTaskButton.dataset.runId,
            error: "Marked failed manually from the local UI."
          })
        });
        await refreshContext(selectedProjectId);
        render();
        toast("Task failed");
        return;
      }

      if (event.target.id === "subagents-button") {
        activeTab = "subagents";
        localStorage.setItem("mvp.activeTab", activeTab);
        render();
        return;
      }

      if (event.target.id === "release-button") {
        activeTab = "release";
        localStorage.setItem("mvp.activeTab", activeTab);
        render();
        return;
      }

      if (event.target.id === "copy-release-button") {
        const releaseNotes = document.getElementById("release-notes");
        await navigator.clipboard.writeText(releaseNotes.value);
        toast("Copied");
      }

      if (event.target.id === "copy-subagents-all-button") {
        const prompt = document.getElementById("subagents-combined-prompt");
        await navigator.clipboard.writeText(prompt.value);
        toast("All briefs copied");
      }

      if (event.target.id === "copy-subagents-resource-button") {
        const resource = document.getElementById("subagents-resource-uri");
        await navigator.clipboard.writeText(resource.value);
        toast("Resource copied");
      }

      if (event.target.id === "copy-subagents-first-call-button") {
        const firstCall = document.getElementById("subagents-first-call");
        await navigator.clipboard.writeText(firstCall.value);
        toast("MCP call copied");
      }

      const subagentPromptButton = event.target.closest("[data-copy-subagent-prompt]");
      if (subagentPromptButton) {
        const prompt = document.querySelector(
          "[data-subagent-prompt='" + subagentPromptButton.dataset.copySubagentPrompt + "']"
        );
        await navigator.clipboard.writeText(prompt.value);
        toast("Brief copied");
        return;
      }

      const subagentCommandButton = event.target.closest("[data-copy-subagent-command]");
      if (subagentCommandButton) {
        const command = document.querySelector(
          "[data-subagent-command='" + subagentCommandButton.dataset.copySubagentCommand + "']"
        );
        await navigator.clipboard.writeText(command.value);
        toast("Command copied");
        return;
      }
    });

    document.addEventListener("change", async (event) => {
      if (event.target.id === "subagent-mode-select") {
        selectedSubagentMode = event.target.value;
        localStorage.setItem("mvp.selectedSubagentMode", selectedSubagentMode);
        render();
        return;
      }

      const roleToggle = event.target.closest("[data-subagent-role]");
      if (roleToggle) {
        const role = roleToggle.dataset.subagentRole;
        if (roleToggle.checked) {
          selectedSubagentRoles = Array.from(new Set([...selectedSubagentRoles, role]));
        } else {
          selectedSubagentRoles = selectedSubagentRoles.filter((item) => item !== role);
        }
        if (!selectedSubagentRoles.length) selectedSubagentRoles = ["orchestrator"];
        localStorage.setItem("mvp.selectedSubagentRoles", selectedSubagentRoles.join(","));
        render();
        return;
      }

      const select = event.target.closest("[data-task-status]");
      if (!select) return;

      await api("/api/tasks/" + encodeURIComponent(select.dataset.taskStatus) + "/status", {
        method: "PATCH",
        body: JSON.stringify({ status: select.value })
      });
      await refreshContext(selectedProjectId);
      render();
      toast("Task updated");
    });

    document.addEventListener("submit", async (event) => {
      const context = selectedContext();
      if (!context) return;

      const id = event.target.id;
      if (!["spec-form", "task-form", "decision-form", "risk-form"].includes(id)) return;
      event.preventDefault();

      const body = formData(event.target);
      const projectPath = "/api/projects/" + encodeURIComponent(context.project.id);
      const endpoints = {
        "spec-form": projectPath + "/spec",
        "task-form": projectPath + "/tasks",
        "decision-form": projectPath + "/decisions",
        "risk-form": projectPath + "/risks"
      };

      await api(endpoints[id], { method: "POST", body: JSON.stringify(body) });
      await refreshContext(context.project.id);
      render();
      toast("Saved");
    });

    refresh().catch((error) => {
      els.workspace.innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>';
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
    console.error(`MVP Control Panel UI: http://127.0.0.1:${actualPort}`);
    console.error(`SQLite: ${databasePath}`);
  });
}

const preferredPort = Number.parseInt(process.env.PORT ?? "4173", 10);
start(Number.isFinite(preferredPort) ? preferredPort : 4173);
