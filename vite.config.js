import { defineConfig } from 'vite';
import { cpSync, existsSync } from 'node:fs';
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

export default defineConfig({
  base: './',
  publicDir: 'public',
  build: {
    assetsDir: 'static',
    chunkSizeWarningLimit: 1200,
  },
  plugins: [copyRuntimeData()],
});
