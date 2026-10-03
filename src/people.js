// People in the streets of the centre (streetscape.js builds where they may
// be; life.js runs them on the shared clock):
//
//   - walkers on the walk lanes: the pedestrian streets, the sidewalks and
//     paths across the squares. At a lane's end a walker steps onto a lane
//     that joins there (a hop that never crosses a carriageway or a
//     building, checked when the lanes were built) or turns back;
//   - people who stay: groups standing on the squares, guests seated at
//     the café terraces, someone on a bench.
// One instanced draw: a low-poly figure (light mode: 28 triangles) with the
// walk cycle in the vertex shader (legs and arms swing about the hip and
// the shoulder; seated figures fold their legs). Shirt, trousers and skin
// vary per person. How many are out follows the hour (pedestrianDemand):
// busy at lunch and in the evening, nearly empty at 3 am, the São João night
// fuller still. Only within about 600 m of the point the camera looks at.
import * as THREE from 'three';
import { S } from './geo.js';

// ------------------------------------------------------------ the hour
// share of the peak, hour by hour (value at hh:30)
const WEEKDAY = [0.2, 0.12, 0.06, 0.03, 0.03, 0.04, 0.08, 0.22, 0.42, 0.5, 0.58, 0.72, 0.96, 1, 0.78, 0.6, 0.62, 0.74, 0.86, 0.88, 0.8, 0.66, 0.46, 0.3];
const WEEKEND = [0.32, 0.22, 0.12, 0.06, 0.03, 0.03, 0.05, 0.1, 0.2, 0.36, 0.55, 0.74, 0.92, 0.96, 0.82, 0.72, 0.74, 0.8, 0.86, 0.92, 0.9, 0.8, 0.64, 0.46];
// São João (night of 23 to 24 June): the city is out all night
const SAO_JOAO = [1.25, 1.15, 0.95, 0.7, 0.42, 0.22, 0.12, 0.15, 0.3, 0.45, 0.6, 0.75, 0.95, 1, 0.9, 0.85, 0.95, 1.1, 1.25, 1.35, 1.45, 1.5, 1.5, 1.42];
const lerpHour = (P, hour) => {
  const h = (((hour - 0.5) % 24) + 24) % 24;
  const i = Math.floor(h);
  return P[i] + (P[(i + 1) % 24] - P[i]) * (h - i);
};
// demand 0..1.5 (1: a normal lunch hour); ymd: the Lisbon date (20260623)
export function pedestrianDemand(hour, weekend, ymd = 0) {
  const md = ymd % 10000;
  // the festival: from the afternoon of the 23rd to the morning of the 24th
  if ((md === 623 && hour >= 12) || (md === 624 && hour < 8)) return lerpHour(SAO_JOAO, hour);
  return lerpHour(weekend ? WEEKEND : WEEKDAY, hour);
}
export const DEMAND_MAX = 1.5;

// ------------------------------------------------------------ the figure
// metres, standing on y = 0, facing +z; aPart: 0 shirt, 1 / 2 legs, 3 / 4
// arms, 5 skin, 6 hair, 7 both legs (light mode)
function figure(lite) {
  const P = [];
  const N = [];
  const A = [];
  // a box from (x0, y0, z0) to (x1, y1, z1) without the faces in `skip`
  // ('bottom', 'top')
  const box = (x0, y0, z0, x1, y1, z1, part, skip = []) => {
    const faces = [
      // +x, -x, +y, -y, +z, -z: four corners each (counter-clockwise from outside)
      [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]],
      [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]],
      [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], 'top'],
      [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], 'bottom'],
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]],
      [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]],
    ];
    for (const f of faces) {
      if (f[5] && skip.includes(f[5])) continue;
      const [a, b, c, d, n] = f;
      for (const p of [a, b, c, a, c, d]) {
        P.push(p[0] * S, p[1] * S, p[2] * S);
        N.push(n[0], n[1], n[2]);
        A.push(part);
      }
    }
  };
  if (lite) {
    box(-0.17, 0, -0.08, 0.17, 0.84, 0.08, 7, ['bottom', 'top']);
    box(-0.19, 0.84, -0.11, 0.19, 1.44, 0.11, 0, ['bottom']);
    box(-0.1, 1.44, -0.1, 0.1, 1.7, 0.11, 5, ['bottom']);
  } else {
    box(-0.155, 0, -0.075, -0.02, 0.86, 0.075, 1, ['top']);
    box(0.02, 0, -0.075, 0.155, 0.86, 0.075, 2, ['top']);
    box(-0.185, 0.84, -0.11, 0.185, 1.43, 0.11, 0, ['bottom']);
    box(-0.28, 0.86, -0.05, -0.19, 1.42, 0.05, 3);
    box(0.19, 0.86, -0.05, 0.28, 1.42, 0.05, 4);
    box(-0.095, 1.43, -0.1, 0.095, 1.66, 0.11, 5, ['bottom']);
    box(-0.105, 1.6, -0.115, 0.105, 1.71, 0.09, 6, ['bottom']);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(A, 1));
  g.computeBoundingSphere();
  return g;
}

const SHIRTS = [0xf2efe8, 0x23324f, 0x1c1c1e, 0x9b2c2c, 0xc99a2e, 0x2f7f7a, 0x8b8f94, 0xc9b79a, 0x5c6b3a, 0x7fa6c9, 0x6b2737, 0xd78ca0, 0x3d6fb0, 0xe2d37a].map((h) => new THREE.Color(h));
const PANTS = [0x2c3e5c, 0x1b1c1f, 0xb9a98a, 0x55585c, 0x4a3b2e, 0x3b4f70, 0x262a33].map((h) => new THREE.Color(h));

function peopleMaterial(uniforms) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.customProgramCacheKey = () => 'people-walk';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPTime = uniforms.uPTime;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uPTime;
attribute float aPart;
attribute vec4 iAnim; // phase, walking 0..1, seated 0..1, cadence
attribute vec4 iLook; // trousers rgb, skin 0..2
vec3 rotX(vec3 p, float pivot, float a) {
  float y = p.y - pivot;
  float c = cos(a);
  float s = sin(a);
  return vec3(p.x, pivot + y * c - p.z * s, y * s + p.z * c);
}`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
{
  float walk = iAnim.y;
  float sit = iAnim.z;
  float ph = uPTime * 6.4 * iAnim.w + iAnim.x;
  float sw = sin(ph) * 0.52 * walk;
  float isL = 1.0 - step(0.5, abs(aPart - 1.0));
  float isR = 1.0 - step(0.5, abs(aPart - 2.0));
  float isAL = 1.0 - step(0.5, abs(aPart - 3.0));
  float isAR = 1.0 - step(0.5, abs(aPart - 4.0));
  // standing: a slow gesture now and then
  float idle = (1.0 - walk) * (1.0 - sit) * 0.12 * max(0.0, sin(uPTime * 0.7 + iAnim.x * 3.0));
  // legs forward (-angle) about the hip; seated: thighs folded forward
  float legA = isL * (-sw) + isR * sw - (isL + isR) * sit * 1.25;
  transformed = rotX(transformed, ${(0.86 * S).toFixed(5)}, legA);
  float armA = isAL * (sw * 0.8 - idle) + isAR * (-sw * 0.8) - (isAL + isAR) * sit * 0.5;
  transformed = rotX(transformed, ${(1.4 * S).toFixed(5)}, armA);
  transformed.y += walk * abs(sin(ph)) * ${(0.03 * S).toFixed(5)} - sit * ${(0.4 * S).toFixed(5)};
}`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
{
  // the instance colour is the shirt; trousers and skin per instance too
  float pt = aPart;
  vec3 skin = iLook.w < 0.5 ? vec3(0.62, 0.42, 0.31) : iLook.w < 1.5 ? vec3(0.42, 0.26, 0.17) : vec3(0.2, 0.12, 0.08);
  vec3 hair = iLook.w < 0.5 ? vec3(0.09, 0.06, 0.04) : iLook.w < 1.5 ? vec3(0.03, 0.025, 0.02) : vec3(0.02, 0.02, 0.02);
  vec3 shirt = vec3(1.0);
#ifdef USE_INSTANCING_COLOR
  shirt = instanceColor.rgb;
#endif
  vColor = vec4(pt < 0.5 || (pt > 2.5 && pt < 4.5) ? shirt : (pt < 2.5 || pt > 6.5) ? iLook.rgb : pt < 5.5 ? skin : hair, 1.0);
}`,
      );
  };
  return mat;
}

function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// lanes (streetscape.js): { X, Z, Y, H (half width per sample), start, n,
//   type, weight, sampleLane, linkStart, links, nLanes }
// spots: { x, y, z, yaw, sit, t, kind, ref } arrays
export function createPeople({ lanes, spots, max, lite, shadows = false }) {
  const uniforms = { uPTime: { value: 0 } };
  const geo = figure(lite);
  const iAnim = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const iLook = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iAnim', iAnim);
  geo.setAttribute('iLook', iLook);
  const mesh = new THREE.InstancedMesh(geo, peopleMaterial(uniforms), max);
  mesh.name = 'people';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = !lite;
  mesh.count = 0;
  mesh.visible = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, SHIRTS[0]);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

  const { X, Z, Y, H, start: LS, n: LN, sampleLane, linkStart, links } = lanes;
  const nS = X.length;
  // ---- walkers: 3/4 of the people at the peak of a festival night
  const NW = lanes.nLanes ? Math.round(max * 0.75) : 0;
  const rnd = lcg(1806);
  const wl = new Int32Array(NW); // lane
  const ws = new Float32Array(NW); // position in samples along the lane
  const wd = new Int8Array(NW); // direction +1 / -1
  const wv = new Float32Array(NW); // speed (samples / s)
  const wf = new Float32Array(NW); // lateral place -1..1 of the half width
  const wph = new Float32Array(NW);
  const wcad = new Float32Array(NW);
  const wshirt = new Uint8Array(NW);
  const wpants = new Uint8Array(NW);
  const wskin = new Uint8Array(NW);
  const wsc = new Float32Array(NW);
  // a hop between lanes: from (hx, hz, hy) to sample wt, t in world units left
  const whop = new Uint8Array(NW);
  const whx = new Float32Array(NW);
  const whz = new Float32Array(NW);
  const why = new Float32Array(NW);
  const wt = new Int32Array(NW);
  const STEP = lanes.step; // world units between samples
  for (let i = 0; i < NW; i++) {
    wph[i] = rnd() * 6.283;
    wcad[i] = 0.9 + rnd() * 0.2;
    wv[i] = ((1.15 + rnd() * 0.4) * S) / STEP;
    wcad[i] *= wv[i] / ((1.35 * S) / STEP);
    wf[i] = rnd() * 2 - 1;
    wshirt[i] = Math.floor(rnd() * SHIRTS.length);
    wpants[i] = Math.floor(rnd() * PANTS.length);
    wskin[i] = rnd() < 0.78 ? 0 : rnd() < 0.6 ? 1 : 2;
    wsc[i] = 0.92 + rnd() * 0.16;
  }

  // ---- spawning near the focus: the samples within R, weighted by type
  const CELL = 16;
  const cells = new Map();
  for (let k = 0; k < nS; k++) {
    const key = Math.floor(X[k] / CELL) * 65536 + Math.floor(Z[k] / CELL);
    let c = cells.get(key);
    if (!c) cells.set(key, (c = []));
    c.push(k);
  }
  const W = lanes.weight;
  let cand = new Int32Array(0);
  let candN = 0;
  let candX = Infinity;
  let candZ = Infinity;
  function gather(fx, fz, R) {
    candX = fx;
    candZ = fz;
    const out = [];
    const R2 = R * R;
    for (let gx = Math.floor((fx - R) / CELL); gx <= Math.floor((fx + R) / CELL); gx++) {
      for (let gz = Math.floor((fz - R) / CELL); gz <= Math.floor((fz + R) / CELL); gz++) {
        const c = cells.get(gx * 65536 + gz);
        if (!c) continue;
        for (const k of c) if ((X[k] - fx) ** 2 + (Z[k] - fz) ** 2 < R2) out.push(k);
      }
    }
    cand = Int32Array.from(out);
    candN = cand.length;
  }
  function place(i) {
    if (!candN) return false;
    // rejection by the lane's weight (pedestrian streets 3, squares 2.5 ...)
    let k = cand[Math.floor(rnd() * candN)];
    for (let g = 0; g < 6; g++) {
      if (rnd() * 3 < W[sampleLane[k]]) break;
      k = cand[Math.floor(rnd() * candN)];
    }
    const l = sampleLane[k];
    wl[i] = l;
    ws[i] = k - LS[l] + rnd() * 0.9;
    if (ws[i] > LN[l] - 1) ws[i] = LN[l] - 1;
    wd[i] = rnd() < 0.5 ? 1 : -1;
    whop[i] = 0;
    return true;
  }

  // at the end of lane l (end 0 or 1): a joined lane, or back
  function turn(i, end) {
    const l = wl[i];
    const a = linkStart[l * 2 + end];
    const b = linkStart[l * 2 + end + 1];
    if (b > a && rnd() > 0.12) {
      const k = links[a + Math.floor(rnd() * (b - a))];
      const s = end ? LN[l] - 1 : 0;
      const g = LS[l] + s;
      whx[i] = X[g];
      whz[i] = Z[g];
      why[i] = Y[g];
      wt[i] = k;
      whop[i] = 1;
      return;
    }
    wd[i] = end ? -1 : 1;
    ws[i] = end ? LN[l] - 1 : 0;
  }
  function step(i, dt) {
    if (whop[i]) {
      const k = wt[i];
      const dx = X[k] - whx[i];
      const dz = Z[k] - whz[i];
      const d = Math.hypot(dx, dz);
      const mv = wv[i] * STEP * dt;
      if (d <= mv) {
        const l = sampleLane[k];
        wl[i] = l;
        ws[i] = k - LS[l];
        wd[i] = ws[i] < 0.5 ? 1 : ws[i] > LN[l] - 1.5 ? -1 : rnd() < 0.5 ? 1 : -1;
        whop[i] = 0;
      } else {
        whx[i] += (dx / d) * mv;
        whz[i] += (dz / d) * mv;
        why[i] += (Y[k] - why[i]) * Math.min(1, mv / d);
      }
      return;
    }
    const l = wl[i];
    let s = ws[i] + wd[i] * wv[i] * dt;
    if (s < 0) turn(i, 0);
    else if (s > LN[l] - 1) turn(i, 1);
    else ws[i] = s;
  }
  const pos = { x: 0, y: 0, z: 0, hx: 0, hz: 1 };
  function locate(i) {
    if (whop[i]) {
      const k = wt[i];
      const dx = X[k] - whx[i];
      const dz = Z[k] - whz[i];
      const d = Math.hypot(dx, dz) || 1;
      pos.x = whx[i];
      pos.z = whz[i];
      pos.y = why[i];
      pos.hx = dx / d;
      pos.hz = dz / d;
      return pos;
    }
    const l = wl[i];
    const s = ws[i];
    let a = Math.floor(s);
    if (a >= LN[l] - 1) a = LN[l] - 2;
    if (a < 0) a = 0;
    const u = Math.min(1, Math.max(0, s - a));
    const g = LS[l] + a;
    const tx = X[g + 1] - X[g];
    const tz = Z[g + 1] - Z[g];
    const L = Math.hypot(tx, tz) || 1;
    const h = (H[g] + (H[g + 1] - H[g]) * u) * wf[i];
    // right of travel along the lane: (-tz, tx)
    pos.x = X[g] + tx * u - (tz / L) * h;
    pos.z = Z[g] + tz * u + (tx / L) * h;
    pos.y = Y[g] + (Y[g + 1] - Y[g]) * u;
    pos.hx = (tx / L) * wd[i];
    pos.hz = (tz / L) * wd[i];
    return pos;
  }

  // ---- the people who stay
  const NSP = spots.x.length;
  const sShirt = new Uint8Array(NSP);
  const sPants = new Uint8Array(NSP);
  const sSkin = new Uint8Array(NSP);
  const sPh = new Float32Array(NSP);
  const sSc = new Float32Array(NSP);
  for (let i = 0; i < NSP; i++) {
    sShirt[i] = Math.floor(rnd() * SHIRTS.length);
    sPants[i] = Math.floor(rnd() * PANTS.length);
    sSkin[i] = rnd() < 0.78 ? 0 : rnd() < 0.6 ? 1 : 2;
    sPh[i] = rnd() * 6.283;
    sSc[i] = 0.92 + rnd() * 0.16;
  }
  const spotCells = new Map();
  for (let i = 0; i < NSP; i++) {
    const key = Math.floor(spots.x[i] / CELL) * 65536 + Math.floor(spots.z[i] / CELL);
    let c = spotCells.get(key);
    if (!c) spotCells.set(key, (c = []));
    c.push(i);
  }

  const E = mesh.instanceMatrix.array;
  const C = mesh.instanceColor.array;
  const IA = iAnim.array;
  const IL = iLook.array;
  function write(n, x, y, z, hx, hz, sc, shirt, pants, skin, ph, walk, sit, cad) {
    const o = n * 16;
    // +z of the figure along (hx, hz); uniform scale
    E[o] = hz * sc;
    E[o + 1] = 0;
    E[o + 2] = -hx * sc;
    E[o + 3] = 0;
    E[o + 4] = 0;
    E[o + 5] = sc;
    E[o + 6] = 0;
    E[o + 7] = 0;
    E[o + 8] = hx * sc;
    E[o + 9] = 0;
    E[o + 10] = hz * sc;
    E[o + 11] = 0;
    E[o + 12] = x;
    E[o + 13] = y;
    E[o + 14] = z;
    E[o + 15] = 1;
    const c = SHIRTS[shirt];
    C[n * 3] = c.r;
    C[n * 3 + 1] = c.g;
    C[n * 3 + 2] = c.b;
    const p = PANTS[pants];
    IL[n * 4] = p.r;
    IL[n * 4 + 1] = p.g;
    IL[n * 4 + 2] = p.b;
    IL[n * 4 + 3] = skin;
    IA[n * 4] = ph;
    IA[n * 4 + 1] = walk;
    IA[n * 4 + 2] = sit;
    IA[n * 4 + 3] = cad;
  }

  function inView(frustum, x, y, z, r) {
    const p = frustum.planes;
    for (let k = 0; k < 6; k++) if (p[k].normal.x * x + p[k].normal.y * y + p[k].normal.z * z + p[k].constant < -r) return false;
    return true;
  }

  let active = 0;
  let shown = 0;
  let shownWalkers = 0;
  let shownStaying = 0;
  let time = 0;
  let wasOn = false;
  // focus: where the camera looks (world); R: the radius (world) people
  // live in; demand 0..DEMAND_MAX; spotOk(i) -> may spot i be taken now
  function update(dt, camera, frustum, { fx, fz, R, on, demand, spotOk, camDist }) {
    time += dt;
    uniforms.uPTime.value = time;
    mesh.visible = on;
    if (!on) {
      wasOn = false;
      shown = 0;
      return;
    }
    // re-gather the spawn samples when the focus moved
    const moved = (fx - candX) ** 2 + (fz - candZ) ** 2;
    if (moved > 12 * 12) gather(fx, fz, R);
    const want = Math.min(NW, Math.round((NW * demand) / DEMAND_MAX));
    // after a jump (or the first time) everyone is placed anew
    if (!wasOn || moved > R * R * 0.25) {
      for (let i = 0; i < want; i++) place(i);
    } else for (let i = active; i < want; i++) place(i);
    active = want;
    wasOn = true;
    const cx = camera.position.x;
    const cz = camera.position.z;
    const R2 = R * R;
    const RV2 = (R * 1.05) ** 2;
    let n = 0;
    shownWalkers = 0;
    for (let i = 0; i < active; i++) {
      if (dt > 0) step(i, dt);
      const p = locate(i);
      const d2 = (p.x - fx) ** 2 + (p.z - fz) ** 2;
      if (d2 > R2) {
        // walked out of the circle: back in somewhere near the focus
        place(i);
        continue;
      }
      if (n >= max || (p.x - cx) ** 2 + (p.z - cz) ** 2 > RV2 * 1.6 || !inView(frustum, p.x, p.y + 0.2, p.z, 0.6)) continue;
      write(n++, p.x, p.y, p.z, p.hx, p.hz, wsc[i], wshirt[i], wpants[i], wskin[i], wph[i], 1, 0, wcad[i]);
      shownWalkers++;
    }
    // the people who stay, nearest cells first is not needed: the cap is high
    shownStaying = 0;
    const share = demand / DEMAND_MAX;
    for (let gx = Math.floor((fx - R) / CELL); gx <= Math.floor((fx + R) / CELL) && n < max; gx++) {
      for (let gz = Math.floor((fz - R) / CELL); gz <= Math.floor((fz + R) / CELL) && n < max; gz++) {
        const c = spotCells.get(gx * 65536 + gz);
        if (!c) continue;
        for (const i of c) {
          if (n >= max) break;
          const x = spots.x[i];
          const z = spots.z[i];
          if ((x - fx) ** 2 + (z - fz) ** 2 > R2) continue;
          if (spots.t[i] > share * 1.25 || !spotOk(i)) continue;
          if (!inView(frustum, x, spots.y[i] + 0.2, z, 0.6)) continue;
          const yaw = spots.yaw[i];
          write(n++, x, spots.y[i], z, Math.sin(yaw), Math.cos(yaw), sSc[i], sShirt[i], sPants[i], sSkin[i], sPh[i], 0, spots.sit[i], 1);
          shownStaying++;
        }
      }
    }
    shown = n;
    mesh.count = n;
    mesh.visible = n > 0;
    if (n) {
      for (const [a, k] of [
        [mesh.instanceMatrix, 16],
        [mesh.instanceColor, 3],
        [iAnim, 4],
        [iLook, 4],
      ]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * k);
        a.needsUpdate = true;
      }
    }
    mesh.castShadow = shadows && camDist < 160;
  }

  // tests: every walker's position now, [x, z, ...] (world)
  function sampleWalkers() {
    const out = [];
    for (let i = 0; i < active; i++) {
      const p = locate(i);
      out.push(p.x, p.z);
    }
    return out;
  }

  return {
    object: mesh,
    update,
    sampleWalkers,
    stats: { walkers: NW, spots: NSP, trianglesEach: geo.attributes.position.count / 3 },
    get active() {
      return active;
    },
    get shown() {
      return shown;
    },
    get shownWalkers() {
      return shownWalkers;
    },
    get shownStaying() {
      return shownStaying;
    },
  };
}

// ------------------------------------------------------------ crowd
// A second, lighter population: walkers on fixed promenade paths (the quays
// and avenues of the centre). porto-streetscape.js builds the paths from the
// road network, so Porto's street life is alive even before
// streetscape.json / pois.json land. One instanced draw, the same figure and
// walk shader as the lane walkers; culled by distance and by the hour.
// paths: [{ x, z, y: Float32Array, half: world units, ped: bool }]
export function createCrowd({ paths, max, lite, reducedMotion = false }) {
  const list = (paths || []).filter((p) => p && p.x && p.x.length >= 2);
  if (!list.length || max < 1) return null;
  const uniforms = { uPTime: { value: 0 } };
  const geo = figure(lite);
  const cap = Math.max(1, Math.round(reducedMotion ? max * 0.6 : max));
  const iAnim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const iLook = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iAnim', iAnim);
  geo.setAttribute('iLook', iLook);
  const mesh = new THREE.InstancedMesh(geo, peopleMaterial(uniforms), cap);
  mesh.name = 'porto-people';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = !lite;
  mesh.count = 0;
  mesh.visible = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, SHIRTS[0]);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

  // cumulative arc length per path (world units)
  const cum = list.map((p) => {
    const n = p.x.length;
    const c = new Float32Array(n);
    let s = 0;
    for (let i = 1; i < n; i++) {
      s += Math.hypot(p.x[i] - p.x[i - 1], p.z[i] - p.z[i - 1]);
      c[i] = s;
    }
    return c;
  });
  const total = cum.map((c) => c[c.length - 1] || 1);
  const rnd = lcg(90210);
  const base = reducedMotion ? 0.45 : 1;

  const P = new Int32Array(cap); // path
  const SS = new Float32Array(cap); // arc length along it
  const D = new Int8Array(cap);
  const V = new Float32Array(cap); // world units / s
  const F = new Float32Array(cap); // lateral -1..1
  const PH = new Float32Array(cap);
  const CAD = new Float32Array(cap);
  const SH = new Uint8Array(cap);
  const PA = new Uint8Array(cap);
  const SK = new Uint8Array(cap);
  const SC = new Float32Array(cap);
  const place = (i, pi) => {
    P[i] = pi;
    SS[i] = rnd() * total[pi];
    D[i] = rnd() < 0.5 ? 1 : -1;
    V[i] = (1.05 + rnd() * 0.5) * S * base;
    F[i] = rnd() * 2 - 1;
    PH[i] = rnd() * 6.283;
    SH[i] = Math.floor(rnd() * SHIRTS.length);
    PA[i] = Math.floor(rnd() * PANTS.length);
    SK[i] = rnd() < 0.78 ? 0 : rnd() < 0.6 ? 1 : 2;
    SC[i] = 0.92 + rnd() * 0.16;
    CAD[i] = (0.9 + rnd() * 0.2) * base;
  };

  // paths near the focus (their samples within R)
  let near = [];
  let candX = Infinity;
  let candZ = Infinity;
  function gather(fx, fz, R) {
    candX = fx;
    candZ = fz;
    const R2 = R * R;
    near = [];
    for (let pi = 0; pi < list.length; pi++) {
      const p = list[pi];
      for (let k = 0; k < p.x.length; k += 3) {
        if ((p.x[k] - fx) ** 2 + (p.z[k] - fz) ** 2 < R2) {
          near.push(pi);
          break;
        }
      }
    }
  }

  const pos = { x: 0, y: 0, z: 0, hx: 0, hz: 1 };
  function locate(i) {
    const p = list[P[i]];
    const c = cum[P[i]];
    const n = p.x.length;
    let s = SS[i];
    if (s < 0) s = 0;
    if (s > c[n - 1]) s = c[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (lo + 1 < hi) {
      const m = (lo + hi) >> 1;
      if (c[m] <= s) lo = m;
      else hi = m;
    }
    const seg = c[hi] - c[lo] || 1;
    const u = (s - c[lo]) / seg;
    const ax = p.x[lo];
    const az = p.z[lo];
    let tx = p.x[hi] - ax;
    let tz = p.z[hi] - az;
    const L = Math.hypot(tx, tz) || 1;
    tx /= L;
    tz /= L;
    // pedestrians keep to the middle; along a carriageway they walk the kerb
    const side = p.ped ? 1 : F[i] >= 0 ? 1 : -1;
    const h = p.ped ? F[i] * (p.half - 0.35 * S) : p.half + (1.0 + 0.25 * Math.abs(F[i])) * S;
    pos.x = ax + (p.x[hi] - ax) * u - tz * h * side;
    pos.z = az + (p.z[hi] - az) * u + tx * h * side;
    pos.y = p.y[lo] + (p.y[hi] - p.y[lo]) * u;
    pos.hx = tx * D[i];
    pos.hz = tz * D[i];
    return pos;
  }
  function step(i, dt) {
    const L = total[P[i]];
    let s = SS[i] + D[i] * V[i] * dt;
    if (s < 0) {
      s = -s;
      D[i] = 1;
    } else if (s > L) {
      s = 2 * L - s;
      D[i] = -1;
    }
    if (s < 0) s = 0;
    if (s > L) s = L;
    SS[i] = s;
  }
  function inView(frustum, x, y, z, r) {
    const pl = frustum.planes;
    for (let k = 0; k < 6; k++) if (pl[k].normal.x * x + pl[k].normal.y * y + pl[k].normal.z * z + pl[k].constant < -r) return false;
    return true;
  }

  const E = mesh.instanceMatrix.array;
  const C = mesh.instanceColor.array;
  const IA = iAnim.array;
  const IL = iLook.array;
  function write(n, x, y, z, hx, hz, sc, shirt, pants, skin, ph, walk, cad) {
    const o = n * 16;
    E[o] = hz * sc;
    E[o + 1] = 0;
    E[o + 2] = -hx * sc;
    E[o + 3] = 0;
    E[o + 4] = 0;
    E[o + 5] = sc;
    E[o + 6] = 0;
    E[o + 7] = 0;
    E[o + 8] = hx * sc;
    E[o + 9] = 0;
    E[o + 10] = hz * sc;
    E[o + 11] = 0;
    E[o + 12] = x;
    E[o + 13] = y;
    E[o + 14] = z;
    E[o + 15] = 1;
    const c = SHIRTS[shirt];
    C[n * 3] = c.r;
    C[n * 3 + 1] = c.g;
    C[n * 3 + 2] = c.b;
    const p = PANTS[pants];
    IL[n * 4] = p.r;
    IL[n * 4 + 1] = p.g;
    IL[n * 4 + 2] = p.b;
    IL[n * 4 + 3] = skin;
    IA[n * 4] = ph;
    IA[n * 4 + 1] = walk;
    IA[n * 4 + 2] = 0;
    IA[n * 4 + 3] = cad;
  }

  let active = 0;
  let shown = 0;
  let wasOn = false;
  let time = 0;
  function update(dt, camera, frustum, { fx, fz, R, on, demand = 1 }) {
    time += dt;
    uniforms.uPTime.value = time;
    if (!on) {
      mesh.visible = false;
      shown = 0;
      wasOn = false;
      return;
    }
    const moved = (fx - candX) ** 2 + (fz - candZ) ** 2;
    if (moved > 12 * 12 || !near.length) gather(fx, fz, R);
    if (!near.length) {
      mesh.visible = false;
      shown = 0;
      return;
    }
    const want = Math.min(cap, Math.max(0, Math.round((cap * demand) / DEMAND_MAX)));
    if (!wasOn || moved > R * R * 0.25) {
      for (let i = 0; i < want; i++) place(i, near[Math.floor(rnd() * near.length)]);
    } else {
      for (let i = active; i < want; i++) place(i, near[Math.floor(rnd() * near.length)]);
    }
    active = want;
    wasOn = true;
    const cx = camera.position.x;
    const cz = camera.position.z;
    const R2 = R * R;
    const RV2 = (R * 1.05) ** 2;
    let n = 0;
    for (let i = 0; i < active; i++) {
      if (dt > 0) step(i, dt);
      const p = locate(i);
      if ((p.x - fx) ** 2 + (p.z - fz) ** 2 > R2) {
        place(i, near[Math.floor(rnd() * near.length)]);
        continue;
      }
      if (n >= cap || (p.x - cx) ** 2 + (p.z - cz) ** 2 > RV2 * 1.6 || !inView(frustum, p.x, p.y + 0.2, p.z, 0.6)) continue;
      write(n++, p.x, p.y, p.z, p.hx, p.hz, SC[i], SH[i], PA[i], SK[i], PH[i], reducedMotion ? 0.4 : 1, CAD[i]);
    }
    shown = n;
    mesh.count = n;
    mesh.visible = n > 0;
    if (n) {
      for (const [a, k] of [
        [mesh.instanceMatrix, 16],
        [mesh.instanceColor, 3],
        [iAnim, 4],
        [iLook, 4],
      ]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * k);
        a.needsUpdate = true;
      }
    }
  }

  return {
    object: mesh,
    update,
    stats: { paths: list.length, max: cap, reducedMotion, trianglesEach: geo.attributes.position.count / 3 },
    get shown() {
      return shown;
    },
  };
}
