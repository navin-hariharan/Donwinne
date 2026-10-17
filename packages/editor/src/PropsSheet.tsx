import React, { useEffect, useRef, useState } from "react";
import { PropertiesPanel } from "./PropertiesPanel";
import { Icon } from "./Toolbar";
import { useStore } from "./store";

const close = () => useStore.setState({ propsOpen: false });

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable;
}

/** What the properties panel would show, in a few words. */
function selectionLabel(): string {
  const s = useStore.getState();
  if (s.selection.length > 1) return `${s.selection.length} selected`;
  const id = s.selection[0];
  const n = s.net;
  const p = n.places.find((x) => x.id === id);
  if (p) return `Place ${p.name}`;
  const t = n.transitions.find((x) => x.id === id);
  if (t) return `Transition ${t.name}`;
  if (n.arcs.some((x) => x.id === id)) return "Arc";
  if (n.notes?.some((x) => x.id === id)) return "Note";
  const f = n.faultTree?.nodes.find((x) => x.id === id);
  if (f) return f.name || "Event";
  if (n.faultTree?.edges.some((x) => x.id === id)) return "Connection";
  return "Selection";
}

/** A small button over the canvas, shown while something is selected, that opens the properties sheet or drawer. */
export function PropsPeek({ sheet }: { sheet: boolean }) {
  const open = useStore((s) => s.propsOpen);
  const selection = useStore((s) => s.selection);
  const mode = useStore((s) => s.mode);
  useStore((s) => s.net);
  if (open || !selection.length || mode !== "edit") return null;
  return (
    <button className={`props-peek ${sheet ? "sheet" : "side"}`} onClick={() => useStore.setState({ propsOpen: true })} data-testid="props-peek">
      <span className="props-peek-label">{selectionLabel()}</span>
      <span className="muted">Properties</span>
      <Icon name="chevron" />
    </button>
  );
}

/**
 * The properties panel on screens without room to dock it: a sheet that slides up from the bottom
 * (phones) or a drawer from the right (tablets, landscape phones). It opens from the selection's
 * Properties button, the Properties button in the top bar, or the context menu.
 */
export function PropsSheet({ sheet }: { sheet: boolean }) {
  const open = useStore((s) => s.propsOpen);
  const drag = useRef<{ y0: number; dy: number } | null>(null);
  const [dy, setDy] = useState(0);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTyping(e) && !useStore.getState().dialog) {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [open]);

  if (!open) return null;
  // Swipe the sheet down by its header to close it.
  const handle = sheet
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { y0: e.clientY, dy: 0 };
        },
        onPointerMove: (e: React.PointerEvent) => {
          if (!drag.current) return;
          drag.current.dy = Math.max(0, e.clientY - drag.current.y0);
          setDy(drag.current.dy);
        },
        onPointerUp: () => {
          const d = drag.current;
          drag.current = null;
          setDy(0);
          if (d && d.dy > 80) close();
        },
        onPointerCancel: () => {
          drag.current = null;
          setDy(0);
        },
      }
    : {};
  return (
    <div className={`props-host ${sheet ? "sheet" : "side"}`} style={dy ? { transform: `translateY(${dy}px)` } : undefined} role="dialog" aria-label="Properties" data-testid="props-sheet">
      <div className="props-host-head" {...handle}>
        {sheet && <span className="grab" aria-hidden />}
        <span className="props-host-title">Properties</span>
        <button className="icon" aria-label="Close properties" title="Close (Esc)" onClick={close} onPointerDown={(e) => e.stopPropagation()}>
          <Icon name="close" />
        </button>
      </div>
      <PropertiesPanel />
    </div>
  );
}
