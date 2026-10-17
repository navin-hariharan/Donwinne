import React, { useEffect, useLayoutEffect, useRef } from "react";
import { ARC_KINDS, arcKindsFor, FTNodeType, isColoured, isFaultTree, isPlace } from "@pns/core";
import {
  addFTNode,
  addNote,
  addPlace,
  addTransition,
  adjustTokens,
  alignSelection,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  enterPage,
  groupIntoSubnet,
  paste,
  reverseArc,
  selectAll,
  setColor,
  ungroupSubnet,
  updateArc,
  updatePlace,
  updateTransition,
  useStore,
} from "./store";
import { autoLayout } from "./layout";
import { propsDocked, useScreenClass } from "./responsive";

export const NODE_COLORS = [
  { name: "Default", value: undefined },
  { name: "Red", value: "#fecaca" },
  { name: "Orange", value: "#fed7aa" },
  { name: "Yellow", value: "#fef08a" },
  { name: "Green", value: "#bbf7d0" },
  { name: "Teal", value: "#99f6e4" },
  { name: "Blue", value: "#bfdbfe" },
  { name: "Purple", value: "#ddd6fe" },
  { name: "Pink", value: "#fbcfe8" },
  { name: "Grey", value: "#d1d5db" },
];

type Item = { label: string; shortcut?: string; action: () => void; disabled?: boolean; danger?: boolean } | "sep" | { colors: string[] };

export function ContextMenu() {
  const cm = useStore((s) => s.contextMenu);
  const net = useStore((s) => s.net);
  const selection = useStore((s) => s.selection);
  const mode = useStore((s) => s.mode);
  const screen = useScreenClass();
  const ref = useRef<HTMLDivElement>(null);
  // Lifting the finger after a long press sends a click to whatever is under it, which may be one of
  // the menu's own items. Clicks are ignored until the menu has been touched or a moment has passed.
  const opened = useRef({ at: 0, touched: false });
  useEffect(() => {
    opened.current = { at: performance.now(), touched: false };
  }, [cm]);

  // Keep the menu inside the canvas: open it up or to the left of the pointer near an edge, and scroll it when taller than the canvas.
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.offsetParent as HTMLElement | null;
    if (!cm || !el || !box) return;
    const W = box.clientWidth;
    const H = box.clientHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = cm.x + w > W - 4 ? Math.max(4, Math.min(cm.x - w, W - w - 4)) : cm.x;
    const top = cm.y + h > H - 4 ? Math.max(4, Math.min(cm.y - h, H - h - 4)) : cm.y;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [cm, selection]);

  useEffect(() => {
    if (!cm) return;
    const close = (e: Event) => {
      if (!(e.target as Element).closest?.(".context-menu")) useStore.setState({ contextMenu: null });
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && useStore.setState({ contextMenu: null });
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", esc);
    };
  }, [cm]);

  if (!cm || mode !== "edit") return null;
  const id = cm.targetId;
  const p = id ? net.places.find((x) => x.id === id) : undefined;
  const t = id ? net.transitions.find((x) => x.id === id) : undefined;
  const a = id ? net.arcs.find((x) => x.id === id) : undefined;
  const n = id ? net.notes?.find((x) => x.id === id) : undefined;
  const f = id ? net.faultTree?.nodes.find((x) => x.id === id) : undefined;
  const w = cm.world;
  const run = (fn: () => void) => () => {
    if (!opened.current.touched && performance.now() - opened.current.at < 500) return;
    useStore.setState({ contextMenu: null });
    fn();
  };
  const edit = (field: "name" | "marking" | "inscription" | "note") => run(() => useStore.setState({ inlineEdit: { id: id!, field } }));
  const multi = selection.length > 1;
  const items: Item[] = [];
  const ft = isFaultTree(net.netClass);

  if (!propsDocked(screen)) {
    items.push({ label: id ? "Properties…" : "Net properties…", action: run(() => useStore.setState({ propsOpen: true })) }, "sep");
  }
  if (!id) {
    if (ft) {
      const gate = (type: FTNodeType, label: string) => ({ label, action: run(() => addFTNode(type, w.x, w.y)) });
      items.push(gate("basic", "Add basic event"), gate("intermediate", "Add intermediate event"), gate("and", "Add AND gate"), gate("or", "Add OR gate"));
    } else {
      items.push(
        { label: "Add place here", shortcut: "P", action: run(() => addPlace(w.x, w.y)) },
        { label: "Add transition here", shortcut: "T", action: run(() => addTransition(w.x, w.y)) },
      );
    }
    items.push({ label: "Add note here", action: run(() => addNote(w.x, w.y)) }, "sep");
    items.push({ label: "Paste", shortcut: "Ctrl+V", action: run(() => paste()) }, { label: "Select all", shortcut: "Ctrl+A", action: run(selectAll) });
    items.push("sep", { label: "Auto layout", shortcut: "Ctrl+L", action: run(() => void autoLayout()) });
    if (useStore.getState().page) items.push({ label: "Back to parent net", shortcut: "Backspace", action: run(() => enterPage(parentPage())) });
  } else {
    if (multi) items.push({ label: `${selection.length} items selected`, action: () => undefined, disabled: true });
    if (!multi && (p || t || f)) items.push({ label: "Rename", shortcut: "F2", action: edit("name") });
    if (!multi && p && !p.coarse && net.netClass !== "freestyle") {
      items.push({ label: "Edit marking", action: edit("marking") });
      if (!isColoured(net.netClass)) {
        items.push({ label: "Add a token", shortcut: "+", action: run(() => adjustTokens(p.id, 1)) });
        items.push({ label: "Remove a token", shortcut: "−", action: run(() => adjustTokens(p.id, -1)), disabled: !Number(p.marking || 0) });
      }
      items.push({ label: p.logical ? "Make ordinary (not logical)" : "Make logical (fusion) place", action: run(() => updatePlace(p.id, { logical: !p.logical })) });
    }
    if (!multi && t && !t.coarse) items.push({ label: t.horizontal ? "Make vertical" : "Make horizontal", action: run(() => updateTransition(t.id, { horizontal: !t.horizontal })) });
    if (!multi && (p || t)?.coarse) {
      items.push({ label: "Open subnet", action: run(() => enterPage(id)) });
      items.push({ label: "Ungroup subnet", action: run(() => ungroupSubnet(id)) });
    }
    if (a && !multi) {
      if (net.netClass !== "freestyle") items.push({ label: "Edit inscription", action: edit("inscription") });
      items.push({ label: "Reverse direction", action: run(() => reverseArc(a.id)), disabled: a.kind !== "normal" });
      if (a.points?.length) items.push({ label: "Straighten (remove bends)", action: run(() => updateArc(a.id, { points: undefined })) });
      if (isPlace(net, a.source) && net.netClass !== "freestyle") {
        items.push("sep");
        for (const k of net.netClass === "pt" ? ARC_KINDS.filter((x) => x !== "modifier") : arcKindsFor(net.netClass))
          items.push({ label: `${a.kind === k ? "✓ " : "   "}${k[0].toUpperCase()}${k.slice(1)} arc`, action: run(() => updateArc(a.id, { kind: k })) });
      }
    }
    if (n && !multi) items.push({ label: "Edit text", action: edit("note") });
    items.push("sep");
    items.push({ colors: NODE_COLORS.map((c) => c.value ?? "") });
    items.push("sep");
    if (multi) {
      items.push({ label: "Align left", action: run(() => alignSelection("left")) }, { label: "Align tops", action: run(() => alignSelection("top")) });
      items.push({ label: "Distribute horizontally", action: run(() => alignSelection("distributeX")) });
      if (!ft) items.push({ label: "Group into subnet", shortcut: "Ctrl+G", action: run(() => groupIntoSubnet("transition")) });
      items.push("sep");
    }
    items.push(
      { label: "Cut", shortcut: "Ctrl+X", action: run(cutSelection) },
      { label: "Copy", shortcut: "Ctrl+C", action: run(() => void copySelection()) },
      { label: "Duplicate", shortcut: "Ctrl+D", action: run(duplicateSelection) },
      { label: "Delete", shortcut: "Del", action: run(deleteSelection), danger: true },
    );
  }

  return (
    <div className="context-menu" role="menu" ref={ref} style={{ left: cm.x, top: cm.y }} onPointerDown={() => (opened.current.touched = true)} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it === "sep" ? (
          <div key={i} className="menu-sep" />
        ) : "colors" in it ? (
          <div key={i} className="menu-colors" aria-label="Colour">
            {NODE_COLORS.map((c) => (
              <button
                key={c.name}
                title={c.name}
                aria-label={c.name}
                className="swatch"
                style={{ background: c.value ?? "var(--node-fill)" }}
                onClick={run(() => setColor(selection.length ? selection : [id!], c.value))}
              />
            ))}
          </div>
        ) : (
          <button key={i} role="menuitem" disabled={it.disabled} className={it.danger ? "danger" : undefined} onClick={it.action}>
            <span>{it.label}</span>
            {it.shortcut && <kbd>{it.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}

function parentPage(): string | null {
  const s = useStore.getState();
  const cur = s.net.places.find((p) => p.id === s.page) ?? s.net.transitions.find((t) => t.id === s.page);
  return cur?.parent ?? null;
}

export { parentPage };
