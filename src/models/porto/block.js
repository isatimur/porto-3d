// Generic metric massing builder for Porto (first launch).
// Extrudes the real OSM outline and parts to their real heights, so every
// landmark stands at true size, orientation and height until its detailed
// builder (see README/PLAN, models round) replaces it. One builder serves
// every Porto id. Plan points are [x, z] in the landmark frame, +z the front
// (fit.js).
import { bbox } from '../geom.js';

const WALL_TAGS = new Set(['building', 'church', 'tower', 'monument', 'stand', 'wall', 'on']);
const FLAT = { water: 'water', pitch: 'grass', garden: 'grass', park: 'grass', ruins: 'graniteDark', square: 'sand' };

// The Douro bridges are steel/iron structures, the riverfront and markets are
// warm granite, wine lodges are dark warehouses; the rest is generic granite.
const BRIDGES = new Set(['ponte-luis-i', 'ponte-arrabida', 'ponte-maria-pia']);
const RIVER = new Set(['ribeira', 'caves-gaia', 'felgueiras', 'palacio-cristal']);

function colourFor(id, tag) {
  if (BRIDGES.has(id)) return tag === 'pillar' || tag === 'support' ? 'graniteDark' : 'steel';
  if (tag === 'water') return 'water';
  if (tag === 'wall') return 'graniteDark';
  if (tag === 'tower' || tag === 'monument') return 'graniteLight';
  if (tag === 'church') return 'graniteWarm';
  if (id === 'casa-musica') return 'graniteGrey';
  if (id === 'dragao') return tag === 'stand' ? 'graniteGrey' : 'steel';
  if (id === 'lello') return 'rose';
  if (id === 'mercado-bolhao') return 'cream';
  if (RIVER.has(id)) return 'graniteWarm';
  return 'granite';
}

function closed(pts) {
  return Array.isArray(pts) && pts.length >= 3 && pts.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

function makeBlock(id) {
  function block(k, site) {
    const { footprint = {}, dims = {} } = site || {};
    const H = dims?.height_m?.total ?? 14;
    const roofH = Math.min(H, 14);
    k.begin('main');
    // The Luís I deck sits high above the water: the outline is the deck, so
    // draw it at its real height rather than from the ground.
    const decked = BRIDGES.has(id);
    const bodyH = decked ? Math.min(H, 14) : H;
    const outline = closed(footprint.outline) ? footprint.outline : null;
    if (outline) {
      if (decked) k.prism(outline, bodyH - 1.5, bodyH, colourFor(id, 'deck'));
      else k.prism(outline, 0, bodyH, colourFor(id, 'building'));
    } else {
      // no OSM footprint yet: a plain massing block at the real height
      const box = footprint.box || { w: 24, d: 18, cx: 0, cz: 0 };
      k.box(Math.max(6, box.w || 24), bodyH, Math.max(6, box.d || 18), colourFor(id, 'building'), box.cx || 0, bodyH / 2, box.cz || 0);
    }
    for (const p of footprint.parts || []) {
      if (!closed(p.pts)) continue;
      const tag = p.tag || 'building';
      if (FLAT[tag]) {
        k.prism(p.pts, 0, tag === 'water' ? 0.12 : 0.18, FLAT[tag]);
      } else if (WALL_TAGS.has(tag)) {
        const h = Math.max(1, Math.min(p.height_m ?? roofH, H));
        k.prism(p.pts, decked ? bodyH - h : 0, h, colourFor(id, tag));
      }
    }
    k.end('main');
    // the tallest element carries the height guard in fit.js
    k.begin('height');
    const b = outline ? bbox(outline) : { cx: footprint.box?.cx || 0, cz: footprint.box?.cz || 0 };
    k.box(0.4, 0.4, 0.4, 'dark', b.cx, H - 0.4, b.cz);
    k.end('height');
  }
  block.metric = true;
  // The massing model extrudes the outline and every wall/flat part, so the
  // real extent it stands for is their union (not the outline alone). Tags
  // the builder ignores (streets, sites) are left out.
  block.rule = {
    note: 'generic massing from OSM outline and parts; replaced by a detailed builder',
    extent: [/^(building|church|tower|monument|stand|wall|on|water|pitch|garden|park|ruins|square)$/],
  };
  return block;
}

export function blockBuilders(ids) {
  return Object.fromEntries(ids.map((id) => [id, makeBlock(id)]));
}
