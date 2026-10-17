// SBML Level 2 Version 4 (https://sbml.org): one compartment; places become species, constants
// parameters, transitions reactions (input places reactants, output places products, read and modifier
// arcs modifiers). Rates become kinetic laws in MathML; MassAction(k) expands to k * P1^w1 * P2^w2 ...
// Hybrid nets lose the discrete/continuous distinction (SBML has none). Fixed places become boundary
// species (no reaction changes them). User functions become function definitions when their bodies
// only use their parameters, else they are expanded in place. Observers of quantitative nets become
// non-constant parameters with assignment rules; a transition name in a transition observer stands
// for that reaction's kinetic law.

import { Expr, Net, UserFunction, identifiers, inlineFunctions, timeBase } from "@pns/core";
import { ExportError, Names, arcsOf, assignNames, evalNumber, parseExpr, requireArcKinds, requireClass, sanitize, userFunctions, weightOf } from "./text-common";
import { XmlEl, el, renderXml, textEl } from "./xml";

const MATHML = "http://www.w3.org/1998/Math/MathML";

interface MathCtx {
  names: Names;
  consumed: Map<string, number>;
  /** Function parameters in scope (inside a function definition). */
  bound?: Set<string>;
  /** User functions written as function definitions (called with <ci>). */
  defined: Map<string, UserFunction>;
  /** Transition observers: transition name -> its kinetic law. */
  laws?: Map<string, XmlEl>;
}

export function exportSbml(net: Net): string {
  requireClass(net, "SBML", ["pt", "xpt", "stochastic", "continuous", "hybrid"]);
  requireArcKinds(net, "SBML", ["normal", "read", "modifier"]);
  const odd = net.transitions.find((t) => !t.coarse && t.kind && t.kind !== "stochastic" && t.kind !== "continuous");
  if (odd) throw new ExportError(`SBML reactions have kinetic laws only; the ${odd.kind} transition "${odd.name}" cannot be exported.`);
  const names = assignNames(net);
  const quantitative = !!timeBase(net.netClass);

  // Function definitions need closed bodies (only parameters) without Snoopy rate functions.
  const fns = userFunctions(net);
  const closed = [...fns.values()].every(
    (f) => [...identifiers(f.body)].every((id) => f.params.includes(id)) && !/\bMassAction\s*\(/.test(printableBody(net, f.name)),
  );
  const defined = closed ? fns : new Map<string, UserFunction>();
  const prepare = (src: string, what: string): Expr => {
    const e = parseExpr(src, what);
    if (closed) return e;
    try {
      return inlineFunctions(e, fns);
    } catch (err) {
      throw new ExportError(`${what} "${src}": ${(err as Error).message}`);
    }
  };

  const species = names.places.map((p) => {
    const id = names.place.get(p.id)!;
    return el("species", {
      id,
      name: p.name || id,
      compartment: "compartment",
      initialAmount: String(evalNumber(net, p.marking, `The marking of "${p.name}"`)),
      hasOnlySubstanceUnits: "true",
      boundaryCondition: p.fixed ? "true" : undefined,
    });
  });
  const params = net.declarations.constants.map((c) =>
    el("parameter", { id: names.constant.get(c.name)!, name: c.name, value: String(evalNumber(net, c.value, `The constant "${c.name}"`)), constant: "true" }),
  );
  const functionDefs = [...defined.values()].map((f) =>
    el("functionDefinition", { id: f.name }, [
      el("math", { xmlns: MATHML }, [
        el("lambda", {}, [
          ...f.params.map((p) => el("bvar", {}, [textEl("ci", ` ${p} `)])),
          toMathml(f.body, { names, consumed: new Map(), bound: new Set(f.params), defined }),
        ]),
      ]),
    ]),
  );
  const arcs = arcsOf(net, names, { modifiers: true });
  const laws = new Map<string, XmlEl>();
  const reactions = names.transitions.map((t) => {
    const { pre, post } = arcs.get(t.id)!;
    const ref = (place: string, a: (typeof pre)[number]["arc"]) =>
      el("speciesReference", { species: place, stoichiometry: String(evalNumber(net, weightOf(a), `The weight of an arc of "${t.name}"`)) });
    const reactants = pre.filter((e) => e.arc.kind === "normal");
    const modifiers = [...new Set(pre.filter((e) => e.arc.kind === "read" || e.arc.kind === "modifier").map((e) => e.place))];
    const consumed = new Map<string, number>();
    for (const e of reactants) consumed.set(e.place, (consumed.get(e.place) ?? 0) + evalNumber(net, weightOf(e.arc), "An arc weight"));
    let law: XmlEl | undefined;
    if (quantitative) {
      const rate = prepare(t.rate?.trim() || "MassAction(1)", `The rate of "${t.name}"`);
      const math = toMathml(rate, { names, consumed, defined });
      if (t.name) laws.set(t.name, math);
      law = el("kineticLaw", {}, [el("math", { xmlns: MATHML }, [math])]);
    }
    return el("reaction", { id: names.transition.get(t.id)!, name: t.name || names.transition.get(t.id)!, reversible: "false" }, [
      reactants.length > 0 && el("listOfReactants", {}, reactants.map((e) => ref(e.place, e.arc))),
      post.length > 0 && el("listOfProducts", {}, post.map((e) => ref(e.place, e.arc))),
      modifiers.length > 0 && el("listOfModifiers", {}, modifiers.map((p) => el("modifierSpeciesReference", { species: p }))),
      law,
    ]);
  });

  // Observers: assignment rules (quantitative nets only; otherwise there is nothing to observe).
  const taken = new Set([...names.place.values(), ...names.transition.values(), ...names.constant.values(), "compartment"]);
  const observerParams: XmlEl[] = [];
  const rules: XmlEl[] = [];
  if (quantitative)
    for (const o of net.declarations.observers ?? []) {
      let id = sanitize(o.name, "observer");
      while (taken.has(id)) id += "_";
      taken.add(id);
      const e = prepare(o.expression, `The observer "${o.name}"`);
      const ctx: MathCtx =
        o.kind === "transition" ? { names, consumed: new Map(), defined, laws } : { names, consumed: new Map(), defined };
      observerParams.push(el("parameter", { id, name: o.name, constant: "false" }));
      rules.push(el("assignmentRule", { variable: id }, [el("math", { xmlns: MATHML }, [toMathml(e, ctx)])]));
    }

  const id = sanitize(net.name, "model");
  return renderXml(
    el("sbml", { xmlns: "http://www.sbml.org/sbml/level2/version4", level: "2", version: "4" }, [
      el("model", { id, name: net.name }, [
        functionDefs.length > 0 && el("listOfFunctionDefinitions", {}, functionDefs),
        el("listOfCompartments", {}, [el("compartment", { id: "compartment", size: "1" })]),
        species.length > 0 && el("listOfSpecies", {}, species),
        params.length + observerParams.length > 0 && el("listOfParameters", {}, [...params, ...observerParams]),
        rules.length > 0 && el("listOfRules", {}, rules),
        reactions.length > 0 && el("listOfReactions", {}, reactions),
      ]),
    ]),
  );
}

function printableBody(net: Net, name: string): string {
  return net.declarations.functions?.find((f) => f.name === name)?.body ?? "";
}

const BIN: Record<string, string> = {
  "+": "plus",
  "-": "minus",
  "*": "times",
  "/": "divide",
  "^": "power",
  "%": "rem",
  "=": "eq",
  "<>": "neq",
  "<": "lt",
  "<=": "leq",
  ">": "gt",
  ">=": "geq",
  and: "and",
  or: "or",
};
const FUN: Record<string, string> = {
  abs: "abs",
  exp: "exp",
  log: "ln",
  ln: "ln",
  sqrt: "root",
  floor: "floor",
  ceil: "ceiling",
  pow: "power",
  sin: "sin",
  cos: "cos",
  tan: "tan",
  asin: "arcsin",
  acos: "arccos",
  atan: "arctan",
  sinh: "sinh",
  cosh: "cosh",
  tanh: "tanh",
};

function apply(op: string, args: XmlEl[]): XmlEl {
  return el("apply", {}, [el(op), ...args]);
}

function toMathml(e: Expr, ctx: MathCtx): XmlEl {
  const m = (x: Expr) => toMathml(x, ctx);
  switch (e.k) {
    case "num":
      return textEl("cn", String(e.v));
    case "bool":
      return el(e.v ? "true" : "false");
    case "id": {
      if (ctx.bound?.has(e.name)) return textEl("ci", ` ${e.name} `);
      const law = ctx.laws?.get(e.name);
      if (law) return law;
      const id = ctx.names.byName.get(e.name);
      if (!id) throw new ExportError(`The rate uses "${e.name}", which is neither a place nor a constant.`);
      return textEl("ci", ` ${id} `);
    }
    case "un":
      return apply(e.op === "not" ? "not" : "minus", [m(e.e)]);
    case "bin": {
      const op = BIN[e.op];
      if (!op) throw new ExportError(`SBML cannot express the operator "${e.op}" in a rate.`);
      return apply(op, [m(e.l), m(e.r)]);
    }
    case "call": {
      if (e.name === "MassAction") {
        if (e.args.length !== 1) throw new ExportError("MassAction takes exactly one argument.");
        const factors = [m(e.args[0])];
        for (const [p, w] of ctx.consumed) {
          if (w === 0) continue;
          const ci = textEl("ci", ` ${p} `);
          factors.push(w === 1 ? ci : apply("power", [ci, textEl("cn", String(w))]));
        }
        return factors.length === 1 ? factors[0] : apply("times", factors);
      }
      if (ctx.defined.has(e.name)) return el("apply", {}, [textEl("ci", ` ${e.name} `), ...e.args.map(m)]);
      if (e.name === "sqr") return apply("power", [m(e.args[0]), textEl("cn", "2")]);
      if (e.name === "log10") return apply("log", [m(e.args[0])]);
      const f = FUN[e.name];
      if (!f) throw new ExportError(`SBML has no function "${e.name}" for rates.`);
      return apply(f, e.args.map(m));
    }
    case "tuple":
      throw new ExportError("Rates cannot be tuples.");
  }
}
