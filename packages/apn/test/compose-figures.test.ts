// Figs 4.7-4.12 of Konios (2015), rebuilt with the composition operators and compared with the
// figures arc by arc (by element name).
import { describe, expect, it } from "vitest";
import { Net, compile } from "@pns/core";
import {
  backwardCompose,
  checkBackwardComposition,
  checkForwardComposition,
  forwardCompose,
  isBasicStepNet,
  isCompositeStepNet,
  isForwardCompositeStepNet,
  isOneStepNet,
  isRootNet,
} from "../src/compose";
import { fig410, fig411, fig412, fig43N, fig46, fig47N1, fig47N2, fig47N3, fig48N4, fig49 } from "../src/model-figures";
import { oneStepNet, basicStepNet } from "../src/blocks";
import { gluingFlag } from "../src/model-structure";

const nm = (net: Net, id: string) => net.places.find((p) => p.id === id)?.name ?? net.transitions.find((t) => t.id === id)?.name ?? id;
const normal = (net: Net) => net.arcs.filter((a) => a.kind === "normal").map((a) => `${nm(net, a.source)}>${nm(net, a.target)}`).sort();
const inhibitors = (net: Net) => net.arcs.filter((a) => a.kind === "inhibitor").map((a) => `${nm(net, a.source)}-o${nm(net, a.target)}`).sort();
const places = (net: Net) => net.places.map((p) => p.name).sort();
const transitions = (net: Net) => net.transitions.map((t) => t.name).sort();
const marking = (net: Net) => Object.fromEntries(net.places.filter((p) => p.marking.trim()).map((p) => [p.name, p.marking]));
const gluing = (net: Net) => net.places.filter((p) => gluingFlag(p)).map((p) => p.name).sort();

/** Arcs of a step from a to b with control place c and decision points [pd, tem, pr, tr]. */
function step(a: string, t: string, b: string, c: string, rows: [string, string, string, string][]): string[] {
  return [`${a}>${t}`, `${t}>${b}`, `${t}>${c}`, ...rows.flatMap(([pd, tem, pr, tr]) => [`${c}>${tem}`, `${pd}>${tem}`, `${tem}>${pr}`, `${pr}>${tr}`, `${tr}>${pd}`])];
}
const S1 = (from = "p1") => step(from, "t1", "p2", "p3", [["p4", "t2", "p5", "t3"]]);
const S3 = (from: string, to: string) => step(from, "t4", to, "p7", [["p8", "t5", "p10", "t6"], ["p9", "t7", "p11", "t8"]]);
const S4 = (from: string, to: string) => step(from, "t9", to, "p14", [["p15", "t10", "p17", "t11"], ["p16", "t12", "p18", "t13"]]);

function noErrors(net: Net) {
  expect(compile(net).problems.filter((p) => p.severity === "error")).toEqual([]);
}

function noOverlaps(net: Net) {
  const nodes = [...net.places, ...net.transitions];
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) expect(Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y), `${nodes[i].name} / ${nodes[j].name}`).toBeGreaterThanOrEqual(40);
}

describe("Fig. 4.7 and Fig. 4.8: the component nets", () => {
  it("Fig. 4.7(a): N1 is a root net (Def. 7) with p1 = {b, w} and p0 empty", () => {
    const n1 = fig47N1();
    expect(isRootNet(n1).ok).toBe(true);
    expect(places(n1)).toEqual(["p0", "p1"]);
    expect(marking(n1)).toEqual({ p1: "b ++ w" });
    expect(gluing(n1)).toEqual(["p1"]);
    expect(isForwardCompositeStepNet(n1).ok).toBe(true); // X_Root ⊂ X^F_Com (Def. 9)
  });

  it("Fig. 4.7(b): N2 is a basic step net (Def. 6) with one decision point", () => {
    const n2 = fig47N2();
    expect(isBasicStepNet(n2)).toMatchObject({ ok: true });
    expect(isOneStepNet(n2).ok).toBe(false); // G_S = {p_s} only
    expect(normal(n2)).toEqual(S1("p1'").sort());
    expect(inhibitors(n2)).toEqual([]);
    expect(marking(n2)).toEqual({ p4: "b ++ w" });
    expect(gluing(n2)).toEqual(["p1'"]);
    noErrors(n2);
  });

  it("Fig. 4.7(c): N3 is a basic step net with two decision points (multiple decision points, Fig. 4.2(b))", () => {
    const n3 = fig47N3();
    expect(isBasicStepNet(n3).ok).toBe(true);
    expect(normal(n3)).toEqual(S3("p5'", "p6").sort());
    expect(marking(n3)).toEqual({ p8: "w", p9: "b" });
  });

  it("Fig. 4.8: N4 is a basic step net", () => {
    const n4 = fig48N4();
    expect(isBasicStepNet(n4).ok).toBe(true);
    expect(normal(n4)).toEqual(S4("p12", "p13").sort());
    expect(marking(n4)).toEqual({ p15: "w", p16: "b" });
  });

  it("Def. 11: a one step net has gluing places p_s and p_f", () => {
    const one = oneStepNet({ start: "a", finish: "b" });
    expect(isOneStepNet(one).ok).toBe(true);
    expect(isBasicStepNet(one).ok).toBe(false);
    expect(gluing(one)).toEqual(["a", "b"]);
  });

  it("Fig. 4.6(b): the root place's control place may hold restricted users", () => {
    expect(isRootNet(fig46(true)).ok).toBe(true);
    expect(marking(fig46(true))).toEqual({ p: "b ++ w", pc: "b" });
  });
});

describe("Fig. 4.9: forward composition (Def. 8)", () => {
  it("N1 ⊕p1 N2 inserts the colour-sensitive inhibitor arc (p0, t1) (Sec. 4.3.1.2)", () => {
    const n = forwardCompose(fig47N1(), "p1", fig47N2());
    expect(inhibitors(n)).toEqual(["p0-ot1"]);
    expect(places(n)).not.toContain("p1'");
    expect(gluing(n)).toEqual(["p1", "p2"]);
    expect(isForwardCompositeStepNet(n).ok).toBe(true);
  });

  it("(N1 ⊕p1 N2) ⊕p2 N3 adds (p3, t4) and has gluing places {p1, p2, p6} (Sec. 4.3.1.2)", () => {
    const n = fig43N();
    expect(inhibitors(n)).toEqual(["p0-ot1", "p3-ot4"]);
    expect(gluing(n)).toEqual(["p1", "p2", "p6"]);
  });

  it("Fig. 4.9: N ⊕p2 N4 fuses p12 into p2, adds (p3 = cp^t1(p2), t9) and makes p13 a gluing place", () => {
    const n = fig49();
    expect(places(n)).toEqual(Array.from({ length: 19 }, (_, i) => `p${i}`).filter((p) => p !== "p12").sort());
    expect(transitions(n)).toEqual(Array.from({ length: 13 }, (_, i) => `t${i + 1}`).sort());
    expect(normal(n)).toEqual([...S1(), ...S3("p2", "p6"), ...S4("p2", "p13")].sort());
    expect(inhibitors(n)).toEqual(["p0-ot1", "p3-ot4", "p3-ot9"]);
    expect(marking(n)).toEqual({ p1: "b ++ w", p4: "b ++ w", p8: "w", p9: "b", p15: "w", p16: "b" });
    expect(gluing(n)).toEqual(["p1", "p13", "p2", "p6"]);
    expect(isForwardCompositeStepNet(n)).toMatchObject({ ok: true });
    noErrors(n);
    noOverlaps(n);
  });

  it("Sec. 4.3.1.1: forward composition only produces directed trees: every step place has at most one incoming step", () => {
    const n = fig49();
    const steps = ["t1", "t4", "t9"].map((t) => n.arcs.find((a) => a.kind === "normal" && nm(n, a.source) === t && !/^p(3|7|14)$/.test(nm(n, a.target)))!);
    const targets = steps.map((a) => nm(n, a.target));
    expect(new Set(targets).size).toBe(targets.length);
    expect(targets).not.toContain("p1");
  });

  it("Def. 8 refuses a place that is not a gluing place, and a second net that is not a basic step net", () => {
    expect(checkForwardComposition(fig43N(), "p3", fig48N4())).toMatchObject({ ok: false });
    expect(checkForwardComposition(fig43N(), "p2", fig47N1())).toMatchObject({ ok: false });
  });

  it("Def. 8 refuses gluing places of different colour sets: C(g) = C_S(p_s)", () => {
    const other = basicStepNet({ colourSet: { name: "UID", type: "int", min: 1, max: 2 } });
    const r = checkForwardComposition(fig43N(), "p2", other);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/colour sets differ/);
  });
});

describe("Fig. 4.10: the bidirectional step (Def. 12)", () => {
  it("removes p5' and p6 and gives I' = {(p0, t1), (p3, t4), (p7, t1)} (Sec. 4.3.2.2.1)", () => {
    const n = fig410();
    expect(places(n)).toEqual(["p0", "p1", "p10", "p11", "p2", "p3", "p4", "p5", "p7", "p8", "p9"]);
    expect(normal(n)).toEqual([...S1(), ...S3("p2", "p1")].sort());
    expect(inhibitors(n)).toEqual(["p0-ot1", "p3-ot4", "p7-ot1"]);
    expect(gluing(n)).toEqual(["p1", "p2"]); // G' = G
    noErrors(n);
    noOverlaps(n);
  });

  it("is a composite step net (Def. 13) but not a forward composite one (Def. 9)", () => {
    const n = fig410();
    const c = isCompositeStepNet(n);
    expect(c.ok).toBe(true);
    expect(c.derivation?.map((d) => d.kind)).toEqual(["root", "forward", "backward"]);
    const f = isForwardCompositeStepNet(n);
    expect(f.ok).toBe(false);
    expect(f.reason).toMatch(/backward composition/);
  });

  it("p1 has two control places after the composition: p0 = cp^ε(p1) and p7 = cp^t4(p1) (Sec. 4.3.2.2.1)", () => {
    const n = fig410();
    const into = (pl: string) => n.arcs.filter((a) => a.kind === "inhibitor" && nm(n, a.target) === "t1").map((a) => nm(n, a.source)).sort();
    expect(into("t1")).toEqual(["p0", "p7"]);
  });

  it("Sec. 4.3.2.1: no second backward composition on the same gluing pairs", () => {
    const n = fig410();
    const r = checkBackwardComposition(n, "p2", "p1", oneStepNet({ start: "a", finish: "b", step: "t99", control: "c99" }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Sec\. 4\.3\.2\.1/);
  });

  it("Sec. 4.3.2.1: g1 = g2 is allowed and glues both p_s and p_f to one place (a self-loop step)", () => {
    const n = backwardCompose(fig43N(), "p6", "p6", oneStepNet({ start: "a", finish: "b", step: "stay", control: "ctrl_stay" }));
    expect(normal(n)).toEqual(expect.arrayContaining(["p6>stay", "stay>p6", "stay>ctrl_stay"]));
    // cp^t4(p6) = p7 guards the new step. Def. 12 would also add (ctrl_stay, stay), but Def. 3 forbids an
    // inhibitor arc next to the arc stay → ctrl_stay, so that one is left out.
    expect(inhibitors(n)).toEqual(["p0-ot1", "p3-ot4", "p7-ostay"]);
    expect(isCompositeStepNet(n).ok).toBe(true);
  });
});

describe("Fig. 4.11: the N-graph", () => {
  it("removes p12 and p13 and gives I' = {(p0, t1), (pc, t4), (pc, t9)} (Sec. 4.3.2.2.2)", () => {
    const n = fig411();
    expect(places(n)).toEqual(["p", "p0", "p1", "p10", "p11", "p14", "p15", "p16", "p17", "p18", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "pc"].sort());
    expect(normal(n)).toEqual([...S1(), ...S3("p", "p6"), ...S4("p", "p2")].sort());
    expect(inhibitors(n)).toEqual(["p0-ot1", "pc-ot4", "pc-ot9"]);
    expect(marking(n)).toEqual({ p: "b ++ w", pc: "b", p1: "b ++ w", p4: "b ++ w", p8: "w", p9: "b", p15: "w", p16: "b" });
    noErrors(n);
    noOverlaps(n);
  });

  it("has two root nets, so it is a composite step net only when parallel roots are allowed (Def. 13 reading)", () => {
    const n = fig411();
    expect(isCompositeStepNet(n).ok).toBe(false);
    expect(isCompositeStepNet(n).reason).toMatch(/2 root nets/);
    expect(isCompositeStepNet(n, { severalRoots: true }).ok).toBe(true);
  });
});

describe("Fig. 4.12: forward composite net backward composed with a one step net", () => {
  it("gives I' = I ∪ {(p3, t9)} ∪ {(p14, t1)} with I = {(p0, t1), (p3, t4)} (Sec. 4.3.2.2.3)", () => {
    const n = fig412();
    expect(normal(n)).toEqual([...S1(), ...S3("p2", "p6"), ...S4("p2", "p1")].sort());
    expect(inhibitors(n)).toEqual(["p0-ot1", "p14-ot1", "p3-ot4", "p3-ot9"]);
    expect(places(n)).not.toContain("p12");
    expect(places(n)).not.toContain("p13");
    expect(isCompositeStepNet(n).ok).toBe(true);
    noErrors(n);
    noOverlaps(n);
  });
});

describe("class checks give reasons", () => {
  it("a missing colour-sensitive inhibitor arc is reported (Def. 8)", () => {
    const n = fig49();
    n.arcs = n.arcs.filter((a) => !(a.kind === "inhibitor" && nm(n, a.target) === "t9"));
    const r = isCompositeStepNet(n);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Missing colour-sensitive inhibitor arc from p3 to t9/);
  });

  it("an extra inhibitor arc is reported", () => {
    const n = fig49();
    n.arcs.push({ id: "x", source: "p14", target: "t1", kind: "inhibitor", inscription: "x" });
    expect(isCompositeStepNet(n).reason).toMatch(/not produced by any composition/);
  });

  it("an unmarked database place is reported (Def. 6)", () => {
    const n = fig49();
    n.places.find((p) => p.name === "p16")!.marking = "";
    expect(isCompositeStepNet(n).reason).toMatch(/Database place p16/);
  });

  it("a net without a root net is not composite (Def. 13)", () => {
    expect(isCompositeStepNet(fig48N4()).reason).toMatch(/root net/);
  });
});
