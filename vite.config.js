import { defineConfig } from 'vite';
import { cpSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// In dev, Vite serves /data, /assets and /cities straight from the project
// root. For the build, copy them into dist/ when they exist. The bundle goes
// to dist/static so it never collides with assets/img from the data
// pipeline. cities/<id>.json is the per-city config src/city.js fetches;
// VITE_CITY=<id> at build time pins the city (one Vercel project per city).
const ROOT = import.meta.dirname;

function copyRuntimeData() {
  let outDir = 'dist';
  return {
    name: 'copy-runtime-data',
    apply: 'build',
    configResolved(cfg) {
      outDir = cfg.build.outDir;
    },
    closeBundle() {
      for (const dir of ['data', 'assets', 'cities']) {
        const src = resolve(ROOT, dir);
        if (!existsSync(src)) {
          console.warn(`[copy-runtime-data] ${dir}/ not found, skipped (app will use placeholders)`);
          continue;
        }
        cpSync(src, resolve(ROOT, outDir, dir), {
          recursive: true,
          dereference: true,
          filter: (p) => !p.includes('/.cache'),
        });
        console.log(`[copy-runtime-data] copied ${dir}/ -> ${outDir}/${dir}/`);
      }
    },
  };
}

// Content hashes of the runtime data (src/data.js assetUrl): a data URL gets
// ?v=<hash>, so vercel.json can cache it as immutable, and a changed file is a
// new URL. The tile folders share the hash of their index.json.
function dataVersions() {
  const map = {};
  const hash = (file) => createHash('md5').update(readFileSync(file)).digest('hex').slice(0, 8);
  for (const dir of ['data', 'data/gtfs', 'cities']) {
    const abs = resolve(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) if (f.endsWith('.json') || f.endsWith('.bin.gz')) map[`${dir}/${f}`] = hash(resolve(abs, f));
  }
  // one hash per tile folder, over every file in it (names and bytes)
  for (const dir of ['data/tiles', 'data/tiles-ms']) {
    const abs = resolve(ROOT, dir);
    if (!existsSync(abs)) continue;
    const h = createHash('md5');
    for (const f of readdirSync(abs).sort()) {
      h.update(f);
      h.update(readFileSync(resolve(abs, f)));
    }
    map[`${dir}/`] = h.digest('hex').slice(0, 8);
  }
  return map;
}

export default defineConfig({
  base: './',
  publicDir: 'public',
  define: { __DATA_V__: JSON.stringify(dataVersions()) },
  build: {
    assetsDir: 'static',
    chunkSizeWarningLimit: 1200,
  },
  plugins: [copyRuntimeData()],
});
