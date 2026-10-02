import { t, language, locale } from './i18n.js';
// Full-screen 360° viewer with its own renderer, scene and camera.
// Opened from the «360°» tab. While it is open the map loop is paused
// (onOpen/onClose hooks). On close every GPU resource is released,
// including the WebGL context, so repeated opens do not leak.
//
// Look model: yaw/pitch angles with velocity. Drag sets velocity, release
// keeps it and it decays (inertia). Idle for a while and the view pans
// slowly, unless reduced motion is on. Wheel / pinch / +- change the FOV
// within 40–100°. On touch devices a «Гироскоп» button asks for motion
// permission and then the phone orientation drives the view.
import * as THREE from 'three';
import { assetUrl } from './data.js';

const FOV_MIN = 40;
const FOV_MAX = 100;
const IDLE_MS = 3500;
const AUTO_SPEED = 0.035; // rad/s
const DEG = Math.PI / 180;

// A 2:1 stand-in: dusk sky, a horizon, and markers every 45° so rotation reads.
function gradientPanorama() {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 1024;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, c.height);
  sky.addColorStop(0, '#1b2233');
  sky.addColorStop(0.38, '#6b5a6e');
  sky.addColorStop(0.5, '#f0b872');
  sky.addColorStop(0.53, '#6a4a30');
  sky.addColorStop(1, '#17110b');
  g.fillStyle = sky;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(30, 20, 12, 0.85)';
  for (let x = 0; x < c.width; x += 8) {
    const h = 30 + 22 * Math.sin(x * 0.006) + 14 * Math.sin(x * 0.021 + 1.7);
    g.fillRect(x, c.height * 0.5 - h, 8, h + 4);
  }
  g.font = '600 44px Georgia, serif';
  g.textAlign = 'center';
  const names = language === 'ru' ? ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'] : language === 'pt' ? ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'] : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  for (let i = 0; i < 8; i++) {
    const x = (i / 8) * c.width + c.width / 16;
    g.fillStyle = 'rgba(251, 243, 228, 0.9)';
    g.fillText(names[i], x, c.height * 0.5 - 90);
    g.fillStyle = 'rgba(251, 243, 228, 0.35)';
    g.fillRect(x - 1, c.height * 0.5 - 70, 2, 40);
  }
  g.fillStyle = 'rgba(251, 243, 228, 0.5)';
  g.font = 'italic 500 30px Georgia, serif';
  g.fillText(t('заглушка панорамы'), c.width / 2, c.height * 0.72);
  return c;
}

export function placeholderPanoramaUrl() {
  const c = gradientPanorama();
  const small = document.createElement('canvas');
  small.width = 640;
  small.height = 320;
  small.getContext('2d').drawImage(c, 0, 0, 640, 320);
  return small.toDataURL('image/jpeg', 0.8);
}

export const panoramaThumbUrl = (p) => (p.src.startsWith('placeholder:') ? placeholderPanoramaUrl() : assetUrl(p.src));

export function createPanorama({ reducedMotion, onOpen, onClose }) {
  const root = document.getElementById('pano');
  const host = root.querySelector('.pano-stage');
  const cap = root.querySelector('.pano-caption');
  const cred = root.querySelector('.pano-credit');
  const status = root.querySelector('.pano-status');
  const gyroBtn = root.querySelector('.pano-gyro');
  const closeBtn = root.querySelector('.pano-close');

  let st = null; // live state while open
  let opener = null;

  const canGyro = typeof DeviceOrientationEvent !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  gyroBtn.hidden = !canGyro;

  function build() {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'pano-canvas';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    host.append(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 1, 1, 1100);
    const geo = new THREE.SphereGeometry(500, 96, 48);
    geo.scale(-1, 1, 1); // look at the inside
    const mat = new THREE.MeshBasicMaterial({ color: 0x1a140e });
    scene.add(new THREE.Mesh(geo, mat));
    return { renderer, scene, camera, geo, mat, tex: null };
  }

  function loadTexture(pano) {
    const tex = pano.src.startsWith('placeholder:')
      ? Promise.resolve(new THREE.CanvasTexture(gradientPanorama()))
      : new THREE.TextureLoader().loadAsync(assetUrl(pano.src));
    return tex.then((t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = st ? st.renderer.capabilities.getMaxAnisotropy() : 1;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      return t;
    });
  }

  // ------------------------------------------------------------ input
  const look = { yaw: 0, pitch: 0, vy: 0, vp: 0, fov: 75, fovTarget: 75 };
  let drag = null;
  let lastInput = 0;
  const pointers = new Map();
  let pinch0 = 0;

  function onDown(e) {
    host.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
      drag = null;
      return;
    }
    drag = { x: e.clientX, y: e.clientY, t: performance.now() };
    look.vy = look.vp = 0;
    lastInput = performance.now();
    host.classList.add('is-drag');
  }
  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastInput = performance.now();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0 > 0) look.fovTarget = THREE.MathUtils.clamp(look.fovTarget * (pinch0 / d), FOV_MIN, FOV_MAX);
      pinch0 = d;
      return;
    }
    if (!drag || !st) return;
    const now = performance.now();
    const dt = Math.max(1, now - drag.t) / 1000;
    // radians per pixel follows the FOV, so the image sticks to the finger
    const k = (look.fov * DEG) / host.clientHeight;
    const dy = (e.clientX - drag.x) * k;
    const dp = (e.clientY - drag.y) * k;
    look.yaw += dy;
    look.pitch += dp;
    look.vy = THREE.MathUtils.lerp(look.vy, dy / dt, 0.5);
    look.vp = THREE.MathUtils.lerp(look.vp, dp / dt, 0.5);
    drag = { x: e.clientX, y: e.clientY, t: now };
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch0 = 0;
    if (!pointers.size) {
      drag = null;
      host.classList.remove('is-drag');
      if (reducedMotion) look.vy = look.vp = 0;
    }
    lastInput = performance.now();
  }
  function onWheel(e) {
    e.preventDefault();
    look.fovTarget = THREE.MathUtils.clamp(look.fovTarget + e.deltaY * 0.05, FOV_MIN, FOV_MAX);
    lastInput = performance.now();
  }
  function onKey(e) {
    const step = 8 * DEG;
    let used = true;
    if (e.key === 'ArrowLeft') look.yaw -= step;
    else if (e.key === 'ArrowRight') look.yaw += step;
    else if (e.key === 'ArrowUp') look.pitch -= step;
    else if (e.key === 'ArrowDown') look.pitch += step;
    else if (e.key === '+' || e.key === '=') look.fovTarget = Math.max(FOV_MIN, look.fovTarget - 8);
    else if (e.key === '-' || e.key === '_') look.fovTarget = Math.min(FOV_MAX, look.fovTarget + 8);
    else used = false;
    if (used) {
      e.preventDefault();
      look.vy = look.vp = 0;
      lastInput = performance.now();
    }
  }

  // ------------------------------------------------------------ gyroscope
  let gyro = null; // latest device orientation, radians
  const onOrient = (e) => {
    if (e.alpha == null) return;
    gyro = { a: e.alpha * DEG, b: e.beta * DEG, g: e.gamma * DEG };
  };
  const zee = new THREE.Vector3(0, 0, 1);
  const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90° about X
  const q0 = new THREE.Quaternion();
  const euler = new THREE.Euler();
  async function toggleGyro() {
    if (gyro !== null || gyroBtn.getAttribute('aria-pressed') === 'true') {
      window.removeEventListener('deviceorientation', onOrient);
      gyro = null;
      gyroBtn.setAttribute('aria-pressed', 'false');
      return;
    }
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') throw new Error(r);
      }
      window.addEventListener('deviceorientation', onOrient);
      gyroBtn.setAttribute('aria-pressed', 'true');
    } catch {
      status.textContent = t('Нет доступа к гироскопу');
    }
  }
  gyroBtn.addEventListener('click', toggleGyro);

  // ------------------------------------------------------------ loop
  let raf = 0;
  let last = 0;
  function resize() {
    if (!st) return;
    const w = host.clientWidth;
    const h = host.clientHeight;
    st.renderer.setSize(w, h, false);
    st.camera.aspect = w / h;
    st.camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (!drag) {
      look.yaw += look.vy * dt;
      look.pitch += look.vp * dt;
      const decay = Math.pow(0.04, dt); // keeps ~4% of the speed after 1 s
      look.vy *= decay;
      look.vp *= decay;
      const idle = now - lastInput > IDLE_MS;
      if (idle && !reducedMotion && !gyro && Math.abs(look.vy) < AUTO_SPEED) look.yaw += AUTO_SPEED * dt;
    }
    look.pitch = THREE.MathUtils.clamp(look.pitch, -85 * DEG, 85 * DEG);
    look.fov += (look.fovTarget - look.fov) * (1 - Math.pow(0.001, dt));
    const cam = st.camera;
    if (Math.abs(cam.fov - look.fov) > 0.01) {
      cam.fov = look.fov;
      cam.updateProjectionMatrix();
    }
    if (gyro) {
      const orient = (screen.orientation?.angle || 0) * DEG;
      euler.set(gyro.b, gyro.a, -gyro.g, 'YXZ');
      cam.quaternion.setFromEuler(euler).multiply(q1).multiply(q0.setFromAxisAngle(zee, -orient));
      // drag still offsets yaw on top of the phone heading
      cam.quaternion.premultiply(q0.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -look.yaw));
    } else {
      cam.rotation.set(-look.pitch, -look.yaw, 0, 'YXZ');
    }
    st.renderer.render(st.scene, cam);
  }

  // ------------------------------------------------------------ open/close
  let token = 0;
  function open(pano, from) {
    if (st) close();
    opener = from || document.activeElement;
    const my = ++token;
    st = build();
    cap.textContent = pano.caption || '';
    const c = pano.credit;
    cred.replaceChildren();
    if (c && (c.author || c.license)) {
      const a = document.createElement(c.source_url ? 'a' : 'span');
      a.textContent = `${t('Панорама')}: ${[c.author, c.license].filter(Boolean).join(', ')}`;
      if (c.source_url) Object.assign(a, { href: c.source_url, target: '_blank', rel: 'noopener noreferrer' });
      cred.append(a);
    }
    status.textContent = t('Загрузка панорамы');
    Object.assign(look, { yaw: 0, pitch: 0, vy: 0, vp: 0, fov: 75, fovTarget: 75 });
    lastInput = performance.now();

    onOpen?.();
    root.showModal();
    ro.observe(host);
    resize();
    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerup', onUp);
    host.addEventListener('pointercancel', onUp);
    host.addEventListener('wheel', onWheel, { passive: false });
    host.addEventListener('keydown', onKey);
    host.focus();
    last = performance.now();
    raf = requestAnimationFrame(frame);

    loadTexture(pano).then(
      (tex) => {
        if (my !== token || !st) return tex.dispose();
        st.tex = tex;
        st.mat.map = tex;
        st.mat.color.set(0xffffff);
        st.mat.needsUpdate = true;
        status.textContent = '';
        root.classList.add('is-ready');
      },
      (err) => {
        if (my !== token) return;
        console.warn('[porto] panorama failed to load', pano.src, err?.message || err);
        status.textContent = t('Панорама не загрузилась');
      },
    );
  }

  function close() {
    if (!st) return;
    token++;
    cancelAnimationFrame(raf);
    raf = 0;
    ro.disconnect();
    host.removeEventListener('pointerdown', onDown);
    host.removeEventListener('pointermove', onMove);
    host.removeEventListener('pointerup', onUp);
    host.removeEventListener('pointercancel', onUp);
    host.removeEventListener('wheel', onWheel);
    host.removeEventListener('keydown', onKey);
    window.removeEventListener('deviceorientation', onOrient);
    gyro = null;
    gyroBtn.setAttribute('aria-pressed', 'false');
    pointers.clear();
    drag = null;
    st.tex?.dispose();
    st.geo.dispose();
    st.mat.dispose();
    st.renderer.dispose();
    st.renderer.forceContextLoss();
    st.renderer.domElement.remove();
    st = null;
    root.classList.remove('is-ready');
    if (root.open) root.close();
    onClose?.();
    opener?.focus?.();
    opener = null;
  }

  closeBtn.addEventListener('click', close);
  // Esc on a modal <dialog> fires "cancel": route it through close()
  root.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });

  return {
    open,
    close,
    isOpen: () => !!st,
    debug: () => (st ? { yaw: look.yaw, fov: look.fov, hasTexture: !!st.tex, texW: st.tex?.image?.width || 0 } : null),
  };
}
