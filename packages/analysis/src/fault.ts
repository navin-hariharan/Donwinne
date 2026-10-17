// Fault-tolerance analysis (Konios 2015, §7.3.3): make a sensor faulty by adding tokens to
// database places, then check whether users still reach their goal after a wrong advice and
// whether the system can give the correct advice after a wrong one.

import type { Net } from "@pns/core";
import { CtlChecker, type CtlOptions, type CtlResult } from "./check";
import { formatCtl, parseCtl, placeRef, resolvePlace, type CtlFormula } from "./ctl";
import { toPTNet, type PTNet } from "./ptnet";
import { deadStates, interleavingSystem, type TransitionSystem } from "./ts";
import type { NodeRef } from "./types";

/** Extra (or, if negative, fewer) initial tokens on a place, e.g. on a database place. */
export interface Fault {
  /** Place name: an uncoloured place, or a coloured place with its colour, e.g. "db_p1_1[u1]". */
  place: string;
  /** Tokens added to the initial marking (negative removes). */
  tokens: number;
}

/** Apply faults to the initial marking of a P/T view. Throws on unknown or ambiguous places and negative markings. */
export function injectFaults(pt: PTNet, faults: readonly Fault[]): PTNet {
  const m0 = pt.m0.slice();
  for (const f of faults) {
    const m = /^(.*)\[([^\]]+)\]$/.exec(f.place);
    const idx = resolvePlace(pt, m ? m[1] : f.place, m ? m[2] : undefined);
    if (!idx) throw new Error(`Unknown place "${f.place}".`);
    if (idx.length > 1)
      throw new Error(`"${f.place}" is a coloured place with ${idx.length} colours; name one, e.g. ${placeRef(pt.places[idx[0]].name)}.`);
    const p = idx[0];
    if (!Number.isInteger(f.tokens)) throw new Error(`Fault on ${f.place}: the number of tokens must be a whole number.`);
    m0[p] += f.tokens;
    if (m0[p] < 0) throw new Error(`Fault on ${f.place}: the place would hold ${m0[p]} tokens.`);
  }
  return { ...pt, m0 };
}

export interface FaultToleranceQuery {
  faults: readonly Fault[];
  /** State formula describing the wrong advice, e.g. "p2 == 2 & Back_p2_1 == 2". */
  wrongAdvice: string | CtlFormula;
  /** The user's goal (checked as AG(wrongAdvice -> EF(goal))). */
  goal?: string | CtlFormula;
  /** The correct advice for the same action (checked as AG(wrongAdvice -> EF(correctAdvice))). */
  correctAdvice?: string | CtlFormula;
  /** State limit per state space (default 100000). */
  maxStates?: number;
  deadlocks?: CtlOptions["deadlocks"];
  signal?: AbortSignal;
  /** Build the transition system yourself, e.g. a concurrent reachability graph (default: interleaving). */
  build?: (pt: PTNet) => TransitionSystem;
}

export interface FaultSummary {
  states: number;
  complete: boolean;
  deadStates: number;
  /** Largest number of tokens on one place. */
  k: number;
}

export interface FaultToleranceReport {
  /** The faults as applied: the place and its initial tokens before and after. */
  faults: { place: NodeRef; tokens: number; before: number; after: number }[];
  faultFree: FaultSummary;
  faulty: FaultSummary;
  /** EF(wrongAdvice) without the fault: normally false, the correct system never gives it. */
  wrongAdviceWithoutFault: CtlResult;
  /** EF(wrongAdvice) with the fault, with a witness path: the fault does show. */
  wrongAdviceWithFault: CtlResult;
  /** AG(wrongAdvice -> EF(goal)) with the fault: "a user can reach his final goal even after a wrong advice". */
  goalAfterWrongAdvice?: CtlResult;
  /** AG(wrongAdvice -> EF(correctAdvice)) with the fault: "the system can give a correct advice after a wrong one". */
  correctAfterWrongAdvice?: CtlResult;
  /** Dead markings of the faulty net that the fault-free net cannot reach as dead markings. */
  newDeadMarkings: Record<string, number>[];
  /** One line per finding. */
  summary: string[];
}

function summarise(ts: TransitionSystem): FaultSummary {
  let k = 0;
  for (const M of ts.markings) for (let p = 0; p < ts.places.length; p++) if (M[p] > k) k = M[p];
  return { states: ts.markings.length, complete: ts.complete, deadStates: deadStates(ts).length, k };
}

const text = (f: string | CtlFormula) => (typeof f === "string" ? formatCtl(parseCtl(f)) : formatCtl(f));

/**
 * Fault-tolerance analysis of Konios (2015, §7.3.3). The faults (extra tokens on database places)
 * make a sensor give a wrong advice; the report says whether the wrong advice becomes reachable,
 * whether the goal stays reachable after it, and whether a correct advice can follow it.
 * Throws for unknown places and malformed formulas.
 */
export function faultTolerance(net: Net | PTNet, q: FaultToleranceQuery): FaultToleranceReport {
  const pt = "netClass" in net ? toPTNet(net) : net;
  if (pt.errors.length) throw new Error(`The net has errors: ${pt.errors[0]}`);
  const faultyPt = injectFaults(pt, q.faults);
  const build = q.build ?? ((p: PTNet) => interleavingSystem(p, { maxStates: q.maxStates, signal: q.signal }));
  const ok = build(pt);
  const bad = build(faultyPt);
  const opts: CtlOptions = { deadlocks: q.deadlocks, signal: q.signal };
  const okChecker = new CtlChecker(ok, opts);
  const badChecker = new CtlChecker(bad, opts);
  const wrong = text(q.wrongAdvice);
  const wrongAdviceWithoutFault = okChecker.check(`EF(${wrong})`);
  const wrongAdviceWithFault = badChecker.check(`EF(${wrong})`);
  const report: FaultToleranceReport = {
    faults: q.faults.map((f) => {
      const m = /^(.*)\[([^\]]+)\]$/.exec(f.place);
      const p = resolvePlace(pt, m ? m[1] : f.place, m ? m[2] : undefined)![0];
      return { place: pt.places[p], tokens: f.tokens, before: pt.m0[p], after: faultyPt.m0[p] };
    }),
    faultFree: summarise(ok),
    faulty: summarise(bad),
    wrongAdviceWithoutFault,
    wrongAdviceWithFault,
    newDeadMarkings: [],
    summary: [],
  };
  if (q.goal !== undefined) report.goalAfterWrongAdvice = badChecker.check(`AG((${wrong}) -> EF(${text(q.goal)}))`);
  if (q.correctAdvice !== undefined) report.correctAfterWrongAdvice = badChecker.check(`AG((${wrong}) -> EF(${text(q.correctAdvice)}))`);

  const keyOf = (M: ArrayLike<number>) => Array.prototype.join.call(M, ",");
  const okDead = new Set(deadStates(ok).map((s) => keyOf(ok.markings[s])));
  for (const s of deadStates(bad)) {
    const M = bad.markings[s];
    if (okDead.has(keyOf(M))) continue;
    const r: Record<string, number> = {};
    for (let p = 0; p < bad.places.length; p++) if (M[p]) r[bad.places[p].name] = M[p];
    report.newDeadMarkings.push(r);
  }

  const S = report.summary;
  const verdict = (r: CtlResult) => (r.status === "unknown" ? "cannot be decided (incomplete state space)" : r.status === "true" ? "holds" : "fails");
  S.push(
    wrongAdviceWithFault.status === "true"
      ? `With the fault the wrong advice is given${wrongAdviceWithFault.trace ? ` (after ${wrongAdviceWithFault.trace.steps.map((x) => x.label).join(" ") || "no firing"})` : ""}${wrongAdviceWithoutFault.status === "false" ? "; without it, never." : "; it is reachable without the fault as well."}`
      : wrongAdviceWithFault.status === "false"
        ? "With the fault the wrong advice is never given, so the fault has no visible effect on it and the properties below hold trivially."
        : "Whether the wrong advice is given with the fault cannot be decided (incomplete state space).",
  );
  if (report.goalAfterWrongAdvice) S.push(`Reaching the goal after a wrong advice ${verdict(report.goalAfterWrongAdvice)}.`);
  if (report.correctAfterWrongAdvice) S.push(`A correct advice after a wrong one ${verdict(report.correctAfterWrongAdvice)}.`);
  S.push(
    report.newDeadMarkings.length
      ? `The fault introduces ${report.newDeadMarkings.length} new dead marking${report.newDeadMarkings.length === 1 ? "" : "s"}.`
      : "The fault introduces no new dead marking.",
  );
  if (report.faulty.k !== report.faultFree.k) S.push(`The bound k changes from ${report.faultFree.k} to ${report.faulty.k}.`);
  return report;
}
