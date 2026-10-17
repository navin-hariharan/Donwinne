// Unfolding of coloured nets into uncoloured nets (one place per place and colour,
// one transition per transition and valid binding), as Snoopy does before simulating.

import {
  Arc,
  Binding,
  CArc,
  DOT,
  Expr,
  Multiset,
  Net,
  NetClass,
  Place,
  Transition,
  Value,
  bool,
  compile,
  envFor,
  evaluate,
  identifiers,
  isAmbient,
  isColoured,
  parse,
  parseMarking,
  showValue,
  toMultiset,
  valueKey,
} from "@pns/core";
import { literal, mapExpr, printExpr } from "./exprutil";
import { SimulationError } from "./model";

export interface UnfoldedPlace {
  /** Id of the unfolded place. */
  id: string;
  name: string;
  /** Id and name of the coloured place it came from. */
  placeId: string;
  placeName: string;
  colour: Value;
  /** The colour as text, e.g. "red" or "(1,a)". */
  colourText: string;
}

export interface UnfoldedTransition {
  id: string;
  name: string;
  transitionId: string;
  transitionName: string;
  binding: Binding;
}

export interface UnfoldMapping {
  places: UnfoldedPlace[];
  transitions: UnfoldedTransition[];
}

export interface UnfoldResult {
  net: Net;
  mapping: UnfoldMapping;
}

const UNCOLOURED: Partial<Record<NetClass, NetClass>> = {
  coloured: "xpt",
  colouredStochastic: "stochastic",
  colouredContinuous: "continuous",
  colouredHybrid: "hybrid",
  colouredFuzzyStochastic: "fuzzyStochastic",
  colouredFuzzyContinuous: "fuzzyContinuous",
  colouredFuzzyHybrid: "fuzzyHybrid",
  // Ambient nets unfold to safe P/T nets; APNs keep their inhibitor arcs.
  apn: "xpt",
  tapn: "pt",
};

/** The uncoloured counterpart of a net class (colouredStochastic -> stochastic, ...). */
export function uncolouredClass(c: NetClass): NetClass {
  return UNCOLOURED[c] ?? c;
}

/** A colour as an identifier fragment: red -> red, 3 -> 3, -1 -> m1, (1,a) -> 1_a. */
export function colourIdent(v: Value): string {
  if (Array.isArray(v)) return v.map(colourIdent).join("_");
  return String(showValue(v)).replace(/^-/, "m").replace(/[^A-Za-z0-9_]/g, "_");
}

export interface UnfoldOptions {
  /** Upper bound on the number of bindings examined per transition (default 100000). */
  maxBindings?: number;
}

/**
 * Unfold a coloured net. Every place p with colour set C becomes |C| places named `p_c`
 * (a place over the dot set keeps its name), and every transition becomes one transition per
 * binding of its variables that satisfies the guard, named `t_v1_v2`. Arc inscriptions turn
 * into integer weights; rates get variables replaced by their values, and a coloured place name
 * used in a rate refers to the instances the binding reads from (all instances if none).
 * Uncoloured nets are returned unchanged with an identity mapping.
 */
export function unfold(net: Net, opts: UnfoldOptions = {}): UnfoldResult {
  const maxBindings = opts.maxBindings ?? 100_000;
  if (!isColoured(net.netClass)) {
    return {
      net,
      mapping: {
        places: net.places.filter((p) => !p.coarse).map((p) => ({ id: p.id, name: p.name, placeId: p.id, placeName: p.name, colour: DOT, colourText: DOT })),
        transitions: net.transitions.filter((t) => !t.coarse).map((t) => ({ id: t.id, name: t.name, transitionId: t.id, transitionName: t.name, binding: {} })),
      },
    };
  }
  const cn = compile(net);
  const fatal = cn.problems.filter((p) => p.severity === "error" && !p.message.startsWith("Constant "));
  if (fatal.length) throw new SimulationError(fatal[0].message, fatal[0].elementId);

  const srcPlace = new Map(net.places.map((p) => [p.id, p]));
  const srcTrans = new Map(net.transitions.map((t) => [t.id, t]));
  const places: Place[] = [];
  const mapPlaces: UnfoldedPlace[] = [];
  /** coloured place id -> colour key -> unfolded place */
  const inst = new Map<string, Map<string, Place>>();
  const placeByName = new Map<string, string>();

  for (const cp of cn.places) {
    const p = srcPlace.get(cp.id)!;
    if (!placeByName.has(cp.name)) placeByName.set(cp.name, cp.id);
    const domain = cp.domain ?? [];
    const isDot = domain.length === 1 && domain[0] === DOT;
    let m: Multiset;
    try {
      m = parseMarking(cn, p.marking, cp);
    } catch (e) {
      throw new SimulationError(`Marking of ${p.name}: ${(e as Error).message}`, p.id);
    }
    const byColour = new Map<string, Place>();
    domain.forEach((c, i) => {
      const n = m.count(c);
      const up: Place = {
        id: isDot ? p.id : `${p.id}__${i}`,
        name: isDot ? p.name : `${p.name}_${colourIdent(c)}`,
        x: p.x + (isDot ? 0 : 6 * i),
        y: p.y + (isDot ? 0 : 6 * i),
        marking: n ? String(n) : "",
        // Ambient places hold at most one token per colour unless a capacity is given.
        capacity: p.capacity ?? (isAmbient(net.netClass) ? cp.capacity : undefined),
        logical: p.logical,
        continuous: p.continuous,
        fixed: p.fixed,
      };
      places.push(up);
      byColour.set(valueKey(c), up);
      mapPlaces.push({ id: up.id, name: up.name, placeId: p.id, placeName: p.name, colour: c, colourText: showValue(c) });
    });
    inst.set(cp.id, byColour);
  }

  const variables = new Map(net.declarations.variables.map((v) => [v.name, v.colourSet]));
  const transitions: Transition[] = [];
  const arcs: Arc[] = [];
  const mapTrans: UnfoldedTransition[] = [];
  let arcNo = 0;
  const addArc = (source: string, target: string, kind: Arc["kind"], n: number | "") =>
    arcs.push({ id: `ua${arcNo++}`, source, target, kind, inscription: String(n) });

  for (const ct of cn.transitions) {
    const t = srcTrans.get(ct.id)!;
    let rateExpr: Expr | null = null;
    if (t.rate?.trim()) {
      try {
        rateExpr = parse(t.rate);
      } catch {
        try {
          rateExpr = parse(`(${t.rate})`);
        } catch (e) {
          throw new SimulationError(`Rate of ${t.name}: ${(e as Error).message}`, t.id);
        }
      }
    }
    // Variables: those of arcs and guard, plus any used only in the rate.
    const vars = [...ct.variables];
    if (rateExpr)
      for (const id of identifiers(rateExpr)) {
        const cs = variables.get(id);
        if (cs !== undefined && !vars.some((v) => v.name === id)) vars.push({ name: id, domain: cn.colourSets.get(cs) ?? [] });
      }
    let total = 1;
    for (const v of vars) total *= v.domain.length;
    if (total > maxBindings) throw new SimulationError(`${t.name} has ${total} bindings, more than the limit of ${maxBindings}`, t.id);

    let k = 0;
    for (const b of allBindings(vars)) {
      const env = envFor(cn, b);
      const fail = (what: string, e: unknown) => new SimulationError(`${t.name} ${showBindingText(b)}: ${what}: ${(e as Error).message}`, t.id);
      if (ct.guard) {
        let ok: boolean;
        try {
          ok = bool(evaluate(ct.guard, env));
        } catch (e) {
          throw fail("guard", e);
        }
        if (!ok) continue;
      }
      const ms = (a: CArc): Multiset => {
        if (!a.expr) return new Multiset();
        let v: Value;
        try {
          v = evaluate(a.expr, env);
        } catch (e) {
          throw fail(`arc to ${a.place.name}`, e);
        }
        const d = a.place.domain;
        if (typeof v === "number" && d?.length === 1 && d[0] === DOT) return Multiset.of(DOT, v);
        return toMultiset(v);
      };
      const instOf = (a: CArc, c: Value): Place => {
        const p = inst.get(a.place.id)!.get(valueKey(c));
        if (!p) throw new SimulationError(`${t.name} ${showBindingText(b)}: ${showValue(c)} is not in colour set ${a.place.colourSet} of ${a.place.name}`, t.id);
        return p;
      };
      const id = vars.length ? `${t.id}__${k}` : t.id;
      const name = vars.length ? `${t.name}_${vars.map((v) => colourIdent(b[v.name])).join("_")}` : t.name;
      k++;
      const readFrom = new Map<string, Set<string>>();
      for (const a of ct.inputs) {
        const kind = a.arc.kind;
        if (kind === "reset") {
          for (const p of inst.get(a.place.id)!.values()) addArc(p.id, id, "reset", "");
          continue;
        }
        if (kind === "modifier") {
          // Without an inscription a modifier arc refers to every instance of the place.
          const targets = a.expr ? [...ms(a).entries()].map(([c]) => instOf(a, c)) : [...inst.get(a.place.id)!.values()];
          const s = readFrom.get(a.place.name) ?? new Set<string>();
          for (const p of targets) {
            addArc(p.id, id, "modifier", "");
            s.add(p.name);
          }
          readFrom.set(a.place.name, s);
          continue;
        }
        const m = ms(a);
        if (kind === "equal") {
          for (const [ck, p] of inst.get(a.place.id)!) {
            const c = [...m.entries()].find(([v]) => valueKey(v) === ck);
            addArc(p.id, id, "equal", c ? c[1] : 0);
          }
          for (const [c] of m.entries()) instOf(a, c);
          continue;
        }
        for (const [c, n] of m.entries()) {
          const p = instOf(a, c);
          addArc(p.id, id, kind, n);
          if (kind === "normal" || kind === "read") {
            const s = readFrom.get(a.place.name) ?? new Set<string>();
            s.add(p.name);
            readFrom.set(a.place.name, s);
          }
        }
      }
      for (const a of ct.outputs) for (const [c, n] of ms(a).entries()) addArc(id, instOf(a, c).id, "normal", n);

      let rate: string | undefined;
      if (rateExpr) {
        const sub = mapExpr(rateExpr, (e) => {
          if (e.k !== "id") return undefined;
          if (e.name in b) return literal(b[e.name]);
          const pid = placeByName.get(e.name);
          if (pid === undefined || cn.constants.has(e.name)) return undefined;
          const names = readFrom.get(e.name) ?? new Set([...inst.get(pid)!.values()].map((p) => p.name));
          const list = [...names];
          if (list.length === 1) return { k: "id", name: list[0] };
          return list.reduce<Expr>((acc, n, i) => (i === 0 ? { k: "id", name: n } : { k: "bin", op: "+", l: acc, r: { k: "id", name: n } }), { k: "num", v: 0 });
        });
        rate = printExpr(sub);
      }
      transitions.push({
        id,
        name,
        x: t.x,
        y: t.y + (vars.length ? 6 * (k - 1) : 0),
        kind: t.kind,
        rate,
        interval: t.interval,
        horizontal: t.horizontal,
      });
      mapTrans.push({ id, name, transitionId: t.id, transitionName: t.name, binding: b });
    }
  }

  // Observers name coloured nodes; in the unfolded net they stand for the sum over the instances.
  const instancesByName = new Map<string, string[]>();
  for (const up of mapPlaces) {
    const list = instancesByName.get(`p:${up.placeName}`) ?? [];
    if (!list.includes(up.name)) list.push(up.name);
    instancesByName.set(`p:${up.placeName}`, list);
  }
  for (const ut of mapTrans) instancesByName.set(`t:${ut.transitionName}`, [...(instancesByName.get(`t:${ut.transitionName}`) ?? []), ut.name]);
  for (const t of net.transitions) if (!t.coarse && !instancesByName.has(`t:${t.name}`)) instancesByName.set(`t:${t.name}`, []);
  const observers = (net.declarations.observers ?? []).map((o) => {
    let e: Expr;
    try {
      e = parse(o.expression);
    } catch (err) {
      throw new SimulationError(`Observer ${o.name}: ${(err as Error).message}`);
    }
    const sub = mapExpr(e, (x) => {
      if (x.k !== "id" || cn.constants.has(x.name)) return undefined;
      const list = instancesByName.get(`${o.kind === "place" ? "p" : "t"}:${x.name}`);
      if (!list) return undefined;
      if (!list.length) return { k: "num", v: 0 };
      return list.slice(1).reduce<Expr>((acc, n) => ({ k: "bin", op: "+", l: acc, r: { k: "id", name: n } }), { k: "id", name: list[0] });
    });
    return { ...o, expression: printExpr(sub) };
  });

  const unfolded: Net = {
    format: "pns/1",
    name: `${net.name} (unfolded)`,
    netClass: uncolouredClass(net.netClass),
    places,
    transitions,
    arcs,
    declarations: {
      colourSets: net.declarations.colourSets,
      variables: [],
      constants: net.declarations.constants,
      functions: net.declarations.functions,
      observers,
    },
  };
  return { net: unfolded, mapping: { places: mapPlaces, transitions: mapTrans } };
}

function showBindingText(b: Binding): string {
  const parts = Object.entries(b).map(([k, v]) => `${k}=${showValue(v)}`);
  return parts.length ? `<${parts.join(", ")}>` : "";
}

function* allBindings(vars: { name: string; domain: Value[] }[]): Generator<Binding> {
  if (vars.some((v) => v.domain.length === 0)) return;
  const idx = new Array(vars.length).fill(0);
  while (true) {
    const b: Binding = {};
    vars.forEach((v, i) => (b[v.name] = v.domain[idx[i]]));
    yield b;
    let i = vars.length - 1;
    while (i >= 0 && ++idx[i] === vars[i].domain.length) idx[i--] = 0;
    if (i < 0) return;
  }
}
