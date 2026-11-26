// analyseNet: every analysis in one report, plus a readable summary.

import type { Net } from "@pns/core";
import { analyseAlgebra } from "./algebra";
import { analyseBehaviour, structurallyFaithful } from "./behaviour";
import { analyseDynamics } from "./dynamics";
import { computeInvariants, incidenceMatrix } from "./invariants";
import { checkAbort, toPTNet } from "./ptnet";
import { siphonsAndTraps } from "./siphons";
import { netGraph, structuralProperties } from "./structure";
import type { AnalysisOptions, AnalysisReport, BehaviourResult, Check, DynamicsResult, NodeRef, Status, StructuralAnalysis, StructuralProperties, SummaryGroup, SummaryItem } from "./types";

const ids = (xs: NodeRef[]) => [...new Set(xs.flatMap((x) => x.elementIds))];
const list = (xs: NodeRef[], max = 3) => {
  const s = xs.slice(0, max).map((x) => x.name);
  return xs.length > max ? `${s.join(", ")} and ${xs.length - max} more` : s.join(", ");
};

const STRUCTURAL: [keyof StructuralProperties, string, string][] = [
  ["pure", "Pure (PUR)", "No transition has a place as both input and output."],
  ["ordinary", "Ordinary (ORD)", "Every arc has weight 1."],
  ["homogeneous", "Homogeneous (HOM)", "All arcs leaving a place have the same weight."],
  ["conservative", "Conservative (CSV)", "Every transition adds as many tokens as it removes."],
  ["staticConflictFree", "Static conflict free (SCF)", "No two transitions share an input place."],
  ["stateMachine", "State machine (SM)", "Every transition has exactly one input and one output place."],
  ["synchronisationGraph", "Synchronisation graph / marked graph (SG)", "Every place has exactly one input and one output transition."],
  ["freeChoice", "Free choice (FC)", "Transitions that share an input place have no other input places."],
  ["extendedFreeChoice", "Extended free choice (EFC)", "Transitions that share an input place have the same input places."],
  ["extendedSimple", "Extended simple (ES)", "Places' sets of output transitions are disjoint or nested."],
  ["connected", "Connected (CON)", "The net is one piece."],
  ["stronglyConnected", "Strongly connected (SC)", "Every node can reach every other along the arcs."],
  ["inputTransitions", "Has input transitions (FT0)", "Some transition has no input places."],
  ["outputTransitions", "Has output transitions (TF0)", "Some transition has no output places."],
  ["inputPlaces", "Has input places (FP0)", "Some place has no input transitions."],
  ["outputPlaces", "Has output places (PF0)", "Some place has no output transitions."],
  ["isolatedNodes", "Has isolated nodes", "Some place or transition has no arcs."],
  ["directedCircuits", "Has directed circuits (DC)", "Some directed path of arcs returns to where it started."],
  ["pureDirectedCircuits", "Has pure directed circuits (PDC)", "Some directed circuit consists only of places and transitions with one input and one output."],
];

function kBoundedNote(b: BehaviourResult): string {
  if (b.bounded === "yes") return b.k === null ? "Yes: the net is bounded." : `Yes: the net is ${b.k}-bounded (no place ever holds more than ${b.k} token${b.k === 1 ? "" : "s"}).`;
  if (b.bounded === "no") return `No: ${b.unboundedPlaces.map((p) => p.name).slice(0, 3).join(", ") || "some place"} can grow without bound, so no k exists.`;
  if (b.bounded === "n/a") return b.reason ? `n/a: ${b.reason}.` : "n/a";
  return "Unknown: boundedness could not be decided within the limits.";
}

function deadStatesStatus(b: BehaviourResult): Status {
  if (b.exploration === "skipped") return "n/a";
  if (b.deadlocks > 0) return "yes";
  return b.deadlockFree === "yes" ? "no" : "unknown";
}

function deadStatesNote(b: BehaviourResult): string {
  if (b.exploration === "skipped") return `n/a: ${b.reason ?? "the state space was not explored"}.`;
  if (b.deadlocks > 0) {
    const path = b.firstDeadlock?.path.map((t) => t.name).join(" ");
    const count = b.exploration === "complete" ? `${b.deadlocks} dead state${b.deadlocks === 1 ? "" : "s"}` : `at least ${b.deadlocks} dead state${b.deadlocks === 1 ? "" : "s"}`;
    return `Yes: ${count}; the first is reached by ${path || "no firing (the initial marking is dead)"}.`;
  }
  if (b.deadlockFree === "yes") return "No: every reachable marking enables some transition.";
  return "Unknown: no dead state was found in the explored part of the state space.";
}

type Add = (key: string, group: SummaryGroup, label: string, description: string, status: Status, explanation: string, highlight?: NodeRef[]) => void;

const word = (s: Status) => (s === "yes" ? "Yes" : s === "no" ? "No" : s === "unknown" ? "Unknown" : "n/a");

function sourceText(d: DynamicsResult): string {
  return d.source === "reachability"
    ? "the complete reachability graph"
    : d.source === "coverability"
      ? "the coverability graph"
      : "the explored part of the state space";
}

/** Summary lines for the liveness levels, repetitivity, consistency, conservation and fairness. */
function addDynamics(add: Add, d: DynamicsResult, P: NodeRef[]): void {
  const placeName = (id: string) => P.find((p) => p.id === id)?.name ?? id;
  const src = sourceText(d);
  const skipped = d.source === "skipped";
  const why = (s: Status, yes: string, no: string, extra = ""): string =>
    skipped ? `n/a: ${d.synchronicNote.replace(/^Not analysed: /, "")}` : s === "yes" ? `Yes: ${yes}` : s === "no" ? `No: ${no}` : s === "n/a" ? "n/a" : `Unknown: not decided from ${src}${extra}.`;
  const names = (xs: NodeRef[]) => list(xs);
  const levelNames = ["L1-live (potentially firable)", "L2-live", "L3-live", "L4-live"];
  for (let k = 0; k < 3; k++) {
    const bad = d.transitions.filter((x) => x.levels[k] === "no").map((x) => x.transition);
    const texts = [
      ["every transition can fire at least once", `${names(bad)} can never fire`],
      ["every transition can fire as often as wanted (k times, for every k)", `${names(bad)} can fire only a bounded number of times`],
      ["every transition can occur infinitely often in some firing sequence", `${names(bad)} cannot occur infinitely often in any firing sequence`],
    ][k];
    add(
      `liveL${k + 1}`,
      "behaviour",
      levelNames[k],
      ["Every transition can fire at least once (no dead transitions).", "Every transition can fire k times, for every k.", "Every transition appears infinitely often in some firing sequence."][k],
      d.netLevels[k],
      why(d.netLevels[k], `${texts[0]} (from ${src}).`, `${texts[1]}.`),
      d.netLevels[k] === "no" ? bad : [],
    );
  }
  add("persistent", "behaviour", "Persistent", "An enabled transition can only be disabled by firing it (the same as dynamic conflict freeness).", d.persistent, d.persistent === "yes" ? "Yes: no firing ever disables another enabled transition." : d.persistent === "no" ? "No: see dynamic conflict freeness (DCF) for a marking where one firing disables another enabled transition." : `${word(d.persistent)}: as for dynamic conflict freeness (DCF).`);
  add("repetitive", "behaviour", "Repetitive", "Some firing sequence contains every transition infinitely often.", d.repetitive, why(d.repetitive, "a cycle of reachable markings fires every transition, and it can be repeated forever.", "no cycle that can repeat forever fires every transition."));
  add("partiallyRepetitive", "behaviour", "Partially repetitive", "Some firing sequence is infinite (some transition occurs infinitely often).", d.partiallyRepetitive, why(d.partiallyRepetitive, "some cycle of reachable markings can be repeated forever.", "every firing sequence is finite."));
  add("consistentB", "behaviour", "Consistent (behavioural)", "Some reachable marking comes back after a firing sequence that contains every transition.", d.consistent, why(d.consistent, "some cycle of reachable markings fires every transition and returns to where it started.", "no firing sequence through every transition returns to its starting marking."));
  add("partiallyConsistentB", "behaviour", "Partially consistent (behavioural)", "Some reachable marking comes back after a non-empty firing sequence.", d.partiallyConsistent, why(d.partiallyConsistent, "some reachable marking can be reproduced.", "no reachable marking can ever be reproduced."));
  const w = d.conservationWeights;
  const wText = w ? Object.entries(w).filter(([, v]) => v).map(([id, v]) => `${v === 1 ? "" : `${v}·`}${placeName(id)}`) : [];
  add(
    "conservativeB",
    "behaviour",
    "Conservative (behavioural)",
    "A positively weighted token sum stays the same in every reachable marking.",
    d.conservative,
    why(d.conservative, `the weighted sum ${wText.length && wText.length <= 8 ? wText.join(" + ") : "with weights found by the analysis"} never changes.`, d.source === "coverability" ? "the net is unbounded, so no positively weighted token sum can stay the same." : "the reachable markings change every positively weighted token sum."),
  );
  add("strictlyConservative", "behaviour", "Strictly conservative", "The total number of tokens stays the same in every reachable marking.", d.strictlyConservative, why(d.strictlyConservative, "every firing keeps the total number of tokens.", "some firing changes the total number of tokens."));
  const up = d.unfairPair;
  add(
    "bFair",
    "behaviour",
    "B-fair (bounded fair)",
    "No transition can fire arbitrarily often while another one does not fire at all.",
    d.bFair,
    why(d.bFair, "every pair of transitions is in the bounded-fair relation.", up ? `${up[0].name} can fire arbitrarily often while ${up[1].name} does not fire.` : "some transition can fire arbitrarily often while another does not."),
    d.bFair === "no" && up ? [up[0], up[1]] : [],
  );
  add("unconditionallyFair", "behaviour", "Unconditionally fair", "Every infinite firing sequence contains every transition infinitely often.", d.unconditionallyFair, why(d.unconditionallyFair, "every infinite firing sequence fires every transition infinitely often (or every firing sequence is finite).", "some infinite firing sequence leaves a transition out from some point on."));
}

/** Summary lines for the matrix-based structural properties. */
function addAlgebra(add: Add, a: StructuralAnalysis, places: number): void {
  const na = a.structurallyBounded === "n/a" && a.structurallyConservative === "n/a";
  const naText = "n/a: the incidence matrix does not describe the firing rule of this net (reset arcs, marking-dependent weights or modulo arithmetic), or the net is empty or has errors.";
  const t = (s: Status, yes: string, no: string, unknown = "not decided within the limits of the analysis, or the net's inhibitor arcs, equal arcs or capacities stop the matrix argument from deciding it."): string =>
    na ? naText : s === "yes" ? `Yes: ${yes}` : s === "no" ? `No: ${no}` : s === "n/a" ? "n/a" : `Unknown: ${unknown}`;
  const wb = a.boundednessWitness ? Object.values(a.boundednessWitness) : [];
  add("structurallyBounded", "invariants", "Structurally bounded", "Bounded for every initial marking: some positive weighting y of the places has yᵀC ≤ 0.", a.structurallyBounded, t(a.structurallyBounded, `a positive weighting of the places (${wb.length <= 12 ? wb.join(", ") : "found by the analysis"}) never grows when a transition fires.`, `${list(a.structurallyUnboundedPlaces)} can grow without bound for some initial marking.`), a.structurallyUnboundedPlaces);
  add("structurallyConservative", "invariants", "Structurally conservative", "Some positive weighting y of the places has yᵀC = 0 (a P-invariant covering every place).", a.structurallyConservative, t(a.structurallyConservative, "a positive P-invariant exists.", a.partiallyStructurallyConservative === "yes" ? "only some places are covered by P-invariants (the net is partially conservative)." : "the net has no P-invariant at all."));
  add("structurallyRepetitive", "invariants", "Structurally repetitive", "Some firing count vector x > 0 has C·x ≥ 0: from a large enough marking every transition can fire infinitely often.", a.structurallyRepetitive, t(a.structurallyRepetitive, "a positive x with C·x ≥ 0 exists.", a.nonRepetitiveTransitions.length ? `${list(a.nonRepetitiveTransitions)} can fire only finitely often from any marking.` : "no positive x with C·x ≥ 0 exists."), a.nonRepetitiveTransitions);
  add("structurallyConsistent", "invariants", "Structurally consistent", "Some firing count vector x > 0 has C·x = 0 (a T-invariant covering every transition).", a.structurallyConsistent, t(a.structurallyConsistent, "a positive T-invariant exists.", a.partiallyStructurallyConsistent === "yes" ? "only some transitions are covered by T-invariants (the net is partially consistent)." : "the net has no T-invariant at all."));
  add("structurallyLive", "invariants", "Structurally live", "Some initial marking makes the net live.", a.structurallyLive, t(a.structurallyLive, "some initial marking makes every transition live.", "a weighted token sum that never grows is lowered by some transition, so that transition can fire only finitely often from any marking (or, for a free-choice net, a minimal siphon contains no trap).", "the necessary condition holds, but liveness for some marking is only decided for free-choice nets (Commoner's theorem)."));
  add("controllabilityRank", "invariants", "Rank condition for controllability", "rank(C) equals the number of places, which complete controllability needs.", a.controllabilityRank, na ? naText : `${word(a.controllabilityRank)}: rank(C) = ${a.rank}${a.rankExact ? "" : " (computed modulo large primes)"}, the net has ${places} place${places === 1 ? "" : "s"}; ${a.pInvariantDimension} independent P-invariant direction${a.pInvariantDimension === 1 ? "" : "s"} and ${a.tInvariantDimension} T-invariant direction${a.tInvariantDimension === 1 ? "" : "s"}.`);
  add("completelyControllable", "invariants", "Completely controllable", "Every marking can be reached from every other marking.", a.completelyControllable, t(a.completelyControllable, "every place has a transition that only adds one token to it and one that only removes one.", a.controllabilityRank === "no" ? "rank(C) is smaller than the number of places." : "from the empty marking no transition can fire.", "the rank condition holds, but it is only necessary."));
  add("structurallyBFair", "invariants", "Structurally B-fair", "B-fair for every initial marking.", a.structurallyBFair, t(a.structurallyBFair, "no transition can fire arbitrarily often without every other one, from any marking.", "for some initial marking a transition can fire arbitrarily often while another does not fire."));
}

/**
 * Charlie-style qualitative analysis of a net: incidence matrix, P/T-invariants, structural
 * properties, siphons and traps, and behavioural properties from the state space. Coloured nets
 * are unfolded; results name unfolded nodes and map back to the coloured elements (NodeRef).
 * Throws only when opts.signal aborts (an Error named "AbortError").
 */
export function analyseNet(net: Net, opts: AnalysisOptions = {}): AnalysisReport {
  const { signal } = opts;
  checkAbort(signal);
  const pt = toPTNet(net);
  const empty = pt.places.length + pt.transitions.length === 0;
  const incidence = incidenceMatrix(pt);
  checkAbort(signal);
  const invariants = computeInvariants(pt, { signal }, incidence);
  checkAbort(signal);
  const graph = netGraph(pt);
  const structure = structuralProperties(pt, graph);
  checkAbort(signal);
  const siphonsTraps = siphonsAndTraps(pt, { signal, graph });
  checkAbort(signal);
  const { result: behaviour, notes, space } = analyseBehaviour(pt, opts, { invariants, structure, siphonsTraps });
  checkAbort(signal);
  const dynamics = analyseDynamics(pt, behaviour, space, incidence.rows, { maxStates: opts.maxStates, signal });
  checkAbort(signal);
  const algebra = analyseAlgebra(pt, incidence.rows, structure, siphonsTraps, { signal });

  const summary: SummaryItem[] = [];
  const add = (key: string, group: SummaryGroup, label: string, description: string, status: Status, explanation: string, highlight: NodeRef[] = []) => {
    const abbr = /\(([A-Za-z0-9-]+)(?:,[^)]*)?\)$/.exec(label)?.[1];
    summary.push({ key, group, label, description, status, explanation, elementIds: ids(highlight), ...(abbr && /[A-Z]/.test(abbr) ? { abbreviation: abbr } : {}) });
  };
  const yn = (b: boolean): Status => (b ? "yes" : "no");
  const prefix = (s: Status, text: string) => `${s === "yes" ? "Yes" : s === "no" ? "No" : s === "unknown" ? "Unknown" : "n/a"}: ${text}`;
  const naEmpty = "n/a: the net is empty.";

  // Behaviour first: what users usually look for.
  add("bounded", "behaviour", "Bounded", "No place can accumulate unboundedly many tokens.", behaviour.bounded, notes.bounded, notes.highlight.bounded);
  add("safe", "behaviour", "Safe (1-bounded)", "No place ever holds more than one token.", behaviour.safe, notes.safe, notes.highlight.safe);
  add("kBounded", "behaviour", "k-bounded (k-B)", "Every place holds at most k tokens in every reachable marking, for the smallest such k.", behaviour.bounded, kBoundedNote(behaviour), notes.highlight.bounded);
  add("deadlockFree", "behaviour", "Deadlock-free", "Every reachable marking enables some transition.", behaviour.deadlockFree, notes.deadlockFree, notes.highlight.deadlockFree);
  add("deadStates", "behaviour", "Has dead states (DSt)", "Some reachable marking enables no transition.", deadStatesStatus(behaviour), deadStatesNote(behaviour), notes.highlight.deadlockFree);
  add("live", "behaviour", "Live", "From every reachable marking, every transition can fire again.", behaviour.live, notes.live, notes.highlight.live);
  add("deadTransitions", "behaviour", "Has dead transitions (DTr)", "Some transition can never fire.", behaviour.hasDeadTransitions, notes.hasDeadTransitions, notes.highlight.hasDeadTransitions);
  add("dynamicConflictFree", "behaviour", "Dynamic conflict free (DCF)", "No reachable marking enables two transitions such that firing one disables the other.", behaviour.dynamicConflictFree, notes.dynamicConflictFree, notes.highlight.dynamicConflictFree);
  add("reversible", "behaviour", "Reversible", "The initial marking can be reached again from every reachable marking.", behaviour.reversible, notes.reversible);
  add("homeStates", "behaviour", "Has home states", "Some marking can be reached from every reachable marking.", behaviour.hasHomeStates, notes.hasHomeStates);
  addDynamics(add, dynamics, pt.places);

  // Invariants.
  const { p: pinv, t: tinv } = invariants;
  const cover = (set: typeof pinv, what: string, extra: string): [Status, string] => {
    if (empty || (set.kind === "P" ? !pt.places.length : !pt.transitions.length)) return ["n/a", `n/a: the net has no ${what}s.`];
    if (set.covered) return ["yes", `Yes: every ${what} is in one of the ${set.invariants.length} minimal ${set.kind}-invariants${extra}.`];
    if (set.truncated) return ["unknown", `Unknown: the ${set.kind}-invariant computation hit its limit.`];
    return ["no", `No: ${list(set.uncovered)} ${set.uncovered.length === 1 ? "is" : "are"} in no ${set.kind}-invariant.`];
  };
  const [cpiS, cpiE] = cover(pinv, "place", ", so the net is structurally bounded");
  add("cpi", "invariants", "Covered by P-invariants (CPI)", "Every place has a weighted token sum that never changes.", cpiS, cpiE, cpiS === "no" ? pinv.uncovered : []);
  const [ctiS, ctiE] = cover(tinv, "transition", "");
  add("cti", "invariants", "Covered by T-invariants (CTI, consistent)", "Some firing sequence using every transition reproduces its starting marking.", ctiS, ctiE, ctiS === "no" ? tinv.uncovered : []);
  addAlgebra(add, algebra, pt.places.length);

  // Structure.
  for (const [key, label, description] of STRUCTURAL) {
    const c: Check = structure[key];
    if (empty) add(key, "structure", label, description, "n/a", naEmpty);
    else add(key, "structure", label, description, yn(c.holds), prefix(yn(c.holds), c.reason), c.witnesses);
  }

  // Siphons and traps.
  const stp = siphonsTraps.siphonTrapProperty;
  let stpNote: string;
  const n = siphonsTraps.siphons.length;
  if (stp === "n/a") stpNote = "n/a: the net has no places.";
  else if (stp === "no") {
    const b = siphonsTraps.badSiphons[0];
    stpNote = `No: the siphon {${b.map((p) => p.name).join(", ")}} contains no marked trap; once emptied it stays empty.`;
  } else if (stp === "unknown") stpNote = "Unknown: the siphon enumeration hit its limit.";
  else if (n === 0) stpNote = "Yes: the net has no siphons.";
  else {
    const ord = structure.ordinary.holds && structurallyFaithful(pt);
    stpNote = `Yes: all ${n} minimal siphon${n === 1 ? "" : "s"} contain an initially marked trap${ord ? (structure.extendedSimple.holds ? ", so the (ordinary, extended simple) net is live" : ", so the (ordinary) net has no deadlocks") : ""}.`;
  }
  add("siphonTrap", "siphons", "Siphon-trap property (DTP)", "Every minimal siphon contains an initially marked trap.", stp, stpNote, stp === "no" ? siphonsTraps.badSiphons[0] : []);

  return {
    net: {
      name: net.name,
      netClass: net.netClass,
      unfolded: pt.unfolded,
      places: pt.places.length,
      transitions: pt.transitions.length,
      arcs: pt.arcs.length,
    },
    warnings: [...new Set(pt.warnings)],
    errors: pt.errors,
    places: pt.places,
    transitions: pt.transitions,
    incidence,
    invariants,
    structure,
    siphonsTraps,
    behaviour,
    dynamics,
    algebra,
    summary,
  };
}
