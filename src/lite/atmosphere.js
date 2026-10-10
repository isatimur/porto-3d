// The lite scene's "atmosphere" (the Potato class, see perf/ARCHITECTURE.md):
// a vertical gradient for the sky and one colour tint per time of day and
// season that every lite material multiplies its vertex colours with. No
// lights, no shadows, no environment map, no fog, no clouds. It answers the
// same questions main.js asks of scene.js createAtmosphere() (time, night,
// sunDir, setTime, update ...), so the rest of the app does not branch on it.
import * as THREE from 'three';

export const TIMES = ['morning', 'day', 'sunset', 'night'];

// sRGB hex. top / mid / horizon: the gradient; tint: what the world is
// multiplied with (a warm light at the edges of the day, a blue dark at night).
const PRESETS = {
  morning: { top: 0x46699c, mid: 0xb3c0d4, hor: 0xe3d5c6, tint: [1.0, 0.94, 0.86], night: 0, az: 100, el: 10 },
  day: { top: 0x3f7cc9, mid: 0x9bc2ea, hor: 0xdbe8f2, tint: [1.0, 1.0, 1.0], night: 0, az: 165, el: 50 },
  sunset: { top: 0x2f3f7a, mid: 0xd98a66, hor: 0xf4c48c, tint: [1.0, 0.84, 0.7], night: 0, az: 262, el: 6 },
  night: { top: 0x050914, mid: 0x0c1830, hor: 0x1b2a48, tint: [0.2, 0.26, 0.42], night: 1, az: 0, el: -20 },
};
// colour-only seasons: the ground and the trees' tint
const SEASONS = {
  spring: [0.96, 1.05, 0.92],
  summer: [1, 1, 1],
  fall: [1.1, 0.95, 0.76],
  winter: [1.04, 1.07, 1.14],
};

const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const hex3 = (h) => {
  const c = new THREE.Color(h);
  return [c.r, c.g, c.b];
};

export function createAtmosphereLite(renderer, scene, { reducedMotion = false, time = 'sunset' } = {}) {
  const cur = { top: [0, 0, 0], mid: [0, 0, 0], hor: [0, 0, 0], tint: [1, 1, 1], night: 0 };
  let from = null;
  let to = PRESETS[time] || PRESETS.sunset;
  let k = 1; // blend 0..1 from `from` to `to`
  let name = TIMES.includes(time) ? time : 'sunset';
  let season = 'summer';
  const listeners = new Set();
  const tinted = new Set(); // { material, seasonal }

  // the sky: a 2 x 128 canvas gradient drawn as the scene background
  const cv = document.createElement('canvas');
  cv.width = 2;
  cv.height = 128;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  scene.background = tex;

  const css = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
  const toSrgb = (c) => c.map((v) => Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2));
  function paintSky() {
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    // the camera looks down on the city: the horizon band sits in the lower third
    g.addColorStop(0, css(toSrgb(cur.top)));
    g.addColorStop(0.55, css(toSrgb(cur.mid)));
    g.addColorStop(0.82, css(toSrgb(cur.hor)));
    g.addColorStop(1, css(toSrgb(cur.hor)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 2, 128);
    tex.needsUpdate = true;
  }

  const sunDir = new THREE.Vector3(0, 1, 0);
  const sunColor = new THREE.Color(1, 1, 1);
  const horizon = new THREE.Color(); // for the ground's outer ring
  const mid = new THREE.Color();
  function setSunDir(p) {
    const a = THREE.MathUtils.degToRad(p.az);
    const e = THREE.MathUtils.degToRad(p.el);
    sunDir.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
  }

  const seasonTint = new THREE.Color(1, 1, 1);
  const worldTint = new THREE.Color(1, 1, 1);
  function applyTints() {
    worldTint.setRGB(cur.tint[0], cur.tint[1], cur.tint[2]);
    seasonTint.setRGB(...SEASONS[season]).multiply(worldTint);
    for (const t of tinted) t.material.color.copy(t.seasonal ? seasonTint : worldTint);
    horizon.setRGB(cur.hor[0], cur.hor[1], cur.hor[2]);
    mid.setRGB(cur.mid[0], cur.mid[1], cur.mid[2]);
  }

  function blend() {
    const a = from || to;
    cur.top = lerp3(hex3(a.top), hex3(to.top), k);
    cur.mid = lerp3(hex3(a.mid), hex3(to.mid), k);
    cur.hor = lerp3(hex3(a.hor), hex3(to.hor), k);
    cur.tint = lerp3(a.tint, to.tint, k);
    cur.night = a.night + (to.night - a.night) * k;
    paintSky();
    applyTints();
  }
  blend();
  setSunDir(to);

  const api = {
    kind: 'lite',
    get time() {
      return name;
    },
    get night() {
      return cur.night;
    },
    sunDir,
    skySunDir: sunDir,
    sun: { color: sunColor, intensity: 1, castShadow: false, shadow: { mapSize: { x: 0, y: 0 } }, position: new THREE.Vector3() },
    hemi: { color: new THREE.Color(0, 0, 0), intensity: 0 },
    state: { mid, haze: horizon, env: 0, exposure: 1 },
    horizon,
    // the lite materials the tint multiplies (seasonal: ground and trees as well as the season)
    register(material, { seasonal = false } = {}) {
      material.fog = false;
      material.toneMapped = false;
      tinted.add({ material, seasonal });
      applyTints();
      return material;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setTime(next, { animate = !reducedMotion } = {}) {
      if (!PRESETS[next]) return;
      name = next;
      from = {
        top: new THREE.Color(...cur.top).getHex(),
        mid: new THREE.Color(...cur.mid).getHex(),
        hor: new THREE.Color(...cur.hor).getHex(),
        tint: [...cur.tint],
        night: cur.night,
      };
      to = PRESETS[next];
      k = animate ? 0 : 1;
      setSunDir(to);
      blend();
      for (const fn of listeners) fn(api);
    },
    setSeason(next) {
      if (!SEASONS[next]) return;
      season = next;
      applyTints();
      for (const fn of listeners) fn(api);
    },
    get season() {
      return season;
    },
    update(dt) {
      if (k >= 1) return;
      k = Math.min(1, k + dt / 0.9);
      blend();
      for (const fn of listeners) fn(api); // the ground's outer ring follows the horizon
    },
    // the interface of the full atmosphere that has nothing to do here
    setLinearOutput() {},
    setShadowSize() {},
    rebuildEnv() {},
    setWeather() {},
    setSun() {},
  };
  return api;
}
