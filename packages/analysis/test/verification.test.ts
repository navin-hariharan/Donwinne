// Property templates, DCF and the other qualitative additions, path queries and fault tolerance.
import { describe, expect, it } from "vitest";
import {
  PROPERTY_TEMPLATES,
  TemplateError,
  analyseNet,
  buildTransitionSystem,
  checkCtl,
  compareAdvicePaths,
  faultTolerance,
  findPaths,
  formatCtl,
  injectFaults,
  instantiateTemplate,
  parseCtl,
  colourBlindProjection,
  deadStates,
  labelText,
  stepSystem,
  toPTNet,
} from "@pns/analysis";
import { colouredPhilosophers, liveFreeChoice, mk, mutex, philosophers, producerConsumer } from "./nets";

describe("property templates", () => {
  it("covers every ambient and general property of §7.1 and the fault-tolerance ones of §7.3.3", () => {
    const sections = PROPERTY_TEMPLATES.map((t) => t.section);
    for (const s of ["7.1.1.1.1", "7.1.1.1.2", "7.1.1.2.1", "7.1.1.2.2", "7.1.1.3.1", "7.1.1.3.2", "7.1.1.3.3", "7.1.1.3.4", "7.1.2.1.1", "7.1.2.1.2", "7.1.2.2.1", "7.1.2.2.2", "7.1.2.2.3", "7.1.2.2.4", "7.1.2.2.5", "7.1.2.2.6", "7.1.2.2.7", "7.3.3"])
      expect(sections).toContain(s);
    expect(new Set(PROPERTY_TEMPLATES.map((t) => t.id)).size).toBe(PROPERTY_TEMPLATES.length);
    for (const t of PROPERTY_TEMPLATES) {
      expect(t.summary.length).toBeGreaterThan(10);
      expect(t.summary).not.toMatch(/\n/);
    }
  });

  it("turns every example into well-formed formulas", () => {
    for (const t of PROPERTY_TEMPLATES) {
      const fs = instantiateTemplate(t.id, t.example);
      expect(fs.length).toBeGreaterThan(0);
      for (const f of fs) expect(() => parseCtl(f.text), `${t.id}: ${f.text}`).not.toThrow();
    }
  });

  it("reproduces the thesis's formulas", () => {
    const one = (id: string) => instantiateTemplate(id, PROPERTY_TEMPLATES.find((t) => t.id === id)!.example);
    const same = (id: string, thesis: string, i = 0) => expect(formatCtl(parseCtl(one(id)[i].text))).toBe(formatCtl(parseCtl(thesis)));
    same("sensorOverlap", "AG((p1==2 & ctrl_p1==2) -> ! (p2==2 & ctrl_p2==2));");
    same("adviceRedundancy", "EF(Back_p1_2)&EF(Left_p1_1) & EF(Right_p1_1)&EF(Forward_p1_2)& EF(Park_A1_1)&EF(Park_A2_2) & EF(Bye_exit_12);");
    same("returnToPrevious", "AG((p1 -> EX(A1))&(A1 ->EX(p1)))& AG((p1 -> EX(p2))&(p2 ->EX(p1)))& AG((p2 -> EX(A2))&(A2 ->EX(p2)));");
    same("resourceUpperBound", "AG(!(entrance>2)&!(exit>2) & !(p1>2)&!(p2>2) & !(A1>2)&!(A2>2));");
    same("reachGoal", "EF(A1&Park_A1_1)&EF(A2&Park_A2_2);");
    same("interactWithUsers", "AF(EF((A2&Back_A2_1)&(p1&Forward_p1_2)));");
    same("restrictUser", "AG((entrance -> p1) -> AX( (p1>0 & ctrl_p1_1==0 & ctrl_p1_2==0)  -> (Left_p1_1 |Forward_p1_2)));", 0);
    same("restrictUser", "AG((entrance -> p1) -> AX( p1 -> p2));", 1);
    same("goalAfterWrongAdvice", "AG(p2 == 2 & Back_p2_1 == 2 -> EF(exit & Bye_exit_12));");
    same("correctAfterWrongAdvice", "AG(p2 == 2 & Back_p2_1 == 2 -> EF(p2 == 2 & Back_p2_1 == 1 & Right_p2_2));");
    same("improperActions", "AG(A1&Back_A1_2 -> !(EX(p1&ctrl_p1_1)))& AG(A2&Back_A2_1 -> !(EX(p2&ctrl_p2_1)));");
    same("goalAfterIgnoring", "AG((p1>0 & Left_p1_1>0 -> EX(p2)) & (p2>0 & Back_p2_1 -> EF(A1)) | (p1>0 & Forward_p1_2>0 -> EX(A1)) & (A1>0 & Back_A1_2 -> EF(A2)));");
    expect(one("restrictUser").map((f) => f.expected)).toEqual([true, false]);
    expect(one("improperActions")[0].expected).toBe(false);
  });

  it("explains missing or malformed arguments", () => {
    expect(() => instantiateTemplate("sensorOverlap", { locationA: "p1" })).toThrow(TemplateError);
    expect(() => instantiateTemplate("sensorOverlap", { locationA: "p1" })).toThrow("First sensor is required.");
    expect(() => instantiateTemplate("noLeak", { rules: [{ database: "d" }] })).toThrow("Advices, row 1: Advice is required.");
    expect(() => instantiateTemplate("resourceUpperBound", { places: ["p"], max: -1 })).toThrow("whole number");
    expect(() => instantiateTemplate("nope", {})).toThrow("Unknown property template");
  });

  it("uses coloured place references and quotes odd names", () => {
    const [f] = instantiateTemplate("adviceRedundancy", { advices: ["eat[a]", "A", "two words"] });
    expect(f.text).toBe('EF(eat[a]) & EF("A") & EF("two words")');
    const ts = buildTransitionSystem(colouredPhilosophers());
    const [g] = instantiateTemplate("resourceUpperBound", { places: ["eat", "fork[a]"], max: 1 });
    expect(checkCtl(ts, g.text).status).toBe("true");
  });
});

describe("qualitative analysis additions (§7.2)", () => {
  const item = (net: Parameters<typeof analyseNet>[0], key: string) => analyseNet(net).summary.find((s) => s.key === key)!;

  it("reports dynamic conflicts with a witness", () => {
    const r = analyseNet(mutex());
    expect(r.behaviour.dynamicConflictFree).toBe("no");
    expect(r.behaviour.dynamicConflict?.transitions.map((t) => t.name).sort()).toEqual(["enter1", "enter2"]);
    expect(r.behaviour.dynamicConflict?.path).toEqual([]);
    const s = item(mutex(), "dynamicConflictFree");
    expect(s.abbreviation).toBe("DCF");
    expect(s.explanation).toContain("firing enter1 disables enter2");
  });

  it("finds conflict freedom where firing never disables another transition", () => {
    // Marked graph: no shared input places.
    const ring = mk("pt", [["a", "1"], ["b", ""], ["c", "1"], ["d", ""]], [["t1"], ["t2"], ["t3"], ["t4"]], [["a", "t1"], ["t1", "b"], ["b", "t2"], ["t2", "a"], ["c", "t3"], ["t3", "d"], ["d", "t4"], ["t4", "c"]]);
    expect(analyseNet(ring).behaviour.dynamicConflictFree).toBe("yes");
    // A shared input place with enough tokens for both is not a dynamic conflict.
    const plenty = mk("pt", [["p", "2"], ["q", ""], ["r", ""]], [["t"], ["u"]], [["p", "t"], ["t", "q"], ["p", "u"], ["u", "r"]]);
    const r = analyseNet(plenty);
    expect(r.structure.staticConflictFree.holds).toBe(false);
    expect(r.behaviour.dynamicConflictFree).toBe("no"); // with one token left after t, u is still enabled; after t and u … t again: at p=1 both enabled and conflict
    const once = mk("pt", [["p", "2"], ["q", ""], ["r", ""]], [["t"], ["u"]], [["p", "t", "1"], ["t", "q"], ["q", "u", "1"], ["u", "r"]]);
    expect(analyseNet(once).behaviour.dynamicConflictFree).toBe("yes");
  });

  it("detects conflicts caused by inhibitor arcs", () => {
    // t puts a token on q, which inhibits u.
    const net = mk("xpt", [["p", "1"], ["q", ""], ["s", "1"], ["r", ""]], [["t"], ["u"]], [["p", "t"], ["t", "q"], ["s", "u"], ["q", "u", "1", "inhibitor"], ["u", "r"]]);
    const b = analyseNet(net).behaviour;
    expect(b.dynamicConflictFree).toBe("no");
    expect(b.dynamicConflict?.transitions.map((t) => t.name)).toEqual(["t", "u"]);
  });

  it("labels k-B, DSt, DTr and the structural properties with the thesis's abbreviations", () => {
    const r = analyseNet(philosophers(3, true));
    const abbr = Object.fromEntries(r.summary.filter((s) => s.abbreviation).map((s) => [s.abbreviation, s]));
    for (const a of ["FT0", "TF0", "FP0", "PF0", "k-B", "DCF", "DSt", "DTr", "PUR", "SCF", "CPI", "DTP"]) expect(abbr[a], a).toBeDefined();
    expect(abbr["k-B"].status).toBe("yes");
    expect(abbr["k-B"].explanation).toContain("1-bounded");
    expect(abbr["DSt"].status).toBe("yes");
    expect(abbr["DSt"].explanation).toMatch(/^Yes: 1 dead state; the first is reached by takeL\d/);
    expect(abbr["DTr"].status).toBe("no");
    expect(item(producerConsumer(), "deadStates").status).toBe("no");
    expect(item(liveFreeChoice(), "kBounded").explanation).toContain("1-bounded");
  });

  it("does not call a place isolated when only inhibitor arcs touch it", () => {
    const net = mk("xpt", [["p", "1"], ["q", ""], ["lonely", ""]], [["t"]], [["p", "t"], ["q", "t", "1", "inhibitor"]]);
    expect(analyseNet(net).structure.isolatedNodes.witnesses.map((n) => n.name)).toEqual(["lonely"]);
  });

  it("keeps the existing summary keys", () => {
    const keys = analyseNet(mutex()).summary.map((s) => s.key);
    for (const k of ["bounded", "safe", "deadlockFree", "live", "deadTransitions", "reversible", "homeStates", "cpi", "cti", "inputTransitions", "siphonTrap"]) expect(keys).toContain(k);
  });
});

describe("path analysis (§7.3.2)", () => {
  // A tiny "garage": the user at p1 is advised left (to A1); going forward to p2 ignores the advice.
  const garage = () =>
    mk(
      "pt",
      [["entrance", "1"], ["p1", ""], ["c1", ""], ["Left", ""], ["p2", ""], ["c2", ""], ["Back", ""], ["A1", ""], ["Park", ""]],
      [["enter"], ["adviseLeft"], ["toA1"], ["toP2"], ["adviseBack"], ["back"], ["parkA1"]],
      [
        ["entrance", "enter"], ["enter", "p1"], ["enter", "c1"],
        ["c1", "adviseLeft"], ["adviseLeft", "Left"],
        ["p1", "toA1"], ["Left", "toA1"], ["toA1", "A1"],
        ["p1", "toP2"], ["Left", "toP2"], ["toP2", "p2"], ["toP2", "c2"],
        ["c2", "adviseBack"], ["adviseBack", "Back"],
        ["p2", "back"], ["Back", "back"], ["back", "p1"], ["back", "c1"],
        ["A1", "parkA1"], ["parkA1", "Park"],
      ],
    );

  it("finds the shortest firing sequence to a target written in Charlie's filter syntax", () => {
    const ts = buildTransitionSystem(garage());
    const r = findPaths(ts, { target: "Park * p1 == 0" });
    expect(r.found).toBe(true);
    expect(r.shortestLength).toBe(4);
    expect(r.paths[0].steps.map((s) => s.label)).toEqual(["enter", "adviseLeft", "toA1", "parkA1"]);
    expect(r.paths[0].parikh).toEqual({ enter: 1, adviseLeft: 1, toA1: 1, parkA1: 1 });
    expect(r.paths[0].reenteredPlaces).toEqual([]);
  });

  it("honours required and forbidden transitions", () => {
    const ts = buildTransitionSystem(garage());
    const r = findPaths(ts, { target: "Park", require: ["toP2"] });
    expect(r.paths[0].steps.map((s) => s.label)).toEqual(["enter", "adviseLeft", "toP2", "adviseBack", "back", "adviseLeft", "toA1", "parkA1"]);
    expect(r.paths[0].reenteredPlaces.map((p) => p.place.name)).toContain("p1");
    expect(findPaths(ts, { target: "Park", forbid: ["toA1"] }).found).toBe(false);
    expect(() => findPaths(ts, { target: "Park", forbid: ["toA2"] })).toThrow('Unknown transition "toA2"');
  });

  it("lists every path up to a limit, shortest first", () => {
    // Paths never repeat a state (with the same requirements met), so the loop is taken once at most.
    const ts = buildTransitionSystem(garage());
    expect(findPaths(ts, { target: "Park", mode: "all" }).paths.map((p) => p.length)).toEqual([4]);
    expect(findPaths(ts, { target: "Park", mode: "all", require: ["toP2"] }).paths.map((p) => p.length)).toEqual([8]);
    const m = buildTransitionSystem(liveFreeChoice());
    const all = findPaths(m, { target: "p4 & p5", mode: "all", maxLength: 6 });
    expect(all.paths.map((p) => p.steps.map((s) => s.label).join(" ")).sort()).toEqual(["t1 t2 t4", "t1 t3 t4", "t1 t4 t2", "t1 t4 t3"]);
    expect(all.truncated).toBe(false);
    expect(findPaths(m, { target: "p4 & p5", mode: "all", forbid: ["t3"] }).paths).toHaveLength(2);
    const lim = findPaths(m, { target: "p4 & p5", mode: "all", limit: 3 });
    expect(lim.paths).toHaveLength(3);
    expect(lim.truncated).toBe(true);
  });

  it("compares following and ignoring advices", () => {
    const ts = buildTransitionSystem(garage());
    const c = compareAdvicePaths(ts, { goal: "Park", ignoring: ["toP2"] });
    expect(c.following.shortestLength).toBe(4);
    expect(c.ignoring.shortestLength).toBe(8);
    expect(c.extraFirings).toBe(4);
    expect(c.ignoringLoops).toBe(true);
    expect(c.summary[2]).toContain("4 extra firings");
  });

  it("says whether a path found on a truncated state space is surely shortest", () => {
    const full = buildTransitionSystem(philosophers(8));
    const cut = buildTransitionSystem(philosophers(8), { maxStates: 40 });
    expect(full.complete).toBe(true);
    expect(cut.complete).toBe(false);
    expect(findPaths(full, { target: "eat0" }).conclusive).toBe(true);
    const near = findPaths(cut, { target: "eat0" });
    expect(near).toMatchObject({ found: true, conclusive: true, shortestLength: findPaths(full, { target: "eat0" }).shortestLength });
    // Every philosopher eating at once is impossible, but the cut-off graph cannot show it.
    const none = findPaths(cut, { target: "eat0 & eat1" });
    expect(none).toMatchObject({ found: false, conclusive: false });
    expect(findPaths(full, { target: "eat0 & eat1" })).toMatchObject({ found: false, conclusive: true });
  });

  it("works on coloured nets with base names standing for every binding", () => {
    const ts = buildTransitionSystem(colouredPhilosophers());
    const r = findPaths(ts, { target: "think == 3", require: ["take"] });
    expect(r.shortestLength).toBe(2);
    expect(r.paths[0].steps[0].transitions[0].baseName).toBe("take");
  });
});

describe("fault tolerance (§7.3.3)", () => {
  // The sensor at p1 normally advises Left (db_left holds the information). An extra token on
  // db_right makes it advise Right as well: the wrong advice.
  const net = () =>
    mk(
      "pt",
      [["p1", "1"], ["c", "1"], ["db_left", "1"], ["db_right", ""], ["Left", ""], ["Right", ""], ["A1", ""], ["A2", ""], ["Park", ""]],
      [["adviseLeft"], ["adviseRight"], ["goLeft"], ["goRight"], ["backFromA2"], ["park"]],
      [
        ["c", "adviseLeft"], ["db_left", "adviseLeft"], ["adviseLeft", "Left"], ["adviseLeft", "db_left"],
        ["c", "adviseRight"], ["db_right", "adviseRight"], ["adviseRight", "Right"],
        ["p1", "goLeft"], ["Left", "goLeft"], ["goLeft", "A1"],
        ["p1", "goRight"], ["Right", "goRight"], ["goRight", "A2"],
        ["A2", "backFromA2"], ["backFromA2", "p1"], ["backFromA2", "c"],
        ["A1", "park"], ["park", "Park"],
      ],
    );

  it("injects faults into the initial marking", () => {
    const pt = injectFaults(toPTNet(net()), [{ place: "db_right", tokens: 1 }]);
    expect(pt.m0[pt.places.findIndex((p) => p.name === "db_right")]).toBe(1);
    expect(() => injectFaults(toPTNet(net()), [{ place: "nope", tokens: 1 }])).toThrow("Unknown place");
    expect(() => injectFaults(toPTNet(net()), [{ place: "p1", tokens: -2 }])).toThrow("would hold -1");
    expect(() => injectFaults(toPTNet(colouredPhilosophers()), [{ place: "fork", tokens: 1 }])).toThrow("name one");
    expect(() => injectFaults(toPTNet(colouredPhilosophers()), [{ place: "fork[a]", tokens: 1 }])).not.toThrow();
  });

  it("reports whether the goal and the correct advice stay reachable after a wrong advice", () => {
    const r = faultTolerance(net(), { faults: [{ place: "db_right", tokens: 1 }], wrongAdvice: "Right > 0", goal: "Park", correctAdvice: "Left > 0" });
    expect(r.wrongAdviceWithoutFault.status).toBe("false");
    expect(r.wrongAdviceWithFault.status).toBe("true");
    expect(r.wrongAdviceWithFault.trace?.steps.map((s) => s.label)).toEqual(["adviseRight"]);
    expect(r.goalAfterWrongAdvice?.status).toBe("true");
    expect(r.correctAfterWrongAdvice?.status).toBe("true");
    expect(r.faults[0]).toMatchObject({ tokens: 1, before: 0, after: 1 });
    expect(r.summary[0]).toContain("without it, never");
    // A fault that strands the user: no way back from A2.
    const stuck = mk("pt", [["p1", "1"], ["db", ""], ["A1", ""], ["A2", ""]], [["left"], ["right"]], [["p1", "left"], ["left", "A1"], ["p1", "right"], ["db", "right"], ["right", "A2"]]);
    expect(buildTransitionSystem(stuck).complete).toBe(true);
    const s = faultTolerance(stuck, { faults: [{ place: "db", tokens: 1 }], wrongAdvice: "A2", goal: "A1" });
    expect(s.goalAfterWrongAdvice?.status).toBe("false");
    expect(s.goalAfterWrongAdvice?.trace?.steps.map((x) => x.label)).toEqual(["right"]);
    expect(s.newDeadMarkings).toHaveLength(2);
    expect(s.newDeadMarkings).toContainEqual({ A2: 1 });
  });
});

describe("colour-blind projection and step graphs", () => {
  it("sums tokens over colours and keeps one transition per coloured transition", () => {
    const net = colouredPhilosophers();
    const { net: cb, notes } = colourBlindProjection(net);
    expect(cb.netClass).toBe("pt");
    expect(cb.transitions.map((t) => t.name).sort()).toEqual(net.transitions.map((t) => t.name).sort());
    const pt = toPTNet(net);
    const total = pt.m0.reduce((a, b) => a + b, 0);
    expect(cb.places.reduce((a, p) => a + Number(p.marking), 0)).toBe(total);
    expect(Array.isArray(notes)).toBe(true);
    // The projection of an uncoloured net is the net itself.
    const m = mutex();
    expect(colourBlindProjection(m).net).toBe(m);
    // Colour-blind interleaving graph through the build option.
    const ts = buildTransitionSystem(net, { projection: "colourBlind" });
    expect(ts.places.every((p) => !p.name.includes("["))).toBe(true);
    expect(ts.notes[0]).toMatch(/Colour-blind projection/);
  });

  it("turns a colour-sensitive inhibitor arc into a plain one", () => {
    const net = mk("coloured", [["p", "1`a ++ 1`b"], ["q", "1`a"], ["r", ""]], [["t"]], [["p", "t", "x"], ["q", "t", "x", "inhibitor"], ["t", "r", "x"]]);
    net.declarations.colourSets.push({ name: "AB", type: "enum", values: ["a", "b"] });
    net.declarations.variables.push({ name: "x", colourSet: "AB" });
    for (const pl of net.places) pl.colourSet = "AB";
    // Coloured: t<x=b> can fire (no b on q). Colour-blind: q is not empty, so t is dead.
    expect(checkCtl(buildTransitionSystem(net), "EF(r > 0)").status).toBe("true");
    const cb = colourBlindProjection(net).net;
    expect(cb.netClass).toBe("xpt");
    expect(cb.arcs.find((a) => a.kind === "inhibitor")?.inscription).toBe("1");
    expect(checkCtl(buildTransitionSystem(net, { projection: "colourBlind" }), "EF(r > 0)").status).toBe("false");
  });

  it("builds maximal-step graphs with auto-concurrency", () => {
    // Two independent transitions and a place with two tokens.
    const net = mk("pt", [["a", "1"], ["b", "1"], ["c", "2"], ["d", ""]], [["s"], ["t"], ["u"]], [["a", "s"], ["b", "t"], ["c", "u"], ["u", "d"]]);
    const pt = toPTNet(net);
    const max = stepSystem(pt);
    expect(max.semantics).toBe("step");
    expect([max.markings.length, max.edgeTo.length]).toEqual([2, 1]);
    expect(labelText(max, max.edgeLabel[0])).toBe("{s, t, 2·u}");
    const noAuto = stepSystem(pt, { autoConcurrency: false });
    expect(noAuto.markings.length).toBe(3);
    const all = stepSystem(pt, { maximalOnly: false });
    expect(all.markings.length).toBe(buildTransitionSystem(net).markings.length);
    expect(deadStates(max)).toEqual([1]);
    expect(checkCtl(buildTransitionSystem(net, { semantics: "maximalSteps" }), "AX(deadlock)").status).toBe("true");
  });

  it("tests inhibitor and read arcs before the step and respects the state limit", () => {
    // t empties p; u is inhibited by p. Tested before the step, u cannot join t.
    const net = mk("xpt", [["p", "1"], ["q", "1"], ["r", ""]], [["t"], ["u"]], [["p", "t"], ["q", "u"], ["p", "u", "1", "inhibitor"], ["u", "r"]]);
    const ts = stepSystem(toPTNet(net));
    expect(ts.edgeTo.length).toBe(2);
    expect(checkCtl(ts, "EF(r > 0)").status).toBe("true");
    const cut = stepSystem(toPTNet(producerConsumer(3)), { maxStates: 2, maximalOnly: false });
    expect(cut.complete).toBe(false);
    expect(checkCtl(cut, "EF(produced)").status).not.toBe("false");
  });
});
