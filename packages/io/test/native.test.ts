import { describe, expect, it } from "vitest";
import { Net, compile, emptyNet } from "@pns/core";
import { parseNet, serializeNet } from "@pns/io";
import { colouredNet, ptNet, xptNet } from "./fixtures";

describe("native format", () => {
  it("serialises as pretty JSON with the format tag", () => {
    const text = serializeNet(ptNet());
    expect(text).toContain('\n  "format": "pns/1"');
    expect(JSON.parse(text).format).toBe("pns/1");
  });

  it.each([
    ["pt", ptNet],
    ["xpt", xptNet],
    ["coloured", colouredNet],
  ])("round-trips a %s net", (_, make) => {
    const net = make();
    expect(parseNet(serializeNet(net))).toEqual(net);
  });

  it("fills defaults for optional fields", () => {
    const net = parseNet(
      JSON.stringify({
        format: "pns/1",
        places: [{ id: "p1", marking: 2 }],
        transitions: [{ id: "t1" }],
        arcs: [{ id: "a1", source: "p1", target: "t1" }, { id: "a2", source: "p1", target: "t1", kind: "reset" }],
      }),
    );
    expect(net).toEqual<Net>({
      format: "pns/1",
      name: "Untitled",
      netClass: "pt",
      places: [{ id: "p1", name: "p1", x: 0, y: 0, marking: "2" }],
      transitions: [{ id: "t1", name: "t1", x: 0, y: 0 }],
      arcs: [
        { id: "a1", source: "p1", target: "t1", kind: "normal", inscription: "1" },
        { id: "a2", source: "p1", target: "t1", kind: "reset", inscription: "" },
      ],
      declarations: { colourSets: [], variables: [], constants: [] },
    });
    expect(compile(net).problems.filter((p) => p.severity === "error")).toEqual([]);
  });

  it("gives coloured nets the Dot colour set by default", () => {
    const net = parseNet(JSON.stringify({ format: "pns/1", netClass: "coloured" }));
    expect(net.declarations).toEqual(emptyNet("coloured").declarations);
  });

  it("round-trips every new field", () => {
    const net = emptyNet("hybrid", "everything");
    net.declarations.constants = [{ name: "k", value: "1", group: "parameter" }];
    net.places = [
      { id: "c", name: "C", x: 0, y: 0, marking: "", coarse: true, color: "#abc", labelOffset: { x: 1, y: -2 }, comment: "coarse" },
      { id: "p", name: "P", x: 0, y: 0, marking: "2.5", continuous: true, parent: "c", logical: true },
    ];
    net.transitions = [
      { id: "t", name: "T", x: 1, y: 2, kind: "deterministic", rate: "3", parent: "c", color: "red" },
      { id: "u", name: "U", x: 1, y: 2, kind: "continuous", rate: "MassAction(k)", interval: ["0", "inf"], sound: { note: "C4", duration: 0.25, instrument: "piano" } },
    ];
    net.arcs = [{ id: "a", source: "p", target: "t", kind: "read", inscription: "0", color: "#ff000080", points: [{ x: 3, y: 4 }] }];
    net.notes = [{ id: "n", x: 5, y: 6, text: "hello", parent: "c", color: "rgb(1, 2, 3)" }];
    net.comment = "c";
    expect(parseNet(serializeNet(net))).toEqual(net);

    const ft = emptyNet("extendedFaultTree", "ft");
    ft.faultTree = {
      nodes: [
        { id: "top", name: "Top", x: 0, y: 0, type: "top" },
        { id: "g", name: "G", x: 0, y: 50, type: "kofn", k: 2, parent: "top", comment: "two of three" },
        { id: "b", name: "B", x: 0, y: 100, type: "basic", failureRate: "0.1", repairRate: "lambda", probability: "0.5", color: "#000" },
      ],
      edges: [{ id: "e", source: "b", target: "g", points: [{ x: 0, y: 75 }] }],
    };
    expect(parseNet(serializeNet(ft))).toEqual(ft);
  });

  it("gives modulo nets modulus 2 and fault trees an empty tree by default", () => {
    expect(parseNet(JSON.stringify({ format: "pns/1", netClass: "modulo" })).modulus).toBe(2);
    expect(parseNet(JSON.stringify({ format: "pns/1", netClass: "faultTree" })).faultTree).toEqual({ nodes: [], edges: [] });
  });

  it("reopens freestyle drawings with arcs between any two nodes", () => {
    const net = parseNet(
      JSON.stringify({ format: "pns/1", netClass: "freestyle", places: [{ id: "p" }, { id: "q" }], arcs: [{ id: "a", source: "p", target: "q" }] }),
    );
    expect(net.arcs).toHaveLength(1);
  });

  it("drops unknown properties", () => {
    const net = parseNet(JSON.stringify({ ...ptNet(), extra: 1 }));
    expect(net).not.toHaveProperty("extra");
  });

  const bad: [string, unknown, RegExp][] = [
    ["not JSON", "{", /not valid JSON/],
    ["not an object", [], /must be an object/],
    ["missing format", { name: "x" }, /format.*missing/],
    ["unknown format", { format: "pns/2" }, /Unsupported file format "pns\/2"/],
    ["bad net class", { format: "pns/1", netClass: "petri" }, /Unknown net class "petri"/],
    ["bad modulus", { format: "pns/1", netClass: "modulo", modulus: 1.5 }, /modulus must be a whole number/],
    ["bad transition kind", { format: "pns/1", transitions: [{ id: "t", kind: "slow" }] }, /unknown kind "slow"/],
    ["one-sided interval", { format: "pns/1", transitions: [{ id: "t", interval: [1] }] }, /exactly two bounds/],
    ["zero note duration", { format: "pns/1", transitions: [{ id: "t", sound: { note: "C4", duration: 0 } }] }, /greater than zero/],
    ["unknown instrument", { format: "pns/1", transitions: [{ id: "t", sound: { note: "C4", instrument: "kazoo" } }] }, /unknown instrument "kazoo"/],
    ["bad colour", { format: "pns/1", places: [{ id: "p", color: "not a colour!" }] }, /colour of Place "p"/],
    ["parent that is not coarse", { format: "pns/1", places: [{ id: "p" }, { id: "q", parent: "p" }] }, /not a coarse place or transition/],
    ["parent that does not exist", { format: "pns/1", notes: [{ id: "n", x: 0, y: 0, text: "", parent: "zz" }] }, /Note "n" lies in the subnet of "zz"/],
    [
      "hierarchy cycle",
      { format: "pns/1", places: [{ id: "a", coarse: true, parent: "b" }], transitions: [{ id: "b", coarse: true, parent: "a" }] },
      /contain each other/,
    ],
    [
      "unknown fault tree node type",
      { format: "pns/1", netClass: "faultTree", faultTree: { nodes: [{ id: "x", type: "maybe" }], edges: [] } },
      /unknown type "maybe"/,
    ],
    [
      "dangling fault tree edge",
      { format: "pns/1", netClass: "faultTree", faultTree: { nodes: [{ id: "x", type: "basic" }], edges: [{ id: "e", source: "x", target: "y" }] } },
      /Fault tree edge "e" refers to "y"/,
    ],
    [
      "fault tree self loop",
      { format: "pns/1", netClass: "faultTree", faultTree: { nodes: [{ id: "x", type: "or" }], edges: [{ id: "e", source: "x", target: "x" }] } },
      /to itself/,
    ],
    [
      "note sharing an id",
      { format: "pns/1", places: [{ id: "x" }], notes: [{ id: "x", x: 0, y: 0, text: "" }] },
      /id "x" is used by both/,
    ],
    ["places not a list", { format: "pns/1", places: {} }, /"places" field must be a list/],
    ["place without id", { format: "pns/1", places: [{ name: "p" }] }, /Place #1 has no id/],
    ["bad coordinate", { format: "pns/1", places: [{ id: "p", x: "1" }] }, /x position of Place "p" must be a number/],
    ["negative capacity", { format: "pns/1", places: [{ id: "p", capacity: -1 }] }, /capacity of Place "p"/],
    ["bad logical flag", { format: "pns/1", places: [{ id: "p", logical: 1 }] }, /logical flag/],
    [
      "duplicate ids",
      { format: "pns/1", places: [{ id: "x" }], transitions: [{ id: "x" }] },
      /id "x" is used by both place x and transition x/,
    ],
    [
      "dangling arc",
      { format: "pns/1", places: [{ id: "p" }], arcs: [{ id: "a", source: "p", target: "nope" }] },
      /Arc "a" refers to "nope"/,
    ],
    [
      "place-to-place arc",
      { format: "pns/1", places: [{ id: "p" }, { id: "q" }], arcs: [{ id: "a", source: "p", target: "q" }] },
      /must connect a place and a transition/,
    ],
    [
      "unknown arc kind",
      { format: "pns/1", places: [{ id: "p" }], transitions: [{ id: "t" }], arcs: [{ id: "a", source: "p", target: "t", kind: "test" }] },
      /unknown kind "test"/,
    ],
    [
      "bad colour set type",
      { format: "pns/1", declarations: { colourSets: [{ name: "C", type: "list" }] } },
      /Colour set "C" has unknown type "list"/,
    ],
    [
      "non-integer int range",
      { format: "pns/1", declarations: { colourSets: [{ name: "C", type: "int", min: 0.5 }] } },
      /minimum of colour set "C" must be a whole number/,
    ],
  ];
  it.each(bad)("rejects %s", (_, input, message) => {
    const text = typeof input === "string" ? input : JSON.stringify(input);
    expect(() => parseNet(text)).toThrow(message);
  });
});
