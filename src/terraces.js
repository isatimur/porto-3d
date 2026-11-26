// Quay terraces: the paved riverside squares and quays (cities/<id>.json
// quay_terraces) as level ground at their real height.
//
// The DEM (25-30 m source, 12 m grid) smears the quay wall and the hill behind
// it into one ramp: on the Cais da Ribeira the ground ran from the water up
// 8-10 m to the house fronts, so the quay deck sat low, walkers climbed a
// slope, and the arcades of the house row were half buried. A terrace is a
// polygon pad (terrain.js addPad poly) at one level: the river edge of the
// outline runs on the quay wall (data/quays.json), the inland edge a few metres
// inside the house fronts, so the arcades open onto the paving. Inside the
// outline the ground is built up from the river as well (shore); outside it
// the feather climbs back to the DEM no steeper than 1 : batter.
//
// DOM-free: node scripts import it too.

// def: { id, level_m (metres above sea level), outline: [[lat, lon], ...],
//        fall_m, fall_max_m, batter }
// ctx: { project(lat, lon) -> {x, z} world, terrain (createTerrain), S (world units per metre) }
export function terracePads(defs, { project, terrain, S }) {
  if (!Array.isArray(defs) || !terrain?.ok) return [];
  const out = [];
  for (const t of defs) {
    if (!Array.isArray(t.outline) || t.outline.length < 3 || !Number.isFinite(t.level_m)) continue;
    const poly = t.outline.map(([lat, lon]) => {
      const p = project(lat, lon);
      return [p.x, p.z];
    });
    const fall = (t.fall_m ?? 6) * S;
    out.push({
      id: `terrace:${t.id}`,
      terrace: t.id,
      poly,
      y: (t.level_m - terrain.datum) * S,
      fall,
      fallMax: Math.max(fall, (t.fall_max_m ?? 30) * S),
      batter: t.batter ?? 2.5,
      shore: true,
    });
  }
  return out;
}

// True when (x, z) lies on a terrace or within `margin` (world units) of its
// outline: the paving and the foot of its feather (src/roads.js builds a
// retaining wall there instead of a grass embankment).
export function nearTerrace(pads, x, z, margin = 0) {
  if (terraceLevelAt(pads, x, z) != null) return true;
  if (!(margin > 0)) return false;
  const m2 = margin * margin;
  for (const p of pads) {
    if (!p.terrace) continue;
    const P = p.poly;
    for (let i = 0, j = P.length - 2; i < P.length; j = i, i += 2) {
      const xi = P[i], zi = P[i + 1];
      const ex = P[j] - xi, ez = P[j + 1] - zi;
      const l2 = ex * ex + ez * ez;
      let t = l2 > 0 ? ((x - xi) * ex + (z - zi) * ez) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - (xi + ex * t), dz = z - (zi + ez * t);
      if (dx * dx + dz * dz <= m2) return true;
    }
  }
  return false;
}

// Quay deck tops along a line (src/quays.js), pinned to the terrace behind
// them. tops[i]: the deck's own height rule; levels[i]: the terrace level
// behind sample i, or null. A pinned sample lies `lift` over its terrace (the
// deck flush with the paving: no step, and no gap under the deck); the samples
// past a terrace's end ease back to their own rule over `r` samples.
export function pinToTerrace(tops, levels, lift = 0, r = 3) {
  if (!levels.some((v) => v != null)) return tops.slice();
  const at = tops.map((y, i) => (levels[i] != null ? levels[i] + lift : y));
  return at.map((y, i) => {
    if (levels[i] != null) return y;
    let s = 0;
    let n = 0;
    let near = false;
    for (let k = Math.max(0, i - r); k <= Math.min(at.length - 1, i + r); k++) {
      s += at[k];
      n++;
      if (levels[k] != null) near = true;
    }
    return near ? s / n : y;
  });
}

// The level (world y) of the terrace whose outline holds (x, z), or null.
export function terraceLevelAt(pads, x, z) {
  for (const p of pads) {
    if (!p.terrace) continue;
    const P = p.poly;
    let inside = false;
    for (let i = 0, j = P.length - 2; i < P.length; j = i, i += 2) {
      const xi = P[i], zi = P[i + 1], xj = P[j], zj = P[j + 1];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    if (inside) return p.y;
  }
  return null;
}
