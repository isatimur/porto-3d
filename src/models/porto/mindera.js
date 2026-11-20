// Mindera's Porto office: the Centro Empresarial Mapfre, Rua de Gonçalo
// Cristóvão 347 (mindera.com/locations; OSM way 285901827). The street front
// faces north: a grey stone frame of four piers with three tall glazed bays,
// a stone block with the owner's emblem on its west end, and a blue glass
// block of three storeys over the frame. Behind it a lower wing runs south
// on the wedge of the plot, with roof terraces.
//
// Sources for the look: the owner's street photo and terrace photos
// (edificiosmapfre.com, seen 2026-11-20). Heights are estimates (no published
// figure; data/dimensions.json says so). The south wing cannot be seen from
// the street photo: its height and its plain glazed walls are an assumption.
// The building carries no Mindera sign in that photo, so none is drawn.
//
// Local frame (fit.js): +z is the street front (north), +x is west.
import { flatWindow } from '../parts.js';
import { fitTo } from './site-fit.js';

const W = 43.6;
const D = 65.1;
const H = 30;

// colours read from the owner's photos
const STONE = 0xb9b7ae; // light grey stone panels
const STONE_JOINT = 0x9a988f;
const BLUE = 0x2b63a8; // the reflective blue curtain wall
const BLUE_LINE = 0x1b4279;
const DARK_GLASS = 0x1b2a3c; // the glazing in the shade of the frame
const DARK_LINE = 0x31445a;
const RED = 0xc4122f; // the owner's red band over the entrance
const DECK = 0x9a8468;

// plan polygons, metres ([x, z]); the OSM outline cut in two along z = 2.2
const NORTH = [[10.7, 32.4], [10.8, 24.9], [11.1, 18.2], [11.5, 10.2], [12.2, 6.3], [13.5, 2.2], [-20.8, 2.2], [-21.8, 32.0], [-17.4, 32.1], [0.7, 32.3]];
const SOUTH = [[13.5, 2.2], [15.3, -1.7], [17.5, -4.8], [21.8, -10.2], [-6.5, -32.6], [-20.7, -0.3], [-20.8, 2.2]];
// the north block under the blue one: its street wall stands 2.2 m back
// between the east end and the stone block, behind the piers (the glazing)
const LOWER = [[10.7, 32.4], [10.8, 24.9], [11.1, 18.2], [11.5, 10.2], [12.2, 6.3], [13.5, 2.2], [-20.8, 2.2], [-21.7, 30.1], [0.4, 30.1], [0.4, 32.3], [0.7, 32.3]];
// the blue block: the north block without the stone block's corner
const UPPER = [[0.4, 32.3], [0.4, 23.4], [10.9, 23.4], [11.1, 18.2], [11.5, 10.2], [12.2, 6.3], [13.5, 2.2], [-20.8, 2.2], [-21.8, 32.0], [-17.4, 32.1]];

const FRAME_H = 20; // underside of the stone lintel
const LINTEL = 1.4;
const UPPER_Y = FRAME_H + LINTEL; // 21.4: the blue block starts here
const TOWER_H = 26.3;
const SOUTH_H = 18.5;
const ZF = 32.3; // the street face

// A grid of thin bars on a wall that runs from a to b ([x, z]) and faces
// outward as edgesOf() says (a street edge runs towards +x): verticals every
// `bay`, horizontals at ys.
function grid(k, a, b, y0, y1, bay, ys, color, o = {}) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1) return;
  const t = o.t ?? 0.12;
  const out = o.out ?? 0.06;
  k.push({ x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, ry: Math.atan2(-(b[1] - a[1]), b[0] - a[0]) });
  const n = Math.max(1, Math.round(len / bay));
  for (let i = 0; i <= n; i++) k.box(t, y1 - y0, t, color, -len / 2 + (len * i) / n, y0, out);
  for (const y of ys) k.box(len, t, t, color, 0, y - t / 2, out);
  k.pop();
}

// every edge of a plan polygon whose outward normal passes `keep`
function edgesOf(pts, keep) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.5) continue;
    // the way the polygons above run, the outward normal of a -> b is
    // (-dz, dx) / len (the street edge runs towards +x and faces +z)
    const nx = -(b[1] - a[1]) / len;
    const nz = (b[0] - a[0]) / len;
    if (!keep || keep(nx, nz, len)) out.push({ a, b, nx, nz, len });
  }
  return out;
}

function mindera(k, site) {
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  // ---- plinth and the two bodies
  k.prism([...NORTH.slice(0, 6), ...SOUTH.slice(1), ...NORTH.slice(7)], 0, 0.5, STONE_JOINT);
  k.begin('main');
  // the north block under the blue one: stone side walls
  k.prism(LOWER, 0.5, UPPER_Y - 0.5, STONE, { mat: 8 });
  k.prism(NORTH, UPPER_Y - 0.3, 0.3, STONE, { mat: 8 }); // the soffit over the bays
  // the blue glass block over the frame, three storeys
  k.prism(UPPER, UPPER_Y, H - UPPER_Y - 0.4, BLUE, { mat: 8, emit: 0.06 });
  k.prism(UPPER, H - 0.4, 0.4, STONE_JOINT); // roof edge
  // the south wing on the wedge of the plot (assumed look, see the head)
  k.prism(SOUTH, 0.5, SOUTH_H - 0.5, STONE, { mat: 8 });
  k.end('main');

  // panel lines of the blue block on every face, at each storey
  const storeyU = (H - 0.4 - UPPER_Y) / 3;
  const linesU = [1, 2].map((i) => UPPER_Y + storeyU * i);
  for (const e of edgesOf(UPPER)) grid(k, e.a, e.b, UPPER_Y, H - 0.4, 1.85, [UPPER_Y + 0.1, ...linesU], BLUE_LINE, { out: 0.05 });
  // the open loggia in the blue block beside the stone block (owner's photo)
  k.box(3.4, storeyU - 0.5, 0.5, DARK_GLASS, -1.5, UPPER_Y + 0.2, ZF - 0.1, { emit: 0.02 });
  k.box(3.4, 0.12, 0.6, 'steel', -1.5, UPPER_Y + 1.25, ZF + 0.05);

  // ---- the stone block on the west end of the front
  const tx = 5.65;
  const tw = 10.5;
  const td = 9.0;
  k.box(tw, TOWER_H - 0.5, td, STONE, tx, 0.5, ZF - td / 2 + 0.15, { mat: 8 });
  k.box(tw + 0.2, 0.3, td + 0.2, STONE_JOINT, tx, TOWER_H, ZF - td / 2 + 0.15);
  // panel joints: rows every 1.9 m, columns every 1.3 m, on the street face
  // and on the west return
  const rows = [];
  for (let y = 2.4; y < TOWER_H; y += 1.9) rows.push(y);
  grid(k, [tx - tw / 2, ZF + 0.15], [tx + tw / 2, ZF + 0.15], 0.5, TOWER_H, 1.3, rows, STONE_JOINT, { t: 0.07, out: 0.03 });
  grid(k, [tx + tw / 2, ZF + 0.15], [tx + tw / 2, ZF - td + 0.15], 0.5, TOWER_H, 1.3, rows, STONE_JOINT, { t: 0.07, out: 0.03 });
  // the owner's emblem (a ring with a mark) and three lines of lettering,
  // drawn as plain bars: the wording is not legible at this scale
  const ez = ZF + 0.22;
  k.cyl(1.15, 1.15, 0.12, 24, 'iron', tx, 19.4, ez, { rx: Math.PI / 2, smooth: true });
  k.cyl(0.92, 0.92, 0.14, 24, STONE, tx, 19.4, ez + 0.02, { rx: Math.PI / 2, smooth: true });
  k.box(1.2, 0.2, 0.1, 'iron', tx, 19.75, ez + 0.08);
  k.box(0.2, 0.7, 0.1, 'iron', tx, 18.95, ez + 0.08);
  for (const [w, y] of [[3.6, 17.5], [6.4, 16.75], [3.2, 16.0]]) k.box(w, 0.42, 0.1, 'iron', tx, y, ez);

  // ---- the stone frame: four piers and the lintel
  const x0 = -21.5; // the east end of the front
  const x1 = tx - tw / 2; // the stone block's east face
  const pierW = 1.5;
  const bayW = (x1 - x0 - pierW * 3) / 3;
  const piers = [0, 1, 2].map((i) => x0 + pierW / 2 + i * (pierW + bayW));
  for (const px of piers) {
    k.box(pierW, FRAME_H - 0.5, 1.6, STONE, px, 0.5, ZF - 0.65, { mat: 8 });
    for (let y = 2.4; y < FRAME_H; y += 1.9) k.box(pierW + 0.04, 0.07, 1.64, STONE_JOINT, px, y, ZF - 0.65);
  }
  k.box(x1 - x0, LINTEL, 2.0, STONE, (x0 + x1) / 2, FRAME_H, ZF - 0.85, { mat: 8 });
  // the stone side wall on the east end, above the neighbour
  for (let y = 2.4; y < UPPER_Y; y += 1.9) k.box(0.07, 0.07, 28, STONE_JOINT, -21.35, y, 17.5);

  // ---- the glazing in the three bays, set back behind the piers
  const zg = ZF - 1.9;
  k.box(x1 - x0, FRAME_H - 0.5, 0.3, DARK_GLASS, (x0 + x1) / 2, 0.5, zg, { mat: 8, emit: 0.1 });
  const floors = [];
  for (let y = 4.9; y < FRAME_H; y += 3.4) floors.push(y);
  piers.forEach((px, i) => {
    const a = px + pierW / 2;
    const b = i < 2 ? piers[i + 1] - pierW / 2 : x1;
    grid(k, [a, zg + 0.15], [b, zg + 0.15], 0.5, FRAME_H, 1.75, floors, DARK_LINE, { t: 0.1, out: 0.04 });
  });
  // lit office floors behind the glass, a few panes
  for (const [fx, fy] of [[-17, 6.2], [-9.5, 9.6], [-12, 13], [-3, 6.2], [-16, 16.4], [-5.5, 13]]) flatWindow(k, fx, fy, 1.5, 2.2, zg + 0.24, { trim: DARK_LINE, pane: 'window', emit: 0.5, frame: 0.05 });

  // ---- the entrance: the red band, the canopy and the glass doors
  const bandX0 = piers[1] + pierW / 2;
  const bandX1 = x1 - 2.6;
  k.box(bandX1 - bandX0, 1.0, 0.5, RED, (bandX0 + bandX1) / 2, 3.7, ZF - 1.1, { mat: 8 });
  k.box(bandX1 - bandX0, 0.16, 2.2, RED, (bandX0 + bandX1) / 2, 3.6, ZF - 0.6, { mat: 8 });
  k.box(2.6, 0.16, 0.12, 'white', (bandX0 + bandX1) / 2, 4.1, ZF - 0.82); // the wordmark, as a bar
  k.box(5.0, 3.1, 0.2, 0x35506a, x1 - 3.4, 0.5, zg + 0.3, { mat: 8, emit: 0.22 });
  for (const dx of [-1.25, 0, 1.25]) k.box(0.08, 3.1, 0.26, 'steel', x1 - 3.4 + dx, 0.5, zg + 0.32);
  // the free-standing red and white sign post by the door
  k.box(0.9, 2.0, 0.9, 'white', bandX0 + 1.2, 0.5, ZF + 1.6);
  k.box(0.95, 0.9, 0.95, RED, bandX0 + 1.2, 2.5, ZF + 1.6, { mat: 8 });
  // the forecourt: steps, a strip of lawn and two clipped trees
  k.box(x1 - x0 - 2, 0.25, 2.6, STONE_JOINT, (x0 + x1) / 2, 0.25, ZF + 1.2);
  k.box(18, 0.12, 2.2, 'grass', -6, 0.0, ZF + 4.0);
  k.tree(-10.5, 0, ZF + 3.6, 4.2);
  k.tree(x1 + 9.5, 0, ZF + 3.2, 6.5);
  k.lamp(7.5, -18, 0, ZF + 3.4);

  // ---- the side and rear walls of the north block: bands of glazing
  const band = (pts, y0, y1, storey, keep) => {
    for (const e of edgesOf(pts, keep)) {
      const n = Math.floor((y1 - y0) / storey);
      k.push({ x: (e.a[0] + e.b[0]) / 2 + e.nx * 0.05, z: (e.a[1] + e.b[1]) / 2 + e.nz * 0.05, ry: Math.atan2(e.nx, e.nz) });
      for (let s = 0; s < n; s++) {
        flatWindow(k, 0, y0 + 1.0 + s * storey, e.len - 1.6, 1.7, 0, { trim: DARK_LINE, pane: 'glass', emit: 0.1, frame: 0.12 });
        const m = Math.max(1, Math.round((e.len - 1.6) / 1.8));
        for (let i = 1; i < m; i++) k.box(0.08, 1.7, 0.06, DARK_LINE, -(e.len - 1.6) / 2 + ((e.len - 1.6) * i) / m, y0 + 1.0 + s * storey, 0.03);
      }
      k.pop();
    }
  };
  // the west wall (faces +x) below the blue block
  band(NORTH, 0.5, UPPER_Y - 0.6, 3.4, (nx, nz, len) => nx > 0.7 && len > 3);

  // ---- the south wing's long glazed walls: the south-west face in blue glass, as the owner's
  // terrace photo shows; the north-east face in bands
  for (const e of edgesOf(SOUTH, (nx, nz, len) => len > 8 && nx > 0.3)) {
    k.push({ x: (e.a[0] + e.b[0]) / 2 + e.nx * 0.08, z: (e.a[1] + e.b[1]) / 2 + e.nz * 0.08, ry: Math.atan2(e.nx, e.nz) });
    k.box(e.len - 1.2, SOUTH_H - 4.4, 0.16, BLUE, 0, 3.6, 0, { mat: 8, emit: 0.06 });
    k.pop();
    const inset = 0.6 / e.len;
    const a = [e.a[0] + (e.b[0] - e.a[0]) * inset, e.a[1] + (e.b[1] - e.a[1]) * inset];
    const b = [e.b[0] - (e.b[0] - e.a[0]) * inset, e.b[1] - (e.b[1] - e.a[1]) * inset];
    const ys = [];
    for (let y = 7.0; y < SOUTH_H - 0.8; y += 3.4) ys.push(y);
    grid(k, [a[0] + e.nx * 0.16, a[1] + e.nz * 0.16], [b[0] + e.nx * 0.16, b[1] + e.nz * 0.16], 3.6, SOUTH_H - 0.8, 1.85, ys, BLUE_LINE, { out: 0.04 });
  }
  band(SOUTH, 0.5, SOUTH_H - 0.6, 3.4, (nx, nz, len) => len > 8 && nx <= 0.3 && nz < 0.9);

  // ---- roofs
  // the south wing's terrace: a timber deck, planters and a glass rail
  k.prism(SOUTH.map(([x, z]) => [x * 0.9 + 0.2, z * 0.9 - 1.2]), SOUTH_H, 0.12, DECK, { mat: 8 });
  for (const e of edgesOf(SOUTH, (nx, nz, len) => len > 8 && nz < 0.9)) {
    k.wallLine([e.a[0] - e.nx * 0.25, e.a[1] - e.nz * 0.25], [e.b[0] - e.nx * 0.25, e.b[1] - e.nz * 0.25], 1.0, 0.1, 'steel', SOUTH_H);
    const n = Math.floor(e.len / 5.5);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const px = e.a[0] + (e.b[0] - e.a[0]) * t - e.nx * 1.6;
      const pz = e.a[1] + (e.b[1] - e.a[1]) * t - e.nz * 1.6;
      k.box(2.4, 0.6, 0.9, DECK, px, SOUTH_H + 0.1, pz, { ry: Math.atan2(e.nx, e.nz), mat: 8 });
      k.box(2.2, 0.8, 0.7, 'hedge', px, SOUTH_H + 0.7, pz, { ry: Math.atan2(e.nx, e.nz) });
    }
  }
  // the stone-clad stair head that stands over the terrace (terrace photo)
  k.box(6.5, 4.2, 7.5, STONE, 0.5, SOUTH_H, -3.2, { mat: 8 });
  for (let y = SOUTH_H + 1.4; y < SOUTH_H + 4; y += 1.4) k.box(6.54, 0.06, 7.54, STONE_JOINT, 0.5, y, -3.2);
  // plant on the blue block's roof, behind a low screen
  k.box(9, 1.8, 6, 'steel', -6, H, 14);
  k.box(4, 1.2, 3, 'lead', 5, H, 9);
  for (const [ax, az] of [[-15, 22], [-12.5, 22], [-10, 22], [-15, 8], [-12.5, 8]]) k.box(1.4, 0.9, 1.1, 'steel', ax, H, az);
  // the stone block's roof: coping and a lift overrun
  k.box(3.2, 1.6, 3.2, STONE, tx + 2.5, TOWER_H + 0.3, ZF - td + 2.4, { mat: 8 });

  done();
}
mindera.metric = true;
mindera.rule = {
  note: 'Centro Empresarial Mapfre (Mindera Porto): stone frame, glazed bays, blue glass block and the south wing on the OSM outline, 43.6 x 65.1 m, 30 m',
  fitTo: true,
  extent: { box: { x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2 } },
};
export default { mindera };
