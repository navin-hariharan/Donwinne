import React, { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { FTNodeType, Point, enabledBindings, initialMarking, isFaultTree, isPlace } from "@pns/core";
import { CSS_PALETTE, NetDrawing } from "./NetDrawing";
import { GRID, PLACE_R, arcPath, boundaryPoint, distToSegment, ftSize, netBounds, pageView, shapeOf, snap, transSize } from "./geometry";
import {
  Tool,
  addArc,
  addConnectedNode,
  addFTEdge,
  addFTNode,
  addNote,
  addPlace,
  addTransition,
  compiled,
  problemsOf,
  currentMarking,
  edit,
  endCoalesce,
  enterPage,
  fireTransition,
  moveSelection,
  reconnectArc,
  select,
  snapSelection,
  timedEnabled,
  toast,
  updateArc,
  updatePlace,
  updateTransition,
  useStore,
} from "./store";
import { InlineEditor } from "./InlineEditor";
import { ContextMenu } from "./ContextMenu";
import { Minimap } from "./Minimap";
import { Breadcrumbs, SelectionBar } from "./Overlays";
import { SimControls } from "./Toolbar";
import { propsDocked, useCoarsePointer, useScreenClass } from "./responsive";
import { PropsPeek } from "./PropsSheet";
import { blockingInhibitors, enabledAt, isAmbientNet, useAmbient } from "./ambient";
import { StepPicker, StepTray, ambientTransitionClick } from "./AmbientSim";

type Drag =
  | { kind: "move"; ids: string[]; last: Point; key: string; moved: boolean; startScreen: Point; slop: number }
  | {
      kind: "pan";
      startScreen: Point;
      startView: { x: number; y: number };
      moved: boolean;
      context: boolean;
      world: Point;
      targetId: string | null;
      /** Touch only: a tap here adds this tool's node; a drag pans instead. */
      placeTool?: Tool;
      /** Touch only: a long press opened the context menu; dragging on now selects an area. */
      long?: boolean;
      touch?: boolean;
    }
  | { kind: "band"; start: Point; current: Point; additive: boolean }
  | { kind: "bend"; arcId: string; index: number; key: string }
  | { kind: "connect"; source: string; start: Point }
  | { kind: "arcend"; arcId: string; end: "source" | "target" }
  | { kind: "label"; id: string; start: Point; orig: Point; key: string }
  | null;

/** MIME type used when dragging a tool from the palette onto the canvas. */
export const TOOL_MIME = "application/x-pns-tool";

export function placeTool(tool: Tool, p: Point): string | null {
  if (tool === "place") return addPlace(p.x, p.y);
  if (tool === "transition") return addTransition(p.x, p.y);
  if (tool === "note") return addNote(p.x, p.y);
  if (tool.startsWith("ft:")) return addFTNode(tool.slice(3) as FTNodeType, p.x, p.y);
  return null;
}

export function Canvas() {
  const net = useStore((s) => s.net);
  const page = useStore((s) => s.page);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const view = useStore((s) => s.view);
  const mode = useStore((s) => s.mode);
  const sim = useStore((s) => s.sim);
  const simIndex = useStore((s) => s.simIndex);
  const fitRequest = useStore((s) => s.fitRequest);
  const snapOn = useStore((s) => s.snapToGrid);
  const inlineEdit = useStore((s) => s.inlineEdit);
  const highlight = useStore((s) => s.highlight);
  const ftFailed = useStore((s) => s.ftFailed);
  const showMinimap = useStore((s) => s.showMinimap);

  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag>(null);
  const [band, setBand] = useState<{ a: Point; b: Point } | null>(null);
  const [arcDraft, setArcDraft] = useState<{ source: string; points: Point[]; cursor: Point } | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const spaceDown = useRef(false);
  const coarse = useCoarsePointer();
  const screen = useScreenClass();
  // Touch gestures: fingers on the canvas, the pinch in progress, the pending long press and the last tap.
  const touches = useRef(new Map<number, Point>());
  const pinch = useRef<{ d0: number; anchor: Point; zoom0: number } | null>(null);
  /** Set from a second finger landing until every finger is lifted: nothing but the pinch runs meanwhile. */
  const gestureLock = useRef(false);
  const longPress = useRef<{ timer: ReturnType<typeof setTimeout>; start: Point; pointerId: number } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const lastPointerType = useRef("mouse");
  const longPressFired = useRef(false);
  /** The selection before the first finger came down, restored if that finger turns out to start a pinch. */
  const selBeforeTouch = useRef<string[] | null>(null);

  useEffect(() => setHover(null), [net, page]);
  const pv = pageView(net, page);
  const vnet = pv.net;
  const cn = compiled(net);
  const editMarking = useMemo(() => initialMarking(cn), [cn]);
  const marking = mode === "simulate" ? sim[simIndex]?.marking ?? null : editMarking;
  const ambient = isAmbientNet(net);
  const pending = useAmbient((s) => s.pending);
  const enabled = useMemo(() => {
    if (mode !== "simulate" || !marking) return new Set<string>();
    if (ambient) return new Set(enabledAt(net, marking).map((st) => st.transition));
    const ts = sim[simIndex]?.timed;
    if (ts) return new Set(timedEnabled(ts).fireable.map((t) => t.id));
    return new Set(cn.transitions.filter((t) => enabledBindings(cn, t.index, marking).bindings.length > 0).map((t) => t.id));
  }, [mode, marking, cn, sim, simIndex, ambient, net]);
  // Step token game: colour-sensitive inhibitor arcs that block a colour mode right now.
  const blocking = useMemo(() => (ambient && mode === "simulate" && marking ? blockingInhibitors(net, marking) : undefined), [ambient, mode, marking, net]);
  const errorIds = useMemo(() => new Set(problemsOf(net).filter((p) => p.severity === "error" && p.elementId).map((p) => p.elementId!)), [cn]);
  // In the step token game the transitions of the step being collected are drawn as selected.
  const selSet = useMemo(() => new Set(mode === "simulate" && ambient ? [...selection, ...pending.map((st) => st.transition)] : selection), [selection, mode, ambient, pending]);
  const hlSet = useMemo(() => new Set(highlight), [highlight]);
  const failedSet = useMemo(() => new Set(ftFailed), [ftFailed]);
  const lastFired = mode === "simulate" ? sim[simIndex]?.transitionIds ?? sim[simIndex]?.transitionId : undefined;
  const ft = isFaultTree(net.netClass);

  useEffect(() => {
    if (!fitRequest) return;
    // Wait a frame so the canvas has its final size after a layout change.
    requestAnimationFrame(fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequest]);

  function fit() {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const s = useStore.getState();
    const b = netBounds(pageView(s.net, s.page).net);
    const zoom = Math.min(1.6, Math.max(0.1, Math.min(r.width / b.w, r.height / b.h)));
    useStore.setState({ view: { zoom, x: (r.width - b.w * zoom) / 2 - b.x * zoom, y: (r.height - b.h * zoom) / 2 - b.y * zoom } });
  }

  // When a panel opens or grows and squeezes the canvas, keep a drawing that was fully in view
  // in view (re-fit), instead of leaving part of it hidden under the panel.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    let prev = el.getBoundingClientRect();
    const allVisible = (w: number, h: number) => {
      const s = useStore.getState();
      const b = netBounds(pageView(s.net, s.page).net, 0);
      const v = s.view;
      if (!b.w && !b.h) return true;
      const x0 = b.x * v.zoom + v.x;
      const y0 = b.y * v.zoom + v.y;
      return x0 >= -1 && y0 >= -1 && x0 + b.w * v.zoom <= w + 1 && y0 + b.h * v.zoom <= h + 1;
    };
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const shrank = r.height < prev.height - 4 || r.width < prev.width - 4;
      if (shrank && r.width > 0 && r.height > 0 && allVisible(prev.width, prev.height) && !allVisible(r.width, r.height)) fit();
      prev = r;
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) spaceDown.current = true;
      if (e.key === "Escape") setArcDraft(null);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    if (tool !== "arc") setArcDraft(null);
  }, [tool]);

  // Wheel: pan, or zoom with Ctrl/Cmd (and trackpad pinch, which sets ctrlKey).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = useStore.getState().view;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const sx = e.clientX - r.left;
        const sy = e.clientY - r.top;
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002));
        const zoom = Math.min(4, Math.max(0.1, v.zoom * factor));
        const k = zoom / v.zoom;
        useStore.setState({ view: { zoom, x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k } });
      } else {
        const mul = e.deltaMode === 1 ? 20 : 1;
        useStore.setState({ view: { ...v, x: v.x - (e.shiftKey ? e.deltaY : e.deltaX) * mul, y: v.y - (e.shiftKey ? 0 : e.deltaY) * mul } });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function toWorld(e: { clientX: number; clientY: number }): Point {
    const r = svgRef.current!.getBoundingClientRect();
    const v = useStore.getState().view;
    return { x: (e.clientX - r.left - v.x) / v.zoom, y: (e.clientY - r.top - v.y) / v.zoom };
  }

  interface Hit {
    id: string;
    kind: string;
    bend?: number;
    handle?: boolean;
    arcEnd?: "source" | "target";
    segment?: number;
    label?: string;
  }

  function hitEl(target: Element | null): Hit | null {
    if (!target) return null;
    const handle = target.closest("[data-handle]");
    if (handle) return { id: handle.getAttribute("data-handle")!, kind: "handle", handle: true };
    const arcEnd = target.closest("[data-arcend]");
    if (arcEnd) return { id: arcEnd.getAttribute("data-arcid")!, kind: "arcend", arcEnd: arcEnd.getAttribute("data-arcend") as "source" | "target" };
    const seg = target.closest("[data-segment]");
    if (seg) return { id: seg.getAttribute("data-arcid")!, kind: "segment", segment: Number(seg.getAttribute("data-segment")) };
    const label = target.closest("[data-label]");
    if (label) return { id: label.getAttribute("data-label")!, kind: "label", label: label.getAttribute("data-label")! };
    const bend = target.closest("[data-bend]");
    const g = target.closest("[data-id]");
    if (!g) return null;
    return { id: g.getAttribute("data-id")!, kind: g.getAttribute("data-kind")!, bend: bend ? Number(bend.getAttribute("data-bend")) : undefined };
  }
  const hit = (e: { target: EventTarget }) => hitEl(e.target as Element);
  /** Hit test by position: needed after pointer capture, when events target the canvas itself. */
  const hitAt = (e: { clientX: number; clientY: number }) => hitEl(document.elementFromPoint(e.clientX, e.clientY));

  /** The node under a screen point, ignoring the drag preview. */
  function nodeAt(e: { clientX: number; clientY: number }): string | null {
    const els = document.elementsFromPoint(e.clientX, e.clientY);
    for (const el of els) {
      const g = el.closest?.("[data-id]");
      const k = g?.getAttribute("data-kind");
      if (g && (k === "place" || k === "transition" || k === "ft")) return g.getAttribute("data-id");
    }
    return null;
  }

  const isNodeKind = (k: string) => k === "place" || k === "transition" || k === "ft";
  const isGhost = (id: string) => id.startsWith("ghost:");

  function cancelLongPress() {
    if (longPress.current) clearTimeout(longPress.current.timer);
    longPress.current = null;
  }

  function screenPoint(q: Point): Point {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: q.x - r.left, y: q.y - r.top };
  }

  /** A second finger turns whatever the first one started into a pinch: zoom and pan together. */
  function startPinch() {
    cancelLongPress();
    const d = drag.current;
    if (d?.kind === "move" && d.moved) {
      snapSelection(d.ids);
      endCoalesce();
    } else if (d?.kind === "bend" || d?.kind === "label") endCoalesce();
    if (!(d?.kind === "move" && d.moved) && selBeforeTouch.current) select(selBeforeTouch.current);
    selBeforeTouch.current = null;
    drag.current = null;
    setBand(null);
    setDropTarget(null);
    if (d?.kind === "connect") setArcDraft(null);
    gestureLock.current = true;
    const [a, b] = [...touches.current.values()];
    const mid = screenPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const v = useStore.getState().view;
    pinch.current = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), anchor: { x: (mid.x - v.x) / v.zoom, y: (mid.y - v.y) / v.zoom }, zoom0: v.zoom };
  }

  function movePinch() {
    const pc = pinch.current;
    if (!pc || touches.current.size < 2) return;
    const [a, b] = [...touches.current.values()];
    const mid = screenPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const zoom = Math.min(4, Math.max(0.1, (pc.zoom0 * Math.hypot(a.x - b.x, a.y - b.y)) / pc.d0));
    useStore.setState({ view: { zoom, x: mid.x - pc.anchor.x * zoom, y: mid.y - pc.anchor.y * zoom } });
  }

  /** Long press with a finger: the context menu, as a right-click would open it. */
  function onLongPress(e: { clientX: number; clientY: number }, h: Hit | null) {
    longPress.current = null;
    if (useStore.getState().mode !== "edit") return;
    const d = drag.current;
    if (d?.kind === "move" && d.moved) return;
    if (d?.kind === "pan" && d.moved) return;
    longPressFired.current = true;
    const r = svgRef.current!.getBoundingClientRect();
    const targetId = h && !isGhost(h.id) && !h.handle ? h.id : null;
    if (targetId && !useStore.getState().selection.includes(targetId)) select([targetId]);
    useStore.setState({ contextMenu: { x: e.clientX - r.left, y: e.clientY - r.top, world: toWorld(e), targetId } });
    lastTap.current = null;
    // On empty canvas, keep the press alive: dragging on selects an area. On a node, the press is over.
    if (d?.kind === "pan") d.long = true;
    else {
      drag.current = null;
      setBand(null);
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    const el = svgRef.current!;
    lastPointerType.current = e.pointerType;
    const touch = e.pointerType === "touch";
    if (mode === "simulate" && useAmbient.getState().picker) useAmbient.setState({ picker: null });
    if (touch) {
      // A primary pointer means no other finger is down: forget any touch whose end went unseen.
      if (e.isPrimary) {
        touches.current.clear();
        pinch.current = null;
        gestureLock.current = false;
      }
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size >= 2) {
        el.setPointerCapture(e.pointerId);
        startPinch();
        return;
      }
      if (gestureLock.current) return;
      selBeforeTouch.current = useStore.getState().selection;
    }
    const p = toWorld(e);
    const h = hit(e);
    const v = useStore.getState().view;
    useStore.setState({ contextMenu: null });
    if (inlineEdit) useStore.setState({ inlineEdit: null });
    longPressFired.current = false;
    // Fingers and pens have no right button: holding still opens the context menu.
    if (e.pointerType !== "mouse" && mode === "edit") {
      cancelLongPress();
      const at = { clientX: e.clientX, clientY: e.clientY };
      longPress.current = { timer: setTimeout(() => onLongPress(at, h), 500), start: { x: e.clientX, y: e.clientY }, pointerId: e.pointerId };
    }

    // A finger on empty canvas pans (or, with a node tool, adds a node when it lifts without moving).
    const creating = tool === "place" || tool === "transition" || tool === "note" || tool.startsWith("ft:");
    if (touch && !h && mode === "edit" && (tool === "select" || creating)) {
      drag.current = {
        kind: "pan",
        startScreen: { x: e.clientX, y: e.clientY },
        startView: { x: v.x, y: v.y },
        moved: false,
        context: false,
        world: p,
        targetId: null,
        placeTool: creating ? tool : undefined,
        touch: true,
      };
      el.setPointerCapture(e.pointerId);
      return;
    }

    if (e.button === 1 || e.button === 2 || spaceDown.current || (mode === "simulate" && !h)) {
      drag.current = {
        kind: "pan",
        startScreen: { x: e.clientX, y: e.clientY },
        startView: { x: v.x, y: v.y },
        moved: false,
        context: e.button === 2,
        world: p,
        targetId: h && !isGhost(h.id) && h.kind !== "handle" ? h.id : null,
        touch,
      };
      el.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;

    if (mode === "simulate") {
      if (h?.kind === "transition") simulateClick(isGhost(h.id) ? h.id.slice(6) : h.id, e);
      return;
    }

    // Connector handle: drag out a new arc.
    if (h?.handle) {
      drag.current = { kind: "connect", source: h.id, start: p };
      setArcDraft({ source: h.id, points: [], cursor: p });
      el.setPointerCapture(e.pointerId);
      return;
    }
    if (h?.arcEnd) {
      drag.current = { kind: "arcend", arcId: h.id, end: h.arcEnd };
      el.setPointerCapture(e.pointerId);
      return;
    }
    if (h?.segment !== undefined) {
      // Drag the middle of a segment to create a bend point there.
      const arc = net.arcs.find((a) => a.id === h.id)!;
      const points = [...(arc.points ?? [])];
      // An arc with no bends of its own may still be drawn with a sideways bulge (parallel arcs): its segment
      // handles then don't line up with stored points, and the new point simply becomes its first bend.
      const index = points.length ? h.segment : 0;
      points.splice(index, 0, { x: snap(p.x, snapOn), y: snap(p.y, snapOn) });
      const key = `bend-${Date.now()}`;
      updateArc(arc.id, { points }, key);
      drag.current = { kind: "bend", arcId: arc.id, index, key };
      el.setPointerCapture(e.pointerId);
      return;
    }

    if (tool === "place" || tool === "transition" || tool === "note" || tool.startsWith("ft:")) {
      if (!h) {
        // Stay in the tool so several can be added; Esc or V returns to select.
        placeTool(tool, p);
        if (tool === "note") useStore.setState({ tool: "select" });
      } else select([h.id]);
      return;
    }

    if (tool === "arc") {
      if (h && isNodeKind(h.kind)) {
        if (!arcDraft) {
          setArcDraft({ source: h.id, points: [], cursor: p });
          drag.current = { kind: "connect", source: h.id, start: p };
          el.setPointerCapture(e.pointerId);
        } else if (h.id !== arcDraft.source) {
          finishArc(arcDraft.source, h.id, arcDraft.points);
          setArcDraft(null);
        }
      } else if (arcDraft) {
        setArcDraft({ ...arcDraft, points: [...arcDraft.points, { x: snap(p.x, snapOn), y: snap(p.y, snapOn) }] });
      }
      return;
    }

    // Select tool.
    if (h?.label) {
      const n = vnet.places.find((x) => x.id === h.id) ?? vnet.transitions.find((x) => x.id === h.id);
      if (n) {
        select([h.id]);
        drag.current = { kind: "label", id: h.id, start: p, orig: n.labelOffset ?? { x: 0, y: 0 }, key: `label-${Date.now()}` };
        el.setPointerCapture(e.pointerId);
        return;
      }
    }
    if (h?.bend !== undefined) {
      if (e.altKey) {
        const arc = net.arcs.find((a) => a.id === h.id)!;
        updateArc(h.id, { points: arc.points!.filter((_, i) => i !== h.bend) });
        return;
      }
      drag.current = { kind: "bend", arcId: h.id, index: h.bend, key: `bend-${Date.now()}` };
      el.setPointerCapture(e.pointerId);
      return;
    }
    if (h && isGhost(h.id)) {
      select([]);
      return;
    }
    if (h) {
      let sel = selection;
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        sel = selSet.has(h.id) ? selection.filter((x) => x !== h.id) : [...selection, h.id];
        select(sel);
      } else if (!selSet.has(h.id)) {
        sel = [h.id];
        select(sel);
      }
      const movable = sel.filter((id) => shapeOf(vnet, id) || vnet.notes?.some((n) => n.id === id));
      if (h.kind !== "arc" && h.kind !== "ftedge" && movable.includes(h.id)) {
        drag.current = { kind: "move", ids: movable, last: p, key: `move-${Date.now()}`, moved: false, startScreen: { x: e.clientX, y: e.clientY }, slop: touch ? 8 : 0 };
        el.setPointerCapture(e.pointerId);
      }
      return;
    }
    drag.current = { kind: "band", start: p, current: p, additive: e.shiftKey };
    // Clicking empty canvas also clears search and analysis highlights.
    if (useStore.getState().highlight.length) useStore.setState({ highlight: [] });
    el.setPointerCapture(e.pointerId);
  }

  function finishArc(source: string, target: string, points: Point[] = []) {
    if (isGhost(target)) target = target.slice(6);
    if (isGhost(source)) source = source.slice(6);
    let err: string | null;
    if (ft) {
      // Fault tree edges always run from the lower node (input) up to the upper one (gate).
      const s = net.faultTree!.nodes.find((n) => n.id === source)!;
      const t = net.faultTree!.nodes.find((n) => n.id === target)!;
      err = s && t && s.y < t.y ? addFTEdge(target, source) : addFTEdge(source, target);
    } else err = addArc(source, target, points);
    if (err) toast(err, "error");
  }

  function simulateClick(transitionId: string, e: React.PointerEvent) {
    const M = currentMarking();
    if (!M) return;
    if (ambient) {
      const r = svgRef.current!.getBoundingClientRect();
      ambientTransitionClick(net, M, transitionId, { x: e.clientX - r.left, y: e.clientY - r.top });
      return;
    }
    const t = cn.transitions.find((x) => x.id === transitionId);
    if (!t) return;
    const res = enabledBindings(cn, t.index, M);
    if (res.error) toast(res.error, "error");
    if (!res.bindings.length) {
      toast(`${t.name} is not enabled`);
      return;
    }
    if (res.bindings.length === 1) fireTransition(transitionId, res.bindings[0]);
    else {
      const r = svgRef.current!.getBoundingClientRect();
      useStore.setState({ bindingPicker: { transitionId, bindings: res.bindings, x: e.clientX - r.left, y: e.clientY - r.top } });
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (e.pointerType === "touch") {
      if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.current) return movePinch();
      if (gestureLock.current) return;
    }
    const lp = longPress.current;
    if (lp && lp.pointerId === e.pointerId && Math.hypot(e.clientX - lp.start.x, e.clientY - lp.start.y) > 8) cancelLongPress();
    const p = toWorld(e);
    if (e.pointerType === "mouse" || drag.current) setCursor(p);
    if (arcDraft) setArcDraft({ ...arcDraft, cursor: p });
    const d = drag.current;
    if (!d) {
      // Hover (handles, tips) only means something for a mouse or pen.
      if (e.pointerType === "touch") return;
      const h = hit(e);
      setHover(h && (isNodeKind(h.kind) || h.kind === "arc" || h.kind === "note") ? h.id : h?.handle ? h.id : null);
      return;
    }
    if (d.kind === "pan") {
      if (!d.moved && Math.hypot(e.clientX - d.startScreen.x, e.clientY - d.startScreen.y) < (d.touch ? 8 : 4)) return;
      d.moved = true;
      if (d.long) {
        // Long press, then drag: select an area, as a mouse drag on empty canvas does.
        useStore.setState({ contextMenu: null });
        drag.current = { kind: "band", start: d.world, current: p, additive: false };
        setBand({ a: d.world, b: p });
        return;
      }
      useStore.setState({ view: { ...useStore.getState().view, x: d.startView.x + e.clientX - d.startScreen.x, y: d.startView.y + e.clientY - d.startScreen.y } });
    } else if (d.kind === "move") {
      const dx = p.x - d.last.x;
      const dy = p.y - d.last.y;
      if (!d.moved && (Math.hypot(dx, dy) < 2 || Math.hypot(e.clientX - d.startScreen.x, e.clientY - d.startScreen.y) < d.slop)) return;
      d.moved = true;
      moveSelection(d.ids, dx, dy, d.key);
      d.last = p;
    } else if (d.kind === "band") {
      d.current = p;
      setBand({ a: d.start, b: p });
    } else if (d.kind === "bend") {
      const arc = useStore.getState().net.arcs.find((a) => a.id === d.arcId);
      if (!arc?.points) return;
      const pts = arc.points.map((q, i) => (i === d.index ? { x: snap(p.x, snapOn), y: snap(p.y, snapOn) } : q));
      updateArc(d.arcId, { points: pts }, d.key);
    } else if (d.kind === "connect" || d.kind === "arcend") {
      const over = nodeAt(e);
      setDropTarget(over);
    } else if (d.kind === "label") {
      const off = { x: Math.round(d.orig.x + p.x - d.start.x), y: Math.round(d.orig.y + p.y - d.start.y) };
      if (isPlace(net, d.id)) updatePlace(d.id, { labelOffset: off }, d.key);
      else updateTransition(d.id, { labelOffset: off }, d.key);
    }
    if (d.kind === "arcend") setCursor(p);
  }

  function onPointerUp(e: React.PointerEvent) {
    const touch = e.pointerType === "touch";
    if (longPress.current?.pointerId === e.pointerId) cancelLongPress();
    if (touch) {
      touches.current.delete(e.pointerId);
      if (pinch.current && touches.current.size < 2) pinch.current = null;
      if (gestureLock.current) {
        if (!touches.current.size) gestureLock.current = false;
        lastTap.current = null;
        return;
      }
    }
    const d = drag.current;
    // A finger tap that didn't drag anything: maybe the second tap of a double tap.
    const tapped = touch && (!d || ((d.kind === "move" || d.kind === "pan") && !d.moved && !(d.kind === "pan" && d.long)));
    const longFired = longPressFired.current;
    longPressFired.current = false;
    if (tapped && !longFired && !(d?.kind === "pan" && d.placeTool)) {
      const now = Date.now();
      const lt = lastTap.current;
      if (lt && now - lt.t < 350 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 30) {
        lastTap.current = null;
        drag.current = null;
        // Synchronously, so the text box exists and can take focus (and the on-screen keyboard) during the tap.
        flushSync(() => onDoubleClick(e));
        return;
      }
      lastTap.current = { t: now, x: e.clientX, y: e.clientY };
    } else if (touch) lastTap.current = null;
    drag.current = null;
    setDropTarget(null);
    if (d) svgRef.current?.releasePointerCapture(e.pointerId);
    if (!d) return;
    const p = toWorld(e);
    if (d.kind === "connect") {
      const target = nodeAt(e);
      const moved = Math.hypot(p.x - d.start.x, p.y - d.start.y) > 12;
      if (!moved) {
        // A click (not a drag) on the arc tool starts click-click mode; on a handle, nothing.
        if (tool !== "arc") setArcDraft(null);
        return;
      }
      setArcDraft(null);
      if (target && target !== d.source) finishArc(d.source, target);
      else if (!target && !isGhost(d.source)) addConnectedNode(d.source, { x: snap(p.x, snapOn), y: snap(p.y, snapOn) });
      return;
    }
    if (d.kind === "arcend") {
      const target = nodeAt(e);
      if (target && !isGhost(target)) {
        const err = reconnectArc(d.arcId, d.end, target);
        if (err) toast(err, "error");
      }
      return;
    }
    if (d.kind === "pan") {
      if (d.touch && !d.moved && !d.long) {
        // A tap on empty canvas: add the chosen node there, or clear the selection.
        if (d.placeTool) {
          placeTool(d.placeTool, d.world);
          if (d.placeTool === "note") useStore.setState({ tool: "select" });
        } else if (mode === "edit") {
          select([]);
          if (useStore.getState().highlight.length) useStore.setState({ highlight: [] });
        }
        return;
      }
      if (d.context && !d.moved) {
        const r = svgRef.current!.getBoundingClientRect();
        if (d.targetId && !selSet.has(d.targetId)) select([d.targetId]);
        useStore.setState({ contextMenu: { x: e.clientX - r.left, y: e.clientY - r.top, world: d.world, targetId: d.targetId } });
      }
      return;
    }
    if (d.kind === "move") {
      if (d.moved) snapSelection(d.ids);
      endCoalesce();
    } else if (d.kind === "bend" || d.kind === "label") endCoalesce();
    else if (d.kind === "band") {
      setBand(null);
      const x0 = Math.min(d.start.x, d.current.x);
      const x1 = Math.max(d.start.x, d.current.x);
      const y0 = Math.min(d.start.y, d.current.y);
      const y1 = Math.max(d.start.y, d.current.y);
      const inside = [...vnet.places, ...vnet.transitions, ...(vnet.notes ?? []), ...(vnet.faultTree?.nodes ?? [])]
        .filter((n) => !isGhost(n.id) && n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1)
        .map((n) => n.id);
      if (Math.abs(x1 - x0) < 3 && Math.abs(y1 - y0) < 3) select(d.additive ? selection : []);
      else select(d.additive ? [...new Set([...selection, ...inside])] : inside);
    }
  }

  /** The browser took the pointer away (or the touch was interrupted): drop the gesture, keep what was done so far. */
  function onPointerCancel(e: React.PointerEvent) {
    touches.current.delete(e.pointerId);
    cancelLongPress();
    if (touches.current.size < 2) pinch.current = null;
    if (!touches.current.size) gestureLock.current = false;
    const d = drag.current;
    drag.current = null;
    setBand(null);
    setDropTarget(null);
    if (d?.kind === "connect") setArcDraft(null);
    if (d?.kind === "move" && d.moved) snapSelection(d.ids);
    if (d?.kind === "move" || d?.kind === "bend" || d?.kind === "label") endCoalesce();
  }

  function onDoubleClick(e: React.MouseEvent | React.PointerEvent) {
    if (e.type === "dblclick" && lastPointerType.current === "touch") return; // handled as a double tap
    const h = hitAt(e);
    if (h && isGhost(h.id)) {
      // Jump to the real node.
      const real = h.id.slice(6);
      const n = net.places.find((x) => x.id === real) ?? net.transitions.find((x) => x.id === real);
      if (n) {
        enterPage(n.parent ?? null);
        select([real]);
      }
      return;
    }
    if (h && (h.kind === "place" || h.kind === "transition")) {
      const n = net.places.find((x) => x.id === h.id) ?? net.transitions.find((x) => x.id === h.id);
      if (n?.coarse) {
        enterPage(n.id);
        return;
      }
    }
    if (mode !== "edit" || tool !== "select") return;
    if (!h) {
      // Double-click on empty canvas adds the node kind the user is most likely to want next.
      const p = toWorld(e);
      if (ft) addFTNode("basic", p.x, p.y);
      else {
        const id = addPlace(p.x, p.y);
        useStore.setState({ inlineEdit: { id, field: "name" } });
      }
      return;
    }
    if (h.kind === "arc") {
      if (net.netClass === "freestyle") return;
      useStore.setState({ selection: [h.id], inlineEdit: { id: h.id, field: "inscription" } });
      return;
    }
    if (h.kind === "note") {
      useStore.setState({ selection: [h.id], inlineEdit: { id: h.id, field: "note" } });
      return;
    }
    if (h.kind === "place" && !e.altKey && isPointInsidePlace(h.id, toWorld(e)) && net.netClass !== "freestyle") {
      useStore.setState({ selection: [h.id], inlineEdit: { id: h.id, field: "marking" } });
      return;
    }
    if (isNodeKind(h.kind) || h.label) {
      useStore.setState({ selection: [h.id], inlineEdit: { id: h.id, field: "name" } });
    }
  }

  function isPointInsidePlace(id: string, p: Point) {
    const pl = vnet.places.find((x) => x.id === id);
    return !!pl && Math.hypot(p.x - pl.x, p.y - pl.y) <= PLACE_R;
  }

  // ----- drag from the palette -----
  function onDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes(TOOL_MIME) && mode === "edit") {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setCursor(toWorld(e));
    }
  }
  function onDrop(e: React.DragEvent) {
    const t = e.dataTransfer.getData(TOOL_MIME) as Tool;
    if (!t || mode !== "edit") return;
    e.preventDefault();
    e.stopPropagation();
    const p = toWorld(e);
    placeTool(t, p);
    svgRef.current?.focus();
  }

  const draftLine = (() => {
    if (!arcDraft) return null;
    const s = shapeOf(vnet, arcDraft.source);
    if (!s) return null;
    const tgt = dropTarget ? shapeOf(vnet, dropTarget) : null;
    const endPt = tgt && dropTarget !== arcDraft.source ? { x: tgt.node.x, y: tgt.node.y } : arcDraft.cursor;
    const first = arcDraft.points[0] ?? endPt;
    const pts = [boundaryPoint(s, first), ...arcDraft.points, tgt && dropTarget !== arcDraft.source ? boundaryPoint(tgt, arcDraft.points[arcDraft.points.length - 1] ?? s.node) : endPt];
    return pts.map((q, i) => `${i ? "L" : "M"}${q.x},${q.y}`).join(" ");
  })();

  // Handles for the single selected node (connect) or arc (endpoints, segment midpoints).
  const single = selection.length === 1 && mode === "edit" ? selection[0] : null;
  const handleNode = (() => {
    const id = hover && !isGhost(hover) && shapeOf(vnet, hover) ? hover : single && shapeOf(vnet, single) ? single : null;
    if (!id || mode !== "edit" || (tool !== "select" && tool !== "arc")) return null;
    return shapeOf(vnet, id) ?? null;
  })();
  const selArc = single ? vnet.arcs.find((a) => a.id === single) : undefined;
  const selArcPts = selArc && !pv.remapped.has(selArc.id) ? arcPath(vnet, selArc) : null;
  const k = 1 / view.zoom;

  const gridSize = GRID * view.zoom;
  const cursorStyle =
    mode === "simulate" ? "default" : tool === "select" ? "default" : tool === "arc" ? "crosshair" : "copy";
  const empty = vnet.places.length + vnet.transitions.length + (vnet.faultTree?.nodes.length ?? 0) + (vnet.notes?.length ?? 0) === 0;

  return (
    <div className="canvas-wrap" onDragOver={onDragOver} onDrop={onDrop}>
      <svg
        ref={svgRef}
        className="canvas"
        tabIndex={-1}
        style={{ cursor: cursorStyle }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => {
          setCursor(null);
          setHover(null);
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        data-testid="canvas"
      >
        <defs>
          <pattern id="grid" width={gridSize * 5} height={gridSize * 5} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
            <circle cx={0.75} cy={0.75} r={0.75} style={{ fill: "var(--grid)" }} />
          </pattern>
        </defs>
        {snapOn && gridSize * 5 > 12 && <rect width="100%" height="100%" fill="url(#grid)" />}
        <g transform={`translate(${view.x},${view.y}) scale(${view.zoom})`}>
          <NetDrawing
            net={vnet}
            cn={cn}
            palette={CSS_PALETTE}
            marking={marking}
            selection={selSet}
            enabled={enabled}
            errorIds={mode === "edit" ? errorIds : undefined}
            interactive
            lastFired={lastFired}
            blocking={blocking}
            highlight={hlSet}
            ghosts={pv.ghosts}
            editing={inlineEdit && inlineEdit.field !== "inscription" && inlineEdit.field !== "marking" ? inlineEdit.id : null}
            failed={failedSet}
          />
          {dropTarget && dropTarget !== arcDraft?.source && <DropRing shape={shapeOf(vnet, dropTarget)} k={k} />}
          {selArcPts && selArc && (
            <g>
              {selArcPts.slice(1).map((q, i) => {
                const a = selArcPts[i];
                const mid = { x: (a.x + q.x) / 2, y: (a.y + q.y) / 2 };
                if (Math.hypot(q.x - a.x, q.y - a.y) < 30) return null;
                return (
                  <g key={`s${i}`} data-segment={i} data-arcid={selArc.id}>
                    {coarse && <circle cx={mid.x} cy={mid.y} r={16 * k} className="handle-pad" />}
                    <circle cx={mid.x} cy={mid.y} r={(coarse ? 6 : 4) * k} className="seg-handle">
                      <title>Drag to bend the arc</title>
                    </circle>
                  </g>
                );
              })}
              {(["source", "target"] as const).map((end) => {
                const q = end === "source" ? selArcPts[0] : selArcPts[selArcPts.length - 1];
                return (
                  <g key={end} data-arcend={end} data-arcid={selArc.id}>
                    {coarse && <circle cx={q.x} cy={q.y} r={18 * k} className="handle-pad" />}
                    <circle cx={q.x} cy={q.y} r={(coarse ? 7.5 : 5) * k} className="end-handle">
                      <title>Drag onto another node to reconnect</title>
                    </circle>
                  </g>
                );
              })}
            </g>
          )}
          {handleNode && !drag.current && <ConnectHandles shape={handleNode} k={k} coarse={coarse} />}
          {draftLine && <path d={draftLine} style={{ fill: "none", stroke: "var(--accent)", strokeWidth: 1.5 * k, strokeDasharray: "5 4", pointerEvents: "none" }} />}
          {band && (
            <rect
              x={Math.min(band.a.x, band.b.x)}
              y={Math.min(band.a.y, band.b.y)}
              width={Math.abs(band.b.x - band.a.x)}
              height={Math.abs(band.b.y - band.a.y)}
              style={{ fill: "var(--accent)", fillOpacity: 0.08, stroke: "var(--accent)", strokeWidth: k, strokeDasharray: "4 3" }}
            />
          )}
        </g>
      </svg>
      {empty && mode === "edit" && <EmptyHint ft={ft} subnet={!!page} touch={coarse} below={screen === "phone"} />}
      <Breadcrumbs />
      <SelectionBar />
      {mode === "simulate" && <SimControls />}
      <InlineEditor />
      <ContextMenu />
      <BindingPicker />
      {mode === "simulate" && ambient && <StepPicker />}
      {mode === "simulate" && ambient && <StepTray />}
      {hover && !drag.current && <HoverTip id={hover} />}
      {showMinimap && <Minimap />}
      {!propsDocked(screen) && <PropsPeek sheet={screen === "phone"} />}
      <div className="statusbar">
        <span>{mode === "simulate" ? (ambient ? `Step token game: ${coarse ? "tap" : "click"} a green transition to fire it or add it to a step` : `Simulating: ${coarse ? "tap" : "click"} a green transition to fire it`) : coarse ? touchHintFor(tool, !!arcDraft, ft) : hintFor(tool, !!arcDraft, ft)}</span>
        <span className="spacer" />
        {cursor && !coarse && (
          <span className="mono">
            {Math.round(cursor.x)}, {Math.round(cursor.y)}
          </span>
        )}
        <span className="mono">{Math.round(view.zoom * 100)}%</span>
      </div>
    </div>
  );
}

function ConnectHandles({ shape, k, coarse }: { shape: NonNullable<ReturnType<typeof shapeOf>>; k: number; coarse: boolean }) {
  const n = shape.node;
  const half =
    shape.kind === "place" ? { w: PLACE_R, h: PLACE_R } : shape.kind === "transition" ? (({ w, h }) => ({ w: w / 2, h: h / 2 }))(transSize(shape.node)) : (({ w, h }) => ({ w: w / 2, h: h / 2 }))(ftSize(shape.node));
  // Fingers need bigger handles, further from the node so they don't cover it.
  const grow = coarse ? 1.6 : 1;
  const gap = 12 * grow * Math.min(1.5, Math.max(0.8, k));
  const spots: Point[] =
    shape.kind === "ft"
      ? // Event and gate names sit above or below the symbol: handles go on the sides.
        [{ x: n.x + half.w + gap, y: n.y }, { x: n.x - half.w - gap, y: n.y }]
      : shape.kind === "place"
        ? // Names sit below places, so the third handle goes on top where it can't cover the label.
          [{ x: n.x + half.w + gap, y: n.y }, { x: n.x - half.w - gap, y: n.y }, { x: n.x, y: n.y - half.h - gap }]
        : // Transitions carry their name above and their rate or note below: handles go on the sides.
          [{ x: n.x + half.w + gap, y: n.y }, { x: n.x - half.w - gap, y: n.y }];
  return (
    <g>
      {spots.map((s, i) => (
        <g key={i} data-handle={n.id} className="connect-handle">
          <circle cx={s.x} cy={s.y} r={(coarse ? 22 * k : 9 * Math.max(0.7, Math.min(1.4, k)))} style={{ fill: "transparent" }} />
          <circle cx={s.x} cy={s.y} r={5.5 * grow * Math.max(0.7, Math.min(1.4, k))} className="connect-dot" />
          <path
            d={`M${s.x - 2.5 * grow * k},${s.y} H${s.x + 2.5 * grow * k} M${s.x},${s.y - 2.5 * grow * k} V${s.y + 2.5 * grow * k}`}
            style={{ stroke: "var(--accent-ink)", strokeWidth: 1.4 * Math.min(1, k), pointerEvents: "none" }}
          />
          <title>Drag to connect, or drop on empty space to add a connected node</title>
        </g>
      ))}
    </g>
  );
}

function DropRing({ shape, k }: { shape: ReturnType<typeof shapeOf>; k: number }) {
  if (!shape) return null;
  const n = shape.node;
  if (shape.kind === "place") return <circle cx={n.x} cy={n.y} r={PLACE_R + 6} className="drop-ring" style={{ strokeWidth: 2.5 * k }} />;
  const { w, h } = shape.kind === "transition" ? transSize(shape.node) : ftSize(shape.node);
  return <rect x={n.x - w / 2 - 6} y={n.y - h / 2 - 6} width={w + 12} height={h + 12} rx={4} className="drop-ring" style={{ strokeWidth: 2.5 * k }} />;
}

function EmptyHint({ ft, subnet, touch, below }: { ft: boolean; subnet: boolean; touch: boolean; below: boolean }) {
  const where = below ? "below" : "the left";
  return (
    <div className="empty-hint">
      <strong>{subnet ? "This subnet is empty" : "Start drawing"}</strong>
      {touch ? (
        <span>
          Tap a {ft ? "gate or event" : "place or transition"} {below ? "below" : "on the left"}, then tap here; or drag it here. Then drag the <b>+</b> handle
          of a node to connect it.
        </span>
      ) : ft ? (
        <span>Drag a gate or event from {where} onto the canvas. Drag the + handle of a node to connect it.</span>
      ) : (
        <span>
          Drag a place or transition from {where}, or double-click here. Then drag the <b>+</b> handle on a node to draw an arc, or drop it on
          empty space to create the next node.
        </span>
      )}
    </div>
  );
}

function HoverTip({ id }: { id: string }) {
  const net = useStore((s) => s.net);
  const view = useStore((s) => s.view);
  const mode = useStore((s) => s.mode);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(false);
    const t = setTimeout(() => setVisible(true), 650);
    return () => clearTimeout(t);
  }, [id]);
  if (!visible) return null;
  const real = id.startsWith("ghost:") ? id.slice(6) : id;
  const p = net.places.find((x) => x.id === real);
  const t = net.transitions.find((x) => x.id === real);
  const a = net.arcs.find((x) => x.id === real);
  const f = net.faultTree?.nodes.find((x) => x.id === real);
  const lines: string[] = [];
  let at: Point | null = null;
  if (p) {
    at = { x: p.x, y: p.y + PLACE_R };
    lines.push(`Place ${p.name}${p.logical ? " (logical)" : ""}${p.coarse ? " (subnet)" : ""}`);
    if (p.marking) lines.push(`Initial marking: ${p.marking}`);
    if (p.colourSet) lines.push(`Colour set: ${p.colourSet}`);
    if (p.capacity) lines.push(`Capacity: ${p.capacity}`);
    if (p.comment) lines.push(p.comment);
  } else if (t) {
    at = { x: t.x, y: t.y + 22 };
    lines.push(`Transition ${t.name}${t.coarse ? " (subnet)" : ""}${t.kind ? ` · ${t.kind}` : ""}`);
    if (t.guard) lines.push(`Guard: ${t.guard}`);
    if (t.rate) lines.push(`${t.kind === "immediate" ? "Weight" : t.kind === "deterministic" ? "Delay" : "Rate"}: ${t.rate}`);
    if (t.interval) lines.push(`Interval: [${t.interval[0]}, ${t.interval[1]}]`);
    if (t.sound) lines.push(`Plays ${t.sound.note}`);
    if (t.comment) lines.push(t.comment);
  } else if (f) {
    at = { x: f.x, y: f.y + 24 };
    lines.push(`${f.type === "kofn" ? `${f.k}-out-of-n gate` : f.type} ${f.name}`);
    if (f.failureRate) lines.push(`Failure rate: ${f.failureRate}`);
    if (f.probability) lines.push(`Probability: ${f.probability}`);
    if (f.comment) lines.push(f.comment);
  } else if (a) {
    const s = net.places.find((x) => x.id === a.source) ?? net.transitions.find((x) => x.id === a.source);
    const d = net.places.find((x) => x.id === a.target) ?? net.transitions.find((x) => x.id === a.target);
    if (!s || !d) return null;
    at = { x: (s.x + d.x) / 2, y: (s.y + d.y) / 2 + 12 };
    lines.push(`${a.kind === "normal" ? "Arc" : `${a.kind[0].toUpperCase()}${a.kind.slice(1)} arc`} ${s.name} → ${d.name}`);
    if (a.inscription) lines.push(`Inscription: ${a.inscription}`);
  }
  if (!at || !lines.length) return null;
  return (
    <div className="hover-tip" style={{ left: at.x * view.zoom + view.x + 8, top: at.y * view.zoom + view.y + 8 }}>
      {lines.map((l, i) => (
        <div key={i} className={i ? "" : "hover-title"}>
          {l}
        </div>
      ))}
      {hoverHint(mode, !!t, !!p)}
    </div>
  );
}

function hoverHint(mode: string, isT: boolean, isP: boolean) {
  if (mode === "simulate") return isT ? <div className="hover-hint">Click to fire</div> : null;
  if (isP) return <div className="hover-hint">Double-click inside to edit tokens, on the name to rename</div>;
  if (isT) return <div className="hover-hint">Double-click to rename, right-click for more</div>;
  return null;
}

function hintFor(tool: string, drafting: boolean, ft: boolean): string {
  if (tool.startsWith("ft:")) return "Click to add. Esc returns to the select tool.";
  switch (tool) {
    case "place":
      return "Click to add places. Esc returns to the select tool.";
    case "transition":
      return "Click to add transitions. Esc returns to the select tool.";
    case "note":
      return "Click to add a note.";
    case "arc":
      return drafting ? "Click the target, or empty space to add a bend. Esc cancels." : ft ? "Drag from an event to the gate it feeds." : "Drag from one node to another, or click both.";
    default:
      return "Drag nodes to move · drag the + handle to connect · double-click to edit · right-click for options · Ctrl+wheel zooms";
  }
}

function touchHintFor(tool: string, drafting: boolean, ft: boolean): string {
  if (tool.startsWith("ft:") || tool === "place" || tool === "transition") return "Tap to add · drag to pan · Select tool to finish";
  switch (tool) {
    case "note":
      return "Tap to add a note";
    case "arc":
      return drafting ? "Tap the target, or empty space to add a bend" : ft ? "Drag from an event to the gate it feeds" : "Drag from one node to another, or tap both";
    default:
      return "Tap to select · drag the + handle to connect · double-tap to edit · long-press for options · pinch to zoom";
  }
}

function BindingPicker() {
  const picker = useStore((s) => s.bindingPicker);
  const ref = useRef<HTMLDivElement>(null);
  // Keep the list inside the canvas.
  React.useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.offsetParent as HTMLElement | null;
    if (!picker || !el || !box) return;
    el.style.left = `${Math.max(4, Math.min(picker.x + 12, box.clientWidth - el.offsetWidth - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(picker.y + 12, box.clientHeight - el.offsetHeight - 4))}px`;
  }, [picker]);
  if (!picker) return null;
  return (
    <div className="binding-picker" ref={ref} style={{ left: picker.x + 12, top: picker.y + 12 }} role="menu">
      <div className="binding-title">Choose a binding</div>
      {picker.bindings.map((b, i) => (
        <button key={i} role="menuitem" onClick={() => fireTransition(picker.transitionId, b)}>
          {Object.entries(b)
            .map(([k, v]) => `${k} = ${Array.isArray(v) ? `(${v.join(",")})` : String(v)}`)
            .join(", ") || "(no variables)"}
        </button>
      ))}
      <button className="ghost" onClick={() => useStore.setState({ bindingPicker: null })}>
        Cancel
      </button>
    </div>
  );
}

export function zoomBy(factor: number) {
  const v = useStore.getState().view;
  const el = document.querySelector<SVGSVGElement>("svg.canvas");
  const r = el?.getBoundingClientRect() ?? { width: 800, height: 600 };
  const cx = r.width / 2;
  const cy = r.height / 2;
  const zoom = Math.min(4, Math.max(0.1, v.zoom * factor));
  const k = zoom / v.zoom;
  useStore.setState({ view: { zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k } });
}

/** Scroll so a world point is centred. */
export function centerOn(p: Point) {
  const v = useStore.getState().view;
  const el = document.querySelector<SVGSVGElement>("svg.canvas");
  const r = el?.getBoundingClientRect() ?? { width: 800, height: 600 };
  useStore.setState({ view: { ...v, x: r.width / 2 - p.x * v.zoom, y: r.height / 2 - p.y * v.zoom } });
}

export { edit, distToSegment };
