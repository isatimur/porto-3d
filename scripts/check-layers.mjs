#!/usr/bin/env node
// Browser check of the Layers panel and the status pill (plain Playwright).
// Ported from braga-3d (from lisboa-3d) through arouca-3d, adapted to Porto. Needs a running
// server on the production build, best the repo's own static brotli server:
//
//   npm run build && node scripts/perf-serve.mjs 5762
//   node scripts/check-layers.mjs --url http://localhost:5762/ [--out output/layers-check] [--size 1440x900]
//
// 1. ?layers=light: no request of any optional layer (network log of the
//    page and its workers); the routes still load (core).
// 2. For each layer: switch it on in the panel; its files must now be
//    requested (the positive control: a log that sees nothing proves
//    nothing), and it must report loaded, without a reload. The MS buildings
//    switched on while the ring is still off fade in (main.js runs the fade
//    clock without tiles.js).
// 2b. The ring off. Porto's ring street and river lines are objects of the
//    tiles group (tiles.js rebuildLines: not joined to the core's lines, as
//    braga-3d does), so: on, they draw; off, none of them draws, the ring's
//    trees go, and the core's roads and street lines (roads.js) keep exactly
//    their geometry. On again brings the ring lines and trees back.
//    --negative: after the switch-off the tiles group is forced visible
//    again, so the ring-off assertion must fail (the negative control).
// 3. Reload without ?layers: the choice came back from localStorage.
// 4. Ring tiles that fail (aborted by the test) end in a failed status with
//    a Retry button; Retry with the network back loads them.
// 5. Screenshots: the panel, the pill mid-load (tile replies held back),
//    the pill failed with Retry.
// 6. The guided modes: the two history routes (#quest=) and the route
//    fly-along hide the pill and keep the panel shut; a history route opens
//    stop 1 in Light (desktop) and in Compact (phone).
// Exit 1 on any failed assertion or console error.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const BASE = opt('url', 'http://localhost:5762/');
const OUT = opt('out', 'output/layers-check');
const LANG = opt('lang', 'en');
const NEGATIVE = args.includes('--negative');
const [W, H] = opt('size', '1440x900').split('x').map(Number);
const PHONE = W < 600;
mkdirSync(OUT, { recursive: true });

async function loadPlaywright() {
  const c = [process.env.PLAYWRIGHT_CORE, 'playwright-core'].filter(Boolean);
  try {
    c.push(join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '@playwright/cli/node_modules/playwright-core/index.mjs'));
  } catch {
    // no global npm
  }
  for (const p of c) {
    try {
      const m = await import(p.startsWith('/') ? pathToFileURL(p).href : p);
      if (m.chromium || m.default?.chromium) return m.chromium || m.default.chromium;
    } catch {
      // next
    }
  }
  throw new Error('playwright-core not found (set PLAYWRIGHT_CORE)');
}
function chromePath() {
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  if (!existsSync(cache)) return undefined;
  const dir = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const sub = dir && readdirSync(join(cache, dir)).find((d) => d.startsWith('chrome-headless-shell'));
  const exe = sub && join(cache, dir, sub, 'chrome-headless-shell');
  return exe && existsSync(exe) ? exe : undefined;
}

const PATTERNS = {
  ring: /\/data\/tiles\/|\/tile-worker[-.]/,
  ms: /\/data\/(buildings-ms\.json|tiles-ms\/)/,
  live: /\/(liveair|livebus)[-.]|\/data\/gtfs\//,
};

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

const chromium = await loadPlaywright();
const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: PHONE ? 2 : 1, isMobile: PHONE, hasTouch: PHONE, serviceWorkers: 'block' });
// headless Chromium has no voices: a speech engine that "speaks" each utterance at once
await ctx.addInitScript(() => {
  class U {
    constructor(text) {
      this.text = text;
    }
  }
  const voices = [{ name: 'Fake EN', lang: 'en-GB', localService: true, default: true, voiceURI: 'fake-en' }];
  const synth = { speaking: false, pending: false, paused: false, getVoices: () => voices, addEventListener() {}, removeEventListener() {}, cancel() {}, pause() {}, resume() {}, speak(u) { setTimeout(() => u.onstart?.({}), 5); setTimeout(() => u.onend?.({}), 30); } };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: U, configurable: true });
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && !/\/api\//.test(m.location()?.url || '') && errors.push(m.text().slice(0, 200)));
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
const urls = [];
page.on('request', (r) => urls.push(r.url()));
const hits = (id, from = 0) => urls.slice(from).filter((u) => PATTERNS[id].test(u));
const ready = () => page.waitForFunction(() => window.__porto?.ready === true, null, { timeout: 240000 });
const rowState = (id) => page.evaluate((i) => document.querySelector(`.layer-row[data-layer="${i}"]`)?.dataset.state, id);
const waitRow = (id, states, ms = 90000) => page.waitForFunction(([i, s]) => s.includes(document.querySelector(`.layer-row[data-layer="${i}"]`)?.dataset.state), [id, states], { timeout: ms, polling: 200 });
const frames = (n) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const openPanel = async () => {
  if (await page.evaluate(() => window.__porto.layersUI.isOpen)) return;
  await page.evaluate(() => window.__porto.layersUI.open());
  await page.waitForSelector('#layers.is-open');
  // the panel fades in (style.css .atmo, 0.18 s): a screenshot taken at
  // once shows the page through a half-open panel
  await page.waitForFunction(() => getComputedStyle(document.getElementById('layers')).opacity === '1', null, { timeout: 5000 });
};
const sep = BASE.includes('?') ? '&' : '?';
const HASH = '#time=day&weather=clear&live=0';

// ---- 1. light: nothing optional on the wire
await page.goto(`${BASE}${sep}intro=0&lang=${LANG}&layers=light${HASH}`, { waitUntil: 'domcontentloaded' });
await ready();
await page.waitForTimeout(6000); // the ring would start 20 frames after ready
const sel = await page.evaluate(() => window.__porto.layers.selection);
ok(Object.values(sel).every((v) => !v), `light preset: every layer off (${JSON.stringify(sel)})`);
for (const id of Object.keys(PATTERNS)) ok(hits(id).length === 0, `light: no ${id} request (${hits(id).length})`);
const core = await page.evaluate(() => ({ trails: window.__porto.roadSegments?.trails ?? 0, ribbons: window.__porto.roadSegments?.trailTriangles ?? 0, routes: window.__porto.routes?.length ?? 0 }));
// Porto draws no always-on trail ribbons (Arouca does): the routes are the
// Routes list and the line of the route that is open.
const RIBBONS = core.trails > 0;
if (RIBBONS) ok(urls.some((u) => /\/data\/routes\.json/.test(u)) && core.ribbons > 0, `light: the trails are core (routes.json fetched, ${core.trails} trails, ${core.ribbons} ribbon triangles)`);
else ok(urls.some((u) => /\/data\/routes\.json/.test(u)) && core.routes > 0, `light: the routes are core (routes.json fetched, ${core.routes} routes in the list)`);

// ---- 2. switch each layer on in the panel: it loads, no reload
await openPanel();
await page.screenshot({ path: `${OUT}/panel-light-${W}x${H}.png` });
const nav0 = await page.evaluate(() => performance.getEntriesByType('navigation').length + ':' + performance.timeOrigin);
// The streamed layers (ring, MS) have no wave until their index is read and
// their first tiles are asked for (`begun`). Their row must not say loaded
// before that; it is read once the source has begun, its wave has ended and
// the row has settled, all in one poll.
const STREAMED = { ring: 'tiles', ms: 'ms' };
const settledRow = (id, ms = 120000) =>
  page
    .waitForFunction(
      ([i, key]) => {
        const st = document.querySelector(`.layer-row[data-layer="${i}"]`)?.dataset.state;
        if (st !== 'ready' && st !== 'failed') return false;
        if (!key) return st;
        const src = window.__porto[key];
        return src && src.begun === true && !src.wave.snapshot().active ? st : false;
      },
      [id, STREAMED[id] || null],
      { timeout: ms, polling: 100 },
    )
    .then((h) => h.jsonValue(), async () => `not settled in ${ms / 1000} s (row ${await rowState(id)})`);
// the row's states, every frame from the switch-on until the source has begun
const earlyStates = (id) =>
  page.evaluate(
    ([i, key]) =>
      new Promise((res) => {
        const seen = new Set();
        const t0 = performance.now();
        const f = () => {
          const src = window.__porto[key];
          seen.add(document.querySelector(`.layer-row[data-layer="${i}"]`)?.dataset.state);
          if (src?.begun === true || src?.wave.snapshot().active || performance.now() - t0 > 60000) res([...seen]);
          else requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      }),
    [id, STREAMED[id]],
  );
for (const id of ['live', 'ms', 'ring']) {
  const from = urls.length;
  await openPanel();
  const early = STREAMED[id] ? earlyStates(id) : null;
  await page.click(`.layer-switch[data-layer="${id}"]`);
  if (early) {
    const seen = await early;
    ok(!seen.includes('ready'), `${id} on: the row does not say loaded before its first tiles are asked for (${seen.join(' -> ')})`);
  }
  const st = await settledRow(id);
  ok(hits(id, from).length > 0, `${id} on: its files are requested now (${hits(id, from).length}, e.g. ${(hits(id, from)[0] || '').replace(/^https?:\/\/[^/]+/, '')})`);
  ok(st === 'ready', `${id} on: panel says loaded (state ${st})`);
  if (id === 'ms') {
    // the ring is still off (no tiles.js), so main.js runs the fade clock
    // the MS buildings read; without it they never fade in
    const a = await page.evaluate(() => ({ clock: window.__porto.buildingClock(), tiles: !!window.__porto.tiles, core: window.__porto.msStats.coreTiles }));
    await frames(30);
    const b = await page.evaluate(() => window.__porto.buildingClock());
    ok(!a.tiles && a.core > 0 && b > a.clock, `ms on with the ring off: ${a.core} core blocks, the fade clock runs (${a.clock.toFixed(2)} -> ${b.toFixed(2)} s)`);
  }
}
const nav1 = await page.evaluate(() => performance.getEntriesByType('navigation').length + ':' + performance.timeOrigin);
ok(nav0 === nav1, 'no page reload while switching layers');
await page.screenshot({ path: `${OUT}/panel-full-${W}x${H}.png` });

// ---- 2b. the ring off: its lines and trees go; the core's roads and trails stay
{
  const state = () =>
    page.evaluate(() => {
      const P = window.__porto;
      const shown = (o) => {
        for (let a = o; a; a = a.parent) if (!a.visible) return false;
        return true;
      };
      const ringLines = [];
      P.tiles?.group.traverse((o) => o.isLineSegments2 && /^tiles-road-/.test(o.name) && ringLines.push({ name: o.name, shown: shown(o), segs: o.geometry.attributes.instanceStart?.count ?? 0 }));
      // the core's road layer (roads.js; chunk-geo.js cells): every geometry
      // size, in traversal order, as one signature
      const sig = [];
      P.scene.getObjectByName('roads')?.traverse((o) => {
        if (!o.geometry) return;
        const g = o.geometry;
        sig.push(`${o.name}:${g.attributes.instanceStart?.count ?? g.index?.count ?? g.attributes.position?.count ?? 0}`);
      });
      const ribbons = P.scene.getObjectByName('trail-ribbons');
      return { ringLines, coreSig: sig.join('|'), coreObjects: sig.length, trails: ribbons ? shown(ribbons) : null, trees: P.nature?.stream ?? 0, group: P.tiles?.group.visible ?? null };
    });
  // the ring's lines and trees arrive a second or so after their tiles
  await page.waitForFunction(() => { let n = 0; window.__porto.tiles?.group.traverse((o) => o.isLineSegments2 && /^tiles-road-/.test(o.name) && n++); return n > 0 && (window.__porto.nature?.stream ?? 0) > 0; }, null, { timeout: 60000, polling: 250 }).catch(() => {});
  await page.evaluate(() => window.__porto.layersUI.close());
  await frames(10);
  const on1 = await state();
  const drawn = (s) => s.ringLines.filter((l) => l.shown && l.segs > 0);
  // the positive control: with the ring on, its lines draw
  ok(drawn(on1).length > 0, `ring on: the ring's street and river lines draw (${drawn(on1).map((l) => `${l.name} ${l.segs}`).join(', ')})`);
  if (RIBBONS) ok(on1.trails === true, `ring on: the trail ribbons draw (${on1.trails})`);
  else console.log('n/a   trail ribbons: none on this device class');
  await page.screenshot({ path: `${OUT}/ring-on-${W}x${H}.png` });
  await openPanel();
  await page.click('.layer-switch[data-layer="ring"]');
  if (NEGATIVE) await page.evaluate(() => { window.__porto.tiles.group.visible = true; }); // the negative control
  await page.evaluate(() => window.__porto.layersUI.close());
  await frames(10);
  const off = await state();
  ok(drawn(off).length === 0, `ring off: no ring line draws (${drawn(off).length} of ${off.ringLines.length}; group visible ${off.group})${NEGATIVE ? ' [negative control: must FAIL]' : ''}`);
  ok(off.coreSig === on1.coreSig && off.coreObjects > 0, `ring off: the core's roads, street lines, trails and waymarks keep their geometry (${off.coreObjects} objects, same signature: ${off.coreSig === on1.coreSig})`);
  if (RIBBONS) ok(off.trails === true, `ring off: the trail ribbons still draw (${off.trails})`);
  if (on1.trees > 0) ok(off.trees === 0, `ring off: the ring's trees go (${on1.trees} -> ${off.trees})`);
  else console.log('n/a   ring on: no ring trees in this view');
  await page.screenshot({ path: `${OUT}/ring-off-${W}x${H}.png` });
  await openPanel();
  await page.click('.layer-switch[data-layer="ring"]');
  await waitRow('ring', ['ready', 'failed']).catch(() => {});
  await page.waitForFunction(() => (window.__porto.nature?.stream ?? 0) > 0, null, { timeout: 30000, polling: 200 }).catch(() => {});
  await page.evaluate(() => window.__porto.layersUI.close());
  await frames(10);
  const on2 = await state();
  ok(drawn(on2).length > 0, `ring on again: the ring's lines draw again (${drawn(on2).length})`);
  if (on1.trees > 0) ok(on2.trees > 0, `ring on again: the ring's trees come back (${on2.trees})`);
  await page.screenshot({ path: `${OUT}/ring-on-again-${W}x${H}.png` });
}

// a layer switched off again: hidden, and no more of its requests
{
  await openPanel();
  await page.click('.layer-switch[data-layer="ms"]');
  const vis = await page.evaluate(() => window.__porto.ms.group.visible);
  ok(vis === false, 'ms off again: hidden at once');
  await page.click('.layer-switch[data-layer="ms"]');
  await page.evaluate(() => window.__porto.layersUI.close());
}

// ---- 3. the choice persists (localStorage), without ?layers
const savedSel = await page.evaluate(() => window.__porto.layers.selection);
await page.goto(`${BASE}${sep}intro=0&lang=${LANG}${HASH}`, { waitUntil: 'domcontentloaded' });
await ready();
// a small streamed radius (the governor's own knob), so a camera move
// below reaches tiles that are not loaded yet
await page.waitForFunction(() => !!window.__porto.tiles, null, { timeout: 30000 });
await page.evaluate(() => window.__porto.tiles.setBudgetScale(0.25));
const back = await page.evaluate(() => ({ sel: window.__porto.layers.selection, src: window.__porto.layers.source }));
ok(back.src === 'saved' && JSON.stringify(back.sel) === JSON.stringify(savedSel), `choice restored from localStorage (${back.src}: ${JSON.stringify(back.sel)})`);

// ---- 4 and 5. a camera move: the pill counts the area; failures and retry
{
  // hold tile replies back so the pill can be seen mid-load, and fail some;
  // each reply a little later than the one before (small tiles land together)
  let mode = 'slow';
  let held = 0;
  await ctx.route(/\/data\/tiles\/\d+_\d+\.json/, async (route) => {
    if (mode === 'fail') return route.abort('failed');
    await new Promise((r) => setTimeout(r, 900 + 400 * (held++ % 8)));
    return route.continue();
  });
  const fly = (lat, lon) =>
    page.evaluate(
      async ([la, lo]) => {
        const P = window.__porto;
        const V = P.camera.position.constructor;
        const q = P.project(la, lo);
        const k = P.projection.metresPerUnit;
        const gy = P.heightAt(q.x, q.z);
        const f0 = P.flights;
        P.rig.flyTo(new V(q.x + 300 / k, gy + 900 / k, q.z + 600 / k), new V(q.x, gy, q.z), 0.4);
        const t0 = performance.now();
        while (P.flights === f0 && performance.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 50));
      },
      [lat, lon],
    );
  await page.evaluate(() => window.__porto.layersUI.close());
  await page.evaluate(() => window.__porto.tiles?.idle(60000));
  await fly(41.235, -8.62); // Maia, north of the core (Porto's ring): tiles not yet seen
  const saw = await page
    .waitForFunction(() => { const s = window.__porto.layersUI.status; return s.state === 'loading' && s.id === 'area' && s.done > 0 ? s : false; }, null, { timeout: 15000, polling: 100 })
    .then((h) => h.jsonValue(), () => null);
  ok(!!saw, `camera move: the pill counts this area (${saw?.text})`);
  if (saw) await page.screenshot({ path: `${OUT}/status-midload-${W}x${H}.png` });
  const live = await page.evaluate(() => {
    const el = document.getElementById('load-status-live');
    return { polite: el?.getAttribute('aria-live'), role: el?.getAttribute('role'), text: el?.textContent, inPill: !!el?.closest('#load-status') };
  });
  ok(live.polite === 'polite' && live.role === 'status' && !live.inPill, `a polite live region outside the pill (says "${live.text}")`);
  // prefers-reduced-motion: the loading dot stops pulsing
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const anim = await page.evaluate(() => {
    const pill = document.getElementById('load-status');
    const prev = pill.dataset.state;
    pill.dataset.state = 'loading'; // the pulsing state, for the style check only
    const a = getComputedStyle(pill.querySelector('.ls-dot')).animationName;
    pill.dataset.state = prev;
    return a;
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  ok(anim === 'none', `reduced motion: no pulse on the loading dot (animation ${anim})`);
  await page.waitForFunction(() => window.__porto.layersUI.status.state !== 'loading', null, { timeout: 120000, polling: 200 });
  const after = await page.evaluate(() => window.__porto.layersUI.status);
  ok(after.state === 'done' || after.state === 'idle', `the wave ends: ${after.state} "${after.text}"`);

  // failures: every ring tile request aborts; three tries, then failed + Retry
  mode = 'fail';
  const err0 = await page.evaluate(() => window.__porto.tiles.stats.errors);
  await fly(41.07, -8.52); // south-east of the core (Gaia, towards Avintes)
  // The pill, its Retry button and their boxes are read in the poll that
  // sees the failed state. The state is not final: other tiles of the same
  // move are still between tries, and the pill goes back to loading for
  // them, so a read one round trip later can find Retry hidden again.
  let failedState = null;
  let retryShown = false;
  let box = null;
  try {
    const snap = await page
      .waitForFunction(
        () => {
          const s = window.__porto.layersUI.status;
          const retry = document.querySelector('#load-status .ls-retry');
          if (s.state !== 'failed' || retry.hidden) return false;
          const r = (q) => document.querySelector(q).getBoundingClientRect();
          const tx = document.querySelector('#load-status .ls-text');
          return {
            status: { state: s.state, text: s.text },
            box: { pill: Math.round(r('#load-status').height), retry: Math.round(r('#load-status .ls-retry').height), open: Math.round(r('#load-status .ls-open').height), clipped: tx.scrollHeight > tx.clientHeight + 1 || tx.scrollWidth > tx.clientWidth + 1, right: Math.round(r('#load-status').right), vw: innerWidth },
          };
        },
        null,
        { timeout: 150000, polling: 100 },
      )
      .then((h) => h.jsonValue());
    failedState = snap.status;
    box = snap.box;
    retryShown = true;
  } catch {
    // reported below
  }
  const err1 = await page.evaluate(() => window.__porto.tiles.stats.errors);
  ok(err1 > err0, `the aborts reached the tile loader (errors ${err0} -> ${err1})`);
  ok(failedState?.state === 'failed', `failed tiles: the pill says so (${failedState?.text})`);
  ok(retryShown, 'a Retry button shows');
  if (failedState) await page.screenshot({ path: `${OUT}/status-failed-${W}x${H}.png` });
  // touch targets: 44 px (owner decision), and the failed line shows whole
  if (PHONE && box) {
    ok(box.pill >= 44 && box.retry >= 44 && box.open >= 44, `phone: the pill is ${box.pill} px tall, Retry ${box.retry} px, Layers ${box.open} px`);
    ok(!box.clipped && box.right <= box.vw, `phone: the failed line shows whole, count included (clipped ${box.clipped}, right edge ${box.right} of ${box.vw})`);
  }
  // the network comes back: Retry is pressed once the pill says failed with
  // its button shown and no tile request is in flight
  mode = 'slow';
  await page
    .waitForFunction(() => { const P = window.__porto; return P.layersUI.status.state === 'failed' && !document.querySelector('#load-status .ls-retry').hidden && ![...P.tiles.tiles.values()].some((T) => T.loading); }, null, { timeout: 90000, polling: 100 })
    .catch(() => {});
  // keyboard: Retry is reachable and works with Enter
  await page.focus('#load-status .ls-retry');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__porto.layersUI.status.state !== 'failed', null, { timeout: 30000, polling: 200 });
  await page.waitForFunction(() => window.__porto.layersUI.status.state !== 'loading', null, { timeout: 120000, polling: 200 });
  const stuck = await page.evaluate(() => window.__porto.tiles.stats.stuck);
  ok(stuck === 0, `Retry with the network back: no tile left failed (${stuck})`);
  await ctx.unroute(/\/data\/tiles\/\d+_\d+\.json/);
}

// no layout shift: the pill is fixed
const pos = await page.evaluate(() => getComputedStyle(document.getElementById('load-status')).position);
ok(pos === 'fixed', 'the pill is position: fixed (no layout shift)');

// panel sizes: no text under 12 px, 44 px targets on touch
{
  await openPanel();
  const m = await page.evaluate((phone) => {
    const pop = document.getElementById('layers');
    let minFont = 99;
    let minText = '';
    for (const el of pop.querySelectorAll('*')) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const f = parseFloat(getComputedStyle(el).fontSize);
      if (f < minFont) {
        minFont = f;
        minText = el.textContent.trim().slice(0, 30);
      }
    }
    // a control that is not rendered (hidden, no box) is not a touch target
    const small = phone
      ? [...pop.querySelectorAll('button, .layer-label')]
          .filter((b) => b.getClientRects().length > 0)
          .map((b) => ({ r: b.getBoundingClientRect(), name: `${b.tagName.toLowerCase()}.${b.className} "${b.textContent.trim().slice(0, 20)}"` }))
          // half a pixel of slack: a 44 px box can measure 43.99 at DPR 2
          .filter(({ r }) => r.height < 43.5 || r.width < 43.5)
          .map(({ r, name }) => `${name} ${Math.round(r.width)}x${Math.round(r.height)}`)
      : [];
    return { minFont, minText, small };
  }, PHONE);
  ok(m.minFont >= 12, `panel: no text under 12 px (smallest ${m.minFont} px, «${m.minText}»)`);
  if (PHONE) ok(m.small.length === 0, `phone: every panel button and row is at least 44 px (${m.small.length} smaller${m.small.length ? `: ${m.small.join('; ')}` : ''})`);
  await page.evaluate(() => window.__porto.layersUI.close());
}

// ---- 6. the guided modes in the Light preset: the pill stays out of them
{
  // a phone starts in Compact (class S); the desktop run takes Light
  const preset = PHONE ? 'compact' : 'light';
  for (const route of ['from-the-tower-to-the-river', 'down-to-the-river-and-across']) {
    await page.goto(`${BASE}${sep}intro=0&lang=${LANG}&layers=${preset}#quest=${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__porto?.ready && window.__porto.quest?.active && document.querySelector('.quest-card .quest-btn.is-primary'), null, { timeout: 240000 });
    // a fresh visit: the intro's «Start» opens stop 1
    await page.click('.quest-card .quest-btn.is-primary');
    const atStop = await page
      .waitForFunction(() => window.__porto.quest.state.screen === 'stop' && window.__porto.quest.state.stop === 0, null, { timeout: 30000, polling: 200 })
      .then(() => true, () => false);
    await page.waitForTimeout(1000); // a few pill ticks
    const q = await page.evaluate(() => {
      const P = window.__porto;
      P.layersUI.open(); // refused while a route runs
      const pill = document.getElementById('load-status');
      return { preset: P.layers.preset, pill: getComputedStyle(pill).display, panel: P.layersUI.isOpen, card: !!document.querySelector('.quest-card'), tiles: !!P.tiles, ms: !!P.ms, id: P.quest.state.id };
    });
    const want = preset === 'light' ? !q.tiles && !q.ms : !q.tiles && q.ms;
    ok(q.preset === preset && want, `${route} in ${preset}: the layers of the preset only (ring ${q.tiles}, ms ${q.ms})`);
    ok(q.card && atStop, `${route} in ${preset}: the route card opens stop 1 (${q.id})`);
    ok(q.pill === 'none' && !q.panel, `${route}: the pill is hidden (${q.pill}) and the panel does not open (${q.panel})`);
    await page.screenshot({ path: `${OUT}/route-stop1-${route}-${preset}-${W}x${H}.png` });
  }
  // the route fly-along, outside the history routes (&fly=1: another URL, so
  // this is a real load; a hash-only change would leave the history route open)
  await page.goto(`${BASE}${sep}intro=0&lang=${LANG}&layers=light&fly=1#time=day&weather=clear&live=0`, { waitUntil: 'domcontentloaded' });
  await ready();
  ok(await page.evaluate(() => !document.body.classList.contains('is-quest')), 'the fly-along step starts outside the history routes');
  await page.evaluate(() => window.__porto.openRoute('ribeira-pontes'));
  await frames(20);
  await page.evaluate(() => window.__porto.startTour());
  await page.waitForFunction(() => window.__porto.touring === true, null, { timeout: 10000 });
  await page.waitForTimeout(800);
  const f = await page.evaluate(() => {
    const P = window.__porto;
    P.layersUI.open();
    return { pill: getComputedStyle(document.getElementById('load-status')).display, panel: P.layersUI.isOpen };
  });
  ok(f.pill === 'none' && !f.panel, `route fly-along: the pill is hidden (${f.pill}) and the panel does not open (${f.panel})`);
  await page.evaluate(() => window.__porto.stopTour());
  await frames(20);
  const f2 = await page.evaluate(() => {
    const P = window.__porto;
    P.layersUI.open();
    const r = P.layersUI.isOpen;
    P.layersUI.close();
    return r;
  });
  ok(f2 === true, `after the fly-along: the panel opens again (${f2})`);
}

ok(errors.length === 0, `no console errors (${errors.length})${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
console.log(failures ? `\ncheck-layers: ${failures} FAILED` : '\ncheck-layers: OK');
process.exit(failures ? 1 : 0);
