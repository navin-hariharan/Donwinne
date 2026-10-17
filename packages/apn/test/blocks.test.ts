// Building blocks of Konios (2015), Sec. 4.1-4.2: generators and the behaviour of the control system.
import { describe, expect, it } from "vitest";
import { Net, compile, enabledBindings, fire, initialMarking, markingKey } from "@pns/core";
import { BW, basicStepNet, oneStepNet, rootNet, unidirectionalStep } from "../src/blocks";
import { forwardCompose, isBasicStepNet, isOneStepNet, isRootNet } from "../src/compose";
import { fig41, fig43N } from "../src/model-figures";
import { analyseApn, gluingFlag } from "../src/model-structure";

const byName = (net: Net, name: string) => net.places.find((p) => p.name === name)?.id ?? net.transitions.find((t) => t.name === name)!.id;
const nm = (net: Net, id: string) => net.places.find((p) => p.id === id)?.name ?? net.transitions.find((t) => t.id === id)?.name ?? id;
const pre = (net: Net, t: string) => net.arcs.filter((a) => a.kind === "normal" && a.target === byName(net, t)).map((a) => nm(net, a.source)).sort();
const post = (net: Net, t: string) => net.arcs.filter((a) => a.kind === "normal" && a.source === byName(net, t)).map((a) => nm(net, a.target)).sort();

/** The modes in which transition `t` is enabled at marking M. */
function modes(net: Net, t: string, set?: Record<string, string>): string[] {
  const n: Net = { ...net, places: net.places.map((p) => (set && p.name in set ? { ...p, marking: set[p.name] } : set ? { ...p, marking: "" } : p)) };
  const cn = compile(n);
  const i = cn.transitions.findIndex((x) => x.name === t);
  return enabledBindings(cn, i, initialMarking(cn)).bindings.map((b) => String(b.x)).sort();
}

describe("unidirectional step (Fig. 4.1)", () => {
  it("Fig. 4.1: two places and one transition, P_ST = {p1, p2}, T_ST = {t1} (Sec. 4.1.1)", () => {
    const n = fig41();
    expect(n.netClass).toBe("apn");
    expect(n.places.map((p) => p.name)).toEqual(["p1", "p2"]);
    expect(pre(n, "t1")).toEqual(["p1"]);
    expect(post(n, "t1")).toEqual(["p2"]);
    expect(n.places[0].marking).toBe("b");
  });

  it("Sec. 4.1.1: an action permitted in one direction only: the previous state cannot be retrieved", () => {
    const n = fig41();
    const cn = compile(n);
    const m1 = fire(cn, 0, { x: "b" }, initialMarking(cn));
    expect(enabledBindings(cn, 0, m1).bindings).toEqual([]);
    expect(markingKey(m1)).not.toBe(markingKey(initialMarking(cn)));
  });

  it("uses names and users given as parameters", () => {
    const n = unidirectionalStep({ start: "door", finish: "hall", step: "walk_in", users: ["w"] });
    expect(n.transitions[0].name).toBe("walk_in");
    expect(n.places.map((p) => p.name)).toEqual(["door", "hall"]);
  });
});

describe("basic step net (Def. 6, Fig. 4.5)", () => {
  it("Def. 6: Pre/Post of t_em, t_r and t_s; I_S = ∅; G_S = {p_s}; only database places marked", () => {
    const n = basicStepNet({
      start: "ps",
      finish: "pf",
      step: "ts",
      control: "pc",
      decisions: [
        { users: ["b"], database: "pd1", emptying: "tem1", response: "pr1", retrieve: "tr1" },
        { users: ["w"], database: "pd2", emptying: "tem2", response: "pr2", retrieve: "tr2" },
      ],
    });
    expect(pre(n, "ts")).toEqual(["ps"]);
    expect(post(n, "ts")).toEqual(["pc", "pf"]);
    for (const i of [1, 2]) {
      expect(pre(n, `tem${i}`)).toEqual(["pc", `pd${i}`]);
      expect(post(n, `tem${i}`)).toEqual([`pr${i}`]);
      expect(pre(n, `tr${i}`)).toEqual([`pr${i}`]);
      expect(post(n, `tr${i}`)).toEqual([`pd${i}`]);
    }
    expect(n.arcs.some((a) => a.kind === "inhibitor")).toBe(false);
    expect(n.places.filter((p) => gluingFlag(p)).map((p) => p.name)).toEqual(["ps"]);
    expect(Object.fromEntries(n.places.filter((p) => p.marking).map((p) => [p.name, p.marking]))).toEqual({ pd1: "b", pd2: "w" });
    expect(isBasicStepNet(n).ok).toBe(true);
  });

  it("Sec. 3.2: every place has capacity 1 per colour and the colour set of the users", () => {
    const n = basicStepNet();
    expect(n.places.every((p) => p.capacity === 1 && p.colourSet === "BW")).toBe(true);
    expect(n.declarations.colourSets).toContainEqual(BW);
    expect(compile(n).problems.filter((p) => p.severity === "error")).toEqual([]);
  });

  it("defaults to one decision point per colour and to Konios's Snoopy names (ctrl_, db_, Tem_, Tr_)", () => {
    const n = basicStepNet({ start: "p1", finish: "A1" });
    expect(n.places.map((p) => p.name).sort()).toEqual(["A1", "advice_A1_1", "advice_A1_2", "ctrl_A1", "db_A1_1", "db_A1_2", "p1"].sort());
    expect(n.transitions.map((t) => t.name).sort()).toEqual(["Tem_A1_1", "Tem_A1_2", "Tr_A1_1", "Tr_A1_2", "p1toA1"].sort());
  });

  it("Def. 6 needs n ≥ 1 decision points and marked database places", () => {
    expect(() => basicStepNet({ decisions: [] })).toThrow(/n ≥ 1/);
    expect(() => basicStepNet({ decisions: [{ users: [] }] })).toThrow(/at least one user/);
  });

  it("takes any colour set, e.g. user identities 1 and 2 (Sec. 4.5)", () => {
    const n = basicStepNet({ colourSet: { name: "User", type: "int", min: 1, max: 2 } });
    expect(n.places.filter((p) => p.marking).map((p) => p.marking)).toEqual(["1", "2"]);
    expect(compile(n).problems.filter((p) => p.severity === "error")).toEqual([]);
  });

  it("is drawn as in Fig. 4.5: p_f above t_s above p_s, the control place left of p_f, rows below it", () => {
    const n = basicStepNet({ start: "ps", finish: "pf", step: "ts", control: "pc" });
    const at = (name: string) => [...n.places, ...n.transitions].find((x) => x.name === name)!;
    expect(at("pf").y).toBeLessThan(at("ts").y);
    expect(at("ts").y).toBeLessThan(at("ps").y);
    expect(at("pc").x).toBeLessThan(at("pf").x);
    expect(at("pc").y).toBe(at("pf").y);
    const s = analyseApn(n).steps[0];
    for (const d of s.decisions) {
      const [pr, tem, pd] = [d.response, d.emptying, d.database].map((id) => [...n.places, ...n.transitions].find((x) => x.id === id)!);
      expect(pr.y).toBe(tem.y);
      expect(tem.y).toBe(pd.y);
      expect(pr.x).toBeLessThan(tem.x);
      expect(tem.x).toBeLessThan(pd.x);
    }
  });
});

describe("root net (Def. 7, Fig. 4.6) and one step net (Def. 11)", () => {
  it("Def. 7: P_Rt = {p, p_c}, T_Rt = ∅, G_Rt = {p}", () => {
    const r = rootNet({ users: ["b", "w"] });
    expect(r.places.map((p) => p.name)).toEqual(["p", "ctrl_p"]);
    expect(r.transitions).toEqual([]);
    expect(r.places.filter((p) => gluingFlag(p)).map((p) => p.name)).toEqual(["p"]);
    expect(isRootNet(r).ok).toBe(true);
  });

  it("Def. 11: G_S = {p_s, p_f}", () => {
    const o = oneStepNet();
    expect(o.places.filter((p) => gluingFlag(p)).map((p) => p.name).sort()).toEqual(["pf", "ps"]);
    expect(isOneStepNet(o).ok).toBe(true);
  });

  it("isRootNet gives a reason for nets that are not root nets", () => {
    expect(isRootNet(basicStepNet())).toMatchObject({ ok: false, reason: expect.stringMatching(/Def\. 7/) });
  });
});

describe("control system behaviour (Sec. 4.1.1-4.1.2, Figs 4.3 and 4.4)", () => {
  it("Fig. 4.3: firing t1 for the black token puts b into p2 and into the control place p3 (Sec. 4.1.1)", () => {
    const n = fig43N();
    const cn = compile(n);
    const m1 = fire(cn, cn.transitions.findIndex((t) => t.name === "t1"), { x: "b" }, initialMarking(cn));
    const at = (name: string) => m1[cn.places.find((p) => p.name === name)!.slot].toString();
    expect(at("p2")).toBe("b");
    expect(at("p3")).toBe("b");
    expect(at("p1")).toBe("w");
  });

  it("Sec. 4.1.1: p3 'controls' p2: t4 cannot fire for b while b is in p3, and t2 removes it", () => {
    const n = fig43N();
    const cn = compile(n);
    const t = (name: string) => cn.transitions.findIndex((x) => x.name === name);
    let M = fire(cn, t("t1"), { x: "b" }, initialMarking(cn));
    expect(enabledBindings(cn, t("t4"), M).bindings).toEqual([]);
    M = fire(cn, t("t2"), { x: "b" }, M);
    expect(enabledBindings(cn, t("t4"), M).bindings).toEqual([{ x: "b" }]);
  });

  it("Fig. 4.4: t4 can fire in the white mode but not the black one, blocked by the black token in p3", () => {
    expect(modes(fig43N(), "t4", { p2: "b ++ w", p3: "b", p4: "b", p5: "w" })).toEqual(["w"]);
  });

  it("Sec. 4.1.2: an emptying transition needs tokens of the same colour in the control and the database place (context-awareness)", () => {
    // Fig. 4.2(b): a black user in p7 can only be answered through p9 (t7), a white one through p8 (t5).
    const n = fig43N();
    expect(modes(n, "t7", { p7: "b ++ w", p8: "w", p9: "b" })).toEqual(["b"]);
    expect(modes(n, "t5", { p7: "b ++ w", p8: "w", p9: "b" })).toEqual(["w"]);
    expect(modes(n, "t5", { p7: "b", p8: "w", p9: "b" })).toEqual([]);
  });

  it("Sec. 4.1.2: a retrieve transition refills the database place for a later repetition", () => {
    const n = fig43N();
    expect(modes(n, "t3", { p5: "b", p4: "w" })).toEqual(["b"]);
  });

  it("Fig. 4.6(b): a user in the root control place is stopped from proceeding (Sec. 4.2.2)", () => {
    const r = rootNet({ place: "p1", control: "p0", users: ["b", "w"], blocked: ["b"] });
    const n = forwardCompose(r, "p1", basicStepNet({ start: "q", finish: "p2", step: "t1", control: "p3" }));
    expect(modes(n, "t1")).toEqual(["w"]);
  });
});
