// Renderer, atmosphere and the draped ground.
//
// One lighting state drives everything that must agree: the sky dome, the
// height fog every material shares, the sun (or moon) light and its shadow,
// the hemisphere fill and the PMREM environment made from the sky. Four
// presets (morning, day, sunset, night) are blended continuously; the
// default is the golden-hour sunset.
//
// Weather (src/weather.js) sits on top of the time of day: setWeather()
// dims and greys the sky and thickens the fog; setSun() drives the preset
// from a real sun position (src/live.js). Cloud shadows and wet ground
// reach every lit material through the same chunk patching as the fog.
//
// Wet ground reflections: a small linear HDR cube of the same sky (rebuilt
// with the PMREM environment) is sampled by the ground shader along the
// reflected view ray, so puddles and the Douro quays mirror the horizon and
// the low sun instead of a flat fog smear. The tone mapper is a custom ACES
// with a gentle highlight shoulder (values under 0.75 are unchanged), so
// water sparkle and white granite keep gradation instead of clipping.
//
// Fog: the stock fog chunks are replaced once, before any shader compiles,
// by an exponential height fog with sun in-scattering. Every built-in and
// line material shares it, including the landmark stone shader, so the far
// hills fade into exactly the colour the sky has at the horizon. Maritime
// humidity thickens that haze toward the Atlantic and pales it over the
// water, so the western horizon reads as an ocean horizon.
import * as THREE from 'three';

// ------------------------------------------------------------ shared fog uniforms
// Plain objects (not Vector3) on purpose: UniformsUtils.clone copies three.js
// math objects per material but keeps plain objects by reference, so one
// write here reaches every compiled material.
export const FOG_UNIFORMS = {  fogSunDir: { value: { x: 0, y: 1, z: 0 } },
  // the lighting sun (cloud shadows); fogSunDir is the visible sun
  fogLightDir: { value: { x: 0, y: 1, z: 0 } },
  fogSunColor: { value: { x: 0, y: 0, z: 0 } },
  // x: in-scatter strength, y: in-scatter power, z: height falloff (1/unit),
  // w: haze wall distance (world units beyond fogRect) that hides the edge
  fogParams: { value: { x: 0, y: 4, z: 0.003, w: 3000 } },
  // the data rectangle (x0, z0, x1, z1): outside it the land fades into haze
  fogRect: { value: { x: 0, y: 0, z: 0, w: 0 } },
  // Maritime haze (Porto's Atlantic): fogOcean is the normalized horizontal
  // direction toward the ocean; fogMaritime.x thickens the haze along it and
  // .y tints it toward fogSeaColor. Materials that lack them read 0: no
  // marine haze, so the shared patch stays safe for custom shaders.
  fogOcean: { value: { x: -1, y: 0, z: 0 } },
  fogMaritime: { value: { x: 0, y: 0, z: 0, w: 0 } },
  fogSeaColor: { value: { x: 0, y: 0, z: 0 } },
};

// ------------------------------------------------------------ sky reflection
// A linear HDR cube of the sky (no disk, no stars), rebuilt with the PMREM
// environment and read by the ground shader for sharp sky/horizon/sun
// reflections on wet paving. Shared by reference, like FOG_UNIFORMS: the
// ground material holds this exact object, so createAtmosphere can fill it.
export const SKY_REFLECT = { value: null };

// ------------------------------------------------------------ weather uniforms
// Shared the same way as FOG_UNIFORMS (plain objects, one write reaches
// every material). The cloud texture is static: cloneUniforms copies the
// Texture object per material, but the copies share one GPU image; the
// drift is an offset in cloudParams.
//   cloudParams: x, y drift offset (texture units), z cover 0..1,
//                w cloud-shadow strength 0..1
//   cloudShape:  x deck height (world y), y 1 / texture period (1/unit),
//                z wetness 0..1, w rain 0..1 (rings on the water)
//   seasonW:     the season blend [spring, summer, fall, winter], sums to 1
//                (src/seasons.js); foliage, ground and snow all read it
//   seasonSnow:  x settled snow on high ground 0..1, y dusting on roofs
//                0..1, z snow line (world y), w frost on low ground 0..1
export const WEATHER_UNIFORMS = {
  tCloud: { value: null },
  cloudParams: { value: { x: 0, y: 0, z: 0, w: 0 } },
  cloudShape: { value: { x: 375, y: 1 / 2600, z: 0, w: 0 } },
  seasonW: { value: { x: 0, y: 1, z: 0, w: 0 } },
  seasonSnow: { value: { x: 0, y: 0, z: 65, w: 0 } },
  // Night/weather look, written once in apply() from the resolved lighting
  // state: x night 0..1, y reserved, z reserved, w reserved. A plain object,
  // so the single write reaches every lit material (see FOG_UNIFORMS).
  lookParams: { value: { x: 0, y: 0, z: 0, w: 0 } },
};

// Declarations for shaders that read the season (lit materials get them
// through the lights_pars_begin patch below).
export const SEASON_GLSL = /* glsl */ `
uniform vec4 seasonW;
uniform vec4 seasonSnow;
`;

// Night look, shared like the season. Injected with the clouds so the wet
// patch below can warm the streets after dark.
export const LOOK_GLSL = /* glsl */ `
uniform vec4 lookParams;
`;

// Cloud density at a point of the deck (world xz), 0 clear .. 1 cloud.
// The visible cloud layer (weather.js), the shadows on every lit material
// and the far tree billboards all call it, so a shadow lies exactly where
// its cloud is. A material that lacks the uniforms reads cover 0: no cloud.
export const CLOUD_GLSL = /* glsl */ `
uniform sampler2D tCloud;
uniform vec4 cloudParams;
uniform vec4 cloudShape;
float brgCloudDensity(vec2 xz) {
  if (cloudParams.z <= 0.001) return 0.0;
  vec2 uv = xz * cloudShape.y + cloudParams.xy;
  float a = texture2D(tCloud, uv).r;
  float b = texture2D(tCloud, uv * 3.1 + vec2(0.37, 0.71) + cloudParams.yx * 0.7).g;
  float d = a * 0.7 + b * 0.3;
  float th = mix(0.8, 0.2, cloudParams.z);
  return smoothstep(th, th + 0.17, d);
}
// direct sunlight left at world point w after the deck above it
float brgCloudShade(vec3 w, vec3 sunDir) {
  if (cloudParams.w <= 0.001) return 1.0;
  float sy = max(sunDir.y, 0.12);
  vec2 p = w.xz + sunDir.xz / sy * (cloudShape.x - w.y);
  return 1.0 - cloudParams.w * brgCloudDensity(p);
}
`;

// Tileable cloud noise, 256 x 256: R and G two fbm fields (the deck),
// B a finer field for puddles on wet ground.
function cloudTexture(size = 256) {
  const lcg = (seed) => {
    let s = seed >>> 0 || 1;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  };
  const octave = (n, seed) => {
    const r = lcg(seed);
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = r();
    return (x, y) => {
      const fx = (x / size) * n;
      const fy = (y / size) * n;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const at = (i, j) => g[(((j % n) + n) % n) * n + (((i % n) + n) % n)];
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const fbm = (seed) => {
    const o = [octave(4, seed), octave(8, seed + 1), octave(16, seed + 2), octave(32, seed + 3), octave(64, seed + 4)];
    return (x, y) => 0.36 * o[0](x, y) + 0.28 * o[1](x, y) + 0.18 * o[2](x, y) + 0.11 * o[3](x, y) + 0.07 * o[4](x, y);
  };
  const A = fbm(41);
  const B = fbm(83);
  const P = [octave(32, 7), octave(64, 9)];
  const data = new Uint8Array(size * size * 4);
  // stretch the fbm (its values crowd around 0.5) to the full range
  const stretch = (v) => Math.min(1, Math.max(0, (v - 0.5) * 2.1 + 0.5));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = stretch(A(x, y)) * 255;
      data[i + 1] = stretch(B(x, y)) * 255;
      data[i + 2] = stretch(0.6 * P[0](x, y) + 0.4 * P[1](x, y)) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  // puddles and snow read it at grazing angles on the ground
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

let fogInstalled = false;
// Call once before the first material is created.
export function installAtmosphereFog() {
  if (fogInstalled) return;
  fogInstalled = true;
  const C = THREE.ShaderChunk;
  WEATHER_UNIFORMS.tCloud.value = cloudTexture();
  // Tone mapping: ACES with a gentle highlight shoulder. Below 0.75 in linear
  // light the curve is exactly ACES, so mid-tones and the (CPU-mirrored) fog
  // seam are untouched; above it the roll-off keeps specular water and white
  // granite from clipping to flat white. CustomToneMapping is the hook three
  // reserves in tonemapping_pars_fragment (a no-op by default).
  C.tonemapping_pars_fragment = C.tonemapping_pars_fragment.replace(
    'vec3 CustomToneMapping( vec3 color ) { return color; }',
    `vec3 CustomToneMapping( vec3 color ) {
  color = max( color, vec3( 0.0 ) );
  vec3 over = max( color - vec3( 0.75 ), vec3( 0.0 ) );
  color = color / ( vec3( 1.0 ) + over * toneMappingExposure * 0.5 );
  return ACESFilmicToneMapping( color );
}`,
  );
  // Cloud shadows: the direct light of every lit, fogged material is dimmed
  // by the deck above the shaded point (projected along the sun). The fog
  // chunk already carries the world position (vFogWorld) and the sun
  // direction (fogSunDir); ambient and sky light stay as they are.
  C.lights_pars_begin += `
#ifdef USE_FOG
${CLOUD_GLSL}
${SEASON_GLSL}
${LOOK_GLSL}
#endif`;
  C.lights_fragment_end += `
#ifdef USE_FOG
{
  float brgShade = brgCloudShade(vFogWorld, fogLightDir);
  reflectedLight.directDiffuse *= brgShade;
  reflectedLight.directSpecular *= brgShade;
}
#endif`;
  // Wet ground after rain: up-facing surfaces (streets, squares, roofs)
  // darken and turn glossy, with smoother puddles in patches.
  // Winter (src/seasons.js): settled snow on up-facing surfaces above the
  // snow line (Sameiro, the top of Bom Jesus), broken up by noise; a light
  // dusting on roofs and paving city-wide (every lit material except those
  // that define BRG_NO_DUST: the ground, the trees); a
  // faint frost on low ground. Water (BRG_WATER) takes neither snow nor
  // the wet-ground darkening.
  C.lights_physical_fragment += `
#if defined( USE_FOG ) && !defined( BRG_WATER )
if (seasonSnow.x + seasonSnow.y + seasonSnow.w > 0.001) {
  vec3 brgSN = (vec4(normal, 0.0) * viewMatrix).xyz;
  float brgN = texture2D(tCloud, vFogWorld.xz * 0.021).b;
  float brgN2 = texture2D(tCloud, vFogWorld.xz * 0.093 + 0.37).b;
  float brgUp = smoothstep(0.42, 0.86, brgSN.y + (brgN2 - 0.5) * 0.25);
  float brgAlt = smoothstep(seasonSnow.z - 3.0, seasonSnow.z + 6.0, vFogWorld.y + (brgN - 0.5) * 14.0);
  float brgSnow = seasonSnow.x * brgAlt;
  #ifndef BRG_NO_DUST
  brgSnow = max(brgSnow, seasonSnow.y * (0.45 + 0.55 * smoothstep(0.35, 0.75, brgN2 * 0.7 + brgN * 0.3)));
  #endif
  brgSnow *= brgUp;
  float brgFrost = seasonSnow.w * brgUp * smoothstep(0.45, 0.75, brgN2) * (1.0 - brgAlt);
  // r18x lights the diffuse term from diffuseContribution (diffuseColor
  // is the metal F0 base): write both
  material.diffuseContribution = mix(material.diffuseContribution, vec3(0.74, 0.77, 0.82), clamp(brgSnow, 0.0, 1.0));
  material.diffuseContribution = mix(material.diffuseContribution, vec3(0.3, 0.32, 0.36), brgFrost * 0.25);
  material.diffuseColor = mix(material.diffuseColor, vec3(0.74, 0.77, 0.82), clamp(brgSnow, 0.0, 1.0));
  material.roughness = mix(material.roughness, 0.8, brgSnow);
}
#endif
#if defined( USE_FOG ) && !defined( BRG_WATER )
if (cloudShape.z > 0.001) {
  vec3 brgWN = (vec4(normal, 0.0) * viewMatrix).xyz;
  float brgWet = cloudShape.z * smoothstep(0.5, 0.9, brgWN.y);
  // low-frequency puddle patches: the ground that stays wet longest, more of
  // them the heavier the rain (cloudShape.w)
  float brgPudN = texture2D(tCloud, vFogWorld.xz * 0.043).b;
  float brgPud = brgWet * smoothstep(0.56, 0.7, brgPudN) * smoothstep(0.15, 0.7, cloudShape.w + 0.15);
  // calçada and asphalt read dark and glossy when wet
  float brgDark = clamp(0.34 * brgWet + 0.22 * brgPud, 0.0, 0.62);
  material.diffuseContribution *= 1.0 - brgDark;
  material.diffuseColor *= 1.0 - brgDark;
  material.roughness = mix(material.roughness, 0.3, brgWet * 0.72);
  material.roughness = mix(material.roughness, 0.07, brgPud);
  // a little extra specular energy, so the shared sky IBL reads as a wet sheen
  material.specularColor = mix(material.specularColor, vec3(0.2), brgWet * 0.65);
  // puddles mirror the sky/horizon colour (fogColor is the horizon sky)
  totalEmissiveRadiance += fogColor * brgPud * (0.04 + 0.1 * (1.0 - lookParams.x));
  // night: the warm city light (windows, shop signs, lamps) smears across
  // the wet stone, strongest in the puddles; a faint cool sky glint on the
  // crispest puddles keeps the reflection from reading as a flat stain
  float brgLit = lookParams.x;
  float brgGlow = brgWet * brgLit * (0.25 + 0.75 * brgPudN);
  totalEmissiveRadiance += vec3(1.0, 0.62, 0.34) * brgGlow * 0.06;
  totalEmissiveRadiance += vec3(0.52, 0.64, 0.86) * brgPud * brgLit * 0.03;
}
#endif`;
  C.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;
  // world position from the view-space position every fog shader has
  C.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = cameraPosition + transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
#endif`;
  C.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec3 fogSunDir;
  uniform vec3 fogLightDir;
  uniform vec3 fogSunColor;
  uniform vec4 fogParams;
  uniform vec4 fogRect;
  uniform vec3 fogOcean;
  uniform vec3 fogSeaColor;
  uniform vec4 fogMaritime;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  // Optical depth of a haze whose density falls off exponentially with
  // height, integrated along the view ray (closed form). Uniforms a
  // material lacks read as 0: every division and pow is guarded.
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  {
    vec3 fRel = vFogWorld - cameraPosition;
    float fDist = length( fRel );
    // maritime humidity: 1 looking toward the Atlantic, 0 inland
    vec2 fH = normalize( fRel.xz + vec2( 1e-4 ) );
    float fSea = dot( fH, normalize( fogOcean.xz + vec2( 1e-4 ) ) ) * 0.5 + 0.5;
    fSea *= fSea;
    float fK = fogParams.z > 0.0 ? fogParams.z : 0.003;
    // mean density along the ray, (e^-k*y0 - e^-k*y1) / (k * dy): written
    // with the two exponentials apart it stays finite for a thin, dense
    // valley fog (large k) seen from high above
    float fE0 = exp( - fK * clamp( cameraPosition.y, -100.0, 8000.0 ) );
    float fE1 = exp( - fK * clamp( vFogWorld.y, -100.0, 8000.0 ) );
    float fKdy = fK * fRel.y;
    float fMean = abs( fKdy ) > 1e-3 ? ( fE0 - fE1 ) / fKdy : fE0 * ( 1.0 - 0.5 * fKdy );
    #ifdef FOG_EXP2
      float fDens = fogDensity;
    #else
      float fDens = 1.0 / max( fogFar, 1.0 );
    #endif
    float fTau = fDens * fDist * fMean;
    // seen from the overview height the whole city is one long ray: cap the
    // air's optical depth so the Douro and the roofs stay readable (the map
    // edge ramp below is not affected). Heights are world units (4 per m).
    fTau *= 1.0 - 0.65 * smoothstep( 300.0, 1400.0, cameraPosition.y );
    float fEdge = fogParams.w > 0.0 ? fogParams.w : 2400.0;
    float fOut = fogRect.z > fogRect.x
      ? length( max( max( fogRect.xy - vFogWorld.xz, vFogWorld.xz - fogRect.zw ), 0.0 ) )
      : max( length( vFogWorld.xz ) - 3000.0, 0.0 );
    float fRamp = smoothstep( 0.0, fEdge, fOut );
    fTau += 5.0 * fRamp * fRamp * ( 3.0 - 2.0 * fRamp ) + 1.2 * fRamp;
    // thicker air toward the sea, before the fog factor is resolved
    fTau *= 1.0 + fogMaritime.x * fSea;
    float fogFactor = 1.0 - exp( - max( fTau, 0.0 ) );
    vec3 fDir = fRel / max( fDist, 1e-3 );
    float fSun = pow( max( dot( fDir, fogSunDir ), 0.0 ), max( fogParams.y, 1.0 ) ) * fogParams.x;
    vec3 fCol = mix( fogColor, fogSunColor, clamp( fSun, 0.0, 1.0 ) );
    // and paler/cooler over the water, so the far hills meet a marine horizon
    fCol = mix( fCol, fogSeaColor, clamp( fogMaritime.y * fSea, 0.0, 0.85 ) );
    #ifdef FOG_ADDITIVE
      // an additive layer cannot blend toward the fog colour (that would add
      // a bright haze colour: white ribbons on the horizon); it fades out
      gl_FragColor.a *= 1.0 - fogFactor;
    #else
      gl_FragColor.rgb = mix( gl_FragColor.rgb, fCol, fogFactor );
    #endif
  }
#endif`;
  for (const lib of Object.values(THREE.ShaderLib)) {
    if (lib.uniforms?.fogColor) Object.assign(lib.uniforms, FOG_UNIFORMS, WEATHER_UNIFORMS);
  }
}

// ------------------------------------------------------------ renderer
// The one device-pixel-ratio cap of the app: 2 in high quality, 1.5 in
// light mode, 1.25 on a low-end device (main.js sets it before the renderer
// exists). createRenderer, main.js resize() and effects.js read it here.
export const DPR = { cap: 2 };
export const deviceDpr = () => Math.min(window.devicePixelRatio || 1, DPR.cap);

export function createRenderer(canvas, { antialias = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(deviceDpr());
  // CustomToneMapping is the shoulder-over-ACES curve installed in
  // installAtmosphereFog (installAtmosphereFog must run first). OutputPass
  // reads renderer.toneMapping, so post-processing follows the same curve.
  renderer.toneMapping = THREE.CustomToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft was removed in r18x
  // main.js resets the counters once per frame, so post-processing passes
  // do not wipe the scene's draw calls from the stats
  renderer.info.autoReset = false;
  return renderer;
}

// ------------------------------------------------------------ time of day
export const TIMES = ['morning', 'day', 'sunset', 'night'];
export const DEFAULT_TIME = 'sunset';

// Sun position: azimuth is a compass bearing (0 north, 90 east), elevation
// in degrees. World axes: +x east, -z north.
function dirFrom(azDeg, elDeg, out = new THREE.Vector3()) {
  const a = THREE.MathUtils.degToRad(azDeg);
  const e = THREE.MathUtils.degToRad(elDeg);
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

// Colours are sRGB hex; THREE.Color converts them to linear.
const PRESETS = {
  morning: {
    az: 100, el: 10,
    light: 0xffd4a3, lightI: 3.9,
    zenith: 0x46699c, mid: 0xb3c0d4, haze: 0xdcd2c9, scatter: 0xffd3a0, scatterK: 0.75, scatterP: 5,
    disk: 0xfff1d8, diskI: 5,
    hemiSky: 0xc9d4e6, hemiGround: 0x5a4c3c, hemiI: 0.18,
    env: 0.72, exposure: 1.25, density: 0.00026, falloff: 0.0035, night: 0,
  },
  day: {
    az: 165, el: 50,
    light: 0xfff2df, lightI: 3.6,
    zenith: 0x2d5fa8, mid: 0x86abd8, haze: 0xc7d3df, scatter: 0xfff1da, scatterK: 0.35, scatterP: 8,
    disk: 0xfffaf0, diskI: 6,
    hemiSky: 0xcbd9ee, hemiGround: 0x5b5040, hemiI: 0.2,
    env: 0.84, exposure: 1.0, density: 0.00014, falloff: 0.003, night: 0,
  },
  sunset: {
    az: 242, el: 12,
    light: 0xffbb78, lightI: 4.4,
    zenith: 0x33507f, mid: 0xa6adc4, haze: 0xd9c0ae, scatter: 0xf7bd78, scatterK: 0.85, scatterP: 5,
    disk: 0xffe6bf, diskI: 6,
    hemiSky: 0xc3c4d6, hemiGround: 0x5c4634, hemiI: 0.16,
    env: 0.78, exposure: 1.3, density: 0.0002, falloff: 0.003, night: 0,
  },
  night: {
    az: 140, el: 36,
    light: 0x9db2dc, lightI: 0.42,
    zenith: 0x050914, mid: 0x0c1528, haze: 0x1b2438, scatter: 0x34405c, scatterK: 0.3, scatterP: 6,
    disk: 0xdfe8ff, diskI: 1.6,
    hemiSky: 0x33415e, hemiGround: 0x1a1612, hemiI: 0.22,
    env: 0.45, exposure: 1.3, density: 0.0002, falloff: 0.003, night: 1,
  },
};

// Resolved preset in linear floats, so blends never re-read hex values.
function resolve(p) {
  const c = (hex) => new THREE.Color(hex);
  return {
    az: p.az, el: p.el,
    light: c(p.light), lightI: p.lightI,
    zenith: c(p.zenith), mid: c(p.mid), haze: c(p.haze), scatter: c(p.scatter),
    scatterK: p.scatterK, scatterP: p.scatterP,
    disk: c(p.disk), diskI: p.diskI,
    hemiSky: c(p.hemiSky), hemiGround: c(p.hemiGround), hemiI: p.hemiI,
    env: p.env, exposure: p.exposure, density: p.density, falloff: p.falloff, night: p.night,
  };
}
const RESOLVED = Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, resolve(v)]));

function blendState(a, b, k, out) {
  const L = (x, y) => x + (y - x) * k;
  // shortest way round for the azimuth
  let d = ((b.az - a.az + 540) % 360) - 180;
  out.az = a.az + d * k;
  out.el = L(a.el, b.el);
  for (const key of ['light', 'zenith', 'mid', 'haze', 'scatter', 'disk', 'hemiSky', 'hemiGround']) out[key].copy(a[key]).lerp(b[key], k);
  for (const key of ['lightI', 'scatterK', 'scatterP', 'diskI', 'hemiI', 'env', 'exposure', 'density', 'falloff', 'night']) out[key] = L(a[key], b[key]);
  return out;
}

// three.js ACESFilmicToneMapping, on the CPU. Without post-processing the
// fog mixes in after tone mapping, so its colour is tone-mapped here to meet
// the (GPU tone-mapped) sky at the horizon without a seam.
function acesInPlace(c, exposure) {
  const s = exposure / 0.6;
  let r = c.r * s;
  let g = c.g * s;
  let b = c.b * s;
  const ir = 0.59719 * r + 0.35458 * g + 0.04823 * b;
  const ig = 0.076 * r + 0.90834 * g + 0.01566 * b;
  const ib = 0.0284 * r + 0.13383 * g + 0.83777 * b;
  const fit = (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  r = fit(ir);
  g = fit(ig);
  b = fit(ib);
  c.r = THREE.MathUtils.clamp(1.60475 * r - 0.53108 * g - 0.07367 * b, 0, 1);
  c.g = THREE.MathUtils.clamp(-0.10208 * r + 1.10813 * g - 0.00605 * b, 0, 1);
  c.b = THREE.MathUtils.clamp(-0.00327 * r - 0.07276 * g + 1.07602 * b, 0, 1);
  return c;
}

// CPU mirror of the CustomToneMapping curve above (shoulder then ACES): the
// fog colour is mixed in after tone mapping, so it must land on the exact
// colour the sky has at the horizon or the far hills seam.
function toneMapInPlace(c, exposure) {
  const k = exposure * 0.5;
  c.r /= 1 + Math.max(c.r - 0.75, 0) * k;
  c.g /= 1 + Math.max(c.g - 0.75, 0) * k;
  c.b /= 1 + Math.max(c.b - 0.75, 0) * k;
  return acesInPlace(c, exposure);
}

// ------------------------------------------------------------ sky
const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 uSunDir, uZenith, uMid, uHaze, uScatter, uDisk, uGround;
  uniform vec3 uMaritimeDir, uSeaHaze;
  uniform vec2 uScatterK;
  uniform float uDiskI, uNight, uEnv, uMaritime;
  uniform vec4 uCloud;
  varying vec3 vDir;
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float sd = max(dot(d, uSunDir), 0.0);
    float lowSun = 1.0 - smoothstep(0.06, 0.32, uSunDir.y);
    // the horizon band is the fog colour, in-scatter included (same formula
    // as the fog chunk), so fogged hills meet the sky without a seam. Toward
    // the Atlantic (uMaritimeDir) it pales along the horizon: marine haze.
    vec3 haze = mix(uHaze, uScatter, clamp(pow(sd, max(uScatterK.y, 1.0)) * uScatterK.x, 0.0, 1.0));
    vec2 dh = normalize(vec2(d.x, d.z) + vec2(1e-4));
    float sea = dot(dh, normalize(uMaritimeDir.xz + vec2(1e-4))) * 0.5 + 0.5;
    sea *= sea;
    haze = mix(haze, uSeaHaze, clamp(uMaritime * sea * exp(-abs(h) * 9.0), 0.0, 1.0));
    vec3 col = mix(haze, uMid, smoothstep(0.0, 0.2, h));
    col = mix(col, uZenith, smoothstep(0.14, 0.9, h));
    float above = smoothstep(-0.04, 0.03, h);
    // the anti-solar Belt of Venus and the warm scatter spread along the
    // sun's horizon: the cinematic colour of a low sun over the Douro
    col += mix(uScatter, uHaze, 0.5) * max(dot(d, -uSunDir), 0.0) * exp(-max(h, 0.0) * 7.0) * smoothstep(-0.01, 0.05, h) * lowSun * 0.22;
    col += uScatter * pow(max(dot(dh, normalize(vec2(uSunDir.x, uSunDir.z) + vec2(1e-4))), 0.0), 4.0) * exp(-max(h, 0.0) * 4.0) * lowSun * 0.16;
    col += uScatter * pow(sd, 14.0) * 0.35 * above;
    // how clear the sky is (cloud cover is shared by weather.js): a clear
    // night goes deep and starry, an overcast one keeps a lifted city glow
    float clear = 1.0 - clamp(uCloud.z, 0.0, 1.0);
    col *= 1.0 - 0.32 * uNight * clear * smoothstep(-0.02, 0.2, h);
    // stars, then the sun or moon: not in the environment map (fireflies)
    float sky = 1.0 - uEnv;
    if (uNight > 0.001 && sky > 0.5) {
      vec3 p = d * 260.0;
      vec3 id = floor(p);
      float r = hash13(id);
      vec3 f = fract(p) - 0.5;
      float s = step(0.9965, r) * smoothstep(0.22, 0.0, length(f)) * (0.35 + 0.65 * fract(r * 91.7));
      col += vec3(0.85, 0.9, 1.0) * s * uNight * smoothstep(0.02, 0.25, h) * (0.2 + 0.8 * clear) * 1.9;
    }
    float disk = smoothstep(0.99965, 0.99985, dot(d, uSunDir));
    col += uDisk * (disk * uDiskI + pow(sd, 400.0) * uDiskI * 0.12) * sky * above * (0.7 + 0.3 * clear);
    // environment only: dark earth below the horizon, lit by the sky colour
    col = mix(col, uGround, smoothstep(0.02, -0.14, h) * uEnv);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function skyMaterial(uniforms, env, cloud) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: { ...uniforms, uCloud: cloud, uEnv: { value: env ? 1 : 0 } },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
  });
}

// ------------------------------------------------------------ atmosphere
// Preset for a real sun position (live mode, src/live.js): day above 40
// degrees, golden hour (morning or sunset by azimuth) below 12, twilight
// down to -7, then night under the moon. The light keeps the real azimuth
// and never comes from below 2 degrees; the switch to the moon happens
// where both lights are faint.
const _golden = resolve(PRESETS.sunset);
function presetForSun(az, el, out) {
  const golden = blendState(RESOLVED.morning, RESOLVED.sunset, az < 180 ? 0 : 1, _golden);
  const sm = THREE.MathUtils.smoothstep;
  if (el >= 12) blendState(golden, RESOLVED.day, sm(el, 12, 40), out);
  else if (el >= -1) blendState(golden, golden, 0, out);
  else blendState(golden, RESOLVED.night, sm(-el, 1, 7), out);
  if (el > -4.5) {
    out.az = az;
    out.el = Math.max(el, 2);
    // twilight: the direct light fades out long before the stars come
    if (el < 2) out.lightI *= 0.15 + 0.85 * sm(el, -4.5, 2);
  } else {
    out.lightI = Math.min(out.lightI, RESOLVED.night.lightI * (0.5 + 0.5 * sm(-el, 4.5, 8)));
    out.az = RESOLVED.night.az;
    out.el = RESOLVED.night.el;
  }
  return out;
}

// Weather on top of the time of day (src/weather.js drives it):
//   dim  0..1  the sun behind cloud (overcast, rain)
//   grey 0..1  a grey, flat sky
//   fog  0..1  dense low valley fog
//   haze 0..1  rain haze: a thicker, paler air
const _grey = new THREE.Color();
const WEATHER_DIALS = ['dim', 'grey', 'fog', 'haze'];
function applyWeather(s, w) {
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const toGrey = (c, k, lift = 1) => {
    const l = lum(c) * lift;
    return c.lerp(_grey.setRGB(l, l, l * 1.03), k);
  };
  const o = w.dim;
  s.lightI *= 1 - 0.8 * o;
  s.diskI *= 1 - 0.97 * o;
  s.scatterK *= 1 - 0.75 * Math.max(o, w.grey);
  s.hemiI *= 1 + 1.2 * o;
  s.env *= 1 + 0.2 * o;
  toGrey(s.light, 0.5 * o);
  toGrey(s.zenith, 0.85 * w.grey, 1.5);
  toGrey(s.mid, 0.8 * w.grey, 1.1);
  toGrey(s.haze, 0.6 * w.grey);
  toGrey(s.scatter, 0.7 * w.grey);
  toGrey(s.hemiSky, 0.7 * w.grey);
  // the valley fog: a layer about 70 m deep over the city level (y = 0),
  // thicker in the river valleys below it; Bom Jesus (y 53) and Sameiro
  // (y 92) stand out above it. Pale.
  const f = w.fog;
  s.density *= 1 + 1.5 * w.haze;
  s.density += (0.035 - s.density) * f;
  s.falloff += (0.055 - s.falloff) * f;
  toGrey(s.haze, 0.7 * f, 1.12);
  toGrey(s.mid, 0.35 * f, 1.05);
  s.scatterK *= 1 - 0.4 * f;
  return s;
}

// Season on top of the time of day (src/seasons.js drives it with the
// blend weights [spring, summer, fall, winter]). Resolved from the preset
// every time, like the weather, so nothing drifts:
//   sun: higher at midday in summer (Braga, 41.5 N: about 72 degrees at
//        the June noon, 25 in December), the golden hours further north in
//        summer and further south in winter; not in live mode, where the
//        real sun already carries the season;
//   light: stronger and whiter in summer, golden in autumn, pale and cool
//        in winter; haze: soft in spring, a faint heat haze in summer,
//        golden in autumn, thicker and cooler in winter.
const _sc = {
  winterLight: new THREE.Color(0xdce6ff),
  autumnLight: new THREE.Color(0xffc184),
  springLight: new THREE.Color(0xfff0dc),
  winterHaze: new THREE.Color(0xc9d0da),
  autumnHaze: new THREE.Color(0xdcc195),
  summerHaze: new THREE.Color(0xd6d3c6),
  winterSky: new THREE.Color(0xb7c4d8),
};
function applySeason(s, w, live) {
  const [sp, su, fa, wi] = w;
  const day = 1 - s.night;
  if (!live) {
    const noon = THREE.MathUtils.smoothstep(s.el, 15, 40) * day;
    s.el += noon * (sp * 6 + su * 22 - fa * 5 - wi * 22);
    // golden hours: az < 180 is the morning (north is the lower azimuth)
    const side = s.az < 180 ? -1 : 1;
    s.az += (1 - noon) * day * side * (su * 18 + sp * 6 - fa * 5 - wi * 14);
  }
  s.lightI *= 1 + 0.08 * su + 0.02 * fa - 0.16 * wi;
  s.light.lerp(_sc.winterLight, 0.35 * wi * day).lerp(_sc.autumnLight, 0.14 * fa * day).lerp(_sc.springLight, 0.1 * sp * day);
  s.haze.lerp(_sc.winterHaze, 0.3 * wi).lerp(_sc.autumnHaze, 0.12 * fa * day).lerp(_sc.summerHaze, 0.12 * su * day);
  s.scatterK *= 1 + 0.06 * fa - 0.2 * wi;
  s.hemiSky.lerp(_sc.winterSky, 0.3 * wi);
  s.zenith.lerp(_sc.winterSky, 0.12 * wi * day);
  s.hemiI *= 1 + 0.12 * wi;
  // autumn stays within ~10 % of summer: a thicker autumn haze washed the
  // whole city out at the overview; winter keeps its heavier air
  s.density *= 1 + 0.08 * sp + 0.04 * su + 0.12 * fa + 0.4 * wi;
  return s;
}

// The visible sun (sky disc, its glow, the fog in-scatter, the sun rays
// and the glitter on the water) sits a few degrees below the lighting sun
// at golden hour. The orbit camera never looks above ~10 degrees below the
// horizon (camera.js maxPolarAngle), so a 12 degree sunset sun would stay
// just above the frame and the shafts could never show. This is the one
// place the two directions differ; by day they are the same.
const SKY_SUN_DROP = 5; // degrees at golden hour
function skySunElevation(el) {
  const drop = SKY_SUN_DROP * (1 - THREE.MathUtils.smoothstep(el, 14, 30)) * THREE.MathUtils.smoothstep(el, 3, 8);
  return el - drop;
}

// The Atlantic lies west of Porto: marine humidity is strongest toward this
// compass bearing (world axes: +x east, -z north). One bearing, fixed.
const MARITIME_AZ = 275;

export function createAtmosphere(renderer, scene, { reducedMotion = false, shadowSize = 4096 } = {}) {
  // base: the time-of-day blend; state: base with the weather on top (what
  // every consumer reads). The weather is re-applied to the base each time,
  // never to last frame's state, so nothing drifts.
  const base = blendState(RESOLVED[DEFAULT_TIME], RESOLVED[DEFAULT_TIME], 0, resolve(PRESETS[DEFAULT_TIME]));
  const state = blendState(base, base, 0, resolve(PRESETS[DEFAULT_TIME]));
  const weather = { dim: 0, grey: 0, fog: 0, haze: 0 };
  const season = [0, 1, 0, 0]; // [spring, summer, fall, winter]
  const sunDir = dirFrom(state.az, state.el);
  const skySunDir = dirFrom(state.az, skySunElevation(state.el));
  const oceanDir = dirFrom(MARITIME_AZ, 0);
  const _sea = new THREE.Color();

  const skyU = {
    uSunDir: { value: skySunDir },
    uZenith: { value: new THREE.Color() },
    uMid: { value: new THREE.Color() },
    uHaze: { value: new THREE.Color() },
    uScatter: { value: new THREE.Color() },
    uScatterK: { value: new THREE.Vector2() },
    uDisk: { value: new THREE.Color() },
    uDiskI: { value: 0 },
    uNight: { value: 0 },
    uGround: { value: new THREE.Color() },
    uMaritimeDir: { value: oceanDir.clone() },
    uSeaHaze: { value: new THREE.Color() },
    uMaritime: { value: 0 },
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), skyMaterial(skyU, false, WEATHER_UNIFORMS.cloudParams));
  sky.scale.setScalar(9000);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  sky.name = 'sky';
  scene.add(sky);

  // environment: the same sky, no disk or stars, earth below the horizon
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(sky.geometry, skyMaterial(skyU, true, WEATHER_UNIFORMS.cloudParams));
  envSky.scale.setScalar(50);
  envScene.add(envSky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;
  // A small linear HDR cube of the same sky, sampled by the ground shader for
  // a sharp mirror of the horizon and the low sun on wet paving (the PMREM is
  // too blurred at puddle roughness). Rendered into a fixed target - so the
  // texture reference the ground material holds never changes - and refreshed
  // with the environment, never per frame. Half the resolution on light mode.
  const reflectScene = new THREE.Scene();
  const reflectSky = new THREE.Mesh(sky.geometry, skyMaterial(skyU, true, WEATHER_UNIFORMS.cloudParams));
  reflectSky.scale.setScalar(50);
  reflectScene.add(reflectSky);
  const reflectRT = new THREE.WebGLCubeRenderTarget(DPR.cap >= 2 ? 128 : 64, {
    type: THREE.HalfFloatType,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const reflectCam = new THREE.CubeCamera(0.1, 200, reflectRT);
  SKY_REFLECT.value = reflectRT.texture;
  function rebuildEnv() {
    const next = pmrem.fromScene(envScene, 0, 0.1, 200);
    scene.environment = next.texture;
    envRT?.dispose();
    envRT = next;
    reflectCam.update(renderer, reflectScene);
  }

  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.2);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const c = sun.shadow.camera;
  c.left = -1750;
  c.right = 1750;
  c.top = 1750;
  c.bottom = -1750;
  c.near = 400;
  c.far = 6400;
  sun.shadow.bias = -0.0001;
  sun.shadow.normalBias = 1.5;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);

  scene.fog = new THREE.FogExp2(0xffffff, 0.0003);

  // Without post-processing the fog is mixed in after tone mapping and
  // colour conversion; with it, everything stays linear until OutputPass.
  let linearOutput = false;
  const _c = new THREE.Color();
  function apply() {
    applyWeather(applySeason(blendState(base, base, 0, state), season, time === 'live'), weather);
    dirFrom(state.az, state.el, sunDir);
    dirFrom(state.az, skySunElevation(state.el), skySunDir);
    skyU.uZenith.value.copy(state.zenith);
    skyU.uMid.value.copy(state.mid);
    skyU.uHaze.value.copy(state.haze);
    skyU.uScatter.value.copy(state.scatter);
    skyU.uScatterK.value.set(state.scatterK, state.scatterP);
    skyU.uDisk.value.copy(state.disk);
    skyU.uDiskI.value = state.diskI;
    skyU.uNight.value = state.night;
    skyU.uGround.value.copy(state.hemiGround).multiplyScalar(0.55).lerp(state.haze, 0.18);
    // Maritime haze: fixed ocean bearing, strength and tint from time of day
    // and weather (paler and a touch warmer over the water at sunset). Kept
    // low so it is atmosphere, not a wall; gone by night.
    const day = 1 - state.night;
    skyU.uMaritimeDir.value.copy(oceanDir);
    skyU.uMaritime.value = (0.34 + 0.30 * weather.haze) * day;
    skyU.uSeaHaze.value.copy(state.haze).lerp(state.scatter, 0.10 + 0.08 * (1 - day));

    sun.color.copy(state.light);
    sun.intensity = state.lightI;
    // hemisphere fill takes its hues from the sky shader's own colours (the
    // upper sky and the ground term), normalised; brightness is hemiI
    const norm = (c) => c.multiplyScalar(1 / Math.max(c.r, c.g, c.b, 0.02));
    norm(hemi.color.copy(state.zenith).lerp(state.mid, 0.6));
    norm(hemi.groundColor.copy(skyU.uGround.value));
    hemi.intensity = state.hemiI;
    scene.environmentIntensity = state.env;
    // the wet-ground warm reflection reads this: 0 by day, 1 deep at night
    WEATHER_UNIFORMS.lookParams.value.x = state.night;
    renderer.toneMappingExposure = state.exposure;

    // mixed in linear light (post-processing on) the same haze reads about
    // twice as thick as mixed after tone mapping: thin it to match
    scene.fog.density = state.density * (linearOutput ? 0.5 : 1);
    const fp = FOG_UNIFORMS.fogParams.value;
    fp.x = state.scatterK;
    fp.y = state.scatterP;
    fp.z = state.falloff;
    // the in-scatter glow sits around the visible sun (see skySunElevation)
    const fs = FOG_UNIFORMS.fogSunDir.value;
    fs.x = skySunDir.x;
    fs.y = skySunDir.y;
    fs.z = skySunDir.z;
    const fl = FOG_UNIFORMS.fogLightDir.value;
    fl.x = sunDir.x;
    fl.y = sunDir.y;
    fl.z = sunDir.z;
    const sc = FOG_UNIFORMS.fogSunColor.value;
    if (linearOutput) {
      scene.fog.color.copy(state.haze);
      _c.copy(state.scatter);
    } else {
      toneMapInPlace(scene.fog.color.copy(state.haze), state.exposure);
      toneMapInPlace(_c.copy(state.scatter), state.exposure).convertLinearToSRGB();
    }
    sc.x = _c.r;
    sc.y = _c.g;
    sc.z = _c.b;
    // maritime fog: extra humidity toward the ocean and its paler sea colour,
    // carried by the same shared uniforms every fogged material reads
    const fo = FOG_UNIFORMS.fogOcean.value;
    fo.x = oceanDir.x;
    fo.y = oceanDir.y;
    fo.z = oceanDir.z;
    const fm = FOG_UNIFORMS.fogMaritime.value;
    fm.x = (0.10 + 0.20 * weather.haze) * day;
    fm.y = 0.30 * day;
    if (linearOutput) {
      _sea.copy(state.haze).lerp(state.scatter, 0.16);
    } else {
      toneMapInPlace(_sea.copy(state.haze).lerp(state.scatter, 0.16), state.exposure).convertLinearToSRGB();
    }
    const fsc = FOG_UNIFORMS.fogSeaColor.value;
    fsc.x = _sea.r;
    fsc.y = _sea.g;
    fsc.z = _sea.b;
  }

  // ------------------------------------------------ transitions
  let time = DEFAULT_TIME;
  let anim = null; // { from, to, t, dur }
  const listeners = new Set();
  const _from = resolve(PRESETS[DEFAULT_TIME]);
  function blendTo(target, animate) {
    if (!animate) {
      anim = null;
      blendState(target, target, 0, base);
      apply();
      envDirty = true;
      sinceEnv = 1; // rebuild on the next update
    } else {
      anim = { from: blendState(base, base, 0, _from), to: target, t: 0, dur: 2.4 };
    }
  }
  function setTime(name, { animate = !reducedMotion } = {}) {
    if (!RESOLVED[name]) return false;
    if (name === time && !anim) return true;
    time = name;
    blendTo(RESOLVED[name], animate);
    if (!animate) {
      rebuildEnv();
      envDirty = false;
    }
    for (const f of listeners) f(name);
    return true;
  }

  // Live mode: the preset follows a real sun position (degrees). The first
  // call blends over 2.4 s; later calls (the sun moving) jump quietly.
  const liveTarget = resolve(PRESETS[DEFAULT_TIME]);
  function setSun(az, el, { animate = !reducedMotion } = {}) {
    presetForSun(az, el, liveTarget);
    const entering = time !== 'live';
    time = 'live';
    if (anim && anim.to === liveTarget) return; // the blend picks up the new target
    blendTo(liveTarget, animate && entering);
    if (entering) for (const f of listeners) f('live');
  }

  // Weather modifiers (see applyWeather). Cheap: colour maths, no PMREM
  // here; the environment follows in steps in update().
  let envDirty = false;
  let sinceEnv = 0;
  function setWeather(w) {
    let changed = false;
    for (const k of WEATHER_DIALS) {
      const v = w[k] ?? 0;
      if (Math.abs(v - weather[k]) > 1e-4) {
        weather[k] = v;
        changed = true;
      }
    }
    if (!changed) return;
    apply();
    envDirty = true;
  }

  // Season blend weights [spring, summer, fall, winter] (src/seasons.js).
  // Like the weather: colour maths now, the environment in steps.
  function setSeason(w) {
    let d = 0;
    for (let i = 0; i < 4; i++) d = Math.max(d, Math.abs((w[i] ?? 0) - season[i]));
    if (d < 1e-4) return;
    for (let i = 0; i < 4; i++) season[i] = w[i] ?? 0;
    apply();
    envDirty = true;
  }

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function update(dt, camera) {
    sinceEnv += dt;
    if (anim) {
      anim.t = Math.min(1, anim.t + dt / anim.dur);
      blendState(anim.from, anim.to, ease(anim.t), base);
      apply();
      envDirty = true;
      if (anim.t >= 1) {
        anim = null;
        sinceEnv = 1; // the final state gets its environment now
      }
    }
    // the environment follows in steps; PMREM every frame would dominate
    if (envDirty && sinceEnv > 0.4) {
      envDirty = false;
      sinceEnv = 0;
      rebuildEnv();
    }
    sky.position.copy(camera.position);
    fitShadow(sun, camera, sunDir);
  }

  function setLinearOutput(on) {
    if (linearOutput === on) return;
    linearOutput = on;
    apply();
  }

  function setShadowSize(n) {
    if (sun.shadow.mapSize.x === n) return;
    sun.shadow.mapSize.set(n, n);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }

  apply();
  rebuildEnv();

  return {
    sky,
    sun,
    hemi,
    sunDir,
    skySunDir,
    state,
    base,
    weather,
    season,
    setTime,
    setSun,
    setWeather,
    setSeason,
    update,
    setLinearOutput,
    setShadowSize,
    onChange: (f) => listeners.add(f),
    get time() {
      return time;
    },
    // 0 by day, 1 at night; windows and street lamps follow it
    get night() {
      return state.night;
    },
    get transitioning() {
      return !!anim;
    },
  };
}

// Tight shadow camera around the view target: a close-up landmark gets
// ~0.015 world units per shadow texel, the whole city ~0.9. The centre snaps
// to the texel grid in light space so shadows do not crawl while orbiting.
const _fwd = new THREE.Vector3();
const _focus = new THREE.Vector3();
const _lr = new THREE.Vector3();
const _lu = new THREE.Vector3();
const _lf = new THREE.Vector3();
function fitShadow(sun, camera, dir) {
  // main.js keeps camera.userData.focus on the orbit target; without it,
  // aim where the view ray meets the city level
  const orbit = camera.userData.focus;
  let dist;
  if (orbit) {
    dist = THREE.MathUtils.clamp(camera.position.distanceTo(orbit), 10, 5000);
    _focus.copy(orbit);
  } else {
    camera.getWorldDirection(_fwd);
    const t = _fwd.y < -0.05 ? (0 - camera.position.y) / _fwd.y : 600;
    dist = THREE.MathUtils.clamp(t, 10, 5000);
    _focus.copy(camera.position).addScaledVector(_fwd, dist);
  }
  // radius in 20% steps, so the texel size is stable while orbiting
  const R0 = THREE.MathUtils.clamp(dist * 0.85, 30, 2000);
  const R = 30 * Math.pow(1.2, Math.round(Math.log(R0 / 30) / Math.log(1.2)));
  const texel = (2 * R) / sun.shadow.mapSize.x;
  // light-space basis
  _lf.copy(dir).negate();
  _lr.set(0, 1, 0).cross(_lf).normalize();
  _lu.copy(_lf).cross(_lr).normalize();
  const a = Math.round(_focus.dot(_lr) / texel) * texel;
  const b = Math.round(_focus.dot(_lu) / texel) * texel;
  const f = _focus.dot(_lf);
  _focus.copy(_lr).multiplyScalar(a).addScaledVector(_lu, b).addScaledVector(_lf, f);
  const cam = sun.shadow.camera;
  if (cam.right !== R) {
    cam.left = -R;
    cam.right = R;
    cam.top = R;
    cam.bottom = -R;
    cam.updateProjectionMatrix();
  }
  sun.shadow.normalBias = texel * 1.1;
  // Softness: PCF spreads its five taps over `radius` texels. Tie the radius
  // to a small world-space penumbra so a close landmark gets a readable soft
  // contact edge while the overview keeps its crisper ~2-texel spread. Cost is
  // unchanged (taps are fixed).
  sun.shadow.radius = THREE.MathUtils.clamp(0.35 / texel, 2, 6);
  sun.target.position.copy(_focus);
  sun.position.copy(_focus).addScaledVector(dir, 3200);
  sun.updateMatrixWorld();
  sun.target.updateMatrixWorld();
}

// ------------------------------------------------------------ ground
// Tileable detail texture: RG a normal (xz), B fbm height, A a finer noise.
function detailNoise(size = 256) {
  const lcg = (seed) => {
    let s = seed >>> 0 || 1;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  };
  const octave = (n, seed) => {
    const r = lcg(seed);
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = r();
    return (x, y) => {
      const fx = (x / size) * n;
      const fy = (y / size) * n;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const at = (i, j) => g[(((j % n) + n) % n) * n + (((i % n) + n) % n)];
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const o = [octave(4, 3), octave(8, 5), octave(16, 7), octave(32, 11), octave(64, 13)];
  const fine = [octave(32, 17), octave(64, 19), octave(128, 23)];
  const H = new Float32Array(size * size);
  const F = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      H[y * size + x] = 0.32 * o[0](x, y) + 0.26 * o[1](x, y) + 0.2 * o[2](x, y) + 0.13 * o[3](x, y) + 0.09 * o[4](x, y);
      F[y * size + x] = 0.5 * fine[0](x, y) + 0.3 * fine[1](x, y) + 0.2 * fine[2](x, y);
    }
  }
  const data = new Uint8Array(size * size * 4);
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 9;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 9;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      data[i + 1] = ((-dy / l) * 0.5 + 0.5) * 255;
      data[i + 2] = H[y * size + x] * 255;
      data[i + 3] = F[y * size + x] * 255;
    }
  }
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

// Grid lines along one axis: fine steps (`sub` per DEM cell) over the DEM,
// then steps that double outward to +-HALF, where the fog hides the edge.
// Grid lines along one axis: `subOf(cell)` lines per DEM cell over the DEM,
// then coarser and coarser out to +-half.
function axisLines(a0, a1, cells, subOf, half) {
  const out = [];
  const cell = (a1 - a0) / cells;
  const first = cell / subOf(0);
  const last = cell / subOf(cells - 1);
  for (let s = first * 2, a = a0 - first * 2; a > -half; s *= 1.6, a -= s) out.unshift(a);
  out.unshift(-half);
  for (let c = 0; c < cells; c++) {
    const n = subOf(c);
    for (let k = 0; k < n; k++) out.push(a0 + (c + k / n) * cell);
  }
  out.push(a1);
  for (let s = last * 2, a = a1 + last * 2; a < half; s *= 1.6, a += s) out.push(a);
  out.push(half);
  return out;
}

export const GROUND_HALF = 6000;
// The ground's grid lines (world units, both ascending): 4 x 4 quads per DEM
// cell over the core, where the city stands and the draped lines need them;
// one quad per cell over the rest of the DEM (the streamed surroundings,
// src/tiles.js); coarser beyond. The tile worker drapes the streamed tiles
// on exactly these triangles, so nothing floats or sinks.
export function groundAxes(terrain) {
  const b = terrain.bounds;
  const c = terrain.core;
  const wide = c && c !== b && Number.isInteger(c.c0);
  // columns west to east; rows: z runs north to south, the DEM rows south to north
  const subX = wide ? (i) => (i >= c.c0 && i < c.c0 + c.cols - 1 ? 4 : 1) : () => 4;
  const subZ = wide ? (j) => {
    const r = b.rows - 2 - j; // the DEM cell row (its south node) of z cell j
    return r >= c.r0 && r < c.r0 + c.rows - 1 ? 4 : 1;
  } : () => 4;
  return {
    xs: axisLines(b.x0, b.x1, b.cols - 1, subX, GROUND_HALF),
    zs: axisLines(b.zN, b.zS, b.rows - 1, subZ, GROUND_HALF),
  };
}

// Terrain shading, in the fragment shader:
//   valleys warm olive, uplands dry heath, pale granite on steep or high
//   ground broken up by noise, a darker tone in folds (vertex AO);
//   land cover from OSM (nature.js paints it into a mask texture):
//   R forest canopy, G grass / parks, B fields (1) / vineyards (2/3) /
//   orchards (1/3), A built-up density;
//   a detail normal at two scales and a very faint 50 m contour hint.
const GROUND_PARS = /* glsl */ `
uniform sampler2D tLand;
uniform sampler2D tNoise;
uniform vec4 uLandRect; // x0, z0, 1/width, 1/depth (world units)
uniform float uDatum;   // metres above sea level at y = 0
uniform float uHasLand;
// the streamed surroundings (src/tiles.js): the same four channels, coarser
uniform sampler2D tLandW;
uniform vec4 uLandRectW;
uniform float uHasLandW;
uniform vec4 uDemRect; // x0, zN, x1, zS: outside it there is no DEM data
uniform samplerCube uSkyCube; // linear HDR sky for wet reflections
varying vec3 vTWorld;
float demOutside(vec2 p) {
  vec2 o = max(max(uDemRect.xy - p, p - uDemRect.zw), 0.0);
  return smoothstep(0.0, 260.0, length(o));
}
varying vec3 vTNormal;
`;

const GROUND_COLOR = /* glsl */ `
{
  vec3 W = vTWorld;
  vec3 Ng = normalize(vTNormal);
  float slope = 1.0 - Ng.y;
  float hm = W.y * 4.0 + uDatum;
  vec4 nA = texture2D(tNoise, W.xz * 0.0045);
  vec4 nB = texture2D(tNoise, W.xz * 0.031);
  float n1 = nA.b;
  float n2 = nB.b;
  // season (src/seasons.js): grass fresh in spring, deep in summer,
  // olive-ochre in autumn, dull in winter; the woods follow the broadleaf
  // share of their crowns; fields turn to bare soil in winter
  #ifdef USE_FOG
  vec4 sW = seasonW;
  #else
  vec4 sW = vec4(0.0, 1.0, 0.0, 0.0);
  #endif
  vec3 gMul = sW.x * vec3(1.06, 1.16, 0.9) + sW.y * vec3(0.94, 0.98, 0.9) + sW.z * vec3(1.14, 1.0, 0.74) + sW.w * vec3(0.95, 0.9, 0.88);
  vec3 wMul = sW.x * vec3(1.1, 1.16, 0.95) + sW.y * vec3(0.95, 1.0, 0.95) + sW.z * vec3(1.45, 1.06, 0.72) + sW.w * vec3(1.2, 0.95, 0.98);
  vec3 valley = vec3(0.092, 0.140, 0.050) * gMul;
  vec3 lush = vec3(0.064, 0.122, 0.036) * gMul;
  vec3 upland = vec3(0.150, 0.145, 0.080);
  vec3 granite = vec3(0.300, 0.285, 0.255);
  vec3 col = mix(valley, lush, smoothstep(0.35, 0.7, n1));
  col = mix(col, upland, smoothstep(260.0, 470.0, hm + (n1 - 0.5) * 120.0) * 0.8);
  float rock = smoothstep(0.045, 0.12, slope + (n2 - 0.5) * 0.06 + (n1 - 0.5) * 0.04);
  rock = max(rock, smoothstep(0.62, 0.8, n2) * smoothstep(420.0, 540.0, hm));
  col = mix(col, granite * (0.8 + 0.4 * nB.a), rock * 0.85);
  // The ring around the core: its land cover streams in after the core is
  // up, so until then it gets a cheap, muted suburb tone (olive with a
  // little masonry) instead of the bare valley green. Streamed cover (grass,
  // woods, fields, built-up) is drawn over it as it arrives.
  {
    float coreIn = 0.0;
    if (uHasLand > 0.5) {
      vec2 cuv = (W.xz - uLandRect.xy) * uLandRect.zw;
      vec2 cD = min(cuv, 1.0 - cuv) / uLandRect.zw;
      coreIn = smoothstep(0.0, 50.0, min(cD.x, cD.y));
    }
    vec3 suburb = mix(valley, vec3(0.140, 0.140, 0.105), 0.4) * (0.9 + 0.2 * n2);
    col = mix(col, suburb, (1.0 - coreIn) * (1.0 - demOutside(W.xz)) * (1.0 - rock) * 0.6);
  }
  if (uHasLand + uHasLandW > 0.5) {
    vec2 luv = (W.xz - uLandRect.xy) * uLandRect.zw;
    // no clamped edge pixels smeared outward; the cover thins out over the
    // last 200 m inside the data edge instead of stopping at a ruled line
    vec2 edgeD = min(luv, 1.0 - luv) / uLandRect.zw;
    float inR = smoothstep(0.0, 50.0, min(edgeD.x, edgeD.y)) * uHasLand;
    vec4 L = texture2D(tLand, luv) * inR;
    // outside the core the streamed cover takes over (it is empty inside)
    if (uHasLandW > 0.5 && inR < 1.0) {
      vec2 wuv = (W.xz - uLandRectW.xy) * uLandRectW.zw;
      vec2 wD = min(wuv, 1.0 - wuv) / uLandRectW.zw;
      L += texture2D(tLandW, wuv) * smoothstep(0.0, 30.0, min(wD.x, wD.y)) * (1.0 - inR);
    }
    L.a = smoothstep(0.25, 0.8, L.a);
    float fine = nB.a;
    // fields and vineyards: faint stripes across the parcel
    float stripe = 0.5 + 0.5 * sin((W.x * 0.8 + W.z * 0.45) * (L.b > 0.5 ? 1.2 : 4.0));
    vec3 field = mix(vec3(0.175, 0.150, 0.075), vec3(0.105, 0.125, 0.045) * gMul, stripe * 0.6 + n2 * 0.4);
    field = mix(field, vec3(0.150, 0.112, 0.072) * (0.85 + 0.3 * n2), sW.w * 0.65 + sW.z * 0.25);
    col = mix(col, field, step(0.2, L.b) * 0.7);
    vec3 grass = vec3(0.085, 0.150, 0.035) * gMul * (0.85 + 0.3 * fine);
    col = mix(col, grass, L.g * 0.85);
    vec3 urban = vec3(0.185, 0.175, 0.160) * (0.9 + 0.2 * n2);
    col = mix(col, urban, L.a * 0.8 * (1.0 - L.g * 0.6));
    // canopy: dark, mottled at crown scale so a wood reads as trees from afar
    float crowns = texture2D(tNoise, W.xz * 0.21).a;
    vec3 canopy = mix(vec3(0.022, 0.045, 0.018), vec3(0.060, 0.098, 0.034) * wMul, smoothstep(0.3, 0.75, crowns * 0.7 + n2 * 0.3));
    // autumn: the broadleaf crowns in the wood turn in patches
    canopy = mix(canopy, vec3(0.09, 0.06, 0.022), sW.z * 0.4 * smoothstep(0.55, 0.8, nB.b * 0.6 + crowns * 0.4));
    col = mix(col, canopy, L.r * 0.95);
  }
  // faint contour hint every 50 m, gone where it would alias
  float hc = hm / 50.0;
  float fw = fwidth(hc);
  float line = 1.0 - smoothstep(0.0, 1.2 * fw, abs(fract(hc - 0.5) - 0.5));
  col *= 1.0 - 0.08 * line * (1.0 - smoothstep(0.05, 0.2, fw));
  // beyond the DEM: plain countryside, no invented relief detail
  float outside = demOutside(W.xz);
  col = mix(col, valley * (0.9 + 0.2 * n1), outside);
  diffuseColor.rgb = col * mix(vColor.rgb, vec3(1.0), outside);
}
`;

const GROUND_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
{
  vec2 dA = texture2D(tNoise, vTWorld.xz * 0.047).rg * 2.0 - 1.0;
  vec2 dB = texture2D(tNoise, vTWorld.xz * 0.19).rg * 2.0 - 1.0;
  vec2 dn = dA * 0.35 + dB * 0.25;
  vec3 pw = vec3(dn.x, 0.0, dn.y);
  normal = normalize(normal + mat3(viewMatrix) * pw);
  // outside the DEM the relief is a guess: shade it nearly flat
  normal = normalize(mix(normal, mat3(viewMatrix) * vec3(0.0, 1.0, 0.0), demOutside(vTWorld.xz) * 0.85));
}
`;

// Wet paving: mirror the sky cube along the reflected view ray. The shared
// wet patch already darkens and glosses up-facing surfaces and adds a flat
// fog-coloured smear; here we cancel that smear on the ground (exactly, with
// the same puddle mask) and replace it with a real, Fresnel-weighted
// reflection, so squares and the Douro quays catch the horizon and the low
// sun after rain. Replaces the stock end-of-lights chunk (which carries the
// shared cloud shade), so it must re-include it.
const GROUND_REFLECT = /* glsl */ `
#include <lights_fragment_end>
#ifdef USE_FOG
{
  vec3 rV = normalize( vViewPosition );
  vec3 rN = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
  // reflected view ray, back in world space for the cube
  vec3 rR = normalize( ( vec4( reflect( - rV, normal ), 0.0 ) * viewMatrix ).xyz );
  float rUp = smoothstep( 0.5, 0.92, rN.y );
  float rWet = cloudShape.z * rUp;
  float rPudN = texture2D( tCloud, vFogWorld.xz * 0.043 ).b;
  float rPud = rWet * smoothstep( 0.56, 0.7, rPudN ) * smoothstep( 0.15, 0.7, cloudShape.w + 0.15 );
  float rK = clamp( rWet * 0.30 + rPud * 0.85, 0.0, 1.0 );
  if ( rK > 0.001 ) {
    float rFres = 0.04 + 0.96 * pow( 1.0 - max( dot( normal, rV ), 0.0 ), 5.0 );
    vec3 rCol = min( textureCube( uSkyCube, rR ).rgb, vec3( 4.0 ) );
    // cancel the flat sky-smear the shared patch added (same mask), then add
    // the directional reflection and a vertical low-sun streak on the stone
    totalEmissiveRadiance -= fogColor * rPud * ( 0.04 + 0.1 * ( 1.0 - lookParams.x ) );
    totalEmissiveRadiance += rCol * rFres * rK;
    totalEmissiveRadiance += rCol * rPud * 0.10;
  }
}
#endif
`;

// Hills shade the valleys at a low sun. The shadow caster is a proxy at
// DEM resolution (one quad per DEM cell, 1/16 of the ground's triangles),
// a little below the ground so it never shadows the surface it follows.
// In the view it writes neither colour nor depth (three.js tests shadow
// casters against the view camera's layers, so a layer cannot hide it).
function shadowProxy(terrain) {
  const { heightAt, bounds: b } = terrain;
  const nx = b.cols;
  const nz = b.rows;
  const pos = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = b.x0 + ((b.x1 - b.x0) * i) / (nx - 1);
      const z = b.zN + ((b.zS - b.zN) * j) / (nz - 1);
      const k = (j * nx + i) * 3;
      pos[k] = x;
      pos[k + 1] = heightAt(x, z) - 0.6;
      pos[k + 2] = z;
    }
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, fog: false }));
  m.name = 'ground-shadow';
  m.castShadow = true;
  m.renderOrder = -20;
  return m;
}

// Ground mesh on the real terrain: a rectilinear grid, 4 x 4 quads per DEM
// cell over the DEM (so draped lines and buildings match it), coarser out
// to the fogged edge. Vertex colour: an ambient-occlusion term from the
// local concavity (folds darker, ridges a touch lighter).
export function createGround(terrain) {
  const { heightAt, bounds: b } = terrain;
  const { xs, zs } = groundAxes(terrain);
  const nx = xs.length;
  const nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      pos[k * 3] = xs[i];
      pos[k * 3 + 1] = heightAt(xs[i], zs[j]);
      pos[k * 3 + 2] = zs[j];
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let o = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const bb = a + 1;
      const c = a + nx;
      const d = c + 1;
      // counter-clockwise seen from above (+y)
      idx[o++] = a;
      idx[o++] = c;
      idx[o++] = bb;
      idx[o++] = bb;
      idx[o++] = c;
      idx[o++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const col = new Float32Array(nx * nz * 3);
  const R = 16; // 64 m
  const aoAt = (k) => {
    const x = pos[k * 3];
    const z = pos[k * 3 + 2];
    const h = pos[k * 3 + 1];
    const around = (heightAt(x + R, z) + heightAt(x - R, z) + heightAt(x, z + R) + heightAt(x, z - R)) / 4;
    const around2 = (heightAt(x + R * 2.5, z) + heightAt(x - R * 2.5, z) + heightAt(x, z + R * 2.5) + heightAt(x, z - R * 2.5)) / 4;
    const concave = (around - h) * 0.6 + (around2 - h) * 0.4; // world units
    const ao = THREE.MathUtils.clamp(1 - concave * 0.09, 0.6, 1.1);
    col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = ao;
  };
  for (let k = 0; k < nx * nz; k++) aoAt(k);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();

  const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  blank.needsUpdate = true;
  const uniforms = {
    tLand: { value: blank },
    tNoise: { value: detailNoise() },
    uLandRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uDatum: { value: terrain.datum },
    uHasLand: { value: 0 },
    tLandW: { value: blank },
    uLandRectW: { value: new THREE.Vector4(0, 0, 1, 1) },
    uHasLandW: { value: 0 },
    uDemRect: { value: new THREE.Vector4(b.x0, b.zN, b.x1, b.zS) },
    uSkyCube: SKY_REFLECT,
  };
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.97,
    metalness: 0,
    // push the ground back in depth so draped lines never z-fight with it
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 4,
  });
  mat.name = 'ground';
  // winter: settled snow above the snow line and frost, no roof dusting
  mat.defines = { BRG_NO_DUST: '' };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTWorld;\nvarying vec3 vTNormal;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTNormal = normalize(mat3(modelMatrix) * objectNormal);',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${GROUND_PARS}`)
      .replace('#include <color_fragment>', GROUND_COLOR)
      .replace('#include <normal_fragment_maps>', GROUND_NORMAL)
      .replace('#include <lights_fragment_end>', GROUND_REFLECT);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false; // the proxy below casts the hill shadows
  mesh.name = 'ground';
  const proxy = shadowProxy(terrain);
  mesh.add(proxy);
  // Progressive start (main.js): the ground is first built on the raw DEM,
  // before the landmark fits exist. Once their pads are in the terrain,
  // this re-reads heightAt where the pads reach (plus the AO radius), so
  // the result is the ground createGround would have built with the pads.
  const lowerIndex = (arr, v) => {
    let lo = 0;
    let hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  // Geometry LOD (main.js geoLod): far from the focus the same vertices are
  // drawn with every 2nd (or 4th) grid line: a quarter (a sixteenth) of the
  // triangles on the same normals and colours, so the surface keeps its look.
  const strideIndex = (step) => {
    const lines = (n) => {
      const a = [];
      for (let i = 0; i < n - 1; i += step) a.push(i);
      a.push(n - 1);
      return a;
    };
    const ci = lines(nx);
    const cj = lines(nz);
    const out = new Uint32Array((ci.length - 1) * (cj.length - 1) * 6);
    let q = 0;
    for (let j = 0; j < cj.length - 1; j++) {
      for (let i = 0; i < ci.length - 1; i++) {
        const a = cj[j] * nx + ci[i];
        const bb = cj[j] * nx + ci[i + 1];
        const c = cj[j + 1] * nx + ci[i];
        const d = cj[j + 1] * nx + ci[i + 1];
        out[q++] = a;
        out[q++] = c;
        out[q++] = bb;
        out[q++] = bb;
        out[q++] = c;
        out[q++] = d;
      }
    }
    return new THREE.BufferAttribute(out, 1);
  };
  const lodIndex = [geo.index, null, null];
  let lodLevel = 0;
  mesh.userData.setLod = (level) => {
    level = Math.max(0, Math.min(2, level | 0));
    if (level === lodLevel) return lodLevel;
    lodIndex[level] ??= strideIndex(level === 1 ? 2 : 4);
    geo.setIndex(lodIndex[level]);
    lodLevel = level;
    return lodLevel;
  };
  mesh.userData.applyPads = (pads = terrain.pads) => {
    if (!pads.length) return 0;
    // the normals need the full grid: back to the fine index while it runs
    const keepLod = lodLevel;
    mesh.userData.setLod(0);
    const reach = R * 2.5 + 1; // AO samples this far away
    const touched = new Uint8Array(nx * nz);
    let n = 0;
    for (const p of pads) {
      const r = p.r + reach;
      const i0 = Math.max(0, lowerIndex(xs, p.cx - r) - 1);
      const i1 = Math.min(nx - 1, lowerIndex(xs, p.cx + r) + 1);
      const j0 = Math.max(0, lowerIndex(zs, p.cz - r) - 1);
      const j1 = Math.min(nz - 1, lowerIndex(zs, p.cz + r) + 1);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = j * nx + i;
          if (touched[k]) continue;
          touched[k] = 1;
          pos[k * 3 + 1] = heightAt(xs[i], zs[j]);
          n++;
        }
      }
    }
    // AO after all heights (it reads heightAt, not the mesh, but keep order clear)
    for (let k = 0; k < nx * nz; k++) if (touched[k]) aoAt(k);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    // the shadow proxy follows (one node per DEM cell)
    const pp = proxy.geometry.attributes.position;
    for (let k = 0; k < pp.count; k++) pp.setY(k, heightAt(pp.getX(k), pp.getZ(k)) - 0.6);
    pp.needsUpdate = true;
    proxy.geometry.computeBoundingSphere();
    mesh.userData.setLod(keepLod);
    return n;
  };
  mesh.userData.setLandcover = (tex, rect) => {
    uniforms.tLand.value = tex;
    uniforms.uLandRect.value.set(rect.x0, rect.z0, 1 / rect.w, 1 / rect.d);
    uniforms.uHasLand.value = 1;
  };
  // the streamed land cover around the core (src/tiles.js); rect in world
  // units: { x0, z0 (north edge), w, d }
  mesh.userData.setLandcoverWide = (tex, rect) => {
    uniforms.tLandW.value = tex;
    uniforms.uLandRectW.value.set(rect.x0, rect.z0, 1 / rect.w, 1 / rect.d);
    uniforms.uHasLandW.value = 1;
  };
  return mesh;
}
