// Net model shared by the editor, simulator, file formats and (later) analysis.

export type NetClass =
  | "pt"
  | "xpt"
  | "coloured"
  | "timed"
  | "stochastic"
  | "continuous"
  | "hybrid"
  | "colouredStochastic"
  | "colouredContinuous"
  | "colouredHybrid"
  | "fuzzyStochastic"
  | "fuzzyContinuous"
  | "fuzzyHybrid"
  | "colouredFuzzyStochastic"
  | "colouredFuzzyContinuous"
  | "colouredFuzzyHybrid"
  | "modulo"
  | "music"
  | "freestyle"
  | "faultTree"
  | "extendedFaultTree"
  | "apn"
  | "tapn";

/** Net classes whose transitions carry rates or delays and are simulated over time. */
export const QUANTITATIVE_CLASSES: NetClass[] = [
  "stochastic",
  "continuous",
  "hybrid",
  "colouredStochastic",
  "colouredContinuous",
  "colouredHybrid",
  "fuzzyStochastic",
  "fuzzyContinuous",
  "fuzzyHybrid",
  "colouredFuzzyStochastic",
  "colouredFuzzyContinuous",
  "colouredFuzzyHybrid",
];

/** Net classes with colour sets, variables and multiset inscriptions. */
export const COLOURED_CLASSES: NetClass[] = [
  "coloured",
  "colouredStochastic",
  "colouredContinuous",
  "colouredHybrid",
  "colouredFuzzyStochastic",
  "colouredFuzzyContinuous",
  "colouredFuzzyHybrid",
  "apn",
  "tapn",
];

/** Konios's Ambient Petri Nets (APN) and Transformed Ambient Petri Nets (T-APN): coloured nets with step semantics. */
export const AMBIENT_CLASSES: NetClass[] = ["apn", "tapn"];

export function isAmbient(c: NetClass): boolean {
  return AMBIENT_CLASSES.includes(c);
}

export const FAULT_TREE_CLASSES: NetClass[] = ["faultTree", "extendedFaultTree"];

export function isColoured(c: NetClass): boolean {
  return COLOURED_CLASSES.includes(c);
}

export function isFaultTree(c: NetClass): boolean {
  return FAULT_TREE_CLASSES.includes(c);
}

/** The time behaviour of a quantitative class, ignoring colour and fuzziness. */
export function timeBase(c: NetClass): "stochastic" | "continuous" | "hybrid" | null {
  if (/Stochastic$|^stochastic$/.test(c)) return "stochastic";
  if (/Continuous$|^continuous$/.test(c)) return "continuous";
  if (/Hybrid$|^hybrid$/.test(c)) return "hybrid";
  return null;
}

export function isFuzzy(c: NetClass): boolean {
  return /fuzzy/i.test(c);
}

/**
 * Transition kinds for timed, stochastic and hybrid nets (Snoopy's names):
 * stochastic = exponential delay with a rate function, immediate = fires at once with a weight,
 * deterministic = fixed delay, scheduled = fires at given times, continuous = ODE flux (continuous/hybrid nets).
 */
export type TransitionKind = "stochastic" | "immediate" | "deterministic" | "scheduled" | "continuous";

/**
 * modifier = Snoopy's modifier arc (stochastic, continuous and hybrid classes): the place's marking
 * may appear in the transition's rate but the arc neither tests nor changes the marking.
 */
export type ArcKind = "normal" | "read" | "inhibitor" | "reset" | "equal" | "modifier";

export const ARC_KINDS: ArcKind[] = ["normal", "read", "inhibitor", "reset", "equal", "modifier"];

/** Arc kinds other than "normal" may only go from a place to a transition. */
export const TEST_ARC_KINDS: ArcKind[] = ["read", "inhibitor", "reset", "equal", "modifier"];

/** Arc kinds the class allows. */
export function arcKindsFor(c: NetClass): ArcKind[] {
  if (c === "pt" || c === "tapn" || isFaultTree(c)) return ["normal"];
  // APNs (Konios Def. 3): directed arcs and colour-sensitive inhibitor arcs only.
  if (c === "apn") return ["normal", "inhibitor"];
  if (c === "freestyle") return ARC_KINDS;
  return timeBase(c) ? ARC_KINDS : ARC_KINDS.filter((k) => k !== "modifier");
}

export interface Point {
  x: number;
  y: number;
}

export interface Place {
  id: string;
  name: string;
  x: number;
  y: number;
  /** P/T nets: a non-negative integer as text. Coloured nets: a multiset expression, e.g. "2`a ++ b". */
  marking: string;
  /** Maximum number of tokens (P/T) or tokens per colour (coloured). Empty = unbounded. */
  capacity?: number;
  /** Coloured nets only: the place's colour set name. */
  colourSet?: string;
  /** Logical (fusion) place: every place with the same name and this flag shares one marking. */
  logical?: boolean;
  /** Hybrid nets: a continuous place holds a real number instead of tokens. Continuous nets: always. */
  continuous?: boolean;
  /** Snoopy's fixed place (continuous and hybrid classes): its marking is held constant during simulation. */
  fixed?: boolean;
  /**
   * Ambient nets (APN, T-APN): a gluing (interface) place, the set G of Konios Def. 3 and Def. 20.
   * Composition glues nets on these places; in composite step nets they are the step places.
   */
  gluing?: boolean;
  /** Id of the coarse place or transition whose subnet contains this node; undefined = top level. */
  parent?: string;
  /** Coarse (macro) node: has a subnet and takes no part in firing. */
  coarse?: boolean;
  /** Fill colour, e.g. "#fde68a". */
  color?: string;
  /** Offset of the name label from its default position. */
  labelOffset?: Point;
  comment?: string;
}

export interface Transition {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Coloured nets only: a boolean expression over the transition's variables. */
  guard?: string;
  /** Draw the bar vertically (default) or horizontally. */
  horizontal?: boolean;
  /** Timed/stochastic/hybrid nets. Default: "stochastic" in stochastic and hybrid nets, "continuous" in continuous nets. */
  kind?: TransitionKind;
  /**
   * Stochastic and continuous transitions: rate function, e.g. "MassAction(0.5)" or "k * P1".
   * Immediate transitions: weight. Deterministic: delay. Scheduled: "start, repetition, end".
   */
  rate?: string;
  /** Timed nets: firing interval [earliest, latest] as expressions; latest may be "inf". */
  interval?: [string, string];
  /** Music nets: the note played when the transition fires. */
  sound?: { note: string; duration?: number; instrument?: "sine" | "square" | "sawtooth" | "triangle" | "piano" | "drum" };
  parent?: string;
  coarse?: boolean;
  color?: string;
  labelOffset?: Point;
  comment?: string;
}

export interface Arc {
  id: string;
  source: string;
  target: string;
  kind: ArcKind;
  /**
   * P/T and extended nets: an integer, or an arithmetic expression over place names
   * (marking-dependent arc). Coloured nets: a multiset expression, e.g. "x ++ 2`y".
   */
  inscription: string;
  /** Intermediate bend points. */
  points?: Point[];
  color?: string;
}

export interface ColourSetDecl {
  name: string;
  /**
   * dot, enum (values), int (min..max), bool (false, true), string (values), product and union
   * (components), alias (components[0]), subset (components[0] restricted by predicate over "x").
   */
  type: "dot" | "enum" | "int" | "bool" | "string" | "product" | "union" | "alias" | "subset";
  /** enum and string: the values */
  values?: string[];
  /** int: inclusive range */
  min?: number;
  max?: number;
  /** product, union: component colour set names; alias and subset: the base set */
  components?: string[];
  /** subset: boolean expression over the variable x, e.g. "x > 2" */
  predicate?: string;
  /**
   * T-APNs (Konios Def. 20): this colour set is the complementary ("special") set of the named
   * identity colour set. The bijection f maps the i-th value of that set to the i-th value of this
   * one, so both must have the same number of values.
   */
  complementOf?: string;
}

/** A user function usable in rates, weights, guards and arc inscriptions, e.g. hill(S, K, n) = S^n / (K^n + S^n). */
export interface FunctionDecl {
  name: string;
  params: string[];
  body: string;
}

/** Snoopy observer: an expression over markings (place observer) or transition rates (transition observer), plotted alongside the net. */
export interface ObserverDecl {
  name: string;
  kind: "place" | "transition";
  expression: string;
}

export interface VariableDecl {
  name: string;
  colourSet: string;
}

export interface ConstantDecl {
  name: string;
  /** An expression. Fuzzy nets also accept fuzzy numbers: TFN(low, peak, high) or TZN(a, b, c, d). */
  value: string;
  /** Snoopy's constant groups, e.g. "parameter" or "marking". Informational. */
  group?: string;
}

export interface Declarations {
  colourSets: ColourSetDecl[];
  variables: VariableDecl[];
  constants: ConstantDecl[];
  functions?: FunctionDecl[];
  observers?: ObserverDecl[];
}

/** Fault tree node types. Extended fault trees add repair and the dynamic gates. */
export type FTNodeType =
  | "top"
  | "intermediate"
  | "basic"
  | "undeveloped"
  | "and"
  | "or"
  | "xor"
  | "not"
  | "kofn"
  | "pand"
  | "inhibit"
  | "cond"
  | "spare"
  | "fdep";

export interface FTNode {
  id: string;
  name: string;
  x: number;
  y: number;
  type: FTNodeType;
  /** k-of-n gates: number of inputs that must fail. */
  k?: number;
  /** Basic events: failure rate (per hour) or fixed probability, as expressions. */
  failureRate?: string;
  probability?: string;
  /** Extended fault trees: repair rate. */
  repairRate?: string;
  color?: string;
  parent?: string;
  comment?: string;
}

/** An edge from a child event or gate up to the gate it feeds. */
export interface FTEdge {
  id: string;
  /** The input (lower) node. */
  source: string;
  /** The gate or event it feeds (upper node). */
  target: string;
  points?: Point[];
}

export interface FaultTree {
  nodes: FTNode[];
  edges: FTEdge[];
}

/** A free text label drawn on the canvas (Snoopy's comment nodes). */
export interface Note {
  id: string;
  x: number;
  y: number;
  text: string;
  parent?: string;
  color?: string;
}

export interface Net {
  /** File format version, bumped on breaking changes. */
  format: "pns/1";
  name: string;
  netClass: NetClass;
  places: Place[];
  transitions: Transition[];
  arcs: Arc[];
  declarations: Declarations;
  /** Modulo nets: token arithmetic is modulo this number (at least 2). */
  modulus?: number;
  /** Fault tree classes only. */
  faultTree?: FaultTree;
  notes?: Note[];
  comment?: string;
}

export function emptyNet(netClass: NetClass = "pt", name = "Untitled"): Net {
  return {
    format: "pns/1",
    name,
    netClass,
    places: [],
    transitions: [],
    arcs: [],
    modulus: netClass === "modulo" ? 2 : undefined,
    faultTree: isFaultTree(netClass) ? { nodes: [], edges: [] } : undefined,
    declarations: {
      colourSets: isColoured(netClass) ? [{ name: "Dot", type: "dot" }] : [],
      variables: [],
      constants: [],
    },
  };
}

export const NET_CLASS_LABELS: Record<NetClass, string> = {
  pt: "Place/transition net",
  xpt: "Extended net",
  coloured: "Coloured net",
  timed: "Timed net",
  stochastic: "Stochastic net",
  continuous: "Continuous net",
  hybrid: "Hybrid net",
  colouredStochastic: "Coloured stochastic net",
  colouredContinuous: "Coloured continuous net",
  colouredHybrid: "Coloured hybrid net",
  fuzzyStochastic: "Fuzzy stochastic net",
  fuzzyContinuous: "Fuzzy continuous net",
  fuzzyHybrid: "Fuzzy hybrid net",
  colouredFuzzyStochastic: "Coloured fuzzy stochastic net",
  colouredFuzzyContinuous: "Coloured fuzzy continuous net",
  colouredFuzzyHybrid: "Coloured fuzzy hybrid net",
  modulo: "Modulo net",
  music: "Music net",
  freestyle: "Freestyle net",
  faultTree: "Fault tree",
  extendedFaultTree: "Extended fault tree",
  apn: "Ambient Petri net (APN)",
  tapn: "Transformed ambient Petri net (T-APN)",
};

/** Net classes that allow read, inhibitor, reset and equal arcs. */
export function allowsExtendedArcs(c: NetClass): boolean {
  return c !== "pt";
}

export function defaultTransitionKind(c: NetClass): TransitionKind | undefined {
  const b = timeBase(c);
  if (b === "stochastic" || b === "hybrid") return "stochastic";
  if (b === "continuous") return "continuous";
  return undefined;
}

export function isContinuousPlace(net: Net, p: Place): boolean {
  const b = timeBase(net.netClass);
  return b === "continuous" || (b === "hybrid" && !!p.continuous);
}

let counter = 0;
export function newId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function nodeById(net: Net, id: string): Place | Transition | undefined {
  return net.places.find((p) => p.id === id) ?? net.transitions.find((t) => t.id === id);
}

export function isPlace(net: Net, id: string): boolean {
  return net.places.some((p) => p.id === id);
}

/** Next free default name such as P3 or T7. */
export function nextName(existing: string[], prefix: string): string {
  const used = new Set(existing);
  let i = existing.length;
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

export function inArcs(net: Net, transitionId: string): Arc[] {
  return net.arcs.filter((a) => a.target === transitionId);
}

export function outArcs(net: Net, transitionId: string): Arc[] {
  return net.arcs.filter((a) => a.source === transitionId);
}
