// History route progress (src/quest.js). A small localStorage save per city,
// with one record per route:
//
//   porto-quests-<city> = { v: 2, last: <route id>, routes: { <route id>: {
//     visited: { <stop id>: 1 },
//     tries:   { <stop id>: [option, ...] }  // every pick, in order
//   } } }
//
// A wrong pick stays in `tries` (so a reload never gives a fresh first try);
// the stop is done once the right option is among them. Right first time is
// a gold stamp, right after a retry a plain one.
//
// Ported from braga-3d (src/quest-progress.js). Porto never had Braga's
// first-round save, so there is no migration here. Storage may be blocked;
// every access is guarded and falls back to an in-memory copy for the page.

export const KEY = (city) => `porto-quests-${city || 'porto'}`;
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const isPick = (k) => Number.isInteger(k) && k >= 0 && k < 10;

function cleanRoute(r) {
  const out = { visited: {}, tries: {} };
  if (!isObj(r)) return out;
  if (isObj(r.visited)) for (const [id, v] of Object.entries(r.visited)) if (v) out.visited[id] = 1;
  if (isObj(r.tries)) {
    for (const [id, list] of Object.entries(r.tries)) {
      if (!Array.isArray(list)) continue;
      const picks = [...new Set(list.filter(isPick))];
      if (picks.length) out.tries[id] = picks;
    }
  }
  return out;
}

// raw: the parsed save, or null. Anything not a v2 save starts empty.
export function cleanProgress(raw) {
  const out = { v: 2, last: null, routes: {} };
  if (isObj(raw) && raw.v === 2 && isObj(raw.routes)) {
    for (const [id, r] of Object.entries(raw.routes)) out.routes[id] = cleanRoute(r);
    if (typeof raw.last === 'string') out.last = raw.last;
  }
  return out;
}

// the state of one stop from its picks: done when the right one is among
// them; attempts = picks up to the right one; gold = right first time
export function stopResult(tries, answer) {
  const list = tries || [];
  const at = list.indexOf(answer);
  return { done: at >= 0, attempts: at >= 0 ? at + 1 : list.length, gold: at === 0 };
}

export function createQuestProgress(city) {
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
    memory = cleanProgress(raw);
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
    return (m.routes[route] ||= { visited: {}, tries: {} });
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
        visited: (id) => !!read().routes[route]?.visited[id],
        tries: (id) => [...(read().routes[route]?.tries[id] || [])],
        visit(id) {
          const r = rec(route);
          if (r.visited[id]) return;
          r.visited[id] = 1;
          write();
        },
        // 'right' | 'wrong', or null when ignored (stop done, option
        // already tried, not an option)
        pick(id, option, answer) {
          if (!isPick(option)) return null;
          const r = rec(route);
          const list = r.tries[id] || [];
          if (list.includes(answer) || list.includes(option)) return null;
          r.tries[id] = [...list, option];
          write();
          return option === answer ? 'right' : 'wrong';
        },
        reset() {
          read().routes[route] = { visited: {}, tries: {} };
          write();
        },
      };
    },
  };
}

// stops: [{ id, answer }]; rp: progress.route(id). next: index of the first
// stop not done (stops.length when all are done).
export function questSummary(stops, rp) {
  let gold = 0;
  let done = 0;
  let visited = 0;
  let started = 0;
  let next = -1;
  stops.forEach((s, i) => {
    const tries = rp.tries(s.id);
    const r = stopResult(tries, s.answer);
    if (rp.visited(s.id) || tries.length) visited++;
    if (tries.length) started++;
    if (r.gold) gold++;
    if (r.done) done++;
    else if (next < 0) next = i;
  });
  return { gold, done, visited, started, total: stops.length, next: next < 0 ? stops.length : next };
}
