// The main traffic axes of a city -> <data dir>/traffic-axes.json
//
//   node scripts/fetch-traffic-axes.mjs [--city <id>]
//
// roads.json carries no street names, so src/traffic-model.js tags its lanes
// by distance to these OSM corridors. Braga: Avenida da Liberdade, the EN 101
// through the city, and the A 11 / Circular Sul (CSB) / EN 14 approaches.
// Polylines are simplified to 25 m and coded as integers:
// "lat,lon lat,lon;..." in 1e-4 degrees from the coding base `base`
// (cities/<id>.json traffic.axes_base; Braga: 41.5 N, -8.5 E). The base is
// written into the JSON as `base: [lat, lon]`.
//
// The matchers below are road names, so they are content per city
// (AXES_BY_CITY). A city without an entry gets `axes: {}` and no Overpass call.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { overpass, CITY, CORE_BBOX, dataPath } from './geo-lib.mjs';

const OUT = dataPath('traffic-axes.json');
const K = Math.cos((CITY.origin.lat * Math.PI) / 180);
const BASE = CITY.traffic?.axes_base || [41.5, -8.5];
const BB = CITY.traffic?.axes_bbox || CORE_BBOX;

function dp(pts, tol) {
  const xy = pts.map((p) => [p[1] * 111320 * K, p[0] * 110574]);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    let bi = -1;
    let bd = tol;
    const dx = xy[b][0] - xy[a][0];
    const dy = xy[b][1] - xy[a][1];
    const L = dx * dx + dy * dy || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const u = Math.max(0, Math.min(1, ((xy[i][0] - xy[a][0]) * dx + (xy[i][1] - xy[a][1]) * dy) / L));
      const d = Math.hypot(xy[i][0] - xy[a][0] - u * dx, xy[i][1] - xy[a][1] - u * dy);
      if (d > bd) {
        bd = d;
        bi = i;
      }
    }
    if (bi > 0) {
      keep[bi] = 1;
      st.push([a, bi], [bi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// Road-name matchers per city. Add an entry to give a city its axes.
const AXES_BY_CITY = {
  braga: {
    liberdade: (t) => t.name === 'Avenida da Liberdade' && /primary|secondary|tertiary/.test(t.highway),
    n101: (t) => /EN 101/.test(t.ref || ''),
    a11: (t) => /A 11|CSB|EN 14/.test(t.ref || '') || /Circular Sul de Braga/.test(t.name || ''),
  },
  porto: {
    aliados: (t) => /Avenida dos Aliados/.test(t.name || ''),
    boavista: (t) => /Boavista/.test(t.name || '') && /primary|secondary|tertiary/.test(t.highway),
    circunvalacao: (t) => /Circunvala/.test(t.name || '') || /VCI/.test(t.ref || ''),
    a1: (t) => /A 1|A 20|A 28|A 29|A 44/.test(t.ref || ''),
    ribeira: (t) => /(Ribeira|Cais)/.test(t.name || '') && /primary|secondary|tertiary/.test(t.highway),
  },
};
const AXES = AXES_BY_CITY[CITY.id];

const out = { source: 'OpenStreetMap (ODbL) via Overpass', built: new Date().toISOString().slice(0, 10), coding: `lat,lon in 1e-4 deg from ${BASE[0]},${BASE[1]}`, base: BASE, axes: {} };
if (!AXES) {
  console.log(`[axes] no axis matchers for ${CITY.id}; writing empty axes (add them to AXES_BY_CITY in scripts/fetch-traffic-axes.mjs)`);
} else {
  const els = await overpass(
    `[out:json][timeout:90];(way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${BB.s},${BB.w},${BB.n},${BB.e}););out tags geom;`,
    { label: 'axes' },
  );
  for (const [id, test] of Object.entries(AXES)) {
    const lines = els.filter((w) => w.tags && test(w.tags) && w.geometry?.length > 1).map((w) => dp(w.geometry.map((p) => [p.lat, p.lon]), 25));
    out.axes[id] = lines.map((l) => l.map((p) => `${Math.round((p[0] - BASE[0]) * 1e4)},${Math.round((p[1] - BASE[1]) * 1e4)}`).join(' ')).join(';');
    console.log(`[axes] ${id}: ${lines.length} ways, ${lines.reduce((s, l) => s + l.length, 0)} points`);
  }
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log(`[axes] -> ${OUT}`);
