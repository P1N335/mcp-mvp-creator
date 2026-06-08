import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  addDecision,
  addArtifact,
  addRisk,
  appendAgentLog,
  buildAgentHandoff,
  buildReleaseNotes,
  buildSubagentDefinitions,
  buildSubagentPlan,
  claimTask,
  completeTask,
  createWorkflow,
  createMvpSpec,
  createProject,
  createTask,
  failTask,
  getCurrentProjectContext,
  getProjectContext,
  getSubagentBrief,
  getWorkflowState,
  listReadyTasks,
  listProjects,
  updateTaskStatus,
} from "./store.js";

function jsonText(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

const server = new McpServer({
  name: "mvp-control-panel-mcp",
  version: "1.0.0",
});

server.registerTool(
  "create_project",
  {
    title: "Create MVP Project",
    description: "Create a new MVP project from a business idea.",
    inputSchema: z.object({
      name: z.string().min(3).max(120),
      idea: z.string().min(10).max(2000),
      targetAudience: z.string().max(500).optional(),
    }),
  },
  async ({ name, idea, targetAudience }) => {
    const project = createProject({ name, idea, targetAudience });

    return jsonText({
      ok: true,
      project,
    });
  },
);

server.registerTool(
  "list_projects",
  {
    title: "List MVP Projects",
    description: "List all MVP projects in the current workspace.",
    inputSchema: z.object({
      status: z.enum(["draft", "active", "done", "archived"]).optional(),
    }),
  },
  async ({ status }) => {
    return jsonText({
      ok: true,
      projects: listProjects(status),
    });
  },
);

server.registerTool(
  "get_project_context",
  {
    title: "Get Project Context",
    description:
      "Get project details, MVP specs, decisions, risks, and task board for a specific project.",
    inputSchema: z.object({
      projectId: z.string(),
    }),
  },
  async ({ projectId }) => {
    return jsonText({
      ok: true,
      context: getProjectContext(projectId),
    });
  },
);

server.registerTool(
  "create_mvp_spec",
  {
    title: "Create MVP Spec",
    description: "Create and save an MVP specification for a project.",
    inputSchema: z.object({
      projectId: z.string(),
      summary: z.string().min(20).max(3000),
      inScope: z.array(z.string()).min(1),
      outOfScope: z.array(z.string()).default([]),
      userStories: z.array(z.string()).default([]),
      risks: z.array(z.string()).default([]),
    }),
  },
  async ({ projectId, summary, inScope, outOfScope, userStories, risks }) => {
    const spec = createMvpSpec({
      projectId,
      summary,
      inScope,
      outOfScope,
      userStories,
      risks,
    });

    return jsonText({
      ok: true,
      spec,
    });
  },
);

server.registerTool(
  "create_task",
  {
    title: "Create Task",
    description: "Create an implementation task for an MVP project.",
    inputSchema: z.object({
      projectId: z.string(),
      title: z.string().min(3).max(160),
      description: z.string().min(10).max(3000),
      type: z.enum(["frontend", "backend", "ai", "test", "docs", "devops"]),
      priority: z.enum(["low", "medium", "high"]).default("medium"),
    }),
  },
  async ({ projectId, title, description, type, priority }) => {
    const task = createTask({
      projectId,
      title,
      description,
      type,
      priority,
    });

    return jsonText({
      ok: true,
      task,
    });
  },
);

server.registerTool(
  "update_task_status",
  {
    title: "Update Task Status",
    description: "Move a task between backlog, in_progress, review, and done.",
    inputSchema: z.object({
      taskId: z.string(),
      status: z.enum(["backlog", "in_progress", "review", "done"]),
    }),
  },
  async ({ taskId, status }) => {
    const result = updateTaskStatus(taskId, status);

    if (!result) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Task not found: ${taskId}`,
          },
        ],
      };
    }

    return jsonText({
      ok: true,
      task: result.task,
      audit: result.audit,
    });
  },
);

server.registerTool(
  "add_decision",
  {
    title: "Add Project Decision",
    description:
      "Record an important MVP project decision with rationale and impact.",
    inputSchema: z.object({
      projectId: z.string(),
      title: z.string().min(3).max(160),
      decision: z.string().min(10).max(3000),
      category: z
        .enum(["product", "technical", "design", "business", "process"])
        .default("product"),
      impact: z.enum(["low", "medium", "high"]).default("medium"),
      rationale: z.string().max(3000).optional(),
      alternatives: z.array(z.string()).default([]),
      owner: z.string().max(120).optional(),
    }),
  },
  async ({
    projectId,
    title,
    decision,
    category,
    impact,
    rationale,
    alternatives,
    owner,
  }) => {
    const projectDecision = addDecision({
      projectId,
      title,
      decision,
      category,
      impact,
      rationale,
      alternatives,
      owner,
    });

    return jsonText({
      ok: true,
      decision: projectDecision,
    });
  },
);

server.registerTool(
  "add_risk",
  {
    title: "Add Project Risk",
    description:
      "Record a delivery, product, technical, or business risk for an MVP project.",
    inputSchema: z.object({
      projectId: z.string(),
      title: z.string().min(3).max(160),
      description: z.string().min(10).max(3000),
      severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
      status: z
        .enum(["open", "mitigating", "accepted", "resolved"])
        .default("open"),
      mitigation: z.string().max(3000).optional(),
      owner: z.string().max(120).optional(),
    }),
  },
  async ({
    projectId,
    title,
    description,
    severity,
    status,
    mitigation,
    owner,
  }) => {
    const risk = addRisk({
      projectId,
      title,
      description,
      severity,
      status,
      mitigation,
      owner,
    });

    return jsonText({
      ok: true,
      risk,
    });
  },
);

server.registerTool(
  "generate_release_notes",
  {
    title: "Generate Release Notes",
    description:
      "Generate release notes from specs, completed tasks, active work, decisions, and risks.",
    inputSchema: z.object({
      projectId: z.string(),
      version: z.string().max(80).optional(),
      includeBacklog: z.boolean().default(false),
      format: z.enum(["markdown", "json"]).default("markdown"),
    }),
  },
  async ({ projectId, version, includeBacklog, format }) => {
    const releaseNotes = buildReleaseNotes(projectId, version, includeBacklog);

    if (format === "json") {
      return jsonText({
        ok: true,
        format,
        releaseNotes,
      });
    }

    return jsonText({
      ok: true,
      format,
      releaseNotes: releaseNotes.markdown,
    });
  },
);

server.registerTool(
  "generate_agent_handoff",
  {
    title: "Generate Agent Handoff",
    description:
      "Generate a ready-to-paste Codex or Claude handoff prompt for an MVP project.",
    inputSchema: z.object({
      projectId: z.string(),
      agent: z.enum(["codex", "claude"]).default("codex"),
      mode: z.enum(["build", "plan", "review"]).default("build"),
    }),
  },
  async ({ projectId, agent, mode }) => {
    return jsonText({
      ok: true,
      handoff: buildAgentHandoff({ projectId, agent, mode }),
    });
  },
);

server.registerTool(
  "generate_subagent_plan",
  {
    title: "Generate Subagent Plan",
    description:
      "Generate parallel role briefs for an MVP subagent squad such as frontend, backend, design, QA, and orchestration.",
    inputSchema: z.object({
      projectId: z.string(),
      roles: z
        .array(
          z.enum([
            "orchestrator",
            "product",
            "design",
            "frontend",
            "backend",
            "ai",
            "qa",
            "devops",
            "docs",
          ]),
        )
        .optional(),
      mode: z.enum(["build", "plan", "review"]).default("build"),
    }),
  },
  async ({ projectId, roles, mode }) => {
    return jsonText({
      ok: true,
      subagentPlan: buildSubagentPlan({ projectId, roles, mode }),
    });
  },
);

const subagentRoleSchema = z.enum([
  "orchestrator",
  "product",
  "design",
  "frontend",
  "backend",
  "ai",
  "qa",
  "devops",
  "docs",
]);
const agentProviderSchema = z.enum(["codex", "claude", "manual"]);
const agentModeSchema = z.enum(["build", "plan", "review"]);
const artifactKindSchema = z.enum([
  "code",
  "doc",
  "test",
  "design",
  "note",
  "release",
]);

server.registerTool(
  "list_subagents",
  {
    title: "List Subagents",
    description:
      "List the configured MVP subagents, their providers, native execution kind, role boundaries, and launch commands.",
    inputSchema: z.object({
      roles: z.array(subagentRoleSchema).optional(),
    }),
  },
  async ({ roles }) => {
    return jsonText({
      ok: true,
      subagents: buildSubagentDefinitions({ roles }),
    });
  },
);

server.registerTool(
  "create_workflow",
  {
    title: "Create Workflow",
    description:
      "Create an executable MVP workflow with role assignments and task dependencies.",
    inputSchema: z.object({
      projectId: z.string(),
      name: z.string().max(160).optional(),
      roles: z.array(subagentRoleSchema).optional(),
      createMissingTasks: z.boolean().default(true),
    }),
  },
  async ({ projectId, name, roles, createMissingTasks }) => {
    return jsonText({
      ok: true,
      workflow: createWorkflow({
        projectId,
        name,
        roles,
        createMissingTasks,
      }),
    });
  },
);

server.registerTool(
  "get_workflow_state",
  {
    title: "Get Workflow State",
    description:
      "Get workflow dependencies, ready tasks, active runs, logs, and artifacts for a project.",
    inputSchema: z.object({
      projectId: z.string(),
    }),
  },
  async ({ projectId }) => {
    return jsonText({
      ok: true,
      workflowState: getWorkflowState(projectId),
    });
  },
);

server.registerTool(
  "list_ready_tasks",
  {
    title: "List Ready Tasks",
    description:
      "List backlog tasks whose dependencies are complete and which can be claimed by a subagent.",
    inputSchema: z.object({
      projectId: z.string(),
      role: subagentRoleSchema.optional(),
    }),
  },
  async ({ projectId, role }) => {
    return jsonText({
      ok: true,
      readyTasks: listReadyTasks({ projectId, role }),
    });
  },
);

server.registerTool(
  "get_subagent_brief",
  {
    title: "Get Subagent Brief",
    description:
      "Get a role-specific or task-specific brief for a subagent before claiming work.",
    inputSchema: z.object({
      projectId: z.string(),
      role: subagentRoleSchema,
      taskId: z.string().optional(),
      mode: agentModeSchema.default("build"),
    }),
  },
  async ({ projectId, role, taskId, mode }) => {
    return jsonText({
      ok: true,
      brief: getSubagentBrief({ projectId, role, taskId, mode }),
    });
  },
);

server.registerTool(
  "claim_task",
  {
    title: "Claim Task",
    description:
      "Claim a ready task for a Codex, Claude, or manual subagent run and move it to in_progress. If provider is omitted, the workflow role routing is used.",
    inputSchema: z.object({
      taskId: z.string(),
      role: subagentRoleSchema.optional(),
      provider: agentProviderSchema.optional(),
      agentLabel: z.string().max(160).optional(),
      model: z.string().max(160).optional(),
      command: z.string().max(500).optional(),
      prompt: z.string().max(12000).optional(),
    }),
  },
  async ({ taskId, role, provider, agentLabel, model, command, prompt }) => {
    return jsonText({
      ok: true,
      claim: claimTask({
        taskId,
        role,
        provider,
        agentLabel,
        model,
        command,
        prompt,
      }),
    });
  },
);

server.registerTool(
  "complete_task",
  {
    title: "Complete Task",
    description:
      "Mark a claimed task as done, complete its run, and optionally attach artifacts.",
    inputSchema: z.object({
      taskId: z.string().optional(),
      runId: z.string().optional(),
      summary: z.string().max(3000).optional(),
      artifacts: z
        .array(
          z.object({
            kind: artifactKindSchema.default("note"),
            title: z.string().min(3).max(180),
            content: z.string().max(12000).optional(),
            uri: z.string().max(1000).optional(),
          }),
        )
        .default([]),
    }),
  },
  async ({ taskId, runId, summary, artifacts }) => {
    return jsonText({
      ok: true,
      completion: completeTask({ taskId, runId, summary, artifacts }),
    });
  },
);

server.registerTool(
  "fail_task",
  {
    title: "Fail Task",
    description:
      "Mark an agent run as failed, move its task back to backlog, and preserve the error.",
    inputSchema: z.object({
      taskId: z.string().optional(),
      runId: z.string().optional(),
      error: z.string().min(3).max(3000),
    }),
  },
  async ({ taskId, runId, error }) => {
    return jsonText({
      ok: true,
      failure: failTask({ taskId, runId, error }),
    });
  },
);

server.registerTool(
  "append_agent_log",
  {
    title: "Append Agent Log",
    description: "Append a log line to an agent run.",
    inputSchema: z.object({
      runId: z.string(),
      level: z.enum(["info", "warning", "error"]).default("info"),
      message: z.string().min(1).max(3000),
    }),
  },
  async ({ runId, level, message }) => {
    return jsonText({
      ok: true,
      log: appendAgentLog({ runId, level, message }),
    });
  },
);

server.registerTool(
  "add_artifact",
  {
    title: "Add Artifact",
    description:
      "Attach a code, doc, test, design, note, or release artifact to a project/task/run.",
    inputSchema: z.object({
      projectId: z.string(),
      taskId: z.string().optional(),
      runId: z.string().optional(),
      kind: artifactKindSchema.default("note"),
      title: z.string().min(3).max(180),
      content: z.string().max(12000).optional(),
      uri: z.string().max(1000).optional(),
    }),
  },
  async ({ projectId, taskId, runId, kind, title, content, uri }) => {
    return jsonText({
      ok: true,
      artifact: addArtifact({
        projectId,
        taskId,
        runId,
        kind,
        title,
        content,
        uri,
      }),
    });
  },
);

server.registerResource(
  "current-project",
  "project://current",
  {
    title: "Current Project",
    description: "Current active MVP project context.",
    mimeType: "application/json",
  },
  async (uri) => {
    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(
            getCurrentProjectContext() ?? { currentProject: null },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.registerResource(
  "project-context",
  new ResourceTemplate("project://{projectId}/context", {
    list: async () => ({
      resources: listProjects().map((project) => ({
        uri: `project://${project.id}/context`,
        name: project.name,
      })),
    }),
  }),
  {
    title: "Project Context",
    description: "Full project context by project ID.",
    mimeType: "application/json",
  },
  async (uri, { projectId }) => {
    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(getProjectContext(String(projectId)), null, 2),
        },
      ],
    };
  },
);

server.registerPrompt(
  "decompose_mvp",
  {
    title: "Decompose MVP",
    description: "Turn a business idea into an MVP specification.",
    argsSchema: {
      idea: z.string().min(10),
      targetAudience: z.string().optional(),
      timeframe: z.string().optional(),
    },
  },
  ({ idea, targetAudience, timeframe }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `
You are a product-minded fullstack engineer.

Turn this business idea into a lean MVP specification.

Business idea:
${idea}

Target audience:
${targetAudience ?? "Not specified"}

Timeframe:
${timeframe ?? "Not specified"}

Return:
1. MVP goal
2. In scope
3. Out of scope
4. User stories
5. Core entities
6. API endpoints
7. UI screens
8. Test plan
9. Risks
10. First implementation tasks

Keep the MVP small. Move non-essential features to v2.
          `.trim(),
        },
      },
    ],
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
