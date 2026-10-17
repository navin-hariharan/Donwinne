/**
 * @packageDocumentation
 * Fault tree analysis for Donwinne (Snoopy's "faultTree" and "extendedFaultTree" classes).
 *
 * - {@link validateFaultTree}: structural checks.
 * - {@link minimalCutSets} / {@link minimalPathSets}: BDD + ZDD (Rauzy's algorithm).
 * - {@link topEventProbability}, {@link topEventAnalysis}, {@link importanceMeasures},
 *   {@link reliabilityCurve}: exact BDD evaluation for static trees; Monte Carlo
 *   ({@link simulateFaultTree}) for trees with PAND and SPARE gates.
 * - {@link faultTreeToPetriNet}: translation to a stochastic Petri net.
 * - {@link importDnf} / {@link exportDnf}: DNF text.
 * - {@link layoutFaultTree}: tidy top-down layout.
 */
export {
  FTError,
  DYNAMIC_GATES,
  EVENT_LEAVES,
  isGate,
  isLeaf,
  orderedInputs,
  constantsEnv,
  eventData,
  eventProbability,
  validateFaultTree,
  buildModel,
  basicEventProbabilities,
} from "./structure";
export type { EventData, LogicKind, LogicNode, FTModel } from "./structure";
export { Bdd, Zdd } from "./bdd";
export {
  compileFaultTree,
  minimalCutSets,
  minimalPathSets,
  topEventProbability,
  topEventAnalysis,
  rareEventApproximation,
  minCutUpperBound,
  importanceMeasures,
  reliabilityCurve,
} from "./analysis";
export type {
  CompiledFaultTree,
  CutSetOptions,
  ProbabilityOptions,
  TopEventResult,
  ImportanceMeasure,
  CurveOptions,
  ReliabilityCurve,
} from "./analysis";
export { simulateFaultTree, mulberry32 } from "./montecarlo";
export type { SimulationOptions, SimulationResult } from "./montecarlo";
export { faultTreeToPetriNet } from "./topn";
export { importDnf, parseDnf, exportDnf } from "./dnf";
export type { DnfImportOptions, Literal } from "./dnf";
export { layoutFaultTree } from "./layout";
export type { LayoutOptions } from "./layout";
