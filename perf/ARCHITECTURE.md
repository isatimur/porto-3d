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

`UNMASKED_RENDERER` is matched against a rule table (Apple M and A series, NVIDIA RTX and GTX, AMD RDNA, Intel Arc, Xe, Iris, UHD and HD, Adreno 5xx to 8xx, Mali G5x to G7xx and Immortalis, PowerVR, SwiftShader and llvmpipe as software). The score is then adjusted for phones (capped below High), cores, `deviceMemory`, a 4K-class screen on a modest GPU, `saveData`, max texture size, and a measured 30 Hz cadence (iOS Low Power Mode). Software GL is always P. The display cadence is measured from the first 36 frames (lower quartile): a 120 Hz panel below Ultra is capped at 60 fps; a 30 Hz cadence lowers the score and the governor's target floor. `?quality=ultra|high|medium|low|potato|auto`, the menu choice and the class an earlier visit ended in (`porto-class-last`, 14 days) override the detection in that order. No WebGL 2: a clear message instead of a blank page (three.js needs WebGL 2; a lite scene was not built, see "Not done"). A lost context shows a toast; on restore the environment map is rebuilt and the scene draws again (checked with `WEBGL_lose_context` in `scripts/perf-stress.mjs`).

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
| Lazy landmark models (build on approach, cache the fit numbers in a baked JSON) | 70 models built at boot: fits 0.95 s desktop (5 to 6 s at 6x CPU), 124 MB of attribute data, about 110 KB gz of builders in the critical chunk | ready -15 to 20 % on phones, JS critical path -110 KB gz, heap -100 MB | The fit (pads, masks, camera boxes) reads the geometry's bounding box; it needs a baked fit cache plus a check that it matches the live fit. Too large to finish safely. |
| Tile and building geometry in a worker for the core | roads 0.95 s and buildings 1.2 s of main-thread work on desktop | long tasks -60 %, same total CPU | The core uses `heightAt` with pads that carry functions; they cannot be sent to a worker as they are. |
| Quantised vertex attributes (Uint8 colours, Int8 normals, packed `aWall`) | 262 MB of GL buffers on desktop, 273 MB on phones | GPU buffers -35 to 45 % | Needs shader changes in the facade and landmark materials and a screenshot proof for each; the budget went to the larger wins above. |
| Critical JS at 300 KB gz | now about 480 KB gz (three.js 165 KB, app 300 KB) | needs the lazy models and a split of `ui`, `tiles`, `nature` | Depends on the lazy models. |
| Font subsetting | two Roboto Flex files, 300 KB, third party | -100 to -150 KB on every first visit | The design uses the width axis; dropping `opsz` changes the headings slightly. Self-hosting a subset needs a font toolchain. |
| KTX2 / Basis textures | none: all 45 GPU textures are procedural canvases, 9 MB in total | none | Not applicable. The 100 MB of GL "textures" on desktop are render targets and the shadow map, which the class table already scales. |
| A lite scene for WebGL 1 | three.js r186 has no WebGL 1 backend | users without WebGL 2 | They get a clear message. |
| Software GL (Potato) at 8 fps | SwiftShader runs the scene at about 2 s a frame even at 0.5 resolution with 0.9 M triangles | would need under 0.2 M triangles | Class P is "works, slowly"; a real lite scene would need its own geometry. |
