// The framework pipeline of Konios et al. (HCII 2023), Fig. 1: APN → T-APN → unfolding → slice.

import { describe, expect, it } from "vitest";
import { ambientGarage, fig410, thesisFig3_1 } from "@pns/apn";
import { criterionFromCtl } from "@pns/analysis";
import { emptyNet, type Net } from "@pns/core";
import { CHAPTER_PROPERTIES, maximalStepsUnsupported, runFramework, slicePreserves } from "../src/framework";

describe("framework pipeline", () => {
  it("runs the chapter's Fig. 7 net through every stage (Figs 10-12)", () => {
    const r = runFramework(fig410(), { formulas: CHAPTER_PROPERTIES });
    expect(r.stages.map((s) => s.id)).toEqual(["apn", "tapn", "unfolded", "sliced"]);
    expect(r.equivalence).toBe("equivalent");
    expect([...r.criterion].sort()).toEqual(["p1[b]", "p2[b]", "p3[b]", "p3[b_bar]", "p3[w]", "p3[w_bar]"]);
    const unfolded = r.stages[2];
    const sliced = r.stages[3];
    expect(unfolded.sizes.single).toMatchObject({ states: 256, complete: true });
    expect((sliced.sizes.single as { states: number }).states).toBeLessThan(256);
    // Stubborn sets never need more states than the full interleaving graph.
    for (const st of r.stages.slice(2)) {
      const a = st.sizes.single as { states: number };
      const b = st.sizes.singleStubborn as { states: number };
      expect(b.states).toBeLessThanOrEqual(a.states);
    }
    expect(r.verdicts.map((v) => [v.full, v.slice, v.agree])).toEqual([
      ["true", "true", true],
      ["true", "true", true],
    ]);
    // Fig. 1's decision: both properties hold, so the flow ends at "yes".
    expect(r.fulfilled).toBe("yes");
    expect(r.verdicts.map((v) => [v.fulfilled, v.decidedBy])).toEqual([
      ["yes", "whole net"],
      ["yes", "whole net"],
    ]);
    // φ2 is an EF property: its witness is a firing sequence of the model.
    const w = r.verdicts[1].trace!;
    expect(w).toMatchObject({ kind: "witness", on: "model" });
    expect(w.last["p3[b]"] > 0 && w.last["p3[w]"] > 0 || w.last["p3[b_bar]"] > 0 && w.last["p3[w_bar]"] > 0).toBe(true);
  });

  it("answers no with a counterexample of the model, named as in the APN (the figure's loop back to modelling)", () => {
    const r = runFramework(fig410(), { formulas: ["AG(p3[b] == 0)", ...CHAPTER_PROPERTIES] });
    expect(r.fulfilled).toBe("no");
    const v = r.verdicts[0];
    expect(v).toMatchObject({ fulfilled: "no", decidedBy: "whole net" });
    expect(v.trace).toMatchObject({ kind: "counterexample", on: "model" });
    expect(v.trace!.steps.length).toBeGreaterThan(0);
    // The T-APN's transitions keep the APN's names, so the trace replays on the APN.
    const apnNames = new Set(fig410().transitions.map((t) => t.name));
    for (const st of v.trace!.steps) for (const t of st.transitions) expect(apnNames.has(t.baseName ?? t.name)).toBe(true);
    expect(v.trace!.last["p3[b]"]).toBeGreaterThan(0);
  });

  it("lets the slice decide when the whole net is too big, if the slicing preserves the property", () => {
    // AG EF is not a safety property, so no stubborn-set fallback; abstract slicing keeps CTL*-X.
    const r = runFramework(ambientGarage(), { formulas: ["AG(EF(exit[1] == 0))"], maxStates: 200, spaces: ["single"], equivalence: false });
    const v = r.verdicts[0];
    expect(v.full).toBe("unknown");
    expect(v).toMatchObject({ slice: "false", fulfilled: "no", decidedBy: "slice" });
    // The slice's counterexample names the transitions of the opened slice.
    const sliced = r.stages.at(-1)!.net;
    const ids = new Set(sliced.transitions.map((t) => t.id));
    expect(v.trace).toMatchObject({ kind: "counterexample", on: "slice" });
    for (const st of v.trace!.steps) expect(ids.has(st.transitions[0].elementIds[0])).toBe(true);
    expect(r.fulfilled).toBe("no");
    // Backward slicing does not preserve CTL, so the same run stays undecided.
    const b = runFramework(ambientGarage(), { formulas: ["AG(EF(exit[1] == 0))"], algorithm: "backward", maxStates: 200, spaces: ["single"], equivalence: false });
    expect(b.verdicts[0]).toMatchObject({ fulfilled: "unknown", decidedBy: "-" });
    expect(b.fulfilled).toBe("unknown");
  });

  it("checks the properties under maximal steps too (Sec. 6, Fig. 12)", () => {
    const r = runFramework(fig410(), { formulas: ["AG(p3[b] == 0)", ...CHAPTER_PROPERTIES], semantics: "maximal" });
    expect(r.semantics).toBe("maximal");
    // The CRG of maximal steps of φ(N) has 5 states (Fig. 12), as the stage table says.
    expect(r.verdicts.map((v) => [v.fulfilled, v.fullStates])).toEqual([
      ["no", 5],
      ["yes", 5],
      ["yes", 5],
    ]);
    // Both users move at once: the counterexample is one maximal step of two firings, and on an APN it replays as a step.
    const t = r.verdicts[0].trace!;
    expect(t.steps).toHaveLength(1);
    expect(t.steps[0].transitions).toHaveLength(2);
    expect(t.replayable).toBe(true);
  });

  it("never lets a slice decide under maximal steps", () => {
    const r = runFramework(ambientGarage(), { formulas: ["AG(EF(exit[1] == 0))"], semantics: "maximal", maxStates: 40, spaces: ["single"], equivalence: false });
    const v = r.verdicts[0];
    expect(v.full).toBe("unknown");
    expect(v).toMatchObject({ fulfilled: "unknown", decidedBy: "-" });
    expect(v.notes.join(" ")).toMatch(/maximal/);
  });

  it("knows which properties each slicing algorithm preserves", () => {
    const c = (f: string) => criterionFromCtl(f);
    expect(slicePreserves("abstract", c("AG(EF(p > 0))"))).toBe(true);
    expect(slicePreserves("abstract", c("AG(EX(p > 0))"))).toBe(false);
    expect(slicePreserves("abstract", c("AG(!deadlock)"))).toBe(false);
    expect(slicePreserves("safety", c("AG(p > 0)"))).toBe(true);
    expect(slicePreserves("safety", c("AG(EF(p > 0))"))).toBe(false);
    expect(slicePreserves("apnSlicing", c("EF(p > 0)"))).toBe(true);
    expect(slicePreserves("backward", c("AG(p > 0)"))).toBe(false);
    expect(slicePreserves("safety", c("AF(p > 0)"))).toBe(false);
    expect(slicePreserves("abstract", c("AG(p > 0)"), "maximal")).toBe(false);
    // Without fairness a slice keeps only AG/EF verdicts: AF, EG, AU and EU can change.
    for (const alg of ["abstract", "basic", "ctlStarX", "apnSlicing"] as const) {
      expect(slicePreserves(alg, c("AF(p > 0)")), alg).toBe(false);
      expect(slicePreserves(alg, c("EF(AG(p > 0))")), alg).toBe(true);
    }
  });

  it("a slice never decides AF: the dropped part of the net can run forever (regression)", () => {
    // a → t → c, and an independent loop x ⇄ y. AF(c > 0) is false on the net (the loop can run
    // forever without t) but true on the slice for {c}, which drops the loop.
    const n = emptyNet("pt", "fair") as Net;
    for (const [id, m] of [["a", "1"], ["c", ""], ["x", "1"], ["y", ""]]) n.places.push({ id, name: id, x: 0, y: 0, marking: m });
    for (const id of ["t", "u", "v"]) n.transitions.push({ id, name: id, x: 0, y: 0 });
    [["a", "t"], ["t", "c"], ["x", "u"], ["u", "y"], ["y", "v"], ["v", "x"]].forEach(([s, t], i) => n.arcs.push({ id: `a${i}`, source: s, target: t, kind: "normal", inscription: "1" }));
    const r = runFramework(n, { formulas: ["AF(c > 0)"], algorithm: "abstract", maxStates: 1000, spaces: ["single"], equivalence: false });
    const v = r.verdicts[0];
    expect(v.full).toBe("false");
    expect(v.fulfilled).toBe("no");
    expect(v.decidedBy).not.toBe("slice");
  });

  it("falls back to stubborn sets for AG/EF properties when the whole graph is too big", () => {
    // A holding AG property needs every state; the cut-off full graph leaves it unknown.
    const r = runFramework(ambientGarage(), { formulas: ["AG(exit[1] <= 1)"], maxStates: 20000, spaces: ["single"], equivalence: false });
    const v = r.verdicts[0];
    expect(v.fullBy).toBe("stubborn sets");
    expect(v.full).toBe(v.slice);
    expect(v.agree).toBe(true);
    expect(v).toMatchObject({ full: "true", fulfilled: "yes", decidedBy: "whole net" });
    // A violated EF/AG shows up on the explored part already: no reduction needed, and the shortest path is kept.
    const e = runFramework(ambientGarage(), { formulas: ["AG(exit[1] == 0)"], maxStates: 20000, spaces: ["single"], equivalence: false }).verdicts[0];
    expect(e).toMatchObject({ full: "false", fullBy: "full graph", fulfilled: "no" });
    expect(r.stages.at(-1)!.places).toBeLessThan(r.stages[2].places);
  }, 30_000); // about 4 s alone; slower when the whole suite runs in parallel

  it("goes on with the APN itself when it is not a composite step net (Fig. 3.1)", () => {
    const r = runFramework(thesisFig3_1(), { formulas: ["EF(p3[b] > 0)", "AG(p3[w] == 0)"] });
    expect(r.stages.map((s) => s.id)).toEqual(["apn", "tapn", "unfolded", "sliced"]);
    expect(r.equivalence).toBeUndefined();
    expect(r.notes.join(" ")).toMatch(/not one/);
    // t fires in black mode only: the white token on p5 inhibits the white mode.
    expect(r.verdicts.map((v) => [v.full, v.slice])).toEqual([
      ["true", "true"],
      ["true", "true"],
    ]);
  });

  it("reports unknown names", () => {
    expect(() => runFramework(fig410(), { formulas: ["AG(nope > 0)"] })).toThrow(/nope/);
  });

  it("refuses maximal steps up front for a net with a reset arc, naming the arc and why", () => {
    const net = emptyNet("xpt", "reset") as Net;
    net.places = [{ id: "p", name: "p", x: 0, y: 0, marking: "2" }, { id: "q", name: "q", x: 0, y: 0, marking: "" }];
    net.transitions = [{ id: "t", name: "t", x: 0, y: 0 }, { id: "u", name: "u", x: 0, y: 0 }];
    net.arcs = [
      { id: "a0", source: "p", target: "t", inscription: "1", kind: "normal" },
      { id: "a1", source: "t", target: "q", inscription: "1", kind: "normal" },
      { id: "a2", source: "p", target: "u", inscription: "1", kind: "reset" },
    ];
    expect(maximalStepsUnsupported(net)).toMatch(/p → u is a reset arc/);
    expect(() => runFramework(net, { formulas: ["EF(q > 0)"], semantics: "maximal" })).toThrow(/reset arc.*single steps instead/);
    // Single steps are fine.
    expect(runFramework(net, { formulas: ["EF(q > 0)"] }).fulfilled).toBe("yes");
    expect(maximalStepsUnsupported(fig410())).toBeNull();
  });
});
