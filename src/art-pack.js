// The Higgsfield art pack, textures only (art/PROVENANCE.md). Optional visual
// upgrade, loaded lazily after the scene is ready, never on the first-load path:
//   - roof canal tiles (facades.js roof branch, uRoofTex)
// The texture is AI-generated and sits on geometry; no label is shown. Not
// loaded on the P and S device classes. ?art=0 turns the pack off.
// Files live in public/art/: 256 px on M, 512 px on L and XL.
import * as THREE from 'three';
import { BUILDING_UNIFORMS } from './buildings.js';

const ROOF_MEAN = 0.358; // linear luminance of roof_canudo_*.webp (measured with ImageMagick)

function load(loader, name, size, renderer) {
  return new Promise((resolve) => {
    loader.load(
      `/art/${name}_${size}.webp`,
      (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        resolve(tex);
      },
      undefined,
      () => resolve(null), // a missing file leaves the procedural look
    );
  });
}

// cls: the device class (perf.cls). Resolves with what was applied.
export async function startArtPack({ cls, renderer }) {
  const off = new URLSearchParams(location.search).get('art') === '0';
  if (off || cls === 'P' || cls === 'S') return { skipped: true, cls };
  const size = cls === 'M' ? 256 : 512;
  const applied = [];
  const roof = await load(new THREE.TextureLoader(), 'roof_canudo', size, renderer);
  if (roof) {
    BUILDING_UNIFORMS.uRoofTex.value = roof;
    BUILDING_UNIFORMS.uRoofK.value.set(1, 1 / ROOF_MEAN);
    applied.push('roof');
  }
  return { size, applied };
}
