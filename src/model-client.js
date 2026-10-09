// The main thread's side of the model worker: build(id, lid) resolves to the
// packed arrays of one finished model (see model-job.js). One build in flight
// at a time is the caller's job (landmarks.js keeps the priority queue). The
// worker starts on the first build, not at boot. If a module worker cannot
// run, the same job runs on the main thread (one long task per model; slow
// but correct).
export function createModelClient(init) {
  let worker = null;
  let ready = null;
  let seq = 0;
  let mode = 'worker';
  let jobPromise = null;
  const waiting = new Map();
  const stats = { mode: 'worker', builds: 0, errors: 0, buildMs: 0, loadMs: 0 };

  function spawn() {
    ready = new Promise((resolve, reject) => {
      try {
        worker = new Worker(new URL('./model-worker.js', import.meta.url), { type: 'module' });
      } catch (e) {
        reject(e);
        return;
      }
      worker.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === 'ready') return resolve();
        if (m.type === 'error' && m.seq === -1) return reject(new Error(m.message));
        const w = waiting.get(m.seq);
        if (!w) return;
        waiting.delete(m.seq);
        if (m.type === 'built') w.resolve(m.result);
        else w.reject(new Error(m.message));
      };
      worker.onerror = (ev) => {
        const err = new Error(ev.message || 'model worker failed');
        reject(err);
        for (const w of waiting.values()) w.reject(err);
        waiting.clear();
      };
      worker.postMessage({ type: 'init', ...init });
    });
    return ready;
  }

  async function viaMainThread(id, lid) {
    jobPromise ||= import('./model-job.js').then((m) => m.createModelJob(init));
    const job = await jobPromise;
    await new Promise((r) => setTimeout(r, 0)); // let a frame go first
    return (await job.build(id, lid)).result;
  }

  async function build(id, lid) {
    if (mode === 'worker') {
      try {
        await (ready || spawn());
      } catch (e) {
        console.warn('[porto] model worker unavailable, building on the main thread', e?.message || e);
        mode = 'main';
        stats.mode = 'main';
        worker?.terminate();
        worker = null;
      }
    }
    let result;
    try {
      if (mode === 'worker') {
        const s = ++seq;
        result = await new Promise((resolve, reject) => {
          waiting.set(s, { resolve, reject });
          worker.postMessage({ type: 'build', id, lid, seq: s });
        });
      } else {
        result = await viaMainThread(id, lid);
      }
    } catch (e) {
      stats.errors++;
      throw e;
    }
    stats.builds++;
    stats.buildMs += result.ms.build;
    stats.loadMs += result.ms.load;
    return result;
  }

  return {
    build,
    stats,
    // frees the worker's memory (its terrain copy and loaded builders)
    terminate() {
      worker?.terminate();
      worker = null;
      ready = null;
    },
  };
}
