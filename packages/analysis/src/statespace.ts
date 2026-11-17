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
  /**
   * Enabling candidates: a transition that needs w > 0 tokens on some place (its trigger) can only
   * be enabled when that place holds w tokens. byTrigger[p] lists (transition, w) pairs; the other
   * transitions (no constant positive input, or a modulo net) are always tried.
   */
  private readonly byTrigger: Int32Array[];
  private readonly always: Int32Array;
  private readonly mark: Uint8Array;

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
    // Trigger of each transition: the input place with the largest constant need (equal arcs and
    // weights depending on the marking do not qualify), so that rarely marked places filter best.
    const trig: number[][] = Array.from({ length: pt.places.length }, () => []);
    const always: number[] = [];
    for (let t = 0; t < m; t++) {
      let best = -1;
      let bestW = 0;
      if (!pt.modulus)
        for (const a of this.ins[t])
          if ((a.kind === "normal" || a.kind === "read") && a.weight !== null && a.weight > bestW) {
            best = a.place;
            bestW = a.weight;
          }
      if (best < 0) always.push(t);
      else trig[best].push(t, bestW);
    }
    this.byTrigger = trig.map((x) => Int32Array.from(x));
    this.always = Int32Array.from(always);
    this.mark = new Uint8Array(m);
  }

  /**
   * Write into `out` (length ≥ number of transitions), in ascending order, the transitions that may
   * be enabled at M, and return how many there are. Every enabled transition is among them.
   */
  candidates(M: ArrayLike<number>, out: Int32Array): number {
    let k = 0;
    const mark = this.mark;
    for (let i = 0; i < this.always.length; i++) {
      const t = this.always[i];
      mark[t] = 1;
      out[k++] = t;
    }
    const byTrigger = this.byTrigger;
    for (let p = 0; p < byTrigger.length; p++) {
      const have = M[p];
      if (have <= 0) continue;
      const list = byTrigger[p];
      for (let i = 0; i < list.length; i += 2)
        if (have >= list[i + 1]) {
          const t = list[i];
          if (!mark[t]) {
            mark[t] = 1;
            out[k++] = t;
          }
        }
    }
    for (let i = 0; i < k; i++) mark[out[i]] = 0;
    if (k > 1) out.subarray(0, k).sort();
    return k;
  }

  private weight(a: PTArc, M: ArrayLike<number>): number {
    if (a.weight !== null) return a.weight;
    if (!a.expr || !this.pt.envAt) throw new Error(`Arc ${a.label} has no usable weight`);
    const w = num(evaluate(a.expr, this.pt.envAt(M)));
    if (!Number.isInteger(w) || w < 0) throw new Error(`Arc ${a.label}: the weight must be a whole number of zero or more, got ${w}`);
    return w;
  }

  /**
   * For a transition with only normal and read arcs of constant weight in a net without capacities:
   * its (place, change) pairs. Null for every other transition (use {@link fireInto}).
   */
  plainDelta(t: number): Int32Array | null {
    return this.need[t] ? this.delta[t] : null;
  }

  /** Whether M covers the inputs of a transition with a {@link plainDelta}. */
  covers(t: number, M: ArrayLike<number>): boolean {
    const need = this.need[t]!;
    for (let i = 0; i < need.length; i += 2) if (M[need[i]] < need[i + 1]) return false;
    return true;
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
  from: Int32Array;
  to: Int32Array;
  trans: Int32Array;
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
  /**
   * States where some transition could not be evaluated (a marking-dependent weight gave no whole
   * number of zero or more). Their successor lists may be incomplete, so they are never counted as
   * dead, and a state space with any of them is not complete.
   */
  unresolved: number[];
}

/**
 * Markings of a state space, stored as views into large shared buffers (one small typed array per
 * state would cost a backing store each), with an open-addressing hash index. Markings are handed
 * out as Int32Array views, so callers index them like before.
 */
export class MarkingStore {
  readonly markings: Int32Array[] = [];
  private chunk: Int32Array;
  private used = 0;
  private table: Int32Array;
  private hashes: Int32Array;
  private mask: number;
  private readonly chunkInts: number;
  /** Random odd multipliers: the hash Σ M[p]·R[p] (mod 2^32) can be updated place by place. */
  private readonly R: Int32Array;

  constructor(private readonly width: number, expected = 1024) {
    this.chunkInts = Math.max(width, Math.min(1 << 20, Math.max(1, width) * 4096));
    this.chunk = new Int32Array(this.chunkInts);
    let size = 1024;
    while (size < expected * 2) size <<= 1;
    this.table = new Int32Array(size).fill(-1);
    this.hashes = new Int32Array(1024);
    this.mask = size - 1;
    this.R = new Int32Array(width);
    let x = 0x9e3779b9 | 0;
    for (let p = 0; p < width; p++) {
      // xorshift32: deterministic, so state numbering is reproducible.
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      this.R[p] = x | 1;
    }
  }

  get size(): number {
    return this.markings.length;
  }

  /** Hash of a marking; see {@link shift} for updating it. */
  hash(M: ArrayLike<number>): number {
    let h = 0;
    for (let p = 0; p < this.width; p++) if (M[p]) h = (h + Math.imul(M[p], this.R[p])) | 0;
    return h;
  }

  /** Hash after adding `by` tokens to place p. */
  shift(h: number, p: number, by: number): number {
    return (h + Math.imul(by, this.R[p])) | 0;
  }

  /** Hash of the stored marking i. */
  hashAt(i: number): number {
    return this.hashes[i];
  }

  private static slot(h: number): number {
    h ^= h >>> 16;
    h = Math.imul(h, 0x45d9f3b);
    h ^= h >>> 16;
    return h;
  }

  private equal(i: number, M: ArrayLike<number>): boolean {
    const A = this.markings[i];
    for (let k = 0; k < this.width; k++) if (A[k] !== M[k]) return false;
    return true;
  }

  /** Index of marking M, or -1. `h` is its hash, if known. */
  find(M: ArrayLike<number>, h = this.hash(M)): number {
    for (let slot = MarkingStore.slot(h) & this.mask; ; slot = (slot + 1) & this.mask) {
      const i = this.table[slot];
      if (i < 0) return -1;
      if (this.hashes[i] === h && this.equal(i, M)) return i;
    }
  }

  /** Add a copy of M (which must not be present yet) and return its index. `h` is its hash, if known. */
  add(M: ArrayLike<number>, h = this.hash(M)): number {
    const n = this.width;
    if (this.used + n > this.chunk.length) {
      this.chunk = new Int32Array(this.chunkInts);
      this.used = 0;
    }
    const view = this.chunk.subarray(this.used, this.used + n);
    this.used += n;
    for (let k = 0; k < n; k++) view[k] = M[k];
    const i = this.markings.length;
    this.markings.push(view);
    if (i >= this.hashes.length) {
      const grown = new Int32Array(this.hashes.length * 2);
      grown.set(this.hashes);
      this.hashes = grown;
    }
    this.hashes[i] = h;
    if ((i + 1) * 2 > this.table.length) this.rehash();
    else this.insert(i, h);
    return i;
  }

  private insert(i: number, h: number) {
    let slot = MarkingStore.slot(h) & this.mask;
    while (this.table[slot] >= 0) slot = (slot + 1) & this.mask;
    this.table[slot] = i;
  }

  private rehash() {
    const size = this.table.length * 2;
    this.table = new Int32Array(size).fill(-1);
    this.mask = size - 1;
    for (let i = 0; i < this.markings.length; i++) this.insert(i, this.hashes[i]);
  }
}

/** Growable Int32 list (edges of large state spaces without boxed arrays). */
export class IntList {
  data: Int32Array;
  length = 0;
  constructor(capacity = 1024) {
    this.data = new Int32Array(capacity);
  }
  push(v: number) {
    if (this.length === this.data.length) {
      const grown = new Int32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data[this.length++] = v;
  }
  toArray(): Int32Array {
    return this.data.slice(0, this.length);
  }
}

export function explore(pt: PTNet, maxStates: number, signal?: AbortSignal): StateSpace {
  const firer = new Firer(pt);
  const m = pt.transitions.length;
  const store = new MarkingStore(pt.places.length, Math.min(maxStates, 1 << 16));
  store.add(pt.m0);
  const markings = store.markings;
  // `cur` holds the marking being expanded; plain transitions are applied to it and undone.
  const cur = new Int32Array(pt.places.length);
  const scratch = new Int32Array(pt.places.length);
  const cand = new Int32Array(m);
  const from = new IntList();
  const to = new IntList();
  const trans = new IntList();
  const parent = new IntList();
  const parentT = new IntList();
  parent.push(-1);
  parentT.push(-1);
  const dead: number[] = [];
  const unresolved: number[] = [];
  const errors = new Set<string>();
  let truncated = false;
  let cutAt: number | undefined;
  for (let i = 0; i < markings.length; i++) {
    if ((i & 1023) === 0) checkAbort(signal);
    const M = markings[i];
    cur.set(M);
    const hM = store.hashAt(i);
    let enabled = false;
    let failed = false;
    const k = firer.candidates(M, cand);
    for (let c = 0; c < k; c++) {
      const t = cand[c];
      const d = firer.plainDelta(t);
      let next: Int32Array;
      let h: number;
      if (d) {
        if (!firer.covers(t, M)) continue;
        h = hM;
        for (let x = 0; x < d.length; x += 2) {
          cur[d[x]] += d[x + 1];
          h = store.shift(h, d[x], d[x + 1]);
        }
        next = cur;
      } else {
        try {
          if (!firer.fireInto(t, M, scratch)) continue;
        } catch (e) {
          // Not "disabled": whether t can fire here is unknown.
          errors.add((e as Error).message);
          failed = true;
          continue;
        }
        next = scratch;
        h = store.hash(scratch);
      }
      enabled = true;
      let j = store.find(next, h);
      if (j < 0) {
        if (markings.length >= maxStates) {
          if (!truncated) cutAt = i;
          truncated = true;
        } else {
          j = store.add(next, h);
          parent.push(i);
          parentT.push(t);
        }
      }
      if (d) for (let x = 0; x < d.length; x += 2) cur[d[x]] -= d[x + 1];
      if (j < 0) continue;
      from.push(i);
      to.push(j);
      trans.push(t);
    }
    if (failed) unresolved.push(i);
    else if (!enabled) dead.push(i);
  }
  return {
    markings,
    from: from.toArray(),
    to: to.toArray(),
    trans: trans.toArray(),
    parent: parent.toArray(),
    parentT: parentT.toArray(),
    dead,
    truncated,
    ...(cutAt !== undefined ? { cutAt } : {}),
    errors: [...errors],
    unresolved,
  };
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
