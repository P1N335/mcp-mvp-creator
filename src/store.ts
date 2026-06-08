import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export type ProjectStatus = "draft" | "active" | "done" | "archived";
export type TaskStatus = "backlog" | "in_progress" | "review" | "done";
export type TaskType = "frontend" | "backend" | "ai" | "test" | "docs" | "devops";
export type Priority = "low" | "medium" | "high";
export type DecisionCategory =
  | "product"
  | "technical"
  | "design"
  | "business"
  | "process";
export type DecisionImpact = "low" | "medium" | "high";
export type RiskSeverity = "low" | "medium" | "high" | "critical";
export type RiskStatus = "open" | "mitigating" | "accepted" | "resolved";

export type Project = {
  id: string;
  name: string;
  idea: string;
  targetAudience?: string;
  workspacePath: string;
  status: ProjectStatus;
  createdAt: string;
};

export type MvpSpec = {
  id: string;
  projectId: string;
  summary: string;
  inScope: string[];
  outOfScope: string[];
  userStories: string[];
  risks: string[];
  createdAt: string;
};

export type Task = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  type: TaskType;
  priority: Priority;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
};

export type Decision = {
  id: string;
  projectId: string;
  title: string;
  decision: string;
  category: DecisionCategory;
  impact: DecisionImpact;
  rationale?: string;
  alternatives: string[];
  owner?: string;
  createdAt: string;
};

export type Risk = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  severity: RiskSeverity;
  status: RiskStatus;
  mitigation?: string;
  owner?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectContext = {
  project: Project;
  specs: MvpSpec[];
  tasks: Task[];
  decisions: Decision[];
  risks: Risk[];
};

export type ReleaseNotes = {
  project: Project;
  version?: string;
  generatedAt: string;
  summary: string;
  shipped: Task[];
  inProgress: Task[];
  backlog?: Task[];
  decisions: Decision[];
  openRisks: Risk[];
  specRisks: string[];
  markdown: string;
};

export type AgentTarget = "codex" | "claude";
export type AgentMode = "build" | "plan" | "review";

export type AgentHandoff = {
  agent: AgentTarget;
  mode: AgentMode;
  projectId: string;
  projectName: string;
  resourceUri: string;
  generatedAt: string;
  mcpServerName: string;
  recommendedFirstToolCall: {
    name: string;
    arguments: {
      projectId: string;
    };
  };
  command?: string;
  prompt: string;
};

export type SubagentRole =
  | "orchestrator"
  | "product"
  | "design"
  | "frontend"
  | "backend"
  | "ai"
  | "qa"
  | "devops"
  | "docs";

export type SubagentBrief = {
  role: SubagentRole;
  agentName: string;
  provider: AgentProvider;
  nativeKind: "claude-agent" | "codex-process" | "manual";
  title: string;
  mission: string;
  owns: string[];
  taskTypes: TaskType[];
  relevantTasks: Task[];
  prompt: string;
  launchCommand: string;
  suggestedClaudeCommand?: string;
  suggestedCodexCommand: string;
};

export type NativeClaudeAgentsConfig = Record<
  string,
  {
    description: string;
    prompt: string;
  }
>;

export type SubagentDefinition = {
  role: SubagentRole;
  agentName: string;
  provider: AgentProvider;
  nativeKind: "claude-agent" | "codex-process" | "manual";
  title: string;
  mission: string;
  owns: string[];
  taskTypes: TaskType[];
  description: string;
  systemPrompt: string;
  launchCommand: string;
  suggestedClaudeCommand?: string;
  suggestedCodexCommand: string;
};

export type SubagentPlan = {
  projectId: string;
  projectName: string;
  resourceUri: string;
  generatedAt: string;
  mode: AgentMode;
  mcpServerName: string;
  recommendedFirstToolCall: {
    name: string;
    arguments: {
      projectId: string;
    };
  };
  briefs: SubagentBrief[];
  combinedPrompt: string;
};

export type WorkflowStatus = "draft" | "active" | "paused" | "done";
export type AgentProvider = "codex" | "claude" | "manual";
export type AgentRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
export type AgentLogLevel = "info" | "warning" | "error";
export type ArtifactKind =
  | "code"
  | "doc"
  | "test"
  | "design"
  | "note"
  | "release";

export type Workflow = {
  id: string;
  projectId: string;
  name: string;
  status: WorkflowStatus;
  createdAt: string;
  updatedAt: string;
};

export type AgentProfile = {
  id: string;
  projectId: string;
  role: SubagentRole;
  provider: AgentProvider;
  label: string;
  model?: string;
  command?: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskAssignment = {
  taskId: string;
  projectId: string;
  role: SubagentRole;
  agentProfileId?: string;
  sequence: number;
  createdAt: string;
  updatedAt: string;
};

export type TaskDependency = {
  taskId: string;
  dependsOnTaskId: string;
  createdAt: string;
};

export type AgentRun = {
  id: string;
  projectId: string;
  taskId: string;
  agentProfileId?: string;
  role: SubagentRole;
  provider: AgentProvider;
  status: AgentRunStatus;
  prompt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentLog = {
  id: string;
  runId: string;
  projectId: string;
  taskId?: string;
  level: AgentLogLevel;
  message: string;
  createdAt: string;
};

export type Artifact = {
  id: string;
  projectId: string;
  taskId?: string;
  runId?: string;
  kind: ArtifactKind;
  title: string;
  content?: string;
  uri?: string;
  createdAt: string;
};

export type ReadyTask = {
  task: Task;
  assignment?: TaskAssignment;
  dependencies: TaskDependency[];
  blockedBy: Task[];
};

export type WorkflowState = {
  workflows: Workflow[];
  agentProfiles: AgentProfile[];
  roleProviders: Record<SubagentRole, AgentProvider>;
  assignments: TaskAssignment[];
  dependencies: TaskDependency[];
  readyTasks: ReadyTask[];
  activeRuns: AgentRun[];
  recentRuns: AgentRun[];
  recentLogs: AgentLog[];
  artifacts: Artifact[];
};

export const defaultRoleProviders: Record<SubagentRole, AgentProvider> = {
  orchestrator: "claude",
  product: "claude",
  design: "claude",
  frontend: "claude",
  backend: "claude",
  ai: "claude",
  qa: "codex",
  devops: "codex",
  docs: "codex",
};

export function providerForRole(role: SubagentRole): AgentProvider {
  return defaultRoleProviders[role];
}

const moduleDir = dirname(fileURLToPath(import.meta.url));
export const projectRoot = dirname(moduleDir);

export const databasePath =
  process.env.MVP_CONTROL_PANEL_DB ??
  join(projectRoot, "data", "mvp-control-panel.sqlite");

export const projectWorkspaceRoot =
  process.env.MVP_PROJECTS_DIR ?? join(dirname(projectRoot), "mvp-projects");

mkdirSync(dirname(databasePath), { recursive: true });
mkdirSync(projectWorkspaceRoot, { recursive: true });

const db = new DatabaseSync(databasePath);

function nowIso() {
  return new Date().toISOString();
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];

  if (typeof value !== "string") {
    throw new Error(`Invalid database row: expected string column ${key}`);
  }

  return value;
}

function optionalString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string") return [];

  const parsed: unknown = JSON.parse(value);

  if (!Array.isArray(parsed)) return [];

  return parsed.filter((item): item is string => typeof item === "string");
}

function stringifyStringArray(items: string[]) {
  return JSON.stringify(items);
}

function slugifyProjectName(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return slug || "mvp-project";
}

function projectWorkspacePath(projectId: string, name: string) {
  return join(projectWorkspaceRoot, `${slugifyProjectName(name)}-${projectId.slice(0, 8)}`);
}

export function ensureProjectWorkspace(project: Project) {
  mkdirSync(project.workspacePath, { recursive: true });
  mkdirSync(join(project.workspacePath, "src"), { recursive: true });
  mkdirSync(join(project.workspacePath, "tests"), { recursive: true });
  mkdirSync(join(project.workspacePath, "docs"), { recursive: true });

  const readmePath = join(project.workspacePath, "README.md");
  if (!existsSync(readmePath)) {
    writeFileSync(
      readmePath,
      [
        `# ${project.name}`,
        "",
        project.idea,
        "",
        "## Workspace",
        "",
        "This folder is the generated MVP product workspace.",
        "Subagents should create application code, tests, and docs here.",
        "",
      ].join("\n"),
      "utf8",
    );
  }

  return project.workspacePath;
}

function initializeDatabase() {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      idea TEXT NOT NULL,
      target_audience TEXT,
      workspace_path TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mvp_specs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      in_scope TEXT NOT NULL,
      out_of_scope TEXT NOT NULL,
      user_stories TEXT NOT NULL,
      risks TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      type TEXT NOT NULL,
      priority TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      decision TEXT NOT NULL,
      category TEXT NOT NULL,
      impact TEXT NOT NULL,
      rationale TEXT,
      alternatives TEXT NOT NULL,
      owner TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS risks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      mitigation TEXT,
      owner TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_profiles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      provider TEXT NOT NULL,
      label TEXT NOT NULL,
      model TEXT,
      command TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_assignments (
      task_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      agent_profile_id TEXT,
      sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_profile_id) REFERENCES agent_profiles(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id TEXT NOT NULL,
      depends_on_task_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (task_id, depends_on_task_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      agent_profile_id TEXT,
      role TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      prompt TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_profile_id) REFERENCES agent_profiles(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS run_logs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      task_id TEXT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT,
      run_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      uri TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_specs_project_id ON mvp_specs(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_decisions_project_id ON decisions(project_id);
    CREATE INDEX IF NOT EXISTS idx_risks_project_id ON risks(project_id);
    CREATE INDEX IF NOT EXISTS idx_workflows_project_id ON workflows(project_id);
    CREATE INDEX IF NOT EXISTS idx_agent_profiles_project_id ON agent_profiles(project_id);
    CREATE INDEX IF NOT EXISTS idx_task_assignments_project_id ON task_assignments(project_id);
    CREATE INDEX IF NOT EXISTS idx_task_dependencies_task_id ON task_dependencies(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on ON task_dependencies(depends_on_task_id);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_project_id ON agent_runs(project_id);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_task_id ON agent_runs(task_id);
    CREATE INDEX IF NOT EXISTS idx_run_logs_run_id ON run_logs(run_id);
    CREATE INDEX IF NOT EXISTS idx_artifacts_project_id ON artifacts(project_id);
  `);
  ensureProjectWorkspaceColumn();
}

function ensureProjectWorkspaceColumn() {
  const columns = db
    .prepare("PRAGMA table_info(projects)")
    .all()
    .map((row) => optionalString(row, "name"))
    .filter(Boolean);

  if (!columns.includes("workspace_path")) {
    db.exec("ALTER TABLE projects ADD COLUMN workspace_path TEXT");
  }
}

function projectFromRow(row: Record<string, unknown>): Project {
  const id = requiredString(row, "id");
  const name = requiredString(row, "name");

  return {
    id,
    name,
    idea: requiredString(row, "idea"),
    targetAudience: optionalString(row, "target_audience"),
    workspacePath: optionalString(row, "workspace_path") ?? projectWorkspacePath(id, name),
    status: requiredString(row, "status") as ProjectStatus,
    createdAt: requiredString(row, "created_at"),
  };
}

function specFromRow(row: Record<string, unknown>): MvpSpec {
  return {
    id: requiredString(row, "id"),
    projectId: requiredString(row, "project_id"),
    summary: requiredString(row, "summary"),
    inScope: parseStringArray(row.in_scope),
    outOfScope: parseStringArray(row.out_of_scope),
    userStories: parseStringArray(row.user_stories),
    risks: parseStringArray(row.risks),
    createdAt: requiredString(row, "created_at"),
  };
}

function taskFromRow(row: Record<string, unknown>): Task {
  return {
    id: requiredString(row, "id"),
    projectId: requiredString(row, "project_id"),
    title: requiredString(row, "title"),
    description: requiredString(row, "description"),
    type: requiredString(row, "type") as TaskType,
    priority: requiredString(row, "priority") as Priority,
    status: requiredString(row, "status") as TaskStatus,
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}

function decisionFromRow(row: Record<string, unknown>): Decision {
  return {
    id: requiredString(row, "id"),
    projectId: requiredString(row, "project_id"),
    title: requiredString(row, "title"),
    decision: requiredString(row, "decision"),
    category: requiredString(row, "category") as DecisionCategory,
    impact: requiredString(row, "impact") as DecisionImpact,
    rationale: optionalString(row, "rationale"),
    alternatives: parseStringArray(row.alternatives),
    owner: optionalString(row, "owner"),
    createdAt: requiredString(row, "created_at"),
  };
}

function riskFromRow(row: Record<string, unknown>): Risk {
  return {
    id: requiredString(row, "id"),
    projectId: requiredString(row, "project_id"),
    title: requiredString(row, "title"),
    description: requiredString(row, "description"),
    severity: requiredString(row, "severity") as RiskSeverity,
    status: requiredString(row, "status") as RiskStatus,
    mitigation: optionalString(row, "mitigation"),
    owner: optionalString(row, "owner"),
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}

function optionalNumber(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "number" ? value : undefined;
}

function requiredNumber(row: Record<string, unknown>, key: string): number {
  const value = optionalNumber(row, key);

  if (typeof value !== "number") {
    throw new Error(`Invalid database row: expected number column ${key}`);
  }

  return value;
}

function workflowFromRow(row: Record<string, unknown>): Workflow {
  return {
    id: requiredString(row, "id"),
    projectId: requiredString(row, "project_id"),
    name: requiredString(row, "name"),
    status: requiredString(row, "status") as WorkflowStatus,
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}

function agentProfileFromRow(row: Record<string, unknown>): AgentProfile {
  return {
    id: requiredString(row, "id"),
    projectId: requiredString(row, "project_id"),
    role: requiredString(row, "role") as SubagentRole,
    provider: requiredString(row, "provider") as AgentProvider,
    label: requiredString(row, "label"),
    model: optionalString(row, "model"),
    command: optionalString(row, "command"),
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}

function taskAssignmentFromRow(row: Record<string, unknown>): TaskAssignment {
  return {
    taskId: requiredString(row, "task_id"),
    projectId: requiredString(row, "project_id"),
    role: requiredString(row, "role") as SubagentRole,
    agentProfileId: optionalString(row, "agent_profile_id"),
    sequence: requiredNumber(row, "sequence"),
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}

function taskDependencyFromRow(row: Record<string, unknown>): TaskDependency {
  return {
    taskId: requiredString(row, "task_id"),
    dependsOnTaskId: requiredString(row, "depends_on_task_id"),
    createdAt: requiredString(row, "created_at"),
  };
}

function agentRunFromRow(row: Record<string, unknown>): AgentRun {
  return {
    id: requiredString(row, "id"),
    projectId: requiredString(row, "project_id"),
    taskId: requiredString(row, "task_id"),
    agentProfileId: optionalString(row, "agent_profile_id"),
    role: requiredString(row, "role") as SubagentRole,
    provider: requiredString(row, "provider") as AgentProvider,
    status: requiredString(row, "status") as AgentRunStatus,
    prompt: requiredString(row, "prompt"),
    startedAt: optionalString(row, "started_at"),
    completedAt: optionalString(row, "completed_at"),
    error: optionalString(row, "error"),
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}

function agentLogFromRow(row: Record<string, unknown>): AgentLog {
  return {
    id: requiredString(row, "id"),
    runId: requiredString(row, "run_id"),
    projectId: requiredString(row, "project_id"),
    taskId: optionalString(row, "task_id"),
    level: requiredString(row, "level") as AgentLogLevel,
    message: requiredString(row, "message"),
    createdAt: requiredString(row, "created_at"),
  };
}

function artifactFromRow(row: Record<string, unknown>): Artifact {
  return {
    id: requiredString(row, "id"),
    projectId: requiredString(row, "project_id"),
    taskId: optionalString(row, "task_id"),
    runId: optionalString(row, "run_id"),
    kind: requiredString(row, "kind") as ArtifactKind,
    title: requiredString(row, "title"),
    content: optionalString(row, "content"),
    uri: optionalString(row, "uri"),
    createdAt: requiredString(row, "created_at"),
  };
}

export function listProjects(status?: ProjectStatus): Project[] {
  const rows = status
    ? db
        .prepare(
          "SELECT id, name, idea, target_audience, workspace_path, status, created_at FROM projects WHERE status = ? ORDER BY created_at DESC",
        )
        .all(status)
    : db
        .prepare(
          "SELECT id, name, idea, target_audience, workspace_path, status, created_at FROM projects ORDER BY created_at DESC",
        )
        .all();

  return rows.map(projectFromRow);
}

export function getCurrentProjectId() {
  const row = db
    .prepare("SELECT value FROM meta WHERE key = ?")
    .get("currentProjectId");

  return row && typeof row.value === "string" ? row.value : null;
}

export function saveCurrentProjectId(projectId: string) {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run("currentProjectId", projectId);
}

export function getProjectOrError(projectId: string): Project {
  const row = db
    .prepare(
      "SELECT id, name, idea, target_audience, workspace_path, status, created_at FROM projects WHERE id = ?",
    )
    .get(projectId);

  if (!row) {
    throw new Error(`Project not found: ${projectId}`);
  }

  return projectFromRow(row);
}

export function getProjectContext(projectId: string): ProjectContext {
  const project = getProjectOrError(projectId);
  const specs = db
    .prepare(
      "SELECT id, project_id, summary, in_scope, out_of_scope, user_stories, risks, created_at FROM mvp_specs WHERE project_id = ? ORDER BY created_at DESC",
    )
    .all(projectId)
    .map(specFromRow);
  const tasks = db
    .prepare(
      "SELECT id, project_id, title, description, type, priority, status, created_at, updated_at FROM tasks WHERE project_id = ? ORDER BY created_at ASC",
    )
    .all(projectId)
    .map(taskFromRow);
  const decisions = db
    .prepare(
      "SELECT id, project_id, title, decision, category, impact, rationale, alternatives, owner, created_at FROM decisions WHERE project_id = ? ORDER BY created_at DESC",
    )
    .all(projectId)
    .map(decisionFromRow);
  const risks = db
    .prepare(
      "SELECT id, project_id, title, description, severity, status, mitigation, owner, created_at, updated_at FROM risks WHERE project_id = ? ORDER BY created_at DESC",
    )
    .all(projectId)
    .map(riskFromRow);

  return { project, specs, tasks, decisions, risks };
}

export function getCurrentProjectContext() {
  const projectId = getCurrentProjectId();

  if (!projectId) return null;

  try {
    return getProjectContext(projectId);
  } catch {
    return null;
  }
}

export function createProject(input: {
  name: string;
  idea: string;
  targetAudience?: string;
  workspacePath?: string;
}): Project {
  const id = randomUUID();
  const project: Project = {
    id,
    name: input.name,
    idea: input.idea,
    targetAudience: input.targetAudience,
    workspacePath: input.workspacePath ?? projectWorkspacePath(id, input.name),
    status: "draft",
    createdAt: nowIso(),
  };

  ensureProjectWorkspace(project);

  db.prepare(
    "INSERT INTO projects (id, name, idea, target_audience, workspace_path, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    project.id,
    project.name,
    project.idea,
    project.targetAudience ?? null,
    project.workspacePath,
    project.status,
    project.createdAt,
  );
  saveCurrentProjectId(project.id);

  return project;
}

export function createMvpSpec(input: {
  projectId: string;
  summary: string;
  inScope: string[];
  outOfScope?: string[];
  userStories?: string[];
  risks?: string[];
}): MvpSpec {
  getProjectOrError(input.projectId);

  const spec: MvpSpec = {
    id: randomUUID(),
    projectId: input.projectId,
    summary: input.summary,
    inScope: input.inScope,
    outOfScope: input.outOfScope ?? [],
    userStories: input.userStories ?? [],
    risks: input.risks ?? [],
    createdAt: nowIso(),
  };

  db.prepare(
    `
      INSERT INTO mvp_specs (
        id, project_id, summary, in_scope, out_of_scope, user_stories, risks, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    spec.id,
    spec.projectId,
    spec.summary,
    stringifyStringArray(spec.inScope),
    stringifyStringArray(spec.outOfScope),
    stringifyStringArray(spec.userStories),
    stringifyStringArray(spec.risks),
    spec.createdAt,
  );

  return spec;
}

export function createTask(input: {
  projectId: string;
  title: string;
  description: string;
  type: TaskType;
  priority?: Priority;
}): Task {
  getProjectOrError(input.projectId);
  const createdAt = nowIso();
  const task: Task = {
    id: randomUUID(),
    projectId: input.projectId,
    title: input.title,
    description: input.description,
    type: input.type,
    priority: input.priority ?? "medium",
    status: "backlog",
    createdAt,
    updatedAt: createdAt,
  };

  db.prepare(
    `
      INSERT INTO tasks (
        id, project_id, title, description, type, priority, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    task.id,
    task.projectId,
    task.title,
    task.description,
    task.type,
    task.priority,
    task.status,
    task.createdAt,
    task.updatedAt,
  );

  return task;
}

export function updateTaskStatus(taskId: string, status: TaskStatus) {
  const row = db
    .prepare(
      "SELECT id, project_id, title, description, type, priority, status, created_at, updated_at FROM tasks WHERE id = ?",
    )
    .get(taskId);

  if (!row) return null;

  const task = taskFromRow(row);
  const oldStatus = task.status;
  const changedAt = nowIso();
  task.status = status;
  task.updatedAt = changedAt;

  db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run(
    task.status,
    task.updatedAt,
    task.id,
  );

  return {
    task,
    audit: {
      taskId,
      oldStatus,
      newStatus: status,
      changedAt,
    },
  };
}

export function addDecision(input: {
  projectId: string;
  title: string;
  decision: string;
  category?: DecisionCategory;
  impact?: DecisionImpact;
  rationale?: string;
  alternatives?: string[];
  owner?: string;
}): Decision {
  getProjectOrError(input.projectId);

  const decision: Decision = {
    id: randomUUID(),
    projectId: input.projectId,
    title: input.title,
    decision: input.decision,
    category: input.category ?? "product",
    impact: input.impact ?? "medium",
    rationale: input.rationale,
    alternatives: input.alternatives ?? [],
    owner: input.owner,
    createdAt: nowIso(),
  };

  db.prepare(
    `
      INSERT INTO decisions (
        id, project_id, title, decision, category, impact, rationale, alternatives, owner, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    decision.id,
    decision.projectId,
    decision.title,
    decision.decision,
    decision.category,
    decision.impact,
    decision.rationale ?? null,
    stringifyStringArray(decision.alternatives),
    decision.owner ?? null,
    decision.createdAt,
  );

  return decision;
}

export function addRisk(input: {
  projectId: string;
  title: string;
  description: string;
  severity?: RiskSeverity;
  status?: RiskStatus;
  mitigation?: string;
  owner?: string;
}): Risk {
  getProjectOrError(input.projectId);
  const createdAt = nowIso();
  const risk: Risk = {
    id: randomUUID(),
    projectId: input.projectId,
    title: input.title,
    description: input.description,
    severity: input.severity ?? "medium",
    status: input.status ?? "open",
    mitigation: input.mitigation,
    owner: input.owner,
    createdAt,
    updatedAt: createdAt,
  };

  db.prepare(
    `
      INSERT INTO risks (
        id, project_id, title, description, severity, status, mitigation, owner, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    risk.id,
    risk.projectId,
    risk.title,
    risk.description,
    risk.severity,
    risk.status,
    risk.mitigation ?? null,
    risk.owner ?? null,
    risk.createdAt,
    risk.updatedAt,
  );

  return risk;
}

function formatTaskForRelease(task: Task) {
  return `- ${task.title} (${task.type}, ${task.priority}, ${task.status})`;
}

function formatDecisionForRelease(decision: Decision) {
  return `- ${decision.title}: ${decision.decision} (${decision.category}, impact: ${decision.impact})`;
}

function formatRiskForRelease(risk: Risk) {
  return `- ${risk.title}: ${risk.description} (${risk.severity}, ${risk.status})`;
}

function formatList(items: string[], emptyText = "- None") {
  return items.length > 0 ? items.join("\n") : emptyText;
}

export function buildReleaseNotes(
  projectId: string,
  version: string | undefined,
  includeBacklog: boolean,
): ReleaseNotes {
  const context = getProjectContext(projectId);
  const latestSpec = context.specs[0];
  const doneTasks = context.tasks
    .filter((task) => task.status === "done")
    .map(formatTaskForRelease);
  const activeTasks = context.tasks
    .filter((task) => task.status === "in_progress" || task.status === "review")
    .map(formatTaskForRelease);
  const backlogTasks = context.tasks
    .filter((task) => task.status === "backlog")
    .map(formatTaskForRelease);
  const unresolvedRisks = context.risks
    .filter((risk) => risk.status !== "resolved")
    .map(formatRiskForRelease);
  const decisionItems = context.decisions.map(formatDecisionForRelease);
  const specRiskItems = latestSpec?.risks.map((risk) => `- ${risk}`) ?? [];
  const generatedAt = nowIso();

  const markdown = [
    `# ${context.project.name}${version ? ` ${version}` : ""} Release Notes`,
    "",
    `Generated: ${generatedAt}`,
    "",
    "## MVP Summary",
    latestSpec?.summary ?? context.project.idea,
    "",
    "## Shipped",
    formatList(doneTasks),
    "",
    "## In Progress",
    formatList(activeTasks),
    "",
    "## Key Decisions",
    formatList(decisionItems),
    "",
    "## Open Risks",
    formatList([...unresolvedRisks, ...specRiskItems]),
  ];

  if (includeBacklog) {
    markdown.push("", "## Planned Backlog", formatList(backlogTasks));
  }

  return {
    project: context.project,
    version,
    generatedAt,
    summary: latestSpec?.summary ?? context.project.idea,
    shipped: context.tasks.filter((task) => task.status === "done"),
    inProgress: context.tasks.filter(
      (task) => task.status === "in_progress" || task.status === "review",
    ),
    backlog: includeBacklog
      ? context.tasks.filter((task) => task.status === "backlog")
      : undefined,
    decisions: context.decisions,
    openRisks: context.risks.filter((risk) => risk.status !== "resolved"),
    specRisks: latestSpec?.risks ?? [],
    markdown: markdown.join("\n"),
  };
}

function summarizeTasksForHandoff(tasks: Task[]) {
  const groups: Record<TaskStatus, Task[]> = {
    backlog: [],
    in_progress: [],
    review: [],
    done: [],
  };

  for (const task of tasks) {
    groups[task.status].push(task);
  }

  return Object.entries(groups)
    .map(([status, statusTasks]) => {
      const items = statusTasks
        .slice(0, 8)
        .map((task) => `- ${task.title} (${task.type}, ${task.priority})`)
        .join("\n");
      return `### ${status}\n${items || "- None"}`;
    })
    .join("\n\n");
}

function modeInstruction(mode: AgentMode) {
  if (mode === "plan") {
    return "Produce a concise implementation plan, identify the next 3-5 tasks, and record important scope decisions or risks through MCP tools.";
  }

  if (mode === "review") {
    return "Review the current MVP context for gaps, risky assumptions, stale tasks, and missing release-readiness work. Record findings as risks or decisions when useful.";
  }

  return "Continue building the MVP. Pick the highest-leverage unfinished task, implement or specify the next concrete step, update task statuses, and add decisions/risks when you learn something important.";
}

export function buildAgentHandoff(input: {
  projectId: string;
  agent: AgentTarget;
  mode?: AgentMode;
}): AgentHandoff {
  const mode = input.mode ?? "build";
  const context = getProjectContext(input.projectId);
  const latestSpec = context.specs[0];
  const resourceUri = `project://${context.project.id}/context`;
  const generatedAt = nowIso();
  const openRisks = context.risks.filter((risk) => risk.status !== "resolved");
  const unfinishedTasks = context.tasks.filter((task) => task.status !== "done");
  const agentName = input.agent === "codex" ? "Codex" : "Claude";
  const command =
    input.agent === "codex"
      ? `codex -C ${context.project.workspacePath}`
      : undefined;

  const prompt = `
You are ${agentName}, working as an MVP product/build agent.

Use the MCP server named "mvp-control-panel" as your source of truth.

Project:
- Name: ${context.project.name}
- ID: ${context.project.id}
- Context resource: ${resourceUri}
- Product workspace: ${context.project.workspacePath}
- Target audience: ${context.project.targetAudience ?? "Not specified"}

First MCP action:
Call get_project_context with:
${JSON.stringify({ projectId: context.project.id }, null, 2)}

Goal:
${modeInstruction(mode)}

Current MVP summary:
${latestSpec?.summary ?? context.project.idea}

Task board:
${summarizeTasksForHandoff(context.tasks)}

Key decisions:
${formatList(context.decisions.slice(0, 8).map(formatDecisionForRelease))}

Open risks:
${formatList([
  ...openRisks.slice(0, 8).map(formatRiskForRelease),
  ...(latestSpec?.risks.map((risk) => `- ${risk}`) ?? []),
])}

Operating rules:
- Keep the MVP small and concrete.
- Use add_decision for material product or technical choices.
- Use add_risk for delivery, product, technical, or business risks.
- Use create_task for new implementation work.
- Use update_task_status when task state changes.
- Use generate_release_notes when you need a release summary.
- If the local UI is running, the human-facing panel is at http://127.0.0.1:4173.

Return your next action and the reasoning briefly before doing substantial work.
  `.trim();

  return {
    agent: input.agent,
    mode,
    projectId: context.project.id,
    projectName: context.project.name,
    resourceUri,
    generatedAt,
    mcpServerName: "mvp-control-panel",
    recommendedFirstToolCall: {
      name: "get_project_context",
      arguments: {
        projectId: context.project.id,
      },
    },
    command,
    prompt,
  };
}

const defaultSubagentRoles: SubagentRole[] = [
  "orchestrator",
  "design",
  "frontend",
  "backend",
  "qa",
];

const defaultWorkflowRoles: SubagentRole[] = ["backend", "frontend", "qa", "docs"];

const subagentProfiles: Record<
  SubagentRole,
  {
    title: string;
    mission: string;
    owns: string[];
    taskTypes: TaskType[];
  }
> = {
  orchestrator: {
    title: "Orchestrator",
    mission:
      "Coordinate the parallel MVP squad, keep scope small, assign next work, and maintain project truth in MCP.",
    owns: [
      "MVP scope and sequencing",
      "Cross-agent task assignment",
      "Decision/risk hygiene",
      "Release readiness",
    ],
    taskTypes: ["docs", "test", "devops"],
  },
  product: {
    title: "Product",
    mission:
      "Clarify the target user, MVP promise, user stories, acceptance criteria, and v2 boundaries.",
    owns: [
      "User journey",
      "Problem/value framing",
      "Scope tradeoffs",
      "Acceptance criteria",
    ],
    taskTypes: ["docs"],
  },
  design: {
    title: "Design",
    mission:
      "Shape the UX, screen structure, interaction details, visual hierarchy, and UI copy for a focused MVP.",
    owns: [
      "Information architecture",
      "Screen flows",
      "Component states",
      "Usability risks",
    ],
    taskTypes: ["frontend", "docs"],
  },
  frontend: {
    title: "Frontend",
    mission:
      "Build the client-side experience, connect UI state to APIs, and keep the interface usable across viewports.",
    owns: [
      "Screens and components",
      "Client-side state",
      "Accessibility basics",
      "Browser smoke checks",
    ],
    taskTypes: ["frontend"],
  },
  backend: {
    title: "Backend",
    mission:
      "Build the server/API/data model layer and make sure the MVP has reliable persistence and contracts.",
    owns: [
      "API routes and schemas",
      "Database model",
      "Validation",
      "Service boundaries",
    ],
    taskTypes: ["backend", "devops"],
  },
  ai: {
    title: "AI",
    mission:
      "Design prompts, tool-use flows, agent coordination behavior, and evaluation checks for AI-backed features.",
    owns: [
      "Prompt contracts",
      "Tool orchestration",
      "AI-specific risks",
      "Evaluation criteria",
    ],
    taskTypes: ["ai"],
  },
  qa: {
    title: "QA",
    mission:
      "Find breakage before users do, define the lean test plan, and verify the core MVP workflow.",
    owns: [
      "Smoke tests",
      "Regression checks",
      "Edge cases",
      "Release blockers",
    ],
    taskTypes: ["test"],
  },
  devops: {
    title: "DevOps",
    mission:
      "Keep local setup, scripts, runtime configuration, and deployment path simple and repeatable.",
    owns: [
      "Run scripts",
      "Environment config",
      "Local/production parity",
      "Operational risks",
    ],
    taskTypes: ["devops", "backend"],
  },
  docs: {
    title: "Docs/Release",
    mission:
      "Capture implementation notes, handoff context, release notes, and user-facing setup instructions.",
    owns: [
      "README/setup notes",
      "Release notes",
      "Agent handoff docs",
      "Decision summaries",
    ],
    taskTypes: ["docs"],
  },
};

function taskMatchesRole(task: Task, role: SubagentRole) {
  const profile = subagentProfiles[role];

  if (profile.taskTypes.includes(task.type)) return true;
  if (role === "orchestrator" && task.status !== "done") return true;
  if (role === "design" && task.title.toLowerCase().includes("ui")) return true;

  return false;
}

function subagentAgentName(role: SubagentRole) {
  return `${role}-agent`;
}

function nativeKindForProvider(provider: AgentProvider) {
  if (provider === "claude") return "claude-agent";
  if (provider === "codex") return "codex-process";
  return "manual";
}

function buildSubagentSystemPrompt(role: SubagentRole) {
  const profile = subagentProfiles[role];

  return `
You are ${subagentAgentName(role)}, the ${profile.title} subagent in an MVP delivery squad.

Mission:
${profile.mission}

Ownership boundaries:
${profile.owns.map((item) => `- ${item}`).join("\n")}

Operating rules:
- Work only inside your role unless the orchestrator or task brief explicitly asks otherwise.
- Coordinate through the mvp-control-panel MCP server.
- Read project context before making changes.
- Record important choices with add_decision and uncertainty with add_risk.
- Do not overwrite unrelated work from other subagents.
- Finish by updating task state through complete_task or fail_task.
  `.trim();
}

function shellSafeCommand(command: string) {
  return command.includes(" ") ? `"${command}"` : command;
}

export function buildSubagentDefinition(input: {
  role: SubagentRole;
  projectId?: string;
  workspacePath?: string;
  provider?: AgentProvider;
}): SubagentDefinition {
  const provider = input.provider ?? providerForRole(input.role);
  const profile = subagentProfiles[input.role];
  const agentName = subagentAgentName(input.role);
  const workspacePath = input.workspacePath ?? (input.projectId ? getProjectOrError(input.projectId).workspacePath : projectRoot);
  const systemPrompt = buildSubagentSystemPrompt(input.role);
  const description = `${profile.title} subagent for MVP ${profile.taskTypes.join(", ")} work.`;
  const safeWorkspacePath = shellSafeCommand(workspacePath);
  const claudeCommand = `claude --permission-mode bypassPermissions --add-dir ${safeWorkspacePath} --agents <generated> --agent ${agentName} -p -`;
  const codexCommand = `codex exec -C ${safeWorkspacePath} --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -`;
  const launchCommand =
    provider === "claude"
      ? claudeCommand
      : provider === "codex"
        ? codexCommand
        : "manual";

  return {
    role: input.role,
    agentName,
    provider,
    nativeKind: nativeKindForProvider(provider),
    title: profile.title,
    mission: profile.mission,
    owns: profile.owns,
    taskTypes: profile.taskTypes,
    description,
    systemPrompt,
    launchCommand,
    suggestedClaudeCommand: provider === "claude" ? claudeCommand : undefined,
    suggestedCodexCommand: codexCommand,
  };
}

export function buildSubagentDefinitions(input?: {
  roles?: SubagentRole[];
  providers?: Partial<Record<SubagentRole, AgentProvider>>;
}) {
  const roles = input?.roles?.length ? input.roles : defaultWorkflowRoles;

  return roles.map((role) =>
    buildSubagentDefinition({
      role,
      provider: input?.providers?.[role] ?? providerForRole(role),
    }),
  );
}

export function buildNativeClaudeAgentsConfig(roles: SubagentRole[]) {
  const config: NativeClaudeAgentsConfig = {};

  for (const role of roles) {
    const definition = buildSubagentDefinition({
      role,
      provider: "claude",
    });
    config[definition.agentName] = {
      description: definition.description,
      prompt: definition.systemPrompt,
    };
  }

  return config;
}

function formatTaskListForPrompt(tasks: Task[]) {
  return tasks.length
    ? tasks
        .slice(0, 10)
        .map(
          (task) =>
            `- ${task.title} (${task.type}, ${task.priority}, ${task.status}) - ${task.description}`,
        )
        .join("\n")
    : "- No directly assigned tasks yet. Create or claim the next appropriate task through MCP.";
}

function buildSubagentPrompt(input: {
  context: ProjectContext;
  role: SubagentRole;
  mode: AgentMode;
  relevantTasks: Task[];
  resourceUri: string;
}) {
  const profile = subagentProfiles[input.role];
  const latestSpec = input.context.specs[0];
  const openRisks = input.context.risks.filter((risk) => risk.status !== "resolved");

  return `
You are ${subagentAgentName(input.role)}, the ${profile.title} subagent in a parallel MVP squad.

You are not alone in this project. Other subagents may be working on frontend, backend, design, QA, docs, and orchestration at the same time. Do not revert or overwrite unrelated work. Use MCP to keep shared project state current.

MCP source of truth:
- Server: mvp-control-panel
- Project ID: ${input.context.project.id}
- Context resource: ${input.resourceUri}
- Product workspace: ${input.context.project.workspacePath}

Workspace rule:
Create and edit the generated MVP product inside the product workspace. Do not put generated app code inside the MCP server repository unless explicitly asked.

First MCP action:
Call get_project_context with:
${JSON.stringify({ projectId: input.context.project.id }, null, 2)}

Role mission:
${profile.mission}

You own:
${profile.owns.map((item) => `- ${item}`).join("\n")}

Mode:
${modeInstruction(input.mode)}

Current MVP summary:
${latestSpec?.summary ?? input.context.project.idea}

Role-relevant tasks:
${formatTaskListForPrompt(input.relevantTasks)}

Key decisions:
${formatList(input.context.decisions.slice(0, 8).map(formatDecisionForRelease))}

Open risks:
${formatList([
  ...openRisks.slice(0, 8).map(formatRiskForRelease),
  ...(latestSpec?.risks.map((risk) => `- ${risk}`) ?? []),
])}

Coordination protocol:
- Start by reading project context through MCP.
- Pick work inside your role boundaries.
- If you need another role, create a task for that role instead of doing everything yourself.
- Record material choices with add_decision.
- Record blockers or uncertainty with add_risk.
- Update task status when you start, review, or finish work.
- Finish with a short status: done, changed, blocked, and what another subagent should do next.
  `.trim();
}

export function buildSubagentPlan(input: {
  projectId: string;
  roles?: SubagentRole[];
  mode?: AgentMode;
}): SubagentPlan {
  const context = getProjectContext(input.projectId);
  const mode = input.mode ?? "build";
  const roles = input.roles?.length ? input.roles : defaultSubagentRoles;
  const resourceUri = `project://${context.project.id}/context`;
  const generatedAt = nowIso();

  const briefs = roles.map((role) => {
    const definition = buildSubagentDefinition({
      role,
      projectId: context.project.id,
      workspacePath: context.project.workspacePath,
    });
    const relevantTasks = context.tasks.filter((task) =>
      taskMatchesRole(task, role),
    );
    const prompt = buildSubagentPrompt({
      context,
      role,
      mode,
      relevantTasks,
      resourceUri,
    });

    return {
      role,
      agentName: definition.agentName,
      provider: definition.provider,
      nativeKind: definition.nativeKind,
      title: definition.title,
      mission: definition.mission,
      owns: definition.owns,
      taskTypes: definition.taskTypes,
      relevantTasks,
      prompt,
      launchCommand: definition.launchCommand,
      suggestedClaudeCommand: definition.suggestedClaudeCommand,
      suggestedCodexCommand: definition.suggestedCodexCommand,
    };
  });

  return {
    projectId: context.project.id,
    projectName: context.project.name,
    resourceUri,
    generatedAt,
    mode,
    mcpServerName: "mvp-control-panel",
    recommendedFirstToolCall: {
      name: "get_project_context",
      arguments: {
        projectId: context.project.id,
      },
    },
    briefs,
    combinedPrompt: briefs
      .map((brief) => `# ${brief.title}\n\n${brief.prompt}`)
      .join("\n\n---\n\n"),
  };
}

function roleToTaskType(role: SubagentRole): TaskType {
  if (role === "frontend" || role === "design") return "frontend";
  if (role === "backend") return "backend";
  if (role === "ai") return "ai";
  if (role === "qa") return "test";
  if (role === "devops") return "devops";
  return "docs";
}

function defaultTaskForRole(project: Project, role: SubagentRole) {
  const taskType = roleToTaskType(role);
  const titles: Record<SubagentRole, string> = {
    orchestrator: "Coordinate MVP delivery",
    product: "Define MVP acceptance criteria",
    design: "Design primary MVP flow",
    frontend: "Build primary UI flow",
    backend: "Build MVP backend",
    ai: "Design AI agent workflow",
    qa: "Cover MVP with smoke tests",
    devops: "Prepare local run and deployment path",
    docs: "Write project documentation",
  };
  const descriptions: Record<SubagentRole, string> = {
    orchestrator:
      "Sequence the work, keep scope under control, and maintain shared decisions, risks, and release readiness.",
    product:
      "Turn the idea into acceptance criteria and keep v2 work out of the MVP.",
    design:
      "Create the focused screen flow, UI states, and interaction notes for the first user journey.",
    frontend:
      "Implement the user-facing MVP flow and connect it to available backend/API contracts.",
    backend:
      "Implement the core data model, API surface, validation, and persistence needed for the MVP.",
    ai: "Define prompts, tool-use flow, and evaluation checks for AI-backed behavior.",
    qa: "Add smoke tests and release-blocking checks for the critical MVP path.",
    devops:
      "Keep scripts, environment setup, and the deployment path simple and repeatable.",
    docs: "Write setup notes, usage documentation, and release notes for the MVP.",
  };

  return {
    projectId: project.id,
    title: titles[role],
    description: `${descriptions[role]} Project: ${project.name}.`,
    type: taskType,
    priority: role === "qa" || role === "docs" ? "medium" : "high",
  } satisfies Parameters<typeof createTask>[0];
}

function getTaskOrError(taskId: string): Task {
  const row = db
    .prepare(
      "SELECT id, project_id, title, description, type, priority, status, created_at, updated_at FROM tasks WHERE id = ?",
    )
    .get(taskId);

  if (!row) {
    throw new Error(`Task not found: ${taskId}`);
  }

  return taskFromRow(row);
}

function getTaskAssignment(taskId: string) {
  const row = db
    .prepare(
      "SELECT task_id, project_id, role, agent_profile_id, sequence, created_at, updated_at FROM task_assignments WHERE task_id = ?",
    )
    .get(taskId);

  return row ? taskAssignmentFromRow(row) : undefined;
}

function listTaskDependencies(projectId: string): TaskDependency[] {
  return db
    .prepare(
      `
        SELECT d.task_id, d.depends_on_task_id, d.created_at
        FROM task_dependencies d
        JOIN tasks t ON t.id = d.task_id
        WHERE t.project_id = ?
        ORDER BY d.created_at ASC
      `,
    )
    .all(projectId)
    .map(taskDependencyFromRow);
}

function insertTaskAssignment(input: {
  taskId: string;
  projectId: string;
  role: SubagentRole;
  agentProfileId?: string;
  sequence: number;
}) {
  const timestamp = nowIso();
  db.prepare(
    `
      INSERT INTO task_assignments (
        task_id, project_id, role, agent_profile_id, sequence, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        role = excluded.role,
        agent_profile_id = excluded.agent_profile_id,
        sequence = excluded.sequence,
        updated_at = excluded.updated_at
    `,
  ).run(
    input.taskId,
    input.projectId,
    input.role,
    input.agentProfileId ?? null,
    input.sequence,
    timestamp,
    timestamp,
  );
}

function insertTaskDependency(taskId: string, dependsOnTaskId: string) {
  db.prepare(
    `
      INSERT OR IGNORE INTO task_dependencies (
        task_id, depends_on_task_id, created_at
      )
      VALUES (?, ?, ?)
    `,
  ).run(taskId, dependsOnTaskId, nowIso());
}

function listAssignments(projectId: string): TaskAssignment[] {
  return db
    .prepare(
      "SELECT task_id, project_id, role, agent_profile_id, sequence, created_at, updated_at FROM task_assignments WHERE project_id = ? ORDER BY sequence ASC, created_at ASC",
    )
    .all(projectId)
    .map(taskAssignmentFromRow);
}

function listAgentProfiles(projectId: string): AgentProfile[] {
  return db
    .prepare(
      "SELECT id, project_id, role, provider, label, model, command, created_at, updated_at FROM agent_profiles WHERE project_id = ? ORDER BY role ASC, created_at ASC",
    )
    .all(projectId)
    .map(agentProfileFromRow);
}

function ensureAgentProfile(input: {
  projectId: string;
  role: SubagentRole;
  provider: AgentProvider;
  label?: string;
  model?: string;
  command?: string;
}) {
  const label = input.label ?? `${input.provider}:${input.role}`;
  const existing = db
    .prepare(
      "SELECT id, project_id, role, provider, label, model, command, created_at, updated_at FROM agent_profiles WHERE project_id = ? AND role = ? AND provider = ? AND label = ?",
    )
    .get(input.projectId, input.role, input.provider, label);

  if (existing) return agentProfileFromRow(existing);

  const timestamp = nowIso();
  const profile: AgentProfile = {
    id: randomUUID(),
    projectId: input.projectId,
    role: input.role,
    provider: input.provider,
    label,
    model: input.model,
    command: input.command,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  db.prepare(
    `
      INSERT INTO agent_profiles (
        id, project_id, role, provider, label, model, command, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    profile.id,
    profile.projectId,
    profile.role,
    profile.provider,
    profile.label,
    profile.model ?? null,
    profile.command ?? null,
    profile.createdAt,
    profile.updatedAt,
  );

  return profile;
}

function getAgentProfile(profileId: string) {
  const row = db
    .prepare(
      "SELECT id, project_id, role, provider, label, model, command, created_at, updated_at FROM agent_profiles WHERE id = ?",
    )
    .get(profileId);

  return row ? agentProfileFromRow(row) : undefined;
}

export function createWorkflow(input: {
  projectId: string;
  name?: string;
  roles?: SubagentRole[];
  createMissingTasks?: boolean;
}) {
  const project = getProjectOrError(input.projectId);
  const roles = input.roles?.length ? input.roles : defaultWorkflowRoles;
  const timestamp = nowIso();
  const workflow: Workflow = {
    id: randomUUID(),
    projectId: project.id,
    name: input.name ?? `${project.name} MVP workflow`,
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  db.prepare(
    "INSERT INTO workflows (id, project_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    workflow.id,
    workflow.projectId,
    workflow.name,
    workflow.status,
    workflow.createdAt,
    workflow.updatedAt,
  );

  db.prepare("UPDATE projects SET status = ? WHERE id = ?").run(
    "active",
    project.id,
  );

  const allTasks = getProjectContext(project.id).tasks;
  const stagedTasks: Task[][] = [];

  for (const [index, role] of roles.entries()) {
    let roleTasks = allTasks.filter((task) => taskMatchesRole(task, role));
    const definition = buildSubagentDefinition({
      role,
      projectId: project.id,
      workspacePath: project.workspacePath,
    });
    const profile = ensureAgentProfile({
      projectId: project.id,
      role,
      provider: definition.provider,
      label: definition.agentName,
      command: definition.launchCommand,
    });

    if (!roleTasks.length && input.createMissingTasks !== false) {
      roleTasks = [createTask(defaultTaskForRole(project, role))];
    }

    for (const task of roleTasks) {
      insertTaskAssignment({
        taskId: task.id,
        projectId: project.id,
        role,
        agentProfileId: profile.id,
        sequence: index,
      });
    }

    stagedTasks.push(roleTasks);
  }

  for (let index = 1; index < stagedTasks.length; index += 1) {
    for (const task of stagedTasks[index]) {
      for (const dependency of stagedTasks[index - 1]) {
        insertTaskDependency(task.id, dependency.id);
      }
    }
  }

  return {
    workflow,
    state: getWorkflowState(project.id),
  };
}

export function listReadyTasks(input: {
  projectId: string;
  role?: SubagentRole;
}): ReadyTask[] {
  const context = getProjectContext(input.projectId);
  const assignments = new Map(
    listAssignments(input.projectId).map((assignment) => [
      assignment.taskId,
      assignment,
    ]),
  );
  const dependencies = listTaskDependencies(input.projectId);
  const tasksById = new Map(context.tasks.map((task) => [task.id, task]));
  const activeRunTaskIds = new Set(
    db
      .prepare(
        "SELECT task_id FROM agent_runs WHERE project_id = ? AND status IN ('queued', 'running')",
      )
      .all(input.projectId)
      .map((row) => requiredString(row, "task_id")),
  );

  return context.tasks
    .filter((task) => task.status === "backlog")
    .map((task) => {
      const taskDependencies = dependencies.filter(
        (dependency) => dependency.taskId === task.id,
      );
      const blockedBy = taskDependencies
        .map((dependency) => tasksById.get(dependency.dependsOnTaskId))
        .filter((dependencyTask): dependencyTask is Task =>
          Boolean(dependencyTask && dependencyTask.status !== "done"),
        );

      return {
        task,
        assignment: assignments.get(task.id),
        dependencies: taskDependencies,
        blockedBy,
      };
    })
    .filter((readyTask) => !readyTask.blockedBy.length)
    .filter((readyTask) => !activeRunTaskIds.has(readyTask.task.id))
    .filter((readyTask) => {
      if (!input.role) return true;
      return (
        readyTask.assignment?.role === input.role ||
        taskMatchesRole(readyTask.task, input.role)
      );
    });
}

export function getSubagentBrief(input: {
  projectId: string;
  role: SubagentRole;
  taskId?: string;
  mode?: AgentMode;
}) {
  const context = getProjectContext(input.projectId);
  const resourceUri = `project://${context.project.id}/context`;
  const task = input.taskId ? getTaskOrError(input.taskId) : undefined;

  if (task && task.projectId !== input.projectId) {
    throw new Error(`Task ${task.id} does not belong to project ${input.projectId}`);
  }

  const relevantTasks = task
    ? [task]
    : context.tasks.filter((projectTask) =>
        taskMatchesRole(projectTask, input.role),
      );
  const profile = subagentProfiles[input.role];
  const definition = buildSubagentDefinition({
    role: input.role,
    projectId: input.projectId,
    workspacePath: context.project.workspacePath,
  });
  const prompt = buildSubagentPrompt({
    context,
    role: input.role,
    mode: input.mode ?? "build",
    relevantTasks,
    resourceUri,
  });

  return {
    role: input.role,
    agentName: definition.agentName,
    provider: definition.provider,
    nativeKind: definition.nativeKind,
    title: profile.title,
    mission: profile.mission,
    owns: profile.owns,
    taskTypes: profile.taskTypes,
    task,
    relevantTasks,
    resourceUri,
    prompt,
    launchCommand: definition.launchCommand,
    suggestedClaudeCommand: definition.suggestedClaudeCommand,
    suggestedCodexCommand: definition.suggestedCodexCommand,
  };
}

export function claimTask(input: {
  taskId: string;
  role?: SubagentRole;
  provider?: AgentProvider;
  agentLabel?: string;
  model?: string;
  command?: string;
  prompt?: string;
}) {
  const task = getTaskOrError(input.taskId);
  const assignment = getTaskAssignment(task.id);
  const role = input.role ?? assignment?.role ?? roleFromTaskType(task.type);
  const assignedProfile = assignment?.agentProfileId
    ? getAgentProfile(assignment.agentProfileId)
    : undefined;
  const ready = listReadyTasks({ projectId: task.projectId, role }).some(
    (readyTask) => readyTask.task.id === task.id,
  );

  if (!ready) {
    throw new Error(`Task is not ready to claim: ${task.id}`);
  }

  const provider = input.provider ?? assignedProfile?.provider ?? providerForRole(role);
  const shouldReuseAssignedProfile = provider === assignedProfile?.provider;
  const project = getProjectOrError(task.projectId);
  const profile = ensureAgentProfile({
    projectId: task.projectId,
    role,
    provider,
    label: input.agentLabel ?? (shouldReuseAssignedProfile ? assignedProfile?.label : undefined),
    model: input.model ?? (shouldReuseAssignedProfile ? assignedProfile?.model : undefined),
    command: input.command ?? (shouldReuseAssignedProfile ? assignedProfile?.command : undefined),
  });
  const basePrompt =
    input.prompt ??
    getSubagentBrief({
      projectId: task.projectId,
      role,
      taskId: task.id,
    }).prompt;
  const timestamp = nowIso();
  const runId = randomUUID();
  const prompt = `
${basePrompt}

Execution contract:
- This task is already claimed for you.
- Run ID: ${runId}
- Task ID: ${task.id}
- Provider: ${provider}
- Role: ${role}
- Product workspace: ${project.workspacePath}
- Use append_agent_log with this runId for meaningful progress updates.
- When the task is complete, call complete_task with this runId and a concise summary.
- If blocked or unable to finish, call fail_task with this runId and a clear error.
- Attach useful outputs with add_artifact.
  `.trim();
  const run: AgentRun = {
    id: runId,
    projectId: task.projectId,
    taskId: task.id,
    agentProfileId: profile.id,
    role,
    provider,
    status: "running",
    prompt,
    startedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  db.prepare(
    `
      INSERT INTO agent_runs (
        id, project_id, task_id, agent_profile_id, role, provider, status, prompt,
        started_at, completed_at, error, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    run.id,
    run.projectId,
    run.taskId,
    run.agentProfileId ?? null,
    run.role,
    run.provider,
    run.status,
    run.prompt,
    run.startedAt ?? null,
    run.completedAt ?? null,
    run.error ?? null,
    run.createdAt,
    run.updatedAt,
  );

  updateTaskStatus(task.id, "in_progress");
  appendAgentLog({
    runId: run.id,
    level: "info",
    message: `Claimed task "${task.title}" as ${role} via ${provider}.`,
  });

  return {
    run,
    task: getTaskOrError(task.id),
    profile,
  };
}

function getRunOrError(runId: string): AgentRun {
  const row = db
    .prepare(
      "SELECT id, project_id, task_id, agent_profile_id, role, provider, status, prompt, started_at, completed_at, error, created_at, updated_at FROM agent_runs WHERE id = ?",
    )
    .get(runId);

  if (!row) {
    throw new Error(`Agent run not found: ${runId}`);
  }

  return agentRunFromRow(row);
}

function latestRunForTask(taskId: string) {
  const row = db
    .prepare(
      "SELECT id, project_id, task_id, agent_profile_id, role, provider, status, prompt, started_at, completed_at, error, created_at, updated_at FROM agent_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(taskId);

  return row ? agentRunFromRow(row) : undefined;
}

export function listRecentRunsForTask(taskId: string, limit = 10): AgentRun[] {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  return db
    .prepare(
      `SELECT id, project_id, task_id, agent_profile_id, role, provider, status, prompt, started_at, completed_at, error, created_at, updated_at FROM agent_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT ${safeLimit}`,
    )
    .all(taskId)
    .map(agentRunFromRow);
}

export function appendAgentLog(input: {
  runId: string;
  level?: AgentLogLevel;
  message: string;
}) {
  const run = getRunOrError(input.runId);
  const log: AgentLog = {
    id: randomUUID(),
    runId: run.id,
    projectId: run.projectId,
    taskId: run.taskId,
    level: input.level ?? "info",
    message: input.message,
    createdAt: nowIso(),
  };

  db.prepare(
    "INSERT INTO run_logs (id, run_id, project_id, task_id, level, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    log.id,
    log.runId,
    log.projectId,
    log.taskId ?? null,
    log.level,
    log.message,
    log.createdAt,
  );

  return log;
}

export function addArtifact(input: {
  projectId: string;
  taskId?: string;
  runId?: string;
  kind?: ArtifactKind;
  title: string;
  content?: string;
  uri?: string;
}) {
  getProjectOrError(input.projectId);

  if (input.taskId) {
    const task = getTaskOrError(input.taskId);
    if (task.projectId !== input.projectId) {
      throw new Error(`Task ${task.id} does not belong to project ${input.projectId}`);
    }
  }

  if (input.runId) {
    const run = getRunOrError(input.runId);
    if (run.projectId !== input.projectId) {
      throw new Error(`Run ${run.id} does not belong to project ${input.projectId}`);
    }
  }

  const artifact: Artifact = {
    id: randomUUID(),
    projectId: input.projectId,
    taskId: input.taskId,
    runId: input.runId,
    kind: input.kind ?? "note",
    title: input.title,
    content: input.content,
    uri: input.uri,
    createdAt: nowIso(),
  };

  db.prepare(
    "INSERT INTO artifacts (id, project_id, task_id, run_id, kind, title, content, uri, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    artifact.id,
    artifact.projectId,
    artifact.taskId ?? null,
    artifact.runId ?? null,
    artifact.kind,
    artifact.title,
    artifact.content ?? null,
    artifact.uri ?? null,
    artifact.createdAt,
  );

  return artifact;
}

export function completeTask(input: {
  taskId?: string;
  runId?: string;
  summary?: string;
  artifacts?: Array<{
    kind?: ArtifactKind;
    title: string;
    content?: string;
    uri?: string;
  }>;
}) {
  const run = input.runId
    ? getRunOrError(input.runId)
    : input.taskId
      ? latestRunForTask(input.taskId)
      : undefined;
  const task = getTaskOrError(run?.taskId ?? input.taskId ?? "");
  const timestamp = nowIso();

  if (run) {
    db.prepare(
      "UPDATE agent_runs SET status = ?, completed_at = ?, updated_at = ?, error = NULL WHERE id = ?",
    ).run("completed", timestamp, timestamp, run.id);
    appendAgentLog({
      runId: run.id,
      level: "info",
      message: input.summary ?? `Completed task "${task.title}".`,
    });
  }

  updateTaskStatus(task.id, "done");

  const artifacts =
    input.artifacts?.map((artifact) =>
      addArtifact({
        projectId: task.projectId,
        taskId: task.id,
        runId: run?.id,
        ...artifact,
      }),
    ) ?? [];

  return {
    task: getTaskOrError(task.id),
    run: run ? getRunOrError(run.id) : undefined,
    artifacts,
    readyTasks: listReadyTasks({ projectId: task.projectId }),
  };
}

export function failTask(input: {
  taskId?: string;
  runId?: string;
  error: string;
}) {
  const run = input.runId
    ? getRunOrError(input.runId)
    : input.taskId
      ? latestRunForTask(input.taskId)
      : undefined;
  const task = getTaskOrError(run?.taskId ?? input.taskId ?? "");
  const timestamp = nowIso();

  if (run) {
    db.prepare(
      "UPDATE agent_runs SET status = ?, completed_at = ?, updated_at = ?, error = ? WHERE id = ?",
    ).run("failed", timestamp, timestamp, input.error, run.id);
    appendAgentLog({
      runId: run.id,
      level: "error",
      message: input.error,
    });
  }

  updateTaskStatus(task.id, "backlog");

  return {
    task: getTaskOrError(task.id),
    run: run ? getRunOrError(run.id) : undefined,
  };
}

function roleFromTaskType(type: TaskType): SubagentRole {
  if (type === "frontend") return "frontend";
  if (type === "backend") return "backend";
  if (type === "ai") return "ai";
  if (type === "test") return "qa";
  if (type === "devops") return "devops";
  return "docs";
}

export function getWorkflowState(projectId: string): WorkflowState {
  getProjectOrError(projectId);

  const workflows = db
    .prepare(
      "SELECT id, project_id, name, status, created_at, updated_at FROM workflows WHERE project_id = ? ORDER BY created_at DESC",
    )
    .all(projectId)
    .map(workflowFromRow);
  const agentProfiles = listAgentProfiles(projectId);
  const assignments = listAssignments(projectId);
  const profilesById = new Map(
    agentProfiles.map((profile) => [profile.id, profile]),
  );
  const roleProviders = { ...defaultRoleProviders };

  for (const assignment of assignments) {
    const profile = assignment.agentProfileId
      ? profilesById.get(assignment.agentProfileId)
      : undefined;

    if (profile) {
      roleProviders[assignment.role] = profile.provider;
    }
  }

  const dependencies = listTaskDependencies(projectId);
  const readyTasks = listReadyTasks({ projectId });
  const activeRuns = db
    .prepare(
      "SELECT id, project_id, task_id, agent_profile_id, role, provider, status, prompt, started_at, completed_at, error, created_at, updated_at FROM agent_runs WHERE project_id = ? AND status IN ('queued', 'running') ORDER BY created_at DESC",
    )
    .all(projectId)
    .map(agentRunFromRow);
  const recentRuns = db
    .prepare(
      "SELECT id, project_id, task_id, agent_profile_id, role, provider, status, prompt, started_at, completed_at, error, created_at, updated_at FROM agent_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 20",
    )
    .all(projectId)
    .map(agentRunFromRow);
  const recentLogs = db
    .prepare(
      "SELECT id, run_id, project_id, task_id, level, message, created_at FROM run_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT 50",
    )
    .all(projectId)
    .map(agentLogFromRow);
  const artifacts = db
    .prepare(
      "SELECT id, project_id, task_id, run_id, kind, title, content, uri, created_at FROM artifacts WHERE project_id = ? ORDER BY created_at DESC LIMIT 50",
    )
    .all(projectId)
    .map(artifactFromRow);

  return {
    workflows,
    agentProfiles,
    roleProviders,
    assignments,
    dependencies,
    readyTasks,
    activeRuns,
    recentRuns,
    recentLogs,
    artifacts,
  };
}

export function createDraftMvpPlan(projectId: string) {
  const project = getProjectOrError(projectId);
  const target = project.targetAudience ?? "first users";
  const spec = createMvpSpec({
    projectId,
    summary: `Lean MVP for "${project.name}": validate the core promise for ${target} with the smallest usable product based on this idea: ${project.idea}`,
    inScope: [
      "Primary user journey from entry point to first successful outcome",
      "Core data model and basic CRUD for the main product entity",
      "Minimal backend API needed by the first workflow",
      "Operational UI for reviewing progress, risks, and release readiness",
      "Smoke tests for the critical path",
    ],
    outOfScope: [
      "Advanced personalization and automation",
      "Complex billing, permissions, and analytics",
      "Large-scale infrastructure optimization",
      "Secondary workflows that do not validate the core idea",
    ],
    userStories: [
      `As a ${target}, I can understand the product value quickly.`,
      `As a ${target}, I can complete the main workflow without manual help.`,
      "As a builder, I can see the MVP scope, open work, risks, and release notes in one place.",
    ],
    risks: [
      "The first workflow may still be too broad for a fast MVP.",
      "The core user value needs validation before expanding feature scope.",
    ],
  });

  const tasks = [
    createTask({
      projectId,
      title: "Define first user journey",
      description:
        "Write the shortest path from user entry to the first meaningful outcome.",
      type: "docs",
      priority: "high",
    }),
    createTask({
      projectId,
      title: "Design core data model",
      description:
        "Identify the minimal entities, fields, and relationships required for the MVP.",
      type: "backend",
      priority: "high",
    }),
    createTask({
      projectId,
      title: "Build primary UI flow",
      description:
        "Implement the first end-to-end screen flow for the main user action.",
      type: "frontend",
      priority: "high",
    }),
    createTask({
      projectId,
      title: "Add critical path smoke test",
      description:
        "Cover the first user journey with a lightweight automated or scripted test.",
      type: "test",
      priority: "medium",
    }),
  ];

  const decision = addDecision({
    projectId,
    title: "Keep v1 scope narrow",
    decision:
      "Prioritize one complete user journey over a wider set of partial features.",
    category: "product",
    impact: "high",
    rationale:
      "A narrow complete workflow gives agents and users a clearer validation target.",
  });

  const risk = addRisk({
    projectId,
    title: "Scope creep",
    description:
      "The MVP can become too large if secondary workflows are included before validation.",
    severity: "high",
    status: "open",
    mitigation:
      "Move non-essential ideas to out-of-scope or backlog until the core workflow works.",
  });

  return { spec, tasks, decision, risk };
}

initializeDatabase();
