// Fine core terrain pack (data/terrain-fine.bin.gz, scripts/fetch-terrain-fine.mjs).
// DOM-free: node scripts and the tile / model workers import it too.
//
// Layout (little endian):
//   u32 magic 'TF01'  u32 cols  u32 rows  f32 step_m  f64 s, w, n, e
//   i16[cols * rows] residuals of the heights in decimetres, row 0 = south,
//   predictor: left + up - upleft (the first row and column use what exists).
// A decimetre is far below the DEM's own error, and the residuals of a smooth
// surface are small, so gzip packs the lot to about a fifth of the raw size.

const MAGIC = 0x31304654; // 'TF01'
const HEAD = 4 + 4 + 4 + 4 + 8 * 4;

export function packFine({ cols, rows, step_m, bbox, heights }) {
  const out = new ArrayBuffer(HEAD + cols * rows * 2);
  const dv = new DataView(out);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, cols, true);
  dv.setUint32(8, rows, true);
  dv.setFloat32(12, step_m, true);
  dv.setFloat64(16, bbox.s, true);
  dv.setFloat64(24, bbox.w, true);
  dv.setFloat64(32, bbox.n, true);
  dv.setFloat64(40, bbox.e, true);
  const q = new Int32Array(cols * rows);
  for (let i = 0; i < q.length; i++) q[i] = Math.round(heights[i] * 10);
  const res = new Int16Array(out, HEAD, cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const l = c ? q[i - 1] : r ? q[i - cols] : 0;
      const u = r ? q[i - cols] : l;
      const ul = r && c ? q[i - cols - 1] : u;
      res[i] = q[i] - (l + u - ul);
    }
  }
  return new Uint8Array(out);
}

// buf: ArrayBuffer (or Uint8Array) of the gunzipped pack. Returns
// { bbox, cols, rows, step_m, heights: Float32Array (m above sea level), min_m, max_m }.
export function unpackFine(buf) {
  const ab = buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const dv = new DataView(ab);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('terrain-fine: bad magic');
  const cols = dv.getUint32(4, true);
  const rows = dv.getUint32(8, true);
  const step_m = dv.getFloat32(12, true);
  const bbox = { s: dv.getFloat64(16, true), w: dv.getFloat64(24, true), n: dv.getFloat64(32, true), e: dv.getFloat64(40, true) };
  const res = new Int16Array(ab, HEAD, cols * rows);
  const q = new Int32Array(cols * rows);
  const heights = new Float32Array(cols * rows);
  let min = Infinity;
  let max = -Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const l = c ? q[i - 1] : r ? q[i - cols] : 0;
      const u = r ? q[i - cols] : l;
      const ul = r && c ? q[i - cols - 1] : u;
      q[i] = res[i] + (l + u - ul);
      const h = q[i] / 10;
      heights[i] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  return { bbox, cols, rows, step_m, heights, min_m: min, max_m: max };
}
