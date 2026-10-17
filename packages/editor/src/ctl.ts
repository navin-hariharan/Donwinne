// Verification of ambient systems (Konios 2015, ch. 7) in the editor: building the state space the
// CTL checker works on, under the semantics the user picks, and replaying witnesses,
// counterexamples and paths in the token game.

import { Net, enabledBindings, fire, isAmbient, showValue } from "@pns/core";
import { PTNet, TraceStep, TransitionSystem, buildTransitionSystem, toPTNet, transitionSystemFromStepGraph } from "@pns/analysis";
import { Step, asAmbient, concurrentReachabilityGraphAsync } from "@pns/apn";
import { SimStep, compiled, startSimulation, toast, useStore } from "./store";
import { replaySteps } from "./ambient";

/** How the state space is built: firing one transition at a time, or (ambient nets) by steps. */
export type CtlSemantics = "interleaving" | "steps" | "maximal" | "colourBlind";

export const SEMANTICS_LABEL: Record<CtlSemantics, string> = {
  maximal: "Maximal steps",
  steps: "All steps: CRG(N)",
  interleaving: "One transition at a time",
  colourBlind: "Colour-blind (as in the thesis)",
};

/**
 * The thesis (ch. 7) checks its formulas sequentially on the T-APN with colours ignored, as Charlie
 * reads a Snoopy net: token counts summed over colours, one transition per coloured transition.
 */
export function semanticsFor(net: Net): CtlSemantics[] {
  return isAmbient(net.netClass) ? ["maximal", "steps", "interleaving", "colourBlind"] : ["interleaving"];
}

const ptCache = new WeakMap<Net, PTNet | Error>();
/** The unfolded P/T view of a net: the names formulas are written with (p, p[c], t<x=c>). */
export function vocabularyOf(net: Net): PTNet | Error {
  let v = ptCache.get(net);
  if (!v) {
    try {
      v = toPTNet(net);
    } catch (e) {
      v = e as Error;
    }
    ptCache.set(net, v);
  }
  return v;
}

/** Place names a template field can take: each place, and each place with one of its colours, e.g. p1[b]. */
export function placeChoices(net: Net): { value: string; label: string }[] {
  const v = vocabularyOf(net);
  if (v instanceof Error) return net.places.filter((p) => !p.coarse).map((p) => ({ value: p.name, label: p.name }));
  const out: { value: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const p of v.places) {
    const base = p.baseName ?? p.name;
    if (!seen.has(base)) {
      seen.add(base);
      out.push({ value: base, label: base });
    }
    if (p.baseName && p.colour !== undefined && p.name !== base) out.push({ value: p.name, label: `  ${p.name}` });
  }
  return out;
}

/** Transition names for path queries: each transition, and each of its unfolded bindings. */
export function transitionChoices(net: Net): string[] {
  const v = vocabularyOf(net);
  if (v instanceof Error) return net.transitions.filter((t) => !t.coarse).map((t) => t.name);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of v.transitions) {
    const base = t.baseName ?? t.name;
    if (!seen.has(base)) (seen.add(base), out.push(base));
    if (t.name !== base) out.push(t.name);
  }
  return out;
}

/**
 * Build the transition system for model checking. Ambient nets can use their concurrent
 * reachability graph (all steps, or maximal steps only); other nets the interleaving graph.
 */
export async function buildSystem(
  net: Net,
  semantics: CtlSemantics,
  opts: { maxStates: number; signal: AbortSignal; onProgress?: (states: number) => void },
): Promise<TransitionSystem> {
  if (semantics === "interleaving" || semantics === "colourBlind") {
    // Let the dialog paint its progress line before the synchronous exploration.
    await new Promise((r) => setTimeout(r, 30));
    return buildTransitionSystem(net, {
      maxStates: opts.maxStates,
      signal: opts.signal,
      projection: semantics === "colourBlind" ? "colourBlind" : "coloured",
    });
  }
  const g = await concurrentReachabilityGraphAsync(net, {
    maximalOnly: semantics === "maximal",
    maxStates: opts.maxStates,
    maxEdges: opts.maxStates * 40,
    maxStepsPerState: 2000,
    signal: opts.signal,
    yieldEvery: 40,
    onProgress: (s) => opts.onProgress?.(s),
  });
  if (opts.signal.aborted) {
    const e = new Error("Stopped");
    e.name = "AbortError";
    throw e;
  }
  return transitionSystemFromStepGraph(net, g);
}

/** The value of the binding text of an unfolded transition, e.g. "x=b" gives the colour b. */
function bindingParts(text: string | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of (text ?? "").split(/,\s*(?=[A-Za-z_][\w]*=)/)) {
    const i = part.indexOf("=");
    if (i > 0) m.set(part.slice(0, i).trim(), part.slice(i + 1).trim().replace(/\s+/g, ""));
  }
  return m;
}

/**
 * Replay a trace or path from the initial marking in the token game: as steps of structured
 * transitions in an ambient net, as single firings with the matching binding otherwise.
 * Returns false when some firing could not be matched.
 */
export function replayTrace(steps: readonly TraceStep[]): boolean {
  const net = useStore.getState().net;
  if (isAmbient(net.netClass)) {
    const an = asAmbient(net);
    const out: Step[] = [];
    for (const st of steps) {
      const U: Step = [];
      for (const ref of st.transitions) {
        const t = an.transitions.find((x) => x.id === ref.elementIds[0]) ?? an.transitions.find((x) => x.name === (ref.baseName ?? ref.name));
        if (!t) return failed(ref.name);
        const parts = bindingParts(ref.colour);
        const want = (t.modeVariable && parts.get(t.modeVariable)) ?? [...parts.values()][0];
        const c = t.modes.find((v) => showValue(v).replace(/\s+/g, "") === want) ?? (t.modes.length === 1 ? t.modes[0] : undefined);
        if (c === undefined && !ref.colour) {
          toast("A colour-blind trace does not say which colour (user) moved, so it cannot be replayed. Check with a coloured semantics to get a replayable trace.", "error");
          return false;
        }
        if (c === undefined) return failed(ref.name);
        U.push({ transition: t.id, colour: c });
      }
      out.push(U);
    }
    useStore.setState({ dialog: null });
    return replaySteps(out) === out.length;
  }
  useStore.setState({ dialog: null });
  if (useStore.getState().mode !== "simulate") startSimulation();
  const s = useStore.getState();
  if (s.mode !== "simulate") return false;
  const cn = compiled(s.net);
  const sim: SimStep[] = [s.sim[0]];
  let M = s.sim[0].marking;
  for (const st of steps) {
    const ref = st.transitions[0];
    const t = cn.transitions.find((x) => x.id === ref?.elementIds[0]) ?? cn.transitions.find((x) => x.name === (ref?.baseName ?? ref?.name));
    const parts = bindingParts(ref?.colour);
    const bs = t ? enabledBindings(cn, t.index, M).bindings : [];
    const b = bs.find((x) => Object.entries(x).every(([k, v]) => !parts.has(k) || parts.get(k) === showValue(v as never).replace(/\s+/g, ""))) ?? bs[0];
    if (!t || !b) {
      useStore.setState({ sim, simIndex: sim.length - 1 });
      return failed(ref?.name ?? "?");
    }
    M = fire(cn, t.index, b, M);
    sim.push({ marking: M, label: st.label, transitionId: t.id });
  }
  useStore.setState({ sim, simIndex: sim.length - 1, panel: "simulation" });
  return true;
}

function failed(name: string): false {
  toast(`Could not replay ${name} in the token game`, "error");
  return false;
}
