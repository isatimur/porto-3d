// Praça da Batalha, Porto: the old square (16th c.) framed by monuments of
// three centuries. The neoclassical São João National Theatre (1798/1920,
// Marques da Silva) with its four-column portico and pediment dominates one
// side; the azulejo facade of Santo Ildefonso and the Batalha Palace close
// the others, with Teixeira Lopes' 1866 statue of King Pedro V in the middle.
import { corniceProfile } from '../kit.js';
import { win, pediment, flutedColumn } from '../parts.js';
import { bbox, rect } from '../geom.js';
import { fitTo } from './site-fit.js';

function batalha(k, site) {
  const o = site?.footprint?.outline;
  const b = o && o.length >= 3 ? bbox(o) : { w: 188.2, d: 107.1, cx: 0, cz: 0 };
  const W = Math.max(40, b.w);
  const D = Math.max(30, b.d);
  const H = 25;
  const done = fitTo(k, site, { w: W, d: D, h: H, cx: 0, cz: 0 });

  // paved square exactly filling the footprint box
  k.prism(rect(0, 0, W, D), 0, 0.22, 'graniteLight');
  k.prism(rect(0, 0, W * 0.34, D), 0.22, 0.04, 'granite');
  k.prism(rect(0, 0, W, D * 0.20), 0.22, 0.04, 'granite');

  // ---------------- Teatro Nacional São João on the south (+z) side
  const tw = Math.min(62, W * 0.34);
  const td = 20;
  const tz = D / 2 - td / 2 - 2.5;
  k.prism(rect(0, tz, tw, td), 0.22, 12, 'plaster');
  k.prism(rect(0, tz, tw + 1.6, td + 1.6), 0.22, 1.4, 'granite');
  k.corniceRing(tw, td, corniceProfile('eave', 0.6), 'granite', 0, 12.2, tz);
  // attic
  k.prism(rect(0, tz, tw - 4, td - 3), 12.2, 2.0, 'plaster');
  // portico: six fluted columns, entablature, pediment (apex sets the 25 m)
  const pz = tz + td / 2 + 0.6;
  for (let i = 0; i < 6; i++) {
    const u = -tw * 0.30 + (tw * 0.60 * i) / 5;
    flutedColumn(k, 8.0, 0.75, 'graniteLight', u, 12.8, pz, { flutes: 14, capital: 'ionic' });
  }
  k.box(tw * 0.74, 0.9, 2.4, 'graniteLight', 0, 20.3, pz);
  k.box(tw * 0.78, 0.3, 2.8, 'granite', 0, 21.2, pz);
  pediment(k, tw * 0.80, 3.6, 1.6, 'graniteLight', 0, 21.35, pz - 0.2, { frame: 0.5 });
  // three arched windows and doors behind the portico
  k.arcade(tw * 0.5, 6.5, 0.6, 3, tw * 0.12, 5.6, 'granite', 0, 12.2, tz + td / 2 - 0.1, { pane: 'glass' });
  for (let i = 0; i < 5; i++) win(k, -tw * 0.36 + i * (tw * 0.18), 4.0, 1.5, 3.0, tz + td / 2 + 0.02, { trim: 'granite', pane: 'glass', sill: true });
  for (let i = 0; i < 5; i++) win(k, -tw * 0.36 + i * (tw * 0.18), 14.4, 1.3, 2.2, tz + td / 2 + 0.02, { trim: 'granite', pane: 'glass' });

  // ---------------- Igreja de Santo Ildefonso on the north (-z) side
  const iw = Math.min(34, W * 0.20);
  const iz = -D / 2 + 12;
  k.prism(rect(0, iz, iw, 22), 0.22, 14, 'plaster');
  k.corniceRing(iw, 22, corniceProfile('eave', 0.5), 'granite', 0, 14.2, iz);
  // azulejo-clad baroque front
  k.wall(iw - 3, 13, 0.6, 'azulejo', [{ x: 0, y: 1.2, w: 3.2, h: 4.6, arch: 'round', pane: 'dark', inset: 0.3 }], 0, 0.22, iz - 11.3);
  k.box(iw - 2.4, 1.2, 1.0, 'granite', 0, 0.22, iz - 11.5);
  k.surround({ x: 0, y: 1.2, w: 3.2, h: 4.6, arch: 'round' }, 0.5, 0.7, 'granite', iz - 11.0);
  for (const s of [-1, 1]) win(k, s * (iw * 0.28), 6.6, 1.5, 2.6, iz - 11.0, { trim: 'granite', pane: 'glass', arch: 'round' });
  k.box(iw + 2, 5.5, iw * 0.5, 'plaster', 0, 0.22, iz + 8);
  k.corniceRing(iw + 2, iw * 0.5, corniceProfile('band', 0.4), 'granite', 0, 14.2, iz + 8);
  // two short flanking towers
  for (const s of [-1, 1]) {
    k.box(3.4, 19, 3.4, 'plaster', s * (iw / 2 + 2.2), 0.22, iz - 8);
    k.cyl(2.2, 2.2, 0.4, 8, 'granite', s * (iw / 2 + 2.2), 19.2, iz - 8);
    k.cone(2.4, 2.4, 4, 'slate', s * (iw / 2 + 2.2), 19.6, iz - 8);
  }

  // ---------------- Batalha Palace and Cine-Teatro on the east (+x) side
  const px = W / 2 - 11;
  k.prism(rect(px, -D * 0.10, 22, 40), 0.22, 14, 'cream');
  k.corniceRing(22, 40, corniceProfile('eave', 0.5), 'granite', px, 14.2, -D * 0.10);
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) win(k, px - 9 + i * 6, 3 + (s > 0 ? 5.2 : 0), 1.4, 2.6, -D * 0.10 + s * 20.1, { trim: 'granite', pane: 'glass', sill: true });
  k.box(24, 0.6, 42, 'graniteLight', px, 14.5, -D * 0.10);
  // projecting corner tower with a hipped roof
  k.push({ x: px, z: -D * 0.10 + 24 });
  k.box(9, 16.5, 9, 'cream', 0, 0.22, 0);
  k.hipRoof(10, 10, 3.0, 'terracotta', 0, 16.7, 0);
  k.pop();

  // ---------------- Cinema Batalha on the west (-x) side
  const cx = -W / 2 + 12;
  k.prism(rect(cx, D * 0.06, 24, 42), 0.22, 11, 'white');
  k.prism(rect(cx, D * 0.06, 24, 42), 11.2, 0.6, 'slate');
  k.box(20, 6, 0.5, 'glass', cx, 1.4, D * 0.06 + 21.1, { emit: 0.12, mat: 0 });
  k.box(22, 1.6, 0.8, 'doorBlue', cx, 8.6, D * 0.06 + 21.2);
  for (let i = 0; i < 4; i++) {
    const wy = 3.0 + i * 1.9;
    for (let j = 0; j < 6; j++) k.box(1.3, 1.2, 0.12, 'glass', cx - 9 + j * 3.6, wy, D * 0.06 + 21.15, { emit: 0.08, mat: 0 });
  }

  // ---------------- monument to King Pedro V in the middle
  const mx = -W * 0.05;
  const mz = D * 0.10;
  k.prism(rect(mx, mz, 6, 6), 0.22, 1.2, 'granite');
  k.cyl(2.4, 3.0, 4.2, 10, 'granite', mx, 1.42, mz);
  k.box(6.4, 0.5, 6.4, 'granite', mx, 5.6, mz);
  k.statue(2.6, 'graniteLight', mx, 5.8, mz, { pose: 'raise' });
  k.sphere(0.3, 'bronze', mx, 8.5, mz, { seg: 6, rings: 4 });

  // tram track strips and trees along the edges
  for (const s of [-1, 1]) k.box(W * 0.7, 0.04, 0.25, 'steel', 0, 0.26, s * D * 0.30);
  for (let i = 0; i < 5; i++) k.tree(-W * 0.34 + i * W * 0.17, 0.22, -D * 0.42, 7.0 + (i % 2) * 2, { kind: 'round' });

  done();
}

batalha.metric = true;
batalha.rule = {
  note: 'Praça da Batalha: São João theatre portico, Santo Ildefonso azulejo front, Pedro V statue',
  fitTo: true,
};

export default { 'praca-batalha': batalha };
