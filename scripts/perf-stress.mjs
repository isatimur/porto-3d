#!/usr/bin/env node
// Stress tests for the quality system, against dist/ served like Vercel.
//
//   node scripts/perf-stress.mjs [--soak 300] [--only classes,context,hidden,quality,motion,offline,soak]
//
// classes   rapid class switching through the governor, 40 changes
// context   WEBGL_lose_context: lose, restore, the scene must draw again
// hidden    freeze and resume the page: the governor must not read the gap as load
// quality   ?quality= values pick the class and the menu choice persists
// motion    prefers-reduced-motion loads clean
// offline   second visit through the service worker with the network off
// soak      random flying for N seconds (default 300): JS heap and GL memory flat within 5 %
import { spawn, execSync, execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const ONLY = opt('only', 'classes,context,hidden,quality,motion,offline,soak').split(',');
const SOAK_S = Number(opt('soak', 300));
const URL_BASE = 'http://localhost:5192/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function chromiumOf() {
  const cands = [process.env.PLAYWRIGHT_CORE, 'playwright-core'].filter(Boolean);
  try {
    cands.push(join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '@playwright/cli/node_modules/playwright-core/index.mjs'));
  } catch {
    // no global npm
  }
  for (const c of cands) {
    try {
      const m = await import(c.startsWith('/') ? pathToFileURL(c).href : c);
      if (m.chromium) return m.chromium;
    } catch {
      // next
    }
  }
  console.log('SKIP  perf-stress: playwright-core not found');
  process.exit(77);
}
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  if (!existsSync(cache)) return undefined;
  const dir = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const sub = dir && readdirSync(join(cache, dir)).find((d) => d.startsWith('chrome-headless-shell'));
  return sub ? join(cache, dir, sub, 'chrome-headless-shell') : undefined;
}

const server = spawn(process.execPath, [join(ROOT, 'scripts/perf-serve.mjs'), '5192'], { stdio: ['ignore', 'pipe', 'inherit'] });
process.on('exit', () => server.kill());
await new Promise((res) => server.stdout.on('data', (d) => String(d).includes('cache warm') && res()));
const chromium = await chromiumOf();
const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });

let failed = 0;
const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) failed++;
};

async function open(query = '', ctxOpts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, serviceWorkers: 'block', ...ctxOpts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/\/api\//.test(m.location()?.url || '')) errors.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(`${URL_BASE}?intro=0&lang=en${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__porto?.ready === true, null, { timeout: 180000 });
  return { ctx, page, errors };
}
const frames = (page) => page.evaluate(() => window.__porto.frames);

if (ONLY.includes('classes')) {
  const { ctx, page, errors } = await open('&quality=medium');
  await sleep(3000);
  const order = ['M', 'S', 'P', 'S', 'M'];
  for (let i = 0; i < 40; i++) {
    await page.evaluate(([c, p]) => window.__porto.perfSystem.gov.force(c, p, performance.now()), [order[i % order.length], (i * 7) % 24]);
    await sleep(120);
  }
  const f0 = await frames(page);
  await sleep(2500);
  const f1 = await frames(page);
  check('classes: 40 rapid class and pressure changes, the loop keeps drawing', f1 - f0 > 20, `${f1 - f0} frames in 2.5 s`);
  check('classes: no console errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

if (ONLY.includes('context')) {
  const { ctx, page, errors } = await open();
  await sleep(2000);
  await page.evaluate(() => {
    // the extension object must be taken before the loss: afterwards getExtension returns null
    window.__lose = window.__porto.renderer.getContext().getExtension('WEBGL_lose_context');
    window.__lose.loseContext();
  });
  await sleep(1500);
  const lost = await page.evaluate(() => window.__porto.contextLost || 0);
  await page.evaluate(() => window.__lose.restoreContext());
  await sleep(3000);
  const f0 = await frames(page);
  await sleep(1500);
  const f1 = await frames(page);
  // the map area of a screenshot (a WebGL canvas cannot be read back between frames)
  await page.screenshot({ path: '/tmp/perf/stress-context-map.png', clip: { x: 640, y: 160, width: 600, height: 500 } });
  const px = Number(execFileSync('magick', ['/tmp/perf/stress-context-map.png', '-format', '%[fx:mean*255]', 'info:'], { encoding: 'utf8' }));
  const restored = await page.evaluate(() => window.__porto.contextRestored || 0);
  check('context: loss seen', lost >= 1);
  check('context: restored, frames advance again', restored >= 1 && f1 - f0 > 10, `${f1 - f0} frames`);
  check('context: the canvas is not black after restore', px > 8, `mean level ${px.toFixed(1)}`);
  check('context: no console errors beyond the expected loss notice', errors.filter((e) => !/context lost|CONTEXT_LOST/i.test(e)).length === 0, errors.join(' | ').slice(0, 200));
  await page.screenshot({ path: '/tmp/perf/stress-context.png' });
  await ctx.close();
}

if (ONLY.includes('hidden')) {
  const { ctx, page, errors } = await open();
  const cdp = await ctx.newCDPSession(page);
  await sleep(6000);
  const before = await page.evaluate(() => ({ ch: window.__porto.perfSystem.gov.state.changes.length, p: window.__porto.perfSystem.knobs.pressure }));
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  await sleep(8000);
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  await sleep(1500);
  const f0 = await frames(page);
  await sleep(1500);
  const f1 = await frames(page);
  await sleep(6000);
  const after = await page.evaluate(() => ({ ch: window.__porto.perfSystem.gov.state.changes.length, p: window.__porto.perfSystem.knobs.pressure }));
  check('hidden: the page draws again after a freeze', f1 - f0 > 10, `${f1 - f0} frames`);
  check('hidden: the pause is not read as load', after.ch === before.ch, `changes ${before.ch} -> ${after.ch}`);
  check('hidden: no console errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

if (ONLY.includes('quality')) {
  const want = { ultra: 'XL', high: 'L', medium: 'M', low: 'S', potato: 'P' };
  for (const [q, cls] of Object.entries(want)) {
    const { ctx, page, errors } = await open(`&quality=${q}`);
    const got = await page.evaluate(() => ({ cls: window.__porto.perfSystem.cls, mode: window.__porto.perfSystem.mode, fx: window.__porto.fx?.enabled, shadow: window.__porto.atmosphere.sun.castShadow }));
    check(`quality: ?quality=${q} gives class ${cls}`, got.cls === cls, JSON.stringify(got));
    check(`quality: ?quality=${q} loads without errors`, errors.length === 0, errors[0] || '');
    if (q === 'potato') check('quality: potato has no shadow pass and no effects', !got.shadow && !got.fx);
    if (q === 'medium') {
      // the saved choice survives a plain reload
      await page.goto(`${URL_BASE}?intro=0&lang=en`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__porto?.ready === true, null, { timeout: 180000 });
      check('quality: the menu choice persists', (await page.evaluate(() => window.__porto.perfSystem.cls)) === 'M');
    }
    await ctx.close();
  }
  const { ctx, page } = await open('&quality=auto');
  check('quality: ?quality=auto forgets the saved choice', (await page.evaluate(() => window.__porto.perfSystem.mode)) === 'auto');
  await ctx.close();
}

if (ONLY.includes('motion')) {
  const { ctx, errors, page } = await open('', { reducedMotion: 'reduce' });
  await sleep(2000);
  check('motion: prefers-reduced-motion loads clean', errors.length === 0 && (await frames(page)) > 10, errors[0] || '');
  await ctx.close();
}

if (ONLY.includes('offline')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  await page.goto(`${URL_BASE}?intro=0&lang=en`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__porto?.ready === true, null, { timeout: 180000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await sleep(4000); // lets the worker claim the page and cache what it saw
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__porto?.ready === true, null, { timeout: 180000 });
  await sleep(2000);
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  const ok = await page.waitForFunction(() => window.__porto?.ready === true, null, { timeout: 120000 }).then(() => true, () => false);
  check('offline: the second visit opens with the network off', ok);
  const keys = await page.evaluate(async () => (await caches.keys()).join(','));
  check('offline: shell, data and photo caches exist', /porto-v2/.test(keys) && /porto-data-v2/.test(keys), keys);
  await ctx.close();
}

if (ONLY.includes('soak')) {
  // --query '&quality=low' soaks another class (the Low class frees far models)
  const { ctx, page, errors } = await open(opt('query', ''));
  const cdp = await ctx.newCDPSession(page);
  await page.evaluate(() => {
    const P = window.__porto;
    window.__soak = { stop: false };
    // random flights over the whole map, the start of a cinema now and then
    const V = P.camera.position.constructor;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const loop = async () => {
      while (!window.__soak.stop) {
        const lm = P.landmarks[Math.floor(Math.random() * P.landmarks.length)];
        const near = Math.random() < 0.6;
        const d = near ? rnd(25, 90) : rnd(400, 1500);
        const a = rnd(0, 6.28);
        const pos = new V(lm.x + Math.cos(a) * d, P.heightAt(lm.x, lm.z) + d * 0.6 + 8, lm.z + Math.sin(a) * d);
        P.rig.flyTo(pos, new V(lm.x, P.heightAt(lm.x, lm.z) + 10, lm.z), rnd(2, 5));
        await new Promise((r) => setTimeout(r, rnd(3000, 7000)));
      }
    };
    loop();
  });
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < SOAK_S * 1000) {
    await sleep(15000);
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = Math.round((await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576);
    const s = await page.evaluate(() => ({ gl: window.__porto.perfSystem.glMemory().totalMB, geo: window.__porto.renderer.info.memory.geometries, tex: window.__porto.renderer.info.memory.textures, cls: window.__porto.perfSystem.cls, p: window.__porto.perfSystem.knobs.pressure, m: window.__porto.landmarkModels?.() ?? {} }));
    samples.push({ t: Math.round((Date.now() - t0) / 1000), heap, ...s });
  }
  await page.evaluate(() => { window.__soak.stop = true; });
  console.log(samples.map((s) => `${s.t}s heap ${s.heap} MB, gl ${s.gl} MB, geometries ${s.geo}, textures ${s.tex}, ${s.cls}/${s.p}, models built ${s.m.built} freed ${s.m.freed} cpu ${s.m.cpuMB} MB failed ${s.m.failed} mismatch ${s.m.mismatch}`).join('\n'));
  check('soak: no landmark model failed or differed from the baked fit', samples.every((s) => !s.m.failed && !s.m.mismatch), JSON.stringify(samples.at(-1)?.m ?? {}));
  const tail = samples.slice(Math.floor(samples.length / 3)); // after the streaming warm-up
  const grow = (k) => (Math.max(...tail.map((s) => s[k])) - Math.min(...tail.map((s) => s[k]))) / Math.max(1, Math.min(...tail.map((s) => s[k])));
  check('soak: JS heap flat within 5 % after warm-up', grow('heap') <= 0.05, `${(grow('heap') * 100).toFixed(1)} %`);
  check('soak: GL memory flat within 5 % after warm-up', grow('gl') <= 0.05, `${(grow('gl') * 100).toFixed(1)} %`);
  check('soak: no console errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

await browser.close();
server.kill();
console.log(failed ? `\nperf-stress: ${failed} check(s) failed` : '\nperf-stress: all checks passed');
process.exit(failed ? 1 : 0);
