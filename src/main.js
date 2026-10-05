import { t, language, locale, initLanguage } from './i18n.js';
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import './style.css';
import { loadData, loadStory } from './data.js';
import { createProjection, METRES_PER_UNIT } from './geo.js';
import { installAtmosphereFog, createRenderer, createAtmosphere, createGround, FOG_UNIFORMS, TIMES, DEFAULT_TIME, DPR, deviceDpr } from './scene.js';
import { setWaterLite } from './water.js';
import { buildRoads } from './roads.js';
import { buildLandmarks } from './landmarks.js';
import { buildBuildings, BUILDING_UNIFORMS, setBuildingsLite } from './buildings.js';
import { buildNature } from './nature.js';
import { loadQuays, buildQuays } from './quays.js';
import { createEffects } from './effects.js';
import { createIntro } from './intro.js';
import { createInstruments } from './ui.js';
import { fitLandmark, padFor } from './fit.js';
import { createCameraRig } from './camera.js';
import { createSkyline, createCinema } from './tour.js';
import { createStory } from './story.js';
import { createUI, createLoader, placesWord } from './ui.js';
import { createSearch, IMPORTANCE } from './search.js';
import { assetUrl } from './data.js';
import { createRouteLayer, createFlyAlong } from './routes.js';
import { createPanorama } from './panorama.js';
import { installShare } from './share.js';
import { createGuide } from './guide.js';
import { createLife } from './life.js';
import { createSeasons } from './seasons.js';
import { createFlyKeys } from './fly.js';
import { createTiles } from './tiles.js';
import { createMsBuildings } from './buildings-ms.js';
import { CITY, loadCity, applyCityShell } from './city.js';
import { loadCityModels } from './models.js';
import { setLifeData } from './life.js';
import { setTrafficAxes } from './traffic-model.js';
import { installPois } from './pois.js';

initLanguage();

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  || new URLSearchParams(location.search).has('reduced');
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
// phones and small tablets
const MOBILE = window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;

// ------------------------------------------------------------ quality tier
// 'low' (light mode) or 'high'. Light mode: DPR cap 1.5 (1.25 on a low-end
// device), no post-processing, a 1024 shadow map cast by the landmarks
// only, the phone budgets of every module (`mobile` below: trees, traffic,
// birds, leaves, tiles and MS radius) tightened further, no MS far ring,
// a simpler water shader. ?quality=low|high forces a tier and saves it;
// ?quality=auto forgets the saved choice. Auto: phones and small tablets,
// devices with <= 2 GB or <= 2 cores, and a device whose frame probe
// (below) was slow on an earlier visit.
const TIER = (() => {
  const q = new URLSearchParams(location.search).get('quality');
  const store = (k, v) => {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      // storage may be blocked: the choice lasts for this page
    }
  };
  const read = (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  };
  const mem = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  const weak = mem <= 2 || cores <= 2;
  if (q === 'low' || q === 'high') {
    store('porto-tier', q);
    return { tier: q, reason: 'url', weak };
  }
  if (q === 'auto') {
    store('porto-tier', null);
    store('porto-tier-probe', null);
  }
  const saved = read('porto-tier');
  if (saved === 'low' || saved === 'high') return { tier: saved, reason: 'saved', weak };
  if (MOBILE) return { tier: 'low', reason: 'phone', weak: weak || mem <= 4 };
  if (weak) return { tier: 'low', reason: 'low-end', weak };
  if (read('porto-tier-probe') === 'low') return { tier: 'low', reason: 'probe', weak: true };
  return { tier: 'high', reason: 'default', weak };
})();
// light mode: every module gets its phone budget through `mobile`
const LITE = TIER.tier === 'low';
DPR.cap = LITE ? (TIER.weak ? 1.25 : 1.5) : 2;
if (LITE) {
  setWaterLite(true);
  setBuildingsLite(true);
}

// Exposed for tests and debugging: renderer.info, ready flags, flight count.
const debug = (window.__porto = { ready: false, flights: 0, dataStatus: null });
debug.tier = { ...TIER, dprCap: DPR.cap, mobile: MOBILE, reducedMotion };
// Load phases in ms since navigation (docs/perf, /tmp/perf/measure.mjs)
debug.timing = {};
let stopBoot = null; // set while the boot view runs (start)
const mark = (name) => {
  debug.timing[name] = Math.round(performance.now());
};

async function start() {
  // the opening flight (makeIntro) starts with the boot view; the rig
  // takes the camera when it ends (introDoneHook, set once the rig exists)
  let intro = null;
  let introDoneHook = null;
  const loader = createLoader();
  loader.set(0.08, t('Загружаем данные'));

  mark('start');
  // __porto.pois (pois.js): the POI list with opening hours, for the search
  installPois(debug);
  const loaded = await loadData(() => loader.set(0.35, t('Данные получены')));
  mark('data');
  // data.js returns landmarks and routes already localized
  const { landmarks, routes, roads, status, terrain: terrainData, footprints, buildings } = loaded;
  debug.dataStatus = status;
  setLifeData(loaded.life);
  setTrafficAxes(loaded.trafficAxes);
  if (!landmarks.length) loader.set(0.4, `${CITY.name[language] || CITY.name.en}: ${t('пока без достопримечательностей')}`);
  await nextFrame();

  const proj = createProjection(roads.origin, roads.bbox, landmarks, terrainData);
  const { project, heightAt, terrain } = proj;
  debug.projection = { S: proj.S, metresPerUnit: METRES_PER_UNIT, terrain: terrain.source, datum: +terrain.datum.toFixed(1) };
  debug.heightAt = heightAt;
  debug.project = project;

  // the shared height fog replaces the stock chunks before any shader exists
  installAtmosphereFog();
  const canvas = document.getElementById('scene');
  const renderer = createRenderer(canvas);
  const scene = new THREE.Scene();
  // near follows the orbit distance in the render loop (0.5 .. 6 units)
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 16000);
  debug.renderer = renderer;
  debug.scene = scene;
  debug.camera = camera;

  const atmosphere = createAtmosphere(renderer, scene, { reducedMotion, shadowSize: LITE ? 1024 : 4096 });
  debug.atmosphere = atmosphere;

  mark('atmosphere');

  // ------------------------------------------------------------ boot view
  // Progressive start: the sky, the terrain and one gold pin per landmark
  // are drawn (and the intro flies) before the heavy layers exist. The
  // ground is built on the raw DEM first; the landmark pads are patched in
  // once the fits are done (ground.userData.applyPads, scene.js).
  // __porto.ready still means "fully built and interactive".
  loader.set(0.45, t('Строим рельеф'));
  const tb = terrain.bounds;
  const ground = createGround(terrain);
  scene.add(ground);
  // light mode: only the landmarks cast shadows; the hill-shadow proxy goes
  const groundShadow = ground.getObjectByName('ground-shadow');
  if (LITE && groundShadow) groundShadow.visible = false;
  mark('ground');
  // beyond the DEM rectangle the land fades into the haze
  Object.assign(FOG_UNIFORMS.fogRect.value, { x: terrain.bounds.x0, y: terrain.bounds.zN, z: terrain.bounds.x1, w: terrain.bounds.zS });

  // the landmark positions before the fits: the centre of the OSM outline's
  // box (the fit's pivot), else the point itself
  const bootPts = landmarks.map((l) => {
    const o = footprints?.[l.id]?.outline;
    if (o?.length) {
      const p = o.map((q) => project(q[0], q[1]));
      const x = (Math.min(...p.map((v) => v.x)) + Math.max(...p.map((v) => v.x))) / 2;
      const z = (Math.min(...p.map((v) => v.z)) + Math.max(...p.map((v) => v.z))) / 2;
      return { id: l.id, x, z };
    }
    const c = project(l.lat, l.lon);
    return { id: l.id, x: c.x, z: c.z };
  });
  const home = homeFrom(bootPts);
  camera.position.copy(home.position);
  camera.lookAt(home.target);
  const boot = createBootView(bootPts);
  intro = makeIntro();
  boot.start();
  // a build step that throws later stops the boot view (see the .catch below)
  stopBoot = () => {
    boot.stop();
    intro?.skip();
  };

  // Fit every landmark to its footprint: the fits level the ground under
  // them (terrain pads), and everything after reads that ground. Yield
  // every ~60 ms, so the boot view keeps drawing.
  const fits = [];
  let tYield = performance.now();
  for (const l of landmarks) {
    fits.push(fitLandmark(l, { project, rawAt: terrain.rawAt, footprints }));
    if (performance.now() - tYield > 60) {
      await nextFrame();
      tYield = performance.now();
    }
  }
  mark('fits');
  for (const f of fits) if (!f.fallback) terrain.addPad(padFor(f));
  ground.userData.applyPads();
  mark('pads');

  // The landmark massing and labels land first, straight after the fits: the
  // boot view already has the sky, the terrain and one pin per landmark, and
  // these give it the city's silhouette and names while the heavier layers
  // (roads, buildings) still build. Progressive start, never a blank screen.
  loader.set(0.58, t('Ставим достопримечательности'));
  await nextFrame();
  const outlines = landmarks.map((l) => footprints?.[l.id]?.outline?.map((q) => project(q[0], q[1])) ?? null);
  const marks = buildLandmarks(landmarks, fits, heightAt, outlines, (i) => select(i), { lite: LITE, massing: true });
  scene.add(marks.group);
  debug.landmarks = marks.items.map((it) => ({
    id: it.data.id,
    type: it.type,
    size_m: [+it.fit.sizeM.long.toFixed(1), +it.fit.sizeM.short.toFixed(1), +it.fit.sizeM.height.toFixed(1)],
    bearing: +it.fit.target.bearing.toFixed(1),
    front: +it.fit.frontDeg.toFixed(1),
    uniform: it.fit.uniform,
    height_source: it.fit.heightSource,
    x: +it.x.toFixed(1),
    z: +it.z.toFixed(1),
    base: +it.base.toFixed(2),
    top: +it.top.toFixed(2),
  }));

  mark('landmarks');

  loader.set(0.66, t('Прокладываем улицы'));
  await nextFrame();
  const roadLayer = buildRoads(roads, project, heightAt, { waterRibbon: !loaded.nature, lite: LITE });
  scene.add(roadLayer.group);
  debug.roadSegments = roadLayer.counts;
  mark('roads');

  loader.set(0.74, t('Возводим здания'));
  await nextFrame();
  const city = buildBuildings(buildings, project, heightAt, {
    outlines: outlines.filter(Boolean),
    plans: fits.filter((f) => !f.fallback).map((f) => f.plan),
  });
  scene.add(city.group);
  debug.buildings = city.stats;
  mark('buildings');

  // Woods, parks and water from OSM, the streamed tiles around the core, and
  // life and the seasons on top: built after the first full frame, when the
  // browser is idle (deferLayers below). Until then they are null.
  let nature = null;
  let tiles = null;
  let life = null;
  let seasons = null;
  function buildNatureLayer() {
    // Trees keep off streets, buildings, water and every landmark
    // (outline, fitted plan and model box).
    nature = buildNature({
      data: loaded.nature,
      project,
      heightAt,
      rect: { x0: tb.x0, zN: tb.zN, x1: tb.x1, zS: tb.zS },
      roads,
      buildings: city.footprints,
      avoid: {
        outlines: outlines.filter(Boolean),
        plans: fits.filter((f) => !f.fallback).map((f) => f.plan),
        boxes: marks.items.map((it) => it.realBox || it.box).filter(Boolean),
      },
      // light mode: at most 2500 tree clumps in all, core and streamed tiles
      budget: LITE ? 1200 : 5000,
      streamCap: LITE ? 1300 : undefined,
      mobile: LITE,
    });
    scene.add(nature.group);
    if (nature.landcover) ground.userData.setLandcover(nature.landcover, nature.landRect);
    debug.nature = nature.stats;
    if (probeLow) nature.setNearRadius(LITE ? 160 : 220);
    mark('nature');
    // the city around the core, streamed in once the core is on screen (tiles.js)
    tiles = createTiles({ renderer, scene, camera, terrain, heightAt, proj, roadLayer, nature, ground, mobile: LITE, debug });
  }
  // Microsoft footprints in the OSM gaps, core and ring (buildings-ms.js;
  // ?ms=0 off). Built with the deferred layers below: it is the heaviest of
  // the core passes, so the first interactive frame does not wait on it.
  const msPlans = fits.filter((f) => !f.fallback).map((f) => f.plan);
  let ms = null;
  const lightInfo = { dir: atmosphere.sunDir, color: new THREE.Color(), ambient: new THREE.Color() };
  const _amb = new THREE.Color();

  const routeLayer = createRouteLayer({ project, heightAt, landmarks, items: marks.items });
  scene.add(routeLayer.group);

  const labelRenderer = new CSS2DRenderer({ element: document.getElementById('labels') });

  // The exact home view from the fitted landmarks. The boot view framed the
  // outline centres (a few units off at most): the same `home` object is
  // updated in place, so a running intro lands on the exact view, and a
  // camera still resting at the boot home moves with it.
  {
    const exact = homeFrom(marks.items);
    debug.homeShift = +home.position.distanceTo(exact.position).toFixed(2);
    const atHome = !intro?.active && camera.position.distanceTo(home.position) < 0.01;
    home.target.copy(exact.target);
    home.position.copy(exact.position);
    if (atHome) {
      camera.position.copy(home.position);
      camera.lookAt(home.target);
    }
  }

  // Overview: fit Tibães (west) to Sameiro (east), seen from the south.
  // The target sits left of the landmark centre so the map clears the list.
  // (a city without landmarks yet frames its core bbox instead)
  // pts: [{ x, z, id | data.id }] (boot positions or marks.items)
  function homeFrom(pts) {
    const coreBox = roads.bbox || CITY.core_bbox;
    const coreSW = project(coreBox.s, coreBox.w);
    const coreNE = project(coreBox.n, coreBox.e);
    const xs = pts.length ? pts.map((it) => it.x) : [coreSW.x, coreNE.x];
    const zs = pts.length ? pts.map((it) => it.z) : [coreSW.z, coreNE.z];
    const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const midZ = (Math.min(...zs) + Math.max(...zs)) / 2;
    const span = Math.max(...xs) - Math.min(...xs);
    // Phones and other narrow portrait screens start much closer: on the
    // historic centre (cathedral), seen from the west with the eastern hills
    // (Bom Jesus, Sameiro) behind it. The full west-to-east span is
    // unreadable on a 390 px wide screen. The target sits 350 units (1.4 km)
    // in front of the cathedral, so the cathedral lands in the middle of the
    // map strip above the bottom sheet and both sanctuaries clear the header
    // (checked at 390 x 844: cathedral at y 305 of the 47..540 strip).
    const narrow = window.innerWidth <= 900 || window.innerHeight > window.innerWidth;
    // (cities/<id>.json start_view.narrow_landmark: the Sé for Braga)
    const centreId = CITY.start_view.narrow_landmark || CITY.start_view.landmark;
    const centre = pts.find((it) => (it.id ?? it.data?.id) === centreId);
    const phone = narrow && centre;
    const homeOffset = phone
      ? new THREE.Vector3().setFromSphericalCoords(span * 0.3, 1.3, -1.55) // camera west, a little south
      : new THREE.Vector3().setFromSphericalCoords(span * 1.3, 1.0, 0.1);
    const homeTarget = phone
      ? new THREE.Vector3(centre.x, 0, centre.z).addScaledVector(new THREE.Vector3(homeOffset.x, 0, homeOffset.z).normalize(), 350)
      : new THREE.Vector3(midX - span * 0.1, 0, midZ - 60);
    return { target: homeTarget, position: homeTarget.clone().add(homeOffset) };
  }

  // The boot view: its own small render loop (sky, terrain, whatever layer
  // is already built, a gold pin per landmark) until the full loop starts.
  // dt is clamped to 1/30 s, so a long build step slows the intro down
  // instead of making it jump.
  function createBootView(pts) {
    const pinGeo = new THREE.OctahedronGeometry(1, 0);
    pinGeo.scale(0.3, 0.5, 0.3); // unit height, as the landmark pins
    const pinMat = new THREE.MeshBasicMaterial({ color: 0xffc862, transparent: true, opacity: 0.92 });
    pinMat.toneMapped = false;
    const pins = new THREE.InstancedMesh(pinGeo, pinMat, Math.max(1, pts.length));
    pins.count = pts.length;
    pins.frustumCulled = false;
    pins.name = 'boot-pins';
    scene.add(pins);
    const base = pts.map((p) => heightAt(p.x, p.z) + 12); // about a roof above the ground
    const app = document.getElementById('app');
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3();
    const _up = new THREE.Vector3(0, 1, 0);
    let raf = 0;
    let last = performance.now();
    let clockB = 0;
    let firstB = true;
    let bw = 0;
    let bh = 0;
    function tick() {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(Math.max(0, (now - last) / 1000), 1 / 30);
      last = now;
      clockB += dt;
      const w = app.clientWidth;
      const h = app.clientHeight;
      if (w && h && (w !== bw || h !== bh)) {
        bw = w;
        bh = h;
        renderer.setPixelRatio(deviceDpr());
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      renderer.info.reset();
      intro?.update(dt);
      const camDist = camera.position.distanceTo(home.target);
      const near = THREE.MathUtils.clamp(camDist * 0.004, 0.5, 6);
      if (Math.abs(near - camera.near) > camera.near * 0.1) {
        camera.near = near;
        camera.updateProjectionMatrix();
      }
      camera.userData.focus = home.target;
      atmosphere.update(dt, camera);
      for (let i = 0; i < pts.length; i++) {
        _p.set(pts[i].x, base[i], pts[i].z);
        const H = Math.max(0.05, camera.position.distanceTo(_p) * 0.018);
        _p.y += H * 0.9 + (reducedMotion ? 0 : Math.sin(clockB * 1.6 + i * 1.3) * H * 0.12);
        _q.setFromAxisAngle(_up, reducedMotion ? i : clockB * 0.6 + i);
        _m.compose(_p, _q, _s.set(H, H, H));
        pins.setMatrixAt(i, _m);
      }
      pins.instanceMatrix.needsUpdate = true;
      renderer.render(scene, camera);
      debug.calls = renderer.info.render.calls;
      debug.triangles = renderer.info.render.triangles;
      if (firstB) {
        firstB = false;
        mark('firstFrame');
        loader.set(1, t('Готово'));
        loader.done();
      }
    }
    return {
      start() {
        if (!raf) raf = requestAnimationFrame(tick);
      },
      stop() {
        cancelAnimationFrame(raf);
        raf = 0;
        scene.remove(pins);
        pinGeo.dispose();
        pinMat.dispose();
      },
    };
  }

  // The opening flight: once per browser session, never over a deep link
  // or under reduced motion. ?intro=1 forces it, ?intro=0 skips it. It
  // starts with the boot view, before the city is built.
  function makeIntro() {
    const param = new URLSearchParams(location.search).get('intro');
    const deep = /(^|[#&])((place|route)=|(cinema|story)(&|$))/.test(location.hash);
    let seen = false;
    try {
      seen = sessionStorage.getItem('porto-intro') === '1';
    } catch {
      seen = false;
    }
    if (!(param === '1' || param === 'hold' || (param !== '0' && !reducedMotion && !deep && !seen))) return null;
    debug.introDone = false;
    // high over the Cávado side, north of the data edge, looking steeply
    // down across the city: the frame's lower edge still lands on real
    // ground. The swing to the southern overview passes the west.
    const D = tb.zS - tb.zN;
    const startTarget = new THREE.Vector3(home.target.x + 150, 0, tb.zN + 0.35 * D);
    const it = createIntro({
      camera,
      home,
      heightAt,
      start: {
        position: new THREE.Vector3(home.target.x - 420, 2600, tb.zN - 650),
        target: startTarget,
      },
      onDone: () => {
        debug.introDone = true;
        introDoneHook?.();
      },
    });
    debug.intro = it;
    // ?intro=hold: frozen at the start, for tests (debug.intro.seek(k))
    if (param === 'hold') it.seek(0);
    try {
      sessionStorage.setItem('porto-intro', '1');
    } catch {
      // without storage the intro may play again on reload
    }
    return it;
  }

  // ------------------------------------------------------------ effects
  // On by default on desktop; off on phones and under reduced motion.
  // ?fx=1 / ?fx=0 forces it (tests, screenshots). The user's own choice is
  // saved; the automatic low-end downgrade below never is.
  const fx = createEffects(renderer, scene, camera, { reducedMotion });
  const fxParam = new URLSearchParams(location.search).get('fx');
  let fxSaved = null;
  try {
    fxSaved = localStorage.getItem('porto-fx');
  } catch {
    fxSaved = null;
  }
  const fxForced = fxParam === '1' || fxParam === '0';
  // light mode: no post-processing unless ?fx=1 (a saved "on" waits for high)
  const fxWanted = fxForced ? fxParam === '1' : LITE ? false : fxSaved ? fxSaved === 'on' : !MOBILE && !reducedMotion;
  const fxButton = document.getElementById('fx-toggle');
  // Emissive things need linear HDR values above the bloom threshold; with
  // effects off they are drawn untone-mapped and keep their plain colours.
  const glowBoost = [];
  function registerGlow(material, k) {
    if (!material?.color || glowBoost.some((g) => g.material === material)) return;
    glowBoost.push({ material, base: material.color.clone(), k });
  }
  registerGlow(marks.pins?.material, 2.8);
  // the gold OSM outlines stay gold under tone mapping instead of going white
  registerGlow(marks.outlineMaterial, 0.62);
  function setFx(on, { save = false, reason = '' } = {}) {
    fx.setEnabled(on);
    atmosphere.setLinearOutput(on);
    for (const g of glowBoost) g.material.color.copy(g.base).multiplyScalar(on ? g.k : 1);
    roadLayer.setBloom?.(on);
    routeLayer?.setBloom?.(on);
    if (fxButton) {
      fxButton.setAttribute('aria-pressed', String(on));
      fxButton.querySelector('.fx-state').textContent = on ? t('вкл') : t('выкл');
    }
    if (save) {
      try {
        localStorage.setItem('porto-fx', on ? 'on' : 'off');
      } catch {
        // storage may be blocked; the choice lasts for this page
      }
    }
    debug.fx = { enabled: on, reason: reason || (fxForced ? 'url' : fxSaved ? 'saved' : 'default') };
  }
  fxButton?.addEventListener('click', () => {
    probe = null; // an explicit choice ends the low-end probe
    setFx(!fx.enabled, { save: true, reason: 'user' });
  });
  // Low-end probe: average frame time over 3 s after the first frames
  // (shader compiles and the environment map would skew it). Above 33 ms:
  // no post-processing and half the shadow map.
  let probe = fxForced || (fxSaved === 'on' && !LITE) ? null : { skip: 20, n: 0, sum: 0, t0: 0 };
  let probeLow = false; // the probe found a slow device

  // ------------------------------------------------------------ governor
  // The one-shot probe above catches the first slow visit. On top of it a
  // rolling window keeps watching the frame interval once the app is ready:
  // when the device cannot hold the target the governor steps the expensive
  // knobs down — drawing-buffer ratio, shadow map, post stack, landmark and
  // nature near-LOD radii, tile budget — and steps them back up when there is
  // headroom again. This is adaptive, not a static cap: a fast machine keeps
  // the full tier, a slow one loses only what it cannot afford. An explicit
  // ?quality=high/low (and a saved choice) sets the ceiling, so the governor
  // never turns a phone into a desktop tier or the other way round.
  const BASE_DPR = DPR.cap;
  const BASE_SHADOW = LITE ? 1024 : 4096;
  // Step down only when the median frame clearly misses the target, step back
  // up only with real headroom: a phone holding ~30 fps keeps its quality, a
  // desktop running at 30 fps gives some up, and a downscaled desktop recovers
  // once it is back under 18 ms.
  const GOV_DOWN_MS = LITE ? 38 : 21; // ~26 fps light, ~48 fps high
  const GOV_UP_MS = LITE ? 26 : 18;
  const GOV_MAX = 3;
  const GOV_STEPS = [
    { dpr: 1, shadow: 1, radius: 1, post: 0 },
    { dpr: 0.82, shadow: 0.5, radius: 0.8, post: 1 },
    { dpr: 0.66, shadow: 0.25, radius: 0.62, post: 2 },
    { dpr: 0.5, shadow: 0.25, radius: 0.5, post: 3 },
  ];
  let govLevel = 0;
  let govCooldown = 0;
  const govWin = [];
  function applyGovLevel(level) {
    const s = GOV_STEPS[level];
    DPR.cap = level === 0 ? BASE_DPR : Math.max(1, +(BASE_DPR * s.dpr).toFixed(2));
    atmosphere.setShadowSize(level === 0 ? BASE_SHADOW : Math.max(1024, Math.round(BASE_SHADOW * s.shadow)));
    marks.setNearRadiusM((LITE ? 1400 : 2200) * s.radius);
    nature?.setNearRadius((LITE ? 160 : 220) * s.radius);
    tiles?.setBudgetScale(s.radius);
    fx.setPostLevel(s.post);
    resize();
    debug.governor = { level, dpr: DPR.cap, shadow: atmosphere.sun.shadow.mapSize.x, radiusK: s.radius, post: s.post };
  }
  // rawDt is the wall-clock frame interval; the median ignores one-off long
  // tasks (tile integration, a shadow-map rebuild) so a single hitch does not
  // downscale a device that is otherwise holding the target.
  function governorTick(rawDt) {
    if (probe) return; // the first-visit probe owns the start
    if (debug.frames < 120 || document.hidden) return;
    if (govCooldown > 0) { govCooldown--; return; }
    govWin.push(rawDt);
    if (govWin.length < 40) return;
    const sorted = govWin.slice().sort((a, b) => a - b);
    const medMs = sorted[sorted.length >> 1] * 1000;
    govWin.length = 0;
    debug.frameMs = +medMs.toFixed(1);
    if (medMs > GOV_DOWN_MS && govLevel < GOV_MAX) {
      applyGovLevel(++govLevel);
      govCooldown = 200;
    } else if (medMs < GOV_UP_MS && govLevel > 0) {
      applyGovLevel(--govLevel);
      govCooldown = 300;
    }
  }
  debug.governor = { level: 0, dpr: DPR.cap, shadow: BASE_SHADOW, radiusK: 1, post: 0 };
  // test/debug hook: force a governor level (0 full .. 3 cheapest)
  debug.setGovernorLevel = (n) => {
    govLevel = Math.max(0, Math.min(GOV_MAX, n | 0));
    govWin.length = 0;
    govCooldown = 300;
    applyGovLevel(govLevel);
  };

  const indexById = new Map(landmarks.map((l, i) => [l.id, i]));
  const routeById = new Map(routes.map((r) => [r.id, r]));
  let active = -1; // landmark index in the detail panel
  let route = null; // { route, plan, path, box, stopIdx: [] } while a route is shown
  let tour = null; // fly-along driver while it plays
  let cinema = null; // cinema and story modes, created further down
  let story = null;

  const rig = createCameraRig(camera, canvas, heightAt, {
    reducedMotion,
    bounds: terrain.bounds, // keyboard flight keeps near the terrain rectangle
    onFlightEnd: () => {
      debug.flights++;
    },
    // the streamers load around the destination while the camera is still on its way
    onFlightStart: (target, duration) => {
      tiles?.prefetch(target.x, target.z, duration + 8);
      ms?.prefetch(target.x, target.z, duration + 8);
    },
    // a click or wheel on the map ends whatever drove the camera
    onTourCancel: () => {
      cinema?.stop();
      story?.stop();
      finishTour();
    },
  });
  rig.controls.target.copy(home.target);
  rig.controls.update();
  debug.rig = rig; // scripted views for screenshots: __porto.rig.flyTo(pos, target, s)

  const ui = createUI(landmarks, routes, {
    onSelect: (i) => select(i),
    onClose: () => close(),
    onBack: () => close(),
    onStep: (d) => step(d),
    onFilter: (hidden) => {
      marks.setHiddenCategories(hidden);
      if (active >= 0 && hidden.has(landmarks[active].category)) close();
    },
    onRouteSelect: (id) => openRoute(id),
    onRouteClose: () => exitRoute(),
    onStopClick: (k) => select(route.stopIdx[k]),
    onPlayToggle: () => (tour ? stopTour() : startTour()),
    onPanorama: (p, from) => panorama.open(p, from),
    onShare: () => share(),
    // callout card: «Подробнее» opens the full panel; «360°» the viewer
    // (an image) or the panel's 360° tab (a video)
    onMore: () => showPanel(),
    onPanoCallout: (p, from) => {
      if (p.type === 'image') panorama.open(p, from);
      else {
        showPanel();
        ui.selectTab('pano');
      }
    },
  });

  // ------------------------------------------------------------ search
  const search = createSearch({
    landmarks,
    routes,
    roads,
    project,
    heightAt,
    scene,
    camera,
    rig,
    renderer,
    reducedMotion,
    onPlace: (i) => {
      if (route) exitRoute();
      select(i);
    },
    onRoute: (id) => openRoute(id),
    toast: (msg, ms) => ui.toast(msg, ms),
    isBlocked: () => !!(cinema?.active || story?.active || intro?.active),
  });
  debug.search = search;

  // ------------------------------------------------------------ render loop control
  let paused = false;
  const panorama = createPanorama({
    reducedMotion,
    onOpen: () => pauseLoop(),
    onClose: () => resumeLoop(),
  });

  // ------------------------------------------------------------ hash
  function setHash(h) {
    const url = location.pathname + location.search + (h ? `#${h}` : '');
    if (url !== location.pathname + location.search + location.hash) history.replaceState(null, '', url);
  }
  // #place=<id> or #route=<id>, plus time= and the weather (weather= or
  // live=1, from live.js) when they differ from the default
  function currentHash() {
    const parts = [];
    if (route) parts.push(`route=${route.route.id}`);
    else if (active >= 0) parts.push(`place=${landmarks[active].id}`);
    if (atmosphere.time !== DEFAULT_TIME) parts.push(`time=${atmosphere.time}`);
    // until life and the seasons exist (deferLayers), keep what the link said
    const was = life && seasons ? null : new URLSearchParams(location.hash.replace(/^#/, ''));
    if (life) {
      if (debug.life?.live.hash) parts.push(debug.life.live.hash);
    } else for (const k of ['weather', 'live']) if (was.has(k)) parts.push(`${k}=${was.get(k)}`);
    if (seasons) {
      if (debug.season && debug.season !== debug.seasons?.today) parts.push('season=' + (debug.season === 'fall' ? 'autumn' : debug.season));
    } else if (was.has('season')) parts.push(`season=${was.get('season')}`);
    return parts.join('&');
  }
  function applyHash() {
    const q = new URLSearchParams(location.hash.replace(/^#/, ''));
    const tm = q.get('time');
    if (tm && TIMES.includes(tm) && tm !== atmosphere.time) setTime(tm, { writeHash: false });
    // #cinema and #story open the two guided modes
    if (q.has('cinema')) return void (cinema.active || startMode('cinema'));
    if (q.has('story')) return void (story.active || startMode('story'));
    const r = q.get('route');
    const p = q.get('place');
    if (r) {
      if (routeById.has(r)) {
        if (route?.route.id !== r) openRoute(r);
      } else console.warn(`[porto] #route=${r}: no such route`);
    } else if (p) {
      if (!indexById.has(p)) console.warn(`[porto] #place=${p}: no such place`);
      else if (indexById.get(p) !== active) select(indexById.get(p));
    }
  }

  // Real scale is the only view: every model is 1:1 (fit.js), never scaled.
  // The key of the old diorama switch is dropped.
  try {
    localStorage.removeItem('porto-scale');
  } catch {
    // storage may be blocked
  }

  // ------------------------------------------------------------ time of day
  // morning, day, sunset (default: golden hour), night. Saved in
  // localStorage and, when not the default, in the hash as time=.
  const timeButtons = [...document.querySelectorAll('#time-switch [data-time]')];
  function setTime(name, { animate = !reducedMotion, writeHash = true } = {}) {
    if (!TIMES.includes(name)) name = DEFAULT_TIME;
    for (const b of timeButtons) b.setAttribute('aria-pressed', String(b.dataset.time === name));
    atmosphere.setTime(name, { animate });
    try {
      localStorage.setItem('porto-time', name);
    } catch {
      // storage may be blocked; the hash still carries the choice
    }
    debug.time = name;
    if (writeHash) setHash(currentHash());
  }
  for (const b of timeButtons) b.addEventListener('click', () => setTime(b.dataset.time));
  {
    let saved = null;
    try {
      saved = localStorage.getItem('porto-time');
    } catch {
      saved = null;
    }
    const fromHash = new URLSearchParams(location.hash.replace(/^#/, '')).get('time');
    setTime(fromHash || saved || DEFAULT_TIME, { animate: false, writeHash: false });
  }
  debug.setTime = setTime;

  async function share() {
    const url = location.href.split('#')[0].replace(/\?$/, '') + (currentHash() ? `#${currentHash()}` : '');
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      // fallback for browsers without the async clipboard or without permission
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.append(ta);
      ta.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
    }
    debug.lastShare = url;
    ui.toast(ok ? `${t('Ссылка скопирована:')} ${url.replace(/^https?:\/\//, '')}` : `${t('Скопируйте ссылку:')} ${url}`, ok ? 2600 : 6000);
  }

  // ------------------------------------------------------------ places
  function stopPos(i) {
    if (!route) return null;
    const k = route.stopIdx.indexOf(i);
    return k >= 0 ? `${k + 1} / ${route.stopIdx.length}` : null;
  }

  // A place opens as the callout card next to its building (C1). The full
  // panel comes with «Подробнее», and stays while it is open (arrows step
  // through it). Inside a route the panel opens at once, as before: the
  // route panel holds the right-hand side.
  function select(i) {
    if (i == null || i < 0) return;
    if (tour) stopTour();
    active = i;
    marks.setActive(i);
    if (route || ui.isOpen()) showPanel();
    else {
      ui.callout.show(landmarks[i]);
      ui.markActive(i);
    }
    frameActive();
    setHash(currentHash()); // a shown route keeps #route=, else #place=
  }

  function showPanel() {
    if (active < 0) return;
    const vis = ui.visibleIndices();
    ui.callout.hide();
    ui.show(active, {
      pos: stopPos(active) || `${vis.indexOf(active) + 1} / ${vis.length}`,
      back: route ? t('к маршруту') : null,
    });
  }

  // Where the subject should land on screen. Callout, desktop: in the free
  // map between the list and the card's side; phones: in the strip above
  // the docked card. With the full panel: the old framing.
  function calloutFocus() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (!ui.callout.open) return null;
    if (W <= 900) {
      const cardTop = H - (ui.callout.size.h || 170) - 24;
      return { x: W / 2, y: 70 + (cardTop - 70) * 0.5, fill: Math.max(0.3, (cardTop - 90) / H) };
    }
    const side = document.querySelector('.side')?.getBoundingClientRect();
    const left = (side?.right ?? 0) + 16;
    const cardW = (ui.callout.size.w || 360) + 64;
    return { x: left + (W - 24 - cardW - left) * 0.55, y: H * 0.54, fill: 0.62 };
  }

  function frameActive() {
    const it = marks.items[active];
    if (!it) return;
    rig.frame(it.box, { panelOpen: true, bearing: it.viewBearing, base: it.draped ? null : it.base, focus: calloutFocus(), orbit: (15 * Math.PI) / 180 });
  }

  function close() {
    if (active < 0) return;
    active = -1;
    ui.hide();
    ui.callout.hide();
    marks.setActive(-1);
    if (route) ui.reopenRoute();
    setHash(currentHash());
  }

  function step(d) {
    const vis = route ? route.stopIdx : ui.visibleIndices();
    if (!vis.length) return;
    const pos = vis.indexOf(active);
    const next = pos < 0 ? (d > 0 ? 0 : vis.length - 1) : (pos + d + vis.length) % vis.length;
    select(vis[next]);
  }

  // ------------------------------------------------------------ routes
  // The part of the screen the panels leave for the map, in CSS px.
  // Desktop: between the side list and the right panel, below the header.
  // Mobile: above the bottom sheet.
  function freeView() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const side = document.querySelector('.side').getBoundingClientRect();
    if (W > 900) return { left: side.right + 12, right: W - 440, top: 90, bottom: H - 20 };
    return { left: 0, right: W, top: 70, bottom: H * 0.36 };
  }

  function setDim(onRoute) {
    for (const it of marks.items) it.labelEl.classList.toggle('is-dim', !!onRoute && !onRoute.has(it.index));
    // model and pin dimming lives in landmarks.js; use it when it exists
    marks.setDimmed?.(onRoute);
  }

  function openRoute(id) {
    const r = routeById.get(id);
    if (!r) return;
    if (tour) stopTour();
    ui.callout.hide();
    if (active >= 0) {
      active = -1;
      ui.hide();
      marks.setActive(-1);
    }
    const built = routeLayer.show(r);
    route = { ...built, stopIdx: r.stops.map((s) => indexById.get(s.landmark_id)) };
    setDim(new Set(route.stopIdx));
    ui.setView('routes');
    ui.showRoute(r, built.plan);
    rig.fitBox(built.box, freeView());
    setHash(currentHash()); // route=, plus time= / weather= when set
    debug.route = { id, stops: route.stopIdx.length, total: +built.path.total.toFixed(0), points: built.path.xyz.length, lines: routeLayer.group.children.filter((c) => c.isLine2).length };
  }

  function exitRoute() {
    if (!route) return;
    if (tour) stopTour();
    route = null;
    routeLayer.clear();
    setDim(null);
    ui.callout.hide();
    if (active >= 0) {
      active = -1;
      ui.hide();
      marks.setActive(-1);
    }
    ui.hideRoute();
    setHash(currentHash());
    debug.route = null;
  }

  function pulseLabel(i) {
    for (const it of marks.items) it.labelEl.classList.toggle('is-pulse', it.index === i);
  }

  function startTour() {
    if (!route) return;
    if (active >= 0) close();
    ui.reopenRoute();
    tour = createFlyAlong(route.path, {
      reducedMotion,
      heightAt,
      lateral: window.innerWidth > 900 ? 0.3 : 0,
      onStop: (k) => {
        ui.setStopActive(k);
        if (!reducedMotion) {
          routeLayer.pulse(k);
          pulseLabel(route.stopIdx[k]);
        }
        debug.tourStops = (debug.tourStops || 0) + 1;
      },
      onEnd: () => finishTour(),
    });
    rig.drive(tour);
    ui.setPlaying(true);
    debug.tour = tour;
    debug.tourStops = 0;
  }

  function finishTour() {
    if (!tour) return;
    tour = null;
    ui.setPlaying(false);
    routeLayer.pulse(-1);
    pulseLabel(-1);
  }

  function stopTour() {
    rig.stopDrive();
    finishTour();
  }

  // ------------------------------------------------------------ cinema, story
  // Two guided modes that drive the camera through the rig (tour.js,
  // story.js). Both hide the panels, change the time of day as they go and
  // put it back on exit; the hash says #cinema or #story while they run.
  const sky = createSkyline({ buildings, project, heightAt, boxes: marks.items.map((it) => it.realBox) });
  const modeTime = (name) => {
    atmosphere.setTime(name, { animate: !reducedMotion });
    debug.time = name;
  };
  const modeCtx = {
    camera,
    rig,
    items: marks.items,
    sky,
    home,
    reducedMotion,
    setTime: modeTime,
    getTime: () => atmosphere.time,
    onExit: () => {
      setTime(atmosphere.time, { writeHash: false }); // buttons and storage follow
      setHash(currentHash());
    },
  };
  cinema = createCinema(modeCtx);
  const storyLabels = (ids) => {
    const on = new Set(ids);
    for (const it of marks.items) it.labelEl.classList.toggle('is-story-focus', on.has(it.data.id));
  };
  story = createStory({
    ...modeCtx,
    load: loadStory,
    onFocus: storyLabels,
    onExit: () => {
      storyLabels([]);
      modeCtx.onExit();
    },
    onError: () => {
      ui.toast(t('Не удалось загрузить историю'), 4000);
      setHash(currentHash());
    },
  });
  function startMode(name) {
    if (intro?.active) intro.skip();
    if (tour) stopTour();
    if (active >= 0) close();
    if (route) exitRoute();
    ui.setLegend(false);
    ui.tools.set(false, { focus: false });
    ui.atmo.close();
    search.close();
    flyKeys.reset();
    if (name === 'cinema') {
      story.stop();
      cinema.start();
    } else {
      cinema.stop();
      story.start();
    }
    setHash(name);
  }
  document.getElementById('cinema-toggle')?.addEventListener('click', () => startMode('cinema'));
  document.getElementById('story-toggle')?.addEventListener('click', () => startMode('story'));
  debug.cinema = cinema;
  debug.story = story;
  debug.sky = sky;

  // ------------------------------------------------------------ keys
  // One dispatcher. Open dialogs (panorama, lightbox) own their keys. Then
  // Esc peels one layer: fly-along, detail (back to the route), route.
  // Then the fly keys (fly.js): WASD, Q/E, arrows. While a place is open and
  // no other fly key is held, ← / → still step through the places.
  const flyKeys = createFlyKeys({
    rig,
    debug,
    // the intro, the route fly-along and the guided modes own the camera
    isBlocked: () => !!(intro?.active || tour || cinema?.active || story?.active),
    placeOpen: () => active >= 0,
  });
  window.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable) return;
    // cinema and story own every key while they play
    if (cinema?.active) return void cinema.onKey(e);
    if (story?.active) return void story.onKey(e);
    if (e.key === 'Escape') {
      if (ui.tools.open) ui.tools.set(false); // the phone's tools sheet first
      else if (tour) stopTour();
      else if (active >= 0) close();
      else if (route) exitRoute();
      else ui.setLegend(false);
      return;
    }
    if (flyKeys.down(e)) return;
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    if (t instanceof Element && t.closest('[role="tablist"]')) return; // tabs use arrows
    if (tour) return;
    e.preventDefault();
    step(e.key === 'ArrowRight' ? 1 : -1);
  });

  // Click picking: ignore drags.
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down = null;
  const toNdc = (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    toNdc(e);
    raycaster.setFromCamera(ndc, camera);
    const hit = marks.pick(raycaster);
    if (hit != null) select(hit);
  });
  let hoverQueued = false;
  canvas.addEventListener('pointermove', (e) => {
    if (hoverQueued || e.buttons) return;
    hoverQueued = true;
    requestAnimationFrame(() => {
      hoverQueued = false;
      toNdc(e);
      raycaster.setFromCamera(ndc, camera);
      setHover(marks.pick(raycaster) ?? -1);
    });
  });
  canvas.addEventListener('pointerleave', () => setHover(-1));
  canvas.addEventListener('pointerdown', () => canvas.classList.add('is-dragging'));
  window.addEventListener('pointerup', () => canvas.classList.remove('is-dragging'));

  // Hover: pointer cursor, the pin pulses, its label lifts.
  let hover = -1;
  let hoverT = 0;
  function setHover(i) {
    if (i === hover) return;
    marks.items[hover]?.labelEl.classList.remove('is-hover');
    hover = i;
    hoverT = 0;
    marks.items[hover]?.labelEl.classList.add('is-hover');
    canvas.style.cursor = hover >= 0 ? 'pointer' : '';
  }
  // labels double as hover targets
  for (const it of marks.items) {
    it.labelEl.addEventListener('pointerenter', () => setHover(it.index));
    it.labelEl.addEventListener('pointerleave', () => setHover(-1));
  }
  const _hm = new THREE.Matrix4();
  const _hs = new THREE.Matrix4();
  function pulseHoverPin(dt) {
    if (hover < 0 || !marks.pins?.getMatrixAt) return;
    hoverT += dt;
    // one soft swell, then a slow breathing pulse
    const k = 1 + 0.28 * Math.min(1, hoverT * 6) + (reducedMotion ? 0 : 0.08 * Math.sin(hoverT * 6.5));
    marks.pins.getMatrixAt(hover, _hm);
    const e = _hm.elements;
    _hs.makeScale(k, k, k);
    // scale about the pin's own position
    const px = e[12];
    const py = e[13];
    const pz = e[14];
    _hm.setPosition(0, 0, 0).premultiply(_hs).setPosition(px, py, pz);
    marks.pins.setMatrixAt(hover, _hm);
    marks.pins.instanceMatrix.needsUpdate = true;
  }

  // Resize: CSS owns the size; renderer, labels and line widths follow.
  const container = document.getElementById('app');
  let size = { w: 0, h: 0, dpr: 0 };
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    const dpr = deviceDpr(); // capped by the tier (scene.js DPR)
    if (!w || !h || (w === size.w && h === size.h && dpr === size.dpr)) return;
    size = { w, h, dpr };
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    labelRenderer.setSize(w, h);
    roadLayer.setResolution(w, h, dpr);
    routeLayer.setResolution(w, h);
    fx.setSize(w, h, dpr);
    // after fx: the 2x quality mode may have raised the buffer ratio (far LOD)
    marks.setResolution(w, h, renderer.getPixelRatio());
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  // ------------------------------------------------------------ labels
  // Labels without clutter (every 120 ms):
  //  - priority: the active place, then route stops, then importance
  //    (search.js IMPORTANCE, 3 for a place not in it) over distance;
  //  - collision: a label that overlaps a higher-priority one hides;
  //  - far zoom (orbit distance over CLUSTER_FROM): labels closer than
  //    CLUSTER_PX on screen merge into one bubble «Центр · 18 мест»; a click
  //    flies in, and the bubble splits as the zoom spreads its places;
  //    never with a route shown or in story mode (their labels must stay);
  //  - close up: a label shows a small photo of the place (THUMB_MAX at once).
  const _v = new THREE.Vector3();
  const CLUSTER_FROM = 1100; // world units (4.4 km)
  const CLUSTER_PX = 70;
  const THUMB_UNDER = 380; // camera to label, world units (1.5 km)
  const THUMB_MAX = 6;
  const clusterLayer = document.getElementById('clusters');
  const centreItem = marks.items.find((it) => it.data.id === (CITY.start_view?.narrow_landmark || CITY.start_view?.landmark));
  for (const it of marks.items) {
    it.rank = IMPORTANCE[it.data.id] ?? 3;
    const el = it.labelEl;
    const name = el.textContent;
    const thumb = document.createElement('span');
    thumb.className = 'map-label-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = 'map-label-text';
    text.textContent = name;
    el.replaceChildren(thumb, text);
    el.dataset.rank = String(it.rank);
  }
  let clusters = []; // [{ members: [it], el }]
  const clusterPool = [];
  function clusterEl(k) {
    let b = clusterPool[k];
    if (!b) {
      b = document.createElement('button');
      b.type = 'button';
      b.className = 'cluster';
      b.tabIndex = -1;
      b.addEventListener('click', () => {
        const c = clusters.find((cl) => cl.el === b);
        if (!c) return;
        const box = new THREE.Box3();
        for (const it of c.members) box.union(it.box);
        rig.fitBox(box, freeView());
      });
      clusterLayer?.append(b);
      clusterPool[k] = b;
    }
    return b;
  }
  // «Центр» for the first (largest) bubble around the centre landmark; any
  // other bubble takes the name of its most important place
  function clusterName(members, centreFree) {
    const top = members.reduce((a, b) => (b.rank > a.rank ? b : a));
    if (centreItem && centreFree) {
      const cx = members.reduce((s, it) => s + it.center.x, 0) / members.length;
      const cz = members.reduce((s, it) => s + it.center.z, 0) / members.length;
      if (Math.hypot(cx - centreItem.center.x, cz - centreItem.center.z) < 320) return t('Центр');
    }
    return top.data.name;
  }
  let lastDeclutter = 0;
  function declutter(now, camDist) {
    if (now - lastDeclutter < 120) return;
    lastDeclutter = now;
    const placed = [];
    const onRoute = route ? new Set(route.stopIdx) : null;
    const rank = (it) => (it.index === active ? 2 : onRoute?.has(it.index) ? 1 : 0);
    const order = marks.items
      .filter((it) => it.label.visible)
      .map((it) => {
        _v.copy(it.label.position).project(camera);
        const d = camera.position.distanceTo(it.label.position);
        return { it, sx: (_v.x * 0.5 + 0.5) * size.w, sy: (-_v.y * 0.5 + 0.5) * size.h, d, behind: _v.z > 1, score: it.rank / Math.max(1, d / 400) };
      })
      .sort((a, b) => rank(b.it) - rank(a.it) || b.score - a.score || a.d - b.d);

    // far zoom: greedy clusters around the highest-priority labels
    const clustering = camDist > CLUSTER_FROM && !route && !story?.active && !cinema?.active;
    const seeds = [];
    if (clustering) {
      for (const o of order) {
        if (o.behind || o.it.index === active) continue;
        const s = seeds.find((c) => Math.hypot(c.sx - o.sx, c.sy - o.sy) < CLUSTER_PX);
        if (s) s.members.push(o);
        else seeds.push({ sx: o.sx, sy: o.sy, members: [o] });
      }
      // two bubbles never sit on each other: groups whose centres are
      // closer than two radii merge (bubbles are wider than a label)
      const mid = (s) => [s.members.reduce((a, o) => a + o.sx, 0) / s.members.length, s.members.reduce((a, o) => a + o.sy, 0) / s.members.length];
      for (let merged = true; merged; ) {
        merged = false;
        for (let a = 0; a < seeds.length && !merged; a++) {
          for (let b = a + 1; b < seeds.length; b++) {
            if (seeds[a].members.length < 3 || seeds[b].members.length < 3) continue;
            const [ax, ay] = mid(seeds[a]);
            const [bx, by] = mid(seeds[b]);
            if (Math.abs(ax - bx) < CLUSTER_PX * 2.4 && Math.abs(ay - by) < CLUSTER_PX * 0.8) {
              seeds[a].members.push(...seeds[b].members);
              seeds.splice(b, 1);
              merged = true;
              break;
            }
          }
        }
      }
    }
    const inCluster = new Set();
    const next = [];
    for (const s of seeds) {
      if (s.members.length < 3) continue;
      for (const o of s.members) inCluster.add(o.it);
      next.push({ members: s.members.map((o) => o.it) });
    }
    next.sort((a, b) => b.members.length - a.members.length);
    let centreFree = true;
    next.forEach((c, k) => {
      c.el = clusterEl(k);
      const n = c.members.length;
      c.el.textContent = '';
      const name = document.createElement('span');
      name.className = 'cluster-name';
      name.textContent = clusterName(c.members, centreFree);
      if (name.textContent === t('Центр')) centreFree = false;
      const count = document.createElement('span');
      count.className = 'cluster-count';
      count.textContent = `${n} ${placesWord(n)}`;
      c.el.append(name, count);
      c.el.title = c.members.map((it) => it.data.name).join(', ');
      c.el.hidden = false;
    });
    for (let k = next.length; k < clusterPool.length; k++) clusterPool[k].hidden = true;
    clusters = next;
    placeClusters();

    // thumbnails: the nearest shown labels, when close
    let thumbs = 0;
    for (const o of order) {
      const el = o.it.labelEl;
      const want = !o.behind && !inCluster.has(o.it) && o.d < THUMB_UNDER && thumbs < THUMB_MAX && !!o.it.data.image && !route;
      if (want) {
        thumbs++;
        const th = el.firstChild;
        if (th && !th.firstChild) {
          const img = document.createElement('img');
          img.alt = '';
          img.decoding = 'async';
          img.loading = 'lazy';
          img.src = assetUrl(o.it.data.image);
          th.append(img);
        }
      }
      el.classList.toggle('has-thumb', want);
    }

    // the UI is in the way too: a label under the header, the list or a
    // card hides (the callout names the active place itself)
    blocks = obstacles();
    const hits = (box) => blocks.some((p) => box.l < p.r && box.r > p.l && box.t < p.b && box.b > p.t);
    for (const o of order) {
      const el = o.it.labelEl;
      if (inCluster.has(o.it) || (o.it.index === active && ui.callout.open)) {
        el.classList.add('is-muted');
        continue;
      }
      const w = el.offsetWidth || 120;
      const h = (el.offsetHeight || 22) + 10;
      const box = { l: o.sx - w / 2 - 4, r: o.sx + w / 2 + 4, t: o.sy - h - 2, b: o.sy + 2 };
      const clash = placed.some((p) => box.l < p.r && box.r > p.l && box.t < p.b && box.b > p.t);
      const offEdge = box.l < 0 || box.r > size.w || box.t < 0; // a clipped name reads as a typo
      const show = !o.behind && (!clash || o.it.index === active) && !hits(box) && !offEdge;
      el.classList.toggle('is-muted', !show);
      if (show) placed.push(box);
    }
    // a bubble hides the labels it overlaps too
    for (const c of clusters) {
      const r = c.el.getBoundingClientRect();
      for (const o of order) {
        if (inCluster.has(o.it) || o.it.index === active || o.it.labelEl.classList.contains('is-muted')) continue;
        if (o.sx > r.left - 50 && o.sx < r.right + 50 && o.sy > r.top - 4 && o.sy < r.bottom + 30) o.it.labelEl.classList.add('is-muted');
      }
    }
  }
  let blocks = [];
  function obstacles() {
    const out = [];
    const add = (el) => {
      if (!el || el.hidden) return;
      const r = el.getBoundingClientRect();
      if (r.width && r.height && r.bottom > 0 && r.top < size.h) out.push({ l: r.left, r: r.right, t: r.top, b: r.bottom });
    };
    for (const el of document.querySelectorAll('.topbar > .brand, .topbar > .search, .topbar > .modes, .topbar > .tools-toggle, .topbar > .life-badge')) add(el);
    const side = document.querySelector('.side');
    if (side && getComputedStyle(side).opacity !== '0') add(side);
    if (ui.isOpen()) add(document.getElementById('detail'));
    if (ui.routeOpen()) add(document.getElementById('route-panel'));
    if (ui.callout.open) add(document.querySelector('#callout .callout-inner'));
    return out;
  }
  // bubbles sit on the members' mean screen point, every frame
  function placeClusters() {
    for (const c of clusters) {
      let x = 0;
      let y = 0;
      let n = 0;
      for (const it of c.members) {
        _v.copy(it.label.position).project(camera);
        if (_v.z > 1) continue;
        x += (_v.x * 0.5 + 0.5) * size.w;
        y += (-_v.y * 0.5 + 0.5) * size.h;
        n++;
      }
      const cx = x / Math.max(1, n);
      const cy = y / Math.max(1, n) - 16;
      const blocked = blocks.some((p) => cx > p.l - 40 && cx < p.r + 40 && cy > p.t - 10 && cy < p.b + 10);
      c.el.classList.toggle('is-off', !n || blocked);
      if (n) c.el.style.transform = `translate(${(x / n).toFixed(1)}px, ${(y / n).toFixed(1)}px) translate(-50%, -100%)`;
    }
  }

  // The callout follows its pin: projected each frame, kept in the free
  // part of the screen (below the header, right of the list).
  const _pin = new THREE.Vector3();
  function placeCallout() {
    if (!ui.callout.open) return;
    const it = marks.items[active];
    if (!it) return;
    _pin.set(it.center.x, it.pinY ?? it.top, it.center.z).project(camera);
    const x = (_pin.x * 0.5 + 0.5) * size.w;
    const y = (-_pin.y * 0.5 + 0.5) * size.h;
    const on = _pin.z < 1 && x > -20 && x < size.w + 20 && y > -20 && y < size.h + 20;
    const side = sideRect();
    ui.callout.place({ x, y, on }, { left: (side ? side.right : 0) + 16, top: 84, right: size.w - 16, bottom: size.h - 16 });
  }
  let sideBox = null;
  let sideBoxAt = 0;
  function sideRect() {
    const now = performance.now();
    if (!sideBox || now - sideBoxAt > 500) {
      const s = document.querySelector('.side');
      const r = s?.getBoundingClientRect();
      sideBox = r && r.width && getComputedStyle(s).opacity !== '0' ? r : { right: 0 };
      sideBoxAt = now;
    }
    return sideBox;
  }

  // Render loop; paused while the tab is hidden or the panorama is open,
  // time base reset on return.
  let raf = 0;
  let first = true;
  let last = performance.now();
  let clock = 0; // not `t`: that name is the translation function
  let cityCasts = true;
  function frame() {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const rawDt = Math.max(0, (now - last) / 1000);
    last = now;
    const dt = Math.min(rawDt, 1 / 30);
    clock += dt;
    renderer.info.reset();
    // the intro owns the camera while it plays; then the rig does
    if (!intro?.update(rawDt)) rig.update(dt, now, rawDt);
    // never below the ground, whoever moved the camera (parallax included)
    const floorY = heightAt(camera.position.x, camera.position.z) + 2;
    if (camera.position.y < floorY) camera.position.y = floorY;
    const camDist = intro?.active ? camera.position.distanceTo(home.target) : camera.position.distanceTo(rig.controls.target);
    // near plane follows the orbit distance: 0.5 units (2 m) in a close-up,
    // up to 6 units over the whole city, for depth precision far away
    const near = THREE.MathUtils.clamp(camDist * 0.004, 0.5, 6);
    if (Math.abs(near - camera.near) > camera.near * 0.1) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
    camera.userData.focus = rig.controls.target;
    // building shadows only when they can be seen: from far away they are
    // sub-pixel and cost one draw call per tile in the shadow pass
    const castCity = camDist < 4000;
    if (castCity !== cityCasts) {
      cityCasts = castCity;
      for (const m of city.group.children) m.castShadow = castCity;
    }
    debug.frames = (debug.frames || 0) + 1;
    atmosphere.update(rawDt, camera);
    const night = atmosphere.night;
    BUILDING_UNIFORMS.uNight.value = night;
    roadLayer.setNight(night);
    roadLayer.setWaterLine(camDist > 320);
    roadLayer.setViewDistance(camDist);
    lightInfo.color.copy(atmosphere.sun.color).multiplyScalar(atmosphere.sun.intensity);
    lightInfo.ambient.copy(atmosphere.state.mid).multiplyScalar(0.35 * atmosphere.state.env);
    lightInfo.ambient.add(_amb.copy(atmosphere.hemi.color).multiplyScalar(atmosphere.hemi.intensity * 0.5));
    // nature, tiles, life and seasons are null until deferLayers built them
    nature?.update(reducedMotion ? 0 : dt, camera, lightInfo); // no sway or ripples under reduced motion
    tiles?.update(rawDt);
    ms?.update(rawDt);
    life?.update(dt, camDist); // traffic, birds, funicular, fountains, weather (life.js)
    seasons?.update(rawDt); // season blend, leaves, snow, quality (seasons.js)
    marks.updatePins(clock, !reducedMotion, camera.position);
    pulseHoverPin(rawDt);
    // light mode: the landmarks are the only shadow casters. Several modules
    // turn casting back on by view distance, so this runs every frame.
    if (LITE) {
      if (debug.frames % 60 === 1) liteNoCast = scene.children.filter((c) => LITE_NO_CAST.has(c.name));
      for (const g of liteNoCast) g.traverse(noCast);
      // ... and only those within 1200 units (4.8 km) of the camera
      for (const m of marks.group.children) {
        if (!m.isMesh) continue;
        m.userData.liteCast ??= m.castShadow;
        m.castShadow = m.userData.liteCast && camDist < 4000 && m.position.distanceToSquared(camera.position) < 1200 * 1200;
      }
    }
    if (fx.enabled) {
      fx.update(rawDt, atmosphere.sunDir, night);
      fx.render();
    } else {
      renderer.render(scene, camera);
    }
    labelRenderer.render(scene, camera);
    declutter(now, camDist);
    placeClusters();
    placeCallout();
    fadeLabels(camDist);
    instruments.update(camera, rig.controls.target, size.h);
    debug.calls = renderer.info.render.calls;
    debug.triangles = renderer.info.render.triangles;
    if (first) {
      // the boot view drew the first frame and hid the loader; this is the
      // first full frame (controls live). __porto.ready follows the deferred
      // layers (deferLayers).
      first = false;
      mark('interactive');
      debug.interactive = true;
    }
    if (probe) probeFrame(rawDt);
    else governorTick(rawDt);
    if (debug.frames === 3) logStats();
  }

  // light mode: the scene groups that never cast (all but the landmarks)
  const LITE_NO_CAST = new Set(['buildings', 'buildings-ms', 'tiles', 'nature', 'life', 'roads']);
  let liteNoCast = [];
  const noCast = (o) => {
    o.castShadow = false;
  };

  // Low-end probe (see setFx): measured over 3 s of real frames.
  function probeFrame(rawDt) {
    // only once everything is built: the deferred builds are long tasks
    if (document.hidden || !debug.ready) return;
    if (probe.skip > 0) {
      probe.skip--;
      return;
    }
    probe.n++;
    probe.sum += rawDt;
    if (probe.sum < 3) return;
    const avgMs = (probe.sum / probe.n) * 1000;
    debug.perf = { probeMs: +avgMs.toFixed(1), frames: probe.n };
    if (avgMs > 33) {
      if (fx.enabled) setFx(false, { reason: 'low-end' });
      atmosphere.setShadowSize(LITE ? 1024 : 2048);
      probeLow = true; // a nature layer built later gets the smaller radius too
      nature?.setNearRadius(LITE ? 160 : 220);
      // the next visit starts in light mode (an automatic choice only)
      if (!LITE && TIER.reason === 'default') {
        try {
          localStorage.setItem('porto-tier-probe', 'low');
        } catch {
          // storage may be blocked
        }
      }
      console.info(`[porto] ${avgMs.toFixed(1)} ms per frame: effects off, smaller shadow map${LITE ? '' : '; light mode from the next visit'}`);
    }
    probe = null;
  }

  // Labels fade with distance relative to the view: in a close-up, far
  // landmarks give way; over the whole city every label stays.
  const _lp = new THREE.Vector3();
  function fadeLabels(camDist) {
    const lim = Math.max(camDist * 2.4, 900);
    for (const it of marks.items) {
      const d = camera.position.distanceTo(_lp.copy(it.label.position));
      const f = it.index === active ? 1 : 1 - THREE.MathUtils.smoothstep(d, lim, lim * 1.7);
      if (Math.abs((it._fade ?? -1) - f) > 0.02) {
        it._fade = f;
        it.labelEl.style.setProperty('--fade', f.toFixed(2));
        it.labelEl.classList.toggle('is-far', f < 0.05);
      }
    }
  }

  // Once after load: what the first views cost, and what the scene holds.
  function logStats() {
    let sceneTris = 0;
    let meshes = 0;
    scene.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh) return;
      meshes++;
      const g = o.geometry;
      sceneTris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
    const stats = {
      drawCalls: renderer.info.render.calls,
      frameTriangles: renderer.info.render.triangles,
      sceneTriangles: Math.round(sceneTris),
      meshes,
      tier: TIER.tier,
      landmarksLod: marks.lodStats,
      buildings: city.stats,
      landmarks: marks.report,
      tiles: tiles?.stats ?? debug.tilesStats ?? null,
      ms: ms?.stats ?? debug.msStats ?? null,
      nature: nature?.stats ?? null,
      life: life?.stats ?? null,
      streetscape: life?.stats?.streetscape ?? debug.streetscape?.stats ?? null,
      // the street-life caps and furniture totals (porto-streetscape.js /
      // people.js, reported through streetscape.stats.porto)
      people: life?.stats?.streetscape?.porto?.people ?? null,
      furniture: life?.stats?.streetscape?.porto
        ? Object.values(life.stats.streetscape.porto.furniture || {}).reduce((a, n) => a + n, 0)
        : null,
      vehicles: life?.traffic ? { vehicles: life.traffic.stats.vehicles, visible: life.traffic.visible, lanes: life.traffic.stats.lanes } : null,
      transit: {
        air: life?.air ? { status: life.air.status, total: life.air.total, drawn: life.air.drawn, src: life.air.src } : null,
        buses: life?.buses?.stats ?? null,
      },
      weather: life?.weather?.name ?? null,
      seasons: seasons ? debug.seasons ?? null : null,
      routes: routes.length,
      routeLines: routeLayer.group.children.filter((c) => c.isLine2).length,
      pins: marks.items.length,
      lamps: roadLayer.counts.lamps,
      fx: fx.enabled,
      time: atmosphere.time,
      shadowMap: atmosphere.sun.shadow.mapSize.x,
      metresPerUnit: METRES_PER_UNIT,
      terrain: { source: terrain.source, datumM: +terrain.datum.toFixed(1), pads: terrain.pads.length },
    };
    debug.stats = stats;
    console.info(
      `[porto] stats: ${stats.drawCalls} draw calls, ${stats.frameTriangles} triangles this frame; scene ${stats.sceneTriangles} triangles in ${meshes} meshes; buildings ${city.stats.built} in ${city.stats.tiles} tiles (${city.stats.triangles} tris), skipped ${city.stats.skippedOutline + city.stats.skippedPlan} under landmarks`,
    );
    console.info(
      `[porto] layers: tier ${stats.tier}, routes ${stats.routes} (${stats.routeLines} lines), pins ${stats.pins}, weather ${stats.weather ?? '—'}, people ${stats.people?.max ?? 0}, furniture ${stats.furniture ?? 0}, vehicles ${stats.vehicles?.vehicles ?? 0} (${stats.vehicles?.visible ?? 0} shown), streetscape ${stats.streetscape?.status ?? '—'}, nature ${stats.nature ? 'on' : '—'}, seasons ${stats.seasons?.season ?? '—'}`,
    );
    console.table(marks.report);
  }
  function pauseLoop() {
    paused = true;
    debug.loopPaused = true;
    cancelAnimationFrame(raf);
    raf = 0;
  }
  function resumeLoop() {
    paused = false;
    debug.loopPaused = false;
    if (document.hidden || raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf && !paused) {
      last = performance.now(); // reset the time base after the pause
      raf = requestAnimationFrame(frame);
    }
  });

  // Compass (click: north up) and scale bar.
  const instruments = createInstruments({
    onNorth: () => {
      const tgt = rig.controls.target;
      const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(tgt));
      if (Math.abs(s.theta) < 0.01) return;
      rig.flyTo(tgt.clone().add(new THREE.Vector3().setFromSphericalCoords(s.radius, s.phi, 0)), tgt, 0.9);
    },
  });

  mark('ui');
  setFx(fxWanted);
  // the intro (made with the boot view) hands the camera to the rig
  introDoneHook = () => {
    rig.controls.target.copy(home.target);
    rig.controls.update();
    // the first stats were taken at the intro's first pose: log the overview
    requestAnimationFrame(() => requestAnimationFrame(() => logStats()));
  };

  // Nature, the streamed tiles, the MS ring, life and the seasons: after the
  // full loop runs, when the browser is idle (each one is a long task on a
  // phone, so they wait for the intro to land, 6 s at most). __porto.ready
  // after them, then the counts are re-reported with every layer present.
  async function deferLayers() {
    const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 300 }) : setTimeout(r, 60)));
    const t0 = performance.now();
    while (intro?.active && performance.now() - t0 < 6000) await nextFrame();
    const step = async (name, fn) => {
      await idle();
      try {
        fn();
      } catch (e) {
        console.error(`[porto] ${name} failed`, e);
      }
    };
    const quaysP = loadQuays();
    await step('nature', buildNatureLayer);
    await step('quays', () => {
      quaysP.then((doc) => {
        if (!doc) return;
        const q = buildQuays({ doc, heightAt, S: 1 / METRES_PER_UNIT });
        scene.add(q.group);
        debug.quays = q.stats;
        mark('quays');
      });
    });
    await step('ms', () => {
      ms = createMsBuildings({ scene, camera, terrain, heightAt, proj, footprints, plans: msPlans, osm: city.footprints, mobile: LITE, lite: LITE, debug });
      mark('ms');
    });
    await step('life', () => {
      // footprints, outlines: where the people of streetscape.js may not walk
      life = createLife({ renderer, scene, camera, atmosphere, project, heightAt, roads, items: marks.items, nature, fx, reducedMotion, mobile: LITE, lite: LITE, debug, setHash: () => setHash(currentHash()), footprints: city.footprints, outlines });
    });
    await step('seasons', () => {
      seasons = createSeasons({ renderer, scene, camera, atmosphere, nature, fx, weather: life?.weather, terrain, ui, reducedMotion, mobile: LITE, lite: LITE, debug });
    });
    mark('life');
    await nextFrame();
    mark('ready');
    debug.ready = true;
    // the deferred layers changed what the scene holds: re-report the counts
    // (the first logStats ran before they existed) so logStats always ends
    // with the full picture, including life, streetscape, people and buses.
    requestAnimationFrame(() => requestAnimationFrame(() => logStats()));
  }

  loader.set(0.95, t('Первый кадр'));
  await nextFrame();
  mark('preFrame');
  boot.stop();
  stopBoot = null;
  frame();
  deferLayers();

  applyHash();
  window.addEventListener('hashchange', applyHash);

  Object.assign(debug, { select, close, openRoute, exitRoute, startTour, stopTour, ui, panorama, routes, rig, landmarksRealScale: marks.realScale, shrink: marks.shrink, lodStats: () => marks.lodStats, landmarkDraw: () => marks.drawnStats });
  Object.defineProperty(debug, 'touring', { get: () => !!tour });
  installShare({ renderer, scene, camera, fx, setFx, atmosphere, roadLayer, routeLayer, marks, landmarks, routes, ui, getSize: () => size });
  // the talking guide (guide.js, api/guide.js) is parked until later; ?guide=1 turns it on for testing
  if (new URLSearchParams(location.search).get('guide') === '1') {
    createGuide({ landmarks, select, getActive: () => active, project, rig, reducedMotion, debug });
  }
}

// The city config first (cities/<id>.json), then its model registry, then
// the scene. The static shell is written for Porto; applyCityShell() renames it for other cities.
loadCity()
  .then(async (city) => {
    debug.city = city;
    mark('city');
    applyCityShell();
    await loadCityModels(city.id);
    mark('models');
    return start();
  })
  .catch((err) => {
    console.error('[porto] start failed', err);
    stopBoot?.();
    const msg = t('Не удалось запустить карту. Нужен браузер с поддержкой WebGL.');
    const text = document.getElementById('loader-text');
    const loaderEl = document.getElementById('loader');
    if (text && loaderEl && !loaderEl.classList.contains('is-done')) {
      text.textContent = msg;
      loaderEl.classList.add('is-error');
    } else if (!debug.interactive) {
      // the boot view already removed the loader: say it over the map
      const box = document.createElement('p');
      box.setAttribute('role', 'alert');
      box.textContent = msg;
      box.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:99;max-width:min(90vw,420px);margin:0;padding:14px 18px;border-radius:10px;background:rgba(20,16,12,0.88);color:#e8a35a;font:14px/1.4 system-ui,sans-serif;text-align:center';
      document.body.append(box);
    }
  });
