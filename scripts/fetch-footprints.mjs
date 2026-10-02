// Fetch the real OSM footprint of every landmark and write data/footprints.json.
// Also adds an `osm` field to each landmark in data/landmarks.json.
// Node 22, no dependencies. Run: node scripts/fetch-footprints.mjs
//
// Partial run: node scripts/fetch-footprints.mjs --only=id1,id2
//   fetches only those landmarks, replaces only their keys in data/footprints.json
//   (the other entries are copied unchanged), does NOT write data/landmarks.json and
//   writes data/new/<id>.osm.json ({osm, lat, lon, model}) for a later merge instead.
//
// The OSM object for each landmark was picked by hand from an Overpass search
// (name / historic / place_of_worship / stadium / building within 300 m).
// The script re-checks each pick: the object must exist, carry the expected
// name, lie near the landmark coordinate, and (when tagged) its Wikidata item
// must point back to it (P402) or sit within 400 m of it (P625).
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { overpass, wait, toXY, toLL, r6, ringArea, centroid, minAreaRect, tagHeight, simplifyRing, CITY, dataPath, cachePath, dataRel, USER_AGENT } from './geo-lib.mjs';
import { loadLandmarks } from './city-lib.mjs';

// --city <id> picks the city (default braga). The landmark table below is per city.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LANDMARKS = CITY.landmarksPath;
const OUT = dataPath('footprints.json');

// ---------------------------------------------------------------------------
// Curated configuration.
//  main      OSM key of the principal object (outline, bearing, extent).
//  name      regex the main object's name must match (sanity check).
//  site      how parts are collected: {buffer} = main outline grown by N m,
//            {area:key, buffer} = a separate site polygon, {radius} = circle.
//  cats      part categories to collect inside the site.
//  include   extra OSM keys always added as parts; exclude: keys never added.
//  height    fallback / override {m, source, note, force}. `force` is used only
//            where the OSM tag is clearly wrong for the real building.
//  fetchR    Overpass candidate radius in metres (default 300); for large sites.
//  exclude_outline  false = open site: buildings.json keeps ordinary buildings under
//            the outline (default: false only for the squares, gardens and the avenue).
//  as        {key: {tag, h, name}}: give an untagged part a tag, height and name.
//  paths     true = add the footways inside the site as 'path' parts.
//  holes     true = relation parts keep their inner rings as `holes` (courtyards).
//  synth     [{id, from, nodes, tag, name}]: a part cut from OSM way `from` along its own
//            nodes (listed in way order); for a building mapped only as a larger plot.
//            With `outline: true` it also becomes the landmark outline (bearing, extent).
//  ms        {minArea, h, name}: add the Microsoft ML building footprints
//            (data/.cache/ms-raw/bbox.json, see fetch-ms-buildings.mjs) whose centre is
//            inside the site and whose area is >= minArea m², for blocks OSM does not map.
//  model     proposed model type, written to data/new/<id>.osm.json by --only runs.
//  at        [lat, lon] of the landmark for a city whose landmarks.json does not exist yet
//            (the list then comes from cities/<id>.json landmark_candidates).
//  area      true = the main object is a closed way that OSM tags as a barrier (a castle wall
//            ring): read it as an area anyway.
//  hull      true = the outline is the convex hull of every ring of the main object (a
//            multipolygon of scattered tanks), not its largest ring.
//  gateTag   part tag of the synthesized rectangle in gateWall mode (default 'gate').
//  aerialway OSM way key of a cable car: the way becomes a 'cable' line part and its
//            aerialway=pylon nodes become 'pylon' point parts (with 'cable' in cats).
// ---------------------------------------------------------------------------
// Braga's landmark table (the ids are Braga landmarks). Other cities: add an entry to
// OVERRIDES_BY_CITY below; with none, this script has no landmark configuration to apply.
const BRAGA_CFG = {
  'bom-jesus': {
    main: 'w146373021', name: /Bom Jesus/, site: { area: 'w1539525894', buffer: 5 },
    cats: ['building', 'stairs', 'funicular', 'water', 'square'],
    // All funicular track ways (the lower half leaves the sanctuary area) + the entrance portico.
    include: ['w26307689', 'w1386644706', 'w772942622', 'w1386644707', 'w772942621', 'w1386644708', 'w1386644709', 'w1386644710', 'w824194596', 'w1539539849'],
  },
  sameiro: {
    main: 'w146227475', name: /Sameiro/, site: { radius: 130 },
    cats: ['building', 'stairs'],
  },
  'se-braga': {
    main: 'w22746378', name: /Sé Catedral/, site: { buffer: 2 },
    cats: ['building', 'garden'],
    // Chapels and the cloister garden of the cathedral complex.
    include: ['w953084301', 'w953084306', 'w1363722399', 'w953084304', 'w953084305', 'w953084310', 'w167197846'],
    // Igreja da Misericórdia touches the Sé but is a separate church.
    exclude: ['w160362963', 'w953084302'],
  },
  'arco-porta-nova': {
    // The gate is an OSM node; its barrier=wall way gives the line across Rua D. Diogo de Sousa.
    main: 'n243891111', name: /Porta Nova/, gateWall: 'w824236466', site: { radius: 1 },
    cats: [], include: ['w815656316'],
  },
  'santa-barbara': {
    main: 'w22745314', name: /Santa Bárbara/, site: { buffer: 3 },
    cats: ['water', 'ruins', 'monument'],
    include: ['w1408446166', 'w1411157146', 'r20123877', 'n1724210420'],
  },
  'praca-republica': {
    main: 'r14626258', name: /Praça da República/, site: { buffer: 2 },
    cats: ['water'], include: ['w132951673', 'w167193931'],
  },
  'theatro-circo': { main: 'w108153358', name: /Theatro Circo/, site: { buffer: 0 }, cats: [] },
  'palacio-raio': { main: 'w269246992', name: /Raio/, site: { buffer: 0 }, cats: [] },
  'torre-menagem': {
    main: 'w828265603', name: /Torre de Menagem/, site: { buffer: 0 }, cats: [], include: ['r17830717'],
  },
  'santa-cruz': { main: 'w121590141', name: /Santa Cruz/, site: { buffer: 0 }, cats: [] },
  'estadio-braga': {
    main: 'w116650252', name: /Estádio Municipal de Braga/, site: { buffer: 0 }, cats: ['pitch'],
    // bearing/extent come from the whole stadium outline (pitch + both stands, 238 m across the
    // pitch). The pitch's own long axis is perpendicular to that; it is written as pitch_bearing_deg.
    include: ['w166248899'], stands: 'r17396393', pitch: 'w166248899',
  },
  'termas-romanas': {
    main: 'r11244034', name: /Termas Romanas/, site: { buffer: 25 },
    // Toilets block and the separate Teatro Romano site (own Wikidata item Q10378913) are left out.
    cats: ['ruins', 'building'], exclude: ['w819854795', 'w170679509'],
  },
  'fonte-idolo': { main: 'w146343020', name: /Fonte do Ídolo/, site: { buffer: 0 }, cats: [] },
  tibaes: {
    main: 'r2271296', name: /Tibães/, site: { buffer: 40 },
    cats: ['building', 'church', 'garden', 'water'], include: ['w170604958'],
    exclude: ['w161754617'],
  },
  biscainhos: {
    main: 'r13337528', name: /Biscainhos/, site: { buffer: 0 }, cats: [], include: ['r20033289'],
  },
  'avenida-central': {
    main: 'w134654858', name: /Avenida Central/, site: { buffer: 8 },
    cats: ['water', 'monument', 'building'],
    include: ['w108153350'], streets: /^Avenida (Central|da Liberdade)$/,
  },
  // --- added 2026-09-29 ---
  populo: {
    // Main = the church. The convent wing w149489952 is the other outer of the convent
    // relation r13337530; Biscainhos, the Patronato and the Convento do Salvador touch the site.
    main: 'w109149780', name: /Pópulo/, site: { buffer: 3 },
    cats: ['building', 'water'], include: ['w149489952', 'n13347111330'],
    exclude: ['r13337528', 'r13337529', 'r13337531', 'w993581849'],
    // Untagged outer of r13337530: the three-storey convent wing (now council offices), ~14 m.
    as: { w149489952: { tag: 'building', h: 14, name: 'Convento do Pópulo' } },
  },
  'ucp-braga': {
    // Main = the Faculdade de Filosofia building on Praça da Faculdade (with the Jesuit church
    // of the Sagrado Coração on its front). Parts: every building of Campus Camões (area w107495353).
    main: 'w423244424', name: /Universidade Católica/, site: { area: 'w107495353', buffer: 0 }, paths: true,
    cats: ['building', 'pitch', 'garden', 'water'], include: ['w118358119', 'w107495353', 'w660855628'],
  },
  'estadio-1-maio': {
    // OSM has no stand buildings: the stands are the ring between the stadium outline and the track.
    main: 'w22660087', name: /1º de Maio/, site: { buffer: 0 }, cats: ['pitch', 'building'],
    include: ['w22660434', 'r2215785'], pitch: 'w22660434',
  },
  'parque-ponte': {
    // The whole park relation; parts: chapel, lake, pavilions, bandstand, amphitheatre, footpaths
    // and the Rio Este river area on its north edge. Forum and stadium are separate landmarks.
    main: 'r19915700', name: /Parque da Ponte/, site: { buffer: 0 }, paths: true,
    cats: ['building', 'church', 'water', 'garden', 'monument', 'pitch'],
    include: ['w1190012855', 'w1190016746', 'r19915859'],
    exclude: ['r19915703', 'w22660087', 'w22660434'],
  },
  'forum-braga': {
    // OSM still names the building relation "Altice Forum" (the 2018-2024 name).
    main: 'r19915703', name: /Forum/, site: { buffer: 0 }, cats: ['building'],
    include: ['w591643569', 'w1373821120'],
    exclude: ['r19915700', 'w22660087'],
  },
  // --- added 2026-09-29 (second batch) ---
  'uminho-gualtar': {
    // Main = the campus area (amenity=university). Parts: every building, pitch, garden and footpath
    // inside it. The campus is ~815 x 763 m, so candidates are fetched within 650 m.
    main: 'w165563981', name: /Campus de Gualtar/, site: { buffer: 0 }, fetchR: 650, paths: true,
    cats: ['building', 'pitch', 'garden', 'square', 'water', 'monument'], include: ['n698815548'],
    as: { n698815548: { tag: 'monument', h: 4, name: 'Prometeu (José Rodrigues, 1992)' } },
    exclude_outline: false, model: 'university',
  },
  'dmaria-ii': {
    // Main = the school site (amenity=school). OSM maps only the north-west wing (w473728998);
    // the two other blocks of the school exist only in the Microsoft ML footprints (`ms`).
    main: 'w21372352', name: /Dona Maria II/, site: { buffer: 0 }, paths: true,
    cats: ['building', 'pitch', 'garden'], exclude_outline: false, model: 'school',
    ms: { minArea: 1000, h: 12, name: 'School block (Microsoft ML footprint)' },
  },
  'sao-frutuoso': {
    // Main = the Visigothic chapel. Site = the religious precinct w1329661274 with the church of
    // São Jerónimo de Real (the former Franciscan church) and the Convento de São Francisco.
    main: 'w159104082', name: /São Frutuoso/, site: { area: 'w1329661274', buffer: 0 },
    cats: ['building', 'church', 'garden'], include: ['w1329661274', 'w131049722', 'w159104084'], model: 'visigothic',
  },
  'diogo-sousa': {
    // Main = the museum site (tourism=museum area): exhibition building, wings and gardens.
    main: 'w104691209', name: /Diogo de Sousa/, site: { buffer: 0 },
    cats: ['building', 'garden', 'monument'], exclude_outline: false, model: 'museum-roman',
  },
  coimbras: {
    // Main = the chapel (Capela de Nossa Senhora da Conceição); the Casa dos Coimbras shares its
    // Wikidata item. The crenellated tower w1343853590 and the small annex w1343853591 stand at
    // the chapel's south-west end.
    main: 'w223138080', name: /Conceição/, site: { buffer: 0 }, cats: [],
    include: ['w146342996', 'w1343853590', 'w1343853591'], model: 'chapel-manueline',
  },
  congregados: {
    // Main = the basilica; the convent / college is the UMinho area w121590125 beside it.
    main: 'w121590117', name: /Congregados/, site: { buffer: 2 }, cats: ['building'], include: ['w121590125'],
    as: { w121590125: { tag: 'building', h: 14, name: 'Convento dos Congregados' } }, model: 'basilica-twin',
  },
  'nogueira-silva': {
    // OSM tags the whole plot (house + garden) as one building=yes way; the garden w952323813 is a
    // separate way inside it. The house is the plot south of the garden's south edge (nodes
    // 8814524693-8814524694): synthesized from the plot's own nodes and used as the outline.
    // The plot itself becomes a flat 'site' part.
    main: 'w219034582', name: /Nogueira da Silva/, site: { buffer: 0 }, cats: ['garden', 'building', 'water', 'monument'],
    synth: [{ id: 'synth:nogueira-house', from: 'w219034582', nodes: [8814524693, 2076021399, 2076025358, 8814524694], tag: 'building', name: 'Casa Nogueira da Silva', outline: true }],
    as: { w219034582: { tag: 'site', h: 0, name: 'Museu Nogueira da Silva (plot)' } }, model: 'house-museum',
  },
  'sao-marcos': {
    // Main = the church; parts: the former hospital block, now the Vila Galé hotel (r17978905,
    // with its courtyard as a hole) and the later hospital wings to the south (r8340055, w146343003).
    main: 'w363528976', name: /São Marcos/, site: { buffer: 2 }, cats: ['building'], holes: true,
    include: ['r8340055', 'w146343003', 'r17978905'], model: 'hospital-church',
  },
};
// Guimarães (2026-09-30). Objects picked from Overpass name searches in the wide bbox and a
// per-site scan of buildings, historic, leisure, aerialway and city_wall objects; each main
// object carries the expected name and (where tagged) the Wikidata item of the landmark.
const GUIMARAES_CFG = {
  castelo: {
    // Main = the castle wall ring (barrier=wall, historic=castle; read as an area). Parts: the
    // keep w346365691 (height=27 in OSM) and the seven wall towers w807304448-454 (layer=1).
    main: 'w346365692', name: /Castelo de Guimarães/, at: [41.44791, -8.29045], area: true, site: { buffer: 5 },
    cats: ['tower', 'building'], exclude: ['w104203858', 'w32501063'], model: 'castle',
    // The ring itself is the crenellated curtain wall: a closed 'wall' part (its height from HEIGHTS main_m).
    as: { w346365692: { tag: 'wall', h: 12, name: 'Muralha do Castelo' } },
  },
  'paco-duques': {
    // Main = the palace multipolygon; the inner ring is the central courtyard (kept as a hole).
    main: 'r2433235', name: /Paço dos Duques/, at: [41.44646, -8.29101], site: { buffer: 0 }, cats: [], holes: true,
    exclude: ['w32501063'], model: 'ducal-palace',
  },
  'sao-miguel-castelo': {
    main: 'w104203858', name: /São Miguel do Castelo/, at: [41.44726, -8.29099], site: { buffer: 0 }, cats: [],
    exclude: ['w32501063'], model: 'chapel-romanesque',
  },
  oliveira: {
    // Main = the collegiate church. Parts: the Padrão do Salado (building=yes + historic=monument in
    // OSM, re-tagged 'monument') and the Largo da Oliveira. The Museu de Alberto Sampaio is its own landmark.
    main: 'w167517737', name: /Oliveira/, at: [41.44293, -8.29246], site: { buffer: 3 },
    cats: ['monument', 'square', 'water'], include: ['w820481033', 'w167517738'],
    exclude: ['w255483376', 'w255486350', 'n10147700362'],
    as: { w820481033: { tag: 'monument', h: 9, name: 'Padrão do Salado' } }, model: 'church',
  },
  'sao-tiago': {
    // Main = the square (place=square, pedestrian area). Parts: the 3-4 storey houses that front it
    // (addr:street "Praça de São Tiago" in OSM) so the model has the real enclosure.
    main: 'w32501267', name: /São Tiago/, at: [41.44337, -8.29318], site: { buffer: 0 }, cats: ['water'],
    include: ['w473881520', 'w473881521', 'w473881522', 'w473881523', 'w473881524', 'w473881525', 'w473881526', 'w473881527',
      'w473881528', 'w473881529', 'w473881530', 'w473881531', 'w473881532', 'w1427926768'],
    exclude: ['w167517738'], exclude_outline: false, model: 'plaza',
  },
  toural: {
    // Main = the square way with the Wikidata item (w1463370179 is the pedestrian surface of the same
    // square, left out). Parts: the Chafariz do Toural and the Igreja de São Pedro on its north-west side.
    main: 'w591247671', name: /Toural/, at: [41.44173, -8.29561], site: { buffer: 2 }, cats: ['water'],
    include: ['w591247672', 'w254317701'], exclude: ['w1463370179', 'w134126321', 'w255483374'],
    as: { w591247672: { tag: 'water', h: 6, name: 'Chafariz do Toural' } }, exclude_outline: false, model: 'plaza',
  },
  penha: {
    // Main = the sanctuary church. Site = the Penha park w565428859 (boulders, chapels, hotel, gardens,
    // footpaths). The Teleférico de Guimarães is a 'cable' line with its pylons and both stations.
    main: 'w342339768', name: /Penha/, at: [41.43180, -8.26985], site: { area: 'w565428859', buffer: 10 }, fetchR: 450, paths: true,
    cats: ['building', 'church', 'garden', 'water', 'monument', 'cable'], aerialway: 'w104203846',
    include: ['w104203846', 'w104203786', 'w104203806', 'w565428859'],
    as: { w565428859: { tag: 'garden', h: 0, name: 'Parque da Penha' } }, model: 'cable-car',
  },
  'santos-passos': {
    // Main = the church; the Largo de São Gualter garden lies on its axis in front of the stairs.
    main: 'w166138931', name: /Santos Passos/, at: [41.44086, -8.28970], site: { buffer: 2 }, cats: ['garden'],
    include: ['w451046703'], model: 'basilica-twin',
  },
  'sao-francisco': {
    // Church + convent multipolygon; the two inner rings are the cloister and a light well (holes).
    main: 'r2836771', name: /São Francisco/, at: [41.44062, -8.29233], site: { buffer: 0 }, cats: [], holes: true, model: 'convent',
  },
  'alberto-sampaio': {
    // The museum occupies the cloister and chapter house of the collegiate church, north of it.
    main: 'w255483376', name: /Alberto Sampaio/, at: [41.44290, -8.29228], site: { buffer: 0 }, cats: [],
    exclude: ['w167517737', 'w255486350'], model: 'museum',
  },
  muralha: {
    // Main = the "Muralhas de Guimarães" site relation (two wall ways). The outline is a synthesized
    // 20 x 8 m rectangle on the 12.5 m wall stub w255483374 at the Torre da Alfândega (node
    // n12200073501, "Aqui nasceu Portugal"); the 270 m stretch w150780884 along Avenida Alberto
    // Sampaio is a 'wall' line part.
    main: 'r19901679', name: /Muralhas de Guimarães/, at: [41.44135, -8.29505], gateWall: 'w255483374', gateTag: 'tower',
    site: { radius: 1 }, cats: [], include: ['w150780884', 'w255483374'], model: 'city-wall',
  },
  'plataforma-artes': {
    // Main = the CIAJG museum block (the OSM name is the museum, Q85124666). Parts: the raised
    // square w171548441 (layer=1) and the two bar buildings of the creative labs / workshops.
    main: 'w454870532', name: /José de Guimarães/, at: [41.44300, -8.29765], site: { buffer: 3 }, cats: ['square'],
    include: ['w171548441', 'w454870535', 'w664204282'],
    as: {
      w171548441: { tag: 'square', h: 0, name: 'Plataforma das Artes e da Criatividade' },
      w454870535: { tag: 'building', h: 12, name: 'Laboratórios Criativos (Plataforma das Artes)' },
      w664204282: { tag: 'building', h: 12, name: 'Oficinas Emergentes (Plataforma das Artes)' },
    }, model: 'arts-platform',
  },
  couros: {
    // Main = the "Zona de Couros" tannery multipolygon: seven groups of granite tanks along the
    // Ribeira de Couros. Outline = their convex hull; each ring is a 1.2 m 'ruins' part.
    main: 'r19769884', name: /Couros/, at: [41.43986, -8.29316], hull: true, site: { buffer: 0 }, cats: [],
    include: ['w820481034'],
    as: { r19769884: { tag: 'ruins', h: 1.2, name: 'Tanques de Couros' }, w820481034: { tag: 'water', h: 1, name: 'Lavadouro de Couros' } },
    exclude_outline: false, model: 'tannery',
  },
  'santa-marinha': {
    // Main = the monastery / pousada block; site = its garden w220350965 with the church of Santa
    // Marinha and the pools. Houses and garages of the neighbours inside the garden edge are left out.
    main: 'w230976313', name: /Santa Marinha/, at: [41.44295, -8.27660], site: { area: 'w220350965', buffer: 3 },
    cats: ['building', 'church', 'garden', 'water'], include: ['w257159145', 'w220350965'],
    exclude: ['w257162810', 'w1289681072', 'w1289681073', 'w257164636', 'w1289681070', 'w257164641', 'w230976315', 'w257164642'],
    as: { w220350965: { tag: 'garden', h: 0, name: 'Jardim da Pousada de Santa Marinha' } }, model: 'monastery',
  },
  'estadio-afonso-henriques': {
    // Main = the leisure=stadium way (Q1057274). Parts: the 14 grandstand ways (four stands in two
    // tiers) and the pitch. r2835546 (building=stadium) is the same outline and is left out.
    main: 'w211693383', name: /Afonso Henriques/, at: [41.44589, -8.30099], site: { buffer: 0 }, cats: ['stand', 'pitch'],
    include: ['w189966626'], exclude: ['r2835546'], pitch: 'w189966626', model: 'stadium',
  },
  'uminho-azurem': {
    // Main = the campus area (amenity=university). Parts: every building, pitch, garden and footpath inside it.
    main: 'w182091438', name: /Azurém/, at: [41.45264, -8.28991], site: { buffer: 0 }, fetchR: 450, paths: true,
    cats: ['building', 'pitch', 'garden', 'water'], exclude_outline: false, model: 'university',
  },
  briteiros: {
    // Main = the protected archaeological site (Q1094262). Parts: the mapped rampart lines
    // (barrier=city_wall), the reconstructed round houses and the chapel of São Romão on the summit.
    main: 'w184819483', name: /Briteiros/, at: [41.52813, -8.31639], site: { buffer: 0 }, fetchR: 400,
    cats: ['wall', 'building', 'church', 'ruins'], exclude_outline: false, model: 'citania',
    include: ['w448104412', 'w176845321', 'w448104413', 'w448106887', 'w1430010225', 'w1430010398', 'w527213977', 'w527213978', 'w527213979', 'w527217517'],
  },
  'vila-flor': {
    // Main = the 18th-c. palace. Parts: the 2005 Grande and Pequeno Auditório, the garden, its
    // fountain and the arts-centre site polygon (flat).
    main: 'w130533853', name: /Vila Flor/, at: [41.43732, -8.29505], site: { buffer: 0 }, cats: [],
    include: ['w130533849', 'w130533855', 'w339820300', 'w340095744', 'w130533846'],
    as: { w130533846: { tag: 'site', h: 0, name: 'Centro Cultural Vila Flor (site)' } }, model: 'palace',
  },
};
const OVERRIDES_BY_CITY = { braga: BRAGA_CFG, guimaraes: GUIMARAES_CFG };
const CFG = OVERRIDES_BY_CITY[CITY.id] || {};

// Verified or estimated heights, used when OSM has no height / levels tag (or force).
// Filled from research; each has a source.
import { HEIGHTS } from './landmark-heights.mjs';

// ---------------------------------------------------------------------------
// The landmark list: landmarks.json, or (before the landmark agents merge it) the city's
// landmark_candidates placed by cfg.at. Candidates without a config are dropped with a message.
const HAVE_LANDMARKS_FILE = existsSync(LANDMARKS);
let landmarks = loadLandmarks({ withPos: false });
if (!HAVE_LANDMARKS_FILE) {
  const dropped = landmarks.filter(l => !CFG[l.id]).map(l => l.id);
  if (dropped.length) console.warn(`${CITY.id}: no landmarks.json yet; candidates without a config are skipped: ${dropped.join(', ')}`);
  landmarks = landmarks.filter(l => CFG[l.id]).map(l => ({ ...l, lat: l.lat ?? CFG[l.id].at?.[0], lon: l.lon ?? CFG[l.id].at?.[1] }));
  const noPos = landmarks.filter(l => !Number.isFinite(l.lat) || !Number.isFinite(l.lon)).map(l => l.id);
  if (noPos.length) throw new Error(`No position (cfg.at) for: ${noPos.join(', ')}`);
}
const missingCfg = landmarks.filter(l => !CFG[l.id]).map(l => l.id);
if (missingCfg.length) throw new Error(`No config for: ${missingCfg.join(', ')} (city ${CITY.id}: add the landmarks to OVERRIDES_BY_CITY in scripts/fetch-footprints.mjs)`);
const onlyArg = process.argv.slice(2).find(a => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice(7).split(',').filter(Boolean) : null;
if (ONLY) {
  const unknown = ONLY.filter(id => !landmarks.some(l => l.id === id));
  if (unknown.length) throw new Error(`--only: unknown landmark ids ${unknown.join(', ')}`);
}
// The landmarks this run builds (all, or the --only subset).
const todo = ONLY ? landmarks.filter(l => ONLY.includes(l.id)) : landmarks;
const MS_RAW = cachePath('ms-raw', 'bbox.json');
let msRaw = null;
const msPolys = () => {
  if (!msRaw) {
    if (!existsSync(MS_RAW)) throw new Error(`${MS_RAW} missing: run node scripts/fetch-ms-buildings.mjs --fetch first`);
    msRaw = JSON.parse(readFileSync(MS_RAW, 'utf8')).polys;
  }
  return msRaw;
};

const keyOf = el => el.type[0] + el.id;
const parseKey = k => ({ type: { w: 'way', r: 'relation', n: 'node' }[k[0]], id: Number(k.slice(1)) });
const dist = (a, b) => { const p = toXY(a), q = toXY(b); return Math.hypot(p[0] - q[0], p[1] - q[1]); };

// ---- 1. Download: all explicit objects + all candidate parts around each landmark ----
const explicit = new Set();
for (const l of todo) {
  const c = CFG[l.id];
  [c.main, c.site.area, c.gateWall, c.stands, c.aerialway, ...(c.include || []), ...(c.synth || []).map(s => s.from)].filter(Boolean).forEach(k => explicit.add(k));
}
const byType = { n: [], w: [], r: [] };
for (const k of explicit) byType[k[0]].push(k.slice(1));
let q = '[out:json][timeout:180];(';
if (byType.n.length) q += `node(id:${byType.n.join(',')});`;
if (byType.w.length) q += `way(id:${byType.w.join(',')});`;
if (byType.r.length) q += `relation(id:${byType.r.join(',')});`;
// Cable cars: the pylon nodes of the aerialway way (tagged nodes, fetched with the way).
for (const l of todo) if (CFG[l.id].aerialway) q += `way(${CFG[l.id].aerialway.slice(1)});node(w)["aerialway"];`;
for (const l of todo) {
  const R = CFG[l.id].fetchR || (CFG[l.id].site.radius ? CFG[l.id].site.radius + 50 : l.id === 'bom-jesus' ? 700 : l.id === 'avenida-central' ? 700 : 300);
  const a = `around:${R},${l.lat},${l.lon}`;
  q += `wr(${a})["building"];way(${a})["highway"="steps"];way(${a})["highway"="footway"]["name"~"Escad"];`;
  q += `way(${a})["railway"="funicular"];wr(${a})["leisure"~"garden|pitch|park"];wr(${a})["natural"="water"];`;
  q += `nwr(${a})["amenity"="fountain"];wr(${a})["place"="square"];nwr(${a})["historic"];`;
  if (CFG[l.id].streets) q += `way(${a})["highway"]["name"~"${CFG[l.id].streets.source}"];`;
  if (CFG[l.id].paths) q += `way(${a})["highway"~"^(footway|path|pedestrian)$"];`;
  if (CFG[l.id].cats.includes('wall')) q += `way(${a})["barrier"="city_wall"];`;
  if (CFG[l.id].cats.includes('cable')) q += `nwr(${a})["aerialway"];`;
}
q += ');out geom;';
const elements = await overpass(q, { label: 'footprints' });
const els = new Map(elements.map(e => [keyOf(e), e]));
console.log(`Overpass: ${els.size} unique elements`);

// ---- 2. Geometry helpers ----
function joinRings(ways) {
  const rings = [], open = ways.map(w => w.slice());
  while (open.length) {
    let cur = open.shift(), guard = 0;
    while ((cur[0][0] !== cur.at(-1)[0] || cur[0][1] !== cur.at(-1)[1]) && guard++ < 1000) {
      const end = cur.at(-1);
      const k = open.findIndex(o => (o[0][0] === end[0] && o[0][1] === end[1]) || (o.at(-1)[0] === end[0] && o.at(-1)[1] === end[1]));
      if (k < 0) break;
      const nxt = open.splice(k, 1)[0];
      cur = cur.concat(nxt[0][0] === end[0] && nxt[0][1] === end[1] ? nxt.slice(1) : nxt.reverse().slice(1));
    }
    rings.push(cur);
  }
  return rings;
}
const isClosed = p => p.length >= 4 && p[0][0] === p.at(-1)[0] && p[0][1] === p.at(-1)[1];
// cfg.area: closed barrier ways read as areas (a castle wall ring).
const AREA_KEYS = new Set(Object.values(CFG).filter(c => c.area).map(c => c.main));
// Returns {rings:[closed rings], lines:[open lines], point}
function geomOf(el) {
  if (el.type === 'node') return { rings: [], lines: [], point: [el.lat, el.lon] };
  if (el.type === 'way') {
    const p = (el.geometry || []).map(g => [g.lat, g.lon]);
    const area = isClosed(p) && (AREA_KEYS.has(keyOf(el)) ||
      (!(el.tags?.highway && !el.tags?.area && el.tags.highway !== 'pedestrian') && !el.tags?.barrier && !el.tags?.railway && !(el.tags?.aerialway && !el.tags?.building)));
    return area ? { rings: [p], lines: [] } : { rings: [], lines: [p] };
  }
  const outers = (el.members || []).filter(m => m.type === 'way' && m.role !== 'inner' && m.geometry?.length >= 2)
    .map(m => m.geometry.map(g => [g.lat, g.lon]));
  const joined = joinRings(outers);
  const inners = joinRings((el.members || []).filter(m => m.type === 'way' && m.role === 'inner' && m.geometry?.length >= 2)
    .map(m => m.geometry.map(g => [g.lat, g.lon]))).filter(isClosed);
  return { rings: joined.filter(isClosed), lines: joined.filter(r => !isClosed(r)), inners };
}
const allPts = g => [...g.rings.flat(), ...g.lines.flat(), ...(g.point ? [g.point] : [])];
const center = g => (g.rings.length ? centroid(g.rings.reduce((a, b) => (Math.abs(ringArea(b)) > Math.abs(ringArea(a)) ? b : a))) :
  g.point ? g.point : (() => { const p = allPts(g); return [p.reduce((s, x) => s + x[0], 0) / p.length, p.reduce((s, x) => s + x[1], 0) / p.length]; })());

function pointInPoly([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function distToPoly(pxy, poly) {
  let m = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    let t = l2 ? ((pxy[0] - a[0]) * dx + (pxy[1] - a[1]) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    m = Math.min(m, Math.hypot(pxy[0] - a[0] - t * dx, pxy[1] - a[1] - t * dy));
  }
  return m;
}
// Is geometry g inside any of the site polygons grown by buffer (by its centre point)?
function inSite(g, sitePolys, buffer) {
  const c = toXY(center(g));
  return sitePolys.some(p => pointInPoly(c, p) || distToPoly(c, p) <= buffer);
}

// Convex hull of [lat,lon] points (Andrew's monotone chain), for cfg.hull outlines.
function hullLL(pts) {
  const p = pts.map(q => [...toXY(q), q]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return pts.slice();
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); }
  const h = lo.slice(0, -1).concat(up.slice(0, -1)).map(q => q[2]);
  return h.concat([h[0]]);
}

function categoryOf(t = {}) {
  if (t.railway === 'funicular') return 'funicular';
  if (/^(gondola|cable_car|chair_lift|mixed_lift)$/.test(t.aerialway || '')) return 'cable';
  if (t.aerialway === 'pylon') return 'pylon';
  if (t.barrier === 'city_wall' || t.historic === 'citywalls') return 'wall';
  if (t.building === 'no') { t = { ...t }; delete t.building; }
  if (t.highway === 'steps' || (t.highway === 'footway' && /Escad/.test(t.name || ''))) return 'stairs';
  if (t.building === 'stadium' || t.building === 'grandstand') return 'stand';
  if (t.leisure === 'pitch') return 'pitch';
  if (t.leisure === 'stadium') return 'site';
  if (t.man_made === 'tower' || t.building === 'tower') return 'tower';
  if (t.historic === 'city_gate') return 'gate';
  if (/church|chapel|cathedral|basilica|religious/.test(t.building || '') || t.amenity === 'place_of_worship') return 'church';
  if (t.historic === 'ruins' || t.historic === 'archaeological_site') return 'ruins';
  if (t.building) return 'building';
  if (t.amenity === 'fountain' || t.natural === 'water') return 'water';
  if (t.leisure === 'garden' || t.leisure === 'park') return 'garden';
  if (t.place === 'square') return 'square';
  if (t.historic === 'memorial' || t.historic === 'monument' || t.historic === 'wayside_cross') return 'monument';
  if (t.highway) return 'street';
  return 'other';
}
const catMatches = (cat, cats) => cats.includes(cat) || (cats.includes('building') && ['church', 'tower', 'stand'].includes(cat));

// Default part heights when OSM has no height tag (stated estimates).
const PART_DEFAULT = { church: 10, building: 7, tower: 15, stand: 25, gate: 10, ruins: 1.5, monument: 4, water: 1.5, wall: 8, pylon: 12 };
function partHeight(t, cat) {
  if (Number(t.layer) < 0 || t.location === 'underground') return { h: 0, src: 'underground' };
  const th = tagHeight(t);
  if (th) return { h: th.h, src: th.src };
  if (cat === 'church' && /chapel/.test(t.building || '')) return { h: 6, src: 'estimate' };
  if (t.building === 'roof') return { h: 4, src: 'estimate' };
  if (PART_DEFAULT[cat] != null) return { h: PART_DEFAULT[cat], src: 'estimate' };
  return { h: 0, src: 'flat' };
}

const round = pts => pts.map(([a, b]) => [r6(a), r6(b)]);
const ringOut = r => { const p = r.slice(); if (isClosed(p)) p.pop(); return round(p); };

// Rectangle outline around a gate line: long side along the wall, depth `d` metres.
function rectAroundLine(line, width, depth) {
  const a = toXY(line[0]), b = toXY(line.at(-1));
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const u = [Math.cos(ang), Math.sin(ang)], v = [-u[1], u[0]];
  const hw = width / 2, hd = depth / 2;
  return [[hw, hd], [-hw, hd], [-hw, -hd], [hw, -hd]].map(([s, t]) => toLL([c[0] + u[0] * s + v[0] * t, c[1] + u[1] * s + v[1] * t]));
}

// ---- 3. Wikidata verification ----
async function checkWikidata(qid, key, near) {
  try {
    const r = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, { headers: { 'User-Agent': USER_AGENT } });
    if (!r.ok) return `wikidata ${qid}: HTTP ${r.status}`;
    const ents = (await r.json()).entities;
    const e = ents[qid] || Object.values(ents)[0];
    const claim = p => e.claims?.[p]?.[0]?.mainsnak?.datavalue?.value;
    const p402 = claim('P402');
    const label = e.labels?.pt?.value || e.labels?.en?.value;
    const notes = [`${qid} "${label}"`];
    if (p402) notes.push(key[0] === 'r' && String(p402) === key.slice(1) ? 'P402 matches' : `P402=${p402} (differs)`);
    const c = claim('P625');
    if (c) notes.push(`P625 ${Math.round(dist([c.latitude, c.longitude], near))} m away`);
    return notes.join(', ');
  } catch (err) {
    return `wikidata ${qid}: ${err.message}`;
  }
}

// ---- 4. Build each landmark ----
const out = {};
const report = [];
for (const l of todo) {
  const cfg = CFG[l.id];
  const main = els.get(cfg.main);
  if (!main) throw new Error(`${l.id}: main object ${cfg.main} not returned by Overpass`);
  const mt = main.tags || {};
  if (!cfg.name.test(mt.name || '')) throw new Error(`${l.id}: ${cfg.main} name "${mt.name}" does not match ${cfg.name}`);

  // Outline of the main object.
  let mg = geomOf(main);
  let outline;
  if (cfg.gateWall) {
    const wall = geomOf(els.get(cfg.gateWall)).lines[0];
    const h = HEIGHTS[l.id] || {};
    const wallLen = dist(wall[0], wall.at(-1));
    outline = rectAroundLine(wall, Math.max(wallLen, h.width_m || 0), h.depth_m || 3);
  } else {
    if (!mg.rings.length) throw new Error(`${l.id}: main object has no closed ring`);
    outline = cfg.hull ? hullLL(mg.rings.flat()) : mg.rings.reduce((a, b) => (Math.abs(ringArea(b)) > Math.abs(ringArea(a)) ? b : a));
  }
  // gateWall mode: the landmark sits at the gate / tower, not at the mean of every wall way of the main.
  const mainPoint = cfg.gateWall ? center(geomOf(els.get(cfg.gateWall))) : mg.point || center(mg);
  const dMain = dist(mainPoint, [l.lat, l.lon]);
  if (dMain > 250) throw new Error(`${l.id}: main object is ${Math.round(dMain)} m from the landmark coordinate`);

  // cfg.synth: rings cut from an OSM way along its own nodes. One may replace the outline.
  const mainRing = outline;
  const synthRings = (cfg.synth || []).map(s => {
    const w = els.get(s.from);
    if (!w?.nodes) throw new Error(`${l.id}: synth source ${s.from} missing or without node ids`);
    const ring = s.nodes.map(n => {
      const i = w.nodes.indexOf(n);
      if (i < 0) throw new Error(`${l.id}: synth node ${n} is not on ${s.from}`);
      return [w.geometry[i].lat, w.geometry[i].lon];
    });
    return { s, ring: ring.concat([ring[0]]) };
  });
  const synthOutline = synthRings.find(x => x.s.outline);
  if (synthOutline) outline = synthOutline.ring;

  // Principal axis: of the main building, or of `axisFrom` (e.g. the stadium stands).
  const axisPts = cfg.axisFrom ? allPts(geomOf(els.get(cfg.axisFrom))) : outline;
  const rect = minAreaRect(axisPts);

  // Site polygons for part collection (the main object's ring, even when a synth ring is the outline;
  // every ring of a multi-ring main such as the tannery tanks).
  let sitePolys = (cfg.hull ? mg.rings : [mainRing]).map(r => r.map(toXY)), buffer = cfg.site.buffer ?? 0;
  if (cfg.site.area) sitePolys = geomOf(els.get(cfg.site.area)).rings.map(r => r.map(toXY));
  const radius = cfg.site.radius;

  const partKeys = new Set();
  const pathKeys = new Set(); // cfg.paths: footways inside the site, tagged 'path'
  for (const [k, el] of els) {
    if (k === cfg.main || k === cfg.site.area || k === cfg.gateWall || k === cfg.stands) continue;
    if ((cfg.exclude || []).includes(k)) continue;
    const g = geomOf(el);
    if (!allPts(g).length) continue;
    const cat = categoryOf(el.tags);
    if (cfg.paths && /^(footway|path|pedestrian)$/.test(el.tags?.highway || '') && inSite(g, sitePolys, buffer)) { pathKeys.add(k); continue; }
    if (!catMatches(cat, cfg.cats)) continue;
    if (cat === 'street') continue;
    const ok = radius ? dist(center(g), [l.lat, l.lon]) <= radius : inSite(g, sitePolys, buffer);
    if (ok) partKeys.add(k);
  }
  for (const k of cfg.include || []) partKeys.add(k);
  if (cfg.streets) for (const [k, el] of els) if (el.tags?.highway && cfg.streets.test(el.tags.name || '')) partKeys.add(k);
  // cfg.aerialway: the cable's pylon nodes, wherever they stand along the line.
  if (cfg.aerialway) {
    const line = els.get(cfg.aerialway);
    for (const n of line?.nodes || []) if (els.get(`n${n}`)?.tags?.aerialway === 'pylon') partKeys.add(`n${n}`);
  }

  // The main object is always the first part.
  const parts = [];
  const pushPart = (el, g, catOverride, nameOverride) => {
    const t = el.tags || {};
    const cat = catOverride || categoryOf(t);
    const ph = partHeight(t, cat);
    // cfg.holes: each inner ring goes to the outer ring that contains its first point.
    const holesOf = r => (cfg.holes && g.inners?.length ? g.inners.filter(h => pointInPoly(toXY(h[0]), r.map(toXY))).map(ringOut) : []);
    const geoms = [...g.rings.map(r => ({ pts: ringOut(r), closed: true, holes: holesOf(r) })), ...g.lines.map(r => ({ pts: round(r), closed: false })),
      ...(g.point ? [{ pts: round([g.point]), closed: false }] : [])];
    for (const gg of geoms) {
      const p = { tag: cat, osm: keyOf(el), pts: gg.pts, closed: gg.closed, height_m: ph.h, height_source: ph.src };
      if (gg.holes?.length) p.holes = gg.holes;
      if (t.name || nameOverride) p.name = nameOverride || t.name;
      if (t.layer) p.layer = Number(t.layer);
      parts.push(p);
    }
  };
  if (cfg.gateWall) {
    pushPart(main, { rings: [outline.concat([outline[0]])], lines: [] }, cfg.gateTag || 'gate');
  } else if (cfg.hull) {
    pushPart(main, { rings: mg.rings, lines: [] });
  } else {
    pushPart(main, { rings: [mainRing], lines: [], inners: mg.inners });
  }
  if (cfg.stands) {
    const st = els.get(cfg.stands);
    const g = geomOf(st);
    // Each outer ring of the stadium building multipolygon is one stand.
    g.rings.forEach((r, i) => pushPart(st, { rings: [r], lines: [] }, 'stand', `Stand ${i + 1}`));
  }
  const missing = [];
  for (const k of partKeys) {
    const el = els.get(k);
    if (!el) { missing.push(k); continue; }
    pushPart(el, geomOf(el));
  }
  for (const k of pathKeys) if (!partKeys.has(k)) pushPart(els.get(k), geomOf(els.get(k)), 'path');
  // Synthesized parts carry osm: null and a `synth` id; height from HEIGHTS (`on`) or the default.
  for (const { s, ring } of synthRings) {
    const cat = s.tag || 'building';
    parts.push({ tag: cat, osm: null, synth: s.id, source: `cut from OSM ${s.from}`, pts: ringOut(ring), closed: true,
      height_m: PART_DEFAULT[cat] ?? 0, height_source: 'estimate', ...(s.name ? { name: s.name } : {}) });
  }
  // cfg.ms: Microsoft ML footprints inside the site for blocks OSM does not map.
  if (cfg.ms) {
    let n = 0;
    for (const p of msPolys()) {
      if (Math.abs(ringArea(p.r)) < cfg.ms.minArea) continue;
      if (!sitePolys.some(sp => pointInPoly(toXY(centroid(p.r)), sp))) continue;
      const pts = simplifyRing(p.r, 0.5).map(([a, b]) => [r6(a), r6(b)]);
      parts.push({ tag: 'building', osm: null, synth: `ms:${++n}`, source: 'Microsoft Global ML Building Footprints (ODbL)', pts, closed: true,
        height_m: cfg.ms.h, height_source: 'estimate', name: cfg.ms.name });
    }
    if (!n) throw new Error(`${l.id}: cfg.ms found no Microsoft footprint inside the site`);
  }
  // cfg.as: untagged member ways (e.g. a multipolygon outer) get a tag, a name and an estimated height.
  for (const [k, o] of Object.entries(cfg.as || {})) for (const p of parts) if (p.osm === k) {
    p.tag = o.tag; p.height_m = o.h; p.height_source = 'estimate'; if (o.name) p.name = o.name;
  }
  if (missing.length) console.warn(`${l.id}: include ids not returned: ${missing.join(', ')}`);

  // Height of the landmark.
  const cfgH = HEIGHTS[l.id];
  const th = tagHeight(mt);
  let height, hsrc, hnote;
  if (cfgH?.force || (!th && cfgH)) { height = cfgH.m; hsrc = cfgH.source; hnote = cfgH.note; }
  else if (th) { height = th.h; hsrc = th.src; }
  else throw new Error(`${l.id}: no height tag and no entry in landmark-heights.mjs`);
  if (th && cfgH?.force) hnote = `${hnote || ''} (OSM tag gives ${th.h} m, ${th.src}; overridden)`.trim();
  // The landmark height belongs to its tallest element. For a building that is the
  // main part; for open sites (garden, square, stadium site) it is a named part and
  // the site polygon itself stays flat.
  const tallKey = cfgH?.on || cfg.main;
  const tallParts = parts.filter(p => (p.osm === tallKey || p.synth === tallKey) && (!cfgH?.onTag || p.tag === cfgH.onTag));
  if (!tallParts.length) throw new Error(`${l.id}: tallest element ${tallKey} is not among the parts`);
  for (const p of tallParts) { p.height_m = height; p.height_source = hsrc; }
  if (tallKey !== cfg.main) {
    const flat = ['garden', 'square', 'site', 'street', 'pitch', 'ruins'].includes(parts[0].tag) && !(cfg.as?.[cfg.main]?.h > 0);
    parts[0].height_m = cfgH?.main_m ?? (flat ? 0 : parts[0].height_m);
    parts[0].height_source = cfgH?.main_m != null ? cfgH.main_source || 'estimate' : flat ? 'flat' : parts[0].height_source;
  }
  for (const p of parts) if (['garden', 'square', 'site', 'street', 'pitch', 'stairs', 'funicular', 'cable', 'path'].includes(p.tag) && !tallParts.includes(p)) {
    p.height_m = 0; p.height_source = 'flat';
  }

  const verify = mt.wikidata ? await checkWikidata(mt.wikidata, cfg.main, [l.lat, l.lon]) : 'no wikidata tag on main object';
  await wait(300);

  const osmIds = [...new Set([cfg.main, cfg.stands, ...parts.map(p => p.osm)].filter(Boolean))];
  // Per-part height overrides from HEIGHTS[id].parts: {osm key or synth id: [m, reasoning]}.
  for (const [k, [m]] of Object.entries(cfgH?.parts || {})) {
    const hit = parts.filter(p => p.osm === k || p.synth === k);
    if (!hit.length) throw new Error(`${l.id}: HEIGHTS parts key ${k} is not among the parts`);
    for (const p of hit) { p.height_m = m; p.height_source = 'estimate'; }
  }
  out[l.id] = {
    osm: { ...parseKey(cfg.main), name: mt.name, wikidata: mt.wikidata || null },
    verify,
    outline: ringOut(outline),
    parts,
    centroid: round([centroid(outline)])[0],
    bearing_deg: rect.bearing,
    extent_m: [Math.round(rect.long * 10) / 10, Math.round(rect.short * 10) / 10],
    area_m2: Math.round(Math.abs(ringArea(outline))),
    height_m: height,
    height_source: hsrc,
    ...(hnote ? { height_note: hnote } : {}),
    ...(cfg.pitch ? { pitch_bearing_deg: minAreaRect(allPts(geomOf(els.get(cfg.pitch)))).bearing } : {}),
    osm_ids: osmIds,
    // Open sites (a square, a garden, a campus) keep the ordinary buildings inside their outline.
    exclude_outline: cfg.exclude_outline ?? !['avenida-central', 'praca-republica', 'santa-barbara', 'parque-ponte'].includes(l.id),
    main_offset_m: Math.round(dMain),
  };
  l.osm = { type: parseKey(cfg.main).type, id: parseKey(cfg.main).id, height_m: height, height_source: hsrc };
  const tagCount = {};
  parts.forEach(p => (tagCount[p.tag] = (tagCount[p.tag] || 0) + 1));
  report.push([l.id, cfg.main, `${out[l.id].extent_m[0]}x${out[l.id].extent_m[1]} m`, `${rect.bearing}°`, `${height} m (${hsrc})`,
    `${parts.length} parts ${JSON.stringify(tagCount)}`, `off ${Math.round(dMain)} m`, verify].join(' | '));
}

mkdirSync(dirname(OUT), { recursive: true });
if (!HAVE_LANDMARKS_FILE && !ONLY) {
  // A city before its landmarks.json: the full footprints file plus one new/<id>.osm.json per
  // landmark for the agents that merge landmarks.json; nothing else is written.
  writeFileSync(OUT, JSON.stringify(out));
  const NEW = dataPath('new');
  mkdirSync(NEW, { recursive: true });
  for (const l of todo) {
    const o = { osm: l.osm, lat: l.lat, lon: l.lon, model: CFG[l.id].model || l.model };
    writeFileSync(join(NEW, `${l.id}.osm.json`), JSON.stringify(o, null, 2) + '\n');
  }
  console.log(`Wrote ${OUT} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB) and ${dataRel('new')}/<id>.osm.json for ${todo.length} landmarks; no landmarks.json yet (the landmark agents write it)`);
} else if (ONLY) {
  // Keep every other entry as it is; replace only the --only ids (key order follows landmarks.json).
  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
  const merged = {};
  for (const l of landmarks) if (out[l.id] || prev[l.id]) merged[l.id] = out[l.id] || prev[l.id];
  for (const k of Object.keys(prev)) if (!merged[k]) merged[k] = prev[k];
  writeFileSync(OUT, JSON.stringify(merged));
  const NEW = dataPath('new');
  mkdirSync(NEW, { recursive: true });
  for (const l of todo) {
    const o = { osm: l.osm, lat: l.lat, lon: l.lon, model: CFG[l.id].model || l.model };
    writeFileSync(join(NEW, `${l.id}.osm.json`), JSON.stringify(o, null, 2) + '\n');
  }
  console.log(`Wrote ${OUT} (${(JSON.stringify(merged).length / 1024).toFixed(0)} KB; replaced ${todo.map(l => l.id).join(', ')}) and ${dataRel('new')}/<id>.osm.json; landmarks.json untouched`);
} else {
  writeFileSync(OUT, JSON.stringify(out));
  writeFileSync(LANDMARKS, JSON.stringify(landmarks, null, 2) + '\n');
  console.log(`Wrote ${OUT} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB) and updated landmarks.json`);
}
for (const r of report) console.log(r);
