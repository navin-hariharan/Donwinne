// @pns/sim: quantitative simulation of stochastic, continuous, hybrid, coloured and fuzzy
// Petri nets (Snoopy semantics), the timed token game, reachability graphs and CSV export.
// Pure TypeScript without runtime dependencies besides @pns/core: runs in Node and Web Workers.

export { simulate, simulateAsync, simulateSteps, outputTimes, alphaSamples } from "./simulate";
export type { SimulationOptions, Trace, Series, FuzzyBand, SolverName } from "./simulate";
export { unfold, uncolouredClass, colourIdent } from "./unfold";
export type { UnfoldResult, UnfoldMapping, UnfoldedPlace, UnfoldedTransition, UnfoldOptions } from "./unfold";
export { buildModel, parameterize, classifyRate, alphaCut, peakValue, SimulationError } from "./model";
export type { SimModel, SimPlace, SimTransition, SimArc, SimObserver, FuzzyParam } from "./model";
export { Engine } from "./engine";
export type { EngineConfig, RunOutput } from "./engine";
export { RateEnv, rateFunction, binomial, RATE_FUNCTIONS } from "./rates";
export type { RateContext, RateArc } from "./rates";
export { makeStepper, luFactor, luSolve } from "./ode";
export type { OdeSolverName, Stepper, Rhs } from "./ode";
export { MersenneTwister, randomSeed } from "./prng";
export { timedInit, timedEnabled, timedDelay, timedFire } from "./timed";
export type { TimedState, TimedEnabled, TimedTransitionInfo } from "./timed";
export { reachabilityGraph } from "./reachability";
export type { ReachabilityGraph, RGState, RGEdge } from "./reachability";
export { traceToCsv } from "./csv";
export type { CsvOptions } from "./csv";
export { printExpr, mapExpr, literal } from "./exprutil";
