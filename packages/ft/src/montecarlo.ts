// Discrete-event Monte Carlo simulation of (extended, dynamic) fault trees.
//
// Each basic event alternates between working and failed with exponential failure (λ) and repair
// (μ) times; events given only a probability are failed from time 0 with that probability.
// After every event, gates are re-evaluated bottom-up:
//   PAND  — failed iff all inputs are failed and their latest failure times are in input order
//           (ties count as in order). After a repair the order is re-checked with new failure times.
//   SPARE — cold spares: only the unit in use ages. When it becomes unavailable, the first
//           available unit (primary first) is switched in; the gate is failed when no unit is
//           available. Units are not switched back when the primary is repaired.
//   FDEP  — a dependent event counts as failed while any of its triggers is failed.

import { Net } from "@pns/core";
import { FTError, FTModel, buildModel } from "./structure";

/** A small deterministic PRNG (mulberry32), returning numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Result of a Monte Carlo simulation. */
export interface SimulationResult {
  times: number[];
  /** Fraction of runs in which the top event was failed at each time. */
  probability: number[];
  /** Standard error √(p(1−p)/runs) of each estimate. */
  standardError: number[];
  runs: number;
}

/** Options for {@link simulateFaultTree}. */
export interface SimulationOptions {
  /** Observation times (hours); or give `time`. */
  times?: number[];
  time?: number;
  /** Number of independent runs (default 20000). */
  runs?: number;
  /** PRNG seed (default 1): the same seed gives the same result. */
  seed?: number;
}

/**
 * Estimate the probability that the top event is failed at the given times by Monte Carlo
 * simulation. Handles every gate including PAND, SPARE (cold) and FDEP, with or without repair.
 * Deterministic for a given seed.
 */
export function simulateFaultTree(net: Net, opts: SimulationOptions): SimulationResult {
  const times = opts.times ?? (opts.time !== undefined ? [opts.time] : undefined);
  if (!times || !times.length) throw new FTError("Give the times at which to observe the fault tree");
  return simulateModel(buildModel(net), times, opts);
}

/** @internal Simulation on a prepared model. */
export function simulateModel(m: FTModel, timesIn: number[], opts: { runs?: number; seed?: number }): SimulationResult {
  const runs = Math.max(1, Math.floor(opts.runs ?? 20000));
  const rng = mulberry32(opts.seed ?? 1);
  const ids = m.order;
  const N = ids.length;
  const idx = new Map(ids.map((id, i) => [id, i]));
  const kind = ids.map((id) => m.nodes.get(id)!.kind);
  const inputs = ids.map((id) => m.nodes.get(id)!.inputs.map((x) => idx.get(x)!));
  const kOf = ids.map((id) => m.nodes.get(id)!.k ?? 1);
  const units = ids.map((id) => (m.nodes.get(id)!.units ?? []).map((x) => idx.get(x)!));
  const controlled = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (kind[i] === "spare") for (const u of units[i]) controlled[u] = 1;
  const lam = new Float64Array(N);
  const mu = new Float64Array(N);
  const pFixed = new Float64Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    if (kind[i] !== "basic") continue;
    const d = m.data.get(ids[i])!;
    if (d.failureRate !== undefined) {
      lam[i] = d.failureRate;
      mu[i] = d.repairRate !== undefined && d.repairRate > 0 ? d.repairRate : 0;
    } else pFixed[i] = d.probability ?? 0;
  }
  const order = timesIn.map((t, i) => ({ t, i })).sort((a, b) => a.t - b.t);
  const hits = new Float64Array(timesIn.length);
  const top = idx.get(m.top)!;

  const failed = new Uint8Array(N);
  const failTime = new Float64Array(N);
  const next = new Float64Array(N);
  const inUse = new Uint8Array(N);
  const active = new Int32Array(N);
  const exp = (rate: number) => (rate > 0 ? -Math.log(1 - rng()) / rate : Infinity);
  const basics: number[] = [];
  for (let i = 0; i < N; i++) if (kind[i] === "basic") basics.push(i);

  const evaluate = (now: number) => {
    for (let i = 0; i < N; i++) {
      const ins = inputs[i];
      let v: boolean;
      switch (kind[i]) {
        case "basic":
          continue;
        case "or":
          v = ins.some((x) => failed[x]);
          break;
        case "and":
          v = ins.every((x) => failed[x]);
          break;
        case "xor":
          v = ins.filter((x) => failed[x]).length === 1;
          break;
        case "not":
          v = !failed[ins[0]];
          break;
        case "kofn":
          v = ins.filter((x) => failed[x]).length >= kOf[i];
          break;
        case "pand": {
          v = ins.every((x) => failed[x]);
          for (let j = 1; v && j < ins.length; j++) if (failTime[ins[j - 1]] > failTime[ins[j]]) v = false;
          break;
        }
        case "spare": {
          const us = units[i];
          if (failed[ins[active[i]]] || !inUse[us[active[i]]]) {
            const j = ins.findIndex((x) => !failed[x]);
            if (j >= 0) {
              inUse[us[active[i]]] = 0;
              active[i] = j;
              const u = us[j];
              if (!inUse[u]) {
                inUse[u] = 1;
                if (!failed[u] && pFixed[u] < 0) next[u] = now + exp(lam[u]);
              }
            }
          }
          v = ins.every((x) => failed[x]);
          break;
        }
      }
      const b = v ? 1 : 0;
      if (b !== failed[i]) {
        failed[i] = b;
        if (b) failTime[i] = now;
      }
    }
  };

  for (let r = 0; r < runs; r++) {
    failed.fill(0);
    failTime.fill(0);
    inUse.fill(0);
    active.fill(0);
    for (const b of basics) {
      if (pFixed[b] >= 0) {
        failed[b] = rng() < pFixed[b] ? 1 : 0;
        next[b] = Infinity;
      } else next[b] = controlled[b] ? Infinity : exp(lam[b]);
    }
    evaluate(0);
    let k = 0;
    for (;;) {
      let tn = Infinity;
      let who = -1;
      for (const b of basics)
        if (next[b] < tn) {
          tn = next[b];
          who = b;
        }
      while (k < order.length && order[k].t < tn) {
        if (failed[top]) hits[order[k].i]++;
        k++;
      }
      if (k >= order.length || who < 0) break;
      if (failed[who]) {
        failed[who] = 0;
        next[who] = !controlled[who] || inUse[who] ? tn + exp(lam[who]) : Infinity;
      } else {
        failed[who] = 1;
        failTime[who] = tn;
        next[who] = tn + exp(mu[who]);
      }
      evaluate(tn);
    }
  }
  const probability = Array.from(hits, (h) => h / runs);
  return {
    times: [...timesIn],
    probability,
    standardError: probability.map((p) => Math.sqrt((p * (1 - p)) / runs)),
    runs,
  };
}
