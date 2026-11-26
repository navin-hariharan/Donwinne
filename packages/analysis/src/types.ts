// JSON-friendly result types of the qualitative analysis (plain arrays and records only).

import type { NetClass } from "@pns/core";

/**
 * Outcome of a property check.
 * - "yes": the property holds (proven, for the analysed net).
 * - "no": it does not hold; the explanation names a counterexample.
 * - "unknown": could not be decided within the limits (state space too large, unsupported arcs).
 * - "n/a": does not apply (empty net, errors in the net, or the property needs something absent).
 */
export type Status = "yes" | "no" | "unknown" | "n/a";

/**
 * A place or transition of the analysed net. For coloured nets this is an unfolded node
 * (one place per place and colour, one transition per transition and binding).
 */
export interface NodeRef {
  /** Id of the analysed node: the editor id for P/T nets, the unfolded id for coloured nets. */
  id: string;
  /** Display name, e.g. "P1", "fork[a]" (coloured place and colour) or "take<x=a>" (transition and binding). */
  name: string;
  /** Editor element ids to highlight: the coloured place or transition, or every member of a logical place. */
  elementIds: string[];
  /** Coloured nets: name of the coloured place or transition. */
  baseName?: string;
  /** Coloured nets: the colour ("a", "(1,b)") of a place or the binding ("x=a, y=b") of a transition. */
  colour?: string;
}

/** Places × transitions incidence matrix C = Post − Pre of the structural net. */
export interface IncidenceMatrix {
  /** Row ids (places, same order as AnalysisReport.places). */
  placeIds: string[];
  /** Column ids (transitions, same order as AnalysisReport.transitions). */
  transitionIds: string[];
  /** rows[p][t] = tokens transition t adds to (positive) or removes from (negative) place p. */
  rows: number[][];
  /** Arcs left out because their weight depends on the marking or cannot be evaluated. */
  ignoredArcs: string[];
}

export interface Invariant {
  /** Coefficient per node id (only non-zero entries). */
  weights: Record<string, number>;
  /** The nodes with a non-zero coefficient. */
  support: NodeRef[];
  /** Readable form, e.g. "P1 + 2·P2". */
  text: string;
  /** P-invariants: Σ weight·M0(p), the constant weighted token sum of every reachable marking. */
  tokenSum?: number;
}

export interface InvariantSet {
  kind: "P" | "T";
  /** Minimal semi-positive invariants (one per minimal support, coefficients with gcd 1). */
  invariants: Invariant[];
  /** The computation stopped at its size limit; the list may be incomplete. */
  truncated: boolean;
  /** Every place (P) or transition (T) lies in the support of some invariant (CPI / CTI). */
  covered: boolean;
  /** Nodes not in any invariant. */
  uncovered: NodeRef[];
}

export interface InvariantResults {
  p: InvariantSet;
  t: InvariantSet;
  /** Covered by P-invariants. */
  cpi: boolean;
  /** Covered by T-invariants. */
  cti: boolean;
  /** A positive P-invariant exists (y·C = 0, y > 0): the same as CPI. Implies structural boundedness. */
  conservative: boolean;
  /** A positive T-invariant exists (C·x = 0, x > 0): the same as CTI. Necessary for live and bounded. */
  consistent: boolean;
}

/** A structural check. */
export interface Check {
  holds: boolean;
  /** Nodes that break the property or, for the has-… checks, that have the feature. */
  witnesses: NodeRef[];
  /** One sentence on why it holds or not. */
  reason: string;
}

/** Structural properties as Charlie names them. Weights are ignored by SM, SG, FC, EFC and ES. */
export interface StructuralProperties {
  /** PUR: no self-loops (read arcs count as self-loops). */
  pure: Check;
  /** ORD: every arc weight is 1. */
  ordinary: Check;
  /** HOM: all arcs leaving a place have the same weight. */
  homogeneous: Check;
  /** CSV: every transition adds as many tokens as it removes (the all-ones vector is a P-invariant). */
  conservative: Check;
  /** SCF: no two transitions share an input place. */
  staticConflictFree: Check;
  /** SM: every transition has exactly one input and one output place. */
  stateMachine: Check;
  /** SG / marked graph: every place has exactly one input and one output transition. */
  synchronisationGraph: Check;
  /** FC: a place with several output transitions is their only input place. */
  freeChoice: Check;
  /** EFC: places sharing an output transition have the same output transitions. */
  extendedFreeChoice: Check;
  /** ES (asymmetric choice): output transition sets of two places are disjoint or nested. */
  extendedSimple: Check;
  /** CON: the net graph is (weakly) connected. */
  connected: Check;
  /** SC: the net graph is strongly connected. */
  stronglyConnected: Check;
  /**
   * FT0: transitions without input places.
   * Konios (2015, §7.2.1) states the negation, "no input transition (FT0)", which is true exactly when `holds` is false.
   */
  inputTransitions: Check;
  /**
   * TF0: transitions without output places.
   * Konios (2015, §7.2.1) states the negation, "no output transition (TF0)", which is true exactly when `holds` is false.
   */
  outputTransitions: Check;
  /**
   * FP0: places without input transitions.
   * Konios (2015, §7.2.1) states the negation, "no input place (FP0)", which is true exactly when `holds` is false.
   */
  inputPlaces: Check;
  /**
   * PF0: places without output transitions.
   * Konios (2015, §7.2.1) states the negation, "no output place (PF0)", which is true exactly when `holds` is false.
   */
  outputPlaces: Check;
  /** Places or transitions without any arc. */
  isolatedNodes: Check;
  /** DC (the report's §4.2.5): some directed path returns to its start. Witnesses: one circuit's strongly connected component. */
  directedCircuits: Check;
  /** PDC (§4.2.7): a directed circuit whose places and transitions all have exactly one input and one output. */
  pureDirectedCircuits: Check;
}

export interface PlaceSet {
  places: NodeRef[];
  /** Holds at least one token under the initial marking. */
  marked: boolean;
}

export interface SiphonInfo extends PlaceSet {
  /** The largest trap inside the siphon. */
  maxTrap: NodeRef[];
  /** The largest trap inside the siphon is initially marked. */
  containsMarkedTrap: boolean;
}

export interface SiphonTrapResult {
  /** Minimal (non-empty) siphons: sets S with •S ⊆ S•. */
  siphons: SiphonInfo[];
  /** Minimal (non-empty) traps: sets Q with Q• ⊆ •Q. */
  traps: PlaceSet[];
  siphonsTruncated: boolean;
  trapsTruncated: boolean;
  /** Every minimal siphon contains an initially marked trap (DTP). */
  siphonTrapProperty: Status;
  /** Minimal siphons without a marked trap. */
  badSiphons: NodeRef[][];
}

export interface PlaceBound {
  place: NodeRef;
  /** Most tokens seen in any reachable marking; null = unbounded. */
  max: number | null;
  /** max is the exact bound (complete state space or proven); otherwise a lower bound or a P-invariant upper bound, see `source`. */
  exact: boolean;
  source: "statespace" | "coverability" | "invariants" | "partial";
}

interface DeadlockInfo {
  /** Shortest firing sequence from the initial marking to the first deadlock. */
  path: NodeRef[];
  /** Marked places of the dead marking by display name. */
  marking: Record<string, number>;
}

export interface BehaviourResult {
  /** "complete": the whole reachability graph was built; "truncated": maxStates reached; "skipped": not explored. */
  exploration: "complete" | "truncated" | "skipped";
  /** Why it was skipped, if it was. */
  reason?: string;
  maxStates: number;
  states: number;
  edges: number;
  bounded: Status;
  /** 1-bounded. */
  safe: Status;
  /** Overall bound k (largest place bound); null if unbounded or unknown. */
  k: number | null;
  placeBounds: PlaceBound[];
  unboundedPlaces: NodeRef[];
  /** Karp–Miller coverability graph, built only when exploration was truncated. */
  coverability?: { nodes: number; complete: boolean };
  deadlockFree: Status;
  /** Number of dead (deadlock) states found. */
  deadlocks: number;
  firstDeadlock?: DeadlockInfo;
  /** Transitions that never fire ("yes" = some exist). */
  hasDeadTransitions: Status;
  deadTransitions: NodeRef[];
  live: Status;
  /** Transitions that are live (L4). Empty unless the state space is complete. */
  liveTransitions: NodeRef[];
  /** Transitions that are not live, with the complete state space or a found deadlock. */
  nonLiveTransitions: NodeRef[];
  /** The initial marking can be reached again from every reachable marking. */
  reversible: Status;
  /** Some marking is reachable from every reachable marking. */
  hasHomeStates: Status;
  /** Number of home states (states of the only terminal strongly connected component). */
  homeStates: number;
  terminalComponents: number;
  /**
   * DCF (Charlie; Konios 2015, §7.2.2.2): no reachable marking enables two transitions such that
   * firing one disables the other. "no" comes with `dynamicConflict`.
   */
  dynamicConflictFree: Status;
  /** The first dynamic conflict found: firing transitions[0] at `marking` disables transitions[1]. */
  dynamicConflict?: {
    /** Shortest firing sequence from the initial marking to the conflict. */
    path: NodeRef[];
    marking: Record<string, number>;
    transitions: [NodeRef, NodeRef];
  };
}

/** Liveness of one transition at the levels of Murata (1989) and the report's §5.2.1.3. */
export interface TransitionLiveness {
  transition: NodeRef;
  /**
   * L1..L4: levels[0] = L1 (can fire at least once), levels[1] = L2 (can fire k times for every k),
   * levels[2] = L3 (appears infinitely often in some infinite firing sequence), levels[3] = L4 (live).
   */
  levels: [Status, Status, Status, Status];
  /** The exact level k (Lk holds and L(k+1) does not; 0 = dead), or null when not decided. */
  level: 0 | 1 | 2 | 3 | 4 | null;
  /** The highest level proven (0 when not even L1 is proven). */
  atLeast: 0 | 1 | 2 | 3 | 4;
}

/** Synchronic distance d(a, b) = max |#a(σ) − #b(σ)| over firing sequences σ from reachable markings. */
export interface SynchronicPair {
  /** Indices into AnalysisReport.transitions. */
  a: number;
  b: number;
  /**
   * The distance when finite and known: exact, or (exact false) a lower bound from the explored part
   * of the state space. Null when infinite, or when the coverability graph cannot decide it.
   */
  value: number | null;
  infinite: boolean;
  /** value (or infinite) is proven. */
  exact: boolean;
}

/**
 * Behavioural properties beyond the basic ones, from the complete reachability graph or, for
 * unbounded nets, the Karp–Miller coverability graph (the report's §5.2.1, Murata 1989 §4).
 */
export interface DynamicsResult {
  /**
   * What decided the results: the complete reachability graph, the coverability graph (unbounded
   * nets), only the explored part of the state space with theorems ("partial"), or nothing ("skipped").
   */
  source: "reachability" | "coverability" | "partial" | "skipped";
  /** Liveness level of each transition (same order as AnalysisReport.transitions). */
  transitions: TransitionLiveness[];
  /** The net is Lk-live (every transition is), k = 1..4: net[0] = L1, …, net[3] = L4 (= live). */
  netLevels: [Status, Status, Status, Status];
  /** Some firing sequence contains every transition infinitely often. */
  repetitive: Status;
  /** Some infinite firing sequence exists (some transition occurs infinitely often). */
  partiallyRepetitive: Status;
  /** Some reachable marking is reproduced by a firing sequence containing every transition. */
  consistent: Status;
  /** Some reachable marking is reproduced by a non-empty firing sequence. */
  partiallyConsistent: Status;
  /** A positive weighting w exists with wᵀM = wᵀM0 for every reachable marking M. */
  conservative: Status;
  /** Such a weighting (per place id, smallest integers), when found. */
  conservationWeights: Record<string, number> | null;
  /** The plain token sum never changes. */
  strictlyConservative: Status;
  /** Persistent (report §5.2.1.7): an enabled transition is disabled only by its own firing. The same as DCF. */
  persistent: Status;
  /** Every pair of transitions is in a B-fair relation (bounded fairness). */
  bFair: Status;
  /** Classes of the B-fair relation (an equivalence relation), when every pair is decided. */
  bFairClasses: NodeRef[][] | null;
  /** A pair that is not B-fair: the first can fire arbitrarily often while the second does not fire. */
  unfairPair?: [NodeRef, NodeRef];
  /** Every infinite firing sequence contains every transition infinitely often. */
  unconditionallyFair: Status;
  /** Synchronic distances of all pairs (a < b), when within the limits; see `synchronicNote`. */
  synchronic: SynchronicPair[];
  synchronicNote: string;
}

/** Matrix-based (structural) properties of the report's §5.2.2, decided exactly over the rationals. */
export interface StructuralAnalysis {
  /** Rank r of the incidence matrix; rankExact false: computed modulo primes (very large matrices). */
  rank: number;
  rankExact: boolean;
  /** n − r: dimension of the space of rational P-invariants (yᵀC = 0). */
  pInvariantDimension: number;
  /** m − r: dimension of the space of rational T-invariants (C·x = 0). */
  tInvariantDimension: number;
  /** Bounded for every initial marking: ∃ y > 0 with yᵀC ≤ 0. */
  structurallyBounded: Status;
  /** Places that some initial marking makes unbounded (∄ y ≥ 0 with y(p) > 0, yᵀC ≤ 0). */
  structurallyUnboundedPlaces: NodeRef[];
  /** y > 0 with yᵀC ≤ 0, per place id, when structurally bounded. */
  boundednessWitness: Record<string, number> | null;
  /** ∃ y > 0 with yᵀC = 0 (the same as CPI). */
  structurallyConservative: Status;
  /** ∃ y ≥ 0, y ≠ 0 with yᵀC = 0 (a P-invariant net). */
  partiallyStructurallyConservative: Status;
  /** ∃ x > 0 with C·x ≥ 0. */
  structurallyRepetitive: Status;
  /** ∃ x ≥ 0, x ≠ 0 with C·x ≥ 0. */
  partiallyStructurallyRepetitive: Status;
  /** Transitions in no x ≥ 0 with C·x ≥ 0 (none can fire infinitely often from any marking). */
  nonRepetitiveTransitions: NodeRef[];
  /** ∃ x > 0 with C·x = 0 (the same as CTI). */
  structurallyConsistent: Status;
  /** ∃ x ≥ 0, x ≠ 0 with C·x = 0 (a T-invariant net). */
  partiallyStructurallyConsistent: Status;
  /** Some initial marking makes the net live. */
  structurallyLive: Status;
  /** rank(C) = number of places, the report's necessary condition for complete controllability. */
  controllabilityRank: Status;
  /** Every marking can be reached from every marking. */
  completelyControllable: Status;
  /** B-fair for every initial marking. */
  structurallyBFair: Status;
  /** Classes of the structural B-fair relation, when decided. */
  structuralBFairClasses: NodeRef[][] | null;
}

/** Answer of {@link checkReachability}: is a marking reachable from the initial one? */
export interface ReachabilityCheck {
  /** The exact answer when the state space was explored completely (or the marking was found). */
  reachable: Status;
  /** Shortest firing sequence to the marking, when it was found. */
  path?: NodeRef[];
  /**
   * The state equation M = M0 + C·x, x ≥ 0 (a necessary condition): "none" proves the marking
   * unreachable; "integer" gives a firing count vector (inconclusive: the marking may still be
   * unreachable); "rational" has only a fractional solution; "unknown" at the limits; "n/a" when
   * the equation does not hold for the net (reset arcs, marking-dependent weights, modulo nets).
   */
  stateEquation: "none" | "integer" | "rational" | "unknown" | "n/a";
  /** A firing count vector solving the state equation (transition id → count). */
  firingCount?: Record<string, number>;
  /** One plain-English paragraph. */
  explanation: string;
}

export type SummaryGroup = "structure" | "invariants" | "siphons" | "behaviour";

export interface SummaryItem {
  /** Stable key, e.g. "live", "freeChoice". */
  key: string;
  group: SummaryGroup;
  /** The property as a yes/no question's subject, e.g. "Live", "Has dead transitions". */
  label: string;
  /** One short sentence saying what the property means. */
  description: string;
  status: Status;
  /** One line on why, e.g. "No: transition t3 can never fire". */
  explanation: string;
  /** Element ids to highlight in the editor. */
  elementIds: string[];
  /** Charlie's and Konios's (2015, §7.2) abbreviation, e.g. "FT0", "k-B", "DCF", "DSt", "DTr". */
  abbreviation?: string;
}

export interface AnalysisReport {
  net: {
    name: string;
    netClass: NetClass;
    /** The coloured net was unfolded and the unfolded net analysed. */
    unfolded: boolean;
    places: number;
    transitions: number;
    arcs: number;
  };
  /** Limits of the analysis (unsupported arcs, ignored parts, truncation). */
  warnings: string[];
  /** Errors in the net that prevent (part of) the analysis. */
  errors: string[];
  places: NodeRef[];
  transitions: NodeRef[];
  incidence: IncidenceMatrix;
  invariants: InvariantResults;
  structure: StructuralProperties;
  siphonsTraps: SiphonTrapResult;
  behaviour: BehaviourResult;
  /** Liveness levels, repetitivity, consistency, conservation, fairness and synchronic distances. */
  dynamics: DynamicsResult;
  /** Structural boundedness, repetitivity, consistency, conservation, liveness, controllability, B-fairness. */
  algebra: StructuralAnalysis;
  summary: SummaryItem[];
}

export interface AnalysisOptions {
  /** State limit of the reachability graph (default 100000). The coverability graph uses the same limit. */
  maxStates?: number;
  /** Abort the analysis; analyseNet then throws an Error named "AbortError". */
  signal?: AbortSignal;
}
