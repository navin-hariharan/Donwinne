// Step semantics of a P/T view: edges fire multisets of transitions at once. With maximal steps
// only, this is the "maximum concurrency" reachability graph of Charlie and Snoopy (as drawn in
// Konios 2015, Figs 7.41-7.42).

import { checkAbort, type PTNet } from "./ptnet";
import { transitionSystemFromGraph, type TransitionSystem, type TransitionSystemOptions } from "./ts";

export interface StepSystemOptions extends TransitionSystemOptions {
  /** Only maximal steps label edges (default true); false gives every non-empty enabled step. */
  maximalOnly?: boolean;
  /** A transition may occur several times in one step when the marking allows it (default true). */
  autoConcurrency?: boolean;
  /** Most steps enumerated per state (default 10000); a state with more is left open. */
  maxStepsPerState?: number;
}

/**
 * The step reachability graph of a P/T view. A step U is enabled at M when M covers the input
 * weights of all its transitions together, every read and inhibitor arc of a transition in U is
 * satisfied at M (tests are made before the step), and the result respects the capacities. Supports
 * normal, read and inhibitor arcs of constant weight; throws for reset, equal and marking-dependent
 * arcs, and for nets with errors. A transition without input places occurs at most once per step.
 */
export function stepSystem(pt: PTNet, opts: StepSystemOptions = {}): TransitionSystem {
  if (pt.errors.length) throw new Error(`The net has errors: ${pt.errors[0]}`);
  if (pt.modulus) throw new Error("Step semantics is not defined for modulo nets.");
  const maxStates = opts.maxStates ?? 100_000;
  const maxSteps = opts.maxStepsPerState ?? 10_000;
  const maximalOnly = opts.maximalOnly ?? true;
  const auto = opts.autoConcurrency ?? true;

  const nT = pt.transitions.length;
  const pre: [number, number][][] = Array.from({ length: nT }, () => []);
  const tests: { place: number; weight: number; inhibitor: boolean }[][] = Array.from({ length: nT }, () => []);
  const delta: Map<number, number>[] = Array.from({ length: nT }, () => new Map());
  for (const a of pt.arcs) {
    if (a.weight === null) throw new Error(`Arc ${a.label} has a marking-dependent weight, which step semantics here does not support.`);
    if (a.kind === "reset" || a.kind === "equal") throw new Error(`Arc ${a.label} is a ${a.kind} arc, which step semantics here does not support.`);
    const t = a.transition;
    if (a.kind === "normal") {
      if (a.dir === "in") pre[t].push([a.place, a.weight]);
      delta[t].set(a.place, (delta[t].get(a.place) ?? 0) + (a.dir === "in" ? -a.weight : a.weight));
    } else if (a.weight > 0) tests[t].push({ place: a.place, weight: a.weight, inhibitor: a.kind === "inhibitor" });
  }
  const caps = pt.capacity.flatMap((c, p) => (c === undefined ? [] : [[p, c] as const]));

  const markings: Int32Array[] = [Int32Array.from(pt.m0)];
  const index = new Map<string, number>([[markings[0].join(","), 0]]);
  const edges: { from: number; to: number; transitions: number[] }[] = [];
  const open: number[] = [];
  let cut = false;
  const notes: string[] = [];

  for (let s = 0; s < markings.length; s++) {
    if ((s & 255) === 0) checkAbort(opts.signal);
    const M = markings[s];
    // Transitions whose tests hold at M and whose inputs M covers on their own.
    const cand: number[] = [];
    for (let t = 0; t < nT; t++) {
      if (!tests[t].every((x) => (x.inhibitor ? M[x.place] < x.weight : M[x.place] >= x.weight))) continue;
      if (pre[t].every(([p, w]) => M[p] >= w)) cand.push(t);
    }
    const R = new Int32Array(M);
    const count = new Int32Array(nT);
    let found = 0;
    let truncated = false;
    const after = () => {
      const N = new Int32Array(M);
      for (let t = 0; t < nT; t++) if (count[t]) for (const [p, d] of delta[t]) N[p] += d * count[t];
      return N;
    };
    const fits = (N: Int32Array) => caps.every(([p, c]) => N[p] <= c || N[p] <= M[p]);
    const canAdd = (t: number) => (auto || count[t] === 0) && !(pre[t].length === 0 && count[t] > 0) && pre[t].every(([p, w]) => R[p] >= w);
    const emit = () => {
      const N = after();
      if (!fits(N)) return;
      if (maximalOnly) {
        for (const t of cand)
          if (canAdd(t)) {
            count[t]++;
            const bigger = fits(after());
            count[t]--;
            if (bigger) return;
          }
      }
      if (found >= maxSteps) {
        truncated = true;
        return;
      }
      found++;
      const key = N.join(",");
      let to = index.get(key);
      if (to === undefined) {
        if (markings.length >= maxStates) {
          cut = true;
          if (!open.includes(s)) open.push(s);
          return;
        }
        to = markings.length;
        markings.push(N);
        index.set(key, to);
      }
      const ts: number[] = [];
      for (let t = 0; t < nT; t++) for (let k = 0; k < count[t]; k++) ts.push(t);
      edges.push({ from: s, to, transitions: ts });
    };
    const rec = (i: number, any: boolean) => {
      if (truncated) return;
      if (i === cand.length) {
        if (any) emit();
        return;
      }
      const t = cand[i];
      let k = 0;
      while (canAdd(t)) {
        for (const [p, w] of pre[t]) R[p] -= w;
        count[t]++;
        k++;
      }
      // Largest multiplicity first, then fewer.
      for (; k >= 0; k--) {
        rec(i + 1, any || k > 0);
        if (k > 0) {
          for (const [p, w] of pre[t]) R[p] += w;
          count[t]--;
        }
      }
    };
    rec(0, false);
    if (truncated) {
      cut = true;
      if (!open.includes(s)) open.push(s);
      notes.push(`State ${s} has more than ${maxSteps} enabled steps; the rest were not explored.`);
    }
  }
  if (cut) notes.push(`The step graph is incomplete (limit ${maxStates} states); results that need the whole graph are reported as unknown.`);
  return transitionSystemFromGraph({
    places: pt.places,
    transitions: pt.transitions,
    markings,
    edges,
    semantics: "step",
    complete: !cut,
    ...(cut ? { open: open.length ? open : undefined } : {}),
    notes,
  });
}
