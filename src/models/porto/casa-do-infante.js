// Casa do Infante / Alfândega Velha (from 1325). The medieval royal customs
// house and traditional birthplace of Henry the Navigator: a ring of granite
// wings around a central courtyard, with the tall Torre Norte, a crenellated
// crown, a Manueline portal and a sculpted niche. 1:1 on the OSM outline.
import { Kit, PROFILES, corniceProfile, MAT } from '../kit.js';
import { polyCornice, polyBand, polyWindows, roofOver } from '../metric.js';
import { win, wallFountain, tablet } from '../parts.js';
import { bbox, offset, rect, edges } from '../geom.js';
import { fitTo } from './site-fit.js';

function builder(k, site) {
  const fp = site?.footprint;
  const o = fp?.outline && fp.outline.length >= 3 ? fp.outline : null;
  const b = o ? bbox(o) : { w: 46.4, d: 52.4, cx: 0, cz: 0, x0: -23.2, x1: 23.2, z0: -26.2, z1: 26.2 };
  const plan = o || rect(b.cx, b.cz, b.w, b.d);
  const dimsH = site?.dims?.height_m?.total ?? 14;
  const done = fitTo(k, site, { w: b.w, d: b.d, h: dimsH, cx: b.cx, cz: b.cz }, b);

  const H = dimsH * 0.82;
  const bodyH = H * 0.60;
  const inner = offset(plan, -6.5);

  // courtyard floor and building ring
  k.prism(offset(plan, 3.0), -0.3, 0.4, 'sand');
  k.begin('main');

  k.prism(plan, 0, 0.9, 'graniteDark');
  k.prism(plan, 0.9, bodyH - 0.9, 'graniteWarm', { holes: [inner] });
  k.prism(inner, 0, 0.15, 'sand');
  polyCornice(k, plan, bodyH, corniceProfile('eave', 0.6), 'graniteLight');
  // tiled roof ring over the wings
  k.prism(offset(plan, -0.4), bodyH, 0.7, 'terracotta', { holes: [offset(inner, 0.5)] });
  k.prism(offset(inner, 0.5), bodyH - 0.4, 0.7, 'terracotta');

  // ground-floor arcade and storeys of windows on every facade
  for (const e of edges(plan)) {
    if (e.len < 8) continue;
    k.push({ x: e.mx + e.nx * 0.05, z: e.mz + e.nz * 0.05, ry: e.ry });
    const n = Math.max(2, Math.floor((e.len - 2) / 3.6));
    for (let i = 0; i < n; i++) {
      const u = -((n - 1) * 3.6) / 2 + i * 3.6;
      win(k, u, 1.4, 1.2, 1.9, 0.05, { trim: 'granite', pane: 'glass', arch: 'round', bw: 0.22, depth: 0.3 });
      win(k, u, 5.0, 1.5, 1.8, 0.05, { trim: 'granite', pane: 'glass', bw: 0.26, depth: 0.3 });
    }
    k.pop();
  }

  // ---- Torre Norte: the medieval tower
  k.begin('tower');
  const tw = Math.min(8.0, Math.min(b.w, b.d) * 0.30);
  const tx = b.x0 + tw / 2 + 1.2;
  const tz = b.z1 - tw / 2 - 1.2;
  k.box(tw + 1.4, 1.2, tw + 1.4, 'graniteDark', tx, 0, tz);
  k.box(tw, H - 1.2, tw, 'granite', tx, 1.2, tz);
  k.corniceRing(tw, tw, corniceProfile('band', 0.45), 'graniteLight', tx, H * 0.62, tz);
  k.corniceRing(tw, tw, corniceProfile('band', 0.45), 'graniteLight', tx, H - 1.1, tz);
  k.crenels(tw, tw, 'graniteLight', tx, H - 0.1, tz, { mw: 1.1, mh: 1.0, t: 0.55 });
  k.cone(tw * 0.66, 2.2, 4, 'terracotta', tx, H + 0.9, tz);
  // corner corbels and shaft windows
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    k.box(0.9, H - 2.4, 0.9, 'graniteLight', tx + sx * (tw / 2 - 0.35), 1.2, tz + sz * (tw / 2 - 0.35));
  }
  for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    k.push({ x: tx, z: tz, ry });
    win(k, 0, H * 0.30, 0.9, 2.4, tw / 2 - 0.1, { trim: 'graniteLight', pane: 'dark', arch: 'round', bw: 0.2, depth: 0.3 });
    win(k, 0, H * 0.60, 0.9, 2.0, tw / 2 - 0.1, { trim: 'graniteLight', pane: 'glass', arch: 'round', bw: 0.2, depth: 0.3 });
    k.surround({ x: 0, y: H * 0.78, w: 1.3, h: 2.2, arch: 'round' }, 0.22, 0.35, 'graniteLight', tw / 2 - 0.05);
    k.statue(1.4, 'graniteLight', 0, H * 0.80, tw / 2 + 0.15, { pose: 'hold' });
    k.pop();
  }
  k.end('tower');

  // ---- Manueline portal and inscription on the front facade
  k.begin('portal');
  const eFront = edges(plan).reduce((a, e) => (e.len > (a?.len ?? 0) ? e : a), null);
  onFront(k, eFront, 0, 0.15);
  k.gate(7.5, 6.2, 0.9, [{ x: -2.0, w: 2.4, h: 4.6, pointed: true }, { x: 2.0, w: 2.4, h: 4.6, pointed: true }], 'granite', 0, 0, 0);
  k.surround({ x: 0, y: 7.1, w: 4.4, h: 3.2, arch: 'round' }, 0.35, 0.6, 'graniteLight', 0.2);
  k.statue(2.0, 'graniteLight', 0, 7.2, 0.5, { pose: 'raise' });
  tablet(k, 3.6, 0.9, 0.25, 'graniteLight', 0, 4.0, 0.3, { lines: 2 });
  k.pop();
  k.end('portal');

  k.end('main');
  done();
}

// push a frame on an edge from geom.edges (outward normal = local +z)
function onFront(k, e, y = 0, out = 0) {
  return k.push({ x: e.mx + e.nx * out, y, z: e.mz + e.nz * out, ry: e.ry });
}

builder.metric = true;
builder.rule = {
  extent: { box: { x0: -23.2, x1: 23.2, z0: -26.2, z1: 26.2 } },
  fitTo: true,
  note: 'Casa do Infante: medieval customs house, Torre Norte, courtyard, from 1325',
};
export default { 'casa-do-infante': builder };
