// Opening shot: 4 s from high over the Cávado valley (north-west of the
// city) down to the overview framing, swinging round from the north-west
// to the south while descending. Orbit-style interpolation around a moving
// target (radius, polar angle, azimuth), eased in and out, so the map turns
// gently under the camera instead of sliding.
//
// Skippable by any click, wheel, touch or key. main.js does not start it
// under reduced motion, with a #place= / #route= deep link, or once it has
// played in this browser session.
import * as THREE from 'three';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// start: { position, target } in world units. main.js puts it low over the
// western slopes that fall toward the Cávado, looking east across the
// valley at the sanctuary hills with the sky in frame, and inside the data
// rectangle so the foreground is real ground, not haze.
export function createIntro({ camera, home, heightAt, start, duration = 4, onDone }) {
  const endOff = new THREE.Spherical().setFromVector3(home.position.clone().sub(home.target));
  const startOff = new THREE.Spherical().setFromVector3(start.position.clone().sub(start.target));
  // turn the short way round to the end azimuth
  let dTheta = endOff.theta - startOff.theta;
  dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
  const from = {
    target: start.target.clone(),
    radius: startOff.radius,
    phi: startOff.phi,
    theta: endOff.theta - dTheta,
  };
  const target = new THREE.Vector3();
  const off = new THREE.Vector3();
  const sph = new THREE.Spherical();
  let t = 0;
  let active = true;
  let frozen = null;
  const listeners = [];

  function pose(k) {
    const e = ease(k);
    target.lerpVectors(from.target, home.target, e);
    sph.set(
      THREE.MathUtils.lerp(from.radius, endOff.radius, e),
      THREE.MathUtils.lerp(from.phi, endOff.phi, e),
      THREE.MathUtils.lerp(from.theta, endOff.theta, e),
    );
    off.setFromSpherical(sph);
    camera.position.copy(target).add(off);
    const floor = heightAt(camera.position.x, camera.position.z) + 30;
    if (camera.position.y < floor) camera.position.y = floor;
    camera.lookAt(target);
  }

  function finish() {
    if (!active) return;
    active = false;
    for (const [type, fn, opts] of listeners) window.removeEventListener(type, fn, opts);
    camera.position.copy(home.position);
    camera.lookAt(home.target);
    document.body.classList.remove('is-intro', 'is-intro-title');
    onDone?.();
  }

  const skip = () => finish();
  for (const type of ['pointerdown', 'wheel', 'keydown', 'touchstart']) {
    const opts = { passive: true, capture: true };
    window.addEventListener(type, skip, opts);
    listeners.push([type, skip, opts]);
  }
  document.body.classList.add('is-intro');
  pose(0);

  return {
    get active() {
      return active;
    },
    get progress() {
      return t;
    },
    // true while the intro owns the camera
    update(dt) {
      if (!active) return false;
      if (frozen == null) t = Math.min(1, t + Math.min(dt, 0.1) / duration);
      pose(t);
      // the title rises in over the second half of the flight
      if (t > 0.45) document.body.classList.add('is-intro-title');
      if (t >= 1) finish();
      return active;
    },
    skip: finish,
    // for screenshots and tests: hold the flight at progress k (0..1)
    seek(k) {
      frozen = k;
      t = THREE.MathUtils.clamp(k, 0, 1);
      pose(t);
      if (t > 0.45) document.body.classList.add('is-intro-title');
    },
  };
}
