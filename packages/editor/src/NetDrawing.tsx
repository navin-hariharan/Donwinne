import React from "react";
import type { Arc, CompiledNet, FTNode, Marking, Net, Note, Place, Point, Transition } from "@pns/core";
import { isColoured, showTokens, timeBase } from "@pns/core";
import { PLACE_R, arcPath, ftEdgePath, ftSize, noteSize, polylineMid, transSize } from "./geometry";

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

function NameLabel({ id, x, y, text, palette, interactive, hidden, anchor = "middle" }: {
  id: string;
  x: number;
  y: number;
  text: string;
  palette: Palette;
  interactive?: boolean;
  hidden?: boolean;
  anchor?: "middle" | "start" | "end";
}) {
  if (hidden || !text) return null;
  return (
    <text x={x} y={y} textAnchor={anchor} data-label={interactive ? id : undefined} style={{ ...labelStyle(palette), cursor: interactive ? "move" : undefined }}>
      {text}
    </text>
  );
}

function PlaceView({ p, tokensText, count, amount, palette, selected, error, interactive, coloured, ghost, highlight, editing }: {
  p: Place;
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
      <NameLabel id={p.id} x={p.x + lo.x} y={p.y + PLACE_R + 15 + lo.y} text={p.name} palette={palette} interactive={interactive && !ghost} hidden={editing} />
      {coloured && tokensText && (
        <text x={p.x + PLACE_R + 4} y={p.y - PLACE_R + 2} style={{ ...labelStyle(palette, 11), fill: palette.selected }}>
          <title>{tokensText}</title>
          {truncate(tokensText, 36)}
        </text>
      )}
      {coloured && p.colourSet && p.colourSet !== "Dot" && (
        <text x={p.x - PLACE_R - 3} y={p.y - PLACE_R + 2} textAnchor="end" style={{ ...labelStyle(palette, 10.5), fill: palette.muted }}>
          {p.colourSet}
        </text>
      )}
      {p.capacity ? (
        <text x={p.x + PLACE_R + 3} y={p.y + PLACE_R + 2} style={{ ...labelStyle(palette, 10.5), fill: palette.muted }}>
          ≤{p.capacity}
        </text>
      ) : null}
    </g>
  );
}

function transitionSubLabel(net: Net, t: Transition): string {
  const parts: string[] = [];
  if (t.guard?.trim()) parts.push(`[${truncate(t.guard.trim(), 30)}]`);
  if (net.netClass === "timed" && t.interval) parts.push(`[${t.interval[0]}, ${t.interval[1]}]`);
  if (timeBase(net.netClass) && t.rate?.trim() && t.kind !== "immediate") parts.push(truncate(t.rate.trim(), 26));
  if (t.kind === "immediate" && t.rate?.trim() && t.rate.trim() !== "1") parts.push(`w=${truncate(t.rate.trim(), 16)}`);
  if (net.netClass === "music" && t.sound?.note) parts.push(`♪ ${t.sound.note}`);
  return parts.join("  ");
}

function TransitionView({ net, t, palette, selected, enabled, error, interactive, fired, ghost, highlight, editing }: {
  net: Net;
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
  const sub = transitionSubLabel(net, t);
  return (
    <g
      data-id={interactive ? t.id : undefined}
      data-kind="transition"
      style={{ cursor: interactive ? "pointer" : undefined, opacity: ghost ? 0.55 : undefined }}
    >
      {interactive && <rect x={t.x - w / 2} y={t.y - h / 2} width={w} height={h} className="hit-pad" />}
      {highlight && <rect x={t.x - w / 2 - 8} y={t.y - h / 2 - 8} width={w + 16} height={h + 16} rx={4} style={{ fill: palette.highlight, fillOpacity: 0.25, stroke: palette.highlight, strokeWidth: 2 }} />}
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
      <NameLabel id={t.id} x={t.x + lo.x} y={t.y - h / 2 - 7 + lo.y} text={t.name} palette={palette} interactive={interactive && !ghost} hidden={editing} />
      {sub && (
        <text x={t.x} y={t.y + h / 2 + 14} textAnchor="middle" style={{ ...labelStyle(palette, 10.5), fill: palette.muted }}>
          {sub}
        </text>
      )}
    </g>
  );
}

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

function ArcView({ net, a, palette, selected, error, interactive, coloured, highlight, freestyle, blocks }: {
  net: Net;
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
  const pts = arcPath(net, a);
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
  const showLabel = label && a.kind !== "modifier" && !(!coloured && label === "1");
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
}

function NoteView({ n, palette, selected, interactive, editing, highlight }: { n: Note; palette: Palette; selected: boolean; interactive?: boolean; editing: boolean; highlight: boolean }) {
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
}

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

function FTNodeView({ n, inputs, palette, selected, interactive, editing, failed, highlight }: {
  n: FTNode;
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
          <text x={n.x} y={n.y + 4} textAnchor="middle" style={{ fill: palette.ink, fontSize: 12, fontWeight: 600, fontFamily: palette.font }}>
            {truncate(n.name, 14)}
          </text>
        ) : (
          <text x={n.x} y={labelY} textAnchor="middle" style={labelStyle(palette, 11.5)}>
            {n.name}
          </text>
        ))}
      {n.type === "basic" && (n.probability || n.failureRate) && (
        <text x={n.x} y={n.y + h / 2 + 28} textAnchor="middle" style={{ ...labelStyle(palette, 10), fill: palette.muted }}>
          {n.probability ? `p=${n.probability}` : `λ=${n.failureRate}`}
        </text>
      )}
    </g>
  );
}

export function FaultTreeDrawing({ net, palette, selection, interactive, editing, failed, highlight }: {
  net: Net;
  palette: Palette;
  selection?: Set<string>;
  interactive?: boolean;
  editing?: string | null;
  failed?: Set<string>;
  highlight?: Set<string>;
}) {
  const ft = net.faultTree;
  if (!ft) return null;
  const visible = new Set(ft.nodes.map((n) => n.id));
  const inputs = new Map<string, number>();
  for (const e of ft.edges) inputs.set(e.target, (inputs.get(e.target) ?? 0) + 1);
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
      {ft.nodes.map((n) => (
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
        />
      ))}
    </g>
  );
}

// ---------- whole net ----------

export function NetDrawing({ net, cn, palette, marking, selection, enabled, errorIds, interactive, lastFired, blocking, highlight, ghosts, editing, failed }: Props) {
  const sel = selection ?? new Set<string>();
  const errs = errorIds ?? new Set<string>();
  const hl = highlight ?? new Set<string>();
  const gh = ghosts ?? new Set<string>();
  const slotOf = new Map(cn.places.map((p) => [p.id, p.slot]));
  const coloured = isColoured(net.netClass);
  const freestyle = net.netClass === "freestyle";
  const realId = (id: string) => (id.startsWith("ghost:") ? id.slice(6) : id);
  return (
    <g>
      <g>
        {(net.notes ?? []).map((n) => (
          <NoteView key={n.id} n={n} palette={palette} selected={sel.has(n.id)} interactive={interactive} editing={editing === n.id} highlight={hl.has(n.id)} />
        ))}
      </g>
      <FaultTreeDrawing net={net} palette={palette} selection={sel} interactive={interactive} editing={editing} failed={failed} highlight={hl} />
      <g>
        {net.arcs.map((a) => (
          <ArcView
            key={a.id}
            net={net}
            a={a}
            palette={palette}
            selected={sel.has(a.id)}
            error={errs.has(a.id)}
            interactive={interactive}
            coloured={coloured}
            highlight={hl.has(a.id)}
            freestyle={freestyle}
            blocks={blocking?.get(a.id)}
          />
        ))}
      </g>
      <g>
        {net.transitions.map((t) => (
          <TransitionView
            key={t.id}
            net={net}
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
          />
        ))}
      </g>
      <g>
        {net.places.map((p) => {
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
            />
          );
        })}
      </g>
    </g>
  );
}
