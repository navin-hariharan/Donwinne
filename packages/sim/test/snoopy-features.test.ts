import { describe, expect, it } from "vitest";
import { Net } from "@pns/core";
import { buildModel, reachabilityGraph, simulate, timedFire, timedInit, traceToCsv, unfold } from "@pns/sim";
import { mk, series } from "./helpers";

const observer = (trace: { observers: { name: string; values: number[] }[] }, name: string) => {
  const s = trace.observers.find((o) => o.name === name);
  if (!s) throw new Error(`no observer ${name}`);
  return s;
};

describe("modifier arcs", () => {
  // A decays with rate k * E; E only modifies the rate.
  const catalysed = (netClass: Net["netClass"], e = "2") =>
    mk(
      netClass,
      [["A", "100"], ["E", e], ["B", ""]],
      [["t", { rate: "k * E * A" }]],
      [["A", "t"], ["t", "B"], ["E", "t", "", "modifier"]],
      [["k", "0.25"]],
    );

  it("let the place appear in the rate without consuming it (ODE)", () => {
    const trace = simulate(catalysed("continuous"), { end: 4, points: 9 });
    const A = series(trace, "A").values;
    const E = series(trace, "E").values;
    trace.times.forEach((t, i) => {
      expect(A[i]).toBeCloseTo(100 * Math.exp(-0.5 * t), 4);
      expect(E[i]).toBe(2);
    });
  });

  it("never disable a transition, even from an empty place", () => {
    const net = mk("stochastic", [["E", ""], ["B", ""]], [["t", { rate: "3" }]], [["E", "t", "", "modifier"], ["t", "B"]]);
    const trace = simulate(net, { end: 10, points: 2, seed: 7 });
    expect(series(trace, "B").values[1]).toBeGreaterThan(10);
    const cont = mk("continuous", [["E", ""], ["B", ""]], [["t", { rate: "3" }]], [["E", "t", "", "modifier"], ["t", "B"]]);
    expect(series(simulate(cont, { end: 2, points: 3 }), "B").values[2]).toBeCloseTo(6, 6);
  });

  it("are watched for propensity updates in stochastic simulation", () => {
    // E grows through u; t's propensity depends on E only through the modifier arc.
    const net = mk(
      "stochastic",
      [["E", "0"], ["B", ""]],
      [["u", { rate: "FixedTimedFiring_Single(1)" }], ["t", { rate: "1000 * E" }]],
      [["u", "E"], ["E", "t", "", "modifier"], ["t", "B"]],
    );
    const trace = simulate(net, { end: 2, points: 3, seed: 3 });
    expect(series(trace, "B").values[1]).toBe(0);
    expect(series(trace, "B").values[2]).toBeGreaterThan(500);
  });

  it("are not part of mass action", () => {
    const net = mk("continuous", [["A", "10"], ["E", "5"], ["B", ""]], [["t", { rate: "MassAction(1)" }]], [["A", "t"], ["E", "t", "", "modifier"], ["t", "B"]]);
    expect(buildModel(net).transitions[0].maPre.map((a) => a.slot)).toEqual([0]);
    const A = series(simulate(net, { end: 1, points: 2 }), "A").values;
    expect(A[1]).toBeCloseTo(10 * Math.exp(-1), 4);
  });

  it("are ignored by the token game, reachability and timed nets", () => {
    const net = mk("stochastic", [["E", ""], ["A", "1"], ["B", ""]], [["t"]], [["E", "t", "", "modifier"], ["A", "t"], ["t", "B"]]);
    const rg = reachabilityGraph(net);
    expect(rg.states.map((s) => s.marking)).toEqual([
      { E: "0", A: "1", B: "0" },
      { E: "0", A: "0", B: "1" },
    ]);
    const timed = mk("timed", [["E", ""], ["A", "1"], ["B", ""]], [["t"]], [["E", "t", "", "modifier"], ["A", "t"], ["t", "B"]]);
    const s = timedFire(timedInit(timed), "t");
    expect(s.cn.places.map((p) => s.marking[p.slot].size)).toEqual([0, 0, 1]);
  });

  it("unfold into one modifier arc per colour", () => {
    const net = mk(
      "colouredContinuous",
      [["A", "10`a ++ 20`b", { colourSet: "C" }], ["E", "1`a ++ 3`b", { colourSet: "C" }], ["B", "", { colourSet: "C" }]],
      [["t", { rate: "E * A" }], ["u", { rate: "E * A" }]],
      [["A", "t", "x"], ["E", "t", "x", "modifier"], ["t", "B", "x"], ["A", "u", "x"], ["E", "u", "", "modifier"], ["u", "B", "x"]],
    );
    net.declarations.colourSets.push({ name: "C", type: "enum", values: ["a", "b"] });
    net.declarations.variables.push({ name: "x", colourSet: "C" });
    const { net: u } = unfold(net);
    const mods = (t: string) =>
      u.arcs.filter((a) => a.kind === "modifier" && a.target === u.transitions.find((x) => x.name === t)!.id).map((a) => u.places.find((p) => p.id === a.source)!.name);
    expect(mods("t_a")).toEqual(["E_a"]);
    expect(mods("u_a")).toEqual(["E_a", "E_b"]);
    expect(u.transitions.map((t) => t.rate)).toEqual(["(E_a * A_a)", "(E_b * A_b)", "((E_a + E_b) * A_a)", "((E_a + E_b) * A_b)"]);
    const trace = simulate(net, { end: 1, points: 2 });
    expect(series(trace, "E_b").values).toEqual([3, 3]);
  });
});

describe("fixed places", () => {
  it("keep their marking in ODE simulation while their outflow still runs", () => {
    const net = mk("continuous", [["A", "4", { fixed: true }], ["B", ""]], [["t", { rate: "MassAction(0.5)" }]], [["A", "t"], ["t", "B"]]);
    const trace = simulate(net, { end: 3, points: 4, solver: "rosenbrock" });
    expect(series(trace, "A").values).toEqual([4, 4, 4, 4]);
    trace.times.forEach((t, i) => expect(series(trace, "B").values[i]).toBeCloseTo(2 * t, 6));
  });

  it("keep their marking in hybrid simulation, also against discrete firings", () => {
    const net = mk(
      "hybrid",
      [["S", "5", { continuous: true, fixed: true }], ["P", "", { continuous: true }], ["D", "3", { fixed: true }], ["Q", ""]],
      [["flow", { kind: "continuous", rate: "S" }], ["fire", { rate: "1" }]],
      [["S", "flow"], ["flow", "P"], ["D", "fire"], ["fire", "Q"], ["fire", "D"]],
    );
    const trace = simulate(net, { end: 2, points: 3, seed: 11 });
    expect(series(trace, "S").values).toEqual([5, 5, 5]);
    expect(series(trace, "P").values[2]).toBeCloseTo(10, 6);
    expect(series(trace, "D").values).toEqual([3, 3, 3]);
    expect(series(trace, "Q").values[2]).toBeGreaterThan(0);
  });

  it("let a continuous transition read a fixed discrete place", () => {
    const net = mk("hybrid", [["D", "2", { fixed: true }], ["P", "", { continuous: true }]], [["flow", { kind: "continuous", rate: "D" }]], [["D", "flow"], ["flow", "P"]]);
    expect(() => buildModel(net)).not.toThrow();
    expect(series(simulate(net, { end: 1, points: 2 }), "D").values).toEqual([2, 2]);
  });
});

describe("user functions in rates", () => {
  it("evaluate like the inlined expression", () => {
    const withFn = mk("continuous", [["S", "10"], ["P", ""]], [["t", { rate: "vmax * hill(S, K, 2)" }]], [["S", "t"], ["t", "P"]], [["vmax", "3"], ["K", "4"]]);
    withFn.declarations.functions = [{ name: "hill", params: ["S", "K", "n"], body: "S^n / (K^n + S^n)" }];
    const inlined = mk("continuous", [["S", "10"], ["P", ""]], [["t", { rate: "vmax * S^2 / (K^2 + S^2)" }]], [["S", "t"], ["t", "P"]], [["vmax", "3"], ["K", "4"]]);
    const a = simulate(withFn, { end: 5, points: 6 });
    const b = simulate(inlined, { end: 5, points: 6 });
    const sb = series(b, "S").values;
    series(a, "S").values.forEach((v, i) => expect(v).toBeCloseTo(sb[i], 9));
  });

  it("may call Snoopy rate functions and see markings", () => {
    const net = mk("continuous", [["A", "8"], ["B", ""]], [["t", { rate: "scaled(2)" }]], [["A", "t"], ["t", "B"]]);
    net.declarations.functions = [{ name: "scaled", params: ["c"], body: "c * MassAction(0.25) + 0 * A" }];
    const A = series(simulate(net, { end: 2, points: 3 }), "A").values;
    expect(A[2]).toBeCloseTo(8 * Math.exp(-1), 4);
  });

  it("refuse to simulate with invalid functions", () => {
    const net = mk("continuous", [["A", "1"]], [["t", { rate: "f(A)" }]], [["A", "t"]]);
    net.declarations.functions = [{ name: "f", params: ["x"], body: "f(x)" }];
    expect(() => simulate(net, { end: 1 })).toThrow(/recursion is not allowed/);
  });
});

describe("observers", () => {
  const decay = () => {
    const net = mk("continuous", [["A", "100"], ["B", ""]], [["t", { rate: "MassAction(0.5)" }]], [["A", "t"], ["t", "B"]]);
    net.declarations.observers = [
      { name: "total", kind: "place", expression: "A + B" },
      { name: "twiceA", kind: "place", expression: "2 * A" },
      { name: "flux", kind: "transition", expression: "t" },
    ];
    return net;
  };

  it("give one series per observer alongside places and transitions (ODE)", () => {
    const trace = simulate(decay(), { end: 4, points: 5 });
    expect(trace.observers.map((o) => [o.id, o.name, o.kind, o.measure, o.observerKind])).toEqual([
      ["observer:total", "total", "observer", "value", "place"],
      ["observer:twiceA", "twiceA", "observer", "value", "place"],
      ["observer:flux", "flux", "observer", "value", "transition"],
    ]);
    expect(trace.series.every((s) => s.kind !== "observer")).toBe(true);
    const A = series(trace, "A").values;
    trace.times.forEach((_, i) => {
      expect(observer(trace, "total").values[i]).toBeCloseTo(100, 6);
      expect(observer(trace, "twiceA").values[i]).toBe(2 * A[i]);
      expect(observer(trace, "flux").values[i]).toBeCloseTo(0.5 * A[i], 9);
    });
  });

  it("are empty when the net has none", () => {
    const net = decay();
    delete net.declarations.observers;
    expect(simulate(net, { end: 1, points: 2 }).observers).toEqual([]);
  });

  it("evaluate stochastic transition rates and average over runs (SSA)", () => {
    const net = mk("stochastic", [["A", "50"], ["B", ""]], [["t", { rate: "MassAction(1)" }]], [["A", "t"], ["t", "B"]]);
    net.declarations.observers = [
      { name: "hazard", kind: "transition", expression: "t" },
      { name: "sum", kind: "place", expression: "A + B" },
    ];
    const trace = simulate(net, { end: 1, points: 3, runs: 20, seed: 5, keepRuns: true });
    const A = series(trace, "A").values;
    trace.times.forEach((_, i) => {
      expect(observer(trace, "hazard").values[i]).toBeCloseTo(A[i], 9);
      expect(observer(trace, "sum").values[i]).toBeCloseTo(50, 9);
    });
    expect(trace.runs).toHaveLength(20);
    expect(trace.runs![0].observers.map((o) => o.name)).toEqual(["hazard", "sum"]);
  });

  it("count firings for immediate, deterministic and scheduled transitions", () => {
    const net = mk("stochastic", [["A", ""]], [["tick", { rate: "FixedTimedFiring_Periodic(0.5, 1, 10)" }]], [["tick", "A"]]);
    net.declarations.observers = [{ name: "ticks", kind: "transition", expression: "tick" }];
    const trace = simulate(net, { end: 3, points: 4 });
    expect(observer(trace, "ticks").values).toEqual(series(trace, "tick").values);
  });

  it("get fuzzy bands", () => {
    const net = mk("fuzzyContinuous", [["A", "100"], ["B", ""]], [["t", { rate: "MassAction(k)" }]], [["A", "t"], ["t", "B"]], [["k", "TFN(0.4, 0.5, 0.6)"]]);
    net.declarations.observers = [{ name: "half", kind: "place", expression: "A / 2" }];
    const trace = simulate(net, { end: 2, points: 3, alphaLevels: [0, 1], samplesPerLevel: 3, seed: 1 });
    const half = observer(trace, "half");
    expect(half.bands!.map((b) => b.alpha)).toEqual([0, 1]);
    expect(half.bands![0].lower[2]).toBeCloseTo((100 * Math.exp(-0.6 * 2)) / 2, 2);
    expect(half.bands![0].upper[2]).toBeCloseTo((100 * Math.exp(-0.4 * 2)) / 2, 2);
  });

  it("sum over colours in coloured nets", () => {
    const net = mk(
      "colouredContinuous",
      [["A", "10`a ++ 20`b", { colourSet: "C" }], ["B", "", { colourSet: "C" }]],
      [["t", { rate: "MassAction(1)" }]],
      [["A", "t", "x"], ["t", "B", "x"]],
    );
    net.declarations.colourSets.push({ name: "C", type: "enum", values: ["a", "b"] });
    net.declarations.variables.push({ name: "x", colourSet: "C" });
    net.declarations.observers = [
      { name: "all", kind: "place", expression: "A + B" },
      { name: "rate", kind: "transition", expression: "t" },
    ];
    expect(unfold(net).net.declarations.observers).toEqual([
      { name: "all", kind: "place", expression: "((A_a + A_b) + (B_a + B_b))" },
      { name: "rate", kind: "transition", expression: "(t_a + t_b)" },
    ]);
    const trace = simulate(net, { end: 1, points: 3 });
    trace.times.forEach((_, i) => {
      expect(observer(trace, "all").values[i]).toBeCloseTo(30, 6);
      expect(observer(trace, "rate").values[i]).toBeCloseTo(series(trace, "A", true).values[i], 6);
    });
  });

  it("are written to CSV after the other series", () => {
    const trace = simulate(decay(), { end: 1, points: 2 });
    const csv = traceToCsv(trace);
    expect(csv.split("\n")[0]).toBe("Time,A,B,t,total,twiceA,flux");
    expect(traceToCsv(trace, { kinds: ["observer"] }).split("\n")[0]).toBe("Time,total,twiceA,flux");
  });

  it("report evaluation errors", () => {
    const net = decay();
    net.declarations.observers = [{ name: "bad", kind: "place", expression: "A +" }];
    expect(() => simulate(net, { end: 1 })).toThrow(/Observer bad/);
  });
});
