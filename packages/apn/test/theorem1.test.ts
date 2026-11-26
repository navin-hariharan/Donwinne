// Theorem 1 (Konios 2015, Sec. 6.6): for every composite step net N, CRG(N) and CRG(φ(N)) are
// isomorphic. Checked here on composite step nets generated at random from a root net by forward
// (Def. 8) and backward (Def. 12) compositions, with and without restricted users in the root
// control place (Fig. 4.6(b)).
import { describe, expect, it } from "vitest";
import { Net } from "@pns/core";
import { Colour, basicStepNet, oneStepNet, rootNet } from "../src/blocks";
import { backwardCompose, forwardCompose, isCompositeStepNet } from "../src/compose";
import { analyseApn } from "../src/model-structure";
import { checkEquivalence } from "../src/equivalence";
import { constructTapn } from "../src/construction";
import { runStepSequence } from "../src/crg";
import { parseStep } from "../src/steps";

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

function randomComposite(seed: number, steps: number, users: Colour[]): Net {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const some = (): Colour[] => {
    const s = users.filter(() => r() < 0.6);
    return s.length ? s : [pick(users)];
  };
  let net = rootNet({ place: "r", control: "ctrl_r", users: r() < 0.8 ? users : users.slice(0, 1), blocked: r() < 0.3 ? [pick(users)] : [] });
  for (let i = 1; i <= steps; i++) {
    const decisions = Array.from({ length: 1 + Math.floor(r() * 2) }, () => ({ users: some() }));
    const s = analyseApn(net);
    const G = s.gluing;
    const pairs = G.flatMap((a) => G.map((b) => [a, b] as const)).filter(([a, b]) => a !== b && !s.steps.some((x) => x.start === a && x.finish === b));
    if (G.length > 1 && pairs.length && r() < 0.5) {
      const [g1, g2] = pick(pairs);
      net = backwardCompose(net, g1, g2, oneStepNet({ start: `s${i}`, finish: `f${i}`, step: `t${i}`, decisions }));
    } else {
      net = forwardCompose(net, pick(G), basicStepNet({ start: `s${i}`, finish: `q${i}`, step: `t${i}`, decisions }));
    }
  }
  return net;
}

describe("Theorem 1 on random composite step nets", () => {
  const cases = Array.from({ length: 24 }, (_, i) => i + 1).filter((s) => ![11, 14, 15].includes(s)); // those three exceed the state limit
  it.each(cases)("seed %i: CRG(N) and CRG(φ(N)) are isomorphic (Def. 22)", (seed) => {
    const net = randomComposite(seed, 2 + (seed % 4), ["b", "w"]);
    expect(isCompositeStepNet(net).ok).toBe(true);
    const r = checkEquivalence(net, { maxStates: 4000 });
    expect(r.counterexample?.explanation ?? "", `seed ${seed}`).toBe("");
    expect(r.verdict).toBe("equivalent");
  }, 30_000);

  it("Def. 21 (iii): a place reached by two steps and left by none gets no Post_NEW arcs (regression)", () => {
    // r --t1--> q1 --t3--> q3 and r --t4--> q3 (backward). q3 has no outgoing step, so its control
    // places ctrl_q3 and ctrl_f4 inhibit nothing. With the arcs (t3, ctrl_f4) and (t4, ctrl_q3) of
    // Def. 21 (iii) as printed, the user b would end in q3 with f(b) in ctrl_f4 after t1 t3 but in
    // ctrl_q3 after t4: one marking of N, two of φ(N), and no isomorphism.
    let net = rootNet({ place: "r", control: "ctrl_r", users: ["b"] });
    net = forwardCompose(net, "r", basicStepNet({ start: "s1", finish: "q1", step: "t1", decisions: [{ users: ["b"] }] }));
    net = forwardCompose(net, "q1", basicStepNet({ start: "s3", finish: "q3", step: "t3", decisions: [{ users: ["b"] }] }));
    net = backwardCompose(net, "r", "q3", oneStepNet({ start: "s4", finish: "f4", step: "t4", decisions: [{ users: ["b"] }] }));
    expect(isCompositeStepNet(net).ok).toBe(true);
    const r = checkEquivalence(net);
    expect(r.construction!.sets.postNew).not.toContainEqual(["t3", "ctrl_f4"]);
    expect(r.construction!.sets.postNew).not.toContainEqual(["t4", "ctrl_q3"]);
    expect(r.verdict).toBe("equivalent");
  });
});

describe("Theorem 1 and self-loop steps (Def. 12 with g1 = g2)", () => {
  const selfLoop = () => {
    let net = rootNet({ place: "r", control: "ctrl_r", users: ["b"] });
    net = backwardCompose(net, "r", "r", oneStepNet({ start: "s2", finish: "f2", step: "t2", decisions: [{ users: ["b"] }] }));
    return net;
  };

  it("Def. 21 (iii): φ replaces the inhibitor arc (cp^t2(r), t2) of Def. 12 by Pre_REP, so the emptying transition can give f(b) back", () => {
    const net = selfLoop();
    const c = constructTapn(net);
    expect(c.roles.inhibitorPlaces.map((id) => net.places.find((p) => p.id === id)!.name).sort()).toEqual(["ctrl_f2", "ctrl_r"]);
    expect(c.sets.preRep).toContainEqual(["ctrl_f2", "t2"]);
    expect(c.sets.postNew).toContainEqual(["Tem_f2_1", "ctrl_f2"]);
    // The user can go round the loop again and again, one structured transition at a time, in both nets.
    const seq = ["{(t2,b)}", "{(Tem_f2_1,b)}", "{(Tr_f2_1,b)}", "{(t2,b)}", "{(Tem_f2_1,b)}"];
    expect(runStepSequence(net, seq.map((s) => parseStep(net, s))).ok).toBe(true);
    expect(runStepSequence(c.net, seq.map((s) => parseStep(c.net, s))).ok).toBe(true);
  });

  it("with self-loops the weak capacity rule (Sec. 3.3, footnote 1) lets N repeat t2 while emptying its control place in one step; φ(N) cannot, so Theorem 1 needs g1 ≠ g2", () => {
    const r = checkEquivalence(selfLoop());
    expect(r.verdict).toBe("not equivalent");
    expect(r.counterexample!.kind).toBe("stepOnlyInApn");
    expect(r.counterexample!.explanation).toMatch(/\{\(t2,b\),\(Tem_f2_1,b\)\}/);
  });
});
