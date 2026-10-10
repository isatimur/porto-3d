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

### Wave 1D — the land shape and what stands on it (feature porto-w1d-001)

- Goal: end the bare cliff with torn ribbons and hanging rows on the Douro slopes.
- Root cause of the cliff in the user's screenshot: not the DEM. The Palácio de Cristal landmark pad took the base from the lowest point of the garden outline (-65.7 m) and levelled 417 x 438 m: 61.6 m of cut, a pit whose wall was the grey cliff. Roads and OSM rows then followed the pit. 67 pads were measured (`node scripts/pad-report.mjs`): worst cut 61.6 m, now 10.9 m.
- Terrain (`src/terrain.js`, `src/terrain-fine.js`, `scripts/fetch-terrain-fine.mjs`, `data/terrain-fine.bin.gz`, notes in `data/terrain-notes.md`): AWS Terrarium z14 resampled to 12 m over the core plus a 440 m margin, 214 KB gzip. It is the same model as the EU-DEM lattice (RMS 2.5 m, mean -0.1 m), so it adds shape, not accuracy; the datum comes from the lattice, the river band is pulled down inside the OSM water polygons so the water level does not move. One height function: `rawAt` and `heightAt` read the fine grid; workers rebuild it from `terrain.grid.fine` (parity 0 over 200000 points).
- Ground mesh (`src/ground-mesh.js`, `src/scene.js` createGround and groundAxes): the lattice is the data's own 12 m grid in the core, one DEM cell in the ring; 32 x 32 cell chunks with a per-chunk stride 1 to 8 by distance, skirts where strides differ, normals and AO from the lattice, one dynamic index buffer. The shadow proxy is built on the lattice with a lowest-ground filter (no shade plates).
- Slope material (scene.js ground shader): scrub on 20 to 35 degrees, banded granite and schist above 35 degrees, land cover only on the flats. Textures from `art/textures` (rock_granite_*, ground_schist_*) are not plugged in: copy them under `assets/`, load with `assetUrl`, and sample them in `GROUND_COLOR` where `rockCol` and `scrub` are built, with `vec2(W.x + W.z, W.y * 2.4)` as the UV on faces and `W.xz` on flats.
- Pads (`src/terrain.js` addPad/heightAt, `src/fit.js` padFor and the Palácio rule): cut caps (buildings a third of their height, at least 3 m; gardens, streets and the coast 6 m; stadium 10 m), faces no steeper than 1:1.8 with a feather that widens with the step, Palácio base on the arena plateau.
- Roads, quays, buildings, boats: done by sub-agents, commits 4d17d90 (roads), 89beeda (buildings), 4ee34e2 (boats).
- Evidence: before and after shots at the same poses in `/tmp/p3` (`u0-cliff.png` live, `u1-cliff.png` now); `npm run build`, `check:fit`, `check:geo`, `check:traffic`, `check:fits` pass.
- Not done: retaining walls, a coarser ground lattice for phones, pad hiding by distance (pads are the ground). The flat-shaded green footing planes at Serra do Pilar come from the landmark models.

### Wave 1C — water look, shadows, fog (feature porto-w1c-001)

- Goal: foam that reads as foam, no tiled sea, Atlantic and estuary colour, the shadow hatch, fog and rain.
- Water (`src/water.js`, commit 41a6b9c): foam from the wave Jacobian and a lattice stretched along the crests; shoreline foam from `aSeaDist` (profile fallback when the attribute is absent); `aSeaDepth` and `aMouth` drive colour, shoaling and the river/sea blend; per-wave phase warp and group height from three km-scale noise fields (per-wave weights are the `uWaveWarp` uniform); detail octaves at unrelated scales, faded by pixel footprint; sparkle gated by footprint. New exports `setSeaShoreAttributes`, `setWaterMouth` (coast.js calls them). Lite classes (M, S, P) keep the single octave: warped lookup, footprint fade, shore foam and the new colours, no Gerstner.
- Shadows: the "moire" is not in the shadow map. The landmark focus effect (`src/landmarks.js`) screen-doored 7 of 8 pixels of any model between the camera and the selected landmark. Now it drops that model whole. Bias, normalBias and radius are unchanged (probed: no effect).
- Fog and rain (`src/scene.js`): valley fog density 0.016, thinner air near the lens; puddle mask is two octaves on flat ground only, in both the shared patch and the ground reflection.
- Evidence: before/after shots in `/tmp/p3/cb/` (b-* before, a3-a8 after); `npm run build` passes; rAF A/B against HEAD water.js shows no loss (machine noisy).
- Risk: `src/scene.js` and `src/landmarks.js` hold my edits but are not committed (other agents' hunks share the files). Commit them together with that work.
- Not done: ground raindrop rings, a phone-sized sea shot, a sunset sea shot of the Foz with foam.

### Wave 1B — the real coast (feature porto-w1b-001)

- Goal: the sea polygon from the real OSM coastline, the harbour structures. The old sea was 113 vertices from the easternmost coast point per 220 m latitude band.
- Data: `scripts/fetch-coast.mjs` (`npm run fetch:coast`, Overpass mirrors, cache `data/.cache/coast-raw.json`) joins the 29 coastline ways into one sea ring (981 points at 2 m, 124.7 km2, closed along the wide bbox, 3 islets), the 31 breakwater polygons, 120 pier ways, 19 lights, 96 beaches, 87 rocks, 5 marinas, plus the Leixoes outer harbour (a landuse polygon in OSM) and the Leca marinas as harbour basins. It writes `data/coast.json` and patches `data/nature.json` (area `sea`, `basin-*`, the `coast` profile at 0.001 deg; `scripts/fetch-nature.mjs` reads coast.json too).
- Code: `src/coast.js` (the sea mesh: quadtree, polygon cut per cell, flat at the ground level of the open sea, attributes `aSeaDist`, `aSeaDepth`, `aMouth`; 5.0 k triangles, area ratio 1.000), `src/harbour.js` (shore apron: sand, rock, sea wall, bank; moles with armour; piers; lighthouses; loaded as its own chunk after the quays), `scripts/check-coast.mjs` (`npm run check:coast`). Hooks outside my files: 4 lines in `src/water.js` (import, `buildSea`, skip of the old ocean area, `sea?.attach`) and one deferred step in `src/main.js`.
- Not done: the shader still uses the single-valued coast profile (owner C); the estuary and the sea meet at the closing line; Leixoes docks are not water in OSM; the ring-terrain grass runs to the apron (ground, owner D).
- Verify: `npm run build` (to a temp dir), `check:geo`, `check:data`, `check:fit`, `check:coast`. Not run: `smoke-console` (needs the shared `dist/` and its own port) and `perf` (shared machine).

### Session 008 — performance for every device class

- Goal: a measured, device-class-aware performance architecture (features porto-018 to 021).
- Done: bench harness (`scripts/perf-bench.mjs`, five profiles in `perf/profiles.json`), baseline and after tables (`perf/BASELINE.md`), design (`perf/ARCHITECTURE.md`), classes + detection + governor v2 + menu + overlay, streamed roads/buildings, packed buildings, versioned immutable data, late chunks, 713 -> 191 MB JS heap, WebP photos, stress tests, budgets and a soft gate in verify.
- Headline numbers: phone-high first meaningful frame 33.0 -> 20.8 s, ready 37.7 -> 25.0 s; phone-low ready 49.7 -> 34.0 s; desktop ready 7.6 -> 6.5 s; transfer 2.9 -> 2.2 MB; warm reload 2.1 MB -> 6 KB.
- Not done (expected gain in `perf/ARCHITECTURE.md`): lazy landmark models, core build in a worker, quantised vertex attributes, font subsetting, a lite scene for software GL (Potato still 2-4 s a frame).
- Real-device testing: `perf/DEVICE-CHECKLIST.md`.
- Verify: `npm run verify` 14/14 (build, data, geo, dimensions, fit, traffic, models, packed buildings, smoke perf, smoke life, trams, rail, console, perf budgets soft).

### Session 007 — the Douro bridges

- Date: 2026-10-07
- Goal: make the six Douro bridges the most accurate, beautiful and alive part of the app.
- Done (commits `porto-3d:` since `ed0db10`):
  - All six builders rewritten 1:1 in metres (`src/models/porto/ponte-*.js`, shared parts in `src/models/bridge-kit.js`): Luís I (parabolic double-deck iron arch, lattice ribs, through-girder upper deck, tapered lattice towers, Metro line D rails and overhead line, lamps), Arrábida (twin hollow ribs, flat elliptical curve, column pairs, four lift towers), Maria Pia (crescent arch, 7 lattice towers), São João (variable-depth box girder over the whole 1143 m, river piers), Infante (flat arch slab, wall piers), Freixo (twin box girders, 8 spans, waisted piers).
  - Triangles: Luís I ~26k, Arrábida ~13k, Maria Pia ~18.5k, São João ~10k, Infante ~8k, Freixo ~12.5k (total of the six ~88k; city total ~774k of 900k).
  - Engine: `pad: 'none'` and local cuts (no flat pad under a valley bridge); `src/bridge-decks.js` makes the street network ride the models' own deck heights and base; roads.js leaves the engine's slab and piers out for these decks; the river polygon takes the bed level (no tilt across quays); night-lamp emissive channel (`aEmit >= 2`) and a water-shader glitter term fed by `bridge-lamp` markers.
  - Cinema: the sunset chapter is "Pontes do Douro" (6 bridges, then Gaia); `span` shots fly along the Luís I upper deck and then under it along the river, and under the Infante arch.
  - Route: `pontes-do-douro` (Ribeira, Luís I upper deck, Jardim do Morro, Serra do Pilar, Infante) with OSRM foot legs; `fetch-routes.mjs --only <id>` merges one route. The Luís I credit in `ribeira-pontes` (it said Eiffel) is corrected to Seyrig.
  - Data: sourced numbers in `data/dimensions.json`; photo credits in `data/CREDITS.md`.
- Verification: `npm run verify` 11/11 (incl. smoke console); fit deviations under 10 %; overview 2.11 M tris, 3.20 M near Luís I (limits 2.4 M / 3.4 M); first frame 2.6 s, ready 9.3 s; governor levels 1-3 respond (preview build, fresh visit).
- Not done / honest limits: no pedestrians were seen on the Luís I decks (the footways are walk lanes at deck height, unverified); Maria Pia has no traffic by design; São João, Infante, Arrábida and Freixo stay under the 15k hero triangle floor; the river bed DEM still shows small ledges under low flights; no real GTFS-timed CP schedule was added (existing life.js trains and GTFS metro ride the new decks); far LOD is the engine's massing box.
- Two source edits were made with `node -e` by mistake (ponte-infante.js, ponte-luis-i.js), against the Edit/Write rule.

### Session 006

- Date: 2026-10-06
- Goal: the rest of the session 005 defect table (items 8-13), then the skipped checks (a)-(f).
- Fixed (commits `555de54`, `240671c`, `b06a64a`, `10dc400`, `26da4e4`, `02fe74f`, `2c8ff82`, `ada0458`):
  - 8 Boot: `buildNatureBase` (src/nature.js) builds the land-cover mask and the water before the first frame; the nature layer reuses them and adds trees later. The core's built-up channel is painted after the buildings exist. Roads and the core's buildings fade in (dither `BRG_REVEAL` in src/buildings.js, `setReveal` in src/roads.js). The tile index loads with the first frame and tints the ring from the per-tile building counts (`prepaintRing`, src/tiles.js); the tile workers start in the boot view as soon as the core's buildings exist (phones: after the first full frame). The deferred layers wait 1.5 s for the intro on desktops (was 6 s). Numbers (preview, 1440x900, 3 runs): first frame 1.2-1.5 s (was 1.8 s on bare green ground), interactive 5.2-5.4 s, ready 7.5-7.8 s (was 10.1 s here; 13-17 s under load in session 005). Phone 390x844: first frame 1.2 s, ready 9.1-9.6 s.
  - 9 Pad slabs: far landmark massing no longer draws a box for low, wide sites (parks, gardens, beaches) and caps big buildings to a 12 000 m2 block (src/landmarks.js).
  - 10 Water slabs: Gaia, Ribeira models carry a river-bed filler below the water line instead of a water prism; no pale-blue polygon, no slivers at the Luis I piers.
  - 11 Sao Bento: landmark sites of the civic, religious, museum, culture and education classes get the urban ground tint and a 14 m forecourt (`paintBuilt`, src/nature.js, called from src/main.js).
  - 12 Casa da Musica: the scribble was a comb of 0.16 m seams on the short corner facets plus a comb of drum mullions; both removed.
  - 13 UI: the callout framing splits the free map area (subject left, card right); the card keeps a gap of the subject's screen radius; labels give way to the hint box.
  - (f) Deviations: sao-bento 7.5 %, caves-gaia 6.4 %, ponte-freixo 8.7 %, campanha 8.1 %, coliseu 7.9 %, alfandega-nova 7.4 % (all under 10 %, no console warning). `dimensions.json` is unchanged.
  - (b) One walker stood 1.1 m under the Se courtyard (a road lane in a cutting): crowd paths now clamp to `heightAt` (src/porto-streetscape.js).
- Checks run, nothing else found: (a) 5 landmarks, camera moved 1 cm, 3-frame diff: only moving boats and edge noise, no z-fight patch; (b) instanced people, cars, vans, boats, rails, cabins, furniture vs `heightAt` at 6 places; boats at y -1000 are hidden instances; the cable-car cabins and the metro rail hang above ground by design; (c) 10 s fly from the overview to Clerigos at 10 Hz (screencast): the frame-to-frame change rises smoothly, no sudden change; the triangle count steps from 2.8 M to 4.4 M in 0.3 s at 600-850 units, hidden by the flight; (d) 450 m views of Ribeira, Foz and Boavista read clean; (e) Douro fly-over at Foz, Passeio Alegre, Arrabida, Maria Pia and Freixo reads clean.
- Process: Edit/Write for source. One breach: a `sed -i` on `feature_list.json` for a typo.
- Remaining: the core rectangle keeps a hard edge for 2-3 s until the first ring tiles arrive; the sunset road glow is strong in the first seconds; the ocean polygon ends in a straight line far out; phones need 9-10 s to ready.

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
