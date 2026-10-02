// Fly mode keys. The motion itself lives in the camera rig (camera.js,
// setFlyInput); this module reads the keyboard and paints the key overlay.
//
//   W / S, ↑ / ↓   forward, back along the camera's heading
//   A / D, ← / →   strafe left, right
//   E, R, Space    up;  Q, F, Shift + Space  down
//   Shift          3x speed;  Alt (Option)  0.3x
//
// Physical keys (e.code), so the Russian and Portuguese layouts work.
// Arrows are fly keys too, with one exception: while a place is open and
// no other fly key is held, ← / → step through the places (main.js).
// main.js calls down() from its key dispatcher, after the dialogs, cinema,
// story and Esc have had their turn; keyup is always read here, so a key
// never sticks.
import { embedded } from './share.js';

// code -> [axis, sign, overlay key]
const MOVE = {
  KeyW: ['z', 1, 'w'],
  ArrowUp: ['z', 1, 'w'],
  KeyS: ['z', -1, 's'],
  ArrowDown: ['z', -1, 's'],
  KeyD: ['x', 1, 'd'],
  ArrowRight: ['x', 1, 'd'],
  KeyA: ['x', -1, 'a'],
  ArrowLeft: ['x', -1, 'a'],
  KeyE: ['y', 1, 'e'],
  KeyR: ['y', 1, 'e'],
  KeyQ: ['y', -1, 'q'],
  KeyF: ['y', -1, 'q'],
  Space: ['y', 0, null], // up; down with Shift
};
const isArrow = (code) => code.startsWith('Arrow');
// focus in these places keeps its keys
const OWN_KEYS = 'input, select, textarea, [contenteditable=""], [contenteditable="true"], dialog, .tools-sheet.is-open, .share-pop, [popover], .legend';
const HIDE_MS = 4000;

export function createFlyKeys({ rig, isBlocked = () => false, placeOpen = () => false, debug = null }) {
  const overlay = document.getElementById('fly-keys');
  const showKeys = new URLSearchParams(location.search).get('keys') !== '0';
  if (overlay && !showKeys) overlay.hidden = true;
  const enabled = !embedded;
  const held = new Set();
  let shift = false;
  let alt = false;
  let hideTimer = 0;
  const caps = overlay ? [...overlay.querySelectorAll('[data-k]')] : [];

  const has = (...codes) => codes.some((c) => held.has(c));
  const flyHeld = () => [...held].some((c) => !isArrow(c));

  function axes() {
    const z = +has('KeyW', 'ArrowUp') - +has('KeyS', 'ArrowDown');
    const x = +has('KeyD', 'ArrowRight') - +has('KeyA', 'ArrowLeft');
    let y = +has('KeyE', 'KeyR') - +has('KeyQ', 'KeyF');
    if (held.has('Space')) y += shift ? -1 : 1;
    y = Math.max(-1, Math.min(1, y));
    return { x, y, z, mult: (shift ? 3 : 1) * (alt ? 0.3 : 1), held: held.size > 0 };
  }

  function lit(k) {
    if (k === 'shift') return shift;
    if (k === 'alt') return alt;
    for (const c of held) {
      const m = MOVE[c];
      if (m[2] === k) return true;
      if (c === 'Space' && k === (shift ? 'q' : 'e')) return true;
    }
    return false;
  }

  function push() {
    rig.setFlyInput(axes());
    if (debug) debug.flyKeys = [...held];
    if (!overlay || !showKeys) return;
    for (const el of caps) el.classList.toggle('is-on', lit(el.dataset.k));
    if (held.size) {
      clearTimeout(hideTimer);
      hideTimer = 0;
      overlay.classList.add('is-shown');
    } else if (overlay.classList.contains('is-shown') && !hideTimer) {
      hideTimer = setTimeout(() => {
        hideTimer = 0;
        overlay.classList.remove('is-shown');
      }, HIDE_MS);
    }
  }

  function reset() {
    shift = false;
    alt = false;
    if (!held.size) return;
    held.clear();
    push();
  }

  // Returns true when the key was taken for flight.
  function down(e) {
    if (!enabled) return false;
    const modsChanged = shift !== e.shiftKey || alt !== e.altKey;
    shift = e.shiftKey;
    alt = e.altKey;
    // macOS drops the keyup of any key released while Cmd is down
    if (e.code === 'MetaLeft' || e.code === 'MetaRight') {
      reset();
      return false;
    }
    const m = MOVE[e.code];
    if (!m) {
      if (modsChanged && held.size) {
        if (e.code.startsWith('Alt')) e.preventDefault(); // no menu bar focus mid-flight
        push();
      }
      return false;
    }
    if (e.ctrlKey || e.metaKey) return false; // browser shortcuts pass
    if (isBlocked()) return false;
    const t = e.target;
    if (t instanceof Element) {
      if (t.closest(OWN_KEYS)) return false;
      if (isArrow(e.code) && t.closest('[role="tablist"]')) return false;
      if (e.code === 'Space' && t.closest('button, a[href], summary, [role="button"], [role="tab"]')) return false;
    }
    // a place is open: ← / → keep stepping through places unless flying
    if (isArrow(e.code) && !held.has(e.code) && placeOpen() && !flyHeld()) return false;
    e.preventDefault();
    if (e.repeat && held.has(e.code)) return true;
    held.add(e.code);
    push();
    return true;
  }

  function up(e) {
    const modsChanged = shift !== e.shiftKey || alt !== e.altKey;
    shift = e.shiftKey;
    alt = e.altKey;
    if (held.delete(e.code)) {
      e.preventDefault();
      push();
    } else if (modsChanged && held.size) {
      if (e.code.startsWith('Alt')) e.preventDefault();
      push();
    } else if (modsChanged && overlay?.classList.contains('is-shown')) {
      for (const el of caps) el.classList.toggle('is-on', lit(el.dataset.k));
    }
  }

  if (enabled) {
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', () => document.hidden && reset());
  }

  return {
    down,
    reset,
    get held() {
      return held.size > 0;
    },
    enabled,
  };
}
