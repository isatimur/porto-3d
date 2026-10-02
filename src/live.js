// «Сейчас в Браге»: the real sun and the real weather.
//
//   - the sun position for Braga at this instant (NOAA solar position
//     formulas, no dependency) drives the atmosphere continuously: sun
//     azimuth and elevation, sky colours, the night lights; recomputed
//     every minute;
//   - the current weather from Open-Meteo (no key), every 10 minutes:
//     weather_code and cloud_cover pick the weather state, the wind drives
//     the cloud drift;
//   - a badge: «Брага сейчас · 21° · закат в 19:42 · облачно».
// Offline, or when Open-Meteo fails, the sun still runs (it needs no
// network) and the last good reading (< 3 h old) is reused.
//
// The header controls «Погода» and «Сейчас в Браге» are built here, from
// JS, with the existing .tool classes, and mounted with mountTool() into
// the «sky» group of the header (the tools sheet on phones).
import { t, locale } from './i18n.js';
import { mountTool } from './ui.js';
import { CITY, cityT } from './city.js';

// The weather point and the zone come from cities/<id>.json (weather,
// timezone); read lazily, the config loads before start().
const HERE = () => CITY.weather || CITY.origin;
const tz = () => CITY.timezone || 'Europe/Lisbon';
const API = () =>
  `https://api.open-meteo.com/v1/forecast?latitude=${HERE().lat}&longitude=${HERE().lon}&current=temperature_2m,weather_code,cloud_cover,precipitation,wind_speed_10m,wind_direction_10m,is_day&timezone=${encodeURIComponent(tz())}`;
const SUN_EVERY = 60e3;
const WEATHER_EVERY = 10 * 60e3;
const CACHE_KEY = () => `${CITY.id}-live-weather`;

// ------------------------------------------------------------ solar position
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// NOAA: declination and equation of time for a Julian century T.
function sunParams(T) {
  const L0 = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = rad(M);
  const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(rad(omega));
  const decl = Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda)));
  const y = Math.tan(rad(eps / 2)) ** 2;
  const L0r = rad(L0);
  const eqTime = 4 * deg(y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr));
  return { decl, eqTime }; // radians, minutes
}
const century = (ms) => (ms / 86400000 + 2440587.5 - 2451545) / 36525;

// Sun azimuth (compass degrees, 0 north) and elevation (degrees, with
// atmospheric refraction) at an instant.
export function sunPosition(date = new Date(), lat = HERE().lat, lon = HERE().lon) {
  const ms = date.getTime();
  const { decl, eqTime } = sunParams(century(ms));
  const minutesUtc = (((ms / 60000) % 1440) + 1440) % 1440;
  const tst = (((minutesUtc + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  let ha = tst / 4 - 180;
  if (ha < -180) ha += 360;
  const phi = rad(lat);
  const cosZ = Math.min(1, Math.max(-1, Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(rad(ha))));
  const zen = Math.acos(cosZ);
  let el = 90 - deg(zen);
  // refraction (NOAA's piecewise fit), degrees
  const te = Math.tan(rad(el));
  let refr = 0;
  if (el > 85) refr = 0;
  else if (el > 5) refr = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (el > -0.575) refr = 1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711)));
  else refr = -20.772 / te;
  el += refr / 3600;
  const cosAz = (Math.sin(phi) * Math.cos(zen) - Math.sin(decl)) / (Math.cos(phi) * Math.sin(zen) || 1e-9);
  let az = deg(Math.acos(Math.min(1, Math.max(-1, cosAz))));
  az = ha > 0 ? (az + 180) % 360 : (540 - az) % 360;
  return { az, el };
}

// Sunrise and sunset (Date) of the Lisbon calendar day that holds `date`.
export function sunTimes(date = new Date(), lat = HERE().lat, lon = HERE().lon) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map((p) => [p.type, p.value]));
  const day = Date.UTC(+parts.year, +parts.month - 1, +parts.day);
  const phi = rad(lat);
  const at = (sign) => {
    // two passes: the second evaluates the sun at the first estimate
    let minutes = 720 - 4 * lon;
    for (let i = 0; i < 2; i++) {
      const { decl, eqTime } = sunParams(century(day + minutes * 60000));
      const cosH = Math.cos(rad(90.833)) / (Math.cos(phi) * Math.cos(decl)) - Math.tan(phi) * Math.tan(decl);
      if (cosH > 1 || cosH < -1) return null; // polar day or night: not at 41.5 N
      minutes = 720 - 4 * lon - eqTime + sign * 4 * deg(Math.acos(cosH));
    }
    return new Date(day + minutes * 60000);
  };
  return { sunrise: at(-1), sunset: at(1) };
}

// ------------------------------------------------------------ weather codes
// WMO weather_code (Open-Meteo) to a map state and a label.
export function weatherFromCode(code, cloud = 0, precip = 0) {
  const c = Number(code);
  if (c === 45 || c === 48) return { state: 'fog', label: 'туман' };
  if (c >= 95) return { state: 'rain', label: 'гроза' };
  if ((c >= 80 && c <= 82) || (c >= 61 && c <= 67)) return { state: 'rain', label: c >= 80 ? 'ливень' : 'дождь' };
  if (c >= 51 && c <= 57) return { state: 'rain', label: 'морось' };
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { state: 'overcast', label: 'снег' };
  if (precip > 0.2) return { state: 'rain', label: 'дождь' };
  if (c === 3 || cloud >= 88) return { state: 'overcast', label: 'пасмурно' };
  if (c === 2 || cloud >= 35) return { state: 'partly', label: 'облачно' };
  if (c === 1 || cloud >= 12) return { state: 'partly', label: 'малооблачно' };
  return { state: 'clear', label: 'ясно' };
}

// Deck cover for a reading: broken cloud follows the real cloud_cover (the
// deck is seen from above, so it stays under half the sky); the other
// states keep their own cover.
function coverFor(state, reading) {
  if (state !== 'partly') return null;
  return 0.12 + 0.5 * Math.min(1, Math.max(0, (reading.cloud ?? 40) / 100));
}

// ------------------------------------------------------------ controls
const WEATHER_LABEL = { clear: 'ясно', partly: 'облачно', overcast: 'пасмурно', rain: 'дождь', fog: 'туман' };

const CSS = `
.life-weather { position: relative; }
.life-weather > .tool .fx-name { color: var(--text-2); }
.life-weather > .tool .weather-state { color: var(--gold); }
.weather-menu { top: calc(100% + 8px); left: 0; min-width: 168px; padding: 6px; display: flex; flex-direction: column; gap: 1px; z-index: 3; }
.weather-menu button { padding: 6px 10px; text-align: left; font: inherit; font-size: 12.5px; color: var(--text-2); background: none; border: 0; border-radius: 4px; cursor: pointer; }
.weather-menu button:hover { color: #fff6e6; background: rgba(255, 240, 215, 0.06); }
.weather-menu button[aria-pressed='true'] { color: var(--gold); }
.weather-menu button:focus-visible { outline: 1px solid var(--gold); outline-offset: -1px; }
.weather-menu .weather-sep { height: 1px; margin: 4px 6px; background: rgba(240, 222, 192, 0.14); }
.life-live[aria-pressed='true'] { color: var(--gold); }
.life-live .live-dot { display: inline-block; width: 6px; height: 6px; margin: 0 6px 1px 0; border-radius: 50%; background: rgba(240, 222, 192, 0.35); vertical-align: middle; }
.life-live[aria-pressed='true'] .live-dot { background: #e0a948; box-shadow: 0 0 6px 1px rgba(224, 169, 72, 0.8); }
.life-break { flex-basis: 100%; height: 0; }
.life-badge { margin: 2px 0 0; padding: 5px 11px 6px; font-size: 12.5px; line-height: 1.2; color: #fff6e6; background: rgba(26, 21, 16, 0.5); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border: 1px solid rgba(224, 169, 72, 0.35); border-radius: 4px; white-space: nowrap; }
.life-badge .badge-dim { color: var(--text-2); }
@media (prefers-reduced-motion: no-preference) { .life-badge:not([hidden]) { animation: life-badge-in 0.5s ease both; } }
@keyframes life-badge-in { from { opacity: 0; transform: translateY(-4px); } }
.life-badge .badge-head { display: block; }
.life-badge .badge-line { display: block; margin-top: 3px; font-size: 11.5px; color: var(--text-2); }
.life-badge .badge-more { display: none; margin-left: 8px; padding: 0 6px; font: inherit; font-size: 11px; line-height: 16px; color: var(--gold); background: rgba(224, 169, 72, 0.12); border: 1px solid rgba(224, 169, 72, 0.35); border-radius: 8px; cursor: pointer; }
.life-badge .badge-more:focus-visible { outline: 1px solid var(--gold); outline-offset: 1px; }
@media (max-width: 900px) {
  /* denser: map labels pass under the badge on phones */
  .life-badge { font-size: 11.5px; white-space: normal; background: rgba(26, 21, 16, 0.72); }
  .life-badge .badge-more { display: inline-block; }
  .life-badge:not(.is-open) .badge-line { display: none; }
  .life-badge .badge-line { font-size: 11px; }
  .weather-menu { left: auto; right: 0; }
}
`;

function el(tag, attrs = {}, text = '') {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text) e.textContent = text;
  return e;
}

function mountControls({ onWeather, onLive }) {
  const bar = document.querySelector('.topbar');
  if (!bar) return null;
  if (!document.getElementById('porto-life-css')) document.head.append(el('style', { id: 'porto-life-css' }, CSS));

  const live = el('button', { type: 'button', class: 'tool life-live', id: 'live-toggle', 'aria-pressed': 'false', title: cityT('Реальное солнце и погода в {city_prep} сейчас') });
  live.append(el('span', { class: 'live-dot', 'aria-hidden': 'true' }), document.createTextNode(cityT('Сейчас в {city_prep}')));

  const wrap = el('div', { class: 'life-weather' });
  const toggle = el('button', { type: 'button', class: 'tool', id: 'weather-toggle', 'aria-expanded': 'false', 'aria-controls': 'weather-menu' });
  const state = el('span', { class: 'weather-state' }, t('ясно'));
  toggle.append(el('span', { class: 'fx-name' }, t('Погода:')), document.createTextNode(' '), state);
  const menu = el('div', { class: 'weather-menu glass', id: 'weather-menu', role: 'group', 'aria-label': t('Погода') });
  menu.hidden = true;
  const buttons = {};
  const liveBtn = el('button', { type: 'button', 'data-weather': 'live', 'aria-pressed': 'false' }, cityT('как сейчас в {city_prep}'));
  menu.append(liveBtn, el('div', { class: 'weather-sep', 'aria-hidden': 'true' }));
  buttons.live = liveBtn;
  for (const [k, label] of Object.entries(WEATHER_LABEL)) {
    buttons[k] = el('button', { type: 'button', 'data-weather': k, 'aria-pressed': 'false' }, t(label));
    menu.append(buttons[k]);
  }
  wrap.append(toggle, menu);

  const brk = el('div', { class: 'life-break', 'aria-hidden': 'true' });
  const badge = el('p', { class: 'life-badge', id: 'live-badge', 'aria-live': 'polite' });
  badge.hidden = true;
  brk.hidden = true;

  // in the «sky» group after the time of day (header row on desktop, the
  // tools sheet on phones); the badge gets its own line under the header
  mountTool(wrap, 'sky');
  mountTool(live, 'sky');
  bar.append(brk, badge);

  const open = (on) => {
    menu.hidden = !on;
    toggle.setAttribute('aria-expanded', String(on));
    // in the phone's tools sheet the menu opens inline: bring it into view
    if (on && menu.closest('.tools-sheet.is-open')) menu.scrollIntoView({ block: 'nearest' });
  };
  toggle.addEventListener('click', () => open(menu.hidden));
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-weather]');
    if (!b) return;
    open(false);
    onWeather(b.dataset.weather);
    toggle.focus();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !wrap.contains(e.target)) open(false);
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      open(false);
      toggle.focus();
    }
  });
  live.addEventListener('click', () => onLive());

  return {
    setWeather(name, isLive) {
      state.textContent = t(WEATHER_LABEL[name] || name);
      for (const [k, b] of Object.entries(buttons)) b.setAttribute('aria-pressed', String(isLive ? k === 'live' : k === name));
    },
    setLive(on) {
      live.setAttribute('aria-pressed', String(on));
      badge.hidden = !on;
      brk.hidden = !on;
    },
    setBadge(parts, extras = []) {
      badge.textContent = '';
      const head = el('span', { class: 'badge-head' });
      parts.forEach((p, i) => {
        if (i) head.append(el('span', { class: 'badge-dim', 'aria-hidden': 'true' }, ' · '));
        head.append(i === 0 ? el('span', { class: 'badge-dim' }, p) : document.createTextNode(p));
      });
      badge.append(head);
      if (!extras.length) return;
      // aircraft, buses, traffic: one line each; folded on phones behind a
      // small toggle (the open state survives the re-render)
      const more = el('button', { type: 'button', class: 'badge-more', 'aria-expanded': String(badge.classList.contains('is-open')), title: t('Подробнее') }, `+${extras.length}`);
      more.addEventListener('click', () => {
        const on = !badge.classList.contains('is-open');
        badge.classList.toggle('is-open', on);
        more.setAttribute('aria-expanded', String(on));
      });
      head.append(more);
      for (const x of extras) badge.append(el('span', { class: 'badge-line' }, x));
    },
  };
}

// ------------------------------------------------------------ controller
export function createLive({ atmosphere, weather, reducedMotion = false, onPersist = () => {} }) {
  const read = (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  };
  const write = (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // storage blocked: the choice lasts for this page
    }
  };
  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  // ?now=2026-09-28T19:30 (Lisbon local time, or any ISO instant): a fixed
  // clock for tests and screenshots
  // The clock starts at that instant and runs at 1x (a frozen clock would
  // make the buses jump back every second).
  let fixedNow = null;
  let fixedAt = 0;
  const qNow = query.get('now');
  if (qNow) {
    const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(qNow) ? qNow : `${qNow}${lisbonOffset(new Date(qNow + 'Z'))}`);
    if (!isNaN(d)) {
      fixedNow = d;
      fixedAt = performance.now();
    }
  }
  const now = () => (fixedNow ? new Date(fixedNow.getTime() + (performance.now() - fixedAt)) : new Date());

  let live = false;
  let manualWeather = null; // a state picked by hand while live
  let reading = null; // { temp, code, cloud, precip, wind, windDir, isDay, at, stale }
  let lastSun = -Infinity;
  let lastFetch = -Infinity;
  let fetching = false;
  let status = 'idle';

  const ui = mountControls({
    onWeather: (name) => {
      if (name === 'live') {
        if (!live) setLive(true);
        manualWeather = null;
        applyReading();
      } else {
        manualWeather = live ? name : null;
        weather.set(name);
        write('porto-weather', name);
      }
      ui?.setWeather(weather.name, live && !manualWeather);
      onPersist();
    },
    onLive: () => setLive(!live),
  });

  // a click on any time-of-day preset leaves live mode
  atmosphere.onChange((name) => {
    if (name !== 'live' && live) setLive(false, { fromTime: true });
  });
  weather.onChange((name) => ui?.setWeather(name, live && !manualWeather));

  function timeButtons(pressedNone) {
    if (!pressedNone) return;
    for (const b of document.querySelectorAll('#time-switch [data-time]')) b.setAttribute('aria-pressed', 'false');
  }

  function setLive(on, { fromTime = false } = {}) {
    on = !!on;
    if (on === live) return;
    live = on;
    write('porto-live', on ? '1' : '0');
    ui?.setLive(on);
    if (on) {
      manualWeather = null;
      lastSun = -Infinity;
      tickSun(true);
      timeButtons(true);
      const cached = cachedReading();
      if (cached) {
        reading = cached;
        applyReading();
      }
      lastFetch = -Infinity; // fetch on the next update
    } else if (!fromTime) {
      // back to the preset the user had before
      const saved = read('porto-time');
      atmosphere.setTime(['morning', 'day', 'sunset', 'night'].includes(saved) ? saved : 'sunset', { animate: !reducedMotion });
      for (const b of document.querySelectorAll('#time-switch [data-time]')) b.setAttribute('aria-pressed', String(b.dataset.time === atmosphere.time));
    }
    ui?.setWeather(weather.name, live && !manualWeather);
    updateBadge();
    onPersist();
  }

  function tickSun(animate = false) {
    const p = sunPosition(now());
    atmosphere.setSun(p.az, p.el, { animate: animate && !reducedMotion });
    lastSun = performance.now();
    sun = p;
  }
  let sun = null;

  function cachedReading() {
    try {
      const c = JSON.parse(read(CACHE_KEY()) || 'null');
      if (c && Date.now() - c.at < 3 * 3600e3) return { ...c, stale: true };
    } catch {
      // a broken cache is ignored
    }
    return null;
  }

  async function fetchWeather() {
    if (fetching) return;
    fetching = true;
    lastFetch = performance.now();
    status = 'fetching';
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(API(), { signal: ctl.signal });
      clearTimeout(timer);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const c = j.current;
      if (!c || typeof c.weather_code !== 'number') throw new Error('no current block');
      reading = {
        temp: c.temperature_2m,
        code: c.weather_code,
        cloud: c.cloud_cover ?? 0,
        precip: c.precipitation ?? 0,
        wind: (c.wind_speed_10m ?? 10) / 3.6, // km/h to m/s
        windDir: c.wind_direction_10m ?? 250,
        isDay: c.is_day,
        at: Date.now(),
        stale: false,
      };
      write(CACHE_KEY(), JSON.stringify(reading));
      status = 'ok';
    } catch (e) {
      // offline or blocked: keep the sun, reuse a recent reading if any
      status = `offline: ${e.message}`;
      console.info(`[porto] Open-Meteo unavailable (${e.message}); live mode keeps the real sun`);
      reading = reading || cachedReading();
    } finally {
      fetching = false;
    }
    if (live) applyReading();
    updateBadge();
  }

  function applyReading() {
    if (!live || !reading || manualWeather) return;
    const w = weatherFromCode(reading.code, reading.cloud, reading.precip);
    // the deck cover follows the real cloud cover within the state
    weather.set(w.state, { cover: coverFor(w.state, reading) });
    weather.setWind(reading.wind * 2.2, reading.windDir); // the deck wind is stronger than at 10 m
    updateBadge();
  }

  const fmt = () => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz() });
  function updateBadge() {
    if (!ui || !live) return;
    const n = now();
    const today = sunTimes(n);
    let next;
    if (today.sunrise && n < today.sunrise) next = `${t('восход в')} ${fmt().format(today.sunrise)}`;
    else if (today.sunset && n < today.sunset) next = `${t('закат в')} ${fmt().format(today.sunset)}`;
    else {
      const tomorrow = sunTimes(new Date(n.getTime() + 86400e3));
      next = `${t('восход в')} ${fmt().format(tomorrow.sunrise)}`;
    }
    const parts = [cityT('{city} сейчас')];
    if (reading && Number.isFinite(reading.temp)) parts.push(`${Math.round(reading.temp)}°`);
    parts.push(next);
    if (reading) parts.push(t(weatherFromCode(reading.code, reading.cloud, reading.precip).label));
    else if (status.startsWith('offline')) parts.push(t('нет данных о погоде'));
    const lines = EXTRA_ORDER.map((k) => extras[k]).filter(Boolean);
    // re-render only on a change: the badge is a polite live region
    const key = parts.join('|') + '||' + lines.join('|');
    if (key === badgeKey) return;
    badgeKey = key;
    ui.setBadge(parts, lines);
  }
  // extra badge lines from the live layers (life.js): aircraft, buses, traffic
  const EXTRA_ORDER = ['air', 'bus', 'traffic'];
  const extras = {};
  let badgeKey = '';
  function setExtra(k, text) {
    if ((extras[k] ?? null) === (text ?? null)) return;
    extras[k] = text ?? null;
    updateBadge();
  }

  // Called from the render loop (life.js): no timers, so a hidden tab
  // neither fetches nor recomputes.
  function update() {
    if (!live) return;
    const tNow = performance.now();
    if (tNow - lastSun > SUN_EVERY) {
      tickSun(false);
      updateBadge();
    }
    if (tNow - lastFetch > WEATHER_EVERY) fetchWeather();
  }

  // ---- restore: hash (#live=1, #time=live, #weather=rain) before storage
  const hWeather = hash.get('weather');
  const sWeather = read('porto-weather');
  const startWeather = hWeather || sWeather;
  if (startWeather && startWeather !== 'clear') weather.set(startWeather, { instant: true });
  ui?.setWeather(weather.name, false);
  const wantLive = hash.get('live') === '1' || hash.get('time') === 'live' || (hash.get('live') !== '0' && !hash.get('time') && read('porto-live') === '1');
  if (wantLive) {
    // instant on load: no blend from the default sunset
    live = true;
    write('porto-live', '1');
    ui?.setLive(true);
    const p = sunPosition(now());
    sun = p;
    atmosphere.setSun(p.az, p.el, { animate: false });
    lastSun = performance.now();
    timeButtons(true);
    reading = cachedReading();
    if (reading) {
      const w = weatherFromCode(reading.code, reading.cloud, reading.precip);
      weather.set(w.state, { instant: true, cover: coverFor(w.state, reading) });
    }
    updateBadge();
  }

  return {
    update,
    setLive,
    setExtra,
    // the clock of live mode: real time, or the ?now= / setNow() instant
    now,
    get live() {
      return live;
    },
    get sun() {
      return sun;
    },
    get reading() {
      return reading;
    },
    get status() {
      return status;
    },
    // tests: a fixed clock, and a canned reading instead of the network
    setNow(d) {
      fixedNow = d ? new Date(d) : null;
      fixedAt = performance.now();
      if (live) {
        tickSun(false);
        updateBadge();
      }
    },
    mock(r) {
      reading = { temp: 21, code: 2, cloud: 50, precip: 0, wind: 4, windDir: 250, isDay: 1, at: Date.now(), stale: false, ...r };
      lastFetch = performance.now();
      applyReading();
    },
    // the hash fragment the map can carry (main.js currentHash)
    get hash() {
      if (live) return 'live=1';
      return weather.name !== 'clear' ? `weather=${weather.name}` : '';
    },
  };
}

// "+01:00" / "+00:00": the Lisbon UTC offset at an instant
function lisbonOffset(d) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz(), timeZoneName: 'shortOffset' }).formatToParts(isNaN(d) ? new Date() : d).find((x) => x.type === 'timeZoneName')?.value || 'GMT';
  const m = /GMT([+-]\d+)?(?::(\d\d))?/.exec(p);
  const h = m?.[1] ? +m[1] : 0;
  return `${h < 0 ? '-' : '+'}${String(Math.abs(h)).padStart(2, '0')}:${m?.[2] || '00'}`;
}
