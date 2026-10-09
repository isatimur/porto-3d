#!/usr/bin/env node
// Writes WebP copies of the landmark photos and panoramas next to the JPEGs:
//   assets/img/<name>.jpg   ->  <name>.webp (full, as large as the source, max 1600 px)
//                               <name>-480.webp (list and label thumbnails)
//   assets/pano/<name>.jpg  ->  <name>.webp
// The app asks for the WebP (src/data.js assetUrl, thumbUrl); the JPEGs stay
// for the social previews (public/p/*) and for browsers without WebP.
// Needs `cwebp` (brew install webp). Safe to run again: newer sources only.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const stale = (src, out) => !existsSync(out) || statSync(out).mtimeMs < statSync(src).mtimeMs;
let n = 0;
let bytesIn = 0;
let bytesOut = 0;
for (const dir of ['assets/img', 'assets/pano']) {
  const abs = join(ROOT, dir);
  for (const f of readdirSync(abs)) {
    if (!/\.jpe?g$/i.test(f)) continue;
    const src = join(abs, f);
    const base = f.replace(/\.jpe?g$/i, '');
    const jobs = [[join(abs, `${base}.webp`), dir === 'assets/img' ? ['-resize', '1280', '0'] : []]];
    if (dir === 'assets/img') jobs.push([join(abs, `${base}-480.webp`), ['-resize', '480', '0']]);
    for (const [out, resize] of jobs) {
      if (!stale(src, out)) continue;
      const q = dir === 'assets/pano' ? '82' : out.endsWith('-480.webp') ? '78' : '68';
      try {
        execFileSync('cwebp', ['-quiet', '-q', q, '-m', '6', ...resize, src, '-o', out], { stdio: 'pipe' });
      } catch {
        // a CMYK or odd JPEG that libjpeg-turbo refuses: ImageMagick converts the colours
        const w = resize[1] ? ['-resize', `${resize[1]}x>`] : [];
        execFileSync('magick', [src, '-colorspace', 'sRGB', ...w, '-quality', q, out], { stdio: 'pipe' });
      }
      n++;
      bytesOut += statSync(out).size;
    }
    bytesIn += statSync(src).size;
  }
}
console.log(`optimize-images: ${n} file(s) written, ${(bytesOut / 1048576).toFixed(1)} MB of WebP for ${(bytesIn / 1048576).toFixed(1)} MB of JPEG`);
