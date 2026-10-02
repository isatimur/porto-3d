// Landmark heights used by fetch-footprints.mjs when OSM has no usable height tag.
// m = height of the tallest element in metres. source = "wikipedia" or "estimate".
// No published figure exists for most of these sites (searched pt/en Wikipedia,
// SIPA, official sites on 2026-09-28), so most are estimates; `note` gives the reasoning.
// on / onTag = OSM key (and part tag) of the tallest element, when it is not the main object.
// main_m = height of the main object when the tallest element is another part.
// force = true overrides an OSM tag that is clearly wrong for the real building.
// parts = {OSM key or synth id: [m, reasoning]}: estimated heights of other parts.
// One table per city (HEIGHTS_BY_CITY); HEIGHTS is the table of the city this process runs on.
import { CITY } from './city-lib.mjs';

const BRAGA = {
  'bom-jesus': { m: 34, source: 'estimate', note: 'Twin façade towers of the basilica. No published height; scaled from the 6 m façade columns (pt.wikipedia Basílica do Bom Jesus) and photos.' },
  sameiro: { m: 32, source: 'estimate', note: 'Dome of the sanctuary. No published height; sources put the dome top at "over 600 m" altitude and the terrace at 566-572 m, so 28-34 m.' },
  'se-braga': { m: 30, source: 'estimate', note: 'Twin bell towers. No published height (pt/en Wikipedia checked); estimated from photos and the scale of the nave.' },
  'arco-porta-nova': { m: 12, source: 'estimate', width_m: 8, depth_m: 3, note: 'OSM maps the gate as a node plus a 7 m barrier=wall line; the outline is a synthesized 8 x 3 m rectangle on that line. Height with attic from photos, no published figure.' },
  'santa-barbara': { m: 20, source: 'estimate', on: 'r20123877', note: 'Tallest element is the wing of the Antigo Paço Episcopal (3 storeys) beside the garden; garden itself is flat.' },
  'praca-republica': { m: 22, source: 'estimate', on: 'w167193931', note: 'Tallest element is the bell tower of the Igreja da Lapa behind the Arcada; square itself is flat.' },
  'theatro-circo': { m: 28, source: 'estimate', force: true, note: 'Fly tower. The venue rider (theatrocirco.com RIDER_THEATRO_CIRCO.pdf) gives 24 m stage-to-grid; roof adds ~4 m. The OSM building:levels=2 counts only the façade storeys.' },
  'palacio-raio': { m: 15, source: 'estimate', note: 'Two tall storeys plus attic and roof; no published height.' },
  'santa-cruz': { m: 28, source: 'estimate', note: 'Twin bell towers (1694); no published height.' },
  'estadio-braga': { m: 40, source: 'estimate', on: 'r17396393', onTag: 'stand', main_m: 0, main_source: 'flat', note: 'Top of the two stands. Published 40 m is the carved granite quarry face the east stand stands against (flagra.pt; Arquitectura Viva: VIP plaza "forty meters higher" than the pitch); used as the stand/roof height.' },
  'termas-romanas': { m: 6, source: 'estimate', note: 'Protective roof canopy over the ruins; no published height.' },
  'fonte-idolo': { m: 5, source: 'estimate', note: 'Single-storey interpretation centre built over the fountain (2001-2004); no published height.' },
  tibaes: { m: 28, source: 'estimate', on: 'w170604958', main_m: 14, main_source: 'estimate', note: 'Church bell towers; monastery wings ~14 m (3 storeys). No published height.' },
  biscainhos: { m: 16, source: 'estimate', note: 'Two-storey Baroque palace with high roof; no published height.' },
  populo: { m: 26, source: 'estimate', note: 'Twin façade towers (Carlos Amarante, late 18th c.) with Baroque cupolas and crosses. No published height (pt/en Wikipedia, e-cultura, visitbraga checked 2026-09-29); the frontal Commons photo gives tower-top/façade-width about 1.2-1.4 on the 18.8 m OSM church width.' },
  'ucp-braga': { m: 26, source: 'estimate', note: 'Faculdade de Filosofia building on Praça da Faculdade: about six storeys and a corner tower with a statue. No published height; from Commons photos.' },
  'estadio-1-maio': { m: 30, source: 'estimate', note: 'The slender granite tower over the north entrance is the tallest element; OSM has no tower or stand objects, so the height sits on the stadium outline. Open stands about 10 m. No published height; from Commons photos.' },
  'parque-ponte': { m: 10, source: 'estimate', on: 'w121590142', note: 'Tallest built element is the Capela de São João da Ponte (1616), single nave with bell gable; the park itself is flat. No published height.' },
  'forum-braga': { m: 14.5, source: 'wikipedia', note: 'Pavilion clear height 11.5-14.5 m across the hall (pt.wikipedia Forum Braga; forumbraga.com/Espacos/Pavilhao).' },
  // --- second batch, 2026-09-29 (researched pt/en Wikipedia, DGPC, SIPA, museum and school sites) ---
  'uminho-gualtar': { m: 19.2, source: 'osm building:levels×3.2', on: 'w448580564', note: 'Tallest mapped campus building: the Instituto para a Bio-Sustentabilidade (IB-S, 2015), building:levels=6 in OSM. No published building heights for the campus (uminho.pt, pt/en Wikipedia checked 2026-09-29); the other schools carry 1-4 levels in OSM. The campus area itself is flat.' },
  'dmaria-ii': {
    m: 13, source: 'estimate', on: 'w473728998',
    note: 'North-west wing of the 1964 Liceu (the only block OSM maps), three storeys. The original school had 2960 m² covered and 7060 m² of floors (asap-ehc.tecnico.ulisboa.pt escola id 28): about 2.4 floors on average, so three storeys at most; 3 x 3.8 m school storeys + parapet ≈ 13 m.',
    parts: { 'ms:1': [12, 'Parque Escolar blocks (2011), two to three storeys; MS footprint only.'], 'ms:2': [12, 'Parque Escolar blocks (2011), two to three storeys; MS footprint only.'] },
  },
  'sao-frutuoso': {
    m: 9, source: 'estimate',
    note: 'Top of the square tower over the crossing of the Greek-cross chapel (DGPC 70191: four apses around a square crossing). No published height; the chapel is 13 x 11 m in OSM with single-storey apses, so the crossing tower is about 9 m.',
    parts: {
      w131049722: [12, 'Igreja de São Jerónimo de Real (former Franciscan church, rebuilt from 1728): single nave, no published height.'],
      w159104084: [9, 'Convento de São Francisco: two storeys, no published height.'],
    },
  },
  'diogo-sousa': {
    m: 12.8, source: 'osm building:levels×3.2', on: 'w444600885',
    note: 'The museum (2007, Carlos Guimarães and Luís Soares Carneiro) has three bodies: technical/services, cafeteria and public area (maddiogosousa.gov.pt/edificio). The tallest is the four-level block w444600885 (building:levels=4), read as the technical sector. The exhibition body w108351556 is set to 10 m: OSM says 2 levels, but the exhibition halls are double-height (estimate).',
    parts: { w108351556: [10, 'Two-level exhibition body with tall halls, about 2 x 4.5 m + parapet.'] },
  },
  coimbras: {
    m: 16, source: 'estimate', on: 'w1343853590', main_m: 12, main_source: 'estimate',
    note: 'The chapel is a Manueline "igreja-torre" with a square plan and a tower-like front in two registers (DGPC 70651), 12.25 x 6.25 m (en.wikipedia infobox). In OSM it is the 7 x 6 m tower w1343853590; the 37 m way w223138080 also covers the Igreja de São João do Souto it is attached to. Tower top with merlons about 16 m (two registers plus crenellation, about 2.5 x the 6.25 m width); church body 12 m. No published heights.',
    parts: { w146342996: [12, 'Casa dos Coimbras (rebuilt 1924): three storeys.'] },
  },
  congregados: {
    m: 32, source: 'estimate',
    note: 'Twin bell towers (east tower 18th c., west tower completed 1964, pt.wikipedia Basílica dos Congregados). No published height; the towers rise about 1.3 x the 25 m façade width in frontal photos.',
  },
  'nogueira-silva': {
    m: 13, source: 'estimate', on: 'synth:nogueira-house', main_m: 0, main_source: 'flat',
    note: 'The house (built 1950s-60s, architect Raul Rodrigues de Lima, per webraga.pt) is the part of the OSM plot south of the garden; three storeys on Avenida Central with a pitched roof, about 13 m. No published height. The plot and garden are flat.',
  },
  'sao-marcos': {
    m: 20, source: 'estimate',
    note: 'Convex Baroque front by Carlos Amarante (project 1787) crowned by 12 statues of apostles (pt.wikipedia Igreja de São Marcos); top of the statues and pediment about 20 m. No published height.',
    parts: {
      r17978905: [16, 'Former north pavilion of the hospital, now the Vila Galé hotel (pt.wikipedia Hospital de São Marcos): three tall storeys plus roof.'],
      r8340055: [16, 'Later hospital pavilion, 3-4 storeys; no published height.'],
      w146343003: [14, 'Later hospital wing, three storeys; no published height.'],
    },
  },
  'avenida-central': { m: 8, source: 'estimate', on: 'w108153350', note: 'Tallest element on the avenue is the 1868 iron bandstand (Coreto da Avenida); garden itself is flat.' },
};

// Guimarães (researched 2026-09-30: pt/en Wikipedia, e-cultura, cm-guimaraes.pt, visitguimaraes.travel,
// Pitágoras). Published heights exist only for the castle keep; the rest are estimates with reasoning.
const GUIMARAES = {
  castelo: {
    m: 27, source: 'osm height tag', on: 'w346365691', force: true, main_m: 12, main_source: 'estimate',
    note: 'Torre de menagem: OSM height=27 on the keep way, and e-cultura (patrimonio_item/5401): "A Torre de Menagem, que atinge 27 metros de altura". The wall ring carries height=18 in OSM, which reads as its highest point; the crenellated curtain is about 12 m from photos (roughly 0.45 x the keep). Eight wall towers per e-cultura; seven are mapped.',
    parts: {
      w807304448: [14, 'Wall tower, a little above the 12 m curtain.'], w807304449: [14, 'Wall tower.'], w807304450: [14, 'Wall tower.'],
      w807304451: [14, 'Wall tower.'], w807304452: [14, 'Wall tower.'], w807304453: [14, 'Wall tower.'], w807304454: [14, 'Wall tower.'],
    },
  },
  'paco-duques': {
    m: 22, source: 'estimate', force: true,
    note: 'Ridge and chimney tops of the palace (1420-1461, rebuilt 1937-59): three tall storeys around the courtyard (OSM building:levels=3 gives only 9.6 m), steep roofs with the 39 brick chimneys, four corner towers. No published height (pt/en Wikipedia, DGPC 70513, pacodosduques.gov.pt checked); about 22 m from photos against the 25 m short side of the courtyard.',
  },
  'sao-miguel-castelo': {
    m: 9, source: 'estimate', force: true,
    note: 'Single-nave Romanesque chapel (consecrated 1239, "igreja de pequenas dimensões" per pt.wikipedia) with a bell gable over the west front. OSM height=5 reads as the eaves; ridge plus sineira about 9 m.',
  },
  oliveira: {
    m: 30, source: 'estimate',
    note: 'Manueline bell tower (completed about 1513-1515, cm-guimaraes.pt) at the south-west corner of the church. No published height; the tower is about 1.8 x the nave ridge (17 m) in photos from the Largo da Oliveira.',
    parts: { w820481033: [9, 'Padrão do Salado: Gothic canopy of four pointed arches with the 1342 cross on top (cm-guimaraes.pt); about 9 m.'] },
  },
  'sao-tiago': {
    m: 12.8, source: 'osm building:levels×3.2', on: 'w473881530',
    note: 'The square is flat; its enclosure is the ring of 3-4 storey houses with addr:street "Praça de São Tiago" in OSM. Tallest: the four-level house w473881530 on the west side. No monument stands on the square.',
  },
  toural: {
    m: 20, source: 'estimate', on: 'w254317701',
    note: 'Igreja de São Pedro (begun 1737, façade left without its towers) on the north-west side of the Largo; pediment about 20 m. The square itself is flat; the Chafariz do Toural (three-basin Renaissance fountain, pt.wikipedia Largo do Toural) is 6 m.',
  },
  penha: {
    m: 26, source: 'estimate',
    note: 'Granite Art Déco sanctuary (José Marques da Silva, works 1930-1947, pt.wikipedia): single nave, entrance tower with the 1949 cross and angel corbel facing the city. No published height; about 26 m from photos against the 605 m² OSM plan (26 m wide). The park is flat; the cable line is a flat part whose pylons carry 12 m.',
    parts: {
      w104203786: [8, 'Teleférico upper station (Estação da Penha), single-storey hall on the terrace.'],
      w104203806: [8, 'Teleférico lower station (Estação das Hortas), single-storey hall.'],
    },
  },
  'santos-passos': {
    m: 30, source: 'estimate',
    note: 'Twin bell towers (Pedro Ferreira, 1862-1875, en.wikipedia Santos Passos Church) with pyramidal tops on the convex Baroque front (André Soares plan, 1767-1785). No published height; towers about 1.5 x the 20 m façade width in frontal photos from the Largo da República do Brasil.',
  },
  'sao-francisco': {
    m: 24, source: 'estimate',
    note: 'Bell tower beside the Gothic church (apse about 1461, single nave since 1746-49, two-storey Mannerist cloister from 1591, pt.wikipedia). No published height; tower about 24 m from photos, convent wings 12 m.',
  },
  'alberto-sampaio': {
    m: 10, source: 'estimate',
    note: 'The museum occupies the two-storey Romanesque cloister and chapter house of the Colegiada north of the church; ranges about 10 m to the ridge. No published height.',
  },
  muralha: {
    m: 15, source: 'estimate', width_m: 20, depth_m: 8,
    note: 'Torre da Alfândega, the only surviving tower of the 13th-c. town wall (cm-guimaraes.pt, reopened 2024), two floors over the wall walk; about 15 m. OSM maps it as a node on a 12.5 m wall stub, so the outline is a synthesized 20 x 8 m rectangle on that stub. The 270 m stretch along Avenida Alberto Sampaio is a wall line part.',
    parts: {
      w150780884: [8, 'Crenellated wall stretch along Avenida Alberto Sampaio; about 8 m.'],
      w255483374: [8, 'Wall stub at the Torre da Alfândega with the "Aqui nasceu Portugal" inscription.'],
    },
  },
  'plataforma-artes': {
    m: 16, source: 'estimate',
    note: 'CIAJG museum block (Pitágoras Arquitectos, 2012): a three-floor metal-clad box on the raised square ("three-floor metallic structure"; built area 10 335 m², public space 7 750 m² per the Pitágoras / cm-guimaraes project sheets). About 16 m; the two workshop bars 12 m.',
  },
  couros: {
    m: 1.2, source: 'estimate',
    note: 'Granite tanning tanks (19th-early 20th c., dozens of tanks per visitguimaraes.travel) sunk in the ground along the Ribeira de Couros: rims about 1.2 m above the surrounding paving. No built element rises above the houses around them.',
  },
  'santa-marinha': {
    m: 22, source: 'estimate', on: 'w257159145', main_m: 12, main_source: 'estimate',
    note: 'Bell tower of the Igreja de Santa Marinha (18th-c. front) beside the monastery; about 22 m. The monastery / pousada is "um corpo de dois pisos" (pt.wikipedia; Fernando Távora, 1985) with high roofs, 12 m.',
  },
  'estadio-afonso-henriques': {
    m: 32, source: 'estimate', on: 'w1293455711', onTag: 'stand', main_m: 0, main_source: 'flat',
    note: 'Roof of the west (Poente) main stand of the 2003 rebuild (Eduardo Guimarães; 30 029 seats, pt.wikipedia). No published height; a two-tier 30 000 stand with roof is about 32 m. Nascente the same, Norte / Sul (single deep tier, the south fully covered) 28 m; the inner "Inferior" tier polygons 10 m, the "Superior" tiers 26 m.',
    parts: {
      w1293455713: [32, 'Nascente (east) stand with roof.'], w1293455714: [28, 'Norte (north) stand.'], w1293455712: [28, 'Sul (south) stand, fully covered.'],
      w1293470767: [26, 'W Superior tier.'], w1293587599: [26, 'E Superior tier.'], w1293470764: [26, 'N Superior tier.'], w1293470769: [26, 'S Superior tier.'],
      w1293470766: [10, 'W Inferior tier.'], w1293587598: [10, 'E Inferior tier.'], w1293470765: [10, 'N Inferior tier.'], w1293470768: [10, 'S Inferior tier.'],
    },
  },
  'uminho-azurem': {
    m: 16, source: 'osm building:levels×3.2', on: 'w129352430',
    note: 'Tallest mapped campus building: the student residence Bloco G2 (building:levels=5 in OSM) at the east edge of the campus. The Escola de Engenharia, the largest block (113 x 53 m, no levels tag), is set to 14 m (three storeys plus plant, estimate). No published heights (uminho.pt checked); OSM gives 1 level for the geography building and height=4-4.3 for the auditorium and science school. The campus area itself is flat.',
    parts: { w129701958: [14, 'Escola de Engenharia: three storeys plus roof plant, no levels tag in OSM.'] },
  },
  briteiros: {
    m: 6, source: 'estimate', on: 'w527217517',
    note: 'Chapel of São Romão on the summit (336 m, pt.wikipedia Citânia de Briteiros) is the only roofed building; about 6 m. Ramparts: "altura média de 2 metros", reconstructed sections 4 m, thickness 2-3 m (pt.wikipedia); round houses about 5 m across, reconstructed ones roofed to about 4 m. The site polygon is flat.',
    parts: {
      w448104412: [2, 'Rampart line, published average 2 m.'], w176845321: [2, 'Rampart line.'], w448104413: [2, 'Rampart line.'], w448106887: [2, 'Rampart line.'],
      w1430010225: [4, 'Reconstructed round house with thatched roof (Sarmento, 1930s).'], w1430010398: [4, 'Reconstructed round house.'],
      w527213977: [4, 'House / shelter at the site entrance.'], w527213978: [4, 'House at the site entrance.'], w527213979: [4, 'House at the site entrance.'],
    },
  },
  'vila-flor': {
    m: 15, source: 'estimate',
    note: 'Palácio Vila Flor (18th c.): two tall storeys with a parapet of statues; about 15 m. No published height (pt.wikipedia Centro Cultural Vila Flor, ccvf.pt checked). The 2005 Pitágoras auditoria are set below the palace terrace: Grande Auditório (800 seats) 15 m to its fly roof, Pequeno Auditório (200 seats) 9 m.',
    parts: { w130533849: [15, 'Grande Auditório (800 seats), stage house.'], w130533855: [9, 'Pequeno Auditório (200 seats).'] },
  },
};

export const HEIGHTS_BY_CITY = { braga: BRAGA, guimaraes: GUIMARAES };
export const HEIGHTS = HEIGHTS_BY_CITY[CITY.id] || {};
