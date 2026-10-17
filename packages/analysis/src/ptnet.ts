// The P/T view of a net that every analysis works on: places are marking slots (logical places
// share one), coloured nets are unfolded first, hybrid nets lose their continuous part.

import {
  CompiledNet,
  EvalEnv,
  Expr,
  Net,
  compile,
  defaultTransitionKind,
  envFor,
  evaluate,
  identifiers,
  initialMarking,
  isColoured,
  isContinuousPlace,
  isFaultTree,
  num,
  showValue,
  timeBase,
} from "@pns/core";
import { unfold, type UnfoldMapping } from "@pns/sim";
import type { NodeRef } from "./types";

export type PTArcKind = "normal" | "read" | "inhibitor" | "reset" | "equal";

export interface PTArc {
  /** Id of the arc in the analysed net. */
  arcId: string;
  kind: PTArcKind;
  /** "in": place → transition; "out": transition → place. */
  dir: "in" | "out";
  place: number;
  transition: number;
  /** Constant weight, or null when it depends on the marking (see expr) or cannot be evaluated. */
  weight: number | null;
  /** Marking-dependent weight expression. */
  expr?: Expr;
  /** Readable form for messages, e.g. "P1 → t2". */
  label: string;
}

export interface PTNet {
  places: NodeRef[];
  transitions: NodeRef[];
  arcs: PTArc[];
  /** Initial marking per place. */
  m0: number[];
  /** Smallest capacity of the places sharing the slot, if any. */
  capacity: (number | undefined)[];
  /** Modulo nets: token arithmetic modulo this number, every transition enabled. */
  modulus?: number;
  unfolded: boolean;
  warnings: string[];
  /** Errors that make the state space meaningless (bad markings, weights, unfolding failures). */
  errors: string[];
  /** Evaluation environment for marking-dependent weights at marking M. */
  envAt?: (M: ArrayLike<number>) => EvalEnv;
}

/** Display name of a colour: (1,a) -> 1,a. */
function colourName(text: string): string {
  return text.startsWith("(") && text.endsWith(")") ? text.slice(1, -1) : text;
}

const EMPTY: Omit<PTNet, "warnings" | "errors"> = { places: [], transitions: [], arcs: [], m0: [], capacity: [], unfolded: false };

/**
 * Build the P/T view of a net. Never throws: problems end up in `errors` (the state space is then
 * not explored) or `warnings` (limits of the analysis).
 */
export function toPTNet(net: Net): PTNet {
  const warnings: string[] = [];
  const errors: string[] = [];
  if (isFaultTree(net.netClass)) {
    warnings.push("Fault trees have no places or transitions; use the fault tree analysis instead.");
    return { ...EMPTY, warnings, errors };
  }

  // 1. Coloured nets: unfold.
  let work = net;
  let mapping: UnfoldMapping | undefined;
  if (isColoured(net.netClass)) {
    try {
      const u = unfold(net);
      work = u.net;
      mapping = u.mapping;
      warnings.push(`Coloured net analysed through its unfolding (${u.net.places.length} places, ${u.net.transitions.length} transitions).`);
    } catch (e) {
      errors.push(`The coloured net cannot be unfolded: ${(e as Error).message}`);
      return { ...EMPTY, warnings, errors };
    }
  }

  // 2. Time, rates and the continuous part.
  const base = timeBase(work.netClass);
  if (base === "continuous") {
    warnings.push("Continuous net analysed as its underlying discrete P/T net (markings and weights must be whole numbers).");
    work = { ...work, netClass: "xpt", places: work.places.map((p) => ({ ...p, continuous: undefined })) };
  } else if (base === "hybrid") {
    const contPlaces = new Set(work.places.filter((p) => !p.coarse && isContinuousPlace(work, p)).map((p) => p.id));
    const dflt = defaultTransitionKind(work.netClass);
    const contTrans = new Set(work.transitions.filter((t) => !t.coarse && (t.kind ?? dflt) === "continuous").map((t) => t.id));
    if (contPlaces.size || contTrans.size)
      warnings.push(
        `Hybrid net: only the discrete part is analysed (${contPlaces.size} continuous place${contPlaces.size === 1 ? "" : "s"} and ${contTrans.size} continuous transition${contTrans.size === 1 ? "" : "s"} left out, with their arcs).`,
      );
    work = {
      ...work,
      netClass: "xpt",
      places: work.places.filter((p) => !contPlaces.has(p.id)),
      transitions: work.transitions.filter((t) => !contTrans.has(t.id)),
      arcs: work.arcs.filter((a) => !contPlaces.has(a.source) && !contPlaces.has(a.target) && !contTrans.has(a.source) && !contTrans.has(a.target)),
    };
  } else if (work.netClass !== "pt" && work.netClass !== "xpt" && work.netClass !== "modulo") {
    work = { ...work, netClass: "xpt" };
  }
  if (base === "stochastic" || base === "hybrid" || net.netClass === "timed")
    warnings.push("Rates, delays and priorities are ignored: the untimed underlying net is analysed (its behaviour includes every timed run).");

  // 3. Compile (drops coarse nodes, merges logical places into slots). Observers only plot values.
  if (work.declarations.observers?.length) work = { ...work, declarations: { ...work.declarations, observers: [] } };
  const cn: CompiledNet = compile(work);
  for (const p of cn.problems) {
    if (p.severity !== "error") continue;
    if (p.message.startsWith("Constant ")) warnings.push(p.message);
    else errors.push(p.message);
  }

  // Node references.
  const uPlace = new Map(mapping?.places.map((p) => [p.id, p]));
  const uTrans = new Map(mapping?.transitions.map((t) => [t.id, t]));
  const places: NodeRef[] = cn.slotPlaces.map((members) => {
    const first = members[0];
    const u = uPlace.get(first.id);
    if (!u) return { id: first.id, name: first.name, elementIds: members.map((m) => m.id) };
    const ids = [...new Set(members.map((m) => uPlace.get(m.id)?.placeId ?? m.id))];
    const dot = u.colourText === "dot";
    return {
      id: first.id,
      name: dot ? u.placeName : `${u.placeName}[${colourName(u.colourText)}]`,
      elementIds: ids,
      baseName: u.placeName,
      ...(dot ? {} : { colour: u.colourText }),
    };
  });
  const transitions: NodeRef[] = cn.transitions.map((t) => {
    const u = uTrans.get(t.id);
    if (!u) return { id: t.id, name: t.name, elementIds: [t.id] };
    const b = Object.entries(u.binding)
      .map(([k, v]) => `${k}=${showValue(v)}`)
      .join(", ");
    return { id: t.id, name: b ? `${u.transitionName}<${b}>` : u.transitionName, elementIds: [u.transitionId], baseName: u.transitionName, ...(b ? { colour: b } : {}) };
  });

  // Initial marking and capacities per slot.
  const M0 = initialMarking(cn);
  const m0 = M0.map((m) => m.size);
  const capacity = cn.slotPlaces.map((members) => {
    const caps = members.map((m) => m.capacity).filter((c): c is number => c !== undefined);
    return caps.length ? Math.min(...caps) : undefined;
  });

  // Arcs with constant weights where possible.
  const constEnv = envFor(cn, {});
  const slotByName = new Map<string, number>();
  for (const p of cn.places) if (!slotByName.has(p.name)) slotByName.set(p.name, p.slot);
  const arcs: PTArc[] = [];
  const kinds = new Set<string>();
  let modifiers = 0;
  for (const t of cn.transitions) {
    for (const [dir, list] of [["in", t.inputs], ["out", t.outputs]] as const) {
      for (const a of list) {
        const kind = a.arc.kind;
        if (kind === "modifier") {
          modifiers++;
          continue;
        }
        kinds.add(kind);
        const label = dir === "in" ? `${places[a.place.slot].name} → ${transitions[t.index].name}` : `${transitions[t.index].name} → ${places[a.place.slot].name}`;
        const arc: PTArc = { arcId: a.arc.id, kind, dir, place: a.place.slot, transition: t.index, weight: null, label };
        if (kind === "reset") arc.weight = 0;
        else if (a.expr) {
          try {
            const w = num(evaluate(a.expr, constEnv));
            if (!Number.isInteger(w) || w < 0) errors.push(`Arc ${label}: the weight must be a whole number of zero or more, got ${w}`);
            else arc.weight = w;
          } catch (e) {
            const ids = identifiers(a.expr);
            if ([...ids].some((n) => slotByName.has(n) && !cn.constants.has(n))) {
              arc.expr = a.expr;
              warnings.push(`Arc ${label} has a marking-dependent weight; structural results (incidence matrix, invariants, siphons, traps, structural properties) ignore it.`);
            } else errors.push(`Arc ${label}: ${(e as Error).message}`);
          }
        }
        arcs.push(arc);
      }
    }
  }
  if (modifiers) warnings.push(`${modifiers} modifier arc${modifiers === 1 ? "" : "s"} ignored: they influence rates only.`);
  if (kinds.has("read")) warnings.push("Read arcs are treated as self-loops (an input and an output arc of the same weight) by the structural analysis.");
  if (kinds.has("inhibitor") || kinds.has("equal"))
    warnings.push(
      "Inhibitor/equal arcs are ignored by the structural analysis. P-invariants still hold (these arcs only restrict firing), but conclusions about liveness and deadlocks drawn from invariants, siphons and traps are unsound; rely on the state space.",
    );
  if (kinds.has("reset"))
    warnings.push("Reset arcs are ignored by the structural analysis, so invariant-based conclusions (including token sums and boundedness from P-invariants) are unsound; rely on the state space.");
  if (capacity.some((c) => c !== undefined))
    warnings.push("Place capacities are ignored by the structural analysis (they only restrict firing) and respected by the state space.");
  if (cn.modulus) warnings.push(`Modulo net: tokens count modulo ${cn.modulus} in the state space; structural results refer to the ordinary integer net.`);

  const envAt = (M: ArrayLike<number>): EvalEnv => ({
    ...constEnv,
    lookup(name) {
      const v = constEnv.lookup(name);
      if (v !== undefined) return v;
      const s = slotByName.get(name);
      return s === undefined ? undefined : M[s];
    },
  });

  return { places, transitions, arcs, m0, capacity, modulus: cn.modulus, unfolded: !!mapping, warnings, errors, envAt };
}

/** Pre and Post matrices (places × transitions) of the structural net: normal arcs, read arcs as self-loops. */
export function structuralMatrices(pt: PTNet): { pre: number[][]; post: number[][]; ignoredArcs: string[] } {
  const n = pt.places.length;
  const m = pt.transitions.length;
  const pre = Array.from({ length: n }, () => new Array<number>(m).fill(0));
  const post = Array.from({ length: n }, () => new Array<number>(m).fill(0));
  const ignoredArcs: string[] = [];
  for (const a of pt.arcs) {
    if (a.kind === "inhibitor" || a.kind === "equal" || a.kind === "reset") continue;
    if (a.weight === null) {
      ignoredArcs.push(a.arcId);
      continue;
    }
    if (a.kind === "read") {
      pre[a.place][a.transition] += a.weight;
      post[a.place][a.transition] += a.weight;
    } else if (a.dir === "in") pre[a.place][a.transition] += a.weight;
    else post[a.place][a.transition] += a.weight;
  }
  return { pre, post, ignoredArcs };
}

/** Throw an AbortError if the signal fired. */
export function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) {
    const e = new Error("Analysis aborted");
    e.name = "AbortError";
    throw e;
  }
}
