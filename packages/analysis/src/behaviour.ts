// Behavioural properties from the reachability graph, with Karp–Miller coverability and
// structural theorems as fallbacks when the state space is too large.

import { checkAbort, type PTNet } from "./ptnet";
import { Firer, coverabilityApplies, explore, karpMiller, pathTo, terminalComponents, type StateSpace } from "./statespace";
import type { BehaviourResult, InvariantResults, NodeRef, PlaceBound, SiphonTrapResult, Status, StructuralProperties } from "./types";

export interface BehaviourContext {
  invariants?: InvariantResults;
  structure?: StructuralProperties;
  siphonsTraps?: SiphonTrapResult;
}

export interface BehaviourOptions {
  maxStates?: number;
  signal?: AbortSignal;
}

/** Explanations for the summary, filled in alongside the result. */
export interface BehaviourNotes {
  bounded: string;
  safe: string;
  deadlockFree: string;
  hasDeadTransitions: string;
  live: string;
  reversible: string;
  hasHomeStates: string;
  dynamicConflictFree: string;
  highlight: Partial<Record<"bounded" | "safe" | "deadlockFree" | "hasDeadTransitions" | "live" | "reversible" | "hasHomeStates" | "dynamicConflictFree", NodeRef[]>>;
}

const list = (xs: NodeRef[], max = 3) => {
  const s = xs.slice(0, max).map((x) => x.name);
  return xs.length > max ? `${s.join(", ")} and ${xs.length - max} more` : s.join(", ");
};
const seq = (pt: PTNet, path: number[]) => (path.length ? path.map((t) => pt.transitions[t].name).join(" ") : "(no firing)");

/** The structural net equals the real one: no arcs or capacities that structural theorems ignore. */
export function structurallyFaithful(pt: PTNet): boolean {
  return !pt.modulus && pt.capacity.every((c) => c === undefined) && pt.arcs.every((a) => (a.kind === "normal" || a.kind === "read") && a.weight !== null);
}

/** P-invariants remain valid (only restricting arcs besides normal ones, constant weights). */
function invariantsHold(pt: PTNet): boolean {
  return !pt.modulus && pt.arcs.every((a) => a.kind !== "reset" && a.weight !== null);
}

function markingRecord(pt: PTNet, M: ArrayLike<number>): Record<string, number> {
  const r: Record<string, number> = {};
  for (let i = 0; i < pt.places.length; i++) if (M[i]) r[pt.places[i].name] = M[i];
  return r;
}

export function analyseBehaviour(pt: PTNet, opts: BehaviourOptions = {}, ctx: BehaviourContext = {}): { result: BehaviourResult; notes: BehaviourNotes } {
  const maxStates = opts.maxStates ?? 100_000;
  const P = pt.places;
  const T = pt.transitions;
  const skipped = (reason: string): { result: BehaviourResult; notes: BehaviourNotes } => {
    const why = `n/a: ${reason}`;
    return {
      result: {
        exploration: "skipped",
        reason,
        maxStates,
        states: 0,
        edges: 0,
        bounded: "n/a",
        safe: "n/a",
        k: null,
        placeBounds: [],
        unboundedPlaces: [],
        deadlockFree: "n/a",
        deadlocks: 0,
        hasDeadTransitions: "n/a",
        deadTransitions: [],
        live: "n/a",
        liveTransitions: [],
        nonLiveTransitions: [],
        reversible: "n/a",
        hasHomeStates: "n/a",
        homeStates: 0,
        terminalComponents: 0,
        dynamicConflictFree: "n/a",
      },
      notes: { bounded: why, safe: why, deadlockFree: why, hasDeadTransitions: why, live: why, reversible: why, hasHomeStates: why, dynamicConflictFree: why, highlight: {} },
    };
  };
  if (pt.errors.length) return skipped(`the net has errors (${pt.errors[0]})`);
  if (!P.length && !T.length) return skipped("the net is empty");

  const ss: StateSpace = explore(pt, maxStates, opts.signal);
  for (const e of ss.errors) pt.warnings.push(`While exploring the state space: ${e}`);
  const complete = !ss.truncated;
  const N = ss.markings.length;
  const highlight: BehaviourNotes["highlight"] = {};
  const tooBig = `the state space has more than ${maxStates} states`;
  if (!complete) pt.warnings.push(`State space exploration stopped at ${maxStates} states; behavioural results rely on coverability and structural theorems where possible.`);

  // Observed maxima.
  const seen = new Array<number>(P.length).fill(0);
  for (const M of ss.markings) for (let p = 0; p < P.length; p++) if (M[p] > seen[p]) seen[p] = M[p];
  const argmax = (xs: number[]) => xs.reduce((b, v, i) => (v > xs[b] ? i : b), 0);

  // ---- Boundedness
  let bounded: Status = "unknown";
  let boundedNote = "";
  let placeBounds: PlaceBound[] = P.map((place, p) => ({ place, max: seen[p], exact: complete, source: complete ? "statespace" : "partial" }));
  let unboundedPlaces: NodeRef[] = [];
  let coverability: BehaviourResult["coverability"];
  if (complete) {
    bounded = "yes";
    boundedNote = P.length ? `Yes: the state space is finite (${N} states); at most ${seen[argmax(seen)]} tokens in a place (${P[argmax(seen)].name}).` : "Yes: the net has no places.";
  } else {
    const inv = ctx.invariants;
    if (bounded === "unknown" && inv && inv.cpi && !inv.p.truncated && invariantsHold(pt)) {
      bounded = "yes";
      placeBounds = P.map((place, p) => {
        let ub = Infinity;
        for (const y of inv.p.invariants) {
          const w = y.weights[place.id];
          if (w) ub = Math.min(ub, Math.floor((y.tokenSum ?? 0) / w));
        }
        return { place, max: ub, exact: ub === seen[p], source: "invariants" };
      });
      boundedNote = "Yes: every place is covered by a P-invariant, which caps its tokens.";
    }
    if (bounded === "unknown" && coverabilityApplies(pt)) {
      checkAbort(opts.signal);
      const km = karpMiller(pt, maxStates, opts.signal);
      coverability = { nodes: km.nodes, complete: km.complete };
      if (km.unbounded.size) {
        bounded = "no";
        unboundedPlaces = [...km.unbounded].sort((a, b) => a - b).map((p) => P[p]);
        placeBounds = P.map((place, p) =>
          km.unbounded.has(p)
            ? { place, max: null, exact: true, source: "coverability" }
            : { place, max: Math.max(km.max[p], seen[p]), exact: km.complete, source: km.complete ? "coverability" : "partial" },
        );
        boundedNote = `No: ${list(unboundedPlaces)} can grow without bound (Karp–Miller coverability${km.complete ? "" : ", partial"}).`;
        highlight.bounded = unboundedPlaces;
      } else if (km.complete) {
        bounded = "yes";
        placeBounds = P.map((place, p) => ({ place, max: km.max[p], exact: true, source: "coverability" }));
        boundedNote = "Yes: the coverability graph has no ω entries.";
      }
    }
    if (bounded === "unknown") boundedNote = `Unknown: ${tooBig}${coverabilityApplies(pt) ? " and the coverability graph is too large as well" : " and coverability does not apply to inhibitor, reset, equal, capacity or marking-dependent arcs"}.`;
  }
  const finiteBounds = placeBounds.map((b) => b.max);
  const k = bounded === "yes" && finiteBounds.length ? Math.max(...(finiteBounds as number[])) : bounded === "yes" ? 0 : null;

  // ---- Safeness
  let safe: Status;
  let safeNote: string;
  const over = seen.findIndex((v) => v > 1);
  if (over >= 0) {
    safe = "no";
    safeNote = `No: ${P[over].name} can hold ${seen[over]} tokens.`;
    highlight.safe = [P[over]];
  } else if (bounded === "no") {
    safe = "no";
    safeNote = `No: ${list(unboundedPlaces)} is unbounded.`;
    highlight.safe = unboundedPlaces;
  } else if (complete || (bounded === "yes" && finiteBounds.every((b) => b !== null && b <= 1))) {
    safe = "yes";
    safeNote = "Yes: no place ever holds more than one token.";
  } else {
    safe = "unknown";
    safeNote = `Unknown: ${tooBig}.`;
  }

  // ---- Deadlocks
  const structure = ctx.structure;
  const st = ctx.siphonsTraps;
  const faithful = structurallyFaithful(pt);
  const ordinary = !!structure?.ordinary.holds;
  let deadlockFree: Status;
  let deadlockNote: string;
  let firstDeadlock: BehaviourResult["firstDeadlock"];
  if (ss.dead.length) {
    const d = ss.dead[0];
    const path = pathTo(ss, d);
    firstDeadlock = { path: path.map((t) => T[t]), marking: markingRecord(pt, ss.markings[d]) };
    deadlockFree = "no";
    const mk = Object.entries(firstDeadlock.marking)
      .map(([n, v]) => (v === 1 ? n : `${v}·${n}`))
      .join(" + ");
    deadlockNote = `No: firing ${seq(pt, path)} reaches a dead marking (${mk || "empty"}).`;
    highlight.deadlockFree = firstDeadlock.path;
  } else if (complete) {
    deadlockFree = "yes";
    deadlockNote = "Yes: every reachable marking enables some transition.";
  } else if (faithful && ordinary && st?.siphonTrapProperty === "yes") {
    deadlockFree = "yes";
    deadlockNote = "Yes: the net is ordinary and every minimal siphon contains a marked trap, so no dead marking is reachable.";
  } else {
    deadlockFree = "unknown";
    deadlockNote = `Unknown: ${tooBig} and no deadlock was found among them.`;
  }

  // ---- Dead transitions
  const fired = new Uint8Array(T.length);
  for (const t of ss.trans) fired[t] = 1;
  const neverFired = T.filter((_, t) => !fired[t]);
  let hasDeadTransitions: Status;
  let deadNote: string;
  let deadTransitions: NodeRef[] = [];
  if (!T.length) {
    hasDeadTransitions = "n/a";
    deadNote = "n/a: the net has no transitions.";
  } else if (!neverFired.length) {
    hasDeadTransitions = "no";
    deadNote = "No: every transition can fire.";
  } else if (complete) {
    hasDeadTransitions = "yes";
    deadTransitions = neverFired;
    deadNote = `Yes: ${neverFired.length === 1 ? "transition" : "transitions"} ${list(neverFired)} can never fire.`;
    highlight.hasDeadTransitions = neverFired;
  } else {
    hasDeadTransitions = "unknown";
    deadNote = `Unknown: ${list(neverFired)} did not fire within the first ${maxStates} states.`;
  }

  // ---- Liveness, reversibility, home states
  let live: Status = "unknown";
  let liveNote = "";
  let liveTransitions: NodeRef[] = [];
  let nonLiveTransitions: NodeRef[] = [];
  let reversible: Status = "unknown";
  let revNote = "";
  let hasHomeStates: Status = "unknown";
  let homeNote = "";
  let homeStates = 0;
  let terminalCount = 0;
  if (complete) {
    checkAbort(opts.signal);
    const tc = terminalComponents(ss);
    terminalCount = tc.terminal.length;
    const isLive = (t: number) => tc.transitionsIn.every((s) => s.has(t));
    liveTransitions = T.filter((_, t) => isLive(t));
    nonLiveTransitions = T.filter((_, t) => !isLive(t));
    if (!T.length) {
      live = "n/a";
      liveNote = "n/a: the net has no transitions.";
    } else if (!nonLiveTransitions.length) {
      live = "yes";
      liveNote = "Yes: from every reachable marking each transition can fire again.";
    } else {
      live = "no";
      highlight.live = nonLiveTransitions;
      if (ss.dead.length) liveNote = `No: the net can reach a dead marking (by ${seq(pt, pathTo(ss, ss.dead[0]))}).`;
      else if (deadTransitions.length) liveNote = `No: ${list(deadTransitions)} can never fire.`;
      else {
        const bad = nonLiveTransitions[0];
        const bi = T.indexOf(bad);
        const comp = tc.terminal[tc.transitionsIn.findIndex((s) => !s.has(bi))];
        liveNote = `No: after ${seq(pt, pathTo(ss, comp[0]))}, ${bad.name} can never fire again.`;
      }
    }
    const t0 = tc.terminal.findIndex((c) => c.includes(0));
    if (t0 >= 0) {
      reversible = "yes";
      revNote = "Yes: the initial marking can be reached again from every reachable marking.";
    } else {
      reversible = "no";
      const s = tc.terminal[0][0];
      revNote = `No: after ${seq(pt, pathTo(ss, s))}, the initial marking can no longer be reached.`;
    }
    if (tc.terminal.length === 1) {
      hasHomeStates = "yes";
      homeStates = tc.terminal[0].length;
      homeNote = `Yes: ${homeStates === 1 ? "one marking is" : `${homeStates} markings are`} reachable from every reachable marking.`;
    } else {
      hasHomeStates = "no";
      homeNote = `No: the reachability graph has ${tc.terminal.length} terminal components that cannot reach each other.`;
    }
  } else {
    if (ss.dead.length) {
      live = "no";
      nonLiveTransitions = T.slice();
      liveNote = `No: the net can reach a dead marking (by ${seq(pt, pathTo(ss, ss.dead[0]))}).`;
      if (ss.dead[0] !== 0) {
        reversible = "no";
        revNote = `No: the dead marking reached by ${seq(pt, pathTo(ss, ss.dead[0]))} cannot return to the initial one.`;
      }
      if (ss.dead.length > 1) {
        hasHomeStates = "no";
        homeNote = "No: at least two different dead markings are reachable.";
      }
    } else if (faithful && ordinary && st?.siphonTrapProperty === "yes" && structure?.extendedSimple.holds) {
      live = "yes";
      liveNote = "Yes: the net is ordinary and extended simple, and every minimal siphon contains a marked trap.";
    } else if (faithful && ordinary && st?.siphonTrapProperty === "no" && structure?.extendedFreeChoice.holds) {
      live = "no";
      liveNote = `No: in an extended free-choice net every siphon must contain a marked trap (Commoner), but ${st.badSiphons[0].map((p) => p.name).join(", ")} does not.`;
    }
    if (live === "unknown") liveNote = `Unknown: ${tooBig}.`;
    if (reversible === "unknown") revNote = `Unknown: ${tooBig}.`;
    if (hasHomeStates === "unknown") homeNote = `Unknown: ${tooBig}.`;
  }

  // ---- Dynamic conflicts
  const dcf = dynamicConflicts(pt, ss, opts.signal);
  let dynamicConflictFree: Status;
  let dcfNote: string;
  let dynamicConflict: BehaviourResult["dynamicConflict"];
  if (!T.length) {
    dynamicConflictFree = "n/a";
    dcfNote = "n/a: the net has no transitions.";
  } else if (dcf.found) {
    const { state, t, u } = dcf.found;
    const path = pathTo(ss, state);
    dynamicConflict = { path: path.map((x) => T[x]), marking: markingRecord(pt, ss.markings[state]), transitions: [T[t], T[u]] };
    dynamicConflictFree = "no";
    dcfNote = `No: ${path.length ? `after ${seq(pt, path)}` : "in the initial marking"} both ${T[t].name} and ${T[u].name} are enabled, and firing ${T[t].name} disables ${T[u].name}.`;
    highlight.dynamicConflictFree = [T[t], T[u]];
  } else if (complete && !dcf.cut) {
    dynamicConflictFree = "yes";
    dcfNote = "Yes: no reachable marking enables two transitions such that firing one disables the other.";
  } else if (faithful && structure?.staticConflictFree.holds) {
    dynamicConflictFree = "yes";
    dcfNote = "Yes: the net is static conflict free (no two transitions share an input place), which implies dynamic conflict freeness.";
  } else {
    dynamicConflictFree = "unknown";
    dcfNote = dcf.cut ? "Unknown: the conflict check reached its limit without finding a conflict." : `Unknown: ${tooBig} and no conflict was found among them.`;
  }

  return {
    result: {
      exploration: complete ? "complete" : "truncated",
      maxStates,
      states: N,
      edges: ss.from.length,
      bounded,
      safe,
      k,
      placeBounds,
      unboundedPlaces,
      ...(coverability ? { coverability } : {}),
      deadlockFree,
      deadlocks: ss.dead.length,
      ...(firstDeadlock ? { firstDeadlock } : {}),
      hasDeadTransitions,
      deadTransitions,
      live,
      liveTransitions,
      nonLiveTransitions,
      reversible,
      hasHomeStates,
      homeStates,
      terminalComponents: terminalCount,
      dynamicConflictFree,
      ...(dynamicConflict ? { dynamicConflict } : {}),
    },
    notes: {
      bounded: boundedNote,
      safe: safeNote,
      deadlockFree: deadlockNote,
      hasDeadTransitions: deadNote,
      live: liveNote,
      reversible: revNote,
      hasHomeStates: homeNote,
      dynamicConflictFree: dcfNote,
      highlight,
    },
  };
}

/**
 * First dynamic conflict in the state space (Charlie's DCF): a reachable marking M enabling two
 * different transitions t and u such that u is no longer enabled after firing t at M.
 * `cut` reports that the search stopped at its budget of enabledness tests.
 */
export function dynamicConflicts(pt: PTNet, ss: StateSpace, signal?: AbortSignal, budget = 20_000_000): { found?: { state: number; t: number; u: number }; cut: boolean } {
  const firer = new Firer(pt);
  const E = ss.from.length;
  let tests = 0;
  let e = 0;
  while (e < E) {
    const s = ss.from[e];
    let f = e;
    while (f < E && ss.from[f] === s) f++;
    if (f - e > 1) {
      if ((s & 255) === 0) checkAbort(signal);
      for (let i = e; i < f; i++) {
        const t = ss.trans[i];
        const M2 = ss.markings[ss.to[i]];
        for (let j = e; j < f; j++) {
          const u = ss.trans[j];
          if (u === t) continue;
          if (++tests > budget) return { cut: true };
          let enabled: boolean;
          try {
            enabled = firer.fire(u, M2) !== null;
          } catch {
            continue;
          }
          if (!enabled) return { found: { state: s, t, u }, cut: false };
        }
      }
    }
    e = f;
  }
  return { cut: false };
}
