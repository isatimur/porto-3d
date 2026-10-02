import { t, language, locale } from './i18n.js';
// Gallery grid for the «Галерея» tab and a modal lightbox.
// The lightbox is a <dialog>: the browser traps focus and turns Esc into a
// "cancel" event. ←/→ step through the images; focus returns to the
// thumbnail that opened it.
import { assetUrl } from './data.js';

export const KIND_RU = { interior: t('интерьер'), exterior: t('фасад'), detail: t('деталь') };

export function creditText(c, prefix = t('Фото')) {
  if (!c || !(c.author || c.license)) return '';
  return `${prefix}: ${[c.author, c.license].filter(Boolean).join(', ')}`;
}

export function creditNode(c, prefix) {
  const text = creditText(c, prefix);
  if (!text) return null;
  const el = document.createElement(c.source_url ? 'a' : 'span');
  el.textContent = text;
  if (c.source_url) Object.assign(el, { href: c.source_url, target: '_blank', rel: 'noopener noreferrer' });
  return el;
}

export function createLightbox() {
  const root = document.getElementById('lightbox');
  const img = root.querySelector('.lb-img');
  const fig = root.querySelector('.lb-figure');
  const cap = root.querySelector('.lb-caption');
  const cred = root.querySelector('.lb-credit');
  const pos = root.querySelector('.lb-pos');
  const prev = root.querySelector('.lb-prev');
  const next = root.querySelector('.lb-next');
  let items = [];
  let index = 0;
  let opener = null;

  img.addEventListener('load', () => fig.classList.remove('is-loading', 'is-missing'));
  img.addEventListener('error', () => {
    fig.classList.remove('is-loading');
    fig.classList.add('is-missing');
  });

  function render() {
    const g = items[index];
    fig.classList.add('is-loading');
    fig.classList.remove('is-missing');
    img.src = assetUrl(g.src);
    img.alt = g.caption || `${t('Фото')} ${index + 1}`;
    cap.textContent = [KIND_RU[g.kind], g.caption].filter(Boolean).join(' · ');
    cred.replaceChildren(...[creditNode(g.credit)].filter(Boolean));
    pos.textContent = `${index + 1} / ${items.length}`;
    const many = items.length > 1;
    prev.hidden = next.hidden = !many;
  }

  function go(d) {
    if (items.length < 2) return;
    index = (index + d + items.length) % items.length;
    render();
  }

  function open(list, i, from) {
    items = list;
    index = i;
    opener = from || document.activeElement;
    render();
    if (!root.open) root.showModal();
    root.querySelector('.lb-close').focus();
  }

  function close() {
    if (!root.open) return;
    root.close();
    img.removeAttribute('src');
    opener?.focus?.();
    opener = null;
  }

  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  root.querySelector('.lb-close').addEventListener('click', close);
  root.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  // a click on the dark backdrop (the dialog box itself) closes
  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(1);
    }
  });

  return { open, close, isOpen: () => root.open };
}

// Fills `host` with the thumbnail grid. Two CSS columns give the masonry.
export function renderGallery(host, gallery, lightbox) {
  host.replaceChildren();
  const list = document.createElement('ul');
  list.className = 'gallery';
  gallery.forEach((g, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'thumb';
    b.setAttribute('aria-label', `${t('Открыть фото')} ${i + 1} ${t('из')} ${gallery.length}${g.caption ? `: ${g.caption}` : ''}`);
    const im = document.createElement('img');
    im.src = assetUrl(g.src);
    im.alt = '';
    im.loading = 'lazy';
    im.decoding = 'async';
    im.addEventListener('error', () => b.classList.add('is-missing'));
    b.append(im);
    if (KIND_RU[g.kind]) {
      const tag = document.createElement('span');
      tag.className = 'thumb-tag';
      tag.textContent = KIND_RU[g.kind];
      b.append(tag);
    }
    b.addEventListener('click', () => lightbox.open(gallery, i, b));
    li.append(b);
    if (g.caption) {
      const c = document.createElement('p');
      c.className = 'thumb-cap';
      c.textContent = g.caption;
      li.append(c);
    }
    list.append(li);
  });
  host.append(list);
}
