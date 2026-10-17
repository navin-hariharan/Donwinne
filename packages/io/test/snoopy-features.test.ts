import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { Net, compile, emptyNet } from "@pns/core";
import {
  ExportError,
  exportAndl,
  exportApnn,
  exportCandl,
  exportLola,
  exportPnml,
  exportPrism,
  exportSbml,
  exportSnoopyWithWarnings,
  exportTina,
  importAndl,
  importPnmlWithWarnings,
  importSnoopy,
  parseNet,
  serializeNet,
  validateNet,
} from "@pns/io";

const parser = new DOMParser({ onError: () => {} });

/** Michaelis-Menten-like net with a modifier arc, a fixed place, a function and observers. */
function enzyme(netClass: Net["netClass"] = "stochastic"): Net {
  const net = emptyNet(netClass, "enzyme");
  net.declarations.constants = [
    { name: "vmax", value: "2" },
    { name: "K", value: "5" },
  ];
  net.declarations.functions = [{ name: "hill", params: ["S", "K", "n"], body: "S^n / (K^n + S^n)" }];
  net.declarations.observers = [
    { name: "total", kind: "place", expression: "S + P" },
    { name: "speed", kind: "transition", expression: "conv" },
  ];
  net.places = [
    { id: "s", name: "S", x: 0, y: 0, marking: "20" },
    { id: "e", name: "E", x: 100, y: 0, marking: "1", fixed: true },
    { id: "p", name: "P", x: 200, y: 0, marking: "" },
  ];
  net.transitions = [{ id: "t", name: "conv", x: 100, y: 100, rate: "vmax * E * hill(S, K, 2)" }];
  net.arcs = [
    { id: "a1", source: "s", target: "t", kind: "normal", inscription: "1" },
    { id: "a2", source: "t", target: "p", kind: "normal", inscription: "1" },
    { id: "a3", source: "e", target: "t", kind: "modifier", inscription: "" },
  ];
  return net;
}

/** Coloured net with every colour set type, a colour function, a coloured modifier arc and an observer. */
function colouredAll(): Net {
  const net = emptyNet("colouredContinuous", "colours");
  net.declarations.colourSets = [
    { name: "Dot", type: "dot" },
    { name: "E", type: "enum", values: ["red", "green"] },
    { name: "I", type: "int", min: 1, max: 6 },
    { name: "B", type: "bool" },
    { name: "S", type: "string", values: ["alpha", "beta"] },
    { name: "U", type: "union", components: ["E", "S"] },
    { name: "Odd", type: "subset", components: ["I"], predicate: "x % 2 = 1" },
    { name: "A", type: "alias", components: ["E"] },
  ];
  net.declarations.variables = [{ name: "x", colourSet: "Odd" }];
  net.declarations.functions = [{ name: "dbl", params: ["x"], body: "2 * x" }];
  net.declarations.observers = [{ name: "all", kind: "place", expression: "P + Q" }];
  net.places = [
    { id: "p", name: "P", x: 0, y: 0, marking: "all(Odd)", colourSet: "Odd" },
    { id: "q", name: "Q", x: 200, y: 0, marking: "", colourSet: "Odd" },
    { id: "m", name: "M", x: 100, y: -100, marking: "red", colourSet: "A", fixed: true },
  ];
  net.transitions = [{ id: "t", name: "t", x: 100, y: 0, rate: "dbl(1) * P" }];
  net.arcs = [
    { id: "a1", source: "p", target: "t", kind: "normal", inscription: "x" },
    { id: "a2", source: "t", target: "q", kind: "normal", inscription: "x" },
    { id: "a3", source: "m", target: "t", kind: "modifier", inscription: "red" },
  ];
  return net;
}

describe("Snoopy files", () => {
  it("round-trip modifier edges, fixed places, functions and observers", () => {
    const net = enzyme();
    const { xml, warnings } = exportSnoopyWithWarnings(net);
    expect(warnings).toEqual([]);
    // A modifier edge has no multiplicity (only a comment).
    const modifier = /<edgeclass count="1" name="Modifier Edge">([\s\S]*?)<\/edgeclass>/.exec(xml)![1];
    expect(modifier).not.toContain("Multiplicity");
    expect(xml).toMatch(/<attribute name="Fixed" id="\d+" net="1">\s*<!\[CDATA\[1\]\]>/);
    expect(xml).toMatch(/<metadataclass count="1" name="Function Class">[\s\S]*?<!\[CDATA\[hill\]\]>[\s\S]*?name="Parameter"[\s\S]*?<!\[CDATA\[S,K,n\]\]>/);
    expect(xml).toMatch(/<metadataclass count="2" name="Oberserver Class">[\s\S]*?<!\[CDATA\[Transition\]\]>/);
    const back = importSnoopy(xml, parser);
    expect(back.warnings).toEqual([]);
    expect(back.net.arcs.find((a) => a.kind === "modifier")).toMatchObject({ inscription: "" });
    expect(back.net.places.find((p) => p.name === "E")!.fixed).toBe(true);
    expect(back.net.places.find((p) => p.name === "S")!.fixed).toBeUndefined();
    expect(back.net.declarations.functions).toEqual(net.declarations.functions);
    expect(back.net.declarations.observers).toEqual(net.declarations.observers);
    expect(compile(back.net).problems).toEqual([]);
  });

  it("round-trip coloured colour sets, colour functions and coloured modifier edges", () => {
    const net = colouredAll();
    expect(compile(net).problems).toEqual([]);
    const { xml, warnings } = exportSnoopyWithWarnings(net);
    expect(warnings).toEqual([]);
    expect(xml).toContain("<![CDATA[double]]>");
    expect(xml).toContain("<![CDATA[int x]]>".replace("int", "Odd"));
    const back = importSnoopy(xml, parser);
    expect(back.warnings).toEqual([]);
    expect(back.net.declarations.colourSets).toEqual(net.declarations.colourSets);
    expect(back.net.declarations.functions).toEqual(net.declarations.functions);
    expect(back.net.declarations.observers).toEqual(net.declarations.observers);
    expect(back.net.arcs.find((a) => a.kind === "modifier")!.inscription).toBe("red");
    expect(back.net.places.find((p) => p.name === "M")!.fixed).toBe(true);
    expect(compile(back.net).problems).toEqual([]);
  });

  it("drop what a class cannot hold, with warnings", () => {
    const net = enzyme("xpt");
    net.transitions[0].rate = undefined;
    const { xml, warnings } = exportSnoopyWithWarnings(net);
    expect(warnings).toContain("A Extended Petri Net cannot have modifier arcs; they were dropped.");
    expect(warnings).toContain("Fixed places only exist in stochastic, continuous and hybrid nets; they were saved as ordinary places.");
    expect(warnings).toContain("Observers only exist in stochastic, continuous and hybrid nets and were dropped.");
    expect(xml).not.toContain("Modifier Edge");
  });

  it("import observers, functions and fixed places written by Snoopy", () => {
    const meta = (cls: string, attrs: [string, string][]) =>
      `<metadataclass count="1" name="${cls}"><metadata id="9" net="1">${attrs
        .map(([n, v]) => `<attribute name="${n}" id="1" net="1"><![CDATA[${v}]]><graphics count="0"/></attribute>`)
        .join("")}<graphics count="0"/></metadata></metadataclass>`;
    const xml = `<?xml version="1.0"?><Snoopy version="2" revision="2.0"><netclass name="Continuous Petri Net"/>
      <nodeclasses count="1"><nodeclass count="1" name="Place, Continuous"><node id="5" net="1">
        <attribute name="Name" id="6" net="1"><![CDATA[X]]><graphics count="0"/></attribute>
        <attribute name="Marking" id="7" net="1"><![CDATA[3]]><graphics count="0"/></attribute>
        <attribute name="Fixed" id="8" net="1"><![CDATA[1]]><graphics count="0"/></attribute>
        <graphics count="1"><graphic x="10" y="10" id="11" net="1" show="1"/></graphics></node></nodeclass></nodeclasses>
      <edgeclasses count="0"/>
      <metadataclasses count="2">
        ${meta("Function Class", [["Name", "sq"], ["ID", "0"], ["Parameter", "double a"], ["Body", "a*a"], ["Return", "double"]])}
        ${meta("Oberserver Class", [["Name", "o"], ["Type", "Place"], ["Body", "sq(X)"], ["ColPNType", "Col|Place"]])}
      </metadataclasses></Snoopy>`;
    const { net, warnings } = importSnoopy(xml, parser);
    expect(warnings).toEqual([]);
    expect(net.places[0].fixed).toBe(true);
    expect(net.declarations.functions).toEqual([{ name: "sq", params: ["a"], body: "a*a" }]);
    expect(net.declarations.observers).toEqual([{ name: "o", kind: "place", expression: "sq(X)" }]);
  });
});

describe("native and PNML files", () => {
  it("keep every new field", () => {
    for (const net of [enzyme(), colouredAll()]) {
      expect(parseNet(serializeNet(net))).toEqual(net);
      const { net: back, warnings } = importPnmlWithWarnings(exportPnml(net), parser);
      expect(warnings).toEqual([]);
      expect(back).toEqual(net);
    }
  });

  it("write union, subset, bool and alias sorts for other PNML tools", () => {
    const xml = exportPnml(colouredAll());
    expect(xml).toMatch(/<namedsort id="cs_B" name="B">\s*<bool\/>/);
    expect(xml).toMatch(/<namedsort id="cs_Odd" name="Odd">\s*<finiteenumeration>\s*<feconstant id="[^"]+" name="1"\/>\s*<feconstant id="[^"]+" name="3"\/>/);
    expect(xml).toMatch(/<namedsort id="cs_A" name="A">\s*<usersort declaration="cs_E"\/>/);
    expect(xml).toContain("<arcType>modifier</arcType>");
  });

  it("validate observers and colour set types", () => {
    const bad = { format: "pns/1", declarations: { observers: [{ name: "o", kind: "colour", expression: "1" }] } };
    expect(() => validateNet(bad)).toThrow(/Observer "o" has unknown kind "colour"/);
    const fixed = { format: "pns/1", places: [{ id: "p", fixed: "yes" }] };
    expect(() => validateNet(fixed)).toThrow(/fixed flag/);
  });
});

describe("text formats", () => {
  it("ANDL writes functions and observers, drops modifier arcs and reads them back", () => {
    const text = exportAndl(enzyme());
    expect(text).toContain("functions:\n  hill(S,K,n) = S^n / (K^n + S^n);\nplaces:");
    expect(text).toContain("observers:\n  place:\n    total = S + P;\n  transition:\n    speed = conv;\n}");
    expect(text).toContain("    conv\n      : \n      : [S - 1] & [P + 1]\n      : vmax * E * hill(S, K, 2)\n");
    const { net, warnings } = importAndl(text);
    expect(warnings).toEqual([]);
    expect(net.declarations.functions).toEqual(enzyme().declarations.functions);
    expect(net.declarations.observers).toEqual(enzyme().declarations.observers);
    expect(importAndl("spn [x] { functions: double f(double a, int b) = a * b; places: P = f(1, 2); }").net.declarations.functions).toEqual([
      { name: "f", params: ["a", "b"], body: "a * b" },
    ]);
  });

  it("CANDL writes the new colour sets, colour functions and observers", () => {
    const net = colouredAll();
    net.declarations.colourSets = net.declarations.colourSets.filter((c) => c.type !== "union");
    const text = exportCandl(net);
    expect(text).toContain("  Bool B = {false,true};");
    expect(text).toContain('  String S = {"alpha","beta"};');
    expect(text).toContain("  Int Odd = I[x % 2 = 1];");
    expect(text).toContain("  Enum A = {red,green};");
    expect(text).toContain("colorfunctions:\n  double dbl(Odd x) { 2 * x };");
    expect(text).toContain("observers:\n  place:\n    all = P + Q;");
    expect(() => exportCandl(colouredAll())).toThrow(/CANDL has no union colour sets/);
  });

  it("SBML writes modifiers, boundary species, function definitions and observer rules", () => {
    const xml = exportSbml(enzyme("continuous"));
    expect(xml).toContain('<modifierSpeciesReference species="E"/>');
    expect(xml).toContain('<species id="E" name="E" compartment="compartment" initialAmount="1" hasOnlySubstanceUnits="true" boundaryCondition="true"/>');
    const flat = xml.replace(/\s+/g, "");
    expect(flat).toContain('<functionDefinitionid="hill"><mathxmlns="http://www.w3.org/1998/Math/MathML"><lambda><bvar><ci>S</ci></bvar>');
    expect(flat).toContain("<apply><ci>hill</ci><ci>S</ci><ci>K</ci><cn>2</cn></apply>");
    expect(xml).toContain('<parameter id="total" name="total" constant="false"/>');
    expect(flat).toContain('<assignmentRulevariable="total"><mathxmlns="http://www.w3.org/1998/Math/MathML"><apply><plus/><ci>S</ci><ci>P</ci></apply>');
    // A transition observer stands for the reaction's kinetic law.
    expect(flat).toMatch(/<assignmentRulevariable="speed"><mathxmlns="[^"]+"><apply><times\/><apply><times\/><ci>vmax<\/ci><ci>E<\/ci><\/apply><apply><ci>hill<\/ci>/);
  });

  it("SBML expands functions whose bodies use model names", () => {
    const net = enzyme("continuous");
    net.declarations.functions = [{ name: "hill", params: ["S", "K", "n"], body: "vmax * S^n / (K^n + S^n)" }];
    const flat = exportSbml(net).replace(/\s+/g, "");
    expect(flat).not.toContain("functionDefinition");
    expect(flat).toContain("<ci>vmax</ci>");
  });

  it("LoLA, TINA and APNN drop modifier arcs; PRISM and APNN expand functions; PRISM keeps fixed places", () => {
    const net = enzyme();
    expect(exportLola(net)).toContain("TRANSITION conv\n  CONSUME S : 1;\n  PRODUCE P : 1;");
    expect(exportTina(net)).toContain("tr conv S -> P");
    const apnn = exportApnn(net);
    expect(apnn).toContain("\\function{vmax * E * (S^2 / (K^2 + S^2))}");
    expect(apnn).not.toContain("\\from{P_1}");
    const prism = exportPrism(net);
    expect(prism).toContain("[conv] (S >= 1) & (P <= Max - 1) -> vmax * E * (pow(S, 2) / (pow(K, 2) + pow(S, 2))) : (S' = S - 1) & (P' = P + 1);");
    const fixedS = enzyme();
    fixedS.places[0].fixed = true;
    expect(exportPrism(fixedS)).toContain(": (P' = P + 1);");
  });

  it("report recursive functions instead of looping", () => {
    const net = enzyme();
    net.declarations.functions = [{ name: "hill", params: ["S", "K", "n"], body: "hill(S, K, n)" }];
    expect(() => exportPrism(net)).toThrow(ExportError);
    expect(() => exportPrism(net)).toThrow(/recursion/);
  });
});
