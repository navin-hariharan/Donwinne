// The reachability graph drawn as a graph: one box per state, one arrow per firing, laid out top to
// bottom with ELK so the initial marking is at the top and the flow of the net reads downwards.

import React, { useEffect, useState } from "react";

export interface RGNode {
  /** Short name, "M0" for the initial marking. */
  name: string;
  /** The marking as text, e.g. "ready, 2 busy". */
  text: string;
  dead?: boolean;
}

export interface RGEdge {
  from: number;
  to: number;
  label: string;
}

interface Laid {
  nodes: { x: number; y: number; w: number; h: number }[];
  edges: { points: { x: number; y: number }[]; label?: { x: number; y: number } }[];
  width: number;
  height: number;
}

/** States beyond this are not drawn; the table still lists them. */
export const RG_GRAPH_LIMIT = 150;

const CHAR_W = 6.6;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function RGGraph({ nodes, edges, onPick }: { nodes: RGNode[]; edges: RGEdge[]; onPick: (i: number) => void }) {
  const [laid, setLaid] = useState<Laid | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = nodes.slice(0, RG_GRAPH_LIMIT);
  const shownEdges = edges.filter((e) => e.from < shown.length && e.to < shown.length);

  useEffect(() => {
    let live = true;
    setLaid(null);
    (async () => {
      try {
        const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
        const elk = new ELK();
        const res = await elk.layout({
          id: "rg",
          layoutOptions: {
            "elk.algorithm": "layered",
            "elk.direction": "DOWN",
            "elk.layered.spacing.nodeNodeBetweenLayers": "46",
            "elk.spacing.nodeNode": "28",
            "elk.spacing.edgeLabel": "4",
            "elk.edgeLabels.inline": "true",
            "elk.edgeRouting": "POLYLINE",
            // States are numbered in the order they were found, so following that order when breaking
            // cycles keeps the initial marking at the top and most arrows pointing down.
            "elk.layered.cycleBreaking.strategy": "MODEL_ORDER",
          },
          children: shown.map((n, i) => ({
            id: `s${i}`,
            width: Math.max(44, Math.min(220, clip(n.text, 32).length * CHAR_W) + 16),
            height: 38,
            layoutOptions: i === 0 ? { "elk.layered.layering.layerConstraint": "FIRST" } : undefined,
          })),
          edges: shownEdges.map((e, i) => ({
            id: `e${i}`,
            sources: [`s${e.from}`],
            targets: [`s${e.to}`],
            labels: [{ text: clip(e.label, 18), width: clip(e.label, 18).length * CHAR_W, height: 12 }],
          })),
        });
        if (!live) return;
        const kids = res.children ?? [];
        type Sec = { startPoint: { x: number; y: number }; endPoint: { x: number; y: number }; bendPoints?: { x: number; y: number }[] };
        const out = ((res.edges ?? []) as { sections?: Sec[]; labels?: { x?: number; y?: number; width?: number; height?: number }[] }[]).map((e) => {
          const sec = e.sections?.[0];
          const lab = e.labels?.[0];
          return {
            points: sec ? [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint] : [],
            label: lab ? { x: (lab.x ?? 0) + (lab.width ?? 0) / 2, y: (lab.y ?? 0) + (lab.height ?? 0) / 2 } : undefined,
          };
        });
        setLaid({
          nodes: kids.map((c) => ({ x: c.x ?? 0, y: c.y ?? 0, w: c.width ?? 0, h: c.height ?? 0 })),
          edges: out,
          width: (res.width ?? 0) + 24,
          height: (res.height ?? 0) + 24,
        });
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    })();
    return () => {
      live = false;
    };
    // The graph is rebuilt only when a new exploration produces new arrays.
  }, [nodes, edges]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="error-text">Could not draw the graph: {error}</p>;
  if (!laid) return <p className="muted small">Drawing the graph…</p>;
  // Self-loops have no route from ELK; they are drawn as a small loop on the right of the state.
  return (
    <div className="rg-graph" data-testid="rg-graph">
      {nodes.length > shown.length && <p className="muted small">Drawing the first {shown.length} of {nodes.length} states; the table lists them all.</p>}
      <svg width={laid.width} height={laid.height} viewBox={`-12 -12 ${laid.width} ${laid.height}`} role="img" aria-label="Reachability graph">
        <defs>
          <marker id="rg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="rg-arrowhead" />
          </marker>
        </defs>
        {shownEdges.map((e, i) => {
          const r = laid.edges[i];
          if (e.from === e.to) {
            const n = laid.nodes[e.from];
            const x = n.x + n.w, y = n.y + n.h / 2;
            return (
              <g key={i} className="rg-edge">
                <path d={`M${x},${y - 8} C${x + 26},${y - 22} ${x + 26},${y + 22} ${x},${y + 8}`} markerEnd="url(#rg-arrow)" />
                <text x={x + 24} y={y + 4}>{clip(e.label, 18)}</text>
              </g>
            );
          }
          if (!r?.points.length) return null;
          const d = `M${r.points.map((p) => `${p.x},${p.y}`).join(" L")}`;
          return (
            <g key={i} className="rg-edge">
              <path d={d} markerEnd="url(#rg-arrow)">
                <title>{e.label}</title>
              </path>
              {r.label && (
                <text x={r.label.x} y={r.label.y + 4} textAnchor="middle">
                  {clip(e.label, 18)}
                </text>
              )}
            </g>
          );
        })}
        {shown.map((n, i) => {
          const b = laid.nodes[i];
          return (
            <g key={i} className={`rg-node ${n.dead ? "dead" : ""} ${i === 0 ? "initial" : ""}`} transform={`translate(${b.x},${b.y})`} onClick={() => onPick(i)} role="button" tabIndex={0} onKeyDown={(ev) => ev.key === "Enter" && onPick(i)}>
              <title>{`${n.name}: ${n.text || "no tokens"}${n.dead ? " (dead)" : ""}. Click to replay the path to it.`}</title>
              <rect width={b.w} height={b.h} rx={8} />
              <text x={b.w / 2} y={14} textAnchor="middle" className="rg-name">
                {n.name}
              </text>
              <text x={b.w / 2} y={29} textAnchor="middle" className="rg-marking">
                {clip(n.text || "∅", 32)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
