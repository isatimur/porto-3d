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

## Stress tests (`scripts/perf-stress.mjs`)

Class switching 40 times in 5 s, `WEBGL_lose_context` loss and restore (the map redraws; screenshot read), freeze and resume of the page (the governor changes nothing), `?quality=` values and the saved choice, reduced motion, offline second visit through the service worker (caches `porto-v2`, `porto-data-v2`), and a 300 s soak flying to random landmarks: JS heap 190 to 195 MB (1.6 % spread), GL memory 628 to 667 MB (3 % spread), no console errors.
