// PNML (ISO/IEC 15909-2) export.
//
// P/T-based nets use the ptnet grammar, all coloured classes the symmetric-net grammar. Fill and
// line colours and name label offsets use the standard <fill>, <line> and <offset> graphics.
// Fault trees have no PNML grammar and are written to the net's toolspecific block only. Everything
// that has no standard PNML element (arc kinds, capacities, logical places, comments, our expression
// texts where the standard demands numbers, and the exact declarations) goes into
// <toolspecific tool="Donwinne" version="1"> blocks that importPnml reads back losslessly.

import { Arc, ColourSetDecl, FTEdge, FTNode, Net, Note, Place, Point, Transition, Value, colourSetDomain, isColoured, showValue } from "@pns/core";
import { XmlChild, XmlEl, el, renderXml, textEl } from "./xml";

export const PNML_NS = "http://www.pnml.org/version-2009/grammar/pnml";
export const PTNET_TYPE = "http://www.pnml.org/version-2009/grammar/ptnet";
export const SYMMETRIC_TYPE = "http://www.pnml.org/version-2009/grammar/symmetricnet";
export const TOOL_NAME = "Donwinne";
/** Tool names of earlier versions, still read back on import. */
export const OLD_TOOL_NAMES = ["PetriNetStudio"];
export const TOOL_VERSION = "1";

const NAT = /^\d+$/;
const POS = /^[1-9]\d*$/;

export function exportPnml(net: Net): string {
  const coloured = isColoured(net.netClass);
  const ids = new Set<string>([...net.places, ...net.transitions, ...net.arcs].map((x) => x.id));
  const fresh = (base: string) => {
    let id = base;
    for (let i = 1; ids.has(id); i++) id = `${base}${i}`;
    ids.add(id);
    return id;
  };
  const sortIds = new Map<string, string>();
  for (const cs of net.declarations.colourSets) if (!sortIds.has(cs.name)) sortIds.set(cs.name, fresh(`cs_${ncName(cs.name)}`));

  const netId = fresh("net");
  const pageId = fresh("page");

  const netTool = tool([
    textEl("netClass", net.netClass),
    net.comment !== undefined && textEl("comment", net.comment),
    net.modulus !== undefined && textEl("modulus", String(net.modulus)),
    declarationsTool(net),
    net.notes && el("notes", {}, net.notes.map(noteEl)),
    net.faultTree &&
      el("faultTree", {}, [
        el("nodes", {}, net.faultTree.nodes.map(ftNodeEl)),
        el("edges", {}, net.faultTree.edges.map(ftEdgeEl)),
      ]),
  ]);

  const page = el("page", { id: pageId }, [
    ...net.places.map((p) => placeEl(p, coloured, sortIds)),
    ...net.transitions.map((t) => transitionEl(t, coloured)),
    ...net.arcs.map((a) => arcEl(a, coloured)),
  ]);

  const root = el("pnml", { xmlns: PNML_NS }, [
    el("net", { id: netId, type: coloured ? SYMMETRIC_TYPE : PTNET_TYPE }, [
      nameEl(net.name),
      netTool,
      coloured && standardDeclarations(net, sortIds, fresh),
      page,
    ]),
  ]);
  return renderXml(root);
}

function tool(children: XmlChild[]): XmlEl | null {
  const real = children.filter(Boolean);
  return real.length ? el("toolspecific", { tool: TOOL_NAME, version: TOOL_VERSION }, real) : null;
}

function nameEl(name: string, offset?: Point): XmlEl {
  return el("name", {}, [textEl("text", name), offset && el("graphics", {}, [el("offset", { x: offset.x, y: offset.y })])]);
}

function nodeGraphics(x: number, y: number, color: string | undefined): XmlEl {
  return el("graphics", {}, [position(x, y), color && el("fill", { color })]);
}

/** Toolspecific fields shared by places and transitions. */
function commonTool(n: Place | Transition): XmlChild[] {
  return [
    n.parent !== undefined && textEl("parent", n.parent),
    n.coarse !== undefined && textEl("coarse", String(n.coarse)),
    n.comment !== undefined && textEl("comment", n.comment),
  ];
}

function noteEl(n: Note): XmlEl {
  return textEl("note", n.text, { id: n.id, x: n.x, y: n.y, parent: n.parent, color: n.color });
}

function ftNodeEl(n: FTNode): XmlEl {
  return el(
    "node",
    { id: n.id, type: n.type, x: n.x, y: n.y, k: n.k, parent: n.parent, color: n.color },
    [
      textEl("name", n.name),
      n.failureRate !== undefined && textEl("failureRate", n.failureRate),
      n.probability !== undefined && textEl("probability", n.probability),
      n.repairRate !== undefined && textEl("repairRate", n.repairRate),
      n.comment !== undefined && textEl("comment", n.comment),
    ],
  );
}

function ftEdgeEl(e: FTEdge): XmlEl {
  return el("edge", { id: e.id, source: e.source, target: e.target }, (e.points ?? []).map((p) => position(p.x, p.y)));
}

function textAnnot(tag: string, value: string, extra: XmlChild[] = []): XmlEl {
  return el(tag, {}, [textEl("text", value), ...extra]);
}

function position(x: number, y: number): XmlEl {
  return el("position", { x, y }, []);
}

function placeEl(p: Place, coloured: boolean, sortIds: Map<string, string>): XmlEl {
  const children: XmlChild[] = [nameEl(p.name, p.labelOffset), nodeGraphics(p.x, p.y, p.color)];
  const extra: XmlChild[] = [];
  if (coloured) {
    if (p.colourSet !== undefined) {
      const sid = sortIds.get(p.colourSet);
      children.push(
        el("type", {}, [textEl("text", p.colourSet), sid && el("structure", {}, [el("usersort", { declaration: sid })])]),
      );
    } else {
      // No colour set means the default black-token set. The missing <text> tells our importer
      // to leave colourSet unset again.
      children.push(el("type", {}, [el("structure", {}, [el("dot")])]));
    }
    if (p.marking !== "") children.push(textAnnot("hlinitialMarking", p.marking));
  } else {
    if (NAT.test(p.marking)) children.push(textAnnot("initialMarking", p.marking));
    else if (p.marking !== "") extra.push(textEl("marking", p.marking));
    if (p.colourSet !== undefined) extra.push(textEl("colourSet", p.colourSet));
  }
  if (p.capacity !== undefined) extra.push(textEl("capacity", String(p.capacity)));
  if (p.logical !== undefined) extra.push(textEl("logical", String(p.logical)));
  if (p.continuous !== undefined) extra.push(textEl("continuous", String(p.continuous)));
  if (p.fixed !== undefined) extra.push(textEl("fixed", String(p.fixed)));
  if (p.gluing !== undefined) extra.push(textEl("gluing", String(p.gluing)));
  extra.push(...commonTool(p));
  children.push(tool(extra));
  return el("place", { id: p.id }, children);
}

function transitionEl(t: Transition, coloured: boolean): XmlEl {
  const children: XmlChild[] = [nameEl(t.name, t.labelOffset), nodeGraphics(t.x, t.y, t.color)];
  const extra: XmlChild[] = [];
  if (t.guard !== undefined) {
    if (coloured) children.push(textAnnot("condition", t.guard));
    else extra.push(textEl("guard", t.guard));
  }
  if (t.horizontal !== undefined) extra.push(textEl("horizontal", String(t.horizontal)));
  if (t.kind !== undefined) extra.push(textEl("kind", t.kind));
  if (t.rate !== undefined) extra.push(textEl("rate", t.rate));
  if (t.interval) extra.push(el("interval", {}, [textEl("earliest", t.interval[0]), textEl("latest", t.interval[1])]));
  if (t.sound) extra.push(textEl("sound", t.sound.note, { duration: t.sound.duration, instrument: t.sound.instrument }));
  extra.push(...commonTool(t));
  children.push(tool(extra));
  return el("transition", { id: t.id }, children);
}

function arcEl(a: Arc, coloured: boolean): XmlEl {
  const children: XmlChild[] = [];
  const extra: XmlChild[] = [];
  if (a.points?.length || a.color)
    children.push(el("graphics", {}, [...(a.points ?? []).map((pt) => position(pt.x, pt.y)), a.color && el("line", { color: a.color })]));
  if (coloured) children.push(textAnnot("hlinscription", a.inscription));
  else if (POS.test(a.inscription)) children.push(textAnnot("inscription", a.inscription));
  else extra.push(textEl("inscription", a.inscription));
  if (a.kind !== "normal") {
    extra.unshift(textEl("arcType", a.kind));
  }
  children.push(tool(extra));
  return el("arc", { id: a.id, source: a.source, target: a.target }, children);
}

function declarationsTool(net: Net): XmlEl | null {
  const d = net.declarations;
  const fns = d.functions ?? [];
  const obs = d.observers ?? [];
  if (!isColoured(net.netClass) && !d.colourSets.length && !d.variables.length && !d.constants.length && !fns.length && !obs.length)
    return null;
  return el("declarations", {}, [
    ...d.colourSets.map((cs) =>
      el("colourSet", { name: cs.name, type: cs.type, min: cs.min, max: cs.max, complementOf: cs.complementOf }, [
        cs.values && el("values", {}, cs.values.map((v) => textEl("value", v))),
        cs.components && el("components", {}, cs.components.map((c) => textEl("component", c))),
        cs.predicate !== undefined && textEl("predicate", cs.predicate),
      ]),
    ),
    ...d.variables.map((v) => el("variable", { name: v.name, colourSet: v.colourSet })),
    ...d.constants.map((c) => textEl("constant", c.value, { name: c.name, group: c.group })),
    ...fns.map((f) => el("function", { name: f.name }, [...f.params.map((p) => textEl("param", p)), textEl("body", f.body)])),
    ...obs.map((o) => textEl("observer", o.expression, { name: o.name, kind: o.kind })),
  ]);
}

/** Symmetric-net declarations (namedsort / variabledecl) for other tools. Constants have no counterpart. */
function standardDeclarations(net: Net, sortIds: Map<string, string>, fresh: (b: string) => string): XmlEl {
  const decls: XmlChild[] = [];
  const done = new Set<string>();
  // Domains of union and subset sets, which the symmetric-net grammar can only list as enumerations.
  const domains = new Map<string, Value[]>();
  for (const cs of net.declarations.colourSets) {
    try {
      domains.set(cs.name, colourSetDomain(cs, domains));
    } catch {
      domains.set(cs.name, []);
    }
  }
  for (const cs of net.declarations.colourSets) {
    if (done.has(cs.name)) continue;
    done.add(cs.name);
    decls.push(el("namedsort", { id: sortIds.get(cs.name), name: cs.name }, [sortBody(cs, sortIds, fresh, domains.get(cs.name) ?? [])]));
  }
  for (const v of net.declarations.variables) {
    const sid = sortIds.get(v.colourSet);
    decls.push(el("variabledecl", { id: fresh(`var_${ncName(v.name)}`), name: v.name }, [sid && el("usersort", { declaration: sid })]));
  }
  return el("declaration", {}, [el("structure", {}, [el("declarations", {}, decls)])]);
}

function sortBody(cs: ColourSetDecl, sortIds: Map<string, string>, fresh: (b: string) => string, domain: Value[]): XmlEl {
  const enumeration = (values: string[]) =>
    el(
      "finiteenumeration",
      {},
      values.map((v) => el("feconstant", { id: fresh(`${ncName(cs.name)}_${ncName(v)}`), name: v })),
    );
  switch (cs.type) {
    case "dot":
      return el("dot");
    case "bool":
      return el("bool");
    case "string":
      return enumeration(cs.values ?? []);
    case "alias": {
      const base = cs.components?.[0] ?? "";
      return el("usersort", { declaration: sortIds.get(base) ?? `cs_${ncName(base)}` });
    }
    case "union":
    case "subset":
      // Exact definition in our toolspecific block; other tools see the values.
      return enumeration(domain.map(showValue));
    case "enum":
      return el(
        "cyclicenumeration",
        {},
        (cs.values ?? []).map((v) => el("feconstant", { id: fresh(`${ncName(cs.name)}_${ncName(v)}`), name: v })),
      );
    case "int":
      return el("finiteintrange", { start: cs.min ?? 0, end: cs.max ?? cs.min ?? 0 });
    case "product":
      return el(
        "productsort",
        {},
        (cs.components ?? []).map((c) => el("usersort", { declaration: sortIds.get(c) ?? `cs_${ncName(c)}` })),
      );
  }
}

/** Makes a string usable inside an XML ID. */
function ncName(s: string): string {
  const t = s.replace(/[^A-Za-z0-9_.-]/g, "_");
  return t || "x";
}
