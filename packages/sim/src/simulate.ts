// Public simulation entry points: crisp, averaged, coloured (via unfolding) and fuzzy simulation.

import { Net, isColoured } from "@pns/core";
import { Engine, EngineConfig, RunOutput } from "./engine";
import { SimModel, SimulationError, alphaCut, buildModel, parameterize, peakValue } from "./model";
import { OdeSolverName } from "./ode";
import { MersenneTwister, randomSeed } from "./prng";
import { UnfoldMapping, unfold } from "./unfold";

export type SolverName = "gillespie" | OdeSolverName;

export interface SimulationOptions {
  /** First output time (default 0). The simulation itself always starts at time 0. */
  start?: number;
  /** Last output time and end of the simulation. */
  end: number;
  /** Number of evenly spaced output points including start and end (default 101). */
  points?: number;
  /** Stochastic and hybrid nets: number of runs to average (default 1). */
  runs?: number;
  /** Keep every run's trajectories in `trace.runs` (crisp simulations only). */
  keepRuns?: boolean;
  /** Seed for the Mersenne Twister; the same seed gives the same result. Random when omitted. */
  seed?: number;
  /**
   * "gillespie" for the stochastic part (always used for stochastic transitions); the ODE solver for
   * continuous transitions: "rk45" (default, Dormand–Prince adaptive), "euler", "rk4" (fixed step)
   * or "rosenbrock" (ROS2, adaptive, for stiff systems).
   */
  solver?: SolverName;
  /** Absolute and relative tolerances of the adaptive solvers (default 1e-8, 1e-6). */
  atol?: number;
  rtol?: number;
  /** Step size of the fixed-step solvers and initial step of adaptive ones (default: output spacing / 10). */
  step?: number;
  /** Maximum number of solver steps and discrete events per run (default 10,000,000). */
  maxSteps?: number;
  /** Called with the completed fraction (0..1) now and then. */
  onProgress?: (fraction: number) => void;
  /** Abort the simulation; it then throws an Error named "AbortError". */
  signal?: AbortSignal;
  /** Fuzzy nets: membership levels to compute bands for (default 0, 0.25, 0.5, 0.75, 1). */
  alphaLevels?: number[];
  /** Fuzzy nets: parameter samples per alpha level (default 10; corners of the cut are used first). */
  samplesPerLevel?: number;
  /** Coloured nets: series per coloured place (sum over colours), per colour, or both (default). */
  colouredOutput?: "aggregate" | "unfolded" | "both";
}

/** Fuzzy band of a series at one membership level. */
export interface FuzzyBand {
  alpha: number;
  lower: number[];
  upper: number[];
}

export interface Series {
  /** Place or transition id (of the unfolded node for per-colour series); "observer:<name>" for observers. */
  id: string;
  name: string;
  kind: "place" | "transition" | "observer";
  /**
   * marking for places; firings per output interval (discrete transitions) or flux (continuous);
   * value for observers.
   */
  measure: "marking" | "firings" | "flux" | "value";
  /** Observers: whether the expression is over place markings or transition rates. */
  observerKind?: "place" | "transition";
  values: number[];
  /** Fuzzy simulation: min/max envelopes per alpha level; `values` is the peak (alpha = 1) trajectory. */
  bands?: FuzzyBand[];
  /** Coloured nets, per-colour series: the coloured node's id and the colour. */
  colouredId?: string;
  colour?: string;
  /** Coloured nets: true for the sum over all colours of a coloured node. */
  aggregate?: boolean;
}

export interface Trace {
  times: number[];
  /** One series per place and transition (and per colour in coloured nets). */
  series: Series[];
  /**
   * One series per observer (Declarations.observers), in declaration order, with kind "observer".
   * Place observers evaluate their expression over the markings; transition observers over the
   * transitions' current rates (stochastic hazard, continuous flux; immediate, deterministic and
   * scheduled transitions count their firings in the output interval). Averaged over runs like
   * `series`; fuzzy simulations add bands. Coloured nets: names refer to the coloured nodes (sums
   * over their colours).
   */
  observers: Series[];
  /** Individual runs when `keepRuns` was set. */
  runs?: { series: Series[]; observers: Series[] }[];
  seed: number;
  /** True when maxSteps stopped a run early; later values are NaN. */
  truncated: boolean;
  warnings: string[];
  stats: { runs: number; simulations: number; steps: number; events: number; ms: number };
}

/** Run a simulation to completion. Blocking; use simulateAsync in a UI thread or to make abort work. */
export function simulate(net: Net, options: SimulationOptions): Trace {
  const g = simulateSteps(net, options);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

/**
 * Run a simulation, returning to the event loop every few milliseconds so that progress can be
 * shown and an AbortSignal can stop it (in a Web Worker or the main thread).
 */
export async function simulateAsync(net: Net, options: SimulationOptions, sliceMs = 20): Promise<Trace> {
  const g = simulateSteps(net, options);
  let last = Date.now();
  let r = g.next();
  while (!r.done) {
    if (Date.now() - last > sliceMs) {
      await new Promise((res) => setTimeout(res, 0));
      last = Date.now();
    }
    r = g.next();
  }
  return r.value;
}

function abortError(): Error {
  const e = new Error("The simulation was aborted");
  e.name = "AbortError";
  return e;
}

/** Output time points. */
export function outputTimes(start: number, end: number, points: number): Float64Array {
  const t = new Float64Array(points);
  const dt = (end - start) / (points - 1);
  for (let i = 0; i < points; i++) t[i] = i === points - 1 ? end : start + i * dt;
  return t;
}

interface Shaper {
  /** Turn one run's raw output into series values (one array per output series). */
  shape(out: RunOutput): Float64Array[];
  meta: Omit<Series, "values">[];
}

function makeShaper(model: SimModel, mapping: UnfoldMapping | null, mode: "aggregate" | "unfolded" | "both"): Shaper {
  const meta: Omit<Series, "values">[] = [];
  const pick: ((o: RunOutput) => Float64Array)[] = [];
  const slotOfPlace = new Map(model.places.map((p) => [p.id, p.slot]));
  const tIndex = new Map(model.transitions.map((t) => [t.id, t.index]));
  const measureOf = (i: number) => (model.transitions[i].kind === "continuous" ? "flux" : "firings") as Series["measure"];
  const sumOf = (arrs: (o: RunOutput) => Float64Array[]) => (o: RunOutput) => {
    const parts = arrs(o);
    const r = new Float64Array(parts[0]?.length ?? o.slots[0]?.length ?? 0);
    for (const a of parts) for (let i = 0; i < r.length; i++) r[i] += a[i];
    return r;
  };
  if (!mapping) {
    for (const p of model.slotPlace) {
      meta.push({ id: p.id, name: p.name, kind: "place", measure: "marking" });
      pick.push((o) => o.slots[p.slot]);
    }
    for (const t of model.transitions) {
      meta.push({ id: t.id, name: t.name, kind: "transition", measure: measureOf(t.index) });
      pick.push((o) => o.trans[t.index]);
    }
  } else {
    const seenSlot = new Set<number>();
    const placeGroups = new Map<string, { name: string; slots: number[] }>();
    for (const up of mapping.places) {
      const slot = slotOfPlace.get(up.id);
      if (slot === undefined) continue;
      const g = placeGroups.get(up.placeId) ?? { name: up.placeName, slots: [] };
      if (!g.slots.includes(slot)) g.slots.push(slot);
      placeGroups.set(up.placeId, g);
      if (mode !== "aggregate" && !seenSlot.has(slot)) {
        seenSlot.add(slot);
        meta.push({ id: up.id, name: up.name, kind: "place", measure: "marking", colouredId: up.placeId, colour: up.colourText });
        pick.push((o) => o.slots[slot]);
      }
    }
    const transGroups = new Map<string, { name: string; idx: number[] }>();
    for (const ut of mapping.transitions) {
      const i = tIndex.get(ut.id);
      if (i === undefined) continue;
      const g = transGroups.get(ut.transitionId) ?? { name: ut.transitionName, idx: [] };
      g.idx.push(i);
      transGroups.set(ut.transitionId, g);
      if (mode !== "aggregate") {
        const colour = Object.values(ut.binding).length ? ut.name.slice(ut.transitionName.length + 1) : undefined;
        meta.push({ id: ut.id, name: ut.name, kind: "transition", measure: measureOf(i), colouredId: ut.transitionId, colour });
        pick.push((o) => o.trans[i]);
      }
    }
    if (mode !== "unfolded") {
      const aggP: typeof meta = [];
      const aggPick: typeof pick = [];
      for (const [id, g] of placeGroups) {
        aggP.push({ id, name: g.name, kind: "place", measure: "marking", aggregate: true });
        aggPick.push(sumOf((o) => g.slots.map((s) => o.slots[s])));
      }
      for (const [id, g] of transGroups) {
        aggP.push({ id, name: g.name, kind: "transition", measure: measureOf(g.idx[0]), aggregate: true });
        aggPick.push(sumOf((o) => g.idx.map((i) => o.trans[i])));
      }
      meta.unshift(...aggP);
      pick.unshift(...aggPick);
    }
  }
  model.observers.forEach((ob, j) => {
    meta.push({ id: `observer:${ob.name}`, name: ob.name, kind: "observer", measure: "value", observerKind: ob.kind });
    pick.push((o) => o.observers[j]);
  });
  return { meta, shape: (o) => pick.map((f) => f(o)) };
}

/** The generator behind simulate/simulateAsync; yields progress fractions. */
export function* simulateSteps(net: Net, options: SimulationOptions): Generator<number, Trace, void> {
  const t0 = Date.now();
  const start = options.start ?? 0;
  const end = options.end;
  const points = Math.round(options.points ?? 101);
  const runs = Math.max(1, Math.round(options.runs ?? 1));
  if (!(Number.isFinite(end) && end > start && start >= 0)) throw new SimulationError("The simulation interval must satisfy 0 <= start < end");
  if (!(points >= 2)) throw new SimulationError("At least two output points are needed");
  const seed = (options.seed ?? randomSeed()) >>> 0;
  const rng = new MersenneTwister(seed);

  let mapping: UnfoldMapping | null = null;
  let simNet = net;
  if (isColoured(net.netClass)) {
    const u = unfold(net);
    simNet = u.net;
    mapping = u.mapping;
  }
  const model = buildModel(simNet);
  const times = outputTimes(start, end, points);
  const solver: OdeSolverName = options.solver && options.solver !== "gillespie" ? options.solver : "rk45";
  const cfg: EngineConfig = {
    times,
    solver,
    atol: options.atol ?? 1e-8,
    rtol: options.rtol ?? 1e-6,
    step: options.step ?? (end - start) / (points - 1) / 10,
    maxSteps: options.maxSteps ?? 10_000_000,
  };
  if (!(cfg.step > 0)) throw new SimulationError("The step size must be positive");
  const engine = new Engine(model, cfg);
  const shaper = makeShaper(model, mapping, options.colouredOutput ?? "both");
  const deterministicOnly = engine.stoch.length === 0 && engine.imm.length <= 1;
  const runsPerSample = deterministicOnly ? 1 : runs;

  // Parameter samples: one crisp sample, or alpha-cut samples for fuzzy nets.
  const fuzzy = model.fuzzy;
  const levels = [...new Set((options.alphaLevels ?? [0, 0.25, 0.5, 0.75, 1]).filter((a) => a >= 0 && a <= 1))].sort((a, b) => b - a);
  if (fuzzy.length && !levels.length) throw new SimulationError("At least one alpha level between 0 and 1 is needed");
  const sampleRng = new MersenneTwister((seed ^ 0x9e3779b9) >>> 0);
  const perLevel = Math.max(1, Math.round(options.samplesPerLevel ?? 10));
  const plan: { alpha: number; samples: number[][] }[] = fuzzy.length
    ? levels.map((alpha) => ({ alpha, samples: alphaSamples(fuzzy.map((p) => alphaCut(p, alpha)), perLevel, sampleRng) }))
    : [];
  const totalSims = 1 + plan.reduce((s, l) => s + l.samples.length, 0);
  const totalUnits = totalSims * runsPerSample;
  let doneUnits = 0;
  let steps = 0;
  let events = 0;
  let truncated = false;

  function* crisp(values: number[] | undefined, keep: boolean): Generator<number, { mean: Float64Array[]; runs?: Float64Array[][] }, void> {
    const x0 = parameterize(model, { fuzzyValues: values, start, end });
    let mean: Float64Array[] | null = null;
    const kept: Float64Array[][] = [];
    for (let r = 0; r < runsPerSample; r++) {
      const g = engine.run(x0, rng);
      let it = g.next();
      while (!it.done) {
        if (options.signal?.aborted) throw abortError();
        const frac = (doneUnits + Math.min(1, it.value / end)) / totalUnits;
        options.onProgress?.(frac);
        yield frac;
        it = g.next();
      }
      const out = it.value;
      steps += out.steps;
      events += out.events;
      truncated ||= out.truncated;
      const shaped = shaper.shape(out);
      if (keep) kept.push(shaped.map((a) => Float64Array.from(a)));
      if (!mean) mean = shaped.map((a) => Float64Array.from(a));
      else for (let i = 0; i < mean.length; i++) for (let j = 0; j < points; j++) mean[i][j] += shaped[i][j];
      doneUnits++;
      if (options.signal?.aborted) throw abortError();
      options.onProgress?.(doneUnits / totalUnits);
      yield doneUnits / totalUnits;
    }
    if (runsPerSample > 1) for (const a of mean!) for (let j = 0; j < points; j++) a[j] /= runsPerSample;
    return { mean: mean!, runs: keep ? kept : undefined };
  }

  const peak = yield* crisp(fuzzy.length ? fuzzy.map(peakValue) : undefined, !!options.keepRuns && !fuzzy.length);
  const toArr = (a: Float64Array) => Array.from(a);
  const all: Series[] = shaper.meta.map((m, i) => ({ ...m, values: toArr(peak.mean[i]) }));

  if (fuzzy.length) {
    const nS = all.length;
    let lower = peak.mean.map((a) => Float64Array.from(a));
    let upper = peak.mean.map((a) => Float64Array.from(a));
    const bands: FuzzyBand[][] = all.map(() => []);
    for (const level of plan) {
      for (const sample of level.samples) {
        const r = yield* crisp(sample, false);
        for (let i = 0; i < nS; i++)
          for (let j = 0; j < points; j++) {
            const v = r.mean[i][j];
            if (v < lower[i][j]) lower[i][j] = v;
            if (v > upper[i][j]) upper[i][j] = v;
          }
      }
      // Levels go from alpha = 1 down; lower levels include the higher levels' envelopes (nesting).
      for (let i = 0; i < nS; i++) bands[i].push({ alpha: level.alpha, lower: toArr(lower[i]), upper: toArr(upper[i]) });
      lower = lower.map((a) => Float64Array.from(a));
      upper = upper.map((a) => Float64Array.from(a));
    }
    all.forEach((s, i) => (s.bands = bands[i].sort((a, b) => a.alpha - b.alpha)));
  }

  options.onProgress?.(1);
  const isObs = (s: Series) => s.kind === "observer";
  return {
    times: toArr(times),
    series: all.filter((s) => !isObs(s)),
    observers: all.filter(isObs),
    runs: peak.runs?.map((r) => {
      const rs = shaper.meta.map((m, i) => ({ ...m, values: toArr(r[i]) }));
      return { series: rs.filter((s) => !isObs(s)), observers: rs.filter(isObs) };
    }),
    seed,
    truncated,
    warnings: model.warnings,
    stats: { runs: runsPerSample, simulations: totalSims, steps, events, ms: Date.now() - t0 },
  };
}

/**
 * Parameter combinations inside an alpha-cut (a box): the centre, then the corners while they fit,
 * then uniformly random points. A degenerate box gives just its centre.
 */
export function alphaSamples(box: [number, number][], count: number, rng: MersenneTwister): number[][] {
  const centre = box.map(([a, b]) => (a + b) / 2);
  const free = box.map(([a, b], i) => (b > a ? i : -1)).filter((i) => i >= 0);
  if (!free.length) return [centre];
  const out: number[][] = [centre];
  const nCorners = free.length <= 20 ? 2 ** free.length : Infinity;
  if (nCorners <= count - 1) {
    for (let mask = 0; mask < nCorners; mask++) {
      const v = centre.slice();
      free.forEach((i, bit) => (v[i] = mask & (1 << bit) ? box[i][1] : box[i][0]));
      out.push(v);
    }
  } else {
    // Not all corners fit: the two extreme corners, then random points.
    out.push(box.map(([a]) => a), box.map(([, b]) => b));
  }
  while (out.length < count) out.push(box.map(([a, b]) => a + (b - a) * rng.random()));
  return out.slice(0, Math.max(count, 1));
}
