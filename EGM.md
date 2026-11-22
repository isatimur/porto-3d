# porto-3d Delta Contract

## Overview

porto-3d is a single-city fork of the Braga 3D engine (Vite, Three.js, real-scale city map). It shows Porto.

- City id: `porto` [cities/porto.json:id]. Names: pt "Porto", en "Porto", ru "Порту".
- Domain: `https://porto-3d.com`. Hostnames: `porto-3d.com`, `www.porto-3d.com`, `porto-3d.vercel.app` [cities/porto.json:domain, hostnames].
- Data folder: `data/` at the repo root (flat, one city). Braga uses a per-city layout in places (`data/*/landmarks.json` in `braga-3d/vercel.json`). The fork's `vercel.json` includes `data/*.json`.
- Origin 41.1496, -8.611. Core bbox s41.12 w-8.68 n41.19 e-8.55. Terrain EU-DEM 25 m, 110 m spacing. Time zone Europe/Lisbon. Default locale `ru` [cities/porto.json].
- `data_absent`: `pois.json`, `streetscape.json` [cities/porto.json:data_absent].
- Fork HEAD: `5a1cd70` (Merge branch 'feat/mindera', porto-030). Tree clean (`git status --short | wc -l` = 0) on 2026-11-22.
- Compared against: braga-3d git main `431ff94` (Merge fix/walk-start).
- Engine base the fork last recorded: `1784ff3` [scripts/engine-base.txt]. `scripts/sync-engine.sh` has not run since the fork (AGENTS.md "Engine Lineage", feature `porto-011`). So Braga is ahead on every shared file that shows a diff.
- Date of this contract: 2026-11-22.
- Scope compared: `src/` (with `src/models/`, `src/locales/`), `scripts/`, `api/`, `public/sw.js`, `vite.config.js`, `package.json`, `vercel.json`. Excluded: node_modules, dist, data, assets, docs, output, .git, .vercel.
- Group counts: identical 24, changed 91, only in fork 136, only in Braga 55 (170 files in Braga, 251 in the fork, 115 shared).

## Fork-Only Interface

136 files exist only in the fork. 84 are landmark builders in `src/models/porto/` and `src/models/groups/`. The other 52 are below.

Landmark builders (84 files):
- `src/models/porto/*.js`: one builder per Porto landmark, plus `block.js`, `site-fit.js` and the registry `index.js` (roster-expansion builders only; it imports 50 builders).
- `src/models/groups/*.js`: ten lazy chunks: bridges, churches-core, churches-outer, civic, coast, museums, parks, river, stadiums, theatres [src/models/loader.js:GROUP_LOADERS].
- Landmark ids in `data/landmarks.json` (68 ids by name match; the file has 142 `"id"` keys, which include route and nested ids; not determined which are landmarks): clerigos lello sao-bento se-porto bolsa sao-francisco-porto ponte-luis-i ribeira serralves casa-musica dragao felgueiras caves-gaia ponte-arrabida ponte-maria-pia mercado-bolhao aliados carmo palacio-cristal uporto-reitoria ponte-sao-joao ponte-infante ponte-freixo serra-do-pilar jardim-do-morro cais-gaia convento-corpus-christi estacao-general-torres trindade congregados lapa santa-clara sao-nicolau sao-bento-vitoria cedofeita santo-ildefonso miragaya-sao-pedro capela-almas foz-sao-joao-baptista ramalde campanha coliseu museu-soares-dos-reis casa-do-infante alfandega-nova museu-romantico casa-guerra-junqueiro teatro-rivoli cinema-batalha cadeia-relacao almeida-garrett museu-misericordia parque-cidade cordoaria sao-lazaro passeio-alegre praca-batalha castelo-queijo praia-ingleses sealife-porto bessa teatro-sa-da-bandeira teatro-nacional-sao-joao igreja-da-vitoria igreja-carmelitas casa-museu-marta-ortigao-sampaio mercado-matosinhos camara-matosinhos farol-leca paco-episcopal mindera. AGENTS.md states 70 detailed builders.

Engine modules (`src/`):
- `[src/model-worker.js]`, `[src/model-client.js:createModelClient]`, `[src/model-job.js:createModelJob]`, `[src/model-build.js:makeModels]`, `[src/model-meta.js:createMeta]`, `[src/model-meta.js:serializeRule]`, `[src/model-meta.js:reviveRule]`, `[src/model-meta.js:FITS_VERSION]`: landmark models build in a worker. The main thread reads the baked `data/fits.json`.
- `[src/models/loader.js:loadGroup]`, `[src/models/loader.js:loadGroups]`: async builder chunks.
- `[src/models/bridge-kit.js:bridgeFrame]`, `[src/models/bridge-kit.js:truss]`, `[src/models/bridge-kit.js:loft]`, `[src/models/bridge-kit.js:cuttingWalls]`, `[src/models/bridge-kit.js:landfall]`, `[src/models/bridge-kit.js:rod]`: parts for the Douro bridges.
- `[src/bridge-decks.js:setDeckBases]`, `[src/bridge-decks.js:deckBase]`, `[src/bridge-decks.js:authoredDeck]`, `[src/bridge-decks.js:BRIDGE_DECKS]`: roads and rails ride the authored bridge deck height.
- `[src/coast.js:buildSea]`, `[src/coast.js:seaState]`: sea from the OSM coastline.
- `[src/harbour.js:loadCoast]`, `[src/harbour.js:buildHarbour]`: harbour structures.
- `[src/quays.js:loadQuays]`, `[src/quays.js:buildQuays]`: Douro quay walls from `data/quays.json`.
- `[src/pad-walls.js:buildPadWalls]`, `[src/pad-walls.js:openWaterTest]`: retaining walls under landmark pads.
- `[src/ground-mesh.js:buildGround]`: chunked ground lattice with level of detail.
- `[src/terrain-fine.js:packFine]`, `[src/terrain-fine.js:unpackFine]`: fine core terrain pack `data/terrain-fine.bin.gz`.
- `[src/calcada.js:calcadaMaterial]`, `[src/calcada.js:calcadaPatternOf]`, `[src/calcada.js:CALCADA]`, `[src/calcada.js:KERB_SIDE]`: calçada material moved out of `streetscape.js`.
- `[src/street-kit.js:createStreetKit]`, `[src/porto-streetscape.js:buildPortoStreetLife]`: Porto street furniture and signage.
- `[src/street-trees.js:loadStreetTrees]`, `[src/street-trees.js:plantStreetTrees]`, `[src/street-trees.js:EVERGREEN]`, `[src/street-trees.js:HEDGE]`: OSM street trees from `data/trees.json`.
- `[src/art-pack.js:startArtPack]`: optional lazy texture pack (roof tiles), never on the first-load path.
- `src/lite/` (`index.js`, `atmosphere.js`, `city.js`, `ground.js`, `roads.js`, `seasons.js`): lite scene for device class P (`?scene=lite` forces it) [AGENTS.md "Performance"].
- `[src/locales/en.porto.js]`, `[src/locales/pt.porto.js]`: generated by `scripts/merge-content.mjs`; exports `landmarks`, `routes`. Braga has `locales/en.js` and `pt.js` instead.

Scripts (`scripts/`, 26 files): `bake-fits.mjs`, `build-stops.mjs`, `check-coast.mjs`, `engine-base.txt`, `fetch-coast.mjs`, `fetch-life.mjs`, `fetch-photos.mjs`, `fetch-quays.mjs`, `fetch-terrain-fine.mjs`, `fetch-trees.mjs`, `merge-content.mjs`, `optimize-images.mjs`, `pad-report.mjs`, `perf-bench.mjs`, `perf-page.js`, `perf-serve.mjs`, `perf-shots.mjs`, `perf-stress.mjs`, `smoke-console.mjs`, `smoke-life.mjs`, `smoke-perf.mjs`, `smoke-rail.mjs`, `smoke-trams.mjs`, `sync-engine.sh`, `terrain-load.mjs`. Roles are from file names and the AGENTS.md commands only; the exports of each script were not read.

## Changed Engine Files

91 shared files differ. Counts are `diff a b | grep -c '^[<>]'` (lines on either side). Notes come from diff heads and fork-only file comments; "not determined" means the diff was too large to summarise from a head.

Ten most changed:

| File | Differing lines | What differs |
| --- | ---: | --- |
| `src/life.js` | 1971 | Large rewrite. Braga's header documents the Bom Jesus funicular and OSM traffic; the fork's does not. Rest not determined. |
| `src/nature.js` | 1728 | Fork plants OSM street trees ([src/street-trees.js]) into the same instanced meshes. Landmarks that are parks keep only the built core clear. |
| `src/people.js` | 1289 | Braga header lists a varied crowd (children, elderly, cyclists, dogs, groups, market crowd). Fork differs; detail not determined. |
| `src/main.js` | 1182 | Fork imports `pad-walls`, `bridge-decks`, `setBridgeLamps`, `setBridgeNight`, `LAMP_UNIFORM`. Braga imports `perf.js` (`initPerf`, `showNotice`), `perf-classes.js` (`CLASSES`, `MAX_PRESSURE`, `knobsFor`, `modeToClass`) and water `seekWater`, `resumeWater`. |
| `src/roads.js` | 996 | Calçada patterns use `textures.js` calçada maps in the fork; bridge deck heights ([src/bridge-decks.js]). Rest not determined. |
| `src/water.js` | 857 | Fork adds `setBridgeLamps`, `setBridgeNight`. Braga has `seekWater`, `resumeWater`. |
| `src/buildings.js` | 852 | Not determined. |
| `src/style.css` | 847 | Not determined. Fork adds `.is-none` figure rule for places without a photo [claude-progress.md, 2026-11-20]. |
| `src/facades.js` | 819 | Fork has a roof canal tile branch (`uRoofTex`) fed by [src/art-pack.js]. |
| `src/scene.js` | 764 | Fork uses `groundAxes` and the chunked ground mesh ([src/ground-mesh.js]). |

Other changed files:

| File | Differing lines | What differs |
| --- | ---: | --- |
| `src/landmarks.js` | 740 | Models build lazily in a worker (AGENTS.md); exports `LAMP_UNIFORM`. |
| `src/road-network.js` | 656 | Not determined. |
| `src/livebus.js` | 631 | Not determined. Fork reads two GTFS feeds (STCP, Metro do Porto) [cities/porto.json:transit]. |
| `src/textures.js` | 599 | Fork holds calçada maps (see `roads.js`). Rest not determined. |
| `src/terrain.js` | 539 | Fork uses the fine terrain pack and pads with walls. Rest not determined. |
| `src/streetscape.js` | 452 | Calçada material moved to `calcada.js`; fork calls `buildPortoStreetLife`. Rest not determined. |
| `scripts/fetch-footprints.mjs` | 422 | Not determined. |
| `src/weather.js` | 386 | Not determined. |
| `scripts/check-layers.mjs` | 369 | Not determined. |
| `scripts/fetch-gtfs.mjs` | 364 | Not determined (two-feed GTFS in the fork config). |
| `scripts/fetch-nature.mjs` | 339 | Not determined. |
| `src/fit.js` | 315 | Fork fits models with `fits.json` bake, `padFor`, never-shrink rule [AGENTS.md]. |
| `src/tour.js` | 277 | Not determined. |
| `scripts/fetch-routes.mjs` | 244 | Not determined. |
| `src/tiles.js` | 243 | Not determined. |
| `src/models.js` | 227 | Registry logic moved to `model-build.js`. |
| `api/guide.js` | 221 | Not determined. `vercel.json` includes `data/*.json` for it. |
| `src/data.js` | 214 | Not determined. |
| `src/buildings-ms.js` | 213 | Not determined. |
| `scripts/make-og.mjs` | 204 | Fork renders lite scene for `--og` [claude-progress.md, 2026-11-20]. |
| `scripts/fetch-roads.mjs` | 196 | Not determined. |
| `scripts/quest.test.mjs` | 194 | Not determined. |
| `src/locales/ui.js` | 157 | Not determined. |
| `scripts/verify.mjs` | 156 | Fork gate has 17 checks (build, data, geo, dimensions, fit, traffic, models, smoke life/trams/rail/console, route pages, perf soft gate and more); no discovery step. |
| `src/quest.js` | 104 | Not determined. |
| `scripts/landmark-heights.mjs` | 100 | Not determined. |
| `vite.config.js` | 91 | Fork has no `localNews` plugin and no `knownCities` list; adds `createHash` for `?v=` content hashes. |
| `scripts/count-tris.mjs` | 87 | Not determined. |
| `scripts/route-pages.mjs` | 84 | Not determined. |
| `src/quest-progress.js` | 74 | Storage key `porto-quests-<city>` [src/quest-progress.js:KEY]. |
| `src/quest.css` | 72 | Not determined. |
| `src/layer-defs.js` | 71 | Not determined. |
| `scripts/layers.test.mjs` | 71 | Not determined. |
| `src/seasons.js` | 69 | Not determined. |
| `public/sw.js` | 60 | Versions `porto-v2`, `porto-data-v2`, `porto-photos-v2`; caps `DATA_MAX` 600, `PHOTO_MAX` 120; cache-first for `?v=` data. Braga: one cache `braga-v3`. |
| `src/effects.js` | 53 | Not determined. |
| `src/ui.js` | 51 | Fork sets `.is-none` on card and details figures for places without a photo. |
| `src/live.js` | 51 | Not determined. |
| `scripts/cell-runs.test.mjs` | 48 | Not determined. |
| `src/cell-runs.js` | 47 | Not determined. |
| `src/camera.js` | 47 | Not determined. |
| `src/leaves.js` | 46 | Not determined. |
| `src/layers-ui.js` | 45 | Not determined. |
| `src/perf.js` | 43 | Not determined. |
| `scripts/check-geo.mjs` | 44 | Takes `--city porto`. |
| `scripts/fetch-tiles.mjs` | 43 | Not determined. |
| `src/road-structures.js` | 41 | Not determined. |
| `src/city.js` | 40 | Not determined. |
| `src/story.js` | 38 | Not determined. |
| `src/guide.js` | 38 | Not determined. |
| `src/search.js` | 33 | Not determined. |
| `scripts/check-data.mjs` | 29 | Takes `--city porto`. |
| `src/fly.js` | 28 | Not determined. |
| `package.json` | 26 | Name `porto-3d`; adds `prebuild`, `bake:fits`, `check:fits`, `perf`, `perf:full`, `perf:serve`, `pack:buildings`, `check:coast`, `fetch:coast`, `count-tris`; all checks pass `--city porto`; drops `layers`, `check:discovery`. |
| `vercel.json` | 21 | Redirects to `porto-3d.com`; no `api/news.js`; `guide.js` includes `data/*.json`; adds immutable cache for `/data/*` and `/cities/*` with `?v=`. |
| `src/traffic-model.js` | 19 | Not determined. |
| `src/i18n.js` | 19 | Not determined. |
| `src/liveair.js` | 18 | Not determined. |
| `scripts/smoke-flicker.mjs` | 18 | Not determined. |
| `api/route.js` | 16 | Not determined. |
| `src/pois.js` | 15 | Not determined. |
| `scripts/layers-manifest.mjs` | 14 | Not determined. |
| `api/_city.js` | 14 | Not determined. |
| `scripts/check-fit.mjs` | 12 | Not determined. |
| `api/adsb.js` | 12 | Not determined. |
| `scripts/check-traffic.mjs` | 11 | Not determined. |
| `src/share.js` | 10 | Not determined. |
| `src/tile-worker.js` | 8 | Not determined. |
| `src/buildings-pack.js` | 8 | Not determined. |
| `scripts/fetch-traffic-axes.mjs` | 7 | Not determined. |
| `src/events.js` | 6 | Not determined. |
| `scripts/pack-buildings.mjs`, `scripts/city.mjs`, `scripts/city-lib.mjs`, `scripts/city-api.test.mjs` | 6 each | Not determined. |
| `src/models/kit.js` | 5 | Not determined. |
| `src/perf-classes.js` | 4 | Not determined. |
| `scripts/events.test.mjs` | 4 | Not determined. |
| `src/panorama.js`, `src/back-to-globe.js`, `scripts/fetch-ms-buildings.mjs` | 2 each | Not determined. |

## Not Yet Ported From Braga

Files only in Braga (55). 32 of them are Braga landmark builders in `src/models/` (arco, avenida, biscainhos, bomjesus, ...); they are Braga content, not engine gaps. The others, by feature (feature names from `braga-3d/src/EGM.md` and `scripts/EGM.md`):

- Walk mode: `src/walk.js`, `src/walk-collide.js`, `src/walk-figure.js`, `scripts/check-walk.mjs`, `scripts/walk-collide.test.mjs`.
- Game: `src/game.js`, `src/game-audio.js`, `src/game-hud.js`, `src/game-progress.js`, `src/game-vfx.js`.
- Discovery (daily place, news headlines): `src/discovery.js`, `src/discovery-state.js`, `scripts/check-discovery.mjs`.
- News API: `api/news.js` (feed `ominho.pt`; Braga only).
- Placeholder data: `src/placeholder-data.js`.
- Per-city locale files: `src/locales/en.js`, `src/locales/pt.js` (the fork uses `en.porto.js`, `pt.porto.js`).
- Browser check snippets: `scripts/check-interface.browser.js`, `scripts/check-route-mobile.browser.js`.
- Braga contract files: `src/EGM.md`, `src/locales/EGM.md`, `src/models/EGM.md`, `scripts/EGM.md`, `api/EGM.md`.
- Braga-only Guimarães registry: `src/models/index.guimaraes.js`.

Shared files where Braga is clearly ahead: all 91 changed files carry unported engine work, because the fork last synced at `1784ff3`. Clear cases from diff heads: `src/main.js` (Braga has the perf governor wiring `initPerf`, `showNotice`, `modeToClass`, and `seekWater`/`resumeWater`), `src/life.js` and `src/people.js` (Braga headers list funicular, traffic and crowd features the fork's headers lack), `vite.config.js` (`knownCities`, `localNews`). Layers panel and loading pill are already ported (`src/layers.js`, `src/load-status.js` are identical; porto-029).

## Identical To Braga

24 files: scripts/add-populo-square.mjs scripts/back-to-globe.test.mjs scripts/check-dimensions.mjs scripts/dmaria-parts.mjs scripts/fetch-buildings.mjs scripts/fetch-funicular.mjs scripts/fetch-pois.mjs scripts/fetch-terrain.mjs scripts/geo-lib.mjs scripts/stash-pending.mjs src/bounds.js src/gallery.js src/geo.js src/governor.js src/intro.js src/layers.js src/load-status.js src/models/drape.js src/models/geom.js src/models/metric.js src/models/parts.js src/quest-tasks.js src/routes.js src/video.js

## Invariants

From `AGENTS.md`:
- Node 22 (`.nvmrc`, `engines`). Plain ES modules, no framework.
- Never hand-edit generated geodata in `data/*.json`; regenerate with the pipeline.
- Do not weaken `scripts/verify.mjs` or a check to make a feature pass.
- Landmark models are authored in metres on real OSM footprints.
- Photos must be free-licensed; `check:data` rejects NC and ND.
- Never commit `data/.cache/`, `dist/` or `node_modules/`.
- `check:fit` hard-fails on deviation above 15 % and on never-shrink (model below 97 % of the OSM extent or of `dimensions.json` `height_m.total`).
- `check:models` triangle budget: 4k to 40k per model, at most 900k total.
- Data files load only through `assetUrl` (`?v=` content hash); never fetch `data/` directly.
- Pipeline step `ms-buildings` runs after `tiles`.
- Run `node scripts/bake-fits.mjs` after a change to a landmark builder, `fit.js`, terrain, footprints or dimensions.
- A new builder joins a group in `src/models/groups/` and `loader.js`.
- Class P (potato) runs the lite scene; keep anything the full scene adds out of `src/lite/`.
- Generated files `src/locales/en.porto.js` and `pt.porto.js` are not edited by hand [src/locales/en.porto.js header].

## Side Effects

Differs from Braga:
- Hosts and redirects: `porto-3d.com` (`www` and `porto-3d.vercel.app` redirect to it) [vercel.json]. Braga redirects to `braga-3d.com`. The fork also links `https://portugal-3d.com` (found in `src/` or `api/`; purpose not determined). AGENTS and `claude-progress.md` record `porto-012`: domain does not answer yet.
- localStorage keys: `porto-fx`, `porto-time`, `porto-language`, `porto-quests-<city>`. sessionStorage: `porto-intro`. Braga uses `braga-*` and also `braga-game-help`.
- Service worker caches: `porto-v2`, `porto-data-v2`, `porto-photos-v2` [public/sw.js]. Braga: `braga-v3`.
- Network hosts found in the fork's `src/` and `api/`: adsb.im, api.adsb.lol, api.adsbdb.com, api.anthropic.com, api.open-meteo.com, api.tomtom.com, globe.adsb.lol, i.ytimg.com, opendata.adsb.fi, opensky-network.org, vrs-standing-data.adsb.lol, www.google.com, www.youtube-nocookie.com. Braga's host list was not diffed; the news feed `ominho.pt` is Braga only (`api/news.js`).
- Data paths: flat `data/` plus fork-only `data/coast.json`, `data/quays.json`, `data/trees.json`, `data/terrain-fine.bin.gz`, `data/fits.json`, `data/new/*` (merged by `merge-content.mjs`), `data/.cache/` (gitignored). GTFS from `dadosabertos.cm-porto.pt` (STCP and Metro do Porto) [cities/porto.json:transit].
- Build: `prebuild` runs `bake-fits.mjs --if-stale`, which writes `data/fits.json` when its input hash changes [package.json:prebuild; AGENTS.md].

## Verification

From `package.json` scripts:

```
npm run dev
npm run build            # prebuild: node scripts/bake-fits.mjs --if-stale
npm run preview
npm run verify           # node scripts/verify.mjs, the gate
npm test                 # node --test scripts/*.test.mjs
npm run perf             # node scripts/perf-bench.mjs --reduced --check
npm run perf:full
npm run perf:serve
npm run bake:fits
npm run check:fits
npm run pack:buildings
npm run check:data
npm run check:geo
npm run check:coast
npm run fetch:coast
npm run check:dimensions
npm run check:fit
npm run check:traffic
npm run check:models
npm run count-tris
npm run city
```

Last recorded result: `npm run verify` OK, 17 passed (2026-11-20, `claude-progress.md`); unit tests 67/67. These were not re-run for this contract.

Upstream contract: `/Users/timur_isachenko/Dev/braga-3d/EGM.md`
