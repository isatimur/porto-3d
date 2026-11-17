// History routes («Discover historic Porto», #quest, #quest=<route id>): a
// small engine for several guided routes. #quest opens the chooser (or the
// only route, or the one in progress); each route shows its landmarks one at
// a time. The camera flies to each one (tour.js flightCurve, over roofs and
// terrain); the card tells its history in a few sentences, shows the photo
// with its credit and sets one task (quest-tasks.js): a question with three
// options, a true/false statement, a detail to read off the 3D model, events
// to put in time order, or the place itself to find on the map among a few
// unnamed candidates. A wrong try is set aside and the visitor tries again;
// right first time earns a gold stamp, right after a retry a plain one. The
// end counts the places and the first-time answers and says how to see each
// place in the real city.
//
// Content: data/quest.json, loaded with the module. Its history, answer,
// dated and visit lines are verbatim excerpts of the place cards (checked by
// scripts/quest.test.mjs); its `ui` table holds this mode's interface
// strings in ru/en/pt, so the first load carries none of them. Progress is
// saved per route id (quest-progress.js).
//
// Find on the map: map picking is off during a route (main.js); while such a
// task is open, quest.pickable names the candidates, main.js picks among them
// only (canvas clicks and label clicks) and hands the pick to mapPick(). The
// candidates' labels show «?» instead of their names; the card lists the
// same candidates as buttons, the keyboard and screen-reader path.
//
// While a stop is shown the visitor may orbit the map freely; «Show the
// place» flies back to the framing. Reduced motion: every flight is a cut.
// Esc (main.js key dispatcher -> onKey) leaves the mode. The scene shows
// clear daylight while the route runs; the visitor's light comes back on
// exit (see «light» below).
//
// Ported from braga-3d (main 1048925, task types from main 08ce468). Porto
// differences: the storage key and the round-2 save table (quest-progress.js,
// data/quest.json legacy.v2), the map chrome list below (the fly keys and the
// back-to-globe link), source links named by their site (Porto's source
// titles are the bare URLs), the early route card on a #quest deep link
// (attach()), the view key `mk` (the distance on a phone, see frame()), the
// place's year held back on an open sequence task, and filtered-out
// candidates shown through ctx.forceShow (landmarks.js setForced).
import * as THREE from 'three';
import { language } from './i18n.js';
import { flightCurve, easeInOut } from './tour.js';
import { S } from './geo.js';
import { assetUrl } from './data.js';
import { dataPath } from './city.js';
import { creditNode } from './gallery.js';
import { createQuestProgress, questSummary, stopResult } from './quest-progress.js';
import { answerKey, taskErrors } from './quest-tasks.js';
import { emit } from './events.js';
import './quest.css';

const SHOT_CLEAR = 10 * S; // 10 m over the roofs around the camera
const OVERVIEW = { az: 0, elev: 0.78, k: 1.05 }; // intro and end: every stop in view
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const pick = (o) => (o && typeof o === 'object' ? o[language] ?? o.ru : o) ?? '';

// <data_dir>/quest.json, fetched when the route first opens. A #quest deep
// link starts the fetch with the page (main.js preloads it next to the
// map's data), so the route's card does not wait for the city to be built.
let questData = null;
export function preloadQuest() {
  questData ??= (async () => {
    const res = await fetch(assetUrl(dataPath('quest.json')), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!(res.headers.get('content-type') || '').includes('json')) throw new Error('not JSON');
    return res.json();
  })();
  questData.catch(() => {
    questData = null; // a failed fetch is tried again on the next open
  });
  return questData;
}
const loadQuest = preloadQuest;

// ctx: { camera, rig, items, sky, home: {position, target}, reducedMotion,
//        city, atmosphere, getLife(), setTime(name), onFocus(ids), onEnter(),
//        onExit(), onRoute(), onPlace(index), onError(err) }
// A #quest deep link creates the route before the city is built (main.js):
// then `rig`, `sky` and the UI callbacks are missing. The card shows and
// works at once; the camera flights wait until attach() hands them over.
export function createQuest(ctx) {
  const { camera, reducedMotion } = ctx;
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
  // seen (visited, not solved yet) or none
  function stampOf(st) {
    const kind = rp.stamp(st.id) || (rp.visited(st.id) || rp.tries(st.task.id).length ? 'seen' : 'none');
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
    endPick(); // every screen change ends a find-on-map task's picking
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
    // the place's year; a sequence task shows it once solved (it may be one
    // of the events to order)
    const year = l.year ? el('span', 'quest-year', l.year) : null;
    if (year) step.append(year);
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

    // the task
    const task = st.task;
    const key = answerKey(task);
    const qBox = el('div', `quest-q is-${task.type.replace(/_/g, '-')}`);
    qBox.setAttribute('role', 'group');
    const qId = `quest-q-${st.id}`;
    qBox.setAttribute('aria-labelledby', qId);
    const feedback = el('div', 'quest-feedback');
    feedback.setAttribute('aria-live', 'polite');
    const nextBtn = i < stops.length - 1
      ? button('quest-btn is-primary', s('next'), () => goStop(i + 1))
      : button('quest-btn is-primary', s('finish'), () => renderEnd());
    const showBtn = button('quest-btn is-quiet', s('show'), () => fly(shot));
    const state = () => {
      const tries = rp.tries(task.id);
      const stamp = rp.stamp(st.id);
      return { tries, stamp, done: !!stamp, wrong: tries.filter((t) => t !== key) };
    };
    // one try: right or wrong is saved, then the card repaints. how: 'panel'
    // (a button in the card) or 'map' (a pick on the map: focus stays)
    function submit(token, how = 'panel') {
      const verdict = rp.submit(st.id, task.id, token, key);
      if (!verdict) return null;
      paint(how, token);
      if (verdict === 'right') {
        track('quest_step_completed', st.id, stopResult(rp.tries(task.id), key).attempts, task.type);
        const sum = questSummary(stops, rp);
        if (sum.done === sum.total) track('quest_completed', st.id);
      }
      return verdict;
    }
    const view = VIEWS[task.type]({ st, task, key, submit, feedback, state });
    const q = el('p', 'quest-question', view.question);
    q.id = qId;
    qBox.append(el('p', 'quest-qlabel', view.label), q, ...view.nodes, feedback);

    // A wrong try: «not this one», that try is set aside, no reveal; the
    // visitor tries again. The right one shows the explanation. The saved
    // tries repaint the same state on a revisit or after a reload.
    function paint(how, last) {
      const S = state();
      view.paint(S);
      nextBtn.hidden = !S.done;
      if (year) year.hidden = task.type === 'sequence' && !S.done;
      if (S.done) feedback.replaceChildren(el('p', 'quest-verdict is-right', s(S.stamp === 'gold' ? 'correct_gold' : 'correct_plain')), ...view.explain());
      else feedback.replaceChildren(...view.retry(S, last));
      renderStamps();
      // found on the map: the history shows and the camera goes to the place
      if (S.done && picking) {
        endPick();
        text.hidden = false;
        showBtn.textContent = s('show');
        ctx.onFocus?.([st.id]);
        shot = cameraReady() ? screenShot() : null;
        fly(shot);
      }
      if (!how) return;
      if (S.done) {
        const next = () => nextBtn.isConnected && nextBtn.focus({ preventScroll: true });
        next();
        // a tap's compatibility mousedown comes after the pick and moves
        // focus to the page: put it back on Next
        if (how === 'map') setTimeout(() => document.activeElement === document.body && next(), 150);
      } else if (how !== 'map') view.focus()?.focus({ preventScroll: true });
      feedback.scrollIntoView({ block: 'end', behavior: reducedMotion ? 'auto' : 'smooth' });
    }

    show([step, title, photo, text, qBox, sourcesLine(l)], [showBtn, nextBtn]);
    // find on the map: the camera shows the candidates, not the place; its
    // history waits until it is found
    const finding = task.type === 'find_on_map' && !rp.stamp(st.id);
    if (finding) {
      text.hidden = true;
      showBtn.textContent = s('show_area');
      startPick(task, (id) => {
        if (submit(id, 'map') === null && !state().done) feedback.replaceChildren(...view.retry(state(), id));
      });
    }
    paint(false);
    if (!finding) ctx.onFocus?.([st.id]);
    shot = cameraReady() ? screenShot() : null;
    fly(shot);
  }

  // ------------------------------------------------ task views
  // Each view gets { st, task, key, submit, feedback, state } and returns
  // { label, question, nodes, paint(S), retry(S, last), explain(), focus() }.
  const quoteNode = (text) => {
    const b = el('blockquote', 'quest-basis');
    b.append(el('span', 'quest-basis-label', s('basis')), document.createTextNode(` ${s('basis_quote', { text })}`));
    return b;
  };
  const retryNode = (key, vars) => el('p', 'quest-verdict is-retry', s(key, vars));

  // options as buttons: multiple choice, true/false, visual detail
  function choiceView({ task, key, submit }, { label, question, options, keys, extra = [], explain }) {
    const box = el('div', 'quest-options');
    const btns = options.map((o, k) => {
      const b = button('quest-option', '', () => submit(o.id));
      b.dataset.option = o.id;
      const mark = el('span', 'quest-option-key', keys[k]);
      mark.setAttribute('aria-hidden', 'true');
      b.append(mark, el('span', 'quest-option-text', o.text));
      box.append(b);
      return b;
    });
    return {
      label,
      question,
      nodes: [...extra, box],
      paint(S) {
        btns.forEach((b, k) => {
          const id = options[k].id;
          const tried = S.tries.includes(id);
          b.disabled = S.done || tried;
          b.classList.toggle('is-right', S.done && id === key);
          b.classList.toggle('is-tried', tried && id !== key);
        });
      },
      retry: (S) => (S.wrong.length ? [retryNode('retry')] : []),
      explain: explain || (() => [quoteNode(pick(task.basis))]),
      focus: () => btns.find((b) => !b.disabled),
    };
  }

  const VIEWS = {
    multiple_choice: (a) =>
      choiceView(a, { label: s('question'), question: pick(a.task.question), keys: 'ABC', options: a.task.options.map((o) => ({ id: o.id, text: pick(o) })) }),
    // the answer is read off the model: «Show the place» brings it back
    visual_detail: (a) =>
      choiceView(a, {
        label: s('look_label'),
        question: pick(a.task.question),
        keys: 'ABC',
        options: a.task.options.map((o) => ({ id: o.id, text: pick(o) })),
        extra: [el('p', 'quest-look', s('look_hint', { show: s('show') }))],
      }),
    true_false: (a) =>
      choiceView(a, {
        label: s('tf_label'),
        question: pick(a.task.statement),
        keys: ['✓', '✕'],
        options: [
          { id: 'true', text: s('tf_true') },
          { id: 'false', text: s('tf_false') },
        ],
        explain: () => [el('p', 'quest-tf', s(a.task.answer ? 'tf_is_true' : 'tf_is_false')), quoteNode(pick(a.task.basis))],
      }),
    find_on_map: findView,
    sequence: sequenceView,
  };

  // The place among unnamed candidates on the map; the same candidates as
  // buttons in the card, in alphabetical order (it gives nothing away).
  function findView({ st, task, key, submit }) {
    const name = (id) => byId.get(id)?.data.name || id;
    const ids = task.candidates.filter((id) => byId.has(id)).sort((a, b) => name(a).localeCompare(name(b), language));
    const list = el('ul', 'quest-candidates');
    const btns = ids.map((id) => {
      const li = el('li');
      const b = button('quest-option quest-candidate', name(id), () => submit(id));
      b.dataset.option = id;
      li.append(b);
      list.append(li);
      return b;
    });
    return {
      label: s('find_label'),
      question: s('find_prompt', { name: st.item.data.name }),
      nodes: [el('p', 'quest-listlabel', s('find_list')), list],
      paint(S) {
        btns.forEach((b, k) => {
          const tried = S.tries.includes(ids[k]);
          b.disabled = S.done || tried;
          b.classList.toggle('is-right', S.done && ids[k] === key);
          b.classList.toggle('is-tried', tried && ids[k] !== key);
        });
        if (!picking) return;
        // a tried candidate shows its name on the map; after two wrong picks
        // the place's own marker stands out (pulses, or a still ring with
        // reduced motion)
        for (const it of picking.list) {
          it.labelEl.classList.toggle('is-quest-tried', S.tries.includes(it.data.id));
          it.labelEl.classList.toggle('is-quest-hint', it.data.id === key && S.wrong.length >= 2);
        }
      },
      retry(S, last) {
        const wrong = last && last !== key ? last : S.wrong.at(-1);
        const out = wrong ? [retryNode('find_wrong', { name: name(wrong) })] : [];
        if (S.wrong.length >= 2) out.push(el('p', 'quest-hint', s('find_hint')));
        return out;
      },
      explain: () => [quoteNode(pick(task.basis))],
      focus: () => btns.find((b) => !b.disabled),
    };
  }

  // Events to put in time order with up/down buttons (keyboard and touch).
  // The order shown first comes from the data; after a wrong check the
  // checked order stays, after a reload too. The dated quotes show only
  // once the order is right.
  function sequenceView({ task, key, submit, feedback, state }) {
    const items = new Map(task.items.map((it) => [it.id, it]));
    const m = task.items.length;
    const last = state().wrong.at(-1)?.split(',');
    let order = last && last.length === m && last.every((id) => items.has(id)) ? last : [...task.start];
    const list = el('ol', 'quest-seq');
    const live = el('p', 'quest-sr');
    live.setAttribute('aria-live', 'polite');
    const check = button('quest-btn is-primary quest-seq-check', s('seq_check'), () => {
      if (submit(order.join(',')) === null && !state().done) feedback.replaceChildren(retryNode('seq_same'));
    });
    function move(k, dir) {
      const j = k + dir;
      if (j < 0 || j >= m) return;
      [order[k], order[j]] = [order[j], order[k]];
      draw();
      // focus stays with the moved event; at the end of the list, on its other arrow
      const row = list.children[j];
      const same = row.querySelector(dir < 0 ? '.is-up' : '.is-down');
      (same.disabled ? row.querySelector(dir < 0 ? '.is-down' : '.is-up') : same).focus({ preventScroll: true });
      live.textContent = s('seq_moved', { item: pick(items.get(order[j]).label), n: j + 1, m });
    }
    function draw() {
      list.replaceChildren(
        ...order.map((id, k) => {
          const label = pick(items.get(id).label);
          const li = el('li', 'quest-seq-item');
          li.dataset.item = id;
          const num = el('span', 'quest-seq-num', String(k + 1));
          num.setAttribute('aria-hidden', 'true');
          const up = button('quest-seq-move is-up', '↑', () => move(k, -1));
          const down = button('quest-seq-move is-down', '↓', () => move(k, 1));
          up.setAttribute('aria-label', s('seq_up', { item: label }));
          down.setAttribute('aria-label', s('seq_down', { item: label }));
          up.disabled = k === 0;
          down.disabled = k === m - 1;
          li.append(num, el('span', 'quest-seq-label', label), up, down);
          return li;
        }),
      );
    }
    draw();
    return {
      label: s('seq_label'),
      question: s('seq_prompt'),
      nodes: [list, check, live],
      paint(S) {
        list.hidden = S.done;
        check.hidden = S.done;
      },
      retry(S, lastTry) {
        const tried = (lastTry && lastTry !== key ? lastTry : S.wrong.at(-1))?.split(',');
        if (!tried) return [];
        const right = key.split(',');
        return [retryNode('seq_wrong', { k: tried.filter((id, i) => id === right[i]).length, m })];
      },
      explain() {
        const done = el('ol', 'quest-seq-done');
        for (const it of task.items) {
          const li = el('li');
          li.append(el('span', 'quest-seq-label', pick(it.label)), el('blockquote', 'quest-basis', s('basis_quote', { text: pick(it.quote) })));
          done.append(li);
        }
        return [el('p', 'quest-basis-label', s('seq_basis')), done];
      },
      focus: () => check,
    };
  }

  // ------------------------------------------------ find on the map: picking
  // While a find-on-map task is open its candidates pick on the map (main.js
  // asks quest.pickable and calls mapPick), their labels take clicks and
  // show «?», and the labels layer is out of the screen-reader tree (the
  // card's list is that path). endPick() puts all of it back; every screen
  // change and stop() call it.
  let picking = null; // { task, list: [item], ids: Set(id), allow: Set(index), onPick(id) }
  const NONE = new Set();
  const labelsEl = () => document.getElementById('labels');
  // the labels layer takes clicks while picking; out of it, it is inert like
  // the rest of the map chrome (attach() may inert it after a pick started)
  function pickLabels(on) {
    const layer = labelsEl();
    if (!layer) return;
    layer.inert = on ? false : inerted.includes(layer);
    if (on) layer.setAttribute('aria-hidden', 'true');
    else layer.removeAttribute('aria-hidden');
  }
  function startPick(task, onPick) {
    const list = task.candidates.map((id) => byId.get(id)).filter(Boolean);
    picking = { task, list, ids: new Set(list.map((it) => it.data.id)), allow: new Set(list.map((it) => it.index)), onPick };
    for (const it of list) it.labelEl.classList.add('is-quest-candidate');
    // a candidate whose category the visitor filtered out still shows (its
    // model, pin and label), and goes back to the filter afterwards
    // (landmarks.js setForced; the early card gets it with attach())
    ctx.forceShow?.(picking.allow);
    document.body.classList.add('is-quest-picking');
    root.dataset.picking = '1';
    pickLabels(true);
    ctx.onFocus?.([...picking.ids]);
  }
  function endPick() {
    if (!picking) return;
    for (const it of picking.list) it.labelEl.classList.remove('is-quest-candidate', 'is-quest-tried', 'is-quest-hint');
    ctx.forceShow?.(null);
    document.body.classList.remove('is-quest-picking');
    delete root.dataset.picking;
    picking = null;
    pickLabels(false);
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
  const track = (name, stop = null, attempt = null, type = null) => emit(name, { city: ctx.city, route: route?.id ?? null, stop, attempt, type, lang: language });

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
    // a find-on-map task: every candidate in view, the target not singled out
    if (screen === 'stop' && picking) return frame(picking.list, picking.task.view || OVERVIEW, homeBearing());
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
    shot = cameraReady() ? screenShot() : null;
    fly(shot);
  }
  // the framing reads the skyline and the flight drives the rig: both exist
  // once the city is built (an early deep link has neither yet)
  const cameraReady = () => !!(ctx.rig && ctx.sky);

  // One flight to `to` along a curve over the city, driven through the
  // rig (camera.js drive). At the end the rig hands the orbit controls
  // back, so the visitor can look around the stop.
  function fly(to) {
    if (!to || !active || !ctx.rig) return;
    const rig = ctx.rig;
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
      if (!active || !cameraReady()) return;
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
      // a route keeps the stops this map has, each with a sound task (a
      // find-on-map task keeps the candidates this map has); one with fewer
      // than two stops is left out
      const usable = (r, st) => {
        if (!st.item) return null;
        const task = st.task?.type === 'find_on_map' ? { ...st.task, candidates: (st.task.candidates || []).filter((id) => byId.has(id)) } : st.task;
        const errors = taskErrors(task);
        if (errors.length) {
          console.warn(`[porto] quest.json ${r.id}/${st.id}: ${errors.join('; ')}`);
          return null;
        }
        return { ...st, task };
      };
      routes = (data?.routes || [])
        .map((r) => ({ ...r, stops: (r.stops || []).map((st) => usable(r, { ...st, item: byId.get(st.id) })).filter(Boolean) }))
        .filter((r) => r.id && r.stops.length >= 2);
      if (!routes.length) {
        console.error('[porto] quest.json: no route with two stops on this map');
        data = null;
        ctx.onError?.(new Error('no stops'));
        return;
      }
      progress = createQuestProgress(ctx.city, data.legacy?.v2 || {});
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
    inertChrome();
    // an early card (deep link) opens at once: the build's next long task
    // would hold a fade at its first frame
    if (ctx.rig) requestAnimationFrame(() => root.classList.add('is-open'));
    else root.classList.add('is-open');
    openFirst(id);
  }
  // the map chrome present now (attach() catches what the UI made later)
  function inertChrome() {
    const more = [...document.querySelectorAll(CHROME)].filter((n) => !n.inert && !root.contains(n));
    for (const n of more) n.inert = true;
    inerted.push(...more);
  }

  // An early route (deep link) gets the rest of its context once the city
  // and the UI exist: the camera flies to the open screen's view, the
  // chrome made since then goes inert, life's weather is held.
  function attach(more) {
    Object.assign(ctx, more);
    if (!active) return;
    inertChrome();
    holdLight();
    ctx.onEnter?.();
    ctx.onRoute?.();
    // a find-on-map task opened early: its labels take clicks again (the
    // chrome pass above made them inert), the filter lets its candidates
    // show, and the focus names every candidate, never the place alone
    if (picking) {
      pickLabels(true);
      ctx.forceShow?.(picking.allow);
      ctx.onFocus?.([...picking.ids]);
    } else if (screen === 'stop') ctx.onFocus?.([stops[current].id]);
    else ctx.onFocus?.([...new Set((route ? [route] : routes).flatMap((r) => r.stops.map((st) => st.id)))]);
    shot = cameraReady() ? screenShot() : null;
    fly(shot);
  }

  function stop() {
    if (!active) return;
    endPick();
    active = false;
    flying = false;
    ctx.rig?.stopDrive();
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
    attach,
    onKey,
    get active() {
      return active;
    },
    get heldLight() {
      return heldLight();
    },
    // main.js: the visitor's start-up light, read after an early route took the sky
    holdTime(name) {
      if (held && !held.timeSet) held.time = name;
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
    // main.js: the item indices a map click may pick (empty unless a
    // find-on-map task is open), and the pick itself (an item index or null)
    get pickable() {
      return picking ? picking.allow : NONE;
    },
    mapPick(index) {
      if (!picking || index == null) return;
      const it = ctx.items.find((x) => x.index === index);
      if (it && picking.ids.has(it.data.id)) picking.onPick(it.data.id);
    },
    // tests and screenshots
    get state() {
      const sum = stops.length && rp ? questSummary(stops, rp) : null;
      const task = stops[current]?.task;
      return { active, screen, route: route?.id ?? null, stop: current, id: stops[current]?.id ?? null, type: task?.type ?? null, picking: !!picking, flying: flying && !!ctx.rig?.touring, ...sum };
    },
    goStop,
    showEnd: () => route && renderEnd(),
    answer(k) {
      body.querySelectorAll('.quest-option')[k]?.click();
    },
    // where a landmark's pin and model centre are on the screen (CSS pixels)
    screenPoint(id) {
      const it = byId.get(id);
      if (!it) return null;
      const at = (v) => {
        v.project(camera);
        return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight, behind: v.z > 1 };
      };
      return { pin: at(new THREE.Vector3(it.center.x, it.pinY ?? it.top, it.center.z)), model: at(it.box.getCenter(new THREE.Vector3())) };
    },
  };
}
