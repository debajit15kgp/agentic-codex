const state = {
  data: null,
  selectedSessionId: null,
  collapsedProjects: new Set()
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

function shouldPauseRefresh() {
  const active = document.activeElement;
  if (!active) {
    return false;
  }

  return ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
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
  const labels = stageLabels(task.type);
  return [
    `${labels.implementation}: ${task.stageConfig.implementation.mode}`,
    `${labels.review}: ${task.stageConfig.review.mode}`,
    `${labels.simplify}: ${task.stageConfig.simplify.mode}`,
    `Sync: ${task.stageConfig.sync.mode}`
  ].join(" • ");
}

function stageLabels(taskType) {
  if (taskType === "understanding") {
    return {
      implementation: "Understand",
      review: "Check",
      simplify: "Refine"
    };
  }

  if (taskType === "summarization") {
    return {
      implementation: "Summarize",
      review: "Verify",
      simplify: "Tighten"
    };
  }

  if (taskType === "research") {
    return {
      implementation: "Investigate",
      review: "Review",
      simplify: "Distill"
    };
  }

  return {
    implementation: "Implement",
    review: "Review",
    simplify: "Simplify"
  };
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

async function switchBranch(projectId, branch) {
  await api(`/api/projects/${projectId}/branch`, {
    method: "POST",
    body: JSON.stringify({ branch })
  });
  await loadState();
}

function toggleHidden(element) {
  element.classList.toggle("hidden");
}

function fillSelect(select, value) {
  if (value !== undefined && value !== null && select) {
    select.value = value;
  }
}

function buildTaskCard(project, task) {
  const fragment = taskTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".task-card");

  fragment.querySelector(".task-title").textContent = task.headline;
  fragment.querySelector(".task-detail").textContent = task.description || "No description yet.";
  fragment.querySelector(".task-status").textContent = statusLabel(task.status);
  fragment.querySelector(".task-root").textContent = task.taskRoot;
  fragment.querySelector(".task-branch").textContent = task.branch || project.activeBranch || "main";
  fragment.querySelector(".task-modes").textContent = modeSummary(task);
  fragment.querySelector(".task-type").textContent = `Type: ${task.type || "coding"}`;
  fragment.querySelector(".task-priority").textContent = `Priority: ${task.priority}`;
  fragment.querySelector(".task-subtasks").textContent = `${task.subtasks.length} subtasks`;
  fragment.querySelector(".task-success").textContent = `${task.successCriteria.length} success checks`;

  const taskEditForm = fragment.querySelector(".task-edit-form");
  fillSelect(taskEditForm.elements.type, task.type || "coding");
  taskEditForm.elements.headline.value = task.headline || "";
  taskEditForm.elements.branch.value = task.branch || project.activeBranch || "main";
  taskEditForm.elements.description.value = task.description || "";
  taskEditForm.elements.subtasks.value = (task.subtasks || []).join("\n");
  taskEditForm.elements.successCriteria.value = (task.successCriteria || []).join("\n");
  fillSelect(taskEditForm.elements.implementationMode, task.stageConfig.implementation.mode);
  fillSelect(taskEditForm.elements.reviewMode, task.stageConfig.review.mode);
  fillSelect(taskEditForm.elements.simplifyMode, task.stageConfig.simplify.mode);
  fillSelect(taskEditForm.elements.syncMode, task.stageConfig.sync.mode);

  fragment.querySelector(".task-edit-toggle").addEventListener("click", () => {
    toggleHidden(taskEditForm);
  });

  taskEditForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(taskEditForm);
    await api(`/api/tasks/${task.id}`, {
      method: "PATCH",
      body: JSON.stringify(Object.fromEntries(formData))
    });
    await loadState();
  });

  const implementationButton = fragment.querySelector(".task-launch-implementation");
  const reviewButton = fragment.querySelector(".task-launch-review");
  const simplifyButton = fragment.querySelector(".task-launch-simplify");
  const labels = stageLabels(task.type);
  implementationButton.textContent = `Run ${labels.implementation}`;
  reviewButton.textContent = `Run ${labels.review}`;
  simplifyButton.textContent = `Run ${labels.simplify}`;

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
  fragment.querySelector(".project-meta").textContent = `${project.repoPath || "No local repo path yet"} ${project.git?.branch ? `• checked out: ${project.git.branch}` : ""}`;
  fragment.querySelector(".project-headline").textContent = project.headline || "No project headline yet.";
  fragment.querySelector(".project-branch").textContent = `active ${project.activeBranch || project.defaultBranch || "main"}`;
  fragment.querySelector(".project-lock").textContent = project.activeRepoLock ? `Locked by ${project.activeRepoLock.headline}` : "Repo unlocked";
  fragment.querySelector(".project-shared-root").textContent = `projects/${project.slug}/shared`;
  fragment.querySelector(".project-github").textContent = project.githubUrl || "No GitHub URL yet.";
  const projectBody = fragment.querySelector(".project-body");
  const collapseButton = fragment.querySelector(".project-collapse-toggle");
  const isCollapsed = state.collapsedProjects.has(project.id);
  if (isCollapsed) {
    projectBody.classList.add("hidden");
    collapseButton.textContent = "Expand";
  } else {
    collapseButton.textContent = "Collapse";
  }

  collapseButton.addEventListener("click", () => {
    if (state.collapsedProjects.has(project.id)) {
      state.collapsedProjects.delete(project.id);
    } else {
      state.collapsedProjects.add(project.id);
    }
    render();
  });

  const branchSelect = fragment.querySelector(".project-branch-select");
  const branches = project.branches?.length ? project.branches : [project.activeBranch || project.defaultBranch || "main"];
  branchSelect.innerHTML = branches
    .map((branch) => `<option value="${branch}">${branch}</option>`)
    .join("");
  branchSelect.value = project.activeBranch || project.defaultBranch || "main";

  fragment.querySelector(".project-branch-switch").addEventListener("click", async () => {
    await switchBranch(project.id, branchSelect.value);
  });

  const projectEditForm = fragment.querySelector(".project-edit-form");
  projectEditForm.elements.name.value = project.name || "";
  projectEditForm.elements.headline.value = project.headline || "";
  projectEditForm.elements.repoPath.value = project.repoPath || "";
  projectEditForm.elements.githubUrl.value = project.githubUrl || "";
  projectEditForm.elements.notes.value = project.notes || "";
  projectEditForm.elements.activeBranch.value = project.activeBranch || project.defaultBranch || "main";
  fillSelect(projectEditForm.elements.implementationMode, project.defaults.implementationMode);
  fillSelect(projectEditForm.elements.reviewMode, project.defaults.reviewMode);
  fillSelect(projectEditForm.elements.simplifyMode, project.defaults.simplifyMode);
  fillSelect(projectEditForm.elements.syncMode, project.defaults.syncMode);

  fragment.querySelector(".project-edit-toggle").addEventListener("click", () => {
    toggleHidden(projectEditForm);
  });

  projectEditForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(projectEditForm);
    await api(`/api/projects/${project.id}`, {
      method: "PATCH",
      body: JSON.stringify(Object.fromEntries(formData))
    });
    await loadState();
  });

  const taskForm = fragment.querySelector(".task-form");
  taskForm.elements.branch.value = project.activeBranch || project.defaultBranch || "main";
  fillSelect(taskForm.elements.type, "coding");
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

async function safeRefreshState() {
  if (shouldPauseRefresh()) {
    return;
  }
  const sessions = state.data?.runtime?.sessions ?? [];
  const hasRunningSession = sessions.some((session) => session.liveStatus === "running");
  if (!hasRunningSession) {
    return;
  }
  await loadState();
}

async function safeRefreshLog() {
  if (!state.selectedSessionId) {
    return;
  }

  const sessions = state.data?.runtime?.sessions ?? [];
  const selected = sessions.find((session) => session.id === state.selectedSessionId);
  if (!selected || selected.liveStatus !== "running") {
    return;
  }

  await loadLog();
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
setInterval(safeRefreshState, 5000);
setInterval(safeRefreshLog, 5000);
