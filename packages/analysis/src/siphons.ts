// Minimal siphons and traps, and the siphon-trap property.
//
// A siphon S satisfies •S ⊆ S• (every transition putting tokens into S takes some from S): once
// empty it stays empty. A trap Q satisfies Q• ⊆ •Q: once marked it stays marked.
// Enumeration by partitioning the search space (see minimalSets); the search is capped.

import { checkAbort, type PTNet } from "./ptnet";
import { netGraph, type Graph } from "./structure";
import type { NodeRef, PlaceSet, SiphonInfo, SiphonTrapResult } from "./types";

interface Closure {
  /** Transitions' guard sets (•t for siphons, t• for traps). */
  a: number[][];
  /** Transitions' feed sets (t• for siphons, •t for traps). */
  b: number[][];
  /** For each place, the transitions whose guard set contains it. */
  pa: number[][];
}

const siphonClosure = (g: Graph): Closure => ({ a: g.tIn, b: g.tOut, pa: g.pOut });
const trapClosure = (g: Graph): Closure => ({ a: g.tOut, b: g.tIn, pa: g.pIn });

/** Largest siphon (or trap) contained in X, computed in place on a copy. */
function largestInside(X: Uint8Array, c: Closure): Uint8Array {
  const S = X.slice();
  const m = c.a.length;
  const cnt = new Int32Array(m);
  const queue: number[] = [];
  for (let t = 0; t < m; t++) {
    let k = 0;
    for (const p of c.a[t]) if (S[p]) k++;
    cnt[t] = k;
    if (k === 0) queue.push(t);
  }
  while (queue.length) {
    const t = queue.pop()!;
    for (const p of c.b[t]) {
      if (!S[p]) continue;
      S[p] = 0;
      for (const t2 of c.pa[p]) if (--cnt[t2] === 0) queue.push(t2);
    }
  }
  return S;
}

const isEmpty = (S: Uint8Array) => S.every((v) => v === 0);
const covers = (S: Uint8Array, R: number[]) => R.every((p) => S[p]);

/**
 * A siphon (trap) S with R ⊆ S ⊆ X that is minimal among those containing R, or null if none.
 * One greedy pass suffices: closures are monotone, so a place kept once can never be dropped later.
 */
function minimalContaining(X: Uint8Array, R: number[], c: Closure): Uint8Array | null {
  let S = largestInside(X, c);
  if (isEmpty(S) || !covers(S, R)) return null;
  const req = new Uint8Array(S.length);
  for (const p of R) req[p] = 1;
  for (let p = 0; p < S.length; p++) {
    if (!S[p] || req[p]) continue;
    const Y = S.slice();
    Y[p] = 0;
    const Z = largestInside(Y, c);
    if (!isEmpty(Z) && covers(Z, R)) S = Z;
  }
  return S;
}

/** S contains no smaller non-empty siphon (trap). */
function isMinimal(S: Uint8Array, c: Closure): boolean {
  for (let p = 0; p < S.length; p++) {
    if (!S[p]) continue;
    const Y = S.slice();
    Y[p] = 0;
    if (!isEmpty(largestInside(Y, c))) return false;
  }
  return true;
}

export interface MinimalSetsResult {
  sets: number[][];
  truncated: boolean;
}

/**
 * Minimal non-empty siphons or traps as sorted place index lists.
 *
 * Partition search (after Cordone, Ferrarini and Piroddi): a subproblem asks for minimal sets S with
 * R ⊆ S and S ∩ E = ∅. Take a set S0 minimal among those containing R; every other minimal set in
 * the subproblem misses some place of S0 \ R = {s1..sk}, so the subproblems "exclude si, include
 * s1..s(i-1)" partition the rest. Each minimal set is found exactly once.
 */
export function minimalSets(pt: PTNet, which: "siphons" | "traps", opts: { maxNodes?: number; maxSets?: number; signal?: AbortSignal; graph?: Graph } = {}): MinimalSetsResult {
  const g = opts.graph ?? netGraph(pt);
  const n = pt.places.length;
  const c = which === "siphons" ? siphonClosure(g) : trapClosure(g);
  const maxNodes = opts.maxNodes ?? (n <= 60 ? 200_000 : 20_000);
  const maxSets = opts.maxSets ?? 5_000;
  const found: number[][] = [];
  const stack: { R: number[]; E: number[] }[] = [{ R: [], E: [] }];
  let truncated = false;
  let nodes = 0;
  while (stack.length) {
    if (++nodes > maxNodes || found.length >= maxSets) {
      truncated = true;
      break;
    }
    if ((nodes & 255) === 0) checkAbort(opts.signal);
    const { R, E } = stack.pop()!;
    const X = new Uint8Array(n).fill(1);
    for (const p of E) X[p] = 0;
    const S = minimalContaining(X, R, c);
    if (!S) continue;
    if (isMinimal(S, c)) found.push([...S.keys()].filter((i) => S[i]));
    const inR = new Set(R);
    const free = [...S.keys()].filter((i) => S[i] && !inR.has(i));
    for (let i = 0; i < free.length; i++) stack.push({ R: [...R, ...free.slice(0, i)], E: [...E, free[i]] });
  }
  const sets = found.sort((a, b) => a.length - b.length || a[0] - b[0]);
  return { sets, truncated };
}

/** Largest trap inside a set of places. */
export function largestTrap(pt: PTNet, places: number[], graph: Graph = netGraph(pt)): number[] {
  const X = new Uint8Array(pt.places.length);
  for (const p of places) X[p] = 1;
  const S = largestInside(X, trapClosure(graph));
  return [...S.keys()].filter((i) => S[i]);
}

export function siphonsAndTraps(pt: PTNet, opts: { signal?: AbortSignal; graph?: Graph } = {}): SiphonTrapResult {
  const g = opts.graph ?? netGraph(pt);
  const refs = (xs: number[]): NodeRef[] => xs.map((i) => pt.places[i]);
  const marked = (xs: number[]) => xs.some((i) => pt.m0[i] > 0);
  const s = minimalSets(pt, "siphons", { ...opts, graph: g });
  const t = minimalSets(pt, "traps", { ...opts, graph: g });
  const siphons: SiphonInfo[] = s.sets.map((S) => {
    const trap = largestTrap(pt, S, g);
    return { places: refs(S), marked: marked(S), maxTrap: refs(trap), containsMarkedTrap: marked(trap) };
  });
  const traps: PlaceSet[] = t.sets.map((Q) => ({ places: refs(Q), marked: marked(Q) }));
  const badSiphons = siphons.filter((x) => !x.containsMarkedTrap).map((x) => x.places);
  const siphonTrapProperty = pt.places.length === 0 ? "n/a" : badSiphons.length ? "no" : s.truncated ? "unknown" : "yes";
  if (s.truncated) pt.warnings.push(`Siphon enumeration stopped at its limit after ${s.sets.length} minimal siphons; the list is incomplete.`);
  if (t.truncated) pt.warnings.push(`Trap enumeration stopped at its limit after ${t.sets.length} minimal traps; the list is incomplete.`);
  return { siphons, traps, siphonsTruncated: s.truncated, trapsTruncated: t.truncated, siphonTrapProperty, badSiphons };
}
