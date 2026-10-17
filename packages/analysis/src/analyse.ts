// analyseNet: every analysis in one report, plus a readable summary.

import type { Net } from "@pns/core";
import { analyseBehaviour, structurallyFaithful } from "./behaviour";
import { computeInvariants, incidenceMatrix } from "./invariants";
import { checkAbort, toPTNet } from "./ptnet";
import { siphonsAndTraps } from "./siphons";
import { netGraph, structuralProperties } from "./structure";
import type { AnalysisOptions, AnalysisReport, BehaviourResult, Check, NodeRef, Status, StructuralProperties, SummaryGroup, SummaryItem } from "./types";

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
  const { result: behaviour, notes } = analyseBehaviour(pt, opts, { invariants, structure, siphonsTraps });

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
    summary,
  };
}
