// Lite roads: ONE merged mesh of flat ribbons for the main streets and ONE
// merged line set for everything else. No markings, no kerbs, no lamps, no
// glow. The height comes from the coarse ground mesh (surfaceAt), so a road
// never sinks into the 160 m grid. Same handles main.js calls on the full road
// layer (setReveal, setNight ... all no-ops here).
import * as THREE from 'three';

const COLORS = {
  primary: new THREE.Color(0xe0d8c6),
  secondary: new THREE.Color(0xcfc7b6),
  minor: new THREE.Color(0xb9b2a2),
  foot: new THREE.Color(0xa59c88),
  rail: new THREE.Color(0x5a5a5e),
  water: new THREE.Color(0x4a7a98),
};
const WIDTH_M = { primary: 9, secondary: 6 }; // ribbons; other kinds are lines
const LIFT_U = 0.12; // above the coarse ground (world units; 0.5 m)
const STEP_U = 12; // longest piece of a segment (48 m)
const MIN_U = 3; // drop points closer than this (12 m) on the ribbons

export function buildRoadsLite(roads, project, surfaceAt, atmosphere, S) {
  const group = new THREE.Group();
  group.name = 'roads';
  const ribbons = { pos: [], col: [], idx: [] };
  const lines = { pos: [], col: [] };
  let segs = 0;
  let nRibbonTris = 0;

  for (const f of roads?.features || []) {
    const kind = f.kind;
    const c = COLORS[kind];
    if (!c || !Array.isArray(f.pts) || f.pts.length < 2) continue;
    const ribbon = WIDTH_M[kind] != null;
    // project, then thin the polyline
    let pts = f.pts.map((q) => project(q[0], q[1]));
    if (ribbon) {
      const kept = [pts[0]];
      for (let i = 1; i < pts.length - 1; i++) {
        const p = kept[kept.length - 1];
        if (Math.hypot(pts[i].x - p.x, pts[i].z - p.z) >= MIN_U) kept.push(pts[i]);
      }
      kept.push(pts[pts.length - 1]);
      pts = kept;
    }
    // subdivide long pieces so the road follows the coarse triangles
    const dense = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / STEP_U));
      for (let k = 0; k < n; k++) dense.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
    }
    dense.push(pts[pts.length - 1]);
    for (const p of dense) p.y = surfaceAt(p.x, p.z) + LIFT_U;
    if (ribbon) {
      const hw = (WIDTH_M[kind] * S) / 2;
      const base = ribbons.pos.length / 3;
      for (let i = 0; i < dense.length; i++) {
        const a = dense[Math.max(0, i - 1)];
        const b = dense[Math.min(dense.length - 1, i + 1)];
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
        const p = dense[i];
        ribbons.pos.push(p.x - dz * hw, p.y, p.z + dx * hw, p.x + dz * hw, p.y, p.z - dx * hw);
        ribbons.col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        if (i) {
          const q = base + (i - 1) * 2;
          ribbons.idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
          nRibbonTris += 2;
        }
      }
    } else {
      for (let i = 0; i < dense.length - 1; i++) {
        const a = dense[i];
        const b = dense[i + 1];
        lines.pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
        lines.col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
    segs++;
  }

  const tint = (m) => atmosphere.register(m);
  if (ribbons.idx.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(ribbons.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(ribbons.col, 3));
    g.setIndex(ribbons.pos.length / 3 > 65000 ? new THREE.Uint32BufferAttribute(ribbons.idx, 1) : new THREE.Uint16BufferAttribute(ribbons.idx, 1));
    const m = tint(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'roads-lite-ribbons';
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  if (lines.pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(lines.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(lines.col, 3));
    const m = tint(new THREE.LineBasicMaterial({ vertexColors: true }));
    const mesh = new THREE.LineSegments(g, m);
    mesh.name = 'roads-lite-lines';
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  const noop = () => {};
  return {
    group,
    counts: { segments: segs, ribbonTriangles: nRibbonTris, lineSegments: lines.pos.length / 6, lamps: 0 },
    lines: {},
    glows: [],
    setReveal: noop,
    setNight: noop,
    setWaterLine: noop,
    setViewDistance: noop,
    setGeoLod: noop,
    setDetailScale: noop,
    setBloom: noop,
    setResolution: noop,
  };
}
