// Social previews, share pages and PWA icons.
//
//   node scripts/make-og.mjs            # everything
//   node scripts/make-og.mjs --pages    # public/p/<id>/index.html only (fast, no browser)
//   node scripts/make-og.mjs --icons    # public/icons/*.png
//   node scripts/make-og.mjs --og       # public/og/<city>.jpg + public/og/<id>.jpg
//   node scripts/make-og.mjs --og --only=se-braga,hero
//   add --city <id> for another city (default braga)
//
// The OG renders need the app running (default: the Vite dev server,
// CITY_URL or BRAGA_URL=http://localhost:5173). They use a headless Chromium with
// SwiftShader, like the other screenshot scripts. PLAYWRIGHT_CORE and
// CHROME_PATH override the paths below.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CITY } from './city-lib.mjs';

// --city <id> picks the city (default braga). Braga reads src/locales/{en,pt}.js,
// other cities src/locales/{en,pt}.<id>.js (an absent file counts as empty).
const ROOT = resolve(import.meta.dirname, '..');
if (!CITY.domain) console.warn(`warning: cities/${CITY.id}.json has no domain; share pages use http://localhost:5173`);
const SITE = CITY.domain || 'http://localhost:5173';
const CITY_NAME = `${CITY.name.en} 3D`;
const BASE = process.env.CITY_URL || process.env.BRAGA_URL || 'http://localhost:5173';
const CITY_QUERY = CITY.id === 'braga' ? '' : `&city=${CITY.id}`;
const PLAYWRIGHT_CORE =
  process.env.PLAYWRIGHT_CORE ||
  '/Users/timur_isachenko/.nvm/versions/node/v22.22.0/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';
const CHROME_PATH =
  process.env.CHROME_PATH ||
  '/Users/timur_isachenko/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell';

const args = process.argv.slice(2);
const flag = (f) => args.includes(`--${f}`);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const all = !flag('pages') && !flag('icons') && !flag('og');

if (!existsSync(CITY.landmarksPath)) {
  console.log(`no landmarks yet for ${CITY.id}`);
  process.exit(0);
}
const landmarks = JSON.parse(readFileSync(CITY.landmarksPath, 'utf8'));
const list = Array.isArray(landmarks) ? landmarks : landmarks.landmarks;
const localeLandmarks = async (lang) => {
  const file = resolve(ROOT, CITY.id === 'braga' ? `src/locales/${lang}.js` : `src/locales/${lang}.${CITY.id}.js`);
  return existsSync(file) ? (await import(pathToFileURL(file).href)).landmarks || {} : {};
};
const en = await localeLandmarks('en');
const pt = await localeLandmarks('pt');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function write(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log('wrote', path.replace(ROOT + '/', ''), typeof data === 'string' ? '' : `${(data.length / 1024).toFixed(0)} KB`);
}

// ------------------------------------------------------------ share pages
function names(l) {
  return {
    pt: pt[l.id]?.name || l.name_pt || l.name_ru,
    en: en[l.id]?.name || l.name_pt || l.name_ru,
    ru: l.name_ru,
  };
}
function sharePage(l) {
  const n = names(l);
  const short = { en: en[l.id]?.short || '', pt: pt[l.id]?.short || '', ru: l.short_ru || '' };
  const uniq = [...new Set([n.pt, n.en, n.ru])];
  const title = `${uniq.join(' · ')} — ${CITY_NAME}`;
  const desc = short.en || short.pt || short.ru;
  const url = `${SITE}/p/${l.id}/`;
  const img = `${SITE}/og/${l.id}.jpg`;
  return `<!doctype html>
<html lang="pt-PT">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}" />
    <link rel="canonical" href="${url}" />
    <meta name="theme-color" content="#14110d" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${esc(CITY_NAME)}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${img}" />
    <meta property="og:image:type" content="image/jpeg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${esc(`${n.en}: 3D view`)}" />
    <meta property="og:locale" content="pt_PT" />
    <meta property="og:locale:alternate" content="en_GB" />
    <meta property="og:locale:alternate" content="ru_RU" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(desc)}" />
    <meta name="twitter:image" content="${img}" />
    <link rel="icon" href="/icons/icon-192.png" />
    <script>
      // people go straight to the map; crawlers read the tags above
      (function () {
        var extra = location.hash.replace(/^#/, '');
        location.replace('/' + location.search + '#place=${l.id}' + (extra ? '&' + extra : ''));
      })();
    </script>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #14110d; color: #f1e8da; font: 16px/1.5 Georgia, serif; }
      main { max-width: 640px; padding: 32px 24px; }
      h1 { margin: 0 0 4px; font-size: 34px; font-weight: 600; }
      .alt { margin: 0 0 18px; color: #c9bba5; }
      img { width: 100%; height: auto; border: 1px solid #e0a948; border-radius: 8px; }
      a { color: #e0a948; }
    </style>
  </head>
  <body>
    <main>
      <h1>${esc(n.pt)}</h1>
      <p class="alt"><span lang="en">${esc(n.en)}</span> · <span lang="ru">${esc(n.ru)}</span></p>
      <img src="/og/${l.id}.jpg" width="1200" height="630" alt="${esc(`${n.en}: 3D view`)}" />
      ${short.pt ? `<p lang="pt-PT">${esc(short.pt)}</p>` : ''}
      ${short.en ? `<p lang="en">${esc(short.en)}</p>` : ''}
      ${short.ru ? `<p lang="ru">${esc(short.ru)}</p>` : ''}
      <p><a href="/#place=${l.id}">Abrir o mapa 3D · Open the 3D map · Открыть 3D-карту</a></p>
    </main>
  </body>
</html>
`;
}
if (all || flag('pages')) {
  for (const l of list) write(resolve(ROOT, `public/p/${l.id}/index.html`), sharePage(l));
}

// ------------------------------------------------------------ browser
let browser = null;
async function launch() {
  const { chromium } = await import(PLAYWRIGHT_CORE);
  browser = await chromium.launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
  });
  return browser;
}

// ------------------------------------------------------------ icons
// A stylised Bom Jesus: the zigzag stair climbing to a two-tower church,
// gold on the app's dark ink.
function iconSvg({ maskable = false } = {}) {
  const inset = maskable ? 0.16 : 0.06;
  const s = 512;
  const a = s * inset;
  const k = (s - 2 * a) / 100; // drawing on a 100-unit grid
  const P = (x, y) => `${(a + x * k).toFixed(1)},${(a + y * k).toFixed(1)}`;
  const stair = [
    [18, 92], [82, 92], [82, 84], [26, 84], [26, 76], [74, 76], [74, 68], [34, 68], [34, 60], [66, 60], [66, 52],
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">
  <rect width="${s}" height="${s}" rx="${maskable ? 0 : s * 0.2}" fill="#14110d"/>
  <radialGradient id="glow" cx="50%" cy="38%" r="60%"><stop offset="0" stop-color="#3a2a14"/><stop offset="1" stop-color="#14110d" stop-opacity="0"/></radialGradient>
  <rect width="${s}" height="${s}" rx="${maskable ? 0 : s * 0.2}" fill="url(#glow)"/>
  <g fill="none" stroke="#e0a948" stroke-width="${(3.2 * k).toFixed(1)}" stroke-linejoin="round" stroke-linecap="round">
    <polyline points="${stair.map(([x, y]) => P(x, y)).join(' ')}"/>
  </g>
  <g fill="#e0a948">
    <path d="M${P(36, 50)} L${P(36, 30)} L${P(42, 30)} L${P(42, 22)} L${P(45, 16)} L${P(48, 22)} L${P(48, 30)}
             L${P(52, 30)} L${P(52, 22)} L${P(55, 16)} L${P(58, 22)} L${P(58, 30)} L${P(64, 30)} L${P(64, 50)} Z"/>
  </g>
  <path d="M${P(47, 50)} L${P(47, 40)} Q${P(50, 36)} ${P(53, 40)} L${P(53, 50)} Z" fill="#14110d"/>
  <rect x="${a + 49.2 * k}" y="${a + 8 * k}" width="${1.6 * k}" height="${7 * k}" fill="#e0a948"/>
  <rect x="${a + 47 * k}" y="${a + 10.2 * k}" width="${6 * k}" height="${1.6 * k}" fill="#e0a948"/>
</svg>`;
}
async function makeIcons() {
  const b = browser || (await launch());
  const page = await b.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  const shots = [
    ['icon-512.png', 512, false],
    ['icon-192.png', 192, false],
    ['icon-maskable-512.png', 512, true],
    ['apple-touch-icon.png', 180, true], // iOS rounds the corners itself
  ];
  for (const [name, px, maskable] of shots) {
    await page.setViewportSize({ width: px, height: px });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${iconSvg({ maskable }).replace('width="512" height="512"', `width="${px}" height="${px}"`)}</body></html>`,
    );
    const buf = await page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: px, height: px } });
    write(resolve(ROOT, `public/icons/${name}`), buf);
  }
  write(resolve(ROOT, 'public/icons/icon.svg'), iconSvg());
  await page.close();
}

// ------------------------------------------------------------ OG images
// 600x315 CSS px at 2x = 1200x630. Under 900 px wide the camera rig frames
// a landmark in the middle of the canvas (no side panels to clear).
const STUB = `export function createHotContext(){return {accept(){},acceptExports(){},dispose(){},prune(){},invalidate(){},decline(){},on(){},off(){},send(){},data:{}}}
export function updateStyle(id, css){let s=document.querySelector('style[data-vite-dev-id="'+id+'"]'); if(!s){s=document.createElement('style');s.setAttribute('data-vite-dev-id',id);document.head.append(s);} s.textContent=css;}
export function removeStyle(id){document.querySelector('style[data-vite-dev-id="'+id+'"]')?.remove()}
export function injectQuery(u){return u}
export class ErrorOverlay extends HTMLElement {}`;

// Hero: golden hour from behind the sanctuary, looking over the Bom Jesus
// stair toward the Sé and the setting sun. World units (1 unit = 4 m) on
// the line from Bom Jesus to the Sé: the camera sits `back` behind the
// sanctuary and `up` above the ground, `side` to its right; the target is
// `ahead` of it toward the city (kept close: far targets switch the roads
// to their thick overview glow).
const HERO_FROM = process.env.CITY_HERO_FROM || 'bom-jesus'; // Braga-specific default
const HERO = JSON.parse(process.env.BRAGA_HERO || 'null') || { back: 120, up: 38, side: 35, ahead: 120, lift: 48 };

async function makeOg() {
  const b = browser || (await launch());
  const ctx = await b.newContext({ viewport: { width: 600, height: 315 }, deviceScaleFactor: 2 });
  await ctx.route('**/@vite/client', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: STUB }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('GPU stall') || t.includes('GL Driver') || t.includes('model box deviates')) return;
    if (m.type() === 'error') errors.push(t.slice(0, 300));
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(`${BASE}/?intro=0&fx=1&ui=0&lang=en${CITY_QUERY}#time=sunset`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__braga?.ready && window.__braga.postcard, null, { timeout: 240000 });
  await page.waitForTimeout(2500);
  const shoot = async (name) => {
    // SwiftShader frames can take seconds when other browsers share the CPU
    const buf = await page.screenshot({ type: 'jpeg', quality: 82, timeout: 180000 });
    write(resolve(ROOT, `public/og/${name}.jpg`), buf);
  };

  if (!only.length || only.includes('hero')) {
    // The hero looks from `from` (Braga: the Bom Jesus sanctuary) toward the start landmark.
    const heroOk = await page.evaluate(({ hero, from, to }) => {
      const d = window.__braga;
      const bj = d.landmarks.find((l) => l.id === from);
      const se = d.landmarks.find((l) => l.id === to);
      if (!bj || !se) return false;
      const V = d.camera.position.constructor;
      const dir = new V(se.x - bj.x, 0, se.z - bj.z).normalize(); // toward the city
      const right = new V(-dir.z, 0, dir.x);
      const tgt = new V(bj.x, 0, bj.z).addScaledVector(dir, hero.ahead);
      tgt.y = d.heightAt(tgt.x, tgt.z) + hero.lift;
      const pos = new V(bj.x, 0, bj.z).addScaledVector(dir, -hero.back).addScaledVector(right, hero.side);
      pos.y = d.heightAt(pos.x, pos.z) + hero.up;
      d.rig.flyTo(pos, tgt, 0.3);
      return true;
    }, { hero: HERO, from: HERO_FROM, to: CITY.start_view?.landmark });
    if (heroOk) {
      await page.waitForTimeout(3500);
      await shoot(CITY.id);
    } else console.warn(`  hero: landmark ${HERO_FROM} or ${CITY.start_view?.landmark} missing, skipped`);
  }
  for (const l of list) {
    if (only.length && !only.includes(l.id)) continue;
    const before = await page.evaluate(() => window.__braga.flights);
    await page.evaluate((id) => {
      window.__braga.close?.();
      location.hash = `place=${id}&time=sunset`;
    }, l.id);
    await page
      .waitForFunction((n) => window.__braga.flights > n, before, { timeout: 60000 })
      .catch(() => console.warn(`  ${l.id}: no flight end seen, shooting anyway`));
    await page.waitForTimeout(1800);
    await shoot(l.id);
  }
  if (errors.length) console.warn('console errors:\n' + errors.join('\n'));
  await ctx.close();
}

if (all || flag('icons')) await makeIcons();
if (all || flag('og')) await makeOg();
await browser?.close();
