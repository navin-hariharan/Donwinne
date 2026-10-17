// Path analysis (Konios 2015, §7.3.2): firing sequences from the initial marking to a target
// state, with transitions required or forbidden on the way, and the cost of ignoring advice.

import { CtlChecker, type CtlOptions, type TraceStep } from "./check";
import { bindCtl, parseCtl, resolveTransition, type CtlFormula } from "./ctl";
import { checkAbort } from "./ptnet";
import { labelText, markingOf, openStates, type TransitionSystem } from "./ts";
import type { NodeRef } from "./types";

export interface PathQuery {
  /**
   * The target: a formula whose satisfying states end the path, e.g. Charlie's filter
   * `Left_p1_1 * A1 * Park_A1_1` (places marked) or `p1 == 2 & done > 0`. Temporal operators are
   * allowed too (the path then ends in a state where the whole formula holds).
   */
  target: string | CtlFormula;
  /** Transitions that must each fire at least once. A coloured transition's name stands for any of its bindings. */
  require?: string[];
  /** At least one of these transitions must fire. */
  requireAny?: string[];
  /** Transitions that must not fire. */
  forbid?: string[];
  /**
   * "shortest" (default): one shortest path. "all": every path, shortest first, up to `limit`
   * paths and `maxLength` firings; a path never repeats a state with the same requirements met
   * and stops at the first target state where all requirements are met.
   */
  mode?: "shortest" | "all";
  /** Most paths to return in "all" mode (default 20). */
  limit?: number;
  /** Longest path in "all" mode (default: the shortest length plus 8). */
  maxLength?: number;
  /** Deadlock reading for temporal operators in the target. */
  deadlocks?: CtlOptions["deadlocks"];
  signal?: AbortSignal;
}

/** A firing (or step) sequence from the initial state. */
export interface FiringPath {
  /** Number of firings (steps). */
  length: number;
  /** Visited states, from the initial state 0 to the target state. */
  states: number[];
  steps: TraceStep[];
  /** Marked places of each visited state. */
  markings: Record<string, number>[];
  /** Parikh vector: how often each transition fires, by name. */
  parikh: Record<string, number>;
  /** States the path visits more than once. */
  repeatedStates: number[];
  /**
   * Places the path enters more than once (their token count rises at two or more firings): the
   * thesis's "the user visits place p1 twice", the sign of a loop.
   */
  reenteredPlaces: { place: NodeRef; times: number }[];
}

export interface PathResult {
  found: boolean;
  /** Shortest first. */
  paths: FiringPath[];
  /** Length of a shortest path, when one exists. */
  shortestLength?: number;
  /** "all" mode stopped at `limit`, `maxLength` or its work budget: more paths may exist. */
  truncated: boolean;
  /**
   * The answer holds for the whole state space: always on a complete one. On an incomplete one, a
   * shortest path is conclusive when no shorter path can leave the explored part (no open state
   * lies close enough to the start), and "no path" when the search never met an open state.
   */
  conclusive: boolean;
  notes: string[];
}

function transitionSet(ts: TransitionSystem, names: string[] | undefined, what: string): number[][] {
  return (names ?? []).map((n) => {
    const r = resolveTransition(ts, n);
    if (!r) throw new Error(`Unknown transition "${n}" in the ${what} list.`);
    return r;
  });
}

/** Build a path record from states and edge indices. */
export function firingPath(ts: TransitionSystem, states: number[], edges: number[]): FiringPath {
  const steps: TraceStep[] = edges.map((e, i) => ({
    from: states[i],
    to: states[i + 1],
    transitions: ts.labels[ts.edgeLabel[e]].map((t) => ts.transitions[t]),
    label: labelText(ts, ts.edgeLabel[e]),
  }));
  const parikh: Record<string, number> = {};
  for (const e of edges) for (const t of ts.labels[ts.edgeLabel[e]]) parikh[ts.transitions[t].name] = (parikh[ts.transitions[t].name] ?? 0) + 1;
  const seen = new Map<number, number>();
  for (const s of states) seen.set(s, (seen.get(s) ?? 0) + 1);
  const entries = new Array<number>(ts.places.length).fill(0);
  for (let i = 1; i < states.length; i++) {
    const a = ts.markings[states[i - 1]];
    const b = ts.markings[states[i]];
    for (let p = 0; p < ts.places.length; p++) if (b[p] > a[p]) entries[p]++;
  }
  return {
    length: edges.length,
    states,
    steps,
    markings: states.map((s) => markingOf(ts, s)),
    parikh,
    repeatedStates: [...seen].filter(([, c]) => c > 1).map(([s]) => s),
    reenteredPlaces: entries.flatMap((c, p) => (c > 1 ? [{ place: ts.places[p], times: c }] : [])),
  };
}

/**
 * Firing sequences from the initial state to a state satisfying `query.target`, honouring
 * required and forbidden transitions. Throws a CtlError for a bad target formula and an Error for
 * an unknown transition name.
 */
export function findPaths(ts: TransitionSystem, query: PathQuery): PathResult {
  const text = typeof query.target === "string" ? query.target : "";
  const f = typeof query.target === "string" ? parseCtl(query.target) : query.target;
  const checker = new CtlChecker(ts, { deadlocks: query.deadlocks, signal: query.signal, trace: false });
  const bound = checker.bounds(bindCtl(f, ts, text));
  const goal = bound.lo;
  const open = openStates(ts);
  /** Incomplete systems: 1 = open (successors may be missing), 2 = may be a target state, 3 = both. */
  let unsure: Uint8Array | undefined;
  if (open) {
    unsure = new Uint8Array(ts.markings.length);
    for (let s = 0; s < unsure.length; s++) unsure[s] = open[s] | ((bound.hi[s] & (1 - bound.lo[s])) << 1);
  }
  const req = transitionSet(ts, query.require, "required");
  const any = transitionSet(ts, query.requireAny, "required (any)").flat();
  const forbidden = new Set(transitionSet(ts, query.forbid, "forbidden").flat());
  if (req.length > 16) throw new Error("At most 16 required transitions are supported.");
  const notes: string[] = [...ts.notes];
  const bits = req.length + (any.length ? 1 : 0);
  const full = (1 << bits) - 1;
  // Per label: allowed, and the requirement bits it sets.
  const labelBits = ts.labels.map((l) => {
    let m = 0;
    req.forEach((g, i) => {
      if (l.some((t) => g.includes(t))) m |= 1 << i;
    });
    if (any.length && l.some((t) => any.includes(t))) m |= 1 << req.length;
    return m;
  });
  const labelOk = ts.labels.map((l) => !l.some((t) => forbidden.has(t)));
  const n = ts.markings.length;
  const W = 1 << bits;
  const key = (s: number, m: number) => s * W + m;
  if (!n) return { found: false, paths: [], truncated: false, conclusive: true, notes };

  // ---- Shortest path: breadth-first search over (state, requirements met).
  const start = 0;
  const parent = new Map<number, number>([[key(0, start), -1]]);
  const parentEdge = new Map<number, number>();
  const queue = [key(0, start)];
  const depth = [0];
  // Smallest depth of a visited open state, and of a visited state that may be a target.
  let openDepth = Infinity;
  let targetDepth = Infinity;
  const note = (w: number, d: number) => {
    const u = unsure?.[w] ?? 0;
    if (u & 1 && d < openDepth) openDepth = d;
    if (u & 2 && d < targetDepth) targetDepth = d;
  };
  note(0, 0);
  let hit = goal[0] && start === full ? key(0, start) : -1;
  for (let h = 0; h < queue.length && hit < 0; h++) {
    if ((h & 4095) === 0) checkAbort(query.signal);
    const k = queue[h];
    const s = Math.floor(k / W);
    const m = k % W;
    const d = depth[h];
    for (let e = ts.edgeStart[s]; e < ts.edgeStart[s + 1]; e++) {
      const l = ts.edgeLabel[e];
      if (!labelOk[l]) continue;
      const w = ts.edgeTo[e];
      const m2 = m | labelBits[l];
      const k2 = key(w, m2);
      if (parent.has(k2)) continue;
      parent.set(k2, k);
      parentEdge.set(k2, e);
      if (goal[w] && m2 === full) {
        hit = k2;
        break;
      }
      note(w, d + 1);
      queue.push(k2);
      depth.push(d + 1);
    }
  }
  if (hit < 0) {
    const conclusive = openDepth === Infinity && targetDepth === Infinity;
    if (!conclusive) notes.push("The state space is incomplete: a path may exist beyond the explored part.");
    return { found: false, paths: [], truncated: !ts.complete, conclusive, notes };
  }
  const states: number[] = [];
  const edges: number[] = [];
  for (let k = hit; k !== -1; k = parent.get(k)!) {
    states.push(Math.floor(k / W));
    const e = parentEdge.get(k);
    if (e !== undefined) edges.push(e);
  }
  states.reverse();
  edges.reverse();
  const shortest = firingPath(ts, states, edges);
  // A shorter path would leave the explored part from an open state at most length - 2 steps away,
  // or end in a state whose target status is unsure, less than length steps away.
  const conclusive = openDepth >= shortest.length - 1 && targetDepth >= shortest.length;
  if (!conclusive) notes.push(`The state space is incomplete: a path shorter than ${shortest.length} firings may exist beyond the explored part.`);
  if ((query.mode ?? "shortest") === "shortest") return { found: true, paths: [shortest], shortestLength: shortest.length, truncated: false, conclusive, notes };

  // ---- All paths, shortest first, by iterative deepening with a distance bound.
  const limit = query.limit ?? 20;
  const maxLength = query.maxLength ?? shortest.length + 8;
  // Lower bound: distance to a goal state ignoring requirements (backward search over allowed edges).
  const dist = new Int32Array(n).fill(-1);
  {
    const preds: number[][] = Array.from({ length: n }, () => []);
    for (let s = 0; s < n; s++) for (let e = ts.edgeStart[s]; e < ts.edgeStart[s + 1]; e++) if (labelOk[ts.edgeLabel[e]]) preds[ts.edgeTo[e]].push(s);
    const q: number[] = [];
    for (let s = 0; s < n; s++)
      if (goal[s]) {
        dist[s] = 0;
        q.push(s);
      }
    for (let h = 0; h < q.length; h++) for (const u of preds[q[h]]) if (dist[u] < 0) { dist[u] = dist[q[h]] + 1; q.push(u); }
  }
  const out: FiringPath[] = [];
  let budget = 2_000_000;
  let truncated = false;
  const onPath = new Set<number>();
  const pathStates: number[] = [0];
  const pathEdges: number[] = [];
  const dfs = (s: number, m: number, depth: number, L: number): boolean => {
    if (--budget < 0) {
      truncated = true;
      return true;
    }
    if ((budget & 4095) === 0) checkAbort(query.signal);
    if (goal[s] && m === full) {
      if (depth === L) {
        out.push(firingPath(ts, pathStates.slice(), pathEdges.slice()));
        if (out.length >= limit) {
          truncated = true;
          return true;
        }
      }
      return false;
    }
    if (depth >= L) return false;
    for (let e = ts.edgeStart[s]; e < ts.edgeStart[s + 1]; e++) {
      const l = ts.edgeLabel[e];
      if (!labelOk[l]) continue;
      const w = ts.edgeTo[e];
      if (dist[w] < 0 || depth + 1 + dist[w] > L) continue;
      const m2 = m | labelBits[l];
      const k2 = key(w, m2);
      if (onPath.has(k2)) continue;
      onPath.add(k2);
      pathStates.push(w);
      pathEdges.push(e);
      const stop = dfs(w, m2, depth + 1, L);
      pathStates.pop();
      pathEdges.pop();
      onPath.delete(k2);
      if (stop) return true;
    }
    return false;
  };
  for (let L = shortest.length; L <= maxLength; L++) {
    onPath.clear();
    onPath.add(key(0, start));
    if (dfs(0, start, 0, L)) break;
  }
  if (!truncated && maxLength >= shortest.length) notes.push(`Paths longer than ${maxLength} firings were not searched.`);
  return { found: true, paths: out, shortestLength: shortest.length, truncated, conclusive: conclusive && ts.complete, notes };
}

export interface AdviceQuery {
  /** The user's goal, as a target formula. */
  goal: string | CtlFormula;
  /** Transitions by which a user ignores an advice (moves other than the advised one). */
  ignoring: string[];
  deadlocks?: CtlOptions["deadlocks"];
  signal?: AbortSignal;
}

export interface AdviceComparison {
  /** Shortest path to the goal that never ignores an advice (§7.3.2.1). */
  following: PathResult;
  /** Shortest path to the goal that ignores at least one advice (§7.3.2.2). */
  ignoring: PathResult;
  /** How many more firings ignoring an advice costs (when both paths exist). */
  extraFirings?: number;
  /** The ignoring path loops: it re-enters a place or repeats a state. */
  ignoringLoops?: boolean;
  /** One line per finding. */
  summary: string[];
}

/**
 * Compare reaching a goal by following advices with reaching it after ignoring one (Konios 2015,
 * §7.3.2): the thesis expects following to give the shortest path and ignoring to force a loop.
 */
export function compareAdvicePaths(ts: TransitionSystem, q: AdviceQuery): AdviceComparison {
  const base = { target: q.goal, deadlocks: q.deadlocks, signal: q.signal };
  const following = findPaths(ts, { ...base, forbid: q.ignoring });
  const ignoring = findPaths(ts, { ...base, requireAny: q.ignoring });
  const summary: string[] = [];
  const f = following.paths[0];
  const i = ignoring.paths[0];
  summary.push(f ? `Following the advices, the goal is reached in ${f.length} firings: ${f.steps.map((s) => s.label).join(" ")}.` : "The goal cannot be reached by following the advices.");
  summary.push(i ? `Ignoring an advice, the goal is reached in ${i.length} firings: ${i.steps.map((s) => s.label).join(" ")}.` : "The goal cannot be reached after ignoring an advice.");
  const r: AdviceComparison = { following, ignoring, summary };
  if (f && i) {
    r.extraFirings = i.length - f.length;
    r.ignoringLoops = i.reenteredPlaces.length > 0 || i.repeatedStates.length > 0;
    summary.push(
      `Ignoring costs ${r.extraFirings} extra firing${Math.abs(r.extraFirings) === 1 ? "" : "s"}${r.ignoringLoops ? `; the user loops (re-enters ${i.reenteredPlaces.map((p) => p.place.name).join(", ") || "a state"})` : ""}.`,
    );
  }
  return r;
}
