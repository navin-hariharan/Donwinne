// Behavioural properties of the report's §5.2.1 (A. Halder, "A Study of Petri Nets", 2006) and of
// Murata (1989, §IV) beyond the basic ones: liveness levels L0–L4 of every transition, repetitivity,
// consistency, conservation, persistence, bounded (B-) fairness, unconditional fairness and
// synchronic distances.
//
// What decides them:
// - the complete reachability graph (bounded nets): every answer is exact;
// - the complete Karp–Miller coverability graph (unbounded nets with normal and read arcs only):
//   every firing sequence is the label of a path in it, and a cycle of it can be pumped (fired as
//   often as wanted from a reachable marking with enough tokens in its ω-places). Questions about
//   infinite sequences become small exact linear programs over the cycles of one strongly connected
//   component: a closed walk whose token effect on the ω-places is ≥ 0 can repeat forever;
// - otherwise only the explored part of the state space: what it shows is proven (a cycle found is a
//   real cycle, a firing seen is a real firing), everything else stays "unknown".

import { coverabilityGraph } from "./coverability";
import { checkAbort, type PTNet } from "./ptnet";
import { solveLP, integerVector, type LPRow } from "./rational";
import { coverabilityApplies, type StateSpace } from "./statespace";
import { scc } from "./structure";
import type { BehaviourResult, DynamicsResult, NodeRef, Status, SynchronicPair, TransitionLiveness } from "./types";

interface Graph {
  nodes: number;
  from: ArrayLike<number>;
  to: ArrayLike<number>;
  trans: ArrayLike<number>;
}

interface Comps {
  comp: Int32Array;
  count: number;
  /** Per edge: allowed and both ends in one component (the edge lies on a cycle). */
  inside: Uint8Array;
}

/** Strongly connected components of the graph restricted to the allowed edges. */
function components(g: Graph, allow?: (e: number) => boolean): Comps {
  const succ: number[][] = Array.from({ length: g.nodes }, () => []);
  const E = g.from.length;
  for (let e = 0; e < E; e++) if (!allow || allow(e)) succ[g.from[e]].push(g.to[e]);
  const { comp, count } = scc(succ);
  const inside = new Uint8Array(E);
  for (let e = 0; e < E; e++) if ((!allow || allow(e)) && comp[g.from[e]] === comp[g.to[e]]) inside[e] = 1;
  return { comp, count, inside };
}

/** Transitions that label an edge on a cycle. */
function cycleTransitions(g: Graph, c: Comps, m: number): Uint8Array {
  const on = new Uint8Array(m);
  for (let e = 0; e < c.inside.length; e++) if (c.inside[e]) on[g.trans[e]] = 1;
  return on;
}

const allYes = (xs: Status[]): Status => (!xs.length ? "n/a" : xs.every((s) => s === "yes") ? "yes" : xs.some((s) => s === "no") ? "no" : "unknown");
const anyYes = (xs: Status[]): Status => (!xs.length ? "n/a" : xs.some((s) => s === "yes") ? "yes" : xs.every((s) => s === "no") ? "no" : "unknown");

/**
 * On a complete coverability graph: is there a closed walk inside one strongly connected component
 * (of the allowed edges) that uses every transition of `include` (or, with none, at least one edge)
 * and whose token effect on the component's ω-places is ≥ 0 (`effect: ">="`, it can repeat
 * forever) or = 0 (`effect: "="`, it reproduces its marking)? "no" is exact (any such infinite or
 * reproducing firing sequence gives one, by Dickson's lemma); "yes" needs an LP solution whose edges
 * form one connected closed walk; a solution spread over several cycles that do not meet stays
 * "unknown", as does an LP over its size limit.
 */
function closedWalk(
  g: Graph & { omega: number[][] },
  C: number[][],
  allow: ((e: number) => boolean) | undefined,
  include: number[],
  effect: ">=" | "=",
  signal?: AbortSignal,
): { status: Status } {
  const c = components(g, allow);
  const byComp = new Map<number, number[]>();
  for (let e = 0; e < c.inside.length; e++) {
    if (!c.inside[e]) continue;
    const k = c.comp[g.from[e]];
    let list = byComp.get(k);
    if (!list) byComp.set(k, (list = []));
    list.push(e);
  }
  let unknown = false;
  for (const edges of byComp.values()) {
    checkAbort(signal);
    const labels = new Set(edges.map((e) => g.trans[e]));
    if (!include.every((t) => labels.has(t))) continue;
    if (edges.length > 3000) {
      unknown = true;
      continue;
    }
    const varOf = new Map<number, number>();
    edges.forEach((e, i) => varOf.set(e, i));
    const nodeRows = new Map<number, [number, number][]>();
    const row = (v: number) => {
      let r = nodeRows.get(v);
      if (!r) nodeRows.set(v, (r = []));
      return r;
    };
    edges.forEach((e, i) => {
      if (g.from[e] === g.to[e]) return;
      row(g.from[e]).push([i, 1]);
      row(g.to[e]).push([i, -1]);
    });
    const rows: LPRow[] = [...nodeRows.values()].map((terms) => ({ terms, sense: "=", rhs: 0 }));
    if (include.length) for (const t of include) rows.push({ terms: edges.flatMap((e, i) => (g.trans[e] === t ? [[i, 1] as [number, number]] : [])), sense: ">=", rhs: 1 });
    else rows.push({ terms: edges.map((_, i) => [i, 1] as [number, number]), sense: ">=", rhs: 1 });
    // All nodes of a component have the same ω-places; on the others a closed walk has effect 0.
    const omega = g.omega[g.from[edges[0]]];
    for (let p = 0; p < omega.length; p++) {
      if (omega[p] !== Infinity) continue;
      const terms = edges.flatMap((e, i) => (C[p][g.trans[e]] ? [[i, C[p][g.trans[e]]] as [number, number]] : []));
      if (terms.length) rows.push({ terms, sense: effect, rhs: 0 });
    }
    const r = solveLP({ vars: edges.length, rows, signal, maxPivots: 6000 });
    if (r.status === "limit") {
      unknown = true;
      continue;
    }
    if (r.status === "infeasible" || !r.num) continue;
    // Connected support: one closed walk (an Euler tour of the multigraph) realises the solution.
    const used = edges.filter((_, i) => r.num![i] > 0n);
    const parent = new Map<number, number>();
    const find = (x: number): number => {
      while (parent.has(x) && parent.get(x) !== x) x = parent.get(x)!;
      return x;
    };
    for (const e of used) {
      const a = find(g.from[e]);
      const b = find(g.to[e]);
      if (!parent.has(a)) parent.set(a, a);
      if (!parent.has(b)) parent.set(b, b);
      if (a !== b) parent.set(a, b);
    }
    const roots = new Set(used.map((e) => find(g.from[e])));
    if (roots.size === 1) return { status: "yes" };
    unknown = true;
  }
  return { status: unknown ? "unknown" : "no" };
}

/**
 * Synchronic distance of transitions a and b on a graph whose cycles all lie inside the components
 * of `c`: the largest |#a − #b| over its paths, or Infinity when some cycle fires a and b a different
 * number of times. Linear time: potentials inside each component, longest and shortest paths over
 * the components in topological order (Tarjan numbers components so that edges go from higher to
 * lower numbers).
 */
function synchronicDistance(g: Graph, c: Comps, members: number[][], inAdj: number[][], outAdj: number[][], a: number, b: number): number {
  const w = (e: number) => (g.trans[e] === a ? 1 : 0) - (g.trans[e] === b ? 1 : 0);
  const phi = new Float64Array(g.nodes).fill(NaN);
  for (let k = 0; k < c.count; k++) {
    const nodes = members[k];
    const root = nodes[0];
    phi[root] = 0;
    const queue = [root];
    while (queue.length) {
      const u = queue.pop()!;
      for (const e of outAdj[u]) {
        if (!c.inside[e]) continue;
        const v = g.to[e];
        const want = phi[u] + w(e);
        if (Number.isNaN(phi[v])) {
          phi[v] = want;
          queue.push(v);
        } else if (phi[v] !== want) return Infinity;
      }
      for (const e of inAdj[u]) {
        if (!c.inside[e]) continue;
        const v = g.from[e];
        const want = phi[u] - w(e);
        if (Number.isNaN(phi[v])) {
          phi[v] = want;
          queue.push(v);
        } else if (phi[v] !== want) return Infinity;
      }
    }
  }
  const hi = new Float64Array(g.nodes);
  const lo = new Float64Array(g.nodes);
  let best = 0;
  for (let k = c.count - 1; k >= 0; k--) {
    let kHi = -Infinity;
    let kLo = Infinity;
    for (const x of members[k]) {
      let inHi = 0;
      let inLo = 0;
      for (const e of inAdj[x]) {
        if (c.inside[e]) continue;
        const u = g.from[e];
        inHi = Math.max(inHi, hi[u] + w(e));
        inLo = Math.min(inLo, lo[u] + w(e));
      }
      kHi = Math.max(kHi, inHi - phi[x]);
      kLo = Math.min(kLo, inLo - phi[x]);
    }
    for (const v of members[k]) {
      hi[v] = phi[v] + kHi;
      lo[v] = phi[v] + kLo;
      best = Math.max(best, hi[v], -lo[v]);
    }
  }
  return best;
}

export interface DynamicsOptions {
  maxStates?: number;
  signal?: AbortSignal;
}

/** Liveness levels, repetitivity, consistency, conservation, fairness and synchronic distances. */
export function analyseDynamics(pt: PTNet, behaviour: BehaviourResult, space: StateSpace | undefined, C: number[][], opts: DynamicsOptions = {}): DynamicsResult {
  const T = pt.transitions;
  const m = T.length;
  const n = pt.places.length;
  const { signal } = opts;
  const persistent = behaviour.dynamicConflictFree;

  const skipped = (note: string): DynamicsResult => ({
    source: "skipped",
    transitions: T.map((transition) => ({ transition, levels: ["n/a", "n/a", "n/a", "n/a"], level: null, atLeast: 0 })),
    netLevels: ["n/a", "n/a", "n/a", "n/a"],
    repetitive: "n/a",
    partiallyRepetitive: "n/a",
    consistent: "n/a",
    partiallyConsistent: "n/a",
    conservative: "n/a",
    conservationWeights: null,
    strictlyConservative: "n/a",
    persistent,
    bFair: "n/a",
    bFairClasses: null,
    unconditionallyFair: "n/a",
    synchronic: [],
    synchronicNote: note,
  });
  if (!space || behaviour.exploration === "skipped") return skipped(behaviour.reason ? `Not analysed: ${behaviour.reason}.` : "Not analysed: the state space was not explored.");
  if (!m) return skipped("The net has no transitions.");

  // ---- Which graph decides.
  const complete = behaviour.exploration === "complete";
  let source: DynamicsResult["source"] = complete ? "reachability" : "partial";
  let g: Graph = { nodes: space.markings.length, from: space.from, to: space.to, trans: space.trans };
  let cg: (Graph & { omega: number[][] }) | undefined;
  if (!complete && behaviour.bounded === "no" && coverabilityApplies(pt) && !space.unresolved.length) {
    const k = coverabilityGraph(pt, opts.maxStates ?? 100_000, signal);
    if (k.complete) {
      cg = { nodes: k.nodes.length, from: k.from, to: k.to, trans: k.trans, omega: k.nodes };
      g = cg;
      source = "coverability";
    }
  }
  checkAbort(signal);
  const E = g.from.length;
  const exact = source !== "partial";

  // ---- Shared structure: components, cycle transitions, adjacency.
  const comps = components(g);
  const onCycle = cycleTransitions(g, comps, m);
  const fired = new Uint8Array(m);
  for (let e = 0; e < E; e++) fired[g.trans[e]] = 1;
  const idx = new Map(T.map((t, i) => [t.id, i]));
  const provenDead = new Set(behaviour.hasDeadTransitions === "yes" ? behaviour.deadTransitions.map((t) => idx.get(t.id)!) : []);
  const provenNonLive = new Set(behaviour.nonLiveTransitions.map((t) => idx.get(t.id)!));

  // L4 on the complete reachability graph: t labels an edge in every terminal component.
  let liveIn: Uint8Array | undefined;
  if (source === "reachability") {
    const leaves = new Uint8Array(comps.count);
    for (let e = 0; e < E; e++) if (!comps.inside[e]) leaves[comps.comp[g.from[e]]] = 1;
    const terminal = [...Array(comps.count).keys()].filter((k) => !leaves[k]);
    const labels = terminal.map(() => new Set<number>());
    const pos = new Map(terminal.map((k, i) => [k, i]));
    for (let e = 0; e < E; e++) {
      const i = pos.get(comps.comp[g.from[e]]);
      if (i !== undefined && comps.inside[e]) labels[i].add(g.trans[e]);
    }
    liveIn = new Uint8Array(m);
    for (let t = 0; t < m; t++) liveIn[t] = labels.every((s) => s.has(t)) ? 1 : 0;
  }

  // ---- Liveness levels.
  const transitions: TransitionLiveness[] = T.map((transition, t) => {
    let l1: Status, l2: Status, l3: Status, l4: Status;
    if (source === "reachability") {
      l1 = fired[t] ? "yes" : "no";
      // A bounded net fires t arbitrarily often (L2) exactly when t lies on a cycle, and then forever (L3).
      l2 = l3 = onCycle[t] ? "yes" : "no";
      l4 = liveIn![t] ? "yes" : "no";
    } else if (source === "coverability") {
      l1 = fired[t] ? "yes" : "no";
      // Every firing sequence is a path of the coverability graph, and its cycles can be pumped.
      l2 = onCycle[t] ? "yes" : "no";
      l3 = onCycle[t] ? closedWalk(cg!, C, undefined, [t], ">=", signal).status : "no";
      l4 = provenNonLive.has(t) || l3 === "no" ? "no" : behaviour.live === "yes" ? "yes" : "unknown";
    } else {
      l1 = fired[t] ? "yes" : provenDead.has(t) ? "no" : "unknown";
      l2 = l3 = onCycle[t] ? "yes" : l1 === "no" ? "no" : "unknown";
      l4 = provenNonLive.has(t) || l1 === "no" ? "no" : behaviour.live === "yes" ? "yes" : "unknown";
    }
    const levels: [Status, Status, Status, Status] = [l1, l2, l3, l4];
    // Lk implies L(k−1): propagate proofs both ways.
    for (let k = 3; k > 0; k--) if (levels[k] === "yes") levels[k - 1] = "yes";
    for (let k = 0; k < 3; k++) if (levels[k] === "no") levels[k + 1] = "no";
    let atLeast: TransitionLiveness["atLeast"] = 0;
    for (let k = 0; k < 4; k++) if (levels[k] === "yes") atLeast = (k + 1) as TransitionLiveness["atLeast"];
    const nextNo = atLeast === 4 || levels[atLeast] === "no";
    return { transition, levels, level: nextNo ? atLeast : null, atLeast };
  });
  const netLevels = [0, 1, 2, 3].map((k) => allYes(transitions.map((x) => x.levels[k]))) as DynamicsResult["netLevels"];

  // ---- Repetitive and consistent: one cycle (closed walk) through every transition.
  let repetitive: Status;
  let consistent: Status;
  let partiallyRepetitive: Status = anyYes(transitions.map((x) => x.levels[2]));
  let partiallyConsistent: Status;
  {
    const labels: Set<number>[] = Array.from({ length: comps.count }, () => new Set());
    for (let e = 0; e < E; e++) if (comps.inside[e]) labels[comps.comp[g.from[e]]].add(g.trans[e]);
    const allInOne = labels.some((s) => s.size === m);
    const anyCycle = labels.some((s) => s.size > 0);
    if (source === "reachability") {
      repetitive = consistent = allInOne ? "yes" : "no";
      partiallyConsistent = anyCycle ? "yes" : "no";
    } else if (source === "coverability") {
      const all = [...Array(m).keys()];
      repetitive = allInOne ? closedWalk(cg!, C, undefined, all, ">=", signal).status : "no";
      consistent = allInOne ? closedWalk(cg!, C, undefined, all, "=", signal).status : "no";
      partiallyConsistent = anyCycle ? closedWalk(cg!, C, undefined, [], "=", signal).status : "no";
    } else {
      repetitive = consistent = allInOne ? "yes" : "unknown";
      partiallyConsistent = anyCycle ? "yes" : "unknown";
      if (partiallyRepetitive === "unknown" && anyCycle) partiallyRepetitive = "yes";
    }
  }

  // ---- Conservation over the reachable markings: w·M = w·M0 for every reachable M, i.e. w·d = 0
  // for every difference d = M' − M of an edge.
  let conservative: Status;
  let strictlyConservative: Status;
  let conservationWeights: Record<string, number> | null = null;
  if (source === "coverability") {
    // An unbounded net cannot keep a positively weighted token sum.
    conservative = strictlyConservative = "no";
  } else {
    const diffs = new Map<string, number[]>();
    for (let e = 0; e < E && diffs.size < 2000; e++) {
      const a = space.markings[space.from[e]];
      const b = space.markings[space.to[e]];
      const d: number[] = [];
      let nz = false;
      for (let p = 0; p < n; p++) {
        d.push(b[p] - a[p]);
        if (b[p] !== a[p]) nz = true;
      }
      if (nz) diffs.set(d.join(","), d);
    }
    const ds = [...diffs.values()];
    strictlyConservative = ds.some((d) => d.reduce((s, v) => s + v, 0) !== 0) ? "no" : exact ? "yes" : "unknown";
    if (!n) conservative = "n/a";
    else {
      const rows: LPRow[] = ds.map((d) => ({ terms: d.flatMap((v, p) => (v ? [[p, v] as [number, number]] : [])), sense: "=", rhs: 0 }));
      for (let p = 0; p < n; p++) rows.push({ terms: [[p, 1]], sense: ">=", rhs: 1 });
      const r = solveLP({ vars: n, rows, objective: new Array(n).fill(-1), signal });
      if (r.status === "infeasible") conservative = "no";
      else if (r.status === "limit" || !r.num) conservative = "unknown";
      else {
        conservative = exact ? "yes" : "unknown";
        const w = integerVector(r.num);
        if (w && exact) conservationWeights = Object.fromEntries(pt.places.map((p, i) => [p.id, w[i]]));
      }
    }
  }

  // ---- B-fairness and unconditional fairness: can a fire arbitrarily often while b does not?
  // On a finite graph (or the coverability graph, whose cycles can be pumped) exactly when a labels
  // a cycle of the graph without b's edges.
  let bFair: Status = "unknown";
  let bFairClasses: NodeRef[][] | null = null;
  let unfairPair: [NodeRef, NodeRef] | undefined;
  let unconditionallyFair: Status = "unknown";
  const pairBudget = m * E;
  /** without[b][a] = 1: a lies on a cycle avoiding b. */
  let without: Uint8Array[] | undefined;
  if (pairBudget <= 20_000_000) {
    without = [];
    for (let b = 0; b < m; b++) {
      checkAbort(signal);
      const c = components(g, (e) => g.trans[e] !== b);
      without.push(cycleTransitions(g, c, m));
    }
    let unfair = false;
    for (let b = 0; b < m && !unfair; b++)
      for (let a = 0; a < m; a++)
        if (a !== b && without[b][a]) {
          unfair = true;
          unfairPair = [T[a], T[b]];
          break;
        }
    if (unfair) bFair = "no";
    else if (exact) bFair = "yes";
    if (exact) {
      // Classes when the relation is an equivalence.
      const fair = (a: number, b: number) => a === b || (!without![b][a] && !without![a][b]);
      let transitive = true;
      for (let a = 0; a < m && transitive; a++)
        for (let b = 0; b < m && transitive; b++)
          if (fair(a, b)) for (let c = 0; c < m; c++) if (fair(b, c) && !fair(a, c)) {
            transitive = false;
            break;
          }
      if (transitive) {
        const seen = new Uint8Array(m);
        bFairClasses = [];
        for (let a = 0; a < m; a++) {
          if (seen[a]) continue;
          const cls: NodeRef[] = [];
          for (let b = 0; b < m; b++) if (!seen[b] && fair(a, b)) {
            seen[b] = 1;
            cls.push(T[b]);
          }
          bFairClasses.push(cls);
        }
      }
    }
    // Unconditionally fair: no infinite sequence leaves some transition out from some point on.
    if (source === "coverability") {
      const verdicts = [...Array(m).keys()].map((b) => (without![b].some((x) => x) ? closedWalk(cg!, C, (e) => g.trans[e] !== b, [], ">=", signal).status : "no"));
      unconditionallyFair = verdicts.includes("yes") ? "no" : verdicts.every((v) => v === "no") ? "yes" : "unknown";
    } else {
      const avoid = without.some((row) => row.some((x) => x));
      unconditionallyFair = avoid ? "no" : exact ? "yes" : "unknown";
    }
  }

  // ---- Synchronic distances.
  const synchronic: SynchronicPair[] = [];
  let synchronicNote: string;
  const pairs = (m * (m - 1)) / 2;
  if (m < 2) synchronicNote = "Synchronic distances need at least two transitions.";
  else if (m > 40 || pairs * E > 30_000_000) synchronicNote = `Not computed: ${m} transitions and ${E.toLocaleString()} edges are too many pairs to compare.`;
  else {
    const members: number[][] = Array.from({ length: comps.count }, () => []);
    for (let v = 0; v < g.nodes; v++) members[comps.comp[v]].push(v);
    const inAdj: number[][] = Array.from({ length: g.nodes }, () => []);
    const outAdj: number[][] = Array.from({ length: g.nodes }, () => []);
    for (let e = 0; e < E; e++) {
      outAdj[g.from[e]].push(e);
      inAdj[g.to[e]].push(e);
    }
    for (let a = 0; a < m; a++)
      for (let b = a + 1; b < m; b++) {
        checkAbort(signal);
        const d = synchronicDistance(g, comps, members, inAdj, outAdj, a, b);
        if (d === Infinity) synchronic.push({ a, b, value: null, infinite: true, exact: true });
        // On the coverability graph a finite value is only an upper bound (its paths over-approximate).
        else if (source === "coverability") synchronic.push({ a, b, value: null, infinite: false, exact: false });
        else synchronic.push({ a, b, value: d, infinite: false, exact });
      }
    synchronicNote =
      source === "reachability"
        ? "Exact, from the complete reachability graph."
        : source === "coverability"
          ? "From the coverability graph: an infinite distance is proven (a cycle fires the two transitions a different number of times and can be repeated); finite distances are not decided."
          : "From the explored part of the state space only: infinite distances are proven, finite values are lower bounds.";
  }

  return {
    source,
    transitions,
    netLevels,
    repetitive,
    partiallyRepetitive,
    consistent,
    partiallyConsistent,
    conservative,
    conservationWeights,
    strictlyConservative,
    persistent,
    bFair,
    bFairClasses,
    ...(unfairPair ? { unfairPair } : {}),
    unconditionallyFair,
    synchronic,
    synchronicNote,
  };
}
