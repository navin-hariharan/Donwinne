// PRISM CTMC model of a stochastic Petri net (https://www.prismmodelchecker.org/manual/):
//
//   ctmc
//   const int Max = 100;
//   const double k = 0.5;
//   module net
//     P : [0..Max] init 3;
//     [T] (P >= 1) & (Q <= Max - 1) -> k * P : (P' = P - 1) & (Q' = Q + 1);
//   endmodule
//
// Every place needs a finite range: its capacity, else the `bound` option (default 100). Transitions
// whose firing would exceed a bound are disabled. MassAction(k) is expanded to k times the binomial
// coefficients of the input places (stochastic mass action). User functions are expanded in place,
// modifier arcs are left out (they do not change the behaviour) and fixed places never change.

import { Expr, Net } from "@pns/core";
import { ExportError, Names, arcsOf, assignNames, evalCount, parseInlined, printExpr, requireClass, sanitize, weightOf } from "./text-common";

export interface PrismOptions {
  /** Upper bound of places without a capacity (default 100). */
  bound?: number;
}

export function exportPrism(net: Net, options: PrismOptions = {}): string {
  requireClass(net, "PRISM", ["stochastic"]);
  const odd = net.transitions.find((t) => !t.coarse && t.kind && t.kind !== "stochastic");
  if (odd) throw new ExportError(`PRISM CTMCs only have exponentially timed transitions; "${odd.name}" is ${odd.kind}.`);
  const bound = options.bound ?? 100;
  if (!Number.isInteger(bound) || bound < 1) throw new ExportError("The PRISM place bound must be a whole number of at least 1.");
  const names = assignNames(net, undefined, PRISM_KEYWORDS);
  const taken = new Set([...names.place.values(), ...names.transition.values(), ...names.constant.values()]);
  let maxName = "Max";
  while (taken.has(maxName)) maxName += "_";

  const lines: string[] = ["ctmc", "", `const int ${maxName} = ${bound};`];
  for (const c of net.declarations.constants) {
    const v = c.value.trim();
    const type = /^[+-]?\d+$/.test(v) ? "int" : /^(true|false)$/.test(v) ? "bool" : "double";
    lines.push(`const ${type} ${names.constant.get(c.name)} = ${printPrism(parseInlined(net, v || "0", `The constant "${c.name}"`), names, [])};`);
  }
  let moduleName = sanitize(net.name, "net");
  if (PRISM_KEYWORDS.has(moduleName)) moduleName += "_";
  lines.push("", `module ${moduleName}`);
  const boundOf = new Map<string, string>();
  const limit = new Map<string, number>();
  for (const p of names.places) {
    const id = names.place.get(p.id)!;
    const m = evalCount(net, p.marking, `The marking of "${p.name}"`);
    const b = p.capacity ?? undefined;
    const bText = b !== undefined ? String(b) : maxName;
    if (m > (b ?? bound)) throw new ExportError(`The marking of "${p.name}" (${m}) exceeds its bound ${b ?? bound}.`);
    boundOf.set(id, bText);
    limit.set(id, b ?? bound);
    lines.push(`  ${id} : [0..${bText}] init ${m};`);
  }
  const arcs = arcsOf(net, names);
  for (const t of names.transitions) {
    const { pre, post } = arcs.get(t.id)!;
    const guard: string[] = [];
    const change = new Map<string, number>();
    const reset = new Set<string>();
    const consumed: [string, number][] = [];
    const w = (a: (typeof pre)[number]) => evalCount(net, weightOf(a.arc), `The weight of an arc of "${t.name}"`);
    for (const e of pre) {
      switch (e.arc.kind) {
        case "normal": {
          const n = w(e);
          if (n > 0) guard.push(`(${e.place} >= ${n})`);
          change.set(e.place, (change.get(e.place) ?? 0) - n);
          consumed.push([e.place, n]);
          break;
        }
        case "read": {
          const n = w(e);
          if (n > 0) guard.push(`(${e.place} >= ${n})`);
          // Mass action counts read arcs too (as the simulator does).
          consumed.push([e.place, n]);
          break;
        }
        case "inhibitor": {
          // Weight 0: the arc has no effect in Donwinne's firing rule (it never blocks).
          const n = w(e);
          if (n > 0) guard.push(`(${e.place} < ${n})`);
          break;
        }
        case "equal":
          guard.push(`(${e.place} = ${w(e)})`);
          break;
        case "reset":
          reset.add(e.place);
          break;
      }
    }
    for (const e of post) change.set(e.place, (change.get(e.place) ?? 0) + w(e));
    const updates: string[] = [];
    const fixed = new Set(names.places.filter((x) => x.fixed).map((x) => names.place.get(x.id)!));
    for (const p of names.places.map((x) => names.place.get(x.id)!)) {
      if (fixed.has(p)) continue;
      const d = change.get(p) ?? 0;
      if (reset.has(p)) {
        const produced = post.filter((e) => e.place === p).reduce((s, e) => s + w(e), 0);
        if (produced > limit.get(p)!) throw new ExportError(`"${t.name}" puts more tokens on "${p}" than its bound.`);
        updates.push(`(${p}' = ${produced})`);
        continue;
      }
      if (d === 0) continue;
      if (d > 0) guard.push(`(${p} <= ${boundOf.get(p)} - ${d})`);
      updates.push(`(${p}' = ${p} ${d > 0 ? "+" : "-"} ${Math.abs(d)})`);
    }
    const rateSrc = t.rate?.trim() || "MassAction(1)";
    const rate = printPrism(parseInlined(net, rateSrc, `The rate of "${t.name}"`), names, consumed);
    lines.push(`  [${names.transition.get(t.id)}] ${guard.join(" & ") || "true"} -> ${rate} : ${updates.join(" & ") || "true"};`);
  }
  lines.push("endmodule", "");
  return lines.join("\n");
}

function binomialTerms(consumed: [string, number][]): string[] {
  const out: string[] = [];
  for (const [p, n] of consumed) {
    if (n === 0) continue;
    if (n === 1) {
      out.push(p);
      continue;
    }
    let fact = 1;
    const fs: string[] = [p];
    for (let j = 1; j < n; j++) {
      fs.push(`(${p} - ${j})`);
      fact *= j + 1;
    }
    out.push(`(${fs.join(" * ")} / ${fact})`);
  }
  return out;
}

function printPrism(e: Expr, names: Names, consumed: [string, number][]): string {
  return printExpr(prismOperators(e), {
    and: "&",
    or: "|",
    not: "!",
    eq: "=",
    ne: "!=",
    pow: (l, r) => `pow(${l}, ${r})`,
    id: (n) => names.byName.get(n) ?? n,
    call: (name, args, print) => {
      if (name === "MassAction") {
        if (args.length !== 1) throw new ExportError("MassAction takes exactly one argument.");
        return [`(${print(args[0])})`, ...binomialTerms(consumed)].join(" * ");
      }
      if (name === "min" || name === "max" || name === "floor" || name === "ceil" || name === "round" || name === "pow" || name === "mod")
        return undefined;
      // PRISM's log takes the base as a second argument; Donwinne's log and ln are natural logarithms.
      const base: Record<string, string> = { log: "2.718281828459045", ln: "2.718281828459045", log10: "10", log2: "2" };
      if (base[name] && args.length === 1) return `log(${print(args[0])}, ${base[name]})`;
      // PRISM has no abs.
      if (name === "abs" && args.length === 1) return `max(${print(args[0])}, -(${print(args[0])}))`;
      if (name === "sqr" && args.length === 1) return `pow(${print(args[0])}, 2)`;
      if (name === "sqrt") return `pow(${print(args[0])}, 0.5)`;
      if (name === "exp") return `pow(2.718281828459045, ${print(args[0])})`;
      throw new ExportError(`PRISM has no function "${name}".`);
    },
  });
}

/**
 * PRISM's reserved words (manual, "Reserved keywords"), including the single letters of its property
 * operators: places named S, I, R, P or E (common in epidemic and chemical models) must be renamed.
 */
const PRISM_KEYWORDS: ReadonlySet<string> = new Set([
  "A", "bool", "clock", "const", "ctmc", "C", "double", "dtmc", "E", "endinit", "endinvariant", "endmodule",
  "endobservables", "endrewards", "endsystem", "false", "formula", "filter", "func", "F", "global", "G", "init",
  "invariant", "I", "int", "label", "max", "mdp", "min", "module", "X", "nondeterministic", "observable",
  "observables", "of", "Pmax", "Pmin", "P", "pomdp", "popta", "probabilistic", "prob", "pta", "rate", "rewards",
  "Rmax", "Rmin", "R", "S", "stochastic", "system", "true", "U", "W",
]);

/** PRISM has no % operator: a % b becomes mod(a, b) (both truncate towards zero). */
function prismOperators(e: Expr): Expr {
  switch (e.k) {
    case "bin": {
      const l = prismOperators(e.l);
      const r = prismOperators(e.r);
      return e.op === "%" ? { k: "call", name: "mod", args: [l, r] } : { ...e, l, r };
    }
    case "un":
      return { ...e, e: prismOperators(e.e) };
    case "call":
      return { ...e, args: e.args.map(prismOperators) };
    case "tuple":
      return { ...e, items: e.items.map(prismOperators) };
    default:
      return e;
  }
}
