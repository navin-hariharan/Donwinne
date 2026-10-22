// Adapter from step transition systems built elsewhere (the concurrent reachability graph of an
// APN or T-APN, Konios Def. 5) to the TransitionSystem the CTL checker and path queries work on.
// The graph is read structurally, so this package does not depend on the one that builds it.

import { compile, showValue, type Marking, type Net, type Value } from "@pns/core";
import { toPTNet } from "./ptnet";
import { transitionSystemFromGraph, type ColourView, type TransitionSystem } from "./ts";
import type { NodeRef } from "./types";

/** A structured transition (t, c): the transition's id and its colour mode. */
export interface StepElement {
  transition: string;
  colour: Value;
}

/**
 * The shape of a step transition system over core markings: states by index, edges labelled with
 * steps (multisets of structured transitions, as lists). The concurrent reachability graph of the
 * APN package has this shape.
 */
export interface StepGraphLike {
  states: readonly Marking[];
  edges: readonly { from: number; to: number; step: readonly StepElement[] }[];
  initial: number;
  /** False when the graph was cut short (default true). */
  complete?: boolean;
  /** Why the graph is incomplete, shown in the notes. */
  reason?: string;
  /**
   * In an incomplete graph, the states whose successors may not all be listed. When absent, every
   * state of an incomplete graph is treated as open.
   */
  open?: readonly number[];
}

/**
 * Wrap a step transition system of `net` (e.g. its concurrent reachability graph, or the graph of
 * its maximal steps) as a {@link TransitionSystem}. Places and transitions are named as in the
 * unfolded P/T view, so formulas are written the same way on both: `p[1]` for the tokens of colour 1
 * on p, `p` for all of them, `fireable(t)` for some mode of t occurring in an enabled step.
 * Throws if the net has errors or a marking holds a colour the unfolding does not know.
 */
export function transitionSystemFromStepGraph(net: Net, g: StepGraphLike, opts: StepGraphOptions = {}): TransitionSystem {
  const ts = colouredView(net, g);
  return opts.projection === "colourBlind" ? colourBlindView(ts) : ts;
}

export interface StepGraphOptions {
  /**
   * "coloured" (default): unfolded names, `p[c]` per colour. "colourBlind": places and transitions
   * by base name, markings summed over colours and steps listing base transitions. The states stay
   * those of the coloured graph (two states whose sums agree are not merged), so this is the
   * coloured behaviour seen without colours, not the behaviour of the uncoloured net; for that,
   * build the state space of the {@link colourBlindProjection} with {@link buildTransitionSystem}.
   */
  projection?: ColourView;
}

/** Relabel a coloured transition system by base names, summing token counts over colours. */
function colourBlindView(ts: TransitionSystem): TransitionSystem {
  const base = (r: NodeRef) => r.baseName ?? r.name;
  const placeNames = [...new Set(ts.places.map(base))];
  const pIdx = new Map(placeNames.map((n, i) => [n, i] as const));
  const places: NodeRef[] = placeNames.map((n) => {
    const members = ts.places.filter((p) => base(p) === n);
    return { id: n, name: n, elementIds: [...new Set(members.flatMap((m) => m.elementIds))] };
  });
  const transNames = [...new Set(ts.transitions.map(base))];
  const tIdx = new Map(transNames.map((n, i) => [n, i] as const));
  const transitions: NodeRef[] = transNames.map((n) => {
    const members = ts.transitions.filter((t) => base(t) === n);
    return { id: n, name: n, elementIds: [...new Set(members.flatMap((m) => m.elementIds))] };
  });
  const pMap = ts.places.map((p) => pIdx.get(base(p))!);
  const tMap = ts.transitions.map((t) => tIdx.get(base(t))!);
  const markings = ts.markings.map((M) => {
    const a = new Int32Array(places.length);
    for (let p = 0; p < ts.places.length; p++) a[pMap[p]] += M[p];
    return a;
  });
  const edges: { from: number; to: number; transitions: number[] }[] = [];
  for (let s = 0; s < ts.markings.length; s++)
    for (let e = ts.edgeStart[s]; e < ts.edgeStart[s + 1]; e++) edges.push({ from: s, to: ts.edgeTo[e], transitions: ts.labels[ts.edgeLabel[e]].map((t) => tMap[t]) });
  const open: number[] = [];
  ts.open?.forEach((v, s) => v && open.push(s));
  return transitionSystemFromGraph({
    places,
    transitions,
    markings,
    edges,
    semantics: ts.semantics,
    complete: ts.complete,
    ...(ts.complete ? {} : { open }),
    notes: ["Colour-blind view: token counts summed over colours, transitions by base name; the states are those of the coloured graph.", ...ts.notes],
  });
}

function colouredView(net: Net, g: StepGraphLike): TransitionSystem {
  const pt = toPTNet(net);
  if (pt.errors.length) throw new Error(`The net has errors: ${pt.errors[0]}`);
  const cn = compile(net);
  // Place index of (slot of the coloured net, colour text).
  const placeIndex = new Map<string, number>();
  const byName = new Map(pt.places.map((p, i) => [p.baseName ?? p.name, i] as const));
  const colourKey = (base: string, colour: string) => `${base}\u0000${colour}`;
  pt.places.forEach((p, i) => placeIndex.set(colourKey(p.baseName ?? p.name, p.colour ?? "dot"), i));
  const slotName = cn.slotPlaces.map((members) => members[0].name);

  const transitions: NodeRef[] = pt.transitions.slice();
  const tIndex = new Map<string, number>();
  const transitionOf = (e: StepElement): number => {
    const c = showValue(e.colour);
    const key = `${e.transition}\u0000${c}`;
    let i = tIndex.get(key);
    if (i !== undefined) return i;
    const same = pt.transitions.map((t, k) => [t, k] as const).filter(([t]) => t.elementIds[0] === e.transition || t.id === e.transition);
    const exact = same.filter(([t]) => (t.colour ?? "").split(", ").some((b) => b.slice(b.indexOf("=") + 1) === c));
    if (exact.length === 1) i = exact[0][1];
    else if (same.length === 1 && c === "dot") i = same[0][1];
    else {
      const base = same[0]?.[0].baseName ?? cn.transitions.find((t) => t.id === e.transition)?.name ?? e.transition;
      i = transitions.length;
      transitions.push({ id: `${e.transition}#${c}`, name: c === "dot" ? base : `${base}<${c}>`, elementIds: [e.transition], baseName: base, ...(c === "dot" ? {} : { colour: c }) });
    }
    tIndex.set(key, i);
    return i;
  };

  const markings = g.states.map((M, s) => {
    const a = new Int32Array(pt.places.length);
    M.forEach((ms, slot) => {
      const base = slotName[slot];
      for (const [v, n] of ms.entries()) {
        const text = showValue(v);
        const p = placeIndex.get(colourKey(base, text)) ?? (text === "dot" ? byName.get(base) : undefined);
        if (p === undefined) throw new Error(`State ${s}: place ${base} holds colour ${text}, which the unfolding does not have.`);
        a[p] += n;
      }
    });
    return a;
  });
  const edges = g.edges.map((e) => ({ from: e.from, to: e.to, transitions: e.step.map(transitionOf) }));
  const complete = g.complete ?? true;
  return transitionSystemFromGraph({
    places: pt.places,
    transitions,
    markings,
    edges,
    initial: g.initial,
    semantics: "step",
    complete,
    ...(complete || !g.open ? {} : { open: g.open }),
    notes: complete ? [] : [`The step graph is incomplete${g.reason ? ` (limit: ${g.reason})` : ""}; results that need the whole graph are reported as unknown.`],
  });
}
