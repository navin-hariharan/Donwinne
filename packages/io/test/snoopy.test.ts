import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { Net, NetClass, emptyNet, isAmbient } from "@pns/core";
import {
  SNOOPY_CLASSES,
  exportSnoopy,
  exportSnoopyWithWarnings,
  importSnoopy,
  netClassFromSnoopyName,
  snoopyExtension,
  validateNet,
} from "@pns/io";
import { colouredNet, ptNet, xptNet } from "./fixtures";

const parser = new DOMParser({ onError: () => {} });
const sample = (f: string) => readFileSync(`${__dirname}/samples/${f}`, "utf8");
const load = (xml: string) => importSnoopy(xml, parser);

/** A comparable view of a net: ids replaced by names, everything else kept. */
function shape(net: Net) {
  const name = new Map<string, string>();
  for (const n of [...net.places, ...net.transitions, ...(net.faultTree?.nodes ?? [])]) name.set(n.id, n.name);
  const strip = <T extends { id: string; parent?: string }>(n: T) => {
    const { id: _id, parent, ...rest } = n;
    return parent ? { ...rest, parent: name.get(parent) } : rest;
  };
  const byName = (a: { name: string; x: number }, b: { name: string; x: number }) => a.name.localeCompare(b.name) || a.x - b.x;
  return {
    name: net.name,
    netClass: net.netClass,
    comment: net.comment,
    modulus: net.modulus,
    places: net.places.map(strip).sort(byName),
    transitions: net.transitions.map(strip).sort(byName),
    arcs: net.arcs
      .map(({ id: _id, source, target, ...rest }) => ({ ...rest, source: name.get(source), target: name.get(target) }))
      .sort((a, b) => `${a.source}>${a.target}>${a.kind}`.localeCompare(`${b.source}>${b.target}>${b.kind}`)),
    declarations: net.declarations,
    notes: (net.notes ?? []).map(strip).sort((a, b) => a.text.localeCompare(b.text)),
    faultTree: net.faultTree && {
      nodes: net.faultTree.nodes.map(strip).sort(byName),
      edges: net.faultTree.edges
        .map(({ id: _id, source, target, ...rest }) => ({ ...rest, source: name.get(source), target: name.get(target) }))
        .sort((a, b) => `${a.source}>${a.target}`.localeCompare(`${b.source}>${b.target}`)),
    },
  };
}

function roundTrip(net: Net) {
  const { xml, warnings } = exportSnoopyWithWarnings(net);
  const back = load(xml);
  expect(() => validateNet(back.net)).not.toThrow();
  return { xml, exportWarnings: warnings, net: back.net, warnings: back.warnings };
}

// ---------------------------------------------------------------------------------------------

describe("Snoopy net classes", () => {
  it("maps every net class to a Snoopy class and back", () => {
    for (const [c, info] of Object.entries(SNOOPY_CLASSES)) {
      // APNs and T-APNs are Snoopy coloured nets; their class comes back through the description (below).
      expect(netClassFromSnoopyName(info.name)).toBe(isAmbient(c as NetClass) ? "coloured" : c);
      expect(snoopyExtension(c as NetClass)).toBe(info.extension);
    }
    expect(netClassFromSnoopyName("Colored Extended Petri Net")).toBe("coloured");
    expect(netClassFromSnoopyName("Reachability Graph")).toBeUndefined();
  });
});

describe("importing real Snoopy files", () => {
  const files = readdirSync(`${__dirname}/samples`).filter((f) => /\.(hpn|cpn|spped)$/.test(f));

  it.each(files)("imports %s into a valid net and re-exports it unchanged", (f) => {
    const { net } = load(sample(f));
    expect(() => validateNet(net)).not.toThrow();
    expect(net.places.length).toBeGreaterThan(0);
    const again = roundTrip(net);
    expect(shape(again.net)).toEqual(shape(net));
  });

  it("reads a hybrid net: markings, weights, rates and positions (fig2_single-reaction.hpn)", () => {
    const { net, warnings } = load(sample("fig2_single-reaction.hpn"));
    expect(warnings).toEqual([]);
    expect(net.netClass).toBe("hybrid");
    expect(net.places.map((p) => [p.name, p.marking, p.continuous ?? false])).toEqual([
      ["A", "5", false],
      ["B", "5", false],
      ["C", "", false],
    ]);
    expect(net.places[0]).toMatchObject({ x: 364, y: 470 });
    expect(net.transitions).toHaveLength(1);
    expect(net.transitions[0].rate).toBe("MassAction(0.05)");
    expect(net.transitions[0].kind).toBeUndefined(); // stochastic is the hybrid default
    const weights = net.arcs.map((a) => a.inscription).sort();
    expect(weights).toEqual(["1", "1", "2"]);
  });

  it("reads constants of a continuous net (fig3_sir.cpn)", () => {
    const { net } = load(sample("fig3_sir.cpn"));
    expect(net.netClass).toBe("continuous");
    expect(net.declarations.constants.map((c) => c.name).sort()).toEqual(["Ki", "Kr"]);
    expect(net.transitions.map((t) => t.rate).sort()).toEqual(["MassAction(Ki)", "MassAction(Kr)"]);
    expect(net.transitions.every((t) => t.kind === undefined)).toBe(true);
  });

  it("reads modifier edges and edge colours (fig6_feedbackLoops.cpn)", () => {
    const { net, warnings } = load(sample("fig6_feedbackLoops.cpn"));
    expect(warnings.some((w) => /Modifier/.test(w))).toBe(false);
    const modifiers = net.arcs.filter((a) => a.kind === "modifier");
    expect(modifiers.length).toBeGreaterThan(0);
    expect(modifiers.every((a) => a.inscription === "" && net.places.some((p) => p.id === a.source))).toBe(true);
    expect(net.arcs.some((a) => a.color === "#fb0207")).toBe(true);
    // Modifier edges are written back as Modifier edges.
    expect(exportSnoopy(net)).toMatch(/<edgeclass count="\d+" name="Modifier Edge">/);
  });

  it("reads logical places, continuous places and comments (fig10_cellcycleExample.hpn)", () => {
    const { net, warnings } = load(sample("fig10_cellcycleExample.hpn"));
    const v = net.places.filter((p) => p.name === "V");
    expect(v.length).toBeGreaterThan(1);
    expect(v.every((p) => p.logical && p.continuous && p.marking === "10")).toBe(true);
    expect(new Set(v.map((p) => p.id)).size).toBe(v.length);
    expect(net.notes?.length).toBe(4);
    expect(warnings.some((w) => /Observer/.test(w))).toBe(false);
    expect(net.declarations.observers?.length).toBe(7);
    expect(net.declarations.observers?.[0]).toEqual({ name: "SBF_Cont", kind: "place", expression: "SBF/(0.6*V)" });
    // Logical copies collapse into one Snoopy node with several graphics.
    const xml = exportSnoopy(net);
    expect(xml).toMatch(/<node id="\d+" net="1" logic="1">/);
  });

  it("reads a hand-written P/T net with colours, label offsets, bends and notes", () => {
    const { net, warnings } = load(sample("handwritten-mutex.spped"));
    expect(warnings).toEqual([]);
    expect(net.netClass).toBe("pt");
    expect(net.name).toBe("mutex");
    expect(net.comment).toBe("Two processes, one critical section.");
    const idle = net.places.find((p) => p.name === "idle")!;
    expect(idle).toMatchObject({ x: 200, y: 200, marking: "2", color: "#ff0000", comment: "processes waiting" });
    expect(idle.labelOffset).toBeUndefined();
    expect(net.places.find((p) => p.name === "critical")).toMatchObject({ marking: "", labelOffset: { x: 60, y: 0 } });
    const enter = net.arcs.find((a) => a.source === idle.id)!;
    expect(enter.points).toEqual([{ x: 200, y: 140 }]);
    expect(net.arcs.find((a) => a.color)?.color).toBe("#0000ff");
    expect(net.arcs.find((a) => a.inscription === "2")).toBeTruthy();
    expect(net.notes).toEqual([{ id: expect.any(String), x: 300, y: 40, text: "mutual exclusion", color: "#008000" }]);
  });

  it("uses the name option when the file has no name", () => {
    expect(importSnoopy(sample("fig2_single-reaction.hpn"), parser, { name: "fig2" }).net.name).toBe("fig2");
  });

  it("can keep Snoopy's coordinates with scale 1", () => {
    const { net } = importSnoopy(sample("fig2_single-reaction.hpn"), parser, { scale: 1 });
    expect(net.places[0]).toMatchObject({ x: 182, y: 235 });
  });
});

describe("Snoopy round trips", () => {
  it("round-trips a P/T net", () => {
    const net = ptNet();
    const { net: back, exportWarnings } = roundTrip(net);
    expect(exportWarnings).toContain("Snoopy has no place capacities; they were dropped.");
    const expected = shape(net);
    for (const p of expected.places) delete (p as { capacity?: number }).capacity;
    // A single logical place stays logical only when it has copies; markings "0" read back as "".
    for (const p of expected.places) {
      delete (p as { logical?: boolean }).logical;
      if (p.marking === "0") p.marking = "";
      if ((p as { comment?: string }).comment === "") delete (p as { comment?: string }).comment;
    }
    for (const a of expected.arcs) if (a.inscription === "") a.inscription = "1";
    expect(shape(back)).toEqual(expected);
  });

  it("round-trips all arc kinds of an extended net", () => {
    const net = xptNet();
    expect(shape(roundTrip(net).net)).toEqual({ ...shape(net), places: shape(net).places.map((p) => ({ ...p, marking: p.marking })) });
  });

  it("saves a P/T net with extended arcs as an Extended Petri Net", () => {
    const net = xptNet();
    net.netClass = "pt";
    const { xml, exportWarnings, net: back } = roundTrip(net);
    expect(xml).toContain('<netclass name="Extended Petri Net"/>');
    expect(exportWarnings.length).toBe(1);
    expect(back.netClass).toBe("xpt");
  });

  it("round-trips a stochastic net with all transition kinds, constants and groups", () => {
    const net = emptyNet("stochastic", "kinds");
    net.declarations.constants = [
      { name: "k", value: "0.5", group: "parameter" },
      { name: "N", value: "10" },
    ];
    net.places = [
      { id: "p", name: "P", x: 100, y: 100, marking: "N" },
      { id: "q", name: "Q", x: 300, y: 100, marking: "" },
    ];
    net.transitions = [
      { id: "s", name: "s", x: 200, y: 40, rate: "MassAction(k)" },
      { id: "i", name: "i", x: 200, y: 100, kind: "immediate", rate: "2" },
      { id: "d", name: "d", x: 200, y: 160, kind: "deterministic", rate: "3.5" },
      { id: "c", name: "c", x: 200, y: 220, kind: "scheduled", rate: "1, 2, 10" },
    ];
    net.arcs = [
      { id: "a1", source: "p", target: "s", kind: "normal", inscription: "1" },
      { id: "a2", source: "s", target: "q", kind: "normal", inscription: "2" },
      { id: "a3", source: "q", target: "i", kind: "inhibitor", inscription: "5" },
      { id: "a4", source: "p", target: "d", kind: "modifier", inscription: "" },
      { id: "a5", source: "q", target: "c", kind: "reset", inscription: "" },
    ];
    const { net: back, xml } = roundTrip(net);
    expect(xml).toContain('<nodeclass count="1" name="Immediate Transition">');
    expect(xml).toMatch(/name="Modifier Edge">/);
    expect(shape(back)).toEqual(shape(net));
  });

  it("round-trips continuous and hybrid nets", () => {
    const cont = emptyNet("continuous", "c");
    cont.places = [{ id: "p", name: "P", x: 0, y: 0, marking: "2.5" }];
    cont.transitions = [{ id: "t", name: "T", x: 100, y: 0, rate: "0.1*P" }];
    cont.arcs = [{ id: "a", source: "p", target: "t", kind: "normal", inscription: "1" }];
    expect(shape(roundTrip(cont).net)).toEqual(shape(cont));

    const hyb = emptyNet("hybrid", "h");
    hyb.places = [
      { id: "p", name: "P", x: 0, y: 0, marking: "2.5", continuous: true },
      { id: "q", name: "Q", x: 0, y: 100, marking: "1" },
    ];
    hyb.transitions = [
      { id: "t", name: "T", x: 100, y: 0, kind: "continuous", rate: "MassAction(1)" },
      { id: "u", name: "U", x: 100, y: 100, rate: "MassAction(2)" },
    ];
    hyb.arcs = [
      { id: "a", source: "p", target: "t", kind: "normal", inscription: "1" },
      { id: "b", source: "q", target: "u", kind: "equal", inscription: "1" },
    ];
    const { xml, net } = roundTrip(hyb);
    expect(xml).toContain('name="Place, Continuous"');
    expect(xml).toContain('name="Transition, Continuous"');
    expect(shape(net)).toEqual(shape(hyb));
  });

  it("round-trips a timed net with intervals", () => {
    const net = emptyNet("timed", "t");
    net.places = [{ id: "p", name: "P", x: 0, y: 0, marking: "1" }];
    net.transitions = [
      { id: "t", name: "T", x: 100, y: 0, interval: ["1", "3"] },
      { id: "u", name: "U", x: 100, y: 100, interval: ["2", "inf"] },
    ];
    net.arcs = [{ id: "a", source: "p", target: "t", kind: "normal", inscription: "1" }];
    const { xml, net: back } = roundTrip(net);
    expect(xml).toContain("<![CDATA[oo]]>");
    expect(back.transitions.map((t) => t.interval)).toEqual([
      ["1", "3"],
      ["2", "inf"],
    ]);
  });

  it("round-trips a coloured net with declarations, guards and multisets", () => {
    const net = colouredNet();
    const { net: back, exportWarnings } = roundTrip(net);
    const expected = shape(net);
    // Capacities are dropped; arc kinds of the coloured net are all normal or extended.
    for (const p of expected.places) delete (p as { capacity?: number }).capacity;
    expect(exportWarnings).toContain("Snoopy has no place capacities; they were dropped.");
    const got = shape(back);
    // Snoopy keeps basic and structured colour sets in separate lists, so products come last.
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    expect({ ...got.declarations, colourSets: [...got.declarations.colourSets].sort(byName) }).toEqual({
      ...expected.declarations,
      colourSets: [...expected.declarations.colourSets].sort(byName),
    });
    // 1`dot is written as one dot and read back as "dot".
    expect(got.places.map((p) => [p.name, p.colourSet, p.marking])).toEqual(
      expected.places.map((p) => [p.name, p.colourSet, p.marking.replace(/^1`/, "")]),
    );
    expect(got.arcs.map((a) => [a.source, a.target, a.kind, a.inscription])).toEqual(
      expected.arcs.map((a) => [a.source, a.target, a.kind, a.inscription || "dot"]),
    );
    expect(got.transitions.map((t) => [t.name, t.guard])).toEqual(
      expected.transitions.map((t) => [t.name, t.guard && t.guard.replace(/&&| and /g, (m) => (m === "&&" ? "&" : " & "))]),
    );
  });

  it("round-trips a coloured stochastic net", () => {
    const net = emptyNet("colouredStochastic", "cs");
    net.declarations.colourSets.push({ name: "C", type: "enum", values: ["a", "b"] });
    net.declarations.variables.push({ name: "x", colourSet: "C" });
    net.declarations.constants.push({ name: "k", value: "1.5" });
    net.places = [{ id: "p", name: "P", x: 0, y: 0, marking: "2`a ++ b", colourSet: "C" }];
    net.transitions = [{ id: "t", name: "T", x: 100, y: 0, guard: "x <> b", rate: "MassAction(k)" }];
    net.arcs = [{ id: "a", source: "p", target: "t", kind: "normal", inscription: "x" }];
    expect(shape(roundTrip(net).net)).toEqual(shape(net));
  });

  it("round-trips music, modulo and freestyle nets", () => {
    const music = emptyNet("music", "m");
    music.places = [{ id: "p", name: "P", x: 0, y: 0, marking: "1" }];
    music.transitions = [
      { id: "t", name: "T", x: 100, y: 0, sound: { note: "C4", duration: 0.5, instrument: "piano" } },
      { id: "u", name: "U", x: 100, y: 100, sound: { note: "E4" } },
    ];
    music.arcs = [{ id: "a", source: "p", target: "t", kind: "normal", inscription: "1" }];
    expect(shape(roundTrip(music).net)).toEqual(shape(music));

    const mod = emptyNet("modulo", "mod");
    mod.modulus = 5;
    mod.places = [{ id: "p", name: "P", x: 0, y: 0, marking: "3" }];
    mod.transitions = [{ id: "t", name: "T", x: 100, y: 0 }];
    mod.arcs = [{ id: "a", source: "t", target: "p", kind: "normal", inscription: "1" }];
    const m = roundTrip(mod);
    expect(m.net.modulus).toBe(5);
    expect(shape(m.net)).toEqual(shape(mod));

    const free = emptyNet("freestyle", "f");
    free.places = [{ id: "p", name: "state", x: 0, y: 0, marking: "" }];
    free.transitions = [{ id: "t", name: "step", x: 100, y: 0 }];
    free.arcs = [{ id: "a", source: "p", target: "t", kind: "normal", inscription: "1" }];
    expect(shape(roundTrip(free).net)).toEqual(shape(free));
  });

  it("round-trips fault trees", () => {
    const ft = emptyNet("extendedFaultTree", "ft");
    ft.faultTree = {
      nodes: [
        { id: "top", name: "System fails", x: 200, y: 0, type: "top" },
        { id: "g", name: "G1", x: 200, y: 100, type: "kofn", k: 2 },
        { id: "o", name: "G2", x: 300, y: 100, type: "or" },
        { id: "b1", name: "Pump", x: 100, y: 200, type: "basic", failureRate: "0.001", repairRate: "0.1", comment: "main pump" },
        { id: "b2", name: "Valve", x: 200, y: 200, type: "basic", failureRate: "0.002" },
        { id: "b3", name: "Power", x: 300, y: 200, type: "undeveloped", color: "#ff8800" },
      ],
      edges: [
        { id: "e1", source: "g", target: "top" },
        { id: "e2", source: "b1", target: "g", points: [{ x: 120, y: 150 }] },
        { id: "e3", source: "b2", target: "g" },
        { id: "e4", source: "o", target: "g" },
        { id: "e5", source: "b3", target: "o" },
      ],
    };
    const { net, xml } = roundTrip(ft);
    expect(xml).toContain('<netclass name="Extended Fault Tree"/>');
    expect(xml).toContain('name="M-OF-N"');
    expect(shape(net)).toEqual(shape(ft));

    const plain = emptyNet("faultTree", "plain");
    plain.faultTree = {
      nodes: [
        { id: "t", name: "T", x: 0, y: 0, type: "top" },
        { id: "x", name: "X", x: 0, y: 100, type: "xor" },
        { id: "b", name: "B", x: 0, y: 200, type: "basic", probability: "0.25" },
      ],
      edges: [{ id: "e", source: "b", target: "t" }],
    };
    const r = roundTrip(plain);
    expect(r.exportWarnings).toContain("Snoopy's Fault Tree has no xor nodes; they were dropped.");
    expect(r.net.faultTree!.nodes.map((n) => [n.name, n.type, n.probability])).toEqual([
      ["T", "top", undefined],
      ["B", "basic", "0.25"],
    ]);
  });

  it("round-trips hierarchy: coarse nodes, subnets and arcs across levels", () => {
    const net = emptyNet("pt", "hier");
    net.places = [
      { id: "src", name: "src", x: 0, y: 0, marking: "1" },
      { id: "cp", name: "module", x: 200, y: 0, marking: "", coarse: true },
      { id: "inner", name: "inner", x: 100, y: 100, marking: "", parent: "cp" },
      { id: "deep", name: "deep", x: 100, y: 300, marking: "", parent: "ct" },
    ];
    net.transitions = [
      { id: "t", name: "t", x: 100, y: 0 },
      { id: "ct", name: "sub", x: 100, y: 200, coarse: true, parent: "cp" },
      { id: "u", name: "u", x: 200, y: 300, parent: "ct" },
    ];
    net.arcs = [
      { id: "a1", source: "src", target: "t", kind: "normal", inscription: "1" },
      { id: "a2", source: "t", target: "inner", kind: "normal", inscription: "1", points: [{ x: 50, y: 50 }] },
      { id: "a3", source: "inner", target: "u", kind: "normal", inscription: "1" },
      { id: "a4", source: "u", target: "deep", kind: "normal", inscription: "1" },
    ];
    net.notes = [{ id: "n", x: 10, y: 10, text: "inside", parent: "ct" }];
    const { xml, net: back } = roundTrip(net);
    expect(xml).toMatch(/<node id="\d+" net="1" coarse="2">/);
    expect(xml).toMatch(/<node id="\d+" net="2" coarse="3">/);
    expect(shape(back)).toEqual(shape(net));
  });

  it("round-trips logical places, notes, colours and label offsets", () => {
    const net = emptyNet("pt", "logic");
    net.places = [
      { id: "a", name: "shared", x: 0, y: 0, marking: "2", logical: true, color: "#00ff00" },
      { id: "b", name: "shared", x: 300, y: 0, marking: "2", logical: true, labelOffset: { x: 20, y: -60 } },
    ];
    net.transitions = [{ id: "t", name: "t", x: 150, y: 0, horizontal: true, color: "#123456", comment: "c" }];
    net.arcs = [
      { id: "x", source: "a", target: "t", kind: "normal", inscription: "1", color: "#ff0000" },
      { id: "y", source: "t", target: "b", kind: "normal", inscription: "3" },
    ];
    net.notes = [{ id: "n1", x: 100, y: 200, text: "a ]]> tricky\nnote <b>", color: "#0000ff" }];
    const { net: back, xml } = roundTrip(net);
    expect(xml.match(/logic="1"/g)).toHaveLength(1);
    expect(shape(back)).toEqual(shape(net));
  });
});

describe("Snoopy import errors and leniency", () => {
  const wrap = (cls: string, body = "") =>
    `<?xml version="1.0"?><Snoopy version="2" revision="2.0"><netclass name="${cls}"/>${body}</Snoopy>`;

  it("rejects files that are not Snoopy files", () => {
    expect(() => load("not xml at all")).toThrow();
    expect(() => load("<pnml/>")).toThrow(/root element is <pnml>/);
    expect(() => load("PK\u0003\u0004....")).toThrow(/compressed/);
    expect(() => load('<Snoopy version="1"><netclass name="Petri Net"/></Snoopy>')).toThrow(/version 1/);
    expect(() => load('<Snoopy version="2"/>')).toThrow(/no <netclass>/);
    expect(() => load(wrap("Reachability Graph"))).toThrow(/"Reachability Graph" is not supported/);
  });

  it("imports an empty net of each class", () => {
    for (const info of Object.values(SNOOPY_CLASSES)) {
      const { net } = load(wrap(info.name));
      expect(netClassFromSnoopyName(info.name)).toBe(net.netClass);
      expect(() => validateNet(net)).not.toThrow();
    }
  });

  it("skips unknown classes and dangling edges with warnings", () => {
    const body = `<nodeclasses count="2">
      <nodeclass name="Place"><node id="1" net="1"><attribute name="Name"><![CDATA[p]]></attribute></node></nodeclass>
      <nodeclass name="Banana"><node id="2" net="1"/></nodeclass></nodeclasses>
      <edgeclasses><edgeclass name="Edge"><edge source="1" target="99" id="3" net="1"/></edgeclass>
      <edgeclass name="Wobbly Edge"><edge source="1" target="1" id="4" net="1"/></edgeclass></edgeclasses>
      <metadataclasses><metadataclass name="Mystery"><metadata id="5" net="1"/></metadataclass></metadataclasses>`;
    const { net, warnings } = load(wrap("Petri Net", body));
    expect(net.places.map((p) => p.name)).toEqual(["p"]);
    expect(net.arcs).toEqual([]);
    expect(warnings).toEqual([
      'Snoopy metadata of the class "Mystery" is not supported and was skipped.',
      'Nodes of the Snoopy class "Banana" are not supported and were skipped.',
      "Some edges refer to nodes that do not exist and were dropped.",
      'Edges of the Snoopy class "Wobbly Edge" are not supported and were skipped.',
    ]);
  });

  it("drops edges between two places", () => {
    const body = `<nodeclasses><nodeclass name="Place"><node id="1" net="1"/><node id="2" net="1"/></nodeclass></nodeclasses>
      <edgeclasses><edgeclass name="Edge"><edge source="1" target="2" id="3" net="1"/></edgeclass></edgeclasses>`;
    const { net, warnings } = load(wrap("Petri Net", body));
    expect(net.arcs).toEqual([]);
    expect(warnings).toEqual(["Some edges do not connect a place and a transition and were dropped."]);
  });
});

describe("Snoopy export", () => {
  it("writes a well-formed file with every node and edge class of the net class", () => {
    const xml = exportSnoopy(emptyNet("hybrid", "empty"));
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    for (const cls of ["Place", "Place, Continuous", "Transition", "Immediate Transition", "Modifier Edge", "Reset Edge"])
      expect(xml).toContain(`name="${cls}"`);
    expect(xml).toContain('<metadataclass count="1" name="General">');
    expect(parser.parseFromString(xml, "text/xml").documentElement?.nodeName).toBe("Snoopy");
  });

  it("reports what Snoopy cannot represent", () => {
    const net = ptNet();
    net.transitions[0].guard = "x > 1";
    net.transitions[0].kind = "immediate";
    const { warnings } = exportSnoopyWithWarnings(net);
    expect(warnings).toEqual([
      "Transition kinds only exist in stochastic, continuous and hybrid nets and were dropped.",
      "Snoopy has no place capacities; they were dropped.",
      "Guards only exist in coloured nets and were dropped.",
    ]);
  });
});
