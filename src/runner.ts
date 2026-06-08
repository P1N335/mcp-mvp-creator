import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  addArtifact,
  appendAgentLog,
  buildNativeClaudeAgentsConfig,
  buildSubagentDefinition,
  claimTask,
  completeTask,
  failTask,
  getProjectOrError,
  listProjects,
  listReadyTasks,
  listRecentRunsForTask,
  ensureProjectWorkspace,
  providerForRole,
  type AgentProvider,
  type SubagentRole,
} from "./store.js";

type RunnerProvider = AgentProvider | "auto";

type RunnerOptions = {
  projectId?: string;
  role?: SubagentRole;
  provider: RunnerProvider;
  once: boolean;
  dryRun: boolean;
  intervalMs: number;
  maxParallel: number;
  maxCycles?: number;
  stopWhenIdle: boolean;
  agentLabel?: string;
};

type AgentProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

const subagentRoles = new Set<SubagentRole>([
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

const providers = new Set<RunnerProvider>(["auto", "codex", "claude", "manual"]);

function parseArgs(argv: string[]): RunnerOptions {
  const options: RunnerOptions = {
    provider: "auto",
    once: false,
    dryRun: false,
    intervalMs: 5000,
    maxParallel: 1,
    stopWhenIdle: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--project-id") {
      options.projectId = next;
      index += 1;
      continue;
    }

    if (arg === "--role") {
      if (!subagentRoles.has(next as SubagentRole)) {
        throw new Error(`Unsupported role: ${next}`);
      }
      options.role = next as SubagentRole;
      index += 1;
      continue;
    }

    if (arg === "--provider") {
      if (!providers.has(next as RunnerProvider)) {
        throw new Error(`Unsupported provider: ${next}`);
      }
      options.provider = next as RunnerProvider;
      index += 1;
      continue;
    }

    if (arg === "--agent-label") {
      options.agentLabel = next;
      index += 1;
      continue;
    }

    if (arg === "--once") {
      options.once = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--interval-ms") {
      options.intervalMs = Number.parseInt(next, 10);
      index += 1;
      continue;
    }

    if (arg === "--max-parallel") {
      options.maxParallel = Math.max(1, Number.parseInt(next, 10));
      index += 1;
      continue;
    }

    if (arg === "--max-cycles") {
      options.maxCycles = Math.max(1, Number.parseInt(next, 10));
      index += 1;
      continue;
    }

    if (arg === "--stop-when-idle") {
      options.stopWhenIdle = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`
MVP Control Panel Runner

Usage:
  node build/runner.js --project-id <id> --provider auto --once
  node build/runner.js --project-id <id> --provider codex --once
  node build/runner.js --project-id <id> --provider claude --role frontend --max-parallel 2

Options:
  --project-id <id>      Project to run. Defaults to all projects.
  --role <role>          Restrict to one subagent role.
  --provider <provider>  auto, manual, codex, or claude. Defaults to auto.
  --agent-label <label>  Label stored in agent profile/run metadata.
  --once                Run one polling cycle and exit.
  --dry-run             Claim nothing; only print ready tasks.
  --interval-ms <ms>    Poll interval for loop mode. Defaults to 5000.
  --max-parallel <n>    Maximum tasks to launch per cycle. Defaults to 1.
  --max-cycles <n>      Stop loop mode after this many polling cycles.
  --stop-when-idle      Stop loop mode when no ready tasks remain.
  `.trim());
}

function getProjectIds(options: RunnerOptions) {
  if (options.projectId) return [options.projectId];
  return listProjects()
    .filter((project) => project.status !== "archived")
    .map((project) => project.id);
}

function runCommand(input: {
  command: string;
  args: string[];
  prompt: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
}): Promise<AgentProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: { ...process.env, ...input.env },
      shell: false,
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      resolve({
        exitCode: 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: `${Buffer.concat(stderr).toString("utf8")}\n${error.message}`.trim(),
      });
    });
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });

    child.stdin.end(input.prompt);
  });
}

function findClaudeCommand() {
  if (process.env.CLAUDE_CMD) return process.env.CLAUDE_CMD;

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return "claude";

  const installRoot = join(
    localAppData,
    "Packages",
    "Claude_pzs8sxrjxfjjc",
    "LocalCache",
    "Roaming",
    "Claude",
    "claude-code",
  );

  try {
    const versions = readdirSync(installRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) =>
        right.localeCompare(left, undefined, { numeric: true }),
      );

    for (const version of versions) {
      const candidate = join(installRoot, version, "claude.exe");
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // Fall back to PATH below.
  }

  return "claude";
}

function roleForReadyTask(
  readyTask: ReturnType<typeof listReadyTasks>[number],
  options: RunnerOptions,
): SubagentRole {
  if (readyTask.assignment?.role) return readyTask.assignment.role;
  if (options.role) return options.role;

  if (readyTask.task.type === "backend") return "backend";
  if (readyTask.task.type === "frontend") return "frontend";
  if (readyTask.task.type === "test") return "qa";
  if (readyTask.task.type === "devops") return "devops";
  if (readyTask.task.type === "ai") return "ai";
  return "docs";
}

type ProviderDecision = {
  provider: AgentProvider;
  fallbackFrom?: AgentProvider;
  reason?: string;
};

function alternateProvider(provider: AgentProvider): AgentProvider {
  if (provider === "codex") return "claude";
  if (provider === "claude") return "codex";
  return "codex";
}

function textLooksResourceLimited(text: string) {
  const normalized = text.toLowerCase();
  const patterns = [
    "token limit",
    "tokens exceeded",
    "too many tokens",
    "exceeded token",
    "maximum context",
    "context length",
    "context window",
    "context limit",
    "input is too large",
    "session limit",
    "usage limit",
    "rate limit",
    "quota exceeded",
    "resets ",
  ];

  return patterns.some((pattern) => normalized.includes(pattern));
}

function resolveProviderDecision(
  readyTask: ReturnType<typeof listReadyTasks>[number],
  options: RunnerOptions,
): ProviderDecision {
  if (options.provider !== "auto") return { provider: options.provider };

  const role = roleForReadyTask(readyTask, options);
  const preferredProvider = providerForRole(role);
  const limitedRun = listRecentRunsForTask(readyTask.task.id, 8).find(
    (run) =>
      run.status === "failed" &&
      run.provider !== "manual" &&
      Boolean(run.error && textLooksResourceLimited(run.error)),
  );

  if (!limitedRun) return { provider: preferredProvider };

  return {
    provider: alternateProvider(limitedRun.provider),
    fallbackFrom: limitedRun.provider,
    reason: "resource-limit",
  };
}

function resolveProvider(
  readyTask: ReturnType<typeof listReadyTasks>[number],
  options: RunnerOptions,
) {
  return resolveProviderDecision(readyTask, options).provider;
}

function commandLabelForRole(
  provider: AgentProvider,
  role: SubagentRole,
  workspacePath: string,
) {
  const definition = buildSubagentDefinition({
    role,
    provider,
    workspacePath,
  });

  if (provider === "codex") {
    return `${process.env.CODEX_CMD ?? "codex"} exec -C ${workspacePath} --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -`;
  }

  if (provider === "claude") {
    const permissionMode = process.env.CLAUDE_PERMISSION_MODE ?? "bypassPermissions";
    return `${findClaudeCommand()} --permission-mode ${permissionMode} --add-dir ${workspacePath} --agents <generated> --agent ${definition.agentName} ${process.env.CLAUDE_ARGS ?? "-p -"}`.trim();
  }

  return "manual";
}

function claudeArgsForRole(role: SubagentRole, workspacePath: string) {
  const definition = buildSubagentDefinition({ role, provider: "claude" });
  const agentsConfig = buildNativeClaudeAgentsConfig([role]);
  const claudeArgs = (process.env.CLAUDE_ARGS ?? "-p,-")
    .split(",")
    .map((arg) => arg.trim())
    .filter(Boolean);
  const permissionMode = process.env.CLAUDE_PERMISSION_MODE ?? "bypassPermissions";

  return [
    "--permission-mode",
    permissionMode,
    "--add-dir",
    workspacePath,
    "--agents",
    JSON.stringify(agentsConfig),
    "--agent",
    definition.agentName,
    ...claudeArgs,
  ];
}

async function runAgent(
  provider: AgentProvider,
  role: SubagentRole,
  prompt: string,
  workspacePath: string,
) {
  if (provider === "manual") {
    return {
      exitCode: 0,
      stdout: "Manual runner completed the task without launching an external agent.",
      stderr: "",
    };
  }

  if (provider === "codex") {
    return runCommand({
      command: process.env.CODEX_CMD ?? "codex",
      args: [
        "exec",
        "-C",
        workspacePath,
        "--dangerously-bypass-approvals-and-sandbox",
        "--skip-git-repo-check",
        "-",
      ],
      prompt,
      cwd: workspacePath,
    });
  }

  return runCommand({
    command: findClaudeCommand(),
    args: claudeArgsForRole(role, workspacePath),
    prompt,
    cwd: workspacePath,
  });
}

function agentResultLooksBlocked(result: AgentProcessResult) {
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
  const blockedPatterns = [
    "status: blocked",
    "blocked -",
    "blocked:",
    "cannot perform any write",
    "could not write any files",
    "permissions not granted",
    "permission/sandbox-block",
    "may only write to files",
    "cannot write",
    "unable to do any actual work",
  ];

  return blockedPatterns.some((pattern) => output.includes(pattern));
}

function agentResultLooksResourceLimited(result: AgentProcessResult) {
  return textLooksResourceLimited(`${result.stdout}\n${result.stderr}`);
}

async function processReadyTask(
  readyTask: ReturnType<typeof listReadyTasks>[number],
  options: RunnerOptions,
) {
  const role = roleForReadyTask(readyTask, options);
  const providerDecision = resolveProviderDecision(readyTask, options);
  const provider = providerDecision.provider;
  const project = getProjectOrError(readyTask.task.projectId);
  const workspacePath = ensureProjectWorkspace(project);
  const definition = buildSubagentDefinition({
    role,
    provider,
    projectId: project.id,
    workspacePath,
  });

  console.log(
    JSON.stringify({
      event: "claiming",
      taskId: readyTask.task.id,
      title: readyTask.task.title,
      role,
      provider,
      subagent: definition.agentName,
      nativeKind: definition.nativeKind,
      workspacePath,
      fallbackFrom: providerDecision.fallbackFrom,
      reason: providerDecision.reason,
    }),
  );
  const claim = claimTask({
    taskId: readyTask.task.id,
    role,
    provider,
    agentLabel: options.agentLabel ?? definition.agentName,
    command: commandLabelForRole(provider, role, workspacePath),
  });

  appendAgentLog({
    runId: claim.run.id,
    message: `Runner launched ${definition.agentName} (${definition.nativeKind}, ${provider}) in ${workspacePath} for task "${claim.task.title}".`,
  });
  if (providerDecision.fallbackFrom) {
    appendAgentLog({
      runId: claim.run.id,
      level: "warning",
      message: `Fallback routing: previous ${providerDecision.fallbackFrom} run hit a resource limit, so this task is now running via ${provider}.`,
    });
  }

  const result = await runAgent(provider, role, claim.run.prompt, workspacePath);
  const resourceLimited = agentResultLooksResourceLimited(result);

  if (result.exitCode === 0 && !agentResultLooksBlocked(result) && !resourceLimited) {
    const completion = completeTask({
      runId: claim.run.id,
      summary: `${provider} runner exited successfully.`,
      artifacts: [
        {
          kind: "note",
          title: `${provider} runner output`,
          content: [result.stdout, result.stderr].filter(Boolean).join("\n\n"),
        },
      ],
    });
    console.log(
      JSON.stringify({
        event: "completed",
        taskId: completion.task.id,
        runId: claim.run.id,
      }),
    );
    return;
  }

  const error =
    resourceLimited
      ? `Agent resource limit detected for ${provider}; task requeued for fallback provider.`
      : result.exitCode === 0
      ? "Agent reported a permission/write blocker even though the process exited successfully."
      : result.stderr ||
        result.stdout ||
        `${provider} runner exited with ${result.exitCode}`;
  const failure = failTask({
    runId: claim.run.id,
    error,
  });
  addArtifact({
    projectId: failure.task.projectId,
    taskId: failure.task.id,
    runId: claim.run.id,
    kind: "note",
    title: `${provider} runner output`,
    content: [result.stdout, result.stderr].filter(Boolean).join("\n\n"),
  });
  if (resourceLimited) {
    appendAgentLog({
      runId: claim.run.id,
      level: "warning",
      message: `Resource limit detected. The next auto-routed run for this task will try ${alternateProvider(provider)}.`,
    });
  }
  console.log(
    JSON.stringify({
      event: "failed",
      taskId: failure.task.id,
      runId: claim.run.id,
      exitCode: result.exitCode,
      resourceLimited,
      fallbackProvider: resourceLimited ? alternateProvider(provider) : undefined,
    }),
  );
}

async function runCycle(options: RunnerOptions) {
  const projectIds = getProjectIds(options);
  const readyTasks = projectIds.flatMap((projectId) =>
    listReadyTasks({ projectId, role: options.role }),
  );

  if (!readyTasks.length) {
    console.log(JSON.stringify({ event: "idle", projects: projectIds.length }));
    return 0;
  }

  const selected = readyTasks.slice(0, options.maxParallel);

  if (options.dryRun) {
    console.log(
      JSON.stringify({
        event: "dry-run",
        readyTasks: selected.map((readyTask) => {
          const role = roleForReadyTask(readyTask, options);
          const providerDecision = resolveProviderDecision(readyTask, options);
          const provider = providerDecision.provider;
          const project = getProjectOrError(readyTask.task.projectId);
          const definition = buildSubagentDefinition({
            role,
            provider,
            projectId: project.id,
            workspacePath: project.workspacePath,
          });

          return {
            taskId: readyTask.task.id,
            title: readyTask.task.title,
            role,
            provider,
            subagent: definition.agentName,
            workspacePath: project.workspacePath,
            fallbackFrom: providerDecision.fallbackFrom,
            reason: providerDecision.reason,
          };
        }),
      }),
    );
    return selected.length;
  }

  await Promise.all(
    selected.map((readyTask) => processReadyTask(readyTask, options)),
  );
  return selected.length;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.once) {
    await runCycle(options);
    return;
  }

  let cycles = 0;
  for (;;) {
    const processed = await runCycle(options);
    cycles += 1;
    if (options.stopWhenIdle && processed === 0) return;
    if (options.maxCycles && cycles >= options.maxCycles) return;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
