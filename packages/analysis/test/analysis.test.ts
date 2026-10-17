import { describe, expect, it } from "vitest";
import { Net, emptyNet } from "@pns/core";
import { reachabilityGraph } from "@pns/sim";
import {
  AnalysisReport,
  analyseNet,
  computeInvariants,
  incidenceMatrix,
  minimalInvariants,
  minimalSets,
  structuralProperties,
  toPTNet,
} from "@pns/analysis";
import {
  colouredPhilosophers,
  deadTransition,
  liveFreeChoice,
  mk,
  mutex,
  philosophers,
  producerConsumer,
  siphonTrapFails,
  unbounded,
} from "./nets";

const status = (r: AnalysisReport, key: string) => {
  const item = r.summary.find((s) => s.key === key);
  if (!item) throw new Error(`no summary item ${key}`);
  return item.status;
};
const item = (r: AnalysisReport, key: string) => r.summary.find((s) => s.key === key)!;
const supports = (r: AnalysisReport, kind: "p" | "t") =>
  r.invariants[kind].invariants.map((i) => i.support.map((n) => n.name).sort().join(" ")).sort();
const setNames = (sets: { places: { name: string }[] }[]) => sets.map((s) => s.places.map((p) => p.name).sort().join(" ")).sort();

describe("incidence matrix", () => {
  it("is Post − Pre, with places as rows", () => {
    const net = mk("pt", [["P1", "2"], ["P2", ""]], [["t1"], ["t2"]], [["P1", "t1", "2"], ["t1", "P2"], ["P2", "t2"], ["t2", "P1", "2"]]);
    const c = incidenceMatrix(toPTNet(net));
    expect(c.placeIds).toEqual(["P1", "P2"]);
    expect(c.transitionIds).toEqual(["t1", "t2"]);
    expect(c.rows).toEqual([
      [-2, 2],
      [1, -1],
    ]);
  });

  it("treats read arcs as self-loops (zero column entries) and skips inhibitor arcs", () => {
    const net = mk("xpt", [["a", "1"], ["b", ""], ["c", ""]], [["t"]], [["a", "t", "1", "read"], ["c", "t", "1", "inhibitor"], ["t", "b"]]);
    const r = analyseNet(net);
    expect(r.incidence.rows).toEqual([[0], [1], [0]]);
    expect(r.structure.pure.holds).toBe(false);
    expect(r.warnings.some((w) => w.includes("Read arcs"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("Inhibitor"))).toBe(true);
  });
});

describe("invariants (Farkas / Martinez–Silva)", () => {
  it("finds the weighted invariant P1 + 2·P2 and its token sum", () => {
    const net = mk("pt", [["P1", "2"], ["P2", "1"]], [["t1"], ["t2"]], [["P1", "t1", "2"], ["t1", "P2"], ["P2", "t2"], ["t2", "P1", "2"]]);
    const inv = computeInvariants(toPTNet(net));
    expect(inv.p.invariants).toHaveLength(1);
    expect(inv.p.invariants[0].text).toBe("P1 + 2·P2");
    expect(inv.p.invariants[0].weights).toEqual({ P1: 1, P2: 2 });
    expect(inv.p.invariants[0].tokenSum).toBe(4);
    expect(inv.t.invariants.map((i) => i.weights)).toEqual([{ t1: 1, t2: 1 }]);
    expect(inv.cpi && inv.cti && inv.conservative && inv.consistent).toBe(true);
  });

  it("returns only minimal supports", () => {
    // y·A = 0 for A = rows of a 3-place cycle plus a duplicate place: supports {0,1,2} and {0,1,3}, not their union.
    const A = [[-1, 0, 1], [1, -1, 0], [0, 1, -1], [0, 1, -1]];
    const { vectors, truncated } = minimalInvariants(A, 3);
    expect(truncated).toBe(false);
    expect(vectors.map((v) => v.join("")).sort()).toEqual(["1101", "1110"]);
  });

  it("producer–consumer: 3 P-invariants (token sums 1, 1, capacity) and 1 T-invariant", () => {
    const r = analyseNet(producerConsumer(2));
    expect(supports(r, "p")).toEqual(["buffer free", "consumed waiting", "produced ready"]);
    const sums = Object.fromEntries(r.invariants.p.invariants.map((i) => [i.support.map((n) => n.name).sort().join(" "), i.tokenSum]));
    expect(sums).toEqual({ "buffer free": 2, "consumed waiting": 1, "produced ready": 1 });
    expect(supports(r, "t")).toEqual(["consume deliver produce remove"]);
    expect(r.invariants.cpi).toBe(true);
    expect(r.invariants.cti).toBe(true);
  });

  for (const n of [3, 5]) {
    it(`dining philosophers n=${n}: 2n P-invariants, n T-invariants`, () => {
      const r = analyseNet(philosophers(n));
      expect(r.invariants.p.invariants).toHaveLength(2 * n);
      expect(r.invariants.t.invariants).toHaveLength(n);
      expect(supports(r, "p")).toContain("eat0 think0");
      expect(supports(r, "p")).toContain(`eat0 eat${n - 1} fork0`);
      expect(r.invariants.p.invariants.every((i) => i.tokenSum === 1)).toBe(true);
      expect(r.invariants.cpi && r.invariants.cti).toBe(true);
    });

    it(`deadlocking philosophers n=${n}: 2n P-invariants, n T-invariants`, () => {
      const r = analyseNet(philosophers(n, true));
      expect(r.invariants.p.invariants).toHaveLength(2 * n);
      expect(r.invariants.t.invariants).toHaveLength(n);
      expect(supports(r, "p")).toContain("eat0 left0 think0");
      expect(supports(r, "p")).toContain(`eat0 eat${n - 1} fork0 left0`);
    });
  }

  it("mutual exclusion: 3 P-invariants, 2 T-invariants; mutex + crit1 + crit2 = 1", () => {
    const r = analyseNet(mutex());
    expect(supports(r, "p")).toEqual(["crit1 crit2 mutex", "crit1 idle1", "crit2 idle2"]);
    expect(supports(r, "t")).toEqual(["enter1 exit1", "enter2 exit2"]);
    expect(r.invariants.p.invariants.find((i) => i.support.length === 3)!.tokenSum).toBe(1);
  });

  it("reports places outside every P-invariant", () => {
    const r = analyseNet(unbounded());
    expect(supports(r, "p")).toEqual(["p1"]);
    expect(r.invariants.p.uncovered.map((p) => p.name)).toEqual(["p2"]);
    expect(status(r, "cpi")).toBe("no");
    expect(item(r, "cpi").explanation).toBe("No: p2 is in no P-invariant.");
    expect(status(r, "cti")).toBe("yes");
  });

  it("live free-choice net: 2 P-invariants and 2 T-invariants", () => {
    const r = analyseNet(liveFreeChoice());
    expect(supports(r, "p")).toEqual(["p1 p2 p4", "p1 p3 p5"]);
    expect(supports(r, "t")).toEqual(["t1 t2 t4 t5", "t1 t3 t4 t5"]);
  });
});

describe("structural properties", () => {
  it("producer–consumer is a marked graph, free choice, conservative, strongly connected", () => {
    const s = analyseNet(producerConsumer()).structure;
    expect(s.synchronisationGraph.holds).toBe(true);
    expect(s.stateMachine.holds).toBe(false);
    expect(s.stateMachine.reason).toBe("deliver has 2 input places.");
    expect(s.freeChoice.holds).toBe(true);
    expect(s.extendedFreeChoice.holds).toBe(true);
    expect(s.extendedSimple.holds).toBe(true);
    expect(s.conservative.holds).toBe(true);
    expect(s.staticConflictFree.holds).toBe(true);
    expect(s.pure.holds).toBe(true);
    expect(s.ordinary.holds).toBe(true);
    expect(s.homogeneous.holds).toBe(true);
    expect(s.connected.holds).toBe(true);
    expect(s.stronglyConnected.holds).toBe(true);
    expect(s.inputTransitions.holds || s.outputTransitions.holds || s.isolatedNodes.holds).toBe(false);
  });

  it("a cyclic choice net is a state machine but not a marked graph", () => {
    const net = mk("pt", [["p", "1"], ["q", ""]], [["a"], ["b"], ["c"]], [["p", "a"], ["a", "q"], ["p", "b"], ["b", "q"], ["q", "c"], ["c", "p"]]);
    const s = structuralProperties(toPTNet(net));
    expect(s.stateMachine.holds).toBe(true);
    expect(s.synchronisationGraph.holds).toBe(false);
    expect(s.freeChoice.holds).toBe(true);
    expect(s.staticConflictFree.holds).toBe(false);
    expect(s.staticConflictFree.witnesses.map((w) => w.name)).toEqual(["p", "a", "b"]);
  });

  it("philosophers: not FC, not EFC, not ES, not conservative", () => {
    const s = analyseNet(philosophers(3)).structure;
    expect(s.freeChoice.holds).toBe(false);
    expect(s.extendedFreeChoice.holds).toBe(false);
    expect(s.extendedSimple.holds).toBe(false);
    expect(s.conservative.holds).toBe(false);
    expect(s.conservative.reason).toBe("take0 removes 3 tokens but adds 1.");
  });

  it("mutex is extended simple but not extended free choice", () => {
    const s = analyseNet(mutex()).structure;
    expect(s.extendedSimple.holds).toBe(true);
    expect(s.extendedFreeChoice.holds).toBe(false);
    expect(s.freeChoice.holds).toBe(false);
  });

  it("weights: not ordinary, not homogeneous", () => {
    const net = mk("pt", [["p", "4"], ["q", ""]], [["a"], ["b"]], [["p", "a", "2"], ["p", "b"], ["a", "q"], ["b", "q"]]);
    const s = structuralProperties(toPTNet(net));
    expect(s.ordinary.holds).toBe(false);
    expect(s.ordinary.reason).toBe("Arc p → a has weight 2.");
    expect(s.homogeneous.holds).toBe(false);
  });

  it("detects input/output transitions and places, isolated nodes, disconnection", () => {
    const net = mk("pt", [["p", ""], ["q", ""], ["iso", ""]], [["src"], ["snk"], ["lone"]], [["src", "p"], ["p", "snk"], ["snk", "q"]]);
    const s = structuralProperties(toPTNet(net));
    expect(s.inputTransitions.witnesses.map((n) => n.name)).toEqual(["src", "lone"]);
    expect(s.outputTransitions.witnesses.map((n) => n.name)).toEqual(["lone"]);
    expect(s.inputPlaces.witnesses.map((n) => n.name)).toEqual(["iso"]);
    expect(s.outputPlaces.witnesses.map((n) => n.name)).toEqual(["q", "iso"]);
    expect(s.isolatedNodes.witnesses.map((n) => n.name)).toEqual(["iso", "lone"]);
    expect(s.connected.holds).toBe(false);
    expect(s.connected.reason).toBe("The net falls into 3 unconnected parts.");
    expect(s.stronglyConnected.holds).toBe(false);
  });
});

describe("siphons and traps", () => {
  it("mutex: three minimal siphons, all also marked traps; siphon-trap property holds", () => {
    const r = analyseNet(mutex());
    expect(setNames(r.siphonsTraps.siphons)).toEqual(["crit1 crit2 mutex", "crit1 idle1", "crit2 idle2"]);
    expect(setNames(r.siphonsTraps.traps)).toEqual(["crit1 crit2 mutex", "crit1 idle1", "crit2 idle2"]);
    expect(r.siphonsTraps.siphonTrapProperty).toBe("yes");
    expect(item(r, "siphonTrap").explanation).toContain("so the (ordinary, extended simple) net is live");
  });

  it("free-choice net with an unmarked siphon {p4}: property fails", () => {
    const r = analyseNet(siphonTrapFails());
    expect(r.siphonsTraps.siphonTrapProperty).toBe("no");
    expect(r.siphonsTraps.badSiphons.map((s) => s.map((p) => p.name))).toEqual([["p4"]]);
    expect(item(r, "siphonTrap").explanation).toBe("No: the siphon {p4} contains no marked trap; once emptied it stays empty.");
    expect(item(r, "siphonTrap").elementIds).toEqual(["p4"]);
  });

  it("deadlocking philosophers violate the siphon-trap property; atomic ones satisfy it", () => {
    expect(analyseNet(philosophers(3, true)).siphonsTraps.siphonTrapProperty).toBe("no");
    expect(analyseNet(philosophers(3)).siphonsTraps.siphonTrapProperty).toBe("yes");
  });

  it("enumerates all minimal siphons exactly (siphons that are not traps included)", () => {
    // p -> t -> q: {p} is a siphon (no input transitions), {q} is a trap (no output transitions).
    const pt = toPTNet(mk("pt", [["p", "1"], ["q", ""]], [["t"]], [["p", "t"], ["t", "q"]]));
    expect(minimalSets(pt, "siphons").sets).toEqual([[0]]);
    expect(minimalSets(pt, "traps").sets).toEqual([[1]]);
  });

  it("philosophers n=5 have the expected minimal siphons", () => {
    const r = analyseNet(philosophers(5));
    // Every P-invariant support is a siphon and a trap; the atomic net has exactly those 2n.
    expect(setNames(r.siphonsTraps.siphons)).toEqual(supports(r, "p"));
    expect(r.siphonsTraps.siphonsTruncated).toBe(false);
  });
});

describe("behaviour", () => {
  it("producer–consumer: 12 states, 2-bounded, live, reversible", () => {
    const b = analyseNet(producerConsumer(2)).behaviour;
    expect(b.exploration).toBe("complete");
    expect(b.states).toBe(12);
    expect(b.k).toBe(2);
    expect(b.bounded).toBe("yes");
    expect(b.safe).toBe("no");
    expect(b.deadlockFree).toBe("yes");
    expect(b.live).toBe("yes");
    expect(b.reversible).toBe("yes");
    expect(b.hasHomeStates).toBe("yes");
    expect(b.homeStates).toBe(12);
    expect(b.placeBounds.find((p) => p.place.name === "buffer")!.max).toBe(2);
  });

  it("mutual exclusion: 3 states, safe, live, reversible; crit1 and crit2 never both marked", () => {
    const r = analyseNet(mutex());
    expect(r.behaviour.states).toBe(3);
    expect(status(r, "safe")).toBe("yes");
    expect(status(r, "live")).toBe("yes");
    expect(status(r, "reversible")).toBe("yes");
    expect(status(r, "deadlockFree")).toBe("yes");
    expect(status(r, "deadTransitions")).toBe("no");
  });

  it("atomic philosophers: 4 and 11 states, live, safe, reversible", () => {
    const r3 = analyseNet(philosophers(3)).behaviour;
    const r5 = analyseNet(philosophers(5)).behaviour;
    expect([r3.states, r5.states]).toEqual([4, 11]);
    for (const b of [r3, r5]) {
      expect(b.live).toBe("yes");
      expect(b.safe).toBe("yes");
      expect(b.reversible).toBe("yes");
      expect(b.liveTransitions).toHaveLength(b === r3 ? 6 : 10);
    }
  });

  for (const n of [3, 5]) {
    it(`deadlocking philosophers n=${n}: deadlock after n left-fork takes`, () => {
      const r = analyseNet(philosophers(n, true));
      const b = r.behaviour;
      expect(b.deadlockFree).toBe("no");
      expect(b.deadlocks).toBe(1);
      expect(b.firstDeadlock!.path).toHaveLength(n);
      expect(b.firstDeadlock!.path.every((t) => t.name.startsWith("takeL"))).toBe(true);
      expect(Object.keys(b.firstDeadlock!.marking).sort()).toEqual(Array.from({ length: n }, (_, i) => `left${i}`).sort());
      expect(b.live).toBe("no");
      expect(b.reversible).toBe("no");
      expect(b.hasDeadTransitions).toBe("no");
      expect(item(r, "live").explanation).toMatch(/^No: the net can reach a dead marking/);
      // Same state space as the simulator's reachability graph.
      expect(b.states).toBe(reachabilityGraph(philosophers(n, true)).states.length);
    });
  }

  it("dead transition: t2 never fires; deadlock after t1", () => {
    const r = analyseNet(deadTransition());
    const b = r.behaviour;
    expect(b.hasDeadTransitions).toBe("yes");
    expect(b.deadTransitions.map((t) => t.name)).toEqual(["t2"]);
    expect(item(r, "deadTransitions").explanation).toBe("Yes: transition t2 can never fire.");
    expect(item(r, "deadTransitions").elementIds).toEqual(["t2"]);
    expect(b.firstDeadlock!.path.map((t) => t.name)).toEqual(["t1"]);
    expect(item(r, "deadlockFree").explanation).toBe("No: firing t1 reaches a dead marking (p2).");
    expect(b.live).toBe("no");
    expect(b.reversible).toBe("no");
    expect(b.hasHomeStates).toBe("yes");
    expect(b.homeStates).toBe(1);
  });

  it("live free-choice net: live, safe, reversible; siphon-trap property holds", () => {
    const r = analyseNet(liveFreeChoice());
    expect(r.structure.freeChoice.holds).toBe(true);
    expect(status(r, "live")).toBe("yes");
    expect(status(r, "safe")).toBe("yes");
    expect(status(r, "reversible")).toBe("yes");
    expect(status(r, "siphonTrap")).toBe("yes");
  });

  it("siphon-trap failure: not live, deadlock via t2", () => {
    const r = analyseNet(siphonTrapFails());
    expect(status(r, "live")).toBe("no");
    expect(r.behaviour.firstDeadlock!.path.map((t) => t.name)).toEqual(["t2"]);
    expect(r.behaviour.deadTransitions.map((t) => t.name)).toEqual(["t4"]);
  });

  it("not live without deadlocks: a transition that can only fire before a choice", () => {
    // a: p -> q (once); then b/c cycle on q <-> r. a is not live, b and c are.
    const net = mk("pt", [["p", "1"], ["q", ""], ["r", ""]], [["a"], ["b"], ["c"]], [["p", "a"], ["a", "q"], ["q", "b"], ["b", "r"], ["r", "c"], ["c", "q"]]);
    const r = analyseNet(net);
    expect(status(r, "deadlockFree")).toBe("yes");
    expect(status(r, "live")).toBe("no");
    expect(r.behaviour.nonLiveTransitions.map((t) => t.name)).toEqual(["a"]);
    expect(r.behaviour.liveTransitions.map((t) => t.name)).toEqual(["b", "c"]);
    expect(item(r, "live").explanation).toBe("No: after a, a can never fire again.");
    expect(status(r, "reversible")).toBe("no");
    expect(status(r, "homeStates")).toBe("yes");
  });

  it("unbounded net: Karp–Miller finds the unbounded place when exploration is truncated", () => {
    const r = analyseNet(unbounded(), { maxStates: 50 });
    const b = r.behaviour;
    expect(b.exploration).toBe("truncated");
    expect(b.bounded).toBe("no");
    expect(b.unboundedPlaces.map((p) => p.name)).toEqual(["p2"]);
    expect(b.placeBounds.map((p) => [p.place.name, p.max])).toEqual([["p1", 1], ["p2", null]]);
    expect(b.coverability?.complete).toBe(true);
    expect(b.safe).toBe("no");
    expect(b.k).toBeNull();
    expect(item(r, "bounded").explanation).toBe("No: p2 can grow without bound (Karp–Miller coverability).");
    // Ordinary, extended simple, siphon-trap property: live and deadlock-free by structure.
    expect(b.live).toBe("yes");
    expect(b.deadlockFree).toBe("yes");
    expect(b.reversible).toBe("unknown");
    expect(r.warnings.some((w) => w.includes("stopped at 50 states"))).toBe(true);
  });

  it("truncation without coverability: bounded by P-invariants, liveness by Commoner's theorem", () => {
    const r = analyseNet(siphonTrapFails(), { maxStates: 1 });
    expect(r.behaviour.exploration).toBe("truncated");
    // The coverability graph hits the same limit, and p4 is in no P-invariant.
    expect(r.behaviour.bounded).toBe("unknown");
    expect(r.behaviour.live).toBe("no");
    expect(item(r, "live").explanation).toContain("Commoner");

    const capped = mutex();
    capped.places[0].capacity = 1; // capacities rule out coverability; invariants still bound the net
    const r2 = analyseNet(capped, { maxStates: 1 });
    expect(r2.behaviour.bounded).toBe("yes");
    expect(r2.behaviour.placeBounds.every((p) => p.source === "invariants" && p.max === 1)).toBe(true);
    expect(r2.behaviour.safe).toBe("yes");
    // Capacities make structural liveness theorems inapplicable.
    expect(r2.behaviour.live).toBe("unknown");
    expect(r2.behaviour.deadlockFree).toBe("unknown");
  });

  it("unknown boundedness with inhibitor arcs and a truncated state space", () => {
    const net = unbounded();
    net.netClass = "xpt";
    net.places.push({ id: "z", name: "z", x: 0, y: 0, marking: "" });
    net.arcs.push({ id: "inh", source: "z", target: "t1", kind: "inhibitor", inscription: "1" });
    const r = analyseNet(net, { maxStates: 20 });
    expect(r.behaviour.bounded).toBe("unknown");
    expect(r.behaviour.live).toBe("unknown");
    expect(r.behaviour.reversible).toBe("unknown");
    expect(item(r, "bounded").explanation).toMatch(/^Unknown: the state space has more than 20 states/);
  });

  it("agrees with @pns/sim's reachability graph on extended arcs and capacities", () => {
    const net = mk(
      "xpt",
      [["a", "3"], ["b", "", { capacity: 2 }], ["c", "1"], ["d", ""]],
      [["t1"], ["t2"], ["t3"], ["t4"]],
      [
        ["a", "t1"], ["t1", "b"],
        ["b", "t2", "2", "equal"], ["b", "t2", "2"], ["t2", "d"],
        ["c", "t3", "1", "read"], ["d", "t3"], ["d", "t3", "", "reset"], ["t3", "a"],
        ["d", "t4", "1", "inhibitor"], ["b", "t4"], ["t4", "c"],
      ],
    );
    const r = analyseNet(net);
    const rg = reachabilityGraph(net);
    expect(r.behaviour.states).toBe(rg.states.length);
    expect(r.behaviour.edges).toBe(rg.edges.length);
    expect(r.behaviour.deadlocks).toBe(rg.states.filter((s) => s.dead).length);
    expect(r.warnings.some((w) => w.includes("Reset arcs"))).toBe(true);
  });

  it("marking-dependent weights: explored, but left out of the structure with a warning", () => {
    const net = mk("xpt", [["p", "2"], ["q", ""]], [["t"], ["u"]], [["p", "t"], ["t", "q", "p + 1"], ["q", "u", "q"], ["q", "u", "1", "read"], ["u", "p"]]);
    const r = analyseNet(net);
    expect(r.incidence.ignoredArcs.sort()).toEqual(["a1", "a2"]);
    expect(r.warnings.filter((w) => w.includes("marking-dependent"))).toHaveLength(2);
    net.netClass = "xpt";
    expect(r.behaviour.exploration).toBe("complete");
    expect(r.behaviour.states).toBe(reachabilityGraph(net).states.length);
  });
});

describe("net features", () => {
  it("coloured philosophers: analysed via unfolding, results mapped back to colours", () => {
    const r = analyseNet(colouredPhilosophers());
    expect(r.net.unfolded).toBe(true);
    expect(r.places).toHaveLength(9);
    expect(r.transitions).toHaveLength(6);
    expect(r.invariants.p.invariants).toHaveLength(6);
    expect(r.invariants.t.invariants).toHaveLength(3);
    expect(r.behaviour.states).toBe(4);
    expect(status(r, "live")).toBe("yes");
    const think = r.places.find((p) => p.name === "think[a]")!;
    expect(think).toMatchObject({ baseName: "think", colour: "a", elementIds: ["think"] });
    const take = r.transitions.find((t) => t.name === "take<x=a>")!;
    expect(take).toMatchObject({ baseName: "take", colour: "x=a", elementIds: ["take"] });
    expect(supports(r, "p")).toContain("eat[a] think[a]");
    expect(supports(r, "p")).toContain("eat[a] eat[c] fork[a]");
    expect(supports(r, "t")).toContain("release<x=a> take<x=a>");
  });

  it("coloured: a binding that can never fire is reported with its colour", () => {
    const net = colouredPhilosophers();
    net.places[0].marking = "a ++ b"; // philosopher c never thinks, so take<x=c> is dead
    const r = analyseNet(net);
    expect(r.behaviour.deadTransitions.map((t) => t.name)).toEqual(["take<x=c>", "release<x=c>"]);
    expect(item(r, "deadTransitions").elementIds).toEqual(["take", "release"]);
  });

  it("logical places share one marking and one row", () => {
    const net = mk(
      "pt",
      [["p", "1"], ["L", "", { logical: true }], ["L", "", { logical: true }]],
      [["t1"], ["t2"]],
      [["p", "t1"], ["t1", "L"], ["L", "t2"], ["t2", "p"]],
    );
    net.places[2].id = "L2";
    net.arcs[2].source = "L2";
    const r = analyseNet(net);
    expect(r.places.map((p) => p.name)).toEqual(["p", "L"]);
    expect(r.places[1].elementIds).toEqual(["L", "L2"]);
    expect(supports(r, "p")).toEqual(["L p"]);
    expect(r.behaviour.states).toBe(2);
    expect(status(r, "live")).toBe("yes");
  });

  it("coarse nodes are ignored", () => {
    const net = mutex();
    net.transitions.push({ id: "macro", name: "macro", x: 0, y: 0, coarse: true });
    net.arcs.push({ id: "m1", source: "mutex", target: "macro", kind: "normal", inscription: "1" });
    const r = analyseNet(net);
    expect(r.transitions).toHaveLength(4);
    expect(r.invariants.p.invariants).toHaveLength(3);
    expect(status(r, "live")).toBe("yes");
  });

  it("hybrid nets: only the discrete part is analysed", () => {
    const net = mk(
      "hybrid",
      [["d", "1"], ["e", ""], ["x", "2.5", { continuous: true }]],
      [["t1", { kind: "stochastic" }], ["t2", { kind: "stochastic" }], ["flow", { kind: "continuous" }]],
      [["d", "t1"], ["t1", "e"], ["e", "t2"], ["t2", "d"], ["x", "flow"], ["d", "flow", "1", "read"]],
    );
    const r = analyseNet(net);
    expect(r.places.map((p) => p.name)).toEqual(["d", "e"]);
    expect(r.transitions.map((t) => t.name)).toEqual(["t1", "t2"]);
    expect(r.warnings.some((w) => w.startsWith("Hybrid net"))).toBe(true);
    expect(status(r, "live")).toBe("yes");
  });

  it("stochastic nets: rates ignored, underlying net analysed", () => {
    const net = mutex();
    net.netClass = "stochastic";
    for (const t of net.transitions) t.rate = "MassAction(1)";
    const r = analyseNet(net);
    expect(r.behaviour.states).toBe(3);
    expect(r.warnings.some((w) => w.includes("Rates, delays and priorities are ignored"))).toBe(true);
  });

  it("empty nets and fault trees: n/a everywhere", () => {
    for (const net of [emptyNet("pt"), emptyNet("faultTree")]) {
      const r = analyseNet(net);
      expect(r.summary.every((s) => s.status === "n/a")).toBe(true);
      expect(r.behaviour.exploration).toBe("skipped");
    }
  });

  it("nets with errors skip the state space but keep the structure", () => {
    const net = mutex();
    net.places[0].marking = "-1";
    const r = analyseNet(net);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.behaviour.exploration).toBe("skipped");
    expect(status(r, "live")).toBe("n/a");
    expect(r.invariants.p.invariants).toHaveLength(3);
  });

  it("aborts on a fired signal", () => {
    const ac = new AbortController();
    ac.abort();
    expect(() => analyseNet(mutex(), { signal: ac.signal })).toThrow(/aborted/);
  });

  it("report is plain JSON and every summary item has an explanation", () => {
    const r = analyseNet(producerConsumer());
    const round = JSON.parse(JSON.stringify(r));
    expect(round).toEqual(r);
    for (const s of r.summary) {
      expect(s.explanation.length).toBeGreaterThan(5);
      expect(["yes", "no", "unknown", "n/a"]).toContain(s.status);
      if (s.status !== "n/a") expect(s.explanation.startsWith({ yes: "Yes", no: "No", unknown: "Unknown" }[s.status]!)).toBe(true);
    }
    expect(new Set(r.summary.map((s) => s.key)).size).toBe(r.summary.length);
  });
});

describe("performance", () => {
  it("handles 7 deadlocking philosophers and a larger state space quickly", () => {
    const t0 = Date.now();
    const r = analyseNet(philosophers(7, true));
    expect(r.invariants.p.invariants).toHaveLength(14);
    expect(r.behaviour.states).toBe(reachabilityGraph(philosophers(7, true), { maxStates: 100_000 }).states.length);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it("state limit: maxStates caps the exploration", () => {
    const net: Net = producerConsumer(50);
    const r = analyseNet(net, { maxStates: 30 });
    expect(r.behaviour.exploration).toBe("truncated");
    expect(r.behaviour.states).toBe(30);
    // P-invariants bound every place (so no coverability graph is needed).
    expect(r.behaviour.coverability).toBeUndefined();
    expect(r.behaviour.bounded).toBe("yes");
    expect(r.behaviour.k).toBe(50);
    expect(r.behaviour.placeBounds.find((b) => b.place.name === "buffer")).toMatchObject({ max: 50, source: "invariants" });
  });
});

describe("Snoopy samples", () => {
  it("observers referring to left-out continuous places do not block the analysis", () => {
    const net = mk(
      "hybrid",
      [["d", "1"], ["x", "2.5", { continuous: true }]],
      [["t", { kind: "stochastic" }], ["flow", { kind: "continuous" }]],
      [["d", "t"], ["t", "d"], ["x", "flow"]],
    );
    net.declarations.observers = [{ name: "obs", kind: "place", expression: "x + d" }];
    const r = analyseNet(net);
    expect(r.errors).toEqual([]);
    expect(status(r, "live")).toBe("yes");
  });
});
