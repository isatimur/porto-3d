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

// Porto (researched 2026-10-02: pt/en Wikipedia, Wikidata P2048/P2043, OSM tags, SIPA/DGPC
// where available). Published figures exist for the bridges, the Clérigos tower and the
// Felgueiras light; the rest are estimates with reasoning. `force` overrides a wrong OSM tag.
const PORTO = {
  clerigos: {
    m: 75.6, source: 'wikipedia', on: 'w247168260', main_m: 25, main_source: 'estimate', force: true,
    note: 'Torre dos Clérigos: 75.6 m (Wikidata Q54802080 P2048 = 75.6 m; pt/en Wikipedia). The OSM tower way w247168260 carries height=75 and is overridden to the published 75.6. Church body ~25 m.',
    parts: { w247168257: [22.5, 'Casa da Irmandade dos Clérigos, OSM height=22.5.'] },
  },
  lello: { m: 14, source: 'estimate', note: 'Livraria Lello (1906) occupies two tall storeys plus an attic of the Rua das Carmelitas block; about 14 m. No published height (pt/en Wikipedia checked 2026-10-02).' },
  'sao-bento': {
    m: 22, source: 'estimate', force: true,
    note: 'São Bento station (José Marques da Silva, 1896-1916): tall azulejo hall with the central clock gable; about 22 m. OSM building:levels=2 (6.4 m) counts the side wings only. No published height.',
    parts: { w1363395865: [16, 'Torreão Sul (south pavilion).'], w1363395867: [16, 'Torreão Norte (north pavilion).'] },
  },
  'se-porto': { m: 30, source: 'estimate', note: 'Twin crenellated Romanesque towers of the Sé do Porto; about 30 m. No published height; scaled from photos against the ~30 m nave length (OSM outline).' },
  bolsa: { m: 20, source: 'estimate', note: 'Neoclassical Palácio da Bolsa (1842-1910): two tall storeys around the courtyard (the Arab Room dome is inside); about 20 m. No published height.' },
  'sao-francisco-porto': { m: 18, source: 'estimate', note: 'Baroque church of São Francisco: façade and nave about 18 m. No published height (pt/en Wikipedia checked).' },
  'ponte-luis-i': { m: 60, source: 'wikipedia', note: 'Ponte Luís I (1886): upper deck 60 m above the Douro, central span 172 m, total length 385.25 m. Wikidata Q1322447 gives P2048=45 m for the structural height and P2043=385.25 m.' },
  ribeira: { m: 18, source: 'estimate', on: 'w210555178', note: 'Cais da Ribeira: the arcaded riverfront houses are 4-5 storeys, façade line about 18 m. The mapped area (w239012587, area=yes) is flat ground; the height rides on the Carris Hoteles Porto Ribeira house (w210555178, 5 storeys).' },
  serralves: { m: 12, source: 'estimate', note: 'Casa de Serralves (Art Deco villa, 1925-1944): two storeys plus basement, about 12 m. The 1999 Siza museum and its west wing are similar; no published heights.' },
  'casa-musica': { m: 40, source: 'estimate', note: 'Casa da Música (Rem Koolhaas, 2005): OSM w603359226 tags height=40; the concert-hall monolith is about 40 m. No published height on pt.wikipedia.' },
  dragao: {
    m: 40, source: 'estimate', on: 'w1427108120',
    note: 'Estádio do Dragão (2003): single-tier bowl with a continuous roof, about 40 m above the pitch; OSM maps the four stands as building=stadium (w1427108120-123) and the bowl as leisure=stadium (w547707192). No published height.',
    parts: { w1427108121: [40, 'North stand.'], w1427108122: [40, 'East stand.'], w1427108123: [40, 'West stand.'] },
  },
  felgueiras: {
    m: 10, source: 'wikipedia', on: 'n1675107645', main_m: 3, main_source: 'estimate',
    note: 'Farolim de Felgueiras: 10 m (Wikidata Q10280208 P2048 = 10 m). OSM maps the light only as a node; the only closed OSM footprint is the Molhe de Felgueiras breakwater (w446589339, main, ~3 m above water).',
  },
  'caves-gaia': { m: 14, source: 'estimate', note: "Port-wine lodges on the Gaia bank: sandstone warehouses of 2-3 storeys, about 14 m. OSM names the lodges only as tourism=wine_cellar nodes (Sandeman, Cálem, Burmester, Augusto's); the main footprint is the adjacent Sandeman lodge building w382530398." },
  'ponte-arrabida': { m: 70, source: 'estimate', note: 'Ponte da Arrábida (1963): about 70 m above the Douro (OSM w460839285 height=70), central arch span 270 m, total length 493.2 m (Wikidata Q1785740 P2043).' },
  'ponte-maria-pia': { m: 61.2, source: 'wikipedia', note: 'Ponte Maria Pia (Eiffel, 1877): 61.2 m high, central span 160 m (Wikidata Q1550899 P2048/P2043).' },
  'mercado-bolhao': { m: 12, source: 'estimate', force: true, note: 'Mercado do Bolhão (1914, restored 2023): two market floors around an open court, about 12 m to the roof ridge. OSM building:levels=1 (3.2 m) counts a single level; overridden.' },
  aliados: { m: 30, source: 'estimate', note: 'Câmara Municipal do Porto (1920-1957): central clock tower about 30 m. OSM r3012085 height=30, building:levels=5.' },
  carmo: { m: 25, source: 'estimate', note: 'Igreja do Carmo (1756-1768): twin façade towers above the azulejo side; about 25 m. No published height.' },
  'palacio-cristal': {
    m: 30, source: 'osm height tag', on: 'w35341148', main_m: 0, main_source: 'flat',
    note: 'Jardins do Palácio de Cristal: tallest built element is the Super Bock Arena / Pavilhão Rosa Mota (w35341148, OSM height=30); the gardens polygon is flat. NOTE: the landmark coordinate in data/landmarks.json (41.15442,-8.62503) is ~830 m north of the real gardens (41.1470,-8.6265), so cfg.maxOffset relaxes the distance check.',
  },
  'uporto-reitoria': { m: 18, source: 'estimate', force: true, note: 'Reitoria da Universidade do Porto (Pardal Monteiro, 1950s-1961): three-storey granite block with a tall entrance portico, about 18 m. OSM r3047226 building:levels=3 (9.6 m) understates the portico.' },
  // >>> ROSTER-HEIGHTS (generated)
  'ponte-sao-joao': { m: 66, source: 'wikipedia', note: "Ponte de São João (1991): 66 m above the Douro per Wikidata Q7228153 (P2048); 250 m main arch, 1029 m total." },
  'ponte-infante': { m: 75, source: 'wikipedia', note: "Ponte do Infante (2003): 75 m max height, 280 m reinforced-concrete arch, 370 m long (pt.wikipedia Ponte do Infante)." },
  'ponte-freixo': { m: 35, source: 'estimate', note: "Ponte do Freixo (1995): eight spans, main span 150 m; no published height. Its deck is described as much lower than the other Porto bridges, estimated about 35 m above the Douro." },
  'serra-do-pilar': { m: 30, source: 'estimate', note: "Mosteiro da Serra do Pilar: circular church with hemispherical dome and a bell tower; no published height, dome/tower about 30 m against the mapped complex." },
  'jardim-do-morro': { m: 5, source: 'estimate', note: "Jardim do Morro is a flat terraced viewpoint garden; no built element rises above the trees, nominal 5 m." },
  'cais-gaia': { m: 12, source: 'estimate', note: "Cais de Gaia: 2-3 storey lodge and warehouse row along the quay, about 12 m to the eaves; no published height." },
  'convento-corpus-christi': { m: 18, source: 'estimate', note: "Convento de Corpus Christi (1354, rebuilt after 1726): church nave and two-storey convent ranges, about 18 m; no published height." },
  'estacao-general-torres': { m: 12, source: 'estimate', note: "Estação de General Torres (1902 building): single-storey station on the line with a steep roof, about 12 m; no published height and no closed station building in OSM." },
  'trindade': { m: 30, source: 'estimate', note: "Igreja da Santíssima Trindade: granite Baroque church with a tall front; no published height, about 30 m including the pediment." },
  'congregados': { m: 35, source: 'estimate', force: true, note: "Igreja dos Congregados (1700s): twin bell towers with pyramid tops, about 35 m; no published height. OSM building:levels=4 (12.8 m) counts the nave only, overridden." },
  'lapa': { m: 30, source: 'estimate', note: "Igreja da Lapa (1863): single façade with a bell tower, about 30 m; no published height." },
  'santa-clara': { m: 18, source: 'estimate', note: "Igreja de Santa Clara (15th c., rebuilt 18th c.): single-nave church, about 18 m to the ridge; no published height." },
  'sao-nicolau': { m: 18, source: 'estimate', note: "Igreja de São Nicolau: Baroque church with a bell gable, about 18 m; no published height." },
  'sao-bento-vitoria': { m: 25, source: 'estimate', note: "Igreja e Mosteiro de São Bento da Vitória (1604): tall church façade with a tower and four-square monastery; about 25 m; no published height." },
  'cedofeita': { m: 16, source: 'estimate', note: "Igreja de São Martinho de Cedofeita (13th c., Romanesque): low single-nave church, about 16 m; no published height." },
  'santo-ildefonso': { m: 30, source: 'estimate', note: "Igreja de Santo Ildefonso (1739): twin towers flanking a tiled Baroque façade, about 30 m; no published height." },
  'miragaya-sao-pedro': { m: 16, source: 'estimate', note: "Igreja de São Pedro de Miragaia: modest Baroque church, about 16 m; no published height." },
  'capela-almas': { m: 16, source: 'estimate', note: "Capela das Almas (18th c.): small chapel with a blue-and-white tiled façade, about 16 m; no published height." },
  'foz-sao-joao-baptista': { m: 20, source: 'estimate', note: "Igreja de São João Baptista da Foz (16th c.): nave with a bell tower, about 20 m; no published height." },
  'ramalde': { m: 16, source: 'estimate', note: "Igreja de Ramalde: parish church with a bell gable, about 16 m; no published height." },
  'campanha': { m: 18, source: 'estimate', note: "Estação de Campanhã (1875): tall central station building with a clock gable, about 18 m; no published height." },
  'coliseu': { m: 32, source: 'estimate', note: "Coliseu do Porto (1941): large auditorium with a domed roof, about 32 m; no published height." },
  'museu-soares-dos-reis': { m: 16, source: 'estimate', note: "Museu Nacional Soares dos Reis in the Palácio dos Carrancas: two tall storeys, about 16 m; no published height." },
  'casa-do-infante': { m: 14, source: 'estimate', note: "Casa do Infante (14th c., rebuilt): medieval customs house and museum, about 14 m; no published height." },
  'alfandega-nova': { m: 20, source: 'estimate', note: "Alfândega Nova (1860, Jean Colson): long neoclassical granite customs house with an iron interior; about 20 m; no published height." },
  'museu-romantico': { m: 12, source: 'estimate', note: "Museu Romântico (Casa dos Macieirinha): two-storey villa with a garden, about 12 m; no published height." },
  'casa-guerra-junqueiro': { m: 14, source: 'estimate', note: "Casa-Museu Guerra Junqueiro (17th c.): granite bourgeois house, about 14 m; no published height." },
  'teatro-rivoli': { m: 25, source: 'estimate', force: true, note: "Teatro Rivoli (1913): five-storey theatre block with an auditorium fly tower, about 25 m; no published height. OSM building:levels=5 (16 m) counts the street front, overridden." },
  'cinema-batalha': { m: 22, source: 'estimate', note: "Batalha Centro de Cinema (1947, Artur Andrade): Art Deco cinema block, about 22 m; no published height." },
  'cadeia-relacao': { m: 20, source: 'estimate', force: true, note: "Antiga Cadeia da Relação (1765): three-storey granite prison and court, about 20 m; no published height. OSM building:levels=3 (9.6 m) counts one range, overridden." },
  'almeida-garrett': { m: 14, source: 'estimate', note: "Casa natal de Almeida Garrett: 18th c. granite house, about 14 m; no published height." },
  'museu-misericordia': { m: 18, source: 'estimate', note: "Museu e Igreja da Misericórdia: Baroque church with a museum wing, about 18 m; no published height." },
  'parque-cidade': { m: 6, source: 'estimate', note: "Parque da Cidade (1993): flat coastal park; the low pavilions/cafe are the only built elements, estimated 6 m (no mapped building in OSM)." },
  'cordoaria': { m: 6, source: 'estimate', note: "Jardim da Cordoaria (1865): flat romantic garden; the bandstand and sculptures rise to about 6 m." },
  'sao-lazaro': { m: 8, source: 'estimate', note: "Jardim de São Lázaro (1834): flat garden; the cast-iron Coreto bandstand rises to about 8 m." },
  'passeio-alegre': { m: 8, source: 'estimate', note: "Jardim do Passeio Alegre: flat riverside garden; the Coreto and the 18th c. fountain rise to about 8 m." },
  'praca-batalha': { m: 25, source: 'estimate', note: "Praça da Batalha is a flat square; the tall element is the adjacent Teatro Nacional São João / Igreja de Santo Ildefonso frontage, about 25 m." },
  'castelo-queijo': { m: 12, source: 'estimate', note: "Forte de São Francisco Xavier do Queijo (1662): low star fort with a gatehouse, about 12 m; no published height." },
  'praia-ingleses': { m: 2, source: 'estimate', note: "Praia dos Ingleses is a flat sandy beach; nominal 2 m for the dune/beach profile, no built element." },
  'sealife-porto': { m: 12, source: 'estimate', force: true, note: "Sea Life Porto (2009): two-storey aquarium block, about 12 m; no published height. OSM building:levels=2 (6.4 m) counts the low wing, overridden." },
  // >>> ROSTER-HEIGHTS-2 (generated)
  bessa: { m: 30, source: 'estimate', note: 'Estádio do Bessa Século XXI (2003 rebuild, Grupo 3 + Ferreira Arquitectos): single-tier bowl with a continuous roof, about 30 m above the pitch. No published height; scaled from the 2003 stands against the 175 x 200 m OSM bowl.' },
  'teatro-sa-da-bandeira': { m: 22, source: 'estimate', note: 'Teatro Sá da Bandeira (1859, later a cinema): tall auditorium block with a roof plant, about 22 m. No published height.' },
  'teatro-nacional-sao-joao': { m: 26, source: 'estimate', note: 'Teatro Nacional São João (José Marques da Silva, 1918-1920): monumental theatre block with a fly tower over the stage; about 26 m. No published height.' },
  'igreja-da-vitoria': { m: 20, source: 'estimate', note: 'Igreja de Nossa Senhora da Vitória (1524, rebuilt 18th-19th c.): single nave with a tiled front; about 20 m. No published height.' },
  'igreja-carmelitas': { m: 25, source: 'estimate', note: 'Igreja das Carmelitas (1619-1622), the Carmo\u2019s twin: nave with a front, about 25 m (same order as the adjacent Carmo, whose twin towers are set at 25 m). No published height.' },
  'casa-museu-marta-ortigao-sampaio': { m: 12, source: 'estimate', note: 'Casa-Museu Marta Ortigão Sampaio: a two-storey 19th-century house on Nossa Senhora de Fátima, about 12 m. No published height; the museum is mapped only as a node.' },
  'mercado-matosinhos': { m: 15, source: 'estimate', force: true, note: 'Mercado Municipal de Matosinhos (project 1936, opened 1952): large market hall with two levels (OSM building:levels=2 gives only 6.4 m); the tall roof ridge is about 15 m. No published height.' },
  'camara-matosinhos': { m: 14, source: 'estimate', force: true, note: 'Câmara Municipal de Matosinhos: low civic block, but the glazed atrium/entrance block rises above the two office levels (OSM building:levels=2); about 14 m. No published height.' },
  'farol-leca': { m: 46, source: 'osm height tag', on: 'w1424430396', force: true, note: 'Farol de Leça (1926): 46 m, OSM height=46 on the tower way; Wikidata Q10280159 P2048 = 46 m. The OSM close-up way is 8 m square, so 46 m is the tower.' },
  'paco-episcopal': { m: 26, source: 'estimate', force: true, note: 'Paço Episcopal do Porto (Nicolau Nasoni, rebuilt 1734-1745): seven levels around a courtyard (OSM building:levels=7 gives only 22.4 m); the rooftop and the great staircase block about 26 m. No published height.' },
  // <<< ROSTER-HEIGHTS-2
};

export const HEIGHTS_BY_CITY = { braga: BRAGA, guimaraes: GUIMARAES, porto: PORTO };
export const HEIGHTS = HEIGHTS_BY_CITY[CITY.id] || {};
