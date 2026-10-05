# Evaluator Rubric

Use this rubric after implementation and before final acceptance.

| Category | Question | Score (0-2) | Notes |
| --- | --- | --- | --- |
| Verify gate | Did `npm run verify` run and end green, with `smoke console` PASS (no console errors, no GL errors, consistent geometry buffers) and not SKIP? |  |  |
| 1:1 fit | Does `check:fit` pass both rules: deviation at most 15 %, and never-shrink (model at least 97 % of the OSM extent and of the `dimensions.json` height)? Does every landmark still have its own hand-authored builder in `src/models/porto/`? |  |  |
| Triangle budget | Does `check:models` pass: each detailed model within 4k..40k tris and the total at most 900k? |  |  |
| Languages | Do RU, EN and PT cover every new landmark, route, story chapter and UI string (`src/locales/*.porto.js`, `ui.js`, `data/story.json`)? |  |  |
| Data provenance | Does every new or changed `data/dimensions.json` entry carry `sources[]` with a fact and reasoning, plus a `confidence` value? Was generated geodata rebuilt by the pipeline and not edited by hand? |  |  |
| Performance | Does the change keep the load time and frame rate inside budget? Does the adaptive governor in `src/main.js` still step down on a slow device, and does the change add no unbounded draw cost? |  |  |
| No Braga leftovers | Does the change add no Braga ids, coordinates, text or assets outside inherited engine comments? |  |  |
| Web surface | Do the sitemap, `/p/<id>/` pages and `public/og/<id>.jpg` stay in step with `data/landmarks.json`? Do the API routes still answer? |  |  |
| Scope and handoff | Did the session stay inside the chosen feature? Do `feature_list.json`, `claude-progress.md` and `session-handoff.md` hold true evidence, so a fresh session can continue? |  |  |

## Scoring guide

- 0: Missing, failing, or no evidence.
- 1: Partly met, or met without recorded evidence.
- 2: Fully met, with evidence (command output, file path, count) in the repo.

Maximum score: 18.

## Verdict

- Accept: 16 or more, no 0 in Verify gate, 1:1 fit or Triangle budget.
- Revise: 10 to 15, or any 0 outside those three rows.
- Block: below 10, or a 0 in Verify gate, 1:1 fit or Triangle budget.

## Required Follow-Up

- Missing evidence:
- Required fixes:
- Next review trigger:
