# AGENTS.md

This repository is building a dashboard and operating system for project tasks, shared context folders, coding runs, and GitHub sync.

## Primary Intent

Treat this repository as a control plane, not just a web app.

The important outputs are:

- a clear project and task operating model
- durable task folders as shared context
- safe orchestration of implementation, review, simplify, and sync stages
- predictable synchronization to GitHub

## Sources Of Truth

When working in this repo, prefer these files as the canonical references:

- `docs/agent-operating-model.md`
- `docs/folder-layout-and-task-schema.md`

If the product behavior conflicts with those docs, update the docs intentionally or align the code to them.

## Task Philosophy

Coding tasks should aim for a working, reviewable solution.

Do not optimize endlessly. "Good enough" means:

- core acceptance criteria are met
- the result is understandable
- major risks are surfaced
- the task can move to sync or user review

## Shared Context

Shared context is file-based.

For future product work, assume each task will have its own folder under a project shared context tree, and that folder should be the collaborative reference for implementation, review, and sync preparation.

Avoid designs that depend on hidden agent memory.

## Stage Model

The intended stage model is:

- implementation
- review
- optional simplify
- sync

The dashboard should let the user choose whether a stage is powered by an agent, a skill, a tool flow, or manual action.

## Write Safety

Do not design or implement workflows that allow concurrent writes to the same project repo without explicit locking.

Prefer:

- one project repo write lock at a time
- review as read-only by default
- sync as a separate locked stage

## UX Direction

The UI should feel intentional and calm.

Avoid generic enterprise dashboard styling. Prefer:

- strong hierarchy
- clear stage controls
- visible lock and sync state
- task folders as first-class objects

## Implementation Preference

For early iterations:

- keep dependencies light
- prefer simple local files as state
- make workflows inspectable
- optimize for clarity over abstraction

## Validation

When changing code:

- keep the dashboard runnable locally
- verify syntax and basic boot paths
- document any environment limitations clearly
