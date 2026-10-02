import { messages } from './locales/ui.js';

export const supportedLanguages = ['pt', 'en', 'ru'];
export function resolveLanguage(query, saved, browserLanguages = []) {
  if (supportedLanguages.includes(query)) return query;
  if (supportedLanguages.includes(saved)) return saved;
  return browserLanguages.map((l) => l.toLowerCase().split('-')[0]).find((l) => supportedLanguages.includes(l)) || 'pt';
}
let saved;
try { saved = globalThis.localStorage?.getItem('porto-language'); } catch { /* storage may be blocked */ }
export const language = resolveLanguage(
  new URLSearchParams(globalThis.location?.search || '').get('lang'), saved,
  globalThis.navigator?.languages || [],
);
export const locale = { pt: 'pt-PT', en: 'en-GB', ru: 'ru-RU' }[language];
export const t = (source) => language === 'ru' ? source : (messages[source]?.[language === 'pt' ? 0 : 1] ?? source);

export function initLanguage() {
  document.documentElement.lang = language === 'pt' ? 'pt-PT' : language;
  try { localStorage.setItem('porto-language', language); } catch { /* optional */ }
  // Make copied URLs carry the selected edition, including browser defaults.
  const url = new URL(location.href);
  url.searchParams.set('lang', language);
  history.replaceState(null, '', url);

  if (document.title && messages[document.title]) {
    document.title = t(document.title);
  }

  // Translate the static shell once, before the scene and dynamic UI start.
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement.closest('script, style')) continue;
    const source = node.textContent.trim();
    if (messages[source]) node.textContent = node.textContent.replace(source, t(source));
  }
  for (const el of document.querySelectorAll('[aria-label], [title], meta[name="description"]')) {
    for (const attr of ['aria-label', 'title', 'content']) {
      if (el.hasAttribute(attr)) el.setAttribute(attr, t(el.getAttribute(attr)));
    }
  }
  const select = document.getElementById('language');
  if (select) {
    select.value = language;
    select.setAttribute('aria-label', { pt: 'Idioma', en: 'Language', ru: 'Язык' }[language]);
    select.addEventListener('change', () => {
      const next = new URL(location.href);
      next.searchParams.set('lang', select.value);
      try { localStorage.setItem('porto-language', select.value); } catch { /* optional */ }
      // Reload releases WebGL resources cleanly; the place/route hash is retained.
      location.assign(next.href);
    });
  }
}

// Landmark and route texts per city and language: src/locales/<lang>.js
// for Braga (the original files), src/locales/<lang>.<city>.js for the
// others. Russian is the source language in the data files. A city without
// a file gets null: the data's own (Russian / Portuguese) names show.
const LOCALES = import.meta.glob('./locales/{en,pt}*.js');
export async function loadTranslations(lang = language, city = 'porto') {
  if (lang !== 'en' && lang !== 'pt') return null;
  const file = city === 'braga' ? `./locales/${lang}.js` : `./locales/${lang}.${city}.js`;
  if (!LOCALES[file]) return null;
  return await LOCALES[file]();
}

const CYRILLIC = /[А-Яа-яЁё]/;
export function localizeLandmark(l, tr = {}) {
  const out = localizeLandmarkFields(l, tr);
  // a missing translation falls back to the Russian text; the panel says so
  out.textFallback = language !== 'ru' && [out.short, out.long, out.history, out.tip, ...(out.facts || [])].some((s) => CYRILLIC.test(s || ''));
  return out;
}

function localizeLandmarkFields(l, tr = {}) {
  const isPt = language === 'pt';
  const isRu = language === 'ru';
  return {
    ...l,
    name: tr?.name || (isPt && l.name_pt ? l.name_pt : isRu ? l.name_ru : (l.name_pt || l.name_ru || String(l.id))),
    year: tr?.year ?? l.year,
    short: tr?.short || (isRu ? l.short_ru : (tr?.short ?? l.short_ru ?? '')),
    long: tr?.long || (isRu ? l.long_ru : (tr?.long ?? l.long_ru ?? '')),
    history: tr?.history || (isRu ? l.history_ru : (tr?.history ?? l.history_ru ?? '')),
    facts: tr?.facts || (isRu ? l.facts_ru : (tr?.facts ?? l.facts_ru ?? [])),
    tip: tr?.tip || (isRu ? l.tip_ru : (tr?.tip ?? l.tip_ru ?? '')),
    gallery: (l.gallery || []).map((g, i) => {
      let cap = isRu ? g.caption_ru : (tr?.gallery?.[i] ?? g.caption_ru ?? '');
      if (typeof cap === 'object' && cap?.caption) cap = cap.caption;
      return { ...g, caption: cap || '' };
    }),
    panorama: l.panorama ? {
      ...l.panorama,
      caption: isRu ? l.panorama.caption_ru : (tr?.panorama?.caption ?? l.panorama.caption_ru ?? ''),
    } : null,
  };
}

export function localizeRoute(r, tr = {}) {
  const isRu = language === 'ru';
  return {
    ...r,
    name: tr?.name || (isRu ? r.name_ru : (tr?.name ?? r.name_ru ?? String(r.id))),
    subtitle: tr?.subtitle || (isRu ? r.subtitle_ru : (tr?.subtitle ?? r.subtitle_ru ?? '')),
    duration: tr?.duration || (isRu ? r.duration_ru : (tr?.duration ?? r.duration_ru ?? '')),
    description: tr?.description || (isRu ? r.description_ru : (tr?.description ?? r.description_ru ?? '')),
    stops: (r.stops || []).map((s, i) => {
      const sTr = tr?.stops?.[i] || {};
      return {
        ...s,
        time: sTr.time || (isRu ? s.time_ru : (sTr.time ?? s.time_ru ?? '')),
        note: sTr.note || (isRu ? s.note_ru : (sTr.note ?? s.note_ru ?? '')),
      };
    }),
    legs: (r.legs || []).map((g, i) => {
      const gTr = tr?.legs?.[i] || {};
      return {
        ...g,
        note: gTr.note || (isRu ? g.note_ru : (gTr.note ?? g.note_ru ?? '')),
      };
    }),
  };
}

// Convert the source's *_ru fields into language-neutral UI fields without
// changing source data, coordinates, media URLs, source titles or credits.
export function localizeRecord(source, translation = {}) {
  if (source == null || typeof source !== 'object') return source;
  if (Array.isArray(source)) return source.map((item, i) => localizeRecord(item, translation[i]));
  const result = { ...source };
  for (const [key, value] of Object.entries(source)) {
    if (key.endsWith('_ru')) result[key.slice(0, -3)] = translation[key.slice(0, -3)] ?? value;
    else if (value && typeof value === 'object') result[key] = localizeRecord(value, translation[key]);
  }
  if (translation.year) result.year = translation.year;
  return result;
}

