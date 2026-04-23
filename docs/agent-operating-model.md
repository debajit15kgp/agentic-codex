# Agent Operating Model

## Purpose

This repo coordinates project work across tasks, shared context folders, local coding agents, and GitHub synchronization. The operating model optimizes for:

- write safety
- predictable handoffs
- bounded task completion
- shared context through task folders
- selective use of agents, skills, or tools per stage

## Core Principles

1. A task folder is the source of truth for that task.
2. Shared context means files in the task folder, not hidden chat state.
3. No two writers modify the same project codebase at the same time.
4. Coding tasks aim for a working, reviewable solution, not perfection.
5. GitHub sync is explicit and file-scoped.
6. Review should remain relatively fresh and skeptical.

## Project Model

Each project gets a control folder inside `projects/`. That folder tracks metadata, shared references, tasks, and sync jobs.

The actual application repository may live elsewhere on disk. The dashboard stores the repo path and uses it as the execution target for coding or sync operations.

## Task Model

Each task lives in its own folder under the project shared context tree:

`projects/<project-slug>/shared/tasks/<task-id>/`

That task folder is the shared workspace reference for all task participants. It contains:

- task metadata
- prompt and acceptance criteria
- working notes and handoff summaries
- review output
- simplification notes when used
- logs and artifacts
- lock state

## Roles, Skills, and Tools

The dashboard should let the user choose how a stage is executed. A stage does not have to be powered by a long-running autonomous agent every time.

### Implementation

Default option:

- `Codex session`

Optional options:

- `Claude session`
- `Manual`

Success objective:

- produce a working solution that satisfies the task's acceptance criteria with the minimum necessary change

### Review

Default option:

- `Codex review session` with narrow context

Optional options:

- `Claude review session`
- `Checklist tool`
- `Manual review`

Success objective:

- identify correctness, regression, test, and maintainability risks before sync

### Simplify

This should be selectable, not mandatory. It is often better modeled as a skill or tool-assisted pass than a separate fully autonomous agent.

Recommended options:

- `Simplify skill`
- `Targeted Codex session`
- `Refactor checklist`
- `Skip`

Use simplify when:

- the implementation is correct but more complex than necessary
- review surfaced complexity or naming issues
- the user explicitly wants cleanup before sync

### GitHub Sync

GitHub sync should be modeled as a tool-driven stage with optional agent assistance, not as an always-on autonomous reviewer.

Recommended options:

- `Commit selected files`
- `Push current branch`
- `Create PR`
- `Update PR`
- `Sync assistant`

The sync assistant may help prepare messages or detect changed files, but sync remains explicit and user-scoped.

## Write Safety

Write safety is enforced by lock scopes.

### Lock Rules

- Only one task at a time may hold the project repo write lock.
- Review runs read-only by default.
- Simplify may write only after implementation has released the repo write lock.
- GitHub sync may not run while the project repo write lock is active.
- Task metadata writes should be serialized through the task state lock.

### Lock Types

- `repo_write_lock`
- `task_state_lock`
- `review_lock`
- `sync_lock`

### Practical Workflow

1. Task enters `implementing`
2. Implementation acquires `repo_write_lock`
3. Implementation releases `repo_write_lock`
4. Task enters `reviewing`
5. Review reads task folder plus selected code changes
6. If needed, simplify runs after review
7. Task enters `ready_to_sync`
8. Sync stage acquires `sync_lock`

## Shared Context Rules

Shared context is file-based and visible to all stages for the task.

Allowed shared context includes:

- `task.json`
- `prompt.md`
- `plan.md`
- `status.md`
- `handoff.md`
- artifacts in the task folder

Review should not automatically ingest all historical chat output. It should start from:

- task metadata
- acceptance criteria
- scoped file changes
- implementation handoff

This keeps review fresh while still grounded.

## Coding Task Lifecycle

Tasks should be bounded and progress toward "good enough."

### States

- `draft`
- `ready`
- `implementing`
- `reviewing`
- `simplifying`
- `ready_to_sync`
- `synced`
- `done`
- `blocked`

### Good Enough Definition

A coding task is good enough when:

- the primary acceptance criteria are satisfied
- the result is runnable or reviewable
- known limitations are documented
- no unresolved critical review issue remains

The task does not need to be perfect, exhaustive, or endlessly refined.

## Dashboard Recommendations

For each project:

- add task
- view active repo lock
- sync to GitHub
- configure repo path and sync defaults

For each task:

- view status
- open shared context folder
- choose implementation mode
- choose review mode
- optionally run simplify
- choose files to sync
- run GitHub sync

For each stage selector, support:

- `Agent`
- `Skill`
- `Tool`
- `Manual`

This keeps the workflow flexible without overcommitting to autonomous sessions everywhere.

## GitHub Sync Policy

GitHub sync should always be intentional.

- Sync is run from an explicit file list or user-approved changed files.
- Sync must record branch, commit message, and timestamp in task artifacts.
- Sync should not mutate unrelated files.
- Sync should be available at both the project and task level.

## Documentation Strategy

The repo should maintain:

- root `AGENTS.md` for Codex-facing instructions
- project-level docs for operating rules
- task-level markdown for local shared context
- JSON metadata files for machine-readable state

These files are the durable coordination layer across runs.
