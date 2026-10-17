import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { Net, emptyNet } from "@pns/core";
import {
  ExportError,
  exportAndl,
  exportApnn,
  exportCandl,
  exportCsvDeclarations,
  exportLola,
  exportPrism,
  exportSbml,
  exportTina,
  importAndl,
} from "@pns/io";
import { colouredNet, xptNet } from "./fixtures";

/** A + 2 B -> C at rate MassAction(k), with a read arc from E and constants. */
function reaction(netClass: Net["netClass"] = "stochastic"): Net {
  const net = emptyNet(netClass, "reaction");
  net.declarations.constants = [
    { name: "k", value: "0.5", group: "parameter" },
    { name: "N", value: "3" },
  ];
  net.places = [
    { id: "a", name: "A", x: 0, y: 0, marking: "N" },
    { id: "b", name: "B", x: 0, y: 100, marking: "4" },
    { id: "c", name: "C", x: 200, y: 50, marking: "" },
    { id: "e", name: "E", x: 100, y: 0, marking: "1" },
  ];
  net.transitions = [{ id: "t", name: "r1", x: 100, y: 50, rate: "MassAction(k)" }];
  net.arcs = [
    { id: "1", source: "a", target: "t", kind: "normal", inscription: "1" },
    { id: "2", source: "b", target: "t", kind: "normal", inscription: "2" },
    { id: "3", source: "t", target: "c", kind: "normal", inscription: "1" },
    { id: "4", source: "e", target: "t", kind: "read", inscription: "1" },
  ];
  return net;
}

describe("ANDL", () => {
  it("writes a stochastic net", () => {
    expect(exportAndl(reaction())).toBe(`xspn [reaction]
{
constants:
  parameter:
    double k = 0.5;
  all:
    int N = 3;
places:
  A = N;
  B = 4;
  C = 0;
  E = 1;
transitions:
  stochastic:
    r1
      : [E >= 1]
      : [A - 1] & [B - 2] & [C + 1]
      : MassAction(k)
      ;
}
`);
  });

  it("writes every arc kind of an extended net", () => {
    const text = exportAndl(xptNet());
    expect(text.startsWith("xpn [All arc kinds]")).toBe(true);
    expect(text).toContain("  t\n    : [p >= 2] & [p < 3] & [p = 5]\n    : [p - 1] & [p = 0] & [q + 1]\n    ;");
  });

  it("groups hybrid places and transition kinds", () => {
    const net = reaction("hybrid");
    net.places[2].continuous = true;
    net.transitions.push({ id: "i", name: "fast", x: 0, y: 0, kind: "immediate" });
    net.transitions.push({ id: "d", name: "flow", x: 0, y: 0, kind: "continuous", rate: "k*C" });
    const text = exportAndl(net);
    expect(text).toMatch(/^hpn /);
    expect(text).toContain("places:\n  discrete:\n    A = N;\n    B = 4;\n    E = 1;\n  continuous:\n    C = 0;");
    expect(text).toContain("  immediate:\n    fast\n      : \n      : \n      : 1\n      ;");
    expect(text).toContain("  continuous:\n    flow\n      : \n      : \n      : k * C\n      ;");
  });

  it("round-trips through importAndl", () => {
    const net = reaction();
    const { net: back, warnings } = importAndl(exportAndl(net));
    expect(warnings).toEqual([]);
    expect(back.netClass).toBe("stochastic");
    expect(back.name).toBe("reaction");
    expect(back.declarations.constants).toEqual(net.declarations.constants);
    expect(back.places.map((p) => [p.name, p.marking])).toEqual(net.places.map((p) => [p.name, p.marking]));
    expect(back.transitions.map((t) => [t.name, t.rate, t.kind])).toEqual([["r1", "MassAction(k)", undefined]]);
    const name = (id: string) => [...back.places, ...back.transitions].find((n) => n.id === id)!.name;
    expect(back.arcs.map((a) => [name(a.source), name(a.target), a.kind, a.inscription]).sort()).toEqual(
      [
        ["A", "r1", "normal", "1"],
        ["B", "r1", "normal", "2"],
        ["E", "r1", "read", "1"],
        ["r1", "C", "normal", "1"],
      ].sort(),
    );
  });

  it("round-trips extended arcs, immediate transitions and hybrid places", () => {
    const back = importAndl(exportAndl(xptNet())).net;
    expect(back.netClass).toBe("xpt");
    expect(back.arcs.map((a) => a.kind).sort()).toEqual(["equal", "inhibitor", "normal", "normal", "read", "reset"]);
    const h = reaction("hybrid");
    h.places[0].continuous = true;
    h.transitions[0].kind = "immediate";
    const hb = importAndl(exportAndl(h)).net;
    expect(hb.places.map((p) => p.continuous ?? false)).toEqual([false, false, false, true]);
    expect(hb.transitions[0].kind).toBe("immediate");
  });

  it("imports hand-written ANDL with comments, reversible transitions and skipped sections", () => {
    const { net, warnings } = importAndl(`
      // a comment
      pn [hand]
      {
      places:
        P = 2; /* block */ Q;
      transitions:
        T {rev}
          : [P > 1]
          : [P - 1] & [Q + 1]
          ;
      observers:
        place:
          obs = P + Q;
      }`);
    expect(net.netClass).toBe("xpt");
    expect(net.places.map((p) => [p.name, p.marking])).toEqual([
      ["P", "2"],
      ["Q", ""],
    ]);
    expect(net.arcs.find((a) => a.kind === "read")?.inscription).toBe("2");
    expect(warnings).toEqual(["Reversible transitions ({rev}) were imported in their forward direction only."]);
    expect(net.declarations.observers).toEqual([{ name: "obs", kind: "place", expression: "P + Q" }]);
  });

  it.each([
    ["an unknown type", "qpn [x] { }", /unknown net type "qpn"/],
    ["a coloured place in an uncoloured net", "spn [x] { places: Dot P = 1; }", /looks like a coloured place/],
    ["a missing brace", "pn [x] places: P = 1;", /expected "\{"/],
    ["an unknown place", "pn [x] { places: P; transitions: T : : [Q + 1] ; }", /unknown place "Q"/],
    ["a bad update", "pn [x] { places: P; transitions: T : : [P = 3] ; }", /only resets to 0/],
    ["a duplicate place", "pn [x] { places: P; P; }", /declared twice/],
  ])("rejects %s", (_, text, message) => {
    expect(() => importAndl(text)).toThrow(message);
  });

  it("refuses classes ANDL cannot hold", () => {
    expect(() => exportAndl(colouredNet())).toThrow(/Use the CANDL export/);
    expect(() => exportAndl(emptyNet("faultTree", "f"))).toThrow(ExportError);
    expect(() => exportAndl(emptyNet("modulo", "m"))).toThrow(/ANDL cannot represent a/);
  });
});

describe("CANDL", () => {
  it("writes colour sets, variables, coloured places and arcs", () => {
    const net = colouredNet();
    const text = exportCandl(net);
    expect(text.startsWith("colxpn [Philosophers]\n{\n")).toBe(true);
    expect(text).toContain("colorsets:\n  Dot Dot = {dot};\n  Enum Phil = {ph1,ph2,ph3};\n  Int Small = {0..4};\n  Prod Pair = PROD(Phil,Small);");
    expect(text).toContain("constants:\n  all:\n    Phil first = ph1;\n    bool lim = 2 < 3;");
    expect(text).toContain("variables:\n  Phil : x;\n  Small : n;");
    expect(text).toContain("  Phil think = all();");
    expect(text).toContain("  Pair eat;");
    expect(text).toContain("  Dot token = 1`dot;");
    expect(text).toContain(": [x <> first & n < 3] & [token >= {1`dot}]");
    expect(text).toContain(": [think - {x}] & [eat + {1`(x, n)++1`(succ(x), n)}]");
  });

  it("writes coloured stochastic nets with rates", () => {
    const net = colouredNet();
    net.netClass = "colouredStochastic";
    net.arcs = net.arcs.filter((a) => a.kind === "normal");
    net.transitions[0].rate = "MassAction(2)";
    expect(exportCandl(net)).toMatch(/^colspn [\s\S]*  stochastic:\n    go\n[\s\S]*: MassAction\(2\)\n      ;/);
  });

  it("refuses uncoloured nets", () => {
    expect(() => exportCandl(reaction())).toThrow(/CANDL cannot represent/);
  });
});

describe("LoLA", () => {
  it("writes places, the initial marking and transitions", () => {
    expect(exportLola(reaction())).toBe(`{ reaction - exported by Donwinne }
PLACE A, B, C, E;
MARKING A : 3, B : 4, E : 1;
TRANSITION r1
  CONSUME A : 1, B : 2, E : 1;
  PRODUCE E : 1, C : 1;
`);
  });

  it("groups places by capacity and merges logical places", () => {
    const net = reaction("pt");
    net.places[1].capacity = 5;
    net.places.push({ id: "a2", name: "A", x: 0, y: 0, marking: "N", logical: true });
    net.places[0].logical = true;
    net.arcs.push({ id: "5", source: "t", target: "a2", kind: "normal", inscription: "1" });
    const text = exportLola(net);
    expect(text).toContain("PLACE A, C, E; SAFE 5: B;");
    expect(text).toContain("PRODUCE E : 1, C : 1, A : 1;");
  });

  it("refuses inhibitor arcs, fractional markings and continuous nets", () => {
    expect(() => exportLola(xptNet())).toThrow(/LoLA has no inhibitor arcs/);
    const frac = reaction("pt");
    frac.places[0].marking = "1.5";
    expect(() => exportLola(frac)).toThrow(/not a whole number/);
    expect(() => exportLola(reaction("continuous"))).toThrow(/LoLA cannot represent a/);
    const unknown = reaction("pt");
    unknown.places[0].marking = "M";
    expect(() => exportLola(unknown)).toThrow(/"M", which is not a constant/);
  });
});

describe("TINA", () => {
  it("writes transitions with intervals, weights and test/inhibitor arcs", () => {
    const net = reaction("timed");
    net.transitions[0].interval = ["1", "inf"];
    net.transitions.push({ id: "u", name: "r 2", x: 0, y: 0, interval: ["0.5", "2"] });
    net.arcs.push({ id: "5", source: "c", target: "u", kind: "inhibitor", inscription: "2" });
    expect(exportTina(net)).toBe(`net reaction
tr r1 [1,w[ A B*2 E?1 -> C
tr r_2 [0.5,2] C?-2 ->
pl A (3)
pl B (4)
pl C
pl E (1)
`);
  });

  it("omits the default interval and braces odd net names", () => {
    const net = reaction("pt");
    net.name = "my net";
    const text = exportTina(net);
    expect(text).toContain("net {my net}\ntr r1 A B*2 E?1 -> C\n");
  });

  it("refuses reset arcs and bad intervals", () => {
    expect(() => exportTina(xptNet())).toThrow(/TINA has no reset arcs/);
    const net = reaction("timed");
    net.transitions[0].interval = ["3", "1"];
    expect(() => exportTina(net)).toThrow(/ends before it starts/);
  });
});

describe("APNN", () => {
  it("writes constants, places, transitions with functions, and typed arcs", () => {
    expect(exportApnn(reaction())).toBe(`\\beginnet{reaction}
\\const{\\type{double}\\name{k}\\value{0.5}}
\\const{\\type{integer}\\name{N}\\value{3}}
\\place{P_0}{\\name{A} \\init{3}}
\\place{P_1}{\\name{B} \\init{4}}
\\place{P_2}{\\name{C} \\init{0}}
\\place{P_3}{\\name{E} \\init{1}}
\\transition{T_0}{\\name{r1} \\function{MassAction(k)}}
\\arc{A_0}{\\from{P_0} \\to{T_0} \\weight{1} \\type{ordinary}}
\\arc{A_1}{\\from{P_1} \\to{T_0} \\weight{2} \\type{ordinary}}
\\arc{A_2}{\\from{P_3} \\to{T_0} \\weight{1} \\type{readarc}}
\\arc{A_3}{\\from{T_0} \\to{P_2} \\weight{1} \\type{ordinary}}
\\endnet
`);
  });

  it("writes all arc kinds of extended nets", () => {
    const text = exportApnn(xptNet());
    for (const t of ["ordinary", "readarc", "inhibitor", "resetarc", "equalarc"]) expect(text).toContain(`\\type{${t}}`);
    expect(text).not.toContain("\\function");
  });

  it("refuses immediate transitions and coloured nets", () => {
    const net = reaction();
    net.transitions[0].kind = "immediate";
    expect(() => exportApnn(net)).toThrow(/only has stochastic transitions/);
    expect(() => exportApnn(colouredNet())).toThrow(/APNN cannot represent/);
  });
});

describe("PRISM", () => {
  it("writes a CTMC with bounded places and mass-action rates", () => {
    expect(exportPrism(reaction())).toBe(`ctmc

const int Max = 100;
const double k = 0.5;
const int N = 3;

module reaction
  A : [0..Max] init 3;
  B : [0..Max] init 4;
  C : [0..Max] init 0;
  E : [0..Max] init 1;
  [r1] (A >= 1) & (B >= 2) & (E >= 1) & (C <= Max - 1) -> (k) * A * (B * (B - 1) / 2) : (A' = A - 1) & (B' = B - 2) & (C' = C + 1);
endmodule
`);
  });

  it("uses capacities, inhibitor/equal guards, resets and a custom bound", () => {
    const net = reaction();
    net.places[2].capacity = 4;
    net.arcs.push({ id: "5", source: "c", target: "t", kind: "inhibitor", inscription: "3" });
    net.arcs.push({ id: "6", source: "a", target: "t", kind: "reset", inscription: "" });
    net.transitions[0].rate = "k * pow(A, 2) + N^2";
    const text = exportPrism(net, { bound: 10 });
    expect(text).toContain("const int Max = 10;");
    expect(text).toContain("C : [0..4] init 0;");
    expect(text).toContain("(C < 3)");
    expect(text).toContain("(A' = 0)");
    expect(text).toContain("-> k * pow(A, 2) + pow(N, 2) :");
  });

  it("refuses non-stochastic classes and kinds", () => {
    expect(() => exportPrism(reaction("pt"))).toThrow(/PRISM cannot represent/);
    const net = reaction();
    net.transitions[0].kind = "deterministic";
    expect(() => exportPrism(net)).toThrow(/only have exponentially timed/);
    const big = reaction();
    big.places[0].marking = "200";
    expect(() => exportPrism(big)).toThrow(/exceeds its bound 100/);
  });
});

describe("SBML", () => {
  const parser = new DOMParser({ onError: () => {} });

  it("writes species, parameters and reactions with mass-action kinetic laws", () => {
    const xml = exportSbml(reaction("continuous"));
    expect(parser.parseFromString(xml, "text/xml").documentElement?.nodeName).toBe("sbml");
    expect(xml).toContain('<sbml xmlns="http://www.sbml.org/sbml/level2/version4" level="2" version="4">');
    expect(xml).toContain('<species id="A" name="A" compartment="compartment" initialAmount="3" hasOnlySubstanceUnits="true"/>');
    expect(xml).toContain('<parameter id="k" name="k" value="0.5" constant="true"/>');
    expect(xml).toContain('<speciesReference species="B" stoichiometry="2"/>');
    expect(xml).toContain('<modifierSpeciesReference species="E"/>');
    expect(xml.replace(/\s+/g, "")).toContain(
      "<mathxmlns=\"http://www.w3.org/1998/Math/MathML\"><apply><times/><ci>k</ci><ci>A</ci><apply><power/><ci>B</ci><cn>2</cn></apply></apply></math>",
    );
  });

  it("translates arbitrary rate expressions to MathML", () => {
    const net = reaction();
    net.transitions[0].rate = "k * A / (1 + exp(-B))";
    const xml = exportSbml(net).replace(/\s+/g, "");
    expect(xml).toContain(
      "<apply><divide/><apply><times/><ci>k</ci><ci>A</ci></apply><apply><plus/><cn>1</cn><apply><exp/><apply><minus/><ci>B</ci></apply></apply></apply></apply>",
    );
  });

  it("writes P/T nets without kinetic laws", () => {
    expect(exportSbml(reaction("pt"))).not.toContain("kineticLaw");
  });

  it("refuses what SBML cannot express", () => {
    expect(() => exportSbml(xptNet())).toThrow(/SBML has no inhibitor arcs/);
    const net = reaction();
    net.transitions[0].rate = "foo(A)";
    expect(() => exportSbml(net)).toThrow(/SBML has no function "foo"/);
    net.transitions[0].rate = "Z * 2";
    expect(() => exportSbml(net)).toThrow(/"Z", which is neither a place nor a constant/);
    net.transitions[0].rate = "1";
    net.transitions[0].kind = "immediate";
    expect(() => exportSbml(net)).toThrow(/immediate transition "r1"/);
  });
});

describe("CSV declarations", () => {
  it("writes markings, rates and constants", () => {
    expect(exportCsvDeclarations(reaction())).toBe(`Place;Marking
A;N
B;4
C;0
E;1

Transition;Main
r1;MassAction(k)

Constant Class;Main
k;0.5
N;3

`);
  });

  it("leaves out rates of untimed nets and quotes awkward cells", () => {
    const net = reaction("pt");
    net.places[0].name = 'a;"b"';
    const text = exportCsvDeclarations(net);
    expect(text).not.toContain("Transition;Main");
    expect(text).toContain('"a;""b""";N');
  });

  it("refuses fault trees", () => {
    expect(() => exportCsvDeclarations(emptyNet("faultTree", "f"))).toThrow(ExportError);
  });
});
