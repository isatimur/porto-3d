# porto-3d — план проекта

Отдельный проект `~/Dev/porto-3d`, свой репозиторий и проект Vercel. Тот же
движок, что у `braga-3d` (движок — источник правды) и `guimaraes-3d` (образец
одногородского форка), но данные, модели, тексты и характер города свои.

Создан из движка `braga-3d` (коммит `1784ff3`), сведён к одному городу по
рецепту `guimaraes-3d`: `cities/` содержит только `porto.json`, данные лежат
плоско в `data/`, город по умолчанию — `porto`.

## 0. Состояние на 2026-10-05

Проект живой: https://porto-3d.vercel.app. `npm run verify` проходит (11
проверок, включая `smoke console`). Статусы по задачам — в `feature_list.json`.

| Что | Где | Состояние |
|---|---|---|
| Движок | `src/`, `scripts/`, `api/` | форк braga-3d (`1784ff3`); брагские данные убраны, в `src/` остались только унаследованные комментарии |
| Конфиг города | `cities/porto.json` | ядро 41.12–41.19 × −8.68…−8.55, Дору и шесть мостов, `data_dir: "data"` |
| Модели | `src/models/porto/<id>.js` | 70 ручных билдеров, по одному на место; massing-запасного пути нет; 747 306 tris из 900 000 |
| Контент | `data/landmarks.json`, `src/locales/*` | 70 мест, RU/EN/PT полностью |
| Данные | `data/` | terrain, buildings, roads, nature, 469 тайлов, tiles-ms, traffic-axes, GTFS (STCP + Metro do Porto) |
| Маршруты и история | `data/routes.json`, `data/story.json` | 9 маршрутов, 18 глав |
| Живой город | `src/live.js`, `src/life.js`, `src/livebus.js` | трамваи, лодки rabelo, поезда, трафик |
| Производительность | `src/main.js` | адаптивный governor; far LOD у ландмарок в `src/landmarks.js` |
| Веб | `public/`, `api/` | sitemap на 71 URL, страницы `/p/<id>/` с JSON-LD, PWA, API guide/adsb/route |
| Деплой | Vercel `porto-3d` | работает на `porto-3d.vercel.app`; домен `porto-3d.com` пока не отвечает |

## 1. Конвейер данных

```
node scripts/city.mjs porto --dry-run     # план
node scripts/city.mjs porto               # 8 шагов, резюмируемый
node scripts/city.mjs porto --from tiles  # ночью: кольцевые тайлы (сетка 26×26, ~4× Браги)
node scripts/city.mjs porto --only ms-buildings
node scripts/check-geo.mjs --city porto
```

Порядок шагов в `scripts/city.mjs`: ms-buildings запускать после tiles.
Сырые ответы Overpass/OpenTopoData/Microsoft кэшируются в `data/.cache/`
(gitignored, в сборку не попадает).

## 2. Раунды

Раунды 2–4 выполнены (с большим размахом: 70 мест вместо 20, 9 маршрутов
вместо 3, 18 глав вместо 10). Раунд 5 выполнен частично: нет домена. Ниже —
исходный план, он нужен как контекст.

### Раунд 2 — данные и тексты (выполнен)
- **Тексты** 20 мест по методу Браги (RU native → EN/PT, источники, факты,
  совет, галерея, видео через oEmbed): агенты пишут `data/new/<id>.content.json`,
  `.en.json`, `.pt.json`, затем `node scripts/merge-landmarks.mjs --city porto`
  собирает `data/landmarks.json` и `src/locales/{en,pt}.porto.js`.
- **Контуры и размеры**: добавить таблицу Porto в `scripts/fetch-footprints.mjs`
  (`OVERRIDES_BY_CITY`) и `scripts/landmark-heights.mjs` (`HEIGHTS_BY_CITY`),
  затем `node scripts/fetch-footprints.mjs --city porto`; заполнить
  `data/dimensions.json` (проверка `check-dimensions.mjs`).
- **Маршруты**: три маршрута в `ROUTES_BY_CITY` (`scripts/fetch-routes.mjs`):
  «Рибейра и мосты», «Баиша и Клеригуш», «Дору и океан (Фош)»; OSRM.
- **История** `data/story.json`, 10 глав: Portus Cale → свевы и Суеби →
  епископская Porto → морская экспансия и Генрих Мореплаватель → мосты
  (Мария Пиа 1877, Луиш I 1886) → вино портвейн → Алиадуш и Республика →
  Саудаде → UNESCO 1996 → культурная столица 2001.
- **Оси трафика**: добавить `porto` в `AXES_BY_CITY` (`scripts/fetch-traffic-axes.mjs`).
- **GTFS**: фиды STCP и Metro do Porto (два), привести URL в `cities/porto.json`.
- **POI, life, streetscape**: по образцу Браги (`fetch-pois`, `fetch-funicular`).

### Раунд 3 — модели 1:1 (выполнен: 70 из 70)
Клеригуш, Сан-Бенту (азулежу), Болса, Лелло, Каза-да-Музика + мосты.
Авторинг в метрах на контурах OSM. `check-fit --city porto` держит два
правила: отклонение не более 15 % и никогда не меньше (модель не менее 97 %
от экстента OSM и от высоты в `dimensions.json`). Плюс `count-tris`. Каждый билдер — `src/models/porto/<id>.js`, spread в `DETAILED`
в `src/models.js`. Вода Дору и океан у Фош — по скиллу
`3d-ultra-realistic-water`.

### Раунд 4 — интеграция и характер (выполнен, кроме OG)
`CINEMA_ORDER` (70 записей в `src/tour.js`), живой город (фуникулёр Гуиндаиш,
трамваи, лодки, поезда), сезоны, страницы `/p/<id>/`, README. Остаток:
`node scripts/make-og.mjs --og` для 10 новых мест без картинки в `public/og/`.

### Раунд 5 — деплой (частично)
Сделано: `vercel link --project porto-3d`, деплой, проверка `/p/<id>/`, `/og/`,
`/api/adsb?city=porto` на `porto-3d.vercel.app`. Не сделано: домен
`porto-3d.com` (DNS и alias).

### Дальше
- Домен `porto-3d.com`.
- Первый запуск `scripts/sync-engine.sh` против актуального braga-3d (`porto-011`).
- Набережные стены Дору (`porto-013`).
- Геометрический LOD для зданий и тайлов (`porto-014`).

## 3. Чем Порту отличается от Браги
- Дору с шестью настоящими мостами (мосты/тоннели движок уже умеет) и океан.
- Вино портвейн: лоджии в Гайе, лодки-rabelo.
- Азулежу Сан-Бенту и Кармо, барокко Клеригуша, металл Каза-да-Музики.
- Двухуровневый Луиш I: проезд внизу и метро наверху.
- Трамвай 1 вдоль реки, фуникулёр Гуиндаиш, мост Аррабида.

## 4. Открытые хвосты
- Домен `porto-3d.com` не отвечает.
- 10 мест без OG-картинки: bessa, teatro-sa-da-bandeira,
  teatro-nacional-sao-joao, igreja-da-vitoria, igreja-carmelitas,
  casa-museu-marta-ortigao-sampaio, mercado-matosinhos, camara-matosinhos,
  farol-leca, paco-episcopal.
- Движок не синхронизирован с braga-3d с момента форка (`scripts/engine-base.txt` = `1784ff3`).
- Набережных стен и геометрического LOD зданий нет.
- Брагские упоминания остались только в комментариях движка.

## 5. Шпаргалка
```
npm run dev                        # http://localhost:5173 (город по умолчанию porto)
npm run build
node scripts/city.mjs porto --dry-run
node scripts/city.mjs porto --from tiles   # ночью, в фоне
node scripts/check-geo.mjs --city porto
node scripts/count-tris.mjs --city porto
```
