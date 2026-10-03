// Jardim do Morro (laid out 1927), Vila Nova de Gaia — the terraced viewpoint
// garden at the foot of the Serra do Pilar, beside the upper deck of the Luís
// I bridge. A famous miradouro over the historic centre of Porto, with a lake,
// a grotto, a bandstand (coreto), a run of 22 lime trees along the Avenida da
// República and, close by, the Gaia cable-car terminus (2011). Requalified in
// 2016 (amphitheatre, senior park, cafeteria); the lake and grotto were kept.
//
// Drawn in its own metres and sized onto the OSM footprint by site-fit.js: the
// model fills the outline's local bounding box (102.44 x 195.90 m locally) so
// the fit is 1:1, with the height normalised to the 5 m nominal dims. With no
// footprint the authored fallback size (102.3 x 197.2 m) is kept. The whole
// model stays within the 5 m nominal height (flat terraced garden).
import { PROFILES } from '../kit.js';
import { bbox } from '../geom.js';
import { fitTo } from './site-fit.js';

const EXT_W = 102.438;  // OSM outline local bbox, across the garden
const EXT_D = 195.904;  // OSM outline local bbox, front (+z) to back
const H = 5;            // dims nominal height

function blob(cx, cz, r, n, wob) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 + wob * Math.sin(a * 3 + 0.7));
    p.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
  }
  return p;
}

function builder(k, site) {
  const o = site?.footprint?.outline;
  const b = o && o.length >= 3 ? bbox(o) : null;
  const BW = b ? b.w : 102.3;
  const BD = b ? b.d : 197.2;
  const authored = b ? { w: b.w, d: b.d, h: H, cx: b.cx, cz: b.cz } : { w: BW, d: BD, h: H, cx: 0, cz: 0 };
  const done = fitTo(k, site, authored, b || undefined);

  const hx = BW / 2;
  const hz = BD / 2;
  const rnd = k.rnd;

  // ------------------------------------------------- garden ground
  k.begin('ground');
  k.prism([[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]], -0.35, 0.35, 'grass');
  k.prism([[-hx + hx * 0.12, -hz * 0.92], [hx * 0.88, -hz * 0.92], [hx * 0.88, -hz * 0.86], [-hx + hx * 0.12, -hz * 0.86]], 0, 0.12, 'sand');
  k.prism([[-hx + hx * 0.12, hz * 0.86], [hx * 0.88, hz * 0.86], [hx * 0.88, hz * 0.92], [-hx + hx * 0.12, hz * 0.92]], 0, 0.12, 'sand');
  k.prism([[-hx * 0.08, -hz * 0.92], [hx * 0.08, -hz * 0.92], [hx * 0.08, hz * 0.92], [-hx * 0.08, hz * 0.92]], 0, 0.12, 'sand');
  k.end('ground');

  // ------------------------------------------------- main: the terraces,
  // the peripheral parapets and the coreto — this group carries the garden's
  // whole footprint and its 5 m nominal top.
  k.begin('main');
  k.box(2 * hx - 0.6, 1.1, 0.6, 'graniteLight', 0, 0, hz - 0.3);
  k.box(2 * hx - 0.6, 1.1, 0.6, 'graniteLight', 0, 0, -hz + 0.3);
  k.box(0.6, 1.1, 2 * hz - 0.6, 'graniteLight', hx - 0.3, 0, 0);
  k.box(0.6, 1.1, 2 * hz - 0.6, 'graniteLight', -hx + 0.3, 0, 0);
  k.balustrade(2 * hx - 8, 1.0, 'graniteLight', 0, 1.0, -hz + 0.9, { cheap: true, d: 0.24, sp: 0.55, posts: 8 });
  k.prism([[-hx + 4, hz - hz * 0.13], [hx - 4, hz - hz * 0.13], [hx - 4, hz - hz * 0.02], [-hx + 4, hz - hz * 0.02]], 0, 0.8, 'graniteDark');
  k.prism([[-hx + 4.6, hz - hz * 0.129], [hx - 4.6, hz - hz * 0.129], [hx - 4.6, hz - hz * 0.022], [-hx + 4.6, hz - hz * 0.022]], 0, 0.85, 'grass');

  // coreto (bandstand), top exactly at the 5 m nominal height
  const cz = hz * 0.35;
  k.cyl(4.0, 4.2, 0.7, 16, 'graniteLight', 0, 0, cz);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    k.lathe(PROFILES.column, 8, 'graniteLight', Math.cos(a) * 3.3, 0.7, cz + Math.sin(a) * 3.3, { sr: 0.16, sh: 3.3, smooth: true });
  }
  k.cyl(4.2, 4.2, 0.4, 16, 'graniteLight', 0, 4.0, cz);
  k.cone(4.3, 0.6, 16, 'terracotta', 0, 4.4, cz);
  k.end('main');

  // ------------------------------------------------- the lake and grotto
  k.begin('lake');
  k.prism(blob(-hx * 0.47, -hz * 0.47, hx * 0.31, 20, 0.18), 0, 0.25, 'water', { emit: 0.05 });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    k.ico(0.9 + rnd() * 0.6, 0, 'graniteDark', -hx * 0.47 + Math.cos(a) * hx * 0.21, 0.1, -hz * 0.47 + Math.sin(a) * hz * 0.08, { jitter: 0.3 });
  }
  k.ico(3.0, 1, 'graniteDark', -hx * 0.47, 0, -hz * 0.61, { jitter: 0.25 });
  k.end('lake');

  // ------------------------------------------------- amphitheatre (2016)
  k.begin('amphitheatre');
  const ax = hx * 0.47;
  const az = -hz * 0.45;
  for (let s = 0; s < 3; s++) {
    k.prism(blob(ax, az, 10 - s * 2.4, 16, 0.02), s * 0.45, 0.4, s === 2 ? 'sand' : 'graniteLight');
  }
  k.end('amphitheatre');

  // ------------------------------------------------- planting: the avenue
  // of 22 lime trees and scattered topiary
  k.begin('trees');
  for (let i = 0; i < 22; i++) {
    const tz = -hz * 0.86 + (i * (hz * 1.72)) / 21;
    k.tree(-hx * 0.84, 0, tz, 4.4 + (i % 3) * 0.15, { crown: 'oval', lobes: 1 });
  }
  const spots = [[-0.30, 0.10], [0.30, 0.10], [-0.34, -0.06], [0.34, -0.06], [-0.12, 0.30], [0.12, 0.30], [-0.40, 0.36], [0.40, 0.36], [-0.18, -0.41], [0.18, -0.41]];
  for (let i = 0; i < spots.length; i++) {
    k.tree(spots[i][0] * BW, 0, spots[i][1] * BD, 3.6 + (i % 4) * 0.3, { crown: i % 2 ? 'round' : 'topiary', kind: i % 3 === 0 ? 'topiary' : 'round', lobes: 1 });
  }
  k.end('trees');

  // ------------------------------------------------- cafeteria (2016)
  k.begin('cafeteria');
  k.box(12, 3.2, 7, 'plaster', -hx * 0.53, 0, hz * 0.84);
  k.push({ x: -hx * 0.53, z: hz * 0.84 });
  k.hipRoof(12, 7, 1.4, 'terracotta', 0, 3.2, 0, { over: 0.6 });
  k.pop();
  k.box(13, 0.3, 8, 'graniteLight', -hx * 0.53, 3.5, hz * 0.84);
  k.end('cafeteria');

  // ------------------------------------------------- benches and lamps
  const lamps = [[-0.59, 0], [0, -0.71], [0, 0.71], [0.59, 0], [-0.59, 0.82], [0.59, -0.82]];
  for (const [lx, lz] of lamps) k.lamp(3.6, lx * BW * 0.5, 0, lz * BD * 0.5, { globe: true });
  for (const [bx, bz, br] of [[-0.16, 0, 0], [0.16, 0, 0], [0, -0.5, Math.PI / 2], [0, 0.5, Math.PI / 2]]) {
    k.box(2.0, 0.45, 0.55, 'wood', bx * BW, 0, bz * BD, { ry: br });
    k.box(2.0, 0.45, 0.55, 'wood', bx * BW, 0.45, bz * BD - 0.28, { ry: br });
  }

  // --- detail: a grotto footbridge, box parterres and a viewpoint statue
  k.box(6.4, 0.4, 1.6, 'graniteLight', -hx * 0.47, 0.9, -hz * 0.47);
  for (const s of [-1, 1]) {
    k.cyl(0.8, 0.85, 0.6, 8, 'graniteDark', -hx * 0.47 + s * 1.8, 0.5, -hz * 0.47);
    k.box(0.3, 1.0, 1.9, 'graniteLight', -hx * 0.47 + s * 2.8, 0.9, -hz * 0.47);
  }
  for (const [px, pz] of [[-0.2, 0.2], [0.2, 0.2], [-0.2, -0.25], [0.2, -0.25]]) {
    k.box(6.0, 0.5, 1.0, 'hedge', px * BW, 0, pz * BD);
    k.box(6.4, 0.16, 1.4, 'sand', px * BW, 0, pz * BD);
  }
  k.box(1.8, 1.5, 1.8, 'graniteLight', -hx * 0.60, 0.8, -hz + 1.0);
  k.statue(2.2, 'graniteLight', -hx * 0.60, 2.3, -hz + 1.0, { pose: 'down' });

  done();
}

builder.metric = true;
builder.rule = {
  note: 'Jardim do Morro: terraced viewpoint garden (1927), lake, grotto, coreto, 22 lime trees; site-fit onto the OSM outline (102.4 x 195.9 m), within the 5 m nominal height',
  extent: { box: { x0: -EXT_W / 2, x1: EXT_W / 2, z0: -EXT_D / 2, z1: EXT_D / 2 } },
  frame: { x0: -EXT_W / 2, x1: EXT_W / 2, z0: -EXT_D / 2, z1: EXT_D / 2, y0: 0 },
};

export default { 'jardim-do-morro': builder };
