#!/usr/bin/env node
// Performance bench for porto-3d: Playwright + CDP, one synthetic device class
// per run (perf/profiles.json), against a build served by
// scripts/perf-serve.mjs (brotli like Vercel).
//
//   node scripts/perf-bench.mjs                         all profiles, core scenarios
//   node scripts/perf-bench.mjs --profiles desktop-gpu,phone-low
//   node scripts/perf-bench.mjs --reduced               desktop-gpu + phone-low, short paths (npm run perf)
//   node scripts/perf-bench.mjs --analysis              + layer sweep, CPU/GPU split, resolution sweep
//   node scripts/perf-bench.mjs --cpuprofile http://localhost:5191/   sampled main-thread profile (dev server)
//   node scripts/perf-bench.mjs --bytes                 shipped files by size and by gzip/brotli
//   --out file.json   --url http://localhost:5192/   --check (compare to perf/budgets.json)
//
// What is real and what is emulated is written next to each profile in
// perf/profiles.json and in perf/BASELINE.md. The GPU here is an Apple M1 Max:
// frame times are real for that GPU only. The bench is honest about that: a
// profile can slow the machine down, never speed it up.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const URL_BASE = opt('url', 'http://localhost:5192/');
const OUT = opt('out', '/tmp/perf/bench.json');
const REDUCED = flag('reduced');
const ANALYSIS = flag('analysis');
const PROFILES = JSON.parse(readFileSync(join(ROOT, 'perf/profiles.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error('[bench]', ...a);

// ------------------------------------------------------------------ bytes by file
function bytesReport() {
  const dist = join(ROOT, 'dist');
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(dist);
  const textual = /\.(js|css|json|html|svg|txt|xml|webmanifest)$/;
  const rows = files.map((p) => {
    const raw = statSync(p).size;
    let gz = raw;
    let br = raw;
    if (textual.test(p) && raw > 512) {
      const buf = readFileSync(p);
      gz = gzipSync(buf, { level: 9 }).length;
      br = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: raw > 4e6 ? 9 : 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw } }).length;
    }
    return { file: relative(dist, p), raw, gzip: gz, brotli: br };
  });
  const sum = (k, f = () => true) => rows.filter(f).reduce((a, r) => a + r[k], 0);
  const group = (name, re) => ({ name, files: rows.filter((r) => re.test(r.file)).length, raw: sum('raw', (r) => re.test(r.file)), brotli: sum('brotli', (r) => re.test(r.file)) });
  return {
    total: { files: rows.length, raw: sum('raw'), gzip: sum('gzip'), brotli: sum('brotli') },
    groups: [
      group('static (js, css, workers)', /^static\//),
      group('data/*.json (top level)', /^data\/[^/]+\.json$/),
      group('data/tiles*', /^data\/tiles/),
      group('data/gtfs and other data', /^data\/(?!tiles)(?![^/]+\.json$)/),
      group('assets/img', /^assets\/img\//),
      group('assets/pano', /^assets\/pano\//),
      group('og, icons, p', /^(og|icons|p)\//),
    ],
    topByRaw: rows.slice().sort((a, b) => b.raw - a.raw).slice(0, 20),
    topByBrotli: rows.slice().sort((a, b) => b.brotli - a.brotli).slice(0, 20),
  };
}

// ------------------------------------------------------------------ playwright
async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'playwright'].filter(Boolean);
  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    candidates.push(join(root, '@playwright/cli/node_modules/playwright-core/index.mjs'), join(root, 'playwright-core/index.mjs'));
  } catch {
    // no global npm
  }
  for (const c of candidates) {
    try {
      const mod = await import(c.startsWith('/') ? pathToFileURL(c).href : c);
      if (mod.chromium || mod.default?.chromium) return mod.chromium || mod.default.chromium;
    } catch {
      // next candidate
    }
  }
  throw new Error('playwright-core not found (set PLAYWRIGHT_CORE)');
}
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  if (!existsSync(cache)) return undefined;
  const dir = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  if (!dir) return undefined;
  const sub = readdirSync(join(cache, dir)).find((d) => d.startsWith('chrome-headless-shell'));
  const exe = sub && join(cache, dir, sub, 'chrome-headless-shell');
  return exe && existsSync(exe) ? exe : undefined;
}

const GPU_ARGS = {
  metal: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--enable-webgl'],
  swiftshader: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
};

// a hidden worker that keeps the GPU busy: competes with the page for the same GPU
const gpuLoadScript = (cfg) => `
(() => {
  const src = \`
    let gl, n = 0;
    onmessage = (e) => {
      const c = new OffscreenCanvas(e.data.size, e.data.size);
      gl = c.getContext('webgl2');
      const vs = '#version 300 es\\\\nin vec2 p;out vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0,1);}';
      const fs = '#version 300 es\\\\nprecision highp float;in vec2 uv;out vec4 o;uniform float t;void main(){float a=t;vec2 q=uv;for(int i=0;i<' + e.data.iterations + ';i++){a=sin(a*1.3+q.x*7.1)+cos(q.y*5.3-a);q=fract(q*1.7+a*.1);}o=vec4(q,a,1);}';
      const sh = (ty, s) => { const x = gl.createShader(ty); gl.shaderSource(x, s); gl.compileShader(x); return x; };
      const pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(pr); gl.useProgram(pr);
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
      const l = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0);
      const tl = gl.getUniformLocation(pr, 't');
      const loop = () => { gl.uniform1f(tl, n++ * .01); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.finish(); setTimeout(loop, 0); };
      loop();
    };
  \`;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  for (let i = 0; i < ${cfg.workers}; i++) { const w = new Worker(url); w.postMessage({ size: ${cfg.size}, iterations: ${cfg.iterations} }); }
})();`;

async function newSession(chromium, prof, { extraArgs = [], pageUrl = URL_BASE, throttleLoad = true, unlimited = false } = {}) {
  // Default: the 60 Hz display cap, what a user sees. The analysis session is
  // uncapped (the cap would clamp every frame to 16.7 ms and hide the cost of
  // the frame): fps = 1000 / mean frame ms.
  const uncapped = unlimited ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : [];
  const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: [...GPU_ARGS[prof.gpu], ...uncapped, ...extraArgs] });
  const ctx = await browser.newContext({
    viewport: prof.viewport,
    deviceScaleFactor: prof.dpr,
    hasTouch: !!prof.touch,
    isMobile: !!prof.mobile,
    // A service worker would answer the data fetches itself and hide their
    // bytes from the page's network log; the cold and warm numbers measure
    // the network and the HTTP cache. --sw lets it run (offline tests do).
    serviceWorkers: flag('sw') ? 'allow' : 'block',
  });
  const pageJs = readFileSync(join(ROOT, 'scripts/perf-page.js'), 'utf8');
  await ctx.addInitScript(pageJs);
  if (prof.deviceMemory) await ctx.addInitScript(`Object.defineProperty(Navigator.prototype,'deviceMemory',{get:()=>${prof.deviceMemory},configurable:true});`);
  if (prof.hardwareConcurrency) await ctx.addInitScript(`Object.defineProperty(Navigator.prototype,'hardwareConcurrency',{get:()=>${prof.hardwareConcurrency},configurable:true});`);
  if (prof.gpuLoad) await ctx.addInitScript(gpuLoadScript(prof.gpuLoad));
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const net = { reqs: new Map(), done: [], t0: 0, failed: [] };
  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');
  if (prof.network && throttleLoad) {
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: prof.network.latencyMs,
      downloadThroughput: (prof.network.downloadKbps * 1000) / 8,
      uploadThroughput: (prof.network.uploadKbps * 1000) / 8,
    });
  }
  if (prof.cpuThrottle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.cpuThrottle });
  cdp.on('Network.requestWillBeSent', (e) => net.reqs.set(e.requestId, { url: e.request.url, type: e.type, t: Date.now() }));
  cdp.on('Network.responseReceived', (e) => {
    const r = net.reqs.get(e.requestId);
    if (r) Object.assign(r, { status: e.response.status, cache: e.response.fromDiskCache || e.response.fromPrefetchCache ? 'disk' : e.response.fromServiceWorker ? 'sw' : 'net', enc: e.response.headers?.['content-encoding'] || e.response.headers?.['Content-Encoding'] || 'identity', mime: e.response.mimeType });
  });
  cdp.on('Network.loadingFinished', (e) => {
    const r = net.reqs.get(e.requestId);
    if (r) net.done.push({ ...r, bytes: e.encodedDataLength, tEnd: Date.now() });
  });
  cdp.on('Network.loadingFailed', (e) => {
    const r = net.reqs.get(e.requestId);
    if (r && !e.canceled) net.failed.push(r.url);
  });
  const errors = [];
  // /api/* (live aircraft, route lookup, guide) only exists on Vercel: a 404
  // there is expected against the static server and is not an error here
  const isApi = (u) => /\/api\//.test(u || '');
  page.on('console', (m) => {
    if (m.type() === 'error' && !isApi(m.location()?.url)) errors.push(`console: ${m.text().slice(0, 240)}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 240)}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && !isApi(r.url())) errors.push(`http ${r.status()}: ${r.url()}`);
  });
  const metrics = async () => {
    const { metrics: m } = await cdp.send('Performance.getMetrics');
    return Object.fromEntries(m.map((x) => [x.name, x.value]));
  };
  return { browser, ctx, page, cdp, net, errors, metrics, prof, url: pageUrl };
}

function netSummary(net, sinceIdx = 0, cutoff = Infinity) {
  const rows = net.done.slice(sinceIdx).filter((r) => r.tEnd <= cutoff);
  const by = {};
  let total = 0;
  let cached = 0;
  for (const r of rows) {
    const k = /\.js(\?|$)/.test(r.url) ? 'js' : /\.css/.test(r.url) ? 'css' : /\/data\/.*\.json/.test(r.url) ? 'data' : /\.(png|jpe?g|webp|avif|gif|svg|ico)/.test(r.url) ? 'image' : r.type === 'Document' ? 'html' : 'other';
    const b = r.cache === 'net' ? r.bytes : 0;
    by[k] = by[k] || { requests: 0, bytes: 0 };
    by[k].requests++;
    by[k].bytes += b;
    total += b;
    if (r.cache !== 'net') cached++;
  }
  const top = rows
    .filter((r) => r.cache === 'net')
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 8)
    .map((r) => ({ url: r.url.replace(/^https?:\/\/[^/]+/, ''), kb: Math.round(r.bytes / 1024), enc: r.enc }));
  return { requests: rows.length, fromCache: cached, transferKB: Math.round(total / 1024), byType: by, top };
}

async function waitReady(s, timeoutMs) {
  try {
    await s.page.waitForFunction(() => window.__porto?.ready === true, null, { timeout: timeoutMs, polling: 500 });
    return true;
  } catch {
    return false;
  }
}

async function loadTimings(s, tStartWall) {
  return s.page.evaluate((wall) => {
    const P = window.__porto || {};
    const paint = Object.fromEntries(performance.getEntriesByType('paint').map((e) => [e.name, Math.round(e.startTime)]));
    const nav = performance.getEntriesByType('navigation')[0];
    const lt = window.__bench.longtasks;
    const readyAt = P.timing?.ready ?? Infinity;
    const pre = lt.filter((x) => x[0] < readyAt);
    return {
      marks: P.timing || null,
      firstContentfulPaint: paint['first-contentful-paint'] ?? null,
      domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      longTasksToReady: { count: pre.length, totalMs: pre.reduce((a, x) => a + x[1], 0), tbtMs: pre.reduce((a, x) => a + Math.max(0, x[1] - 50), 0), maxMs: pre.reduce((a, x) => Math.max(a, x[1]), 0) },
      tier: P.tier || null,
      wallMs: Date.now() - wall,
      heapMB: window.__bench.heapMB(),
    };
  }, tStartWall);
}

// ------------------------------------------------------------------ scenarios
async function scenarios(s, { reduced, analysisGpu = false }) {
  const { page } = s;
  const out = {};
  const holdMs = reduced ? 4000 : 10000;
  const cinemaMs = reduced ? 6000 : 20000;
  const orbitMs = reduced ? 4000 : 10000;
  const flightS = reduced ? 3 : 6;
  const busy = async (fn) => {
    const m0 = await s.metrics();
    const t0 = Date.now();
    const r = await fn();
    const m1 = await s.metrics();
    const wall = (Date.now() - t0) / 1000;
    const d = (k) => (m1[k] - m0[k]) * 1000;
    if (r && typeof r === 'object') {
      r.mainThread = {
        taskMsPerFrame: r.frames ? +(d('TaskDuration') / r.frames).toFixed(2) : null,
        scriptMsPerFrame: r.frames ? +(d('ScriptDuration') / r.frames).toFixed(2) : null,
        layoutStyleMsPerFrame: r.frames ? +((d('LayoutDuration') + d('RecalcStyleDuration')) / r.frames).toFixed(2) : null,
        busyPct: +((100 * d('TaskDuration')) / (wall * 1000)).toFixed(1),
      };
      r.heapMB = await page.evaluate(() => window.__bench.heapMB());
    }
    return r;
  };
  await page.evaluate(() => {
    window.__bench.hook();
    window.__bench.saveHome();
  });
  const gpu = analysisGpu;

  // 1. overview hold
  await sleep(2500);
  out.overview = await busy(() => page.evaluate(([ms, g]) => window.__bench.sample(ms, { gpu: g, minFrames: 30 }), [holdMs, gpu]));
  out.gpuMemory = await page.evaluate(() => ({ ...window.__bench.gpuEstimate(), gl: window.__bench.glMB() }));

  // 2. fly overview -> Clerigos
  const cl = [41.14563, -8.61456, 60, 70, 140, 40];
  out.flyClerigos = await busy(() =>
    page.evaluate(
      async ([pose, dur, g]) => {
        const B = window.__bench;
        const p = B.pose(...pose);
        const f0 = window.__porto.flights;
        const done = () => window.__porto.flights > f0;
        window.__porto.rig.flyTo(p.pos, p.target, dur);
        const r = await B.sample(0, { gpu: g, until: (n, t) => done() || t > 60000 });
        r.landed = done();
        return r;
      },
      [cl, flightS, gpu],
    ),
  );
  await sleep(2500);
  out.clerigosHold = await busy(() => page.evaluate(([g]) => window.__bench.sample(3000, { gpu: g, minFrames: 30 }), [gpu]));
  out.clerigosMemory = await page.evaluate(() => ({ ...window.__bench.gpuEstimate(), gl: window.__bench.glMB() }));

  // 3. orbit in the Ribeira
  await page.evaluate(async (pose) => {
    const B = window.__bench;
    await B.flyAndWait(B.pose(...pose), 1.5, 60000);
  }, [41.14075, -8.61298, 110, 55, 150, 10]);
  await sleep(3500);
  out.orbitRibeira = await busy(() =>
    page.evaluate(
      ([ms, g]) => {
        const B = window.__bench;
        return B.sample(ms, { gpu: g, minFrames: 30, onFrame: B.orbit(14) });
      },
      [orbitMs, gpu],
    ),
  );
  await page.evaluate(() => window.__bench.goHome(1.2));
  await sleep(2000);

  // 4. cinema
  const started = await page.evaluate(() => {
    const b = document.getElementById('cinema-toggle');
    if (!b) return false;
    b.click();
    return true;
  });
  if (started) {
    await sleep(2500);
    out.cinema = await busy(() => page.evaluate(([ms, g]) => window.__bench.sample(ms, { gpu: g, minFrames: 30 }), [cinemaMs, gpu]));
    out.cinema.active = await page.evaluate(() => !!window.__porto.cinema?.active);
    await page.evaluate(() => window.__porto.cinema?.stop());
    await sleep(800);
    await page.evaluate(() => window.__bench.goHome(0.8));
  }
  out.final = await page.evaluate(() => ({ governor: window.__porto.governor, frameMs: window.__porto.frameMs, heapMB: window.__bench.heapMB(), tier: window.__porto.tier }));
  return out;
}

// ------------------------------------------------------------------ analysis
async function analysis(s) {
  const { page } = s;
  const out = { views: {} };
  const views = {
    overview: null,
    ribeira: [41.14075, -8.61298, 110, 55, 150, 10],
  };
  await page.evaluate(() => {
    window.__bench.hook();
    window.__bench.saveHome();
  });
  // GPU timer queries (EXT_disjoint_timer_query_webgl2) exist on this Chrome
  // but returned 10x the frame interval on ANGLE/Metal, so they are off:
  // GPU-bound vs CPU-bound comes from uncapped frame time, the render no-op
  // run and the resolution sweep instead.
  const meas = (ms = 1800, gpu = false) => page.evaluate(([m, g]) => window.__bench.sample(m, { gpu: g }), [ms, gpu]);
  const brief = (r) => ({ frameMs: r.frameMs.mean, p95: r.frameMs.p95, gpuMs: r.gpuMsPerFrame, renderCpuMs: r.renderCpuMsPerFrame, calls: r.calls.mean, tris: Math.round(r.tris.mean) });
  for (const [vname, pose] of Object.entries(views)) {
    log('analysis view', vname);
    if (pose) await page.evaluate(async (p) => window.__bench.flyAndWait(window.__bench.pose(...p), 1.2, 60000), pose);
    else await page.evaluate(() => window.__bench.goHome(1));
    await sleep(3500);
    const v = {};
    const layerNames = await page.evaluate(() => window.__bench.layerNames);
    v.baseline = brief(await meas(2500));
    v.layers = {};
    // A/B/A: baseline, feature off, baseline again. The delta is against the
    // mean of the two baselines, so drift (thermals, tile streaming) shows up
    // as `noiseMs` instead of as a fake saving.
    const abTest = async (off, on, settle = 500) => {
      const a1 = brief(await meas(2200));
      await off();
      await sleep(settle);
      const b = brief(await meas(2200));
      await on();
      await sleep(settle);
      const a2 = brief(await meas(2200));
      const base = (a1.frameMs + a2.frameMs) / 2;
      return { frameMs: b.frameMs, p95: b.p95, baseMs: +base.toFixed(2), dFrameMs: +(base - b.frameMs).toFixed(2), noiseMs: +Math.abs(a1.frameMs - a2.frameMs).toFixed(2), dTris: Math.round((a1.tris + a2.tris) / 2 - b.tris), dCalls: Math.round((a1.calls + a2.calls) / 2 - b.calls) };
    };
    for (const name of layerNames) {
      let n = 0;
      const r = await abTest(
        async () => { n = await page.evaluate((nm) => window.__bench.setLayer(nm, false), name); },
        async () => { await page.evaluate((nm) => window.__bench.setLayer(nm, true), name); },
        300,
      );
      v.layers[name] = { nodes: n, ...r };
    }
    // shadow pass: the sun stops casting (shaders recompile once, hence the long settle)
    v.shadowPassOff = await abTest(
      async () => { await page.evaluate(() => { window.__porto.atmosphere.sun.castShadow = false; }); },
      async () => { await page.evaluate(() => { window.__porto.atmosphere.sun.castShadow = true; }); },
      1500,
    );
    // post fx stack (composer) off
    const fxWas = await page.evaluate(() => window.__porto.fx?.enabled);
    if (fxWas) {
      v.postFxOff = await abTest(
        async () => { await page.evaluate(() => document.getElementById('fx-toggle')?.click()); },
        async () => { await page.evaluate(() => document.getElementById('fx-toggle')?.click()); },
        1500,
      );
    }
    // labels: hide the CSS2D layer (style, layout and paint saved; the JS stays)
    const hadLabels = await page.evaluate(() => !!window.__bench.labelLayer());
    if (hadLabels) {
      v.labelsHidden = await abTest(
        async () => { await page.evaluate(() => { window.__bench.labelLayer().style.display = 'none'; }); },
        async () => { await page.evaluate(() => { window.__bench.labelLayer().style.display = ''; }); },
        500,
      );
    }
    // resolution sweep at a fixed view: frame time vs pixels
    const dprs = [0.5, 0.75, 1, 1.5, 2];
    const vp = s.prof.viewport;
    v.resolution = [];
    for (const d of dprs) {
      await s.cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width + 1, height: vp.height, deviceScaleFactor: d, mobile: false });
      await sleep(250);
      await s.cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: d, mobile: false });
      await sleep(1500);
      const dim = await page.evaluate(() => [window.__porto.renderer.domElement.width, window.__porto.renderer.domElement.height]);
      const r = brief(await meas(2000, false));
      v.resolution.push({ dpr: d, canvas: dim, mpix: +((dim[0] * dim[1]) / 1e6).toFixed(2), ...r });
    }
    await s.cdp.send('Emulation.clearDeviceMetricsOverride');
    await sleep(1500);
    // CPU-only frame: every renderer.render call becomes a 1-pixel scissored
    // clear (the canvas stays dirty, so Chrome keeps the uncapped cadence).
    // frameMs here is update + labels + simulation + GL-free JS; the rest of
    // the real frame is draw submission and GPU time.
    v.renderSkipped = await abTest(
      async () => {
        await page.evaluate(() => {
          const r = window.__porto.renderer;
          const gl = r.getContext();
          window.__bench.keepRender = r.render;
          r.render = () => { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, 1, 1); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.disable(gl.SCISSOR_TEST); };
        });
      },
      async () => {
        await page.evaluate(() => { const r = window.__porto.renderer; r.render = window.__bench.keepRender; r.resetState(); });
      },
      800,
    );
    // frame ms = fixed + perMpix * mpix, fitted on the three largest sizes
    // (the GPU-bound end); the fixed part is geometry, draw calls and JS
    const pts = v.resolution.slice(-3);
    {
      const n = pts.length;
      const sx = pts.reduce((a, p) => a + p.mpix, 0);
      const sy = pts.reduce((a, p) => a + p.frameMs, 0);
      const sxx = pts.reduce((a, p) => a + p.mpix * p.mpix, 0);
      const sxy = pts.reduce((a, p) => a + p.mpix * p.frameMs, 0);
      const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
      const a = (sy - b * sx) / n;
      const full = pts[pts.length - 1];
      v.resolutionFit = { fixedMs: +a.toFixed(2), msPerMpix: +b.toFixed(2), pixelBoundSharePctAtFull: +((100 * b * full.mpix) / full.frameMs).toFixed(0) };
    }
    out.views[vname] = v;
  }
  return out;
}

// ------------------------------------------------------------------ cpu profile
// Self time per function and per module from a V8 CPU profile. Run it against
// the dev server (unminified names, one file per module).
function aggregate(profile) {
  const self = new Map();
  const byNode = new Map(profile.nodes.map((n) => [n.id, n]));
  const total = profile.timeDeltas.reduce((a, b) => a + b, 0);
  profile.samples.forEach((id, i) => {
    const f = byNode.get(id).callFrame;
    const file = (f.url || '(native)').replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '');
    const key = `${f.functionName || '(anonymous)'} @ ${file.split('/').slice(-2).join('/')}:${f.lineNumber}`;
    self.set(key, (self.get(key) || 0) + (profile.timeDeltas[i] || 0));
  });
  const byFile = new Map();
  for (const [k, v] of self) {
    const file = (k.split(' @ ')[1] || '').replace(/:\d+$/, '');
    const cat = /three|vite\/deps/.test(file) ? 'three.js (renderer, math, CSS2D)' : /^(program|idle)/.test(k) || k.startsWith('(') ? k.split(' @ ')[0] : `src/${file.split('/').pop()}`;
    byFile.set(cat, (byFile.get(cat) || 0) + v);
  }
  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ name: k, pct: +((100 * v) / total).toFixed(1), ms: +(v / 1000).toFixed(0) }));
  return { totalMs: Math.round(total / 1000), byModule: top(byFile, 16), topFunctions: top(self, 25) };
}

async function cpuProfile(chromium, prof, url) {
  const s = await newSession(chromium, prof, { pageUrl: url });
  const { page, cdp } = s;
  const result = {};
  // load phase: from navigation to ready, main thread only
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  await cdp.send('Profiler.start');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const ok = await waitReady(s, 240000);
  if (!ok) log('cpuprofile: ready timed out');
  result.load = aggregate((await cdp.send('Profiler.stop')).profile);
  await sleep(3000);
  await page.evaluate(() => { window.__bench.hook(); window.__bench.saveHome(); });
  const views = { overview: null, ribeira: [41.14075, -8.61298, 110, 55, 150, 10] };
  for (const [name, pose] of Object.entries(views)) {
    if (pose) await page.evaluate(async (p) => window.__bench.flyAndWait(window.__bench.pose(...p), 1.2, 60000), pose);
    else await page.evaluate(() => window.__bench.goHome(1));
    await sleep(4000);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    await cdp.send('Profiler.start');
    await page.evaluate(() => window.__bench.sample(8000, { gpu: false, onFrame: name === 'x' ? null : undefined }));
    const { profile } = await cdp.send('Profiler.stop');
    result[name] = aggregate(profile);
  }
  await s.browser.close();
  return result;
}

// ------------------------------------------------------------------ one profile
async function runProfile(chromium, name, prof, { reduced, withAnalysis }) {
  log('profile', name, reduced ? '(reduced)' : '');
  const res = { profile: name, label: prof.label, real: prof.real, emulated: prof.emulated, startedAt: new Date().toISOString() };
  const s = await newSession(chromium, prof);
  const wall0 = Date.now();
  await s.page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
  const ok = await waitReady(s, prof.readyTimeoutMs);
  const tReady = Date.now();
  res.readyReached = ok;
  res.cold = { ...(await loadTimings(s, wall0).catch(() => ({}))), ...netSummary(s.net, 0, tReady + 50) };
  res.cold.bytesAtReadyKB = res.cold.transferKB;
  if (!ok) {
    res.errors = [...new Set(s.errors)].slice(0, 20);
    res.note = 'ready not reached within the timeout; scenarios skipped';
    await s.browser.close();
    return res;
  }
  await sleep(10000);
  res.cold.after10sKB = netSummary(s.net).transferKB;
  {
    // live JS heap after a full GC (performance.memory also counts garbage)
    await s.cdp.send('HeapProfiler.enable');
    await s.cdp.send('HeapProfiler.collectGarbage');
    const u = await s.cdp.send('Runtime.getHeapUsage');
    res.cold.jsHeapRetainedMB = Math.round(u.usedSize / 1048576);
  }
  res.cold.failedRequests = [...new Set(s.net.failed)].slice(0, 10);
  res.scenarios = await scenarios(s, { reduced, analysisGpu: false });
  res.cold.afterScenariosKB = netSummary(s.net).transferKB;

  // warm: same context, HTTP cache and service worker populated
  const idx = s.net.done.length;
  const w0 = Date.now();
  await s.page.reload({ waitUntil: 'domcontentloaded' });
  const wok = await waitReady(s, prof.readyTimeoutMs);
  res.warm = { readyReached: wok, ...(wok ? await loadTimings(s, w0).catch(() => ({})) : {}), ...netSummary(s.net, idx, Date.now() + 50) };
  res.errors = [...new Set(s.errors)].slice(0, 30);
  await s.browser.close();
  if (withAnalysis) {
    // a second, uncapped session: the frame cost without the 60 Hz clamp
    const u = await newSession(chromium, prof, { unlimited: true, throttleLoad: false });
    await u.page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
    if (await waitReady(u, prof.readyTimeoutMs)) {
      await sleep(3000);
      res.capacity = await scenarios(u, { reduced: true, analysisGpu: false });
      res.analysis = await analysis(u);
    }
    await u.browser.close();
  }
  return res;
}

// ------------------------------------------------------------------ server
// The bench serves dist/ itself (brotli like Vercel) unless something already
// answers on the URL. It never shares a port with `vite preview`, so
// smoke-console and the bench run one after the other.
async function ensureServer() {
  if (flag('no-serve')) return null;
  const u = new URL(URL_BASE);
  if (!/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return null;
  try {
    if ((await fetch(URL_BASE)).ok) {
      log('using the server already on', URL_BASE);
      return null;
    }
  } catch {
    // nothing there: start one
  }
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [join(ROOT, 'scripts/perf-serve.mjs'), u.port || '80', ...(opt('root') ? ['--root', opt('root')] : [])], { stdio: ['ignore', 'pipe', 'inherit'] });
  process.on('exit', () => child.kill());
  await new Promise((res, rej) => {
    child.stdout.on('data', (d) => String(d).includes('cache warm') && res());
    child.on('exit', () => rej(new Error('perf-serve exited')));
    setTimeout(() => rej(new Error('perf-serve warm-up timed out')), 180000);
  });
  return child;
}

// ------------------------------------------------------------------ main
async function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  const server = flag('bytes') ? null : await ensureServer();
  try {
    await run();
  } finally {
    server?.kill();
  }
}
async function run() {
  if (flag('bytes')) {
    const r = bytesReport();
    writeFileSync(OUT, JSON.stringify(r, null, 2));
    log('wrote', OUT);
    return;
  }
  const chromium = await loadPlaywright();
  const cpuUrl = opt('cpuprofile');
  if (cpuUrl) {
    const name = opt('profiles', 'desktop-gpu');
    const r = await cpuProfile(chromium, PROFILES[name], cpuUrl);
    writeFileSync(OUT, JSON.stringify({ profile: name, cpuprofile: r }, null, 2));
    log('wrote', OUT);
    return;
  }
  const names = (opt('profiles') ? opt('profiles').split(',') : REDUCED ? ['desktop-gpu', 'phone-low'] : Object.keys(PROFILES).filter((k) => !k.startsWith('_')));
  const results = {};
  for (const n of names) {
    if (!PROFILES[n]) throw new Error(`unknown profile ${n}`);
    try {
      results[n] = await runProfile(chromium, n, PROFILES[n], { reduced: REDUCED, withAnalysis: ANALYSIS });
    } catch (e) {
      results[n] = { profile: n, error: String(e.stack || e).slice(0, 600) };
      log('profile failed', n, e.message);
    }
    writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), url: URL_BASE, results }, null, 2));
  }
  log('wrote', OUT);
}
main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
