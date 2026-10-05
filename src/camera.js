// Camera rig. One owner writes the camera each frame:
//   touring -> the route fly-along driver owns it (controls disabled)
//   flying  -> the tween owns it (controls disabled)
//   else    -> OrbitControls, then the idle parallax offset on top.
// The parallax offset is removed before controls.update() so OrbitControls
// never integrates it.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const MAP_LIMIT = 1700;
const GROUND_CLEARANCE = 3; // world units (12 m) above the terrain
export const MIN_DISTANCE = 30; // orbit distance floor, world units (120 m)
const IDLE_MS = 2200;

// Keyboard flight (fly.js gives the input). World units per second:
// 0.6 x the height over the ground, 20..600, then x3 (Shift) or x0.3 (Alt).
// ease: time to about 95 % of the wanted velocity. margin: the soft wall
// past the terrain rectangle, where outward motion fades to zero.
export const FLY = { perHeight: 0.6, min: 20, max: 600, vertical: 0.8, easeIn: 0.25, easeOut: 0.35, margin: 250, ceiling: 2400, resumeMs: 2000, look: 0.0035 };

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createCameraRig(camera, dom, heightAt, { reducedMotion, onFlightEnd, onFlightStart, onTourCancel, bounds = null }) {
  const controls = new OrbitControls(camera, dom);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065; // a little more glide after a drag
  // frame() lowers it for landmarks smaller than the floor can show
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = 5200; // room for a whole-city route next to two panels
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = 1.4; // about 80 degrees: never level with the ground
  controls.screenSpacePanning = false;
  controls.zoomSpeed = 0.85;
  controls.rotateSpeed = 0.5;
  // no listenToKeyEvents(): arrow keys belong to landmark navigation

  let interacting = false;
  let lastInput = performance.now();
  controls.addEventListener('start', () => {
    interacting = true;
    lastInput = performance.now();
    cancelFlight();
  });
  controls.addEventListener('end', () => {
    interacting = false;
    lastInput = performance.now();
  });

  // pointer target for parallax, normalised -1..1; fine pointers only
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const target = new THREE.Vector2();
  const smooth = new THREE.Vector2();
  const offset = new THREE.Vector3();
  dom.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    target.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
  });
  dom.addEventListener('pointerleave', () => target.set(0, 0));

  let flight = null;
  function cancelFlight() {
    if (!flight) return;
    flight = null;
    controls.enabled = true;
  }

  // ------------------------------------------------------------ fly
  // setFlyInput() gives the wanted direction; update() eases a velocity
  // toward it and moves the camera and the orbit target together, so
  // mouse orbit and wheel zoom still work mid-flight.
  const flyIn = { x: 0, y: 0, z: 0, mult: 1, held: false };
  const vel = new THREE.Vector3();
  let flyLast = -Infinity; // last time keys were held or the rig still glided
  let flySpeed = 0;
  const _fwd = new THREE.Vector3();
  const _side = new THREE.Vector3();
  const _want = new THREE.Vector3();
  const _step = new THREE.Vector3();
  function setFlyInput(inp) {
    const first = inp.held && !flyIn.held;
    Object.assign(flyIn, inp);
    if (first) cancelFlight(); // a framing flight in progress gives way
    if (inp.held) flyLast = performance.now();
  }
  const flyEngaged = (now) => flyIn.held || now - flyLast < FLY.resumeMs;
  // outward velocity fades to zero across `m` past [lo, hi]
  function wall(p, v, lo, hi, m) {
    if (p > hi && v > 0) return v * Math.max(0, 1 - (p - hi) / m);
    if (p < lo && v < 0) return v * Math.max(0, 1 - (lo - p) / m);
    return v;
  }
  function updateFly(dt, now) {
    if (!flyIn.held && vel.lengthSq() < 0.01) {
      vel.set(0, 0, 0);
      flySpeed = 0;
      return;
    }
    flyLast = now;
    const cam = camera.position;
    const tgt = controls.target;
    const ground = heightAt(cam.x, cam.z);
    const base = THREE.MathUtils.clamp(FLY.perHeight * Math.max(0, cam.y - ground), FLY.min, FLY.max);
    const speed = base * flyIn.mult; // the multiplier after the clamp
    // heading: camera to target on the ground plane; straight down: screen up
    _fwd.subVectors(tgt, cam).setY(0);
    if (_fwd.lengthSq() < 1e-6) _fwd.setFromMatrixColumn(camera.matrixWorld, 1).setY(0);
    _fwd.normalize();
    _side.set(-_fwd.z, 0, _fwd.x); // right = forward x up
    const n = Math.hypot(flyIn.x, flyIn.z);
    const s = n > 1 ? 1 / n : 1; // a diagonal is no faster
    _want.set(0, 0, 0)
      .addScaledVector(_fwd, flyIn.z * s * speed)
      .addScaledVector(_side, flyIn.x * s * speed);
    _want.y = flyIn.y * speed * FLY.vertical;
    if (reducedMotion) vel.copy(_want);
    else {
      const tau = (flyIn.held ? FLY.easeIn : FLY.easeOut) / 3;
      vel.lerp(_want, 1 - Math.exp(-dt / tau));
    }
    // the soft wall reads the camera only: the target may sit far ahead
    // (2.6 km from the overview) and would stop the camera outside the map;
    // clampPose() keeps the target inside MAP_LIMIT
    if (bounds) {
      vel.x = wall(cam.x, vel.x, bounds.x0, bounds.x1, FLY.margin);
      vel.z = wall(cam.z, vel.z, bounds.zN, bounds.zS, FLY.margin);
    }
    vel.y = wall(cam.y, vel.y, -Infinity, FLY.ceiling - FLY.margin, FLY.margin);
    _step.copy(vel).multiplyScalar(dt);
    // never below the orbit floor: descent stops there, for both points
    const floor = heightAt(cam.x + _step.x, cam.z + _step.z) + GROUND_CLEARANCE;
    if (cam.y + _step.y < floor && _step.y < 0) {
      _step.y = Math.min(0, floor - cam.y);
      vel.y = 0;
    }
    cam.add(_step);
    tgt.add(_step);
    // A target under the ground slides back along the view ray to where the
    // ray meets the ground: the pitch holds, so the camera can come down to
    // the floor. (Lifting the target instead tips the view up to the polar
    // limit, and OrbitControls then holds the camera ~110 m up.)
    const tg = heightAt(tgt.x, tgt.z);
    if (tgt.y < tg) {
      _o.subVectors(tgt, cam);
      const len = _o.length();
      if (_o.y < -1e-3 && tg < cam.y) {
        const r = Math.max(controls.minDistance + 0.5, Math.min(len, ((tg - cam.y) / _o.y) * len));
        tgt.copy(cam).addScaledVector(_o, r / len);
      }
      const tg2 = heightAt(tgt.x, tgt.z);
      if (tgt.y < tg2) tgt.y = tg2;
    }
    // A target past the soft wall slides back along the same ray to the
    // wall, so the heading holds (an axis clamp would swing the view).
    if (bounds) {
      const m = FLY.margin;
      const lo = [bounds.x0 - m, bounds.zN - m];
      const hi = [bounds.x1 + m, bounds.zS + m];
      const inside = (x, z) => x >= lo[0] && x <= hi[0] && z >= lo[1] && z <= hi[1];
      if (!inside(tgt.x, tgt.z) && inside(cam.x, cam.z)) {
        _o.subVectors(tgt, cam);
        let k = 1;
        if (_o.x > 0) k = Math.min(k, (hi[0] - cam.x) / _o.x);
        if (_o.x < 0) k = Math.min(k, (lo[0] - cam.x) / _o.x);
        if (_o.z > 0) k = Math.min(k, (hi[1] - cam.z) / _o.z);
        if (_o.z < 0) k = Math.min(k, (lo[1] - cam.z) / _o.z);
        const len = _o.length();
        k = Math.max(k, Math.min(1, (controls.minDistance + 0.5) / len));
        tgt.copy(cam).addScaledVector(_o, k);
      }
    }
    flySpeed = vel.length();
  }

  // Mouse look while flying: right drag (or Ctrl + left drag) turns the
  // view around the camera. The target swings on a sphere of the current
  // distance; OrbitControls then sees an ordinary target.
  let look = null;
  const _o = new THREE.Vector3();
  const _sph = new THREE.Spherical();
  dom.addEventListener(
    'pointerdown',
    (e) => {
      const want = e.pointerType !== 'touch' && flyEngaged(performance.now()) && !tour && (e.button === 2 || (e.button === 0 && e.ctrlKey));
      // OrbitControls reads enablePan in its own pointerdown (later, bubble
      // phase): both of these buttons pan, so switching pan off leaves it idle
      controls.enablePan = !want;
      if (!want) return;
      cancelFlight();
      look = { id: e.pointerId, x: e.clientX, y: e.clientY };
      interacting = true;
    },
    { capture: true },
  );
  dom.addEventListener('pointermove', (e) => {
    if (!look || e.pointerId !== look.id) return;
    const dx = e.clientX - look.x;
    const dy = e.clientY - look.y;
    look.x = e.clientX;
    look.y = e.clientY;
    _o.subVectors(camera.position, controls.target); // target -> camera
    _sph.setFromVector3(_o);
    _sph.theta -= dx * FLY.look;
    _sph.phi = THREE.MathUtils.clamp(_sph.phi - dy * FLY.look, controls.minPolarAngle + 0.01, controls.maxPolarAngle - 0.01);
    _o.setFromSpherical(_sph);
    controls.target.subVectors(camera.position, _o);
    lastInput = performance.now();
  });
  const endLook = (e) => {
    if (!look || (e && e.pointerId !== look.id)) return;
    look = null;
    interacting = false;
    controls.enablePan = true;
    lastInput = performance.now();
  };
  window.addEventListener('pointerup', endLook);
  window.addEventListener('pointercancel', endLook);

  // ------------------------------------------------------------ tour
  // A driver (routes.js createFlyAlong) gives the wanted pose; the rig eases
  // in from the current pose, then follows it with light damping. Any
  // pointer or wheel input on the canvas cancels the tour.
  let tour = null;
  const _tp = new THREE.Vector3();
  const _tl = new THREE.Vector3();
  function drive(driver) {
    cancelFlight();
    vel.set(0, 0, 0);
    camera.position.sub(offset);
    offset.set(0, 0, 0);
    smooth.set(0, 0);
    tour = {
      driver,
      intro: 0,
      // drivers may set their own ease-in (cinema, story); snap: none
      introDur: driver.snap ? 0 : driver.introDur ?? 1.6,
      fromPos: camera.position.clone(),
      fromLook: controls.target.clone(),
      look: controls.target.clone(),
    };
    controls.enabled = false;
  }
  function stopDrive() {
    if (!tour) return false;
    controls.target.copy(tour.look);
    tour = null;
    controls.enabled = true;
    controls.update();
    lastInput = performance.now();
    return true;
  }
  const cancelByUser = () => {
    if (tour && stopDrive()) onTourCancel?.();
  };
  dom.addEventListener('pointerdown', cancelByUser);
  dom.addEventListener('wheel', cancelByUser, { passive: true });

  function updateTour(rawDt) {
    // wall-clock time, so a slow device keeps the pace (damping below is
    // exponential and stays stable for large steps)
    const dt = Math.min(rawDt, 1);
    const d = tour.driver;
    if (tour.intro < 1 && tour.introDur > 0) {
      tour.intro = Math.min(1, tour.intro + dt / tour.introDur);
      const k = easeInOutCubic(tour.intro);
      const p = d.pose();
      camera.position.lerpVectors(tour.fromPos, p.pos, k);
      tour.look.lerpVectors(tour.fromLook, p.look, k);
    } else {
      d.advance(dt);
      const p = d.pose();
      if (d.snap || p.cut) {
        // p.cut: the driver asks for a hard cut (seek, reduced motion)
        camera.position.copy(p.pos);
        tour.look.copy(p.look);
      } else {
        const a = 1 - Math.exp(-dt / (d.damp ?? 0.45));
        _tp.copy(p.pos);
        _tl.copy(p.look);
        camera.position.lerp(_tp, a);
        tour.look.lerp(_tl, a);
      }
    }
    // route fly-along: 120 m over the ground; cinema and story shots fly
    // lower and keep their own clearance (driver.floor, world units)
    const floor = heightAt(camera.position.x, camera.position.z) + (d.floor ?? 30);
    if (camera.position.y < floor) camera.position.y = floor;
    controls.target.copy(tour.look);
    camera.lookAt(tour.look);
    if (d.done) stopDrive();
  }

  // Fit a world box (a route) in view, seen from the south-south-east.
  // `view` is the free part of the screen in CSS px, {left, right, top,
  // bottom}; the box is centred in it, not in the whole canvas.
  function fitBox(box, view) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const v = { left: 0, right: W, top: 0, bottom: H, ...view };
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const aspect = camera.aspect || W / H;
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const polar = 0.72; // from vertical
    const az = 0.25;
    const dir = new THREE.Vector3().setFromSphericalCoords(1, polar, az); // target -> camera
    _right.set(dir.z, 0, -dir.x).normalize();
    const fwd = new THREE.Vector3(-dir.x, 0, -dir.z).normalize();
    // box extent across and along the view, the latter foreshortened
    const across = Math.abs(size.x * _right.x) + Math.abs(size.z * _right.z) + 40;
    const along = (Math.abs(size.x * fwd.x) + Math.abs(size.z * fwd.z)) * Math.cos(polar) + 40;
    const fw = Math.max(0.2, (v.right - v.left) / W);
    const fh = Math.max(0.2, (v.bottom - v.top) / H);
    // 1.2: margin so edge stops and their badges stay inside the free area
    const dist = THREE.MathUtils.clamp(Math.max(across / (2 * tanV * aspect * fw), along / (2 * tanV * fh)) * 1.2, 80, 5000);
    // move the target so the box centre lands in the middle of the free area
    const offX = ((v.left + v.right) / 2 - W / 2) / W; // fraction of the width
    const offY = ((v.top + v.bottom) / 2 - H / 2) / H;
    const tgt = c.clone();
    tgt.y = heightAt(c.x, c.z);
    tgt.addScaledVector(_right, -offX * 2 * dist * tanV * aspect);
    tgt.addScaledVector(fwd, (offY * 2 * dist * tanV) / Math.cos(polar));
    const pos = tgt.clone().addScaledVector(dir, dist);
    pos.y = Math.max(pos.y, heightAt(pos.x, pos.z) + 30);
    flyTo(pos, tgt, 1.4);
  }

  // orbit (radians, optional): the signature move on select. The camera
  // also swings this far around the target and settles on the framing as
  // it lands. Off under reduced motion.
  function flyTo(toPos, toTarget, duration, { orbit = 0 } = {}) {
    tour = null;
    vel.set(0, 0, 0); // a framing flight ends any keyboard glide
    // A new request replaces any flight in progress, starting from the
    // current pose (parallax removed first).
    camera.position.sub(offset);
    offset.set(0, 0, 0);
    smooth.set(0, 0);
    flight = {
      fromPos: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toPos: toPos.clone(),
      toTarget: toTarget.clone(),
      t: 0,
      duration: reducedMotion ? Math.min(duration, 0.4) : duration,
      orbit: reducedMotion ? 0 : orbit,
    };
    controls.enabled = false;
    onFlightStart?.(toTarget, duration);
  }
  const _arm = new THREE.Vector3();
  const _dest = new THREE.Vector3();
  const _Y = new THREE.Vector3(0, 1, 0);

  // Framed view of a landmark: keep the current bearing, look slightly down,
  // and shift the target right a little: the subject sits in the gap
  // between the list (left) and the detail panel (right).
  const _dir = new THREE.Vector3();
  const _right = new THREE.Vector3();
  // box: the landmark's real world bounding box. The distance fits its
  // bounding sphere in the view, so a 12 m arch and a 240 m stadium both
  // fill it; the orbit floor drops for subjects smaller than MIN_DISTANCE.
  // bearing (optional, radians): the landmark's best viewing direction
  // (world xz from the subject to the camera = (sin b, cos b)). When the
  // current bearing is more than ~65 degrees off it, swing toward it.
  // focus (optional): { x, y, fill } in CSS px, where the subject should
  // land on screen (the callout card takes the rest), and the share of the
  // view height it may fill (1 = the whole height). orbit: see flyTo.
  function frame(box, { panelOpen = true, bearing = null, base = null, focus = null, orbit = 0 } = {}) {
    const size = box.getSize(new THREE.Vector3());
    const r = 0.5 * size.length();
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    // sphere in the vertical field; the free gap between panels is narrower
    // than the canvas on desktop, so keep a margin
    const room = focus ? 1.15 / THREE.MathUtils.clamp(focus.fill ?? 1, 0.3, 1) : panelOpen && window.innerWidth > 900 ? 1.35 : 1.15;
    const dist = THREE.MathUtils.clamp((r / tanV) * room, 12, 1200);
    controls.minDistance = Math.min(MIN_DISTANCE, dist * 0.55);
    const center = box.getCenter(new THREE.Vector3());
    const ground = base ?? box.min.y;
    center.y = ground + (box.max.y - ground) * 0.35;
    const height = box.max.y - ground;
    _dir.subVectors(camera.position, center).setY(0);
    if (_dir.lengthSq() < 1) _dir.set(0, 0, 1);
    _dir.normalize();
    if (bearing != null) {
      const px = Math.sin(bearing);
      const pz = Math.cos(bearing);
      if (_dir.x * px + _dir.z * pz < 0.42) _dir.set(px + _dir.x * 0.3, 0, pz + _dir.z * 0.3).normalize();
    }
    // radians above horizontal; small subjects in narrow streets get a
    // steeper view, over the roofs of their real neighbours
    const elev = 0.5 + 0.3 * (1 - THREE.MathUtils.smoothstep(r, 3, 15));
    const tgt = center.clone().setY(center.y + height * 0.05);
    _right.set(_dir.z, 0, -_dir.x); // camera right = forward(-_dir) x up
    if (focus) {
      // as fitBox: move the target so the subject lands on focus.x / focus.y
      const W = window.innerWidth;
      const H = window.innerHeight;
      const aspect = camera.aspect || W / H;
      const offX = (focus.x - W / 2) / W;
      const offY = (focus.y - H / 2) / H;
      tgt.addScaledVector(_right, -offX * 2 * dist * tanV * aspect);
      // along the ground, toward the view: foreshortened by the elevation
      tgt.addScaledVector(_dir, (-offY * 2 * dist * tanV) / Math.max(0.35, Math.sin(elev)));
    } else {
      const shift = panelOpen && window.innerWidth > 900 ? dist * 0.06 : 0;
      tgt.addScaledVector(_right, shift);
    }
    const pos = tgt.clone()
      .addScaledVector(_dir, Math.cos(elev) * dist)
      .add(new THREE.Vector3(0, Math.sin(elev) * dist, 0));
    pos.y = Math.max(pos.y, heightAt(pos.x, pos.z) + GROUND_CLEARANCE * 2);
    flyTo(pos, tgt, orbit && !reducedMotion ? 1.7 : 1.2, { orbit });
  }

  function clampPose() {
    const t = controls.target;
    t.x = THREE.MathUtils.clamp(t.x, -MAP_LIMIT, MAP_LIMIT);
    t.z = THREE.MathUtils.clamp(t.z, -MAP_LIMIT, MAP_LIMIT);
    t.y = THREE.MathUtils.clamp(t.y, heightAt(t.x, t.z), 200);
    const floor = heightAt(camera.position.x, camera.position.z) + GROUND_CLEARANCE;
    if (camera.position.y < floor) camera.position.y = floor;
  }

  const _look = new THREE.Vector3();
  const _up = new THREE.Vector3();
  function update(dt, now, rawDt = dt) {
    camera.position.sub(offset);

    if (tour) {
      offset.set(0, 0, 0);
      updateTour(rawDt);
      return;
    }

    if (flight) {
      // wall-clock progress, so a slow device still lands on time
      flight.t = Math.min(1, flight.t + Math.min(rawDt, 0.25) / flight.duration);
      const k = easeInOutCubic(flight.t);
      if (flight.orbit) {
        // the destination turns about the landing target; the swing left
        // fades with a smoothstep that lags the move, so the last part of
        // the flight reads as a slow orbit settling on the framing
        const s = THREE.MathUtils.smoothstep(flight.t, 0.12, 1);
        _arm.subVectors(flight.toPos, flight.toTarget).applyAxisAngle(_Y, flight.orbit * (1 - s));
        _dest.addVectors(flight.toTarget, _arm);
        camera.position.lerpVectors(flight.fromPos, _dest, k);
      } else {
        camera.position.lerpVectors(flight.fromPos, flight.toPos, k);
      }
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, k);
      // lift the path a little mid-flight so it arcs over rooftops
      camera.position.y += Math.sin(Math.PI * k) * flight.fromPos.distanceTo(flight.toPos) * 0.08;
      clampPose();
      camera.lookAt(controls.target);
      offset.set(0, 0, 0);
      if (flight.t >= 1) {
        flight = null;
        controls.enabled = true;
        controls.update();
        onFlightEnd?.();
      }
      return;
    }

    // keyboard flight first, so OrbitControls integrates the moved pose;
    // wall-clock step (capped), so slow frames keep the speed
    updateFly(Math.min(rawDt, 0.1), now);
    controls.update();
    clampPose();

    // idle parallax waits 2 s after the fly keys are let go
    const idle = !interacting && now - lastInput > IDLE_MS && !flyEngaged(now);
    const want = idle && finePointer && !reducedMotion ? target : null;
    const alpha = 1 - Math.pow(1 - 0.055, Math.min(dt, 1 / 30) * 60);
    smooth.x += ((want ? want.x : 0) - smooth.x) * alpha;
    smooth.y += ((want ? want.y : 0) - smooth.y) * alpha;

    const dist = camera.position.distanceTo(controls.target);
    _right.setFromMatrixColumn(camera.matrixWorld, 0);
    _up.setFromMatrixColumn(camera.matrixWorld, 1);
    offset.set(0, 0, 0)
      .addScaledVector(_right, -smooth.x * dist * 0.028)
      .addScaledVector(_up, smooth.y * dist * 0.018);
    if (offset.lengthSq() > 1e-6) {
      camera.position.add(offset);
      _look.copy(controls.target).addScaledVector(offset, 0.42);
      camera.lookAt(_look);
    }
  }

  return {
    controls,
    flyTo,
    frame,
    fitBox,
    drive,
    stopDrive,
    update,
    setFlyInput,
    cancelFlight,
    flyBounds: bounds,
    // tests and debugging: the keyboard flight right now
    get flyState() {
      const c = camera.position;
      return { held: flyIn.held, mult: flyIn.mult, speed: +flySpeed.toFixed(2), vel: vel.toArray().map((v) => +v.toFixed(2)), height: +(c.y - heightAt(c.x, c.z)).toFixed(2), look: !!look, engaged: flyEngaged(performance.now()) };
    },
    get flying() {
      return !!flight;
    },
    get touring() {
      return !!tour;
    },
  };
}
