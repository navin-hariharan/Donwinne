// Import and export of fault trees as disjunctive normal form (DNF) text.

import { FTEdge, FTNode, Net, emptyNet } from "@pns/core";
import { FTError } from "./structure";
import { layoutFaultTree } from "./layout";
import { minimalCutSets } from "./analysis";

/** Options for {@link importDnf}. */
export interface DnfImportOptions {
  /** Name of the net and its top event (default "DNF"). */
  name?: string;
  /** Probability expression given to every basic event (default "0.01"), unless `failureRate` is set. */
  probability?: string;
  /** Failure rate expression given to every basic event instead of a probability. */
  failureRate?: string;
}

/**
 * Parse a fault tree in disjunctive normal form: a disjunction of conjunctions such as
 * `(a & b) | (c & d & e)`, or one conjunction per line (`a b`, `a, b`, `a * b`, `a and b`).
 * OR may be written `|`, `||`, `+`, `or` or a line break; AND `&`, `&&`, `*`, `,`, `and` or spaces.
 * Events may be negated with `!`, `~` or `not`. Lines starting with `#` or `//` are comments.
 *
 * The result is a fault tree net: the top event fed by an OR gate over one AND gate per
 * conjunction (single events feed the OR directly), with shared basic events, laid out top-down.
 */
export function importDnf(text: string, opts: DnfImportOptions = {}): Net {
  const terms = parseDnf(text);
  if (!terms.length) throw new FTError("The DNF text contains no terms");
  const net = emptyNet("faultTree", opts.name ?? "DNF");
  const nodes: FTNode[] = [];
  const edges: FTEdge[] = [];
  let seq = 0;
  const node = (type: FTNode["type"], name: string, extra: Partial<FTNode> = {}): FTNode => {
    const n: FTNode = { id: `n${++seq}`, name, x: 0, y: 0, type, ...extra };
    nodes.push(n);
    return n;
  };
  const edge = (source: string, target: string) => edges.push({ id: `e${++seq}`, source, target });
  const top = node("top", opts.name ?? "DNF");
  const events = new Map<string, FTNode>();
  const negs = new Map<string, FTNode>();
  const lit = (l: Literal): FTNode => {
    let e = events.get(l.name);
    if (!e) {
      e = node("basic", l.name, opts.failureRate ? { failureRate: opts.failureRate } : { probability: opts.probability ?? "0.01" });
      events.set(l.name, e);
    }
    if (!l.negated) return e;
    let g = negs.get(l.name);
    if (!g) {
      g = node("not", `not ${l.name}`);
      edge(e.id, g.id);
      negs.set(l.name, g);
    }
    return g;
  };
  const termNode = (t: Literal[], i: number): FTNode => {
    if (t.length === 1) return lit(t[0]);
    const g = node("and", `AND${i + 1}`);
    for (const l of t) edge(lit(l).id, g.id);
    return g;
  };
  if (terms.length === 1) edge(termNode(terms[0], 0).id, top.id);
  else {
    const or = node("or", "OR");
    edge(or.id, top.id);
    terms.forEach((t, i) => edge(termNode(t, i).id, or.id));
  }
  net.faultTree = { nodes, edges };
  return layoutFaultTree(net);
}

/** A possibly negated event name. */
export interface Literal {
  name: string;
  negated: boolean;
}

/** Parse DNF text into its conjunctions (duplicate literals within a term removed). */
export function parseDnf(text: string): Literal[][] {
  const terms: Literal[][] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/(#|\/\/).*$/, "").trim())
    .filter(Boolean);
  for (const line of lines) {
    // Tokens: names, operators, parentheses.
    const toks = line.match(/[A-Za-z0-9_.:\[\]'][A-Za-z0-9_.:\[\]'-]*|\|\||&&|[|&*+,()!~]/g) ?? [];
    const bad = line.replace(/[A-Za-z0-9_.:\[\]'][A-Za-z0-9_.:\[\]'-]*|\|\||&&|[|&*+,()!~\s]/g, "");
    if (bad) throw new FTError(`Unexpected "${bad[0]}" in DNF line "${line}"`);
    let cur: Literal[] = [];
    let neg = false;
    let depth = 0;
    const flush = () => {
      if (neg) throw new FTError(`A negation is missing its event in "${line}"`);
      if (cur.length) {
        const seen = new Set<string>();
        terms.push(cur.filter((l) => !seen.has(`${l.negated}${l.name}`) && !!seen.add(`${l.negated}${l.name}`)));
      }
      cur = [];
    };
    for (const t of toks) {
      const low = t.toLowerCase();
      const isNeg = t === "!" || t === "~" || low === "not";
      const isName = !isNeg && /^[A-Za-z0-9_.:\[\]']/.test(t) && low !== "and" && low !== "or";
      // Only single events may be negated: `!(a & b)` is not a conjunction of literals.
      if (neg && !isNeg && !isName) throw new FTError(`A negation must be followed by an event name in "${line}"`);
      if (t === "(") depth++;
      else if (t === ")") {
        if (--depth < 0) throw new FTError(`Unbalanced parentheses in "${line}"`);
      } else if (t === "|" || t === "||" || t === "+" || low === "or") {
        if (depth > 0) throw new FTError(`Not in disjunctive normal form (OR inside parentheses): "${line}"`);
        flush();
      } else if (t === "&" || t === "&&" || t === "*" || t === "," || low === "and") continue;
      else if (t === "!" || t === "~" || low === "not") neg = !neg;
      else {
        cur.push({ name: t, negated: neg });
        neg = false;
      }
    }
    if (depth !== 0) throw new FTError(`Unbalanced parentheses in "${line}"`);
    flush();
  }
  return terms;
}

/** Write the minimal cut sets of a fault tree as DNF text, e.g. `(a & b) | c`, using event names. */
export function exportDnf(net: Net): string {
  // Names are written so that importDnf reads them back as one event each: characters the DNF
  // syntax treats as operators or separators (spaces in "Pump A", "#", "/", ...) become "_",
  // keywords get a "_" suffix, and events whose names clash are numbered.
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const n of net.faultTree?.nodes ?? []) {
    if (n.type !== "basic" && n.type !== "undeveloped") continue;
    let base = (n.name || n.id).replace(/[^A-Za-z0-9_.:\[\]'-]/g, "_");
    if (!/^[A-Za-z0-9_.:\[\]']/.test(base)) base = `_${base}`;
    if (["and", "or", "not"].includes(base.toLowerCase())) base += "_";
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}_${i}`;
    used.add(name);
    names.set(n.id, name);
  }
  const sets = minimalCutSets(net);
  // DNF text has no constants: refuse instead of writing text ("" or "()") that cannot be read back.
  if (!sets.length) throw new FTError("The top event can never occur, so there are no cut sets to write as DNF");
  if (sets.some((s) => !s.length)) throw new FTError("The top event occurs even when every event works, which DNF text cannot express");
  return sets
    .map((s) => (s.length === 1 ? names.get(s[0])! : `(${s.map((id) => names.get(id)!).join(" & ")})`))
    .join(" | ");
}
