// Lite seasons: the same four buttons as seasons.js (the Atmosphere popover
// clicks them), but a season is only a colour tint on the ground and the sea
// (lite/atmosphere.js). Same storage key and hash (season=) as the full scene,
// so a link or a saved choice means the same in both.
import { t } from '../i18n.js';
import { mountTool } from '../ui.js';
import { CITY } from '../city.js';

const KEYS = ['spring', 'summer', 'fall', 'winter'];
const LABEL = { spring: 'весна', summer: 'лето', fall: 'осень', winter: 'зима' };
const STORE = 'porto-season';
const norm = (n) => (n === 'autumn' ? 'fall' : n);
const hashName = (k) => (k === 'fall' ? 'autumn' : k);

function today() {
  const d = new Date();
  const md = (d.getMonth() + 1) * 100 + d.getDate();
  if (md >= 320 && md < 621) return 'spring';
  if (md >= 621 && md < 923) return 'summer';
  if (md >= 923 && md < 1221) return 'fall';
  return 'winter';
}

export function createSeasonsLite({ atmosphere, debug = {} }) {
  const box = document.createElement('div');
  box.className = 'tool scale-switch';
  box.id = 'season-switch';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', t('Сезон'));
  const name = document.createElement('span');
  name.className = 'scale-name';
  name.textContent = t('Сезон:');
  box.append(name);
  const buttons = {};
  KEYS.forEach((k, i) => {
    if (i) {
      const sep = document.createElement('span');
      sep.className = 'scale-sep';
      sep.setAttribute('aria-hidden', 'true');
      sep.textContent = '·';
      box.append(sep);
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    b.dataset.season = k;
    b.textContent = t(LABEL[k]);
    buttons[k] = b;
    box.append(b);
  });
  mountTool(box, 'sky');

  const fixed = norm(CITY.season_default || '');
  const dflt = KEYS.includes(fixed) ? fixed : today();
  function apply(key, { save = true } = {}) {
    key = norm(key);
    if (!KEYS.includes(key)) return false;
    atmosphere.setSeason(key);
    for (const [k, b] of Object.entries(buttons)) b.setAttribute('aria-pressed', String(k === key));
    debug.season = key;
    if (save) {
      try {
        localStorage.setItem(STORE, hashName(key));
      } catch {
        // storage may be blocked
      }
      const q = new URLSearchParams(location.hash.replace(/^#/, ''));
      if (key === dflt) q.delete('season');
      else q.set('season', hashName(key));
      const h = q.toString().replace(/=(?=&|$)/g, '');
      history.replaceState(null, '', location.pathname + location.search + (h ? `#${h}` : ''));
    }
    return true;
  }
  for (const [k, b] of Object.entries(buttons)) b.addEventListener('click', () => apply(k));
  let saved = null;
  try {
    saved = localStorage.getItem(STORE);
  } catch {
    saved = null;
  }
  const fromHash = norm(new URLSearchParams(location.hash.replace(/^#/, '')).get('season') || '');
  apply([fromHash, norm(saved || ''), dflt].find((k) => KEYS.includes(k)), { save: false });
  window.addEventListener('hashchange', () => {
    const h = norm(new URLSearchParams(location.hash.replace(/^#/, '')).get('season') || '');
    if (h && KEYS.includes(h)) apply(h, { save: false });
  });
  return { apply };
}
