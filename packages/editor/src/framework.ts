// The modelling and verification framework of Konios, Khan, Garcia-Constantino and Lopez-Nava,
// "A Modular Framework for Modelling and Verification of Activities in Ambient Intelligent
// Systems" (HCII 2023, LNCS 14029, pp. 503-530), Fig. 1, run end to end on a net:
//
//   APN N (built by forward and backward composition of basic and one step nets)
//     → T-APN φ(N) (the construction, Def. 10; behaviourally equivalent to N)
//     → unfolded P/T net (the unfolding of the coloured T-APN, Sec. 4.2)
//     → slice (abstract slicing by default, Sec. 5) for the places the properties mention
//   and the size of the state space each stage needs (Sec. 6, Figs 11-12): single steps
//   (interleaving) and maximal steps, with and without stubborn-set reduction, plus the verdict of
//   every property on the full net and on the slice.
//   → "Property fulfilled?": yes when every property holds; no comes with a counterexample (a firing
//   sequence of the model, or of the slice when only the slice could be checked), which is how the
//   figure's "no" arrow leads back to the modelling stage.
//
// Pure functions of the net: the dialog in Analysis.tsx shows the result, the tests check it.

import { Net, isAmbient, isColoured } from "@pns/core";
import {
  CtlError,
  CtlResult,
  FormulaCriterion,
  NetSlice,
  PTNet,
  SlicingAlgorithm,
  TraceStep,
  TransitionSystem,
  checkCtl,
  criterionFromCtl,
  interleavingSystem,
  sliceNet,
  sliceToNet,
  stepSystem,
  stubbornSystem,
  toPTNet,
  transitionSystemFromStepGraph,
} from "@pns/analysis";
import { ConstructionResult, checkEquivalence, concurrentReachabilityGraph, constructTapn } from "@pns/apn";

/** One state-space measurement. */
interface SpaceSize {
  states: number;
  edges: number;
  /** False when the limit cut the exploration off (the counts are then lower bounds). */
  complete: boolean;
}

/** The constructions measured for each stage (Figs 11 and 12 of the chapter). */
export type SpaceKind = "single" | "singleStubborn" | "maximal";

export const SPACE_LABEL: Record<SpaceKind, string> = {
  single: "Single steps",
  singleStubborn: "Single steps, stubborn sets",
  maximal: "Maximal steps",
};

interface FrameworkStage {
  id: "apn" | "tapn" | "unfolded" | "sliced";
  label: string;
  /** The stage's net (the slice as an uncoloured net for "sliced"). */
  net: Net;
  places: number;
  transitions: number;
  arcs: number;
  sizes: Partial<Record<SpaceKind, SpaceSize | { error: string }>>;
}

/** A witness or counterexample of a property, ready to show and replay. */
export interface FrameworkTrace {
  kind: "witness" | "counterexample";
  /**
   * "model": a firing sequence of the net the framework ran on (for an APN, of φ(N), whose
   * transitions carry the APN's names, so it replays on the APN). "slice": a firing sequence of the
   * sliced net, whose transition ids are those of the net "Open the slice" opens.
   */
  on: "model" | "slice";
  explanation: string;
  steps: TraceStep[];
  /**
   * The path can be replayed in the token game. False for a maximal-step path of a net that is not
   * ambient: the token game fires one transition at a time there, and a step need not split up.
   */
  replayable: boolean;
  /** Marked places of the last state, by name. */
  last: Record<string, number>;
  loopsBackTo?: number;
  endsInDeadlock?: boolean;
}

export type Fulfilled = "yes" | "no" | "unknown";

/**
 * How the properties are checked (Sec. 6 of the chapter verifies under both): "single" steps
 * (interleaving: one transition at a time), or "maximal" steps (only steps of maximal concurrency;
 * for ambient nets the maximal steps of their concurrent reachability graph).
 */
export type CheckSemantics = "single" | "maximal";

interface FormulaVerdict {
  formula: string;
  /** Verdict on the whole (unfolded) net; "unknown" when its state space was cut off. */
  full: "true" | "false" | "unknown" | "error";
  /** How the whole net was checked: its full graph, or (AG/EF formulas) its stubborn-set reduced graph. */
  fullBy: "full graph" | "stubborn sets" | "-";
  slice: "true" | "false" | "unknown" | "error";
  /** States of the graph each verdict was computed on. */
  fullStates: number;
  sliceStates: number;
  /** The verdicts agree (or one of them is unknown). */
  agree: boolean;
  /**
   * Fig. 1's "Property fulfilled?": the verdict on the whole net, or the slice's verdict when the
   * whole net could not be checked and the slicing algorithm preserves this kind of property.
   */
  fulfilled: Fulfilled;
  decidedBy: "whole net" | "slice" | "-";
  /** Why the property fails (counterexample) or holds (witness), where CTL gives a path. */
  trace?: FrameworkTrace;
  notes: string[];
}

export interface FrameworkResult {
  stages: FrameworkStage[];
  /** The construction φ(N), when the input was an APN. */
  construction?: ConstructionResult;
  /** APN and T-APN have isomorphic concurrent reachability graphs (checked up to the limit). */
  equivalence?: "equivalent" | "not equivalent" | "unknown";
  /** The slicing criterion (place names of the unfolded net). */
  criterion: string[];
  slice: NetSlice;
  verdicts: FormulaVerdict[];
  /** Fig. 1's decision for all properties together: "no" as soon as one fails. */
  fulfilled: Fulfilled;
  /** The semantics the verdicts were computed under. */
  semantics: CheckSemantics;
  notes: string[];
}

interface FrameworkOptions {
  /** CTL formulas over the unfolded names (p, p[c], t<x=c>); their places form the criterion. */
  formulas: string[];
  /** Extra criterion places, by name. */
  criterion?: string[];
  /** Slicing algorithm (default "abstract", as in the chapter). */
  algorithm?: SlicingAlgorithm;
  /** State limit for every state space (default 200000). */
  maxStates?: number;
  /** Check the equivalence of APN and T-APN (default true; limited by maxStates). */
  equivalence?: boolean;
  /** Which state spaces to measure (default all three). */
  spaces?: SpaceKind[];
  /** Semantics of the verdicts (default "single"). */
  semantics?: CheckSemantics;
  signal?: AbortSignal;
}

const size = (ts: TransitionSystem): SpaceSize => ({ states: ts.markings.length, edges: ts.edgeTo.length, complete: ts.complete });

function measure(fn: () => SpaceSize): SpaceSize | { error: string } {
  try {
    return fn();
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return { error: (e as Error).message };
  }
}

function ptSizes(pt: PTNet, spaces: SpaceKind[], maxStates: number, visible: number[], signal?: AbortSignal): FrameworkStage["sizes"] {
  const sizes: FrameworkStage["sizes"] = {};
  if (spaces.includes("single")) sizes.single = measure(() => size(interleavingSystem(pt, { maxStates, signal })));
  if (spaces.includes("singleStubborn")) sizes.singleStubborn = measure(() => size(stubbornSystem(pt, { maxStates, signal, visible })));
  if (spaces.includes("maximal")) sizes.maximal = measure(() => size(stepSystem(pt, { maxStates, signal })));
  return sizes;
}

function crgSizes(net: Net, spaces: SpaceKind[], maxStates: number, signal?: AbortSignal): FrameworkStage["sizes"] {
  const sizes: FrameworkStage["sizes"] = {};
  if (spaces.includes("maximal"))
    sizes.maximal = measure(() => {
      const g = concurrentReachabilityGraph(net, { maximalOnly: true, maxStates, maxEdges: maxStates * 50, signal });
      return { states: g.states.length, edges: g.edges.length, complete: g.complete };
    });
  return sizes;
}

/**
 * Whether the slice's verdict of a formula is the whole net's verdict (survey Table 3): the
 * abstract and CTL*-X slices keep CTL*-X properties of the criterion places, APNSlicing keeps
 * LTL-X ones and safety slicing keeps AG/EF of state formulas. Next-time, deadlock and
 * fireable(…) atoms depend on transitions a slice may drop or merge, so those never carry over.
 */
export function slicePreserves(algorithm: SlicingAlgorithm, f: FormulaCriterion, semantics: CheckSemantics = "single"): boolean {
  if (f.usesNext || f.usesDeadlock || f.transitions.length) return false;
  // The preservation results are for interleaving semantics. A slice drops and merges transitions,
  // which changes which steps are maximal, so under maximal steps no slice stands in for the net.
  if (semantics === "maximal") return false;
  switch (algorithm) {
    case "abstract":
    case "abstractParallel":
    case "basic":
      return true;
    case "ctlStarX": // CTL*-X under weak fairness: without fairness only the safety fragment is sure.
    case "apnSlicing": // LTL-X: AG of a state formula, and EF as its negation.
    case "safety":
      return f.safety;
    default:
      return false;
  }
}

function toTrace(res: CtlResult, on: FrameworkTrace["on"], replayable = true): FrameworkTrace | undefined {
  const t = res.trace;
  if (!t) return undefined;
  // A slice trace replays on the opened slice, whose transitions keep the unfolded ids.
  const steps = on === "slice" ? t.steps.map((st) => ({ ...st, transitions: st.transitions.map((r) => ({ ...r, elementIds: [r.id], baseName: undefined, colour: undefined })) })) : t.steps;
  return { kind: t.kind, on, explanation: t.explanation, steps, replayable, last: t.markings.at(-1) ?? {}, loopsBackTo: t.loopsBackTo, endsInDeadlock: t.endsInDeadlock };
}

const known = (v: string): v is "true" | "false" => v === "true" || v === "false";

const counts = (net: Net) => ({
  places: net.places.filter((p) => !p.coarse).length,
  transitions: net.transitions.filter((t) => !t.coarse).length,
  arcs: net.arcs.length,
});

/**
 * Run the framework of Fig. 1 on a net. An APN goes through every stage; a T-APN starts at the
 * construction's result; any other net is unfolded (if coloured) and sliced. Throws if the net has
 * errors, a formula does not parse or names an unknown place, or the construction fails.
 */
export function runFramework(net: Net, opts: FrameworkOptions): FrameworkResult {
  const maxStates = opts.maxStates ?? 200_000;
  const spaces = opts.spaces ?? ["single", "singleStubborn", "maximal"];
  const signal = opts.signal;
  const notes: string[] = [];
  const stages: FrameworkStage[] = [];
  let construction: ConstructionResult | undefined;
  let equivalence: FrameworkResult["equivalence"];
  let coloured = net;

  // 1. The APN and its T-APN.
  if (net.netClass === "apn") {
    construction = constructTapn(net);
    // φ is defined for composite step nets (built from building blocks). For any other APN the
    // T-APN it gives need not behave like N, so the pipeline goes on with N itself.
    const usable = construction.problems.length === 0;
    if (usable) coloured = construction.net;
    else
      notes.push(
        `The construction φ applies to composite step nets (Def. 13), and this APN is not one (${construction.problems[0].message}${construction.problems.length > 1 ? `, and ${construction.problems.length - 1} more` : ""}). The pipeline continues with the APN itself.`,
      );
    const apnPt = toPTNet(net);
    stages.push({
      id: "apn",
      label: "APN N",
      net,
      ...counts(net),
      sizes: {
        ...(spaces.includes("single") ? { single: measure(() => size(interleavingSystem(apnPt, { maxStates, signal }))) } : {}),
        ...crgSizes(net, spaces, maxStates, signal),
      },
    });
    if (usable && (opts.equivalence ?? true)) {
      try {
        equivalence = checkEquivalence(net, { tapn: coloured, maxStates: Math.min(maxStates, 50_000), signal }).verdict;
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        notes.push(`Equivalence of N and φ(N) not checked: ${(e as Error).message}`);
      }
    }
  }

  // 2. The unfolded P/T net and the criterion.
  const pt = toPTNet(coloured);
  if (pt.errors.length) throw new Error(`The net has errors: ${pt.errors[0]}`);
  const criterion = new Set(opts.criterion ?? []);
  const formulaInfo = opts.formulas.map((f) => {
    const c = criterionFromCtl(f);
    c.places.forEach((p) => criterion.add(p));
    if (c.usesNext) notes.push(`"${f}" uses EX or AX: slicing preserves CTL*-X, so its verdict on the slice may differ.`);
    if (c.usesDeadlock) notes.push(`"${f}" uses deadlock, which depends on every transition: its verdict on the slice may differ.`);
    return c;
  });
  const slice = sliceNet(pt, { places: [...criterion], transitions: [...new Set(formulaInfo.flatMap((c) => c.transitions))] }, { algorithm: opts.algorithm ?? "abstract", signal });
  const visible = slice.criterion.places;

  if (isAmbient(coloured.netClass)) {
    stages.push({
      id: "tapn",
      label: coloured.netClass === "tapn" ? "T-APN φ(N)" : "Ambient net",
      net: coloured,
      ...counts(coloured),
      sizes: { ...ptSizes(pt, spaces.filter((s) => s !== "maximal"), maxStates, visible, signal), ...crgSizes(coloured, spaces, maxStates, signal) },
    });
  }
  stages.push({
    id: "unfolded",
    label: isColoured(coloured.netClass) ? "Unfolded net" : "Net",
    net: pt.work ?? coloured,
    places: pt.places.length,
    transitions: pt.transitions.length,
    arcs: pt.arcs.length,
    sizes: ptSizes(pt, spaces, maxStates, visible, signal),
  });
  const sliced = sliceToNet(slice, `${coloured.name} (slice)`);
  stages.push({
    id: "sliced",
    label: "Sliced net",
    net: sliced,
    places: slice.stats.places,
    transitions: slice.stats.transitions,
    arcs: slice.stats.arcs,
    sizes: ptSizes(slice.pt, spaces, maxStates, slice.criterion.places.map((p) => slice.placeMap[p]).filter((p) => p >= 0), signal),
  });

  // 3. The properties on the whole net and on the slice, under the chosen semantics.
  const semantics = opts.semantics ?? "single";
  const ambient = isAmbient(coloured.netClass);
  let fullTs: TransitionSystem | undefined;
  const fullSystem = () =>
    (fullTs ??=
      semantics === "single"
        ? interleavingSystem(pt, { maxStates, signal })
        : ambient
          ? transitionSystemFromStepGraph(coloured, concurrentReachabilityGraph(coloured, { maximalOnly: true, maxStates, maxEdges: maxStates * 50, signal }))
          : stepSystem(pt, { maxStates, signal }));
  let sliceTsCache: TransitionSystem | Error | undefined;
  const sliceSystem = () => {
    sliceTsCache ??= (() => {
      try {
        return semantics === "single" ? interleavingSystem(slice.pt, { maxStates, signal }) : stepSystem(slice.pt, { maxStates, signal });
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        return e as Error;
      }
    })();
    if (sliceTsCache instanceof Error) throw sliceTsCache;
    return sliceTsCache;
  };
  const algorithm = opts.algorithm ?? "abstract";
  const verdicts: FormulaVerdict[] = opts.formulas.map((formula, i) => {
    const vnotes: string[] = [];
    let full: FormulaVerdict["full"] = "error";
    let fullBy: FormulaVerdict["fullBy"] = "-";
    let fullStates = 0;
    let fullRes: CtlResult | undefined;
    let sl: FormulaVerdict["slice"] = "error";
    let sliceRes: CtlResult | undefined;
    let sliceStates = 0;
    try {
      const ts = fullSystem();
      fullBy = "full graph";
      fullStates = ts.markings.length;
      fullRes = checkCtl(ts, formula, { signal });
      // AG and EF of state formulas keep their verdicts on a stubborn-set graph with the formula's
      // places visible. That graph is a subgraph of the full one, so its paths are firing sequences.
      // Stubborn sets reduce the interleaving graph only.
      if (fullRes.status === "unknown" && semantics === "single" && formulaInfo[i].safety && !formulaInfo[i].usesDeadlock && !formulaInfo[i].transitions.length) {
        const red = stubbornSystem(pt, { maxStates, signal, visible: formulaInfo[i].places });
        if (red.complete) {
          fullBy = "stubborn sets";
          fullStates = red.markings.length;
          fullRes = checkCtl(red, formula, { signal });
        }
      }
      full = fullRes.status;
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      vnotes.push(`Whole net: ${(e as Error).message}`);
    }
    try {
      const sliceTs = sliceSystem();
      sliceStates = sliceTs.markings.length;
      sliceRes = checkCtl(sliceTs, formula, { signal, trace: !known(full) });
      sl = sliceRes.status;
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      vnotes.push(`Slice: ${e instanceof CtlError ? e.message : (e as Error).message}`);
    }
    let fulfilled: Fulfilled = "unknown";
    let decidedBy: FormulaVerdict["decidedBy"] = "-";
    let trace: FrameworkTrace | undefined;
    if (known(full)) {
      fulfilled = full === "true" ? "yes" : "no";
      decidedBy = "whole net";
      // A step of an ambient net replays as a step; elsewhere the token game fires single transitions.
      trace = fullRes && toTrace(fullRes, "model", semantics === "single" || ambient);
    } else if (known(sl)) {
      if (slicePreserves(algorithm, formulaInfo[i], semantics)) {
        fulfilled = sl === "true" ? "yes" : "no";
        decidedBy = "slice";
        trace = sliceRes && toTrace(sliceRes, "slice", semantics === "single");
        vnotes.push("The whole net could not be checked within the limit; the slice decides, since the slicing algorithm preserves this property.");
      } else
        vnotes.push(
          semantics === "maximal"
            ? "The whole net could not be checked within the limit. Slicing changes which steps are maximal, so under maximal steps the slice's verdict does not carry over."
            : "The whole net could not be checked within the limit, and this slicing algorithm does not preserve this property, so the slice's verdict does not carry over.",
        );
    }
    return { formula, full, fullBy, slice: sl, fullStates, sliceStates, agree: !(known(full) && known(sl)) || full === sl, fulfilled, decidedBy, trace, notes: vnotes };
  });
  notes.push(...slice.notes);
  const fulfilled: Fulfilled = verdicts.some((v) => v.fulfilled === "no") ? "no" : verdicts.every((v) => v.fulfilled === "yes") ? "yes" : "unknown";
  return { stages, construction, equivalence, criterion: slice.criterion.places.map((p) => pt.places[p].name), slice, verdicts, fulfilled, semantics, notes };
}

/** The properties φ1 and φ2 of the chapter's Sec. 5 for the net of its Fig. 7 (thesis Fig. 4.10). */
export const CHAPTER_PROPERTIES = [
  "AG((p2[b] > 0 & p1[b] == 0 & p3[b_bar] == 0) -> p3[b] > 0)",
  "EF((p3[b] > 0 & p3[w] > 0) | (p3[b_bar] > 0 & p3[w_bar] > 0))",
];
