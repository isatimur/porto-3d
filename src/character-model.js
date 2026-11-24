// A person as a rigged, textured model (GLB) — the street-mission characters
// and the walker. Same contract as createFigure (walk-figure.js): root in
// world units, origin between the feet, the figure looks along -z at yaw 0,
// step(metres, dt, running) advances it, dispose() frees it.
//
// A model plays its own clip (the mission people: idle). Give it more clips
// ({ idle, walk, run }: a URL to a GLB whose first animation is the clip, or
// 'own' for the model's own clip) and step() blends them by the speed. All
// the models share one skeleton layout (same bone names), so a clip from one
// model plays on another.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { METRES_PER_UNIT } from './geo.js';

const loader = new GLTFLoader();
const clipCache = new Map(); // url -> Promise<AnimationClip>

// keep a clip in place: the hips may sway up and down, not travel
export function inPlace(clip) {
  for (const t of clip.tracks) {
    if (!t.name.endsWith('.position') || !/hips/i.test(t.name)) continue;
    const v = t.values;
    for (let i = 0; i < v.length; i += 3) {
      v[i] = v[0];
      v[i + 2] = v[2];
    }
  }
  return clip;
}

function loadClip(url) {
  if (!clipCache.has(url)) clipCache.set(url, loader.loadAsync(url).then((g) => inPlace(g.animations[0])));
  return clipCache.get(url);
}

const WALK_MS = 1.4; // metres per second the walk clip shows
const RUN_MS = 3.8;

// fit a loaded model in place: feet on the origin, centred, heightM tall (in
// metres, the skinned box in the model's parent frame); it still faces +z
export function fitToHeight(model, heightM) {
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.frustumCulled = false; // a skinned mesh moves outside its bind-pose box
    }
  });
  model.updateMatrixWorld(true);
  const box = new THREE.Box3();
  model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    o.computeBoundingBox();
    box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  if (box.isEmpty()) box.setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const k = heightM / Math.max(size.y, 1e-6);
  model.scale.multiplyScalar(k);
  model.position.set(-((box.min.x + box.max.x) / 2) * k, -box.min.y * k, -((box.min.z + box.max.z) / 2) * k);
  return model;
}

// url: the .glb; heightM: how tall the person stands, in metres
export async function loadCharacter(url, heightM, clips = null) {
  const gltf = await loader.loadAsync(url);
  const model = fitToHeight(gltf.scene, heightM);
  // glTF characters face +z; ours look along -z
  const turn = new THREE.Group();
  turn.rotation.y = Math.PI;
  turn.add(model);
  const root = new THREE.Group();
  root.name = 'character-model';
  root.add(turn);
  root.scale.setScalar(1 / METRES_PER_UNIT);

  const mixer = new THREE.AnimationMixer(model);
  const own = gltf.animations[0] ? inPlace(gltf.animations[0]) : null;
  let step;
  if (!clips) {
    if (own) {
      const a = mixer.clipAction(own);
      a.time = Math.random() * own.duration; // people do not breathe in step
      a.play();
    }
    step = (_metres, dt) => mixer.update(dt);
  } else {
    const get = (src) => (src === 'own' ? Promise.resolve(own) : src ? loadClip(src).catch(() => null) : Promise.resolve(null));
    const [idle, walk, run] = await Promise.all([get(clips.idle), get(clips.walk), get(clips.run)]);
    const act = {};
    for (const [name, clip] of Object.entries({ idle, walk, run })) {
      if (!clip) continue;
      const a = mixer.clipAction(clip);
      a.setEffectiveWeight(name === 'idle' ? 1 : 0);
      a.play();
      act[name] = a;
    }
    const w = { idle: 1, walk: 0, run: 0 };
    root.userData.clipWeights = w; // tests read it
    root.userData.clips = Object.keys(act);
    step = (metres, dt, running = false) => {
      const ms = dt > 0 ? metres / dt : 0;
      let want = ms < 0.25 ? 'idle' : running ? 'run' : 'walk';
      if (!act[want]) want = act.walk ? 'walk' : 'idle';
      const blend = Math.min(1, dt * 8);
      for (const n of ['idle', 'walk', 'run']) {
        if (!act[n]) continue;
        w[n] += ((n === want ? 1 : 0) - w[n]) * blend;
        act[n].setEffectiveWeight(w[n]);
      }
      // the feet keep pace with the ground
      if (act.walk) act.walk.timeScale = THREE.MathUtils.clamp(ms / WALK_MS, 0.6, 2);
      if (act.run) act.run.timeScale = THREE.MathUtils.clamp(ms / RUN_MS, 0.6, 1.8);
      mixer.update(dt);
    };
  }
  return {
    root,
    step,
    dispose() {
      mixer.stopAllAction();
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry?.dispose();
        for (const m of [].concat(o.material)) {
          for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
          m.dispose();
        }
      });
    },
  };
}
