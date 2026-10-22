import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Net, emptyNet } from "@pns/core";
import { EDGE_SPEED, EDGE_ZONE, cullBox, edgePan, labelCutoff, nearBox, sameButLayout, shapeOf, shortName } from "../src/geometry";
import { EXPORT_PALETTE, NetDrawing } from "../src/NetDrawing";
import { compiled } from "../src/store";

const LONG = "a_rather_long_place_name_indeed";

function sample(): Net {
  return {
    ...emptyNet("pt"),
    places: [
      { id: "p1", name: LONG, x: 0, y: 0, marking: "1" },
      { id: "p2", name: "far", x: 5000, y: 5000, marking: "" },
    ],
    transitions: [{ id: "t1", name: "t1", x: 200, y: 0 }],
    arcs: [{ id: "a1", source: "p1", target: "t1", kind: "normal", inscription: "3" }],
  };
}

const draw = (net: Net, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(React.createElement("svg", null, React.createElement(NetDrawing, { net, cn: compiled(net), palette: EXPORT_PALETTE, ...props })));

describe("labels on the canvas", () => {
  it("leave out labels under 6 screen pixels", () => {
    expect(labelCutoff(1)).toBe(0);
    expect(labelCutoff(0.6)).toBe(0);
    // 6 / 0.55 = 10.9: 10.5 is too small now, 11 and up still show.
    expect(labelCutoff(0.55)).toBe(11);
    expect(labelCutoff(0.5)).toBe(12);
    expect(labelCutoff(0.45)).toBe(Infinity);
  });

  it("cut long names short", () => {
    expect(shortName("x".repeat(20))).toBe("x".repeat(20));
    expect(shortName("x".repeat(21))).toBe(`${"x".repeat(19)}…`);
  });

  it("are all drawn, in full, in exports", () => {
    const svg = draw(sample());
    expect(svg).toContain(`>${LONG}</text>`);
    expect(svg).not.toContain("<title>");
    expect(svg).toContain(">3</text>");
    expect(svg).toContain(">far</text>");
  });

  it("show a short name on the canvas, with the full one as a tooltip", () => {
    const svg = draw(sample(), { interactive: true, shortNames: true });
    expect(svg).toContain(`<title>${LONG}</title>${shortName(LONG)}</text>`);
  });

  it("hide when too small, except on selected and hovered elements", () => {
    const net = sample();
    const hidden = draw(net, { interactive: true, labelMin: Infinity });
    expect(hidden).not.toContain(LONG);
    expect(hidden).not.toContain(">t1</text>");
    expect(hidden).not.toContain(">3</text>");
    expect(draw(net, { interactive: true, labelMin: Infinity, selection: new Set(["p1"]) })).toContain(`>${LONG}</text>`);
    expect(draw(net, { interactive: true, labelMin: Infinity, hover: "t1" })).toContain(">t1</text>");
    expect(draw(net, { interactive: true, labelMin: Infinity, hover: "a1" })).toContain(">3</text>");
  });
});

describe("culling", () => {
  it("draws only what is near the visible part of the drawing", () => {
    const view = { x: 100, y: 100, zoom: 1 };
    const box = cullBox(view, 800, 600);
    // The visible area, (-100, -100) to (700, 500), lies inside with room to spare.
    expect(box.x).toBeLessThan(-100 - 200);
    expect(box.x + box.w).toBeGreaterThan(700 + 200);
    expect(nearBox(box, 0, 0, 0)).toBe(true);
    expect(nearBox(box, 5000, 5000, 100)).toBe(false);
    // A small pan keeps the same box, so the drawing need not re-render.
    expect(cullBox({ ...view, x: 95 }, 800, 600)).toEqual(box);
    const svg = draw(sample(), { interactive: true, viewport: box });
    expect(svg).toContain('data-id="p1"');
    expect(svg).toContain('data-id="a1"');
    expect(svg).not.toContain('data-id="p2"');
  });
});

describe("edge auto-scroll", () => {
  it("pans faster the closer the pointer is to the edge", () => {
    expect(edgePan({ x: 400, y: 300 }, 800, 600)).toEqual({ x: 0, y: 0 });
    expect(edgePan({ x: 0, y: 300 }, 800, 600).x).toBe(EDGE_SPEED);
    expect(edgePan({ x: EDGE_ZONE / 2, y: 300 }, 800, 600).x).toBe(EDGE_SPEED / 2);
    // Past the edge (the pointer is captured, so it can leave the canvas) the speed stays at its top.
    expect(edgePan({ x: -50, y: 300 }, 800, 600).x).toBe(EDGE_SPEED);
    expect(edgePan({ x: 800, y: 600 }, 800, 600)).toEqual({ x: -EDGE_SPEED, y: -EDGE_SPEED });
    // Content moves away from the edge the pointer is near: towards the top left at the bottom right.
    expect(edgePan({ x: 790, y: 10 }, 800, 600).x).toBeLessThan(0);
    expect(edgePan({ x: 790, y: 10 }, 800, 600).y).toBeGreaterThan(0);
  });
});

describe("big nets", () => {
  it("find nodes by id, also after a net was built up in place", () => {
    const net = sample();
    expect(shapeOf(net, "t1")?.kind).toBe("transition");
    expect(shapeOf(net, "p3")).toBeUndefined();
    net.places.push({ id: "p3", name: "p3", x: 1, y: 1, marking: "" });
    expect(shapeOf(net, "p3")?.node.name).toBe("p3");
  });

  it("tell a layout change from a change in meaning", () => {
    const a = sample();
    const moved = { ...a, places: a.places.map((p) => (p.id === "p1" ? { ...p, x: 40, labelOffset: { x: 3, y: 4 } } : p)) };
    expect(sameButLayout(a, moved)).toBe(true);
    const bent = { ...a, arcs: a.arcs.map((x) => ({ ...x, points: [{ x: 1, y: 2 }] })) };
    expect(sameButLayout(a, bent)).toBe(true);
    expect(sameButLayout(a, { ...a, places: a.places.map((p) => (p.id === "p1" ? { ...p, marking: "2" } : p)) })).toBe(false);
    expect(sameButLayout(a, { ...a, arcs: a.arcs.map((x) => ({ ...x, inscription: "2" })) })).toBe(false);
    expect(sameButLayout(a, { ...a, places: a.places.map((p) => (p.id === "p1" ? { ...p, capacity: 3 } : p)) })).toBe(false);
    expect(sameButLayout(a, { ...a, places: a.places.slice(1) })).toBe(false);
    expect(sameButLayout(a, { ...a, netClass: "coloured" })).toBe(false);
    // Fault tree gates take their inputs in drawing order.
    const ft = emptyNet("faultTree");
    expect(sameButLayout(ft, { ...ft, name: ft.name })).toBe(false);
  });
});
