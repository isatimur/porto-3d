// The Layers panel and the status pill (ported from braga-3d, which took
// them from lisboa-3d).
//
// Panel (#layers, the «Атмосфера» popover look): a switch per optional layer
// (layer-defs.js) with its measured transfer size from <data_dir>/layers.json,
// the total of the switched-on layers, and the presets. Opened from the
// menu («Слои карты») or from the pill. Esc and × close it.
//
// Pill (#load-status): one line about what is loading now, always true to
// the data it reads (load-status.js summarize): "Loading this area… 3 of 8",
// "Area loaded", or "2 parts failed · Retry". Fixed position, so it never
// moves the layout; hidden when there is nothing to say. The text a screen
// reader hears (role=status, aria-live=polite) changes only with the state,
// not with every count.
//
// Porto: the pill stays out of the four guided modes: the route fly-along
// (routes.js; no body class, main.js passes flying()), the history routes
// (quest.js, body.is-quest), the story and cinema. While one runs the pill
// is hidden (style.css and here), its live region says nothing, an open
// panel closes, and the panel does not open (PANEL_MODES). None of these
// modes needs an optional layer: the landmarks, the route lines and the
// stops of the history routes are core.
import { t, language } from './i18n.js';
import { LAYERS, PRESET_ORDER, selectionBytes, formatMB } from './layer-defs.js';
import { summarize } from './load-status.js';
import { mountTool, toolsSheet } from './ui.js';

const PRESET_NAMES = { light: 'Лёгкий', compact: 'Компактный', standard: 'Стандарт', full: 'Полный' };
const STATE_NAMES = { off: 'не загружается', waiting: 'ждёт загрузки карты', loading: 'загрузка…', ready: 'загружено', failed: 'не загрузилось' };
const NARROW_Q = '(max-width: 900px)';
// the body classes of the modes that hide the pill (style.css keeps the same list)
const PILL_MODES = '.is-quest, .is-story, .is-cinema';
// the modes in which the panel does not open: it would cover their own
// controls (the route card's Stop button in the fly-along, the stop card of
// a history route, the control bar of the story and of cinema)
const PANEL_MODES = '.is-quest, .is-story, .is-cinema';

// layers: createLayers(); stateOf(id) -> 'off' | 'waiting' | 'loading' |
// 'ready' | 'failed'; sources() -> load-status entries; retry(id);
// flying() -> true while the route fly-along runs
export function createLayersUI({ layers, stateOf, sources, retry, reducedMotion = false, flying = () => false }) {
  const app = document.getElementById('app') || document.body;
  const embed = () => document.documentElement.matches('.is-embed');
  const inMode = () => document.body.matches(PILL_MODES) || embed() || flying();
  const blocksPanel = () => document.body.matches(PANEL_MODES) || embed() || flying();

  // ------------------------------------------------------------ pill
  const pill = document.createElement('div');
  pill.className = 'load-status';
  pill.id = 'load-status';
  pill.dataset.state = 'idle';
  if (reducedMotion) pill.classList.add('is-still');
  pill.innerHTML = `
    <span class="ls-dot" aria-hidden="true"></span>
    <span class="ls-text" aria-hidden="true"></span>
    <span class="ls-bar" aria-hidden="true"><i></i></span>
    <button type="button" class="ls-retry" hidden>${t('Повторить')}</button>
    <button type="button" class="ls-open" aria-controls="layers" aria-expanded="false">${t('Слои')}</button>`;
  app.append(pill);
  // the live region stays in the page, outside the pill: text added to a
  // region in the frame it stops being hidden is often not announced
  const pLive = document.createElement('span');
  pLive.className = 'ls-live sr-only';
  pLive.id = 'load-status-live';
  pLive.setAttribute('role', 'status');
  pLive.setAttribute('aria-live', 'polite');
  app.append(pLive);
  const pText = pill.querySelector('.ls-text');
  const pBar = pill.querySelector('.ls-bar i');
  const pRetry = pill.querySelector('.ls-retry');
  const pOpen = pill.querySelector('.ls-open');
  let last = { state: 'idle', text: '', id: null };
  let retryId = null;
  let muted = false;

  // phones: the header wraps (search, then the mode buttons, then the live
  // badge), so the pill sits just under whatever the header holds
  function placePill() {
    if (!window.matchMedia(NARROW_Q).matches) {
      pill.style.top = '';
      return;
    }
    const bar = document.getElementById('topbar');
    let bottom = 0;
    for (const n of bar?.children || []) {
      const r = n.getBoundingClientRect();
      if (r.height && getComputedStyle(n).position !== 'fixed' && !n.matches('.tools-sheet')) bottom = Math.max(bottom, r.bottom);
    }
    if (bottom) pill.style.top = `${Math.round(bottom + 8)}px`;
  }
  window.addEventListener('resize', placePill);

  function tick() {
    const s = summarize(sources(), { now: Date.now(), t });
    // the header can grow while the pill shows (the live badge arrives)
    if (s.state !== 'idle') placePill();
    // a mode hides the pill: its live region says nothing until it is back
    const hide = inMode();
    if (hide !== muted) {
      muted = hide;
      pLive.textContent = '';
      // (the fly-along has no body class: the pill hides by its own class)
      pill.classList.toggle('is-mode', hide);
      if (!hide) last = { state: 'idle', text: '', id: null }; // say the state again once back
    }
    // a mode without a body class (the fly-along) closes an open panel here
    if (open && blocksPanel()) set(false, { focus: false });
    if (s.text !== last.text || s.state !== last.state) {
      pText.textContent = s.text;
      pill.dataset.state = s.state;
      // announce a new state (or a new thing loading), not each count
      if (!muted && (s.state !== last.state || s.id !== last.id)) pLive.textContent = s.state === 'idle' ? '' : s.say || s.text;
      retryId = s.retry || null;
      pRetry.hidden = !retryId;
    }
    pBar.style.transform = `scaleX(${s.state === 'loading' && s.total > 0 ? Math.min(1, s.done / s.total).toFixed(3) : s.state === 'done' ? 1 : 0})`;
    last = s;
    if (open) syncPanel();
  }
  pRetry.addEventListener('click', () => retryId && retry(retryId));
  pOpen.addEventListener('click', () => set(!open));

  // ------------------------------------------------------------ panel
  const pop = document.createElement('div');
  pop.className = 'atmo layers';
  pop.id = 'layers';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-labelledby', 'layers-title');
  pop.hidden = true;
  const rows = LAYERS.map(
    (l) => `<li class="layer-row" data-layer="${l.id}">
      <label class="layer-label">
        <input type="checkbox" role="switch" class="layer-switch" data-layer="${l.id}" aria-describedby="layer-hint-${l.id}" />
        <span class="layer-text"><span class="layer-name">${t(l.name)}</span><span class="layer-hint" id="layer-hint-${l.id}">${t(l.hint)}</span></span>
        <span class="layer-meta"><span class="layer-size"></span><span class="layer-state"></span></span>
      </label>
    </li>`,
  );
  pop.innerHTML = `
    <div class="atmo-head"><p class="atmo-title" id="layers-title">${t('Слои карты')}</p><button type="button" class="atmo-close" aria-label="${t('Закрыть')}">×</button></div>
    <p class="layers-note">${t('Основа карты (рельеф, улицы, здания центра, достопримечательности, мосты и река) загружается всегда. Выключенный слой не скачивается.')}</p>
    <p class="atmo-h" id="layers-presets">${t('Набор')}</p>
    <div class="atmo-row" role="group" aria-labelledby="layers-presets">${PRESET_ORDER.map((p) => `<button type="button" class="atmo-opt" data-preset="${p}" aria-pressed="false">${t(PRESET_NAMES[p])}</button>`).join('')}</div>
    <p class="atmo-h">${t('Слои')}</p>
    <ul class="layer-list">${rows.join('')}</ul>
    <p class="layers-total" aria-live="polite"></p>
    <p class="layers-class"></p>`;
  app.append(pop);
  const total = pop.querySelector('.layers-total');
  const classNote = pop.querySelector('.layers-class');

  function sizeText(id) {
    const m = layers.manifest?.layers?.[id];
    if (!m || !Number.isFinite(m.bytes)) return t('размер неизвестен');
    const def = LAYERS.find((l) => l.id === id);
    let s = formatMB(m.bytes, language);
    // streamed: every tile, the most the camera can make it fetch
    if (def?.streamed) s = t('до {size}').replace('{size}', s);
    if (def?.liveExtra) s = `${s} + ${t('живые данные')}`;
    return s;
  }
  function syncPanel() {
    const sel = layers.selection;
    for (const b of pop.querySelectorAll('[data-preset]')) b.setAttribute('aria-pressed', String(layers.preset === b.dataset.preset));
    for (const l of LAYERS) {
      const row = pop.querySelector(`.layer-row[data-layer="${l.id}"]`);
      const sw = row.querySelector('input');
      sw.checked = !!sel[l.id];
      row.querySelector('.layer-size').textContent = sizeText(l.id);
      const st = stateOf(l.id);
      row.dataset.state = st;
      row.querySelector('.layer-state').textContent = t(STATE_NAMES[st] || '');
    }
    const on = selectionBytes(sel, layers.manifest);
    const all = selectionBytes(Object.fromEntries(LAYERS.map((l) => [l.id, true])), layers.manifest);
    // a streamed layer counts every tile: then the sum is a ceiling, said so
    const upTo = (s, streamed) => (streamed ? t('до {size}').replace('{size}', s) : s);
    const onStreamed = LAYERS.some((l) => l.streamed && sel[l.id]);
    total.textContent = on.unknown || all.unknown
      ? `${t('Выбрано слоёв:')} ${LAYERS.filter((l) => sel[l.id]).length} ${t('из')} ${LAYERS.length} (${t('размер неизвестен')})`
      : `${t('Выбрано:')} ${upTo(formatMB(on.bytes, language), onStreamed)} ${t('из')} ${upTo(formatMB(all.bytes, language), true)}`;
    classNote.textContent = `${t('Для этого устройства по умолчанию:')} ${t(PRESET_NAMES[layers.classPreset] || layers.classPreset)}`;
  }

  pop.addEventListener('change', (e) => {
    const sw = e.target.closest('.layer-switch');
    if (sw) layers.set(sw.dataset.layer, sw.checked);
    syncPanel();
  });
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (b) {
      layers.setPreset(b.dataset.preset);
      syncPanel();
    }
  });
  pop.querySelector('.atmo-close').addEventListener('click', () => set(false));

  // the menu entry, in the «Карта» group next to the legend
  const tool = document.createElement('button');
  tool.type = 'button';
  tool.className = 'tool';
  tool.id = 'layers-open';
  tool.setAttribute('aria-controls', 'layers');
  tool.setAttribute('aria-expanded', 'false');
  tool.textContent = t('Слои карты');
  mountTool(tool, 'legend', { closes: true });
  tool.addEventListener('click', () => set(true));

  let open = false;
  let opener = null;
  function place() {
    if (window.matchMedia(NARROW_Q).matches) {
      pop.style.left = '';
      pop.style.top = '';
      return;
    }
    const w = pop.offsetWidth || 360;
    const bar = document.getElementById('topbar')?.getBoundingClientRect();
    pop.style.left = `${Math.round(window.innerWidth - w - 12)}px`;
    pop.style.top = `${Math.round((bar?.bottom ?? 56) + 8)}px`;
  }
  function set(on, { focus = true } = {}) {
    if (on === open) return;
    if (on && blocksPanel()) return; // no panel over a guided mode's own controls
    open = on;
    if (on) {
      opener = document.activeElement;
      toolsSheet().set(false, { focus: false });
      layers.loadManifest().then(() => open && syncPanel());
      syncPanel();
      pop.hidden = false;
      place();
      requestAnimationFrame(() => pop.classList.add('is-open'));
      if (focus) pop.querySelector('[data-preset][aria-pressed="true"], .layer-switch')?.focus({ preventScroll: true });
    } else {
      pop.classList.remove('is-open');
      pop.hidden = true;
      if (focus && (pop.contains(document.activeElement) || document.activeElement === document.body)) (opener?.isConnected ? opener : pOpen).focus?.({ preventScroll: true });
    }
    for (const b of [tool, pOpen]) b.setAttribute('aria-expanded', String(on));
    document.body.classList.toggle('is-layers-open', on);
  }
  document.addEventListener('pointerdown', (e) => {
    if (open && !pop.contains(e.target) && !pill.contains(e.target) && e.target !== tool) set(false, { focus: false });
  });
  window.addEventListener(
    'keydown',
    (e) => {
      if (open && e.key === 'Escape') {
        e.stopPropagation();
        set(false);
      }
    },
    true,
  );
  window.addEventListener('resize', () => open && place());
  // a mode that starts while the panel is open (a #tour link, the menu, a
  // hash change) closes it: the panel's Esc would otherwise be the mode's
  new MutationObserver(() => {
    if (open && blocksPanel()) set(false, { focus: false });
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  layers.loadManifest();
  tick();
  const timer = setInterval(tick, 250);
  return {
    open: () => set(true),
    close: () => set(false, { focus: false }),
    get isOpen() {
      return open;
    },
    tick,
    stop: () => clearInterval(timer),
    get status() {
      return { ...last };
    },
  };
}
