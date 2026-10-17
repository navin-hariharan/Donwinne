// Composition of Ambient Petri Nets (Konios 2015, Sec. 4.3): forward composition (Def. 8),
// backward composition (Def. 12), and the class checks for root, basic step and one step nets
// (Defs 6, 7, 11), forward composite step nets (Def. 9) and composite step nets (Def. 13).
//
// Readings of the thesis made here (see also the report of each check):
// - Def. 8 writes the third case of Post' as "Post(t)(ps) for t ∈ T and p = g", and Def. 12 the
//   fourth case of Pre' as "Pre(t)(pf) for t ∈ T and p = g2". Read literally both are vacuous (ps and
//   pf are not places of N). Figs 4.9-4.12 show the intended gluing: every arc of N_S at p_s (p_f)
//   is moved to g (g2). That is what is implemented.
// - Def. 8 asks for a basic step net and Def. 12 for a one step net. The two differ only in G_S, and
//   the thesis itself composes N3 of Fig. 4.7 "treated as a one step net" (Sec. 4.3.2.2.1), so either
//   kind is accepted as second operand of either operator.
// - Sec. 4.3.2.1: "once a backward composition has been performed on specific gluing pairs ... no other
//   backward composition can be applied on these gluing pairs". Implemented as: a backward step from
//   g1 to g2 is refused when a step transition from g1 to g2 already exists.
// - Fig. 4.11 composes two forward composite nets "in parallel" before the backward composition. The
//   thesis does not define that operator; parallelCompose is the disjoint union, and the class checks
//   accept several roots only when asked to (option `severalRoots`).

import { Arc, ColourSetDecl, Net, Place, Point, compile } from "@pns/core";
import { ApnStructure, StepRoles, analyseApn, controlPlacesOf, gluingFlag, incidence, resolvePlace, setGluingFlag } from "./model-structure";
import { awayFrom, bendArcs, controlSystemPositions, nodePoints, normalise, placeBackwardStep, placeControlSystem, placeForwardStep } from "./model-layout";

/** Result of a check: yes or no, and why. */
export interface Check {
  ok: boolean;
  reason: string;
}

/** One composition in a derivation of a composite step net. Ids of the places and step transitions. */
export type CompositionStep =
  | { kind: "root"; place: string; control: string }
  | { kind: "forward"; gluing: string; step: string }
  | { kind: "backward"; g1: string; g2: string; step: string };

/** Result of a class check, with a derivation when the net belongs to the class. */
export interface ClassCheck extends Check {
  /** A sequence of compositions that builds the net (for composite step nets). */
  derivation?: CompositionStep[];
}

export class CompositionError extends Error {}

export interface ComposeOptions {
  /** Where the new finishing place goes (forward composition only). Default: chosen automatically. */
  at?: Point;
  /** "auto" (default) places the new step and control system next to the gluing places; "keep" keeps the coordinates of the second net. */
  layout?: "auto" | "keep";
  /** Name of the composed net. */
  name?: string;
  /** Extra points the automatic placement keeps clear, e.g. where later steps will go. */
  avoid?: Point[];
}

const pname = (net: Net, id: string) => net.places.find((p) => p.id === id)?.name ?? net.transitions.find((t) => t.id === id)?.name ?? id;

// ---------------------------------------------------------------------------------------------
// Building blocks as classes

/** Def. 7: is the net a root net (two places, no transitions, G = {p})? */
export function isRootNet(net: Net): Check {
  if (net.transitions.length > 0 || net.arcs.length > 0) return { ok: false, reason: "A root net has no transitions and no arcs (Def. 7)" };
  if (net.places.length !== 2) return { ok: false, reason: `A root net has exactly two places, p and p_c (Def. 7); this net has ${net.places.length}` };
  const s = analyseApn(net);
  if (s.roots.length !== 1) return { ok: false, reason: s.problems[0] ?? "Cannot tell the root place from its control place" };
  if (s.gluingFlagged && (s.gluing.length !== 1 || s.gluing[0] !== s.roots[0].place)) return { ok: false, reason: "The only gluing place of a root net is p (Def. 7: G = {p})" };
  return { ok: true, reason: `Root net with place ${pname(net, s.roots[0].place)} and control place ${pname(net, s.roots[0].control)} (Def. 7)` };
}

function stepBlock(net: Net, kind: "basic" | "one"): Check & { step?: StepRoles } {
  const def = kind === "basic" ? "Def. 6" : "Def. 11";
  const s = analyseApn(net);
  if (s.problems.length) return { ok: false, reason: s.problems[0] };
  if (s.steps.length !== 1 || s.roots.length !== 0) return { ok: false, reason: `A ${kind === "basic" ? "basic" : "one"} step net has exactly one step transition and no root (${def})` };
  if (net.arcs.some((a) => a.kind === "inhibitor")) return { ok: false, reason: `A basic step net has no inhibitor arcs (Def. 6: I_S = ∅)` };
  const st = s.steps[0];
  const marking = markingProblem(net, s, new Set());
  if (marking) return { ok: false, reason: marking };
  if (s.gluingFlagged) {
    const want = kind === "basic" ? [st.start] : [st.start, st.finish];
    const g = new Set(s.gluing);
    if (g.size !== want.length || want.some((p) => !g.has(p)))
      return { ok: false, reason: kind === "basic" ? "The only gluing place of a basic step net is p_s (Def. 6: G_S = {p_s})" : "The gluing places of a one step net are p_s and p_f (Def. 11)" };
  }
  const note = s.gluingFlagged ? "" : " (the net does not record gluing places, so it reads as both a basic and a one step net)";
  return { ok: true, reason: `${kind === "basic" ? "Basic" : "One"} step net with step ${pname(net, st.start)} → ${pname(net, st.transition)} → ${pname(net, st.finish)} and ${st.decisions.length} decision point(s) (${def})${note}`, step: st };
}

/** Def. 6: is the net a basic step net? */
export function isBasicStepNet(net: Net): Check {
  const { ok, reason } = stepBlock(net, "basic");
  return { ok, reason };
}

/** Def. 11: is the net a one step net (a basic step net with G = {p_s, p_f})? */
export function isOneStepNet(net: Net): Check {
  const { ok, reason } = stepBlock(net, "one");
  return { ok, reason };
}

/**
 * Initial marking of a composite step net (Defs 6-8, 12): every database place is marked, and every
 * other place is unmarked except the places of root nets.
 */
function markingProblem(net: Net, s: ApnStructure, rootPlaces: Set<string>): string | null {
  const empty = (id: string) => !(net.places.find((p) => p.id === id)?.marking ?? "").trim();
  for (const st of s.steps) {
    for (const d of st.decisions) if (empty(d.database)) return `Database place ${pname(net, d.database)} must hold at least one user (Def. 6)`;
    for (const id of [st.control, ...st.decisions.map((d) => d.response)]) if (!empty(id)) return `${pname(net, id)} must be unmarked initially (Def. 6)`;
    for (const id of [st.start, st.finish]) if (!rootPlaces.has(id) && !empty(id)) return `Step place ${pname(net, id)} must be unmarked initially; only root places hold the initial users (Defs 6-7)`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Declarations and ids

function sameColourSet(a: ColourSetDecl, b: ColourSetDecl): boolean {
  return JSON.stringify({ ...a, name: "" }) === JSON.stringify({ ...b, name: "" });
}

function mergeDeclarations(a: Net, b: Net): Net["declarations"] {
  const out: Net["declarations"] = {
    ...a.declarations,
    colourSets: [...a.declarations.colourSets],
    variables: [...a.declarations.variables],
    constants: [...a.declarations.constants],
  };
  for (const cs of b.declarations.colourSets) {
    const old = out.colourSets.find((c) => c.name === cs.name);
    if (!old) out.colourSets.push(cs);
    else if (!sameColourSet(old, cs)) throw new CompositionError(`Colour set ${cs.name} is declared differently in the two nets`);
  }
  for (const v of b.declarations.variables) {
    const old = out.variables.find((x) => x.name === v.name);
    if (!old) out.variables.push(v);
    else if (old.colourSet !== v.colourSet) throw new CompositionError(`Variable ${v.name} has colour set ${old.colourSet} in one net and ${v.colourSet} in the other`);
  }
  for (const c of b.declarations.constants) {
    const old = out.constants.find((x) => x.name === c.name);
    if (!old) out.constants.push(c);
    else if (old.value !== c.value) throw new CompositionError(`Constant ${c.name} has different values in the two nets`);
  }
  if (b.declarations.functions?.length) {
    const fs = [...(out.functions ?? [])];
    for (const f of b.declarations.functions) if (!fs.some((x) => x.name === f.name)) fs.push(f);
    out.functions = fs;
  }
  return out;
}

/** A deep copy of `b` whose element and arc ids do not clash with those of `a` (Def. 8 asks for disjoint nets). */
function disjointCopy(a: Net, b: Net): Net {
  const used = new Set([...a.places, ...a.transitions, ...a.arcs].map((x) => x.id));
  const map = new Map<string, string>();
  const fresh = (id: string) => {
    if (!used.has(id) && ![...map.values()].includes(id)) return id;
    let i = 2;
    while (used.has(`${id}_${i}`) || [...map.values()].includes(`${id}_${i}`)) i++;
    return `${id}_${i}`;
  };
  for (const x of [...b.places, ...b.transitions]) map.set(x.id, fresh(x.id));
  const nodes = (id: string) => map.get(id) ?? id;
  const arcIds = new Map<string, string>();
  for (const x of b.arcs) {
    const id = fresh(x.id);
    arcIds.set(x.id, id);
    used.add(id);
  }
  return {
    ...b,
    places: b.places.map((p) => ({ ...p, id: nodes(p.id), parent: p.parent && nodes(p.parent) })),
    transitions: b.transitions.map((t) => ({ ...t, id: nodes(t.id), parent: t.parent && nodes(t.parent) })),
    arcs: b.arcs.map((x) => ({ ...x, id: arcIds.get(x.id)!, source: nodes(x.source), target: nodes(x.target), points: x.points?.map((p) => ({ ...p })) })),
  };
}

function freshArcId(net: Net, base: string): string {
  const used = new Set(net.arcs.map((a) => a.id));
  let i = net.arcs.length + 1;
  while (used.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

function copyNet(net: Net): Net {
  return {
    ...net,
    places: net.places.map((p) => ({ ...p })),
    transitions: net.transitions.map((t) => ({ ...t })),
    arcs: net.arcs.map((a) => ({ ...a, points: a.points?.map((p) => ({ ...p })) })),
    declarations: { ...net.declarations },
  };
}

/** Mode inscription of a step transition: the inscription of the arc from its starting place. */
function modeOf(net: Net, step: string): string {
  const a = net.arcs.find((x) => x.target === step && x.kind === "normal");
  return a?.inscription || net.declarations.variables[0]?.name || "x";
}

function addInhibitor(net: Net, place: string, transition: string): void {
  if (net.arcs.some((a) => a.kind === "inhibitor" && a.source === place && a.target === transition)) return;
  net.arcs.push({ id: freshArcId(net, "inh"), source: place, target: transition, kind: "inhibitor", inscription: modeOf(net, transition) });
}

function sameKind(a: Place, b: Place): string | null {
  if ((a.colourSet ?? "Dot") !== (b.colourSet ?? "Dot")) return `colour sets differ (${a.colourSet} and ${b.colourSet})`;
  if (a.capacity !== b.capacity) return `capacities differ (${a.capacity ?? "unbounded"} and ${b.capacity ?? "unbounded"})`;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Forward composition (Def. 8)

interface Prepared {
  n: Net;
  sN: ApnStructure;
  s: Net;
  st: StepRoles;
}

function prepare(net: Net, step: Net): Prepared {
  const sN = analyseApn(net);
  const block = stepBlock(step, "basic");
  const one = block.ok ? block : stepBlock(step, "one");
  if (!one.ok || !one.step) throw new CompositionError(`The second net must be a basic or one step net: ${one.reason}`);
  return { n: net, sN, s: step, st: one.step };
}

function requireGluing(p: Prepared, ref: string): Place {
  const g = resolvePlace(p.n, ref);
  if (!p.sN.gluing.includes(g.id)) throw new CompositionError(`${g.name} is not a gluing place of ${p.n.name} (Defs 8 and 12 glue on places of G)`);
  // Def. 8: for every t ∈ •g there is a control place cp^t(g) in t•.
  const inc = incidence(p.n);
  const withCp = new Set(controlPlacesOf(p.n, g.id, p.sN).map((c) => c.transition));
  for (const t of inc.preOfPlace.get(g.id)!) if (!withCp.has(t)) throw new CompositionError(`${pname(p.n, t)} puts tokens into ${g.name} but has no control place cp^t(${g.name}) (Def. 8)`);
  return g;
}

/** Can N and N_S be forward composed on the gluing pair (g, p_s)? (Def. 8) */
export function checkForwardComposition(net: Net, gluing: string, step: Net): Check {
  try {
    const p = prepare(net, step);
    const g = requireGluing(p, gluing);
    const diff = sameKind(g, step.places.find((x) => x.id === p.st.start)!);
    if (diff) return { ok: false, reason: `C(g) = C_S(p_s) and K(g) = K_S(p_s) are required (Def. 8), but ${diff}` };
    mergeDeclarations(net, step);
    return { ok: true, reason: `Glue ${g.name} with the starting place of ${pname(step, p.st.transition)}` };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/**
 * Forward composition N ⊕^g N_S of Def. 8. Glues the starting place p_s of the basic step net N_S
 * onto the gluing place g of N, adds a colour-sensitive inhibitor arc (cp^t(g), t_s) for every
 * t ∈ •g in N (including the collapsed transition ε of a root place), and adds p_f to the gluing
 * places: G' = G ∪ {p_f}. The glued place keeps N's colour set, capacity and marking.
 * @param net N, usually a forward composite step net (Def. 9)
 * @param gluing g, as place id or name
 * @param step N_S, a basic step net (Def. 6)
 * @throws CompositionError when the conditions of Def. 8 do not hold
 */
export function forwardCompose(net: Net, gluing: string, step: Net, options: ComposeOptions = {}): Net {
  const check = checkForwardComposition(net, gluing, step);
  if (!check.ok) throw new CompositionError(check.reason);
  const p = prepare(net, step);
  const g = requireGluing(p, gluing);
  const s = disjointCopy(net, step);
  const sS = analyseApn(s);
  const st = sS.steps[0];
  const out = copyNet(net);
  out.name = options.name ?? `${net.name} ⊕${g.name} ${step.name}`;
  out.netClass = "apn";
  out.declarations = mergeDeclarations(net, step);
  const G = new Set(p.sN.gluing);
  const cps = controlPlacesOf(net, g.id, p.sN);
  // P' = P ∪ (P_S \ {p_s}), T' = T ∪ T_S, arcs of N_S at p_s moved to g.
  for (const q of s.places) if (q.id !== st.start) out.places.push({ ...q });
  for (const t of s.transitions) out.transitions.push({ ...t });
  for (const a of s.arcs) out.arcs.push(retarget(a, st.start, g.id));
  // I' = I ∪ {(cp^t(g), t_s) | t ∈ •g in N}
  for (const c of cps) addInhibitor(out, c.control, st.transition);
  // G' = G ∪ {p_f}
  G.add(st.finish);
  for (const q of out.places) setGluingFlag(q, G.has(q.id));
  if ((options.layout ?? "auto") === "auto") {
    layoutForward(out, net, g, st, options.at, options.avoid ?? []);
    bendArcs(out, newArcs(net, out));
  }
  return out;
}

function newArcs(before: Net, after: Net): Set<string> {
  const old = new Set(before.arcs.map((a) => a.id));
  return new Set(after.arcs.filter((a) => !old.has(a.id)).map((a) => a.id));
}

function retarget(a: Arc, from: string, to: string, from2?: string, to2?: string): Arc {
  const m = (id: string) => (id === from ? to : from2 !== undefined && id === from2 ? to2! : id);
  return { ...a, source: m(a.source), target: m(a.target), points: undefined };
}

function layoutForward(out: Net, before: Net, g: Place, st: StepRoles, at: Point | undefined, avoid: Point[]): void {
  const occupied = [...nodePoints(before), ...avoid];
  const n = st.decisions.length;
  const { finish, step } = placeForwardStep({ x: g.x, y: g.y }, n, occupied, at);
  move(out, st.finish, finish);
  move(out, st.transition, step);
  layoutControlSystem(out, st, [...occupied, finish, step]);
}

function layoutControlSystem(out: Net, st: StepRoles, occupied: Point[], preferred?: Point): void {
  const ts = out.transitions.find((t) => t.id === st.transition)!;
  const pf = out.places.find((p) => p.id === st.finish)!;
  const { control, mirror } = placeControlSystem({ x: ts.x, y: ts.y }, { x: pf.x, y: pf.y }, st.decisions.length, occupied, preferred);
  move(out, st.control, control);
  const rows = controlSystemPositions(control, st.decisions.length, mirror);
  st.decisions.forEach((d, i) => {
    move(out, d.response, rows[i].response);
    move(out, d.emptying, rows[i].emptying);
    move(out, d.database, rows[i].database);
    move(out, d.retrieve, rows[i].retrieve);
  });
}

function move(net: Net, id: string, at: Point): void {
  const n = net.places.find((p) => p.id === id) ?? net.transitions.find((t) => t.id === id);
  if (!n) return;
  n.x = Math.round(at.x);
  n.y = Math.round(at.y);
}

// ---------------------------------------------------------------------------------------------
// Backward composition (Def. 12)

function hasStep(s: ApnStructure, from: string, to: string): boolean {
  return s.steps.some((x) => x.start === from && x.finish === to);
}

/** Can N and the one step net N_S be backward composed on the gluing pairs (g1, p_s) and (g2, p_f)? (Def. 12) */
export function checkBackwardComposition(net: Net, g1: string, g2: string, step: Net): Check {
  try {
    const p = prepare(net, step);
    const a = requireGluing(p, g1);
    const b = requireGluing(p, g2);
    const ps = step.places.find((x) => x.id === p.st.start)!;
    const pf = step.places.find((x) => x.id === p.st.finish)!;
    const d1 = sameKind(a, ps);
    if (d1) return { ok: false, reason: `C(g1) = C_S(p_s) and K(g1) = K_S(p_s) are required (Def. 12), but ${d1}` };
    const d2 = sameKind(b, pf);
    if (d2) return { ok: false, reason: `C(g2) = C_S(p_f) and K(g2) = K_S(p_f) are required (Def. 12), but ${d2}` };
    if (hasStep(p.sN, a.id, b.id))
      return { ok: false, reason: `There is already a step from ${a.name} to ${b.name}; no other backward composition can be applied on these gluing pairs (Sec. 4.3.2.1)` };
    mergeDeclarations(net, step);
    return { ok: true, reason: `Glue ${a.name} with p_s and ${b.name} with p_f of ${pname(step, p.st.transition)}` };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/**
 * Backward composition N ⊕^{g1}_{g2} N_S of Def. 12. Glues p_s of the one step net N_S onto g1 and p_f
 * onto g2 (g1 = g2 is allowed and gives a self-loop step), and adds the colour-sensitive inhibitor arcs
 * {(cp^t(g1), t_s) | t ∈ •g1 in N} ∪ {(cp^ts(p_f), t) | t ∈ g2• in N'}. G' = G; g2 gains the control
 * place cp^ts(g2), which was cp^ts(p_f) in N_S.
 * @param net N, usually a composite step net (Def. 13)
 * @param g1 gluing place for p_s, as place id or name
 * @param g2 gluing place for p_f, as place id or name
 * @param step N_S, a one step net (Def. 11); a basic step net is accepted and treated as one
 * @throws CompositionError when the conditions of Def. 12 do not hold
 */
export function backwardCompose(net: Net, g1: string, g2: string, step: Net, options: ComposeOptions = {}): Net {
  const check = checkBackwardComposition(net, g1, g2, step);
  if (!check.ok) throw new CompositionError(check.reason);
  const p = prepare(net, step);
  const a = requireGluing(p, g1);
  const b = requireGluing(p, g2);
  const s = disjointCopy(net, step);
  const st = analyseApn(s).steps[0];
  const out = copyNet(net);
  out.name = options.name ?? `${net.name} ⊕${a.name}/${b.name} ${step.name}`;
  out.netClass = "apn";
  out.declarations = mergeDeclarations(net, step);
  const G = new Set(p.sN.gluing);
  const cps = controlPlacesOf(net, a.id, p.sN);
  // P' = P ∪ (P_S \ {p_s, p_f}), T' = T ∪ T_S, arcs at p_s moved to g1 and at p_f to g2.
  for (const q of s.places) if (q.id !== st.start && q.id !== st.finish) out.places.push({ ...q });
  for (const t of s.transitions) out.transitions.push({ ...t });
  for (const x of s.arcs) out.arcs.push(retarget(x, st.start, a.id, st.finish, b.id));
  // {(cp^t(g1), t_s) | t ∈ •g1 in N}
  for (const c of cps) addInhibitor(out, c.control, st.transition);
  // {(cp^ts(p_f), t) | t ∈ g2• in N'}. When g1 = g2, t_s itself is in g2•, but (cp^ts(p_f), t_s) would
  // join p_c to t_s by an inhibitor arc and by the arc t_s → p_c, which Def. 3 forbids
  // ((Pre(t)(p) > 0 ∨ Post(t)(p) > 0) ⇒ (p, t) ∉ I). That one arc is left out so the result is an APN.
  const after = incidence(out);
  for (const t of after.postOfPlace.get(b.id)!) if (t !== st.transition) addInhibitor(out, st.control, t);
  // G' = G
  for (const q of out.places) setGluingFlag(q, G.has(q.id));
  if ((options.layout ?? "auto") === "auto") {
    const occupied = [...nodePoints(net), ...(options.avoid ?? [])];
    const ts = placeBackwardStep({ x: a.x, y: a.y }, { x: b.x, y: b.y }, occupied);
    move(out, st.transition, ts);
    layoutControlSystem(out, { ...st, finish: b.id }, [...occupied, ts], awayFrom(ts, nodePoints(net)));
    bendArcs(out, newArcs(net, out));
  }
  return out;
}

/**
 * Disjoint union of two APNs, drawn side by side. The thesis uses it without a name in Sec. 4.3.2.2.2,
 * where N "consists of two parallel forward composite step nets (N6 and N7)" (Fig. 4.11). G is the
 * union of both gluing sets. Ids of the second net are renamed where they clash.
 */
export function parallelCompose(a: Net, b: Net, options: { name?: string; gap?: number } = {}): Net {
  const sa = analyseApn(a);
  const sb = analyseApn(b);
  const c = disjointCopy(a, b);
  const out = copyNet(a);
  out.name = options.name ?? `${a.name} ∥ ${b.name}`;
  out.netClass = "apn";
  out.declarations = mergeDeclarations(a, b);
  const right = a.places.length + a.transitions.length ? Math.max(...[...a.places, ...a.transitions].map((n) => n.x)) : 0;
  const left = c.places.length + c.transitions.length ? Math.min(...[...c.places, ...c.transitions].map((n) => n.x)) : 0;
  const dx = right - left + (options.gap ?? 160);
  const G = new Set(sa.gluing);
  const idOf = new Map(b.places.map((p, i) => [p.id, c.places[i].id]));
  for (const g of sb.gluing) G.add(idOf.get(g)!);
  for (const p of c.places) out.places.push({ ...p, x: p.x + dx });
  for (const t of c.transitions) out.transitions.push({ ...t, x: t.x + dx });
  for (const x of c.arcs) out.arcs.push({ ...x, points: x.points?.map((q) => ({ x: q.x + dx, y: q.y })) });
  for (const q of out.places) setGluingFlag(q, G.has(q.id));
  return out;
}

/** Move the whole drawing so that it starts near the top left corner. Returns the same net. */
export function tidy(net: Net): Net {
  normalise(net);
  return net;
}

// ---------------------------------------------------------------------------------------------
// Composite step nets (Defs 9 and 13)

export interface CompositeCheckOptions {
  /** Accept several root nets composed in parallel, as the N-graph of Fig. 4.11 does. Default false (Defs 9 and 13 start from one root net). */
  severalRoots?: boolean;
  /** Check the initial marking that the compositions produce (Defs 6-8, 12). Default true. */
  marking?: boolean;
}

/**
 * The colour-sensitive inhibitor arcs that Defs 8 and 12 produce for a composite step net:
 * (cp^t(x), u) for every step place x, every t ∈ •x (with ε for a root place) and every step
 * transition u ∈ x• other than t. Every composition order gives this same set: a forward step t creates x, so later
 * u from x get the arc from Def. 8; a backward step t gets it from the second set of Def. 12 for the
 * u that already exist, and the u added later get it from Defs 8 and 12 (first set).
 */
export function expectedInhibitors(net: Net, s: ApnStructure = analyseApn(net)): { place: string; transition: string }[] {
  const out: { place: string; transition: string }[] = [];
  for (const x of s.stepPlaces) {
    const cps = controlPlacesOf(net, x, s);
    // A step's own control place never inhibits it (Def. 3; see backwardCompose with g1 = g2).
    for (const u of s.steps) if (u.start === x) for (const c of cps) if (c.transition !== u.transition) out.push({ place: c.control, transition: u.transition });
  }
  return out;
}

/** Def. 13: is the net a composite step net (built from a root net by forward and backward compositions)? */
export function isCompositeStepNet(net: Net, options: CompositeCheckOptions = {}): ClassCheck {
  return composite(net, options, false);
}

/** Def. 9: is the net a forward composite step net (built from a root net by forward compositions only)? */
export function isForwardCompositeStepNet(net: Net, options: CompositeCheckOptions = {}): ClassCheck {
  return composite(net, options, true);
}

function composite(net: Net, options: CompositeCheckOptions, forwardOnly: boolean): ClassCheck {
  const def = forwardOnly ? "Def. 9" : "Def. 13";
  const errors = compile(net).problems.filter((p) => p.severity === "error");
  if (errors.length) return { ok: false, reason: `The net has errors: ${errors[0].message}` };
  const s = analyseApn(net);
  if (s.problems.length) return { ok: false, reason: s.problems[0] };
  if (s.roots.length === 0) return { ok: false, reason: `A composite step net starts from a root net (${def}); this net has none` };
  if (s.roots.length > 1 && !options.severalRoots)
    return { ok: false, reason: `The net has ${s.roots.length} root nets; ${def} builds from one root net (nets composed in parallel, as in Fig. 4.11, need the option severalRoots)` };
  const roots = new Set(s.roots.map((r) => r.place));
  // Each ordered pair of step places is joined by at most one step (Sec. 4.3.2.1).
  const seen = new Set<string>();
  for (const st of s.steps) {
    const k = `${st.start}→${st.finish}`;
    if (seen.has(k)) return { ok: false, reason: `Two steps go from ${pname(net, st.start)} to ${pname(net, st.finish)}; a backward composition cannot be repeated on the same gluing pairs (Sec. 4.3.2.1)` };
    seen.add(k);
  }
  // A derivation: breadth-first from the roots; the first step into each place is a forward composition
  // (it creates the place), every other step is a backward composition done once both places exist.
  const derivation: CompositionStep[] = s.roots.map((r) => ({ kind: "root" as const, place: r.place, control: r.control }));
  const created = new Set(roots);
  const queue = [...roots];
  const forward = new Set<string>();
  while (queue.length) {
    const x = queue.shift()!;
    for (const st of s.steps)
      if (st.start === x && !created.has(st.finish)) {
        created.add(st.finish);
        forward.add(st.transition);
        derivation.push({ kind: "forward", gluing: x, step: st.transition });
        queue.push(st.finish);
      }
  }
  const unreached = s.stepPlaces.filter((p) => !created.has(p));
  if (unreached.length) return { ok: false, reason: `Step place ${pname(net, unreached[0])} cannot be reached from a root place, so no composition creates it (${def})` };
  for (const st of s.steps) if (!forward.has(st.transition)) derivation.push({ kind: "backward", g1: st.start, g2: st.finish, step: st.transition });
  if (forwardOnly) {
    const back = s.steps.find((st) => !forward.has(st.transition));
    if (back)
      return {
        ok: false,
        reason: `Step ${pname(net, back.transition)} goes from ${pname(net, back.start)} back to the existing place ${pname(net, back.finish)}; forward composition only produces directed trees (Sec. 4.3.1.1), so this needs a backward composition (Def. 12)`,
      };
  }
  // Colour-sensitive inhibitor arcs: exactly those of Defs 8 and 12.
  const want = expectedInhibitors(net, s);
  const key = (p: string, t: string) => `${p}|${t}`;
  const have = new Map(net.arcs.filter((a) => a.kind === "inhibitor").map((a) => [key(a.source, a.target), a]));
  for (const w of want) {
    const a = have.get(key(w.place, w.transition));
    if (!a) return { ok: false, reason: `Missing colour-sensitive inhibitor arc from ${pname(net, w.place)} to ${pname(net, w.transition)} (${forwardOnly ? "Def. 8" : "Defs 8 and 12"})` };
    if (a.inscription.trim() !== modeOf(net, w.transition).trim())
      return { ok: false, reason: `The inhibitor arc from ${pname(net, w.place)} to ${pname(net, w.transition)} must be colour-sensitive, inscribed with the mode ${modeOf(net, w.transition)}` };
    have.delete(key(w.place, w.transition));
  }
  if (have.size) {
    const a = [...have.values()][0];
    return { ok: false, reason: `The inhibitor arc from ${pname(net, a.source)} to ${pname(net, a.target)} is not produced by any composition (${def})` };
  }
  if (s.gluingFlagged) {
    const g = new Set(s.gluing);
    const extra = s.gluing.find((p) => !s.stepPlaces.includes(p));
    const missing = s.stepPlaces.find((p) => !g.has(p));
    if (extra || missing)
      return { ok: false, reason: `The gluing places must be the root places and the finishing places of forward steps (Defs 7, 8, 12): ${pname(net, (extra ?? missing)!)} ${extra ? "should not be" : "should be"} a gluing place` };
  }
  if (options.marking ?? true) {
    const m = markingProblem(net, s, roots);
    if (m) return { ok: false, reason: m };
  }
  const nb = s.steps.length - forward.size;
  return {
    ok: true,
    reason: `${forwardOnly ? "Forward composite" : "Composite"} step net: ${s.roots.length} root net(s), ${forward.size} forward and ${nb} backward composition(s) (${def})`,
    derivation,
  };
}

/** The gluing places G of a net, as place ids (flags when recorded, otherwise the step places). */
export function gluingPlaces(net: Net): string[] {
  return analyseApn(net).gluing;
}

/** True when the place carries the gluing flag. */
export function isGluing(p: Place): boolean {
  return gluingFlag(p) === true;
}
