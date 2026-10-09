// node shotpair.mjs <root> <outPrefix> [extra query]  -> 3 views x 2 repeats on the Metal GPU, 1440x900 @2x
import { chromium } from '/Users/timur_isachenko/.nvm/versions/node/v22.22.0/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';
import { spawn } from 'node:child_process';
const [root, prefix, extra = ''] = process.argv.slice(2);
const server = spawn(process.execPath, ['/Users/timur_isachenko/Dev/porto-3d/scripts/perf-serve.mjs', '5192', '--root', root], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res) => server.stdout.on('data', (d) => String(d).includes('cache warm') && res()));
const browser = await chromium.launch({ headless: true, executablePath: '/Users/timur_isachenko/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const views = {
  overview: null,
  ribeira: [41.14075, -8.61298, 110, 55, 150, 10],
  clerigos: [41.14563, -8.61456, 60, 70, 140, 40],
};
for (let rep = 1; rep <= 2; rep++) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/\/api\//.test(m.location().url || '')) errs.push(m.text().slice(0, 160)); });
  await page.goto(`http://localhost:5192/?intro=0&lang=en${extra}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__porto?.ready === true, null, { timeout: 180000 });
  await sleep(4000);
  for (const [name, pose] of Object.entries(views)) {
    await page.evaluate(async (p) => {
      const P = window.__porto;
      const V = P.camera.position.constructor;
      if (!window.__home) window.__home = { pos: P.camera.position.clone(), tgt: P.rig.controls.target.clone() };
      let pos; let tgt;
      if (!p) { pos = window.__home.pos; tgt = window.__home.tgt; } else {
        const q = P.project(p[0], p[1]); const k = P.projection.metresPerUnit; const gy = P.heightAt(q.x, q.z);
        pos = new V(q.x + p[2] / k, gy + p[3] / k, q.z + p[4] / k); tgt = new V(q.x, gy + p[5] / k, q.z);
      }
      const f0 = P.flights; P.rig.flyTo(pos, tgt, 0.05);
      const t0 = performance.now(); while (P.flights === f0 && performance.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 50));
    }, pose);
    await sleep(6000);
    const gov = await page.evaluate(() => JSON.stringify(window.__porto.governor));
    await page.screenshot({ path: `${prefix}-${name}-${rep}.png` });
    console.log(prefix, rep, name, 'governor', gov);
  }
  console.log('errors', errs.length ? errs : 'none');
  await ctx.close();
}
await browser.close();
server.kill();
