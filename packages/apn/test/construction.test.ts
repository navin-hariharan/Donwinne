import { describe, expect, it } from "vitest";
import { Net, compile } from "@pns/core";
import { reachabilityGraph, unfold } from "@pns/sim";
import {
  checkEquivalence,
  classifyStepNet,
  concurrentReachabilityGraph,
  constructTapn,
  crgView,
  markingPairs,
  parseStep,
  runStepSequence,
  showStep,
  stsIsomorphic,
  tapnTuple,
  thesisFig3_1,
  thesisFig5_1,
  thesisFig6_1,
  thesisFig6_3,
} from "../src";

const byName = (net: Net, ids: string[]) => ids.map((id) => [...net.places, ...net.transitions].find((n) => n.id === id)!.name).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
const sorted = (xs: string[]) => [...xs].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

describe("Construction φ (Def. 21) on the APN N of Fig. 6.1 (Sec. 6.3)", () => {
  const N = thesisFig6_1();
  const r = constructTapn(N, { complementNames: { b: "g", w: "l" } });
  const phi = r.net;

  it("Sec. 6.3: reads P_R, P_D, P_C, P_SF, P_I and T_R, T_EM, T_STEP as the thesis lists them", () => {
    const roles = classifyStepNet(N);
    expect(roles.problems).toEqual([]);
    expect(byName(N, roles.response)).toEqual(["p5", "p10", "p11", "p17", "p18"]);
    expect(byName(N, roles.database)).toEqual(["p4", "p8", "p9", "p15", "p16"]);
    expect(byName(N, roles.control)).toEqual(["p0", "p3", "p7", "p14"]);
    expect(byName(N, roles.stepPlaces)).toEqual(["p1", "p2", "p6"]);
    expect(byName(N, roles.inhibitorPlaces)).toEqual(["p0", "p3", "p7", "p14"]);
    expect(byName(N, roles.retrieve)).toEqual(["t3", "t6", "t8", "t11", "t13"]);
    expect(byName(N, roles.emptying)).toEqual(["t2", "t5", "t7", "t10", "t12"]);
    expect(byName(N, roles.step)).toEqual(["t1", "t4", "t9"]);
    expect(roles.rootOf).toEqual({ p0: "p1" });
    expect(roles.controlOf).toEqual({ t1: "p3", t4: "p7", t9: "p14" });
  });

  it("Def. 21 (i)-(iii), Sec. 6.3: P' = P, T' = T, Pre_REP and Post_NEW as in the thesis", () => {
    expect(phi.places.map((p) => p.name)).toEqual(N.places.map((p) => p.name));
    expect(phi.transitions.map((t) => t.name)).toEqual(N.transitions.map((t) => t.name));
    expect(r.sets.preRep).toEqual([
      ["p0", "t1"],
      ["p3", "t4"],
      ["p7", "t9"],
      ["p14", "t4"],
    ]);
    expect(r.sets.postNew).toEqual([
      ["t1", "p14"],
      ["t2", "p3"],
      ["t5", "p7"],
      ["t7", "p7"],
      ["t9", "p3"],
      ["t10", "p14"],
      ["t12", "p14"],
    ]);
    expect(phi.arcs.some((a) => a.kind !== "normal")).toBe(false);
    // |Pre'_ALL| = |Pre_ALL| and Post'_ALL = Post_ALL ∪ Post_NEW.
    expect(phi.arcs.filter((a) => phi.transitions.some((t) => t.id === a.target)).length).toBe(N.arcs.filter((a) => N.transitions.some((t) => t.id === a.target)).length);
    expect(phi.arcs.length).toBe(N.arcs.length + 7);
    expect(Object.values(r.mapping.arcs).filter((o) => o.origin === "replacedInhibitor").length).toBe(4);
  });

  it("Def. 21 (iv)-(viii), Sec. 6.3: Cl̄ = {g, l} with f(b) = g, f(w) = l; control places host b, w, g, l; Ins", () => {
    const s = tapnTuple(phi);
    expect(s.f).toEqual([
      ["b", "g"],
      ["w", "l"],
    ]);
    for (const p of ["p0", "p3", "p7", "p14"]) expect(s.CP[p]).toEqual(["b", "w", "g", "l"]);
    for (const p of ["p1", "p2", "p4", "p5", "p6", "p10", "p18"]) expect(s.CP[p]).toEqual(["b", "w"]);
    for (const t of phi.transitions) expect(s.CT[t.name]).toEqual(["b", "w"]);
    for (const [p, t] of [...r.sets.preRep]) expect(s.Ins[`${p}→${t}`]).toEqual(["g", "l"]);
    for (const [t, p] of r.sets.postNew) expect(s.Ins[`${t}→${p}`]).toEqual(["g", "l"]);
    expect(s.Ins["p1→t1"]).toEqual(["b", "w"]);
    expect(s.Ins["t4→p7"]).toEqual(["b", "w"]);
  });

  it("Def. 21 (ix)-(x), Sec. 6.3: capacities kept; T_G = T_STEP = {t1, t4, t9} with B_t = {(b,g), (w,l)}", () => {
    const s = tapnTuple(phi);
    expect(s.TG).toEqual(["t1", "t4", "t9"]);
    expect(r.sets.guarded).toEqual(["t1", "t4", "t9"]);
    expect(sorted(r.sets.unguarded)).toEqual(["t2", "t3", "t5", "t6", "t7", "t8", "t10", "t11", "t12", "t13"]);
    expect(r.sets.bindingPairs).toEqual([
      ["b", "g"],
      ["w", "l"],
    ]);
    for (const t of ["t1", "t4", "t9"])
      expect(s.B[t]).toEqual([
        ["b", "g"],
        ["w", "l"],
      ]);
    expect(Object.values(s.K).every((k) => k === 1)).toBe(true);
  });

  it("Def. 21 (xi), Sec. 6.3: M'0 adds (p0,g) and (p0,l) to M0 (Fig. 6.2; p8, p9, p15, p16 coloured as drawn)", () => {
    expect(r.sets.initialMarking).toEqual(["(p0,g)", "(p0,l)", "(p1,b)", "(p1,w)", "(p4,b)", "(p4,w)", "(p8,w)", "(p9,b)", "(p15,w)", "(p16,b)"]);
  });

  it("Def. 21 (xii): G' = G = {p1, p2, p6}", () => {
    expect(phi.places.filter((p) => p.gluing).map((p) => p.name)).toEqual(["p1", "p2", "p6"]);
  });

  it("Def. 20: φ(N) is a valid T-APN that keeps N's layout", () => {
    expect(phi.netClass).toBe("tapn");
    expect(compile(phi).problems).toEqual([]);
    for (const p of phi.places) expect([p.x, p.y]).toEqual([N.places.find((q) => q.id === p.id)!.x, N.places.find((q) => q.id === p.id)!.y]);
    // The new arc t2 -> p3 runs back along p3 -> t2, so it gets a bend point (Fig. 6.2 draws two curves).
    const back = phi.arcs.find((a) => a.source === "t2" && a.target === "p3")!;
    expect(back.points?.length).toBe(1);
    expect(r.mapping.places.p3).toBe("p3");
    expect(r.mapping.arcs[back.id]).toEqual({ origin: "emptying" });
  });

  it("Theorem 1, Sec. 6.6: CRG(N) and CRG(φ(N)) are isomorphic", () => {
    const res = checkEquivalence(N, { tapn: phi });
    expect(res.verdict).toBe("equivalent");
    expect(res.equivalent).toBe(true);
    expect(res.states).toBe(concurrentReachabilityGraph(N).states.length);
  });
});

/** Fig. 6.6 as drawn: the states M'0 … M'9 of CRG(φ(N1)). Its arcs carry the same steps as Fig. 6.5. */
const FIG_6_6_STATES = [
  ["(p0,g)", "(p1,b)", "(p4,b)", "(p8,b)"],
  ["(p2,b)", "(p3,b)", "(p4,b)", "(p8,b)"],
  ["(p2,b)", "(p3,g)", "(p5,b)", "(p8,b)"],
  ["(p2,b)", "(p3,g)", "(p4,b)", "(p8,b)"],
  ["(p5,b)", "(p6,b)", "(p7,b)", "(p8,b)"],
  ["(p4,b)", "(p6,b)", "(p7,b)", "(p8,b)"],
  ["(p5,b)", "(p6,b)", "(p9,b)"],
  ["(p4,b)", "(p6,b)", "(p9,b)"],
  ["(p5,b)", "(p6,b)", "(p8,b)"],
  ["(p4,b)", "(p6,b)", "(p8,b)"],
];
const FIG_6_6_EDGES: [number, string, number][] = [
  [0, "{(t1,b)}", 1],
  [1, "{(t2,b)}", 2],
  [2, "{(t3,b)}", 3],
  [2, "{(t3,b),(t4,b)}", 5],
  [2, "{(t4,b)}", 4],
  [3, "{(t4,b)}", 5],
  [4, "{(t3,b)}", 5],
  [4, "{(t3,b),(t5,b)}", 7],
  [4, "{(t5,b)}", 6],
  [5, "{(t5,b)}", 7],
  [6, "{(t3,b)}", 7],
  [6, "{(t3,b),(t6,b)}", 9],
  [6, "{(t6,b)}", 8],
  [7, "{(t6,b)}", 9],
  [8, "{(t3,b)}", 9],
];

describe("Construction φ on N1 (Figs 6.3, 6.4) and firing φ(N1) (Sec. 6.4)", () => {
  const N1 = thesisFig6_3();
  const r = constructTapn(N1, { complementNames: { b: "g" } });
  const phi = r.net;

  it("Sec. 6.4, Fig. 6.4: Pre_REP = {(p0,t1), (p3,t4)}, Post_NEW = {(t2,p3)}, Cl̄ = {g}, B_t = {(b,g)}", () => {
    expect(byName(N1, r.roles.response)).toEqual(["p5", "p9"]);
    expect(byName(N1, r.roles.database)).toEqual(["p4", "p8"]);
    expect(byName(N1, r.roles.control)).toEqual(["p0", "p3", "p7"]);
    expect(byName(N1, r.roles.stepPlaces)).toEqual(["p1", "p2", "p6"]);
    expect(byName(N1, r.roles.inhibitorPlaces)).toEqual(["p0", "p3"]);
    expect(byName(N1, r.roles.retrieve)).toEqual(["t3", "t6"]);
    expect(byName(N1, r.roles.emptying)).toEqual(["t2", "t5"]);
    expect(byName(N1, r.roles.step)).toEqual(["t1", "t4"]);
    expect(r.sets.preRep).toEqual([
      ["p0", "t1"],
      ["p3", "t4"],
    ]);
    expect(r.sets.postNew).toEqual([["t2", "p3"]]);
    expect(r.sets.bindingPairs).toEqual([["b", "g"]]);
    const s = tapnTuple(phi);
    expect(s.ClSpec).toEqual(["g"]);
    expect(s.CP.p3).toEqual(["b", "g"]);
    expect(s.CP.p7).toEqual(["b", "g"]);
    expect(s.CP.p2).toEqual(["b"]);
    expect(s.TG).toEqual(["t1", "t4"]);
  });

  it("Sec. 6.4: M'0 = {(p0,g), (p1,b), (p4,b), (p8,b)}", () => {
    expect(r.sets.initialMarking).toEqual(["(p0,g)", "(p1,b)", "(p4,b)", "(p8,b)"]);
    expect(compile(phi).problems).toEqual([]);
  });

  it("Sec. 6.4: at M'1 the black token in p3 does not fit Ins((p3,t4)) = {g}, so only t2 is enabled", () => {
    const run = runStepSequence(phi, [parseStep(phi, "{(t1,b)}")]);
    expect(run.ok).toBe(true);
    const M1 = run.markings[1];
    expect(markingPairs(phi, M1)).toEqual(["(p2,b)", "(p3,b)", "(p4,b)", "(p8,b)"]);
    const g = concurrentReachabilityGraph(phi, { initial: M1, maxStates: 2 });
    expect(g.edges.filter((e) => e.from === 0).map((e) => showStep(phi, e.step))).toEqual(["{(t2,b)}"]);
  });

  it("Fig. 6.6: CRG(φ(N1)) has the ten markings and fifteen labelled arcs drawn", () => {
    const g = concurrentReachabilityGraph(phi);
    expect(g.complete).toBe(true);
    const v = crgView(phi, g);
    const label = (pairs: string[]) => sorted(pairs).join(" ");
    expect(v.states.map((s) => label(s.pairs)).sort()).toEqual(FIG_6_6_STATES.map(label).sort());
    expect(v.edges.map((e) => `${label(v.states[e.from].pairs)} ${e.label} ${label(v.states[e.to].pairs)}`).sort()).toEqual(
      FIG_6_6_EDGES.map(([a, u, b]) => `${label(FIG_6_6_STATES[a])} ${u} ${label(FIG_6_6_STATES[b])}`).sort(),
    );
  });

  it("Sec. 6.4: φ(N1) produces exactly the step sequences (1)-(7) of N1, and Figs 6.5 and 6.6 are isomorphic", () => {
    const gN = concurrentReachabilityGraph(N1);
    const gPhi = concurrentReachabilityGraph(phi);
    expect(stsIsomorphic(gN, gPhi).isomorphic).toBe(true);
    const res = checkEquivalence(N1, { construct: { complementNames: { b: "g" } } });
    expect(res.verdict).toBe("equivalent");
    expect(res.states).toBe(10);
    expect(res.edges).toBe(15);
    expect(res.construction?.sets.postNew).toEqual([["t2", "p3"]]);
  });

  it("Sec. 6.6: a T-APN missing the new arc (t2,p3) is not equivalent; the counterexample is U1 U2 then {(t4,b)}", () => {
    const broken = structuredClone(phi);
    broken.arcs = broken.arcs.filter((a) => !(a.source === "t2" && a.target === "p3"));
    const res = checkEquivalence(N1, { tapn: broken });
    expect(res.verdict).toBe("not equivalent");
    expect(res.equivalent).toBe(false);
    const c = res.counterexample!;
    expect(c.kind).toBe("stepOnlyInApn");
    expect(c.steps.map((u) => showStep(N1, u))).toEqual(["{(t1,b)}", "{(t2,b)}"]);
    expect(showStep(N1, c.step!)).toBe("{(t4,b)}");
    expect(c.apnMarking).toEqual(["(p2,b)", "(p5,b)", "(p8,b)"]);
    expect(c.tapnMarking).toEqual(["(p2,b)", "(p5,b)", "(p8,b)"]);
    expect(c.explanation).toMatch(/After \{\(t1,b\)\} \{\(t2,b\)\} the step \{\(t4,b\)\} is enabled in the APN but not in the T-APN/);
  });

  it("Def. 22: two step sequences that meet in one graph but not in the other are a counterexample", () => {
    const n = thesisFig6_3();
    const U = (s: string) => parseStep(n, s);
    // a: 0 -A-> 1, 0 -B-> 2, 1 -B-> 3, 2 -A-> 3 (a diamond); b: the same, but the two paths end apart.
    const A = U("{(t1,b)}");
    const B = U("{(t2,b)}");
    const a = { states: [0, 1, 2, 3], initial: 0, edges: [{ from: 0, to: 1, step: A }, { from: 0, to: 2, step: B }, { from: 1, to: 3, step: B }, { from: 2, to: 3, step: A }] };
    const b = { states: [0, 1, 2, 3, 4], initial: 0, edges: [{ from: 0, to: 1, step: A }, { from: 0, to: 2, step: B }, { from: 1, to: 3, step: B }, { from: 2, to: 4, step: A }] };
    const r = stsIsomorphic(a, b);
    expect(r.isomorphic).toBe(false);
    expect(r.counterexample?.kind).toBe("stateMismatch");
    expect(r.counterexample?.steps.map((u) => showStep(n, u))).toEqual(["{(t2,b)}", "{(t1,b)}"]);
    expect(r.counterexample?.other?.map((u) => showStep(n, u))).toEqual(["{(t1,b)}", "{(t2,b)}"]);
  });
});

describe("Equivalence outside composite step nets", () => {
  it("Figs 3.1 and 5.1: the APN and the T-APN of the comparison in Sec. 6.1.1 behave alike", () => {
    const res = checkEquivalence(thesisFig3_1(), { tapn: thesisFig5_1() });
    expect(res.verdict).toBe("equivalent");
  });

  it("Def. 21 assumes a composite step net: Fig. 3.1 is not one, and the check says where φ(N) differs", () => {
    const r = constructTapn(thesisFig3_1());
    expect(r.problems.length).toBeGreaterThan(0);
    const res = checkEquivalence(thesisFig3_1(), { tapn: r.net });
    expect(res.verdict).toBe("not equivalent");
    expect(res.counterexample?.steps).toEqual([]);
    expect(showStep(thesisFig3_1(), res.counterexample!.step!)).toBe("{(t,b)}");
  });

  it("Sec. 6.6: equivalence stops at its limits with an unknown verdict", () => {
    const res = checkEquivalence(thesisFig6_1(), { maxStates: 20 });
    expect(res.verdict).toBe("unknown");
    expect(res.reason).toBe("states");
  });

  it("Def. 21: refuses nets that are not APNs or have errors", () => {
    expect(() => constructTapn(thesisFig5_1())).toThrow(/already a T-APN/);
    const bad = thesisFig6_3();
    bad.arcs[0].inscription = "2`x";
    expect(() => constructTapn(bad)).toThrow(/errors/);
  });
});


describe("Interleaving tools on ambient nets", () => {
  it("Def. 21: φ(N1) unfolds to a safe P/T net whose reachability graph has the markings of Fig. 6.6", () => {
    const phi = constructTapn(thesisFig6_3(), { complementNames: { b: "g" } }).net;
    const u = unfold(phi);
    expect(u.net.netClass).toBe("pt");
    expect(u.net.places.every((p) => p.capacity === 1)).toBe(true);
    // The interleaving graph has the same markings as the CRG (steps add only edges).
    expect(reachabilityGraph(phi).states.length).toBe(10);
    expect(reachabilityGraph(u.net).states.length).toBe(10);
    expect(reachabilityGraph(thesisFig6_3()).states.length).toBe(10);
    expect(unfold(thesisFig6_3()).net.netClass).toBe("xpt");
  });
});
