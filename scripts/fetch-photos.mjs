// Fetch landmark photos from Wikimedia Commons and record their credits.
//
// Porto adaptation of the Guimarães fetcher. For every landmark id in
// data/landmarks.json it:
//   - resolves the Commons file page already recorded in
//     data/new/<id>.landmark.json image_credit.source_url and downloads it as
//     assets/img/<id>.jpg,
//   - finds up to three further free-licensed files from the landmark's Commons
//     category (falling back to a Commons search) and downloads them as
//     assets/img/<id>-1.jpg … <id>-3.jpg,
//   - re-encodes every JPEG under 600 KB,
//   - rewrites the fragment's image / image_credit / gallery with the real
//     author, licence and Commons file page URL of each downloaded file.
//
// Idempotent: a fragment whose gallery already points at existing files is left
// alone unless --force. Usage:
//   node scripts/fetch-photos.mjs [--force] [id ...]
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NEW = join(ROOT, 'data', 'new');
const IMG = join(ROOT, 'assets', 'img');
const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'porto-3d photo fetcher (https://github.com/isatimur/porto-3d)';
const MAX_BYTES = 600 * 1024;
const MAX_GALLERY = 3;
// --images-only cap: main <id>.jpg plus <id>-1.jpg and <id>-2.jpg.
const MAX_IMAGES = 3;

// Commons category + search query per landmark, plus a relevance pattern used
// to keep only files that actually name the landmark (required for search
// results, preferred for category members). The category is tried first; the
// search is the fallback when the category has too few usable files.
const COMMONS = {
  clerigos: { category: 'Igreja e Torre dos Clérigos', search: 'Torre dos Clérigos', match: /cl[eé]rigos/i },
  lello: { category: 'Livraria Lello', search: 'Livraria Lello Porto', match: /lello/i },
  'sao-bento': { category: 'São Bento train station', search: 'São Bento railway station Porto', match: /s[ãa]o bento/i },
  'se-porto': { category: 'Sé do Porto', search: 'Catedral do Porto', match: /catedral|cathedral|s[ée] do porto/i },
  bolsa: { category: 'Palácio da Bolsa', search: 'Palácio da Bolsa Porto', match: /bolsa|pal[aá]cio/i },
  'sao-francisco-porto': { category: 'Igreja de São Francisco (Porto)', search: 'Igreja de São Francisco Porto', match: /francisco/i },
  'ponte-luis-i': { category: 'Luiz I bridge', search: 'Dom Luís I Bridge Porto', match: /lu[ií]s|luiz/i },
  ribeira: { category: 'Cais da Ribeira', search: 'Ribeira Porto', match: /ribeira/i },
  serralves: { category: 'Museu de Arte Contemporânea de Serralves', search: 'Museu de Serralves Porto', match: /serralves/i },
  'casa-musica': { category: 'Casa da Música', search: 'Casa da Música Porto', match: /casa da m[uú]sica|m[uú]sica/i },
  dragao: { category: 'Estádio do Dragão', search: 'Estádio do Dragão Porto', match: /drag[ãa]o/i },
  felgueiras: { category: 'Felgueiras Lighthouse', search: 'Farolim de Felgueiras Porto', match: /felgueiras|farol|foz/i, avoid: /senhora da luz/i },
  'caves-gaia': { category: "Taylor's wine cellars", search: 'Vila Nova de Gaia port wine cellar', match: /taylor|gaia|cellar|cave|port wine|vinho/i },
  'ponte-arrabida': { category: 'Ponte da Arrábida', search: 'Ponte da Arrábida Porto', match: /arr[áa]bida/i },
  'ponte-maria-pia': { category: 'Ponte de D. Maria Pia', search: 'Maria Pia Bridge Porto', match: /maria pia|d\. maria/i },
  'mercado-bolhao': { category: 'Exterior of Mercado do Bolhão', search: 'Mercado do Bolhão Porto', match: /bolh[ãa]o/i },
  aliados: { category: 'Avenida dos Aliados', search: 'Avenida dos Aliados Porto', match: /aliados/i },
  carmo: { category: 'Igreja do Carmo (Porto)', search: 'Igreja do Carmo Porto', match: /carmo/i },
  'palacio-cristal': { category: 'Jardins do Palácio de Cristal (Porto)', search: 'Palácio de Cristal Porto', match: /pal[aá]cio de cristal|cristal/i },
  'uporto-reitoria': { category: 'Reitoria da Universidade do Porto', search: 'Reitoria Universidade Porto', match: /reitoria|universidade/i },

  // --- Porto 3D roster expansion: 40 new landmarks ---
  'ponte-sao-joao': { category: 'Ponte de São João', search: 'Ponte de São João Porto Douro', match: /s[ãa]o jo[ãa]o/i },
  'ponte-infante': { category: 'Ponte do Infante D. Henrique', search: 'Ponte do Infante D. Henrique Porto', match: /infante/i },
  'ponte-freixo': { category: 'Ponte do Freixo', search: 'Ponte do Freixo Porto', match: /freixo/i },
  'serra-do-pilar': { category: 'Mosteiro da Serra do Pilar', search: 'Serra do Pilar Vila Nova de Gaia', match: /serra do pilar|mosteiro/i },
  'jardim-do-morro': { category: 'Jardim do Morro', search: 'Jardim do Morro Vila Nova de Gaia', match: /morro/i },
  'cais-gaia': { category: 'Cais de Gaia', search: 'Cais de Gaia Vila Nova de Gaia', match: /gaia|cais/i },
  'convento-corpus-christi': { category: 'Convento de Corpus Christi', search: 'Convento Corpus Christi Vila Nova de Gaia', match: /corpus christi/i },
  'estacao-general-torres': { category: '', search: 'General Torres station', match: /general torres/i },
  trindade: { category: 'Igreja da Trindade (Porto)', search: 'Igreja da Trindade Porto', match: /trindade/i },
  congregados: { category: 'Igreja dos Congregados (Porto)', search: 'Igreja dos Congregados Porto', match: /congregados/i, avoid: /braga/i },
  lapa: { category: 'Igreja da Lapa (Porto)', search: 'Igreja da Lapa Porto', match: /lapa/i, avoid: /D\. Manuel|1908|prociss[ãa]o|b[êe]n[çc][ãa]o|cortejo|festividade/i },
  'santa-clara': { category: 'Igreja de Santa Clara (Porto)', search: '', match: /santa clara/i, avoid: /tapete|ma[çc]aroca|painel de padr|\bImage \d+|bordado|paramento/i },
  'sao-nicolau': { category: 'Igreja de São Nicolau (Porto)', search: 'Igreja de São Nicolau Porto', match: /nicolau/i },
  'sao-bento-vitoria': { category: 'Mosteiro de São Bento da Vitória', search: 'Igreja de São Bento da Vitória Porto', match: /bento da vit[óo]ria|vit[óo]ria/i },
  cedofeita: { category: 'Igreja de Cedofeita', search: 'Igreja de Cedofeita Porto', match: /cedofeita/i },
  'santo-ildefonso': { category: 'Igreja de Santo Ildefonso (Porto)', search: 'Igreja de Santo Ildefonso Porto', match: /ildefonso/i },
  'miragaya-sao-pedro': { category: 'Igreja de São Pedro de Miragaia', search: 'Igreja de São Pedro de Miragaia Porto', match: /miragaia|s[ãa]o pedro/i },
  'capela-almas': { category: 'Capela das Almas (Porto)', search: 'Capela das Almas Porto', match: /almas|santa catarina/i },
  'foz-sao-joao-baptista': { category: 'Igreja de São João Baptista (Porto)', search: 'Igreja de São João Baptista Foz Porto', match: /jo[ãa]o baptista|foz/i },
  ramalde: { category: 'Igreja de Ramalde', search: 'Igreja de Ramalde Porto', match: /ramalde/i },
  campanha: { category: 'Estação Ferroviária de Porto-Campanhã', search: 'Estação de Campanhã Porto', match: /campanh[ãa]/i },
  coliseu: { category: 'Coliseu do Porto', search: 'Coliseu do Porto', match: /coliseu/i },
  'museu-soares-dos-reis': { category: 'Museu Nacional de Soares dos Reis', search: 'Museu Nacional Soares dos Reis Porto', match: /soares dos reis/i },
  'casa-do-infante': { category: 'Casa do Infante', search: 'Casa do Infante Porto', match: /casa do infante|infante/i },
  'alfandega-nova': { category: 'Alfândega Nova do Porto', search: 'Alfândega Nova Porto', match: /alf[âa]ndega/i },
  'museu-romantico': { category: 'Museu Romântico (Porto)', search: 'Museu Romântico Porto Quinta da Macieirinha', match: /rom[âa]ntico|macieirinha/i },
  'casa-guerra-junqueiro': { category: 'Casa de Guerra Junqueiro', search: 'Casa Guerra Junqueiro Porto', match: /guerra junqueiro/i },
  'teatro-rivoli': { category: 'Teatro Rivoli (Porto)', search: 'Teatro Rivoli Porto', match: /rivoli/i },
  'cinema-batalha': { category: 'Cinema Batalha', search: 'Cinema Batalha Porto', match: /batalha/i },
  'cadeia-relacao': { category: 'Cadeia da Relação (Porto)', search: 'Cadeia da Relação Porto', match: /rela[çc][ãa]o/i },
  'almeida-garrett': { category: 'Rua de Almeida Garrett (Porto)', search: 'Rua Almeida Garrett Porto', match: /almeida garrett/i, avoid: /clock|rel[óo]gio|automaton|santa catarina/i },
  'museu-misericordia': { category: 'Museu da Misericórdia do Porto', search: 'Museu da Misericórdia Porto', match: /miseric[óo]rdia/i },
  'parque-cidade': { category: 'Parque da Cidade do Porto', search: 'Parque da Cidade Porto', match: /parque da cidade/i },
  cordoaria: { category: 'Jardim da Cordoaria', search: 'Jardim da Cordoaria Porto', match: /cordoaria/i },
  'sao-lazaro': { category: 'Jardim de São Lázaro', search: 'Jardim de São Lázaro Porto', match: /l[áa]zaro/i },
  'passeio-alegre': { category: 'Passeio Alegre', search: 'Passeio Alegre Foz Porto', match: /passeio alegre/i, avoid: /\bbus\b|schedule|hor[áa]rio|autocarro/i },
  'praca-batalha': { category: 'Praça da Batalha', search: 'Praça da Batalha Porto', match: /batalha/i },
  'castelo-queijo': { category: 'Castelo do Queijo', search: 'Castelo do Queijo Porto', match: /castelo do queijo|queijo|francisco xavier/i },
  'praia-ingleses': { category: 'Praia dos Ingleses (Porto)', search: 'Praia dos Ingleses Porto', match: /ingleses|foz do douro|beach|praia/i },
  'sealife-porto': { category: 'Sea Life Porto', search: 'Sea Life Porto', match: /sea ?life/i },

  // --- Porto 3D roster expansion 2: 10 more landmarks ---
  bessa: { category: 'Estádio do Bessa', search: 'Estádio do Bessa Porto', match: /bessa/i },
  'teatro-sa-da-bandeira': { category: 'Teatro Sá da Bandeira', search: 'Teatro Sá da Bandeira Porto', match: /s[áa] da bandeira|teatro/i },
  'teatro-nacional-sao-joao': { category: 'Teatro Nacional São João', search: 'Teatro Nacional São João Porto', match: /s[ãa]o jo[ãa]o|teatro nacional/i },
  'igreja-da-vitoria': { category: 'Igreja da Vitória (Porto)', search: 'Igreja da Vitória Porto', match: /vit[óo]ria/i, avoid: /setúbal|lisboa|batalha/i },
  'igreja-carmelitas': { category: 'Igreja dos Carmelitas Descalços (Porto)', search: 'Igreja dos Carmelitas Descalços Porto', match: /carmelitas/i, avoid: /aveiro/i },
  'casa-museu-marta-ortigao-sampaio': { category: 'Sofia Martins de Souza', search: 'Aurélia de Souza Casa-Museu Marta Ortigão Sampaio', match: /souza|sousa|sampaio|aur[ée]lia|marta ortig/i },
  'mercado-matosinhos': { category: 'Mercado Municipal de Matosinhos', search: 'Mercado Municipal de Matosinhos', match: /matosinhos|mercado/i },
  'camara-matosinhos': { category: 'Câmara Municipal de Matosinhos', search: 'Câmara Municipal de Matosinhos', match: /matosinhos|c[âa]mara/i, avoid: /jardim|capela|old part|bairro|wikivoyage|pitka|antiga|rua/i },
  'farol-leca': { category: 'Farol da Boa Nova', search: 'Farol de Leça Boa Nova', match: /boa nova|le[çc]a|farol/i, avoid: /tr[êe]s bicos|sobreiras/i },
  'paco-episcopal': { category: 'Paço Episcopal do Porto', search: 'Paço Episcopal Porto', match: /pa[çc]o episcopal|episcopal/i },
};

const args = process.argv.slice(2);
const force = args.includes('--force');
const captionsOnly = args.includes('--captions');
// --images-only: download photos for the given ids straight from Commons
// category/search into assets/img/ and record credits in assets/img/credits.json.
// It never reads or writes data/new/<id>.landmark.json, so the parallel content
// agents stay the sole owners of those fragments.
const imagesOnly = args.includes('--images-only');
const only = args.filter((a) => !a.startsWith('-'));

const landmarksFile = join(ROOT, 'data', 'landmarks.json');
const ids = existsSync(landmarksFile)
  ? JSON.parse(readFileSync(landmarksFile, 'utf8')).map((l) => l.id)
  : readdirSync(NEW).filter((f) => f.endsWith('.landmark.json')).map((f) => f.replace('.landmark.json', ''));
const targets = imagesOnly
  ? (only.length ? only : Object.keys(COMMONS))
  : (only.length ? only : ids).filter((id) => existsSync(join(NEW, `${id}.landmark.json`)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (t) => String(t || '').replace(/_/g, ' ').trim();

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

class CommonsError extends Error {}

async function get(url) {
  let last = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) {
        const text = await res.text();
        return JSON.parse(text);
      }
      last = new CommonsError(`HTTP ${res.status} for ${url}`);
      if (res.status !== 429 && res.status < 500) throw last;
    } catch (e) {
      last = e;
    }
    await sleep(1200 * (attempt + 1));
  }
  throw last || new CommonsError(`failed ${url}`);
}

function fileFromUrl(u) {
  const m = decodeURIComponent(String(u || '')).match(/\/wiki\/(File:[^?#]+)/);
  return m ? norm(m[1]) : null;
}

function parseInfo(page) {
  const ii = page.imageinfo?.[0];
  if (!ii) return null;
  const m = ii.extmetadata || {};
  return {
    title: norm(page.title),
    thumb: (ii.thumburl || ii.url || '').split('?')[0],
    width: ii.thumbwidth || ii.width,
    height: ii.thumbheight || ii.height,
    source_url: ii.descriptionurl,
    license: stripHtml(m.LicenseShortName?.value),
    author: stripHtml(m.Artist?.value) || 'Wikimedia Commons',
    description: stripHtml(m.ImageDescription?.value) || stripHtml(m.ObjectName?.value),
  };
}

async function imageInfo(titles) {
  const out = new Map();
  const list = titles.map(norm);
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const url = `${API}?action=query&titles=${chunk.map((t) => encodeURIComponent(t)).join('%7C')}` +
      `&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=1600&format=json&origin=*`;
    const json = await get(url);
    for (const page of Object.values(json.query?.pages || {})) {
      const info = parseInfo(page);
      if (info) out.set(norm(info.title), info);
    }
  }
  return out;
}

const LICENSE_BAD = /NonCommercial|NoDerivs|\bNC\b|\bND\b|GFDL|GDFL|Fair use|Copyright|All rights reserved|non-free|no derivative/i;
const LICENSE_OK = /CC0|CC[ -]?BY|Public domain|\bPD\b|Attribution|Free Art License|\bFAL\b/i;
const licenseOk = (l) => !!l && !LICENSE_BAD.test(l) && LICENSE_OK.test(l);

const EXCLUDE = /\b(map|plan|plano|planta|piso|al[çc]ado|corte|se[cç][cç][aã]o|grundriss|logo|icon|coat of arms|brasão|diagram|drawing|desenho|engraving|gravura|estampa|lithograph|etching|aquatint|watercolou?r|aquarela|aquarelle|painting|postcard|postal|stamp|banknote|plaque|placa|sign|topon[ií]mia|blueprint|3d model|equirectangular|floor plan|seal of|banner|album|capa|cd cover|book cover|cover art|miniature|maquette|replica|minieurope|projecto|di[áa]rio|newspaper)\b/i;
const NON_PHOTO = /floor plan|planta|grundriss|engraving|gravura|lithograph|etching|aquatint|watercolou?r|aquarela|aquarelle|drawing|desenho|line drawing|illustration|postcard|postal|plaque|placa|miniature|maquette|replica|minieurope|album cover|cd cover|book cover|cover art/i;
const OLD = /domingos alv[ãa]o|\b18\d\d\b|\b19[0-7]\d\b/i;
const usableName = (t) => /\.(jpe?g|png)$/i.test(t) && !EXCLUDE.test(t);
const isJpg = (t) => /\.jpe?g$/i.test(t);
const prefixOf = (t) => t.replace(/\.[a-z]+$/i, '').replace(/\d+/g, '').replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);

function describe(text) {
  const t = String(text || '').toLowerCase();
  const has = (re) => re.test(t);
  if (has(/\b(night|evening|blue hour|illuminat|lit at|at night|lights)\b/)) return { kind: 'exterior', ru: 'вечерняя подсветка' };
  if (has(/\b(sunset|sunrise|dusk|dawn|golden hour)\b/)) return { kind: 'exterior', ru: 'на закате' };
  if (has(/\b(altar|altarpiece|retable)\b/)) return { kind: 'interior', ru: 'главный алтарь' };
  if (has(/\b(cloister|cloisters)\b/)) return { kind: 'interior', ru: 'клуатр' };
  if (has(/\b(pipe organ|organ)\b/)) return { kind: 'interior', ru: 'орган' };
  if (has(/\b(nave|transept|chancel|apse|chapel|crypt|sacristy|pulpit)\b/)) return { kind: 'interior', ru: 'интерьер' };
  if (has(/\b(interior|inside|inner|ceiling)\b/)) return { kind: 'interior', ru: 'интерьер' };
  if (has(/\b(tower|bell tower|clocher|campanile|belfry)\b/)) return { kind: 'exterior', ru: 'колокольня' };
  if (has(/\b(aerial|from above|drone)\b/)) return { kind: 'detail', ru: 'вид с высоты' };
  if (has(/\b(view|panorama|panoramic|vista|lookout|miradouro|from the (top|tower)|from the river)\b/)) return { kind: 'detail', ru: 'панорамный вид' };
  if (has(/\b(azulejo|azulejos|tile|tiles)\b/)) return { kind: 'detail', ru: 'азулежу' };
  if (has(/\b(portal|entrance|doorway|door)\b/)) return { kind: 'detail', ru: 'портал и вход' };
  if (has(/\b(detail|close-?up|capital|window|ironwork|gargoyle|statue|sculpture)\b/)) return { kind: 'detail', ru: 'деталь' };
  if (has(/\b(bridge|ponte|viaduct)\b/)) return { kind: 'exterior', ru: 'мост' };
  if (has(/\b(garden|gardens|park|jardim)\b/)) return { kind: 'exterior', ru: 'сад' };
  if (has(/\b(waterfront|riverside|quay|harbou?r)\b/)) return { kind: 'exterior', ru: 'набережная' };
  if (has(/\b(river|douro)\b/)) return { kind: 'exterior', ru: 'река Дору' };
  if (has(/\b(market|mercado)\b/)) return { kind: 'exterior', ru: 'рынок' };
  if (has(/\b(station|railway|train|tram)\b/)) return { kind: 'exterior', ru: 'вокзал' };
  if (has(/\b(cellar|cellars|barrel|barrels|wine|vinho|port wine)\b/)) return { kind: 'exterior', ru: 'винные погреба' };
  if (has(/\b(stadium|est[áa]dio|football)\b/)) return { kind: 'exterior', ru: 'стадион' };
  if (has(/\b(facade|façade|front)\b/)) return { kind: 'exterior', ru: 'фасад' };
  if (has(/\b(square|street|avenue|praca|praça|rua)\b/)) return { kind: 'exterior', ru: 'улица и площадь' };
  return { kind: 'exterior', ru: 'общий вид' };
}

async function listCategory(cat) {
  if (!cat) return [];
  const url = `${API}?action=query&list=categorymembers&cmtitle=${encodeURIComponent(`Category:${cat}`)}` +
    `&cmtype=file&cmlimit=100&format=json&origin=*`;
  try {
    const json = await get(url);
    return (json.query?.categorymembers || []).map((m) => norm(m.title));
  } catch {
    return [];
  }
}

async function searchFiles(query) {
  if (!query) return [];
  const url = `${API}?action=query&list=search&srsearch=${encodeURIComponent(query)}` +
    `&srnamespace=6&srlimit=40&format=json&origin=*`;
  try {
    const json = await get(url);
    return (json.query?.search || []).map((s) => norm(s.title));
  } catch {
    return [];
  }
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new CommonsError(`download ${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = mkdtempSync(join(tmpdir(), 'p3d-'));
  const raw = join(tmp, 'raw');
  writeFileSync(raw, buf);
  try {
    for (const q of [84, 78, 72, 66, 60, 54, 48, 42]) {
      execFileSync('magick', [raw, '-resize', '1600x1600>', '-strip', '-interlace', 'Plane', '-sampling-factor', '4:2:0', '-quality', String(q), dest]);
      const size = existsSync(dest) ? readFileSync(dest).length : Infinity;
      if (size < MAX_BYTES) return size;
    }
    execFileSync('magick', [raw, '-resize', '1280x1280>', '-strip', '-interlace', 'Plane', '-sampling-factor', '4:2:0', '-quality', '52', dest]);
    return readFileSync(dest).length;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function galleryComplete(c, id) {
  if (force || !c.image) return false;
  const gal = c.gallery || [];
  if (!gal.length) return false;
  return gal.every((g) => {
    const src = g.img || g.src;
    return src && existsSync(join(ROOT, src));
  });
}

function captionFor(nameRu, ru) {
  const n = String(nameRu).toLowerCase();
  const redundant = { 'вокзал': /вокзал/, 'рынок': /рынок/, 'сад': /сад/, 'стадион': /стадион/, 'мост': /мост/, 'набережная': /набережн/, 'винные погреба': /погреб/ };
  const re = redundant[ru];
  return re && re.test(n) ? 'общий вид' : ru;
}

// Gather free-licensed candidates for a landmark config, score them, and
// return the sorted list. Used by both the fragment path (main image already
// recorded) and the --images-only path.
async function gatherScored(cfg, excludeTitles = []) {
  const candidates = [];
  for (const t of await listCategory(cfg.category)) candidates.push({ title: t, from: 'category' });
  await sleep(200);
  for (const t of await searchFiles(cfg.search)) candidates.push({ title: t, from: 'search' });

  const seen = new Set(excludeTitles.map(norm));
  const dedup = [];
  for (const cand of candidates) {
    const t = norm(cand.title);
    if (seen.has(t) || !usableName(t)) continue;
    seen.add(t);
    dedup.push({ ...cand, title: t });
  }

  await sleep(200);
  const infos = await imageInfo(dedup.map((d) => d.title));
  const scored = [];
  for (const cand of dedup) {
    const info = infos.get(cand.title);
    if (!info || !licenseOk(info.license)) continue;
    if (info.width && info.width < 800) continue;
    const text = `${info.title} ${info.description}`;
    if (NON_PHOTO.test(text)) continue;
    if (cfg.avoid && cfg.avoid.test(text)) continue;
    const match = cfg.match ? cfg.match.test(text) : true;
    if (cand.from === 'search' && !match) continue;
    const desc = describe(text);
    const score = (cand.from === 'category' ? 1000 : 0) + (match ? 500 : 0) +
      (isJpg(info.title) ? 100 : 0) + (info.width > info.height ? 25 : 0) +
      Math.min(info.width || 0, 2400) / 20 - (OLD.test(text) ? 400 : 0);
    scored.push({ info, desc, from: cand.from, prefix: prefixOf(info.title), score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// Pick up to `max` candidates, preferring distinct filename prefixes (avoids
// three frames of the same photo series) and then filling from the rest.
function pickDiverse(scored, max) {
  const picked = [];
  const usedPrefix = new Set();
  for (const s of scored) {
    if (picked.length >= max) break;
    if (usedPrefix.has(s.prefix)) continue;
    usedPrefix.add(s.prefix);
    picked.push(s);
  }
  for (const s of scored) {
    if (picked.length >= max) break;
    if (!picked.includes(s)) picked.push(s);
  }
  return picked;
}

const summary = [];
const manifests = {};

if (!captionsOnly) for (const id of targets) {
  const cfg = COMMONS[id] || {};

  // --- images-only: download from Commons without touching any fragment ---
  if (imagesOnly) {
    if (!force && existsSync(join(IMG, `${id}.jpg`))) {
      console.log(`${id}: images exist, skipped`);
      continue;
    }
    let count = 0;
    let bytes = 0;
    const licenses = [];
    try {
      const scored = await gatherScored(cfg, []);
      if (!scored.length) throw new CommonsError('no free-licensed candidates');
      const picked = pickDiverse(scored, MAX_IMAGES);
      for (const f of readdirSync(IMG)) {
        if (f.startsWith(`${id}-`) && f.endsWith('.jpg')) rmSync(join(IMG, f), { force: true });
      }
      const manifest = { main: null, gallery: [] };
      for (let i = 0; i < picked.length; i++) {
        const { info, desc } = picked[i];
        const name = i === 0 ? `${id}.jpg` : `${id}-${i}.jpg`;
        const dest = join(IMG, name);
        const size = await download(info.thumb, dest);
        const entry = {
          file: `assets/img/${name}`,
          kind: desc.kind,
          author: info.author,
          license: info.license || 'see source',
          source_url: info.source_url,
          commons: info.title,
        };
        if (i === 0) manifest.main = entry;
        else manifest.gallery.push(entry);
        count++;
        bytes += size;
        licenses.push(info.license);
        console.log(`${id}: ${name} ${info.title} -> ${(size / 1024).toFixed(0)} KB [${info.license}]`);
        await sleep(120);
      }
      manifests[id] = manifest;
      summary.push({ id, count, bytes, licenses });
      console.log(`${id}: ${count} image${count === 1 ? '' : 's'}`);
    } catch (e) {
      console.error(`${id}: FAILED — ${e.message}`);
      process.exitCode = 1;
    }
    continue;
  }

  const path = join(NEW, `${id}.landmark.json`);
  const c = JSON.parse(readFileSync(path, 'utf8'));
  if (galleryComplete(c, id)) {
    console.log(`${id}: already complete, skipped`);
    continue;
  }

  const nameRu = c.name_ru || id;
  const mainTitle = fileFromUrl(c.image_credit?.source_url);
  let count = 0;
  let bytes = 0;
  const licenses = [];
  try {
    // --- main image: the file page already recorded in the fragment ---
    if (mainTitle) {
      const info = (await imageInfo([mainTitle])).get(mainTitle);
      if (!info) throw new CommonsError(`main ${mainTitle} not found on Commons`);
      const size = await download(info.thumb, join(IMG, `${id}.jpg`));
      c.image = `assets/img/${id}.jpg`;
      c.image_credit = { author: info.author, license: info.license || 'see source', source_url: info.source_url };
      count++;
      bytes += size;
      licenses.push(info.license);
      console.log(`${id}: main ${info.title} -> ${(size / 1024).toFixed(0)} KB [${info.license}]`);
      await sleep(120);
    } else if (!c.image) {
      console.warn(`${id}: no main photo source recorded`);
    }

    // --- gallery: category files first, then search fallback ---
    const scored = await gatherScored(cfg, mainTitle ? [mainTitle] : []);
    const picked = pickDiverse(scored, MAX_GALLERY);

    const gallery = [];
    for (let i = 0; i < picked.length; i++) {
      const { info, desc } = picked[i];
      const dest = join(IMG, `${id}-${i + 1}.jpg`);
      const size = await download(info.thumb, dest);
      gallery.push({
        img: `assets/img/${id}-${i + 1}.jpg`,
        kind: desc.kind,
        caption_ru: `${nameRu} — ${captionFor(nameRu, desc.ru)}`,
        credit: { author: info.author, license: info.license || 'see source', source_url: info.source_url },
        _commons: info.title,
      });
      count++;
      bytes += size;
      licenses.push(info.license);
      console.log(`${id}: gallery ${i + 1} ${info.title} -> ${(size / 1024).toFixed(0)} KB [${info.license}]`);
      await sleep(120);
    }

    c.gallery = gallery;
    writeFileSync(path, JSON.stringify(c, null, 2) + '\n');
    summary.push({ id, count, bytes, licenses });
    console.log(`${id}: fragment updated (${count} image${count === 1 ? '' : 's'})`);
  } catch (e) {
    console.error(`${id}: FAILED — ${e.message}`);
    process.exitCode = 1;
  }
}

// --images-only: persist the real author / licence / Commons file page URL for
// every file just downloaded, so the merge step (or a human) can credit them.
if (imagesOnly && Object.keys(manifests).length) {
  const creditsPath = join(IMG, 'credits.json');
  const existing = existsSync(creditsPath) ? JSON.parse(readFileSync(creditsPath, 'utf8')) : {};
  writeFileSync(creditsPath, JSON.stringify({ ...existing, ...manifests }, null, 2) + '\n');
  console.log(`wrote ${creditsPath} (${Object.keys(manifests).length} landmarks)`);
}

const totalBytes = summary.reduce((a, s) => a + s.bytes, 0);
const mix = {};
for (const s of summary) for (const l of s.licenses) mix[l || 'unknown'] = (mix[l || 'unknown'] || 0) + 1;
console.log(`\ndownloaded ${summary.reduce((a, s) => a + s.count, 0)} images, ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
console.log('licenses:', JSON.stringify(mix));
for (const s of summary) if (!imagesOnly && s.count < 4) console.log(`  ${s.id}: ${s.count} image(s)`);

// --captions: recompute gallery kind/caption from the stored Commons title
// without re-downloading anything.
if (captionsOnly) {
  for (const id of targets) {
    const path = join(NEW, `${id}.landmark.json`);
    const c = JSON.parse(readFileSync(path, 'utf8'));
    const nameRu = c.name_ru || id;
    const gal = c.gallery || [];
    const titles = gal.map((g) => g._commons).filter(Boolean);
    if (!titles.length) {
      console.warn(`${id}: no _commons titles stored, cannot refresh`);
      continue;
    }
    const infos = await imageInfo(titles);
    let changed = false;
    for (const g of gal) {
      const info = infos.get(norm(g._commons));
      if (!info) continue;
      const desc = describe(`${info.title} ${info.description}`);
      const cap = `${nameRu} — ${captionFor(nameRu, desc.ru)}`;
      if (g.kind !== desc.kind || g.caption_ru !== cap) {
        g.kind = desc.kind;
        g.caption_ru = cap;
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(path, JSON.stringify(c, null, 2) + '\n');
      console.log(`${id}: captions refreshed`);
    } else {
      console.log(`${id}: captions unchanged`);
    }
  }
}