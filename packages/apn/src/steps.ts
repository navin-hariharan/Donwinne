// Step semantics of APNs (Konios Sec. 3.3) and T-APNs (Sec. 5.2).
//
// A step U is a non-empty set of structured transitions (t, c). U is enabled at M when
//   1. Pre(U) ≤ M,
//   2. M + Post(U) ≤ K (or, with self-loops, the weaker M − Pre(U) + Post(U) ≤ K: footnote 1 of
//      Sec. 3.3 and Sec. 5.2),
//   3. APN: (M × U) ∩ Ĩ = ∅, i.e. no (t, c) ∈ U has a colour-sensitive inhibitor place holding c;
//      T-APN: Gd((t, c)) = true for every (t, c) ∈ U,
// and firing it gives M' = M − Pre(U) + Post(U). Pre(U) and Post(U) are sums over the step.

import { Marking, Multiset, Net, Value, showValue, valueKey } from "@pns/core";
import { AmbientNet, AmbientTransition, StructuredTransition, arcColour, asAmbient, naturalCompare } from "./semantics";

export type { StructuredTransition } from "./semantics";

/** A step: a set of structured transitions, kept in canonical order (transition order, then colour order). */
export type Step = StructuredTransition[];

/**
 * Which capacity condition to apply. "strict": M + Post(U) ≤ K, the condition of Sec. 3.3 and 5.2.
 * "weak": M − Pre(U) + Post(U) ≤ K, the footnote's form for nets with self-loops. "auto" (default):
 * weak exactly when some structured transition consumes and produces the same structured place.
 */
export type CapacityRule = "strict" | "weak" | "auto";

export interface EnabledStepsOptions {
  /** Return only maximal steps: those not strictly contained in another enabled step. Default false. */
  maximalOnly?: boolean;
  /** Stop after this many steps (default 10 000); the result is then marked truncated. */
  maxSteps?: number;
  /** Only steps of at most this many structured transitions (default: no limit). */
  maxStepSize?: number;
  /** Stop after examining this many candidate sets (default 200 000), marking the result truncated. */
  maxNodes?: number;
  capacityRule?: CapacityRule;
}

export interface EnabledSteps {
  /** The enabled steps, smallest first within the search order, each in canonical order. */
  steps: Step[];
  /** A limit was hit; some enabled steps are missing (and maximality may be approximate). */
  truncated: boolean;
  /** The structured transitions that are enabled on their own (the steps of size 1). */
  enabled: StructuredTransition[];
}

/** A structured transition with its effect, ready for step checks. */
interface Cand {
  st: StructuredTransition;
  t: AmbientTransition;
  order: number;
  pre: [number, Value][];
  post: [number, Value][];
  inhib: [number, Value][];
}

function resolveRule(an: AmbientNet, rule: CapacityRule | undefined): "strict" | "weak" {
  const r = rule ?? "auto";
  if (r === "auto") return an.hasSelfLoop ? "weak" : "strict";
  return r;
}

function candidate(an: AmbientNet, t: AmbientTransition, colour: Value, order: number): Cand | null {
  const map = (arcs: AmbientTransition["pre"]): [number, Value][] | null => {
    const out: [number, Value][] = [];
    for (const a of arcs) {
      const g = arcColour(an, a, colour);
      if (g === undefined) return null;
      out.push([a.slot, g]);
    }
    return out;
  };
  const pre = map(t.pre);
  const post = map(t.post);
  const inhib = map(t.inhibitors);
  if (!pre || !post || !inhib) return null;
  return { st: { transition: t.id, colour }, t, order, pre, post, inhib };
}

/** All structured transitions (t, c) of the net, c ∈ C(t) with Gd((t, c)) true, in canonical order. */
export function structuredTransitions(net: Net | AmbientNet): StructuredTransition[] {
  const an = asAmbient(net);
  return an.transitions.flatMap((t) => t.modes.map((c) => ({ transition: t.id, colour: c })));
}

function allCandidates(an: AmbientNet): Cand[] {
  const out: Cand[] = [];
  for (const t of an.transitions)
    for (const c of t.modes) {
      const x = candidate(an, t, c, out.length);
      if (x) out.push(x);
    }
  return out;
}

const candCache = new WeakMap<AmbientNet, { list: Cand[]; byKey: Map<string, Cand> }>();
function cands(an: AmbientNet) {
  let c = candCache.get(an);
  if (!c) {
    const list = allCandidates(an);
    c = { list, byKey: new Map(list.map((x) => [stKey(x.st), x])) };
    candCache.set(an, c);
  }
  return c;
}

function stKey(st: StructuredTransition): string {
  return `${st.transition}:${valueKey(st.colour)}`;
}

/** A canonical key for a step, equal for equal sets, e.g. "t1:\"b\"|t4:\"b\"". */
export function stepKey(step: Step): string {
  return step.map(stKey).sort().join("|");
}

/** Sort a step into canonical order and drop duplicates (a step is a set). Unknown entries throw. */
export function normaliseStep(net: Net | AmbientNet, step: Step): Step {
  const an = asAmbient(net);
  const { byKey } = cands(an);
  const seen = new Map<string, Cand>();
  for (const st of step) {
    const c = byKey.get(stKey(st));
    if (!c) {
      const t = an.transitions.find((x) => x.id === st.transition);
      throw new Error(t ? `${t.name} has no colour mode ${showValue(st.colour)}` : `No transition with id ${st.transition}`);
    }
    seen.set(stKey(st), c);
  }
  return [...seen.values()].sort((a, b) => a.order - b.order).map((c) => c.st);
}

/** A step in the thesis's notation with transition names, e.g. "{(t3,b),(t4,b)}". */
export function showStep(net: Net | AmbientNet, step: Step): string {
  const an = asAmbient(net);
  const name = new Map(an.transitions.map((t) => [t.id, t.name]));
  return `{${step.map((s) => `(${name.get(s.transition) ?? s.transition},${showValue(s.colour)})`).join(",")}}`;
}

/** Read a step written as in showStep, e.g. "{(t3,b),(t4,b)}" or "(t1, b)"; transitions by name. */
export function parseStep(net: Net | AmbientNet, text: string): Step {
  const an = asAmbient(net);
  const out: Step = [];
  const re = /\(\s*([^,()]+?)\s*,\s*([^()]+?)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const t = an.transitions.find((x) => x.name === m![1]) ?? an.transitions.find((x) => x.id === m![1]);
    if (!t) throw new Error(`No transition named ${m[1]}`);
    const c = t.modes.find((v) => showValue(v) === m![2]);
    if (c === undefined) throw new Error(`${t.name} has no colour mode ${m[2]}`);
    out.push({ transition: t.id, colour: c });
  }
  if (!out.length) throw new Error(`"${text}" names no structured transition`);
  return normaliseStep(an, out);
}

/** Accumulated Pre(U) and Post(U) of a partial step, as counts per "slot|colour". */
class Acc {
  pre = new Map<string, number>();
  post = new Map<string, number>();
  add(c: Cand, sign: 1 | -1) {
    for (const [s, g] of c.pre) bump(this.pre, s, g, sign);
    for (const [s, g] of c.post) bump(this.post, s, g, sign);
  }
}

function bump(m: Map<string, number>, slot: number, g: Value, d: number) {
  const k = `${slot}|${valueKey(g)}`;
  const n = (m.get(k) ?? 0) + d;
  if (n === 0) m.delete(k);
  else m.set(k, n);
}

function count(M: Marking, slot: number, g: Value): number {
  return M[slot].count(g);
}

/** Conditions on (t, c) alone: inhibitors (APN). Gd is already applied to the modes. */
function individuallyOk(c: Cand, M: Marking): boolean {
  for (const [s, g] of c.inhib) if (count(M, s, g) > 0) return false;
  return true;
}

/** Pre(U + c) ≤ M, given Pre(U) in acc. */
function preFits(c: Cand, acc: Acc, M: Marking): boolean {
  const extra = new Map<string, number>();
  for (const [s, g] of c.pre) {
    const k = `${s}|${valueKey(g)}`;
    const need = (acc.pre.get(k) ?? 0) + (extra.get(k) ?? 0) + 1;
    if (need > count(M, s, g)) return false;
    extra.set(k, (extra.get(k) ?? 0) + 1);
  }
  return true;
}

/**
 * Capacity condition for the accumulated step, at the structured places the candidate c produces
 * into. Checking every member of a step covers every place Post(U) touches.
 */
function capacityOk(an: AmbientNet, acc: Acc, M: Marking, rule: "strict" | "weak", c: Cand): boolean {
  for (const [s, g] of c.post) {
    const k = `${s}|${valueKey(g)}`;
    const base = count(M, s, g) - (rule === "weak" ? acc.pre.get(k) ?? 0 : 0);
    if (base + (acc.post.get(k) ?? 0) > an.capacity(s, g)) return false;
  }
  return true;
}

function stepOk(an: AmbientNet, chosen: Cand[], M: Marking, rule: "strict" | "weak"): boolean {
  const acc = new Acc();
  for (const c of chosen) {
    if (!individuallyOk(c, M) || !preFits(c, acc, M)) return false;
    acc.add(c, 1);
  }
  for (const c of chosen) if (!capacityOk(an, acc, M, rule, c)) return false;
  return true;
}

/**
 * Is the step U enabled at M? (Konios Sec. 3.3 for APNs, Sec. 5.2 for T-APNs.) The empty step is
 * not a step of the CRG and counts as not enabled.
 */
export function isStepEnabled(net: Net | AmbientNet, M: Marking, step: Step, opts: Pick<EnabledStepsOptions, "capacityRule"> = {}): boolean {
  const an = asAmbient(net);
  if (!step.length) return false;
  const { byKey } = cands(an);
  const chosen: Cand[] = [];
  const seen = new Set<string>();
  for (const st of step) {
    const k = stKey(st);
    if (seen.has(k)) continue;
    seen.add(k);
    const c = byKey.get(k);
    if (!c) return false;
    chosen.push(c);
  }
  return stepOk(an, chosen, M, resolveRule(an, opts.capacityRule));
}

/**
 * Fire an enabled step: M' = M − Pre(U) + Post(U) (M[U⟩M'). Throws if the step is not enabled.
 */
export function fireStep(net: Net | AmbientNet, M: Marking, step: Step, opts: Pick<EnabledStepsOptions, "capacityRule"> = {}): Marking {
  const an = asAmbient(net);
  if (!isStepEnabled(an, M, step, opts)) throw new Error(`The step ${showStep(an, step)} is not enabled`);
  return applyStep(an, M, normaliseStep(an, step));
}

function applyStep(an: AmbientNet, M: Marking, step: Step): Marking {
  const { byKey } = cands(an);
  const next = M.slice();
  const minus = new Map<number, [Value, number][]>();
  const plus = new Map<number, [Value, number][]>();
  for (const st of step) {
    const c = byKey.get(stKey(st))!;
    for (const [s, g] of c.pre) (minus.get(s) ?? minus.set(s, []).get(s)!).push([g, 1]);
    for (const [s, g] of c.post) (plus.get(s) ?? plus.set(s, []).get(s)!).push([g, 1]);
  }
  for (const [s, ms] of minus) next[s] = next[s].minus(new Multiset(ms));
  for (const [s, ms] of plus) next[s] = next[s].plus(new Multiset(ms));
  return next;
}

/** The structured transitions enabled on their own at M, i.e. the enabled steps {(t, c)}. */
export function enabledStructuredTransitions(net: Net | AmbientNet, M: Marking, opts: Pick<EnabledStepsOptions, "capacityRule"> = {}): StructuredTransition[] {
  const an = asAmbient(net);
  const rule = resolveRule(an, opts.capacityRule);
  return cands(an)
    .list.filter((c) => stepOk(an, [c], M, rule))
    .map((c) => c.st);
}

/**
 * The enabled steps at M (Konios Sec. 3.3 / 5.2), all of them or only the maximal ones. The search
 * grows steps one structured transition at a time and prunes as soon as Pre(U) ≤ M fails, which is
 * exact because that condition is downward closed; with the strict capacity rule every condition
 * is, so maximal steps are found directly. Limits keep nets with many concurrent transitions from
 * exploding; a truncated result says so. The net should have no errors (see ambientErrors): arcs
 * the problem checks reject take no part in the steps.
 */
export function enabledSteps(net: Net | AmbientNet, M: Marking, opts: EnabledStepsOptions = {}): EnabledSteps {
  const an = asAmbient(net);
  const rule = resolveRule(an, opts.capacityRule);
  const maxSteps = opts.maxSteps ?? 10_000;
  const maxNodes = opts.maxNodes ?? 200_000;
  const maxSize = opts.maxStepSize ?? Infinity;
  // Candidates: (t, c) meeting every condition that each member of an enabled step must meet alone.
  // Under the weak rule capacity is not one of them (a step may free room for its own output).
  const all = cands(an).list;
  const single = all.filter((c) => stepOk(an, [c], M, rule));
  const pool = rule === "strict" ? single : all.filter((c) => individuallyOk(c, M) && preFits(c, new Acc(), M));
  const steps: Step[] = [];
  let truncated = false;
  let nodes = 0;
  const chosen: Cand[] = [];
  const acc = new Acc();

  const canAdd = (c: Cand) => {
    if (!preFits(c, acc, M)) return false;
    if (rule === "weak") return true;
    acc.add(c, 1);
    let ok = true;
    for (const x of [...chosen, c]) if (!capacityOk(an, acc, M, "strict", x)) ok = false;
    acc.add(c, -1);
    return ok;
  };
  const fullOk = () => chosen.every((x) => capacityOk(an, acc, M, rule, x));

  const record = () => {
    if (steps.length >= maxSteps) {
      truncated = true;
      return;
    }
    steps.push(chosen.map((c) => c.st));
  };

  const dfs = (from: number) => {
    for (let j = from; j < pool.length; j++) {
      if (truncated) return;
      if (++nodes > maxNodes) {
        truncated = true;
        return;
      }
      const c = pool[j];
      if (!canAdd(c)) continue;
      chosen.push(c);
      acc.add(c, 1);
      const ok = rule === "strict" || fullOk();
      if (ok) {
        if (!opts.maximalOnly || rule === "weak") record();
        else if (chosen.length >= maxSize || !pool.some((x) => !chosen.includes(x) && canAdd(x))) record();
      }
      if (chosen.length < maxSize) dfs(j + 1);
      acc.add(c, -1);
      chosen.pop();
    }
  };
  dfs(0);

  let out = steps;
  if (opts.maximalOnly && rule === "weak") {
    const keys = out.map((s) => new Set(s.map(stKey)));
    out = out.filter((s, i) => !keys.some((k, j) => j !== i && k.size > s.length && [...keys[i]].every((x) => k.has(x))));
  }
  return { steps: out, truncated, enabled: single.map((c) => c.st) };
}

/**
 * Konios Def. 4: two enabled structured transitions are in conflict at M if each can fire alone
 * but {(t, c), (t', c')} is not enabled. Distinct structured transitions only.
 */
export function inConflict(net: Net | AmbientNet, M: Marking, a: StructuredTransition, b: StructuredTransition, opts: Pick<EnabledStepsOptions, "capacityRule"> = {}): boolean {
  if (stKey(a) === stKey(b)) return false;
  return isStepEnabled(net, M, [a], opts) && isStepEnabled(net, M, [b], opts) && !isStepEnabled(net, M, [a, b], opts);
}

/** All pairs of structured transitions in conflict at M (Def. 4), each pair once. */
export function conflicts(net: Net | AmbientNet, M: Marking, opts: Pick<EnabledStepsOptions, "capacityRule"> = {}): [StructuredTransition, StructuredTransition][] {
  const en = enabledStructuredTransitions(net, M, opts);
  const out: [StructuredTransition, StructuredTransition][] = [];
  for (let i = 0; i < en.length; i++)
    for (let j = i + 1; j < en.length; j++) if (!isStepEnabled(net, M, [en[i], en[j]], opts)) out.push([en[i], en[j]]);
  return out;
}

/** Steps sorted for display: by size, then by their text. */
export function sortSteps(net: Net | AmbientNet, steps: Step[]): Step[] {
  return [...steps].sort((a, b) => a.length - b.length || naturalCompare(showStep(net, a), showStep(net, b)));
}
