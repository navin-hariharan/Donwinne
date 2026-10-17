// Small helpers over the core expression AST: printing, mapping and literals.

import { Expr, Multiset, Value } from "@pns/core";

/** Rebuild an expression bottom-up; `f` may replace a node (return undefined to keep it). */
export function mapExpr(e: Expr, f: (e: Expr) => Expr | undefined): Expr {
  const r = f(e);
  if (r) return r;
  switch (e.k) {
    case "call":
      return { ...e, args: e.args.map((a) => mapExpr(a, f)) };
    case "tuple":
      return { ...e, items: e.items.map((a) => mapExpr(a, f)) };
    case "un":
      return { ...e, e: mapExpr(e.e, f) };
    case "bin":
      return { ...e, l: mapExpr(e.l, f), r: mapExpr(e.r, f) };
    default:
      return e;
  }
}

/** True if any node satisfies the predicate. */
export function someExpr(e: Expr, p: (e: Expr) => boolean): boolean {
  if (p(e)) return true;
  switch (e.k) {
    case "call":
      return e.args.some((a) => someExpr(a, p));
    case "tuple":
      return e.items.some((a) => someExpr(a, p));
    case "un":
      return someExpr(e.e, p);
    case "bin":
      return someExpr(e.l, p) || someExpr(e.r, p);
    default:
      return false;
  }
}

/** An expression that evaluates to the given colour value. */
export function literal(v: Value): Expr {
  if (typeof v === "number") return { k: "num", v };
  if (typeof v === "boolean") return { k: "bool", v };
  if (typeof v === "string") return { k: "id", name: v };
  if (Array.isArray(v)) return { k: "tuple", items: v.map(literal) };
  if (v instanceof Multiset) throw new Error("A multiset cannot be used as a literal");
  throw new Error("Unsupported value");
}

const BIN_TEXT: Record<string, string> = { and: " and ", or: " or ", "`": "`", "++": " ++ " };

/** Print an expression back to text that `parse` reads to the same tree (fully parenthesised). */
export function printExpr(e: Expr): string {
  switch (e.k) {
    case "num":
      return e.v < 0 ? `(${e.v})` : String(e.v);
    case "bool":
      return String(e.v);
    case "id":
      return e.name;
    case "call":
      return `${e.name}(${e.args.map(printExpr).join(", ")})`;
    case "tuple":
      return `(${e.items.map(printExpr).join(", ")})`;
    case "un":
      return e.op === "-" ? `(-${printExpr(e.e)})` : `(not ${printExpr(e.e)})`;
    case "bin":
      return `(${printExpr(e.l)}${BIN_TEXT[e.op] ?? ` ${e.op} `}${printExpr(e.r)})`;
  }
}
