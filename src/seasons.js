// Four seasons over Braga (3d-four-seasons skill, MengTo), and the render
// quality switch (3d-retina-resolution).
//
// One shared state: blend weights [spring, summer, fall, winter] that start
// nonnegative and sum to 1. A new choice redirects the running blend (about
// 2.5 s), it never queues or restarts. Every consumer resolves its look from
// its authored base values and these weights each frame, so nothing drifts:
//
//   - foliage (nature.js): per species and per crown: fresh green and
//     blossom in spring, deep green in summer, ochre and rust on the
//     broadleaf crowns in autumn while the eucalyptus and pines stay green,
//     bare shrunken crowns in winter (the shadows follow);
//   - ground (scene.js): grass and field tints, the woods turning in patches;
//   - snow (scene.js chunk patch): settled snow above ~450 m (Sameiro, the
//     top of Bom Jesus), a light dusting on the roofs, frost below;
//   - light (scene.js applySeason): sun height and bearing, colour
//     temperature and haze on top of the time of day and the weather;
//   - particles: petals in spring and leaves in autumn (leaves.js), slow
//     snow flakes in winter (weather.js), a faint heat haze in summer
//     (effects.js).
//
// Default: the real season in Braga for today's date. Saved in localStorage
// and in the hash as season= (when it differs from today's season).
//
// Quality «авто · 2x»: auto follows the device pixel ratio (main.js caps it
// at 2); 2x renders two drawing-buffer pixels per CSS pixel everywhere.
// Refused, with a toast, on a device the low-end probe flagged or when the
// GPU cannot hold a 200 % buffer.
import * as THREE from 'three';
import { t } from './i18n.js';
import * as UI from './ui.js';
import { WEATHER_UNIFORMS } from './scene.js';
import { S } from './geo.js';
import { createLeaves } from './leaves.js';

export const SEASONS = ['spring', 'summer', 'fall', 'winter'];
const LABEL = { spring: 'весна', summer: 'лето', fall: 'осень', winter: 'зима' };
const PRESETS = { spring: [1, 0, 0, 0], summer: [0, 1, 0, 0], fall: [0, 0, 1, 0], winter: [0, 0, 0, 1] };
const SNOW_LINE_M = 450; // metres above sea level
const STORE = 'porto-season';
const STORE_Q = 'porto-quality';

const norm = (name) => (name === 'autumn' ? 'fall' : name);
const hashName = (key) => (key === 'fall' ? 'autumn' : key);

// Astronomical seasons for the northern hemisphere (Braga, 41.5 N).
export function seasonForDate(d = new Date()) {
  const md = (d.getMonth() + 1) * 100 + d.getDate();
  if (md >= 320 && md < 621) return 'spring';
  if (md >= 621 && md < 923) return 'summer';
  if (md >= 923 && md < 1221) return 'fall';
  return 'winter';
}

function el(tag, attrs = {}, text = '') {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text) e.textContent = text;
  return e;
}

// A segmented control in the style of «Время: утро · день · закат · ночь».
function segmented(id, name, aria, options) {
  const box = el('div', { class: 'tool scale-switch', id, role: 'group', 'aria-label': t(aria) });
  box.append(el('span', { class: 'scale-name' }, t(name)));
  const buttons = {};
  options.forEach(([key, label], i) => {
    if (i) box.append(el('span', { class: 'scale-sep', 'aria-hidden': 'true' }, '·'));
    buttons[key] = el('button', { type: 'button', 'aria-pressed': 'false', [`data-${id.split('-')[0]}`]: key }, t(label));
    box.append(buttons[key]);
  });
  return {
    box,
    buttons,
    set(key) {
      for (const [k, b] of Object.entries(buttons)) b.setAttribute('aria-pressed', String(k === key));
    },
  };
}

function readHash() {
  return norm(new URLSearchParams(location.hash.replace(/^#/, '')).get('season') || '');
}
// Writes season= into the hash (or drops it), keeping every other part.
function writeHash(key, isDefault) {
  const q = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (isDefault) q.delete('season');
  else q.set('season', hashName(key));
  const h = q.toString().replace(/=(?=&|$)/g, ''); // #cinema, #story stay bare
  const url = location.pathname + location.search + (h ? `#${h}` : '');
  if (url !== location.pathname + location.search + location.hash) history.replaceState(null, '', url);
}

export function createSeasons({ renderer, scene, camera, atmosphere, nature, fx, weather, terrain, ui, reducedMotion = false, mobile = false, lite = false, debug = {} }) {
  const today = seasonForDate();
  const weights = [0, 1, 0, 0];
  let target = PRESETS.summer;
  let season = 'summer';
  const SW = WEATHER_UNIFORMS.seasonW.value;
  const SN = WEATHER_UNIFORMS.seasonSnow.value;
  SN.z = (SNOW_LINE_M - (terrain?.datum ?? 0)) * S;

  // ---- leaves and petals
  const leaves = createLeaves({ field: nature?.leafField, capacity: lite ? 375 : mobile ? 500 : 1500 }); // light mode: a quarter
  scene.add(leaves.mesh);

  // the visible sun drives the ray source and the glitter on the water
  fx?.setSunSource?.(atmosphere.skySunDir);
  debug.rays = fx?.rays; // tests: the ray pass and its tuning
  debug.bloom = fx?.bloom; // tests: the bloom pass
  nature?.water?.setSunSource?.(atmosphere.skySunDir);

  // ---- controls
  const seasonUI = segmented('season-switch', 'Сезон:', 'Сезон', SEASONS.map((k) => [k, LABEL[k]]));
  const qualityUI = segmented('quality-switch', 'Качество:', 'Качество изображения', [['auto', 'авто'], ['2x', '2x']]);
  qualityUI.box.title = t('Авто: по экрану; 2x: четыре пикселя на каждый пиксель экрана');
  const mount = (node, group) => {
    if (typeof UI.mountTool === 'function') return UI.mountTool(node, group);
    const bar = document.querySelector('.topbar');
    const fxBtn = document.getElementById('fx-toggle');
    if (fxBtn) fxBtn.before(node);
    else bar?.append(node);
    return node;
  };
  mount(seasonUI.box, 'sky');
  mount(qualityUI.box, 'display');

  // ---- season
  function apply(name, { save = true, instant = reducedMotion } = {}) {
    const key = norm(name);
    if (!Object.hasOwn(PRESETS, key)) return false;
    season = key;
    target = PRESETS[key];
    if (instant) for (let i = 0; i < 4; i++) weights[i] = target[i];
    seasonUI.set(key);
    debug.season = key;
    if (save) {
      try {
        localStorage.setItem(STORE, hashName(key));
      } catch {
        // storage may be blocked; the hash still carries the choice
      }
      writeHash(key, key === today);
    }
    return true;
  }
  for (const [k, b] of Object.entries(seasonUI.buttons)) b.addEventListener('click', () => apply(k));
  {
    let saved = null;
    try {
      saved = localStorage.getItem(STORE);
    } catch {
      saved = null;
    }
    const fromHash = readHash();
    const start = [fromHash, norm(saved || ''), today].find((k) => Object.hasOwn(PRESETS, k));
    apply(start, { save: false, instant: true });
  }
  window.addEventListener('hashchange', () => {
    const h = readHash();
    if (h && h !== season && Object.hasOwn(PRESETS, h)) apply(h, { save: false });
  });

  // ---- quality
  let quality = 'auto';
  let qualityPending = null; // a saved 2x waits for the low-end probe
  function setQuality(mode, { save = true, quiet = false } = {}) {
    mode = mode === '2x' ? '2x' : 'auto';
    if (mode === '2x' && debug.perf?.probeMs > 33) {
      if (!quiet) ui?.toast?.(t('2x недоступно: устройство не тянет даже обычное качество'), 4000);
      mode = 'auto';
    }
    const r = fx?.setQuality ? fx.setQuality(mode) : { mode, ratio: renderer.getPixelRatio(), ok: true };
    if (!r.ok && !quiet) ui?.toast?.(t('2x недоступно: видеокарта не вмещает такой кадр'), 4000);
    quality = r.mode;
    qualityUI.set(quality);
    if (save) {
      try {
        localStorage.setItem(STORE_Q, quality);
      } catch {
        // the choice lasts for this page
      }
    }
    const db = renderer.getDrawingBufferSize(new THREE.Vector2());
    debug.quality = { mode: quality, pixelRatio: renderer.getPixelRatio(), buffer: [db.x, db.y], css: [renderer.domElement.clientWidth, renderer.domElement.clientHeight] };
    return quality;
  }
  for (const [k, b] of Object.entries(qualityUI.buttons)) b.addEventListener('click', () => setQuality(k));
  qualityUI.set('auto');
  try {
    if (localStorage.getItem(STORE_Q) === '2x') qualityPending = performance.now();
  } catch {
    qualityPending = null;
  }

  // ---- textures (3d-high-resolution-textures): every repeated texture
  // gets anisotropic filtering capped by the device; mipmaps on
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const textures = [];
  function auditTextures() {
    const seen = new Set();
    const visit = (tex, where) => {
      if (!tex?.isTexture || seen.has(tex)) return;
      seen.add(tex);
      const repeated = tex.wrapS === THREE.RepeatWrapping || tex.wrapT === THREE.RepeatWrapping;
      const before = tex.anisotropy;
      if (repeated && tex.anisotropy < 4) tex.anisotropy = Math.min(8, maxAniso);
      if (tex.anisotropy > maxAniso) tex.anisotropy = maxAniso;
      if (tex.anisotropy !== before) tex.needsUpdate = true;
      textures.push({ where, size: tex.image ? `${tex.image.width}x${tex.image.height}` : '?', repeated, aniso: `${before}->${tex.anisotropy}`, mips: tex.generateMipmaps, colorSpace: tex.colorSpace || 'none' });
    };
    scene.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap', 'alphaMap']) visit(m[k], `${m.name || o.name}.${k}`);
        // uniforms added in onBeforeCompile live on the compiled program
        const u = m.uniforms || renderer.properties.get(m)?.uniforms || {};
        for (const [k, v] of Object.entries(u)) visit(v?.value, `${m.name || o.name}.${k}`);
      }
    });
  }
  let audited = false;
  let sinceStart = 0;

  // ---- per frame
  const light = { dir: atmosphere.sunDir, color: new THREE.Color(), ambient: new THREE.Color() };
  const _amb = new THREE.Color();
  const mix = { spring: 0, summer: 1, fall: 0, winter: 0 };
  let sinceStats = 1;
  let sinceHash = 0;
  function update(dt) {
    // blend toward the target (3d-four-seasons stepSeason)
    const a = reducedMotion ? 1 : 1 - Math.exp(-1.4 * Math.min(Math.max(dt, 0), 0.05));
    let sum = 0;
    for (let i = 0; i < 4; i++) {
      weights[i] += (target[i] - weights[i]) * a;
      if (Math.abs(target[i] - weights[i]) < 1e-4) weights[i] = target[i];
      sum += weights[i];
    }
    for (let i = 0; i < 4; i++) weights[i] /= sum || 1;
    const [sp, su, fa, wi] = weights;
    SW.x = sp;
    SW.y = su;
    SW.z = fa;
    SW.w = wi;
    const sm = THREE.MathUtils.smoothstep;
    SN.x = sm(wi, 0.35, 0.95);
    SN.y = 0.34 * sm(wi, 0.4, 1);
    SN.w = 0.35 * wi;
    atmosphere.setSeason(weights);

    // particles
    mix.spring = sp;
    mix.summer = su;
    mix.fall = fa;
    mix.winter = wi;
    const st = atmosphere.state;
    light.color.copy(atmosphere.sun.color).multiplyScalar(atmosphere.sun.intensity);
    light.ambient.copy(st.mid).multiplyScalar(0.35 * st.env).add(_amb.copy(atmosphere.hemi.color).multiplyScalar(atmosphere.hemi.intensity * 0.5));
    const focus = camera.userData.focus;
    const camDist = focus ? camera.position.distanceTo(focus) : 300;
    leaves.update(reducedMotion ? 0 : dt, camera, camDist, mix, weather?.wind, light);
    const px = (renderer.getDrawingBufferSize(_db).y * 0.5) * camera.projectionMatrix.elements[5];
    weather?.setSnow?.(wi * 0.6, px);
    fx?.setHaze?.(fx.enabled ? su * 0.8 * (1 - atmosphere.night) * (reducedMotion ? 0 : 1) : 0);

    // a saved 2x waits for the low-end probe (or 6 s when there is none)
    if (qualityPending != null && (debug.perf || performance.now() - qualityPending > 6000)) {
      qualityPending = null;
      setQuality('2x', { save: false });
    }
    // the low-end probe came back after 2x was chosen: fall back, say so
    if (quality === '2x' && debug.perf?.probeMs > 33) {
      setQuality('auto');
      ui?.toast?.(t('Качество снижено до «авто»: устройство не справляется с 2x'), 4000);
    }

    // the texture audit waits until every material has compiled once
    sinceStart += dt;
    if (!audited && sinceStart > 2) {
      audited = true;
      auditTextures();
    }

    // main.js rewrites the hash on every selection; keep season= in it
    sinceHash += dt;
    if (sinceHash > 1) {
      sinceHash = 0;
      if (season !== today && readHash() !== season) writeHash(season, false);
    }
    sinceStats += dt;
    if (sinceStats > 1) {
      sinceStats = 0;
      const db = renderer.getDrawingBufferSize(_db);
      const s = {
        season,
        today,
        weights: weights.map((w) => +w.toFixed(3)),
        leaves: { ...leaves.stats },
        snowFlakes: weather?.snowFlakes ?? 0,
        waterTriangles: nature?.water?.triangles ?? 0,
        quality,
        pixelRatio: renderer.getPixelRatio(),
        drawingBuffer: [db.x, db.y],
        rays: fx?.rays ? { on: fx.rays.enabled, strength: +fx.rays.strength.toFixed(3), sun: [+fx.rays.sun.x.toFixed(3), +fx.rays.sun.y.toFixed(3)] } : null,
        textures,
      };
      debug.seasons = s;
      if (debug.stats) debug.stats.seasons = s;
    }
  }
  const _db = new THREE.Vector2();

  return {
    update,
    setSeason: (name) => apply(name),
    setQuality: (mode) => setQuality(mode),
    leaves,
    get season() {
      return season;
    },
    get weights() {
      return weights.slice();
    },
    get quality() {
      return quality;
    },
  };
}
