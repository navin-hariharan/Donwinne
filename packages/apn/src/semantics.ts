// Structured places and transitions of APNs (Konios Def. 3, Sec. 3.3) and T-APNs (Def. 20,
// Sec. 5.2), compiled from a coloured Net.
//
// A structured transition (t, c) has the extended pre and post mappings
//   APN   (*), (**):  Pre~(t,c)(p,g) = Pre(t)(p) if g = c, else 0                (same for Post~)
//   T-APN (†), (††):  Pre^(t,c)(p,g) = Pre(t)(p) if (g = c or g = f(c)) and g ∈ Ins((p,t)), else 0
// In the Net, Ins((p,t)) is the colour set of the variable inscribed on the arc: the mode variable
// (identity colours, so g = c) or a variable over a complementary colour set (g = f(c)).

import {
  Binding,
  CompiledNet,
  Complements,
  Marking,
  Multiset,
  Net,
  Problem,
  Value,
  ambientCapacity,
  ambientProblems,
  arcVariable,
  bool,
  compile,
  complementsOf,
  envFor,
  evaluate,
  initialMarking,
  identifiers,
  isAmbient,
  parseCached,
  showValue,
  valueKey,
} from "@pns/core";

/** One directed arc of a structured transition: the slot it touches and the colour it carries in mode c. */
export interface AmbientArc {
  arcId: string;
  placeId: string;
  /** Index into the marking (places that share a logical name share a slot). */
  slot: number;
  /** T-APN: the arc carries the complementary colour f(c) (Ins(a) ⊆ Cl̄). */
  special: boolean;
}

/** A transition of an ambient net with its colour modes C(t), already filtered by its guard Gd. */
export interface AmbientTransition {
  id: string;
  name: string;
  /** Index in CompiledNet.transitions. */
  index: number;
  /** The variable whose value is the colour mode c, if the arcs use one. */
  modeVariable?: string;
  /** T-APN: the variable bound to f(c), if any arc uses one. */
  specialVariable?: string;
  /** C(t) (APN) or C_T(t) (T-APN), restricted to the modes whose guard holds, in colour set order. */
  modes: Value[];
  pre: AmbientArc[];
  post: AmbientArc[];
  /** APN: colour-sensitive inhibitor arcs (p, t). */
  inhibitors: AmbientArc[];
}

/**
 * An APN or T-APN ready for the step semantics. Build it once with compileAmbient and pass it to
 * the step, CRG and equivalence functions; they also accept a Net and cache its compilation.
 */
export interface AmbientNet {
  net: Net;
  kind: "apn" | "tapn";
  cn: CompiledNet;
  transitions: AmbientTransition[];
  /** T-APN: f, f⁻¹ and the complementary colour sets. Empty for APNs. */
  complements: Complements;
  /**
   * Capacity of (slot, colour): K(p, c), the smallest over places sharing the slot. Colours outside
   * the place's colour set have capacity 0, since (p, c) is not a structured place.
   */
  capacity(slot: number, colour: Value): number;
  /** Errors and warnings: compile problems plus anything that prevents the step semantics. */
  problems: Problem[];
  /** True if some structured transition consumes and produces the same structured place (a self-loop). */
  hasSelfLoop: boolean;
}

/** A structured transition (t, c): transition id and colour mode. */
export interface StructuredTransition {
  transition: string;
  colour: Value;
}

const cache = new WeakMap<Net, AmbientNet>();

/**
 * Compile (with caching per Net object) or pass through an already compiled ambient net. Nets are
 * treated as immutable, as the editor treats them: an edited net must be a new object.
 */
export function asAmbient(net: Net | AmbientNet): AmbientNet {
  if ("cn" in net && "transitions" in net && "kind" in net) return net as AmbientNet;
  const n = net as Net;
  let a = cache.get(n);
  if (!a) {
    a = compileAmbient(n);
    cache.set(n, a);
  }
  return a;
}

/**
 * Compile an APN or T-APN (net class "apn" or "tapn") for the step semantics. Other coloured classes
 * are accepted and read as APNs when they follow the same conventions (one mode variable per
 * transition, arcs inscribed with it), which lets coloured nets written before the APN class existed
 * be analysed too. Problems are collected, not thrown.
 */
export function compileAmbient(net: Net): AmbientNet {
  const cn = compile(net);
  const problems: Problem[] = [...cn.problems];
  const kind: "apn" | "tapn" = net.netClass === "tapn" ? "tapn" : "apn";
  if (!cn.coloured) problems.push({ severity: "error", message: "Ambient nets are coloured nets; switch the net class to APN or T-APN" });
  else if (!isAmbient(net.netClass)) {
    problems.push({ severity: "warning", message: `This is a ${net.netClass} net; it is read as an APN (Konios Def. 3)` });
    problems.push(...ambientProblems({ ...net, netClass: "apn" }, cn));
  }
  const complements = kind === "tapn" ? complementsOf(net.declarations.colourSets, cn.colourSets) : complementsOf([], cn.colourSets);
  const varSet = new Map(net.declarations.variables.map((v) => [v.name, v.colourSet]));

  const transitions: AmbientTransition[] = [];
  let hasSelfLoop = false;
  for (const ct of cn.transitions) {
    const at: AmbientTransition = { id: ct.id, name: ct.name, index: ct.index, modes: [], pre: [], post: [], inhibitors: [] };
    const toArc = (a: (typeof ct.inputs)[number]): AmbientArc | null => {
      const v = arcVariable(a.arc.inscription);
      if (!v || !varSet.has(v)) return null;
      const special = kind === "tapn" && complements.specialSets.has(varSet.get(v)!);
      if (special) at.specialVariable ??= v;
      else at.modeVariable ??= v;
      return { arcId: a.arc.id, placeId: a.place.id, slot: a.place.slot, special };
    };
    for (const a of ct.inputs) {
      if (a.arc.kind !== "normal" && a.arc.kind !== "inhibitor") continue;
      const x = toArc(a);
      if (!x) continue;
      (a.arc.kind === "inhibitor" ? at.inhibitors : at.pre).push(x);
    }
    for (const a of ct.outputs) {
      const x = toArc(a);
      if (x) at.post.push(x);
    }
    // Variables that appear only in the guard: Gd((t, c)) still binds them to c or f(c).
    if (ct.guard)
      for (const v of identifiers(ct.guard)) {
        const cs = varSet.get(v);
        if (cs === undefined) continue;
        if (kind === "tapn" && complements.specialSets.has(cs)) at.specialVariable ??= v;
        else at.modeVariable ??= v;
      }
    // C(t): the mode variable's colour set; without one (T-APN arcs that carry only f(c)), f⁻¹ of the complementary set.
    let modes: Value[] = [];
    if (at.modeVariable) modes = cn.colourSets.get(varSet.get(at.modeVariable)!) ?? [];
    else if (at.specialVariable)
      modes = (cn.colourSets.get(varSet.get(at.specialVariable)!) ?? []).map((g) => complements.inverse.get(valueKey(g))).filter((c): c is Value => c !== undefined);
    // Gd((t, c)) / guard restriction of C(t).
    const guard = ct.guard;
    if (guard) {
      modes = modes.filter((c) => {
        try {
          return bool(evaluate(guard, envFor(cn, bindingFor(at, complements, c))));
        } catch (e) {
          problems.push({ severity: "error", message: `Guard of ${ct.name} in mode ${showValue(c)}: ${(e as Error).message}`, elementId: ct.id });
          return false;
        }
      });
    }
    at.modes = modes;
    // Self-loop at the level of structured places: the same (p, g) both consumed and produced.
    for (const a of at.pre) if (at.post.some((b) => b.slot === a.slot && b.special === a.special)) hasSelfLoop = true;
    transitions.push(at);
  }

  const capCache = new Map<string, number>();
  const capacity = (slot: number, colour: Value): number => {
    const key = `${slot}|${valueKey(colour)}`;
    let k = capCache.get(key);
    if (k === undefined) {
      const special = complements.inverse.has(valueKey(colour));
      k = Infinity;
      for (const p of cn.slotPlaces[slot]) {
        const inSet = !p.domain || p.domain.some((v) => valueKey(v) === valueKey(colour));
        const src = net.places.find((x) => x.id === p.id);
        k = Math.min(k, inSet ? ambientCapacity(src?.capacity, special) : 0);
      }
      if (k === Infinity) k = 0;
      capCache.set(key, k);
    }
    return k;
  };
  return { net, kind, cn, transitions, complements, capacity, problems, hasSelfLoop };
}

/** The binding of a structured transition (t, c): mode variable = c, complementary variable = f(c). */
export function bindingFor(t: AmbientTransition, complements: Complements, colour: Value): Binding {
  const b: Binding = {};
  if (t.modeVariable) b[t.modeVariable] = colour;
  if (t.specialVariable) {
    const g = complements.f.get(valueKey(colour));
    if (g !== undefined) b[t.specialVariable] = g;
  }
  return b;
}

/** The colour an arc of (t, c) carries: c, or f(c) for T-APN arcs inscribed over Cl̄ (Def. 20, (†)). */
export function arcColour(an: AmbientNet, a: AmbientArc, colour: Value): Value | undefined {
  return a.special ? an.complements.f.get(valueKey(colour)) : colour;
}

/** The initial marking M0 of an ambient net, as core markings (one multiset per slot). */
export function ambientInitialMarking(net: Net | AmbientNet): Marking {
  return initialMarking(asAmbient(net).cn);
}

/** Errors that stop the step semantics (from compile and the ambient checks). */
export function ambientErrors(net: Net | AmbientNet): Problem[] {
  return asAmbient(net).problems.filter((p) => p.severity === "error");
}

/**
 * A marking as a record from place name to its tokens in canonical multiset form, e.g.
 * { p1: "b++w", p2: "" }. Places that share a logical slot appear once.
 */
export function markingRecord(net: Net | AmbientNet, M: Marking): Record<string, string> {
  const an = asAmbient(net);
  const out: Record<string, string> = {};
  for (const p of an.cn.places) if (!(p.name in out)) out[p.name] = M[p.slot]?.toString() ?? "";
  return out;
}

/**
 * The set of structured places held by a marking, as "(p, c)" pairs in the thesis's notation, e.g.
 * ["(p1,b)", "(p4,b)"]. Multiplicities above 1 repeat the pair.
 */
export function markingPairs(net: Net | AmbientNet, M: Marking): string[] {
  const an = asAmbient(net);
  const out: string[] = [];
  const seen = new Set<number>();
  for (const p of an.cn.places) {
    if (seen.has(p.slot)) continue;
    seen.add(p.slot);
    for (const [c, n] of M[p.slot].entries()) for (let i = 0; i < n; i++) out.push(`(${p.name},${showValue(c)})`);
  }
  return out.sort(naturalCompare);
}

/** Build a marking from "(p, c)" pairs or a { place name: multiset text } record. Unknown places throw. */
export function markingFrom(net: Net | AmbientNet, tokens: Record<string, string> | string[]): Marking {
  const an = asAmbient(net);
  const M: Marking = Array.from({ length: an.cn.slotCount }, () => new Multiset());
  const slotOf = (name: string) => {
    const p = an.cn.places.find((x) => x.name === name);
    if (!p) throw new Error(`No place named ${name}`);
    return p;
  };
  const parseColour = (src: string): Value => evaluate(parseCached(src), envFor(an.cn, {}));
  if (Array.isArray(tokens)) {
    for (const pair of tokens) {
      const m = /^\(\s*([^,]+?)\s*,\s*(.+?)\s*\)$/.exec(pair.trim());
      if (!m) throw new Error(`"${pair}" is not a (place, colour) pair`);
      const p = slotOf(m[1]);
      M[p.slot] = M[p.slot].plus(Multiset.of(parseColour(m[2])));
    }
  } else {
    for (const [name, text] of Object.entries(tokens)) {
      const p = slotOf(name);
      if (!text.trim()) continue;
      const v = parseColour(text);
      M[p.slot] = v instanceof Multiset ? v : Multiset.of(v);
    }
  }
  return M;
}

/** Compare strings with embedded numbers in numeric order (p2 < p10). */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}
