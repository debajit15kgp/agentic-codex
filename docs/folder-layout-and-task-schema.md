# Folder Layout And Task Schema

## Recommended Layout

```text
projects/
  <project-slug>/
    project.json
    shared/
      README.md
      architecture/
      conventions/
      decisions/
      references/
      tasks/
        <task-id>/
          task.json
          prompt.md
          plan.md
          status.md
          handoff.md
          implementation.md
          review.md
          simplify.md
          context/
          artifacts/
          logs/
          lock.json
    runs/
    sync/
      github.json
      pending/
      history/
```

## Current Implementation Note

The first runnable implementation in this repo uses JSON files instead of YAML files for project and task metadata. The schema is the same in spirit, but the stored files are:

- `project.json`
- `task.json`
- `github.json`
- sync job `.json` files

This keeps parsing dependency-free while the dashboard is still evolving.

## Directory Purpose

### `projects/<project-slug>/project.json`

Canonical metadata for the project:

- human name
- slug
- repo path
- default branch
- sync defaults
- stage defaults

### `projects/<project-slug>/shared/`

Stable, reusable project context shared across tasks.

Suggested subfolders:

- `architecture/` for system explanations
- `conventions/` for coding rules and patterns
- `decisions/` for ADR-style decisions
- `references/` for notes, links, diagrams, or copied constraints

### `projects/<project-slug>/shared/tasks/<task-id>/`

Task-specific shared workspace reference.

This is the main collaborative surface for implementation, review, and sync preparation.

### `projects/<project-slug>/runs/`

Runtime records for individual stage executions.

Suggested contents:

- launch metadata
- timestamps
- command used
- exit status
- log pointer

### `projects/<project-slug>/sync/`

GitHub sync configuration plus sync job records.

Suggested contents:

- `github.json`
- queued sync job specs in `pending/`
- completed sync receipts in `history/`

## `project.json` Schema

```json
{
  "id": "marketing-site",
  "name": "Marketing Site",
  "slug": "marketing-site",
  "repoPath": "/absolute/path/to/repo",
  "defaultBranch": "main",
  "status": "active",
  "defaults": {
    "implementationMode": "codex",
    "reviewMode": "codex_review",
    "simplifyMode": "simplify_skill",
    "syncMode": "push_pr"
  },
  "policies": {
    "allowParallelRepoWrites": false,
    "requireExplicitSyncFiles": true,
    "reviewContextMode": "narrow"
  },
  "createdAt": "2026-04-22T00:00:00Z",
  "updatedAt": "2026-04-22T00:00:00Z"
}
```

## `task.json` Schema

```json
{
  "id": "task_auth_cleanup",
  "projectId": "marketing-site",
  "headline": "Simplify auth middleware and fix session refresh",
  "status": "ready",
  "priority": "high",
  "repoPath": "/absolute/path/to/repo",
  "taskRoot": "projects/marketing-site/shared/tasks/task_auth_cleanup",
  "description": "Fix refresh behavior and simplify middleware structure.",
  "subtasks": [
    "Fix the refresh path",
    "Keep the old auth flow working"
  ],
  "successCriteria": [
    "Session refresh succeeds after expiry",
    "Existing auth flows keep working",
    "Tests reflect the changed behavior"
  ],
  "stageConfig": {
    "implementation": { "mode": "codex", "enabled": true },
    "review": { "mode": "codex_review", "enabled": true },
    "simplify": { "mode": "simplify_skill", "enabled": true },
    "sync": { "mode": "push_pr", "enabled": true }
  },
  "sync": {
    "enabled": true,
    "mode": "push_pr",
    "allowedFiles": ["src/auth", "tests/auth"],
    "branchName": "task/auth-cleanup"
  },
  "latest": {
    "implementationRunId": null,
    "reviewRunId": null,
    "simplifyRunId": null,
    "syncRunId": null
  },
  "createdAt": "2026-04-22T00:00:00Z",
  "updatedAt": "2026-04-22T00:00:00Z"
}
```

## Task Files

### `prompt.md`

Canonical task framing for stages to consume.

Should include:

- objective
- acceptance criteria
- scope
- constraints
- repo path

### `plan.md`

Short working plan created before or during implementation.

Should stay concise and reflect the current intended path.

### `status.md`

Human-readable progress summary.

Suggested sections:

- current state
- latest outcome
- blockers
- next step

### `handoff.md`

Summary for the next stage.

Suggested contents:

- what changed
- what remains uncertain
- which files matter most
- suggested review focus

### `implementation.md`

Implementation-specific notes:

- approach taken
- major decisions
- tests run
- known tradeoffs

### `review.md`

Review findings and resolution status.

Suggested structure:

- critical issues
- medium-risk issues
- low-risk suggestions
- signoff status

### `simplify.md`

Optional simplification notes when that stage is used.

Suggested contents:

- complexity removed
- naming improvements
- code paths reduced
- deferred cleanup

### `lock.json`

Machine-readable lock state.

Suggested shape:

```json
{
  "repo_write_lock": null,
  "task_state_lock": null,
  "review_lock": null,
  "sync_lock": null
}
```

## Sync Job Schema

Suggested `projects/<project-slug>/sync/pending/<sync-job-id>.json`:

```json
{
  "id": "sync_2026_04_22_001",
  "taskId": "task_auth_cleanup",
  "projectId": "marketing-site",
  "mode": "push_pr",
  "files": [
    "src/auth/middleware.ts",
    "tests/auth/middleware.test.ts"
  ],
  "branchName": "task/auth-cleanup",
  "commitMessage": "fix(auth): refresh middleware and simplify flow",
  "status": "pending",
  "createdAt": "2026-04-22T00:00:00Z"
}
```

## Dashboard Selector Options

Recommended stage selector values:

### Implementation

- `codex`
- `claude`
- `manual`

### Review

- `codex_review`
- `claude_review`
- `review_checklist`
- `manual`

### Simplify

- `simplify_skill`
- `codex_refactor`
- `refactor_checklist`
- `skip`

### Sync

- `commit_only`
- `push`
- `push_pr`
- `manual`

## Minimal First Implementation

For the first product version, only these files are required:

- `project.yaml`
- `project.json`
- `task.json`
- `prompt.md`
- `status.md`
- `handoff.md`
- `review.md`
- `lock.json`

Everything else can be added incrementally.
