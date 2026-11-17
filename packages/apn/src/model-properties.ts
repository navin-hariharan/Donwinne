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
  /**
   * False when exploration stopped at the state limit or some transition could not be evaluated.
   * The checks then decide only what the explored part proves and answer "unknown" otherwise.
   */
  complete: boolean;
  /**
   * Incomplete graphs: the states whose successors may not all be listed (not expanded, a successor
   * beyond the limit, or a transition that could not be evaluated there). When absent, every state
   * of an incomplete graph counts as open.
   */
  open?: number[];
}

/** The open states of a graph as a predicate (every state when an incomplete graph does not list them). */
function openStates(g: StateGraph): (s: number) => boolean {
  if (g.complete) return () => false;
  if (!g.open) return () => true;
  const set = new Set(g.open);
  return (s) => set.has(s);
}

interface ReachabilityOptions {
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
    return {
      markings: g.states,
      edges: g.edges.map((e) => ({ from: e.from, to: e.to, transitions: [...new Set(e.step.map((s) => s.transition))] })),
      complete: g.complete,
      ...(g.complete ? {} : { open: g.open }),
    };
  }
  const cn = compile(net);
  const errors = cn.problems.filter((p) => p.severity === "error");
  if (errors.length) throw new Error(`The net has errors: ${errors[0].message}`);
  const m0 = initialMarking(cn);
  const markings: Marking[] = [m0];
  const index = new Map<string, number>([[markingKey(m0), 0]]);
  const edges: StateGraph["edges"] = [];
  const open: number[] = [];
  for (let i = 0; i < markings.length; i++) {
    const M = markings[i];
    let partial = false;
    for (let t = 0; t < cn.transitions.length; t++) {
      const r = enabledBindings(cn, t, M);
      // A transition that could not be checked here leaves M's successors unknown.
      if (r.error) partial = true;
      for (const b of r.bindings) {
        const M2 = fire(cn, t, b, M);
        const k = markingKey(M2);
        let j = index.get(k);
        if (j === undefined) {
          if (markings.length >= limit) {
            partial = true;
            continue;
          }
          j = markings.length;
          markings.push(M2);
          index.set(k, j);
        }
        edges.push({ from: i, to: j, transitions: [cn.transitions[t].id] });
      }
    }
    if (partial) open.push(i);
  }
  return open.length ? { markings, edges, complete: false, open } : { markings, edges, complete: true };
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
 *
 * On a complete graph every answer is true or false. On a partial graph "unknown" is the rule: a
 * transition is reported not live (false) only when the explored part proves it, i.e. some bottom
 * component without open states (so truly bottom in the whole graph) never fires it; otherwise
 * it is null (unknown), since liveness needs every reachable marking.
 */
export function liveTransitions(net: Net, graph: StateGraph = reachabilityGraph(net)): Map<string, boolean | null> {
  const { comp, count } = sccs(graph);
  const bottom = new Array(count).fill(true);
  for (const e of graph.edges) if (comp[e.from] !== comp[e.to]) bottom[comp[e.from]] = false;
  const isOpen = openStates(graph);
  const closed = new Array(count).fill(true);
  for (let s = 0; s < graph.markings.length; s++) if (isOpen(s)) closed[comp[s]] = false;
  const firesIn = new Map<string, Set<number>>();
  for (const e of graph.edges)
    for (const t of e.transitions) {
      if (!firesIn.has(t)) firesIn.set(t, new Set());
      firesIn.get(t)!.add(comp[e.from]);
    }
  const bottoms = [...Array(count).keys()].filter((c) => bottom[c]);
  const provenBottoms = bottoms.filter((c) => closed[c]);
  return new Map(
    net.transitions
      .filter((t) => !t.coarse)
      .map((t) => {
        const fires = (c: number) => firesIn.get(t.id)?.has(c) ?? false;
        if (graph.complete) return [t.id, bottoms.every(fires)];
        return [t.id, provenBottoms.every(fires) ? null : false];
      }),
  );
}

/** Def. 14: is the net live (every transition live)? */
export function isLive(net: Net, graph: StateGraph = reachabilityGraph(net)): Check {
  const live = liveTransitions(net, graph);
  const dead = [...live].filter(([, ok]) => ok === false).map(([id]) => net.transitions.find((t) => t.id === id)!.name);
  const list = `${dead.slice(0, 5).join(", ")}${dead.length > 5 ? " and others" : ""}`;
  if (dead.length) return { ok: false, reason: `Not live: ${list} can stop being fireable (Def. 14)${graph.complete ? "" : ", already in the explored part"}` };
  // Liveness depends on every reachable marking, so a partial graph cannot prove it.
  if (!graph.complete) return { ok: false, unknown: true, reason: `Not decided: the state space was not fully explored (${graph.markings.length.toLocaleString("en")} markings so far)` };
  return { ok: true, reason: `Live: every transition can always become enabled again (Def. 14)` };
}

/**
 * Def. 15: is the marking with index `state` live (every transition enabled somewhere after it)?
 * True as soon as every transition fires somewhere after it in the graph; false only when nothing
 * reachable from it is open, so that no unexplored successor could fire the missing transitions.
 * Otherwise unknown.
 */
export function isLiveMarking(net: Net, state: number, graph: StateGraph = reachabilityGraph(net)): Check {
  const reach = reachableFrom(graph, state);
  const fired = new Set(graph.edges.filter((e) => reach.has(e.from)).flatMap((e) => e.transitions));
  const missing = net.transitions.filter((t) => !t.coarse && !fired.has(t.id)).map((t) => t.name);
  if (!missing.length) return { ok: true, reason: `Live marking: every transition can fire after marking ${state} (Def. 15)` };
  const isOpen = openStates(graph);
  if ([...reach].some(isOpen))
    return {
      ok: false,
      unknown: true,
      reason: `Not decided: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " and others" : ""} did not fire in the explored part after marking ${state}, which reaches unexplored markings`,
    };
  return { ok: false, reason: `Not a live marking: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " and others" : ""} can never fire after marking ${state} (Def. 15)` };
}

/** Bounds of one place over the markings of a graph (Def. 16 and the ℓ of Sec. 4.5.1). */
export interface PlaceBound {
  /** Most tokens of one colour seen in the explored markings (observed, a lower bound on the true maximum). */
  perColour: number;
  /** Most tokens in total seen in the explored markings (observed). */
  total: number;
  /** The graph covered every reachable marking, so the observed maxima are the exact bounds. */
  complete: boolean;
  /**
   * A proven upper bound on the tokens of one colour: the observed maximum on a complete graph,
   * otherwise the place's capacity when it has one (markings never exceed K), otherwise null.
   */
  provenPerColour: number | null;
  /** A proven upper bound on the total: the observed maximum on a complete graph, otherwise the capacity of an uncoloured place, otherwise null. */
  provenTotal: number | null;
}

/**
 * Per place: the most tokens of one colour (Def. 16, M((p, g)) ≤ k) and in total (the ℓ of Sec. 4.5.1),
 * observed over the graph's markings, with the bounds the graph proves (see {@link PlaceBound}).
 */
export function placeBounds(net: Net, graph: StateGraph = reachabilityGraph(net)): Map<string, PlaceBound> {
  const cn = compile(net);
  const out = new Map<string, PlaceBound>();
  for (const p of cn.places) {
    let perColour = 0;
    let total = 0;
    for (const M of graph.markings) {
      const m = M[p.slot];
      total = Math.max(total, m.size);
      for (const [, n] of m.entries()) perColour = Math.max(perColour, n);
    }
    // The compiled capacity (ambient nets: 1 per colour unless given) holds in every reachable
    // marking: per colour for coloured nets, in total for uncoloured ones.
    const cap = p.capacity;
    out.set(p.id, {
      perColour,
      total,
      complete: graph.complete,
      provenPerColour: graph.complete ? perColour : cap ?? null,
      provenTotal: graph.complete ? total : cap !== undefined && !cn.coloured ? cap : null,
    });
  }
  return out;
}

/** Def. 17: is every place k-bounded (Def. 16)? The reason gives the smallest such k. */
export function isKBounded(net: Net, k: number, graph: StateGraph = reachabilityGraph(net)): Check {
  const bounds = [...placeBounds(net, graph).values()];
  const b = Math.max(0, ...bounds.map((x) => x.perColour));
  // A marking above k in the explored part already disproves k-boundedness. Otherwise a partial
  // graph proves it only when every place has a proven bound (its capacity) of at most k.
  if (!graph.complete && b <= k) {
    const proven = bounds.every((x) => x.provenPerColour !== null && x.provenPerColour <= k);
    if (proven) return { ok: true, reason: `${k}-bounded: every place has a capacity of at most ${k} per colour, which no reachable marking exceeds (Defs 16-17)` };
    return { ok: false, unknown: true, reason: `Not decided: the state space was not fully explored (at most ${b} token(s) of one colour so far)` };
  }
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
type MarkingGoal = Record<string, (string | number)[]>;

interface FoundPath {
  found: boolean;
  /** The firing sequence that reaches the goal, as transition names and colour modes. */
  path: { transition: string; binding: Record<string, unknown> }[];
  /** Number of markings looked at. */
  explored: number;
  /**
   * True when the search covered every reachable marking, so `found: false` means unreachable.
   * False when the limit stopped it or some transition could not be evaluated at some marking
   * (`found: false` then means "not found", not "unreachable").
   */
  complete: boolean;
  /** Markings where some transition could not be evaluated (its successors there are unknown). */
  unresolved: number;
  /** The first evaluation error met, if any. */
  error?: string;
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
  let unresolved = 0;
  let error: string | undefined;
  const result = (found: boolean, path: FoundPath["path"]): FoundPath => ({ found, path, explored: markings.length, complete, unresolved, ...(error ? { error } : {}) });
  for (let i = 0; i < markings.length; i++) {
    if (ok(markings[i])) return result(true, pathTo(i));
    let failed = false;
    for (let t = 0; t < cn.transitions.length; t++) {
      const r = enabledBindings(cn, t, markings[i]);
      // An evaluation error means some bindings may be missing: what lies behind them is unknown.
      if (r.error) {
        failed = true;
        error ??= `${cn.transitions[t].name}: ${r.error}`;
      }
      for (const b of r.bindings) {
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
    if (failed) {
      unresolved++;
      complete = false;
    }
  }
  return result(false, []);
}
