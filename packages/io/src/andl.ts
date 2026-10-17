// ANDL / CANDL: Snoopy's abstract net description language (also read by Charlie, Marcie and Spike).
//
//   spn [name]
//   {
//   constants:
//     all:
//       double k = 0.5;
//   places:
//     P = 3;
//   transitions:
//     stochastic:
//       T
//         : [Q >= 1]             conditions (read [P >= n], inhibitor [P < n], equal [P = n])
//         : [P - 1] & [R + 1]    updates (reset [P = 0])
//         : MassAction(k)        rate / weight / delay (quantitative nets only)
//         ;
//   }
//
// Layout verified against Snoopy's export and import code (sp_core/export/SP_ExportANDL.cpp and the
// dssd ANDL grammar). CANDL (the coloured variant) follows the same code but is UNVERIFIED against a
// real file: colour sets, variables and coloured markings are written as Snoopy's CANDL exporter does
// to the best of our reading.
//
// Functions, observers and modifier arcs: Snoopy's net builder (sp_core/tools/SP_SimpleNetBuilder.cpp)
// passes user functions (name, parameter text, body), observers (place/transition, name, body) and
// modifier arcs (a MODIFIER_T condition) to the dssd ANDL writer, whose text syntax we could not see.
// UNVERIFIED: we write
//
//   functions:
//     hill(S,K,n) = S^n / (K^n + S^n);
//   observers:
//     place:
//       total = A + B;
//     transition:
//       flow = r1 + r2;
//
// and CANDL colour functions as "double f(int x,int y) { body };" in the colorfunctions: section
// (Snoopy's coloured nets keep typed colour functions; our functions are untyped, so parameter types
// are those of a variable of the same name, else int). Modifier arcs and fixed places are left out
// (they do not change the behaviour of a stochastic net; fixed places only matter to simulators).

import {
  Arc,
  ColourSetDecl,
  ConstantDecl,
  FunctionDecl,
  ObserverDecl,
  Expr,
  Net,
  NetClass,
  Place,
  Transition,
  TransitionKind,
  defaultTransitionKind,
  emptyNet,
  isColoured,
  parse,
  timeBase,
} from "@pns/core";
import {
  ExportError,
  Names,
  arcsOf,
  assignNames,
  functionSignature,
  gridPosition,
  parseExpr,
  printExpr,
  requireClass,
  splitParams,
  weightOf,
} from "./text-common";

const ANDL_CLASSES: NetClass[] = ["pt", "xpt", "timed", "music", "stochastic", "continuous", "hybrid"];
const CANDL_CLASSES: NetClass[] = ["coloured", "colouredStochastic", "colouredContinuous", "colouredHybrid"];

function exprStyle(names: Names) {
  return {
    and: "&",
    or: "|",
    not: "!",
    eq: "=",
    ne: "<>",
    id: (n: string) => names.byName.get(n) ?? n,
  };
}

function rewrite(src: string, names: Names, what: string, bound?: string[]): string {
  const style = exprStyle(names);
  if (bound?.length) {
    const id = style.id;
    style.id = (n: string) => (bound.includes(n) ? n : id(n));
  }
  return printExpr(parseExpr(src, what), style);
}

function writeFunctions(lines: string[], net: Net, names: Names) {
  const fns = net.declarations.functions ?? [];
  if (!fns.length) return;
  lines.push("functions:");
  for (const f of fns) lines.push(`  ${f.name}(${f.params.join(",")}) = ${rewrite(f.body, names, `The body of function "${f.name}"`, f.params)};`);
}

function writeObservers(lines: string[], net: Net, names: Names) {
  const obs = net.declarations.observers ?? [];
  if (!obs.length) return;
  lines.push("observers:");
  for (const kind of ["place", "transition"] as const) {
    const list = obs.filter((o) => o.kind === kind);
    if (!list.length) continue;
    lines.push(`  ${kind}:`);
    for (const o of list) lines.push(`    ${o.name} = ${rewrite(o.expression, names, `The observer "${o.name}"`)};`);
  }
}

function andlType(net: Net): string {
  const extended = net.arcs.some((a) => a.kind !== "normal");
  switch (net.netClass) {
    case "pt":
    case "xpt":
      return extended || net.netClass === "xpt" ? "xpn" : "pn";
    case "timed":
    case "music":
      return "xpn";
    case "stochastic":
      return net.transitions.some((t) => t.kind && t.kind !== "stochastic") ? "gspn" : extended ? "xspn" : "spn";
    case "continuous":
      return "cpn";
    case "hybrid":
      return "hpn";
    case "coloured":
      return extended ? "colxpn" : "colpn";
    case "colouredStochastic":
      return "colspn";
    case "colouredContinuous":
      return "colcpn";
    case "colouredHybrid":
      return "colhpn";
    default:
      throw new ExportError(`No ANDL type for ${net.netClass}.`);
  }
}

function writeConstants(lines: string[], net: Net, names: Names) {
  const consts = net.declarations.constants;
  lines.push("constants:");
  const groups = new Map<string, ConstantDecl[]>();
  for (const c of consts) {
    const g = c.group?.trim() || "all";
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }
  for (const [g, cs] of groups) {
    lines.push(`  ${g}:`);
    for (const c of cs) {
      const v = c.value.trim();
      const type = constantType(net, v);
      lines.push(`    ${type} ${names.constant.get(c.name)} = ${rewrite(v || "0", names, `The value of constant "${c.name}"`)};`);
    }
  }
}

/** int, double, bool, or (coloured nets) the enumeration a constant belongs to. */
function constantType(net: Net, v: string): string {
  if (/^[+-]?\d+$/.test(v)) return "int";
  if (/^(true|false)$/.test(v)) return "bool";
  const en = net.declarations.colourSets.find((c) => c.type === "enum" && c.values?.includes(v));
  if (en) return en.name;
  if (/(<|>|=|\b(and|or|not)\b|&|\||!)/.test(v)) return "bool";
  return "double";
}

function kindOf(net: Net, t: Transition): TransitionKind | undefined {
  return t.kind ?? defaultTransitionKind(net.netClass);
}

const KIND_ORDER: (TransitionKind | "plain")[] = ["plain", "stochastic", "immediate", "deterministic", "scheduled", "continuous"];

function defaultRate(kind: TransitionKind | "plain"): string {
  switch (kind) {
    case "immediate":
    case "deterministic":
      return "1";
    case "scheduled":
      return "_SimStart, 1, _SimEnd";
    case "plain":
      return "";
    default:
      return "MassAction(1)";
  }
}

function writeTransitions(
  lines: string[],
  net: Net,
  names: Names,
  conditionsAndUpdates: (t: Transition) => { conditions: string[]; updates: string[] },
) {
  lines.push("transitions:");
  const base = timeBase(net.netClass);
  const byKind = new Map<string, Transition[]>();
  for (const t of names.transitions) {
    const k = base ? kindOf(net, t) ?? "stochastic" : "plain";
    if (base === "continuous" && k !== "continuous")
      throw new ExportError(`ANDL continuous nets only have continuous transitions; "${t.name}" is ${k}.`);
    byKind.set(k, [...(byKind.get(k) ?? []), t]);
  }
  for (const k of KIND_ORDER) {
    const ts = byKind.get(k);
    if (!ts) continue;
    const indent = k === "plain" ? "  " : "    ";
    if (k !== "plain") lines.push(`  ${k}:`);
    for (const t of ts) {
      const { conditions, updates } = conditionsAndUpdates(t);
      lines.push(`${indent}${names.transition.get(t.id)}`);
      lines.push(`${indent}  : ${conditions.join(" & ")}`);
      lines.push(`${indent}  : ${updates.join(" & ")}`);
      if (k !== "plain") {
        const rate = t.rate?.trim() || defaultRate(k);
        const printed = k === "scheduled" ? rate.split(",").map((x) => rewrite(x.trim(), names, `The schedule of "${t.name}"`)).join(", ") : rewrite(rate, names, `The rate of "${t.name}"`);
        lines.push(`${indent}  : ${printed}`);
      }
      lines.push(`${indent}  ;`);
    }
  }
}

function placeConditionsAndUpdates(net: Net, names: Names, weight: (a: Arc, what: string) => string) {
  const arcs = arcsOf(net, names);
  return (t: Transition) => {
    const { pre, post } = arcs.get(t.id)!;
    const conditions: string[] = [];
    const updates: string[] = [];
    for (const { place, arc } of pre) {
      const w = () => weight(arc, `The weight of the arc ${place} -> ${names.transition.get(t.id)}`);
      switch (arc.kind) {
        case "normal":
          updates.push(`[${place} - ${w()}]`);
          break;
        case "read":
          conditions.push(`[${place} >= ${w()}]`);
          break;
        case "inhibitor":
          conditions.push(`[${place} < ${w()}]`);
          break;
        case "equal":
          conditions.push(`[${place} = ${w()}]`);
          break;
        case "reset":
          updates.push(`[${place} = 0]`);
          break;
      }
    }
    for (const { place, arc } of post) updates.push(`[${place} + ${weight(arc, `The weight of the arc ${names.transition.get(t.id)} -> ${place}`)}]`);
    return { conditions, updates };
  };
}

/** Exports a P/T, extended, timed or music (as untimed extended nets), stochastic, continuous or hybrid net as ANDL. */
export function exportAndl(net: Net): string {
  requireClass(net, "ANDL", ANDL_CLASSES);
  const names = assignNames(net);
  const lines: string[] = [...droppedNotes(net), `${andlType(net)} [${sanitizeNetName(net.name)}]`, "{"];
  writeConstants(lines, net, names);
  writeFunctions(lines, net, names);
  lines.push("places:");
  const base = timeBase(net.netClass);
  const placeLine = (p: Place, indent: string) => {
    const m = p.marking.trim() === "" ? "0" : rewrite(p.marking, names, `The marking of "${p.name}"`);
    return `${indent}${names.place.get(p.id)} = ${m};`;
  };
  if (base === "hybrid" || base === "continuous") {
    const discrete = names.places.filter((p) => base === "hybrid" && !p.continuous);
    const continuous = names.places.filter((p) => base === "continuous" || p.continuous);
    if (discrete.length) {
      lines.push("  discrete:");
      for (const p of discrete) lines.push(placeLine(p, "    "));
    }
    if (continuous.length) {
      lines.push("  continuous:");
      for (const p of continuous) lines.push(placeLine(p, "    "));
    }
  } else for (const p of names.places) lines.push(placeLine(p, "  "));
  writeTransitions(lines, net, names, placeConditionsAndUpdates(net, names, (a, what) => rewrite(weightOf(a), names, what)));
  writeObservers(lines, net, names);
  lines.push("}");
  return lines.join("\n") + "\n";
}

/**
 * Timed and music nets have no ANDL type; their untimed structure is written as an extended net (xpn)
 * after a comment saying what was left out. UNVERIFIED: that Snoopy's dssd ANDL reader accepts "//"
 * comments before the net type (Charlie and Marcie do; our importer strips them).
 */
function droppedNotes(net: Net): string[] {
  if (net.netClass === "timed") {
    const n = net.transitions.filter((t) => t.interval).length;
    return [`// Timed net exported as an extended Petri net: ${n ? `the firing intervals of ${n} transition${n === 1 ? "" : "s"} were dropped` : "it has no firing intervals"}.`];
  }
  if (net.netClass === "music") {
    const n = net.transitions.filter((t) => t.sound).length;
    return [`// Music net exported as an extended Petri net: ${n ? `the sounds of ${n} transition${n === 1 ? "" : "s"} were dropped` : "it has no sounds"}.`];
  }
  return [];
}

function sanitizeNetName(name: string): string {
  return name.replace(/[\]\n\r]/g, " ").trim();
}

/** Exports a coloured net as CANDL. UNVERIFIED against real Snoopy CANDL files (see the header comment). */
export function exportCandl(net: Net): string {
  requireClass(net, "CANDL", CANDL_CLASSES);
  const names = assignNames(net);
  const d = net.declarations;
  const lines: string[] = [`${andlType(net)} [${sanitizeNetName(net.name)}]`, "{"];
  writeConstants(lines, net, names);
  lines.push("colorsets:");
  for (const c of d.colourSets) {
    switch (c.type) {
      case "dot":
        lines.push(`  Dot ${c.name} = {dot};`);
        break;
      case "enum":
        lines.push(`  Enum ${c.name} = {${(c.values ?? []).join(",")}};`);
        break;
      case "int":
        lines.push(`  Int ${c.name} = {${c.min ?? 0}..${c.max ?? 0}};`);
        break;
      case "product":
        lines.push(`  Prod ${c.name} = PROD(${(c.components ?? []).join(",")});`);
        break;
      case "bool":
        // UNVERIFIED: dssd has no bool colour set type; Snoopy writes the colours as given.
        lines.push(`  Bool ${c.name} = {false,true};`);
        break;
      case "string":
        // Snoopy's builder quotes string colours (SP_SimpleNetBuilder.cpp).
        lines.push(`  String ${c.name} = {${(c.values ?? []).map((v) => `"${v}"`).join(",")}};`);
        break;
      case "alias": {
        // Snoopy's CANDL export ignores alias sets; we repeat the base set's definition, with a comment
        // that lets our import restore the alias (other readers ignore it).
        const base = d.colourSets.find((x) => x.name === c.components?.[0]);
        if (!base) throw new ExportError(`The alias colour set "${c.name}" refers to an unknown colour set.`);
        const def =
          base.type === "subset"
            ? `  ${CANDL_KEYWORD[d.colourSets.find((x) => x.name === base.components?.[0])?.type ?? ""] ?? "Enum"} ${c.name} = ${base.components?.[0]}[${base.predicate?.trim() || "true"}];`
            : candlColourSet({ ...base, name: c.name }, d.colourSets);
        lines.push(`${def} // alias of ${base.name}`);
        break;
      }
      case "subset": {
        // UNVERIFIED: Snoopy writes subsets as "Parent[predicate]" (SP_SimpleNetBuilder.cpp).
        const base = d.colourSets.find((x) => x.name === c.components?.[0]);
        if (!base) throw new ExportError(`The subset colour set "${c.name}" refers to an unknown colour set.`);
        lines.push(`  ${CANDL_KEYWORD[base.type] ?? "Enum"} ${c.name} = ${base.name}[${c.predicate?.trim() || "true"}];`);
        break;
      }
      case "union":
        throw new ExportError(`CANDL has no union colour sets ("${c.name}"); Snoopy cannot export them either.`);
    }
  }
  lines.push("variables:");
  for (const v of d.variables) lines.push(`  ${v.colourSet} : ${v.name};`);
  lines.push("colorfunctions:");
  for (const f of d.functions ?? []) {
    const sig = functionSignature(net, f);
    lines.push(
      `  ${sig.returnType} ${f.name}(${sig.params.map((p) => `${p.type} ${p.name}`).join(",")}) { ${rewrite(f.body, names, `The body of function "${f.name}"`, f.params)} };`,
    );
  }
  lines.push("places:");
  const base = timeBase(net.netClass);
  const placeLine = (p: Place, indent: string) => {
    const cs = p.colourSet ?? "Dot";
    const m = p.marking.trim();
    const marking = m === "" ? "" : ` = ${candlMultiset(m, cs, names)}`;
    return `${indent}${cs} ${names.place.get(p.id)}${marking};`;
  };
  if (base === "hybrid" || base === "continuous") {
    const discrete = names.places.filter((p) => base === "hybrid" && !p.continuous);
    const continuous = names.places.filter((p) => base === "continuous" || p.continuous);
    if (discrete.length) lines.push("  discrete:", ...discrete.map((p) => placeLine(p, "    ")));
    if (continuous.length) lines.push("  continuous:", ...continuous.map((p) => placeLine(p, "    ")));
  } else for (const p of names.places) lines.push(placeLine(p, "  "));
  const arcs = arcsOf(net, names);
  writeTransitions(lines, net, names, (t) => {
    const { pre, post } = arcs.get(t.id)!;
    const conditions: string[] = [];
    if (t.guard?.trim()) conditions.push(`[${rewrite(t.guard, names, `The guard of "${t.name}"`)}]`);
    const updates: string[] = [];
    const csOf = (a: Arc) => net.places.find((p) => p.id === a.source || p.id === a.target)?.colourSet ?? "Dot";
    const ms = (a: Arc) => `{${candlMultiset(weightOf(a), csOf(a), names)}}`;
    for (const { place, arc } of pre) {
      switch (arc.kind) {
        case "normal":
          updates.push(`[${place} - ${ms(arc)}]`);
          break;
        case "read":
          conditions.push(`[${place} >= ${ms(arc)}]`);
          break;
        case "inhibitor":
          conditions.push(`[${place} < ${ms(arc)}]`);
          break;
        case "equal":
          conditions.push(`[${place} = ${ms(arc)}]`);
          break;
        case "reset":
          updates.push(`[${place} = 0]`);
          break;
      }
    }
    for (const { place, arc } of post) updates.push(`[${place} + ${ms(arc)}]`);
    return { conditions, updates };
  });
  writeObservers(lines, net, names);
  lines.push("}");
  return lines.join("\n") + "\n";
}

const CANDL_KEYWORD: Partial<Record<string, string>> = { dot: "Dot", enum: "Enum", int: "Int", product: "Prod", bool: "Bool", string: "String" };

/** One colorsets: line for a dot, enum, int, product, bool or string set. */
function candlColourSet(c: ColourSetDecl, all: ColourSetDecl[]): string {
  switch (c.type) {
    case "dot":
      return `  Dot ${c.name} = {dot};`;
    case "enum":
      return `  Enum ${c.name} = {${(c.values ?? []).join(",")}};`;
    case "int":
      return `  Int ${c.name} = {${c.min ?? 0}..${c.max ?? 0}};`;
    case "product":
      return `  Prod ${c.name} = PROD(${(c.components ?? []).join(",")});`;
    case "bool":
      return `  Bool ${c.name} = {false,true};`;
    case "string":
      return `  String ${c.name} = {${(c.values ?? []).map((v) => `"${v}"`).join(",")}};`;
    default: {
      const base = all.find((x) => x.name === c.components?.[0]);
      if (c.type === "alias" && base && base !== c) return candlColourSet({ ...base, name: c.name }, all);
      throw new ExportError(`The colour set "${c.name}" cannot be repeated under another name in CANDL.`);
    }
  }
}

/** Multiset in Snoopy notation: n`c ++ m`d; all(CS) becomes all(). A bare number on a Dot place is n`dot. */
function candlMultiset(src: string, cs: string, names: Names): string {
  const e = parseExpr(src, "A marking or inscription");
  const term = (x: Expr): string => {
    if (x.k === "bin" && x.op === "++") return `${term(x.l)}++${term(x.r)}`;
    if (x.k === "num" && cs === "Dot") return `${x.v}\`dot`;
    if (x.k === "call" && x.name === "all") return "all()";
    if (x.k === "bin" && x.op === "`") return `${printExpr(x.l, exprStyle(names))}\`${printExpr(x.r, exprStyle(names))}`;
    return printExpr(x, exprStyle(names));
  };
  return term(e);
}

// ---------------------------------------------------------------------------------------------
// Import

export interface AndlImportResult {
  net: Net;
  warnings: string[];
}

const TYPE_TO_CLASS: Record<string, NetClass> = {
  colpn: "coloured",
  colxpn: "coloured",
  colspn: "colouredStochastic",
  colxspn: "colouredStochastic",
  colgspn: "colouredStochastic",
  colxgspn: "colouredStochastic",
  colcpn: "colouredContinuous",
  colhpn: "colouredHybrid",
  pn: "pt",
  xpn: "xpt",
  spn: "stochastic",
  xspn: "stochastic",
  gspn: "stochastic",
  xgspn: "stochastic",
  cpn: "continuous",
  hpn: "hybrid",
};

/**
 * Reads ANDL of place/transition, extended, stochastic (including generalised), continuous and hybrid
 * nets: constants, places (discrete/continuous) and transitions with conditions, updates and functions.
 * Functions and observers sections are read (UNVERIFIED syntax, see the header).
 *
 * CANDL (colpn, colxpn, colspn, colgspn, colcpn, colhpn) is read as the inverse of exportCandl:
 * colorsets, variables, constants (also of enumeration type), colorfunctions, places "CS P = ms;",
 * transitions whose conditions hold the guard and the read/inhibitor/equal arcs ("[P >= {ms}]") and
 * whose updates hold the ordinary and reset arcs ("[P - {ms}]", "[P = 0]"), and observers. Multisets
 * go back to our notation: "all()" becomes all(CS) and "n`dot" on a black-token place becomes n.
 * UNVERIFIED against files written by Snoopy itself (see the header). Nodes are laid out on a grid.
 */
export function importAndl(text: string): AndlImportResult {
  return new AndlParser(text).run();
}

class AndlParser {
  private pos = 0;
  private warnings: string[] = [];
  private src: string;
  /** CANDL colour sets written by exportCandl as copies of another set ("// alias of Base"). */
  private aliases = new Map<string, string>();
  constructor(text: string) {
    for (const m of text.matchAll(/^[ \t]*[A-Za-z_]\w*[ \t]+([A-Za-z_]\w*)[ \t]*=[^\n]*;[ \t]*\/\/[ \t]*alias of[ \t]+([A-Za-z_]\w*)/gm))
      this.aliases.set(m[1], m[2]);
    // Strip comments: // line and /* block */.
    this.src = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
  }

  private fail(msg: string): never {
    const line = this.src.slice(0, this.pos).split("\n").length;
    throw new Error(`ANDL, line ${line}: ${msg}`);
  }
  private ws() {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
  }
  private peekWord(): string | undefined {
    this.ws();
    return /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.src.slice(this.pos))?.[0];
  }
  private word(what: string): string {
    const w = this.peekWord();
    if (!w) this.fail(`expected ${what}`);
    this.pos += w.length;
    return w;
  }
  private eat(s: string): boolean {
    this.ws();
    if (this.src.startsWith(s, this.pos)) {
      this.pos += s.length;
      return true;
    }
    return false;
  }
  private expect(s: string) {
    if (!this.eat(s)) this.fail(`expected "${s}"`);
  }
  /** Text up to (not including) one of the stop characters at bracket depth 0. */
  private until(stops: string): string {
    this.ws();
    const start = this.pos;
    let depth = 0;
    while (this.pos < this.src.length) {
      const c = this.src[this.pos];
      if (depth === 0 && stops.includes(c)) break;
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      this.pos++;
    }
    return this.src.slice(start, this.pos).trim();
  }
  /** "section:" label (e.g. "places:") if one follows. */
  private label(): string | undefined {
    this.ws();
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:(?!=)/.exec(this.src.slice(this.pos));
    if (!m) return undefined;
    return m[1];
  }
  private takeLabel() {
    this.word("a section");
    this.expect(":");
  }

  run(): AndlImportResult {
    const type = this.word("the net type (pn, xpn, spn, gspn, cpn, hpn or a coloured colpn, colspn, colcpn, colhpn)");
    const netClass = TYPE_TO_CLASS[type];
    if (!netClass) this.fail(`unknown net type "${type}"; expected pn, xpn, spn, gspn, cpn, hpn, colpn, colxpn, colspn, colcpn or colhpn.`);
    const coloured = isColoured(netClass);
    let name = "Untitled";
    if (this.eat("[")) {
      name = this.until("]") || name;
      this.expect("]");
    }
    this.expect("{");
    const net = emptyNet(netClass);
    net.name = name;
    const placeIds = new Map<string, string>();
    const transitionIds = new Map<string, string>();
    const pendingArcs: { t: Transition; conditions: string; updates: string }[] = [];
    const base = timeBase(netClass);
    // The file declares every colour set itself (Dot is added back below when places need it).
    const sets = net.declarations.colourSets;
    sets.length = 0;
    const placeSet = new Map<string, string>();

    for (;;) {
      if (this.eat("}")) break;
      const section = this.label();
      if (!section) this.fail("expected a section such as constants:, places: or transitions:");
      this.takeLabel();
      if (section === "constants" || section === "parameters") {
        let group = "all";
        for (;;) {
          const l = this.label();
          if (l && !SECTIONS.includes(l)) {
            this.takeLabel();
            group = l;
            continue;
          }
          const w = this.peekWord();
          if (!w || l) break;
          // "type name = value;" where type is int, double, bool, a fuzzy type or (CANDL) an enumeration.
          if (!/^[A-Za-z_]\w*\s+[A-Za-z_]\w*\s*=/.test(this.src.slice(this.pos))) break;
          this.word("type");
          const cname = this.word("a constant name");
          this.expect("=");
          const value = this.until(";");
          this.expect(";");
          const c: ConstantDecl = { name: cname, value };
          if (group !== "all") c.group = group;
          net.declarations.constants.push(c);
        }
      } else if (section === "colorsets") {
        for (;;) {
          if (this.label()) break;
          const kw = this.peekWord();
          if (!kw) break;
          this.word("a colour set type");
          const csName = this.word("a colour set name");
          this.expect("=");
          const def = this.until(";");
          this.expect(";");
          if (sets.some((c) => c.name === csName)) this.fail(`the colour set "${csName}" is declared twice.`);
          sets.push(this.colourSet(kw, csName, def, net));
        }
      } else if (section === "variables") {
        for (;;) {
          this.ws();
          const m = /^([A-Za-z_]\w*)\s*:\s*([A-Za-z_][\w\s,]*);/.exec(this.src.slice(this.pos));
          if (!m) break;
          this.pos += m[0].length;
          for (const v of m[2].split(",").map((x) => x.trim()).filter(Boolean)) net.declarations.variables.push({ name: v, colourSet: m[1] });
        }
      } else if (section === "places") {
        let continuous = base === "continuous";
        for (;;) {
          const l = this.label();
          if (l === "discrete" || l === "continuous") {
            this.takeLabel();
            continuous = l === "continuous";
            continue;
          }
          if (l) break;
          const w = this.peekWord();
          if (!w) break;
          this.word("place");
          let pname = w;
          let cs: string | undefined;
          if (coloured) {
            cs = w;
            pname = this.word("a place name");
          } else if (this.peekWord() && !this.src.slice(this.pos).trimStart().startsWith("="))
            this.fail(`"${w}" looks like a coloured place ("ColourSet name = marking;"), but the net type is not coloured.`);
          let marking = coloured ? "" : "0";
          if (this.eat("=")) marking = this.until(";");
          this.expect(";");
          const id = `p${net.places.length}`;
          const g = gridPosition(net.places.length);
          const p: Place = { id, name: pname, x: g.x, y: g.y, marking: marking === "0" && !coloured ? "" : marking };
          if (cs) {
            p.colourSet = cs;
            p.marking = marking ? this.multiset(marking, cs, sets) : "";
            placeSet.set(pname, cs);
          }
          if (continuous && base === "hybrid") p.continuous = true;
          if (placeIds.has(pname)) this.fail(`the place "${pname}" is declared twice.`);
          placeIds.set(pname, id);
          net.places.push(p);
        }
      } else if (section === "transitions") {
        let kind: TransitionKind | undefined = base === "continuous" ? "continuous" : base ? "stochastic" : undefined;
        for (;;) {
          const l = this.label();
          if (l && ["stochastic", "immediate", "deterministic", "scheduled", "continuous", "timed"].includes(l)) {
            this.takeLabel();
            kind = l === "timed" ? "deterministic" : (l as TransitionKind);
            continue;
          }
          if (l && (SECTIONS.includes(l) || l === "place" || l === "transition")) break;
          const w = this.peekWord();
          if (!w) break;
          this.word("transition");
          if (this.eat("{")) {
            const attr = this.until("}");
            this.expect("}");
            if (attr.includes("rev")) this.warnOnce("Reversible transitions ({rev}) were imported in their forward direction only.");
          }
          this.expect(":");
          const conditions = this.until(":;");
          let updates = "";
          let fn = "";
          if (this.eat(":")) {
            updates = this.until(":;");
            if (this.eat(":")) fn = this.until(";");
          }
          this.expect(";");
          const id = `t${net.transitions.length}`;
          const g = gridPosition(net.transitions.length);
          const t: Transition = { id, name: w, x: g.x + 60, y: g.y + 60 };
          if (base && kind && kind !== defaultTransitionKind(netClass)) t.kind = kind;
          if (fn) {
            if (base) t.rate = fn;
            else this.warnOnce("Functions on transitions of an untimed net were ignored.");
          }
          if (transitionIds.has(w)) this.fail(`the transition "${w}" is declared twice.`);
          transitionIds.set(w, id);
          net.transitions.push(t);
          pendingArcs.push({ t, conditions, updates });
        }
      } else if (section === "functions" || section === "colorfunctions") {
        // UNVERIFIED syntax (see the header): [type] name(params) = body;
        for (;;) {
          if (this.label()) break;
          const w = this.peekWord();
          if (!w) break;
          let fname = this.word("a function name");
          if (!this.src.slice(this.pos).trimStart().startsWith("(")) fname = this.word("a function name");
          this.expect("(");
          const params = splitParams(this.until(")"));
          this.expect(")");
          if (!this.eat("=")) this.expect("{");
          const body = this.until(";}");
          this.eat("}");
          this.expect(";");
          (net.declarations.functions ??= []).push({ name: fname, params, body } as FunctionDecl);
        }
      } else if (section === "observers") {
        let kind: ObserverDecl["kind"] = "place";
        for (;;) {
          const l = this.label();
          if (l === "place" || l === "transition") {
            this.takeLabel();
            kind = l;
            continue;
          }
          if (l) break;
          const w = this.peekWord();
          if (!w) break;
          this.word("an observer name");
          this.expect("=");
          const expression = this.until(";");
          this.expect(";");
          (net.declarations.observers ??= []).push({ name: w, kind, expression });
        }
      } else this.fail(`unknown section "${section}:"`);
    }

    // Arcs from conditions and updates.
    let n = 0;
    const arc = (source: string, target: string, kind: Arc["kind"], inscription: string) =>
      net.arcs.push({ id: `a${n++}`, source, target, kind, inscription });
    for (const { t, conditions, updates } of pendingArcs) {
      if (coloured) {
        this.colouredArcs(t, conditions, updates, placeIds, placeSet, arc, sets);
        continue;
      }
      for (const c of splitTerms(conditions)) {
        const m = /^\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<|=|>)\s*(.+)\]$/s.exec(c);
        if (!m) this.fail(`cannot read the condition "${c}" of "${t.name}".`);
        const pid = placeIds.get(m[1]);
        if (!pid) this.fail(`the condition "${c}" of "${t.name}" uses the unknown place "${m[1]}".`);
        const w = m[3].trim();
        if (m[2] === ">=") arc(pid, t.id, "read", w);
        else if (m[2] === ">") arc(pid, t.id, "read", isIntegerText(w) ? String(Number(w) + 1) : `${w} + 1`);
        else if (m[2] === "<") arc(pid, t.id, "inhibitor", w);
        else arc(pid, t.id, "equal", w);
      }
      for (const u of splitTerms(updates)) {
        const m = /^\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*([-+=])\s*(.+)\]$/s.exec(u);
        if (!m) this.fail(`cannot read the update "${u}" of "${t.name}".`);
        const pid = placeIds.get(m[1]);
        if (!pid) this.fail(`the update "${u}" of "${t.name}" uses the unknown place "${m[1]}".`);
        const w = m[3].trim();
        if (m[2] === "-") arc(pid, t.id, "normal", w);
        else if (m[2] === "+") arc(t.id, pid, "normal", w);
        else if (w === "0") arc(pid, t.id, "reset", "");
        else this.fail(`the update "${u}" of "${t.name}" sets a place to ${w}; only resets to 0 are supported.`);
      }
    }
    if (net.arcs.some((a) => a.kind !== "normal") && net.netClass === "pt") net.netClass = "xpt";
    // exportCandl writes places without a colour set as "Dot"; declare it if the file does not.
    if (coloured && net.places.some((p) => p.colourSet === "Dot") && !sets.some((c) => c.name === "Dot")) sets.unshift({ name: "Dot", type: "dot" });
    for (const t of net.transitions) {
      if (t.rate)
        try {
          parse(t.rate);
        } catch (e) {
          this.warnOnce(`The function of "${t.name}" (${t.rate}) is not a valid expression: ${(e as Error).message}`);
        }
    }
    return { net, warnings: this.warnings };
  }

  /** One CANDL colour set: "Kw Name = definition". */
  private colourSet(kw: string, name: string, def: string, net: Net): ColourSetDecl {
    const sets = net.declarations.colourSets;
    const k = kw.toLowerCase();
    const alias = this.aliases.get(name);
    if (alias && sets.some((c) => c.name === alias)) return { name, type: "alias", components: [alias] };
    if (k === "dot" || /^\{\s*dot\s*\}$/.test(def)) return { name, type: "dot" };
    let m = /^PROD\s*\(([\s\S]*)\)$/i.exec(def);
    if (m) return { name, type: "product", components: splitList(m[1]) };
    // UNVERIFIED: exportCandl refuses unions (as Snoopy does); this form is only a guess.
    m = /^UNION\s*\(([\s\S]*)\)$/i.exec(def);
    if (m) return { name, type: "union", components: splitList(m[1]) };
    m = /^([A-Za-z_]\w*)\s*\[([\s\S]*)\]$/.exec(def);
    if (m) return { name, type: "subset", components: [m[1]], predicate: m[2].trim() };
    m = /^([A-Za-z_]\w*)$/.exec(def);
    if (m && sets.some((c) => c.name === m![1])) return { name, type: "alias", components: [m[1]] };
    if (k === "bool") return { name, type: "bool" };
    m = /^\{([\s\S]*)\}$/.exec(def);
    if (!m) this.fail(`cannot read the definition of the colour set "${name}": ${def}`);
    const inner = m[1].trim();
    const range = /^([+-]?\w+)\s*\.\.\s*([+-]?\w+)$/.exec(inner);
    const bound = (x: string) => {
      const v = /^[+-]?\d+$/.test(x) ? Number(x) : Number(net.declarations.constants.find((c) => c.name === x)?.value);
      if (!Number.isInteger(v)) this.fail(`the bound "${x}" of the colour set "${name}" is not a whole number.`);
      return v;
    };
    if (range) return { name, type: "int", min: bound(range[1]), max: bound(range[2]) };
    const values = splitList(inner);
    if (k === "string" || (values.length && values.every((v) => /^".*"$/.test(v))))
      return { name, type: "string", values: values.map((v) => v.replace(/^"(.*)"$/, "$1")) };
    if (k === "int") {
      const nums = values.map(Number);
      const lo = Math.min(...nums);
      if (nums.some((n) => !Number.isInteger(n)) || [...nums].sort((a, b) => a - b).some((n, i) => n !== lo + i))
        this.fail(`the integer colour set "${name}" is not a range of consecutive numbers; only ranges are supported.`);
      return { name, type: "int", min: lo, max: lo + nums.length - 1 };
    }
    return { name, type: "enum", values };
  }

  /** A CANDL multiset (marking or "{...}" inscription) in our notation for a place of colour set cs. */
  private multiset(text: string, cs: string, sets: ColourSetDecl[]): string {
    let s = text.trim();
    if (s.startsWith("{") && s.endsWith("}")) s = s.slice(1, -1).trim();
    s = s.replace(/\ball\(\s*\)/g, `all(${cs})`);
    if (sets.find((c) => c.name === cs)?.type === "dot") {
      const m = /^(\d+)\s*`\s*dot$/.exec(s);
      if (m) return m[1];
    }
    return s;
  }

  /** CANDL conditions ("[guard]", "[P >= {ms}]", "[P < {ms}]", "[P = {ms}]") and updates ("[P - {ms}]", "[P + {ms}]", "[P = 0]"). */
  private colouredArcs(
    t: Transition,
    conditions: string,
    updates: string,
    placeIds: Map<string, string>,
    placeSet: Map<string, string>,
    arc: (source: string, target: string, kind: Arc["kind"], inscription: string) => void,
    all: ColourSetDecl[],
  ) {
    const guards: string[] = [];
    for (const c of splitTerms(conditions)) {
      const m = /^\[\s*([A-Za-z_]\w*)\s*(>=|<|=)\s*(\{[\s\S]*\})\s*\]$/.exec(c);
      if (m && placeIds.has(m[1])) {
        const kind = m[2] === ">=" ? "read" : m[2] === "<" ? "inhibitor" : "equal";
        arc(placeIds.get(m[1])!, t.id, kind, this.multiset(m[3], placeSet.get(m[1])!, all));
        continue;
      }
      const g = /^\[([\s\S]*)\]$/.exec(c);
      if (!g) this.fail(`cannot read the condition "${c}" of "${t.name}".`);
      guards.push(g[1].trim());
    }
    if (guards.length) t.guard = guards.length === 1 ? guards[0] : guards.map((g) => `(${g})`).join(" & ");
    for (const u of splitTerms(updates)) {
      const m = /^\[\s*([A-Za-z_]\w*)\s*([-+=])\s*([\s\S]+)\]$/.exec(u);
      if (!m) this.fail(`cannot read the update "${u}" of "${t.name}".`);
      const pid = placeIds.get(m[1]);
      if (!pid) this.fail(`the update "${u}" of "${t.name}" uses the unknown place "${m[1]}".`);
      const w = m[3].trim();
      if (m[2] === "=") {
        if (w !== "0") this.fail(`the update "${u}" of "${t.name}" sets a place to ${w}; only resets to 0 are supported.`);
        arc(pid, t.id, "reset", "");
      } else {
        const ms = this.multiset(w, placeSet.get(m[1])!, all);
        if (m[2] === "-") arc(pid, t.id, "normal", ms);
        else arc(t.id, pid, "normal", ms);
      }
    }
  }

  private warnOnce(w: string) {
    if (!this.warnings.includes(w)) this.warnings.push(w);
  }
}

function isIntegerText(s: string) {
  return /^\d+$/.test(s);
}

/** Section labels of ANDL and CANDL. */
const SECTIONS = ["constants", "parameters", "places", "transitions", "observers", "functions", "colorsets", "variables", "colorfunctions"];

/** Splits "a, b, (c, d)" at top-level commas. */
function splitList(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out.filter((x) => x !== "");
}

/** Splits "[a] & [b]" at top-level "&" between bracketed terms. */
function splitTerms(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "[" || c === "(" || c === "{") depth++;
    else if (c === "]" || c === ")" || c === "}") depth--;
    else if (c === "&" && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out.filter((x) => x !== "");
}

