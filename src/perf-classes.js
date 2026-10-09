// Device classes and their budgets: the one table the quality system reads.
//
//   P   potato   software rendering (SwiftShader, llvmpipe) or a very old GPU
//   S   low      budget phones, old integrated GPUs
//   M   medium   flagship phones, integrated GPUs of the last years
//   L   high     strong laptops and mid desktops
//   XL  ultra    discrete or Apple-silicon desktop GPUs
//
// perf.js scores the device and picks a class; the user can pick one in the
// menu (Auto / Ultra / High / Medium / Low / Potato); the governor
// (governor.js) moves inside a class with `pressure` and, when a class is
// not enough, down to the next one. No DOM here: scripts/smoke-perf.mjs runs
// this file in Node.
//
// Every number below has a consumer in the engine; the comment says where.

export const CLASS_ORDER = ['P', 'S', 'M', 'L', 'XL'];

export const CLASSES = {
  XL: {
    label: 'Ultra',
    lite: false, // false: the desktop module budgets; true: the phone budgets (main.js `LITE`)
    dprCap: 2, // scene.js DPR.cap: device pixel ratio ceiling
    shadow: 4096, // sun shadow map size (scene.js setShadowSize)
    shadowCasters: 'all', // 'all' | 'landmarks' | 'none' (main.js render loop)
    postLevel: 0, // effects.js setPostLevel: 0 all, 1 no sun rays, 2 no bloom, 3 no SMAA, 4 none
    fx: true, // composer on at start
    tileScale: 1, // tiles.js setBudgetScale: streamed tile radius and budget
    landmarkNearM: 2200, // landmarks.js setNearRadiusM: full-detail radius
    modelsKeep: 70, // landmarks.js setModelBudget: detailed models kept built (the rest are freed, farthest first)
    modelsAhead: 1.35, // build a model when the camera is within this x its full-detail radius
    modelsIdle: 20, // build this many (in list order) in idle time after the first full frame
    natureNearM: 220, // nature.js setNearRadius
    trees: 5000, // buildNature budget (tree clumps)
    cars: 600, // life.js carMax
    people: 1, // people cap multiplier (porto-streetscape.js)
    birds: 40,
    geoK: 1, // multiplies the geometry LOD distances (main.js applyGeoLod, buildings DETAIL_M / MID_M)
    labels: 70, // landmark labels drawn at once (main.js declutter)
    labelHz: 60, // label projection and style writes per second
    simHz: 60, // traffic, people, birds, fountains
    waterLite: false,
    targetMs: 18, // governor: p95 frame time to hold
    budget: { tris: 2.4e6, calls: 400, gpuMB: 900 },
  },
  L: {
    label: 'High',
    lite: false,
    dprCap: 1.75,
    shadow: 2048,
    shadowCasters: 'all',
    postLevel: 1,
    fx: true,
    tileScale: 0.85,
    landmarkNearM: 1800,
    modelsKeep: 70,
    modelsAhead: 1.35,
    modelsIdle: 12,
    natureNearM: 190,
    trees: 3500,
    cars: 400,
    people: 0.8,
    birds: 30,
    geoK: 0.9,
    labels: 70,
    labelHz: 30,
    simHz: 60,
    waterLite: false,
    targetMs: 20,
    budget: { tris: 1.8e6, calls: 320, gpuMB: 600 },
  },
  M: {
    label: 'Medium',
    lite: true,
    dprCap: 1.5,
    shadow: 1024,
    shadowCasters: 'landmarks',
    postLevel: 4,
    fx: false,
    tileScale: 1, // the phone tile budget (tiles.js `mobile`) is the Medium baseline
    landmarkNearM: 1400,
    modelsKeep: 24,
    modelsAhead: 1.5,
    modelsIdle: 0,
    natureNearM: 160,
    trees: 1200,
    cars: 150,
    people: 0.6,
    birds: 20,
    geoK: 1, // the phone distances in main.js GEO_LOD are already the Medium baseline
    labels: 40,
    labelHz: 20,
    simHz: 30,
    waterLite: true,
    targetMs: 24,
    budget: { tris: 1.2e6, calls: 220, gpuMB: 380 },
  },
  S: {
    label: 'Low',
    lite: true,
    dprCap: 1.25,
    shadow: 1024,
    shadowCasters: 'landmarks',
    postLevel: 4,
    fx: false,
    tileScale: 0.8,
    landmarkNearM: 1100,
    modelsKeep: 14,
    modelsAhead: 1.6,
    modelsIdle: 0,
    natureNearM: 130,
    trees: 800,
    cars: 100,
    people: 0.4,
    birds: 10,
    geoK: 0.8,
    labels: 24,
    labelHz: 10,
    simHz: 30,
    waterLite: true,
    targetMs: 36,
    budget: { tris: 0.8e6, calls: 160, gpuMB: 250 },
  },
  P: {
    label: 'Potato',
    lite: true,
    dprCap: 1,
    shadow: 0, // no shadow pass at all
    shadowCasters: 'none',
    postLevel: 4,
    fx: false,
    tileScale: 0.55,
    landmarkNearM: 700,
    modelsKeep: 8,
    modelsAhead: 1.6,
    modelsIdle: 0,
    natureNearM: 90,
    trees: 300,
    cars: 40,
    people: 0.2,
    birds: 0,
    geoK: 0.6,
    labels: 12,
    labelHz: 5,
    simHz: 15,
    waterLite: true,
    targetMs: 80,
    budget: { tris: 0.4e6, calls: 100, gpuMB: 150 },
  },
};

// The menu: label, stored value, class. Auto has no class of its own.
export const QUALITY_MODES = [
  { id: 'auto', cls: null },
  { id: 'ultra', cls: 'XL' },
  { id: 'high', cls: 'L' },
  { id: 'medium', cls: 'M' },
  { id: 'low', cls: 'S' },
  { id: 'potato', cls: 'P' },
];

// ?quality= values: the menu's ids, or the class letters (xl, l, m, s, p).
// The old two-tier URLs: high used to force the desktop tier and low the
// phone tier; both still force a fixed class, High is now the class below Ultra.
export function parseQuality(v) {
  if (!v) return null;
  const s = String(v).toLowerCase();
  const alias = { xl: 'ultra', l: 'high', m: 'medium', mid: 'medium', s: 'low', p: 'potato' };
  const id = alias[s] || s;
  return QUALITY_MODES.some((m) => m.id === id) ? id : null;
}
export function modeToClass(id) {
  return QUALITY_MODES.find((m) => m.id === id)?.cls ?? null;
}
export function classDown(cls) {
  const i = CLASS_ORDER.indexOf(cls);
  return i > 0 ? CLASS_ORDER[i - 1] : cls;
}
export function classUp(cls) {
  const i = CLASS_ORDER.indexOf(cls);
  return i < CLASS_ORDER.length - 1 ? CLASS_ORDER[i + 1] : cls;
}

// ------------------------------------------------------------------ GPU table
// UNMASKED_RENDERER_WEBGL → a 0..100 score. First match wins; order matters.
// 'ANGLE (Vendor, Renderer, ...)' wrappers are matched through the inner text.
export const GPU_RULES = [
  [/swiftshader|llvmpipe|softpipe|software|microsoft basic render|mesa offscreen|lavapipe/i, 5, 'software'],
  // Apple silicon (Chrome/Firefox expose the chip; Safari says "Apple GPU")
  [/apple m[3-9]|apple m2 (pro|max|ultra)|apple m1 (max|ultra)/i, 92, 'apple-m-high'],
  [/apple m2|apple m1 pro/i, 86, 'apple-m'],
  [/apple m1/i, 80, 'apple-m1'],
  [/apple a(1[7-9]|[2-9]\d)/i, 60, 'apple-a17+'],
  [/apple a1[5-6]/i, 56, 'apple-a15'],
  [/apple a(1[0-4]|[89])\b/i, 46, 'apple-a-old'],
  // NVIDIA
  [/rtx\s*(40|50)\d\d|rtx\s*a\d|rtx\s*[3]0[789]0|rtx\s*3080|rtx\s*3090/i, 96, 'nvidia-rtx-high'],
  [/rtx\s*[23]0\d\d|rtx|gtx\s*(16\d\d|1080|1070)/i, 86, 'nvidia-rtx'],
  [/gtx\s*10(5|6)0|gtx\s*9|gtx\s*7|gtx|geforce\s*(mx|gt)\s*[1-9]\d\d/i, 62, 'nvidia-gtx'],
  [/geforce|nvidia|quadro/i, 55, 'nvidia'],
  // AMD
  [/radeon\s*(rx\s*)?(7\d{3}|6[5-9]\d\d)|radeon pro w/i, 92, 'amd-rdna3'],
  [/radeon\s*rx\s*(5\d{3}|6[0-4]\d\d)|rx\s*vega|vega\s*(56|64)/i, 80, 'amd-rdna'],
  [/radeon\s*rx|radeon\s*r[579]\s*\d{3}/i, 62, 'amd-gcn'],
  [/radeon\(tm\)\s*(vega|graphics)|radeon\s+graphics|amd radeon/i, 52, 'amd-apu'],
  // Intel
  [/intel.*arc|arc\(tm\)|arc\s*a\d/i, 72, 'intel-arc'],
  [/iris\(r\)?\s*xe|iris xe/i, 56, 'intel-xe'],
  [/iris\s*(plus|pro)|iris\(tm\)|iris\(r\)/i, 44, 'intel-iris'],
  [/uhd\s*graphics\s*(7\d\d|6[3-9]\d)|uhd graphics 6[0-2]\d|uhd/i, 38, 'intel-uhd'],
  [/hd graphics\s*(5\d\d|6\d\d)/i, 30, 'intel-hd5-6'],
  [/hd graphics/i, 22, 'intel-hd'],
  [/intel/i, 34, 'intel'],
  // Qualcomm Adreno
  [/adreno.*\b(8\d\d)\b/i, 74, 'adreno-8xx'],
  [/adreno.*\b7\d\d\b/i, 66, 'adreno-7xx'],
  [/adreno.*\b6[5-9]\d\b/i, 56, 'adreno-65x+'],
  [/adreno.*\b6[0-4]\d\b/i, 36, 'adreno-6xx'],
  [/adreno.*\b5\d\d\b/i, 28, 'adreno-5xx'],
  [/adreno/i, 16, 'adreno-old'],
  // ARM Mali / Immortalis
  [/immortalis/i, 68, 'immortalis'],
  [/mali-g(7[1-9]\d|[89]\d\d)/i, 60, 'mali-g710+'],
  [/mali-g(7[0-9])\b/i, 44, 'mali-g7x'],
  [/mali-g(5\d|6\d)\b/i, 34, 'mali-g5x-6x'],
  [/mali-g/i, 28, 'mali-g'],
  [/mali-t|mali-4|mali/i, 14, 'mali-old'],
  // PowerVR, others
  [/powervr.*(b|c)xt|powervr.*cxt/i, 38, 'powervr-xt'],
  [/powervr/i, 20, 'powervr'],
  [/videocore|vivante|tegra/i, 12, 'embedded'],
  [/apple gpu|apple/i, 70, 'apple-generic'], // Safari: the chip is hidden
];

export function gpuScore(renderer, { mobile = false } = {}) {
  const s = String(renderer || '');
  for (const [re, score, tag] of GPU_RULES) {
    if (re.test(s)) {
      // Safari reports "Apple GPU" for a Mac and for an iPhone alike
      if (tag === 'apple-generic' && mobile) return { score: 50, tag: 'apple-generic-mobile' };
      return { score, tag };
    }
  }
  return { score: s ? 40 : 30, tag: s ? 'unknown' : 'no-info' };
}

// ------------------------------------------------------------------ classify
// caps: { renderer, mobile, cores, memoryGB, screenW, screenH, dpr,
//         saveData, lowPower, maxTexture, webgl2 }
// Returns { cls, score, reasons } with every adjustment spelled out, so the
// ?perf=1 overlay can say why the device landed where it did.
export function classify(caps) {
  const reasons = [];
  const g = gpuScore(caps.renderer, { mobile: caps.mobile });
  let score = g.score;
  reasons.push(`gpu ${g.tag} ${g.score}`);
  if (g.tag === 'software') return { cls: 'P', score, reasons, gpuTag: g.tag };
  if (caps.mobile && score > 54) {
    score = 54; // phones throttle: never above Medium on the chip alone
    reasons.push('phone cap 54');
  }
  const adj = (d, why) => {
    if (!d) return;
    score += d;
    reasons.push(`${why} ${d > 0 ? '+' : ''}${d}`);
  };
  const cores = caps.cores || 4;
  adj(cores <= 2 ? -14 : cores <= 4 ? -5 : 0, `cores ${cores}`);
  const mem = caps.memoryGB;
  if (mem) adj(mem <= 1 ? -22 : mem <= 2 ? -12 : mem <= 4 ? -6 : 0, `memory ${mem} GB`);
  const px = (caps.screenW || 0) * (caps.screenH || 0) * (caps.dpr || 1) ** 2;
  if (score < 70 && px > 8.3e6) adj(-8, '4K-class screen on a modest GPU');
  if (caps.saveData) adj(-6, 'save-data');
  if (caps.lowPower) adj(-12, 'power saver (30 Hz)');
  if ((caps.maxTexture || 8192) < 4096) adj(-12, 'max texture < 4096');
  score = Math.max(0, Math.min(100, Math.round(score)));
  const cls = score >= 75 ? 'XL' : score >= 55 ? 'L' : score >= 32 ? 'M' : score >= 15 ? 'S' : 'P';
  return { cls, score, reasons, gpuTag: g.tag };
}

// ------------------------------------------------------------------ pressure
// The governor's one dial. Pressure p applies the first p moves, in this
// order: the cheapest, least visible cuts first. The dynamic resolution
// scale comes first because it costs nothing in geometry or logic and is the
// hardest to see; the geometry cuts at close range (geo) come in the middle;
// the effects stack goes before the scenery counts. Each move sets one knob
// to a fraction of the class baseline. Going back up undoes them in reverse.
export const MOVES = [
  ['res', 0.95], ['res', 0.9], ['res', 0.85], ['res', 0.8],
  ['shadow', 0.5],
  ['res', 0.75],
  ['post', 1],
  ['res', 0.7],
  ['count', 0.75],
  ['geo', 0.85], // near-LOD distances: fewer facade and roof details close up
  ['post', 2],
  ['res', 0.65],
  ['radius', 0.8],
  ['hz', 0.6], // labels and simulation at 60 % of the class rate
  ['shadow', 0.25],
  ['post', 3],
  ['count', 0.5],
  ['geo', 0.7],
  ['water', 1],
  ['res', 0.6],
  ['radius', 0.65],
  ['res', 0.55],
  ['geo', 0.55],
  ['count', 0.3],
  ['hz', 0.35],
  ['res', 0.5],
  ['post', 4],
  ['shadow', 0],
];
export const MAX_PRESSURE = MOVES.length;

const NEUTRAL = { res: 1, shadow: 1, post: 0, count: 1, geo: 1, radius: 1, hz: 1, water: 0 };

// The knob record for a class at a pressure. `post` is the effects.js level
// (never lower than the class's own), the rest are multipliers or flags.
export function knobsFor(cls, pressure) {
  const c = CLASSES[cls] || CLASSES.M;
  const k = { ...NEUTRAL };
  const n = Math.max(0, Math.min(MAX_PRESSURE, Math.round(pressure)));
  for (let i = 0; i < n; i++) k[MOVES[i][0]] = MOVES[i][1];
  return {
    pressure: n,
    res: k.res, // dynamic resolution scale on top of the class dprCap
    dpr: +(c.dprCap * k.res).toFixed(3),
    shadow: c.shadow === 0 ? 0 : k.shadow === 0 ? 0 : Math.max(512, Math.round((c.shadow * k.shadow) / 256) * 256),
    post: Math.max(c.postLevel, k.post),
    count: k.count,
    geo: +(c.geoK * k.geo).toFixed(3),
    radius: +(c.tileScale * k.radius).toFixed(3),
    landmarkNearM: Math.round(c.landmarkNearM * k.radius),
    modelsKeep: c.modelsKeep ?? 70,
    modelsAhead: c.modelsAhead ?? 1.5,
    modelsIdle: c.modelsIdle ?? 0,
    natureNearM: Math.round(c.natureNearM * k.radius),
    labelHz: Math.max(2, Math.round(c.labelHz * k.hz)),
    simHz: Math.max(5, Math.round(c.simHz * k.hz)),
    waterLite: c.waterLite || !!k.water,
  };
}
