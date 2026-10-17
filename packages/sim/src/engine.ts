// One simulation run of a SimModel: Gillespie's direct method for stochastic transitions,
// immediate/deterministic/scheduled transitions as discrete events, and an ODE solver for
// continuous transitions. In hybrid nets the stochastic hazard is integrated along with the
// ODEs (dG/dt = a0(x)) and a stochastic transition fires when G reaches an Exp(1) threshold.

import { EvalEnv, evaluate, num } from "@pns/core";
import { SimArc, SimModel, SimTransition, SimulationError } from "./model";
import { MersenneTwister } from "./prng";
import { OdeSolverName, Stepper, makeStepper } from "./ode";

export interface EngineConfig {
  /** Output time points (evenly spaced, at least two). */
  times: Float64Array;
  solver: OdeSolverName;
  atol: number;
  rtol: number;
  /** Step size for fixed-step solvers and the initial step of adaptive ones. */
  step: number;
  /** Maximum number of ODE steps plus discrete events per run. */
  maxSteps: number;
}

export interface RunOutput {
  /** Marking per slot at each output point. */
  slots: Float64Array[];
  /** Per transition: firings in (t[k-1], t[k]] for discrete transitions, flux at t[k] for continuous ones. */
  trans: Float64Array[];
  /** Per observer (SimModel.observers): its value at each output point. */
  observers: Float64Array[];
  steps: number;
  events: number;
  truncated: boolean;
  /** Simulation time reached (end time unless truncated). */
  reached: number;
}

const ZERO_TIME_LIMIT = 100_000;

export class Engine {
  readonly n: number;
  readonly G: number;
  readonly stoch: SimTransition[];
  readonly imm: SimTransition[];
  readonly det: SimTransition[];
  readonly sched: SimTransition[];
  readonly cont: SimTransition[];
  /** For each transition, the stochastic transitions whose propensity may change when it fires. */
  private readonly deps: Int32Array[];
  /** Stochastic transitions that read places changed by continuous transitions. */
  private readonly stochCont: SimTransition[];
  private readonly stochStatic: SimTransition[];
  /** Immediate/deterministic transitions that read places changed by continuous transitions. */
  private readonly watch: SimTransition[];
  private readonly props: Float64Array;
  private readonly timers: Float64Array;
  private readonly schedIdx: Int32Array;
  private readonly y: Float64Array;
  private readonly y1: Float64Array;
  private readonly yt: Float64Array;
  private readonly yhi: Float64Array;
  private readonly scratch: Float64Array;
  private readonly contActive: Int32Array;
  private readonly stepper: Stepper | null;
  private a0Static = 0;

  constructor(private readonly model: SimModel, private readonly cfg: EngineConfig) {
    const ts = model.transitions;
    this.n = model.slotCount;
    this.G = this.n;
    this.stoch = ts.filter((t) => t.kind === "stochastic");
    this.imm = ts.filter((t) => t.kind === "immediate");
    this.det = ts.filter((t) => t.kind === "deterministic");
    this.sched = ts.filter((t) => t.kind === "scheduled");
    this.cont = ts.filter((t) => t.kind === "continuous");
    const readers: number[][] = Array.from({ length: this.n }, () => []);
    for (const t of this.stoch) for (const s of t.reads) readers[s].push(t.index);
    this.deps = ts.map((t) => {
      const set = new Set<number>();
      for (const s of t.changes) for (const i of readers[s]) set.add(i);
      return Int32Array.from([...set].sort((a, b) => a - b));
    });
    const contChanged = new Uint8Array(this.n);
    for (const t of this.cont) for (const s of t.changes) contChanged[s] = 1;
    const readsCont = (t: SimTransition) => t.reads.some((s) => contChanged[s]);
    this.stochCont = this.stoch.filter(readsCont);
    this.stochStatic = this.stoch.filter((t) => !readsCont(t));
    this.watch = [...this.imm, ...this.det].filter(readsCont);
    this.props = new Float64Array(ts.length);
    this.timers = new Float64Array(ts.length);
    this.schedIdx = new Int32Array(ts.length);
    const nY = this.n + 1;
    this.y = new Float64Array(nY);
    this.y1 = new Float64Array(nY);
    this.yt = new Float64Array(nY);
    this.yhi = new Float64Array(nY);
    this.scratch = new Float64Array(Math.max(1, ...ts.map((t) => t.inputs.length + t.outputs.length)));
    const active: number[] = [];
    for (let s = 0; s < this.n; s++) if (contChanged[s]) active.push(s);
    this.contActive = Int32Array.from(active);
    if (this.cont.length) {
      const act = this.stoch.length ? [...active, this.G] : active;
      this.stepper = makeStepper(cfg.solver, nY, (yy, dy) => this.rhs(yy, dy), Int32Array.from(act), cfg.atol, cfg.rtol);
    } else this.stepper = null;
    const env = model.env;
    env.weight = (a) => this.w(a as SimArc);
  }

  // ---- evaluation helpers -------------------------------------------------

  private w(a: SimArc): number {
    if (!a.dynamic) return a.w;
    const v = num(evaluate(a.expr!, this.model.env));
    if (!(v >= 0)) throw new SimulationError(`An arc weight evaluated to ${v}`);
    return v;
  }

  private rate(t: SimTransition, x: Float64Array): number {
    const env = this.model.env;
    env.x = x;
    env.ctx = t;
    let v: number;
    try {
      v = num(evaluate(t.rate!, env));
    } catch (e) {
      throw new SimulationError(`${t.kind === "immediate" ? "Weight" : t.kind === "deterministic" ? "Delay" : "Rate"} of ${t.name}: ${(e as Error).message}`, t.id);
    }
    if (Number.isNaN(v)) throw new SimulationError(`Rate of ${t.name} is not a number`, t.id);
    return v;
  }

  /** Discrete enabling (stochastic, immediate, deterministic, scheduled transitions). */
  enabledDiscrete(t: SimTransition, x: Float64Array): boolean {
    const env = this.model.env;
    env.x = x;
    env.ctx = t;
    for (const a of t.inputs) {
      if (a.kind === "reset") continue;
      const v = x[a.slot];
      const w = this.w(a);
      switch (a.kind) {
        case "normal":
        case "read":
          if (v < w) return false;
          break;
        case "inhibitor":
          if (w > 0 && v >= w) return false;
          break;
        case "equal":
          if (Math.abs(v - w) > 1e-9) return false;
          break;
      }
    }
    if (t.capacitySlots.length) {
      const cap = this.model.capacity;
      for (const s of t.capacitySlots) {
        let v = x[s];
        for (const a of t.inputs) if (a.slot === s) v = a.kind === "reset" ? 0 : a.kind === "normal" ? v - this.w(a) : v;
        for (const a of t.outputs) if (a.slot === s) v += this.w(a);
        if (v > cap[s] + 1e-9) return false;
      }
    }
    return true;
  }

  /** Continuous enabling: continuous pre-places must be positive; test arcs act as thresholds. */
  enabledContinuous(t: SimTransition, x: Float64Array): boolean {
    const env = this.model.env;
    env.x = x;
    env.ctx = t;
    const sc = this.model.slotContinuous;
    for (const a of t.inputs) {
      if (a.kind === "reset") continue;
      const v = x[a.slot];
      const w = this.w(a);
      switch (a.kind) {
        case "normal":
          if (sc[a.slot] ? v <= 0 : v < w) return false;
          break;
        case "read":
          if (v < w) return false;
          break;
        case "inhibitor":
          if (w > 0 && v >= w) return false;
          break;
        case "equal":
          if (Math.abs(v - w) > 1e-9) return false;
          break;
      }
    }
    return true;
  }

  propensity(t: SimTransition, x: Float64Array): number {
    if (!this.enabledDiscrete(t, x)) return 0;
    const r = this.rate(t, x);
    return r > 0 && Number.isFinite(r) ? r : r === Infinity ? Number.MAX_VALUE : 0;
  }

  flux(t: SimTransition, x: Float64Array): number {
    if (!this.enabledContinuous(t, x)) return 0;
    const r = this.rate(t, x);
    if (!Number.isFinite(r)) throw new SimulationError(`Rate of ${t.name} is ${r}`, t.id);
    return r > 0 ? r : 0;
  }

  private rhs(yy: Float64Array, dy: Float64Array): void {
    dy.fill(0);
    const fx = this.model.slotFixed;
    for (const t of this.cont) {
      const v = this.flux(t, yy);
      if (v === 0) continue;
      for (const a of t.inputs) if (a.kind === "normal" && !fx[a.slot]) dy[a.slot] -= this.w(a) * v;
      for (const a of t.outputs) if (!fx[a.slot]) dy[a.slot] += this.w(a) * v;
    }
    if (this.stoch.length) {
      let a0 = this.a0Static;
      for (const t of this.stochCont) a0 += this.propensity(t, yy);
      dy[this.G] = a0;
    }
  }

  /** Fire a discrete transition on the current state. Weights are taken at the marking before firing. */
  private fire(t: SimTransition): void {
    const y = this.y;
    const env = this.model.env;
    env.x = y;
    env.ctx = t;
    const sc = this.scratch;
    let i = 0;
    for (const a of t.inputs) sc[i++] = a.kind === "normal" ? this.w(a) : 0;
    for (const a of t.outputs) sc[i++] = this.w(a);
    i = 0;
    const fx = this.model.slotFixed;
    for (const a of t.inputs) {
      if (a.kind === "normal" && !fx[a.slot]) y[a.slot] -= sc[i];
      i++;
    }
    for (const a of t.inputs) if (a.kind === "reset" && !fx[a.slot]) y[a.slot] = 0;
    for (const a of t.outputs) {
      if (!fx[a.slot]) y[a.slot] += sc[i];
      i++;
    }
  }

  private refreshAll(): void {
    const y = this.y;
    let s = 0;
    for (const t of this.stoch) {
      const p = this.propensity(t, y);
      this.props[t.index] = p;
      if (!this.stochCont.includes(t)) s += p;
    }
    this.a0Static = s;
  }

  private afterFire(t: SimTransition): void {
    const d = this.deps[t.index];
    if (!d.length) return;
    const ts = this.model.transitions;
    for (let k = 0; k < d.length; k++) this.props[d[k]] = this.propensity(ts[d[k]], this.y);
    let s = 0;
    for (const u of this.stochStatic) s += this.props[u.index];
    this.a0Static = s;
  }

  private refreshCont(): void {
    for (const t of this.stochCont) this.props[t.index] = this.propensity(t, this.y);
  }

  private nextSched(t: SimTransition): number {
    const s = t.sched;
    const k = this.schedIdx[t.index];
    if (k > 0 && !(s.rep > 0)) return Infinity;
    const tm = s.begin + k * s.rep;
    return tm > s.end + 1e-12 * Math.max(1, Math.abs(s.end)) ? Infinity : tm;
  }

  private discreteChanged(): boolean {
    for (const t of this.watch) {
      const en = this.enabledDiscrete(t, this.y);
      if (t.kind === "immediate") {
        if (en && this.rate(t, this.y) > 0) return true;
      } else if (en === Number.isNaN(this.timers[t.index])) return true;
    }
    return false;
  }

  // ---- the run --------------------------------------------------------------

  /**
   * Simulate once from x0. Yields the current time now and then (for progress and abort);
   * returns the sampled trajectory.
   */
  *run(x0: Float64Array, rng: MersenneTwister): Generator<number, RunOutput, void> {
    const { times, maxSteps } = this.cfg;
    const P = times.length;
    const start = times[0];
    const dt = (times[P - 1] - start) / (P - 1);
    const ts = this.model.transitions;
    const slots = Array.from({ length: this.n }, () => new Float64Array(P));
    const trans = ts.map(() => new Float64Array(P));
    const y = this.y;
    const G = this.G;
    y.set(x0);
    y[G] = 0;
    this.timers.fill(NaN);
    this.schedIdx.fill(0);
    for (const t of this.sched) while (this.nextSched(t) < 0) this.schedIdx[t.index]++;
    let now = 0;
    let k = 0;
    let steps = 0;
    let events = 0;
    let truncated = false;
    let iter = 0;
    let zeroTime = 0;
    let lastEventTime = -1;
    let xi = rng.exp1();
    let hCur = this.cfg.step;
    const adaptive = this.stepper?.adaptive ?? false;
    this.refreshAll();

    const count = (t: SimTransition) => {
      events++;
      steps++;
      if (now === lastEventTime) {
        if (++zeroTime > ZERO_TIME_LIMIT)
          throw new SimulationError(`Transitions keep firing at time ${now} without time passing (check immediate transitions such as ${t.name})`, t.id);
      } else {
        zeroTime = 0;
        lastEventTime = now;
      }
      let b = Math.ceil((now - start) / dt - 1e-9);
      if (b < 0) b = 0;
      if (b < P) trans[t.index][b]++;
    };
    const fireDiscrete = (t: SimTransition) => {
      this.fire(t);
      count(t);
      this.afterFire(t);
    };
    const record = (i: number) => {
      for (let s = 0; s < this.n; s++) slots[s][i] = y[s];
      for (const t of this.cont) trans[t.index][i] = this.flux(t, y);
    };

    main: while (true) {
      if ((++iter & 1023) === 0) yield now;
      if (steps > maxSteps) {
        truncated = true;
        break;
      }
      // 1. Immediate transitions fire at once, chosen by their weights.
      if (this.imm.length) {
        while (true) {
          let total = 0;
          for (const t of this.imm) {
            const wgt = this.enabledDiscrete(t, y) ? this.rate(t, y) : 0;
            this.props[t.index] = wgt > 0 ? wgt : 0;
            total += this.props[t.index];
          }
          if (total <= 0) break;
          let r = rng.random() * total;
          let pick = this.imm[this.imm.length - 1];
          for (const t of this.imm) {
            if (this.props[t.index] <= 0) continue;
            r -= this.props[t.index];
            if (r < 0) {
              pick = t;
              break;
            }
          }
          fireDiscrete(pick);
          if (steps > maxSteps) continue main;
        }
      }
      // 2. Deterministic transitions: start the clock when enabled, stop it when disabled.
      for (const t of this.det) {
        const en = this.enabledDiscrete(t, y);
        if (!en) this.timers[t.index] = NaN;
        else if (Number.isNaN(this.timers[t.index])) {
          const d = this.rate(t, y);
          if (!(d >= 0)) throw new SimulationError(`Delay of ${t.name} must not be negative`, t.id);
          this.timers[t.index] = now + d;
        }
      }
      // 3. Next timed event.
      let tDisc = Infinity;
      let due: SimTransition | null = null;
      for (const t of this.det) {
        const tm = this.timers[t.index];
        if (tm < tDisc) {
          tDisc = tm;
          due = t;
        }
      }
      for (const t of this.sched) {
        const tm = this.nextSched(t);
        if (tm < tDisc) {
          tDisc = tm;
          due = t;
        }
      }
      if (tDisc <= now && due) {
        if (due.kind === "scheduled") this.schedIdx[due.index]++;
        else this.timers[due.index] = NaN;
        if (this.enabledDiscrete(due, y)) fireDiscrete(due);
        else steps++;
        continue;
      }
      // 4. Output points reached.
      while (k < P && times[k] <= now) record(k++);
      if (k >= P) break;
      const tStop = Math.min(tDisc, times[k]);

      // 5. Let time pass until tStop or a stochastic event.
      if (!this.stepper) {
        let a0 = 0;
        for (const t of this.stoch) a0 += this.props[t.index];
        if (a0 > 0) {
          const tEv = now + (xi - y[G]) / a0;
          if (tEv < tStop) {
            now = tEv;
            this.stochasticEvent(rng, a0, fireDiscrete);
            xi = rng.exp1();
            y[G] = 0;
            continue;
          }
        }
        y[G] += a0 * (tStop - now);
        now = tStop;
        continue;
      }
      const stepper = this.stepper;
      const y1 = this.y1;
      while (now < tStop) {
        if (steps > maxSteps) continue main;
        const left = tStop - now;
        if (left <= 1e-13 * Math.max(1, Math.abs(tStop))) {
          now = tStop;
          break;
        }
        const h = Math.min(hCur, left);
        const err = stepper.step(y, h, y1);
        steps++;
        if (adaptive && !(err <= 1)) {
          hCur = h * (Number.isFinite(err) ? Math.max(0.1, 0.9 * Math.pow(err, -stepper.exponent)) : 0.1);
          if (hCur < 1e-14 * Math.max(1, Math.abs(now)))
            throw new SimulationError(`Step size too small at time ${now}; the system may be stiff (try the rosenbrock solver)`);
          continue;
        }
        if (this.stoch.length && y1[G] >= xi) {
          now += this.locate(h, xi);
          this.clamp();
          this.refreshCont();
          let a0 = 0;
          for (const t of this.stoch) a0 += this.props[t.index];
          if (a0 > 0) this.stochasticEvent(rng, a0, fireDiscrete);
          xi = rng.exp1();
          y[G] = 0;
          continue main;
        }
        y.set(y1);
        now = h === left ? tStop : now + h;
        this.clamp();
        if (adaptive) hCur = h * (err > 0 ? Math.min(5, Math.max(0.2, 0.9 * Math.pow(err, -stepper.exponent))) : 5);
        if (this.watch.length && this.discreteChanged()) {
          this.refreshCont();
          continue main;
        }
      }
      if (this.stochCont.length) this.refreshCont();
    }
    if (truncated) {
      for (let i = k; i < P; i++) {
        for (const s of slots) s[i] = NaN;
        for (const tr of trans) tr[i] = NaN;
      }
    }
    const observers = this.observe(slots, trans, truncated ? k : P);
    return { slots, trans, observers, steps, events, truncated, reached: truncated ? now : times[P - 1] };
  }

  /**
   * Observer values at the first `valid` output points (NaN after them), computed from the recorded
   * markings. Transition names in transition observers stand for the transition's current rate:
   * the hazard of a stochastic transition, the flux of a continuous one, and the firings in the
   * output interval for immediate, deterministic and scheduled transitions.
   */
  observe(slots: Float64Array[], trans: Float64Array[], valid: number): Float64Array[] {
    const obs = this.model.observers;
    const P = this.cfg.times.length;
    const out = obs.map(() => new Float64Array(P).fill(NaN));
    if (!obs.length) return out;
    const env = this.model.env;
    const x = new Float64Array(this.n);
    const byName = new Map(this.model.transitions.map((t) => [t.name, t]));
    let point = 0;
    const transEnv: EvalEnv = {
      lookup: (name) => {
        const t = byName.get(name);
        if (!t) return env.lookup(name);
        if (t.kind === "stochastic") return this.propensity(t, x);
        if (t.kind === "continuous") return this.flux(t, x);
        return trans[t.index][point];
      },
      call: (name, args) => env.call(name, args),
      functions: env.functions,
    };
    for (point = 0; point < valid; point++) {
      for (let s = 0; s < this.n; s++) x[s] = slots[s][point];
      obs.forEach((o, j) => {
        env.x = x;
        env.ctx = null;
        let v: number;
        try {
          v = num(evaluate(o.expr, o.kind === "place" ? env : transEnv));
        } catch (e) {
          throw new SimulationError(`Observer ${o.name}: ${(e as Error).message}`);
        }
        out[j][point] = v;
      });
    }
    return out;
  }

  private stochasticEvent(rng: MersenneTwister, a0: number, fire: (t: SimTransition) => void): void {
    let r = rng.random() * a0;
    let pick: SimTransition | null = null;
    for (const t of this.stoch) {
      const p = this.props[t.index];
      if (p <= 0) continue;
      pick = t;
      r -= p;
      if (r < 0) break;
    }
    if (pick) fire(pick);
  }

  /** Find the step size s in (0, h] at which the integrated hazard reaches xi; leaves y at that point. */
  private locate(h: number, xi: number): number {
    const y = this.y, G = this.G, yt = this.yt, yhi = this.yhi;
    const stepper = this.stepper!;
    yhi.set(this.y1);
    let lo = 0, glo = y[G] - xi;
    let hi = h, ghi = yhi[G] - xi;
    let ghiTrue = ghi;
    let side = 0;
    for (let it = 0; it < 60; it++) {
      if (hi - lo <= 1e-12 * Math.max(1, h) || ghiTrue <= 1e-12 * Math.max(1, xi)) break;
      let s = lo - (glo * (hi - lo)) / (ghi - glo);
      if (!(s > lo && s < hi)) s = 0.5 * (lo + hi);
      stepper.step(y, s, yt);
      const g = yt[G] - xi;
      if (g >= 0) {
        hi = s;
        ghi = ghiTrue = g;
        yhi.set(yt);
        if (side === 1) glo /= 2;
        side = 1;
      } else {
        lo = s;
        glo = g;
        if (side === -1) ghi /= 2;
        side = -1;
      }
    }
    y.set(yhi);
    return hi;
  }

  private clamp(): void {
    const y = this.y;
    const a = this.contActive;
    for (let i = 0; i < a.length; i++) if (y[a[i]] < 0) y[a[i]] = 0;
  }
}
