// The model worker: builds one landmark model at a time off the main thread
// (model-job.js) and hands the vertex arrays back as transferables, so a
// 70 ms (430 ms on a phone) builder never blocks a frame. Builders load by
// group chunk on first use.
//   in:  { type: 'init', ...init }       (see model-job.js)
//        { type: 'build', id, lid, seq }
//   out: { type: 'ready' }
//        { type: 'built', seq, result }
//        { type: 'error', seq, id, message }
import { createModelJob } from './model-job.js';

let job = null;

self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.type === 'init') {
    try {
      job = createModelJob(m);
      self.postMessage({ type: 'ready' });
    } catch (e) {
      self.postMessage({ type: 'error', seq: -1, id: null, message: String(e?.stack || e) });
    }
    return;
  }
  if (m.type === 'build') {
    try {
      const { result, transfer } = await job.build(m.id, m.lid);
      self.postMessage({ type: 'built', seq: m.seq, result }, transfer);
    } catch (e) {
      self.postMessage({ type: 'error', seq: m.seq, id: m.id, message: String(e?.stack || e) });
    }
  }
};
