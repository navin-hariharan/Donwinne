// Net transformations of the classic textbook definitions (A. Halder, "A Study of Petri Nets",
// 2006, §4.2.12 and §4.3.3; Peterson 1981): the reversed (inverse) net and the dual net.

import type { Arc, Net, Place, Transition } from "./model";

const reversedPoints = (a: Arc) => (a.points ? [...a.points].reverse() : undefined);

/**
 * The reversed (inverse) net N⁻¹ = (P, T, I⁻¹, O⁻¹) with I⁻¹ = O and O⁻¹ = I: every arc points the
 * other way, places, transitions and the marking stay. Read arcs, which only test a place, stay as
 * they are. Throws for inhibitor, reset, equal and modifier arcs: they always go from a place to a
 * transition and have no reverse.
 */
export function reverseNet(net: Net): Net {
  const bad = net.arcs.find((a) => a.kind !== "normal" && a.kind !== "read");
  if (bad) throw new Error(`The net has ${/^[aeiou]/.test(bad.kind) ? "an" : "a"} ${bad.kind} arc, which cannot be reversed (only normal and read arcs can)`);
  const arcs = net.arcs.map((a) => (a.kind === "read" ? a : { ...a, source: a.target, target: a.source, points: reversedPoints(a) }));
  return { ...net, name: `${net.name} (reversed)`, arcs };
}

/**
 * The dual net N^ = (P^, T^, I^, O^) with P^ = T, T^ = P, I^ = O and O^ = I: places become
 * transitions and transitions places, and every arc points the other way. "The dual of an unmarked
 * PN is also an unmarked PN": the dual has no marking. Only for place/transition nets with normal
 * arcs of constant weight and no subnets or logical places, where the definition applies.
 */
export function dualNet(net: Net): Net {
  if (net.netClass !== "pt" && net.netClass !== "xpt") throw new Error("The dual is defined for place/transition nets only");
  const bad = net.arcs.find((a) => a.kind !== "normal");
  if (bad) throw new Error(`The dual is defined for normal arcs only, and the net has ${/^[aeiou]/.test(bad.kind) ? "an" : "a"} ${bad.kind} arc`);
  const weighted = net.arcs.find((a) => !/^\s*\d*\s*$/.test(a.inscription));
  if (weighted) throw new Error(`The dual needs constant arc weights, and an arc has the weight "${weighted.inscription}"`);
  if (net.places.some((p) => p.coarse) || net.transitions.some((t) => t.coarse)) throw new Error("Flatten the subnets first: the dual of a net with subnets is not defined");
  if (net.places.some((p) => p.logical)) throw new Error("The dual of a net with logical places is not defined: make them ordinary places first");
  const places: Place[] = net.transitions.map((t) => ({ id: t.id, name: t.name, x: t.x, y: t.y, marking: "", ...(t.parent ? { parent: t.parent } : {}) }));
  const transitions: Transition[] = net.places.map((p) => ({ id: p.id, name: p.name, x: p.x, y: p.y, ...(p.parent ? { parent: p.parent } : {}) }));
  const arcs = net.arcs.map((a) => ({ ...a, source: a.target, target: a.source, points: reversedPoints(a) }));
  return { ...net, netClass: "pt", name: `${net.name} (dual)`, places, transitions, arcs };
}
