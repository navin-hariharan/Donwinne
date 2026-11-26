// The Karp–Miller coverability graph with its edges (nodes with equal ω-markings merged), for the
// behavioural checks of unbounded nets: liveness levels, repetitivity, fairness and synchronic
// distances. Only for nets where coverability applies (normal and read arcs of constant weight).

import { checkAbort, type PTNet } from "./ptnet";

export interface CoverabilityGraph {
  /** ω-markings (Infinity = ω), node 0 is the initial marking. */
  nodes: number[][];
  from: number[];
  to: number[];
  trans: number[];
  /** Places that are ω in some node. */
  unbounded: Set<number>;
  /** The graph was finished within the node limit. */
  complete: boolean;
}

/**
 * Karp–Miller construction (Murata 1989, §5.1; the algorithm of the report's §5.2.1.1): a new
 * marking that strictly covers a marking on its path from the root gets ω where it is larger.
 * Two nodes with the same ω-marking are one node, so the result is a graph. Every firing sequence
 * of the net is the label of a path from node 0.
 */
export function coverabilityGraph(pt: PTNet, maxNodes: number, signal?: AbortSignal): CoverabilityGraph {
  const n = pt.places.length;
  const m = pt.transitions.length;
  const consume: [number, number][][] = Array.from({ length: m }, () => []);
  const need: [number, number][][] = Array.from({ length: m }, () => []);
  const produce: [number, number][][] = Array.from({ length: m }, () => []);
  {
    const c = Array.from({ length: m }, () => new Map<number, number>());
    for (const a of pt.arcs) {
      const w = a.weight ?? 0;
      if (a.kind === "read") need[a.transition].push([a.place, w]);
      else if (a.kind === "normal") {
        if (a.dir === "in") c[a.transition].set(a.place, (c[a.transition].get(a.place) ?? 0) + w);
        else produce[a.transition].push([a.place, w]);
      }
    }
    c.forEach((mp, t) => (consume[t] = [...mp]));
  }
  const nodes: number[][] = [pt.m0.slice()];
  /** Tree parent (the node that created it), for the acceleration against ancestors. */
  const parent: number[] = [-1];
  const index = new Map<string, number>();
  const key = (M: number[]) => M.map((v) => (v === Infinity ? "w" : v)).join(",");
  index.set(key(nodes[0]), 0);
  const from: number[] = [];
  const to: number[] = [];
  const trans: number[] = [];
  const unbounded = new Set<number>();
  let complete = true;
  for (let i = 0; i < nodes.length; i++) {
    if ((i & 255) === 0) checkAbort(signal);
    const M = nodes[i];
    for (let t = 0; t < m; t++) {
      if (!consume[t].every(([p, w]) => M[p] >= w) || !need[t].every(([p, w]) => M[p] >= w)) continue;
      const M2 = M.slice();
      for (const [p, w] of consume[t]) M2[p] -= w;
      for (const [p, w] of produce[t]) M2[p] += w;
      for (let a = i; a !== -1; a = parent[a]) {
        const A = nodes[a];
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
      const k = key(M2);
      let j = index.get(k);
      if (j === undefined) {
        if (nodes.length >= maxNodes) {
          complete = false;
          continue;
        }
        j = nodes.length;
        nodes.push(M2);
        parent.push(i);
        index.set(k, j);
        for (let p = 0; p < n; p++) if (M2[p] === Infinity) unbounded.add(p);
      }
      from.push(i);
      to.push(j);
      trans.push(t);
    }
  }
  return { nodes, from, to, trans, unbounded, complete };
}
