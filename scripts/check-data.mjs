// Validate <data dir>/landmarks.json and routes.json against the content contract.
// Node 22, no dependencies. Run: node scripts/check-data.mjs [--online]
// --online also re-checks every YouTube id through the oEmbed endpoint, and checks
// that every 360° panorama video reports a spherical projection on its watch page.
import { readFileSync, existsSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITY, dataPath, dataRel } from './city-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Node 22, no dependencies. --city <id> picks the city (default braga).
if (CITY.id !== 'braga' && !existsSync(CITY.landmarksPath)) {
  console.log(`no landmarks yet for ${CITY.id}`);
  process.exit(0);
}
const ONLINE = process.argv.includes('--online');
const errors = [];
const warns = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warns.push(`${where}: ${msg}`);

const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const isStr = v => typeof v === 'string' && v.trim().length > 0;
const isUrl = v => isStr(v) && /^https?:\/\/\S+$/.test(v);

// Read JPEG size from SOF marker; returns null if the file is not a JPEG.
function jpegInfo(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return { missing: true };
  const size = statSync(p).size;
  const buf = Buffer.alloc(Math.min(size, 1 << 20));
  const fd = openSync(p, 'r');
  readSync(fd, buf, 0, buf.length, 0);
  closeSync(fd);
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return { notJpeg: true, size };
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { size, height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return { size };
}

function checkCredit(where, c) {
  if (!c || typeof c !== 'object') return err(where, 'credit missing');
  if (!isStr(c.author)) err(where, 'credit.author missing');
  if (!isStr(c.license)) err(where, 'credit.license missing');
  else if (/\bN[CD]\b|NonCommercial|NoDerivs/i.test(c.license)) err(where, `non-free license ${c.license}`);
  if (!isUrl(c.source_url)) err(where, 'credit.source_url is not a URL');
  if (/<[a-z][^>]*>/i.test(c.author || '')) err(where, 'credit.author contains HTML');
}

function checkImage(where, src, { maxBytes, pano } = {}) {
  if (!isStr(src)) return err(where, 'src missing');
  const info = jpegInfo(src);
  if (info.missing) return err(where, `file not found: ${src}`);
  if (info.notJpeg) return err(where, `not a JPEG (magic bytes): ${src}`);
  if (maxBytes && info.size > maxBytes) err(where, `${src} is ${info.size} bytes > ${maxBytes}`);
  if (pano) {
    if (!info.width) return err(where, `cannot read size of ${src}`);
    const r = info.width / info.height;
    if (Math.abs(r - 2) > 0.02) err(where, `panorama ${src} is ${info.width}x${info.height}, not 2:1`);
  }
}

// ---------- landmarks ----------
const landmarks = readJson(CITY.landmarksPath);
if (!Array.isArray(landmarks)) throw new Error('landmarks.json must be an array');
const ids = new Set();
const BASE = ['id', 'name_pt', 'name_ru', 'category', 'lat', 'lon', 'year', 'short_ru', 'long_ru', 'model', 'image', 'image_credit'];
const NEW = ['history_ru', 'facts_ru', 'sources', 'tip_ru', 'gallery', 'panorama', 'videos'];
const KINDS = new Set(['interior', 'exterior', 'detail']);
const LANGS = new Set(['pt', 'en', 'ru', 'other']);
const allVideos = [];
const panoVideos = [];
let panoCount = 0;

for (const l of landmarks) {
  const w = l.id || '(no id)';
  for (const k of [...BASE, ...NEW]) if (!(k in l)) err(w, `missing field ${k}`);
  if (ids.has(l.id)) err(w, 'duplicate id');
  ids.add(l.id);
  if (typeof l.lat !== 'number' || typeof l.lon !== 'number') err(w, 'lat/lon must be numbers');
  // no_free_photos: true = no free photo of the place exists; image and image_credit are null, gallery is empty
  const noPhotos = l.no_free_photos === true;
  if (noPhotos) {
    if (l.image !== null && l.image !== '') err(w, 'no_free_photos requires image: null');
    if (l.image_credit !== null && l.image_credit !== undefined) err(w, 'no_free_photos requires image_credit: null');
  } else {
    checkImage(`${w}.image`, l.image);
    checkCredit(`${w}.image_credit`, l.image_credit);
  }

  // history_ru: 900-3600 chars, 3-8 paragraphs (Porto's detailed editorial standard)
  if (!isStr(l.history_ru)) err(w, 'history_ru missing');
  else {
    const n = [...l.history_ru].length;
    if (n < 900 || n > 3600) err(w, `history_ru length ${n} not in 900..3600`);
    const paras = l.history_ru.split('\n\n');
    if (paras.length < 3 || paras.length > 8) err(w, `history_ru has ${paras.length} paragraphs, need 3..8`);
    if (paras.some(p => !p.trim())) err(w, 'history_ru has an empty paragraph');
    if (/[A-Za-z][А-Яа-яЁё]|[А-Яа-яЁё][A-Za-z]/.test(l.history_ru)) warn(w, 'history_ru mixes Latin and Cyrillic inside a word');
  }
  // facts_ru: 3-8 one-liners <= 160
  if (!Array.isArray(l.facts_ru) || l.facts_ru.length < 3 || l.facts_ru.length > 8) err(w, 'facts_ru must have 3..8 items');
  else l.facts_ru.forEach((f, i) => {
    if (!isStr(f)) err(w, `facts_ru[${i}] empty`);
    else if ([...f].length > 160) err(w, `facts_ru[${i}] is ${[...f].length} chars > 160`);
    else if (/\n/.test(f)) err(w, `facts_ru[${i}] has a line break`);
  });
  // sources: 2-6
  if (!Array.isArray(l.sources) || l.sources.length < 2 || l.sources.length > 6) err(w, 'sources must have 2..6 items');
  else l.sources.forEach((s, i) => { if (!isStr(s?.title) || !isUrl(s?.url)) err(w, `sources[${i}] needs title and url`); });
  if (!isStr(l.tip_ru)) err(w, 'tip_ru missing');

  // gallery: 2-5
  if (noPhotos) {
    if (!Array.isArray(l.gallery) || l.gallery.length !== 0) err(w, 'no_free_photos requires an empty gallery');
  } else if (!Array.isArray(l.gallery) || l.gallery.length < 1 || l.gallery.length > 5) err(w, 'gallery must have 1..5 items');
  else {
    if (l.gallery.length < 2) warn(w, 'gallery has 1 photo (only two free photos exist)');
    const seen = new Set();
    l.gallery.forEach((g, i) => {
      const gw = `${w}.gallery[${i}]`;
      if (!new RegExp(`^assets/img/${l.id}-\\d+\\.jpg$`).test(g.src || '')) err(gw, `src ${g.src} must be assets/img/${l.id}-N.jpg`);
      if (seen.has(g.src)) err(gw, 'duplicate src');
      seen.add(g.src);
      if (!KINDS.has(g.kind)) err(gw, `kind ${g.kind} not interior|exterior|detail`);
      if (!isStr(g.caption_ru)) err(gw, 'caption_ru missing');
      checkImage(gw, g.src, { maxBytes: 650_000 });
      checkCredit(gw, g.credit);
    });
  }

  // panorama: null, a 360° YouTube video {type:'youtube',...}, or an image {src,caption_ru,credit} with a 2:1 JPEG
  if (l.panorama !== null) {
    const p = l.panorama;
    if (!p || typeof p !== 'object') err(w, 'panorama must be null or an object');
    else if (p.type === 'youtube') {
      panoCount++;
      if (!/^[\w-]{11}$/.test(p.youtube_id || '')) err(w, `panorama.youtube_id ${p.youtube_id} is not an 11-char id`);
      if (!isStr(p.title) || !isStr(p.channel)) err(w, 'panorama title and channel required');
      if (!isStr(p.caption_ru)) err(w, 'panorama.caption_ru missing');
      else if (/\n/.test(p.caption_ru)) err(w, 'panorama.caption_ru has a line break');
      if (Array.isArray(l.videos) && l.videos.some(v => v.youtube_id === p.youtube_id)) err(w, `panorama ${p.youtube_id} duplicates an entry in videos`);
      panoVideos.push([`${w}.panorama`, p]);
    } else if ('type' in p) err(w, `panorama.type ${p.type} not supported (only youtube)`);
    else if (!('src' in p)) err(w, 'panorama must have type:"youtube" or src');
    else {
      panoCount++;
      if (!new RegExp(`^assets/pano/${l.id}\\.jpg$`).test(p.src || '')) err(w, `panorama.src must be assets/pano/${l.id}.jpg`);
      if (!isStr(p.caption_ru)) err(w, 'panorama.caption_ru missing');
      checkImage(`${w}.panorama`, p.src, { maxBytes: 2_500_000, pano: true });
      checkCredit(`${w}.panorama`, p.credit);
    }
  }

  // videos: 0-3 (optional — a free embeddable video does not exist for every place)
  if (!Array.isArray(l.videos) || l.videos.length > 3) err(w, 'videos must have 0..3 items');
  else l.videos.forEach((v, i) => {
    const vw = `${w}.videos[${i}]`;
    if (!/^[\w-]{11}$/.test(v.youtube_id || '')) err(vw, `bad youtube_id ${v.youtube_id}`);
    if (!isStr(v.title) || !isStr(v.channel)) err(vw, 'title and channel required');
    if (!LANGS.has(v.lang)) err(vw, `lang ${v.lang} not pt|en|ru|other`);
    allVideos.push([vw, v]);
  });
}

// ---------- routes ----------
const routesFile = readJson(dataPath('routes.json'));
const routes = routesFile.routes;
const MODES = new Set(['foot', 'bus', 'funicular', 'taxi']);
if (!Array.isArray(routes) || routes.length !== 3) err('routes', 'need exactly 3 routes');
for (const r of routes || []) {
  const w = `route ${r.id}`;
  for (const k of ['id', 'name_ru', 'subtitle_ru', 'color', 'duration_ru', 'distance_km', 'description_ru', 'stops', 'legs']) if (!(k in r)) err(w, `missing ${k}`);
  if (!/^#[0-9a-f]{6}$/i.test(r.color || '')) err(w, 'color must be #rrggbb');
  if (!Array.isArray(r.stops) || r.stops.length < 2) { err(w, 'needs at least 2 stops'); continue; }
  r.stops.forEach((s, i) => {
    if (!ids.has(s.landmark_id)) err(`${w}.stops[${i}]`, `unknown landmark_id ${s.landmark_id}`);
    if (!/^\d{2}:\d{2}$/.test(s.time_ru || '')) err(`${w}.stops[${i}]`, `time_ru ${s.time_ru} not HH:MM`);
    if (!Number.isInteger(s.stay_min) || s.stay_min <= 0) err(`${w}.stops[${i}]`, 'stay_min must be a positive integer');
    if (!isStr(s.note_ru)) err(`${w}.stops[${i}]`, 'note_ru missing');
  });
  if (!Array.isArray(r.legs) || r.legs.length !== r.stops.length - 1) { err(w, 'legs must be stops.length - 1'); continue; }
  let sum = 0;
  r.legs.forEach((g, i) => {
    const gw = `${w}.legs[${i}]`;
    if (g.from !== r.stops[i].landmark_id || g.to !== r.stops[i + 1].landmark_id) err(gw, `leg ${g.from}->${g.to} does not chain stop ${i} -> ${i + 1}`);
    if (!MODES.has(g.mode)) err(gw, `mode ${g.mode}`);
    if (!Number.isInteger(g.distance_m) || g.distance_m <= 0) err(gw, 'distance_m must be a positive integer');
    if (!Number.isInteger(g.duration_min) || g.duration_min <= 0) err(gw, 'duration_min must be a positive integer');
    if (!Array.isArray(g.pts) || g.pts.length < 2) err(gw, 'pts needs at least 2 points');
    else {
      if (g.pts.some(p => !Array.isArray(p) || p.length !== 2 || p.some(x => typeof x !== 'number' || Math.round(x * 1e5) / 1e5 !== x))) err(gw, 'pts must be [lat,lon] rounded to 5 decimals');
      const PAD = 0.05, WB = CITY.wide_bbox;
      if (g.pts.some(([la, lo]) => la < WB.s - PAD || la > WB.n + PAD || lo < WB.w - PAD || lo > WB.e + PAD)) err(gw, 'pts outside the city area');
      const byId = Object.fromEntries(landmarks.map(l => [l.id, l]));
      const near = (p, l) => Math.hypot((p[0] - l.lat) * 111000, (p[1] - l.lon) * 83000);
      if (byId[g.from] && near(g.pts[0], byId[g.from]) > 400) err(gw, 'first point is far from the start landmark');
      if (byId[g.to] && near(g.pts.at(-1), byId[g.to]) > 400) err(gw, 'last point is far from the end landmark');
    }
    sum += g.distance_m || 0;
  });
  const km = Math.round(sum / 100) / 10;
  if (Math.abs(km - r.distance_km) > 0.05) err(w, `distance_km ${r.distance_km} != sum of legs ${km}`);
}

// ---------- optional online check ----------
if (ONLINE) {
  for (const [vw, v] of [...allVideos, ...panoVideos]) {
    const id = v.youtube_id;
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
    let j = null;
    if (res.ok) { try { j = await res.json(); } catch {} }
    if (!isStr(j?.title)) err(vw, `oEmbed failed for ${id} (HTTP ${res.status})`);
    else {
      if (j.title !== v.title) err(vw, `title differs from oEmbed: "${j.title}"`);
      if (j.author_name !== v.channel) err(vw, `channel differs from oEmbed: "${j.author_name}"`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  // 360° panoramas: the watch page must report a spherical projection.
  // Needs a full desktop UA: with a bare "Mozilla/5.0" YouTube serves a page where
  // every video, even a real 360° one, shows only "RECTANGULAR".
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
  for (const [vw, p] of panoVideos) {
    const res = await fetch(`https://www.youtube.com/watch?v=${p.youtube_id}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US', Cookie: 'SOCS=CAI; CONSENT=YES+1' } });
    const html = res.ok ? await res.text() : '';
    const kinds = new Set((html.match(/"projectionType":"\w+"/g) || []).map(s => s.slice(18, -1)));
    if (!kinds.size) err(vw, `no projectionType on watch page (HTTP ${res.status})`);
    else if (!kinds.has('MESH') && !kinds.has('EQUIRECTANGULAR')) err(vw, `${p.youtube_id} is flat (${[...kinds].join(',')}), not 360°`);
    await new Promise(r => setTimeout(r, 300));
  }
}

for (const x of warns) console.warn(`WARN  ${x}`);
for (const x of errors) console.error(`ERROR ${x}`);
const galleryN = landmarks.reduce((a, l) => a + (l.gallery?.length || 0), 0);
console.log(`${landmarks.length} landmarks, ${galleryN} gallery photos, ${panoCount} panoramas (${panoVideos.length} 360° YouTube), ${allVideos.length} videos${ONLINE ? ' (oEmbed + 360° projection checked)' : ''}, ${routes?.length || 0} routes`);
if (errors.length) { console.error(`${errors.length} error(s)`); process.exit(1); }
console.log('OK');
