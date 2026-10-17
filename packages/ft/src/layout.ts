// Tidy top-down layout of fault trees.

import { FTNode, Net } from "@pns/core";
import { treeOf } from "./structure";

/** Options for {@link layoutFaultTree}. */
export interface LayoutOptions {
  /** Horizontal distance between neighbouring leaves (default 90). */
  dx?: number;
  /** Vertical distance between levels (default 100). */
  dy?: number;
  /** Position of the top event's level and of the leftmost leaf (default 60, 60). */
  x0?: number;
  y0?: number;
}

/**
 * Lay a fault tree out top-down: the top event at the top, each node one level below the node it
 * feeds, leaves in their own columns and every node centred over its children, so nodes never
 * overlap. Shared events (a DAG) are placed under their first parent. Nodes not connected to the
 * top event are laid out as further trees to the right. Returns a new net; edge bends are dropped.
 */
export function layoutFaultTree(net: Net, opts: LayoutOptions = {}): Net {
  const { nodes, edges } = treeOf(net);
  const dx = opts.dx ?? 90;
  const dy = opts.dy ?? 100;
  const x0 = opts.x0 ?? 60;
  const y0 = opts.y0 ?? 60;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  edges.forEach((e) => {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) return;
    const list = children.get(e.target) ?? children.set(e.target, []).get(e.target)!;
    if (!list.includes(e.source)) list.push(e.source);
    hasParent.add(e.source);
  });
  for (const list of children.values()) list.sort((a, b) => byId.get(a)!.x - byId.get(b)!.x);

  const roots = [
    ...nodes.filter((n) => n.type === "top"),
    ...nodes.filter((n) => n.type !== "top" && !hasParent.has(n.id)).sort((a, b) => a.x - b.x),
    ...nodes, // anything left (cycles)
  ];
  const pos = new Map<string, { x: number; y: number }>();
  const placed = new Set<string>();
  let column = 0;
  const place = (rootId: string) => {
    // Iterative post-order over a spanning tree (first parent wins).
    const stack: { id: string; depth: number; kids: string[]; i: number }[] = [];
    const push = (id: string, depth: number) => {
      placed.add(id);
      const kids = (children.get(id) ?? []).filter((c) => !placed.has(c));
      kids.forEach((c) => placed.add(c));
      stack.push({ id, depth, kids, i: 0 });
    };
    push(rootId, 0);
    while (stack.length) {
      const f = stack[stack.length - 1];
      if (f.i < f.kids.length) {
        const c = f.kids[f.i++];
        placed.delete(c);
        push(c, f.depth + 1);
        continue;
      }
      stack.pop();
      const y = y0 + f.depth * dy;
      if (!f.kids.length) pos.set(f.id, { x: x0 + column++ * dx, y });
      else {
        const xs = f.kids.map((c) => pos.get(c)!.x);
        pos.set(f.id, { x: (Math.min(...xs) + Math.max(...xs)) / 2, y });
      }
    }
  };
  for (const r of roots) if (!placed.has(r.id)) place(r.id);
  const out: FTNode[] = nodes.map((n) => ({ ...n, ...pos.get(n.id)! }));
  return { ...net, faultTree: { nodes: out, edges: edges.map(({ points: _p, ...e }) => e) } };
}
