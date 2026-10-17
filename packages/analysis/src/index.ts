/**
 * @packageDocumentation
 * Charlie-style qualitative analysis of Petri nets for Donwinne.
 *
 * - {@link analyseNet}: everything below in one JSON-friendly {@link AnalysisReport} with a summary.
 * - {@link toPTNet}: the P/T view analysed (logical places merged, coloured nets unfolded,
 *   hybrid nets reduced to their discrete part).
 * - {@link incidenceMatrix}, {@link computeInvariants}, {@link minimalInvariants}: incidence matrix and
 *   minimal semi-positive P/T-invariants (Farkas / Martinez–Silva).
 * - {@link structuralProperties}: PUR, ORD, HOM, CSV, SCF, SM, SG, FC, EFC, ES, CON, SC, FT0, TF0, FP0, PF0.
 * - {@link siphonsAndTraps}, {@link minimalSets}: minimal siphons and traps, siphon-trap property.
 * - {@link analyseBehaviour}, {@link explore}, {@link karpMiller}: state space, boundedness, deadlocks,
 *   dead and live transitions, reversibility, home states, coverability, dynamic conflict freeness (DCF).
 *
 * Verification of ambient systems after Konios (2015, ch. 7):
 * - {@link buildTransitionSystem}, {@link interleavingSystem}, {@link transitionSystemFromGraph}: the
 *   state space as a generic {@link TransitionSystem} (interleaving reachability graph, or any graph
 *   built elsewhere such as a concurrent reachability graph with step labels).
 * - {@link transitionSystemFromStepGraph}: the concurrent reachability graph of an APN or T-APN (or
 *   the graph of its maximal steps) under the unfolded names, or colour-blind (base names).
 * - {@link colourBlindProjection}: the uncoloured net Snoopy runs when colours are ignored, the
 *   reading of Konios (2015, ch. 7); `buildTransitionSystem(net, { projection: "colourBlind" })`.
 * - {@link stepSystem}: maximal-step (or all-step) reachability graphs of P/T nets;
 *   `buildTransitionSystem(net, { semantics: "maximalSteps" })`.
 * - {@link parseCtl}, {@link ctlProblems}, {@link formatCtl}: Charlie's CTL syntax with `p[c]` for the
 *   tokens of colour c on a coloured place; errors carry line, column and expected tokens.
 * - {@link checkCtl}, {@link CtlChecker}: CTL model checking with satisfying states and a witness or
 *   counterexample path to replay in the token game. On a state space cut off at its limit the check
 *   is three-valued: "true" or "false" only when the unexplored part cannot change the verdict.
 * - {@link PROPERTY_TEMPLATES}, {@link instantiateTemplate}: the thesis's ambient, general and
 *   fault-tolerance properties as parameterised formulas.
 * - {@link findPaths}, {@link compareAdvicePaths}: shortest (or all) firing sequences to a target with
 *   required and forbidden transitions; following versus ignoring advices.
 * - {@link faultTolerance}, {@link injectFaults}: wrong advices caused by extra database tokens.
 */
export { analyseNet } from "./analyse";
export { toPTNet, structuralMatrices } from "./ptnet";
export type { PTNet, PTArc, PTArcKind } from "./ptnet";
export { incidenceMatrix, computeInvariants, minimalInvariants } from "./invariants";
export type { FarkasOptions } from "./invariants";
export { structuralProperties, netGraph, scc } from "./structure";
export type { Graph } from "./structure";
export { siphonsAndTraps, minimalSets, largestTrap } from "./siphons";
export type { MinimalSetsResult } from "./siphons";
export { analyseBehaviour, structurallyFaithful, dynamicConflicts } from "./behaviour";
export type { BehaviourContext, BehaviourOptions, BehaviourNotes } from "./behaviour";
export { explore, karpMiller, coverabilityApplies, terminalComponents, pathTo, Firer } from "./statespace";
export type { StateSpace, Coverability, TerminalAnalysis } from "./statespace";
export type * from "./types";

export { buildTransitionSystem, interleavingSystem, transitionSystemFromGraph, markingOf, labelText, deadStates, openStates, predecessors, stateCount } from "./ts";
export type { TransitionSystem, TransitionSystemOptions, BuildTransitionSystemOptions, ColourView, GraphInput, Predecessors } from "./ts";
export { transitionSystemFromStepGraph } from "./stepgraph";
export type { StepGraphLike, StepElement, StepGraphOptions } from "./stepgraph";
export { parseCtl, formatCtl, bindCtl, ctlProblems, placeRef, resolvePlace, resolveTransition, isStateFormula, CtlError } from "./ctl";
export type { CtlFormula, CtlTerm, CompareOp, UnaryTemporal, Span, BoundFormula, BoundTerm, CtlVocabulary } from "./ctl";
export { checkCtl, CtlChecker } from "./check";
export type { CtlOptions, CtlResult, CtlTrace, TraceStep, DeadlockSemantics, CtlBounds } from "./check";
export { PROPERTY_TEMPLATES, instantiateTemplate, TemplateError } from "./templates";
export type {
  PropertyTemplate,
  TemplateArgs,
  TemplateCategory,
  TemplateField,
  TemplateFieldKind,
  TemplateFormula,
  TemplateParameter,
  TemplateRules,
  TemplateValue,
} from "./templates";
export { findPaths, compareAdvicePaths, firingPath } from "./paths";
export type { PathQuery, PathResult, FiringPath, AdviceQuery, AdviceComparison } from "./paths";
export { faultTolerance, injectFaults } from "./fault";
export type { Fault, FaultToleranceQuery, FaultToleranceReport, FaultSummary } from "./fault";
export { colourBlindProjection } from "./projection";
export type { Projection, ProjectionOptions } from "./projection";
export { stepSystem } from "./steps";
export type { StepSystemOptions } from "./steps";
