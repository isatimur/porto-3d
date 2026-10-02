// Check the street network and the traffic on it (src/road-network.js).
// Node 22, no dependencies. Run: node scripts/check-traffic.mjs [seconds]
//
// Asserts, over a simulated run (default 90 s at 30 steps/s, 600 vehicles):
//   - no vehicle ever travels against a one-way way (oneway, motorway,
//     roundabout): the lane it is on runs with the way's `ow`;
//   - every roundabout lane (closed rings and ring pieces alike) turns
//     anticlockwise seen from above, and every vehicle on a roundabout is on
//     such a lane;
//   - vehicles keep right: on two-way roads the offset is always right of
//     the centre line (zero tolerance);
//   - every body faces the way it drives: never more than 60 degrees off
//     its lane (the smoothed heading in locate() is clamped);
//   - no visible vehicle sits below the ground;
//   - every bridge deck with something under it clears it (CLEAR_WATER over
//     the water, CLEAR_WAY over the surface of a way, its ramp or deck
//     included) and no deck runs through the ground.
// Prints the graph statistics, the bridges and tunnels by name, the raised
// approach ramps and the compliance in per cent.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITY, dataPath } from './city-lib.mjs';
import { createProjection } from '../src/geo.js';
import { buildNetwork, createFlow, CLEAR_WATER, CLEAR_WAY } from '../src/road-network.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => JSON.parse(readFileSync(dataPath(f), 'utf8'));
const roads = load('roads.json');
const landmarks = JSON.parse(readFileSync(CITY.landmarksPath, 'utf8'));
const proj = createProjection(roads.origin, roads.bbox, landmarks, load('terrain.json'));
const S = proj.S;
const t0 = Date.now();
const net = buildNetwork(roads, proj.project, proj.heightAt);
const g = net.graph;
const errors = [];
const err = (m) => errors.length < 40 && errors.push(m);
console.log(`network: ${net.ways.length} ways, ${net.X.length} points, built in ${Date.now() - t0} ms`);
console.log(`graph: ${g.nodes} junction nodes, ${g.edges} edges, ${g.n} directed lanes (${[...g.rev].filter((r) => r < 0).length} one-way)`);

// surface height of a way nearest to (x, z)
function wayY(wi, x, z) {
  const w = net.ways[wi];
  let best = w.start;
  let bd = Infinity;
  for (let i = w.start; i < w.start + w.n; i++) {
    const d = (net.X[i] - x) ** 2 + (net.Z[i] - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return net.Y[best];
}

// ---- bridges
const named = new Map();
let bad = 0;
for (const wi of net.bridges) {
  const w = net.ways[wi];
  const key = `${w.t.bn || w.t.name || '(unnamed)'} ${w.t.ref ? `[${w.t.ref}]` : ''} ${w.hw}`.trim();
  const r = named.get(key) || { n: 0, len: 0, maxH: 0, over: new Set() };
  r.n++;
  r.len += w.len / S;
  for (let i = w.start; i < w.start + w.n; i++) r.maxH = Math.max(r.maxH, (net.Y[i] - net.G[i]) / S);
  for (const c of w.crossings) {
    const o = roads.features[c.fi];
    r.over.add(o.kind === 'water' ? o.t?.name || o.t?.ww || 'water' : o.t?.name || o.t?.hw || o.kind);
    // deck at the crossing, interpolated
    let k = w.start;
    while (k < w.start + w.n - 2 && net.C[k + 1] < c.s) k++;
    const u = Math.max(0, Math.min(1, (c.s - net.C[k]) / Math.max(1e-6, net.C[k + 1] - net.C[k])));
    const deckY = net.Y[k] + (net.Y[k + 1] - net.Y[k]) * u;
    const under = c.way >= 0 ? Math.max(wayY(c.way, c.x, c.z), proj.heightAt(c.x, c.z)) : proj.heightAt(c.x, c.z);
    const clr = (deckY - under) / S;
    const want = (c.water ? CLEAR_WATER[c.water] ?? CLEAR_WATER.other : CLEAR_WAY) - 0.3;
    if (clr < want) {
      bad++;
      err(`bridge ${key}: ${clr.toFixed(1)} m over ${c.water || 'a way'} (want ${want.toFixed(1)})`);
    }
  }
  for (let i = w.start; i < w.start + w.n; i++) if (net.Y[i] < net.G[i] - 0.01) err(`bridge ${key}: deck below ground`);
  named.set(key, r);
}
console.log(`bridges: ${net.bridges.length} ways, ${named.size} names`);
for (const [k, r] of [...named].sort((a, b) => b[1].len - a[1].len).slice(0, 40)) {
  console.log(`  ${k}: ${r.n} ways, ${r.len.toFixed(0)} m, deck up to ${r.maxH.toFixed(1)} m, over ${[...r.over].slice(0, 4).join(', ') || '-'}`);
}
const tn = new Map();
for (const wi of net.tunnels) {
  const w = net.ways[wi];
  const key = `${w.t.tn || w.t.name || '(unnamed)'} ${w.t.ref ? `[${w.t.ref}]` : ''} ${w.hw}`.trim();
  const r = tn.get(key) || { n: 0, len: 0 };
  r.n++;
  r.len += w.len / S;
  tn.set(key, r);
}
console.log(`road tunnels: ${net.tunnels.length} ways, ${net.portals.length} portals`);
for (const [k, r] of [...tn].sort((a, b) => b[1].len - a[1].len)) console.log(`  ${k}: ${r.n} ways, ${r.len.toFixed(0)} m`);

// ---- raised approach ramps (drawn with an embankment in roads.js)
let ramps = 0;
let rampMax = 0;
for (const w of net.ways) {
  if (w.bridge || w.tunnel || w.kind === 'foot') continue;
  let mx = 0;
  for (let i = w.start; i < w.start + w.n; i++) mx = Math.max(mx, (net.Y[i] - net.G[i]) / S);
  if (mx > 0.5) ramps++;
  rampMax = Math.max(rampMax, mx);
}
console.log(`approach ramps raised > 0.5 m: ${ramps} ways, up to ${rampMax.toFixed(1)} m`);

// ---- roundabout lanes: which way each lane goes round its ring, from above.
// The ring: a closed way, or roundabout pieces chained end node to start
// node until they close; its centre is the mean of its points. A lane goes
// anticlockwise when the sum of (p - centre) x (segment) is negative
// (x east, z south). A piece that is not part of a closed ring is judged by
// the total turn of its whole way (left turns: ax*bz - az*bx < 0).
const isRound = (w) => w.t.jn === 'roundabout' || w.t.jn === 'circular';
const ringCentre = new Map(); // way index -> [cx, cz]
{
  const pieces = [];
  net.ways.forEach((w, wi) => {
    if (!isRound(w)) return;
    if (w.closed) {
      let cx = 0;
      let cz = 0;
      for (let i = w.start; i < w.start + w.n - 1; i++) {
        cx += net.X[i];
        cz += net.Z[i];
      }
      ringCentre.set(wi, [cx / (w.n - 1), cz / (w.n - 1)]);
      return;
    }
    const a = net.endNode(w, 0);
    const b = net.endNode(w, 1);
    if (a >= 0 && b >= 0) pieces.push({ wi, a, b, used: false });
  });
  const byStart = new Map();
  for (const p of pieces) byStart.set(p.a, [...(byStart.get(p.a) || []), p]);
  for (const p0 of pieces) {
    if (p0.used) continue;
    const chain = [p0];
    p0.used = true;
    let end = p0.b;
    let ok = false;
    for (let guard = 0; guard < 16; guard++) {
      if (end === p0.a) {
        ok = true;
        break;
      }
      const next = (byStart.get(end) || []).find((q) => !q.used);
      if (!next) break;
      next.used = true;
      chain.push(next);
      end = next.b;
    }
    if (!ok) continue;
    let cx = 0;
    let cz = 0;
    let n = 0;
    for (const p of chain) {
      const w = net.ways[p.wi];
      for (let i = w.start; i < w.start + w.n - 1; i++) {
        cx += net.X[i];
        cz += net.Z[i];
        n++;
      }
    }
    for (const p of chain) ringCentre.set(p.wi, [cx / n, cz / n]);
  }
}
const laneCw = new Uint8Array(g.n);
let roundLanes = 0;
let roundCw = 0;
let ringLanes = 0;
for (let d = 0; d < g.n; d++) {
  const wi = g.way[d];
  const w = net.ways[wi];
  if (!isRound(w)) continue;
  roundLanes++;
  const st = g.B[d] > g.A[d] ? 1 : -1;
  const c = ringCentre.get(wi);
  let sum = 0;
  if (c) {
    ringLanes++;
    for (let p = g.A[d]; p !== g.B[d]; p += st) sum += (net.X[p] - c[0]) * (net.Z[p + st] - net.Z[p]) - (net.Z[p] - c[1]) * (net.X[p + st] - net.X[p]);
  } else {
    for (let p = w.start + 1; p < w.start + w.n - 1; p++) {
      const ax = net.X[p] - net.X[p - 1];
      const az = net.Z[p] - net.Z[p - 1];
      const bx = net.X[p + 1] - net.X[p];
      const bz = net.Z[p + 1] - net.Z[p];
      sum += st * Math.atan2(ax * bz - az * bx, ax * bx + az * bz);
    }
  }
  if (sum > 0) {
    laneCw[d] = 1;
    roundCw++;
    err(`roundabout lane ${d} (${w.t.name || 'unnamed'}, ${c ? 'ring' : 'open piece'}) goes clockwise`);
  }
}
console.log(`roundabout lanes: ${roundLanes} (${ringLanes} on closed rings), clockwise: ${roundCw}`);

// ---- simulate
// [seconds] is an optional positional arg. Ignore flags (e.g. --city porto),
// otherwise "--city" would be read as the duration and the simulation would
// run zero steps and pass vacuously.
const secsArg = process.argv.slice(2).find((a) => /^\d+$/.test(a));
const secs = +(secsArg || 90);
let seed = 7;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const flow = createFlow(net, { N: 600, rnd });
for (let i = 0; i < flow.N; i++) flow.spawn(i, rnd() < 0.1 ? 2 : rnd() < 0.14 ? 1 : 0);
const p = {};
let against = 0;
let oneWaySteps = 0;
let roundWrong = 0;
let roundOk = 0;
let under = 0;
let leftSide = 0;
let twoWaySteps = 0;
let respawns = 0;
let stepsN = 0;
let speedSum = 0;
let headSteps = 0;
let headBack = 0;
let headWide = 0;
const onClass = {};
const dt = 1 / 30;
for (let f = 0; f < secs * 30; f++) {
  for (let i = 0; i < flow.N; i++) {
    if (!flow.step(i, dt, 1)) {
      respawns++;
      flow.spawn(i);
      continue;
    }
    flow.locate(i, p, dt);
    const d = flow.vd[i];
    const w = net.ways[g.way[d]];
    const fwd = g.B[d] > g.A[d];
    if (w.ow) {
      oneWaySteps++;
      if ((w.ow === 1 && !fwd) || (w.ow === -1 && fwd)) against++;
    }
    if (!p.hidden && p.y < proj.heightAt(p.x, p.z) - 1.2 * S && !w.tunnel) under++;
    // the body faces the way it drives: within 60 degrees of the lane
    headSteps++;
    const hd = p.hx * p.sx + p.hz * p.sz;
    if (hd <= 0) headBack++;
    if (hd < 0.5 - 1e-4) headWide++;
    if (isRound(w)) {
      if (!laneCw[d]) roundOk++;
      else roundWrong++;
    }
    if (w.ow === 0) {
      twoWaySteps++;
      if (flow.vo[i] <= 0) leftSide++;
    }
    stepsN++;
    speedSum += flow.vv[i] / S;
    if (f === secs * 30 - 1) onClass[w.hw] = (onClass[w.hw] || 0) + 1;
  }
}
const pct = (bad, n) => (n ? (100 * (1 - bad / n)).toFixed(3) : '-');
console.log(`simulated ${secs} s: mean speed ${((speedSum / stepsN) * 3.6).toFixed(1)} km/h, ${respawns} respawns`);
console.log('vehicles by class at the end', onClass);
console.log(`one-way compliance: ${pct(against, oneWaySteps)} % of ${oneWaySteps} vehicle-steps`);
console.log(`roundabouts anticlockwise: ${pct(roundWrong, roundOk + roundWrong)} % of ${roundOk + roundWrong} vehicle-steps`);
console.log(`keep right on two-way roads: ${pct(leftSide, twoWaySteps)} % of ${twoWaySteps} vehicle-steps`);
console.log(`body heading with the lane: ${pct(headBack, headSteps)} % of ${headSteps} vehicle-steps (within 60 degrees: ${pct(headWide, headSteps)} %)`);
if (headBack) err(`${headBack} vehicle-steps with the body facing against its lane`);
if (headWide) err(`${headWide} vehicle-steps with the body more than 60 degrees off its lane`);
if (against) err(`${against} vehicle-steps against a one-way way`);
if (roundWrong) err(`roundabouts: ${roundWrong} clockwise samples`);
if (under) err(`${under} vehicle-steps below the ground`);
if (leftSide) err(`${leftSide} vehicle-steps on the left of a two-way road`);
if (bad) console.log(`${bad} bridge crossings under the clearance`);
if (errors.length) {
  console.log(`FAIL (${errors.length})\n  ` + errors.join('\n  '));
  process.exit(1);
}
console.log('OK');
