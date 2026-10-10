# AGENTS.md

porto-3d is a single-city fork of the **braga-3d** engine: an interactive
browser 3D map of Porto (Vite + three.js, plain ES modules). Everything
place-specific lives in `cities/porto.json` and `data/`; the engine is shared.

This file is a **map, not a manual**. Read the pointer, then follow it. Keep
this under ~100 lines; put detail in `README.md`, `PLAN.md`, or `docs/`.

## Startup Workflow

Before writing code:

1. `pwd` — confirm you are in `porto-3d`.
2. Read `claude-progress.md` — latest verified state and next step.
3. Read `feature_list.json` — pick the highest-priority unfinished feature.
4. `git log --oneline -5` — see what landed.
5. `./init.sh` — install + baseline verification.
6. If baseline verification fails, **fix that first**.

## Working Rules

- Work on **one feature at a time**; do not half-finish several.
- Do not mark a feature passing just because code was added.
- Keep changes in the selected feature's scope unless a blocker forces a narrow fix.
- Never hand-edit generated geodata in `data/*.json`; regenerate via the pipeline.
- Do not silently weaken `scripts/verify.mjs` or a check to make a feature pass.
- Prefer durable repo artifacts over chat summaries.

## Verification — Definition Of Done

`npm run verify` is the gate. It builds the app and runs every check whose
input data exists (missing inputs are skipped, not faked). A feature is done
only when:

- the user-visible behavior is implemented,
- `npm run verify` was actually run and passed,
- evidence is recorded in `feature_list.json` / `claude-progress.md`,
- the repo is restartable from `./init.sh`.

Commands (all default to `--city porto`):

```
npm run verify              # build + every check (the gate)
npm run check:data          # landmarks/routes content contract, licenses, photos
npm run check:geo           # footprints, buildings, terrain, landmark osm
npm run check:dimensions    # real-world dimensions + sources
npm run check:fit           # 1:1 fit vs OSM, two hard-fail rules:
                            #   deviation > 15 % (DEVIATION_FAIL), and
                            #   never-shrink: model < 97 % of the OSM extent
                            #   or of dimensions.json height_m.total (SHRINK_MIN)
npm run check:traffic       # street network + traffic invariants
npm run check:models        # triangle budgets (4k..40k/model, <=900k total)
node scripts/smoke-console.mjs  # headless dist load: fails on console/GL errors
                            #   and bad geometry buffers; SKIPs without Chromium
```

`npm run verify` runs 11 checks (the ones above plus smoke life, trams, rail
and console). Green is the baseline: 70 detailed landmark builders, no massing
fallback.

## Performance

Device classes drive the defaults (`src/perf-classes.js`), the governor moves
inside a class (`src/governor.js`), `?perf=1` or Shift+P shows the numbers.
Detail: `perf/ARCHITECTURE.md`, `perf/BASELINE.md`, `perf/DEVICE-CHECKLIST.md`.
`npm run perf` (reduced bench, soft gate in verify), `node scripts/perf-stress.mjs`,
`node scripts/pack-buildings.mjs` after a new `buildings.json`,
`node scripts/optimize-images.mjs` after new photos.
`node scripts/bake-fits.mjs` after a change to a landmark builder, `fit.js`, terrain, footprints or
dimensions (`npm run build` re-bakes `data/fits.json` when its input hash changes; `npm run check:fits`
compares it with a live fit). The 70 landmark models are built lazily in a worker (`src/model-worker.js`,
`src/landmarks.js`); a new builder joins a group in `src/models/groups/` and `loader.js`. Class P runs the lite
scene (`src/lite/`, `?scene=lite` forces it): keep anything the full scene adds out of it.

| Class | Overview tris | Calls | GPU MB | p95 target | Shadow | DPR cap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| XL Ultra | 2.4 M | 400 | 900 | 18 ms | 4096 | 2 |
| L High | 1.8 M | 320 | 600 | 20 ms | 2048 | 1.75 |
| M Medium | 1.2 M | 220 | 380 | 24 ms | 1024 | 1.5 |
| S Low | 0.8 M | 160 | 250 | 36 ms | 1024 | 1.25 |
| P Potato | 0.4 M | 100 | 150 | 80 ms | none | 1 |

Load: first meaningful frame < 3 s desktop (4.1 s measured), ready < 10 s
(6.5 s). Live JS heap after load <= 240 MB. Data files are versioned by hash
(`?v=`): never fetch `data/` without `assetUrl`.

## Data Pipeline

Resumable, idempotent, raw replies cached in `data/.cache/` (gitignored).

```
node scripts/city.mjs porto --dry-run      # print the plan
node scripts/city.mjs porto                # run remaining steps
node scripts/city.mjs porto --from tiles   # resume at a step
node scripts/city.mjs porto --only ms-buildings
node scripts/check-geo.mjs --city porto
```

Step order matters: `ms-buildings` runs **after** `tiles`.

## Layout

```
src/            three.js engine; src/models/porto/ is Porto's landmark builders
scripts/        data pipeline, checks, and verify.mjs
api/            Vercel functions: live aircraft, route lookup, AI guide
cities/         porto.json — every place-specific constant
data/           generated geodata (terrain, roads, buildings, tiles, ...)
assets/img/     landmark photos
public/         PWA manifest, service worker, icons, share pages
index.html      static shell (crawlers + first paint)
PLAN.md         project plan and remaining rounds
```

## Engine Lineage

Forked from braga-3d at commit `1784ff3`. Braga is the engine source of truth.
Engine updates are ported with `scripts/sync-engine.sh` (report-only by
default; `--record`, `--apply`). The base commit sits in `scripts/engine-base.txt`
(still `1784ff3`; the script has not run since the fork) — see
`feature_list.json` `porto-011`.

## Hard Constraints

- Node 22 (`.nvmrc`, `engines`). Plain ES modules, no framework.
- Landmark models are authored in metres on real OSM footprints.
- Photos must be free-licensed; `check:data` rejects NC/ND.
- Never commit `data/.cache/`, `dist/`, or `node_modules/`.

## End Of Session

1. Update `claude-progress.md`.
2. Update `feature_list.json` (status + evidence).
3. Record any blocker or risk.
4. Commit only when the repo is in a safe, restartable state.
5. Leave it clean enough that the next session can run `./init.sh` immediately.
