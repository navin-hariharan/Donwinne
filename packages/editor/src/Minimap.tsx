import React, { useEffect, useRef, useState } from "react";
import { CSS_PALETTE, NetDrawing } from "./NetDrawing";
import { netBounds, pageView } from "./geometry";
import { compiled, useStore } from "./store";

const W = 160;
const H = 104;

/** Overview of the current page with the visible area; click or drag to move around. */
export function Minimap() {
  const net = useStore((s) => s.net);
  const page = useStore((s) => s.page);
  const view = useStore((s) => s.view);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const dragging = useRef(false);

  useEffect(() => {
    const el = document.querySelector<SVGSVGElement>("svg.canvas");
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pv = pageView(net, page);
  const vnet = pv.net;
  // A small canvas has no room for an overview on top of it.
  if (size.h < 300 || size.w < 500) return null;
  if (vnet.places.length + vnet.transitions.length + (vnet.faultTree?.nodes.length ?? 0) < 3) return null;
  const b = netBounds(vnet, 30);
  const tight = netBounds(vnet, 0);
  // The visible world rectangle.
  const vis = { x: -view.x / view.zoom, y: -view.y / view.zoom, w: size.w / view.zoom, h: size.h / view.zoom };
  // Nothing to navigate when everything is already in view.
  if (tight.x >= vis.x && tight.y >= vis.y && tight.x + tight.w <= vis.x + vis.w && tight.y + tight.h <= vis.y + vis.h) return null;
  const x0 = Math.min(b.x, vis.x);
  const y0 = Math.min(b.y, vis.y);
  const x1 = Math.max(b.x + b.w, vis.x + vis.w);
  const y1 = Math.max(b.y + b.h, vis.y + vis.h);
  const k = Math.min(W / (x1 - x0), H / (y1 - y0));
  const ox = (W - (x1 - x0) * k) / 2;
  const oy = (H - (y1 - y0) * k) / 2;

  const moveTo = (e: React.PointerEvent) => {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const wx = (e.clientX - r.left - ox) / k + x0;
    const wy = (e.clientY - r.top - oy) / k + y0;
    useStore.setState({ view: { ...view, x: size.w / 2 - wx * view.zoom, y: size.h / 2 - wy * view.zoom } });
  };

  return (
    <div className="minimap" aria-label="Overview">
      <button className="minimap-close" title="Hide the overview (M)" aria-label="Hide the overview" onClick={() => useStore.setState({ showMinimap: false })}>
        ×
      </button>
      <svg
        width={W}
        height={H}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
          moveTo(e);
        }}
        onPointerMove={(e) => dragging.current && moveTo(e)}
        onPointerUp={() => (dragging.current = false)}
      >
        <g transform={`translate(${ox},${oy}) scale(${k}) translate(${-x0},${-y0})`} style={{ pointerEvents: "none" }}>
          <NetDrawing net={vnet} cn={compiled(net)} palette={CSS_PALETTE} ghosts={pv.ghosts} />
          <rect x={vis.x} y={vis.y} width={vis.w} height={vis.h} style={{ fill: "var(--accent)", fillOpacity: 0.08, stroke: "var(--accent)", strokeWidth: 2 / k }} />
        </g>
      </svg>
    </div>
  );
}
