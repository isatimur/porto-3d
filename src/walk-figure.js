// The visitor's figure in walk mode (src/walk.js): a small rounded person,
// 1.75 m tall, with a walk cycle driven by the distance walked. Built in
// metres and scaled to world units; the origin is between the feet, the
// figure looks along -z (north) at yaw 0.
import * as THREE from 'three';
import { METRES_PER_UNIT } from './geo.js';

const HIP = 0.9; // metres above the ground
const SHOULDER = 1.42;
const STRIDE = 1.5; // metres of walking for one full cycle

export function createFigure({ shirt = 0xe0a948, trousers = 0x2b3550, skin = 0xe2b594, hair = 0x3a2a1c } = {}) {
  const mat = (color, roughness = 0.85) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
  const mShirt = mat(shirt), mLegs = mat(trousers), mSkin = mat(skin, 0.7), mHair = mat(hair), mShoe = mat(0x1d1a17);
  const root = new THREE.Group();
  root.name = 'walk-figure';
  const body = new THREE.Group(); // bobs with the step
  root.add(body);
  const add = (parent, geo, material, x, y, z) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  // torso, hips, neck, head, hair
  add(body, new THREE.CapsuleGeometry(0.17, 0.3, 6, 14), mShirt, 0, 1.2, 0).scale.set(1, 1, 0.72);
  add(body, new THREE.CapsuleGeometry(0.155, 0.1, 6, 14), mLegs, 0, 0.94, 0).scale.set(1, 1, 0.74);
  add(body, new THREE.CylinderGeometry(0.05, 0.055, 0.1, 10), mSkin, 0, 1.5, 0);
  add(body, new THREE.SphereGeometry(0.115, 18, 14), mSkin, 0, 1.63, 0).scale.set(0.92, 1.08, 1);
  const cap = add(body, new THREE.SphereGeometry(0.122, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mHair, 0, 1.645, 0.012);
  cap.scale.set(0.94, 1.06, 1.02);
  // a limb hangs from a pivot, so a rotation about x swings it
  const limb = (y, x, radius, length, material, foot = false) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    body.add(pivot);
    add(pivot, new THREE.CapsuleGeometry(radius, length - radius * 2, 5, 10), material, 0, -length / 2, 0);
    if (foot) add(pivot, new THREE.BoxGeometry(0.1, 0.07, 0.25), mShoe, 0, -length + 0.02, -0.05);
    else add(pivot, new THREE.SphereGeometry(radius * 1.05, 10, 8), mSkin, 0, -length, 0);
    return pivot;
  };
  const legL = limb(HIP, -0.09, 0.075, HIP - 0.03, mLegs, true);
  const legR = limb(HIP, 0.09, 0.075, HIP - 0.03, mLegs, true);
  const armL = limb(SHOULDER, -0.235, 0.05, 0.6, mShirt);
  const armR = limb(SHOULDER, 0.235, 0.05, 0.6, mShirt);
  root.scale.setScalar(1 / METRES_PER_UNIT);

  let phase = 0;
  let swing = 0; // 0 standing .. 1 walking, eased
  // metres: distance walked this frame; running: longer swing
  function step(metres, dt, running = false) {
    const moving = metres > 1e-4;
    swing += ((moving ? 1 : 0) - swing) * Math.min(1, dt * 8);
    phase += (metres / STRIDE) * Math.PI * 2;
    const a = Math.sin(phase) * (running ? 0.85 : 0.55) * swing;
    legL.rotation.x = a;
    legR.rotation.x = -a;
    armL.rotation.x = -a * 0.8;
    armR.rotation.x = a * 0.8;
    armL.rotation.z = -0.06;
    armR.rotation.z = 0.06;
    body.position.y = Math.abs(Math.cos(phase)) * 0.03 * swing;
    body.rotation.x = running ? -0.12 * swing : -0.03 * swing; // leans into the walk (the figure looks along -z)
  }
  function dispose() {
    root.traverse((o) => o.geometry?.dispose());
    for (const m of [mShirt, mLegs, mSkin, mHair, mShoe]) m.dispose();
  }
  return { root, step, dispose };
}
