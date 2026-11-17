// History route progress (src/quest.js). A small localStorage save per city,
// with one record per route:
//
//   porto-quests-<city> = { v: 3, last: <route id>, routes: { <route id>: {
//     visited: { <stop id>: 1 },
//     tries:   { <task id>: [token, ...] },   // every try, in order
//     stamps:  { <stop id>: 'gold' | 'plain' } // written once, when solved
//   } } }
//
// A token is what the visitor tried, by stable id, never by text: an option
// id (multiple_choice, visual_detail), 'true' or 'false' (true_false), a
// landmark id (find_on_map) or the item ids in the tried order, joined by
// commas (sequence). A wrong try stays in `tries` (so a reload never gives a
// fresh first try); the stop is done once its stamp is written. Right first
// time is a gold stamp, right after a retry a plain one. A stamp belongs to
// the stop, not to its task: a task replaced in the data keeps the stamp.
//
// The round-2 save (v2, same key, live on porto-3d.com) is read once and
// left in place until the first change: its tries were option indices keyed
// by stop id. The data's `legacy.v2` table gives each stop its old answer
// index and, for a question still asked, its task id and option ids, so a
// kept question keeps its tries and a replaced one keeps only its stamp.
//
// Ported from braga-3d (src/quest-progress.js, main 08ce468). Porto never had
// Braga's first-round save, so there is no round-1 path. Storage may be
// blocked; every access is guarded and falls back to an in-memory copy for
// the page.

export const KEY = (city) => `porto-quests-${city || 'porto'}`;
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const isIndex = (k) => Number.isInteger(k) && k >= 0 && k < 10;
// a token: ids in kebab case, a sequence joins them with commas
export const isToken = (t) => typeof t === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*(,[a-z0-9]+(-[a-z0-9]+)*)*$/.test(t) && t.length <= 240;
const STAMPS = new Set(['gold', 'plain']);
const blank = () => ({ visited: {}, tries: {}, stamps: {} });

function cleanRoute(r) {
  const out = blank();
  if (!isObj(r)) return out;
  if (isObj(r.visited)) for (const [id, v] of Object.entries(r.visited)) if (v) out.visited[id] = 1;
  if (isObj(r.tries)) {
    for (const [id, list] of Object.entries(r.tries)) {
      if (!Array.isArray(list)) continue;
      const tokens = [...new Set(list.filter(isToken))];
      if (tokens.length) out.tries[id] = tokens;
    }
  }
  if (isObj(r.stamps)) for (const [id, s] of Object.entries(r.stamps)) if (STAMPS.has(s)) out.stamps[id] = s;
  return out;
}

// the state of one task from its tries: done when the answer is among
// them; attempts = tries up to the right one; gold = right first time
export function stopResult(tries, answer) {
  const list = tries || [];
  const at = list.indexOf(answer);
  return { done: at >= 0, attempts: at >= 0 ? at + 1 : list.length, gold: at === 0 };
}

// v2 route records (index picks per stop) -> v3. table: legacy.v2
function fromV2(routes, table = {}) {
  const out = {};
  for (const [rid, raw] of Object.entries(routes)) {
    if (!isObj(raw)) continue;
    const r = blank();
    if (isObj(raw.visited)) for (const [id, v] of Object.entries(raw.visited)) if (v) r.visited[id] = 1;
    const map = isObj(table[rid]) ? table[rid] : {};
    if (isObj(raw.tries)) {
      for (const [stop, list] of Object.entries(raw.tries)) {
        if (!Array.isArray(list)) continue;
        const picks = [...new Set(list.filter(isIndex))];
        const old = map[stop];
        if (!picks.length || !isObj(old) || !isIndex(old.answer)) continue;
        const res = stopResult(picks, old.answer);
        if (res.done) r.stamps[stop] = res.gold ? 'gold' : 'plain';
        // a question still asked keeps its tries, by option id
        if (typeof old.task === 'string' && Array.isArray(old.options)) {
          const tokens = picks.map((k) => old.options[k]).filter(isToken);
          if (tokens.length) r.tries[old.task] = tokens;
        }
      }
    }
    out[rid] = r;
  }
  return out;
}

// raw: the parsed save, or null. legacyV2: the data's legacy.v2 table
// ({ <route>: { <stop>: { answer, task?, options? } } }). Anything not a v3
// or v2 save starts empty.
export function migrateProgress(raw, legacyV2 = {}) {
  const out = { v: 3, last: null, routes: {} };
  if (!isObj(legacyV2)) legacyV2 = {};
  if (isObj(raw) && raw.v === 3 && isObj(raw.routes)) {
    for (const [id, r] of Object.entries(raw.routes)) out.routes[id] = cleanRoute(r);
    if (typeof raw.last === 'string') out.last = raw.last;
    return out;
  }
  if (isObj(raw) && raw.v === 2 && isObj(raw.routes)) {
    out.routes = fromV2(raw.routes, legacyV2);
    if (typeof raw.last === 'string') out.last = raw.last;
  }
  return out;
}

// legacyV2: data/quest.json legacy.v2, for the round-2 save
export function createQuestProgress(city, legacyV2 = {}) {
  let memory = null;
  function read() {
    if (memory) return memory;
    let raw = null;
    try {
      const s = localStorage.getItem(KEY(city));
      raw = s ? JSON.parse(s) : null;
    } catch {
      raw = null;
    }
    memory = migrateProgress(raw, legacyV2);
    return memory;
  }
  function write() {
    try {
      localStorage.setItem(KEY(city), JSON.stringify(memory));
    } catch {
      // storage blocked: memory keeps the session's progress
    }
  }
  function rec(route) {
    const m = read();
    return (m.routes[route] ||= blank());
  }
  return {
    get state() {
      return read();
    },
    // the route opened last, for #quest
    get last() {
      return read().last;
    },
    setLast(route) {
      if (read().last === route) return;
      memory.last = route;
      write();
    },
    // one route's record, with the same guards
    route(route) {
      return {
        visited: (stop) => !!read().routes[route]?.visited[stop],
        tries: (task) => [...(read().routes[route]?.tries[task] || [])],
        // 'gold' | 'plain' | null
        stamp: (stop) => read().routes[route]?.stamps[stop] || null,
        visit(stop) {
          const r = rec(route);
          if (r.visited[stop]) return;
          r.visited[stop] = 1;
          write();
        },
        // one try at a stop's task: 'right' | 'wrong', or null when ignored
        // (stop done, the same try again, not a token)
        submit(stop, task, token, answer) {
          if (!isToken(token) || !isToken(task)) return null;
          const r = rec(route);
          if (r.stamps[stop]) return null;
          const list = r.tries[task] || [];
          if (list.includes(token)) return null;
          r.tries[task] = [...list, token];
          if (token === answer) r.stamps[stop] = list.length ? 'plain' : 'gold';
          write();
          return token === answer ? 'right' : 'wrong';
        },
        reset() {
          read().routes[route] = blank();
          write();
        },
      };
    },
  };
}

// stops: [{ id, task: { id } }]; rp: progress.route(id). next: index of the
// first stop not done (stops.length when all are done).
export function questSummary(stops, rp) {
  let gold = 0;
  let done = 0;
  let visited = 0;
  let started = 0;
  let next = -1;
  stops.forEach((s, i) => {
    const tried = rp.tries(s.task?.id).length > 0;
    const stamp = rp.stamp(s.id);
    if (rp.visited(s.id) || tried || stamp) visited++;
    if (tried || stamp) started++;
    if (stamp === 'gold') gold++;
    if (stamp) done++;
    else if (next < 0) next = i;
  });
  return { gold, done, visited, started, total: stops.length, next: next < 0 ? stops.length : next };
}
