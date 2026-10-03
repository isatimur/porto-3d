// Porto's transit vehicles at their scheduled positions.
//
//   - data: data/gtfs/schedule.json, built by scripts/fetch-gtfs.mjs from the
//     STCP and Metro do Porto static GTFS feeds (dadosabertos.cm-porto.pt,
//     CCZero): every route, its shapes and every trip's stop times, grouped
//     into patterns. Loaded at run time the first time live mode turns on,
//     not bundled;
//   - only in live mode («Сейчас в Порту»): the clock is the real Lisbon
//     time (or ?now=, running at 1x from that instant);
//   - every trip running now is placed on its shape between the two stops
//     it lies between, by its stop times. A short dwell is synthesised at
//     each intermediate stop (the feed stores departures only), so a vehicle
//     decelerates into a stop, holds, and leaves — and always faces the way
//     it is going. After midnight the previous service day's late trips
//     still run;
//   - a vehicle keeps its instance slot across the once-a-second reselect,
//     so nothing jumps when the nearest set changes: the shape cursor and
//     the drawn instance both follow the trip, not the ordering;
//   - metro routes (route_type 1) are drawn as articulated LRVs and, where
//     their shape crosses the Ponte de Dom Luís I, ride the real upper deck
//     (the landmark model's base + 60 m); elsewhere they follow the terrain.
//     STCP buses ride the right-hand lane and are biased toward the city's
//     main traffic axes (traffic-model.js) so the corridors keep their buses;
//   - metro stations (Trindade, São Bento, Bolhão, Aliados, Jardim do Morro,
//     Casa da Música, Campanhã, ...) are small lit markers, named on hover;
//   - at most 150 vehicles (80 on phones), the ones nearest the view first;
//     instanced, with the line's colour on the side stripe (from the feed
//     when it publishes colours: STCP and Metro do); lit windows at night;
//     buses drawn 1.3x life size so a 12 m bus reads on the map;
//   - hover (tap on phones): line, headsign and the next stop.
// Real time: neither operator publishes an open GTFS-Realtime feed here, so
// the vehicles run on the schedule. ?rtkey=KEY (or localStorage.transitRtKey)
// is kept as a hook for a future keyed feed: RT_URL below is null until one
// exists. Outside the feed's own calendar window the timetable is shown
// best-effort (the weekday masks it still carries) and flagged as stale,
// rather than left empty.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { t } from './i18n.js';
import { assetUrl } from './data.js';
import { CITY, dataPath } from './city.js';
import { createHoverLabel, esc } from './liveair.js';
import { lisbonClock, PRESET_HOUR, optInKey, decodeAxes, axisAt } from './traffic-model.js';

const MAX = 150;
const MOBILE_MAX = 80;
const RT_URL = null; // a GTFS-RT VehiclePositions URL, when an operator opens one
const BUS_SCALE = 1.3;
const BUS_LIFT = 0.13; // world units a bus sits above the sampled ground
const METRO_LIFT = 0.16; // world units the LRV wheels sit above deck / ground
const RESELECT_MS = 1000;
const LOAD_AFTER_MS = 2500;
const RETRY_MS = 60e3;
const CAND = 4000; // running trips kept per select (all are scored, max are drawn)
const AXIS_R = 15; // world units (60 m) of traffic-axis tolerance for buses
const STATION_M = 1700; // world units (6.8 km): only stations around the city
const BUS_DWELL = 15; // seconds held at a bus stop
const METRO_DWELL = 25; // seconds held at a metro station
// the Luís I deck blend (as src/life.js, data/life.json rail)
const RAIL_BLEND = 20; // world units (80 m) to ramp from the deck to the terrain
const RAIL_SPAN_W = 20; // world units (80 m) lateral tolerance of a bridge span
const LUIS_SITE = 'landmark-ponte-luis-i';
const LUIS_DECK_M = 60;
const LUIS_SPAN = [
  [41.13794, -8.60879],
  [41.14193, -8.61005],
];

function box(w, h, d, x, y, z, color, { stripe = 0, glow = 0 } = {}) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y + h / 2, z);
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  const col = new THREE.Color(color);
  for (let i = 0; i < n; i++) col.toArray(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aStripe', new THREE.BufferAttribute(new Float32Array(n).fill(stripe), 1));
  g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
  return g;
}

// a 12 m city bus in metres, +z forward
function busGeometry(S) {
  const g = mergeGeometries([
    box(2.3, 0.45, 11.4, 0, 0, 0, 0x1a1a1a),
    box(2.55, 2.55, 12, 0, 0.35, 0, 0xf1f0ea),
    box(2.6, 0.95, 11.2, 0, 1.55, 0.1, 0x2a3a46, { glow: 1 }), // windows
    box(2.62, 0.42, 11.9, 0, 0.95, 0, 0xffffff, { stripe: 1 }), // the line colour
    box(2.4, 0.22, 7, 0, 2.9, -1.5, 0xd8d8d2),
    box(2.3, 0.5, 0.1, 0, 2.3, 6.0, 0xffb347, { glow: 1.4 }), // destination display
  ]);
  const k = BUS_SCALE * S;
  g.scale(k, k, k);
  return g;
}

// Metro do Porto LRV: a silver-white articulated three-section car with a lit
// window band and the line's colour on the side stripe; +z is the front.
function metroGeometry(S) {
  const W = 2.65;
  const SL = 10.6;
  const L = SL * 3;
  const z0 = -L / 2;
  const parts = [];
  for (let c = 0; c < 3; c++) {
    const zc = z0 + SL * (c + 0.5);
    parts.push(box(W, 0.55, SL, 0, 0.25, zc, 0x2a2d30)); // skirt / bogies
    parts.push(box(W + 0.04, 1.55, SL - 0.3, 0, 0.8, zc, 0xe4e7e9)); // silver body
    parts.push(box(W + 0.1, 0.72, SL - 1.7, 0, 1.28, zc, 0x1f2a30, { glow: 1 })); // windows
    parts.push(box(W + 0.11, 0.18, SL - 0.6, 0, 0.86, zc, 0xffffff, { stripe: 1 })); // the line colour
    parts.push(box(W - 0.3, 0.22, SL - 0.7, 0, 2.42, zc, 0x9aa0a4)); // roof
  }
  parts.push(box(W, 1.9, 0.55, 0, 0.7, L / 2 - 0.28, 0xf9c212)); // front cab
  parts.push(box(W - 0.5, 0.95, 0.16, 0, 1.35, L / 2 + 0.02, 0x1f2a30, { glow: 1 })); // windscreen
  parts.push(box(W - 0.9, 0.3, 0.1, 0, 1.95, L / 2 + 0.05, 0x14120f)); // destination plate
  parts.push(box(0.22, 0.22, 0.1, -0.85, 0.85, L / 2 + 0.07, 0xffe9b0, { glow: 1.4 }));
  parts.push(box(0.22, 0.22, 0.1, 0.85, 0.85, L / 2 + 0.07, 0xffe9b0, { glow: 1.4 }));
  parts.push(box(0.1, 0.95, 0.1, 0, 2.55, -1.5, 0x3a3f42)); // pantograph
  parts.push(box(1.5, 0.08, 0.08, 0, 3.5, -1.5, 0x3a3f42));
  const g = mergeGeometries(parts);
  g.userData.lengthM = L;
  g.scale(S, S, S);
  return g;
}

function busMaterial(uni) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1 });
  mat.customProgramCacheKey = () => 'live-bus';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBusNight = uni.uBusNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aStripe;\nattribute float aGlow;\nattribute vec3 iRoute;\nvarying float vBusGlow;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb = mix(vColor.rgb, iRoute, aStripe);\nvBusGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uBusNight;\nvarying float vBusGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.82, 0.55) * vBusGlow * uBusNight * 1.2;');
  };
  return mat;
}

// A metro station marker: a short post under an octagonal cap, vertex-coloured
// so the cap can carry the metro blue; the material's emissive lights it.
function paint(geo, color) {
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  const col = new THREE.Color(color);
  for (let i = 0; i < n; i++) col.toArray(c, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

function stationGeometry(S) {
  const post = paint(new THREE.CylinderGeometry(0.16, 0.16, 3.2, 6).toNonIndexed(), 0x2a3f55);
  post.translate(0, 1.6, 0);
  post.deleteAttribute('uv');
  const cap = paint(new THREE.CylinderGeometry(1.05, 1.05, 0.5, 8).toNonIndexed(), 0x1f7ec2);
  cap.translate(0, 3.45, 0);
  cap.deleteAttribute('uv');
  const g = mergeGeometries([post, cap]);
  g.scale(S, S, S);
  return g;
}

function iRouteAttr(max) {
  return new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
}

// one departure offset per stop (Int32Array) -> one arrival offset per stop:
// a stop is reached `dwell` before it is left, so `locate` can hold there.
function arrivals(o, metro) {
  const n = o.length;
  const a = new Float32Array(n);
  a[0] = o[0];
  const target = metro ? METRO_DWELL : BUS_DWELL;
  for (let k = 1; k < n; k++) {
    const gap = o[k] - o[k - 1];
    const dw = Math.min(target, Math.max(1, gap * 0.6));
    a[k] = o[k] - dw;
    if (a[k] < a[k - 1] + 1) a[k] = Math.min(o[k], a[k - 1] + 1);
  }
  return a;
}

export function createLiveBus({ scene, camera, renderer, project, heightAt, mobile = false, reducedMotion = false, live, atmosphere, group }) {
  const S = 1 / 4;
  const max = mobile ? MOBILE_MAX : MAX;
  const uni = { uBusNight: { value: 0 } };
  const mat = busMaterial(uni);
  const busI = iRouteAttr(max);
  const metroI = iRouteAttr(max);
  const busGeo = busGeometry(S);
  busGeo.setAttribute('iRoute', busI);
  const metroGeo = metroGeometry(S);
  metroGeo.setAttribute('iRoute', metroI);

  const busMesh = new THREE.InstancedMesh(busGeo, mat, max);
  busMesh.name = 'live-buses';
  busMesh.count = 0;
  busMesh.frustumCulled = false;
  busMesh.castShadow = false;
  busMesh.receiveShadow = true;
  busMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const metroMesh = new THREE.InstancedMesh(metroGeo, mat, max);
  metroMesh.name = 'live-metro';
  metroMesh.count = 0;
  metroMesh.frustumCulled = false;
  metroMesh.castShadow = false;
  metroMesh.receiveShadow = true;
  metroMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const stationCap = 240; // more than every metro stop within STATION_M
  const stationMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1, emissive: 0x1f7ec2, emissiveIntensity: 0 });
  const stationMesh = new THREE.InstancedMesh(stationGeometry(S), stationMat, stationCap);
  stationMesh.name = 'metro-stations';
  stationMesh.count = 0;
  stationMesh.castShadow = false;
  stationMesh.receiveShadow = false;
  stationMesh.frustumCulled = false; // gated by camera distance instead

  const root = new THREE.Group();
  root.name = 'live-transit';
  root.visible = false;
  root.add(busMesh, metroMesh, stationMesh);
  (group || scene).add(root);

  let data = null; // the prepared schedule
  let status = 'waiting';
  let loadAt = performance.now() + LOAD_AFTER_MS;
  let retryAt = 0;
  const rtKey = optInKey('rtkey', 'transitRtKey');
  if (rtKey) console.info(`[porto] transit real-time: key stored, but no operator publishes an open GTFS-Realtime feed yet${RT_URL ? '' : ' (RT_URL is null)'}; the buses run on the schedule`);

  // station positions, reused by the marker mesh and its hover label
  let nStations = 0;
  let staX = new Float32Array(0);
  let staY = new Float32Array(0);
  let staZ = new Float32Array(0);
  let staName = [];

  async function load() {
    status = 'loading';
    retryAt = 0;
    try {
      const r = await fetch(assetUrl(dataPath('gtfs/schedule.json')));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (!(r.headers.get('content-type') || '').includes('json')) throw new Error('not JSON');
      prepare(await r.json());
      status = 'ok';
    } catch (e) {
      status = `unavailable: ${e.message}`;
      retryAt = performance.now() + RETRY_MS;
      console.info(`[porto] transit schedule unavailable (${e.message}); no buses (retry in ${RETRY_MS / 1000} s)`);
    }
  }

  // ---- terrain, at deck height on the Luís I for metro shapes
  function luisDeck() {
    try {
      const mesh = scene.getObjectByName(LUIS_SITE);
      if (!mesh?.geometry?.attributes?.position) return null;
      mesh.geometry.computeBoundingBox?.();
      const bb = mesh.geometry.boundingBox;
      if (!bb) return null;
      const span = LUIS_SPAN.map((q) => project(q[0], q[1]));
      return {
        y: mesh.position.y + LUIS_DECK_M * S,
        minX: mesh.position.x + bb.min.x,
        maxX: mesh.position.x + bb.max.x,
        minZ: mesh.position.z + bb.min.z,
        maxZ: mesh.position.z + bb.max.z,
        span,
      };
    } catch {
      return null;
    }
  }

  function smooth(raw) {
    const n = raw.length;
    const out = new Float32Array(n);
    const w = [];
    for (let i = 0; i < n; i++) {
      w.length = 0;
      for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) w.push(raw[k]);
      w.sort((a, b) => a - b);
      out[i] = w[w.length >> 1];
    }
    return out;
  }

  // how much a world point is over the Luís I deck, 0..1 (the bridge model's
  // box, ramped at the ends, plus the OSM span for the viaduct past the box)
  function deckWeight(deck, x, z) {
    const dBox = Math.max(0, deck.minX - x, x - deck.maxX, deck.minZ - z, z - deck.maxZ);
    let w = dBox <= 0 ? 1 : Math.max(0, 1 - dBox / RAIL_BLEND);
    if (deck.span && w < 1) {
      const [a, b] = deck.span;
      const vx = b.x - a.x;
      const vz = b.z - a.z;
      const l2 = vx * vx + vz * vz;
      if (l2 > 1e-6) {
        const tp = ((x - a.x) * vx + (z - a.z) * vz) / l2;
        const tc = Math.max(0, Math.min(1, tp));
        const along = tp < 0 ? -tp * Math.sqrt(l2) : tp > 1 ? (tp - 1) * Math.sqrt(l2) : 0;
        const lat = Math.max(0, Math.hypot(x - (a.x + tc * vx), z - (a.z + tc * vz)) - RAIL_SPAN_W);
        const dd = Math.hypot(along, lat);
        const ws = dd <= 0 ? 1 : Math.max(0, 1 - dd / RAIL_BLEND);
        if (ws > w) w = ws;
      }
    }
    return w;
  }

  function buildStations(patterns, routes, stops) {
    const seen = new Set();
    const out = [];
    const r2 = STATION_M * STATION_M;
    for (const P of patterns) {
      if (!routes[P.r].metro) continue;
      for (const si of P.st) {
        const s = stops[si];
        const name = String(s?.[2] || '').trim();
        if (!name) continue;
        const p = project(s[0], s[1]);
        if (p.x * p.x + p.z * p.z > r2) continue;
        const key = `${name.toLowerCase()}@${Math.round(p.x / 8)},${Math.round(p.z / 8)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ name, x: p.x, z: p.z, y: heightAt(p.x, p.z) });
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  function prepare(j) {
    const LANE = 1.6 * S; // drive on the right
    const routes = j.routes.map((r) => ({ ...r, rgb: new THREE.Color(r.color), metro: r.type === 1 }));
    const deck = luisDeck();
    const shapes = j.shapes.map((f) => {
      const n = f.length / 2;
      const X = new Float32Array(n);
      const Z = new Float32Array(n);
      const C = new Float32Array(n);
      const raw = new Float32Array(n);
      let la = 0;
      let lo = 0;
      for (let i = 0; i < n; i++) {
        la += f[i * 2];
        lo += f[i * 2 + 1];
        const p = project(la / 1e5, lo / 1e5);
        X[i] = p.x;
        Z[i] = p.z;
        raw[i] = heightAt(p.x, p.z);
        if (i) C[i] = C[i - 1] + Math.hypot(X[i] - X[i - 1], Z[i] - Z[i - 1]);
      }
      return { X, Z, C, Y: smooth(raw), n };
    });
    const patterns = j.patterns.map((p) => {
      const metro = !!routes[p.r].metro;
      const o = Int32Array.from(p.o);
      return {
        r: p.r,
        sh: p.sh,
        h: p.h,
        st: Int32Array.from(p.st),
        d: Float32Array.from(p.d, (m) => m * S),
        o,
        a: arrivals(o, metro),
        dur: o[o.length - 1],
        start: Int32Array.from(p.trips, (q) => q[0]),
        svc: Int16Array.from(p.trips, (q) => q[1]),
        metro,
      };
    });
    // axis decode is cheap; the traffic axes are loaded before the live layer
    let axes = null;
    try {
      axes = decodeAxes(project);
    } catch {
      axes = null;
    }
    const stations = buildStations(patterns, routes, j.stops);
    nStations = stations.length;
    staX = new Float32Array(nStations);
    staY = new Float32Array(nStations);
    staZ = new Float32Array(nStations);
    staName = stations.map((s) => s.name);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pv = new THREE.Vector3();
    const sv = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < nStations; i++) {
      staX[i] = stations[i].x;
      staY[i] = stations[i].y + 0.1;
      staZ[i] = stations[i].z;
      m.compose(pv.set(staX[i], staY[i], staZ[i]), q, sv);
      stationMesh.setMatrixAt(i, m);
    }
    stationMesh.count = nStations;
    stationMesh.computeBoundingSphere?.();
    stationMesh.instanceMatrix.needsUpdate = true;
    stationLabel.refresh();

    const ymd = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? +String(s).replace(/-/g, '') : 0);
    data = {
      shapes,
      routes,
      days: j.services.map((s) => s.days),
      patterns,
      stops: j.stops,
      LANE,
      trips: patterns.reduce((s, p) => s + p.start.length, 0),
      valid: j.valid,
      // the feed's calendar window; 0 means "not declared"
      validFrom: ymd(j.valid?.from),
      validTo: ymd(j.valid?.to),
      axes,
      stations,
      deck,
    };
  }

  // ---- the clock
  const clock = { hour: 0, secs: 0, weekday: 0, ymd: 0 };
  let baseSecs = 0;
  let basePerf = 0;
  let baseMode = '';
  let lastClock = -Infinity;
  function simSecs(tNow) {
    const isLive = !!live?.live;
    const mode = isLive ? 'live' : `preset:${atmosphere?.time}`;
    if (mode !== baseMode || (isLive && tNow - lastClock > 1000)) {
      lisbonClock(live?.now ? live.now() : new Date(), clock);
      baseSecs = isLive ? clock.secs : (PRESET_HOUR[atmosphere?.time] ?? 19) * 3600;
      basePerf = tNow;
      baseMode = mode;
      lastClock = tNow;
    }
    return baseSecs + (tNow - basePerf) / 1000;
  }
  let frozenT = null;

  // ---- selection (once a second): running trips, nearest the view, with a
  // stable instance slot per trip so nothing jumps between reselects
  const cP = new Int32Array(CAND); // pattern
  const cT = new Int32Array(CAND); // trip
  const cOff = new Int32Array(CAND); // 0 today, 86400 a late trip of yesterday
  const cD = new Float32Array(CAND); // distance to the view, squared
  const cX = new Float32Array(CAND); // world position, for the axis test
  const cZ = new Float32Array(CAND);
  const cKind = new Uint8Array(CAND); // 0 bus, 1 metro
  const cOrd = new Int32Array(CAND);
  let nCand = 0;
  let stale = false;
  const sP = new Int32Array(max);
  const sT = new Int32Array(max);
  const sOff = new Int32Array(max);
  const sKind = new Uint8Array(max);
  const sDraw = new Int32Array(max);
  const sK = new Int32Array(max); // stop cursor
  const sG = new Int32Array(max); // shape cursor
  const sX = new Float32Array(max);
  const sY = new Float32Array(max);
  const sZ = new Float32Array(max);
  const sNext = new Int32Array(max); // next stop index
  const usedBus = new Uint8Array(max);
  const usedMetro = new Uint8Array(max);
  const keep = new Map(); // trip key -> [kind, draw]
  let nSel = 0;
  let nBus = 0;
  let nMetro = 0;
  let running = 0;
  let lastSelect = -Infinity;
  const keyOf = (p, q) => p * 8192 + q;
  const pos = { x: 0, z: 0, y: 0, hx: 0, hz: 1, next: 0 };

  // where trip (pattern p) is, `rel` seconds after its start; the stop cursor
  // k and shape cursor g are hints, updated in place through `cur`
  const cur = { k: 0, g: 1 };
  function locate(p, rel) {
    const P = data.patterns[p];
    const o = P.o;
    const a = P.a;
    const D = P.d;
    const n = o.length;
    let k = Math.min(Math.max(cur.k, 0), n - 2);
    while (k < n - 2 && o[k + 1] <= rel) k++;
    while (k > 0 && o[k] > rel) k--;
    cur.k = k;
    let dist;
    if (rel <= a[0]) dist = D[0];
    else {
      const t0 = o[k];
      const t1 = a[k + 1];
      if (t1 > t0 && rel < t1) dist = D[k] + (D[k + 1] - D[k]) * ((rel - t0) / (t1 - t0));
      else dist = D[k + 1];
    }
    const sh = data.shapes[P.sh];
    const C = sh.C;
    let g = Math.min(Math.max(cur.g, 1), sh.n - 1);
    while (g < sh.n - 1 && C[g] < dist) g++;
    while (g > 1 && C[g - 1] > dist) g--;
    cur.g = g;
    const seg = Math.max(1e-6, C[g] - C[g - 1]);
    const w = Math.min(1, Math.max(0, (dist - C[g - 1]) / seg));
    const lane = P.metro ? 0 : data.LANE;
    const hx = (sh.X[g] - sh.X[g - 1]) / seg;
    const hz = (sh.Z[g] - sh.Z[g - 1]) / seg;
    pos.x = sh.X[g - 1] + (sh.X[g] - sh.X[g - 1]) * w - hz * lane;
    pos.z = sh.Z[g - 1] + (sh.Z[g] - sh.Z[g - 1]) * w + hx * lane;
    pos.y = sh.Y[g - 1] + (sh.Y[g] - sh.Y[g - 1]) * w;
    // a metro shape is coarse where it crosses the Ponte de Dom Luís I: lift
    // the point onto the real upper deck by where it is, not by vertex
    if (P.metro && data.deck) {
      const dw = deckWeight(data.deck, pos.x, pos.z);
      if (dw > 0) pos.y += (data.deck.y - pos.y) * dw;
    }
    pos.hx = hx;
    pos.hz = hz;
    pos.next = P.st[Math.min(k + 1, P.st.length - 1)];
    return pos;
  }

  function select(T) {
    // outside the feed's own validity window the timetable is shown
    // best-effort and flagged stale, rather than left empty
    stale = !!((data.validFrom && clock.ymd < data.validFrom) || (data.validTo && clock.ymd > data.validTo));
    const today = clock.weekday;
    const yday = (today + 6) % 7;
    const focus = camera.userData.focus;
    const fx = focus ? focus.x : 0;
    const fz = focus ? focus.z : 0;
    nCand = 0;
    running = 0;
    const pats = data.patterns;
    const axes = data.axes;
    const hasAxes = !!(axes && axes.ids.length);
    for (let p = 0; p < pats.length; p++) {
      const P = pats[p];
      const n = P.start.length;
      const metro = P.metro;
      for (let q = 0; q < n; q++) {
        const dayMask = data.days[P.svc[q]];
        let off = -1;
        const rel = T - P.start[q];
        if (rel >= 0 && rel <= P.dur && dayMask[today] === '1') off = 0;
        else if (T + 86400 - P.start[q] <= P.dur && T + 86400 - P.start[q] >= 0 && dayMask[yday] === '1') off = 86400;
        if (off < 0) continue;
        running++;
        if (nCand >= CAND) continue;
        cur.k = 0;
        cur.g = 1;
        const at = locate(p, T + off - P.start[q]);
        cP[nCand] = p;
        cT[nCand] = q;
        cOff[nCand] = off;
        cKind[nCand] = metro ? 1 : 0;
        cX[nCand] = at.x;
        cZ[nCand] = at.z;
        cD[nCand] = (at.x - fx) ** 2 + (at.z - fz) ** 2;
        cOrd[nCand] = nCand;
        nCand++;
      }
    }
    // nearest first (typed-array sort on a view: no garbage worth counting)
    const ord = cOrd.subarray(0, nCand);
    ord.sort((a, b) => cD[a] - cD[b]);
    // buses on a main traffic axis (and any metro) win ties, so the corridors
    // keep their service; the view still dominates. Only the near prefix is
    // scored: nothing past it can be drawn.
    if (nCand) {
      const lim = Math.min(nCand, max * 3);
      for (let k = 0; k < lim; k++) {
        const c = ord[k];
        if (cKind[c]) cD[c] *= 0.6;
        else if (hasAxes && axisAt(axes, cX[c], cZ[c], AXIS_R)) cD[c] *= 0.5;
      }
      if (lim > 1) ord.subarray(0, lim).sort((a, b) => cD[a] - cD[b]);
    }
    keep.clear();
    for (let i = 0; i < nSel; i++) keep.set(keyOf(sP[i], sT[i]), [sKind[i], sDraw[i]]);
    usedBus.fill(0);
    usedMetro.fill(0);
    nSel = 0;
    nBus = 0;
    nMetro = 0;
    let maxBus = -1;
    let maxMetro = -1;
    for (let i = 0; i < nCand && nSel < max; i++) {
      const c = ord[i];
      const p = cP[c];
      const q = cT[c];
      const kind = cKind[c];
      const used = kind ? usedMetro : usedBus;
      const prev = keep.get(keyOf(p, q));
      let draw = -1;
      if (prev && prev[0] === kind && !used[prev[1]]) draw = prev[1];
      if (draw < 0) draw = used.indexOf(0);
      if (draw < 0) continue;
      used[draw] = 1;
      sP[nSel] = p;
      sT[nSel] = q;
      sOff[nSel] = cOff[c];
      sKind[nSel] = kind;
      sDraw[nSel] = draw;
      const rgb = data.routes[data.patterns[p].r].rgb;
      rgb.toArray((kind ? metroI : busI).array, draw * 3);
      if (kind) {
        nMetro++;
        if (draw > maxMetro) maxMetro = draw;
      } else {
        nBus++;
        if (draw > maxBus) maxBus = draw;
      }
      nSel++;
    }
    busI.needsUpdate = true;
    metroI.needsUpdate = true;
    blank(busMesh, usedBus, maxBus);
    blank(metroMesh, usedMetro, maxMetro);
  }

  // zero the scale of any instance slot left free, so a dropped trip cannot
  // leave a ghost at its old matrix
  function blank(mesh, used, maxDraw) {
    const e = mesh.instanceMatrix.array;
    for (let d = 0; d <= maxDraw; d++) {
      if (used[d]) continue;
      const o = d * 16;
      for (let j = 0; j < 16; j++) e[o + j] = 0;
      e[o + 15] = 0;
    }
    mesh.count = maxDraw + 1;
    if (maxDraw >= 0) mesh.instanceMatrix.needsUpdate = true;
  }

  // ---- per frame
  let shown = false;
  let visible = false;
  let lastCam = 0;
  function update(adt, dt, view) {
    const tNow = performance.now();
    // only in live mode («Сейчас в Порту»); the schedule loads on the first switch-on
    if (!live?.live) {
      if (shown) {
        shown = false;
        root.visible = false;
        busMesh.visible = false;
        metroMesh.visible = false;
        stationMesh.visible = false;
        busMesh.count = 0;
        metroMesh.count = 0;
        nSel = 0;
        running = 0;
        visible = false;
        baseMode = '';
        lastSelect = -Infinity;
        frozenT = null;
        label.hide();
        stationLabel.hide();
      }
      return;
    }
    shown = true;
    root.visible = true;
    if (!data) {
      if ((status === 'waiting' && tNow > loadAt) || (retryAt && tNow > retryAt)) load();
      return;
    }
    // reduced motion: the simulated clock does not advance, so the selection
    // recomputes to the same still frame every second
    const T = reducedMotion ? (frozenT ??= simSecs(tNow)) : simSecs(tNow);
    if (tNow - lastSelect > RESELECT_MS) {
      lastSelect = tNow;
      select(T);
    }
    uni.uBusNight.value = atmosphere?.night ?? 0;
    stationMat.emissiveIntensity = (atmosphere?.night ?? 0) * 0.7;
    lastCam = view?.camDist ?? 0;
    stationMesh.visible = nStations > 0 && lastCam < 2600;
    const any = nSel > 0 && lastCam < 3200;
    busMesh.visible = any && nBus > 0;
    metroMesh.visible = any && nMetro > 0;
    visible = any;
    for (let i = 0; i < nSel; i++) {
      const P = data.patterns[sP[i]];
      cur.k = sK[i];
      cur.g = sG[i];
      const at = locate(sP[i], T + sOff[i] - P.start[sT[i]]);
      sK[i] = cur.k;
      sG[i] = cur.g;
      sX[i] = at.x;
      sZ[i] = at.z;
      sNext[i] = at.next;
      const kind = sKind[i];
      const mesh = kind ? metroMesh : busMesh;
      const o = sDraw[i] * 16;
      const e = mesh.instanceMatrix.array;
      e[o] = at.hz;
      e[o + 1] = 0;
      e[o + 2] = -at.hx;
      e[o + 3] = 0;
      e[o + 4] = 0;
      e[o + 5] = 1;
      e[o + 6] = 0;
      e[o + 7] = 0;
      e[o + 8] = at.hx;
      e[o + 9] = 0;
      e[o + 10] = at.hz;
      e[o + 11] = 0;
      e[o + 12] = at.x;
      e[o + 13] = at.y + (kind ? METRO_LIFT : BUS_LIFT);
      e[o + 14] = at.z;
      e[o + 15] = 1;
      sY[i] = at.y + (kind ? METRO_LIFT : BUS_LIFT);
    }
    if (nBus) busMesh.instanceMatrix.needsUpdate = true;
    if (nMetro) metroMesh.instanceMatrix.needsUpdate = true;
    label.update(tNow);
    stationLabel.update(tNow);
  }

  const label = createHoverLabel({
    canvas: renderer.domElement,
    camera,
    count: () => (visible ? nSel : 0),
    key: (i) => sP[i] * 8192 + sT[i],
    worldPos: (i, v) => {
      v.set(sX[i], sY[i] + 1.2, sZ[i]);
      return true;
    },
    text: (i) => {
      const P = data.patterns[sP[i]];
      const r = data.routes[P.r];
      const stop = data.stops[sNext[i]];
      return `<b style="color:${esc(r.color)}">${esc(r.short)}</b> ${esc(P.h)} <span class="dim">· ${t('след.:')} ${esc(stop?.[2] ?? '')}</span>`;
    },
    px: 18,
    className: 'live-label-bus',
  });

  const stationLabel = createHoverLabel({
    canvas: renderer.domElement,
    camera,
    count: () => (stationMesh.visible ? nStations : 0),
    key: (i) => i,
    worldPos: (i, v) => {
      v.set(staX[i], staY[i], staZ[i]);
      return true;
    },
    text: (i) => `<b>M</b> ${esc(staName[i])}`,
    px: 14,
    className: 'live-label-station',
  });

  function badge() {
    if (!live?.live || !data) return null;
    const op = CITY.transit?.operator || 'GTFS';
    const state = t(RT_URL && rtKey ? 'в реальном времени' : 'по расписанию');
    const base = `${t('Автобусы {op}:').replace('{op}', op)} ${running} ${t('на линиях')} (${state})`;
    return stale ? `${base} · ${t('расписание устарело')}` : base;
  }

  return {
    update,
    badge,
    object: root,
    label,
    get status() {
      return status;
    },
    get running() {
      return running;
    },
    get drawn() {
      return nSel;
    },
    get buses() {
      return nBus;
    },
    get metro() {
      return nMetro;
    },
    get stale() {
      return stale;
    },
    get stats() {
      return data
        ? {
            routes: data.routes.length,
            patterns: data.patterns.length,
            trips: data.trips,
            valid: data.valid,
            stale,
            realtime: false,
            metroRoutes: data.routes.filter((r) => r.metro).length,
            stations: nStations,
            onDeck: !!data.deck,
          }
        : null;
    },
    loadNow() {
      loadAt = 0;
      retryAt = 0;
      if (status !== 'ok') return load();
      return Promise.resolve();
    },
    // tests: a drawn vehicle, and its label facts
    busAt(i) {
      if (!data || i >= nSel) return null;
      const P = data.patterns[sP[i]];
      return {
        x: sX[i],
        y: sY[i],
        z: sZ[i],
        line: data.routes[P.r].short,
        headsign: P.h,
        next: data.stops[sNext[i]]?.[2],
        kind: sKind[i] ? 'metro' : 'bus',
        metro: !!sKind[i],
      };
    },
    // tests: a metro station marker
    stationAt(i) {
      if (i >= nStations) return null;
      return { name: staName[i], x: staX[i], y: staY[i], z: staZ[i] };
    },
  };
}
