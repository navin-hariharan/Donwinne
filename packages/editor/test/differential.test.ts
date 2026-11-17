// Differential tests of the step semantics: the P/T maximal-step graph (stepSystem), the APN
// concurrent reachability graph with maximal steps, the T-APN's, and the unfolded models, compared
// on reachable markings, maximal steps (labels and multiplicities), deadlocks and reachability
// verdicts, not just on state counts.
import { describe, expect, it } from "vitest";
import type { Net } from "@pns/core";
import { checkCtl, deadStates, stepSystem, toPTNet, transitionSystemFromStepGraph, type TransitionSystem } from "@pns/analysis";
import { ambientGarageFragment, concurrentReachabilityGraph, constructTapn, fig410, fig49, stsIsomorphic, thesisFig3_1, type CapacityRule } from "@pns/apn";

/** Canonical text of every edge: marking (by place name), step (sorted transition names with repeats), marking. */
function canon(ts: TransitionSystem) {
  const mark = (s: number) =>
    ts.places
      .map((p, i) => [p.name, ts.markings[s][i]] as const)
      .filter(([, n]) => n > 0)
      .map(([p, n]) => `${p}=${n}`)
      .sort()
      .join(" ");
  const markings = new Set<string>();
  const edges: string[] = [];
  for (let s = 0; s < ts.markings.length; s++) {
    markings.add(mark(s));
    for (let e = ts.edgeStart[s]; e < ts.edgeStart[s + 1]; e++)
      edges.push(`${mark(s)} | ${ts.labels[ts.edgeLabel[e]].map((t) => ts.transitions[t].name).sort().join(",")} | ${mark(ts.edgeTo[e])}`);
  }
  return { markings: [...markings].sort(), edges: edges.sort(), deadlocks: deadStates(ts).map(mark).sort() };
}

/** The APN's maximal-step CRG as a transition system under unfolded names. */
function apnMaximal(net: Net, capacityRule: CapacityRule = "weak") {
  const g = concurrentReachabilityGraph(net, { maximalOnly: true, capacityRule, maxStates: 20_000 });
  expect(g.complete).toBe(true);
  return transitionSystemFromStepGraph(net, g);
}

/** A one-colour APN from (place, marked) and arcs "p>t", "t>p", "p-ot" (inhibitor), inscribed x over {b}. */
function apn(places: [string, boolean][], arcs: string[]): Net {
  const tnames = new Set<string>();
  const as = arcs.map((s, i) => {
    const inh = s.includes("-o");
    const [a, b] = s.split(inh ? "-o" : ">");
    for (const n of [a, b]) if (!places.some(([p]) => p === n)) tnames.add(n);
    return { id: `a${i}`, source: a, target: b, kind: inh ? ("inhibitor" as const) : ("normal" as const), inscription: "x" };
  });
  return {
    format: "pns/1",
    name: "random",
    netClass: "apn",
    places: places.map(([n, m], i) => ({ id: n, name: n, x: 60 * i, y: 0, marking: m ? "b" : "", colourSet: "B" })),
    transitions: [...tnames].map((n, i) => ({ id: n, name: n, x: 60 * i, y: 100 })),
    arcs: as,
    declarations: { colourSets: [{ name: "B", type: "enum", values: ["b"] }], variables: [{ name: "x", colourSet: "B" }], constants: [] },
  };
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Random one-colour APNs with self-loops, several inputs and inhibitor arcs (capacity 1 per place). */
function randomApn(seed: number): Net {
  const r = rng(seed);
  const nP = 4 + Math.floor(r() * 4);
  const nT = 3 + Math.floor(r() * 3);
  const places: [string, boolean][] = Array.from({ length: nP }, (_, p) => [`p${p}`, r() < 0.5]);
  const arcs: string[] = [];
  const pick = () => `p${Math.floor(r() * nP)}`;
  for (let t = 0; t < nT; t++) {
    const inputs = new Set([pick()]);
    if (r() < 0.4) inputs.add(pick()); // several inputs
    const inhibitors = new Set<string>();
    if (r() < 0.3) {
      const p = pick();
      if (!inputs.has(p)) inhibitors.add(p);
    }
    // Def. 3 allows no arc next to an inhibitor arc of the same place and transition.
    const outputs = new Set<string>();
    for (let k = 0; k < 1 + Math.floor(r() * 2); k++) {
      const p = r() < 0.2 ? [...inputs][0] : pick(); // sometimes a self-loop
      if (!inhibitors.has(p)) outputs.add(p);
    }
    for (const p of inputs) arcs.push(`${p}>t${t}`);
    for (const p of inhibitors) arcs.push(`${p}-ot${t}`);
    for (const p of outputs) arcs.push(`t${t}>${p}`);
  }
  return apn(places, arcs);
}

describe("P/T maximal steps vs the APN CRG (maximal steps)", () => {
  it("agree on 500 random one-colour APNs: markings, steps, deadlocks and EF/AG verdicts", () => {
    let compared = 0;
    let edges = 0;
    let concurrent = 0;
    for (let seed = 1; compared < 500 && seed < 3000; seed++) {
      const net = randomApn(seed);
      const a = apnMaximal(net);
      const pt = toPTNet(net);
      expect(pt.errors, `seed ${seed}`).toEqual([]);
      // APN steps are sets of structured transitions: no auto-concurrency.
      const b = stepSystem(pt, { autoConcurrency: false });
      expect(b.complete).toBe(true);
      const ca = canon(a);
      const cb = canon(b);
      expect(cb.markings, `seed ${seed} markings`).toEqual(ca.markings);
      expect(cb.edges, `seed ${seed} steps`).toEqual(ca.edges);
      expect(cb.deadlocks, `seed ${seed} deadlocks`).toEqual(ca.deadlocks);
      for (const p of pt.places)
        for (const f of [`EF(${p.name} > 0)`, `AG(${p.name} = 0)`, `AG(EF(${p.name} > 0))`]) expect(checkCtl(b, f).status, `seed ${seed} ${f}`).toBe(checkCtl(a, f).status);
      compared++;
      edges += cb.edges.length;
      concurrent += cb.edges.filter((e) => e.split(" | ")[1].includes(",")).length;
    }
    expect(compared).toBe(500);
    // The comparison is not vacuous: many steps, many of them with several transitions.
    expect(edges).toBeGreaterThan(600);
    expect(concurrent).toBeGreaterThan(150);
  });

  it("the thesis's capacity rule (M + Post(U) ≤ K) is stricter than the result-based one the P/T graph uses", () => {
    // t moves the token of p back into p: under M + Post(U) ≤ K the full place p blocks it,
    // under the result-based rule (the footnote's weak rule, and the P/T firing rule) it fires.
    const net = apn([["p", true]], ["p>t", "t>p"]);
    expect(canon(apnMaximal(net, "strict")).edges).toEqual([]);
    expect(canon(apnMaximal(net, "weak")).edges).toEqual(["p[b]=1 | t<x=b> | p[b]=1"]);
    expect(canon(stepSystem(toPTNet(net), { autoConcurrency: false })).edges).toEqual(["p[b]=1 | t<x=b> | p[b]=1"]);
  });
});

describe("APN, T-APN and unfolded models under maximal steps", () => {
  for (const [name, make] of [
    ["Fig. 4.10", fig410],
    ["Fig. 4.9", fig49],
    ["ambient garage fragment", () => ambientGarageFragment()],
  ] as const)
    it(`${name}: the APN CRG, the T-APN CRG and the unfolded nets' P/T step graphs agree`, () => {
      const net = make();
      const tapn = constructTapn(net);
      expect(tapn.problems).toEqual([]);
      // APN and T-APN maximal-step CRGs: isomorphic (Def. 22 on the maximal steps).
      for (const rule of ["weak", "strict"] as const) {
        const ga = concurrentReachabilityGraph(net, { maximalOnly: true, capacityRule: rule });
        const gb = concurrentReachabilityGraph(tapn.net, { maximalOnly: true, capacityRule: rule });
        expect(ga.complete && gb.complete).toBe(true);
        expect(stsIsomorphic(ga, gb).isomorphic, `${name} ${rule}`).toBe(true);
      }
      // The APN's maximal CRG and the P/T step graph of its unfolding (weak rule = P/T firing rule).
      const a = canon(apnMaximal(net));
      const b = canon(stepSystem(toPTNet(net), { autoConcurrency: false }));
      expect(b.markings).toEqual(a.markings);
      expect(b.edges).toEqual(a.edges);
      expect(b.deadlocks).toEqual(a.deadlocks);
      // Same for the T-APN and its unfolding.
      const c = canon(apnMaximal(tapn.net));
      const d = canon(stepSystem(toPTNet(tapn.net), { autoConcurrency: false }));
      expect(d.edges).toEqual(c.edges);
      expect(d.deadlocks).toEqual(c.deadlocks);
      expect(c.markings.length).toBe(a.markings.length);
    });

  it("Fig. 3.1 (inhibitor arc): the APN CRG and the P/T step graph agree", () => {
    const net = thesisFig3_1();
    const a = canon(apnMaximal(net));
    const b = canon(stepSystem(toPTNet(net), { autoConcurrency: false }));
    expect(b).toEqual(a);
  });
});

describe("independent transitions in the APN step search", () => {
  for (const n of [15, 30])
    it(`${n} independent structured transitions: one maximal step, no runaway search`, () => {
      const places: [string, boolean][] = [];
      const arcs: string[] = [];
      for (let i = 0; i < n; i++) {
        places.push([`a${i}`, true], [`b${i}`, false]);
        arcs.push(`a${i}>t${i}`, `t${i}>b${i}`);
      }
      const net = apn(places, arcs);
      const t0 = performance.now();
      const g = concurrentReachabilityGraph(net, { maximalOnly: true });
      expect(performance.now() - t0).toBeLessThan(2000);
      expect(g.complete).toBe(true);
      expect(g.edges).toHaveLength(1);
      expect(g.edges[0].step).toHaveLength(n);
      // Same graph as the P/T step graph of the unfolding.
      expect(canon(transitionSystemFromStepGraph(net, g))).toEqual(canon(stepSystem(toPTNet(net), { autoConcurrency: false })));
    });
});
