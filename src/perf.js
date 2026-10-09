// Performance system: what the device is, which class it gets, how the
// governor moves inside that class, and the numbers shown to the user.
//
//   detectCaps()      WebGL, renderer string, memory, cores, screen, network
//   initPerf()        picks the class (URL > menu choice > learned > detected),
//                     measures the display cadence, wires the governor
//   perf.frame()      called once per drawn frame (frame stats, governor)
//   perf overlay      ?perf=1 or Shift+P: fps, p95, tris, calls, class,
//                     pressure, GPU and JS memory, and an Export JSON button
//
// The tables live in perf-classes.js, the control loop in governor.js; both
// run in Node under scripts/smoke-perf.mjs. This file touches the DOM.
import { CLASSES, CLASS_ORDER, MAX_PRESSURE, QUALITY_MODES, classify, knobsFor, modeToClass, parseQuality } from './perf-classes.js';
import { createGovernor } from './governor.js';

const KEY_MODE = 'porto-quality'; // the menu choice: auto | ultra | high | medium | low | potato
const KEY_LAST = 'porto-class-last'; // the class an earlier visit ended in: { cls, at }
const LAST_MAX_AGE = 14 * 24 * 3600 * 1000;

const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      // storage may be blocked: the choice lasts for this page
    }
  },
};

// ------------------------------------------------------------------ GL memory
// Bytes the page asked the GPU for (bufferData, texImage2D, texStorage2D,
// renderbufferStorage) minus what it deleted. Installed before three creates
// its context. Drivers add padding and mip chains: read it as a lower bound.
const GL = { bufferBytes: 0, textureBytes: 0, renderbufferBytes: 0, peak: 0 };
function installGlAccounting() {
  const proto = globalThis.WebGL2RenderingContext?.prototype;
  if (!proto || proto.__portoGl) return;
  proto.__portoGl = true;
  const C = WebGL2RenderingContext;
  const BPP = new Map([
    [C.RGBA8, 4], [C.RGBA, 4], [C.RGB, 4], [C.RGB8, 4], [C.SRGB8_ALPHA8, 4], [C.RGBA16F, 8], [C.RGB16F, 8], [C.RGBA32F, 16],
    [C.R11F_G11F_B10F, 4], [C.DEPTH_COMPONENT24, 4], [C.DEPTH_COMPONENT32F, 4], [C.DEPTH24_STENCIL8, 4], [C.DEPTH_COMPONENT16, 2], [C.DEPTH_COMPONENT, 4],
    [C.R8, 1], [C.RG8, 2], [C.R16F, 2], [C.RG16F, 4], [C.R32F, 4], [C.RGBA4, 2], [C.RGB5_A1, 2], [C.RGB565, 2], [C.LUMINANCE, 1], [C.LUMINANCE_ALPHA, 2], [C.ALPHA, 1], [C.RED, 1], [C.RG, 2],
  ]);
  const bpp = (f) => BPP.get(f) ?? 4;
  const total = () => GL.bufferBytes + GL.textureBytes + GL.renderbufferBytes;
  const per = new WeakMap(); // gl -> { target buffers, texture units, sizes }
  const st = (gl) => {
    let s = per.get(gl);
    if (!s) per.set(gl, (s = { buf: new Map(), bufSize: new WeakMap(), unit: 0, tex: new Map(), texSize: new WeakMap(), texBase: new WeakMap(), rb: null, rbSize: new WeakMap() }));
    return s;
  };
  const wrap = (name, fn) => {
    const orig = proto[name];
    if (!orig) return;
    proto[name] = function (...a) {
      try {
        fn.call(this, a);
      } catch {
        // accounting never breaks rendering
      }
      return orig.apply(this, a);
    };
  };
  const addTex = (gl, target, bytes) => {
    const s = st(gl);
    const tex = s.tex.get(`${s.unit}:${target}`);
    if (!tex) return;
    s.texSize.set(tex, (s.texSize.get(tex) || 0) + bytes);
    GL.textureBytes += bytes;
    GL.peak = Math.max(GL.peak, total());
  };
  wrap('bindBuffer', function ([t, b]) {
    st(this).buf.set(t, b);
  });
  wrap('bufferData', function ([t, d]) {
    const s = st(this);
    const b = s.buf.get(t);
    if (!b) return;
    const size = typeof d === 'number' ? d : d.byteLength;
    GL.bufferBytes += size - (s.bufSize.get(b) || 0);
    s.bufSize.set(b, size);
    GL.peak = Math.max(GL.peak, total());
  });
  wrap('deleteBuffer', function ([b]) {
    const s = st(this);
    if (b && s.bufSize.has(b)) {
      GL.bufferBytes -= s.bufSize.get(b);
      s.bufSize.delete(b);
    }
  });
  wrap('activeTexture', function ([u]) {
    st(this).unit = u;
  });
  wrap('bindTexture', function ([t, tex]) {
    const s = st(this);
    s.tex.set(`${s.unit}:${t}`, tex);
  });
  wrap('texImage2D', function (a) {
    const [t, level, ifmt] = a;
    let w;
    let h;
    if (a.length >= 9) {
      w = a[3];
      h = a[4];
    } else {
      const src = a[5];
      w = (src && (src.width || src.videoWidth)) || 0;
      h = (src && (src.height || src.videoHeight)) || 0;
    }
    const bytes = w * h * bpp(ifmt);
    if (level === 0) {
      const s = st(this);
      const tex = s.tex.get(`${s.unit}:${t}`);
      if (tex) s.texBase.set(tex, bytes);
    }
    addTex(this, t, bytes);
  });
  wrap('texStorage2D', function ([t, levels, ifmt, w, h]) {
    let bytes = 0;
    let lw = w;
    let lh = h;
    for (let i = 0; i < levels; i++) {
      bytes += lw * lh * bpp(ifmt);
      lw = Math.max(1, lw >> 1);
      lh = Math.max(1, lh >> 1);
    }
    addTex(this, t, bytes * (t === C.TEXTURE_CUBE_MAP ? 6 : 1));
  });
  wrap('generateMipmap', function ([t]) {
    const s = st(this);
    const tex = s.tex.get(`${s.unit}:${t}`);
    const base = tex && s.texBase.get(tex);
    if (base) addTex(this, t, (base * (t === C.TEXTURE_CUBE_MAP ? 6 : 1)) / 3);
  });
  wrap('deleteTexture', function ([tex]) {
    const s = st(this);
    if (tex && s.texSize.has(tex)) {
      GL.textureBytes -= s.texSize.get(tex);
      s.texSize.delete(tex);
    }
  });
  wrap('bindRenderbuffer', function ([, rb]) {
    st(this).rb = rb;
  });
  const rbs = function (a) {
    const s = st(this);
    if (!s.rb) return;
    const multi = a.length >= 5;
    const bytes = (multi ? a[3] : a[2]) * (multi ? a[4] : a[3]) * bpp(multi ? a[2] : a[1]) * Math.max(1, multi ? a[1] : 1);
    GL.renderbufferBytes += bytes - (s.rbSize.get(s.rb) || 0);
    s.rbSize.set(s.rb, bytes);
    GL.peak = Math.max(GL.peak, total());
  };
  wrap('renderbufferStorage', rbs);
  wrap('renderbufferStorageMultisample', rbs);
  wrap('deleteRenderbuffer', function ([rb]) {
    const s = st(this);
    if (rb && s.rbSize.has(rb)) {
      GL.renderbufferBytes -= s.rbSize.get(rb);
      s.rbSize.delete(rb);
    }
  });
}
const MB = 1048576;
export const glMemory = () => ({
  buffersMB: +(GL.bufferBytes / MB).toFixed(1),
  texturesMB: +(GL.textureBytes / MB).toFixed(1),
  renderbuffersMB: +(GL.renderbufferBytes / MB).toFixed(1),
  totalMB: +(total0() / MB).toFixed(1),
  peakMB: +(GL.peak / MB).toFixed(1),
});
function total0() {
  return GL.bufferBytes + GL.textureBytes + GL.renderbufferBytes;
}

// ------------------------------------------------------------------ capabilities
// A throwaway context reads the real GPU name; it is released at once.
export function detectCaps() {
  const caps = {
    webgl2: false,
    webgl1: false,
    renderer: '',
    vendor: '',
    maxTexture: 0,
    maxTextureUnits: 0,
    mobile: false,
    cores: navigator.hardwareConcurrency || 0,
    memoryGB: navigator.deviceMemory || 0,
    screenW: screen.width,
    screenH: screen.height,
    dpr: window.devicePixelRatio || 1,
    saveData: false,
    effectiveType: '',
    reducedMotion: false,
  };
  caps.mobile = window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
  caps.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const conn = navigator.connection;
  if (conn) {
    caps.saveData = !!conn.saveData;
    caps.effectiveType = conn.effectiveType || '';
  }
  try {
    const c = document.createElement('canvas');
    let gl = c.getContext('webgl2');
    if (gl) caps.webgl2 = true;
    else {
      gl = c.getContext('webgl');
      caps.webgl1 = !!gl;
    }
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      caps.renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      caps.vendor = String(ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
      caps.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      caps.maxTextureUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    // no WebGL at all: caps.webgl2 stays false
  }
  return caps;
}

// Display cadence from the first frames: the lower quartile of the rAF
// intervals (load work only makes intervals longer, never shorter).
function measureRefresh(frames = 36) {
  return new Promise((resolve) => {
    const dts = [];
    let last = 0;
    const step = (t) => {
      if (last) dts.push(t - last);
      last = t;
      if (dts.length >= frames || document.hidden) {
        const s = dts.slice().sort((a, b) => a - b);
        const q = s.length ? s[Math.floor(s.length * 0.25)] : 16.7;
        resolve(Math.max(4, Math.min(100, q)));
      } else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// ------------------------------------------------------------------ the object
export function initPerf() {
  installGlAccounting();
  const params = new URLSearchParams(location.search);
  const caps = detectCaps();
  const qURL = parseQuality(params.get('quality'));
  if (qURL) store.set(KEY_MODE, qURL === 'auto' ? null : qURL);
  if (params.get('quality') === 'auto') store.set(KEY_LAST, null);
  const savedMode = parseQuality(store.get(KEY_MODE)) || 'auto';
  const mode = qURL || savedMode;

  const detected = classify(caps);
  let cls = detected.cls;
  const reasons = [...detected.reasons];
  let reason = 'detected';
  if (modeToClass(mode)) {
    cls = modeToClass(mode);
    reason = qURL ? 'url' : 'menu';
  } else {
    // a visit that ended in a lower class teaches the next one (measured, not guessed)
    try {
      const last = JSON.parse(store.get(KEY_LAST) || 'null');
      if (last && CLASSES[last.cls] && Date.now() - last.at < LAST_MAX_AGE && CLASS_ORDER.indexOf(last.cls) < CLASS_ORDER.indexOf(cls)) {
        reasons.push(`earlier visit ended in ${last.cls}`);
        cls = last.cls;
        reason = 'learned';
      }
    } catch {
      // a broken saved value is ignored
    }
  }
  if (!caps.webgl2) reasons.push(caps.webgl1 ? 'WebGL 1 only' : 'no WebGL');

  const perf = {
    caps,
    detected,
    reasons,
    reason,
    mode,
    cls,
    bootCls: cls,
    lite: CLASSES[cls].lite,
    cfg: CLASSES[cls],
    knobs: knobsFor(cls, 0),
    refreshMs: 1000 / 60,
    limiter: null,
    gov: null,
    // frame statistics (a ring of the last 240 intervals) and a 1 Hz series
    ring: new Float32Array(240),
    ringN: 0,
    series: [],
    longTasks: [],
    errors: [],
    started: performance.now(),
    warmUntil: Infinity, // main.js opens the governor when the scene is ready
    marks: null,
    scene: () => null,
    applyKnobs: null,
    overlayOn: false,
    glMemory,
  };

  perf.refresh = measureRefresh().then((ms) => {
    perf.refreshMs = ms;
    // a 120 Hz panel below Ultra is capped at 60 fps: half the cost, half the heat
    if (ms < 10.5 && perf.cls !== 'XL') perf.limiter = { minMs: 15.2 };
    perf.lowPower = ms > 28; // a 30 Hz cadence: a phone in power-saver mode
    perf.gov?.setRefreshMs(ms);
    if (perf.lowPower && perf.gov) perf.gov.setTargetFloor(ms * 1.2);
    return ms;
  });

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) perf.longTasks.push([Math.round(e.startTime), Math.round(e.duration)]);
      if (perf.longTasks.length > 500) perf.longTasks.splice(0, 250);
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // longtask is not supported everywhere
  }

  window.addEventListener('error', (e) => perf.errors.push(`${Math.round(performance.now())}: ${String(e.message).slice(0, 200)}`));
  window.addEventListener('unhandledrejection', (e) => perf.errors.push(`${Math.round(performance.now())}: rejection ${String(e.reason).slice(0, 200)}`));

  // ------------------------------------------------------------ governor wiring
  // main.js calls start() once the scene is ready: the loop judges frames
  // only after the build work is done.
  perf.start = (applyKnobs) => {
    perf.applyKnobs = applyKnobs;
    const auto = mode === 'auto';
    perf.gov = createGovernor({
      cls: perf.cls,
      ceiling: auto ? detected.cls : perf.cls,
      auto,
      log: (m) => console.info(`[porto] ${m}`),
      apply: (knobs, why) => {
        const prev = perf.cls;
        perf.cls = perf.gov.state.cls;
        perf.cfg = CLASSES[perf.cls];
        perf.knobs = knobs;
        if (perf.cls !== prev) {
          store.set(KEY_LAST, JSON.stringify({ cls: perf.cls, at: Date.now() }));
          if (perf.refreshMs < 10.5) perf.limiter = perf.cls === 'XL' ? null : { minMs: 15.2 };
        }
        applyKnobs(knobs, why);
      },
    });
    if (perf.refreshMs) perf.gov.setRefreshMs(perf.refreshMs);
    if (perf.lowPower) perf.gov.setTargetFloor(perf.refreshMs * 1.2);
    document.addEventListener('visibilitychange', () => perf.gov?.setHidden(document.hidden, performance.now()));
    return perf.gov;
  };

  // 60 fps cap for panels faster than that (below Ultra)
  perf.shouldSkip = (now, last) => perf.limiter !== null && now - last < perf.limiter.minMs;

  // per drawn frame; dtMs is the interval since the previous drawn frame
  let lastSecond = 0;
  let longSeen = 0;
  perf.frame = (now, dtMs) => {
    perf.ring[perf.ringN++ % perf.ring.length] = dtMs;
    if (now >= perf.warmUntil && !document.hidden) perf.gov?.feed(now, dtMs);
    if (now - lastSecond >= 1000) {
      lastSecond = now;
      const s = perf.stats();
      const sc = perf.scene() || {};
      perf.series.push({ t: Math.round(now / 1000), fps: s.fps, p95: s.p95, tris: sc.tris ?? null, calls: sc.calls ?? null, cls: perf.cls, pressure: perf.knobs.pressure, gpuMB: +(total0() / MB).toFixed(0), heapMB: heapMB() });
      if (perf.series.length > 1800) perf.series.splice(0, 300);
      longSeen = perf.longTasks.length;
    }
    if (perf.overlayOn) overlayTick(now);
  };

  const heapMB = () => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / MB) : null);
  perf.heapMB = heapMB;
  perf.stats = () => {
    const n = Math.min(perf.ringN, perf.ring.length);
    if (!n) return { fps: 0, mean: 0, p50: 0, p95: 0, max: 0, n: 0 };
    const a = Array.from(perf.ring.subarray(0, n)).sort((x, y) => x - y);
    const mean = a.reduce((x, y) => x + y, 0) / n;
    const q = (p) => a[Math.min(n - 1, Math.floor((p / 100) * n))];
    return { fps: +(1000 / mean).toFixed(1), mean: +mean.toFixed(1), p50: +q(50).toFixed(1), p95: +q(95).toFixed(1), max: +a[n - 1].toFixed(1), n };
  };

  // ------------------------------------------------------------ menu / mode
  perf.setMode = (id) => {
    const m = parseQuality(id) || 'auto';
    store.set(KEY_MODE, m === 'auto' ? null : m);
    if (m === 'auto') store.set(KEY_LAST, null);
    return m;
  };

  // ------------------------------------------------------------ overlay
  let box = null;
  let text = null;
  let lastPaint = 0;
  function build() {
    box = document.createElement('div');
    box.className = 'perf-overlay';
    box.setAttribute('role', 'status');
    text = document.createElement('pre');
    const row = document.createElement('div');
    row.className = 'perf-overlay-row';
    const exp = document.createElement('button');
    exp.type = 'button';
    exp.textContent = 'Export JSON';
    exp.addEventListener('click', () => perf.exportJSON());
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => perf.toggleOverlay(false));
    row.append(exp, close);
    box.append(text, row);
    document.body.append(box);
  }
  function overlayTick(now) {
    if (now - lastPaint < 500) return;
    lastPaint = now;
    const s = perf.stats();
    const sc = perf.scene() || {};
    const k = perf.knobs;
    const gl = glMemory();
    const lt = perf.longTasks.filter((x) => now - x[0] < 10000);
    const fmt = (v) => (v == null ? '-' : v);
    text.textContent = [
      `${s.fps} fps   ${s.mean} ms   p95 ${s.p95}   max ${s.max}`,
      `class ${perf.cls} (${perf.mode}${perf.reason === 'learned' ? ', learned' : ''}) score ${perf.detected.score}  pressure ${k.pressure}/${MAX_PRESSURE}`,
      `res ${k.res.toFixed(2)}  dpr ${k.dpr.toFixed(2)}  shadow ${k.shadow || 'off'}  post ${k.post}  geo ${k.geo}`,
      `tris ${sc.tris != null ? (sc.tris / 1e6).toFixed(2) + ' M' : '-'}  calls ${fmt(sc.calls)}  budget ${(perf.cfg.budget.tris / 1e6).toFixed(1)} M / ${perf.cfg.budget.calls}`,
      `gpu ${gl.totalMB} MB (buf ${gl.buffersMB} tex ${gl.texturesMB})  budget ${perf.cfg.budget.gpuMB}`,
      `js heap ${fmt(heapMB())} MB   long tasks 10 s: ${lt.length} (${lt.reduce((a, x) => a + x[1], 0)} ms)`,
      `display ${(1000 / perf.refreshMs).toFixed(0)} Hz${perf.limiter ? ' (capped 60)' : ''}${perf.lowPower ? ' power saver' : ''}   ${perf.caps.renderer.replace(/^ANGLE \(|\)$/g, '').slice(0, 56)}`,
    ].join('\n');
  }
  perf.toggleOverlay = (on = !perf.overlayOn) => {
    perf.overlayOn = on;
    if (on && !box) build();
    if (box) box.hidden = !on;
    if (on) overlayTick(performance.now() + 1e6);
  };
  window.addEventListener('keydown', (e) => {
    if (e.shiftKey && (e.key === 'P' || e.key === 'p') && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      perf.toggleOverlay();
    }
  });
  if (params.get('perf') === '1' || params.has('perf')) queueMicrotask(() => perf.toggleOverlay(true));

  // ------------------------------------------------------------ export
  perf.snapshot = () => ({
    exportedAt: new Date().toISOString(),
    url: location.href.replace(/[?#].*$/, ''),
    userAgent: navigator.userAgent,
    caps: perf.caps,
    class: { current: perf.cls, boot: perf.bootCls, detected: detected.cls, score: detected.score, mode: perf.mode, reason: perf.reason, reasons: perf.reasons },
    display: { refreshMs: +perf.refreshMs.toFixed(2), limiter: perf.limiter, lowPower: !!perf.lowPower },
    knobs: perf.knobs,
    governor: perf.gov ? { changes: perf.gov.state.changes, demotions: perf.gov.state.demotions, promotions: perf.gov.state.promotions } : null,
    frames: perf.stats(),
    scene: perf.scene(),
    memory: { gl: glMemory(), jsHeapMB: heapMB() },
    timing: perf.marks?.() ?? null,
    longTasks: perf.longTasks.slice(-100),
    series: perf.series,
    errors: perf.errors.slice(-50),
  });
  perf.exportJSON = () => {
    const blob = new Blob([JSON.stringify(perf.snapshot(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `porto-perf-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  return perf;
}

// A full-screen notice (no WebGL 2) or a bottom toast (context lost).
export function showNotice(title, text, { toast = false } = {}) {
  const el = document.createElement('div');
  el.className = `gpu-notice${toast ? ' is-toast' : ''}`;
  el.setAttribute('role', toast ? 'status' : 'alert');
  const inner = document.createElement('div');
  if (title) {
    const h = document.createElement('h1');
    h.textContent = title;
    inner.append(h);
  }
  const p = document.createElement('p');
  p.textContent = text;
  inner.append(p);
  el.append(inner);
  document.body.append(el);
  return el;
}

export { QUALITY_MODES };
