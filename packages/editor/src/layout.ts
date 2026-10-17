import type { Point } from "@pns/core";
import { isFaultTree } from "@pns/core";
import { PLACE_R, ftSize, pageView, transSize } from "./geometry";
import { applyLayout, toast, useStore } from "./store";

export type LayoutStyle = "layered" | "layeredDown" | "force" | "grid";

/**
 * Lay out the current page with ELK (the Eclipse Layout Kernel). Layered layout follows the
 * flow of arcs, like Snoopy's Graphviz "dot" layout; force is like "neato".
 */
export async function autoLayout(style: LayoutStyle = "layered", onlySelection = false): Promise<void> {
  const s = useStore.getState();
  if (s.mode !== "edit") return;
  const { net, ghosts } = pageView(s.net, s.page);
  const sel = new Set(s.selection);
  const pick = <T extends { id: string }>(xs: T[]) => xs.filter((x) => !ghosts.has(x.id) && (!onlySelection || sel.has(x.id)));
  const ft = isFaultTree(net.netClass);
  const children: { id: string; width: number; height: number }[] = [];
  // Boxes include room for the name labels, so labels don't land on neighbouring nodes or arcs.
  const labelW = (name: string) => Math.min(160, name.length * 7 + 10);
  for (const p of pick(net.places)) children.push({ id: p.id, width: Math.max(PLACE_R * 2 + 30, labelW(p.name)), height: PLACE_R * 2 + 30 });
  for (const t of pick(net.transitions)) {
    const { w, h } = transSize(t);
    children.push({ id: t.id, width: Math.max(w + 40, labelW(t.name)), height: h + 34 });
  }
  for (const n of pick(net.faultTree?.nodes ?? [])) {
    const { w, h } = ftSize(n);
    children.push({ id: n.id, width: w + 20, height: h + 34 });
  }
  if (children.length < 2) {
    toast(onlySelection ? "Select at least two nodes to lay out" : "Nothing to lay out yet");
    return;
  }
  const ids = new Set(children.map((c) => c.id));
  const edges = [
    ...net.arcs.filter((a) => ids.has(a.source) && ids.has(a.target)).map((a) => ({ id: a.id, sources: [a.source], targets: [a.target] })),
    ...(net.faultTree?.edges ?? []).filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  ];

  const layoutOptions: Record<string, string> =
    style === "force"
      ? { "elk.algorithm": "stress", "elk.stress.desiredEdgeLength": "110" }
      : style === "grid"
        ? { "elk.algorithm": "box", "elk.spacing.nodeNode": "40" }
        : {
            "elk.algorithm": "layered",
            "elk.direction": ft ? "UP" : style === "layeredDown" ? "DOWN" : "RIGHT",
            "elk.layered.spacing.nodeNodeBetweenLayers": ft ? "40" : "50",
            "elk.layered.spacing.edgeNodeBetweenLayers": "20",
            "elk.spacing.edgeNode": "18",
            "elk.spacing.nodeNode": ft ? "30" : "36",
            "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
            "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
            "elk.edgeRouting": ft ? "ORTHOGONAL" : "POLYLINE",
          };

  try {
    const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
    const elk = new ELK();
    const res = await elk.layout({ id: "root", layoutOptions, children, edges });
    // Keep the drawing where it was: shift the result so its top-left matches the old one.
    const oldNodes = children.map((c) => findPos(net, c.id)!);
    const ox = Math.min(...oldNodes.map((p) => p.x));
    const oy = Math.min(...oldNodes.map((p) => p.y));
    const pos = new Map<string, Point>();
    for (const c of res.children ?? []) pos.set(c.id, { x: (c.x ?? 0) + (c.width ?? 0) / 2, y: (c.y ?? 0) + (c.height ?? 0) / 2 });
    const nx = Math.min(...[...pos.values()].map((p) => p.x));
    const ny = Math.min(...[...pos.values()].map((p) => p.y));
    const snap10 = (v: number) => Math.round(v / 10) * 10;
    for (const [id, p] of pos) pos.set(id, { x: snap10(p.x - nx + ox), y: snap10(p.y - ny + oy) });
    // Keep ELK's bend points for long and backward arcs, so they route around nodes instead of through them.
    const routed = new Map<string, Point[]>();
    if (style === "layered" || style === "layeredDown")
      for (const e of (res.edges ?? []) as { id: string; sections?: { bendPoints?: { x: number; y: number }[] }[] }[]) {
        const pts = e.sections?.flatMap((sec) => sec.bendPoints ?? []) ?? [];
        if (pts.length) routed.set(e.id, pts.map((p) => ({ x: snap10(p.x - nx + ox), y: snap10(p.y - ny + oy) })));
      }
    const bends = new Map<string, Point[]>();
    for (const e of net.arcs) if (ids.has(e.source) && ids.has(e.target)) bends.set(e.id, ft ? [] : routed.get(e.id) ?? []);
    applyLayout(pos, bends);
    toast("Layout applied. Ctrl+Z undoes it.");
  } catch (e) {
    toast(`Layout failed: ${(e as Error).message}`, "error");
  }
}

function findPos(net: ReturnType<typeof pageView>["net"], id: string): Point | undefined {
  return net.places.find((p) => p.id === id) ?? net.transitions.find((t) => t.id === id) ?? net.faultTree?.nodes.find((n) => n.id === id);
}
