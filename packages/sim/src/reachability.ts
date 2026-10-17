// Reachability graph by breadth-first search over the interleaving semantics of the core firing rule.

import { Net, compile, enabledBindings, fire, initialMarking, markingKey, showBinding, showTokens } from "@pns/core";

export interface RGState {
  id: number;
  /** Tokens per place name (counts for P/T nets, multisets for coloured nets). */
  marking: Record<string, string>;
  /** No transition is enabled. */
  dead: boolean;
}

export interface RGEdge {
  from: number;
  to: number;
  /** Transition name plus binding, e.g. "t1" or "t<x=a>". */
  label: string;
  transitionId: string;
}

export interface ReachabilityGraph {
  states: RGState[];
  edges: RGEdge[];
  /** The state limit was reached; the graph is incomplete. */
  truncated: boolean;
  /** Evaluation problems met while exploring (e.g. too many bindings). */
  errors: string[];
}

/** Build the reachability graph from the initial marking, stopping at maxStates states (default 10000). */
export function reachabilityGraph(net: Net, opts: { maxStates?: number } = {}): ReachabilityGraph {
  const maxStates = opts.maxStates ?? 10_000;
  const cn = compile(net);
  const errs = cn.problems.filter((p) => p.severity === "error");
  if (errs.length) throw new Error(errs[0].message);
  const names: { name: string; slot: number }[] = [];
  const seenName = new Set<string>();
  for (const p of cn.places)
    if (!seenName.has(p.name)) {
      seenName.add(p.name);
      names.push({ name: p.name, slot: p.slot });
    }
  const M0 = initialMarking(cn);
  const index = new Map<string, number>([[markingKey(M0), 0]]);
  const markings = [M0];
  const states: RGState[] = [];
  const edges: RGEdge[] = [];
  const errors = new Set<string>();
  let truncated = false;
  for (let i = 0; i < markings.length; i++) {
    const M = markings[i];
    let dead = true;
    for (const t of cn.transitions) {
      const r = enabledBindings(cn, t.index, M);
      if (r.error) errors.add(`${t.name}: ${r.error}`);
      for (const b of r.bindings) {
        dead = false;
        const M2 = fire(cn, t.index, b, M);
        const key = markingKey(M2);
        let to = index.get(key);
        if (to === undefined) {
          if (markings.length >= maxStates) {
            truncated = true;
            continue;
          }
          to = markings.length;
          index.set(key, to);
          markings.push(M2);
        }
        edges.push({ from: i, to, label: t.name + showBinding(b), transitionId: t.id });
      }
    }
    states.push({ id: i, marking: Object.fromEntries(names.map((n) => [n.name, showTokens(cn, M[n.slot])])), dead });
  }
  return { states, edges, truncated, errors: [...errors] };
}
