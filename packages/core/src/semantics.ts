// Enabling and firing rules for P/T, extended and coloured nets.
//
// Every place holds a multiset. In P/T and extended nets all tokens have the colour "dot",
// so a place with 3 tokens holds 3`dot. This keeps one firing rule for all net classes.

import {
  Arc,
  ArcKind,
  ColourSetDecl,
  ConstantDecl,
  FunctionDecl,
  Net,
  TEST_ARC_KINDS,
  arcKindsFor,
  isAmbient,
  isColoured,
  isContinuousPlace,
  timeBase,
} from "./model";
import {
  BUILTIN_FUNCTIONS,
  EvalEnv,
  Expr,
  ExprError,
  UserFunction,
  Value,
  bool,
  calls,
  evaluate,
  identifiers,
  num,
  parse,
  parseCached,
  showValue,
  toMultiset,
  valueKey,
} from "./expr";
import { Multiset } from "./multiset";
import { AMBIENT_DEFAULT_CAPACITY, ambientCapacity, ambientProblems, complementsOf } from "./ambient";

export const DOT = "dot";

export type Marking = Multiset[];
export type Binding = Record<string, Value>;

export interface Problem {
  severity: "error" | "warning";
  message: string;
  /** The place, transition or arc the problem is about, if any. */
  elementId?: string;
}

export interface CPlace {
  id: string;
  /** Holds a real number (continuous and hybrid nets). */
  continuous?: boolean;
  name: string;
  /** Index into the marking. Logical places with the same name share a slot. */
  slot: number;
  colourSet?: string;
  domain?: Value[];
  capacity?: number;
}

export interface CArc {
  arc: Arc;
  place: CPlace;
  expr: Expr | null;
}

export interface CTransition {
  id: string;
  name: string;
  index: number;
  guard: Expr | null;
  inputs: CArc[];
  outputs: CArc[];
  /** Variables the transition must bind, with their domains. */
  variables: { name: string; domain: Value[] }[];
}

export interface CompiledNet {
  net: Net;
  coloured: boolean;
  /** Modulo nets: token counts live in Z_modulus and every transition is enabled. */
  modulus?: number;
  places: CPlace[];
  slotCount: number;
  /** For each slot, the places that share it (one unless logical). */
  slotPlaces: CPlace[][];
  transitions: CTransition[];
  colourSets: Map<string, Value[]>;
  constants: Map<string, Value>;
  enumValues: Map<string, string>; // value -> colour set
  /** User functions (Declarations.functions) that compiled without errors. */
  functions: Map<string, UserFunction>;
  problems: Problem[];
}

const MAX_DOMAIN = 100_000;

/**
 * The values of a colour set. `sets` holds the domains of the sets declared before it; `env`
 * evaluates subset predicates (constants, functions), the variable `x` being bound to each candidate.
 * Throws ExprError for unknown components, duplicate values and too large domains.
 */
export function colourSetDomain(cs: ColourSetDecl, sets: Map<string, Value[]>, env?: EvalEnv): Value[] {
  const component = (i: number): Value[] => {
    const c = cs.components?.[i];
    if (!c) throw new ExprError(`Colour set ${cs.name} needs a base colour set`);
    const d = sets.get(c);
    if (!d) throw new ExprError(`Unknown colour set "${c}" in ${cs.name}`);
    return d;
  };
  const noDuplicates = (vals: Value[]) => {
    const seen = new Set<string>();
    for (const v of vals) {
      const k = valueKey(v);
      if (seen.has(k)) throw new ExprError(`Colour set ${cs.name} contains ${showValue(v)} more than once`);
      seen.add(k);
    }
    return vals;
  };
  switch (cs.type) {
    case "dot":
      return [DOT];
    case "enum":
      return [...(cs.values ?? [])];
    case "bool":
      return [false, true];
    case "string":
      return noDuplicates([...(cs.values ?? [])]);
    case "int": {
      const lo = cs.min ?? 0;
      const hi = cs.max ?? lo;
      if (hi - lo + 1 > MAX_DOMAIN) throw new ExprError(`Colour set ${cs.name} is too large`);
      const out: Value[] = [];
      for (let i = lo; i <= hi; i++) out.push(i);
      return out;
    }
    case "product": {
      let acc: Value[][] = [[]];
      for (const c of cs.components ?? []) {
        const d = sets.get(c);
        if (!d) throw new ExprError(`Unknown colour set "${c}" in ${cs.name}`);
        const next: Value[][] = [];
        for (const prefix of acc) for (const v of d) next.push([...prefix, v]);
        if (next.length > MAX_DOMAIN) throw new ExprError(`Colour set ${cs.name} is too large`);
        acc = next;
      }
      return acc;
    }
    case "union": {
      // The plain union of the component domains; a value in two components is an error.
      if (!cs.components?.length) throw new ExprError(`Colour set ${cs.name} needs at least one component`);
      const out: Value[] = [];
      cs.components.forEach((_, i) => out.push(...component(i)));
      if (out.length > MAX_DOMAIN) throw new ExprError(`Colour set ${cs.name} is too large`);
      return noDuplicates(out);
    }
    case "alias":
      return [...component(0)];
    case "subset": {
      const base = component(0);
      const src = cs.predicate?.trim();
      if (!src) return [...base];
      let pred: Expr;
      try {
        pred = parseCached(src);
      } catch (e) {
        throw new ExprError(`The predicate of colour set ${cs.name}: ${(e as Error).message}`);
      }
      return base.filter((v) => {
        const local: EvalEnv = {
          lookup: (n) => (n === "x" ? v : env?.lookup(n)),
          call: env?.call ? (n, a) => env.call!(n, a) : undefined,
          functions: env?.functions,
        };
        try {
          return bool(evaluate(pred, local));
        } catch (e) {
          throw new ExprError(`The predicate of colour set ${cs.name}: ${(e as Error).message}`);
        }
      });
    }
  }
}

/** Functions every expression may call besides user functions: math, colour and Snoopy rate functions. */
export const KNOWN_FUNCTIONS: ReadonlySet<string> = new Set<string>([
  ...BUILTIN_FUNCTIONS,
  "all",
  "succ",
  "pred",
  // Snoopy rate functions (evaluated by @pns/sim) and fuzzy numbers.
  "MassAction",
  "BioMassAction",
  "BioLevelInterpretation",
  "MichaelisMenten",
  "ImmediateFiring",
  "TimedFiring",
  "FixedTimedFiring_Single",
  "FixedTimedFiring_Periodic",
  "binomial",
  "TFN",
  "TZN",
]);

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Parse and check user function declarations: names, parameters, bodies, calls of unknown functions,
 * wrong numbers of arguments and (mutual) recursion. Problems are appended to `problems`; functions
 * with errors are left out of the result.
 */
export function compileFunctions(decls: FunctionDecl[] | undefined, problems: Problem[]): Map<string, UserFunction> {
  const out = new Map<string, UserFunction>();
  const bad = new Set<string>();
  for (const f of decls ?? []) {
    const what = `Function ${f.name || "(unnamed)"}`;
    const err = (message: string) => {
      problems.push({ severity: "error", message: `${what}: ${message}` });
      bad.add(f.name);
    };
    if (!IDENT.test(f.name)) {
      err("the name must start with a letter and contain only letters, digits and _");
      continue;
    }
    if (out.has(f.name) || bad.has(f.name)) {
      problems.push({ severity: "error", message: `Function ${f.name} is declared twice` });
      bad.add(f.name);
      out.delete(f.name);
      continue;
    }
    if (KNOWN_FUNCTIONS.has(f.name)) problems.push({ severity: "warning", message: `${what} hides the built-in function of the same name` });
    const params = f.params.map((p) => p.trim());
    const badParam = params.find((p) => !IDENT.test(p));
    if (badParam !== undefined) {
      err(`"${badParam}" is not a valid parameter name`);
      continue;
    }
    const dup = params.find((p, i) => params.indexOf(p) !== i);
    if (dup) {
      err(`the parameter ${dup} appears twice`);
      continue;
    }
    let body: Expr;
    try {
      body = parse(f.body);
    } catch (e) {
      err((e as Error).message);
      continue;
    }
    out.set(f.name, { name: f.name, params, body });
  }
  // Calls inside bodies: unknown functions and arity.
  const declared = new Set((decls ?? []).map((f) => f.name));
  for (const f of [...out.values()]) {
    const issues = callProblems(f.body, out, declared);
    if (issues.length) {
      for (const m of issues) problems.push({ severity: "error", message: `Function ${f.name}: ${m}` });
      out.delete(f.name);
    }
  }
  // Recursion: a cycle in the call graph.
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const cyclic = new Set<string>();
  const visit = (name: string) => {
    state.set(name, 1);
    stack.push(name);
    for (const c of calls(out.get(name)!.body)) {
      if (!out.has(c.name)) continue;
      const st = state.get(c.name);
      if (st === 1) stack.slice(stack.indexOf(c.name)).forEach((n) => cyclic.add(n));
      else if (st === undefined) visit(c.name);
    }
    stack.pop();
    state.set(name, 2);
  };
  for (const name of out.keys()) if (!state.has(name)) visit(name);
  for (const name of cyclic) {
    problems.push({ severity: "error", message: `Function ${name} calls itself, directly or through other functions (recursion is not allowed)` });
    out.delete(name);
  }
  return out;
}

/**
 * Calls of unknown functions and calls of user functions with the wrong number of arguments, as
 * messages. Names in `declared` (user functions that failed to compile) do not count as unknown.
 */
export function callProblems(e: Expr, functions: ReadonlyMap<string, UserFunction>, declared: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  for (const c of calls(e)) {
    const f = functions.get(c.name);
    if (f) {
      if (f.params.length !== c.argc)
        out.push(`${c.name} takes ${f.params.length} argument${f.params.length === 1 ? "" : "s"} but is called with ${c.argc}`);
    } else if (!KNOWN_FUNCTIONS.has(c.name) && !declared.has(c.name)) out.push(`unknown function ${c.name}`);
  }
  return [...new Set(out)];
}

export function compile(fullNet: Net): CompiledNet {
  // Coarse nodes only structure the drawing into subnets; they take no part in firing.
  const coarse = new Set([...fullNet.places, ...fullNet.transitions].filter((n) => n.coarse).map((n) => n.id));
  const net: Net = coarse.size
    ? {
        ...fullNet,
        places: fullNet.places.filter((p) => !p.coarse),
        transitions: fullNet.transitions.filter((t) => !t.coarse),
        arcs: fullNet.arcs.filter((a) => !coarse.has(a.source) && !coarse.has(a.target)),
      }
    : fullNet;
  const problems: Problem[] = [];
  const coloured = isColoured(net.netClass);
  const modulus = net.netClass === "modulo" && net.modulus && net.modulus >= 2 ? net.modulus : undefined;
  const colourSets = new Map<string, Value[]>();
  const enumValues = new Map<string, string>();
  const constants = new Map<string, Value>();
  const functions = compileFunctions(net.declarations.functions, problems);
  const declaredFunctions = new Set((net.declarations.functions ?? []).map((f) => f.name));

  // Constants are evaluated on first use, so that subset predicates may use them and constants may
  // refer to each other in any order. Each constant's problem is reported once.
  const constDecls = new Map<string, ConstantDecl>(net.declarations.constants.map((c) => [c.name, c]));
  const constBusy = new Set<string>();
  const constFailed = new Set<string>();
  const constantValue = (name: string): Value | undefined => {
    const v = constants.get(name);
    if (v !== undefined) return v;
    const c = constDecls.get(name);
    if (!c || constFailed.has(name)) return undefined;
    if (constBusy.has(name)) throw new ExprError(`Constant ${name} is defined in terms of itself`);
    constBusy.add(name);
    try {
      const e = parseCached(c.value);
      const bad = callProblems(e, functions, declaredFunctions);
      if (bad.length) throw new ExprError(bad.join("; "));
      const val = evaluate(e, baseEnv);
      constants.set(name, val);
      return val;
    } catch (e) {
      constFailed.add(name);
      problems.push({ severity: "error", message: `Constant ${c.name}: ${(e as Error).message}` });
      return undefined;
    } finally {
      constBusy.delete(name);
    }
  };
  const baseEnv: EvalEnv = {
    lookup: (name) => constantValue(name) ?? (enumValues.has(name) || colourSets.has(name) ? name : name === DOT ? DOT : undefined),
    call: (name, args) => {
      // Fuzzy numbers in constants: compile only needs a crisp value (the peak); the simulator
      // reads the whole fuzzy number from the declaration itself.
      const up = name;
      if ((up === "TFN" && args.length === 3) || (up === "TZN" && args.length === 4)) {
        const v = args.map((a) => Number(a));
        if (v.some((x) => !Number.isFinite(x))) throw new ExprError(`${up} needs numbers`);
        if (v.some((x, i) => i > 0 && x < v[i - 1])) throw new ExprError(`${up}(${v.join(", ")}): the values must not decrease`);
        return up === "TFN" ? v[1] : (v[1] + v[2]) / 2;
      }
      return colourCall(name, args, colourSets, enumValues);
    },
    functions,
  };

  if (coloured) {
    // Enumeration and string values name themselves; register them first so predicates can use them.
    for (const cs of net.declarations.colourSets)
      if (cs.type === "enum" || cs.type === "string") for (const v of cs.values ?? []) if (!enumValues.has(v)) enumValues.set(v, cs.name);
    for (const cs of net.declarations.colourSets) {
      if (colourSets.has(cs.name)) problems.push({ severity: "error", message: `Colour set "${cs.name}" is declared twice` });
      try {
        colourSets.set(cs.name, colourSetDomain(cs, colourSets, baseEnv));
      } catch (e) {
        problems.push({ severity: "error", message: (e as Error).message });
        colourSets.set(cs.name, []);
      }
    }
  }
  for (const c of net.declarations.constants) constantValue(c.name);

  // Places and logical slots.
  const places: CPlace[] = [];
  const slotByLogicalName = new Map<string, number>();
  const slotPlaces: CPlace[][] = [];
  const names = new Map<string, number>();
  for (const p of net.places) {
    names.set(p.name, (names.get(p.name) ?? 0) + 1);
    let slot: number;
    if (p.logical && slotByLogicalName.has(p.name)) slot = slotByLogicalName.get(p.name)!;
    else {
      slot = slotPlaces.length;
      slotPlaces.push([]);
      if (p.logical) slotByLogicalName.set(p.name, slot);
    }
    const cp: CPlace = {
      id: p.id,
      name: p.name,
      slot,
      // Ambient nets are safe coloured nets: capacity 1 per colour unless given (Konios Sec. 3.2).
      capacity: p.capacity && p.capacity > 0 ? p.capacity : isAmbient(net.netClass) ? AMBIENT_DEFAULT_CAPACITY : undefined,
      continuous: isContinuousPlace(net, p) || undefined,
    };
    if (coloured) {
      cp.colourSet = p.colourSet || "Dot";
      cp.domain = colourSets.get(cp.colourSet);
      if (!cp.domain) {
        problems.push({ severity: "error", message: `Place ${p.name} uses unknown colour set "${cp.colourSet}"`, elementId: p.id });
        cp.domain = [];
      }
    }
    slotPlaces[slot].push(cp);
    places.push(cp);
  }
  for (const p of net.places) {
    if ((names.get(p.name) ?? 0) > 1 && !p.logical)
      problems.push({ severity: "warning", message: `More than one place is named ${p.name}`, elementId: p.id });
  }
  const tnames = new Set<string>();
  for (const t of net.transitions) {
    if (tnames.has(t.name)) problems.push({ severity: "warning", message: `More than one transition is named ${t.name}`, elementId: t.id });
    tnames.add(t.name);
  }

  const variables = new Map(net.declarations.variables.map((v) => [v.name, v.colourSet]));
  for (const v of net.declarations.variables)
    if (!colourSets.has(v.colourSet))
      problems.push({ severity: "error", message: `Variable ${v.name} uses unknown colour set "${v.colourSet}"` });

  const placeById = new Map(places.map((p) => [p.id, p]));
  const transitions: CTransition[] = net.transitions.map((t, index) => ({
    id: t.id,
    name: t.name,
    index,
    guard: null,
    inputs: [],
    outputs: [],
    variables: [],
  }));
  const tById = new Map(transitions.map((t) => [t.id, t]));

  const parseOrReport = (src: string, what: string, elementId: string): Expr | null => {
    try {
      const e = parseCached(src);
      for (const m of callProblems(e, functions, declaredFunctions)) problems.push({ severity: "error", message: `${what}: ${m}`, elementId });
      return e;
    } catch (e) {
      problems.push({ severity: "error", message: `${what}: ${(e as Error).message}`, elementId });
      return null;
    }
  };

  const nodeName = (id: string) => net.places.find((p) => p.id === id)?.name ?? net.transitions.find((t) => t.id === id)?.name ?? id;
  const seenPairs = new Map<string, ArcKind[]>();
  for (const a of net.arcs) {
    const sp = placeById.get(a.source);
    const st = tById.get(a.source);
    const tp = placeById.get(a.target);
    const tt = tById.get(a.target);
    // Messages name the arc by its ends, as the user sees them; the id stays in elementId.
    const arcName = `Arc ${(sp ?? st)?.name ?? nodeName(a.source)} → ${(tp ?? tt)?.name ?? nodeName(a.target)}`;
    if (!((sp && tt) || (st && tp))) {
      problems.push({ severity: "error", message: `${arcName} must connect a place and a transition`, elementId: a.id });
      continue;
    }
    if (st && a.kind !== "normal") {
      problems.push({ severity: "error", message: `${arcName}: ${/^[aeiou]/.test(a.kind) ? "an" : "a"} ${a.kind} arc must go from a place to a transition`, elementId: a.id });
      continue;
    }
    if (a.kind !== "normal" && net.netClass === "pt") {
      problems.push({ severity: "warning", message: `${arcName}: ${a.kind} arcs belong to extended nets; switch the net class to use them`, elementId: a.id });
    } else if (a.kind === "modifier" && !arcKindsFor(net.netClass).includes("modifier")) {
      problems.push({
        severity: "warning",
        message: `${arcName}: modifier arcs belong to stochastic, continuous and hybrid nets; here they have no effect`,
        elementId: a.id,
      });
    }
    const pairKey = `${a.source}>${a.target}`;
    const kinds = seenPairs.get(pairKey) ?? [];
    if (kinds.includes(a.kind)) problems.push({ severity: "warning", message: `${arcName}: another arc of the same kind joins the same nodes`, elementId: a.id });
    seenPairs.set(pairKey, [...kinds, a.kind]);

    // Modifier arcs neither test nor change the marking; an inscription only selects colours (unfolding).
    const insc = a.inscription.trim() || (a.kind === "reset" || a.kind === "modifier" ? "" : "1");
    let expr: Expr | null = null;
    if (insc) expr = parseOrReport(insc, arcName, a.id);
    // A constant weight must be a whole number of at least 1 (marking-dependent weights are checked when firing).
    if (expr && !coloured && a.kind !== "reset" && a.kind !== "modifier") {
      let w: Value | undefined;
      try {
        w = evaluate(expr, baseEnv);
      } catch {
        /* depends on the marking */
      }
      if (typeof w === "number") {
        const cont = !!(sp ?? tp)?.continuous;
        if (w < 0) problems.push({ severity: "error", message: `${arcName}: the weight ${w} is negative`, elementId: a.id });
        else if (w === 0) problems.push({ severity: "warning", message: `${arcName}: weight 0 has no effect`, elementId: a.id });
        else if (!cont && !Number.isInteger(w) && net.netClass !== "freestyle")
          problems.push({ severity: "error", message: `${arcName}: arc weights move whole tokens; ${w} is not a whole number`, elementId: a.id });
      }
    }
    if (sp && tt) tt.inputs.push({ arc: a, place: sp, expr });
    else if (st && tp) st.outputs.push({ arc: a, place: tp, expr });
  }

  for (const t of net.transitions) {
    const ct = tById.get(t.id)!;
    if (coloured && t.guard?.trim()) ct.guard = parseOrReport(t.guard, `Guard of ${t.name}`, t.id);
    if (!coloured) continue;
    const used = new Set<string>();
    for (const a of [...ct.inputs, ...ct.outputs]) if (a.expr) identifiers(a.expr, used);
    if (ct.guard) identifiers(ct.guard, used);
    for (const name of used) {
      const cs = variables.get(name);
      if (cs !== undefined) ct.variables.push({ name, domain: colourSets.get(cs) ?? [] });
    }
    // Output-only variables cannot be bound from tokens; they range over their whole domain,
    // which Snoopy also allows. Nothing to report.
  }

  // Rates are evaluated by the simulator; unknown functions there are only warnings here.
  if (timeBase(net.netClass)) {
    for (const t of net.transitions) {
      const src = t.rate?.trim();
      if (!src) continue;
      let e: Expr | null = null;
      try {
        e = parseCached(src);
      } catch {
        try {
          e = parseCached(`(${src})`);
        } catch {
          // Reported by the simulator.
        }
      }
      if (!e) continue;
      for (const m of callProblems(e, functions, declaredFunctions))
        problems.push({ severity: /^unknown/.test(m) ? "warning" : "error", message: `Rate of ${t.name}: ${m}`, elementId: t.id });
    }
  } else {
    for (const p of net.places)
      if (p.fixed) problems.push({ severity: "warning", message: `Fixed places only take effect in simulations of quantitative nets`, elementId: p.id });
  }

  checkObservers(net, functions, declaredFunctions, problems);

  // Initial markings.
  const cn: CompiledNet = {
    net,
    coloured,
    modulus,
    places,
    slotCount: slotPlaces.length,
    slotPlaces,
    transitions,
    colourSets,
    constants,
    enumValues,
    functions,
    problems,
  };
  const ambient = isAmbient(net.netClass);
  const special = ambient && net.netClass === "tapn" ? complementsOf(net.declarations.colourSets, colourSets).inverse : new Map();
  for (const p of net.places) {
    try {
      const m = parseMarking(cn, p.marking, placeById.get(p.id)!);
      const cp = placeById.get(p.id)!;
      if (ambient) {
        // Konios: M0 ≤ K, per structured place (p, c); complementary colours have capacity 1.
        for (const [c, n] of m.entries()) {
          const k = ambientCapacity(p.capacity, special.has(valueKey(c)));
          if (n > k)
            problems.push({
              severity: "error",
              message: `Place ${p.name} holds ${n} tokens of colour ${showValue(c)}, but its capacity is ${k} per colour`,
              elementId: p.id,
            });
        }
      } else if (cp.capacity !== undefined && exceedsCapacity(m, cp.capacity))
        problems.push({ severity: "error", message: `The initial marking of ${p.name} exceeds its capacity`, elementId: p.id });
    } catch (e) {
      problems.push({ severity: "error", message: `Marking of ${p.name}: ${(e as Error).message}`, elementId: p.id });
    }
  }
  if (ambient) problems.push(...ambientProblems(net, cn));
  return cn;
}

/** Observers: unique names, valid expressions over place names (place observers) or transition names. */
function checkObservers(net: Net, functions: Map<string, UserFunction>, declared: Set<string>, problems: Problem[]) {
  const obs = net.declarations.observers ?? [];
  if (!obs.length) return;
  const placeNames = new Set(net.places.map((p) => p.name));
  const transNames = new Set(net.transitions.map((t) => t.name));
  const constNames = new Set(net.declarations.constants.map((c) => c.name));
  const seen = new Set<string>();
  for (const o of obs) {
    const what = `Observer ${o.name || "(unnamed)"}`;
    if (!IDENT.test(o.name)) problems.push({ severity: "error", message: `${what}: the name must start with a letter and contain only letters, digits and _` });
    else if (seen.has(o.name)) problems.push({ severity: "error", message: `Observer ${o.name} is declared twice` });
    seen.add(o.name);
    if (o.kind !== "place" && o.kind !== "transition") {
      problems.push({ severity: "error", message: `${what}: the kind must be "place" or "transition"` });
      continue;
    }
    let e: Expr;
    try {
      e = parseCached(o.expression);
    } catch (err) {
      problems.push({ severity: "error", message: `${what}: ${(err as Error).message}` });
      continue;
    }
    for (const m of callProblems(e, functions, declared)) problems.push({ severity: "error", message: `${what}: ${m}` });
    const allowed = o.kind === "place" ? placeNames : transNames;
    for (const id of identifiers(e))
      if (!allowed.has(id) && !constNames.has(id))
        problems.push({
          severity: "error",
          message: `${what}: "${id}" is not a ${o.kind === "place" ? "place" : "transition"} or constant${
            o.kind === "place" && transNames.has(id) ? " (transitions belong in transition observers)" : ""
          }${o.kind === "transition" && placeNames.has(id) ? " (places belong in place observers)" : ""}`,
        });
  }
}

function colourCall(name: string, args: Value[], sets: Map<string, Value[]>, enums: Map<string, string>): Value | undefined {
  if (name === "all") {
    const csName = args[0];
    const d = typeof csName === "string" ? sets.get(csName) : undefined;
    if (!d) throw new ExprError("all() needs a colour set name");
    return new Multiset(d.map((v) => [v, 1]));
  }
  if (name === "succ" || name === "pred") {
    const v = args[0];
    const step = name === "succ" ? 1 : -1;
    if (typeof v === "string" && enums.has(v)) {
      const d = sets.get(enums.get(v)!)!;
      const i = d.indexOf(v);
      return d[(i + step + d.length) % d.length];
    }
    return num(v) + step;
  }
  return undefined;
}

/** Environment for evaluating an expression under a binding at a marking. */
export function envFor(cn: CompiledNet, binding: Binding, marking?: Marking): EvalEnv {
  const placesByName = new Map(cn.places.map((p) => [p.name, p]));
  return {
    lookup(name) {
      if (name in binding) return binding[name];
      const c = cn.constants.get(name);
      if (c !== undefined) return c;
      if (cn.enumValues.has(name)) return name;
      if (name === DOT) return DOT;
      if (marking) {
        const p = placesByName.get(name);
        if (p) {
          const m = marking[p.slot];
          return cn.coloured ? m : m.size;
        }
      }
      // Colour set names evaluate to themselves so all(ColourSet) works.
      if (cn.colourSets.has(name)) return name;
      return undefined;
    },
    call: (name, args) => colourCall(name, args, cn.colourSets, cn.enumValues),
    functions: cn.functions,
  };
}

/** Evaluate an arc inscription to the multiset it moves. */
function arcMultiset(cn: CompiledNet, a: CArc, binding: Binding, marking: Marking): Multiset {
  if (!a.expr) return new Multiset();
  const v = evaluate(a.expr, envFor(cn, binding, marking));
  if (!cn.coloured) {
    const n = num(v);
    if (n < 0 || !Number.isFinite(n) || (!a.place.continuous && !Number.isInteger(n)))
      throw new ExprError(`Arc weight must be a whole number, got ${n}`);
    return Multiset.of(DOT, n);
  }
  return dotAware(v, a.place);
}

/** On a place whose colour set is just {dot}, a plain number n means n`dot. */
function dotAware(v: Value, place: CPlace): Multiset {
  if (typeof v === "number" && place.domain?.length === 1 && place.domain[0] === DOT) {
    if (!Number.isInteger(v) || v < 0) throw new ExprError("Token count must be a whole number");
    return Multiset.of(DOT, v);
  }
  return toMultiset(v);
}

export function parseMarking(cn: CompiledNet, src: string, place: CPlace): Multiset {
  const s = src.trim();
  if (!s) return new Multiset();
  const v = evaluate(parseCached(s), envFor(cn, {}));
  if (!cn.coloured) {
    const n = num(v);
    if (n < 0 || !Number.isFinite(n) || (!place.continuous && !Number.isInteger(n)))
      throw new ExprError(place.continuous ? "Marking must be a number of zero or more" : "Marking must be a whole number");
    return Multiset.of(DOT, n);
  }
  const m = dotAware(v, place);
  if (place.domain) {
    const keys = new Set(place.domain.map(valueKey));
    for (const [c] of m.entries())
      if (!keys.has(valueKey(c))) throw new ExprError(`${showValue(c)} is not in colour set ${place.colourSet}`);
  }
  return m;
}

function exceedsCapacity(m: Multiset, capacity: number): boolean {
  // P/T: total tokens. Coloured: tokens per colour.
  for (const [, n] of m.entries()) if (n > capacity) return true;
  return false;
}

export function initialMarking(cn: CompiledNet): Marking {
  const m: Marking = Array.from({ length: cn.slotCount }, () => new Multiset());
  const filled = new Set<number>();
  for (const p of cn.places) {
    if (filled.has(p.slot)) continue;
    const src = cn.net.places.find((x) => x.id === p.id)!.marking;
    try {
      m[p.slot] = parseMarking(cn, src, p);
      filled.add(p.slot);
    } catch {
      // Reported by compile().
    }
  }
  return m;
}

export interface Firing {
  transition: number;
  binding: Binding;
}

/** Result of checking one binding. */
interface Effect {
  consume: Map<number, Multiset>;
  produce: Map<number, Multiset>;
  reset: Set<number>;
}

function addTo(map: Map<number, Multiset>, slot: number, ms: Multiset) {
  map.set(slot, (map.get(slot) ?? new Multiset()).plus(ms));
}

/**
 * Check the enabling conditions of a binding and work out its effect.
 * Returns null if the binding is not enabled. Throws on evaluation errors.
 */
function effectOf(cn: CompiledNet, t: CTransition, binding: Binding, M: Marking): Effect | null {
  if (t.guard && !bool(evaluate(t.guard, envFor(cn, binding, M)))) return null;
  const eff: Effect = { consume: new Map(), produce: new Map(), reset: new Set() };
  const need = new Map<number, Multiset>();
  for (const a of t.inputs) {
    const slot = a.place.slot;
    const have = M[slot];
    if (a.arc.kind === "reset") {
      eff.reset.add(slot);
      continue;
    }
    if (a.arc.kind === "modifier") continue;
    const ms = arcMultiset(cn, a, binding, M);
    switch (a.arc.kind) {
      case "normal":
        addTo(eff.consume, slot, ms);
        addTo(need, slot, ms);
        break;
      case "read":
        if (!ms.leq(have)) return null;
        break;
      case "inhibitor":
        // Blocked if, for some colour c on the arc, the place holds at least that many c tokens.
        // With an empty inscription the arc has no effect.
        for (const [c, n] of ms.entries()) if (have.count(c) >= n) return null;
        break;
      case "equal":
        if (cn.coloured ? !have.equals(ms) : have.size !== ms.size) return null;
        break;
    }
  }
  if (!cn.modulus) for (const [slot, ms] of need) if (!ms.leq(M[slot])) return null;
  for (const a of t.outputs) {
    const ms = arcMultiset(cn, a, binding, M);
    if (cn.coloured && a.place.domain) {
      const keys = new Set(a.place.domain.map(valueKey));
      for (const [c] of ms.entries())
        if (!keys.has(valueKey(c))) throw new ExprError(`${t.name} would put ${showValue(c)} into ${a.place.name}, which is not in ${a.place.colourSet}`);
    }
    addTo(eff.produce, a.place.slot, ms);
  }
  if (cn.modulus) return eff;
  // Capacity check on the resulting marking.
  const next = apply(M, eff);
  for (const slot of eff.produce.keys()) {
    for (const p of cn.slotPlaces[slot]) {
      if (p.capacity === undefined) continue;
      const m = next[slot];
      if (cn.coloured ? exceedsCapacity(m, p.capacity) : m.size > p.capacity) return null;
    }
  }
  return eff;
}

function apply(M: Marking, eff: Effect): Marking {
  const next = M.slice();
  for (const [slot, ms] of eff.consume) next[slot] = next[slot].minus(ms);
  for (const slot of eff.reset) next[slot] = new Multiset();
  for (const [slot, ms] of eff.produce) next[slot] = next[slot].plus(ms);
  return next;
}

/** Candidate values for each variable, pruned by the tokens available on simple input arcs. */
function candidates(cn: CompiledNet, t: CTransition, M: Marking): { name: string; values: Value[] }[] {
  return t.variables.map(({ name, domain }) => {
    let values = domain;
    for (const a of t.inputs) {
      if (a.arc.kind !== "normal" && a.arc.kind !== "read") continue;
      const e = a.expr;
      const isVar =
        (e?.k === "id" && e.name === name) || (e?.k === "bin" && e.op === "`" && e.r.k === "id" && e.r.name === name);
      if (!isVar) continue;
      const present = new Set(M[a.place.slot].entries().map(([c]) => valueKey(c)));
      values = values.filter((v) => present.has(valueKey(v)));
    }
    return { name, values };
  });
}

function* bindings(vars: { name: string; values: Value[] }[]): Generator<Binding> {
  const n = vars.length;
  if (n === 0) {
    yield {};
    return;
  }
  if (vars.some((v) => v.values.length === 0)) return;
  const idx = new Array(n).fill(0);
  while (true) {
    const b: Binding = {};
    for (let i = 0; i < n; i++) b[vars[i].name] = vars[i].values[idx[i]];
    yield b;
    let i = n - 1;
    while (i >= 0 && ++idx[i] === vars[i].values.length) idx[i--] = 0;
    if (i < 0) return;
  }
}

const MAX_BINDINGS = 10_000;

export interface EnabledResult {
  bindings: Binding[];
  error?: string;
}

/** All enabled bindings of a transition at marking M. */
export function enabledBindings(cn: CompiledNet, tIndex: number, M: Marking): EnabledResult {
  const t = cn.transitions[tIndex];
  const out: Binding[] = [];
  try {
    let tried = 0;
    for (const b of bindings(candidates(cn, t, M))) {
      if (++tried > MAX_BINDINGS) return { bindings: out, error: "Too many bindings to check; showing the first ones" };
      if (effectOf(cn, t, b, M)) out.push(b);
    }
  } catch (e) {
    return { bindings: out, error: (e as Error).message };
  }
  return { bindings: out };
}

/**
 * Why a transition is not enabled at M, in words a student can act on, e.g. "buffer has 0 tokens,
 * needs 1". Empty when it is enabled. For transitions with variables the reasons are given for the
 * binding that came closest when there are few bindings, or summarised otherwise.
 */
export function disabledReasons(cn: CompiledNet, tIndex: number, M: Marking): string[] {
  const t = cn.transitions[tIndex];
  try {
    if (enabledBindings(cn, tIndex, M).bindings.length) return [];
    const show = (m: Multiset) => (cn.coloured ? m.toString() : String(m.size));
    const tokens = (n: number) => `${n} token${n === 1 ? "" : "s"}`;
    const reasonsFor = (binding: Binding): string[] => {
      const out: string[] = [];
      if (t.guard && !bool(evaluate(t.guard, envFor(cn, binding, M)))) out.push("its guard is false");
      const need = new Map<number, { place: CPlace; ms: Multiset }>();
      for (const a of t.inputs) {
        const have = M[a.place.slot];
        if (a.arc.kind === "reset" || a.arc.kind === "modifier") continue;
        const ms = arcMultiset(cn, a, binding, M);
        if (a.arc.kind === "normal") {
          const prev = need.get(a.place.slot);
          need.set(a.place.slot, { place: a.place, ms: prev ? prev.ms.plus(ms) : ms });
        } else if (a.arc.kind === "read" && !ms.leq(have)) out.push(`${a.place.name} has ${cn.coloured ? show(have) || "no tokens" : tokens(have.size)}, the read arc needs ${show(ms)}`);
        else if (a.arc.kind === "inhibitor") {
          for (const [c, n] of ms.entries())
            if (have.count(c) >= n) {
              out.push(`the inhibitor arc from ${a.place.name} blocks it: ${a.place.name} has ${cn.coloured ? `${have.count(c)} of ${showValue(c)}` : tokens(have.size)}, it must have fewer than ${n}`);
              break;
            }
        } else if (a.arc.kind === "equal" && (cn.coloured ? !have.equals(ms) : have.size !== ms.size))
          out.push(`${a.place.name} has ${cn.coloured ? show(have) || "no tokens" : tokens(have.size)}, the equal arc needs exactly ${show(ms)}`);
      }
      if (!cn.modulus)
        for (const { place, ms } of need.values()) {
          const have = M[place.slot];
          if (!ms.leq(have)) out.push(`${place.name} has ${cn.coloured ? show(have) || "no tokens" : tokens(have.size)}, needs ${cn.coloured ? show(ms) : ms.size}`);
        }
      if (!out.length && !cn.modulus) {
        // Every input condition holds, so firing must overfill a place with a capacity.
        const next = M.slice();
        for (const { place, ms } of need.values()) next[place.slot] = next[place.slot].minus(ms);
        for (const a of t.inputs) if (a.arc.kind === "reset") next[a.place.slot] = new Multiset();
        for (const a of t.outputs) next[a.place.slot] = next[a.place.slot].plus(arcMultiset(cn, a, binding, M));
        for (const a of t.outputs)
          for (const p of cn.slotPlaces[a.place.slot]) {
            const m = next[p.slot];
            if (p.capacity !== undefined && (cn.coloured ? exceedsCapacity(m, p.capacity) : m.size > p.capacity) && !out.some((r) => r.includes(` ${p.name} `)))
              out.push(`firing would put ${cn.coloured ? m.toString() : tokens(m.size)} on ${p.name}, over its capacity of ${p.capacity}`);
          }
      }
      return out;
    };
    if (!t.variables.length) return reasonsFor({});
    const cands = candidates(cn, t, M);
    const empty = cands.filter((v) => !v.values.length).map((v) => v.name);
    if (empty.length) return [`no tokens on its input places give a value for ${empty.join(", ")}`];
    const all = [...bindings(cands)];
    if (all.length === 1) return reasonsFor(all[0]);
    return [`none of its ${all.length} bindings satisfies the guard and the arcs`];
  } catch (e) {
    return [(e as Error).message];
  }
}

export function isEnabled(cn: CompiledNet, tIndex: number, M: Marking): boolean {
  return enabledBindings(cn, tIndex, M).bindings.length > 0;
}

/** Fire one transition under a binding. Throws if it is not enabled. */
export function fire(cn: CompiledNet, tIndex: number, binding: Binding, M: Marking): Marking {
  const t = cn.transitions[tIndex];
  const eff = effectOf(cn, t, binding, M);
  if (!eff) throw new Error(`${t.name} is not enabled`);
  return cn.modulus ? applyModulo(M, eff, cn.modulus) : apply(M, eff);
}

function applyModulo(M: Marking, eff: Effect, m: number): Marking {
  const next = M.slice();
  const mod = (n: number) => ((n % m) + m) % m;
  const slots = new Set([...eff.consume.keys(), ...eff.produce.keys(), ...eff.reset]);
  for (const slot of slots) {
    let n = eff.reset.has(slot) ? 0 : M[slot].size - (eff.consume.get(slot)?.size ?? 0);
    n += eff.produce.get(slot)?.size ?? 0;
    next[slot] = Multiset.of(DOT, mod(n));
  }
  return next;
}

export function showBinding(b: Binding): string {
  const parts = Object.entries(b).map(([k, v]) => `${k}=${showValue(v)}`);
  return parts.length ? `<${parts.join(", ")}>` : "";
}

/** Short display form of a place's tokens: a count for P/T, a multiset for coloured nets. */
export function showTokens(cn: CompiledNet, m: Multiset): string {
  return cn.coloured ? m.toString() : String(m.size);
}

/** Marking as editable text (P/T count or coloured multiset expression). */
export function markingText(cn: CompiledNet, m: Multiset): string {
  return cn.coloured ? m.toString() : m.size === 0 ? "" : String(m.size);
}

export function markingKey(M: Marking): string {
  return M.map((m) => m.toString()).join("|");
}

export { TEST_ARC_KINDS };
