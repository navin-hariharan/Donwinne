// Validation against Konios (2015), chapter 7: every CTL formula, the qualitative properties of
// §7.2 and the path lengths of §7.3, checked on the case-study models of packages/apn.
//
// Two readings of the models are checked side by side.
//
// 1. Colour-blind (the thesis's own). Chapter 7 analyses the T-APN models (Figs 6.8, 6.10;
//    §7.2.1) with Charlie, which prints uncoloured markings (Figs 7.44-7.49), and "the
//    verification of all the properties of the models is based on sequential analysis" (§7.3.1).
//    So the reference is the interleaving graph of the colour-blind projection of the T-APN
//    (colourBlindProjection: token counts summed over colours, one transition per coloured
//    transition, no capacities, as in Snoopy). Its initial markings are exactly those Charlie
//    prints, it reproduces every garage verdict, all eight path lengths and the dead-state counts.
//    The conference room's interleaving graph has more than 5 million states, so it is cut off and
//    checked three-valued. Not reproduced: the sizes of the "maximum concurrency" graphs drawn
//    "only for visualisation" (Figs 7.41-7.42).
// 2. Coloured. The APNs of Figs 4.15 and 4.17 with users 1 and 2, one database token per user
//    and capacities 1 per colour. Formulas name places by base name, which sums the colours. The
//    maximal-step graph is complete and small; the interleaving graph is cut off and checked
//    three-valued (a verdict only when the unexplored part cannot change it).
//
// Each mismatch is listed with its diagnosis; nothing was changed in the models or the formulas.

import { describe, expect, it } from "vitest";
import { concurrentReachabilityGraph } from "@pns/apn";
import type { Net } from "@pns/core";
import { ambientConferenceRoom, ambientConferenceRoomFragment, ambientConferenceRoomTapn, ambientGarage, ambientGarageTapn } from "../../apn/src/cases";
import {
  CtlChecker,
  analyseNet,
  buildTransitionSystem,
  checkCtl,
  colourBlindProjection,
  ctlProblems,
  deadStates,
  findPaths,
  parseCtl,
  toPTNet,
  transitionSystemFromStepGraph,
  type TransitionSystem,
} from "@pns/analysis";
import { THESIS_FAULT_FORMULAS, THESIS_FORMULAS, THESIS_PATHS, THESIS_QUALITATIVE, type CaseNet } from "./thesis-formulas";

/** States of the interleaving graph explored per model. */
const INTERLEAVING_LIMIT = 40_000;

type Outcome = "agree" | "mismatch" | "unknown";

const COLOUR_BLIND =
  "The formula sums both users per place; with one user's stale advice still on a display while the other user is elsewhere, the antecedent holds although the next firing cannot make the consequent true.";
const LOCKSTEP =
  "Under maximal steps both users move in lockstep and an advice is taken back (Tr_*) in the same step as its user moves on, so the states the formula needs never occur. Under interleaving the formula agrees with the thesis.";
const CONTROL_FIRST =
  "A user who has just been detected (control place marked) cannot move before receiving an advice: the step transition has an inhibitor arc from the control place (Def. 8, Fig. 4.15). So p -> EX(next area) fails right after detection under every semantics. The thesis's 'true' cannot hold for the composed APN as defined.";

/** Outcome per formula: [maximal steps, interleaving], and the diagnosis of any mismatch. */
const RESULTS: Record<string, { max: Outcome; il: Outcome; diagnosis?: string }> = {
  "7.1/garage": { max: "agree", il: "unknown" },
  "7.1/conference": { max: "agree", il: "unknown" },
  "7.3/garage": { max: "agree", il: "unknown" },
  "7.3/conference": { max: "agree", il: "unknown" },
  "7.5/garage": { max: "agree", il: "mismatch", diagnosis: `${COLOUR_BLIND} E.g. car 1 at A1 with Left_p1_1 still shown and car 2 just detected at p1: p1 > 0 & Left_p1_1 > 0, but car 2 must first get its advice, so EX(p2) fails.` },
  "7.5/conference": { max: "agree", il: "mismatch", diagnosis: `${COLOUR_BLIND} User 1 returns to home_page from the PC area with f_log_in_done still shown and must be served by its control system (ctrl_home_page_1) first.` },
  "7.7/garage": { max: "agree", il: "mismatch", diagnosis: `${COLOUR_BLIND} Both cars back at p1 from A1 (ctrl_p1_1 marked) with Left_p1_1 and Forward_p1_2 still shown: neither EX(p2) nor EX(A1) holds until the return advices are given.` },
  "7.7/conference": { max: "agree", il: "agree" },
  "7.9/garage": { max: "agree", il: "unknown" },
  "7.9/conference": { max: "agree", il: "unknown" },
  "7.11/garage": { max: "agree", il: "unknown" },
  "7.11/conference": {
    max: "mismatch",
    il: "mismatch",
    diagnosis:
      "Clause intruder_in_PC_area > 1 -> EX(PC1_off | PC2_off) fails: in the case model the advices are taken back (Tr_PC_area_1/2) while both users are still in the PC area, after which nothing is shown and nothing can be shown again. The retrieve transitions have no guard on the user having left; the thesis's net evidently keeps the advice shown. Under interleaving, auth_spokesperson == 1 -> EX(committee_session) also fails once the user ignores the advice (reviewer_leaves).",
  },
  "7.13/garage": {
    max: "mismatch",
    il: "mismatch",
    diagnosis:
      "Clauses such as A1 & ctrl_A1 -> EX(A1 & Back_A1_2) require both advices of a decision point to be possible for whoever is there. In the APN each database token belongs to one user (bay A1 to car 1), so car 1 at A1 can only get Park_A1_1. In the uncoloured Snoopy net any car can take either advice.",
  },
  "7.15/garage": { max: "agree", il: "agree" },
  "7.15/conference": { max: "agree", il: "agree" },
  "7.17a/garage": {
    max: "mismatch",
    il: "mismatch",
    diagnosis:
      "A car coming back from A1 to p1 is served by the backward step's control system: after Tem_p1_1_x, p1 is occupied, ctrl_p1_1 and ctrl_p1_2 are empty and only Back_p1_1/Left_p1_2 are shown, so Left_p1_1 | Forward_p1_2 fails. Reachable under every semantics (the entry advices are taken back as soon as shown). The thesis's 'true' needs those advices to stay on the display.",
  },
  "7.17b/garage": { max: "agree", il: "agree" },
  "7.17a/conference": { max: "agree", il: "mismatch", diagnosis: "Under interleaving one participant swipes the card before the other: the next state has entering_room == 2 and no access_granted shown yet. Under maximal steps both swipe together, and from the initial state the antecedent participants -> entering_room is false." },
  "7.17b/conference": { max: "agree", il: "agree" },
  "7.19/garage": { max: "mismatch", il: "unknown", diagnosis: "At p1 with both cars detected, EX(db_p1_1 | db_p1_2) fails under maximal steps: both cars take their advice in one step, emptying both database places at once. Under interleaving one advice is given first, so the clause holds there (the whole formula stays undecided within the limit)." },
  "7.19/conference": { max: "agree", il: "unknown" },
  "7.21/garage": { max: "agree", il: "agree" },
  "7.21/conference": { max: "agree", il: "agree" },
  "7.23/garage": { max: "mismatch", il: "mismatch", diagnosis: CONTROL_FIRST },
  "7.23/conference": { max: "mismatch", il: "mismatch", diagnosis: CONTROL_FIRST },
  "7.25/garage": { max: "agree", il: "unknown" },
  "7.25/conference": { max: "agree", il: "unknown" },
  "7.27/garage": { max: "agree", il: "unknown" },
  "7.27/conference": { max: "agree", il: "unknown" },
  "7.29/garage": { max: "agree", il: "unknown" },
  "7.29/conference": { max: "agree", il: "unknown" },
  "7.31/garage": { max: "agree", il: "unknown" },
  "7.31/conference": { max: "agree", il: "unknown" },
  "7.33/garage": { max: "agree", il: "agree" },
  "7.33/conference": { max: "agree", il: "agree" },
  "7.35/garage": { max: "agree", il: "unknown" },
  "7.35/conference": {
    max: "mismatch",
    il: "unknown",
    diagnosis:
      "The model has dead markings other than the terminal one: user 2 stuck in committee_session (fir_paper and sec_paper hold only user 1's token) and user 1 stuck in awaiting_decision (unauth_reviewer holds only user 2's). Per-user database tokens cause these deadlocks; the uncoloured net shares the tokens. (Fig. 7.36b also prints EF(...) where Fig. 7.35b has AG(EF(...)).)",
  },
  "7.37/garage": { max: "mismatch", il: "agree", diagnosis: LOCKSTEP },
  "7.37/conference": { max: "agree", il: "agree" },
  "7.39a/garage": { max: "agree", il: "agree" },
  "7.39b/garage": { max: "agree", il: "agree" },
  "7.39a/conference": { max: "mismatch", il: "agree", diagnosis: LOCKSTEP },
  "7.39b/conference": { max: "agree", il: "agree" },
};

const nets: Record<CaseNet, () => Net> = { garage: () => ambientGarage(), conference: () => ambientConferenceRoom() };

const cache = new Map<string, TransitionSystem>();
function maxStep(which: CaseNet): TransitionSystem {
  const k = `max/${which}`;
  if (!cache.has(k)) {
    const net = nets[which]();
    cache.set(k, transitionSystemFromStepGraph(net, concurrentReachabilityGraph(net, { maximalOnly: true })));
  }
  return cache.get(k)!;
}
function interleaving(which: CaseNet, limit = INTERLEAVING_LIMIT): TransitionSystem {
  const k = `il/${which}/${limit}`;
  if (!cache.has(k)) cache.set(k, buildTransitionSystem(nets[which](), { maxStates: limit }));
  return cache.get(k)!;
}

const outcome = (status: string, expected: boolean): Outcome => (status === "unknown" ? "unknown" : (status === "true") === expected ? "agree" : "mismatch");

describe("Thesis chapter 7: the formula table", () => {
  it("transcribes every figure and parses every formula", () => {
    expect(THESIS_FORMULAS).toHaveLength(44);
    const untranscribable = THESIS_FORMULAS.filter((f) => f.untranscribable).map((f) => f.id);
    expect(untranscribable).toEqual(["7.13/conference"]);
    for (const f of [...THESIS_FORMULAS, ...THESIS_FAULT_FORMULAS]) if (!f.untranscribable) expect(() => parseCtl(f.text), f.id).not.toThrow();
    expect(Object.keys(RESULTS).sort()).toEqual(THESIS_FORMULAS.filter((f) => !f.untranscribable).map((f) => f.id).sort());
  });

  it("names only places of the case models", () => {
    for (const f of [...THESIS_FORMULAS, ...THESIS_FAULT_FORMULAS]) {
      if (f.untranscribable) continue;
      expect(ctlProblems(f.text, maxStep(f.net)).map((p) => p.message), f.id).toEqual([]);
    }
  });
});

describe("Thesis chapter 7: CTL verdicts on the case models", () => {
  it("on the maximal-step graphs (complete)", () => {
    const checkers = { garage: new CtlChecker(maxStep("garage")), conference: new CtlChecker(maxStep("conference")) };
    expect(maxStep("garage").complete && maxStep("conference").complete).toBe(true);
    const rows: string[] = [];
    for (const f of THESIS_FORMULAS) {
      if (f.untranscribable) continue;
      const r = checkers[f.net].check(f.text);
      expect(r.status).not.toBe("unknown");
      const got = outcome(r.status, f.expected);
      rows.push(`${f.id}: ${got}`);
      expect(got, `${f.id} thesis ${f.expected}, got ${r.status}`).toBe(RESULTS[f.id].max);
    }
    expect(rows.filter((r) => r.endsWith("mismatch"))).toHaveLength(9);
  });

  it("on the interleaving graphs (cut off, three-valued)", () => {
    const checkers = { garage: new CtlChecker(interleaving("garage")), conference: new CtlChecker(interleaving("conference")) };
    expect(interleaving("garage").complete).toBe(false);
    for (const f of THESIS_FORMULAS) {
      if (f.untranscribable) continue;
      const r = checkers[f.net].check(f.text);
      expect(outcome(r.status, f.expected), `${f.id} thesis ${f.expected}, got ${r.status}`).toBe(RESULTS[f.id].il);
      // A conclusive verdict comes with evidence that replays on the explored graph.
      if (r.status === "false" && r.trace) expect(r.trace.kind).toBe("counterexample");
    }
  }, 60_000);

  it("explains every mismatch", () => {
    for (const [id, r] of Object.entries(RESULTS)) if (r.max === "mismatch" || r.il === "mismatch") expect(r.diagnosis, id).toBeTruthy();
  });

  it("§7.3.3 fault-tolerance formulas hold vacuously on the fault-free models", () => {
    // The thesis checks them on models with extra database tokens without saying which; on the
    // fault-free models the wrong advice (two tokens on one display) never appears.
    for (const f of THESIS_FAULT_FORMULAS) {
      expect(checkCtl(maxStep(f.net), f.text).status, f.id).toBe("true");
      const wrong = f.net === "garage" ? "Back_p2_1 == 2" : "PC1_off == 2";
      expect(checkCtl(maxStep(f.net), `EF(${wrong})`).status).toBe("false");
    }
  });
});

describe("Thesis chapter 7: qualitative properties (§7.2)", () => {
  it("structure: FT0, TF0, FP0, PF0 as the thesis states them, DCF", () => {
    for (const which of ["garage", "conference"] as const) {
      const r = analyseNet(nets[which](), { maxStates: 2000 });
      const t = THESIS_QUALITATIVE[which];
      // The thesis states "no input transition (FT0)" etc., the negation of ours.
      expect(!r.structure.inputTransitions.holds).toBe(t.FT0);
      expect(!r.structure.outputTransitions.holds).toBe(t.TF0);
      expect(!r.structure.inputPlaces.holds).toBe(t.FP0);
      expect(!r.structure.outputPlaces.holds).toBe(t.PF0);
      expect(r.behaviour.dynamicConflictFree === "yes").toBe(t.DCF);
      const abbr = r.summary.map((s) => s.abbreviation).filter(Boolean);
      for (const a of ["FT0", "TF0", "FP0", "PF0", "k-B", "DCF", "DSt", "DTr"]) expect(abbr).toContain(a);
    }
  });

  it("behaviour on the maximal-step graphs: k, dead states, dead transitions, size", () => {
    const found: Record<string, unknown> = {};
    for (const which of ["garage", "conference"] as const) {
      const ts = maxStep(which);
      const t = THESIS_QUALITATIVE[which];
      // k by base name (both users counted together, as in the uncoloured net).
      const base = [...new Set(ts.places.map((p) => p.baseName ?? p.name))];
      let k = 0;
      for (const b of base) {
        const idx = ts.places.flatMap((p, i) => ((p.baseName ?? p.name) === b ? [i] : []));
        for (const M of ts.markings) k = Math.max(k, idx.reduce((s, i) => s + M[i], 0));
      }
      expect(k).toBe(t.k);
      // Dead transitions by base name: does some mode ever occur in a step?
      const names = [...new Set(ts.transitions.map((x) => x.baseName ?? x.name))];
      const c = new CtlChecker(ts);
      const dead = names.filter((n) => c.check(`EF(fireable(${n}))`).status === "false");
      found[which] = { states: ts.markings.length, edges: ts.edgeTo.length, dead: deadStates(ts).length, deadTransitions: dead };
    }
    // Garage: one dead state as in the thesis; the graph is larger (see the report below).
    expect(found).toEqual({
      garage: { states: 82, edges: 156, dead: 1, deadTransitions: [] },
      conference: { states: 142, edges: 194, dead: 4, deadTransitions: [] },
    });
    // Thesis: 52 states / 87 edges and 82 / 130, one dead state each, no dead transitions.
    // Diagnosis: the thesis's Charlie graphs are of the uncoloured Snoopy net, whose database
    // tokens are shared by both users; here each token belongs to one user, so the users' runs
    // differ and the conference room gets three extra dead markings (see 7.35/conference). No
    // transition is dead, as in the thesis.
    expect(THESIS_QUALITATIVE.conference.deadTransitions).toBe(false);
  });
});

describe("Thesis chapter 7: paths (§7.3.1, §7.3.2)", () => {
  const len = (which: CaseNet, target: string, limit?: number) => findPaths(interleaving(which, limit), { target });

  it("following advices in the garage: lengths 4 and 6, as in the thesis", () => {
    for (const p of THESIS_PATHS.filter((p) => p.net === "garage" && p.kind === "following")) {
      const r = len("garage", p.target);
      expect(r.conclusive, p.id).toBe(true);
      expect(r.shortestLength, p.id).toBe(p.length);
    }
    expect(len("garage", THESIS_PATHS[0].target).paths[0].steps.map((s) => s.label)).toEqual(["access_granted<x=1>", "Tem_p1_1<x=1>", "p1toA1<x=1>", "Tem_A1_1<x=1>"]);
  });

  it("following advices in the conference room: (a), (b) as in the thesis; (c) needs both users", () => {
    const [a, b, c] = THESIS_PATHS.filter((p) => p.net === "conference" && p.kind === "following");
    // (a) and (b) end in auth_exit_and_see_decision, which the case model shows to a user arriving
    // through final_decision (Tem_see_display_2 follows announcing_decision_1, see cases.ts).
    const one = buildTransitionSystem(ambientConferenceRoom({ users: [1] }), { maxStates: 20_000 });
    expect(one.complete).toBe(true);
    for (const p of [a, b]) expect(findPaths(one, { target: p.target }), p.id).toMatchObject({ found: true, conclusive: true, shortestLength: p.length });
    // The thesis's lengths also come out exactly on the two-user graph.
    const big = 120_000;
    for (const p of [a, b]) {
      const r = len("conference", p.target, big);
      expect(r.conclusive, p.id).toBe(true);
      expect(r.shortestLength, p.id).toBe(p.length);
    }
    // (c): thesis 12. Here 16: f_log_in_done needs user 1's credentials but leave_room, no_access
    // and unauth_wait_and_see_decision need user 2's database tokens, so both users must act.
    const rc = len("conference", c.target);
    expect(rc.conclusive).toBe(true);
    expect(rc.shortestLength).toBe(16);
  }, 60_000);

  it("ignoring advices: the targets name control places the case models never mark", () => {
    for (const which of ["garage", "conference"] as const) {
      // ctrl_entrance / ctrl_participants start with 2 tokens in the thesis's net; in the APN they
      // hold the unauthorised users (inhibitor arcs only), empty, with no input transition.
      const pt = toPTNet(nets[which]());
      const ctrl = which === "garage" ? "ctrl_entrance" : "ctrl_participants";
      const idx = pt.places.flatMap((p, i) => (p.baseName === ctrl ? [i] : []));
      expect(idx.every((i) => pt.m0[i] === 0 && !pt.arcs.some((a) => a.place === i && a.dir === "out"))).toBe(true);
      expect(checkCtl(maxStep(which), `EF(${ctrl})`).status).toBe("false");
    }
    // Without that conjunct, the garage paths have the thesis's lengths and Parikh vectors.
    const [ga, gb] = THESIS_PATHS.filter((p) => p.net === "garage" && p.kind === "ignoring");
    const parikh = (target: string) => {
      const r = len("garage", target.replace(" * ctrl_entrance", ""));
      expect(r.conclusive).toBe(true);
      return { length: r.shortestLength, parikh: Object.keys(r.paths[0].parikh).map((t) => t.replace(/<x=\d>/, "")).sort() };
    };
    expect(parikh(ga.target)).toEqual({ length: ga.length, parikh: ["Tem_p1_1", "access_granted", "Tem_p1_2_1", "p2top1", "p1top2", "Tem_p2_1", "p1toA1", "Tem_A1_1"].sort() });
    expect(parikh(gb.target)).toEqual({ length: gb.length, parikh: ["access_granted", "p1top2", "Tem_p2_2", "p2toA2", "Tem_A2_2", "p1toA1", "A1top1", "Tem_A1_2", "Tem_p1_1_2", "Tem_p1_2"].sort() });
  });
});

// ---------------------------------------------------------------------------------------------
// The colour-blind reading (the thesis's own)

const tapn: Record<CaseNet, () => Net> = { garage: () => ambientGarageTapn(), conference: () => ambientConferenceRoomTapn() };
/** Conference room: states of the colour-blind interleaving graph explored (the whole has more than 5 million). */
const CB_CONFERENCE_LIMIT = 300_000;

function colourBlind(which: CaseNet, semantics: "interleaving" | "maximalSteps", limit = which === "garage" || semantics === "maximalSteps" ? 1_000_000 : CB_CONFERENCE_LIMIT): TransitionSystem {
  const k = `cb/${which}/${semantics}/${limit}`;
  if (!cache.has(k)) cache.set(k, buildTransitionSystem(tapn[which](), { projection: "colourBlind", semantics, maxStates: limit }));
  return cache.get(k)!;
}

/** Colour-blind outcomes: [interleaving, maximal steps]; only interleaving is the thesis's analysis. */
const CB_MISMATCHES: Record<string, { il?: Outcome; max?: Outcome; diagnosis: string }> = {
  "7.11/conference": {
    il: "mismatch",
    max: "mismatch",
    diagnosis:
      "Interleaving: auth_spokesperson == 1 -> EX(committee_session) fails once the user ignores the advice and leaves (reviewer_leaves), the advice staying on the display; nobody is then at given_role to enter the committee session. Maximal steps: both advices PC1_off and PC2_off are taken back in the step after they are shown.",
  },
  "7.17a/conference": {
    il: "mismatch",
    diagnosis:
      "The two participants swipe their cards one after the other: after the first, participants -> entering_room holds, and the second swipe leads to entering_room == 2 before any access_granted is shown. Any interleaving of the uncoloured net allows this; the thesis's 'true' would need the advice to come before the second swipe.",
  },
  "7.13/garage": { max: "mismatch", diagnosis: "Maximal steps only: both cars detected at p1 take all their advices in one step, so p1 & Left_p1_1 is not a successor of p1 & ctrl_p1. The thesis checks CTL sequentially (§7.3.1), where this agrees." },
  "7.39b/conference": { max: "mismatch", diagnosis: "Maximal steps only: with both users in the PC area the next maximal step always shows PC1_off or PC2_off. The thesis checks CTL sequentially (§7.3.1), where this agrees." },
};
const CB_UNKNOWN_CONFERENCE = ["7.1", "7.3", "7.5", "7.9", "7.19", "7.23", "7.25", "7.27", "7.29", "7.31", "7.35"];

describe("Thesis chapter 7, colour-blind T-APN (the thesis's reading)", () => {
  it("projects to the initial markings Charlie prints", () => {
    const show = (which: CaseNet) => {
      const net = colourBlindProjection(tapn[which]()).net;
      return Object.fromEntries(net.places.filter((p) => p.marking !== "0").map((p) => [p.name, Number(p.marking)]));
    };
    const one = (xs: string[]) => Object.fromEntries(xs.map((x) => [x, 1]));
    expect(show("garage")).toEqual({
      entrance: 2,
      ctrl_entrance: 2,
      db_exit_12: 2,
      ...one(["db_p1_1", "db_p1_2", "db_A1_1", "db_A1_2", "db_p1_1_1", "db_p1_1_2", "db_p2_1", "db_p2_2", "db_A2_1", "db_A2_2", "db_p2_1_1", "db_p2_1_2", "db_p1_2_1", "db_p1_2_2"]),
    });
    expect(show("conference")).toEqual({
      participants: 2,
      ctrl_participants: 2,
      users: 2,
      on_time: 2,
      PC_area: 2,
      ...one(["f_user_credentials", "s_user_credentials", "timer_expired", "PC_area_1", "PC_area_2", "double_role", "only_reviewer", "unauth_reviewer", "fir_paper", "sec_paper", "replaced_reviewer", "member", "member_1", "unauth_user_final", "auth_user_final"]),
    });
  });

  it("CTL verdicts: garage 22/22 on the complete interleaving graph; conference as far as decided", () => {
    const tally = { agree: 0, mismatch: 0, unknown: 0 };
    for (const which of ["garage", "conference"] as const) {
      const ts = colourBlind(which, "interleaving");
      expect(ts.complete).toBe(which === "garage");
      const c = new CtlChecker(ts);
      for (const f of THESIS_FORMULAS) {
        if (f.net !== which || f.untranscribable) continue;
        const got = outcome(c.check(f.text).status, f.expected);
        tally[got]++;
        const want = CB_MISMATCHES[f.id]?.il ?? (which === "conference" && CB_UNKNOWN_CONFERENCE.includes(f.figure) ? "unknown" : "agree");
        expect(got, f.id).toBe(want);
      }
    }
    expect(tally).toEqual({ agree: 30, mismatch: 2, unknown: 11 });
    cache.delete(`cb/conference/interleaving/${CB_CONFERENCE_LIMIT}`);
  }, 120_000);

  it("CTL verdicts on the maximal-step graphs: 40/43", () => {
    let agree = 0;
    for (const which of ["garage", "conference"] as const) {
      const c = new CtlChecker(colourBlind(which, "maximalSteps"));
      for (const f of THESIS_FORMULAS) {
        if (f.net !== which || f.untranscribable) continue;
        const got = outcome(c.check(f.text).status, f.expected);
        expect(got, f.id).toBe(CB_MISMATCHES[f.id]?.max ?? "agree");
        if (got === "agree") agree++;
      }
    }
    expect(agree).toBe(40);
  });

  it("dead states, dead transitions and graph sizes", () => {
    const g = colourBlind("garage", "interleaving");
    expect([g.markings.length, g.edgeTo.length, deadStates(g).length]).toEqual([573_441, 6_225_921, THESIS_QUALITATIVE.garage.deadStates]);
    const c = new CtlChecker(g);
    expect(g.transitions.filter((t) => c.check(`EF(fireable(${t.name}))`).status !== "true").map((t) => t.name)).toEqual([]);
    expect(c.check("AG(EF(deadlock))").status).toBe("true");
    // Maximal steps (auto-concurrency allowed): one dead state each, as in the thesis, but the
    // graphs are larger than Charlie's "maximum concurrency" drawings (52/87 and 82/130). The
    // projection merges each T-APN control place with its complement tokens, so a car can, for
    // instance, leave p1 on a complement token before its advice; that adds behaviour the drawn
    // graphs do not have. Charlie's step rule for those drawings is not documented in the thesis.
    const sizes = (["garage", "conference"] as const).map((w) => {
      const ts = colourBlind(w, "maximalSteps");
      return [ts.markings.length, ts.edgeTo.length, deadStates(ts).length];
    });
    expect(sizes).toEqual([
      [229, 1990, 1],
      [314, 1620, 1],
    ]);
    expect([THESIS_QUALITATIVE.garage.states, THESIS_QUALITATIVE.conference.states]).toEqual([52, 82]);
  });

  it("every path length of §7.3 as printed, targets unchanged", () => {
    // The conference room's longer paths need a larger part of its graph to be conclusive.
    const graph = (which: CaseNet) => colourBlind(which, "interleaving", which === "garage" ? undefined : 1_000_000);
    for (const p of THESIS_PATHS) {
      const r = findPaths(graph(p.net), { target: p.target });
      expect(r.conclusive, p.id).toBe(true);
      expect(r.shortestLength, p.id).toBe(p.length);
    }
    const c = findPaths(graph("conference"), { target: THESIS_PATHS.find((p) => p.id.startsWith("7.3.1/conference/c"))!.target });
    expect(c.paths[0].steps.map((s) => s.label)).toEqual(["swipe_card", "Tem_en_room", "sit_and_enter_credentials", "Tem_home_page_1", "score_papers", "Tem_papers_scored_2", "log_out", "Tem_given_role_2", "reviewer_leaves", "Tem_awaiting", "announcing_decision", "Tem_see_display_1"]);
    cache.delete("cb/conference/interleaving/1000000");
  }, 120_000);

  it("the step-graph adapter offers the same colour-blind vocabulary", () => {
    const net = ambientConferenceRoomFragment();
    const ts = transitionSystemFromStepGraph(net, concurrentReachabilityGraph(net, { maximalOnly: true }), { projection: "colourBlind" });
    expect(ts.places.some((p) => p.name.includes("["))).toBe(false);
    expect(ts.transitions.map((t) => t.name)).toContain("swipe_card");
    expect(checkCtl(ts, "AX(entering_room == 2)").status).toBe("true");
    expect(() => checkCtl(ts, "AG(entering_room[1] <= 1)")).toThrow(/colour|Unknown|entering_room/);
  });
});

describe("Concurrent reachability graph adapter", () => {
  it("reads a CRG of an APN with the unfolded names and agrees with the interleaving graph", () => {
    const net = ambientConferenceRoomFragment();
    const g = concurrentReachabilityGraph(net);
    const ts = transitionSystemFromStepGraph(net, g);
    const il = buildTransitionSystem(net);
    expect(ts.semantics).toBe("step");
    expect(ts.complete && il.complete).toBe(true);
    const key = (m: ArrayLike<number>) => Array.from(m).join(",");
    expect(new Set(ts.markings.map(key))).toEqual(new Set(il.markings.map(key)));
    // Step labels use the P/T view's transition names.
    expect(ts.transitions.map((t) => t.name)).toEqual(il.transitions.map((t) => t.name));
    expect(ts.labels.some((l) => l.length > 1)).toBe(true);
    for (const f of ["AG(entering_room <= 2)", "EF(home_page == 2)", "AG(EF(home_page == 2))", "EF(fireable(swipe_card) & !fireable(sit_and_enter_credentials))", "AG(participants[1] -> EX(entering_room[1]))"]) {
      expect(checkCtl(ts, f).status, f).toBe(checkCtl(il, f).status);
    }
    // A step with both users swiping their cards at once.
    expect(checkCtl(ts, "EX(entering_room == 2)").status).toBe("true");
    expect(checkCtl(il, "EX(entering_room == 2)").status).toBe("false");
  });

  it("marks a cut-off CRG as incomplete and stays conclusive where it can", () => {
    const net = ambientGarage();
    const g = concurrentReachabilityGraph(net, { maxStates: 50 });
    const ts = transitionSystemFromStepGraph(net, g);
    expect(ts.complete).toBe(false);
    expect(ts.notes.join(" ")).toMatch(/incomplete/);
    expect(checkCtl(ts, "EF(p1 == 2)").status).toBe("true");
    expect(checkCtl(ts, "AG(p1 < 2)").status).toBe("false");
    expect(checkCtl(ts, "AG(EF(exit == 2))").status).toBe("unknown");
  });
});
