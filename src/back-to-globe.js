// A small link back to https://portugal-3d.com, shown only to visitors who arrived from the globe
// (the globe adds ?from=globe). It mounts itself; index.html loads this file as its own module.
const CITY_ID = 'porto';
const GLOBE = 'https://portugal-3d.com';
const LABELS = {
  pt: 'Portugal em 3D',
  en: 'Portugal in 3D',
  es: 'Portugal en 3D',
  fr: 'Le Portugal en 3D',
  de: 'Portugal in 3D',
  ru: 'Португалия в 3D',
};

export function backLink(search, cityId, lang) {
  if (new URLSearchParams(search).get('from') !== 'globe') return null;
  return { href: `${GLOBE}/#from=${cityId}`, label: LABELS[lang] ?? LABELS.en };
}

// Desktop: bottom centre, clear of the side panel, the scale bar and the hints.
// Phones: a round button under the logo, clear of the search bar and the daylight badge.
const CSS = `
.back-globe{position:fixed;z-index:30;left:50%;bottom:max(14px,env(safe-area-inset-bottom));transform:translateX(-50%);display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:999px;background:rgba(15,42,87,.92);color:#fff;font:600 14px/1 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;text-decoration:none;box-shadow:0 2px 12px rgba(0,0,0,.35)}
.back-globe:hover{background:#1a3d7a}
.back-globe:focus-visible{outline:3px solid #ffd27a;outline-offset:3px}
@media (max-width:599px){.back-globe{left:10px;top:58px;bottom:auto;transform:none;width:40px;height:40px;padding:0;justify-content:center}
.back-globe .back-globe-label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}}
`;

export function mountBackToGlobe(doc = document, search = location.search, cityId = CITY_ID) {
  const first = backLink(search, cityId, doc.documentElement.lang);
  if (!first) return null;
  const style = doc.createElement('style');
  style.textContent = CSS;
  doc.head.append(style);
  const a = doc.createElement('a');
  a.className = 'back-globe';
  a.href = first.href;
  const arrow = doc.createElement('span');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '←';
  const label = doc.createElement('span');
  label.className = 'back-globe-label';
  label.textContent = first.label;
  a.append(arrow, label);
  doc.body.append(a);
  // the city pages set the language after load
  new MutationObserver(() => {
    label.textContent = backLink(search, cityId, doc.documentElement.lang).label;
  }).observe(doc.documentElement, { attributes: true, attributeFilter: ['lang'] });
  return a;
}

if (typeof document !== 'undefined') mountBackToGlobe();
