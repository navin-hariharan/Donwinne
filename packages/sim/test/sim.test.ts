import { describe, expect, it } from "vitest";
import { Net } from "@pns/core";
import {
  Engine,
  MersenneTwister,
  buildModel,
  outputTimes,
  parameterize,
  SIMULATION_LIMITS,
  reachabilityGraph,
  simulate,
  simulateAsync,
  timedDelay,
  timedEnabled,
  timedFire,
  timedInit,
  traceToCsv,
  unfold,
} from "@pns/sim";
import { mk, series } from "./helpers";

const decay = (netClass: Net["netClass"], k = "0.5", a0 = "100") =>
  mk(netClass, [["A", a0], ["B", ""]], [["t", { rate: `MassAction(${k})` }]], [["A", "t"], ["t", "B"]]);

describe("Mersenne Twister", () => {
  it("matches the reference output for seed 5489", () => {
    const mt = new MersenneTwister(5489);
    expect(mt.nextU32()).toBe(3499211612);
    expect(mt.nextU32()).toBe(581869302);
    const r = new MersenneTwister(1).random();
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(1);
  });
});

describe("rate functions", () => {
  it("MassAction uses binomial coefficients in stochastic nets and powers in continuous nets", () => {
    const build = (cls: Net["netClass"]) => {
      const net = mk(cls, [["A", "5"], ["E", "3"], ["B", ""]], [["t", { rate: "MassAction(2)" }]], [["A", "t", "2"], ["E", "t", "1", "read"], ["t", "B"]]);
      const model = buildModel(net);
      const x = parameterize(model, { start: 0, end: 1 });
      const eng = new Engine(model, { times: outputTimes(0, 1, 2), solver: "rk45", atol: 1e-8, rtol: 1e-6, step: 0.1, maxSteps: 1e6 });
      return { eng, t: model.transitions[0], x };
    };
    const s = build("stochastic");
    expect(s.eng.propensity(s.t, s.x)).toBeCloseTo(2 * 10 * 3); // 2 * C(5,2) * C(3,1)
    const c = build("continuous");
    expect(c.eng.flux(c.t, c.x)).toBeCloseTo(2 * 25 * 3); // 2 * 5^2 * 3
  });

  it("supports BioLevelInterpretation, MichaelisMenten and arbitrary expressions", () => {
    const net = mk(
      "continuous",
      [["S", "4"], ["P", ""]],
      [
        ["t1", { rate: "BioLevelInterpretation(2, 4)" }],
        ["t2", { rate: "MichaelisMenten(10, 4)" }],
        ["t3", { rate: "k * S / (1 + S) + max(1, 2)" }],
      ],
      [["S", "t1"], ["S", "t2"], ["S", "t3"], ["t1", "P"]],
      [["k", "5"]],
    );
    const model = buildModel(net);
    const x = parameterize(model, { start: 0, end: 1 });
    const eng = new Engine(model, { times: outputTimes(0, 1, 2), solver: "rk45", atol: 1e-8, rtol: 1e-6, step: 0.1, maxSteps: 1e6 });
    expect(eng.flux(model.transitions[0], x)).toBeCloseTo(2 * 4 * (4 / 4));
    expect(eng.flux(model.transitions[1], x)).toBeCloseTo((10 * 4) / 8);
    expect(eng.flux(model.transitions[2], x)).toBeCloseTo((5 * 4) / 5 + 2);
  });
});

describe("continuous simulation", () => {
  for (const solver of ["rk45", "rosenbrock", "rk4"] as const) {
    it(`exponential decay matches A0 e^-kt (${solver})`, () => {
      const trace = simulate(decay("continuous"), { end: 10, points: 101, solver, step: solver === "rk4" ? 0.01 : undefined });
      const A = series(trace, "A").values;
      const B = series(trace, "B").values;
      trace.times.forEach((t, i) => {
        expect(Math.abs(A[i] - 100 * Math.exp(-0.5 * t))).toBeLessThan(solver === "rosenbrock" ? 1e-3 : 1e-4);
        expect(A[i] + B[i]).toBeCloseTo(100, 6);
      });
      const flux = series(trace, "t");
      expect(flux.measure).toBe("flux");
      expect(flux.values[0]).toBeCloseTo(50);
    });
  }

  it("explicit Euler converges roughly", () => {
    const trace = simulate(decay("continuous"), { end: 2, points: 3, solver: "euler", step: 1e-4 });
    expect(series(trace, "A").values[2]).toBeCloseTo(100 * Math.exp(-1), 1);
  });

  it("Lotka–Volterra oscillates and conserves its first integral", () => {
    const a = 1, b = 0.1, c = 1.5;
    const net = mk(
      "continuous",
      [["X", "10"], ["Y", "5"]],
      [["birth", { rate: `MassAction(${a})` }], ["predation", { rate: `MassAction(${b})` }], ["death", { rate: `MassAction(${c})` }]],
      [["X", "birth"], ["birth", "X", "2"], ["X", "predation"], ["Y", "predation"], ["predation", "Y", "2"], ["Y", "death"]],
    );
    const trace = simulate(net, { end: 30, points: 601 });
    const X = series(trace, "X").values;
    const Y = series(trace, "Y").values;
    const H = (x: number, y: number) => b * x - c * Math.log(x) + b * y - a * Math.log(y);
    const H0 = H(10, 5);
    let maxima = 0;
    for (let i = 0; i < X.length; i++) {
      expect(X[i]).toBeGreaterThan(0);
      expect(Y[i]).toBeGreaterThan(0);
      expect(Math.abs(H(X[i], Y[i]) - H0)).toBeLessThan(1e-4 * Math.abs(H0) + 1e-5);
      if (i > 0 && i < X.length - 1 && X[i] > X[i - 1] && X[i] >= X[i + 1]) maxima++;
    }
    expect(maxima).toBeGreaterThanOrEqual(3);
  });

  it("an inhibitor arc stops a continuous flow at its threshold", () => {
    const net = mk("continuous", [["A", "10"], ["B", ""]], [["t", { rate: "1" }]], [["A", "t"], ["t", "B"], ["B", "t", "5", "inhibitor"]]);
    const trace = simulate(net, { end: 20, points: 21 });
    const B = series(trace, "B").values;
    expect(B[2]).toBeCloseTo(2, 5);
    expect(Math.abs(B[20] - 5)).toBeLessThan(1e-3);
    expect(series(trace, "A").values[20] + B[20]).toBeCloseTo(10, 6);
  });

  it("a constant flow stops when its pre-place is empty", () => {
    const net = mk("continuous", [["A", "3"], ["B", ""]], [["t", { rate: "1" }]], [["A", "t"], ["t", "B"]]);
    const trace = simulate(net, { end: 10, points: 11 });
    expect(series(trace, "A").values[10]).toBeLessThan(1e-6);
    expect(series(trace, "B").values[10]).toBeCloseTo(3, 4);
  });

  it("solves the stiff Robertson problem with the Rosenbrock solver", () => {
    const net = mk(
      "continuous",
      [["A", "1"], ["B", "0"], ["C", "0"]],
      [["r1", { rate: "MassAction(0.04)" }], ["r2", { rate: "MassAction(3e7)" }], ["r3", { rate: "MassAction(1e4)" }]],
      [["A", "r1"], ["r1", "B"], ["B", "r2", "2"], ["r2", "B"], ["r2", "C"], ["B", "r3"], ["C", "r3"], ["r3", "A"], ["r3", "C"]],
    );
    const trace = simulate(net, { end: 40, points: 5, solver: "rosenbrock", rtol: 1e-4, atol: 1e-10, maxSteps: 20000 });
    expect(trace.truncated).toBe(false);
    expect(series(trace, "A").values[4]).toBeCloseTo(0.7158, 2);
    expect(series(trace, "C").values[4]).toBeCloseTo(0.2842, 2);
    expect(trace.stats.steps).toBeLessThan(5000);
  });
});

describe("simulation options", () => {
  const net = decay("stochastic");
  it.each([
    ["an infinite end time", { end: Infinity }, /end time must be a finite number/],
    ["a NaN start time", { end: 5, start: NaN }, /start time must be a finite number/],
    ["a NaN number of points", { end: 5, points: NaN }, /output points must be a finite number/],
    ["too many points", { end: 5, points: SIMULATION_LIMITS.points + 1 }, /output points must be a whole number from 2 to 1,000,000/],
    ["zero runs", { end: 5, runs: 0 }, /number of runs must be a whole number from 1/],
    ["too many runs", { end: 5, runs: SIMULATION_LIMITS.runs + 1 }, /number of runs/],
    ["a negative step", { end: 5, step: -1 }, /step size must be positive/],
    ["an infinite step", { end: 5, step: Infinity }, /step size must be a finite number/],
    ["a zero tolerance", { end: 5, atol: 0 }, /absolute tolerance must be positive/],
    ["a NaN relative tolerance", { end: 5, rtol: NaN }, /relative tolerance must be a finite number/],
    ["a zero step limit", { end: 5, maxSteps: 0 }, /maximum number of steps/],
    ["an infinite step limit", { end: 5, maxSteps: Infinity }, /maximum number of steps must be a finite number/],
  ])("rejects %s", (_, o, msg) => {
    expect(() => simulate(net, o as { end: number })).toThrow(msg);
  });

  it("rejects results larger than the output budget", () => {
    expect(() => simulate(net, { end: 5, points: 1_000_000, runs: 5, keepRuns: true, seed: 1 })).toThrow(/limit is 5,000,000/);
  });
});

describe("stochastic simulation", () => {
  it("averaged Gillespie runs approximate the decay curve", () => {
    const trace = simulate(decay("stochastic"), { end: 6, points: 13, runs: 400, seed: 7 });
    const A = series(trace, "A").values;
    trace.times.forEach((t, i) => expect(Math.abs(A[i] - 100 * Math.exp(-0.5 * t))).toBeLessThan(1.5));
    // Firings per interval add up to the tokens moved.
    const fired = series(trace, "t").values.reduce((s, v) => s + v, 0);
    expect(fired).toBeCloseTo(100 - A[A.length - 1], 6);
  });

  it("is reproducible with a seed", () => {
    const o = { end: 5, points: 11, seed: 42 };
    const a = simulate(decay("stochastic"), o);
    const b = simulate(decay("stochastic"), o);
    const c = simulate(decay("stochastic"), { ...o, seed: 43 });
    expect(series(a, "A").values).toEqual(series(b, "A").values);
    expect(series(a, "A").values).not.toEqual(series(c, "A").values);
    expect(series(a, "A").values.every(Number.isInteger)).toBe(true);
  });

  it("keeps per-run traces on request", () => {
    const trace = simulate(decay("stochastic"), { end: 2, points: 5, runs: 3, seed: 1, keepRuns: true });
    expect(trace.runs).toHaveLength(3);
    const mean = trace.runs!.map((r) => r.series[0].values[4]).reduce((s, v) => s + v, 0) / 3;
    expect(series(trace, "A").values[4]).toBeCloseTo(mean, 10);
  });

  it("fires immediate transitions before stochastic ones, chosen by weight", () => {
    const net = mk(
      "stochastic",
      [["P", "1"], ["Q", ""], ["R", ""], ["S", ""]],
      [["i1", { kind: "immediate", rate: "1" }], ["i2", { rate: "ImmediateFiring(3)" }], ["s", { rate: "MassAction(1000)" }]],
      [["P", "i1"], ["i1", "Q"], ["P", "i2"], ["i2", "R"], ["P", "s"], ["s", "S"]],
    );
    const trace = simulate(net, { end: 1, points: 2, runs: 2000, seed: 3 });
    expect(series(trace, "S").values[1]).toBe(0);
    expect(series(trace, "P").values[0]).toBe(0);
    expect(series(trace, "R").values[1]).toBeGreaterThan(0.71);
    expect(series(trace, "R").values[1]).toBeLessThan(0.79);
  });

  it("fires deterministic and scheduled transitions at the exact time", () => {
    const net = mk(
      "stochastic",
      [["P", "1"], ["Q", ""], ["R", ""], ["E", "1"]],
      [["d", { kind: "deterministic", rate: "2.5" }], ["sch", { rate: "FixedTimedFiring_Periodic(1, 1, 3)" }]],
      [["P", "d"], ["d", "Q"], ["E", "sch", "1", "read"], ["sch", "R"]],
    );
    const trace = simulate(net, { end: 5, points: 11, seed: 1 });
    const Q = series(trace, "Q").values;
    expect(Q[4]).toBe(0); // t = 2
    expect(Q[5]).toBe(1); // t = 2.5
    expect(series(trace, "d").values[5]).toBe(1);
    expect(series(trace, "R").values).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 3, 3, 3]);
  });

  it("restarts a deterministic clock when the transition is disabled", () => {
    // d needs P and is blocked by B; B is set at time 1 by a scheduled transition and removed at 2.
    const net = mk(
      "stochastic",
      [["P", "1"], ["B", ""], ["Q", ""]],
      [["d", { rate: "TimedFiring(1.5)" }], ["on", { rate: "FixedTimedFiring_Single(1)" }], ["off", { rate: "FixedTimedFiring_Single(2)" }]],
      [["P", "d"], ["d", "Q"], ["B", "d", "1", "inhibitor"], ["on", "B"], ["B", "off"]],
    );
    const trace = simulate(net, { end: 4, points: 9, seed: 1 });
    // Enabled at 0, disabled at 1 (before 1.5), re-enabled at 2: fires at 3.5.
    expect(series(trace, "Q").values).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 1]);
  });

  it("respects read, reset and equal arcs and capacities", () => {
    const net = mk(
      "stochastic",
      [["S", "3"], ["T", "2", { capacity: 4 }], ["G", "1"], ["Z", "0"]],
      [["fill", { rate: "100" }], ["clear", { rate: "1" }]],
      [["G", "fill", "1", "read"], ["fill", "T"], ["T", "clear", "4", "equal"], ["S", "clear", "", "reset"], ["clear", "Z"]],
    );
    const trace = simulate(net, { end: 50, points: 3, seed: 5 });
    // fill stops at the capacity 4; then clear fires once (T = 4 exactly), resetting S.
    expect(series(trace, "S").values[2]).toBe(0);
    expect(series(trace, "T").values[2]).toBe(4);
    expect(series(trace, "Z").values[2]).toBeGreaterThanOrEqual(1);
  });

  it("is fast: 100 places, over 10k events, well under a second", () => {
    const n = 100;
    const places: [string, string][] = Array.from({ length: n }, (_, i) => [`p${i}`, "10"]);
    const trans: [string, { rate: string }][] = Array.from({ length: n }, (_, i) => [`t${i}`, { rate: "MassAction(1)" }]);
    const arcs: [string, string][] = [];
    for (let i = 0; i < n; i++) arcs.push([`p${i}`, `t${i}`], [`t${i}`, `p${(i + 1) % n}`]);
    const net = mk("stochastic", places, trans, arcs);
    const t0 = performance.now();
    const trace = simulate(net, { end: 12, points: 101, seed: 1 });
    const ms = performance.now() - t0;
    expect(trace.stats.events).toBeGreaterThan(10_000);
    expect(ms).toBeLessThan(1000);
    const total = trace.series.filter((s) => s.kind === "place").reduce((s, x) => s + x.values[100], 0);
    expect(total).toBe(1000);
  });

  it("stops at maxSteps and marks the trace truncated", () => {
    const trace = simulate(decay("stochastic", "1", "1000"), { end: 100, points: 11, seed: 1, maxSteps: 10 });
    expect(trace.truncated).toBe(true);
    expect(Number.isNaN(series(trace, "A").values[10])).toBe(true);
  });

  it("detects immediate transitions that fire forever", () => {
    const net = mk("stochastic", [["P", "1"]], [["i", { kind: "immediate" }]], [["P", "i"], ["i", "P"]]);
    expect(() => simulate(net, { end: 1 })).toThrow(/without time passing/);
  });

  it("can be aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(simulateAsync(decay("stochastic", "1", "100000"), { end: 100, signal: ac.signal, seed: 1 })).rejects.toThrow(/aborted/);
  });

  it("reports progress", () => {
    const seen: number[] = [];
    simulate(decay("stochastic"), { end: 5, runs: 4, seed: 1, onProgress: (f) => seen.push(f) });
    expect(seen[seen.length - 1]).toBe(1);
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1])).toBe(true);
  });
});

describe("hybrid simulation", () => {
  it("stochastic propensities follow continuous places over time", () => {
    // C grows linearly (C(t) = t); s fires with hazard C(t), so E[firings by T] = T^2 / 2.
    const net = mk(
      "hybrid",
      [["C", "0", { continuous: true }], ["D", ""]],
      [["grow", { kind: "continuous", rate: "1" }], ["s", { kind: "stochastic", rate: "C" }], ["r", { kind: "stochastic", rate: "MassAction(1)" }]],
      [["grow", "C"], ["s", "D"], ["C", "r", "1", "read"], ["r", "E"]],
    );
    net.places.push({ id: "E", name: "E", x: 0, y: 0, marking: "" });
    const trace = simulate(net, { end: 4, points: 5, runs: 400, seed: 11 });
    expect(series(trace, "C").values[4]).toBeCloseTo(4, 6);
    expect(Math.abs(series(trace, "D").values[4] - 8)).toBeLessThan(0.6);
    expect(Math.abs(series(trace, "D").values[2] - 2)).toBeLessThan(0.3);
    // r has a read arc of weight 1 from C: enabled only once C >= 1, so E[E(T)] = (T^2 - 1) / 2.
    expect(series(trace, "E").values[1]).toBe(0);
    expect(Math.abs(series(trace, "E").values[4] - 7.5)).toBeLessThan(0.6);
  });

  it("discrete transitions move continuous tokens and continuous flows drain them", () => {
    // Every 1 time unit a scheduled transition adds 10 to C; C decays continuously with rate 1.
    const net = mk(
      "hybrid",
      [["C", "0", { continuous: true }], ["W", "", { continuous: true }]],
      [["pulse", { kind: "scheduled", rate: "1, 1, 3" }], ["drain", { kind: "continuous", rate: "MassAction(1)" }]],
      [["pulse", "C", "10"], ["C", "drain"], ["drain", "W"]],
    );
    const trace = simulate(net, { end: 4, points: 9 });
    const C = series(trace, "C").values;
    expect(C[1]).toBe(0);
    expect(C[2]).toBeCloseTo(10, 6); // right after the first pulse at t = 1
    expect(C[3]).toBeCloseTo(10 * Math.exp(-0.5), 5);
    const total = C[8] + series(trace, "W").values[8];
    expect(total).toBeCloseTo(30, 5);
  });
});

describe("coloured nets", () => {
  const coloured = (): Net => {
    const net = mk(
      "colouredContinuous",
      [["A", "10`a ++ 20`b ++ 5`c", { colourSet: "C" }], ["B", "", { colourSet: "C" }]],
      [["t", { rate: "MassAction(1)", guard: "x <> c" }]],
      [["A", "t", "x"], ["t", "B", "x"]],
    );
    net.declarations.colourSets.push({ name: "C", type: "enum", values: ["a", "b", "c"] });
    net.declarations.variables.push({ name: "x", colourSet: "C" });
    return net;
  };

  it("unfolds places per colour and transitions per valid binding", () => {
    const { net, mapping } = unfold(coloured());
    expect(net.netClass).toBe("continuous");
    expect(net.places.map((p) => p.name).sort()).toEqual(["A_a", "A_b", "A_c", "B_a", "B_b", "B_c"]);
    expect(net.transitions.map((t) => t.name)).toEqual(["t_a", "t_b"]);
    expect(net.places.find((p) => p.name === "A_b")!.marking).toBe("20");
    expect(mapping.transitions[1].binding).toEqual({ x: "b" });
    expect(net.arcs).toHaveLength(4);
  });

  it("simulates like the hand-unfolded net and aggregates per coloured place", () => {
    const hand = mk(
      "continuous",
      [["A_a", "10"], ["A_b", "20"], ["A_c", "5"], ["B_a", ""], ["B_b", ""], ["B_c", ""]],
      [["t_a", { rate: "MassAction(1)" }], ["t_b", { rate: "MassAction(1)" }]],
      [["A_a", "t_a"], ["t_a", "B_a"], ["A_b", "t_b"], ["t_b", "B_b"]],
    );
    const a = simulate(coloured(), { end: 3, points: 7 });
    const b = simulate(hand, { end: 3, points: 7 });
    for (const name of ["A_a", "A_b", "A_c", "B_a", "B_b"]) expect(series(a, name).values).toEqual(series(b, name).values);
    const aggA = series(a, "A", true).values;
    a.times.forEach((t, i) => expect(aggA[i]).toBeCloseTo(30 * Math.exp(-t) + 5, 4));
    const perColour = a.series.filter((s) => s.colouredId === "A");
    expect(perColour.map((s) => s.colour)).toEqual(["a", "b", "c"]);
  });

  it("substitutes variables and coloured place names in rates", () => {
    const net = mk(
      "colouredStochastic",
      [["A", "1`1 ++ 2`2", { colourSet: "N" }], ["B", "", { colourSet: "N" }]],
      [["t", { rate: "x * A" }]],
      [["A", "t", "x"], ["t", "B", "x"]],
    );
    net.declarations.colourSets.push({ name: "N", type: "int", min: 1, max: 2 });
    net.declarations.variables.push({ name: "x", colourSet: "N" });
    const { net: u } = unfold(net);
    expect(u.transitions.map((t) => t.rate)).toEqual(["(1 * A_1)", "(2 * A_2)"]);
    const trace = simulate(net, { end: 100, points: 2, seed: 1 });
    expect(series(trace, "B", true).values[1]).toBe(3);
  });
});

describe("fuzzy nets", () => {
  it("TFN rate gives a band around the crisp curve that narrows towards alpha = 1", () => {
    const net = mk("fuzzyContinuous", [["A", "100"], ["B", ""]], [["t", { rate: "MassAction(k)" }]], [["A", "t"], ["t", "B"]], [["k", "TFN(0.4, 0.5, 0.6)"]]);
    const trace = simulate(net, { end: 5, points: 11, alphaLevels: [0, 0.5, 1], samplesPerLevel: 5, seed: 1 });
    const A = series(trace, "A");
    expect(A.bands!.map((b) => b.alpha)).toEqual([0, 0.5, 1]);
    const width = (alpha: number) => {
      const b = A.bands!.find((x) => x.alpha === alpha)!;
      return b.upper.reduce((s, u, i) => s + u - b.lower[i], 0);
    };
    trace.times.forEach((t, i) => {
      const crisp = 100 * Math.exp(-0.5 * t);
      expect(Math.abs(A.values[i] - crisp)).toBeLessThan(1e-4);
      for (const b of A.bands!) {
        expect(b.lower[i]).toBeLessThanOrEqual(crisp + 1e-4);
        expect(b.upper[i]).toBeGreaterThanOrEqual(crisp - 1e-4);
      }
      const b0 = A.bands![0];
      expect(b0.lower[i]).toBeCloseTo(100 * Math.exp(-0.6 * t), 3);
      expect(b0.upper[i]).toBeCloseTo(100 * Math.exp(-0.4 * t), 3);
    });
    expect(width(0)).toBeGreaterThan(width(0.5));
    expect(width(0.5)).toBeGreaterThan(width(1));
    expect(width(1)).toBeLessThan(1e-6);
  });
});

describe("timed nets", () => {
  const net = () =>
    mk(
      "timed",
      [["P", "1"], ["Q", ""], ["R", "1"]],
      [["t1", { interval: ["2", "4"] }], ["t2", { interval: ["1", "inf"] }]],
      [["P", "t1"], ["t1", "Q"], ["R", "t2"], ["t2", "R"]],
    );

  it("enforces earliest and latest firing times", () => {
    let s = timedInit(net());
    let e = timedEnabled(s);
    expect(e.fireable).toHaveLength(0);
    expect(e.maxDelay).toBe(4);
    expect(e.minDelay).toBe(1);
    expect(() => timedFire(s, "t1")).toThrow(/after 2/);
    expect(() => timedDelay(s, 5)).toThrow();
    s = timedDelay(s, 1);
    expect(timedEnabled(s).fireable.map((x) => x.name)).toEqual(["t2"]);
    // t2 fires and is newly enabled (clock 0); t1 keeps its clock.
    s = timedFire(s, "t2");
    expect(s.clocks).toEqual([1, 0]);
    s = timedDelay(s, 1.5);
    e = timedEnabled(s);
    expect(e.fireable.map((x) => x.name)).toEqual(["t1", "t2"]);
    expect(e.maxDelay).toBeCloseTo(1.5);
    s = timedFire(s, "t1");
    expect(s.time).toBeCloseTo(2.5);
    expect(s.clocks[0]).toBeUndefined();
    expect(timedEnabled(s).maxDelay).toBe(Infinity);
  });
});

describe("reachability graph", () => {
  it("enumerates the states of a bounded net", () => {
    const net = mk("pt", [["p1", "2"], ["p2", ""]], [["t", {}], ["u", {}]], [["p1", "t"], ["t", "p2"], ["p2", "u"], ["u", "p1"]]);
    const rg = reachabilityGraph(net);
    expect(rg.truncated).toBe(false);
    expect(rg.states.map((s) => s.marking)).toEqual([
      { p1: "2", p2: "0" },
      { p1: "1", p2: "1" },
      { p1: "0", p2: "2" },
    ]);
    expect(rg.edges).toHaveLength(4);
    expect(rg.edges[0]).toMatchObject({ from: 0, to: 1, label: "t" });
  });

  it("finds dead states and stops at the state limit", () => {
    const dead = reachabilityGraph(mk("pt", [["p", "1"], ["q", ""]], [["t", {}]], [["p", "t"], ["t", "q"]]));
    expect(dead.states.map((s) => s.dead)).toEqual([false, true]);
    const unbounded = reachabilityGraph(mk("pt", [["p", ""]], [["gen", {}]], [["gen", "p"]]), { maxStates: 5 });
    expect(unbounded.truncated).toBe(true);
    expect(unbounded.states).toHaveLength(5);
  });
});

describe("CSV export", () => {
  it("writes a Snoopy-like table", () => {
    const trace = simulate(decay("continuous"), { end: 1, points: 3 });
    const csv = traceToCsv(trace, { kinds: ["place"], precision: 6 });
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("Time,A,B");
    expect(lines[1]).toBe("0,100,0");
    expect(lines).toHaveLength(4);
    const semi = traceToCsv(trace, { separator: ";", decimalComma: true, ids: ["A"], precision: 4 });
    expect(semi.split("\n")[2]).toBe("0,5;77,88");
  });
});
