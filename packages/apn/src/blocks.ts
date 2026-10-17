// Building blocks of Konios's step-modelling approach (Konios 2015, Sec. 4.1-4.2, 4.3.2.1):
// the unidirectional step (Fig. 4.1), the basic step net, i.e. a unidirectional step with a control
// system and one or more decision points (Def. 6, Figs 4.2 and 4.5), the root net (Def. 7, Fig. 4.6)
// and the one step net (Def. 11). Every generator returns a Net of class "apn" whose places hold
// coloured tokens (one colour per user), with capacity 1 per colour (Sec. 3.2: APNs are colour safe).

import { ColourSetDecl, Net, Place, Transition, Point } from "@pns/core";
import { setGluingFlag } from "./model-structure";

/** A user identity: a value of the colour set, such as "b", "w" or 1. */
export type Colour = string | number;

/** Colour set BW = {b, w} used in the thesis figures (• = b, ◦ = w). */
export const BW: ColourSetDecl = { name: "BW", type: "enum", values: ["b", "w"] };

/** Options shared by every generator. */
export interface ColourOptions {
  /** The colour set of every place and of every transition's mode. Default {@link BW}. */
  colourSet?: ColourSetDecl;
  /** Name of the mode variable written on every arc. Default "x". */
  variable?: string;
  /** Capacity K of every place, per colour. Default 1 (colour-safe APNs, Sec. 3.2). */
  capacity?: number;
}

/** One decision point of a control system (Sec. 4.1.2): a database place, its advice and two transitions. */
export interface DecisionPoint {
  /** Users whose data the database place holds initially (Def. 6 needs at least one). */
  users: Colour[];
  /** Response place p_r^i: the advice given, e.g. "Left_p1_1". */
  response?: string;
  /** Database place p_d^i. */
  database?: string;
  /** Emptying transition t_em^i (system reacts: Pre = {pc, pd}, Post = {pr}). */
  emptying?: string;
  /** Retrieve transition t_r^i (data restored: Pre = {pr}, Post = {pd}). */
  retrieve?: string;
  /** What the response place stands for, e.g. which display shows the advice. */
  responseComment?: string;
  /** What the database place stands for. */
  databaseComment?: string;
}

/** Names and comments of a step: starting place, step transition, finishing place and control place. */
export interface StepOptions extends ColourOptions {
  /** Starting place p_s. Default "ps". */
  start?: string;
  /** Finishing place p_f. Default "pf". */
  finish?: string;
  /** Step transition t_s. Default `${start}to${finish}`. */
  step?: string;
  /** Control place p_c = cp^ts(p_f). Default `ctrl_${finish}`. */
  control?: string;
  /** Element comments, e.g. which sensor a step place stands for. */
  comments?: { start?: string; finish?: string; step?: string; control?: string };
  /** Net name. */
  name?: string;
  /** Prefix for every element id, to keep ids apart when several blocks are composed. Default "". */
  idPrefix?: string;
  /** Position of the starting place. Default (480, 420). */
  origin?: Point;
}

/** Options of the basic step net and the one step net (Defs 6 and 11). */
export interface BasicStepOptions extends StepOptions {
  /**
   * The decision points of the control system, n ≥ 1 (Def. 6). Default: one decision point for
   * every colour of the colour set.
   */
  decisions?: DecisionPoint[];
}

/** Options of the root net (Def. 7). */
export interface RootOptions extends ColourOptions {
  /** The place p, marked with the initial users. Default "p". */
  place?: string;
  /** Its control place p_c = cp^ε(p). Default `ctrl_${place}`. */
  control?: string;
  /** The initial users, in p. */
  users: Colour[];
  /** Users stopped from proceeding (tokens in p_c, Fig. 4.6(b)). Default none. */
  blocked?: Colour[];
  comments?: { place?: string; control?: string };
  name?: string;
  idPrefix?: string;
  origin?: Point;
}

// Layout of a step with its control system, after Fig. 4.5: p_c sits at the top above the database
// column, each decision point is one row (p_r, t_em, p_d) with t_r under t_em, and the step runs
// upwards on the right from p_s through t_s to p_f.
export const LAYOUT = {
  /** Distance from p_c to the database column, and between columns of the control system. */
  column: 110,
  /** Height of one decision point row. */
  row: 120,
  /** Horizontal distance between the step and p_c. */
  gap: 130,
};

/** Positions of a control system relative to its control place; `mirror` puts p_r on the right. */
export function controlSystemOffsets(n: number, mirror = false): { control: Point; rows: { response: Point; emptying: Point; database: Point; retrieve: Point }[] } {
  const s = mirror ? -1 : 1;
  const { column, row } = LAYOUT;
  return {
    control: { x: 0, y: 0 },
    rows: Array.from({ length: n }, (_, i) => ({
      database: { x: 0, y: 60 + row * i },
      emptying: { x: -s * column, y: 60 + row * i },
      response: { x: -s * 2 * column, y: 60 + row * i },
      retrieve: { x: -s * column, y: 120 + row * i },
    })),
  };
}

/** Height of a step with n decision points (from p_f down to p_s). */
export function stepHeight(n: number): number {
  return Math.max(240, LAYOUT.row * n + 60);
}

/** Small builder for the nets made here. */
export class NetBuilder {
  readonly net: Net;
  private readonly cs: string;
  private readonly cap: number;
  readonly variable: string;
  constructor(name: string, opts: ColourOptions, private readonly idPrefix = "") {
    const colourSet = opts.colourSet ?? BW;
    this.cs = colourSet.name;
    this.cap = opts.capacity ?? 1;
    this.variable = opts.variable ?? "x";
    this.net = {
      format: "pns/1",
      name,
      netClass: "apn",
      places: [],
      transitions: [],
      arcs: [],
      declarations: {
        colourSets: [{ name: "Dot", type: "dot" }, colourSet],
        variables: [{ name: this.variable, colourSet: colourSet.name }],
        constants: [],
      },
    };
  }
  place(name: string, at: Point, marking: Colour[] = [], comment?: string, gluing = false): string {
    const id = this.idPrefix + name;
    const p: Place = { id, name, x: Math.round(at.x), y: Math.round(at.y), marking: markingText(marking), colourSet: this.cs, capacity: this.cap };
    if (comment) p.comment = comment;
    if (gluing) setGluingFlag(p, true);
    this.net.places.push(p);
    return id;
  }
  transition(name: string, at: Point, comment?: string): string {
    const id = this.idPrefix + name;
    const t: Transition = { id, name, x: Math.round(at.x), y: Math.round(at.y) };
    if (comment) t.comment = comment;
    this.net.transitions.push(t);
    return id;
  }
  arc(source: string, target: string, kind: "normal" | "inhibitor" = "normal"): void {
    this.net.arcs.push({ id: `${this.idPrefix}a${this.net.arcs.length + 1}`, source, target, kind, inscription: this.variable });
  }
}

/** Marking text for a set of users, e.g. "b ++ w" or "1 ++ 2". */
export function markingText(users: Colour[]): string {
  return users.map(String).join(" ++ ");
}

function colourValues(cs: ColourSetDecl): Colour[] {
  if (cs.type === "enum" || cs.type === "string") return cs.values ?? [];
  if (cs.type === "int") {
    const out: number[] = [];
    for (let i = cs.min ?? 0; i <= (cs.max ?? -1) && out.length < 64; i++) out.push(i);
    return out;
  }
  if (cs.type === "bool") return ["false", "true"];
  if (cs.type === "dot") return ["dot"];
  return [];
}

function stepNames(o: StepOptions) {
  const start = o.start ?? "ps";
  const finish = o.finish ?? "pf";
  return { start, finish, step: o.step ?? `${start}to${finish}`, control: o.control ?? `ctrl_${finish}` };
}

/**
 * The unidirectional step of Fig. 4.1 (Sec. 4.1.1): p_s → t_s → p_f with no control system. An
 * action that can only happen in one direction. The starting place is marked as gluing place.
 * @param users initial users in the starting place
 */
export function unidirectionalStep(opts: StepOptions & { users?: Colour[] } = {}): Net {
  const n = stepNames({ start: "p1", finish: "p2", step: "t1", ...opts });
  const b = new NetBuilder(opts.name ?? "Unidirectional step", opts, opts.idPrefix);
  const o = opts.origin ?? { x: 120, y: 160 };
  const ps = b.place(n.start, o, opts.users ?? [], opts.comments?.start, true);
  const ts = b.transition(n.step, { x: o.x + 160, y: o.y }, opts.comments?.step);
  const pf = b.place(n.finish, { x: o.x + 320, y: o.y }, [], opts.comments?.finish);
  b.arc(ps, ts);
  b.arc(ts, pf);
  return b.net;
}

/**
 * The basic step net of Def. 6 (Fig. 4.5): a unidirectional step with a control system made of the
 * control place p_c, response places P_r, database places P_d, emptying transitions T_em and retrieve
 * transitions T_r, with Pre(t_em^i) = {p_c, p_d^i}, Post(t_em^i) = {p_r^i}, Pre(t_r^i) = {p_r^i},
 * Post(t_r^i) = {p_d^i}, Pre(t_s) = {p_s}, Post(t_s) = {p_f, p_c}, no inhibitor arcs, only the
 * database places marked, and G = {p_s}. With one decision point this is Fig. 4.2(a); with several
 * it is the step with multiple decision points of Fig. 4.2(b).
 */
export function basicStepNet(opts: BasicStepOptions = {}): Net {
  return stepNet(opts, false);
}

/** The unidirectional step with control system of Fig. 4.2: the same net as {@link basicStepNet}. */
export const unidirectionalStepWithControl = basicStepNet;

/**
 * The one step net of Def. 11: a basic step net whose gluing places are both p_s and p_f. It is the
 * second operand of the backward composition (Def. 12).
 */
export function oneStepNet(opts: BasicStepOptions = {}): Net {
  return stepNet(opts, true);
}

function stepNet(opts: BasicStepOptions, oneStep: boolean): Net {
  const n = stepNames(opts);
  const colourSet = opts.colourSet ?? BW;
  const decisions: DecisionPoint[] = opts.decisions ?? colourValues(colourSet).map((c) => ({ users: [c] }));
  if (decisions.length === 0) throw new Error("A basic step net needs at least one decision point (Def. 6: n ≥ 1)");
  for (const d of decisions) if (d.users.length === 0) throw new Error("Every database place must hold at least one user (Def. 6)");
  const b = new NetBuilder(opts.name ?? (oneStep ? `One step ${n.step}` : `Basic step ${n.step}`), opts, opts.idPrefix);
  const o = opts.origin ?? { x: 480, y: 420 };
  const h = stepHeight(decisions.length);
  const top = o.y - h;
  const ps = b.place(n.start, o, [], opts.comments?.start ?? `Starting place of the step ${n.step}`, true);
  const ts = b.transition(n.step, { x: o.x, y: top + h / 2 }, opts.comments?.step ?? `Step transition: a user moves from ${n.start} to ${n.finish}`);
  const pf = b.place(n.finish, { x: o.x, y: top }, [], opts.comments?.finish ?? `Finishing place of the step ${n.step}`, oneStep);
  const pcAt = { x: o.x - LAYOUT.gap, y: top };
  const pc = b.place(n.control, pcAt, [], opts.comments?.control ?? `Control place of ${n.finish}: holds the users whose action at ${n.finish} the system has detected but not yet answered`);
  b.arc(ps, ts);
  b.arc(ts, pf);
  b.arc(ts, pc);
  const off = controlSystemOffsets(decisions.length);
  decisions.forEach((d, i) => {
    const k = i + 1;
    const r = off.rows[i];
    const at = (q: Point) => ({ x: pcAt.x + q.x, y: pcAt.y + q.y });
    const dbName = d.database ?? `db_${n.finish}_${k}`;
    const prName = d.response ?? `advice_${n.finish}_${k}`;
    const pd = b.place(dbName, at(r.database), d.users, d.databaseComment ?? `Database place: the users the advice ${prName} is for`);
    const tem = b.transition(d.emptying ?? `Tem_${n.finish}_${k}`, at(r.emptying), `Emptying transition: the system answers a user detected in ${n.control} whose data is in ${dbName} with the advice ${prName}`);
    const pr = b.place(prName, at(r.response), [], d.responseComment ?? `Response place: the advice given to the user at ${n.finish}`);
    const tr = b.transition(d.retrieve ?? `Tr_${n.finish}_${k}`, at(r.retrieve), `Retrieve transition: the data of ${dbName} is restored so the advice can be given again`);
    b.arc(pc, tem);
    b.arc(pd, tem);
    b.arc(tem, pr);
    b.arc(pr, tr);
    b.arc(tr, pd);
  });
  return b.net;
}

/**
 * The root net of Def. 7 (Fig. 4.6): two places and nothing else. p holds the initial users and is
 * the only gluing place; its control place p_c = cp^ε(p) holds the users that may not proceed.
 */
export function rootNet(opts: RootOptions): Net {
  const place = opts.place ?? "p";
  const control = opts.control ?? `ctrl_${place}`;
  const b = new NetBuilder(opts.name ?? `Root ${place}`, opts, opts.idPrefix);
  const o = opts.origin ?? { x: 480, y: 420 };
  b.place(place, o, opts.users, opts.comments?.place ?? "Root place: the users at the start", true);
  b.place(control, { x: o.x - LAYOUT.gap, y: o.y }, opts.blocked ?? [], opts.comments?.control ?? `Control place of the root place ${place}: users put here are stopped from proceeding`);
  return b.net;
}
