// Social previews, share pages and PWA icons.
//
//   node scripts/make-og.mjs            # everything
//   node scripts/make-og.mjs --pages    # public/p/<id>/index.html only (fast, no browser)
//   node scripts/make-og.mjs --icons    # public/icons/*.png
//   node scripts/make-og.mjs --og       # public/og/<city>.jpg + public/og/<id>.jpg
//   node scripts/make-og.mjs --og --only=ribeira,hero
//   add --city <id> for another city (default porto)
//
// The OG renders need the app running (default: the Vite dev server,
// CITY_URL or BRAGA_URL=http://localhost:5174 for porto-3d). They use a headless
// Chromium with SwiftShader, like the other screenshot scripts. The hero camera
// is overridable with CITY_HERO_FROM / CITY_HERO (JSON). PLAYWRIGHT_CORE and
// CHROME_PATH override the paths below.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CITY } from './city-lib.mjs';

// --city <id> picks the city (default porto). Porto reads
// src/locales/{en,pt}.porto.js, Braga src/locales/{en,pt}.js, other cities
// src/locales/{en,pt}.<id>.js (an absent file counts as empty).
const ROOT = resolve(import.meta.dirname, '..');
// The window global main.js exposes its debug handle on (__porto, __braga, ...).
const GLOBAL = process.env.CITY_GLOBAL || (CITY.id === 'braga' ? '__braga' : `__${CITY.id}`);
// The canonical public host for share, canonical, sitemap and robots URLs.
// The live deploy is porto-3d.vercel.app; porto-3d.com is not registered
// (NXDOMAIN), so the vercel.app host is the default. Set SITE_URL (or
// VITE_SITE) when a custom domain is attached — this one constant drives the
// /p pages, sitemap.xml and robots.txt.
const SITE = (
  process.env.SITE_URL ||
  process.env.VITE_SITE ||
  CITY.domain ||
  (CITY.id === 'porto' ? 'https://porto-3d.vercel.app' : 'http://localhost:5173')
).replace(/\/+$/, '');
if (!CITY.domain && !process.env.SITE_URL && !process.env.VITE_SITE && CITY.id !== 'porto')
  console.warn(`warning: cities/${CITY.id}.json has no domain; share pages use http://localhost:5173`);
const CITY_NAME = `${CITY.name.en} 3D`;
// The dev server to render from: porto-3d runs on 5174 in this workspace
// (5173 is taken by another project), so the port follows the city.
const DEV_PORT = process.env.PORT || (CITY.id === 'porto' ? 5174 : 5173);
const BASE = process.env.CITY_URL || process.env.BRAGA_URL || `http://localhost:${DEV_PORT}`;
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
// Structured data is emitted as raw JSON, never HTML-escaped: turning quotes
// into &quot; would make the <script type="application/ld+json"> body invalid
// JSON. Only "<" is neutralised so a value can never close the tag early.
const jsonLd = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');
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
  // A real photo of the attraction when the landmark has one, plus the 3D OG
  // render; both absolute so image crawlers can fetch them.
  const photo = l.image ? `${SITE}/${String(l.image).replace(/^\/+/, '')}` : null;
  const ld = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'TouristAttraction',
    '@id': `${url}#attraction`,
    name: n.pt,
    alternateName: [...new Set([n.en, n.ru])].filter(Boolean),
    description: desc,
    url,
    image: [...new Set([photo, img].filter(Boolean))],
    geo: { '@type': 'GeoCoordinates', latitude: l.lat, longitude: l.lon },
    address: { '@type': 'PostalAddress', addressLocality: CITY.name.en, addressCountry: 'PT' },
    touristType: l.category || undefined,
    isPartOf: { '@type': 'WebSite', '@id': `${SITE}/#website` },
  });
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
    <meta name="twitter:image:alt" content="${esc(`${n.en}: 3D view`)}" />
    <script type="application/ld+json">${ld}</script>
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

  // robots.txt + sitemap.xml, both from the same SITE constant and landmark
  // list as the share pages, so the domain never drifts between them.
  const today = new Date().toISOString().slice(0, 10);
  const entries = [
    `  <url><loc>${SITE}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
    ...list.map(
      (l) => `  <url><loc>${SITE}/p/${l.id}/</loc><lastmod>${today}</lastmod><priority>0.8</priority></url>`,
    ),
  ];
  write(
    resolve(ROOT, 'public/sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`,
  );
  write(resolve(ROOT, 'public/robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
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
// A stylised Douro bridge: a single concrete arch (the Ponte da Arrábida)
// carrying the road deck between two river piers, gold on the app's dark ink.
function iconSvg({ maskable = false } = {}) {
  const inset = maskable ? 0.16 : 0.06;
  const s = 512;
  const a = s * inset;
  const k = (s - 2 * a) / 100; // drawing on a 100-unit grid
  const P = (x, y) => `${(a + x * k).toFixed(1)},${(a + y * k).toFixed(1)}`;
  // Parabola from the left springing to the right, apex just under the deck.
  const arch = `M${P(15, 87)} Q${P(50, -11)} ${P(85, 87)}`;
  // Spandrel columns from the deck down to the arch (x, arch y).
  const columns = [
    [28, 61],
    [39, 45],
    [50, 38],
    [61, 45],
    [72, 61],
  ];
  // Calm Douro water: four gentle humps under the piers.
  const water = `M${P(5, 92)} q${(11 * k).toFixed(1)} ${(-3.5 * k).toFixed(1)} ${(22 * k).toFixed(1)} 0 t${(22 * k).toFixed(1)} 0 t${(22 * k).toFixed(1)} 0 t${(22 * k).toFixed(1)} 0`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">
  <rect width="${s}" height="${s}" rx="${maskable ? 0 : s * 0.2}" fill="#14110d"/>
  <radialGradient id="glow" cx="50%" cy="38%" r="60%"><stop offset="0" stop-color="#3a2a14"/><stop offset="1" stop-color="#14110d" stop-opacity="0"/></radialGradient>
  <rect width="${s}" height="${s}" rx="${maskable ? 0 : s * 0.2}" fill="url(#glow)"/>
  <g fill="none" stroke="#e0a948" stroke-width="${(2.8 * k).toFixed(1)}" stroke-linejoin="round" stroke-linecap="round">
    <path d="${arch}"/>
    ${columns.map(([x, y]) => `<line x1="${(a + x * k).toFixed(1)}" y1="${(a + 33 * k).toFixed(1)}" x2="${(a + x * k).toFixed(1)}" y2="${(a + y * k).toFixed(1)}"/>`).join('')}
    <path d="${water}" opacity="0.75"/>
  </g>
  <g fill="#e0a948">
    <rect x="${(a + 12 * k).toFixed(1)}" y="${(a + 32 * k).toFixed(1)}" width="${(7 * k).toFixed(1)}" height="${(57 * k).toFixed(1)}" rx="${(1.6 * k).toFixed(1)}"/>
    <rect x="${(a + 81 * k).toFixed(1)}" y="${(a + 32 * k).toFixed(1)}" width="${(7 * k).toFixed(1)}" height="${(57 * k).toFixed(1)}" rx="${(1.6 * k).toFixed(1)}"/>
    <rect x="${(a + 7 * k).toFixed(1)}" y="${(a + 28 * k).toFixed(1)}" width="${(86 * k).toFixed(1)}" height="${(5 * k).toFixed(1)}" rx="${(2 * k).toFixed(1)}"/>
  </g>
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

// Hero: golden hour from the Gaia hillside, looking across the Douro to the
// Ribeira and the bridges. World units (1 unit = 4 m). The camera sits `back`
// behind the `from` landmark and `up` above the ground, `side` to its right;
// the target is `ahead` of it toward the city (kept close: far targets switch
// the roads to their thick overview glow).
const HERO_FROM = process.env.CITY_HERO_FROM || (CITY.id === 'porto' ? 'serra-do-pilar' : 'bom-jesus');
const HERO = JSON.parse(process.env.CITY_HERO || process.env.BRAGA_HERO || 'null') || (CITY.id === 'porto'
  ? { back: 70, up: 26, side: 22, ahead: 95, lift: 30 }
  : { back: 120, up: 38, side: 35, ahead: 120, lift: 48 });

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
  // fx=0 on purpose: under SwiftShader the EffectComposer's final pass is
  // intermittently not composited when a screenshot lands, which produced
  // blank (uniform-ink) OG frames. The plain renderer path is stable; the
  // postcard still reads (sunset lighting is in the scene, not the bloom).
  await page.goto(`${BASE}/?intro=0&fx=0&ui=0&lang=en${CITY_QUERY}#time=sunset`, { waitUntil: 'load' });
  // SwiftShader at 2x is slow (the boot can take a couple of minutes under
  // contention), so poll on an interval rather than on rAF and allow a long
  // budget: the page is done when __porto.ready is true.
  await page.waitForFunction((g) => window[g]?.ready, GLOBAL, { timeout: 600000, polling: 1000 });
  await page.waitForTimeout(2500);
  // Wait for `n` freshly rendered frames after a pose change (SwiftShader
  // frames can take seconds when other browsers share the CPU).
  const waitFrames = async (n) => {
    const before = await page.evaluate((g) => window[g].frames || 0, GLOBAL);
    await page
      .waitForFunction(({ b, n, g }) => (window[g].frames || 0) >= b + n, { b: before, n, g: GLOBAL }, { timeout: 180000, polling: 250 })
      .catch(() => {});
  };
  const shoot = async (name) => {
    let best = null;
    for (let i = 0; i < 3; i++) {
      if (i) await page.waitForTimeout(2500);
      const buf = await page.screenshot({ type: 'jpeg', quality: 82, timeout: 180000 });
      if (!best || buf.length > best.length) best = buf;
      if (buf.length > 12000) break;
    }
    if (best.length <= 12000) console.warn(`  ${name}: frame looks blank (${(best.length / 1024).toFixed(0)} KB)`);
    write(resolve(ROOT, `public/og/${name}.jpg`), best);
  };

  if (!only.length || only.includes('hero')) {
    // The hero looks from `from` (Porto: the Serra do Pilar) toward the start landmark.
    const heroOk = await page.evaluate(({ hero, from, to, g }) => {
      const d = window[g];
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
    }, { hero: HERO, from: HERO_FROM, to: CITY.start_view?.landmark, g: GLOBAL });
    if (heroOk) {
      await waitFrames(2);
      await shoot(CITY.id);
    } else console.warn(`  hero: landmark ${HERO_FROM} or ${CITY.start_view?.landmark} missing, skipped`);
  }
  // Per-landmark shots: aim the camera ourselves from the landmark geometry
  // (base/top, size) toward the city (Ribeira). The app's own select()-and-
  // frame path left the camera in a dark pose under the OG context, so we
  // script the pose with rig.flyTo and verify the frame is not blank.
  for (const l of list) {
    if (only.length && !only.includes(l.id)) continue;
    const posed = await page.evaluate(({ id, g }) => {
      const d = window[g];
      const all = d.landmarks;
      const lm = all.find((x) => x.id === id);
      if (!lm) return false;
      const V = d.camera.position.constructor;
      const ref = all.find((x) => x.id === (id === 'ribeira' ? 'clerigos' : 'ribeira')) || lm;
      const gnd = d.heightAt(lm.x, lm.z);
      const base = Math.max(Number.isFinite(lm.base) ? lm.base : gnd, gnd - 0.5);
      const top = Math.max(Number.isFinite(lm.top) ? lm.top : 0, base + 6);
      const height = top - base;
      let dx = ref.x - lm.x;
      let dz = ref.z - lm.z;
      let len = Math.hypot(dx, dz);
      if (len < 1) { dx = 0; dz = 1; len = 1; }
      dx /= len;
      dz /= len;
      // distance follows the subject's real extent (debug.landmarks is in
      // world units; size_m is in metres, 1 unit = 4 m)
      const big = Math.max(lm.size_m?.[0] || 14, lm.size_m?.[2] || 14, 14) / 4;
      const dist = Math.min(Math.max(big * 2.4 + 22, 38), 240);
      const side = dist * 0.3;
      const up = Math.max(dist * 0.42 + height * 0.6, 22);
      const tgt = new V(lm.x, base + height * 0.5, lm.z);
      const dir = new V(dx, 0, dz);
      const pos = new V(lm.x, 0, lm.z).addScaledVector(dir, -dist).addScaledVector(new V(-dz, 0, dx), side);
      pos.y = Math.max(d.heightAt(pos.x, pos.z) + up, gnd + height + 16);
      d.rig.flyTo(pos, tgt, 0.3);
      return true;
    }, { id: l.id, g: GLOBAL });
    if (!posed) { console.warn(`  ${l.id}: missing from __porto.landmarks, skipped`); continue; }
    await waitFrames(2);
    await shoot(l.id);
  }
  if (errors.length) console.warn('console errors:\n' + errors.join('\n'));
  await ctx.close();
}

if (all || flag('icons')) await makeIcons();
if (all || flag('og')) await makeOg();
await browser?.close();
