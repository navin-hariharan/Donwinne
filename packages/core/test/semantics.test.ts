import { describe, expect, it } from "vitest";
import { Arc, ArcKind, Net, compile, disabledReasons, emptyNet, enabledBindings, fire, initialMarking, parse, showTokens } from "@pns/core";

function ptNet(
  netClass: Net["netClass"],
  places: [string, string, number?][],
  transitions: string[],
  arcs: [string, string, string, ArcKind?][],
): Net {
  const net = emptyNet(netClass);
  net.places = places.map(([name, marking, capacity]) => ({ id: name, name, x: 0, y: 0, marking, capacity }));
  net.transitions = transitions.map((name) => ({ id: name, name, x: 0, y: 0 }));
  net.arcs = arcs.map(([source, target, inscription, kind], i): Arc => ({ id: `a${i}`, source, target, inscription, kind: kind ?? "normal" }));
  return net;
}

function tokens(net: Net, firings: string[] = []) {
  const cn = compile(net);
  let M = initialMarking(cn);
  for (const name of firings) {
    const t = cn.transitions.findIndex((x) => x.name === name);
    const { bindings } = enabledBindings(cn, t, M);
    if (!bindings.length) throw new Error(`${name} not enabled`);
    M = fire(cn, t, bindings[0], M);
  }
  return Object.fromEntries(cn.places.map((p) => [p.name, showTokens(cn, M[p.slot])]));
}

function enabled(net: Net) {
  const cn = compile(net);
  const M = initialMarking(cn);
  return cn.transitions.filter((t) => enabledBindings(cn, t.index, M).bindings.length > 0).map((t) => t.name);
}

describe("expressions", () => {
  it("parses multisets with coefficients", () => {
    expect(parse("2`a ++ b")).toMatchObject({ k: "bin", op: "++" });
  });
  it("rejects garbage", () => {
    expect(() => parse("2 +")).toThrow();
    expect(() => parse("a b")).toThrow();
  });
});

describe("place/transition nets", () => {
  it("fires with weights", () => {
    const net = ptNet("pt", [["p1", "3"], ["p2", ""]], ["t"], [["p1", "t", "2"], ["t", "p2", "1"]]);
    expect(tokens(net, ["t"])).toEqual({ p1: "1", p2: "1" });
    expect(() => tokens(net, ["t", "t"])).toThrow();
  });
  it("respects capacity", () => {
    const net = ptNet("pt", [["p1", "1"], ["p2", "1", 1]], ["t"], [["p1", "t", "1"], ["t", "p2", "1"]]);
    expect(enabled(net)).toEqual([]);
  });
});

describe("extended arcs", () => {
  it("read arcs test without consuming", () => {
    const net = ptNet("xpt", [["p", "1"], ["q", ""]], ["t"], [["p", "t", "1", "read"], ["t", "q", "1"]]);
    expect(tokens(net, ["t", "t"])).toEqual({ p: "1", q: "2" });
  });
  it("inhibitor arcs block at or above the weight", () => {
    const blocked = ptNet("xpt", [["p", "2"]], ["t"], [["p", "t", "2", "inhibitor"]]);
    const free = ptNet("xpt", [["p", "1"]], ["t"], [["p", "t", "2", "inhibitor"]]);
    expect(enabled(blocked)).toEqual([]);
    expect(enabled(free)).toEqual(["t"]);
  });
  it("equal arcs need exactly the weight", () => {
    expect(enabled(ptNet("xpt", [["p", "2"]], ["t"], [["p", "t", "2", "equal"]]))).toEqual(["t"]);
    expect(enabled(ptNet("xpt", [["p", "3"]], ["t"], [["p", "t", "2", "equal"]]))).toEqual([]);
  });
  it("reset arcs empty the place", () => {
    const net = ptNet("xpt", [["p", "5"], ["q", ""]], ["t"], [["p", "t", "", "reset"], ["t", "q", "1"]]);
    expect(tokens(net, ["t"])).toEqual({ p: "0", q: "1" });
  });
  it("marking-dependent weights read other places", () => {
    const net = ptNet("xpt", [["p", "4"], ["n", "3"], ["q", ""]], ["t"], [["p", "t", "n", "normal"], ["t", "q", "n * 2"]]);
    expect(tokens(net, ["t"])).toEqual({ p: "1", n: "3", q: "6" });
  });
});

describe("coloured nets", () => {
  function colNet(): Net {
    const net = emptyNet("coloured");
    net.declarations.colourSets.push({ name: "Col", type: "enum", values: ["b", "w"] });
    net.declarations.variables.push({ name: "x", colourSet: "Col" });
    return net;
  }

  it("binds variables from tokens", () => {
    const net = colNet();
    net.places = [
      { id: "p1", name: "p1", x: 0, y: 0, marking: "b ++ w", colourSet: "Col" },
      { id: "p2", name: "p2", x: 0, y: 0, marking: "", colourSet: "Col" },
    ];
    net.transitions = [{ id: "t", name: "t", x: 0, y: 0 }];
    net.arcs = [
      { id: "a1", source: "p1", target: "t", kind: "normal", inscription: "x" },
      { id: "a2", source: "t", target: "p2", kind: "normal", inscription: "x" },
    ];
    const cn = compile(net);
    expect(cn.problems).toEqual([]);
    const M = initialMarking(cn);
    const { bindings } = enabledBindings(cn, 0, M);
    expect(bindings).toEqual([{ x: "b" }, { x: "w" }]);
    const M2 = fire(cn, 0, { x: "w" }, M);
    expect(M2[0].toString()).toBe('b');
    expect(M2[1].toString()).toBe('w');
  });

  it("guards filter bindings", () => {
    const net = colNet();
    net.places = [{ id: "p1", name: "p1", x: 0, y: 0, marking: "b ++ w", colourSet: "Col" }];
    net.transitions = [{ id: "t", name: "t", x: 0, y: 0, guard: "x = w" }];
    net.arcs = [{ id: "a1", source: "p1", target: "t", kind: "normal", inscription: "x" }];
    const cn = compile(net);
    expect(enabledBindings(cn, 0, initialMarking(cn)).bindings).toEqual([{ x: "w" }]);
  });

  it("colour-sensitive inhibitor arcs block only the matching colour (thesis Fig. 3.1)", () => {
    // Fig. 3.1: Pre(t) = {p1, p2}, Post(t) = {p3, p4}, inhibitor (p5, t), p5 holds w.
    const net = colNet();
    const pl = (name: string, marking: string) => ({ id: name, name, x: 0, y: 0, marking, colourSet: "Col", capacity: 1 });
    net.places = [pl("p1", "b ++ w"), pl("p2", "b ++ w"), pl("p3", ""), pl("p4", ""), pl("p5", "w")];
    net.transitions = [{ id: "t", name: "t", x: 0, y: 0 }];
    net.arcs = [
      { id: "a1", source: "p1", target: "t", kind: "normal", inscription: "x" },
      { id: "a2", source: "p2", target: "t", kind: "normal", inscription: "x" },
      { id: "a3", source: "t", target: "p3", kind: "normal", inscription: "x" },
      { id: "a4", source: "t", target: "p4", kind: "normal", inscription: "x" },
      { id: "a5", source: "p5", target: "t", kind: "inhibitor", inscription: "x" },
    ];
    const cn = compile(net);
    expect(cn.problems).toEqual([]);
    const M = initialMarking(cn);
    expect(enabledBindings(cn, 0, M).bindings).toEqual([{ x: "b" }]);
    const M2 = fire(cn, 0, { x: "b" }, M);
    expect(M2.map((m) => m.toString())).toEqual(["w", "w", "b", "b", "w"]);
    expect(enabledBindings(cn, 0, M2).bindings).toEqual([]);
  });

  it("supports products, integers, all() and dot places", () => {
    const net = emptyNet("coloured");
    net.declarations.colourSets.push(
      { name: "N", type: "int", min: 1, max: 3 },
      { name: "C", type: "enum", values: ["r", "g"] },
      { name: "NC", type: "product", components: ["N", "C"] },
    );
    net.declarations.variables.push({ name: "n", colourSet: "N" }, { name: "c", colourSet: "C" });
    net.places = [
      { id: "a", name: "a", x: 0, y: 0, marking: "all(N)", colourSet: "N" },
      { id: "b", name: "b", x: 0, y: 0, marking: "", colourSet: "NC" },
      { id: "d", name: "d", x: 0, y: 0, marking: "2", colourSet: "Dot" },
    ];
    net.transitions = [{ id: "t", name: "t", x: 0, y: 0, guard: "n > 1" }];
    net.arcs = [
      { id: "1", source: "a", target: "t", kind: "normal", inscription: "n" },
      { id: "2", source: "d", target: "t", kind: "normal", inscription: "1" },
      { id: "3", source: "t", target: "b", kind: "normal", inscription: "(n, r) ++ (n, g)" },
    ];
    const cn = compile(net);
    expect(cn.problems).toEqual([]);
    const M = initialMarking(cn);
    expect(enabledBindings(cn, 0, M).bindings.map((b) => b.n)).toEqual([2, 3]);
    const M2 = fire(cn, 0, { n: 3 }, M);
    expect(M2[1].toString()).toBe('(3,g)++(3,r)');
    expect(M2[2].size).toBe(1);
  });

  it("reports unknown names", () => {
    const net = colNet();
    net.places = [{ id: "p", name: "p", x: 0, y: 0, marking: "purple", colourSet: "Col" }];
    expect(compile(net).problems.map((p) => p.elementId)).toContain("p");
  });
});

describe("logical places", () => {
  it("share one marking", () => {
    const net = ptNet("pt", [["p", "1"], ["q", ""]], ["t"], [["p", "t", "1"], ["t", "q", "1"]]);
    net.places.push({ id: "p-copy", name: "p", x: 0, y: 0, marking: "1", logical: true });
    net.places[0].logical = true;
    const cn = compile(net);
    expect(cn.slotCount).toBe(2);
  });
});

describe("why a transition cannot fire", () => {
  const why = (net: Net, name = "t") => {
    const cn = compile(net);
    return disabledReasons(cn, cn.transitions.findIndex((x) => x.name === name), initialMarking(cn));
  };
  it("is empty when the transition is enabled", () => {
    expect(why(ptNet("pt", [["p", "1"]], ["t"], [["p", "t", "1"]]))).toEqual([]);
  });
  it("names the place that is short of tokens", () => {
    expect(why(ptNet("pt", [["p", "1"]], ["t"], [["p", "t", "2"]]))).toEqual(["p has 1 token, needs 2"]);
  });
  it("names a blocking inhibitor arc", () => {
    const r = why(ptNet("xpt", [["p", "1"], ["q", "2"]], ["t"], [["p", "t", "1"], ["q", "t", "1", "inhibitor"]]));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/inhibitor arc from q blocks it/);
  });
  it("names a full output place", () => {
    expect(why(ptNet("pt", [["p1", "1"], ["p2", "1", 1]], ["t"], [["p1", "t", "1"], ["t", "p2", "1"]]))).toEqual([
      "firing would put 2 tokens on p2, over its capacity of 1",
    ]);
  });
  it("names a false guard", () => {
    const net = ptNet("coloured", [["p", "1`dot"]], ["t"], [["p", "t", "1`dot"]]);
    net.transitions[0].guard = "1 > 3";
    expect(why(net)).toEqual(["its guard is false"]);
  });
});

describe("arc problems", () => {
  it("name the arc by its ends rather than its id", () => {
    const net = ptNet("pt", [["buffer", "1"], ["out", ""]], ["take"], [["buffer", "take", "0"], ["take", "out", "-1"], ["buffer", "take", "0"], ["take", "out", "1.5"]]);
    net.places[0].name = "Buffer";
    const ps = compile(net).problems;
    const of = (id: string) => ps.filter((p) => p.elementId === id).map((p) => p.message);
    expect(of("a0")).toEqual(["Arc Buffer → take: weight 0 has no effect"]);
    expect(of("a1")).toEqual(["Arc take → out: the weight -1 is negative"]);
    expect(of("a2")).toContain("Arc Buffer → take: another arc of the same kind joins the same nodes");
    expect(of("a3")).toContain("Arc take → out: arc weights move whole tokens; 1.5 is not a whole number");
    expect(ps.every((p) => !/\ba\d\b/.test(p.message))).toBe(true);
  });
});
