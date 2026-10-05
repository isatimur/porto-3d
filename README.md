# Porto 3D

An interactive browser 3D map of Porto, Portugal: real terrain, the Douro and
its six bridges, a glowing street network, tens of thousands of buildings,
forests, gardens and river, and procedural 1:1 landmark models — the Sé,
Clérigos, São Bento, the Palácio da Bolsa, the Ribeira and more. Golden-hour
default with time-of-day, weather, seasons, live mode, a cinema tour, story
mode, routes and a guide. Portuguese, English and Russian UI.

Engine shared with [Braga 3D](https://braga-3d.com) and `guimaraes-3d`. This
repository is a single-city fork: everything place-specific comes from
`cities/porto.json` and `data/`.

## Stack

- Vite + three.js, plain ES modules, no framework.
- Node 22 for the data pipeline (no runtime dependencies).
- Deployed on Vercel (one project per city).

## Build

```
npm install
npm run dev          # http://localhost:5173 (city: porto)
npm run build        # copies data/, assets/ and cities/ into dist/
npm run preview
```

`vite.config.js` serves `/data`, `/assets` and `/cities` from the project root
in dev and copies them into `dist/` on build. The city is resolved in
`src/city.js` (`?city=porto` → `VITE_CITY` → hostname → `porto`).

## Data pipeline

Everything geographic is built from OpenStreetMap, Microsoft Global ML Building
Footprints, EU-DEM 25 m terrain and Open-Meteo. Raw replies are cached in
`data/.cache/` (gitignored). The pipeline is resumable.

```
node scripts/city.mjs porto --dry-run          # print the plan
node scripts/city.mjs porto                    # terrain, buildings, ms-buildings,
                                               # roads, nature, tiles, traffic-axes, gtfs
node scripts/city.mjs porto --from tiles       # resume at a step
node scripts/city.mjs porto --only ms-buildings
node scripts/check-geo.mjs --city porto
```

Grids: the core bbox is `41.12–41.19 × −8.68…−8.55`; the 1 km tile grid is
26 × 26 (11 × 8 core) plus the wide ring. `scripts/city-lib.mjs` derives the
tile grid, terrain lattice and projection from `cities/porto.json`.

Landmarks, routes, dimensions, story, photos and GTFS metadata are authored
and checked in: `data/landmarks.json` (70 places), `data/dimensions.json`,
`data/routes.json` (9 routes), `data/story.json` (18 chapters),
`data/gtfs/schedule.json` and `assets/img/`.

## Project layout

```
src/            the three.js engine; models/porto/ is Porto's landmark builders
scripts/        data pipeline and checks (every script takes --city porto)
api/            Vercel functions: live aircraft, route lookup, AI guide
cities/         porto.json — every place-specific constant
data/           generated geodata (terrain, roads, buildings, tiles, ...)
assets/img/     landmark photos
public/         PWA manifest, service worker, icons, share pages
index.html      static shell (crawlers + first paint)
PLAN.md         the project plan and remaining rounds
```

## Status

Live at https://porto-3d.vercel.app (Vercel project `porto-3d`, repo
`isatimur/porto-3d`). `npm run verify` runs 11 checks, including a headless
`smoke console` gate that fails on console errors, GL errors and inconsistent
geometry buffers (it skips when no Chromium is available).

Shipped:

- 70 landmarks, each with its own hand-authored 1:1 builder in
  `src/models/porto/`. No massing fallback remains.
- `check:fit` enforces two rules: a 15 % deviation fail and a never-shrink
  rule (model at least 97 % of the OSM extent and of the `dimensions.json`
  height).
- EN, PT and RU text for all landmarks and the UI.
- 9 routes, an 18-chapter story, a cinema tour.
- Live transit (trams, rabelo boats, trains), traffic, streamed ring tiles.
- An adaptive performance governor in `src/main.js`.
- SEO: a sitemap with 71 URLs and a `/p/<id>/` page per landmark with JSON-LD.
- PWA (`public/sw.js`, manifest) and serverless API routes in `api/`
  (guide, adsb, route).

Open: the `porto-3d.com` domain does not answer yet; 10 newer landmarks lack an
image in `public/og/`; quay walls and building geometry LOD are not built; the
engine sync with braga-3d has not run since the fork. See `feature_list.json`.
