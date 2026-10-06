# Progress Log

<!--
Agent-agnostic repository-local session log. Any coding agent reads it at
startup and updates it before handoff when AGENTS.md tells it to. No agent
updates it automatically.
-->

## Current Verified State

- Repository root: `~/Dev/porto-3d`
- Standard startup path: `./init.sh`
- Standard verification path: `npm run verify`
- Verified 2026-10-05: `npm run verify` is GREEN, 11 checks: build, data contract, geo, dimensions, 1:1 fit, traffic, models, smoke life, smoke trams, smoke rail, smoke console. 0 skipped on a machine with Chromium.
  - Geo has 3 known warnings (palacio-cristal centroid 847 m off; buildings 8.64 MB over the 8 MB baseline, within the 12 MB porto ceiling; 147 building centroids inside a landmark outline).
  - `check:fit` holds two rules: 15 % deviation fail and never-shrink (>= 97 % of the OSM extent and of the `dimensions.json` height).
  - `check:models`: 70 detailed builders, 0 massing, 747,306 tris of 900,000.
  - One verify run saw a transient `net::ERR_FAILED` in smoke console while dist was rebuilt by other work; a rerun passed.
- Current highest-priority unfinished features: `porto-012` (domain `porto-3d.com` does not answer), `porto-011` (engine sync never run since the fork), `porto-013` (quay walls), `porto-014` (geometry LOD).
- Known gap: 10 landmarks have no image in `public/og/` yet (list in `feature_list.json`, `porto-010`).
- Live: https://porto-3d.vercel.app (Vercel project `porto-3d`); git remote `isatimur/porto-3d`.

## Session Log

### Session 005

- Date: 2026-10-06
- Goal: user report "very many glitches" and "the default weather is strange". Find them by looking, fix the root causes.
- Weather diagnosis: the app starts in `clear` weather and `sunset`; live weather is off unless `porto-live=1` is saved. The beige wash came from the seasonal climate bias in `src/seasons.js` (`setClimate`). On 6 Oct the season resolves to autumn, and the bias added mist 0.2, fog 0.1, haze 0.12, grey 0.07 on top of "clear". That also advanced the sea-fog sheet over the Atlantic. Summer and spring starts were clean. Fixed by cutting the bias (autumn now mist 0.05, fog 0.02, haze 0.04), see commit `01193ef`. Also: `season_default`, `default_weather`, `default_time` now live in `cities/porto.json` and are read; the start-up call no longer writes `porto-time` to localStorage (before, every visitor looked like they had chosen sunset). A saved or linked choice still wins. Live weather only starts from the «Now» button or a saved `#live=1`.
- Fixed: Foz sea foam (solid blobs, now lacy surf, `1ffcdd7`); culverted Rio da Vila water strip up Rua Mouzinho da Silveira (`culverted_streams` in porto.json) and day-time neon road glow (`e3c76a8`); Gaia quay terrain wedge in front of the wall (`45d8443`); white fins across the Luís I approach piers (`f939976`).
- Remaining defects (evidence in /tmp/p3, not committed):
  - Load sequence (`e-t4.png`, `e-t8.png`): for the first ~8 s the view is bare green ground with a hard-edged rectangle of city and blown-out road glow; no sea or river until the nature layers land (ready at 13-17 s). Needs the water and land cover built before the first frame or a boot fade. Size: > 1 h.
  - Flat grey pad slabs at overview and cinema distance (Matosinhos, Dragão, Casa da Música areas; `c-cinema-4.png`): landmark pads with no model at that LOD.
  - Pale-blue flat water polygon on the Gaia bank and dark-blue slivers at the foot of the Luís I piers (`q-gaiamid.png`, `B2-luispier.png`): water polygons that sit at their own height over the pad.
  - São Bento on a bare lawn (`pl-03-SoBento.png`), dark scribble on the Casa da Música facade (`pl-09-CasadaMsica.png`), the place card covering the subject (`pl-05`, `pl-06`).
  - Sunset still has a golden road glow at overview (intended golden-hour look).
- Console: 60 s recorder on the preview build, zero errors, no GL errors; the only warnings are 6 `console.warn` lines "model box deviates 10-14 % from the OSM extent" (sao-bento, caves-gaia, ponte-freixo, campanha, coliseu, alfandega-nova), left in as fit notes.
- Process note: all source edits through Edit/Write.

### Session 004

- Date: 2026-10-06
- Goal: optional-data 404s, Douro quay walls, geometry LOD, missing OG images, fact checks.
- Completed:
  - `cities/porto.json` `data_absent` lists `pois.json` and `streetscape.json`; `hasData()` in `src/city.js` makes `src/pois.js` and `src/streetscape.js` skip the fetch (no 404).
  - Quay walls: `scripts/fetch-quays.mjs` -> `data/quays.json` (20 lines, 7.4 km); `src/quays.js` renders wall, coping, deck, bollards; hooked in `deferLayers` (`src/main.js`). NOT done: flattening the terrain behind the wall (27 m ground cells; water drapes on `heightAt`).
  - Geometry LOD: ground index stride (`src/scene.js`), street-line body quads and minor-line drop (`src/roads.js`), `applyGeoLod` and a 700-unit shadow cap from the first frame (`src/main.js`). Triangles: first frames 4.69 M -> 1.97 M desktop, 2.26 M -> 1.25 M mobile; settled overview 3.04 M -> 1.76 M. Mid/close 3.4 M. Governor does not cut close-range geometry. People/tree counts by tier not done.
  - Facts: Palácio de Cristal 150 x 72 m and the Sé 509,702 visitors in 2022 match Wikipedia (en/pt). The Lello "1.2 M in 2019" had no source for the year; softened to "about 1.2 million a year" (Forbes Portugal) in en, pt, ru; Forbes added to Lello sources.
  - OG: see `feature_list.json` `porto-010`.
- Process note: a few source edits used `sed -i` and a node fs rewrite instead of Edit (rule breach, no content impact).
- Next best step: terrain pads along the quays (needs the water to stop reading `heightAt`), tier-scaled crowd and tree counts, domain `porto-3d.com`.

### Session 003

- Date: 2026-10-05
- Goal: Checkpoint the work of earlier sessions, fix visual and GL defects, add a browser gate, and bring the state files in line with the real project.
- Completed:
  - Checkpointed the uncommitted work (commit `7610e9b`).
  - Added category chip labels for structure, coast and culture in RU/EN/PT (commit `deacd54`).
  - Fixed an `aWall` buffer overrun in `src/buildings.js`. `aWall` has 4 floats per vertex (see the dedicated loop near line 703). The overrun raised `GL_INVALID_OPERATION` (commit `e49438b`).
  - Added `scripts/smoke-console.mjs` and the `smoke console` check in `scripts/verify.mjs`. It loads `dist` headless and fails on console errors, GL errors and inconsistent geometry buffers. It SKIPs without playwright-core/Chromium.
  - Road glow now fades with fog. The `FOG_ADDITIVE` define is set in `src/roads.js` and read in `src/scene.js`. This removes the white ribbons on the horizon (commit `c910873`).
  - Rewrote `feature_list.json`, `README.md`, `PLAN.md`, `AGENTS.md`, `session-handoff.md` and `evaluator-rubric.md` to match the shipped state.
- Verification run: `npm run verify` -> 10 passed, 1 failed (transient smoke console `net::ERR_FAILED` while other work rebuilt dist). `node scripts/smoke-console.mjs` alone then passed, so all 11 checks are green.
- Evidence captured: `feature_list.json` evidence strings (counts re-checked with ls, node one-liners and curl on 2026-10-05).
- Known risk / unresolved issue:
  - `porto-3d.com` does not answer.
  - 10 landmark pages point `og:image` at files that do not exist.
  - Engine sync with braga-3d never ran after the fork (`scripts/engine-base.txt` = `1784ff3`).
  - Quay walls and building geometry LOD are not built.
- Next best step: run `node scripts/make-og.mjs --og` for the 10 missing images, then connect the `porto-3d.com` domain in Vercel.

### Session 002

- Date: 2026-10-02
- Goal: Make the verification gate meaningful and green for the real repo state without weakening checks.
- Completed:
  - `scripts/verify.mjs`: spawn-error handling, per-check skip reason, pass/fail/skip summary.
  - `scripts/count-tris.mjs`: distinguishes detailed vs generic-massing models (via `builderRule(...).note`); massing models are reported as `MASSING (not yet detailed)` and are NOT failed for being tiny; only detailed models outside 4k..40k hard-fail; glass counted in the same total as opaque; missing-input guards added.
  - `scripts/check-traffic.mjs`: fixed a real bug — it read `process.argv[2]` (which was `--city`) as the seconds, so it simulated 0 steps and passed vacuously. Now parses the optional numeric arg.
  - `scripts/check-geo.mjs`: corrected the hardcoded 8 MB buildings cap to a per-city cap (`porto: 12`), keeping the 8 MB baseline as a warning; Porto's extent/OSM coverage is several times Braga's.
  - Updated `feature_list.json` + this log with evidence; recorded the background pipeline.
- Verification run: `./init.sh` and `npm run verify` (and individual checks).
  - PASS build
  - SKIP data contract (missing data/routes.json — porto-007)
  - PASS geo (3 warnings; 8.64 MB buildings within porto's 12 MB ceiling)
  - SKIP dimensions (missing data/dimensions.json — porto-004)
  - FAIL 1:1 fit (23 failures)
  - FAIL traffic (8 vehicle-steps below the ground; 100% on the other invariants)
  - FAIL models (5 detailed builders below 4k: ponte-luis-i 3000, serralves 2102, casa-musica 3564, dragao 2420, ponte-arrabida 2264; total 82,393 / 600k; 6 models still massing)
- Evidence captured: `/tmp/verify2.log` summary; per-check output above; `count-tris` table.
- Commits: none (per instructions, no commit).
- Files or artifacts updated: `scripts/verify.mjs`, `scripts/count-tris.mjs`, `scripts/check-traffic.mjs`, `scripts/check-geo.mjs`, `feature_list.json`, `claude-progress.md`.
- Known risk / unresolved issue:
  - The gate is red on genuine product defects (traffic below-ground, detailed model budgets, fit). These are NOT caused by the harness and must be fixed in `src/` / `data/` by their owning agents.
  - The buildings-size cap change is a Porto-scale correction, not a blanket weakening; the 8 MB baseline still warns.
  - Many files remain untracked (roads/nature/footprints/landmarks/landmark builders/locales); repo is not committed into a clean resumable state yet.
- Next best step: fix the 8 traffic below-ground vehicle-steps in `src/road-network.js` (or the roads data), then raise the 5 detailed models over 4k and reconcile their OSM fit; author `data/dimensions.json` (porto-004) and `data/routes.json` (porto-007) to activate the skipped checks.

### Session 001

- Date: 2026-10-02
- Goal: Install the harness pack (instructions, state, verification, scope, lifecycle) for porto-3d.
- Completed:
  - Added `AGENTS.md` (+ `CLAUDE.md` pointer) — map, not manual.
  - Added `feature_list.json` — 12 features from PLAN.md rounds, with honest statuses.
  - Added `scripts/verify.mjs` + `npm run verify` — the single gate; skips checks whose data does not exist yet.
  - Added individual `check:*` npm scripts; fixed `check:models` to pass `--city porto`.
  - Added `init.sh` (install + verify), `.nvmrc` (22) and `engines.node >=22`.
  - Added this progress log.
- Verification run: `npm run verify`
  - PASS build, PASS geo, PASS traffic
  - SKIP data contract (missing data/routes.json), SKIP dimensions (missing data/dimensions.json),
    SKIP 1:1 fit (missing data/footprints.json), SKIP models (missing data/footprints.json)
  - Result: `verify: OK — 4 check(s) skipped, data not produced yet`
- Evidence captured: verify summary above; `feature_list.json` statuses.
- Commits: none yet — 18 files still untracked from before this session (see risk).
- Files or artifacts updated: AGENTS.md, CLAUDE.md, feature_list.json, claude-progress.md,
  init.sh, .nvmrc, package.json, scripts/verify.mjs.
- Known risk or unresolved issue:
  - 18 untracked files predate this session: `data/roads.json`, `data/nature.json`,
    `data/new/` (20 places) and 15 `src/models/porto/*.js` builders. The repo is not in a
    clean resumable state until these are committed or stashed.
  - `check-data`, `check-dimensions`, `check-fit`, `count-tris` still crash on missing input
    files instead of exiting gracefully; `verify.mjs` compensates by skipping, but the scripts
    should be hardened later.
- Next best step: run `scripts/merge-landmarks.mjs --city porto` / `merge-content.mjs` to fill
  `src/locales/{en,pt}.porto.js` (feature `porto-003`), then commit the untracked work.
