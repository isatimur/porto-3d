// data/buildings.bin.gz: the OSM core buildings (scripts/pack-buildings.mjs) as
// typed arrays instead of a 9 MB JSON tree. Decoding is a few array views and
// one scan over the step bytes: no JSON parse, no 355 000 tiny point arrays.
// buildBuildings reads one building at a time through `at(i)` and lets it go.
//
// Layout (little-endian), after a 4-byte magic and the header length. Every
// block starts on a 4-byte boundary:
//   header   JSON: { origin, bbox, hist, count, points, kinds[], heights[], extras[], firstBytes, stepBytes }
//            extras: [[building index, { r, rc, wc, m, ro, s, lv, rh }], ...]
//   counts   Uint8   points per building
//   kind     Uint8   index into header.kinds
//   height   Uint8   index into header.heights (metres)
//   firsts   varints (zigzag) the first point of every building, lat and lon in
//            1e-5 degrees, as the step from the previous building's first point
//   steps    varints (zigzag) every further point as the step from the previous point
// Every coordinate in buildings.json has five decimals, so the packing is lossless,
// and the file gzips to about 40 % of the brotli-compressed JSON.

const MAGIC = 0x32425042; // 'BPB2'
const SCALE = 1e5;
const zig = (n) => (n << 1) ^ (n >> 31);
const unzig = (v) => (v >>> 1) ^ -(v & 1);
function putVarint(out, v) {
  while (v >= 128) {
    out.push((v & 127) | 128);
    v >>>= 7;
  }
  out.push(v);
}
const pad4 = (n) => (4 - (n % 4)) % 4;

export function packBuildings(data) {
  const list = data.buildings;
  const n = list.length;
  const kinds = [];
  const heights = [];
  const kindIdx = new Map();
  const heightIdx = new Map();
  const counts = new Uint8Array(n);
  const kind = new Uint8Array(n);
  const height = new Uint8Array(n);
  const firsts = [];
  const steps = [];
  const extras = [];
  let points = 0;
  let pfa = 0;
  let pfo = 0;
  list.forEach((b, i) => {
    if (b.p.length > 255) throw new Error(`building ${i}: ${b.p.length} points (max 255)`);
    points += b.p.length;
    counts[i] = b.p.length;
    if (!kindIdx.has(b.k)) kindIdx.set(b.k, kinds.push(b.k) - 1);
    kind[i] = kindIdx.get(b.k);
    if (!heightIdx.has(b.h)) heightIdx.set(b.h, heights.push(b.h) - 1);
    height[i] = heightIdx.get(b.h);
    let pa = Math.round(b.p[0][0] * SCALE);
    let po = Math.round(b.p[0][1] * SCALE);
    putVarint(firsts, zig(pa - pfa));
    putVarint(firsts, zig(po - pfo));
    pfa = pa;
    pfo = po;
    for (let j = 1; j < b.p.length; j++) {
      const a = Math.round(b.p[j][0] * SCALE);
      const o = Math.round(b.p[j][1] * SCALE);
      putVarint(steps, zig(a - pa));
      putVarint(steps, zig(o - po));
      pa = a;
      po = o;
    }
    const ex = {};
    for (const k of ['r', 'rc', 'wc', 'm', 'ro', 's', 'lv', 'rh']) if (b[k] != null) ex[k] = b[k];
    if (Object.keys(ex).length) extras.push([i, ex]);
  });
  if (heights.length > 255 || kinds.length > 255) throw new Error('too many distinct heights or kinds');
  const head = new TextEncoder().encode(
    JSON.stringify({ origin: data.origin, bbox: data.bbox, hist: data.hist, count: n, points, kinds, heights, extras, firstBytes: firsts.length, stepBytes: steps.length }),
  );
  const blocks = [counts, kind, height, Uint8Array.from(firsts), Uint8Array.from(steps)];
  const start = 8 + head.length;
  let size = start + pad4(start);
  for (const b of blocks) size += b.length + pad4(b.length);
  const buf = new Uint8Array(size);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, head.length, true);
  buf.set(head, 8);
  let at = start + pad4(start);
  for (const b of blocks) {
    buf.set(b, at);
    at += b.length + pad4(b.length);
  }
  return buf;
}

// buf: ArrayBuffer. Returns { origin, bbox, hist, buildings } with `buildings`
// array-like: length and at(i) -> { p: [[lat, lon], ...], h, k, ...extras }.
export function unpackBuildings(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('not a buildings.bin (BPB2)');
  const hl = dv.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl)));
  const n = header.count;
  let at = 8 + hl + pad4(8 + hl);
  const view = (len) => {
    const a = new Uint8Array(buf, at, len);
    at += len + pad4(len);
    return a;
  };
  const counts = view(n);
  const kind = view(n);
  const height = view(n);
  const fb = view(header.firstBytes);
  const sb = view(header.stepBytes);
  // the first points: running sums of the steps between buildings
  const first = new Int32Array(n * 2);
  {
    let p = 0;
    let a = 0;
    let o = 0;
    const next = () => {
      let v = 0;
      let shift = 0;
      let byte;
      do {
        byte = fb[p++];
        v |= (byte & 127) << shift;
        shift += 7;
      } while (byte & 128);
      return unzig(v >>> 0);
    };
    for (let i = 0; i < n; i++) {
      a += next();
      o += next();
      first[i * 2] = a;
      first[i * 2 + 1] = o;
    }
  }
  // where each building's steps start in the step bytes: one scan
  const start = new Uint32Array(n);
  {
    let p = 0;
    for (let i = 0; i < n; i++) {
      start[i] = p;
      for (let k = (counts[i] - 1) * 2; k > 0; k--) while (sb[p++] & 128);
    }
  }
  const extra = new Map(header.extras);
  const buildings = {
    length: n,
    at(i) {
      const c = counts[i];
      const p = new Array(c);
      let la = first[i * 2];
      let lo = first[i * 2 + 1];
      p[0] = [la / SCALE, lo / SCALE];
      let q = start[i];
      for (let j = 1; j < c; j++) {
        let v = 0;
        let shift = 0;
        let byte;
        do {
          byte = sb[q++];
          v |= (byte & 127) << shift;
          shift += 7;
        } while (byte & 128);
        la += unzig(v >>> 0);
        v = 0;
        shift = 0;
        do {
          byte = sb[q++];
          v |= (byte & 127) << shift;
          shift += 7;
        } while (byte & 128);
        lo += unzig(v >>> 0);
        p[j] = [la / SCALE, lo / SCALE];
      }
      const b = { p, h: header.heights[height[i]], k: header.kinds[kind[i]] };
      const ex = extra.get(i);
      return ex ? Object.assign(b, ex) : b;
    },
    // for scripts: the plain list
    toArray() {
      return Array.from({ length: n }, (_, i) => this.at(i));
    },
  };
  return { origin: header.origin, bbox: header.bbox, hist: header.hist, buildings };
}
