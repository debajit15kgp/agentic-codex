const state = {
  data: null,
  selectedSessionId: null
};

const projectCount = document.querySelector("#projectCount");
const taskCount = document.querySelector("#taskCount");
const runningCount = document.querySelector("#runningCount");
const projectsList = document.querySelector("#projectsList");
const sessionsList = document.querySelector("#sessionsList");
const autoSyncToggle = document.querySelector("#autoSyncToggle");
const projectTemplate = document.querySelector("#projectTemplate");
const taskTemplate = document.querySelector("#taskTemplate");
const sessionTemplate = document.querySelector("#sessionTemplate");
const projectForm = document.querySelector("#projectForm");
const importForm = document.querySelector("#importForm");
const logViewer = document.querySelector("#logViewer");
const loadLogButton = document.querySelector("#loadLogButton");

function statusLabel(value) {
  return String(value).replaceAll("_", " ");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload;
}

async function loadState() {
  state.data = await api("/api/state");
  render();
}

function renderStats() {
  const projects = state.data.projects ?? [];
  const tasks = projects.flatMap((project) => project.tasks ?? []);
  const running = (state.data.runtime.sessions ?? []).filter((session) => session.liveStatus === "running");

  projectCount.textContent = String(projects.length);
  taskCount.textContent = String(tasks.filter((task) => !["done", "synced"].includes(task.status)).length);
  runningCount.textContent = String(running.length);
  autoSyncToggle.checked = Boolean(state.data.runtime.settings.autoSyncOnWrite);
}

function modeSummary(task) {
  return [
    `Implement: ${task.stageConfig.implementation.mode}`,
    `Review: ${task.stageConfig.review.mode}`,
    `Simplify: ${task.stageConfig.simplify.mode}`,
    `Sync: ${task.stageConfig.sync.mode}`
  ].join(" • ");
}

async function runStage(taskId, stage) {
  await api(`/api/tasks/${taskId}/launch`, {
    method: "POST",
    body: JSON.stringify({ stage })
  });
  await loadState();
}

async function queueSync(taskId, syncForm) {
  const formData = new FormData(syncForm);
  await api(`/api/tasks/${taskId}/sync-jobs`, {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(formData))
  });
  await loadState();
}

async function runSync(taskId, syncForm) {
  const formData = new FormData(syncForm);
  await api(`/api/tasks/${taskId}/sync`, {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(formData))
  });
  await loadState();
}

function buildTaskCard(project, task) {
  const fragment = taskTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".task-card");

  fragment.querySelector(".task-title").textContent = task.headline;
  fragment.querySelector(".task-detail").textContent = task.description || "No description yet.";
  fragment.querySelector(".task-status").textContent = statusLabel(task.status);
  fragment.querySelector(".task-root").textContent = task.taskRoot;
  fragment.querySelector(".task-modes").textContent = modeSummary(task);
  fragment.querySelector(".task-priority").textContent = `Priority: ${task.priority}`;
  fragment.querySelector(".task-subtasks").textContent = `${task.subtasks.length} subtasks`;
  fragment.querySelector(".task-success").textContent = `${task.successCriteria.length} success checks`;

  const implementationButton = fragment.querySelector(".task-launch-implementation");
  const reviewButton = fragment.querySelector(".task-launch-review");
  const simplifyButton = fragment.querySelector(".task-launch-simplify");

  implementationButton.disabled = !["codex", "claude"].includes(task.stageConfig.implementation.mode);
  reviewButton.disabled = !["codex_review", "claude_review"].includes(task.stageConfig.review.mode);
  simplifyButton.disabled = !["codex_refactor"].includes(task.stageConfig.simplify.mode);

  implementationButton.addEventListener("click", async () => {
    await runStage(task.id, "implementation");
  });
  reviewButton.addEventListener("click", async () => {
    await runStage(task.id, "review");
  });
  simplifyButton.addEventListener("click", async () => {
    await runStage(task.id, "simplify");
  });

  const syncForm = fragment.querySelector(".sync-form");
  if (task.sync.allowedFiles.length > 0) {
    syncForm.elements.files.value = task.sync.allowedFiles.join("\n");
  }
  syncForm.elements.branchName.value = task.sync.branchName || "";
  syncForm.elements.mode.value = task.sync.mode || "push_pr";

  fragment.querySelector(".task-queue-sync").addEventListener("click", async () => {
    await queueSync(task.id, syncForm);
  });

  fragment.querySelector(".task-run-sync").addEventListener("click", async () => {
    await runSync(task.id, syncForm);
  });

  const syncHistory = fragment.querySelector(".sync-history");
  if ((task.syncJobs ?? []).length === 0) {
    syncHistory.innerHTML = `<p class="empty">No sync jobs yet. Add selected files and queue one when ready.</p>`;
  } else {
    syncHistory.innerHTML = task.syncJobs
      .map((job) => `
        <div class="sync-chip">
          <strong>${job.mode}</strong>
          <span>${job.status}</span>
          <span>${job.files?.length ?? 0} files</span>
        </div>
      `)
      .join("");
  }

  return card;
}

function buildProjectCard(project) {
  const fragment = projectTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".project-card");

  fragment.querySelector(".project-name").textContent = project.name;
  fragment.querySelector(".project-meta").textContent = `${project.repoPath || "No local repo path yet"} ${project.git?.branch ? `• ${project.git.branch}` : ""}`;
  fragment.querySelector(".project-headline").textContent = project.headline || "No project headline yet.";
  fragment.querySelector(".project-branch").textContent = project.defaultBranch || "main";
  fragment.querySelector(".project-lock").textContent = project.activeRepoLock ? `Locked by ${project.activeRepoLock.headline}` : "Repo unlocked";
  fragment.querySelector(".project-shared-root").textContent = `projects/${project.slug}/shared`;
  fragment.querySelector(".project-github").textContent = project.githubUrl || "No GitHub URL yet.";

  const taskForm = fragment.querySelector(".task-form");
  taskForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(taskForm);
    await api(`/api/projects/${project.id}/tasks`, {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(formData))
    });
    taskForm.reset();
    await loadState();
  });

  const taskList = fragment.querySelector(".task-list");
  if ((project.tasks ?? []).length === 0) {
    taskList.innerHTML = `<p class="empty">No tasks yet. Capture one here using headline, text, subtasks, and success criteria.</p>`;
  } else {
    for (const task of project.tasks) {
      taskList.append(buildTaskCard(project, task));
    }
  }

  return card;
}

function buildSessionCard(session) {
  const fragment = sessionTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".session-card");
  fragment.querySelector(".session-title").textContent = `${session.projectName} → ${session.taskHeadline}`;
  fragment.querySelector(".session-meta").textContent = `${session.stage} • ${session.mode} • ${session.startedAt}`;
  fragment.querySelector(".session-status").textContent = session.liveStatus;
  fragment.querySelector(".session-command").textContent = `${session.command} ${session.args.join(" ")}`;

  fragment.querySelector(".session-log").addEventListener("click", async () => {
    state.selectedSessionId = session.id;
    await loadLog();
  });

  fragment.querySelector(".session-stop").addEventListener("click", async () => {
    await api(`/api/sessions/${session.id}/stop`, { method: "POST" });
    await loadState();
  });

  return card;
}

function renderProjects() {
  projectsList.innerHTML = "";

  if ((state.data.projects ?? []).length === 0) {
    projectsList.innerHTML = `<p class="empty">No projects yet. You can create one with just a name and GitHub URL, then attach a local repo path later when you want coding or sync.</p>`;
    return;
  }

  for (const project of state.data.projects) {
    projectsList.append(buildProjectCard(project));
  }
}

function renderSessions() {
  sessionsList.innerHTML = "";
  const sessions = state.data.runtime.sessions ?? [];
  if (sessions.length === 0) {
    sessionsList.innerHTML = `<p class="empty">No active or past stage runs yet.</p>`;
    return;
  }

  for (const session of sessions) {
    sessionsList.append(buildSessionCard(session));
  }
}

function render() {
  renderStats();
  renderProjects();
  renderSessions();
}

async function loadLog() {
  if (!state.selectedSessionId) {
    logViewer.textContent = "Choose a stage run to inspect logs.";
    return;
  }

  const payload = await api(`/api/sessions/${state.selectedSessionId}/log`);
  logViewer.textContent = payload.content || "No log output yet.";
}

projectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(projectForm);
  await api("/api/projects", {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(formData))
  });
  projectForm.reset();
  await loadState();
});

importForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(importForm);
  await api("/api/projects/import", {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(formData))
  });
  await loadState();
});

document.querySelector("#refreshButton").addEventListener("click", loadState);

document.querySelector("#commitButton").addEventListener("click", async () => {
  await api("/api/dashboard/commit", {
    method: "POST",
    body: JSON.stringify({})
  });
});

document.querySelector("#pushButton").addEventListener("click", async () => {
  await api("/api/dashboard/push", {
    method: "POST",
    body: JSON.stringify({})
  });
});

autoSyncToggle.addEventListener("change", async (event) => {
  await api("/api/settings", {
    method: "PATCH",
    body: JSON.stringify({ autoSyncOnWrite: event.target.checked })
  });
  await loadState();
});

loadLogButton.addEventListener("click", loadLog);

await loadState();
setInterval(loadState, 5000);
setInterval(loadLog, 5000);
