// Placeholder data.
//
// PLACEHOLDER_LANDMARKS / PLACEHOLDER_ROADS: used only when data/landmarks.json
// or data/roads.json cannot be loaded.
//
// PLACEHOLDER_ENRICH: fake values for the optional rich fields (history,
// gallery, panorama, videos...). data.js merges them in only while the real
// data has none of these fields at all, or when the URL has ?demo. A field the
// real data sets, even to [] or null, always wins.
//
// PLACEHOLDER_ROUTES: used when data/routes.json cannot be loaded.
//
// Every fallback logs a console warning. Ids match the real landmark ids.

const credit = (author = 'Заглушка') => ({ author, license: '—', source_url: 'https://commons.wikimedia.org/' });

export const PLACEHOLDER_LANDMARKS = [
  {
    id: 'se-braga',
    name_pt: 'Sé de Braga',
    name_ru: 'Собор Браги',
    category: 'religious',
    lat: 41.54998,
    lon: -8.42715,
    year: '1089',
    short_ru: 'Старейший собор Португалии.',
    long_ru: 'Временный текст. Собор заложен в конце XI века. Настоящее описание появится, когда загрузятся данные.',
    model: 'cathedral',
    image: 'assets/img/se-braga.jpg',
    image_credit: credit(),
  },
  {
    id: 'arco-porta-nova',
    name_pt: 'Arco da Porta Nova',
    name_ru: 'Арка Порта-Нова',
    category: 'civic',
    lat: 41.55024,
    lon: -8.42934,
    year: '1773',
    short_ru: 'Барочные ворота в старый город.',
    long_ru: 'Временный текст. Триумфальная арка на западном входе в исторический центр.',
    model: 'arch',
    image: 'assets/img/arco-porta-nova.jpg',
    image_credit: credit(),
  },
  {
    id: 'praca-republica',
    name_pt: 'Praça da República',
    name_ru: 'Площадь Республики',
    category: 'civic',
    lat: 41.55131,
    lon: -8.42297,
    year: '',
    short_ru: 'Главная площадь города.',
    long_ru: 'Временный текст.',
    model: 'plaza',
    image: 'assets/img/praca-republica.jpg',
    image_credit: credit(),
  },
  {
    id: 'bom-jesus',
    name_pt: 'Santuário do Bom Jesus do Monte',
    name_ru: 'Бом-Жезуш-ду-Монте',
    category: 'religious',
    lat: 41.55494,
    lon: -8.37703,
    year: '1784',
    short_ru: 'Барочная лестница на склоне холма.',
    long_ru: 'Временный текст. Зигзагообразная лестница ведёт к церкви на вершине холма.',
    model: 'stairs-hill',
    image: 'assets/img/bom-jesus.jpg',
    image_credit: credit(),
  },
  {
    id: 'sameiro',
    name_pt: 'Santuário do Sameiro',
    name_ru: 'Святилище Самейру',
    category: 'religious',
    lat: 41.54182,
    lon: -8.36954,
    year: '1863',
    short_ru: 'Марианское святилище на вершине горы.',
    long_ru: 'Временный текст.',
    model: 'basilica',
    image: 'assets/img/sameiro.jpg',
    image_credit: credit(),
  },
  {
    id: 'tibaes',
    name_pt: 'Mosteiro de Tibães',
    name_ru: 'Монастырь Тибайнш',
    category: 'religious',
    lat: 41.55542,
    lon: -8.47881,
    year: '1628',
    short_ru: 'Бенедиктинский монастырь к западу от города.',
    long_ru: 'Временный текст. Бывший главный монастырь бенедиктинцев Португалии.',
    model: 'monastery',
    image: 'assets/img/tibaes.jpg',
    image_credit: credit(),
  },
];

// Fake rich content. Images are existing photos used as stand-ins; the
// panorama source "placeholder:gradient" makes panorama.js paint a 2:1
// gradient canvas at runtime. The video ids are real public videos, so the
// thumbnails load without 404s; titles say they are stand-ins.
const FAKE_VIDEOS = [
  { youtube_id: 'aqz-KE-bpKQ', title: 'Заглушка: видео о месте появится здесь', channel: 'Blender', lang: 'en' },
  { youtube_id: 'jNQXAC9IVRw', title: 'Заглушка: второе видео, короткий ролик', channel: 'jawed', lang: 'en' },
];

export const PLACEHOLDER_ENRICH = {
  'se-braga': {
    history_ru:
      'Заглушка. Первый абзац истории: епископ Педру начал строить собор в конце XI века на месте более старого храма.\n\n' +
      'Второй абзац: за восемь веков к романскому ядру пристроили готические капеллы, мануэлинскую галилею и барочные органы.\n\n' +
      'Третий абзац проверяет, что длинный текст переносится и читается в узкой колонке панели.',
    facts_ru: ['Заглушка: заложен около 1089 года', 'Два барочных органа XVIII века', 'Внутри — капелла Королей с гробницами родителей первого короля'],
    sources: [
      { title: 'Заглушка: статья в Википедии', url: 'https://pt.wikipedia.org/wiki/S%C3%A9_de_Braga' },
      { title: 'Заглушка: сайт собора', url: 'https://www.se-braga.pt/' },
    ],
    tip_ru: 'Заглушка: приходите к открытию, в 9:00, пока в нефе мало людей.',
    gallery: [
      { src: 'assets/img/se-braga.jpg', kind: 'exterior', caption_ru: 'Заглушка: западный фасад', credit: credit('Заглушка А') },
      { src: 'assets/img/santa-cruz.jpg', kind: 'interior', caption_ru: 'Заглушка: неф и органы', credit: credit('Заглушка Б') },
      { src: 'assets/img/torre-menagem.jpg', kind: 'detail', caption_ru: 'Заглушка: резьба портала', credit: credit('Заглушка В') },
      { src: 'assets/img/biscainhos.jpg', kind: 'interior', caption_ru: 'Заглушка: капелла Королей', credit: credit('Заглушка Г') },
      { src: 'assets/img/arco-porta-nova.jpg', kind: 'exterior', caption_ru: 'Заглушка: вид с улицы', credit: credit('Заглушка Д') },
    ],
    panorama: { src: 'placeholder:gradient', caption_ru: 'Заглушка: панорама нефа', credit: credit('Заглушка') },
    videos: FAKE_VIDEOS,
  },
  'bom-jesus': {
    history_ru:
      'Заглушка. Паломники поднимались на холм с XIV века.\n\n' +
      'Лестницу начали в 1722 году, храм закончили в 1811-м. В 1882 году открыли водяной фуникулёр.',
    facts_ru: ['Заглушка: 581 ступень', 'Фуникулёр движет вес воды', 'ЮНЕСКО с 2019 года'],
    sources: [{ title: 'Заглушка: UNESCO', url: 'https://whc.unesco.org/en/list/1590/' }],
    tip_ru: 'Заглушка: поднимитесь на фуникулёре, а вниз спуститесь по лестнице.',
    gallery: [
      { src: 'assets/img/bom-jesus.jpg', kind: 'exterior', caption_ru: 'Заглушка: лестница', credit: credit() },
      { src: 'assets/img/sameiro.jpg', kind: 'detail', caption_ru: 'Заглушка: фонтан', credit: credit() },
    ],
    panorama: { src: 'placeholder:gradient', caption_ru: 'Заглушка: вид с верхней площадки', credit: credit() },
    videos: FAKE_VIDEOS.slice(0, 1),
  },
  // real data has panorama:null here; with ?demo this shows the image viewer
  sameiro: {
    panorama: { src: 'placeholder:gradient', caption_ru: 'Заглушка: вид с вершины Самейру', credit: credit() },
  },
  'theatro-circo': {
    // partial on purpose: only the History tab should appear
    history_ru: 'Заглушка. Театр открыли в 1915 году.\n\nЭта запись проверяет, что пустые вкладки скрыты.',
    sources: [],
  },
};

// Routes. Real landmark ids; distances and times are rough stand-ins.
export const PLACEHOLDER_ROUTES = {
  routes: [
    {
      id: 'centro',
      name_ru: 'Старый город за полдня',
      subtitle_ru: 'Заглушка: от арки до садов',
      color: '#e8b04f',
      duration_ru: '3–4 часа',
      distance_km: 2.1,
      description_ru: 'Заглушка. Пешая прогулка по историческому центру: собор, дворцы барокко, римский источник и сад у епископского дворца.',
      stops: [
        { landmark_id: 'arco-porta-nova', time_ru: '10:00', stay_min: 10, note_ru: 'Начните у арки, лицом к старому городу.' },
        { landmark_id: 'se-braga', time_ru: '10:15', stay_min: 60, note_ru: 'Купите билет в сокровищницу.' },
        { landmark_id: 'santa-cruz', time_ru: '11:20', stay_min: 15, note_ru: '' },
        { landmark_id: 'palacio-raio', time_ru: '11:40', stay_min: 30, note_ru: 'Синий изразцовый фасад.' },
        { landmark_id: 'fonte-idolo', time_ru: '12:15', stay_min: 20, note_ru: '' },
        { landmark_id: 'praca-republica', time_ru: '12:40', stay_min: 45, note_ru: 'Обед под аркадой.' },
        { landmark_id: 'santa-barbara', time_ru: '13:30', stay_min: 20, note_ru: 'Лучший свет — после обеда.' },
      ],
      legs: [
        { from: 'arco-porta-nova', to: 'se-braga', mode: 'foot', distance_m: 210, duration_min: 3, note_ru: 'По Руа-Дон-Диогу-ди-Соза', pts: [[41.55024, -8.42934], [41.5502, -8.4282], [41.54998, -8.42715]] },
        { from: 'se-braga', to: 'santa-cruz', mode: 'foot', distance_m: 290, duration_min: 4, note_ru: '', pts: [[41.54998, -8.42715], [41.5494, -8.4262], [41.54921, -8.42426]] },
        { from: 'santa-cruz', to: 'palacio-raio', mode: 'foot', distance_m: 160, duration_min: 2, note_ru: '', pts: [[41.54921, -8.42426], [41.5486, -8.4235], [41.54835, -8.42265]] },
        { from: 'palacio-raio', to: 'fonte-idolo', mode: 'foot', distance_m: 90, duration_min: 1, note_ru: '', pts: [[41.54835, -8.42265], [41.5485, -8.42182]] },
        { from: 'fonte-idolo', to: 'praca-republica', mode: 'foot', distance_m: 420, duration_min: 6, note_ru: 'Мимо театра', pts: [[41.5485, -8.42182], [41.54969, -8.42261], [41.5506, -8.4228], [41.55131, -8.42297]] },
        { from: 'praca-republica', to: 'santa-barbara', mode: 'foot', distance_m: 260, duration_min: 4, note_ru: '', pts: [[41.55131, -8.42297], [41.5514, -8.4245], [41.55138, -8.4259]] },
      ],
    },
    {
      id: 'colinas',
      name_ru: 'Святилища на холмах',
      subtitle_ru: 'Заглушка: автобус, фуникулёр и такси',
      color: '#7fc4b8',
      duration_ru: 'полдня',
      distance_km: 14.5,
      description_ru: 'Заглушка. Автобус № 2 до нижней станции, подъём на водяном фуникулёре, пешая тропа до Самейру и такси обратно в город.',
      stops: [
        { landmark_id: 'praca-republica', time_ru: '09:30', stay_min: 0, note_ru: 'Остановка у кафе «Виана».' },
        { landmark_id: 'bom-jesus', time_ru: '10:10', stay_min: 90, note_ru: 'Спуститесь по лестнице пешком.' },
        { landmark_id: 'sameiro', time_ru: '12:20', stay_min: 45, note_ru: 'Вид на всю долину.' },
      ],
      legs: [
        {
          from: 'praca-republica', to: 'bom-jesus', mode: 'bus', distance_m: 6200, duration_min: 25, note_ru: 'Автобус № 2, каждые 30 мин',
          pts: [[41.55131, -8.42297], [41.552, -8.415], [41.553, -8.405], [41.5535, -8.395], [41.554, -8.387], [41.5537, -8.3811]],
        },
        { from: 'praca-republica', to: 'bom-jesus', mode: 'funicular', distance_m: 274, duration_min: 3, note_ru: 'Водяной фуникулёр 1882 года', pts: [[41.5537, -8.3811], [41.5543, -8.3792], [41.55494, -8.37703]] },
        { from: 'bom-jesus', to: 'sameiro', mode: 'foot', distance_m: 3100, duration_min: 45, note_ru: 'Лесная тропа вверх', pts: [[41.55494, -8.37703], [41.551, -8.3745], [41.5465, -8.3722], [41.54182, -8.36954]] },
        {
          from: 'sameiro', to: 'praca-republica', mode: 'taxi', distance_m: 7400, duration_min: 18, note_ru: 'Около 15 €',
          pts: [[41.54182, -8.36954], [41.544, -8.385], [41.547, -8.4], [41.5495, -8.415], [41.55131, -8.42297]],
        },
      ],
    },
    {
      id: 'bracara',
      name_ru: 'Римская Бракара',
      subtitle_ru: 'Заглушка: следы античного города',
      color: '#d98a6a',
      duration_ru: '1,5 часа',
      distance_km: 1.2,
      description_ru: 'Заглушка. Короткий маршрут по римским руинам.',
      stops: [
        { landmark_id: 'termas-romanas', time_ru: '15:00', stay_min: 30, note_ru: '' },
        { landmark_id: 'fonte-idolo', time_ru: '15:45', stay_min: 20, note_ru: '' },
        { landmark_id: 'se-braga', time_ru: '16:15', stay_min: 30, note_ru: '' },
      ],
      legs: [
        { from: 'termas-romanas', to: 'fonte-idolo', mode: 'foot', distance_m: 700, duration_min: 10, note_ru: '' },
        { from: 'fonte-idolo', to: 'se-braga', mode: 'foot', distance_m: 520, duration_min: 8, note_ru: '' },
      ],
    },
  ],
};

function ring(lat, lon, rLat, rLon, n = 24) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([lat + Math.sin(a) * rLat, lon + Math.cos(a) * rLon]);
  }
  return pts;
}

export const PLACEHOLDER_ROADS = {
  origin: { lat: 41.5503, lon: -8.42 },
  bbox: { s: 41.52, w: -8.455, n: 41.575, e: -8.36 },
  features: [
    { kind: 'primary', pts: [[41.5503, -8.455], [41.5510, -8.43], [41.5503, -8.42], [41.5520, -8.40], [41.5547, -8.3773]] },
    { kind: 'primary', pts: ring(41.5503, -8.42, 0.012, 0.016, 32) },
    { kind: 'secondary', pts: [[41.575, -8.425], [41.560, -8.422], [41.5503, -8.42], [41.535, -8.417], [41.52, -8.415]] },
    { kind: 'secondary', pts: [[41.5559, -8.4789], [41.553, -8.46], [41.5510, -8.43]] },
    { kind: 'minor', pts: [[41.548, -8.43], [41.548, -8.41]] },
    { kind: 'minor', pts: [[41.553, -8.43], [41.553, -8.41]] },
    { kind: 'minor', pts: [[41.545, -8.425], [41.557, -8.425]] },
    { kind: 'minor', pts: [[41.545, -8.415], [41.557, -8.415]] },
    { kind: 'water', pts: [[41.535, -8.455], [41.540, -8.44], [41.543, -8.425], [41.541, -8.40], [41.545, -8.37]] },
    { kind: 'rail', pts: [[41.548, -8.455], [41.5485, -8.44], [41.5495, -8.434]] },
  ],
};
