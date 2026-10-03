// Placement of the landmark models at 1:1 scale. DOM-free: node scripts
// import it (scripts/check-fit.mjs prints the table).
//
// The models are authored in metres on the real OSM footprint (see
// src/models.js), so the fit is a rigid transform, no per-axis scaling:
//   1. siteFrame(): the local frame. +z is the main front (compass bearing
//      from data/dimensions.json facade_azimuth_deg, snapped to the nearest
//      outline edge normal), origin at the centre of the outline's box.
//      The OSM outline and parts are handed to the builder in this frame.
//   2. base: the terrain level the model stands on (lowest point under the
//      outline, or a named part such as the Adro of Bom Jesus).
//   3. turn by the front bearing, move to the origin, metres -> world units
//      (x S on all three axes), set on the base.
//   4. pad: level ground under the model, or only under the level part of
//      a site (the Bom Jesus stair climbs the real slope, unpadded).
// A guard warns when the model's box deviates more than 10 % from the OSM
// extent it stands for, and shrinkCheck() flags any model smaller than
// 97 % of its real plan or height. Real scale is the only view: nothing
// scales a model after the fit.
//
// Frames. World: x east, z south, y up, world units = metres * S.
// Compass bearing b (0 = north, clockwise) points along world (sin b, -cos b).
// THREE rotation.y = yaw maps local +z to world (sin yaw, cos yaw), so a model
// whose front (+z) faces compass bearing F gets yaw = PI - F.
import * as THREE from 'three';
import { buildModel, specFor, builderRule } from './models.js';
import { S } from './geo.js';
import { bbox, edges, clean, inside } from './models/geom.js';

// <data_dir>/dimensions.json: set by data.js (the app) or the script
// (check-fit.mjs, count-tris.mjs) before the first fitLandmark().
let DIMS = {};
export function setDims(dims) {
  DIMS = dims && typeof dims === 'object' ? dims : {};
}

const DEG = Math.PI / 180;
export const DEVIATION_WARN = 0.1;
export const DEVIATION_FAIL = 0.15;
// Never-shrink rule: a model may be a little larger than what it stands
// for, never smaller. Plan (x, z) against the OSM extent, height against
// data/dimensions.json height_m.total. check-fit.mjs fails on it,
// landmarks.js warns at runtime.
export const SHRINK_MIN = 0.97;

// One row of the never-shrink check for a fitLandmark() result: the ratios
// model / real (null where there is no real value) and the failing axes.
export function shrinkCheck(fit) {
  const r = (m, t) => (t > 0.5 ? m / t : null);
  const dimsH = fit.dims?.height_m?.total ?? null;
  const ratio = {
    x: r(fit.sizeM.x, fit.extentM.x),
    z: r(fit.sizeM.z, fit.extentM.z),
    h: dimsH ? r(fit.sizeM.height, dimsH) : null,
  };
  const fails = Object.entries(ratio)
    .filter(([, v]) => v != null && v < SHRINK_MIN)
    .map(([k]) => k);
  return { id: fit.id, ratio, fails, ok: fails.length === 0 };
}

// Per-landmark rules (a builder may add its own as builder.rule):
//   front:  compass bearing (deg) of the main front; default dims.facade_azimuth_deg
//   snap:   snap the front to the nearest outline edge normal (default true)
//   base:   'min' (lowest raw terrain under the outline, default) |
//           { part: RegExp, stat: 'min' | 'mean' } (terrain under a part)
//   pad:    'model' (level under the model box, default) |
//           { parts: [RegExp] } (level under the box of those parts only) |
//           { box: { x0, x1, z0, z1 } } (an explicit local box, metres);
//           optional margin (m, default 2) and fall (falloff, m)
//   extent: OSM set the whole model must match: 'outline' (default) |
  //           [RegExp] (outline plus the parts whose name or tag matches) |
  //           { box: { x0, x1, z0, z1 } } (an explicit local-metre box, for a
  //           model that stands for part of the OSM outline: a bridge deck,
  //           a station head building; documents the approved deviation) |
  //           { part: RegExp } (the box of that OSM part)
//   view:   camera bearing offset from the front, radians (default 0.6)
//   heightRel: measure the height on the builder's 'height' group from its
//           own floor (draped sites whose y carries the slope)
//   note:   why the rule exists (goes into the report)
// deviationNote: why a model's plan may not match the OSM outline (the
//   approved deviation; shown in the report, not a blanket disable).
// Explicit per-landmark rules. Each one is narrow: it names the part of the
// OSM footprint the model actually stands for (see data/dimensions.json
// notes for the source). Everything else is left to the builder + outline.
export const FIT_RULES = {
  // OSM way 211337881 is the whole Clérigos complex (church, tower and the
  // Casa da Irmandade, 74 m). The model is the church + tower only.
  clerigos: {
    extent: { box: { x0: -16.3, x1: 16.3, z0: -17.8, z1: 17.8 } },
    fitTo: true,
    deviationNote: 'model is the church + 75.6 m tower; the outline also holds the Casa da Irmandade',
  },
  // OSM way 1159533444 is the whole station (head building, torreões and the
  // 182.6 m platform trainshed). The model is the head building.
  'sao-bento': {
    extent: { box: { x0: -36.9, x1: 36.9, z0: -11.9, z1: 14.9 } },
    deviationNote: 'model is the head building; the outline also holds the platform trainshed',
  },
  // The bridges are mapped as long thin OSM corridors; the built decks are
  // wider (parapets, ribs, pylons, abutments). These are the real structure
  // boxes the models stand for (length from the OSM outline).
  'ponte-luis-i': {
    extent: { box: { x0: -9, x1: 9, z0: -205.1, z1: 205.1 } },
    deviationNote: 'OSM outline is the deck corridor; the model spans the 18 m pylon structure',
  },
  'ponte-arrabida': {
    extent: { box: { x0: -12, x1: 12, z0: -251.3, z1: 251.3 } },
    deviationNote: 'OSM outline includes the approach embankments; the model is the 24 m deck structure',
  },
  'ponte-maria-pia': {
    extent: { box: { x0: -5.3, x1: 5.3, z0: -185.1, z1: 185.1 } },
    deviationNote: 'OSM outline is the 4.2 m rail centreline; the model spans the 10.5 m lattice deck',
  },
  // Serralves: the outline is the Casa de Serralves villa; the model is the
  // whole estate (villa + Siza museum + gardens), all mapped as OSM parts.
  serralves: {
    extent: [/./],
    deviationNote: 'model is the whole Serralves estate (villa + museum + gardens), not the villa alone',
  },
  // São Francisco: OSM way 210681249 is the Gothic church alone (28.4 x 51.6 m).
  // The model is the church plus the lost-cloister arcade fragment drawn on its
  // east side (the Palácio da Bolsa now occupies the convent). Box = the drawn
  // church + cloister fragment: the 28 m nave + buttresses, z 51 m, with the
  // 13 m arcade extending +x.
  'sao-francisco-porto': {
    extent: { box: { x0: -15.3, x1: 27.7, z0: -24.9, z1: 26.1 } },
    heightRel: true,
    deviationNote: 'model is the church + the cloister arcade fragment east of it; the outline is the church alone',
  },
  // Cais da Ribeira: OSM way 239012587 is the quay area (22.5 x 70.6 m); the
  // model is the continuous arcaded terrace row on the quay, with its granite
  // quay and a strip of the Douro drawn in front. Box = the drawn row (70 m)
  // plus quay and river frontage.
  ribeira: {
    extent: { box: { x0: -64.9, x1: 9.2, z0: -65.1, z1: 65.7 } },
    deviationNote: 'model is the ~70 m arcaded terrace row plus its quay and drawn Douro frontage; the outline is the quay area only',
  },
  // Molhe de Felgueiras: OSM way 446589339 is the 236 m breakwater, with the
  // 10 m light mapped only as a node. The model is the breakwater mole + the
  // lighthouse + the ocean/rocks around it. heightRel measures the light on the
  // 'height' group from the mole crown, so the real ~10 m tower governs.
  felgueiras: {
    extent: { box: { x0: -65.0, x1: 70.8, z0: -157.1, z1: 156.9 } },
    heightRel: true,
    deviationNote: 'model is the breakwater mole + ~10 m lighthouse + the drawn ocean/rocks; the outline is the breakwater line only',
  },
  // Caves de Gaia: OSM way 382530398 is the Sandeman lodge (32.8 x 29.9 m); the
  // model is the whole port-wine lodge row (Sandeman, Graham's, Taylor's) with
  // its casks, yards, quay and the Douro. Box = the drawn lodge row + quay.
  'caves-gaia': {
    extent: { box: { x0: -25.5, x1: 88.1, z0: -78.6, z1: 73.8 } },
    deviationNote: 'model is the port-wine lodge row (three lodges, casks, quay); the outline is one lodge building',
  },
  // Aliados: OSM relation 3012085 is the Câmara Municipal block (63.8 x 51.6 m);
  // the model is the granite avenue axis closing on the Câmara. Box = the drawn
  // avenue (with its flanking blocks) + the Câmara. The tower height is fixed in
  // data/dimensions.json (70 m, Wikipedia), never by scaling this axis.
  aliados: {
    extent: { box: { x0: -49.6, x1: 29.6, z0: -52.3, z1: 47.1 } },
    deviationNote: 'model is the avenue axis + flanking blocks closing on the Câmara; the outline is the Câmara block alone',
  },
  // Jardins do Palácio de Cristal: OSM way 244599647 is the whole garden
  // (403.8 x 335.9 m); the model is the terraced gardens, the Super Bock Arena
  // dome and the Douro mirador/water. Box = the drawn gardens + arena + water.
  // The arena height is the real dome apex (~39 m), set in data/dimensions.json.
  'palacio-cristal': {
    extent: { box: { x0: -214.1, x1: 220.1, z0: -219.2, z1: 193.9 } },
    fitTo: true,
    deviationNote: 'model is the gardens + the ~30 m domed arena + the Douro mirador/water; the outline is the garden boundary',
  },
};

export function dimsFor(id) {
  return DIMS[id] || null;
}

// ------------------------------------------------------------ helpers
export const dirOf = (bDeg) => ({ x: Math.sin(bDeg * DEG), z: -Math.cos(bDeg * DEG) });
export const bearingOf = (x, z) => ((Math.atan2(x, -z) / DEG) % 360 + 360) % 360;
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

const matches = (p, re) => (re instanceof RegExp ? re.test(p.name || '') || re.test(p.tag || '') : p.name === re || p.tag === re);

// The local frame of a landmark. ctx.project: (lat, lon) -> world units.
export function siteFrame(fp, dims, rule, ctx) {
  const toM = (q) => {
    const w = ctx.project(q[0], q[1]);
    return [w.x / S, w.z / S];
  };
  const outlineW = clean(fp.outline.map(toM));
  // --- front bearing: dims azimuth snapped to an outline edge normal
  let front = rule.front ?? dims?.facade_azimuth_deg ?? fp.bearing_deg ?? 0;
  const wanted = front;
  let snapped = null;
  // snap polygon: the outline, or a named part (rule.snapTo)
  const snapPart = rule.snapTo ? (fp.parts || []).find((p) => matches(p, rule.snapTo)) : null;
  const snapPoly = snapPart ? clean(snapPart.pts.map(toM)) : outlineW;
  if (rule.snap !== false && snapPoly.length > 2) {
    const E = edges(snapPoly);
    const maxLen = Math.max(...E.map((e) => e.len));
    // the edge whose normal is nearest the wanted bearing (within 25 deg);
    // among edges within 3 deg of that, the longest
    const cands = E.filter((e) => e.len >= maxLen * 0.2).map((e) => ({ b: bearingOf(e.nx, e.nz), len: e.len })).map((c) => ({ ...c, d: angDiff(c.b, front) }));
    const dMin = Math.min(...cands.map((c) => c.d));
    let best = null;
    for (const c of cands) if (c.d <= 25 && c.d <= dMin + 3 && (!best || c.len > best.len)) best = c;
    if (best) {
      snapped = best;
      front = best.b;
    }
  }
  const yaw = Math.PI - front * DEG;
  const ez = { x: Math.sin(yaw), z: Math.cos(yaw) }; // local +z in world
  const ex = { x: Math.cos(yaw), z: -Math.sin(yaw) }; // local +x in world
  // origin: centre of the outline's box in the local axes
  const loc0 = (p) => [p[0] * ex.x + p[1] * ex.z, p[0] * ez.x + p[1] * ez.z];
  const b0 = bbox(outlineW.map(loc0));
  const O = { x: b0.cx * ex.x + b0.cz * ez.x, z: b0.cx * ex.z + b0.cz * ez.z }; // world metres
  const toLocal = (m) => {
    const dx = m[0] - O.x;
    const dz = m[1] - O.z;
    return [dx * ex.x + dz * ex.z, dx * ez.x + dz * ez.z];
  };
  const toWorldM = (x, z) => [O.x + x * ex.x + z * ez.x, O.z + x * ex.z + z * ez.z];
  const outline = outlineW.map(toLocal);
  const parts = (fp.parts || []).map((p) => ({ ...p, pts: p.pts.map((q) => toLocal(toM(q))) }));
  return { yaw, front, wanted, snapped, O, ex, ez, toLocal, toWorldM, outline, parts };
}

// Raw terrain (metres rel. datum) at local metres.
const groundFn = (frame, ctx) => (x, z) => {
  const [wx, wz] = frame.toWorldM(x, z);
  return ctx.rawAt(wx * S, wz * S) / S;
};

function samplePoly(pts, fn) {
  const b = bbox(pts);
  const out = pts.map(([x, z]) => fn(x, z));
  const n = 8;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const x = b.x0 + (b.w * i) / n;
      const z = b.z0 + (b.d * j) / n;
      if (pts.length < 3 || inside(pts, x, z)) out.push(fn(x, z));
    }
  }
  return out;
}

// ------------------------------------------------------------ the fit
// ctx: { project, rawAt(x,z) (terrain without pads), footprints }
export function fitLandmark(l, ctx) {
  const fp = ctx.footprints?.[l.id];
  const dims = dimsFor(l.id);
  const rule = { ...FIT_RULES[l.id], ...builderRule(l.model, l.id) };
  const spec = specFor(l.id, l.model);
  const fit = { id: l.id, rule, spec, dims, heightSource: dims ? 'dimensions.json' : fp?.height_source ?? 'model' };

  // --- no footprint: a rectangle of the dims size (or 20 x 20 m) at the point
  let src = fp;
  if (!src) {
    const L = dims?.footprint_m?.length ?? 20;
    const W = dims?.footprint_m?.width ?? 20;
    const dLat = W / 2 / 110574;
    const dLon = L / 2 / (Math.cos(l.lat * DEG) * 111320);
    src = { outline: [[l.lat - dLat, l.lon - dLon], [l.lat - dLat, l.lon + dLon], [l.lat + dLat, l.lon + dLon], [l.lat + dLat, l.lon - dLon]], parts: [], bearing_deg: 90 };
    fit.fallback = true;
  }
  const frame = siteFrame(src, dims, rule, ctx);
  const rawM = groundFn(frame, ctx);

  // --- base (metres rel. datum)
  let baseM;
  if (rule.base && rule.base.part) {
    const p = frame.parts.find((q) => matches(q, rule.base.part));
    const s = samplePoly(p ? p.pts : frame.outline, rawM);
    baseM = rule.base.stat === 'mean' ? s.reduce((a, v) => a + v, 0) / s.length : Math.min(...s);
  } else {
    baseM = Math.min(...samplePoly(frame.outline, rawM));
  }
  // --- pad over named parts (sites that are only partly level): its box,
  // falloff and level profile are known before the build, so the builder
  // gets the visible ground (terrain with this pad) as footprint.ground
  let partPad = null;
  if (rule.pad && (rule.pad.parts || rule.pad.box)) {
    // rule.pad.box: an explicit local box { x0, x1, z0, z1 } (metres) for
    // a building whose OSM box reaches over its neighbour (Forum Braga)
    const B = rule.pad.box;
    const pts = B ? [[B.x0, B.z0], [B.x1, B.z1]] : frame.parts.filter((p) => rule.pad.parts.some((re) => matches(p, re))).flatMap((p) => p.pts);
    if (pts.length) {
      const b = bbox(pts);
      const m = rule.pad.margin ?? 2;
      const hu = b.d / 2 + m;
      const hv = b.w / 2 + m;
      // rule.pad.fall: falloff in metres (default 5..16 world units)
      const fallM = rule.pad.fall ?? THREE.MathUtils.clamp(Math.max(hu, hv) * S * 0.25, 5, 16) / S;
      partPad = { cx: b.cx, cz: b.cz, hu, hv, fallM, level: rule.pad.level || (() => 0) };
    }
  }
  const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const rawGround = (x, z) => rawM(x, z) - baseM;
  const ground = partPad
    ? (x, z) => {
        const h = rawGround(x, z);
        const ou = Math.abs(z - partPad.cz) - partPad.hu;
        const ov = Math.abs(x - partPad.cx) - partPad.hv;
        const d = Math.hypot(Math.max(0, ou), Math.max(0, ov));
        if (d >= partPad.fallM) return h;
        const w = 1 - smooth(d / partPad.fallM);
        return h + (partPad.level(x, z) - h) * w;
      }
    : rawGround;
  const footprint = {
    id: l.id,
    outline: frame.outline,
    parts: frame.parts,
    box: bbox(frame.outline),
    frontDeg: frame.front,
    ground, // visible terrain (with this landmark's pad), metres rel. base
    rawGround, // DEM without the pad
    part: (re) => frame.parts.find((p) => matches(p, re)) || null,
    partsOf: (re) => frame.parts.filter((p) => matches(p, re)),
  };

  // --- the OSM extent the model must match (rule.extent), resolved before
  // the build so a builder can be sized to it (rule.fitTo)
  let extentPts = [...frame.outline];
  if (Array.isArray(rule.extent)) {
    for (const p of frame.parts) if (rule.extent.some((re) => matches(p, re))) extentPts.push(...p.pts);
  } else if (rule.extent?.box) {
    const B = rule.extent.box;
    extentPts = [[B.x0, B.z0], [B.x1, B.z0], [B.x1, B.z1], [B.x0, B.z1]];
  } else if (rule.extent?.part) {
    const p = frame.parts.find((q) => matches(q, rule.extent.part));
    if (p) extentPts = p.pts.slice();
  }
  const eb = bbox(extentPts);
  const ob = bbox(frame.outline);

  // --- build (metric builders draw in metres on this footprint)
  let g = buildModel(l.model, l.id, { footprint, dims });
  let glass = g.userData.glass || null;
  const groundLine = g.userData.groundLine || null;
  let groups = g.userData.groups || {};
  // rule.fitTo: map the authored model onto the OSM extent (plan) and the
  // real height, so a builder authored in its own metres still stands at the
  // size of the footprint it represents. Opt-in per landmark.
  if (rule.fitTo && g.userData.metric) {
    g.computeBoundingBox();
    const a = g.boundingBox;
    const aw = Math.max(1e-3, a.max.x - a.min.x);
    const ad = Math.max(1e-3, a.max.z - a.min.z);
    const ah = Math.max(1e-3, a.max.y);
    const dimsH = dims?.height_m?.total;
    const sx = eb.w > 0.5 ? eb.w / aw : 1;
    const sz = eb.d > 0.5 ? eb.d / ad : 1;
    const sy = dimsH ? dimsH / ah : 1;
    const acx = (a.min.x + a.max.x) / 2;
    const acz = (a.min.z + a.max.z) / 2;
    const m = new THREE.Matrix4()
      .makeTranslation(eb.cx, 0, eb.cz)
      .multiply(new THREE.Matrix4().makeScale(sx, sy, sz))
      .multiply(new THREE.Matrix4().makeTranslation(-acx, 0, -acz));
    g.applyMatrix4(m);
    if (glass) glass.applyMatrix4(m);
  }
  if (!g.userData.metric) {
    // legacy: uniform scale to the real height, centred on the outline
    g.computeBoundingBox();
    const bb = g.boundingBox;
    const H = dims?.height_m?.total ?? fp?.height_m ?? bb.max.y;
    const s = H / Math.max(1e-3, bb.max.y);
    const m = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-(bb.min.x + bb.max.x) / 2, 0, -(bb.min.z + bb.max.z) / 2));
    g.applyMatrix4(m);
    if (glass) glass.applyMatrix4(m);
    fit.legacy = true;
  }
  g.computeBoundingBox();
  const mb = g.boundingBox.clone(); // local metres
  fit.localBox = mb;
  fit.groups = groups;

  // --- world placement
  const pivot = new THREE.Vector3(frame.O.x * S, baseM * S, frame.O.z * S);
  const { ex, ez } = frame;
  const place = (geo) => {
    const a = geo.attributes.position.array;
    const n = geo.attributes.normal?.array;
    for (let i = 0; i < a.length; i += 3) {
      const lx = a[i];
      const ly = a[i + 1];
      const lz = a[i + 2];
      a[i] = (lx * ex.x + lz * ez.x) * S;
      a[i + 1] = ly * S;
      a[i + 2] = (lx * ex.z + lz * ez.z) * S;
      if (n) {
        const nx = n[i];
        const nz = n[i + 2];
        n[i] = nx * ex.x + nz * ez.x;
        n[i + 2] = nx * ex.z + nz * ez.z;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeBoundingBox();
    geo.userData.realBox = geo.boundingBox.clone();
    geo.computeBoundingSphere();
  };
  place(g);
  if (glass) place(glass);
  // local metres [x, y, z] -> mesh-local world units
  const toMesh = ([lx, ly, lz]) => [(lx * ex.x + lz * ez.x) * S, ly * S, (lx * ex.z + lz * ez.z) * S];
  // detached pieces (moving parts): geometry in world units around its own
  // origin, turned with the model; a track (local metres) becomes world
  // units relative to the landmark pivot
  const pieces = (g.userData.pieces || []).map((p) => {
    const pg = p.geometry;
    if (p.data.track) {
      // on a track: the part's own frame, turned and pitched by the app
      const a = pg.attributes.position.array;
      for (let i = 0; i < a.length; i++) a[i] *= S;
      pg.computeBoundingBox();
      pg.computeBoundingSphere();
    } else place(pg); // a fixed part: turned with the model
    const data = { ...p.data };
    if (p.data.track) data.track = p.data.track.map(toMesh);
    return { name: p.name, geometry: pg, data };
  });
  const markers = (g.userData.markers || []).map((m) => ({ name: m.name, data: m.data, pos: toMesh(m.pos) }));
  const box = g.userData.realBox.clone().translate(pivot);
  // camera framing box: the whole model, or rule.frame = local box
  // { x0, x1, z0, z1 } (metres) for sites much larger than their subject
  let frameBox = box;
  if (rule.frame) {
    let f = rule.frame;
    if (f.parts) {
      // { parts: [RegExp], margin }: the box of those OSM parts
      const pts = frame.parts.filter((p) => f.parts.some((re) => matches(p, re))).flatMap((p) => p.pts);
      const b = bbox(pts.length ? pts : frame.outline);
      const m = f.margin ?? 0;
      f = { x0: b.x0 - m, x1: b.x1 + m, z0: b.z0 - m, z1: b.z1 + m, y0: f.y0 };
    }
    frameBox = new THREE.Box3();
    for (const [x, z] of [[f.x0, f.z0], [f.x1, f.z0], [f.x1, f.z1], [f.x0, f.z1]]) {
      for (const y of [f.y0 ?? mb.min.y, mb.max.y]) {
        frameBox.expandByPoint(new THREE.Vector3(pivot.x + (x * ex.x + z * ez.x) * S, pivot.y + y * S, pivot.z + (x * ex.z + z * ez.z) * S));
      }
    }
  }

  // --- plans (world units): building mask and pad
  const planOf = (b, margin = 0) => ({
    cx: pivot.x + ((b.x0 + b.x1) / 2) * ex.x * S + ((b.z0 + b.z1) / 2) * ez.x * S,
    cz: pivot.z + ((b.x0 + b.x1) / 2) * ex.z * S + ((b.z0 + b.z1) / 2) * ez.z * S,
    // long axis of the rectangle = local z; hu along it, hv across
    ux: ez.x,
    uz: ez.z,
    hu: ((b.z1 - b.z0) / 2 + margin) * S,
    hv: ((b.x1 - b.x0) / 2 + margin) * S,
  });
  const box2 = (b3) => ({ x0: b3.min.x, x1: b3.max.x, z0: b3.min.z, z1: b3.max.z });
  // The building mask: the model's own mass (the builder's 'mask' group if it
  // has one, else the main block, else the whole model box), as one oriented
  // rectangle in the site frame. It is used to skip OSM grey mass and nature
  // under a landmark, so the whole built block must be covered.
  //
  // check-fit.mjs reports "building masks overlapping" with a separating-axis
  // test on these rectangles. That test is deliberately coarse: two genuinely
  // adjacent footprints that only share a boundary (Palácio da Bolsa and Igreja
  // de São Francisco, whose OSM polygons touch but do not intersect) still have
  // overlapping oriented boxes, because a rectangle covering a whole building
  // necessarily reaches the shared wall of its neighbour. The report is
  // therefore a false positive for adjacent landmarks, and it is benign: the
  // masks only decide whether to *skip* a street-level building, so an overlap
  // can never draw a wrong building — at worst it skips one already covered by
  // the two landmarks. Tightening the rectangles below the real footprint to
  // silence it would let OSM mass reappear inside a landmark, so the warning is
  // documented here rather than weakened.
  const maskBox = groups.mask || groups.main || mb;
  const plan = planOf(box2(maskBox));
  let padPlan = planOf(box2(mb), 2);
  let padLevel = null;
  if (partPad) {
    padPlan = planOf({ x0: partPad.cx - partPad.hv, x1: partPad.cx + partPad.hv, z0: partPad.cz - partPad.hu, z1: partPad.cz + partPad.hu });
    padPlan.fall = partPad.fallM * S;
    // world (x, z) in units -> level in world units
    padLevel = (x, z) => {
      const [lx, lz] = frame.toLocal([x / S, z / S]);
      return (baseM + partPad.level(lx, lz)) * S;
    };
  }

  // --- report: real size vs the OSM extent it stands for
  const dev = (m, t) => (t > 0.5 ? Math.abs(m - t) / t : 0);
  const size = { x: mb.max.x - mb.min.x, z: mb.max.z - mb.min.z };
  const main = groups.main || null;
  // height of the tallest element: the main block, or a separate part the
  // builder marks as the 'height' group (e.g. the Tibães church towers).
  // rule.heightRel (draped sites on a slope, Parque da Ponte): the height
  // of the 'height' group above its own footing (group box, floor to top),
  // since y on such a site also carries the terrain relief.
  const H = rule.heightRel && groups.height
    ? groups.height.max.y - groups.height.min.y
    : main ? Math.max(main.max.y, groups.height?.max.y ?? -Infinity) : mb.max.y;
  const dimsH = dims?.height_m?.total ?? null;
  const deviation = {
    site: Math.max(dev(size.x, eb.w), dev(size.z, eb.d)),
    main: main ? Math.max(dev(main.max.x - main.min.x, eb.w), dev(main.max.z - main.min.z, eb.d)) : null,
    height: dimsH ? dev(H, dimsH) : null,
  };
  const worst = Math.max(deviation.site, deviation.main ?? 0, deviation.height ?? 0);
  if (worst > DEVIATION_WARN && !fit.legacy && typeof console !== 'undefined') {
    console.warn(`[porto] ${l.id}: model box deviates ${(worst * 100).toFixed(0)} % from the OSM extent`, deviation);
  }

  const long = Math.max(size.x, size.z);
  const short = Math.min(size.x, size.z);
  const view = rule.view ?? (spec.view != null && spec.yaw != null ? spec.view - spec.yaw : 0) + 0.6;
  Object.assign(fit, {
    geometry: g,
    glass,
    pieces,
    markers,
    pivot,
    yaw: frame.yaw,
    frame,
    footprint,
    sx: S,
    sy: S,
    sz: S,
    uniform: true,
    mismatch: 1,
    target: { cx: pivot.x, cz: pivot.z, L: long * S, W: short * S, bearing: src.bearing_deg ?? 0 },
    base: baseM * S,
    baseM,
    rise: (Math.max(...samplePoly(frame.outline, rawM)) - baseM) * S,
    box,
    frameBox,
    plan,
    padPlan,
    padLevel,
    draped: !!groundLine,
    sizeM: { long, short, height: H, x: size.x, z: size.z, y0: mb.min.y },
    extentM: { x: eb.w, z: eb.d, outlineX: ob.w, outlineZ: ob.d },
    mainM: main ? { x: main.max.x - main.min.x, z: main.max.z - main.min.z, h: main.max.y } : null,
    deviation,
    worst,
    frontDeg: frame.front,
    viewBearing: frame.yaw + view,
  });
  return fit;
}

// Pad under a fitted landmark: level ground at the base, over the model
// box or only over the level parts of a site. Falloff 5..16 world units.
export function padFor(fit) {
  const p = fit.padPlan;
  const fall = p.fall ?? THREE.MathUtils.clamp(Math.max(p.hu, p.hv) * 0.25, 5, 16);
  const pad = { cx: p.cx, cz: p.cz, ux: p.ux, uz: p.uz, hu: p.hu, hv: p.hv, fall, y: fit.base };
  if (fit.padLevel) pad.yAt = (u, v, x, z) => fit.padLevel(x, z);
  return pad;
}
