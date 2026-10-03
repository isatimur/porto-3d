# Clean-state checklist (end of session)

Run through this before ending a session so the next one starts from a known
state.

- [ ] `npm run verify` was run and passed — or the failure is recorded as the next task.
- [ ] `claude-progress.md` updated: goal, completed, verification, next step.
- [ ] `feature_list.json` updated: statuses + evidence for what changed.
- [ ] No half-finished feature left loose; WIP is committed with a clear message or stashed.
- [ ] `git status` shows only intentional changes.
- [ ] Nothing ignored is staged (`data/.cache/`, `dist/`, `node_modules/`, secrets).
- [ ] Exactly one feature is `in_progress` in `feature_list.json`.
- [ ] The repo is restartable from `./init.sh`.
