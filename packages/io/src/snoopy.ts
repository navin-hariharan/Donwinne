// Snoopy (BTU Cottbus, https://github.com/PetriNuts/snoopy) native file import and export.
//
// A Snoopy file is XML:
//
//   <Snoopy version="2" revision="2.0">
//     <netclass name="Stochastic Petri Net"/>
//     <nodeclasses count=".."><nodeclass count=".." name="Place"><node id=".." net="1" [logic="1"] [coarse="2"]>
//         <attribute name="Name" id=".." net="1"><![CDATA[P0]]><graphics count="1"><graphic xoff yoff x y id net show grparent .../></graphics></attribute>
//         <attribute name="FunctionList" type="ColList" id=".." net="1"><colList row_count col_count active_row active_col>
//            <colList_head><colList_colLabel><![CDATA[..]]></colList_colLabel>..</colList_head>
//            <colList_body><colList_row nr="0"><colList_col nr="0"><![CDATA[Main]]></colList_col>..</colList_row></colList_body>
//         </colList><graphics count=".."/></attribute>
//         <graphics count="1"><graphic x y id net show w h state pen brush/></graphics>
//     </node></nodeclass>..</nodeclasses>
//     <edgeclasses ..><edgeclass name="Edge"><edge source=<node id> target=<node id> id net>..attributes..
//         <graphics><graphic id net source=<graphic id> target=<graphic id> ..><points count><point x y/>..</points></graphic></graphics></edge>
//     </edgeclass></edgeclasses>
//     <metadataclasses ..><metadataclass name="Constant Class"><metadata id net>..attributes..</metadata></metadataclass>..</metadataclasses>
//   </Snoopy>
//
// What is verified and how:
//  * Verified against real files: Petri Net (.spped, Snoopy 1.21), Continuous Petri Net (.spcontped/.cpn,
//    revisions 1.21-2.0) and Hybrid Petri Net (.hpn, revision 2.0) — node/edge/metadata layout, CDATA
//    values, ColList layout, Constant Class, Comment notes, Modifier edges, logical nodes (logic="1" with
//    one graphic per copy) and edge graphics referring to node graphic ids.
//  * Verified against Snoopy's source code (sp_core/SP_XmlReader.cpp, SP_XmlWriter.cpp, sp_defines.cpp,
//    sp_ds/netclasses/*.cpp): net class names, extensions, node/edge class names and the attributes of
//    every class below, how coarse nodes refer to their subnet (coarse="N" on the node, children at
//    net="N"), and that every metadataclass is emptied before loading (so singleton metadata such as the
//    colour set declarations must be present in the file).
//  * Verified against Snoopy's source (sp_ds/netclasses/SP_DS_ContinuousPed.cpp, SP_DS_ColSPN.cpp,
//    sp_core/tools/SP_SimpleNetBuilder.cpp, sp_defines.cpp): the boolean "Fixed" attribute of places,
//    "Modifier Edge" (only a Comment attribute; coloured nets add an ExpressionList defaulting to dot),
//    the "Function Class" metadata (one metadata per function with Name, ID, Parameter, Body, Return
//    and Comment; coloured nets: one FunctionList with Return type, Function name, Parameter list
//    ("type name, ..."), Function body), and the "Oberserver Class" metadata (sic; Name, Type =
//    Place|Transition, Body, Comment, ColPNType). Observer metadata also appears in the real samples.
//  * UNVERIFIED (no real file available): the exact cell contents Snoopy writes for coloured declarations
//    and markings (reconstructed from the CANDL importer and the declaration dialogs), the encoding of
//    music net sounds, fuzzy constant types, freestyle nets, the placement of border-node copies in
//    hierarchical nets, the text of the Parameter attribute of functions, and how bool, string, union and
//    subset colour sets fill their rows. These are marked "UNVERIFIED" below.

import {
  Arc,
  ArcKind,
  ColourSetDecl,
  ConstantDecl,
  Declarations,
  FTEdge,
  FunctionDecl,
  FTNode,
  FTNodeType,
  Net,
  NetClass,
  Note,
  ObserverDecl,
  Place,
  Point,
  Transition,
  TransitionKind,
  VariableDecl,
  defaultTransitionKind,
  isColoured,
  isFaultTree,
  isFuzzy,
  timeBase,
} from "@pns/core";
import { SOUND_INSTRUMENTS, checkStructure } from "./native";
import { functionSignature, splitParams } from "./text-common";
import { DomParserOption, XNode, attr, kid, kids, local, parseXml } from "./xml";

// ---------------------------------------------------------------------------------------------
// Net classes

export interface SnoopyClassInfo {
  /** The <netclass name=".."> value. */
  name: string;
  /** Default file extension (without dot). */
  extension: string;
  /** Older or alternative extensions Snoopy also opens. */
  alternatives: string[];
}

/** From sp_defines.cpp and the m_sExtension / m_sFilter of each netclass. */
export const SNOOPY_CLASSES: Record<NetClass, SnoopyClassInfo> = {
  pt: { name: "Petri Net", extension: "pn", alternatives: ["spped"] },
  xpt: { name: "Extended Petri Net", extension: "xpn", alternatives: ["spept"] },
  coloured: { name: "Colored Petri Net", extension: "colpn", alternatives: [] },
  timed: { name: "Time Petri Net", extension: "tpn", alternatives: ["sptpt"] },
  stochastic: { name: "Stochastic Petri Net", extension: "spn", alternatives: ["spstochpn"] },
  continuous: { name: "Continuous Petri Net", extension: "cpn", alternatives: ["spcontped"] },
  hybrid: { name: "Hybrid Petri Net", extension: "hpn", alternatives: ["sphybrid"] },
  colouredStochastic: { name: "Colored Stochastic Petri Net", extension: "colspn", alternatives: ["colstochpn"] },
  colouredContinuous: { name: "Colored Continuous Petri Net", extension: "colcpn", alternatives: ["colcontped"] },
  colouredHybrid: { name: "Colored Hybrid Petri Net", extension: "colhpn", alternatives: ["colhybpn"] },
  fuzzyStochastic: { name: "Fuzzy Stochastic Petri Net", extension: "fspn", alternatives: ["fuzzyspstochpn"] },
  fuzzyContinuous: { name: "Fuzzy Continuous Petri Net", extension: "fcpn", alternatives: ["fspcontped"] },
  fuzzyHybrid: { name: "Fuzzy Hybrid Petri Net", extension: "fhpn", alternatives: ["fsphybrid"] },
  colouredFuzzyStochastic: { name: "Colored Fuzzy Stochastic Petri Net", extension: "colfspn", alternatives: ["colfstochpn"] },
  colouredFuzzyContinuous: { name: "Colored Fuzzy Continuous Petri Net", extension: "colfcpn", alternatives: ["colcontfped"] },
  colouredFuzzyHybrid: { name: "Colored Fuzzy Hybrid Petri Net", extension: "colfhpn", alternatives: [] },
  modulo: { name: "Modulo Petri Net", extension: "mpn", alternatives: ["spmnet"] },
  music: { name: "Music Petri Net", extension: "spm", alternatives: [] },
  freestyle: { name: "Freestyle Net", extension: "spfreen", alternatives: [] },
  faultTree: { name: "Fault Tree", extension: "spft", alternatives: ["ft"] },
  extendedFaultTree: { name: "Extended Fault Tree", extension: "speft", alternatives: ["xft"] },
  // Konios modelled APNs and T-APNs as Snoopy coloured Petri nets; they are written as such.
  apn: { name: "Colored Petri Net", extension: "colpn", alternatives: [] },
  tapn: { name: "Colored Petri Net", extension: "colpn", alternatives: [] },
};

const COLOURED_EXTENDED = "Colored Extended Petri Net";

/** Every file extension (without dot) that may hold a Snoopy net. */
export const SNOOPY_EXTENSIONS: string[] = [
  ...new Set([
    ...Object.values(SNOOPY_CLASSES).flatMap((c) => [c.extension, ...c.alternatives]),
    "colxpn",
    "colextpn",
  ]),
];

export function snoopyExtension(netClass: NetClass, net?: Net): string {
  if ((netClass === "coloured" || netClass === "apn") && net?.arcs.some((a) => a.kind !== "normal")) return "colxpn";
  return SNOOPY_CLASSES[netClass].extension;
}

/** The net class for a Snoopy <netclass name>, or undefined if it is not a Petri net class we know. */
export function netClassFromSnoopyName(name: string): NetClass | undefined {
  if (name === COLOURED_EXTENDED) return "coloured";
  for (const [k, v] of Object.entries(SNOOPY_CLASSES)) if (v.name === name) return k as NetClass;
  return undefined;
}

// Snoopy has no APN or T-APN class: Konios drew both as coloured Petri nets. The class, the gluing
// places and the complementary colour sets are kept in a last line of the net description, which
// the importer reads back and removes.
const AMBIENT_MARKER = /(?:\r?\n)?\[Donwinne ambient net: (\{.*\})\]\s*$/;

interface AmbientMarker {
  netClass: "apn" | "tapn";
  gluing?: string[];
  complements?: Record<string, string>;
}

/** The net description, with the ambient marker line for APNs and T-APNs. */
export function withAmbientMarker(net: Net): string {
  const text = net.comment ?? "";
  if (net.netClass !== "apn" && net.netClass !== "tapn") return text;
  const m: AmbientMarker = { netClass: net.netClass };
  const gluing = net.places.filter((p) => p.gluing).map((p) => p.name);
  if (gluing.length) m.gluing = gluing;
  const comp = net.declarations.colourSets.filter((c) => c.complementOf);
  if (comp.length) m.complements = Object.fromEntries(comp.map((c) => [c.name, c.complementOf!]));
  return `${text}${text ? "\n" : ""}[Donwinne ambient net: ${JSON.stringify(m)}]`;
}

/** Apply and remove the ambient marker of an imported coloured net, if its description has one. */
export function readAmbientMarker(net: Net): void {
  const match = AMBIENT_MARKER.exec(net.comment ?? "");
  if (!match || !isColoured(net.netClass)) return;
  let m: AmbientMarker;
  try {
    m = JSON.parse(match[1]);
  } catch {
    return;
  }
  if (m.netClass !== "apn" && m.netClass !== "tapn") return;
  net.netClass = m.netClass;
  const rest = net.comment!.slice(0, match.index);
  if (rest) net.comment = rest;
  else delete net.comment;
  const gluing = new Set(m.gluing ?? []);
  for (const p of net.places) if (gluing.has(p.name)) p.gluing = true;
  for (const [name, of] of Object.entries(m.complements ?? {})) {
    const cs = net.declarations.colourSets.find((c) => c.name === name);
    if (cs) cs.complementOf = of;
  }
}

export interface SnoopyOptions {
  /**
   * Factor between Snoopy coordinates and ours. Snoopy draws places 20 units wide, Donwinne 40,
   * so the default of 2 keeps the proportions. Import multiplies, export divides.
   */
  scale?: number;
  /** Import only: net name to use when the file's General metadata has none (e.g. the file name). */
  name?: string;
}

export interface SnoopyImportResult {
  net: Net;
  /** Things that could not be imported exactly, in plain language. */
  warnings: string[];
}

export interface SnoopyExportResult {
  xml: string;
  /** Things Snoopy cannot represent and that were dropped or approximated. */
  warnings: string[];
}

// Default name label offset in Snoopy (SP_DS_*: SetOffsetY(20)); it matches our default label position.
const SNOOPY_NAME_OFFSET = { x: 0, y: 20 };

// =============================================================================================
// Import

interface Graphic {
  id: string;
  net: number;
  x: number;
  y: number;
  w?: number;
  h?: number;
  pen?: string;
  brush?: string;
  grparent?: string;
  xoff: number;
  yoff: number;
  show: boolean;
  /** Edge graphics only. */
  source?: string;
  target?: string;
  points?: Point[];
}

interface Attribute {
  name: string;
  value: string;
  colList?: ColList;
  graphics: Graphic[];
}

interface ColList {
  labels: string[];
  rows: string[][];
  activeRow: number;
}

interface Element {
  cls: string;
  id: string;
  net: number;
  logic: boolean;
  coarse?: number;
  source?: string;
  target?: string;
  attrs: Map<string, Attribute>;
  graphics: Graphic[];
}

/** Text of a Snoopy attribute: its CDATA section(s), else its own text. */
function cdata(n: XNode): string {
  let out = "";
  let found = false;
  const cn = n.childNodes;
  for (let i = 0; i < cn.length; i++) {
    if (cn[i].nodeType === 4) {
      out += cn[i].textContent ?? "";
      found = true;
    }
  }
  if (found) return out;
  for (let i = 0; i < cn.length; i++) if (cn[i].nodeType === 3) out += cn[i].textContent ?? "";
  return out.trim();
}

function numAttr(n: XNode | undefined, name: string): number | undefined {
  const v = attr(n, name);
  if (v === undefined || v.trim() === "") return undefined;
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
}

function readGraphics(n: XNode): Graphic[] {
  const g = kid(n, "graphics");
  if (!g) return [];
  return kids(g, "graphic").map((e) => {
    const gr: Graphic = {
      id: attr(e, "id") ?? "",
      net: numAttr(e, "net") || 1,
      x: numAttr(e, "x") ?? 0,
      y: numAttr(e, "y") ?? 0,
      xoff: numAttr(e, "xoff") ?? 0,
      yoff: numAttr(e, "yoff") ?? 0,
      show: attr(e, "show") !== "0",
    };
    const w = numAttr(e, "w");
    const h = numAttr(e, "h");
    if (w !== undefined) gr.w = w;
    if (h !== undefined) gr.h = h;
    for (const k of ["pen", "brush", "grparent", "source", "target"] as const) {
      const v = attr(e, k);
      if (v !== undefined) gr[k] = v;
    }
    const pts = kid(e, "points");
    if (pts)
      gr.points = kids(pts, "point").map((p) => ({ x: numAttr(p, "x") ?? 0, y: numAttr(p, "y") ?? 0 }));
    return gr;
  });
}

function readColList(n: XNode): ColList {
  const cl = kid(n, "colList");
  const labels = kids(kid(cl, "colList_head") ?? ({ childNodes: [] } as unknown as XNode), "colList_colLabel").map(cdata);
  const rows = kids(kid(cl, "colList_body") ?? ({ childNodes: [] } as unknown as XNode), "colList_row").map((r) =>
    kids(r, "colList_col").map(cdata),
  );
  const activeRow = numAttr(cl, "active_row") ?? 0;
  return { labels, rows, activeRow: activeRow < rows.length ? activeRow : 0 };
}

function readElement(n: XNode, cls: string): Element {
  const attrs = new Map<string, Attribute>();
  for (const a of kids(n, "attribute")) {
    const name = attr(a, "name") ?? "";
    const at: Attribute = { name, value: "", graphics: readGraphics(a) };
    if (attr(a, "type") === "ColList" || kid(a, "colList")) at.colList = readColList(a);
    else at.value = cdata(a);
    attrs.set(name, at);
  }
  const e: Element = {
    cls,
    id: attr(n, "id") ?? "",
    net: numAttr(n, "net") || 1,
    logic: attr(n, "logic") === "1",
    attrs,
    graphics: readGraphics(n),
  };
  const coarse = numAttr(n, "coarse");
  if (coarse) e.coarse = coarse;
  const s = attr(n, "source");
  const t = attr(n, "target");
  if (s !== undefined) e.source = s;
  if (t !== undefined) e.target = t;
  return e;
}

const val = (e: Element, name: string): string | undefined => e.attrs.get(name)?.value;
const listOf = (e: Element, name: string): ColList | undefined => e.attrs.get(name)?.colList;

/** The active row's cell (or the first row's), trimmed. */
function cell(cl: ColList | undefined, col: number): string | undefined {
  if (!cl || !cl.rows.length) return undefined;
  const row = cl.rows[cl.activeRow] ?? cl.rows[0];
  const v = row[col];
  return v === undefined ? undefined : v.trim();
}

function rgbToHex(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/.exec(s);
  if (!m) return undefined;
  return "#" + [m[1], m[2], m[3]].map((v) => Math.min(255, Number(v)).toString(16).padStart(2, "0")).join("");
}

function hexToRgb(c: string | undefined): string | undefined {
  if (!c) return undefined;
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c.trim());
  if (m) return [m[1], m[2], m[3]].map((h) => parseInt(h + h, 16)).join(",");
  m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:[0-9a-f]{2})?$/i.exec(c.trim());
  if (m) return [m[1], m[2], m[3]].map((h) => parseInt(h, 16)).join(",");
  return undefined;
}

/** Snoopy's "oo" / "w" / "inf" / "?" infinity spellings. */
function normInfinity(s: string): string {
  const t = s.trim();
  return /^(oo|w|inf|infinity|\?|_?SimEnd)$/i.test(t) && !/SimEnd/.test(t) ? "inf" : t;
}

const PLACE_CLASSES = new Set(["Place", "Place, Continuous", "Discrete Place", "Continuous Place"]);
const TRANSITION_CLASSES: Record<string, TransitionKind | "plain"> = {
  Transition: "plain",
  "Stochastic Transition": "stochastic",
  "Transition, Continuous": "continuous",
  "Continuous Transition": "continuous",
  "Immediate Transition": "immediate",
  "Deterministic Transition": "deterministic",
  "Scheduled Transition": "scheduled",
};
const ARC_CLASSES: Record<string, ArcKind> = {
  Edge: "normal",
  "Read Edge": "read",
  "Test Edge": "read",
  "Inhibitor Edge": "inhibitor",
  "Reset Edge": "reset",
  "Equal Edge": "equal",
  "Modifier Edge": "modifier",
  "Self-modifying arc": "normal",
};
const FT_CLASSES: Record<string, FTNodeType> = {
  "Top Event": "top",
  "Intermediate Event": "intermediate",
  "Basic Event": "basic",
  "Undeveloped Event": "undeveloped",
  AND: "and",
  OR: "or",
  NEG: "not",
  XOR: "xor",
  "M-OF-N": "kofn",
  COND: "cond",
  "Coarse Event": "intermediate",
};
// UNVERIFIED: freestyle shapes are mapped to places (round shapes) and transitions (the rest).
const FREESTYLE_PLACES = new Set(["Circle", "Ellipse", "State"]);
const FREESTYLE_TRANSITIONS = new Set(["Square", "Rectangle", "Activity", "Rhombus", "Parallelogram", "Loop", "Actor", "And"]);

/**
 * Imports a Snoopy file of any Petri net or fault tree class. Unknown attributes and classes are
 * skipped with a warning; structural errors (not XML, not a Snoopy file, unknown net class) throw.
 */
export function importSnoopy(xml: string, parser?: DomParserOption, options: SnoopyOptions = {}): SnoopyImportResult {
  if (xml.startsWith("PK"))
    throw new Error("This Snoopy file is compressed (a zip archive). Unzip it and open the model.xml inside, or save it uncompressed in Snoopy.");
  const root = parseXml(xml, parser);
  if (local(root) !== "Snoopy")
    throw new Error(`This is not a Snoopy file: the root element is <${local(root)}>, expected <Snoopy>.`);
  const version = numAttr(root, "version") ?? 0;
  if (version < 2) throw new Error(`Snoopy file version ${version || "?"} is not supported; open and save it with Snoopy 2 first.`);
  const className = attr(kid(root, "netclass"), "name");
  if (!className) throw new Error("This Snoopy file has no <netclass>.");
  const netClass = netClassFromSnoopyName(className);
  if (!netClass)
    throw new Error(
      `The Snoopy net class "${className}" is not supported. Supported classes: ${[...Object.values(SNOOPY_CLASSES).map((c) => c.name), COLOURED_EXTENDED].join(", ")}.`,
    );
  return new SnoopyImporter(root, netClass, options).run();
}

class SnoopyImporter {
  warnings: string[] = [];
  private scale: number;
  private nodes: Element[] = [];
  private edges: Element[] = [];
  private metas: Element[] = [];
  private coloured: boolean;
  private net: Net;
  /** Snoopy node data id -> our main node id. */
  private byData = new Map<string, string>();
  /** Snoopy node graphic id -> our node id (copy-specific for logical nodes). */
  private byGraphic = new Map<string, string>();
  /** Snoopy node graphic id -> Snoopy node data id. */
  private graphicData = new Map<string, string>();
  /** Subnet number -> our coarse node id. */
  private coarseByNet = new Map<number, string>();
  private pendingParent: [{ parent?: string }, number][] = [];
  private usedIds = new Set<string>();

  constructor(
    private root: XNode,
    private netClass: NetClass,
    private options: SnoopyOptions,
  ) {
    this.scale = options.scale ?? 2;
    this.coloured = isColoured(netClass);
    this.net = {
      format: "pns/1",
      name: options.name ?? "Untitled",
      netClass,
      places: [],
      transitions: [],
      arcs: [],
      declarations: { colourSets: [], variables: [], constants: [] },
    };
    if (isFaultTree(netClass)) this.net.faultTree = { nodes: [], edges: [] };
  }

  warn(w: string) {
    if (!this.warnings.includes(w)) this.warnings.push(w);
  }

  private fresh(base: string): string {
    let id = base;
    for (let i = 2; this.usedIds.has(id); i++) id = `${base}_${i}`;
    this.usedIds.add(id);
    return id;
  }

  run(): SnoopyImportResult {
    for (const section of kids(this.root)) {
      const tag = local(section);
      if (tag === "netclass") continue;
      for (const cls of kids(section)) {
        const name = attr(cls, "name") ?? "";
        const kind = local(cls);
        // Old files keep comments and plots as node classes (SP_XmlReader does the same conversion).
        const asMeta = kind === "metadataclass" || name === "Comment" || name === "Plot";
        for (const child of kids(cls)) {
          const ct = local(child);
          if (ct !== "node" && ct !== "edge" && ct !== "metadata") continue;
          const e = readElement(child, name);
          if (asMeta) this.metas.push(e);
          else if (kind === "edgeclass") this.edges.push(e);
          else if (kind === "nodeclass") this.nodes.push(e);
        }
      }
    }

    this.readMetadata();
    if (isFaultTree(this.netClass)) this.readFaultTree();
    else {
      for (const n of this.nodes) this.readNode(n);
      for (const e of this.edges) this.readEdge(e);
    }
    for (const [obj, net] of this.pendingParent) {
      if (net === 1) continue;
      const parent = this.coarseByNet.get(net);
      if (parent) obj.parent = parent;
      else this.warn(`Some nodes lie in subnet ${net}, which has no coarse node; they were placed at the top level.`);
    }
    // A coarse node must not be inside its own subnet (corrupt files): drop such parents.
    for (const n of [...this.net.places, ...this.net.transitions]) if (n.parent === n.id) delete n.parent;
    if (this.net.netClass === "modulo" && this.net.modulus === undefined) this.net.modulus = 2;
    if (this.coloured && !this.net.declarations.colourSets.some((c) => c.name === "Dot"))
      this.net.declarations.colourSets.unshift({ name: "Dot", type: "dot" });
    readAmbientMarker(this.net);
    try {
      checkStructure(this.net);
    } catch (e) {
      throw new Error(`The Snoopy file is inconsistent: ${(e as Error).message}`);
    }
    return { net: this.net, warnings: this.warnings };
  }

  // -------------------------------------------------------------------------------------------

  private pos(g: Graphic | undefined): Point {
    return { x: (g?.x ?? 0) * this.scale, y: (g?.y ?? 0) * this.scale };
  }

  /**
   * Snoopy's default name offset (0, 20) corresponds to our default label position, so only the
   * difference is kept. Offsets within 5 units are hand-placement noise and treated as default.
   */
  private labelOffset(e: Element, g: Graphic): Point | undefined {
    const name = e.attrs.get("Name");
    const lg = name?.graphics.find((x) => x.grparent === g.id) ?? name?.graphics[0];
    if (!lg) return undefined;
    const x = Math.round((lg.xoff - SNOOPY_NAME_OFFSET.x) * this.scale * 100) / 100;
    const y = Math.round((lg.yoff - SNOOPY_NAME_OFFSET.y) * this.scale * 100) / 100;
    return Math.abs(x) <= 5 && Math.abs(y) <= 5 ? undefined : { x, y };
  }

  /**
   * One copy per graphic for logical nodes; otherwise the graphic in the node's own net is the node
   * and graphics in other nets (border copies in subnets) map to it.
   */
  private copiesOf(e: Element): { g: Graphic | undefined; net: number }[] {
    const gs = e.graphics;
    if (!gs.length) return [{ g: undefined, net: e.net }];
    const logical = e.logic || val(e, "Logic")?.trim() === "1";
    if (logical) return gs.map((g) => ({ g, net: g.net }));
    const home = gs.find((g) => g.net === e.net) ?? gs[0];
    return [{ g: home, net: e.net }];
  }

  private register<T extends Place | Transition>(e: Element, prefix: string, make: (id: string, g: Graphic | undefined) => T): T[] {
    const copies = this.copiesOf(e);
    const out: T[] = [];
    copies.forEach(({ g, net }, i) => {
      const id = this.fresh(i === 0 ? `${prefix}${e.id}` : `${prefix}${e.id}_${i + 1}`);
      const node = make(id, g);
      if (copies.length > 1) (node as Place).logical = true;
      if (g) {
        this.byGraphic.set(g.id, id);
        this.graphicData.set(g.id, e.id);
        const color = rgbToHex(g.brush);
        if (color && color !== "#ffffff") node.color = color;
        const lo = this.labelOffset(e, g);
        if (lo) node.labelOffset = lo;
      }
      const comment = val(e, "Comment");
      if (comment !== undefined && comment !== "") node.comment = comment;
      this.pendingParent.push([node, net]);
      if (i === 0) this.byData.set(e.id, id);
      out.push(node);
    });
    // Remaining graphics (border copies in other subnets) map to the main node.
    const main = out[0];
    for (const g of e.graphics) {
      if (!this.byGraphic.has(g.id)) {
        this.byGraphic.set(g.id, main.id);
        this.graphicData.set(g.id, e.id);
      }
    }
    return out;
  }

  private readNode(e: Element) {
    const cls = e.cls;
    const base = timeBase(this.netClass);
    if (cls === "Coarse Place" || cls === "Coarse Transition") {
      const isPlace = cls === "Coarse Place";
      const nodes = this.register(e, isPlace ? "p" : "t", (id, g) => {
        const p = this.pos(g);
        const name = val(e, "Name") ?? "";
        return isPlace ? ({ id, name, x: p.x, y: p.y, marking: "", coarse: true } as Place) : ({ id, name, x: p.x, y: p.y, coarse: true } as Transition);
      });
      if (isPlace) this.net.places.push(...(nodes as Place[]));
      else this.net.transitions.push(...(nodes as Transition[]));
      if (e.coarse) this.coarseByNet.set(e.coarse, nodes[0].id);
      else this.warn(`The coarse node "${val(e, "Name") ?? e.id}" has no subnet number.`);
      return;
    }
    const isPlace = PLACE_CLASSES.has(cls) || (this.netClass === "freestyle" && FREESTYLE_PLACES.has(cls));
    const tKind = TRANSITION_CLASSES[cls] ?? (this.netClass === "freestyle" && FREESTYLE_TRANSITIONS.has(cls) ? "plain" : undefined);
    if (isPlace) {
      const continuous = cls === "Place, Continuous" || cls === "Continuous Place";
      const places = this.register(e, "p", (id, g) => {
        const p = this.pos(g);
        const place: Place = { id, name: val(e, "Name") ?? "", x: p.x, y: p.y, marking: this.readMarking(e) };
        if (continuous && base === "hybrid") place.continuous = true;
        if (continuous && base !== "hybrid" && base !== "continuous")
          this.warn(`Continuous places are not part of a ${SNOOPY_CLASSES[this.netClass].name} and were imported as ordinary places.`);
        if (this.coloured) {
          const cs = val(e, "Colorset")?.trim();
          if (cs && cs !== "Dot") place.colourSet = cs;
        }
        return place;
      });
      if (val(e, "Fixed")?.trim() === "1") {
        if (base) for (const p of places) p.fixed = true;
        else this.warn(`Fixed places are not part of a ${SNOOPY_CLASSES[this.netClass].name}; they were imported as ordinary places.`);
      }
      this.net.places.push(...places);
      return;
    }
    if (tKind !== undefined) {
      const ts = this.register(e, "t", (id, g) => {
        const p = this.pos(g);
        const t: Transition = { id, name: val(e, "Name") ?? "", x: p.x, y: p.y };
        if (g?.w !== undefined && g.h !== undefined && g.w > g.h * 1.5) t.horizontal = true;
        this.readTransitionData(e, t, tKind);
        return t;
      });
      if (val(e, "Reversible")?.trim() === "1")
        this.warn("Reversible transitions are not supported; add the reverse reaction as a separate transition.");
      this.net.transitions.push(...ts);
      return;
    }
    if (cls === "Parameter") {
      // Old quantitative nets kept parameters as nodes; Snoopy turns them into constants too.
      const name = val(e, "Name") ?? e.id;
      const value = cell(listOf(e, "ParameterList"), 1) ?? val(e, "Marking")?.trim() ?? "0";
      this.addConstant({ name, value, group: "parameter" });
      return;
    }
    if (cls === "Modulo") {
      const m = Number(val(e, "Modulo")?.trim());
      if (Number.isInteger(m) && m >= 2) this.net.modulus = m;
      else this.warn(`The modulus "${val(e, "Modulo") ?? ""}" is not a whole number of at least 2; 2 was used.`);
      return;
    }
    this.warn(`Nodes of the Snoopy class "${cls}" are not supported and were skipped.`);
  }

  private readMarking(e: Element): string {
    if (this.coloured) return this.readColouredMarking(e);
    const ml = listOf(e, "MarkingList");
    const m = ml ? cell(ml, 1) ?? "" : (val(e, "Marking") ?? "").trim();
    return m === "0" ? "" : m;
  }

  private readColouredMarking(e: Element): string {
    const ml = listOf(e, "MarkingList");
    if (!ml) return (val(e, "Marking") ?? "").trim();
    const cs = val(e, "Colorset")?.trim() || "Dot";
    const terms: string[] = [];
    for (const row of ml.rows) {
      let colour = (row[0] ?? "").trim();
      const count = (row[1] ?? "1").trim() || "1";
      const tuple = (row[2] ?? "").trim();
      if (count === "0") continue;
      if (!colour && tuple && tuple !== "()") colour = tuple;
      if (!colour) continue;
      if (/^all\(\s*\)$/.test(colour)) colour = `all(${cs})`;
      terms.push(count === "1" ? colour : `${count}\`${colour}`);
    }
    return terms.join(" ++ ");
  }

  private readTransitionData(e: Element, t: Transition, cls: TransitionKind | "plain") {
    const base = timeBase(this.netClass);
    let kind: TransitionKind | undefined;
    if (cls === "plain") kind = base === "stochastic" || base === "hybrid" ? "stochastic" : base === "continuous" ? "continuous" : undefined;
    else kind = cls;
    if (kind && !base) {
      this.warn(`Timed transition kinds are not part of a ${SNOOPY_CLASSES[this.netClass].name}; they were imported as ordinary transitions.`);
      kind = undefined;
    }
    if (kind && kind !== defaultTransitionKind(this.netClass)) t.kind = kind;

    const fn = this.functionCell(e, "FunctionList");
    const delay = this.functionCell(e, "DelayList");
    const periodic = listOf(e, "PeriodicList");
    if (kind === "deterministic" && delay !== undefined) t.rate = delay;
    else if (kind === "scheduled" && periodic) {
      const off = this.coloured ? 1 : 1;
      const row = periodic.rows[periodic.activeRow] ?? periodic.rows[0];
      if (row) t.rate = [row[off], row[off + 1], row[off + 2]].map((v) => (v ?? "").trim()).join(", ");
    } else if (fn !== undefined) t.rate = fn;
    else if (delay !== undefined) t.rate = delay;

    // Time Petri nets: firing interval [EFT, LFT], or a fixed duration.
    const iv = listOf(e, "Interval");
    const eft = cell(iv, 1);
    const lft = cell(iv, 2);
    if (eft !== undefined && lft !== undefined && !(eft === "?" && lft === "?")) {
      t.interval = [eft === "?" ? "0" : eft, normInfinity(lft)];
    } else {
      const d = cell(listOf(e, "Duration"), 1);
      if (d !== undefined && d !== "" && d !== "0") t.interval = [d, d];
    }

    if (this.coloured) {
      const g = cell(listOf(e, "GuardList"), 1);
      if (g) t.guard = g;
    }

    const sound = cell(listOf(e, "Sound"), 1);
    if (sound) t.sound = parseSound(sound);
  }

  /** Rate/weight/delay function: column 1 of the active row (coloured nets: of the first "true" predicate row). */
  private functionCell(e: Element, name: string): string | undefined {
    const cl = listOf(e, name);
    if (!cl || !cl.rows.length) return undefined;
    if (this.coloured && /predicate/i.test(cl.labels[0] ?? "")) {
      const rows = cl.rows.filter((r) => (r[1] ?? "").trim() !== "");
      if (rows.length > 1) this.warn("Transitions with several predicate/function rows were imported with their first function only.");
      return (rows.find((r) => (r[0] ?? "").trim() === "true") ?? rows[0])?.[1]?.trim();
    }
    return cell(cl, 1);
  }

  private readEdge(e: Element) {
    const kind = ARC_CLASSES[e.cls];
    if (kind === undefined) {
      this.warn(`Edges of the Snoopy class "${e.cls}" are not supported and were skipped.`);
      return;
    }
    let source = e.source !== undefined ? this.byData.get(e.source) : undefined;
    let target = e.target !== undefined ? this.byData.get(e.target) : undefined;
    if (!source || !target) {
      this.warn("Some edges refer to nodes that do not exist and were dropped.");
      return;
    }
    // Pick the edge graphic drawn between the real end nodes (not a coarse node) to find
    // which logical copy it attaches to and where its bend points are.
    const g =
      e.graphics.find(
        (g) => g.source && g.target && this.graphicData.get(g.source) === e.source && this.graphicData.get(g.target) === e.target,
      ) ?? e.graphics[0];
    if (g?.source && this.graphicData.get(g.source) === e.source) source = this.byGraphic.get(g.source) ?? source;
    if (g?.target && this.graphicData.get(g.target) === e.target) target = this.byGraphic.get(g.target) ?? target;

    const placeIds = new Set(this.net.places.map((p) => p.id));
    if (placeIds.has(source) === placeIds.has(target)) {
      this.warn("Some edges do not connect a place and a transition and were dropped.");
      return;
    }
    let arcKind: ArcKind;
    let inscription: string;
    if (kind === "modifier") {
      arcKind = "modifier";
      // Coloured nets: the colours the rate may read (Snoopy's default "dot" means the whole place).
      const expr = this.coloured ? cell(listOf(e, "ExpressionList"), 1) : undefined;
      inscription = expr && expr !== "dot" ? expr : "";
    } else {
      arcKind = kind;
      const expr = cell(listOf(e, "ExpressionList"), 1);
      inscription = expr ?? (val(e, "Multiplicity") ?? (kind === "reset" ? "" : "1")).trim();
      if (kind === "reset") inscription = "";
    }
    if (arcKind !== "normal" && placeIds.has(target)) {
      this.warn(`A ${e.cls.toLowerCase()} from a transition to a place was imported as a normal arc.`);
      arcKind = "normal";
    }
    const arc: Arc = { id: this.fresh(`a${e.id}`), source, target, kind: arcKind, inscription };
    const pts = g?.points ?? [];
    if (pts.length > 2) arc.points = pts.slice(1, -1).map((p) => ({ x: p.x * this.scale, y: p.y * this.scale }));
    const color = rgbToHex(g?.pen);
    if (color && color !== "#000000") arc.color = color;
    this.net.arcs.push(arc);
  }

  private readFaultTree() {
    const ft = this.net.faultTree!;
    const byData = new Map<string, string>();
    for (const e of this.nodes) {
      const type = FT_CLASSES[e.cls];
      if (!type) {
        this.warn(`Fault tree nodes of the Snoopy class "${e.cls}" are not supported and were skipped.`);
        continue;
      }
      if (e.cls === "Coarse Event") this.warn("Coarse events were imported as intermediate events.");
      const g = e.graphics.find((x) => x.net === e.net) ?? e.graphics[0];
      const p = this.pos(g);
      const id = this.fresh(`f${e.id}`);
      const n: FTNode = { id, name: val(e, "Name") ?? e.cls, x: p.x, y: p.y, type };
      if (type === "kofn") {
        const m = Number(val(e, "M")?.trim());
        if (Number.isInteger(m) && m >= 1) n.k = m;
      }
      const fr = (val(e, "Failure Rate") ?? "").trim();
      if (fr && Number(fr) !== 0) n.failureRate = fr;
      const rr = (val(e, "Repair Rate") ?? "").trim();
      if (rr && Number(rr) !== 0) n.repairRate = rr;
      // UNVERIFIED: Snoopy computes "Probability of Failure (%)"; we read a non-zero value back as a probability.
      const pf = Number((val(e, "Probability of Failure (%)") ?? "").trim());
      if (Number.isFinite(pf) && pf > 0 && !n.failureRate) n.probability = String(pf / 100);
      const comment = val(e, "Description") || val(e, "Comment");
      if (comment) n.comment = comment;
      const color = rgbToHex(g?.brush);
      if (color && color !== "#ffffff") n.color = color;
      if (e.coarse) this.coarseByNet.set(e.coarse, id);
      this.pendingParent.push([n, e.net]);
      byData.set(e.id, id);
      ft.nodes.push(n);
    }
    for (const e of this.edges) {
      const source = e.source && byData.get(e.source);
      const target = e.target && byData.get(e.target);
      if (!source || !target) {
        this.warn("Some fault tree edges refer to nodes that do not exist and were dropped.");
        continue;
      }
      const edge: FTEdge = { id: this.fresh(`e${e.id}`), source, target };
      const pts = e.graphics[0]?.points ?? [];
      if (pts.length > 2) edge.points = pts.slice(1, -1).map((p) => ({ x: p.x * this.scale, y: p.y * this.scale }));
      ft.edges.push(edge);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Metadata

  private addConstant(c: ConstantDecl) {
    const list = this.net.declarations.constants;
    if (list.some((x) => x.name === c.name)) return;
    list.push(c);
  }

  private readMetadata() {
    const d = this.net.declarations;
    const ignored = new Set(["Plot", "Simulation Properties", "Simulation Results", "Image", "FuzzySettings", "Auxiliary Variables Class"]);
    for (const m of this.metas) {
      switch (m.cls) {
        case "General": {
          const name = (val(m, "Name") ?? "").trim();
          if (name) this.net.name = name;
          const desc = val(m, "Description");
          if (desc) this.net.comment = desc;
          break;
        }
        case "Comment": {
          const g = m.graphics[0];
          const p = this.pos(g);
          const note: Note = { id: this.fresh(`n${m.id}`), x: p.x, y: p.y, text: val(m, "Comment") ?? "" };
          const color = rgbToHex(g?.pen);
          if (color && color !== "#000000") note.color = color;
          (this.net.notes ??= []).push(note);
          this.pendingParent.push([note, g?.net ?? m.net]);
          break;
        }
        case "Constant Class":
        case "Constant Class1": {
          const cl = listOf(m, "ConstantList");
          if (cl) {
            // Coloured nets (legacy list): Name, Type, Value, ...
            for (const row of cl.rows) {
              const name = (row[0] ?? "").trim();
              if (name) this.addConstant({ name, value: (row[2] ?? "").trim() });
            }
          }
          const name = (val(m, "Name") ?? "").trim();
          if (name) {
            const c: ConstantDecl = { name, value: this.constantValue(m) };
            const group = (val(m, "Group") ?? "").trim();
            if (group && group !== "all") c.group = group;
            this.addConstant(c);
          }
          break;
        }
        case "Basic Colorset Class": {
          for (const row of listOf(m, "ColorsetList")?.rows ?? []) {
            const cs = this.basicColourSet(row);
            if (cs) d.colourSets.push(cs);
          }
          break;
        }
        case "Structured Colorset Class": {
          for (const row of listOf(m, "StructuredColorsetList")?.rows ?? []) {
            const name = (row[0] ?? "").trim();
            const type = (row[1] ?? "").trim();
            if (!name) continue;
            if (type === "product" || type === "union") d.colourSets.push({ name, type, components: splitList(row[2] ?? "") });
            else if (type && d.colourSets.some((c) => c.name === type)) {
              // UNVERIFIED: a subset names its parent colour set as the type and gives the predicate
              // (Snoopy's builder writes such rows as "Parent[predicate]").
              d.colourSets.push({ name, type: "subset", components: [type], predicate: subsetPredicate(row[2] ?? "") });
            } else this.warn(`The ${type || "structured"} colour set "${name}" is not supported and was skipped.`);
          }
          break;
        }
        case "Alias Colorset Class": {
          for (const row of listOf(m, "AliasColorsetList")?.rows ?? []) {
            const name = (row[0] ?? "").trim();
            const orig = d.colourSets.find((c) => c.name === (row[1] ?? "").trim());
            if (name && orig) d.colourSets.push({ name, type: "alias", components: [orig.name] });
            else if (name) this.warn(`The alias colour set "${name}" refers to an unknown colour set and was skipped.`);
          }
          break;
        }
        case "Variable Class": {
          for (const row of listOf(m, "VariableList")?.rows ?? []) {
            const name = (row[0] ?? "").trim();
            if (name) d.variables.push({ name, colourSet: (row[1] ?? "").trim() } as VariableDecl);
          }
          break;
        }
        case "Function Class": {
          const fns: FunctionDecl[] = (d.functions ??= []);
          // Coloured nets: one FunctionList with Return type, Function name, Parameter list, Function body.
          for (const row of listOf(m, "FunctionList")?.rows ?? []) {
            const name = (row[1] ?? "").trim();
            if (name) fns.push({ name, params: splitParams(row[2] ?? ""), body: (row[3] ?? "").trim() });
          }
          // Other nets: one metadata per function with Name, Parameter and Body.
          const name = (val(m, "Name") ?? "").trim();
          if (name) fns.push({ name, params: splitParams(val(m, "Parameter") ?? ""), body: (val(m, "Body") ?? "").trim() });
          if (!fns.length) delete d.functions;
          break;
        }
        case "Oberserver Class":
        case "Observer Class": {
          const name = (val(m, "Name") ?? "").trim();
          if (!name) break;
          const type = (val(m, "Type") ?? "").trim();
          const kind: ObserverDecl["kind"] = /^transition/i.test(type) ? "transition" : "place";
          const colType = (val(m, "ColPNType") ?? "").trim();
          if (this.coloured && /instance|mixed/i.test(colType))
            this.warn("Observers over individual colour instances were imported as observers over the coloured nodes; check their expressions.");
          (d.observers ??= []).push({ name, kind, expression: (val(m, "Body") ?? "").trim() });
          break;
        }
        default:
          if (!ignored.has(m.cls)) this.warn(`Snoopy metadata of the class "${m.cls}" is not supported and was skipped.`);
      }
    }
  }

  private constantValue(m: Element): string {
    const type = (val(m, "Type") ?? "").trim();
    const cl = listOf(m, "ValueList");
    if (!cl) return (val(m, "Value") ?? "").trim();
    const row = cl.rows[cl.activeRow] ?? cl.rows[0] ?? [];
    // UNVERIFIED: fuzzy nets store fuzzy numbers in the ConstA..ConstD columns.
    if (/^TFN$/i.test(type)) return `TFN(${[row[2], row[3], row[4]].map((v) => (v ?? "0").trim()).join(", ")})`;
    if (/^(TZN|TrapFN)$/i.test(type)) return `TZN(${[row[2], row[3], row[4], row[5]].map((v) => (v ?? "0").trim()).join(", ")})`;
    if (cl.rows.length > 1) this.warn("Constants with several value sets were imported with their active value set only.");
    return (row[1] ?? "").trim();
  }

  private basicColourSet(row: string[]): ColourSetDecl | undefined {
    const name = (row[0] ?? "").trim();
    const type = (row[1] ?? "").trim().toLowerCase();
    const colors = (row[2] ?? "").trim();
    if (!name) return undefined;
    switch (type) {
      case "dot":
        return { name, type: "dot" };
      case "enum":
        return { name, type: "enum", values: splitList(colors) };
      case "bool":
        return { name, type: "bool" };
      case "int": {
        const m = /^\s*(-?\d+)\s*-\s*(-?\d+)\s*$/.exec(colors);
        if (m) return { name, type: "int", min: Number(m[1]), max: Number(m[2]) };
        const vals = splitList(colors).map(Number);
        if (vals.length && vals.every(Number.isInteger)) {
          const min = Math.min(...vals);
          const max = Math.max(...vals);
          if (vals.length !== max - min + 1) this.warn(`The int colour set "${name}" (${colors}) was widened to the range ${min}..${max}.`);
          return { name, type: "int", min, max };
        }
        this.warn(`The int colour set "${name}" has colours "${colors}" that could not be read; it was skipped.`);
        return undefined;
      }
      case "string":
        return { name, type: "string", values: splitList(colors).map((v) => v.replace(/^"(.*)"$/, "$1")) };
      default:
        this.warn(`The ${type || "untyped"} colour set "${name}" is not supported and was skipped.`);
        return undefined;
    }
  }
}

/** "x > 2", "{x > 2}" or "Parent[x > 2]" -> "x > 2". */
function subsetPredicate(s: string): string {
  const t = s.trim();
  const m = /^[A-Za-z_][A-Za-z0-9_]*\s*\[(.*)\]$/s.exec(t) ?? /^\{(.*)\}$/s.exec(t);
  return (m ? m[1] : t).trim();
}

function splitList(s: string): string[] {
  return s
    .replace(/[{}]/g, "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

// UNVERIFIED: Snoopy stores the sound as one text cell; we write "note[;duration[;instrument]]".
function parseSound(s: string): NonNullable<Transition["sound"]> {
  const [note, duration, instrument] = s.split(";").map((x) => x.trim());
  const out: NonNullable<Transition["sound"]> = { note };
  const d = Number(duration);
  if (duration && Number.isFinite(d) && d > 0) out.duration = d;
  if (instrument && (SOUND_INSTRUMENTS as readonly string[]).includes(instrument))
    out.instrument = instrument as (typeof SOUND_INSTRUMENTS)[number];
  return out;
}

function formatSound(s: NonNullable<Transition["sound"]>): string {
  if (s.instrument) return `${s.note};${s.duration ?? ""};${s.instrument}`;
  if (s.duration !== undefined) return `${s.note};${s.duration}`;
  return s.note;
}

// =============================================================================================
// Export

/** Snoopy expression syntax: & | ! instead of and/&&, or/||, not; = and <> for comparisons. */
export function toSnoopyExpression(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'") {
      const j = s.indexOf(c, i + 1);
      const end = j < 0 ? s.length : j + 1;
      out += s.slice(i, end);
      i = end;
      continue;
    }
    if (s.startsWith("&&", i)) (out += "&"), (i += 2);
    else if (s.startsWith("||", i)) (out += "|"), (i += 2);
    else if (s.startsWith("==", i)) (out += "="), (i += 2);
    else if (s.startsWith("!=", i)) (out += "<>"), (i += 2);
    else if (/[A-Za-z_]/.test(c) && !/[A-Za-z0-9_.]/.test(s[i - 1] ?? "")) {
      const m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(s.slice(i))![0];
      out += m === "and" ? "&" : m === "or" ? "|" : m === "not" ? "!" : m;
      i += m.length;
    } else (out += c), i++;
  }
  return out;
}

/** Splits a multiset expression at top-level "++". */
export function splitMultiset(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0 && s.startsWith("++", i)) {
      parts.push(s.slice(start, i).trim());
      start = i + 2;
      i++;
    }
  }
  parts.push(s.slice(start).trim());
  return parts.filter((p) => p !== "");
}

interface ClassLayout {
  name: string;
  places: string[];
  transitions: string[];
  edges: string[];
  /** Snoopy class names of quantitative behaviour. */
  base: "stochastic" | "continuous" | "hybrid" | null;
  fixed: boolean;
  coloured: boolean;
}

const EDGE_CLASS: Record<ArcKind, string> = {
  normal: "Edge",
  read: "Read Edge",
  inhibitor: "Inhibitor Edge",
  reset: "Reset Edge",
  equal: "Equal Edge",
  modifier: "Modifier Edge",
};

const PN_EDGES = ["Edge"];
const XPN_EDGES = ["Edge", "Read Edge", "Inhibitor Edge", "Reset Edge", "Equal Edge"];
const SPN_EDGES = [...XPN_EDGES, "Modifier Edge"];
const CPN_EDGES = ["Edge", "Inhibitor Edge", "Read Edge", "Modifier Edge"];
const SPN_TRANS = ["Transition", "Immediate Transition", "Deterministic Transition", "Scheduled Transition"];

function layoutFor(net: Net): ClassLayout {
  const c = net.netClass;
  const coloured = isColoured(c);
  const base = timeBase(c);
  const anyExtended = net.arcs.some((a) => a.kind !== "normal");
  let name = SNOOPY_CLASSES[c].name;
  // APNs with colour-sensitive inhibitor arcs are Snoopy coloured extended nets.
  if ((c === "coloured" || c === "apn") && anyExtended) name = COLOURED_EXTENDED;
  if (c === "pt" && anyExtended) name = SNOOPY_CLASSES.xpt.name;
  if (base === "stochastic")
    return { name, places: ["Place"], transitions: SPN_TRANS, edges: SPN_EDGES, base, fixed: true, coloured };
  if (base === "continuous")
    return { name, places: ["Place, Continuous"], transitions: ["Transition, Continuous"], edges: CPN_EDGES, base, fixed: true, coloured };
  if (base === "hybrid")
    return {
      name,
      places: ["Place", "Place, Continuous"],
      transitions: ["Transition", "Transition, Continuous", "Immediate Transition", "Deterministic Transition", "Scheduled Transition"],
      edges: SPN_EDGES,
      base,
      fixed: true,
      coloured,
    };
  const extended = name === SNOOPY_CLASSES.xpt.name || name === COLOURED_EXTENDED;
  return { name, places: ["Place"], transitions: ["Transition"], edges: extended ? XPN_EDGES : PN_EDGES, base: null, fixed: extended, coloured };
}

/** Number formatting as Snoopy writes it (two decimals), with more digits only when needed to be exact. */
function fmt(n: number): string {
  const two = n.toFixed(2);
  if (Number(two) === n) return two;
  return String(Number(n.toFixed(6)));
}

function cdataText(s: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
  return `<![CDATA[${clean.split("]]>").join("]]]]><![CDATA[>")}]]>`;
}

function xattr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

class Out {
  lines: string[] = [];
  push(depth: number, s: string) {
    this.lines.push("  ".repeat(depth) + s);
  }
}

interface NodeGraphicOut {
  id: number;
  net: number;
  x: number;
  y: number;
  /** Our node id this graphic stands for. */
  ref: string;
}

interface DataNode {
  dataId: number;
  cls: string;
  net: number;
  logical: boolean;
  coarseNet?: number;
  graphics: NodeGraphicOut[];
  /** The first model node (for attributes). */
  model: Place | Transition | FTNode;
  extraAttrs?: [string, string][];
}

export function exportSnoopy(net: Net, options: SnoopyOptions = {}): string {
  return exportSnoopyWithWarnings(net, options).xml;
}

/**
 * Writes a Snoopy 2 file. Fields Snoopy has no place for (capacities, guards in uncoloured nets,
 * kinds a class does not have, ...) are dropped and reported in `warnings`.
 */
export function exportSnoopyWithWarnings(net: Net, options: SnoopyOptions = {}): SnoopyExportResult {
  return new SnoopyExporter(net, options).run();
}

class SnoopyExporter {
  private warnings: string[] = [];
  private nextId = 100;
  private s: number;
  private out = new Out();
  private layout: ClassLayout;
  /** Subnet number of each coarse node, and the net each node lives in. */
  private subnetOf = new Map<string, number>();
  private netParent = new Map<number, number>();
  private coarseAt = new Map<number, string>();
  private dataOf = new Map<string, DataNode>();
  private graphicOf = new Map<string, NodeGraphicOut>();
  private datas: DataNode[] = [];
  private classIds = new Map<string, number>();

  constructor(
    private net: Net,
    options: SnoopyOptions,
  ) {
    this.s = options.scale ?? 2;
    this.layout = layoutFor(net);
  }

  private id() {
    return this.nextId++;
  }

  private warn(w: string) {
    if (!this.warnings.includes(w)) this.warnings.push(w);
  }

  private netOf(n: { parent?: string }): number {
    return n.parent !== undefined ? this.subnetOf.get(n.parent) ?? 1 : 1;
  }

  run(): SnoopyExportResult {
    const net = this.net;
    if (net.netClass === "pt" && this.layout.name !== SNOOPY_CLASSES.pt.name)
      this.warn("The net has read, inhibitor, reset or equal arcs and was saved as an Extended Petri Net.");
    // Subnet numbers: one per coarse node, in document order.
    let n = 2;
    for (const c of [...net.places, ...net.transitions]) if (c.coarse) this.subnetOf.set(c.id, n++);
    for (const c of [...net.places, ...net.transitions])
      if (c.coarse) {
        this.netParent.set(this.subnetOf.get(c.id)!, this.netOf(c));
        this.coarseAt.set(this.subnetOf.get(c.id)!, c.id);
      }

    const o = this.out;
    o.lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    o.lines.push('<?xml-stylesheet type="text/xsl" href="/xsl/spped2svg.xsl"?>');
    o.push(0, '<Snoopy version="2" revision="2.0">');
    o.push(1, `<netclass name="${xattr(this.layout.name)}"/>`);
    if (isFaultTree(net.netClass)) this.writeFaultTree();
    else if (net.netClass === "freestyle") this.writeFreestyle();
    else this.writePetriNet();
    this.writeMetadata();
    o.push(0, "</Snoopy>");
    return { xml: o.lines.join("\n") + "\n", warnings: this.warnings };
  }

  // -------------------------------------------------------------------------------------------
  // Petri nets

  private placeClass(p: Place): string {
    if (p.coarse) return "Coarse Place";
    const base = this.layout.base;
    if (base === "continuous") return "Place, Continuous";
    if (base === "hybrid" && p.continuous) return "Place, Continuous";
    if (p.continuous && base !== "hybrid") this.warn(`Continuous places only exist in hybrid nets; they were saved as ordinary places.`);
    return "Place";
  }

  private transitionClass(t: Transition): string {
    if (t.coarse) return "Coarse Transition";
    const base = this.layout.base;
    const kind = t.kind ?? defaultTransitionKind(this.net.netClass);
    if (!base) {
      if (t.kind) this.warn(`Transition kinds only exist in stochastic, continuous and hybrid nets and were dropped.`);
      return "Transition";
    }
    if (base === "continuous") {
      if (kind !== "continuous") this.warn(`Continuous nets only have continuous transitions; other kinds were saved as continuous.`);
      return "Transition, Continuous";
    }
    switch (kind) {
      case "immediate":
        return "Immediate Transition";
      case "deterministic":
        return "Deterministic Transition";
      case "scheduled":
        return "Scheduled Transition";
      case "continuous":
        if (base === "hybrid") return "Transition, Continuous";
        this.warn("Continuous transitions only exist in continuous and hybrid nets; they were saved as stochastic transitions.");
        return "Transition";
      default:
        return "Transition";
    }
  }

  private nodeGraphic(ref: string, net: number, x: number, y: number): NodeGraphicOut {
    return { id: this.id(), net, x, y, ref };
  }

  private writePetriNet() {
    const net = this.net;
    // Data nodes: logical places with the same name share one Snoopy node with one graphic per copy.
    const logicalGroups = new Map<string, DataNode>();
    const add = (m: Place | Transition, cls: string) => {
      const g = this.nodeGraphic(m.id, this.netOf(m), m.x / this.s, m.y / this.s);
      this.graphicOf.set(m.id, g);
      const isLogical = "marking" in m && !!m.logical && !m.coarse;
      if (isLogical) {
        const key = `${cls}\u0000${m.name}`;
        const existing = logicalGroups.get(key);
        if (existing) {
          existing.graphics.push(g);
          this.dataOf.set(m.id, existing);
          if ((m as Place).marking !== (existing.model as Place).marking)
            this.warn(`Logical place "${m.name}" has different markings on its copies; the first one was kept.`);
          return;
        }
      }
      const d: DataNode = { dataId: this.id(), cls, net: this.netOf(m), logical: isLogical, graphics: [g], model: m };
      if (m.coarse) d.coarseNet = this.subnetOf.get(m.id);
      if (isLogical) logicalGroups.set(`${cls}\u0000${m.name}`, d);
      this.dataOf.set(m.id, d);
      this.datas.push(d);
    };
    for (const p of net.places) add(p, this.placeClass(p));
    for (const t of net.transitions) add(t, this.transitionClass(t));
    if (net.places.some((p) => p.capacity !== undefined)) this.warn("Snoopy has no place capacities; they were dropped.");
    if (!this.layout.coloured && net.transitions.some((t) => t.guard)) this.warn("Guards only exist in coloured nets and were dropped.");

    // Edges, with border copies of nodes for arcs that cross subnet boundaries.
    const edges: { arc: Arc; cls: string; graphics: { id: number; net: number; src: NodeGraphicOut; tgt: NodeGraphicOut; pts: Point[] }[] }[] = [];
    for (const a of net.arcs) {
      const cls = this.edgeClass(a);
      if (!cls) continue;
      edges.push({ arc: a, cls, graphics: this.edgeGraphics(a) });
    }

    // Node classes.
    const o = this.out;
    const ncs = [...this.layout.places, ...this.layout.transitions, "Coarse Place", "Coarse Transition"];
    if (net.netClass === "modulo") ncs.push("Modulo");
    o.push(1, `<nodeclasses count="${ncs.length}">`);
    for (const cls of ncs) {
      const items = this.datas.filter((d) => d.cls === cls);
      if (cls === "Modulo") {
        this.writeModulo();
        continue;
      }
      for (const d of this.datas) if (d.cls === cls && !ncs.includes(cls)) this.warn(`Internal: unexpected class ${cls}`);
      o.push(2, items.length ? `<nodeclass count="${items.length}" name="${xattr(cls)}">` : `<nodeclass count="0" name="${xattr(cls)}"/>`);
      if (!items.length) continue;
      for (const d of items) this.writeNode(d);
      o.push(2, "</nodeclass>");
    }
    o.push(1, "</nodeclasses>");

    o.push(1, `<edgeclasses count="${this.layout.edges.length}">`);
    for (const cls of this.layout.edges) {
      const items = edges.filter((e) => e.cls === cls);
      o.push(2, items.length ? `<edgeclass count="${items.length}" name="${xattr(cls)}">` : `<edgeclass count="0" name="${xattr(cls)}"/>`);
      if (!items.length) continue;
      for (const e of items) this.writeEdge(e.arc, e.graphics);
      o.push(2, "</edgeclass>");
    }
    o.push(1, "</edgeclasses>");
  }

  private writeModulo() {
    const o = this.out;
    const m = this.net.modulus ?? 2;
    const dataId = this.id();
    const gid = this.id();
    o.push(2, `<nodeclass count="1" name="Modulo">`);
    o.push(3, `<node id="${dataId}" net="1">`);
    this.writeAttr(4, "Modulo", String(m), [{ show: true, parent: gid, x: 20, y: 20 }]);
    o.push(4, `<graphics count="1">`);
    o.push(5, `<graphic x="20.00" y="20.00" id="${gid}" net="1" show="1" w="20.00" h="20.00" state="1" pen="0,0,0" brush="255,255,255"/>`);
    o.push(4, `</graphics>`);
    o.push(3, `</node>`);
    o.push(2, `</nodeclass>`);
  }

  private edgeClass(a: Arc): string | undefined {
    const allowed = this.layout.edges;
    const cls = EDGE_CLASS[a.kind];
    if (!allowed.includes(cls)) {
      this.warn(`A ${this.layout.name} cannot have ${a.kind} arcs; they were dropped.`);
      return undefined;
    }
    return cls;
  }

  /** Nets from `net` up to the top. */
  private chain(net: number): number[] {
    const out = [net];
    let cur = net;
    while (cur !== 1 && this.netParent.has(cur)) {
      cur = this.netParent.get(cur)!;
      if (out.includes(cur)) break;
      out.push(cur);
    }
    if (!out.includes(1)) out.push(1);
    return out;
  }

  /** The graphic standing for node `id` in subnet `net`: itself, its coarse ancestor, or a border copy. */
  private represent(id: string, net: number, near: NodeGraphicOut): NodeGraphicOut {
    const own = this.graphicOf.get(id)!;
    if (own.net === net) return own;
    const myChain = this.chain(own.net);
    if (myChain.includes(net)) {
      // Our node lies deeper: the coarse node of the subnet just below `net` stands for it.
      const below = myChain[myChain.indexOf(net) - 1];
      const coarse = this.coarseAt.get(below)!;
      return this.graphicOf.get(coarse)!;
    }
    // Our node lies above (or beside): add a border copy in `net`, left of the other end. UNVERIFIED placement.
    const d = this.dataOf.get(id)!;
    let copy = d.graphics.find((g) => g.net === net && g.ref === id);
    if (!copy) {
      copy = this.nodeGraphic(id, net, near.x - 50, near.y);
      d.graphics.push(copy);
    }
    return copy;
  }

  private edgeGraphics(a: Arc) {
    const src = this.graphicOf.get(a.source)!;
    const tgt = this.graphicOf.get(a.target)!;
    const pts = (a.points ?? []).map((p) => ({ x: p.x / this.s, y: p.y / this.s }));
    if (src.net === tgt.net) return [{ id: this.id(), net: src.net, src, tgt, pts }];
    const ca = this.chain(src.net);
    const cb = this.chain(tgt.net);
    const lca = ca.find((n) => cb.includes(n)) ?? 1;
    const nets = [...ca.slice(0, ca.indexOf(lca) + 1), ...cb.slice(0, cb.indexOf(lca))];
    const out: { id: number; net: number; src: NodeGraphicOut; tgt: NodeGraphicOut; pts: Point[] }[] = [];
    // Innermost first so border copies are placed next to the real node.
    nets.sort((x, y) => this.chain(y).length - this.chain(x).length);
    for (const n of nets) {
      const s = src.net === n ? src : undefined;
      const t = tgt.net === n ? tgt : undefined;
      const sg = s ?? this.represent(a.source, n, t ?? this.represent(a.target, n, src));
      const tg = t ?? this.represent(a.target, n, sg);
      const sCoarse = sg.ref !== a.source;
      const tCoarse = tg.ref !== a.target;
      if (sCoarse && tCoarse) continue;
      out.push({ id: this.id(), net: n, src: sg, tgt: tg, pts: [] });
    }
    // Bend points belong to the graphic that joins the real nodes (if any).
    const real = out.find((g) => g.src.ref === a.source && g.tgt.ref === a.target && g.src.net === g.tgt.net) ?? out[0];
    if (real) real.pts = pts;
    return out;
  }

  private writeAttr(
    depth: number,
    name: string,
    value: string,
    graphics: { show: boolean; parent: number; x: number; y: number; xoff?: number; yoff?: number; net?: number }[],
  ) {
    const o = this.out;
    o.push(depth, `<attribute name="${xattr(name)}" id="${this.id()}" net="1">`);
    o.push(depth + 1, cdataText(value));
    this.writeAttrGraphics(depth + 1, graphics);
    o.push(depth, `</attribute>`);
  }

  private writeAttrGraphics(depth: number, graphics: { show: boolean; parent: number; x: number; y: number; xoff?: number; yoff?: number; net?: number }[]) {
    const o = this.out;
    if (!graphics.length) {
      o.push(depth, `<graphics count="0"/>`);
      return;
    }
    o.push(depth, `<graphics count="${graphics.length}">`);
    for (const g of graphics) {
      const off = `${g.xoff ? ` xoff="${fmt(g.xoff)}"` : ""}${g.yoff ? ` yoff="${fmt(g.yoff)}"` : ""}`;
      o.push(
        depth + 1,
        `<graphic${off} x="${fmt(g.x + (g.xoff ?? 0))}" y="${fmt(g.y + (g.yoff ?? 0))}" id="${this.id()}" net="${g.net ?? 1}" show="${g.show ? 1 : 0}" grparent="${g.parent}" state="1" pen="0,0,0" brush="255,255,255"/>`,
      );
    }
    o.push(depth, `</graphics>`);
  }

  private writeColList(depth: number, name: string, labels: string[], rows: string[][], graphics: Parameters<SnoopyExporter["writeAttrGraphics"]>[1]) {
    const o = this.out;
    o.push(depth, `<attribute name="${xattr(name)}" type="ColList" id="${this.id()}" net="1">`);
    o.push(depth + 1, `<colList row_count="${rows.length}" col_count="${labels.length}" active_row="0" active_col="0">`);
    o.push(depth + 2, `<colList_head>`);
    for (const l of labels) o.push(depth + 3, `<colList_colLabel>${cdataText(l)}</colList_colLabel>`);
    o.push(depth + 2, `</colList_head>`);
    if (!rows.length) o.push(depth + 2, `<colList_body/>`);
    else {
      o.push(depth + 2, `<colList_body>`);
      rows.forEach((r, i) => {
        o.push(depth + 3, `<colList_row nr="${i}">`);
        labels.forEach((_, j) => o.push(depth + 4, `<colList_col nr="${j}">${cdataText(r[j] ?? "")}</colList_col>`));
        o.push(depth + 3, `</colList_row>`);
      });
      o.push(depth + 2, `</colList_body>`);
    }
    o.push(depth + 1, `</colList>`);
    this.writeAttrGraphics(depth + 1, graphics);
    o.push(depth, `</attribute>`);
  }

  private classId(cls: string): number {
    const key = /Transition/.test(cls) && !/Coarse/.test(cls) ? "Transition" : /Place/.test(cls) && !/Coarse/.test(cls) ? "Place" : cls;
    const n = this.classIds.get(key) ?? 0;
    this.classIds.set(key, n + 1);
    return n;
  }

  private writeNode(d: DataNode) {
    const o = this.out;
    const m = d.model as Place | Transition;
    const isPlace = "marking" in m;
    const gs = (extra: { show: boolean; xoff?: number; yoff?: number }) =>
      d.graphics.map((g) => ({ ...extra, parent: g.id, x: g.x, y: g.y, net: g.net }));
    // Each copy (logical nodes) keeps its own label position.
    const nameGraphics = d.graphics.map((g) => {
      const lo = (this.netNode(g.ref) ?? m).labelOffset;
      return {
        show: true,
        parent: g.id,
        x: g.x,
        y: g.y,
        net: g.net,
        xoff: SNOOPY_NAME_OFFSET.x + (lo?.x ?? 0) / this.s,
        yoff: SNOOPY_NAME_OFFSET.y + (lo?.y ?? 0) / this.s,
      };
    });
    let head = `<node id="${d.dataId}" net="${d.net}"`;
    if (d.logical && d.graphics.length > 1) head += ` logic="1"`;
    if (d.coarseNet !== undefined) head += ` coarse="${d.coarseNet}"`;
    o.push(3, head + ">");
    this.writeAttr(4, "Name", m.name, nameGraphics);
    if (!m.coarse) {
      this.writeAttr(4, "ID", String(this.classId(d.cls)), gs({ show: false, xoff: 25, yoff: 20 }));
      if (isPlace) this.writePlaceAttrs(d, m as Place, gs);
      else this.writeTransitionAttrs(d, m as Transition, gs);
      this.writeAttr(4, "Logic", d.logical && d.graphics.length > 1 ? "1" : "0", []);
    }
    this.writeAttr(4, "Comment", m.comment ?? "", gs(isPlace ? { show: true, yoff: 40 } : { show: true, xoff: 40 }));
    o.push(4, `<graphics count="${d.graphics.length}">`);
    for (const g of d.graphics) {
      const model = g.ref === m.id ? m : (this.netNode(g.ref) ?? m);
      const brush = hexToRgb(model.color) ?? "255,255,255";
      const size = !isPlace && (model as Transition).horizontal ? `w="20.00" h="8.00"` : `w="20.00" h="20.00"`;
      o.push(5, `<graphic x="${fmt(g.x)}" y="${fmt(g.y)}" id="${g.id}" net="${g.net}" show="1" ${size} state="1" pen="0,0,0" brush="${brush}"/>`);
    }
    o.push(4, `</graphics>`);
    o.push(3, `</node>`);
  }

  private netNode(id: string): Place | Transition | undefined {
    return this.net.places.find((p) => p.id === id) ?? this.net.transitions.find((t) => t.id === id);
  }

  private writePlaceAttrs(d: DataNode, p: Place, gs: (e: { show: boolean; xoff?: number; yoff?: number }) => Parameters<SnoopyExporter["writeAttrGraphics"]>[1]) {
    if (this.layout.coloured) {
      const cs = p.colourSet ?? "Dot";
      const rows = this.markingRows(p.marking, cs);
      this.writeColList(4, "MarkingList", ["Main: Color(s)", "Main: Marking", "Product Color"], rows, gs({ show: true }));
      this.writeAttr(4, "Colorset", cs, gs({ show: true, xoff: -25, yoff: -20 }));
    } else {
      this.writeAttr(4, "Marking", p.marking.trim() === "" ? "0" : p.marking.trim(), gs({ show: true }));
    }
    if (this.layout.fixed) this.writeAttr(4, "Fixed", p.fixed && this.layout.base ? "1" : "0", []);
    if (p.fixed && !this.layout.base) this.warn("Fixed places only exist in stochastic, continuous and hybrid nets; they were saved as ordinary places.");
  }

  /** UNVERIFIED: one MarkingList row per multiset term: [colour, count, "()"]; all(CS) becomes all(). */
  private markingRows(marking: string, cs: string): string[][] {
    const rows: string[][] = [];
    for (const term of splitMultiset(marking.trim())) {
      const m = /^\s*(\d+)\s*`\s*(.+)$/s.exec(term);
      let count = m ? m[1] : "1";
      let colour = (m ? m[2] : term).trim();
      const all = /^all\(\s*([A-Za-z_][A-Za-z0-9_]*)?\s*\)$/.exec(colour);
      if (all && (!all[1] || all[1] === cs)) colour = "all()";
      if (/^\d+$/.test(colour) && cs === "Dot" && !m) {
        // A bare number on a black-token place means that many dots.
        count = colour;
        colour = "dot";
      }
      rows.push([toSnoopyExpression(colour), count, "()"]);
    }
    return rows;
  }

  private writeTransitionAttrs(d: DataNode, t: Transition, gs: (e: { show: boolean; xoff?: number; yoff?: number }) => Parameters<SnoopyExporter["writeAttrGraphics"]>[1]) {
    const cls = d.cls;
    const coloured = this.layout.coloured;
    const fnRows = (value: string) => (coloured ? [["true", value]] : [["Main", value]]);
    const labels = (main: string) => (coloured ? ["Predicate", `Main: ${main}`] : [`${main} set`, main]);
    const rate = t.rate?.trim();
    switch (cls) {
      case "Transition":
      case "Transition, Continuous":
        if (this.layout.base) this.writeColList(4, "FunctionList", labels("Function"), fnRows(rate || "MassAction(1)"), gs({ show: false, yoff: 30 }));
        break;
      case "Immediate Transition":
        this.writeColList(4, "FunctionList", labels("Weight"), fnRows(rate || "1"), gs({ show: false, yoff: 30 }));
        break;
      case "Deterministic Transition":
        this.writeColList(4, "DelayList", labels("Delay"), fnRows(rate || "1"), gs({ show: false, yoff: 30 }));
        break;
      case "Scheduled Transition": {
        const parts = (rate || "_SimStart, 1, _SimEnd").split(",").map((x) => x.trim());
        while (parts.length < 3) parts.push(parts.length === 1 ? "1" : "_SimEnd");
        const head = coloured ? ["Predicate", "Main: Begin", "Main: Repetition", "Main: End"] : ["Periodic List", "Begin", "Repetition", "End"];
        this.writeColList(4, "PeriodicList", head, [[coloured ? "true" : "Main", ...parts.slice(0, 3)]], gs({ show: false, yoff: 30 }));
        break;
      }
    }
    if (rate && !this.layout.base) this.warn("Rates only exist in stochastic, continuous and hybrid nets and were dropped.");
    if (this.net.netClass === "timed") {
      const iv = t.interval ?? ["0", "inf"];
      const lft = /^(inf|infinity|oo|w)$/i.test(iv[1].trim()) ? "oo" : iv[1];
      this.writeColList(4, "Interval", ["Interval List", "EFT", "LFT"], [["Main", iv[0], lft]], gs({ show: true, yoff: -20 }));
    } else if (t.interval) this.warn("Firing intervals only exist in timed nets and were dropped.");
    if (coloured) this.writeColList(4, "GuardList", ["Guard set", "Guard"], [["Main", toSnoopyExpression(t.guard ?? "")]], gs({ show: true, xoff: 20, yoff: -20 }));
    if (this.net.netClass === "music") {
      this.writeAttr(4, "Play Sound when Transition fires", "1", []);
      this.writeColList(4, "Sound", ["Sound List", "Sound"], [["Main", t.sound ? formatSound(t.sound) : ""]], []);
    } else if (t.sound) this.warn("Sounds only exist in music nets and were dropped.");
  }

  private writeEdge(a: Arc, graphics: { id: number; net: number; src: NodeGraphicOut; tgt: NodeGraphicOut; pts: Point[] }[]) {
    const o = this.out;
    const sd = this.dataOf.get(a.source)!;
    const td = this.dataOf.get(a.target)!;
    const net = Math.min(...graphics.map((g) => g.net), sd.net);
    o.push(3, `<edge source="${sd.dataId}" target="${td.dataId}" id="${this.id()}" net="${net}">`);
    const mid = (g: (typeof graphics)[number]) => ({
      show: true,
      parent: g.id,
      x: (g.src.x + g.tgt.x) / 2,
      y: (g.src.y + g.tgt.y) / 2,
      net: g.net,
    });
    if (a.kind === "modifier") {
      // Uncoloured modifier edges carry no inscription; coloured ones an ExpressionList (default dot).
      if (this.layout.coloured)
        this.writeColList(4, "ExpressionList", ["Expression set", "Expression"], [["Main", toSnoopyExpression(a.inscription.trim() || "dot")]], graphics.map(mid));
    } else if (a.kind !== "reset") {
      if (this.layout.coloured) {
        const label = a.kind === "normal" ? ["Expression set", "Expression"] : ["Inscription set", "Inscription"];
        this.writeColList(4, "ExpressionList", label, [["Main", toSnoopyExpression(a.inscription.trim() || "dot")]], graphics.map(mid));
      } else this.writeAttr(4, "Multiplicity", a.inscription.trim() || "1", graphics.map(mid));
    }
    this.writeAttr(4, "Comment", "", graphics.map((g) => ({ ...mid(g), xoff: 20 })));
    const pen = hexToRgb(a.color) ?? "0,0,0";
    o.push(4, `<graphics count="${graphics.length}">`);
    for (const g of graphics) {
      const pts = [{ x: g.src.x, y: g.src.y }, ...g.pts, { x: g.tgt.x, y: g.tgt.y }];
      o.push(5, `<graphic id="${g.id}" net="${g.net}" source="${g.src.id}" target="${g.tgt.id}" state="1" show="1" pen="${pen}" brush="${pen}" edge_designtype="3">`);
      o.push(6, `<points count="${pts.length}">`);
      for (const p of pts) o.push(7, `<point x="${fmt(p.x)}" y="${fmt(p.y)}"/>`);
      o.push(6, `</points>`);
      o.push(5, `</graphic>`);
    }
    o.push(4, `</graphics>`);
    o.push(3, `</edge>`);
  }

  // -------------------------------------------------------------------------------------------
  // Fault trees and freestyle nets

  private writeFaultTree() {
    const o = this.out;
    const ft = this.net.faultTree ?? { nodes: [], edges: [] };
    const extended = this.net.netClass === "extendedFaultTree";
    const names: Partial<Record<FTNodeType, string>> = {
      top: "Top Event",
      intermediate: "Intermediate Event",
      basic: "Basic Event",
      and: "AND",
      or: "OR",
      not: "NEG",
    };
    if (extended) Object.assign(names, { undeveloped: "Undeveloped Event", xor: "XOR", kofn: "M-OF-N", cond: "COND" });
    const classes = extended
      ? ["Top Event", "Intermediate Event", "Basic Event", "Undeveloped Event", "AND", "OR", "NEG", "XOR", "M-OF-N", "COND", "Coarse Event"]
      : ["Top Event", "Intermediate Event", "Basic Event", "AND", "OR", "NEG", "Coarse Event"];
    const graphicOf = new Map<string, { gid: number; dataId: number; x: number; y: number }>();
    const nodes: { n: FTNode; cls: string }[] = [];
    for (const n of ft.nodes) {
      const cls = names[n.type];
      if (!cls) {
        this.warn(`Snoopy's ${this.layout.name} has no ${n.type} nodes; they were dropped.`);
        continue;
      }
      if (n.parent !== undefined) this.warn("Fault tree subtrees were flattened to the top level.");
      graphicOf.set(n.id, { gid: this.id(), dataId: this.id(), x: n.x / this.s, y: n.y / this.s });
      nodes.push({ n, cls });
    }
    const inputs = (id: string) => ft.edges.filter((e) => e.target === id).length;
    o.push(1, `<nodeclasses count="${classes.length}">`);
    for (const cls of classes) {
      const items = nodes.filter((x) => x.cls === cls);
      o.push(2, items.length ? `<nodeclass count="${items.length}" name="${cls}">` : `<nodeclass count="0" name="${cls}"/>`);
      if (!items.length) continue;
      items.forEach(({ n }, i) => {
        const g = graphicOf.get(n.id)!;
        const gs = (show: boolean, yoff = 0) => [{ show, parent: g.gid, x: g.x, y: g.y, yoff }];
        o.push(3, `<node id="${g.dataId}" net="1">`);
        const isEvent = /Event/.test(cls);
        // Gates may have no Name attribute in Snoopy (UNVERIFIED); Snoopy ignores attributes a class
        // lacks, so writing it is harmless and keeps gate names in our own round trips.
        this.writeAttr(4, "Name", n.name, gs(isEvent || cls === "COND", 20));
        if (isEvent) {
          this.writeAttr(4, "ID", String(i), gs(false));
          this.writeAttr(4, "Description", n.comment ?? "", gs(true, 40));
          if (cls === "Basic Event" || cls === "Undeveloped Event") {
            this.writeAttr(4, "Failure Rate", n.failureRate ?? "0.0", gs(false));
            this.writeAttr(4, "Repair Rate", n.repairRate ?? "0.0", gs(false));
            if (n.probability !== undefined && Number.isFinite(Number(n.probability)))
              this.writeAttr(4, "Probability of Failure (%)", String(Number(n.probability) * 100), []);
          }
        } else {
          if (n.comment) this.writeAttr(4, "Comment", n.comment, gs(true, 40));
          if (cls === "M-OF-N") {
            this.writeAttr(4, "M", String(n.k ?? 1), gs(true));
            this.writeAttr(4, "N", String(Math.max(inputs(n.id), n.k ?? 1)), gs(true));
          }
        }
        const brush = hexToRgb(n.color) ?? "255,255,255";
        o.push(4, `<graphics count="1">`);
        o.push(5, `<graphic x="${fmt(g.x)}" y="${fmt(g.y)}" id="${g.gid}" net="1" show="1" w="20.00" h="20.00" state="1" pen="0,0,0" brush="${brush}"/>`);
        o.push(4, `</graphics>`);
        o.push(3, `</node>`);
      });
      o.push(2, `</nodeclass>`);
    }
    o.push(1, `</nodeclasses>`);
    const edges = ft.edges.filter((e) => graphicOf.has(e.source) && graphicOf.has(e.target));
    o.push(1, `<edgeclasses count="1">`);
    o.push(2, edges.length ? `<edgeclass count="${edges.length}" name="Edge">` : `<edgeclass count="0" name="Edge"/>`);
    if (edges.length) {
      for (const e of edges) {
        const s = graphicOf.get(e.source)!;
        const t = graphicOf.get(e.target)!;
        const gid = this.id();
        o.push(3, `<edge source="${s.dataId}" target="${t.dataId}" id="${this.id()}" net="1">`);
        this.writeAttr(4, "Comment", "", []);
        o.push(4, `<graphics count="1">`);
        const pts = [{ x: s.x, y: s.y }, ...(e.points ?? []).map((p) => ({ x: p.x / this.s, y: p.y / this.s })), { x: t.x, y: t.y }];
        o.push(5, `<graphic id="${gid}" net="1" source="${s.gid}" target="${t.gid}" state="1" show="1" pen="0,0,0" brush="0,0,0" edge_designtype="3">`);
        o.push(6, `<points count="${pts.length}">`);
        for (const p of pts) o.push(7, `<point x="${fmt(p.x)}" y="${fmt(p.y)}"/>`);
        o.push(6, `</points>`);
        o.push(5, `</graphic>`);
        o.push(4, `</graphics>`);
        o.push(3, `</edge>`);
      }
      o.push(2, `</edgeclass>`);
    }
    o.push(1, `</edgeclasses>`);
    if (this.net.places.length || this.net.transitions.length) this.warn("Places and transitions of a fault tree file were dropped.");
  }

  /** UNVERIFIED: places become circles and transitions rectangles of a Snoopy freestyle net. */
  private writeFreestyle() {
    const o = this.out;
    const datas = new Map<string, { dataId: number; gid: number; x: number; y: number }>();
    const shapes: [string, (Place | Transition)[]][] = [
      ["Circle", this.net.places],
      ["Rectangle", this.net.transitions],
    ];
    o.push(1, `<nodeclasses count="2">`);
    for (const [cls, items] of shapes) {
      o.push(2, items.length ? `<nodeclass count="${items.length}" name="${cls}">` : `<nodeclass count="0" name="${cls}"/>`);
      if (!items.length) continue;
      for (const n of items) {
        const d = { dataId: this.id(), gid: this.id(), x: n.x / this.s, y: n.y / this.s };
        datas.set(n.id, d);
        o.push(3, `<node id="${d.dataId}" net="1">`);
        this.writeAttr(4, "Name", n.name, [{ show: true, parent: d.gid, x: d.x, y: d.y, yoff: 20 }]);
        this.writeAttr(4, "Comment", n.comment ?? "", [{ show: true, parent: d.gid, x: d.x, y: d.y, yoff: 40 }]);
        o.push(4, `<graphics count="1">`);
        o.push(5, `<graphic x="${fmt(d.x)}" y="${fmt(d.y)}" id="${d.gid}" net="1" show="1" w="20.00" h="20.00" state="1" pen="0,0,0" brush="${hexToRgb(n.color) ?? "255,255,255"}"/>`);
        o.push(4, `</graphics>`);
        o.push(3, `</node>`);
      }
      o.push(2, `</nodeclass>`);
    }
    o.push(1, `</nodeclasses>`);
    o.push(1, `<edgeclasses count="1">`);
    const arcs = this.net.arcs;
    o.push(2, arcs.length ? `<edgeclass count="${arcs.length}" name="Edge">` : `<edgeclass count="0" name="Edge"/>`);
    if (arcs.length) {
      for (const a of arcs) {
        const s = datas.get(a.source)!;
        const t = datas.get(a.target)!;
        o.push(3, `<edge source="${s.dataId}" target="${t.dataId}" id="${this.id()}" net="1">`);
        this.writeAttr(4, "Name", a.inscription === "1" ? "" : a.inscription, []);
        this.writeAttr(4, "Comment", "", []);
        o.push(4, `<graphics count="1">`);
        o.push(5, `<graphic id="${this.id()}" net="1" source="${s.gid}" target="${t.gid}" state="1" show="1" pen="0,0,0" brush="0,0,0" edge_designtype="3">`);
        o.push(6, `<points count="2">`);
        o.push(7, `<point x="${fmt(s.x)}" y="${fmt(s.y)}"/>`);
        o.push(7, `<point x="${fmt(t.x)}" y="${fmt(t.y)}"/>`);
        o.push(6, `</points>`);
        o.push(5, `</graphic>`);
        o.push(4, `</graphics>`);
        o.push(3, `</edge>`);
      }
      o.push(2, `</edgeclass>`);
    }
    o.push(1, `</edgeclasses>`);
  }

  // -------------------------------------------------------------------------------------------
  // Metadata

  private writeMetadata() {
    const net = this.net;
    const o = this.out;
    const classes: [string, () => void][] = [];
    const single = (cls: string, body: () => void) =>
      classes.push([
        cls,
        () => {
          o.push(2, `<metadataclass count="1" name="${xattr(cls)}">`);
          o.push(3, `<metadata id="${this.id()}" net="1">`);
          body();
          o.push(4, `<graphics count="0"/>`);
          o.push(3, `</metadata>`);
          o.push(2, `</metadataclass>`);
        },
      ]);
    const many = (cls: string, items: (() => void)[]) =>
      classes.push([
        cls,
        () => {
          if (!items.length) return o.push(2, `<metadataclass count="0" name="${xattr(cls)}"/>`);
          o.push(2, `<metadataclass count="${items.length}" name="${xattr(cls)}">`);
          for (const f of items) f();
          o.push(2, `</metadataclass>`);
        },
      ]);

    single("General", () => {
      this.writeAttr(4, "Name", net.name, []);
      this.writeAttr(4, "Description", withAmbientMarker(net), []);
    });
    many(
      "Comment",
      (net.notes ?? []).map((n) => () => {
        const gid = this.id();
        const x = n.x / this.s;
        const y = n.y / this.s;
        const netNo = this.netOf(n);
        if (isFaultTree(net.netClass) && netNo !== 1) this.warn("Notes inside fault tree subtrees were moved to the top level.");
        o.push(3, `<metadata id="${this.id()}" net="${netNo}">`);
        this.writeAttr(4, "Comment", n.text, [{ show: true, parent: gid, x, y, net: netNo }]);
        o.push(4, `<graphics count="1">`);
        const pen = hexToRgb(n.color) ?? "0,0,0";
        const w = Math.max(20, Math.min(400, n.text.split("\n").reduce((m, l) => Math.max(m, l.length), 0) * 7));
        o.push(5, `<graphic x="${fmt(x)}" y="${fmt(y)}" id="${gid}" net="${netNo}" show="1" w="${fmt(w)}" h="20.00" state="1" pen="${pen}" brush="255,255,255"/>`);
        o.push(4, `</graphics>`);
        o.push(3, `</metadata>`);
      }),
    );

    const consts = net.declarations.constants;
    const constantItem = (c: ConstantDecl, i: number) => () => {
      o.push(3, `<metadata id="${this.id()}" net="1">`);
      this.writeAttr(4, "Name", c.name, []);
      this.writeAttr(4, "ID", String(i), []);
      this.writeAttr(4, "Group", c.group ?? "all", []);
      const { type, row } = constantType(c.value);
      this.writeAttr(4, "Type", type, []);
      // Real files use two columns; fuzzy nets add ConstA..ConstD (UNVERIFIED).
      const cols = isFuzzy(net.netClass) ? ["Value set", "Value", "ConstA", "ConstB", "ConstC", "ConstD"] : ["Value set", "Value"];
      this.writeColList(4, "ValueList", cols, [row.slice(0, cols.length)], []);
      this.writeAttr(4, "Comment", "", []);
      o.push(4, `<graphics count="0"/>`);
      o.push(3, `</metadata>`);
    };
    const fns = net.declarations.functions ?? [];
    // UNVERIFIED: the Parameter attribute is written as a comma-separated list of names.
    const functionItem = (f: FunctionDecl, i: number) => () => {
      o.push(3, `<metadata id="${this.id()}" net="1">`);
      this.writeAttr(4, "Name", f.name, []);
      this.writeAttr(4, "ID", String(i), []);
      this.writeAttr(4, "Parameter", f.params.join(","), []);
      this.writeAttr(4, "Body", toSnoopyExpression(f.body), []);
      this.writeAttr(4, "Return", "double", []);
      this.writeAttr(4, "Comment", "", []);
      o.push(4, `<graphics count="0"/>`);
      o.push(3, `</metadata>`);
    };
    const obs = net.declarations.observers ?? [];
    const observerItem = (ob: ObserverDecl) => () => {
      o.push(3, `<metadata id="${this.id()}" net="1">`);
      this.writeAttr(4, "Name", ob.name, []);
      this.writeAttr(4, "Type", ob.kind === "transition" ? "Transition" : "Place", []);
      this.writeAttr(4, "Body", toSnoopyExpression(ob.expression), []);
      this.writeAttr(4, "Comment", "", []);
      this.writeAttr(4, "ColPNType", ob.kind === "transition" ? "Col|Transition" : "Col|Place", []);
      o.push(4, `<graphics count="0"/>`);
      o.push(3, `</metadata>`);
    };
    if (this.layout.coloured) {
      const d = net.declarations;
      const structuredTypes = ["product", "union", "subset"];
      const basic = d.colourSets.filter((c) => !structuredTypes.includes(c.type) && c.type !== "alias");
      const structured = d.colourSets.filter((c) => structuredTypes.includes(c.type));
      const aliases = d.colourSets.filter((c) => c.type === "alias");
      single("Basic Colorset Class", () =>
        this.writeColList(4, "ColorsetList", ["Name", "Type", "Colors", "Place color", "Show"], basic.map(basicRow), []),
      );
      single("Structured Colorset Class", () =>
        this.writeColList(
          4,
          "StructuredColorsetList",
          ["Name", "Type", "Component color sets", "Colors", "Place color", "Show"],
          structured.map((c) =>
            // UNVERIFIED for subsets: the parent set as the type, the predicate as the components.
            c.type === "subset"
              ? [c.name, c.components?.[0] ?? "", toSnoopyExpression(c.predicate?.trim() || "true"), "", "", "0"]
              : [c.name, c.type, (c.components ?? []).join(","), "", "", "0"],
          ),
          [],
        ),
      );
      single("Alias Colorset Class", () =>
        this.writeColList(4, "AliasColorsetList", ["Alias name", "Original color set", "Comment"], aliases.map((c) => [c.name, c.components?.[0] ?? "", ""]), []),
      );
      single("Constant Class", () => this.writeColList(4, "ConstantList", ["Name", "Type", "Value", "Comment", "Group"], [], []));
      many("Constant Class1", consts.map(constantItem));
      single("Variable Class", () =>
        this.writeColList(4, "VariableList", ["Name", "Color Set", "Comment"], d.variables.map((v) => [v.name, v.colourSet, ""]), []),
      );
      single("Function Class", () =>
        this.writeColList(
          4,
          "FunctionList",
          ["Return type", "Function name", "Parameter list", "Function body", "Comment", "Show"],
          fns.map((f) => {
            const sig = functionSignature(net, f);
            return [sig.returnType, f.name, sig.params.map((p) => `${p.type} ${p.name}`).join(","), toSnoopyExpression(f.body), "", "0"];
          }),
          [],
        ),
      );
      if (this.layout.base) single("Auxiliary Variables Class", () => {});
    } else {
      many("Constant Class", consts.map(constantItem));
      many("Function Class", fns.map(functionItem));
      if (net.declarations.colourSets.length || net.declarations.variables.length)
        this.warn("Colour sets and variables only exist in coloured nets and were dropped.");
    }
    if (this.layout.base) many("Oberserver Class", obs.map(observerItem));
    else if (obs.length) this.warn("Observers only exist in stochastic, continuous and hybrid nets and were dropped.");
    if (this.layout.base) {
      single("Simulation Properties", () => {});
      single("Simulation Results", () => {});
    }
    if (isFuzzy(net.netClass)) single("FuzzySettings", () => {});

    o.push(1, `<metadataclasses count="${classes.length}">`);
    for (const [, write] of classes) write();
    o.push(1, `</metadataclasses>`);
  }
}

function basicRow(c: ColourSetDecl): string[] {
  switch (c.type) {
    case "dot":
      return [c.name, "dot", "dot", "", "0"];
    case "enum":
      return [c.name, "enum", (c.values ?? []).join(","), "", "0"];
    case "int":
      return [c.name, "int", `${c.min ?? 0}-${c.max ?? c.min ?? 0}`, "", "0"];
    case "bool":
      // UNVERIFIED: the colours cell of a bool set.
      return [c.name, "bool", "false,true", "", "0"];
    case "string":
      return [c.name, "string", (c.values ?? []).join(","), "", "0"];
    default:
      return [c.name, c.type, "", "", "0"];
  }
}

/** Snoopy constant type and ValueList row for an expression. */
function constantType(value: string): { type: string; row: string[] } {
  const v = value.trim();
  const fuzzy = /^(TFN|TZN)\s*\((.*)\)$/i.exec(v);
  if (fuzzy) {
    // UNVERIFIED: fuzzy numbers go into the ConstA..ConstD columns.
    const parts = fuzzy[2].split(",").map((x) => x.trim());
    return { type: fuzzy[1].toUpperCase(), row: ["Main", parts[1] ?? parts[0] ?? "0", ...parts] };
  }
  if (/^[+-]?\d+$/.test(v)) return { type: "int", row: ["Main", v] };
  if (/^(true|false)$/.test(v)) return { type: "bool", row: ["Main", v] };
  return { type: "double", row: ["Main", v] };
}
