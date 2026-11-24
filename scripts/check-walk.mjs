#!/usr/bin/env node
// Walk mode check (src/walk.js) in a real browser: the map, the desktop and
// the phone. Ported from braga-3d scripts/check-walk.mjs (porto-031).
//
//   node scripts/check-walk.mjs [--base http://localhost:5472/] [--out dir]
//
// map: the map at / loads no walk code and no character model until the
// walk button is pressed; the button starts the walk.
// desktop, phone: /play opens walk mode on the Ribeira quay
// (cities/porto.json walk_start). Check the eye height and the feet on the
// drawn ground, walk forward with W (the stick on the phone), walk into the
// Ribeira house row and stop at its wall, see the GLB passers-by near the
// walker, never stand inside a building in eight headings, get pushed out
// of a passer-by, look around by drag, switch to first person, open a place
// card, leave with Esc (desktop) or the button (phone) and check that the
// orbit camera is back. No page errors.
//
// Needs a served build (npm run build; npx vite preview --port 5472) and
// playwright-core with a Chromium; without them it exits 77 (skip).
// Env: PLAYWRIGHT_CORE.
import { existsSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const BASE = arg('base', 'http://localhost:5472/');
const OUT = arg('out', '');
const CORE = process.env.PLAYWRIGHT_CORE;
if (!CORE || !existsSync(CORE)) {
  console.log('skip: set PLAYWRIGHT_CORE to playwright-core/index.mjs');
  process.exit(77);
}
const { chromium, devices } = await import(pathToFileURL(CORE).href);
if (OUT) mkdirSync(OUT, { recursive: true });

const HASH = '#walk&time=day&weather=clear&live=0';
const RIVER = { lat: 41.1396, lon: -8.6125 }; // the Douro off the Ribeira
const fails = [];
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) fails.push(msg);
};
const state = (page) => page.evaluate(() => {
  const P = window.__porto;
  const crowds = [P.life?.street?.porto?.people, P.life?.street?.kit?.crowd].filter(Boolean);
  return {
    ...P.walk?.state,
    active: !!P.walk?.active,
    cls: document.body.classList.contains('is-walk'),
    fov: P.camera.fov,
    camNear: P.camera.near,
    orbit: P.rig.controls.enabled,
    hash: location.hash,
    models: crowds.reduce((n, c) => n + (c.models?.shown || 0), 0),
    modelsReady: crowds.some((c) => c.models?.ready),
  };
});
const launch = () => chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const watch = (page, errors) => {
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  // a shader that does not compile throws nothing: three.js logs it
  page.on('console', (m) => {
    if (m.type() === 'error' && /shader|WebGLProgram|GLSL/i.test(m.text())) errors.push(m.text().slice(0, 200));
  });
};
const frames = (page, n = 2) => page.evaluate((n) => new Promise((res) => {
  const step = () => (n-- <= 0 ? res() : requestAnimationFrame(step));
  step();
}), n);

// ------------------------------------------------------------ the map at /
async function map() {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  watch(page, errors);
  await page.goto(`${BASE}?intro=0&lang=en#time=day&weather=clear&live=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__porto?.ready === true, null, { timeout: 240000 });
  await page.waitForTimeout(5000);
  const walkFiles = () => page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /\/static\/(walk|crowd-models|character-model)-|\.glb(\?|$)/.test(n)));
  const before = await walkFiles();
  ok(before.length === 0, `map: no walk code and no character model on the map at / (${before.length} files)`);
  ok(await page.locator('#walk-toggle').count() === 1, 'map: the walk button is in the tools');
  await page.evaluate(() => document.getElementById('walk-toggle').click());
  await page.waitForFunction(() => window.__porto.walk?.active === true, null, { timeout: 40000 });
  const after = await walkFiles();
  ok(after.some((n) => /\/static\/walk-/.test(n)), `map: the button loads the walk chunk (${after.length} files)`);
  ok(/walk/.test(await page.evaluate(() => location.hash)), 'map: the button starts the walk (#walk)');
  if (OUT) await page.screenshot({ path: `${OUT}/walk-map-button.png` });
  ok(errors.length === 0, `map: no page errors${errors.length ? ': ' + errors[0] : ''}`);
  await browser.close();
}

// ------------------------------------------------------------ /play
async function run(profile) {
  const phone = profile === 'phone';
  const browser = await launch();
  const ctx = await browser.newContext(phone ? { ...devices['Pixel 7'] } : { viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);
  await page.goto(`${BASE}play?lang=en${HASH}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__porto?.ready === true, null, { timeout: 240000 });
  await page.waitForFunction(() => window.__porto.walk?.active === true, null, { timeout: 40000 });
  await page.waitForTimeout(4000);
  let s = await state(page);
  ok(s.cls && s.active, `${profile}: /play opens walk mode (${s.hash})`);
  ok(Math.abs(s.eyeM - 1.7) < 0.15, `${profile}: eye height ${s.eyeM} m`);
  ok(s.inside === false && s.blocked === false, `${profile}: the start point is clear of houses and water`);
  ok(s.liftM > -0.05 && s.liftM < 2, `${profile}: the feet stand on the drawn ground, ${s.liftM} m over the terrain (the quay deck)`);
  ok(s.lanes > 1000, `${profile}: the street crowds gave ${s.lanes} lane points`);
  ok(s.orbit === false, `${profile}: the orbit controls are off`);
  ok(s.camNear < 0.2, `${profile}: near plane ${(s.camNear * 4).toFixed(2)} m`);
  ok(s.buildings > 1000, `${profile}: ${s.buildings} outlines in the collider`);
  ok(await page.locator('.walk-exit').isVisible(), `${profile}: the Go up button shows`);
  ok((await page.locator('.walk-stick').isVisible()) === phone, `${profile}: the stick ${phone ? 'shows' : 'is hidden'}`);
  ok(s.view === 'third' && s.figure, `${profile}: third person, the figure shows`);
  ok(s.camM > 1.5 && s.camM < 5 && !s.camInside, `${profile}: the camera is ${s.camM} m behind, in the street`);
  const hero = await page.evaluate(() => {
    let found = null;
    const scene = window.__porto.scene;
    scene?.traverse((o) => { if (o.name === 'walk-figure') found = o.userData.clips || []; });
    return found;
  });
  ok(Array.isArray(hero) && hero.length >= 2, `${profile}: the walker is the GLB model (clips: ${hero ? hero.join(', ') : 'none'})`);
  if (OUT) await page.screenshot({ path: `${OUT}/walk-${profile}-start.png` });

  // hold forward (W, or the stick pushed up) for a time
  const hold = async (ms, sample = null) => {
    if (phone) {
      const box = await page.locator('.walk-stick').boundingBox();
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      const touch = (type, y) => page.evaluate(([type, x, y]) => {
        document.querySelector('.walk-stick').dispatchEvent(new PointerEvent(type, { pointerId: 41, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: true }));
      }, [type, cx, y]);
      await touch('pointerdown', cy);
      await touch('pointermove', cy - 40);
      for (let t = 0; t < ms; t += 500) { await page.waitForTimeout(500); if (sample) await sample(); }
      await touch('pointerup', cy - 40);
    } else {
      await page.keyboard.down('KeyW');
      for (let t = 0; t < ms; t += 500) { await page.waitForTimeout(500); if (sample) await sample(); }
      await page.keyboard.up('KeyW');
    }
  };

  // W: along the quay, east to the Luís I bridge
  let before = s.walkedM;
  await hold(3000);
  await page.waitForTimeout(300);
  s = await state(page);
  ok(s.walkedM - before > 2.5, `${profile}: forward walks ${(s.walkedM - before).toFixed(1)} m in 3 s`);
  ok(Math.abs(s.eyeM - 1.7) < 0.3, `${profile}: eye height after the walk ${s.eyeM} m`);
  if (OUT) await page.screenshot({ path: `${OUT}/walk-${profile}-forward.png` });

  // the wall: north into the Ribeira house row; the walker stops at it
  await page.evaluate(() => window.__porto.walk.turn(0));
  let insideSeen = 0;
  const track = [];
  await hold(12000, async () => {
    const t = await state(page);
    insideSeen += t.inside ? 1 : 0;
    track.push(t);
  });
  s = await state(page);
  const last = track.slice(-3);
  // stopped going north (it may still slide along the wall)
  const north = last.length === 3 ? (last[0].z - last[2].z) * 4 : Infinity;
  const still = north < 0.3;
  const ahead = await page.evaluate(() => {
    const w = window.__porto.walk;
    const p = w.position;
    return w.what(p.x, p.z - 0.25); // 1 m north
  });
  ok(insideSeen === 0 && still && ahead === 'house', `${profile}: the walker stops at the house wall (1 m ahead: ${ahead}; ${north.toFixed(2)} m north in the last second; inside ${insideSeen} of ${track.length} samples)`);
  ok(Math.abs(s.eyeM - 1.7) < 0.3 && s.liftM > -0.05, `${profile}: at the wall the feet are on the ground (eye ${s.eyeM} m, ${s.liftM} m over the terrain)`);
  if (OUT) await page.screenshot({ path: `${OUT}/walk-${profile}-wall.png` });

  // passers-by: the close ones in view are GLB models; look round until one
  // shows, then face it. Light mode (the phone budget classes) keeps the
  // instanced crowd only, as braga-3d does.
  const lite = await page.evaluate(() => window.__porto.tier?.tier === 'low');
  let seen = null;
  for (let t = 0; t < (lite ? 0 : 48) && !seen; t++) {
    if (t % 3 === 0) await page.evaluate((yaw) => window.__porto.walk.turn(yaw), (t / 3) * (Math.PI / 4));
    await page.waitForTimeout(500);
    seen = await page.evaluate(() => {
      const P = window.__porto;
      const w = P.walk;
      const p = w.position;
      let best = null, bd = Infinity;
      P.scene.traverse((o) => {
        if (!o.userData.crowdBody || !o.visible) return;
        const d = Math.hypot(o.position.x - p.x, o.position.z - p.z);
        if (d < bd) { bd = d; best = o; }
      });
      if (!best) return null;
      w.turn(Math.atan2(best.position.x - p.x, -(best.position.z - p.z)), -0.05);
      return { name: best.name, m: +(bd * 4).toFixed(1) };
    });
  }
  if (lite) console.log(`note ${profile}: light mode, the passers-by stay instanced figures`);
  else {
    ok(!!seen, `${profile}: GLB passers-by show near the walker${seen ? ` (${seen.name}, ${seen.m} m away)` : ''}`);
    await page.waitForTimeout(900);
    s = await state(page);
    ok(s.models > 0, `${profile}: ${s.models} passers-by drawn as rigged models`);
  }
  if (OUT) await page.screenshot({ path: `${OUT}/walk-${profile}-crowd.png` });

  // eight headings, never inside a building
  insideSeen = 0;
  before = s.walkedM;
  for (let i = 0; i < 8; i++) {
    await page.evaluate((yaw) => window.__porto.walk.turn(yaw), (i * Math.PI) / 4);
    if (!phone) await page.keyboard.down('ShiftLeft');
    await hold(1500, async () => { insideSeen += (await state(page)).inside ? 1 : 0; });
    if (!phone) await page.keyboard.up('ShiftLeft');
  }
  s = await state(page);
  ok(insideSeen === 0, `${profile}: never inside a building in eight headings (${insideSeen} samples inside)`);
  ok(s.walkedM - before > 3, `${profile}: walked ${(s.walkedM - before).toFixed(1)} m in eight headings`);

  // a passer-by pushes the walker out (people give way over about half a second)
  const push = await page.evaluate(async () => {
    const w = window.__porto.walk;
    for (let tries = 0; tries < 20; tries++) {
      for (const [x, z] of w.bodies('people').slice(0, 80)) {
        const b0 = w.state.bumps;
        if (!w.teleport(x, z)) continue;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (w.state.bumps === b0) continue;
        return { bumped: true };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return { bumped: false };
  });
  ok(push.bumped, `${profile}: a passer-by is a body: standing in one pushes the walker out`);

  // the river blocks the walker
  const wet = await page.evaluate(({ lat, lon }) => {
    const P = window.__porto;
    const q = P.project(lat, lon);
    return { what: P.walk.what(q.x, q.z), free: P.walk.free(q.x, q.z) };
  }, RIVER);
  ok(wet.what === 'water' && !wet.free, `${profile}: the Douro blocks the walker (${wet.what})`);

  // back to the quay
  await page.evaluate(() => {
    const P = window.__porto;
    const q = P.project(41.14012, -8.6131);
    for (let d = 0; d < 12; d += 0.5) for (let a = 0; a < 8; a++) if (P.walk.teleport(q.x + Math.cos(a * 0.785) * d, q.z + Math.sin(a * 0.785) * d)) return;
  });
  await page.waitForTimeout(400);

  // look: a drag on the map turns the view
  await page.evaluate(() => window.__porto.walk.turn(1.57));
  const yaw0 = (await state(page)).yaw;
  const size = page.viewportSize();
  await page.evaluate(([w, h]) => {
    const c = document.querySelector('canvas');
    const ev = (type, x) => new PointerEvent(type, { pointerId: 7, pointerType: 'mouse', clientX: x, clientY: h / 2, bubbles: true, buttons: 1 });
    c.dispatchEvent(ev('pointerdown', w * 0.6));
    window.dispatchEvent(ev('pointermove', w * 0.6 + 120));
    window.dispatchEvent(ev('pointerup', w * 0.6 + 120));
  }, [size.width, size.height]);
  await page.waitForTimeout(300);
  s = await state(page);
  ok(Math.abs(s.yaw - yaw0) > 0.3, `${profile}: a drag turns the view (${yaw0} to ${s.yaw})`);

  // first person: the button on a phone, V on the desktop
  if (phone) await page.locator('.walk-view').click();
  else await page.keyboard.press('KeyV');
  await page.waitForTimeout(600);
  s = await state(page);
  ok(s.view === 'first' && !s.figure && s.camM < 0.05, `${profile}: first person, the camera is at the eyes`);
  if (OUT) await page.screenshot({ path: `${OUT}/walk-${profile}-first.png` });
  if (phone) await page.locator('.walk-view').click();
  else await page.keyboard.press('KeyV');
  await page.waitForTimeout(1200);
  s = await state(page);
  ok(s.view === 'third' && !s.camInside, `${profile}: back to third person`);

  // a place within reach offers its card (the quay is the Cais da Ribeira)
  await page.waitForTimeout(800);
  const chip = page.locator('.walk-place');
  ok(await chip.isVisible(), `${profile}: the place button shows: ${(await chip.textContent()) || ''}`);
  await chip.click();
  await page.waitForTimeout(3500);
  s = await state(page);
  ok(!s.active && /place=/.test(s.hash), `${profile}: the button ends the walk and opens the place (${s.hash})`);
  if (OUT) await page.screenshot({ path: `${OUT}/walk-${profile}-card.png` });
  await page.evaluate(() => { location.hash = 'walk'; });
  await page.waitForFunction(() => window.__porto.walk?.active === true, null, { timeout: 30000 });
  await page.waitForTimeout(1000);

  // leave
  if (phone) await page.locator('.walk-exit').click();
  else await page.keyboard.press('Escape');
  await page.waitForTimeout(3000);
  s = await state(page);
  const up = await page.evaluate(() => {
    const P = window.__porto;
    return (P.camera.position.y - P.heightAt(P.camera.position.x, P.camera.position.z)) * 4;
  });
  ok(!s.active && !s.cls, `${profile}: walk mode is off after ${phone ? 'Go up' : 'Esc'}`);
  ok(s.orbit === true, `${profile}: the orbit controls are back`);
  ok(up > 60, `${profile}: the camera is ${up.toFixed(0)} m up again`);
  ok(!/walk/.test(s.hash), `${profile}: the link no longer says walk (${s.hash || 'empty'})`);
  ok(s.figure === false, `${profile}: the figure is gone`);
  ok(s.camNear >= 0.5, `${profile}: the orbit near plane is back`);
  if (OUT) await page.screenshot({ path: `${OUT}/walk-${profile}-after.png` });
  ok(errors.length === 0, `${profile}: no page errors${errors.length ? ': ' + errors[0] : ''}`);
  await browser.close();
}

await map();
for (const profile of ['desktop', 'phone']) await run(profile);
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
process.exit(fails.length ? 1 : 0);
