# Performance baseline and results

Measured with `scripts/perf-bench.mjs` (Playwright and CDP) against a build served by `scripts/perf-serve.mjs` (brotli like Vercel). Raw results: `perf/baseline.json` (before) and `perf/results.json` (after). One Apple M1 Max runs every profile; `perf/profiles.json` says what each profile emulates and what is real.

## What is real and what is emulated

| Profile | Real | Emulated |
| --- | --- | --- |
| desktop-gpu (1440x900, DPR 2) | GPU, CPU, network | nothing |
| laptop-igpu | network | CPU 2x throttle; GPU: two OffscreenCanvas workers compete for the same GPU (about 3x slower at 5 MP: 22 ms against 7.5 ms on the Clerigos view); GPU name "Intel UHD 620" (string only) |
| phone-high (390x844, DPR 3, touch) | viewport, DPR, touch, network (Slow 4G, 1.6 Mbps, 150 ms) | CPU 4x; GPU not throttled (the Apple GPU is far faster than any phone GPU); GPU name "Adreno 740" |
| phone-low (360x740, DPR 2) | viewport, DPR, touch, network (Fast 3G, 562 ms RTT) | CPU 6x; GPU load; `deviceMemory` 2 and 4 cores (reported values); GPU name "Mali-G52" |
| potato (1280x720) | software GL (SwiftShader), network | CPU 4x on the main thread only (SwiftShader rasterises in the GPU process, which the throttle does not touch) |

The "before" numbers ran the old code, which never read the GPU name, so the spoofed names only matter after. Frame statistics use the 60 Hz display cap (what a user sees); the analysis session is uncapped (`--analysis`). GPU timer queries returned values ten times the frame interval on ANGLE/Metal and were dropped; CPU-bound against GPU-bound comes from uncapped frame time, a run with every `renderer.render` replaced by a 1-pixel clear, and a resolution sweep. The cap, the service worker (blocked: it hides bytes from the page's network log) and the missing real mobile GPUs mean the table says nothing about fill-rate limits of real phones.

Definitions. **First frame**: the first drawn frame (sky, terrain, one pin per landmark). **First meaningful frame**: the first full frame with the city built (landmarks, roads, buildings) and the controls live (`interactive` mark); the 3 s target of AGENTS.md is about this one. **Ready**: all deferred layers built (`__porto.ready`). **Transfer**: encoded bytes on the wire until ready, cold cache. **GPU MB**: peak bytes the page allocated through `bufferData`, textures and renderbuffers. **JS heap**: live heap after a full GC. **Long tasks**: main-thread tasks over 50 ms until ready, total.

## Before and after

Seconds unless noted. p95 is the worst p95 frame time over four camera paths (overview hold, Clerigos hold, Ribeira orbit, cinema), fly the p95 during the overview to Clerigos flight, ms, with the 60 Hz cap (16.7 is the cap). Tris and calls are for the overview.

| Profile | | First frame | First meaningful | Ready | Transfer KB | p95 ms | fly p95 | Dropped % | Tris M | Calls | GPU MB | JS heap MB | Long tasks s | Warm ready | Warm KB | Class |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| desktop-gpu | before | 1.0 | 5.1 | 7.6 | 2881 | 16.8 | 16.8 | 0.0 | 1.97 | 238 | 658 | 713 | 5.4 | 5.6 | 8 | |
| | after | 0.9 | 4.1 | 6.5 | 2165 | 16.8 | 16.8 | 0.0 | 1.97 | 238 | 658 | 191 | 4.4 | 4.6 | 6 | XL |
| laptop-igpu | before | 1.5 | 9.6 | 13.1 | 2949 | 33.3 | 33.4 | 12.6 | 1.97 | 238 | 658 | 715 | 10.9 | 11.6 | 2162 | |
| | after | 1.4 | 7.1 | 10.9 | 2165 | 16.8 | 16.8 | 0.0 | 1.79 | 191 | 359 | 187 | 7.1 | 7.5 | 6 | M |
| phone-high | before | 17.7 | 33.0 | 37.7 | 3518 | 16.8 | 33.3 | 0.2 | 0.93 | 106 | 320 | 695 | 19.2 | 19.0 | 8 | |
| | after | 9.7 | 20.8 | 25.0 | 2237 | 16.8 | 16.8 | 0.0 | 1.02 | 100 | 333 | 187 | 14.0 | 14.5 | 6 | M |
| phone-low | before | 20.3 | 44.3 | 49.7 | 2977 | 33.4 | 66.7 | 54.0 | 0.96 | 108 | 314 | 695 | 30.0 | 30.1 | 8 | |
| | after | 12.3 | 29.4 | 34.0 | 2237 | 16.8 | 50.0 | 0.3 | 1.05 | 99 | 325 | 187 | 21.6 | 22.5 | 6 | S |
| potato | before | 6.7 | 50.3 | 85.6 | 2881 | 6866 | 5833 | 100 | 1.93 | 195 | 457 | 702 | 57.1 | 79.0 | 2162 | |
| | after | 6.1 | 30.7 | 58.1 | 2063 | 4067 | 6133 | 100 | 0.88 | 159 | 349 | 178 | 43.2 | 55.1 | 6 | P |

(The warm "before" columns are from a second run of the old build against the static server with ETag validators; the first run had none, so every revalidation re-downloaded 2.1 MB.)

Reading it honestly:

- **Loading** improved on every profile: the slow-network phones reach the first frame in 55 to 60 % of the time and the first meaningful frame in 63 to 66 %. The cause is bytes (2.9 to 3.5 MB down to 2.2 MB at ready, and the first frame no longer waits for roads and buildings) plus less main-thread work (heightAt, the skyline grid, fewer light-class details).
- **Memory**: live JS heap 713 to 191 MB on every profile (the closure retention fix); GPU allocation 658 to 359 MB on the laptop profile (class M: no post targets, a 1024 shadow map), unchanged on desktop-gpu by design.
- **laptop-igpu**: from 12.6 % dropped frames to none, because the GPU name now lands the profile in class M. That also means it renders without the effects stack and with a 1024 shadow map: a visual trade the user can undo in the menu (Quality > High or Ultra).
- **phone-low**: dropped frames 54 % to 0.3 % in steady paths, p95 33.4 to 16.8 ms; the flight still has a 50 ms p95 (tile integration at 6x CPU).
- **potato** was not usable in this round: 2 to 4 s a frame. SwiftShader is bound by triangle count even at half resolution (0.88 M triangles after the potato cuts). The next round built the lite scene (below): 27 to 45 ms a frame.
- **desktop-gpu** is unchanged in frames, triangles and GPU memory by design; it loads 15 % faster and holds a quarter of the heap. Screenshots at three views (overview, Ribeira, Clerigos; `scripts/perf-shots.mjs <dist> <prefix>`, two runs per build) sit inside the run-to-run noise: PSNR 33.5 to 38.7 dB between two runs of the same old build (film grain, waves, clouds, live weather text), 33.2 to 38.7 dB between old and new build. I read the pairs; the only visible difference is the live weather line in the info box.

## Round 2: lazy landmark models and the lite scene

Same machine and harness. "Before" is the build of the first round (`/tmp/dist-before`, bench run again the same day, raw `/tmp/perf/before-4.json`), "after" the lazy-model build (commit `3571646` and its follow-ups; raw `/tmp/perf/after-full.json`). The machine was shared with another session during these runs (browser processes, builds), so frame statistics wobble by one or two vsyncs; where a number is inside that wobble, the text says so. Seconds unless noted.

### Lazy landmark models

| Profile | | First frame | First meaningful | Ready | Transfer KB | GPU MB | Long tasks s | Warm ready |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| desktop-gpu | before | 0.98 | 4.4 | 6.7 | 2063 | 672 | 4.6 | 5.1 |
| | after | 0.97 | 3.6 | 6.7 | 2102 | 543 | 4.2 | 5.6 |
| laptop-igpu | before | 1.45 | 7.9 | 11.7 | 2164 | 371 | 8.1 | 10.7 |
| | after | 1.48 | 6.0 | 12.1 | 2102 | 242 | 6.5 | 8.8 |
| phone-high | before | 10.0 | 21.9 | 27.1 | 2203 | 335 | 16.2 | 16.9 |
| | after | 9.9 | 17.6 | 24.7 | 2243 | 214 | 11.4 | 13.9 |
| phone-low | before | 12.4 | 33.1 | 38.3 | 2237 | 328 | 26.1 | 29.6 |
| | after | 12.0 | 26.0 | 37.9 | 2285 | 214 | 19.5 | 21.4 |

- **First meaningful frame** (the city built, controls live) is 18 to 23 % earlier on every profile with a throttled CPU (phone-low 33.1 to 26.0, phone-high 21.9 to 17.6, laptop 7.9 to 6.0, desktop 4.4 to 3.6); main-thread long tasks until ready fall by a quarter to a third (phone-low 26.1 to 19.5 s). The fits no longer build 774 k triangles of models (fit 0.95 s on the desktop, an estimated 5 to 6 s at 6x CPU).
- **Ready** moves little (6.7 to 6.7, 38.3 to 37.9): it waits for the deferred layers, which this change does not touch. The first frame did not move either (it never waited for the models).
- **GPU memory** falls by 115 to 130 MB on every profile: models not near the camera are never uploaded (672 to 543 MB desktop, 328 to 214 MB phone-low).
- **CPU-side vertex arrays held by the landmark meshes** (measured in the page, `scripts` helper `cpumb`): 124 MB (all 70 models, before) to 61 MB (XL, 32 models built 8 s after ready at the overview) and 44 MB (class Low, 23 built). **JS heap after GC did not change** (191 to 190 MB, 187 to 184 MB): typed-array storage is off the V8 heap, so the figure the bench reports cannot show this gain. A whole-process RSS comparison was too noisy to resolve it (the same build varied between 640 and 1137 MB between runs); I do not claim an RSS number.
- **Transfer** is 40 to 80 KB higher or the same (the model worker, the group chunks the first builds fetch, `fits.json` 56 KB) and the critical app chunk is 299.5 KB gzip against 237.5 KB (-21 %). The 60 KB difference is the 70 builders leaving the critical path; they sit in 10 chunks of 5 to 56 KB raw each plus the worker.
- **Frames and flights**: the steady paths are unchanged (p95 16.7 to 16.8 on desktop, laptop and phones; the Ribeira orbit and the cinema on phone-low have fewer dropped frames, 12.6 to 0.7 % and 22 to 2.9 %, but the 'before' run of that day was noisy). Frame times while flying to 10 landmarks in turn (`/tmp/p3/flights.mjs`, rAF deltas, 3 interleaved before/after rounds, 4x CPU, class Low): frames over 50 ms 8, 6, 10 before and 8, 7, 7 after; worst frame 133 to 1400 ms before, 150 to 167 ms after. At 1x CPU, class Ultra, 2 rounds: 3, 2 before and 3, 2 after (the worst, 170 to 180 ms, is the first selection of the session in both). **The "no frame over 50 ms when approaching a landmark" goal is not met on the 4x CPU emulation, before or after**: the remaining hitches are the tile integration, the vertex-clustered copy of a model (built on the main thread, one a frame) and the first GPU upload, none of which this change moves. It does not make flights worse in these runs: the build itself is in a worker, and wrapping a finished model took at most 0.2 ms (`maxWrapMs`; 1.2 to 1.5 ms is the cumulative `wrapMs` over 38 to 70 models), measured at 1x CPU. The 1 ms phone slice is not shown: at 4x CPU a trace of one flight (`/tmp/p3/hitch.mjs`) had `updatePins` frames of 14 to 33 ms while models arrived, but that function also runs the clustered-copy build, so the wrap share is not separated; I have no measurement of the wrap alone on a throttled CPU.
- **Screenshots** (overview and four close-ups: Ribeira, Clerigos, Luis I, Dragao; two runs per build, `/tmp/p3/ab-shots.mjs`): the counts of landmarks drawn full, clustered and as boxes (`lodStats`) are equal between the builds in every view, and I read the first-run pairs for the overview, Ribeira, Clerigos, Luis I and Dragao (the second-run files, `*-2.png`, I did not open): the models, their placement and the city are the same; the differences are the live weather (clear against overcast sky, the info box text, a bus). In the 'after' overview and Ribeira shots the gold pins have no glow while the 'before' pins do (the Clerigos and Dragao pairs match); I did not trace it: the likely cause is the governor turning the effects off under the load of the shared machine, not the lazy models, but that is unverified. PSNR between two runs of the *same* build was 13 to 27 dB that day because of the weather and clouds, so PSNR is not a usable test here; a pixel comparison needs a fixed weather and time.

### Lite scene (Potato)

| Profile | | First frame | First meaningful | Ready | Transfer KB | p95 ms (worst path) | Mean ms (worst path) | Tris overview / worst | Calls overview / worst | GPU MB | JS heap MB | Long tasks s | Warm ready |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| potato (SwiftShader 1280x720, CPU 4x) | before (full scene) | 6.1 | 30.7 | 58.1 | 2063 | 6133 | 2742 | 0.88 M / 2.02 M | 159 / 159 | 349 | 178 | 43.2 | 55.1 |
| | after (lite scene) | 4.0 | 5.0 | 5.0 | 2188 | 67 | 45 | 0.126 M / 0.154 M | 9 / 68 | 6.4 | 18 | 2.1 | 2.0 |
| phone-low emulation, `?quality=potato` | full scene (class S) | 12.4 | 33.1 | 38.3 | 2237 | 83 | 28 | 1.15 M | 100 | 328 | 187 | 26.1 | 29.6 |
| | lite scene | 10.9 | 13.6 | 13.7 | 2063 | 16.8 | 19.2 | 0.125 M / 0.153 M | 8 / 57 | 6.4 | 18 | 2.2 | n/a |

- On SwiftShader the lite scene runs at 22 to 36 frames a second (mean 27.6 to 45 ms over the five paths, p95 33 to 67 ms; the first flight has one 450 ms frame: the first model build). The target was 8 fps and 0.2 M triangles: met with a margin of 3x and 1.3x. Ready falls from 58 s to 5 s. On the phone-low emulation (CPU 6x, Fast 3G, a fast GPU) it holds 60 fps (p95 16.8 ms; the slowest path has 3.8 % dropped frames).
- A bench run while another session loaded the machine showed the Ribeira orbit at 301 ms mean once (p95 1.1 s); the repeat, with no other browser running, gave 36 ms. I report the repeat and say so here.
- The look: flat colours, terracotta roofs, grey stone, green land cover from the OSM land-cover mask, coarse relief with baked shading, water as a plane, 70 gold pins and labels, the top 12 landmarks as flat-shaded models when selected (Dragao: bowl, tiers, masts), the rest as coloured boxes, bridges as thin decks. Screenshots were read for the overview, Ribeira, Clerigos, Dragao (and Luis I, which exposed a park box that now stays hidden). What emulation cannot prove: how a real software-GL machine or a Mali-400 phone behaves (memory, the model worker on old Safari), and whether the flat look is acceptable to users; both are in `perf/DEVICE-CHECKLIST.md`.

## Where the frame time goes

Layer toggle sweep, A/B/A (baseline, layer off, baseline again; the delta is against the mean of the two baselines, `noise` is their difference), uncapped, DPR 2. The M1 Max hides most layers behind overlap; the laptop proxy shows the order.

Laptop proxy, overview, frame 17.4 ms (uncapped):

| Rank | Contributor | Frame ms saved when off | Noise ms |
| ---: | --- | ---: | ---: |
| 1 | Sun shadow pass | 8.1 | 0.4 |
| 2 | Post-processing stack (rays, bloom, SMAA, tone map) | 6.7 | 0.8 |
| 3 | Ground (430 k triangles at DPR 2) | 2.9 | 2.6 |
| 4 | Trams, rail, boats, birds, cable car (19 calls) | 2.5 | 1.5 |
| 5 | Trees | 2.0 | 1.7 |
| 6 | Buildings (480 k triangles) | 1.9 | 0.7 |
| 7 | Water | 1.6 | 3.0 |
| 8 | Roads (770 k triangles) | 1.2 | 0.2 |
| 9 | Far terrain tiles | 0.8 | 0.2 |
| 10 | MS buildings | 0.6 | 0.0 |

Label DOM, hidden: 0.3 ms (noise 0.4). The JS-only frame (every render call skipped) costs 2.1 ms on desktop, 3.9 ms at 2x throttle and 13 ms at 6x: update, labels, simulation and the draw submission that runs outside `render`.

Resolution sweep (frame ms against canvas pixels): desktop overview 2.9 ms at 0.3 MP, 9.3 ms at 5.2 MP, so 80 % of the frame is pixel-bound at DPR 2 and 20 % (1.8 ms) fixed; Ribeira 3.6 and 7.4 ms (65 %). Laptop proxy: 6.6 ms and 16.4 ms (75 %). This is why dynamic resolution is the first governor move.

Main-thread samples (V8 CPU profile on the dev server, desktop, 8 s of ready overview): 79 % idle; of the busy rest, three.js 9.6 % of the total (renderBufferDirect, projectObject, updateMatrixWorld, CSS2D `renderObject` 1.1 %), `heightAt` 2.3 % (was the top function at load, 11 %), life and people 1.3 %. At load (7.9 s, 1x CPU): three.js 24 % (shader compiles 5.8 %), `terrain.js` 12.8 % (heightAt), `nature.js` 10.4 %, `facades.js` 4.7 %, `buildings.js` 3 %, `kit.js` 2.6 % (landmark models).

Layer sizes at the Ribeira close-up (3.7 M triangles): roads 1.22 M, buildings 1.03 M, ground 0.71 M, landmarks 0.49 M, shadow casters 0.83 M.

## Bytes by file

Shipped build, 1556 files: 127 MB raw (assets 84 MB, data 30 MB). Brotli or gzip of text, raw for images.

| Group | Files | Raw MB | Brotli MB |
| --- | ---: | ---: | ---: |
| static (js, css, worker) | 17 | 2.3 | 0.62 |
| data/*.json | 13 | 14.1 | 2.2 |
| data/tiles, tiles-ms | 910 | 9.9 | 3.1 |
| data gtfs and other | 226 | 4.3 | 1.1 |
| assets/img | 231 | 76 | 76 |
| assets/pano | 5 | 6.8 | 6.8 |

Top shipped files by brotli size before the round: `assets/pano/sao-lazaro.jpg` 2.2 MB, `ponte-infante.jpg` 1.9 MB, **`data/buildings.json` 1.43 MB (8.8 MB raw)**, `alfandega-nova.jpg` 1.3 MB, `ribeira.jpg` 1.2 MB, then the landmark photos at 0.55 to 0.59 MB each, `static/index-*.js` 0.36 MB, `data/roads.json` 0.36 MB, `gtfs/schedule.json` 0.24 MB, `nature.json` 0.13 MB.

After: `buildings.bin.gz` 0.585 MB replaces the JSON on the critical path. The critical JavaScript is 475 KB gzipped (index 300, scene 97, three.core 66, city 12; was 547); life 44 KB, seasons, MS ring, quays, POIs and traffic model (about 70 KB) load after the first frame. The `dist` folder grows to 165 MB raw because the WebP copies sit next to the JPEGs; the on-demand image transfer falls from 580 KB to 255 KB (hero) and 53 KB (thumbnail).

Vercel brotli: static JS, JSON and CSS are served with `content-encoding: br` (checked on the deployed site at the end of the round; see claude-progress.md). Fonts: Google Fonts, two Roboto Flex files, 192 and 103 KB, unchanged.

## Round 3: draw and hold only what can be seen (2026-11-17, branch `perf/visible-only`)

Same machine, a build served by `scripts/perf-serve.mjs`, headless Chromium on ANGLE/Metal. The machine was shared with other work (load average 14 to 20, Blender and Docker busy), so frame times moved by a factor of two between runs of the same build; the tables lead with numbers that do not move with load (draw calls, primitives, bytes, the moment a panel shows). Primitives: triangles, plus 6 per fat-line segment and 1 per point, as `renderBufferDirect` receives them. "Out of view": draws whose world bounding sphere misses the camera frustum. Governor pinned at pressure 0 for the per-view numbers. The views: the overview; the Ribeira at roof height; the sea from the Foz shore looking west (the whole city behind the camera); Clérigos; the Luís I bridge; the São Bento stop of the history route; the Ribeira at night.

### Before: startup (cold cache, `?lang=pt&intro=0`)

| Profile | First frame | Landmarks in | Interactive | Ready | Route card on `#quest=…` | KB at ready | KB until the card | Long tasks to ready |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| desktop-gpu (XL) | 1.06 to 1.09 s | 1.30 to 1.33 s | 3.84 s | 6.7 to 7.1 s | 4.76 s (2 runs) | 2520 to 2540 | 2423 | 5.0 s |
| phone-low (S) | 13.5 to 14.6 s | 15.8 to 16.9 s | 27.8 to 29.1 s | 38.5 to 40.0 s | 32.3 s (2 runs) | 2499 to 2539 | 2431 | 21.6 to 22.2 s |

(A third phone-low run reached ready at 217 s with 197 s of long tasks while other runs shared the machine; it is left out.) The card counts as shown when its centre is not covered by the loader. On a `#quest` link the route's chunk was requested only after the whole core was built (phone-low: interactive at 29.1 s, `quest.js` at 28.6 s, `quest.json` at 30.7 s, the card at 32.3 s). The live site's 22.7 s (headless, real network) cannot be reproduced here.

### Before: per view (pinned, uncapped)

| View | desktop-gpu calls (main / shadow) | desktop-gpu primitives (main / shadow) | out of view (calls / prims) | phone-low calls | phone-low primitives | phone-low out of view |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| overview | 285 / 37 | 2.13 M / 0.29 M | 0 | 115 | 1.21 M | 18 / 4 k |
| Ribeira, roof height | 155 / 47 | 2.72 M / 0.59 M | 31 / 73 k | 98 | 2.05 M | 30 / 12 k |
| sea, city behind | 60 / 28 | 1.50 M / 0.21 M | 31 / 107 k | 64 | 1.43 M | 33 / 80 k |
| Clérigos | 156 / 64 | 2.59 M / 0.66 M | 35 / 83 k | 100 | 1.96 M | 35 / 16 k |
| Luís I bridge | 132 / 48 | 2.41 M / 0.63 M | 26 / 70 k | 100 | 1.92 M | 28 / 10 k |
| route stop (São Bento) | 101 / 54 | 2.12 M / 0.62 M | 47 / 66 k | 83 | 1.91 M | 33 / 12 k |
| Ribeira at night | 177 / 60 | 3.10 M / 0.76 M | 25 / 43 k | 120 | 2.29 M | 31 / 11 k |

JS heap after a full GC: 204 MB desktop, 197 to 203 MB phone-low. GL allocation on desktop 573 MB at the overview to 814 MB after the seven views (class XL keeps all 70 models by design); phone-low 155 to 363 MB. Live three.js geometries 310 to 403 (desktop), 141 to 283 (phone-low); textures 44 to 50 and 15 to 28.

### What the measurements say

- **The road layer is drawn whole in every view.** Its dozen meshes and fat-line sets (`roads.js`) each span the city (bounding radius about 1650 units, 6.6 km). Looking at the sea with the city behind the camera they still drew 1.19 M primitives, none on screen; at the Ribeira 1.5 M road primitives were drawn and about a fifth of their triangles were in view (centroid test, `street-minor` 20 %, `lane-markings` 21 %, `sidewalks` 24 %). On phone-low the roads are 1.2 of the 1.43 M primitives of the sea view. Hiding the roads saved 0.7 to 3.5 ms a frame on this GPU (noise 0.05 to 2.2 ms): the Apple GPU is pixel-bound, so the gain belongs to GPUs where vertices cost (phones).
- **`frustumCulled = false`**: 25 to 47 draws a frame are outside the view, 43 to 107 k primitives. The largest is the tram rails (a static InstancedMesh, 53 to 67 k primitives, exempt with no reason: its bounds never change). Next the street furniture rings (`porto-*`, `street-*`: 9 to 11 draws, 13 to 15 k), whose instances are refilled around the focus; the rest are small moving sets (boats, trains, cable car, live buses, rain, leaves, tree billboards) with 1 to 7 k each. The other exempt objects are always in view (sky, ground, fog, clouds, pins) or city-wide (the road lines, which come with the road fix).
- **Shadows**: turning the shadow pass off saved 4.5 to 15.9 ms on desktop; freezing the shadow map (no map render, same sampling) saved only 1.6 to 2.8 ms. Most of the cost is the sampling in every lit pixel, which a "skip the update when nothing moved" rule cannot remove; traffic and people cast, so a frozen map would leave their shadows behind.
- **Animated systems**: with the 60 Hz cap the desktop main thread is 76 to 82 % idle. Life, traffic and people take 1.5 to 3 % of it (0.3 to 0.5 ms a frame at 1x, an estimated 2 to 3 ms at the 6x phone CPU); traffic, boats and people already test the frustum; in the sea view life still takes 1.2 %. The CSS2D label pass walks the whole scene graph (0.5 to 0.9 %).
- **Mode chunks after exit** (desktop, heap after GC): ready 202 MB, story on 204 / off 205, history route on 206 / off 206, cinema on 205 / off 204. The modes hold under 4 MB once closed; releasing them is not worth a change.
- **Hidden tab, covered canvas, still camera**: the loop already cancels its frame on `visibilitychange` (and the live polls run from the loop); the panorama pauses it. The scene always animates (water, pins, traffic, people), so "render when nothing moves" never applies in the full scene.
- **Memory over time** (phone-low, class S, 5 min flying to 12 districts and back): JS heap after GC 204 MB at the start, 199 MB at the end; GL allocation 158 MB at the start, about 290 MB after two minutes, then flat (291 to 297 MB) to the end, back at the overview included; geometries 116 to 260, flat after two minutes; landmark models built 103 times, freed 81 times. Memory is bounded; it does not come back to the start figure when the camera returns home. A second run with the geometry held per layer (`__bench.gpuEstimate`) shows why: the CPU-side geometry is the same at the start and the end (core buildings 144 MB with both tiers, roads 67, ground 38, landmarks 38 to 45, MS ring 8, streamed tiles 1 to 5), while the GL figure rises from 158 to 333 MB. The growth is the first upload of core geometry that already existed but had not been drawn from the overview (building tiers, models); three.js keeps a buffer on the GPU as long as its geometry lives. Freeing far core tiles on the GPU would trade memory for an upload hitch on return; the class budget (380 MB on phone-low) holds, so it is listed below, not done.

### Ranked findings

| # | Item | Cost today | Expected gain | Risk | Effort |
| ---: | --- | --- | --- | --- | --- |
| 1 | `#quest` link waits for the whole city | card at 4.76 s desktop, 32.3 s phone-low | card with the landmarks: about 1.3 s desktop, about 17 s phone-low | low (the card is HTML; the camera waits for the city) | small |
| 2 | City-wide road meshes drawn whole | 1.19 M of 1.5 M primitives off screen (sea), about 1.2 M at street level | 0.8 to 1.2 M primitives fewer close up, the same calls over the city | low to medium (draw order inside a cell; shadow casters need the shadow view) | medium |
| 3 | Static or ring-bounded sets with `frustumCulled = false` | up to 67 k primitives and 10 to 12 draws behind the camera | those draws when out of view | low | small |
| 4 | Pixels under opaque panels (phone sheets cover 36 to 64 % of the canvas) | full-screen shading under the sheet | up to half the fill on phones with a sheet open | medium (scissor with post, panel edges) | medium |
| 5 | Life and traffic far from the camera | 0.3 to 0.5 ms a frame at 1x | an estimated 1 to 2 ms at 6x | medium (simulation catch-up) | medium |
| 6 | Shadow map refresh while nothing moves | 1.6 to 2.8 ms a frame (desktop) | that much, only when still | medium (moving casters' shadows lag) | small |
| 7 | GPU copies of core geometry far from the camera | 158 to 333 MB of GL allocation over a fly-around (phone-low) | up to about 150 MB on phones | medium (re-upload hitch on return) | medium |
| 8 | Render on demand | none found: the scene always animates, a hidden tab already stops | none | n/a | n/a |

### Results: main against the branch (2026-11-17, second session)

`main` b0b713b (built in a worktree) and the branch: the view rounds ran on three branch builds, 7e90a91, 2cbd81b and 580d308, which differ only in when the road cells are sorted (the drawing is the same); the startup rows are 580d308. Both served by `scripts/perf-serve.mjs` on two ports and measured in turn, round after round (`/tmp/porto-perf/measure.mjs`, headless Chromium, **ANGLE on Metal for every number here**; no software GL). Views: uncapped, governor pinned at level 0, `#time=day&weather=clear&live=0`, medians of three rounds. The app's 120 Hz frame limiter (`perf.js`) was switched off in the views: uncapped, it read the fast rAF as a 120 Hz panel on some runs and drew every other frame, which made one round of phone-low numbers worthless (dropped). `scripts/perf-bench.mjs --analysis` runs uncapped too and does not switch the limiter off: its numbers for classes below XL may carry the same halving. The machine was shared but quieter than in part 1 (load average about 5).

Per view, main -> branch:

| View | desktop-gpu main-pass primitives | desktop calls | desktop p50 / p95 ms | desktop script ms/frame | phone-low primitives | phone-low calls | phone-low p50 / p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| overview | 2.10 -> 2.08 M | 323 -> 323 | 16.8 / 32.7 -> 16.8 / 18.9 | 16.6 -> 16.6 | 1.21 -> 0.82 M | 96 -> 107 | 7.0 / 9.5 -> 6.4 / 9.1 |
| Ribeira, street level | 2.72 -> 1.91 M | 195 -> 219 | 16.9 / 33.3 -> 16.8 / 18.1 | 17.0 -> 16.7 | 2.07 -> 1.01 M | 88 -> 106 | 8.2 / 10.7 -> 7.7 / 10.5 |
| sea, city behind | 1.50 -> 0.21 M | 93 -> 82 | 11.1 / 14.1 -> 10.7 / 14.1 | 11.2 -> 1.8 | 1.43 -> 0.15 M | 49 -> 39 | 6.2 / 8.4 -> 4.0 / 6.4 |
| Clérigos | 2.59 -> 1.84 M | 212 -> 226 | 15.4 / 16.7 -> 15.3 / 16.4 | 15.3 -> 15.1 | 1.96 -> 1.01 M | 91 -> 110 | 8.6 / 11.1 -> 8.2 / 10.7 |
| Luís I bridge | 2.41 -> 1.58 M | 178 -> 201 | 13.8 / 15.0 -> 13.7 / 15.0 | 13.7 -> 13.5 | 1.92 -> 0.86 M | 86 -> 101 | 8.3 / 10.9 -> 7.8 / 10.5 |
| route stop (São Bento) | 2.12 -> 0.92 M | 150 -> 152 | 10.8 / 13.5 -> 10.6 / 12.2 | 10.8 -> 10.3 | 1.91 -> 0.71 M | 85 -> 87 | 8.3 / 11.0 -> 7.8 / 10.5 |
| Ribeira at night | 3.10 -> 2.35 M | 232 -> 254 | 17.0 / 19.0 -> 16.7 / 18.4 | 16.8 -> 16.6 | 2.28 -> 1.42 M | 112 -> 137 | 9.0 / 11.4 -> 8.8 / 11.5 |

Shadow-pass primitives fall 5 to 43 % on desktop (sea 0.21 -> 0.12 M) and are unchanged on phone-low (only landmarks cast there). GL allocation, JS heap after GC (202 to 205 MB desktop, 193 to 200 MB phone-low) and textures are the same on both builds; the branch holds 11 to 36 more geometry objects (the cell slots, which share the buffers of their object).

Startup, cold cache, three interleaved runs each (seconds):

| Profile | Build | First frame | Interactive | Ready | Route card on `#quest=from-the-tower-to-the-river` | KB at ready | KB until the card |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| desktop-gpu | main | 1.02 to 1.04 | 3.70 to 3.76 | 6.31 to 6.34 | 4.56 to 4.57 | 2518 to 2520 | 2423 |
| | branch | 0.91 to 1.04 | 3.73 to 3.77 | 6.27 to 6.43 | 1.25 to 1.30 | 2522 | 2321 |
| phone-low | main | 14.29 to 14.33 | 27.82 to 27.97 | 38.26 to 38.44 | 30.63 to 30.80 | 2499 | 2431 |
| | branch | 14.31 to 14.35 | 27.86 to 28.21 | 38.25 to 38.69 | 16.0 to 16.9 | 2501 | 2321 |

(One desktop branch run is left out: first frame 2.47 s, interactive 7.96 s, the machine stalled; the run before and after were normal.) The live site's 22.7 s to the route card (headless, real network) cannot be reproduced here; locally the card now opens 3.3 s sooner on the desktop profile and about 14 s sooner on phone-low, with 100 KB less on the wire before it.

Reading it:

- **Phones gain, desktops hold.** On phone-low (6x CPU, Metal) every view is faster at the median, 0.2 to 0.6 ms close up and 2.2 ms (35 %) in the sea view, with half the primitives or less, although close views now cost 15 to 25 more draw calls. The desktop GPU is pixel-bound at DPR 2: p50 does not move. The Ribeira street view lost its p95 spike (33 ms, a doubled frame) in all three rounds (main 32.9, 33.7, 33.3; branch 18.1, 18.2, 18.0); the overview's p95 is 18.5 to 33.9 on both builds, round by round, so its median says nothing. The CPU time the sea view spends submitting roads falls from 11.2 to 1.8 ms a frame (the frame still waits for the GPU's water and sky). On a GPU where vertices cost (phones) the primitive cut is the gain to expect; this machine cannot show it.
- **Load.** The roads' one-time cell sort first ran inside the roads build step: +55 to +140 ms to the first full frame on the desktop, +340 to +650 ms on phone-low. A counting sort (`2cbd81b`) halved it; running it after `ready`, one object per idle slot (`580d308`), brought the roads step back to main's (565 to 600 ms desktop, 3.1 to 3.2 s phone-low). Until an object is sorted it draws whole, as on main. The price moved after `ready`: the sort ends 1.4 to 1.9 s after it on phone-low (0.35 to 0.43 s on the desktop) and adds 1 to 3 long tasks of 52 to 92 ms there (long-task time in the 4 s after `ready`: main 342 and 552 ms, branch 398 and 725 ms); the longest task is the same as main's (118 to 132 ms, the app's own post-ready work). Desktop: at most one extra task of 54 ms.
- **The look.** Screenshots of the seven views on both profiles, main and branch, three rounds: the pixel diff is under 1 % with no blob over 13 cells of 16 px, except where water fills the frame (the sea view 3 to 23 %, the phone's Luís I view 2.3 %): the waves move between shots. I read the pairs of the overview, Ribeira, Clérigos, Luís I and the route stop (desktop) and Clérigos and Luís I (phone): they are the same picture. A stricter test on the branch alone: at four street-level spots (Aliados, Ribeira, Boavista, the Luís I deck), the camera turned in 45° steps and each frame was drawn twice, culled and with every road object whole, under reduced motion and with the labels hidden: 64 of 64 pairs (32 at desktop size, 32 at phone size) are pixel-identical. `scripts/cell-runs.test.mjs` holds the same rule for random cameras (no triangle or segment whose box meets the view or the shadow camera is left out).

Measured costs of what is left (phone-low unless noted, branch build, V8 profile of an unminified build at 6x CPU, 60 Hz cap):

| Item | Cost today | Why not now |
| --- | --- | --- |
| Matrices of static objects | 446 of the 678 scene objects recompute their matrix every frame (942 `updateMatrix` calls a frame: the render and the label pass each walk the scene); `updateMatrixWorld` and `multiplyMatrices` take 4.7 to 5.1 % of the main thread, about 1 ms a frame | landmarks (188 objects) move and scale (real scale, shrink, lazy swaps); a frozen matrix is a wrong picture. Harbour, quays and ground (109 objects) are safe but save about a quarter of it |
| Life far away or behind the camera | `life.js` 1.1 to 1.8 % of the main thread (about 0.2 to 0.4 ms a frame at 6x), 1.3 % in the sea view; traffic, boats and people already test the frustum | under 0.2 ms to win; the earlier estimate of 1 to 2 ms was too high |
| Tram rails | one static InstancedMesh of 53 to 67 k triangles, drawn whole when any of it is in view (7 to 9 % of the phone-low main pass close up) | three.js cannot draw a window of an InstancedMesh; splitting it into cells adds draw calls at the overview, where the desktop is at 323 of its 330 budget |
| Tree billboards and falling leaves | 14 to 28 k quads, always drawn (one instanced set each) | small; billboards behind the camera produce no fragments |
| Shadow map while nothing moves (desktop) | 1.6 to 2.8 ms a frame (part 1) | traffic, people and boats cast: their shadows would lag |
| Pixels under the phone sheets | the sheet covers 36 to 64 % of the canvas | scissor with the post stack and the sheet's edges: medium risk |
| GPU copies of far core tiles | GL 158 -> 333 MB over a fly-around (part 1), under the 380 MB budget | re-upload hitch on return |
| Transfer over the 2500 KB soft budget | 2584 KB main, 2604 KB branch: +2 KB of JS (cell-runs, the early route), the rest streamed tiles that finished before `ready`; the two Roboto Flex files are 293 KB of it | a font subset is a separate change |

## Stress tests (`scripts/perf-stress.mjs`)

Class switching 40 times in 5 s, `WEBGL_lose_context` loss and restore (the map redraws; screenshot read), freeze and resume of the page (the governor changes nothing), `?quality=` values and the saved choice, reduced motion, offline second visit through the service worker (caches `porto-v2`, `porto-data-v2`), and a 300 s soak flying to random landmarks: JS heap 190 to 195 MB (1.6 % spread), GL memory 628 to 667 MB (3 % spread), no console errors.
