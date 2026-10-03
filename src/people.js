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
// the shoulder; seated figures fold their legs). Shirt, trousers, skin,
// height and build vary per person; two to four may walk as a group, and a
// few stop to look across the street (iteration 19). How many are out follows
// the hour (pedestrianDemand): busy at lunch and in the evening, nearly empty
// at 3 am, the São João night fuller still. Only within about 600 m of the
// point the camera looks at.
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

const SHIRTS = [0xf2efe8, 0x23324f, 0x1c1c1e, 0x9b2c2c, 0xc99a2e, 0x2f7f7a, 0x8b8f94, 0xc9b79a, 0x5c6b3a, 0x7fa6c9, 0x6b2737, 0xd78ca0, 0x3d6fb0, 0xe2d37a, 0x4b5563, 0xb5651d, 0x2f4f4f, 0xd9d9d9, 0x7b6a58, 0x4682b4, 0x8e5a9e, 0xcf6b3c].map((h) => new THREE.Color(h));
const PANTS = [0x2c3e5c, 0x1b1c1f, 0xb9a98a, 0x55585c, 0x4a3b2e, 0x3b4f70, 0x262a33, 0x2f3b46, 0x6b7280, 0x3d2b1f].map((h) => new THREE.Color(h));

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
  const wht = new Float32Array(NW); // height factor
  const wbd = new Float32Array(NW); // build / girth factor
  // small groups: a follower keeps its leader's lane and pace
  const wlead = new Int32Array(NW).fill(-1);
  const wgarc = new Float32Array(NW); // world units behind the leader
  const wglat = new Float32Array(NW); // lateral offset across the lane
  const wset = new Uint8Array(NW); // placed this gather
  // people who stop and look: pause timer, next look, head turn, side
  const wpause = new Uint8Array(NW);
  const wstop = new Float32Array(NW);
  const wnext = new Float32Array(NW);
  const wlook = new Float32Array(NW);
  const wside = new Float32Array(NW);
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
    wht[i] = 0.88 + rnd() * 0.24;
    wbd[i] = 0.84 + rnd() * 0.32;
  }
  // small groups: two to four people who walk together
  {
    let i = 0;
    while (i < NW) {
      const r = rnd();
      const gs = r < 0.52 ? 1 : r < 0.78 ? 2 : r < 0.92 ? 3 : 4;
      for (let j = 1; j < gs && i + j < NW; j++) {
        wlead[i + j] = i;
        wgarc[i + j] = j * (0.55 + rnd() * 0.9) * S;
        wglat[i + j] = (rnd() * 2 - 1) * 0.5 * S;
      }
      i += gs;
    }
  }
  const rrnd = lcg(77001); // runtime only: stops and looks

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
    const li = wlead[i];
    // a follower joins its leader: same lane, slightly behind, same pace
    if (li >= 0 && wset[li]) {
      const l = wl[li];
      wl[i] = l;
      wd[i] = wd[li];
      wv[i] = wv[li] * (0.97 + rnd() * 0.06);
      let s = ws[li] - wd[i] * (wgarc[i] / STEP);
      if (s < 0) s = 0;
      if (s > LN[l] - 1) s = LN[l] - 1;
      ws[i] = s;
      wf[i] = Math.max(-1, Math.min(1, wf[li] + wglat[i]));
      whop[i] = 0;
      wht[i] = 0.9 + rnd() * 0.2;
      wbd[i] = 0.86 + rnd() * 0.28;
      wshirt[i] = Math.floor(rnd() * SHIRTS.length);
      wpants[i] = Math.floor(rnd() * PANTS.length);
      wskin[i] = wskin[li];
      wsc[i] = 0.94 + rnd() * 0.12;
      wph[i] = rnd() * 6.283;
      wcad[i] = 0.88 + rnd() * 0.28;
      wpause[i] = 0;
      wstop[i] = 0;
      wlook[i] = 0;
      wnext[i] = 0;
      wset[i] = 1;
      return true;
    }
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
    wpause[i] = rnd() < 0.18 ? 1 : 0;
    wside[i] = rnd() < 0.5 ? 1 : -1;
    wstop[i] = 0;
    wlook[i] = 0;
    wnext[i] = 2 + rnd() * 18;
    wset[i] = 1;
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
    if (wpause[i]) {
      if (wstop[i] > 0) {
        // stopped to look: hold position, turn toward the side, hug the kerb
        wstop[i] -= dt;
        wlook[i] = Math.min(1, wlook[i] + dt * 0.8);
        wf[i] += (wside[i] * 0.7 - wf[i]) * Math.min(1, dt * 0.6);
        return;
      }
      wnext[i] -= dt;
      if (wlook[i] > 0) wlook[i] = Math.max(0, wlook[i] - dt * 0.6);
      if (wnext[i] <= 0) {
        wstop[i] = 1.5 + rrnd() * 4.5;
        wnext[i] = 9 + rrnd() * 20;
      }
    }
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
  const sHt = new Float32Array(NSP);
  const sBd = new Float32Array(NSP);
  for (let i = 0; i < NSP; i++) {
    sShirt[i] = Math.floor(rnd() * SHIRTS.length);
    sPants[i] = Math.floor(rnd() * PANTS.length);
    sSkin[i] = rnd() < 0.78 ? 0 : rnd() < 0.6 ? 1 : 2;
    sPh[i] = rnd() * 6.283;
    sSc[i] = 0.92 + rnd() * 0.16;
    sHt[i] = 0.88 + rnd() * 0.24;
    sBd[i] = 0.84 + rnd() * 0.32;
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
  function write(n, x, y, z, hx, hz, sc, ht, bd, shirt, pants, skin, ph, walk, sit, cad) {
    const o = n * 16;
    // +z of the figure along (hx, hz); height and build vary per person
    const rw = sc * bd;
    E[o] = hz * rw;
    E[o + 1] = 0;
    E[o + 2] = -hx * rw;
    E[o + 3] = 0;
    E[o + 4] = 0;
    E[o + 5] = sc * ht;
    E[o + 6] = 0;
    E[o + 7] = 0;
    E[o + 8] = hx * rw;
    E[o + 9] = 0;
    E[o + 10] = hz * rw;
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
      wset.fill(0);
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
      // a stopped pauser turns to look across the street
      let hx = p.hx;
      let hz = p.hz;
      if (wpause[i] && wlook[i] > 0.001) {
        const a = wlook[i] * 1.15 * wside[i];
        const c = Math.cos(a);
        const s = Math.sin(a);
        const nx = hx * c - hz * s;
        hz = hx * s + hz * c;
        hx = nx;
      }
      const walking = wpause[i] && wstop[i] > 0 ? 0 : 1;
      write(n++, p.x, p.y, p.z, hx, hz, wsc[i], wht[i], wbd[i], wshirt[i], wpants[i], wskin[i], wph[i], walking, 0, wcad[i]);
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
          write(n++, x, spots.y[i], z, Math.sin(yaw), Math.cos(yaw), sSc[i], sHt[i], sBd[i], sShirt[i], sPants[i], sSkin[i], sPh[i], 0, spots.sit[i], 1);
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
//
// Richer life (iteration 19):
//   - every person has their own height and build (and shirt / trousers /
//     skin / pace), so a crowd reads as people, not clones;
//   - some walk alone, two to four walk together as a small group that keeps
//     the leader's path and pace;
//   - a few stop now and then, step to the side and turn to look across the
//     promenade (the monument / river view);
//   - along the quay paths some sit on the wall / low benches, and small
//     queues wait at the path ends — the boarding points the tram poles
//     stand at.
// How many are out follows the hour (pedestrianDemand, thinned in rain);
// everything stands still under reduced motion (the caller passes dt = 0).
// paths: [{ x, z, y: Float32Array, half: world units, ped: bool,
//           name, district }]
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
  const rrnd = lcg(1301); // runtime only: stops and looks
  const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

  // ---- walkers -----------------------------------------------------
  const WALK_MAX = Math.max(1, Math.round(cap * 0.82));
  const P = new Int32Array(WALK_MAX); // path
  const SS = new Float32Array(WALK_MAX); // arc length along it
  const D = new Int8Array(WALK_MAX);
  const V = new Float32Array(WALK_MAX); // world units / s
  const F = new Float32Array(WALK_MAX); // lateral -1..1
  const PH = new Float32Array(WALK_MAX);
  const CAD = new Float32Array(WALK_MAX);
  const SH = new Uint8Array(WALK_MAX);
  const PA = new Uint8Array(WALK_MAX);
  const SK = new Uint8Array(WALK_MAX);
  const SC = new Float32Array(WALK_MAX);
  const HT = new Float32Array(WALK_MAX); // height factor
  const BD = new Float32Array(WALK_MAX); // build factor
  // small groups: a follower keeps its leader's path and pace
  const LEAD = new Int32Array(WALK_MAX).fill(-1);
  const GARC = new Float32Array(WALK_MAX); // world units behind the leader
  const GLAT = new Float32Array(WALK_MAX); // lateral offset across the path
  const WSET = new Uint8Array(WALK_MAX); // placed this gather
  // people who stop and look
  const PAUSER = new Uint8Array(WALK_MAX);
  const STOP = new Float32Array(WALK_MAX);
  const NEXT = new Float32Array(WALK_MAX);
  const LOOK = new Float32Array(WALK_MAX);
  const LSIDE = new Float32Array(WALK_MAX);
  {
    let i = 0;
    while (i < WALK_MAX) {
      const r = rnd();
      const gs = r < 0.52 ? 1 : r < 0.78 ? 2 : r < 0.92 ? 3 : 4;
      for (let j = 1; j < gs && i + j < WALK_MAX; j++) {
        LEAD[i + j] = i;
        GARC[i + j] = j * (0.55 + rnd() * 0.9) * S; // ~2-6 m behind
        GLAT[i + j] = (rnd() * 2 - 1) * 0.5 * S;
      }
      i += gs;
    }
  }

  const place = (i, pi) => {
    const li = LEAD[i];
    if (li >= 0 && WSET[li]) {
      P[i] = P[li];
      D[i] = D[li];
      V[i] = V[li] * (0.97 + rnd() * 0.06);
      SS[i] = SS[li] - D[li] * GARC[i];
      const t = total[P[i]];
      if (SS[i] < 0) SS[i] = 0;
      if (SS[i] > t) SS[i] = t;
      F[i] = clamp1(F[li] + GLAT[i]);
      PH[i] = rnd() * 6.283;
      SH[i] = Math.floor(rnd() * SHIRTS.length);
      PA[i] = Math.floor(rnd() * PANTS.length);
      SK[i] = SK[li];
      SC[i] = 0.94 + rnd() * 0.12;
      HT[i] = 0.9 + rnd() * 0.2;
      BD[i] = 0.86 + rnd() * 0.28;
      CAD[i] = 0.88 + rnd() * 0.28;
      PAUSER[i] = 0;
      STOP[i] = 0;
      LOOK[i] = 0;
      NEXT[i] = 0;
      WSET[i] = 1;
      return;
    }
    P[i] = pi;
    SS[i] = rnd() * total[pi];
    D[i] = rnd() < 0.5 ? 1 : -1;
    V[i] = (1.05 + rnd() * 0.55) * S;
    F[i] = rnd() * 2 - 1;
    PH[i] = rnd() * 6.283;
    SH[i] = Math.floor(rnd() * SHIRTS.length);
    PA[i] = Math.floor(rnd() * PANTS.length);
    SK[i] = rnd() < 0.78 ? 0 : rnd() < 0.6 ? 1 : 2;
    SC[i] = 0.92 + rnd() * 0.16;
    HT[i] = 0.88 + rnd() * 0.24;
    BD[i] = 0.84 + rnd() * 0.32;
    CAD[i] = 0.84 + rnd() * 0.32;
    PAUSER[i] = rnd() < 0.18 ? 1 : 0;
    LSIDE[i] = rnd() < 0.5 ? 1 : -1;
    STOP[i] = 0;
    LOOK[i] = 0;
    NEXT[i] = 2 + rnd() * 18;
    WSET[i] = 1;
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
    if (PAUSER[i]) {
      if (STOP[i] > 0) {
        // stopped to look: hold position, turn aside, drift to the edge
        STOP[i] -= dt;
        LOOK[i] = Math.min(1, LOOK[i] + dt * 0.8);
        F[i] += (LSIDE[i] * 0.72 - F[i]) * Math.min(1, dt * 0.6);
        return;
      }
      NEXT[i] -= dt;
      if (LOOK[i] > 0) LOOK[i] = Math.max(0, LOOK[i] - dt * 0.6);
      if (NEXT[i] <= 0) {
        STOP[i] = 1.5 + rrnd() * 4.5;
        NEXT[i] = 9 + rrnd() * 20;
      }
    }
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

  // ---- people who stay: sitters on the quay edges, queues at path ends
  const quayRe = /cais|ribeira|gaia|douro|miragaia|infante|foz|alf[âa]ndega/i;
  const RX = [];
  const RZ = [];
  const RY = [];
  const RYAW = [];
  const RSIT = [];
  const RPH = [];
  const RTH = []; // demand threshold: who is out now
  const RSH = [];
  const RPA = [];
  const RSK = [];
  const RSC = [];
  const RHT = [];
  const RBD = [];
  const addRest = (x, z, y, yaw, sit) => {
    RX.push(x);
    RZ.push(z);
    RY.push(y);
    RYAW.push(yaw);
    RSIT.push(sit);
    RPH.push(rnd() * 6.283);
    RTH.push(rnd() * 0.9);
    RSH.push(Math.floor(rnd() * SHIRTS.length));
    RPA.push(Math.floor(rnd() * PANTS.length));
    RSK.push(rnd() < 0.78 ? 0 : rnd() < 0.6 ? 1 : 2);
    RSC.push(0.92 + rnd() * 0.16);
    RHT.push(0.88 + rnd() * 0.24);
    RBD.push(0.84 + rnd() * 0.32);
  };
  for (let pi = 0; pi < list.length && RX.length < 900; pi++) {
    const p = list[pi];
    const n = p.x.length;
    if (n < 6) continue;
    const quay = p.district === 'ribeira' || p.district === 'cais-gaia' || quayRe.test(p.name || '');
    // sitters along the quay paths: one every few metres at the outer edge
    if (quay) {
      for (let k = 3; k < n - 3 && RX.length < 900; k += 6 + Math.floor(rnd() * 18)) {
        const ax = p.x[k];
        const az = p.z[k];
        let tx = p.x[k + 1] - p.x[k];
        let tz = p.z[k + 1] - p.z[k];
        const L = Math.hypot(tx, tz) || 1;
        tx /= L;
        tz /= L;
        const side = rnd() < 0.5 ? 1 : -1;
        const h = p.half * 0.92;
        const nx = -tz * side;
        const nz = tx * side;
        addRest(ax + nx * h, az + nz * h, p.y[k], Math.atan2(nx, nz), 1);
      }
    }
    // queues at the path ends (the boarding points / tram poles)
    if (rnd() < 0.5) continue;
    for (const end of [0, 1]) {
      if (RX.length >= 900) break;
      const k = end ? n - 1 : 0;
      const o = end ? n - 2 : 1;
      let tx = p.x[k] - p.x[o];
      let tz = p.z[k] - p.z[o];
      const L = Math.hypot(tx, tz) || 1;
      tx /= L;
      tz /= L;
      const nx = -tz;
      const nz = tx;
      const yaw = Math.atan2(tx, tz);
      const m = 2 + Math.floor(rnd() * 3);
      for (let j = 0; j < m && RX.length < 900; j++) {
        const lat = (j - (m - 1) / 2) * 0.45 * S;
        const back = (j % 2) * 0.5 * S;
        addRest(p.x[k] - tx * (0.6 + back) * S + nx * lat, p.z[k] - tz * (0.6 + back) * S + nz * lat, p.y[k], yaw, 0);
      }
    }
  }
  const RCELL = 16;
  const restCells = new Map();
  for (let i = 0; i < RX.length; i++) {
    const key = Math.floor(RX[i] / RCELL) * 65536 + Math.floor(RZ[i] / RCELL);
    let c = restCells.get(key);
    if (!c) restCells.set(key, (c = []));
    c.push(i);
  }
  const REST_N = RX.length;

  const E = mesh.instanceMatrix.array;
  const C = mesh.instanceColor.array;
  const IA = iAnim.array;
  const IL = iLook.array;
  function write(n, x, y, z, hx, hz, sc, ht, bd, shirt, pants, skin, ph, walk, sit, cad) {
    const o = n * 16;
    const rw = sc * bd;
    E[o] = hz * rw;
    E[o + 1] = 0;
    E[o + 2] = -hx * rw;
    E[o + 3] = 0;
    E[o + 4] = 0;
    E[o + 5] = sc * ht;
    E[o + 6] = 0;
    E[o + 7] = 0;
    E[o + 8] = hx * rw;
    E[o + 9] = 0;
    E[o + 10] = hz * rw;
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

  let active = 0;
  let shown = 0;
  let shownWalkers = 0;
  let shownStaying = 0;
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
    const want = Math.min(WALK_MAX, Math.max(0, Math.round((WALK_MAX * demand) / DEMAND_MAX)));
    const reall = !wasOn || moved > R * R * 0.25;
    if (reall) WSET.fill(0);
    for (let i = 0; i < want; i++) if (reall || !WSET[i]) place(i, near[Math.floor(rnd() * near.length)]);
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
      if ((p.x - fx) ** 2 + (p.z - fz) ** 2 > R2) {
        place(i, near[Math.floor(rnd() * near.length)]);
        continue;
      }
      if (n >= cap || (p.x - cx) ** 2 + (p.z - cz) ** 2 > RV2 * 1.6 || !inView(frustum, p.x, p.y + 0.2, p.z, 0.6)) continue;
      // a stopped pauser turns to look across the promenade
      let hx = p.hx;
      let hz = p.hz;
      if (PAUSER[i] && LOOK[i] > 0.001) {
        const a = LOOK[i] * 1.15 * LSIDE[i];
        const c = Math.cos(a);
        const s = Math.sin(a);
        const nx = hx * c - hz * s;
        hz = hx * s + hz * c;
        hx = nx;
      }
      const walking = reducedMotion || (PAUSER[i] && STOP[i] > 0) ? 0 : 1;
      write(n++, p.x, p.y, p.z, hx, hz, SC[i], HT[i], BD[i], SH[i], PA[i], SK[i], PH[i], walking, 0, CAD[i]);
      shownWalkers++;
    }
    // the people who stay: sitters on the quay, queues at the ends
    shownStaying = 0;
    const share = demand / DEMAND_MAX;
    for (let gx = Math.floor((fx - R) / RCELL); gx <= Math.floor((fx + R) / RCELL) && n < cap; gx++) {
      for (let gz = Math.floor((fz - R) / RCELL); gz <= Math.floor((fz + R) / RCELL) && n < cap; gz++) {
        const c = restCells.get(gx * 65536 + gz);
        if (!c) continue;
        for (const i of c) {
          if (n >= cap) break;
          const x = RX[i];
          const z = RZ[i];
          if ((x - fx) ** 2 + (z - fz) ** 2 > R2) continue;
          if (RTH[i] > share * 1.1) continue;
          if (!inView(frustum, x, RY[i] + 0.2, z, 0.6)) continue;
          const yaw = RYAW[i];
          write(n++, x, RY[i], z, Math.sin(yaw), Math.cos(yaw), RSC[i], RHT[i], RBD[i], RSH[i], RPA[i], RSK[i], RPH[i], 0, RSIT[i], 1);
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
  }

  return {
    object: mesh,
    update,
    stats: {
      paths: list.length,
      max: cap,
      walkers: WALK_MAX,
      rest: REST_N,
      reducedMotion,
      trianglesEach: geo.attributes.position.count / 3,
    },
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
