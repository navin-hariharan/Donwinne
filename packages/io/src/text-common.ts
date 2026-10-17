// Helpers shared by the text exporters (ANDL, LoLA, TINA, APNN, PRISM, SBML, CSV).

import {
  Arc,
  Expr,
  FunctionDecl,
  Net,
  NetClass,
  NET_CLASS_LABELS,
  Place,
  Transition,
  UserFunction,
  inlineFunctions,
  isColoured,
  isFaultTree,
  parse,
} from "@pns/core";

/** Thrown when a net cannot be written in a format; the message says why, in plain language. */
export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportError";
  }
}

export function className(c: NetClass): string {
  return NET_CLASS_LABELS[c] ?? c;
}

/** Throws unless the net's class is one of `allowed`. */
export function requireClass(net: Net, format: string, allowed: NetClass[]): void {
  if (allowed.includes(net.netClass)) return;
  let hint = "";
  if (isFaultTree(net.netClass)) hint = " Fault trees can only be saved in the native, PNML and Snoopy formats.";
  else if (isColoured(net.netClass) && format === "ANDL") hint = " Use the CANDL export for coloured nets.";
  throw new ExportError(
    `${format} cannot represent a ${className(net.netClass)}. It supports: ${allowed.map(className).join(", ")}.${hint}`,
  );
}

/**
 * Export formats that can write each arc kind, for error messages. Modifier arcs are left out
 * silently by the formats that lack them (they do not change the behaviour), so only formats that
 * keep them are listed.
 */
export const ARC_KIND_FORMATS: Record<Arc["kind"], string[]> = {
  normal: ["Snoopy", "PNML", "ANDL", "APNN", "PRISM", "SBML", "TINA", "LoLA"],
  read: ["Snoopy", "PNML", "ANDL", "APNN", "PRISM", "SBML", "TINA", "LoLA"],
  inhibitor: ["Snoopy", "PNML", "ANDL", "APNN", "PRISM", "TINA"],
  equal: ["Snoopy", "PNML", "ANDL", "APNN", "PRISM", "TINA"],
  reset: ["Snoopy", "PNML", "ANDL", "APNN", "PRISM"],
  modifier: ["Snoopy", "PNML", "SBML"],
};

/** Throws if the net has arcs of a kind the format lacks, naming the arc and the formats that can write it. */
export function requireArcKinds(net: Net, format: string, allowed: Arc["kind"][]): void {
  const bad = net.arcs.find((a) => !allowed.includes(a.kind));
  if (!bad) return;
  const others = ARC_KIND_FORMATS[bad.kind].filter((f) => f !== format);
  const list = others.length > 1 ? `${others.slice(0, -1).join(", ")} or ${others[others.length - 1]}` : others[0];
  throw new ExportError(
    `${format} has no ${bad.kind} arcs (found one at ${describeArc(net, bad)}). ${bad.kind[0].toUpperCase()}${bad.kind.slice(1)} arcs can be exported as ${list}.`,
  );
}

export function describeArc(net: Net, a: Arc): string {
  const n = (id: string) => net.places.find((p) => p.id === id)?.name || net.transitions.find((t) => t.id === id)?.name || id;
  return `"${n(a.source)}" -> "${n(a.target)}"`;
}

/** Places and transitions that take part in the behaviour (coarse nodes are only drawings). */
export function realPlaces(net: Net): Place[] {
  return net.places.filter((p) => !p.coarse);
}
export function realTransitions(net: Net): Transition[] {
  return net.transitions.filter((t) => !t.coarse);
}

const RESERVED = new Set([
  // LoLA / PRISM / ANDL / TINA keywords that cannot be names.
  "PLACE", "MARKING", "TRANSITION", "CONSUME", "PRODUCE", "SAFE", "STRONG", "WEAK", "FAIR",
  "module", "endmodule", "const", "int", "double", "bool", "init", "ctmc", "dtmc", "mdp", "rate", "formula", "label",
  "true", "false", "min", "max", "pow", "floor", "ceil", "mod", "log",
  "places", "transitions", "constants", "discrete", "continuous", "stochastic", "immediate", "deterministic", "scheduled",
  "net", "tr", "pl", "lb", "nt", "pr", "and", "or", "not",
]);

/** A safe identifier from a name: letters, digits and underscores, not starting with a digit. */
export function sanitize(name: string, fallback: string): string {
  let s = name.trim().replace(/[^A-Za-z0-9_]/g, "_");
  if (!s) s = fallback.replace(/[^A-Za-z0-9_]/g, "_");
  if (/^[0-9]/.test(s)) s = "_" + s;
  if (RESERVED.has(s)) s = s + "_";
  return s;
}

/**
 * Unique identifiers for every place, transition and constant. Logical places with the same
 * name share one identifier (they are one place drawn several times).
 */
export interface Names {
  place: Map<string, string>;
  transition: Map<string, string>;
  constant: Map<string, string>;
  /** Identifier in rate/marking expressions (a node name or constant) -> exported identifier. */
  byName: Map<string, string>;
  /** Distinct places (one per logical group). */
  places: Place[];
  transitions: Transition[];
}

export function assignNames(net: Net, prefix = { place: "P", transition: "T" }): Names {
  const used = new Set<string>();
  const unique = (base: string) => {
    let s = base;
    for (let i = 2; used.has(s); i++) s = `${base}_${i}`;
    used.add(s);
    return s;
  };
  const names: Names = { place: new Map(), transition: new Map(), constant: new Map(), byName: new Map(), places: [], transitions: [] };
  for (const c of net.declarations.constants) {
    const id = unique(sanitize(c.name, "c"));
    names.constant.set(c.name, id);
    names.byName.set(c.name, id);
  }
  const logical = new Map<string, string>();
  realPlaces(net).forEach((p, i) => {
    if (p.logical && p.name && logical.has(p.name)) {
      names.place.set(p.id, logical.get(p.name)!);
      return;
    }
    const id = unique(sanitize(p.name, `${prefix.place}${i}`));
    names.place.set(p.id, id);
    names.places.push(p);
    if (p.logical && p.name) logical.set(p.name, id);
    if (p.name && !names.byName.has(p.name)) names.byName.set(p.name, id);
  });
  realTransitions(net).forEach((t, i) => {
    const id = unique(sanitize(t.name, `${prefix.transition}${i}`));
    names.transition.set(t.id, id);
    names.transitions.push(t);
    if (t.name && !names.byName.has(t.name)) names.byName.set(t.name, id);
  });
  return names;
}

export interface ArcEntry {
  place: string;
  arc: Arc;
}

/**
 * Input arcs (place -> transition) and output arcs (transition -> place) of each transition.
 * Modifier arcs only tell that a place may appear in the rate; they are left out unless
 * `modifiers` is set (formats without a modifier concept simply drop them).
 */
export function arcsOf(net: Net, names: Names, opts: { modifiers?: boolean } = {}): Map<string, { pre: ArcEntry[]; post: ArcEntry[] }> {
  const out = new Map<string, { pre: ArcEntry[]; post: ArcEntry[] }>();
  for (const t of realTransitions(net)) out.set(t.id, { pre: [], post: [] });
  for (const a of net.arcs) {
    if (a.kind === "modifier" && !opts.modifiers) continue;
    if (out.has(a.target) && names.place.has(a.source)) out.get(a.target)!.pre.push({ place: names.place.get(a.source)!, arc: a });
    else if (out.has(a.source) && names.place.has(a.target)) out.get(a.source)!.post.push({ place: names.place.get(a.target)!, arc: a });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Expressions

export function parseExpr(src: string, what: string): Expr {
  try {
    return parse(src);
  } catch (e) {
    throw new ExportError(`${what} "${src}" is not a valid expression: ${(e as Error).message}`);
  }
}

/** The net's user functions with parsed bodies (Declarations.functions). */
export function userFunctions(net: Net): Map<string, UserFunction> {
  return new Map(
    (net.declarations.functions ?? []).map((f) => [f.name, { name: f.name, params: f.params, body: parseExpr(f.body, `The body of function "${f.name}"`) }]),
  );
}

/** Parses an expression and expands calls of user functions (for formats without functions). */
export function parseInlined(net: Net, src: string, what: string): Expr {
  const e = parseExpr(src, what);
  try {
    return inlineFunctions(e, userFunctions(net));
  } catch (err) {
    throw new ExportError(`${what} "${src}": ${(err as Error).message}`);
  }
}

/** Evaluates a numeric expression over the net's constants (recursively), or throws. */
export function evalNumber(net: Net, src: string, what: string): number {
  const consts = new Map(net.declarations.constants.map((c) => [c.name, c.value]));
  const seen = new Set<string>();
  const ev = (e: Expr): number => {
    switch (e.k) {
      case "num":
        return e.v;
      case "bool":
        return e.v ? 1 : 0;
      case "id": {
        const v = consts.get(e.name);
        if (v === undefined) throw new ExportError(`${what} uses "${e.name}", which is not a constant.`);
        if (seen.has(e.name)) throw new ExportError(`The constant "${e.name}" is defined in terms of itself.`);
        seen.add(e.name);
        const x = ev(parseInlined(net, v, `The constant "${e.name}"`));
        seen.delete(e.name);
        return x;
      }
      case "un":
        if (e.op === "-") return -ev(e.e);
        break;
      case "bin": {
        const l = ev(e.l);
        const r = ev(e.r);
        switch (e.op) {
          case "+":
            return l + r;
          case "-":
            return l - r;
          case "*":
            return l * r;
          case "/":
            return l / r;
          case "%":
            return l % r;
          case "^":
            return l ** r;
        }
        break;
      }
      case "call": {
        const args = e.args.map(ev);
        const f: Record<string, (...a: number[]) => number> = {
          min: Math.min,
          max: Math.max,
          abs: Math.abs,
          floor: Math.floor,
          ceil: Math.ceil,
          round: Math.round,
          pow: Math.pow,
          sqrt: Math.sqrt,
          exp: Math.exp,
          log: Math.log,
          ln: Math.log,
          log10: Math.log10,
          log2: Math.log2,
          sin: Math.sin,
          cos: Math.cos,
          tan: Math.tan,
          sign: Math.sign,
        };
        if (f[e.name]) return f[e.name](...args);
        break;
      }
    }
    throw new ExportError(`${what} "${src}" is not a plain number.`);
  };
  const x = ev(parseInlined(net, src.trim() === "" ? "0" : src, what));
  if (!Number.isFinite(x)) throw new ExportError(`${what} "${src}" is not a finite number.`);
  return x;
}

/** Evaluates to a whole number ≥ 0 (markings, arc weights of discrete formats). */
export function evalCount(net: Net, src: string, what: string): number {
  const x = evalNumber(net, src, what);
  if (!Number.isInteger(x) || x < 0) throw new ExportError(`${what} "${src}" is not a whole number of tokens (it is ${x}).`);
  return x;
}

/** Arc weight expression, "1" when blank. */
export function weightOf(a: Arc): string {
  return a.inscription.trim() === "" ? "1" : a.inscription.trim();
}

export interface PrintStyle {
  and: string;
  or: string;
  not: string;
  eq: string;
  ne: string;
  /** How to print a ^ b; default "a^b". */
  pow?: (l: string, r: string) => string;
  /** Rename identifiers; default keeps them. */
  id?: (name: string) => string;
  /** Rewrite a function call; return undefined to print it as is. */
  call?: (name: string, args: Expr[], print: (e: Expr) => string) => string | undefined;
}

const PREC: Record<string, number> = { or: 1, and: 2, "=": 3, "<>": 3, "<": 3, "<=": 3, ">": 3, ">=": 3, "+": 4, "-": 4, "*": 5, "/": 5, "%": 5, "^": 7, "`": 0, "++": -1 };

/** Prints an expression tree in infix with explicit parentheses where precedence requires them. */
export function printExpr(e: Expr, style: PrintStyle): string {
  const p = (e: Expr, ctx: number): string => {
    switch (e.k) {
      case "num":
        return String(e.v);
      case "bool":
        return String(e.v);
      case "id":
        return style.id ? style.id(e.name) : e.name;
      case "tuple":
        return `(${e.items.map((x) => p(x, -2)).join(", ")})`;
      case "call": {
        const custom = style.call?.(e.name, e.args, (x) => p(x, -2));
        if (custom !== undefined) return custom;
        return `${e.name}(${e.args.map((x) => p(x, -2)).join(", ")})`;
      }
      case "un": {
        const inner = p(e.e, 6);
        const s = e.op === "not" ? `${style.not}${inner}` : `-${inner}`;
        return ctx > 6 ? `(${s})` : s;
      }
      case "bin": {
        const prec = PREC[e.op] ?? 0;
        let s: string;
        if (e.op === "^") {
          const l = p(e.l, 8);
          const r = p(e.r, 7);
          s = style.pow ? style.pow(l, r) : `${l}^${r}`;
          if (style.pow) return s;
        } else {
          const op =
            e.op === "and" ? style.and : e.op === "or" ? style.or : e.op === "=" ? style.eq : e.op === "<>" ? style.ne : e.op;
          s = `${p(e.l, prec)} ${op} ${p(e.r, prec + 1)}`;
        }
        return prec < ctx ? `(${s})` : s;
      }
    }
  };
  return p(e, -2);
}

export function fmtNumber(x: number): string {
  return Number.isInteger(x) ? String(x) : String(Number(x.toPrecision(15)));
}

/** "a.b" style default layout for imported nets without coordinates. */
export function gridPosition(i: number, columns = 6, step = 120, offset = 80): { x: number; y: number } {
  return { x: offset + (i % columns) * step, y: offset + Math.floor(i / columns) * step };
}

/**
 * Typed signature for formats with typed colour functions (Snoopy's coloured FunctionList, CANDL).
 * Our functions are untyped: a parameter takes the colour set of a variable of the same name, else
 * int; the result is bool when the body is a comparison or logical expression, else double.
 */
export function functionSignature(net: Net, f: FunctionDecl): { returnType: string; params: { name: string; type: string }[] } {
  const vars = new Map(net.declarations.variables.map((v) => [v.name, v.colourSet]));
  let returnType = "double";
  try {
    const e = parse(f.body);
    const logical = (x: Expr): boolean =>
      x.k === "bool" || (x.k === "un" && x.op === "not") || (x.k === "bin" && ["and", "or", "=", "<>", "<", "<=", ">", ">="].includes(x.op));
    if (logical(e)) returnType = "bool";
  } catch {
    // Reported elsewhere.
  }
  return { returnType, params: f.params.map((name) => ({ name, type: vars.get(name) ?? "int" })) };
}

/** Parameter names from a parameter list such as "S, K, n" or "int x, double y" (types are dropped). */
export function splitParams(text: string): string[] {
  return text
    .replace(/^\s*\(|\)\s*$/g, "")
    .split(",")
    .map((p) => p.trim().split(/\s+/).pop() ?? "")
    .filter((p) => p !== "");
}
