// Procedural textures for the landmark shader (browser only; the data
// textures are built with plain arrays, the azulejo on a 2D canvas).
//
// createStoneTextures() -> { detail, tone, normal }, all 512 x 512, tiling:
//   detail (RGBA): R granite ashlar height (courses, thin joints, pitted
//     faces), G canal roof tiles height, B multi-octave value noise
//     (render, foliage, carved stone), A slate / lead scales.
//   tone (RGBA): R per-block tone of the ashlar (0 cool grey .. 1 warm
//     buff: the two-tone granite of Braga), G mortar mask, B rain streaks
//     (long in v), A grime and lichen patches (roof tiles, plaster base).
//   normal (RGBA): tangent-space normals from the heights, RG = ashlar,
//     BA = roof tiles (z rebuilt in the shader). u runs along the wall or
//     the eave, v up the wall or the roof slope.
// createAzulejoTexture(): the blue-and-white pattern tile of the Palácio do
// Raio façade (sRGB canvas), 8 x 8 tiles.
import * as THREE from 'three';

function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Tileable value noise with period nx x ny cells over `size` pixels.
function valueNoise(size, n, seed, ny = n) {
  const r = lcg(seed);
  const g = new Float32Array(n * ny);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const fx = (x / size) * n;
    const fy = (y / size) * ny;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const at = (i, j) => g[(((j % ny) + ny) % ny) * n + (((i % n) + n) % n)];
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}

function fbm(size, seed) {
  const o = [valueNoise(size, 4, seed), valueNoise(size, 8, seed + 1), valueNoise(size, 16, seed + 2), valueNoise(size, 32, seed + 3), valueNoise(size, 64, seed + 4)];
  return (x, y) => 0.34 * o[0](x, y) + 0.26 * o[1](x, y) + 0.18 * o[2](x, y) + 0.13 * o[3](x, y) + 0.09 * o[4](x, y);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function dataTexture(data, size) {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createStoneTextures(size = 512) {
  const data = new Uint8Array(size * size * 4);
  const tone = new Uint8Array(size * size * 4);
  const hA = new Float32Array(size * size);
  const hT = new Float32Array(size * size);
  const rnd = lcg(7);
  const noise = fbm(size, 11);
  const grime = fbm(size, 41);
  const streak = valueNoise(size, 48, 23, 3);
  const streak2 = valueNoise(size, 96, 29, 5);
  const grain = lcg(99);

  // Ashlar: 8 courses per tile (0.57 m at the shader's 0.22 scale); block
  // joints staggered per course, periodic in x; each block a tone (cool
  // grey or warm buff, 60 / 40) and a face tint.
  const courses = 8;
  const ch = size / courses;
  const joints = [];
  const tint = [];
  const warm = [];
  for (let c = 0; c < courses; c++) {
    const xs = [];
    let x = rnd() * 40;
    while (x < size - 30) {
      xs.push(x);
      x += 44 + rnd() * 66;
    }
    joints.push(xs);
    tint.push(xs.map(() => 0.82 + rnd() * 0.18));
    warm.push(xs.map(() => (rnd() < 0.4 ? 0.65 + rnd() * 0.35 : rnd() * 0.3)));
  }

  // Roof tiles: 16 channels across, 10 rows up; per tile tint.
  const cols = 16;
  const rows = 10;
  const cw = size / cols;
  const rh = size / rows;
  const tileTint = [];
  for (let i = 0; i < cols * rows; i++) tileTint.push(0.78 + rnd() * 0.3);

  // Slate: 24 rows of staggered scales.
  const srows = 24;
  const sh = size / srows;
  const sw = size / 20;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = y * size + x;
      const i = p * 4;
      const nz = noise(x, y);
      const gr = grain();

      // --- ashlar
      const c = Math.floor(y / ch);
      const fy = y - c * ch;
      const xs = joints[c];
      let bi = xs.length - 1;
      for (let k = 0; k < xs.length; k++) if (x >= xs[k]) bi = k;
      const inRun = x >= xs[0];
      const left = inRun ? xs[bi] : xs[xs.length - 1] - size;
      const right = bi + 1 < xs.length && inRun ? xs[bi + 1] : xs[0] + (inRun ? size : 0);
      const dEdge = Math.min(x - left, right - x, fy, ch - fy);
      const mortar = clamp01(1.6 - dEdge); // ~1.3 px joint, soft edge
      const bevel = clamp01(dEdge / 3.5);
      const bj = inRun ? bi : xs.length - 1;
      const t = tint[c][bj];
      // pitted granite face: fine grain on the block, a rounded arris
      const face = (0.72 + 0.28 * bevel) * t * (0.86 + 0.2 * nz) + (gr - 0.5) * 0.1;
      const a = face * (1 - mortar) + 0.28 * mortar;
      data[i] = clamp01(a) * 255;
      hA[p] = a;
      tone[i] = warm[c][bj] * 255;
      tone[i + 1] = mortar * 255;

      // --- canal tiles (u across the eave, v up the slope): convex caps
      // over the channels, each row lapping the one below with a shadow
      const col = Math.floor(x / cw);
      const row = Math.floor(y / rh);
      const off = row % 2 ? 0.5 : 0;
      const fu = (x / cw + off) % 1;
      const fv = (y - row * rh) / rh;
      const channel = Math.pow(Math.sin(Math.PI * fu), 0.7);
      const lap = fv > 0.9 ? 0.5 + (1 - fv) * 3 : fv < 0.1 ? 0.75 + fv * 2.5 : 1;
      const tt = tileTint[row * cols + ((col + (row % 2 ? 0 : 0)) % cols)];
      const tileH = (0.3 + 0.7 * channel) * lap;
      data[i + 1] = clamp01(tileH * tt * (0.86 + 0.2 * nz)) * 255;
      hT[p] = tileH + fv * 0.25; // tiles thicken toward the lower lap

      // --- noise
      data[i + 2] = clamp01(nz * 1.1 + (gr - 0.5) * 0.18) * 255;

      // --- slate scales
      const sr = Math.floor(y / sh);
      const sfu = (x / sw + (sr % 2 ? 0.5 : 0)) % 1;
      const sfv = (y - sr * sh) / sh;
      const edge = Math.min(sfu, 1 - sfu) * sw < 1.2 || sfv < 0.12;
      data[i + 3] = clamp01(edge ? 0.35 : (0.7 + 0.3 * sfv) * (0.85 + 0.25 * nz)) * 255;

      // --- streaks and grime
      tone[i + 2] = clamp01(0.62 * streak(x, y) + 0.38 * streak2(x, y)) * 255;
      tone[i + 3] = clamp01(grime(x, y) * 1.25 - 0.1) * 255;
    }
  }

  // normals from the heights (central differences, wrapping)
  const nrm = new Uint8Array(size * size * 4);
  const at = (h, x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  const pack = (v) => clamp01(v * 0.5 + 0.5) * 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      for (const [h, s, o] of [[hA, 3.2, 0], [hT, 5.5, 2]]) {
        let nx = -(at(h, x + 1, y) - at(h, x - 1, y)) * s;
        let ny = -(at(h, x, y + 1) - at(h, x, y - 1)) * s;
        const l = Math.hypot(nx, ny, 1);
        nrm[i + o] = pack(nx / l);
        nrm[i + o + 1] = pack(ny / l);
      }
    }
  }
  return { detail: dataTexture(data, size), tone: dataTexture(tone, size), normal: dataTexture(nrm, size) };
}

// 8 x 8 tiles of the Raio pattern (the façade reads cobalt with a white
// lattice from the square): every tile carries a white four-point star
// quartered at its corners (so stars form where four tiles meet), a small
// white cross-flower in the middle, thin white diagonals joining them;
// glaze varies a little from tile to tile.
export function createAzulejoTexture(size = 512) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const n = 8;
  const t = size / n;
  const rnd = lcg(5);
  const star = (cx, cy, r) => {
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const rr = k % 2 ? r * 0.32 : r;
      ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = i * t;
      const y = j * t;
      const v = Math.floor(232 + rnd() * 16);
      const white = `rgb(${v - 6},${v - 2},${v})`;
      const b = rnd();
      const blue = `rgb(${58 + b * 16},${86 + b * 20},${168 + b * 28})`;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, t, t);
      ctx.clip();
      ctx.fillStyle = blue;
      ctx.fillRect(x, y, t, t);
      // glaze: a soft lighter pool in each tile
      const gl = ctx.createRadialGradient(x + t * 0.4, y + t * 0.35, 1, x + t / 2, y + t / 2, t * 0.75);
      gl.addColorStop(0, 'rgba(255,255,255,0.12)');
      gl.addColorStop(1, 'rgba(0,0,40,0.1)');
      ctx.fillStyle = gl;
      ctx.fillRect(x, y, t, t);
      ctx.fillStyle = white;
      for (const [cx, cy] of [[x, y], [x + t, y], [x, y + t], [x + t, y + t]]) star(cx, cy, t * 0.3);
      ctx.strokeStyle = white;
      ctx.lineWidth = t * 0.035;
      ctx.beginPath();
      ctx.moveTo(x + t * 0.18, y + t * 0.18);
      ctx.lineTo(x + t * 0.82, y + t * 0.82);
      ctx.moveTo(x + t * 0.82, y + t * 0.18);
      ctx.lineTo(x + t * 0.18, y + t * 0.82);
      ctx.stroke();
      // centre: a small four-petal flower, blue heart
      const mx = x + t / 2;
      const my = y + t / 2;
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        ctx.beginPath();
        ctx.ellipse(mx + Math.cos(a) * t * 0.09, my + Math.sin(a) * t * 0.09, t * 0.08, t * 0.045, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(mx, my, t * 0.04, 0, Math.PI * 2);
      ctx.fillStyle = blue;
      ctx.fill();
      ctx.restore();
      // grout
      ctx.fillStyle = 'rgba(205,205,200,0.8)';
      ctx.fillRect(x, y, t, 1.5);
      ctx.fillRect(x, y, 1.5, t);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
