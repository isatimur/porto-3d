// Estação Ferroviária de Porto-Campanhã (1875): the long 19th-century head
// building on the west side of the tracks and the iron platform trainshed
// behind it. Authored at 1:1 on the OSM outline; rule.fitTo maps the whole
// site (head building + trainshed) onto the documented extent.
import { Kit, PROFILES, corniceProfile } from '../kit.js';
import { polyCornice, polyBand, polyWindows, roofOver } from '../metric.js';
import { win, pediment } from '../parts.js';
import { bbox, offset, rect } from '../geom.js';
import { fitTo } from './site-fit.js';

function builder(k, site) {
  const fp = site?.footprint;
  const o = fp?.outline && fp.outline.length >= 3 ? fp.outline : null;
  const b = o ? bbox(o) : { w: 16.2, d: 102.4, cx: 0, cz: 0, x0: -8.1, x1: 8.1, z0: -51.2, z1: 51.2 };
  const plan = o || rect(b.cx, b.cz, b.w, b.d);
  const dimsH = site?.dims?.height_m?.total ?? 18.5;
  const done = fitTo(k, site, { w: b.w, d: b.d, h: dimsH, cx: b.cx, cz: b.cz }, b);

  const H = dimsH;
  const bodyTop = H * 0.66;
  const z0 = b.z0;
  const z1 = b.z1;
  const xPlat = b.x1 + 5.5;     // trainshed centre, east of the head building
  const shedW = 22;

  k.begin('main');

  // ---- platform apron and head-building plinth
  const apronX0 = b.x0 - 1.2;
  const apronX1 = xPlat + shedW / 2 + 2.5;
  k.prism(rect((apronX0 + apronX1) / 2, b.cz, apronX1 - apronX0, b.d + 2), -0.3, 0.35, 'sand');
  k.prism(offset(plan, 1.6), 0, 1.3, 'granite');
  k.prism(plan, 1.3, bodyTop - 1.3, 'graniteWarm');
  polyCornice(k, plan, 1.1, corniceProfile('base', 0.6), 'granite');
  polyCornice(k, plan, bodyTop, corniceProfile('eave', 0.7), 'granite');
  polyBand(k, plan, bodyTop * 0.52, 0.35, 0.18, 'graniteLight');

  // upper attic storey and low slate roof
  k.prism(offset(plan, -0.5), bodyTop, H * 0.18, 'plaster');
  polyCornice(k, offset(plan, -0.5), bodyTop + H * 0.18, corniceProfile('band', 0.5), 'granite');
  roofOver(k, offset(plan, -0.5), bodyTop + H * 0.18, 2.2, 'slate', 'hip', { over: 0.7 });

  // ---- fenestration: tall round-arched openings below, windows above
  polyWindows(k, plan, {
    bar: false, bay: 5.2, w: 1.7, h: 3.6,
    storeys: [2.2],
    win: { trim: 'granite', pane: 'glass', arch: 'round', bw: 0.3, depth: 0.35 },
  });
  polyWindows(k, plan, {
    bay: 5.2, w: 1.5, h: 2.4,
    storeys: [bodyTop + 0.8],
    win: { trim: 'granite', pane: 'glass', bw: 0.26, depth: 0.3 },
  });

  // ---- central and end pavilions projecting from the long facades
  for (const cz of [b.cz, b.cz - b.d * 0.40, b.cz + b.d * 0.40]) {
    const pavH = cz === b.cz ? H : H - 2.4;
    k.box(b.w + 2.6, pavH, 15, 'graniteWarm', b.cx, 0, cz);
    k.box(b.w + 3.4, 1.0, 16, 'granite', b.cx, pavH - 1.0, cz);
    k.box(b.w + 3.4, 1.2, 16, 'granite', b.cx, 0, cz);
    k.push({ x: b.cx, z: cz });
    k.gableRoof(b.w + 2.6, 15, 2.0, 'slate', 0, pavH - 0.4, 0);
    k.pop();
    // grand arched entrance on the city (west) face of the central pavilion
    k.push({ x: b.cx - (b.w + 2.6) / 2 - 0.2, z: cz, ry: -Math.PI / 2 });
    win(k, 0, 0.4, 4.2, 6.6, 0, { trim: 'granite', pane: 'glass', arch: 'round', bw: 0.5, depth: 0.6 });
    k.statue(2.4, 'plaster', 0, 8.4, 0.6, { pose: 'hold' });
    k.pop();
    k.push({ x: b.cx + (b.w + 2.6) / 2 + 0.2, z: cz, ry: Math.PI / 2 });
    win(k, 0, 0.4, 4.2, 6.6, 0, { trim: 'granite', pane: 'glass', arch: 'round', bw: 0.5, depth: 0.6 });
    k.pop();
    // clock over the central entrance
    if (cz === b.cz) {
      k.cyl(1.9, 1.9, 0.4, 16, 'graniteLight', b.cx - (b.w + 2.6) / 2 - 0.1, H * 0.72, cz, { rx: Math.PI / 2 });
      k.cyl(1.5, 1.5, 0.2, 16, 'white', b.cx - (b.w + 2.6) / 2 - 0.3, H * 0.72, cz, { rx: Math.PI / 2 });
    }
  }

  // ---- iron platform trainshed to the east
  k.begin('trainshed');
  const shedTop = H * 0.82;
  k.prism(rect(xPlat, b.cz, shedW + 3, b.d - 6), 0, 0.45, 'graniteLight');
  for (let i = 0; i <= 16; i++) {
    const z = b.z0 + 5 + ((b.d - 10) * i) / 16;
    for (const x of [xPlat - shedW / 2 + 1.4, xPlat, xPlat + shedW / 2 - 1.4]) {
      k.cyl(0.26, 0.4, shedTop, 8, 'iron', x, 0.45, z);
    }
    k.box(shedW, 0.4, 0.5, 'iron', xPlat, shedTop * 0.62, z);
  }
  k.gableRoof(shedW, b.d - 6, 4.4, 'lead', xPlat, shedTop, b.cz, { over: 0.8 });
  for (let i = 0; i <= 8; i++) {
    const z = b.z0 + 8 + ((b.d - 16) * i) / 8;
    k.box(shedW - 4, 1.6, 1.1, 'glass', xPlat, shedTop + 1.5, z, { emit: 0.12 });
  }
  k.end('trainshed');

  // --- detail pass: trainshed trusses, platform fittings and canopy glazing
  for (let i = 0; i <= 12; i++) {
    const z = b.z0 + 6 + ((b.d - 12) * i) / 12;
    k.segment([xPlat - shedW / 2, shedTop + 3.2, z], [xPlat, shedTop + 0.2, z], 0.16, 0.16, 'iron');
    k.segment([xPlat, shedTop + 0.2, z], [xPlat + shedW / 2, shedTop + 3.2, z], 0.16, 0.16, 'iron');
    k.box(shedW - 2, 0.12, 0.14, 'iron', xPlat, shedTop + 1.7, z);
  }
  for (let i = 0; i < 3; i++) {
    const z = b.z0 + 10 + ((b.d - 20) * i) / 2;
    k.box(2.2, 0.5, 0.6, 'wood', xPlat - 2.5, 0.45, z);
    k.box(2.2, 0.5, 0.6, 'wood', xPlat + 2.5, 0.45, z);
    k.lamp(4.2, xPlat, 0.45, z + 2, { globe: true });
  }
  for (let i = 0; i < 8; i++) {
    const z = b.z0 + 9 + ((b.d - 18) * i) / 7;
    k.box(shedW - 5, 0.05, 0.8, 'glass', xPlat, shedTop + 3.35, z, { mat: 0, emit: 0.08 });
  }

  k.end('main');
  done();
}

builder.metric = true;
builder.rule = {
  extent: { box: { x0: -8.1, x1: 27.6, z0: -51.2, z1: 51.2 } },
  fitTo: true,
  deviationNote: 'model draws the head building plus the iron platform trainshed east of it; the OSM outline is the head building alone',
  note: 'Estação de Campanhã: 19th-century head building + iron trainshed, 1875',
};
export default { campanha: builder };
