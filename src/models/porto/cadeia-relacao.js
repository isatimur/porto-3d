// Antiga Cadeia e Tribunal da Relação (Porto): the 1765-1796 granite prison
// and appeals court (Eugénio dos Santos), a quadrangular three-storey block
// round an open courtyard with a central chapel. Since 2001 the Portuguese
// Photography Centre. Barred windows, pedimented entrance, hipped roofs.
import { corniceProfile } from '../kit.js';
import { win, pediment } from '../parts.js';
import { rect } from '../geom.js';
import { fitTo } from './site-fit.js';

function cadeiaRelacao(k, site) {
  const W = 62.7;
  const D = 62.6;
  const H = 20;
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  const wing = 14;
  const bodyH = 16;
  const zF = D / 2;
  const zB = -D / 2;

  // paved exercise yard
  k.prism(rect(0, 0, W - 2 * wing, D - 2 * wing), -0.1, 0.18, 'graniteLight');

  // four granite ranges round the court
  k.box(W, bodyH, wing, 'granite', 0, 0, zF - wing / 2);
  k.box(W, bodyH, wing, 'granite', 0, 0, zB + wing / 2);
  k.box(wing, bodyH, D - 2 * wing, 'granite', -(W / 2 - wing / 2), 0, 0);
  k.box(wing, bodyH, D - 2 * wing, 'granite', (W / 2 - wing / 2), 0, 0);
  // plinth and string courses
  k.box(W + 1.0, 1.0, D + 1.0, 'graniteDark', 0, 0, 0);
  k.corniceRing(W - 0.2, D - 0.2, corniceProfile('band', 0.35), 'graniteLight', 0, 5.4, 0);
  k.corniceRing(W - 0.2, D - 0.2, corniceProfile('band', 0.35), 'graniteLight', 0, 10.6, 0);
  k.corniceRing(W, D, corniceProfile('eave', 0.5), 'graniteLight', 0, bodyH - 0.3, 0);
  // hipped roofs
  k.hipRoof(W, wing, 3.4, 'terracotta', 0, bodyH, zF - wing / 2, { over: 0.6 });
  k.hipRoof(W, wing, 3.4, 'terracotta', 0, bodyH, zB + wing / 2, { over: 0.6 });
  k.hipRoof(wing, D - 2 * wing, 3.4, 'terracotta', -(W / 2 - wing / 2), bodyH, 0, { over: 0.6 });
  k.hipRoof(wing, D - 2 * wing, 3.4, 'terracotta', (W / 2 - wing / 2), bodyH, 0, { over: 0.6 });

  // courtyard chapel (the prison chapel stood in the open court)
  k.box(11, 9, 11, 'graniteLight', 0, 0, 0);
  k.corniceRing(11, 11, corniceProfile('classic', 0.5), 'granite', 0, 9, 0);
  k.dome(5.6, 'graniteDark', 0, 9.5, 0, { seg: 14, rings: 6 });
  k.cyl(1.2, 1.6, 2.2, 8, 'granite', 0, 13.2, 0);
  k.sphere(0.5, 'gold', 0, 15.8, 0, { seg: 8, rings: 5, emit: 0.4 });
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    k.push({ x: Math.sin(a) * 5.6, z: Math.cos(a) * 5.6, ry: a });
    win(k, 0, 2.2, 1.6, 4.0, 0, { trim: 'granite', pane: 'dark', arch: 'round', bw: 0.25, depth: 0.3, bars: true });
    k.pop();
  }

  // ---- front entrance: pedimented granite portal
  k.box(8.0, 8.0, 1.0, 'graniteLight', 0, 0, zF + 0.5);
  k.box(8.8, 0.8, 1.6, 'granite', 0, 8.0, zF + 0.6);
  pediment(k, 9.2, 3.0, 1.2, 'granite', 0, 8.8, zF + 0.5, { frame: 0.45 });
  win(k, 0, 1.0, 3.4, 5.0, zF + 1.0, { trim: 'granite', pane: 'wood', bw: 0.4, depth: 0.4 });

  // ---- barred windows on the three outer sides (three storeys)
  const bays = (len) => {
    const out = [];
    const n = Math.max(2, Math.round(len / 7));
    for (let i = 0; i < n; i++) out.push(-len / 2 + (len / n) * (i + 0.5));
    return out;
  };
  // front and back ranges
  for (const zz of [zF, zB]) {
    k.push({ z: zz, ry: zz > 0 ? 0 : Math.PI });
    for (const u of bays(W)) {
      if (Math.abs(u) < 4.6) continue; // clear of the portal
      for (const yy of [1.4, 6.6, 11.8]) {
        win(k, u, yy, 1.4, 2.2, 0, { trim: 'graniteLight', pane: 'dark', bw: 0.22, depth: 0.3, sill: true, bars: true });
      }
    }
    k.pop();
  }
  // side ranges
  for (const sx of [-1, 1]) {
    k.push({ x: sx * W / 2, z: 0, ry: sx * Math.PI / 2 });
    for (const u of bays(D)) {
      for (const yy of [1.4, 6.6, 11.8]) {
        win(k, u, yy, 1.4, 2.2, 0, { trim: 'graniteLight', pane: 'dark', bw: 0.22, depth: 0.3, sill: true, bars: true });
      }
    }
    k.pop();
  }

  done();
}
cadeiaRelacao.metric = true;
cadeiaRelacao.rule = {
  note: 'Antiga Cadeia da Relação: quadrangular granite prison round a court + chapel, 62.7 x 62.6 m, 20 m',
  extent: { box: { x0: -31.3, x1: 31.3, z0: -31.3, z1: 31.3 } },
  fitTo: true,
};
export default { 'cadeia-relacao': cadeiaRelacao };
