// Generic labelled transition systems for verification: the interleaving reachability graph of
// the P/T view, or any externally built graph (for example a concurrent reachability graph of an
// ambient Petri net, whose edges are steps of several transitions).

import type { Net } from "@pns/core";
import { checkAbort, toPTNet, type PTNet } from "./ptnet";
import { colourBlindProjection } from "./projection";
import { explore } from "./statespace";
import { stepSystem } from "./steps";
import type { NodeRef } from "./types";

/**
 * A finite labelled transition system whose states are markings. State 0 is the initial state.
 * Edges are stored in compressed sparse row form: the edges leaving state s are
 * `edgeStart[s] .. edgeStart[s + 1] - 1`, edge e goes to `edgeTo[e]` and is labelled by the
 * transitions `labels[edgeLabel[e]]` (one transition under interleaving semantics, a multiset of
 * transitions, as a list with repetitions, under step semantics).
 */
export interface TransitionSystem {
  /** "interleaving": one transition per edge; "step": an edge fires a step (a multiset of transitions). */
  readonly semantics: "interleaving" | "step";
  /** Places whose token counts the markings record (unfolded places for coloured nets). */
  readonly places: readonly NodeRef[];
  /** Transitions that may label edges (unfolded transitions for coloured nets). */
  readonly transitions: readonly NodeRef[];
  /** markings[s][p] = tokens on places[p] in state s. */
  readonly markings: readonly ArrayLike<number>[];
  readonly edgeStart: Int32Array;
  readonly edgeTo: Int32Array;
  readonly edgeLabel: Int32Array;
  /** Distinct edge labels: transition indices (with repetitions for auto-concurrency). */
  readonly labels: readonly (readonly number[])[];
  /** Every reachable state is present; false when exploration stopped at its limit. */
  readonly complete: boolean;
  /**
   * Incomplete systems: open[s] = 1 when state s may have successors that are not listed (it was
   * not expanded, or some of its successors fell beyond the limit). When absent, every state of an
   * incomplete system counts as open. Model checking treats an open state as having unknown
   * successors, so verdicts that do not depend on them stay conclusive.
   */
  readonly open?: Uint8Array;
  /** Why the system may be incomplete or approximate. */
  readonly notes: readonly string[];
}

export interface TransitionSystemOptions {
  /** State limit (default 100000). */
  maxStates?: number;
  /** Abort the exploration; the call then throws an Error named "AbortError". */
  signal?: AbortSignal;
}

/** Number of states. */
export const stateCount = (ts: TransitionSystem) => ts.markings.length;

/** Marked places of state s by display name. */
export function markingOf(ts: TransitionSystem, s: number): Record<string, number> {
  const r: Record<string, number> = {};
  const M = ts.markings[s];
  for (let p = 0; p < ts.places.length; p++) if (M[p]) r[ts.places[p].name] = M[p];
  return r;
}

/** Readable form of a step label, e.g. "t1" or "{t1, 2·t2}". */
export function labelText(ts: TransitionSystem, label: number): string {
  const ts_ = ts.labels[label];
  if (ts_.length === 1) return ts.transitions[ts_[0]].name;
  const counts = new Map<number, number>();
  for (const t of ts_) counts.set(t, (counts.get(t) ?? 0) + 1);
  return `{${[...counts].map(([t, n]) => (n === 1 ? ts.transitions[t].name : `${n}·${ts.transitions[t].name}`)).join(", ")}}`;
}

/** Build the compressed edge arrays from parallel edge lists. */
function compress(n: number, from: ArrayLike<number>, to: ArrayLike<number>, label: ArrayLike<number>) {
  const m = from.length;
  const edgeStart = new Int32Array(n + 1);
  for (let e = 0; e < m; e++) edgeStart[from[e] + 1]++;
  for (let s = 0; s < n; s++) edgeStart[s + 1] += edgeStart[s];
  const fill = edgeStart.slice(0, n);
  const edgeTo = new Int32Array(m);
  const edgeLabel = new Int32Array(m);
  for (let e = 0; e < m; e++) {
    const k = fill[from[e]]++;
    edgeTo[k] = to[e];
    edgeLabel[k] = label[e];
  }
  return { edgeStart, edgeTo, edgeLabel };
}

/**
 * The interleaving reachability graph of a P/T view (see {@link toPTNet}) as a transition system.
 * Uses the same firing rule as the qualitative analysis (inhibitor, read, reset, equal arcs,
 * capacities, marking-dependent weights).
 */
export function interleavingSystem(pt: PTNet, opts: TransitionSystemOptions = {}): TransitionSystem {
  const maxStates = opts.maxStates ?? 100_000;
  checkAbort(opts.signal);
  const notes: string[] = [];
  if (pt.errors.length) throw new Error(`The net has errors: ${pt.errors[0]}`);
  const ss = explore(pt, maxStates, opts.signal);
  for (const e of ss.errors) notes.push(`While exploring the state space: ${e}`);
  if (ss.truncated) notes.push(`The state space was cut off at ${maxStates} states; results on the partial graph are not conclusive.`);
  const { edgeStart, edgeTo, edgeLabel } = compress(ss.markings.length, ss.from, ss.to, ss.trans);
  let open: Uint8Array | undefined;
  if (ss.truncated) {
    open = new Uint8Array(ss.markings.length);
    open.fill(1, ss.cutAt ?? 0);
  }
  return {
    semantics: "interleaving",
    places: pt.places,
    transitions: pt.transitions,
    markings: ss.markings,
    edgeStart,
    edgeTo,
    edgeLabel,
    labels: pt.transitions.map((_, t) => [t]),
    complete: !ss.truncated,
    ...(open ? { open } : {}),
    notes,
  };
}

/** How a coloured net is read when its state space is built. */
export type ColourView = "coloured" | "colourBlind";

export interface BuildTransitionSystemOptions extends TransitionSystemOptions {
  /**
   * "coloured" (default): coloured nets are unfolded; places and transitions carry unfolded names
   * such as "p1[a]" and "t<x=a>". "colourBlind": the net's {@link colourBlindProjection} is used,
   * the uncoloured net Snoopy runs when colours are ignored (token counts summed over colours, one
   * transition per coloured transition), as in the Charlie analyses of Konios (2015, ch. 7).
   */
  projection?: ColourView;
  /** "interleaving" (default): one transition per edge. "maximalSteps": every edge a maximal step (see {@link stepSystem}). */
  semantics?: "interleaving" | "maximalSteps";
}

/**
 * The reachability graph of a net as a transition system: by default the interleaving graph of the
 * unfolded net. Throws if the net has errors that make the state space meaningless.
 */
export function buildTransitionSystem(net: Net, opts: BuildTransitionSystemOptions = {}): TransitionSystem {
  const notes: string[] = [];
  let source = net;
  if (opts.projection === "colourBlind") {
    const pr = colourBlindProjection(net);
    source = pr.net;
    if (pr.net !== net) notes.push("Colour-blind projection: token counts are summed over colours and each coloured transition is one transition.", ...pr.notes);
  }
  const pt = toPTNet(source);
  const ts = opts.semantics === "maximalSteps" ? stepSystem(pt, opts) : interleavingSystem(pt, opts);
  notes.push(...pt.warnings.filter((w) => !/structural/i.test(w)));
  return notes.length ? { ...ts, notes: [...notes, ...ts.notes] } : ts;
}

/** Input for {@link transitionSystemFromGraph}: a graph built elsewhere, e.g. a concurrent reachability graph. */
export interface GraphInput {
  /** Place names (or full references); markings are indexed in this order. */
  places: readonly (string | NodeRef)[];
  /** Transition names (or full references). */
  transitions: readonly (string | NodeRef)[];
  /** Markings by state, as token counts per place (array in `places` order, or a record by place name). State 0 is initial unless `initial` says otherwise. */
  markings: readonly (ArrayLike<number> | Record<string, number>)[];
  /** Edges; `transitions` lists the fired transitions (indices or names), with repetitions for auto-concurrency. */
  edges: readonly { from: number; to: number; transitions: readonly (number | string)[] }[];
  /** Index of the initial state (default 0). */
  initial?: number;
  semantics?: "interleaving" | "step";
  complete?: boolean;
  /** Incomplete graphs: the states whose successors may be missing (default: all of them). */
  open?: readonly number[];
  notes?: readonly string[];
}

const asRef = (x: string | NodeRef): NodeRef => (typeof x === "string" ? { id: x, name: x, elementIds: [] } : x);

/**
 * Wrap an externally built graph as a {@link TransitionSystem} so the CTL checker, path queries and
 * fault-tolerance analysis can run on it. States are renumbered so that the initial state is 0.
 */
export function transitionSystemFromGraph(g: GraphInput): TransitionSystem {
  const places = g.places.map(asRef);
  const transitions = g.transitions.map(asRef);
  const pIndex = new Map(places.map((p, i) => [p.name, i] as const));
  const tIndex = new Map(transitions.map((t, i) => [t.name, i] as const));
  const n = g.markings.length;
  const init = g.initial ?? 0;
  if (n && (init < 0 || init >= n)) throw new Error(`Initial state ${init} is out of range`);
  const perm = (s: number) => (s === init ? 0 : s === 0 ? init : s);
  const markings: Int32Array[] = new Array(n);
  for (let s = 0; s < n; s++) {
    const src = g.markings[s];
    const M = new Int32Array(places.length);
    if (typeof (src as ArrayLike<number>).length === "number") {
      const a = src as ArrayLike<number>;
      for (let p = 0; p < places.length; p++) M[p] = a[p] ?? 0;
    } else
      for (const [name, v] of Object.entries(src as Record<string, number>)) {
        const p = pIndex.get(name);
        if (p === undefined) throw new Error(`State ${s}: unknown place "${name}"`);
        M[p] = v;
      }
    markings[perm(s)] = M;
  }
  const labelKey = new Map<string, number>();
  const labels: number[][] = [];
  const from: number[] = [];
  const to: number[] = [];
  const lab: number[] = [];
  for (const e of g.edges) {
    if (e.from < 0 || e.from >= n || e.to < 0 || e.to >= n) throw new Error(`Edge ${e.from} → ${e.to} is out of range`);
    const ids = e.transitions.map((t) => {
      if (typeof t === "number") {
        if (t < 0 || t >= transitions.length) throw new Error(`Unknown transition index ${t}`);
        return t;
      }
      const i = tIndex.get(t);
      if (i === undefined) throw new Error(`Unknown transition "${t}"`);
      return i;
    });
    ids.sort((a, b) => a - b);
    const key = ids.join(",");
    let l = labelKey.get(key);
    if (l === undefined) {
      l = labels.length;
      labels.push(ids);
      labelKey.set(key, l);
    }
    from.push(perm(e.from));
    to.push(perm(e.to));
    lab.push(l);
  }
  const semantics = g.semantics ?? (labels.some((l) => l.length !== 1) ? "step" : "interleaving");
  const complete = g.complete ?? true;
  let open: Uint8Array | undefined;
  if (!complete) {
    open = new Uint8Array(n);
    if (g.open)
      for (const s of g.open) {
        if (s < 0 || s >= n) throw new Error(`Open state ${s} is out of range`);
        open[perm(s)] = 1;
      }
    else open.fill(1);
  }
  return { semantics, places, transitions, markings, ...compress(n, from, to, lab), labels, complete, ...(open ? { open } : {}), notes: g.notes ?? [] };
}

/** Predecessor lists in compressed form (edge indices into the successor arrays). */
export interface Predecessors {
  start: Int32Array;
  /** Source state of each listed edge. */
  from: Int32Array;
}

export function predecessors(ts: TransitionSystem): Predecessors {
  const n = ts.markings.length;
  const m = ts.edgeTo.length;
  const start = new Int32Array(n + 1);
  for (let e = 0; e < m; e++) start[ts.edgeTo[e] + 1]++;
  for (let s = 0; s < n; s++) start[s + 1] += start[s];
  const fill = start.slice(0, n);
  const from = new Int32Array(m);
  for (let s = 0; s < n; s++) for (let e = ts.edgeStart[s]; e < ts.edgeStart[s + 1]; e++) from[fill[ts.edgeTo[e]]++] = s;
  return { start, from };
}

/**
 * States without outgoing edges. In an incomplete system, states that may have unlisted successors
 * (see {@link TransitionSystem.open}) are left out: only states known to be dead are returned.
 */
export function deadStates(ts: TransitionSystem): number[] {
  const r: number[] = [];
  const open = openStates(ts);
  for (let s = 0; s < ts.markings.length; s++) if (ts.edgeStart[s] === ts.edgeStart[s + 1] && !open?.[s]) r.push(s);
  return r;
}

/** The open states of a system (see {@link TransitionSystem.open}), or undefined when it is complete. */
export function openStates(ts: TransitionSystem): Uint8Array | undefined {
  if (ts.complete) return undefined;
  return ts.open ?? new Uint8Array(ts.markings.length).fill(1);
}
