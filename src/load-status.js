// What is loading right now, as one honest line (the status pill,
// layers-ui.js). No DOM here: scripts/layers.test.mjs runs it in Node.
// Same as lisboa-3d's.
//
// createWave(): the tile requests of one camera move. A wave starts with the
// first request after a quiet moment and ends when every request it sent
// has come back (shown, failed or superseded). tiles.js and buildings-ms.js
// each keep one.
//
// summarize(entries, { now, t }): picks what to say. Entries:
//   { id, kind: 'area', active, done, total, failed, stuck, endedAt }
//   { id, kind: 'layer', label, active, done, total, error, endedAt }
// `stuck` is the number of tiles that gave up (a retry can bring them back).

export const DONE_SHOW_MS = 2500; // "loaded" stays this long, then the pill hides

export function createWave() {
  const w = { active: false, done: 0, total: 0, failed: 0, startedAt: 0, endedAt: 0 };
  const close = (now) => {
    if (w.active && w.done + w.failed >= w.total) {
      w.active = false;
      w.endedAt = now ?? Date.now();
    }
  };
  return {
    send(now) {
      if (!w.active) {
        w.active = true;
        w.done = 0;
        w.total = 0;
        w.failed = 0;
        w.startedAt = now ?? Date.now();
      }
      w.total++;
    },
    // 'ok' | 'error' | 'cancel' (superseded: leaves the wave uncounted)
    finish(how, now) {
      if (!w.active) return;
      if (how === 'cancel') w.total = Math.max(0, w.total - 1);
      else if (how === 'error') w.failed++;
      else w.done++;
      close(now);
    },
    snapshot() {
      return { ...w, done: w.done + w.failed };
    },
  };
}

export function summarize(entries, { now = Date.now(), t = (s) => s } = {}) {
  const line = (e) => {
    if (e.kind === 'area') return `${t('Загружаем этот район…')} ${e.done} ${t('из')} ${e.total}`;
    const name = t(e.label || e.id);
    return e.total > 0 ? `${t('Загружаем')} ${name}… ${e.done} ${t('из')} ${e.total}` : `${t('Загружаем')} ${name}…`;
  };
  const loading = entries.filter((e) => e.active);
  if (loading.length) {
    const first = loading[0];
    const more = loading.length > 1 ? ` · +${loading.length - 1}` : '';
    // say: what a screen reader hears once, without the running count
    const say = first.kind === 'area' ? t('Загружаем этот район…') : `${t('Загружаем')} ${t(first.label || first.id)}…`;
    return { state: 'loading', text: line(first) + more, say, id: first.id, done: first.done || 0, total: first.total || 0 };
  }
  const stuck = entries.find((e) => (e.kind === 'area' && e.stuck > 0) || (e.kind === 'layer' && e.error));
  if (stuck) {
    const text = stuck.kind === 'area'
      ? `${t('Не загрузились участки карты:')} ${stuck.stuck}`
      : `${t(stuck.label || stuck.id)}: ${t('не загрузилось')}`;
    return { state: 'failed', text, id: stuck.id, retry: stuck.id };
  }
  const recent = entries.filter((e) => e.endedAt && now - e.endedAt < DONE_SHOW_MS).sort((a, b) => b.endedAt - a.endedAt)[0];
  if (recent) {
    const text = recent.kind === 'area' ? t('Район загружен') : `${t(recent.label || recent.id)}: ${t('загружено')}`;
    return { state: 'done', text, id: recent.id };
  }
  return { state: 'idle', text: '' };
}
