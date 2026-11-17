// Petri net slicing (Khan, Konios and Guelfi, ACM Computing Surveys 51(5), 2018) and stubborn-set
// reduction, checked against the survey's Fig. 7, the framework chapter of Konios et al. (HCII
// 2023, Figs 7-10) and, on random nets, against the full state space.

import { describe, expect, it } from "vitest";
import { emptyNet, type Arc, type Net } from "@pns/core";
import { constructTapn, fig410, thesisFig3_1 } from "@pns/apn";
import {
  SLICING_ALGORITHMS,
  changConcurrencySets,
  checkCtl,
  criterionFromCtl,
  deadStates,
  evolutionImpact,
  interleavingSystem,
  invariantBounds,
  leeSlices,
  sliceNet,
  sliceToNet,
  stubbornSystem,
  toPTNet,
  type PTNet,
  type SlicingAlgorithm,
  type TransitionSystem,
} from "@pns/analysis";

type ArcSpec = [string, string, number?, Arc["kind"]?];

function ptNet(name: string, places: Record<string, number>, transitions: string[], arcs: ArcSpec[], capacity: Record<string, number> = {}): Net {
  const n = emptyNet("xpt", name) as Net;
  for (const [p, m] of Object.entries(places)) n.places.push({ id: p, name: p, x: 0, y: 0, marking: String(m), ...(capacity[p] ? { capacity: capacity[p] } : {}) });
  for (const t of transitions) n.transitions.push({ id: t, name: t, x: 0, y: 0 });
  arcs.forEach(([s, t, w, kind], i) => n.arcs.push({ id: `a${i}`, source: s, target: t, inscription: String(w ?? 1), kind: kind ?? "normal" }));
  return n;
}

const names = (pt: PTNet, idx: "places" | "transitions") => pt[idx].map((x) => x.name);

/** Survey Fig. 7(a): Rakow's example, criterion P3. */
const rakow = () =>
  ptNet(
    "Survey Fig. 7",
    { P1: 1, P2: 1, P3: 1, P4: 1, P5: 1, P6: 1 },
    ["t1", "t2", "t3", "t4", "t5", "t6"],
    [
      ["P1", "t1"],
      ["t1", "P2"],
      ["P1", "t2"],
      ["t2", "P6"],
      ["P2", "t3"],
      ["t3", "P2"],
      ["P5", "t3"],
      ["P2", "t4"],
      ["t4", "P3"],
      ["P3", "t5"],
      ["t5", "P4"],
      ["P4", "t6"],
    ],
  );

describe("survey Fig. 7: Rakow's basic, CTL*-X and safety slicing", () => {
  const pt = toPTNet(rakow());
  const slice = (algorithm: SlicingAlgorithm) => sliceNet(pt, { places: ["P3"] }, { algorithm });

  it("basic slicing keeps the reading transition t3 and P5, drops t6 and P4", () => {
    const s = slice("basic");
    expect(names(s.pt, "places")).toEqual(["P1", "P2", "P3", "P5"]);
    expect(names(s.pt, "transitions")).toEqual(["t1", "t2", "t3", "t4", "t5"]);
  });

  it("CTL*-X slicing drops the reading transition t3", () => {
    const s = slice("ctlStarX");
    expect(names(s.pt, "places")).toEqual(["P1", "P2", "P3"]);
    expect(names(s.pt, "transitions")).toEqual(["t1", "t2", "t4", "t5"]);
  });

  it("safety slicing also drops t2, which only takes tokens away from P1", () => {
    const s = slice("safety");
    expect(names(s.pt, "places")).toEqual(["P1", "P2", "P3"]);
    expect(names(s.pt, "transitions")).toEqual(["t1", "t4", "t5"]);
  });

  it("the slices need fewer states, in the order of Table 1", () => {
    const full = interleavingSystem(pt).markings.length;
    const [b, c, s] = (["basic", "ctlStarX", "safety"] as const).map((a) => interleavingSystem(slice(a).pt).markings.length);
    expect(b).toBeLessThan(full);
    expect(c).toBeLessThan(b);
    expect(s).toBeLessThanOrEqual(c);
  });

  it("φ1 = 'P3 is never empty' gets the same verdict on every slice", () => {
    const f = "AG(P3 > 0)";
    const want = checkCtl(interleavingSystem(pt), f).status;
    for (const a of ["basic", "ctlStarX", "safety", "apnSlicing", "abstract"] as const) expect(checkCtl(interleavingSystem(slice(a).pt), f).status).toBe(want);
  });

  it("the criterion can be read from the formula", () => {
    const c = criterionFromCtl("AG(P3 > 0)");
    expect(c).toMatchObject({ places: ["P3"], transitions: [], usesNext: false, usesDeadlock: false, safety: true });
    expect(criterionFromCtl("AG(p1[b] > 0 -> AF(q >= 2 | fireable(t<x=b>)))")).toMatchObject({ places: ["p1[b]", "q"], transitions: ["t<x=b>"], safety: false });
    expect(criterionFromCtl("EX(deadlock)")).toMatchObject({ usesNext: true, usesDeadlock: true });
  });
});

describe("framework chapter (Konios et al. 2023), Figs 7-10", () => {
  const construction = constructTapn(fig410());
  const pt = toPTNet(construction.net);
  const Q = ["p3[b]", "p3[w]", "p3[b_bar]", "p3[w_bar]"];

  it("Sec. 4.1: the construction gives Post_NEW and M'0 of the chapter", () => {
    expect(construction.sets.postNew).toEqual([
      ["t2", "p3"],
      ["t4", "p0"],
      ["t5", "p7"],
      ["t7", "p7"],
    ]);
    expect(construction.sets.initialMarking).toEqual(["(p0,b_bar)", "(p0,w_bar)", "(p1,b)", "(p1,w)", "(p4,b)", "(p4,w)", "(p7,b_bar)", "(p7,w_bar)", "(p8,w)", "(p9,b)"]);
  });

  it("Sec. 4.2: the unfolding has one transition per binding, e.g. t1 for {b, g} and {w, l}", () => {
    expect(pt.transitions.filter((t) => t.baseName === "t1").map((t) => t.name)).toEqual(["t1<x=b, x_bar=b_bar>", "t1<x=w, x_bar=w_bar>"]);
    expect(pt.m0[pt.places.findIndex((p) => p.name === "p4[b]")]).toBe(1);
    expect(pt.m0[pt.places.findIndex((p) => p.name === "p4[w]")]).toBe(1);
  });

  it("Sec. 5, Fig. 10: abstract slicing for Q = {p3b, p3w, p3g, p3l} keeps 16 places and the 10 transitions t1, t2, t4, t5, t7", () => {
    const s = sliceNet(pt, { places: Q }, { algorithm: "abstract" });
    expect(s.stats.places).toBe(16);
    expect(s.stats.transitions).toBe(10);
    expect([...new Set(s.pt.transitions.map((t) => t.baseName))]).toEqual(["t1", "t2", "t4", "t5", "t7"]);
    // The retrieve transitions are neutral: each response place merges into its database place.
    expect(s.merges.map((m) => `${pt.places[m.place].name}>${pt.places[m.into].name}`)).toEqual(["p5[b]>p4[b]", "p5[w]>p4[w]", "p10[b]>p8[b]", "p10[w]>p8[w]", "p11[b]>p9[b]", "p11[w]>p9[w]"]);
    // T-APN places have capacity 1 per colour; the P-invariants show it is never reached.
    expect(invariantBounds(pt).every((b, p) => b <= (pt.capacity[p] ?? Infinity))).toBe(true);
  });

  it("Sec. 6: the slice needs 16 states instead of 256 and φ1, φ2 keep their verdicts", () => {
    const full = interleavingSystem(pt);
    const s = sliceNet(pt, { places: Q }, { algorithm: "abstract" });
    const small = interleavingSystem(s.pt);
    expect(full.markings.length).toBe(256);
    expect(small.markings.length).toBe(16);
    for (const f of ["AG((p2[b] > 0 & p1[b] == 0 & p3[b_bar] == 0) -> p3[b] > 0)", "EF((p3[b] > 0 & p3[w] > 0) | (p3[b_bar] > 0 & p3[w_bar] > 0))"]) {
      expect(checkCtl(small, f).status).toBe(checkCtl(full, f).status);
      expect(checkCtl(small, f).status).toBe("true");
    }
  });

  it("the slice opens as a P/T net (for PNML export, as SLiM does) with the same behaviour", () => {
    const s = sliceNet(pt, { places: Q });
    const net = sliceToNet(s);
    expect(net.netClass).toBe("pt");
    const again = toPTNet(net);
    expect(again.errors).toEqual([]);
    expect(again.places.length).toBe(16);
    expect(again.transitions.length).toBe(10);
    expect(interleavingSystem(again).markings.length).toBe(16);
  });

  it("every algorithm runs on the unfolded T-APN", () => {
    const first = pt.transitions.findIndex((t) => t.baseName === "t1");
    for (const a of SLICING_ALGORITHMS) {
      const s = sliceNet(pt, { places: Q }, { algorithm: a.id, trace: a.needsTrace ? [first] : undefined });
      expect(s.stats.places).toBeLessThanOrEqual(pt.places.length);
      expect(s.algorithm).toBe(a.id);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Random nets against the full state space.

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** extended: read and inhibitor arcs and capacities; "all" adds reset and equal arcs and heavier inhibitor arcs. */
function randomNet(seed: number, extended: boolean | "all"): Net {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const nP = int(3, 6);
  const nT = int(3, 6);
  const places: Record<string, number> = {};
  const capacity: Record<string, number> = {};
  for (let i = 0; i < nP; i++) {
    places[`p${i}`] = int(0, 2);
    if (extended && r() < 0.2) capacity[`p${i}`] = Math.max(places[`p${i}`], int(2, 3));
  }
  const ts = Array.from({ length: nT }, (_, i) => `t${i}`);
  const arcs: ArcSpec[] = [];
  const P = () => `p${int(0, nP - 1)}`;
  for (const t of ts) {
    const ins = new Set<string>();
    for (let k = int(1, 2); k > 0; k--) ins.add(P());
    for (const p of ins) arcs.push([p, t, int(1, 2), extended && r() < 0.2 ? "read" : "normal"]);
    const outs = new Set<string>();
    for (let k = int(0, 2); k > 0; k--) outs.add(P());
    for (const p of outs) arcs.push([t, p, int(1, 2)]);
    if (extended && r() < 0.25) {
      const p = P();
      if (!ins.has(p)) arcs.push([p, t, extended === "all" ? int(1, 3) : int(1, 2), "inhibitor"]);
    }
    if (extended === "all" && r() < 0.15) {
      const p = P();
      if (!ins.has(p)) arcs.push([p, t, 1, "reset"]);
    }
    if (extended === "all" && r() < 0.15) {
      const p = P();
      if (!ins.has(p)) arcs.push([p, t, int(0, 2), "equal"]);
    }
  }
  return ptNet(`random ${seed}`, places, ts, arcs, capacity);
}

/** Projections of the reachable markings onto places (given in each net's own indices). */
function projections(ts: TransitionSystem, idx: number[]): Set<string> {
  const out = new Set<string>();
  for (const M of ts.markings) out.add(idx.map((p) => M[p]).join(","));
  return out;
}

const subset = (a: Set<string>, b: Set<string>) => [...a].every((x) => b.has(x));

describe("slicing on random nets (normal, read, inhibitor, reset and equal arcs, capacities)", () => {
  const exact: SlicingAlgorithm[] = ["ctlStarX", "apnSlicing", "abstract", "abstractParallel", "basic", "safety"];
  for (const extended of [false, true, "all"] as const)
    it(`${extended === "all" ? "reset, equal and weighted inhibitor arcs" : extended ? "extended" : "ordinary"} nets: exact slices reach exactly the criterion markings of the net`, () => {
      let checked = 0;
      const kinds = new Set<string>();
      for (let seed = 1; seed <= 150; seed++) {
        const pt = toPTNet(randomNet(seed * (extended === "all" ? 6007 : extended ? 7919 : 1), extended));
        if (pt.errors.length) continue;
        const full = interleavingSystem(pt, { maxStates: 3000 });
        if (!full.complete) continue;
        const crit = [seed % pt.places.length];
        if (seed % 3 === 0) crit.push((seed + 1) % pt.places.length);
        const critSet = [...new Set(crit)];
        const want = projections(full, critSet);
        for (const algorithm of exact) {
          const s = sliceNet(pt, { places: critSet }, { algorithm });
          const ts = interleavingSystem(s.pt, { maxStates: 20000 });
          expect(ts.complete).toBe(true);
          const got = projections(ts, critSet.map((p) => s.placeMap[p]));
          expect([...got].sort(), `${algorithm}, seed ${seed}`).toEqual([...want].sort());
          expect(s.stats.places).toBeLessThanOrEqual(pt.places.length);
        }
        // Backward slicing keeps every transition that put tokens on a criterion place (Alg. 7).
        const b = sliceNet(pt, { places: critSet }, { algorithm: "backward" });
        for (let x = 0; x < full.markings.length; x++)
          for (let e = full.edgeStart[x]; e < full.edgeStart[x + 1]; e++) {
            const t = full.labels[full.edgeLabel[e]][0];
            const after = full.markings[full.edgeTo[e]];
            if (critSet.some((p) => after[p] > full.markings[x][p])) expect(b.transitionMap[t], `backward, seed ${seed}`).toBeGreaterThanOrEqual(0);
          }
        // Forward slicing over-approximates the transitions that can ever fire.
        const f = sliceNet(pt, { places: critSet }, { algorithm: "forward" });
        const fired = new Set<number>();
        for (let e = 0; e < full.edgeLabel.length; e++) fired.add(full.labels[full.edgeLabel[e]][0]);
        for (const t of fired) expect(f.transitionMap[t], `forward, seed ${seed}`).toBeGreaterThanOrEqual(0);
        checked++;
        for (const a of pt.arcs) kinds.add(a.kind === "inhibitor" && (a.weight ?? 0) > 1 ? "inhibitor>1" : a.kind);
      }
      expect(checked).toBeGreaterThan(60);
      // The nets that were checked do have the arc kinds this case is about.
      if (extended === "all") expect([...kinds].sort()).toEqual(["equal", "inhibitor", "inhibitor>1", "normal", "read", "reset"]);
    });

  it("a slice turned into a net and read back behaves like the slice", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const pt = toPTNet(randomNet(seed * 31, true));
      if (pt.errors.length) continue;
      const s = sliceNet(pt, { places: [0] }, { algorithm: "abstract" });
      const back = toPTNet(sliceToNet(s));
      expect(back.errors).toEqual([]);
      const a = interleavingSystem(s.pt, { maxStates: 3000 });
      const b = interleavingSystem(back, { maxStates: 3000 });
      expect(b.markings.length).toBe(a.markings.length);
      expect(b.edgeTo.length).toBe(a.edgeTo.length);
    }
  });
});

describe("stubborn sets", () => {
  it("keep every deadlock, and with visible places their reachable markings, on random nets", () => {
    let reduced = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const pt = toPTNet(randomNet(seed * 104729, seed % 2 === 0));
      if (pt.errors.length) continue;
      const full = interleavingSystem(pt, { maxStates: 3000 });
      if (!full.complete) continue;
      const deadFull = new Set(deadStates(full).map((s) => full.markings[s].join(",")));
      const red = stubbornSystem(pt, { maxStates: 3000 });
      expect(red.complete).toBe(true);
      expect(new Set(deadStates(red).map((s) => red.markings[s].join(","))), `seed ${seed}`).toEqual(deadFull);
      expect(red.markings.length).toBeLessThanOrEqual(full.markings.length);
      if (red.markings.length < full.markings.length) reduced++;
      const vis = [seed % pt.places.length];
      const rv = stubbornSystem(pt, { maxStates: 3000, visible: vis });
      expect([...projections(rv, vis)].sort(), `visible, seed ${seed}`).toEqual([...projections(full, vis)].sort());
      expect(new Set(deadStates(rv).map((s) => rv.markings[s].join(",")))).toEqual(deadFull);
    }
    expect(reduced).toBeGreaterThan(5);
  });

  it("reduce independent components to one interleaving", () => {
    // n independent cycles: 2^n states in full, linear with stubborn sets.
    const n = 10;
    const places: Record<string, number> = {};
    const arcs: ArcSpec[] = [];
    const ts: string[] = [];
    for (let i = 0; i < n; i++) {
      places[`a${i}`] = 1;
      places[`b${i}`] = 0;
      ts.push(`f${i}`, `g${i}`);
      arcs.push([`a${i}`, `f${i}`], [`f${i}`, `b${i}`], [`b${i}`, `g${i}`], [`g${i}`, `a${i}`]);
    }
    const pt = toPTNet(ptNet("cycles", places, ts, arcs));
    expect(interleavingSystem(pt).markings.length).toBe(2 ** n);
    expect(stubbornSystem(pt).markings.length).toBeLessThan(4 * n);
    const vis = stubbornSystem(pt, { visible: ["b0"] });
    expect(vis.markings.length).toBeLessThan(2 ** n);
    expect([...projections(vis, [pt.places.findIndex((p) => p.name === "b0")])].sort()).toEqual(["0", "1"]);
  });
});

describe("unfolding colours outside a place's colour set", () => {
  it("Fig. 3.1: an inhibitor arc for a colour the place cannot hold never blocks", () => {
    const pt = toPTNet(thesisFig3_1());
    expect(pt.errors).toEqual([]);
    const ts = interleavingSystem(pt);
    // Only the black mode of t can fire: p5 holds the white user.
    expect(ts.markings.length).toBe(2);
    expect(checkCtl(ts, "EF(p3[b] > 0) & AG(p3[w] == 0)").status).toBe("true");
  });
});

describe("evolution, Lee and Chang slices, trace slicing", () => {
  const base = () => rakow();

  it("Sec. 8.3: a change outside the slice preserves the verdict, a change inside needs a new check", () => {
    const before = toPTNet(base());
    const outside = base();
    outside.places.find((p) => p.id === "P4")!.marking = "3";
    const r1 = evolutionImpact(before, toPTNet(outside), { places: ["P3"] }, { algorithm: "ctlStarX" });
    expect(r1.verdict).toBe("preserved");
    expect(r1.changes.map((c) => c.kind)).toEqual(["marking changed"]);
    const inside = base();
    inside.arcs.push({ id: "new", source: "t6", target: "P2", inscription: "1", kind: "normal" });
    const r2 = evolutionImpact(before, toPTNet(inside), { places: ["P3"] }, { algorithm: "ctlStarX" });
    expect(r2.verdict).toBe("recheck");
    expect(r2.relevant.map((c) => c.text)).toEqual(["Arc t6 → P2 (normal) added"]);
  });

  it("Alg. 5: Lee et al. cover every place with slices built from P-invariants", () => {
    // Two processes sharing a resource r.
    const n = ptNet(
      "mutex",
      { i1: 1, c1: 0, i2: 1, c2: 0, r: 1 },
      ["e1", "x1", "e2", "x2"],
      [
        ["i1", "e1"],
        ["r", "e1"],
        ["e1", "c1"],
        ["c1", "x1"],
        ["x1", "i1"],
        ["x1", "r"],
        ["i2", "e2"],
        ["r", "e2"],
        ["e2", "c2"],
        ["c2", "x2"],
        ["x2", "i2"],
        ["x2", "r"],
      ],
    );
    const pt = toPTNet(n);
    const parts = leeSlices(pt);
    const covered = new Set(parts.flatMap((p) => p.places));
    expect(covered.size).toBe(pt.places.length);
    expect(parts.map((p) => p.places.map((i) => pt.places[i].name).sort())).toContainEqual(["c1", "i1"]);
    // Alg. 6: the communication transitions (they touch two processes) get concurrency sets.
    const sets = changConcurrencySets(pt);
    expect(sets.length).toBeGreaterThan(0);
    const coveredT = new Set(sets.flatMap((s) => s.transitions.map((t) => pt.transitions[t].name)));
    expect(coveredT.has("e1") || coveredT.has("x1")).toBe(true);
  });

  it("Alg. 9: trace slicing keeps the firings of the trace that put tokens on the criterion", () => {
    const pt = toPTNet(base());
    const s = sliceNet(pt, { places: ["P3"] }, { algorithm: "trace", trace: ["t2", "t4", "t5"] });
    // t2 (into P6) does not feed P3; t4 does, and it needs P2. t5 only takes from P3.
    expect(names(s.pt, "transitions")).toEqual(["t4"]);
    expect(names(s.pt, "places")).toEqual(["P2", "P3"]);
    expect(() => sliceNet(pt, { places: ["P3"] }, { algorithm: "trace", trace: ["t6", "t6"] })).toThrow(/not enabled/);
  });

  it("unknown criterion names are reported", () => {
    const pt = toPTNet(base());
    expect(() => sliceNet(pt, { places: ["nope"] })).toThrow(/Unknown criterion place "nope"/);
  });
});

// Rakow's safety slice keeps a transition that changes a criterion place, and then only transitions
// that add tokens to the slice's places. Firing a slice sequence in the net leaves every slice place
// as in the slice (nothing else touches them), and a net sequence projected to the slice stays
// firable there (the dropped transitions only take tokens away). So both reach the same criterion
// markings: AG of a state formula over the criterion keeps its verdict, and so does EF, its
// negation. Liveness (AF, AG EF, EG) is not kept.
describe("safety slicing and the properties it keeps", () => {
  it("keeps the verdicts of AG and EF of state formulas on random nets, with every arc kind", () => {
    let compared = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const pt = toPTNet(randomNet(seed * 4421, seed % 3 === 0 ? "all" : seed % 3 === 1));
      if (pt.errors.length) continue;
      const full = interleavingSystem(pt, { maxStates: 3000 });
      if (!full.complete) continue;
      const p = pt.places[seed % pt.places.length].name;
      const s = sliceNet(pt, { places: [p] }, { algorithm: "safety" });
      const sts = interleavingSystem(s.pt, { maxStates: 20000 });
      for (const f of [`EF(${p} > 1)`, `EF(${p} == 0)`, `AG(${p} <= 1)`, `AG(${p} > 0) | EF(${p} >= 2)`, `!EF(${p} == 1)`]) {
        expect(criterionFromCtl(f).safety, f).toBe(true);
        expect(checkCtl(sts, f).status, `${f}, seed ${seed}`).toBe(checkCtl(full, f).status);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(400);
  });

  it("does not keep liveness: AF can differ, so AF is not classed as a safety formula", () => {
    // t0 moves the token to the criterion place p1; t1 can take it away first. The safety slice
    // drops t1 (it only consumes from p0), so in the slice p1 is always reached.
    const net = ptNet("liveness", { p0: 1, p1: 0, p2: 0 }, ["t0", "t1"], [
      ["p0", "t0"],
      ["t0", "p1"],
      ["p0", "t1"],
      ["t1", "p2"],
    ]);
    const pt = toPTNet(net);
    const s = sliceNet(pt, { places: ["p1"] }, { algorithm: "safety" });
    expect(names(s.pt, "transitions")).toEqual(["t0"]);
    const full = interleavingSystem(pt);
    const sts = interleavingSystem(s.pt);
    expect(checkCtl(full, "AF(p1 > 0)").status).toBe("false");
    expect(checkCtl(sts, "AF(p1 > 0)").status).toBe("true");
    expect(criterionFromCtl("AF(p1 > 0)").safety).toBe(false);
    expect(criterionFromCtl("AG(EF(p1 > 0))").safety).toBe(false);
    // EF is kept: p1 can be marked in both.
    expect(checkCtl(full, "EF(p1 > 0)").status).toBe(checkCtl(sts, "EF(p1 > 0)").status);
    expect(criterionFromCtl("EF(p1 > 0)").safety).toBe(true);
  });
});

describe("Wangyang slicing (Alg. 10) counts tokens", () => {
  it("three tokens, consume one: the place keeps two, so later firings that need it stay", () => {
    // t takes 1 of the 3 tokens on p; u then needs p (and t's output d) to mark the criterion c.
    // A marked-places abstraction would empty p after t and lose u.
    const net = ptNet("weighted", { p: 3, d: 0, c: 0 }, ["t", "u"], [
      ["p", "t"],
      ["t", "d"],
      ["p", "u"],
      ["d", "u"],
      ["u", "c"],
    ]);
    const pt = toPTNet(net);
    expect(checkCtl(interleavingSystem(pt), "EF(c > 0)").status).toBe("true");
    const s = sliceNet(pt, { places: ["c"] }, { algorithm: "wangyang" });
    expect(names(s.pt, "transitions").sort()).toEqual(["t", "u"]);
    expect(checkCtl(interleavingSystem(s.pt), "EF(c > 0)").status).toBe("true");
  });

  it("uses weights: a transition needing 2 tokens never fires on 1, so it is not kept", () => {
    const net = ptNet("weight 2", { p: 1, c: 0 }, ["t"], [
      ["p", "t", 2],
      ["t", "c"],
    ]);
    expect(names(sliceNet(toPTNet(net), { places: ["c"] }, { algorithm: "wangyang" }).pt, "transitions")).toEqual([]);
  });

  it("falls back to the concerned slice when the local graph is unbounded", () => {
    const net = ptNet("unbounded", { a: 1, c: 0 }, ["gen", "t"], [
      ["a", "gen"],
      ["gen", "a"],
      ["gen", "c"],
      ["c", "t"],
    ]);
    const s = sliceNet(toPTNet(net), { places: ["c"] }, { algorithm: "wangyang", maxGraphNodes: 50 });
    expect(s.notes.join(" ")).toMatch(/cut off at 50 nodes/);
    expect(names(s.pt, "transitions")).toContain("gen");
  });

  it("agrees with the state space on random weighted nets, also with extended arcs: EF of a criterion place keeps its verdict", () => {
    let checked = 0;
    for (let seed = 1; checked < 300 && seed < 3000; seed++) {
      const net = randomNet(seed, seed % 2 ? false : "all");
      const pt = toPTNet(net);
      if (pt.errors.length) continue;
      const full = interleavingSystem(pt, { maxStates: 3000 });
      if (!full.complete) continue;
      const target = pt.places[seed % pt.places.length].name;
      const s = sliceNet(pt, { places: [target] }, { algorithm: "wangyang" });
      const sliced = interleavingSystem(s.pt, { maxStates: 20000 });
      if (!sliced.complete) continue;
      const f = `EF(${target} > ${pt.m0[seed % pt.places.length]})`;
      expect(checkCtl(sliced, f).status, `seed ${seed}: ${f}`).toBe(checkCtl(full, f).status);
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
  });
});

describe("Wangyang slicing (Alg. 10) with extended arcs", () => {
  it("lets a transition fire past an inhibitor arc of weight 2 when its place holds one token", () => {
    // p holds 1 token and inhibits t only from 2 tokens on, so t fires and feeds the criterion c.
    const net = ptNet("weighted inhibitor", { p: 1, a: 1, c: 0 }, ["t"], [
      ["a", "t"],
      ["t", "c"],
      ["p", "t", 2, "inhibitor"],
    ]);
    const pt = toPTNet(net);
    expect(checkCtl(interleavingSystem(pt), "EF(c > 0)").status).toBe("true");
    const s = sliceNet(pt, { places: ["c"] }, { algorithm: "wangyang" });
    expect(names(s.pt, "transitions")).toContain("t");
  });

  it("still blocks a transition at an inhibitor arc of weight 1 on a marked place", () => {
    const net = ptNet("inhibitor 1", { p: 1, a: 1, c: 0 }, ["t"], [
      ["a", "t"],
      ["t", "c"],
      ["p", "t", 1, "inhibitor"],
    ]);
    const s = sliceNet(toPTNet(net), { places: ["c"] }, { algorithm: "wangyang" });
    expect(names(s.pt, "transitions")).not.toContain("t");
  });

  it("follows an equal arc of weight 0 only while its place is empty", () => {
    const empty = ptNet("equal 0", { p: 0, a: 1, c: 0 }, ["t"], [
      ["a", "t"],
      ["t", "c"],
      ["p", "t", 0, "equal"],
    ]);
    expect(names(sliceNet(toPTNet(empty), { places: ["c"] }, { algorithm: "wangyang" }).pt, "transitions")).toContain("t");
    const marked = ptNet("equal 0, marked", { p: 1, a: 1, c: 0 }, ["t"], [
      ["a", "t"],
      ["t", "c"],
      ["p", "t", 0, "equal"],
    ]);
    expect(names(sliceNet(toPTNet(marked), { places: ["c"] }, { algorithm: "wangyang" }).pt, "transitions")).not.toContain("t");
  });
});
