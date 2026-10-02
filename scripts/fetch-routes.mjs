// Build <data dir>/routes.json: three walking itineraries with real street geometry.
// Node 22, no dependencies. Run: node scripts/fetch-routes.mjs
//
// Routing:
// - foot legs: FOSSGIS OSRM walking server (routing.openstreetmap.de/routed-foot).
//   The public demo server router.project-osrm.org ignores the /foot/ profile and returns
//   car routes for every profile (checked 2026-09-28: same distance and duration for foot and driving),
//   so we use it only as a fallback.
// - bus / taxi legs: router.project-osrm.org, driving profile.
// - funicular leg part: straight track of the Elevador do Bom Jesus (OSM way 26307689 + 772942621).
// Stop times, distance_km and duration_ru come from the legs plus stay_min. Nothing is typed by hand.
import { readFileSync, writeFileSync } from 'node:fs';
import { CITY, dataPath, dataRel } from './city-lib.mjs';

// --city <id> picks the city (default braga). The itineraries are content:
// see ROUTES_BY_CITY below.
const OUT = dataPath('routes.json');
let byId = {}; // landmark id -> landmark; loaded after the route table is picked

const UA = `${CITY.id}-3d-content/1.0 (timur@swiirl.ai)`;
const FOOT_URLS = [
  'https://routing.openstreetmap.de/routed-foot/route/v1/foot',
  'https://router.project-osrm.org/route/v1/foot',
];
const CAR_URLS = [
  'https://router.project-osrm.org/route/v1/driving',
  'https://routing.openstreetmap.de/routed-car/route/v1/driving',
];
const DELAY_MS = 1200;

// Elevador do Bom Jesus: lower station -> upper station (OSM geometry).
const FUNICULAR_BY_CITY = { braga: [[41.55471, -8.38073], [41.55486, -8.37888], [41.55492, -8.3779]] };
const FUNICULAR = FUNICULAR_BY_CITY[CITY.id] || [];
// Modelling allowances (not from a timetable). bomjesus.pt gives the track (267 m, 116 m climb)
// but no ride time, so we allow 3 min for the ride and 10 min for waiting at a city bus stop.
const FUNICULAR_MIN = 3;
const BUS_EXTRA_MIN = 10;

const wait = ms => new Promise(res => setTimeout(res, ms));
const r5 = x => Math.round(x * 1e5) / 1e5;

function haversine([la1, lo1], [la2, lo2]) {
  const R = 6371000, rad = Math.PI / 180;
  const a = Math.sin((la2 - la1) * rad / 2) ** 2 + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin((lo2 - lo1) * rad / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function osrm(urls, pts) {
  const coords = pts.map(([lat, lon]) => `${lon},${lat}`).join(';');
  let lastErr;
  for (let round = 0; round < 3; round++) {
    for (const base of urls) {
      try {
        await wait(DELAY_MS);
        const res = await fetch(`${base}/${coords}?overview=full&geometries=geojson`, { headers: { 'User-Agent': UA } });
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${base}`);
        const j = await res.json();
        if (j.code !== 'Ok' || !j.routes?.length) throw new Error(`OSRM ${j.code} from ${base}`);
        const r = j.routes[0];
        return { distance: r.distance, duration: r.duration, pts: r.geometry.coordinates.map(([lon, lat]) => [r5(lat), r5(lon)]), server: base };
      } catch (e) {
        lastErr = e;
        console.warn(`  retry: ${e.message}`);
      }
    }
    await wait(3000 * (round + 1));
  }
  throw lastErr;
}

const ll = id => {
  const l = byId[id];
  if (!l) throw new Error(`unknown landmark_id ${id}`);
  return [l.lat, l.lon];
};

// Walking speed check: OSRM foot uses about 5 km/h. We keep its duration.
async function buildLeg(from, to, mode, note_ru, opts = {}) {
  const a = ll(from), b = ll(to);
  let distance, minutes, pts;
  if (mode === 'foot') {
    const r = await osrm(FOOT_URLS, [a, b]);
    if (!r.server.includes('routed-foot')) console.warn(`  WARNING: ${from}->${to} used fallback ${r.server}`);
    distance = r.distance; minutes = r.duration / 60; pts = r.pts;
  } else if (mode === 'taxi') {
    const r = await osrm(CAR_URLS, [a, b]);
    distance = r.distance; minutes = r.duration / 60; pts = r.pts;
  } else if (mode === 'bus') {
    // Bus to the lower funicular station, then the funicular up (opts.funicular).
    const end = opts.funicular ? FUNICULAR[0] : b;
    const r = await osrm(CAR_URLS, [a, end]);
    distance = r.distance; minutes = r.duration / 60 + BUS_EXTRA_MIN; pts = r.pts;
    if (opts.funicular) {
      for (let i = 1; i < FUNICULAR.length; i++) distance += haversine(FUNICULAR[i - 1], FUNICULAR[i]);
      minutes += FUNICULAR_MIN;
      pts = pts.concat(FUNICULAR, [b.map(r5)]);
    }
  } else throw new Error(`mode ${mode}`);
  return { from, to, mode, distance_m: Math.round(distance), duration_min: Math.max(1, Math.round(minutes)), note_ru, pts };
}

const hhmm = min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const round5 = m => Math.round(m / 5) * 5;
const hoursRu = min => {
  const h = Math.round(min / 30) / 2; // nearest half hour
  if (!Number.isInteger(h)) return `${String(h).replace('.', ',')} часа`; // 6,5 часа
  const n10 = h % 10, n100 = h % 100;
  const word = n10 === 1 && n100 !== 11 ? 'час' : n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? 'часа' : 'часов';
  return `${h} ${word}`;
};

// Route definitions. stops[i].day starts a new day (time resets to dayStart).
const BRAGA_ROUTES = [
  {
    id: 'classic-day',
    name_ru: 'Классическая Брага за день',
    subtitle_ru: 'Старый центр утром, Бом-Жезуш и Самейру после обеда',
    color: '#e8b04b',
    start: '09:30',
    description_ru: 'Утро проходит в старом центре: собор, западные ворота, дворец Бишкайньюш и сад у дворца архиепископов. Все эти места лежат в десяти минутах ходьбы друг от друга. Обедайте на площади Республики, под Аркадой или на соседних улицах. После обеда садитесь на автобус 2 на Авенида-да-Либердаде и выходите у нижней станции фуникулёра. Выезжайте не позже 14:30, чтобы подняться на водяном фуникулёре, пройти лестницу и дойти пешком до Самейру до заката. Не планируйте маршрут на понедельник: в этот день музей Бишкайньюш закрыт.',
    stops: [
      { id: 'se-braga', stay: 45, note: 'Начните с собора, пока в нём тихо. Загляните в Капеллу королей и во двор с часовнями.' },
      { id: 'arco-porta-nova', stay: 10, note: 'Пройдите под аркой и посмотрите на её фасад со стороны старого города.' },
      { id: 'biscainhos', stay: 50, note: 'Залы дворца и барочный сад за домом. Сад часто оставляют на конец визита.' },
      { id: 'santa-barbara', stay: 20, note: 'Короткая прогулка по саду у средневекового крыла дворца архиепископов.' },
      { id: 'torre-menagem', stay: 10, note: 'Башня замка стоит в двух шагах от площади, осмотр снаружи.' },
      { id: 'praca-republica', stay: 75, note: 'Обед и кофе под Аркадой. После обеда идите к автобусу.' },
      { id: 'avenida-central', stay: 5, note: 'Остановка автобуса 2 на Авенида-да-Либердаде.' },
      { id: 'bom-jesus', stay: 90, note: 'Поднимитесь на фуникулёре, а вниз к фонтанам лестницы спуститесь пешком и вернитесь к базилике.' },
      { id: 'sameiro', stay: 45, note: 'Площадь святилища — лучшая смотровая точка над Брагой. Обратно в город идёт автобус или такси.' },
    ],
    legs: [
      { mode: 'foot', note: 'По улице Дон-Паю-Мендеш на запад.' },
      { mode: 'foot', note: 'Через старый квартал к дворцу Бишкайньюш.' },
      { mode: 'foot', note: 'Обратно к центру, к саду Санта-Барбара.' },
      { mode: 'foot', note: 'Пара минут до башни замка.' },
      { mode: 'foot', note: 'Башня стоит у самой площади.' },
      { mode: 'foot', note: 'По Авенида-Сентрал к остановке автобуса.' },
      { mode: 'bus', funicular: true, note: 'Автобус 2 до нижней станции фуникулёра, затем водяной фуникулёр 1882 года наверх.' },
      { mode: 'foot', note: 'Пешком в гору по лесной дороге, около 2 км. Можно взять такси.' },
    ],
  },
  {
    id: 'sacred',
    name_ru: 'Сакральная Брага',
    subtitle_ru: 'Монастырь Тибайнш, собор, барочные церкви и два святилища на холмах',
    color: '#9b7fd4',
    start: '10:00',
    description_ru: 'Маршрут начинается за городом, в бенедиктинском монастыре Тибайнш. Он открывается в 10:00 и закрыт по понедельникам. Туда удобнее ехать на такси к открытию, пока в монастыре мало людей. Потом такси везёт вас к собору, старейшему храму Браги. Обедайте рядом с собором или у церкви Санта-Круш. От римского святилища Фонте-ду-Идолу после обеда автобус 2 везёт вас к Бом-Жезушу, и день заканчивается у Самейру.',
    stops: [
      { id: 'tibaes', stay: 105, note: 'Монастырь открывается в 10:00. Церковь, клуатры и монастырский парк. Не спешите в саду с лестницей и фонтанами.' },
      { id: 'se-braga', stay: 60, note: 'Собор, Капелла королей и сокровищница.' },
      { id: 'santa-cruz', stay: 25, note: 'Посмотрите на резной фасад, потом на позолоченную резьбу внутри.' },
      { id: 'fonte-idolo', stay: 25, note: 'Святилище у родника I века, древнейший культовый памятник в центре.' },
      { id: 'bom-jesus', stay: 90, note: 'Лестница паломников с часовнями Крестного пути и базилика наверху.' },
      { id: 'sameiro', stay: 45, note: 'Святилище Девы Марии и вид на всю долину.' },
    ],
    legs: [
      { mode: 'taxi', note: 'Такси из Тибайнша в центр, к собору.' },
      { mode: 'foot', note: 'Через центр на восток. По дороге можно пообедать.' },
      { mode: 'foot', note: 'Несколько минут на юго-восток.' },
      { mode: 'bus', funicular: true, note: 'Автобус 2 до нижней станции фуникулёра, затем фуникулёр наверх.' },
      { mode: 'foot', note: 'Пешком в гору по лесной дороге, около 2 км. Можно взять такси.' },
    ],
  },
  {
    id: 'two-days',
    name_ru: 'Два дня без спешки',
    subtitle_ru: 'Римская Бракара, барочный центр, парк Понте, два стадиона и святилища',
    color: '#4bb3e8',
    start: '09:30',
    description_ru: 'Первый день целиком пешком. Вы идёте от римских терм на холме Сивидаде через старый центр к площади Республики и Авенида-Сентрал, а вечером спускаетесь по Авенида-да-Либердаде в парк Понте и к стадиону 1 Мая. Обедайте в середине дня у Театру Сирку или на площади. Второй день начинается с такси в монастырь Тибайнш. Потом такси везёт вас к стадиону в бывшем карьере и к Бом-Жезушу. День заканчивается у Самейру, откуда обратно идёт автобус или такси. Первый день ставьте со вторника по субботу: в воскресенье закрыты термы и дворец Райу, в понедельник — Бишкайньюш и Райу. Второй день не ставьте на понедельник, когда закрыт Тибайнш.',
    stops: [
      { id: 'termas-romanas', stay: 40, note: 'День 1. Римские термы Бракары-Августы на холме Сивидаде.' },
      { id: 'arco-porta-nova', stay: 10, note: 'Западные ворота старого города.' },
      { id: 'biscainhos', stay: 50, note: 'Дворец-музей и барочный сад.' },
      { id: 'se-braga', stay: 60, note: 'Собор, Капелла королей и сокровищница.' },
      { id: 'santa-cruz', stay: 25, note: 'Барочная церковь с резным фасадом.' },
      { id: 'palacio-raio', stay: 30, note: 'Фасад с изразцами и лестница внутри.' },
      { id: 'fonte-idolo', stay: 25, note: 'Римское святилище у родника, прямо рядом с дворцом Райу.' },
      { id: 'theatro-circo', stay: 60, note: 'Обед рядом, потом посмотрите фасад и фойе театра.' },
      { id: 'praca-republica', stay: 30, note: 'Кофе под Аркадой.' },
      { id: 'torre-menagem', stay: 10, note: 'Уцелевшая башня средневекового замка.' },
      { id: 'santa-barbara', stay: 20, note: 'Сад у дворца архиепископов.' },
      { id: 'avenida-central', stay: 20, note: 'Прогулка по бульвару, потом на юг по Авенида-да-Либердаде.' },
      { id: 'parque-ponte', stay: 30, note: 'Вечер в парке: озеро, часовня Сан-Жуан 1616 года и беседка.' },
      { id: 'estadio-1-maio', stay: 15, note: 'Гранитная башня и бронзовые рельефы у входа старого стадиона. Конец первого дня.' },
      { id: 'tibaes', stay: 120, day: 2, start: '10:00', note: 'День 2. Такси утром в монастырь Тибайнш, он открывается в 10:00.' },
      { id: 'estadio-braga', stay: 40, note: 'Стадион в бывшем карьере. Скалу за воротами видно и снаружи, из парка вокруг стадиона.' },
      { id: 'bom-jesus', stay: 90, note: 'Лестница паломников и базилика.' },
      { id: 'sameiro', stay: 45, note: 'Смотровая площадь над Брагой. Конец маршрута.' },
    ],
    legs: [
      { mode: 'foot', note: 'Спуск с холма Сивидаде к западным воротам.' },
      { mode: 'foot', note: 'Пара минут на север.' },
      { mode: 'foot', note: 'Через старый квартал к собору.' },
      { mode: 'foot', note: 'Через центр на восток.' },
      { mode: 'foot', note: 'Несколько минут на юг.' },
      { mode: 'foot', note: 'Святилище стоит у самого дворца.' },
      { mode: 'foot', note: 'На север, к театру на Авенида-да-Либердаде.' },
      { mode: 'foot', note: 'Вдоль Авенида-да-Либердаде к площади.' },
      { mode: 'foot', note: 'Башня стоит у площади.' },
      { mode: 'foot', note: 'Пара минут до сада.' },
      { mode: 'foot', note: 'Обратно через площадь на бульвар.' },
      { mode: 'foot', note: 'Вдоль Авенида-да-Либердаде на юг, до конца проспекта.' },
      { mode: 'foot', note: 'Пара минут через парк к стадиону.' },
      { mode: 'taxi', note: 'Утро второго дня: такси из города в Тибайнш.' },
      { mode: 'taxi', note: 'Такси через северную окраину к стадиону.' },
      { mode: 'taxi', note: 'Такси к Бом-Жезушу. Можно доехать до нижней станции и подняться на фуникулёре.' },
      { mode: 'foot', note: 'Пешком в гору по лесной дороге, около 2 км.' },
    ],
  },
];

// One entry per city. A city without an entry gets no routes.json from this script.
const ROUTES_BY_CITY = { braga: BRAGA_ROUTES };
const ROUTES = ROUTES_BY_CITY[CITY.id];
if (!ROUTES) {
  console.log(`no routes defined for ${CITY.id}; add them to scripts/fetch-routes.mjs`);
  process.exit(0);
}
byId = Object.fromEntries(JSON.parse(readFileSync(CITY.landmarksPath, 'utf8')).map(l => [l.id, l]));

async function buildRoute(def) {
  if (def.legs.length !== def.stops.length - 1) throw new Error(`${def.id}: legs must be stops-1`);
  const legs = [];
  for (let i = 0; i < def.legs.length; i++) {
    const from = def.stops[i].id, to = def.stops[i + 1].id, L = def.legs[i];
    console.log(`${def.id}: ${from} -> ${to} (${L.mode})`);
    legs.push(await buildLeg(from, to, L.mode, L.note, { funicular: L.funicular }));
  }
  const toMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
  let t = toMin(def.start);
  const dayMinutes = [];
  let dayBegin = t;
  const stops = def.stops.map((s, i) => {
    if (i > 0) {
      if (s.day) {
        dayMinutes.push(t - dayBegin);
        t = toMin(s.start || def.start); dayBegin = t;
      } else {
        t += legs[i - 1].duration_min;
      }
    }
    const arrive = round5(t);
    t = arrive + s.stay;
    const out = { landmark_id: s.id, time_ru: hhmm(arrive), stay_min: s.stay, note_ru: s.note };
    if (s.day) out.day = s.day;
    return out;
  });
  dayMinutes.push(t - dayBegin);
  // For multi-day routes the day-change leg (taxi next morning) is counted into day 2.
  if (dayMinutes.length > 1) {
    const idx = def.stops.findIndex(s => s.day);
    dayMinutes[dayMinutes.length - 1] += legs[idx - 1].duration_min;
  }
  const distance_km = Math.round(legs.reduce((a, l) => a + l.distance_m, 0) / 100) / 10;
  const walk_km = Math.round(legs.filter(l => l.mode === 'foot').reduce((a, l) => a + l.distance_m, 0) / 100) / 10;
  const duration_ru = dayMinutes.length === 1
    ? `≈ ${hoursRu(dayMinutes[0])}`
    : `${dayMinutes.length} дня: ${dayMinutes.map(m => `≈ ${hoursRu(m)}`).join(' + ')}`;
  return {
    id: def.id, name_ru: def.name_ru, subtitle_ru: def.subtitle_ru, color: def.color,
    duration_ru, distance_km, walk_km, description_ru: def.description_ru, stops, legs,
  };
}

const routes = [];
for (const def of ROUTES) routes.push(await buildRoute(def));
writeFileSync(OUT, JSON.stringify({
  attribution: 'Routes © OpenStreetMap contributors (ODbL). Routing: OSRM (project-osrm.org, FOSSGIS routing.openstreetmap.de).',
  routes,
}, null, 1) + '\n');
for (const r of routes) console.log(`${r.id}: ${r.distance_km} km (walk ${r.walk_km} km), ${r.duration_ru}`);
