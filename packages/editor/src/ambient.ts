// Konios's Ambient Petri nets in the editor: the step token game, explanations of why a structured
// transition (t, c) cannot fire, the T-APN construction and the equivalence check, and inserting
// building blocks into the current net.

import { create } from "zustand";
import { Marking, Net, Value, isAmbient, newId, showValue, valueKey } from "@pns/core";
import {
  AmbientNet,
  ConstructionResult,
  EquivalenceResult,
  Step,
  StructuredTransition,
  ambientErrors,
  arcColour,
  asAmbient,
  checkEquivalence,
  constructTapn,
  enabledSteps,
  enabledStructuredTransitions,
  fireStep,
  isStepEnabled,
  normaliseStep,
  showStep,
  runStepSequence,
} from "@pns/apn";
import { SimStep, edit, loadNet, startSimulation, toast, useStore } from "./store";

/** Step semantics apply: the net is an APN or a T-APN. */
export function isAmbientNet(net: Net): boolean {
  return isAmbient(net.netClass);
}

export interface AmbientState {
  /** Structured transitions picked to fire together as one step. */
  pending: StructuredTransition[];
  /** Tapping a transition on the canvas adds it to the pending step instead of firing it. */
  collecting: boolean;
  /** The step lists and random firing use maximal steps only. */
  maximalOnly: boolean;
  /** Colour picker for a transition tapped on the canvas, in canvas coordinates. */
  picker: { transitionId: string; x: number; y: number } | null;
  /** The last T-APN construction: its APN, kept for the equivalence check. */
  construction: { apn: Net; result: ConstructionResult; tapnName: string } | null;
}

export const useAmbient = create<AmbientState>(() => ({ pending: [], collecting: false, maximalOnly: false, picker: null, construction: null }));

const setA = useAmbient.setState;
const getA = useAmbient.getState;

// A pending step belongs to the marking it was picked in.
useStore.subscribe((s, prev) => {
  if (s.simIndex !== prev.simIndex || s.sim !== prev.sim || s.mode !== prev.mode || s.net !== prev.net) {
    const a = getA();
    if (a.pending.length || a.picker) setA({ pending: [], picker: null });
    if (s.mode !== prev.mode && s.mode === "edit") setA({ collecting: false });
  }
});

export const stKey = (st: StructuredTransition) => `${st.transition}:${valueKey(st.colour)}`;

export function showST(net: Net | AmbientNet, st: StructuredTransition): string {
  const an = asAmbient(net);
  return `(${an.transitions.find((t) => t.id === st.transition)?.name ?? st.transition},${showValue(st.colour)})`;
}

/** The structured transitions (t, c) of the net, enabled or not. */
export function allStructured(net: Net): StructuredTransition[] {
  return asAmbient(net).transitions.flatMap((t) => t.modes.map((colour) => ({ transition: t.id, colour })));
}

/** Limits that keep the step lists quick in the token game. */
export const STEP_LIMITS = { maxSteps: 400, maxNodes: 40_000 };

const enabledCache = new WeakMap<Marking, { net: Net; list: StructuredTransition[] }>();
/** The structured transitions enabled on their own at M (cached per marking). */
export function enabledAt(net: Net, M: Marking): StructuredTransition[] {
  const c = enabledCache.get(M);
  if (c && c.net === net) return c.list;
  let list: StructuredTransition[] = [];
  try {
    list = enabledStructuredTransitions(net, M);
  } catch {
    list = [];
  }
  enabledCache.set(M, { net, list });
  return list;
}

// ---------- why (t, c) cannot fire ----------

export interface BlockReason {
  kind: "token" | "inhibitor" | "capacity" | "colour";
  text: string;
  arcId?: string;
  placeId?: string;
}

function placeName(an: AmbientNet, id: string): string {
  return an.cn.places.find((p) => p.id === id)?.name ?? id;
}

/**
 * Why the structured transition (t, c) is not enabled at M on its own (Konios Sec. 3.3 / 5.2): a
 * missing token (p, g), a colour-sensitive inhibitor place holding c, or a full place (p, g).
 * Empty when it is enabled.
 */
export function whyBlocked(net: Net, M: Marking, st: StructuredTransition): BlockReason[] {
  const an = asAmbient(net);
  const t = an.transitions.find((x) => x.id === st.transition);
  if (!t) return [];
  const c = st.colour;
  const out: BlockReason[] = [];
  const name = `(${t.name},${showValue(c)})`;
  const need = new Map<string, { slot: number; g: Value; n: number; placeId: string }>();
  for (const a of t.pre) {
    const g = arcColour(an, a, c);
    if (g === undefined) {
      out.push({ kind: "colour", text: `${name} has no complementary colour f(${showValue(c)}) for the arc from ${placeName(an, a.placeId)}`, arcId: a.arcId });
      continue;
    }
    const k = `${a.slot}|${valueKey(g)}`;
    const e = need.get(k) ?? { slot: a.slot, g, n: 0, placeId: a.placeId };
    e.n++;
    need.set(k, e);
  }
  for (const e of need.values()) {
    const have = M[e.slot]?.count(e.g) ?? 0;
    if (have < e.n)
      out.push({
        kind: "token",
        text: e.n === 1 ? `${placeName(an, e.placeId)} holds no ${showValue(e.g)}` : `${placeName(an, e.placeId)} holds ${have} of the ${e.n} tokens ${showValue(e.g)} it needs`,
        placeId: e.placeId,
      });
  }
  for (const a of t.inhibitors) {
    const g = arcColour(an, a, c);
    if (g === undefined) continue;
    if ((M[a.slot]?.count(g) ?? 0) > 0)
      out.push({
        kind: "inhibitor",
        text: `${placeName(an, a.placeId)} holds ${showValue(g)}, and its colour-sensitive inhibitor arc blocks ${name}`,
        arcId: a.arcId,
        placeId: a.placeId,
      });
  }
  if (!out.some((r) => r.kind === "token")) {
    const weak = an.hasSelfLoop;
    const produced = new Map<string, { slot: number; g: Value; n: number; placeId: string }>();
    for (const a of t.post) {
      const g = arcColour(an, a, c);
      if (g === undefined) continue;
      const k = `${a.slot}|${valueKey(g)}`;
      const e = produced.get(k) ?? { slot: a.slot, g, n: 0, placeId: a.placeId };
      e.n++;
      produced.set(k, e);
    }
    for (const [k, e] of produced) {
      const base = (M[e.slot]?.count(e.g) ?? 0) - (weak ? need.get(k)?.n ?? 0 : 0);
      const cap = an.capacity(e.slot, e.g);
      if (base + e.n > cap)
        out.push({
          kind: "capacity",
          text: cap === 0 ? `${showValue(e.g)} is not a colour of ${placeName(an, e.placeId)}` : `${placeName(an, e.placeId)} already holds ${showValue(e.g)} (capacity ${cap} per colour)`,
          placeId: e.placeId,
        });
    }
  }
  if (!out.length && !isStepEnabled(an, M, [st])) out.push({ kind: "token", text: `${name} is not enabled in this marking` });
  return out;
}

/** Why two structured transitions that can each fire alone cannot fire together (Def. 4). */
export function conflictReason(net: Net, M: Marking, a: StructuredTransition, b: StructuredTransition): string {
  const an = asAmbient(net);
  const ta = an.transitions.find((x) => x.id === a.transition);
  const tb = an.transitions.find((x) => x.id === b.transition);
  if (!ta || !tb) return "";
  const use = (t: typeof ta, st: StructuredTransition, arcs: typeof ta.pre) =>
    arcs.map((x) => ({ slot: x.slot, placeId: x.placeId, g: arcColour(an, x, st.colour) })).filter((x) => x.g !== undefined) as { slot: number; placeId: string; g: Value }[];
  const preA = use(ta, a, ta.pre);
  const preB = use(tb, b, tb.pre);
  for (const x of preA) {
    if (preB.some((y) => y.slot === x.slot && valueKey(y.g) === valueKey(x.g)) && (M[x.slot]?.count(x.g) ?? 0) < 2)
      return `both need the token ${showValue(x.g)} in ${placeName(an, x.placeId)}`;
  }
  const postA = use(ta, a, ta.post);
  const postB = use(tb, b, tb.post);
  for (const x of postA)
    if (postB.some((y) => y.slot === x.slot && valueKey(y.g) === valueKey(x.g))) return `both put ${showValue(x.g)} into ${placeName(an, x.placeId)}, beyond its capacity`;
  return "together they need more tokens or room than the marking offers";
}

/** Is the pending step enabled, and if not, why? */
export function pendingStatus(net: Net, M: Marking, pending: StructuredTransition[]): { ok: boolean; text: string } {
  if (!pending.length) return { ok: false, text: "" };
  if (isStepEnabled(net, M, pending)) return { ok: true, text: pending.length === 1 ? "Enabled" : `Enabled: these ${pending.length} fire together as one step` };
  for (const st of pending) {
    const r = whyBlocked(net, M, st);
    if (r.length) return { ok: false, text: `${showST(net, st)} cannot fire: ${r[0].text}` };
  }
  for (let i = 0; i < pending.length; i++)
    for (let j = i + 1; j < pending.length; j++)
      if (!isStepEnabled(net, M, [pending[i], pending[j]]))
        return { ok: false, text: `${showST(net, pending[i])} and ${showST(net, pending[j])} are in conflict (Def. 4): ${conflictReason(net, M, pending[i], pending[j])}` };
  return { ok: false, text: "Not enabled as one step: together they need more tokens or room than the marking offers" };
}

/** Colour-sensitive inhibitor arcs that block some colour mode at M, with the colours they block. */
export function blockingInhibitors(net: Net, M: Marking): Map<string, string[]> {
  const an = asAmbient(net);
  const out = new Map<string, string[]>();
  for (const t of an.transitions)
    for (const a of t.inhibitors)
      for (const c of t.modes) {
        const g = arcColour(an, a, c);
        if (g === undefined || (M[a.slot]?.count(g) ?? 0) === 0) continue;
        const list = out.get(a.arcId) ?? [];
        const s = showValue(g);
        if (!list.includes(s)) list.push(s);
        out.set(a.arcId, list);
      }
  return out;
}

// ---------- firing ----------

function current(): { net: Net; M: Marking } | null {
  const s = useStore.getState();
  if (s.mode !== "simulate") return null;
  const M = s.sim[s.simIndex]?.marking;
  return M ? { net: s.net, M } : null;
}

/** Fire a step U in the token game: M' = M − Pre(U) + Post(U). */
export function fireAmbientStep(step: Step): boolean {
  const c = current();
  if (!c || !step.length) return false;
  try {
    const U = normaliseStep(c.net, step);
    const marking = fireStep(c.net, c.M, U);
    const s = useStore.getState();
    const entry: SimStep = { marking, label: showStep(c.net, U), transitionId: U[0].transition, transitionIds: U.map((x) => x.transition), step: U };
    useStore.setState({ sim: [...s.sim.slice(0, s.simIndex + 1), entry], simIndex: s.simIndex + 1, bindingPicker: null });
    setA({ pending: [], picker: null });
    return true;
  } catch (e) {
    toast((e as Error).message, "error");
    return false;
  }
}

export function togglePending(st: StructuredTransition) {
  const k = stKey(st);
  const p = getA().pending;
  setA({ pending: p.some((x) => stKey(x) === k) ? p.filter((x) => stKey(x) !== k) : [...p, st] });
}

export function firePending() {
  const c = current();
  const p = getA().pending;
  if (!c || !p.length) return;
  const status = pendingStatus(c.net, c.M, p);
  if (!status.ok) {
    toast(status.text, "error");
    return;
  }
  fireAmbientStep(p);
}

function pick<T>(xs: T[]): T {
  return xs[Math.floor(Math.random() * xs.length)];
}

/** The enabled steps at the current marking, all of them or only the maximal ones. */
export function stepsAt(net: Net, M: Marking, maximalOnly: boolean) {
  try {
    return enabledSteps(net, M, { maximalOnly, ...STEP_LIMITS });
  } catch {
    return { steps: [] as Step[], truncated: false, enabled: [] as StructuredTransition[] };
  }
}

/** Fire one maximal step, chosen at random among the maximal steps. */
export function fireMaximalStep(): boolean {
  const c = current();
  if (!c) return false;
  const r = stepsAt(c.net, c.M, true);
  if (!r.steps.length) {
    toast("No step is enabled: the net is dead in this marking");
    useStore.setState({ running: false });
    return false;
  }
  return fireAmbientStep(pick(r.steps));
}

/** Random firing in the token game: a random enabled step (or maximal step, when that toggle is on). */
export function stepRandomAmbient(): boolean {
  const c = current();
  if (!c) return false;
  if (getA().maximalOnly) return fireMaximalStep();
  const en = enabledAt(c.net, c.M);
  if (!en.length) {
    toast("No step is enabled: the net is dead in this marking");
    useStore.setState({ running: false });
    return false;
  }
  // A single structured transition most of the time, a larger step now and then.
  const r = Math.random() < 0.7 ? null : stepsAt(c.net, c.M, false);
  return fireAmbientStep(r && r.steps.length ? pick(r.steps) : [pick(en)]);
}

/** Replay a step sequence from the initial marking in the token game; returns how many steps fired. */
export function replaySteps(steps: Step[], then?: Step): number {
  const s = useStore.getState();
  if (s.mode !== "simulate") startSimulation();
  const st = useStore.getState();
  if (st.mode !== "simulate") return 0;
  const net = st.net;
  const r = runStepSequence(net, steps);
  const sim: SimStep[] = [st.sim[0]];
  for (let i = 1; i < r.markings.length; i++) {
    const U = steps[i - 1];
    sim.push({ marking: r.markings[i], label: showStep(net, U), transitionId: U[0]?.transition, transitionIds: U.map((x) => x.transition), step: U });
  }
  useStore.setState({ sim, simIndex: sim.length - 1, trailFrom: 0, panel: "simulation" });
  if (!r.ok) toast(`Step ${r.failedAt + 1} of the sequence is not enabled in this net`, "error");
  if (then?.length) setA({ pending: then.filter((x) => net.transitions.some((t) => t.id === x.transition)) });
  return r.markings.length - 1;
}

/** Map a step over one net's transitions onto another net with the same transition ids or names. */
export function relabelStep(from: Net, to: Net, step: Step): Step {
  return step.map((x) => {
    if (to.transitions.some((t) => t.id === x.transition)) return x;
    const name = from.transitions.find((t) => t.id === x.transition)?.name;
    const t = to.transitions.find((y) => y.name === name);
    return t ? { transition: t.id, colour: x.colour } : x;
  });
}

// ---------- commands ----------

export function ambientProblem(net: Net, need: "apn" | "ambient"): string | null {
  if (need === "apn" && net.netClass !== "apn") return net.netClass === "tapn" ? "This is already a T-APN" : "This needs an APN: switch the net class to APN first";
  if (need === "ambient" && !isAmbient(net.netClass)) return "This needs an APN or a T-APN: switch the net class first";
  return null;
}

/** Build the T-APN φ(N) of the current APN and open it as a new model (Konios Def. 21). */
export function cmdConstructTapn() {
  const s = useStore.getState();
  const why = ambientProblem(s.net, "apn");
  if (why) return toast(why, "error");
  const errs = ambientErrors(s.net);
  if (errs.length) {
    useStore.setState({ panel: "problems", bottomOpen: true });
    return toast(`Fix the problems in the APN first: ${errs[0].message}`, "error");
  }
  if (s.dirty && !window.confirm("The T-APN opens as a new model. Discard unsaved changes to this APN?")) return;
  try {
    const apn = s.net;
    const result = constructTapn(apn);
    loadNet(result.net, null);
    useStore.setState({ dirty: true, dialog: "tapn" });
    setA({ construction: { apn, result, tapnName: result.net.name } });
  } catch (e) {
    toast(`Could not construct the T-APN: ${(e as Error).message}`, "error");
  }
}

/** The APN to compare the current net with, and the T-APN, or why the check cannot run. */
export function equivalencePair(net: Net): { apn: Net; tapn?: Net } | string {
  if (net.netClass === "apn") return { apn: net };
  if (net.netClass === "tapn") {
    const c = getA().construction;
    if (c) return { apn: c.apn, tapn: net };
    return "Open the APN and check equivalence there: this T-APN was not constructed in this session";
  }
  return "Equivalence compares an APN with its T-APN; switch the net class to APN first";
}

/** Run the equivalence check (synchronous; limits keep it short). */
export function runEquivalence(net: Net, maxStates: number): EquivalenceResult {
  const pair = equivalencePair(net);
  if (typeof pair === "string") throw new Error(pair);
  return checkEquivalence(pair.apn, { tapn: pair.tapn, maxStates, maxStepsPerState: 2000 });
}

/** Reopen the APN the current T-APN was built from. */
export function reopenApn() {
  const c = getA().construction;
  if (!c) return;
  if (useStore.getState().dirty && !window.confirm("Reopen the APN? Unsaved changes to this T-APN are lost.")) return;
  loadNet(c.apn, null);
}

// ---------- building blocks ----------

/** Bounding box of a net's nodes. */
export function netBounds(net: Net): { x: number; y: number; w: number; h: number } {
  const pts = [...net.places, ...net.transitions].map((n) => ({ x: n.x, y: n.y }));
  if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/**
 * Add a building block to the current APN, to the right of what is drawn, with fresh ids. Its colour
 * set and variable must match the net's (same name, same definition) or be new. Returns the ids of
 * the new nodes, or an error message.
 */
export function insertBlock(block: Net): { ids: string[] } | { error: string } {
  const net = useStore.getState().net;
  const decl = net.declarations;
  for (const cs of block.declarations.colourSets) {
    const old = decl.colourSets.find((c) => c.name === cs.name);
    if (old && JSON.stringify({ ...old, name: "" }) !== JSON.stringify({ ...cs, name: "" })) return { error: `The net already has a different colour set called ${cs.name}` };
  }
  for (const v of block.declarations.variables) {
    const old = decl.variables.find((x) => x.name === v.name);
    if (old && old.colourSet !== v.colourSet) return { error: `The net already has a variable ${v.name} over ${old.colourSet}` };
  }
  const names = new Set([...net.places, ...net.transitions].map((n) => n.name));
  const clash = [...block.places, ...block.transitions].find((n) => names.has(n.name));
  if (clash) return { error: `The net already has an element called ${clash.name}; choose other names` };
  const nb = netBounds(net);
  const bb = netBounds(block);
  const hasNodes = net.places.length + net.transitions.length > 0;
  const dx = hasNodes ? nb.x + nb.w + 200 - bb.x : 120 - bb.x;
  const dy = hasNodes ? nb.y - bb.y : 120 - bb.y;
  const ids = new Map<string, string>();
  for (const p of block.places) ids.set(p.id, newId("p"));
  for (const t of block.transitions) ids.set(t.id, newId("t"));
  const page = useStore.getState().page ?? undefined;
  const places = block.places.map((p) => ({ ...p, id: ids.get(p.id)!, x: p.x + dx, y: p.y + dy, parent: page }));
  const transitions = block.transitions.map((t) => ({ ...t, id: ids.get(t.id)!, x: t.x + dx, y: t.y + dy, parent: page }));
  const arcs = block.arcs.map((a) => ({ ...a, id: newId("a"), source: ids.get(a.source)!, target: ids.get(a.target)!, points: a.points?.map((q) => ({ x: q.x + dx, y: q.y + dy })) }));
  edit((n) => ({
    ...n,
    netClass: "apn",
    places: [...n.places, ...places],
    transitions: [...n.transitions, ...transitions],
    arcs: [...n.arcs, ...arcs],
    declarations: {
      ...n.declarations,
      colourSets: [...n.declarations.colourSets, ...block.declarations.colourSets.filter((c) => !n.declarations.colourSets.some((o) => o.name === c.name))],
      variables: [...n.declarations.variables, ...block.declarations.variables.filter((v) => !n.declarations.variables.some((o) => o.name === v.name))],
    },
  }));
  const all = [...places, ...transitions].map((n) => n.id);
  useStore.setState({ selection: all });
  return { ids: all };
}

/** A name not used by any place or transition: base, base2, base3, … */
export function freeName(net: Net, base: string, taken: string[] = []): string {
  const used = new Set([...net.places, ...net.transitions].map((n) => n.name).concat(taken));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`;
}

/** The next free name of the form prefix + number, e.g. p7 or t4. */
export function nextNumbered(net: Net, prefix: string, taken: string[] = []): string {
  const used = new Set([...net.places, ...net.transitions].map((n) => n.name).concat(taken));
  for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`;
}

/** Open one of the ambient dialogs, or say why it does not apply to the current net. */
export function openAmbientDialog(dialog: "crg" | "apnProps" | "equivalence" | "blocks" | "compose") {
  const net = useStore.getState().net;
  const why = dialog === "blocks" ? null : dialog === "compose" ? ambientProblem(net, "apn") : dialog === "equivalence" ? (typeof equivalencePair(net) === "string" ? (equivalencePair(net) as string) : null) : ambientProblem(net, "ambient");
  if (why) return toast(why, "error");
  useStore.setState({ dialog, contextMenu: null });
}
