import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { Net, compile, emptyNet } from "@pns/core";
import { NET_CLASSES, exportPnml, importPnml, importPnmlWithWarnings, netClassFromPnml } from "@pns/io";
import { colouredNet, ptNet, xptNet } from "./fixtures";

// Fatal errors still throw; this only silences xmldom's console logging.
const parser = new DOMParser({ onError: () => {} });
const imp = (xml: string) => importPnml(xml, parser);
const impW = (xml: string) => importPnmlWithWarnings(xml, parser);
const roundTrip = (net: Net) => imp(exportPnml(net));
const errors = (net: Net) => compile(net).problems.filter((p) => p.severity === "error");

describe("PNML export", () => {
  it("writes a ptnet document with names, positions, markings and inscriptions", () => {
    const xml = exportPnml(ptNet());
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<pnml xmlns="http:\/\/www.pnml.org\/version-2009\/grammar\/pnml">/);
    expect(xml).toContain('type="http://www.pnml.org/version-2009/grammar/ptnet"');
    expect(xml).toContain("<text>Producer &amp; &lt;consumer&gt;</text>");
    expect(xml).toContain('<position x="100" y="120.5"/>');
    expect(xml).toMatch(/<initialMarking>\s*<text>3<\/text>\s*<\/initialMarking>/);
    expect(xml).toMatch(/<inscription>\s*<text>2<\/text>\s*<\/inscription>/);
    expect(xml).toContain('<toolspecific tool="Donwinne" version="1">');
    // A marking-dependent weight is not a valid PNML inscription; it goes to the toolspecific block.
    expect(xml).not.toMatch(/<text>buffer \+ 1<\/text>/);
  });

  it("marks non-normal arcs in a toolspecific block", () => {
    const xml = exportPnml(xptNet());
    expect(xml).toContain("<arcType>inhibitor</arcType>");
    expect(xml).toContain("<arcType>reset</arcType>");
    expect(xml).not.toContain("<arcType>normal</arcType>");
  });

  it("writes symmetric nets with text annotations and standard declarations", () => {
    const xml = exportPnml(colouredNet());
    expect(xml).toContain('type="http://www.pnml.org/version-2009/grammar/symmetricnet"');
    expect(xml).toMatch(/<hlinitialMarking>\s*<text>all\(Phil\)<\/text>/);
    expect(xml).toMatch(/<hlinscription>\s*<text>1`\(x, n\) \+\+ 1`\(succ\(x\), n\)<\/text>/);
    expect(xml).toMatch(/<condition>\s*<text>x &lt;&gt; first &amp;&amp; n &lt; 3<\/text>/);
    expect(xml).toMatch(/<namedsort id="cs_Phil" name="Phil">\s*<cyclicenumeration>/);
    expect(xml).toContain('<finiteintrange start="0" end="4"/>');
    expect(xml).toMatch(/<variabledecl id="var_x" name="x">\s*<usersort declaration="cs_Phil"\/>/);
  });

  it("produces well-formed XML even with awkward text", () => {
    const net = ptNet();
    net.name = "a\u0001b ]]> \"'\r\n\t";
    net.places[0].comment = "<![CDATA[ x ]]>";
    const back = roundTrip(net);
    expect(back.name).toBe("ab ]]> \"'\r\n\t");
    expect(back.places[0].comment).toBe("<![CDATA[ x ]]>");
  });

  it("avoids clashes between generated ids and node ids", () => {
    const net = ptNet();
    net.places[0].id = "net";
    net.arcs.forEach((a) => (a.source = a.source === "p1" ? "net" : a.source, a.target = a.target === "p1" ? "net" : a.target));
    net.transitions[0].id = "page";
    net.arcs.forEach((a) => (a.source = a.source === "t1" ? "page" : a.source));
    const xml = exportPnml(net);
    expect(xml).toContain('<net id="net1"');
    expect(xml).toContain('<page id="page1"');
    expect(roundTrip(net)).toEqual(net);
  });
});

describe("PNML round trips", () => {
  it("place/transition net", () => {
    const net = ptNet();
    expect(roundTrip(net)).toEqual(net);
  });

  it("extended net with all five arc kinds", () => {
    const net = xptNet();
    const back = roundTrip(net);
    expect(back).toEqual(net);
    expect(back.arcs.map((a) => a.kind)).toEqual(["normal", "read", "inhibitor", "reset", "equal", "normal"]);
  });

  it("extended net whose arcs are all normal stays extended", () => {
    const net = emptyNet("xpt");
    expect(roundTrip(net)).toEqual(net);
  });

  it("coloured net with declarations", () => {
    const net = colouredNet();
    expect(errors(net)).toEqual([]);
    expect(roundTrip(net)).toEqual(net);
  });

  it("empty nets of every class", () => {
    for (const c of NET_CLASSES) expect(roundTrip(emptyNet(c, ""))).toEqual(emptyNet(c, ""));
  });

  it("hierarchy, kinds, rates, intervals, sounds, colours, label offsets and notes", () => {
    const net = emptyNet("hybrid", "everything");
    net.declarations.constants = [{ name: "k", value: "1", group: "parameter" }];
    net.places = [
      { id: "c", name: "C", x: 0, y: 0, marking: "", coarse: true, color: "#aabbcc", labelOffset: { x: 1, y: -2 }, comment: "coarse" },
      { id: "p", name: "P", x: 0, y: 0, marking: "2.5", continuous: true, parent: "c", logical: true },
    ];
    net.transitions = [
      { id: "t", name: "T", x: 1, y: 2, kind: "deterministic", rate: "3", parent: "c", color: "red", labelOffset: { x: 0, y: 30 } },
      { id: "u", name: "U", x: 1, y: 2, kind: "continuous", rate: "MassAction(k)", interval: ["0", "inf"], sound: { note: "C4", duration: 0.25, instrument: "piano" } },
    ];
    net.arcs = [{ id: "a", source: "p", target: "t", kind: "read", inscription: "0", color: "#ff0000", points: [{ x: 3, y: 4 }] }];
    net.notes = [{ id: "n", x: 5, y: 6, text: "hello <world> & ]]>", parent: "c", color: "#010203" }];
    expect(impW(exportPnml(net))).toEqual({ net, warnings: [] });
  });

  it("modulo nets and coloured quantitative nets", () => {
    const mod = emptyNet("modulo", "m");
    mod.modulus = 7;
    expect(roundTrip(mod)).toEqual(mod);
    const cs = colouredNet();
    cs.netClass = "colouredContinuous";
    cs.transitions[0].rate = "MassAction(2)";
    expect(roundTrip(cs)).toEqual(cs);
  });

  it("fault trees, in a toolspecific block only", () => {
    const ft = emptyNet("extendedFaultTree", "ft");
    ft.faultTree = {
      nodes: [
        { id: "top", name: "Top", x: 0, y: 0, type: "top" },
        { id: "g", name: "G", x: 0, y: 50, type: "kofn", k: 2, parent: "top", comment: "two of three" },
        { id: "b", name: "B", x: 0, y: 100, type: "basic", failureRate: "0.1", repairRate: "mu", probability: "0.5", color: "#000000" },
      ],
      edges: [{ id: "e", source: "b", target: "g", points: [{ x: 0, y: 75 }] }],
    };
    const xml = exportPnml(ft);
    expect(xml).not.toMatch(/<place /);
    expect(xml).toMatch(/<toolspecific[^>]*>[\s\S]*<faultTree>/);
    expect(roundTrip(ft)).toEqual(ft);
  });

  it("exports and imports with the parser class as well as an instance", () => {
    expect(importPnml(exportPnml(ptNet()), DOMParser)).toEqual(ptNet());
  });

  it("produces no warnings for its own files", () => {
    expect(impW(exportPnml(colouredNet())).warnings).toEqual([]);
    expect(impW(exportPnml(xptNet())).warnings).toEqual([]);
  });
});

// A P/T net in the style of TINA / Snoopy / the PNML framework: two pages, a reference place
// on the second page, a reference transition chained through another reference, no tool data.
const THIRD_PARTY = `<?xml version="1.0" encoding="UTF-8"?>
<pnml xmlns="http://www.pnml.org/version-2009/grammar/pnml">
  <net id="n1" type="http://www.pnml.org/version-2009/grammar/ptnet">
    <name><text> Two pages </text></name>
    <toolspecific tool="Tina" version="3.7"><whatever/></toolspecific>
    <page id="pg1">
      <place id="P0">
        <name><text>start</text><graphics><offset x="0" y="-10"/></graphics></name>
        <graphics><position x="40" y="60"/><dimension x="20" y="20"/></graphics>
        <initialMarking><text>2</text></initialMarking>
      </place>
      <transition id="T0">
        <name><text>go</text></name>
        <graphics><position x="140" y="60"/></graphics>
      </transition>
      <arc id="A0" source="P0" target="T0">
        <inscription><text>2</text></inscription>
        <graphics><position x="90" y="40"/></graphics>
      </arc>
      <page id="pg1a">
        <place id="P1"><name><text>end</text></name></place>
      </page>
    </page>
    <page id="pg2">
      <referencePlace id="RP0" ref="P0"/>
      <referenceTransition id="RT1" ref="RT0"/>
      <referenceTransition id="RT0" ref="T0"/>
      <place id="P2"><name><text>side</text></name><initialMarking><text>0</text></initialMarking></place>
      <arc id="A1" source="RT1" target="P1"/>
      <arc id="A2" source="RT0" target="RP0"><inscription><text>1</text></inscription></arc>
      <arc id="A3" source="P2" target="RT0"/>
    </page>
  </net>
</pnml>`;

describe("PNML import from other tools", () => {
  it("flattens pages and resolves reference nodes", () => {
    const { net, warnings } = impW(THIRD_PARTY);
    expect(net.name).toBe("Two pages");
    expect(net.netClass).toBe("pt");
    expect(net.places.map((p) => [p.id, p.name, p.marking])).toEqual([
      ["P0", "start", "2"],
      ["P1", "end", ""],
      ["P2", "side", ""],
    ]);
    expect(net.transitions.map((t) => t.id)).toEqual(["T0"]);
    expect(net.arcs).toEqual([
      { id: "A0", source: "P0", target: "T0", kind: "normal", inscription: "2", points: [{ x: 90, y: 40 }] },
      { id: "A1", source: "T0", target: "P1", kind: "normal", inscription: "1" },
      { id: "A2", source: "T0", target: "P0", kind: "normal", inscription: "1" },
      { id: "A3", source: "P2", target: "T0", kind: "normal", inscription: "1" },
    ]);
    expect(net.places[0]).toMatchObject({ x: 40, y: 60 });
    expect(warnings).toEqual(["2 node(s) had no position and were arranged in a grid below the others."]);
    // P1 and P2 are laid out below the placed nodes, not on top of each other.
    const [, p1, p2] = net.places;
    expect(p1.y).toBeGreaterThan(60);
    expect([p1.x, p1.y]).not.toEqual([p2.x, p2.y]);
    expect(errors(net)).toEqual([]);
  });

  it("lays out a net without any graphics in a grid", () => {
    const xml = `<pnml><net id="n" type="http://www.pnml.org/version-2009/grammar/ptnet"><page id="g">
      <place id="a"/><place id="b"/><transition id="t"/><place id="c"/><place id="d"/></page></net></pnml>`;
    const { net, warnings } = impW(xml);
    const pos = [...net.places, ...net.transitions].map((n) => `${n.x},${n.y}`);
    expect(new Set(pos).size).toBe(5);
    expect(warnings[0]).toMatch(/no layout information/);
    expect(net.places[0].name).toBe("a");
  });

  it("reads PIPE files with inhibitor arcs, values and arc paths", () => {
    const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>
<pnml>
<net id="Net-One" type="P/T net">
<place id="P0">
<graphics><position x="105.0" y="180.0"/></graphics>
<name><value>P0</value><graphics><offset x="0.0" y="0.0"/></graphics></name>
<initialMarking><value>Default,3</value></initialMarking>
<capacity><value>0</value></capacity>
</place>
<place id="P1">
<graphics><position x="405.0" y="180.0"/></graphics>
<name><value>P1</value></name>
<initialMarking><value>Default,0</value></initialMarking>
<capacity><value>4</value></capacity>
</place>
<transition id="T0">
<graphics><position x="255.0" y="180.0"/></graphics>
<name><value>T0</value></name>
</transition>
<arc id="P0 to T0" source="P0" target="T0">
<inscription><value>Default,2</value></inscription>
<arcpath id="000" x="131" y="192" curvePoint="false"/>
<arcpath id="001" x="200" y="150" curvePoint="false"/>
<arcpath id="002" x="251" y="192" curvePoint="false"/>
<type value="normal"/>
</arc>
<arc id="P1 to T0" source="P1" target="T0">
<inscription><value>Default,1</value></inscription>
<type value="inhibitor"/>
</arc>
<arc id="T0 to P1" source="T0" target="P1">
<type value="normal"/>
</arc>
</net>
</pnml>`;
    const { net, warnings } = impW(xml);
    expect(warnings).toEqual([]);
    expect(net.netClass).toBe("xpt");
    expect(net.places).toEqual([
      { id: "P0", name: "P0", x: 105, y: 180, marking: "3" },
      { id: "P1", name: "P1", x: 405, y: 180, marking: "", capacity: 4 },
    ]);
    expect(net.arcs.map((a) => [a.id, a.kind, a.inscription, a.points])).toEqual([
      ["P0 to T0", "normal", "2", [{ x: 200, y: 150 }]],
      ["P1 to T0", "inhibitor", "1", undefined],
      ["T0 to P1", "normal", "1", undefined],
    ]);
  });

  it("reads TINA-style read (test) and reset arc types leniently", () => {
    const xml = `<pnml><net id="n" type="http://www.pnml.org/version-2009/grammar/ptnet"><page id="g">
      <place id="p"><graphics><position x="0" y="0"/></graphics></place>
      <transition id="t"><graphics><position x="1" y="1"/></graphics></transition>
      <arc id="a1" source="p" target="t"><type value="TEST"/></arc>
      <arc id="a2" source="p" target="t"><type><text>reset</text></type></arc>
      <arc id="a3" source="p" target="t"><type value="flux-capacitor"/></arc>
    </page></net></pnml>`;
    const { net, warnings } = impW(xml);
    expect(net.arcs.map((a) => [a.kind, a.inscription])).toEqual([
      ["read", "1"],
      ["reset", ""],
      ["normal", "1"],
    ]);
    expect(net.netClass).toBe("xpt");
    expect(warnings).toEqual(['Unknown arc type "flux-capacitor"; such arcs were imported as normal arcs.']);
  });

  it("drops arcs to missing nodes with a warning", () => {
    const xml = `<pnml><net id="n" type="http://www.pnml.org/version-2009/grammar/ptnet"><page id="g">
      <place id="p"><graphics><position x="0" y="0"/></graphics></place>
      <referencePlace id="r" ref="ghost"/>
      <transition id="t"><graphics><position x="1" y="1"/></graphics></transition>
      <arc id="a1" source="r" target="t"/>
      <arc id="a2" source="p" target="p"/>
    </page></net><net id="other"/></pnml>`;
    const { net, warnings } = impW(xml);
    expect(net.arcs).toEqual([]);
    expect(warnings).toEqual([
      "The file contains 2 nets; only the first one was imported.",
      'The reference node "r" points to "ghost", which does not exist; its arcs were dropped.',
      'Arc "a1" connects nodes that do not exist and was dropped.',
      'Arc "a2" does not connect a place and a transition and was dropped.',
    ]);
  });

  it("imports symmetric nets written by other tools from their structured terms", () => {
    const xml = `<pnml xmlns="http://www.pnml.org/version-2009/grammar/pnml">
<net id="n" type="http://www.pnml.org/version-2009/grammar/symmetricnet">
  <name><text>sn</text></name>
  <declaration><structure><declarations>
    <namedsort id="col" name="Col"><finiteenumeration><feconstant id="col_r" name="r"/><feconstant id="col_g" name="g"/></finiteenumeration></namedsort>
    <namedsort id="rng" name="Rng"><finiteintrange start="1" end="3"/></namedsort>
    <namedsort id="pr" name="Pr"><productsort><usersort declaration="col"/><usersort declaration="rng"/></productsort></namedsort>
    <variabledecl id="vc" name="c"><usersort declaration="col"/></variabledecl>
    <variabledecl id="vd" name="d"><dot/></variabledecl>
  </declarations></structure></declaration>
  <page id="g">
    <place id="p">
      <graphics><position x="0" y="0"/></graphics>
      <type><structure><usersort declaration="col"/></structure></type>
      <hlinitialMarking><structure><add>
        <subterm><numberof><subterm><numberconstant value="2"><positive/></numberconstant></subterm><subterm><useroperator declaration="col_r"/></subterm></numberof></subterm>
        <subterm><numberof><subterm><numberconstant value="1"><positive/></numberconstant></subterm><subterm><useroperator declaration="col_g"/></subterm></numberof></subterm>
      </add></structure></hlinitialMarking>
    </place>
    <place id="q">
      <graphics><position x="0" y="100"/></graphics>
      <type><text>Col</text><structure><usersort declaration="col"/></structure></type>
      <hlinitialMarking><text>1\`g</text><structure><numberof/></structure></hlinitialMarking>
    </place>
    <place id="d">
      <graphics><position x="0" y="200"/></graphics>
      <type><structure><dot/></structure></type>
      <hlinitialMarking><structure><numberof><subterm><numberconstant value="1"/></subterm><subterm><dotconstant/></subterm></numberof></structure></hlinitialMarking>
    </place>
    <transition id="t">
      <graphics><position x="100" y="50"/></graphics>
      <condition><structure><inequality><subterm><variable refvariable="vc"/></subterm><subterm><useroperator declaration="col_g"/></subterm></inequality></structure></condition>
    </transition>
    <arc id="a" source="p" target="t"><hlinscription><structure><numberof><subterm><numberconstant value="1"/></subterm><subterm><variable refvariable="vc"/></subterm></numberof></structure></hlinscription></arc>
    <arc id="b" source="t" target="q"><hlinscription><structure><numberof><subterm><numberconstant value="1"/></subterm><subterm><successor><subterm><variable refvariable="vc"/></subterm></successor></subterm></numberof></structure></hlinscription></arc>
  </page>
</net></pnml>`;
    const { net, warnings } = impW(xml);
    expect(warnings).toEqual([]);
    expect(net.netClass).toBe("coloured");
    expect(net.declarations).toEqual({
      colourSets: [
        { name: "Dot", type: "dot" },
        { name: "Col", type: "enum", values: ["r", "g"] },
        { name: "Rng", type: "int", min: 1, max: 3 },
        { name: "Pr", type: "product", components: ["Col", "Rng"] },
      ],
      variables: [
        { name: "c", colourSet: "Col" },
        { name: "d", colourSet: "Dot" },
      ],
      constants: [],
    });
    expect(net.places.map((p) => [p.colourSet, p.marking])).toEqual([
      ["Col", "2`r ++ 1`g"],
      ["Col", "1`g"],
      ["Dot", "1`dot"],
    ]);
    expect(net.transitions[0].guard).toBe("(c <> g)");
    expect(net.arcs.map((a) => a.inscription)).toEqual(["1`c", "1`succ(c)"]);
    expect(errors(net)).toEqual([]);
  });

  it("falls back to a P/T net with a warning when terms cannot be mapped", () => {
    const xml = `<pnml><net id="n" type="http://www.pnml.org/version-2009/grammar/symmetricnet"><page id="g">
      <place id="p"><graphics><position x="0" y="0"/></graphics>
        <type><structure><dot/></structure></type>
        <hlinitialMarking><structure><add>
          <subterm><numberof><subterm><numberconstant value="3"/></subterm><subterm><dotconstant/></subterm></numberof></subterm>
          <subterm><numberof><subterm><numberconstant value="2"/></subterm><subterm><dotconstant/></subterm></numberof></subterm>
        </add></structure></hlinitialMarking></place>
      <transition id="t"><graphics><position x="1" y="1"/></graphics></transition>
      <arc id="a" source="p" target="t"><hlinscription><structure><cardinalityof><subterm><dotconstant/></subterm></cardinalityof></structure></hlinscription></arc>
    </page></net></pnml>`;
    const { net, warnings } = impW(xml);
    expect(net.netClass).toBe("pt");
    expect(net.places[0]).toMatchObject({ marking: "5" });
    expect(net.places[0].colourSet).toBeUndefined();
    expect(net.arcs[0].inscription).toBe("1");
    expect(net.declarations).toEqual({ colourSets: [], variables: [], constants: [] });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/the term <cardinalityof> in an arc inscription.*imported as a place\/transition net/);
  });
});

describe("netClassFromPnml", () => {
  it("classifies by grammar and arc kinds", () => {
    expect(netClassFromPnml("http://www.pnml.org/version-2009/grammar/ptnet", ["normal"])).toBe("pt");
    expect(netClassFromPnml("http://www.pnml.org/version-2009/grammar/ptnet", ["normal", "inhibitor"])).toBe("xpt");
    expect(netClassFromPnml("http://www.pnml.org/version-2009/grammar/symmetricnet", [])).toBe("coloured");
    expect(netClassFromPnml("http://www.pnml.org/version-2009/grammar/highlevelnet", ["reset"])).toBe("coloured");
    expect(netClassFromPnml(undefined, [])).toBe("pt");
  });
});

describe("PNML import errors", () => {
  it.each([
    ["malformed XML", "<pnml><net>", /not well-formed XML/],
    ["empty input", "", /not well-formed XML/],
    ["wrong root", "<petrinet/>", /root element is <petrinet>, expected <pnml>/],
    ["no net", "<pnml/>", /contains no <net>/],
    [
      "duplicate ids",
      `<pnml><net id="n" type="http://www.pnml.org/version-2009/grammar/ptnet"><page id="g"><place id="x"/><transition id="x"/></page></net></pnml>`,
      /id "x" is used by both/,
    ],
    [
      "reference cycle",
      `<pnml><net id="n" type="ptnet"><page id="g"><place id="p"/><referencePlace id="r1" ref="r2"/><referencePlace id="r2" ref="r1"/><transition id="t"/><arc id="a" source="r1" target="t"/></page></net></pnml>`,
      /refers to itself/,
    ],
  ])("rejects %s", (_, xml, message) => {
    expect(() => imp(xml)).toThrow(message);
  });

  it("rejects dangling arcs in its own files", () => {
    const xml = exportPnml(ptNet()).replace('target="t2"', 'target="nowhere"');
    expect(() => imp(xml)).toThrow(/Arc "a2" refers to "nowhere"/);
  });

  it("explains a missing DOMParser", () => {
    expect(() => importPnml("<pnml/>")).toThrow(/No XML parser/);
  });
});
