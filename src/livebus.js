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
//     it lies between, by its stop times; after midnight the previous
//     service day's late trips still run;
//   - at most 150 vehicles, the ones nearest the view first; instanced, with
//     the line's colour on the side stripe (from the feed when it publishes
//     colours: STCP and Metro do); lit windows at night; drawn 1.3x life
//     size so a 12 m bus reads on the map;
//   - hover (tap on phones): line, headsign and the next stop.
// Real time: neither operator publishes an open GTFS-Realtime feed here, so
// the vehicles run on the schedule. ?rtkey=KEY (or localStorage.transitRtKey)
// is kept as a hook for a future keyed feed: RT_URL below is null until one
// exists.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { t } from './i18n.js';
import { assetUrl } from './data.js';
import { CITY, dataPath } from './city.js';
import { createHoverLabel, esc } from './liveair.js';
import { lisbonClock, PRESET_HOUR, optInKey } from './traffic-model.js';

const MAX = 150;
const RT_URL = null; // a GTFS-RT VehiclePositions URL, when an operator opens one
const BUS_SCALE = 1.3;
const RESELECT_MS = 1000;
const LOAD_AFTER_MS = 2500;

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

export function createLiveBus({ scene, camera, renderer, project, heightAt, mobile = false, live, atmosphere, group }) {
  const S = 1 / 4;
  const max = mobile ? 80 : MAX;
  const uni = { uBusNight: { value: 0 } };
  const geo = busGeometry(S);
  const iRoute = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iRoute', iRoute);
  const mesh = new THREE.InstancedMesh(geo, busMaterial(uni), max);
  mesh.name = 'live-buses';
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.visible = false;
  (group || scene).add(mesh);

  let data = null; // the prepared schedule
  let status = 'waiting';
  let loadAt = performance.now() + LOAD_AFTER_MS;
  const rtKey = optInKey('rtkey', 'transitRtKey');
  if (rtKey) console.info(`[porto] transit real-time: key stored, but no operator publishes an open GTFS-Realtime feed yet${RT_URL ? '' : ' (RT_URL is null)'}; the buses run on the schedule`);

  async function load() {
    status = 'loading';
    try {
      const r = await fetch(assetUrl(dataPath('gtfs/schedule.json')));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (!(r.headers.get('content-type') || '').includes('json')) throw new Error('not JSON');
      prepare(await r.json());
      status = 'ok';
    } catch (e) {
      status = `unavailable: ${e.message}`;
      console.info(`[porto] transit schedule unavailable (${e.message}); no buses`);
    }
  }

  function prepare(j) {
    const LANE = 1.6 * S; // drive on the right
    const shapes = j.shapes.map((f) => {
      const n = f.length / 2;
      const X = new Float32Array(n);
      const Z = new Float32Array(n);
      const C = new Float32Array(n);
      let la = 0;
      let lo = 0;
      for (let i = 0; i < n; i++) {
        la += f[i * 2];
        lo += f[i * 2 + 1];
        const p = project(la / 1e5, lo / 1e5);
        X[i] = p.x;
        Z[i] = p.z;
        if (i) C[i] = C[i - 1] + Math.hypot(X[i] - X[i - 1], Z[i] - Z[i - 1]);
      }
      return { X, Z, C, n };
    });
    const routes = j.routes.map((r) => ({ ...r, rgb: new THREE.Color(r.color) }));
    const days = j.services.map((s) => s.days);
    const patterns = j.patterns.map((p) => ({
      r: p.r,
      sh: p.sh,
      h: p.h,
      st: Int32Array.from(p.st),
      d: Float32Array.from(p.d, (m) => m * S),
      o: Int32Array.from(p.o),
      dur: p.o[p.o.length - 1],
      start: Int32Array.from(p.trips, (q) => q[0]),
      svc: Int16Array.from(p.trips, (q) => q[1]),
    }));
    data = { shapes, routes, days, patterns, stops: j.stops, LANE, trips: patterns.reduce((s, p) => s + p.start.length, 0), valid: j.valid };
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

  // ---- selection (once a second): trips running now, nearest the view
  const CAND = 1200;
  const cP = new Int32Array(CAND); // pattern
  const cT = new Int32Array(CAND); // trip
  const cOff = new Int32Array(CAND); // 0 today, 86400 a late trip of yesterday
  const cD = new Float32Array(CAND); // distance to the view, squared
  const cOrd = new Int32Array(CAND);
  let nCand = 0;
  const sP = new Int32Array(max);
  const sT = new Int32Array(max);
  const sOff = new Int32Array(max);
  const sK = new Int32Array(max); // stop cursor
  const sG = new Int32Array(max); // shape cursor
  const sX = new Float32Array(max);
  const sY = new Float32Array(max);
  const sZ = new Float32Array(max);
  const sNext = new Int32Array(max); // next stop index
  let nSel = 0;
  let running = 0;
  let lastSelect = -Infinity;
  const pos = { x: 0, z: 0, hx: 0, hz: 1, next: 0 };

  // where trip (pattern p) is, `rel` seconds after its start; cursors k, g
  // are hints (updated in place through the cur record)
  const cur = { k: 0, g: 1 };
  function locate(p, rel) {
    const P = data.patterns[p];
    const o = P.o;
    let k = Math.min(Math.max(cur.k, 0), o.length - 2);
    while (k < o.length - 2 && o[k + 1] <= rel) k++;
    while (k > 0 && o[k] > rel) k--;
    cur.k = k;
    const span = o[k + 1] - o[k];
    const u = span > 0 ? Math.min(1, Math.max(0, (rel - o[k]) / span)) : 1;
    const dist = P.d[k] + (P.d[k + 1] - P.d[k]) * u;
    const sh = data.shapes[P.sh];
    const C = sh.C;
    let g = Math.min(Math.max(cur.g, 1), sh.n - 1);
    while (g < sh.n - 1 && C[g] < dist) g++;
    while (g > 1 && C[g - 1] > dist) g--;
    cur.g = g;
    const seg = Math.max(1e-6, C[g] - C[g - 1]);
    const w = Math.min(1, Math.max(0, (dist - C[g - 1]) / seg));
    const hx = (sh.X[g] - sh.X[g - 1]) / seg;
    const hz = (sh.Z[g] - sh.Z[g - 1]) / seg;
    pos.x = sh.X[g - 1] + (sh.X[g] - sh.X[g - 1]) * w - hz * data.LANE;
    pos.z = sh.Z[g - 1] + (sh.Z[g] - sh.Z[g - 1]) * w + hx * data.LANE;
    pos.hx = hx;
    pos.hz = hz;
    pos.next = P.st[Math.min(k + 1, P.st.length - 1)];
    return pos;
  }

  function select(T) {
    const today = clock.weekday;
    const yday = (today + 6) % 7;
    const focus = camera.userData.focus;
    const fx = focus ? focus.x : 0;
    const fz = focus ? focus.z : 0;
    nCand = 0;
    running = 0;
    const pats = data.patterns;
    for (let p = 0; p < pats.length; p++) {
      const P = pats[p];
      const n = P.start.length;
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
        cD[nCand] = (at.x - fx) ** 2 + (at.z - fz) ** 2;
        cOrd[nCand] = nCand;
        nCand++;
      }
    }
    // nearest first (typed-array sort on a view: no garbage worth counting)
    const ord = cOrd.subarray(0, nCand);
    ord.sort((a, b) => cD[a] - cD[b]);
    // keep the cursors of buses that stay selected
    const keepK = new Map();
    for (let i = 0; i < nSel; i++) keepK.set(sP[i] * 4096 + sT[i], [sK[i], sG[i]]);
    nSel = Math.min(max, nCand);
    const ia = iRoute.array;
    for (let i = 0; i < nSel; i++) {
      const c = ord[i];
      sP[i] = cP[c];
      sT[i] = cT[c];
      sOff[i] = cOff[c];
      const kept = keepK.get(sP[i] * 4096 + sT[i]);
      sK[i] = kept ? kept[0] : 0;
      sG[i] = kept ? kept[1] : 1;
      data.routes[data.patterns[sP[i]].r].rgb.toArray(ia, i * 3);
    }
    iRoute.needsUpdate = true;
  }

  // ---- per frame
  let shown = false;
  function update(adt, dt, view) {
    const tNow = performance.now();
    // only in live mode («Сейчас в Порту»); the schedule loads on the first switch-on
    if (!live?.live) {
      if (shown) {
        shown = false;
        mesh.visible = false;
        mesh.count = 0;
        nSel = 0;
        running = 0;
        baseMode = '';
        lastSelect = -Infinity;
        label.hide();
      }
      return;
    }
    shown = true;
    if (!data) {
      if (status === 'waiting' && tNow > loadAt) load();
      return;
    }
    const T = simSecs(tNow);
    if (tNow - lastSelect > RESELECT_MS) {
      lastSelect = tNow;
      select(T);
    }
    uni.uBusNight.value = atmosphere?.night ?? 0;
    const e = mesh.instanceMatrix.array;
    for (let i = 0; i < nSel; i++) {
      const P = data.patterns[sP[i]];
      cur.k = sK[i];
      cur.g = sG[i];
      const at = locate(sP[i], T + sOff[i] - P.start[sT[i]]);
      sK[i] = cur.k;
      sG[i] = cur.g;
      const y = heightAt(at.x, at.z) + 0.13;
      sX[i] = at.x;
      sY[i] = y;
      sZ[i] = at.z;
      sNext[i] = at.next;
      const o = i * 16;
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
      e[o + 13] = y;
      e[o + 14] = at.z;
      e[o + 15] = 1;
    }
    mesh.count = nSel;
    mesh.visible = nSel > 0 && (view?.camDist ?? 0) < 3200;
    if (nSel) mesh.instanceMatrix.needsUpdate = true;
    label.update(tNow);
  }

  const label = createHoverLabel({
    canvas: renderer.domElement,
    camera,
    count: () => (mesh.visible ? nSel : 0),
    key: (i) => sP[i] * 4096 + sT[i],
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

  function badge() {
    if (!live?.live || !data) return null;
    return `${t('Автобусы {op}:').replace('{op}', CITY.transit?.operator || 'GTFS')} ${running} ${t('на линиях')} (${t(RT_URL && rtKey ? 'в реальном времени' : 'по расписанию')})`;
  }

  return {
    update,
    badge,
    object: mesh,
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
    get stats() {
      return data ? { routes: data.routes.length, patterns: data.patterns.length, trips: data.trips, valid: data.valid, realtime: false } : null;
    },
    loadNow() {
      loadAt = 0;
      if (status === 'waiting') return load();
      return Promise.resolve();
    },
    // tests: a drawn bus, and its label facts
    busAt(i) {
      if (!data || i >= nSel) return null;
      const P = data.patterns[sP[i]];
      return { x: sX[i], y: sY[i], z: sZ[i], line: data.routes[P.r].short, headsign: P.h, next: data.stops[sNext[i]]?.[2] };
    },
  };
}
