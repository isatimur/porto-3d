// «Спросить гида»: the talking guide. A visitor asks by voice or text
// ("что это за башня?", "как дойти до фуникулёра?") and gets a short answer
// from POST /api/guide (api/guide.js), grounded in this site's own place
// data, with sources. When the answer points at a place, the camera flies
// there and the place card opens (main.js select()).
//
// Entry points: a floating mic button (desktop: above the compass; phones:
// above the places sheet) and a «Гид» tool in the header's modes group
// (mountTool; on phones it sits in the Menu sheet). G opens the guide and
// focuses the question; Esc closes it.
// Voice: Web Speech API. SpeechRecognition (push-to-talk: hold the mic; a
// keyboard press toggles) where the browser has it; answers read aloud with
// speechSynthesis when «Озвучка» is on, or when the question came by voice.
// Not a <dialog>: main.js ignores every key while a dialog is open.
import { t, language, locale } from './i18n.js';
import { CITY } from './city.js';
import { mountTool } from './ui.js';
import { weatherFromCode } from './live.js';

const ENDPOINT = '/api/guide';
const VOICE_KEY = 'porto-guide-voice';
const MAX_Q = 300;
const NARROW = '(max-width: 900px)';
const WEATHER_EN = { clear: 'clear', partly: 'partly cloudy', overcast: 'overcast', drizzle: 'drizzle', rain: 'rain', downpour: 'heavy rain', seafog: 'sea fog', fog: 'fog', nortada: 'clear and windy (nortada)' };

const MIC = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8a2.2 2.2 0 0 0-2.2 2.2v4a2.2 2.2 0 0 0 4.4 0V4A2.2 2.2 0 0 0 8 1.8z"/><path d="M4 7.6a4 4 0 0 0 8 0M8 11.6v2.6M5.6 14.2h4.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
const SEND = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8h9M8 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const CSS = `
.guide-fab { position: fixed; left: 332px; bottom: 76px; z-index: 3; display: inline-flex; align-items: center; gap: 7px; height: 40px; padding: 0 15px 0 12px; font: inherit; font-size: 13px; color: #fff6e6; background: rgba(26, 21, 16, 0.72); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border: 1px solid rgba(224, 169, 72, 0.5); border-radius: 20px; cursor: pointer; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3); transition: border-color 0.2s, background 0.2s, opacity 0.4s; }
.guide-fab svg, .guide-tool svg { width: 16px; height: 16px; fill: var(--gold); flex: none; }
.guide-fab:hover { border-color: var(--gold); background: rgba(36, 28, 21, 0.85); }
.guide-tool svg { margin-right: 5px; vertical-align: -3px; }
.guide-tool[aria-expanded='true'] { color: var(--gold); }
body.is-guide-open .guide-fab { opacity: 0; pointer-events: none; }
.guide { position: fixed; left: 332px; bottom: 76px; z-index: 3; width: clamp(290px, calc(100vw - 332px - 452px), 390px); max-height: min(560px, calc(100vh - 170px)); display: flex; flex-direction: column; overflow: hidden; color: var(--text); transform: translateY(10px); opacity: 0; transition: transform 0.24s cubic-bezier(0.2, 0.7, 0.2, 1), opacity 0.2s; }
.guide.is-open { transform: none; opacity: 1; }
.guide-head { display: flex; align-items: center; gap: 8px; padding: 10px 10px 8px 16px; border-bottom: 1px solid var(--line); flex: none; }
.guide-title { margin: 0; flex: 1; font: italic 500 19px/1.1 var(--serif); color: var(--gold); }
.guide-voice, .guide-close { font: inherit; font-size: 12px; color: var(--text-2); background: none; border: 1px solid rgba(240, 222, 192, 0.18); border-radius: 12px; padding: 3px 9px; cursor: pointer; }
.guide-voice[aria-pressed='true'] { color: var(--gold); border-color: rgba(224, 169, 72, 0.5); }
.guide-close { width: 28px; height: 28px; padding: 0; border-radius: 50%; font-size: 15px; line-height: 1; }
.guide-voice:hover, .guide-close:hover { color: var(--text); border-color: rgba(224, 169, 72, 0.6); }
.guide-log { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px 16px 4px; display: flex; flex-direction: column; gap: 10px; scrollbar-width: thin; scrollbar-color: rgba(240, 222, 192, 0.2) transparent; }
.guide-intro { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-2); }
.guide-msg { margin: 0; font-size: 14px; line-height: 1.5; }
.guide-q { align-self: flex-end; max-width: 85%; padding: 6px 11px; background: rgba(224, 169, 72, 0.14); border: 1px solid rgba(224, 169, 72, 0.28); border-radius: 12px 12px 3px 12px; color: #fff6e6; }
.guide-a { align-self: stretch; color: var(--text); }
.guide-a.is-note { color: var(--text-2); font-size: 13px; }
.guide-a .guide-dev { display: block; margin-top: 4px; font-size: 12px; color: var(--text-3); }
.guide-a code { font-size: 11.5px; color: var(--gold); }
.guide-acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.guide-acts button, .guide-acts a { font: inherit; font-size: 12px; color: var(--gold); background: rgba(224, 169, 72, 0.1); border: 1px solid rgba(224, 169, 72, 0.35); border-radius: 12px; padding: 3px 10px; cursor: pointer; text-decoration: none; }
.guide-acts button:hover, .guide-acts a:hover { border-color: var(--gold); }
.guide-src { margin: 5px 0 0; font-size: 11.5px; color: var(--text-3); }
.guide-src a { color: var(--text-2); text-decoration: underline; text-decoration-color: rgba(240, 222, 192, 0.3); text-underline-offset: 2px; }
.guide-src a:hover { color: var(--text); text-decoration-color: var(--gold); }
.guide-wait { color: var(--text-2); font-size: 13px; font-style: italic; }
.guide-sugg { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 16px 2px; flex: none; }
.guide-sugg button { font: inherit; font-size: 12px; color: var(--text-2); background: rgba(255, 240, 215, 0.04); border: 1px solid rgba(240, 222, 192, 0.18); border-radius: 12px; padding: 4px 10px; cursor: pointer; text-align: left; }
.guide-sugg button:hover { color: var(--text); border-color: rgba(224, 169, 72, 0.55); }
.guide-form { display: flex; gap: 6px; align-items: center; padding: 8px 10px 10px 16px; flex: none; }
.guide-input { flex: 1; min-width: 0; height: 36px; padding: 0 12px; font: inherit; font-size: 14px; color: #fff6e6; background: rgba(10, 8, 6, 0.35); border: 1px solid rgba(240, 222, 192, 0.2); border-radius: 18px; }
.guide-input::placeholder { color: var(--text-3); }
.guide-input:focus-visible { outline: none; border-color: var(--gold); }
.guide-mic, .guide-send { flex: none; width: 36px; height: 36px; display: grid; place-items: center; padding: 0; color: var(--gold); background: rgba(224, 169, 72, 0.12); border: 1px solid rgba(224, 169, 72, 0.4); border-radius: 50%; cursor: pointer; touch-action: none; user-select: none; -webkit-user-select: none; }
.guide-mic svg, .guide-send svg { width: 17px; height: 17px; fill: currentColor; }
.guide-mic.is-listening { color: #1a1510; background: var(--gold); box-shadow: 0 0 0 4px rgba(224, 169, 72, 0.25); }
.guide-send:disabled { opacity: 0.45; cursor: default; }
.guide-foot { margin: 0; padding: 0 16px 10px; font-size: 11px; color: var(--text-3); flex: none; }
body.is-intro .guide-fab, body.is-cinema .guide-fab, body.is-story .guide-fab,
body.is-intro .guide, body.is-cinema .guide, body.is-story .guide { display: none; }
@media (max-width: 900px) {
  .guide-fab { left: 12px; bottom: calc(36vh + 12px); height: 44px; padding: 0 14px 0 12px; }
  .guide { left: 0; right: 0; bottom: 0; width: auto; max-height: none; height: min(62vh, 560px); border-radius: 14px 14px 0 0; transform: translateY(24px); }
  .guide-input { font-size: 16px; }
  /* the place card (64vh) owns the bottom of a phone screen */
  body:has(.detail.is-open) .guide-fab { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .guide, .guide-fab { transition: none; }
}
`;

function h(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'html') e.innerHTML = v; // static SVG icons only
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  if (text != null) e.textContent = text;
  return e;
}

// ctx (main.js): landmarks (localized, same order as the map), select(i),
// getActive() -> index or -1, project(lat, lon) -> { x, z }, rig (its
// controls.target is the view centre), reducedMotion, debug (window.__porto).
export function createGuide({ landmarks, select, getActive, project, rig, reducedMotion = false, debug = {} }) {
  if (!document.getElementById('porto-guide-css')) document.head.append(h('style', { id: 'porto-guide-css' }, CSS));
  const narrow = window.matchMedia(NARROW);
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const indexById = new Map(landmarks.map((l, i) => [l.id, i]));

  // world (x, z) back to lat/lon: project() is linear in each axis
  const o = CITY.origin || { lat: landmarks[0]?.lat ?? 0, lon: landmarks[0]?.lon ?? 0 };
  const p0 = project(o.lat, o.lon);
  const p1 = project(o.lat + 0.01, o.lon + 0.01);
  const kx = (p1.x - p0.x) / 0.01;
  const kz = (p1.z - p0.z) / 0.01;
  const unproject = (x, z) => ({ lat: +(o.lat + (z - p0.z) / kz).toFixed(5), lon: +(o.lon + (x - p0.x) / kx).toFixed(5) });

  // ---------------------------------------------------------------- DOM
  const fab = h('button', { type: 'button', class: 'guide-fab', 'aria-controls': 'guide', 'aria-expanded': 'false', title: t('Гид (G)'), html: MIC });
  fab.append(h('span', {}, t('Спросить гида')));
  document.body.append(fab);

  const tool = h('button', { type: 'button', class: 'tool mode-btn guide-tool', id: 'guide-toggle', 'aria-controls': 'guide', 'aria-expanded': 'false', title: t('Гид (G)'), html: MIC });
  tool.append(h('span', { class: 'mode-label' }, t('Гид')));
  mountTool(tool, 'modes', { closes: true });

  const panel = h('section', { class: 'guide glass', id: 'guide', role: 'region', 'aria-labelledby': 'guide-title', hidden: true });
  const head = h('div', { class: 'guide-head' });
  const title = h('h2', { class: 'guide-title', id: 'guide-title' }, t('Гид'));
  const canSpeak = 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
  let voiceOn = false;
  try {
    voiceOn = localStorage.getItem(VOICE_KEY) === '1';
  } catch {
    voiceOn = false;
  }
  const voiceBtn = h('button', { type: 'button', class: 'guide-voice', 'aria-pressed': String(voiceOn), hidden: !canSpeak }, t('Озвучка'));
  const closeBtn = h('button', { type: 'button', class: 'guide-close', 'aria-label': t('Закрыть гида (Esc)'), title: t('Закрыть гида (Esc)') }, '×');
  head.append(title, voiceBtn, closeBtn);

  const log = h('div', { class: 'guide-log', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' });
  log.append(h('p', { class: 'guide-intro' }, t('Спросите гида: что это за место, как дойти, что рядом.')));
  const sugg = h('div', { class: 'guide-sugg', role: 'group', 'aria-label': t('Подсказки') });
  const form = h('form', { class: 'guide-form' });
  const input = h('input', { type: 'text', class: 'guide-input', maxlength: String(MAX_Q), autocomplete: 'off', enterkeyhint: 'send', 'aria-label': t('Ваш вопрос'), placeholder: t('Что это? Как дойти? Где поесть?') });
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = h('button', { type: 'button', class: 'guide-mic', 'aria-pressed': 'false', 'aria-label': t('Микрофон'), title: t('Держите и говорите'), hidden: !SR, html: MIC });
  const send = h('button', { type: 'submit', class: 'guide-send', 'aria-label': t('Отправить'), title: t('Отправить'), html: SEND });
  form.append(input, mic, send);
  const foot = h('p', { class: 'guide-foot' }, t('Ответы гида — по данным этой карты. Проверяйте часы работы на месте.'));
  panel.append(head, log, sugg, form, foot);
  document.body.append(panel);

  // ---------------------------------------------------------------- open / close
  let open = false;
  function setOpen(on, { focus = true } = {}) {
    on = !!on;
    if (on === open) return;
    open = on;
    document.body.classList.toggle('is-guide-open', on);
    for (const b of [fab, tool]) b.setAttribute('aria-expanded', String(on));
    if (on) {
      panel.hidden = false;
      refreshSuggestions(true);
      requestAnimationFrame(() => panel.classList.add('is-open'));
      if (focus) input.focus({ preventScroll: true });
    } else {
      panel.classList.remove('is-open');
      panel.hidden = true;
      stopListening(true);
      if (canSpeak) speechSynthesis.cancel();
      if (focus && (panel.contains(document.activeElement) || document.activeElement === document.body)) fab.focus({ preventScroll: true });
    }
  }
  fab.addEventListener('click', () => setOpen(true, { focus: !coarse }));
  tool.addEventListener('click', () => setOpen(!open, { focus: !coarse }));
  closeBtn.addEventListener('click', () => setOpen(false));
  voiceBtn.addEventListener('click', () => {
    voiceOn = !voiceOn;
    voiceBtn.setAttribute('aria-pressed', String(voiceOn));
    if (!voiceOn && canSpeak) speechSynthesis.cancel();
    try {
      localStorage.setItem(VOICE_KEY, voiceOn ? '1' : '0');
    } catch {
      // storage may be blocked; the choice lasts for this page
    }
  });

  // G opens and focuses, Esc closes. Capture phase: Esc closes the guide
  // before main.js closes the place card under it.
  const typing = (el) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el?.isContentEditable;
  const busyMode = () => /\bis-(intro|cinema|story)\b/.test(document.body.className);
  window.addEventListener(
    'keydown',
    (e) => {
      if (document.querySelector('dialog[open]')) return;
      // in cinema / story the guide is hidden: their Esc goes through
      if (e.key === 'Escape' && open && !busyMode()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setOpen(false);
        return;
      }
      if (e.code === 'KeyG' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.repeat && !typing(e.target) && !busyMode()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!open) setOpen(true, { focus: false });
        input.focus({ preventScroll: true });
      }
    },
    true,
  );

  // ---------------------------------------------------------------- suggestions
  let suggFor = null;
  function refreshSuggestions(force = false) {
    const i = getActive();
    const key = i >= 0 ? landmarks[i]?.id : '';
    if (!force && key === suggFor) return;
    suggFor = key;
    const qs = i >= 0 ? [t('Что здесь интересного?'), t('Как сюда дойти?'), t('Что рядом?')] : [t('Что я сейчас вижу?'), t('Что посмотреть за один день?'), t('Где выпить кофе в центре?')];
    sugg.replaceChildren(...qs.map((q) => {
      const b = h('button', { type: 'button' }, q);
      b.addEventListener('click', () => ask(q));
      return b;
    }));
  }
  setInterval(() => {
    if (!open) return;
    // a guided mode started under the open guide: fold it
    if (busyMode()) setOpen(false, { focus: false });
    else refreshSuggestions();
  }, 800);

  // ---------------------------------------------------------------- context
  function context() {
    const c = {};
    const i = getActive();
    if (i >= 0 && landmarks[i]?.id) c.placeId = landmarks[i].id;
    const tg = rig?.controls?.target;
    if (tg && Number.isFinite(tg.x) && Number.isFinite(tg.z)) c.viewCentre = unproject(tg.x, tg.z);
    try {
      c.time = new Intl.DateTimeFormat('en-GB', { timeZone: CITY.timezone || 'Europe/Lisbon', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    } catch {
      // an unknown time zone: no time
    }
    // the real weather only in live mode; the map's own weather is a choice
    const live = debug.life?.live;
    const r = live?.live ? live.reading : null;
    if (r && Number.isFinite(r.code)) {
      const w = weatherFromCode(r.code, r.cloud, r.precip);
      c.weather = `${WEATHER_EN[w.state] || w.state}${Number.isFinite(r.temp) ? ` ${Math.round(r.temp)}°C` : ''}`;
    }
    return c;
  }

  // ---------------------------------------------------------------- messages
  function scrollDown() {
    log.scrollTop = log.scrollHeight;
  }
  function addQuestion(q) {
    const p = h('p', { class: 'guide-msg guide-q' });
    p.append(h('span', { class: 'sr-only', style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)' }, `${t('Вы:')} `), document.createTextNode(q));
    log.append(p);
    scrollDown();
  }
  function addNote(text, dev) {
    const d = h('div', { class: 'guide-msg guide-a is-note' }, text);
    if (dev) {
      const s = h('span', { class: 'guide-dev' });
      s.append(document.createTextNode(`${t('Для разработки:')} `), h('code', {}, 'ANTHROPIC_API_KEY'), document.createTextNode(` ${t('в окружении, затем')} `), h('code', {}, 'vercel dev'), document.createTextNode(` ${t('(Vite не выполняет api/).')}`));
      d.append(s);
    }
    log.append(d);
    scrollDown();
    return d;
  }
  function showOnMap(placeId) {
    const i = indexById.get(placeId);
    if (i == null || busyMode()) return false;
    select(i);
    // phones: the place card (64vh) takes the bottom; fold the chat to its button
    if (narrow.matches) setOpen(false, { focus: false });
    return true;
  }
  function addAnswer(data) {
    const d = h('div', { class: 'guide-msg guide-a' });
    d.append(h('span', { style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)' }, `${t('Гид:')} `), document.createTextNode(data.answer));
    const acts = h('div', { class: 'guide-acts' });
    for (const a of data.actions || []) {
      if (!indexById.has(a.placeId)) continue;
      const b = h('button', { type: 'button' }, `${t('Показать на карте')}: ${landmarks[indexById.get(a.placeId)].name}`);
      b.addEventListener('click', () => showOnMap(a.placeId));
      acts.append(b);
      if (a.type === 'route_to' && Number.isFinite(a.lat) && Number.isFinite(a.lon)) {
        acts.append(h('a', { href: `https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lon}&travelmode=walking`, target: '_blank', rel: 'noopener noreferrer' }, t('Пешком в Google Картах ↗')));
      }
    }
    if (acts.childElementCount) d.append(acts);
    const src = (data.sources || []).filter((s) => s && /^https:\/\//.test(s.url) && s.title);
    if (src.length) {
      const p = h('p', { class: 'guide-src' }, `${t('Источники:')} `);
      src.forEach((s, k) => {
        if (k) p.append(document.createTextNode(' · '));
        p.append(h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title));
      });
      d.append(p);
    }
    log.append(d);
    scrollDown();
  }

  // ---------------------------------------------------------------- speech out
  let voices = [];
  const loadVoices = () => {
    voices = canSpeak ? speechSynthesis.getVoices() : [];
  };
  if (canSpeak) {
    loadVoices();
    speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
  }
  function speak(text) {
    if (!canSpeak) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = locale;
    const lc = locale.toLowerCase();
    const v = voices.find((x) => x.lang?.toLowerCase().replace('_', '-') === lc) || voices.find((x) => x.lang?.toLowerCase().startsWith(language));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  }

  // ---------------------------------------------------------------- ask
  let pending = false;
  let last = null;
  async function post(payload) {
    let r;
    try {
      r = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    } catch {
      return { kind: 'offline' };
    }
    let j = null;
    if ((r.headers.get('content-type') || '').includes('json')) {
      try {
        j = await r.json();
      } catch {
        j = null;
      }
    }
    if (r.ok && j && typeof j.answer === 'string') return { kind: 'ok', data: j, status: r.status };
    // the Vite dev server has no functions: a 404 or index.html
    if (!j) return { kind: import.meta.env.DEV || r.status === 404 ? 'not_configured' : 'error', status: r.status };
    if (r.status === 503 && j.error === 'guide_not_configured') return { kind: 'not_configured', status: r.status };
    if (r.status === 429) return { kind: 'rate', status: r.status };
    return { kind: 'error', status: r.status, error: j.error };
  }

  async function ask(question, { voice = false } = {}) {
    const q = String(question || '').replace(/\s+/g, ' ').trim().slice(0, MAX_Q);
    if (!q || pending) return;
    if (!open) setOpen(true, { focus: false });
    pending = true;
    send.disabled = true;
    input.value = '';
    addQuestion(q);
    const wait = h('p', { class: 'guide-msg guide-wait' }, t('Гид думает…'));
    log.append(wait);
    scrollDown();
    const payload = { city: CITY.id || 'porto', lang: language, question: q, context: context() };
    const res = await post(payload);
    wait.remove();
    pending = false;
    send.disabled = false;
    last = { question: q, payload, ...res };
    debug.guide.last = last;
    if (res.kind === 'ok') {
      addAnswer(res.data);
      const a = (res.data.actions || [])[0];
      if (a) showOnMap(a.placeId);
      if (voiceOn || voice) speak(res.data.answer);
    } else if (res.kind === 'not_configured') {
      addNote(t('Гид пока не подключён. Загляните в карточку места или спросите в туристическом офисе.'), import.meta.env.DEV);
    } else if (res.kind === 'rate') {
      addNote(t('Слишком много вопросов. Подождите минуту.'));
    } else if (res.kind === 'offline') {
      addNote(t('Нет связи. Проверьте интернет.'));
    } else {
      addNote(t('Гид сейчас не отвечает. Попробуйте ещё раз.'));
    }
    refreshSuggestions(true);
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    ask(input.value);
  });

  // ---------------------------------------------------------------- speech in
  let rec = null;
  let listening = false;
  let heard = '';
  function startListening() {
    if (!SR || listening || pending) return;
    try {
      if (canSpeak) speechSynthesis.cancel();
      rec = new SR();
      rec.lang = locale;
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      heard = '';
      rec.onresult = (e) => {
        let text = '';
        for (const r of e.results) text += r[0].transcript;
        heard = text.trim();
        input.value = heard;
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') addNote(t('Нет доступа к микрофону'));
        else if (e.error === 'no-speech') addNote(t('Не расслышал. Попробуйте ещё раз.'));
        heard = '';
      };
      rec.onend = () => {
        const q = heard;
        listening = false;
        rec = null;
        mic.classList.remove('is-listening');
        mic.setAttribute('aria-pressed', 'false');
        input.placeholder = t('Что это? Как дойти? Где поесть?');
        if (q) ask(q, { voice: true });
      };
      rec.start();
      listening = true;
      mic.classList.add('is-listening');
      mic.setAttribute('aria-pressed', 'true');
      input.placeholder = t('Слушаю…');
    } catch {
      listening = false;
      rec = null;
    }
  }
  function stopListening(cancel = false) {
    if (!rec) return;
    if (cancel) {
      heard = '';
      rec.abort?.();
    } else rec.stop();
  }
  // push-to-talk: hold to speak; a keyboard press (click with detail 0) toggles
  mic.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    mic.setPointerCapture?.(e.pointerId);
    startListening();
  });
  const release = () => listening && stopListening();
  mic.addEventListener('pointerup', release);
  mic.addEventListener('pointercancel', release);
  mic.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    if (listening) stopListening();
    else startListening();
  });
  mic.addEventListener('contextmenu', (e) => e.preventDefault());

  const api = {
    get open() {
      return open;
    },
    setOpen,
    ask,
    last: null,
    get pending() {
      return pending;
    },
    hasMic: !!SR,
    canSpeak,
    reducedMotion,
  };
  debug.guide = api;
  return api;
}
