// Token game for time Petri nets (Merlin & Farber): every transition has a static firing
// interval [eft, lft]. A transition may fire once it has been enabled for at least eft time
// units and must fire (or be disabled) before lft (strong semantics: time cannot pass beyond
// the lft of any enabled transition). Clocks of transitions that stay enabled across a firing
// keep running; a transition is newly enabled (clock reset) if it is the fired one or was not
// enabled at the intermediate marking M - pre(t).

import { Binding, CompiledNet, Marking, Net, compile, enabledBindings, envFor, evaluate, fire, initialMarking, num, parse } from "@pns/core";

export interface TimedState {
  cn: CompiledNet;
  /** cn with transitions stripped of their outputs, to compute the intermediate marking. */
  cnPre: CompiledNet;
  marking: Marking;
  /** Global time elapsed. */
  time: number;
  /** Per transition: time since it became enabled; undefined while disabled. */
  clocks: (number | undefined)[];
  /** Per transition: static interval [eft, lft] (lft may be Infinity). */
  intervals: [number, number][];
}

export interface TimedTransitionInfo {
  index: number;
  id: string;
  name: string;
  eft: number;
  lft: number;
  clock: number;
  bindings: Binding[];
  /** May fire now (clock >= eft). */
  fireable: boolean;
  /** Delay from now until it may fire (0 if fireable). */
  earliest: number;
  /** Delay from now until it must have fired (Infinity if lft is infinite). */
  latest: number;
}

export interface TimedEnabled {
  /** All enabled transitions with their clocks. */
  enabled: TimedTransitionInfo[];
  /** The enabled transitions that may fire now. */
  fireable: TimedTransitionInfo[];
  /** Largest delay allowed now (strong semantics); Infinity if nothing restricts time. */
  maxDelay: number;
  /** Smallest delay after which some transition becomes fireable (0 if one is fireable now). */
  minDelay: number;
}

const EPS = 1e-9;

function bound(src: string | undefined, dflt: number, cn: CompiledNet, what: string): number {
  const s = (src ?? "").trim();
  if (!s) return dflt;
  if (/^(inf|infinity|oo|∞)$/i.test(s)) return Infinity;
  const v = num(evaluate(parse(s), envFor(cn, {})));
  if (!(v >= 0)) throw new Error(`${what} must be a number of zero or more`);
  return v;
}

/** Initial state of the timed token game: time 0, clocks of enabled transitions at 0. */
export function timedInit(net: Net): TimedState {
  const cn = compile(net);
  const cnPre: CompiledNet = { ...cn, transitions: cn.transitions.map((t) => ({ ...t, outputs: [] })) };
  const byId = new Map(net.transitions.map((t) => [t.id, t]));
  const intervals = cn.transitions.map((ct): [number, number] => {
    const iv = byId.get(ct.id)?.interval;
    const eft = bound(iv?.[0], 0, cn, `Earliest firing time of ${ct.name}`);
    const lft = bound(iv?.[1], Infinity, cn, `Latest firing time of ${ct.name}`);
    if (lft < eft) throw new Error(`The interval of ${ct.name} is empty: [${eft}, ${lft}]`);
    return [eft, lft];
  });
  const marking = initialMarking(cn);
  const clocks = cn.transitions.map((t) => (enabledBindings(cn, t.index, marking).bindings.length ? 0 : undefined));
  return { cn, cnPre, marking, time: 0, clocks, intervals };
}

/** Which transitions are enabled, which may fire now, and how far time may advance. */
export function timedEnabled(s: TimedState): TimedEnabled {
  const enabled: TimedTransitionInfo[] = [];
  let maxDelay = Infinity;
  let minDelay = Infinity;
  for (const t of s.cn.transitions) {
    const clock = s.clocks[t.index];
    if (clock === undefined) continue;
    const bindings = enabledBindings(s.cn, t.index, s.marking).bindings;
    if (!bindings.length) continue;
    const [eft, lft] = s.intervals[t.index];
    const earliest = Math.max(0, eft - clock);
    const latest = lft === Infinity ? Infinity : Math.max(0, lft - clock);
    const info: TimedTransitionInfo = {
      index: t.index,
      id: t.id,
      name: t.name,
      eft,
      lft,
      clock,
      bindings,
      fireable: clock + EPS >= eft,
      earliest: clock + EPS >= eft ? 0 : earliest,
      latest,
    };
    enabled.push(info);
    maxDelay = Math.min(maxDelay, latest);
    minDelay = Math.min(minDelay, info.earliest);
  }
  return { enabled, fireable: enabled.filter((e) => e.fireable), maxDelay, minDelay };
}

/** Let d time units pass. Throws if that would exceed an enabled transition's latest firing time. */
export function timedDelay(s: TimedState, d: number): TimedState {
  if (!(d >= 0)) throw new Error("A delay must be zero or more");
  const { maxDelay } = timedEnabled(s);
  if (d > maxDelay + EPS) throw new Error(`Time can advance by at most ${maxDelay} before a transition must fire`);
  return { ...s, time: s.time + d, clocks: s.clocks.map((c) => (c === undefined ? c : c + d)) };
}

/** Fire transition t (index or id) under a binding (default: its first enabled binding). */
export function timedFire(s: TimedState, t: number | string, binding?: Binding): TimedState {
  const idx = typeof t === "number" ? t : s.cn.transitions.findIndex((x) => x.id === t || x.name === t);
  const ct = s.cn.transitions[idx];
  if (!ct) throw new Error(`Unknown transition ${t}`);
  const info = timedEnabled(s).enabled.find((e) => e.index === idx);
  if (!info) throw new Error(`${ct.name} is not enabled`);
  if (!info.fireable) throw new Error(`${ct.name} may fire only after ${info.earliest} more time units`);
  const b = binding ?? info.bindings[0];
  const intermediate = fire(s.cnPre, idx, b, s.marking);
  const marking = fire(s.cn, idx, b, s.marking);
  const clocks = s.cn.transitions.map((u) => {
    if (!enabledBindings(s.cn, u.index, marking).bindings.length) return undefined;
    const persistent = u.index !== idx && s.clocks[u.index] !== undefined && enabledBindings(s.cn, u.index, intermediate).bindings.length > 0;
    return persistent ? s.clocks[u.index] : 0;
  });
  return { ...s, marking, clocks };
}
