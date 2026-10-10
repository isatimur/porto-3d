# Performance architecture

How porto-3d adapts to a 2018 laptop, a budget phone and a gaming desktop. Written from measurements (`perf/BASELINE.md`), not from guesses. Numbers are from one Apple M1 Max with CPU, network and GPU load emulated per device profile (`perf/profiles.json`); the limits of that are in `perf/DEVICE-CHECKLIST.md`.

## What the measurements said

1. **Bytes**: 2.9 MB at ready (brotli). 2.2 MB of it was data, and one file, `buildings.json` (9 MB, 1.43 MB brotli), was two thirds of that. The first frame waited for all of it: 17.7 s on the Slow 4G phone profile.
2. **Main thread**: 24 long tasks, 5.4 s in total before ready on desktop; 4x to 6x that on the throttled phones. `heightAt` scanned every landmark pad on each call and was 11 % of load CPU. The build steps (fits 0.95 s, roads 0.95 s, buildings 1.2 s on desktop) are plain JS geometry work.
3. **Memory**: 713 MB of JS heap stayed alive after a full GC (the same on phones). Cause: `buildBuildings` kept every tile's vertex buffers as plain JS arrays (8 bytes a number) alive through a shared closure context. GPU allocation was 658 MB on desktop (262 MB buffers, 393 MB textures: post targets 198 MB, shadow map 64 MB) and 313 MB on phones.
4. **GPU**: at DPR 2 the overview is 75 to 80 % pixel-bound on this GPU (frame time against canvas pixels), the Ribeira close-up 62 to 65 %. On the 3x-slower GPU proxy the shadow pass was 8 of 17 ms and the post stack 6.7 ms. Layer toggles move the frame by under 2 ms each on the fast GPU (noise 0.1 to 0.8 ms): no single layer dominates; resolution, shadows and post do.
5. **CPU floor** with every `renderer.render` skipped: 2.1 ms (desktop), 3.9 ms (2x throttle), about 13 ms at 6x. That is update, labels and simulation JS, and it is why phones at 6x need the simulation and label rates cut.
6. **The old governor never stepped** on any phone profile (it looked at the median over 40 frames) and took minutes on software GL.

## Decisions

### Device classes (`src/perf-classes.js`)

Five classes, one table: **XL** Ultra, **L** High, **M** Medium, **S** Low, **P** Potato. Each row holds the exact budgets the engine reads: DPR cap, shadow map, post level, tile radius, landmark and nature near radii, tree and car counts, label and simulation rates, geometry LOD factor, p95 target, and the triangle / draw call / GPU MB budgets. Classes M, S and P are "light" (the phone module budgets of the old `LITE` tier); L and XL are not.

### Detection (`src/perf.js`, scored in `perf-classes.js`)

`UNMASKED_RENDERER` is matched against a rule table (Apple M and A series, NVIDIA RTX and GTX, AMD RDNA, Intel Arc, Xe, Iris, UHD and HD, Adreno 5xx to 8xx, Mali G5x to G7xx and Immortalis, PowerVR, SwiftShader and llvmpipe as software). The score is then adjusted for phones (capped below High), cores, `deviceMemory`, a 4K-class screen on a modest GPU, `saveData`, max texture size, and a measured 30 Hz cadence (iOS Low Power Mode). Software GL is always P. The display cadence is measured from the first 36 frames (lower quartile): a 120 Hz panel below Ultra is capped at 60 fps; a 30 Hz cadence lowers the score and the governor's target floor. `?quality=ultra|high|medium|low|potato|auto`, the menu choice and the class an earlier visit ended in (`porto-class-last`, 14 days) override the detection in that order. No WebGL 2: a clear message instead of a blank page. three.js r186 has no WebGL 1 backend (its renderer does not construct without a WebGL 2 context), so a WebGL 1 only browser cannot run even the lite scene; it gets the same message. Software GL (SwiftShader, llvmpipe) is class P and runs the lite scene (below). A lost context shows a toast; on restore the environment map is rebuilt and the scene draws again (checked with `WEBGL_lose_context` in `scripts/perf-stress.mjs`).

### Governor v2 (`src/governor.js`)

One integer, `pressure` (0 to 28), orders every knob from the least visible cut to the most visible: dynamic resolution first (0.95 down to 0.5 in 0.05 steps, a continuous scale on top of the class DPR that also works on 1x screens), then shadow map size, the effects stack (sun rays, bloom, SMAA, then no composer at all), counts, the close-range geometry factor (building detail and roof tiers, road markings, landmark clustered copies), tile radius, label and simulation rates, water shader, shadows off. Going up undoes the moves in reverse.

- The signal is the **p95** of the frame interval over 2.5 s, against a target that belongs to the device (the detected class's target, never tighter than 1.15 refresh intervals).
- Broad overload (the median misses the refresh) steps after 2 evaluations, by more when far over; hitches only (median fine, tail long: tiles landing in a flight) need 12 evaluations, because cutting resolution does not touch them.
- A step down needs 4 s of headroom and a 6 s cool-down; a level that failed is locked for 45 s, doubling to 6 min, so the loop cannot oscillate.
- Still overloaded at pressure 18: the class below (thermal throttling, a weaker device than scored). A long calm spell re-enters the detected class (twice at most). A hidden tab pauses the loop.
- `scripts/smoke-perf.mjs` drives it with a synthetic load schedule (light, heavy then calm, square wave, thermal ramp, 1.8 s frames, hitches, hidden tab) and asserts bounded changes per minute. It runs in `npm run verify`.

### Loading

- Everything the first frame needs is awaited; `roads.json` and `buildings.json` download in parallel with the landmark fits and are awaited by their build step (the projection needs only the city origin and bbox, identical to the roads file's).
- `buildings.json` (9 MB, 1.43 MB brotli) became `buildings.bin.gz` (600 KB): integer 1e-5-degree coordinates, zigzag varint steps, no JSON parse, no 355 000 point arrays. `scripts/pack-buildings.mjs` writes it and `--check` (part of `verify`) proves every coordinate identical. It is gzipped by the script and unpacked with `DecompressionStream`, so its wire size does not depend on which content types a CDN compresses. The JSON stays as fallback.
- Data files carry `?v=<content hash>` (`vite.config.js __DATA_V__`), and `vercel.json` serves those as `immutable`: a returning visit makes no request for data that did not change (warm reload: 6 KB, was 2.1 MB). `cache: 'no-cache'` is gone.
- Life, seasons, the MS ring, quays, POIs and the traffic model are separate chunks, started after the critical data arrives and awaited by the deferred build steps. The calçada material moved to `calcada.js` so roads no longer drag the street-life module into the main chunk.
- Service worker: shell precache only; versioned data and hashed bundles cache-first; unversioned data network-first; data cache capped at 600 entries, photos at 120 (oldest out).
- Photos: `assets/img/*.webp` (1280 px, 250 KB instead of 600 KB) and `-480.webp` thumbnails (53 KB) for the labels; panoramas as WebP (40 % smaller). JPEGs stay for the social previews.

### Lazy landmark models

The 70 detailed models (774 k triangles, 124 MB of attribute data) are no longer built at boot.

- **Baked fit cache** (`scripts/bake-fits.mjs` writes `data/fits.json`, 56 KB). `fitLandmark` has two halves: a geometry-free one (footprint frame, base level, pad box, extent, rise) and the numbers it reads from the built model (local box, the placed box, the named group boxes `main` / `height` / `mask`, glass, draped, markers, piece names, bounding sphere). The second half is baked; the app assembles the same `fit` from it and builds nothing. The fit rule of each builder is baked too (RegExp as `{ $re }`); the four big bridges carry `pad.level` functions the terrain calls, so the app loads their group chunk at boot and takes those rules from it. `npm run build` runs `bake-fits --if-stale` (an input hash over builders, `fit.js`, terrain, footprints, dimensions, landmarks), so a stale cache cannot ship.
- **Check** (`npm run check:fits`, in `npm run verify` as "fit cache"): the hash is current; every cached entry equals a live eager fit (tolerance 1e-6); a fit made from the cache alone equals the live fit in every number the app reads (pivot, boxes, plan, pad, base, sizes, deviation, markers, bridge pad heights); never-shrink gives the same answer on both; every landmark has exactly one builder group.
- **Worker** (`src/model-worker.js`, `model-job.js`, `model-client.js`): one module worker, started at the first request. It rebuilds the terrain from the raw grid (as the tile worker does), runs the same `fitLandmark` eagerly for one landmark and returns the placed vertex arrays as transferables. The main thread only wraps them in a `BufferGeometry` (0.1 to 0.2 ms, one a frame) and compares the worker's boxes with the cache (a mismatch counts in `__porto.landmarkModels().mismatch` and warns). A builder call is atomic (72 ms for Luis I on this machine, about 430 ms at 6x CPU), so the 2 ms / 1 ms main-thread slice rule is met by moving the whole build off the thread, not by slicing it. If a module worker cannot start, the same job runs on the main thread (one long task per model). `?lazymodels=0` builds everything at boot as before (A/B tests).
- **Builder chunks**: 10 groups by neighbourhood and type (`src/models/groups/*.js`: bridges 6, churches-core 16, churches-outer 5, civic 12, museums 6, theatres 6, coast 8, parks 6, river 3, stadiums 2), loaded by the worker on demand (`src/models/loader.js`). The critical chunk went from 300 to 215 KB gzip.
- **Queue** (`landmarks.js`): one build in flight, the wanted landmark with the smallest priority first: the selected one and anything asked for (`ensureBuilt`, `prefetch`) at -1, then the camera within `modelsAhead` x its full-detail radius R (1.2 on XL and L, 1.3 on M, 1.25 on S and P) nearest first, then on XL and L the first 8 / 6 landmarks of the list in idle time (after the first full frame, not while flying, frame p50 under 22 ms). The massing box that already stood in beyond R stands in until the model is built, so the swap at R is the one that always existed and nothing pops. Selecting a landmark builds it at once (flight start); the cinema asks for the shot's landmark and the next one; the story mode for the station's. The streetscape reads the floors of the big landmarks near the centre from their meshes, so those (over 1500 m2 within 1.3 km of the centre) are built and pinned before life starts. `__porto.ready` waits for the models near the camera (none at the overview).
- **Eviction**: `modelsKeep` models stay built (XL, L: all 70; M 24; S 14; P 8); beyond that the farthest one outside 1.15 x the build radius is freed (GPU buffers, cluster copy, glass), never the selected, pinned or held ones.

### Lite scene (class Potato)

Software GL runs a triangle at the cost of its pixels and its count; the full scene at 0.88 M triangles needed 2 to 4 s a frame even at half resolution. Class P now builds a separate scene (`src/lite/`, loaded only for P) from the same data through cheaper builders. Chosen by the class at the start of the visit (`?quality=potato`, the menu entry "Potato - lite scene", or detection); `?scene=lite` forces it on any class, `?scene=full` keeps the full scene on P. The governor cannot swap scenes on the fly: a visit that is demoted to P at run time keeps its scene, the next visit starts lite (the learned class). Changing the menu across the scene line reloads.

| Layer | Full scene | Lite scene |
| --- | --- | --- |
| Sky, light | shader sky, sun, shadows, PMREM, fog, post | a 2 x 128 canvas gradient as `scene.background`, no lights, no shadows, no fog, no tone curve, no post, no antialiasing |
| Time of day, seasons | light, sky, fog, foliage | one colour tint per time (morning, day, sunset, night) on every material, one tint per season on ground and sea: colour only |
| Ground | 430 k triangles, shader | 160 m grid, 40 k triangles, vertex colours baked from land cover, slope shading, built-up share; outer rings fade into the horizon colour |
| Water | shader, ribbons and polygons | one plane at 1 m elevation (the DEM below it shows as water), vertex colours |
| Roads | 770 k triangles with markings | primary and secondary as one merged ribbon mesh, the rest one merged line set, no markings, heights from the coarse ground |
| Buildings | extruded footprints with facades and roofs, streamed tiles | oriented flat-roof boxes, merged per 250 m cell, only the nearest 6500 buildings (cells within 900 m), one coarse 125 m block per cell beyond; the 355 k footprints are read once into 9 MB of typed arrays; no streamed ring, no MS ring |
| Landmarks | detailed model near, massing far | oriented coloured boxes (bridges: a thin deck at deck height); the 12 most important get their detailed model, unlit with its vertex colours, only when selected or filmed; no glass; outlines are 1 px lines |
| Life, weather, nature, seasons module | simulations, particles, trees | none |
| Labels, DPR | class P: 12, 5 Hz, DPR 1 | the same |

Vertex colours carry the shading (face shade from a fixed north-west light; roofs terracotta), so no pixel runs a lighting calculation. The UI, search, routes, panels, cinema, story, panorama and the camera rig are the same code. Not in the lite scene: weather states (the Atmosphere popover keeps them disabled), people, vehicles, trees, the streamed ring beyond the core, street markings, glass.
Measured on the potato profile (SwiftShader, 1280 x 720, CPU 4x): see `perf/BASELINE.md`.

### Memory

- `buildBuildings` clears its tile table and item lists after the meshes exist: **713 MB to 191 MB** of live JS heap.
- The lazy composer: classes that draw straight to the canvas never allocate the post targets. Measured: the laptop profile (class M) allocates 359 MB on the GPU against 658 MB for the same machine as Ultra; the phone profiles were already small (no composer at DPR 1.5 before either: 313 to 333 MB, mostly vertex buffers).
- Light classes skip the roofs-only copy of every building tile (a second set of vertex buffers) and use half the near-detail triangle budget.
- GL allocation is counted (`bufferData`, `texImage2D`, `texStorage2D`, `renderbufferStorage` minus deletes) in the page and shown in the overlay and the bench.

### Frame pacing

- The simulation (`life.update`) and the label pass run at the class rate (60 / 60, 60 / 30, 30 / 20, 30 / 10, 15 / 5 Hz for XL, L, M, S, P), time handed over, never lost.
- `heightAt` pad lookup through a coarse grid: same result bit for bit, 11 % of load CPU.
- The 120 Hz cap below Ultra, and the skyline grid for cinema flights built on first use from five floats per building instead of holding the 9 MB list.

### Perf CI

`perf/budgets.json` per profile, `npm run perf` (reduced matrix, desktop-gpu and phone-low), a soft gate in `npm run verify` (WARN on a miss, FAIL on a console error), `npm run perf:full` for all five profiles. `scripts/perf-stress.mjs` runs class switching, context loss, freeze and resume, `?quality=` overrides, reduced motion, offline revisit and a 5-minute soak.

## Not done, with expected gain

| Item | Why it matters | Expected gain | Why not done |
| --- | --- | --- | --- |
| Lite scene on weak phones (class S) | a Mali-G52 class phone on the full scene at p95 50 ms in flights | would make flights smooth on class S | The lite scene exists (class P, `?scene=lite` on any class); making it the S default is a visual trade that needs real-device numbers first. |
| Weather states, people and vehicles in the lite scene | the lite scene has none | parity with the full scene | by design: colour tints only |
| Tile and building geometry in a worker for the core | roads 0.95 s and buildings 1.2 s of main-thread work on desktop | long tasks -60 %, same total CPU | The core uses `heightAt` with pads that carry functions; they cannot be sent to a worker as they are. |
| Quantised vertex attributes (Uint8 colours, Int8 normals, packed `aWall`) | 262 MB of GL buffers on desktop, 273 MB on phones | GPU buffers -35 to 45 % | Needs shader changes in the facade and landmark materials and a screenshot proof for each; the budget went to the larger wins above. |
| Critical JS below 215 KB gz (app chunk) | the app chunk is 215 KB gz now (was 300) | a split of `ui`, `tiles`, `nature`, `fit` | the models are out; the rest is shared by every class. |
| Font subsetting | two Roboto Flex files, 300 KB, third party | -100 to -150 KB on every first visit | The design uses the width axis; dropping `opsz` changes the headings slightly. Self-hosting a subset needs a font toolchain. |
| KTX2 / Basis textures | none: all 45 GPU textures are procedural canvases, 9 MB in total | none | Not applicable. The 100 MB of GL "textures" on desktop are render targets and the shadow map, which the class table already scales. |
| A lite scene for WebGL 1 | three.js r186 has no WebGL 1 backend; its renderer does not construct without WebGL 2 | users without WebGL 2 | Not possible with this three.js: they get the clear message (a WebGL 1 renderer would be a rewrite on raw WebGL or an older three.js). |
