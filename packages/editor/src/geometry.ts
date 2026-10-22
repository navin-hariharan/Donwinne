import type { FTNode, Net, Note, Place, Point, Transition } from "@pns/core";
import { isFaultTree } from "@pns/core";

export const PLACE_R = 20;
export const TRANS_W = 14;
export const TRANS_H = 42;
export const GRID = 10;

export type NodeShape =
  | { kind: "place"; node: Place }
  | { kind: "transition"; node: Transition }
  | { kind: "ft"; node: FTNode };

export function transSize(t: Transition): { w: number; h: number } {
  const w = t.coarse ? 22 : t.kind === "immediate" ? 6 : TRANS_W;
  return t.horizontal ? { w: TRANS_H, h: w } : { w, h: TRANS_H };
}

/** Fault tree node box: events are wide rectangles, gates and basic events are compact. */
export function ftSize(n: FTNode): { w: number; h: number } {
  switch (n.type) {
    case "top":
    case "intermediate":
      return { w: 100, h: 36 };
    case "basic":
    case "undeveloped":
      return { w: 40, h: 40 };
    default:
      return { w: 40, h: 44 };
  }
}

interface ShapeIndex {
  places: Place[];
  transitions: Transition[];
  ft: FTNode[] | undefined;
  sizes: string;
  byId: Map<string, NodeShape>;
}

const shapeCache = new WeakMap<Net, ShapeIndex>();

/** Nodes by id, so drawing a big net doesn't search the node lists once for every arc end. */
function shapeIndex(net: Net): ShapeIndex {
  const ft = net.faultTree?.nodes;
  const sizes = `${net.places.length},${net.transitions.length},${ft?.length ?? 0}`;
  const hit = shapeCache.get(net);
  // Edits replace the net, but some code builds one up in place: check that the lists are still the same.
  if (hit && hit.places === net.places && hit.transitions === net.transitions && hit.ft === ft && hit.sizes === sizes) return hit;
  const byId = new Map<string, NodeShape>();
  // On an id clash the first match wins, places before transitions before fault tree nodes, as a search of the lists would find.
  for (const f of ft ?? []) if (!byId.has(f.id)) byId.set(f.id, { kind: "ft", node: f });
  for (let i = net.transitions.length - 1; i >= 0; i--) byId.set(net.transitions[i].id, { kind: "transition", node: net.transitions[i] });
  for (let i = net.places.length - 1; i >= 0; i--) byId.set(net.places[i].id, { kind: "place", node: net.places[i] });
  const idx = { places: net.places, transitions: net.transitions, ft, sizes, byId };
  shapeCache.set(net, idx);
  return idx;
}

export function shapeOf(net: Net, id: string): NodeShape | undefined {
  return shapeIndex(net).byId.get(id);
}

/** Point where the ray from the node centre towards `toward` leaves the node outline. */
export function boundaryPoint(s: NodeShape, toward: Point, pad = 0): Point {
  const c = { x: s.node.x, y: s.node.y };
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const len = Math.hypot(dx, dy) || 1;
  if (s.kind === "place") {
    const r = PLACE_R + pad;
    return { x: c.x + (dx / len) * r, y: c.y + (dy / len) * r };
  }
  const { w, h } = s.kind === "transition" ? transSize(s.node) : ftSize(s.node);
  const hw = w / 2 + pad;
  const hh = h / 2 + pad;
  const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
  const k = Math.min(sx, sy);
  return { x: c.x + dx * k, y: c.y + dy * k };
}

export function snap(v: number, on: boolean): number {
  return on ? Math.round(v / GRID) * GRID : v;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function noteSize(n: Note): { w: number; h: number } {
  const lines = n.text.split("\n");
  return { w: Math.max(40, Math.max(...lines.map((l) => l.length)) * 6.6 + 16), h: lines.length * 16 + 10 };
}

export function netBounds(net: Net, margin = 40): Box {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of net.places) {
    xs.push(p.x - PLACE_R - 30, p.x + PLACE_R + 60);
    ys.push(p.y - PLACE_R - 20, p.y + PLACE_R + 24);
  }
  for (const t of net.transitions) {
    const { w, h } = transSize(t);
    xs.push(t.x - w / 2 - 30, t.x + w / 2 + 40);
    ys.push(t.y - h / 2 - 20, t.y + h / 2 + 28);
  }
  for (const a of net.arcs)
    for (const pt of a.points ?? []) {
      xs.push(pt.x);
      ys.push(pt.y);
    }
  for (const n of net.notes ?? []) {
    const { w, h } = noteSize(n);
    xs.push(n.x, n.x + w);
    ys.push(n.y, n.y + h);
  }
  for (const n of net.faultTree?.nodes ?? []) {
    const { w, h } = ftSize(n);
    xs.push(n.x - w / 2 - 20, n.x + w / 2 + 20);
    ys.push(n.y - h / 2 - 20, n.y + h / 2 + 24);
  }
  if (!xs.length) return { x: 0, y: 0, w: 800, h: 600 };
  const x0 = Math.min(...xs) - margin;
  const y0 = Math.min(...ys) - margin;
  return { x: x0, y: y0, w: Math.max(...xs) + margin - x0, h: Math.max(...ys) + margin - y0 };
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const parallelCache = new WeakMap<Net["arcs"], Map<string, number>>();

/**
 * Arcs without bend points that join the same two nodes (in either direction) would be drawn on top of
 * each other. Each gets a sideways offset so all of them stay visible and clickable; 0 = straight.
 */
export function parallelOffset(net: Net, arc: { id?: string; source: string; target: string; points?: Point[] }): number {
  if (!arc.id || arc.points?.length) return 0;
  let m = parallelCache.get(net.arcs);
  if (!m) {
    m = new Map();
    const groups = new Map<string, { id: string; forward: boolean }[]>();
    for (const a of net.arcs) {
      if (a.points?.length) continue;
      const key = a.source < a.target ? `${a.source}|${a.target}` : `${a.target}|${a.source}`;
      const g = groups.get(key) ?? [];
      g.push({ id: a.id, forward: a.source < a.target });
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      // Offsets are measured in one shared direction, so arcs going the other way flip their sign.
      g.forEach((x, i) => m!.set(x.id, (i - (g.length - 1) / 2) * 18 * (x.forward ? 1 : -1)));
    }
    parallelCache.set(net.arcs, m);
  }
  return m.get(arc.id) ?? 0;
}

/** The polyline an arc is drawn along, clipped to the node outlines. */
export function arcPath(net: Net, arc: { id?: string; source: string; target: string; points?: Point[] }): Point[] | null {
  const s = shapeOf(net, arc.source);
  const t = shapeOf(net, arc.target);
  if (!s || !t) return null;
  return arcPathBetween(s, t, arc.points, parallelOffset(net, arc));
}

/** As arcPath, for an arc whose end nodes and sideways offset are already known. */
export function arcPathBetween(s: NodeShape, t: NodeShape, points: Point[] | undefined, off: number): Point[] | null {
  if (off) {
    const dx = t.node.x - s.node.x;
    const dy = t.node.y - s.node.y;
    const len = Math.hypot(dx, dy) || 1;
    const bend = { x: (s.node.x + t.node.x) / 2 - (dy / len) * off, y: (s.node.y + t.node.y) / 2 + (dx / len) * off };
    return [boundaryPoint(s, bend), bend, boundaryPoint(t, bend, 1)];
  }
  const mid = points ?? [];
  if (s.node === t.node && !mid.length) return null;
  const first = mid[0] ?? { x: t.node.x, y: t.node.y };
  const last = mid[mid.length - 1] ?? { x: s.node.x, y: s.node.y };
  return [boundaryPoint(s, first), ...mid, boundaryPoint(t, last, 1)];
}

/** Fault tree edge: an elbow from the top of the input up to the bottom of the gate it feeds. */
export function ftEdgePath(net: Net, e: { source: string; target: string }): Point[] | null {
  const ss = shapeOf(net, e.source);
  const ts = shapeOf(net, e.target);
  if (ss?.kind !== "ft" || ts?.kind !== "ft") return null;
  const s = ss.node;
  const t = ts.node;
  const a = { x: s.x, y: s.y - ftSize(s).h / 2 };
  const b = { x: t.x, y: t.y + ftSize(t).h / 2 };
  if (a.y <= b.y + 4) return [a, b];
  const midY = b.y + Math.min(24, (a.y - b.y) / 2);
  return [a, { x: a.x, y: midY }, { x: b.x, y: midY }, b];
}

/** Midpoint along a polyline, for labels. */
export function polylineMid(pts: Point[]): { p: Point; angle: number } {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc + seg >= total / 2) {
      const k = seg === 0 ? 0 : (total / 2 - acc) / seg;
      return {
        p: { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k },
        angle: Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x),
      };
    }
    acc += seg;
  }
  return { p: pts[0], angle: 0 };
}

// ---------- page views ----------

/** The nearest spot to `p`, moving away from `centre`, at least 64 units from every occupied point. */
function freeSpot(p: Point, occupied: Point[], centre: Point): Point {
  const clear = (q: Point) => occupied.every((o) => Math.hypot(o.x - q.x, o.y - q.y) >= 64);
  if (clear(p)) return p;
  let dx = p.x - centre.x;
  let dy = p.y - centre.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) (dx = 1), (dy = 0);
  else (dx /= len), (dy /= len);
  for (let step = 1; step <= 40; step++) {
    // Try straight out first, then fan out sideways.
    for (const side of [0, 1, -1]) {
      const q = { x: p.x + dx * 40 * step - dy * side * 40 * step * 0.5, y: p.y + dy * 40 * step + dx * side * 40 * step * 0.5 };
      if (clear(q)) return q;
    }
  }
  return { x: p.x + dx * 1600, y: p.y + dy * 1600 };
}

export interface PageView {
  /** The nodes, arcs and notes drawn on this page. Arcs to hidden nodes point at their coarse node or a ghost. */
  net: Net;
  /** Ghost nodes: stand-ins inside a subnet for nodes outside it. Id is "ghost:" + the real id. */
  ghosts: Set<string>;
  /** Arcs whose drawn ends differ from their real ends; they can't be bent or reconnected here. */
  remapped: Set<string>;
}

const viewCache = new WeakMap<Net, Map<string, PageView>>();

/** The part of the net shown on `page` (null = top level). */
export function pageView(net: Net, page: string | null): PageView {
  let byPage = viewCache.get(net);
  if (!byPage) viewCache.set(net, (byPage = new Map()));
  const key = page ?? "";
  const hit = byPage.get(key);
  if (hit) return hit;
  const v = buildPageView(net, page);
  byPage.set(key, v);
  return v;
}

function buildPageView(net: Net, page: string | null): PageView {
  const hasHierarchy = net.places.some((p) => p.parent || p.coarse) || net.transitions.some((t) => t.parent || t.coarse) || net.notes?.some((n) => n.parent) || net.faultTree?.nodes.some((n) => n.parent);
  if (!hasHierarchy) return { net, ghosts: new Set(), remapped: new Set() };

  const parentOf = new Map<string, string | undefined>();
  for (const n of [...net.places, ...net.transitions]) parentOf.set(n.id, n.parent);
  const visible = (id: string): string | null => {
    let cur: string | undefined = id;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (!parentOf.has(cur)) return null;
      const p: string | undefined = parentOf.get(cur);
      if ((p ?? null) === page) return cur;
      cur = p;
    }
    return null;
  };
  const places = net.places.filter((p) => (p.parent ?? null) === page);
  const transitions = net.transitions.filter((t) => (t.parent ?? null) === page);
  const byId = new Map<string, Place | Transition>([...net.places, ...net.transitions].map((n) => [n.id, n]));
  const ghosts = new Set<string>();
  const remapped = new Set<string>();
  const ghostPlaces: Place[] = [];
  const ghostTrans: Transition[] = [];
  const arcs: Net["arcs"] = [];
  const seenPairs = new Set<string>();
  const occupied: Point[] = [...places, ...transitions].map((n) => ({ x: n.x, y: n.y }));
  const centre = occupied.length ? { x: occupied.reduce((a, p) => a + p.x, 0) / occupied.length, y: occupied.reduce((a, p) => a + p.y, 0) / occupied.length } : { x: 0, y: 0 };

  for (const a of net.arcs) {
    let s = visible(a.source);
    let t = visible(a.target);
    if (!s && !t) continue;
    if (s && t && s === t) continue; // both inside the same coarse node
    // Inside a subnet: show the outside end as a ghost next to the inner node.
    for (const side of ["source", "target"] as const) {
      if ((side === "source" ? s : t) !== null) continue;
      const realId = a[side];
      const gid = `ghost:${realId}`;
      if (!ghosts.has(gid)) {
        ghosts.add(gid);
        const real = byId.get(realId)!;
        // Grouping keeps coordinates, so the outside node's own position is usually a natural place for its
        // ghost; move it outwards only if it would overlap something already on the page.
        const at = freeSpot({ x: real.x, y: real.y }, occupied, centre);
        occupied.push(at);
        const g = { ...real, id: gid, parent: page ?? undefined, x: at.x, y: at.y, labelOffset: undefined };
        if ("marking" in real) ghostPlaces.push(g as Place);
        else ghostTrans.push(g as Transition);
      }
      if (side === "source") s = gid;
      else t = gid;
    }
    const exact = s === a.source && t === a.target;
    if (exact) {
      arcs.push(a);
      continue;
    }
    const pair = `${s}>${t}>${a.kind}`;
    if (seenPairs.has(pair)) continue;
    seenPairs.add(pair);
    remapped.add(a.id);
    arcs.push({ ...a, source: s!, target: t!, points: undefined });
  }
  return {
    net: {
      ...net,
      places: [...places, ...ghostPlaces],
      transitions: [...transitions, ...ghostTrans],
      arcs,
      notes: net.notes?.filter((n) => (n.parent ?? null) === page),
      faultTree: net.faultTree && {
        nodes: net.faultTree.nodes.filter((n) => (n.parent ?? null) === page),
        edges: net.faultTree.edges,
      },
    },
    ghosts,
    remapped,
  };
}

/** Fields that only say where an element is drawn. */
const LAYOUT_KEYS = new Set(["x", "y", "labelOffset", "points"]);

function sameApartFromLayout(xs: object[], ys: object[]): boolean {
  if (xs === ys) return true;
  if (xs.length !== ys.length) return false;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i] as Record<string, unknown>;
    const b = ys[i] as Record<string, unknown>;
    if (a === b) continue;
    for (const k in a) if (!LAYOUT_KEYS.has(k) && a[k] !== b[k]) return false;
    for (const k in b) if (!LAYOUT_KEYS.has(k) && !(k in a) && b[k] !== undefined) return false;
  }
  return true;
}

/**
 * Whether two versions of a net differ at most in their layout: node positions, label offsets, bend points and notes.
 * Such a change leaves the compiled net and its problems as they were. Not for fault trees, whose gates take
 * their inputs in drawing order.
 */
export function sameButLayout(a: Net, b: Net): boolean {
  if (a === b) return true;
  if (isFaultTree(a.netClass) || isFaultTree(b.netClass)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (k === "places" || k === "transitions" || k === "arcs" || k === "notes") continue;
    if ((a as unknown as Record<string, unknown>)[k] !== (b as unknown as Record<string, unknown>)[k]) return false;
  }
  return sameApartFromLayout(a.places, b.places) && sameApartFromLayout(a.transitions, b.transitions) && sameApartFromLayout(a.arcs, b.arcs);
}

// ---------- level of detail ----------

/** Labels that would come out smaller than this on screen (in pixels) are left out of the canvas. */
export const LABEL_MIN_PX = 6;

/**
 * The smallest label font size (in drawing units) still shown at this zoom; 0 shows every label.
 * Rounded up to the half unit label sizes step by, so it only changes when it crosses some label size.
 */
export function labelCutoff(zoom: number): number {
  const min = LABEL_MIN_PX / zoom;
  if (min <= 10) return 0;
  if (min > 12) return Infinity;
  return Math.ceil(min * 2) / 2;
}

/** Names longer than this are cut short on the canvas. */
export const NAME_MAX = 20;

export function shortName(s: string, max = NAME_MAX): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/**
 * The part of the drawing worth rendering: what is on screen plus a margin, its edges rounded outwards
 * to a step so that panning a little doesn't change it.
 */
export function cullBox(view: { x: number; y: number; zoom: number }, w: number, h: number, marginPx = 240): Box {
  const step = marginPx / view.zoom;
  const x0 = Math.floor((-view.x / view.zoom - step) / step) * step;
  const y0 = Math.floor((-view.y / view.zoom - step) / step) * step;
  const x1 = Math.ceil(((w - view.x) / view.zoom + step) / step) * step;
  const y1 = Math.ceil(((h - view.y) / view.zoom + step) / step) * step;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Whether a point, grown by `r` on every side, touches the box. */
export function nearBox(b: Box, x: number, y: number, r: number): boolean {
  return x + r >= b.x && x - r <= b.x + b.w && y + r >= b.y && y - r <= b.y + b.h;
}

/** Edge auto-scroll: within this many pixels of the canvas edge a drag pans the view. */
export const EDGE_ZONE = 30;
/** Pan speed (pixels per frame) with the pointer on or past the edge. */
export const EDGE_SPEED = 16;

/** How far to pan the view this frame for a drag at `p` (canvas pixels) on a w×h canvas; zero away from the edges. */
export function edgePan(p: Point, w: number, h: number): Point {
  const along = (v: number, size: number) => {
    // A canvas this small is all edge: leave it alone.
    if (size < EDGE_ZONE * 4) return 0;
    if (v < EDGE_ZONE) return (EDGE_SPEED * Math.min(EDGE_ZONE, EDGE_ZONE - v)) / EDGE_ZONE;
    if (v > size - EDGE_ZONE) return (-EDGE_SPEED * Math.min(EDGE_ZONE, v - (size - EDGE_ZONE))) / EDGE_ZONE;
    return 0;
  };
  return { x: along(p.x, w), y: along(p.y, h) };
}
