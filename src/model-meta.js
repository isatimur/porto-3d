// What the main thread knows about the landmark models without building
// them: the baked cache data/fits.json (scripts/bake-fits.mjs). DOM-free.
//
// fits.json:
//   { v, inputs, groups: { id: groupName },
//     models: { id: { spec, rule, fn?, metric, legacy, box, real, groups,
//                     glass, draped, markers, pieces, sphere, tris } } }
// `rule` is the builder's fit rule with RegExp written as { $re, f } and
// functions as { $fn: 1 }. A rule with a function (the four big bridges'
// pad.level, which the terrain calls) cannot be baked: those ids set `fn` and
// take the whole rule from the loaded bridges group (ruleSources).

export const FITS_VERSION = 1;

// JSON-safe copy of a rule. Returns the copy and whether it held a function.
export function serializeRule(rule) {
  let fn = false;
  const walk = (x) => {
    if (x instanceof RegExp) return { $re: x.source, f: x.flags };
    if (typeof x === 'function') {
      fn = true;
      return { $fn: 1 };
    }
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') {
      const o = {};
      for (const [k, v] of Object.entries(x)) if (v !== undefined) o[k] = walk(v);
      return o;
    }
    return x;
  };
  return { rule: walk(rule), fn };
}

export function reviveRule(x) {
  if (Array.isArray(x)) return x.map(reviveRule);
  if (x && typeof x === 'object') {
    if (typeof x.$re === 'string') return new RegExp(x.$re, x.f);
    const o = {};
    for (const [k, v] of Object.entries(x)) o[k] = reviveRule(v);
    return o;
  }
  return x;
}

// baked: the parsed fits.json. ruleSources: { id: builder.rule } for the ids
// whose baked entry has `fn`.
export function createMeta(baked, ruleSources = {}) {
  const models = baked?.models ?? {};
  const rules = new Map();
  return {
    has: (id) => !!models[id],
    entry: (id) => models[id] ?? null,
    groupOf: (id) => baked?.groups?.[id] ?? null,
    // the `models` object src/fit.js takes as ctx.models (no buildModel here)
    models: {
      specFor: (id) => models[id]?.spec ?? { h: 50, yaw: 0 },
      isMetric: (_type, id) => !!models[id]?.metric,
      builderRule(_type, id) {
        const m = models[id];
        if (!m) return {};
        if (m.fn) {
          const r = ruleSources[id];
          if (!r) throw new Error(`fit rule of ${id} needs its builder module (group ${baked.groups?.[id]})`);
          return r;
        }
        let r = rules.get(id);
        if (!r) rules.set(id, (r = reviveRule(m.rule)));
        return r;
      },
    },
  };
}
