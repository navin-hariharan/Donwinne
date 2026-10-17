// A small expression language for markings, arc inscriptions, guards and arc weights.
//
//   multiset   :=  coeff ("++" coeff)*            2`a ++ b ++ (1,red)
//   coeff      :=  or ("`" or)?                  n`value
//   or         :=  and (("or" | "||" | "|") and)*
//   and        :=  not (("and" | "&&" | "&") not)*
//   not        :=  ("not" | "!") not | cmp
//   cmp        :=  sum (("=" | "==" | "<>" | "!=" | "<" | "<=" | ">" | ">=") sum)?
//   sum        :=  prod (("+" | "-") prod)*
//   prod       :=  unary (("*" | "/" | "%") unary)*
//   unary      :=  "-" unary | primary ("^" unary)?
//   primary    :=  number | ident | ident "(" args ")" | "(" expr ("," expr)* ")"

import { Multiset } from "./multiset";

export type Value = number | boolean | string | Value[] | Multiset;

export type Expr =
  | { k: "num"; v: number }
  | { k: "bool"; v: boolean }
  | { k: "id"; name: string }
  | { k: "call"; name: string; args: Expr[] }
  | { k: "tuple"; items: Expr[] }
  | { k: "un"; op: string; e: Expr }
  | { k: "bin"; op: string; l: Expr; r: Expr };

export class ExprError extends Error {
  constructor(message: string, public pos?: number) {
    super(message);
  }
}

interface Tok {
  t: "num" | "id" | "op" | "end";
  v: string;
  pos: number;
}

const OPS = ["++", "<>", "!=", "==", "<=", ">=", "&&", "||", "`", "=", "<", ">", "+", "-", "*", "/", "%", "^", "(", ")", ",", "!", "&", "|"];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(\d*\.?\d+|\d+\.)([eE][+-]?\d+)?/.exec(src.slice(i))!;
      out.push({ t: "num", v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`Unexpected character "${c}"`, i);
    out.push({ t: "op", v: op, pos: i });
    i += op.length;
  }
  out.push({ t: "end", v: "", pos: src.length });
  return out;
}

const KEYWORD_OPS: Record<string, string> = { or: "or", and: "and", not: "not" };

export function parse(src: string): Expr {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const isOp = (...vs: string[]) => {
    const t = toks[i];
    if (t.t === "op" && vs.includes(t.v)) return t.v;
    if (t.t === "id" && KEYWORD_OPS[t.v] && vs.includes(t.v)) return t.v;
    return null;
  };
  const expect = (v: string) => {
    if (!isOp(v)) throw new ExprError(`Expected "${v}"`, peek().pos);
    i++;
  };

  const multiset = (): Expr => {
    let l = coeff();
    while (isOp("++")) {
      i++;
      l = { k: "bin", op: "++", l, r: coeff() };
    }
    return l;
  };
  const coeff = (): Expr => {
    const l = or();
    if (isOp("`")) {
      i++;
      return { k: "bin", op: "`", l, r: or() };
    }
    return l;
  };
  const or = (): Expr => {
    let l = and();
    while (isOp("or", "||", "|")) {
      i++;
      l = { k: "bin", op: "or", l, r: and() };
    }
    return l;
  };
  const and = (): Expr => {
    let l = not();
    while (isOp("and", "&&", "&")) {
      i++;
      l = { k: "bin", op: "and", l, r: not() };
    }
    return l;
  };
  const not = (): Expr => {
    if (isOp("not", "!")) {
      i++;
      return { k: "un", op: "not", e: not() };
    }
    return cmp();
  };
  const cmp = (): Expr => {
    const l = sum();
    const op = isOp("=", "==", "<>", "!=", "<", "<=", ">", ">=");
    if (op) {
      i++;
      const norm = op === "==" ? "=" : op === "!=" ? "<>" : op;
      return { k: "bin", op: norm, l, r: sum() };
    }
    return l;
  };
  const sum = (): Expr => {
    let l = prod();
    let op: string | null;
    while ((op = isOp("+", "-"))) {
      i++;
      l = { k: "bin", op, l, r: prod() };
    }
    return l;
  };
  const prod = (): Expr => {
    let l = unary();
    let op: string | null;
    while ((op = isOp("*", "/", "%"))) {
      i++;
      l = { k: "bin", op, l, r: unary() };
    }
    return l;
  };
  const unary = (): Expr => {
    if (isOp("-")) {
      i++;
      return { k: "un", op: "-", e: unary() };
    }
    const base = primary();
    if (isOp("^")) {
      i++;
      return { k: "bin", op: "^", l: base, r: unary() };
    }
    return base;
  };
  const primary = (): Expr => {
    const t = peek();
    if (t.t === "num") {
      i++;
      return { k: "num", v: Number(t.v) };
    }
    if (t.t === "id") {
      if (KEYWORD_OPS[t.v]) throw new ExprError(`Unexpected "${t.v}"`, t.pos);
      i++;
      if (t.v === "true" || t.v === "false") return { k: "bool", v: t.v === "true" };
      if (isOp("(")) {
        i++;
        const args: Expr[] = [];
        if (!isOp(")")) {
          args.push(multiset());
          while (isOp(",")) {
            i++;
            args.push(multiset());
          }
        }
        expect(")");
        return { k: "call", name: t.v, args };
      }
      return { k: "id", name: t.v };
    }
    if (isOp("(")) {
      i++;
      const items = [multiset()];
      while (isOp(",")) {
        i++;
        items.push(multiset());
      }
      expect(")");
      return items.length === 1 ? items[0] : { k: "tuple", items };
    }
    if (t.t === "end") throw new ExprError("Unexpected end of expression", t.pos);
    throw new ExprError(`Unexpected "${t.v}"`, t.pos);
  };

  const e = multiset();
  if (peek().t !== "end") throw new ExprError(`Unexpected "${peek().v}"`, peek().pos);
  return e;
}

const cache = new Map<string, Expr>();
export function parseCached(src: string): Expr {
  let e = cache.get(src);
  if (!e) {
    e = parse(src);
    if (cache.size > 5000) cache.clear();
    cache.set(src, e);
  }
  return e;
}

/** Identifiers used in an expression (variables, constants, enum values, place names). */
export function identifiers(e: Expr, out = new Set<string>()): Set<string> {
  switch (e.k) {
    case "id":
      out.add(e.name);
      break;
    case "call":
      e.args.forEach((a) => identifiers(a, out));
      break;
    case "tuple":
      e.items.forEach((a) => identifiers(a, out));
      break;
    case "un":
      identifiers(e.e, out);
      break;
    case "bin":
      identifiers(e.l, out);
      identifiers(e.r, out);
      break;
  }
  return out;
}

/** A user-declared function (Declarations.functions) with its body parsed. */
export interface UserFunction {
  name: string;
  params: string[];
  body: Expr;
}

export interface EvalEnv {
  /** Resolve an identifier, or return undefined if unknown. */
  lookup(name: string): Value | undefined;
  /** Built-in functions that need declarations, e.g. all(ColourSet), succ(x). */
  call?(name: string, args: Value[]): Value | undefined;
  /**
   * User functions by name. A call binds the parameters to the argument values; any other name in
   * the body is resolved by this environment (constants, place markings, ...). User functions take
   * precedence over the built-in ones.
   */
  functions?: ReadonlyMap<string, UserFunction>;
}

/** Deepest nesting of user function calls before a call is reported as (indirect) recursion. */
const MAX_CALL_DEPTH = 64;
let callDepth = 0;

function callUserFunction(f: UserFunction, args: Value[], env: EvalEnv): Value {
  if (args.length !== f.params.length)
    throw new ExprError(`Function ${f.name} takes ${f.params.length} argument${f.params.length === 1 ? "" : "s"} but got ${args.length}`);
  if (callDepth >= MAX_CALL_DEPTH) throw new ExprError(`Function ${f.name} calls itself (recursion is not allowed)`);
  const local: EvalEnv = {
    lookup: (name) => {
      const i = f.params.indexOf(name);
      return i >= 0 ? args[i] : env.lookup(name);
    },
    call: env.call ? (name, a) => env.call!(name, a) : undefined,
    functions: env.functions,
  };
  callDepth++;
  try {
    return evaluate(f.body, local);
  } finally {
    callDepth--;
  }
}

export function evaluate(e: Expr, env: EvalEnv): Value {
  switch (e.k) {
    case "num":
      return e.v;
    case "bool":
      return e.v;
    case "id": {
      const v = env.lookup(e.name);
      if (v === undefined) throw new ExprError(`Unknown name "${e.name}"`);
      return v;
    }
    case "tuple":
      return e.items.map((x) => evaluate(x, env));
    case "call": {
      const args = e.args.map((a) => evaluate(a, env));
      const uf = env.functions?.get(e.name);
      if (uf) return callUserFunction(uf, args, env);
      const builtin = callBuiltin(e.name, args);
      if (builtin !== undefined) return builtin;
      const v = env.call?.(e.name, args);
      if (v === undefined) throw new ExprError(`Unknown function "${e.name}"`);
      return v;
    }
    case "un": {
      const v = evaluate(e.e, env);
      if (e.op === "-") return -num(v);
      return !bool(v);
    }
    case "bin": {
      if (e.op === "and") return bool(evaluate(e.l, env)) && bool(evaluate(e.r, env));
      if (e.op === "or") return bool(evaluate(e.l, env)) || bool(evaluate(e.r, env));
      const l = evaluate(e.l, env);
      const r = evaluate(e.r, env);
      switch (e.op) {
        case "++":
          return toMultiset(l).plus(toMultiset(r));
        case "`": {
          const n = num(l);
          if (!Number.isInteger(n) || n < 0) throw new ExprError("A multiset coefficient must be a whole number");
          return r instanceof Multiset ? r.scale(n) : Multiset.of(r, n);
        }
        case "+":
          return num(l) + num(r);
        case "-":
          return num(l) - num(r);
        case "*":
          return num(l) * num(r);
        case "/": {
          const d = num(r);
          if (d === 0) throw new ExprError("Division by zero");
          return num(l) / d;
        }
        case "^":
          return Math.pow(num(l), num(r));
        case "%":
          return num(l) % num(r);
        case "=":
          return valueKey(l) === valueKey(r);
        case "<>":
          return valueKey(l) !== valueKey(r);
        case "<":
          return compare(l, r) < 0;
        case "<=":
          return compare(l, r) <= 0;
        case ">":
          return compare(l, r) > 0;
        case ">=":
          return compare(l, r) >= 0;
      }
      throw new ExprError(`Unknown operator ${e.op}`);
    }
  }
}

/** Names of the math functions every expression understands (Snoopy's math functions and a few more). */
export const BUILTIN_FUNCTIONS = [
  "min", "max", "abs", "pow", "sqrt", "exp", "log", "ln", "log10", "log2", "floor", "ceil", "round", "div", "sqr",
  "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh", "sign", "empty",
] as const;

function callBuiltin(name: string, args: Value[]): Value | undefined {
  switch (name) {
    case "min":
      return Math.min(...args.map(num));
    case "max":
      return Math.max(...args.map(num));
    case "abs":
      return Math.abs(num(args[0]));
    case "pow":
      return Math.pow(num(args[0]), num(args[1]));
    case "sqrt":
      return Math.sqrt(num(args[0]));
    case "exp":
      return Math.exp(num(args[0]));
    case "log":
      return Math.log(num(args[0]));
    case "ln":
      return Math.log(num(args[0]));
    case "log10":
      return Math.log10(num(args[0]));
    case "log2":
      return Math.log2(num(args[0]));
    case "sqr":
      return num(args[0]) ** 2;
    case "sin":
      return Math.sin(num(args[0]));
    case "cos":
      return Math.cos(num(args[0]));
    case "tan":
      return Math.tan(num(args[0]));
    case "asin":
      return Math.asin(num(args[0]));
    case "acos":
      return Math.acos(num(args[0]));
    case "atan":
      return Math.atan(num(args[0]));
    case "sinh":
      return Math.sinh(num(args[0]));
    case "cosh":
      return Math.cosh(num(args[0]));
    case "tanh":
      return Math.tanh(num(args[0]));
    case "sign":
      return Math.sign(num(args[0]));
    case "floor":
      return Math.floor(num(args[0]));
    case "ceil":
      return Math.ceil(num(args[0]));
    case "round":
      return Math.round(num(args[0]));
    case "div":
      return Math.trunc(num(args[0]) / num(args[1]));
    case "empty":
      return new Multiset();
  }
  return undefined;
}

function compare(l: Value, r: Value): number {
  if (typeof l === "number" && typeof r === "number") return l - r;
  if (typeof l === "string" && typeof r === "string") return l < r ? -1 : l > r ? 1 : 0;
  throw new ExprError("Only numbers or names can be compared with < or >");
}

export function num(v: Value): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  throw new ExprError(`Expected a number but got ${showValue(v)}`);
}

export function bool(v: Value): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  throw new ExprError(`Expected true or false but got ${showValue(v)}`);
}

export function toMultiset(v: Value): Multiset {
  return v instanceof Multiset ? v : Multiset.of(v, 1);
}

export function valueKey(v: Value): string {
  if (v instanceof Multiset) return `{${v.toString()}}`;
  return JSON.stringify(v);
}

export function showValue(v: Value): string {
  if (v instanceof Multiset) return v.toString();
  if (Array.isArray(v)) return `(${v.map(showValue).join(",")})`;
  return String(v);
}

/** Every function call in an expression with its number of arguments. */
export function calls(e: Expr, out: { name: string; argc: number }[] = []): { name: string; argc: number }[] {
  switch (e.k) {
    case "call":
      out.push({ name: e.name, argc: e.args.length });
      e.args.forEach((a) => calls(a, out));
      break;
    case "tuple":
      e.items.forEach((a) => calls(a, out));
      break;
    case "un":
      calls(e.e, out);
      break;
    case "bin":
      calls(e.l, out);
      calls(e.r, out);
      break;
  }
  return out;
}

/**
 * Replace calls of user functions by their bodies with the parameters substituted (macro expansion),
 * for formats that have no functions. Throws ExprError on wrong arity or recursion.
 */
export function inlineFunctions(e: Expr, functions: ReadonlyMap<string, UserFunction>, depth = 0): Expr {
  if (!functions.size) return e;
  const sub = (x: Expr, params: Map<string, Expr>): Expr => {
    switch (x.k) {
      case "id":
        return params.get(x.name) ?? x;
      case "call":
        return { ...x, args: x.args.map((a) => sub(a, params)) };
      case "tuple":
        return { ...x, items: x.items.map((a) => sub(a, params)) };
      case "un":
        return { ...x, e: sub(x.e, params) };
      case "bin":
        return { ...x, l: sub(x.l, params), r: sub(x.r, params) };
      default:
        return x;
    }
  };
  const walk = (x: Expr): Expr => {
    switch (x.k) {
      case "call": {
        const args = x.args.map(walk);
        const f = functions.get(x.name);
        if (!f) return { ...x, args };
        if (args.length !== f.params.length)
          throw new ExprError(`Function ${f.name} takes ${f.params.length} argument${f.params.length === 1 ? "" : "s"} but got ${args.length}`);
        if (depth >= MAX_CALL_DEPTH) throw new ExprError(`Function ${f.name} calls itself (recursion is not allowed)`);
        const body = inlineFunctions(f.body, functions, depth + 1);
        return sub(body, new Map(f.params.map((p, i) => [p, args[i]])));
      }
      case "tuple":
        return { ...x, items: x.items.map(walk) };
      case "un":
        return { ...x, e: walk(x.e) };
      case "bin":
        return { ...x, l: walk(x.l), r: walk(x.r) };
      default:
        return x;
    }
  };
  return walk(e);
}
