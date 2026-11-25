// The people nearest the camera as rigged, textured models (people.js draws
// the rest of the crowd as instanced figures). Eight passers-by, each with a
// walk clip; a person who stands plays the walker's idle clip (all the models
// share one skeleton layout). A few clones of each model are made once; a
// person close to the camera borrows a clone and gives it back when far.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { fitToHeight, inPlace } from './character-model.js';
import { S } from './geo.js';

const DIR = 'assets/characters/3d/';
// file, height in metres, the crowd kinds it may stand for (people.js:
// 0 adult, 1 child, 2 elderly, 3 shopper)
export const PASSERS = [
  { file: 'crowd/passante-1.glb', h: 1.65, kinds: [0, 3] },
  { file: 'crowd/passante-2.glb', h: 1.78, kinds: [0, 3] },
  { file: 'crowd/passante-3.glb', h: 1.68, kinds: [2] },
  { file: 'crowd/passante-4.glb', h: 1.58, kinds: [2, 3] },
  { file: 'crowd/passante-5.glb', h: 1.8, kinds: [0] },
  { file: 'crowd/passante-6.glb', h: 1.65, kinds: [0, 3] },
  { file: 'crowd/passante-7.glb', h: 1.4, kinds: [1] },
  { file: 'crowd/passante-8.glb', h: 1.8, kinds: [0, 3] },
];
const IDLE = 'heroi-idle.glb';
const COPIES = 4; // clones of each model
const WALK_MS = 1.4; // metres per second the walk clip shows

// one download per file, however many crowds ask
const gltfs = new Map();
const fetchGltf = (url) => {
  if (!gltfs.has(url)) gltfs.set(url, new GLTFLoader().loadAsync(url));
  return gltfs.get(url);
};

// A seated pose over the idle clip (the models have no sit clip): the
// person sits on the quay with the legs out in front. Each thigh and shin
// turns to point forward, then the body drops until the hips are just over
// the ground (y). (A seat height would need a seat: the quay sitters of
// people.js have none.)
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _t = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _wq = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
function aim(bone, child, target) {
  bone.updateWorldMatrix(true, false);
  child.updateWorldMatrix(false, false);
  _a.setFromMatrixPosition(bone.matrixWorld);
  _b.setFromMatrixPosition(child.matrixWorld);
  _d.subVectors(_b, _a).normalize();
  _q.setFromUnitVectors(_d, target);
  bone.getWorldQuaternion(_wq);
  bone.parent.getWorldQuaternion(_pq);
  bone.quaternion.copy(_pq.invert().multiply(_q.multiply(_wq)));
}
function seat(s, y) {
  const r = s.root.rotation.y;
  const fx = Math.sin(r);
  const fz = Math.cos(r);
  let hip = 0;
  s.legs.forEach(([up, leg, foot], k) => {
    // the knees a little apart, the heels on the ground
    const sx = (k ? -0.12 : 0.12) * fz;
    const sz = (k ? 0.12 : -0.12) * fx;
    aim(up, leg, _t.set(fx + sx, 0.02, fz + sz).normalize());
    aim(leg, foot, _t.set(fx, -0.14, fz).normalize());
    hip += _a.setFromMatrixPosition(up.matrixWorld).y / 2;
  });
  // the hip joints 12 cm over the ground (root scale: S x the person's scale)
  s.root.position.y -= hip - (y + 0.12 * s.root.scale.x);
}

export function createCrowdModels(group) {
  const free = PASSERS.map(() => []); // per model: the clones not in use
  const byKind = [[], [], [], []]; // kind -> model indices
  PASSERS.forEach((p, m) => p.kinds.forEach((k) => byKind[k].push(m)));
  const all = [];
  let state = 'idle'; // idle | loading | ready | failed

  async function load() {
    state = 'loading';
    try {
      const idleGltf = await fetchGltf(DIR + IDLE);
      const idle = inPlace(idleGltf.animations[0]);
      await Promise.all(
        PASSERS.map(async (p, m) => {
          const gltf = await fetchGltf(DIR + p.file);
          const walk = inPlace(gltf.animations[0]);
          // Porto has two crowds (porto-streetscape.js, street-kit.js), each
          // with its own clones: the second clones the first one's scene
          const base = fitToHeight(cloneSkinned(gltf.scene), p.h);
          for (let c = 0; c < COPIES; c++) {
            const model = c === 0 ? base : cloneSkinned(base);
            const root = new THREE.Group();
            root.name = `passer-${m + 1}`;
            root.add(model);
            root.scale.setScalar(S);
            root.visible = false;
            root.userData.crowdBody = true; // walk.js: the walker cannot pass through
            const mixer = new THREE.AnimationMixer(model);
            const aw = mixer.clipAction(walk);
            const ai = mixer.clipAction(idle);
            aw.play();
            ai.play();
            // the leg chains, for a seated pose over the idle clip
            const legs = ['Left', 'Right'].map((sd) => ['UpLeg', 'Leg', 'Foot'].map((b) => model.getObjectByName(sd + b)));
            const slot = { m, root, mixer, aw, ai, owner: null, seen: 0, legs: legs.every((l) => l.every(Boolean)) ? legs : null };
            group.add(root);
            free[m].push(slot);
            all.push(slot);
          }
        }),
      );
      state = 'ready';
    } catch (e) {
      console.warn('crowd models:', e);
      state = 'failed';
    }
  }

  const held = new Map(); // person key -> slot
  let frame = 0;
  // a person key wants a model of its kind; null when none is free
  function take(key, kind, seed) {
    let s = held.get(key);
    if (s) return s;
    // the model of this kind with the most clones free: the least seen now,
    // so the street does not show three of the same person
    const list = byKind[kind] || byKind[0];
    let m = -1;
    for (let t = 0; t < list.length; t++) {
      const c = list[(seed + t) % list.length];
      if (free[c].length > (m < 0 ? 0 : free[m].length)) m = c;
    }
    // all clones of the kind are out (four children close by): any model
    // with one free stands in
    for (let t = 0; m < 0 && t < PASSERS.length; t++) {
      const c = (seed + t) % PASSERS.length;
      if (free[c].length) m = c;
    }
    if (m < 0) return null;
    s = free[m].pop();
    s.owner = key;
    s.aw.time = (seed * 0.37) % s.aw.getClip().duration; // people do not walk in step
    held.set(key, s);
    return s;
  }

  return {
    get ready() {
      return state === 'ready';
    },
    get shown() {
      let n = 0;
      for (const s of all) if (s.root.visible) n++;
      return n;
    },
    // start loading the first time a close view needs the models
    want() {
      if (state === 'idle') load();
    },
    begin() {
      frame++;
    },
    // a close person may still be drawn as an instanced figure only when the
    // models cannot come (the load failed)
    get failed() {
      return state === 'failed';
    },
    // place the model of person `key` this frame; false: none to show
    // speedMs: ground speed (metres per second), 0 for a person who stands;
    // sit: the person sits on the ground at y, the legs out (seat())
    show(key, kind, seed, x, y, z, hx, hz, scale, speedMs, dt, sit = false) {
      if (state !== 'ready') return false;
      const s = take(key, kind, seed);
      if (!s) return false;
      s.seen = frame;
      s.root.visible = true;
      s.root.position.set(x, y, z);
      s.root.rotation.y = Math.atan2(hx, hz); // the model looks along +z
      s.root.scale.setScalar(S * scale);
      const walking = speedMs > 0.2;
      s.aw.setEffectiveWeight(walking ? 1 : 0);
      s.ai.setEffectiveWeight(walking ? 0 : 1);
      s.aw.timeScale = walking ? THREE.MathUtils.clamp(speedMs / WALK_MS, 0.5, 1.8) : 1;
      s.mixer.update(dt);
      if (sit && s.legs) seat(s, y);
      return true;
    },
    // after a frame: the clones nobody asked for go back to the pool
    end() {
      for (const [key, s] of held) {
        if (s.seen === frame) continue;
        s.root.visible = false;
        s.owner = null;
        held.delete(key);
        free[s.m].push(s);
      }
    },
    hide() {
      frame++;
      this.end();
    },
  };
}
