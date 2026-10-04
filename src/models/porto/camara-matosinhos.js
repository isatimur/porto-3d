// Câmara Municipal de Matosinhos. The town hall: a long, low horizontal civic
// block with banded floors and ribbon glazing, a taller glazed entrance atrium,
// a ceremonial canopy and the flag plaza in front. Authored 96 x 56.2 m, 14 m.
import { corniceProfile } from '../kit.js';
import { win, ribbonWindows, punchedWindows } from '../parts.js';
import { rect, offset } from '../geom.js';
import { polyCornice } from '../metric.js';
import { fitTo } from './site-fit.js';

function camaraMat(k, site) {
  const W = 96;
  const D = 56.2;
  const H = 14;
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  const bodyH = 9.5;
  const body = rect(0, 0, W, D);
  k.prism(offset(body, 0.5), 0, 1.2, 'graniteDark');
  k.prism(body, 0, bodyH, 'white');

  // horizontal floor bands and a deep cornice
  k.prism(offset(body, 0.35), 2.6, 0.5, 'graniteLight', { holes: [body] });
  k.prism(offset(body, 0.35), 5.6, 0.5, 'graniteLight', { holes: [body] });
  polyCornice(k, body, bodyH, corniceProfile('eave', 0.8), 'graniteLight');

  // ribbon glazing on three floors all round
  ribbonWindows(k, body, 0, { storeys: 3, storey: 3.2, first: 1.2, h: 1.2, trim: 'graniteLight', pane: 'glass', emit: 0.05 });

  // central glazed atrium rising over the entrance
  const fz = D / 2;
  k.prism(rect(0, fz - 8, 22, 16), 0, H, 'white');
  k.prism(rect(0, fz - 8, 21, 15), 1.0, H - 1.2, 'glass', { emit: 0.12 });
  for (let i = 0; i < 5; i++) {
    k.box(0.5, H, 0.5, 'graniteLight', -9 + i * 4.5, 0, fz - 0.2);
  }
  k.box(22, 0.7, 17, 'graniteLight', 0, H, fz - 8);
  for (let i = 0; i < 6; i++) k.box(0.3, 1.2, 0.3, 'iron', -9 + i * 3.6, H + 0.7, fz - 0.4);

  // glazed entrance and tall canopy
  k.wall(24, bodyH, 1.2, 'white', [
    { x: 0, y: 0, w: 5.0, h: 5.6, arch: 'round', pane: 'glass', inset: 0.4 },
    { x: -7, y: 0, w: 3.0, h: 4.6, arch: 'round', pane: 'glass', inset: 0.4 },
    { x: 7, y: 0, w: 3.0, h: 4.6, arch: 'round', pane: 'glass', inset: 0.4 },
  ], 0, 0, fz + 0.55);
  k.box(30, 0.6, 3.2, 'graniteLight', 0, bodyH + 0.6, fz + 1.4);
  for (const sx of [-1, 1]) for (const u of [-11, 11]) k.box(0.4, bodyH + 0.6, 0.4, 'iron', u, 0, fz + 2.8);
  k.stairs(24, 2.0, 0.8, 4, 'graniteLight', 0, 0, fz + 3.0, { below: 0.8 });

  // rear service wing and roof plant
  k.prism(rect(0, -D / 2 + 6, W - 20, 12), 0, bodyH + 1.4, 'white');
  for (let i = 0; i < 8; i++) {
    k.box(3.0, 1.6, 3.0, 'steel', -W / 2 + 12 + i * 10, bodyH + 1.4, -D / 2 + 6);
  }

  // plaza: paving, flagpoles, sculpture and trees
  k.prism(rect(0, 0, W + 22, D + 22), -0.12, 0.12, 'sand', { holes: [rect(0, 0, W + 6, D + 6)] });
  for (let i = 0; i < 3; i++) {
    k.box(0.14, 9, 0.14, 'steel', -6 + i * 6, 0, D / 2 + 8);
    k.box(1.4, 0.9, 0.08, 'flowerRed', -6 + i * 6, 9, D / 2 + 8);
  }
  k.box(3.0, 0.4, 3.0, 'graniteDark', 14, 0, D / 2 + 8);
  k.ico(2.4, 1, 'steel', 14, 3.0, D / 2 + 8, { soft: false });
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) {
    k.tree(sx * (W / 2 + 8), 0, -D / 2 + 8 + i * 13, 6, { crown: 'round' });
  }
  for (let i = 0; i < 5; i++) k.lamp(6, -W / 2 + 12 + i * 18, 0, D / 2 + 7, { globe: true });

  // --- detail pass: roof plant, mullions, plaza furniture and planting
  k.box(W - 2, 1.0, D - 2, 'graniteLight', 0, bodyH + 1.5, 0);
  for (let i = 0; i < 6; i++) k.box(5.0, 0.9, 3.0, 'steel', -W / 2 + 8 + i * 16, bodyH + 2.5, -D / 2 + 7);
  for (let i = 0; i < 4; i++) k.box(4.0, 0.12, 2.4, 'dark', -W / 2 + 8 + i * 18, bodyH + 3.4, -D / 2 + 7, { rz: 0.3 });
  // central atrium mullions and transoms
  for (let i = 0; i <= 5; i++) k.box(0.3, H - 1.2, 0.3, 'graniteLight', -10.5 + i * 4.2, 1.0, fz - 0.15);
  for (let j = 0; j < 4; j++) k.box(21, 0.25, 0.25, 'graniteLight', 0, 2.5 + j * 3.0, fz - 0.1);
  // plaza bollards, planters and benches
  for (let i = 0; i < 7; i++) {
    k.box(0.3, 0.9, 0.3, 'iron', -12 + i * 4, 0, D / 2 + 5.5);
    k.box(2.2, 0.6, 1.2, 'graniteLight', -W / 2 + 10 + i * 12, 0, D / 2 + 9);
    k.box(1.9, 0.9, 0.9, 'hedge', -W / 2 + 10 + i * 12, 0.6, D / 2 + 9);
  }
  for (const bx of [-20, 0, 20]) {
    k.box(2.0, 0.16, 0.5, 'wood', bx, 0.55, D / 2 + 5.0);
    k.box(0.16, 0.55, 0.16, 'iron', bx - 0.8, 0, D / 2 + 5.0);
    k.box(0.16, 0.55, 0.16, 'iron', bx + 0.8, 0, D / 2 + 5.0);
  }
  for (let i = 0; i < 4; i++) {
    k.box(0.14, 7.0, 0.14, 'steel', -14 + i * 9.3, 0, D / 2 + 13);
    k.box(1.6, 3.0, 0.06, 'flowerRed', -14 + i * 9.3, 4.0, D / 2 + 13);
  }
  // side canopy over the service entrance
  k.box(18, 0.4, 3.0, 'graniteLight', -(W / 2 + 2), 4.0, 0);
  for (const u of [-8, 8]) k.box(0.4, 4.0, 0.4, 'iron', -(W / 2 + 2) + u, 0, 1.2);
  for (let i = 0; i < 5; i++) k.box(0.6, 0.6, 0.6, 'graniteDark', -(W / 2 + 8), 0, -D / 2 + 6 + i * 10);

  // deep-set punched windows between the ribbons, and a louvred plant wall
  punchedWindows(k, body, 0, { storeys: 2, storey: 3.2, first: 1.8, w: 1.6, h: 1.4, bay: 4.6, trim: 'granite', pane: 'glass', out: 0.05 });
  for (let i = 0; i < 10; i++) {
    const u = -W / 2 + 6 + i * ((W - 12) / 9);
    k.box(1.6, 1.6, 0.3, 'granite', u, bodyH + 2.6, -D / 2 + 6, { ry: 0 });
    k.box(1.2, 1.2, 0.12, 'dark', u, bodyH + 2.8, -D / 2 + 5.8);
  }
  // a slender clock/art mast on the plaza
  k.box(1.0, 11, 1.0, 'graniteLight', -(W / 2 + 6), 0, D / 2 + 8);
  k.cyl(1.1, 1.1, 0.3, 16, 'graniteLight', -(W / 2 + 6), 11, D / 2 + 8, { rx: Math.PI / 2 });
  k.cyl(0.85, 0.85, 0.2, 16, 'white', -(W / 2 + 6), 11, D / 2 + 8.2, { rx: Math.PI / 2 });

  done();
}
camaraMat.metric = true;
camaraMat.rule = { note: 'Câmara de Matosinhos: horizontal civic block, glazed atrium and flag plaza', fitTo: true };
export default { 'camara-matosinhos': camaraMat };
