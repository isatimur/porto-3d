// Batalha Centro de Cinema (Porto): the 1947 Art Deco cinema by Artur Andrade
// on Praça da Batalha — a low block carrying a tall vertical tower-facade with
// rounded fins, a glazed entrance and a projecting marquee. 950-seat hall.
import { corniceProfile } from '../kit.js';
import { win } from '../parts.js';
import { rect } from '../geom.js';
import { fitTo } from './site-fit.js';

function cinemaBatalha(k, site) {
  const W = 28.1;
  const D = 38.9;
  const H = 22;
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  const bodyH = 16;
  const zF = D / 2;
  const zB = -D / 2;

  // main auditorium block
  k.prism(rect(0, 0, W, D), 0, bodyH, 'cream');
  k.box(W + 0.9, 0.9, D + 0.9, 'granite', 0, 0, 0);
  k.corniceRing(W, D, corniceProfile('band', 0.55), 'graniteLight', 0, bodyH - 0.2, 0);
  k.prism(rect(0, 0, W - 1.2, D - 1.2), bodyH, 0.35, 'lead');
  // rounded corner to the plaza (the cinema faces the corner of the square)
  k.cyl(3.0, 3.0, bodyH, 16, 'cream', W * 0.34, 0, zF - 3.0);

  // ---- tall vertical tower-facade, front-right
  const tw = 9.4;
  const tx = W * 0.2;
  k.box(tw, H, 7.2, 'cream', tx, 0, zF - 3.6);
  // rounded vertical fins across the tower face
  for (let i = 0; i < 5; i++) {
    const x = tx - tw / 2 + 1.0 + i * ((tw - 2.0) / 4);
    k.cyl(0.42, 0.42, H - 4.4, 8, 'graniteLight', x, 4.4, zF + 0.15, { mat: 8 });
  }
  // stepped tower crown
  k.box(tw + 0.5, 1.1, 7.7, 'graniteLight', tx, H - 1.1, zF - 3.6);
  k.box(tw * 0.72, 1.0, 6.2, 'cream', tx, H, zF - 3.6);
  // vertical name band over the tower
  k.box(1.6, 7.0, 0.4, 'graniteLight', tx, 6.5, zF + 0.35);

  // ---- glazed entrance and marquee on the left of the facade
  const ex = -W * 0.18;
  k.box(7.6, 5.0, 0.9, 'glass', ex, 0, zF + 0.25, { mat: 0, emit: 0.14 });
  k.box(8.8, 0.5, 0.4, 'iron', ex, 3.4, zF + 0.9);
  k.box(8.8, 0.4, 0.3, 'iron', ex, 3.2, zF + 1.4);
  k.box(9.6, 0.9, 2.4, 'graniteLight', ex, 5.0, zF + 1.0);
  for (const sx of [-1, 1]) win(k, ex + sx * 1.9, 0.9, 1.7, 3.4, zF + 0.7, { trim: 'graniteLight', pane: 'glass', bw: 0.24, depth: 0.3 });
  k.lamp(4.2, ex - 6.2, 0, zF + 1.5);
  k.lamp(4.2, ex + 6.2, 0, zF + 1.5);

  // ---- long flanks: ribbon-like storeys of glazing
  const flank = (sx) => {
    k.push({ x: sx * W / 2, z: 0, ry: sx * Math.PI / 2 });
    const n = 6;
    for (let i = 0; i < n; i++) {
      const u = -D / 2 + 4.5 + i * ((D - 9) / (n - 1));
      for (const yy of [1.7, 5.4, 9.1]) {
        win(k, u, yy, 1.8, 2.4, 0, { trim: 'graniteLight', pane: 'glass', bw: 0.26, depth: 0.3, sill: true });
      }
    }
    k.pop();
  };
  flank(-1);
  flank(1);
  // ---- back face
  k.push({ z: zB, ry: Math.PI });
  for (const sx of [-1, 0, 1]) for (const yy of [3.0, 6.7, 10.4]) {
    win(k, sx * 7, yy, 1.9, 2.5, 0, { trim: 'graniteLight', pane: 'glass', bw: 0.28, depth: 0.3, sill: true });
  }
  k.pop();

  // ---- rooftop esplanade: a parapet balustrade round the block
  for (const [sx, sz, ry, len] of [
    [0, D / 2 - 0.9, 0, W - 1.6],
    [0, -D / 2 + 0.9, Math.PI, W - 1.6],
    [W / 2 - 0.9, 0, Math.PI / 2, D - 1.6],
    [-W / 2 + 0.9, 0, -Math.PI / 2, D - 1.6],
  ]) {
    k.push({ x: sx, y: bodyH, z: sz, ry });
    k.balustrade(len, 0.95, 'graniteLight', 0, 0, 0, { cheap: true, d: 0.2, sp: 0.5 });
    k.pop();
  }

  // --- detail pass: fin grooves, a vertical name sign and marquee bulbs
  for (let i = 0; i < 5; i++) {
    const x = tx - tw / 2 + 1.0 + i * ((tw - 2.0) / 4);
    k.box(0.14, H - 5.0, 0.5, 'white', x, 4.4, zF + 0.32);
  }
  for (let i = 0; i < 10; i++) k.sphere(0.11, 'white', ex - 4.5 + i, 3.75, zF + 1.5, { seg: 5, rings: 3, emit: 0.5 });
  k.box(0.5, 6.4, 0.3, 'graniteLight', ex, 7.4, zF + 0.5);
  k.box(2.0, 0.45, 0.3, 'window', ex, 10.0, zF + 0.55, { emit: 0.4 });
  k.cyl(0.4, 0.4, H - 4.4, 8, 'graniteLight', tx + tw * 0.34, 4.4, zF + 0.15, { mat: 8 });

  done();
}
cinemaBatalha.metric = true;
cinemaBatalha.rule = {
  note: 'Batalha Centro de Cinema: Art Deco block + vertical tower facade, 28.1 x 38.9 m, 22 m',
  extent: { box: { x0: -14.1, x1: 14.1, z0: -19.5, z1: 19.5 } },
  fitTo: true,
};
export default { 'cinema-batalha': cinemaBatalha };
