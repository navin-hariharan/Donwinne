// PNML import: lossless for files written by exportPnml, lenient for P/T and symmetric nets
// written by other tools (PIPE, TINA, Snoopy, CPN-style PNML exports, ...).

import {
  Arc,
  ArcKind,
  ColourSetDecl,
  Declarations,
  FTEdge,
  FTNode,
  FTNodeType,
  FaultTree,
  FunctionDecl,
  Net,
  NetClass,
  Note,
  ObserverDecl,
  Place,
  Point,
  Transition,
  TransitionKind,
  VariableDecl,
  isColoured,
  newId,
} from "@pns/core";
import { FT_NODE_TYPES, NET_CLASSES, SOUND_INSTRUMENTS, TRANSITION_KINDS, checkStructure } from "./native";
import { OLD_TOOL_NAMES, TOOL_NAME } from "./pnml-export";
import { DomParserOption, XNode, attr, kid, kids, local, parseXml, path, text } from "./xml";

export interface PnmlImportResult {
  net: Net;
  /** Things that could not be imported exactly, in plain language. */
  warnings: string[];
}

/** Imports the first net of a PNML document. See importPnmlWithWarnings. */
export function importPnml(xml: string, parser?: DomParserOption): Net {
  return importPnmlWithWarnings(xml, parser).net;
}

const HIGH_LEVEL = /symmetricnet|highlevelnet|hlpn|pt-hlpng|hlcore|coloured|colored/i;

/**
 * Net class implied by a PNML net type URI and the arc kinds found in the net:
 * high-level grammars give "coloured", otherwise "xpt" if any arc is not a normal arc, else "pt".
 */
export function netClassFromPnml(type: string | undefined, arcKinds: Iterable<ArcKind>): NetClass {
  if (type && HIGH_LEVEL.test(type)) return "coloured";
  for (const k of arcKinds) if (k !== "normal") return "xpt";
  return "pt";
}

class Unsupported extends Error {}

interface RawNode {
  el: XNode;
  kind: "place" | "transition" | "arc" | "referencePlace" | "referenceTransition";
}

export function importPnmlWithWarnings(xml: string, parser?: DomParserOption): PnmlImportResult {
  const root = parseXml(xml, parser);
  if (local(root) !== "pnml")
    throw new Error(`This is not a PNML file: the root element is <${local(root)}>, expected <pnml>.`);
  const nets = kids(root, "net");
  if (!nets.length) throw new Error("This PNML file contains no <net>.");
  const warnings: string[] = [];
  const warn = (w: string) => {
    if (!warnings.includes(w)) warnings.push(w);
  };
  if (nets.length > 1) warn(`The file contains ${nets.length} nets; only the first one was imported.`);
  return { net: importNet(nets[0], warn), warnings };
}

function ourTool(n: XNode | undefined): XNode | undefined {
  return n ? kids(n, "toolspecific").find((t) => { const tool = attr(t, "tool"); return tool === TOOL_NAME || OLD_TOOL_NAMES.includes(tool ?? ""); }) : undefined;
}

function toolText(n: XNode, name: string): string | undefined {
  return text(kid(ourTool(n), name));
}

function importNet(netEl: XNode, warn: (w: string) => void): Net {
  const type = attr(netEl, "type") ?? "";
  const netTool = ourTool(netEl);
  const ours = !!netTool;

  // Gather nodes from the net itself and all (nested) pages, in document order.
  const raw: RawNode[] = [];
  const collect = (container: XNode) => {
    for (const c of kids(container)) {
      const name = local(c);
      if (name === "page") collect(c);
      else if (
        name === "place" ||
        name === "transition" ||
        name === "arc" ||
        name === "referencePlace" ||
        name === "referenceTransition"
      )
        raw.push({ el: c, kind: name });
    }
  };
  collect(netEl);

  let netClassHint: NetClass | undefined;
  const toolClass = text(kid(netTool, "netClass"));
  if (ours && toolClass !== undefined) {
    if (NET_CLASSES.includes(toolClass as NetClass)) netClassHint = toolClass as NetClass;
    else warn(`Unknown net class "${toolClass}" in the file; the class was guessed instead.`);
  }
  const coloured = netClassHint ? isColoured(netClassHint) : HIGH_LEVEL.test(type);
  if (!ours && type && !coloured && !/ptnet|p\/?t|place.?transition/i.test(type))
    warn(`Unrecognised PNML net type "${type}"; the net was read as a place/transition net.`);

  const hl = coloured ? new HighLevel(netEl, netTool, ours, warn) : null;

  const usedIds = new Set<string>();
  for (const r of raw) {
    const id = attr(r.el, "id");
    if (id) usedIds.add(id);
  }
  const genId = (prefix: string) => {
    let id: string;
    do id = newId(prefix);
    while (usedIds.has(id));
    usedIds.add(id);
    return id;
  };
  const idOf = (r: RawNode, prefix: string) => {
    const id = attr(r.el, "id");
    if (id) return id;
    warn(`Some ${r.kind}s had no id; new ids were generated.`);
    return genId(prefix);
  };

  const places: Place[] = [];
  const transitions: Transition[] = [];
  const unplaced = new Set<Place | Transition>();
  const refs = new Map<string, { ref: string | undefined; kind: string }>();

  for (const r of raw) {
    if (r.kind === "referencePlace" || r.kind === "referenceTransition") {
      const id = attr(r.el, "id");
      if (id) refs.set(id, { ref: attr(r.el, "ref"), kind: r.kind });
      else warn("A reference node without an id was ignored.");
      continue;
    }
    if (r.kind === "place") {
      const id = idOf(r, "p");
      const pos = readPosition(r.el);
      const p: Place = { id, name: readName(r.el, ours) ?? id, x: pos?.x ?? 0, y: pos?.y ?? 0, marking: "" };
      readNodeGraphics(r.el, p);
      if (!pos) unplaced.add(p);
      if (hl) {
        p.marking = hl.annotation(r.el, "hlinitialMarking", `the initial marking of ${p.name}`) ?? "";
        const cs = hl.placeType(r.el, p.name);
        if (cs !== undefined) p.colourSet = cs;
      } else {
        const tm = toolText(r.el, "marking");
        p.marking = tm ?? readMarking(r.el, ours, p.name, warn);
        const tcs = toolText(r.el, "colourSet");
        if (tcs !== undefined) p.colourSet = tcs;
      }
      const cap = toolText(r.el, "capacity") ?? (ours ? undefined : annotText(kid(r.el, "capacity")));
      if (cap !== undefined && cap.trim() !== "") {
        const n = Number(cap.trim());
        if (Number.isInteger(n) && n >= 0) {
          if (ours || n > 0) p.capacity = n;
        } else warn(`The capacity "${cap}" of place ${p.name} is not a whole number and was ignored.`);
      }
      const logical = toolText(r.el, "logical");
      if (logical !== undefined) p.logical = logical.trim() === "true";
      const continuous = toolText(r.el, "continuous");
      if (continuous !== undefined) p.continuous = continuous.trim() === "true";
      const fixed = toolText(r.el, "fixed");
      if (fixed !== undefined) p.fixed = fixed.trim() === "true";
      const gluing = toolText(r.el, "gluing");
      if (gluing !== undefined) p.gluing = gluing.trim() === "true";
      readCommonTool(r.el, p);
      places.push(p);
    } else if (r.kind === "transition") {
      const id = idOf(r, "t");
      const pos = readPosition(r.el);
      const t: Transition = { id, name: readName(r.el, ours) ?? id, x: pos?.x ?? 0, y: pos?.y ?? 0 };
      readNodeGraphics(r.el, t);
      if (!pos) unplaced.add(t);
      if (hl) {
        const g = hl.annotation(r.el, "condition", `the guard of ${t.name}`);
        if (g !== undefined) t.guard = g;
      } else {
        const g = toolText(r.el, "guard");
        if (g !== undefined) t.guard = g;
      }
      const hz = toolText(r.el, "horizontal");
      if (hz !== undefined) t.horizontal = hz.trim() === "true";
      readTransitionTool(r.el, t, warn);
      readCommonTool(r.el, t);
      transitions.push(t);
    }
  }

  // Resolve reference nodes (possibly chained) to the real nodes.
  const placeIds = new Set(places.map((p) => p.id));
  const transIds = new Set(transitions.map((t) => t.id));
  const resolve = (id: string): string | undefined => {
    const seen = new Set<string>();
    let cur = id;
    while (refs.has(cur)) {
      if (seen.has(cur)) throw new Error(`The reference node "${id}" refers to itself in a cycle.`);
      seen.add(cur);
      const next = refs.get(cur)!.ref;
      if (!next) return undefined;
      cur = next;
    }
    return placeIds.has(cur) || transIds.has(cur) ? cur : undefined;
  };
  for (const [id, r] of refs) {
    const target = resolve(id);
    if (!target) warn(`The reference node "${id}" points to "${r.ref ?? ""}", which does not exist; its arcs were dropped.`);
    else if ((r.kind === "referencePlace") !== placeIds.has(target))
      warn(`The ${r.kind} "${id}" points to a node of the wrong type.`);
  }

  const arcs: Arc[] = [];
  for (const r of raw) {
    if (r.kind !== "arc") continue;
    const id = idOf(r, "a");
    const src0 = attr(r.el, "source") ?? "";
    const tgt0 = attr(r.el, "target") ?? "";
    const source = resolve(src0);
    const target = resolve(tgt0);
    if (!source || !target) {
      if (ours) throw new Error(`Arc "${id}" refers to "${source ? tgt0 : src0}", which is not a place or transition in this net.`);
      warn(`Arc "${id}" connects nodes that do not exist and was dropped.`);
      continue;
    }
    if (placeIds.has(source) === placeIds.has(target)) {
      if (ours) throw new Error(`Arc "${id}" must connect a place and a transition.`);
      warn(`Arc "${id}" does not connect a place and a transition and was dropped.`);
      continue;
    }
    const kind = readArcKind(r.el, warn);
    const a: Arc = { id, source, target, kind, inscription: "" };
    if (hl) {
      a.inscription = hl.annotation(r.el, "hlinscription", `an arc inscription`) ?? "";
    } else {
      const ti = toolText(r.el, "inscription");
      a.inscription = ti ?? readInscription(r.el, ours, kind, warn);
    }
    const points = readBendPoints(r.el);
    if (points.length) a.points = points;
    const color = attr(path(r.el, "graphics", "line"), "color");
    if (color) a.color = color;
    arcs.push(a);
  }

  layoutUnplaced([...places, ...transitions], unplaced, warn);

  let netClass: NetClass;
  let declarations: Declarations;
  if (hl && hl.failed) {
    warn(
      `This high-level net uses ${hl.failed} that Donwinne cannot read; ` +
        "it was imported as a place/transition net without colours.",
    );
    netClass = netClassFromPnml(undefined, arcs.map((a) => a.kind));
    declarations = { colourSets: [], variables: [], constants: [] };
    const placeEls = new Map(raw.filter((r) => r.kind === "place").map((r) => [attr(r.el, "id"), r.el]));
    for (const p of places) {
      delete p.colourSet;
      const el = placeEls.get(p.id);
      const n = el ? hl.countTokens(el) : 0;
      p.marking = n ? String(n) : "";
    }
    for (const t of transitions) delete t.guard;
    for (const a of arcs) a.inscription = a.kind === "reset" ? "" : "1";
  } else {
    netClass = netClassHint ?? netClassFromPnml(type, arcs.map((a) => a.kind));
    declarations = hl ? hl.declarations(places) : readToolDeclarations(netTool) ?? emptyDecls();
  }

  const net: Net = {
    format: "pns/1",
    name: readName(netEl, ours) ?? attr(netEl, "id") ?? "Untitled",
    netClass,
    places,
    transitions,
    arcs,
    declarations,
  };
  const comment = toolText(netEl, "comment");
  if (comment !== undefined) net.comment = comment;
  const modulus = num(toolText(netEl, "modulus"));
  if (modulus !== undefined && Number.isInteger(modulus) && modulus >= 2) net.modulus = modulus;
  else if (netClass === "modulo") net.modulus = 2;
  const notes = kid(netTool, "notes");
  if (notes) net.notes = kids(notes, "note").map(readNote);
  const ft = kid(netTool, "faultTree");
  if (ft) net.faultTree = readFaultTree(ft, warn);
  else if (netClass === "faultTree" || netClass === "extendedFaultTree") net.faultTree = { nodes: [], edges: [] };
  checkStructure(net);
  return net;
}

function emptyDecls(): Declarations {
  return { colourSets: [], variables: [], constants: [] };
}

// ---------------------------------------------------------------------------------------------
// Standard annotations

/** Text of a PNML annotation: its <text> child, or PIPE's <value>. */
function annotText(n: XNode | undefined): string | undefined {
  if (!n) return undefined;
  return text(kid(n, "text")) ?? text(kid(n, "value"));
}

/** Fill colour and name label offset (standard PNML graphics). */
function readNodeGraphics(n: XNode, node: Place | Transition) {
  const color = attr(path(n, "graphics", "fill"), "color");
  if (color) node.color = color;
  const off = path(n, "name", "graphics", "offset");
  const x = num(attr(off, "x"));
  const y = num(attr(off, "y"));
  if (x !== undefined && y !== undefined && (x !== 0 || y !== 0 || ourTool(n))) node.labelOffset = { x, y };
}

function readCommonTool(n: XNode, node: Place | Transition) {
  const parent = toolText(n, "parent");
  if (parent !== undefined) node.parent = parent;
  const coarse = toolText(n, "coarse");
  if (coarse !== undefined) node.coarse = coarse.trim() === "true";
  const comment = toolText(n, "comment");
  if (comment !== undefined) node.comment = comment;
}

function readTransitionTool(n: XNode, t: Transition, warn: (w: string) => void) {
  const kind = toolText(n, "kind")?.trim();
  if (kind !== undefined) {
    if (TRANSITION_KINDS.includes(kind as TransitionKind)) t.kind = kind as TransitionKind;
    else warn(`Unknown transition kind "${kind}" was ignored.`);
  }
  const rate = toolText(n, "rate");
  if (rate !== undefined) t.rate = rate;
  const iv = kid(ourTool(n), "interval");
  if (iv) t.interval = [text(kid(iv, "earliest")) ?? "0", text(kid(iv, "latest")) ?? "inf"];
  const sound = kid(ourTool(n), "sound");
  if (sound) {
    t.sound = { note: text(sound) ?? "" };
    const d = num(attr(sound, "duration"));
    if (d !== undefined && d > 0) t.sound.duration = d;
    const ins = attr(sound, "instrument");
    if (ins && (SOUND_INSTRUMENTS as readonly string[]).includes(ins))
      t.sound.instrument = ins as (typeof SOUND_INSTRUMENTS)[number];
  }
}

function readNote(n: XNode): Note {
  const note: Note = { id: attr(n, "id") ?? newId("n"), x: num(attr(n, "x")) ?? 0, y: num(attr(n, "y")) ?? 0, text: text(n) ?? "" };
  const parent = attr(n, "parent");
  if (parent !== undefined) note.parent = parent;
  const color = attr(n, "color");
  if (color !== undefined) note.color = color;
  return note;
}

function readFaultTree(ft: XNode, warn: (w: string) => void): FaultTree {
  const nodes: FTNode[] = [];
  for (const n of kids(kid(ft, "nodes") ?? ft, "node")) {
    const type = attr(n, "type") as FTNodeType;
    if (!FT_NODE_TYPES.includes(type)) {
      warn(`A fault tree node of unknown type "${attr(n, "type") ?? ""}" was ignored.`);
      continue;
    }
    const id = attr(n, "id") ?? newId("f");
    const node: FTNode = { id, name: text(kid(n, "name")) ?? id, x: num(attr(n, "x")) ?? 0, y: num(attr(n, "y")) ?? 0, type };
    const k = num(attr(n, "k"));
    if (k !== undefined) node.k = k;
    for (const key of ["failureRate", "probability", "repairRate", "comment"] as const) {
      const v = text(kid(n, key));
      if (v !== undefined) node[key] = v;
    }
    const parent = attr(n, "parent");
    if (parent !== undefined) node.parent = parent;
    const color = attr(n, "color");
    if (color !== undefined) node.color = color;
    nodes.push(node);
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges: FTEdge[] = [];
  for (const e of kids(kid(ft, "edges") ?? ft, "edge")) {
    const edge: FTEdge = { id: attr(e, "id") ?? newId("fe"), source: attr(e, "source") ?? "", target: attr(e, "target") ?? "" };
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      warn(`A fault tree edge between unknown nodes was dropped.`);
      continue;
    }
    const pts = kids(e, "position")
      .map((p) => ({ x: num(attr(p, "x")), y: num(attr(p, "y")) }))
      .filter((p): p is Point => p.x !== undefined && p.y !== undefined);
    if (pts.length) edge.points = pts;
    edges.push(edge);
  }
  return { nodes, edges };
}

function readName(n: XNode, ours: boolean): string | undefined {
  const t = annotText(kid(n, "name"));
  return t === undefined ? undefined : ours ? t : t.trim();
}

function num(s: string | undefined): number | undefined {
  if (s === undefined || s.trim() === "") return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
}

function readPosition(n: XNode): Point | undefined {
  const pos = path(n, "graphics", "position");
  const x = num(attr(pos, "x"));
  const y = num(attr(pos, "y"));
  return x === undefined || y === undefined ? undefined : { x, y };
}

function readBendPoints(n: XNode): Point[] {
  const out: Point[] = [];
  const g = kid(n, "graphics");
  if (g)
    for (const p of kids(g, "position")) {
      const x = num(attr(p, "x"));
      const y = num(attr(p, "y"));
      if (x !== undefined && y !== undefined) out.push({ x, y });
    }
  if (!out.length) {
    // PIPE: <arcpath> elements including both end points.
    const ap = kids(n, "arcpath")
      .map((p) => ({ x: num(attr(p, "x")), y: num(attr(p, "y")) }))
      .filter((p): p is Point => p.x !== undefined && p.y !== undefined);
    out.push(...ap.slice(1, -1));
  }
  return out;
}

/** A natural number from a P/T annotation text, accepting PIPE's "Default,3". */
function naturalFrom(s: string): string | undefined {
  const t = s.trim();
  if (/^\d+$/.test(t)) return String(Number(t));
  const m = /(?:^|,)\s*(\d+)\s*$/.exec(t) ?? /^(\d+)\.0*$/.exec(t);
  return m ? String(Number(m[1])) : undefined;
}

function readMarking(n: XNode, ours: boolean, name: string, warn: (w: string) => void): string {
  const t = annotText(kid(n, "initialMarking"));
  if (t === undefined) return "";
  if (ours) return t;
  const v = naturalFrom(t);
  if (v === undefined) {
    if (t.trim()) warn(`The initial marking "${t.trim()}" of place ${name} is not a number and was kept as text.`);
    return t.trim();
  }
  return v === "0" ? "" : v;
}

function readInscription(n: XNode, ours: boolean, kind: ArcKind, warn: (w: string) => void): string {
  const t = annotText(kid(n, "inscription"));
  if (t === undefined) return kind === "reset" ? "" : "1";
  if (ours) return t;
  const v = naturalFrom(t);
  if (v === undefined) {
    if (t.trim()) warn(`The arc inscription "${t.trim()}" is not a number and was kept as text.`);
    return t.trim() || (kind === "reset" ? "" : "1");
  }
  return v;
}

const KIND_NAMES: Record<string, ArcKind> = {
  normal: "normal",
  regular: "normal",
  default: "normal",
  read: "read",
  test: "read",
  inhibitor: "inhibitor",
  inhibit: "inhibitor",
  reset: "reset",
  equal: "equal",
  equality: "equal",
  modifier: "modifier",
};

function readArcKind(n: XNode, warn: (w: string) => void): ArcKind {
  const fromTool = toolText(n, "arcType");
  const typeEl = kid(n, "type") ?? kid(n, "arctype") ?? kid(n, "arcType");
  const raw = fromTool ?? attr(typeEl, "value") ?? annotText(typeEl) ?? (typeEl ? text(typeEl) : undefined);
  if (raw === undefined || raw.trim() === "") return "normal";
  const kind = KIND_NAMES[raw.trim().toLowerCase()];
  if (!kind) {
    warn(`Unknown arc type "${raw.trim()}"; such arcs were imported as normal arcs.`);
    return "normal";
  }
  return kind;
}

function readToolDeclarations(netTool: XNode | undefined): Declarations | undefined {
  const d = kid(netTool, "declarations");
  if (!d) return undefined;
  const colourSets = kids(d, "colourSet").map((c): ColourSetDecl => {
    const cs: ColourSetDecl = { name: attr(c, "name") ?? "", type: (attr(c, "type") ?? "dot") as ColourSetDecl["type"] };
    const values = kid(c, "values");
    if (values) cs.values = kids(values, "value").map((v) => text(v) ?? "");
    const min = num(attr(c, "min"));
    const max = num(attr(c, "max"));
    if (min !== undefined) cs.min = min;
    if (max !== undefined) cs.max = max;
    const comps = kid(c, "components");
    if (comps) cs.components = kids(comps, "component").map((v) => text(v) ?? "");
    const pred = kid(c, "predicate");
    if (pred) cs.predicate = text(pred) ?? "";
    const complementOf = attr(c, "complementOf");
    if (complementOf) cs.complementOf = complementOf;
    return cs;
  });
  const variables = kids(d, "variable").map((v): VariableDecl => ({ name: attr(v, "name") ?? "", colourSet: attr(v, "colourSet") ?? "" }));
  const constants = kids(d, "constant").map((c) => {
    const k: Declarations["constants"][number] = { name: attr(c, "name") ?? "", value: text(c) ?? "" };
    const group = attr(c, "group");
    if (group !== undefined) k.group = group;
    return k;
  });
  const out: Declarations = { colourSets, variables, constants };
  const functions = kids(d, "function").map(
    (f): FunctionDecl => ({ name: attr(f, "name") ?? "", params: kids(f, "param").map((p) => text(p) ?? ""), body: text(kid(f, "body")) ?? "" }),
  );
  if (functions.length) out.functions = functions;
  const observers = kids(d, "observer").map(
    (o): ObserverDecl => ({ name: attr(o, "name") ?? "", kind: attr(o, "kind") === "transition" ? "transition" : "place", expression: text(o) ?? "" }),
  );
  if (observers.length) out.observers = observers;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Automatic layout for nodes without graphics

const GRID = 100;

function layoutUnplaced(all: (Place | Transition)[], unplaced: Set<Place | Transition>, warn: (w: string) => void) {
  if (!unplaced.size) return;
  warn(
    unplaced.size === all.length
      ? "The file has no layout information; nodes were arranged in a grid."
      : `${unplaced.size} node(s) had no position and were arranged in a grid below the others.`,
  );
  const placed = all.filter((n) => !unplaced.has(n));
  const top = placed.length ? Math.max(...placed.map((n) => n.y)) + GRID : GRID / 2;
  const left = placed.length ? Math.min(...placed.map((n) => n.x)) : GRID / 2;
  const cols = Math.max(1, Math.ceil(Math.sqrt(unplaced.size)));
  let i = 0;
  for (const n of all) {
    if (!unplaced.has(n)) continue;
    n.x = left + (i % cols) * GRID;
    n.y = top + Math.floor(i / cols) * GRID;
    i++;
  }
}

// ---------------------------------------------------------------------------------------------
// High-level (symmetric / coloured) nets

class HighLevel {
  /** Description of the first thing that could not be read, or "" if everything worked. */
  failed = "";
  private pendingAliases: [string, string][] = [];
  private sortNames = new Map<string, string>(); // namedsort id -> name
  private constNames = new Map<string, string>(); // feconstant / namedoperator id -> name
  private varNames = new Map<string, string>(); // variabledecl id -> name
  private colourSets: ColourSetDecl[] = [];
  private variables: VariableDecl[] = [];
  private toolDecls: Declarations | undefined;
  private needDot = false;

  constructor(
    netEl: XNode,
    netTool: XNode | undefined,
    private ours: boolean,
    private warn: (w: string) => void,
  ) {
    this.toolDecls = readToolDeclarations(netTool);
    this.readStandardDeclarations(netEl);
  }

  private fail(what: string) {
    if (!this.failed) this.failed = what;
  }

  private readStandardDeclarations(netEl: XNode) {
    const blocks: XNode[] = [];
    const visit = (n: XNode) => {
      for (const c of kids(n)) {
        if (local(c) === "declaration") blocks.push(c);
        else if (local(c) === "page") visit(c);
      }
    };
    visit(netEl);
    const sorts: XNode[] = [];
    const vars: XNode[] = [];
    for (const b of blocks)
      for (const d of kids(path(b, "structure", "declarations") ?? b)) {
        const name = local(d);
        if (name === "namedsort") sorts.push(d);
        else if (name === "variabledecl") vars.push(d);
        else if (name === "namedoperator") {
          const id = attr(d, "id");
          if (id) this.constNames.set(id, attr(d, "name") ?? id);
        } else if (!this.toolDecls && name !== "partition")
          this.warn(`The declaration <${name}> is not supported and was ignored.`);
      }
    for (const s of sorts) {
      const id = attr(s, "id");
      if (id) this.sortNames.set(id, attr(s, "name") ?? id);
    }
    for (const v of vars) {
      const id = attr(v, "id");
      if (id) this.varNames.set(id, attr(v, "name") ?? id);
    }
    for (const s of sorts) {
      const name = attr(s, "name") ?? attr(s, "id") ?? "";
      const body = kids(s)[0];
      if (!body) continue;
      const kind = local(body);
      if (kind === "dot") this.colourSets.push({ name, type: "dot" });
      else if (kind === "bool") this.colourSets.push({ name, type: "bool" });
      else if (kind === "cyclicenumeration" || kind === "finiteenumeration") {
        const values = kids(body, "feconstant").map((f) => {
          const n = attr(f, "name") ?? attr(f, "id") ?? "";
          const fid = attr(f, "id");
          if (fid) this.constNames.set(fid, n);
          return n;
        });
        this.colourSets.push({ name, type: "enum", values });
      } else if (kind === "finiteintrange") {
        this.colourSets.push({ name, type: "int", min: num(attr(body, "start")) ?? 0, max: num(attr(body, "end")) ?? 0 });
      } else if (kind === "productsort") {
        const components = kids(body).map((c) => this.sortRef(c) ?? "?");
        this.colourSets.push({ name, type: "product", components });
      } else if (kind === "usersort") {
        // An alias: copy the referenced sort later (simple: treat as same declaration by name).
        const target = this.sortRef(body);
        if (target) this.pendingAliases.push([name, target]);
      } else if (!this.toolDecls) this.fail(`the sort <${kind}> (in ${name})`);
    }
    for (const [alias, target] of this.pendingAliases) {
      const t = this.colourSets.find((c) => c.name === target);
      if (t) this.colourSets.push({ ...t, name: alias });
    }
    for (const v of vars) {
      const name = attr(v, "name") ?? attr(v, "id") ?? "";
      const cs = this.sortRef(kids(v)[0]);
      if (cs === undefined) {
        if (!this.toolDecls) this.fail(`the type of variable ${name}`);
        continue;
      }
      this.variables.push({ name, colourSet: cs });
    }
  }

  /** Name of the colour set a sort element denotes. */
  private sortRef(n: XNode | undefined): string | undefined {
    if (!n) return undefined;
    const k = local(n);
    if (k === "usersort") {
      const id = attr(n, "declaration") ?? "";
      return this.sortNames.get(id) ?? id;
    }
    if (k === "dot") {
      this.needDot = true;
      return "Dot";
    }
    return undefined;
  }

  declarations(places: Place[]): Declarations {
    if (this.toolDecls) return this.toolDecls;
    const colourSets = [...this.colourSets];
    if ((this.needDot || places.some((p) => p.colourSet === undefined)) && !colourSets.some((c) => c.name === "Dot"))
      colourSets.unshift({ name: "Dot", type: "dot" });
    return { colourSets, variables: this.variables, constants: [] };
  }

  placeType(n: XNode, placeName: string): string | undefined {
    const t = kid(n, "type");
    if (!t) return undefined;
    const tx = text(kid(t, "text"));
    if (tx !== undefined && (this.ours || tx.trim())) return this.ours ? tx : tx.trim();
    if (this.ours) return undefined; // our exporter writes a bare <dot/> type for "no colour set"
    const s = kids(kid(t, "structure") ?? t)[0];
    const cs = this.sortRef(s);
    if (cs === undefined) this.fail(`the type of place ${placeName}`);
    return cs;
  }

  /** Text of a high-level annotation: its <text>, else its structure printed as an expression. */
  annotation(n: XNode, tag: string, what: string): string | undefined {
    const a = kid(n, tag);
    if (!a) return undefined;
    const tx = text(kid(a, "text"));
    if (tx !== undefined && (this.ours || tx.trim())) return this.ours ? tx : tx.trim();
    const s = kids(kid(a, "structure") ?? a).filter((c) => local(c) !== "graphics" && local(c) !== "toolspecific")[0];
    if (!s) return tx === undefined ? undefined : "";
    try {
      return this.term(s);
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      this.fail(`${e.message} in ${what}`);
      return undefined;
    }
  }

  /** Total number of tokens of a marking given as a structure (for the P/T fallback). */
  countTokens(n: XNode): number {
    const structure = path(n, "hlinitialMarking", "structure");
    const s = structure && kids(structure)[0];
    if (!s) {
      const tx = text(path(n, "hlinitialMarking", "text"))?.trim();
      if (!tx) return 0;
      return tx.split("++").reduce((acc, part) => {
        const m = /^\s*(\d+)\s*(`|$)/.exec(part);
        return acc + (m ? Number(m[1]) : 1);
      }, 0);
    }
    const count = (t: XNode): number => {
      const k = local(t);
      const subs = kids(t, "subterm").map((x) => kids(x)[0]).filter(Boolean);
      if (k === "add") return subs.reduce((acc, x) => acc + count(x), 0);
      if (k === "numberof" && subs[0] && local(subs[0]) === "numberconstant") return num(attr(subs[0], "value")) ?? 1;
      return 1;
    };
    return count(s);
  }

  private term(t: XNode): string {
    const k = local(t);
    const subs = kids(t, "subterm").map((x) => {
      const inner = kids(x)[0];
      if (!inner) throw new Unsupported("an empty subterm");
      return inner;
    });
    const sub = (i: number) => {
      if (!subs[i]) throw new Unsupported(`an incomplete <${k}> term`);
      return this.term(subs[i]);
    };
    const bin = (op: string) => `(${sub(0)} ${op} ${sub(1)})`;
    const nary = (op: string) => (subs.length === 1 ? sub(0) : `(${subs.map((_, i) => sub(i)).join(` ${op} `)})`);
    switch (k) {
      case "numberof":
        return `${sub(0)}\`${sub(1)}`;
      case "add":
        return subs.map((_, i) => sub(i)).join(" ++ ");
      case "all": {
        const cs = this.sortRef(kids(t)[0]);
        if (!cs) throw new Unsupported("an <all> term over an unknown sort");
        return `all(${cs})`;
      }
      case "dotconstant":
        return "dot";
      case "numberconstant":
      case "finiteintrangeconstant":
        return attr(t, "value") ?? "0";
      case "booleanconstant":
        return attr(t, "value") === "true" ? "true" : "false";
      case "variable": {
        const id = attr(t, "refvariable") ?? "";
        return this.varNames.get(id) ?? id;
      }
      case "useroperator": {
        const id = attr(t, "declaration") ?? "";
        const name = this.constNames.get(id);
        if (!name) throw new Unsupported(`the operator "${id}"`);
        return name;
      }
      case "tuple":
        return `(${subs.map((_, i) => sub(i)).join(", ")})`;
      case "successor":
        return `succ(${sub(0)})`;
      case "predecessor":
        return `pred(${sub(0)})`;
      case "equality":
        return bin("=");
      case "inequality":
        return bin("<>");
      case "lessthan":
        return bin("<");
      case "lessthanorequal":
        return bin("<=");
      case "greaterthan":
        return bin(">");
      case "greaterthanorequal":
        return bin(">=");
      case "and":
        return nary("and");
      case "or":
        return nary("or");
      case "not":
        return `not ${sub(0)}`;
      case "addition":
        return bin("+");
      case "subtraction":
        return bin("-");
      case "mult":
        return bin("*");
      default:
        throw new Unsupported(`the term <${k}>`);
    }
  }
}
