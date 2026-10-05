// Post-processing: one EffectComposer, linear HDR until the OutputPass.
//
//   RenderPass        scene into a half-float target with a depth texture
//   SunRaysPass       sun shafts (3d-sky-rays): bright open sky near the
//                     visible sun, marched radially toward it at half
//                     resolution, so towers, ridges and crowns cut the
//                     shafts (skipped when the sun is off screen or below
//                     the horizon, and off entirely on the low/lite tier);
//                     the same composite carries the faint
//                     summer heat haze over far ground
//
// setQuality('2x') renders two drawing-buffer pixels per CSS pixel
// (3d-retina-resolution): renderer, composer and every pass follow.
//   UnrealBloomPass   threshold 1.5 in linear HDR: only emissive things
//                     (gold pins, the main-street glow, routes, lamps, lit
//                     windows, the sun) pass it; sunlit stone stays below.
//                     At the city overview by day: threshold 1.58, weaker
//                     and tighter, so the pins stay small (update())
//   OutputPass        ACES tone mapping and sRGB, once
//   SMAAPass          anti-aliasing on the display-referred image
//   FinishPass        a soft vignette and fine film grain
//
// With effects off, main.js renders straight to the canvas instead.
import * as THREE from 'three';
import { deviceDpr, DPR, WEATHER_UNIFORMS } from './scene.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

// Sunlit pale stone facing a low sun reaches about 1.3 in linear HDR; the
// emissive things are pushed above 1.5 (pins 1.8, lamps, lit windows, sun)
export const BLOOM_THRESHOLD = 1.5;

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// ------------------------------------------------------------ sun rays
class SunRaysPass extends Pass {
  constructor() {
    super();
    this.needsSwap = true;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false };
    this.maskRT = new THREE.WebGLRenderTarget(1, 1, opts);
    this.raysRT = new THREE.WebGLRenderTarget(1, 1, opts);
    this.sun = new THREE.Vector2(0.5, 0.5);
    this.strength = 0;
    this.tint = new THREE.Color(1, 0.85, 0.6);
    this.quad = new FullScreenQuad();
    // tuning (3d-sky-rays): energy threshold over the sky luminance, the
    // source falloff around the sun, what the foreground keeps of the shafts.
    // The threshold is high enough that the pale golden-hour sky does not
    // wash the upper frame; the shafts still read through a roofline over the
    // Douro. `fore` keeps stone and leaves at contrast under the overlay.
    this.threshold = { value: 0.9 };
    this.nearK = { value: 13 };
    this.fore = { value: 0.42 };
    this.gain = 1.7;
    this.maskMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, uSun: { value: this.sun }, uAspect: { value: 1 }, uThreshold: this.threshold, uNearK: this.nearK },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform vec2 uSun;
        uniform float uAspect;
        uniform float uThreshold;
        uniform float uNearK;
        varying vec2 vUv;
        void main() {
          // the sky is never written to the depth buffer: depth 1 is open
          // sky, anything nearer an occluder (hills, crowns, towers)
          float sky = step(0.99999, texture2D(tDepth, vUv).x);
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          // energy of the bright sky only, capped (no single-pixel suns);
          // the golden-hour sky near the sun sits around 0.7 .. 1.4 linear
          float e = min(max(lum - uThreshold, 0.0), 2.0);
          vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
          float near = exp(-dot(d, d) * uNearK);
          gl_FragColor = vec4(c / max(lum, 1e-4) * e * sky * near, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uSun: { value: this.sun } },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc;
        uniform vec2 uSun;
        varying vec2 vUv;
        const int N = 40;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec2 delta = (vUv - uSun) * 0.95 / float(N);
          // stable jitter against banding (no shimmer: it does not animate)
          vec2 uv = vUv - delta * hash(vUv * 731.0);
          vec3 sum = vec3(0.0);
          float w = 1.0;
          float ws = 0.0;
          for (int i = 0; i < N; i++) {
            uv -= delta;
            if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) sum += texture2D(tSrc, uv).rgb * w;
            ws += w;
            w *= 0.962;
          }
          gl_FragColor = vec4(sum / max(ws, 1e-4), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    // Summer heat haze rides on the same composite: far ground near the
    // horizon shimmers a fraction of a pixel (uHaze 0..1, seasons.js).
    this.haze = 0;
    this.compMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tRays: { value: null },
        tDepth: { value: null },
        uStrength: { value: 0 },
        uTint: { value: this.tint },
        uHaze: { value: 0 },
        uTime: { value: 0 },
        uNearFar: { value: new THREE.Vector2(1, 16000) },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uFore: this.fore,
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tRays;
        uniform sampler2D tDepth;
        uniform float uStrength;
        uniform vec3 uTint;
        uniform float uHaze;
        uniform float uTime;
        uniform vec2 uNearFar;
        uniform vec2 uTexel;
        uniform float uFore;
        varying vec2 vUv;
        void main() {
          vec2 uv = vUv;
          float dz = texture2D(tDepth, vUv).x;
          float sky = step(0.99999, dz);
          if (uHaze > 0.001 && sky < 0.5) {
            // view distance from the perspective depth
            float n = uNearFar.x, f = uNearFar.y;
            float z = n * f / (f - dz * (f - n));
            float far = smoothstep(700.0, 2600.0, z);
            float w = sin(vUv.y / uTexel.y * 0.21 + uTime * 5.3) * sin(vUv.x / uTexel.x * 0.013 + vUv.y / uTexel.y * 0.05 - uTime * 1.7);
            uv.x += w * uTexel.x * 1.1 * far * uHaze;
          }
          vec4 c = texture2D(tDiffuse, uv);
          // foreground keeps its contrast: the shafts read in the air, not
          // as a wash over stone and leaves (3d-sky-rays)
          float k = mix(uFore, 1.0, sky);
          if (uStrength > 0.001) c.rgb += texture2D(tRays, vUv).rgb * uTint * uStrength * k;
          gl_FragColor = c;
        }`,
      depthTest: false,
      depthWrite: false,
    });
  }

  setSize(w, h) {
    const hw = Math.max(1, Math.floor(w / 2));
    const hh = Math.max(1, Math.floor(h / 2));
    this.maskRT.setSize(hw, hh);
    this.raysRT.setSize(hw, hh);
    this.maskMat.uniforms.uAspect.value = w / Math.max(1, h);
    this.compMat.uniforms.uTexel.value.set(1 / Math.max(1, w), 1 / Math.max(1, h));
  }

  render(renderer, writeBuffer, readBuffer) {
    // the ray buffers are skipped when only the heat haze is on
    if (this.strength > 0.001) {
      this.maskMat.uniforms.tDiffuse.value = readBuffer.texture;
      this.maskMat.uniforms.tDepth.value = readBuffer.depthTexture;
      this.quad.material = this.maskMat;
      renderer.setRenderTarget(this.maskRT);
      this.quad.render(renderer);

      this.blurMat.uniforms.tSrc.value = this.maskRT.texture;
      this.quad.material = this.blurMat;
      renderer.setRenderTarget(this.raysRT);
      this.quad.render(renderer);
    }

    this.compMat.uniforms.uHaze.value = this.haze;
    this.compMat.uniforms.tDiffuse.value = readBuffer.texture;
    this.compMat.uniforms.tRays.value = this.raysRT.texture;
    this.compMat.uniforms.tDepth.value = readBuffer.depthTexture;
    this.compMat.uniforms.uStrength.value = this.strength;
    this.quad.material = this.compMat;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.maskRT.dispose();
    this.raysRT.dispose();
    this.maskMat.dispose();
    this.blurMat.dispose();
    this.compMat.dispose();
    this.quad.dispose();
  }
}

// ------------------------------------------------------------ finish
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.035 },
    uVignette: { value: 0.22 },
    uAspect: { value: 1.6 },
  },
  vertexShader: QUAD_VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uAspect;
    varying vec2 vUv;
    float hash(vec3 p) {
      p = fract(p * 0.1031);
      p += dot(p, p.zyx + 31.32);
      return fract((p.x + p.y) * p.z);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // a light grade: a touch more colour and mid-tone contrast
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = clamp(mix(vec3(l), c.rgb, 1.08), 0.0, 1.0);
      c.rgb = c.rgb + (c.rgb - 0.5) * c.rgb * (1.0 - c.rgb) * 0.35;
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
      float v = smoothstep(0.35, 1.05, length(d));
      c.rgb *= 1.0 - uVignette * v;
      // grain: strongest in the mid-tones, never lifts the blacks
      float n = hash(vec3(gl_FragCoord.xy, floor(uTime * 24.0))) - 0.5;
      float mid = 4.0 * c.g * (1.0 - c.g);
      c.rgb += n * uGrain * mid;
      gl_FragColor = c;
    }`,
};

// ------------------------------------------------------------ public
export function createEffects(renderer, scene, camera, { reducedMotion = false } = {}) {
  // Quality tier: the DPR cap is 2 in high quality and 1.5/1.25 in light mode
  // (main.js sets it before the renderer exists). Rays are off on low/lite.
  // Read live (not captured) so the adaptive governor lowering DPR.cap also
  // drops the ray pass.
  const raysAllowed = () => DPR.cap >= 2;
  const size = renderer.getSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x || 1, size.y || 1, {
    type: THREE.HalfFloatType,
    depthTexture: new THREE.DepthTexture(size.x || 1, size.y || 1),
  });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(renderer.getPixelRatio());

  const renderPass = new RenderPass(scene, camera);
  const rays = new SunRaysPass();
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x || 1, size.y || 1), 0.55, 0.55, BLOOM_THRESHOLD);
  const output = new OutputPass();
  const smaa = new SMAAPass();
  const finish = new ShaderPass(FinishShader);
  composer.addPass(renderPass);
  composer.addPass(rays);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(smaa);
  composer.addPass(finish);

  let enabled = false;
  // Post level from the adaptive governor: 0 all, 1 no rays, 2 no bloom,
  // 3 no SMAA. The pass list stays fixed; only the expensive passes gate.
  let postLevel = 0;
  const _p = new THREE.Vector3();
  const _v = new THREE.Vector3();
  let sunSource = null; // the visible sun (scene.js skySunDir), when set
  let haze = 0;

  // 0 at street and landmark distance, 1 at the city overview (camera to
  // orbit focus, world units; the default overview sits near 2950)
  function overviewK() {
    const f = camera.userData.focus;
    return THREE.MathUtils.smoothstep(f ? camera.position.distanceTo(f) : 300, 800, 2500);
  }

  // sun position on screen, and how much of the shafts to show. The source
  // is projected from the camera along the sun direction; behind the camera
  // it is rejected before its coordinates are used, and off screen it fades
  // out (a small overscan keeps a sun just above the frame).
  function aim(sunDir, night) {
    _v.copy(sunSource || sunDir);
    const facing = camera.getWorldDirection(_p).dot(_v);
    _p.copy(camera.position).addScaledVector(_v, 5000).project(camera);
    const inFront = facing > 0.05 && _p.z < 1;
    const off = Math.max(Math.abs(_p.x), Math.abs(_p.y));
    const fade = inFront ? 1 - THREE.MathUtils.smoothstep(off, 1.0, 1.45) : 0;
    const low = 1 - THREE.MathUtils.smoothstep(_v.y, 0.25, 0.7); // strongest near the horizon
    // weather: a solid deck, rain or the low sea fog closes the sky and the
    // shafts with it, so shafts only blaze in clear and partly cloudy air
    const cover = THREE.MathUtils.smoothstep(WEATHER_UNIFORMS.cloudParams.value.z, 0.45, 0.95);
    const rain = THREE.MathUtils.smoothstep(WEATHER_UNIFORMS.cloudShape.value.w, 0.25, 0.95);
    const clear = (1 - 0.85 * cover) * (1 - 0.55 * rain);
    // quality tier: no shafts on low/lite (reduced motion still keeps the
    // pass static — its jitter does not animate)
    const s = raysAllowed() ? fade * THREE.MathUtils.smoothstep(_v.y, -0.02, 0.06) * (1 - night) * (0.35 + 0.65 * low) * clear : 0;
    rays.sun.set(_p.x * 0.5 + 0.5, _p.y * 0.5 + 0.5);
    rays.strength = s * rays.gain;
    rays.haze = haze;
    rays.enabled = (s > 0.01 || haze > 0.001) && postLevel < 1;
  }

  // ---- quality: auto (the device pixel ratio, capped at 2 by main.js) or
  // a fixed 200 % (two drawing-buffer pixels per CSS pixel, 3d-retina-
  // resolution skill). main.js keeps sizing the canvas; setSize applies the
  // mode on top, so renderer, composer and every pass stay in step.
  let quality = 'auto';
  let last = null; // { w, h, dpr } from the last setSize
  const autoDpr = deviceDpr; // the app's cap (scene.js DPR): 2, or 1.5 / 1.25 in light mode
  function limitFor(w, h) {
    const gl = renderer.getContext();
    const maxRB = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 4096;
    const maxTex = renderer.capabilities.maxTextureSize || 4096;
    const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS) || [maxRB, maxRB];
    const side = Math.min(maxRB, maxTex, vp[0], vp[1]);
    return side / Math.max(w, h, 1);
  }
  function ratioFor(w, h, dpr) {
    // an explicit ratio from a capture (share.js) is kept as it is
    if (quality !== '2x' || dpr !== autoDpr()) return dpr;
    return Math.min(2, Math.max(dpr, Math.floor(limitFor(w, h) * 100) / 100));
  }
  function applySize(w, h, dpr) {
    const r = ratioFor(w, h, dpr);
    if (renderer.getPixelRatio() !== r) {
      renderer.setPixelRatio(r);
      renderer.setSize(w, h, false);
    }
    composer.setPixelRatio(r);
    composer.setSize(w, h);
    finish.uniforms.uAspect.value = w / Math.max(1, h);
    return r;
  }

  return {
    composer,
    bloom,
    rays,
    get enabled() {
      return enabled;
    },
    setEnabled(on) {
      enabled = !!on;
    },
    // adaptive post cost: 0 all passes, 1 no sun rays, 2 no bloom, 3 no SMAA
    setPostLevel(n) {
      postLevel = THREE.MathUtils.clamp(n | 0, 0, 3);
      bloom.enabled = postLevel < 2;
      smaa.enabled = postLevel < 3;
    },
    get postLevel() {
      return postLevel;
    },
    setSize(w, h, dpr) {
      last = { w, h, dpr };
      applySize(w, h, dpr);
    },
    // 'auto' | '2x'. Returns the effective state: { mode, ratio, ok }. 2x is
    // refused (ok false) when the GPU cannot hold a 200 % buffer.
    setQuality(mode) {
      quality = mode === '2x' ? '2x' : 'auto';
      if (!last) return { mode: quality, ratio: renderer.getPixelRatio(), ok: true };
      const r = applySize(last.w, last.h, last.dpr);
      const ok = quality !== '2x' || r >= 2;
      if (!ok) {
        quality = 'auto';
        applySize(last.w, last.h, last.dpr);
      }
      return { mode: quality, ratio: renderer.getPixelRatio(), ok };
    },
    get quality() {
      return quality;
    },
    // the visible sun for the ray source (scene.js skySunDir)
    setSunSource(v) {
      sunSource = v;
    },
    // summer heat haze 0..1 (seasons.js)
    setHaze(k) {
      haze = k;
    },
    // night: 0..1; bloom a little stronger so lamps and windows glow
    update(dt, sunDir, night) {
      if (!reducedMotion) finish.uniforms.uTime.value += dt;
      if (!reducedMotion) rays.compMat.uniforms.uTime.value += dt;
      rays.compMat.uniforms.uNearFar.value.set(camera.near, camera.far);
      aim(sunDir, night);
      // at the overview the glowing roads cover much of the frame and the
      // pins are a few pixels: a lower, tighter bloom with a slightly higher
      // threshold keeps the city crisp and the pins small (close-ups and
      // the night keep the full glow)
      const far = overviewK() * (1 - night);
      // at night the emissive things (lamps, lit windows, wet reflections)
      // get a slightly lower threshold and a tighter, stronger glow
      bloom.threshold = BLOOM_THRESHOLD + 0.08 * far - 0.06 * night;
      bloom.strength = (0.32 + 0.16 * night) * (1 - 0.35 * far);
      bloom.radius = 0.45 + 0.08 * night - 0.2 * far;
    },
    render() {
      composer.render();
    },
    dispose() {
      composer.dispose();
      rays.dispose();
    },
  };
}
