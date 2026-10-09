// In-page helpers for scripts/perf-bench.mjs. Injected before the app runs
// (addInitScript), so the long-task observer sees the whole load. Everything
// hangs off window.__bench. Plain script: no imports, no app code changes.
(() => {
  const B = (window.__bench = { longtasks: [], gpuNs: 0, gpuQueries: 0, gpuDisjoint: 0, renderCpuMs: 0, renderCalls: 0, hooked: false });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) B.longtasks.push([Math.round(e.startTime), Math.round(e.duration)]);
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // longtask is unsupported: the bench reports null
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  B.sleep = sleep;
  const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  B.stats = (arr, nominal = 1000 / 60) => {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const sum = s.reduce((a, b) => a + b, 0);
    const r = (x) => +x.toFixed(2);
    return {
      n: s.length,
      mean: r(sum / s.length),
      p50: r(pct(s, 50)),
      p95: r(pct(s, 95)),
      p99: r(pct(s, 99)),
      max: r(s[s.length - 1]),
      // a frame that took more than 1.5 display intervals missed at least one refresh
      droppedPct: r((100 * s.filter((x) => x > nominal * 1.5).length) / s.length),
    };
  };

  // ---- GPU timer: wraps renderer.render (every pass of the composer too)
  const pending = [];
  B.hook = () => {
    const P = window.__porto;
    if (B.hooked || !P?.renderer) return B.hooked;
    const r = P.renderer;
    const gl = r.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    B.timer = !!ext;
    const orig = r.render;
    B.origRender = orig;
    r.render = function (...a) {
      const t0 = performance.now();
      let q = null;
      if (ext && B.gpuOn) {
        q = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      }
      try {
        return orig.apply(this, a);
      } finally {
        if (q) {
          gl.endQuery(ext.TIME_ELAPSED_EXT);
          pending.push(q);
        }
        B.renderCpuMs += performance.now() - t0;
        B.renderCalls++;
      }
    };
    B.drain = () => {
      while (pending.length) {
        const q = pending[0];
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
        if (gl.getParameter(ext.GPU_DISJOINT_EXT)) B.gpuDisjoint++;
        else {
          B.gpuNs += gl.getQueryParameter(q, gl.QUERY_RESULT);
          B.gpuQueries++;
        }
        gl.deleteQuery(q);
        pending.shift();
      }
    };
    B.hooked = true;
    return true;
  };

  // ---- frame sampler: rAF deltas + per-frame renderer.info + GPU/CPU render totals
  B.sample = async (ms, opts = {}) => {
    B.hook();
    const P = window.__porto;
    const info = P.renderer.info;
    B.gpuOn = !!opts.gpu;
    B.drain?.();
    const g0 = B.gpuNs;
    const q0 = B.gpuQueries;
    const c0 = B.renderCpuMs;
    const lt0 = B.longtasks.length;
    const dts = [];
    const calls = [];
    const tris = [];
    let last = null;
    let frames = 0;
    const gov = { max: P.governor?.level ?? 0 };
    const t0 = performance.now();
    await new Promise((resolve) => {
      const loop = (t) => {
        if (last != null) {
          dts.push(t - last);
          calls.push(P.calls ?? info.render.calls);
          tris.push(P.triangles ?? info.render.triangles);
          frames++;
        }
        last = t;
        B.drain?.();
        opts.onFrame?.(t, frames);
        gov.max = Math.max(gov.max, P.governor?.level ?? 0);
        // fixed duration, but never fewer than minFrames (slow devices) and never longer than maxMs
        const done = opts.until ? opts.until(frames, t - t0) : t - t0 >= ms && frames >= (opts.minFrames || 0);
        if (done || t - t0 >= (opts.maxMs || 120000)) resolve();
        else requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    B.gpuOn = false;
    if (opts.gpu) {
      await sleep(150);
      B.drain();
    }
    const lt = B.longtasks.slice(lt0);
    const res = {
      frames,
      durationMs: Math.round(performance.now() - t0),
      frameMs: B.stats(dts),
      calls: B.stats(calls),
      tris: B.stats(tris),
      renderCpuMsPerFrame: frames ? +((B.renderCpuMs - c0) / frames).toFixed(2) : null,
      gpuMsPerFrame: opts.gpu && B.timer && B.gpuQueries > q0 && frames ? +((B.gpuNs - g0) / 1e6 / frames).toFixed(2) : null,
      longTasks: { count: lt.length, totalMs: lt.reduce((a, x) => a + x[1], 0), maxMs: lt.reduce((a, x) => Math.max(a, x[1]), 0) },
      governorMax: gov.max,
      governorEnd: P.governor?.level ?? 0,
    };
    return res;
  };

  // ---- scripted poses
  B.units = () => window.__porto.projection.metresPerUnit || 4;
  B.pose = (lat, lon, dx, dy, dz, lookUp = 10) => {
    const P = window.__porto;
    const q = P.project(lat, lon);
    const k = B.units();
    const gy = P.heightAt(q.x, q.z);
    const V = P.camera.position.constructor;
    return { pos: new V(q.x + dx / k, gy + dy / k, q.z + dz / k), target: new V(q.x, gy + lookUp / k, q.z) };
  };
  B.saveHome = () => {
    const P = window.__porto;
    B.home = { pos: P.camera.position.clone(), target: P.rig.controls.target.clone() };
  };
  B.flyAndWait = async (pose, dur, timeoutMs = 40000) => {
    const P = window.__porto;
    const f0 = P.flights;
    P.rig.flyTo(pose.pos, pose.target, dur);
    const t0 = performance.now();
    while (P.flights === f0 && performance.now() - t0 < timeoutMs) await sleep(100);
    return P.flights > f0;
  };
  B.goHome = async (dur = 1.2) => B.flyAndWait(B.home, dur);

  // orbit the camera around the controls target at its current radius
  B.orbit = (degPerSec) => {
    const P = window.__porto;
    const cam = P.camera;
    const tgt = P.rig.controls.target;
    let prev = null;
    return (t) => {
      if (prev != null) {
        const a = (degPerSec * Math.PI) / 180 * ((t - prev) / 1000);
        const dx = cam.position.x - tgt.x;
        const dz = cam.position.z - tgt.z;
        const c = Math.cos(a);
        const s = Math.sin(a);
        cam.position.x = tgt.x + dx * c - dz * s;
        cam.position.z = tgt.z + dx * s + dz * c;
        cam.lookAt(tgt);
      }
      prev = t;
    };
  };

  // ---- GPU memory estimate: attribute bytes + texture bytes + render buffers
  B.gpuEstimate = () => {
    const P = window.__porto;
    const geos = new Set();
    const bufs = new Set();
    const texs = new Set();
    let geoBytes = 0;
    let instBytes = 0;
    const byLayer = {};
    const addBuf = (a, layer) => {
      const arr = a.isInterleavedBufferAttribute ? a.data.array : a.array;
      if (!arr || bufs.has(arr)) return 0;
      bufs.add(arr);
      return arr.byteLength;
    };
    const visitTex = (v) => {
      if (!v) return;
      if (Array.isArray(v)) return v.forEach(visitTex);
      if (v.isTexture) texs.add(v);
    };
    P.scene.traverse((o) => {
      const layer = (() => {
        let p = o;
        while (p.parent && p.parent !== P.scene) p = p.parent;
        return p.name || p.type;
      })();
      // the current geometry plus the LOD variants kept in userData (the
      // building tiles keep a full and a roofs-only geometry): this is the
      // CPU-side attribute total, whether or not it was uploaded
      for (const g of [o.geometry, o.userData?.full, o.userData?.roofs]) {
        if (!g || geos.has(g)) continue;
        geos.add(g);
        let b = 0;
        for (const a of Object.values(g.attributes)) b += addBuf(a);
        if (g.index) b += addBuf(g.index);
        geoBytes += b;
        byLayer[layer] = (byLayer[layer] || 0) + b;
      }
      if (o.isInstancedMesh) {
        if (o.instanceMatrix) instBytes += addBuf(o.instanceMatrix);
        if (o.instanceColor) instBytes += addBuf(o.instanceColor);
      }
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        for (const k in m) visitTex(m[k]);
        if (m.uniforms) for (const k in m.uniforms) visitTex(m.uniforms[k]?.value);
      }
    });
    visitTex(P.scene.environment);
    visitTex(P.scene.background);
    let texBytes = 0;
    const bytesPer = (t) => {
      const img = t.image || (t.source && t.source.data);
      if (!img) return 0;
      const w = img.width || img.videoWidth || (t.mipmaps && t.mipmaps[0]?.width) || 0;
      const h = img.height || img.videoHeight || (t.mipmaps && t.mipmaps[0]?.height) || 0;
      const faces = t.isCubeTexture ? 6 : 1;
      const mip = t.generateMipmaps || (t.mipmaps && t.mipmaps.length > 1) ? 1.333 : 1;
      let bpp = 4;
      if (t.isCompressedTexture) bpp = 0.5; // BC/ETC/ASTC order of magnitude
      return w * h * faces * bpp * mip;
    };
    for (const t of texs) texBytes += bytesPer(t);
    const r = P.renderer;
    const px = r.domElement.width * r.domElement.height;
    // colour + depth for the canvas, and the post stack's float targets (about 6 full-size RGBA16F-equivalent buffers when on)
    const fxOn = P.fx?.enabled !== false && !!P.fx?.enabled;
    const targets = px * 4 * 2 + (fxOn ? px * 8 * 4 : 0);
    const sm = P.atmosphere?.sun?.shadow?.map;
    const shadow = sm ? sm.width * sm.height * 4 : (P.atmosphere?.sun?.shadow?.mapSize.x ** 2) * 4 || 0;
    const mb = (x) => +(x / 1048576).toFixed(1);
    const layers = Object.fromEntries(Object.entries(byLayer).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, mb(v)]));
    return {
      geometryMB: mb(geoBytes),
      instanceMB: mb(instBytes),
      textureMB: mb(texBytes),
      renderTargetsMB: mb(targets),
      shadowMB: mb(shadow),
      totalMB: mb(geoBytes + instBytes + texBytes + targets + shadow),
      geometries: r.info.memory.geometries,
      textures: r.info.memory.textures,
      textureObjects: texs.size,
      geometryByLayerMB: layers,
    };
  };

  // ---- GL allocation accounting: bytes the page asked the GPU for through
  // bufferData / texImage2D / texStorage2D / renderbufferStorage, minus what
  // it deleted. This is what a driver has to keep resident (drivers add
  // padding and mip chains, so treat it as a lower bound of VRAM).
  {
    const G = (B.gl = { bufferBytes: 0, textureBytes: 0, renderbufferBytes: 0, peakBytes: 0, buffers: 0, textures: 0 });
    const proto = window.WebGL2RenderingContext && WebGL2RenderingContext.prototype;
    if (proto && !proto.__benchWrapped) {
      proto.__benchWrapped = true;
      const GL = WebGL2RenderingContext;
      const BPP = new Map([
        [GL.RGBA8, 4], [GL.RGBA, 4], [GL.RGB, 4], [GL.RGB8, 4], [GL.SRGB8_ALPHA8, 4], [GL.SRGB8, 4], [GL.RGBA16F, 8], [GL.RGB16F, 8], [GL.RGBA32F, 16], [GL.RGB32F, 16],
        [GL.R11F_G11F_B10F, 4], [GL.DEPTH_COMPONENT24, 4], [GL.DEPTH_COMPONENT32F, 4], [GL.DEPTH24_STENCIL8, 4], [GL.DEPTH32F_STENCIL8, 8], [GL.DEPTH_COMPONENT16, 2], [GL.DEPTH_COMPONENT, 4],
        [GL.R8, 1], [GL.RG8, 2], [GL.R16F, 2], [GL.RG16F, 4], [GL.R32F, 4], [GL.RG32F, 8], [GL.RGBA4, 2], [GL.RGB5_A1, 2], [GL.RGB565, 2], [GL.LUMINANCE, 1], [GL.LUMINANCE_ALPHA, 2], [GL.ALPHA, 1], [GL.RED, 1], [GL.RG, 2],
      ]);
      const bpp = (f) => BPP.get(f) ?? 4;
      const total = () => G.bufferBytes + G.textureBytes + G.renderbufferBytes;
      const bump = () => { G.peakBytes = Math.max(G.peakBytes, total()); };
      const wrap = (name, fn) => {
        const orig = proto[name];
        if (!orig) return;
        proto[name] = function (...a) {
          try { fn.call(this, a); } catch { /* accounting never breaks the page */ }
          return orig.apply(this, a);
        };
      };
      const state = new WeakMap(); // gl -> { bound: Map, sizes: WeakMap }
      const st = (gl) => { let s = state.get(gl); if (!s) state.set(gl, (s = { bufTarget: new Map(), bufSize: new WeakMap(), unit: 0, tex: new Map(), texSize: new WeakMap(), texBase: new WeakMap(), rbBound: null, rbSize: new WeakMap() })); return s; };
      wrap('bindBuffer', function ([t, b]) { st(this).bufTarget.set(t, b); });
      wrap('bufferData', function ([t, d, u]) {
        const s = st(this); const b = s.bufTarget.get(t); if (!b) return;
        const size = typeof d === 'number' ? d : d.byteLength;
        G.bufferBytes += size - (s.bufSize.get(b) || 0);
        if (!s.bufSize.has(b)) G.buffers++;
        s.bufSize.set(b, size); bump();
      });
      wrap('deleteBuffer', function ([b]) { const s = st(this); if (b && s.bufSize.has(b)) { G.bufferBytes -= s.bufSize.get(b); s.bufSize.delete(b); G.buffers--; } });
      wrap('activeTexture', function ([u]) { st(this).unit = u; });
      wrap('bindTexture', function ([t, tex]) { const s = st(this); s.tex.set(`${s.unit}:${t}`, tex); });
      const addTex = (gl, t, bytes) => {
        const s = st(gl); const tex = s.tex.get(`${s.unit}:${t}`); if (!tex) return;
        if (!s.texSize.has(tex)) G.textures++;
        s.texSize.set(tex, (s.texSize.get(tex) || 0) + bytes); G.textureBytes += bytes; bump();
      };
      const faces = (t) => (t === GL.TEXTURE_CUBE_MAP ? 1 : 1); // each face is its own call
      wrap('texImage2D', function (a) {
        const [t, level, ifmt] = a;
        let w; let h;
        if (a.length >= 9) { w = a[3]; h = a[4]; } else { const src = a[5]; w = src && (src.width || src.videoWidth || src.displayWidth) || 0; h = src && (src.height || src.videoHeight || src.displayHeight) || 0; }
        const bytes = w * h * bpp(ifmt) * faces(t);
        if (level === 0) { const s = st(this); s.texBase.set(s.tex.get(`${s.unit}:${t}`) || {}, bytes); }
        addTex(this, t, bytes);
      });
      wrap('compressedTexImage2D', function ([t, level, ifmt, w, h, , data]) { addTex(this, t, data?.byteLength ?? (w * h) / 2); });
      wrap('texStorage2D', function ([t, levels, ifmt, w, h]) {
        let bytes = 0; let lw = w; let lh = h;
        for (let i = 0; i < levels; i++) { bytes += lw * lh * bpp(ifmt); lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1); }
        addTex(this, t, bytes * (t === GL.TEXTURE_CUBE_MAP ? 6 : 1));
      });
      wrap('texStorage3D', function ([t, levels, ifmt, w, h, d]) { let bytes = 0; let lw = w; let lh = h; for (let i = 0; i < levels; i++) { bytes += lw * lh * d * bpp(ifmt); lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1); } addTex(this, t, bytes); });
      wrap('generateMipmap', function ([t]) { const s = st(this); const tex = s.tex.get(`${s.unit}:${t}`); const base = tex && s.texBase.get(tex); if (base) addTex(this, t, base * (t === GL.TEXTURE_CUBE_MAP ? 6 : 1) / 3 * 1); });
      wrap('deleteTexture', function ([tex]) { const s = st(this); if (tex && s.texSize.has(tex)) { G.textureBytes -= s.texSize.get(tex); s.texSize.delete(tex); G.textures--; } });
      wrap('bindRenderbuffer', function ([t, rb]) { st(this).rbBound = rb; });
      const rbs = function (a) {
        const s = st(this); const rb = s.rbBound; if (!rb) return;
        const multi = a.length >= 5; const samples = multi ? a[1] : 1; const ifmt = multi ? a[2] : a[1]; const w = multi ? a[3] : a[2]; const h = multi ? a[4] : a[3];
        const bytes = w * h * bpp(ifmt) * Math.max(1, samples);
        G.renderbufferBytes += bytes - (s.rbSize.get(rb) || 0); s.rbSize.set(rb, bytes); bump();
      };
      wrap('renderbufferStorage', rbs);
      wrap('renderbufferStorageMultisample', rbs);
      wrap('deleteRenderbuffer', function ([rb]) { const s = st(this); if (rb && s.rbSize.has(rb)) { G.renderbufferBytes -= s.rbSize.get(rb); s.rbSize.delete(rb); } });
    }
  }
  B.glMB = () => {
    const G = B.gl;
    const mb = (x) => +(x / 1048576).toFixed(1);
    return { buffersMB: mb(G.bufferBytes), texturesMB: mb(G.textureBytes), renderbuffersMB: mb(G.renderbufferBytes), totalMB: mb(G.bufferBytes + G.textureBytes + G.renderbufferBytes), peakMB: mb(G.peakBytes), buffers: G.buffers, textures: G.textures };
  };

  B.heapMB = () => (performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null);

  // ---- layers for the toggle sweep
  const LAYERS = {
    ground: (o) => o.name === 'ground',
    sky: (o) => o.name === 'sky',
    'tiles (far terrain)': (o) => o.name === 'tiles',
    buildings: (o) => o.name === 'buildings',
    'buildings-ms': (o) => o.name === 'buildings-ms',
    landmarks: (o) => o.name === 'landmarks',
    roads: (o) => o.name === 'roads',
    'nature: trees': (o) => o.parent?.name === 'nature' && /^tree/.test(o.name),
    'nature: water': (o) => o.parent?.name === 'nature' && o.name === 'water',
    quays: (o) => o.name === 'quays',
    'life: traffic': (o) => o.parent?.name === 'life' && o.name === 'traffic',
    'life: streetscape (people, furniture)': (o) => o.parent?.name === 'life' && o.name === 'streetscape',
    'life: trams, rail, boats, birds, cable': (o) => o.parent?.name === 'life' && /^(trams|rail|cablecar|boats|birds|funicular-cars)/.test(o.name),
    'life: live air and transit': (o) => o.parent?.name === 'life' && /^live-/.test(o.name),
    'sky fx: clouds, sea fog, leaves': (o) => ['cloud-deck', 'sea-fog', 'leaves'].includes(o.name),
  };
  B.layerNames = Object.keys(LAYERS);
  B.setLayer = (name, visible) => {
    const P = window.__porto;
    const test = LAYERS[name];
    let n = 0;
    for (const o of P.scene.children) {
      if (test(o)) {
        o.visible = visible;
        n++;
      }
      for (const c of o.children) {
        if (test(c)) {
          c.visible = visible;
          n++;
        }
      }
    }
    return n;
  };
  B.labelLayer = () => [...document.querySelectorAll('body div')].find((e) => e.children.length >= 60 && getComputedStyle(e).position === 'absolute');

  // ---- context loss helper for the stress tests
  B.loseContext = () => {
    const gl = window.__porto.renderer.getContext();
    const ext = gl.getExtension('WEBGL_lose_context');
    B.loseExt = ext;
    ext?.loseContext();
    return !!ext;
  };
  B.restoreContext = () => B.loseExt?.restoreContext();
})();
