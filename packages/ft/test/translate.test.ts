import { describe, expect, it } from "vitest";
import { Marking, Net, compile, enabledBindings, fire, initialMarking } from "@pns/core";
import {
  exportDnf,
  faultTreeToPetriNet,
  importDnf,
  layoutFaultTree,
  minimalCutSets,
  parseDnf,
  simulateFaultTree,
  topEventProbability,
  reliabilityCurve,
  validateFaultTree,
  FTError,
} from "@pns/ft";
import { p, rate, tree } from "./helpers";

/** Token game on a translated net: fire named transitions, settling immediate transitions after each. */
function play(pn: Net) {
  const cn = compile(pn);
  expect(cn.problems.filter((x) => x.severity === "error")).toEqual([]);
  let M: Marking = initialMarking(cn);
  const kindOf = new Map(pn.transitions.map((t) => [t.id, t.kind]));
  const tryFire = (i: number) => {
    const { bindings } = enabledBindings(cn, i, M);
    if (!bindings.length) return false;
    M = fire(cn, i, bindings[0], M);
    return true;
  };
  const settle = () => {
    for (let guard = 0; guard < 1000; guard++) {
      const i = cn.transitions.findIndex((t, i) => kindOf.get(t.id) === "immediate" && enabledBindings(cn, i, M).bindings.length > 0);
      if (i < 0) return;
      tryFire(i);
    }
    throw new Error("immediate transitions do not settle");
  };
  settle();
  return {
    fire(name: string) {
      const i = cn.transitions.findIndex((t) => t.name === name);
      expect(i, name).toBeGreaterThanOrEqual(0);
      expect(tryFire(i), `${name} enabled`).toBe(true);
      settle();
    },
    enabled(name: string) {
      const i = cn.transitions.findIndex((t) => t.name === name);
      return enabledBindings(cn, i, M).bindings.length > 0;
    },
    tokens(name: string) {
      const pl = cn.places.find((x) => x.name === name)!;
      expect(pl, name).toBeDefined();
      return M[pl.slot].size;
    },
  };
}

const twoOfThree = () =>
  tree(
    [["TOP", "top"], ["G", "kofn", { k: 2 }], ["A", "basic", rate(1e-3, 0.1)], ["B", "basic", rate(1e-3, 0.1)], ["C", "basic", rate(1e-3, 0.1)]],
    [["G", "TOP"], ["A", "G"], ["B", "G"], ["C", "G"]],
    "extendedFaultTree",
  );

describe("fault tree to Petri net", () => {
  it("translates a 2-out-of-3 system into a valid stochastic net that behaves like the tree", () => {
    const pn = faultTreeToPetriNet(twoOfThree());
    expect(pn.netClass).toBe("stochastic");
    const g = play(pn);
    expect(g.tokens("TOP_failed")).toBe(0);
    expect(g.tokens("TOP_ok")).toBe(1);
    g.fire("A_fail");
    expect(g.tokens("TOP_failed")).toBe(0);
    g.fire("C_fail");
    expect(g.tokens("G_failed")).toBe(1);
    expect(g.tokens("TOP_failed")).toBe(1);
    g.fire("A_repair");
    expect(g.tokens("TOP_failed")).toBe(0);
    expect(pn.transitions.find((t) => t.name === "A_fail")!.rate).toBe("0.001");
    // Laid out top-down: the top event above its gate above the basic events.
    const y = (n: string) => pn.places.find((x) => x.name === n)!.y;
    expect(y("TOP_ok")).toBeLessThan(y("G_ok"));
    expect(y("G_ok")).toBeLessThan(y("A_ok"));
  });

  it("translates every static gate kind and probability events", () => {
    const net = tree(
      [
        ["T", "top"],
        ["OR", "or"],
        ["X", "xor"],
        ["N", "not"],
        ["I", "inhibit"],
        ["A", "basic", rate(0.01)],
        ["B", "basic", rate(0.01)],
        ["C", "basic", p(0.3)],
        ["D", "basic", rate(0.01)],
      ],
      [["OR", "T"], ["X", "OR"], ["I", "OR"], ["A", "X"], ["B", "X"], ["N", "I"], ["C", "N"], ["D", "I"]],
    );
    const pn = faultTreeToPetriNet(net);
    const g = play(pn);
    // C starts undecided; the settling token game takes the first choice, "C occurs".
    expect(g.tokens("C_init")).toBe(0);
    expect(g.tokens("C_failed")).toBe(1);
    expect(g.tokens("N_failed")).toBe(0); // NOT C
    expect(g.tokens("T_failed")).toBe(0);
    g.fire("A_fail");
    expect(g.tokens("X_failed")).toBe(1);
    expect(g.tokens("T_failed")).toBe(1);
    g.fire("B_fail");
    expect(g.tokens("X_failed")).toBe(0);
    expect(g.tokens("T_failed")).toBe(0);
    g.fire("D_fail");
    expect(g.tokens("I_failed")).toBe(0); // the condition NOT C does not hold
    expect(g.tokens("T_failed")).toBe(0);
    const init = pn.places.find((x) => x.name === "C_init")!;
    expect(init.marking).toBe("1");
    expect(pn.transitions.find((t) => t.name === "C_not_occurs")!.rate).toBe("1 - (0.3)");
    expect(pn.transitions.find((t) => t.name === "C_occurs")!.kind).toBe("immediate");
  });

  it("translates PAND, SPARE and FDEP gates", () => {
    const pand = tree(
      [["T", "top"], ["P", "pand"], ["A", "basic", rate(0.01, 0.1)], ["B", "basic", rate(0.01, 0.1)]],
      [["P", "T"], ["A", "P"], ["B", "P"]],
      "extendedFaultTree",
    );
    let g = play(faultTreeToPetriNet(pand));
    g.fire("B_fail");
    g.fire("A_fail");
    expect(g.tokens("T_failed")).toBe(0); // out of order
    g.fire("A_repair");
    g.fire("B_repair");
    g.fire("A_fail");
    g.fire("B_fail");
    expect(g.tokens("T_failed")).toBe(1); // in order
    g.fire("B_repair");
    expect(g.tokens("T_failed")).toBe(0);
    g.fire("B_fail");
    expect(g.tokens("T_failed")).toBe(1);

    const spare = tree(
      [["T", "top"], ["S", "spare"], ["P", "basic", rate(0.01)], ["Q", "basic", rate(0.01)]],
      [["S", "T"], ["P", "S"], ["Q", "S"]],
      "extendedFaultTree",
    );
    g = play(faultTreeToPetriNet(spare));
    expect(g.enabled("Q_fail")).toBe(false); // cold spare is dormant
    g.fire("P_fail");
    expect(g.tokens("S_use_Q")).toBe(1);
    expect(g.tokens("T_failed")).toBe(0);
    g.fire("Q_fail");
    expect(g.tokens("T_failed")).toBe(1);

    const fdep = tree(
      [["T", "top"], ["G", "and"], ["F", "fdep"], ["Trig", "basic", rate(0.01)], ["A", "basic", rate(0.01)], ["B", "basic", rate(0.01)]],
      [["G", "T"], ["A", "G"], ["B", "G"], ["Trig", "F"], ["A", "F"], ["B", "F"]],
      "extendedFaultTree",
    );
    fdep.faultTree!.nodes.find((n) => n.id === "Trig")!.x = -100; // trigger is the leftmost input
    g = play(faultTreeToPetriNet(fdep));
    g.fire("Trig_fail");
    expect(g.tokens("A_eff_failed")).toBe(1);
    expect(g.tokens("T_failed")).toBe(1);
  });
});

describe("Monte Carlo simulation of dynamic gates", () => {
  const within = (r: { probability: number[]; standardError: number[] }, i: number, exact: number) =>
    expect(Math.abs(r.probability[i] - exact)).toBeLessThan(4 * Math.max(r.standardError[i], 1e-3));

  it("agrees with the BDD on a static tree and is deterministic", () => {
    const net = twoOfThree();
    const times = [10, 100, 1000];
    const r = simulateFaultTree(net, { times, runs: 20000, seed: 7 });
    times.forEach((t, i) => within(r, i, topEventProbability(net, { time: t })));
    expect(simulateFaultTree(net, { times, runs: 2000, seed: 3 })).toEqual(simulateFaultTree(net, { times, runs: 2000, seed: 3 }));
  });

  it("PAND: A must fail before B", () => {
    const l1 = 0.01;
    const l2 = 0.02;
    const net = tree(
      [["T", "top"], ["P", "pand"], ["A", "basic", rate(l1)], ["B", "basic", rate(l2)]],
      [["P", "T"], ["A", "P"], ["B", "P"]],
      "extendedFaultTree",
    );
    const t = 100;
    const exact = (l1 / (l1 + l2)) * (1 - Math.exp(-(l1 + l2) * t)) - Math.exp(-l2 * t) * (1 - Math.exp(-l1 * t));
    const q = topEventProbability(net, { time: t, runs: 40000, seed: 11 });
    expect(Math.abs(q - exact)).toBeLessThan(0.01);
    // The static reading (AND) overestimates.
    const stat = topEventProbability(net, { time: t, method: "static" });
    expect(stat).toBeCloseTo((1 - Math.exp(-l1 * t)) * (1 - Math.exp(-l2 * t)), 12);
    expect(stat).toBeGreaterThan(exact);
  });

  it("cold SPARE: Erlang distributed lifetime", () => {
    const l = 0.01;
    const net = tree(
      [["T", "top"], ["S", "spare"], ["P", "basic", rate(l)], ["Q", "basic", rate(l)]],
      [["S", "T"], ["P", "S"], ["Q", "S"]],
      "extendedFaultTree",
    );
    const curve = reliabilityCurve(net, { end: 300, points: 4, runs: 30000, seed: 5 });
    expect(curve.method).toBe("monteCarlo");
    curve.times.forEach((t, i) => within({ probability: curve.unreliability, standardError: curve.standardError! }, i, 1 - Math.exp(-l * t) * (1 + l * t)));
    expect(() => topEventProbability(net)).toThrow(FTError);
  });

  it("FDEP: a trigger fails its dependents (exact in the BDD, matched by simulation)", () => {
    const net = tree(
      [["T", "top"], ["G", "and"], ["F", "fdep"], ["Trig", "basic", rate(0.001)], ["A", "basic", rate(0.01)], ["B", "basic", rate(0.01)]],
      [["G", "T"], ["A", "G"], ["B", "G"], ["Trig", "F"], ["A", "F"], ["B", "F"]],
      "extendedFaultTree",
    );
    net.faultTree!.nodes.find((n) => n.id === "Trig")!.x = -100;
    const t = 50;
    const pt = 1 - Math.exp(-0.001 * t);
    const pa = 1 - Math.exp(-0.01 * t);
    const exact = pt + (1 - pt) * pa * pa;
    expect(topEventProbability(net, { time: t })).toBeCloseTo(exact, 12);
    expect(minimalCutSets(net)).toEqual([["Trig"], ["A", "B"]]);
    within(simulateFaultTree(net, { time: t, runs: 30000, seed: 2 }), 0, exact);
  });
});

describe("DNF import", () => {
  it("parses both notations", () => {
    expect(parseDnf("(a & b) | (c & d & e)")).toEqual([
      [{ name: "a", negated: false }, { name: "b", negated: false }],
      [{ name: "c", negated: false }, { name: "d", negated: false }, { name: "e", negated: false }],
    ]);
    expect(parseDnf("# comment\na b\nc, d, e\n\npump-1 * !v2").map((t) => t.map((l) => (l.negated ? "!" : "") + l.name))).toEqual([
      ["a", "b"],
      ["c", "d", "e"],
      ["pump-1", "!v2"],
    ]);
    expect(() => parseDnf("(a | b) & c")).toThrow(FTError);
    expect(() => parseDnf("(a & b")).toThrow(FTError);
  });

  it("imports a valid, laid-out fault tree whose cut sets are the terms", () => {
    const net = importDnf("(a & b) | (c & d & e) | f | (a & b & c)", { name: "System" });
    expect(net.netClass).toBe("faultTree");
    expect(validateFaultTree(net).filter((x) => x.severity === "error")).toEqual([]);
    const names = new Map(net.faultTree!.nodes.map((n) => [n.id, n.name]));
    expect(minimalCutSets(net).map((s) => s.map((id) => names.get(id)))).toEqual([["f"], ["a", "b"], ["c", "d", "e"]]);
    const top = net.faultTree!.nodes.find((n) => n.type === "top")!;
    expect(top.name).toBe("System");
    for (const n of net.faultTree!.nodes) if (n !== top) expect(n.y).toBeGreaterThan(top.y);
    expect(topEventProbability(net)).toBeCloseTo(1 - (1 - 0.01) * (1 - 1e-4) * (1 - 1e-6), 9);
  });

  it("round-trips through exportDnf", () => {
    const text = "(a & b) | (b & c) | d";
    const net = importDnf(text);
    expect(exportDnf(net)).toBe("d | (a & b) | (b & c)");
    const again = importDnf(exportDnf(net));
    expect(exportDnf(again)).toBe(exportDnf(net));
    const single = importDnf("x y z", { failureRate: "1e-4" });
    expect(exportDnf(single)).toBe("(x & y & z)");
    expect(topEventProbability(single, { time: 1000 })).toBeCloseTo((1 - Math.exp(-0.1)) ** 3, 12);
  });
});

describe("layout", () => {
  it("places levels top-down, centres parents and avoids overlaps", () => {
    const net = tree(
      [["T", "top"], ["G1", "or"], ["G2", "and"], ["G3", "and"], ["A", "basic", p(0.1)], ["B", "basic", p(0.1)], ["C", "basic", p(0.1)], ["D", "basic", p(0.1)], ["X", "basic", p(0.1)]],
      [["G1", "T"], ["G2", "G1"], ["G3", "G1"], ["A", "G2"], ["B", "G2"], ["C", "G3"], ["D", "G3"], ["B", "G3"]],
    );
    const laid = layoutFaultTree(net, { dx: 80, dy: 100 });
    const pos = new Map(laid.faultTree!.nodes.map((n) => [n.id, n]));
    expect(pos.get("T")!.y).toBeLessThan(pos.get("G1")!.y);
    expect(pos.get("G1")!.y).toBeLessThan(pos.get("G2")!.y);
    expect(pos.get("G2")!.y).toBeLessThan(pos.get("A")!.y);
    expect(pos.get("G2")!.x).toBe((pos.get("A")!.x + pos.get("B")!.x) / 2);
    expect(pos.get("T")!.x).toBe(pos.get("G1")!.x);
    const all = [...pos.values()];
    for (const a of all)
      for (const b of all) if (a !== b && a.y === b.y) expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(40);
    // The unconnected event X goes to the right.
    expect(pos.get("X")!.x).toBeGreaterThan(Math.max(...["A", "B", "C", "D"].map((i) => pos.get(i)!.x)));
    // Input unchanged.
    expect(net.faultTree!.nodes[0].x).toBe(0);
  });
});
