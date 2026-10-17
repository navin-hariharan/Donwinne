import { describe, expect, it } from "vitest";
import {
  basicEventProbabilities,
  compileFaultTree,
  importanceMeasures,
  minCutUpperBound,
  minimalCutSets,
  minimalPathSets,
  rareEventApproximation,
  reliabilityCurve,
  topEventAnalysis,
  topEventProbability,
  validateFaultTree,
  FTError,
} from "@pns/ft";
import { NodeSpec, p, rate, tree } from "./helpers";

const twoOfThree = (q = 0.1) =>
  tree(
    [["TOP", "top"], ["G", "kofn", { k: 2 }], ["A", "basic", p(q)], ["B", "basic", p(q)], ["C", "basic", p(q)]],
    [["G", "TOP"], ["A", "G"], ["B", "G"], ["C", "G"]],
  );

// Bridge network s–a (1), s–b (2), a–b (3), a–t (4), b–t (5); system fails when s and t are disconnected.
// Written as an OR of path-cut ANDs, including a non-minimal one.
const bridge = (q = 0.1) => {
  const nodes: NodeSpec[] = [["TOP", "top"], ["OR", "or"]];
  for (const i of [1, 2, 3, 4, 5]) nodes.push([`X${i}`, "basic", p(q)]);
  const cuts = [[1, 2], [4, 5], [1, 3, 5], [2, 3, 4], [1, 2, 3]];
  const edges: [string, string][] = [["OR", "TOP"]];
  cuts.forEach((c, i) => {
    nodes.push([`K${i}`, "and"]);
    edges.push([`K${i}`, "OR"]);
    for (const x of c) edges.push([`X${x}`, `K${i}`]);
  });
  return tree(nodes, edges);
};

// No flow: both pumps fail (each pump also fails when the shared power supply fails), or the valve fails.
const pumpValve = () =>
  tree(
    [
      ["TOP", "top"],
      ["OR", "or"],
      ["Pumps", "intermediate"],
      ["AND", "and"],
      ["P1f", "or"],
      ["P2f", "or"],
      ["P1", "basic", p(0.05)],
      ["PS", "basic", p(0.002)],
      ["P2", "basic", p(0.05)],
      ["V", "basic", p(0.01)],
    ],
    [
      ["OR", "TOP"],
      ["Pumps", "OR"],
      ["V", "OR"],
      ["AND", "Pumps"],
      ["P1f", "AND"],
      ["P2f", "AND"],
      ["P1", "P1f"],
      ["PS", "P1f"],
      ["P2", "P2f"],
      ["PS", "P2f"],
    ],
  );

describe("validation", () => {
  it("accepts the textbook trees", () => {
    for (const net of [twoOfThree(), bridge(), pumpValve()]) expect(validateFaultTree(net).filter((x) => x.severity === "error")).toEqual([]);
  });

  it("reports structural errors", () => {
    const net = tree(
      [
        ["T1", "top"],
        ["T2", "top"],
        ["K", "kofn", { k: 3 }],
        ["N", "not"],
        ["I", "inhibit"],
        ["A", "basic"],
        ["B", "basic", p(2)],
        ["U", "basic", p(0.1)],
        ["P", "pand"],
      ],
      [["K", "T1"], ["A", "K"], ["B", "K"], ["A", "N"], ["B", "N"], ["N", "T2"], ["A", "I"], ["I", "T2"], ["A", "P"], ["P", "T2"]],
    );
    const msgs = validateFaultTree(net).map((x) => `${x.severity}: ${x.message}`);
    const has = (re: RegExp) => expect(msgs.some((m) => re.test(m)), `${re} in\n${msgs.join("\n")}`).toBe(true);
    has(/error: More than one top event/);
    has(/error: K \(3-of-2\) has fewer inputs than k/);
    has(/error: N \(NOT\) needs exactly one input/);
    has(/error: I \(INHIBIT\) needs one input and one condition/);
    has(/error: A needs a failure rate or a probability/);
    has(/error: B: the probability must lie between 0 and 1/);
    has(/error: P: PAND gates belong to extended fault trees/);
    has(/warning: T2 has 3 inputs; they are combined with OR/);
  });

  it("finds cycles, missing top events and unreachable nodes", () => {
    const cyc = tree([["T", "top"], ["G1", "or"], ["G2", "or"], ["A", "basic", p(0.1)]], [["G1", "T"], ["G2", "G1"], ["G1", "G2"], ["A", "G2"]]);
    expect(validateFaultTree(cyc).some((x) => /cycle/.test(x.message))).toBe(true);
    const none = tree([["A", "basic", p(0.1)]], []);
    expect(validateFaultTree(none).some((x) => /no top event/.test(x.message))).toBe(true);
    const unreach = tree([["T", "top"], ["A", "basic", p(0.1)], ["B", "basic", p(0.1)]], [["A", "T"]]);
    const w = validateFaultTree(unreach);
    expect(w).toContainEqual({ severity: "warning", message: "B does not contribute to the top event", elementId: "B" });
    expect(() => topEventProbability(cyc)).toThrow(FTError);
  });
});

describe("minimal cut sets and path sets", () => {
  it("2-out-of-3", () => {
    expect(minimalCutSets(twoOfThree())).toEqual([["A", "B"], ["A", "C"], ["B", "C"]]);
    expect(minimalPathSets(twoOfThree())).toEqual([["A", "B"], ["A", "C"], ["B", "C"]]);
  });

  it("bridge network drops the non-minimal cut", () => {
    expect(minimalCutSets(bridge())).toEqual([["X1", "X2"], ["X4", "X5"], ["X1", "X3", "X5"], ["X2", "X3", "X4"]]);
    expect(minimalCutSets(bridge(), { maxOrder: 2 })).toEqual([["X1", "X2"], ["X4", "X5"]]);
    expect(minimalCutSets(bridge(), { maxSets: 3 })).toHaveLength(3);
    // Path sets of the bridge: the four s–t paths.
    expect(minimalPathSets(bridge())).toEqual([["X1", "X4"], ["X2", "X5"], ["X1", "X3", "X5"], ["X2", "X3", "X4"]]);
  });

  it("pump-valve tree with a shared event", () => {
    expect(minimalCutSets(pumpValve())).toEqual([["PS"], ["V"], ["P1", "P2"]]);
  });

  it("handles a tree with half a million cut sets symbolically", () => {
    // AND of 12 OR gates with 3 events each: 3^12 = 531441 minimal cut sets of size 12.
    const nodes: NodeSpec[] = [["T", "top"], ["AND", "and"]];
    const edges: [string, string][] = [["AND", "T"]];
    for (let g = 0; g < 12; g++) {
      nodes.push([`O${g}`, "or"]);
      edges.push([`O${g}`, "AND"]);
      for (let j = 0; j < 3; j++) {
        nodes.push([`E${g}_${j}`, "basic", p(0.1)]);
        edges.push([`E${g}_${j}`, `O${g}`]);
      }
    }
    const net = tree(nodes, edges);
    const c = compileFaultTree(net);
    expect(c.bdd.size(c.root)).toBe(36);
    const sets = minimalCutSets(c, { maxSets: 5 });
    expect(sets).toHaveLength(5);
    expect(sets.every((s) => s.length === 12)).toBe(true);
    expect(minimalCutSets(c, { maxOrder: 11 })).toEqual([]);
    expect(topEventProbability(c)).toBeCloseTo(Math.pow(1 - 0.9 ** 3, 12), 12);
  });

  it("non-coherent gates use the coherent approximation for cut sets but stay exact for probability", () => {
    const net = tree([["T", "top"], ["X", "xor"], ["A", "basic", p(0.1)], ["B", "basic", p(0.2)]], [["X", "T"], ["A", "X"], ["B", "X"]]);
    expect(minimalCutSets(net)).toEqual([["A"], ["B"]]);
    expect(topEventProbability(net)).toBeCloseTo(0.1 * 0.8 + 0.9 * 0.2, 12);
    const notNet = tree(
      [["T", "top"], ["G", "and"], ["N", "not"], ["A", "basic", p(0.1)], ["B", "basic", p(0.2)]],
      [["G", "T"], ["A", "G"], ["N", "G"], ["B", "N"]],
    );
    expect(topEventProbability(notNet)).toBeCloseTo(0.1 * 0.8, 12);
    expect(minimalCutSets(notNet)).toEqual([["A"]]);
  });

  it("inhibit gates act as AND", () => {
    const net = tree([["T", "top"], ["I", "inhibit"], ["A", "basic", p(0.1)], ["C", "basic", p(0.5)]], [["I", "T"], ["A", "I"], ["C", "I"]]);
    expect(minimalCutSets(net)).toEqual([["A", "C"]]);
    expect(topEventProbability(net)).toBeCloseTo(0.05, 12);
  });
});

describe("probabilities", () => {
  it("2-out-of-3: 3p²(1−p) + p³", () => {
    expect(topEventProbability(twoOfThree())).toBeCloseTo(3 * 0.01 * 0.9 + 0.001, 12);
  });

  it("bridge network: exact value and approximations", () => {
    const exact = 0.9 * (1 - 0.99 ** 2) + 0.1 * (1 - 0.9 ** 2) ** 2;
    const r = topEventAnalysis(bridge());
    expect(r.method).toBe("bdd");
    expect(r.probability).toBeCloseTo(exact, 12);
    expect(r.rareEvent).toBeCloseTo(0.022, 12);
    expect(r.minCutUpperBound).toBeCloseTo(1 - 0.99 ** 2 * 0.999 ** 2, 12);
    expect(rareEventApproximation(bridge())).toBeCloseTo(0.022, 12);
    expect(minCutUpperBound(bridge())).toBeCloseTo(r.minCutUpperBound, 12);
    expect(r.probability).toBeLessThanOrEqual(r.minCutUpperBound);
    expect(r.minCutUpperBound).toBeLessThanOrEqual(r.rareEvent);
  });

  it("pump-valve", () => {
    expect(topEventProbability(pumpValve())).toBeCloseTo(1 - (1 - 0.0025) * (1 - 0.01) * (1 - 0.002), 12);
  });

  it("failure rates at a mission time, with constants", () => {
    const net = tree(
      [["T", "top"], ["G", "and"], ["A", "basic", { failureRate: "lam" }], ["B", "basic", { failureRate: "2 * lam" }]],
      [["G", "T"], ["A", "G"], ["B", "G"]],
    );
    net.declarations.constants = [{ name: "lam", value: "1e-3" }];
    expect(basicEventProbabilities(net, { time: 100 })).toEqual({ A: 1 - Math.exp(-0.1), B: 1 - Math.exp(-0.2) });
    expect(topEventProbability(net, { time: 100 })).toBeCloseTo((1 - Math.exp(-0.1)) * (1 - Math.exp(-0.2)), 12);
    expect(() => topEventProbability(net)).toThrow(/mission time/);
  });

  it("extended fault tree with repair: steady state and transient unavailability", () => {
    const net = tree(
      [["T", "top"], ["G", "or"], ["A", "basic", rate(0.01, 0.1)], ["B", "basic", rate(0.01, 0.1)]],
      [["G", "T"], ["A", "G"], ["B", "G"]],
      "extendedFaultTree",
    );
    const q = 0.01 / 0.11;
    expect(topEventProbability(net)).toBeCloseTo(1 - (1 - q) ** 2, 12);
    const qt = q * (1 - Math.exp(-0.11 * 10));
    expect(topEventProbability(net, { time: 10 })).toBeCloseTo(1 - (1 - qt) ** 2, 12);
    const curve = reliabilityCurve(net, { end: 200, points: 21 });
    expect(curve.method).toBe("bdd");
    expect(curve.times).toHaveLength(21);
    expect(curve.unreliability[0]).toBe(0);
    expect(curve.unreliability[20]).toBeCloseTo(1 - (1 - q) ** 2, 6);
    for (let i = 1; i < 21; i++) expect(curve.unreliability[i]).toBeGreaterThanOrEqual(curve.unreliability[i - 1]);
    expect(curve.reliability[5]).toBeCloseTo(1 - curve.unreliability[5], 12);
  });

  it("reliability curve of a non-repairable series system", () => {
    const net = tree([["T", "top"], ["G", "or"], ["A", "basic", rate(1e-3)], ["B", "basic", rate(2e-3)]], [["G", "T"], ["A", "G"], ["B", "G"]]);
    const c = reliabilityCurve(net, { end: 1000, points: 11 });
    c.times.forEach((t, i) => expect(c.reliability[i]).toBeCloseTo(Math.exp(-3e-3 * t), 12));
  });
});

describe("importance measures", () => {
  it("pump-valve: Birnbaum, criticality, Fussell–Vesely, RAW, RRW", () => {
    const Q = (pP: number, pS: number, pV: number) => 1 - (1 - pP * pP) * (1 - pV) * (1 - pS);
    const q = Q(0.05, 0.002, 0.01);
    const im = importanceMeasures(pumpValve());
    const v = im.find((x) => x.id === "V")!;
    const q1 = 1;
    const q0 = Q(0.05, 0.002, 0);
    expect(v.probability).toBe(0.01);
    expect(v.birnbaum).toBeCloseTo(q1 - q0, 12);
    expect(v.criticality).toBeCloseTo(((q1 - q0) * 0.01) / q, 12);
    expect(v.fussellVesely).toBeCloseTo((q - q0) / q, 12);
    expect(v.raw).toBeCloseTo(q1 / q, 9);
    expect(v.rrw).toBeCloseTo(q / q0, 9);
    // Pump P1: Q(P1=1) − Q(P1=0) = (1 − pV)(1 − pS)·pP2
    const p1 = im.find((x) => x.id === "P1")!;
    expect(p1.birnbaum).toBeCloseTo(0.99 * 0.998 * 0.05, 12);
    // Single-event cut sets dominate.
    expect(im.slice(0, 2).map((x) => x.id)).toEqual(["V", "PS"]);
    expect(im.map((x) => x.id).sort()).toEqual(["P1", "P2", "PS", "V"]);
  });

  it("2-out-of-3 measures are symmetric", () => {
    const im = importanceMeasures(twoOfThree());
    expect(im[0].birnbaum).toBeCloseTo(2 * 0.1 * 0.9, 12);
    expect(im[1].birnbaum).toBeCloseTo(im[0].birnbaum, 12);
    expect(im[2].fussellVesely).toBeCloseTo(im[0].fussellVesely, 12);
  });
});
