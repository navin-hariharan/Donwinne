import React from "react";
import { isFaultTree } from "@pns/core";
import { Icon } from "./Toolbar";
import { NODE_COLORS } from "./ContextMenu";
import { AlignMode, alignSelection, deleteSelection, duplicateSelection, enterPage, groupIntoSubnet, pagePath, setColor, useStore } from "./store";

/** Path from the top-level net down to the open subnet. */
export function Breadcrumbs() {
  const net = useStore((s) => s.net);
  const page = useStore((s) => s.page);
  if (!page) return null;
  const path = pagePath(net, page);
  return (
    <nav className="breadcrumbs" aria-label="Subnet path">
      <button onClick={() => enterPage(null)}>{net.name || "Top level"}</button>
      {path.map((n, i) => (
        <React.Fragment key={n.id}>
          <span className="crumb-sep">›</span>
          <button disabled={i === path.length - 1} onClick={() => enterPage(n.id)}>
            {n.name}
          </button>
        </React.Fragment>
      ))}
    </nav>
  );
}

const ALIGN: { mode: AlignMode; label: string; icon: string }[] = [
  { mode: "left", label: "Align left", icon: "alignLeft" },
  { mode: "centerX", label: "Align centres vertically", icon: "alignCenterX" },
  { mode: "right", label: "Align right", icon: "alignRight" },
  { mode: "top", label: "Align top", icon: "alignTop" },
  { mode: "centerY", label: "Align middles horizontally", icon: "alignCenterY" },
  { mode: "bottom", label: "Align bottom", icon: "alignBottom" },
  { mode: "distributeX", label: "Space evenly left to right", icon: "distributeX" },
  { mode: "distributeY", label: "Space evenly top to bottom", icon: "distributeY" },
];

/** Floating bar shown when several nodes are selected. */
export function SelectionBar() {
  const net = useStore((s) => s.net);
  const selection = useStore((s) => s.selection);
  const mode = useStore((s) => s.mode);
  if (mode !== "edit") return null;
  const ids = new Set(selection);
  const nodes = [...net.places, ...net.transitions, ...(net.notes ?? []), ...(net.faultTree?.nodes ?? [])].filter((n) => ids.has(n.id));
  if (nodes.length < 2) return null;
  return (
    <div className="selection-bar" role="toolbar" aria-label="Selection">
      <span className="sel-count">{nodes.length} selected</span>
      {ALIGN.map((a) => (
        <button key={a.mode} className="icon-btn" title={a.label} aria-label={a.label} onClick={() => alignSelection(a.mode)} disabled={a.mode.startsWith("distribute") && nodes.length < 3}>
          <Icon name={a.icon} />
        </button>
      ))}
      <span className="bar-sep" />
      <div className="mini-swatches">
        {NODE_COLORS.slice(0, 7).map((c) => (
          <button key={c.name} className="swatch small" title={c.name} aria-label={`Colour ${c.name}`} style={{ background: c.value ?? "var(--node-fill)" }} onClick={() => setColor(selection, c.value)} />
        ))}
      </div>
      <span className="bar-sep" />
      {!isFaultTree(net.netClass) && (
        <button className="text-btn" title="Put the selection into a subnet (Ctrl+G)" onClick={() => groupIntoSubnet("transition")}>
          Group
        </button>
      )}
      <button className="icon-btn" title="Duplicate (Ctrl+D)" aria-label="Duplicate" onClick={duplicateSelection}>
        <Icon name="copy" />
      </button>
      <button className="icon-btn danger" title="Delete (Del)" aria-label="Delete" onClick={deleteSelection}>
        <Icon name="trash" />
      </button>
    </div>
  );
}

/**
 * A draggable divider between two panels. `axis="y"` resizes the panel below it (dragging up makes it taller);
 * `axis="x"` resizes the panel to its right (dragging left makes it wider). Double-click restores the default.
 */
export function Splitter({ axis, value, min, max, onChange, label }: { axis: "x" | "y"; value: number; min: number; max: () => number; onChange: (v: number | undefined) => void; label: string }) {
  const start = React.useRef<{ pos: number; value: number } | null>(null);
  return (
    <div
      className={`splitter splitter-${axis}`}
      role="separator"
      aria-orientation={axis === "y" ? "horizontal" : "vertical"}
      aria-label={label}
      title={`Drag to resize; double-click to reset`}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { pos: axis === "y" ? e.clientY : e.clientX, value };
        document.body.classList.add(`resizing-${axis}`);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const d = (axis === "y" ? e.clientY : e.clientX) - start.current.pos;
        onChange(Math.round(Math.max(min, Math.min(max(), start.current.value - d))));
      }}
      onPointerUp={() => {
        start.current = null;
        document.body.classList.remove(`resizing-${axis}`);
      }}
      onDoubleClick={() => onChange(undefined)}
    />
  );
}
