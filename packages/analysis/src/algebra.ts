// Matrix-based (structural) properties of the report's §5.2.2 (A. Halder, "A Study of Petri Nets",
// 2006; Murata 1989, §VI): properties of the incidence matrix C that hold for every initial
// marking. Each is a question about a polyhedral cone, decided exactly over the rationals:
//
//   structurally bounded        ∃ y > 0,  yᵀC ≤ 0
//   (partially) conservative    ∃ y > 0 (y ≥ 0, y ≠ 0),  yᵀC = 0
//   (partially) repetitive      ∃ x > 0 (x ≥ 0, x ≠ 0),  C·x ≥ 0
//   (partially) consistent      ∃ x > 0 (x ≥ 0, x ≠ 0),  C·x = 0
//   structurally live (needed)  no y ≥ 0 with yᵀC ≤ 0 and yᵀC(t) < 0 for some t
//   controllable (needed)       rank C = number of places
//   structurally B-fair         no x ≥ 0 with C·x ≥ 0, x(a) > 0 and x(b) = 0
//
// The cones are closed under addition, so one linear program per cone finds its maximal support
// (which places or transitions some vector of it can make positive); "∃ x > 0" is "everything is in
// the support". The theorems behind them are for P/T nets. Read arcs change nothing; inhibitor and
// equal arcs and capacities only remove behaviour, so the answers that rest on "this cannot happen"
// stay proven and the ones that rest on "this can happen" become "unknown". Reset arcs and
// marking-dependent weights make C meaningless: then everything is "n/a".

import { invariantsHold, structurallyFaithful } from "./behaviour";
import { checkAbort, structuralMatrices, type PTNet } from "./ptnet";
import { coneSupport, rank, type ConeSupport } from "./rational";
import type { NodeRef, SiphonTrapResult, Status, StructuralAnalysis, StructuralProperties } from "./types";

const yn = (b: boolean): Status => (b ? "yes" : "no");

export function analyseAlgebra(pt: PTNet, C: number[][], structure: StructuralProperties, siphons: SiphonTrapResult, opts: { signal?: AbortSignal } = {}): StructuralAnalysis {
  const { signal } = opts;
  const n = pt.places.length;
  const m = pt.transitions.length;
  const r = rank(C, m);
  const base = {
    rank: r.rank,
    rankExact: r.exact,
    pInvariantDimension: n - r.rank,
    tInvariantDimension: m - r.rank,
  };
  const na: StructuralAnalysis = {
    ...base,
    structurallyBounded: "n/a",
    structurallyUnboundedPlaces: [],
    boundednessWitness: null,
    structurallyConservative: "n/a",
    partiallyStructurallyConservative: "n/a",
    structurallyRepetitive: "n/a",
    partiallyStructurallyRepetitive: "n/a",
    nonRepetitiveTransitions: [],
    structurallyConsistent: "n/a",
    partiallyStructurallyConsistent: "n/a",
    structurallyLive: "n/a",
    controllabilityRank: "n/a",
    completelyControllable: "n/a",
    structurallyBFair: "n/a",
    structuralBFairClasses: null,
  };
  if (!n && !m) return na;
  if (!invariantsHold(pt) || pt.errors.length) return na;
  const faithful = structurallyFaithful(pt);

  // Cones over places (y) and over transitions (x).
  const colTerms = (t: number, sign: number) => C.flatMap((row, p) => (row[t] ? [[p, sign * row[t]] as [number, number]] : []));
  const rowTerms = (p: number) => C[p].flatMap((v, t) => (v ? [[t, v] as [number, number]] : []));
  const unitP = [...Array(n).keys()].map((p) => [[p, 1]] as [number, number][]);
  const unitT = [...Array(m).keys()].map((t) => [[t, 1]] as [number, number][]);
  const cols = [...Array(m).keys()];
  const rows = [...Array(n).keys()];

  const status = (cs: ConeSupport, all: boolean): Status => (cs.status === "limit" ? "unknown" : yn(all ? cs.support.every(Boolean) : cs.support.some(Boolean)));

  // yᵀC = 0.
  const pz = n ? coneSupport(n, cols.map((t) => colTerms(t, 1)), "=", unitP, { signal }) : null;
  checkAbort(signal);
  // yᵀC ≤ 0, written −yᵀC ≥ 0; targets: the places, then −yᵀC(t) for each transition.
  const ple = n ? coneSupport(n, cols.map((t) => colTerms(t, -1)), ">=", [...unitP, ...cols.map((t) => colTerms(t, -1))], { signal }) : null;
  checkAbort(signal);
  // C·x ≥ 0 and C·x = 0.
  const tge = m ? coneSupport(m, rows.map(rowTerms), ">=", unitT, { signal }) : null;
  checkAbort(signal);
  const tz = m ? coneSupport(m, rows.map(rowTerms), "=", unitT, { signal }) : null;
  checkAbort(signal);

  // Structural boundedness.
  let structurallyBounded: Status = "n/a";
  let structurallyUnboundedPlaces: NodeRef[] = [];
  let boundednessWitness: Record<string, number> | null = null;
  if (ple && ple.status === "ok") {
    const placeSupport = ple.support.slice(0, n);
    if (placeSupport.every(Boolean)) {
      structurallyBounded = "yes";
      if (ple.witness) boundednessWitness = Object.fromEntries(pt.places.map((p, i) => [p.id, ple.witness![i]]));
    } else if (faithful) {
      structurallyBounded = "no";
      structurallyUnboundedPlaces = pt.places.filter((_, i) => !placeSupport[i]);
    } else structurallyBounded = "unknown";
  } else if (ple) structurallyBounded = "unknown";

  const structurallyConservative = pz ? status(pz, true) : "n/a";
  const partiallyStructurallyConservative = pz ? status(pz, false) : "n/a";
  const structurallyConsistent = tz ? status(tz, true) : "n/a";
  const partiallyStructurallyConsistent = tz ? status(tz, false) : "n/a";

  // Repetitivity: "no" is proven for any net; "yes" needs every firing order to be possible.
  const rep = (all: boolean): Status => {
    if (!tge) return "n/a";
    const s = status(tge, all);
    return s === "yes" && !faithful ? "unknown" : s;
  };
  const structurallyRepetitive = rep(true);
  const partiallyStructurallyRepetitive = rep(false);
  const nonRepetitiveTransitions = tge && tge.status === "ok" ? pt.transitions.filter((_, t) => !tge.support[t]) : [];

  // Structural liveness. A y ≥ 0 with yᵀC ≤ 0 and yᵀC(t) < 0 is a weighted token sum that never
  // grows and that t lowers, so t fires only finitely often from any marking: not live.
  let structurallyLive: Status = "unknown";
  if (!m) structurallyLive = "n/a";
  else if (!n) structurallyLive = "yes";
  else if (ple && ple.status === "ok" && ple.support.slice(n).some(Boolean)) structurallyLive = "no";
  else if (
    faithful &&
    structure.ordinary.holds &&
    structure.freeChoice.holds &&
    !siphons.siphonsTruncated
  ) {
    // Commoner's theorem for free-choice nets: live iff every siphon contains a marked trap; some
    // marking does that (mark everything) iff every minimal siphon contains a non-empty trap.
    structurallyLive = yn(siphons.siphons.every((s) => s.maxTrap.length > 0));
  }

  // Controllability.
  const controllabilityRank: Status = n ? yn(r.rank === n) : "n/a";
  let completelyControllable: Status = "unknown";
  if (!n) completelyControllable = "n/a";
  else if (r.rank < n) completelyControllable = "no";
  else if (faithful && !structure.inputTransitions.holds) completelyControllable = "no";
  else if (faithful) {
    // Sufficient: for every place, a transition that only adds one token to it and one that only
    // removes one; any marking is then reached from any other.
    const { pre, post } = structuralMatrices(pt);
    const only = (mat: number[][], t: number, p: number) => mat.every((row, q) => row[t] === (q === p ? 1 : 0));
    const none = (mat: number[][], t: number) => mat.every((row) => row[t] === 0);
    const ok = rows.every((p) => cols.some((t) => none(pre, t) && only(post, t, p)) && cols.some((t) => only(pre, t, p) && none(post, t)));
    if (ok) completelyControllable = "yes";
  }

  // Structural B-fairness: a fires unboundedly often without b for some marking iff some x ≥ 0 with
  // C·x ≥ 0 has x(a) > 0 and x(b) = 0 (Dickson's lemma one way, a large enough marking the other).
  let structurallyBFair: Status = "unknown";
  let structuralBFairClasses: NodeRef[][] | null = null;
  if (m < 2) structurallyBFair = m ? "yes" : "n/a";
  else if (m <= 60) {
    const without: boolean[][] = [];
    let limit = false;
    for (let b = 0; b < m && !limit; b++) {
      checkAbort(signal);
      const cs = coneSupport(m, rows.map(rowTerms), ">=", unitT, { zero: [b], signal });
      if (cs.status === "limit") limit = true;
      else without.push(cs.support);
    }
    if (!limit) {
      const fair = (a: number, b: number) => a === b || (!without[b][a] && !without[a][b]);
      let allFair = true;
      for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) if (!fair(a, b)) allFair = false;
      structurallyBFair = allFair ? "yes" : faithful ? "no" : "unknown";
      if (allFair || faithful) {
        let transitive = true;
        for (let a = 0; a < m && transitive; a++)
          for (let b = 0; b < m && transitive; b++) if (fair(a, b)) for (let c = 0; c < m; c++) if (fair(b, c) && !fair(a, c)) transitive = false;
        if (transitive) {
          const seen = new Uint8Array(m);
          structuralBFairClasses = [];
          for (let a = 0; a < m; a++) {
            if (seen[a]) continue;
            const cls: NodeRef[] = [];
            for (let b = 0; b < m; b++)
              if (!seen[b] && fair(a, b)) {
                seen[b] = 1;
                cls.push(pt.transitions[b]);
              }
            structuralBFairClasses.push(cls);
          }
        }
      }
    }
  }

  return {
    ...base,
    structurallyBounded,
    structurallyUnboundedPlaces,
    boundednessWitness,
    structurallyConservative,
    partiallyStructurallyConservative,
    structurallyRepetitive,
    partiallyStructurallyRepetitive,
    nonRepetitiveTransitions,
    structurallyConsistent,
    partiallyStructurallyConsistent,
    structurallyLive,
    controllabilityRank,
    completelyControllable,
    structurallyBFair,
    structuralBFairClasses,
  };
}
