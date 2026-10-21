// Native `.pns.json` file format: the Net object itself, pretty-printed.
//
// The format tag stays "pns/1": every field added since the first release is optional, so files
// written by older versions still load unchanged.

import {
  ARC_KINDS,
  Arc,
  ArcKind,
  ColourSetDecl,
  ConstantDecl,
  Declarations,
  FTEdge,
  FTNode,
  FTNodeType,
  FaultTree,
  FunctionDecl,
  NET_CLASS_LABELS,
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
  isFaultTree,
} from "@pns/core";

export const NATIVE_FORMAT = "pns/1";
export const NATIVE_EXTENSION = ".pns.json";

/** Every net class this version understands. */
export const NET_CLASSES = Object.keys(NET_CLASS_LABELS) as NetClass[];
export const TRANSITION_KINDS: TransitionKind[] = ["stochastic", "immediate", "deterministic", "scheduled", "continuous"];
export const FT_NODE_TYPES: FTNodeType[] = [
  "top",
  "intermediate",
  "basic",
  "undeveloped",
  "and",
  "or",
  "xor",
  "not",
  "kofn",
  "pand",
  "inhibit",
  "cond",
  "spare",
  "fdep",
];
export const SOUND_INSTRUMENTS = ["sine", "square", "sawtooth", "triangle", "piano", "drum"] as const;
const COLOUR_SET_TYPES: ColourSetDecl["type"][] = ["dot", "enum", "int", "bool", "string", "product", "union", "alias", "subset"];

/** Pretty JSON (2-space indent) of the native format. */
export function serializeNet(net: Net): string {
  return JSON.stringify({ ...net, format: NATIVE_FORMAT }, null, 2) + "\n";
}

/**
 * Parses and validates a native `.pns.json` document. Optional fields get their defaults,
 * unknown properties are dropped. Throws an Error with a human-readable message on bad input.
 */
export function parseNet(text: string): Net {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`This file is not valid JSON: ${(e as Error).message}`);
  }
  return validateNet(raw);
}

/** Validates an already-parsed JSON value as a Net (see parseNet). */
export function validateNet(raw: unknown): Net {
  const r = new Reader();
  const o = r.object(raw, "The file");
  if (o.format === undefined) throw new Error('This is not a Donwinne file (the "format" field is missing).');
  if (o.format !== NATIVE_FORMAT)
    throw new Error(
      `Unsupported file format ${JSON.stringify(o.format)}; this version of Donwinne reads "${NATIVE_FORMAT}".`,
    );

  const netClass = (o.netClass ?? "pt") as NetClass;
  if (!NET_CLASSES.includes(netClass))
    throw new Error(`Unknown net class ${JSON.stringify(o.netClass)}; expected one of ${NET_CLASSES.join(", ")}.`);

  const net: Net = {
    format: NATIVE_FORMAT,
    name: r.str(o.name, "The net name", "Untitled"),
    netClass,
    places: r.array(o.places, 'The "places" field').map((p, i) => readPlace(r, p, `Place #${i + 1}`)),
    transitions: r.array(o.transitions, 'The "transitions" field').map((t, i) => readTransition(r, t, `Transition #${i + 1}`)),
    arcs: [],
    declarations: readDeclarations(r, o.declarations, netClass),
  };
  if (o.modulus !== undefined && o.modulus !== null) {
    const m = r.num(o.modulus, "The modulus");
    if (!Number.isInteger(m) || m < 2) throw new Error("The modulus must be a whole number of at least 2.");
    net.modulus = m;
  } else if (netClass === "modulo") net.modulus = 2;
  if (o.faultTree !== undefined && o.faultTree !== null) net.faultTree = readFaultTree(r, o.faultTree);
  else if (isFaultTree(netClass)) net.faultTree = { nodes: [], edges: [] };
  if (o.notes !== undefined && o.notes !== null)
    net.notes = r.array(o.notes, 'The "notes" field').map((n, i) => readNote(r, n, `Note #${i + 1}`));
  if (o.comment !== undefined) net.comment = r.str(o.comment, "The net comment");
  net.arcs = r.array(o.arcs, 'The "arcs" field').map((a, i) => readArc(r, a, `Arc #${i + 1}`));
  checkStructure(net);
  return net;
}

/**
 * Checks id uniqueness, arc endpoints, fault tree edges and the subnet hierarchy (every parent is
 * an existing coarse node, no cycles). Shared with the PNML and Snoopy importers.
 */
export function checkStructure(net: Net): void {
  const seen = new Map<string, string>();
  const claim = (id: string, what: string) => {
    const prev = seen.get(id);
    if (prev) throw new Error(`The id "${id}" is used by both ${prev} and ${what}; ids must be unique.`);
    seen.set(id, what);
  };
  for (const p of net.places) claim(p.id, `place ${p.name || p.id}`);
  for (const t of net.transitions) claim(t.id, `transition ${t.name || t.id}`);
  for (const a of net.arcs) claim(a.id, `an arc`);
  for (const n of net.notes ?? []) claim(n.id, `a note`);
  for (const n of net.faultTree?.nodes ?? []) claim(n.id, `fault tree node ${n.name || n.id}`);
  for (const e of net.faultTree?.edges ?? []) claim(e.id, `a fault tree edge`);

  const placeIds = new Set(net.places.map((p) => p.id));
  const transIds = new Set(net.transitions.map((t) => t.id));
  for (const a of net.arcs) {
    for (const end of [a.source, a.target])
      if (!placeIds.has(end) && !transIds.has(end))
        throw new Error(`Arc "${a.id}" refers to "${end}", which is not a place or transition in this net.`);
    const ok = (placeIds.has(a.source) && transIds.has(a.target)) || (transIds.has(a.source) && placeIds.has(a.target));
    // Freestyle nets are drawings, so any two nodes may be connected.
    if (!ok && net.netClass !== "freestyle") throw new Error(`Arc "${a.id}" must connect a place and a transition.`);
  }

  if (net.faultTree) {
    const ftIds = new Set(net.faultTree.nodes.map((n) => n.id));
    for (const e of net.faultTree.edges) {
      for (const end of [e.source, e.target])
        if (!ftIds.has(end))
          throw new Error(`Fault tree edge "${e.id}" refers to "${end}", which is not a node of the fault tree.`);
      if (e.source === e.target) throw new Error(`Fault tree edge "${e.id}" connects node "${e.source}" to itself.`);
    }
  }

  // Hierarchy: parents must be coarse places/transitions (or, inside a fault tree, other fault tree nodes).
  const coarse = new Set<string>();
  for (const n of [...net.places, ...net.transitions]) if (n.coarse) coarse.add(n.id);
  const ftIds = new Set((net.faultTree?.nodes ?? []).map((n) => n.id));
  const parentOf = new Map<string, string>();
  const checkParent = (id: string, parent: string | undefined, what: string, allowFt: boolean) => {
    if (parent === undefined) return;
    if (!coarse.has(parent) && !(allowFt && ftIds.has(parent)))
      throw new Error(
        `${what} lies in the subnet of "${parent}", which is not a coarse ${allowFt ? "node or fault tree node" : "place or transition"} of this net.`,
      );
    if (parent === id) throw new Error(`${what} cannot be inside its own subnet.`);
    parentOf.set(id, parent);
  };
  for (const p of net.places) checkParent(p.id, p.parent, `Place "${p.id}"`, false);
  for (const t of net.transitions) checkParent(t.id, t.parent, `Transition "${t.id}"`, false);
  for (const n of net.notes ?? []) checkParent(n.id, n.parent, `Note "${n.id}"`, false);
  for (const n of net.faultTree?.nodes ?? []) checkParent(n.id, n.parent, `Fault tree node "${n.id}"`, true);
  for (const start of parentOf.keys()) {
    const path = new Set<string>([start]);
    let cur = parentOf.get(start);
    while (cur !== undefined) {
      if (path.has(cur)) throw new Error(`The subnets of "${start}" and "${cur}" contain each other (a cycle in the hierarchy).`);
      path.add(cur);
      cur = parentOf.get(cur);
    }
  }
}

function readCommon(r: Reader, o: Record<string, unknown>, what: string, n: Place | Transition) {
  if (o.parent !== undefined && o.parent !== null) n.parent = r.id(o.parent, `The parent of ${what}`);
  if (o.coarse !== undefined) n.coarse = r.bool(o.coarse, `The coarse flag of ${what}`);
  if (o.color !== undefined) n.color = r.color(o.color, `The colour of ${what}`);
  if (o.labelOffset !== undefined) n.labelOffset = r.point(o.labelOffset, `The label offset of ${what}`);
  if (o.comment !== undefined) n.comment = r.str(o.comment, `The comment of ${what}`);
}

function readPlace(r: Reader, raw: unknown, what: string): Place {
  const o = r.object(raw, what);
  const id = r.id(o.id, what);
  what = `Place "${id}"`;
  const p: Place = {
    id,
    name: r.str(o.name, `The name of ${what}`, id),
    x: r.num(o.x, `The x position of ${what}`, 0),
    y: r.num(o.y, `The y position of ${what}`, 0),
    marking: r.text(o.marking, `The marking of ${what}`, ""),
  };
  if (o.capacity !== undefined && o.capacity !== null) {
    const c = r.num(o.capacity, `The capacity of ${what}`);
    if (!Number.isInteger(c) || c < 0) throw new Error(`The capacity of ${what} must be a whole number of zero or more.`);
    p.capacity = c;
  }
  if (o.colourSet !== undefined) p.colourSet = r.str(o.colourSet, `The colour set of ${what}`);
  if (o.logical !== undefined) p.logical = r.bool(o.logical, `The logical flag of ${what}`);
  if (o.continuous !== undefined) p.continuous = r.bool(o.continuous, `The continuous flag of ${what}`);
  if (o.fixed !== undefined) p.fixed = r.bool(o.fixed, `The fixed flag of ${what}`);
  if (o.gluing !== undefined) p.gluing = r.bool(o.gluing, `The gluing flag of ${what}`);
  readCommon(r, o, what, p);
  return p;
}

function readTransition(r: Reader, raw: unknown, what: string): Transition {
  const o = r.object(raw, what);
  const id = r.id(o.id, what);
  what = `Transition "${id}"`;
  const t: Transition = {
    id,
    name: r.str(o.name, `The name of ${what}`, id),
    x: r.num(o.x, `The x position of ${what}`, 0),
    y: r.num(o.y, `The y position of ${what}`, 0),
  };
  if (o.guard !== undefined) t.guard = r.str(o.guard, `The guard of ${what}`);
  if (o.horizontal !== undefined) t.horizontal = r.bool(o.horizontal, `The orientation of ${what}`);
  if (o.kind !== undefined && o.kind !== null) {
    if (!TRANSITION_KINDS.includes(o.kind as TransitionKind))
      throw new Error(`${what} has unknown kind ${JSON.stringify(o.kind)}; expected one of ${TRANSITION_KINDS.join(", ")}.`);
    t.kind = o.kind as TransitionKind;
  }
  if (o.rate !== undefined) t.rate = r.text(o.rate, `The rate of ${what}`);
  if (o.interval !== undefined && o.interval !== null) {
    const iv = r.array(o.interval, `The firing interval of ${what}`);
    if (iv.length !== 2) throw new Error(`The firing interval of ${what} must have exactly two bounds [earliest, latest].`);
    t.interval = [r.text(iv[0], `The earliest firing time of ${what}`), r.text(iv[1], `The latest firing time of ${what}`)];
  }
  if (o.sound !== undefined && o.sound !== null) {
    const so = r.object(o.sound, `The sound of ${what}`);
    const sound: NonNullable<Transition["sound"]> = { note: r.str(so.note, `The note of ${what}`) };
    if (so.duration !== undefined) {
      const d = r.num(so.duration, `The note duration of ${what}`);
      if (d <= 0) throw new Error(`The note duration of ${what} must be greater than zero.`);
      sound.duration = d;
    }
    if (so.instrument !== undefined) {
      if (!SOUND_INSTRUMENTS.includes(so.instrument as (typeof SOUND_INSTRUMENTS)[number]))
        throw new Error(
          `${what} uses unknown instrument ${JSON.stringify(so.instrument)}; expected one of ${SOUND_INSTRUMENTS.join(", ")}.`,
        );
      sound.instrument = so.instrument as (typeof SOUND_INSTRUMENTS)[number];
    }
    t.sound = sound;
  }
  readCommon(r, o, what, t);
  return t;
}

function readArc(r: Reader, raw: unknown, what: string): Arc {
  const o = r.object(raw, what);
  const id = r.id(o.id, what);
  what = `Arc "${id}"`;
  const kind = (o.kind ?? "normal") as ArcKind;
  if (!ARC_KINDS.includes(kind))
    throw new Error(`${what} has unknown kind ${JSON.stringify(o.kind)}; expected one of ${ARC_KINDS.join(", ")}.`);
  const a: Arc = {
    id,
    source: r.str(o.source, `The source of ${what}`),
    target: r.str(o.target, `The target of ${what}`),
    kind,
    inscription: r.text(o.inscription, `The inscription of ${what}`, kind === "reset" ? "" : "1"),
  };
  if (o.points !== undefined) a.points = r.points(o.points, `The bend points of ${what}`);
  if (o.color !== undefined) a.color = r.color(o.color, `The colour of ${what}`);
  return a;
}

function readNote(r: Reader, raw: unknown, what: string): Note {
  const o = r.object(raw, what);
  const id = r.id(o.id, what);
  what = `Note "${id}"`;
  const n: Note = {
    id,
    x: r.num(o.x, `The x position of ${what}`, 0),
    y: r.num(o.y, `The y position of ${what}`, 0),
    text: r.str(o.text, `The text of ${what}`, ""),
  };
  if (o.parent !== undefined && o.parent !== null) n.parent = r.id(o.parent, `The parent of ${what}`);
  if (o.color !== undefined) n.color = r.color(o.color, `The colour of ${what}`);
  return n;
}

function readFaultTree(r: Reader, raw: unknown): FaultTree {
  const o = r.object(raw, "The fault tree");
  const nodes = r.array(o.nodes, 'The fault tree "nodes" field').map((raw, i): FTNode => {
    let what = `Fault tree node #${i + 1}`;
    const no = r.object(raw, what);
    const id = r.id(no.id, what);
    what = `Fault tree node "${id}"`;
    const type = no.type as FTNodeType;
    if (!FT_NODE_TYPES.includes(type))
      throw new Error(`${what} has unknown type ${JSON.stringify(no.type)}; expected one of ${FT_NODE_TYPES.join(", ")}.`);
    const n: FTNode = {
      id,
      name: r.str(no.name, `The name of ${what}`, id),
      x: r.num(no.x, `The x position of ${what}`, 0),
      y: r.num(no.y, `The y position of ${what}`, 0),
      type,
    };
    if (no.k !== undefined && no.k !== null) {
      const k = r.int(no.k, `The k of ${what}`);
      if (k < 1) throw new Error(`The k of ${what} must be at least 1.`);
      n.k = k;
    }
    if (no.failureRate !== undefined) n.failureRate = r.text(no.failureRate, `The failure rate of ${what}`);
    if (no.probability !== undefined) n.probability = r.text(no.probability, `The probability of ${what}`);
    if (no.repairRate !== undefined) n.repairRate = r.text(no.repairRate, `The repair rate of ${what}`);
    if (no.color !== undefined) n.color = r.color(no.color, `The colour of ${what}`);
    if (no.parent !== undefined && no.parent !== null) n.parent = r.id(no.parent, `The parent of ${what}`);
    if (no.comment !== undefined) n.comment = r.str(no.comment, `The comment of ${what}`);
    return n;
  });
  const edges = r.array(o.edges, 'The fault tree "edges" field').map((raw, i): FTEdge => {
    let what = `Fault tree edge #${i + 1}`;
    const eo = r.object(raw, what);
    const id = r.id(eo.id, what);
    what = `Fault tree edge "${id}"`;
    const e: FTEdge = { id, source: r.str(eo.source, `The source of ${what}`), target: r.str(eo.target, `The target of ${what}`) };
    if (eo.points !== undefined) e.points = r.points(eo.points, `The bend points of ${what}`);
    return e;
  });
  return { nodes, edges };
}

function readDeclarations(r: Reader, raw: unknown, netClass: NetClass): Declarations {
  if (raw === undefined || raw === null)
    return { colourSets: isColoured(netClass) ? [{ name: "Dot", type: "dot" }] : [], variables: [], constants: [] };
  const o = r.object(raw, "The declarations");
  const colourSets = r.array(o.colourSets, 'The "colourSets" field').map((c, i): ColourSetDecl => {
    const what = `Colour set #${i + 1}`;
    const co = r.object(c, what);
    const name = r.str(co.name, `The name of ${what}`);
    const type = co.type as ColourSetDecl["type"];
    if (!COLOUR_SET_TYPES.includes(type))
      throw new Error(`Colour set "${name}" has unknown type ${JSON.stringify(co.type)}; expected one of ${COLOUR_SET_TYPES.join(", ")}.`);
    const cs: ColourSetDecl = { name, type };
    if (co.values !== undefined) cs.values = r.array(co.values, `The values of colour set "${name}"`).map((v) => r.str(v, `A value of colour set "${name}"`));
    if (co.min !== undefined) cs.min = r.int(co.min, `The minimum of colour set "${name}"`);
    if (co.max !== undefined) cs.max = r.int(co.max, `The maximum of colour set "${name}"`);
    if (co.components !== undefined)
      cs.components = r.array(co.components, `The components of colour set "${name}"`).map((v) => r.str(v, `A component of colour set "${name}"`));
    if (co.predicate !== undefined) cs.predicate = r.str(co.predicate, `The predicate of colour set "${name}"`);
    if (co.complementOf !== undefined) cs.complementOf = r.str(co.complementOf, `The complemented colour set of "${name}"`);
    return cs;
  });
  const variables = r.array(o.variables, 'The "variables" field').map((v, i): VariableDecl => {
    const vo = r.object(v, `Variable #${i + 1}`);
    return { name: r.str(vo.name, `The name of variable #${i + 1}`), colourSet: r.str(vo.colourSet, `The colour set of variable #${i + 1}`) };
  });
  const constants = r.array(o.constants, 'The "constants" field').map((c, i): ConstantDecl => {
    const co = r.object(c, `Constant #${i + 1}`);
    const k: ConstantDecl = { name: r.str(co.name, `The name of constant #${i + 1}`), value: r.text(co.value, `The value of constant #${i + 1}`) };
    if (co.group !== undefined) k.group = r.str(co.group, `The group of constant #${i + 1}`);
    return k;
  });
  const decls: Declarations = { colourSets, variables, constants };
  if (o.functions !== undefined && o.functions !== null)
    decls.functions = r.array(o.functions, 'The "functions" field').map((f, i): FunctionDecl => {
      const what = `Function #${i + 1}`;
      const fo = r.object(f, what);
      const name = r.str(fo.name, `The name of ${what}`);
      return {
        name,
        params: r.array(fo.params, `The parameters of function "${name}"`).map((p) => r.str(p, `A parameter of function "${name}"`)),
        body: r.text(fo.body, `The body of function "${name}"`),
      };
    });
  if (o.observers !== undefined && o.observers !== null)
    decls.observers = r.array(o.observers, 'The "observers" field').map((ob, i): ObserverDecl => {
      const what = `Observer #${i + 1}`;
      const oo = r.object(ob, what);
      const name = r.str(oo.name, `The name of ${what}`);
      if (oo.kind !== "place" && oo.kind !== "transition")
        throw new Error(`Observer "${name}" has unknown kind ${JSON.stringify(oo.kind)}; expected "place" or "transition".`);
      return { name, kind: oo.kind, expression: r.text(oo.expression, `The expression of observer "${name}"`) };
    });
  return decls;
}

const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([^)]*\)|hsla?\([^)]*\))$/;

class Reader {
  object(v: unknown, what: string): Record<string, unknown> {
    if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`${what} must be an object.`);
    return v as Record<string, unknown>;
  }
  array(v: unknown, what: string): unknown[] {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) throw new Error(`${what} must be a list.`);
    return v;
  }
  str(v: unknown, what: string, dflt?: string): string {
    if ((v === undefined || v === null) && dflt !== undefined) return dflt;
    if (typeof v !== "string") throw new Error(`${what} must be text${v === undefined ? " but is missing" : ""}.`);
    return v;
  }
  /** Text, but numbers are accepted and converted (e.g. a marking written as 3). */
  text(v: unknown, what: string, dflt?: string): string {
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    return this.str(v, what, dflt);
  }
  id(v: unknown, what: string): string {
    if (typeof v !== "string" || v.trim() === "") throw new Error(`${what} has no id.`);
    return v;
  }
  num(v: unknown, what: string, dflt?: number): number {
    if ((v === undefined || v === null) && dflt !== undefined) return dflt;
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${what} must be a number.`);
    return v;
  }
  int(v: unknown, what: string): number {
    const n = this.num(v, what);
    if (!Number.isInteger(n)) throw new Error(`${what} must be a whole number.`);
    return n;
  }
  bool(v: unknown, what: string): boolean {
    if (typeof v !== "boolean") throw new Error(`${what} must be true or false.`);
    return v;
  }
  color(v: unknown, what: string): string {
    const s = this.str(v, what);
    if (!COLOR_RE.test(s.trim())) throw new Error(`${what} must be a colour such as "#fde68a"; got ${JSON.stringify(s)}.`);
    return s;
  }
  point(v: unknown, what: string): Point {
    const o = this.object(v, what);
    return { x: this.num(o.x, `${what} (x)`), y: this.num(o.y, `${what} (y)`) };
  }
  points(v: unknown, what: string): Point[] {
    return this.array(v, what).map((pt, i) => this.point(pt, `Bend point #${i + 1} of ${what.replace(/^The bend points of /, "")}`));
  }
}
