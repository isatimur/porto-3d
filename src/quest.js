// History routes («Discover historic Porto», #quest, #quest=<route id>): a
// small engine for several guided routes. #quest opens the chooser (or the
// only route, or the one in progress); each route shows its landmarks one at
// a time. The camera flies to each one (tour.js flightCurve, over roofs and
// terrain); the card tells its history in a few sentences, shows the photo
// with its credit and asks one question with three options. A wrong pick is
// set aside and the visitor picks again; right first time earns a gold
// stamp, right after a retry a plain one. The end counts the places and the
// first-time answers and says how to see each place in the real city.
//
// Content: data/quest.json, loaded with the module. Its history, answer
// and visit lines are verbatim excerpts of the place cards (checked by
// scripts/quest.test.mjs); its `ui` table holds this mode's interface
// strings in ru/en/pt, so the first load carries none of them. Progress is
// saved per route id (quest-progress.js).
//
// While a stop is shown the visitor may orbit the map freely; «Show the
// place» flies back to the framing. Reduced motion: every flight is a cut.
// Esc (main.js key dispatcher -> onKey) leaves the mode. The scene shows
// clear daylight while the route runs; the visitor's light comes back on
// exit (see «light» below).
//
// Ported from braga-3d (main 1048925). Porto differences: the storage key
// (quest-progress.js), the map chrome list below (the fly keys and the
// back-to-globe link), and source links named by their site (Porto's source
// titles are the bare URLs).
import * as THREE from 'three';
import { language } from './i18n.js';
import { flightCurve, easeInOut } from './tour.js';
import { S } from './geo.js';
import { assetUrl } from './data.js';
import { dataPath } from './city.js';
import { creditNode } from './gallery.js';
import { createQuestProgress, questSummary, stopResult } from './quest-progress.js';
import { emit } from './events.js';
import './quest.css';

const SHOT_CLEAR = 10 * S; // 10 m over the roofs around the camera
const OVERVIEW = { az: 0, elev: 0.78, k: 1.05 }; // intro and end: every stop in view
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const pick = (o) => (o && typeof o === 'object' ? o[language] ?? o.ru : o) ?? '';

// <data_dir>/quest.json, fetched when the route first opens
async function loadQuest() {
  const res = await fetch(assetUrl(dataPath('quest.json')), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!(res.headers.get('content-type') || '').includes('json')) throw new Error('not JSON');
  return res.json();
}

// ctx: { camera, rig, items, sky, home: {position, target}, reducedMotion,
//        city, atmosphere, getLife(), setTime(name), onFocus(ids), onEnter(),
//        onExit(), onRoute(), onPlace(index), onError(err) }
export function createQuest(ctx) {
  const { camera, rig, reducedMotion } = ctx;
  const byId = new Map(ctx.items.map((it) => [it.data.id, it]));
  let progress = null; // made once the data is in (the old save needs its answers)
  let rp = null; // progress.route(<the open route>)
  // the map chrome quest.css hides; inert while the route runs, so Tab and
  // screen readers do not land in it
  const CHROME = '.side, .detail, .topbar, .brand, .instruments, .hint, .clusters, .callout, .callout-leader, .atmo, .guide-fab, .guide, .fly-keys, .back-globe, #labels';
  let inerted = [];
  const mq = window.matchMedia('(max-width: 900px)');
  const mobile = () => mq.matches;

  let data = null;
  let routes = []; // { ...json route, stops: [{ ...json stop, item }] } on this map
  let route = null; // the open route; null on the chooser
  let stops = []; // route.stops
  let active = false;
  let screen = 'intro'; // routes | intro | stop | end
  let current = -1; // stop index on the stop screen
  let shot = null; // the framing of the current screen
  let flying = false;

  // ------------------------------------------------ strings
  function s(key, vars = {}) {
    const raw = pick(data?.ui?.[key]) || key;
    return raw.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }

  // ------------------------------------------------ DOM
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const button = (cls, text, onClick) => {
    const b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };

  const root = el('section', 'quest');
  root.id = 'quest';
  root.hidden = true;
  root.tabIndex = -1;
  const card = el('div', 'quest-card');
  const head = el('div', 'quest-head');
  const kicker = el('p', 'quest-kicker');
  const stampList = el('ol', 'quest-stamps');
  const closeBtn = button('quest-close', '×', () => stop());
  head.append(kicker, stampList, closeBtn);
  const body = el('div', 'quest-body');
  // the screen's buttons stay in view below the scrolling text
  const foot = el('div', 'quest-actions');
  card.append(head, body, foot);
  root.append(card);
  (document.getElementById('story')?.parentElement || document.body).append(root);

  // a stop's stamp: gold (right first time), plain (right after a retry),
  // seen (visited, not answered yet) or none
  function stampOf(st) {
    const tries = rp.tries(st.id);
    const r = stopResult(tries, st.answer);
    const kind = r.gold ? 'gold' : r.done ? 'plain' : rp.visited(st.id) || tries.length ? 'seen' : 'none';
    return { cls: kind === 'none' ? '' : ` is-${kind}`, label: s(`stamp_${kind}`, { name: st.item.data.name }) };
  }

  function renderStamps() {
    stampList.replaceChildren();
    stops.forEach((st, i) => {
      const { cls, label } = stampOf(st);
      const li = el('li', `quest-stamp${cls}`);
      li.append(el('span', 'quest-stamp-num', String(i + 1)));
      li.setAttribute('aria-label', label);
      li.title = label;
      if (screen === 'stop' && i === current) li.setAttribute('aria-current', 'step');
      stampList.append(li);
    });
  }

  function sourcesLine(l) {
    if (!l.sources?.length) return null;
    const p = el('p', 'quest-sources');
    p.append(el('span', '', `${s('sources')}: `));
    l.sources.forEach((q, k) => {
      if (k) p.append(document.createTextNode(' · '));
      // a bare URL as the title (Porto's sources), a missing one, or a
      // Russian-only title outside Russian reads as its site name
      const bare = !q.title || /^https?:\/\//.test(q.title) || (language !== 'ru' && /[А-Яа-яЁё]/.test(q.title));
      const name = bare ? new URL(q.url).hostname.replace(/^www\./, '') : q.title;
      const a = el('a', '', name);
      Object.assign(a, { href: q.url, target: '_blank', rel: 'noopener noreferrer' });
      p.append(a);
    });
    return p;
  }

  function show(nodes, buttons, focus) {
    root.dataset.screen = screen;
    kicker.textContent = route ? pick(route.title) : s('kicker');
    stampList.hidden = !route;
    body.replaceChildren(...nodes.filter(Boolean));
    foot.replaceChildren(...buttons.filter(Boolean));
    body.scrollTop = 0;
    renderStamps();
    (focus || body.querySelector('.quest-title'))?.focus({ preventScroll: true });
  }

  // ------------------------------------------------ screens
  // the chooser: every route with its intro, its length and its progress
  function renderRoutes() {
    screen = 'routes';
    current = -1;
    route = null;
    stops = [];
    rp = null;
    const title = el('h2', 'quest-title quest-title-main', s('title'));
    title.tabIndex = -1;
    const list = el('ul', 'quest-routes');
    for (const r of routes) {
      const sum = questSummary(r.stops, progress.route(r.id));
      const li = el('li', 'quest-route');
      li.dataset.route = r.id;
      const h = el('h3', 'quest-route-title', pick(r.title));
      const meta = el('p', 'quest-route-meta', s('route_stops', { n: r.stops.length }));
      if (sum.started) meta.append(document.createTextNode(` · ${s('route_done', { d: sum.done, m: sum.total })}`));
      const open = button('quest-btn', s('open_route'), () => openRoute(r.id));
      open.setAttribute('aria-label', `${s('open_route')}: ${pick(r.title)}`);
      li.append(h, el('p', 'quest-route-intro', pick(r.intro)), meta, open);
      list.append(li);
    }
    show([title, el('p', 'quest-lead', s('subtitle')), list, el('p', 'quest-note', s('note')), textLink(null)], []);
    frameOverview();
    ctx.onRoute?.();
  }

  function openRoute(id) {
    const r = routes.find((x) => x.id === id);
    if (!r) return renderRoutes();
    route = r;
    stops = r.stops;
    rp = progress.route(r.id);
    progress.setLast(r.id);
    renderIntro();
    ctx.onRoute?.();
  }

  // #quest=<id> opens that route; #quest the only route, the one in
  // progress (opened last, started, not finished), or the chooser
  function openFirst(id) {
    if (id && routes.some((r) => r.id === id)) return openRoute(id);
    if (id) console.warn(`[porto] #quest=${id}: no such route`);
    if (routes.length === 1) return openRoute(routes[0].id);
    const last = routes.find((r) => r.id === progress.last);
    const sum = last && questSummary(last.stops, progress.route(last.id));
    if (sum?.started && sum.next < sum.total) return openRoute(last.id);
    renderRoutes();
  }

  // the plain HTML version of a route (or of the list): public/route/,
  // made by scripts/route-pages.mjs
  function textLink(id) {
    const p = el('p', 'quest-note');
    const a = el('a', 'quest-link quest-textlink', s('text_version'));
    a.href = assetUrl(`route/${id ? `${id}/` : ''}${language === 'pt' ? '' : `${language}/`}`);
    p.append(a);
    return p;
  }

  function backLink() {
    return routes.length > 1 ? button('quest-link quest-back', `← ${s('all_routes')}`, () => renderRoutes()) : null;
  }

  function renderIntro() {
    screen = 'intro';
    current = -1;
    const sum = questSummary(stops, rp);
    const title = el('h2', 'quest-title quest-title-main', pick(route.title));
    title.tabIndex = -1;
    const plan = el('ol', 'quest-plan');
    for (const st of stops) {
      const li = el('li');
      li.append(el('span', 'quest-plan-name', st.item.data.name), el('span', 'quest-plan-year', st.item.data.year || ''));
      plan.append(li);
    }
    let primary;
    if (!sum.started) primary = button('quest-btn is-primary', s('start'), () => begin());
    else if (sum.next < sum.total) primary = button('quest-btn is-primary', s('resume', { n: sum.next + 1, m: sum.total }), () => goStop(sum.next));
    else primary = button('quest-btn is-primary', s('finish'), () => renderEnd());
    const again = sum.started ? button('quest-btn', s('restart'), () => restart()) : null;
    show([backLink(), title, el('p', 'quest-lead', pick(route.intro)), plan, el('p', 'quest-note', s('note')), textLink(route.id)], [again, primary]);
    frameOverview();
  }

  function renderStop(i) {
    screen = 'stop';
    current = i;
    const st = stops[i];
    const l = st.item.data;
    rp.visit(st.id);
    const step = el('p', 'quest-step', s('stop', { n: i + 1, m: stops.length }));
    if (l.year) step.append(el('span', 'quest-year', l.year));
    const title = el('h2', 'quest-title', l.name);
    title.tabIndex = -1;

    let photo = null;
    if (l.image) {
      photo = el('figure', 'quest-photo');
      const img = el('img');
      Object.assign(img, { alt: l.name, loading: 'lazy', decoding: 'async', src: assetUrl(l.image) });
      img.addEventListener('error', () => photo.remove());
      photo.append(img);
      const credit = creditNode(l.image_credit, s('photo'));
      if (credit) {
        const cap = el('figcaption', 'quest-credit');
        cap.append(credit);
        photo.append(cap);
      }
    }
    const text = el('p', 'quest-text', pick(st.text).join(' '));

    // question
    const qBox = el('div', 'quest-q');
    qBox.setAttribute('role', 'group');
    const qId = `quest-q-${st.id}`;
    qBox.setAttribute('aria-labelledby', qId);
    const q = el('p', 'quest-question', pick(st.question));
    q.id = qId;
    const opts = el('div', 'quest-options');
    const feedback = el('div', 'quest-feedback');
    feedback.setAttribute('aria-live', 'polite');
    const nextBtn = i < stops.length - 1
      ? button('quest-btn is-primary', s('next'), () => goStop(i + 1))
      : button('quest-btn is-primary', s('finish'), () => renderEnd());
    const optButtons = st.options.map((o, k) => {
      const b = button('quest-option', '', () => answer(k));
      b.append(el('span', 'quest-option-key', 'ABC'[k]), el('span', 'quest-option-text', pick(o)));
      opts.append(b);
      return b;
    });
    qBox.append(el('p', 'quest-qlabel', s('question')), q, opts, feedback);

    // A wrong pick: «not this one», that option is disabled, no reveal; the
    // visitor picks again. The right pick shows the explanation. The saved
    // picks repaint the same state on a revisit.
    function paint(announce) {
      const tries = rp.tries(st.id);
      const r = stopResult(tries, st.answer);
      optButtons.forEach((b, k) => {
        const tried = tries.includes(k);
        b.disabled = r.done || tried;
        b.classList.toggle('is-right', r.done && k === st.answer);
        b.classList.toggle('is-tried', tried && k !== st.answer);
      });
      nextBtn.hidden = !r.done;
      if (r.done) {
        const verdict = el('p', 'quest-verdict is-right', s(r.gold ? 'correct_gold' : 'correct_plain'));
        const basis = el('blockquote', 'quest-basis');
        basis.append(el('span', 'quest-basis-label', s('basis')), document.createTextNode(` ${s('basis_quote', { text: pick(st.basis) })}`));
        feedback.replaceChildren(verdict, basis);
      } else feedback.replaceChildren(...(tries.length ? [el('p', 'quest-verdict is-retry', s('retry'))] : []));
      renderStamps();
      if (!announce) return;
      if (r.done) nextBtn.focus({ preventScroll: true });
      else optButtons.find((b) => !b.disabled)?.focus({ preventScroll: true });
      feedback.scrollIntoView({ block: 'end', behavior: reducedMotion ? 'auto' : 'smooth' });
    }
    function answer(k) {
      const verdict = rp.pick(st.id, k, st.answer);
      if (!verdict) return;
      paint(true);
      if (verdict !== 'right') return;
      track('quest_step_completed', st.id, stopResult(rp.tries(st.id), st.answer).attempts);
      const sum = questSummary(stops, rp);
      if (sum.done === sum.total) track('quest_completed', st.id);
    }

    const showBtn = button('quest-btn is-quiet', s('show'), () => fly(shot));
    show([step, title, photo, text, qBox, sourcesLine(l)], [showBtn, nextBtn]);
    paint(false);
    ctx.onFocus?.([st.id]);
    shot = screenShot();
    fly(shot);
  }

  function renderEnd() {
    screen = 'end';
    current = -1;
    const sum = questSummary(stops, rp);
    const title = el('h2', 'quest-title quest-title-main', s('summary', { v: sum.visited, g: sum.gold }));
    title.tabIndex = -1;
    const list = el('ol', 'quest-visits');
    stops.forEach((st, i) => {
      const l = st.item.data;
      const li = el('li', 'quest-visit');
      // the stop's stamp, large; the list's heading names the place, the
      // stamp's label says how it was answered
      const { cls, label } = stampOf(st);
      const stamp = el('span', `quest-stamp quest-visit-stamp${cls}`, String(i + 1));
      stamp.setAttribute('role', 'img');
      stamp.setAttribute('aria-label', label);
      const h = el('h3', 'quest-visit-name', l.name);
      li.append(stamp, h, el('p', 'quest-visit-text', pick(st.visit).join(' ')));
      const open = button('quest-link', s('open_card'), () => {
        const index = st.item.index;
        track('outbound_visit_clicked', st.id);
        stop();
        ctx.onPlace?.(index);
      });
      open.setAttribute('aria-label', `${s('open_card')}: ${l.name}`);
      li.append(open);
      list.append(li);
    });
    show(
      [el('p', 'quest-step', s('result')), title, el('p', 'quest-lead', pick(route.end_lead)), el('h3', 'quest-sub', s('visit')), list, backLink()],
      [button('quest-btn', s('restart'), () => restart()), button('quest-btn is-primary', s('explore'), () => stop())],
    );
    frameOverview();
  }

  function goStop(i) {
    renderStop(THREE.MathUtils.clamp(i, 0, stops.length - 1));
  }

  // the route starts at its first stop (Start, or Start again after a reset)
  function begin() {
    track('quest_started', stops[0].id);
    goStop(0);
  }

  function restart() {
    rp.reset();
    begin();
  }

  // product events (events.js): a CustomEvent on window, sent nowhere
  const track = (name, stop = null, attempt = null) => emit(name, { city: ctx.city, route: route?.id ?? null, stop, attempt, lang: language });

  // ------------------------------------------------ camera
  // The part of the screen the card leaves free, as fractions of the view.
  function freeView() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const r = card.getBoundingClientRect();
    if (mobile()) {
      const bottom = r.height ? r.top / H : 0.45;
      return { l: 0, r: 1, t: 0.08, b: THREE.MathUtils.clamp(bottom - 0.02, 0.3, 0.9) };
    }
    return { l: Math.min(0.6, (r.right || 440) / W + 0.01), r: 1, t: 0.06, b: 1 };
  }

  // A view of `list` (landmark items), framed in the free part of the
  // screen. v: { az: radians added to `bearing`, elev: radians above the
  // horizon, k: distance multiplier, mk: the same on a phone (Porto: a long
  // bridge in a tall, narrow view would otherwise shrink to a line) }. The
  // view is raised until no roof hides the first item (as story.js does for
  // its chapters).
  function frame(list, v, bearing) {
    const box = new THREE.Box3();
    for (const it of list) box.union(it.box);
    const size = box.getSize(new THREE.Vector3());
    const look = box.getCenter(new THREE.Vector3());
    const base = Math.min(...list.map((it) => it.base));
    look.y = base + Math.min(size.y, 60) * 0.3;
    const r = Math.max(8, 0.5 * Math.hypot(size.x, size.z, Math.min(size.y, 80)));
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const aspect = window.innerWidth / window.innerHeight;
    const view = freeView();
    const fw = view.r - view.l;
    const fh = view.b - view.t;
    const k = (mobile() ? v.mk : null) ?? v.k ?? 1;
    const dist = THREE.MathUtils.clamp(Math.max(r / (tanV * fh), r / (tanV * aspect * fw)) * k, 30, 2600);
    const az = bearing + (v.az ?? 0);
    const subject = list[0];
    const q = new THREE.Vector3();
    const inside = (p) => p.x > subject.box.min.x - 0.5 && p.x < subject.box.max.x + 0.5 && p.z > subject.box.min.z - 0.5 && p.z < subject.box.max.z + 0.5;
    const blocked = (pos) => {
      for (let k = 1; k < 32; k++) {
        q.lerpVectors(subject.center, pos, k / 32);
        if (!inside(q) && ctx.sky.at(q.x, q.z, 0) > q.y + 0.5) return true;
      }
      return false;
    };
    let pose = null;
    for (let up = 0; up <= 0.8; up += 0.08) {
      const e = Math.min(1.4, (v.elev ?? 0.45) + up + (mobile() ? 0.18 : 0));
      const dir = new THREE.Vector3(Math.sin(az) * Math.cos(e), Math.sin(e), Math.cos(az) * Math.cos(e));
      const tgt = look.clone();
      const right = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
      const fwd = new THREE.Vector3(-dir.x, 0, -dir.z).normalize();
      tgt.addScaledVector(right, -((view.l + view.r) / 2 - 0.5) * 2 * dist * tanV * aspect);
      tgt.addScaledVector(fwd, (((view.t + view.b) / 2 - 0.5) * 2 * dist * tanV) / Math.max(0.3, Math.sin(e)));
      const pos = tgt.clone().addScaledVector(dir, dist);
      pos.y = Math.max(pos.y, ctx.sky.at(pos.x, pos.z, 6) + SHOT_CLEAR);
      pose = { pos, look: tgt };
      if (!blocked(pos)) break;
    }
    return pose;
  }

  // the bearing of the map's opening view, so the city reads as it did
  const homeBearing = () => Math.atan2(ctx.home.position.x - ctx.home.target.x, ctx.home.position.z - ctx.home.target.z);
  function screenShot() {
    if (screen === 'stop') return frame([stops[current].item], stops[current].view || {}, stops[current].item.viewBearing ?? 0);
    // a route's `overview` stops (all of them when it has no list); the
    // chooser frames every route's overview
    const pool = route ? [route] : routes;
    const ids = new Set(pool.flatMap((r) => r.overview || r.stops.map((st) => st.id)));
    const list = [...new Map(pool.flatMap((r) => r.stops).filter((st) => ids.has(st.id)).map((st) => [st.id, st.item])).values()];
    return frame(list, OVERVIEW, homeBearing());
  }
  function frameOverview() {
    ctx.onFocus?.([...new Set((route ? [route] : routes).flatMap((r) => r.stops.map((st) => st.id)))]);
    shot = screenShot();
    fly(shot);
  }

  // One flight to `to` along a curve over the city, driven through the
  // rig (camera.js drive). At the end the rig hands the orbit controls
  // back, so the visitor can look around the stop.
  function fly(to) {
    if (!to || !active) return;
    const from = camera.position.clone();
    const look0 = rig.controls.target.clone();
    const far = from.distanceTo(to.pos) > 40;
    const curve = !reducedMotion && far ? flightCurve(from, to.pos, ctx.sky) : null;
    const dur = reducedMotion ? 0 : curve ? THREE.MathUtils.clamp(1.6 + curve.getLength() / 900, 2.4, 5.5) : 1.2;
    const pos = new THREE.Vector3();
    const look = new THREE.Vector3();
    let t = 0;
    flying = true;
    rig.drive({
      floor: 3,
      snap: true, // the pose is eased here; the rig copies it
      done: false,
      advance(dt) {
        t += dt;
        if (t >= dur) {
          this.done = true;
          flying = false;
        }
      },
      pose() {
        const u = dur ? clamp01(t / dur) : 1;
        if (curve) curve.getPointAt(easeInOut(u), pos);
        else pos.lerpVectors(from, to.pos, easeInOut(u));
        look.lerpVectors(look0, to.look, curve ? easeInOut(clamp01((u - 0.05) / 0.8)) : easeInOut(u));
        return { pos, look, cut: true };
      },
    });
  }

  // ------------------------------------------------ light
  // While the route runs the scene shows clear daylight, so an evening demo
  // is not dark. The visitor's own light (a preset or the live sun, and the
  // weather) is kept here, never saved or put in the URL, and comes back on
  // exit. A light the visitor sets meanwhile (a time= edit of the hash: the
  // atmosphere panel is inert during the route) wins and stays.
  const atmosphere = ctx.atmosphere;
  let held = null; // { time, live, weather, timeSet, weatherSet }
  let ours = false;
  const quietly = (fn) => {
    ours = true;
    try {
      fn();
    } finally {
      ours = false;
    }
  };
  // 'live' is never a hand change here: it comes from live.js starting late
  atmosphere?.onChange((name) => {
    if (held && !ours && name !== 'live') held.timeSet = true;
  });
  const watched = new WeakSet();
  function holdLight() {
    if (!atmosphere) return;
    const life = ctx.getLife?.();
    const first = !held;
    if (first) held = { time: atmosphere.time, live: false, weather: null, timeSet: false, weatherSet: false };
    // life.js may arrive after the route opened: its live mode then sets
    // the real sun first, and that is the visitor's light
    else if (!held.timeSet && atmosphere.time === 'live') held.time = 'live';
    if (life) {
      held.live = life.live.live;
      if (!held.weatherSet) held.weather = life.weather.name;
      life.live.hold(true);
      if (!watched.has(life.weather)) {
        watched.add(life.weather);
        life.weather.onChange(() => {
          if (held && !ours) held.weatherSet = true;
        });
      }
    }
    // On entry the light blends to day. When life.js arrives later, its live
    // sun and saved weather were just set at once (no frame drawn yet), so
    // day and clear go back at once too: no flash of night or rain.
    quietly(() => {
      if (!held.timeSet) {
        if (first) ctx.setTime('day');
        else atmosphere.setTime('day', { animate: false });
      }
      if (life && !held.weatherSet) life.weather.set('clear', first ? {} : { instant: true });
    });
  }
  function releaseLight() {
    const h = held;
    held = null;
    if (!h) return;
    const life = ctx.getLife?.();
    quietly(() => {
      if (life && !h.weatherSet && h.weather) life.weather.set(h.weather);
      if (!h.timeSet && h.time !== 'live') ctx.setTime(h.time);
      life?.live.hold(false, !h.timeSet);
    });
  }
  // the visitor's light while the route shows daylight (main.js currentHash)
  function heldLight() {
    if (!held) return null;
    const life = ctx.getLife?.();
    const time = held.timeSet ? atmosphere.time : held.time;
    const weather = held.weatherSet ? life?.weather.name : held.weather;
    const hash = held.live && !held.timeSet ? 'live=1' : weather && weather !== 'clear' ? `weather=${weather}` : '';
    return { time, hash };
  }

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    if (!active) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!active) return;
      shot = screenShot();
      fly(shot);
    }, 200);
  });

  // ------------------------------------------------ lifecycle
  // wanted(): false when the visitor moved on while quest.json loaded
  // id: the route to open (#quest=<id>), or '' / null for #quest
  async function start(wanted = () => true, id = null) {
    if (active) return;
    if (!data) {
      try {
        data = await loadQuest();
      } catch (err) {
        console.error('[porto] quest.json failed to load', err);
        if (wanted()) ctx.onError?.(err);
        return;
      }
      // a route keeps the stops this map has; one with fewer than two is left out
      routes = (data?.routes || [])
        .map((r) => ({ ...r, stops: (r.stops || []).map((st) => ({ ...st, item: byId.get(st.id) })).filter((st) => st.item) }))
        .filter((r) => r.id && r.stops.length >= 2);
      if (!routes.length) {
        console.error('[porto] quest.json: no route with two stops on this map');
        data = null;
        ctx.onError?.(new Error('no stops'));
        return;
      }
      progress = createQuestProgress(ctx.city);
      root.setAttribute('aria-label', s('title'));
      stampList.setAttribute('aria-label', s('stamps'));
      closeBtn.setAttribute('aria-label', s('close'));
      closeBtn.title = s('close');
    }
    if (active || !wanted()) return;
    active = true;
    holdLight();
    ctx.onEnter?.();
    root.hidden = false;
    document.body.classList.add('is-quest');
    inerted = [...document.querySelectorAll(CHROME)].filter((n) => !n.inert && !root.contains(n));
    for (const n of inerted) n.inert = true;
    requestAnimationFrame(() => root.classList.add('is-open'));
    openFirst(id);
  }

  function stop() {
    if (!active) return;
    active = false;
    flying = false;
    rig.stopDrive();
    root.classList.remove('is-open');
    document.body.classList.remove('is-quest');
    for (const n of inerted) n.inert = false;
    inerted = [];
    root.hidden = true;
    ctx.onFocus?.([]);
    releaseLight();
    ctx.onExit?.();
  }

  function onKey(e) {
    if (!active) return false;
    if (e.key === 'Escape') {
      e.preventDefault();
      stop();
      return true;
    }
    return false;
  }

  return {
    start,
    stop,
    onKey,
    get active() {
      return active;
    },
    get heldLight() {
      return heldLight();
    },
    // main.js: life.js was built while the route runs
    lifeReady() {
      if (active) holdLight();
    },
    // the hash while the mode runs: quest=<id> in a route, quest on the chooser
    get hash() {
      return route ? `quest=${route.id}` : 'quest';
    },
    // a hash edit while the mode runs (main.js applyHash)
    open(id) {
      if (!active || (route && route.id === id)) return;
      if (id) openFirst(id);
      else if (routes.length > 1) renderRoutes();
    },
    // tests and screenshots
    get state() {
      const sum = stops.length && rp ? questSummary(stops, rp) : null;
      return { active, screen, route: route?.id ?? null, stop: current, id: stops[current]?.id ?? null, flying: flying && rig.touring, ...sum };
    },
    goStop,
    showEnd: () => route && renderEnd(),
    answer(k) {
      body.querySelectorAll('.quest-option')[k]?.click();
    },
  };
}
