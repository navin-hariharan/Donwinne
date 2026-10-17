// Structural properties of the net graph (Charlie's list).

import { structuralMatrices, type PTNet } from "./ptnet";
import type { Check, NodeRef, StructuralProperties } from "./types";

export interface Graph {
  /** •t: input places of each transition. */
  tIn: number[][];
  /** t•: output places of each transition. */
  tOut: number[][];
  /** •p: input transitions of each place. */
  pIn: number[][];
  /** p•: output transitions of each place. */
  pOut: number[][];
  pre: number[][];
  post: number[][];
}

/** Adjacency of the structural net (normal arcs; read arcs as self-loops). */
export function netGraph(pt: PTNet): Graph {
  const { pre, post } = structuralMatrices(pt);
  const n = pt.places.length;
  const m = pt.transitions.length;
  const tIn: number[][] = Array.from({ length: m }, () => []);
  const tOut: number[][] = Array.from({ length: m }, () => []);
  const pIn: number[][] = Array.from({ length: n }, () => []);
  const pOut: number[][] = Array.from({ length: n }, () => []);
  for (let p = 0; p < n; p++)
    for (let t = 0; t < m; t++) {
      if (pre[p][t]) {
        tIn[t].push(p);
        pOut[p].push(t);
      }
      if (post[p][t]) {
        tOut[t].push(p);
        pIn[p].push(t);
      }
    }
  return { tIn, tOut, pIn, pOut, pre, post };
}

const names = (xs: NodeRef[], max = 3) => {
  const s = xs.slice(0, max).map((x) => x.name);
  return xs.length > max ? `${s.join(", ")} and ${xs.length - max} more` : s.join(", ");
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const sameSet = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));
const subset = (a: number[], b: number[]) => a.every((x) => b.includes(x));

/** Strongly connected components of a directed graph given by successor lists (iterative Tarjan). */
export function scc(succ: ArrayLike<number[]> & { length: number }): { comp: Int32Array; count: number } {
  const N = succ.length;
  const index = new Int32Array(N).fill(-1);
  const low = new Int32Array(N);
  const comp = new Int32Array(N).fill(-1);
  const onStack = new Uint8Array(N);
  const stack: number[] = [];
  let next = 0;
  let count = 0;
  const callStack: [number, number][] = [];
  for (let s = 0; s < N; s++) {
    if (index[s] !== -1) continue;
    callStack.push([s, 0]);
    index[s] = low[s] = next++;
    stack.push(s);
    onStack[s] = 1;
    while (callStack.length) {
      const top = callStack[callStack.length - 1];
      const v = top[0];
      const out = succ[v];
      if (top[1] < out.length) {
        const w = out[top[1]++];
        if (index[w] === -1) {
          index[w] = low[w] = next++;
          stack.push(w);
          onStack[w] = 1;
          callStack.push([w, 0]);
        } else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
      } else {
        callStack.pop();
        if (callStack.length) {
          const u = callStack[callStack.length - 1][0];
          low[u] = Math.min(low[u], low[v]);
        }
        if (low[v] === index[v]) {
          let w: number;
          do {
            w = stack.pop()!;
            onStack[w] = 0;
            comp[w] = count;
          } while (w !== v);
          count++;
        }
      }
    }
  }
  return { comp, count };
}

export function structuralProperties(pt: PTNet, g: Graph = netGraph(pt)): StructuralProperties {
  const P = pt.places;
  const T = pt.transitions;
  const n = P.length;
  const m = T.length;
  const { pre, post, tIn, tOut, pIn, pOut } = g;
  const ok = (reason: string): Check => ({ holds: true, witnesses: [], reason });
  const bad = (reason: string, witnesses: NodeRef[]): Check => ({ holds: false, witnesses, reason });

  // PUR
  let pure = ok("No transition has a place as both input and output (no self-loops).");
  search: for (let t = 0; t < m; t++)
    for (const p of tIn[t])
      if (post[p][t]) {
        pure = bad(`${T[t].name} and ${P[p].name} form a self-loop.`, [T[t], P[p]]);
        break search;
      }

  // ORD
  let ordinary = ok("Every arc has weight 1.");
  search2: for (let p = 0; p < n; p++)
    for (let t = 0; t < m; t++) {
      const w = pre[p][t] > 1 ? pre[p][t] : post[p][t] > 1 ? post[p][t] : 0;
      if (w) {
        const label = pre[p][t] > 1 ? `${P[p].name} → ${T[t].name}` : `${T[t].name} → ${P[p].name}`;
        ordinary = bad(`Arc ${label} has weight ${w}.`, [P[p], T[t]]);
        break search2;
      }
    }

  // HOM
  let homogeneous = ok("All arcs leaving a place have the same weight.");
  for (let p = 0; p < n; p++) {
    const ws = new Set(pOut[p].map((t) => pre[p][t]));
    if (ws.size > 1) {
      homogeneous = bad(`Arcs leaving ${P[p].name} have different weights (${[...ws].join(", ")}).`, [P[p], ...pOut[p].map((t) => T[t])]);
      break;
    }
  }

  // CSV
  let conservative = ok("Every transition adds as many tokens as it removes.");
  for (let t = 0; t < m; t++) {
    let i = 0;
    let o = 0;
    for (let p = 0; p < n; p++) {
      i += pre[p][t];
      o += post[p][t];
    }
    if (i !== o) {
      conservative = bad(`${T[t].name} removes ${plural(i, "token")} but adds ${o}.`, [T[t]]);
      break;
    }
  }

  // SCF
  let staticConflictFree = ok("No two transitions share an input place.");
  for (let p = 0; p < n; p++)
    if (pOut[p].length > 1) {
      const ts = pOut[p].map((t) => T[t]);
      staticConflictFree = bad(`${names(ts)} share the input place ${P[p].name}.`, [P[p], ...ts]);
      break;
    }

  // SM
  let stateMachine = ok("Every transition has exactly one input and one output place.");
  for (let t = 0; t < m; t++)
    if (tIn[t].length !== 1 || tOut[t].length !== 1) {
      const why = tIn[t].length !== 1 ? `${plural(tIn[t].length, "input place")}` : `${plural(tOut[t].length, "output place")}`;
      stateMachine = bad(`${T[t].name} has ${why}.`, [T[t]]);
      break;
    }

  // SG
  let synchronisationGraph = ok("Every place has exactly one input and one output transition.");
  for (let p = 0; p < n; p++)
    if (pIn[p].length !== 1 || pOut[p].length !== 1) {
      const why = pIn[p].length !== 1 ? `${plural(pIn[p].length, "input transition")}` : `${plural(pOut[p].length, "output transition")}`;
      synchronisationGraph = bad(`${P[p].name} has ${why}.`, [P[p]]);
      break;
    }

  // FC
  let freeChoice = ok("Whenever a place has several output transitions, it is their only input place.");
  search3: for (let p = 0; p < n; p++)
    if (pOut[p].length > 1)
      for (const t of pOut[p])
        if (tIn[t].length > 1) {
          freeChoice = bad(`${P[p].name} has several output transitions, and one of them, ${T[t].name}, has other input places too.`, [P[p], T[t]]);
          break search3;
        }

  // EFC and ES
  let extendedFreeChoice = ok("Places that share an output transition have the same output transitions.");
  let extendedSimple = ok("For any two places, their sets of output transitions are disjoint or one contains the other.");
  for (let p = 0; p < n && (extendedFreeChoice.holds || extendedSimple.holds); p++)
    for (let q = p + 1; q < n; q++) {
      const shared = pOut[p].find((t) => pOut[q].includes(t));
      if (shared === undefined) continue;
      if (extendedFreeChoice.holds && !sameSet(pOut[p], pOut[q]))
        extendedFreeChoice = bad(`${P[p].name} and ${P[q].name} share ${T[shared].name} but have different output transitions.`, [P[p], P[q], T[shared]]);
      if (extendedSimple.holds && !subset(pOut[p], pOut[q]) && !subset(pOut[q], pOut[p]))
        extendedSimple = bad(`The output transitions of ${P[p].name} and ${P[q].name} overlap (both include ${T[shared].name}) but neither set contains the other.`, [P[p], P[q], T[shared]]);
    }

  // Connectivity: nodes 0..n-1 places, n..n+m-1 transitions.
  const N = n + m;
  const succ: number[][] = Array.from({ length: N }, () => []);
  const und: number[][] = Array.from({ length: N }, () => []);
  for (let t = 0; t < m; t++) {
    for (const p of tIn[t]) {
      succ[p].push(n + t);
      und[p].push(n + t);
      und[n + t].push(p);
    }
    for (const p of tOut[t]) {
      succ[n + t].push(p);
      und[p].push(n + t);
      und[n + t].push(p);
    }
  }
  const node = (i: number) => (i < n ? P[i] : T[i - n]);
  const weak = scc(und.map((xs) => xs)); // undirected: SCCs = connected components
  const connected =
    N === 0
      ? ok("The net is empty.")
      : weak.count === 1
        ? ok("Every node is linked to every other by a path, ignoring arc directions.")
        : bad(`The net falls into ${weak.count} unconnected parts.`, componentWitnesses(weak.comp, node));
  const strong = scc(succ);
  const stronglyConnected =
    N === 0
      ? ok("The net is empty.")
      : strong.count === 1
        ? ok("Every node can be reached from every other along the arcs.")
        : bad(`The net has ${strong.count} strongly connected components; e.g. there is no path from ${node(strong.comp.indexOf(0)).name} to ${firstOtherComp(strong.comp, node)}.`, componentWitnesses(strong.comp, node));

  // FT0, TF0, FP0, PF0, isolated
  const has = (xs: NodeRef[], what: string, none: string): Check =>
    xs.length ? { holds: true, witnesses: xs, reason: `${names(xs)} ${xs.length === 1 ? "has" : "have"} ${what}.` } : { holds: false, witnesses: [], reason: none };
  const inputTransitions = has(T.filter((_, t) => tIn[t].length === 0), "no input places and can always fire", "Every transition has an input place.");
  const outputTransitions = has(T.filter((_, t) => tOut[t].length === 0), "no output places", "Every transition has an output place.");
  const inputPlaces = has(P.filter((_, p) => pIn[p].length === 0), "no input transitions", "Every place has an input transition.");
  const outputPlaces = has(P.filter((_, p) => pOut[p].length === 0), "no output transitions", "Every place has an output transition.");
  // Isolated: no arc of any kind (inhibitor, read and reset arcs count, unlike in the checks above).
  const touchedP = new Uint8Array(n);
  const touchedT = new Uint8Array(T.length);
  for (const a of pt.arcs) {
    touchedP[a.place] = 1;
    touchedT[a.transition] = 1;
  }
  const isolated = [...P.filter((_, p) => !touchedP[p] && pIn[p].length + pOut[p].length === 0), ...T.filter((_, t) => !touchedT[t] && tIn[t].length + tOut[t].length === 0)];
  const isolatedNodes = isolated.length
    ? { holds: true, witnesses: isolated, reason: `${names(isolated)} ${isolated.length === 1 ? "is" : "are"} not connected to any arc.` }
    : { holds: false, witnesses: [], reason: "Every node has at least one arc." };

  return {
    pure,
    ordinary,
    homogeneous,
    conservative,
    staticConflictFree,
    stateMachine,
    synchronisationGraph,
    freeChoice,
    extendedFreeChoice,
    extendedSimple,
    connected,
    stronglyConnected,
    inputTransitions,
    outputTransitions,
    inputPlaces,
    outputPlaces,
    isolatedNodes,
  };
}

function firstOtherComp(comp: Int32Array, node: (i: number) => NodeRef): string {
  for (let i = 0; i < comp.length; i++) if (comp[i] !== 0) return node(i).name;
  return "?";
}

/** The smallest component's nodes, as a hint where the net splits. */
function componentWitnesses(comp: Int32Array, node: (i: number) => NodeRef): NodeRef[] {
  const sizes = new Map<number, number>();
  for (const c of comp) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  let best = 0;
  let bestSize = Infinity;
  for (const [c, s] of sizes)
    if (s < bestSize) {
      best = c;
      bestSize = s;
    }
  const out: NodeRef[] = [];
  comp.forEach((c, i) => {
    if (c === best) out.push(node(i));
  });
  return out;
}
