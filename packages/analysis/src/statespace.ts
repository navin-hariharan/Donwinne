// Reachability graph of the P/T view (same firing rule as @pns/core for uncoloured nets, on
// integer vectors), its terminal strongly connected components, and Karp–Miller coverability.

import { evaluate, num } from "@pns/core";
import { checkAbort, type PTArc, type PTNet } from "./ptnet";
import { scc } from "./structure";

/** Firing rule on integer markings. */
export class Firer {
  private readonly ins: PTArc[][];
  private readonly outs: PTArc[][];
  private readonly slotCaps: [number, number][];
  /** Constant-weight transitions: aggregated consumption (place, weight) pairs for a quick enabling test. */
  private readonly need: (Int32Array | null)[];
  /** Transitions with only normal/read arcs of constant weight (and no capacities): (place, change) pairs. */
  private readonly delta: (Int32Array | null)[];

  constructor(private readonly pt: PTNet) {
    const m = pt.transitions.length;
    this.ins = Array.from({ length: m }, () => []);
    this.outs = Array.from({ length: m }, () => []);
    for (const a of pt.arcs) (a.dir === "in" ? this.ins : this.outs)[a.transition].push(a);
    this.need = this.ins.map((arcs, t) => {
      if ([...arcs, ...this.outs[t]].some((a) => a.weight === null)) return null;
      // Necessary condition: Σ normal weights and the largest read weight per place.
      const sum = new Map<number, number>();
      const read = new Map<number, number>();
      for (const a of arcs)
        if (a.kind === "normal") sum.set(a.place, (sum.get(a.place) ?? 0) + a.weight!);
        else if (a.kind === "read") read.set(a.place, Math.max(read.get(a.place) ?? 0, a.weight!));
      const agg = new Map(sum);
      for (const [p, w] of read) agg.set(p, Math.max(agg.get(p) ?? 0, w));
      return Int32Array.from([...agg].flat());
    });
    const plain = !pt.modulus && pt.capacity.every((c) => c === undefined);
    this.delta = this.ins.map((arcs, t) => {
      const all = [...arcs, ...this.outs[t]];
      if (!plain || all.some((a) => a.weight === null || (a.kind !== "normal" && a.kind !== "read"))) return null;
      const d = new Map<number, number>();
      for (const a of all) if (a.kind === "normal") d.set(a.place, (d.get(a.place) ?? 0) + (a.dir === "in" ? -a.weight! : a.weight!));
      return Int32Array.from([...d].filter(([, v]) => v !== 0).flat());
    });
    this.slotCaps = [];
    pt.capacity.forEach((c, i) => {
      if (c !== undefined) this.slotCaps.push([i, c]);
    });
  }

  private weight(a: PTArc, M: ArrayLike<number>): number {
    if (a.weight !== null) return a.weight;
    if (!a.expr || !this.pt.envAt) throw new Error(`Arc ${a.label} has no usable weight`);
    const w = num(evaluate(a.expr, this.pt.envAt(M)));
    if (!Number.isInteger(w) || w < 0) throw new Error(`Arc ${a.label}: the weight must be a whole number of zero or more, got ${w}`);
    return w;
  }

  /** Fire t at M into `out` (same length as M); false if t is not enabled. */
  fireInto(t: number, M: Int32Array, out: Int32Array): boolean {
    const need = this.need[t];
    const d = this.delta[t];
    if (d && need) {
      for (let i = 0; i < need.length; i += 2) if (M[need[i]] < need[i + 1]) return false;
      out.set(M);
      for (let i = 0; i < d.length; i += 2) out[d[i]] += d[i + 1];
      return true;
    }
    const r = this.fire(t, M);
    if (!r) return false;
    out.set(r);
    return true;
  }

  /** The marking after firing t at M, or null if t is not enabled. */
  fire(t: number, M: Int32Array): Int32Array | null {
    const mod = this.pt.modulus;
    const need = this.need[t];
    if (need && !mod) for (let i = 0; i < need.length; i += 2) if (M[need[i]] < need[i + 1]) return null;
    const next = new Int32Array(M);
    const reset: number[] = [];
    for (const a of this.ins[t]) {
      if (a.kind === "reset") {
        reset.push(a.place);
        continue;
      }
      const w = this.weight(a, M);
      const have = M[a.place];
      switch (a.kind) {
        case "normal":
          next[a.place] -= w;
          break;
        case "read":
          if (have < w) return null;
          break;
        case "inhibitor":
          if (w > 0 && have >= w) return null;
          break;
        case "equal":
          if (have !== w) return null;
          break;
      }
    }
    if (!mod) {
      for (const a of this.ins[t]) if (a.kind === "normal" && next[a.place] < 0) return null;
    }
    for (const p of reset) next[p] = 0;
    for (const a of this.outs[t]) next[a.place] += this.weight(a, M);
    if (mod) {
      for (let i = 0; i < next.length; i++) next[i] = ((next[i] % mod) + mod) % mod;
      return next;
    }
    for (const [p, c] of this.slotCaps) if (next[p] > c && next[p] > M[p]) return null;
    return next;
  }
}

export interface StateSpace {
  markings: Int32Array[];
  /** Edges as parallel arrays. */
  from: number[];
  to: number[];
  trans: number[];
  /** BFS tree: parent state and transition (-1 for the initial state). */
  parent: Int32Array;
  parentT: Int32Array;
  dead: number[];
  truncated: boolean;
  /**
   * When truncated: the first state whose expansion dropped a successor. States before it have all
   * their edges; from it on, edges to markings beyond the limit are missing.
   */
  cutAt?: number;
  /** Evaluation errors (marking-dependent weights). */
  errors: string[];
}

/** Hash set of markings (no string keys: much faster for large markings). */
class MarkingIndex {
  private readonly buckets = new Map<number, number | number[]>();
  constructor(private readonly markings: Int32Array[]) {}

  private static hash(M: Int32Array): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < M.length; i++) h = Math.imul(h ^ M[i], 0x01000193);
    return h;
  }

  private same(i: number, M: Int32Array): boolean {
    const A = this.markings[i];
    for (let k = 0; k < M.length; k++) if (A[k] !== M[k]) return false;
    return true;
  }

  get(M: Int32Array): number | undefined {
    const b = this.buckets.get(MarkingIndex.hash(M));
    if (b === undefined) return undefined;
    if (typeof b === "number") return this.same(b, M) ? b : undefined;
    for (const i of b) if (this.same(i, M)) return i;
    return undefined;
  }

  /** Register markings[i]. */
  add(i: number) {
    const h = MarkingIndex.hash(this.markings[i]);
    const b = this.buckets.get(h);
    if (b === undefined) this.buckets.set(h, i);
    else if (typeof b === "number") this.buckets.set(h, [b, i]);
    else b.push(i);
  }
}

export function explore(pt: PTNet, maxStates: number, signal?: AbortSignal): StateSpace {
  const firer = new Firer(pt);
  const m = pt.transitions.length;
  const M0 = Int32Array.from(pt.m0);
  const markings: Int32Array[] = [M0];
  const index = new MarkingIndex(markings);
  index.add(0);
  const scratch = new Int32Array(M0.length);
  const from: number[] = [];
  const to: number[] = [];
  const trans: number[] = [];
  const parent: number[] = [-1];
  const parentT: number[] = [-1];
  const dead: number[] = [];
  const errors = new Set<string>();
  let truncated = false;
  let cutAt: number | undefined;
  for (let i = 0; i < markings.length; i++) {
    if ((i & 1023) === 0) checkAbort(signal);
    const M = markings[i];
    let enabled = false;
    for (let t = 0; t < m; t++) {
      try {
        if (!firer.fireInto(t, M, scratch)) continue;
      } catch (e) {
        errors.add((e as Error).message);
        continue;
      }
      enabled = true;
      let j = index.get(scratch);
      if (j === undefined) {
        if (markings.length >= maxStates) {
          if (!truncated) cutAt = i;
          truncated = true;
          continue;
        }
        j = markings.length;
        markings.push(new Int32Array(scratch));
        index.add(j);
        parent.push(i);
        parentT.push(t);
      }
      from.push(i);
      to.push(j);
      trans.push(t);
    }
    if (!enabled) dead.push(i);
  }
  return { markings, from, to, trans, parent: Int32Array.from(parent), parentT: Int32Array.from(parentT), dead, truncated, ...(cutAt !== undefined ? { cutAt } : {}), errors: [...errors] };
}

export interface TerminalAnalysis {
  /** Terminal strongly connected components (no edge leaves them), as state lists. */
  terminal: number[][];
  /** For each terminal component, the transitions occurring on its edges. */
  transitionsIn: Set<number>[];
}

/** Terminal SCCs of a complete reachability graph. */
export function terminalComponents(ss: StateSpace): TerminalAnalysis {
  const N = ss.markings.length;
  const succ: number[][] = Array.from({ length: N }, () => []);
  for (let e = 0; e < ss.from.length; e++) succ[ss.from[e]].push(ss.to[e]);
  const { comp, count } = scc(succ);
  const leaves = new Uint8Array(count);
  for (let e = 0; e < ss.from.length; e++) if (comp[ss.from[e]] !== comp[ss.to[e]]) leaves[comp[ss.from[e]]] = 1;
  const idx = new Map<number, number>();
  const terminal: number[][] = [];
  const transitionsIn: Set<number>[] = [];
  for (let c = 0; c < count; c++)
    if (!leaves[c]) {
      idx.set(c, terminal.length);
      terminal.push([]);
      transitionsIn.push(new Set());
    }
  for (let s = 0; s < N; s++) {
    const k = idx.get(comp[s]);
    if (k !== undefined) terminal[k].push(s);
  }
  for (let e = 0; e < ss.from.length; e++) {
    const k = idx.get(comp[ss.from[e]]);
    if (k !== undefined) transitionsIn[k].add(ss.trans[e]);
  }
  return { terminal, transitionsIn };
}

/** Shortest firing sequence (transition indices) from the initial state to state s, along the BFS tree. */
export function pathTo(ss: StateSpace, s: number): number[] {
  const path: number[] = [];
  while (ss.parent[s] !== -1) {
    path.push(ss.parentT[s]);
    s = ss.parent[s];
  }
  return path.reverse();
}

/** Karp–Miller applies to nets whose firing is monotone: normal and read arcs with constant weights, no capacities. */
export function coverabilityApplies(pt: PTNet): boolean {
  return !pt.modulus && pt.capacity.every((c) => c === undefined) && pt.arcs.every((a) => (a.kind === "normal" || a.kind === "read") && a.weight !== null);
}

export interface Coverability {
  /** Places that are ω in some node (unbounded). */
  unbounded: Set<number>;
  /** Largest finite value seen per place (Infinity for unbounded places). */
  max: number[];
  nodes: number;
  /** The tree was finished; otherwise `unbounded` may miss places and `max` is a lower bound. */
  complete: boolean;
}

/** Karp–Miller coverability tree (ω = Infinity). Only meaningful when coverabilityApplies(pt). */
export function karpMiller(pt: PTNet, maxNodes: number, signal?: AbortSignal): Coverability {
  const n = pt.places.length;
  const m = pt.transitions.length;
  const pre: [number, number][][] = Array.from({ length: m }, () => []);
  const need: [number, number][][] = Array.from({ length: m }, () => []);
  const post: [number, number][][] = Array.from({ length: m }, () => []);
  for (const a of pt.arcs) {
    const w = a.weight ?? 0;
    if (a.kind === "read") need[a.transition].push([a.place, w]);
    else if (a.dir === "in") pre[a.transition].push([a.place, w]);
    else post[a.transition].push([a.place, w]);
  }
  // Aggregate consumption per place for the enabling test.
  const consume = pre.map((list) => {
    const mp = new Map<number, number>();
    for (const [p, w] of list) mp.set(p, (mp.get(p) ?? 0) + w);
    return [...mp];
  });
  const nodesM: number[][] = [pt.m0.slice()];
  const parent: number[] = [-1];
  const seen = new Set<string>();
  const unbounded = new Set<number>();
  const max = pt.m0.slice();
  const queue = [0];
  let head = 0;
  let complete = true;
  const key = (M: number[]) => M.map((v) => (v === Infinity ? "w" : v)).join(",");
  while (head < queue.length) {
    const i = queue[head++];
    if ((i & 1023) === 0) checkAbort(signal);
    const M = nodesM[i];
    const k = key(M);
    if (seen.has(k)) continue;
    seen.add(k);
    for (let t = 0; t < m; t++) {
      if (!consume[t].every(([p, w]) => M[p] >= w) || !need[t].every(([p, w]) => M[p] >= w)) continue;
      const M2 = M.slice();
      for (const [p, w] of consume[t]) M2[p] -= w;
      for (const [p, w] of post[t]) M2[p] += w;
      // Accelerate against every ancestor (including M) that M2 strictly covers.
      for (let a = i; a !== -1; a = parent[a]) {
        const A = nodesM[a];
        let geq = true;
        let gt = false;
        for (let p = 0; p < n; p++) {
          if (M2[p] < A[p]) {
            geq = false;
            break;
          }
          if (M2[p] > A[p]) gt = true;
        }
        if (geq && gt) for (let p = 0; p < n; p++) if (M2[p] > A[p]) M2[p] = Infinity;
      }
      for (let p = 0; p < n; p++) {
        if (M2[p] === Infinity) unbounded.add(p);
        if (M2[p] > max[p]) max[p] = M2[p];
      }
      if (nodesM.length >= maxNodes) {
        complete = false;
        continue;
      }
      nodesM.push(M2);
      parent.push(i);
      queue.push(nodesM.length - 1);
    }
    if (!complete) break;
  }
  return { unbounded, max, nodes: nodesM.length, complete: complete && head === queue.length };
}
