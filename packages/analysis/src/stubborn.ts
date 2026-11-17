// Stubborn-set reduction of the interleaving state space (Valmari's stubborn sets, the partial-order
// reduction used in the evaluation of Konios et al. 2023, Sec. 6, through Charlie/LoLA).
//
// At each marking only the enabled transitions of a stubborn set are fired. A set S is stubborn at M
// when (D1) every enabled t in S is independent of every transition outside S, and (D2) every
// disabled t in S stays disabled while only transitions outside S fire. Here:
// - for an enabled t ∈ S, S contains every transition that changes a place t depends on, and every
//   transition that depends on a place t changes (so t and the rest commute and cannot disable each other);
// - for a disabled t ∈ S, S contains the transitions that can lift one condition that blocks t: the
//   producers of an input place without enough tokens, the consumers of an inhibitor place or a
//   full place, the changers of an equal-arc place.
// Every reduced graph keeps all deadlocks. With visible places, the visibility condition (a set
// with an enabled transition that changes a visible place contains every such transition) and the
// ignoring proviso (every terminal strongly connected component of the reduced graph contains a
// state whose stubborn set holds every visible transition, Valmari's condition S_V) make it keep the reachable
// markings of those places, so AG and EF of state formulas over them keep their verdicts.

import { checkAbort, type PTArc, type PTNet } from "./ptnet";
import { Firer, IntList, MarkingStore } from "./statespace";
import { compress, type TransitionSystem, type TransitionSystemOptions } from "./ts";
import { resolvePlace } from "./ctl";
import { scc } from "./structure";

export interface StubbornOptions extends TransitionSystemOptions {
  /**
   * Places whose markings the properties to check observe (indices or names). With visible places
   * the graph keeps LTL-X properties of them; without, it keeps deadlocks only.
   */
  visible?: readonly (number | string)[];
  /** How many enabled transitions to try as seeds of the stubborn set at each state (default 8); the smallest set wins. */
  seeds?: number;
}

/** Statistics of a reduced exploration. */
export interface StubbornStats {
  /** States expanded with fewer transitions than enabled. */
  reducedStates: number;
  /** Enabled transitions not fired thanks to the reduction. */
  prunedEdges: number;
}

/**
 * The interleaving reachability graph of a P/T view reduced with stubborn sets. Falls back to the
 * full graph (with a note) for modulo nets and marking-dependent weights. Throws for nets with errors.
 */
export function stubbornSystem(pt: PTNet, opts: StubbornOptions = {}): TransitionSystem & { stats: StubbornStats } {
  if (pt.errors.length) throw new Error(`The net has errors: ${pt.errors[0]}`);
  const maxStates = opts.maxStates ?? 100_000;
  const seeds = Math.max(1, opts.seeds ?? 8);
  const nP = pt.places.length;
  const nT = pt.transitions.length;
  const notes: string[] = [];
  const reduce = !pt.modulus && pt.arcs.every((a) => a.weight !== null);
  if (!reduce) notes.push("Stubborn sets are not used for modulo nets or marking-dependent weights; the full graph was built.");

  // Static structure.
  const ins: PTArc[][] = Array.from({ length: nT }, () => []);
  const change: Map<number, number>[] = Array.from({ length: nT }, () => new Map());
  const condOf: Set<number>[] = Array.from({ length: nT }, () => new Set());
  for (const a of pt.arcs) {
    const t = a.transition;
    if (a.dir === "in") {
      ins[t].push(a);
      condOf[t].add(a.place);
      if (a.kind === "normal") change[t].set(a.place, (change[t].get(a.place) ?? 0) - a.weight!);
      else if (a.kind === "reset") change[t].set(a.place, NaN);
    } else change[t].set(a.place, (change[t].get(a.place) ?? 0) + a.weight!);
  }
  for (let t = 0; t < nT; t++) for (const [p, d] of change[t]) if (pt.capacity[p] !== undefined && !(d <= 0)) condOf[t].add(p);
  const increasers: number[][] = Array.from({ length: nP }, () => []);
  const decreasers: number[][] = Array.from({ length: nP }, () => []);
  const changers: number[][] = Array.from({ length: nP }, () => []);
  const users: number[][] = Array.from({ length: nP }, () => []);
  for (let t = 0; t < nT; t++) {
    for (const [p, d] of change[t]) {
      if (d === 0) continue;
      changers[p].push(t);
      if (!(d < 0)) increasers[p].push(t);
      if (!(d > 0)) decreasers[p].push(t);
    }
    for (const p of condOf[t]) users[p].push(t);
  }
  // dep[t]: what an enabled t needs in its stubborn set (D1).
  const dep: Int32Array[] = Array.from({ length: nT }, (_, t) => {
    const s = new Set<number>();
    for (const p of condOf[t]) for (const u of changers[p]) s.add(u);
    for (const [p, d] of change[t]) if (d !== 0) for (const u of users[p]) s.add(u);
    s.delete(t);
    return Int32Array.from(s);
  });
  const capacity = pt.capacity;

  // Visible transitions: those that change a visible place.
  const visibleT = new Uint8Array(nT);
  const vocab = { places: pt.places, transitions: pt.transitions };
  for (const v of opts.visible ?? []) {
    const idx = typeof v === "number" ? [v] : (resolvePlace(vocab, v) ?? []);
    if (typeof v === "string" && !idx.length) throw new Error(`Unknown visible place "${v}"`);
    for (const p of idx) for (const t of changers[p]) visibleT[t] = 1;
  }
  const useVisibility = (opts.visible?.length ?? 0) > 0;
  const visibleList: number[] = [];
  for (let t = 0; t < nT; t++) if (visibleT[t]) visibleList.push(t);

  /** One condition blocking a disabled t at M, as the transitions that could lift it (D2). */
  const scapegoat = (t: number, M: Int32Array): number[] => {
    const need = new Map<number, number>();
    for (const a of ins[t]) {
      const w = a.weight!;
      const have = M[a.place];
      if (a.kind === "normal") need.set(a.place, (need.get(a.place) ?? 0) + w);
      else if (a.kind === "read") need.set(a.place, Math.max(need.get(a.place) ?? 0, w));
      else if (a.kind === "inhibitor" && w > 0 && have >= w) return decreasers[a.place];
      else if (a.kind === "equal" && have !== w) return changers[a.place];
    }
    for (const [p, w] of need) if (M[p] < w) return increasers[p];
    for (const [p, d] of change[t]) {
      const c = capacity[p];
      if (c !== undefined && d > 0 && M[p] + d > c) return decreasers[p];
    }
    // Not found (should not happen): every transition touching t's conditions.
    return [...condOf[t]].flatMap((p) => changers[p]);
  };

  const firer = new Firer(pt);
  const store = new MarkingStore(nP, Math.min(maxStates, 1 << 16));
  store.add(pt.m0);
  const markings = store.markings;
  const from = new IntList();
  const to = new IntList();
  const lab = new IntList();
  const open: number[] = [];
  const cand = new Int32Array(nT);
  const enabledMark = new Uint8Array(nT);
  const inSet = new Uint8Array(nT);
  const scratch = new Int32Array(nP);
  const stats: StubbornStats = { reducedStates: 0, prunedEdges: 0 };
  /** Per state: 1 when every enabled transition was fired; edges [edgeFrom, edgeTo) of the state. */
  const full = new IntList();
  const edgeFrom = new IntList();
  const edgeTo = new IntList();
  /** Edge labels set to -1 are dropped (a state's reduced edges, replaced by its full expansion). */
  let cut = false;
  const errors = new Set<string>();
  /** States where some transition could not be evaluated (see StateSpace.unresolved). */
  const unresolved = new Set<number>();

  /** Enabled transitions of the stubborn set grown from `seeds`, or null if it grew past `limit`. */
  const closure = (seeds: readonly number[], M: Int32Array, limit: number): number[] | null => {
    const work: number[] = [];
    const members: number[] = [];
    for (const t of seeds)
      if (!inSet[t]) {
        inSet[t] = 1;
        members.push(t);
        work.push(t);
      }
    const enabledIn: number[] = [];
    let visibleAdded = false;
    try {
      while (work.length) {
        const t = work.pop()!;
        let more: ArrayLike<number>;
        if (enabledMark[t]) {
          enabledIn.push(t);
          if (enabledIn.length >= limit) return null;
          more = dep[t];
          // Visibility (V): a set with an enabled visible transition contains every visible one.
          if (useVisibility && visibleT[t] && !visibleAdded) {
            visibleAdded = true;
            for (const u of visibleList)
              if (!inSet[u]) {
                inSet[u] = 1;
                members.push(u);
                work.push(u);
              }
          }
        } else more = scapegoat(t, M);
        for (let i = 0; i < more.length; i++) {
          const u = more[i];
          if (!inSet[u]) {
            inSet[u] = 1;
            members.push(u);
            work.push(u);
          }
        }
      }
      return enabledIn.sort((a, b) => a - b);
    } finally {
      for (const u of members) inSet[u] = 0;
    }
  };

  /**
   * Expand state s. With `force` (the ignoring proviso) the stubborn set is grown from every
   * visible transition, so it contains all of them (Valmari's condition S_V for safety).
   */
  const expand = (s: number, force: boolean) => {
    const M = markings[s];
    const k = firer.candidates(M, cand);
    const enabled: number[] = [];
    const succ: Int32Array[] = [];
    let failed = false;
    for (let c = 0; c < k; c++) {
      const t = cand[c];
      try {
        if (!firer.fireInto(t, M, scratch)) continue;
      } catch (e) {
        // Whether t can fire here is unknown: s is not dead, and no stubborn set may leave t out.
        errors.add((e as Error).message);
        failed = true;
        continue;
      }
      enabled.push(t);
      succ.push(new Int32Array(scratch));
    }
    if (failed) unresolved.add(s);
    let chosen = enabled.map((_, i) => i);
    if (reduce && !failed && enabled.length > 1) {
      for (const t of enabled) enabledMark[t] = 1;
      let best: number[] | null = null;
      // A stubborn set holds an enabled transition when there is one (D0): seed it with one.
      for (let i = 0; i < enabled.length && i < seeds; i++) {
        const r = closure(force ? [...visibleList, enabled[i]] : [enabled[i]], M, best ? best.length : force ? Infinity : enabled.length);
        if (r && (!best || r.length < best.length)) best = r;
        if (best && best.length === 1) break;
      }
      for (const t of enabled) enabledMark[t] = 0;
      if (best && best.length < enabled.length) chosen = best.map((t) => enabled.indexOf(t));
    }
    // "Full" here: the proviso holds at s (every enabled, or every visible, transition is in its set).
    const isFull = force || chosen.length === enabled.length;
    if (force) {
      if (!full.data[s]) {
        stats.prunedEdges -= chosen.length - (edgeTo.data[s] - edgeFrom.data[s]);
        if (chosen.length === enabled.length) stats.reducedStates--;
      }
      // Drop the reduced edges of s; its new edges follow.
      for (let e = edgeFrom.data[s]; e < edgeTo.data[s]; e++) lab.data[e] = -1;
      full.data[s] = 1;
      edgeFrom.data[s] = from.length;
    } else {
      full.push(isFull ? 1 : 0);
      edgeFrom.push(from.length);
      edgeTo.push(from.length);
      if (!isFull) {
        stats.reducedStates++;
        stats.prunedEdges += enabled.length - chosen.length;
      }
    }
    let partial = false;
    for (const i of chosen) {
      const N = succ[i];
      let j = store.find(N);
      if (j < 0) {
        if (markings.length >= maxStates) {
          cut = partial = true;
          continue;
        }
        j = store.add(N);
      }
      from.push(s);
      to.push(j);
      lab.push(enabled[i]);
    }
    edgeTo.data[s] = from.length;
    if (partial) open.push(s);
  };

  let next = 0;
  const run = () => {
    for (; next < markings.length; next++) {
      if ((next & 1023) === 0) checkAbort(opts.signal);
      expand(next, false);
    }
  };
  run();
  // The ignoring problem (a visible transition postponed forever around a cycle): every terminal
  // strongly connected component of the reduced graph must contain a state whose stubborn set holds
  // every visible transition (Valmari's condition S_V for safety properties). Re-expand one state of
  // each component that has none, explore what that adds, and repeat.
  if (useVisibility && reduce && visibleList.length)
    for (;;) {
      if (cut) break;
      const n = markings.length;
      const succ: number[][] = Array.from({ length: n }, () => []);
      for (let e = 0; e < from.length; e++) if (lab.data[e] >= 0) succ[from.data[e]].push(to.data[e]);
      const { comp, count } = scc(succ);
      const leaves = new Uint8Array(count);
      const hasFull = new Uint8Array(count);
      for (let e = 0; e < from.length; e++) if (lab.data[e] >= 0 && comp[from.data[e]] !== comp[to.data[e]]) leaves[comp[from.data[e]]] = 1;
      for (let x = 0; x < n; x++) if (full.data[x]) hasFull[comp[x]] = 1;
      const pick = new Int32Array(count).fill(-1);
      for (let x = 0; x < n; x++) if (!leaves[comp[x]] && !hasFull[comp[x]] && pick[comp[x]] < 0) pick[comp[x]] = x;
      let any = false;
      for (let c = 0; c < count; c++)
        if (pick[c] >= 0) {
          any = true;
          checkAbort(opts.signal);
          expand(pick[c], true);
        }
      if (!any) break;
      run();
    }
  for (const e of errors) notes.push(`While exploring the state space: ${e}`);
  if (cut) notes.push(`The reduced state space was cut off at ${maxStates} states; results on it are not conclusive.`);
  if (unresolved.size)
    notes.push(`In ${unresolved.size} state${unresolved.size === 1 ? "" : "s"} a transition could not be evaluated, so their successors are unknown; verdicts that depend on them are "unknown".`);
  const complete = !cut && !unresolved.size;
  notes.push(
    useVisibility
      ? "Stubborn-set reduced graph: it keeps deadlocks and the reachable markings of the visible places (AG and EF of state formulas over them keep their verdicts); other CTL formulas may differ from the full graph."
      : "Stubborn-set reduced graph: it keeps deadlocks (and dead states) only; other properties may differ from the full graph.",
  );
  let openFlags: Uint8Array | undefined;
  if (!complete) {
    openFlags = new Uint8Array(markings.length);
    for (const x of open) openFlags[x] = 1;
    for (const x of unresolved) openFlags[x] = 1;
  }
  const ts: TransitionSystem = {
    semantics: "interleaving",
    places: pt.places,
    transitions: pt.transitions,
    markings,
    ...(() => {
      const keep: number[] = [];
      for (let e = 0; e < from.length; e++) if (lab.data[e] >= 0) keep.push(e);
      return compress(markings.length, Int32Array.from(keep, (e) => from.data[e]), Int32Array.from(keep, (e) => to.data[e]), Int32Array.from(keep, (e) => lab.data[e]));
    })(),
    labels: pt.transitions.map((_, t) => [t]),
    complete,
    ...(openFlags ? { open: openFlags } : {}),
    notes,
  };
  return { ...ts, stats };
}
