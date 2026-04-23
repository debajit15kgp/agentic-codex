# Agentic Dashboard

A lightweight local portal for:

- capturing projects from GitHub URL and optional local repo path
- creating task folders with descriptions, subtasks, and success criteria
- launching `codex` or `claude` only for the stages you choose
- preparing and running file-scoped git sync flows

## Run

```bash
npm start
```

Then open [http://localhost:4312](http://localhost:4312).

## What It Does

- Create a project with just a name and GitHub URL.
- Add a local repo path later when you want coding or sync.
- Import multiple local git repos from a parent directory.
- Add tasks using headline, description, subtasks, and success criteria.
- Store each task in its own shared context folder.
- Run implementation, review, or simplify only when you explicitly launch a stage.
- Queue sync jobs with selected files, branch name, and commit message.
- Run direct git sync for selected files when a local repo path exists.

## Notes

- Runtime state lives in `data/runtime.json`.
- Project and task state live under `projects/`.
- Session logs are written to `data/logs/`.
- The portal repo itself is what gets committed and pushed for dashboard state.
- Project repos are used as working directories for agent sessions.
- The first implementation uses JSON metadata instead of YAML for dependency-free parsing.

## Current Sync Model

This version supports two sync layers:

- portal state sync through this repo's own git remote
- task-level selected-file sync against a configured project repo

If you want, the next step can be extending this into:

- GitHub Issues and Projects synchronization
- automatic repo cloning from GitHub URLs
- richer lock visibility and conflict handling
- task templates and reusable stage presets
