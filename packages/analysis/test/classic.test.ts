// The analysis concepts of A. Halder, "A Study of Petri Nets: Modeling, Analysis and Simulation"
// (2006, chs 4 and 5), after Murata (1989): liveness levels, repetitivity, consistency,
// conservation, persistence, fairness, synchronic distance, the structural (matrix) properties,
// directed circuits and the state equation.
import { describe, expect, it } from "vitest";
import { emptyNet, reverseNet, type Arc, type Net } from "@pns/core";
import { analyseNet, checkReachability } from "@pns/analysis";

type ArcSpec = [string, string, number?, Arc["kind"]?];
function net(places: Record<string, number>, transitions: string[], arcs: ArcSpec[], cls: Net["netClass"] = "pt"): Net {
  const n = emptyNet(cls, "test") as Net;
  for (const [p, m] of Object.entries(places)) n.places.push({ id: p, name: p, x: 0, y: 0, marking: String(m) });
  for (const t of transitions) n.transitions.push({ id: t, name: t, x: 0, y: 0 });
  arcs.forEach(([s, t, w, kind], i) => n.arcs.push({ id: `a${i}`, source: s, target: t, inscription: String(w ?? 1), kind: kind ?? "normal" }));
  return n;
}
const levelOf = (r: ReturnType<typeof analyseNet>, t: string) => r.dynamics.transitions.find((x) => x.transition.name === t)!;
const item = (r: ReturnType<typeof analyseNet>, key: string) => r.summary.find((s) => s.key === key)!;

/** p1 → t1 → p2 → t2 → p1 with one token: live, bounded, safe. */
const cycle = () => net({ p1: 1, p2: 0 }, ["t1", "t2"], [["p1", "t1"], ["t1", "p2"], ["p2", "t2"], ["t2", "p1"]]);
/** Two independent cycles. */
const twoLoops = () =>
  net({ a1: 1, a2: 0, b1: 1, b2: 0 }, ["u1", "u2", "v1", "v2"], [["a1", "u1"], ["u1", "a2"], ["a2", "u2"], ["u2", "a1"], ["b1", "v1"], ["v1", "b2"], ["b2", "v2"], ["v2", "b1"]]);
/**
 * Every liveness level at once (Murata 1989, Fig. 13 style): s pumps tokens into a while p holds its
 * token (L3, not L4: k ends the pumping), k fires once (L1), t empties a only after k (L2: any number
 * of times, but never infinitely often), d can never fire (L0). The net is unbounded.
 */
const levels = () =>
  net(
    { p: 1, a: 0, q: 0, z: 0 },
    ["s", "k", "t", "d"],
    [["p", "s"], ["s", "p"], ["s", "a"], ["p", "k"], ["k", "q"], ["a", "t"], ["q", "t"], ["t", "q"], ["z", "d"]],
  );

describe("liveness levels L0–L4 (report §5.2.1.3)", () => {
  it("a cycle is L4-live in every transition", () => {
    const r = analyseNet(cycle());
    expect(r.dynamics.source).toBe("reachability");
    for (const t of ["t1", "t2"]) expect(levelOf(r, t).level).toBe(4);
    expect(r.dynamics.netLevels).toEqual(["yes", "yes", "yes", "yes"]);
  });

  it("separates L0, L1, L2 and L3 on an unbounded net, from its coverability graph", () => {
    const r = analyseNet(levels(), { maxStates: 200 });
    expect(r.behaviour.bounded).toBe("no");
    expect(r.dynamics.source).toBe("coverability");
    expect(levelOf(r, "d").level).toBe(0);
    expect(levelOf(r, "k").level).toBe(1);
    expect(levelOf(r, "t").level).toBe(2);
    expect(levelOf(r, "s").level).toBe(3);
    expect(r.dynamics.netLevels).toEqual(["no", "no", "no", "no"]);
    expect(item(r, "liveL1").status).toBe("no");
  });

  it("on a bounded net L2 and L3 coincide, and a path that ends is L1", () => {
    const r = analyseNet(net({ a: 1, b: 0, c: 0 }, ["t", "u"], [["a", "t"], ["t", "b"], ["b", "u"], ["u", "c"]]));
    expect(levelOf(r, "t").levels).toEqual(["yes", "no", "no", "no"]);
    expect(levelOf(r, "t").level).toBe(1);
  });
});

describe("repetitivity, consistency, conservation, persistence (report §5.2.1.6–9)", () => {
  it("a cycle is repetitive, consistent and strictly conservative", () => {
    const d = analyseNet(cycle()).dynamics;
    expect([d.repetitive, d.partiallyRepetitive, d.consistent, d.partiallyConsistent]).toEqual(["yes", "yes", "yes", "yes"]);
    expect([d.conservative, d.strictlyConservative]).toEqual(["yes", "yes"]);
    expect(d.conservationWeights).toEqual({ p1: 1, p2: 1 });
  });

  it("a weighted cycle is conservative with weights (2, 1) but not strictly", () => {
    const d = analyseNet(net({ p: 1, q: 0 }, ["t", "u"], [["p", "t"], ["t", "q", 2], ["q", "u", 2], ["u", "p"]])).dynamics;
    expect(d.conservative).toBe("yes");
    expect(d.strictlyConservative).toBe("no");
    expect(d.conservationWeights).toEqual({ p: 2, q: 1 });
  });

  it("a net that ends is neither repetitive nor consistent", () => {
    const d = analyseNet(net({ a: 1, b: 0 }, ["t"], [["a", "t"], ["t", "b"]])).dynamics;
    expect([d.repetitive, d.partiallyRepetitive, d.consistent, d.partiallyConsistent]).toEqual(["no", "no", "no", "no"]);
  });

  it("the unbounded pump net: partially repetitive, not repetitive, not conservative", () => {
    const d = analyseNet(levels(), { maxStates: 200 }).dynamics;
    expect(d.repetitive).toBe("no");
    expect(d.partiallyRepetitive).toBe("yes");
    expect(d.conservative).toBe("no");
    // s alone reproduces nothing (it adds a token each time); no other cycle exists.
    expect(d.partiallyConsistent).toBe("no");
  });

  it("an unbounded net whose cycle reproduces its marking is partially consistent", () => {
    // s pumps a; x ⇄ y is a cycle that keeps every marking.
    const d = analyseNet(net({ p: 1, a: 0, x: 1, y: 0 }, ["s", "f", "g"], [["p", "s"], ["s", "p"], ["s", "a"], ["x", "f"], ["f", "y"], ["y", "g"], ["g", "x"]]), { maxStates: 100 }).dynamics;
    expect(d.source).toBe("coverability");
    expect(d.partiallyConsistent).toBe("yes");
    expect(d.consistent).toBe("no");
    expect(d.repetitive).toBe("yes");
  });

  it("persistence is dynamic conflict freeness", () => {
    const r = analyseNet(net({ p: 1, a: 0, b: 0 }, ["t1", "t2"], [["p", "t1"], ["p", "t2"], ["t1", "a"], ["t2", "b"]]));
    expect(r.dynamics.persistent).toBe("no");
    expect(r.dynamics.persistent).toBe(r.behaviour.dynamicConflictFree);
    expect(analyseNet(cycle()).dynamics.persistent).toBe("yes");
  });
});

describe("fairness and synchronic distance (report §5.2.1.10–11)", () => {
  it("a cycle is B-fair and unconditionally fair; d(t1, t2) = 1", () => {
    const d = analyseNet(cycle()).dynamics;
    expect(d.bFair).toBe("yes");
    expect(d.bFairClasses?.map((c) => c.map((t) => t.name))).toEqual([["t1", "t2"]]);
    expect(d.unconditionallyFair).toBe("yes");
    expect(d.synchronic).toEqual([{ a: 0, b: 1, value: 1, infinite: false, exact: true }]);
  });

  it("two independent loops are not B-fair, not unconditionally fair, and drift apart", () => {
    const r = analyseNet(twoLoops());
    const d = r.dynamics;
    expect(d.bFair).toBe("no");
    expect(d.unfairPair).toBeDefined();
    expect(d.unconditionallyFair).toBe("no");
    expect(d.bFairClasses?.map((c) => c.map((t) => t.name))).toEqual([
      ["u1", "u2"],
      ["v1", "v2"],
    ]);
    const name = (i: number) => r.transitions[i].name;
    const pair = (a: string, b: string) => d.synchronic.find((s) => [name(s.a), name(s.b)].sort().join() === [a, b].sort().join())!;
    expect(pair("u1", "u2").value).toBe(1);
    expect(pair("u1", "v1").infinite).toBe(true);
  });

  it("a sequence t → u has distance 1 and the larger counts of a fork are counted", () => {
    // t fires once and then u twice (t puts two tokens into b).
    const r = analyseNet(net({ a: 1, b: 0, c: 0 }, ["t", "u"], [["a", "t"], ["t", "b", 2], ["b", "u"], ["u", "c"]]));
    expect(r.dynamics.synchronic[0]).toMatchObject({ value: 2, infinite: false, exact: true });
  });

  it("on the coverability graph a pumpable imbalance is an infinite distance", () => {
    const r = analyseNet(levels(), { maxStates: 200 });
    const s = r.transitions.findIndex((t) => t.name === "s");
    const k = r.transitions.findIndex((t) => t.name === "k");
    const pair = r.dynamics.synchronic.find((x) => (x.a === s && x.b === k) || (x.a === k && x.b === s))!;
    expect(pair.infinite).toBe(true);
  });
});

describe("structural properties of the incidence matrix (report §5.2.2)", () => {
  it("a cycle: structurally bounded, conservative, repetitive, consistent, live, B-fair; rank 1 < 2 places", () => {
    const a = analyseNet(cycle()).algebra;
    expect([a.structurallyBounded, a.structurallyConservative, a.structurallyRepetitive, a.structurallyConsistent, a.structurallyLive, a.structurallyBFair]).toEqual(["yes", "yes", "yes", "yes", "yes", "yes"]);
    expect(a.rank).toBe(1);
    expect(a.pInvariantDimension).toBe(1);
    expect(a.tInvariantDimension).toBe(1);
    expect(a.controllabilityRank).toBe("no");
    expect(a.completelyControllable).toBe("no");
  });

  it("a source transition makes its place structurally unbounded", () => {
    const a = analyseNet(levels(), { maxStates: 200 }).algebra;
    expect(a.structurallyBounded).toBe("no");
    expect(a.structurallyUnboundedPlaces.map((p) => p.name)).toContain("a");
    expect(a.structurallyLive).toBe("no");
    expect(a.nonRepetitiveTransitions.map((t) => t.name).sort()).toEqual(["d", "k"]);
  });

  it("a path is not structurally live; partial conservation without full conservation", () => {
    const a = analyseNet(net({ a: 1, b: 0 }, ["t"], [["a", "t"], ["t", "b", 2]])).algebra;
    expect(a.structurallyLive).toBe("no");
    expect(a.structurallyConservative).toBe("yes"); // 2·a + b
    const b = analyseNet(net({ a: 1, b: 0, c: 0 }, ["t", "s"], [["a", "t"], ["t", "b"], ["s", "c"]])).algebra;
    expect(b.structurallyConservative).toBe("no");
    expect(b.partiallyStructurallyConservative).toBe("yes");
    expect(b.structurallyBounded).toBe("no");
  });

  it("a source and a sink for every place make the net completely controllable", () => {
    const a = analyseNet(net({ p: 0 }, ["in", "out"], [["in", "p"], ["p", "out"]])).algebra;
    expect(a.controllabilityRank).toBe("yes");
    expect(a.completelyControllable).toBe("yes");
  });

  it("two independent loops are not structurally B-fair", () => {
    const a = analyseNet(twoLoops()).algebra;
    expect(a.structurallyBFair).toBe("no");
    expect(a.structuralBFairClasses?.length).toBe(2);
  });

  it("inhibitor arcs: a 'can happen' answer from the matrix becomes unknown", () => {
    // The source transition is blocked once a holds a token, so the net is bounded, but the matrix cannot see it.
    const a = analyseNet(net({ a: 0 }, ["s", "t"], [["s", "a"], ["a", "s", 1, "inhibitor"], ["a", "t"]], "xpt")).algebra;
    expect(a.structurallyBounded).toBe("unknown");
  });

  it("reset arcs make the matrix properties n/a", () => {
    const a = analyseNet(net({ a: 1, b: 0 }, ["t"], [["a", "t"], ["t", "b"], ["b", "t", 1, "reset"]], "xpt")).algebra;
    expect(a.structurallyBounded).toBe("n/a");
  });
});

describe("directed circuits (report §4.2.5, §4.2.7)", () => {
  it("a cycle is a (pure) directed circuit; a path has none", () => {
    const r = analyseNet(cycle());
    expect(r.structure.directedCircuits.holds).toBe(true);
    expect(r.structure.pureDirectedCircuits.holds).toBe(true);
    const p = analyseNet(net({ a: 1, b: 0 }, ["t"], [["a", "t"], ["t", "b"]]));
    expect(p.structure.directedCircuits.holds).toBe(false);
    expect(item(p, "directedCircuits").status).toBe("no");
  });

  it("a circuit through a place with two outputs is directed but not pure", () => {
    const s = analyseNet(net({ p1: 1, p2: 0, x: 0 }, ["t1", "t2", "t3"], [["p1", "t1"], ["t1", "p2"], ["p2", "t2"], ["t2", "p1"], ["p2", "t3"], ["t3", "x"]])).structure;
    expect(s.directedCircuits.holds).toBe(true);
    expect(s.pureDirectedCircuits.holds).toBe(false);
  });
});

describe("reachability and the state equation (report §5.2.1.1, §5.2.2 III–IV)", () => {
  it("finds a shortest path to a reachable marking", () => {
    const r = checkReachability(cycle(), { p2: 1 });
    expect(r.reachable).toBe("yes");
    expect(r.path?.map((t) => t.name)).toEqual(["t1"]);
    expect(r.stateEquation).toBe("integer");
  });

  it("no solution of the state equation proves a marking unreachable", () => {
    const r = checkReachability(cycle(), { p1: 1, p2: 1 });
    expect(r).toMatchObject({ reachable: "no", stateEquation: "none" });
  });

  it("only fractional solutions also prove it", () => {
    // t takes two tokens and gives none back: emptying p needs t to fire half a time.
    const r = checkReachability(net({ p: 1 }, ["t"], [["p", "t", 2]]), { p: 0 });
    expect(r).toMatchObject({ reachable: "no", stateEquation: "rational" });
  });

  it("an integer solution is only necessary: the state space decides", () => {
    // t needs a token in p that never comes; the equation still allows firing t once.
    const r = checkReachability(net({ p: 0, q: 0 }, ["t"], [["p", "t"], ["t", "p"], ["t", "q"]]), { q: 1 });
    expect(r).toMatchObject({ reachable: "no", stateEquation: "integer" });
    expect(r.firingCount).toEqual({ t: 1 });
  });

  it("names an unknown place", () => {
    expect(() => checkReachability(cycle(), { nope: 1 })).toThrow(/Unknown place/);
  });
});

describe("the reversed net (report §4.3.3)", () => {
  it("has the same P-invariants, since its incidence matrix is −C", () => {
    const n = net({ p: 1, q: 0 }, ["t", "u"], [["p", "t"], ["t", "q", 2], ["q", "u", 2], ["u", "p"]]);
    const inv = (x: Net) => analyseNet(x).invariants.p.invariants.map((i) => i.text).sort();
    expect(inv(reverseNet(n))).toEqual(inv(n));
    expect(analyseNet(reverseNet(n)).incidence.rows).toEqual(analyseNet(n).incidence.rows.map((r) => r.map((v) => -v || 0)));
  });
});
