// Qualitative and quantitative analysis of static fault trees with BDDs.

import { Net } from "@pns/core";
import { Bdd, Zdd } from "./bdd";
import { FTError, FTModel, buildModel, modelProbabilities } from "./structure";
import { simulateModel } from "./montecarlo";

/** A fault tree compiled to a BDD. */
export interface CompiledFaultTree {
  model: FTModel;
  bdd: Bdd;
  /** BDD of the top event. */
  root: number;
  /** BDD variable index → basic event id (the model's depth-first order). */
  variables: string[];
  /** Basic event id → BDD variable index. */
  index: Map<string, number>;
}

/**
 * Compile a fault tree to a BDD of its top event. Dynamic gates are read statically:
 * PAND and SPARE as AND (order and dormancy ignored); FDEP is exact (dependent ∨ trigger).
 * XOR means "exactly one input". NOT and XOR make the tree non-coherent; the BDD stays exact.
 */
export function compileFaultTree(netOrModel: Net | FTModel): CompiledFaultTree {
  const model = "order" in netOrModel ? netOrModel : buildModel(netOrModel);
  const variables = model.basics;
  const index = new Map(variables.map((b, i) => [b, i]));
  const bdd = new Bdd(variables.length);
  const f = new Map<string, number>();
  for (const id of model.order) {
    const n = model.nodes.get(id)!;
    const ins = n.inputs.map((i) => f.get(i)!);
    let r: number;
    switch (n.kind) {
      case "basic":
        r = bdd.variable(index.get(id)!);
        break;
      case "or":
        r = bdd.orAll(ins);
        break;
      case "and":
      case "pand":
      case "spare":
        r = bdd.andAll(ins);
        break;
      case "xor":
        r = bdd.exactlyOne(ins);
        break;
      case "not":
        r = bdd.not(ins[0]);
        break;
      case "kofn":
        r = bdd.atLeast(n.k ?? 1, ins);
        break;
    }
    f.set(id, r);
  }
  return { model, bdd, root: f.get(model.top)!, variables, index };
}

/** Options for cut set and path set enumeration. */
export interface CutSetOptions {
  /** Keep only sets with at most this many events. */
  maxOrder?: number;
  /** Return at most this many sets (the smallest first). */
  maxSets?: number;
}

function sortSets(sets: number[][], c: CompiledFaultTree): string[][] {
  const names = c.variables.map((v) => c.model.nodes.get(v)!.source.name);
  return sets
    .map((s) => [...s].sort((a, b) => names[a].localeCompare(names[b]) || a - b))
    .sort((a, b) => a.length - b.length || cmpArrays(a.map((i) => names[i]), b.map((i) => names[i])))
    .map((s) => s.map((i) => c.variables[i]));
}

function cmpArrays(a: string[], b: string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = a[i].localeCompare(b[i]);
    if (c) return c;
  }
  return a.length - b.length;
}

function solutions(c: CompiledFaultTree, f: number, opts: CutSetOptions): string[][] {
  const z = new Zdd(c.variables.length);
  const fam = c.bdd.minimalSolutions(f, z, opts.maxOrder ?? Infinity);
  return sortSets(z.sets(fam, opts.maxSets ?? Infinity), c);
}

/**
 * Minimal cut sets of the top event, as arrays of basic event ids, smallest first
 * (ties ordered by event names). Computed with Rauzy's BDD → ZDD algorithm, so large trees with
 * many cut sets are handled symbolically and only the returned sets are enumerated.
 * For non-coherent trees (NOT, XOR) this is the coherent approximation: negated events are dropped.
 */
export function minimalCutSets(net: Net | CompiledFaultTree, opts: CutSetOptions = {}): string[][] {
  const c = "bdd" in net ? net : compileFaultTree(net);
  return solutions(c, c.root, opts);
}

/**
 * Minimal path sets: minimal sets of basic events whose all working guarantees that the top
 * event does not occur (the minimal cut sets of the dual function).
 */
export function minimalPathSets(net: Net | CompiledFaultTree, opts: CutSetOptions = {}): string[][] {
  const c = "bdd" in net ? net : compileFaultTree(net);
  return solutions(c, c.bdd.dual(c.root), opts);
}

/** Options for probability analyses. */
export interface ProbabilityOptions {
  /** Mission time in hours. Undefined: steady state for repairable events, fixed probabilities otherwise. */
  time?: number;
  /**
   * How to treat PAND and SPARE gates: "auto" (default) simulates trees with dynamic gates by
   * Monte Carlo and solves static trees exactly with the BDD; "static" always uses the BDD
   * (dynamic gates read as AND); "monteCarlo" always simulates.
   */
  method?: "auto" | "static" | "monteCarlo";
  /** Monte Carlo runs (default 20000). */
  runs?: number;
  /** Monte Carlo seed (default 1). */
  seed?: number;
}

function probVector(c: CompiledFaultTree, time: number | undefined): number[] {
  const p = modelProbabilities(c.model, time);
  return c.variables.map((v) => p.get(v)!);
}

/** Result of {@link topEventAnalysis}. */
export interface TopEventResult {
  /** Probability that the top event has occurred (unavailability for repairable trees). */
  probability: number;
  method: "bdd" | "monteCarlo";
  /** Monte Carlo only. */
  standardError?: number;
  /** Rare-event approximation: Σ over minimal cut sets of Π p. */
  rareEvent: number;
  /** Min-cut upper bound: 1 − Π over minimal cut sets of (1 − Π p). */
  minCutUpperBound: number;
  minimalCutSets: string[][];
  /** Number of BDD nodes of the top event. */
  bddSize: number;
  dynamic: boolean;
}

function useMonteCarlo(c: CompiledFaultTree, opts: ProbabilityOptions): boolean {
  const method = opts.method ?? "auto";
  if (method === "monteCarlo" || (method === "auto" && c.model.dynamic)) {
    if (opts.time === undefined)
      throw new FTError("Monte Carlo simulation of a fault tree (needed for PAND and SPARE gates) needs a mission time");
    return true;
  }
  return false;
}

function approximations(sets: string[][], c: CompiledFaultTree, p: number[]) {
  let rare = 0;
  let notMcub = 1;
  for (const s of sets) {
    const q = s.reduce((a, id) => a * p[c.index.get(id)!], 1);
    rare += q;
    notMcub *= 1 - q;
  }
  return { rareEvent: rare, minCutUpperBound: 1 - notMcub };
}

/**
 * Probability of the top event. Static trees: exact, by Shannon decomposition over the BDD.
 * Trees with PAND or SPARE gates: Monte Carlo simulation (see {@link simulateFaultTree}), unless
 * `method: "static"`. Basic event probabilities follow {@link eventProbability}.
 */
export function topEventProbability(net: Net | CompiledFaultTree, opts: ProbabilityOptions = {}): number {
  const c = "bdd" in net ? net : compileFaultTree(net);
  if (useMonteCarlo(c, opts)) return simulateModel(c.model, [opts.time!], opts).probability[0];
  return c.bdd.probability(c.root, probVector(c, opts.time));
}

/** Top event probability together with the rare-event and min-cut upper bound approximations. */
export function topEventAnalysis(net: Net | CompiledFaultTree, opts: ProbabilityOptions = {}): TopEventResult {
  const c = "bdd" in net ? net : compileFaultTree(net);
  const p = probVector(c, opts.time);
  const sets = minimalCutSets(c);
  const approx = approximations(sets, c, p);
  const base = { ...approx, minimalCutSets: sets, bddSize: c.bdd.size(c.root), dynamic: c.model.dynamic };
  if (useMonteCarlo(c, opts)) {
    const r = simulateModel(c.model, [opts.time!], opts);
    return { ...base, probability: r.probability[0], standardError: r.standardError[0], method: "monteCarlo" };
  }
  return { ...base, probability: c.bdd.probability(c.root, p), method: "bdd" };
}

/** Rare-event approximation of the top event probability: Σ_cutsets Π p. */
export function rareEventApproximation(net: Net | CompiledFaultTree, opts: { time?: number } = {}): number {
  const c = "bdd" in net ? net : compileFaultTree(net);
  return approximations(minimalCutSets(c), c, probVector(c, opts.time)).rareEvent;
}

/** Min-cut upper bound of the top event probability: 1 − Π_cutsets (1 − Π p). */
export function minCutUpperBound(net: Net | CompiledFaultTree, opts: { time?: number } = {}): number {
  const c = "bdd" in net ? net : compileFaultTree(net);
  return approximations(minimalCutSets(c), c, probVector(c, opts.time)).minCutUpperBound;
}

/** Importance measures of one basic event. Q = top event probability, Q_i=1 / Q_i=0 = with p_i set to 1 / 0. */
export interface ImportanceMeasure {
  id: string;
  name: string;
  /** p_i, the event's probability. */
  probability: number;
  /** Birnbaum (marginal) importance: Q_i=1 − Q_i=0 = ∂Q/∂p_i. */
  birnbaum: number;
  /** Criticality importance: Birnbaum · p_i / Q. */
  criticality: number;
  /** Fussell–Vesely: (Q − Q_i=0)/Q, the fraction of the risk involving event i. */
  fussellVesely: number;
  /** Risk achievement worth: Q_i=1 / Q. */
  raw: number;
  /** Risk reduction worth: Q / Q_i=0 (Infinity when Q_i=0 = 0). */
  rrw: number;
}

/**
 * Importance measures of every basic event, computed exactly on the BDD (dynamic gates are read
 * statically). Sorted by Birnbaum importance, largest first. Ratios with Q = 0 are NaN.
 */
export function importanceMeasures(net: Net | CompiledFaultTree, opts: { time?: number } = {}): ImportanceMeasure[] {
  const c = "bdd" in net ? net : compileFaultTree(net);
  const p = probVector(c, opts.time);
  const nodes = c.bdd.reachable(c.root);
  const Q = c.bdd.probability(c.root, p, nodes);
  const out = c.variables.map((id, i): ImportanceMeasure => {
    const q = p.slice();
    q[i] = 1;
    const q1 = c.bdd.probability(c.root, q, nodes);
    q[i] = 0;
    const q0 = c.bdd.probability(c.root, q, nodes);
    const birnbaum = q1 - q0;
    return {
      id,
      name: c.model.nodes.get(id)!.source.name,
      probability: p[i],
      birnbaum,
      criticality: Q > 0 ? (birnbaum * p[i]) / Q : NaN,
      fussellVesely: Q > 0 ? (Q - q0) / Q : NaN,
      raw: Q > 0 ? q1 / Q : NaN,
      rrw: q0 > 0 ? Q / q0 : Q > 0 ? Infinity : NaN,
    };
  });
  return out.sort((a, b) => b.birnbaum - a.birnbaum || a.name.localeCompare(b.name));
}

/** Options for {@link reliabilityCurve}. */
export interface CurveOptions extends Omit<ProbabilityOptions, "time"> {
  /** Last time point (hours). */
  end: number;
  /** Number of time points (default 101), evenly spaced from `start` to `end`. */
  points?: number;
  /** First time point (default 0). */
  start?: number;
}

/** Top event probability over time; reliability = 1 − unreliability (availability for repairable trees). */
export interface ReliabilityCurve {
  times: number[];
  /** Probability that the top event has occurred at each time. */
  unreliability: number[];
  reliability: number[];
  /** Monte Carlo only: standard error at each time. */
  standardError?: number[];
  method: "bdd" | "monteCarlo";
}

/**
 * The top event probability at evenly spaced times. Static trees are evaluated exactly at each
 * time on one BDD; trees with dynamic gates are simulated once over the whole horizon.
 */
export function reliabilityCurve(net: Net | CompiledFaultTree, opts: CurveOptions): ReliabilityCurve {
  const c = "bdd" in net ? net : compileFaultTree(net);
  const n = Math.max(2, Math.floor(opts.points ?? 101));
  const start = opts.start ?? 0;
  if (!(opts.end > start)) throw new FTError("The end time must be after the start time");
  const times = Array.from({ length: n }, (_, i) => start + ((opts.end - start) * i) / (n - 1));
  if (useMonteCarlo(c, { ...opts, time: opts.end })) {
    const r = simulateModel(c.model, times, opts);
    return { times, unreliability: r.probability, reliability: r.probability.map((q) => 1 - q), standardError: r.standardError, method: "monteCarlo" };
  }
  const nodes = c.bdd.reachable(c.root);
  const q = times.map((t) => c.bdd.probability(c.root, probVector(c, t), nodes));
  return { times, unreliability: q, reliability: q.map((x) => 1 - x), method: "bdd" };
}
