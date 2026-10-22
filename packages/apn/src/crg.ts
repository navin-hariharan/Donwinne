// Step transition systems and the concurrent reachability graph CRG(N) (Konios Def. 5, eq. 3.1).
//
// CRG(N) = ([M0⟩, Δ, M0): the markings reachable from M0 by step sequences, and an arc
// (M, U, M') for every enabled step U with M[U⟩M'. The same construction serves T-APNs (Sec. 5.3).

import { Marking, Net, markingKey } from "@pns/core";
import { AmbientNet, ambientErrors, ambientInitialMarking, asAmbient, markingPairs, markingRecord } from "./semantics";
import { CapacityRule, Step, enabledSteps, fireStep, showStep, stepKey } from "./steps";

/**
 * A step transition system STS = (Q, Δ, q0) (Def. 5) in a plain shape other tools can consume:
 * states by index, edges labelled with steps, and the index of the initial state.
 */
export interface StepTransitionSystem<S = Marking> {
  states: S[];
  edges: { from: number; to: number; step: Step }[];
  initial: number;
}

export interface CrgOptions {
  /** Stop after this many states (default 10 000). */
  maxStates?: number;
  /** Stop after this many edges (default 100 000). */
  maxEdges?: number;
  /** Abort the construction; the result is then incomplete with reason "aborted". */
  signal?: AbortSignal;
  /** Only maximal steps label the edges (a smaller graph; not CRG(N) itself). Default false. */
  maximalOnly?: boolean;
  /** Limits for the step enumeration in each state (see enabledSteps). */
  maxStepsPerState?: number;
  maxStepSize?: number;
  capacityRule?: CapacityRule;
  /** Start from this marking instead of M0. */
  initial?: Marking;
  /** Async version only: yield to the event loop after this many states (default 200). */
  yieldEvery?: number;
  /** Called now and then with the number of states and edges found so far. */
  onProgress?: (states: number, edges: number) => void;
}

export interface Crg extends StepTransitionSystem<Marking> {
  /** Canonical key of each state's marking (markingKey). */
  keys: string[];
  /** States known to have no enabled step (dead states). A state that was not fully explored is never listed here. */
  deadlocks: number[];
  /**
   * States whose successors may not all be listed, because a limit or the signal stopped the
   * construction before or while they were expanded. Empty when the graph is complete.
   */
  open: number[];
  /** False when a limit or the abort signal stopped the construction early. */
  complete: boolean;
  /** Why the graph is incomplete: a limit, the step enumeration limit, or the signal. */
  reason?: "states" | "edges" | "steps" | "aborted";
}

class Builder {
  an: AmbientNet;
  crg: Crg;
  index = new Map<string, number>();
  next = 0;
  maxStates: number;
  maxEdges: number;
  constructor(
    net: Net | AmbientNet,
    private opts: CrgOptions,
  ) {
    this.an = asAmbient(net);
    const errs = ambientErrors(this.an);
    if (errs.length) throw new Error(errs[0].message);
    const M0 = opts.initial ?? ambientInitialMarking(this.an);
    this.crg = { states: [M0], edges: [], initial: 0, keys: [markingKey(M0)], deadlocks: [], open: [], complete: true };
    this.index.set(this.crg.keys[0], 0);
    this.maxStates = opts.maxStates ?? 10_000;
    this.maxEdges = opts.maxEdges ?? 100_000;
  }
  stop(reason: Crg["reason"]) {
    this.crg.complete = false;
    this.crg.reason ??= reason;
  }
  /** Mark every state not yet expanded as open; call once the construction has ended. */
  finish(): Crg {
    if (!this.crg.complete) for (let s = this.next; s < this.crg.states.length; s++) this.crg.open.push(s);
    return this.crg;
  }
  /** Expand one state; false when done or stopped. */
  step(): boolean {
    const { crg, opts } = this;
    if (this.next >= crg.states.length) return false;
    if (opts.signal?.aborted) {
      this.stop("aborted");
      return false;
    }
    const i = this.next++;
    const M = crg.states[i];
    const r = enabledSteps(this.an, M, {
      maximalOnly: opts.maximalOnly,
      maxSteps: opts.maxStepsPerState,
      maxStepSize: opts.maxStepSize,
      capacityRule: opts.capacityRule,
    });
    let partial = r.truncated;
    if (r.truncated) this.stop("steps");
    // Only a fully enumerated state without steps is dead; a cut-off enumeration proves nothing.
    else if (!r.steps.length) crg.deadlocks.push(i);
    for (const U of r.steps) {
      const M2 = fireStep(this.an, M, U, { capacityRule: opts.capacityRule });
      const key = markingKey(M2);
      let to = this.index.get(key);
      if (to === undefined) {
        if (crg.states.length >= this.maxStates) {
          this.stop("states");
          partial = true;
          continue;
        }
        to = crg.states.length;
        this.index.set(key, to);
        crg.states.push(M2);
        crg.keys.push(key);
      }
      if (crg.edges.length >= this.maxEdges) {
        this.stop("edges");
        crg.open.push(i);
        return false;
      }
      crg.edges.push({ from: i, to, step: U });
    }
    if (partial) crg.open.push(i);
    return true;
  }
}

/**
 * The concurrent reachability graph CRG(N) of an APN or T-APN (Def. 5, eq. 3.1), built breadth
 * first from M0. Every non-empty enabled step labels an edge, so concurrent firings appear next to
 * their interleavings, as in Figs 6.5 and 6.6. Throws if the net has errors.
 */
export function concurrentReachabilityGraph(net: Net | AmbientNet, opts: CrgOptions = {}): Crg {
  const b = new Builder(net, opts);
  let n = 0;
  while (b.step()) if (opts.onProgress && ++n % 100 === 0) opts.onProgress(b.crg.states.length, b.crg.edges.length);
  return b.finish();
}

/**
 * As concurrentReachabilityGraph, but yields to the event loop every `yieldEvery` states so that a
 * user interface stays responsive and can abort through `signal`.
 */
export async function concurrentReachabilityGraphAsync(net: Net | AmbientNet, opts: CrgOptions = {}): Promise<Crg> {
  const b = new Builder(net, opts);
  const every = opts.yieldEvery ?? 200;
  let n = 0;
  while (b.step()) {
    if (++n % every === 0) {
      opts.onProgress?.(b.crg.states.length, b.crg.edges.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return b.finish();
}

/** Short name of the CRG: crg(net) is concurrentReachabilityGraph(net). */
export const crg = concurrentReachabilityGraph;

/** A CRG with readable states and labels, for display: markings as (p, c) pairs and steps as text. */
export interface CrgView {
  states: { id: number; label: string; pairs: string[]; marking: Record<string, string>; dead: boolean; initial: boolean }[];
  edges: { from: number; to: number; label: string; size: number }[];
  complete: boolean;
  reason?: Crg["reason"];
}

/** Readable form of a CRG: state Mi lists its structured places; edges carry the step, e.g. "{(t3,b),(t4,b)}". */
export function crgView(net: Net | AmbientNet, g: Crg): CrgView {
  const an = asAmbient(net);
  const dead = new Set(g.deadlocks);
  return {
    states: g.states.map((M, i) => ({
      id: i,
      label: `M${i}`,
      pairs: markingPairs(an, M),
      marking: markingRecord(an, M),
      dead: dead.has(i),
      initial: i === g.initial,
    })),
    edges: g.edges.map((e) => ({ from: e.from, to: e.to, label: showStep(an, e.step), size: e.step.length })),
    complete: g.complete,
    reason: g.reason,
  };
}

/** Is the step sequence U1 … Un firable from M0 (M0[U1 … Un⟩)? Returns the markings passed, or the index of the first step that is not enabled. */
export function runStepSequence(
  net: Net | AmbientNet,
  steps: Step[],
  opts: { initial?: Marking; capacityRule?: CapacityRule } = {},
): { ok: true; markings: Marking[] } | { ok: false; failedAt: number; markings: Marking[] } {
  const an = asAmbient(net);
  const markings = [opts.initial ?? ambientInitialMarking(an)];
  for (let i = 0; i < steps.length; i++) {
    const M = markings[markings.length - 1];
    try {
      markings.push(fireStep(an, M, steps[i], { capacityRule: opts.capacityRule }));
    } catch {
      return { ok: false, failedAt: i, markings };
    }
  }
  return { ok: true, markings };
}

/** Edge lookup helper: the successor of state i under step U, or undefined. */
export function successor(g: StepTransitionSystem, from: number, step: Step): number | undefined {
  const k = stepKey(step);
  return g.edges.find((e) => e.from === from && stepKey(e.step) === k)?.to;
}
