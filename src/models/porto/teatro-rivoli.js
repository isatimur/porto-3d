// Teatro Municipal Rivoli (Porto): the 1913/1923 theatre on Praça de D. João I.
// A long five-storey Art Deco street block with a tall auditorium fly tower
// behind, pilastered facades, a glazed entrance bay and a projecting marquee.
import { corniceProfile } from '../kit.js';
import { win } from '../parts.js';
import { rect } from '../geom.js';
import { fitTo } from './site-fit.js';

function teatroRivoli(k, site) {
  const W = 22.5;
  const D = 82.1;
  const H = 25;
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  const bodyH = 17;      // five-storey street block
  const zF = D / 2;
  const zB = -D / 2;

  // street block
  k.prism(rect(0, 0, W, D), 0, bodyH, 'cream');
  k.box(W + 0.9, 1.0, D + 0.9, 'granite', 0, 0, 0);
  k.corniceRing(W, D, corniceProfile('eave', 0.5), 'granite', 0, bodyH - 0.4, 0);
  // flat roof parapet
  k.corniceRing(W, D, corniceProfile('band', 0.5), 'graniteLight', 0, bodyH, 0);
  k.prism(rect(0, 0, W - 1.2, D - 1.2), bodyH, 0.4, 'lead');

  // ---- auditorium fly tower rising over the back of the block
  k.box(W * 0.84, H - bodyH, 26, 'cream', 0, bodyH, -D * 0.22);
  k.box(W * 0.84 + 0.8, 0.7, 26.6, 'granite', 0, H - 0.7, -D * 0.22);
  for (const sx of [-1, 1]) for (const zz of [-D * 0.22 - 9, -D * 0.22 + 9]) {
    k.box(0.7, H - bodyH - 1, 0.7, 'graniteLight', sx * (W * 0.42 - 0.4), bodyH, zz);
  }
  k.box(0.3, 3.5, 1.2, 'iron', W * 0.2, H, -D * 0.22);
  k.box(0.3, 3.5, 1.2, 'iron', -W * 0.2, H, -D * 0.22);

  // ---- front facade (+z): Art Deco pilasters and a glazed entrance bay
  for (let i = 0; i < 6; i++) {
    const x = -W / 2 + 1.1 + i * ((W - 2.2) / 5);
    k.box(0.9, bodyH - 4.6, 0.9, 'graniteLight', x, 4.6, zF + 0.35);
  }
  // stepped parapet over the centre
  for (let i = 0; i < 3; i++) {
    k.box(W * (0.5 - i * 0.13), 1.3, 1.0, 'graniteLight', 0, bodyH + i * 1.3, zF - 0.1);
  }
  // glazed entrance bay and marquee
  k.box(7.2, 4.6, 0.8, 'glass', 0, 0, zF + 0.3, { mat: 0, emit: 0.12 });
  k.box(8.4, 0.5, 0.5, 'iron', 0, 3.2, zF + 0.9);
  k.box(8.4, 0.35, 0.35, 'iron', 0, 3.0, zF + 1.35);
  for (const sx of [-1, 1]) k.box(7.4, 0.9, 2.2, 'graniteLight', 0, 4.6, zF + 1.0);
  k.push({ z: zF + 0.2 });
  for (const sx of [-1, 1]) win(k, sx * 5.6, 5.6, 2.2, 8.5, 0.2, { trim: 'graniteLight', pane: 'glass', bw: 0.3, depth: 0.35, head: 'flat' });
  k.pop();
  k.lamp(4.5, -W * 0.36, 0, zF + 1.6);
  k.lamp(4.5, W * 0.36, 0, zF + 1.6);

  // ---- long flanks: four storeys of windows between the pilasters
  const flank = (sx) => {
    k.push({ x: sx * W / 2, z: 0, ry: sx * Math.PI / 2 });
    const n = 9;
    for (let i = 0; i < n; i++) {
      const u = -D / 2 + 6 + i * ((D - 12) / (n - 1));
      for (const yy of [1.6, 5.2, 8.8, 12.4]) {
        win(k, u, yy, 1.7, 2.4, 0, { trim: 'graniteLight', pane: 'glass', bw: 0.26, depth: 0.32, sill: true });
      }
    }
    k.pop();
  };
  flank(-1);
  flank(1);
  // ---- back face
  k.push({ z: zB, ry: Math.PI });
  for (const sx of [-1, 0, 1]) for (const yy of [3.4, 7.0, 10.6]) {
    win(k, sx * 6, yy, 2.0, 2.6, 0, { trim: 'graniteLight', pane: 'glass', bw: 0.3, depth: 0.32, sill: true });
  }
  k.pop();

  // ---- roof parapet balustrade
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

  done();
}
teatroRivoli.metric = true;
teatroRivoli.rule = {
  note: 'Teatro Rivoli: five-storey Art Deco theatre block + fly tower, 22.5 x 82.1 m, 25 m',
  extent: { box: { x0: -11.3, x1: 11.3, z0: -41.1, z1: 41.1 } },
  fitTo: true,
};
export default { 'teatro-rivoli': teatroRivoli };
