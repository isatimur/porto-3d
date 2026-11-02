#!/usr/bin/env node
// Regression check for "black squares flicker while orbiting" (ported from
// arouca-3d 64f1b4d). Cause: zero-area triangles in a landmark model. At some
// view angles the rasteriser gives such a sliver a few fragments; the stone
// shader's normal goes NaN there and the bloom mips spread the one NaN pixel
// into black squares (on Apple GPUs the whole frame). src/landmarks.js drops
// them from every model (eager, lazy, pieces).
//
// For each place: open #place=<id> with post-processing on, wait for its
// detailed model, then
//   1. geometry (any GPU): no built landmark mesh (pieces included) holds a
//      zero-area triangle, and the place's own model is built and checked;
//   2. pixels (real GPU only): orbit FRAMES frames around the place and read
//      the half-float scene target after every frame; no pixel may be NaN.
//
//   node scripts/smoke-flicker.mjs [--frames 600] [--places teatro-sa-da-bandeira,almeida-garrett] [--dist dir]
//
// The default places hold the most zero-area triangles before the fix.
// On macOS the browser runs ANGLE on Metal (the NaN only shows there); the
// GPU renderer string is printed: a pixel result on SwiftShader proves little.
// Needs dist/ (npm run build) and playwright-core with a Chromium; without
// them it exits 77 (skip). Not part of npm run verify (it takes ~1 min a place).
// Env: PLAYWRIGHT_CORE, CHROME_PATH, SMOKE_PORT (default 5412).
import { spawn, execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SMOKE_PORT || 5412);
const HANDLE = '__porto'; // the app's debug object on window
const SKIP = 77;
const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const FRAMES = Number(arg('frames', 600));
const PLACES = arg('places', 'teatro-sa-da-bandeira,almeida-garrett,paco-episcopal').split(',');
const DEG = 0.6; // orbit step per frame

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'playwright'].filter(Boolean);
  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    candidates.push(join(root, '@playwright/cli/node_modules/playwright-core/index.mjs'), join(root, 'playwright-core/index.mjs'), join(root, 'playwright/index.mjs'));
  } catch {
    // no global npm: the other candidates still apply
  }
  for (const c of candidates) {
    try {
      const mod = await import(c.startsWith('/') ? pathToFileURL(c).href : c);
      if (mod.chromium || mod.default?.chromium) return mod.chromium || mod.default.chromium;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  if (!existsSync(cache)) return undefined;
  const dir = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  if (!dir) return undefined;
  const base = join(cache, dir);
  const sub = readdirSync(base).find((d) => d.startsWith('chrome-headless-shell'));
  const exe = sub && join(base, sub, 'chrome-headless-shell');
  return exe && existsSync(exe) ? exe : undefined;
}

const DIST = arg('dist', join(ROOT, 'dist')); // --dist <dir>: another build
if (!existsSync(join(DIST, 'index.html'))) {
  console.log(`SKIP  smoke-flicker: ${DIST} has no build (run npm run build first)`);
  process.exit(SKIP);
}
const chromium = await loadPlaywright();
if (!chromium) {
  console.log('SKIP  smoke-flicker: playwright-core not found (npm i --no-save playwright-core, or set PLAYWRIGHT_CORE)');
  process.exit(SKIP);
}

const server = spawn('npx', ['vite', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);
const url = `http://localhost:${PORT}/`;
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(url)).ok) break;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}

// a real GPU on macOS (ANGLE on Metal: the NaN only shows there); SwiftShader elsewhere
const gpu = process.platform === 'darwin' ? ['--use-gl=angle', '--use-angle=metal'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
let browser;
try {
  browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: [...gpu, '--ignore-gpu-blocklist', '--enable-webgl'] });
} catch (e) {
  console.log(`SKIP  smoke-flicker: no Chromium to launch (${String(e.message).split('\n')[0]})`);
  stop();
  process.exit(SKIP);
}

const problems = [];
let gpuName = null;
for (const place of PLACES) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on('pageerror', (e) => problems.push(`${place}: pageerror ${String(e).slice(0, 200)}`));
  await page.goto(`${url}?intro=0&quality=high&fx=1#place=${place}&time=day&weather=clear`);
  try {
    await page.waitForFunction((h) => window[h]?.ready === true && !window[h].rig?.flying, HANDLE, { timeout: 120000 });
  } catch {
    problems.push(`${place}: the app never became ready`);
    await page.close();
    continue;
  }
  if (!gpuName) {
    gpuName = await page.evaluate((h) => {
      const gl = window[h].renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    }, HANDLE);
    console.log(`gpu   ${gpuName}`);
  }
  // full quality, and the governor held there (a slow runner would drop bloom)
  await page.evaluate((h) => {
    window[h].setGovernorLevel?.(0);
    window[h].perfSystem?.gov?.setHidden?.(true, performance.now());
  }, HANDLE);
  // the place's detailed model (lazy: built by the model worker after the flight)
  try {
    await page.waitForFunction(
      ({ h, name }) => {
        const m = window[h].scene.getObjectByName(name);
        return !!m?.geometry?.attributes?.position?.count && !m.geometry.userData?.placeholder;
      },
      { h: HANDLE, name: `landmark-${place}` },
      { timeout: 60000 },
    );
  } catch {
    problems.push(`${place}: its detailed model was never built (landmark-${place})`);
  }
  await new Promise((r) => setTimeout(r, 6000));

  // 1. zero-area triangles in the built landmark meshes and their pieces
  const geo = await page.evaluate(({ h, name }) => {
    const out = [];
    let checked = 0;
    let skipped = 0;
    let target = false;
    window[h].scene.traverse((o) => {
      if (!o.isMesh) return;
      if (!/^landmark-/.test(o.name) && !/^landmark-/.test(o.parent?.name || '')) return;
      const P = o.geometry.attributes.position?.array;
      if (!P || !P.length || o.geometry.index) {
        skipped++;
        return;
      }
      checked++;
      if (o.name === name) target = true;
      let n = 0;
      for (let o9 = 0; o9 + 8 < P.length; o9 += 9) {
        const ux = P[o9 + 3] - P[o9], uy = P[o9 + 4] - P[o9 + 1], uz = P[o9 + 5] - P[o9 + 2];
        const vx = P[o9 + 6] - P[o9], vy = P[o9 + 7] - P[o9 + 1], vz = P[o9 + 8] - P[o9 + 2];
        const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
        if (cx * cx + cy * cy + cz * cz < 1e-12) n++;
      }
      if (n) out.push(`${o.name}: ${n} zero-area triangles`);
    });
    return { out, checked, skipped, target };
  }, { h: HANDLE, name: `landmark-${place}` });
  problems.push(...geo.out.map((d) => `${place}: ${d}`));
  if (!geo.target) problems.push(`${place}: landmark-${place} was not checked (not built, indexed or empty)`);

  // 2. orbit and look for NaN in the scene target, frame by frame
  const r = await page.evaluate(({ h, frames, deg }) => new Promise((resolve) => {
    const d = window[h];
    const R = d.renderer;
    const gl = R.getContext();
    const orig = R.render.bind(R);
    const a = (deg * Math.PI) / 180;
    let n = 0;
    let checked = 0;
    let buf = null;
    const nanFrames = [];
    const t0 = performance.now();
    const finish = (why) => {
      R.render = orig;
      resolve({ n, checked, nanFrames, why });
    };
    R.render = (sc, cam) => {
      orig(sc, cam);
      const rt = R.getRenderTarget();
      if (sc.isScene && rt && rt.texture.type !== 1009) {
        // the scene pass of the composer: a half-float target, NaN survives in it
        const W = rt.width, H = rt.height;
        if (!buf || buf.length !== W * H * 4) buf = new Float32Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, buf);
        checked++;
        let bad = 0;
        for (let i = 0; i < buf.length; i += 4) if (buf[i] !== buf[i] || buf[i + 1] !== buf[i + 1] || buf[i + 2] !== buf[i + 2] || buf[i + 3] !== buf[i + 3]) bad++;
        if (bad && nanFrames.length < 20) nanFrames.push([n, bad]);
      }
      if (!rt) {
        n++;
        const c = d.rig.controls;
        const p = d.camera.position;
        const dx = p.x - c.target.x, dz = p.z - c.target.z;
        p.x = c.target.x + dx * Math.cos(a) - dz * Math.sin(a);
        p.z = c.target.z + dx * Math.sin(a) + dz * Math.cos(a);
        c.update();
        if (n >= frames) finish('done');
        else if (performance.now() - t0 > 180000) finish('timeout');
      }
    };
  }), { h: HANDLE, frames: FRAMES, deg: DEG });
  const pix = r.checked ? `${r.nanFrames.length} with NaN` : 'pixel check skipped (no half-float scene pass: post-processing off?)';
  if (r.nanFrames.length) problems.push(`${place}: ${r.nanFrames.length} of ${r.n} frames hold NaN pixels (frame, pixels): ${JSON.stringify(r.nanFrames.slice(0, 8))}`);
  if (r.why === 'timeout') console.log(`note  ${place}: the orbit timed out after ${r.n} frames`);
  console.log(`${place}: ${r.n} frames, ${r.checked} scene passes read, ${pix}; ${geo.checked} landmark meshes checked (${geo.skipped} skipped), ${geo.out.length} with zero-area triangles`);
  await page.close();
}

await browser.close();
stop();
if (problems.length) {
  for (const p of problems) console.error(`FAIL  ${p}`);
  console.log('smoke-flicker: FAILED');
  process.exit(1);
}
console.log('smoke-flicker: OK');
process.exit(0);
