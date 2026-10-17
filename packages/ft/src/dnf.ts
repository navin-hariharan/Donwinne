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
  const names = new Map((net.faultTree?.nodes ?? []).map((n) => [n.id, n.name]));
  return minimalCutSets(net)
    .map((s) => (s.length === 1 ? names.get(s[0])! : `(${s.map((id) => names.get(id)!).join(" & ")})`))
    .join(" | ");
}
