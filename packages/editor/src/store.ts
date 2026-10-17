import { create } from "zustand";
import {
  Arc,
  ArcKind,
  Binding,
  CompiledNet,
  FTNode,
  FTNodeType,
  Marking,
  Net,
  NetClass,
  Note,
  Place,
  Point,
  Problem,
  Transition,
  allowsExtendedArcs,
  arcKindsFor,
  compile,
  defaultTransitionKind,
  emptyNet,
  fire,
  initialMarking,
  isAmbient,
  isColoured,
  isFaultTree,
  isPlace,
  newId,
  nextName,
  showBinding,
  timeBase,
} from "@pns/core";
import { snap } from "./geometry";
import { screenClassFor } from "./responsive";
import { validateFaultTree } from "@pns/ft";
import { Step, ambientErrors } from "@pns/apn";
import { TimedState, timedDelay, timedEnabled, timedFire, timedInit } from "@pns/sim";

/** Dialogs for Konios's Ambient Petri nets. */
export type AmbientDialog = "crg" | "tapn" | "equivalence" | "apnProps" | "blocks" | "compose";

export type Tool = "select" | "place" | "transition" | "arc" | "note" | `ft:${FTNodeType}`;
export type Mode = "edit" | "simulate";

export interface SimStep {
  marking: Marking;
  label: string;
  transitionId?: string;
  /** Timed nets: clocks and global time after this step. */
  timed?: TimedState;
  /** Ambient nets: the step U that was fired, and the transitions in it. */
  step?: Step;
  transitionIds?: string[];
}

export interface View {
  x: number;
  y: number;
  zoom: number;
}

export interface Clipboard {
  places: Place[];
  transitions: Transition[];
  arcs: Arc[];
  notes: Note[];
  ftNodes: FTNode[];
}

export type InlineField = "name" | "marking" | "inscription" | "note" | "rate";

export interface State {
  net: Net;
  filePath: string | null;
  fileName: string | null;
  /** Browser File System Access handle, when the file was opened or saved that way. */
  fileHandle: unknown;
  dirty: boolean;
  past: Net[];
  future: Net[];

  selection: string[];
  tool: Tool;
  arcKind: ArcKind;
  snapToGrid: boolean;
  view: View;
  /** The coarse node whose subnet is shown; null = top level. */
  page: string | null;

  mode: Mode;
  sim: SimStep[];
  simIndex: number;
  running: boolean;
  speed: number; // firings per second
  sound: boolean;

  toast: { text: string; kind: "info" | "error" } | null;
  bindingPicker: { transitionId: string; bindings: Binding[]; x: number; y: number } | null;
  contextMenu: { x: number; y: number; world: Point; targetId: string | null } | null;
  inlineEdit: { id: string; field: InlineField } | null;
  dialog: null | "new" | "help" | "search" | "rg" | "about" | "analysis" | AmbientDialog | "ctl";
  theme: "light" | "dark" | "system";
  panel: "problems" | "elements" | "simulation" | "plot" | "faultTree";
  bottomOpen: boolean;
  /** On screens without the docked properties panel: whether its sheet or drawer is open. */
  propsOpen: boolean;
  /** Bumped to ask the fault tree panel to run its analysis. */
  ftRunRequest: number;
  /** Heights and widths the user dragged the panel dividers to; undefined = default. */
  bottomHeight?: number;
  propsWidth?: number;
  fitRequest: number;
  showMinimap: boolean;
  seenWelcome: boolean;
  /** Search hits, highlighted on the canvas. */
  highlight: string[];
  /** Fault tree events marked as failed (e.g. a cut set being inspected). */
  ftFailed: string[];
}

const compiledCache = new WeakMap<Net, CompiledNet>();
export function compiled(net: Net): CompiledNet {
  let cn = compiledCache.get(net);
  if (!cn) {
    cn = compile(net);
    compiledCache.set(net, cn);
  }
  return cn;
}

const problemCache = new WeakMap<Net, Problem[]>();
/** Problems in the model: firing-rule checks for Petri nets, structure checks for fault trees. */
export function problemsOf(net: Net): Problem[] {
  let ps = problemCache.get(net);
  if (!ps) {
    if (isFaultTree(net.netClass)) {
      try {
        ps = validateFaultTree(net);
      } catch (e) {
        ps = [{ severity: "error", message: (e as Error).message }];
      }
    } else if (net.netClass === "freestyle") ps = [];
    else ps = compiled(net).problems;
    problemCache.set(net, ps);
  }
  return ps;
}

const AUTOSAVE_KEY = "pns.autosave.v1";
const PREFS_KEY = "pns.prefs.v1";

type Prefs = Partial<Pick<State, "theme" | "snapToGrid" | "showMinimap" | "seenWelcome" | "sound" | "bottomHeight" | "propsWidth">>;

function loadPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function loadAutosave(): { net: Net; fileName: string | null } | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (v?.net?.format === "pns/1") return v;
  } catch {
    /* ignore */
  }
  return null;
}

const restored = typeof window !== "undefined" ? loadAutosave() : null;
const prefs: Prefs = typeof window !== "undefined" ? loadPrefs() : {};
const smallScreenNow = () => typeof window !== "undefined" && ["phone", "short"].includes(screenClassFor(window.innerWidth, window.innerHeight));
const smallScreenAtStart = smallScreenNow();
const hasContent = (n: Net | undefined) => !!n && (n.places.length + n.transitions.length + (n.faultTree?.nodes.length ?? 0) > 0);

export const useStore = create<State>(() => ({
  net: restored?.net ?? emptyNet("pt"),
  filePath: null,
  fileName: restored?.fileName ?? null,
  fileHandle: null,
  dirty: false,
  past: [],
  future: [],
  selection: [],
  tool: "select",
  arcKind: "normal",
  snapToGrid: prefs.snapToGrid ?? true,
  view: { x: 0, y: 0, zoom: 1 },
  page: null,
  mode: "edit",
  sim: [],
  simIndex: 0,
  running: false,
  speed: 4,
  sound: prefs.sound ?? true,
  toast: null,
  bindingPicker: null,
  contextMenu: null,
  inlineEdit: null,
  dialog: hasContent(restored?.net) ? null : "new",
  theme: prefs.theme ?? "system",
  panel: "problems",
  // Small screens start with the bottom panel folded away so the canvas gets the room.
  bottomOpen: !smallScreenAtStart,
  propsOpen: false,
  ftRunRequest: 0,
  bottomHeight: prefs.bottomHeight,
  propsWidth: prefs.propsWidth,
  fitRequest: restored ? 1 : 0,
  showMinimap: prefs.showMinimap ?? true,
  seenWelcome: prefs.seenWelcome ?? false,
  highlight: [],
  ftFailed: [],
}));

const set = useStore.setState;
const get = useStore.getState;

let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s, prev) => {
  if (s.net !== prev.net || s.fileName !== prev.fileName) {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ net: get().net, fileName: get().fileName }));
      } catch {
        /* storage full or unavailable */
      }
    }, 400);
  }
  if (
    s.theme !== prev.theme ||
    s.snapToGrid !== prev.snapToGrid ||
    s.showMinimap !== prev.showMinimap ||
    s.seenWelcome !== prev.seenWelcome ||
    s.sound !== prev.sound ||
    s.bottomHeight !== prev.bottomHeight ||
    s.propsWidth !== prev.propsWidth
  ) {
    try {
      const p: Prefs = { theme: s.theme, snapToGrid: s.snapToGrid, showMinimap: s.showMinimap, seenWelcome: s.seenWelcome, sound: s.sound, bottomHeight: s.bottomHeight, propsWidth: s.propsWidth };
      localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  }
});

// ---------- editing with undo ----------

const HISTORY_LIMIT = 300;
let coalesceKey: string | null = null;
let coalesceTime = 0;

/**
 * Replace the net, recording an undo step. Calls with the same `coalesce` key within
 * a short time (e.g. typing in a field, dragging) share one undo step.
 */
export function edit(fn: (net: Net) => Net, coalesce?: string) {
  const s = get();
  if (s.mode === "simulate") return;
  const next = fn(s.net);
  if (next === s.net) return;
  const now = Date.now();
  const merge = coalesce && coalesce === coalesceKey && now - coalesceTime < 1500;
  coalesceKey = coalesce ?? null;
  coalesceTime = now;
  set({
    net: next,
    past: merge ? s.past : [...s.past.slice(-HISTORY_LIMIT), s.net],
    future: [],
    dirty: true,
  });
}

export function endCoalesce() {
  coalesceKey = null;
}

export function undo() {
  const s = get();
  if (s.mode === "simulate" || !s.past.length) return;
  coalesceKey = null;
  set({ net: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.net, ...s.future], dirty: true, selection: [] });
  fixPage();
}

export function redo() {
  const s = get();
  if (s.mode === "simulate" || !s.future.length) return;
  coalesceKey = null;
  set({ net: s.future[0], future: s.future.slice(1), past: [...s.past, s.net], dirty: true, selection: [] });
  fixPage();
}

/** Leave a subnet that no longer exists (after undo or delete). */
function fixPage() {
  const s = get();
  if (s.page && !nodeExists(s.net, s.page)) set({ page: null });
}

function nodeExists(net: Net, id: string) {
  return net.places.some((p) => p.id === id) || net.transitions.some((t) => t.id === id);
}

/** Select every place, transition or arc drawn on the current page. */
export function selectKind(kind: "places" | "transitions" | "arcs") {
  const s = get();
  const page = s.page;
  const onPage = (n: { parent?: string }) => (n.parent ?? null) === page;
  const nodes = new Set([...s.net.places, ...s.net.transitions].filter(onPage).map((n) => n.id));
  const ids =
    kind === "places"
      ? s.net.places.filter(onPage).map((p) => p.id)
      : kind === "transitions"
        ? s.net.transitions.filter(onPage).map((t) => t.id)
        : s.net.arcs.filter((a) => nodes.has(a.source) && nodes.has(a.target)).map((a) => a.id);
  set({ selection: ids });
}

export function select(ids: string[]) {
  set({ selection: ids });
}

export function setTool(tool: Tool) {
  set({ tool, contextMenu: null });
}

export function toast(text: string, kind: "info" | "error" = "info") {
  set({ toast: { text, kind } });
  setTimeout(() => {
    if (get().toast?.text === text) set({ toast: null });
  }, kind === "error" ? 6000 : 2800);
}

// ---------- pages (subnets) ----------

/** Nodes, arcs and notes on the current page. */
export function onPage<T extends { parent?: string }>(items: T[], page: string | null): T[] {
  return items.filter((x) => (x.parent ?? null) === page);
}

/** The chain of coarse nodes from the top level down to `page`. */
export function pagePath(net: Net, page: string | null): (Place | Transition)[] {
  const out: (Place | Transition)[] = [];
  let cur = page;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const n = net.places.find((p) => p.id === cur) ?? net.transitions.find((t) => t.id === cur);
    if (!n) break;
    out.unshift(n);
    cur = n.parent ?? null;
  }
  return out;
}

export function enterPage(page: string | null) {
  set({ page, selection: [], contextMenu: null, fitRequest: get().fitRequest + 1 });
}

function descendants(net: Net, ids: Set<string>): Set<string> {
  const out = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of [...net.places, ...net.transitions, ...(net.notes ?? [])]) {
      if (n.parent && out.has(n.parent) && !out.has(n.id)) {
        out.add(n.id);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * Move the selected nodes into a new subnet behind a coarse transition or place.
 * Arcs keep their real endpoints, so firing is unchanged; on each page an arc to a hidden
 * node is drawn to the coarse node that contains it (see `visibleEnd`).
 */
export function groupIntoSubnet(kind: "transition" | "place") {
  const s = get();
  const ids = new Set(s.selection.filter((id) => nodeExists(s.net, id) || s.net.notes?.some((n) => n.id === id)));
  if (!ids.size) {
    toast("Select the nodes to put into a subnet first");
    return;
  }
  const net = s.net;
  const nodes = [...net.places, ...net.transitions].filter((n) => ids.has(n.id));
  if (!nodes.length) return;
  const cx = nodes.reduce((a, n) => a + n.x, 0) / nodes.length;
  const cy = nodes.reduce((a, n) => a + n.y, 0) / nodes.length;
  const coarseId = newId(kind === "transition" ? "t" : "p");
  const page = s.page ?? undefined;
  const used = new Set([...net.places, ...net.transitions].map((n) => n.name));
  let num = [...net.places, ...net.transitions].filter((n) => n.coarse).length + 1;
  while (used.has(`Subnet${num}`)) num++;
  const coarseName = `Subnet${num}`;
  const x = snap(cx, true);
  const y = snap(cy, true);
  edit((n) => ({
    ...n,
    places: [
      ...n.places.map((p) => (ids.has(p.id) ? { ...p, parent: coarseId } : p)),
      ...(kind === "place" ? [{ id: coarseId, name: coarseName, x, y, marking: "", coarse: true, parent: page }] : []),
    ],
    transitions: [
      ...n.transitions.map((t) => (ids.has(t.id) ? { ...t, parent: coarseId } : t)),
      ...(kind === "transition" ? [{ id: coarseId, name: coarseName, x, y, coarse: true, parent: page }] : []),
    ],
    notes: n.notes?.map((x) => (ids.has(x.id) ? { ...x, parent: coarseId } : x)),
  }));
  set({ selection: [coarseId] });
  toast(`Created subnet ${coarseName}. Double-click it to open.`);
}

/** Dissolve a coarse node: its contents move up to the coarse node's page. */
export function ungroupSubnet(coarseId: string) {
  const net = get().net;
  const c = net.places.find((p) => p.id === coarseId) ?? net.transitions.find((t) => t.id === coarseId);
  if (!c?.coarse) return;
  const up = c.parent;
  const re = <T extends { parent?: string }>(x: T): T => (x.parent === coarseId ? { ...x, parent: up } : x);
  edit((n) => ({
    ...n,
    places: n.places.filter((p) => p.id !== coarseId).map(re),
    transitions: n.transitions.filter((t) => t.id !== coarseId).map(re),
    arcs: n.arcs.filter((a) => a.source !== coarseId && a.target !== coarseId),
    notes: n.notes?.map(re),
  }));
}

/**
 * The node that stands for `id` on `page`: the node itself, the coarse ancestor on that page,
 * or null when the node is not inside this page at all (then it is "outside").
 */
export function visibleEnd(net: Net, id: string, page: string | null): string | null {
  let cur: string | undefined = id;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const n = net.places.find((p) => p.id === cur) ?? net.transitions.find((t) => t.id === cur) ?? net.faultTree?.nodes.find((f) => f.id === cur);
    if (!n) return null;
    if ((n.parent ?? null) === page) return n.id;
    cur = n.parent;
  }
  return null;
}

// ---------- adding things ----------

function defaultsForPlace(net: Net): Partial<Place> {
  return {
    colourSet: isColoured(net.netClass) ? net.declarations.colourSets.find((c) => c.name !== "Dot")?.name ?? "Dot" : undefined,
    continuous: net.netClass === "continuous" ? true : undefined,
  };
}

export function addPlace(x: number, y: number, extra: Partial<Place> = {}): string {
  const id = newId("p");
  const s = get();
  edit((net) => ({
    ...net,
    places: [
      ...net.places,
      {
        id,
        name: nextName(net.places.map((p) => p.name), "P"),
        x: snap(x, s.snapToGrid),
        y: snap(y, s.snapToGrid),
        marking: "",
        parent: s.page ?? undefined,
        ...defaultsForPlace(net),
        ...extra,
      },
    ],
  }));
  set({ selection: [id] });
  return id;
}

export function addTransition(x: number, y: number, extra: Partial<Transition> = {}): string {
  const id = newId("t");
  const s = get();
  edit((net) => {
    const kind = defaultTransitionKind(net.netClass);
    return {
      ...net,
      transitions: [
        ...net.transitions,
        {
          id,
          name: nextName(net.transitions.map((t) => t.name), "T"),
          x: snap(x, s.snapToGrid),
          y: snap(y, s.snapToGrid),
          parent: s.page ?? undefined,
          kind,
          rate: kind ? "MassAction(1)" : undefined,
          interval: net.netClass === "timed" ? ["0", "inf"] : undefined,
          sound: net.netClass === "music" ? { note: ["C4", "D4", "E4", "F4", "G4", "A4", "B4"][net.transitions.length % 7], duration: 0.3, instrument: "piano" } : undefined,
          ...extra,
        },
      ],
    };
  });
  set({ selection: [id] });
  return id;
}

export function addNote(x: number, y: number): string {
  const id = newId("n");
  edit((net) => ({ ...net, notes: [...(net.notes ?? []), { id, x, y, text: "Note", parent: get().page ?? undefined }] }));
  set({ selection: [id], inlineEdit: { id, field: "note" } });
  return id;
}

export function addFTNode(type: FTNodeType, x: number, y: number): string {
  const id = newId("f");
  const s = get();
  edit((net) => {
    const ft = net.faultTree ?? { nodes: [], edges: [] };
    const prefix = type === "basic" || type === "undeveloped" ? "E" : type === "top" ? "TOP" : type === "intermediate" ? "I" : "G";
    const node: FTNode = {
      id,
      type,
      name: type === "top" && !ft.nodes.some((n) => n.type === "top") ? "TOP" : nextName(ft.nodes.map((n) => n.name), prefix),
      x: snap(x, s.snapToGrid),
      y: snap(y, s.snapToGrid),
      parent: s.page ?? undefined,
      k: type === "kofn" ? 2 : undefined,
      probability: type === "basic" ? "0.01" : undefined,
    };
    return { ...net, faultTree: { ...ft, nodes: [...ft.nodes, node] } };
  });
  set({ selection: [id] });
  return id;
}

export function addFTEdge(source: string, target: string): string | null {
  const net = get().net;
  const ft = net.faultTree;
  if (!ft) return "This net has no fault tree";
  if (source === target) return "An event cannot feed itself";
  const tgt = ft.nodes.find((n) => n.id === target);
  if (tgt && (tgt.type === "basic" || tgt.type === "undeveloped")) return "Basic events have no inputs; connect from the event up to a gate";
  if (ft.edges.some((e) => e.source === source && e.target === target)) return "Those are already connected";
  const id = newId("e");
  edit((n) => ({ ...n, faultTree: { ...n.faultTree!, edges: [...n.faultTree!.edges, { id, source, target }] } }));
  set({ selection: [id] });
  return null;
}

export function updateFTNode(id: string, patch: Partial<FTNode>, coalesce?: string) {
  edit((net) => ({ ...net, faultTree: { ...net.faultTree!, nodes: net.faultTree!.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) } }), coalesce);
}

/** Add an arc; returns an error message if the arc is not allowed. */
export function addArc(source: string, target: string, points: Point[] = [], kindOverride?: ArcKind): string | null {
  const s = get();
  const net = s.net;
  if (isFaultTree(net.netClass)) return addFTEdge(source, target);
  const fromPlace = isPlace(net, source);
  const toPlace = isPlace(net, target);
  if (fromPlace === toPlace) return net.netClass === "freestyle" ? addFreeArc(source, target, points) : "Arcs must join a place and a transition";
  const kind = kindOverride ?? s.arcKind;
  if (kind !== "normal" && !fromPlace) return `${/^[aeiou]/.test(kind) ? "An" : "A"} ${kind} arc must go from a place to a transition`;
  if (kind === "modifier" && !arcKindsFor(net.netClass).includes("modifier")) return "Modifier arcs need a stochastic, continuous or hybrid net";
  if (net.arcs.some((a) => a.source === source && a.target === target && a.kind === kind)) return "That arc already exists";
  const id = newId("a");
  const defaultInscription = isColoured(net.netClass) ? defaultColouredInscription(net, fromPlace ? source : target) : kind === "reset" ? "" : "1";
  edit((n) => ({
    ...n,
    netClass: kind !== "normal" && !allowsExtendedArcs(n.netClass) ? "xpt" : n.netClass,
    arcs: [...n.arcs, { id, source, target, kind, inscription: defaultInscription, points: points.length ? points : undefined }],
  }));
  if (kind !== "normal" && !allowsExtendedArcs(net.netClass)) toast("Switched to an extended net to allow this arc type");
  set({ selection: [id] });
  return null;
}

function addFreeArc(source: string, target: string, points: Point[]): string | null {
  const id = newId("a");
  edit((n) => ({ ...n, arcs: [...n.arcs, { id, source, target, kind: "normal", inscription: "", points: points.length ? points : undefined }] }));
  set({ selection: [id] });
  return null;
}

function defaultColouredInscription(net: Net, placeId: string): string {
  const p = net.places.find((x) => x.id === placeId);
  const cs = p?.colourSet ?? "Dot";
  const decl = net.declarations.colourSets.find((c) => c.name === cs);
  if (!decl || decl.type === "dot") return "dot";
  const v = net.declarations.variables.find((x) => x.colourSet === cs);
  return v?.name ?? "";
}

/**
 * Create a node of the opposite kind at `at`, connected from `fromId`.
 * Used when an arc is dragged from a node and dropped on empty canvas.
 */
export function addConnectedNode(fromId: string, at: Point): void {
  const net = get().net;
  if (isFaultTree(net.netClass)) {
    // Dropping below a gate adds a basic event feeding it; above, a gate it feeds.
    const from = net.faultTree!.nodes.find((n) => n.id === fromId);
    if (!from) return;
    const below = at.y > from.y;
    const id = addFTNode(below ? "basic" : "or", at.x, at.y);
    if (below) addFTEdge(id, fromId);
    else addFTEdge(fromId, id);
    return;
  }
  const fromPlace = isPlace(net, fromId);
  const id = fromPlace ? addTransition(at.x, at.y) : addPlace(at.x, at.y);
  const s = get();
  const kind = fromPlace ? s.arcKind : "normal";
  addArc(fromId, id, [], kind);
  set({ selection: [id] });
}

// ---------- updating ----------

export function updatePlace(id: string, patch: Partial<Place>, coalesce?: string) {
  edit((net) => ({ ...net, places: net.places.map((p) => (p.id === id ? { ...p, ...patch } : p)) }), coalesce);
}

export function updateTransition(id: string, patch: Partial<Transition>, coalesce?: string) {
  edit((net) => ({ ...net, transitions: net.transitions.map((t) => (t.id === id ? { ...t, ...patch } : t)) }), coalesce);
}

export function updateArc(id: string, patch: Partial<Arc>, coalesce?: string) {
  edit((net) => {
    const arcs = net.arcs.map((a) => (a.id === id ? { ...a, ...patch } : a));
    const needsXpt = !allowsExtendedArcs(net.netClass) && arcs.some((a) => a.kind !== "normal");
    return { ...net, arcs, netClass: needsXpt ? "xpt" : net.netClass };
  }, coalesce);
}

export function updateNote(id: string, patch: Partial<Note>, coalesce?: string) {
  edit((net) => ({ ...net, notes: (net.notes ?? []).map((n) => (n.id === id ? { ...n, ...patch } : n)) }), coalesce);
}

export function updateNet(patch: Partial<Net>, coalesce?: string) {
  edit((net) => ({ ...net, ...patch }), coalesce);
}

/** Rename any element; returns false if the id is unknown. */
export function renameElement(id: string, name: string) {
  const net = get().net;
  if (net.places.some((p) => p.id === id)) updatePlace(id, { name });
  else if (net.transitions.some((t) => t.id === id)) updateTransition(id, { name });
  else if (net.faultTree?.nodes.some((n) => n.id === id)) updateFTNode(id, { name });
}

/** Add or remove tokens on a place (P/T style nets). */
export function adjustTokens(id: string, delta: number) {
  const p = get().net.places.find((x) => x.id === id);
  if (!p) return;
  if (isColoured(get().net.netClass)) {
    toast("Edit coloured markings in the properties panel");
    return;
  }
  const cur = Number(p.marking.trim() || 0);
  if (!Number.isFinite(cur)) {
    toast("This marking is an expression; edit it in the properties panel");
    return;
  }
  const next = Math.max(0, cur + delta);
  updatePlace(id, { marking: next ? String(Math.round(next * 1e9) / 1e9) : "" }, `tokens-${id}`);
}

export function setColor(ids: string[], color: string | undefined) {
  const idSet = new Set(ids);
  edit((net) => ({
    ...net,
    places: net.places.map((p) => (idSet.has(p.id) ? { ...p, color } : p)),
    transitions: net.transitions.map((t) => (idSet.has(t.id) ? { ...t, color } : t)),
    arcs: net.arcs.map((a) => (idSet.has(a.id) ? { ...a, color } : a)),
    notes: net.notes?.map((n) => (idSet.has(n.id) ? { ...n, color } : n)),
    faultTree: net.faultTree && { ...net.faultTree, nodes: net.faultTree.nodes.map((n) => (idSet.has(n.id) ? { ...n, color } : n)) },
  }));
}

export function moveSelection(ids: string[], dx: number, dy: number, coalesce: string) {
  const idSet = new Set(ids);
  edit(
    (net) => ({
      ...net,
      places: net.places.map((p) => (idSet.has(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p)),
      transitions: net.transitions.map((t) => (idSet.has(t.id) ? { ...t, x: t.x + dx, y: t.y + dy } : t)),
      notes: net.notes?.map((n) => (idSet.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)),
      faultTree: net.faultTree && {
        nodes: net.faultTree.nodes.map((n) => (idSet.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)),
        edges: net.faultTree.edges,
      },
      arcs: net.arcs.map((a) =>
        a.points && idSet.has(a.source) && idSet.has(a.target) ? { ...a, points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : a,
      ),
    }),
    coalesce,
  );
}

export function snapSelection(ids: string[]) {
  if (!get().snapToGrid) return;
  const idSet = new Set(ids);
  const s = (v: number) => snap(v, true);
  const net = get().net;
  set({
    net: {
      ...net,
      places: net.places.map((p) => (idSet.has(p.id) ? { ...p, x: s(p.x), y: s(p.y) } : p)),
      transitions: net.transitions.map((t) => (idSet.has(t.id) ? { ...t, x: s(t.x), y: s(t.y) } : t)),
      faultTree: net.faultTree && { ...net.faultTree, nodes: net.faultTree.nodes.map((n) => (idSet.has(n.id) ? { ...n, x: s(n.x), y: s(n.y) } : n)) },
    },
  });
}

/** Reconnect one end of an arc to another node. */
export function reconnectArc(arcId: string, end: "source" | "target", nodeId: string): string | null {
  const net = get().net;
  const arc = net.arcs.find((a) => a.id === arcId);
  if (!arc) return null;
  const next = { ...arc, [end]: nodeId };
  if (isPlace(net, next.source) === isPlace(net, next.target) && net.netClass !== "freestyle") return "Arcs must join a place and a transition";
  if (next.kind !== "normal" && !isPlace(net, next.source)) return `A ${next.kind} arc must start at a place`;
  updateArc(arcId, { [end]: nodeId, points: undefined });
  return null;
}

export function reverseArc(arcId: string) {
  const arc = get().net.arcs.find((a) => a.id === arcId);
  if (!arc) return;
  if (arc.kind !== "normal") {
    toast(`${/^[aeiou]/.test(arc.kind) ? "An" : "A"} ${arc.kind} arc must start at a place, so it can't be reversed`, "error");
    return;
  }
  updateArc(arcId, { source: arc.target, target: arc.source, points: arc.points?.slice().reverse() });
}

export function deleteSelection() {
  const s = get();
  const ids = descendants(s.net, new Set(s.selection));
  if (!ids.size) return;
  edit((net) => ({
    ...net,
    places: net.places.filter((p) => !ids.has(p.id)),
    transitions: net.transitions.filter((t) => !ids.has(t.id)),
    arcs: net.arcs.filter((a) => !ids.has(a.id) && !ids.has(a.source) && !ids.has(a.target)),
    notes: net.notes?.filter((n) => !ids.has(n.id)),
    faultTree: net.faultTree && {
      nodes: net.faultTree.nodes.filter((n) => !ids.has(n.id)),
      edges: net.faultTree.edges.filter((e) => !ids.has(e.id) && !ids.has(e.source) && !ids.has(e.target)),
    },
  }));
  set({ selection: [] });
}

export function selectAll() {
  const s = get();
  const net = s.net;
  set({
    selection: [
      ...onPage(net.places, s.page).map((p) => p.id),
      ...onPage(net.transitions, s.page).map((t) => t.id),
      ...onPage(net.notes ?? [], s.page).map((n) => n.id),
      ...onPage(net.faultTree?.nodes ?? [], s.page).map((n) => n.id),
    ],
  });
}

let clipboard: Clipboard | null = null;

export function copySelection() {
  const s = get();
  const ids = new Set(s.selection);
  const places = s.net.places.filter((p) => ids.has(p.id));
  const transitions = s.net.transitions.filter((t) => ids.has(t.id));
  const notes = (s.net.notes ?? []).filter((n) => ids.has(n.id));
  const ftNodes = (s.net.faultTree?.nodes ?? []).filter((n) => ids.has(n.id));
  const nodeIds = new Set([...places, ...transitions].map((n) => n.id));
  const arcs = s.net.arcs.filter((a) => nodeIds.has(a.source) && nodeIds.has(a.target));
  if (!places.length && !transitions.length && !notes.length && !ftNodes.length) return false;
  clipboard = { places, transitions, arcs, notes, ftNodes };
  return true;
}

export function cutSelection() {
  if (copySelection()) deleteSelection();
}

export function paste(offset = 40) {
  if (!clipboard) return;
  const map = new Map<string, string>();
  const net = get().net;
  const page = get().page ?? undefined;
  const pnames = net.places.map((p) => p.name);
  const tnames = net.transitions.map((t) => t.name);
  const places = clipboard.places.map((p) => {
    const id = newId("p");
    map.set(p.id, id);
    const name = p.logical || !pnames.includes(p.name) ? p.name : nextName(pnames, "P");
    pnames.push(name);
    return { ...p, id, name, x: p.x + offset, y: p.y + offset, parent: page };
  });
  const transitions = clipboard.transitions.map((t) => {
    const id = newId("t");
    map.set(t.id, id);
    const name = tnames.includes(t.name) ? nextName(tnames, "T") : t.name;
    tnames.push(name);
    return { ...t, id, name, x: t.x + offset, y: t.y + offset, parent: page };
  });
  const arcs = clipboard.arcs.map((a) => ({
    ...a,
    id: newId("a"),
    source: map.get(a.source)!,
    target: map.get(a.target)!,
    points: a.points?.map((p) => ({ x: p.x + offset, y: p.y + offset })),
  }));
  const notes = clipboard.notes.map((n) => ({ ...n, id: newId("n"), x: n.x + offset, y: n.y + offset, parent: page }));
  const ftNodes = clipboard.ftNodes.map((n) => ({ ...n, id: newId("f"), x: n.x + offset, y: n.y + offset, parent: page }));
  edit((n) => ({
    ...n,
    places: [...n.places, ...places],
    transitions: [...n.transitions, ...transitions],
    arcs: [...n.arcs, ...arcs],
    notes: notes.length ? [...(n.notes ?? []), ...notes] : n.notes,
    faultTree: ftNodes.length && n.faultTree ? { ...n.faultTree, nodes: [...n.faultTree.nodes, ...ftNodes] } : n.faultTree,
  }));
  clipboard = { places, transitions, arcs, notes, ftNodes };
  set({ selection: [...places, ...transitions, ...notes, ...ftNodes].map((n) => n.id) });
}

export function duplicateSelection() {
  if (copySelection()) paste(30);
}

// ---------- alignment ----------

type Positioned = { id: string; x: number; y: number };

function selectedPositioned(): Positioned[] {
  const s = get();
  const ids = new Set(s.selection);
  return [
    ...s.net.places,
    ...s.net.transitions,
    ...(s.net.notes ?? []),
    ...(s.net.faultTree?.nodes ?? []),
  ].filter((n) => ids.has(n.id));
}

function setPositions(pos: Map<string, Point>, coalesce?: string) {
  const upd = <T extends Positioned>(n: T): T => (pos.has(n.id) ? { ...n, ...pos.get(n.id)! } : n);
  edit(
    (net) => ({
      ...net,
      places: net.places.map(upd),
      transitions: net.transitions.map(upd),
      notes: net.notes?.map(upd),
      faultTree: net.faultTree && { ...net.faultTree, nodes: net.faultTree.nodes.map(upd) },
    }),
    coalesce,
  );
}

export type AlignMode = "left" | "centerX" | "right" | "top" | "centerY" | "bottom" | "distributeX" | "distributeY";

export function alignSelection(mode: AlignMode) {
  const nodes = selectedPositioned();
  if (nodes.length < 2) return;
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const pos = new Map<string, Point>();
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  if (mode === "distributeX" || mode === "distributeY") {
    const key = mode === "distributeX" ? "x" : "y";
    const sorted = [...nodes].sort((a, b) => a[key] - b[key]);
    const lo = sorted[0][key];
    const hi = sorted[sorted.length - 1][key];
    sorted.forEach((n, i) => pos.set(n.id, { x: key === "x" ? lo + ((hi - lo) * i) / (sorted.length - 1) : n.x, y: key === "y" ? lo + ((hi - lo) * i) / (sorted.length - 1) : n.y }));
  } else {
    for (const n of nodes) {
      const x = mode === "left" ? minX : mode === "right" ? maxX : mode === "centerX" ? (minX + maxX) / 2 : n.x;
      const y = mode === "top" ? minY : mode === "bottom" ? maxY : mode === "centerY" ? (minY + maxY) / 2 : n.y;
      pos.set(n.id, { x, y });
    }
  }
  setPositions(pos);
}

export function applyLayout(pos: Map<string, Point>, bends?: Map<string, Point[]>) {
  edit((net) => {
    // Laid-out nodes get their labels back in the default spot.
    const upd = <T extends Positioned>(n: T): T => (pos.has(n.id) ? { ...n, ...pos.get(n.id)!, labelOffset: undefined } : n);
    return {
      ...net,
      places: net.places.map(upd),
      transitions: net.transitions.map(upd),
      faultTree: net.faultTree && { ...net.faultTree, nodes: net.faultTree.nodes.map(upd) },
      arcs: net.arcs.map((a) => (bends?.has(a.id) ? { ...a, points: bends.get(a.id)!.length ? bends.get(a.id) : undefined } : pos.has(a.source) || pos.has(a.target) ? { ...a, points: undefined } : a)),
    };
  });
  requestFit();
}

// ---------- net class ----------

export function setNetClass(netClass: NetClass) {
  const net = get().net;
  if (net.netClass === netClass) return;
  if (!allowsExtendedArcs(netClass) && net.arcs.some((a) => a.kind !== "normal")) {
    toast("Remove read, inhibitor, reset, equal and modifier arcs before switching to a P/T net", "error");
    return;
  }
  if (!arcKindsFor(netClass).includes("modifier") && net.arcs.some((a) => a.kind === "modifier")) {
    toast("Modifier arcs only exist in stochastic, continuous and hybrid nets; remove them first", "error");
    return;
  }
  if (isFaultTree(netClass) !== isFaultTree(net.netClass)) {
    toast("Fault trees and Petri nets are different kinds of models; start a new file instead (File > New)", "error");
    return;
  }
  edit((n) => {
    let declarations = n.declarations;
    let places = n.places;
    let arcs = n.arcs;
    let transitions = n.transitions;
    const wasCol = isColoured(n.netClass);
    const nowCol = isColoured(netClass);
    if (nowCol && !declarations.colourSets.length) declarations = { ...declarations, colourSets: [{ name: "Dot", type: "dot" }] };
    if (nowCol && !wasCol) places = places.map((p) => ({ ...p, colourSet: p.colourSet ?? "Dot" }));
    if (!nowCol && wasCol) {
      places = places.map((p) => ({ ...p, colourSet: undefined, marking: /^\s*[\d.]*\s*$/.test(p.marking) ? p.marking : "" }));
      arcs = arcs.map((a) => ({ ...a, inscription: /^\s*[\d.]*\s*$/.test(a.inscription) ? a.inscription : "1" }));
    }
    const kind = defaultTransitionKind(netClass);
    const base = timeBase(netClass);
    transitions = transitions.map((t) => ({
      ...t,
      kind: kind && (!t.kind || (base === "continuous" ? true : t.kind === "continuous" && base !== "hybrid")) ? kind : base ? t.kind : undefined,
      rate: kind && !t.rate ? "MassAction(1)" : t.rate,
      interval: netClass === "timed" && !t.interval ? ["0", "inf"] : t.interval,
      sound: netClass === "music" && !t.sound ? { note: "C4", duration: 0.3, instrument: "piano" } : t.sound,
    }));
    if (base === "continuous") places = places.map((p) => ({ ...p, continuous: true }));
    return { ...n, netClass, declarations, places, arcs, transitions, modulus: netClass === "modulo" ? n.modulus ?? 2 : n.modulus };
  });
  if (get().arcKind === "modifier" && !arcKindsFor(netClass).includes("modifier")) set({ arcKind: "normal" });
}

export function loadNet(net: Net, fileName: string | null, filePath: string | null = null, fileHandle: unknown = null) {
  stopSimulation();
  set({ net, fileName, filePath, fileHandle, dirty: false, past: [], future: [], selection: [], page: null, dialog: null, fitRequest: get().fitRequest + 1 });
}

export function newNet(netClass: NetClass) {
  const net = emptyNet(netClass);
  // An APN starts with the users' colour set of the thesis figures, BW = {b, w}, and a mode variable.
  if (netClass === "apn")
    net.declarations = { ...net.declarations, colourSets: [...net.declarations.colourSets, { name: "BW", type: "enum", values: ["b", "w"] }], variables: [{ name: "x", colourSet: "BW" }] };
  loadNet(net, null);
}

export function markSaved(fileName: string, filePath: string | null, fileHandle: unknown = get().fileHandle) {
  set({ dirty: false, fileName, filePath, fileHandle });
}

export function requestFit() {
  set({ fitRequest: get().fitRequest + 1 });
}

// ---------- token game ----------

export function canTokenGame(net: Net): string | null {
  if (net.netClass === "freestyle") return "Freestyle nets have no firing rules";
  if (isFaultTree(net.netClass)) return "Fault trees are analysed, not simulated with tokens; see the Fault tree tab";
  return null;
}

export function startSimulation() {
  const net = get().net;
  const why = canTokenGame(net);
  if (why) {
    toast(why, "error");
    return;
  }
  const cn = compiled(net);
  const errors = cn.problems.filter((p) => p.severity === "error");
  if (!errors.length && isAmbient(net.netClass)) errors.push(...ambientErrors(net));
  if (errors.length) {
    set({ panel: "problems", bottomOpen: true });
    toast(`Fix ${errors.length} problem${errors.length > 1 ? "s" : ""} before simulating`, "error");
    return;
  }
  let timed: TimedState | undefined;
  if (net.netClass === "timed") {
    try {
      timed = timedInit(net);
    } catch (e) {
      toast((e as Error).message, "error");
      return;
    }
  }
  set({
    mode: "simulate",
    sim: [{ marking: initialMarking(cn), label: "Initial marking", timed }],
    simIndex: 0,
    selection: [],
    panel: "simulation",
    // On phones the panel would hide most of the net: it stays as it was, its tab ready to open.
    bottomOpen: smallScreenNow() ? get().bottomOpen : true,
    tool: "select",
    contextMenu: null,
    inlineEdit: null,
  });
}

export function stopSimulation() {
  set({ mode: "edit", sim: [], simIndex: 0, running: false, bindingPicker: null });
}

export function currentMarking(): Marking | null {
  const s = get();
  return s.mode === "simulate" ? s.sim[s.simIndex]?.marking ?? null : null;
}

type FireListener = (transition: Transition) => void;
const fireListeners = new Set<FireListener>();
export function onFire(l: FireListener) {
  fireListeners.add(l);
  return () => {
    fireListeners.delete(l);
  };
}

export function fireTransition(transitionId: string, binding: Binding) {
  const s = get();
  const cn = compiled(s.net);
  const t = cn.transitions.find((x) => x.id === transitionId);
  const M = currentMarking();
  if (!t || !M) return;
  try {
    const label = `${t.name}${showBinding(binding) ? " " + showBinding(binding) : ""}`;
    const ts = s.sim[s.simIndex]?.timed;
    let step: SimStep;
    if (ts) {
      const nt = timedFire(ts, t.index, binding);
      step = { marking: nt.marking, label: `${label} at t=${fmtTime(nt.time)}`, transitionId, timed: nt };
    } else step = { marking: fire(cn, t.index, binding, M), label, transitionId };
    set({ sim: [...s.sim.slice(0, s.simIndex + 1), step], simIndex: s.simIndex + 1, bindingPicker: null });
    const tr = s.net.transitions.find((x) => x.id === transitionId);
    if (tr) fireListeners.forEach((l) => l(tr));
  } catch (e) {
    toast((e as Error).message, "error");
  }
}

export function simGoto(index: number) {
  const s = get();
  if (index < 0 || index >= s.sim.length) return;
  set({ simIndex: index, bindingPicker: null });
}

/** Write the current simulation marking back into the net as its initial marking. */
export function adoptMarking() {
  const s = get();
  const M = currentMarking();
  if (!M) return;
  const cn = compiled(s.net);
  const text = (slot: number) => (cn.coloured ? M[slot].toString() : M[slot].size ? String(M[slot].size) : "");
  const net = {
    ...s.net,
    places: s.net.places.map((p) => {
      const c = cn.places.find((x) => x.id === p.id);
      return c ? { ...p, marking: text(c.slot) } : p;
    }),
  };
  set({ mode: "edit" });
  edit(() => net);
  set({ mode: "simulate", sim: [{ marking: M, label: "Initial marking" }], simIndex: 0 });
  toast("Current marking saved as the initial marking");
}

export function fmtTime(t: number): string {
  return Number.isInteger(t) ? String(t) : String(Math.round(t * 1e6) / 1e6);
}

/** Timed nets: let time pass in the token game. With no argument, waits until something can fire. */
export function advanceTime(d?: number) {
  const s = get();
  const ts = s.sim[s.simIndex]?.timed;
  if (!ts) return;
  const info = timedEnabled(ts);
  const delay = d ?? info.minDelay;
  if (!Number.isFinite(delay)) {
    toast("Nothing is enabled, so waiting changes nothing");
    return;
  }
  try {
    const nt = timedDelay(ts, delay);
    set({ sim: [...s.sim.slice(0, s.simIndex + 1), { marking: nt.marking, label: `wait ${fmtTime(delay)} → t=${fmtTime(nt.time)}`, timed: nt }], simIndex: s.simIndex + 1 });
  } catch (e) {
    toast((e as Error).message, "error");
  }
}

export { timedEnabled };
