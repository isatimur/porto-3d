# porto-3d — план проекта

Отдельный проект `~/Dev/porto-3d`, свой репозиторий и проект Vercel. Тот же
движок, что у `braga-3d` (движок — источник правды) и `guimaraes-3d` (образец
одногородского форка), но данные, модели, тексты и характер города свои.

Создан из движка `braga-3d` (коммит `1784ff3`), сведён к одному городу по
рецепту `guimaraes-3d`: `cities/` содержит только `porto.json`, данные лежат
плоско в `data/`, город по умолчанию — `porto`.

## 0. Что уже сделано (скелет)

| Что | Где | Состояние |
|---|---|---|
| Движок | `src/`, `scripts/`, `api/` | скопирован из braga-3d, брагские билдеры/локали/страницы убраны |
| Конфиг города | `cities/porto.json` | 20 кандидатов, ядро 41.12–41.19 × −8.68…−8.55, Дору и шесть мостов, `data_dir: "data"` |
| Реестр моделей | `src/models.js`, `src/models/porto/block.js` | обобщённый massing-билдер для всех 20 id; детальные модели заменят его по одной |
| Локали | `src/locales/{en,pt}.porto.js` | пустые заглушки; заполнит `merge-landmarks.mjs` после агентов |
| Shell | `index.html`, `public/manifest.webmanifest`, `public/sw.js`, `package.json` | переписаны под Порту |
| Конвейер данных | `node scripts/city.mjs porto` | запущен: terrain → buildings → ms-buildings → roads → nature → tiles → traffic-axes → gtfs |
| Сборка | `npm run build` | проходит |

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

## 2. Следующие раунды

### Раунд 2 — данные и тексты (после конвейера)
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

### Раунд 3 — модели 1:1 (самые дорогие)
Клеригуш, Сан-Бенту (азулежу), Болса, Лелло, Каза-да-Музика + мосты.
Авторинг в метрах на контурах OSM, `check-fit --city porto` (не меньше 97%),
`count-tris`. Каждый билдер — `src/models/porto/<id>.js`, spread в `DETAILED`
в `src/models.js`. Вода Дору и океан у Фош — по скиллу
`3d-ultra-realistic-water`.

### Раунд 4 — интеграция и характер
`CINEMA_ORDER` (уже на 20 глав в `src/tour.js`), живой город (мосты, фуникулёр
Гуиндаиш, трамвай 1 вдоль Дору), сезоны, `make-og --city porto` (иконка-мост
вместо лестницы), страницы `/p/<id>/`, README.

### Раунд 5 — деплой
`vercel link --project porto-3d`, `vercel --prod --yes`, домен
`porto-3d.com`, проверка `/p/<id>/`, `/og/`, `/api/adsb?city=porto`.

## 3. Чем Порту отличается от Браги
- Дору с шестью настоящими мостами (мосты/тоннели движок уже умеет) и океан.
- Вино портвейн: лоджии в Гайе, лодки-rabelo.
- Азулежу Сан-Бенту и Кармо, барокко Клеригуша, металл Каза-да-Музики.
- Двухуровневый Луиш I: проезд внизу и метро наверху.
- Трамвай 1 вдоль реки, фуникулёр Гуиндаиш, мост Аррабида.

## 4. Открытые хвосты
- Пустые `src/locales/{en,pt}.porto.js` — до раунда 2 английский/португальский
  показывают русский текст-источник.
- `PLACEHOLDER_*` в `src/placeholder-data.js` всё ещё брагские, но для
  non-braga не используются (`src/data.js`, флаг `braga`).
- `src/search.js`, `src/life.js` содержат брагские id в весах/якорях — для
  Порту это no-op, заменить в раунде 4.
- `check-fit`/`count-tris` работают только после появления `footprints.json`
  и детальных моделей.

## 5. Шпаргалка
```
npm run dev                        # http://localhost:5173 (город по умолчанию porto)
npm run build
node scripts/city.mjs porto --dry-run
node scripts/city.mjs porto --from tiles   # ночью, в фоне
node scripts/check-geo.mjs --city porto
node scripts/count-tris.mjs --city porto
```
