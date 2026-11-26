// Is a marking reachable? The report's §5.2.1.1 (reachability) and §5.2.2 III–IV (the state
// equation M = M0 + C·x as a necessary condition): first the state equation, decided exactly over
// the integers by a small branch and bound on the exact simplex (no solution proves the marking
// unreachable), then a search of the state space for the marking itself.

import type { Net } from "@pns/core";
import { invariantsHold } from "./behaviour";
import { incidenceMatrix } from "./invariants";
import { checkAbort, toPTNet, type PTNet } from "./ptnet";
import { solveLP, type LPRow } from "./rational";
import { explore, pathTo } from "./statespace";
import type { ReachabilityCheck } from "./types";

export interface ReachabilityOptions {
  /** State limit of the search (default 100000). */
  maxStates?: number;
  /** Most linear programs of the integer search (default 300). */
  maxBranches?: number;
  signal?: AbortSignal;
}

/** Integer solution x ≥ 0 of C·x = d with the fewest firings; null: none; undefined: limit. */
function stateEquation(C: number[][], d: number[], m: number, maxBranches: number, signal?: AbortSignal): { kind: "none" | "integer" | "rational" | "unknown"; x?: number[] } {
  const base: LPRow[] = d.map((rhs, p) => ({ terms: C[p].flatMap((v, t) => (v ? [[t, v] as [number, number]] : [])), sense: "=", rhs }));
  // A place no transition touches must already hold its target.
  if (base.some((r) => !r.terms.length && r.rhs !== 0)) return { kind: "none" };
  const rows0 = base.filter((r) => r.terms.length);
  const objective = new Array<number>(m).fill(-1);
  let rationalFeasible = false;
  let branches = 0;
  let hitLimit = false;
  const stack: LPRow[][] = [[]];
  while (stack.length) {
    if (++branches > maxBranches) {
      hitLimit = true;
      break;
    }
    checkAbort(signal);
    const extra = stack.pop()!;
    const r = solveLP({ vars: m, rows: [...rows0, ...extra], objective, signal });
    if (r.status === "limit") {
      hitLimit = true;
      continue;
    }
    if (r.status !== "optimal" || !r.num || !r.den) continue;
    rationalFeasible = true;
    const j = r.num.findIndex((v) => v % r.den! !== 0n);
    if (j < 0) return { kind: "integer", x: r.num.map((v) => Number(v / r.den!)) };
    const fl = Number(r.num[j] / r.den);
    stack.push([...extra, { terms: [[j, 1]], sense: ">=", rhs: fl + 1 }], [...extra, { terms: [[j, 1]], sense: "<=", rhs: fl }]);
  }
  if (hitLimit) return { kind: "unknown" };
  return { kind: rationalFeasible ? "rational" : "none" };
}

/**
 * Is `target` reachable from the initial marking? `target` maps place names (as the analysis shows
 * them, e.g. "fork[a]" for unfolded coloured places) or ids to token counts; places left out must
 * be empty. Throws on an unknown place name.
 */
export function checkReachability(net: Net, target: Record<string, number>, opts: ReachabilityOptions = {}): ReachabilityCheck {
  const pt: PTNet = toPTNet(net);
  const n = pt.places.length;
  if (pt.errors.length) return { reachable: "n/a", stateEquation: "n/a", explanation: `The net has errors: ${pt.errors[0]}` };
  const goal = new Array<number>(n).fill(0);
  for (const [k, v] of Object.entries(target)) {
    const i = pt.places.findIndex((p) => p.name === k || p.id === k);
    if (i < 0) throw new Error(`Unknown place "${k}"`);
    if (!Number.isInteger(v) || v < 0) throw new Error(`The token count of ${k} must be a whole number of zero or more`);
    goal[i] = v;
  }
  const over = goal.findIndex((v, i) => pt.capacity[i] !== undefined && v > pt.capacity[i]!);
  if (over >= 0) return { reachable: "no", stateEquation: "n/a", explanation: `No: ${pt.places[over].name} would hold ${goal[over]} tokens, more than its capacity ${pt.capacity[over]}.` };

  // The state equation.
  let se: ReachabilityCheck["stateEquation"] = "n/a";
  let firingCount: Record<string, number> | undefined;
  if (invariantsHold(pt)) {
    const C = incidenceMatrix(pt).rows;
    const d = goal.map((v, p) => v - pt.m0[p]);
    const r = stateEquation(C, d, pt.transitions.length, opts.maxBranches ?? 300, opts.signal);
    se = r.kind;
    if (r.x) firingCount = Object.fromEntries(pt.transitions.flatMap((t, i) => (r.x![i] ? [[t.id, r.x![i]]] : [])));
  }
  const counts = () =>
    firingCount
      ? Object.entries(firingCount)
          .map(([id, c]) => `${pt.transitions.find((t) => t.id === id)!.name}×${c}`)
          .join(", ") || "no firing at all"
      : "";
  if (se === "none" || se === "rational") {
    return {
      reachable: "no",
      stateEquation: se,
      explanation:
        se === "none"
          ? "No: the state equation M = M0 + C·x has no solution with x ≥ 0, so no firing sequence can lead to this marking."
          : "No: the state equation M = M0 + C·x has only fractional solutions, and a firing sequence fires each transition a whole number of times.",
    };
  }

  // Search the state space.
  const ss = explore(pt, opts.maxStates ?? 100_000, opts.signal);
  const at = ss.markings.findIndex((M) => goal.every((v, p) => M[p] === v));
  if (at >= 0) {
    const path = pathTo(ss, at).map((t) => pt.transitions[t]);
    return {
      reachable: "yes",
      path,
      stateEquation: se,
      ...(firingCount ? { firingCount } : {}),
      explanation: `Yes: ${path.length ? `firing ${path.map((t) => t.name).join(" → ")} (${path.length} step${path.length === 1 ? "" : "s"}, the fewest possible) reaches it` : "it is the initial marking"}.`,
    };
  }
  const complete = !ss.truncated && !ss.unresolved.length;
  if (complete)
    return {
      reachable: "no",
      stateEquation: se,
      ...(firingCount ? { firingCount } : {}),
      explanation: `No: none of the ${ss.markings.length.toLocaleString()} reachable markings is this one${se === "integer" ? ` (the state equation alone cannot tell: it has the solution ${counts()}, but no firing order of it is possible)` : ""}.`,
    };
  return {
    reachable: "unknown",
    stateEquation: se,
    ...(firingCount ? { firingCount } : {}),
    explanation: `Unknown: the marking is not among the first ${ss.markings.length.toLocaleString()} reachable markings${se === "integer" ? `, and the state equation does not rule it out (solution ${counts()})` : ""}. Raise the state limit to search further.`,
  };
}
