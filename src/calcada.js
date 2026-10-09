// The calçada (Portuguese pavement) material and its pattern ids. It lived in
// streetscape.js; roads.js needs it for the street surfaces drawn at boot, and
// streetscape.js pulls in the people, the street furniture and the POI signs,
// which only the deferred life layer uses. Here it stands alone so that the
// life chunk can load after the first frame.
import * as THREE from 'three';
import { S } from './geo.js';
import { createCalcadaTextures, createWetDryTexture } from './textures.js';
import { WEATHER_UNIFORMS } from './scene.js';

// pattern ids (aPat.x): 0 none (the vertex colour)
export const CALCADA = { waves: 1, net: 2, sidewalk: 3, street: 4 };
const WAVE_NAMES = /Pra[çc]a da Rep[úu]blica|Avenida Central|Largo do Pa[çc]o|Rossio|Pra[çc]a do Munic[íi]pio/i;
const SQUARE_NAMES = /^(Largo|Pra[çc]a|Praceta|Campo|Terreiro|Rossio|Adro|Avenida|Alameda)\b/i;
// the pattern of a street or square by its OSM name; kind 'square' for areas
export function calcadaPatternOf(name = '', kind = 'street') {
  if (WAVE_NAMES.test(name || '')) return CALCADA.waves;
  if (kind === 'square' || SQUARE_NAMES.test(name || '')) return CALCADA.net;
  return CALCADA.street;
}

// p: metres (x east, y south); pat: pattern, metres across the strip from
// its middle, half width (metres). Returns the linear albedo. The stone comes
// from textures.js (createCalcadaTextures): RGB albedo, sampled in world
// space and UV-tiled; A (the sett height) is left to the mip chain. The wave,
// net and sett scales below put the drawn stones at their real size (~8 cm
// setts, a 3.2 m "mar largo" band, a 2.2 m net).
const CALCADA_GLSL = /* glsl */ `
uniform sampler2D tCalWaves;
uniform sampler2D tCalNet;
uniform sampler2D tCalSide;
uniform sampler2D tCalStreet;
uniform sampler2D tWetDry;
uniform vec4 uWet; // z wetness 0..1 (rain), w rain intensity
const float CAL_WAVES = 0.0625; // uv tiles per metre (1 / 16 m)
const float CAL_NET = 0.0758;   // 1 / 13.2 m
const float CAL_SETTS = 0.893;  // 1 / 1.12 m
vec3 calCalcada(vec2 p, vec3 pat) {
  float px = max(length(fwidth(p)), 1e-4); // metres per pixel
  float k = pat.x;
  vec4 c;
  if (k < 1.5) c = texture2D(tCalWaves, p * CAL_WAVES);
  else if (k < 2.5) c = texture2D(tCalNet, p * CAL_NET);
  else if (k < 3.5) c = texture2D(tCalSide, p * CAL_SETTS);
  else c = texture2D(tCalStreet, p * CAL_SETTS);
  // the pattern mean: the far view flattens to it, so the paving reads as a
  // tone, not a shimmer of texels
  vec3 lime = k < 2.5 ? vec3(0.56, 0.54, 0.48) : k < 3.5 ? vec3(0.47, 0.455, 0.41) : vec3(0.448, 0.432, 0.384);
  vec3 bas = vec3(0.075, 0.075, 0.08);
  float avg = k < 1.5 ? 0.4 : k < 2.5 ? 0.26 : 0.0;
  vec3 col = mix(c.rgb, mix(lime, bas, avg), smoothstep(0.28, 0.7, px));
  // the streets: a black basalt band along both edges, over the setts
  if (k > 3.5) {
    float e = pat.z - abs(pat.y); // metres from the edge
    float band = 1.0 - smoothstep(0.4 - px, 0.4 + px, e);
    col = mix(col, bas, band * 0.92);
  }
  return col;
}`;

// The calçada maps are built once per quality tier and shared by every mesh
// (one texture set, UV-tiled), so the sampled paving adds no per-street draw.
const CAL_MAPS = {};
function calcadaMaps(lite) {
  const key = lite ? 'lite' : 'full';
  let m = CAL_MAPS[key];
  if (!m) {
    const size = lite ? 128 : 256;
    m = CAL_MAPS[key] = { ...createCalcadaTextures(size), wet: createWetDryTexture(lite ? 64 : 128) };
  }
  return m;
}

export function calcadaMaterial({ polygonOffsetUnits = -2, roughness = 0.9, lite = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits });
  mat.customProgramCacheKey = () => `calcada:${lite ? 1 : 0}`;
  mat.onBeforeCompile = (sh) => {
    const maps = calcadaMaps(lite);
    sh.uniforms.tCalWaves = { value: maps.waves };
    sh.uniforms.tCalNet = { value: maps.net };
    sh.uniforms.tCalSide = { value: maps.sidewalk };
    sh.uniforms.tCalStreet = { value: maps.street };
    sh.uniforms.tWetDry = { value: maps.wet };
    // live weather wetness (src/weather.js >= scene.js WEATHER_UNIFORMS);
    // shared by reference, so the uniforms need no per-frame update here
    sh.uniforms.uWet = WEATHER_UNIFORMS.cloudShape;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aPat;\nvarying vec3 vPat;\nvarying vec2 vCalW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPat = aPat;\nvCalW = (modelMatrix * vec4(position, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPat;\nvarying vec2 vCalW;\n${CALCADA_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\nif (vPat.x > 0.5) diffuseColor.rgb = calCalcada(vCalW * ${(1 / S).toFixed(1)}, vPat);`)
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
#ifdef USE_FOG
// Wet paving, on top of the scene's shared wet patch: the wet/dry map
// (textures.js createWetDryTexture) gives the calçada its own puddle mask and
// damp grain, so the setts gloss in patches while dry stone stays rough.
if (uWet.z > 0.001 && vPat.x > 0.5) {
  vec3 wn = (vec4(normal, 0.0) * viewMatrix).xyz;
  float up = smoothstep(0.5, 0.9, wn.y);
  vec2 wd = texture2D(tWetDry, vCalW * 0.09).rg;
  float vWet = uWet.z * up;
  material.roughness = mix(material.roughness, 0.12, vWet * smoothstep(0.5, 0.85, wd.r));
  material.roughness = mix(material.roughness, material.roughness * (0.72 + 0.55 * wd.g), vWet * 0.4);
}
#endif`,
      );
  };
  return mat;
}
