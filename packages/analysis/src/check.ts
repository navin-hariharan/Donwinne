// Explicit-state CTL model checking over a transition system (labelling algorithm), with
// witnesses and counterexamples as firing (or step) sequences from the initial state.

import { bindCtl, formatCtl, parseCtl, type BoundFormula, type BoundTerm, type CtlFormula, type UnaryTemporal } from "./ctl";
import { checkAbort } from "./ptnet";
import { labelText, markingOf, openStates, predecessors, type Predecessors, type TransitionSystem } from "./ts";
import type { NodeRef } from "./types";

/**
 * How states without successors (deadlocks) are treated.
 * - "stutter" (default): a dead state keeps repeating itself, as if it had a self-loop; EX φ and
 *   AX φ both mean φ there. This is the textbook way of making the transition relation total.
 * - "maximal": paths may end in a dead state; EX φ is false and AX φ is true there.
 * The other operators give the same answers under both readings.
 */
export type DeadlockSemantics = "stutter" | "maximal";

export interface CtlOptions {
  deadlocks?: DeadlockSemantics;
  /** Abort the check; it then throws an Error named "AbortError". */
  signal?: AbortSignal;
  /** Compute a witness or counterexample (default true). */
  trace?: boolean;
}

/** One firing (interleaving) or step (step semantics) along a trace. */
export interface TraceStep {
  /** State before and after. */
  from: number;
  to: number;
  /** The fired transitions: one under interleaving semantics, several for a step. */
  transitions: NodeRef[];
  /** Readable label, e.g. "t1" or "{t1, t2}". */
  label: string;
}

/** A path from the initial state that shows why a formula holds (witness) or fails (counterexample). */
export interface CtlTrace {
  kind: "witness" | "counterexample";
  /** One or two sentences in plain English. */
  explanation: string;
  /** Visited states, starting with the initial state 0. */
  states: number[];
  /** steps[i] leads from states[i] to states[i + 1]. */
  steps: TraceStep[];
  /** Marked places of each visited state, by display name. */
  markings: Record<string, number>[];
  /** Infinite path: after the last state the path returns to states[loopsBackTo] and repeats. */
  loopsBackTo?: number;
  /** The path ends in a dead state (under "stutter" it stays there forever). */
  endsInDeadlock?: boolean;
}

export interface CtlResult {
  /** The formula as checked, in canonical form. */
  formula: string;
  /**
   * "true"/"false": the verdict in the initial state. "unknown": the state space is incomplete
   * and the verdict on the explored part does not carry over (see `holds`).
   */
  status: "true" | "false" | "unknown";
  /** Verdict in the initial state of the (possibly partial) transition system. */
  holds: boolean;
  /** States (indices into the transition system) that satisfy the formula. */
  satisfyingStates: number[];
  stateCount: number;
  complete: boolean;
  /** Witness (when it holds) or counterexample (when it fails), where CTL allows one. */
  trace?: CtlTrace;
  notes: string[];
}

type Seg = { states: number[]; edges: number[]; loopTo?: number; dead?: boolean };

/** Three-valued state sets (1 = member): lo = states where the formula certainly holds, hi = where it may hold. */
export type CtlBounds = { lo: Uint8Array; hi: Uint8Array };

/**
 * Model checker bound to one transition system: reuse it to check many formulas without
 * recomputing the predecessor relation.
 */
export class CtlChecker {
  readonly n: number;
  private pred?: Predecessors;
  private readonly memo = new Map<BoundFormula, Uint8Array>();
  private readonly memo3 = new Map<BoundFormula, CtlBounds>();
  /** States without listed successors. */
  private readonly dead: Uint8Array;
  /** Incomplete systems: states whose successors may be missing; dead states that are not open. */
  private readonly open?: Uint8Array;
  private readonly deadSure: Uint8Array;
  /** While explaining a conclusive verdict on an incomplete system: use the three-valued sets. */
  private threeValued = false;
  readonly deadlocks: DeadlockSemantics;

  constructor(
    readonly ts: TransitionSystem,
    private readonly opts: CtlOptions = {},
  ) {
    this.n = ts.markings.length;
    this.deadlocks = opts.deadlocks ?? "stutter";
    this.dead = new Uint8Array(this.n);
    for (let s = 0; s < this.n; s++) if (ts.edgeStart[s] === ts.edgeStart[s + 1]) this.dead[s] = 1;
    this.open = openStates(ts);
    this.deadSure = this.dead;
    if (this.open) {
      this.deadSure = new Uint8Array(this.n);
      for (let s = 0; s < this.n; s++) this.deadSure[s] = this.dead[s] & (1 - this.open[s]);
    }
  }

  private get preds(): Predecessors {
    return (this.pred ??= predecessors(this.ts));
  }

  /** Parse (if needed), bind and check a formula in the initial state. Throws CtlError for bad formulas. */
  check(formula: string | CtlFormula): CtlResult {
    const text = typeof formula === "string" ? formula : "";
    const f = typeof formula === "string" ? parseCtl(formula) : formula;
    const b = bindCtl(f, this.ts, text);
    const sat = this.sat(b);
    const holds = this.n > 0 && sat[0] === 1;
    const satisfyingStates: number[] = [];
    for (let s = 0; s < this.n; s++) if (sat[s]) satisfyingStates.push(s);
    const notes = [...this.ts.notes];
    let status: CtlResult["status"] = holds ? "true" : "false";
    if (!this.ts.complete && this.n > 0) {
      const { lo, hi } = this.bounds(b);
      status = lo[0] ? "true" : hi[0] ? "unknown" : "false";
      if (status === "unknown") notes.push("The state space is incomplete and the verdict depends on the part not explored, so it is not conclusive.");
      else notes.push("The state space is incomplete, but the verdict does not depend on the part not explored.");
    }
    if (this.n === 0) notes.push("The transition system has no states.");
    const result: CtlResult = { formula: formatCtl(f), status, holds, satisfyingStates, stateCount: this.n, complete: this.ts.complete, notes };
    if (this.opts.trace !== false && this.n > 0) {
      this.threeValued = !this.ts.complete && status !== "unknown";
      try {
        const trace = this.trace(b, holds);
        if (trace) result.trace = trace;
      } finally {
        this.threeValued = false;
      }
    }
    return result;
  }

  /** The set of states satisfying a bound formula (1 = satisfied), memoised per formula node. */
  sat(f: BoundFormula): Uint8Array {
    const hit = this.memo.get(f);
    if (hit) return hit;
    checkAbort(this.opts.signal);
    const r = this.compute(f);
    this.memo.set(f, r);
    return r;
  }

  private value(t: BoundTerm, s: number): number {
    if (t.kind === "num") return t.value;
    const M = this.ts.markings[s];
    let v = 0;
    for (const p of t.places) v += M[p];
    return v;
  }

  private compute(f: BoundFormula): Uint8Array {
    const n = this.n;
    const ts = this.ts;
    const out = new Uint8Array(n);
    switch (f.kind) {
      case "const":
        if (f.value) out.fill(1);
        return out;
      case "deadlock":
        out.set(this.dead);
        return out;
      case "fireable": {
        const want = new Set(f.transitions);
        const lab = ts.labels.map((l) => (l.some((t) => want.has(t)) ? 1 : 0));
        for (let s = 0; s < n; s++)
          for (let e = ts.edgeStart[s]; e < ts.edgeStart[s + 1]; e++)
            if (lab[ts.edgeLabel[e]]) {
              out[s] = 1;
              break;
            }
        return out;
      }
      case "cmp": {
        for (let s = 0; s < n; s++) {
          const a = this.value(f.left, s);
          const b = this.value(f.right, s);
          let v: boolean;
          switch (f.op) {
            case "==": v = a === b; break;
            case "!=": v = a !== b; break;
            case "<": v = a < b; break;
            case "<=": v = a <= b; break;
            case ">": v = a > b; break;
            default: v = a >= b;
          }
          if (v) out[s] = 1;
        }
        return out;
      }
      case "not": {
        const a = this.sat(f.arg);
        for (let s = 0; s < n; s++) out[s] = 1 - a[s];
        return out;
      }
      case "and":
      case "or":
      case "implies":
      case "iff": {
        const a = this.sat(f.left);
        const b = this.sat(f.right);
        for (let s = 0; s < n; s++)
          out[s] = f.kind === "and" ? a[s] & b[s] : f.kind === "or" ? a[s] | b[s] : f.kind === "implies" ? (1 - a[s]) | b[s] : a[s] === b[s] ? 1 : 0;
        return out;
      }
      case "EX":
      case "AX": {
        const a = this.sat(f.arg);
        const all = f.kind === "AX";
        for (let s = 0; s < n; s++) {
          if (this.dead[s]) {
            out[s] = this.deadlocks === "stutter" ? a[s] : all ? 1 : 0;
            continue;
          }
          let v = all ? 1 : 0;
          for (let e = ts.edgeStart[s]; e < ts.edgeStart[s + 1]; e++) {
            const x = a[ts.edgeTo[e]];
            if (all ? !x : x) {
              v = all ? 0 : 1;
              break;
            }
          }
          out[s] = v;
        }
        return out;
      }
      case "EF":
        return this.eu(new Uint8Array(n).fill(1), this.sat(f.arg));
      case "EU":
        return this.eu(this.sat(f.left), this.sat(f.right));
      case "AF":
        return this.au(new Uint8Array(n).fill(1), this.sat(f.arg));
      case "AU":
        return this.au(this.sat(f.left), this.sat(f.right));
      case "EG":
        return this.eg(this.sat(f.arg));
      case "AG": {
        // AG φ = ¬E[true U ¬φ]
        const a = this.sat(f.arg);
        const na = new Uint8Array(n);
        for (let s = 0; s < n; s++) na[s] = 1 - a[s];
        const ef = this.eu(new Uint8Array(n).fill(1), na);
        for (let s = 0; s < n; s++) out[s] = 1 - ef[s];
        return out;
      }
    }
  }

  /** E[a U b]: backward search from b through a-states. */
  private eu(a: Uint8Array, b: Uint8Array): Uint8Array {
    const n = this.n;
    const { start, from } = this.preds;
    const out = new Uint8Array(n);
    const queue: number[] = [];
    for (let s = 0; s < n; s++)
      if (b[s]) {
        out[s] = 1;
        queue.push(s);
      }
    for (let h = 0; h < queue.length; h++) {
      if ((h & 4095) === 0) checkAbort(this.opts.signal);
      const v = queue[h];
      for (let k = start[v]; k < start[v + 1]; k++) {
        const u = from[k];
        if (!out[u] && a[u]) {
          out[u] = 1;
          queue.push(u);
        }
      }
    }
    return out;
  }

  /** A[a U b]: a state joins once it is b, or it is a, not dead, and all its successors joined. */
  private au(a: Uint8Array, b: Uint8Array): Uint8Array {
    const n = this.n;
    const ts = this.ts;
    const { start, from } = this.preds;
    const out = new Uint8Array(n);
    const remaining = new Int32Array(n);
    for (let s = 0; s < n; s++) remaining[s] = ts.edgeStart[s + 1] - ts.edgeStart[s];
    const queue: number[] = [];
    for (let s = 0; s < n; s++)
      if (b[s]) {
        out[s] = 1;
        queue.push(s);
      }
    for (let h = 0; h < queue.length; h++) {
      if ((h & 4095) === 0) checkAbort(this.opts.signal);
      const v = queue[h];
      for (let k = start[v]; k < start[v + 1]; k++) {
        const u = from[k];
        if (out[u] || !a[u]) continue;
        if (--remaining[u] === 0) {
          out[u] = 1;
          queue.push(u);
        }
      }
    }
    return out;
  }

  /**
   * EG a: greatest fixpoint; dead a-states satisfy it (their maximal path, or stutter loop, stays
   * in a). States in `keep` (default: the dead ones) are never removed for lack of a successor.
   */
  private eg(a: Uint8Array, keep: Uint8Array = this.dead): Uint8Array {
    const n = this.n;
    const ts = this.ts;
    const { start, from } = this.preds;
    const out = new Uint8Array(a);
    const cnt = new Int32Array(n);
    for (let s = 0; s < n; s++) {
      if (!out[s]) continue;
      for (let e = ts.edgeStart[s]; e < ts.edgeStart[s + 1]; e++) if (out[ts.edgeTo[e]]) cnt[s]++;
    }
    const queue: number[] = [];
    for (let s = 0; s < n; s++)
      if (out[s] && !keep[s] && cnt[s] === 0) {
        out[s] = 0;
        queue.push(s);
      }
    for (let h = 0; h < queue.length; h++) {
      if ((h & 4095) === 0) checkAbort(this.opts.signal);
      const v = queue[h];
      for (let k = start[v]; k < start[v + 1]; k++) {
        const u = from[k];
        if (!out[u]) continue;
        if (--cnt[u] === 0 && !keep[u]) {
          out[u] = 0;
          queue.push(u);
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------ three-valued checking

  /**
   * Bounds for an incomplete system: an open state may have successors that are not listed, so
   * lo holds where the formula is true whatever they are, hi where it is true for some of them.
   * Complete systems give lo = hi = sat.
   */
  bounds(f: BoundFormula): CtlBounds {
    if (!this.open) {
      const s = this.sat(f);
      return { lo: s, hi: s };
    }
    const hit = this.memo3.get(f);
    if (hit) return hit;
    checkAbort(this.opts.signal);
    const r = this.compute3(f);
    this.memo3.set(f, r);
    return r;
  }

  private compute3(f: BoundFormula): CtlBounds {
    const n = this.n;
    const ts = this.ts;
    const open = this.open!;
    const neg = (b: CtlBounds): CtlBounds => ({ lo: this.not(b.hi), hi: this.not(b.lo) });
    const mk = (kind: UnaryTemporal | "not", arg: BoundFormula): BoundFormula => ({ kind, arg, src: f.src }) as BoundFormula;
    switch (f.kind) {
      case "const":
      case "cmp": {
        const s = this.sat(f);
        return { lo: s, hi: s };
      }
      case "deadlock":
        return { lo: this.deadSure, hi: this.dead };
      case "fireable": {
        const lo = this.sat(f);
        const hi = new Uint8Array(n);
        for (let s = 0; s < n; s++) hi[s] = lo[s] | open[s];
        return { lo, hi };
      }
      case "not":
        return neg(this.bounds(f.arg));
      case "and":
      case "or":
      case "implies":
      case "iff": {
        const a = this.bounds(f.left);
        const b = this.bounds(f.right);
        const lo = new Uint8Array(n);
        const hi = new Uint8Array(n);
        for (let s = 0; s < n; s++) {
          if (f.kind === "and") {
            lo[s] = a.lo[s] & b.lo[s];
            hi[s] = a.hi[s] & b.hi[s];
          } else if (f.kind === "or") {
            lo[s] = a.lo[s] | b.lo[s];
            hi[s] = a.hi[s] | b.hi[s];
          } else if (f.kind === "implies") {
            lo[s] = (1 - a.hi[s]) | b.lo[s];
            hi[s] = (1 - a.lo[s]) | b.hi[s];
          } else {
            lo[s] = (a.lo[s] & b.lo[s]) | ((1 - a.hi[s]) & (1 - b.hi[s]));
            hi[s] = (a.hi[s] & b.hi[s]) | ((1 - a.lo[s]) & (1 - b.lo[s]));
          }
        }
        return { lo, hi };
      }
      case "EX": {
        const a = this.bounds(f.arg);
        const lo = new Uint8Array(n);
        const hi = new Uint8Array(n);
        for (let s = 0; s < n; s++) {
          if (this.deadSure[s]) {
            if (this.deadlocks === "stutter") {
              lo[s] = a.lo[s];
              hi[s] = a.hi[s];
            }
            continue;
          }
          if (open[s]) hi[s] = 1;
          for (let e = ts.edgeStart[s]; e < ts.edgeStart[s + 1]; e++) {
            const w = ts.edgeTo[e];
            lo[s] |= a.lo[w];
            hi[s] |= a.hi[w];
          }
        }
        return { lo, hi };
      }
      case "AX":
        return neg(this.bounds(mk("EX", mk("not", f.arg))));
      case "EF":
      case "EU": {
        const bin = f.kind === "EU" ? (f as Extract<BoundFormula, { left: BoundFormula }>) : undefined;
        const a = bin ? this.bounds(bin.left) : { lo: new Uint8Array(n).fill(1), hi: new Uint8Array(n).fill(1) };
        const b = this.bounds(bin ? bin.right : (f as Extract<BoundFormula, { arg: BoundFormula }>).arg);
        // hi: a b-state, or an a-state that is open or leads (through a-states) to one.
        const seed = new Uint8Array(n);
        for (let s = 0; s < n; s++) seed[s] = b.hi[s] | (a.hi[s] & open[s]);
        return { lo: this.eu(a.lo, b.lo), hi: this.eu(a.hi, seed) };
      }
      case "EG": {
        const a = this.bounds(f.arg);
        const keepHi = new Uint8Array(n);
        for (let s = 0; s < n; s++) keepHi[s] = this.dead[s] | open[s];
        return { lo: this.eg(a.lo, this.deadSure), hi: this.eg(a.hi, keepHi) };
      }
      case "AG":
        // AG φ = ¬EF ¬φ
        return neg(this.bounds(mk("EF", mk("not", f.arg))));
      case "AF":
        // AF φ = ¬EG ¬φ
        return neg(this.bounds(mk("EG", mk("not", f.arg))));
      case "AU": {
        // A[φ U ψ] = ¬(E[¬ψ U ¬φ ∧ ¬ψ] ∨ EG ¬ψ)
        const nl = mk("not", f.left);
        const nr = mk("not", f.right);
        const both: BoundFormula = { kind: "and", left: nl, right: nr, src: f.src };
        const eu: BoundFormula = { kind: "EU", left: nr, right: both, src: f.src };
        const either: BoundFormula = { kind: "or", left: eu, right: mk("EG", nr), src: f.src };
        return neg(this.bounds(either));
      }
    }
  }

  /** The set a trace relies on for "g has value w": the plain labelling, or the conclusive bound. */
  private S(g: BoundFormula, w: boolean): Uint8Array {
    if (!this.threeValued) return this.sat(g);
    const b = this.bounds(g);
    return w ? b.lo : b.hi;
  }

  /** Dead states a trace may end in. */
  private get deadE(): Uint8Array {
    return this.threeValued ? this.deadSure : this.dead;
  }

  // ------------------------------------------------------------ witnesses and counterexamples

  /** Shortest path from s through states in `via` (s itself need not be in via) to a state in `goal`. */
  private bfs(s: number, via: Uint8Array | null, goal: Uint8Array): Seg | undefined {
    if (goal[s]) return { states: [s], edges: [] };
    const ts = this.ts;
    const parent = new Map<number, number>([[s, -1]]);
    const queue = [s];
    for (let h = 0; h < queue.length; h++) {
      const v = queue[h];
      if (h !== 0 && via && !via[v]) continue;
      for (let e = ts.edgeStart[v]; e < ts.edgeStart[v + 1]; e++) {
        const w = ts.edgeTo[e];
        if (parent.has(w)) continue;
        parent.set(w, e);
        if (goal[w]) {
          const edges: number[] = [];
          const states = [w];
          let x = w;
          while (x !== s) {
            const pe = parent.get(x)!;
            edges.push(pe);
            x = this.source(pe);
            states.push(x);
          }
          return { states: states.reverse(), edges: edges.reverse() };
        }
        queue.push(w);
      }
    }
    return undefined;
  }

  private sourceIndex?: Int32Array;
  private source(e: number): number {
    if (!this.sourceIndex) {
      const src = new Int32Array(this.ts.edgeTo.length);
      for (let s = 0; s < this.n; s++) for (let k = this.ts.edgeStart[s]; k < this.ts.edgeStart[s + 1]; k++) src[k] = s;
      this.sourceIndex = src;
    }
    return this.sourceIndex[e];
  }

  /**
   * Walk from s through states in `stay`, preferring successors already on the path, until the
   * path closes a loop or reaches a dead state. `stay` must contain s and, for every non-dead
   * member, one of its successors.
   */
  private lasso(s: number, stay: Uint8Array): Seg {
    const ts = this.ts;
    const pos = new Map<number, number>([[s, 0]]);
    const states = [s];
    const edges: number[] = [];
    let v = s;
    for (;;) {
      if (this.deadE[v]) return { states, edges, dead: true, loopTo: states.length - 1 };
      let next = -1;
      let nextE = -1;
      for (let e = ts.edgeStart[v]; e < ts.edgeStart[v + 1]; e++) {
        const w = ts.edgeTo[e];
        if (!stay[w]) continue;
        if (pos.has(w)) {
          edges.push(e);
          return { states, edges, loopTo: pos.get(w)! };
        }
        if (next < 0) {
          next = w;
          nextE = e;
        }
      }
      if (next < 0) return { states, edges }; // should not happen
      edges.push(nextE);
      pos.set(next, states.length);
      states.push(next);
      v = next;
    }
  }

  private join(a: Seg, b: Seg): Seg {
    if (a.loopTo !== undefined) return a;
    return {
      states: [...a.states, ...b.states.slice(1)],
      edges: [...a.edges, ...b.edges],
      ...(b.loopTo !== undefined ? { loopTo: b.loopTo + a.states.length - 1 } : {}),
      ...(b.dead ? { dead: true } : {}),
    };
  }

  private not(a: Uint8Array): Uint8Array {
    const r = new Uint8Array(this.n);
    for (let s = 0; s < this.n; s++) r[s] = 1 - a[s];
    return r;
  }

  /** Path evidence for "f has value `want` in state s" (a single state when no path is needed). */
  private explain(f: BoundFormula, s: number, want: boolean, depth = 0): Seg {
    const here: Seg = { states: [s], edges: [] };
    if (depth > 40) return here;
    const ts = this.ts;
    const pick = (opts: [BoundFormula, boolean][]): Seg => {
      let best = here;
      for (const [g, w] of opts) {
        if ((this.S(g, w)[s] === 1) !== w) continue;
        const seg = this.explain(g, s, w, depth + 1);
        if (seg.edges.length || seg.loopTo !== undefined) return seg;
        best = seg;
      }
      return best;
    };
    switch (f.kind) {
      case "const":
      case "deadlock":
      case "fireable":
      case "cmp":
        return here;
      case "not":
        return this.explain(f.arg, s, !want, depth + 1);
      case "and":
        return pick([[f.left, want], [f.right, want]]);
      case "or":
        return pick([[f.left, want], [f.right, want]]);
      case "implies":
        if (!want) return this.explain(f.right, s, false, depth + 1);
        return pick([[f.left, false], [f.right, true]]);
      case "iff": {
        const l = this.S(f.left, true)[s] === 1 ? true : this.S(f.left, false)[s] === 0 ? false : undefined;
        if (l === undefined) return here;
        return pick([[f.left, l], [f.right, want ? l : !l]]);
      }
      case "EX":
      case "AX": {
        const a = this.S(f.arg, want);
        const existential = f.kind === "EX";
        if (existential !== want) return here; // EX false, AX true: every successor, no single path
        if (this.deadE[s]) return this.deadlocks === "stutter" ? { ...this.explain(f.arg, s, want, depth + 1), dead: true } : here;
        for (let e = ts.edgeStart[s]; e < ts.edgeStart[s + 1]; e++) {
          const w = ts.edgeTo[e];
          if ((a[w] === 1) === want) return this.join({ states: [s, w], edges: [e] }, this.explain(f.arg, w, want, depth + 1));
        }
        return here;
      }
      case "EF":
      case "AG": {
        const existential = f.kind === "EF";
        if (existential !== want) return here;
        const a = this.S(f.arg, want);
        const goal = want ? a : this.not(a);
        const seg = this.bfs(s, null, goal);
        return seg ? this.join(seg, this.explain(f.arg, seg.states[seg.states.length - 1], want, depth + 1)) : here;
      }
      case "EU": {
        if (!want) return here;
        const seg = this.bfs(s, this.S(f.left, true), this.S(f.right, true));
        return seg ? this.join(seg, this.explain(f.right, seg.states[seg.states.length - 1], true, depth + 1)) : here;
      }
      case "AF":
      case "AU": {
        if (want) return here;
        // ¬A[φ U ψ] = E[¬ψ U ¬φ ∧ ¬ψ] ∨ EG ¬ψ (AF: φ = true).
        const bin = f.kind === "AU" ? (f as Extract<BoundFormula, { left: BoundFormula }>) : undefined;
        const left = bin ? this.S(bin.left, false) : new Uint8Array(this.n).fill(1);
        const right = this.S(bin ? bin.right : (f as Extract<BoundFormula, { arg: BoundFormula }>).arg, false);
        const notRight = this.not(right);
        // Through ¬ψ states to a state with ¬φ ∧ ¬ψ ...
        if (bin) {
          const bad = new Uint8Array(this.n);
          for (let x = 0; x < this.n; x++) bad[x] = (1 - left[x]) & notRight[x];
          const seg = this.bfs(s, notRight, bad);
          if (seg) return seg;
        }
        // ... or forever (or until a deadlock) through ¬ψ states.
        const stay = this.eg(notRight, this.deadE);
        return stay[s] ? this.lasso(s, stay) : here;
      }
      case "EG": {
        if (!want) return here;
        return this.lasso(s, this.S(f, true));
      }
    }
  }

  private trace(f: BoundFormula, holds: boolean): CtlTrace | undefined {
    const seg = this.explain(f, 0, holds);
    if (!seg.edges.length && seg.loopTo === undefined && !seg.dead) return undefined;
    const ts = this.ts;
    const steps: TraceStep[] = seg.edges.map((e, i) => ({
      from: seg.states[i],
      to: ts.edgeTo[e],
      transitions: ts.labels[ts.edgeLabel[e]].map((t) => ts.transitions[t]),
      label: labelText(ts, ts.edgeLabel[e]),
    }));
    // A closing edge of a loop leads back to an earlier state: states has one fewer entry than steps then.
    const seq = steps.map((s) => s.label).join(" ");
    const loop = seg.loopTo !== undefined && !seg.dead;
    const what = describe(f.src, holds);
    let explanation = `${what ? `${what} ` : ""}${steps.length ? `Firing ${seq}` : "The initial state"}`;
    if (seg.dead) explanation += `${steps.length ? " reaches" : " is"} a dead state${this.deadlocks === "stutter" ? ", where the system stays forever" : ""}.`;
    else if (loop) explanation += ` and then repeating it from state ${seg.states[seg.loopTo!]} forever shows this.`;
    else explanation += " shows this.";
    return {
      kind: holds ? "witness" : "counterexample",
      explanation,
      states: seg.states,
      steps,
      markings: seg.states.map((s) => markingOf(ts, s)),
      ...(loop ? { loopsBackTo: seg.loopTo } : {}),
      ...(seg.dead ? { endsInDeadlock: true } : {}),
    };
  }
}

/** One sentence on what the trace demonstrates, from the top operator. */
function describe(f: CtlFormula, holds: boolean): string {
  let g = f;
  let pol = holds;
  while (g.kind === "not") {
    g = g.arg;
    pol = !pol;
  }
  const text = formatCtl(g);
  const short = text.length > 80 ? `${text.slice(0, 77)}…` : text;
  switch (g.kind) {
    case "EF":
      return pol ? `A reachable state satisfies ${formatCtl(g.arg)}.` : "";
    case "AG":
      return pol ? "" : `Not every reachable state satisfies ${formatCtl(g.arg).slice(0, 80)}.`;
    case "EG":
      return pol ? `Some path satisfies ${formatCtl(g.arg).slice(0, 80)} all along.` : "";
    case "AF":
      return pol ? "" : `Some path never satisfies ${formatCtl(g.arg).slice(0, 80)}.`;
    case "EU":
    case "AU":
      return pol ? `${short} holds.` : `${short} fails.`;
    case "EX":
      return pol ? `Some successor satisfies ${formatCtl(g.arg)}.` : "";
    case "AX":
      return pol ? "" : `Some successor violates ${formatCtl(g.arg)}.`;
    default:
      return pol ? `${short} holds.` : `${short} fails.`;
  }
}

/**
 * Check a CTL formula in the initial state of a transition system. Throws a CtlError if the
 * formula does not parse or names an unknown place or transition.
 */
export function checkCtl(ts: TransitionSystem, formula: string | CtlFormula, opts: CtlOptions = {}): CtlResult {
  return new CtlChecker(ts, opts).check(formula);
}
