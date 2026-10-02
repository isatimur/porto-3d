// Falling leaves in autumn, blossom petals in spring (3d-falling-leaves
// skill, MengTo): instanced 3D leaves in world space near the camera.
//
//   - four silhouettes in one padded atlas (oak, lime, plane, a petal): a
//     two-sided, lightly folded card, paler on its back (gl_FrontFacing),
//     lit by the scene sun with a faint transmission when backlit;
//   - closed-form motion on the GPU: every leaf has persistent seeded
//     rates. It tumbles about its own width axis and slips sideways along
//     its length in step with the tumble (fastest when edge-on:
//     side = -(slip / omega) cos(angle), so d(side)/dt = slip sin(angle)),
//     with a slow wobble of its heading and a small roll. The shared wind
//     (weather.js) is integrated on the CPU with bounded steps into one
//     offset, so a change of wind never makes the leaves jump;
//   - camera-aware recycling: leaf positions are world-anchored and wrap in
//     a box centred ahead of the camera along its horizontal view; the box
//     boundaries move, the leaves do not. Each fall cycle picks a new seeded
//     spot; the reset happens at the ground, faded, and at the box edges,
//     faded;
//   - density from the trees (nature.js leaf field): autumn leaves under
//     the deciduous crowns (woods, avenues, gardens), petals under the
//     blossoming trees; the leaves fall from the local crown height to the
//     local ground, depth-tested against everything;
//   - sized to the view like the rain: at the closest orbit a leaf is a few
//     pixels; over the whole city the field fades out.
// ~1500 leaves on desktop, 500 on phones; one draw call.
import * as THREE from 'three';
import { FOG_UNIFORMS, WEATHER_UNIFORMS, CLOUD_GLSL } from './scene.js';
import { S } from './geo.js';

const CELL = 128;
const CELLS = 4; // oak, lime, plane, petal

// ------------------------------------------------------------ atlas
// R: silhouette, G: veins (darker), B: base-to-tip shade. Data, not colour.
// Each cell keeps 10 px of padding so mip levels do not bleed.
function leafAtlas() {
  const cv = document.createElement('canvas');
  cv.width = CELL * CELLS;
  cv.height = CELL;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cv.width, cv.height);
  const cx = CELL / 2;
  // shapes are drawn with the stem at the bottom (y = CELL - 10), tip at the top
  const outline = (i, pts) => {
    ctx.save();
    ctx.translate(i * CELL, 0);
    // silhouette into R and B (B gets a gradient below), full alpha
    const g = ctx.createLinearGradient(0, CELL - 10, 0, 10);
    g.addColorStop(0, 'rgb(255,0,150)');
    g.addColorStop(1, 'rgb(255,0,255)');
    ctx.fillStyle = g;
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(cx + x, y) : ctx.moveTo(cx + x, y)));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  const veins = (i, lines, w = 2) => {
    ctx.save();
    ctx.translate(i * CELL, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgb(0,150,0)';
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    for (const l of lines) {
      ctx.beginPath();
      l.forEach(([x, y], k) => (k ? ctx.lineTo(cx + x, y) : ctx.moveTo(cx + x, y)));
      ctx.stroke();
    }
    ctx.restore();
  };
  const stem = (i) => veins(i, [[[0, CELL - 4], [0, CELL - 22]]], 3);
  // 0: oak, lobed
  {
    const pts = [];
    const n = 64;
    for (let k = 0; k <= n; k++) {
      const t = k / n; // 0 base .. 1 tip, down the right side then up the left
      const side = t <= 0.5 ? 1 : -1;
      const u = t <= 0.5 ? t * 2 : (1 - t) * 2; // 0 at the base, 1 at the tip
      const w = Math.sin(Math.PI * Math.min(1, u * 1.05)) * (0.72 + 0.28 * Math.abs(Math.sin(u * Math.PI * 4.5)));
      pts.push([side * w * 34, CELL - 18 - u * 92]);
    }
    outline(0, pts);
    veins(0, [[[0, CELL - 18], [0, 16]], [[0, 80], [22, 64]], [[0, 80], [-22, 64]], [[0, 56], [20, 40]], [[0, 56], [-20, 40]]]);
    stem(0);
  }
  // 1: lime, heart-shaped with a pointed tip
  {
    const pts = [];
    const n = 64;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      const x = Math.sin(a);
      const y = Math.cos(a);
      const heart = 1 - 0.25 * Math.pow(Math.max(0, -y), 3) * (1 - Math.abs(x));
      const serr = 1 + 0.03 * Math.sin(a * 28);
      pts.push([x * 38 * heart * serr * (1 - 0.35 * Math.max(0, y)), 66 - y * 44 * (y > 0 ? 1.15 : 0.95)]);
    }
    outline(1, pts);
    veins(1, [[[0, 108], [0, 18]], [[0, 88], [26, 70]], [[0, 88], [-26, 70]], [[0, 66], [22, 48]], [[0, 66], [-22, 48]]]);
    stem(1);
  }
  // 2: plane tree, five pointed lobes
  {
    const pts = [];
    const n = 90;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      const lobes = 0.62 + 0.38 * Math.pow(Math.abs(Math.cos(a * 2.5)), 0.6);
      const r = 44 * lobes * (a > Math.PI * 0.75 && a < Math.PI * 1.25 ? 0.7 : 1);
      pts.push([Math.sin(a) * r, 68 - Math.cos(a) * r]);
    }
    outline(2, pts);
    veins(2, [[[0, 104], [0, 26]], [[0, 90], [34, 56]], [[0, 90], [-34, 56]], [[0, 90], [30, 100]], [[0, 90], [-30, 100]]]);
    stem(2);
  }
  // 3: a petal, rounded with a notch
  {
    const pts = [];
    const n = 48;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      const notch = 1 - 0.18 * Math.exp(-Math.pow((a - Math.PI) * 3, 2));
      pts.push([Math.sin(a) * 30 * (0.55 + 0.45 * Math.cos(a) * -1 + 0.45), 70 - Math.cos(a) * 44 * notch]);
    }
    outline(3, pts);
    veins(3, [[[0, 110], [0, 60]]], 1.5);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  return tex;
}

// ------------------------------------------------------------ geometry
// A card folded a little along its midrib: 3 x 3 vertices, length along z
// (stem at -0.5, tip at +0.5), width along x.
function leafGeometry() {
  const g = new THREE.PlaneGeometry(1, 1, 2, 2);
  g.rotateX(-Math.PI / 2); // lie flat, normal +y; uv.y runs toward -z
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    // fold: the halves rise from the midrib; the tip curls a touch
    p.setY(i, Math.abs(x) * 0.28 + z * z * 0.12);
    p.setZ(i, -z);
  }
  g.computeVertexNormals();
  return g;
}

function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform sampler2D uField;
uniform vec4 uFieldRect;   // x0, z0, 1/w, 1/d
uniform float uTime;
uniform vec3 uBoxMin;      // xz used
uniform float uBox;
uniform vec2 uWindOff;
uniform float uSize;
uniform vec4 uMix;         // x autumn share, y petal share, z summer share, w overall 0..1
uniform float uNear;       // fade leaves closer than this to the camera
attribute vec4 aSeed;      // box position (x, z in 0..1), cycle phase, random
attribute vec4 aRate;      // tumble omega (rad/s), wobble rate, fall speed (units/s), slip (units/s)
attribute vec4 aShape;     // shape cell, palette random, heading, wind response
varying vec2 vUv;
varying vec3 vN;
varying vec3 vPos;
varying float vPetal;
varying float vPal;
float lHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
void main() {
  // which kind: a petal (spring) or a leaf, decided per leaf
  float kindH = fract(aSeed.w * 13.1);
  float petal = step(kindH, uMix.y);
  // one fall per cycle; the timing uses a nominal 4-unit fall
  float cyc = uTime * aRate.z / 4.0 + aSeed.z;
  float id = floor(cyc);
  float prog = fract(cyc);
  // a new seeded spot every cycle (no frame-to-frame jitter)
  vec2 spot = fract(aSeed.xy + vec2(lHash(aSeed.xy * 91.7 + id * 0.137), lHash(aSeed.yx * 53.3 + id * 0.271)));
  // tumble and the slip it drives
  float omega = aRate.x;
  float ang = aSeed.w * 6.2831 + omega * uTime;
  float head = aShape.z + 0.6 * sin(uTime * aRate.y + aSeed.w * 17.0);
  vec2 dir = vec2(sin(head), cos(head));
  // the slip scales with the leaf (a leaf glides a few of its own lengths)
  float side = -(aRate.w * uSize * 6.0 / omega) * cos(ang);
  // world-anchored lattice + shared wind + slip, wrapped into the box
  vec2 p = spot * uBox + uWindOff * aShape.w + dir * side;
  p = uBoxMin.xz + mod(p - uBoxMin.xz, uBox);
  // the field: ground, tree density, crown height
  vec2 fuv = (p - uFieldRect.xy) * uFieldRect.zw;
  vec4 F = texture2D(uField, fuv);
  float inField = step(0.0, fuv.x) * step(fuv.x, 1.0) * step(0.0, fuv.y) * step(fuv.y, 1.0);
  float dens = mix(F.g, F.b, petal) * inField;
  float gate = smoothstep(kindH * 0.9 - 0.12, kindH * 0.9 + 0.12, dens * 1.4) ;
  float top = max(F.a * 0.85, 2.0);
  float y = F.r + 0.03 + top * (1.0 - prog);
  // fade in under the crown, out on the ground and at the box edges
  vec2 q = (p - uBoxMin.xz) / uBox;
  vec2 e = min(q, 1.0 - q);
  float life = smoothstep(0.0, 0.06, prog) * (1.0 - smoothstep(0.9, 1.0, prog));
  float edge = smoothstep(0.0, 0.1, min(e.x, e.y));
  vec3 wpos0 = vec3(p.x, y, p.y);
  float nearF = smoothstep(uNear * 0.6, uNear, distance(wpos0, cameraPosition));
  float k = gate * life * edge * nearF * uMix.w;
  float scale = uSize * (0.7 + 0.6 * fract(aSeed.w * 7.7)) * (petal > 0.5 ? 0.6 : 1.0) * k;
  // orientation: roll, tumble about the width axis, heading
  mat3 R = rotY(head) * rotX(ang) * rotZ(0.35 * sin(uTime * aRate.y * 1.7 + aSeed.w * 5.0));
  vec3 local = position * vec3(0.8, 1.0, 1.0);
  vec3 wpos = wpos0 + R * (local * scale);
  vN = R * normal;
  vPos = wpos;
  // petals use the petal cell whatever the leaf shape
  vUv = vec2((mix(aShape.x, 3.0, petal) + uv.x) / ${CELLS.toFixed(1)}, uv.y);
  vPetal = petal;
  vPal = aShape.y;
  vec4 mvPosition = viewMatrix * vec4(wpos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  if (k < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // culled
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uAtlas;
uniform vec3 uSunDir, uSunColor, uAmbient;
uniform vec4 uMix;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vPos;
varying float vPetal;
varying float vPal;
${CLOUD_GLSL}
void main() {
  // a finer mip keeps the silhouette of a leaf a few pixels wide
  vec4 t = texture2D(uAtlas, vUv, -1.0);
  if (t.r < 0.45) discard; // crisp cut-out, depth written
  // autumn palette: yellow, orange, rust, brown; a little green in summer
  vec3 a0 = vec3(0.56, 0.36, 0.05), a1 = vec3(0.5, 0.17, 0.03), a2 = vec3(0.3, 0.07, 0.02), a3 = vec3(0.22, 0.13, 0.05);
  float h = vPal * 4.0;
  vec3 autumn = h < 1.0 ? mix(a0, a1, h) : h < 2.0 ? mix(a1, a2, h - 1.0) : h < 3.0 ? mix(a2, a3, h - 2.0) : mix(a3, a0, h - 3.0);
  vec3 green = mix(vec3(0.12, 0.2, 0.04), vec3(0.3, 0.3, 0.06), vPal);
  vec3 leaf = mix(autumn, green, uMix.z);
  vec3 petal = mix(vec3(0.85, 0.55, 0.62), vec3(0.88, 0.84, 0.8), vPal);
  vec3 albedo = mix(leaf, petal, vPetal);
  albedo *= 1.0 - 0.35 * t.g;            // veins
  albedo *= 0.85 + 0.25 * (t.b - 0.6);   // darker toward the stem
  vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  if (!gl_FrontFacing) albedo = mix(albedo, vec3(dot(albedo, vec3(0.3, 0.55, 0.15))), 0.3) * 1.12; // paler back
  vec3 V = normalize(cameraPosition - vPos);
  float shade = brgCloudShade(vPos, uSunDir);
  float ndl = max(dot(N, uSunDir), 0.0);
  // transmission: a thin leaf lit from behind, tied to the sun
  float trans = pow(max(dot(-V, uSunDir), 0.0), 4.0) * max(dot(-N, uSunDir), 0.0);
  // a little wrap: a thin leaf is never pitch dark on its shaded face
  vec3 col = albedo * (uAmbient * 1.4 + uSunColor * shade * ((ndl * 0.8 + 0.2) * 0.32 + trans * 0.12));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// field: nature.leafField ({ texture, rect }); capacity: 1500 desktop, 500 phones
export function createLeaves({ field, capacity = 1500 }) {
  const quad = leafGeometry();
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  for (const k of ['position', 'normal', 'uv']) geo.setAttribute(k, quad.attributes[k]);
  const r = lcg(1105);
  const seed = new Float32Array(capacity * 4);
  const rate = new Float32Array(capacity * 4);
  const shape = new Float32Array(capacity * 4);
  for (let i = 0; i < capacity; i++) {
    seed.set([r(), r(), r(), r()], i * 4);
    const omega = (1.1 + r() * 2.4) * (r() < 0.5 ? -1 : 1);
    // fall 0.18..0.38 units/s (0.7..1.5 m/s), slip up to 0.3 units/s
    rate.set([omega, 0.25 + r() * 0.5, 0.18 + r() * 0.2, 0.12 + r() * 0.18], i * 4);
    shape.set([Math.floor(r() * 3), r(), r() * Math.PI * 2, 0.75 + r() * 0.5], i * 4);
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.setAttribute('aRate', new THREE.InstancedBufferAttribute(rate, 4));
  geo.setAttribute('aShape', new THREE.InstancedBufferAttribute(shape, 4));
  geo.instanceCount = 0;

  const f = field?.rect;
  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    ...FOG_UNIFORMS,
    ...WEATHER_UNIFORMS,
    uField: { value: field?.texture ?? null },
    uFieldRect: { value: f ? new THREE.Vector4(f.x0, f.z0, 1 / f.w, 1 / f.d) : new THREE.Vector4(0, 0, 0, 0) },
    uAtlas: { value: leafAtlas() },
    uTime: { value: 37 },
    uBoxMin: { value: new THREE.Vector3() },
    uBox: { value: 30 },
    uWindOff: { value: new THREE.Vector2() },
    uSize: { value: 0.1 },
    uMix: { value: new THREE.Vector4(1, 0, 0, 0) },
    uNear: { value: 3 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uAmbient: { value: new THREE.Color(0.3, 0.3, 0.3) },
  };
  const mat = new THREE.ShaderMaterial({
    name: 'leaves',
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'leaves';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 2;
  mesh.visible = false;

  const _fwd = new THREE.Vector3();
  let time = 37; // a composed moment for reduced motion
  const stats = { capacity, active: 0, box: 0, size: 0 };
  return {
    mesh,
    stats,
    // dt: 0 freezes (reduced motion); mix: { autumn, spring, summer, winter }
    // season weights; wind: { x, z, speed m/s }; light: { dir, color, ambient }
    update(dt, camera, camDist, mix, wind, light) {
      const amount = mix.fall + mix.spring * 0.75 + mix.summer * 0.06 + mix.winter * 0.03;
      // over the whole city the leaves are sub-pixel: fade them out
      const view = 1 - THREE.MathUtils.smoothstep(camDist, 380, 620);
      const active = Math.round(capacity * Math.min(1, amount) * (view > 0 ? 1 : 0));
      stats.active = active;
      mesh.visible = active > 0 && !!field;
      if (!mesh.visible) return;
      geo.instanceCount = active;
      const step = Math.min(Math.max(dt, 0), 1 / 20);
      time += step;
      uniforms.uTime.value = time;
      // shared wind, integrated in bounded steps: world units
      if (wind) uniforms.uWindOff.value.add({ x: wind.x * wind.speed * S * 0.35 * step, y: wind.z * wind.speed * S * 0.35 * step });
      // the box: sized to the view, in 1.25x steps, centred ahead of the
      // camera along its horizontal view, reaching past the orbit target
      const want = THREE.MathUtils.clamp(camDist * 1.2, 16, 320);
      const box = 10 * Math.pow(1.25, Math.round(Math.log(want / 10) / Math.log(1.25)));
      camera.getWorldDirection(_fwd);
      const ahead = Math.hypot(_fwd.x, _fwd.z) * camDist; // horizontal reach to the target
      _fwd.y = 0;
      if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1); // looking straight down: keep a heading
      _fwd.normalize();
      uniforms.uBox.value = box;
      uniforms.uBoxMin.value.copy(camera.position).addScaledVector(_fwd, Math.max(box * 0.3, ahead * 0.85)).subScalar(box / 2);
      // about 10 px at the orbit target: exaggerated like the rain streaks,
      // a real 6 cm leaf would be sub-pixel from the closest orbit (120 m)
      uniforms.uSize.value = THREE.MathUtils.clamp(camDist * 0.0085, 0.05, 1.2);
      uniforms.uNear.value = uniforms.uSize.value * 16;
      const petals = mix.spring / Math.max(1e-4, mix.spring + mix.fall + mix.summer + mix.winter);
      uniforms.uMix.value.set(mix.fall, petals, mix.summer / Math.max(1e-4, mix.summer + mix.fall), view);
      if (light) {
        uniforms.uSunDir.value.copy(light.dir);
        uniforms.uSunColor.value.copy(light.color);
        uniforms.uAmbient.value.copy(light.ambient);
      }
      stats.box = box;
      stats.size = +uniforms.uSize.value.toFixed(3);
    },
  };
}
