import { t, language, locale } from './i18n.js';
// Routes on the map: draped Line2 legs in the route colour, a soft additive
// glow under each, numbered stop badges, and the fly-along driver.
//
// Line style by mode: foot solid, bus/taxi dashed, funicular dotted.
// Geometry follows the terrain: every leg is subdivided to MAX_SEG world
// units and lifted LIFT units above heightAt().
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { S } from './geo.js';

const LIFT = 1; // world units (4 m) above the terrain
const MAX_SEG = 6;
export const BIRD_M = 120; // fly-along camera height above the ground, metres

export const MODE_RU = { foot: t('пешком'), bus: t('автобус'), taxi: t('такси'), funicular: t('фуникулёр') };
// stroke patterns shared by the map lines (world units) and the SVG swatches (px)
export const MODE_STYLE = {
  foot: { width: 4.5, dash: null, svg: '' },
  bus: { width: 4.5, dash: [14, 9], svg: '6 4' },
  taxi: { width: 4.5, dash: [14, 9], svg: '6 4' },
  funicular: { width: 5.5, dash: [1.6, 6], svg: '0.1 4.5' },
};

// Group legs under the stop pair they connect. Legs between the same pair
// keep their order (bus, then funicular). A leg that matches no consecutive
// pair goes after the stop it starts from; after the last stop it is a tail.
export function planRoute(route) {
  const ids = route.stops.map((s) => s.landmark_id);
  const hops = ids.slice(0, -1).map(() => []);
  const tail = [];
  for (const leg of route.legs) {
    let k = -1;
    for (let i = 0; i < hops.length; i++) {
      if (ids[i] === leg.from && ids[i + 1] === leg.to) {
        k = i;
        break;
      }
    }
    if (k < 0) {
      const from = ids.lastIndexOf(leg.from);
      if (from >= 0 && from < hops.length) k = from;
    }
    if (k >= 0) hops[k].push(leg);
    else tail.push(leg);
  }
  return { ids, hops, tail };
}

// Draped world polyline for one leg: Float32 xyz and cumulative XZ length.
function drape(pts, project, heightAt) {
  const out = [];
  let prev = null;
  for (const p of pts) {
    const cur = project(p[0], p[1]);
    if (!prev) out.push(cur.x, heightAt(cur.x, cur.z) + LIFT, cur.z);
    else {
      const dx = cur.x - prev.x;
      const dz = cur.z - prev.z;
      const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / MAX_SEG));
      for (let i = 1; i <= n; i++) {
        const x = prev.x + (dx * i) / n;
        const z = prev.z + (dz * i) / n;
        out.push(x, heightAt(x, z) + LIFT, z);
      }
    }
    prev = cur;
  }
  return out;
}

export function createRouteLayer({ project, heightAt, landmarks, items }) {
  const group = new THREE.Group();
  group.name = 'route';
  group.renderOrder = 20;
  const materials = [];
  const res = new THREE.Vector2(1, 1);
  const indexById = new Map(landmarks.map((l, i) => [l.id, i]));
  let badges = [];
  let current = null;

  function groundAt(id) {
    const i = indexById.get(id);
    const it = items?.[i];
    const p = it && Number.isFinite(it.x) ? { x: it.x, z: it.z } : project(landmarks[i].lat, landmarks[i].lon);
    return new THREE.Vector3(p.x, heightAt(p.x, p.z) + LIFT, p.z);
  }

  // With post-processing the route glows: colours go into linear HDR above
  // the bloom threshold (the additive halo most, the core a little).
  let bloom = false;
  function material(color, opts) {
    const m = new LineMaterial({ color, transparent: true, depthWrite: false, ...opts });
    m.toneMapped = false;
    m.fog = true;
    m.resolution.copy(res);
    m.userData.base = m.color.clone();
    // the additive halo stays as is: bloom already widens it
    m.userData.k = opts.blending === THREE.AdditiveBlending ? 0.8 : 1.25;
    if (bloom) m.color.copy(m.userData.base).multiplyScalar(m.userData.k);
    materials.push(m);
    return m;
  }
  function setBloom(on) {
    bloom = !!on;
    for (const m of materials) m.color.copy(m.userData.base).multiplyScalar(bloom ? m.userData.k : 1);
  }

  function clear() {
    for (const b of badges) b.obj.removeFromParent();
    badges = [];
    for (const c of [...group.children]) {
      c.geometry?.dispose();
      group.remove(c);
    }
    for (const m of materials) m.dispose();
    materials.length = 0;
    current = null;
  }

  // Build the route and return its fly path and bounds.
  function show(route) {
    clear();
    const plan = planRoute(route);
    const color = new THREE.Color(route.color);
    const core = color.clone().lerp(new THREE.Color(0xffffff), 0.25);
    const path = { xyz: [], stopS: [], stopPos: [] };
    const box = new THREE.Box3();
    let cum = 0;
    let lastPt = null;

    const addToPath = (arr) => {
      for (let i = 0; i < arr.length; i += 3) {
        const p = new THREE.Vector3(arr[i], arr[i + 1], arr[i + 2]);
        if (lastPt) {
          const d = Math.hypot(p.x - lastPt.x, p.z - lastPt.z);
          if (d < 0.01) continue;
          cum += d;
        }
        path.xyz.push({ p, s: cum });
        box.expandByPoint(p);
        lastPt = p;
      }
    };

    const drawLeg = (leg) => {
      const arr = drape(leg.pts, project, heightAt);
      if (arr.length < 6) return arr;
      const st = MODE_STYLE[leg.mode] || MODE_STYLE.foot;
      const geo = new LineGeometry();
      geo.setPositions(arr);
      // glow and a faint "x-ray" core ignore depth, so the route still reads
      // where buildings stand in front of it; the full core is depth-tested
      const glow = new Line2(geo, material(color, { linewidth: st.width * 3.2, opacity: 0.2, blending: THREE.AdditiveBlending, depthTest: false }));
      glow.renderOrder = 20;
      glow.frustumCulled = false;
      const xray = new Line2(
        geo,
        material(core, { linewidth: st.width * 0.8, opacity: 0.38, depthTest: false, dashed: !!st.dash, dashSize: st.dash?.[0] ?? 1, gapSize: st.dash?.[1] ?? 1 }),
      );
      if (st.dash) xray.computeLineDistances();
      xray.renderOrder = 20;
      xray.frustumCulled = false;
      group.add(xray);
      const line = new Line2(
        geo,
        material(core, { linewidth: st.width, opacity: 0.98, dashed: !!st.dash, dashSize: st.dash?.[0] ?? 1, gapSize: st.dash?.[1] ?? 1 }),
      );
      if (st.dash) line.computeLineDistances();
      line.renderOrder = 21;
      line.frustumCulled = false;
      line.userData.mode = leg.mode;
      group.add(glow, line);
      return arr;
    };

    path.stopS.push(0);
    path.stopPos.push(groundAt(plan.ids[0]));
    addToPath([path.stopPos[0].x, path.stopPos[0].y, path.stopPos[0].z]);
    plan.hops.forEach((legs, k) => {
      if (!legs.length) {
        // no leg data for this hop: a straight foot line between the stops
        const a = landmarks[indexById.get(plan.ids[k])];
        const b = landmarks[indexById.get(plan.ids[k + 1])];
        legs = [{ mode: 'foot', pts: [[a.lat, a.lon], [b.lat, b.lon]], synthetic: true }];
        plan.hops[k] = legs;
      }
      for (const leg of legs) addToPath(drawLeg(leg));
      const end = groundAt(plan.ids[k + 1]);
      addToPath([end.x, end.y, end.z]);
      path.stopS.push(cum);
      path.stopPos.push(end);
    });
    for (const leg of plan.tail) addToPath(drawLeg(leg));
    path.total = cum;

    // numbered badges, drawn through the shared CSS2DRenderer
    route.stops.forEach((s, k) => {
      const el = document.createElement('span');
      el.className = 'route-badge';
      el.style.setProperty('--c', route.color);
      const disc = document.createElement('span');
      disc.textContent = String(k + 1);
      el.append(disc);
      const obj = new CSS2DObject(el);
      obj.position.copy(path.stopPos[k]);
      obj.center.set(0.5, 0.5);
      group.add(obj);
      badges.push({ obj, el });
    });

    for (const p of path.stopPos) box.expandByPoint(p);
    current = { route, plan, path, box };
    return current;
  }

  function pulse(k) {
    badges.forEach((b, i) => b.el.classList.toggle('is-pulse', i === k));
  }

  function setResolution(w, h) {
    res.set(w, h);
    for (const m of materials) m.resolution.set(w, h);
  }

  return {
    group,
    show,
    clear,
    pulse,
    setResolution,
    setBloom,
    get current() {
      return current;
    },
  };
}

// ------------------------------------------------------------ fly-along
// Samples the concatenated path at constant ground speed. pose() gives the
// camera position behind and above the path point, looking ahead along it.
// It stops PAUSE seconds at every stop and calls onStop(k).
const PAUSE = 2;

// `lateral` shifts the view sideways (in units of `back`) so the path sits
// left of centre when a panel covers the right side of the screen.
export function createFlyAlong(path, { reducedMotion, onStop, onEnd, lateral = 0, heightAt = null }) {
  const pts = path.xyz;
  const total = Math.max(path.total, 1);
  // about 40 s of travel for any route, whatever its length
  const speed = THREE.MathUtils.clamp(total / 40, 15, 200); // world units / s
  // a bird's chase view at real scale: ~120 m above the ground, ~260 m
  // behind the point on the path, looking ahead along it
  const height = BIRD_M * S;
  const back = 260 * S;
  const ahead = back * 0.55;
  const _r = new THREE.Vector3();

  let s = 0;
  let stop = 0; // next stop to pause at
  let pause = 0;
  let done = false;

  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();

  function at(d, out) {
    d = THREE.MathUtils.clamp(d, 0, path.total);
    // binary search for the last point with s <= d
    let lo = 0;
    let hi = pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pts[mid].s <= d) lo = mid;
      else hi = mid - 1;
    }
    const i = lo;
    const a = pts[i];
    const b = pts[Math.min(i + 1, pts.length - 1)];
    const k = b.s > a.s ? (d - a.s) / (b.s - a.s) : 0;
    return out.lerpVectors(a.p, b.p, THREE.MathUtils.clamp(k, 0, 1));
  }

  function computePose(d) {
    at(d, _p);
    at(d + ahead, _b);
    at(d - ahead * 0.5, _a);
    _dir.subVectors(_b, _a).setY(0);
    if (_dir.lengthSq() < 1e-4) _dir.set(0, 0, -1);
    _dir.normalize();
    pos.copy(_p).addScaledVector(_dir, -back);
    // above the ground under the camera, not only above the path point
    const under = heightAt ? heightAt(pos.x, pos.z) : pos.y;
    pos.y = Math.max(_p.y, under) + height;
    look.copy(_b).setY(_b.y * 0.6 + _p.y * 0.4);
    if (lateral) {
      _r.set(-_dir.z, 0, _dir.x); // camera right for forward _dir
      pos.addScaledVector(_r, back * lateral);
      look.addScaledVector(_r, back * lateral);
    }
  }

  function arrive(k) {
    pause = PAUSE;
    onStop?.(k);
  }

  function advance(dt) {
    if (done) return;
    if (pause > 0) {
      pause -= dt;
      if (pause > 0) return;
      stop++;
      if (stop >= path.stopS.length && s >= path.total - 1e-3) {
        done = true;
        onEnd?.();
        return;
      }
    }
    if (reducedMotion) {
      // cut from stop to stop, no travel animation
      if (stop < path.stopS.length) {
        s = path.stopS[stop];
        arrive(stop);
      } else {
        done = true;
        onEnd?.();
      }
      return;
    }
    const next = stop < path.stopS.length ? path.stopS[stop] : path.total;
    s = Math.min(s + speed * dt, next);
    if (s >= next - 1e-3) {
      if (stop < path.stopS.length) arrive(stop);
      else {
        done = true;
        onEnd?.();
      }
    }
  }

  return {
    advance,
    pose() {
      // under reduced motion s only takes stop values, so this is a still per stop
      computePose(s);
      return { pos, look };
    },
    get progress() {
      return s / total;
    },
    get stopIndex() {
      return pause > 0 ? stop : -1;
    },
    get done() {
      return done;
    },
    snap: !!reducedMotion,
  };
}
