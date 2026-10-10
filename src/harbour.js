// The coast and the harbour structures, from the real OSM data
// (data/coast.json, scripts/fetch-coast.mjs; the sea itself is src/coast.js).
//
//   apron      one ribbon along the whole coast, between the sea and the ground:
//              sand strips (OSM natural=beach|sand), rock (bare_rock), a granite
//              sea wall with a promenade in the town, a low bank elsewhere. It
//              covers the coarse DEM, which meets the sea at one level and gave a
//              straight green cut. 8 m samples in the core, 24 m outside it.
//   mounds     breakwaters and moles as the OSM plan (rubble-mound slope up to a
//              crown 3-8.5 m over the sea), rock outcrops and islets, quays as
//              vertical-sided blocks.
//   armour     concrete cubes (Leixoes) and tetrapods (the Foz moles) on the
//              seaward slope, instanced in 500 m chunks that a THREE.LOD drops
//              beyond 1.5 km; only on the M class and above.
//   piers      piers, jetties and floating pontoons as decks (not the ones the
//              Douro quay layer already draws).
//   lights     every lighthouse and harbour light in the file, one shared
//              builder (a tapered tower, gallery, lantern; a small beacon post).
//              Felgueiras and Leca belong to their landmark models: skipped.
//
// Everything stands on the level of the sea mesh (seaState().y). One merged mesh
// per ~1 km cell and one material, so the draw calls stay low.
import * as THREE from 'three';
import { dataPath, hasData } from './city.js';
import { assetUrl } from './data.js';
import { seaState, distanceField } from './coast.js';

let coastDoc;
export async function loadCoast() {
  if (coastDoc !== undefined) return coastDoc;
  coastDoc = null;
  if (!hasData('coast.json')) return null;
  try {
    const res = await fetch(assetUrl(dataPath('coast.json')));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!(res.headers.get('content-type') || '').includes('json')) throw new Error('not JSON');
    const doc = JSON.parse(await res.text());
    if (!Array.isArray(doc?.sea)) throw new Error('no sea[]');
    coastDoc = doc;
  } catch (e) {
    console.info(`[porto] ${dataPath('coast.json')} unavailable (${e.message}); no harbour structures.`);
  }
  return coastDoc;
}

// ------------------------------------------------------------ small helpers
const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const rgb = (hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const C = {
  wetSand: rgb(0x8d8068),
  sand: rgb(0xd0bf94),
  dune: rgb(0xb3a67c),
  rockDark: rgb(0x58544d),
  rock: rgb(0x7b7569),
  rockDry: rgb(0x938c7e),
  wall: rgb(0x6c685f),
  wallWet: rgb(0x433f38),
  weed: rgb(0x3f4a3c),
  coping: rgb(0xa8a399),
  deck: rgb(0x8c877d),
  bank: rgb(0x6f6c57),
  bankWet: rgb(0x4d4a3c),
  granite: rgb(0x726d64),
  graniteDark: rgb(0x55514a),
  cap: rgb(0x9a978f),
  pier: rgb(0x9d988d),
  timber: rgb(0x7d6547),
  white: rgb(0xe9e6dc),
  red: rgb(0xa8281f),
  green: rgb(0x2e7d49),
  black: rgb(0x2a2a2d),
};

class Buf {
  constructor() {
    this.pos = [];
    this.col = [];
    this.uv = [];
    this.idx = [];
  }
  v(x, y, z, c) {
    this.pos.push(x, y, z);
    this.col.push(c[0], c[1], c[2]);
    this.uv.push(x * UVK, z * UVK);
    return this.pos.length / 3 - 1;
  }
  // a triangle, wound so its normal faces the hint direction
  facing(a, b, c, hx, hy, hz) {
    const P = this.pos;
    const ax = P[a * 3];
    const ay = P[a * 3 + 1];
    const az = P[a * 3 + 2];
    const ux = P[b * 3] - ax;
    const uy = P[b * 3 + 1] - ay;
    const uz = P[b * 3 + 2] - az;
    const vx = P[c * 3] - ax;
    const vy = P[c * 3 + 1] - ay;
    const vz = P[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-14) return;
    if (nx * hx + ny * hy + nz * hz < 0) this.idx.push(a, c, b);
    else this.idx.push(a, b, c);
  }
  quad(a, b, c, d, hx, hy, hz) {
    this.facing(a, b, c, hx, hy, hz);
    this.facing(a, c, d, hx, hy, hz);
  }
  get tris() {
    return this.idx.length / 3;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

let UVK = 1 / 3; // set per build: one texture tile = 12 m

// a speckled grey value texture (granite, sand grain): multiplies the vertex colour
function noiseTexture() {
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  const cell = (x, y, o) => hash(((x + N) % N) * 7.13 + ((y + N) % N) * 91.7 + o);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const gx = x / 8;
      const gy = y / 8;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = gx - x0;
      const fy = gy - y0;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const lo = cell(x0, y0, 0) * (1 - sx) + cell(x0 + 1, y0, 0) * sx;
      const hi = cell(x0, y0 + 1, 0) * (1 - sx) + cell(x0 + 1, y0 + 1, 0) * sx;
      const low = lo * (1 - sy) + hi * sy; // blotches
      const fine = hash(x * 3.7 + y * 53.1); // grain
      const v = 0.74 + 0.16 * low + 0.1 * fine - (fine > 0.93 ? 0.12 : 0);
      const b = Math.max(0, Math.min(255, Math.round(v * 255)));
      const i = (y * N + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---- rings and lines of {x, z}
const signedArea = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j].x * r[i].z - r[i].x * r[j].z;
  return a / 2;
};
const pip = (x, z, r) => {
  let ins = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i];
    const b = r[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) ins = !ins;
  }
  return ins;
};
const bboxOf = (r) => {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const p of r) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.z < z0) z0 = p.z;
    if (p.z > z1) z1 = p.z;
  }
  return { x0, z0, x1, z1 };
};
// membership test over many rings, bounding boxes first
function ringSet(rings) {
  const items = rings.map((r) => ({ r, b: bboxOf(r) }));
  return {
    contains(x, z) {
      for (const it of items) if (x >= it.b.x0 && x <= it.b.x1 && z >= it.b.z0 && z <= it.b.z1 && pip(x, z, it.r)) return true;
      return false;
    },
  };
}
// resample a closed ring so that no edge is longer than maxEdge
function resampleRing(r, maxEdge) {
  const out = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / maxEdge));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  return out;
}
// outward unit normals per vertex of a closed ring
function outwardNormals(r) {
  const sgn = signedArea(r) > 0 ? 1 : -1; // > 0: counter-clockwise in (x, z) as drawn with z up: outside on the right
  return r.map((p, i) => {
    const a = r[(i + r.length - 1) % r.length];
    const b = r[(i + 1) % r.length];
    let tx = b.x - a.x;
    let tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    return { x: tz * sgn, z: -tx * sgn };
  });
}
// the ring moved by d along its mitred outward normals (d < 0: inward); the miter is capped
function offsetRing(r, d) {
  const sgn = signedArea(r) > 0 ? 1 : -1;
  return r.map((p, i) => {
    const a = r[(i + r.length - 1) % r.length];
    const b = r[(i + 1) % r.length];
    const e = (u, v) => {
      let tx = v.x - u.x;
      let tz = v.z - u.z;
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      return { x: tz * sgn, z: -tx * sgn };
    };
    const n1 = e(a, p);
    const n2 = e(p, b);
    const k = 1 + n1.x * n2.x + n1.z * n2.z;
    let mx = (n1.x + n2.x) / Math.max(0.35, k);
    let mz = (n1.z + n2.z) / Math.max(0.35, k);
    const ml = Math.hypot(mx, mz);
    if (ml > 2.2) {
      mx = (mx / ml) * 2.2;
      mz = (mz / ml) * 2.2;
    }
    return { x: p.x + mx * d, z: p.z + mz * d };
  });
}
// width across the ring's principal axis, the short side of its extent (same unit as the points)
function shortSide(r) {
  let mx = 0;
  let mz = 0;
  for (const p of r) {
    mx += p.x;
    mz += p.z;
  }
  mx /= r.length;
  mz /= r.length;
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  for (const p of r) {
    sxx += (p.x - mx) ** 2;
    sxz += (p.x - mx) * (p.z - mz);
    szz += (p.z - mz) ** 2;
  }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of r) {
    const v = -(p.x - mx) * s + (p.z - mz) * c;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi - lo;
}
const centroidOf = (r) => {
  let x = 0;
  let z = 0;
  for (const p of r) {
    x += p.x;
    z += p.z;
  }
  return { x: x / r.length, z: z / r.length };
};

// ------------------------------------------------------------ the build
// ctx: { doc, project, heightAt, S, detail (1 or 2), mobile, core: {x0,z0,x1,z1} world rect of the city core,
//        quayLines: quays.json lines (metres east / north of the origin), skip: [{ x, z, r }] world units,
//        skipIds: OSM ids not drawn (a landmark model owns them) }
export function buildHarbour(ctx) {
  const { doc, project, heightAt, S } = ctx;
  const sea = seaState();
  if (!doc || !sea) return null;
  const detail = ctx.detail ?? 2;
  const M = (m) => m * S;
  const seaY = sea.y;
  UVK = 1 / M(12);
  const skip = ctx.skip || [];
  const skipIds = new Set(ctx.skipIds || []);
  const skipped = (x, z, extra = 0) => skip.some((s) => Math.hypot(x - s.x, z - s.z) < s.r + extra);
  const proj = (ll) => ll.map(([lat, lon]) => project(lat, lon));
  const stats = { apronSamples: 0, apron: 0, mounds: 0, rocks: 0, quays: 0, piers: 0, lights: 0, armour: 0, tris: { apron: 0, mounds: 0, piers: 0, lights: 0, armour: 0 } };

  // geometry cells (~1 km), one merged mesh each
  const CELL = M(1000);
  const cells = new Map();
  const bufAt = (x, z) => {
    const k = `${Math.floor(x / CELL)}_${Math.floor(z / CELL)}`;
    let b = cells.get(k);
    if (!b) cells.set(k, (b = new Buf()));
    return b;
  };
  const lampBuf = new Buf(); // emissive lanterns
  const trisNow = () => {
    let s = 0;
    for (const b of cells.values()) s += b.tris;
    return s;
  };

  const seaRing = sea.ring;
  const inSea = (x, z) => pip(x, z, seaRing);
  const coastBox = bboxOf(seaRing);
  const eps = 0.01;
  const onFrame = (a, b) =>
    (Math.abs(a.x - coastBox.x0) < eps && Math.abs(b.x - coastBox.x0) < eps) ||
    (Math.abs(a.x - coastBox.x1) < eps && Math.abs(b.x - coastBox.x1) < eps) ||
    (Math.abs(a.z - coastBox.z0) < eps && Math.abs(b.z - coastBox.z0) < eps) ||
    (Math.abs(a.z - coastBox.z1) < eps && Math.abs(b.z - coastBox.z1) < eps);

  // coast chains: runs of ring edges that are not on the bbox frame
  const chains = [];
  {
    const n = seaRing.length;
    let cur = null;
    // start right after a frame edge so a chain is never split by the ring's first vertex
    let start = 0;
    for (let i = 0; i < n; i++) if (onFrame(seaRing[i], seaRing[(i + 1) % n])) start = (i + 1) % n;
    for (let k = 0; k < n; k++) {
      const a = seaRing[(start + k) % n];
      const b = seaRing[(start + k + 1) % n];
      if (onFrame(a, b)) {
        if (cur && cur.length > 1) chains.push(cur);
        cur = null;
      } else {
        if (!cur) cur = [a];
        cur.push(b);
      }
    }
    if (cur && cur.length > 1) chains.push(cur);
  }
  const seaSign = signedArea(seaRing) > 0 ? 1 : -1; // interior (the sea) is on the left of the direction when > 0
  const coastDist = distanceField(chains, { open: true });
  // every shore the apron runs along: the sea's coast and the edges of the harbour basins
  // (a basin edge is a quay wall; where it meets the sea it is a closing line: no shore)
  const shores = chains.map((pts) => ({ pts, sign: seaSign, basin: false }));
  for (const b of doc.basins || []) {
    const ring = proj(b.r);
    if (ring.length < 4) continue;
    shores.push({ pts: [...ring, ring[0]], sign: signedArea(ring) > 0 ? 1 : -1, basin: true });
  }

  // OSM polygons in world units
  const beaches = (doc.beaches || []).map((b) => proj(b.r));
  const rocksAll = (doc.rocks || []).map((b) => ({ id: b.id, r: proj(b.r) }));
  const beachSet = ringSet(beaches);
  const rockRings = rocksAll.map((o) => o.r);
  const rockSet = ringSet(rockRings);
  const rockDist = rockRings.length ? distanceField(rockRings) : () => Infinity;
  const quayLines = (ctx.quayLines || []).map((l) => l.map(([mx, my]) => ({ x: mx * S, z: -my * S })));
  const quayDist = quayLines.length ? distanceField(quayLines, { open: true }) : () => Infinity;
  // the other water (the Douro estuary, harbour basins): a coast edge with water behind it is a
  // closing line, not a shore
  const waterSet = ringSet(ctx.waterRings || []);
  const core = ctx.core;
  const inCore = (x, z) => !core || (x >= core.x0 && x <= core.x1 && z >= core.z0 && z <= core.z1);

  // ---------------------------------------------------------------- apron
  {
    const CLASS = {
      sand: { endMin: 1.2, rows: [[-1.6, -0.75, 'wetSand'], [0, 0.04, 'wetSand'], [1.6, 0.14, 'wetSand'], [5, 0.5, 'sand'], [14, 0.95, 'sand']] },
      rock: { endMin: 2.2, rows: [[-2.2, -1.3, 'rockDark'], [0, 0.45, 'rockDark'], [2.6, 1.3, 'rock'], [7, 1.9, 'rock']] },
      wall: { endMin: 0, rows: [[0, -0.9, 'wallWet'], [0, -0.1, 'weed'], [0, 2.1, 'wall'], [0, 2.4, 'coping'], [0.8, 2.4, 'coping']] },
      bank: { endMin: 1.0, rows: [[-1.2, -0.55, 'bankWet'], [0, 0.28, 'bankWet'], [3.5, 0.75, 'bank']] },
    };
    const WIDTH = { rock: 14, wall: 6.5, bank: 10 };
    const colOf = (key, h) => {
      const base = C[key] || C.bank;
      return shade(base, 0.9 + h * 0.2);
    };
    for (const shore of shores) {
      const chain = shore.pts;
      // resample the chain
      const pts = [];
      let carry = 0;
      for (let i = 0; i + 1 < chain.length; i++) {
        const a = chain[i];
        const b = chain[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        let t = carry;
        while (t < len) {
          const x = a.x + ((b.x - a.x) * t) / len;
          const z = a.z + ((b.z - a.z) * t) / len;
          pts.push({ x, z });
          t += inCore(x, z) ? M(8) : M(24);
        }
        carry = t - len;
      }
      pts.push(chain[chain.length - 1]);
      if (pts.length < 3) continue;
      const n = pts.length;
      const smoothH = new Float32Array(n);
      // per sample: land normal, class, width, rows
      const samples = [];
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(n - 1, i + 1)];
        let tx = b.x - a.x;
        let tz = b.z - a.z;
        const l = Math.hypot(tx, tz) || 1;
        tx /= l;
        tz /= l;
        // the water is on the left of the direction when the sign > 0: left = (-tz, tx)
        const Lx = shore.sign * tz; // the land normal = minus the water normal
        const Lz = -shore.sign * tx;
        const p = pts[i];
        if (skipped(p.x, p.z) || (shore.basin && coastDist(p.x, p.z, M(70)) < M(70))) {
          samples.push(null);
          continue;
        }
        const qx = p.x + Lx * M(4);
        const qz = p.z + Lz * M(4);
        if (waterSet.contains(qx, qz) || waterSet.contains(p.x + Lx * M(12), p.z + Lz * M(12))) {
          samples.push(null);
          continue;
        }
        let cls = 'bank';
        if (shore.basin) cls = 'wall';
        else if (beachSet.contains(qx, qz) || beachSet.contains(p.x + Lx * M(1), p.z + Lz * M(1))) cls = 'sand';
        else if (rockSet.contains(qx, qz) || rockDist(p.x, p.z, M(10)) < M(6)) cls = 'rock';
        else if (inCore(p.x, p.z) && quayDist(p.x, p.z, M(14)) > M(10)) cls = 'wall';
        let W = WIDTH[cls];
        if (cls === 'sand') {
          let d = 4;
          while (d < 90 && beachSet.contains(p.x + Lx * M(d), p.z + Lz * M(d))) d += 4;
          W = Math.max(14, Math.min(90, d + 4));
        }
        samples.push({ p, Lx, Lz, cls, W });
      }
      // smooth the end heights along the chain
      const hEnd = samples.map((s) => (s ? heightAt(s.p.x + s.Lx * M(s.W), s.p.z + s.Lz * M(s.W)) : 0));
      for (let i = 0; i < n; i++) {
        let a = 0;
        let k = 0;
        for (let j = -1; j <= 1; j++) {
          const q = hEnd[i + j];
          if (q !== undefined && samples[i + j]) {
            a += q;
            k++;
          }
        }
        smoothH[i] = k ? a / k : hEnd[i];
      }
      // rows per sample
      const rowsOf = samples.map((s, i) => {
        if (!s) return null;
        const cl = CLASS[s.cls];
        const hs = smoothH[i];
        const endY = Math.max(hs, seaY + M(s.cls === 'wall' ? 2.4 : cl.endMin)) - 0.02;
        const rows = cl.rows.map(([d, y, key]) => ({ d, y: seaY + M(y), key }));
        const last = rows[rows.length - 1];
        // inland end: the class width, then a dive under the ground
        const endD = s.cls === 'wall' ? s.W : s.W;
        const endKey = s.cls === 'sand' ? 'dune' : s.cls === 'rock' ? 'rockDry' : s.cls === 'wall' ? 'deck' : 'bank';
        if (s.cls === 'wall') {
          rows.push({ d: endD, y: last.y, key: 'deck' }, { d: endD + 0.4, y: Math.min(last.y, hs) - M(0.5), key: 'wall' });
        } else {
          rows.push({ d: endD, y: endY, key: endKey }, { d: endD + 1.2, y: hs - 0.3, key: endKey });
        }
        return rows;
      });
      // vertices and quads
      const vtx = samples.map((s, i) => {
        const rows = rowsOf[i];
        if (!rows) return null;
        const buf = bufAt(s.p.x, s.p.z);
        const j = hash(i * 1.3 + chain[0].x * 0.01);
        const ids = rows.map((r) => {
          const x = s.p.x + s.Lx * M(r.d);
          const z = s.p.z + s.Lz * M(r.d);
          const jitter = s.cls === 'rock' ? (hash(i * 7.7 + r.d * 3.1 + 5) - 0.5) * M(0.7) : 0;
          return buf.v(x, r.y + jitter, z, colOf(r.key, hash(i * 3.1 + r.d + j)));
        });
        return { buf, ids, rows, s };
      });
      for (let i = 0; i + 1 < n; i++) {
        const A = vtx[i];
        const B = vtx[i + 1];
        if (!A || !B || A.buf !== B.buf) continue;
        if (Math.hypot(A.s.p.x - B.s.p.x, A.s.p.z - B.s.p.z) > M(40)) continue;
        const m = Math.min(A.ids.length, B.ids.length);
        for (let r = 0; r + 1 < m; r++) {
          const r0 = A.rows[r];
          const r1 = A.rows[r + 1];
          const dd = r1.d - r0.d;
          // the face looks up and seaward: in (inland, up) the normal of a step (dd, dy) is (-dy, dd)
          const dy = r1.y - r0.y;
          A.buf.quad(A.ids[r], B.ids[r], B.ids[r + 1], A.ids[r + 1], -dy * A.s.Lx, dd, -dy * A.s.Lz);
        }
        stats.apronSamples++;
      }
    }
  }

  stats.tris.apron = trisNow();
  // ---------------------------------------------------------------- mounds
  // a rubble mound or a block from a plan ring (world units)
  const mound = (ring, o) => {
    const R = resampleRing(ring, M(o.maxEdge ?? 11));
    if (R.length < 3) return;
    const w = shortSide(R);
    const c = centroidOf(R);
    const buf = bufAt(c.x, c.z);
    const d = o.vertical ? 0 : Math.min(M(o.maxInset ?? 3.2), w * 0.3);
    const crown = d > 0 ? offsetRing(R, -d) : R;
    const n = R.length;
    const outn = outwardNormals(R);
    const midIds = [];
    const crownIds = [];
    for (let i = 0; i < n; i++) {
      const j1 = hash(o.seed + i * 1.7) - 0.5;
      const j2 = hash(o.seed + i * 2.9 + 40) - 0.5;
      const j3 = hash(o.seed + i * 4.1 + 80);
      const jy = o.vertical ? 0 : M(o.jitter ?? 0.55) * j2;
      const jx = o.vertical ? 0 : M(0.5) * j1;
      const dark = o.colDark ?? C.graniteDark;
      const lite = o.col ?? C.granite;
      const cc = shade(mix(dark, lite, j3), 0.88 + 0.22 * hash(o.seed + i * 5.3));
      midIds.push(buf.v(R[i].x + outn[i].x * jx, o.y0 + jy * 0.4, R[i].z + outn[i].z * jx, cc));
      const cap = o.capCol ?? cc;
      crownIds.push(buf.v(crown[i].x, o.crownY + jy, crown[i].z, o.vertical ? cap : shade(cap, 1.0)));
    }
    for (let i = 0; i < n; i++) {
      const k = (i + 1) % n;
      const o1 = outn[i];
      if (o.vertical) {
        // a block: every face has its own vertices, so the corners stay hard
        const dup = (id) => buf.v(buf.pos[id * 3], buf.pos[id * 3 + 1], buf.pos[id * 3 + 2], [buf.col[id * 3], buf.col[id * 3 + 1], buf.col[id * 3 + 2]]);
        buf.quad(dup(midIds[i]), dup(midIds[k]), dup(crownIds[k]), dup(crownIds[i]), o1.x, 0, o1.z);
      } else buf.quad(midIds[i], midIds[k], crownIds[k], crownIds[i], o1.x, 0.7, o1.z);
    }
    // the cap; an outcrop gets a second, higher ring so that it is not a flat disc
    // (a blob that contains its own centroid is a fan to a peak, not a flat disc)
    // (the cap has its own vertices: a hard edge to the slope, not a rounded one)
    const capIds = crownIds.map((id) => buf.v(buf.pos[id * 3], buf.pos[id * 3 + 1], buf.pos[id * 3 + 2], [buf.col[id * 3], buf.col[id * 3 + 1], buf.col[id * 3 + 2]]));
    const cen = centroidOf(crown);
    if (o.ridge && d > 0 && pip(cen.x, cen.z, crown)) {
      const peak = buf.v(cen.x, o.crownY + M(o.ridge) * (0.7 + 0.6 * hash(o.seed + 17)), cen.z, shade(o.capCol ?? C.rock, 1.1));
      for (let i = 0; i < n; i++) buf.facing(capIds[i], capIds[(i + 1) % n], peak, 0, 1, 0);
    } else {
      const contour = crown.map((p) => new THREE.Vector2(p.x, p.z));
      try {
        const faces = THREE.ShapeUtils.triangulateShape(contour, []);
        for (const f of faces) buf.facing(capIds[f[0]], capIds[f[1]], capIds[f[2]], 0, 1, 0);
      } catch {
        /* a sliver ring: no cap */
      }
    }
    stats.mounds++;
    return { ring: R, normals: outn, d, w, crownY: o.crownY, y0: o.y0 };
  };
  const placed = []; // mounds that carry armour or lights: { ring, crownY, cx, cz, id, w, kind }

  const crownH = (wM) => Math.max(3.0, Math.min(8.5, 2.6 + 0.2 * wM));
  // breakwaters and moles
  for (const wl of doc.walls || []) {
    if (skipIds.has(wl.id)) continue;
    const ring = proj(wl.p);
    if (ring.length < 4) continue;
    const r0 = ring[0];
    const rl = ring[ring.length - 1];
    const poly = Math.hypot(r0.x - rl.x, r0.z - rl.z) < M(0.5) ? ring.slice(0, -1) : ring;
    const c = centroidOf(poly);
    if (skipped(c.x, c.z, M(60))) continue;
    const w = shortSide(poly) / S;
    if (w < 3) continue;
    const hC = wl.ele ? Math.min(9, wl.ele) : crownH(w);
    const m = mound(poly, { y0: seaY + M(0.1), baseY: seaY - M(1.5), crownY: seaY + M(hC), seed: parseInt(wl.id.slice(1), 10) % 9973, jitter: 0.5, capCol: C.cap, maxInset: 3.2 });
    if (m) placed.push({ ...m, id: wl.id, cx: c.x, cz: c.z, kind: 'wall', lat: wl.p[0][0] });
  }
  // rock outcrops and islets
  const rockTargets = [...(doc.rocks || []).map((r) => ({ id: r.id, r: proj(r.r) })), ...(doc.holes || []).map((r, i) => ({ id: `islet${i}`, r: proj(r) }))];
  for (const rk of rockTargets) {
    const poly = rk.r[0] && rk.r.length > 3 && Math.hypot(rk.r[0].x - rk.r.at(-1).x, rk.r[0].z - rk.r.at(-1).z) < M(0.5) ? rk.r.slice(0, -1) : rk.r;
    if (poly.length < 3) continue;
    const c = centroidOf(poly);
    if (skipped(c.x, c.z, M(40))) continue;
    // an outcrop that matters stands at the coast (within 60 m, or in the sea) and not on high ground
    if (!inSea(c.x, c.z) && coastDist(c.x, c.z, M(60)) >= M(60)) continue;
    if (heightAt(c.x, c.z) - seaY > M(3)) continue;
    const w = shortSide(poly) / S;
    if (w < 3) continue;
    const hC = 0.9 + 1.4 * hash(c.x * 3.1 + c.z) + Math.min(1.5, w * 0.03);
    mound(poly, { y0: seaY - M(0.2), baseY: seaY - M(1.5), crownY: seaY + M(hC), seed: Math.round(c.x * 10) % 9973, jitter: 0.9, col: C.rock, colDark: C.rockDark, capCol: C.rock, maxInset: 4, maxEdge: 7, ridge: 1.4 });
    stats.rocks++;
  }
  // piers: polygons are quay blocks, lines are decks
  const piers = [];
  for (const pr of doc.piers || []) {
    if (skipIds.has(pr.id)) continue;
    const pts = proj(pr.p);
    if (pts.length < 2) continue;
    const c = centroidOf(pts);
    if (skipped(c.x, c.z, M(30))) continue;
    // the Douro quay layer draws those walls
    if (quayLines.length && pts.every((q) => quayDist(q.x, q.z, M(14)) < M(12))) continue;
    // a pier that stands nowhere near the sea or the estuary is not ours
    const closed = pr.closed && pts.length > 3;
    if (closed) {
      const poly = pts.slice(0, -1);
      if (shortSide(poly) < M(2.5)) continue;
      mound(poly, { y0: seaY + M(0.1), baseY: seaY - M(2), crownY: seaY + M(2.3), seed: parseInt(pr.id.slice(1), 10) % 9973, vertical: true, col: C.pier, colDark: C.wall, capCol: C.pier, maxEdge: 14 });
      stats.quays++;
    } else {
      piers.push({ pr, pts });
    }
  }
  stats.tris.mounds = trisNow() - stats.tris.apron;
  // decks along lines
  for (const { pr, pts } of piers) {
    const floating = pr.floating || pr.k === 'jetty' || (pr.w && pr.w < 2.5);
    const wM = pr.w || (pr.k === 'quay' ? 3.2 : floating ? 1.8 : 3.6);
    const half = M(wM) / 2;
    const top = seaY + M(floating ? 0.45 : pr.k === 'quay' ? 2.2 : 1.5);
    const thick = M(floating ? 0.35 : 0.9);
    // resample to 5 m
    const line = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const k = Math.max(1, Math.ceil(len / M(5)));
      for (let q = 0; q < k; q++) line.push({ x: a.x + ((b.x - a.x) * q) / k, z: a.z + ((b.z - a.z) * q) / k });
    }
    line.push(pts[pts.length - 1]);
    if (line.length < 2) continue;
    // a quay line is a wall on the land side of the water: shift the deck inland of the line
    let shift = 0;
    if (pr.k === 'quay') {
      const mid = line[line.length >> 1];
      const nx = -(line.at(-1).z - line[0].z);
      const nz = line.at(-1).x - line[0].x;
      const nl = Math.hypot(nx, nz) || 1;
      const sx = nx / nl;
      const sz = nz / nl;
      const wet = inSea(mid.x + sx * M(4), mid.z + sz * M(4));
      const wet2 = inSea(mid.x - sx * M(4), mid.z - sz * M(4));
      if (wet === wet2) continue; // not at the sea: nothing to hold
      shift = wet ? -half : half;
      pr._side = { sx, sz };
    }
    const buf = bufAt(line[0].x, line[0].z);
    const colTop = floating ? C.timber : C.pier;
    const rowsL = [];
    const rowsR = [];
    for (let i = 0; i < line.length; i++) {
      const a = line[Math.max(0, i - 1)];
      const b = line[Math.min(line.length - 1, i + 1)];
      let tx = b.x - a.x;
      let tz = b.z - a.z;
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      const nx = -tz;
      const nz = tx;
      const cx = line[i].x + (pr._side ? pr._side.sx * shift : 0);
      const cz = line[i].z + (pr._side ? pr._side.sz * shift : 0);
      const sh = 0.9 + 0.2 * hash(i + pr.id.length * 3);
      rowsL.push({ x: cx + nx * half, z: cz + nz * half, nx, nz, sh });
      rowsR.push({ x: cx - nx * half, z: cz - nz * half, nx, nz, sh });
    }
    const vt = rowsL.map((L, i) => {
      const R = rowsR[i];
      return {
        tl: buf.v(L.x, top, L.z, shade(colTop, L.sh)),
        tr: buf.v(R.x, top, R.z, shade(colTop, L.sh)),
        bl: buf.v(L.x, top - thick, L.z, shade(C.wallWet, L.sh)),
        br: buf.v(R.x, top - thick, R.z, shade(C.wallWet, L.sh)),
        nx: L.nx,
        nz: L.nz,
      };
    });
    for (let i = 0; i + 1 < vt.length; i++) {
      const a = vt[i];
      const b = vt[i + 1];
      buf.quad(a.tl, b.tl, b.tr, a.tr, 0, 1, 0);
      buf.quad(a.tl, b.tl, b.bl, a.bl, a.nx, 0, a.nz);
      buf.quad(a.tr, b.tr, b.br, a.br, -a.nx, 0, -a.nz);
    }
    stats.piers++;
  }
  stats.tris.piers = trisNow() - stats.tris.apron - stats.tris.mounds;

  // ---------------------------------------------------------------- lights
  const lanternMat = new THREE.MeshStandardMaterial({ color: 0x2a1a08, emissive: 0xffc566, emissiveIntensity: 0.9, roughness: 0.4 });
  const crownAt = (x, z) => {
    for (const m of placed) if (Math.abs(x - m.cx) < M(400) && Math.abs(z - m.cz) < M(400) && pip(x, z, m.ring)) return m.crownY;
    return null;
  };
  const prism = (buf, cx, cz, y0, y1, r0, r1, sides, col, colTop, rot = 0) => {
    const lo = [];
    const hi = [];
    for (let k = 0; k < sides; k++) {
      const a = rot + (k / sides) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      lo.push(buf.v(cx + ca * r0, y0, cz + sa * r0, col));
      hi.push(buf.v(cx + ca * r1, y1, cz + sa * r1, colTop || col));
    }
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      const am = rot + ((k + 0.5) / sides) * Math.PI * 2;
      buf.quad(lo[k], lo[k2], hi[k2], hi[k], Math.cos(am), 0.05, Math.sin(am));
    }
    return { lo, hi };
  };
  const cone = (buf, cx, cz, y0, y1, r, sides, col) => {
    const ring = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      ring.push(buf.v(cx + Math.cos(a) * r, y0, cz + Math.sin(a) * r, col));
    }
    const apex = buf.v(cx, y1, cz, col);
    for (let k = 0; k < sides; k++) {
      const am = ((k + 0.5) / sides) * Math.PI * 2;
      buf.facing(ring[k], ring[(k + 1) % sides], apex, Math.cos(am), 0.6, Math.sin(am));
    }
  };
  const disc = (buf, cx, cz, y, r, thick, sides, col) => {
    const t = prism(buf, cx, cz, y - thick, y, r, r, sides, col);
    const top = t.hi.map((i) => i);
    for (let k = 1; k + 1 < sides; k++) buf.facing(top[0], top[k], top[k + 1], 0, 1, 0);
    return t;
  };
  // the shared lighthouse builder: a tapered tower with bands, gallery, lantern, cap
  function lighthouse(L, x, z, y0) {
    const buf = bufAt(x, z);
    const h = M(L.h);
    const named = /^farol(\s|$)/i.test(L.n || ''); // "Farol ..." is a tower, "Farolim ..." a small light
    const tower = L.h >= 13 || named;
    const seed = parseInt(L.id.slice(1), 10) % 997;
    if (tower) {
      const r0 = M(Math.max(1.1, Math.min(3.0, L.h * 0.12)));
      const r1 = r0 * 0.72;
      const sides = L.h > 20 ? 12 : 8;
      const plinthH = h * 0.06;
      prism(buf, x, z, y0 - M(0.6), y0 + plinthH, r0 * 1.35, r0 * 1.3, sides, C.granite);
      // body in 3 bands: white, red, white (a plain white tower when the id says so)
      const banded = hash(seed) > 0.45;
      const yb = [y0 + plinthH, y0 + h * 0.34, y0 + h * 0.62, y0 + h * 0.86];
      const rad = (f) => r0 + (r1 - r0) * f;
      for (let b = 0; b < 3; b++) {
        const f0 = (yb[b] - yb[0]) / (yb[3] - yb[0]);
        const f1 = (yb[b + 1] - yb[0]) / (yb[3] - yb[0]);
        prism(buf, x, z, yb[b], yb[b + 1], rad(f0), rad(f1), sides, banded && b === 1 ? C.red : C.white);
      }
      const yg = yb[3];
      disc(buf, x, z, yg + M(0.35), r1 * 1.55, M(0.35), sides, C.black);
      // lantern: a glass drum (emissive) and a red cap
      const lr = r1 * 0.85;
      const lh = h * 0.1;
      const ln = prism(lampBuf, x, z, yg + M(0.3), yg + M(0.3) + lh, lr, lr, 8, [1, 1, 1]);
      void ln;
      cone(buf, x, z, yg + M(0.3) + lh, yg + M(0.3) + lh + h * 0.09, lr * 1.2, 8, C.red);
    } else {
      // a beacon post: a white square-ish pillar, a red or green top by id
      const r0 = M(0.55);
      const cap = hash(seed + 3) > 0.5 ? C.red : C.green;
      prism(buf, x, z, y0 - M(0.4), y0 + M(0.7), r0 * 1.7, r0 * 1.6, 4, C.granite, undefined, Math.PI / 4);
      prism(buf, x, z, y0 + M(0.7), y0 + h * 0.8, r0, r0 * 0.75, 4, C.white, undefined, Math.PI / 4);
      prism(buf, x, z, y0 + h * 0.8, y0 + h, r0 * 1.25, r0 * 1.25, 4, cap, undefined, Math.PI / 4);
      prism(lampBuf, x, z, y0 + h * 0.86, y0 + h * 0.93, r0 * 1.3, r0 * 1.3, 4, [1, 1, 1], undefined, Math.PI / 4);
    }
    stats.lights++;
  }
  for (const L of doc.lights || []) {
    if (skipIds.has(L.id)) continue;
    const p = project(L.lat, L.lon);
    if (skipped(p.x, p.z)) continue;
    const named = L.n || '';
    const h = L.h || (/farolim/i.test(named) ? 9 : /farol/i.test(named) ? 14 : 8);
    // a light on a mole stands on its crown, on the shore on the ground, never under the sea
    const cr = crownAt(p.x, p.z);
    const y0 = cr ?? Math.max(heightAt(p.x, p.z), seaY + M(0.3));
    lighthouse({ ...L, h }, p.x, p.z, y0);
  }

  stats.tris.lights = trisNow() - stats.tris.apron - stats.tris.mounds - stats.tris.piers + lampBuf.tris;
  // ---------------------------------------------------------------- armour (instanced)
  const armourGroup = new THREE.Group();
  armourGroup.name = 'harbour-armour';
  if (detail >= 2) {
    const density = ctx.mobile ? 0.5 : 1;
    const cubeG = new THREE.BoxGeometry(1, 1, 1);
    const tetG = tetrapodGeometry();
    const armourMat = new THREE.MeshStandardMaterial({ color: 0xbab7ae, roughness: 0.92, metalness: 0 });
    const chunks = new Map();
    let total = 0;
    const budget = Math.round(2600 * density);
    // every unit the seaward slopes could carry, then an even thinning down to the budget
    const cand = [];
    for (const m of placed) {
      if (m.kind !== 'wall') continue;
      const wM = m.w / S;
      if (wM < 8) continue;
      const tetra = m.lat < 41.16; // the Foz moles: tetrapods; Leixoes: cubes
      const step = M((tetra ? 3.6 : 3.2) / density);
      const R = m.ring;
      const nrm = m.normals;
      let acc = 0;
      for (let i = 0; i < R.length; i++) {
        const a = R[i];
        const b = R[(i + 1) % R.length];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        let t = acc;
        while (t < len) {
          const f = t / len;
          const px = a.x + (b.x - a.x) * f;
          const pz = a.z + (b.z - a.z) * f;
          const nx = nrm[i].x;
          const nz = nrm[i].z;
          if (inSea(px + nx * M(8), pz + nz * M(8)) && !skipped(px, pz)) {
            // two rows on the slope: low (waterline) and high
            for (let row = 0; row < 2; row++) {
              const up = row === 0 ? 0.28 : 0.72;
              const inset = (m.d || M(2)) * (row === 0 ? 0.3 : 0.75);
              const ux = px - nx * inset + (hash(px * 7 + row) - 0.5) * M(0.8);
              const uz = pz - nz * inset + (hash(pz * 5 + row) - 0.5) * M(0.8);
              const uy = m.y0 + (m.crownY - m.y0) * up;
              cand.push({ tetra, ux, uy, uz, s: px * 0.31 + row });
            }
          }
          t += step;
        }
        acc = t - len;
      }
    }
    const keepP = Math.min(1, budget / Math.max(1, cand.length));
    cand.forEach((c, i) => {
      if (hash(i * 0.6180339 + 11) >= keepP) return;
      const key = `${Math.floor(c.ux / M(500))}_${Math.floor(c.uz / M(500))}`;
      let ch = chunks.get(key);
      if (!ch) chunks.set(key, (ch = { cx: (Math.floor(c.ux / M(500)) + 0.5) * M(500), cz: (Math.floor(c.uz / M(500)) + 0.5) * M(500), cubes: [], tets: [] }));
      (c.tetra ? ch.tets : ch.cubes).push([c.ux, c.uy, c.uz, c.s]);
      total++;
    });
    stats.armourCandidates = cand.length;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const col = new THREE.Color();
    const FAR = M(1500);
    const build = (geo, list, ch) => {
      if (!list.length) return null;
      const im = new THREE.InstancedMesh(geo, armourMat, list.length);
      list.forEach(([x, y, z, s], i) => {
        const u = M(2.5 + 0.7 * hash(s * 3.3 + i));
        e.set((hash(s + i) - 0.5) * 0.9, hash(s * 2.1 + i * 1.7) * 6.283, (hash(s * 5.7 + i) - 0.5) * 0.9);
        q.setFromEuler(e);
        sc.set(u, u, u);
        pos.set(x - ch.cx, y, z - ch.cz);
        m4.compose(pos, q, sc);
        im.setMatrixAt(i, m4);
        const g = 0.82 + 0.3 * hash(s * 9.1 + i * 0.37);
        col.setRGB(g, g * 0.99, g * 0.96);
        im.setColorAt(i, col);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = false;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      return im;
    };
    for (const ch of chunks.values()) {
      const lod = new THREE.LOD();
      lod.position.set(ch.cx, 0, ch.cz);
      const g = new THREE.Group();
      const a = build(cubeG, ch.cubes, ch);
      const b = build(tetG, ch.tets, ch);
      if (a) g.add(a);
      if (b) g.add(b);
      lod.addLevel(g, 0);
      lod.addLevel(new THREE.Object3D(), FAR);
      armourGroup.add(lod);
      stats.tris.armour += ch.cubes.length * 12 + ch.tets.length * 40;
    }
    stats.armour = total;
  }

  // ---------------------------------------------------------------- assemble
  const group = new THREE.Group();
  group.name = 'harbour';
  const map = noiseTexture();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, map });
  mat.name = 'harbour-stone';
  let tris = 0;
  for (const [key, b] of cells) {
    if (!b.idx.length) continue;
    const mesh = new THREE.Mesh(b.geometry(), mat);
    mesh.name = `harbour-${key}`;
    mesh.receiveShadow = true;
    group.add(mesh);
    tris += b.tris;
  }
  if (lampBuf.idx.length) {
    const lm = new THREE.Mesh(lampBuf.geometry(), lanternMat);
    lm.name = 'harbour-lamps';
    group.add(lm);
  }
  group.add(armourGroup);
  stats.tris.total = tris + lampBuf.tris + stats.tris.armour;
  stats.cells = group.children.length;
  return { group, stats };
}

// a tetrapod of unit size: four tapered legs on the tetrahedron axes (40 triangles)
function tetrapodGeometry() {
  const b = new Buf();
  const dirs = [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ].map((d) => {
    const l = Math.hypot(...d);
    return d.map((v) => v / l);
  });
  const white = [1, 1, 1];
  for (const u of dirs) {
    // two vectors perpendicular to the leg
    const t = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const a = [u[1] * t[2] - u[2] * t[1], u[2] * t[0] - u[0] * t[2], u[0] * t[1] - u[1] * t[0]];
    const al = Math.hypot(...a);
    const a1 = a.map((v) => v / al);
    const a2 = [u[1] * a1[2] - u[2] * a1[1], u[2] * a1[0] - u[0] * a1[2], u[0] * a1[1] - u[1] * a1[0]];
    const ring = (len, r) => [
      [a1[0] * r + a2[0] * r, a1[1] * r + a2[1] * r, a1[2] * r + a2[2] * r],
      [-a1[0] * r + a2[0] * r, -a1[1] * r + a2[1] * r, -a1[2] * r + a2[2] * r],
      [-a1[0] * r - a2[0] * r, -a1[1] * r - a2[1] * r, -a1[2] * r - a2[2] * r],
      [a1[0] * r - a2[0] * r, a1[1] * r - a2[1] * r, a1[2] * r - a2[2] * r],
    ].map((p) => [p[0] + u[0] * len, p[1] + u[1] * len, p[2] + u[2] * len]);
    const lo = ring(0.04, 0.2).map((p) => b.v(p[0], p[1], p[2], white));
    const hi = ring(0.5, 0.12).map((p) => b.v(p[0], p[1], p[2], white));
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      const mx = (b.pos[lo[k] * 3] + b.pos[lo[k2] * 3]) / 2;
      const my = (b.pos[lo[k] * 3 + 1] + b.pos[lo[k2] * 3 + 1]) / 2;
      const mz = (b.pos[lo[k] * 3 + 2] + b.pos[lo[k2] * 3 + 2]) / 2;
      b.quad(lo[k], lo[k2], hi[k2], hi[k], mx - u[0] * 0.04, my - u[1] * 0.04, mz - u[2] * 0.04);
    }
    b.quad(hi[0], hi[1], hi[2], hi[3], u[0], u[1], u[2]);
  }
  const g = b.geometry();
  g.deleteAttribute('color');
  g.deleteAttribute('uv');
  return g;
}
