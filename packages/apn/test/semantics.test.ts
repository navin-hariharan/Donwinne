import { describe, expect, it } from "vitest";
import { Net, compile } from "@pns/core";
import {
  apnTuple,
  concurrentReachabilityGraph,
  concurrentReachabilityGraphAsync,
  conflicts,
  crgView,
  enabledSteps,
  enabledStructuredTransitions,
  fireStep,
  inConflict,
  isStepEnabled,
  markingFrom,
  markingPairs,
  parseStep,
  runStepSequence,
  showStep,
  stsIsomorphic,
  tapnTuple,
  thesisFig3_1,
  thesisFig5_1,
  thesisFig6_3,
  ambientInitialMarking,
  StepTransitionSystem,
  Step,
} from "../src";

/** A small APN from (place, marking) and arcs "p>t", "t>p", "p-ot" (inhibitor), all inscribed x over BW. */
function apn(places: [string, string][], arcs: string[], colours = ["b", "w"], netClass: Net["netClass"] = "apn"): Net {
  const tnames = new Set<string>();
  const as = arcs.map((s, i) => {
    const inh = s.includes("-o");
    const [a, b] = s.split(inh ? "-o" : ">");
    for (const n of [a, b]) if (!places.some(([p]) => p === n)) tnames.add(n);
    return { id: `a${i}`, source: a, target: b, kind: inh ? ("inhibitor" as const) : ("normal" as const), inscription: "x" };
  });
  return {
    format: "pns/1",
    name: "test",
    netClass,
    places: places.map(([n, m], i) => ({ id: n, name: n, x: 60 * i, y: 0, marking: m, colourSet: "BW" })),
    transitions: [...tnames].map((n, i) => ({ id: n, name: n, x: 60 * i, y: 100 })),
    arcs: as,
    declarations: { colourSets: [{ name: "BW", type: "enum", values: colours }], variables: [{ name: "x", colourSet: "BW" }], constants: [] },
  };
}

/** The steps as text, sorted. */
const texts = (net: Net, steps: Step[]) => steps.map((u) => showStep(net, u)).sort();

describe("APN class (Konios Def. 3)", () => {
  it("Def. 3, Fig. 3.1: reads P, T, Pre, Post, I, Cl, C, K, M0 and G from the net", () => {
    const s = apnTuple(thesisFig3_1());
    expect(s.P).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(s.Pre.t.sort()).toEqual(["p1", "p2"]);
    expect(s.Post.t.sort()).toEqual(["p3", "p4"]);
    expect(s.I).toEqual([["p5", "t"]]);
    expect(s.Cl).toEqual({ BW: ["b", "w"], W: ["w"] });
    expect(s.C.p5).toEqual(["w"]);
    expect(s.C.t).toEqual(["b", "w"]);
    expect(s.K.p1).toBe(1);
    expect(s.M0).toEqual(["(p1,b)", "(p1,w)", "(p2,b)", "(p2,w)", "(p5,w)"]);
    expect(s.G).toEqual([]);
  });

  it("Def. 3: a coloured net written as an APN (the editor's Fig. 3.1 example) is read as one", () => {
    const n = { ...thesisFig3_1(), netClass: "coloured" as const };
    const g = concurrentReachabilityGraph(n);
    expect(g.edges.map((e) => showStep(n, e.step))).toEqual(["{(t,b)}"]);
    const bad = { ...n, arcs: n.arcs.map((a, i) => (i === 0 ? { ...a, inscription: "2`x" } : a)) };
    expect(() => concurrentReachabilityGraph(bad)).toThrow(/Arc p1 → t: arcs of an ambient net carry one token/);
  });

  it("Sec. 3.2: K is 1 per colour unless a capacity is given", () => {
    const n = apn([["p", "b"], ["q", ""]], ["p>t", "t>q"]);
    n.places[1].marking = "b";
    // q already holds b: M + Post({(t,b)}) = 2`b in q exceeds K = 1.
    expect(isStepEnabled(n, ambientInitialMarking(n), [{ transition: "t", colour: "b" }])).toBe(false);
    // Compiled nets are cached per Net object, so an edited net is a new object (as in the editor).
    const n2 = structuredClone(n);
    n2.places[1].capacity = 2;
    expect(isStepEnabled(n2, ambientInitialMarking(n2), [{ transition: "t", colour: "b" }])).toBe(true);
  });
});

describe("APN problem checks (Def. 3 on the coloured net)", () => {
  const messages = (n: Net) => compile(n).problems.map((p) => p.message);

  it("Def. 3: the thesis figures have no problems", () => {
    expect(compile(thesisFig3_1()).problems).toEqual([]);
    expect(compile(thesisFig5_1()).problems).toEqual([]);
    expect(compile(thesisFig6_3()).problems).toEqual([]);
  });

  it("Def. 3: arcs have weight 1 per colour", () => {
    const n = apn([["p", "b"], ["q", ""]], ["p>t", "t>q"]);
    n.arcs[0].inscription = "2`x";
    n.arcs[1].inscription = "b";
    const ms = messages(n);
    expect(ms.some((m) => /Arc p → t: .*mode variable.*"2`x"/.test(m))).toBe(true);
    expect(ms.some((m) => /Arc t → q: .*"b"/.test(m))).toBe(true);
    n.arcs[0].inscription = "1`x";
    n.arcs[1].inscription = "x";
    expect(messages(n)).toEqual([]);
  });

  it("Def. 3: a transition's arcs carry one mode variable", () => {
    const n = apn([["p", "b"], ["q", ""]], ["p>t", "t>q"]);
    n.declarations.variables.push({ name: "y", colourSet: "BW" });
    n.arcs[1].inscription = "y";
    expect(messages(n).some((m) => /Transition t: all its arcs must carry the same mode variable, but they use x and y/.test(m))).toBe(true);
  });

  it("Def. 3: no inhibitor arc together with a pre or post arc on the same place and transition", () => {
    const n = apn([["p", "b"], ["q", ""]], ["p>t", "t>q", "p-ot"]);
    const ps = compile(n).problems;
    const p = ps.find((x) => /Place p has both an inhibitor arc and a directed arc to or from transition t/.test(x.message));
    expect(p?.severity).toBe("error");
    expect(p?.elementId).toBe("a2");
    const m = apn([["p", "b"], ["q", ""]], ["p>t", "t>q", "q-ot"]);
    expect(messages(m).some((x) => /inhibitor arc and a directed arc/.test(x))).toBe(true);
  });

  it("Sec. 3.2: markings above the capacity per colour", () => {
    const n = apn([["p", "2`b ++ w"], ["q", ""]], ["p>t", "t>q"]);
    const p = compile(n).problems.find((x) => x.elementId === "p");
    expect(p?.message).toBe("Place p holds 2 tokens of colour b, but its capacity is 1 per colour");
    n.places[0].capacity = 2;
    expect(messages(n)).toEqual([]);
  });

  it("Def. 3: only directed and colour-sensitive inhibitor arcs", () => {
    const n = apn([["p", "b"], ["q", ""]], ["p>t", "t>q"]);
    n.arcs.push({ id: "r", source: "q", target: "t", kind: "read", inscription: "x" });
    expect(messages(n).some((m) => /Arc q → t: APNs have only directed arcs and colour-sensitive inhibitor arcs/.test(m))).toBe(true);
  });

  it("Def. 20: T-APNs have no inhibitor arcs and a complementary set as large as its identity set", () => {
    const n = thesisFig5_1();
    n.arcs.push({ id: "i", source: "p3", target: "t", kind: "inhibitor", inscription: "x" });
    expect(messages(n).some((m) => /Arc p3 → t: T-APNs have only directed arcs/.test(m))).toBe(true);
    const m = thesisFig5_1();
    m.declarations.colourSets[2].values = ["g"];
    expect(messages(m).some((x) => /Colour set BW_bar must have as many values as BW \(2\)/.test(x))).toBe(true);
  });

  it("Def. 21 (ix): complementary colours of a T-APN have capacity 1", () => {
    const n = thesisFig5_1();
    n.places[4].capacity = 3;
    n.places[4].colourSet = "BW_bar";
    n.places[4].marking = "2`g";
    expect(messages(n)).toContain("Place p5 holds 2 tokens of colour g, but its capacity is 1 per colour");
  });
});

describe("APN step semantics (Sec. 3.3)", () => {
  it("Sec. 3.3, Fig. 3.1: {(t,b)} is enabled; {(t,w)} and {(t,b),(t,w)} are not, as ((p5,w),(t,w)) ∈ Ĩ", () => {
    const n = thesisFig3_1();
    const M0 = ambientInitialMarking(n);
    expect(isStepEnabled(n, M0, parseStep(n, "{(t,b)}"))).toBe(true);
    expect(isStepEnabled(n, M0, parseStep(n, "{(t,w)}"))).toBe(false);
    expect(isStepEnabled(n, M0, parseStep(n, "{(t,b),(t,w)}"))).toBe(false);
    expect(texts(n, enabledSteps(n, M0).steps)).toEqual(["{(t,b)}"]);
  });

  it("Sec. 3.3, Fig. 3.1: firing {(t,b)} gives M1 = {(p1,w),(p2,w),(p3,b),(p4,b),(p5,w)}", () => {
    const n = thesisFig3_1();
    const M1 = fireStep(n, ambientInitialMarking(n), parseStep(n, "{(t,b)}"));
    expect(markingPairs(n, M1)).toEqual(["(p1,w)", "(p2,w)", "(p3,b)", "(p4,b)", "(p5,w)"]);
    expect(() => fireStep(n, M1, parseStep(n, "{(t,w)}"))).toThrow(/not enabled/);
  });

  it("Sec. 3.3: Pre(U) ≤ M sums over the step: two transitions cannot share one token", () => {
    const n = apn([["p", "b"], ["q", ""], ["r", ""]], ["p>t1", "t1>q", "p>t2", "t2>r"]);
    const M = ambientInitialMarking(n);
    expect(texts(n, enabledSteps(n, M).steps)).toEqual(["{(t1,b)}", "{(t2,b)}"]);
    expect(isStepEnabled(n, M, parseStep(n, "{(t1,b),(t2,b)}"))).toBe(false);
  });

  it("Sec. 3.3: different colour modes of one transition fire concurrently", () => {
    const n = apn([["p", "b ++ w"], ["q", ""]], ["p>t", "t>q"]);
    expect(texts(n, enabledSteps(n, ambientInitialMarking(n)).steps)).toEqual(["{(t,b),(t,w)}", "{(t,b)}", "{(t,w)}"]);
    expect(texts(n, enabledSteps(n, ambientInitialMarking(n), { maximalOnly: true }).steps)).toEqual(["{(t,b),(t,w)}"]);
  });

  it("Sec. 3.3: M + Post(U) ≤ K blocks two steps putting the same colour into one place", () => {
    const n = apn([["p1", "b"], ["p2", "b"], ["q", ""]], ["p1>t1", "t1>q", "p2>t2", "t2>q"]);
    const M = ambientInitialMarking(n);
    expect(isStepEnabled(n, M, parseStep(n, "{(t1,b)}"))).toBe(true);
    expect(isStepEnabled(n, M, parseStep(n, "{(t1,b),(t2,b)}"))).toBe(false);
  });

  it("Sec. 3.3 footnote 1: with self-loops the weaker M − Pre(U) + Post(U) ≤ K applies", () => {
    const loop = apn([["p", "b"]], ["p>t", "t>p"]);
    const M = ambientInitialMarking(loop);
    const U = parseStep(loop, "{(t,b)}");
    expect(isStepEnabled(loop, M, U, { capacityRule: "strict" })).toBe(false);
    expect(isStepEnabled(loop, M, U)).toBe(true); // "auto" sees the self-loop
    expect(markingPairs(loop, fireStep(loop, M, U))).toEqual(["(p,b)"]);
    // A step whose own consumption makes room: q holds b, t1 takes it, t2 brings another.
    const n = apn([["q", "b"], ["r", "b"], ["s", ""]], ["q>t1", "t1>s", "r>t2", "t2>q", "s>t3", "t3>s"]);
    const M2 = ambientInitialMarking(n);
    const both = parseStep(n, "{(t1,b),(t2,b)}");
    expect(isStepEnabled(n, M2, both, { capacityRule: "strict" })).toBe(false);
    expect(isStepEnabled(n, M2, both, { capacityRule: "weak" })).toBe(true);
    expect(isStepEnabled(n, M2, parseStep(n, "{(t2,b)}"), { capacityRule: "weak" })).toBe(false);
    expect(texts(n, enabledSteps(n, M2, { capacityRule: "weak" }).steps)).toEqual(["{(t1,b),(t2,b)}", "{(t1,b)}"]);
    expect(texts(n, enabledSteps(n, M2, { capacityRule: "weak", maximalOnly: true }).steps)).toEqual(["{(t1,b),(t2,b)}"]);
  });

  it("Def. 4: structured transitions that can fire alone but not together are in conflict", () => {
    const n = apn([["p", "b"], ["q", ""], ["r", ""]], ["p>t1", "t1>q", "p>t2", "t2>r"]);
    const M = ambientInitialMarking(n);
    const a = { transition: "t1", colour: "b" };
    const b = { transition: "t2", colour: "b" };
    expect(inConflict(n, M, a, b)).toBe(true);
    expect(inConflict(n, M, a, a)).toBe(false);
    expect(conflicts(n, M)).toEqual([[a, b]]);
    // Fig. 6.3 at M2: (t3,b) and (t4,b) fire concurrently, so they are not in conflict.
    const n1 = thesisFig6_3();
    const M2 = markingFrom(n1, ["(p2,b)", "(p5,b)", "(p8,b)"]);
    expect(inConflict(n1, M2, { transition: "t3", colour: "b" }, { transition: "t4", colour: "b" })).toBe(false);
    expect(conflicts(n1, M2)).toEqual([]);
  });

  it("Sec. 3.3: enabledSteps lists all or only maximal steps and stops at its limits", () => {
    const places: [string, string][] = [];
    const arcs: string[] = [];
    for (let i = 0; i < 12; i++) {
      places.push([`a${i}`, "b"], [`z${i}`, ""]);
      arcs.push(`a${i}>t${i}`, `t${i}>z${i}`);
    }
    const n = apn(places, arcs);
    const M = ambientInitialMarking(n);
    expect(enabledSteps(n, M).steps.length).toBe(4095);
    const cut = enabledSteps(n, M, { maxSteps: 100 });
    expect(cut.steps.length).toBe(100);
    expect(cut.truncated).toBe(true);
    expect(enabledSteps(n, M, { maxNodes: 50 }).truncated).toBe(true);
    const max = enabledSteps(n, M, { maximalOnly: true });
    expect(max.steps.length).toBe(1);
    expect(max.steps[0].length).toBe(12);
    expect(enabledSteps(n, M, { maxStepSize: 1 }).steps.length).toBe(12);
    expect(enabledStructuredTransitions(n, M).length).toBe(12);
  });
});

/** Fig. 6.5 as drawn: the states M0 … M9 of CRG(N1) and its 15 arcs. */
const FIG_6_5_STATES = [
  ["(p1,b)", "(p4,b)", "(p8,b)"],
  ["(p2,b)", "(p3,b)", "(p4,b)", "(p8,b)"],
  ["(p2,b)", "(p5,b)", "(p8,b)"],
  ["(p2,b)", "(p4,b)", "(p8,b)"],
  ["(p5,b)", "(p6,b)", "(p7,b)", "(p8,b)"],
  ["(p4,b)", "(p6,b)", "(p7,b)", "(p8,b)"],
  ["(p5,b)", "(p6,b)", "(p9,b)"],
  ["(p4,b)", "(p6,b)", "(p9,b)"],
  ["(p5,b)", "(p6,b)", "(p8,b)"],
  ["(p4,b)", "(p6,b)", "(p8,b)"],
];
const FIG_6_5_EDGES: [number, string, number][] = [
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

/** Compare a CRG with a drawn one: same markings and the same labelled arcs between them. */
function expectCrgAsDrawn(net: Net, states: string[][], edges: [number, string, number][]) {
  const g = concurrentReachabilityGraph(net);
  expect(g.complete).toBe(true);
  const v = crgView(net, g);
  const label = (pairs: string[]) => pairs.join(" ");
  expect(v.states.map((s) => label(s.pairs)).sort()).toEqual(states.map((s) => label([...s].sort((a, b) => a.localeCompare(b, "en", { numeric: true })))).sort());
  const byPairs = (i: number) => label(v.states[i].pairs);
  const drawn = (i: number) => label([...states[i]].sort((a, b) => a.localeCompare(b, "en", { numeric: true })));
  expect(v.edges.map((e) => `${byPairs(e.from)} ${e.label} ${byPairs(e.to)}`).sort()).toEqual(edges.map(([a, u, b]) => `${drawn(a)} ${u} ${drawn(b)}`).sort());
  return g;
}

describe("Concurrent reachability graph (Def. 5, eq. 3.1)", () => {
  it("Fig. 3.1(b): CRG(N) is M0 --{(t,b)}--> M1, and M1 is dead", () => {
    const n = thesisFig3_1();
    const g = concurrentReachabilityGraph(n);
    expect(g.states.length).toBe(2);
    expect(g.edges.map((e) => [e.from, showStep(n, e.step), e.to])).toEqual([[0, "{(t,b)}", 1]]);
    expect(g.deadlocks).toEqual([1]);
  });

  it("Fig. 6.5: CRG(N1) of Fig. 6.3 has the ten markings and fifteen labelled arcs drawn", () => {
    const g = expectCrgAsDrawn(thesisFig6_3(), FIG_6_5_STATES, FIG_6_5_EDGES);
    expect(g.states.length).toBe(10);
    expect(g.edges.length).toBe(15);
  });

  it("Fig. 6.5: the CRG is isomorphic (Def. 22) to the drawn graph", () => {
    const n = thesisFig6_3();
    const g = concurrentReachabilityGraph(n);
    const drawn: StepTransitionSystem<number> = {
      states: FIG_6_5_STATES.map((_, i) => i),
      initial: 0,
      edges: FIG_6_5_EDGES.map(([from, u, to]) => ({ from, to, step: parseStep(n, u) })),
    };
    expect(stsIsomorphic(g, drawn).isomorphic).toBe(true);
    const wrong = { ...drawn, edges: drawn.edges.filter((e) => !(e.from === 8 && e.to === 9)) };
    const r = stsIsomorphic(g, wrong);
    expect(r.isomorphic).toBe(false);
    expect(r.counterexample?.kind).toBe("stepOnlyInApn");
  });

  it("Sec. 6.4: the step sequences (1)-(7) of N1 can all be fired", () => {
    const n = thesisFig6_3();
    const U = (i: number) => parseStep(n, ["", "{(t1,b)}", "{(t2,b)}", "{(t3,b)}", "{(t4,b)}", "{(t5,b)}", "{(t6,b)}", "{(t3,b),(t4,b)}", "{(t3,b),(t5,b)}", "{(t3,b),(t6,b)}"][i]);
    const seqs = [
      [1, 2, 3, 4, 5, 6],
      [1, 2, 4, 3, 5, 6],
      [1, 2, 4, 5, 3, 6],
      [1, 2, 4, 5, 6, 3],
      [1, 2, 7, 5, 6],
      [1, 2, 4, 8, 6],
      [1, 2, 4, 5, 9],
    ];
    for (const s of seqs) {
      const r = runStepSequence(n, s.map(U));
      expect(r.ok).toBe(true);
      expect(markingPairs(n, r.markings[r.markings.length - 1])).toEqual(["(p4,b)", "(p6,b)", "(p8,b)"]);
    }
    const bad = runStepSequence(n, [U(1), U(4)]);
    expect(bad).toMatchObject({ ok: false, failedAt: 1 });
  });

  it("Def. 5: the CRG stops at its state and edge limits and on an abort signal", async () => {
    const n = thesisFig6_3();
    const small = concurrentReachabilityGraph(n, { maxStates: 4 });
    expect(small.states.length).toBe(4);
    expect(small).toMatchObject({ complete: false, reason: "states" });
    expect(concurrentReachabilityGraph(n, { maxEdges: 3 })).toMatchObject({ complete: false, reason: "edges" });
    const ac = new AbortController();
    ac.abort();
    expect(concurrentReachabilityGraph(n, { signal: ac.signal })).toMatchObject({ complete: false, reason: "aborted" });
    const all = await concurrentReachabilityGraphAsync(n, { yieldEvery: 2 });
    expect(all.states.length).toBe(10);
    const max = concurrentReachabilityGraph(n, { maximalOnly: true });
    expect(max.edges.every((e) => !(e.from === 2 && e.step.length === 1))).toBe(true);
  });

  it("Def. 5: a state whose expansion was cut short is open, never a deadlock", () => {
    const n = thesisFig6_3();
    const full = concurrentReachabilityGraph(n);
    expect(full.open).toEqual([]);
    // Step enumeration stopped before any step was recorded: nothing is known about the successors.
    const cut = concurrentReachabilityGraph(n, { maxStepsPerState: 0 });
    expect(cut).toMatchObject({ complete: false, reason: "steps", deadlocks: [] });
    expect(cut.open).toContain(0);
    // The state limit drops successors of explored states, and leaves later states unexpanded.
    const small = concurrentReachabilityGraph(n, { maxStates: 2 });
    expect(small.deadlocks.every((s) => full.deadlocks.includes(full.keys.indexOf(small.keys[s])))).toBe(true);
    expect(small.open.length).toBeGreaterThan(0);
    const edges = concurrentReachabilityGraph(n, { maxEdges: 1 });
    expect(edges.deadlocks).toEqual([]);
    expect(edges.open).toEqual([1, 2]); // M0 has one step; M1 was cut off mid-way, M2 never expanded
    const ac = new AbortController();
    ac.abort();
    expect(concurrentReachabilityGraph(n, { signal: ac.signal })).toMatchObject({ deadlocks: [], open: [0] });
  });
});

describe("T-APN class and semantics (Def. 20, Sec. 5.2-5.3)", () => {
  it("Def. 20, Fig. 5.1: Cl, Cl̄, f, C_P, C_T, Ins and the binding pairs B_t", () => {
    const s = tapnTuple(thesisFig5_1());
    expect(s.ClId).toEqual(["b", "w"]);
    expect(s.ClSpec).toEqual(["g", "l"]);
    expect(s.f).toEqual([
      ["b", "g"],
      ["w", "l"],
    ]);
    expect(s.CP.p5).toEqual(["g"]);
    expect(s.CP.p1).toEqual(["b", "w"]);
    expect(s.CT.t).toEqual(["b", "w"]);
    expect(s.Ins["p5→t"]).toEqual(["g", "l"]);
    expect(s.Ins["p1→t"]).toEqual(["b", "w"]);
    expect(s.TG).toEqual(["t"]);
    expect(s.B.t).toEqual([
      ["b", "g"],
      ["w", "l"],
    ]);
    expect(s.M0).toEqual(["(p1,b)", "(p1,w)", "(p2,b)", "(p2,w)", "(p5,g)"]);
  });

  it("Sec. 5.2, Fig. 5.1: {(t,b)} is enabled; {(t,w)} and {(t,b),(t,w)} are not, the complement l of w missing from p5", () => {
    const n = thesisFig5_1();
    const M0 = ambientInitialMarking(n);
    expect(texts(n, enabledSteps(n, M0).steps)).toEqual(["{(t,b)}"]);
    expect(isStepEnabled(n, M0, parseStep(n, "{(t,w)}"))).toBe(false);
    expect(isStepEnabled(n, M0, parseStep(n, "{(t,b),(t,w)}"))).toBe(false);
  });

  it("Sec. 5.3, Fig. 5.1(b): CRG is M0 --{(t,b)}--> M1 = {(p1,w),(p2,w),(p3,b),(p4,b)}", () => {
    const n = thesisFig5_1();
    const g = concurrentReachabilityGraph(n);
    expect(g.edges.map((e) => showStep(n, e.step))).toEqual(["{(t,b)}"]);
    expect(markingPairs(n, g.states[1])).toEqual(["(p1,w)", "(p2,w)", "(p3,b)", "(p4,b)"]);
    expect(g.deadlocks).toEqual([1]);
  });

  it("Def. 20: the guard Gd restricts the modes of a structured transition", () => {
    const n = thesisFig5_1();
    n.places[4].colourSet = "BW_bar";
    n.places[4].marking = "g ++ l";
    expect(texts(n, enabledSteps(n, ambientInitialMarking(n)).steps)).toEqual(["{(t,b),(t,w)}", "{(t,b)}", "{(t,w)}"]);
    const guarded = structuredClone(n);
    guarded.transitions[0].guard = "x = b and x_bar = g";
    expect(texts(guarded, enabledSteps(guarded, ambientInitialMarking(guarded)).steps)).toEqual(["{(t,b)}"]);
  });
});
