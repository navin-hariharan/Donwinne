// Snoopy's rate functions and the evaluation environment for rates, weights and delays.

import { ArcKind, EvalEnv, ExprError, UserFunction, Value, num } from "@pns/core";

/** Arc as seen by a rate function: the slot it touches and its current weight. */
export interface RateArc {
  slot: number;
  kind: ArcKind;
}

/** What a rate function needs to know about the transition it belongs to. */
export interface RateContext {
  name: string;
  /** True when the transition is continuous (ODE flux); false for stochastic hazards. */
  continuous: boolean;
  /** Pre-places taking part in mass action: normal and read input arcs. */
  maPre: RateArc[];
}

/**
 * Generalised binomial coefficient C(m, w) = m (m-1) ... (m-w+1) / w!, 0 if m < w.
 * Real m is allowed (continuous places in hybrid nets); non-integer w falls back to m^w / Γ(w+1)≈m^w.
 */
export function binomial(m: number, w: number): number {
  if (w <= 0) return 1;
  if (!Number.isInteger(w)) return Math.pow(Math.max(m, 0), w);
  let r = 1;
  for (let i = 0; i < w; i++) {
    const f = m - i;
    if (f <= 0) return 0;
    r = (r * f) / (i + 1);
  }
  return r;
}

/**
 * Evaluation environment for rate functions. Place names evaluate to their current marking,
 * then constants, enum colour values and the simulation interval constants `_SimStart`/`_SimEnd`.
 * The fields are mutated by the simulator before each evaluation (no allocation per step).
 */
export class RateEnv implements EvalEnv {
  /** Current marking, indexed by slot. */
  x: Float64Array = new Float64Array(0);
  /** Transition whose rate is being evaluated (null for markings, delays outside transitions). */
  ctx: RateContext | null = null;
  /** Arc weight lookup for the current transition. */
  weight: (a: RateArc) => number = () => 1;
  /** User functions (Declarations.functions). */
  functions: Map<string, UserFunction> = new Map();
  constructor(
    public slotByName: Map<string, number>,
    public constants: Map<string, Value>,
    public enums: Set<string>,
  ) {}

  lookup(name: string): Value | undefined {
    const s = this.slotByName.get(name);
    if (s !== undefined) return this.x[s];
    const c = this.constants.get(name);
    if (c !== undefined) return c;
    if (this.enums.has(name) || name === "dot") return name;
    return undefined;
  }

  call(name: string, args: Value[]): Value | undefined {
    return rateFunction(this, name, args);
  }
}

function needCtx(env: RateEnv, fn: string): RateContext {
  if (!env.ctx) throw new ExprError(`${fn} can only be used in a transition's rate`);
  return env.ctx;
}

/** The special functions available in rates (beyond the core built-ins such as sin, pow or ln). */
export function rateFunction(env: RateEnv, name: string, args: Value[]): Value | undefined {
  switch (name) {
    case "MassAction":
    case "BioMassAction": {
      const ctx = needCtx(env, name);
      let r = num(args[0] ?? 1);
      for (const a of ctx.maPre) {
        const m = env.x[a.slot];
        const w = env.weight(a);
        r *= ctx.continuous ? Math.pow(Math.max(m, 0), w) : binomial(m, w);
      }
      return r;
    }
    case "BioLevelInterpretation": {
      const ctx = needCtx(env, name);
      const k = num(args[0] ?? 1);
      const N = num(args[1] ?? 1);
      if (N <= 0) throw new ExprError("BioLevelInterpretation needs a positive number of levels");
      let r = k * N;
      for (const a of ctx.maPre) r *= Math.pow(Math.max(env.x[a.slot], 0) / N, env.weight(a));
      return r;
    }
    case "MichaelisMenten": {
      const ctx = needCtx(env, name);
      const vmax = num(args[0]);
      const km = num(args[1]);
      let s: number;
      if (args.length > 2) s = num(args[2]);
      else {
        const sub = ctx.maPre.find((a) => a.kind === "normal");
        s = sub ? Math.max(env.x[sub.slot], 0) : 0;
      }
      return km + s === 0 ? 0 : (vmax * s) / (km + s);
    }
    // Firing-type functions evaluate to their main argument when used inside an expression.
    case "ImmediateFiring":
    case "TimedFiring":
    case "FixedTimedFiring_Single":
      return num(args[0] ?? 1);
    case "FixedTimedFiring_Periodic":
      return num(args[0] ?? 0);
    case "binomial":
      return binomial(num(args[0]), num(args[1]));
  }
  return undefined;
}

/** Names of the rate functions understood by the simulator, for editor completion. */
export const RATE_FUNCTIONS = [
  "MassAction",
  "BioMassAction",
  "BioLevelInterpretation",
  "MichaelisMenten",
  "ImmediateFiring",
  "TimedFiring",
  "FixedTimedFiring_Single",
  "FixedTimedFiring_Periodic",
  "binomial",
] as const;
