import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { Net, compile } from "@pns/core";
import { exportPnml, exportSnoopyWithWarnings, importPnml, importSnoopy, parseNet, serializeNet, snoopyExtension } from "@pns/io";

const parser = new DOMParser({ onError: () => {} });

/** Konios Fig. 3.1 as an APN with a gluing place. */
function apn(): Net {
  return {
    format: "pns/1",
    name: "Konios Fig. 3.1",
    netClass: "apn",
    comment: "An APN",
    places: [
      { id: "p1", name: "p1", x: 100, y: 100, marking: "b ++ w", colourSet: "BW", gluing: true },
      { id: "p2", name: "p2", x: 200, y: 100, marking: "b ++ w", colourSet: "BW" },
      { id: "p3", name: "p3", x: 100, y: 300, marking: "", colourSet: "BW" },
      { id: "p5", name: "p5", x: 300, y: 300, marking: "w", colourSet: "W" },
    ],
    transitions: [{ id: "t", name: "t", x: 200, y: 200 }],
    arcs: [
      { id: "a1", source: "p1", target: "t", kind: "normal", inscription: "x" },
      { id: "a2", source: "p2", target: "t", kind: "normal", inscription: "x" },
      { id: "a3", source: "t", target: "p3", kind: "normal", inscription: "x" },
      { id: "a4", source: "p5", target: "t", kind: "inhibitor", inscription: "x" },
    ],
    declarations: {
      colourSets: [
        { name: "Dot", type: "dot" },
        { name: "BW", type: "enum", values: ["b", "w"] },
        { name: "W", type: "enum", values: ["w"] },
      ],
      variables: [{ name: "x", colourSet: "BW" }],
      constants: [],
    },
  };
}

/** Konios Fig. 5.1 as a T-APN with a complementary colour set. */
function tapn(): Net {
  const n = apn();
  n.netClass = "tapn";
  n.comment = undefined;
  n.declarations.colourSets.push({ name: "BW_bar", type: "enum", values: ["g", "l"], complementOf: "BW" });
  n.declarations.variables.push({ name: "x_bar", colourSet: "BW_bar" });
  n.places[3] = { ...n.places[3], colourSet: "BW_bar", marking: "g" };
  n.arcs[3] = { ...n.arcs[3], kind: "normal", inscription: "x_bar" };
  n.transitions[0].guard = "x = b and x_bar = g or x = w and x_bar = l";
  return n;
}

describe("APN and T-APN files", () => {
  it("Def. 3, Def. 20: the native format keeps gluing places and complementary colour sets", () => {
    for (const n of [apn(), tapn()]) expect(parseNet(serializeNet(n))).toEqual(n);
  });

  it("Def. 3: a Snoopy round trip keeps the APN class, its gluing places and inhibitor arcs", () => {
    const { xml, warnings } = exportSnoopyWithWarnings(apn());
    expect(warnings).toEqual([]);
    expect(xml).toContain('<netclass name="Colored Extended Petri Net"/>');
    expect(snoopyExtension("apn", apn())).toBe("colxpn");
    const back = importSnoopy(xml, parser).net;
    expect(back.netClass).toBe("apn");
    expect(back.comment).toBe("An APN");
    expect(back.places.filter((p) => p.gluing).map((p) => p.name)).toEqual(["p1"]);
    expect(back.arcs.find((a) => a.kind === "inhibitor")?.inscription).toBe("x");
    expect(compile(back).problems).toEqual([]);
  });

  it("Def. 20: a Snoopy round trip keeps the T-APN class and its complementary colour set", () => {
    const { xml } = exportSnoopyWithWarnings(tapn());
    expect(xml).toContain('<netclass name="Colored Petri Net"/>');
    const back = importSnoopy(xml, parser).net;
    expect(back.netClass).toBe("tapn");
    expect(back.comment).toBeUndefined();
    expect(back.declarations.colourSets.find((c) => c.name === "BW_bar")?.complementOf).toBe("BW");
    expect(compile(back).problems).toEqual([]);
  });

  it("Def. 3, Def. 20: PNML keeps the class, gluing places and complementary colour sets", () => {
    const a = importPnml(exportPnml(apn()), parser);
    expect(a.netClass).toBe("apn");
    expect(a.places.find((p) => p.name === "p1")?.gluing).toBe(true);
    const t = importPnml(exportPnml(tapn()), parser);
    expect(t.netClass).toBe("tapn");
    expect(t.declarations.colourSets.find((c) => c.name === "BW_bar")?.complementOf).toBe("BW");
  });
});
