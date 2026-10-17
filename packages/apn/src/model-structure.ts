// Structural reading of an APN drawn as a coloured Net (Konios 2015, Sec. 4.1.2 and Defs 6, 7).
//
// The composition operators of Sec. 4.3 need to know, for a net N, its gluing places G and the
// control places cp^t(g) of every gluing place g and every t in •g. A Net has no fields for these,
// so they are read from the structure, which Defs 6-13 fix completely:
//   - a step transition ts has one input place (ps) and two output places (pf and pc);
//   - an emptying transition has inputs {pc, pd} and one output pr;
//   - a retrieve transition has input pr and output pd;
//   - pc = cp^ts(pf) is the output place of ts that feeds emptying transitions;
//   - a root net (Def. 7) has a place p and a control place pc and no arcs; after composition
//     pc only has colour-sensitive inhibitor arcs to the step transitions leaving p.
// Gluing places are read from `Place.gluing` when the net carries that flag, otherwise they are
// the step places (in a composite step net every step place is a gluing place, Defs 8 and 12).

import { Arc, Net, Place } from "@pns/core";

/** A place that may carry the gluing (interface) flag of Konios's Def. 3 (G ⊆ P). */
export type GluingAwarePlace = Place & { gluing?: boolean };

/** The gluing flag of a place, or undefined when the net does not record it. */
export function gluingFlag(p: Place): boolean | undefined {
  return (p as GluingAwarePlace).gluing;
}

/** Set or clear the gluing flag on a place object (in place). */
export function setGluingFlag(p: Place, on: boolean): void {
  const q = p as GluingAwarePlace;
  if (on) q.gluing = true;
  else delete q.gluing;
}

/** One decision point of a control system (Sec. 4.1.2): pd --t_em--> pr --t_r--> pd. */
export interface DecisionRoles {
  /** Response place p_r^i: the advice shown to the user. */
  response: string;
  /** Database place p_d^i: the users this advice is for. */
  database: string;
  /** Emptying transition t_em^i: Pre = {pc, pd}, Post = {pr}. */
  emptying: string;
  /** Retrieve transition t_r^i: Pre = {pr}, Post = {pd}. */
  retrieve: string;
}

/** A step transition with its step places and control system (Def. 6). Ids, not names. */
export interface StepRoles {
  transition: string;
  start: string;
  finish: string;
  control: string;
  decisions: DecisionRoles[];
}

/** A root net inside a composite net (Def. 7): place p and its control place pc = cp^ε(p). */
export interface RootRoles {
  place: string;
  control: string;
}

export interface ApnStructure {
  steps: StepRoles[];
  roots: RootRoles[];
  /** Step places: the starting and finishing places of steps, and root places. */
  stepPlaces: string[];
  /** G: flagged places when the net records the flag, otherwise the step places. */
  gluing: string[];
  /** True when G was read from `Place.gluing` flags. */
  gluingFlagged: boolean;
  /** Places whose role could not be read, or that have more than one role. */
  problems: string[];
}

export interface Incidence {
  pre: Map<string, string[]>;
  post: Map<string, string[]>;
  /** For each place: the transitions that put tokens into it (•p). */
  preOfPlace: Map<string, string[]>;
  /** For each place: the transitions that take tokens from it (p•). */
  postOfPlace: Map<string, string[]>;
}

/** Pre and Post of every transition, from the normal arcs only. */
export function incidence(net: Net): Incidence {
  const pre = new Map<string, string[]>();
  const post = new Map<string, string[]>();
  const preOfPlace = new Map<string, string[]>();
  const postOfPlace = new Map<string, string[]>();
  for (const t of net.transitions) {
    pre.set(t.id, []);
    post.set(t.id, []);
  }
  for (const p of net.places) {
    preOfPlace.set(p.id, []);
    postOfPlace.set(p.id, []);
  }
  for (const a of net.arcs) {
    if (a.kind !== "normal") continue;
    if (pre.has(a.target) && postOfPlace.has(a.source)) {
      pre.get(a.target)!.push(a.source);
      postOfPlace.get(a.source)!.push(a.target);
    } else if (post.has(a.source) && preOfPlace.has(a.target)) {
      post.get(a.source)!.push(a.target);
      preOfPlace.get(a.target)!.push(a.source);
    }
  }
  return { pre, post, preOfPlace, postOfPlace };
}

export function inhibitorArcs(net: Net): Arc[] {
  return net.arcs.filter((a) => a.kind === "inhibitor");
}

const CONTROL_NAME = /^(ctrl|pc|cp|control)/i;

/** Read the roles of every place and transition. Never throws; see `problems`. */
export function analyseApn(net: Net): ApnStructure {
  const inc = incidence(net);
  const problems: string[] = [];
  const name = (id: string) => net.places.find((p) => p.id === id)?.name ?? net.transitions.find((t) => t.id === id)?.name ?? id;

  for (const a of net.arcs)
    if (a.kind !== "normal" && a.kind !== "inhibitor") problems.push(`Arc ${name(a.source)} → ${name(a.target)} is a ${a.kind} arc; APNs only have normal and inhibitor arcs (Def. 3)`);

  const emptying = new Set(net.transitions.filter((t) => inc.pre.get(t.id)!.length === 2 && inc.post.get(t.id)!.length === 1).map((t) => t.id));
  const isControlOf = (p: string) => inc.postOfPlace.get(p)!.some((t) => emptying.has(t));

  const steps: StepRoles[] = [];
  const role = new Map<string, string>();
  const claim = (id: string, r: string) => {
    const old = role.get(id);
    if (old && old !== r) problems.push(`${name(id)} is both ${old} and ${r}`);
    else role.set(id, r);
  };

  for (const t of net.transitions) {
    const pre = inc.pre.get(t.id)!;
    const post = inc.post.get(t.id)!;
    if (pre.length !== 1 || post.length !== 2) continue;
    const ctrl = post.filter(isControlOf);
    if (ctrl.length !== 1) {
      problems.push(`Step transition ${name(t.id)} needs exactly one control place among its output places (Def. 6)`);
      continue;
    }
    const control = ctrl[0];
    const finish = post.find((p) => p !== control)!;
    const decisions: DecisionRoles[] = [];
    for (const em of inc.postOfPlace.get(control)!) {
      if (!emptying.has(em)) {
        problems.push(`${name(control)} is the control place of ${name(t.id)} but also feeds ${name(em)}, which is not an emptying transition`);
        continue;
      }
      const database = inc.pre.get(em)!.find((p) => p !== control);
      const response = inc.post.get(em)![0];
      if (!database) {
        problems.push(`Emptying transition ${name(em)} needs a database place`);
        continue;
      }
      const retrieves = net.transitions.filter(
        (r) => inc.pre.get(r.id)!.length === 1 && inc.pre.get(r.id)![0] === response && inc.post.get(r.id)!.length === 1 && inc.post.get(r.id)![0] === database,
      );
      if (retrieves.length !== 1) {
        problems.push(`Response place ${name(response)} needs exactly one retrieve transition back to ${name(database)} (Def. 6)`);
        continue;
      }
      decisions.push({ response, database, emptying: em, retrieve: retrieves[0].id });
    }
    if (decisions.length === 0) problems.push(`Step transition ${name(t.id)} has no decision points (Def. 6 needs n ≥ 1)`);
    steps.push({ transition: t.id, start: pre[0], finish, control, decisions });
  }

  const stepTransitions = new Set(steps.map((s) => s.transition));
  const cs = new Set<string>();
  for (const s of steps) {
    claim(s.transition, "a step transition");
    claim(s.start, "a step place");
    claim(s.finish, "a step place");
    claim(s.control, "a control place");
    for (const d of s.decisions) {
      claim(d.database, "a database place");
      claim(d.response, "a response place");
      claim(d.emptying, "an emptying transition");
      claim(d.retrieve, "a retrieve transition");
      cs.add(d.database).add(d.response);
    }
  }
  // Each database and response place belongs to exactly one emptying/retrieve pair.
  for (const s of steps)
    for (const d of s.decisions) {
      const io = [...inc.preOfPlace.get(d.database)!, ...inc.postOfPlace.get(d.database)!, ...inc.preOfPlace.get(d.response)!, ...inc.postOfPlace.get(d.response)!];
      if (io.some((t) => t !== d.emptying && t !== d.retrieve)) problems.push(`The control system of ${name(s.transition)} shares ${name(d.database)} or ${name(d.response)} with another part of the net`);
    }

  // Roots: places with no normal arcs.
  const isolated = net.places.filter((p) => !role.has(p.id) && inc.preOfPlace.get(p.id)!.length === 0 && inc.postOfPlace.get(p.id)!.length === 0);
  const flagged = net.places.some((p) => gluingFlag(p) !== undefined);
  const roots: RootRoles[] = [];
  const rootCtrl = new Set<string>();
  const startOf = new Map(steps.map((s) => [s.transition, s.start]));
  for (const p of isolated) {
    const targets = inhibitorArcs(net).filter((a) => a.source === p.id).map((a) => a.target);
    if (targets.length === 0) continue;
    const starts = new Set(targets.map((t) => (stepTransitions.has(t) ? startOf.get(t)! : "")));
    if (starts.size !== 1 || starts.has("")) {
      problems.push(`${p.name} inhibits transitions that do not leave one common place, so it is not a root control place`);
      continue;
    }
    roots.push({ place: [...starts][0], control: p.id });
    rootCtrl.add(p.id);
  }
  const bare = isolated.filter((p) => !rootCtrl.has(p.id) && !roots.some((r) => r.place === p.id));
  if (bare.length > 0) {
    // Root nets that have not been composed with anything yet: pair a place with its control place.
    const isCtrl = (p: Place) => (flagged ? gluingFlag(p) !== true : CONTROL_NAME.test(p.name));
    const ctrls = bare.filter(isCtrl);
    const places = bare.filter((p) => !isCtrl(p));
    if (ctrls.length === places.length) for (let i = 0; i < ctrls.length; i++) roots.push({ place: places[i].id, control: ctrls[i].id });
    else if (bare.length === 2 && !flagged) roots.push({ place: bare[0].id, control: bare[1].id });
    else problems.push(`Cannot pair the unconnected places ${bare.map((p) => p.name).join(", ")} into root nets (Def. 7)`);
  }
  for (const r of roots) {
    claim(r.place, "a step place");
    claim(r.control, "a root control place");
  }
  for (const p of net.places) if (!role.has(p.id)) problems.push(`Place ${p.name} has no role in a step net (step, control, database or response place)`);
  for (const t of net.transitions) if (!role.has(t.id)) problems.push(`Transition ${t.name} is neither a step, emptying nor retrieve transition`);

  const stepPlaces = net.places.filter((p) => role.get(p.id) === "a step place").map((p) => p.id);
  const gluing = flagged ? net.places.filter((p) => gluingFlag(p) === true).map((p) => p.id) : stepPlaces;
  return { steps, roots, stepPlaces, gluing, gluingFlagged: flagged, problems: [...new Set(problems)] };
}

/**
 * The control places cp^t(g) of a place g, one for each t ∈ •g (Def. 8). The collapsed transition ε
 * of a root net counts as a pre-transition of the root place (p. 56), reported as transition "ε".
 */
export function controlPlacesOf(net: Net, g: string, s: ApnStructure = analyseApn(net)): { transition: string; control: string }[] {
  const out: { transition: string; control: string }[] = [];
  for (const r of s.roots) if (r.place === g) out.push({ transition: "ε", control: r.control });
  for (const st of s.steps) if (st.finish === g) out.push({ transition: st.transition, control: st.control });
  return out;
}

/** Resolve a place given by id or by (unique) name. */
export function resolvePlace(net: Net, ref: string): Place {
  const byId = net.places.find((p) => p.id === ref);
  if (byId) return byId;
  const byName = net.places.filter((p) => p.name === ref);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) throw new Error(`More than one place is called ${ref}; use its id`);
  throw new Error(`No place ${ref} in ${net.name}`);
}
