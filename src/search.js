// Search: one field in the header (shortcut /), results in four groups.
//   Места       landmarks, by their RU, EN and PT names
//   Улицы       named ways in data/roads.json: fly to the midpoint of the
//               longest piece, the whole street glows for a few seconds
//   Кафе и магазины  window.__porto.pois (street-level layer), when present;
//               «открыто сейчас» / «закрыто» from pois.isOpen(poi, date),
//               and a «Открыто сейчас» filter
//   Маршруты    the guided routes
// Matching folds case and accents (Sé = se, Pópulo = populo, ё = е), then
// ranks whole-name, word-prefix, substring, all-words, one-typo and
// in-order-letters matches. Arrows move, Enter flies there, Esc clears or
// closes. The focus stays in the field (aria-activedescendant), so the
// map's arrow and fly keys never see the typing. Phones: full-screen sheet.
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { t } from './i18n.js';
import { CITY } from './city.js';
import { categoryLabel, fmtDistance, placesWord } from './ui.js';
import { METRES_PER_UNIT } from './geo.js';

// lower case, no accents, ё = е, punctuation to spaces
export const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

// edit distance with a cap (cheap early exit)
function lev(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

// 0 = no match; higher is better
export function matchScore(q, key) {
  if (!q || !key) return 0;
  if (key === q) return 100;
  if (key.startsWith(q)) return 85 - Math.min(10, (key.length - q.length) / 4);
  const sk = ` ${key}`;
  if (sk.includes(` ${q}`)) return 70;
  if (key.includes(q)) return 55;
  const toks = q.split(' ').filter(Boolean);
  const words = key.split(' ');
  if (toks.length > 1) {
    if (toks.every((tk) => words.some((w) => w.startsWith(tk)))) return 50;
    if (toks.every((tk) => key.includes(tk))) return 40;
  }
  // one typo per word (two for long words), against the word's prefix
  const near = (tk, w) => {
    const cap = tk.length >= 7 ? 2 : 1;
    return lev(tk, w.slice(0, tk.length + 1), cap) <= cap || lev(tk, w.slice(0, tk.length), cap) <= cap;
  };
  if (toks.every((tk) => tk.length >= 5 && words.some((w) => near(tk, w)))) return 32;
  // letters in order, not too spread out
  const flat = q.replace(/ /g, '');
  if (flat.length >= 3) {
    let i = 0;
    let first = -1;
    let lastAt = -1;
    for (let k = 0; k < key.length && i < flat.length; k++) {
      if (key[k] === flat[i]) {
        if (first < 0) first = k;
        lastAt = k;
        i++;
      }
    }
    if (i === flat.length && lastAt - first < flat.length * 2.2) return 18 - (lastAt - first - flat.length) * 0.5;
  }
  return 0;
}

const KIND_RU = {
  cafe: 'кафе',
  restaurant: 'ресторан',
  bar: 'бар',
  pub: 'паб',
  fast_food: 'фастфуд',
  ice_cream: 'мороженое',
  bakery: 'пекарня',
  pastry: 'кондитерская',
  confectionery: 'кондитерская',
  shop: 'магазин',
  supermarket: 'супермаркет',
  convenience: 'продукты',
  clothes: 'одежда',
  books: 'книги',
  gift: 'сувениры',
  pharmacy: 'аптека',
  marketplace: 'рынок',
  bank: 'банк',
  atm: 'банкомат',
};
const kindLabel = (k) => t(KIND_RU[k] || String(k || '').replace(/_/g, ' '));

// the landmark ranking the labels use too (main.js)
export const IMPORTANCE = {
  'bom-jesus': 10, 'se-braga': 10, sameiro: 8, 'arco-porta-nova': 7, 'praca-republica': 7, tibaes: 7,
  'santa-barbara': 6, 'theatro-circo': 6, 'palacio-raio': 6, biscainhos: 6, 'estadio-braga': 6,
  'avenida-central': 5, 'termas-romanas': 5, 'fonte-idolo': 5, populo: 5, 'santa-cruz': 5, 'sao-frutuoso': 5,
  'torre-menagem': 5, congregados: 5, coimbras: 4, 'diogo-sousa': 4, 'nogueira-silva': 4, 'sao-marcos': 4,
  'parque-ponte': 3, 'estadio-1-maio': 3, 'forum-braga': 3, 'ucp-braga': 2, 'uminho-gualtar': 2, 'dmaria-ii': 2,
  'leonardo-da-vinci': 1,
};

export function createSearch({ landmarks, routes, roads, project, heightAt, scene, camera, rig, renderer, reducedMotion, onPlace, onRoute, toast, isBlocked }) {
  const root = document.getElementById('search');
  const input = document.getElementById('search-input');
  const panel = document.getElementById('search-panel');
  const list = document.getElementById('search-results');
  const openNow = document.getElementById('search-open-now');
  const closeBtn = document.getElementById('search-close');
  if (!root || !input || !panel || !list) return { open() {}, close() {}, query: () => [] };
  const narrow = window.matchMedia('(max-width: 900px)');
  // (initLanguage does not translate placeholders: set here)
  const setPlaceholder = () => (input.placeholder = narrow.matches ? t('Поиск') : t('Найти место или улицу'));
  setPlaceholder();

  // ---------------------------------------------------------- index
  const places = landmarks.map((l, i) => ({
    type: 'place',
    i,
    name: l.name,
    sub: [categoryLabel(l.category), l.year].filter(Boolean).join(' · '),
    keys: [...new Set([l.name, l.name_ru, l.name_pt, String(l.id).replace(/-/g, ' ')].filter(Boolean).map(fold))],
    rank: IMPORTANCE[l.id] ?? 3,
  }));
  const routeEntries = routes.map((r) => ({
    type: 'route',
    id: r.id,
    name: r.name,
    sub: [r.duration, `${r.stops.length} ${placesWord(r.stops.length)}`].filter(Boolean).join(' · '),
    keys: [...new Set([r.name, r.name_ru, r.subtitle].filter(Boolean).map(fold))],
    color: r.color,
    rank: 5,
  }));
  // the other languages' names, once, on the first search
  let namesLoaded = false;
  async function loadNames() {
    if (namesLoaded) return;
    namesLoaded = true;
    try {
      const files = import.meta.glob('./locales/{en,pt}*.js');
      const [en, pt] = await Promise.all([
        files[`./locales/en.${CITY.id}.js`]?.(),
        files[`./locales/pt.${CITY.id}.js`]?.(),
      ]);
      for (const p of places) {
        const id = landmarks[p.i].id;
        for (const tr of [en?.landmarks?.[id], pt?.landmarks?.[id]]) if (tr?.name) p.keys.push(fold(tr.name));
        p.keys = [...new Set(p.keys)];
      }
      for (const r of routeEntries) {
        for (const tr of [en?.routes?.[r.id], pt?.routes?.[r.id]]) if (tr?.name) r.keys.push(fold(tr.name));
        r.keys = [...new Set(r.keys)];
      }
      if (input.value.trim()) render();
    } catch (err) {
      console.warn('[porto] search: other-language names not loaded', err);
    }
  }

  // streets: the named ways, grouped by name
  let streets = null;
  function buildStreets() {
    if (streets) return streets;
    const byName = new Map();
    for (const f of roads?.features || []) {
      const name = f.t?.name;
      if (!name || !Array.isArray(f.pts) || f.pts.length < 2) continue;
      const key = fold(name);
      let s = byName.get(key);
      if (!s) byName.set(key, (s = { type: 'street', name, keys: [key], ways: [], len: 0, rank: 0 }));
      const pts = f.pts.map(([lat, lon]) => project(lat, lon));
      let len = 0;
      for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z);
      s.ways.push({ pts, len });
      s.len += len;
    }
    streets = [...byName.values()];
    for (const s of streets) {
      s.sub = fmtDistance(s.len * METRES_PER_UNIT);
      s.rank = Math.min(4, Math.log10(1 + s.len)); // longer streets first on a tie
    }
    return streets;
  }

  const poisApi = () => window.__porto?.pois;
  const poiOpen = (p) => {
    const api = poisApi();
    if (typeof api?.isOpen !== 'function') return null;
    try {
      const v = api.isOpen(p, new Date());
      return v === true || v === false ? v : null;
    } catch {
      return null;
    }
  };
  const poiXZ = new WeakMap();
  const xzOf = (p) => {
    let v = poiXZ.get(p);
    if (!v) poiXZ.set(p, (v = project(p.lat, p.lon)));
    return v;
  };

  // ---------------------------------------------------------- query
  let filterOpen = false;
  const best = (entry, q) => Math.max(0, ...entry.keys.map((k) => matchScore(q, k)));
  // typo and in-order-letter matches (score < 50) show only when the
  // clear matches, over all groups, are fewer than two
  const STRONG = 50;
  const scored = (entries, q) => entries.map((e) => ({ e, s: best(e, q) })).filter((x) => x.s > 0);
  function top(hits, n, weakOk) {
    return hits
      .filter((x) => x.s >= STRONG || weakOk)
      .sort((a, b) => b.s - a.s || b.e.rank - a.e.rank || a.e.name.length - b.e.name.length)
      .slice(0, n)
      .map((x) => x.e);
  }
  function poiEntries(q) {
    const api = poisApi();
    const listP = Array.isArray(api?.list) ? api.list : null;
    if (!listP) return null;
    const out = [];
    const tgt = rig.controls.target;
    for (const p of listP) {
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || !p.name) continue;
      const open = poiOpen(p);
      if (filterOpen && open !== true) continue;
      let s = 1;
      if (q) {
        s = Math.max(matchScore(q, fold(p.name)), matchScore(q, fold(kindLabel(p.kind))) * 0.6, p.cuisine ? matchScore(q, fold(p.cuisine)) * 0.6 : 0);
        if (!s) continue;
      }
      const xz = xzOf(p);
      out.push({ type: 'poi', poi: p, name: p.name, open, s, d: Math.hypot(xz.x - tgt.x, xz.z - tgt.z) });
    }
    out.sort((a, b) => b.s - a.s || a.d - b.d);
    return out.slice(0, q ? 24 : 8).map((x) => ({ ...x, sub: [kindLabel(x.poi.kind), fmtDistance(x.d * METRES_PER_UNIT)].filter(Boolean).join(' · ') }));
  }

  // groups: [{ title, items }]
  function query(raw) {
    const q = fold(raw);
    const groups = [];
    if (!q) {
      // an empty field: the main places and the routes; with the filter on,
      // what is open near the middle of the map
      if (filterOpen) {
        const pois = poiEntries('');
        if (pois?.length) groups.push({ title: t('Открыто рядом'), items: pois });
      } else {
        groups.push({ title: t('Места'), items: [...places].sort((a, b) => b.rank - a.rank).slice(0, 6) });
        if (routeEntries.length) groups.push({ title: t('Маршруты'), items: routeEntries });
      }
      return groups;
    }
    const hp = scored(places, q);
    const hs = scored(buildStreets(), q);
    const hr = scored(routeEntries, q);
    const allPois = poiEntries(q) || [];
    const strong = [hp, hs, hr].reduce((n, h) => n + h.filter((x) => x.s >= STRONG).length, 0) + allPois.filter((x) => x.s >= STRONG).length;
    const weakOk = strong < 2;
    const p = top(hp, 6, weakOk);
    if (p.length) groups.push({ title: t('Места'), items: p });
    const s = top(hs, 5, weakOk);
    if (s.length) groups.push({ title: t('Улицы'), items: s });
    const pois = allPois.filter((x) => x.s >= STRONG || weakOk).slice(0, 6);
    if (pois.length) groups.push({ title: t('Кафе и магазины'), items: pois });
    const r = top(hr, 3, weakOk);
    if (r.length) groups.push({ title: t('Маршруты'), items: r });
    return groups;
  }

  // ---------------------------------------------------------- render
  let flat = [];
  let active = -1;
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  function render() {
    const groups = query(input.value);
    const hasPois = Array.isArray(poisApi()?.list);
    openNow.hidden = !hasPois;
    list.replaceChildren();
    flat = [];
    for (const g of groups) {
      const box = el('div', 'search-group');
      box.setAttribute('role', 'group');
      const head = el('p', 'search-group-title', g.title);
      head.id = `sg-${flat.length}`;
      box.setAttribute('aria-labelledby', head.id);
      box.append(head);
      for (const it of g.items) {
        const k = flat.length;
        const o = el('div', `search-opt search-${it.type}`);
        o.id = `so-${k}`;
        o.setAttribute('role', 'option');
        o.setAttribute('aria-selected', 'false');
        const main = el('span', 'search-opt-main');
        main.append(el('span', 'search-opt-name', it.name));
        if (it.sub) main.append(el('span', 'search-opt-sub', it.sub));
        if (it.type === 'route') o.style.setProperty('--c', it.color || '#1d4e9e');
        const ico = el('span', 'search-ico');
        ico.setAttribute('aria-hidden', 'true');
        o.append(ico, main);
        if (it.type === 'poi' && it.open != null) {
          o.append(el('span', `search-badge ${it.open ? 'is-open' : 'is-closed'}`, it.open ? t('открыто сейчас') : t('закрыто')));
        }
        o.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the focus in the field
        o.addEventListener('click', () => pick(k));
        o.addEventListener('pointermove', () => setActive(k, false));
        box.append(o);
        flat.push(it);
      }
      list.append(box);
    }
    if (!flat.length) list.append(el('p', 'search-empty', t('Ничего не нашлось')));
    setActive(input.value.trim() && flat.length ? 0 : -1);
  }
  function setActive(k, scroll = true) {
    active = k;
    for (const o of list.querySelectorAll('[role="option"]')) o.setAttribute('aria-selected', String(o.id === `so-${k}`));
    if (k >= 0) {
      input.setAttribute('aria-activedescendant', `so-${k}`);
      if (scroll) document.getElementById(`so-${k}`)?.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  // ---------------------------------------------------------- open, close
  let isOpen = false;
  function open() {
    if (isOpen) return;
    isOpen = true;
    loadNames();
    panel.hidden = false;
    root.classList.add('is-open');
    input.setAttribute('aria-expanded', 'true');
    document.body.classList.toggle('is-search-open', narrow.matches);
    render();
  }
  function close({ clear = false } = {}) {
    if (clear) input.value = '';
    if (!isOpen) return;
    isOpen = false;
    panel.hidden = true;
    root.classList.remove('is-open');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    document.body.classList.remove('is-search-open');
  }
  input.addEventListener('focus', open);
  input.addEventListener('input', () => (isOpen ? render() : open()));
  input.addEventListener('blur', () => {
    // a tap on a result keeps the focus (pointerdown above); anything else closes
    setTimeout(() => {
      if (document.activeElement !== input && !root.contains(document.activeElement)) close();
    }, 0);
  });
  root.addEventListener('pointerdown', (e) => {
    if (e.target === openNow || e.target.closest?.('.search-panel')) e.preventDefault();
  });
  openNow.addEventListener('click', () => {
    filterOpen = !filterOpen;
    openNow.setAttribute('aria-pressed', String(filterOpen));
    render();
  });
  closeBtn?.addEventListener('pointerdown', (e) => e.preventDefault());
  closeBtn?.addEventListener('click', () => {
    close({ clear: true });
    input.blur();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) open();
      if (!flat.length) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive(active < 0 ? (d > 0 ? 0 : flat.length - 1) : (active + d + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flat.length) pick(active >= 0 ? active : 0);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (input.value) {
        input.value = '';
        render();
      } else {
        close();
        input.blur();
      }
    }
  });
  // «/» from anywhere but a text field, a dialog or a guided mode
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const tg = e.target;
      if (tg instanceof HTMLInputElement || tg instanceof HTMLTextAreaElement || tg instanceof HTMLSelectElement || tg?.isContentEditable) return;
      if (document.querySelector('dialog[open]') || isBlocked?.()) return;
      e.preventDefault();
      e.stopPropagation();
      input.focus();
    },
    true,
  );
  narrow.addEventListener?.('change', () => {
    setPlaceholder();
    if (isOpen) document.body.classList.toggle('is-search-open', narrow.matches);
  });

  // ---------------------------------------------------------- go there
  function pick(k) {
    const it = flat[k];
    if (!it) return;
    close();
    input.blur();
    if (it.type === 'place') onPlace(it.i);
    else if (it.type === 'route') onRoute(it.id);
    else if (it.type === 'street') flyStreet(it);
    else if (it.type === 'poi') flyPoi(it);
  }

  // keep the current heading, look down at `elev`, `dist` units away
  function flyOver(x, z, dist, elev = 0.95) {
    const tgt = new THREE.Vector3(x, heightAt(x, z), z);
    const dir = new THREE.Vector3().subVectors(camera.position, rig.controls.target).setY(0);
    if (dir.lengthSq() < 1) dir.set(0, 0, 1);
    dir.normalize();
    const pos = tgt.clone().addScaledVector(dir, Math.cos(elev) * dist);
    pos.y += Math.sin(elev) * dist;
    rig.flyTo(pos, tgt, 1.4);
  }

  function flyStreet(s) {
    // the midpoint of the longest piece; the whole street is highlighted
    const way = s.ways.reduce((a, b) => (b.len > a.len ? b : a));
    let acc = 0;
    let mid = way.pts[0];
    for (let k = 1; k < way.pts.length; k++) {
      const seg = Math.hypot(way.pts[k].x - way.pts[k - 1].x, way.pts[k].z - way.pts[k - 1].z);
      if (acc + seg >= way.len / 2) {
        const f = seg ? (way.len / 2 - acc) / seg : 0;
        mid = { x: way.pts[k - 1].x + (way.pts[k].x - way.pts[k - 1].x) * f, z: way.pts[k - 1].z + (way.pts[k].z - way.pts[k - 1].z) * f };
        break;
      }
      acc += seg;
    }
    // the view fits the longest piece (100 m .. 2.4 km away)
    flyOver(mid.x, mid.z, THREE.MathUtils.clamp(way.len * 1.25, 25, 600));
    highlight(s.ways);
    toast?.(s.name, 2400);
  }

  function flyPoi(it) {
    const xz = xzOf(it.poi);
    flyOver(xz.x, xz.z, 45, 0.85);
    marker(xz.x, xz.z);
    const status = it.open == null ? '' : it.open ? t('открыто сейчас') : t('закрыто');
    toast?.([it.name, kindLabel(it.poi.kind), status].filter(Boolean).join(' · '), 3200);
  }

  // ---------------------------------------------------------- highlight
  let glow = null;
  function clearGlow() {
    if (!glow) return;
    cancelAnimationFrame(glow.raf);
    for (const o of glow.objs) {
      scene.remove(o);
      o.geometry.dispose();
      o.material.dispose();
    }
    glow = null;
  }
  function fadeOut(objs, mats, holdMs) {
    const t0 = performance.now();
    const g = { objs, raf: 0 };
    const step = () => {
      const k = (performance.now() - t0) / 1000;
      const hold = holdMs / 1000;
      const a = k < hold ? 1 : Math.max(0, 1 - (k - hold) / 0.8);
      const pulse = reducedMotion ? 1 : 0.75 + 0.25 * Math.sin(k * 5);
      for (const m of mats) m.opacity = a * pulse;
      if (a <= 0) return clearGlow();
      g.raf = requestAnimationFrame(step);
    };
    g.raf = requestAnimationFrame(step);
    return g;
  }
  function highlight(ways) {
    clearGlow();
    const size = renderer.getSize(new THREE.Vector2());
    const objs = [];
    const mats = [];
    for (const w of ways) {
      const pos = [];
      for (const p of w.pts) pos.push(p.x, heightAt(p.x, p.z) + 1.2, p.z);
      const geo = new LineGeometry();
      geo.setPositions(pos);
      const mat = new LineMaterial({ color: 0x5b8cff, linewidth: 6, transparent: true, opacity: 1, depthTest: false, worldUnits: false });
      mat.resolution.set(size.x, size.y);
      mat.toneMapped = false;
      const line = new Line2(geo, mat);
      line.computeLineDistances();
      line.renderOrder = 20;
      line.frustumCulled = false;
      line.name = 'search-highlight';
      scene.add(line);
      objs.push(line);
      mats.push(mat);
    }
    glow = fadeOut(objs, mats, 4200);
  }
  function marker(x, z) {
    clearGlow();
    const geo = new THREE.RingGeometry(3, 4.4, 40);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x5b8cff, transparent: true, depthTest: false, side: THREE.DoubleSide });
    mat.toneMapped = false;
    const ring = new THREE.Mesh(geo, mat);
    ring.position.set(x, heightAt(x, z) + 0.6, z);
    ring.renderOrder = 20;
    ring.name = 'search-highlight';
    scene.add(ring);
    glow = fadeOut([ring], [mat], 4200);
  }

  return {
    open: () => input.focus(),
    close: () => {
      close();
      input.blur();
    },
    get isOpen() {
      return isOpen;
    },
    // tests: the grouped results for a query, as names
    query: (q) => query(q).map((g) => ({ title: g.title, items: g.items.map((i) => i.name) })),
  };
}
