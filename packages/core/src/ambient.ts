// Structural rules of Konios's Ambient Petri Nets (APN, Def. 3) and Transformed Ambient Petri
// Nets (T-APN, Def. 20) on top of the coloured net model.
//
// How an ambient net is written as a coloured Net:
// - Cl, the structuring set, is the set of declared colour sets. C(p) is the place's colour set.
// - C(t), the colour modes of a transition, is the colour set of its mode variable: the one
//   variable every arc of the transition is inscribed with (conventionally x). A structured
//   transition (t, c) is t under the binding x = c.
// - Pre(t) and Post(t) are sets, so every directed arc has weight 1 per colour: its inscription is
//   the mode variable itself (or 1`x).
// - A colour-sensitive inhibitor arc (p, t) is an inhibitor arc inscribed with the mode variable:
//   (t, c) is blocked while p holds a c token.
// - K, the capacity, is per colour and defaults to 1 (APNs are safe coloured nets).
// - G, the gluing (interface) places, are the places with `gluing: true`.
// T-APNs add the complementary structuring set Cl̄: a colour set declared with `complementOf`
// naming the identity colour set, the bijection f pairing their values in order. An arc whose
// inscription is a variable over a complementary set carries f(c) when its transition fires in mode
// c (Ins(a) ⊆ Cl̄); the guard Gd is the transition's guard. Special colours have capacity 1
// (Def. 21(ix)).

import { ColourSetDecl, Net, isAmbient } from "./model";
import { Expr, Value, parseCached, showValue, valueKey } from "./expr";
import type { CompiledNet, Problem } from "./semantics";

/** Capacity per colour of an ambient place without an explicit capacity (Konios Sec. 3.2). */
export const AMBIENT_DEFAULT_CAPACITY = 1;

/**
 * The variable an ambient arc is inscribed with, or null when the inscription is anything other
 * than a single variable name (optionally written 1`x): arcs of ambient nets have weight 1 per colour.
 */
export function arcVariable(inscription: string): string | null {
  let e: Expr;
  try {
    e = parseCached(inscription.trim());
  } catch {
    return null;
  }
  if (e.k === "id") return e.name;
  if (e.k === "bin" && e.op === "`" && e.l.k === "num" && e.l.v === 1 && e.r.k === "id") return e.r.name;
  return null;
}

/** The complementary colour sets of a T-APN and the bijection f between identity and special colours. */
export interface Complements {
  /** f: identity colour key -> special colour. */
  f: Map<string, Value>;
  /** f⁻¹: special colour key -> identity colour. */
  inverse: Map<string, Value>;
  /** Names of the colour sets declared with complementOf (the sets of Cl̄). */
  specialSets: Set<string>;
  /** Problems with the complementOf declarations. */
  problems: Problem[];
}

/** Read the complementOf declarations of a net, given the colour set domains (from compile). */
export function complementsOf(decls: ColourSetDecl[], domains: Map<string, Value[]>): Complements {
  const f = new Map<string, Value>();
  const inverse = new Map<string, Value>();
  const specialSets = new Set<string>();
  const problems: Problem[] = [];
  for (const cs of decls) {
    if (!cs.complementOf) continue;
    specialSets.add(cs.name);
    const base = domains.get(cs.complementOf);
    const own = domains.get(cs.name) ?? [];
    if (!base) {
      problems.push({ severity: "error", message: `Colour set ${cs.name} is the complement of "${cs.complementOf}", which is not declared` });
      continue;
    }
    if (base.length !== own.length) {
      problems.push({
        severity: "error",
        message: `Colour set ${cs.name} must have as many values as ${cs.complementOf} (${base.length}), so that each colour has one complementary colour; it has ${own.length}`,
      });
      continue;
    }
    base.forEach((v, i) => {
      const k = valueKey(v);
      const prev = f.get(k);
      if (prev !== undefined && valueKey(prev) !== valueKey(own[i]))
        problems.push({ severity: "error", message: `Colour ${showValue(v)} has two complementary colours, ${showValue(prev)} and ${showValue(own[i])}` });
      f.set(k, own[i]);
      inverse.set(valueKey(own[i]), v);
    });
  }
  for (const k of f.keys())
    if (inverse.has(k)) problems.push({ severity: "error", message: `Colour ${k.replace(/^"|"$/g, "")} is both an identity colour and a complementary colour` });
  return { f, inverse, specialSets, problems };
}

/** Capacity of an ambient place for one colour: K(p, c), with special colours of T-APNs at 1. */
export function ambientCapacity(capacity: number | undefined, special: boolean): number {
  if (special) return 1;
  return capacity && capacity > 0 ? capacity : AMBIENT_DEFAULT_CAPACITY;
}

/**
 * Problems specific to APNs and T-APNs, in plain English, each naming the element: arc kinds,
 * arcs that are not weight 1 per colour, transitions without a single mode variable, inhibitor arcs
 * that duplicate a directed arc (Def. 3), complementary colour sets (Def. 20) and guards on APNs.
 * Markings above capacity are reported by compile() itself. Empty for other net classes.
 */
export function ambientProblems(net: Net, cn: CompiledNet): Problem[] {
  if (!isAmbient(net.netClass)) return [];
  const out: Problem[] = [];
  const tapn = net.netClass === "tapn";
  const comp = complementsOf(net.declarations.colourSets, cn.colourSets);
  if (tapn) out.push(...comp.problems);
  else
    for (const s of comp.specialSets)
      out.push({ severity: "warning", message: `Colour set ${s} is declared as a complementary colour set, which only T-APNs use` });
  const varSet = new Map(net.declarations.variables.map((v) => [v.name, v.colourSet]));
  const placeName = new Map(cn.places.map((p) => [p.id, p.name]));
  const kindsOk = tapn ? ["normal"] : ["normal", "inhibitor"];
  const tById = new Map(net.transitions.map((t) => [t.id, t]));

  for (const ct of cn.transitions) {
    const t = tById.get(ct.id)!;
    const arcs = [...ct.inputs, ...ct.outputs];
    const label = (a: (typeof arcs)[number]) =>
      a.arc.source === ct.id ? `Arc ${ct.name} → ${a.place.name}` : `Arc ${a.place.name} → ${ct.name}`;
    if (!arcs.length) {
      out.push({ severity: "error", message: `Transition ${ct.name} has no arcs, so it has no colour mode; connect it with arcs inscribed with its mode variable (e.g. x)`, elementId: ct.id });
      continue;
    }
    const identityVars = new Set<string>();
    const specialVars = new Set<string>();
    for (const a of arcs) {
      if (!kindsOk.includes(a.arc.kind)) {
        out.push({
          severity: "error",
          message: tapn
            ? `${label(a)}: T-APNs have only directed arcs; a ${a.arc.kind} arc is not allowed (replace inhibitor arcs with Construct T-APN)`
            : `${label(a)}: APNs have only directed arcs and colour-sensitive inhibitor arcs; a ${a.arc.kind} arc is not allowed`,
          elementId: a.arc.id,
        });
        continue;
      }
      const v = arcVariable(a.arc.inscription);
      if (!v) {
        out.push({
          severity: "error",
          message: `${label(a)}: arcs of an ambient net carry one token of the transition's mode colour; write the mode variable (e.g. x) instead of "${a.arc.inscription.trim() || "1"}"`,
          elementId: a.arc.id,
        });
        continue;
      }
      const cs = varSet.get(v);
      if (cs === undefined) {
        out.push({ severity: "error", message: `${label(a)}: "${v}" is not a declared variable; declare it over the colour set of the transition's modes`, elementId: a.arc.id });
        continue;
      }
      if (tapn && comp.specialSets.has(cs)) specialVars.add(v);
      else identityVars.add(v);
    }
    if (!tapn && identityVars.size > 1)
      out.push({
        severity: "error",
        message: `Transition ${ct.name}: all its arcs must carry the same mode variable, but they use ${[...identityVars].join(" and ")}`,
        elementId: ct.id,
      });
    if (tapn && identityVars.size > 1)
      out.push({ severity: "error", message: `Transition ${ct.name}: its arcs use the mode variables ${[...identityVars].join(" and ")}; a T-APN transition has one mode`, elementId: ct.id });
    if (tapn && specialVars.size > 1)
      out.push({
        severity: "error",
        message: `Transition ${ct.name}: its arcs use the complementary variables ${[...specialVars].join(" and ")}; use one, which carries f(c) in mode c`,
        elementId: ct.id,
      });
    if (!tapn && t.guard?.trim())
      out.push({
        severity: "warning",
        message: `Transition ${ct.name} has a guard; APNs have none (Konios Def. 3), so it is read as a restriction of the transition's colour modes`,
        elementId: ct.id,
      });

    // Def. 3: (Pre(t)(p) > 0 or Post(t)(p) > 0) implies (p, t) is not an inhibitor arc.
    for (const a of ct.inputs) {
      if (a.arc.kind !== "inhibitor") continue;
      const p = a.place.id;
      const directed = [...ct.inputs, ...ct.outputs].some((b) => b.arc.kind === "normal" && b.place.id === p);
      if (directed)
        out.push({
          severity: "error",
          message: `Place ${placeName.get(p)} has both an inhibitor arc and a directed arc to or from transition ${ct.name}; Konios Def. 3 does not allow both`,
          elementId: a.arc.id,
        });
    }

    // Output tokens must fit the place's colour set (otherwise that mode can never fire).
    const modeVar = [...identityVars][0];
    const modeDomain = modeVar ? cn.colourSets.get(varSet.get(modeVar)!) ?? [] : [];
    for (const a of ct.outputs) {
      if (a.arc.kind !== "normal" || !a.place.domain) continue;
      const v = arcVariable(a.arc.inscription);
      if (!v) continue;
      const keys = new Set(a.place.domain.map(valueKey));
      const special = specialVars.has(v);
      const missing = modeDomain.filter((c) => {
        const colour = special ? comp.f.get(valueKey(c)) : c;
        return colour !== undefined && !keys.has(valueKey(colour));
      });
      if (missing.length)
        out.push({
          severity: "warning",
          message: `Transition ${ct.name} can never fire in mode ${missing.map(showValue).join(", ")}: place ${a.place.name} cannot hold ${special ? "the complementary colour" : "that colour"}`,
          elementId: a.arc.id,
        });
    }
  }
  for (const p of net.places)
    if (p.gluing && p.coarse)
      out.push({ severity: "warning", message: `Coarse place ${p.name} cannot be a gluing place`, elementId: p.id });
  return out;
}
