// Automatic placement for the composition operators: put the new step and its control system
// next to the gluing places, where they do not cover existing nodes.

import { Net, Point } from "@pns/core";
import { LAYOUT, controlSystemOffsets, stepHeight } from "./blocks";

/** Minimum distance between the centres of two nodes. */
const CLEAR = 70;

export function nodePoints(net: Net): Point[] {
  return [...net.places, ...net.transitions].map((n) => ({ x: n.x, y: n.y }));
}

function free(p: Point, occupied: Point[], clear = CLEAR): boolean {
  return occupied.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= clear);
}

const DIRECTIONS: Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
];

/** Where to put the finishing place and the step transition of a step leaving `from`. */
export function placeForwardStep(from: Point, n: number, occupied: Point[], at?: Point): { finish: Point; step: Point } {
  if (at) return { finish: at, step: placeBackwardStep(from, at, occupied) };
  const h = stepHeight(n);
  for (let k = 0; k < 6; k++)
    for (const d of DIRECTIONS) {
      const len = h + k * LAYOUT.row;
      const finish = { x: from.x + d.x * len, y: from.y + d.y * len };
      const step = { x: from.x + (d.x * len) / 2, y: from.y + (d.y * len) / 2 };
      if (free(finish, occupied) && free(step, occupied)) return { finish, step };
    }
  return { finish: { x: from.x, y: from.y - h }, step: { x: from.x, y: from.y - h / 2 } };
}

/** Where to put the step transition of a backward step from g1 to g2 (possibly the same place). */
export function placeBackwardStep(g1: Point, g2: Point, occupied: Point[]): Point {
  const dx = g2.x - g1.x;
  const dy = g2.y - g1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) {
    for (let k = 1; k < 8; k++)
      for (const d of DIRECTIONS) {
        const p = { x: g1.x + d.x * 120 * k, y: g1.y + d.y * 120 * k };
        if (free(p, occupied, 55)) return p;
      }
    return { x: g1.x + 120, y: g1.y };
  }
  const mid = { x: (g1.x + g2.x) / 2, y: (g1.y + g2.y) / 2 };
  const perp = { x: -dy / len, y: dx / len };
  for (let k = 0; k < 16; k++) {
    const off = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * 50;
    const p = { x: mid.x + perp.x * off, y: mid.y + perp.y * off };
    if (free(p, occupied, 55)) return p;
  }
  return mid;
}

/** Where to put a control system of n decision points near its step transition and finishing place. */
export function placeControlSystem(step: Point, finish: Point, n: number, occupied: Point[], preferred?: Point): { control: Point; mirror: boolean } {
  const base = preferred ?? { x: finish.x - LAYOUT.gap, y: Math.min(finish.y, step.y) };
  const candidates: Point[] = [];
  const R = 1400;
  for (let dx = -R; dx <= R; dx += 40) for (let dy = -R; dy <= R; dy += 40) candidates.push({ x: base.x + dx, y: base.y + dy });
  const dist = (p: Point) => Math.hypot(p.x - base.x, p.y - base.y) + 0.4 * Math.hypot(p.x - step.x, p.y - step.y);
  candidates.sort((a, b) => dist(a) - dist(b));
  for (const c of candidates) {
    // Prefer the control system to grow away from the step, as in Figs 4.5 and 4.9.
    const mirrors = c.x <= step.x ? [false, true] : [true, false];
    for (const mirror of mirrors) if (fits(c, n, mirror, occupied)) return { control: c, mirror };
  }
  return { control: base, mirror: false };
}

function fits(control: Point, n: number, mirror: boolean, occupied: Point[]): boolean {
  const off = controlSystemOffsets(n, mirror);
  const pts = [off.control, ...off.rows.flatMap((r) => [r.response, r.emptying, r.database, r.retrieve])].map((q) => ({ x: control.x + q.x, y: control.y + q.y }));
  if (!pts.every((p) => free(p, occupied))) return false;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs) - 40, Math.max(...xs) + 40, Math.min(...ys) - 40, Math.max(...ys) + 40];
  return occupied.every((q) => q.x < x0 || q.x > x1 || q.y < y0 || q.y > y1);
}

/** A point beside `step`, on the side away from the centre of the existing drawing. */
export function awayFrom(step: Point, occupied: Point[], distance = 160): Point {
  if (occupied.length === 0) return { x: step.x - distance, y: step.y };
  const c = { x: occupied.reduce((s, p) => s + p.x, 0) / occupied.length, y: occupied.reduce((s, p) => s + p.y, 0) / occupied.length };
  let v = { x: step.x - c.x, y: step.y - c.y };
  const len = Math.hypot(v.x, v.y);
  v = len < 1 ? { x: 0, y: 1 } : { x: v.x / len, y: v.y / len };
  return { x: step.x + v.x * distance, y: step.y + v.y * distance };
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Give the arcs with the given ids one bend point when their straight line passes over a node, or runs
 * along another arc between the same two nodes.
 */
export function bendArcs(net: Net, arcIds: Set<string>): void {
  const nodes = [...net.places, ...net.transitions];
  const at = new Map(nodes.map((n) => [n.id, n]));
  for (const a of net.arcs) {
    if (!arcIds.has(a.id)) continue;
    const s = at.get(a.source);
    const t = at.get(a.target);
    if (!s || !t) continue;
    const hits = (p: Point, q: Point) => nodes.some((n) => n.id !== a.source && n.id !== a.target && distToSegment(n, p, q) < 22);
    const twin = net.arcs.some((b) => b !== a && !b.points?.length && ((b.source === a.source && b.target === a.target) || (b.source === a.target && b.target === a.source)));
    if (!twin && !hits(s, t)) continue;
    const len = Math.hypot(t.x - s.x, t.y - s.y) || 1;
    const perp = { x: -(t.y - s.y) / len, y: (t.x - s.x) / len };
    const mid = { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };
    for (const off of [40, -40, 70, -70, 100, -100]) {
      const b = { x: Math.round(mid.x + perp.x * off), y: Math.round(mid.y + perp.y * off) };
      if (!hits(s, b) && !hits(b, t)) {
        a.points = [b];
        break;
      }
    }
  }
}

/** Positions for every element of a control system whose control place is at `control`. */
export function controlSystemPositions(control: Point, n: number, mirror: boolean) {
  const off = controlSystemOffsets(n, mirror);
  const at = (q: Point) => ({ x: Math.round(control.x + q.x), y: Math.round(control.y + q.y) });
  return off.rows.map((r) => ({ response: at(r.response), emptying: at(r.emptying), database: at(r.database), retrieve: at(r.retrieve) }));
}

/** Shift every node so that the drawing starts near (60, 60). */
export function normalise(net: Net): void {
  const nodes = [...net.places, ...net.transitions];
  if (nodes.length === 0) return;
  const dx = 80 - Math.min(...nodes.map((n) => n.x));
  const dy = 80 - Math.min(...nodes.map((n) => n.y));
  for (const n of nodes) {
    n.x = Math.round(n.x + dx);
    n.y = Math.round(n.y + dy);
  }
  for (const a of net.arcs) a.points = a.points?.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}
