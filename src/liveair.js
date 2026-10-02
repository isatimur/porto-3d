// Live aircraft over Braga («Сейчас в Браге» only).
//
//   - data: GET /api/adsb (api/adsb.js, a Vercel function: adsb.lol, then
//     adsb.fi, then OpenSky, all server-side, because none of them sends
//     CORS headers). Polled every 15 s (60 s when the answer came from
//     OpenSky), only in live mode and only while the tab is visible: the
//     poll runs from the render loop, which stops in a hidden tab;
//   - between polls every aircraft is dead-reckoned from its ground speed,
//     track and vertical rate; a new fix blends in over ~2 s, the heading
//     turns smoothly and the wings bank in turns;
//   - scale: the airliners are drawn 6x life size (a 37 m A320 becomes 222 m)
//     or they would be a few pixels over the whole city;
//   - altitude: metres x S up to 3 km, softly compressed above
//     (3000 + 2500 * (1 - e^(-(h - 3000) / 3500)) m: 11 km cruise -> 5.3 km),
//     so the cruisers stay in the frame and above the clouds;
//   - distance: the data covers 40 nm (74 km) around Braga, the map ~6 km.
//     Positions keep their bearing from the centre but the distance is
//     compressed past 700 units (2.8 km): r' = R0 + (Rmax - R0)(1 - e^(-(r - R0)/(Rmax - R0))),
//     Rmax = 1800 units (7.2 km), inside the haze around the map. The
//     badge counts every aircraft;
//   - a faint contrail behind cruisers (> 7.5 km), nav lights at night
//     (red port, green starboard, a white strobe), and a label with the
//     callsign, altitude and type on hover (tap on phones);
//   - the route card: a click (a tap), or a hover of 600 ms, looks the
//     aircraft up once in GET /api/route (api/route.js: adsb.lol routes,
//     adsbdb): airline and flight number, type and registration, origin ->
//     destination, the great-circle distance left, a link to its track on
//     globe.adsb.lol, and a faint dashed line toward the destination while
//     the card is open. The badge names the three nearest flights with their
//     routes (looked up ahead, one request at a time).
// At most 60 instances; the per-frame path allocates nothing (the card, a
// DOM element, updates a few times a second).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { t, locale, language } from './i18n.js';
import { cityT, cityQuery } from './city.js';

const MAX = 60;
const POLL_MS = 15e3;
const POLL_SLOW_MS = 60e3; // OpenSky's anonymous limits
const RETRY_MS = 120e3; // no endpoint (the dev server) or a failure
// api/adsb.js reads the city's aircraft point from cities/<id>.json; Braga
// sends no query (the CDN caches one answer per city)
const ENDPOINT = () => `/api/adsb${cityQuery() ? `?${cityQuery()}` : ''}`;
const PLANE_SCALE = 6;
const R0 = 700;
const RMAX = 1800;
const STALE_S = 60; // drop an aircraft not heard of for this long
const VR_S = 20; // extrapolate a climb or descent this long at most

// ---------------------------------------------------------------- labels
// A DOM label that follows one of a set of world points, picked on screen
// (nearest within `px`) on hover, pinned on click or tap. Shared with the
// buses (livebus.js).
//
// Opt-in (the aircraft card; the buses use none of these):
//   - render(i, el, { pinned, hoverMs }): fills the element itself instead
//     of text(i) -> innerHTML, so a card can keep its nodes (a link inside
//     it stays clickable) and update text nodes only; called every 250 ms
//     and after refresh();
//   - interactive: the pinned label gets the class is-pinned (its CSS can
//     take pointer events: a link in it);
//   - fit: keep the label inside the viewport (below the point when there
//     is no room above, clamped left and right).
export function createHoverLabel({ canvas, camera, count, worldPos, text, key, px = 22, className = '', render = null, interactive = false, fit = false }) {
  const label = document.createElement('div');
  label.className = `live-label ${className}`;
  label.hidden = true;
  label.setAttribute('role', 'status');
  document.body.append(label);
  if (!document.getElementById('porto-live-label-css')) {
    const st = document.createElement('style');
    st.id = 'porto-live-label-css';
    st.textContent = `.live-label { position: fixed; left: 0; top: 0; z-index: 30; pointer-events: none; padding: 4px 8px 5px; font: 12px/1.25 var(--font, system-ui, sans-serif); color: #fff6e6; background: rgba(26, 21, 16, 0.72); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border: 1px solid rgba(224, 169, 72, 0.45); border-radius: 4px; white-space: nowrap; transform: translate(-50%, calc(-100% - 12px)); }
.live-label b { color: var(--gold, #e0a948); font-weight: 600; }
.live-label .dim { color: rgba(240, 222, 192, 0.7); }`;
    document.head.append(st);
  }
  const v = new THREE.Vector3();
  let mx = -1e4;
  let my = -1e4;
  let moved = false;
  let hover = -1;
  let pinnedKey = null;
  let shownText = '';
  let down = null;
  let lastText = 0;
  let hoverKey = null;
  let hoverSince = 0;
  let size = null; // { w, h } of the label, measured after a render
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons) return;
    mx = e.clientX;
    my = e.clientY;
    moved = true;
  });
  canvas.addEventListener('pointerleave', () => {
    mx = my = -1e4;
    moved = true;
  });
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    mx = e.clientX;
    my = e.clientY;
    const i = pick();
    pinnedKey = i >= 0 ? key(i) : null;
    moved = true;
  });
  function screen(i, r) {
    if (!worldPos(i, v)) return false;
    v.project(camera);
    if (v.z > 1 || v.z < -1) return false;
    r.x = r.left + ((v.x + 1) / 2) * r.width;
    r.y = r.top + ((1 - v.y) / 2) * r.height;
    return true;
  }
  const rect = { left: 0, top: 0, width: 1, height: 1, x: 0, y: 0 };
  function readRect() {
    const b = canvas.getBoundingClientRect();
    rect.left = b.left;
    rect.top = b.top;
    rect.width = b.width;
    rect.height = b.height;
  }
  function pick() {
    readRect();
    let best = -1;
    let bd = px * px;
    const n = count();
    for (let i = 0; i < n; i++) {
      if (!screen(i, rect)) continue;
      const d = (rect.x - mx) ** 2 + (rect.y - my) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }
  function update(tNow) {
    if (moved) {
      moved = false;
      hover = pick();
      canvas.style.cursor = hover >= 0 ? 'pointer' : '';
    }
    const hk = hover >= 0 && hover < count() ? key(hover) : null;
    if (hk !== hoverKey) {
      hoverKey = hk;
      hoverSince = tNow;
    }
    let i = hover;
    if (i < 0 && pinnedKey != null) {
      const n = count();
      for (let k = 0; k < n; k++)
        if (key(k) === pinnedKey) {
          i = k;
          break;
        }
      if (i < 0) pinnedKey = null;
    } else if (i >= 0 && hover >= count()) i = -1;
    if (i < 0) {
      if (!label.hidden) label.hidden = true;
      return;
    }
    readRect();
    if (!screen(i, rect) || rect.x < rect.left || rect.x > rect.left + rect.width || rect.y < rect.top || rect.y > rect.top + rect.height) {
      label.hidden = true;
      return;
    }
    const pinned = pinnedKey != null && key(i) === pinnedKey;
    if (tNow - lastText > (render ? 250 : 500) || label.hidden) {
      lastText = tNow;
      if (render) {
        render(i, label, { pinned, hoverMs: i === hover ? tNow - hoverSince : 0 });
        size = null;
      } else {
        const s = text(i);
        if (s !== shownText) {
          shownText = s;
          label.innerHTML = s;
          size = null;
        }
      }
    }
    if (interactive) label.classList.toggle('is-pinned', pinned);
    label.hidden = false;
    let x = rect.x;
    let below = false;
    if (fit) {
      if (!size) size = { w: label.offsetWidth, h: label.offsetHeight };
      below = rect.y - size.h - 14 < rect.top;
      x = Math.min(Math.max(x, rect.left + size.w / 2 + 6), rect.left + rect.width - size.w / 2 - 6);
      label.classList.toggle('is-below', below);
    }
    label.style.left = `${x.toFixed(1)}px`;
    label.style.top = `${rect.y.toFixed(1)}px`;
  }
  return {
    update,
    hide() {
      hover = -1;
      pinnedKey = null;
      label.hidden = true;
    },
    // render again on the next frame (new data for the shown point)
    refresh() {
      lastText = 0;
    },
    // the key of the point the label shows now (null when hidden)
    get shownKey() {
      if (label.hidden) return null;
      return hover >= 0 && hover < count() ? key(hover) : pinnedKey;
    },
    // tests: pin the label on a slot
    pin(i) {
      pinnedKey = i >= 0 && i < count() ? key(i) : null;
      hover = -1;
    },
    get element() {
      return label;
    },
  };
}

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Russian plural: 1 самолёт, 2 самолёта, 5 самолётов
export function plural(n, [one, few, many]) {
  if (language === 'ru') {
    const m10 = n % 10;
    const m100 = n % 100;
    return t(m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many);
  }
  return t(n === 1 ? one : many);
}

// ---------------------------------------------------------------- model
function part(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  const col = new THREE.Color(color);
  for (let i = 0; i < n; i++) col.toArray(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
// sweep a part back along -z by k per metre of |x| (wings) or of y (fin)
function sweep(g, k, axis = 'x') {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const a = axis === 'x' ? Math.abs(p.getX(i)) : Math.max(0, p.getY(i));
    p.setZ(i, p.getZ(i) - a * k);
  }
  g.computeVertexNormals();
  return g;
}
// A low-poly airliner in metres (about an A320: 37 m long, 34 m span), +z
// forward, y up, +x to port.
function airlinerGeometry(S) {
  const WHITE = 0xf2f2ee;
  const GREY = 0xb9bec4;
  const DARK = 0x4a5058;
  const body = new THREE.CylinderGeometry(1.95, 1.95, 30, 8, 1);
  body.rotateX(Math.PI / 2);
  const nose = new THREE.ConeGeometry(1.95, 4.5, 8, 1);
  nose.rotateX(Math.PI / 2);
  nose.translate(0, 0, 17.25);
  const tail = new THREE.ConeGeometry(1.95, 6, 8, 1);
  tail.rotateX(-Math.PI / 2);
  tail.translate(0, 0.5, -18);
  const wing = new THREE.BoxGeometry(34, 0.45, 5.5, 6, 1, 1);
  wing.translate(0, -0.9, 2.5);
  sweep(wing, 0.42);
  const stab = new THREE.BoxGeometry(12.5, 0.3, 3, 4, 1, 1);
  stab.translate(0, 0.6, -16.5);
  sweep(stab, 0.5);
  const fin = new THREE.BoxGeometry(0.35, 6.5, 4.5, 1, 4, 1);
  fin.translate(0, 4.8, -15.5);
  sweep(fin, 0.75, 'y');
  const engines = [-1, 1].map((s) => {
    const e = new THREE.CylinderGeometry(1.05, 0.9, 4.2, 8, 1);
    e.rotateX(Math.PI / 2);
    e.translate(s * 5.8, -2.1, 5.2);
    return part(e, DARK);
  });
  const g = mergeGeometries([part(body, WHITE), part(nose, WHITE), part(tail, WHITE), part(wing, GREY), part(stab, GREY), part(fin, WHITE), ...engines]);
  g.scale(PLANE_SCALE * S, PLANE_SCALE * S, PLANE_SCALE * S);
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------- controller
export function createLiveAir({ scene, camera, renderer, project, heightAt, datumM = 0, mobile = false, reducedMotion = false, live, atmosphere, group }) {
  const S = 1 / 4;
  const max = mobile ? 40 : MAX;
  const uni = { uTime: { value: 0 }, uNight: { value: 0 }, uHeight: { value: 900 } };

  // ---- instanced airliners
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.15 });
  const mesh = new THREE.InstancedMesh(airlinerGeometry(S), mat, max);
  mesh.name = 'live-aircraft';
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // ---- contrails: a camera-facing ribbon from the tail back along the track
  const cPos = new Float32Array(max * 3);
  const cDir = new Float32Array(max * 4); // heading x, y, z; length
  const cgeo = new THREE.InstancedBufferGeometry();
  cgeo.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
  cgeo.setIndex([0, 1, 2, 0, 2, 3]);
  const cPosA = new THREE.InstancedBufferAttribute(cPos, 3).setUsage(THREE.DynamicDrawUsage);
  const cDirA = new THREE.InstancedBufferAttribute(cDir, 4).setUsage(THREE.DynamicDrawUsage);
  cgeo.setAttribute('iPos', cPosA);
  cgeo.setAttribute('iDir', cDirA);
  cgeo.instanceCount = 0;
  const cmat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: uni,
    vertexShader: /* glsl */ `
      attribute vec3 iPos;
      attribute vec4 iDir;
      varying float vAlong;
      varying float vAcross;
      void main() {
        vec3 dir = iDir.xyz;
        vec3 p = iPos - dir * (position.x * iDir.w);
        vec3 toCam = normalize(cameraPosition - p);
        vec3 side = normalize(cross(dir, toCam));
        // widens as it ages: 3 units at the tail, 9 at the end
        p += side * position.y * mix(1.5, 4.5, position.x);
        vAlong = position.x;
        vAcross = position.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      varying float vAlong;
      varying float vAcross;
      void main() {
        float a = smoothstep(0.0, 0.06, vAlong) * pow(1.0 - vAlong, 1.6) * (1.0 - vAcross * vAcross);
        gl_FragColor = vec4(vec3(1.0), a * mix(0.42, 0.1, uNight));
      }`,
  });
  const trails = new THREE.Mesh(cgeo, cmat);
  trails.name = 'live-contrails';
  trails.frustumCulled = false;
  trails.renderOrder = 25;

  // ---- nav lights: 4 points per aircraft (port, starboard, tail strobe, belly beacon)
  const L = 4;
  const lPos = new Float32Array(max * L * 3);
  const lKind = new Float32Array(max * L);
  for (let i = 0; i < max * L; i++) lKind[i] = i % L;
  const lgeo = new THREE.BufferGeometry();
  const lPosA = new THREE.BufferAttribute(lPos, 3).setUsage(THREE.DynamicDrawUsage);
  lgeo.setAttribute('position', lPosA);
  lgeo.setAttribute('aKind', new THREE.BufferAttribute(lKind, 1));
  lgeo.setDrawRange(0, 0);
  const lmat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: uni,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uNight;
      uniform float uHeight;
      attribute float aKind;
      varying vec3 vCol;
      varying float vA;
      void main() {
        vec4 mv = viewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float ph = fract(uTime * 0.9 + position.x * 0.013);
        float strobe = step(ph, 0.06) + step(0.16, ph) * step(ph, 0.22);
        float beacon = smoothstep(0.0, 0.1, ph) * (1.0 - smoothstep(0.2, 0.4, ph));
        vCol = aKind < 0.5 ? vec3(1.0, 0.12, 0.08) : aKind < 1.5 ? vec3(0.1, 1.0, 0.3) : aKind < 2.5 ? vec3(1.0) : vec3(1.0, 0.2, 0.1);
        float on = aKind < 1.5 ? 1.0 : aKind < 2.5 ? strobe : beacon;
        vA = on * mix(0.35, 1.0, uNight);
        gl_PointSize = clamp(6.0 * uHeight / 900.0 * (aKind > 1.5 ? 1.3 : 1.0), 2.5, 9.0) * mix(0.7, 1.0, uNight);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      varying float vA;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r = dot(p, p);
        if (r > 1.0 || vA < 0.01) discard;
        gl_FragColor = vec4(vCol * (1.0 - r) * 2.2 * vA, 1.0);
      }`,
  });
  lmat.toneMapped = false;
  const lights = new THREE.Points(lgeo, lmat);
  lights.name = 'live-navlights';
  lights.frustumCulled = false;
  lights.renderOrder = 26;

  const root = new THREE.Group();
  root.name = 'live-air';
  root.add(mesh, trails, lights);
  root.visible = false;
  (group || scene).add(root);

  // ---- state per slot (typed arrays; slot i is live when used[i])
  const used = new Uint8Array(max);
  const hexOf = new Array(max).fill('');
  const info = new Array(max).fill(null); // { flight, type, alt } for the label
  const X0 = new Float64Array(max); // fix, world units (uncompressed)
  const Z0 = new Float64Array(max);
  const A0 = new Float64Array(max); // altitude, m
  const VX = new Float64Array(max); // world units / s
  const VZ = new Float64Array(max);
  const VR = new Float64Array(max); // m/s
  const T0 = new Float64Array(max); // performance.now() of the fix, ms
  const OX = new Float64Array(max); // blend-out offset after a new fix, world
  const OZ = new Float64Array(max);
  const OA = new Float64Array(max);
  const HD = new Float64Array(max); // shown heading, rad (0 north, clockwise)
  const TR = new Float64Array(max); // target track, rad
  const BK = new Float64Array(max); // bank, rad
  const PX = new Float32Array(max); // shown position, world (compressed)
  const PY = new Float32Array(max);
  const PZ = new Float32Array(max);
  const GS = new Float32Array(max);
  const order = new Int16Array(max); // drawn slot for instance k
  let drawn = 0;

  let total = 0; // airborne aircraft in the data (all distances)
  let src = null;
  let status = 'idle';
  let lastPoll = -Infinity;
  let nextIn = POLL_MS;
  let ctl = null;
  let active = false;
  let lastAnswer = null;

  function clear() {
    used.fill(0);
    for (let i = 0; i < max; i++) {
      hexOf[i] = '';
      info[i] = null;
    }
    queue.length = 0;
    for (const [k, r] of routes) if (r.state === 'queued') routes.delete(k);
    nearest = [];
    badgeText = null;
    drawn = 0;
    mesh.count = 0;
    cgeo.instanceCount = 0;
    lgeo.setDrawRange(0, 0);
    label?.hide();
  }

  function ingest(j) {
    const tNow = performance.now();
    const age = Math.min(30, j.ageS ?? 0);
    const list = [];
    for (const a of j.ac || []) {
      if (a.ground || !Number.isFinite(a.lat) || !Number.isFinite(a.lon)) continue;
      if ((a.seen || 0) > STALE_S) continue;
      const p = project(a.lat, a.lon);
      list.push({ a, x: p.x, z: p.z, d: p.x * p.x + p.z * p.z });
    }
    total = list.length;
    list.sort((p, q) => p.d - q.d);
    const keep = list.slice(0, max);
    const seen = new Set(keep.map((k) => k.a.hex));
    for (let i = 0; i < max; i++) if (used[i] && !seen.has(hexOf[i])) used[i] = 0;
    for (const k of keep) {
      const a = k.a;
      let i = hexOf.indexOf(a.hex);
      if (i < 0 || !used[i]) {
        i = used.indexOf(0);
        if (i < 0) continue;
        hexOf[i] = a.hex;
        used[i] = 2; // new: no blend, heading set at once
      }
      const tFix = tNow - (age + (a.seen || 0)) * 1000;
      const tr = ((a.track || 0) * Math.PI) / 180;
      const gs = (a.gs || 0) * S;
      if (used[i] === 1) {
        // blend: keep the shown spot, the offset decays to the new track
        const dt = (tNow - T0[i]) / 1000;
        const oldX = X0[i] + VX[i] * dt + OX[i];
        const oldZ = Z0[i] + VZ[i] * dt + OZ[i];
        const oldA = A0[i] + VR[i] * Math.min(dt, VR_S) + OA[i];
        const ndt = (tNow - tFix) / 1000;
        OX[i] = oldX - (k.x + Math.sin(tr) * gs * ndt);
        OZ[i] = oldZ - (k.z - Math.cos(tr) * gs * ndt);
        OA[i] = oldA - (a.alt + (a.vr || 0) * ndt);
        // a jump of more than 2 km is a new aircraft on this slot: no blend
        if (OX[i] * OX[i] + OZ[i] * OZ[i] > 500 * 500) OX[i] = OZ[i] = OA[i] = 0;
      } else {
        OX[i] = OZ[i] = OA[i] = 0;
        HD[i] = tr;
        BK[i] = 0;
        used[i] = 1;
      }
      X0[i] = k.x;
      Z0[i] = k.z;
      A0[i] = a.alt || 0;
      VX[i] = Math.sin(tr) * gs;
      VZ[i] = -Math.cos(tr) * gs;
      VR[i] = a.vr || 0;
      T0[i] = tFix;
      TR[i] = tr;
      GS[i] = a.gs || 0;
      // call: the callsign only (older answers have flight alone; a
      // registration there fails the callsign check in routeKey)
      const call = String(a.call ?? a.flight ?? '').trim().toUpperCase();
      info[i] = { flight: a.flight || a.hex.toUpperCase(), call, reg: a.reg || '', type: a.type || '', alt: a.alt || 0, lat: a.lat, lon: a.lon };
    }
    // the badge names the three nearest; their routes are looked up ahead
    nearest = keep.slice(0, 3).map((k) => k.a.hex);
    for (const h of nearest) {
      const i = hexOf.indexOf(h);
      if (i >= 0 && used[i]) lookup(i, false);
    }
    badgeText = null;
  }

  // ---- routes (api/route.js): once per aircraft, one request at a time
  const ROUTE_ENDPOINT = '/api/route';
  const CALL_RE = /^[A-Z0-9]{2,8}$/;
  const HEX_RE = /^[0-9a-f]{6}$/;
  const routes = new Map(); // routeKey -> { state: 'queued'|'loading'|'ok'|'unknown'|'unavailable', data }
  const queue = [];
  let routeBusy = false;
  let routeLogged = false;
  let nearest = [];
  let badgeText = null;
  function routeKey(i) {
    const n = info[i];
    const hex = hexOf[i];
    const call = n && CALL_RE.test(n.call) ? n.call : '';
    const h = HEX_RE.test(hex) ? hex : '';
    return call || h ? `${h}|${call}` : null;
  }
  function routeOf(i) {
    const k = routeKey(i);
    return k ? routes.get(k) || null : { state: 'unknown', data: null };
  }
  // urgent: a click or a hover goes to the front of the queue
  function lookup(i, urgent) {
    const k = routeKey(i);
    if (!k || !active) return;
    const r = routes.get(k);
    // a failed lookup may try again after 2 minutes
    if (r && r.state === 'unavailable' && performance.now() - r.at > 120e3) routes.delete(k);
    else if (r) {
      if (urgent && r.state === 'queued') {
        queue.splice(queue.indexOf(k), 1);
        queue.unshift(k);
      }
      return;
    }
    routes.set(k, { state: 'queued', data: null, at: 0 });
    if (routes.size > 400) routes.delete(routes.keys().next().value);
    urgent ? queue.unshift(k) : queue.push(k);
    pump();
  }
  async function pump() {
    if (routeBusy || !queue.length) return;
    const k = queue.shift();
    const r = routes.get(k);
    if (!r || r.state !== 'queued') return pump();
    routeBusy = true;
    r.state = 'loading';
    const [hex, call] = k.split('|');
    const q = new URLSearchParams();
    if (call) q.set('callsign', call);
    if (hex) q.set('hex', hex);
    if (cityQuery()) q.set('city', cityQuery().slice(5));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12e3);
    try {
      const res = await fetch(`${ROUTE_ENDPOINT}?${q}`, { signal: ctl.signal });
      // the Vite dev server answers /api/route with index.html and 200
      if (!(res.headers.get('content-type') || '').includes('json')) throw Object.assign(new Error('no /api/route endpoint here (dev server?)'), { quiet: true });
      const j = await res.json();
      if (!res.ok || !j || !j.ok) throw new Error(`no route source answered (${res.status})`);
      r.data = j;
      r.state = j.route ? 'ok' : 'unknown';
    } catch (e) {
      r.state = 'unavailable';
      r.at = performance.now();
      if (!routeLogged) {
        routeLogged = true;
        console.info(`[porto] aircraft route lookup unavailable (${e.name === 'AbortError' ? 'timeout' : e.message})`);
      }
    } finally {
      clearTimeout(timer);
      routeBusy = false;
      badgeText = null;
      label?.refresh();
      pump();
    }
  }

  async function poll() {
    if (ctl) return;
    lastPoll = performance.now();
    ctl = new AbortController();
    const my = ctl;
    const timer = setTimeout(() => my.abort(), 9000);
    try {
      const r = await fetch(ENDPOINT(), { signal: my.signal, cache: 'no-store' });
      const type = r.headers.get('content-type') || '';
      // the Vite dev server answers /api/adsb with index.html and 200
      if (!type.includes('json')) throw Object.assign(new Error('no /api/adsb endpoint here (dev server?)'), { quiet: true });
      const j = await r.json();
      if (!r.ok || !j.src) throw new Error(`no source answered (${(j.errors || []).join('; ') || r.status})`);
      // the answer's age by the server's own clock (a wrong clock on this
      // device does not matter); an old answer (a cached copy offline) is
      // no live data
      const served = Date.parse(r.headers.get('date') || '') || Date.now();
      const ageS = Math.max(0, (served - (j.now || served)) / 1000);
      if (ageS > 120) throw new Error('stale answer (offline?)');
      // an offline copy from the service worker (public/sw.js is network
      // first) carries its own old Date: check it against this device's
      // clock too, with room for a clock that is a few minutes off
      if (Date.now() - served > 10 * 60e3) throw new Error('stale answer (cached copy)');
      j.ageS = ageS;
      if (my !== ctl || !active) return; // left live mode meanwhile
      src = j.src;
      status = 'ok';
      lastAnswer = { src: j.src, count: (j.ac || []).length, errors: j.errors || [], at: new Date().toISOString() };
      ingest(j);
      nextIn = src === 'opensky' ? POLL_SLOW_MS : POLL_MS;
      if (!loggedSrc) {
        loggedSrc = true;
        console.info(`[porto] live aircraft: ${j.src} answered, ${total} airborne within 40 nm`);
      }
    } catch (e) {
      if (my !== ctl) return;
      status = e.name === 'AbortError' ? 'timeout' : `unavailable: ${e.message}`;
      nextIn = RETRY_MS;
      if (!loggedFail) {
        loggedFail = true;
        console.info(`[porto] live aircraft unavailable (${status}); retry in ${RETRY_MS / 1000} s`);
      }
    } finally {
      clearTimeout(timer);
      if (my === ctl) ctl = null;
    }
  }
  let loggedSrc = false;
  let loggedFail = false;

  function setActive(on) {
    if (on === active) return;
    active = on;
    root.visible = on;
    if (on) {
      lastPoll = -Infinity; // poll on the next frame
    } else {
      ctl?.abort();
      ctl = null;
      clear();
      total = 0;
      status = 'idle';
    }
  }

  // ---- per frame
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler(0, 0, 0, 'YXZ');
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3(1, 1, 1);
  const _o = new THREE.Vector3();
  const _size = new THREE.Vector2();
  const OFF = [
    [17 * PLANE_SCALE * S, -0.9 * PLANE_SCALE * S, -4 * PLANE_SCALE * S], // port wingtip (red)
    [-17 * PLANE_SCALE * S, -0.9 * PLANE_SCALE * S, -4 * PLANE_SCALE * S], // starboard (green)
    [0, 1 * PLANE_SCALE * S, -20.5 * PLANE_SCALE * S], // tail strobe
    [0, -2.2 * PLANE_SCALE * S, 0], // belly beacon
  ];
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const compress = (r) => (r <= R0 ? r : R0 + (RMAX - R0) * (1 - Math.exp(-(r - R0) / (RMAX - R0))));
  const altMap = (h) => (h <= 3000 ? h : 3000 + 2500 * (1 - Math.exp(-(h - 3000) / 3500)));
  let time = 0;

  function update(adt, dt, view) {
    const on = !!live?.live;
    setActive(on);
    if (!on) return;
    const tNow = performance.now();
    if (!document.hidden && tNow - lastPoll > nextIn) poll();
    time += adt;
    uni.uTime.value = time;
    uni.uNight.value = atmosphere?.night ?? 0;
    renderer.getDrawingBufferSize(_size);
    uni.uHeight.value = _size.y;
    const k = 1 - Math.exp(-dt / 1.2); // blend-out rate of a new fix
    drawn = 0;
    let nc = 0;
    let nl = 0;
    const e = mesh.instanceMatrix.array;
    for (let i = 0; i < max; i++) {
      if (!used[i]) continue;
      const age = (tNow - T0[i]) / 1000;
      if (age > STALE_S + 30) {
        used[i] = 0;
        continue;
      }
      const tt = Math.min(age, 90); // dead reckoning up to 90 s
      OX[i] -= OX[i] * k;
      OZ[i] -= OZ[i] * k;
      OA[i] -= OA[i] * k;
      const x = X0[i] + VX[i] * tt + OX[i];
      const z = Z0[i] + VZ[i] * tt + OZ[i];
      // climb or descent: 20 s at most (a flare or a level-off is not in the data)
      const alt = Math.max(0, A0[i] + VR[i] * Math.min(tt, VR_S) + OA[i]);
      const r = Math.hypot(x, z);
      const f = r > 1e-6 ? compress(r) / r : 1;
      const wx = x * f;
      const wz = z * f;
      const ground = heightAt(wx, wz);
      const wy = Math.max((altMap(alt) - datumM) * S, ground + 40 * S);
      // heading turns at up to 3 deg/s; the bank follows the turn
      const dh = wrap(TR[i] - HD[i]);
      // (under reduced motion the heading snaps)
      HD[i] = adt > 0 ? wrap(HD[i] + Math.sign(dh) * Math.min(Math.abs(dh), 0.052 * dt)) : TR[i];
      // right turn (heading grows): right wing down, a positive roll here
      BK[i] += (THREE.MathUtils.clamp(dh * 1.6, -0.45, 0.45) - BK[i]) * Math.min(1, dt * 1.5);
      const pitch = -Math.atan2(VR[i], Math.max(40, GS[i]));
      PX[i] = wx;
      PY[i] = wy;
      PZ[i] = wz;
      // yaw: +z of the model along the heading (north is -z)
      _e.set(pitch, Math.atan2(Math.sin(HD[i]), -Math.cos(HD[i])), BK[i], 'YXZ');
      _q.setFromEuler(_e);
      _p.set(wx, wy, wz);
      _m.compose(_p, _q, _s);
      _m.toArray(e, drawn * 16);
      order[drawn++] = i;
      // contrail: cruisers above 7.5 km at speed
      if (alt > 7500 && GS[i] > 150) {
        const hx = Math.sin(HD[i]);
        const hz = -Math.cos(HD[i]);
        _o.set(0, 0.6 * PLANE_SCALE * S, -19 * PLANE_SCALE * S).applyQuaternion(_q);
        cPos[nc * 3] = wx + _o.x;
        cPos[nc * 3 + 1] = wy + _o.y;
        cPos[nc * 3 + 2] = wz + _o.z;
        cDir[nc * 4] = hx;
        cDir[nc * 4 + 1] = 0;
        cDir[nc * 4 + 2] = hz;
        cDir[nc * 4 + 3] = 220 * THREE.MathUtils.smoothstep(alt, 7500, 8500);
        nc++;
      }
      for (let q = 0; q < L; q++) {
        _o.set(OFF[q][0], OFF[q][1], OFF[q][2]).applyQuaternion(_q);
        const o = (nl * L + q) * 3;
        lPos[o] = wx + _o.x;
        lPos[o + 1] = wy + _o.y;
        lPos[o + 2] = wz + _o.z;
      }
      nl++;
    }
    mesh.count = drawn;
    if (drawn) mesh.instanceMatrix.needsUpdate = true;
    cgeo.instanceCount = nc;
    if (nc) {
      cPosA.needsUpdate = true;
      cDirA.needsUpdate = true;
    }
    trails.visible = nc > 0;
    lgeo.setDrawRange(0, nl * L);
    if (nl) lPosA.needsUpdate = true;
    label.update(tNow);
    updateHint();
  }

  const fmtN = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });

  // ---- the card: who flies, from where to where (click, or hover 600 ms)
  if (!document.getElementById('porto-air-card-css')) {
    const st = document.createElement('style');
    st.id = 'porto-air-card-css';
    st.textContent = `.live-label.air-card { white-space: normal; width: max-content; max-width: min(340px, calc(100vw - 16px)); padding: 7px 10px 8px; line-height: 1.35; }
.air-card .ac-stats { white-space: nowrap; }
.air-card.is-below { transform: translate(-50%, 16px); }
.air-card.is-pinned { pointer-events: auto; }
.air-card .ac-title { display: block; font-size: 13px; }
.air-card .ac-row { display: block; }
.air-card .ac-route { display: block; margin: 3px 0 2px; font-size: 13px; color: #fff6e6; }
.air-card .ac-route .ac-code { color: var(--gold, #e0a948); font-weight: 600; }
.air-card .ac-link { display: none; margin-top: 4px; color: var(--gold, #e0a948); text-decoration: none; }
.air-card.is-pinned .ac-link { display: inline-block; }
.air-card .ac-link:hover, .air-card .ac-link:focus-visible { text-decoration: underline; }
.air-card .ac-hint { display: block; font-size: 11px; }
.air-card.is-pinned .ac-hint { display: none; }
.air-card [hidden] { display: none !important; }`;
    document.head.append(st);
  }
  const HOVER_MS = 600;
  const nodes = new WeakMap(); // card element -> its parts
  const setText = (el, s) => {
    if (el.textContent !== s) el.textContent = s;
  };
  function cardParts(el) {
    let c = nodes.get(el);
    if (c) return c;
    el.textContent = '';
    const span = (cls) => {
      const s = document.createElement('span');
      s.className = cls;
      return s;
    };
    const title = span('ac-title');
    const titleB = document.createElement('b');
    const titleRest = span('dim');
    title.append(titleB, ' ', titleRest);
    const plane = span('ac-row dim');
    const route = span('ac-route');
    const stats = span('ac-row ac-stats dim');
    const dist = span('ac-row dim');
    const link = document.createElement('a');
    link.className = 'ac-link';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const hint = span('ac-hint dim');
    el.append(title, plane, route, stats, dist, link, hint);
    c = { titleB, titleRest, plane, route, stats, dist, link, hint, routeKey: '', hex: '' };
    nodes.set(el, c);
    return c;
  }
  // "TP764" -> "TP 764"; a malformed IATA number (adsbdb gave "86BR" for
  // VOE86BR, the airline's code missing) falls back to the callsign
  function prettyFlight(d, call) {
    const iata = d?.flight?.iata;
    if (!iata || !/^[A-Z0-9]{2}[0-9]/.test(iata)) return call || '';
    const al = d?.flight?.airline?.iata;
    const pre = al && iata.startsWith(al) ? al : iata.slice(0, 2);
    return `${pre} ${iata.slice(pre.length)}`;
  }
  const place = (a) => a.city || a.name || a.iata || a.icao || '?';
  const code = (a) => a.iata || a.icao || '';
  function haversineKm(la1, lo1, la2, lo2) {
    const R = Math.PI / 180;
    const h = Math.sin(((la2 - la1) * R) / 2) ** 2 + Math.cos(la1 * R) * Math.cos(la2 * R) * Math.sin(((lo2 - lo1) * R) / 2) ** 2;
    return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // the name to show for an aircraft: callsign, else registration, else hex
  function nameOf(i) {
    const n = info[i];
    const d = routeOf(i)?.data;
    if (n?.call) return n.call;
    return n?.reg || d?.aircraft?.registration || n?.flight || hexOf[i].toUpperCase();
  }
  let cardSlot = -1; // the slot the card shows (the hint line follows it)
  function renderCard(k, el, st) {
    const i = order[k];
    const n = info[i];
    if (!n) return;
    cardSlot = i;
    // look the route up on a click at once, on a hover after 600 ms
    if (st.pinned || st.hoverMs >= HOVER_MS) lookup(i, true);
    const c = cardParts(el);
    const r = routeOf(i);
    const d = r?.data;
    const call = nameOf(i);
    if (c.hex !== hexOf[i]) {
      c.hex = hexOf[i];
      if (HEX_RE.test(hexOf[i])) {
        c.link.href = `https://globe.adsb.lol/?icao=${hexOf[i]}`;
        setText(c.link, t('Открыть трек ↗'));
      } else {
        c.link.removeAttribute('href');
        setText(c.link, '');
      }
    }
    // title: airline and flight number
    const airline = d?.flight?.airline?.name || d?.aircraft?.operator || '';
    const pretty = prettyFlight(d, call);
    setText(c.titleB, airline || pretty || call);
    setText(c.titleRest, airline ? `${pretty || call}${pretty && pretty.replace(' ', '') !== call ? ` · ${call}` : ''}` : pretty && pretty.replace(' ', '') !== call ? call : '');
    // aircraft type and registration
    const ac = d?.aircraft;
    // "Airbus Sas" + "A320-251N" -> "Airbus A320-251N"
    const mf = (ac?.manufacturer || '').split(/\s+/)[0];
    const typeName = ac?.type ? (mf && !ac.type.toLowerCase().includes(mf.toLowerCase()) ? `${mf} ${ac.type}` : ac.type) : n.type;
    const reg = ac?.registration || n.reg;
    setText(c.plane, [typeName, reg && reg !== call ? reg : ''].filter(Boolean).join(' · '));
    // route
    const rk = `${r?.state}|${d?.route?.origin?.icao}|${d?.route?.destination?.icao}`;
    if (rk !== c.routeKey) {
      c.routeKey = rk;
      c.route.textContent = '';
      if (r?.state === 'ok' && d.route) {
        const o = d.route.origin;
        const de = d.route.destination;
        const b = (s) => {
          const x = document.createElement('span');
          x.className = 'ac-code';
          x.textContent = s;
          return x;
        };
        c.route.append(`${place(o)} `, b(code(o)), ` → ${place(de)} `, b(code(de)));
      } else if (r?.state === 'queued' || r?.state === 'loading') c.route.textContent = t('маршрут: ищем…');
      else if (r) c.route.textContent = t('маршрут неизвестен');
    }
    // altitude, speed, course, climb or descent
    const dt = Math.min((performance.now() - T0[i]) / 1000, 90);
    const alt = Math.max(0, A0[i] + VR[i] * Math.min(dt, VR_S));
    const trend = VR[i] > 1.5 ? `↑ ${t('набор высоты')}` : VR[i] < -1.5 ? `↓ ${t('снижение')}` : `→ ${t('ровный полёт')}`;
    const course = Math.round(((((TR[i] * 180) / Math.PI) % 360) + 360) % 360);
    setText(c.stats, `${fmtN.format(Math.round(alt / 10) * 10)} ${t('м')} · ${fmtN.format(Math.round(GS[i] * 3.6))} ${t('км/ч')} · ${t('курс')} ${course}° · ${trend}`);
    // great-circle distance from the aircraft to its destination
    const de = r?.state === 'ok' ? d.route.destination : null;
    if (de && Number.isFinite(de.lat) && Number.isFinite(de.lon) && Number.isFinite(n.lat)) {
      const km = haversineKm(n.lat, n.lon, de.lat, de.lon);
      setText(c.dist, `${t('до')} ${place(de)}: ${fmtN.format(km < 20 ? Math.round(km) : Math.round(km / 5) * 5)} ${t('км')}`);
    } else setText(c.dist, '');
    c.dist.hidden = !c.dist.textContent;
    c.link.hidden = !c.link.getAttribute('href');
    setText(c.hint, st.pinned ? '' : t('нажмите, чтобы закрепить и открыть трек'));
  }
  const label = createHoverLabel({
    canvas: renderer.domElement,
    camera,
    count: () => drawn,
    key: (k) => hexOf[order[k]],
    worldPos: (k, v) => {
      const i = order[k];
      v.set(PX[i], PY[i], PZ[i]);
      return true;
    },
    render: renderCard,
    interactive: true,
    fit: true,
    className: 'air-card',
    px: 26,
  });

  // ---- a faint great-circle hint toward the destination, while the card is open
  const HINT_N = 48;
  const hPos = new Float32Array(HINT_N * 3);
  const hgeo = new THREE.BufferGeometry();
  const hPosA = new THREE.BufferAttribute(hPos, 3).setUsage(THREE.DynamicDrawUsage);
  hgeo.setAttribute('position', hPosA);
  // no fog: the line runs out toward the haze, where fog would erase it
  const hmat = new THREE.LineDashedMaterial({ color: 0xe0a948, transparent: true, opacity: 0.7, dashSize: 18, gapSize: 12, depthWrite: false, fog: false });
  hmat.toneMapped = false;
  const hint = new THREE.Line(hgeo, hmat);
  hint.name = 'live-air-route-hint';
  hint.frustumCulled = false;
  hint.visible = false;
  hint.renderOrder = 27;
  root.add(hint);
  // A destination on the map (< 80 km, Porto for arrivals): a straight line
  // down to the airport. Farther: a ray along the initial great-circle
  // bearing, 700 units (2.8 km) long. (Following the whole great circle
  // through the distance compression folds it along the haze rim and points
  // the wrong way.)
  const NEAR_KM = 80;
  const RAY = 700;
  function updateHint() {
    const i = label.shownKey != null ? cardSlot : -1;
    const n = i >= 0 && used[i] && hexOf[i] === label.shownKey ? info[i] : null;
    const r = n ? routeOf(i) : null;
    const de = r?.state === 'ok' ? r.data.route.destination : null;
    if (!de || !Number.isFinite(de.lat) || !Number.isFinite(n.lat)) {
      hint.visible = false;
      return;
    }
    const km = haversineKm(n.lat, n.lon, de.lat, de.lon);
    let ex;
    let ez;
    if (km < NEAR_KM) {
      const p = project(de.lat, de.lon);
      const r = Math.hypot(p.x, p.z);
      const f = r > 1e-6 ? compress(r) / r : 1;
      ex = p.x * f;
      ez = p.z * f;
    } else {
      // initial bearing, 0 north, clockwise; north is -z on the map
      const R = Math.PI / 180;
      const p1 = n.lat * R;
      const p2 = de.lat * R;
      const dl = (de.lon - n.lon) * R;
      const b = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl));
      ex = PX[i] + Math.sin(b) * RAY;
      ez = PZ[i] - Math.cos(b) * RAY;
    }
    for (let s = 0; s < HINT_N; s++) {
      const f = s / (HINT_N - 1);
      const wx = PX[i] + (ex - PX[i]) * f;
      const wz = PZ[i] + (ez - PZ[i]) * f;
      const gy = heightAt(wx, wz) + 10 * S;
      hPos[s * 3] = wx;
      // down to the airport when it is near, level otherwise
      hPos[s * 3 + 1] = km < NEAR_KM ? Math.max(gy, PY[i] + (gy - PY[i]) * f) : Math.max(gy, PY[i]);
      hPos[s * 3 + 2] = wz;
    }
    hPosA.needsUpdate = true;
    hint.computeLineDistances();
    hint.visible = true;
  }

  function badge() {
    if (!active) return null;
    // the source is named: adsb.fi and OpenSky ask to be cited
    if (status === 'ok' || src) {
      if (badgeText == null) {
        // «TAP764 LIS→OSL, EZY62DK FUE→LTN, RYR3DK +9»: the three nearest
        const list = [];
        for (const h of nearest) {
          const i = hexOf.indexOf(h);
          if (i < 0 || !used[i]) continue;
          const r = routeOf(i);
          const ro = r?.state === 'ok' ? r.data.route : null;
          list.push(ro ? `${nameOf(i)} ${code(ro.origin)}→${code(ro.destination)}` : nameOf(i));
        }
        const more = total - list.length;
        const flights = list.length ? ` · ${list.join(', ')}${more > 0 ? ` +${more}` : ''}` : '';
        badgeText = `${cityT('Над {city_ins} сейчас:')} ${total} ${plural(total, ['самолёт', 'самолёта', 'самолётов'])}${flights}${src ? ` · ${src === 'opensky' ? 'OpenSky' : src}` : ''}`;
      }
      return badgeText;
    }
    if (status === 'idle' || status === 'fetching') return null;
    return `${t('Самолёты:')} ${t('нет данных')}`;
  }

  return {
    update,
    badge,
    object: root,
    get total() {
      return total;
    },
    get drawn() {
      return drawn;
    },
    get src() {
      return src;
    },
    get status() {
      return status;
    },
    get last() {
      return lastAnswer;
    },
    label,
    // tests: feed a canned answer ({ now, ac: [...] } in the api/adsb.js format)
    mock(j) {
      // a real poll still in flight would land after the mock and replace it
      ctl?.abort();
      ctl = null;
      src = j.src || 'mock';
      status = 'ok';
      lastAnswer = { src, count: (j.ac || []).length, errors: [], at: new Date().toISOString() };
      ingest({ now: Date.now(), ...j });
      lastPoll = performance.now();
      nextIn = 1e9; // no network while mocked
    },
    poll,
    // where a slot is drawn (tests, screenshots)
    positionOf(k) {
      const i = order[k];
      return i >= 0 && k < drawn ? { x: PX[i], y: PY[i], z: PZ[i], flight: info[i]?.flight, alt: A0[i] } : null;
    },
    // the route lookup of a drawn slot (tests): { state, data } or null
    routeOf(k) {
      const i = order[k];
      return i >= 0 && k < drawn ? routeOf(i) : null;
    },
    get hintVisible() {
      return hint.visible;
    },
  };
}
