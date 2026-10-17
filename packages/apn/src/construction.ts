// The construction φ: APN → T-APN of Konios (2015), Sec. 6.2 (Def. 21), worked out in Sec. 6.3-6.4.
//
// φ(N) keeps the places, transitions, directed arcs, colour sets and gluing places of a composite
// step net N and removes its colour-sensitive inhibitor arcs:
//   (iii) each inhibitor arc (p, t) becomes a directed arc (Pre_REP) carrying the complementary
//         colour f(c); new post arcs carrying f(c) (Post_NEW) go from every emptying transition back
//         to the inhibitor control place it empties, and from every step transition t to the
//         control places cp^t̂(p_t) of the other steps t̂ into its finishing place p_t (including
//         cp^ε(p^0) of the root net when p_t is the starting place);
//   (v)   Cl̄, the complementary colours, with the bijection f;
//   (vi)  control places hold C(p) ∪ f(C(p)), the others C(p);
//   (viii) the new and replacing arcs carry Cl̄, all others Cl;
//   (ix)  capacities are kept for identity colours and are 1 for complementary colours;
//   (x)   step transitions (those with inhibitor places, T_G) get the guard B_t = {(x, f(x))};
//   (xi)  the control places of marked step places get the complementary tokens f(c) of the users
//         c that may proceed.
// Places and transitions keep their ids, names and positions, so φ(N) draws like N (Figs 6.2, 6.4).

import { Arc, ColourSetDecl, Multiset, Net, Place, Problem, Transition, Value, VariableDecl, isAmbient, showValue, valueKey } from "@pns/core";
import { ambientInitialMarking, compileAmbient } from "./semantics";

/** The parts of a composite step net (Sec. 6.2.1), by element id. */
export interface StepNetRoles {
  /** P_R: response places. */
  response: string[];
  /** P_D: database places. */
  database: string[];
  /** P_C: control places (including the root control places cp^ε(p^0)). */
  control: string[];
  /** P_SF: the step places (starting and finishing places of steps). */
  stepPlaces: string[];
  /** P_I: places with a colour-sensitive inhibitor arc (eq. ⋆⋆). */
  inhibitorPlaces: string[];
  /** T_R: retrieve transitions. */
  retrieve: string[];
  /** T_EM: emptying transitions. */
  emptying: string[];
  /** T_STEP \ {ε}: step transitions. */
  step: string[];
  /** For each step transition t, its finishing place p_t. */
  finishingOf: Record<string, string>;
  /** For each step transition t, its control place cp^t(p_t). */
  controlOf: Record<string, string>;
  /** For each root control place p_c^0 = cp^ε(p^0), the starting place p^0 it controls. */
  rootOf: Record<string, string>;
  /** Elements that do not fit the structure of a composite step net, in plain English. */
  problems: string[];
}

/**
 * Read the parts of a composite step net from its structure (Defs 6, 7, 8, 12): step transitions
 * are the transitions with inhibitor places (T_STEP = T_G, Sec. 6.2.2 (x)); of the two output places
 * of a step transition, the control place is the one that is a gluing place's opposite: it is not
 * flagged gluing and it feeds emptying transitions; the other is the finishing place p_t. Emptying
 * transitions read a control place, retrieve transitions are the rest. A root control place is an
 * inhibitor place no step transition produces into.
 */
export function classifyStepNet(net: Net): StepNetRoles {
  const nodes = net.places.filter((p) => !p.coarse);
  const trans = net.transitions.filter((t) => !t.coarse);
  const placeIds = new Set(nodes.map((p) => p.id));
  const tIds = new Set(trans.map((t) => t.id));
  const name = new Map<string, string>([...nodes, ...trans].map((n) => [n.id, n.name]));
  const arcs = net.arcs.filter((a) => (placeIds.has(a.source) && tIds.has(a.target)) || (tIds.has(a.source) && placeIds.has(a.target)));
  const pre = (t: string) => arcs.filter((a) => a.target === t && a.kind === "normal").map((a) => a.source);
  const post = (t: string) => arcs.filter((a) => a.source === t && a.kind === "normal").map((a) => a.target);
  const inhib = arcs.filter((a) => a.kind === "inhibitor");
  const flagged = nodes.some((p) => p.gluing);
  const gluing = new Set(nodes.filter((p) => p.gluing).map((p) => p.id));
  const problems: string[] = [];

  const step = trans.filter((t) => inhib.some((a) => a.target === t.id)).map((t) => t.id);
  const stepSet = new Set(step);
  const feedsOther = (p: string) => arcs.some((a) => a.source === p && a.kind === "normal" && !stepSet.has(a.target));
  const finishingOf: Record<string, string> = {};
  const controlOf: Record<string, string> = {};
  for (const t of step) {
    const outs = [...new Set(post(t))];
    let ctrl = outs.filter((p) => (flagged ? !gluing.has(p) : true) && feedsOther(p));
    let fin = outs.filter((p) => !ctrl.includes(p));
    if (ctrl.length !== 1 && flagged) {
      ctrl = outs.filter((p) => !gluing.has(p));
      fin = outs.filter((p) => gluing.has(p));
    }
    if (ctrl.length === 1 && fin.length === 1) {
      controlOf[t] = ctrl[0];
      finishingOf[t] = fin[0];
    } else
      problems.push(
        `Step transition ${name.get(t)} should produce into exactly one finishing place and one control place, but its output places are ${outs.map((p) => name.get(p)).join(", ") || "none"}`,
      );
  }
  const stepControls = new Set(Object.values(controlOf));
  const inhibitorPlaces = [...new Set(inhib.map((a) => a.source))];
  const producedByStep = new Set(step.flatMap(post));
  const rootControls = inhibitorPlaces.filter((p) => !stepControls.has(p) && !producedByStep.has(p) && !arcs.some((a) => a.target === p));
  const rootOf: Record<string, string> = {};
  for (const rc of rootControls) {
    const starts = [...new Set(inhib.filter((a) => a.source === rc).flatMap((a) => pre(a.target)))];
    if (starts.length === 1) rootOf[rc] = starts[0];
    else problems.push(`Root control place ${name.get(rc)} should control the steps leaving one starting place, but they leave ${starts.map((p) => name.get(p)).join(", ") || "no place"}`);
  }
  for (const p of inhibitorPlaces)
    if (!stepControls.has(p) && !rootControls.includes(p)) problems.push(`Inhibitor place ${name.get(p)} is neither the control place of a step nor a root control place`);
  const control = [...new Set([...stepControls, ...rootControls])];
  const controlSet = new Set(control);
  const emptying = trans.filter((t) => !stepSet.has(t.id) && pre(t.id).some((p) => controlSet.has(p))).map((t) => t.id);
  const emptySet = new Set(emptying);
  const retrieve = trans.filter((t) => !stepSet.has(t.id) && !emptySet.has(t.id)).map((t) => t.id);
  const database = [...new Set(emptying.flatMap(pre).filter((p) => !controlSet.has(p)))];
  const response = [...new Set(emptying.flatMap(post).filter((p) => !controlSet.has(p)))];
  const stepPlaces = [...new Set([...step.flatMap(pre), ...Object.values(finishingOf), ...Object.values(rootOf)])];
  const roleCount = new Map<string, number>();
  for (const p of [...control, ...database, ...response, ...stepPlaces]) roleCount.set(p, (roleCount.get(p) ?? 0) + 1);
  for (const p of nodes) {
    const n = roleCount.get(p.id) ?? 0;
    if (n === 0) problems.push(`Place ${p.name} is not a step, control, database or response place of a composite step net`);
    else if (n > 1) problems.push(`Place ${p.name} has more than one role (step, control, database, response) in the composite step net`);
  }
  for (const t of emptying) if (post(t).some((p) => stepPlaces.includes(p))) problems.push(`Emptying transition ${name.get(t)} should produce into response places only`);
  for (const t of retrieve) {
    if (!pre(t).every((p) => response.includes(p)))
      problems.push(`Transition ${name.get(t)} is neither a step, an emptying nor a retrieve transition (a retrieve transition takes from response places)`);
  }
  return { response, database, control, stepPlaces, inhibitorPlaces, retrieve, emptying, step, finishingOf, controlOf, rootOf, problems };
}

/** Where an arc of φ(N) comes from. */
export interface ArcOrigin {
  /** The arc of N it copies or replaces; absent for new arcs. */
  from?: string;
  /**
   * copied: a directed arc of N (Pre_DIR or Post_ALL); replacedInhibitor: Pre_REP, the directed arc
   * that replaces an inhibitor arc; emptying / step: Post_NEW arcs from an emptying transition back
   * to its control place, or from a step transition to the control place of another step into the
   * same place (or of the root net).
   */
  origin: "copied" | "replacedInhibitor" | "emptying" | "step";
}

/** How φ(N)'s elements relate to N's. */
export interface ConstructionMapping {
  /** φ(N) place id -> N place id (P' = P: the same ids). */
  places: Record<string, string>;
  /** φ(N) transition id -> N transition id (T' = T: the same ids). */
  transitions: Record<string, string>;
  arcs: Record<string, ArcOrigin>;
  /** The bijection f: each identity colour with its complementary colour. */
  complement: { identity: Value; special: Value }[];
  /** Names of the colour sets and variables the construction added. */
  identitySet: string;
  specialSet: string;
  specialVariables: Record<string, string>;
}

/** The sets of Sec. 6.3, by element name, for display and checking against the thesis. */
export interface ConstructionSets {
  /** Pre_REP: the inhibitor arcs (p, t) of N that became directed arcs. */
  preRep: [string, string][];
  /** Post_NEW: the new post arcs (t, p). */
  postNew: [string, string][];
  /** T_G (= T_STEP) and T_NG (= T_R ∪ T_EM). */
  guarded: string[];
  unguarded: string[];
  /** B_t, the binding pairs of the guards, as (identity colour, complementary colour). */
  bindingPairs: [string, string][];
  /** M'0 as (p, c) pairs. */
  initialMarking: string[];
}

export interface ConstructionResult {
  /** φ(N), a T-APN (net class "tapn"). */
  net: Net;
  mapping: ConstructionMapping;
  roles: StepNetRoles;
  sets: ConstructionSets;
  /** Warnings: parts of N that do not fit a composite step net (the construction is defined for those). */
  problems: Problem[];
}

export interface ConstructOptions {
  /** Names for the complementary colours, by identity colour; default `<colour>_bar` (e.g. b_bar). */
  complementNames?: Record<string, string>;
  /** Override the structural reading of N's parts. */
  roles?: StepNetRoles;
  /** Name of φ(N); default "<name of N> (T-APN)". */
  name?: string;
}

/**
 * Build the T-APN φ(N) associated with an APN N (Konios Def. 21). N should be a composite step net
 * (Def. 13); other nets are translated by the same rules and get warnings. Places and transitions
 * keep their ids, names and positions; new arcs that would retrace an existing arc get a bend point.
 * Throws if N is not an APN without errors.
 */
export function constructTapn(apn: Net, opts: ConstructOptions = {}): ConstructionResult {
  if (!isAmbient(apn.netClass) && apn.netClass !== "coloured") throw new Error("Construct T-APN needs an APN (or a coloured net written as one)");
  if (apn.netClass === "tapn") throw new Error("This net is already a T-APN");
  const an = compileAmbient(apn);
  const errs = an.problems.filter((p) => p.severity === "error");
  if (errs.length) throw new Error(`The APN has errors: ${errs[0].message}`);
  const cn = an.cn;
  const roles = opts.roles ?? classifyStepNet(apn);
  const problems: Problem[] = roles.problems.map((m) => ({ severity: "warning", message: m }));
  const name = new Map<string, string>([...apn.places, ...apn.transitions].map((n) => [n.id, n.name]));
  const decls = apn.declarations;
  const varSet = new Map(decls.variables.map((v) => [v.name, v.colourSet]));
  const placeSet = (p: Place) => p.colourSet || "Dot";

  // Cl_ID: every colour of the colour sets used by places and transition modes, in declaration order.
  const used = new Set<string>(apn.places.filter((p) => !p.coarse).map(placeSet));
  for (const t of an.transitions) if (t.modeVariable) used.add(varSet.get(t.modeVariable)!);
  const idColours: Value[] = [];
  const idKeys = new Set<string>();
  for (const cs of decls.colourSets)
    if (used.has(cs.name))
      for (const v of cn.colourSets.get(cs.name) ?? [])
        if (!idKeys.has(valueKey(v))) {
          idKeys.add(valueKey(v));
          idColours.push(v);
        }

  // The identity colour set f is defined on: a declared set with exactly these colours, else a new one.
  const declaredNames = new Set([...decls.colourSets.map((c) => c.name), ...decls.variables.map((v) => v.name), ...decls.constants.map((c) => c.name)]);
  const fresh = (base: string) => {
    let n = base;
    for (let i = 2; declaredNames.has(n) || cn.enumValues.has(n); i++) n = `${base}${i}`;
    declaredNames.add(n);
    return n;
  };
  const colourSets: ColourSetDecl[] = decls.colourSets.map((c) => ({ ...c }));
  let identitySet = decls.colourSets.find((cs) => {
    const d = cn.colourSets.get(cs.name) ?? [];
    return d.length === idColours.length && d.every((v) => idKeys.has(valueKey(v)));
  })?.name;
  if (!identitySet) {
    if (!idColours.every((v) => typeof v === "string")) throw new Error("Construct T-APN needs colours that are names (enumeration values)");
    identitySet = fresh("Cl");
    colourSets.push({ name: identitySet, type: "enum", values: idColours as string[] });
  }
  const identityOrder = cn.colourSets.get(identitySet) ?? idColours;

  // (v) Cl̄ and f.
  const specialName = (v: Value) => {
    const wanted = opts.complementNames?.[showValue(v)];
    if (wanted) {
      if (declaredNames.has(wanted) || cn.enumValues.has(wanted)) throw new Error(`The complementary colour name ${wanted} is already in use`);
      declaredNames.add(wanted);
      return wanted;
    }
    const base = /^[A-Za-z_][A-Za-z0-9_]*$/.test(showValue(v)) ? `${showValue(v)}_bar` : `bar_${identityOrder.findIndex((x) => valueKey(x) === valueKey(v))}`;
    return fresh(base);
  };
  const f = new Map<string, string>();
  const complement: { identity: Value; special: Value }[] = [];
  for (const v of identityOrder) {
    const g = specialName(v);
    f.set(valueKey(v), g);
    complement.push({ identity: v, special: g });
  }
  const specialSet = fresh(`${identitySet}_bar`);
  colourSets.push({ name: specialSet, type: "enum", values: identityOrder.map((v) => f.get(valueKey(v))!), complementOf: identitySet });

  const P_C = new Set(roles.control);
  const P_I = new Set(roles.inhibitorPlaces);
  const T_EM = new Set(roles.emptying);
  const T_STEP = new Set(roles.step);

  // (vi) C_P(p) = C(p) ∪ f(C(p)) for control places.
  const ctrlSetFor = new Map<string, string>();
  const controlColourSet = (cs: string): string => {
    let n = ctrlSetFor.get(cs);
    if (n) return n;
    const dom = cn.colourSets.get(cs) ?? [];
    const specials = dom.map((v) => f.get(valueKey(v))).filter((g): g is string => g !== undefined);
    let specialPart = specialSet;
    if (specials.length !== identityOrder.length) {
      specialPart = fresh(`${cs}_bar`);
      colourSets.push({ name: specialPart, type: "subset", components: [specialSet], predicate: specials.map((g) => `x = ${g}`).join(" or ") || "false" });
    }
    n = fresh(`${cs}_ctrl`);
    colourSets.push({ name: n, type: "union", components: [cs, specialPart] });
    ctrlSetFor.set(cs, n);
    return n;
  };

  // Variables carrying f(c): one per mode variable that needs it.
  const variables: VariableDecl[] = decls.variables.map((v) => ({ ...v }));
  const specialVariables: Record<string, string> = {};
  const specialVar = (modeVar: string) => {
    let v = specialVariables[modeVar];
    if (!v) {
      v = fresh(`${modeVar}_bar`);
      specialVariables[modeVar] = v;
      variables.push({ name: v, colourSet: specialSet });
    }
    return v;
  };
  const modeVarOf = new Map(an.transitions.map((t) => [t.id, t.modeVariable]));

  // (iii) Pre' and Post'.
  const arcs: Arc[] = [];
  const origins: Record<string, ArcOrigin> = {};
  const preRep: [string, string][] = [];
  const postNew: [string, string][] = [];
  const postNewIds: [string, string][] = [];
  const directed = apn.arcs.filter((a) => a.kind === "normal");
  const hasPost = (t: string, p: string) => directed.some((a) => a.source === t && a.target === p);
  const hasPre = (p: string, t: string) => directed.some((a) => a.source === p && a.target === t);
  const usedIds = new Set(apn.arcs.map((a) => a.id));
  const freshArc = (base: string) => {
    let id = base;
    for (let i = 2; usedIds.has(id); i++) id = `${base}_${i}`;
    usedIds.add(id);
    return id;
  };
  const needsSpecial = new Set<string>();
  for (const a of apn.arcs) {
    if (a.kind === "inhibitor") {
      const mv = modeVarOf.get(a.target) ?? "x";
      arcs.push({ ...a, kind: "normal", inscription: specialVar(mv) });
      origins[a.id] = { from: a.id, origin: "replacedInhibitor" };
      preRep.push([name.get(a.source)!, name.get(a.target)!]);
      needsSpecial.add(a.target);
    } else {
      arcs.push({ ...a });
      origins[a.id] = { from: a.id, origin: "copied" };
    }
  }
  const addPost = (t: string, p: string, origin: "emptying" | "step") => {
    if (hasPost(t, p) || postNewIds.some(([a, b]) => a === t && b === p)) return;
    const mv = modeVarOf.get(t) ?? "x";
    const id = freshArc(`${t}_${p}_new`);
    const arc: Arc = { id, source: t, target: p, kind: "normal", inscription: specialVar(mv) };
    if (hasPre(p, t)) arc.points = [bend(apn, p, t)];
    arcs.push(arc);
    origins[id] = { origin };
    postNew.push([name.get(t)!, name.get(p)!]);
    postNewIds.push([t, p]);
    needsSpecial.add(t);
  };
  // Emptying transitions give back the complementary token to the inhibitor control place they empty.
  for (const t of roles.emptying)
    for (const p of directed.filter((a) => a.target === t && P_C.has(a.source) && P_I.has(a.source)).map((a) => a.source)) addPost(t, p, "emptying");
  // A step transition into p_t also serves the control places cp^t̂(p_t) of the other steps into p_t,
  // and cp^ε(p^0) when p_t is the starting place.
  for (const t of roles.step) {
    const pt = roles.finishingOf[t];
    if (!pt) continue;
    for (const that of roles.step) if (that !== t && roles.finishingOf[that] === pt && roles.controlOf[that]) addPost(t, roles.controlOf[that], "step");
    for (const [rc, start] of Object.entries(roles.rootOf)) if (start === pt) addPost(t, rc, "step");
  }

  // (x) Guards: B_t = {(x, f(x)) | x ∈ C(t)} on step transitions (T_G); the same pairing on any
  // other transition that carries f(c), whose Gd is constantly true (Def. 21 (x)) but which needs
  // the pairing so that ordinary coloured-net tools bind the complementary variable to f(c).
  const bindingPairs: [string, string][] = [];
  const transitions: Transition[] = apn.transitions.map((t) => {
    const out: Transition = { ...t };
    const at = an.transitions.find((x) => x.id === t.id);
    if (!at || !needsSpecial.has(t.id) || !at.modeVariable) return out;
    const mv = at.modeVariable;
    const sv = specialVariables[mv];
    const modes = cn.colourSets.get(varSet.get(mv)!) ?? [];
    const pairs = modes.map((c) => [showValue(c), f.get(valueKey(c))!] as [string, string]);
    if (T_STEP.has(t.id)) for (const pr of pairs) if (!bindingPairs.some((b) => b[0] === pr[0])) bindingPairs.push(pr);
    const guard = pairs.map(([c, g]) => `${mv} = ${c} and ${sv} = ${g}`).join(" or ") || "false";
    out.guard = t.guard?.trim() ? `(${t.guard}) and (${guard})` : guard;
    return out;
  });

  // (vi), (ix), (xi), (xii): places, capacities, M'0 and gluing places.
  const M0slots = ambientInitialMarking(an);
  const M0 = new Map<string, Multiset>(cn.places.map((p) => [p.id, M0slots[p.slot]]));
  const specialsFor = new Map<string, Set<string>>(); // place -> identity colour keys whose f(c) it gets
  const give = (p: string, colours: Iterable<Value>) => {
    if (!(P_C.has(p) && P_I.has(p))) return;
    const s = specialsFor.get(p) ?? new Set<string>();
    for (const c of colours) s.add(valueKey(c));
    specialsFor.set(p, s);
  };
  const coloursIn = (p: string | undefined) => (p ? (M0.get(p)?.entries() ?? []).filter(([, n]) => n > 0).map(([c]) => c) : []);
  for (const [t, p] of postNewIds) {
    // (xi), first disjunct: p receives a new arc from a step transition t whose finishing place is marked.
    if (T_STEP.has(t)) give(p, coloursIn(roles.finishingOf[t]));
    // (xi), second disjunct: p is emptied by an emptying transition and controls a marked finishing place.
    if (T_EM.has(t)) for (const s of roles.step) if (roles.controlOf[s] === p) give(p, coloursIn(roles.finishingOf[s]));
  }
  // (xi), root control place: the complements of the users in the starting place (Sec. 6.2.2's
  // explanation of (xi) and the examples of Sec. 6.3-6.4).
  for (const [rc, start] of Object.entries(roles.rootOf)) give(rc, coloursIn(start));

  const initialPairs: string[] = [];
  const places: Place[] = apn.places.map((p) => {
    const out: Place = { ...p };
    if (p.coarse) return out;
    if (P_C.has(p.id)) out.colourSet = controlColourSet(placeSet(p));
    const m = M0.get(p.id) ?? new Multiset();
    const extra: [Value, number][] = [];
    for (const k of specialsFor.get(p.id) ?? []) {
      const c = identityOrder.find((v) => valueKey(v) === k);
      if (c === undefined) continue;
      const n = Math.max(0, 1 - m.count(c));
      if (n > 0) extra.push([f.get(k)!, n]);
    }
    if (extra.length) out.marking = m.plus(new Multiset(extra)).toString();
    for (const [c, n] of m.plus(new Multiset(extra)).entries()) for (let i = 0; i < n; i++) initialPairs.push(`(${p.name},${showValue(c)})`);
    return out;
  });

  const net: Net = {
    ...structuredClone({ ...apn, places: [], transitions: [], arcs: [] }),
    name: opts.name ?? `${apn.name} (T-APN)`,
    netClass: "tapn",
    places,
    transitions,
    arcs,
    declarations: { ...structuredClone(decls), colourSets, variables },
    comment: [apn.comment, `Constructed from the APN "${apn.name}" by Konios's construction (Def. 21): colour-sensitive inhibitor arcs replaced by arcs carrying the complementary colours ${specialSet}.`]
      .filter(Boolean)
      .join("\n"),
  };
  layoutIfStacked(net);

  const sortPairs = (xs: [string, string][]) => xs.sort((a, b) => a.join().localeCompare(b.join(), "en", { numeric: true }));
  const stepNames = roles.step.map((t) => name.get(t)!);
  return {
    net,
    mapping: {
      places: Object.fromEntries(places.map((p) => [p.id, p.id])),
      transitions: Object.fromEntries(transitions.map((t) => [t.id, t.id])),
      arcs: origins,
      complement,
      identitySet,
      specialSet,
      specialVariables,
    },
    roles,
    sets: {
      preRep: sortPairs(preRep),
      postNew: sortPairs(postNew),
      guarded: stepNames,
      unguarded: apn.transitions.filter((t) => !t.coarse && !T_STEP.has(t.id)).map((t) => t.name),
      bindingPairs,
      initialMarking: initialPairs.sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
    },
    problems,
  };
}

/** A bend point for a new arc t → p that runs alongside an existing arc p → t (Fig. 6.4 draws such pairs as two curves). */
function bend(net: Net, p: string, t: string) {
  const a = net.places.find((x) => x.id === p)!;
  const b = net.transitions.find((x) => x.id === t)!;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = 24;
  return { x: Math.round(mx - (dy / len) * off), y: Math.round(my + (dx / len) * off) };
}

/** If every node sits on the same spot (a net built without positions), spread them on a grid. */
function layoutIfStacked(net: Net) {
  const nodes = [...net.places, ...net.transitions];
  if (nodes.length < 2) return;
  if (!nodes.every((n) => n.x === nodes[0].x && n.y === nodes[0].y)) return;
  const cols = Math.ceil(Math.sqrt(nodes.length));
  nodes.forEach((n, i) => {
    n.x = 100 + (i % cols) * 120;
    n.y = 100 + Math.floor(i / cols) * 120;
  });
  for (const a of net.arcs) delete a.points;
}
