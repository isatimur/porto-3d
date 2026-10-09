// Async builder chunks, one per group of landmarks (src/models/groups/*.js):
// ten chunks, grouped by neighbourhood and type. Each is a map
// { [landmarkId]: builder }. DOM-free (the model worker, the main-thread
// fallback and node import it). Which group an id lives in is written into
// data/fits.json by scripts/bake-fits.mjs (it fails when an id is in none).
export const GROUP_LOADERS = {
  bridges: () => import('./groups/bridges.js'),
  'churches-core': () => import('./groups/churches-core.js'),
  'churches-outer': () => import('./groups/churches-outer.js'),
  civic: () => import('./groups/civic.js'),
  museums: () => import('./groups/museums.js'),
  theatres: () => import('./groups/theatres.js'),
  coast: () => import('./groups/coast.js'),
  parks: () => import('./groups/parks.js'),
  river: () => import('./groups/river.js'),
  stadiums: () => import('./groups/stadiums.js'),
};

const loaded = new Map();

// Loads one group (once); resolves to its { id: builder } map.
export function loadGroup(name) {
  let p = loaded.get(name);
  if (!p) {
    const load = GROUP_LOADERS[name];
    if (!load) return Promise.reject(new Error(`unknown model group "${name}"`));
    p = load().then((m) => m.default);
    p.catch(() => loaded.delete(name)); // a failed fetch can be retried
    loaded.set(name, p);
  }
  return p;
}

// All builders of the given groups, merged.
export async function loadGroups(names) {
  const maps = await Promise.all([...new Set(names)].map(loadGroup));
  return Object.assign({}, ...maps);
}
