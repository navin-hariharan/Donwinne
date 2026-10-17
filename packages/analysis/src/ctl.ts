// Computation Tree Logic in the syntax of the Charlie verification tool, as Konios (2015, ch. 7)
// uses it, with a notation for coloured places: parser, printer and binding to a net's places.

import type { NodeRef } from "./types";

/** Position of a piece of formula text (offsets into the text, `end` exclusive; line and column from 1). */
export interface Span {
  start: number;
  end: number;
}

/** A token count: a number, the marking of a place (summed over colours unless one is named), or a sum. */
export type CtlTerm =
  | { kind: "num"; value: number; span: Span }
  | { kind: "place"; name: string; colour?: string; quoted?: boolean; span: Span }
  | { kind: "sum"; terms: CtlTerm[]; span: Span };

export type CompareOp = "==" | "!=" | "<" | "<=" | ">" | ">=";
export type UnaryTemporal = "EX" | "AX" | "EF" | "AF" | "EG" | "AG";

/** Abstract syntax of a CTL formula. */
export type CtlFormula =
  | { kind: "const"; value: boolean; span: Span }
  | { kind: "deadlock"; span: Span }
  | { kind: "fireable"; transition: string; quoted?: boolean; span: Span }
  | { kind: "cmp"; op: CompareOp; left: CtlTerm; right: CtlTerm; span: Span }
  | { kind: "not"; arg: CtlFormula; span: Span }
  | { kind: "and" | "or" | "implies" | "iff"; left: CtlFormula; right: CtlFormula; span: Span }
  | { kind: UnaryTemporal; arg: CtlFormula; span: Span }
  | { kind: "EU" | "AU"; left: CtlFormula; right: CtlFormula; span: Span };

/**
 * A problem with a formula, with enough detail to point at it in an editor.
 * `kind` is "syntax" for malformed text and "name" for an unknown place or transition.
 */
export class CtlError extends Error {
  readonly kind: "syntax" | "name";
  readonly start: number;
  readonly end: number;
  /** Line and column of `start`, from 1. */
  readonly line: number;
  readonly column: number;
  /** What would have been accepted at this point (syntax errors). */
  readonly expected: string[];
  /** The offending text ("end of formula" at the end). */
  readonly found: string;
  /** Close matches for an unknown name. */
  readonly suggestions: string[];

  constructor(
    kind: "syntax" | "name",
    text: string,
    span: Span,
    message: string,
    extra: { expected?: string[]; found?: string; suggestions?: string[] } = {},
  ) {
    const { line, column } = lineCol(text, span.start);
    super(`Line ${line}, column ${column}: ${message}`);
    this.name = "CtlError";
    this.kind = kind;
    this.start = span.start;
    this.end = span.end;
    this.line = line;
    this.column = column;
    this.expected = extra.expected ?? [];
    this.found = extra.found ?? text.slice(span.start, span.end);
    this.suggestions = extra.suggestions ?? [];
  }
}

function lineCol(text: string, offset: number) {
  let line = 1;
  let col = 1;
  for (let i = 0; i < offset && i < text.length; i++)
    if (text[i] === "\n") {
      line++;
      col = 1;
    } else col++;
  return { line, column: col };
}

// ---------------------------------------------------------------- lexer

type TokKind = "ident" | "num" | "string" | "op" | "eof";
interface Tok {
  kind: TokKind;
  text: string;
  /** ident with a colour suffix p[c]. */
  colour?: string;
  start: number;
  end: number;
}

const KEYWORDS = new Set(["EX", "AX", "EF", "AF", "EG", "AG", "E", "A", "U", "true", "false", "TRUE", "FALSE", "deadlock", "fireable", "enabled", "sum", "not", "and", "or"]);
const OPS = ["<->", "<=>", "->", "=>", "&&", "||", "==", "!=", "<>", "<=", ">=", "(", ")", "[", "]", ",", ";", "&", "*", "|", "+", "!", "~", "=", "<", ">"];

function lex(text: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const e = text.indexOf("*/", i + 2);
      if (e < 0) throw new CtlError("syntax", text, { start: i, end: n }, "the comment opened here is never closed with */.", { expected: ["*/"], found: "end of formula" });
      i = e + 2;
      continue;
    }
    const start = i;
    if (/[A-Za-z_]/.test(c)) {
      while (i < n && /[A-Za-z0-9_'.]/.test(text[i])) i++;
      // A trailing dot is never part of a name.
      while (text[i - 1] === ".") i--;
      const word = text.slice(start, i);
      const tok: Tok = { kind: "ident", text: word, start, end: i };
      // Colour suffix p[c], written without a space (E[...] and A[...] are until operators).
      if (text[i] === "[" && !KEYWORDS.has(word)) {
        const close = text.indexOf("]", i + 1);
        if (close < 0) throw new CtlError("syntax", text, { start: i, end: n }, `the colour of place "${word}" is not closed: expected "]".`, { expected: ["]"], found: "end of formula" });
        tok.colour = text.slice(i + 1, close).trim();
        if (!tok.colour) throw new CtlError("syntax", text, { start: i, end: close + 1 }, `empty colour after "${word}": write the colour between the brackets, e.g. ${word}[a].`, { expected: ["a colour"], found: "]" });
        i = close + 1;
        tok.end = i;
      }
      toks.push(tok);
      continue;
    }
    if (/[0-9]/.test(c)) {
      while (i < n && /[0-9]/.test(text[i])) i++;
      if (text[i] === "." && /[0-9]/.test(text[i + 1] ?? "")) {
        throw new CtlError("syntax", text, { start, end: i + 2 }, "token counts are whole numbers.", { expected: ["a whole number"] });
      }
      toks.push({ kind: "num", text: text.slice(start, i), start, end: i });
      continue;
    }
    if (c === '"') {
      const close = text.indexOf('"', i + 1);
      if (close < 0) throw new CtlError("syntax", text, { start, end: n }, 'the quoted name is not closed: expected another ".', { expected: ['"'], found: "end of formula" });
      toks.push({ kind: "string", text: text.slice(i + 1, close), start, end: close + 1 });
      i = close + 1;
      continue;
    }
    const op = OPS.find((o) => text.startsWith(o, i));
    if (!op) throw new CtlError("syntax", text, { start, end: start + 1 }, `unexpected character "${c}".`, { expected: ["an operator, a place name or a number"], found: c });
    toks.push({ kind: "op", text: op, start, end: i + op.length });
    i += op.length;
  }
  toks.push({ kind: "eof", text: "", start: n, end: n });
  return toks;
}

// ---------------------------------------------------------------- parser

const TEMPORAL = new Set(["EX", "AX", "EF", "AF", "EG", "AG"]);
const START_OF_FORMULA = ["a place name", "a number", '"("', '"!"', "EX, AX, EF, AF, EG, AG", "E[… U …]", "A[… U …]", "true", "false", "deadlock", "fireable(…)"];

class Parser {
  private i = 0;
  constructor(
    private readonly text: string,
    private readonly toks: Tok[],
  ) {}

  private get t(): Tok {
    return this.toks[this.i];
  }
  private found(t: Tok = this.t) {
    return t.kind === "eof" ? "end of formula" : t.kind === "string" ? `"${t.text}"` : t.text;
  }
  private fail(expected: string[], message?: string, t: Tok = this.t): never {
    const found = this.found(t);
    const exp = expected.length === 1 ? expected[0] : `${expected.slice(0, -1).join(", ")} or ${expected[expected.length - 1]}`;
    throw new CtlError("syntax", this.text, { start: t.start, end: Math.max(t.end, t.start + 1) }, message ?? `expected ${exp} but found ${t.kind === "eof" ? found : `"${found}"`}.`, { expected, found });
  }
  private isOp(...ops: string[]) {
    return this.t.kind === "op" && ops.includes(this.t.text);
  }
  private isWord(...ws: string[]) {
    return this.t.kind === "ident" && !this.t.colour && ws.includes(this.t.text);
  }
  private atEnd() {
    return this.toks[this.i].kind === "eof";
  }
  private next(): Tok {
    return this.toks[this.i++];
  }
  private expectClose(open: Tok, close: string) {
    if (this.isOp(close)) return this.next();
    const o = lineCol(this.text, open.start);
    this.fail([`"${close}"`], `expected "${close}" to close the "${open.text}" at line ${o.line}, column ${o.column}, but found ${this.t.kind === "eof" ? "end of formula" : `"${this.found()}"`}.`);
  }

  parse(): CtlFormula {
    if (this.t.kind === "eof") this.fail(START_OF_FORMULA, "the formula is empty.");
    const f = this.iff();
    while (this.isOp(";")) this.next();
    if (!this.atEnd()) {
      if (this.isOp(")", "]")) this.fail(["an operator", "end of formula"], `"${this.t.text}" has no matching opening bracket.`);
      if (this.isWord("U")) this.fail(["an operator"], 'U can only be used inside E[ … U … ] or A[ … U … ].');
      this.fail(["&", "|", "->", "<->", "end of formula"]);
    }
    return f;
  }

  private span(start: number): Span {
    return { start, end: this.toks[this.i - 1].end };
  }

  private iff(): CtlFormula {
    const start = this.t.start;
    let left = this.impl();
    while (this.isOp("<->", "<=>")) {
      this.next();
      const right = this.impl();
      left = { kind: "iff", left, right, span: this.span(start) };
    }
    return left;
  }

  /** Implication associates to the left, as in Charlie: a -> b -> c is (a -> b) -> c. */
  private impl(): CtlFormula {
    const start = this.t.start;
    let left = this.or();
    while (this.isOp("->", "=>")) {
      this.next();
      const right = this.or();
      left = { kind: "implies", left, right, span: this.span(start) };
    }
    return left;
  }

  private or(): CtlFormula {
    const start = this.t.start;
    let left = this.and();
    while (this.isOp("|", "||", "+") || this.isWord("or")) {
      this.next();
      const right = this.and();
      left = { kind: "or", left, right, span: this.span(start) };
    }
    return left;
  }

  private and(): CtlFormula {
    const start = this.t.start;
    let left = this.unary();
    while (this.isOp("&", "&&", "*") || this.isWord("and")) {
      this.next();
      const right = this.unary();
      left = { kind: "and", left, right, span: this.span(start) };
    }
    return left;
  }

  private unary(): CtlFormula {
    const t = this.t;
    if (this.isOp("!", "~") || this.isWord("not")) {
      this.next();
      const arg = this.unary();
      return { kind: "not", arg, span: this.span(t.start) };
    }
    if (t.kind === "ident" && !t.colour && TEMPORAL.has(t.text)) {
      this.next();
      if (this.t.kind === "eof") this.fail(START_OF_FORMULA, `${t.text} needs a formula after it, e.g. ${t.text}(p > 0).`);
      const arg = this.unary();
      return { kind: t.text as UnaryTemporal, arg, span: this.span(t.start) };
    }
    if (this.isWord("E", "A")) {
      this.next();
      if (!this.isOp("[", "(")) this.fail(['"["', '"("'], `${t.text} must be followed by [ φ U ψ ] (or the unary operators ${t.text}X, ${t.text}F, ${t.text}G).`);
      const open = this.next();
      const left = this.iff();
      if (!this.isWord("U")) this.fail(['"U"'], `expected U in ${t.text}${open.text} φ U ψ ${open.text === "[" ? "]" : ")"} but found ${this.t.kind === "eof" ? "end of formula" : `"${this.found()}"`}.`);
      this.next();
      const right = this.iff();
      this.expectClose(open, open.text === "[" ? "]" : ")");
      return { kind: t.text === "E" ? "EU" : "AU", left, right, span: this.span(t.start) };
    }
    return this.atom();
  }

  private atom(): CtlFormula {
    const t = this.t;
    if (this.isOp("(")) {
      this.next();
      if (this.isOp(")")) this.fail(START_OF_FORMULA, "empty brackets: write a formula between them.");
      const f = this.iff();
      this.expectClose(t, ")");
      // A bracketed formula may not be compared: (p) > 0 is not supported.
      if (this.isOp("==", "=", "!=", "<>", "<", "<=", ">", ">=")) this.fail(["&", "|", "->"], "only place names and numbers can be compared; remove the brackets around the place name.");
      return { ...f, span: this.span(t.start) };
    }
    if (this.isWord("true", "TRUE")) {
      this.next();
      return { kind: "const", value: true, span: this.span(t.start) };
    }
    if (this.isWord("false", "FALSE")) {
      this.next();
      return { kind: "const", value: false, span: this.span(t.start) };
    }
    if (this.isWord("deadlock")) {
      this.next();
      return { kind: "deadlock", span: this.span(t.start) };
    }
    if (this.isWord("fireable", "enabled")) {
      this.next();
      if (!this.isOp("(")) this.fail(['"("'], `${t.text} takes a transition name in brackets, e.g. ${t.text}(t1).`);
      const open = this.next();
      const tr = this.t;
      if (!(tr.kind === "string" || (tr.kind === "ident" && !KEYWORDS.has(tr.text)))) this.fail(["a transition name"]);
      this.next();
      // Coloured transitions are named with their binding, e.g. take<x=a>; allow that form.
      let name = tr.kind === "ident" && tr.colour ? `${tr.text}[${tr.colour}]` : tr.text;
      if (tr.kind === "ident" && this.isOp("<")) {
        const close = this.text.indexOf(">", this.t.start);
        if (close < 0) this.fail(['">"']);
        name = this.text.slice(tr.start, close + 1).replace(/\s+/g, " ");
        while (this.t.kind !== "eof" && this.t.start <= close) this.next();
      }
      this.expectClose(open, ")");
      return { kind: "fireable", transition: name, quoted: tr.kind === "string", span: this.span(t.start) };
    }
    if (this.isWord("U")) this.fail(START_OF_FORMULA, "U can only be used inside E[ … U … ] or A[ … U … ].");
    if (t.kind === "num" || t.kind === "string" || this.isWord("sum") || (t.kind === "ident" && (t.colour || !KEYWORDS.has(t.text)))) {
      const left = this.term();
      const op = this.t;
      if (this.isOp("==", "=", "!=", "<>", "<", "<=", ">", ">=")) {
        this.next();
        const right = this.term();
        const o = op.text === "=" ? "==" : op.text === "<>" ? "!=" : (op.text as CompareOp);
        return { kind: "cmp", op: o, left, right, span: this.span(t.start) };
      }
      if (left.kind === "num") this.fail(["a comparison such as == or >"], `a number on its own is not a condition; compare it with a place, e.g. p >= ${left.value}.`, op);
      // A bare place stands for "the place is marked", as in Charlie.
      return { kind: "cmp", op: "!=", left, right: { kind: "num", value: 0, span: left.span }, span: this.span(t.start) };
    }
    if (t.kind === "ident" && KEYWORDS.has(t.text) && !TEMPORAL.has(t.text))
      this.fail(START_OF_FORMULA, `"${t.text}" is a reserved word; write "${t.text}" in double quotes to use it as a place name.`);
    this.fail(START_OF_FORMULA);
  }

  private term(): CtlTerm {
    const t = this.t;
    if (t.kind === "num") {
      this.next();
      return { kind: "num", value: Number(t.text), span: { start: t.start, end: t.end } };
    }
    if (this.isWord("sum")) {
      this.next();
      if (!this.isOp("(")) this.fail(['"("'], "sum takes a list of places in brackets, e.g. sum(p1, p2).");
      const open = this.next();
      const terms: CtlTerm[] = [this.term()];
      while (this.isOp(",")) {
        this.next();
        terms.push(this.term());
      }
      this.expectClose(open, ")");
      return { kind: "sum", terms, span: this.span(t.start) };
    }
    if (t.kind === "string") {
      this.next();
      return { kind: "place", name: t.text, quoted: true, span: { start: t.start, end: t.end } };
    }
    if (t.kind === "ident" && (t.colour || !KEYWORDS.has(t.text))) {
      this.next();
      return { kind: "place", name: t.text, ...(t.colour ? { colour: t.colour } : {}), span: { start: t.start, end: t.end } };
    }
    this.fail(["a place name", "a number", "sum(…)"]);
  }
}

/**
 * Parse a CTL formula. Throws a {@link CtlError} (kind "syntax") with the position and the
 * expected tokens when the text is malformed.
 *
 * Syntax (Charlie's CTL as used by Konios 2015, ch. 7):
 * - atoms: `p` (place p is marked, i.e. p != 0), `p > 0`, `p == 2`, comparisons `== = != <> < <= > >=`
 *   between place markings and whole numbers, `sum(p, q) >= 2`, `true`, `false`, `deadlock`,
 *   `fireable(t)` (also `enabled(t)`);
 * - coloured places: `p[c]` counts the tokens of colour c on p (c as written in the place's
 *   colour set, tuples as `p[1,a]`); a coloured place's name on its own counts all its tokens;
 * - names that clash with keywords or contain spaces go in double quotes: `"A" > 0`;
 * - boolean operators, from tightest to loosest: `!` (`~`, `not`); `&` (`&&`, `*`, `and`);
 *   `|` (`||`, `+`, `or`); `->` (`=>`, associating to the left as in Charlie); `<->` (`<=>`);
 * - temporal operators: `EX φ`, `AX φ`, `EF φ`, `AF φ`, `EG φ`, `AG φ` (bind like `!`),
 *   `E[φ U ψ]`, `A[φ U ψ]` (round brackets also accepted: `A(φ U ψ)`);
 * - a trailing `;` and `//` or `/* … *\/` comments are ignored.
 */
export function parseCtl(text: string): CtlFormula {
  return new Parser(text, lex(text)).parse();
}

// ---------------------------------------------------------------- printer

const PREC: Record<string, number> = { iff: 1, implies: 2, or: 3, and: 4 };

function needsQuote(name: string) {
  return !/^[A-Za-z_][A-Za-z0-9_'.]*$/.test(name) || KEYWORDS.has(name) || name.endsWith(".");
}

/** A place reference as formula text: `p`, `p[a]`, or `"odd name"` when needed. */
export function placeRef(name: string, colour?: string): string {
  if (colour !== undefined) return `${needsQuote(name) ? JSON.stringify(name) : name}[${colour}]`;
  const m = /^([A-Za-z_][A-Za-z0-9_'.]*)\[([^\]]+)\]$/.exec(name);
  if (m && !KEYWORDS.has(m[1])) return name;
  return needsQuote(name) ? JSON.stringify(name) : name;
}

function termText(t: CtlTerm): string {
  if (t.kind === "num") return String(t.value);
  if (t.kind === "sum") return `sum(${t.terms.map(termText).join(", ")})`;
  if (t.quoted) return JSON.stringify(t.name);
  return placeRef(t.name, t.colour);
}

/**
 * Canonical text of a formula, with only the brackets needed (and every chain of implications
 * bracketed explicitly, since their left association surprises readers).
 */
export function formatCtl(f: CtlFormula): string {
  const go = (f: CtlFormula, ctx: number): string => {
    switch (f.kind) {
      case "const":
        return f.value ? "true" : "false";
      case "deadlock":
        return "deadlock";
      case "fireable":
        return `fireable(${f.quoted ? JSON.stringify(f.transition) : f.transition})`;
      case "cmp":
        if (f.op === "!=" && f.right.kind === "num" && f.right.value === 0 && f.left.kind === "place") return termText(f.left);
        return `${termText(f.left)} ${f.op} ${termText(f.right)}`;
      case "not": {
        const a = go(f.arg, 9);
        const bare = f.arg.kind === "cmp" && !(f.arg.op === "!=" && f.arg.right.kind === "num" && f.arg.right.value === 0 && f.arg.left.kind === "place");
        return bare ? `!(${a})` : `!${a}`;
      }
      case "EX":
      case "AX":
      case "EF":
      case "AF":
      case "EG":
      case "AG":
        return `${f.kind}(${go(f.arg, 0)})`;
      case "EU":
      case "AU":
        return `${f.kind[0]}[${go(f.left, 0)} U ${go(f.right, 0)}]`;
      default: {
        const p = PREC[f.kind];
        const sym = f.kind === "and" ? "&" : f.kind === "or" ? "|" : f.kind === "implies" ? "->" : "<->";
        // Same-precedence chains: & and | are associative; -> and <-> get explicit brackets.
        const assoc = f.kind === "and" || f.kind === "or";
        const l = go(f.left, assoc ? p : p + 1);
        const r = go(f.right, p + 1);
        const s = `${l} ${sym} ${r}`;
        return p < ctx ? `(${s})` : s;
      }
    }
  };
  return go(f, 0);
}

// ---------------------------------------------------------------- binding to a net

/** A term with place references resolved to place indices (each counted once per occurrence). */
export type BoundTerm = { kind: "num"; value: number } | { kind: "places"; places: number[] };

/** A formula whose place and transition names are resolved against a transition system. */
export type BoundFormula =
  | { kind: "const"; value: boolean; src: CtlFormula }
  | { kind: "deadlock"; src: CtlFormula }
  | { kind: "fireable"; transitions: number[]; src: CtlFormula }
  | { kind: "cmp"; op: CompareOp; left: BoundTerm; right: BoundTerm; src: CtlFormula }
  | { kind: "not"; arg: BoundFormula; src: CtlFormula }
  | { kind: "and" | "or" | "implies" | "iff" | "EU" | "AU"; left: BoundFormula; right: BoundFormula; src: CtlFormula }
  | { kind: UnaryTemporal; arg: BoundFormula; src: CtlFormula };

/** Names a formula is checked against. */
export interface CtlVocabulary {
  places: readonly NodeRef[];
  transitions: readonly NodeRef[];
}

const normColour = (c: string) => {
  const s = c.replace(/\s+/g, "");
  return s.startsWith("(") && s.endsWith(")") ? s.slice(1, -1) : s;
};

function distance(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 4) return 99;
  let prev = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const cur = [i];
    for (let j = 1; j <= lb; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1));
    prev = cur;
  }
  return prev[lb];
}

function suggest(name: string, candidates: Iterable<string>): string[] {
  const scored: [string, number][] = [];
  for (const c of new Set(candidates)) {
    const d = distance(name, c);
    if (d <= Math.max(2, Math.floor(name.length / 3))) scored.push([c, d]);
  }
  return scored
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map((x) => x[0]);
}

/** Resolve a place name (optionally with a colour) to place indices; undefined if unknown. */
export function resolvePlace(vocab: CtlVocabulary, name: string, colour?: string): number[] | undefined {
  const P = vocab.places;
  if (colour !== undefined) {
    const want = normColour(colour);
    const hits: number[] = [];
    P.forEach((p, i) => {
      if (p.name === `${name}[${colour}]` || ((p.baseName ?? p.name) === name && p.colour !== undefined && normColour(p.colour) === want)) hits.push(i);
    });
    return hits.length ? hits : undefined;
  }
  const exact = P.findIndex((p) => p.name === name);
  if (exact >= 0) return [exact];
  const hits: number[] = [];
  P.forEach((p, i) => {
    if (p.baseName === name) hits.push(i);
  });
  return hits.length ? hits : undefined;
}

/** Resolve a transition name: an unfolded name such as "take<x=a>", or a coloured transition's name (any binding). */
export function resolveTransition(vocab: CtlVocabulary, name: string): number[] | undefined {
  const T = vocab.transitions;
  const norm = (s: string) => s.replace(/\s+/g, "");
  const exact = T.findIndex((t) => t.name === name || norm(t.name) === norm(name));
  if (exact >= 0) return [exact];
  const hits: number[] = [];
  T.forEach((t, i) => {
    if (t.baseName === name) hits.push(i);
  });
  return hits.length ? hits : undefined;
}

function placeNames(vocab: CtlVocabulary) {
  const s = new Set<string>();
  for (const p of vocab.places) {
    s.add(p.name);
    if (p.baseName) s.add(p.baseName);
  }
  return s;
}

/**
 * Resolve the names in a parsed formula. Throws a {@link CtlError} (kind "name") naming the first
 * unknown place or transition, with suggestions; use {@link ctlProblems} to collect all of them.
 */
export function bindCtl(f: CtlFormula, vocab: CtlVocabulary, text = ""): BoundFormula {
  const errors: CtlError[] = [];
  const r = bind(f, vocab, text, errors);
  if (errors.length) throw errors[0];
  return r;
}

function bind(f: CtlFormula, vocab: CtlVocabulary, text: string, errors: CtlError[]): BoundFormula {
  const term = (t: CtlTerm): BoundTerm => {
    if (t.kind === "num") return t;
    if (t.kind === "sum") return { kind: "places", places: t.terms.flatMap((x) => { const b = term(x); return b.kind === "places" ? b.places : []; }) };
    const idx = resolvePlace(vocab, t.name, t.colour);
    if (!idx) {
      const shown = t.colour !== undefined ? `${t.name}[${t.colour}]` : t.name;
      let msg: string;
      let sug: string[];
      const base = t.colour !== undefined ? resolvePlace(vocab, t.name) : undefined;
      if (base) {
        const colours = base.map((i) => vocab.places[i].colour).filter((c): c is string => !!c);
        sug = colours.map((c) => `${t.name}[${normColour(c)}]`);
        msg = colours.length
          ? `place ${t.name} has no colour "${t.colour}"; its colours are ${colours.slice(0, 8).map(normColour).join(", ")}${colours.length > 8 ? ", …" : ""}.`
          : `place ${t.name} is not coloured; leave out "[${t.colour}]".`;
      } else {
        sug = suggest(t.name, placeNames(vocab));
        msg = `unknown place "${shown}"${sug.length ? `; did you mean ${sug.map((s) => `"${s}"`).join(" or ")}?` : "."}`;
      }
      errors.push(new CtlError("name", text, t.span, msg, { suggestions: sug, found: shown }));
      return { kind: "places", places: [] };
    }
    return { kind: "places", places: idx };
  };
  const src = f;
  switch (f.kind) {
    case "const":
      return { kind: "const", value: f.value, src };
    case "deadlock":
      return { kind: "deadlock", src };
    case "fireable": {
      const idx = resolveTransition(vocab, f.transition);
      if (!idx) {
        const names = new Set<string>();
        for (const t of vocab.transitions) {
          names.add(t.name);
          if (t.baseName) names.add(t.baseName);
        }
        const sug = suggest(f.transition, names);
        errors.push(new CtlError("name", text, f.span, `unknown transition "${f.transition}"${sug.length ? `; did you mean ${sug.map((s) => `"${s}"`).join(" or ")}?` : "."}`, { suggestions: sug, found: f.transition }));
      }
      return { kind: "fireable", transitions: idx ?? [], src };
    }
    case "cmp":
      return { kind: "cmp", op: f.op, left: term(f.left), right: term(f.right), src };
    case "not":
      return { kind: "not", arg: bind(f.arg, vocab, text, errors), src };
    case "and":
    case "or":
    case "implies":
    case "iff":
    case "EU":
    case "AU":
      return { kind: f.kind, left: bind(f.left, vocab, text, errors), right: bind(f.right, vocab, text, errors), src };
    default:
      return { kind: f.kind, arg: bind(f.arg, vocab, text, errors), src };
  }
}

/**
 * Every problem with a formula against a net's names: the syntax error if it does not parse,
 * otherwise each unknown place or transition. An empty list means the formula can be checked.
 */
export function ctlProblems(text: string, vocab: CtlVocabulary): CtlError[] {
  let f: CtlFormula;
  try {
    f = parseCtl(text);
  } catch (e) {
    if (e instanceof CtlError) return [e];
    throw e;
  }
  const errors: CtlError[] = [];
  bind(f, vocab, text, errors);
  return errors;
}

/** The formula's state-local part has no temporal operator. */
export function isStateFormula(f: CtlFormula): boolean {
  switch (f.kind) {
    case "const":
    case "deadlock":
    case "fireable":
    case "cmp":
      return true;
    case "not":
      return isStateFormula(f.arg);
    case "and":
    case "or":
    case "implies":
    case "iff":
      return isStateFormula(f.left) && isStateFormula(f.right);
    default:
      return false;
  }
}
