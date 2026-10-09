#!/usr/bin/env node
// Static server for dist/ that behaves like Vercel for the things the bench
// measures: brotli (or gzip) for text, immutable cache on hashed files, the
// same Cache-Control table as vercel.json. `vite preview` sends identity
// bytes, so its transfer sizes would overstate what a visitor downloads.
//
//   node scripts/perf-serve.mjs [port] [--root dir]   (port 5192, root dist/)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { brotliCompress, gzip, constants } from 'node:zlib';
import { promisify } from 'node:util';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
const ROOT = rootIdx >= 0 ? resolve(args[rootIdx + 1]) : join(fileURLToPath(new URL('..', import.meta.url)), 'dist');
const PORT = Number(args.find((a, i) => /^\d+$/.test(a) && i !== rootIdx + 1) || process.env.PORT || 5192);
const br = promisify(brotliCompress);
const gz = promisify(gzip);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain', '.xml': 'application/xml', '.bin': 'application/octet-stream', '.gz': 'application/gzip', '.ktx2': 'image/ktx2', '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.xml', '.webmanifest', '.bin']);
const cache = new Map(); // path+enc -> Buffer (brotli level 11 is slow: do it once)

function cacheControl(url, versioned = false) {
  if (/^\/(assets|static)\//.test(url)) return 'public, max-age=31536000, immutable';
  // data and cities with ?v=<hash> are immutable (the last rules of vercel.json)
  if (versioned && /^\/(data|cities)\//.test(url)) return 'public, max-age=31536000, immutable';
  if (url.startsWith('/data/tiles')) return 'public, max-age=300, stale-while-revalidate=86400';
  if (url.startsWith('/data/')) return 'public, max-age=300, stale-while-revalidate=600';
  if (url === '/sw.js') return 'no-cache';
  if (url.startsWith('/og/')) return 'public, max-age=86400, stale-while-revalidate=604800';
  return 'public, max-age=0, must-revalidate';
}

createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, 'http://x');
    const url = decodeURIComponent(parsed.pathname);
    let file = normalize(join(ROOT, url === '/' ? 'index.html' : url));
    if (!file.startsWith(ROOT)) throw new Error('bad path');
    let st = await stat(file).catch(() => null);
    if (st?.isDirectory()) { file = join(file, 'index.html'); st = await stat(file).catch(() => null); }
    if (!st) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
    const ext = extname(file);
    let body = await readFile(file);
    const headers = { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': cacheControl(url, parsed.searchParams.has('v')), 'access-control-allow-origin': '*' };
    const accept = String(req.headers['accept-encoding'] || '');
    if (COMPRESSIBLE.has(ext) && body.length > 512) {
      const enc = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
      if (enc) {
        const key = `${file}:${enc}`;
        if (!cache.has(key)) {
          cache.set(key, enc === 'br'
            ? await br(body, { params: { [constants.BROTLI_PARAM_QUALITY]: body.length > 4e6 ? 9 : 11, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } })
            : await gz(body, { level: 9 }));
        }
        body = cache.get(key);
        headers['content-encoding'] = enc;
        headers.vary = 'Accept-Encoding';
      }
    }
    // validators like Vercel's: a no-cache fetch revalidates with If-None-Match
    // and gets a 304 instead of the whole file
    headers.etag = `"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}${headers['content-encoding'] ? '-' + headers['content-encoding'] : ''}"`;
    if (req.headers['if-none-match'] === headers.etag) {
      res.writeHead(304, { etag: headers.etag, 'cache-control': headers['cache-control'] });
      res.end();
      return;
    }
    headers['content-length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
}).listen(PORT, () => console.log(`perf-serve: dist/ on http://localhost:${PORT}/`));

// Compress every text file once at start, so no request pays for the encoder
// (the bench would otherwise count the first visit's compression time).
async function warm(dir) {
  const { readdir } = await import('node:fs/promises');
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { await warm(p); continue; }
    if (!COMPRESSIBLE.has(extname(p))) continue;
    const body = await readFile(p);
    if (body.length <= 512) continue;
    cache.set(`${p}:br`, await br(body, { params: { [constants.BROTLI_PARAM_QUALITY]: body.length > 4e6 ? 9 : 11, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } }));
    cache.set(`${p}:gzip`, await gz(body, { level: 9 }));
  }
}
warm(ROOT).then(() => console.log('perf-serve: compressed cache warm')).catch((e) => console.error(e));
