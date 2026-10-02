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

Landmarks, routes, dimensions, story, photos and GTFS metadata are authored in
later rounds (see `PLAN.md`); until then the map draws the terrain and city
fabric it has.

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

Skeleton complete: engine forked, Porto config and shell in place, build green,
data pipeline running. Landmark models currently use a generic OSM massing
builder until the detailed 1:1 builders land. See `PLAN.md`.
