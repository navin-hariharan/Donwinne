// Behavioural equivalence of an APN and its T-APN (Konios Sec. 6.6): CRG(N) and CRG(φ(N)) are
// isomorphic (Def. 22): there is a bijection ψ between their states with ψ(M0) = M'0 and
// (q1, U, q2) ∈ Δ ⇔ (ψ(q1), U, ψ(q2)) ∈ Δ' for every step U over the shared transitions T' = T.
//
// Both graphs are deterministic (a step leads from a marking to exactly one marking) and contain
// only reachable states, so ψ is forced: it must map the state reached by a step sequence in one
// graph to the state reached by the same sequence in the other. The check explores both nets in
// lock step and fails as soon as (a) a step is enabled in one and not in the other, or (b) two step
// sequences reach the same state in one graph but different states in the other. Either gives a
// counterexample step sequence.

import { Marking, Net, markingKey } from "@pns/core";
import { ConstructOptions, ConstructionResult, constructTapn } from "./construction";
import { StepTransitionSystem } from "./crg";
import { AmbientNet, ambientErrors, ambientInitialMarking, asAmbient, markingPairs } from "./semantics";
import { CapacityRule, Step, enabledSteps, fireStep, showStep, stepKey } from "./steps";

export interface EquivalenceOptions {
  /** The T-APN to compare with; default: constructTapn(apn). */
  tapn?: Net;
  /** Options for the construction when no T-APN is given. */
  construct?: ConstructOptions;
  /** T-APN transition id -> APN transition id; default: the same id, else the same name. */
  transitionMap?: Record<string, string>;
  /** Stop after this many state pairs (default 20 000); the verdict is then "unknown" unless a counterexample was found. */
  maxStates?: number;
  /** Stop after this many edges per graph (default 500 000). */
  maxEdges?: number;
  /** Per-state limit on enumerated steps (default 10 000). */
  maxStepsPerState?: number;
  signal?: AbortSignal;
  capacityRule?: CapacityRule;
}

/** Why the CRGs are not isomorphic, with the step sequence that shows it. */
export interface Counterexample {
  /**
   * stepOnlyInApn / stepOnlyInTapn: after `steps`, `step` is enabled in one net only.
   * stateMismatch: `steps` and `other` lead to the same state in one net but to different states in
   * the other, so no bijection ψ exists.
   */
  kind: "stepOnlyInApn" | "stepOnlyInTapn" | "stateMismatch";
  /** The step sequence U1 … Un from the initial markings (labels over the APN's transitions). */
  steps: Step[];
  /** The step enabled in one net only (stepOnly…). */
  step?: Step;
  /** stateMismatch: the second step sequence. */
  other?: Step[];
  /** The markings reached by `steps`, as (p, c) pairs. */
  apnMarking: string[];
  tapnMarking: string[];
  /** One-line explanation in the thesis's notation. */
  explanation: string;
}

export interface EquivalenceResult {
  /** "equivalent": the CRGs are isomorphic; "not equivalent": see counterexample; "unknown": a limit was hit first. */
  verdict: "equivalent" | "not equivalent" | "unknown";
  /** Shorthand for verdict === "equivalent". */
  equivalent: boolean;
  counterexample?: Counterexample;
  /** Number of matched state pairs and edges explored. */
  states: number;
  edges: number;
  /** Why the exploration stopped early, if it did. */
  reason?: "states" | "edges" | "steps" | "aborted";
  /** The T-APN compared with (the constructed one unless given). */
  tapn: Net;
  /** The construction, when the T-APN was constructed here. */
  construction?: ConstructionResult;
}

/** One side of a lock-step comparison. */
interface Side<S> {
  initial: S;
  key(s: S): string;
  /** Enabled steps, already relabelled into the common alphabet; truncated if a limit was hit. */
  steps(s: S): { steps: Step[]; truncated: boolean };
  /** Successor under a step in the common alphabet. */
  fire(s: S, step: Step): S;
  pairs(s: S): string[];
}

interface LockStepResult {
  isomorphic: boolean | undefined;
  counterexample?: Omit<Counterexample, "explanation"> & { show: (u: Step) => string };
  states: number;
  edges: number;
  reason?: EquivalenceResult["reason"];
}

function lockStep<A, B>(a: Side<A>, b: Side<B>, show: (u: Step) => string, limits: { maxStates: number; maxEdges: number; signal?: AbortSignal }): LockStepResult {
  type Node = { sa: A; sb: B; ka: string; kb: string; parent: number; via?: Step };
  const nodes: Node[] = [{ sa: a.initial, sb: b.initial, ka: a.key(a.initial), kb: b.key(b.initial), parent: -1 }];
  const byA = new Map<string, number>([[nodes[0].ka, 0]]);
  const byB = new Map<string, number>([[nodes[0].kb, 0]]);
  let edges = 0;
  let reason: LockStepResult["reason"];
  const path = (i: number): Step[] => {
    const out: Step[] = [];
    for (let n = nodes[i]; n.parent >= 0; n = nodes[n.parent]) out.unshift(n.via!);
    return out;
  };
  for (let i = 0; i < nodes.length; i++) {
    if (limits.signal?.aborted) {
      reason = "aborted";
      break;
    }
    const n = nodes[i];
    const ra = a.steps(n.sa);
    const rb = b.steps(n.sb);
    if (ra.truncated || rb.truncated) reason ??= "steps";
    const ka = new Map(ra.steps.map((u) => [stepKey(u), u]));
    const kb = new Map(rb.steps.map((u) => [stepKey(u), u]));
    // The smallest step enabled on one side only, if any.
    const onlyA = rb.truncated ? [] : [...ka].filter(([k]) => !kb.has(k)).map(([, u]) => u);
    const onlyB = ra.truncated ? [] : [...kb].filter(([k]) => !ka.has(k)).map(([, u]) => u);
    const diff = [...onlyA.map((u) => ["stepOnlyInApn", u] as const), ...onlyB.map((u) => ["stepOnlyInTapn", u] as const)].sort((x, y) => x[1].length - y[1].length)[0];
    if (diff)
      return { isomorphic: false, counterexample: { kind: diff[0], steps: path(i), step: diff[1], apnMarking: a.pairs(n.sa), tapnMarking: b.pairs(n.sb), show }, states: nodes.length, edges };
    for (const [k, u] of ka) {
      if (!kb.has(k)) continue;
      if (++edges > limits.maxEdges) {
        reason ??= "edges";
        return { isomorphic: undefined, states: nodes.length, edges: edges - 1, reason };
      }
      const sa = a.fire(n.sa, u);
      const sb = b.fire(n.sb, kb.get(k)!);
      const xa = a.key(sa);
      const xb = b.key(sb);
      const ia = byA.get(xa);
      const ib = byB.get(xb);
      if (ia !== undefined || ib !== undefined) {
        if (ia === ib) continue;
        // One side has met this state before by another sequence and the other side has not (or met a different one).
        const j = (ia ?? ib)!;
        return {
          isomorphic: false,
          counterexample: { kind: "stateMismatch", steps: [...path(i), u], other: path(j), apnMarking: a.pairs(sa), tapnMarking: b.pairs(sb), show },
          states: nodes.length,
          edges,
        };
      }
      if (nodes.length >= limits.maxStates) {
        reason ??= "states";
        continue;
      }
      byA.set(xa, nodes.length);
      byB.set(xb, nodes.length);
      nodes.push({ sa, sb, ka: xa, kb: xb, parent: i, via: u });
    }
  }
  return { isomorphic: reason ? undefined : true, states: nodes.length, edges, reason };
}

function explain(c: NonNullable<LockStepResult["counterexample"]>): Counterexample {
  const seq = (s: Step[]) => (s.length ? s.map(c.show).join(" ") : "ε (the initial marking)");
  let explanation: string;
  if (c.kind === "stateMismatch")
    explanation = `The step sequences ${seq(c.steps)} and ${seq(c.other!)} reach the same marking in one net but different markings in the other, so the CRGs are not isomorphic (Def. 22)`;
  else
    explanation = `After ${seq(c.steps)} the step ${c.show(c.step!)} is enabled in the ${c.kind === "stepOnlyInApn" ? "APN but not in the T-APN" : "T-APN but not in the APN"}`;
  const { show: _show, ...rest } = c;
  return { ...rest, explanation };
}

function ambientSide(an: AmbientNet, mapIn: (u: Step) => Step, mapOut: (u: Step) => Step, opts: EquivalenceOptions): Side<Marking> {
  return {
    initial: ambientInitialMarking(an),
    key: markingKey,
    steps: (M) => {
      const r = enabledSteps(an, M, { maxSteps: opts.maxStepsPerState, capacityRule: opts.capacityRule });
      return { steps: r.steps.map(mapOut), truncated: r.truncated };
    },
    fire: (M, u) => fireStep(an, M, mapIn(u), { capacityRule: opts.capacityRule }),
    pairs: (M) => markingPairs(an, M),
  };
}

/**
 * Check Konios's behavioural equivalence (Sec. 6.6, Def. 22, Theorem 1) of an APN N and a T-APN,
 * by default φ(N): are CRG(N) and CRG(φ(N)) isomorphic? Returns the verdict, and for "not
 * equivalent" a counterexample step sequence. Steps are compared as sets of (t, c) over the APN's
 * transitions; the T-APN's transitions are matched by id (T' = T), else by name.
 */
export function checkEquivalence(apn: Net, opts: EquivalenceOptions = {}): EquivalenceResult {
  const construction = opts.tapn ? undefined : constructTapn(apn, opts.construct);
  const tapn = opts.tapn ?? construction!.net;
  const A = asAmbient(apn);
  const B = asAmbient(tapn);
  for (const [what, x] of [
    ["APN", A],
    ["T-APN", B],
  ] as const) {
    const e = ambientErrors(x);
    if (e.length) throw new Error(`The ${what} has errors: ${e[0].message}`);
  }
  // T-APN transition id -> APN transition id and back.
  const toApn = new Map<string, string>();
  for (const t of B.transitions) {
    const m = opts.transitionMap?.[t.id] ?? A.transitions.find((x) => x.id === t.id)?.id ?? A.transitions.find((x) => x.name === t.name)?.id;
    if (m) toApn.set(t.id, m);
  }
  const toTapn = new Map([...toApn].map(([b, a]) => [a, b]));
  const relabel = (m: Map<string, string>) => (u: Step): Step => u.map((s) => ({ transition: m.get(s.transition) ?? `?${s.transition}`, colour: s.colour }));
  const identity = (u: Step) => u;
  const res = lockStep(
    ambientSide(A, identity, identity, opts),
    ambientSide(B, relabel(toTapn), relabel(toApn), opts),
    (u) => showStep(A, u.filter((s) => !s.transition.startsWith("?"))) + (u.some((s) => s.transition.startsWith("?")) ? " (with T-APN transitions that have no APN counterpart)" : ""),
    { maxStates: opts.maxStates ?? 20_000, maxEdges: opts.maxEdges ?? 500_000, signal: opts.signal },
  );
  const verdict = res.isomorphic === true ? "equivalent" : res.isomorphic === false ? "not equivalent" : "unknown";
  return {
    verdict,
    equivalent: verdict === "equivalent",
    counterexample: res.counterexample ? explain(res.counterexample) : undefined,
    states: res.states,
    edges: res.edges,
    reason: res.reason,
    tapn,
    construction,
  };
}

/**
 * Def. 22 for any two step transition systems whose edges are labelled with steps over the same
 * transitions (e.g. two CRGs, or a CRG and a hand-built graph). Edges must be deterministic: at most
 * one edge per state and step. Returns whether they are isomorphic and, if not, a counterexample
 * step sequence (markings are not compared, only the graph structure).
 */
export function stsIsomorphic<S, T>(a: StepTransitionSystem<S>, b: StepTransitionSystem<T>): { isomorphic: boolean; counterexample?: { kind: Counterexample["kind"]; steps: Step[]; step?: Step; other?: Step[] } } {
  const succ = <X>(g: StepTransitionSystem<X>) => {
    const m = new Map<number, Map<string, { to: number; step: Step }>>();
    for (const e of g.edges) {
      const row = m.get(e.from) ?? m.set(e.from, new Map()).get(e.from)!;
      row.set(stepKey(e.step), { to: e.to, step: e.step });
    }
    return m;
  };
  const sa = succ(a);
  const sb = succ(b);
  const side = (g: Map<number, Map<string, { to: number; step: Step }>>, initial: number): Side<number> => ({
    initial,
    key: (s) => String(s),
    steps: (s) => ({ steps: [...(g.get(s)?.values() ?? [])].map((x) => x.step), truncated: false }),
    fire: (s, u) => g.get(s)!.get(stepKey(u))!.to,
    pairs: () => [],
  });
  const r = lockStep(side(sa, a.initial), side(sb, b.initial), (u) => stepKey(u), { maxStates: Infinity, maxEdges: Infinity });
  if (r.isomorphic) return { isomorphic: true };
  const c = r.counterexample!;
  return { isomorphic: false, counterexample: { kind: c.kind, steps: c.steps, step: c.step, other: c.other } };
}
