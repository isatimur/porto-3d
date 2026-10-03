// Museu Nacional Soares dos Reis in the Palácio dos Carrancas (late 18th c.,
// museum since 1942). The model draws the palace building itself — the OSM
// "Palácio dos Carrancas" part — with its central pedimented bay, wings,
// rows of pedimented windows and hipped roof, not the surrounding gardens.
import { Kit, PROFILES, corniceProfile } from '../kit.js';
import { polyCornice, polyBand, polyWindows, roofOver, plainBuilding } from '../metric.js';
import { win, pediment, cartouche, flameUrn } from '../parts.js';
import { bbox, offset, rect } from '../geom.js';
import { fitTo } from './site-fit.js';

function builder(k, site) {
  const fp = site?.footprint;
  const part = fp?.part ? fp.part(/Pal[áa]cio|Carrancas/i) : null;
  const o = part?.pts && part.pts.length >= 3 ? part.pts : null;
  const b = o ? bbox(o) : { w: 82.9, d: 46.4, cx: 0, cz: 0, x0: -41.45, x1: 41.45, z0: -23.2, z1: 23.2 };
  const plan = o || rect(b.cx, b.cz, b.w, b.d);
  const dimsH = site?.dims?.height_m?.total ?? 16;
  const done = fitTo(k, site, { w: b.w, d: b.d, h: dimsH, cx: b.cx, cz: b.cz }, b);

  const H = dimsH;
  const bodyH = H * 0.64;

  // garden ground and palace plinth (kept tight to the building)
  k.prism(offset(plan, 2), -0.35, 0.35, 'grass');
  k.prism(rect(b.cx, b.cz, b.w + 4, b.d + 4), -0.25, 0.2, 'sand');

  k.begin('main');
  k.prism(offset(plan, 0.9), 0, 1.0, 'graniteDark');

  // rusticated ground floor, rendered upper storeys
  k.prism(offset(plan, 0.3), 1.0, 3.4, 'graniteWarm');
  k.prism(plan, 4.4, bodyH - 4.4, 'plaster');
  polyBand(k, plan, 4.4, 0.4, 0.24, 'granite');
  polyCornice(k, plan, bodyH, corniceProfile('classic', 0.8), 'graniteLight');
  k.prism(offset(plan, -0.6), bodyH, H * 0.16, 'plaster');
  polyCornice(k, offset(plan, -0.6), bodyH + H * 0.16, corniceProfile('band', 0.6), 'graniteLight');
  roofOver(k, offset(plan, -0.6), bodyH + H * 0.16, 3.4, 'terracotta', 'hip', { over: 0.8 });

  // windows: plain square openings, pedimented on the piano nobile
  polyWindows(k, plan, {
    bay: 5.4, w: 1.6, h: 2.7, storeys: [1.8],
    win: { trim: 'granite', pane: 'glass', bw: 0.32, depth: 0.35, sill: true },
  });
  polyWindows(k, plan, {
    bay: 5.4, w: 1.6, h: 3.0, storeys: [6.4],
    win: { trim: 'granite', pane: 'glass', bw: 0.34, depth: 0.35, sill: true, head: 'tri' },
  });
  polyWindows(k, plan, {
    bay: 5.4, w: 1.3, h: 1.9, storeys: [bodyH + 1.0],
    win: { trim: 'granite', pane: 'glass', bw: 0.26, depth: 0.3 },
  });

  // ---- central pedimented bay on the main (long) facade
  const nLong = b.w >= b.d ? { w: b.w, d: b.d } : { w: b.d, d: b.w };
  const alongX = b.w >= b.d;
  const cw = 15;
  const cD = 1.6;
  if (alongX) {
    // main front is one of the long faces; put the bay on both long faces
    for (const s of [-1, 1]) {
      const zc = b.cz + s * (b.d / 2 - 0.4);
      k.box(cw + 2.0, bodyH + H * 0.16, cD, 'plaster', b.cx, 0, zc + s * cD / 2, { ry: 0 });
      k.box(cw + 2.6, 1.0, cD + 0.6, 'graniteLight', b.cx, bodyH, zc + s * cD / 2);
      pediment(k, cw + 2.6, 3.2, 1.4, 'graniteLight', b.cx, bodyH + H * 0.16, zc + s * 0.5);
      cartouche(k, 3.0, 3.6, 0.7, 'graniteLight', b.cx, bodyH * 0.55, zc + s * (cD + 0.1), { crown: 'graniteLight' });
      win(k, -4.0, 1.6, 1.7, 3.0, zc + s * (cD + 0.05), { trim: 'granite', pane: 'glass', bw: 0.34, depth: 0.35, sill: true, head: 'seg' });
      win(k, 4.0, 1.6, 1.7, 3.0, zc + s * (cD + 0.05), { trim: 'granite', pane: 'glass', bw: 0.34, depth: 0.35, sill: true, head: 'seg' });
      for (const sx of [-1, 1]) flameUrn(k, 2.6, 'graniteLight', b.cx + sx * (cw / 2 + 0.6), bodyH + H * 0.16, zc + s * 0.4);
    }
  } else {
    for (const s of [-1, 1]) {
      const xc = b.cx + s * (b.w / 2 - 0.4);
      k.box(cD, bodyH + H * 0.16, cw + 2.0, 'plaster', xc + s * cD / 2, 0, b.cz);
      pediment(k, cw + 2.6, 3.2, 1.4, 'graniteLight', xc + s * 0.5, bodyH + H * 0.16, b.cz, { ry: s * Math.PI / 2 });
      for (const sz of [-1, 1]) flameUrn(k, 2.6, 'graniteLight', xc + s * 0.4, bodyH + H * 0.16, b.cz + sz * (cw / 2 + 0.6));
    }
  }

  // corner quoins
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    k.box(1.1, bodyH, 1.1, 'granite', b.cx + sx * (b.w / 2 - 0.4), 0, b.cz + sz * (b.d / 2 - 0.4));
  }

  k.end('main');
  done();
}

builder.metric = true;
builder.rule = {
  extent: { box: { x0: -75.8, x1: 7.1, z0: 22.2, z1: 68.5 } },
  fitTo: true,
  deviationNote: 'model is the Palácio dos Carrancas (the museum building) alone; the OSM outline is the whole museum property with its gardens',
  note: 'Museu Nacional Soares dos Reis: Palácio dos Carrancas, museum since 1942',
};
export default { 'museu-soares-dos-reis': builder };
