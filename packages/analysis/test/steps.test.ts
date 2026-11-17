// Maximal-step graphs: search budget, unsupported arcs, arc-kind semantics, and a brute-force
// cross-check of the enumeration (including its pruning) against the definition.
import { describe, expect, it } from "vitest";
import { buildTransitionSystem, checkCtl, deadStates, labelText, stepSemanticsSupport, stepStats, stepSystem, toPTNet, type PTNet, type TransitionSystem } from "@pns/analysis";
import { mk, type A, type P, type T } from "./nets";

/** n transitions t_i, each with its own marked input place and an output place. */
function independent(n: number) {
  const places: P[] = [];
  const transitions: T[] = [];
  const arcs: A[] = [];
  for (let i = 0; i < n; i++) {
    places.push([`a${i}`, "1"], [`b${i}`, ""]);
    transitions.push([`t${i}`]);
    arcs.push([`a${i}`, `t${i}`], [`t${i}`, `b${i}`]);
  }
  return mk("pt", places, transitions, arcs);
}

/** n independent conflicts: place c_i with one token shared by l_i and r_i (2^n maximal steps). */
function conflicts(n: number) {
  const places: P[] = [];
  const transitions: T[] = [];
  const arcs: A[] = [];
  for (let i = 0; i < n; i++) {
    places.push([`c${i}`, "1"]);
    transitions.push([`l${i}`], [`r${i}`]);
    arcs.push([`c${i}`, `l${i}`], [`c${i}`, `r${i}`]);
  }
  return mk("pt", places, transitions, arcs);
}

describe("maximal-step search budget", () => {
  for (const n of [15, 20, 25, 30])
    it(`${n} independent transitions: one maximal step, linear search`, () => {
      const t0 = performance.now();
      const ts = stepSystem(toPTNet(independent(n)));
      const ms = performance.now() - t0;
      expect(ts.complete).toBe(true);
      expect([ts.markings.length, ts.edgeTo.length]).toEqual([2, 1]);
      expect(ts.labels[ts.edgeLabel[0]].length).toBe(n);
      // Before the pruning this took 2^n leaves (about 10^9 at n = 30).
      expect(stepStats(ts)!.searchNodes).toBeLessThan(10 * (n + 2));
      expect(ms).toBeLessThan(2000);
    });

  it("stops a runaway enumeration at the search budget and leaves the state open", () => {
    // 20 conflicts: 2^20 maximal steps, far beyond the default step limit and this search budget.
    const ts = stepSystem(toPTNet(conflicts(20)), { maxSearchNodesPerState: 5000, maxStepsPerState: 1e9 });
    expect(ts.complete).toBe(false);
    expect(ts.open?.[0]).toBe(1);
    expect(stepStats(ts)!.stopped).toEqual({ states: false, steps: 0, search: 1 });
    expect(ts.notes.join(" ")).toMatch(/search-effort limit/);
    // Unknown stays unknown: the open initial state is never a deadlock, and what its missing
    // successors could change is not decided (EX(c0 = 1) is false in truth, but not proven here).
    expect(deadStates(ts)).not.toContain(0);
    expect(checkCtl(ts, "EX(c0 = 1)").status).toBe("unknown");
    // What the steps found do show stays conclusive.
    expect(checkCtl(ts, "AG(c0 = 1)").status).toBe("false");
  });

  it("names the step limit when that is what stopped it", () => {
    const ts = stepSystem(toPTNet(conflicts(12)), { maxStepsPerState: 100 });
    expect(ts.complete).toBe(false);
    expect(stepStats(ts)!.stopped.steps).toBe(1);
    expect(ts.notes.join(" ")).toMatch(/step limit/);
  });

  it("all steps of 30 independent transitions are cut by the step limit, quickly", () => {
    const t0 = performance.now();
    const ts = stepSystem(toPTNet(independent(30)), { maximalOnly: false, maxStepsPerState: 2000 });
    expect(ts.complete).toBe(false);
    expect(stepStats(ts)!.stopped.steps).toBe(1);
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it("checks for cancellation inside one state's search", () => {
    let reads = 0;
    const signal = { get aborted() { return ++reads > 2; } } as AbortSignal;
    expect(() => stepSystem(toPTNet(conflicts(24)), { signal, maxStepsPerState: 1e9, maxSearchNodesPerState: 1e9 })).toThrow(/aborted/);
    expect(reads).toBe(3);
  });
});

describe("arcs that step semantics does not support", () => {
  it("rejects reset arcs next to normal arcs with the arc and the reason", () => {
    const net = mk("xpt", [["p", "2"], ["q", ""]], [["t"], ["u"]], [["p", "t"], ["t", "q"], ["p", "u", "1", "reset"]]);
    const s = stepSemanticsSupport(toPTNet(net));
    expect(s.ok).toBe(false);
    expect(s.problems).toHaveLength(1);
    expect(s.problems[0]).toMatchObject({ arcId: "a2", label: "p → u" });
    expect(s.problems[0].reason).toMatch(/reset arc/);
    expect(() => stepSystem(toPTNet(net))).toThrow(/not available.*p → u is a reset arc/);
    expect(() => buildTransitionSystem(net, { semantics: "maximalSteps" })).toThrow(/reset arc/);
  });

  it("rejects marking-dependent weights", () => {
    const net = mk("xpt", [["p", "3"], ["q", ""]], [["t"]], [["p", "t", "p"], ["t", "q"]]);
    const s = stepSemanticsSupport(toPTNet(net));
    expect(s.problems.map((x) => x.reason)).toEqual([expect.stringMatching(/marking-dependent/)]);
  });

  it("accepts normal, read, inhibitor and equal arcs", () => {
    const net = mk("xpt", [["p", "2"], ["q", ""]], [["t"]], [["p", "t"], ["p", "t", "2", "read"], ["q", "t", "1", "inhibitor"], ["p", "t", "2", "equal"]]);
    expect(stepSemanticsSupport(toPTNet(net))).toEqual({ ok: true, problems: [] });
  });
});

describe("arc kinds under maximal steps", () => {
  const steps = (ts: TransitionSystem, s = 0) => {
    const out: string[] = [];
    for (let e = ts.edgeStart[s]; e < ts.edgeStart[s + 1]; e++) out.push(labelText(ts, ts.edgeLabel[e]));
    return out.sort();
  };

  it("equal arc of weight 2: a test at the marking before the step", () => {
    const at = (m: string) => stepSystem(toPTNet(mk("xpt", [["p", m], ["q", "1"], ["r", ""]], [["t"]], [["q", "t"], ["p", "t", "2", "equal"], ["t", "r"]])));
    expect(steps(at("2"))).toEqual(["t"]);
    expect(steps(at("1"))).toEqual([]);
    expect(steps(at("3"))).toEqual([]);
  });

  it("read and normal arc on the same place: both conditions hold together", () => {
    // t reads 2 tokens on p and consumes 1. Tested before the step: at p = 1 t is disabled;
    // at p = 2 two occurrences fit (each reads 2 at M, together they consume 2).
    const at = (m: string) => stepSystem(toPTNet(mk("xpt", [["p", m], ["q", ""]], [["t"]], [["p", "t"], ["p", "t", "2", "read"], ["t", "q"]])));
    expect(steps(at("1"))).toEqual([]);
    expect(steps(at("2"))).toEqual(["{2·t}"]);
    expect(steps(at("3"))).toEqual(["{3·t}"]);
    const noAuto = stepSystem(toPTNet(mk("xpt", [["p", "3"], ["q", ""]], [["t"]], [["p", "t"], ["p", "t", "2", "read"], ["t", "q"]])), { autoConcurrency: false });
    // One occurrence per step: 3 → 2 → (1: read fails) stop.
    expect(noAuto.markings.map((m) => m[0])).toEqual([3, 2, 1]);
  });

  it("inhibitor arc of weight 2 blocks from 2 tokens on", () => {
    const at = (m: string) => stepSystem(toPTNet(mk("xpt", [["p", m], ["q", "1"], ["r", ""]], [["t"]], [["q", "t"], ["p", "t", "2", "inhibitor"], ["t", "r"]])));
    expect(steps(at("0"))).toEqual(["t"]);
    expect(steps(at("1"))).toEqual(["t"]);
    expect(steps(at("2"))).toEqual([]);
  });

  it("capacities: a full place may lose tokens, may not gain them, and an over-full start is an error", () => {
    const cap = (c: number) => ({ capacity: c }) as Partial<P[2]>;
    // p is full (2 of 2): t takes one from p and puts it back plus one more → p would be 3.
    const grow = mk("pt", [["p", "2", cap(2)], ["q", "1"]], [["t"]], [["p", "t"], ["q", "t"], ["t", "p", "2"]]);
    expect(steps(stepSystem(toPTNet(grow)))).toEqual([]);
    // u reduces the full place while t refills it in the same step: the result (2) fits.
    const swap = mk("pt", [["p", "2", cap(2)], ["q", "1"], ["r", ""]], [["t"], ["u"]], [["q", "t"], ["t", "p"], ["p", "u"], ["u", "r"]]);
    expect(steps(stepSystem(toPTNet(swap)))).toEqual(["{t, 2·u}"]);
    // A marking above the capacity is not a state of the net: rejected before any analysis.
    const over = mk("pt", [["p", "3", cap(1)], ["q", ""]], [["t"]], [["p", "t"], ["t", "q"]]);
    expect(stepSemanticsSupport(toPTNet(over)).problems[0].reason).toMatch(/exceeds its capacity/);
  });

  it("auto-concurrency: multiplicities in the labels", () => {
    const net = mk("pt", [["p", "5"], ["q", ""]], [["t"], ["u"]], [["p", "t", "2"], ["p", "u"], ["t", "q"]]);
    // Maximal steps at p = 5: {2·t, u}, {t, 3·u}, {5·u}.
    expect(steps(stepSystem(toPTNet(net)))).toEqual(["{2·t, u}", "{5·u}", "{t, 3·u}"]);
    expect(steps(stepSystem(toPTNet(net), { autoConcurrency: false }))).toEqual(["{t, u}"]);
  });

  it("a step extended only by two transitions together is not maximal", () => {
    // q and r are full (capacity 1). t: r → q and u: q → r each overflow alone but not together.
    // {v} cannot be extended by t or u alone, yet {v, t, u} is enabled, so {v} is not maximal.
    const cap = { capacity: 1 } as Partial<P[2]>;
    const net = mk("pt", [["q", "1", cap], ["r", "1", cap], ["a", "1"], ["x", "1"], ["y", "1"]], [["t"], ["u"], ["v"]], [
      ["x", "t"], ["t", "q"], ["r", "t"], ["y", "u"], ["u", "r"], ["q", "u"], ["a", "v"],
    ]);
    expect(steps(stepSystem(toPTNet(net)))).toEqual(["{t, u, v}"]);
  });
});

// ---- Brute-force cross-check of the enumeration against the definition --------------------------

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function randomNet(seed: number) {
  const r = rng(seed);
  const nP = 2 + Math.floor(r() * 3);
  const nT = 2 + Math.floor(r() * 3);
  const places: P[] = [];
  for (let p = 0; p < nP; p++) places.push([`p${p}`, String(Math.floor(r() * 4)), r() < 0.3 ? ({ capacity: 1 + Math.floor(r() * 3) } as Partial<P[2]>) : undefined]);
  const transitions: T[] = Array.from({ length: nT }, (_, t) => [`t${t}`]);
  const arcs: A[] = [];
  const kinds = ["normal", "normal", "read", "inhibitor", "equal"] as const;
  for (let t = 0; t < nT; t++)
    for (let p = 0; p < nP; p++) {
      if (r() < 0.45) {
        const kind = kinds[Math.floor(r() * kinds.length)];
        arcs.push([`p${p}`, `t${t}`, String(kind === "equal" ? Math.floor(r() * 3) : 1 + Math.floor(r() * 2)), kind]);
      }
      if (r() < 0.35) arcs.push([`t${t}`, `p${p}`, String(1 + Math.floor(r() * 2))]);
    }
  return mk("xpt", places, transitions, arcs);
}

/** Maximal steps at M straight from the definition: enumerate every multiset, keep the enabled ones not strictly below another. */
function bruteSteps(pt: PTNet, M: ArrayLike<number>, auto: boolean): { step: number[]; to: number[] }[] {
  const nT = pt.transitions.length;
  const bound = (t: number) => {
    const ins = pt.arcs.filter((a) => a.transition === t && a.kind === "normal" && a.dir === "in");
    if (!ins.length || !auto) return 1;
    return Math.min(...ins.map((a) => Math.floor(M[a.place] / a.weight!)));
  };
  const enabled = (U: number[]) => {
    const N = Array.from(M);
    const used = new Array(N.length).fill(0);
    for (const a of pt.arcs) {
      const k = U[a.transition];
      if (!k) continue;
      const w = a.weight!;
      if (a.kind === "normal") N[a.place] += (a.dir === "in" ? -w : w) * k;
      if (a.kind === "normal" && a.dir === "in") used[a.place] += w * k;
      else if (a.kind === "read" && w > 0 && M[a.place] < w) return null;
      else if (a.kind === "inhibitor" && w > 0 && M[a.place] >= w) return null;
      else if (a.kind === "equal" && M[a.place] !== w) return null;
    }
    if (used.some((x, p) => x > M[p])) return null;
    for (let p = 0; p < N.length; p++) {
      const c = pt.capacity[p];
      if (c !== undefined && N[p] > c && N[p] > M[p]) return null;
    }
    return N;
  };
  const all: { step: number[]; to: number[] }[] = [];
  const U = new Array(nT).fill(0);
  const rec = (t: number) => {
    if (t === nT) {
      if (U.some((x) => x > 0)) {
        const N = enabled(U);
        if (N) all.push({ step: [...U], to: N });
      }
      return;
    }
    for (let k = 0; k <= bound(t); k++) {
      U[t] = k;
      rec(t + 1);
    }
    U[t] = 0;
  };
  rec(0);
  const below = (a: number[], b: number[]) => a.every((x, i) => x <= b[i]) && a.some((x, i) => x < b[i]);
  return all.filter((x) => !all.some((y) => below(x.step, y.step)));
}

/** Every (marking, step, marking) of the graph as text, for comparison. */
function edgeSet(ts: TransitionSystem) {
  const out: string[] = [];
  for (let s = 0; s < ts.markings.length; s++)
    for (let e = ts.edgeStart[s]; e < ts.edgeStart[s + 1]; e++) {
      const counts = new Array(ts.transitions.length).fill(0);
      for (const t of ts.labels[ts.edgeLabel[e]]) counts[t]++;
      out.push(`${Array.from(ts.markings[s])}|${counts}|${Array.from(ts.markings[ts.edgeTo[e]])}`);
    }
  return out.sort();
}

function bruteGraph(pt: PTNet, auto: boolean, limit = 300) {
  const seen = new Map<string, number[]>([[String(pt.m0), pt.m0]]);
  const queue = [pt.m0];
  const out: string[] = [];
  while (queue.length && seen.size <= limit) {
    const M = queue.shift()!;
    // Keep the brute force small: give up on nets whose markings grow.
    if (M.some((x) => x > 6)) return { edges: [], complete: false };
    for (const { step, to } of bruteSteps(pt, M, auto)) {
      out.push(`${M}|${step}|${to}`);
      if (!seen.has(String(to))) {
        seen.set(String(to), to);
        queue.push(to);
      }
    }
  }
  return { edges: out.sort(), complete: seen.size <= limit };
}

describe("maximal steps against the definition", () => {
  it("agrees with brute force on 300 random nets with normal, read, inhibitor and equal arcs and capacities", () => {
    let compared = 0;
    for (let seed = 1; compared < 300 && seed < 2000; seed++) {
      const pt = toPTNet(randomNet(seed));
      if (pt.errors.length) continue;
      for (const auto of [true, false]) {
        const brute = bruteGraph(pt, auto);
        if (!brute.complete) continue;
        const ts = stepSystem(pt, { autoConcurrency: auto, maxStates: 1000 });
        expect(ts.complete, `seed ${seed}`).toBe(true);
        expect(edgeSet(ts), `seed ${seed} auto ${auto}`).toEqual(brute.edges);
      }
      compared++;
    }
    expect(compared).toBe(300);
  });
});
