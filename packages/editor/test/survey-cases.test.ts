// The two case studies of Khan, Konios and Guelfi, "A Survey of Petri Nets Slicing" (ACM Computing
// Surveys 51(5), 2018), Sec. 7.1: the insurance claim system (Fig. 2) and the WSU-CASAS smart
// apartment (Fig. 21), sliced by every static algorithm and compared with the survey's Fig. 2(b)
// and the charts of Figs 22-25. Differences are explained in docs/slicing.md, "Survey case studies".

import { describe, expect, it } from "vitest";
import { checkCtl, criterionFromCtl, interleavingSystem, sliceNet, toPTNet, type PTNet, type SlicingAlgorithm, type TransitionSystem } from "@pns/analysis";
import { slicePreserves } from "../src/framework";
import { EXAMPLES } from "../src/examples";
import { CASAS_CRITERIA, CASAS_PROPERTIES, INSURANCE_PROPERTIES, casasApartment, insuranceClaim } from "../src/examples-survey";

type Row = [places: number, transitions: number, states: number, edges: number];

const STATIC: SlicingAlgorithm[] = ["apnSlicing", "ctlStarX", "abstract", "abstractParallel", "safety", "basic"];
const names = (pt: PTNet, k: "places" | "transitions") => pt[k].map((x) => x.name).sort();
const size = (pt: PTNet, ts: TransitionSystem): Row => [pt.places.length, pt.transitions.length, ts.markings.length, ts.edgeTo.length];

function measure(pt: PTNet, places: readonly string[], algorithm: SlicingAlgorithm) {
  const slice = sliceNet(pt, { places }, { algorithm });
  const ts = interleavingSystem(slice.pt);
  expect(ts.complete).toBe(true);
  return { slice, ts, row: size(slice.pt, ts) };
}

/** Every static slice of every property keeps the verdict when its algorithm preserves that kind of property. */
function verdictsAgree(pt: PTNet, formulas: readonly string[]) {
  const full = interleavingSystem(pt);
  for (const f of formulas) {
    const c = criterionFromCtl(f);
    const want = checkCtl(full, f).status;
    for (const a of STATIC) {
      const got = checkCtl(interleavingSystem(sliceNet(pt, { places: c.places }, { algorithm: a }).pt), f).status;
      if (slicePreserves(a, c)) expect(got, `${a}: ${f}`).toBe(want);
    }
  }
}

describe("survey Fig. 2: insurance claim system", () => {
  const pt = toPTNet(insuranceClaim());

  it("has the survey's 16 places, 18 transitions, 29 states and 59 edges (Figs 22-25, entire model)", () => {
    expect(size(pt, interleavingSystem(pt))).toEqual([16, 18, 29, 59]);
  });

  it("Fig. 2(b): the slice for Q = {ac, cs} keeps everything but the emergency branch, paid, close and end", () => {
    // Fig. 2(b) keeps the transitions that put tokens into or take them from a kept place, with their
    // input places: Rakow's CTL*-X slicing (Alg. 1). APNSlicing and basic slicing give the same here.
    const fig2b = {
      places: ["ac", "assessed", "claim", "cs", "customer", "in_court", "offered", "recorded", "rejected", "to_assess", "with_expert"],
      transitions: ["accept", "accept_offer", "assess_by_expert", "assess_directly", "consult_expert", "go_legal", "handle", "legal_proceedings", "offer", "pay", "record", "reject", "reject_offer", "revise"],
    };
    for (const a of ["ctlStarX", "apnSlicing", "basic"] as const) {
      const { slice, row } = measure(pt, ["ac", "cs"], a);
      expect(names(slice.pt, "places"), a).toEqual(fig2b.places);
      expect(names(slice.pt, "transitions"), a).toEqual(fig2b.transitions);
      expect(row).toEqual([11, 14, 12, 14]);
      // As drawn, handle keeps only its arc to to_assess, and pay has no output place.
      const t = (n: string) => slice.pt.transitions.findIndex((x) => x.name === n);
      expect(slice.pt.arcs.filter((x) => x.transition === t("handle") && x.dir === "out").map((x) => slice.pt.places[x.place].name)).toEqual(["to_assess"]);
      expect(slice.pt.arcs.filter((x) => x.transition === t("pay") && x.dir === "out")).toEqual([]);
    }
  });

  it("the static slices of φ1 (Q = {ac, cs}) and φ2 (Q = {ac}) shrink in the order of the survey's charts", () => {
    const full = interleavingSystem(pt).markings.length;
    const st = (q: string[], a: SlicingAlgorithm) => measure(pt, q, a).row[2];
    // φ1: abstract slicing reduces further than CTL*-X slicing (Figs 22 and 23).
    expect(st(["ac", "cs"], "abstract")).toBeLessThan(st(["ac", "cs"], "ctlStarX"));
    expect(st(["ac", "cs"], "ctlStarX")).toBeLessThan(full);
    // φ2: safety ≤ abstract < CTL*-X (Figs 24 and 25).
    expect(st(["ac"], "safety")).toBeLessThanOrEqual(st(["ac"], "abstract"));
    expect(st(["ac"], "abstract")).toBeLessThan(st(["ac"], "ctlStarX"));
    expect(st(["ac"], "apnSlicing")).toBe(st(["ac"], "ctlStarX"));
    // Our sizes (places, transitions, states, edges).
    expect(measure(pt, ["ac", "cs"], "abstract").row).toEqual([8, 11, 9, 11]);
    expect(measure(pt, ["ac"], "ctlStarX").row).toEqual([4, 4, 5, 4]);
    expect(measure(pt, ["ac"], "abstract").row).toEqual([3, 3, 4, 3]);
    expect(measure(pt, ["ac"], "safety").row).toEqual([4, 3, 4, 3]);
  });

  it("the survey's Sec. 7 sizes are those of slices that keep the whole net (criterion {ac, cs, end})", () => {
    // Figs 22-25 report 16/18/29/59 for APN and CTL*-X slicing and 12/14/16/32 for abstract slicing,
    // for both properties: the sizes of slices that keep the emergency branch, which Fig. 2(b) drops.
    expect(measure(pt, ["ac", "cs", "end"], "ctlStarX").row).toEqual([16, 18, 29, 59]);
    expect(measure(pt, ["ac", "cs", "end"], "apnSlicing").row).toEqual([16, 18, 29, 59]);
    const abs = measure(pt, ["ac", "cs", "end"], "abstract");
    expect(abs.row).toEqual([12, 14, 16, 32]);
    // The four neutral transitions merged away.
    expect(abs.slice.merges.map((m) => pt.transitions[m.transition].name).sort()).toEqual(["assess_by_expert", "end_emergency", "offer", "record"]);
  });

  it("φ1 and φ2 keep their verdicts on every slice that preserves them", () => {
    const full = interleavingSystem(pt);
    // Without fairness the claim can be revised forever, so φ1 fails; φ2 holds.
    expect(checkCtl(full, INSURANCE_PROPERTIES.phi1).status).toBe("false");
    expect(checkCtl(full, INSURANCE_PROPERTIES.phi2).status).toBe("true");
    verdictsAgree(pt, [INSURANCE_PROPERTIES.phi1, INSURANCE_PROPERTIES.phi2, "EF(cs > 0)", "AG(!(ac & cs))"]);
  });
});

describe("survey Fig. 21: WSU-CASAS smart apartment", () => {
  const pt = toPTNet(casasApartment());
  const phi1 = criterionFromCtl(CASAS_PROPERTIES.phi1).places;
  const phi2 = criterionFromCtl(CASAS_PROPERTIES.phi2).places;

  it("has 45 places and 106 transitions, and one resident: 45 states and 106 edges (Figs 22-25)", () => {
    expect(size(pt, interleavingSystem(pt))).toEqual([45, 106, 45, 106]);
    expect([...phi1].sort()).toEqual([...CASAS_CRITERIA.phi1].sort());
    expect([...phi2].sort()).toEqual([...CASAS_CRITERIA.phi2].sort());
  });

  it("APN and CTL*-X slicing do not reduce the state space (Figs 22-25)", () => {
    for (const q of [phi1, phi2])
      for (const a of ["apnSlicing", "ctlStarX", "basic"] as const) {
        const { slice, row } = measure(pt, q, a);
        // Only Outside_exiting goes: no transition takes from it, so it is no condition of the slice.
        expect(row, a).toEqual([44, 106, 45, 106]);
        expect(slice.pt.places.some((p) => p.name === "Outside_exiting")).toBe(false);
      }
  });

  it("abstract slicing gives the survey's 38 states and 99 edges for φ1, 30 and 91 for φ2", () => {
    const a1 = measure(pt, phi1, "abstract");
    expect(a1.row).toEqual([37, 99, 38, 99]);
    // Seven dead-end places merged into their neighbours; doors next to a criterion place stay.
    expect(a1.slice.merges.map((m) => pt.places[m.place].name).sort()).toEqual(["D002", "D011", "D012", "D013", "M020", "M026", "Outside_Entering"]);
    const a2 = measure(pt, phi2, "abstract");
    expect(a2.row).toEqual([29, 91, 30, 91]);
    expect(a2.slice.merges).toHaveLength(15);
    // Parallel transitions (Sec. 8.4) shrink the net, not the state count.
    for (const [q, a] of [[phi1, a1], [phi2, a2]] as const) {
      const p = measure(pt, q, "abstractParallel");
      expect(p.row[2]).toBe(a.row[2]);
      expect(p.row[1]).toBeLessThanOrEqual(a.row[1]);
    }
  });

  it("safety slicing does not reduce the strongly connected net (Fig. 24): only the exit goes", () => {
    expect(measure(pt, phi2, "safety").row).toEqual([44, 105, 44, 105]);
  });

  it("φ1 and φ2 keep their verdicts on every slice that preserves them", () => {
    const full = interleavingSystem(pt);
    // φ1 as printed, EF(a ⇒ b), holds in the initial state already; with ∧ instead it fails, since
    // the one resident cannot be on a motion and a door sensor at once. φ2 holds for the same reason.
    const phi1And = CASAS_PROPERTIES.phi1.replace("->", "&");
    expect(checkCtl(full, CASAS_PROPERTIES.phi1).status).toBe("true");
    expect(checkCtl(full, phi1And).status).toBe("false");
    expect(checkCtl(full, CASAS_PROPERTIES.phi2).status).toBe("true");
    verdictsAgree(pt, [CASAS_PROPERTIES.phi1, phi1And, CASAS_PROPERTIES.phi2, "EF(A001_Stove)", "AG(EF(D001))"]);
  });
});

describe("File > Examples", () => {
  it("offers both case studies, laid out without overlapping nodes", () => {
    for (const title of ["Survey Fig. 2: insurance claim system (place/transition)", "Survey Fig. 21: WSU-CASAS smart apartment (place/transition)"]) {
      const net = EXAMPLES.find((e) => e.title === title)?.net;
      expect(net, title).toBeDefined();
      const nodes = [...net!.places, ...net!.transitions];
      expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
      for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++) expect(Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y), `${nodes[i].name} / ${nodes[j].name}`).toBeGreaterThan(24);
    }
  });
});
