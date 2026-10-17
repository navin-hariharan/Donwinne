import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { Net, NetClass, defaultTransitionKind, emptyNet, parse } from "@pns/core";
import { exportAndl, exportCandl, exportLola, exportSnoopyWithWarnings, exportTina, importAndl, importSnoopy } from "@pns/io";
import { printExpr } from "../src/text-common";
import { colouredNet, xptNet } from "./fixtures";
// Read-only use of the editor's built-in examples (File > Examples), so every shipped example is covered.
import { EXAMPLES } from "../../editor/src/examples";

const parser = new DOMParser({ onError: () => {} });
const STYLE = { and: " and ", or: " or ", not: "not ", eq: " = ", ne: " <> " };

/** Expression text in one canonical form (spacing, && vs &, == vs =). */
function canon(src: string | undefined): string {
  const s = (src ?? "").trim();
  if (!s) return "";
  return printExpr(parse(s), STYLE).replace(/\s+/g, "");
}

/** What CANDL can express, independent of ids, layout and expression spelling. */
function shape(net: Net) {
  const nameOf = (id: string) => net.places.find((p) => p.id === id)?.name ?? net.transitions.find((t) => t.id === id)?.name ?? id;
  const sets = net.declarations.colourSets;
  const isDot = (cs: string | undefined) => sets.find((c) => c.name === (cs ?? "Dot"))?.type === "dot";
  const ms = (src: string, cs: string | undefined) => {
    const c = canon(src);
    return isDot(cs) ? c.replace(/^(\d+)`dot$/, "$1").replace(/^dot$/, "1") : c;
  };
  const csOfArc = (a: Net["arcs"][number]) => net.places.find((p) => p.id === a.source || p.id === a.target)?.colourSet;
  return {
    netClass: net.netClass,
    colourSets: sets,
    variables: net.declarations.variables,
    // CANDL lists constants by group, so only the set of constants is kept.
    constants: net.declarations.constants.map((c) => ({ name: c.name, value: canon(c.value), group: c.group })).sort((a, b) => a.name.localeCompare(b.name)),
    functions: (net.declarations.functions ?? []).map((f) => ({ name: f.name, params: f.params, body: canon(f.body) })),
    observers: (net.declarations.observers ?? []).map((o) => ({ name: o.name, kind: o.kind, expression: canon(o.expression) })),
    places: net.places
      .map((p) => ({ name: p.name, colourSet: p.colourSet ?? "Dot", marking: ms(p.marking, p.colourSet), continuous: !!p.continuous }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    transitions: net.transitions
      .map((t) => ({ name: t.name, kind: t.kind ?? defaultTransitionKind(net.netClass), guard: canon(t.guard), rate: canon(t.rate) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    arcs: net.arcs
      .filter((a) => a.kind !== "modifier")
      .map((a) => ({ source: nameOf(a.source), target: nameOf(a.target), kind: a.kind, inscription: a.kind === "reset" ? "" : ms(a.inscription || "1", csOfArc(a)) }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

/** Export -> import -> same structure, and a second export gives the same text. */
function roundTrip(net: Net) {
  const text = exportCandl(net);
  const { net: back, warnings } = importAndl(text);
  expect(warnings).toEqual([]);
  expect(shape(back)).toEqual(shape(net));
  expect(exportCandl(back)).toBe(text);
  return { text, back };
}

/** Every colour set type CANDL can write, a colour function, guard, observer and each arc kind. */
function allFeatures(netClass: NetClass): Net {
  const net = emptyNet(netClass, "features");
  net.declarations.constants = [
    { name: "N", value: "3" },
    { name: "k", value: "0.5", group: "rates" },
    { name: "favourite", value: "red" },
  ];
  net.declarations.colourSets = [
    { name: "Dot", type: "dot" },
    { name: "E", type: "enum", values: ["red", "green"] },
    { name: "I", type: "int", min: 1, max: 6 },
    { name: "B", type: "bool" },
    { name: "S", type: "string", values: ["alpha", "beta"] },
    { name: "Odd", type: "subset", components: ["I"], predicate: "x % 2 = 1" },
    { name: "A", type: "alias", components: ["E"] },
    { name: "EI", type: "product", components: ["E", "I"] },
  ];
  net.declarations.variables = [
    { name: "x", colourSet: "Odd" },
    { name: "c", colourSet: "E" },
  ];
  net.declarations.functions = [{ name: "dbl", params: ["x"], body: "2 * x" }];
  net.declarations.observers = [
    { name: "all", kind: "place", expression: "P + Q" },
    { name: "speed", kind: "transition", expression: "t" },
  ];
  net.places = [
    { id: "p", name: "P", x: 0, y: 0, marking: "all(Odd)", colourSet: "Odd" },
    { id: "q", name: "Q", x: 0, y: 0, marking: "", colourSet: "Odd" },
    { id: "m", name: "M", x: 0, y: 0, marking: "red ++ 2`green", colourSet: "A" },
    { id: "pr", name: "Pairs", x: 0, y: 0, marking: "(red, 1) ++ 3`(green, N)", colourSet: "EI" },
    { id: "d", name: "D", x: 0, y: 0, marking: "2`dot", colourSet: "Dot" },
    { id: "z", name: "Z", x: 0, y: 0, marking: "", colourSet: "Dot" },
  ];
  net.transitions = [
    { id: "t", name: "t", x: 0, y: 0, guard: "x > 1 && c <> favourite", rate: "k * dbl(1) * P" },
    { id: "u", name: "u", x: 0, y: 0, rate: "MassAction(k)" },
  ];
  net.arcs = [
    { id: "a1", source: "p", target: "t", kind: "normal", inscription: "x" },
    { id: "a2", source: "t", target: "q", kind: "normal", inscription: "2`x" },
    { id: "a3", source: "m", target: "t", kind: "read", inscription: "c" },
    { id: "a4", source: "pr", target: "t", kind: "inhibitor", inscription: "(c, x)" },
    { id: "a5", source: "d", target: "t", kind: "equal", inscription: "2`dot" },
    { id: "a6", source: "z", target: "u", kind: "reset", inscription: "" },
    { id: "a7", source: "d", target: "u", kind: "normal", inscription: "1" },
  ];
  if (netClass === "coloured") for (const t of net.transitions) delete t.rate;
  if (netClass === "colouredHybrid") {
    net.places[1].continuous = true;
    net.transitions[1].kind = "continuous";
  }
  return net;
}

describe("CANDL import", () => {
  for (const c of ["coloured", "colouredStochastic", "colouredContinuous", "colouredHybrid"] as NetClass[])
    it(`round-trips a ${c} net with every CANDL feature`, () => {
      const net = allFeatures(c);
      const { text, back } = roundTrip(net);
      expect(text.split("\n")[0]).toBe(`${{ coloured: "colxpn", colouredStochastic: "colspn", colouredContinuous: "colcpn", colouredHybrid: "colhpn" }[c as string]} [features]`);
      expect(back.declarations.colourSets.find((s) => s.name === "A")).toEqual({ name: "A", type: "alias", components: ["E"] });
      expect(back.places.find((p) => p.name === "P")!.marking).toBe("all(Odd)");
      expect(back.places.find((p) => p.name === "D")!.marking).toBe("2");
    });

  it("round-trips the coloured test fixture", () => {
    roundTrip(colouredNet());
  });

  it("round-trips every coloured example shipped with the editor", () => {
    // CANDL has no ambient class: APN examples go through as the plain coloured nets they are built on.
    const coloured = EXAMPLES.filter((e) => /^coloured/.test(e.net.netClass) || e.net.netClass === "apn");
    expect(coloured.length).toBeGreaterThan(0);
    for (const e of coloured) roundTrip(e.net.netClass === "apn" ? { ...e.net, netClass: "coloured" } : e.net);
  });

  it("round-trips coloured nets that went through a Snoopy file", () => {
    for (const c of ["coloured", "colouredStochastic", "colouredContinuous", "colouredHybrid"] as NetClass[]) {
      const { xml } = exportSnoopyWithWarnings(allFeatures(c));
      const fromSnoopy = importSnoopy(xml, parser).net;
      roundTrip(fromSnoopy);
    }
  });

  it("reads hand-written CANDL: plain colour sets, variable lists, guards and integer constants as bounds", () => {
    const { net, warnings } = importAndl(`colspn [shop]
{
constants:
  all:
    int N = 3;
colorsets:
  Dot Dot = {dot};
  Int Slot = {1..N};
  Enum Kind = {a, b};
  Int Few = {2, 3, 4};
variables:
  Slot : i, j;
  Kind : k;
places:
  Slot Free = all();
  Kind Queue = 2\`a++b;
  Dot Bell = 1\`dot;
transitions:
  serve
    : [i <> j] & [Bell >= {1\`dot}]
    : [Free - {i}] & [Queue - {k}]
    : MassAction(1)
    ;
}
`);
    expect(warnings).toEqual([]);
    expect(net.netClass).toBe("colouredStochastic");
    expect(net.declarations.colourSets).toEqual([
      { name: "Dot", type: "dot" },
      { name: "Slot", type: "int", min: 1, max: 3 },
      { name: "Kind", type: "enum", values: ["a", "b"] },
      { name: "Few", type: "int", min: 2, max: 4 },
    ]);
    expect(net.declarations.variables).toEqual([
      { name: "i", colourSet: "Slot" },
      { name: "j", colourSet: "Slot" },
      { name: "k", colourSet: "Kind" },
    ]);
    expect(net.places.map((p) => [p.name, p.colourSet, p.marking])).toEqual([
      ["Free", "Slot", "all(Slot)"],
      ["Queue", "Kind", "2`a++b"],
      ["Bell", "Dot", "1"],
    ]);
    expect(net.transitions[0].guard).toBe("i <> j");
    expect(net.arcs.map((a) => [a.kind, a.inscription])).toEqual([
      ["read", "1"],
      ["normal", "i"],
      ["normal", "k"],
    ]);
  });

  it("reports what it cannot read", () => {
    expect(() => importAndl("colpn [x] { colorsets: Int I = {1, 3}; }")).toThrow(/not a range of consecutive numbers/);
    expect(() => importAndl("colpn [x] { colorsets: Enum E = red; }")).toThrow(/cannot read the definition of the colour set "E"/);
    expect(() => importAndl("pn [x] { places: Dot P = 1; }")).toThrow(/looks like a coloured place/);
    expect(() => importAndl("foo [x] { }")).toThrow(/unknown net type "foo"/);
  });
});

describe("timed and music nets as ANDL", () => {
  for (const c of ["timed", "music"] as NetClass[])
    it(`writes the untimed structure of the ${c} example as xpn with a note`, () => {
      const ex = EXAMPLES.find((e) => e.net.netClass === c)!.net;
      const text = exportAndl(ex);
      const [note, header] = text.split("\n");
      expect(note).toMatch(c === "timed" ? /^\/\/ Timed net .* firing intervals of 3 transitions were dropped\.$/ : /^\/\/ Music net .* sounds of 8 transitions were dropped\.$/);
      expect(header).toBe(`xpn [${ex.name}]`);
      const { net, warnings } = importAndl(text);
      expect(warnings).toEqual([]);
      expect(net.netClass).toBe("xpt");
      expect(net.places.map((p) => p.name)).toEqual(ex.places.map((p) => p.name));
      expect(net.arcs).toHaveLength(ex.arcs.length);
    });
});

describe("TINA and LoLA arcs", () => {
  it("TINA writes read, inhibitor and equal arcs and refuses only reset arcs", () => {
    const net = xptNet();
    const reset = net.arcs.find((a) => a.kind === "reset")!;
    expect(() => exportTina(net)).toThrow('TINA has no reset arcs (found one at "p" -> "t"). Reset arcs can be exported as Snoopy, PNML, ANDL, APNN or PRISM.');
    net.arcs = net.arcs.filter((a) => a !== reset);
    expect(exportTina(net)).toContain("tr t p p?2 p?-3 p?5 p?-6 -> q");
    const zero = xptNet();
    zero.arcs = zero.arcs.filter((a) => a.kind === "equal" || a.id === "out");
    zero.arcs[0].inscription = "0";
    expect(exportTina(zero)).toContain("tr t p?-1 -> q");
  });

  it("TINA exports the editor's extended example once its reset arc is gone", () => {
    const ex = structuredClone(EXAMPLES.find((e) => e.net.netClass === "xpt")!.net);
    expect(() => exportTina(ex)).toThrow(/reset arcs/);
    ex.arcs = ex.arcs.filter((a) => a.kind !== "reset");
    const text = exportTina(ex);
    expect(text).toContain("tr serve_normal normal_queue urgent_queue?-1 resource?1 -> done");
  });

  it("LoLA names the arc kind and the formats that can write it", () => {
    const net = xptNet();
    expect(() => exportLola(net)).toThrow('LoLA has no inhibitor arcs (found one at "p" -> "t"). Inhibitor arcs can be exported as Snoopy, PNML, ANDL, APNN, PRISM or TINA.');
    net.arcs = net.arcs.filter((a) => a.kind !== "inhibitor" && a.kind !== "equal");
    expect(() => exportLola(net)).toThrow(/LoLA has no reset arcs .* Reset arcs can be exported as Snoopy, PNML, ANDL, APNN or PRISM\./);
  });
});
