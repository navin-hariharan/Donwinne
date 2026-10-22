// General properties of composite APNs (Konios 2015, Sec. 4.4) and cyclic/reversible nets (Def. 10):
// liveness (Defs 14-15, Lemma 1), boundedness (Defs 16-17), reversibility (Def. 10), purity
// (Def. 18, Lemma 2) and ordinariness (Def. 19, Lemma 3).
//
// The behavioural checks work on a state graph. By default `reachabilityGraph` is the concurrent
// reachability graph CRG(N) of the step semantics (Sec. 3.3-3.4, ./crg). The option
// semantics: "interleaving" explores with core's firing rule instead (one structured transition at a
// time), which is much smaller. For composite step nets with capacity 1 per colour both reach the same
// markings: a step U can only fail to be sequentialised if firing some (t, c) ∈ U puts a token c into a
// place that inhibits another (u, c) ∈ U. In a composite step net that place is cp^t(x) and u takes c
// from x, the finishing place of t; but then t would put a second c into x, which K = 1 forbids for U
// as a whole.

import { Marking, Net, compile, enabledBindings, fire, initialMarking, markingKey, parse } from "@pns/core";
import type { Check } from "./compose";
import { concurrentReachabilityGraph } from "./crg";
import { incidence } from "./model-structure";

/** A reachability graph: state 0 is the initial marking; each edge fires a step (ids of its transitions). */
export interface StateGraph {
  markings: Marking[];
  edges: { from: number; to: number; transitions: string[] }[];
  /** False when exploration stopped at the state limit; the checks then answer only for the explored part. */
  complete: boolean;
}

export interface ReachabilityOptions {
  /** "step" (default): the concurrent reachability graph CRG(N) of Sec. 3.4. "interleaving": core's one-at-a-time firing. */
  semantics?: "step" | "interleaving";
  /** Stop after this many states (default 20000). */
  limit?: number;
}

/** Explore the reachable markings (Def. 5, eq. 3.1), by default with the step semantics of Sec. 3.3. */
export function reachabilityGraph(net: Net, options: ReachabilityOptions = {}): StateGraph {
  const limit = options.limit ?? 20_000;
  if ((options.semantics ?? "step") === "step") {
    const g = concurrentReachabilityGraph(net, { maxStates: limit });
    if (g.initial !== 0) throw new Error("Unexpected CRG: the initial state is not state 0");
    return { markings: g.states, edges: g.edges.map((e) => ({ from: e.from, to: e.to, transitions: [...new Set(e.step.map((s) => s.transition))] })), complete: g.complete };
  }
  const cn = compile(net);
  const errors = cn.problems.filter((p) => p.severity === "error");
  if (errors.length) throw new Error(`The net has errors: ${errors[0].message}`);
  const m0 = initialMarking(cn);
  const markings: Marking[] = [m0];
  const index = new Map<string, number>([[markingKey(m0), 0]]);
  const edges: StateGraph["edges"] = [];
  let complete = true;
  for (let i = 0; i < markings.length; i++) {
    const M = markings[i];
    for (let t = 0; t < cn.transitions.length; t++) {
      for (const b of enabledBindings(cn, t, M).bindings) {
        const M2 = fire(cn, t, b, M);
        const k = markingKey(M2);
        let j = index.get(k);
        if (j === undefined) {
          if (markings.length >= limit) {
            complete = false;
            continue;
          }
          j = markings.length;
          markings.push(M2);
          index.set(k, j);
        }
        edges.push({ from: i, to: j, transitions: [cn.transitions[t].id] });
      }
    }
  }
  return { markings, edges, complete };
}

function successors(g: StateGraph): number[][] {
  const out: number[][] = g.markings.map(() => []);
  for (const e of g.edges) out[e.from].push(e.to);
  return out;
}

/** Strongly connected components (Tarjan, iterative); comp[i] is the component of state i. */
function sccs(g: StateGraph): { comp: number[]; count: number } {
  const succ = successors(g);
  const n = g.markings.length;
  const index = new Array(n).fill(-1);
  const low = new Array(n).fill(0);
  const onStack = new Array(n).fill(false);
  const comp = new Array(n).fill(-1);
  const stack: number[] = [];
  let next = 0;
  let count = 0;
  for (let s = 0; s < n; s++) {
    if (index[s] !== -1) continue;
    const work: [number, number][] = [[s, 0]];
    index[s] = low[s] = next++;
    stack.push(s);
    onStack[s] = true;
    while (work.length) {
      const top = work[work.length - 1];
      const [v, i] = top;
      if (i < succ[v].length) {
        top[1]++;
        const w = succ[v][i];
        if (index[w] === -1) {
          index[w] = low[w] = next++;
          stack.push(w);
          onStack[w] = true;
          work.push([w, 0]);
        } else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
      } else {
        work.pop();
        if (work.length) low[work[work.length - 1][0]] = Math.min(low[work[work.length - 1][0]], low[v]);
        if (low[v] === index[v]) {
          let w: number;
          do {
            w = stack.pop()!;
            onStack[w] = false;
            comp[w] = count;
          } while (w !== v);
          count++;
        }
      }
    }
  }
  return { comp, count };
}

/** States reachable from `from` (including it). */
function reachableFrom(g: StateGraph, from: number): Set<number> {
  const succ = successors(g);
  const seen = new Set([from]);
  const todo = [from];
  while (todo.length) for (const w of succ[todo.pop()!]) if (!seen.has(w)) (seen.add(w), todo.push(w));
  return seen;
}

/**
 * Def. 14: the live transitions. t is live iff from every reachable marking some marking that enables t
 * is reachable, i.e. t fires inside every bottom strongly connected component of the graph.
 */
export function liveTransitions(net: Net, graph: StateGraph = reachabilityGraph(net)): Map<string, boolean> {
  const { comp, count } = sccs(graph);
  const bottom = new Array(count).fill(true);
  for (const e of graph.edges) if (comp[e.from] !== comp[e.to]) bottom[comp[e.from]] = false;
  const firesIn = new Map<string, Set<number>>();
  for (const e of graph.edges)
    for (const t of e.transitions) {
      if (!firesIn.has(t)) firesIn.set(t, new Set());
      firesIn.get(t)!.add(comp[e.from]);
    }
  const bottoms = [...Array(count).keys()].filter((c) => bottom[c]);
  return new Map(net.transitions.filter((t) => !t.coarse).map((t) => [t.id, bottoms.every((c) => firesIn.get(t.id)?.has(c) ?? false)]));
}

/** Def. 14: is the net live (every transition live)? */
export function isLive(net: Net, graph: StateGraph = reachabilityGraph(net)): Check {
  // Liveness depends on every reachable marking, so a partial graph decides nothing either way.
  if (!graph.complete) return { ok: false, unknown: true, reason: `Not decided: the state space was not fully explored (${graph.markings.length.toLocaleString("en")} markings so far)` };
  const live = liveTransitions(net, graph);
  const dead = [...live].filter(([, ok]) => !ok).map(([id]) => net.transitions.find((t) => t.id === id)!.name);
  if (dead.length) return { ok: false, reason: `Not live: ${dead.slice(0, 5).join(", ")}${dead.length > 5 ? " and others" : ""} can stop being fireable (Def. 14)` };
  return { ok: true, reason: `Live: every transition can always become enabled again (Def. 14)` };
}

/** Def. 15: is the marking with index `state` live (every transition enabled somewhere after it)? */
export function isLiveMarking(net: Net, state: number, graph: StateGraph = reachabilityGraph(net)): boolean {
  const reach = reachableFrom(graph, state);
  const fired = new Set(graph.edges.filter((e) => reach.has(e.from)).flatMap((e) => e.transitions));
  return net.transitions.filter((t) => !t.coarse).every((t) => fired.has(t.id));
}

/** Per place: the largest number of tokens of one colour (Def. 16, M((p, g)) ≤ k) and in total (the ℓ of Sec. 4.5.1). */
export function placeBounds(net: Net, graph: StateGraph = reachabilityGraph(net)): Map<string, { perColour: number; total: number }> {
  const cn = compile(net);
  const out = new Map<string, { perColour: number; total: number }>();
  for (const p of cn.places) {
    let perColour = 0;
    let total = 0;
    for (const M of graph.markings) {
      const m = M[p.slot];
      total = Math.max(total, m.size);
      for (const [, n] of m.entries()) perColour = Math.max(perColour, n);
    }
    out.set(p.id, { perColour, total });
  }
  return out;
}

/** Def. 17: is every place k-bounded (Def. 16)? The reason gives the smallest such k. */
export function isKBounded(net: Net, k: number, graph: StateGraph = reachabilityGraph(net)): Check {
  const b = Math.max(0, ...[...placeBounds(net, graph).values()].map((x) => x.perColour));
  // A marking above k in the explored part already disproves k-boundedness; anything else needs the whole graph.
  if (!graph.complete && b <= k) return { ok: false, unknown: true, reason: `Not decided: the state space was not fully explored (at most ${b} token(s) of one colour so far)` };
  return b <= k ? { ok: true, reason: `${b}-bounded: no place ever holds more than ${b} token(s) of one colour (Defs 16-17)` } : { ok: false, reason: `Some place holds ${b} tokens of one colour (Defs 16-17)` };
}

/**
 * Def. 17, structural boundedness: bounded in any initial marking. A sufficient condition, checked here:
 * every place has a capacity, since markings satisfy M ≤ K (Def. 3) and an enabled step keeps
 * M + Post(U) ≤ K (Sec. 3.3), so every reachable marking stays within K.
 */
export function isStructurallyBounded(net: Net): Check {
  const open = net.places.filter((p) => !p.coarse && p.capacity === undefined);
  if (open.length) return { ok: false, reason: `Not decided: ${open[0].name} has no capacity, so the sufficient condition (every place has a capacity K) does not hold` };
  const k = Math.max(0, ...net.places.map((p) => p.capacity ?? 0));
  return { ok: true, reason: `Structurally ${k}-bounded: every place has a capacity, and markings never exceed K (Def. 3, Sec. 3.3, Def. 17)` };
}

/** Def. 10: is the marked net cyclic/reversible (M0 reachable from every reachable marking)? */
export function isReversible(net: Net, graph: StateGraph = reachabilityGraph(net)): Check {
  if (!graph.complete) return { ok: false, unknown: true, reason: `Not decided: the state space was not fully explored (${graph.markings.length.toLocaleString("en")} markings so far)` };
  const { comp } = sccs(graph);
  const bad = comp.findIndex((c) => c !== comp[0]);
  if (bad >= 0) return { ok: false, reason: `Not cyclic/reversible: the initial marking cannot be recovered from reachable marking number ${bad} (Def. 10)` };
  return { ok: true, reason: `Cyclic/reversible: the initial marking can be recovered from each of the ${graph.markings.length} reachable markings (Def. 10)` };
}

/** Def. 18: is the net pure (no place is both a pre-place and a post-place of one transition)? */
export function isPure(net: Net): Check {
  const inc = incidence(net);
  for (const t of net.transitions) {
    const post = new Set(inc.post.get(t.id));
    const loop = inc.pre.get(t.id)!.find((p) => post.has(p));
    if (loop) return { ok: false, reason: `Not pure: ${net.places.find((p) => p.id === loop)!.name} is both a pre-place and a post-place of ${t.name} (Def. 18)` };
  }
  return { ok: true, reason: "Pure: no self-loops (Def. 18)" };
}

/** True for an inscription of weight one: a variable or colour, optionally written 1`v. */
function weightOne(src: string): boolean {
  try {
    const e = parse(src.trim());
    if (e.k === "id") return true;
    if (e.k === "bin" && e.op === "`" && e.l.k === "num" && e.l.v === 1 && (e.r.k === "id" || e.r.k === "num")) return true;
    return e.k === "num" && e.v === 1;
  } catch {
    return false;
  }
}

/** Def. 19: is the net ordinary (every arc weight is one)? */
export function isOrdinary(net: Net): Check {
  const seen = new Set<string>();
  for (const a of net.arcs) {
    if (a.kind !== "normal") continue;
    const k = `${a.source}|${a.target}`;
    const where = () => {
      const n = (id: string) => net.places.find((p) => p.id === id)?.name ?? net.transitions.find((t) => t.id === id)?.name ?? id;
      return `${n(a.source)} → ${n(a.target)}`;
    };
    if (seen.has(k)) return { ok: false, reason: `Not ordinary: two arcs ${where()} add up to weight 2 (Def. 19)` };
    seen.add(k);
    if (!weightOne(a.inscription)) return { ok: false, reason: `Not ordinary: the arc ${where()} is inscribed ${a.inscription}, not a single token (Def. 19)` };
  }
  return { ok: true, reason: "Ordinary: every arc has weight one (Def. 19)" };
}

/** A goal for {@link findReachable}: place name → user colours that must all be in that place. */
export type MarkingGoal = Record<string, (string | number)[]>;

export interface FoundPath {
  found: boolean;
  /** The firing sequence that reaches the goal, as transition names and colour modes. */
  path: { transition: string; binding: Record<string, unknown> }[];
  /** Number of markings looked at. */
  explored: number;
  /** True when the search covered every reachable marking (so `found: false` means unreachable). */
  complete: boolean;
}

/**
 * Breadth-first search for a reachable marking that contains the goal tokens, with core's interleaving
 * firing rule (which reaches the same markings as the step semantics for composite step nets with
 * capacity 1, see the top of this file). Returns a shortest firing sequence.
 */
export function findReachable(net: Net, goal: MarkingGoal, options: { limit?: number } = {}): FoundPath {
  const limit = options.limit ?? 200_000;
  const cn = compile(net);
  const errors = cn.problems.filter((p) => p.severity === "error");
  if (errors.length) throw new Error(`The net has errors: ${errors[0].message}`);
  const wanted = Object.entries(goal).map(([name, colours]) => {
    const p = cn.places.find((x) => x.name === name);
    if (!p) throw new Error(`No place ${name}`);
    return { slot: p.slot, colours };
  });
  const ok = (M: Marking) => wanted.every((w) => w.colours.every((c) => M[w.slot].count(c) > 0));
  const m0 = initialMarking(cn);
  const markings: Marking[] = [m0];
  const back: { from: number; transition: string; binding: Record<string, unknown> }[] = [{ from: -1, transition: "", binding: {} }];
  const seen = new Set([markingKey(m0)]);
  const pathTo = (i: number) => {
    const out: FoundPath["path"] = [];
    for (let k = i; k > 0; k = back[k].from) out.unshift({ transition: back[k].transition, binding: back[k].binding });
    return out;
  };
  let complete = true;
  for (let i = 0; i < markings.length; i++) {
    if (ok(markings[i])) return { found: true, path: pathTo(i), explored: markings.length, complete };
    for (let t = 0; t < cn.transitions.length; t++)
      for (const b of enabledBindings(cn, t, markings[i]).bindings) {
        const M2 = fire(cn, t, b, markings[i]);
        const k = markingKey(M2);
        if (seen.has(k)) continue;
        if (markings.length >= limit) {
          complete = false;
          continue;
        }
        seen.add(k);
        markings.push(M2);
        back.push({ from: i, transition: cn.transitions[t].name, binding: b });
      }
  }
  return { found: false, path: [], explored: markings.length, complete };
}
