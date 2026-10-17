// The case-study models of Konios (2015), Sec. 4.5: the ambient garage (Figs 4.14-4.15) and the
// ambient conference room (Figs 4.16-4.17), compared with the figures and exercised with the firing rule.
import { describe, expect, it } from "vitest";
import { Net, compile, markingKey } from "@pns/core";
import {
  CASE_COMPOSITIONS,
  ambientConferenceRoom,
  ambientConferenceRoomFragment,
  ambientConferenceRoomFragmentTapn,
  ambientGarage,
  ambientGarageFragment,
  ambientGarageFragmentTapn,
  ambientGarageTapn,
} from "../src/cases";
import { isCompositeStepNet } from "../src/compose";
import { checkEquivalence } from "../src/equivalence";
import { findReachable, isKBounded, isOrdinary, isPure, isStructurallyBounded, reachabilityGraph, StateGraph } from "../src/model-properties";

const nm = (net: Net, id: string) => net.places.find((p) => p.id === id)?.name ?? net.transitions.find((t) => t.id === id)?.name ?? id;
const inhibitorsOf = (net: Net, t: string) =>
  net.arcs.filter((a) => a.kind === "inhibitor" && nm(net, a.target) === t).map((a) => nm(net, a.source)).sort();
const names = (net: Net) => [...net.places, ...net.transitions].map((n) => n.name).sort();

/** Can some reachable marking put the given colour in the given place? */
function reaches(net: Net, g: StateGraph, place: string, colour: number): boolean {
  const slot = compile(net).places.find((p) => p.name === place)!.slot;
  return g.markings.some((M) => M[slot].count(colour) > 0);
}

describe("Ambient garage (Sec. 4.5.1)", () => {
  it("Fig. 4.15: built from a root net by five forward and three backward compositions (Sec. 4.5.1)", () => {
    const n = ambientGarage();
    const c = isCompositeStepNet(n);
    expect(c.ok).toBe(true);
    expect(c.reason).toMatch(/5 forward and 3 backward/);
    expect(CASE_COMPOSITIONS.garage.map((s) => s.kind)).toEqual(["forward", "forward", "backward", "forward", "forward", "backward", "backward", "forward"]);
  });

  it("Fig. 4.15: the step places are the six sensors entrance, p1, p2, A1, A2 and exit, with the root net (entrance, ctrl_entrance)", () => {
    const n = ambientGarage();
    const steps = ["access_granted", "p1toA1", "A1top1", "p1top2", "p2toA2", "A2top2", "p2top1", "Moving_to_exit"];
    expect(n.transitions.filter((t) => steps.includes(t.name)).length).toBe(8);
    for (const p of ["entrance", "ctrl_entrance", "p1", "p2", "A1", "A2", "exit"]) expect(names(n)).toContain(p);
    expect(n.places.find((p) => p.name === "entrance")!.marking).toBe("1 ++ 2");
    expect(n.places.find((p) => p.name === "ctrl_entrance")!.marking).toBe("");
  });

  it("Fig. 4.15: the colour-sensitive inhibitor arcs of each step match the figure", () => {
    const n = ambientGarage();
    expect(inhibitorsOf(n, "access_granted")).toEqual(["ctrl_entrance"]);
    expect(inhibitorsOf(n, "p1toA1")).toEqual(["ctrl_p1", "ctrl_p1_1", "ctrl_p1_2"]);
    expect(inhibitorsOf(n, "A1top1")).toEqual(["ctrl_A1"]);
    expect(inhibitorsOf(n, "p1top2")).toEqual(["ctrl_p1", "ctrl_p1_1", "ctrl_p1_2"]);
    expect(inhibitorsOf(n, "p2toA2")).toEqual(["ctrl_p2", "ctrl_p2_1"]);
    expect(inhibitorsOf(n, "A2top2")).toEqual(["ctrl_A2"]);
    expect(inhibitorsOf(n, "p2top1")).toEqual(["ctrl_p2", "ctrl_p2_1"]);
    expect(inhibitorsOf(n, "Moving_to_exit")).toEqual(["ctrl_p2", "ctrl_p2_1"]);
  });

  it("Fig. 4.14: the fragment has the elements of the figure", () => {
    const n = ambientGarageFragment();
    expect(names(n)).toEqual(
      [
        "entrance", "ctrl_entrance", "access_granted", "p1", "ctrl_p1", "Tem_p1_1", "Tr_p1_1", "Left_p1_1", "db_p1_1", "Tem_p1_2", "Tr_p1_2", "Forward_p1_2", "db_p1_2",
        "p1toA1", "A1", "ctrl_A1", "Tem_A1_1", "Tr_A1_1", "Park_A1_1", "db_A1_1", "Tem_A1_2", "Tr_A1_2", "Back_A1_2", "db_A1_2",
        "A1top1", "ctrl_p1_1", "Tem_p1_1_1", "Tr_p1_1_1", "Back_p1_1", "db_p1_1_1", "Tem_p1_1_2", "Tr_p1_1_2", "Left_p1_2", "db_p1_1_2",
      ].sort(),
    );
    expect(isCompositeStepNet(n).reason).toMatch(/2 forward and 1 backward/);
    expect(inhibitorsOf(n, "p1toA1")).toEqual(["ctrl_p1", "ctrl_p1_1"]);
  });

  it("Sec. 4.5.1: bay A1 is allocated to user 1 and A2 to user 2 (database places)", () => {
    const n = ambientGarage();
    const m = (p: string) => n.places.find((x) => x.name === p)!.marking;
    expect([m("db_A1_1"), m("db_A1_2"), m("db_A2_1"), m("db_A2_2"), m("db_exit_12")]).toEqual(["1", "2", "1", "2", "1 ++ 2"]);
  });

  it("every place and transition says in its comment what it stands for", () => {
    for (const n of [ambientGarage(), ambientConferenceRoom()]) for (const x of [...n.places, ...n.transitions]) expect(x.comment, x.name).toBeTruthy();
  });

  it("is a valid, pure and ordinary APN with capacity 1 (Lemmas 2-3, Sec. 3.2)", () => {
    const n = ambientGarage();
    expect(n.netClass).toBe("apn");
    expect(compile(n).problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(isPure(n).ok).toBe(true);
    expect(isOrdinary(n).ok).toBe(true);
    expect(n.places.every((p) => p.capacity === 1)).toBe(true);
  });

  describe("behaviour", () => {
    const n = ambientGarage();
    const reach = (goal: Record<string, number[]>) => findReachable(n, goal).found;
    // With one car the whole state space is small enough to explore.
    const one = ambientGarage({ users: [1] });
    const g1 = reachabilityGraph(one);

    it("with one car the CRG is explored fully and is 1-bounded per colour (Defs 16-17); every place has capacity 1", () => {
      expect(g1.complete).toBe(true);
      expect(isKBounded(one, 1, g1).ok).toBe(true);
      expect(isStructurallyBounded(n).ok).toBe(true);
    });

    it("Sec. 4.5.1: each car can reach and park at its own bay, and the system confirms it", () => {
      expect(reach({ Park_A1_1: [1] })).toBe(true);
      expect(reach({ Park_A2_2: [2] })).toBe(true);
      expect(reach({ Park_A1_1: [1], Park_A2_2: [2] })).toBe(true);
    });

    it("Sec. 4.5.1: a car at the wrong bay is redirected", () => {
      expect(reach({ Back_A1_2: [2] })).toBe(true);
      expect(reach({ Back_A2_1: [1] })).toBe(true);
    });

    it("Sec. 4.5.1: both cars can leave through the exit, which cannot be used to enter (no step leaves exit)", () => {
      expect(reach({ exit: [1, 2] })).toBe(true);
      const exit = n.places.find((p) => p.name === "exit")!.id;
      expect(n.arcs.some((a) => a.source === exit && a.kind === "normal")).toBe(false);
    });

    it("Sec. 4.1.2: a car cannot move on before the display has given it its advice", () => {
      const cn = compile(one);
      const slot = (p: string) => cn.places.find((x) => x.name === p)!.slot;
      const leaving = new Set(["p1toA1", "p1top2"].map((t) => one.transitions.find((x) => x.name === t)!.id));
      let checked = 0;
      for (const e of g1.edges)
        if (g1.markings[e.from][slot("ctrl_p1")].count(1) > 0 && g1.markings[e.from][slot("p1")].count(1) > 0) {
          checked++;
          expect(e.transitions.some((t) => leaving.has(t))).toBe(false);
        }
      expect(checked).toBeGreaterThan(0);
    });

    it("Sec. 4.5.1: an unauthorised car (its colour in ctrl_entrance) is not let in", () => {
      const blocked = ambientGarage({ blocked: [2] });
      expect(findReachable(blocked, { p1: [2] })).toMatchObject({ found: false, complete: true });
      expect(findReachable(blocked, { p1: [1] }).found).toBe(true);
    });
  });
});

describe("Ambient conference room (Sec. 4.5.2)", () => {
  it("Fig. 4.17: a composite step net whose root is (participants, ctrl_participants)", () => {
    const n = ambientConferenceRoom();
    const c = isCompositeStepNet(n);
    expect(c).toMatchObject({ ok: true });
    expect(c.reason).toMatch(/10 forward and 3 backward/);
    expect(n.places.find((p) => p.name === "participants")!.marking).toBe("1 ++ 2");
    expect(compile(n).problems.filter((p) => p.severity === "error")).toEqual([]);
  });

  it("Fig. 4.17: the step transitions of the actions (i)-(xii) of Sec. 4.5.2", () => {
    const n = ambientConferenceRoom();
    for (const t of [
      "swipe_card", "sit_and_enter_credentials", "intruder_enters_PC_area", "intruder_leaves_PC_area", "score_papers", "log_out",
      "reviewer_leaves", "in_committed", "to_be_replaced", "return_after_decision", "make_decision", "announcing_decision", "announcing_decision_1",
    ])
      expect(names(n)).toContain(t);
    expect(CASE_COMPOSITIONS.conferenceRoom.find((s) => s.step === "intruder_leaves_PC_area")!.kind).toBe("backward");
  });

  it("Fig. 4.17: the inhibitor arcs drawn in the figure are present", () => {
    const n = ambientConferenceRoom();
    expect(inhibitorsOf(n, "swipe_card")).toEqual(["ctrl_participants"]);
    expect(inhibitorsOf(n, "sit_and_enter_credentials")).toEqual(["ctrl_en_room"]);
    expect(inhibitorsOf(n, "score_papers")).toEqual(["ctrl_home_page", "ctrl_home_page_1"]);
    expect(inhibitorsOf(n, "intruder_enters_PC_area")).toEqual(["ctrl_home_page", "ctrl_home_page_1"]);
    expect(inhibitorsOf(n, "intruder_leaves_PC_area")).toEqual(["ctrl_intr_PC_area"]);
    expect(inhibitorsOf(n, "log_out")).toEqual(["ctrl_papers_scored"]);
    expect(inhibitorsOf(n, "reviewer_leaves")).toEqual(["ctrl_given_role"]);
    expect(inhibitorsOf(n, "in_committed")).toEqual(["ctrl_given_role"]);
    expect(inhibitorsOf(n, "to_be_replaced")).toEqual(["ctrl_com_session"]);
    expect(inhibitorsOf(n, "make_decision")).toEqual(["ctrl_com_session"]);
    expect(inhibitorsOf(n, "return_after_decision")).toEqual(["ctrl_return"]);
    expect(inhibitorsOf(n, "announcing_decision")).toEqual(["ctrl_awaiting"]);
    // Def. 12 guards the announcement from final_decision by both control places of final_decision.
    expect(inhibitorsOf(n, "announcing_decision_1")).toEqual(["ctrl_final_decision", "ctrl_final_decision_1"]);
  });

  it("Fig. 4.16: the fragment has the elements of the figure", () => {
    const n = ambientConferenceRoomFragment();
    expect(names(n)).toEqual(
      [
        "participants", "ctrl_participants", "swipe_card", "entering_room", "ctrl_en_room", "Tem_en_room", "Tr_en_room", "access_granted", "users",
        "sit_and_enter_credentials", "home_page", "ctrl_home_page", "Tem_home_page_1", "Tr_home_page_1", "f_log_in_done", "f_user_credentials",
        "Tem_home_page_2", "Tr_home_page_2", "s_log_in_done", "s_user_credentials",
      ].sort(),
    );
    expect(isCompositeStepNet(n).reason).toMatch(/2 forward and 0 backward/);
  });

  it("Sec. 4.5.2: the unauthorised user stops the break phase by entering and resumes it by leaving (backward step back to home_page)", () => {
    const n = ambientConferenceRoom();
    const s = CASE_COMPOSITIONS.conferenceRoom.find((x) => x.step === "intruder_leaves_PC_area")!;
    expect([s.from, s.to]).toEqual(["intruder_in_PC_area", "home_page"]);
    const fragment = ambientConferenceRoomFragment();
    const g = reachabilityGraph(fragment, { semantics: "interleaving" });
    expect(reaches(fragment, g, "f_log_in_done", 1)).toBe(true);
    expect(reaches(fragment, g, "s_log_in_done", 2)).toBe(true);
    expect(n.places.find((p) => p.name === "home_page")).toBeDefined();
  });

  it("Sec. 4.5.2: a user put in ctrl_participants may not take part from the beginning", () => {
    const n = ambientConferenceRoomFragment({ blocked: [1] });
    const g = reachabilityGraph(n, { semantics: "interleaving" });
    expect(reaches(n, g, "entering_room", 1)).toBe(false);
    expect(reaches(n, g, "entering_room", 2)).toBe(true);
  });

  it("Sec. 4.5.2: user 1 (spokesperson) reaches the committee session and the final decision; user 2 waits outside for it", () => {
    const n = ambientConferenceRoom();
    expect(findReachable(n, { committee_session: [1] }).found).toBe(true);
    expect(findReachable(n, { final_decision: [1] }).found).toBe(true);
    expect(findReachable(n, { awaiting_decision: [2] }).found).toBe(true);
    expect(findReachable(n, { participants_see_decision_on_public_display: [2] }).found).toBe(true);
    expect(findReachable(ambientConferenceRoom({ users: [1] }), { participants_see_decision_on_public_display: [1] }).found).toBe(true);
    // Only user 1 has a role in the committee session: user 2 is never advised there.
    const two = ambientConferenceRoom({ users: [2] });
    expect(findReachable(two, { in_conflict: [2] })).toMatchObject({ found: false, complete: true });
    expect(findReachable(two, { no_conflict: [2] })).toMatchObject({ found: false, complete: true });
  });
});

describe("T-APN versions (Sec. 6.5)", () => {
  it("φ removes the colour-sensitive inhibitor arcs and keeps the places and transitions", () => {
    for (const [apn, tapn] of [
      [ambientGarage(), ambientGarageTapn()],
      [ambientConferenceRoomFragment(), ambientConferenceRoomFragmentTapn()],
    ]) {
      expect(tapn.netClass).toBe("tapn");
      expect(tapn.arcs.some((a) => a.kind === "inhibitor")).toBe(false);
      expect(names(tapn)).toEqual(names(apn));
    }
  });

  it("Sec. 6.5: the garage fragment and its T-APN (Fig. 6.7) have isomorphic concurrent reachability graphs", () => {
    const r = checkEquivalence(ambientGarageFragment(), { tapn: ambientGarageFragmentTapn() });
    expect(r.verdict).toBe("equivalent");
  });

  it("Sec. 6.5: the conference room fragment and its T-APN (Fig. 6.9) have isomorphic concurrent reachability graphs", () => {
    expect(checkEquivalence(ambientConferenceRoomFragment()).verdict).toBe("equivalent");
  });
});

it("the case models are deterministic: building twice gives the same net", () => {
  expect(JSON.stringify(ambientGarage())).toBe(JSON.stringify(ambientGarage()));
  expect(markingKey).toBeDefined();
});

describe("editor examples (File > Examples)", () => {
  it("the Konios chapter-4 examples are valid APNs, say where they come from, and are composite step nets", async () => {
    const { EXAMPLES } = await import("../../editor/src/examples");
    const { validateAmbient } = await import("../src/validate");
    // Fig. 3.1 (ch. 3) is an APN but not a composite step net; it is checked on its own below.
    const apn = EXAMPLES.filter((e) => e.net.netClass === "apn" && !/Fig\. 3\.1/.test(e.title));
    expect(apn.length).toBeGreaterThanOrEqual(5);
    for (const e of apn) {
      expect(e.net.comment, e.title).toMatch(/Konios \(2015\)/);
      expect(validateAmbient(e.net).filter((p) => p.severity === "error"), e.title).toEqual([]);
      expect(isCompositeStepNet(e.net, { severalRoots: true }).ok, e.title).toBe(true);
    }
  });

  it("the Fig. 3.1 example is a valid APN that cites the thesis", async () => {
    const { EXAMPLES } = await import("../../editor/src/examples");
    const { validateAmbient } = await import("../src/validate");
    const e = EXAMPLES.find((x) => /Fig\. 3\.1/.test(x.title))!;
    expect(e.net.netClass).toBe("apn");
    expect(e.net.comment).toMatch(/Konios \(2015\)/);
    expect(validateAmbient(e.net).filter((p) => p.severity === "error")).toEqual([]);
  });
});
