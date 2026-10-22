// General properties of composite APNs (Konios 2015, Sec. 4.3-4.4), checked over composite step nets
// generated at random from a root net by forward (Def. 8) and backward (Def. 12) compositions.
import { describe, expect, it } from "vitest";
import { Net, markingKey } from "@pns/core";
import { Colour, basicStepNet, oneStepNet, rootNet } from "../src/blocks";
import { backwardCompose, forwardCompose, isCompositeStepNet, isForwardCompositeStepNet } from "../src/compose";
import { fig410, fig411, fig412, fig49 } from "../src/model-figures";
import { analyseApn, controlPlacesOf } from "../src/model-structure";
import {
  isKBounded,
  isLive,
  isLiveMarking,
  isOrdinary,
  isPure,
  isReversible,
  isStructurallyBounded,
  placeBounds,
  reachabilityGraph,
} from "../src/model-properties";

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

interface Gen {
  net: Net;
  forwardOnly: boolean;
  selfLoop: boolean;
}

/** A random composite step net: a root net and `steps` compositions, each forward or backward. */
function randomComposite(seed: number, steps: number, opts: { forwardOnly?: boolean; selfLoops?: boolean } = {}): Gen {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const users = (): Colour[] => pick([["b"], ["w"], ["b", "w"]]);
  let net = rootNet({ place: "r", control: "ctrl_r", users: ["b", "w"], blocked: r() < 0.2 ? ["b"] : [] });
  let forwardOnly = true;
  let selfLoop = false;
  for (let i = 1; i <= steps; i++) {
    const decisions = Array.from({ length: 1 + Math.floor(r() * 2) }, () => ({ users: users() }));
    const G = analyseApn(net).gluing;
    const s = analyseApn(net);
    const pairs = G.flatMap((a) => G.map((b) => [a, b] as const)).filter(([a, b]) => (opts.selfLoops || a !== b) && !s.steps.some((x) => x.start === a && x.finish === b));
    if (!opts.forwardOnly && G.length > 1 && pairs.length && r() < 0.45) {
      const [g1, g2] = pick(pairs);
      net = backwardCompose(net, g1, g2, oneStepNet({ start: `s${i}`, finish: `f${i}`, step: `t${i}`, decisions }));
      forwardOnly = false;
      selfLoop ||= g1 === g2;
    } else {
      net = forwardCompose(net, pick(G), basicStepNet({ start: `s${i}`, finish: `q${i}`, step: `t${i}`, decisions }));
    }
  }
  return { net, forwardOnly, selfLoop };
}

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

describe("Sec. 4.3: composition produces composite step nets", () => {
  it("Def. 9: forward compositions of a root net give forward composite step nets", () => {
    for (const seed of SEEDS) {
      const { net } = randomComposite(seed, 4, { forwardOnly: true });
      expect(isForwardCompositeStepNet(net), `seed ${seed}`).toMatchObject({ ok: true });
    }
  });

  it("Def. 13: forward and backward compositions give composite step nets, whatever the order (the inhibitor arcs do not depend on it)", () => {
    for (const seed of SEEDS) {
      const { net } = randomComposite(seed, 5, { selfLoops: true });
      expect(isCompositeStepNet(net), `seed ${seed}`).toMatchObject({ ok: true });
    }
  });

  it("Sec. 4.3.1.1: in a forward composite step net every gluing place has exactly one control place", () => {
    for (const seed of SEEDS) {
      const { net } = randomComposite(seed, 4, { forwardOnly: true });
      const s = analyseApn(net);
      for (const g of s.gluing) expect(controlPlacesOf(net, g, s).length, `seed ${seed}`).toBe(1);
    }
  });

  it("Sec. 4.3.1.1: so each forward composition adds a single colour-sensitive inhibitor arc", () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const { net } = randomComposite(seed, 3, { forwardOnly: true });
      const before = net.arcs.filter((a) => a.kind === "inhibitor").length;
      const g = analyseApn(net).gluing[0];
      const after = forwardCompose(net, g, basicStepNet({ start: "x", finish: "y", step: "tx" }));
      expect(after.arcs.filter((a) => a.kind === "inhibitor").length).toBe(before + 1);
    }
  });

  it("Def. 12: backward composition keeps the gluing places, G' = G", () => {
    const n = forwardCompose(rootNet({ place: "r", users: ["b"] }), "r", basicStepNet({ start: "s", finish: "q", step: "t" }));
    const m = backwardCompose(n, "q", "r", oneStepNet({ start: "a", finish: "c", step: "back" }));
    expect(analyseApn(m).gluing.sort()).toEqual(analyseApn(n).gluing.sort());
  });
});

describe("Sec. 4.4.2: structural properties", () => {
  it("Lemma 2: a composite APN made by forward or backward compositions is pure (Def. 18)", () => {
    for (const seed of SEEDS) {
      const { net } = randomComposite(seed, 5);
      expect(isPure(net), `seed ${seed}`).toMatchObject({ ok: true });
    }
    for (const n of [fig49(), fig410(), fig411(), fig412()]) expect(isPure(n).ok).toBe(true);
  });

  it("Lemma 2 needs g1 ≠ g2: Def. 12 allows g1 = g2, and that step is a self-loop, so the net is not pure", () => {
    const n = forwardCompose(rootNet({ place: "r", users: ["b"] }), "r", basicStepNet({ start: "s", finish: "q", step: "t" }));
    const m = backwardCompose(n, "q", "q", oneStepNet({ start: "a", finish: "c", step: "stay" }));
    expect(isCompositeStepNet(m).ok).toBe(true);
    expect(isPure(m)).toMatchObject({ ok: false, reason: expect.stringMatching(/q is both a pre-place and a post-place of stay/) });
  });

  it("Lemma 3: a composite APN made by forward or backward compositions is ordinary (Def. 19)", () => {
    for (const seed of SEEDS) {
      const { net } = randomComposite(seed, 5, { selfLoops: true });
      expect(isOrdinary(net), `seed ${seed}`).toMatchObject({ ok: true });
    }
  });

  it("Def. 19: an arc of weight 2 makes a net not ordinary", () => {
    const n = fig49();
    n.arcs[0] = { ...n.arcs[0], inscription: "2`x" };
    expect(isOrdinary(n).ok).toBe(false);
  });
});

describe("Sec. 4.4.1: behavioural properties", () => {
  it("Lemma 1: an APN net is live iff all its reachable markings are live (Defs 14-15)", () => {
    for (const seed of SEEDS.slice(0, 16)) {
      const { net } = randomComposite(seed, 3);
      const g = reachabilityGraph(net);
      expect(g.complete).toBe(true);
      const allLive = g.markings.every((_, i) => isLiveMarking(net, i, g));
      expect(isLive(net, g).ok, `seed ${seed}`).toBe(allLive);
    }
    const bidirectional = fig410();
    const g = reachabilityGraph(bidirectional);
    expect(isLive(bidirectional, g).ok).toBe(true);
    expect(g.markings.every((_, i) => isLiveMarking(bidirectional, i, g))).toBe(true);
  });

  it("Def. 14: Fig. 4.9 is not live (the users stop in p6 or p13), Fig. 4.10 is", () => {
    expect(isLive(fig49())).toMatchObject({ ok: false, reason: expect.stringMatching(/t1/) });
    expect(isLive(fig410()).ok).toBe(true);
  });

  it("Defs 16-17 and Sec. 3.2: with capacity 1 per colour, composite APNs are 1-bounded and structurally bounded", () => {
    for (const seed of SEEDS.slice(0, 16)) {
      const { net } = randomComposite(seed, 3);
      const g = reachabilityGraph(net);
      expect(isKBounded(net, 1, g), `seed ${seed}`).toMatchObject({ ok: true });
      expect(isStructurallyBounded(net).ok).toBe(true);
    }
  });

  it("Def. 16: the bound is per structured place (p, c); a place may hold one token of each colour", () => {
    const b = placeBounds(fig49());
    const p1 = fig49().places.find((p) => p.name === "p1")!.id;
    expect(b.get(p1)).toEqual({ perColour: 1, total: 2 });
  });

  it("Defs 10, 14, 17: a partly explored state space leaves liveness, reversibility and boundedness undecided", () => {
    const net = fig410();
    const g = reachabilityGraph(net, { limit: 2 });
    expect(g.complete).toBe(false);
    expect(isLive(net, g)).toMatchObject({ ok: false, unknown: true });
    expect(isReversible(net, g)).toMatchObject({ ok: false, unknown: true });
    expect(isKBounded(net, 5, g)).toMatchObject({ ok: false, unknown: true });
    // Exceeding k in the explored part decides it.
    expect(isKBounded(net, 0, g).unknown).toBeUndefined();
  });

  it("Def. 10 and Sec. 4.3.2.2.1: the bidirectional step lets users undo the last action, so it is cyclic/reversible", () => {
    expect(isReversible(fig410())).toMatchObject({ ok: true });
  });

  it("Def. 10: forward composite nets are not cyclic/reversible (Sec. 4.3.2: forward composition never returns to a place)", () => {
    expect(isReversible(fig49()).ok).toBe(false);
    for (const seed of SEEDS.slice(0, 10)) {
      const { net } = randomComposite(seed, 2, { forwardOnly: true });
      const blocked = net.places.find((p) => p.name === "ctrl_r")!.marking === "b";
      if (!blocked) expect(isReversible(net).ok, `seed ${seed}`).toBe(false);
    }
  });

  it("with capacity 1, interleaving firing reaches the same markings as the step semantics (model-properties)", () => {
    for (const seed of SEEDS.slice(0, 16)) {
      const { net } = randomComposite(seed, 3);
      const a = new Set(reachabilityGraph(net).markings.map(markingKey));
      const b = new Set(reachabilityGraph(net, { semantics: "interleaving" }).markings.map(markingKey));
      expect([...a].sort(), `seed ${seed}`).toEqual([...b].sort());
    }
  });
});
