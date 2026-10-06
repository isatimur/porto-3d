// Alfândega Nova do Porto (Jean-François Colson; ordered 1859, first block
// 1869, completed 1879): a vast granite customs house on the Douro, now the
// Transport Museum and a congress centre. Three massive blocks around inner
// courtyards, a columned central portico and corner pavilions. 1:1 on the OSM
// outline.
import { Kit, PROFILES, corniceProfile } from '../kit.js';
import { polyCornice, polyBand, polyWindows, roofOver } from '../metric.js';
import { win, pediment, flameUrn, slopedParapet } from '../parts.js';
import { bbox, offset, rect, edges } from '../geom.js';
import { fitTo } from './site-fit.js';

function builder(k, site) {
  const fp = site?.footprint;
  const o = fp?.outline && fp.outline.length >= 3 ? fp.outline : null;
  const b = o ? bbox(o) : { w: 59.2, d: 67.3, cx: 0, cz: 0, x0: -29.6, x1: 29.6, z0: -33.7, z1: 33.7 };
  const plan = o || rect(b.cx, b.cz, b.w, b.d);
  const dimsH = site?.dims?.height_m?.total ?? 20;
  const done = fitTo(k, site, { w: b.w, d: b.d, h: dimsH, cx: b.cx, cz: b.cz }, b);

  const H = dimsH;
  const bodyH = H * 0.70;
  const courtW = b.w * 0.19;
  const courtD = b.d * 0.40;
  const courtA = rect(b.cx - b.w * 0.21, b.cz, courtW, courtD);
  const courtB = rect(b.cx + b.w * 0.21, b.cz, courtW, courtD);

  k.begin('main');

  // quay platform on the river side, plinth and main body with two courts
  // (a narrower quay strip: the 7 m one took the main box 10.2 % past the
  // OSM extent)
  k.prism(rect(b.cx, b.z1 + 1.4, b.w + 4, 4.4), -0.35, 0.4, 'sand');
  k.prism(offset(plan, 1.4), 0, 1.4, 'graniteDark');
  k.prism(plan, 1.4, bodyH - 1.4, 'granite', { holes: [courtA, courtB] });
  k.prism(courtA, 0, 0.2, 'sand');
  k.prism(courtB, 0, 0.2, 'sand');
  polyCornice(k, plan, bodyH, corniceProfile('eave', 0.9), 'graniteLight');
  polyBand(k, plan, bodyH * 0.52, 0.45, 0.3, 'graniteLight');
  // slate roof ring over the blocks (the courts stay open)
  k.prism(offset(plan, -0.6), bodyH, 0.9, 'slate', { holes: [offset(courtA, 0.5), offset(courtB, 0.5)] });
  k.prism(offset(offset(plan, -0.6), -3.5), bodyH + 0.9, 2.2, 'slate', { holes: [offset(courtA, 4.0), offset(courtB, 4.0)] });

  // fenestration: tall round-arched ground floor, two storeys above
  polyWindows(k, plan, {
    bay: 5.6, w: 1.9, h: 3.6, storeys: [2.4],
    win: { trim: 'granite', pane: 'glass', arch: 'round', bw: 0.34, depth: 0.4, sill: true },
  });
  polyWindows(k, plan, {
    bay: 5.6, w: 1.7, h: 2.8, storeys: [8.4],
    win: { trim: 'granite', pane: 'glass', bw: 0.3, depth: 0.35, sill: true },
  });
  polyWindows(k, plan, {
    bay: 5.6, w: 1.5, h: 2.2, storeys: [bodyH - 3.0],
    win: { trim: 'granite', pane: 'glass', bw: 0.28, depth: 0.3 },
  });

  // ---- central columned portico on the front (+z) face
  k.begin('portico');
  const pw = b.w * 0.34;
  const pz = b.z1 - 0.6;
  k.box(pw + 3.0, bodyH + 2.4, 4.6, 'granite', b.cx, 0, pz + 1.4);
  k.box(pw + 4.0, 1.2, 5.4, 'graniteLight', b.cx, bodyH, pz + 1.4);
  pediment(k, pw + 4.0, 3.6, 1.6, 'graniteLight', b.cx, bodyH + 1.2, pz + 1.2);
  for (let i = 0; i < 6; i++) {
    k.column(8.6, 0.55, 'graniteLight', b.cx - pw / 2 + (pw * i) / 5, 1.4, pz + 3.2, { smooth: true, seg: 10 });
  }
  k.box(pw - 1.0, 7.4, 0.6, 'glass', b.cx, 2.4, pz + 3.9, { emit: 0.16 });
  k.arcade(pw + 1.0, 5.4, 0.7, 3, 2.6, 4.2, 'granite', b.cx, 1.4, pz + 3.9);
  k.statue(2.2, 'graniteLight', b.cx, bodyH + 1.6, pz + 1.4);
  k.end('portico');

  // ---- corner pavilions topped with pediments and urns
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const px = b.cx + sx * (b.w / 2 - 7.5);
    const pzz = b.cz + sz * (b.d / 2 - 7.5);
    const ph = H * 0.86;
    k.box(13.0, ph, 13.0, 'granite', px, 0, pzz);
    k.corniceRing(13.0, 13.0, corniceProfile('classic', 0.8), 'graniteLight', px, ph, pzz);
    k.push({ x: px, z: pzz, ry: sz > 0 ? 0 : Math.PI });
    pediment(k, 9.0, 2.6, 1.2, 'graniteLight', 0, ph, 6.4);
    k.pop();
    for (let i = 0; i < 3; i++) {
      k.push({ x: px, z: pzz + sz * 6.4, ry: sz > 0 ? 0 : Math.PI });
      win(k, -2.6 + i * 2.6, ph * 0.30, 1.3, 2.4, 0.05, { trim: 'graniteLight', pane: 'glass', arch: 'round', bw: 0.24, depth: 0.3 });
      win(k, -2.6 + i * 2.6, ph * 0.62, 1.3, 2.4, 0.05, { trim: 'graniteLight', pane: 'glass', arch: 'round', bw: 0.24, depth: 0.3 });
      k.pop();
    }
    flameUrn(k, 2.6, 'graniteLight', px - 3.0, ph + 0.8, pzz + sz * 2.0);
    flameUrn(k, 2.6, 'graniteLight', px + 3.0, ph + 0.8, pzz + sz * 2.0);
  }

  // roof chimneys
  for (let i = 0; i < 8; i++) {
    const x = b.cx - b.w * 0.36 + (b.w * 0.72 * i) / 7;
    k.box(1.6, 3.0, 1.6, 'graniteDark', x, H * 0.72 + 2.0, b.cz - b.d * 0.28);
  }

  // --- detail: dockside bollards, two quay cranes and a freestone cornice
  for (let i = 0; i < 8; i++) {
    k.cyl(0.4, 0.5, 1.0, 8, 'iron', b.cx - b.w / 2 + 3 + i * ((b.w - 6) / 7), 0.4, b.z1 + 3.0);
  }
  for (const cxx of [b.cx - b.w * 0.3, b.cx + b.w * 0.3]) {
    k.box(0.5, 6.5, 0.5, 'iron', cxx, 0, b.z1 + 2.2);
    k.box(4.5, 0.5, 0.5, 'iron', cxx + 2.0, 6.0, b.z1 + 2.2);
    k.cyl(0.12, 0.12, 1.6, 5, 'iron', cxx + 4.2, 4.4, b.z1 + 2.2);
  }
  for (let i = 0; i < 10; i++) {
    const x = b.cx - b.w * 0.42 + (b.w * 0.84 * i) / 9;
    k.box(1.8, 2.4, 1.8, 'graniteDark', x, H * 0.72 + 1.8, b.cz + b.d * 0.28);
  }

  k.end('main');
  done();
}

builder.metric = true;
builder.rule = {
  extent: { box: { x0: -29.6, x1: 29.6, z0: -33.7, z1: 33.7 } },
  fitTo: true,
  note: 'Alfândega Nova do Porto: 1859-1879 granite customs house, three blocks, courtyards',
};
export default { 'alfandega-nova': builder };
