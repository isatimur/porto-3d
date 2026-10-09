// Quay walls on the Douro (data/quays.json, scripts/fetch-quays.mjs): the
// water edge of the Ribeira, Cais de Gaia and the Foz front as a vertical
// granite wall from the river up to the street, with a coping, a paved
// terrace behind it and iron mooring bollards every ~30 m.
//
// The DEM banks are smooth ramps 27 m per ground cell, too coarse to hold a
// wall. So the wall stands on the water line and the terrace is a flat deck
// at quay height, reaching inland until the ground rises to it; its inland
// edge drops to the ground (a skirt). Every height is read from the renderer's
// terrain (heightAt), never from the DEM file.
//
// One merged mesh per ~1 km cell (the ribbon of every line in that cell), and
// one hexagonal-prism bollard set per cell inside the same geometry.
import * as THREE from 'three';
import { dataPath, hasData } from './city.js';
import { assetUrl } from './data.js';

const STEP_M = 5; // sample spacing along a line
const BOLLARD_M = 30;
const CELL_M = 1000;
const WALL_MIN_M = 2.4; // wall height above the water, from the ground behind
const WALL_MAX_M = 5;
const BELOW_M = 1.2; // the wall runs this far under the water line
const COPING_H = 0.3;
const COPING_OUT = 0.25; // the coping overhangs the face
const COPING_IN = 0.5;
const DECK_MIN_M = 3;
const DECK_MAX_M = 12;
const SKIRT_MIN_M = 0.4;
const SEA_SEARCH_M = 40; // river-side search for the water level
const OUT_MAX_M = 22; // the wall never moves further out than this
const WATER_EPS_M = 0.4; // ground this close to the water counts as the waterline

export async function loadQuays() {
  if (!hasData('quays.json')) return null;
  try {
    const res = await fetch(assetUrl(dataPath('quays.json')));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!(res.headers.get('content-type') || '').includes('json')) throw new Error('not JSON');
    const doc = JSON.parse(await res.text());
    if (!Array.isArray(doc?.lines)) throw new Error('no lines[]');
    return doc;
  } catch (e) {
    console.info(`[porto] ${dataPath('quays.json')} unavailable (${e.message}); no quay walls.`);
    return null;
  }
}

const hex = (h) => new THREE.Color(h);
const WALL_A = hex(0x58554f);
const WALL_B = hex(0x47443f);
const WEED = hex(0x3f4a3c);
const COPING = hex(0xa19d94);
const DECK = hex(0x7b756b);
const IRON = hex(0x23252a);

function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// Resample a polyline (metres) every STEP_M.
function resample(line) {
  const out = [];
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / STEP_M));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  out.push(line[line.length - 1]);
  return out;
}

function smooth(a, r) {
  const out = a.slice();
  for (let i = 0; i < a.length; i++) {
    let s = 0;
    let n = 0;
    for (let k = -r; k <= r; k++) {
      const v = a[i + k];
      if (v !== undefined) {
        s += v;
        n++;
      }
    }
    out[i] = s / n;
  }
  return out;
}

class Cell {
  constructor() {
    this.pos = [];
    this.col = [];
    this.idx = [];
  }
  // push one vertex row; returns its index
  v(x, y, z, c) {
    this.pos.push(x, y, z);
    this.col.push(c.r, c.g, c.b);
    return this.pos.length / 3 - 1;
  }
  quad(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

// ctx: { doc, heightAt, S }; returns { group, stats }
export function buildQuays({ doc, heightAt, S }) {
  const group = new THREE.Group();
  group.name = 'quays';
  const stats = { lines: 0, samples: 0, lengthM: 0, bollards: 0, tris: 0, skipped: 0, cells: 0 };
  const cells = new Map();
  const cellOf = (x, z) => {
    const key = `${Math.floor(x / (CELL_M * S))}_${Math.floor(z / (CELL_M * S))}`;
    let c = cells.get(key);
    if (!c) cells.set(key, (c = new Cell()));
    return c;
  };
  const hAt = (mx, my) => heightAt(mx * S, -my * S);

  for (const raw of doc.lines) {
    const pts = resample(raw);
    const n = pts.length;
    if (n < 2) continue;
    // tangents and left normals (metres, east/north)
    const T = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    });
    const N = T.map(([tx, ty]) => [-ty, tx]);
    // the land side: the side where the ground is higher, over the whole line
    let vote = 0;
    for (let i = 0; i < n; i += 2) vote += hAt(pts[i][0] + N[i][0] * 10, pts[i][1] + N[i][1] * 10) - hAt(pts[i][0] - N[i][0] * 10, pts[i][1] - N[i][1] * 10);
    if (Math.abs(vote) < 0.05 * Math.ceil(n / 2) * S) {
      stats.skipped++; // level both sides: a pier or an islet, no bank to hold
      continue;
    }
    const sgn = vote > 0 ? 1 : -1;
    const L = N.map(([nx, ny]) => [nx * sgn, ny * sgn]); // toward the land

    // water level per sample: the lowest ground on the river side (the 27 m
    // DEM cells make a pad that reaches past the OSM line and falls to the
    // river over a whole cell, so the first metres of it stand above the water)
    const yW = [];
    // how far the wall moves river-ward to stand where the ground really
    // meets the water; without it a green wedge of terrain sat in front of it
    const outRaw = [];
    for (let i = 0; i < n; i++) {
      const [px, py] = pts[i];
      const [lx, ly] = L[i];
      let lo = hAt(px, py);
      for (let d = 2; d <= SEA_SEARCH_M; d += 2) lo = Math.min(lo, hAt(px - lx * d, py - ly * d));
      yW.push(lo);
      let o = 0;
      while (o < OUT_MAX_M && hAt(px - lx * o, py - ly * o) > lo + WATER_EPS_M * S) o += 1;
      outRaw.push(o);
    }
    const outM = smooth(smooth(outRaw, 4), 4);
    // quay height per sample
    const rise = pts.map((p, i) => (hAt(p[0] + L[i][0] * 6, p[1] + L[i][1] * 6) - yW[i]) / S);
    const topM = smooth(
      rise.map((r) => Math.min(WALL_MAX_M, Math.max(WALL_MIN_M, r))),
      3,
    );
    const yWs = smooth(yW, 1);

    // build the rows
    const rows = [];
    for (let i = 0; i < n; i++) {
      const [px, py] = pts[i];
      const [lx, ly] = L[i];
      const w = yWs[i];
      const top = w + topM[i] * S;
      const at = (o, y, c, cell) => cell.v((px + lx * o) * S, y, -(py + ly * o) * S, c);
      const cell = cellOf(px * S, -py * S);
      // deck width: inland until the ground reaches the deck, within limits
      let width = DECK_MIN_M;
      for (let d = DECK_MIN_M; d <= DECK_MAX_M; d += 1.5) {
        width = d;
        if (hAt(px + lx * d, py + ly * d) >= top - 0.1 * S) break;
      }
      const inland = hAt(px + lx * width, py + ly * width);
      const skirtBottom = Math.min(top - SKIRT_MIN_M * S, inland - 0.3 * S);
      const j = Math.floor(i / 2);
      const shade = 0.88 + hash(j + 17 * Math.floor(px * 0.01)) * 0.24;
      rows.push({ cell, px, py, lx, ly, w, top, width: width + outM[i], skirtBottom, shade, out: outM[i] });
    }

    for (let i = 0; i < n - 1; i++) {
      const A = rows[i];
      const B = rows[i + 1];
      if (A.cell !== B.cell) continue; // the seam is one step; a gap of 5 m at most
      const cell = A.cell;
      const colWall = (r, band) => (band === 0 ? WEED : band % 2 ? WALL_B : WALL_A).clone().multiplyScalar(r.shade * (1 - 0.05 * band));
      // o: metres inland from the wall face (the face stands r.out metres river-ward of the OSM line)
      const rowVerts = (r, y, c, o) => cell.v((r.px + r.lx * (o - r.out)) * S, y, -(r.py + r.ly * (o - r.out)) * S, c);
      // wall: courses from below the water to the quay top, hard-edged bands
      // (the tide line is a dark green course at the foot, as on the Ribeira)
      const bands = 5;
      for (let k = 0; k < bands; k++) {
        const lerp = (r, f) => r.w - BELOW_M * S + (r.top - (r.w - BELOW_M * S)) * f;
        const ca = colWall(A, k);
        const cb = colWall(B, k);
        const a0 = rowVerts(A, lerp(A, k / bands), ca, 0);
        const b0 = rowVerts(B, lerp(B, k / bands), cb, 0);
        const b1 = rowVerts(B, lerp(B, (k + 1) / bands), cb, 0);
        const a1 = rowVerts(A, lerp(A, (k + 1) / bands), ca, 0);
        cell.quad(a0, b0, b1, a1);
      }
      // coping: front face then the top slab
      const cA = COPING.clone().multiplyScalar(A.shade);
      const cB = COPING.clone().multiplyScalar(B.shade);
      const f0a = rowVerts(A, A.top, cA, -COPING_OUT);
      const f0b = rowVerts(B, B.top, cB, -COPING_OUT);
      const f1a = rowVerts(A, A.top + COPING_H * S, cA, -COPING_OUT);
      const f1b = rowVerts(B, B.top + COPING_H * S, cB, -COPING_OUT);
      cell.quad(f0a, f0b, f1b, f1a);
      const t1a = rowVerts(A, A.top + COPING_H * S, cA, COPING_IN);
      const t1b = rowVerts(B, B.top + COPING_H * S, cB, COPING_IN);
      cell.quad(f1a, f1b, t1b, t1a);
      // the inner lip steps down to the deck
      const t0a = rowVerts(A, A.top, cA, COPING_IN);
      const t0b = rowVerts(B, B.top, cB, COPING_IN);
      cell.quad(t1a, t1b, t0b, t0a);
      // deck
      const dA = DECK.clone().multiplyScalar(A.shade);
      const dB = DECK.clone().multiplyScalar(B.shade);
      const d0a = rowVerts(A, A.top, dA, COPING_IN);
      const d0b = rowVerts(B, B.top, dB, COPING_IN);
      const d1a = rowVerts(A, A.top, dA, A.width);
      const d1b = rowVerts(B, B.top, dB, B.width);
      cell.quad(d0a, d0b, d1b, d1a);
      // skirt: the inland edge down to the ground
      const s0a = rowVerts(A, A.top, dA, A.width);
      const s0b = rowVerts(B, B.top, dB, B.width);
      const s1a = rowVerts(A, A.skirtBottom, dA, A.width);
      const s1b = rowVerts(B, B.skirtBottom, dB, B.width);
      cell.quad(s0a, s0b, s1b, s1a);
      stats.samples++;
    }

    // bollards every BOLLARD_M along the line, 0.9 m behind the face
    let acc = BOLLARD_M / 2;
    for (let i = 0; i < n - 1; i++) {
      const seg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      acc += seg;
      if (acc < BOLLARD_M) continue;
      acc -= BOLLARD_M;
      const r = rows[i];
      const cell = r.cell;
      const cx = (r.px + r.lx * (COPING_IN + 0.5 - r.out)) * S;
      const cz = -(r.py + r.ly * (COPING_IN + 0.5 - r.out)) * S;
      const rad = 0.28 * S;
      const h = 0.75 * S;
      const base = r.top;
      const ring0 = [];
      const ring1 = [];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        ring0.push(cell.v(cx + Math.cos(a) * rad, base, cz + Math.sin(a) * rad, IRON));
        ring1.push(cell.v(cx + Math.cos(a) * rad * 0.8, base + h, cz + Math.sin(a) * rad * 0.8, IRON));
      }
      for (let k = 0; k < 6; k++) cell.quad(ring0[k], ring0[(k + 1) % 6], ring1[(k + 1) % 6], ring1[k]);
      const apex = cell.v(cx, base + h * 1.08, cz, IRON);
      for (let k = 0; k < 6; k++) cell.idx.push(ring1[k], ring1[(k + 1) % 6], apex);
      stats.bollards++;
    }
    stats.lines++;
    for (let i = 0; i < n - 1; i++) stats.lengthM += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, side: THREE.DoubleSide });
  mat.name = 'quay-stone';
  for (const [key, cell] of cells) {
    if (!cell.idx.length) continue; // a cell only a line's end point touched
    const g = cell.geometry();
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = `quays-${key}`;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    group.add(mesh);
    stats.tris += cell.idx.length / 3;
  }
  stats.cells = group.children.length;
  stats.lengthM = Math.round(stats.lengthM);
  return { group, stats };
}
