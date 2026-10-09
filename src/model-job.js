// Builds one landmark model completely (the same fitLandmark() the node
// scripts run, eager, with the builder loaded from its group chunk) and packs
// the result as transferable arrays. DOM-free. Runs in the model worker
// (model-worker.js); the main thread runs it only as the fallback when no
// worker can be started (model-client.js).
//
// init: {
//   origin: { lat, lon }, grid: terrain.grid (raw DEM, as the tile worker gets it),
//   footprints, dims, landmarks: [{ id, model, lat, lon }],
//   specs: { id: spec }, groupOf: { id: group }
// }
import { createProjection } from './geo.js';
import { fitLandmark, setDims, bakedFit } from './fit.js';
import { makeModels } from './model-build.js';
import { loadGroup } from './models/loader.js';

function pack(g, transfer) {
  const attrs = {};
  for (const [name, a] of Object.entries(g.attributes)) {
    attrs[name] = { array: a.array, itemSize: a.itemSize, normalized: a.normalized };
    transfer.add(a.array.buffer);
  }
  let index = null;
  if (g.index) {
    index = { array: g.index.array };
    transfer.add(g.index.array.buffer);
  }
  return { attrs, index };
}

export function createModelJob(init) {
  setDims(init.dims);
  const P = createProjection(init.origin, null, [], { ...init.grid, heights: Array.from(init.grid.heights) });
  const base = { project: P.project, rawAt: P.terrain.rawAt, footprints: init.footprints };
  const landmarks = new Map(init.landmarks.map((l) => [l.id, l]));

  // lid: the landmark's index in the app's list (the shader's focus id)
  async function build(id, lid) {
    const t0 = performance.now();
    const l = landmarks.get(id);
    if (!l) throw new Error(`unknown landmark ${id}`);
    const group = init.groupOf[id];
    const builders = await loadGroup(group);
    const t1 = performance.now();
    const models = makeModels({ builders: { [id]: builders[id] }, specs: { [id]: init.specs[id] } });
    // the fit warns about a model off its OSM extent; the main thread already
    // printed that from the baked numbers
    const warn = console.warn;
    console.warn = () => {};
    let fit;
    try {
      fit = fitLandmark(l, { ...base, models });
    } finally {
      console.warn = warn;
    }
    const transfer = new Set();
    const out = {
      id,
      lid,
      check: bakedFit(fit),
      geometry: pack(fit.geometry, transfer),
      glass: fit.glass ? pack(fit.glass, transfer) : null,
      pieces: fit.pieces.map((p) => ({ name: p.name, geometry: pack(p.geometry, transfer) })),
      ms: { load: +(t1 - t0).toFixed(1), build: +(performance.now() - t1).toFixed(1) },
    };
    // the stone meshes carry the landmark's index for the focus effect in the shader
    for (const part of [out.geometry, ...out.pieces.map((p) => p.geometry)]) {
      const n = part.attrs.position.array.length / 3;
      const arr = new Float32Array(n).fill(lid);
      part.attrs.aLid = { array: arr, itemSize: 1, normalized: false };
      transfer.add(arr.buffer);
    }
    return { result: out, transfer: [...transfer] };
  }

  return { build };
}
