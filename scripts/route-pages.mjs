// Text version of the history routes: plain HTML pages generated from
// data/quest.json, for visitors without WebGL, for screen readers and for
// search engines. No JavaScript, no redirect, no date inside (so the pages
// only change when the data does).
//
//   public/route/index.html            the routes, in Portuguese
//   public/route/<lang>/index.html     the routes, in en / ru
//   public/route/<id>/index.html       one route, in Portuguese
//   public/route/<id>/<lang>/index.html one route, in en / ru
//
//   node scripts/route-pages.mjs           # write the pages
//   node scripts/route-pages.mjs --check   # exit 1 when a page is stale
//
// make-og.mjs --pages runs it too and lists the pages in sitemap.xml.
// scripts/quest.test.mjs checks that the committed pages match the data.
//
// Ported from braga-3d. Porto: the .porto.js locales, cities/porto.json's
// domain, source links named by their site, and photos with their pixel
// size (width/height from the JPEG header) and a WebP source, so the page
// does not shift while they load.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
export const LANGS = ['pt', 'en', 'ru'];
const HTML_LANG = { pt: 'pt-PT', en: 'en', ru: 'ru' };
const LANG_NAME = { pt: 'Português', en: 'English', ru: 'Русский' };
const CYRILLIC = /[А-Яа-яЁё]/;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// A route's intro without its sentences about questions and stamps: the
// text version has neither.
const textIntro = (intro) => intro.split(/(?<=\.)\s+/).filter((x) => !/stamp|selo|печат|question|pergunta|вопрос|task|tarefa|задани/i.test(x)).join(' ') || intro;
// the folder of a page: the routes list (id null) or one route, per language
const dir = (id, lang) => `/route/${id ? `${id}/` : ''}${lang === 'pt' ? '' : `${lang}/`}`;

// a source link's text: its title, or the site name when the title is a
// bare URL (Porto's sources), missing, or Russian outside Russian
export function sourceName(q, lang) {
  const bare = !q.title || /^https?:\/\//.test(q.title) || (lang !== 'ru' && CYRILLIC.test(q.title));
  return bare ? new URL(q.url).hostname.replace(/^www\./, '') : q.title;
}

// The pixel size of a JPEG from its SOF marker, or null.
export function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    // SOF0..SOF15, not DHT (c4), JPG (c8) or DAC (cc)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

// Porto's inputs from the repository; null when this checkout has no routes
export async function loadInputs() {
  const file = resolve(ROOT, 'data/quest.json');
  if (!existsSync(file)) return null;
  const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));
  const locale = async (lang) => (await import(pathToFileURL(resolve(ROOT, `src/locales/${lang}.porto.js`)).href)).landmarks || {};
  const quest = read('data/quest.json');
  const landmarks = read('data/landmarks.json');
  // the photo of every stop: its pixel size, and whether a WebP copy exists
  const photos = {};
  const ids = new Set(quest.routes.flatMap((r) => r.stops.map((st) => st.id)));
  for (const l of landmarks) {
    if (!ids.has(l.id) || !l.image) continue;
    const path = resolve(ROOT, String(l.image).replace(/^\/+/, ''));
    if (!existsSync(path)) continue;
    const size = /\.jpe?g$/i.test(path) ? jpegSize(readFileSync(path)) : null;
    const webp = path.replace(/\.jpe?g$/i, '.webp');
    photos[l.id] = { ...size, webp: webp !== path && existsSync(webp) };
  }
  return {
    quest,
    landmarks,
    photos,
    tr: { en: await locale('en'), pt: await locale('pt') },
    site: (read('cities/porto.json').domain || 'http://localhost:5174').replace(/\/+$/, ''),
    cityName: 'Porto 3D',
  };
}

// every page's URL path, for the sitemap
export function routePagePaths(quest) {
  return [null, ...quest.routes.map((r) => r.id)].flatMap((id) => LANGS.map((lang) => dir(id, lang)));
}

// -> [{ path: 'public/route/.../index.html', html }]
export function renderRoutePages({ quest, landmarks, photos = {}, tr, site, cityName }) {
  const byId = new Map(landmarks.map((l) => [l.id, l]));
  const pages = [];
  for (const lang of LANGS) {
    const s = (key, vars = {}) => (quest.ui[key]?.[lang] ?? key).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    const pick = (o) => o?.[lang] ?? '';
    // a landmark's name and period in this language; the Russian data is the fallback
    const place = (id) => {
      const l = byId.get(id);
      const t = lang === 'ru' ? {} : tr[lang]?.[id] || {};
      const name = lang === 'ru' ? l.name_ru : t.name || l.name_pt || l.name_ru;
      const year = lang === 'ru' ? l.year : t.year ?? (CYRILLIC.test(String(l.year ?? '')) ? '' : l.year);
      return { l, name, year: year ?? '' };
    };
    const routes = quest.routes.map((r) => ({ ...r, stops: r.stops.filter((st) => byId.has(st.id)) }));

    const page = ({ id, title, desc, main }) => {
      const here = dir(id, lang);
      const alt = LANGS.map((g) => `    <link rel="alternate" hreflang="${HTML_LANG[g]}" href="${site}${dir(id, g)}" />`).join('\n');
      const switcher = LANGS.map((g) =>
        g === lang
          ? `<li><a href="${dir(id, g)}" lang="${HTML_LANG[g]}" aria-current="page">${LANG_NAME[g]}</a></li>`
          : `<li><a href="${dir(id, g)}" lang="${HTML_LANG[g]}" hreflang="${HTML_LANG[g]}">${LANG_NAME[g]}</a></li>`,
      ).join('');
      return `<!doctype html>
<html lang="${HTML_LANG[lang]}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(title)} — ${esc(cityName)}</title>
    <meta name="description" content="${esc(desc)}" />
    <link rel="canonical" href="${site}${here}" />
${alt}
    <link rel="alternate" hreflang="x-default" href="${site}${dir(id, 'pt')}" />
    <meta name="theme-color" content="#14213a" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="${esc(cityName)}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${site}${here}" />
    <link rel="icon" href="/icons/icon-192.png" />
    <style>
      :root { color-scheme: light; }
      body { margin: 0; background: #f6f3ec; color: #14213a; font: 17px/1.6 Georgia, 'Times New Roman', serif; }
      header, main, footer { max-width: 44rem; margin: 0 auto; padding: 0 20px; }
      header { padding-top: 16px; font: 15px/1.5 system-ui, sans-serif; }
      header ul { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 0; padding: 0; list-style: none; }
      header nav + p { margin: 8px 0 0; }
      h1 { margin: 24px 0 8px; font: 700 2rem/1.15 system-ui, sans-serif; }
      h2 { margin: 0 0 4px; font: 700 1.4rem/1.25 system-ui, sans-serif; }
      h3 { margin: 18px 0 4px; font: 700 0.95rem/1.3 system-ui, sans-serif; text-transform: uppercase; letter-spacing: 0.06em; }
      a { color: #1d4e9e; text-underline-offset: 2px; }
      a:focus-visible { outline: 3px solid #e0a948; outline-offset: 2px; }
      [aria-current='page'] { color: #14213a; font-weight: 700; text-decoration: none; }
      .lead { font-size: 1.1rem; }
      .map { display: inline-block; margin: 4px 0 8px; padding: 10px 16px; color: #fff; background: #1d4e9e; border-radius: 8px; font: 600 16px/1.3 system-ui, sans-serif; text-decoration: none; }
      .note, figcaption, .period { color: #4b5875; font: 14px/1.5 system-ui, sans-serif; }
      .stops { margin: 24px 0; padding: 0; list-style: none; }
      .stops > li { margin: 0 0 32px; padding: 20px 0 0; border-top: 1px solid #c9d3e6; }
      .period { margin: 0 0 12px; }
      figure { margin: 0 0 12px; }
      img { display: block; width: 100%; height: auto; max-height: 360px; object-fit: cover; border-radius: 8px; background: #dde4f0; }
      figcaption { margin-top: 4px; }
      .routes { padding: 0; list-style: none; }
      .routes li { margin: 0 0 24px; }
      footer { padding-bottom: 32px; font: 14px/1.5 system-ui, sans-serif; color: #4b5875; }
    </style>
  </head>
  <body>
    <header>
      <nav aria-label="${esc(s('languages'))}"><ul>${switcher}</ul></nav>
${id ? `      <p><a href="${dir(null, lang)}">← ${esc(s('all_routes'))}</a></p>\n` : ''}    </header>
    <main>
${main}
    </main>
    <footer>
      <p><a href="/?lang=${lang}">${esc(cityName)}</a> · ${esc(s('note'))}</p>
    </footer>
  </body>
</html>
`;
    };

    // the routes list
    {
      const items = routes
        .map((r) => {
          const names = r.stops.map((st) => place(st.id).name).join(' · ');
          return `        <li>
          <h2><a href="${dir(r.id, lang)}">${esc(pick(r.title))}</a></h2>
          <p>${esc(textIntro(pick(r.intro)))}</p>
          <p class="note">${esc(names)}</p>
        </li>`;
        })
        .join('\n');
      const main = `      <h1>${esc(s('kicker'))}</h1>
      <p class="lead">${esc(s('text_lead'))}</p>
      <p><a class="map" href="/?lang=${lang}#quest">${esc(s('open_map_all'))}</a></p>
      <ul class="routes">
${items}
      </ul>`;
      pages.push({ path: `public${dir(null, lang)}index.html`, html: page({ id: null, title: s('kicker'), desc: s('text_lead'), main }) });
    }

    // one page per route
    for (const r of routes) {
      const mapLink = `<a class="map" href="/?lang=${lang}#quest=${r.id}">${esc(s('open_map'))}</a>`;
      const stops = r.stops
        .map((st, i) => {
          const { l, name, year } = place(st.id);
          const hid = `stop-${st.id}`;
          const c = l.image_credit || {};
          const who = [c.author, c.license].filter(Boolean).join(', ');
          const credit = who ? `${esc(s('photo'))}: ${c.source_url ? `<a href="${esc(c.source_url)}">${esc(who)}</a>` : esc(who)}` : '';
          const src = `/${String(l.image || '').replace(/^\/+/, '')}`;
          const ph = photos[st.id] || {};
          // width/height reserve the photo's box before it loads (no layout shift)
          const dims = ph.w && ph.h ? ` width="${ph.w}" height="${ph.h}"` : '';
          const img = `<img src="${esc(src)}"${dims} alt="${esc(name)}" loading="lazy" decoding="async" />`;
          const pic = ph.webp ? `<picture><source type="image/webp" srcset="${esc(src.replace(/\.jpe?g$/i, '.webp'))}" />${img}</picture>` : img;
          const photo = l.image
            ? `          <figure>
            ${pic}
${credit ? `            <figcaption>${credit}</figcaption>\n` : ''}          </figure>\n`
            : '';
          const sources = (l.sources || []).map((q) => `            <li><a href="${esc(q.url)}">${esc(sourceName(q, lang))}</a></li>`).join('\n');
          return `        <li>
          <article aria-labelledby="${hid}">
          <h2 id="${hid}">${esc(name)}</h2>
          <p class="period">${esc(s('stop', { n: i + 1, m: r.stops.length }))}${year ? ` · ${esc(year)}` : ''}</p>
${photo}${pick(st.text).map((line) => `          <p>${esc(line)}</p>`).join('\n')}
          <h3>${esc(s('visit'))}</h3>
          <p>${esc(pick(st.visit).join(' '))}</p>
          <h3>${esc(s('sources'))}</h3>
          <ul>
${sources}
          </ul>
          </article>
        </li>`;
        })
        .join('\n');
      const lead = textIntro(pick(r.intro));
      const main = `      <h1>${esc(pick(r.title))}</h1>
      <p class="lead">${esc(lead)}</p>
      <p>${mapLink}</p>
      <ol class="stops" aria-label="${esc(s('places'))}">
${stops}
      </ol>
      <p>${mapLink}</p>`;
      pages.push({ path: `public${dir(r.id, lang)}index.html`, html: page({ id: r.id, title: pick(r.title), desc: lead, main }) });
    }
  }
  return pages;
}

// write (or with check: compare) the pages; returns the stale paths
export function writeRoutePages(pages, { check = false, log = console.log } = {}) {
  const stale = [];
  for (const { path, html } of pages) {
    const file = resolve(ROOT, path);
    const now = existsSync(file) ? readFileSync(file, 'utf8') : null;
    if (now === html) continue;
    stale.push(path);
    if (check) continue;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
    log(`wrote ${path}`);
  }
  return stale;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const inputs = await loadInputs();
  if (!inputs) {
    console.log('no data/quest.json here: no route pages');
    process.exit(0);
  }
  const check = process.argv.includes('--check');
  const stale = writeRoutePages(renderRoutePages(inputs), { check });
  if (check && stale.length) {
    console.error(`stale route pages (run node scripts/route-pages.mjs):\n  ${stale.join('\n  ')}`);
    process.exit(1);
  }
  console.log(check ? 'route pages: up to date' : `route pages: ${stale.length} written`);
}
