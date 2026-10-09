// Places one procedural model per landmark at its real position, bearing
// and size (src/fit.js does the fit), plus its OSM outline as a gold line
// on the ground, an instanced gold pin and an HTML label.
//
// One mesh per landmark, so the category filter is a visibility toggle.
// Real scale is the only view: every model stays 1:1 at any camera
// distance (mesh scale 1, no morph). Only the pins and the HTML labels
// change size on screen.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { createStoneTextures, createAzulejoTexture } from './textures.js';
import { shrinkCheck, SHRINK_MIN } from './fit.js';
import { S } from './geo.js';

// Far LOD (performance): far away a model draws a vertex-clustered copy of
// itself, grid cell = bounding radius / LOD_K, about 23 % of the triangles
// over all models. It switches only when a cell is below ~0.75 device px,
// so the swap is invisible; the size stays 1:1. Built lazily, one model per
// frame. The selected model always keeps its full geometry.
const LOD_K = 60;
const LOD_ON_PX = 0.75;
const LOD_OFF_PX = 0.9;
const TAN_HALF_FOV = Math.tan(THREE.MathUtils.degToRad(38 / 2)); // main.js camera

// Distance LOD (performance): within the near radius a landmark draws its
// real geometry (plus the screen-size cluster LOD below). Beyond it, the
// detailed mesh is hidden and one shared instanced massing box stands in,
// so a 60-landmark city spends its triangles only around the camera while
// every landmark stays visible, labelled and pickable (pins and picking use
// the fitted box, not the mesh). Bigger landmarks keep full detail farther
// out (sizeK x bounding radius). Phones (lite) get the tighter radius.
const LOD_TIER = {
  high: { nearM: 2200, sizeK: 3 },
  low: { nearM: 1400, sizeK: 2 },
};

// Vertex clustering of a non-indexed geometry: every vertex moves to the
// mean position of its grid cell; triangles that collapse (two corners in
// one cell) or repeat (same three cells) are dropped. The other attributes
// (normal, colour, ids) are copied from the original corners.
function clusterGeometry(g, cell) {
  const pos = g.attributes.position.array;
  const nV = pos.length / 3;
  const keyOf = new Array(nV);
  const sum = new Map();
  for (let v = 0; v < nV; v++) {
    const k = `${Math.round(pos[v * 3] / cell)},${Math.round(pos[v * 3 + 1] / cell)},${Math.round(pos[v * 3 + 2] / cell)}`;
    keyOf[v] = k;
    let s = sum.get(k);
    if (!s) sum.set(k, (s = [0, 0, 0, 0]));
    s[0] += pos[v * 3];
    s[1] += pos[v * 3 + 1];
    s[2] += pos[v * 3 + 2];
    s[3]++;
  }
  const keep = [];
  const seen = new Set();
  for (let t = 0; t < nV / 3; t++) {
    const a = keyOf[t * 3];
    const b = keyOf[t * 3 + 1];
    const c = keyOf[t * 3 + 2];
    if (a === b || b === c || a === c) continue;
    const id = a < b ? (b < c ? `${a}|${b}|${c}` : a < c ? `${a}|${c}|${b}` : `${c}|${a}|${b}`) : a < c ? `${b}|${a}|${c}` : b < c ? `${b}|${c}|${a}` : `${c}|${b}|${a}`;
    if (seen.has(id)) continue;
    seen.add(id);
    keep.push(t);
  }
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const n = attr.itemSize;
    const src = attr.array;
    const dst = new src.constructor(keep.length * 3 * n);
    let o = 0;
    for (const t of keep) {
      for (let v = t * 3; v < t * 3 + 3; v++) {
        if (name === 'position') {
          const s = sum.get(keyOf[v]);
          dst[o++] = s[0] / s[3];
          dst[o++] = s[1] / s[3];
          dst[o++] = s[2] / s[3];
        } else for (let i = 0; i < n; i++) dst[o++] = src[v * n + i];
      }
    }
    out.setAttribute(name, new THREE.BufferAttribute(dst, n, attr.normalized));
  }
  out.userData = g.userData;
  out.computeBoundingBox();
  out.boundingSphere = g.boundingSphere.clone();
  return out;
}

const PIN_ANGLE = 0.018; // pin height / camera distance: about 24 px on a 900 px view
const PIN_MIN = 0.05; // world units: in a close-up the pin stays small
const OUTLINE_LIFT = 0.25;

// Focus: while a landmark is selected the others dim a little, and any
// other model standing between the camera and it turns see-through
// (screen-door dither), so a close-up in the crowded centre stays legible.
const FOCUS = {
  uActive: { value: -1 },
  uFocus: { value: new THREE.Vector3() },
  uFocusR: { value: 0 },
  uFocusK: { value: 0 },
  uLm: { value: [] }, // per landmark: bounding sphere (x, y, z, r)
};

// Night lamps on the models (the Douro bridges' bulbs and floods): a vertex
// with aEmit >= 2 glows by night only, at weight aEmit - 2. main.js sets the
// night value (0..1) every frame.
export const LAMP_UNIFORM = { uLampNight: { value: 0 } };

function stoneMaterial(count) {
  const { detail: tDetail, tone: tTone, normal: tNormal } = createStoneTextures();
  const tAzulejo = createAzulejoTexture();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0,
  });
  // aEmit: per-vertex emissive weight for gold, water and lit windows.
  // aMat/aUv: surface id and wall-aligned coordinates for the detail maps.
  // aLid: landmark index, for the focus effect.
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tDetail = { value: tDetail };
    sh.uniforms.tTone = { value: tTone };
    sh.uniforms.tNormal = { value: tNormal };
    sh.uniforms.tAzulejo = { value: tAzulejo };
    Object.assign(sh.uniforms, FOCUS, LAMP_UNIFORM);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aEmit;\nattribute float aMat;\nattribute float aLid;\nattribute vec2 aUv;\nvarying float vEmit;\nvarying float vMat;\nvarying float vLid;\nvarying vec2 vDUv;\nvarying vec3 vWPos;\nvarying float vNy;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmit = aEmit;\nvMat = aMat;\nvLid = aLid;\nvDUv = aUv;\nvNy = objectNormal.y;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vEmit;
varying float vMat;
varying float vLid;
varying vec2 vDUv;
varying vec3 vWPos;
varying float vNy;
uniform float uLampNight;
uniform sampler2D tDetail;
uniform sampler2D tTone;
uniform sampler2D tNormal;
uniform sampler2D tAzulejo;
// tangent-space normal map on the wall-aligned uv (three.js perturbNormal2Arb)
vec3 brgTBN(vec3 eye_pos, vec3 surf_norm, vec2 uv, vec3 mapN, float faceDir) {
  vec3 q0 = dFdx(eye_pos);
  vec3 q1 = dFdy(eye_pos);
  vec2 st0 = dFdx(uv);
  vec2 st1 = dFdy(uv);
  vec3 q1perp = cross(q1, surf_norm);
  vec3 q0perp = cross(surf_norm, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float scale = (det == 0.0) ? 0.0 : faceDir * inversesqrt(det);
  return normalize(T * (mapN.x * scale) + B * (mapN.y * scale) + surf_norm * mapN.z);
}
uniform float uActive;
uniform vec3 uFocus;
uniform float uFocusR;
uniform float uFocusK;
uniform vec4 uLm[${Math.max(1, count)}];
vec3 brgPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
  vec3 vSigmaX = normalize(dFdx(surf_pos));
  vec3 vSigmaY = normalize(dFdy(surf_pos));
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDir;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
bool brgOther = uActive > -0.5 && abs(vLid - uActive) > 0.5;
if (brgOther && uFocusK > 0.5) {
  // whole-object test: does this landmark's sphere block the view cone
  // from the camera to the selected one?
  vec4 brgS = uLm[int(vLid + 0.5)];
  vec3 brgD = uFocus - cameraPosition;
  float brgL = length(brgD);
  vec3 brgP = brgS.xyz - cameraPosition;
  float brgT = dot(brgP, brgD) / (brgL * brgL);
  float brgR = length(brgP - brgD * brgT);
  if (brgT > 0.0 && brgT < 1.0 - uFocusR / brgL * 0.5 && brgR < brgS.w + uFocusR * 0.9) {
    // keep one pixel in eight: a faint ghost of the occluder
    vec2 brgC = mod(floor(gl_FragCoord.xy), vec2(4.0, 2.0));
    if (brgC.x + brgC.y > 0.5) discard;
  }
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
if (brgOther) {
  float brgL = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(brgL), 0.3 * uFocusK) * (1.0 - 0.22 * uFocusK);
}
int brgM = int(vMat + 0.5);
float brgH = 0.0;
float brgBump = 0.0;
float brgRough = roughness;
vec2 brgNUv = vec2(0.0);    // uv of the normal map, when one applies
vec2 brgN = vec2(0.0);
float brgWall = 1.0 - step(0.5, abs(vNy)); // vertical-ish faces
if (brgM == 1) {            // granite ashlar: two-tone blocks, thin joints
  brgNUv = vDUv * 0.22;
  brgH = texture2D(tDetail, brgNUv).r;
  vec4 brgT = texture2D(tTone, brgNUv);
  diffuseColor.rgb *= mix(vec3(0.95, 0.97, 1.01), vec3(1.05, 1.0, 0.9), brgT.r) * mix(0.8, 1.1, brgH);
  diffuseColor.rgb *= 1.0 - 0.22 * brgT.g;
  brgN = texture2D(tNormal, brgNUv).rg * 2.0 - 1.0;
} else if (brgM == 2) {     // canal roof tiles, lapped rows, grime
  brgNUv = vDUv * vec2(0.14, 0.2);
  brgH = texture2D(tDetail, brgNUv).g;
  diffuseColor.rgb *= mix(0.6, 1.15, brgH);
  float brgG = smoothstep(0.5, 0.85, texture2D(tTone, vDUv * 0.04).a);
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.72, 0.7, 0.62), brgG * 0.7);
  brgN = texture2D(tNormal, brgNUv).ba * 2.0 - 1.0;
  brgRough = 0.8;
} else if (brgM == 3) {     // lime render: soft mottling, rain streaks, damp base
  brgH = texture2D(tDetail, vDUv * 0.05).b;
  diffuseColor.rgb *= mix(0.9, 1.05, brgH);
  float brgS = texture2D(tTone, vec2(vDUv.x * 0.18, vDUv.y * 0.035)).b;
  diffuseColor.rgb *= 1.0 - 0.045 * smoothstep(0.55, 0.9, brgS) * brgWall;
  float brgDirt = (1.0 - smoothstep(0.1, 2.4, vDUv.y)) * step(-0.4, vDUv.y) * brgWall;
  brgDirt *= 0.55 + 0.45 * texture2D(tTone, vDUv * 0.12).a;
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.86, 0.84, 0.77), brgDirt);
  brgBump = 0.15;
  brgRough = 0.92;
} else if (brgM == 4) {     // azulejo (14 cm tiles)
  diffuseColor.rgb *= texture2D(tAzulejo, vDUv * 0.9).rgb;
  brgRough = 0.3;
} else if (brgM == 5) {     // foliage and grass
  brgH = texture2D(tDetail, vDUv * 0.3).b;
  diffuseColor.rgb *= mix(0.62, 1.25, brgH);
  #ifdef USE_FOG
  // season tint for model foliage (avenue trees, lawns, hedges): spring fresh + blossom, autumn rust, winter dull
  diffuseColor.rgb *= seasonW.x * vec3(1.08, 1.14, 0.9) + vec3(seasonW.y) + seasonW.z * vec3(1.5, 1.0, 0.6) + seasonW.w * vec3(0.95, 0.88, 0.85);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.5, 0.58), seasonW.x * smoothstep(0.62, 0.78, brgH) * 0.6);
  #endif
  brgBump = 0.6;
  brgRough = 0.95;
} else if (brgM == 6) {     // slate and lead
  brgH = texture2D(tDetail, vDUv * vec2(0.22, 0.3)).a;
  diffuseColor.rgb *= mix(0.7, 1.12, brgH);
  brgBump = 0.8;
  brgRough = 0.6;
} else if (brgM == 7) {     // water
  brgRough = 0.12;
} else if (brgM == 8) {     // carved or smooth stone, earth
  brgH = texture2D(tDetail, vDUv * 0.12).b;
  diffuseColor.rgb *= mix(0.86, 1.08, brgH);
  brgBump = 0.25;
} else if (brgM == 9) {     // metal
  brgRough = 0.42;
}`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = brgRough;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
float brgFade = smoothstep(1500.0, 250.0, length(vViewPosition));
if (brgM == 1 || brgM == 2) {
  vec3 brgMapN = vec3(brgN * brgFade, 1.0);
  brgMapN.z = sqrt(max(0.05, 1.0 - dot(brgMapN.xy, brgMapN.xy)));
  normal = brgTBN(-vViewPosition, normal, brgNUv, brgMapN, faceDirection);
} else if (brgBump > 0.0) {
  vec2 brgD = clamp(vec2(dFdx(brgH), dFdy(brgH)), -0.2, 0.2) * brgBump * brgFade;
  normal = brgPerturb(-vViewPosition, normal, brgD, faceDirection);
}`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nif (vEmit >= 1.9) totalEmissiveRadiance += vec3(1.0, 0.8, 0.46) * (vEmit - 2.0) * uLampNight * 1.5; else totalEmissiveRadiance += min(vColor.rgb * vEmit * 0.5, vec3(0.8));');
  };
  mat.customProgramCacheKey = () => 'porto-stone-v7';
  return mat;
}

function glassMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xa8cad6,
    roughness: 0.08,
    metalness: 0.1,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// Far placeholder: a plain box, no shadows, one instanced draw for all the
// landmarks beyond the near radius. Reads as the model's mass at a distance.
function massingMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xb3ab9e, roughness: 0.95, metalness: 0 });
  m.name = 'landmarks-massing';
  return m;
}

// Put a moving part on its track at t (0 = first point, 1 = last, by arc
// length): position, heading along the track, pitch with the slope.
// The part's local +z points toward increasing t.
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
function poseOnTrack(m, t) {
  const d = m.userData;
  const A = d.track;
  d.t = THREE.MathUtils.clamp(t, 0, 1);
  const P = (i, v) => v.fromArray(A[i]);
  let total = 0;
  const seg = [];
  for (let i = 1; i < A.length; i++) {
    const l = P(i, _pb).distanceTo(P(i - 1, _pa));
    seg.push(l);
    total += l;
  }
  let s = d.t * total;
  let i = 0;
  while (i < seg.length - 1 && s > seg[i]) s -= seg[i++];
  P(i, _pa);
  P(i + 1, _pb);
  const u = seg[i] > 0 ? Math.min(1, s / seg[i]) : 0;
  m.position.lerpVectors(_pa, _pb, u);
  _pb.sub(_pa);
  m.rotation.set(Math.atan2(-_pb.y, Math.hypot(_pb.x, _pb.z)), Math.atan2(_pb.x, _pb.z), 0);
  return m;
}

// fits: fitLandmark() results, one per landmark in list order.
// outlines: per landmark the OSM outline in world {x, z} (or null).
// opts.lite: phone/light tier, opts.massing: draw far landmarks as boxes.
export function buildLandmarks(list, fits, heightAt, outlines, onLabelClick, opts = {}) {
  const tier = opts.lite ? LOD_TIER.low : LOD_TIER.high;
  // the adaptive governor (main.js) can shrink this at runtime
  let lodNearU = tier.nearM * S;
  const LOD_SIZE_K = tier.sizeK;
  const MASSING = opts.massing !== false;
  const group = new THREE.Group();
  group.name = 'landmarks';
  const material = stoneMaterial(list.length);
  const glassMat = glassMaterial();
  const outlineMat = new LineMaterial({ color: 0xffc862, linewidth: 1.6, transparent: true, opacity: 0.9, depthWrite: false });
  outlineMat.toneMapped = false;
  outlineMat.fog = true;

  let fountainCount = 0;
  const items = list.map((l, index) => {
    const fit = fits[index];
    const g = fit.geometry;
    // per-landmark id for the focus effect in the shader
    g.setAttribute('aLid', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(index), 1));
    const mesh = new THREE.Mesh(g, material);
    mesh.position.copy(fit.pivot);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `landmark-${l.id}`;
    group.add(mesh);
    const meshes = [mesh];
    // moving parts: own meshes, children of the model, so visibility
    // follows it (the Bom Jesus funicular cars are life.js' own now)
    const movers = [];
    for (const p of fit.pieces || []) {
      const pg = p.geometry;
      pg.setAttribute('aLid', new THREE.BufferAttribute(new Float32Array(pg.attributes.position.count).fill(index), 1));
      const pm = new THREE.Mesh(pg, material);
      pm.name = p.name;
      pm.castShadow = true;
      pm.receiveShadow = true;
      Object.assign(pm.userData, p.data, { landmark: l.id });
      if (p.data.track) {
        pm.rotation.order = 'YXZ';
        pm.userData.setT = (t) => poseOnTrack(pm, t);
        poseOnTrack(pm, p.data.t ?? 0);
      }
      mesh.add(pm);
      movers.push(pm);
    }
    // named points (fountains): empty objects at the spout / basin centre,
    // numbered across all landmarks in list order
    const points = [];
    for (const m of fit.markers || []) {
      const o = new THREE.Object3D();
      o.name = m.name === 'fountain' ? `fountain-${fountainCount++}` : m.name;
      o.position.fromArray(m.pos);
      Object.assign(o.userData, m.data, { landmark: l.id, pos: m.pos });
      mesh.add(o);
      points.push(o);
    }
    if (fit.glass) {
      const gm = new THREE.Mesh(fit.glass, glassMat);
      gm.position.copy(fit.pivot);
      gm.renderOrder = 2;
      gm.name = `glass-${l.id}`;
      group.add(gm);
      meshes.push(gm);
    }

    // the OSM outline, draped on the (padded) ground
    let outline = null;
    const poly = outlines[index];
    if (poly && poly.length > 2) {
      const arr = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 3));
        for (let k = 0; k < n; k++) {
          const x0 = a.x + ((b.x - a.x) * k) / n;
          const z0 = a.z + ((b.z - a.z) * k) / n;
          const x1 = a.x + ((b.x - a.x) * (k + 1)) / n;
          const z1 = a.z + ((b.z - a.z) * (k + 1)) / n;
          arr.push(x0, heightAt(x0, z0) + OUTLINE_LIFT, z0, x1, heightAt(x1, z1) + OUTLINE_LIFT, z1);
        }
      }
      const lg = new LineSegmentsGeometry();
      lg.setPositions(arr);
      outline = new LineSegments2(lg, outlineMat);
      outline.name = `outline-${l.id}`;
      outline.renderOrder = 6;
      outline.frustumCulled = false;
      group.add(outline);
    }

    const spec = fit.spec || {};
    const viewOffset = spec.view != null && spec.yaw != null ? spec.view - spec.yaw : 0;
    const viewBearing = fit.viewBearing ?? fit.yaw + viewOffset + 0.6;
    return {
      data: l,
      index,
      fit,
      meshes,
      movers,
      points,
      outline,
      draped: !!fit.draped, // climbs the real slope (Bom Jesus): framing uses the box bottom
      type: g.userData.type,
      // distance-LOD state, recomputed in updateLod(); catOn follows the
      // category filter (setHiddenCategories)
      catOn: true,
      lodNear: true,
      lodFar: false,
      x: fit.target.cx,
      z: fit.target.cz,
      base: fit.base,
      yaw: fit.yaw,
      // best viewing bearing: 35 degrees off the main front (camera.frame)
      viewBearing,
      // framing, pins and picking use the subject's box (fit.frameBox)
      realBox: (fit.frameBox || fit.box).clone(),
      box: (fit.frameBox || fit.box).clone(),
      center: new THREE.Vector3(),
      sphere: new THREE.Sphere(),
    };
  });

  // Pose of one landmark at its real size: box, centre, sphere, top.
  const pivotY = (it) => it.fit.pivot.y || it.base;
  function pose(it) {
    it.box.copy(it.realBox);
    it.top = it.box.max.y;
    it.height = it.top - pivotY(it);
    it.box.getCenter(it.center);
    it.center.y = pivotY(it) + it.height * 0.4;
    const size = it.box.getSize(new THREE.Vector3());
    it.radius = 0.5 * Math.hypot(size.x, size.z);
    it.sphere.set(it.center, Math.max(0.5 * size.length(), 1));
  }
  for (const it of items) pose(it);

  // Never-shrink guard (the rule of scripts/check-fit.mjs): a model smaller
  // than 97 % of its real plan or height is a bug, say so in the console.
  const shrink = items.map((it) => shrinkCheck(it.fit));
  for (const s of shrink) {
    if (s.ok) continue;
    const pct = (v) => (v == null ? '-' : `${(v * 100).toFixed(1)} %`);
    console.warn(`[porto] ${s.id}: model smaller than real (min ${SHRINK_MIN * 100} %): x ${pct(s.ratio.x)}, z ${pct(s.ratio.z)}, h ${pct(s.ratio.h)}`);
  }
  // 1:1 at any distance: every landmark mesh keeps scale 1 and no morph
  function realScale() {
    return items.every((it) => it.meshes.every((m) => m.scale.x === 1 && m.scale.y === 1 && m.scale.z === 1 && !m.morphTargetInfluences));
  }

  function writeFocusSpheres() {
    FOCUS.uLm.value = items.map((it) => new THREE.Vector4(it.center.x, it.center.y, it.center.z, Math.max(it.radius * 0.7, it.height * 0.45)));
  }
  writeFocusSpheres();

  // Gold pins: one instanced draw for all of them.
  const pinGeo = new THREE.OctahedronGeometry(1, 0);
  pinGeo.scale(0.3, 0.5, 0.3); // unit height
  const pinMat = new THREE.MeshBasicMaterial({ color: 0xffc862, transparent: true, opacity: 0.92 });
  pinMat.toneMapped = false;
  const pins = new THREE.InstancedMesh(pinGeo, pinMat, items.length);
  pins.name = 'pins';
  pins.frustumCulled = false;
  group.add(pins);

  // Far LOD: one instanced box per landmark, sized to its fitted box. Only
  // the ones beyond the near radius are drawn (scale 0 otherwise), so the
  // whole distant city is one draw call.
  const massing = MASSING ? new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), massingMaterial(), items.length) : null;
  if (massing) {
    massing.name = 'landmark-massing';
    massing.frustumCulled = false;
    massing.castShadow = false;
    massing.receiveShadow = false;
    massing.userData.castOrig = false; // keep tiles.js' shadow pass off it
    massing.count = items.length;
    group.add(massing);
  }

  // Labels (HTML). Buttons so they are focusable and clickable.
  for (const it of items) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'map-label';
    el.textContent = it.data.name;
    el.tabIndex = -1; // the list is the keyboard path; labels are for pointers
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      onLabelClick(it.index);
    });
    const obj = new CSS2DObject(el);
    obj.center.set(0.5, 1);
    group.add(obj);
    it.label = obj;
    it.labelEl = el;
    it.pinH = 4;
  }

  const hidden = new Set();
  let activeIndex = -1;
  const _m = new THREE.Matrix4();
  const _pos = new THREE.Vector3();
  const _scl = new THREE.Vector3();
  const _rot = new THREE.Quaternion();
  const _up = new THREE.Vector3(0, 1, 0);
  const _mc = new THREE.Vector3();
  const _msz = new THREE.Vector3();
  const _mq = new THREE.Quaternion(); // identity: massing boxes stay axis-aligned

  // Pins keep a constant screen size (height = PIN_ANGLE x distance), so a
  // 10 m tower seen from the whole-city view is still a findable gold mark.
  // far LOD (LOD_K above): device pixels per world unit at distance 1
  let pxPerUnit = 900 / 2 / TAN_HALF_FOV;
  // The governor's close-range cut: above 1 a landmark takes its clustered
  // copy (about a quarter of the triangles) while its grid cell is still
  // that many times larger on screen (main.js applyKnobs sets it from `geo`).
  let lodBias = 1;

  // Distance LOD: decide per landmark whether it draws its own geometry or
  // the shared massing box. Then apply category + LOD visibility and write
  // the massing instance matrices.
  function updateLod(camPos) {
    let built = false;
    for (const it of items) {
      const d = Math.max(1, camPos.distanceTo(it.center));
      const R = lodNearU + it.radius * LOD_SIZE_K;
      it.lodFar = d > (it.lodFar ? R * 0.9 : R); // 10 % hysteresis
      it.lodNear = !it.lodFar;
      const active = it.index === activeIndex;
      const mesh = it.meshes[0];
      // within the near radius (or the selection), keep the real geometry;
      // tiny-on-screen models still fall back to the vertex-clustered copy
      if (it.lodNear) {
        const L = (mesh.userData.lod ??= { full: mesh.geometry, far: null, r: 0 });
        if (!L.r) {
          if (!L.full.boundingSphere) L.full.computeBoundingSphere();
          L.r = L.full.boundingSphere.radius;
        }
        const cellPx = ((L.r / LOD_K) * pxPerUnit) / d;
        const onFar = mesh.geometry !== L.full;
        const want = !active && cellPx < (onFar ? LOD_OFF_PX : LOD_ON_PX) * lodBias;
        if (want && !L.far) {
          if (built) {
            mesh.geometry = L.full; // one cluster build per frame
            continue;
          }
          L.far = clusterGeometry(L.full, L.r / LOD_K);
          built = true;
        }
        const geo = want ? L.far : L.full;
        if (mesh.geometry !== geo) mesh.geometry = geo;
      }
    }
    applyVisibility();
  }

  // Category filter + distance LOD in one place: the detailed meshes and
  // movers draw only when their category is on and they are near (the
  // selection always full); the massing boxes cover the rest.
  function applyVisibility() {
    for (const it of items) {
      const full = it.catOn && (it.lodNear || it.index === activeIndex);
      for (const m of it.meshes) m.visible = full;
      for (const mv of it.movers) mv.visible = full;
      if (it.outline) it.outline.visible = full;
      it.label.visible = it.catOn;
      if (!massing) continue;
      // Parks, gardens and beaches are low and wide (Parque da Cidade
      // 1.4 x 0.9 km, 6 m): as a box they read as a flat grey slab on the
      // land, so far away they draw nothing (the land cover and the pin say
      // enough). A big building keeps a box, but only as large in plan as a
      // block of about 12 000 m2: a stadium is a mass, not a lot.
      let wide = false;
      if (it.catOn && !full) {
        it.box.getCenter(_mc);
        it.box.getSize(_msz);
        const areaM2 = (_msz.x / S) * (_msz.z / S);
        wide = _msz.y / S < 14 && areaM2 > 6000;
        if (areaM2 > 12000) {
          const k = Math.max(0.35, Math.sqrt(12000 / areaM2));
          _msz.x *= k;
          _msz.z *= k;
        }
      }
      if (it.catOn && !full && !wide) {
        _msz.x = Math.max(_msz.x, 1);
        _msz.y = Math.max(_msz.y, 1);
        _msz.z = Math.max(_msz.z, 1);
        _m.compose(_mc, _mq, _msz);
        it.massing = true;
      } else {
        _m.makeScale(0, 0, 0);
        _m.setPosition(0, -1e5, 0); // collapse: nothing drawn for it
        it.massing = false;
      }
      massing.setMatrixAt(it.index, _m);
    }
    if (massing) massing.instanceMatrix.needsUpdate = true;
  }
  applyVisibility();

  function updatePins(time, animate, camPos) {
    if (camPos) updateLod(camPos);
    for (const it of items) {
      const off = hidden.has(it.data.category);
      const active = it.index === activeIndex;
      const d = camPos ? camPos.distanceTo(_pos.set(it.center.x, it.top, it.center.z)) : 1500;
      const H = Math.max(PIN_MIN, d * PIN_ANGLE) * (active ? 1.35 : 1);
      it.pinH = H;
      const bob = animate ? Math.sin(time * 1.6 + it.index * 1.3) * H * 0.12 : 0;
      it.pinY = it.top + H * 0.9 + bob;
      _pos.set(it.center.x, it.pinY, it.center.z);
      const s = off ? 0 : H;
      _scl.set(s, s, s);
      _rot.setFromAxisAngle(_up, animate ? time * 0.6 + it.index : it.index);
      _m.compose(_pos, _rot, _scl);
      pins.setMatrixAt(it.index, _m);
      it.label.position.set(it.center.x, it.top + H * 1.55, it.center.z);
    }
    pins.instanceMatrix.needsUpdate = true;
  }
  updatePins(0, false);

  function setHiddenCategories(set) {
    hidden.clear();
    for (const c of set) hidden.add(c);
    for (const it of items) it.catOn = !hidden.has(it.data.category);
    applyVisibility();
  }

  function setActive(index) {
    activeIndex = index;
    for (const it of items) it.labelEl.classList.toggle('is-active', it.index === index);
    const it = items[index];
    FOCUS.uActive.value = it ? index : -1;
    FOCUS.uFocusK.value = it ? 1 : 0;
    if (it) {
      FOCUS.uFocus.value.copy(it.center);
      FOCUS.uFocusR.value = it.radius * 0.85;
    }
    applyVisibility();
  }

  const _ray = new THREE.Vector3();
  function pick(raycaster) {
    let best = null;
    let bestD = Infinity;
    for (const it of items) {
      if (hidden.has(it.data.category)) continue;
      const pinPos = _pos.set(it.center.x, it.pinY ?? it.top, it.center.z);
      const r = Math.max(it.pinH * 0.6, 0.6);
      const pinHit = raycaster.ray.distanceSqToPoint(pinPos) < r * r;
      const hit = pinHit ? pinPos : raycaster.ray.intersectBox(it.box, _ray);
      if (!hit) continue;
      const d = raycaster.ray.origin.distanceTo(hit);
      if (d < bestD) {
        bestD = d;
        best = it.index;
      }
    }
    return best;
  }

  // Report rows for the console and window.__porto.
  const report = items.map((it) => ({
    id: it.data.id,
    size_m: [it.fit.sizeM.long, it.fit.sizeM.short, it.fit.sizeM.height].map((v) => +v.toFixed(1)),
    bearing: +it.fit.target.bearing.toFixed(1),
    front: +it.fit.frontDeg.toFixed(1),
    height_source: it.fit.heightSource,
    uniform: it.fit.uniform,
    base_m: +(it.base / S).toFixed(1),
  }));

  return {
    group,
    items,
    pins,
    massing,
    material,
    report,
    outlineMaterial: outlineMat,
    updatePins,
    setHiddenCategories,
    setActive,
    pick,
    shrink,
    realScale,
    // the distance-LOD radius of this tier, in metres (for reports/tests);
    // the adaptive governor may shrink it at runtime
    get nearRadiusM() {
      return lodNearU / S;
    },
    // adaptive: shrink the radius the full landmark meshes draw within
    setNearRadiusM(m) {
      lodNearU = Math.max(300, m) * S;
    },
    setLodBias(b) {
      lodBias = Math.max(1, Math.min(4, b || 1));
    },
    // dpr: drawing-buffer pixels per CSS pixel, for the far LOD
    setResolution(w, h, dpr = 1) {
      outlineMat.resolution.set(w, h);
      pxPerUnit = (h * dpr) / 2 / TAN_HALF_FOV;
    },
    // for tests: how many models draw their far LOD now
    get lodCount() {
      return items.filter((it) => it.meshes[0].userData.lod && it.meshes[0].geometry !== it.meshes[0].userData.lod.full).length;
    },
    // for reports: full / screen-cluster / massing counts in the last LOD pass
    get lodStats() {
      let full = 0;
      let cluster = 0;
      let massingN = 0;
      for (const it of items) {
        if (!it.catOn) continue;
        if (it.lodNear || it.index === activeIndex) {
          const L = it.meshes[0].userData.lod;
          if (L && it.meshes[0].geometry !== L.full) cluster++;
          else full++;
        } else massingN++;
      }
      return { full, cluster, massing: massingN, total: items.length, nearRadiusM: lodNearU / S };
    },
    // for reports: the triangles the landmark layer actually draws now
    get drawnStats() {
      let fullTris = 0;
      let meshes = 0;
      let massingN = 0;
      for (const it of items) {
        const full = it.catOn && (it.lodNear || it.index === activeIndex);
        if (!full) {
          if (it.catOn) massingN++;
          continue;
        }
        for (const m of it.meshes) {
          if (!m.visible) continue;
          const g = m.geometry;
          const count = g.index ? g.index.count : g.attributes.position.count;
          const drawn = g.drawRange && g.drawRange.count !== Infinity ? Math.min(count, g.drawRange.count) : count;
          fullTris += drawn / 3;
          meshes++;
        }
        for (const mv of it.movers) if (mv.visible && mv.geometry.index) fullTris += mv.geometry.index.count / 3;
      }
      return { fullTris: Math.round(fullTris), meshes, massing: massingN, massingTris: massingN * 12 };
    },
  };
}
