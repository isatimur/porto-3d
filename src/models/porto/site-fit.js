// Size an authored metric model to the OSM footprint it stands for (fit.js).
//
// A builder draws in its own metres around the outline's centre. When the
// landmark has an OSM outline, fitTo() maps the model's authored box onto
// that outline (plan) and onto data/dimensions.json's real height, so the
// model stands at the real size. With no footprint the authored size is
// kept. Call at the top of the builder and pop at the very end.
import { bbox } from '../geom.js';

// Union of the outline and every named/tagged part: the extent a builder
// that draws the whole OSM set stands for (mirrors fit.js extent: [/./]).
export function partsBox(fp) {
  const pts = [...(fp?.outline || [])];
  for (const p of fp?.parts || []) if (p.name || p.tag) pts.push(...p.pts);
  return pts.length >= 3 ? bbox(pts) : null;
}

// authored: { w, d, h, cx, cz } of the model as drawn, in metres.
// target:   optional bbox to fit instead of the outline (a documented
//           sub-extent, or partsBox for a whole-site model).
export function fitTo(k, site, authored, target) {
  const fp = site?.footprint;
  const o = fp?.outline;
  const b = target || (o && o.length >= 3 ? bbox(o) : null);
  const dimsH = site?.dims?.height_m?.total;
  const sx = b && authored.w ? b.w / authored.w : 1;
  const sz = b && authored.d ? b.d / authored.d : 1;
  const sy = dimsH && authored.h ? dimsH / authored.h : 1;
  const x = b ? (b.cx ?? 0) - (authored.cx || 0) * sx : 0;
  const z = b ? (b.cz ?? 0) - (authored.cz || 0) * sz : 0;
  k.push({ x, z, sx, sy, sz });
  return () => k.pop();
}