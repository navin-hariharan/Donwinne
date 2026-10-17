import { describe, expect, it } from "vitest";
import { Net, arcKindsFor, arcVariable, compile, complementsOf, enabledBindings, fire, initialMarking } from "@pns/core";

function fig31(): Net {
  return {
    format: "pns/1",
    name: "Konios Fig. 3.1",
    netClass: "apn",
    places: [
      { id: "p1", name: "p1", x: 0, y: 0, marking: "b ++ w", colourSet: "BW" },
      { id: "p3", name: "p3", x: 0, y: 100, marking: "b", colourSet: "BW" },
      { id: "p5", name: "p5", x: 100, y: 100, marking: "w", colourSet: "W" },
    ],
    transitions: [{ id: "t", name: "t", x: 50, y: 50 }],
    arcs: [
      { id: "a1", source: "p1", target: "t", kind: "normal", inscription: "x" },
      { id: "a2", source: "t", target: "p3", kind: "normal", inscription: "x" },
      { id: "a3", source: "p5", target: "t", kind: "inhibitor", inscription: "x" },
    ],
    declarations: {
      colourSets: [
        { name: "BW", type: "enum", values: ["b", "w"] },
        { name: "W", type: "enum", values: ["w"] },
      ],
      variables: [{ name: "x", colourSet: "BW" }],
      constants: [],
    },
  };
}

describe("Ambient net classes in core", () => {
  it("Def. 3 and Def. 20: APNs allow directed and inhibitor arcs, T-APNs directed arcs only", () => {
    expect(arcKindsFor("apn")).toEqual(["normal", "inhibitor"]);
    expect(arcKindsFor("tapn")).toEqual(["normal"]);
  });

  it("Def. 3: an arc of weight 1 per colour is inscribed with a single variable", () => {
    expect(arcVariable("x")).toBe("x");
    expect(arcVariable(" 1`x ")).toBe("x");
    expect(arcVariable("2`x")).toBeNull();
    expect(arcVariable("x ++ y")).toBeNull();
    expect(arcVariable("")).toBeNull();
  });

  it("Sec. 3.2: the interleaving token game uses capacity 1 per colour and the colour-sensitive inhibitor arc", () => {
    const cn = compile(fig31());
    expect(cn.problems).toEqual([]);
    expect(cn.places.map((p) => p.capacity)).toEqual([1, 1, 1]);
    const M0 = initialMarking(cn);
    // Mode w is blocked by the inhibitor place p5; mode b by p3's capacity of one b token.
    expect(enabledBindings(cn, 0, M0).bindings).toEqual([]);
    const free = fig31();
    free.places[1].marking = "";
    const cn2 = compile(free);
    expect(enabledBindings(cn2, 0, initialMarking(cn2)).bindings).toEqual([{ x: "b" }]);
    expect(fire(cn2, 0, { x: "b" }, initialMarking(cn2))[1].toString()).toBe("b");
  });

  it("Def. 20: complementOf pairs the values of two colour sets in order", () => {
    const c = complementsOf(
      [
        { name: "BW", type: "enum", values: ["b", "w"] },
        { name: "GL", type: "enum", values: ["g", "l"], complementOf: "BW" },
      ],
      new Map([
        ["BW", ["b", "w"]],
        ["GL", ["g", "l"]],
      ]),
    );
    expect(c.problems).toEqual([]);
    expect(c.f.get('"w"')).toBe("l");
    expect(c.inverse.get('"g"')).toBe("b");
    expect([...c.specialSets]).toEqual(["GL"]);
  });

  it("Def. 3: problems name the element they are about", () => {
    const n = fig31();
    n.arcs.push({ id: "a4", source: "p1", target: "t", kind: "inhibitor", inscription: "x" });
    const p = compile(n).problems.find((x) => /inhibitor arc and a directed arc/.test(x.message));
    expect(p).toMatchObject({ severity: "error", elementId: "a4", message: "Place p1 has both an inhibitor arc and a directed arc to or from transition t; Konios Def. 3 does not allow both" });
  });
});
