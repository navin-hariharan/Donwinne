import React, { useMemo, useRef } from "react";
import type { Arc, CompiledNet, FTNode, Marking, Net, NetClass, Note, Place, Point, Transition } from "@pns/core";
import { isColoured, showTokens, timeBase } from "@pns/core";
import { Box, NodeShape, PLACE_R, arcPathBetween, ftEdgePath, ftSize, nearBox, noteSize, parallelOffset, polylineMid, sameButLayout, shapeOf, shortName, transSize } from "./geometry";

export interface Palette {
  ink: string;
  muted: string;
  nodeFill: string;
  nodeStroke: string;
  selected: string;
  enabled: string;
  enabledFill: string;
  error: string;
  token: string;
  font: string;
  logicalFill: string;
  noteFill: string;
  highlight: string;
  /** The token trail of the token game, and the places where tokens are stuck in a deadlock. */
  trail: string;
  /** Background behind the drawing: label halos use it so arcs never cut through text. */
  canvas: string;
}

/** Colours for the live canvas: CSS variables, so the theme can change without re-rendering logic. */
export const CSS_PALETTE: Palette = {
  ink: "var(--ink)",
  muted: "var(--muted)",
  nodeFill: "var(--node-fill)",
  nodeStroke: "var(--node-stroke)",
  selected: "var(--accent)",
  enabled: "var(--enabled)",
  enabledFill: "var(--enabled-fill)",
  error: "var(--error)",
  token: "var(--ink)",
  font: "var(--font-ui)",
  logicalFill: "var(--logical-fill)",
  noteFill: "var(--note-fill)",
  highlight: "var(--highlight)",
  trail: "var(--trail)",
  canvas: "var(--canvas)",
};

/** Fixed colours for exported images. */
export const EXPORT_PALETTE: Palette = {
  ink: "#1d2330",
  muted: "#5b6577",
  nodeFill: "#ffffff",
  nodeStroke: "#1d2330",
  selected: "#2563eb",
  enabled: "#15803d",
  enabledFill: "#dcfce7",
  error: "#dc2626",
  token: "#1d2330",
  font: "Inter, 'Segoe UI', Helvetica, Arial, sans-serif",
  logicalFill: "#e5e7eb",
  noteFill: "#fef9c3",
  highlight: "#f59e0b",
  trail: "#dc2626",
  canvas: "#ffffff",
};

interface Props {
  net: Net;
  cn: CompiledNet;
  palette: Palette;
  marking?: Marking | null;
  selection?: Set<string>;
  enabled?: Set<string>;
  errorIds?: Set<string>;
  /** Search hits and other highlighted elements. */
  highlight?: Set<string>;
  ghosts?: Set<string>;
  /** Interactive canvas: adds hit areas and bend-point handles. */
  interactive?: boolean;
  /** The transition (or the transitions of the step) fired last. */
  lastFired?: string | string[];
  /** Step token game: colour-sensitive inhibitor arcs blocking some colour mode, with the colours they block. */
  blocking?: Map<string, string[]>;
  /** Elements whose label is being edited on the canvas: their label is hidden. */
  editing?: string | null;
  /** Fault tree: ids of failed events (from analysis or a cut set). */
  failed?: Set<string>;
  /** Token game: elements the tokens went through, with their strength (0..1). */
  trail?: Map<string, number>;
  /** Token game in a deadlock: the places whose tokens can no longer move. */
  stuck?: Set<string>;
  /**
   * Canvas only: labels with a font size below this are left out (see labelCutoff), except on the selected
   * and hovered elements. Exports leave it unset and draw every label.
   */
  labelMin?: number;
  /** The element under the pointer, which keeps its labels whatever labelMin says. */
  hover?: string | null;
  /** Canvas only: cut long names short; the full name is in a tooltip. */
  shortNames?: boolean;
  /** Canvas only: draw only what lies in this part of the drawing (see cullBox). */
  viewport?: Box;
}

const TOKEN_DOTS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-6, 0], [6, 0]],
  3: [[-6, 5], [6, 5], [0, -6]],
  4: [[-6, -6], [6, -6], [-6, 6], [6, 6]],
  5: [[-7, -7], [7, -7], [0, 0], [-7, 7], [7, 7]],
};

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function formatAmount(n: number): string {
  if (Number.isInteger(n)) return String(n);
  if (Math.abs(n) >= 1000 || Math.abs(n) < 0.001) return n.toPrecision(3);
  return String(Math.round(n * 1000) / 1000);
}

const labelStyle = (palette: Palette, size = 12): React.CSSProperties => ({
  fill: palette.ink,
  fontSize: size,
  fontFamily: palette.font,
  paintOrder: "stroke",
  stroke: palette.canvas,
  strokeWidth: 5,
  strokeLinejoin: "round",
});

function NameLabel({ id, x, y, text, palette, interactive, hidden, short, anchor = "middle" }: {
  id: string;
  x: number;
  y: number;
  text: string;
  palette: Palette;
  interactive?: boolean;
  hidden?: boolean;
  short?: boolean;
  anchor?: "middle" | "start" | "end";
}) {
  if (hidden || !text) return null;
  const shown = short ? shortName(text) : text;
  return (
    <text x={x} y={y} textAnchor={anchor} data-label={interactive ? id : undefined} style={{ ...labelStyle(palette), cursor: interactive ? "move" : undefined }}>
      {shown !== text && <title>{text}</title>}
      {shown}
    </text>
  );
}

const PlaceView = React.memo(function PlaceView({ p, tokensText, count, amount, palette, selected, error, interactive, coloured, ghost, highlight, editing, trail, stuck, labelMin = 0, shortNames }: {
  p: Place;
  labelMin?: number;
  shortNames?: boolean;
  trail?: number;
  stuck?: boolean;
  tokensText: string;
  count: number;
  amount: number | null;
  palette: Palette;
  selected: boolean;
  error: boolean;
  interactive?: boolean;
  coloured: boolean;
  ghost: boolean;
  highlight: boolean;
  editing: boolean;
}) {
  const stroke = selected ? palette.selected : error ? palette.error : palette.nodeStroke;
  const dots = amount === null && !coloured && count > 0 && count <= 5 ? TOKEN_DOTS[count] : null;
  const fill = p.color ?? (p.logical ? palette.logicalFill : palette.nodeFill);
  const lo = p.labelOffset ?? { x: 0, y: 0 };
  return (
    <g
      data-id={interactive ? p.id : undefined}
      data-kind="place"
      style={{ cursor: interactive ? "pointer" : undefined, opacity: ghost ? 0.55 : undefined }}
    >
      {interactive && <circle cx={p.x} cy={p.y} r={PLACE_R} className="hit-pad" />}
      {highlight && <circle cx={p.x} cy={p.y} r={PLACE_R + 7} style={{ fill: palette.highlight, fillOpacity: 0.25, stroke: palette.highlight, strokeWidth: 2 }} />}
      {stuck && (
        <circle cx={p.x} cy={p.y} r={PLACE_R + 8} className="trail-stuck" style={{ fill: palette.trail, fillOpacity: 0.12, stroke: palette.trail, strokeWidth: 2.5 }}>
          <title>Deadlock: the tokens here can no longer move</title>
        </circle>
      )}
      {trail !== undefined && <circle cx={p.x} cy={p.y} r={PLACE_R + 3.5} style={{ fill: "none", stroke: palette.trail, strokeWidth: 3, strokeOpacity: trail }} />}
      {p.coarse && <circle cx={p.x + 4} cy={p.y + 4} r={PLACE_R} style={{ fill: palette.nodeFill, stroke, strokeWidth: 1.2 }} />}
      <circle
        cx={p.x}
        cy={p.y}
        r={PLACE_R}
        style={{ fill, stroke, strokeWidth: selected ? 2.5 : 1.5, strokeDasharray: ghost ? "4 3" : undefined }}
      />
      {p.continuous && <circle cx={p.x} cy={p.y} r={PLACE_R - 3.5} style={{ fill: "none", stroke, strokeWidth: 1.2 }} />}
      {p.gluing && (
        <g>
          <title>Gluing (interface) place</title>
          <circle cx={p.x} cy={p.y} r={PLACE_R + 4} style={{ fill: "none", stroke, strokeWidth: 1.2 }} />
          <text x={p.x - PLACE_R - 5} y={p.y + PLACE_R + 6} textAnchor="end" style={{ ...labelStyle(palette, 10.5), fill: palette.muted, fontWeight: 700 }}>
            G
          </text>
        </g>
      )}
      {p.fixed && (
        <path d={`M${p.x - 5},${p.y - PLACE_R - 7} h10 l-5,6 z`} style={{ fill: stroke }}>
          <title>Fixed: the marking stays constant during simulation</title>
        </path>
      )}
      {dots?.map(([dx, dy], i) => <circle key={i} cx={p.x + dx} cy={p.y + dy} r={3.6} style={{ fill: palette.token }} />)}
      {!dots && amount === null && count > 0 && !coloured && (
        <text x={p.x} y={p.y + 4.5} textAnchor="middle" style={{ fill: palette.ink, fontSize: 13, fontWeight: 600, fontFamily: palette.font }}>
          {count}
        </text>
      )}
      {amount !== null && amount !== 0 && (
        <text x={p.x} y={p.y + 4} textAnchor="middle" style={{ fill: palette.ink, fontSize: 11, fontWeight: 600, fontFamily: palette.font }}>
          {formatAmount(amount)}
        </text>
      )}
      {coloured && !tokensText && count > 0 && (
        <text x={p.x} y={p.y + 4.5} textAnchor="middle" style={{ fill: palette.ink, fontSize: 13, fontWeight: 600, fontFamily: palette.font }}>
          {count}
        </text>
      )}
      {p.coarse && (
        <text x={p.x} y={p.y + 4} textAnchor="middle" style={{ fill: palette.muted, fontSize: 11, fontFamily: palette.font }}>
          ⋯
        </text>
      )}
      <NameLabel id={p.id} x={p.x + lo.x} y={p.y + PLACE_R + 15 + lo.y} text={p.name} palette={palette} interactive={interactive && !ghost} hidden={editing || 12 < labelMin} short={shortNames} />
      {coloured && tokensText && (
        <text x={p.x + PLACE_R + 4} y={p.y - PLACE_R + 2} style={{ ...labelStyle(palette, 11), fill: palette.selected }}>
          <title>{tokensText}</title>
          {truncate(tokensText, 36)}
        </text>
      )}
      {coloured && p.colourSet && p.colourSet !== "Dot" && 10.5 >= labelMin && (
        <text x={p.x - PLACE_R - 3} y={p.y - PLACE_R + 2} textAnchor="end" style={{ ...labelStyle(palette, 10.5), fill: palette.muted }}>
          {p.colourSet}
        </text>
      )}
      {p.capacity && 10.5 >= labelMin ? (
        <text x={p.x + PLACE_R + 3} y={p.y + PLACE_R + 2} style={{ ...labelStyle(palette, 10.5), fill: palette.muted }}>
          ≤{p.capacity}
        </text>
      ) : null}
    </g>
  );
});

function transitionSubLabel(netClass: NetClass, t: Transition): string {
  const parts: string[] = [];
  if (t.guard?.trim()) parts.push(`[${truncate(t.guard.trim(), 30)}]`);
  if (netClass === "timed" && t.interval) parts.push(`[${t.interval[0]}, ${t.interval[1]}]`);
  if (timeBase(netClass) && t.rate?.trim() && t.kind !== "immediate") parts.push(truncate(t.rate.trim(), 26));
  if (t.kind === "immediate" && t.rate?.trim() && t.rate.trim() !== "1") parts.push(`w=${truncate(t.rate.trim(), 16)}`);
  if (netClass === "music" && t.sound?.note) parts.push(`♪ ${t.sound.note}`);
  return parts.join("  ");
}

const TransitionView = React.memo(function TransitionView({ netClass, t, palette, selected, enabled, error, interactive, fired, ghost, highlight, editing, trail, labelMin = 0, shortNames }: {
  trail?: number;
  netClass: NetClass;
  labelMin?: number;
  shortNames?: boolean;
  t: Transition;
  palette: Palette;
  selected: boolean;
  enabled: boolean;
  error: boolean;
  interactive?: boolean;
  fired: boolean;
  ghost: boolean;
  highlight: boolean;
  editing: boolean;
}) {
  const { w, h } = transSize(t);
  const stroke = selected ? palette.selected : error ? palette.error : enabled ? palette.enabled : palette.nodeStroke;
  const kindFill = t.kind === "immediate" || t.kind === "deterministic" ? palette.nodeStroke : t.kind === "scheduled" ? palette.muted : null;
  const fill = enabled ? palette.enabledFill : t.color ?? kindFill ?? palette.nodeFill;
  const lo = t.labelOffset ?? { x: 0, y: 0 };
  const sub = 10.5 >= labelMin ? transitionSubLabel(netClass, t) : "";
  return (
    <g
      data-id={interactive ? t.id : undefined}
      data-kind="transition"
      style={{ cursor: interactive ? "pointer" : undefined, opacity: ghost ? 0.55 : undefined }}
    >
      {interactive && <rect x={t.x - w / 2} y={t.y - h / 2} width={w} height={h} className="hit-pad" />}
      {highlight && <rect x={t.x - w / 2 - 8} y={t.y - h / 2 - 8} width={w + 16} height={h + 16} rx={4} style={{ fill: palette.highlight, fillOpacity: 0.25, stroke: palette.highlight, strokeWidth: 2 }} />}
      {trail !== undefined && <rect x={t.x - w / 2 - 3.5} y={t.y - h / 2 - 3.5} width={w + 7} height={h + 7} rx={3} style={{ fill: "none", stroke: palette.trail, strokeWidth: 3, strokeOpacity: trail }} />}
      {enabled && interactive && <rect x={t.x - w / 2 - 5} y={t.y - h / 2 - 5} width={w + 10} height={h + 10} rx={4} style={{ fill: "none", stroke: palette.enabled, strokeOpacity: 0.35, strokeWidth: 3 }} />}
      {t.coarse && <rect x={t.x - w / 2 + 4} y={t.y - h / 2 + 4} width={w} height={h} rx={1.5} style={{ fill: palette.nodeFill, stroke, strokeWidth: 1.2 }} />}
      <rect
        x={t.x - w / 2}
        y={t.y - h / 2}
        width={w}
        height={h}
        rx={1.5}
        style={{ fill, stroke, strokeWidth: selected || enabled ? 2.5 : 1.5, strokeDasharray: ghost ? "4 3" : undefined }}
      />
      {t.kind === "continuous" && <rect x={t.x - w / 2 + 3} y={t.y - h / 2 + 3} width={Math.max(1, w - 6)} height={Math.max(1, h - 6)} style={{ fill: "none", stroke, strokeWidth: 1.1 }} />}
      {t.coarse && (
        <text x={t.x} y={t.y + 4} textAnchor="middle" style={{ fill: palette.muted, fontSize: 11, fontFamily: palette.font }}>
          ⋯
        </text>
      )}
      {fired && (
        <rect x={t.x - w / 2 - 4} y={t.y - h / 2 - 4} width={w + 8} height={h + 8} rx={3} style={{ fill: "none", stroke: palette.selected, strokeWidth: 1.5, strokeDasharray: "3 3" }}>
          <title>Fired last</title>
        </rect>
      )}
      <NameLabel id={t.id} x={t.x + lo.x} y={t.y - h / 2 - 7 + lo.y} text={t.name} palette={palette} interactive={interactive && !ghost} hidden={editing || 12 < labelMin} short={shortNames} />
      {sub && (
        <text x={t.x} y={t.y + h / 2 + 14} textAnchor="middle" style={{ ...labelStyle(palette, 10.5), fill: palette.muted }}>
          {sub}
        </text>
      )}
    </g>
  );
});

function head(kind: Arc["kind"], tip: Point, angle: number, color: string, bg: string): React.ReactNode {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const at = (back: number, side: number): string => `${tip.x - ca * back - sa * side},${tip.y - sa * back + ca * side}`;
  switch (kind) {
    case "normal":
      return <polygon points={`${at(0, 0)} ${at(11, 4.5)} ${at(11, -4.5)}`} style={{ fill: color }} />;
    case "reset":
      return (
        <>
          <polygon points={`${at(0, 0)} ${at(10, 4.5)} ${at(10, -4.5)}`} style={{ fill: color }} />
          <polygon points={`${at(8, 0)} ${at(18, 4.5)} ${at(18, -4.5)}`} style={{ fill: color }} />
        </>
      );
    case "read":
      return <circle cx={tip.x - ca * 4.5} cy={tip.y - sa * 4.5} r={4.5} style={{ fill: color }} />;
    case "inhibitor":
      return <circle cx={tip.x - ca * 5.5} cy={tip.y - sa * 5.5} r={5} style={{ fill: bg, stroke: color, strokeWidth: 1.6 }} />;
    case "equal":
      return <polygon points={`${at(0, 0)} ${at(6, 5)} ${at(12, 0)} ${at(6, -5)}`} style={{ fill: bg, stroke: color, strokeWidth: 1.6 }} />;
    case "modifier":
      return null;
  }
}

/** Length to trim off the line end so it meets the arrowhead cleanly. */
const HEAD_TRIM: Record<Arc["kind"], number> = { normal: 9, reset: 16, read: 8, inhibitor: 10, equal: 11, modifier: 0 };

// Arcs get their end nodes rather than the whole net, so an edit elsewhere doesn't redraw every arc.
const ArcView = React.memo(function ArcView({ src, srcKind, tgt, tgtKind, bulge, a, palette, selected, error, interactive, coloured, highlight, freestyle, blocks, trail, labelMin = 0 }: {
  trail?: number;
  src: NodeShape["node"];
  srcKind: NodeShape["kind"];
  tgt: NodeShape["node"];
  tgtKind: NodeShape["kind"];
  /** Sideways offset of parallel arcs (see parallelOffset). */
  bulge: number;
  labelMin?: number;
  a: Arc;
  palette: Palette;
  selected: boolean;
  error: boolean;
  interactive?: boolean;
  coloured: boolean;
  highlight: boolean;
  freestyle: boolean;
  blocks?: string[];
}) {
  const pts = arcPathBetween({ kind: srcKind, node: src } as NodeShape, { kind: tgtKind, node: tgt } as NodeShape, a.points, bulge);
  if (!pts) return null;
  const n = pts.length;
  const tip = pts[n - 1];
  const prev = pts[n - 2];
  const angle = Math.atan2(tip.y - prev.y, tip.x - prev.x);
  const trim = HEAD_TRIM[a.kind];
  const segLen = Math.hypot(tip.x - prev.x, tip.y - prev.y);
  const k = segLen > trim ? (segLen - trim) / segLen : 0;
  const end = { x: prev.x + (tip.x - prev.x) * k, y: prev.y + (tip.y - prev.y) * k };
  const d = [...pts.slice(0, -1), end].map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  const color = selected ? palette.selected : error || blocks ? palette.error : a.color ?? palette.nodeStroke;
  const label = a.inscription.trim();
  const showLabel = label && a.kind !== "modifier" && !(!coloured && label === "1") && 11.5 >= labelMin;
  const mid = polylineMid(pts);
  // Push the label off the line far enough that its box clears it, whatever the arc's angle.
  const shown = truncate(label, 40);
  const nx = Math.sin(mid.angle);
  const ny = -Math.cos(mid.angle);
  const off = 5 + (Math.abs(nx) * shown.length * 6.4) / 2 + (Math.abs(ny) * 13) / 2;
  const lx = mid.p.x + nx * off;
  const ly = mid.p.y + ny * off;
  return (
    <g data-id={interactive ? a.id : undefined} data-kind="arc" style={{ cursor: interactive ? "pointer" : undefined }}>
      {interactive && <path d={pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ")} className="arc-hit" />}
      {highlight && <path d={d} style={{ fill: "none", stroke: palette.highlight, strokeOpacity: 0.5, strokeWidth: 7 }} />}
      {trail !== undefined && <path d={pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ")} style={{ fill: "none", stroke: palette.trail, strokeOpacity: trail * 0.75, strokeWidth: 4.5, strokeLinecap: "round" }} />}
      <path d={d} style={{ fill: "none", stroke: color, strokeWidth: selected ? 2.2 : 1.4, strokeDasharray: a.kind === "modifier" ? "6 4" : undefined }} />
      {blocks && <path d={d} style={{ fill: "none", stroke: palette.error, strokeOpacity: 0.22, strokeWidth: 7 }} />}
      {freestyle ? null : head(a.kind, tip, angle, color, palette.nodeFill)}
      {blocks && (
        <text x={tip.x - Math.cos(angle) * 22 - Math.sin(angle) * 12} y={tip.y - Math.sin(angle) * 22 + Math.cos(angle) * 12 + 4} textAnchor="middle" style={{ ...labelStyle(palette, 11), fill: palette.error, fontWeight: 600 }}>
          <title>This colour-sensitive inhibitor arc blocks the colour modes {blocks.join(", ")}</title>
          blocks {blocks.join(", ")}
        </text>
      )}
      {showLabel && (
        <text x={lx} y={ly + 4} textAnchor="middle" style={labelStyle(palette, 11.5)}>
          {shown}
        </text>
      )}
      {interactive && selected &&
        (a.points ?? []).map((p, i) => (
          <rect key={i} data-bend={i} x={p.x - 4} y={p.y - 4} width={8} height={8} style={{ fill: palette.nodeFill, stroke: palette.selected, strokeWidth: 1.5, cursor: "move" }} />
        ))}
    </g>
  );
});

const NoteView = React.memo(function NoteView({ n, palette, selected, interactive, editing, highlight }: { n: Note; palette: Palette; selected: boolean; interactive?: boolean; editing: boolean; highlight: boolean }) {
  const { w, h } = noteSize(n);
  const lines = n.text.split("\n");
  return (
    <g data-id={interactive ? n.id : undefined} data-kind="note" style={{ cursor: interactive ? "move" : undefined }}>
      <rect
        x={n.x}
        y={n.y}
        width={w}
        height={h}
        rx={3}
        style={{ fill: n.color ?? palette.noteFill, stroke: selected ? palette.selected : highlight ? palette.highlight : palette.muted, strokeWidth: selected ? 2 : 0.8, strokeOpacity: selected ? 1 : 0.6 }}
      />
      {!editing &&
        lines.map((l, i) => (
          <text key={i} x={n.x + 8} y={n.y + 18 + i * 16} style={{ fill: palette.ink, fontSize: 12, fontFamily: palette.font }}>
            {l}
          </text>
        ))}
    </g>
  );
});

// ---------- fault trees ----------

function gatePath(type: FTNode["type"], x: number, y: number, w: number, h: number): string {
  const l = x - w / 2;
  const r = x + w / 2;
  const t = y - h / 2;
  const b = y + h / 2;
  switch (type) {
    case "and":
    case "pand":
      return `M${l},${b} L${l},${y} A${w / 2},${h / 2} 0 0 1 ${r},${y} L${r},${b} Z`;
    case "or":
    case "xor":
    case "kofn":
      return `M${l},${b} Q${x},${b - 10} ${r},${b} Q${r},${y - 4} ${x},${t} Q${l},${y - 4} ${l},${b} Z`;
    case "inhibit": {
      const q = h / 4;
      return `M${x},${t} L${r},${t + q} L${r},${b - q} L${x},${b} L${l},${b - q} L${l},${t + q} Z`;
    }
    case "not":
      return `M${l},${b} L${x},${t + 6} L${r},${b} Z`;
    case "cond":
      return `M${l},${t + 4} L${r},${t + 4} L${r},${b - 4} L${l},${b - 4} Z`;
    case "spare":
    case "fdep":
      return `M${l},${t} L${r},${t} L${r},${b} L${l},${b} Z`;
    default:
      return "";
  }
}

const GATE_TEXT: Partial<Record<FTNode["type"], string>> = {
  xor: "=1",
  pand: "P",
  not: "¬",
  cond: "C",
  spare: "SP",
  fdep: "FD",
};

const FTNodeView = React.memo(function FTNodeView({ n, inputs, palette, selected, interactive, editing, failed, highlight, labelMin = 0, shortNames }: {
  n: FTNode;
  labelMin?: number;
  shortNames?: boolean;
  inputs: number;
  palette: Palette;
  selected: boolean;
  interactive?: boolean;
  editing: boolean;
  failed: boolean;
  highlight: boolean;
}) {
  const { w, h } = ftSize(n);
  const stroke = selected ? palette.selected : failed ? palette.error : palette.nodeStroke;
  const fill = failed ? "rgba(220,38,38,0.15)" : n.color ?? palette.nodeFill;
  const sw = selected ? 2.4 : 1.5;
  let shape: React.ReactNode;
  let labelY = n.y + h / 2 + 15;
  let labelInside = false;
  switch (n.type) {
    case "top":
    case "intermediate":
      shape = <rect x={n.x - w / 2} y={n.y - h / 2} width={w} height={h} rx={n.type === "top" ? 6 : 2} style={{ fill, stroke, strokeWidth: n.type === "top" ? sw + 0.8 : sw }} />;
      labelInside = true;
      break;
    case "basic":
      shape = <circle cx={n.x} cy={n.y} r={w / 2} style={{ fill, stroke, strokeWidth: sw }} />;
      break;
    case "undeveloped":
      shape = <polygon points={`${n.x},${n.y - h / 2} ${n.x + w / 2},${n.y} ${n.x},${n.y + h / 2} ${n.x - w / 2},${n.y}`} style={{ fill, stroke, strokeWidth: sw }} />;
      break;
    default: {
      const tag = n.type === "kofn" ? `${n.k ?? 2}/${inputs}` : GATE_TEXT[n.type];
      shape = (
        <>
          <path d={gatePath(n.type, n.x, n.y, w, h)} style={{ fill, stroke, strokeWidth: sw }} />
          {n.type === "xor" && <path d={`M${n.x - w / 2},${n.y + h / 2 + 4} Q${n.x},${n.y + h / 2 - 6} ${n.x + w / 2},${n.y + h / 2 + 4}`} style={{ fill: "none", stroke, strokeWidth: sw }} />}
          {n.type === "pand" && <line x1={n.x - w / 2} y1={n.y + h / 2 - 8} x2={n.x + w / 2} y2={n.y + h / 2 - 8} style={{ stroke, strokeWidth: 1 }} />}
          {n.type === "fdep" && <line x1={n.x - w / 2} y1={n.y - h / 2 + 10} x2={n.x + w / 2} y2={n.y - h / 2 + 10} style={{ stroke, strokeWidth: 1 }} />}
          {tag && (
            <text x={n.x} y={n.y + 9} textAnchor="middle" style={{ fill: palette.ink, fontSize: 10.5, fontWeight: 600, fontFamily: palette.font }}>
              {tag}
            </text>
          )}
        </>
      );
      labelY = n.y - h / 2 - 6;
    }
  }
  return (
    <g data-id={interactive ? n.id : undefined} data-kind="ft" style={{ cursor: interactive ? "pointer" : undefined }}>
      {interactive && <rect x={n.x - w / 2} y={n.y - h / 2} width={w} height={h} className="hit-pad" />}
      {highlight && <rect x={n.x - w / 2 - 7} y={n.y - h / 2 - 7} width={w + 14} height={h + 14} rx={5} style={{ fill: palette.highlight, fillOpacity: 0.25, stroke: palette.highlight, strokeWidth: 2 }} />}
      {shape}
      {!editing &&
        (labelInside ? (
          12 >= labelMin && (
            <text x={n.x} y={n.y + 4} textAnchor="middle" style={{ fill: palette.ink, fontSize: 12, fontWeight: 600, fontFamily: palette.font }}>
              {truncate(n.name, 14)}
            </text>
          )
        ) : (
          11.5 >= labelMin && (
            <text x={n.x} y={labelY} textAnchor="middle" style={labelStyle(palette, 11.5)}>
              {shortNames && shortName(n.name) !== n.name && <title>{n.name}</title>}
              {shortNames ? shortName(n.name) : n.name}
            </text>
          )
        ))}
      {n.type === "basic" && (n.probability || n.failureRate) && 10 >= labelMin && (
        <text x={n.x} y={n.y + h / 2 + 28} textAnchor="middle" style={{ ...labelStyle(palette, 10), fill: palette.muted }}>
          {n.probability ? `p=${n.probability}` : `λ=${n.failureRate}`}
        </text>
      )}
    </g>
  );
});

export const FaultTreeDrawing = React.memo(function FaultTreeDrawing({ net, palette, selection, interactive, editing, failed, highlight, labelMin = 0, hover, shortNames, viewport }: {
  net: Net;
  palette: Palette;
  selection?: Set<string>;
  interactive?: boolean;
  editing?: string | null;
  failed?: Set<string>;
  highlight?: Set<string>;
  labelMin?: number;
  hover?: string | null;
  shortNames?: boolean;
  viewport?: Box;
}) {
  const ft = net.faultTree;
  const { visible, inputs } = useMemo(() => {
    const inputs = new Map<string, number>();
    for (const e of ft?.edges ?? []) inputs.set(e.target, (inputs.get(e.target) ?? 0) + 1);
    return { visible: new Set(ft?.nodes.map((n) => n.id)), inputs };
  }, [ft]);
  if (!ft) return null;
  return (
    <g>
      {ft.edges
        .filter((e) => visible.has(e.source) && visible.has(e.target))
        .map((e) => {
          const pts = ftEdgePath(net, e);
          if (!pts) return null;
          const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
          const sel = selection?.has(e.id);
          return (
            <g key={e.id} data-id={interactive ? e.id : undefined} data-kind="ftedge" style={{ cursor: interactive ? "pointer" : undefined }}>
              {interactive && <path d={d} className="arc-hit" />}
              <path d={d} style={{ fill: "none", stroke: sel ? palette.selected : palette.nodeStroke, strokeWidth: sel ? 2.2 : 1.4 }} />
            </g>
          );
        })}
      {ft.nodes.map((n) =>
        viewport && !nearBox(viewport, n.x, n.y, 120) ? null : (
          <FTNodeView
            key={n.id}
            n={n}
            inputs={inputs.get(n.id) ?? 0}
            palette={palette}
            selected={!!selection?.has(n.id)}
            interactive={interactive}
            editing={editing === n.id}
            failed={!!failed?.has(n.id)}
            highlight={!!highlight?.has(n.id)}
            labelMin={labelMin && !selection?.has(n.id) && hover !== n.id ? labelMin : 0}
            shortNames={shortNames}
          />
        ),
      )}
    </g>
  );
});

// ---------- whole net ----------

/**
 * The net, or the earlier version of it this returned before if the two differ only in layout (see sameButLayout).
 * Compiling and checking it then hits the caches, so dragging nodes around a big net doesn't recompile it at every step.
 */
export function useLayoutStableNet(net: Net): Net {
  const last = useRef(net);
  const stable = useMemo(() => (sameButLayout(last.current, net) ? last.current : net), [net]);
  last.current = stable;
  return stable;
}

const NONE: Set<string> = new Set();

/** Whether an arc between these nodes, through these bend points, may reach into the box. */
function arcNearBox(b: Box, s: Point, t: Point, points: Point[] | undefined, pad: number): boolean {
  let x0 = Math.min(s.x, t.x);
  let x1 = Math.max(s.x, t.x);
  let y0 = Math.min(s.y, t.y);
  let y1 = Math.max(s.y, t.y);
  for (const q of points ?? []) {
    x0 = Math.min(x0, q.x);
    x1 = Math.max(x1, q.x);
    y0 = Math.min(y0, q.y);
    y1 = Math.max(y1, q.y);
  }
  return x1 + pad >= b.x && x0 - pad <= b.x + b.w && y1 + pad >= b.y && y0 - pad <= b.y + b.h;
}

// Memoised, as are the element views below: on a big net a re-render that changes nothing must stay cheap.
export const NetDrawing = React.memo(function NetDrawing({ net, cn, palette, marking, selection, enabled, errorIds, interactive, lastFired, blocking, highlight, ghosts, editing, failed, trail, stuck, labelMin = 0, hover, shortNames, viewport }: Props) {
  const sel = selection ?? NONE;
  const errs = errorIds ?? NONE;
  const hl = highlight ?? NONE;
  const gh = ghosts ?? NONE;
  const slotOf = useMemo(() => new Map(cn.places.map((p) => [p.id, p.slot])), [cn]);
  const coloured = isColoured(net.netClass);
  const freestyle = net.netClass === "freestyle";
  const realId = (id: string) => (id.startsWith("ghost:") ? id.slice(6) : id);
  // Selected and hovered elements keep all their labels.
  const lod = (id: string) => (labelMin && !sel.has(id) && hover !== id ? labelMin : 0);
  // Room around a node for its labels, when deciding whether it is in view.
  const reach = (n: { labelOffset?: Point }) => 90 + Math.abs(n.labelOffset?.x ?? 0) + Math.abs(n.labelOffset?.y ?? 0);
  return (
    <g>
      <g>
        {(net.notes ?? []).map((n) => {
          if (viewport) {
            const { w, h } = noteSize(n);
            if (!nearBox(viewport, n.x + w / 2, n.y + h / 2, Math.max(w, h) / 2)) return null;
          }
          return <NoteView key={n.id} n={n} palette={palette} selected={sel.has(n.id)} interactive={interactive} editing={editing === n.id} highlight={hl.has(n.id)} />;
        })}
      </g>
      <FaultTreeDrawing net={net} palette={palette} selection={sel} interactive={interactive} editing={editing} failed={failed} highlight={hl} labelMin={labelMin} hover={hover} shortNames={shortNames} viewport={viewport} />
      <g>
        {net.arcs.map((a) => {
          const s = shapeOf(net, a.source);
          const t = shapeOf(net, a.target);
          if (!s || !t) return null;
          const off = parallelOffset(net, a);
          if (viewport && !arcNearBox(viewport, s.node, t.node, a.points, 80 + Math.abs(off))) return null;
          return (
            <ArcView
              key={a.id}
              src={s.node}
              srcKind={s.kind}
              tgt={t.node}
              tgtKind={t.kind}
              bulge={off}
              a={a}
              palette={palette}
              selected={sel.has(a.id)}
              error={errs.has(a.id)}
              interactive={interactive}
              coloured={coloured}
              highlight={hl.has(a.id)}
              freestyle={freestyle}
              blocks={blocking?.get(a.id)}
              trail={trail?.get(realId(a.id))}
              labelMin={lod(a.id)}
            />
          );
        })}
      </g>
      <g>
        {net.transitions.map((t) =>
          viewport && !nearBox(viewport, t.x, t.y, reach(t)) ? null : (
          <TransitionView
            key={t.id}
            netClass={net.netClass}
            labelMin={lod(t.id)}
            shortNames={shortNames}
            t={t}
            palette={palette}
            selected={sel.has(t.id)}
            enabled={!!enabled?.has(realId(t.id))}
            error={errs.has(t.id)}
            interactive={interactive}
            fired={Array.isArray(lastFired) ? lastFired.includes(realId(t.id)) : lastFired === realId(t.id)}
            ghost={gh.has(t.id)}
            highlight={hl.has(t.id)}
            editing={editing === t.id}
            trail={trail?.get(realId(t.id))}
          />
          ),
        )}
      </g>
      <g>
        {net.places.map((p) => {
          if (viewport && !nearBox(viewport, p.x, p.y, reach(p))) return null;
          let count = 0;
          let amount: number | null = null;
          let text = "";
          const slot = slotOf.get(realId(p.id));
          const continuous = slot !== undefined && cn.places[slot]?.continuous;
          if (marking && slot !== undefined) {
            const m = marking[slot];
            count = m?.size ?? 0;
            if (continuous) amount = count;
            else text = coloured && m ? showTokens(cn, m) : "";
          } else if (coloured) {
            text = p.marking.trim();
          } else {
            const v = Number(p.marking.trim() || 0) || 0;
            if (continuous || !Number.isInteger(v)) amount = v;
            else count = v;
          }
          return (
            <PlaceView
              key={p.id}
              p={p}
              tokensText={text}
              count={count}
              amount={amount}
              palette={palette}
              selected={sel.has(p.id)}
              error={errs.has(p.id)}
              interactive={interactive}
              coloured={coloured}
              ghost={gh.has(p.id)}
              highlight={hl.has(p.id)}
              editing={editing === p.id}
              trail={trail?.get(realId(p.id))}
              stuck={!!stuck?.has(realId(p.id))}
              labelMin={lod(p.id)}
              shortNames={shortNames}
            />
          );
        })}
      </g>
    </g>
  );
});
