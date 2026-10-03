// Story mode: two thousand years of Braga, told over the live 3D map.
//
// A full-height overlay scrolls natively. One conductor turns the scroll
// position into a continuous station index: station 0 is the overview
// under the title, stations 1..N are the chapters of data/story.json. Each
// chapter holds its view while its text is centred (with a slow drift, so
// the scene stays alive under the scrub) and flies to the next one between
// texts, along a Catmull-Rom flight that keeps 60 m over roofs and terrain
// (tour.js flightCurve). Scrolling back plays the same path backwards.
//
// Desktop: text column on the left, the subject framed in the free part
// on the right. Mobile (<= 900 px): the chapters become full-width cards
// in a horizontal scroll-snap strip at the bottom; the map fills the top.
// Reduced motion: the camera cuts to the nearest chapter, no flights.
import * as THREE from 'three';
import { t, language } from './i18n.js';
import { flightCurve, easeInOut } from './tour.js';
import { S } from './geo.js';
import { CITY, cityName } from './city.js';

const HOLD = 0.3; // share of the gap between two texts spent holding each view
const SHOT_CLEAR = 10 * S;

// Per-chapter framing, relative to the first focus landmark's best bearing.
// az: radians added to the bearing; elev: radians above the horizon;
// k: distance multiplier on the fitted distance. primary: frame only the
// first focus landmark (the others are too far away to share a close view).
// frame: frame only the first n focus landmarks. The rest of the focus
// list only keeps its map labels on during the chapter.
const VIEWS = {
  bracara: { az: 0.2, elev: 0.5, k: 1.3, primary: true },
  gallaecia: { az: -0.5, elev: 0.5, k: 1.2 },
  suebi: { az: 0.9, elev: 0.62, k: 2.4, primary: true },
  cathedral: { az: 0, elev: 0.34, k: 1.05, primary: true },
  walls: { az: -0.25, elev: 0.5, k: 1.1 },
  baroque: { az: 0.2, elev: 0.3, k: 0.8, primary: true },
  avenue: { az: 0.15, elev: 0.45, k: 0.85 },
  sameiro: { az: -0.2, elev: 0.28, k: 1.25, primary: true },
  stadium: { az: 0.25, elev: 0.42, k: 1.1 },
  unesco: { az: -0.35, elev: 0.3, k: 0.9, frame: 2 },
  // Porto chapters (data/story.json). Same id keys as the chapters.
  'portus-cale': { az: 0.3, elev: 0.45, k: 1.6, frame: 2 },
  'porto-suebi': { az: 0, elev: 0.35, k: 1.1, primary: true },
  episcopal: { az: -0.2, elev: 0.4, k: 1.15, primary: true },
  condado: { az: 0.15, elev: 0.38, k: 1.2, primary: true },
  ceuta: { az: -0.3, elev: 0.4, k: 1.5, frame: 2 },
  'ribeira-miragaia': { az: 0.25, elev: 0.35, k: 1.5, frame: 2 },
  vinho: { az: 0.2, elev: 0.5, k: 1.8, frame: 2 },
  gaia: { az: -0.15, elev: 0.32, k: 1.7, frame: 3 },
  cerco: { az: -0.1, elev: 0.42, k: 1.3, frame: 2 },
  oitocentista: { az: 0.1, elev: 0.4, k: 1.9, frame: 2 },
  campanha: { az: 0.3, elev: 0.35, k: 1.8, frame: 2 },
  pontes: { az: 0.4, elev: 0.55, k: 2.6, frame: 3 },
  republica: { az: -0.4, elev: 0.4, k: 1.9, frame: 2 },
  'porto-unesco': { az: -0.25, elev: 0.3, k: 0.95, frame: 2 },
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const pick = (o, key) => o?.[`${key}_${language}`] || o?.[`${key}_ru`] || '';

// ctx: { camera, rig, items, sky, home: {position, target}, reducedMotion,
//        load(): Promise<story json>, setTime(name), getTime(), onEnter(), onExit() }
export function createStory(ctx) {
  const { camera, rig, reducedMotion } = ctx;
  const root = document.getElementById('story');
  const scroller = root.querySelector('.story-scroll');
  const track = root.querySelector('.story-track');
  const dots = root.querySelector('.story-dots');
  const closeBtn = root.querySelector('.story-close');
  const byId = new Map(ctx.items.map((it) => [it.data.id, it]));
  // «История» is also the detail tab ("History"); the mode is "Story"
  const label = document.querySelector('#story-toggle .mode-label');
  if (label && language !== 'ru') label.textContent = t('История (режим)');

  let data = null;
  let active = false;
  let stations = []; // { enter: {pos, look}, leave: {pos, look}, time }
  let flights = []; // flights[i]: station i -> i + 1
  let sections = [];
  let dotButtons = [];
  let savedTime = null;
  let shown = -1;
  let f = 0; // continuous station index from the scroll position
  const pose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), cut: false };
  const mq = window.matchMedia('(max-width: 900px)');
  const mobile = () => mq.matches;

  // ------------------------------------------------ DOM
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  function render() {
    track.replaceChildren();
    dots.replaceChildren();
    const intro = el('section', 'story-ch story-intro');
    intro.append(
      el('p', 'story-era', pick(data, 'kicker') || (CITY.id === 'porto' ? t('Portus Cale — Порту') : cityName())),
      el('h2', 'story-title story-title-main', pick(data, 'title')),
      el('p', 'story-text', pick(data, 'subtitle')),
      el('p', 'story-hint', mobile() ? t('Листайте карточки вбок') : t('Прокрутите вниз, чтобы начать')),
    );
    track.append(intro);
    sections = [intro];
    data.chapters.forEach((c, i) => {
      const s = el('section', 'story-ch');
      s.id = `story-${c.id}`;
      s.setAttribute('aria-labelledby', `story-h-${c.id}`);
      const card = el('div', 'story-card');
      const era = el('p', 'story-era');
      era.append(el('span', 'story-num', String(i + 1).padStart(2, '0')), document.createTextNode(pick(c, 'era')));
      const h = el('h3', 'story-title', pick(c, 'title'));
      h.id = `story-h-${c.id}`;
      card.append(era, h, el('p', 'story-text', pick(c, 'text')));
      if (c.sources?.length) {
        const src = el('p', 'story-sources');
        src.append(el('span', '', `${t('Источники')}: `));
        c.sources.forEach((q, k) => {
          const a = el('a', '', q.title);
          Object.assign(a, { href: q.url, target: '_blank', rel: 'noopener noreferrer' });
          if (k) src.append(document.createTextNode(' · '));
          src.append(a);
        });
        card.append(src);
      }
      s.append(card);
      track.append(s);
      sections.push(s);
    });
    const outro = el('section', 'story-ch story-outro');
    const back = el('button', 'action story-back', t('Вернуться к карте'));
    back.type = 'button';
    back.addEventListener('click', () => stop());
    outro.append(back);
    track.append(outro);

    ['', ...data.chapters.map((c) => pick(c, 'title'))].forEach((label, i) => {
      const b = el('button', 'story-dot');
      b.type = 'button';
      b.setAttribute('aria-label', i ? `${i}. ${label}` : pick(data, 'title'));
      b.title = i ? label : pick(data, 'title');
      b.addEventListener('click', () => goTo(i));
      dots.append(b);
      dotButtons.push(b);
    });
  }

  // ------------------------------------------------ camera stations
  function frameStation(c) {
    const all = (c.focus || []).map((id) => byId.get(id)).filter(Boolean);
    if (!all.length) return null;
    const v = VIEWS[c.id] || { az: 0, elev: 0.45, k: 1 };
    const focus = all.slice(0, v.frame ?? (v.primary ? 1 : all.length));
    const box = new THREE.Box3();
    for (const it of focus) box.union(it.box);
    const size = box.getSize(new THREE.Vector3());
    const look = box.getCenter(new THREE.Vector3());
    const base = Math.min(...focus.map((it) => it.base));
    look.y = base + Math.min(size.y, 60) * 0.3;
    const r = Math.max(8, 0.5 * Math.hypot(size.x, size.z, Math.min(size.y, 80)));
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const W = window.innerWidth;
    const H = window.innerHeight;
    const aspect = W / H;
    // free part of the screen: right of the text column, or above the cards
    const view = mobile() ? { l: 0, r: 1, t: 0.06, b: 0.46 } : { l: Math.min(0.46, 600 / W), r: 1 - 90 / W, t: 0.05, b: 1 }; // clear of the dots
    const fw = view.r - view.l;
    const fh = view.b - view.t;
    const dist = THREE.MathUtils.clamp(Math.max(r / (tanV * fh), r / (tanV * aspect * fw)) * v.k, 30, 2600);
    const az = (focus[0].viewBearing ?? 0) + v.az;
    let up = 0; // raised until no roof hides the focus (see below)
    const mk = (dAz, dk) => {
      // phones: steeper, so the upper half shows the city, not the sky
      const e = Math.min(1.4, v.elev + up + (mobile() ? 0.22 : 0));
      const dir = new THREE.Vector3(Math.sin(az + dAz) * Math.cos(e), Math.sin(e), Math.cos(az + dAz) * Math.cos(e));
      const d = dist * dk;
      const tgt = look.clone();
      const right = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
      const fwd = new THREE.Vector3(-dir.x, 0, -dir.z).normalize();
      const offX = (view.l + view.r) / 2 - 0.5;
      const offY = (view.t + view.b) / 2 - 0.5;
      tgt.addScaledVector(right, -offX * 2 * d * tanV * aspect);
      tgt.addScaledVector(fwd, (offY * 2 * d * tanV) / Math.max(0.3, Math.sin(e)));
      const pos = tgt.clone().addScaledVector(dir, d);
      pos.y = Math.max(pos.y, ctx.sky.at(pos.x, pos.z, 6) + SHOT_CLEAR);
      return { pos, look: tgt };
    };
    // line of sight from each pose to each focus centre, ignoring the
    // focus boxes themselves
    const q = new THREE.Vector3();
    const inFocus = (p) => focus.some((it) => p.x > it.box.min.x - 0.5 && p.x < it.box.max.x + 0.5 && p.z > it.box.min.z - 0.5 && p.z < it.box.max.z + 0.5);
    // only the main subject must be in clear view
    const blocked = (pose) =>
      focus.slice(0, 1).some((it) => {
        for (let k = 1; k < 32; k++) {
          q.lerpVectors(it.center, pose.pos, k / 32);
          if (!inFocus(q) && ctx.sky.at(q.x, q.z, 0) > q.y + 0.5) return true;
        }
        return false;
      });
    let enter;
    let leave;
    for (up = 0; up <= 0.8; up += 0.08) {
      enter = mk(-0.07, 1.05);
      leave = mk(0.07, 0.95);
      if (!blocked(enter) && !blocked(leave)) break;
    }
    return { enter, leave, time: c.time, up: +up.toFixed(2), ids: all.map((it) => it.data.id) };
  }

  function buildStations() {
    const first = data.chapters[0];
    const home = { pos: ctx.home.position.clone(), look: ctx.home.target.clone() };
    // the title sits on the map as the visitor left it, in their own light
    const prologue = { enter: home, leave: home, time: savedTime || first?.time, ids: [] };
    stations = [prologue];
    for (const c of data.chapters) {
      const st = frameStation(c);
      stations.push(st || stations[stations.length - 1]);
    }
    flights = [];
    for (let i = 0; i < stations.length - 1; i++) {
      const a = stations[i].leave;
      const b = stations[i + 1].enter;
      flights.push({ curve: flightCurve(a.pos, b.pos, ctx.sky), look0: a.look, look1: b.look });
    }
  }

  // Station index -> pose. Integer part: station; the fraction is split
  // into hold (leave half), flight, hold (enter half of the next).
  function poseAt(x) {
    const n = stations.length;
    x = THREE.MathUtils.clamp(x, 0, n - 1);
    if (reducedMotion) {
      const s = stations[Math.round(x)];
      pose.pos.lerpVectors(s.enter.pos, s.leave.pos, 0.5);
      pose.look.lerpVectors(s.enter.look, s.leave.look, 0.5);
      return;
    }
    const i = Math.min(Math.floor(x), n - 2);
    const v = x - i;
    if (i < 0 || n < 2) return;
    if (v <= HOLD) {
      const s = stations[i];
      const k = 0.5 + 0.5 * (v / HOLD);
      pose.pos.lerpVectors(s.enter.pos, s.leave.pos, k);
      pose.look.lerpVectors(s.enter.look, s.leave.look, k);
    } else if (v >= 1 - HOLD) {
      const s = stations[i + 1];
      const k = 0.5 * ((v - (1 - HOLD)) / HOLD);
      pose.pos.lerpVectors(s.enter.pos, s.leave.pos, k);
      pose.look.lerpVectors(s.enter.look, s.leave.look, k);
    } else {
      const u = (v - HOLD) / (1 - 2 * HOLD);
      const fl = flights[i];
      fl.curve.getPointAt(easeInOut(u), pose.pos);
      pose.look.lerpVectors(fl.look0, fl.look1, easeInOut(clamp01((u - 0.05) / 0.8)));
    }
  }
  // the first station's hold starts at 0.5, so the title sits on the overview
  // and the text of chapter i is centred exactly on station i

  // ------------------------------------------------ scroll conductor
  function readScroll() {
    if (mobile()) {
      const w = track.clientWidth || 1;
      return track.scrollLeft / w;
    }
    // anchor i: section i centred in the viewport
    const H = scroller.clientHeight;
    const st = scroller.scrollTop;
    const anchors = sections.map((s) => s.offsetTop + s.offsetHeight / 2 - H / 2);
    if (st <= anchors[0]) return 0;
    for (let i = 0; i < anchors.length - 1; i++) {
      if (st < anchors[i + 1]) return i + (st - anchors[i]) / Math.max(1, anchors[i + 1] - anchors[i]);
    }
    return anchors.length - 1;
  }

  function onScroll() {
    if (!active) return;
    // the outro (last section) keeps the last chapter's view
    f = Math.min(readScroll(), stations.length - 1);
    poseAt(f);
    const idx = Math.round(f);
    if (idx !== shown) {
      shown = idx;
      sections.forEach((s, i) => s.classList.toggle('is-in', i === idx));
      dotButtons.forEach((b, i) => b.setAttribute('aria-current', i === idx ? 'true' : 'false'));
      const want = stations[Math.min(idx, stations.length - 1)]?.time;
      if (want && ctx.getTime() !== want) ctx.setTime(want);
      // labels: only the chapter's own places are named on the map
      ctx.onFocus?.(stations[Math.min(idx, stations.length - 1)]?.ids || []);
      if (reducedMotion) pose.cut = true;
    }
  }

  function goTo(i, { smooth = !reducedMotion } = {}) {
    const s = sections[i];
    if (!s) return;
    const behavior = smooth ? 'smooth' : 'auto';
    if (mobile()) track.scrollTo({ left: i * track.clientWidth, behavior });
    else scroller.scrollTo({ top: s.offsetTop + s.offsetHeight / 2 - scroller.clientHeight / 2, behavior });
  }

  const driver = {
    floor: 3,
    damp: 0.3,
    introDur: 0,
    snap: !!reducedMotion,
    done: false,
    advance() {},
    pose() {
      const out = { pos: pose.pos, look: pose.look, cut: pose.cut };
      pose.cut = false;
      return out;
    },
  };

  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      onScroll();
    });
  };
  scroller.addEventListener('scroll', schedule, { passive: true });
  track.addEventListener('scroll', schedule, { passive: true });
  closeBtn.addEventListener('click', () => stop());
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    if (!active) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      buildStations();
      onScroll();
    }, 150);
  });

  async function start() {
    if (active) return;
    if (!data) {
      try {
        data = await ctx.load();
      } catch (err) {
        console.error('[porto] story.json failed to load', err);
        ctx.onError?.(err);
        return;
      }
      if (!Array.isArray(data?.chapters) || !data.chapters.length) {
        console.error('[porto] story.json has no chapters');
        ctx.onError?.(new Error('no chapters'));
        return;
      }
      render();
    }
    ctx.onEnter?.();
    active = true;
    savedTime = ctx.getTime();
    shown = -1;
    root.hidden = false;
    document.body.classList.add('is-story');
    scroller.scrollTop = 0;
    track.scrollLeft = 0;
    buildStations();
    requestAnimationFrame(() => root.classList.add('is-open'));
    onScroll();
    // ease in from wherever the camera is (the rig blends to the first pose)
    driver.introDur = reducedMotion ? 0 : 1.8;
    rig.drive(driver);
    root.focus({ preventScroll: true });
  }

  function stop() {
    if (!active) return;
    active = false;
    rig.stopDrive();
    root.classList.remove('is-open');
    document.body.classList.remove('is-story');
    setTimeout(() => {
      if (!active) root.hidden = true;
    }, 450);
    if (savedTime) ctx.setTime(savedTime);
    ctx.onExit?.();
  }

  function onKey(e) {
    if (!active) return false;
    if (e.key === 'Escape') {
      stop();
      return true;
    }
    // the overlay has focus, not its scroller: page keys step by chapter
    const onControl = e.target instanceof Element && e.target.closest('a, button');
    const space = e.key === ' ' && !onControl;
    const next = ['ArrowRight', 'ArrowDown', 'PageDown'].includes(e.key) || (space && !e.shiftKey);
    const prev = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key) || (space && e.shiftKey);
    const last = sections.length - 1;
    let to = null;
    if (next || prev) to = Math.round(readScroll()) + (next ? 1 : -1); // readScroll counts the outro too
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = last;
    if (to == null) return false;
    e.preventDefault();
    goTo(THREE.MathUtils.clamp(to, 0, last));
    return true;
  }

  return {
    start,
    stop,
    onKey,
    goTo,
    get active() {
      return active;
    },
    get state() {
      return { active, f: +f.toFixed(3), chapter: shown, stations: stations.length, time: ctx.getTime() };
    },
    // tests and screenshots: put chapter i (0 = title) in the centre and
    // jump the camera there without the damping
    seek(i) {
      goTo(i, { smooth: false });
      onScroll();
      pose.cut = true;
      return this.state;
    },
  };
}
