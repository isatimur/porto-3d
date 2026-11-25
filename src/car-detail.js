// Street-level vehicles for walk mode (porto-036). The traffic in life.js was
// made for the map from above: a car is three boxes. At street level the
// walker's eye is 1.7 m off the road and the cars pass within metres, so the
// cars near the walker (and the few STCP buses) use these bodies instead: a
// bonnet and boot that fall away, a cabin of dark glass, four wheels with
// hubs, head and tail lamps, bumpers and plates. Built in code, 424
// triangles a car and 500 a bus (the cheap car: 36), instanced like the
// cheap ones, one material for both: two more draw calls in walk mode.
//
// Colours: `color` is the part's own colour; aPaint 1 takes the instance
// colour (the paint), 0 keeps the part's colour (glass, tyres, lamps).
// aLamp: 1 head lamp, 2 tail lamp, 3 lit interior / route board; they glow
// at night. +z is the front, metres, then scaled to world units.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { S } from './geo.js';

function part(geo, color, paint = 0, lamp = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  const col = new THREE.Color(color);
  for (let i = 0; i < n; i++) col.toArray(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aPaint', new THREE.BufferAttribute(new Float32Array(n).fill(paint), 1));
  g.setAttribute('aLamp', new THREE.BufferAttribute(new Float32Array(n).fill(lamp), 1));
  return g;
}

function box(w, h, d, x, y, z, color, paint = 0, lamp = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return part(g, color, paint, lamp);
}

// a side profile [[z, y], ...] extruded across the car, centred on x = 0
// (street-kit.js builds the parked car from it too)
export function profile(pts, width, bevel = 0) {
  const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(sh, {
    depth: width - 2 * bevel,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 1,
  });
  g.translate(0, 0, -(width - 2 * bevel) / 2);
  g.rotateY(-Math.PI / 2); // shape x -> +z (the length), extrusion -> x
  return g;
}

// tyre and hub on one side (sx = +-1), axle at z, radius r, tyre width w
function wheel(sx, z, r, w, x) {
  const tyre = new THREE.CylinderGeometry(r, r, w, 10, 1);
  tyre.rotateZ(Math.PI / 2);
  tyre.translate(sx * x, r, z);
  const hub = new THREE.CircleGeometry(r * 0.55, 8);
  hub.rotateY((sx * Math.PI) / 2);
  hub.translate(sx * (x + w / 2 + 0.005), r, z);
  return [part(tyre, 0x161616), part(hub, 0x9ea3a8)];
}

const GLASS = 0x1a2128;
const TRIM = 0x26282a;

// a small family hatchback / saloon, 4.4 x 1.8 m, as the cheap car
export function carDetailGeometry() {
  const b = 0.06; // the bevel rounds every edge of the body by 6 cm
  const parts = [
    // lower body: bumper, a bonnet that falls to the nose, a short boot
    profile(
      [
        [-2.14, 0.34],
        [2.12, 0.34],
        [2.19, 0.46],
        [2.17, 0.62],
        [1.96, 0.76],
        [0.92, 0.88],
        [-1.62, 0.92],
        [-2.1, 0.84],
        [-2.17, 0.62],
        [-2.17, 0.46],
      ],
      1.78,
      b,
    ),
  ].map((g) => part(g, 0xffffff, 1));
  // the cabin: raked windscreen and rear window, narrower at the roof
  const cab = profile(
    [
      [0.9, 0.9],
      [0.02, 1.38],
      [-1.08, 1.4],
      [-1.66, 0.93],
    ],
    1.5,
  );
  const P = cab.attributes.position;
  for (let i = 0; i < P.count; i++) if (P.getY(i) > 1.2) P.setX(i, P.getX(i) * 0.86);
  cab.computeVertexNormals();
  parts.push(part(cab, GLASS));
  // painted roof panel over the glass
  parts.push(box(1.22, 0.05, 1.02, 0, 1.38, -0.53, 0xffffff, 1));
  // bumpers, grille, plates
  parts.push(box(1.8, 0.2, 0.12, 0, 0.3, 2.2, TRIM), box(1.8, 0.2, 0.12, 0, 0.3, -2.2, TRIM));
  parts.push(box(0.84, 0.12, 0.04, 0, 0.6, 2.24, 0x141516));
  parts.push(box(0.52, 0.11, 0.03, 0, 0.36, 2.275, 0xeceae2), box(0.52, 0.11, 0.03, 0, 0.36, -2.275, 0xeceae2));
  // head and tail lamps
  for (const sx of [-1, 1]) {
    parts.push(box(0.34, 0.12, 0.06, sx * 0.6, 0.62, 2.24, 0xe9eef0, 0, 1));
    parts.push(box(0.32, 0.13, 0.06, sx * 0.62, 0.68, -2.23, 0xa3150f, 0, 2));
    // door mirrors
    parts.push(box(0.12, 0.1, 0.16, sx * 0.93, 0.95, 0.72, 0xffffff, 1));
  }
  // four wheels, pushed a hair out of the body side so they read from the pavement
  for (const sx of [-1, 1]) for (const z of [1.36, -1.36]) parts.push(...wheel(sx, z, 0.31, 0.22, 0.8));
  const g = mergeGeometries(parts);
  g.scale(S, S, S);
  return g;
}

// the STCP city bus, 12 x 2.5 m (white, with the blue and green bands)
export function busDetailGeometry() {
  const parts = [
    profile(
      [
        [-5.98, 0.36],
        [5.96, 0.36],
        [6.0, 2.7],
        [5.82, 3.08],
        [-5.86, 3.08],
        [-6.0, 2.8],
      ],
      2.5,
      0.07,
    ),
  ].map((g) => part(g, 0xffffff, 1));
  // side windows (lit inside at night), windscreen, rear window
  parts.push(box(2.54, 0.98, 9.4, 0, 1.52, -0.55, GLASS, 0, 3));
  // window pillars, and the front and middle doors on the kerb side (-x is
  // the right of travel)
  for (let k = 0; k < 6; k++) parts.push(box(2.56, 0.98, 0.12, 0, 1.52, -4.6 + k * 1.62, 0xffffff, 1));
  parts.push(box(0.04, 2.3, 1.15, -1.27, 0.4, 4.85, GLASS), box(0.04, 2.3, 1.2, -1.27, 0.4, 0.2, GLASS));
  parts.push(box(2.3, 1.62, 0.06, 0, 1.18, 6.0, GLASS));
  parts.push(box(2.1, 0.8, 0.06, 0, 1.9, -6.02, GLASS));
  // the livery bands, the route board, the roof air unit
  parts.push(box(2.55, 0.16, 11.6, 0, 0.98, 0, 0x187ec2), box(2.55, 0.12, 11.6, 0, 1.16, 0, 0x2e8b57));
  parts.push(box(1.9, 0.32, 0.06, 0, 2.74, 6.03, 0x14120f), box(1.6, 0.1, 0.07, 0, 2.85, 6.04, 0xf6efdc, 0, 3));
  parts.push(box(1.6, 0.26, 3.2, 0, 3.08, -1.2, 0x9aa0a4));
  parts.push(box(2.5, 0.3, 0.12, 0, 0.32, 6.0, TRIM), box(2.5, 0.3, 0.12, 0, 0.32, -6.0, TRIM));
  for (const sx of [-1, 1]) {
    parts.push(box(0.3, 0.2, 0.06, sx * 0.95, 0.72, 6.02, 0xe9eef0, 0, 1));
    parts.push(box(0.22, 0.4, 0.06, sx * 1.05, 0.8, -6.02, 0xa3150f, 0, 2));
    for (const z of [3.9, -2.7]) parts.push(...wheel(sx, z, 0.5, 0.3, 1.12));
  }
  const g = mergeGeometries(parts);
  g.scale(S, S, S);
  return g;
}

// uniforms: life.js LIFE_UNIFORMS (uLifeNight, uLifeGlow)
export function carDetailMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.25 });
  mat.customProgramCacheKey = () => 'car-detail';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPaint;\nattribute float aLamp;\nvarying float vLamp;')
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
#ifdef USE_INSTANCING_COLOR
vColor.rgb = color.rgb * mix(vec3(1.0), instanceColor.rgb, aPaint);
#endif
vLamp = aLamp;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uLifeNight;\nuniform float uLifeGlow;\nvarying float vLamp;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float head = step(0.5, vLamp) * step(vLamp, 1.5);
  float tail = step(1.5, vLamp) * step(vLamp, 2.5);
  float room = step(2.5, vLamp);
  totalEmissiveRadiance += (head * vec3(1.0, 0.92, 0.75) * 1.6 + tail * vec3(1.0, 0.07, 0.03) * 1.6 + room * vec3(1.0, 0.7, 0.38) * 0.9) * uLifeNight * uLifeGlow;
}`,
      );
  };
  return mat;
}
