#!/usr/bin/env node
// Browser smoke: serve the production build, load the app headless and fail on
// any console error, uncaught exception or WebGL error. It also audits every
// mesh in the scene: each vertex attribute must hold as many vertices as
// `position`, and index and draw range must stay inside the buffers (the
// cause of "GL_INVALID_OPERATION: Vertex buffer is not big enough").
//
//   node scripts/smoke-console.mjs
//
// Needs dist/ (npm run build) and playwright-core with a Chromium. Without
// them the script exits 77, and verify.mjs reports SKIP, never PASS.
// Env: PLAYWRIGHT_CORE (path to playwright-core/index.mjs), CHROME_PATH.
import { spawn, execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SMOKE_PORT || 5192);
const SKIP = 77;

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

if (!existsSync(join(ROOT, 'dist/index.html'))) {
  console.log('SKIP  smoke-console: dist/ is missing (run npm run build first)');
  process.exit(SKIP);
}
const chromium = await loadPlaywright();
if (!chromium) {
  console.log('SKIP  smoke-console: playwright-core not found (npm i --no-save playwright-core, or set PLAYWRIGHT_CORE)');
  process.exit(SKIP);
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
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

const gpu = process.platform === 'darwin' ? ['--use-angle=metal'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
let browser;
try {
  browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: [...gpu, '--ignore-gpu-blocklist', '--enable-webgl'] });
} catch (e) {
  console.log(`SKIP  smoke-console: no Chromium to launch (${String(e.message).split('\n')[0]})`);
  stop();
  process.exit(SKIP);
}

const problems = [];
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.on('console', (m) => {
  const text = m.text();
  if (m.type() === 'error' || /GL_INVALID|GL ERROR|WebGL.*(error|lost)/i.test(text)) problems.push(`console.${m.type()}: ${text.slice(0, 240)}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 240)}`));
page.on('response', (r) => {
  if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) problems.push(`HTTP ${r.status()} ${r.url()}`);
});

await page.goto(url);
try {
  await page.waitForFunction(() => window.__porto?.ready === true, null, { timeout: 120000 });
} catch {
  problems.push('app never reported __porto.ready within 120 s');
}
await new Promise((r) => setTimeout(r, 6000));

const bad = await page.evaluate(() => {
  const out = [];
  const scene = window.__porto?.scene;
  if (!scene) return ['no __porto.scene'];
  scene.traverse((o) => {
    const g = o.geometry;
    const pos = g?.attributes?.position;
    if (!pos) return;
    const name = o.name || o.type;
    const dr = g.drawRange;
    if (g.index) {
      const arr = g.index.array;
      const end = Math.min(arr.length, dr.count === Infinity ? arr.length : dr.start + dr.count);
      let max = 0;
      for (let i = dr.start; i < end; i++) if (arr[i] > max) max = arr[i];
      if (max >= pos.count) out.push(`${name}: index ${max} >= ${pos.count} vertices`);
      if (dr.count !== Infinity && dr.start + dr.count > arr.length) out.push(`${name}: drawRange past the index`);
    } else if (dr.count !== Infinity && dr.start + dr.count > pos.count) {
      out.push(`${name}: drawRange past the positions`);
    }
    for (const [k, a] of Object.entries(g.attributes)) {
      if (a.isInstancedBufferAttribute) {
        if (o.isInstancedMesh && a.count < o.count) out.push(`${name}: instanced ${k} has ${a.count} < ${o.count}`);
      } else if (!a.isInterleavedBufferAttribute && a.count < pos.count) {
        out.push(`${name}: attribute ${k} has ${a.count} < ${pos.count} vertices`);
      }
    }
  });
  return out;
});
problems.push(...bad.slice(0, 20).map((b) => `geometry: ${b}`));

await browser.close();
stop();
if (problems.length) {
  for (const p of [...new Set(problems)]) console.error(`FAIL  ${p}`);
  console.log('smoke-console: FAILED');
  process.exit(1);
}
console.log('PASS  smoke-console: no console errors, no GL errors, all geometry buffers consistent');
console.log('smoke-console: OK');
process.exit(0);
