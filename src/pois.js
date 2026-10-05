// Points of interest with their real opening hours (<data_dir>/pois.json,
// scripts/fetch-pois.mjs): cafés, restaurants, bars, shops, pharmacies,
// museums, hotels ...
//
//   - installPois(debug): loads the file once and exposes the data API at
//     window.__porto.pois at once (the list fills when the file arrives;
//     `ready` resolves then, and a `porto:pois` event fires on window):
//       list                 every POI (the pois.json records, unchanged)
//       ready                Promise<list>
//       isOpen(poi, date?)   true / false, or null when the hours are unknown
//                            or not understood; evaluated on the city's
//                            wall clock (Europe/Lisbon), default now
//       near(lat, lon, r?, { kind, limit }?)
//                            POIs within r metres (default 300), nearest first
//       parseHours(text)     the parsed week (tests)
//       kinds                { kind: count }
//     Data only: the UI shows the details.
//   - createPoiSigns(ctx): small glowing signs on the facades near the camera
//     (one instanced draw, at most 400): an icon per kind, bright while the
//     place is open, dim when it is closed; lit at night.
//
// Opening hours: the common OSM subset. Rules separated by ';' (a later rule
// replaces an earlier one for the days it names) or ', ' before a day (an
// additional rule); weekday lists and ranges (Mo-Fr, Sa,Su, Fr-Mo);
// several time ranges (12:00-15:00,19:00-23:00); past midnight (20:00-02:00);
// 'off' / 'closed'; '24/7'; 'open-ended' 18:00+; sunrise-sunset as 07:00-20:00;
// PH and SH rules are ignored, month-limited rules too.
import * as THREE from 'three';
import { dataPath, hasData } from './city.js';
import { lisbonClock } from './traffic-model.js';

// ------------------------------------------------------------ opening hours
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY_RE = '(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_SEL_RE = /^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s*-\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))?(?:\s*,\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s*-\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))?)*)(?:\s*:)?\s+/;
// date-limited rules the model does not follow (weeks, years, days of a month, Easter)
const SKIP_RE = /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|week|easter|\d{4})\b/i;

// "Sep-Jun" / "Jul,Aug" -> does it hold in month m (1..12)?
function inMonths(sel, m) {
  for (const part of sel.split(',')) {
    const [a, b] = part.split('-').map((s) => MONTHS.indexOf(s.trim()) + 1);
    if (!a) return false;
    const e = b || a;
    if (a <= e ? m >= a && m <= e : m >= a || m <= e) return true;
  }
  return false;
}
const SELECTOR_RE = new RegExp(`^(${DAY_RE}(?:\\[[^\\]]*\\])?(?:\\s*-\\s*${DAY_RE})?(?:\\s*,\\s*${DAY_RE}(?:\\[[^\\]]*\\])?(?:\\s*-\\s*${DAY_RE})?)*)(?:\\s*:)?\\s*`);

function minutes(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return NaN;
  const v = +m[1] * 60 + +m[2];
  return v <= 48 * 60 ? v : NaN;
}

// "Mo-Fr,Su" -> [0, 1, 2, 3, 4, 6]; null for PH/SH-only selectors
function parseDays(sel) {
  const out = new Set();
  let real = false;
  for (const part of sel.split(',')) {
    const p = part.replace(/\[[^\]]*\]/g, '').trim();
    if (!p) continue;
    if (p === 'PH' || p === 'SH') continue;
    const [a, b] = p.split('-').map((s) => s.trim());
    const i = DAYS.indexOf(a);
    if (i < 0) return undefined;
    real = true;
    if (!b) {
      out.add(i);
      continue;
    }
    const j = DAYS.indexOf(b);
    if (j < 0) return undefined;
    for (let k = i; ; k = (k + 1) % 7) {
      out.add(k);
      if (k === j) break;
    }
  }
  return real ? [...out] : null;
}

// "12:00-15:00,19:00-23:30" -> [[720, 900], [1140, 1410]]; 'off' -> []
function parseTimes(s) {
  const t = s.trim().toLowerCase();
  if (!t || t === 'open') return [[0, 1440]];
  if (t === 'off' || t === 'closed') return [];
  const out = [];
  for (const part of t.split(',')) {
    const q = part.trim().replace(/sunrise/g, '07:00').replace(/sunset/g, '20:00').replace(/dawn/g, '06:30').replace(/dusk/g, '20:30');
    if (!q) continue;
    let m = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\+?$/.exec(q);
    if (m) {
      const a = minutes(m[1]);
      let b = minutes(m[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      if (b <= a) b += 1440; // past midnight
      out.push([a, b]);
      continue;
    }
    m = /^(\d{1,2}:\d{2})\+$/.exec(q);
    if (m) {
      // open end: until 4 hours later, at most midnight
      const a = minutes(m[1]);
      if (!Number.isFinite(a)) return null;
      out.push([a, Math.max(a + 60, Math.min(1440, a + 240))]);
      continue;
    }
    return null;
  }
  return out;
}

// The week as 7 lists of [start, end) minutes (end may pass 1440), or null.
// month (1..12): month-limited rules ("Jun-Sep Mo-Su 10:00-24:00") apply in
// their months; without it they are skipped.
export function parseHours(text, month = 0) {
  if (typeof text !== 'string' || !text.trim()) return null;
  let s = text
    .trim()
    .replace(/[–—]/g, '-')
    .replace(/\b(\d{1,2})h(\d{2})\b/g, '$1:$2')
    .replace(/\b(\d{1,2})h\b/g, '$1:00')
    .replace(/\b(\d):(\d{2})\b/g, '0$1:$2')
    .replace(/"[^"]*"/g, '')
    .replace(/\s+/g, ' ');
  // the whole week, every hour (optionally with PH rules after it)
  const week = Array.from({ length: 7 }, () => null);
  let any = false;
  let offSeason = false;
  const rules = s
    .split(/\s*(?:;|\|\|)\s*/)
    .flatMap((r) => r.split(new RegExp(`(?<=\\d|off|closed|open|\\+)\\s*,\\s*(?=${DAY_RE}\\b)`, 'i')).map((x, i) => ({ text: x.trim(), add: i > 0 })))
    .filter((r) => r.text);
  for (const r of rules) {
    let body = r.text;
    if (body === '24/7') {
      for (let d = 0; d < 7; d++) week[d] = [[0, 1440]];
      any = true;
      continue;
    }
    const ms = MONTH_SEL_RE.exec(body);
    if (ms) {
      if (!month) continue;
      if (!inMonths(ms[1], month)) {
        offSeason = true;
        continue;
      }
      body = body.slice(ms[0].length);
      if (/^\d{1,2}(?!:\d)/.test(body)) continue; // a day of the month: not modelled
    }
    if (SKIP_RE.test(body)) continue; // date-limited: not modelled
    let days = [0, 1, 2, 3, 4, 5, 6];
    const sel = SELECTOR_RE.exec(body);
    if (sel) {
      const d = parseDays(sel[1]);
      if (d === undefined) return null;
      if (d === null) continue; // PH / SH only
      days = d;
      body = body.slice(sel[0].length);
    } else if (/^[A-Za-z]/.test(body) && !/^(off|closed|open|sunrise|sunset|dawn|dusk)/i.test(body)) {
      return null;
    }
    const times = parseTimes(body.replace(/^24\/7$/, '00:00-24:00'));
    if (!times) return null;
    for (const d of days) week[d] = r.add && week[d] ? week[d].concat(times) : times.slice();
    any = true;
  }
  // only seasonal rules, none for this month: closed all week
  if (!any) return offSeason ? week.map(() => []) : null;
  return week.map((w) => w || []);
}

// open at weekday wd (0 Mo .. 6 Su), minute m of the day?
export function openAt(week, wd, m) {
  for (const [a, b] of week[wd]) if (m >= a && m < b) return true;
  const prev = week[(wd + 6) % 7];
  for (const [a, b] of prev) if (b > 1440 && m < b - 1440 && a < 1440) return true;
  return false;
}

const _clock = { hour: 0, secs: 0, weekday: 0, ymd: 0 };
// the parsed week per POI and month, cached on the record (not enumerable)
const weekOf = (poi, month) => {
  if (!poi || typeof poi.opening_hours !== 'string') return null;
  if (!poi._oh) Object.defineProperty(poi, '_oh', { value: new Map(), enumerable: false });
  if (!poi._oh.has(month)) poi._oh.set(month, parseHours(poi.opening_hours, month));
  return poi._oh.get(month);
};
export function isOpen(poi, date = new Date()) {
  lisbonClock(date instanceof Date ? date : new Date(date), _clock);
  const w = weekOf(poi, Math.floor(_clock.ymd / 100) % 100);
  if (!w) return null;
  return openAt(w, _clock.weekday, _clock.secs / 60);
}
// the same at a wall-clock weekday (0 Mo), hour and month (1..12): the
// scene clock (streetscape.js)
export function isOpenAtHour(poi, weekday, hour, month = 0) {
  const w = weekOf(poi, month);
  if (!w) return null;
  return openAt(w, weekday, hour * 60);
}

// ------------------------------------------------------------ data + API
const STORE = { list: [], loaded: false, source: '', fetched: '', error: null };
let readyP = null;

async function fetchPois() {
  const res = await fetch(`${import.meta.env.BASE_URL}${dataPath('pois.json')}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // the dev server answers a missing file with index.html
  if (!(res.headers.get('content-type') || '').includes('json')) throw new Error('not JSON');
  const doc = JSON.parse(await res.text());
  if (!Array.isArray(doc?.pois)) throw new Error('no pois[]');
  return doc;
}

export function loadPois() {
  if (!hasData('pois.json')) {
    // the city config says this file is not shipped: no request, no 404
    STORE.loaded = true;
    return (readyP ||= Promise.resolve(STORE.list));
  }
  readyP ||= fetchPois()
    .then((doc) => {
      const list = doc.pois.filter((p) => p && typeof p.id === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lon) && typeof p.kind === 'string');
      for (const p of list) if (typeof p.name !== 'string') p.name = '';
      STORE.list.push(...list);
      STORE.source = doc.source || '';
      STORE.fetched = doc.fetched || '';
      STORE.loaded = true;
      return STORE.list;
    })
    .catch((e) => {
      STORE.error = e.message;
      STORE.loaded = true;
      console.info(`[porto] ${dataPath('pois.json')} unavailable (${e.message}); no points of interest.`);
      return STORE.list;
    });
  return readyP;
}

const M_LAT = 110574;
function near(lat, lon, r = 300, { kind = null, limit = Infinity } = {}) {
  const kx = Math.cos((lat * Math.PI) / 180) * 111320;
  const r2 = r * r;
  const out = [];
  for (const p of STORE.list) {
    if (kind && (Array.isArray(kind) ? !kind.includes(p.kind) : p.kind !== kind)) continue;
    const dx = (p.lon - lon) * kx;
    const dz = (p.lat - lat) * M_LAT;
    const d2 = dx * dx + dz * dz;
    if (d2 <= r2) out.push([d2, p]);
  }
  out.sort((a, b) => a[0] - b[0]);
  return out.slice(0, limit).map((q) => q[1]);
}

export function installPois(debug) {
  const api = {
    get list() {
      return STORE.list;
    },
    get loaded() {
      return STORE.loaded;
    },
    get error() {
      return STORE.error;
    },
    get source() {
      return STORE.source;
    },
    get fetched() {
      return STORE.fetched;
    },
    get kinds() {
      const k = {};
      for (const p of STORE.list) k[p.kind] = (k[p.kind] || 0) + 1;
      return k;
    },
    ready: null,
    isOpen,
    near,
    parseHours,
  };
  api.ready = loadPois().then((list) => {
    try {
      window.dispatchEvent(new CustomEvent('porto:pois', { detail: { count: list.length } }));
    } catch {
      // no window (tests)
    }
    return list;
  });
  if (debug) debug.pois = api;
  return api;
}

// ------------------------------------------------------------ signs
// icon slots in the atlas, and the sign colour of each group (sRGB)
const ICON = { cafe: 0, restaurant: 1, fast_food: 2, bar: 3, pub: 3, wine: 3, ice_cream: 4, bakery: 5, pastry: 5, pharmacy: 6, toilets: 7, atm: 8, bank: 8, clothes: 9, gift: 9, supermarket: 9, books: 10, museum: 11, gallery: 11, information: 12, hotel: 13 };
const ICON_COLOR = [0xd98b2b, 0xc8682f, 0xd0532f, 0x9c3b62, 0xd46a9a, 0xc79a3a, 0x239957, 0x5f6b7a, 0x2f67b0, 0x23838a, 0x7a5a2e, 0x6c4fb0, 0x2b78c8, 0x46509e];
export const SIGN_KINDS = Object.keys(ICON);

function drawAtlas() {
  const N = 16;
  const P = 64;
  const cv = document.createElement('canvas');
  cv.width = N * P;
  cv.height = P;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const at = (i, fn) => {
    g.save();
    g.translate(i * P, 0);
    g.beginPath();
    fn();
    g.restore();
  };
  const text = (i, s, size = 30) =>
    at(i, () => {
      g.font = `bold ${size}px Helvetica, Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(s, 32, 34);
    });
  // 0 café: a cup with a handle and steam
  at(0, () => {
    g.lineWidth = 4;
    g.moveTo(16, 28);
    g.lineTo(18, 46);
    g.quadraticCurveTo(19, 50, 24, 50);
    g.lineTo(36, 50);
    g.quadraticCurveTo(41, 50, 42, 46);
    g.lineTo(44, 28);
    g.closePath();
    g.fill();
    g.beginPath();
    g.arc(46, 36, 6, -1.4, 1.4);
    g.stroke();
    g.beginPath();
    g.moveTo(24, 22);
    g.quadraticCurveTo(20, 17, 24, 12);
    g.moveTo(33, 22);
    g.quadraticCurveTo(29, 17, 33, 12);
    g.lineWidth = 3;
    g.stroke();
    g.fillRect(12, 52, 36, 3);
  });
  // 1 restaurant: fork and knife
  at(1, () => {
    g.lineWidth = 4;
    g.moveTo(22, 12);
    g.lineTo(22, 52);
    g.moveTo(16, 12);
    g.lineTo(16, 24);
    g.quadraticCurveTo(16, 30, 22, 30);
    g.quadraticCurveTo(28, 30, 28, 24);
    g.lineTo(28, 12);
    g.stroke();
    g.beginPath();
    g.moveTo(42, 52);
    g.lineTo(42, 12);
    g.quadraticCurveTo(50, 20, 48, 34);
    g.lineTo(42, 34);
    g.closePath();
    g.fill();
    g.stroke();
  });
  // 2 fast food: a burger
  at(2, () => {
    g.ellipse(32, 24, 18, 10, 0, Math.PI, 0);
    g.fill();
    g.fillRect(13, 30, 38, 5);
    g.fillRect(14, 38, 36, 8);
  });
  // 3 bar / pub / wine: a glass
  at(3, () => {
    g.lineWidth = 4;
    g.moveTo(18, 12);
    g.lineTo(46, 12);
    g.quadraticCurveTo(46, 34, 32, 36);
    g.quadraticCurveTo(18, 34, 18, 12);
    g.fill();
    g.beginPath();
    g.moveTo(32, 36);
    g.lineTo(32, 50);
    g.moveTo(22, 52);
    g.lineTo(42, 52);
    g.stroke();
  });
  // 4 ice cream: a cone
  at(4, () => {
    g.arc(32, 22, 11, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(21, 28);
    g.lineTo(43, 28);
    g.lineTo(32, 54);
    g.closePath();
    g.fill();
  });
  // 5 bakery / pastry: a loaf with cuts
  at(5, () => {
    g.ellipse(32, 36, 22, 13, 0, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.lineWidth = 3;
    g.beginPath();
    for (const x of [22, 32, 42]) {
      g.moveTo(x - 4, 42);
      g.lineTo(x + 4, 28);
    }
    g.stroke();
    g.globalCompositeOperation = 'source-over';
  });
  // 6 pharmacy: a cross
  at(6, () => {
    g.fillRect(25, 12, 14, 40);
    g.fillRect(12, 25, 40, 14);
  });
  text(7, 'WC', 26);
  text(8, '€', 36);
  // 9 shop: a bag
  at(9, () => {
    g.fillRect(15, 24, 34, 28);
    g.beginPath();
    g.lineWidth = 4;
    g.arc(32, 24, 9, Math.PI, 0);
    g.stroke();
  });
  // 10 books: an open book
  at(10, () => {
    g.moveTo(32, 20);
    g.quadraticCurveTo(22, 14, 10, 18);
    g.lineTo(10, 48);
    g.quadraticCurveTo(22, 44, 32, 50);
    g.quadraticCurveTo(42, 44, 54, 48);
    g.lineTo(54, 18);
    g.quadraticCurveTo(42, 14, 32, 20);
    g.fill();
  });
  // 11 museum / gallery: a temple front
  at(11, () => {
    g.moveTo(10, 22);
    g.lineTo(32, 10);
    g.lineTo(54, 22);
    g.closePath();
    g.fill();
    for (const x of [14, 24, 34, 44]) g.fillRect(x, 25, 6, 20);
    g.fillRect(10, 47, 44, 5);
  });
  text(12, 'i', 38);
  text(13, 'H', 34);
  return cv;
}

// ctx: { pois (list), place(poi) -> {x, y, z} | null, lite }
export function createPoiSigns({ list, place, lite = false }) {
  const MAX = lite ? 120 : 400;
  const items = [];
  for (const p of list) {
    const icon = ICON[p.kind];
    if (icon === undefined) continue;
    const at = place(p);
    if (!at) continue;
    items.push({ poi: p, icon, x: at.x, y: at.y, z: at.z, open: null });
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const iInfo = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', iPos);
  geo.setAttribute('iInfo', iInfo);
  geo.instanceCount = 0;
  const tex = new THREE.CanvasTexture(drawAtlas());
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  const colors = ICON_COLOR.map((h) => new THREE.Color(h));
  const uniforms = {
    uAtlas: { value: tex },
    uNight: { value: 0 },
    uGlow: { value: 1 },
    uHeight: { value: 900 },
    uColors: { value: colors.map((c) => new THREE.Vector3(c.r, c.g, c.b)) },
  };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms,
    vertexShader: /* glsl */ `
      uniform float uHeight;
      attribute vec3 iPos;
      attribute vec4 iInfo; // icon, open (0 closed, 0.5 unknown, 1 open), fade, -
      varying vec2 vUv;
      varying float vIcon;
      varying float vOpen;
      varying float vFade;
      void main() {
        vec4 mv = viewMatrix * vec4(iPos, 1.0);
        float d = max(-mv.z, 1.0);
        // 1.1 m wide, drawn 11 .. 26 px
        float px = 0.275 * projectionMatrix[1][1] * uHeight * 0.5 / d;
        float k = clamp(px, 11.0, 26.0) / max(px, 1e-3);
        mv.xy += position.xy * 0.275 * k;
        // a little toward the camera: the sign sits on the facade
        mv.xyz *= 1.0 - 0.6 / d;
        gl_Position = projectionMatrix * mv;
        vUv = position.xy + 0.5;
        vIcon = iInfo.x;
        vOpen = iInfo.y;
        vFade = iInfo.z;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      uniform float uNight;
      uniform float uGlow;
      uniform vec3 uColors[${ICON_COLOR.length}];
      varying vec2 vUv;
      varying float vIcon;
      varying float vOpen;
      varying float vFade;
      void main() {
        // a rounded square sign
        vec2 q = abs(vUv - 0.5) - 0.32;
        float r = length(max(q, 0.0)) - 0.14;
        float shape = 1.0 - smoothstep(-0.03, 0.0, r);
        if (shape < 0.01) discard;
        float rim = smoothstep(-0.08, -0.04, r);
        float glyph = texture2D(uAtlas, vec2((vIcon + 0.08 + vUv.x * 0.84) / 16.0, 1.0 - (0.08 + (1.0 - vUv.y) * 0.84))).a;
        vec3 base = vec3(0.0);
        for (int i = 0; i < ${ICON_COLOR.length}; i++) if (abs(vIcon - float(i)) < 0.5) base = uColors[i];
        float open = vOpen;
        // closed: a dark, greyed sign; open: the colour, lit at night
        vec3 bg = mix(vec3(dot(base, vec3(0.3, 0.55, 0.15))) * 0.35, base, open);
        vec3 fg = mix(vec3(0.55), vec3(1.0, 0.98, 0.92), open);
        vec3 c = mix(bg, fg, glyph);
        c = mix(c, c * 0.6 + vec3(0.25), rim * (1.0 - glyph) * 0.5);
        float lit = mix(1.0, 1.0 + 1.6 * uGlow, uNight * open);
        // by day the sign is a painted panel; at night a lit box
        c *= mix(0.95, lit, uNight);
        gl_FragColor = vec4(c, shape * vFade * mix(0.82, 1.0, open));
      }`,
  });
  mat.toneMapped = false;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'poi-signs';
  mesh.frustumCulled = false;
  mesh.renderOrder = 32;
  mesh.visible = false;

  // spatial grid for the nearest-first pick
  const CELL = 32;
  const grid = new Map();
  items.forEach((it, i) => {
    const k = Math.floor(it.x / CELL) * 65536 + Math.floor(it.z / CELL);
    let c = grid.get(k);
    if (!c) grid.set(k, (c = []));
    c.push(i);
  });
  const cand = [];
  let lastX = Infinity;
  let lastZ = Infinity;
  let lastOpenAt = -1;
  let shown = 0;
  function refreshOpen(weekday, hour, month) {
    for (const it of items) {
      const o = isOpenAtHour(it.poi, weekday, hour, month);
      // unknown hours: assume the usual (shops 9-19, food 8-23, the rest always)
      it.open = o !== null ? (o ? 1 : 0) : guessOpen(it.poi.kind, hour) ? 0.8 : 0.15;
    }
  }
  // update: focus (world), radius (world), visible?, clock
  function update(fx, fz, R, on, { weekday, hour, month = 0, night, glow, height }) {
    mesh.visible = on && items.length > 0;
    if (!mesh.visible) return;
    uniforms.uNight.value = night;
    uniforms.uGlow.value = glow;
    uniforms.uHeight.value = height;
    const key = month * 1000 + weekday * 100 + Math.floor(hour * 12) / 12;
    if (key !== lastOpenAt) {
      lastOpenAt = key;
      refreshOpen(weekday, hour, month);
      lastX = Infinity;
    }
    if ((fx - lastX) ** 2 + (fz - lastZ) ** 2 < 4) return;
    lastX = fx;
    lastZ = fz;
    cand.length = 0;
    const R2 = R * R;
    for (let gx = Math.floor((fx - R) / CELL); gx <= Math.floor((fx + R) / CELL); gx++) {
      for (let gz = Math.floor((fz - R) / CELL); gz <= Math.floor((fz + R) / CELL); gz++) {
        const c = grid.get(gx * 65536 + gz);
        if (!c) continue;
        for (const i of c) {
          const it = items[i];
          const d2 = (it.x - fx) ** 2 + (it.z - fz) ** 2;
          if (d2 < R2) cand.push(d2, i);
        }
      }
    }
    // nearest MAX
    const idx = [];
    for (let k = 0; k < cand.length; k += 2) idx.push(k);
    idx.sort((a, b) => cand[a] - cand[b]);
    shown = Math.min(MAX, idx.length);
    const P = iPos.array;
    const I = iInfo.array;
    for (let n = 0; n < shown; n++) {
      const d2 = cand[idx[n]];
      const it = items[cand[idx[n] + 1]];
      P[n * 3] = it.x;
      P[n * 3 + 1] = it.y;
      P[n * 3 + 2] = it.z;
      I[n * 4] = it.icon;
      I[n * 4 + 1] = it.open;
      I[n * 4 + 2] = 1 - THREE.MathUtils.smoothstep(Math.sqrt(d2), R * 0.75, R);
      I[n * 4 + 3] = 0;
    }
    geo.instanceCount = shown;
    iPos.needsUpdate = true;
    iInfo.needsUpdate = true;
  }
  return {
    object: mesh,
    update,
    items,
    get shown() {
      return shown;
    },
  };
}

// typical hours where OSM has none
export function guessOpen(kind, hour) {
  if (kind === 'atm' || kind === 'toilets' || kind === 'hotel' || kind === 'information') return kind !== 'toilets' || (hour >= 8 && hour < 22);
  if (kind === 'bar' || kind === 'pub') return hour >= 16 || hour < 2;
  if (kind === 'cafe' || kind === 'pastry' || kind === 'bakery' || kind === 'ice_cream') return hour >= 7.5 && hour < 22;
  if (kind === 'restaurant' || kind === 'fast_food') return (hour >= 12 && hour < 15.5) || (hour >= 19 && hour < 23.5);
  if (kind === 'museum' || kind === 'gallery') return hour >= 10 && hour < 18;
  return hour >= 9.5 && hour < 19.5;
}
