// Sharing: share popover (link + embed code), postcards, ?ui=0 and
// ?embed=1 modes, the service worker registration.
//
// main.js calls installShare() once the scene runs. The ?ui=0 / ?embed=1
// classes apply at import time, before the first frame, so screenshots and
// iframes never show the chrome.
import { language, locale } from './i18n.js';
import { mountTool } from './ui.js';
import { CITY, cityName, cityT } from './city.js';

// the canonical site of this city (cities/<id>.json domain), else this origin
const SITE = () => CITY.domain || location.origin;
const SITE_HOST = () => SITE().replace(/^https?:\/\//, '').replace(/\/$/, '');

const STR = {
  postcard: { ru: 'Открытка', en: 'Postcard', pt: 'Postal' },
  link: { ru: 'Ссылка', en: 'Link', pt: 'Ligação' },
  copy: { ru: 'Копировать', en: 'Copy', pt: 'Copiar' },
  copied: { ru: 'Скопировано', en: 'Copied', pt: 'Copiado' },
  embed: { ru: 'Код для сайта', en: 'Embed code', pt: 'Código para incorporar' },
  shareTitle: { ru: 'Поделиться', en: 'Share', pt: 'Partilhar' },
  close: { ru: 'Закрыть', en: 'Close', pt: 'Fechar' },
  open: { ru: 'Открыть карту ↗', en: 'Open the map ↗', pt: 'Abrir o mapa ↗' },
  making: { ru: 'Готовим открытку…', en: 'Making the postcard…', pt: 'A preparar o postal…' },
  saved: { ru: 'Открытка сохранена:', en: 'Postcard saved:', pt: 'Postal guardado:' },
  failed: { ru: 'Не удалось сделать открытку', en: 'Could not make the postcard', pt: 'Não foi possível criar o postal' },
  linkCopied: { ru: 'Ссылка скопирована:', en: 'Link copied:', pt: 'Ligação copiada:' },
  copyManually: { ru: 'Скопируйте ссылку:', en: 'Copy the link:', pt: 'Copie a ligação:' },
};
// city strings come from the config: 'Брага' / 'Брага, Португалия' / '3D-карта Браги'
const CITY_STR = {
  city: () => cityName(),
  country: () => (CITY.country?.[language] ? `${cityName()}, ${CITY.country[language]}` : cityT('{city}, Португалия')),
  mapTitle: () => cityT('3D-карта {city_gen}'),
};
const tr = (k) => (CITY_STR[k] ? CITY_STR[k]() : (STR[k][language] ?? STR[k].en));

export const PRESETS = {
  '16x9': { w: 16, h: 9, label: '16:9' },
  '4x5': { w: 4, h: 5, label: '4:5 Instagram' },
  '9x16': { w: 9, h: 16, label: '9:16 Stories' },
};

// ------------------------------------------------------------ modes
const query = new URLSearchParams(location.search);
const hashAtLoad = new URLSearchParams(location.hash.replace(/^#/, ''));
// read once: main.js rewrites the hash (and drops ui=) on the first select()
export const uiOff = query.get('ui') === '0' || hashAtLoad.get('ui') === '0';
export const embedded = query.get('embed') === '1';
const root = document.documentElement;
root.classList.toggle('ui-off', uiOff);
root.classList.toggle('is-embed', embedded && !uiOff);

const CSS = `
.ui-off #app > :not(#scene), .ui-off .share-pop, .ui-off .embed-open { display: none !important; }
.is-embed .brand, .is-embed .topbar, .is-embed .side, .is-embed .detail, .is-embed .hint,
.is-embed .share-pop { display: none !important; }
.is-embed .instruments { bottom: 12px; }
.embed-open {
  position: fixed; top: 10px; right: 10px; z-index: 5;
  padding: 5px 11px 6px; border-radius: 999px;
  font: 500 12.5px/1.2 var(--sans); color: var(--text); text-decoration: none;
  background: rgba(26, 21, 16, 0.72); border: 1px solid rgba(224, 169, 72, 0.45);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
}
.embed-open:hover, .embed-open:focus-visible { color: #fff6e6; border-color: var(--gold); }
.share-pop {
  position: fixed; z-index: 6; width: min(340px, calc(100vw - 20px)); padding: 12px 14px 14px;
  color: var(--text); font-size: 13px;
}
.share-pop[hidden] { display: none !important; }
.share-pop-title { margin: 0 24px 8px 0; font: 600 20px/1.1 var(--serif); }
.share-pop-close { position: absolute; top: 6px; right: 8px; border: 0; background: none; color: var(--text-2); font-size: 20px; cursor: pointer; }
.share-h { margin: 10px 0 5px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-3); }
.share-row { display: flex; gap: 6px; flex-wrap: wrap; }
.share-field {
  flex: 1 1 160px; min-width: 0; padding: 5px 8px; border-radius: 8px;
  font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text-2);
  background: rgba(10, 7, 4, 0.4); border: 1px solid var(--line); resize: none;
}
textarea.share-field { flex-basis: 100%; height: 62px; }
.share-pop button.tool { cursor: pointer; }
.share-pop button.tool[aria-busy='true'] { opacity: 0.6; cursor: progress; }
`;
const style = document.createElement('style');
style.dataset.owner = 'share';
style.textContent = CSS;
document.head.append(style);

if (embedded && !uiOff) {
  const a = document.createElement('a');
  a.className = 'embed-open';
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = tr('open');
  // the hash follows the user's clicks: build the link when it is used
  const refresh = () => (a.href = appUrl());
  refresh();
  a.addEventListener('pointerenter', refresh);
  a.addEventListener('focus', refresh);
  a.addEventListener('click', refresh);
  document.body.append(a);
}

// Runtime translation of the social tags (crawlers read the static English).
// Called by installShare(), once the city config is loaded.
function applySocialTags() {
  for (const [sel, key] of [['meta[property="og:title"]', 'mapTitle'], ['meta[name="twitter:title"]', 'mapTitle']]) {
    document.querySelector(sel)?.setAttribute('content', `${tr(key)} · ${CITY.name.en} 3D`);
  }
}

// ------------------------------------------------------------ service worker
if (import.meta.env.PROD && 'serviceWorker' in navigator && !uiOff) {
  const register = () =>
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('[porto] service worker not registered', err));
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

// ------------------------------------------------------------ links
function hashParams() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  h.delete('ui');
  h.delete('scale'); // old links: real scale is the only view now
  return h;
}
// the app itself, without the embed / screenshot switches
function appUrl() {
  const u = new URL(location.href);
  for (const k of ['embed', 'ui', 'intro', 'fx']) u.searchParams.delete(k);
  const h = hashParams().toString();
  u.hash = h ? `#${h}` : '';
  return u.href.replace(/\?(?=#|$)/, '');
}

// Places get the static share page (its own preview image); routes and the
// overview keep the hash link.
export function shareLinks(placeIds) {
  const h = hashParams();
  const place = h.get('place');
  const route = h.get('route');
  const hashLink = appUrl();
  let link = hashLink;
  if (place && !route && placeIds.has(place)) {
    h.delete('place');
    const rest = h.toString();
    link = `${SITE()}/p/${place}/${rest ? `#${rest}` : ''}`;
  }
  const embedHash = route ? `#route=${route}` : place ? `#place=${place}` : '';
  const title = `${tr('mapTitle')}`.replace(/"/g, '&quot;');
  const embed = `<iframe src="${SITE()}/?embed=1${embedHash}" width="800" height="450" style="border:0;border-radius:12px" loading="lazy" allow="fullscreen; web-share" title="${title}"></iframe>`;
  return { link, hashLink, embed, place, route };
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

// ------------------------------------------------------------ postcard
function creditLine(terrainSource = '') {
  const s = String(terrainSource);
  const terrain = /eudem/i.test(s)
    ? 'EU-DEM v1.1 © Copernicus'
    : /srtm/i.test(s)
      ? 'SRTM (NASA/USGS)'
      : /open-?elevation/i.test(s)
        ? 'Open-Elevation'
        : '';
  return `© OpenStreetMap contributors (ODbL)${terrain ? ` · ${terrain}` : ''}`;
}

function today() {
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const long = d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  return { iso, long };
}

// Fit `text` on one line at most `maxW` wide, from `size` down.
function fitFont(ctx, text, weight, size, family, maxW) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > 10 && ctx.measureText(text).width > maxW) {
    s = Math.floor(s * 0.92);
    ctx.font = `${weight} ${s}px ${family}`;
  }
  return s;
}

function compose(frame, W, H, { title, subtitle, date, credit }) {
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const c = out.getContext('2d');
  c.drawImage(frame, 0, 0, W, H);
  const u = Math.min(W, H);
  // scrim under the text, bottom third
  const g = c.createLinearGradient(0, H * 0.55, 0, H);
  g.addColorStop(0, 'rgba(20, 17, 13, 0)');
  g.addColorStop(1, 'rgba(20, 17, 13, 0.72)');
  c.fillStyle = g;
  c.fillRect(0, H * 0.55, W, H * 0.45);
  // thin gold border, a hairline inside it
  const m = Math.round(u * 0.03);
  c.strokeStyle = 'rgba(224, 169, 72, 0.95)';
  c.lineWidth = Math.max(2, u * 0.0028);
  c.strokeRect(m, m, W - 2 * m, H - 2 * m);
  c.strokeStyle = 'rgba(224, 169, 72, 0.45)';
  c.lineWidth = Math.max(1, u * 0.001);
  const m2 = m + Math.round(u * 0.008);
  c.strokeRect(m2, m2, W - 2 * m2, H - 2 * m2);

  const serif = '"Cormorant Garamond", Georgia, serif';
  const sans = '"IBM Plex Sans", system-ui, sans-serif';
  const pad = m2 + Math.round(u * 0.035);
  const maxW = W - 2 * pad;
  c.textBaseline = 'alphabetic';
  c.shadowColor = 'rgba(10, 7, 4, 0.6)';
  c.shadowBlur = u * 0.012;

  const credSize = Math.max(11, Math.round(u * 0.016));
  const yCredit = H - pad;
  c.fillStyle = 'rgba(241, 232, 218, 0.72)';
  c.textAlign = 'left';
  fitFont(c, credit, 400, credSize, sans, maxW * 0.62);
  c.fillText(credit, pad, yCredit);
  c.textAlign = 'right';
  c.fillStyle = 'rgba(224, 169, 72, 0.95)';
  c.font = `500 ${credSize}px ${sans}`;
  c.fillText(SITE_HOST(), W - pad, yCredit);

  c.textAlign = 'left';
  const dateSize = Math.round(u * 0.03);
  const yDate = yCredit - credSize * 2.2;
  c.fillStyle = 'rgba(241, 232, 218, 0.92)';
  c.font = `400 ${dateSize}px ${sans}`;
  c.fillText(subtitle ? `${subtitle} · ${date}` : date, pad, yDate);

  const titleSize = fitFont(c, title, 600, Math.round(u * 0.11), serif, maxW);
  // baseline clears the date line by the serif's descenders
  const yTitle = yDate - dateSize * 1.25 - titleSize * 0.22;
  c.fillStyle = '#fff6e6';
  c.fillText(title, pad, yTitle);
  // a short gold rule above the title
  c.shadowBlur = 0;
  c.fillStyle = 'rgba(224, 169, 72, 0.95)';
  c.fillRect(pad, yTitle - titleSize * 0.95, Math.round(u * 0.07), Math.max(2, Math.round(u * 0.003)));
  return out;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ------------------------------------------------------------ install
// ctx: the running scene. getSize returns main.js' current { w, h, dpr }.
export function installShare(ctx) {
  const { renderer, scene, camera, fx, setFx, atmosphere, roadLayer, routeLayer, marks, landmarks, routes, getSize, ui } = ctx;
  const debug = (window.__porto = window.__porto || {});
  const placeIds = new Set(landmarks.map((l) => l.id));
  const toast = (msg, ms) => ui?.toast?.(msg, ms);
  applySocialTags();

  // Render the current view at 2x the CSS frame, effects on, and composite
  // the card. The WebGL canvas has no preserveDrawingBuffer: the frame is
  // copied with drawImage right after the render call, in the same task.
  async function makePostcard(preset = '16x9') {
    const p = PRESETS[preset] || PRESETS['16x9'];
    try {
      await Promise.all([
        document.fonts.load('600 64px "Cormorant Garamond"'),
        document.fonts.load('400 20px "IBM Plex Sans"'),
        document.fonts.load('500 20px "IBM Plex Sans"'),
      ]);
    } catch {
      // fonts may be blocked; the card falls back to Georgia / system-ui
    }
    const s = { ...getSize() };
    let fw = s.w;
    let fh = Math.round((s.w * p.h) / p.w);
    if (fh > s.h) {
      fh = s.h;
      fw = Math.round((s.h * p.w) / p.h);
    }
    const maxSide = Math.min(4096, renderer.capabilities.maxTextureSize || 4096, renderer.getContext().getParameter(renderer.getContext().MAX_RENDERBUFFER_SIZE) || 4096);
    const R = Math.min(2, maxSide / Math.max(fw, fh));
    const W = Math.floor(fw * R);
    const H = Math.floor(fh * R);

    const frame = document.createElement('canvas');
    frame.width = W;
    frame.height = H;
    const fctx = frame.getContext('2d');
    const wasFx = fx.enabled;
    const setAll = (w, h, dpr) => {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      roadLayer?.setResolution?.(w, h, dpr);
      routeLayer?.setResolution?.(w, h);
      marks?.setResolution?.(w, h);
      fx.setSize(w, h, dpr);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const draw = () => {
      if (fx.enabled) {
        fx.update(0, atmosphere.sunDir, atmosphere.night);
        fx.render();
      } else renderer.render(scene, camera);
    };
    try {
      if (!wasFx) setFx(true, { reason: 'postcard' });
      setAll(fw, fh, R);
      draw();
      fctx.drawImage(renderer.domElement, 0, 0, W, H);
    } finally {
      setAll(s.w, s.h, s.dpr);
      if (!wasFx) {
        const prev = debug.fx?.reason;
        setFx(false, { reason: 'postcard' });
        if (prev && debug.fx) debug.fx.reason = prev; // keep why it was off (user, low-end, url)
      }
      draw(); // the canvas was cleared by the resize: never show a blank frame
    }

    const { place, route } = shareLinks(placeIds);
    const lm = place ? landmarks.find((l) => l.id === place) : null;
    const rt = route ? routes.find((r) => r.id === route) : null;
    const d = today();
    const title = lm?.name || rt?.name || tr('city');
    const subtitle = lm || rt ? tr('country') : '';
    const card = compose(frame, W, H, { title, subtitle, date: d.long, credit: creditLine(debug.projection?.terrain) });
    const id = lm?.id || rt?.id || 'porto';
    return { canvas: card, name: `porto-${id === 'porto' ? 'city' : id}-${d.iso}.png`, W, H, preset };
  }

  // Download (or, on phones, the share sheet with the file).
  async function postcard(preset = '16x9', { save = true } = {}) {
    const res = await makePostcard(preset);
    const blob = await new Promise((r) => res.canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('toBlob failed');
    debug.lastPostcard = { name: res.name, w: res.W, h: res.H, preset, bytes: blob.size };
    if (!save) return { ...debug.lastPostcard, dataUrl: res.canvas.toDataURL('image/png') };
    const file = new File([blob], res.name, { type: 'image/png' });
    const phone = window.matchMedia('(pointer: coarse)').matches;
    let shared = false;
    if (phone && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: tr('postcard'), text: shareLinks(placeIds).link });
        shared = true;
      } catch (err) {
        // AbortError: the user closed the sheet, nothing to do.
        // NotAllowedError: the render outlived the click; fall back to a download.
        if (err?.name === 'AbortError') shared = true;
      }
    }
    if (!shared) download(blob, res.name);
    toast(`${tr('saved')} ${res.name}`, 3200);
    return debug.lastPostcard;
  }
  debug.postcard = postcard;

  // ---------------------------------------------------------- popover
  const shareBtn = document.getElementById('share');
  const pop = document.createElement('div');
  pop.className = 'share-pop glass';
  pop.id = 'share-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', tr('shareTitle'));
  pop.hidden = true;
  pop.innerHTML = `
    <p class="share-pop-title"></p>
    <button type="button" class="share-pop-close">×</button>
    <p class="share-h" data-s="link"></p>
    <div class="share-row">
      <input class="share-field" id="share-url" readonly spellcheck="false" />
      <button type="button" class="tool" data-act="copy-link"></button>
    </div>
    <p class="share-h" data-s="postcard"></p>
    <div class="share-row" id="postcard-presets">
      ${Object.entries(PRESETS).map(([k, v]) => `<button type="button" class="tool" data-preset="${k}">${v.label}</button>`).join('')}
    </div>
    <p class="share-h" data-s="embed"></p>
    <div class="share-row">
      <textarea class="share-field" id="share-embed" readonly spellcheck="false"></textarea>
      <button type="button" class="tool" data-act="copy-embed"></button>
    </div>`;
  pop.querySelector('.share-pop-title').textContent = tr('shareTitle');
  pop.querySelector('.share-pop-close').setAttribute('aria-label', tr('close'));
  for (const el of pop.querySelectorAll('[data-s]')) el.textContent = tr(el.dataset.s);
  for (const el of pop.querySelectorAll('[data-act]')) el.textContent = tr('copy');
  document.getElementById('app')?.append(pop) ?? document.body.append(pop);

  function place() {
    // phones: the buttons sit in the tools sheet at the bottom (closing as
    // the popover opens), so the popover goes under the header instead
    if (window.matchMedia('(max-width: 900px)').matches) {
      pop.style.left = `${Math.max(10, (window.innerWidth - (pop.offsetWidth || 340)) / 2)}px`;
      pop.style.top = '64px';
      return;
    }
    const anchor = (shareBtn?.offsetParent ? shareBtn : postcardBtn)?.getBoundingClientRect();
    const w = pop.offsetWidth || 340;
    const left = anchor ? Math.min(Math.max(10, anchor.left), window.innerWidth - w - 10) : 10;
    pop.style.left = `${left}px`;
    pop.style.top = `${anchor ? anchor.bottom + 8 : 60}px`;
  }
  function fill() {
    const l = shareLinks(placeIds);
    pop.querySelector('#share-url').value = l.link;
    pop.querySelector('#share-embed').value = l.embed;
    return l;
  }
  function openPop(focusSel) {
    fill();
    pop.hidden = false;
    place();
    pop.querySelector(focusSel || '[data-act="copy-link"]')?.focus({ preventScroll: true });
  }
  function closePop() {
    if (pop.hidden) return;
    pop.hidden = true;
  }
  pop.querySelector('.share-pop-close').addEventListener('click', closePop);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) {
      closePop();
      shareBtn?.focus({ preventScroll: true });
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!pop.hidden && !pop.contains(e.target) && e.target !== shareBtn && e.target !== postcardBtn) closePop();
  });
  window.addEventListener('resize', () => !pop.hidden && place());
  window.addEventListener('hashchange', () => !pop.hidden && fill());

  async function flash(btn, text) {
    const ok = await copyText(text);
    btn.textContent = ok ? tr('copied') : tr('copy');
    setTimeout(() => (btn.textContent = tr('copy')), 1600);
    return ok;
  }
  pop.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.act === 'copy-link') {
      const l = fill();
      debug.lastShare = l.link;
      await flash(btn, l.link);
    } else if (btn.dataset.act === 'copy-embed') {
      await flash(btn, fill().embed);
    } else if (btn.dataset.preset) {
      if (btn.getAttribute('aria-busy') === 'true') return;
      btn.setAttribute('aria-busy', 'true');
      toast(tr('making'), 8000);
      try {
        await postcard(btn.dataset.preset);
      } catch (err) {
        console.error('[porto] postcard failed', err);
        toast(tr('failed'), 4000);
      } finally {
        btn.removeAttribute('aria-busy');
      }
    }
  });

  // Take over the header share button: main.js' own listener sits on the
  // button, this capture listener on the document runs first and stops it.
  // The click still copies the link at once, then shows the popover.
  document.addEventListener(
    'click',
    async (e) => {
      if (!shareBtn || !e.target.closest?.('#share')) return;
      e.stopPropagation();
      if (!pop.hidden) return closePop();
      const l = fill();
      openPop();
      const ok = await copyText(l.link);
      debug.lastShare = l.link;
      toast(ok ? `${tr('linkCopied')} ${l.link.replace(/^https?:\/\//, '')}` : `${tr('copyManually')} ${l.link}`, ok ? 2600 : 6000);
    },
    true,
  );

  // Header button, created here so index.html's body stays untouched; it
  // joins «Поделиться» in the share group (the tools sheet on phones).
  let postcardBtn = document.getElementById('postcard');
  if (!postcardBtn && shareBtn) {
    postcardBtn = document.createElement('button');
    postcardBtn.type = 'button';
    postcardBtn.className = 'tool';
    postcardBtn.id = 'postcard';
    postcardBtn.textContent = tr('postcard');
    mountTool(postcardBtn, 'share', { closes: true });
  }
  postcardBtn?.addEventListener('click', () => (pop.hidden ? openPop('[data-preset="16x9"]') : closePop()));

  return { postcard, shareLinks: () => shareLinks(placeIds) };
}
