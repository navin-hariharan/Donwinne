// Petri net slicing (Khan, Konios and Guelfi, "A Survey of Petri Nets Slicing", ACM Computing
// Surveys 51(5), 2018; Konios et al., "A Modular Framework for Modelling and Verification of
// Activities in Ambient Intelligent Systems", HCII 2023, LNCS 14029, Sec. 5).
//
// A slice is the part of a net that can influence a slicing criterion: a set of places (and,
// as the survey's Sec. 8.4 proposes, transitions). Every algorithm of the survey is here, on the
// P/T view of a net (coloured nets, APNs and T-APNs are unfolded first, as the framework does):
//
//   static, for model checking (Sec. 5)       dynamic, for testing (Sec. 6)
//   - "backward"   Alg. 7                     - "forward"   Alg. 8 (Llorens et al.)
//   - "basic"      Rakow's basic slicing      - "llorens"   backward ∩ forward (Sec. 6.2.1)
//   - "ctlStarX"   Alg. 1 (Rakow)             - "trace"     Alg. 9 (needs a firing sequence)
//   - "safety"     Alg. 2 (Rakow)             - "wangyang"  Alg. 10, local reachability graph
//   - "apnSlicing" Alg. 3 (Khan et al.)       - "concerned" Alg. 11 (Khan et al.)
//   - "abstract"   Alg. 4 (Khan et al.), neutral transitions merged
//   - "abstractParallel"  Alg. 4 with the improvement of Sec. 8.4 (parallel transitions removed)
// and two that split a net into several slices: {@link leeSlices} (Alg. 5, minimal P-invariants)
// and {@link changConcurrencySets} (Alg. 6, concurrency sets for test generation).
//
// The algorithms are written for nets with normal arcs. Here they also handle read, inhibitor,
// equal and reset arcs, capacities and marking-dependent weights soundly:
// - the places a transition depends on, cond(t), are its input places of every kind, the output
//   places whose capacity can stop it, and every place for marking-dependent weights;
// - a transition reads a place when firing it cannot change that place's marking (read, inhibitor,
//   equal arcs, or equal input and output weights); only non-reading transitions are followed;
// - the monotone algorithms (backward, basic, safety) only follow transitions that add tokens to a
//   place. Inhibitor and equal arcs and capacities are not monotone (removing tokens can enable),
//   so for the places they test every transition that changes the place is kept.

import type { Arc, Net, Place, Transition } from "@pns/core";
import { parseCtl, resolvePlace, resolveTransition, type CtlFormula, type CtlTerm, type CtlVocabulary } from "./ctl";
import { incidenceMatrix, minimalInvariants } from "./invariants";
import { checkAbort, type PTArc, type PTNet } from "./ptnet";
import { Firer } from "./statespace";
import type { NodeRef } from "./types";

/** The single-slice algorithms. */
export type SlicingAlgorithm =
  | "backward"
  | "basic"
  | "ctlStarX"
  | "safety"
  | "apnSlicing"
  | "abstract"
  | "abstractParallel"
  | "forward"
  | "llorens"
  | "wangyang"
  | "concerned"
  | "trace";

/** What an algorithm is for and what it preserves (survey, Table 3). */
export interface SlicingAlgorithmInfo {
  id: SlicingAlgorithm;
  label: string;
  /** "static": the initial marking is not used; "dynamic": it is. */
  kind: "static" | "dynamic";
  /** "mc": model checking; "testing"; or both. */
  context: "mc" | "testing" | "mc/testing";
  /** Properties whose truth the slice preserves. */
  preserves: string;
  /** Where the algorithm comes from. */
  source: string;
  /** Needs a firing sequence (trace slicing). */
  needsTrace?: boolean;
}

export const SLICING_ALGORITHMS: readonly SlicingAlgorithmInfo[] = [
  {
    id: "abstract",
    label: "Abstract slicing",
    kind: "static",
    context: "mc",
    preserves: "CTL*-X properties of the criterion places (no next-time operator)",
    source: "Khan and Guelfi 2014; survey Alg. 4; used by the framework of Konios et al. 2023, Sec. 5",
  },
  {
    id: "abstractParallel",
    label: "Abstract slicing with parallel transitions",
    kind: "static",
    context: "mc",
    preserves: "CTL*-X properties of the criterion places (no next-time operator)",
    source: "Survey Sec. 8.4 and Fig. 28: abstract slicing that also drops duplicate (parallel) transitions",
  },
  {
    id: "ctlStarX",
    label: "CTL*-X slicing",
    kind: "static",
    context: "mc",
    preserves: "CTL*-X properties of the criterion places, under weak fairness for liveness",
    source: "Rakow 2008; survey Alg. 1",
  },
  {
    id: "apnSlicing",
    label: "APNSlicing",
    kind: "static",
    context: "mc",
    preserves: "LTL-X properties of the criterion places",
    source: "Khan et al. 2012; survey Alg. 3",
  },
  {
    id: "safety",
    label: "Safety slicing",
    kind: "static",
    context: "mc",
    preserves: "Stutter-invariant safety properties of the criterion places only: AG of state formulas, and EF as their negation (reachability); not liveness (AF, EG, AG EF)",
    source: "Rakow 2012; survey Alg. 2",
  },
  {
    id: "basic",
    label: "Basic slicing",
    kind: "static",
    context: "mc",
    preserves: "CTL*-X properties of the criterion places (it keeps reading transitions too, so it is larger than CTL*-X slicing)",
    source: "Rakow's basic slicing; survey Sec. 5.1.2, Fig. 7 and Table 1",
  },
  {
    id: "backward",
    label: "Backward slicing",
    kind: "static",
    context: "mc/testing",
    preserves: "Whether tokens can reach the criterion places (it keeps only transitions that put tokens there, so it over-approximates their markings)",
    source: "Llorens et al. 2008; survey Alg. 7",
  },
  {
    id: "forward",
    label: "Forward slicing",
    kind: "dynamic",
    context: "testing",
    preserves: "The part of the net the initial tokens can reach (the criterion is not used)",
    source: "Llorens et al. 2008; survey Alg. 8",
  },
  {
    id: "llorens",
    label: "Backward and forward (Llorens et al.)",
    kind: "dynamic",
    context: "mc/testing",
    preserves: "Paths from the initial marking that can contribute tokens to the criterion places",
    source: "Llorens et al. 2008; survey Sec. 6.2.1 (intersection of Algs 7 and 8)",
  },
  {
    id: "concerned",
    label: "Concerned slicing",
    kind: "dynamic",
    context: "testing",
    preserves: "Paths from the initial marking that can change the marking of the criterion places",
    source: "Khan et al.; survey Alg. 11",
  },
  {
    id: "wangyang",
    label: "Wangyang slicing (local reachability graph)",
    kind: "dynamic",
    context: "mc/testing",
    preserves: "Token flows to the criterion found on the local reachability graph of the backward slice",
    source: "Wangyang et al.; survey Alg. 10",
  },
  {
    id: "trace",
    label: "Trace slicing",
    kind: "dynamic",
    context: "testing",
    preserves: "The transitions of one firing sequence that put tokens on the criterion places",
    source: "Llorens et al. 2008; survey Alg. 9",
    needsTrace: true,
  },
];

/** The slicing criterion: places (and transitions) by index or by name, e.g. "p3", "p3[b]", "t1<x=b>". */
export interface SlicingCriterion {
  places?: readonly (number | string)[];
  transitions?: readonly (number | string)[];
}

export interface SliceOptions {
  algorithm?: SlicingAlgorithm;
  /** Trace slicing: the firing sequence, by transition index or name. */
  trace?: readonly (number | string)[];
  /** Wangyang slicing: most nodes of the local reachability graph (default 100000). */
  maxGraphNodes?: number;
  /**
   * Ignore capacities that the minimal P-invariants show can never be reached (default true). Such a
   * capacity never stops a transition, so leaving it out keeps slices smaller and lets abstract
   * slicing merge places of safe nets such as T-APNs (capacity 1 per colour).
   */
  capacityBounds?: boolean;
  /**
   * Also drop transitions that can never fire and places that can never be marked, found by token
   * flow from the initial marking (survey Alg. 8). Default false. This never changes the state
   * space, only the size of the slice.
   */
  removeDead?: boolean;
  signal?: AbortSignal;
}

/** A place merged away by abstract slicing: its tokens and incoming arcs moved to `into`. */
export interface SliceMerge {
  /** Index of the removed place (in the original net). */
  place: number;
  /** Index of the place it was merged into (in the original net). */
  into: number;
  /** The neutral transition removed with it (index in the original net). */
  transition: number;
}

export interface NetSlice {
  algorithm: SlicingAlgorithm;
  /** The criterion, resolved to indices of the original net. */
  criterion: { places: number[]; transitions: number[] };
  /** Kept places and transitions (indices of the original net, ascending). */
  places: number[];
  transitions: number[];
  /** Abstract slicing: neutral transitions removed and the places merged. */
  merges: SliceMerge[];
  /** Abstract slicing with parallel transitions: transitions dropped because another one has the same arcs. */
  parallel: { removed: number; keptAs: number }[];
  /**
   * Abstract slicing: places dropped because no transition can change their marking and their arcs
   * always allow firing (a database place whose refill was merged away, for instance).
   */
  constants: number[];
  /** The slice as a P/T view (indices renumbered; names and references kept), ready for analysis. */
  pt: PTNet;
  /** placeMap[p] = index of original place p in the slice, or -1. Merged places map to their target. */
  placeMap: Int32Array;
  transitionMap: Int32Array;
  stats: { places: number; transitions: number; arcs: number; originalPlaces: number; originalTransitions: number; originalArcs: number };
  notes: string[];
}

// ---------------------------------------------------------------------------------------------
// Structure of the P/T view used by every algorithm.

/**
 * Upper bounds on the token count of each place from the minimal P-invariants (y·M ≤ y·m0, which
 * still holds with read, inhibitor, equal and reset arcs and with capacities): Infinity where no
 * invariant covers the place, and for nets where invariants say nothing (modulo nets,
 * marking-dependent weights) or the computation hits its size limit.
 */
export function invariantBounds(pt: PTNet, signal?: AbortSignal, maxRows = 5000): number[] {
  const bound = new Array<number>(pt.places.length).fill(Infinity);
  if (pt.modulus || pt.arcs.some((a) => a.weight === null) || !pt.places.length) return bound;
  let vectors: number[][];
  try {
    vectors = minimalInvariants(incidenceMatrix(pt).rows, pt.transitions.length, { maxRows, signal }).vectors;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return bound;
  }
  for (const y of vectors) {
    let total = 0;
    for (let p = 0; p < y.length; p++) total += y[p] * pt.m0[p];
    for (let p = 0; p < y.length; p++) if (y[p] > 0) bound[p] = Math.min(bound[p], Math.floor(total / y[p]));
  }
  return bound;
}

class SliceStructure {
  readonly nP: number;
  readonly nT: number;
  /** Places transition t depends on. */
  readonly cond: number[][];
  /** Places whose marking t can change (with the net change, or NaN when unknown). */
  readonly change: Map<number, number>[];
  /** Places t needs tokens on (normal, read and equal arcs of positive weight): Alg. 8's •t. */
  readonly positive: number[][];
  /** Normal output places (t•). */
  readonly outputs: number[][];
  /** Every place t has an arc with. */
  readonly touched: number[][];
  /** Transitions with a normal output arc into p (Alg. 7's •p). */
  readonly writers: number[][];
  /** Transitions that can add tokens to p. */
  readonly producers: number[][];
  /** Transitions that can change p's marking. */
  readonly changers: number[][];
  /** Transitions with any arc at p (•p ∪ p•). */
  readonly around: number[][];
  /** Places tested in a non-monotone way: inhibitor or equal arcs, capacities, marking-dependent weights. */
  readonly nonMonotone: Uint8Array;
  /** Transitions with marking-dependent weights. */
  readonly variable: Uint8Array;

  /** Places whose capacity can stop a transition (capacities that P-invariants show to be redundant are left out). */
  readonly capped: Uint8Array;

  constructor(readonly pt: PTNet, opts: { capacityBounds?: boolean; signal?: AbortSignal } = {}) {
    const nP = (this.nP = pt.places.length);
    const nT = (this.nT = pt.transitions.length);
    const cond = Array.from({ length: nT }, () => new Set<number>());
    const change = Array.from({ length: nT }, () => new Map<number, number>());
    const positive = Array.from({ length: nT }, () => new Set<number>());
    const outputs = Array.from({ length: nT }, () => new Set<number>());
    const touched = Array.from({ length: nT }, () => new Set<number>());
    const writers = Array.from({ length: nP }, () => new Set<number>());
    const nonMonotone = new Uint8Array(nP);
    const variable = new Uint8Array(nT);
    const capped = (this.capped = new Uint8Array(nP));
    const bounds = opts.capacityBounds === false || pt.capacity.every((c) => c === undefined) ? undefined : invariantBounds(pt, opts.signal);
    pt.capacity.forEach((c, p) => {
      if (c !== undefined && !(bounds && bounds[p] <= c)) capped[p] = 1;
    });
    for (const a of pt.arcs) {
      const { place: p, transition: t } = a;
      touched[t].add(p);
      if (a.weight === null) variable[t] = 1;
      if (a.dir === "in") {
        cond[t].add(p);
        if (a.kind === "normal") {
          change[t].set(p, (change[t].get(p) ?? 0) - (a.weight ?? NaN));
          if (a.weight === null || a.weight > 0) positive[t].add(p);
        } else if (a.kind === "read") {
          if (a.weight === null || a.weight > 0) positive[t].add(p);
        } else if (a.kind === "equal") {
          nonMonotone[p] = 1;
          if (a.weight === null || a.weight > 0) positive[t].add(p);
        } else if (a.kind === "inhibitor") nonMonotone[p] = 1;
        else if (a.kind === "reset") change[t].set(p, NaN);
      } else {
        change[t].set(p, (change[t].get(p) ?? 0) + (a.weight ?? NaN));
        outputs[t].add(p);
        writers[p].add(t);
      }
    }
    // Capacities stop transitions that add tokens to a full place.
    for (let t = 0; t < nT; t++)
      for (const [p, d] of change[t])
        if (capped[p] && !(d <= 0)) {
          cond[t].add(p);
          nonMonotone[p] = 1;
        }
    // Modulo nets wrap token counts: nothing is monotone.
    if (pt.modulus) nonMonotone.fill(1);
    // Marking-dependent weights may read any place.
    for (let t = 0; t < nT; t++)
      if (variable[t]) {
        for (let p = 0; p < nP; p++) cond[t].add(p);
        nonMonotone.fill(1);
      }
    const producers = Array.from({ length: nP }, () => new Set<number>());
    const changers = Array.from({ length: nP }, () => new Set<number>());
    const around = Array.from({ length: nP }, () => new Set<number>());
    for (let t = 0; t < nT; t++) {
      for (const [p, d] of change[t]) {
        if (d === 0) continue;
        changers[p].add(t);
        if (!(d < 0)) producers[p].add(t);
      }
      for (const p of touched[t]) around[p].add(t);
    }
    const arr = (s: Set<number>[]) => s.map((x) => [...x].sort((a, b) => a - b));
    this.cond = arr(cond);
    this.change = change;
    this.positive = arr(positive);
    this.outputs = arr(outputs);
    this.touched = arr(touched);
    this.writers = arr(writers);
    this.producers = arr(producers);
    this.changers = arr(changers);
    this.around = arr(around);
    this.nonMonotone = nonMonotone;
    this.variable = variable;
  }

  /** t is a non-reading transition for p: firing it can change p's marking (λ(p,t) ≠ λ(t,p)). */
  nonReading(t: number, p: number): boolean {
    const d = this.change[t].get(p);
    return d !== undefined && d !== 0;
  }
}

/** A growing set of indices with a work list. */
class WorkSet {
  readonly has: Uint8Array;
  readonly list: number[] = [];
  constructor(n: number) {
    this.has = new Uint8Array(n);
  }
  add(i: number): boolean {
    if (this.has[i]) return false;
    this.has[i] = 1;
    this.list.push(i);
    return true;
  }
  addAll(xs: Iterable<number>) {
    for (const x of xs) this.add(x);
  }
  sorted(): number[] {
    return [...this.list].sort((a, b) => a - b);
  }
}

// ---------------------------------------------------------------------------------------------
// Criterion

/** " (names look like a, b, …)" from the first few names, so an error shows how names are written in this net. */
function namesHint(nodes: readonly { name: string }[]): string {
  const some = nodes.slice(0, 4).map((n) => n.name);
  return some.length ? ` (names look like ${some.join(", ")}${nodes.length > some.length ? ", …" : ""})` : "";
}

/** Resolve a criterion against the net's places and transitions. Throws on an unknown name or index. */
export function resolveCriterion(pt: PTNet, criterion: SlicingCriterion): { places: number[]; transitions: number[] } {
  const vocab: CtlVocabulary = { places: pt.places, transitions: pt.transitions };
  const places = new Set<number>();
  const transitions = new Set<number>();
  for (const x of criterion.places ?? []) {
    if (typeof x === "number") {
      if (!Number.isInteger(x) || x < 0 || x >= pt.places.length) throw new Error(`Criterion place index ${x} is out of range`);
      places.add(x);
      continue;
    }
    const m = /^(.*)\[([^\]]+)\]$/.exec(x.trim());
    const hits = resolvePlace(vocab, x.trim()) ?? (m ? resolvePlace(vocab, m[1], m[2]) : undefined);
    if (!hits) throw new Error(`Unknown criterion place "${x}": this net has no such place${namesHint(pt.places)}`);
    hits.forEach((i) => places.add(i));
  }
  for (const x of criterion.transitions ?? []) {
    if (typeof x === "number") {
      if (!Number.isInteger(x) || x < 0 || x >= pt.transitions.length) throw new Error(`Criterion transition index ${x} is out of range`);
      transitions.add(x);
      continue;
    }
    const hits = resolveTransition(vocab, x.trim());
    if (!hits) throw new Error(`Unknown criterion transition "${x}": this net has no such transition${namesHint(pt.transitions)}`);
    hits.forEach((i) => transitions.add(i));
  }
  const sort = (s: Set<number>) => [...s].sort((a, b) => a - b);
  return { places: sort(places), transitions: sort(transitions) };
}

/** What a CTL formula tells the slicer. */
export interface FormulaCriterion {
  /** Place names as written in the formula (with colours, e.g. "p3[b]"). */
  places: string[];
  /** Transitions named by fireable(…). */
  transitions: string[];
  /** The formula uses EX or AX: slicing preserves CTL*-X only, so its verdict on a slice may differ. */
  usesNext: boolean;
  /** The formula uses deadlock, which depends on every transition: slicing cannot keep it. */
  usesDeadlock: boolean;
  /**
   * The formula is a boolean combination of state formulas and AG/EF of state formulas, whose truth
   * safety slicing preserves (Rakow's stutter-invariant safety properties and their negations).
   */
  safety: boolean;
}

/**
 * The slicing criterion of a CTL formula (survey Sec. 2: the places "extracted from the temporal
 * description of the property"). Throws {@link CtlError} on a syntax error.
 */
export function criterionFromCtl(formula: string | CtlFormula): FormulaCriterion {
  const f = typeof formula === "string" ? parseCtl(formula) : formula;
  const places = new Set<string>();
  const transitions = new Set<string>();
  let usesNext = false;
  let usesDeadlock = false;
  const term = (t: CtlTerm) => {
    if (t.kind === "place") places.add(t.colour !== undefined ? `${t.name}[${t.colour}]` : t.name);
    else if (t.kind === "sum") t.terms.forEach(term);
  };
  const walk = (g: CtlFormula) => {
    switch (g.kind) {
      case "const":
        return;
      case "deadlock":
        usesDeadlock = true;
        return;
      case "fireable":
        transitions.add(g.transition);
        return;
      case "cmp":
        term(g.left);
        term(g.right);
        return;
      case "not":
        walk(g.arg);
        return;
      case "and":
      case "or":
      case "implies":
      case "iff":
      case "EU":
      case "AU":
        walk(g.left);
        walk(g.right);
        return;
      default:
        if (g.kind === "EX" || g.kind === "AX") usesNext = true;
        walk(g.arg);
    }
  };
  walk(f);
  return { places: [...places], transitions: [...transitions], usesNext, usesDeadlock, safety: isSafetyShape(f) };
}

function isState(f: CtlFormula): boolean {
  switch (f.kind) {
    case "const":
    case "deadlock":
    case "fireable":
    case "cmp":
      return true;
    case "not":
      return isState(f.arg);
    case "and":
    case "or":
    case "implies":
    case "iff":
      return isState(f.left) && isState(f.right);
    default:
      return false;
  }
}

/**
 * Boolean combinations of state formulas and AG/EF of state formulas. AG s is a stutter-invariant
 * safety property. EF s is not a liveness property: it is reachability, the negation of the safety
 * property AG ¬s, and a slice that keeps the verdict of AG ¬s keeps that of EF s. Safety slicing
 * does (the net and the slice reach the same criterion markings: see "safety slicing and the
 * properties it keeps" in slicing.test.ts). Liveness (AF, EG, AU, nested AG EF, …) is left out.
 */
function isSafetyShape(f: CtlFormula): boolean {
  if (isState(f)) return true;
  switch (f.kind) {
    case "AG":
    case "EF":
      return isState(f.arg);
    case "not":
      return isSafetyShape(f.arg);
    case "and":
    case "or":
    case "implies":
    case "iff":
      return isSafetyShape(f.left) && isSafetyShape(f.right);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------------------------
// The algorithms. Each returns kept places and transitions as work sets over the original net.

type Core = { P: WorkSet; T: WorkSet };

function seed(s: SliceStructure, crit: { places: number[]; transitions: number[] }): Core {
  const P = new WorkSet(s.nP);
  const T = new WorkSet(s.nT);
  P.addAll(crit.places);
  // Survey Sec. 8.4: criterion transitions are kept with the places they depend on.
  for (const t of crit.transitions) {
    T.add(t);
    P.addAll(s.cond[t]);
  }
  return { P, T };
}

/** Transitions a monotone algorithm follows into p: producers, or every changer for a non-monotone place. */
const feeders = (s: SliceStructure, p: number) => (s.nonMonotone[p] ? s.changers[p] : s.producers[p]);

/** Alg. 7, backward slicing: T ← T ∪ •P, P ← P ∪ •T until a fixed point. */
function backward(s: SliceStructure, crit: { places: number[]; transitions: number[] }): Core {
  const c = seed(s, crit);
  for (let i = 0; i < c.P.list.length || i < c.T.list.length; i++) {
    // Places and transitions are processed alternately; the order does not change the fixed point.
    if (i < c.P.list.length) {
      const p = c.P.list[i];
      for (const t of s.writers[p]) c.T.add(t);
      // Removing tokens can enable a transition through an inhibitor or equal arc or a capacity.
      if (s.nonMonotone[p]) for (const t of s.changers[p]) c.T.add(t);
    }
    if (i < c.T.list.length) c.P.addAll(s.cond[c.T.list[i]]);
  }
  return c;
}

/**
 * Rakow's basic slicing (survey Sec. 5.1.2, Fig. 7): every transition attached to a place of the
 * slice, reading or not (•p ∪ p•), with the places it depends on, until a fixed point.
 */
function basic(s: SliceStructure, crit: { places: number[]; transitions: number[] }): Core {
  const c = seed(s, crit);
  for (let i = 0; i < c.P.list.length; i++) for (const t of s.around[c.P.list[i]]) if (c.T.add(t)) c.P.addAll(s.cond[t]);
  return c;
}

/** Algs 1 (CTL*-X) and 3 (APNSlicing): follow non-reading transitions of every place, with their input places. */
function nonReadingClosure(s: SliceStructure, crit: { places: number[]; transitions: number[] }, apnInit: boolean): Core {
  const c = seed(s, crit);
  if (apnInit)
    for (const p of crit.places)
      for (const t of s.changers[p])
        if (c.T.add(t)) c.P.addAll(s.cond[t]);
  for (let i = 0; i < c.P.list.length; i++) {
    const p = c.P.list[i];
    for (const t of s.changers[p]) if (c.T.add(t)) c.P.addAll(s.cond[t]);
  }
  return c;
}

/** Alg. 2, safety slicing: non-reading transitions of the criterion, then only transitions adding tokens. */
function safety(s: SliceStructure, crit: { places: number[]; transitions: number[] }): Core {
  const c = seed(s, crit);
  const done = new Uint8Array(s.nP);
  for (const p of crit.places) {
    done[p] = 1;
    for (const t of s.changers[p]) if (c.T.add(t)) c.P.addAll(s.cond[t]);
  }
  for (let i = 0; i < c.P.list.length; i++) {
    const p = c.P.list[i];
    if (done[p]) continue;
    done[p] = 1;
    for (const t of feeders(s, p)) if (c.T.add(t)) c.P.addAll(s.cond[t]);
  }
  return c;
}

/** Alg. 8, forward slicing from the initial marking (token flow, ignoring counts). */
function forward(s: SliceStructure, pt: PTNet, within?: Core): Core {
  const P = new WorkSet(s.nP);
  const T = new WorkSet(s.nT);
  const inScopeT = (t: number) => !within || within.T.has[t] === 1;
  const inScopeP = (p: number) => !within || within.P.has[p] === 1;
  const firer = new Firer(pt);
  const M0 = Int32Array.from(pt.m0);
  // T ← {t | m0[t⟩}; P ← {p | m0(p) > 0} ∪ T•.
  for (let p = 0; p < s.nP; p++) if (pt.m0[p] > 0 && inScopeP(p)) P.add(p);
  for (let t = 0; t < s.nT; t++) {
    if (!inScopeT(t)) continue;
    let enabled: boolean;
    try {
      enabled = firer.fire(t, M0) !== null;
    } catch {
      enabled = true;
    }
    if (enabled) T.add(t);
  }
  for (const t of T.list) for (const p of s.outputs[t]) if (inScopeP(p)) P.add(p);
  // Tdo ← {t ∉ T | •t ⊆ P} until empty. Each transition waits for its missing input places.
  const missing = new Int32Array(s.nT);
  const waiting: number[][] = Array.from({ length: s.nP }, () => []);
  const queue: number[] = [];
  for (let t = 0; t < s.nT; t++) {
    if (T.has[t] || !inScopeT(t)) continue;
    let k = 0;
    for (const p of s.positive[t])
      if (!P.has[p]) {
        k++;
        waiting[p].push(t);
      }
    missing[t] = k;
    if (k === 0) queue.push(t);
  }
  const fireNew = (t: number) => {
    if (!T.add(t)) return;
    for (const p of s.outputs[t]) {
      if (!inScopeP(p) || !P.add(p)) continue;
      for (const u of waiting[p]) if (--missing[u] === 0) queue.push(u);
    }
  };
  // Places added by the initial T• release waiting transitions too.
  for (const p of P.list) for (const u of waiting[p]) if (--missing[u] === 0) queue.push(u);
  while (queue.length) fireNew(queue.pop()!);
  return { P, T };
}

function intersect(a: Core, b: Core, nP: number, nT: number): Core {
  const P = new WorkSet(nP);
  const T = new WorkSet(nT);
  for (const p of a.P.list) if (b.P.has[p]) P.add(p);
  for (const t of a.T.list) if (b.T.has[t]) T.add(t);
  return { P, T };
}

/** Alg. 9, trace slicing: walk a firing sequence backwards, keeping transitions that put tokens on Q. */
function traceSlice(s: SliceStructure, pt: PTNet, crit: { places: number[]; transitions: number[] }, trace: readonly (number | string)[]): Core {
  const vocab: CtlVocabulary = { places: pt.places, transitions: pt.transitions };
  const seq = trace.map((x) => {
    if (typeof x === "number") {
      if (!Number.isInteger(x) || x < 0 || x >= s.nT) throw new Error(`Trace transition index ${x} is out of range`);
      return x;
    }
    const hits = resolveTransition(vocab, x.trim());
    if (!hits || hits.length !== 1) throw new Error(hits ? `Trace transition "${x}" is ambiguous; name one binding, e.g. ${pt.transitions[hits[0]].name}` : `Unknown trace transition "${x}"`);
    return hits[0];
  });
  const firer = new Firer(pt);
  const markings: Int32Array[] = [Int32Array.from(pt.m0)];
  seq.forEach((t, i) => {
    const next = firer.fire(t, markings[i]);
    if (!next) throw new Error(`The trace cannot be fired: ${pt.transitions[t].name} (step ${i + 1}) is not enabled`);
    markings.push(next);
  });
  const c = seed(s, crit);
  for (let i = seq.length; i >= 1; i--) {
    const t = seq[i - 1];
    const before = markings[i - 1];
    const after = markings[i];
    let adds = c.T.has[t] === 1;
    for (let k = 0; !adds && k < c.P.list.length; k++) {
      const p = c.P.list[k];
      if (before[p] < after[p]) adds = true;
    }
    if (adds) {
      c.T.add(t);
      c.P.addAll(s.cond[t]);
    }
  }
  return c;
}

/** Alg. 10: the local reachability graph of the backward slice, kept where it leads to the criterion. */
function wangyang(s: SliceStructure, pt: PTNet, crit: { places: number[]; transitions: number[] }, maxNodes: number, notes: string[], signal?: AbortSignal): Core {
  const b = backward(s, crit);
  const BP = b.P.has;
  const tList = b.T.sorted();
  // Boolean abstraction: a node is the set of marked places of the backward slice.
  const key = (set: Uint8Array) => {
    const xs: number[] = [];
    for (let p = 0; p < set.length; p++) if (set[p]) xs.push(p);
    return xs.join(",");
  };
  const root = new Uint8Array(s.nP);
  for (let p = 0; p < s.nP; p++) if (BP[p] && pt.m0[p] > 0) root[p] = 1;
  const nodes: Uint8Array[] = [root];
  const index = new Map<string, number>([[key(root), 0]]);
  const edges: { from: number; to: number; t: number }[] = [];
  // A node only says which places are marked (at least one token), so each arc is read for what
  // that tells: a normal, read or equal arc of constant weight w > 0 needs a marked place; an
  // inhibitor arc of weight 1 and an equal arc of weight 0 need an empty one. An inhibitor arc of
  // weight w > 1 blocks only at w tokens or more, which a marked place may or may not hold, so it
  // does not block here (nor do arcs whose weight depends on the marking): the graph keeps every
  // firing that may happen. Firing empties the places t consumes from (Alg. 10: MP \ •t) and those
  // it resets, and marks its outputs.
  const needMarked = new Map<number, number[]>();
  const needEmpty = new Map<number, number[]>();
  const consumed = new Map<number, number[]>();
  const push = (m: Map<number, number[]>, t: number, p: number) => (m.get(t) ?? m.set(t, []).get(t)!).push(p);
  for (const a of pt.arcs) {
    if (a.dir !== "in" || !b.T.has[a.transition]) continue;
    const w = a.weight;
    if ((a.kind === "normal" || a.kind === "read" || a.kind === "equal") && w !== null && w > 0) push(needMarked, a.transition, a.place);
    if ((a.kind === "inhibitor" && w === 1) || (a.kind === "equal" && w === 0)) push(needEmpty, a.transition, a.place);
    if ((a.kind === "normal" && w !== null && w > 0) || a.kind === "reset") push(consumed, a.transition, a.place);
  }
  let cut = false;
  for (let i = 0; i < nodes.length; i++) {
    if ((i & 255) === 0) checkAbort(signal);
    const MP = nodes[i];
    for (const t of tList) {
      if (!(needMarked.get(t) ?? []).every((p) => MP[p])) continue;
      if ((needEmpty.get(t) ?? []).some((p) => MP[p])) continue;
      const next = new Uint8Array(MP);
      for (const p of consumed.get(t) ?? []) next[p] = 0;
      for (const p of s.outputs[t]) if (BP[p]) next[p] = 1;
      const k = key(next);
      let j = index.get(k);
      if (j === undefined) {
        if (nodes.length >= maxNodes) {
          cut = true;
          continue;
        }
        j = nodes.length;
        nodes.push(next);
        index.set(k, j);
      }
      edges.push({ from: i, to: j, t });
    }
  }
  if (cut) {
    notes.push(`The local reachability graph was cut off at ${maxNodes} nodes; the concerned slice (Alg. 11) is used instead.`);
    return forward(s, pt, b);
  }
  // Keep the edges from which a node marking a criterion place can be reached.
  const good = new Uint8Array(nodes.length);
  const preds: number[][] = Array.from({ length: nodes.length }, () => []);
  for (const e of edges) preds[e.to].push(e.from);
  const stack: number[] = [];
  nodes.forEach((n, i) => {
    if (crit.places.some((p) => n[p])) {
      good[i] = 1;
      stack.push(i);
    }
  });
  while (stack.length) {
    const v = stack.pop()!;
    for (const u of preds[v])
      if (!good[u]) {
        good[u] = 1;
        stack.push(u);
      }
  }
  const c = seed(s, crit);
  for (const e of edges)
    if (good[e.to]) {
      c.T.add(e.t);
      c.P.addAll(s.cond[e.t]);
      for (const p of s.outputs[e.t]) if (BP[p]) c.P.add(p);
    }
  return c;
}

// ---------------------------------------------------------------------------------------------
// Building the sliced P/T view, abstract merges and parallel transitions.

interface Draft {
  places: number[];
  transitions: number[];
  /** Arcs of the slice, as copies of the original arcs (place and transition still original indices). */
  arcs: PTArc[];
  m0: Map<number, number>;
}

function draft(pt: PTNet, core: Core): Draft {
  const places = core.P.sorted();
  const transitions = core.T.sorted();
  const arcs = pt.arcs.filter((a) => core.P.has[a.place] && core.T.has[a.transition]).map((a) => ({ ...a }));
  const m0 = new Map(places.map((p) => [p, pt.m0[p]]));
  return { places, transitions, arcs, m0 };
}

/**
 * Alg. 4, second loop: merge the pre and post place of every neutral transition t (one input arc
 * from p and one output arc to p', of the same weight, and p feeding nothing but t), moving p's
 * tokens and incoming arcs to p'. Criterion places and transitions are never merged. Extra
 * conditions keep the merge sound here: t has no other arcs, neither place has a capacity, p has
 * no reset, read, inhibitor or equal arcs, and p's tokens and incoming weights are multiples of t's weight.
 */
function mergeNeutral(s: SliceStructure, pt: PTNet, d: Draft, crit: { places: number[]; transitions: number[] }, merges: SliceMerge[]): boolean {
  const critP = new Set(crit.places);
  const critT = new Set(crit.transitions);
  const inT = new Set(d.transitions);
  // p• in the whole net: a place read or consumed by a transition outside the slice is never merged.
  const outsideReaders = new Set<number>();
  for (const a of pt.arcs) if (a.dir === "in" && !inT.has(a.transition)) outsideReaders.add(a.place);
  const byT = new Map<number, PTArc[]>();
  const byP = new Map<number, PTArc[]>();
  const push = <K,>(m: Map<K, PTArc[]>, k: K, a: PTArc) => (m.get(k) ?? m.set(k, []).get(k)!).push(a);
  for (const a of d.arcs) {
    push(byT, a.transition, a);
    push(byP, a.place, a);
  }
  const removedT = new Set<number>();
  const removedP = new Set<number>();
  const work = [...d.transitions].reverse();
  const queued = new Set(work);
  while (work.length) {
    const t = work.pop()!;
    queued.delete(t);
    if (removedT.has(t) || critT.has(t)) continue;
    const arcs = byT.get(t) ?? [];
    if (arcs.length !== 2) continue;
    const ain = arcs.find((a) => a.dir === "in");
    const aout = arcs.find((a) => a.dir === "out");
    if (!ain || !aout || ain.kind !== "normal" || aout.kind !== "normal") continue;
    const p = ain.place;
    const q = aout.place;
    const w = ain.weight;
    if (p === q || w === null || w <= 0 || aout.weight !== w) continue;
    if (critP.has(p) || critP.has(q) || outsideReaders.has(p)) continue;
    if (s.capped[p] || s.capped[q] || pt.modulus) continue;
    const atP = byP.get(p) ?? [];
    // |p•| = 1: t is the only transition reading or consuming p.
    if (atP.some((a) => a.dir === "in" && a !== ain)) continue;
    const incoming = atP.filter((a) => a.dir === "out");
    if (incoming.some((a) => a.weight === null || a.weight % w !== 0)) continue;
    const tokens = d.m0.get(p) ?? 0;
    if (tokens % w !== 0) continue;
    // Merge: m(p') ← m(p') + m(p); every arc into p now goes to p'; t and p are removed.
    d.m0.set(q, (d.m0.get(q) ?? 0) + tokens);
    d.m0.delete(p);
    removedT.add(t);
    removedP.add(p);
    byT.delete(t);
    byP.delete(p);
    const atQ = (byP.get(q) ?? []).filter((a) => a !== aout);
    byP.set(q, atQ);
    for (const a of incoming) {
      const list = byT.get(a.transition)!;
      const same = list.find((b) => b !== a && b.place === q && b.dir === "out" && b.kind === "normal" && b.weight !== null);
      if (same) {
        same.weight! += a.weight!;
        list.splice(list.indexOf(a), 1);
      } else {
        a.place = q;
        a.label = `${pt.transitions[a.transition].name} → ${pt.places[q].name}`;
        atQ.push(a);
      }
      // The producer's arcs changed; transitions at q may have become neutral.
      for (const u of [a.transition, ...atQ.map((x) => x.transition)])
        if (!queued.has(u) && !removedT.has(u)) {
          queued.add(u);
          work.push(u);
        }
    }
    merges.push({ place: p, into: q, transition: t });
  }
  if (!removedT.size) return false;
  d.places = d.places.filter((x) => !removedP.has(x));
  d.transitions = d.transitions.filter((x) => !removedT.has(x));
  d.arcs = [...byT.values()].flat();
  return true;
}

/**
 * Drop places whose marking no transition of the net can change (every transition at the place puts
 * back what it takes) and whose arcs are satisfied by that constant marking: they never stop a
 * transition, so removing them and their arcs does not change the behaviour. Abstract slicing
 * creates such places when it merges the response place of a control system into its database place.
 */
function dropConstant(s: SliceStructure, d: Draft, crit: { places: number[]; transitions: number[] }, coreT: Uint8Array, constants: number[]): boolean {
  const critP = new Set(crit.places);
  const byP = new Map<number, PTArc[]>();
  for (const a of d.arcs) (byP.get(a.place) ?? byP.set(a.place, []).get(a.place)!).push(a);
  const drop = new Set<number>();
  for (const p of d.places) {
    if (critP.has(p) || s.capped[p]) continue;
    // Transitions outside the slice that change p (possible for the monotone algorithms) keep it.
    if (s.changers[p].some((t) => !coreT[t])) continue;
    const arcs = byP.get(p) ?? [];
    const m = d.m0.get(p) ?? 0;
    const net = new Map<number, number>();
    const need = new Map<number, number>();
    let ok = true;
    for (const a of arcs) {
      if (a.weight === null || a.kind === "reset") {
        ok = false;
        break;
      }
      const w = a.weight;
      if (a.kind === "normal") {
        net.set(a.transition, (net.get(a.transition) ?? 0) + (a.dir === "in" ? -w : w));
        if (a.dir === "in") need.set(a.transition, (need.get(a.transition) ?? 0) + w);
      } else if (a.kind === "read") ok &&= m >= w;
      else if (a.kind === "inhibitor") ok &&= !(w > 0 && m >= w);
      else if (a.kind === "equal") ok &&= m === w;
    }
    if (!ok) continue;
    if ([...net.values()].some((v) => v !== 0) || [...need.values()].some((w) => m < w)) continue;
    drop.add(p);
  }
  if (!drop.size) return false;
  for (const p of drop) {
    constants.push(p);
    d.m0.delete(p);
  }
  d.places = d.places.filter((p) => !drop.has(p));
  d.arcs = d.arcs.filter((a) => !drop.has(a.place));
  return true;
}

/** Sec. 8.4, Fig. 28: drop transitions whose arcs (kinds, places and weights) equal another's. */
function dropParallel(d: Draft, crit: { places: number[]; transitions: number[] }, parallel: { removed: number; keptAs: number }[]): boolean {
  const critT = new Set(crit.transitions);
  const sig = new Map<number, string[]>();
  for (const a of d.arcs) (sig.get(a.transition) ?? sig.set(a.transition, []).get(a.transition)!).push(`${a.dir}:${a.kind}:${a.place}:${a.weight === null ? "?" : a.weight}`);
  const seen = new Map<string, number>();
  const drop = new Set<number>();
  // Criterion transitions are kept first so a duplicate of one is the one dropped.
  const order = [...d.transitions].sort((a, b) => Number(critT.has(b)) - Number(critT.has(a)) || a - b);
  for (const t of order) {
    const list = sig.get(t) ?? [];
    if (list.some((x) => x.endsWith(":?"))) continue;
    const k = list.sort().join("|");
    const first = seen.get(k);
    if (first === undefined) seen.set(k, t);
    else if (!critT.has(t)) {
      drop.add(t);
      parallel.push({ removed: t, keptAs: first });
    }
  }
  if (!drop.size) return false;
  d.transitions = d.transitions.filter((t) => !drop.has(t));
  d.arcs = d.arcs.filter((a) => !drop.has(a.transition));
  return true;
}

function finish(
  pt: PTNet,
  algorithm: SlicingAlgorithm,
  crit: { places: number[]; transitions: number[] },
  d: Draft,
  merges: SliceMerge[],
  parallel: { removed: number; keptAs: number }[],
  constants: number[],
  notes: string[],
): NetSlice {
  const placeMap = new Int32Array(pt.places.length).fill(-1);
  const transitionMap = new Int32Array(pt.transitions.length).fill(-1);
  d.places.forEach((p, i) => (placeMap[p] = i));
  d.transitions.forEach((t, i) => (transitionMap[t] = i));
  // A merged place maps to the place its tokens went to (following chains of merges).
  for (const m of merges) {
    let q = m.into;
    while (placeMap[q] < 0) {
      const next = merges.find((x) => x.place === q);
      if (!next) break;
      q = next.into;
    }
    placeMap[m.place] = placeMap[q];
  }
  const arcs: PTArc[] = d.arcs
    .map((a) => ({ ...a, place: placeMap[a.place], transition: transitionMap[a.transition] }))
    .sort((a, b) => a.transition - b.transition || (a.dir === b.dir ? a.place - b.place : a.dir === "in" ? -1 : 1));
  const places: NodeRef[] = d.places.map((p) => pt.places[p]);
  const transitions: NodeRef[] = d.transitions.map((t) => pt.transitions[t]);
  const m0 = d.places.map((p) => d.m0.get(p) ?? 0);
  const capacity = d.places.map((p) => pt.capacity[p]);
  // Marking-dependent weights read the original slots: expand the slice's marking to the net's.
  const envAt = pt.envAt
    ? (M: ArrayLike<number>) => {
        const full = new Int32Array(pt.places.length);
        d.places.forEach((p, i) => (full[p] = M[i]));
        return pt.envAt!(full);
      }
    : undefined;
  const sliced: PTNet = {
    places,
    transitions,
    arcs,
    m0,
    capacity,
    ...(pt.modulus ? { modulus: pt.modulus } : {}),
    unfolded: pt.unfolded,
    warnings: [...pt.warnings],
    errors: [...pt.errors],
    ...(envAt ? { envAt } : {}),
    ...(pt.work ? { work: pt.work } : {}),
    ...(pt.slotMembers ? { slotMembers: d.places.map((p) => pt.slotMembers![p]) } : {}),
  };
  return {
    algorithm,
    criterion: crit,
    places: [...d.places].sort((a, b) => a - b),
    transitions: [...d.transitions].sort((a, b) => a - b),
    merges,
    parallel,
    constants: [...constants].sort((a, b) => a - b),
    pt: sliced,
    placeMap,
    transitionMap,
    stats: {
      places: places.length,
      transitions: transitions.length,
      arcs: arcs.length,
      originalPlaces: pt.places.length,
      originalTransitions: pt.transitions.length,
      originalArcs: pt.arcs.length,
    },
    notes,
  };
}

/**
 * Slice a net (its P/T view, see {@link toPTNet}) with respect to a criterion. The default
 * algorithm is abstract slicing, the one the framework of Konios et al. (2023) uses. Throws on an
 * unknown criterion name, a net with errors, or (trace slicing) a trace that cannot be fired.
 */
export function sliceNet(pt: PTNet, criterion: SlicingCriterion, opts: SliceOptions = {}): NetSlice {
  if (pt.errors.length) throw new Error(`The net has errors: ${pt.errors[0]}`);
  checkAbort(opts.signal);
  const algorithm = opts.algorithm ?? "abstract";
  const crit = resolveCriterion(pt, criterion);
  const s = new SliceStructure(pt, { capacityBounds: opts.capacityBounds, signal: opts.signal });
  const notes: string[] = [];
  const info = SLICING_ALGORITHMS.find((a) => a.id === algorithm);
  if (!info) throw new Error(`Unknown slicing algorithm "${algorithm}"`);
  if (!crit.places.length && !crit.transitions.length && algorithm !== "forward") notes.push("The criterion is empty, so the slice is empty.");
  if (s.variable.some((v) => v)) notes.push("Some arcs have marking-dependent weights; the transitions with them depend on every place, which keeps the slice large.");
  let core: Core;
  switch (algorithm) {
    case "backward":
      core = backward(s, crit);
      break;
    case "basic":
      core = basic(s, crit);
      break;
    case "ctlStarX":
      core = nonReadingClosure(s, crit, false);
      break;
    case "apnSlicing":
    case "abstract":
    case "abstractParallel":
      core = nonReadingClosure(s, crit, true);
      break;
    case "safety":
      core = safety(s, crit);
      break;
    case "forward":
      core = forward(s, pt);
      break;
    case "llorens":
      core = intersect(backward(s, crit), forward(s, pt), s.nP, s.nT);
      // Keep the criterion visible even when no initial token can reach it.
      core.P.addAll(crit.places);
      break;
    case "concerned": {
      const b = backward(s, crit);
      core = forward(s, pt, b);
      core.P.addAll(crit.places);
      break;
    }
    case "wangyang":
      core = wangyang(s, pt, crit, opts.maxGraphNodes ?? 100_000, notes, opts.signal);
      break;
    case "trace":
      if (!opts.trace) throw new Error("Trace slicing needs a firing sequence (option trace)");
      core = traceSlice(s, pt, crit, opts.trace);
      break;
  }
  if (opts.removeDead && algorithm !== "forward") {
    const live = forward(s, pt);
    const before = core.T.list.length;
    core = intersect(core, { P: core.P, T: live.T }, s.nP, s.nT);
    if (core.T.list.length < before) notes.push(`${before - core.T.list.length} transition${before - core.T.list.length === 1 ? "" : "s"} that can never fire left out.`);
    // Places now attached to no kept transition and not in the criterion can go too.
    const used = new Set<number>(crit.places);
    for (const t of core.T.list) for (const p of s.touched[t]) used.add(p);
    const P = new WorkSet(s.nP);
    for (const p of core.P.list) if (used.has(p)) P.add(p);
    core = { P, T: core.T };
  }
  const coreT = core.T.has;
  const d = draft(pt, core);
  const merges: SliceMerge[] = [];
  const parallel: { removed: number; keptAs: number }[] = [];
  const constants: number[] = [];
  if (algorithm === "abstract" || algorithm === "abstractParallel") {
    // Merging can make a place constant, dropping a place can make a transition neutral, and
    // removing a parallel transition can do both: repeat until nothing changes.
    let again = true;
    while (again)
      again = mergeNeutral(s, pt, d, crit, merges) || dropConstant(s, d, crit, coreT, constants) || (algorithm === "abstractParallel" && dropParallel(d, crit, parallel));
  }
  if (merges.length) notes.push(`${merges.length} neutral transition${merges.length === 1 ? "" : "s"} removed and their places merged.`);
  if (constants.length) notes.push(`${constants.length} place${constants.length === 1 ? "" : "s"} whose marking never changes and never stops a transition removed.`);
  if (parallel.length) notes.push(`${parallel.length} parallel transition${parallel.length === 1 ? "" : "s"} removed.`);
  return finish(pt, algorithm, crit, d, merges, parallel, constants, notes);
}

// ---------------------------------------------------------------------------------------------
// Algorithms that split a net into several slices.

/** One part of a partition of the net (Lee et al.) or one concurrency set (Chang et al.). */
export interface SlicePart {
  places: number[];
  transitions: number[];
  /** How the part was formed. */
  reason: string;
}

/**
 * Alg. 5 (Lee et al.): divide a net into slices for compositional analysis. The smallest minimal
 * P-invariants are taken while they cover new places; every place still uncovered then joins the
 * smallest slice it shares a transition with (or forms a slice of its own). Each slice keeps the
 * transitions attached to its places. Slices do not reduce the state space (survey Sec. 7.1).
 */
export function leeSlices(pt: PTNet, opts: { maxInvariants?: number; signal?: AbortSignal } = {}): SlicePart[] {
  const C = incidenceMatrix(pt).rows;
  const m = pt.transitions.length;
  let vectors: number[][] = [];
  try {
    vectors = minimalInvariants(C, m, { signal: opts.signal, maxRows: opts.maxInvariants }).vectors;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    vectors = [];
  }
  const s = new SliceStructure(pt);
  const supports = vectors.map((y) => y.flatMap((v, p) => (v ? [p] : []))).sort((a, b) => a.length - b.length);
  const covered = new Uint8Array(pt.places.length);
  const parts: { places: Set<number>; reason: string }[] = [];
  for (const sup of supports) {
    if (!sup.some((p) => !covered[p])) continue;
    sup.forEach((p) => (covered[p] = 1));
    parts.push({ places: new Set(sup), reason: `P-invariant ${sup.map((p) => pt.places[p].name).join(" + ")}` });
  }
  for (let p = 0; p < pt.places.length; p++) {
    if (covered[p]) continue;
    const near = new Set(s.around[p].flatMap((t) => s.touched[t]));
    let best = -1;
    parts.forEach((part, i) => {
      if ([...part.places].some((q) => near.has(q)) && (best < 0 || part.places.size < parts[best].places.size)) best = i;
    });
    if (best < 0) parts.push({ places: new Set([p]), reason: `Place ${pt.places[p].name}, not covered by a P-invariant` });
    else {
      parts[best].places.add(p);
      parts[best].reason += `, with ${pt.places[p].name}`;
    }
    covered[p] = 1;
  }
  return parts.map((part) => {
    const places = [...part.places].sort((a, b) => a - b);
    const transitions = [...new Set(places.flatMap((p) => s.around[p]))].sort((a, b) => a - b);
    return { places, transitions, reason: part.reason };
  });
}

/**
 * Alg. 6 (Chang et al.): concurrency sets for test generation. Processes are the slices of
 * {@link leeSlices} (or given); a communication transition touches places of more than one
 * process. Each concurrency set joins, for an uncovered communication transition, the shortest
 * path inside every process involved from its initially marked places to that transition; the
 * communication transitions on those paths are covered too, and the paths of their processes are
 * added until no new process is involved. Repeats until every communication transition is covered.
 */
export function changConcurrencySets(pt: PTNet, opts: { processes?: SlicePart[]; signal?: AbortSignal } = {}): SlicePart[] {
  const s = new SliceStructure(pt);
  const procs = opts.processes ?? leeSlices(pt, { signal: opts.signal });
  const procOfPlace: number[][] = Array.from({ length: pt.places.length }, () => []);
  procs.forEach((pr, i) => pr.places.forEach((p) => procOfPlace[p].push(i)));
  const procsOfT = (t: number) => [...new Set(s.touched[t].flatMap((p) => procOfPlace[p]))];
  const comm = new Set<number>();
  for (let t = 0; t < pt.transitions.length; t++) if (procsOfT(t).length > 1) comm.add(t);
  // Shortest path in process j from a marked place to transition t (places and transitions).
  const pathIn = (j: number, target: number): { places: number[]; transitions: number[] } | null => {
    const inProc = new Set(procs[j].places);
    const prevT = new Map<number, number>();
    const prevP = new Map<number, number>();
    const startPlaces = procs[j].places.filter((p) => pt.m0[p] > 0);
    if (s.cond[target].some((p) => inProc.has(p) && pt.m0[p] > 0) || !s.cond[target].some((p) => inProc.has(p))) return { places: s.cond[target].filter((p) => inProc.has(p)), transitions: [] };
    const seen = new Set<number>(startPlaces);
    const queue = [...startPlaces];
    while (queue.length) {
      const p = queue.shift()!;
      for (const t of s.around[p]) {
        if (!s.cond[t].includes(p)) continue;
        if (t === target) {
          const places = [p];
          const transitions: number[] = [];
          let q = p;
          while (prevT.has(q)) {
            const u = prevT.get(q)!;
            transitions.push(u);
            q = prevP.get(u)!;
            places.push(q);
          }
          return { places, transitions };
        }
        for (const r of s.outputs[t])
          if (inProc.has(r) && !seen.has(r)) {
            seen.add(r);
            prevT.set(r, t);
            if (!prevP.has(t)) prevP.set(t, p);
            queue.push(r);
          }
      }
    }
    return null;
  };
  const sets: SlicePart[] = [];
  const todo = [...comm].sort((a, b) => a - b);
  const covered = new Set<number>();
  for (const c of todo) {
    checkAbort(opts.signal);
    if (covered.has(c)) continue;
    const P = new Set<number>();
    const T = new Set<number>([c]);
    const pending = [c];
    const doneProc = new Set<string>();
    let feasible = true;
    while (pending.length) {
      const t = pending.pop()!;
      covered.add(t);
      for (const j of procsOfT(t)) {
        const k = `${j}:${t}`;
        if (doneProc.has(k)) continue;
        doneProc.add(k);
        const path = pathIn(j, t);
        if (!path) {
          feasible = false;
          continue;
        }
        path.places.forEach((p) => P.add(p));
        for (const u of path.transitions)
          if (!T.has(u)) {
            T.add(u);
            if (comm.has(u)) pending.push(u);
          }
      }
      s.cond[t].forEach((p) => P.add(p));
    }
    sets.push({
      places: [...P].sort((a, b) => a - b),
      transitions: [...T].sort((a, b) => a - b),
      reason: `Concurrency set for ${pt.transitions[c].name}${feasible ? "" : " (some process has no path from its initial tokens)"}`,
    });
  }
  return sets;
}

// ---------------------------------------------------------------------------------------------
// The slice as a net, evolution of a net (survey Sec. 8.3).

/**
 * The slice as an uncoloured net that can be opened, edited and exported (PNML, ANDL, LoLA, …):
 * the places, transitions and arcs of the analysed (unfolded) net that the slice keeps, at their
 * positions, with merged markings and arcs. Needs the slice of a P/T view built by {@link toPTNet}.
 */
export function sliceToNet(slice: NetSlice, name?: string): Net {
  const pt = slice.pt;
  const work = pt.work;
  if (!work || !pt.slotMembers) throw new Error("The slice does not come from a net built with toPTNet");
  const placeById = new Map(work.places.map((p) => [p.id, p]));
  const transById = new Map(work.transitions.map((t) => [t.id, t]));
  const arcById = new Map(work.arcs.map((a) => [a.id, a]));
  const places: Place[] = [];
  pt.slotMembers.forEach((members, i) => {
    members.forEach((id, k) => {
      const src = placeById.get(id);
      if (!src) return;
      places.push({ ...src, marking: k === 0 ? String(pt.m0[i]) : src.marking });
    });
  });
  const transitions: Transition[] = pt.transitions.map((t) => transById.get(t.id)).filter((t): t is Transition => !!t);
  const arcs: Arc[] = [];
  const used = new Set<string>();
  for (const a of pt.arcs) {
    const src = arcById.get(a.arcId);
    const transId = pt.transitions[a.transition].id;
    // Keep the arc's own place end (any member of a logical place), unless abstract slicing moved
    // the arc to another place; then it ends at that place.
    const members = pt.slotMembers[a.place];
    const ownEnd = src ? (a.dir === "in" ? src.source : src.target) : undefined;
    const moved = !ownEnd || !members.includes(ownEnd);
    const placeId = moved ? members[0] : ownEnd!;
    const id = src && !used.has(src.id) ? src.id : `${a.arcId}__s${arcs.length}`;
    used.add(id);
    const arc: Arc = {
      ...(src ?? {}),
      id,
      source: a.dir === "in" ? placeId : transId,
      target: a.dir === "in" ? transId : placeId,
      kind: a.kind,
      inscription: a.weight !== null ? String(a.weight) : (src?.inscription ?? "1"),
    };
    if (moved) delete arc.points;
    arcs.push(arc);
  }
  return {
    ...work,
    name: name ?? `${work.name} (slice)`,
    places,
    transitions,
    arcs,
  };
}

/** One change between two versions of a net, by element name. */
export interface NetChange {
  kind: "place added" | "place removed" | "marking changed" | "capacity changed" | "transition added" | "transition removed" | "arc added" | "arc removed" | "arc changed";
  /** Names of the places and transitions involved. */
  places: string[];
  transitions: string[];
  text: string;
}

export interface EvolutionResult {
  /** "preserved": the change lies outside both slices, so every property the slice preserves keeps its verdict; "recheck": verify again (on the new slice). */
  verdict: "preserved" | "recheck";
  /** Every change between the two versions. */
  changes: NetChange[];
  /** The changes that touch the old or the new slice. */
  relevant: NetChange[];
  before: NetSlice;
  after: NetSlice;
}

const arcKey = (pt: PTNet, a: PTArc) => `${a.dir}|${a.kind}|${pt.places[a.place].name}|${pt.transitions[a.transition].name}`;

/** The changes between two versions of a net (places, markings, capacities, transitions and arcs, by name). */
export function netChanges(before: PTNet, after: PTNet): NetChange[] {
  const out: NetChange[] = [];
  const bp = new Map(before.places.map((p, i) => [p.name, i]));
  const ap = new Map(after.places.map((p, i) => [p.name, i]));
  for (const [n, i] of bp) {
    const j = ap.get(n);
    if (j === undefined) out.push({ kind: "place removed", places: [n], transitions: [], text: `Place ${n} removed` });
    else {
      if (before.m0[i] !== after.m0[j]) out.push({ kind: "marking changed", places: [n], transitions: [], text: `Initial marking of ${n}: ${before.m0[i]} → ${after.m0[j]}` });
      if (before.capacity[i] !== after.capacity[j]) out.push({ kind: "capacity changed", places: [n], transitions: [], text: `Capacity of ${n}: ${before.capacity[i] ?? "none"} → ${after.capacity[j] ?? "none"}` });
    }
  }
  for (const n of ap.keys()) if (!bp.has(n)) out.push({ kind: "place added", places: [n], transitions: [], text: `Place ${n} added` });
  const bt = new Set(before.transitions.map((t) => t.name));
  const at = new Set(after.transitions.map((t) => t.name));
  for (const n of bt) if (!at.has(n)) out.push({ kind: "transition removed", places: [], transitions: [n], text: `Transition ${n} removed` });
  for (const n of at) if (!bt.has(n)) out.push({ kind: "transition added", places: [], transitions: [n], text: `Transition ${n} added` });
  const weights = (pt: PTNet) => {
    const m = new Map<string, { w: string; a: PTArc }>();
    for (const a of pt.arcs) {
      const k = arcKey(pt, a);
      const old = m.get(k);
      const w = a.weight === null ? "expr" : String(a.weight);
      m.set(k, { w: old ? `${old.w}+${w}` : w, a });
    }
    return m;
  };
  const bw = weights(before);
  const aw = weights(after);
  const describe = (pt: PTNet, a: PTArc) => ({ places: [pt.places[a.place].name], transitions: [pt.transitions[a.transition].name] });
  for (const [k, v] of bw) {
    const o = aw.get(k);
    if (!o) out.push({ kind: "arc removed", ...describe(before, v.a), text: `Arc ${v.a.label} (${v.a.kind}) removed` });
    else if (o.w !== v.w) out.push({ kind: "arc changed", ...describe(after, o.a), text: `Arc ${o.a.label}: weight ${v.w} → ${o.w}` });
  }
  for (const [k, v] of aw) if (!bw.has(k)) out.push({ kind: "arc added", ...describe(after, v.a), text: `Arc ${v.a.label} (${v.a.kind}) added` });
  return out;
}

/**
 * Survey Sec. 8.3, alleviating repeated model checking: after a net evolves, slice the old and the
 * new version for a property's criterion. When no change touches either slice, the slices are the
 * same net and every property the algorithm preserves keeps its verdict; otherwise check again,
 * on the new slice. The criterion is given by name so that it means the same in both versions.
 */
export function evolutionImpact(before: PTNet, after: PTNet, criterion: SlicingCriterion, opts: SliceOptions = {}): EvolutionResult {
  const sb = sliceNet(before, criterion, opts);
  const sa = sliceNet(after, criterion, opts);
  const changes = netChanges(before, after);
  const names = (sl: NetSlice, pt: PTNet) => ({
    places: new Set([...sl.places, ...sl.merges.map((m) => m.place)].map((p) => pt.places[p].name)),
    transitions: new Set([...sl.transitions, ...sl.merges.map((m) => m.transition), ...sl.parallel.map((x) => x.removed)].map((t) => pt.transitions[t].name)),
  });
  const inSlice = [names(sb, before), names(sa, after)];
  const relevant = changes.filter((c) => inSlice.some((n) => c.places.some((p) => n.places.has(p)) || c.transitions.some((t) => n.transitions.has(t))));
  // Equal slices give equal verdicts for every property the algorithm preserves.
  return { verdict: sameSlice(sb.pt, sa.pt) ? "preserved" : "recheck", changes, relevant, before: sb, after: sa };
}

function sameSlice(a: PTNet, b: PTNet): boolean {
  if (a.places.length !== b.places.length || a.transitions.length !== b.transitions.length || a.arcs.length !== b.arcs.length) return false;
  const pa = a.places.map((p, i) => `${p.name}=${a.m0[i]}/${a.capacity[i] ?? ""}`).sort();
  const pb = b.places.map((p, i) => `${p.name}=${b.m0[i]}/${b.capacity[i] ?? ""}`).sort();
  if (pa.join() !== pb.join()) return false;
  const ka = a.arcs.map((x) => `${arcKey(a, x)}=${x.weight}`).sort();
  const kb = b.arcs.map((x) => `${arcKey(b, x)}=${x.weight}`).sort();
  return ka.join() === kb.join();
}
