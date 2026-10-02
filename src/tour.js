// Cinema mode: an auto-guided film through every landmark in CINEMA_ORDER.
//
// One timeline of segments: a flight in from wherever the camera is, then
// for each landmark a 12–18 s shot, joined by flights over the city. The
// camera rig (camera.js drive()) owns the camera; this file is the driver
// that says where the camera should be at time t.
//
// Shot vocabulary, each fitted to the landmark's real bounding box and its
// best viewing bearing:
//   crane  - starts almost overhead, descends and tilts up to the façade
//   orbit  - a slow half-circle at a fixed height
//   dolly  - pushes in along the façade axis, low and steady
//   rise   - starts close and low, lifts and pulls back into the context
//
// Clearance: `createSkyline` keeps a coarse grid of the highest roof per
// 40 m cell. Flights keep at least 60 m (15 units) over terrain and roofs;
// every shot is lifted as a whole when any of its poses would dip below
// the roofs around it, so the camera never cuts through a building.
import * as THREE from 'three';
import { S } from './geo.js';
import { t } from './i18n.js';
import { assetUrl } from './data.js';
import { placesWord } from './ui.js';
import { cityT } from './city.js';

const CELL = 10; // skyline cell, world units (40 m)
export const FLIGHT_CLEARANCE = 60 * S; // 60 m over terrain and roofs
const SHOT_CLEARANCE = 10 * S; // 10 m over roofs during a shot

const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const easeInOut = (x) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(x));
const smooth = (a, b, x) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};

// ------------------------------------------------------------ skyline
// Highest point (terrain or roof) around (x, z). Roofs come from the raw
// OSM building list (lat/lon rings + height in metres); landmark boxes are
// added on top.
export function createSkyline({ buildings, project, heightAt, boxes = [] }) {
  const cells = new Map();
  const key = (i, j) => i * 100003 + j;
  const put = (x0, z0, x1, z1, top) => {
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
        const k = key(i, j);
        if (!(cells.get(k) >= top)) cells.set(k, top);
      }
    }
  };
  const list = Array.isArray(buildings) ? buildings : buildings?.buildings || [];
  for (const b of list) {
    if (!Array.isArray(b?.p) || b.p.length < 3 || !(b.h > 0)) continue;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const q of b.p) {
      const p = project(q[0], q[1]);
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.z < z0) z0 = p.z;
      if (p.z > z1) z1 = p.z;
    }
    const top = Math.max(heightAt(x0, z0), heightAt(x1, z1), heightAt((x0 + x1) / 2, (z0 + z1) / 2)) + b.h * S;
    put(x0, z0, x1, z1, top);
  }
  for (const box of boxes) if (box) put(box.min.x, box.min.z, box.max.x, box.max.z, box.max.y);

  // r: search radius in world units around the point
  function at(x, z, r = 0) {
    let top = heightAt(x, z);
    const n = Math.ceil(r / CELL);
    const ci = Math.floor(x / CELL);
    const cj = Math.floor(z / CELL);
    for (let i = ci - n; i <= ci + n; i++) {
      for (let j = cj - n; j <= cj + n; j++) {
        const v = cells.get(key(i, j));
        if (v > top) top = v;
      }
    }
    return top;
  }
  return { at, size: cells.size };
}

// ------------------------------------------------------------ flights
// A Catmull-Rom flight from pose a to pose b over the city. Two control
// points lift the middle to cruise height; the whole curve is sampled
// every ~10 units and the middle raised until every sample clears the
// skyline by `clear`. The first and last 12 % may be lower: they meet the
// shots, which fly closer.
export function flightCurve(from, to, sky, { clear = FLIGHT_CLEARANCE } = {}) {
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  const m1 = from.clone().lerp(to, 0.3);
  const m2 = from.clone().lerp(to, 0.7);
  // cruise: a gentle arc, higher for longer hops
  let cruise = 0;
  const n = Math.max(8, Math.ceil(d / 10));
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    cruise = Math.max(cruise, sky.at(from.x + (to.x - from.x) * k, from.z + (to.z - from.z) * k, 12));
  }
  cruise += clear + Math.min(d * 0.1, 120);
  m1.y = Math.max(m1.y, cruise);
  m2.y = Math.max(m2.y, cruise);
  let curve = null;
  for (let iter = 0; iter < 10; iter++) {
    curve = new THREE.CatmullRomCurve3([from.clone(), m1, m2, to.clone()], false, 'centripetal');
    const len = curve.getLength();
    const samples = Math.max(24, Math.ceil(len / 10));
    let deficit = 0;
    const p = new THREE.Vector3();
    for (let i = 0; i <= samples; i++) {
      const u = i / samples;
      curve.getPointAt(u, p);
      const edge = u < 0.12 || u > 0.88;
      const need = sky.at(p.x, p.z, 4) + (edge ? SHOT_CLEARANCE : clear);
      if (p.y < need) deficit = Math.max(deficit, need - p.y);
    }
    if (deficit < 0.5) break;
    m1.y += deficit + 2;
    m2.y += deficit + 2;
  }
  return curve;
}

// ------------------------------------------------------------ shots
// Order: the Sé and the Ribeira in the morning, the Clérigos tower and the
// Baixa landmarks by day, out west to Serralves and the Casa da Música, then
// the bridges and the Gaia lodges toward sunset, and the Dragão and the
// Felgueiras lighthouse at night. About 9 minutes in all.
export const CINEMA_ORDER = [
  { id: 'se-porto', shot: 'crane', dur: 14, time: 'morning' },
  { id: 'ribeira', shot: 'dolly', dur: 12, time: 'morning' },
  { id: 'bolsa', shot: 'dolly', dur: 10, time: 'morning' },
  { id: 'sao-francisco-porto', shot: 'dolly', dur: 10, time: 'morning' },
  { id: 'clerigos', shot: 'rise', dur: 13, time: 'morning' },
  { id: 'lello', shot: 'dolly', dur: 9, time: 'morning' },
  { id: 'sao-bento', shot: 'crane', dur: 11, time: 'morning' },
  { id: 'aliados', shot: 'dolly', dur: 11, time: 'morning' },
  { id: 'mercado-bolhao', shot: 'crane', dur: 10, time: 'day' },
  { id: 'carmo', shot: 'dolly', dur: 9, time: 'day' },
  { id: 'uporto-reitoria', shot: 'crane', dur: 10, time: 'day' },
  { id: 'casa-musica', shot: 'orbit', dur: 12, time: 'day' },
  { id: 'serralves', shot: 'orbit', dur: 11, time: 'day' },
  { id: 'palacio-cristal', shot: 'orbit', dur: 11, time: 'day' },
  { id: 'ponte-luis-i', shot: 'crane', dur: 14, time: 'sunset' },
  { id: 'ponte-arrabida', shot: 'rise', dur: 12, time: 'sunset' },
  { id: 'ponte-maria-pia', shot: 'rise', dur: 11, time: 'sunset' },
  { id: 'caves-gaia', shot: 'orbit', dur: 11, time: 'sunset' },
  { id: 'dragao', shot: 'rise', dur: 12, time: 'sunset' },
  // night falls during the last shot, 6 s in
  { id: 'felgueiras', shot: 'rise', dur: 15, time: 'sunset', then: 'night', at: 6 },
];

// Framing numbers for one landmark at its real size. A draped site (Bom
// Jesus) climbs the slope, so its box bottom is the base.
function subjectOf(it, camera, view) {
  const box = it.box;
  const size = box.getSize(new THREE.Vector3());
  const base = it.draped ? box.min.y : it.base;
  const height = Math.max(1, box.max.y - base);
  const look = box.getCenter(new THREE.Vector3());
  look.y = base + height * 0.38;
  const r = Math.max(4, 0.5 * size.length());
  const tanV = Math.tan((camera.fov * Math.PI) / 360);
  // the letterbox leaves view.band of the height; fit the sphere in it
  const dist = Math.min(900, Math.max(22, (r / (tanV * view.band)) * 1.05));
  return { look, dist, height, r, base, box, bearing: it.viewBearing ?? 0 };
}

const _o = new THREE.Vector3();
function orbitPoint(look, dist, az, elev, out) {
  _o.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev)).multiplyScalar(dist);
  return out.copy(look).add(_o);
}

// Returns shot(u, out) -> { pos, look } for u in 0..1, already lifted.
function makeShot(kind, s, sky, minElev = 0) {
  const L = THREE.MathUtils.lerp;
  const b = s.bearing;
  const lookAt = new THREE.Vector3();
  let up = 0; // extra elevation (radians) when roofs would hide the subject
  const el = (x) => Math.min(1.45, Math.max(minElev, x + up));
  const raw = (u, pos, look) => {
    const e = easeInOut(u);
    look.copy(s.look);
    switch (kind) {
      case 'crane':
        look.y = L(s.base + s.height * 0.1, s.look.y, e);
        orbitPoint(look, L(s.dist * 0.8, s.dist * 1.05, e), b + L(0.22, -0.08, e), el(L(1.2, 0.34, e)), pos);
        break;
      case 'orbit':
        orbitPoint(look, s.dist * 1.02, b + L(-0.6, 0.6, u), el(L(0.44, 0.36, e)), pos);
        break;
      case 'dolly':
        orbitPoint(look, L(s.dist * 1.5, s.dist * 0.8, e), b + L(-0.07, 0.07, u), el(L(0.3, 0.22, e)), pos);
        break;
      case 'rise':
      default:
        look.y = L(s.look.y, s.base + s.height * 0.25, e);
        orbitPoint(look, L(s.dist * 0.85, s.dist * 2.3, e), b + L(0.3, -0.12, e), el(L(0.2, 0.7, e)), pos);
        break;
    }
    return pos;
  };
  // Line of sight: count poses whose view of the target crosses a roof
  // (the subject's own box does not count). Raise the whole shot in steps
  // of ~6 degrees until none does.
  const bx = s.box;
  const q = new THREE.Vector3();
  const pp = new THREE.Vector3();
  // tight margin: a neighbour 5 m away can hide a small subject
  const own = (v) => v.x > bx.min.x - 0.5 && v.x < bx.max.x + 0.5 && v.z > bx.min.z - 0.5 && v.z < bx.max.z + 0.5;
  function hidden() {
    let n = 0;
    for (let i = 0; i <= 12; i++) {
      raw(i / 12, pp, lookAt);
      for (let k = 1; k < 24; k++) {
        q.lerpVectors(lookAt, pp, k / 24);
        if (!own(q) && sky.at(q.x, q.z, 0) > q.y + 0.5) {
          n++;
          break;
        }
      }
    }
    return n;
  }
  let best = { up: 0, n: Infinity };
  for (up = 0; up <= 0.9; up += 0.1) {
    const n = hidden();
    if (n < best.n) best = { up, n };
    if (!n) break;
  }
  up = best.up;
  // one lift for the whole shot: the highest shortfall along its path
  let lift = 0;
  const p = new THREE.Vector3();
  for (let i = 0; i <= 32; i++) {
    raw(i / 32, p, lookAt);
    const need = sky.at(p.x, p.z, 6) + SHOT_CLEARANCE;
    lift = Math.max(lift, need - p.y);
  }
  const shot = (u, out) => {
    raw(u, out.pos, out.look);
    out.pos.y += lift;
    return out;
  };
  Object.assign(shot, { up: +up.toFixed(2), lift: +(lift / S).toFixed(1), hidden: best.n });
  return shot;
}

// ------------------------------------------------------------ cinema
// ctx: { camera, rig, items (landmarks.items), heightAt, sky, reducedMotion,
//        setTime(name), getTime(), onEnter(), onExit(), onChange(i) }
export function createCinema(ctx) {
  const { camera, rig, reducedMotion } = ctx;
  const $ = (s) => document.querySelector(s);
  const root = $('#cinema');
  const card = $('#cinema-card');
  const photo = $('#cinema-photo');
  const photoImg = photo.querySelector('img');
  const photoCap = photo.querySelector('figcaption');
  const playBtn = $('#cinema-play');
  const progress = $('#cinema-progress');
  const fill = progress.querySelector('.cinema-fill');
  const counter = $('#cinema-count');
  photoImg.addEventListener('error', () => photo.classList.add('is-missing'));

  let active = false;
  let paused = false;
  let segs = []; // { kind: 'fly'|'shot', t0, dur, shot: index, curve, look0, look1, fn }
  let total = 0;
  let clock = 0;
  let current = -1; // chapter shown
  let cutNext = false;
  let savedTime = null;
  const pose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), cut: false };
  const tmp = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const byId = new Map(ctx.items.map((it) => [it.data.id, it]));
  const order = CINEMA_ORDER.filter((o) => byId.has(o.id));
  const dropped = CINEMA_ORDER.filter((o) => !byId.has(o.id)).map((o) => o.id);
  // (another city has none of Braga's ids: its film order is a later step)
  if (dropped.length && ctx.items.length) console.warn('[porto] cinema: no landmark for', dropped.join(', '));
  const missing = ctx.items.filter((it) => !CINEMA_ORDER.some((o) => o.id === it.data.id)).map((it) => it.data.id);
  if (missing.length) console.warn('[porto] cinema: not in CINEMA_ORDER:', missing.join(', '));
  // the button title counts the places the film really shows
  const toggle = document.getElementById('cinema-toggle');
  if (toggle) toggle.title = cityT('Фильм о {city_prep}: {n} с утра до ночи').replace('{n}', `${order.length} ${placesWord(order.length)}`);

  function viewBand() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    return { band: THREE.MathUtils.clamp(W / 2.35 / H, 0.45, 1) };
  }

  // Build the timeline from the current camera pose.
  function build() {
    const view = viewBand();
    segs = [];
    let tt = 0;
    const shots = order.map((o) => {
      const it = byId.get(o.id);
      const s = subjectOf(it, camera, view);
      return { o, it, fn: makeShot(o.shot, s, ctx.sky, o.minElev) };
    });
    const start = { pos: camera.position.clone(), look: rig.controls.target.clone() };
    let prev = start;
    shots.forEach((sh, i) => {
      const first = sh.fn(0, { pos: new THREE.Vector3(), look: new THREE.Vector3() });
      if (!reducedMotion) {
        const d = prev.pos.distanceTo(first.pos);
        const dur = THREE.MathUtils.clamp(2.5 + d / 220, i === 0 ? 3.5 : 4, 9);
        const curve = flightCurve(prev.pos, first.pos, ctx.sky);
        segs.push({ kind: 'fly', t0: tt, dur, shot: i, curve, look0: prev.look.clone(), look1: first.look.clone() });
        tt += dur;
      }
      const dur = reducedMotion ? 8 : sh.o.dur;
      segs.push({ kind: 'shot', t0: tt, dur, shot: i, fn: sh.fn });
      tt += dur;
      prev = sh.fn(1, { pos: new THREE.Vector3(), look: new THREE.Vector3() });
    });
    total = tt;
    shotsMeta = shots;
    renderTicks();
  }
  let shotsMeta = [];

  function segAt(time) {
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].t0 <= time) lo = mid;
      else hi = mid - 1;
    }
    return segs[lo];
  }

  function evaluate() {
    const s = segAt(clock);
    const u = clamp01((clock - s.t0) / s.dur);
    if (s.kind === 'fly') {
      const e = easeInOut(u);
      s.curve.getPointAt(e, pose.pos);
      // turn toward the next subject early, settle before arrival
      pose.look.lerpVectors(s.look0, s.look1, smooth(0.05, 0.75, u));
    } else if (reducedMotion) {
      s.fn(0.55, tmp);
      pose.pos.copy(tmp.pos);
      pose.look.copy(tmp.look);
    } else {
      s.fn(u, tmp);
      pose.pos.copy(tmp.pos);
      pose.look.copy(tmp.look);
    }
    return s;
  }

  // ------------------------------------------------ overlay
  function renderTicks() {
    progress.querySelectorAll('.cinema-tick').forEach((n) => n.remove());
    for (const s of segs) {
      if (s.kind !== 'shot') continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cinema-tick';
      b.style.left = `${(s.t0 / total) * 100}%`;
      const name = shotsMeta[s.shot].it.data.name;
      b.setAttribute('aria-label', `${s.shot + 1}. ${name}`);
      b.title = name;
      b.addEventListener('click', () => seekChapter(s.shot));
      progress.append(b);
    }
  }

  function fillCard(i) {
    const l = shotsMeta[i].it.data;
    card.querySelector('.cinema-num').textContent = `${String(i + 1).padStart(2, '0')} / ${String(shotsMeta.length).padStart(2, '0')}`;
    card.querySelector('.cinema-title').textContent = l.name;
    const pt = l.name_pt && l.name_pt !== l.name ? l.name_pt : '';
    card.querySelector('.cinema-pt').textContent = pt;
    card.querySelector('.cinema-pt').hidden = !pt;
    card.querySelector('.cinema-year').textContent = l.year || '';
    card.querySelector('.cinema-short').textContent = l.short || '';
    counter.textContent = `${i + 1} / ${shotsMeta.length}`;
    photo.classList.remove('is-missing');
    if (l.image) {
      photoImg.src = assetUrl(l.image);
      photoImg.alt = l.name;
    } else {
      photo.classList.add('is-missing');
    }
    const c = l.image_credit;
    photoCap.textContent = c && (c.author || c.license) ? `${t('Фото')}: ${[c.author, c.license].filter(Boolean).join(', ')}` : '';
    // preload the next photo while this shot plays
    const next = shotsMeta[i + 1]?.it.data.image;
    if (next) new Image().src = assetUrl(next);
  }

  // card: in 0.8 s after the shot starts, out 1.2 s before it ends;
  // photo: 5 s from 3 s into the shot, with a slow zoom and drift
  function updateOverlay(s) {
    const i = s.shot;
    if (i !== current) {
      current = i;
      fillCard(i);
      progress.querySelectorAll('.cinema-tick').forEach((b, k) => b.setAttribute('aria-current', k === i ? 'step' : 'false'));
      ctx.onChange?.(i, shotsMeta[i].it);
    }
    const local = s.kind === 'shot' ? clock - s.t0 : -1;
    const cardOn = s.kind === 'shot' && local > (reducedMotion ? 0 : 0.8) && local < s.dur - 1.2;
    card.classList.toggle('is-on', cardOn);
    // the fade follows the film clock, so pause and seek hold it exactly
    const has = s.kind === 'shot' && !photo.classList.contains('is-missing');
    const pa = has ? (reducedMotion ? (local >= 3 && local < 8 ? 1 : 0) : smooth(3, 3.9, local) * (1 - smooth(7.1, 8, local))) : 0;
    const pOn = pa > 0.001;
    photo.classList.toggle('is-on', pOn);
    photo.style.opacity = pa.toFixed(3);
    photo.style.transform = `translateY(${((1 - pa) * -10).toFixed(1)}px)`;
    if (pOn && !reducedMotion) {
      const k = clamp01((local - 3) / 5);
      // Ken Burns: 1.0 -> 1.14 zoom, a slow drift that alternates per shot
      const dir = i % 2 ? -1 : 1;
      photoImg.style.transform = `scale(${(1.02 + 0.12 * k).toFixed(4)}) translate(${(dir * (k - 0.5) * 3).toFixed(2)}%, ${((0.5 - k) * 2).toFixed(2)}%)`;
    }
    fill.style.transform = `scaleX(${(clock / total).toFixed(5)})`;
  }

  // ------------------------------------------------ driver for the rig
  const driver = {
    introDur: 0,
    floor: 3,
    damp: 0.32,
    snap: false,
    done: false,
    advance(dt) {
      if (!active) return;
      if (!paused) clock = Math.min(total, clock + dt);
      const s = evaluate();
      const prevShot = current;
      updateOverlay(s);
      // time of day: when a flight toward a new chapter begins
      const o = order[s.shot];
      const want = o.then && s.kind === 'shot' && clock - s.t0 >= o.at ? o.then : o.time;
      if (want && ctx.getTime() !== want) ctx.setTime(want);
      pose.cut = cutNext || (reducedMotion && s.shot !== prevShot);
      cutNext = false;
      if (clock >= total) finish();
    },
    pose() {
      return pose;
    },
  };

  function seekChapter(i) {
    const s = segs.find((g) => g.kind === 'shot' && g.shot === i);
    if (!s) return;
    // land a moment before the shot so the card slides in
    const fly = segs.find((g) => g.kind === 'fly' && g.shot === i);
    clock = fly ? fly.t0 + fly.dur * 0.6 : s.t0;
    cutNext = true;
  }

  function setPaused(on) {
    paused = on;
    root.classList.toggle('is-paused', on);
    playBtn.setAttribute('aria-pressed', String(on));
    playBtn.setAttribute('aria-label', on ? t('Продолжить') : t('Пауза'));
    playBtn.title = `${on ? t('Продолжить') : t('Пауза')} (Space)`;
  }

  function start() {
    if (active) return;
    ctx.onEnter?.();
    active = true;
    paused = false;
    current = -1;
    clock = 0;
    savedTime = ctx.getTime();
    build();
    setPaused(false);
    driver.done = false;
    root.hidden = false;
    document.body.classList.add('is-cinema');
    requestAnimationFrame(() => root.classList.add('is-open'));
    evaluate();
    pose.cut = false;
    rig.drive(driver);
    playBtn.focus({ preventScroll: true });
  }

  function finish() {
    if (!active) return;
    active = false;
    driver.done = true; // the rig lets go on its next update
    teardown();
  }

  // user exit (Esc, button, a click on the map)
  function stop() {
    if (!active) return;
    active = false;
    rig.stopDrive();
    teardown();
  }

  function teardown() {
    root.classList.remove('is-open');
    card.classList.remove('is-on');
    photo.classList.remove('is-on');
    photo.style.opacity = '0';
    document.body.classList.remove('is-cinema');
    setTimeout(() => {
      if (!active) root.hidden = true;
    }, 400);
    if (savedTime) ctx.setTime(savedTime);
    ctx.onExit?.();
  }

  playBtn.addEventListener('click', () => setPaused(!paused));
  $('#cinema-skip').addEventListener('click', () => skip());
  $('#cinema-prev').addEventListener('click', () => skip(-1));
  $('#cinema-exit').addEventListener('click', () => stop());
  progress.addEventListener('click', (e) => {
    if (e.target.closest('.cinema-tick')) return;
    const r = progress.getBoundingClientRect();
    const target = ((e.clientX - r.left) / r.width) * total;
    const s = segAt(target);
    seekChapter(s.shot);
  });

  function skip(d = 1) {
    const s = segAt(clock);
    let i = s.shot + d;
    // "back" during the first seconds of a shot goes to the one before
    if (d < 0 && s.kind === 'shot' && clock - s.t0 > 3) i = s.shot;
    if (i >= shotsMeta.length) return finish();
    seekChapter(Math.max(0, i));
  }

  // keys while playing: Space pause, arrows skip, Esc exit. true = handled
  function onKey(e) {
    if (!active) return false;
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      setPaused(!paused);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      skip(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      skip(-1);
    } else if (e.key === 'Escape') {
      stop();
    } else return false;
    return true;
  }

  return {
    start,
    stop,
    onKey,
    get active() {
      return active;
    },
    get paused() {
      return paused;
    },
    setPaused,
    // tests and screenshots: jump to chapter i at t seconds into its shot
    // (negative t: into the flight before it), and hold there
    seek(i, tSec = 4, { hold = true } = {}) {
      const s = segs.find((g) => g.kind === 'shot' && g.shot === i);
      if (!s) return null;
      const fly = segs.find((g) => g.kind === 'fly' && g.shot === i);
      clock = tSec >= 0 || !fly ? s.t0 + tSec : fly.t0 + fly.dur + tSec;
      cutNext = true;
      if (hold) setPaused(true);
      return { clock, total };
    },
    // tests: walk the whole timeline every 0.2 s; the lowest clearance over
    // roofs and terrain, in metres, for flights and for shots
    audit() {
      if (!segs.length) build();
      const keep = clock;
      // cruise: the middle 76 % of each flight path, where 60 m is the rule
      const worst = { fly: { m: Infinity }, cruise: { m: Infinity }, shot: { m: Infinity } };
      for (clock = 0; clock <= total; clock += 0.2) {
        const s = evaluate();
        const m = (pose.pos.y - ctx.sky.at(pose.pos.x, pose.pos.z, 2)) / S;
        const e = easeInOut((clock - s.t0) / s.dur); // arc-length share of the flight
        const w = worst[s.kind === 'fly' && e > 0.12 && e < 0.88 ? 'cruise' : s.kind];
        if (m < w.m) Object.assign(w, { m: +m.toFixed(1), chapter: s.shot, id: order[s.shot].id, t: +(clock - s.t0).toFixed(1) });
      }
      clock = keep;
      // per shot: extra elevation for line of sight, lift over roofs (m),
      // poses still hidden after the search
      worst.shots = shotsMeta.map((m) => `${m.o.id}: +${m.fn.up} rad, lift ${m.fn.lift} m, hidden ${m.fn.hidden}`);
      return worst;
    },
    get state() {
      const s = active ? segAt(clock) : null;
      return { active, paused, clock: +clock.toFixed(2), total: +total.toFixed(1), chapter: s?.shot ?? -1, kind: s?.kind ?? null, order: order.map((o) => `${o.id}:${o.shot}`) };
    },
  };
}
