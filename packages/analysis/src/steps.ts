// Step semantics of a P/T view: edges fire multisets of transitions at once. With maximal steps
// only, this is the "maximum concurrency" reachability graph of Charlie and Snoopy (as drawn in
// Konios 2015, Figs 7.41-7.42).

import { checkAbort, type PTNet } from "./ptnet";
import { MarkingStore } from "./statespace";
import { transitionSystemFromGraph, type TransitionSystem, type TransitionSystemOptions } from "./ts";

export interface StepSystemOptions extends TransitionSystemOptions {
  /** Only maximal steps label edges (default true); false gives every non-empty enabled step. */
  maximalOnly?: boolean;
  /** A transition may occur several times in one step when the marking allows it (default true). */
  autoConcurrency?: boolean;
  /** Most steps enumerated per state (default 10000); a state with more is left open. */
  maxStepsPerState?: number;
  /**
   * Most search nodes (multiplicity choices) tried per state while enumerating its steps
   * (default 1000000). The number of candidate combinations can grow exponentially even when few
   * steps are maximal; a state whose search hits this budget is left open.
   */
  maxSearchNodesPerState?: number;
}

/** An arc or net feature that step semantics does not support, with the reason. */
export interface StepSupportProblem {
  /** Id of the arc in the analysed net, when the problem is an arc. */
  arcId?: string;
  /** Readable form, e.g. "P1 → t2", or "net". */
  label: string;
  reason: string;
}

export interface StepSupport {
  ok: boolean;
  problems: StepSupportProblem[];
}

/** Why {@link stepSystem} stopped short, when it did. */
export interface StepStats {
  /** Search nodes visited over all states. */
  searchNodes: number;
  /** The state limit was reached; how many states were cut by the step limit and by the search-effort limit. */
  stopped: { states: boolean; steps: number; search: number };
}

const RESET_REASON =
  "reset arc: it empties the place, and in a step other transitions may consume from or add to the same place, so the result would depend on an order that a step does not have";
const DEPENDENT_REASON =
  "marking-dependent weight: every occurrence in a step would need the weight at the marking before the step, which this tool does not define for auto-concurrent occurrences";

/**
 * Whether {@link stepSystem} can build the step graph of a P/T view, and if not, every arc or
 * net feature in the way with the reason. Supported: normal, read, inhibitor and equal arcs of
 * constant weight (read, inhibitor and equal arcs are tests made at the marking before the step).
 * Not supported: reset arcs, marking-dependent weights, modulo nets and nets with errors.
 */
export function stepSemanticsSupport(pt: PTNet): StepSupport {
  const problems: StepSupportProblem[] = [];
  for (const e of pt.errors) problems.push({ label: "net", reason: `the net has errors: ${e}` });
  if (pt.modulus) problems.push({ label: "net", reason: "modulo nets keep every transition enabled, so steps are not defined" });
  for (const a of pt.arcs) {
    if (a.kind === "reset") problems.push({ arcId: a.arcId, label: a.label, reason: RESET_REASON });
    else if (a.weight === null) problems.push({ arcId: a.arcId, label: a.label, reason: DEPENDENT_REASON });
  }
  return { ok: problems.length === 0, problems };
}

/** One readable message for a net step semantics rejects, listing at most `max` problems. */
export function describeStepSupport(s: StepSupport, max = 4): string {
  if (s.ok) return "Step semantics is supported for this net.";
  const shown = s.problems.slice(0, max).map((p) => (p.label === "net" ? p.reason : `${p.label} is a ${p.reason}`));
  const more = s.problems.length > max ? ` (and ${s.problems.length - max} more)` : "";
  return `Maximal-step semantics is not available for this net: ${shown.join("; ")}${more}.`;
}

/**
 * The step reachability graph of a P/T view. A step U is enabled at M when M covers the input
 * weights of all its transitions together, every read, inhibitor and equal arc of a transition in
 * U holds at M (tests are made before the step), and the result respects the capacities. Throws
 * for nets that {@link stepSemanticsSupport} rejects. A transition without input places occurs at
 * most once per step.
 *
 * Each state's steps are enumerated by a depth-first search over multiplicities, bounded by
 * {@link StepSystemOptions.maxStepsPerState} (steps found) and
 * {@link StepSystemOptions.maxSearchNodesPerState} (search effort). A state that hits either is
 * left open, so the graph is incomplete and graph-wide verdicts become unknown. The result's notes
 * say which limit stopped it, and {@link stepStats} gives the counts.
 */
export function stepSystem(pt: PTNet, opts: StepSystemOptions = {}): TransitionSystem {
  const support = stepSemanticsSupport(pt);
  if (!support.ok) throw new Error(describeStepSupport(support));
  const maxStates = opts.maxStates ?? 100_000;
  const maxSteps = opts.maxStepsPerState ?? 10_000;
  const maxNodes = opts.maxSearchNodesPerState ?? 1_000_000;
  const maximalOnly = opts.maximalOnly ?? true;
  const auto = opts.autoConcurrency ?? true;
  const signal = opts.signal;

  const nP = pt.places.length;
  const nT = pt.transitions.length;
  const pre: [number, number][][] = Array.from({ length: nT }, () => []);
  const tests: { place: number; weight: number; kind: "read" | "inhibitor" | "equal" }[][] = Array.from({ length: nT }, () => []);
  const deltaMap: Map<number, number>[] = Array.from({ length: nT }, () => new Map());
  for (const a of pt.arcs) {
    const t = a.transition;
    const w = a.weight!;
    if (a.kind === "normal") {
      if (a.dir === "in") pre[t].push([a.place, w]);
      deltaMap[t].set(a.place, (deltaMap[t].get(a.place) ?? 0) + (a.dir === "in" ? -w : w));
    } else if (a.kind === "equal") tests[t].push({ place: a.place, weight: w, kind: "equal" });
    // As in the interleaving semantics: an inhibitor arc of weight 0 never blocks, a read arc of weight 0 always holds.
    else if (w > 0) tests[t].push({ place: a.place, weight: w, kind: a.kind as "read" | "inhibitor" });
  }
  const delta = deltaMap.map((m) => [...m].filter(([, d]) => d !== 0));
  const capOf = pt.capacity;
  const caps = capOf.flatMap((c, p) => (c === undefined ? [] : [[p, c] as const]));
  // One more occurrence of t can only break a capacity when t puts tokens on a capped place.
  const fillsCapped = delta.map((d) => d.some(([p, x]) => x > 0 && capOf[p] !== undefined));
  const testsHold = (t: number, M: ArrayLike<number>) =>
    tests[t].every((x) => (x.kind === "inhibitor" ? M[x.place] < x.weight : x.kind === "read" ? M[x.place] >= x.weight : M[x.place] === x.weight));

  const store = new MarkingStore(nP, Math.min(maxStates, 1 << 16));
  store.add(pt.m0);
  const markings = store.markings;
  const edges: { from: number; to: number; transitions: number[] }[] = [];
  const open = new Set<number>();
  let cutStates = false;
  let cutSteps = 0;
  let cutSearch = 0;
  let nodesTotal = 0;
  const lastUser = new Int32Array(nP);

  for (let s = 0; s < markings.length; s++) {
    if ((s & 255) === 0) checkAbort(signal);
    const M = markings[s];
    // Transitions whose tests hold at M and whose inputs M covers on their own.
    const cand: number[] = [];
    for (let t = 0; t < nT; t++) if (testsHold(t, M) && pre[t].every(([p, w]) => M[p] >= w)) cand.push(t);
    // lastUser[p]: the last candidate (by position) that consumes from p.
    lastUser.fill(-1);
    for (let i = 0; i < cand.length; i++) for (const [p] of pre[cand[i]]) lastUser[p] = i;
    // Fewer than the most occurrences of cand[i] can only end in a maximal step when a later
    // candidate competes for one of its inputs, or when more occurrences could break a capacity.
    const onlyMost = cand.map((t, i) => maximalOnly && !fillsCapped[t] && pre[t].every(([p]) => lastUser[p] === i));

    const R = new Int32Array(M); // tokens left after the inputs chosen so far
    const N = new Int32Array(M); // marking after the step chosen so far
    const count = new Int32Array(nT);
    let found = 0;
    let nodes = 0;
    let stop: "" | "steps" | "search" = "";
    const fitsN = () => {
      for (const [p, c] of caps) if (N[p] > c && N[p] > M[p]) return false;
      return true;
    };
    const apply = (t: number, k: number) => {
      for (const [p, d] of delta[t]) N[p] += d * k;
    };
    const canAdd = (t: number) => (auto || count[t] === 0) && !(pre[t].length === 0 && count[t] > 0) && pre[t].every(([p, w]) => R[p] >= w);
    const take = (t: number, k: 1 | -1) => {
      for (const [p, w] of pre[t]) R[p] -= w * k;
      count[t] += k;
      apply(t, k);
    };
    // Is some non-empty multiset of candidates addable to the current step, with the capacities
    // still respected? One more occurrence of a transition that fills no capped place always is.
    // Otherwise the search must look at whole extensions: the capacity condition is on the result,
    // so a step can be extended by {t, u} together (u makes room for t) but by neither alone.
    // Counts against the search budget; when the budget runs out it answers "yes", so nothing
    // unproven is emitted.
    const ext = (j: number): boolean => {
      for (let x = j; x < cand.length; x++) {
        const t = cand[x];
        if (!canAdd(t)) continue;
        if (++nodes > maxNodes) {
          stop = "search";
          return true;
        }
        take(t, 1);
        const ok = fitsN() || ext(x);
        take(t, -1);
        if (ok) return true;
      }
      return false;
    };
    const extendable = () => {
      for (const t of cand) if (canAdd(t) && !fillsCapped[t]) return true;
      return ext(0);
    };
    const emit = () => {
      if (!fitsN()) return;
      if (maximalOnly && extendable()) return;
      if (found >= maxSteps) {
        stop = "steps";
        return;
      }
      found++;
      let to = store.find(N);
      if (to < 0) {
        if (markings.length >= maxStates) {
          cutStates = true;
          open.add(s);
          return;
        }
        to = store.add(N);
      }
      const ts: number[] = [];
      for (let t = 0; t < nT; t++) for (let k = 0; k < count[t]; k++) ts.push(t);
      edges.push({ from: s, to, transitions: ts });
    };
    const rec = (i: number, any: boolean) => {
      if (stop) return;
      if (++nodes > maxNodes) {
        stop = "search";
        return;
      }
      if ((nodes & 4095) === 0) checkAbort(signal);
      if (i === cand.length) {
        if (any) emit();
        return;
      }
      const t = cand[i];
      let k = 0;
      for (; canAdd(t); k++) take(t, 1);
      // Largest multiplicity first, then fewer (only the largest when fewer cannot be maximal).
      const lowest = onlyMost[i] ? k : 0;
      for (; k >= lowest; k--) {
        rec(i + 1, any || k > 0);
        if (k > 0) take(t, -1);
      }
      // Remove the occurrences that the skipped branches would have removed.
      for (; k > 0; k--) take(t, -1);
    };
    rec(0, false);
    nodesTotal += nodes;
    if (stop) {
      open.add(s);
      if (stop === "steps") cutSteps++;
      else cutSearch++;
    }
  }
  const notes: string[] = [];
  if (cutSteps)
    notes.push(`${cutSteps} state${cutSteps === 1 ? " has" : "s have"} more than ${maxSteps} enabled steps (step limit); the rest were not explored.`);
  if (cutSearch)
    notes.push(
      `${cutSearch} state${cutSearch === 1 ? "" : "s"} needed more than ${maxNodes} search nodes to enumerate ${maximalOnly ? "maximal " : ""}steps (search-effort limit); their remaining steps were not explored.`,
    );
  if (cutStates) notes.push(`The step graph reached the limit of ${maxStates} states.`);
  const complete = !cutStates && !cutSteps && !cutSearch;
  if (!complete) notes.push("The step graph is incomplete; results that need the whole graph are reported as unknown.");
  const ts = transitionSystemFromGraph({
    places: pt.places,
    transitions: pt.transitions,
    markings,
    edges,
    semantics: "step",
    complete,
    ...(complete ? {} : { open: [...open] }),
    notes,
  });
  const stats: StepStats = { searchNodes: nodesTotal, stopped: { states: cutStates, steps: cutSteps, search: cutSearch } };
  STATS.set(ts, stats);
  return ts;
}

const STATS = new WeakMap<TransitionSystem, StepStats>();

/** Search statistics of a step graph built by {@link stepSystem}: effort spent and which limits stopped it. */
export function stepStats(ts: TransitionSystem): StepStats | undefined {
  return STATS.get(ts);
}
