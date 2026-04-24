import { createServer } from "node:http";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const logsDir = path.join(dataDir, "logs");
const runtimePath = path.join(dataDir, "runtime.json");
const projectsRoot = path.join(__dirname, "projects");
const repoRoot = __dirname;

const defaultRuntime = {
  settings: {
    autoSyncOnWrite: false,
    defaultCommitMessage: "chore: sync dashboard state",
    claudeCommand: "claude",
    codexCommand: "codex"
  },
  scanRoots: [],
  sessions: []
};

const activeSessions = new Map();

async function ensureWorkspace() {
  await mkdir(dataDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
  await mkdir(projectsRoot, { recursive: true });

  try {
    await stat(runtimePath);
  } catch {
    await writeJson(runtimePath, defaultRuntime);
  }
}

async function fileExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, fallback = null) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readText(filePath, fallback = "") {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

async function readRuntime() {
  await ensureWorkspace();
  const runtime = await readJson(runtimePath, defaultRuntime);
  return {
    ...defaultRuntime,
    ...runtime,
    settings: {
      ...defaultRuntime.settings,
      ...(runtime?.settings ?? {})
    }
  };
}

async function writeRuntime(runtime) {
  await writeJson(runtimePath, runtime);
}

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function cleanArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => cleanText(item))
    .filter(Boolean);
}

function linesToArray(value) {
  return cleanText(value)
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(value, fallback = "item") {
  const normalized = cleanText(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || fallback;
}

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function projectDir(slug) {
  return path.join(projectsRoot, slug);
}

function projectFilePath(slug) {
  return path.join(projectDir(slug), "project.json");
}

function sharedDir(slug) {
  return path.join(projectDir(slug), "shared");
}

function tasksDir(slug) {
  return path.join(sharedDir(slug), "tasks");
}

function taskDir(slug, taskId) {
  return path.join(tasksDir(slug), taskId);
}

function taskFilePath(slug, taskId) {
  return path.join(taskDir(slug, taskId), "task.json");
}

function taskLockPath(slug, taskId) {
  return path.join(taskDir(slug, taskId), "lock.json");
}

function syncDir(slug) {
  return path.join(projectDir(slug), "sync");
}

function syncPendingDir(slug) {
  return path.join(syncDir(slug), "pending");
}

function syncHistoryDir(slug) {
  return path.join(syncDir(slug), "history");
}

function projectRunsDir(slug) {
  return path.join(projectDir(slug), "runs");
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function respondJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function respondText(res, status, payload, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(payload);
}

function notFound(res) {
  respondJson(res, 404, { error: "Not found" });
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function currentRepoBranch() {
  const branch = await runCommand("git", ["branch", "--show-current"], { cwd: repoRoot });
  if (branch.code !== 0) {
    throw new Error(branch.stderr || "Failed to detect current branch.");
  }

  return branch.stdout.trim() || "main";
}

async function gitSnapshot(projectPath) {
  if (!projectPath || !(await fileExists(projectPath))) {
    return {
      branch: "",
      dirty: false,
      remoteUrl: "",
      statusSummary: ""
    };
  }

  const [branch, statusShort, remote] = await Promise.all([
    runCommand("git", ["branch", "--show-current"], { cwd: projectPath }),
    runCommand("git", ["status", "--short"], { cwd: projectPath }),
    runCommand("git", ["remote", "get-url", "origin"], { cwd: projectPath })
  ]);

  return {
    branch: branch.code === 0 ? branch.stdout.trim() : "",
    dirty: statusShort.code === 0 ? statusShort.stdout.trim().length > 0 : false,
    remoteUrl: remote.code === 0 ? remote.stdout.trim() : "",
    statusSummary: statusShort.code === 0 ? statusShort.stdout.trim() : statusShort.stderr.trim()
  };
}

async function listGitBranches(projectPath) {
  if (!projectPath || !(await fileExists(projectPath))) {
    return [];
  }

  const result = await runCommand(
    "git",
    ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    { cwd: projectPath }
  );

  if (result.code !== 0) {
    return [];
  }

  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

async function checkoutGitBranch(projectPath, branchName) {
  const result = await runCommand("git", ["checkout", branchName], { cwd: projectPath });
  if (result.code !== 0) {
    throw new Error(result.stderr || `Failed to switch to branch "${branchName}".`);
  }
}

function defaultStageConfig(project) {
  return {
    implementation: {
      mode: project.defaults?.implementationMode ?? "codex",
      enabled: true
    },
    review: {
      mode: project.defaults?.reviewMode ?? "codex_review",
      enabled: true
    },
    simplify: {
      mode: project.defaults?.simplifyMode ?? "simplify_skill",
      enabled: true
    },
    sync: {
      mode: project.defaults?.syncMode ?? "push_pr",
      enabled: true
    }
  };
}

function taskTypeConfig(taskType) {
  const normalized = cleanText(taskType, "coding");
  if (normalized === "understanding") {
    return {
      implementationLabel: "understanding",
      reviewLabel: "checking understanding",
      simplifyLabel: "refining notes"
    };
  }

  if (normalized === "summarization") {
    return {
      implementationLabel: "summarizing",
      reviewLabel: "checking summary",
      simplifyLabel: "tightening summary"
    };
  }

  if (normalized === "research") {
    return {
      implementationLabel: "investigating",
      reviewLabel: "reviewing findings",
      simplifyLabel: "distilling findings"
    };
  }

  return {
    implementationLabel: "implementing",
    reviewLabel: "reviewing",
    simplifyLabel: "simplifying"
  };
}

function formatPrompt(task, project, stage) {
  const typeConfig = taskTypeConfig(task.type);
  const promptLines = [
    `Project: ${project.name}`,
    `GitHub: ${project.githubUrl || "not provided"}`,
    `Branch: ${task.branch || project.activeBranch || project.defaultBranch || "main"}`,
    `Task type: ${task.type || "coding"}`,
    `Task headline: ${task.headline}`,
    `Stage: ${stage}`,
    "",
    "Task description:",
    task.description || "No description provided."
  ];

  if (task.subtasks.length > 0) {
    promptLines.push("", "Subtasks:");
    for (const subtask of task.subtasks) {
      promptLines.push(`- ${subtask}`);
    }
  }

  if (task.successCriteria.length > 0) {
    promptLines.push("", "Success criteria:");
    for (const criterion of task.successCriteria) {
      promptLines.push(`- ${criterion}`);
    }
  }

  promptLines.push(
    "",
    "Use the task folder as the shared context source of truth.",
    `Task folder: ${task.taskRoot}`,
    `Repository path: ${task.repoPath || project.repoPath || "not configured"}`
  );

  if (stage === "review") {
    promptLines.push(
      "",
      task.type === "coding"
        ? "Review this task with relatively fresh context. Focus on correctness, regressions, maintainability, and test risk."
        : `Approach this as ${typeConfig.reviewLabel}. Validate the understanding, summary, or findings with a fresh perspective.`
    );
  }

  if (stage === "implementation") {
    promptLines.push(
      "",
      task.type === "coding"
        ? "Aim for a working, reviewable solution. Do not over-optimize."
        : `Focus on ${typeConfig.implementationLabel}. Produce a clear, useful result in the task folder.`
    );
  }

  if (stage === "simplify") {
    promptLines.push(
      "",
      task.type === "coding"
        ? "Simplify complexity while preserving behavior. If simplification is unnecessary, record that clearly."
        : `Focus on ${typeConfig.simplifyLabel}. Make the output clearer, shorter, and easier to consume.`
    );
  }

  return `${promptLines.join("\n")}\n`;
}

function serializeSession(session) {
  return {
    ...session,
    liveStatus: activeSessions.has(session.id) ? "running" : session.status
  };
}

async function appendLog(logPath, content) {
  const existing = await readText(logPath, "");
  await writeText(logPath, `${existing}${content}`);
}

async function createProjectScaffold(input) {
  const slug = slugify(input.name || path.basename(input.repoPath || input.githubUrl || "project"));
  const dir = projectDir(slug);

  if (await fileExists(dir)) {
    throw new Error(`Project "${slug}" already exists.`);
  }

  const gitInfo = await gitSnapshot(input.repoPath);
  const createdAt = nowIso();
  const project = {
    id: slug,
    slug,
    name: cleanText(input.name, path.basename(input.repoPath || slug)),
    headline: cleanText(input.headline),
    githubUrl: cleanText(input.githubUrl, gitInfo.remoteUrl),
    repoPath: cleanText(input.repoPath),
    defaultBranch: cleanText(input.defaultBranch, gitInfo.branch || "main"),
    activeBranch: cleanText(input.activeBranch, gitInfo.branch || "main"),
    notes: cleanText(input.notes),
    status: cleanText(input.status, "active"),
    defaults: {
      implementationMode: cleanText(input.implementationMode, "codex"),
      reviewMode: cleanText(input.reviewMode, "codex_review"),
      simplifyMode: cleanText(input.simplifyMode, "simplify_skill"),
      syncMode: cleanText(input.syncMode, "push_pr")
    },
    policies: {
      allowParallelRepoWrites: false,
      requireExplicitSyncFiles: true,
      reviewContextMode: "narrow"
    },
    sync: {
      githubRepo: cleanText(input.githubRepo),
      lastSyncedAt: null
    },
    createdAt,
    updatedAt: createdAt
  };

  await mkdir(tasksDir(slug), { recursive: true });
  await mkdir(path.join(sharedDir(slug), "architecture"), { recursive: true });
  await mkdir(path.join(sharedDir(slug), "conventions"), { recursive: true });
  await mkdir(path.join(sharedDir(slug), "decisions"), { recursive: true });
  await mkdir(path.join(sharedDir(slug), "references"), { recursive: true });
  await mkdir(projectRunsDir(slug), { recursive: true });
  await mkdir(syncPendingDir(slug), { recursive: true });
  await mkdir(syncHistoryDir(slug), { recursive: true });

  await writeJson(projectFilePath(slug), project);
  await writeText(
    path.join(sharedDir(slug), "README.md"),
    `# ${project.name}\n\n${project.headline || "Project shared context"}\n`
  );
  await writeJson(path.join(syncDir(slug), "github.json"), {
    githubUrl: project.githubUrl,
    defaultBranch: project.defaultBranch,
    defaultSyncMode: project.defaults.syncMode
  });

  return project;
}

async function createTaskScaffold(project, input) {
  const taskId = `${slugify(input.headline || "task")}-${Date.now()}`;
  const dir = taskDir(project.slug, taskId);
  const createdAt = nowIso();
  const subtasks = linesToArray(input.subtasks);
  const successCriteria = linesToArray(input.successCriteria);
  const repoPath = cleanText(input.repoPath, project.repoPath);
  const task = {
    id: taskId,
    projectId: project.id,
    projectSlug: project.slug,
    branch: cleanText(input.branch, project.activeBranch || project.defaultBranch || "main"),
    type: cleanText(input.type, "coding"),
    headline: cleanText(input.headline, "Untitled task"),
    description: cleanText(input.description),
    subtasks,
    successCriteria,
    status: cleanText(input.status, "ready"),
    priority: cleanText(input.priority, "medium"),
    repoPath,
    taskRoot: dir,
    stageConfig: {
      implementation: {
        mode: cleanText(input.implementationMode, project.defaults.implementationMode),
        enabled: true
      },
      review: {
        mode: cleanText(input.reviewMode, project.defaults.reviewMode),
        enabled: true
      },
      simplify: {
        mode: cleanText(input.simplifyMode, project.defaults.simplifyMode),
        enabled: true
      },
      sync: {
        mode: cleanText(input.syncMode, project.defaults.syncMode),
        enabled: true
      }
    },
    sync: {
      enabled: true,
      mode: cleanText(input.syncMode, project.defaults.syncMode),
      allowedFiles: [],
      branchName: "",
      lastSyncedAt: null
    },
    latest: {
      implementationRunId: null,
      reviewRunId: null,
      simplifyRunId: null,
      syncRunId: null
    },
    createdAt,
    updatedAt: createdAt
  };

  await mkdir(path.join(dir, "context"), { recursive: true });
  await mkdir(path.join(dir, "artifacts"), { recursive: true });
  await mkdir(path.join(dir, "logs"), { recursive: true });
  await writeJson(taskFilePath(project.slug, taskId), task);
  await writeJson(taskLockPath(project.slug, taskId), {
    repo_write_lock: null,
    task_state_lock: null,
    review_lock: null,
    sync_lock: null
  });
  await writeText(path.join(dir, "prompt.md"), formatPrompt(task, project, "implementation"));
  await writeText(path.join(dir, "status.md"), `# Status\n\nCurrent state: ${task.status}\n\nNext step: Begin implementation or refine the task.\n`);
  await writeText(path.join(dir, "handoff.md"), "# Handoff\n\nNo handoff notes yet.\n");
  await writeText(path.join(dir, "review.md"), "# Review\n\nNo review has been run yet.\n");
  await writeText(path.join(dir, "implementation.md"), "# Implementation Notes\n\nNo implementation notes yet.\n");
  await writeText(path.join(dir, "simplify.md"), "# Simplify Notes\n\nNo simplify pass has been run yet.\n");
  await writeText(path.join(dir, "plan.md"), "# Plan\n\n1. Understand the task.\n2. Make the minimum effective change.\n3. Leave a reviewable result.\n");

  return task;
}

function taskBranch(task, project) {
  return cleanText(task.branch, project.activeBranch || project.defaultBranch || "main");
}

async function listTasksForProject(project, options = {}) {
  const dir = tasksDir(project.slug);
  if (!(await fileExists(dir))) {
    return [];
  }

  const activeBranch = cleanText(options.branch, project.activeBranch || project.defaultBranch || "main");

  const entries = await readdir(dir, { withFileTypes: true });
  const tasks = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const task = await readJson(taskFilePath(project.slug, entry.name));
    if (!task) {
      continue;
    }

    const lock = await readJson(taskLockPath(project.slug, entry.name), {
      repo_write_lock: null,
      task_state_lock: null,
      review_lock: null,
      sync_lock: null
    });

    const syncJobs = await listSyncJobs(project.slug, task.id);
    const hydratedTask = {
      ...task,
      branch: taskBranch(task, project),
      lock,
      syncJobs
    };

    if (options.includeAll || hydratedTask.branch === activeBranch) {
      tasks.push(hydratedTask);
    }
  }

  tasks.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  return tasks;
}

async function listSyncJobs(projectSlug, taskId) {
  const pending = syncPendingDir(projectSlug);
  const history = syncHistoryDir(projectSlug);
  const jobs = [];

  for (const dir of [pending, history]) {
    if (!(await fileExists(dir))) {
      continue;
    }

    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const job = await readJson(path.join(dir, entry.name));
      if (job?.taskId === taskId) {
        jobs.push(job);
      }
    }
  }

  jobs.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  return jobs.slice(0, 5);
}

async function listProjects() {
  if (!(await fileExists(projectsRoot))) {
    return [];
  }

  const entries = await readdir(projectsRoot, { withFileTypes: true });
  const projects = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const project = await readJson(projectFilePath(entry.name));
    if (!project) {
      continue;
    }

    const gitInfo = await gitSnapshot(project.repoPath);
    const branches = await listGitBranches(project.repoPath);
    const activeBranch = cleanText(project.activeBranch, gitInfo.branch || project.defaultBranch || "main");
    const tasks = await listTasksForProject({ ...project, activeBranch }, { branch: activeBranch });
    const allTasks = await listTasksForProject({ ...project, activeBranch }, { includeAll: true });
    const activeRepoLock = allTasks.find((task) => task.lock?.repo_write_lock);

    projects.push({
      ...project,
      activeBranch,
      branches,
      tasks,
      git: gitInfo,
      activeRepoLock: activeRepoLock
        ? {
          taskId: activeRepoLock.id,
          headline: activeRepoLock.headline,
          owner: activeRepoLock.lock.repo_write_lock
        }
        : null
    });
  }

  projects.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  return projects;
}

async function getProjectById(projectId) {
  const project = await readJson(projectFilePath(projectId));
  if (!project) {
    return null;
  }

  const gitInfo = await gitSnapshot(project.repoPath);
  const branches = await listGitBranches(project.repoPath);
  const activeBranch = cleanText(project.activeBranch, gitInfo.branch || project.defaultBranch || "main");
  const tasks = await listTasksForProject({ ...project, activeBranch }, { branch: activeBranch });
  return {
    ...project,
    activeBranch,
    branches,
    tasks,
    git: gitInfo
  };
}

async function getTaskById(taskId) {
  const projects = await listProjects();
  for (const project of projects) {
    const task = (await listTasksForProject(project, { includeAll: true })).find((item) => item.id === taskId);
    if (task) {
      return { project, task };
    }
  }

  return null;
}

async function updateProject(project) {
  project.updatedAt = nowIso();
  await writeJson(projectFilePath(project.slug), project);
}

async function updateTask(projectSlug, task) {
  task.updatedAt = nowIso();
  await writeJson(taskFilePath(projectSlug, task.id), task);
}

async function updateTaskMarkdown(task, project, stage) {
  await writeText(path.join(task.taskRoot, "prompt.md"), formatPrompt(task, project, stage));
  await writeText(
    path.join(task.taskRoot, "status.md"),
    `# Status\n\nCurrent state: ${task.status}\n\nHeadline: ${task.headline}\n\nSuccess criteria:\n${task.successCriteria.map((item) => `- ${item}`).join("\n") || "- None provided"}\n`
  );
}

async function acquireRepoWriteLock(project, task, owner) {
  const tasks = await listTasksForProject(project, { includeAll: true });
  const conflictingTask = tasks.find((item) => item.id !== task.id && item.lock?.repo_write_lock);

  if (conflictingTask) {
    throw new Error(`Repo is currently locked by task "${conflictingTask.headline}".`);
  }

  const lock = await readJson(taskLockPath(project.slug, task.id), {});
  lock.repo_write_lock = owner;
  await writeJson(taskLockPath(project.slug, task.id), lock);
}

async function releaseRepoWriteLock(projectSlug, taskId) {
  const lock = await readJson(taskLockPath(projectSlug, taskId), {});
  lock.repo_write_lock = null;
  await writeJson(taskLockPath(projectSlug, taskId), lock);
}

async function stageDashboardFiles() {
  const addProjects = await runCommand("git", ["add", "projects", "data/runtime.json", "AGENTS.md", "docs"], { cwd: repoRoot });
  if (addProjects.code !== 0) {
    throw new Error(addProjects.stderr || "Failed to stage dashboard files.");
  }
}

async function maybeAutoSync(runtime) {
  if (!runtime.settings.autoSyncOnWrite) {
    return;
  }

  await stageDashboardFiles();
  await commitDashboardState(runtime.settings.defaultCommitMessage);
}

async function commitDashboardState(message) {
  const commitResult = await runCommand("git", ["commit", "-m", message], { cwd: repoRoot });
  if (commitResult.code !== 0) {
    const combined = `${commitResult.stdout}\n${commitResult.stderr}`;
    if (combined.includes("nothing to commit")) {
      return { ok: true, changed: false, message: "No changes to commit." };
    }
    throw new Error(commitResult.stderr || "Failed to commit dashboard state.");
  }

  return { ok: true, changed: true, message: commitResult.stdout.trim() };
}

async function pushDashboardState() {
  const branch = await currentRepoBranch();
  const result = await runCommand("git", ["push", "origin", branch], { cwd: repoRoot });
  if (result.code !== 0) {
    throw new Error(result.stderr || "Failed to push dashboard state.");
  }

  return { ok: true, message: result.stdout.trim() || `Pushed to origin/${branch}.` };
}

function runnerForMode(mode) {
  if (mode === "codex" || mode === "codex_review" || mode === "codex_refactor") {
    return { runner: "codex", args: (prompt) => ["exec", prompt] };
  }

  if (mode === "claude" || mode === "claude_review") {
    return { runner: "claude", args: (prompt) => ["-p", prompt] };
  }

  return null;
}

async function startStageSession({ taskId, stage }) {
  const found = await getTaskById(taskId);
  if (!found) {
    throw new Error("Task not found.");
  }

  const { project, task } = found;
  const stageMode = task.stageConfig?.[stage]?.mode;
  const runnerConfig = runnerForMode(stageMode);
  if (!runnerConfig) {
    throw new Error(`Stage "${stage}" is configured as "${stageMode}", which is not a launchable agent mode.`);
  }

  const runtime = await readRuntime();
  const repoPath = task.repoPath || project.repoPath;
  if (!repoPath || !(await fileExists(repoPath))) {
    throw new Error("A valid local repository path is required before launching an agent stage.");
  }

  const sessionId = generateId("session");
  const logPath = path.join(logsDir, `${sessionId}.log`);
  const command = runnerConfig.runner === "claude" ? runtime.settings.claudeCommand : runtime.settings.codexCommand;
  const prompt = formatPrompt(task, project, stage);
  const args = runnerConfig.args(prompt);
  const startedAt = nowIso();
  const writesRepo = stage === "implementation" || stage === "simplify";

  if (writesRepo) {
    await acquireRepoWriteLock(project, task, `${stage}:${sessionId}`);
  }

  task.status = stage === "implementation" ? "implementing" : stage === "review" ? "reviewing" : "simplifying";
  task.latest[`${stage}RunId`] = sessionId;
  await updateTask(task.projectSlug, task);
  await updateTaskMarkdown(task, project, stage);

  project.updatedAt = nowIso();
  await updateProject(project);

  const session = {
    id: sessionId,
    taskId: task.id,
    taskHeadline: task.headline,
    projectId: project.id,
    projectName: project.name,
    stage,
    mode: stageMode,
    command,
    args,
    cwd: repoPath,
    status: "running",
    logPath,
    startedAt,
    updatedAt: startedAt,
    endedAt: null,
    exitCode: null
  };

  runtime.sessions.unshift(session);
  await writeRuntime(runtime);

  const child = spawn(command, args, {
    cwd: repoPath,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"]
  });

  activeSessions.set(sessionId, child);
  await writeText(logPath, `[${startedAt}] Starting ${stage} via ${stageMode} in ${repoPath}\n\n`);

  child.stdout.on("data", (chunk) => {
    void appendLog(logPath, chunk.toString("utf8"));
  });

  child.stderr.on("data", (chunk) => {
    void appendLog(logPath, `[stderr] ${chunk.toString("utf8")}`);
  });

  const finalize = async (status, exitCode, errorMessage = "") => {
    activeSessions.delete(sessionId);

    const latestRuntime = await readRuntime();
    const runtimeSession = latestRuntime.sessions.find((item) => item.id === sessionId);
    if (runtimeSession) {
      runtimeSession.status = status;
      runtimeSession.exitCode = exitCode;
      runtimeSession.endedAt = nowIso();
      runtimeSession.updatedAt = runtimeSession.endedAt;
    }
    await writeRuntime(latestRuntime);

    const latestFound = await getTaskById(task.id);
    if (!latestFound) {
      return;
    }

    const latestProject = latestFound.project;
    const latestTask = latestFound.task;

    latestTask.status = status === "completed"
      ? stage === "implementation"
        ? "reviewing"
        : stage === "review"
          ? "ready_to_sync"
          : "ready_to_sync"
      : "blocked";

    await updateTask(latestProject.slug, latestTask);
    await updateTaskMarkdown(latestTask, latestProject, stage);

    if (writesRepo) {
      await releaseRepoWriteLock(latestProject.slug, latestTask.id);
    }

    if (errorMessage) {
      await appendLog(logPath, `\n[process-error] ${errorMessage}\n`);
    }
    await appendLog(logPath, `\n[${nowIso()}] Process exited with code ${exitCode}\n`);
  };

  child.on("error", (error) => {
    void finalize("failed", -1, error.message);
  });

  child.on("close", (code) => {
    void finalize(code === 0 ? "completed" : "failed", code ?? -1);
  });

  return session;
}

async function stopAgentSession(sessionId) {
  const child = activeSessions.get(sessionId);
  if (!child) {
    return false;
  }

  child.kill("SIGTERM");
  activeSessions.delete(sessionId);
  return true;
}

async function createSyncJob(taskId, input) {
  const found = await getTaskById(taskId);
  if (!found) {
    throw new Error("Task not found.");
  }

  const { project, task } = found;
  const files = linesToArray(input.files);
  const job = {
    id: generateId("sync"),
    taskId: task.id,
    projectId: project.id,
    mode: cleanText(input.mode, task.stageConfig.sync.mode),
    files,
    branchName: cleanText(input.branchName),
    commitMessage: cleanText(input.commitMessage, `chore(${project.slug}): sync ${task.headline}`),
    status: "pending",
    createdAt: nowIso()
  };

  await writeJson(path.join(syncPendingDir(project.slug), `${job.id}.json`), job);
  task.sync.allowedFiles = files;
  task.sync.mode = job.mode;
  task.sync.branchName = job.branchName;
  await updateTask(project.slug, task);
  await writeText(
    path.join(task.taskRoot, "handoff.md"),
    `# Handoff\n\nLatest sync intent:\n\n- mode: ${job.mode}\n- branch: ${job.branchName || "current branch"}\n- files:\n${files.map((item) => `  - ${item}`).join("\n") || "  - none"}\n`
  );

  return job;
}

async function runSyncJob(taskId, input) {
  const found = await getTaskById(taskId);
  if (!found) {
    throw new Error("Task not found.");
  }

  const { project, task } = found;
  const repoPath = task.repoPath || project.repoPath;
  if (!repoPath || !(await fileExists(repoPath))) {
    throw new Error("A valid local repository path is required before syncing.");
  }

  const tasks = await listTasksForProject(project, { includeAll: true });
  const lockedTask = tasks.find((item) => item.lock?.repo_write_lock);
  if (lockedTask) {
    throw new Error(`Cannot sync while repo lock is active on "${lockedTask.headline}".`);
  }

  const files = linesToArray(input.files || task.sync.allowedFiles.join("\n"));
  if (files.length === 0) {
    throw new Error("At least one file must be selected for sync.");
  }

  const mode = cleanText(input.mode, task.sync.mode || "commit_only");
  const branchName = cleanText(input.branchName, task.sync.branchName);
  const commitMessage = cleanText(input.commitMessage, `chore(${project.slug}): sync ${task.headline}`);
  const syncLock = await readJson(taskLockPath(project.slug, task.id), {});
  syncLock.sync_lock = `sync:${nowIso()}`;
  await writeJson(taskLockPath(project.slug, task.id), syncLock);

  try {
    if (branchName) {
      const current = await runCommand("git", ["branch", "--show-current"], { cwd: repoPath });
      if (current.code !== 0) {
        throw new Error(current.stderr || "Failed to read current branch.");
      }
      if (current.stdout.trim() !== branchName) {
        await checkoutGitBranch(repoPath, branchName);
      }
    }

    const addResult = await runCommand("git", ["add", "--", ...files], { cwd: repoPath });
    if (addResult.code !== 0) {
      throw new Error(addResult.stderr || "Failed to stage selected files.");
    }

    const commitResult = await runCommand("git", ["commit", "-m", commitMessage], { cwd: repoPath });
    if (commitResult.code !== 0) {
      const combined = `${commitResult.stdout}\n${commitResult.stderr}`;
      if (!combined.includes("nothing to commit")) {
        throw new Error(commitResult.stderr || "Failed to commit selected files.");
      }
    }

    let pushSummary = "Commit created locally.";
    if (mode === "push" || mode === "push_pr") {
      const current = await runCommand("git", ["branch", "--show-current"], { cwd: repoPath });
      const activeBranch = current.code === 0 ? current.stdout.trim() : branchName;
      const push = await runCommand("git", ["push", "-u", "origin", activeBranch], { cwd: repoPath });
      if (push.code !== 0) {
        throw new Error(push.stderr || "Failed to push branch.");
      }
      pushSummary = push.stdout.trim() || `Pushed ${activeBranch}.`;
    }

    const job = {
      id: generateId("sync"),
      taskId: task.id,
      projectId: project.id,
      mode,
      files,
      branchName,
      commitMessage,
      status: "completed",
      createdAt: nowIso(),
      summary: pushSummary
    };
    await writeJson(path.join(syncHistoryDir(project.slug), `${job.id}.json`), job);

    task.sync.allowedFiles = files;
    task.sync.mode = mode;
    task.sync.branchName = branchName;
    task.sync.lastSyncedAt = nowIso();
    task.latest.syncRunId = job.id;
    task.status = "synced";
    await updateTask(project.slug, task);
    return job;
  } finally {
    const latestLock = await readJson(taskLockPath(project.slug, task.id), {});
    latestLock.sync_lock = null;
    await writeJson(taskLockPath(project.slug, task.id), latestLock);
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);

  try {
    const content = await readFile(filePath);
    const ext = path.extname(filePath);
    const contentType = ({
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml"
    })[ext] ?? "application/octet-stream";
    respondText(res, 200, content, contentType);
  } catch {
    notFound(res);
  }
}

async function handleApi(req, res) {
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "GET" && url.pathname === "/api/state") {
    const runtime = await readRuntime();
    const projects = await listProjects();
    respondJson(res, 200, {
      runtime: {
        ...runtime,
        sessions: runtime.sessions.map(serializeSession)
      },
      projects
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects") {
    const body = await parseBody(req);
    const project = await createProjectScaffold(body);
    const runtime = await readRuntime();
    await stageDashboardFiles();
    await maybeAutoSync(runtime);
    respondJson(res, 201, project);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects/import") {
    const body = await parseBody(req);
    const rootPath = cleanText(body.rootPath);
    if (!rootPath) {
      respondJson(res, 400, { error: "Root path is required." });
      return;
    }

    const entries = await readdir(rootPath, { withFileTypes: true });
    const added = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const repoPath = path.join(rootPath, entry.name);
      if (!(await fileExists(path.join(repoPath, ".git")))) {
        continue;
      }

      const slug = slugify(entry.name);
      if (await fileExists(projectDir(slug))) {
        continue;
      }

      const gitInfo = await gitSnapshot(repoPath);
      added.push(await createProjectScaffold({
        name: entry.name,
        repoPath,
        githubUrl: gitInfo.remoteUrl,
        headline: `Imported from ${rootPath}`
      }));
    }

    const runtime = await readRuntime();
    runtime.scanRoots = Array.from(new Set([...runtime.scanRoots, rootPath]));
    await writeRuntime(runtime);
    await stageDashboardFiles();
    await maybeAutoSync(runtime);
    respondJson(res, 200, { count: added.length, added });
    return;
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "projects" && parts[2] && parts[3] === "tasks") {
    const project = await getProjectById(parts[2]);
    if (!project) {
      respondJson(res, 404, { error: "Project not found." });
      return;
    }

    const task = await createTaskScaffold(project, await parseBody(req));
    await stageDashboardFiles();
    const runtime = await readRuntime();
    await maybeAutoSync(runtime);
    respondJson(res, 201, task);
    return;
  }

  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "projects" && parts[2]) {
    const project = await getProjectById(parts[2]);
    if (!project) {
      respondJson(res, 404, { error: "Project not found." });
      return;
    }

    const body = await parseBody(req);
    project.name = body.name !== undefined ? cleanText(body.name, project.name) : project.name;
    project.headline = body.headline !== undefined ? cleanText(body.headline, project.headline) : project.headline;
    project.repoPath = body.repoPath !== undefined ? cleanText(body.repoPath, project.repoPath) : project.repoPath;
    project.githubUrl = body.githubUrl !== undefined ? cleanText(body.githubUrl, project.githubUrl) : project.githubUrl;
    project.notes = body.notes !== undefined ? cleanText(body.notes, project.notes) : project.notes;
    project.activeBranch = body.activeBranch !== undefined ? cleanText(body.activeBranch, project.activeBranch) : project.activeBranch;
    if (body.implementationMode !== undefined) {
      project.defaults.implementationMode = cleanText(body.implementationMode, project.defaults.implementationMode);
    }
    if (body.reviewMode !== undefined) {
      project.defaults.reviewMode = cleanText(body.reviewMode, project.defaults.reviewMode);
    }
    if (body.simplifyMode !== undefined) {
      project.defaults.simplifyMode = cleanText(body.simplifyMode, project.defaults.simplifyMode);
    }
    if (body.syncMode !== undefined) {
      project.defaults.syncMode = cleanText(body.syncMode, project.defaults.syncMode);
    }
    await updateProject(project);
    await stageDashboardFiles();
    const runtime = await readRuntime();
    await maybeAutoSync(runtime);
    respondJson(res, 200, project);
    return;
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "projects" && parts[2] && parts[3] === "branch") {
    const project = await getProjectById(parts[2]);
    if (!project) {
      respondJson(res, 404, { error: "Project not found." });
      return;
    }

    const body = await parseBody(req);
    const branchName = cleanText(body.branch);
    if (!branchName) {
      respondJson(res, 400, { error: "Branch is required." });
      return;
    }
    if (!project.repoPath || !(await fileExists(project.repoPath))) {
      respondJson(res, 400, { error: "A valid local repo path is required before switching branches." });
      return;
    }

    await checkoutGitBranch(project.repoPath, branchName);
    project.activeBranch = branchName;
    await updateProject(project);
    await stageDashboardFiles();
    const runtime = await readRuntime();
    await maybeAutoSync(runtime);
    respondJson(res, 200, { ok: true, branch: branchName });
    return;
  }

  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "tasks" && parts[2]) {
    const found = await getTaskById(parts[2]);
    if (!found) {
      respondJson(res, 404, { error: "Task not found." });
      return;
    }

    const body = await parseBody(req);
    const { project, task } = found;
    task.headline = body.headline !== undefined ? cleanText(body.headline, task.headline) : task.headline;
    task.description = body.description !== undefined ? cleanText(body.description, task.description) : task.description;
    task.subtasks = body.subtasks !== undefined ? linesToArray(body.subtasks) : task.subtasks;
    task.successCriteria = body.successCriteria !== undefined ? linesToArray(body.successCriteria) : task.successCriteria;
    task.status = body.status !== undefined ? cleanText(body.status, task.status) : task.status;
    task.priority = body.priority !== undefined ? cleanText(body.priority, task.priority) : task.priority;
    task.branch = body.branch !== undefined ? cleanText(body.branch, task.branch) : task.branch;
    task.type = body.type !== undefined ? cleanText(body.type, task.type) : task.type;
    if (body.implementationMode !== undefined) {
      task.stageConfig.implementation.mode = cleanText(body.implementationMode, task.stageConfig.implementation.mode);
    }
    if (body.reviewMode !== undefined) {
      task.stageConfig.review.mode = cleanText(body.reviewMode, task.stageConfig.review.mode);
    }
    if (body.simplifyMode !== undefined) {
      task.stageConfig.simplify.mode = cleanText(body.simplifyMode, task.stageConfig.simplify.mode);
    }
    if (body.syncMode !== undefined) {
      task.stageConfig.sync.mode = cleanText(body.syncMode, task.stageConfig.sync.mode);
      task.sync.mode = task.stageConfig.sync.mode;
    }
    await updateTask(project.slug, task);
    await updateTaskMarkdown(task, project, "implementation");
    await stageDashboardFiles();
    const runtime = await readRuntime();
    await maybeAutoSync(runtime);
    respondJson(res, 200, task);
    return;
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "tasks" && parts[2] && parts[3] === "launch") {
    const body = await parseBody(req);
    const session = await startStageSession({
      taskId: parts[2],
      stage: cleanText(body.stage, "implementation")
    });
    respondJson(res, 201, session);
    return;
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "tasks" && parts[2] && parts[3] === "sync-jobs") {
    const job = await createSyncJob(parts[2], await parseBody(req));
    await stageDashboardFiles();
    const runtime = await readRuntime();
    await maybeAutoSync(runtime);
    respondJson(res, 201, job);
    return;
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "tasks" && parts[2] && parts[3] === "sync") {
    const job = await runSyncJob(parts[2], await parseBody(req));
    respondJson(res, 200, job);
    return;
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "sessions" && parts[2] && parts[3] === "stop") {
    const stopped = await stopAgentSession(parts[2]);
    respondJson(res, 200, { stopped });
    return;
  }

  if (req.method === "GET" && parts[0] === "api" && parts[1] === "sessions" && parts[2] && parts[3] === "log") {
    const runtime = await readRuntime();
    const session = runtime.sessions.find((item) => item.id === parts[2]);
    if (!session) {
      respondJson(res, 404, { error: "Session not found." });
      return;
    }

    respondJson(res, 200, {
      id: session.id,
      content: await readText(session.logPath, "")
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/dashboard/commit") {
    const body = await parseBody(req);
    await stageDashboardFiles();
    const runtime = await readRuntime();
    const result = await commitDashboardState(cleanText(body.message, runtime.settings.defaultCommitMessage));
    respondJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/dashboard/push") {
    const result = await pushDashboardState();
    respondJson(res, 200, result);
    return;
  }

  if (req.method === "PATCH" && url.pathname === "/api/settings") {
    const body = await parseBody(req);
    const runtime = await readRuntime();
    runtime.settings.autoSyncOnWrite = body.autoSyncOnWrite === undefined
      ? runtime.settings.autoSyncOnWrite
      : Boolean(body.autoSyncOnWrite);
    runtime.settings.defaultCommitMessage = body.defaultCommitMessage === undefined
      ? runtime.settings.defaultCommitMessage
      : cleanText(body.defaultCommitMessage, runtime.settings.defaultCommitMessage);
    runtime.settings.claudeCommand = body.claudeCommand === undefined
      ? runtime.settings.claudeCommand
      : cleanText(body.claudeCommand, runtime.settings.claudeCommand);
    runtime.settings.codexCommand = body.codexCommand === undefined
      ? runtime.settings.codexCommand
      : cleanText(body.codexCommand, runtime.settings.codexCommand);
    await writeRuntime(runtime);
    await stageDashboardFiles();
    respondJson(res, 200, runtime.settings);
    return;
  }

  notFound(res);
}

const server = createServer(async (req, res) => {
  try {
    if (req.url?.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    respondJson(res, 500, {
      error: error instanceof Error ? error.message : "Unexpected server error"
    });
  }
});

await ensureWorkspace();

const port = Number(process.env.PORT || 4312);
const host = process.env.HOST || "127.0.0.1";
if (process.env.DISABLE_LISTEN === "1") {
  console.log("Dashboard initialized in smoke-test mode.");
} else {
  server.listen(port, host, () => {
    console.log(`Dashboard running on http://${host}:${port}`);
  });
}
