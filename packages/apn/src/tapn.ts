// The tuples of Konios's Def. 3 (APN) and Def. 20 (T-APN) read from a Net, for display and checks.

import { Net, Value, ambientCapacity, arcVariable, showValue, valueKey } from "@pns/core";
import { AmbientNet, asAmbient, markingPairs, ambientInitialMarking } from "./semantics";

/** N = (P, T, Pre, Post, I, Cl, C, K, M0, G) of Def. 3, by element name. */
export interface ApnTuple {
  P: string[];
  T: string[];
  /** Pre(t) and Post(t) as sets of place names (every directed arc has weight 1). */
  Pre: Record<string, string[]>;
  Post: Record<string, string[]>;
  /** I: the inhibitor arcs (p, t). */
  I: [string, string][];
  /** Cl: the colour sets in use, with their colours. */
  Cl: Record<string, string[]>;
  /** C on places and transitions: the colours each can hold or fire in. */
  C: Record<string, string[]>;
  /** K: capacity per colour of each place. */
  K: Record<string, number>;
  /** M0 as (p, c) pairs. */
  M0: string[];
  G: string[];
}

/** N = (P, T, Pre, Post, Cl, Cl̄, C_P, C_T, Ins, K, Gd, M0, G) of Def. 20, by element name. */
export interface TapnTuple {
  P: string[];
  T: string[];
  Pre: Record<string, string[]>;
  Post: Record<string, string[]>;
  /** ⋃Cl, the identity colours, and ⋃Cl̄, the complementary (special) colours. */
  ClId: string[];
  ClSpec: string[];
  /** The bijection f as (identity, special) pairs. */
  f: [string, string][];
  /** C_P(p) and C_T(t). */
  CP: Record<string, string[]>;
  CT: Record<string, string[]>;
  /** Ins(a) for each arc, keyed "p→t" or "t→p". */
  Ins: Record<string, string[]>;
  /** K: capacity per identity colour of each place (complementary colours have capacity 1). */
  K: Record<string, number>;
  /** T_G: transitions with an input arc carrying complementary colours (the former inhibitor arcs). */
  TG: string[];
  /** T_NG: the other transitions, whose Gd is constantly true. */
  TNG: string[];
  /** B_t for each t ∈ T_G: the binding pairs (c, f(c)) for which Gd((t, c)) holds. */
  B: Record<string, [string, string][]>;
  M0: string[];
  G: string[];
}

function base(an: AmbientNet) {
  const net = an.net;
  const P = an.cn.places.map((p) => p.name);
  const T = an.transitions.map((t) => t.name);
  const pname = new Map(an.cn.places.map((p) => [p.id, p.name]));
  const Pre: Record<string, string[]> = {};
  const Post: Record<string, string[]> = {};
  for (const t of an.transitions) {
    Pre[t.name] = t.pre.map((a) => pname.get(a.placeId)!);
    Post[t.name] = t.post.map((a) => pname.get(a.placeId)!);
  }
  const C: Record<string, string[]> = {};
  for (const p of an.cn.places) C[p.name] = (p.domain ?? []).map(showValue);
  for (const t of an.transitions) C[t.name] = t.modes.map(showValue);
  const G = net.places.filter((p) => p.gluing && !p.coarse).map((p) => p.name);
  const M0 = markingPairs(an, ambientInitialMarking(an));
  return { P, T, Pre, Post, C, G, M0, pname };
}

/** The Def. 3 tuple of an APN. */
export function apnTuple(net: Net | AmbientNet): ApnTuple {
  const an = asAmbient(net);
  const { P, T, Pre, Post, C, G, M0, pname } = base(an);
  const I: [string, string][] = an.transitions.flatMap((t) => t.inhibitors.map((a) => [pname.get(a.placeId)!, t.name] as [string, string]));
  const usedSets = new Set<string>(an.cn.places.map((p) => p.colourSet ?? "Dot"));
  const varSet = new Map(an.net.declarations.variables.map((v) => [v.name, v.colourSet]));
  for (const t of an.transitions) if (t.modeVariable) usedSets.add(varSet.get(t.modeVariable)!);
  const Cl: Record<string, string[]> = {};
  for (const s of usedSets) Cl[s] = (an.cn.colourSets.get(s) ?? []).map(showValue);
  const K: Record<string, number> = {};
  for (const p of an.net.places) if (!p.coarse) K[p.name] = ambientCapacity(p.capacity, false);
  return { P, T, Pre, Post, I, Cl, C, K, M0, G };
}

/** The Def. 20 tuple of a T-APN. */
export function tapnTuple(net: Net | AmbientNet): TapnTuple {
  const an = asAmbient(net);
  const { P, T, Pre, Post, C, G, M0, pname } = base(an);
  const comp = an.complements;
  const f: [string, string][] = [];
  const ClId: string[] = [];
  for (const g of comp.f.values()) {
    const c = comp.inverse.get(valueKey(g)) as Value;
    ClId.push(showValue(c));
    f.push([showValue(c), showValue(g)]);
  }
  const ClSpec = f.map(([, g]) => g);
  const CP: Record<string, string[]> = {};
  for (const p of an.cn.places) CP[p.name] = C[p.name];
  const CT: Record<string, string[]> = {};
  for (const t of an.transitions) CT[t.name] = C[t.name];
  const varSet = new Map(an.net.declarations.variables.map((v) => [v.name, v.colourSet]));
  const Ins: Record<string, string[]> = {};
  const tname = new Map(an.transitions.map((t) => [t.id, t.name]));
  for (const a of an.net.arcs) {
    const v = arcVariable(a.inscription);
    const cs = v ? varSet.get(v) : undefined;
    const from = pname.get(a.source) ?? tname.get(a.source);
    const to = pname.get(a.target) ?? tname.get(a.target);
    if (!from || !to) continue;
    Ins[`${from}→${to}`] = cs ? (an.cn.colourSets.get(cs) ?? []).map(showValue) : [];
  }
  const TG = an.transitions.filter((t) => t.pre.some((a) => a.special)).map((t) => t.name);
  const TNG = T.filter((t) => !TG.includes(t));
  const B: Record<string, [string, string][]> = {};
  for (const t of an.transitions)
    if (TG.includes(t.name)) B[t.name] = t.modes.map((c) => [showValue(c), showValue(comp.f.get(valueKey(c)) ?? "?")]);
  const K: Record<string, number> = {};
  for (const p of an.net.places) if (!p.coarse) K[p.name] = ambientCapacity(p.capacity, false);
  return { P, T, Pre, Post, ClId, ClSpec, f, CP, CT, Ins, K, TG, TNG, B, M0, G };
}
