// Sky and weather over Braga.
//
//   - a drifting cloud deck at 1500 m: one plane that follows the camera,
//     its density from the shared cloud texture (scene.js CLOUD_GLSL). The
//     same density, projected along the sun, dims the direct light of every
//     lit material, so each cloud's shadow drifts over the terrain and the
//     roofs exactly below it;
//   - rain: line streaks in a box carried in front of the camera, sized to
//     the view so they read as rain in a close-up and over the whole city;
//     one GPU-driven draw, density is the draw range;
//   - five states (clear, partly cloudy, overcast, rain, fog), each a set
//     of dials that blend over 3 s from wherever the last blend stood. Wet
//     ground dries slower than it gets wet.
//
// The atmosphere (scene.js) takes the sky side of each state through
// setWeather(): the sun behind cloud, a grey sky, the valley fog.
import * as THREE from 'three';
import { WEATHER_UNIFORMS, CLOUD_GLSL, FOG_UNIFORMS } from './scene.js';
import { S } from './geo.js';

export const WEATHERS = ['clear', 'partly', 'overcast', 'rain', 'fog'];

// cover: deck cover 0..1; shadow: how much a cloud dims the sun under it;
// dim/grey/fog/haze: the atmosphere dials; rain: streak density; wet: the
// ground wetness it leads to
const STATES = {
  clear: { cover: 0, shadow: 0, dim: 0, grey: 0, fog: 0, haze: 0, rain: 0, wet: 0 },
  partly: { cover: 0.36, shadow: 0.72, dim: 0.03, grey: 0.06, fog: 0, haze: 0, rain: 0, wet: 0 },
  overcast: { cover: 0.9, shadow: 0.5, dim: 0.6, grey: 0.72, fog: 0, haze: 0.35, rain: 0, wet: 0 },
  rain: { cover: 0.97, shadow: 0.45, dim: 0.74, grey: 0.86, fog: 0, haze: 1, rain: 1, wet: 1 },
  fog: { cover: 0, shadow: 0, dim: 0.3, grey: 0.4, fog: 1, haze: 0, rain: 0, wet: 0.2 },
};
const DIALS = ['cover', 'shadow', 'dim', 'grey', 'fog', 'haze', 'rain'];
const BLEND_S = 3;
const DECK_M = 1500; // cloud base, metres above sea level
const PERIOD = 2600; // world units per texture repeat (10.4 km)

const ease = (t) => t * t * (3 - 2 * t);
// c += src * k for colours (THREE.Color has no addScaledVector)
export function addScaled(c, src, k) {
  c.r += src.r * k;
  c.g += src.g * k;
  c.b += src.b * k;
  return c;
}

// ------------------------------------------------------------ cloud deck
function cloudDeck() {
  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    ...FOG_UNIFORMS,
    ...WEATHER_UNIFORMS,
    uLit: { value: new THREE.Color(1, 1, 1) },
    uShade: { value: new THREE.Color(0.6, 0.62, 0.66) },
    uGlow: { value: new THREE.Color(0, 0, 0) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uAlpha: { value: 0.9 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    vertexShader: /* glsl */ `
      varying vec3 vW;
      #include <fog_pars_vertex>
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uLit;
      uniform vec3 uShade;
      uniform vec3 uGlow;
      uniform vec3 uSunDir;
      uniform float uAlpha;
      varying vec3 vW;
      ${CLOUD_GLSL}
      #include <fog_pars_fragment>
      void main() {
        float d = brgCloudDensity(vW.xz);
        if (d < 0.004) discard;
        // wispy edges: fine noise eats into the thin parts of each cloud
        float det = texture2D(tCloud, vW.xz * cloudShape.y * 7.0 + cloudParams.xy * 1.4).b;
        d = clamp(d - (1.0 - d) * det * 0.95, 0.0, 1.0);
        if (d < 0.01) discard;
        float thick = smoothstep(0.15, 0.95, d);
        // denser toward the sun: the far side of a cloud is in its own shade
        vec2 toSun = normalize(uSunDir.xz + vec2(1e-4)) * 90.0;
        float d2 = brgCloudDensity(vW.xz + toSun);
        float lit = clamp(1.0 - 1.3 * max(d2 - d, 0.0) - 0.45 * d2 * d, 0.2, 1.0);
        vec3 col = mix(uShade, uLit, lit * (0.6 + 0.4 * thick)) + uGlow * d;
        float dist = length(vW - cameraPosition);
        float a = smoothstep(0.0, 0.6, d) * uAlpha * (0.75 + 0.25 * thick);
        a *= 1.0 - smoothstep(6000.0, 9000.0, dist);
        // a camera flying through the deck sees no flat sheet
        a *= smoothstep(12.0, 70.0, abs(cameraPosition.y - vW.y));
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  mat.name = 'cloud-deck';
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'cloud-deck';
  mesh.scale.set(18000, 1, 18000);
  mesh.frustumCulled = false;
  mesh.renderOrder = 35; // after the street lamps: a deck seen from above hides them
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.visible = false;
  return { mesh, uniforms };
}

// ------------------------------------------------------------ rain
function rainStreaks(n) {
  const seed = new Float32Array(n * 2 * 3);
  const end = new Float32Array(n * 2);
  let s = 12345;
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    const x = r();
    const y = r();
    const z = r();
    const k = r();
    for (let e = 0; e < 2; e++) {
      seed.set([x, y, z], (i * 2 + e) * 3);
      // aEnd: 0 head, 1 tail; the tail carries a per-drop length jitter
      end[i * 2 + e] = e === 0 ? 0 : 0.6 + 0.8 * k;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(seed, 3));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  geo.setDrawRange(0, 0);
  const uniforms = {
    uBoxMin: { value: new THREE.Vector3() },
    uBox: { value: 20 },
    uTime: { value: 0 },
    uFall: { value: new THREE.Vector3(0, -1, 0) },
    uLen: { value: 1 },
    uColor: { value: new THREE.Color(0.62, 0.68, 0.76) },
    uAlpha: { value: 0.3 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform vec3 uBoxMin;
      uniform float uBox;
      uniform float uTime;
      uniform vec3 uFall;
      uniform float uLen;
      attribute float aEnd;
      varying float vTail;
      void main() {
        // world-anchored drops repeated every uBox: the box moves with the
        // camera, the drops do not slide with it
        vec3 p = position * uBox + uFall * uTime;
        p = uBoxMin + mod(p - uBoxMin, uBox);
        p -= normalize(uFall) * uLen * aEnd;
        vTail = step(0.01, aEnd);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uAlpha;
      varying float vTail;
      void main() {
        gl_FragColor = vec4(uColor, uAlpha * (1.0 - 0.85 * vTail));
      }`,
  });
  mat.name = 'rain';
  const lines = new THREE.LineSegments(geo, mat);
  lines.name = 'rain';
  lines.frustumCulled = false;
  lines.renderOrder = 36;
  lines.visible = false;
  return { lines, uniforms, n };
}

// ------------------------------------------------------------ snow
// Winter flakes (src/seasons.js sets the amount): the rain's box, carried
// in front of the camera and sized to the view, with slow flakes that
// flutter sideways. Soft round points; one draw, density is the draw range.
function snowFlakes(n) {
  const seed = new Float32Array(n * 3);
  const rnd = new Float32Array(n);
  let s = 777;
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    seed.set([r(), r(), r()], i * 3);
    rnd[i] = r();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(seed, 3));
  geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
  geo.setDrawRange(0, 0);
  const uniforms = {
    uBoxMin: { value: new THREE.Vector3() },
    uBox: { value: 20 },
    uTime: { value: 0 },
    uFall: { value: new THREE.Vector3(0, -1, 0) },
    uSize: { value: 0.05 },
    uPx: { value: 500 },
    uColor: { value: new THREE.Color(0.9, 0.92, 0.96) },
    uAlpha: { value: 0.8 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform vec3 uBoxMin;
      uniform float uBox;
      uniform float uTime;
      uniform vec3 uFall;
      uniform float uSize;
      uniform float uPx;
      attribute float aRnd;
      varying float vA;
      void main() {
        vec3 p = position * uBox + uFall * uTime * (0.75 + 0.5 * aRnd);
        // flutter: each flake on its own slow circle
        float a = uTime * (0.6 + 0.9 * aRnd) + aRnd * 40.0;
        p.xz += vec2(sin(a), cos(a * 0.8)) * uBox * 0.015;
        p = uBoxMin + mod(p - uBoxMin, uBox);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float px = uSize * (0.6 + 0.8 * aRnd) * uPx / max(-mv.z, 1e-3);
        gl_PointSize = clamp(px, 1.0, 7.0);
        // soft at the box edges (the wrap), faint when tiny
        vec3 q = (p - uBoxMin) / uBox;
        vec3 e = min(q, 1.0 - q);
        vA = smoothstep(0.0, 0.08, min(min(e.x, e.y), e.z)) * clamp(px * 0.6, 0.25, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uAlpha;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.12, d) * uAlpha * vA;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
  });
  mat.name = 'snow';
  const points = new THREE.Points(geo, mat);
  points.name = 'snow';
  points.frustumCulled = false;
  points.renderOrder = 36;
  points.visible = false;
  return { points, uniforms, n };
}

// ------------------------------------------------------------ public
export function createWeather({ scene, atmosphere, datumM = 0, mobile = false, reducedMotion = false }) {
  const deck = cloudDeck();
  const deckY = (DECK_M - datumM) * S;
  WEATHER_UNIFORMS.cloudShape.value.x = deckY;
  WEATHER_UNIFORMS.cloudShape.value.y = 1 / PERIOD;
  deck.mesh.position.y = deckY;
  scene.add(deck.mesh);
  const rain = rainStreaks(mobile ? 2500 : 6000);
  scene.add(rain.lines);
  const snow = snowFlakes(mobile ? 1500 : 4000);
  scene.add(snow.points);
  let snowK = 0; // 0..1, from the season
  let snowPx = 500; // pixels per world unit at distance 1 (seasons.js)

  const cur = { ...STATES.clear };
  const from = { ...STATES.clear };
  const to = { ...STATES.clear };
  let blendT = 1;
  let wet = 0;
  let name = 'clear';
  // wind: from the Atlantic (WSW) by default; live mode sets the real speed
  const wind = { x: 0.93, z: -0.37, speed: 6 }; // m/s at the deck
  const offset = WEATHER_UNIFORMS.cloudParams.value;
  let time = 0;
  const listeners = new Set();

  function set(next, { cover = null, instant = reducedMotion } = {}) {
    if (!STATES[next]) return false;
    name = next;
    Object.assign(from, cur);
    Object.assign(to, STATES[next]);
    if (cover != null) to.cover = THREE.MathUtils.clamp(cover, next === 'clear' ? 0 : 0.2, 1);
    blendT = instant ? 1 : 0;
    if (instant) Object.assign(cur, to);
    for (const f of listeners) f(name);
    return true;
  }

  const _fwd = new THREE.Vector3();
  const sd = atmosphere.sunDir;
  function update(dt, camera, camDist) {
    time += dt;
    // ---- blend the dials
    if (blendT < 1) {
      blendT = Math.min(1, blendT + dt / BLEND_S);
      const k = ease(blendT);
      for (const d of DIALS) cur[d] = from[d] + (to[d] - from[d]) * k;
    }
    // wet in 4 s, dry in 14 s
    const wetTo = to.wet;
    wet += (wetTo - wet) * Math.min(1, dt / (wetTo > wet ? 1.3 : 4.5));
    if (reducedMotion) wet = wetTo;
    atmosphere.setWeather(cur);

    // ---- deck: drift, cover, shadow strength, colours
    const drift = reducedMotion ? 0 : (wind.speed * 6 * S * dt) / PERIOD; // six times the real speed
    offset.x -= wind.x * drift;
    offset.y -= wind.z * drift;
    offset.z = cur.cover;
    offset.w = cur.shadow * THREE.MathUtils.smoothstep(sd.y, -0.02, 0.12);
    WEATHER_UNIFORMS.cloudShape.value.z = wet;
    WEATHER_UNIFORMS.cloudShape.value.w = cur.rain; // rain rings on the water

    const on = cur.cover > 0.004;
    deck.mesh.visible = on;
    if (on) {
      deck.mesh.position.x = camera.position.x;
      deck.mesh.position.z = camera.position.z;
      const st = atmosphere.state;
      const u = deck.uniforms;
      // sunlit tops: the light colour; shaded bases: the sky, greyer and
      // darker the thicker the deck; at night a faint sodium glow from below
      const sunK = Math.min(1, st.lightI / 4) * THREE.MathUtils.smoothstep(sd.y, -0.03, 0.1);
      addScaled(u.uLit.value.copy(st.light).multiplyScalar(0.25 + 0.95 * sunK), st.mid, 0.35);
      addScaled(u.uShade.value.copy(st.mid).multiplyScalar(0.62 - 0.25 * cur.grey * cur.cover), st.haze, 0.22);
      u.uGlow.value.setRGB(0.07, 0.045, 0.02).multiplyScalar(st.night);
      u.uSunDir.value.copy(sd);
      // from above the deck stays thin so the map shows through; from below
      // it closes the sky
      const above = camera.position.y > deckY;
      const topA = 0.46 - 0.2 * THREE.MathUtils.smoothstep(cur.cover, 0.6, 0.95);
      const alt = THREE.MathUtils.smoothstep(camera.position.y - deckY, 0, 1500);
      u.uAlpha.value = above ? topA * (1 - 0.4 * alt) : 0.96;
    }

    // ---- rain streaks
    const n = Math.round(rain.n * cur.rain);
    rain.lines.visible = n > 0;
    if (n > 0) {
      rain.lines.geometry.setDrawRange(0, n * 2);
      // box size follows the view in 1.25x steps (drops reshuffle rarely)
      const want = THREE.MathUtils.clamp(camDist * 0.45, 10, 1100);
      const box = 10 * Math.pow(1.25, Math.round(Math.log(want / 10) / Math.log(1.25)));
      const u = rain.uniforms;
      u.uBox.value = box;
      camera.getWorldDirection(_fwd);
      u.uBoxMin.value.copy(camera.position).addScaledVector(_fwd, box * 0.5).subScalar(box / 2);
      // a drop crosses the box in about a second, slanted by the wind
      u.uFall.value.set(wind.x * 0.12, -1, wind.z * 0.12).multiplyScalar(box * 0.95);
      u.uLen.value = box * 0.03;
      if (!reducedMotion) u.uTime.value = time;
      u.uAlpha.value = 0.26 * cur.rain * (1 - 0.5 * atmosphere.night);
    }

    // ---- snow flakes: slow, a box that follows the view like the rain
    const ns = Math.round(snow.n * snowK);
    snow.points.visible = ns > 0 && camDist < 2600;
    if (snow.points.visible) {
      snow.points.geometry.setDrawRange(0, ns);
      const want = THREE.MathUtils.clamp(camDist * 0.45, 10, 900);
      const box = 10 * Math.pow(1.25, Math.round(Math.log(want / 10) / Math.log(1.25)));
      const u = snow.uniforms;
      u.uBox.value = box;
      camera.getWorldDirection(_fwd);
      u.uBoxMin.value.copy(camera.position).addScaledVector(_fwd, box * 0.5).subScalar(box / 2);
      // a flake crosses the box in about eight seconds, drifting with the wind
      u.uFall.value.set(wind.x * 0.25, -1, wind.z * 0.25).multiplyScalar(box * 0.12);
      u.uSize.value = box * 0.0022;
      u.uPx.value = snowPx;
      if (!reducedMotion) u.uTime.value = time;
      const lit = 0.55 + 0.45 * Math.min(1, atmosphere.state.lightI / 3.5);
      u.uColor.value.setRGB(0.9, 0.92, 0.96).multiplyScalar(lit * (1 - 0.6 * atmosphere.night));
      u.uAlpha.value = 0.75 * Math.min(1, snowK * 1.5);
    }
  }

  return {
    deck: deck.mesh,
    rain: rain.lines,
    snow: snow.points,
    set,
    update,
    // winter flakes 0..1; px: drawing-buffer pixels per world unit at
    // distance 1 (half the buffer height times the projection's y scale)
    setSnow(k, px) {
      snowK = THREE.MathUtils.clamp(k, 0, 1);
      if (px > 0) snowPx = px;
    },
    // the wind the clouds drift with: direction it blows toward (unit xz)
    // and speed in m/s; the falling leaves share it
    get wind() {
      return wind;
    },
    get snowFlakes() {
      return snow.points.visible ? snow.points.geometry.drawRange.count : 0;
    },
    onChange: (f) => listeners.add(f),
    // live mode: the real wind (m/s, direction it blows FROM, degrees)
    setWind(speedMs, fromDeg) {
      const a = THREE.MathUtils.degToRad(fromDeg + 180); // blowing toward
      wind.x = Math.sin(a);
      wind.z = -Math.cos(a);
      wind.speed = THREE.MathUtils.clamp(speedMs, 1, 25);
    },
    get name() {
      return name;
    },
    get dials() {
      return { ...cur, wet: +wet.toFixed(3) };
    },
    get rainK() {
      return cur.rain;
    },
    get rainDrops() {
      return rain.lines.visible ? rain.lines.geometry.drawRange.count / 2 : 0;
    },
  };
}
