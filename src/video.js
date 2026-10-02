import { t, language, locale } from './i18n.js';
// Video cards for the «Видео» tab. A card shows the YouTube thumbnail only;
// the iframe (youtube-nocookie.com) is created on click, never on load.
// stopVideos() removes live iframes so playback ends when the tab or the
// landmark changes.

const LANG_RU = { ru: t('рус.'), en: t('англ.'), pt: t('порт.'), es: t('исп.'), fr: t('франц.'), de: t('нем.') };

export function renderVideos(host, videos) {
  host.replaceChildren();
  const list = document.createElement('ul');
  list.className = 'videos';
  for (const v of videos) {
    const li = document.createElement('li');
    li.className = 'video';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'video-play';
    b.setAttribute('aria-label', `${t('Смотреть видео:')} ${v.title || t('без названия')}`);
    const im = document.createElement('img');
    im.src = `https://i.ytimg.com/vi/${encodeURIComponent(v.youtube_id)}/hqdefault.jpg`;
    im.alt = '';
    im.loading = 'lazy';
    im.decoding = 'async';
    im.referrerPolicy = 'no-referrer';
    im.addEventListener('error', () => b.classList.add('is-missing'));
    const icon = document.createElement('span');
    icon.className = 'video-icon';
    icon.setAttribute('aria-hidden', 'true');
    b.append(im, icon);
    b.addEventListener('click', () => play(li, b, v));

    const meta = document.createElement('div');
    meta.className = 'video-meta';
    const titleEl = document.createElement('p'); // not `t`: that is the translation function
    titleEl.className = 'video-title';
    titleEl.textContent = v.title || t('Видео');
    const ch = document.createElement('p');
    ch.className = 'video-channel';
    ch.textContent = [v.channel, LANG_RU[v.lang] || v.lang].filter(Boolean).join(' · ');
    meta.append(titleEl, ch);
    li.append(b, meta);
    list.append(li);
  }
  host.append(list);
}

function play(li, button, v) {
  const frame = document.createElement('iframe');
  frame.className = 'video-frame';
  frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.youtube_id)}?autoplay=1&rel=0`;
  frame.title = v.title || t('Видео YouTube');
  frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  button.replaceWith(frame);
  frame.focus();
}

export function stopVideos(host) {
  for (const f of host.querySelectorAll('iframe')) f.remove();
}
