// Turns a Net into a flat numeric model for simulation: slots, merged arcs, parsed rates,
// constants (with fuzzy numbers lifted out as parameters) and dependency lists.

import {
  ArcKind,
  CArc,
  Expr,
  Net,
  TransitionKind,
  Value,
  compile,
  defaultTransitionKind,
  evaluate,
  identifiers,
  num,
  parse,
  timeBase,
} from "@pns/core";
import { mapExpr } from "./exprutil";
import { RateArc, RateContext, RateEnv } from "./rates";

export class SimulationError extends Error {
  constructor(message: string, public elementId?: string) {
    super(message);
    this.name = "SimulationError";
  }
}

/** An arc of the simulation model. Normal arcs between the same nodes are merged. */
export interface SimArc extends RateArc {
  expr: Expr | null;
  /** The weight depends on the marking (arc expression mentions place names). */
  dynamic: boolean;
  /** Current weight for non-dynamic arcs (set by parameterize). */
  w: number;
}

export interface SimTransition extends RateContext {
  id: string;
  name: string;
  index: number;
  /** Effective kind after looking at the rate function (e.g. TimedFiring makes it deterministic). */
  kind: TransitionKind;
  inputs: SimArc[];
  outputs: SimArc[];
  maPre: SimArc[];
  /** Rate (stochastic/continuous), weight (immediate) or delay (deterministic). */
  rate: Expr | null;
  /** Scheduled transitions: [begin, repetition, end] expressions (repetition/end may be absent). */
  schedule: Expr[] | null;
  /** Evaluated schedule (set by parameterize). */
  sched: { begin: number; rep: number; end: number };
  /** Slots whose marking influences enabling or rate. */
  reads: number[];
  /** Slots changed when the transition fires (discretely or as a flow). */
  changes: number[];
  /** Output slots with a finite capacity. */
  capacitySlots: number[];
}

export interface SimPlace {
  id: string;
  name: string;
  slot: number;
  continuous: boolean;
  /** Snoopy's fixed place: the marking never changes during simulation. */
  fixed: boolean;
  markingExpr: Expr | null;
}

/** An observer (Declarations.observers) with its expression parsed. */
export interface SimObserver {
  name: string;
  /** place: an expression over markings; transition: over transition names (their current rates). */
  kind: "place" | "transition";
  expr: Expr;
}

/** A fuzzy number found in the net: TFN(low, peak, high) or TZN(a, b, c, d). */
export interface FuzzyParam {
  /** Internal identifier substituted into the expression. */
  name: string;
  kind: "TFN" | "TZN";
  values: number[];
  /** Where it was found, e.g. "constant k" or "rate of T1". */
  where: string;
}

export interface SimModel {
  net: Net;
  base: "stochastic" | "continuous" | "hybrid";
  places: SimPlace[];
  slotCount: number;
  /** First place of each slot (logical places share a slot). */
  slotPlace: SimPlace[];
  slotContinuous: Uint8Array;
  /** 1 for slots of fixed places: neither firings nor the ODEs change them. */
  slotFixed: Uint8Array;
  capacity: Float64Array;
  transitions: SimTransition[];
  constants: { name: string; expr: Expr | null; error?: string }[];
  fuzzy: FuzzyParam[];
  env: RateEnv;
  observers: SimObserver[];
  warnings: string[];
}

function tryParse(src: string, what: string, id?: string): Expr {
  try {
    return parse(src);
  } catch (e) {
    throw new SimulationError(`${what}: ${(e as Error).message}`, id);
  }
}

/** Build the simulation model. Throws SimulationError on structural errors. */
export function buildModel(net: Net): SimModel {
  const base = timeBase(net.netClass);
  if (!base) throw new SimulationError(`A ${net.netClass} net has no quantitative semantics; use a stochastic, continuous or hybrid class`);
  const cn = compile(net);
  if (cn.coloured) throw new SimulationError("Unfold coloured nets before building a simulation model");
  const fatal = cn.problems.filter(
    (p) => p.severity === "error" && !p.message.startsWith("Constant ") && !p.message.startsWith("Marking of ") && !p.message.startsWith("The initial marking"),
  );
  if (fatal.length) throw new SimulationError(fatal[0].message, fatal[0].elementId);
  const warnings: string[] = [];
  const fuzzy: FuzzyParam[] = [];

  const enums = new Set<string>();
  for (const cs of net.declarations.colourSets) if (cs.type === "enum") for (const v of cs.values ?? []) enums.add(v);
  const slotByName = new Map<string, number>();
  const env = new RateEnv(slotByName, new Map(), enums);
  env.functions = cn.functions;

  // Lift TFN/TZN calls out of an expression into parameters; arguments are evaluated with `env`.
  const liftFuzzy = (e: Expr, where: string): Expr =>
    mapExpr(e, (n) => {
      if (n.k !== "call" || (n.name !== "TFN" && n.name !== "TZN")) return undefined;
      const want = n.name === "TFN" ? 3 : 4;
      if (n.args.length !== want) throw new SimulationError(`${n.name} needs ${want} numbers (${where})`);
      const values = n.args.map((a) => num(evaluate(a, env)));
      for (let i = 1; i < values.length; i++)
        if (values[i] < values[i - 1]) throw new SimulationError(`${n.name}(${values.join(", ")}) must be non-decreasing (${where})`);
      const name = `__fz${fuzzy.length}`;
      fuzzy.push({ name, kind: n.name, values, where });
      env.constants.set(name, peakValue({ name, kind: n.name, values, where }));
      return { k: "id", name };
    });

  // Constants, evaluated with peak values so later fuzzy arguments can use earlier constants.
  const constants: SimModel["constants"] = [];
  for (const c of net.declarations.constants) {
    let expr: Expr | null = null;
    let error: string | undefined;
    try {
      expr = liftFuzzy(parse(c.value), `constant ${c.name}`);
      env.constants.set(c.name, evaluate(expr, env));
    } catch (e) {
      if (e instanceof SimulationError) throw e;
      error = (e as Error).message;
    }
    constants.push({ name: c.name, expr, error });
  }

  // Places and slots.
  const srcPlace = new Map(net.places.map((p) => [p.id, p]));
  const places: SimPlace[] = [];
  const slotPlace: SimPlace[] = [];
  const slotContinuous = new Uint8Array(cn.slotCount);
  const slotFixed = new Uint8Array(cn.slotCount);
  const capacity = new Float64Array(cn.slotCount).fill(Infinity);
  for (const cp of cn.places) {
    const p = srcPlace.get(cp.id)!;
    const continuous = base === "continuous" || (base === "hybrid" && !!p.continuous);
    const src = p.marking.trim();
    const sp: SimPlace = {
      id: cp.id,
      name: cp.name,
      slot: cp.slot,
      continuous,
      fixed: !!p.fixed,
      markingExpr: src ? liftFuzzy(tryParse(src, `Marking of ${p.name}`, p.id), `marking of ${p.name}`) : null,
    };
    places.push(sp);
    if (!slotPlace[cp.slot]) slotPlace[cp.slot] = sp;
    if (continuous) slotContinuous[cp.slot] = 1;
    if (p.fixed) slotFixed[cp.slot] = 1;
    if (cp.capacity !== undefined) capacity[cp.slot] = Math.min(capacity[cp.slot], cp.capacity);
    if (!slotByName.has(cp.name)) slotByName.set(cp.name, cp.slot);
  }
  const refsPlaces = (e: Expr | null, out: Set<number>) => {
    if (!e) return false;
    let any = false;
    for (const id of identifiers(e)) {
      const s = slotByName.get(id);
      if (s !== undefined) {
        out.add(s);
        any = true;
      }
    }
    return any;
  };

  const srcTrans = new Map(net.transitions.map((t) => [t.id, t]));
  const transitions: SimTransition[] = cn.transitions.map((ct, index) => {
    const t = srcTrans.get(ct.id)!;
    let declared: TransitionKind = t.kind ?? defaultTransitionKind(net.netClass) ?? "stochastic";
    if (base === "continuous" && declared !== "continuous") {
      if (t.kind) warnings.push(`${t.name}: transitions of continuous nets are continuous`);
      declared = "continuous";
    } else if (base === "stochastic" && declared === "continuous") {
      warnings.push(`${t.name}: stochastic nets have no continuous transitions; treated as stochastic`);
      declared = "stochastic";
    }
    const { kind, rate, schedule } = classifyRate(declared, t.rate ?? "", t.name, t.id);
    const reads = new Set<number>();
    const merge = (arcs: CArc[], what: string): SimArc[] => {
      const out: SimArc[] = [];
      const normalBySlot = new Map<number, SimArc>();
      for (const a of arcs) {
        const slot = a.place.slot;
        const kind = a.arc.kind as ArcKind;
        if (kind === "modifier") {
          // The place may appear in the rate: watch it, but it neither enables nor changes anything.
          reads.add(slot);
          continue;
        }
        const dynamic = refsPlaces(a.expr, reads);
        const sa: SimArc = { slot, kind, expr: a.expr, dynamic, w: 0 };
        if (kind === "normal") {
          const prev = normalBySlot.get(slot);
          if (prev) {
            prev.expr = prev.expr && a.expr ? { k: "bin", op: "+", l: prev.expr, r: a.expr } : prev.expr ?? a.expr;
            prev.dynamic ||= dynamic;
            continue;
          }
          normalBySlot.set(slot, sa);
        }
        if (a.expr && /^TFN|^TZN/.test(a.arc.inscription.trim())) throw new SimulationError(`Fuzzy arc weights are not supported (${what})`, a.arc.id);
        out.push(sa);
      }
      return out;
    };
    const inputs = merge(ct.inputs, `${t.name}`);
    const outputs = merge(ct.outputs, `${t.name}`);
    for (const a of inputs) reads.add(a.slot);
    const liftedRate = rate ? liftFuzzy(rate, `rate of ${t.name}`) : null;
    const liftedSchedule = schedule ? schedule.map((e) => liftFuzzy(e, `schedule of ${t.name}`)) : null;
    refsPlaces(liftedRate, reads);
    const capacitySlots = outputs.filter((a) => capacity[a.slot] < Infinity && !slotFixed[a.slot]).map((a) => a.slot);
    for (const s of capacitySlots) reads.add(s);
    const changes = new Set<number>();
    for (const a of inputs) if ((a.kind === "normal" || a.kind === "reset") && !slotFixed[a.slot]) changes.add(a.slot);
    for (const a of outputs) if (!slotFixed[a.slot]) changes.add(a.slot);
    if (kind === "continuous") {
      for (const a of [...inputs, ...outputs])
        if ((a.kind === "normal" || a.kind === "reset") && !slotContinuous[a.slot] && !slotFixed[a.slot])
          throw new SimulationError(`Continuous transition ${t.name} cannot change the discrete place ${slotPlace[a.slot].name}; use a read or inhibitor arc`, t.id);
    }
    return {
      id: t.id,
      name: t.name,
      index,
      kind,
      continuous: kind === "continuous",
      inputs,
      outputs,
      maPre: inputs.filter((a) => a.kind === "normal" || a.kind === "read"),
      rate: liftedRate,
      schedule: liftedSchedule,
      sched: { begin: 0, rep: 0, end: 0 },
      reads: [...reads].sort((a, b) => a - b),
      changes: [...changes].sort((a, b) => a - b),
      capacitySlots,
    };
  });

  const observers: SimObserver[] = (net.declarations.observers ?? []).map((o) => ({
    name: o.name,
    kind: o.kind,
    expr: liftFuzzy(tryParse(o.expression, `Observer ${o.name}`), `observer ${o.name}`),
  }));

  return {
    net,
    base,
    places,
    slotCount: cn.slotCount,
    slotPlace,
    slotContinuous,
    slotFixed,
    capacity,
    transitions,
    constants,
    fuzzy,
    env,
    observers,
    warnings,
  };
}

const FIRING_FUNCS = new Set(["ImmediateFiring", "TimedFiring", "FixedTimedFiring_Single", "FixedTimedFiring_Periodic"]);

/**
 * Work out a transition's effective kind and parsed rate from its declared kind and rate text.
 * A top-level ImmediateFiring / TimedFiring / FixedTimedFiring_* call decides the kind
 * (Snoopy's convention); otherwise the declared kind is used and the text is the rate, weight or delay.
 */
export function classifyRate(
  declared: TransitionKind,
  src: string,
  name = "transition",
  id?: string,
): { kind: TransitionKind; rate: Expr | null; schedule: Expr[] | null } {
  const s = src.trim();
  let e: Expr | null = null;
  if (s) {
    try {
      e = parse(s);
    } catch (err) {
      if (!s.includes(",")) throw new SimulationError(`Rate of ${name}: ${(err as Error).message}`, id);
      e = tryParse(`(${s})`, `Rate of ${name}`, id);
    }
  }
  if (e?.k === "call" && FIRING_FUNCS.has(e.name)) {
    const a = e.args;
    switch (e.name) {
      case "ImmediateFiring":
        return { kind: "immediate", rate: a[0] ?? { k: "num", v: 1 }, schedule: null };
      case "TimedFiring":
        if (!a[0]) throw new SimulationError(`TimedFiring of ${name} needs a delay`, id);
        return { kind: "deterministic", rate: a[0], schedule: null };
      case "FixedTimedFiring_Single":
        if (!a[0]) throw new SimulationError(`FixedTimedFiring_Single of ${name} needs a time`, id);
        return { kind: "scheduled", rate: null, schedule: [a[0]] };
      case "FixedTimedFiring_Periodic":
        if (a.length < 2) throw new SimulationError(`FixedTimedFiring_Periodic of ${name} needs begin, repetition and end`, id);
        return { kind: "scheduled", rate: null, schedule: a.slice(0, 3) };
    }
  }
  switch (declared) {
    case "stochastic":
    case "continuous":
      return { kind: declared, rate: e ?? parse("MassAction(1)"), schedule: null };
    case "immediate":
      return { kind: declared, rate: e ?? { k: "num", v: 1 }, schedule: null };
    case "deterministic":
      return { kind: declared, rate: e ?? { k: "num", v: 1 }, schedule: null };
    case "scheduled": {
      if (!e) throw new SimulationError(`Scheduled transition ${name} needs a time or "begin, repetition, end"`, id);
      return { kind: declared, rate: null, schedule: e.k === "tuple" ? e.items.slice(0, 3) : [e] };
    }
  }
}

/** The crisp value of a fuzzy number at membership 1 (TZN: middle of the core). */
export function peakValue(p: FuzzyParam): number {
  return p.kind === "TFN" ? p.values[1] : (p.values[1] + p.values[2]) / 2;
}

/** The alpha-cut [lower, upper] of a fuzzy number. */
export function alphaCut(p: FuzzyParam, alpha: number): [number, number] {
  const v = p.values;
  if (p.kind === "TFN") return [v[0] + alpha * (v[1] - v[0]), v[2] - alpha * (v[2] - v[1])];
  return [v[0] + alpha * (v[1] - v[0]), v[3] - alpha * (v[3] - v[2])];
}

/**
 * Evaluate constants, static arc weights, schedules and the initial marking for one parameter
 * choice. `fuzzyValues[i]` replaces fuzzy parameter i (peak values when omitted).
 */
export function parameterize(model: SimModel, opts: { fuzzyValues?: number[]; start: number; end: number }): Float64Array {
  const env = model.env;
  const constants = new Map<string, Value>();
  constants.set("_SimStart", opts.start);
  constants.set("_SimEnd", opts.end);
  model.fuzzy.forEach((p, i) => constants.set(p.name, opts.fuzzyValues?.[i] ?? peakValue(p)));
  env.constants = constants;
  env.x = new Float64Array(model.slotCount);
  env.ctx = null;
  for (const c of model.constants) {
    if (!c.expr) throw new SimulationError(`Constant ${c.name}: ${c.error ?? "invalid"}`);
    try {
      constants.set(c.name, evaluate(c.expr, env));
    } catch (e) {
      throw new SimulationError(`Constant ${c.name}: ${(e as Error).message}`);
    }
  }
  for (const t of model.transitions) {
    for (const a of [...t.inputs, ...t.outputs]) {
      if (a.dynamic) continue;
      try {
        a.w = a.expr ? num(evaluate(a.expr, env)) : 0;
      } catch (e) {
        throw new SimulationError(`Arc weight of ${t.name}: ${(e as Error).message}`, t.id);
      }
      if (!(a.w >= 0)) throw new SimulationError(`Arc weight of ${t.name} must not be negative`, t.id);
      if (!model.slotContinuous[a.slot] && !Number.isInteger(a.w) && a.kind !== "reset")
        throw new SimulationError(`Arc weight of ${t.name} at the discrete place ${model.slotPlace[a.slot].name} must be a whole number`, t.id);
    }
    if (t.schedule) {
      const v = t.schedule.map((e) => {
        try {
          return num(evaluate(e, env));
        } catch (err) {
          throw new SimulationError(`Schedule of ${t.name}: ${(err as Error).message}`, t.id);
        }
      });
      t.sched = v.length === 1 ? { begin: v[0], rep: 0, end: v[0] } : { begin: v[0], rep: v[1], end: v[2] ?? opts.end };
    }
  }
  const x = new Float64Array(model.slotCount);
  const done = new Uint8Array(model.slotCount);
  for (const p of model.places) {
    if (done[p.slot]) continue;
    done[p.slot] = 1;
    let m = 0;
    if (p.markingExpr) {
      try {
        m = num(evaluate(p.markingExpr, env));
      } catch (e) {
        throw new SimulationError(`Marking of ${p.name}: ${(e as Error).message}`, p.id);
      }
    }
    if (!(m >= 0)) throw new SimulationError(`Marking of ${p.name} must not be negative`, p.id);
    if (!p.continuous && !Number.isInteger(m)) throw new SimulationError(`Marking of the discrete place ${p.name} must be a whole number`, p.id);
    x[p.slot] = m;
  }
  return x;
}
