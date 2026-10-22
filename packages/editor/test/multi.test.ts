import { beforeEach, describe, expect, it } from "vitest";
import { emptyNet } from "@pns/core";
import {
  addArc,
  addPlace,
  addTransition,
  copyName,
  copySelection,
  duplicateSelection,
  loadNet,
  paste,
  undo,
  updateArcs,
  updatePlaces,
  updateTransitions,
  useStore,
} from "../src/store";

const net = () => useStore.getState().net;
const names = () => [...net().places, ...net().transitions].map((n) => n.name);

beforeEach(() => {
  loadNet(emptyNet("pt"), null);
  useStore.setState({ pointer: null, snapToGrid: true, inlineEdit: null });
});

describe("pasted names", () => {
  it("count up from the original: name_2, name_3, ... taking the first free suffix", () => {
    const used = new Set(["buffer", "buffer_2", "buffer_4"]);
    expect(copyName("buffer", used)).toBe("buffer_3");
    expect(copyName("fresh", used)).toBe("fresh");
    // A copy of a copy counts on from the original instead of growing buffer_2_2.
    expect(copyName("buffer_2", used)).toBe("buffer_3");
    // A name that only looks numbered keeps its number when the shorter name does not exist.
    expect(copyName("Left_p1_1", new Set(["Left_p1_1"]))).toBe("Left_p1_1_2");
  });

  it("stay readable when pasting the same nodes again and again", () => {
    const p = addPlace(0, 0, { name: "buffer" });
    const t = addTransition(100, 0, { name: "consume" });
    addArc(p, t);
    useStore.setState({ selection: [p, t] });
    expect(copySelection()).toBe(true);
    paste();
    paste();
    expect(names().sort()).toEqual(["buffer", "buffer_2", "buffer_3", "consume", "consume_2", "consume_3"]);
    expect(net().arcs).toHaveLength(3);
  });

  it("keep the name of a logical place, which shares its marking by name", () => {
    const p = addPlace(0, 0, { name: "shared", logical: true });
    useStore.setState({ selection: [p] });
    copySelection();
    paste();
    expect(net().places.map((x) => x.name)).toEqual(["shared", "shared"]);
  });
});

describe("paste position", () => {
  it("centres the copy on the mouse when it is over the canvas", () => {
    const a = addPlace(0, 0);
    const b = addPlace(100, 0);
    useStore.setState({ selection: [a, b] });
    copySelection();
    useStore.setState({ pointer: { x: 400, y: 300 } });
    paste();
    const copies = net().places.slice(2);
    expect(copies.map((p) => [p.x, p.y])).toEqual([
      [350, 300],
      [450, 300],
    ]);
  });

  it("cascades by the offset when pasting again without moving the mouse", () => {
    const a = addPlace(0, 0);
    useStore.setState({ selection: [a] });
    copySelection();
    useStore.setState({ pointer: { x: 400, y: 300 } });
    paste();
    paste();
    expect(net().places.slice(1).map((p) => [p.x, p.y])).toEqual([
      [400, 300],
      [440, 340],
    ]);
  });

  it("offsets the copy when the mouse position is unknown, and duplicate always does", () => {
    const a = addPlace(100, 100);
    useStore.setState({ selection: [a] });
    copySelection();
    paste();
    expect([net().places[1].x, net().places[1].y]).toEqual([140, 140]);
    useStore.setState({ pointer: { x: 900, y: 900 }, selection: [a] });
    duplicateSelection();
    expect([net().places[2].x, net().places[2].y]).toEqual([130, 130]);
  });
});

describe("drawing an arc that already exists", () => {
  it("selects the existing arc and opens its weight editor instead of failing", () => {
    const p = addPlace(0, 0);
    const t = addTransition(100, 0);
    expect(addArc(p, t)).toBeNull();
    const arc = net().arcs[0];
    useStore.setState({ selection: [] });
    const undoDepth = useStore.getState().past.length;
    expect(addArc(p, t)).toBeNull();
    expect(net().arcs).toHaveLength(1);
    expect(useStore.getState().selection).toEqual([arc.id]);
    expect(useStore.getState().inlineEdit).toEqual({ id: arc.id, field: "inscription" });
    // Nothing changed, so there is nothing to undo.
    expect(useStore.getState().past.length).toBe(undoDepth);
  });

  it("still adds an arc in the other direction or of another kind", () => {
    loadNet(emptyNet("xpt"), null);
    const p = addPlace(0, 0);
    const t = addTransition(100, 0);
    addArc(p, t);
    expect(addArc(t, p)).toBeNull();
    expect(addArc(p, t, [], "inhibitor")).toBeNull();
    expect(net().arcs).toHaveLength(3);
    expect(useStore.getState().inlineEdit).toBeNull();
  });
});

describe("editing several elements at once", () => {
  it("changes every selected place in one undo step", () => {
    const a = addPlace(0, 0, { marking: "1" });
    const b = addPlace(100, 0, { marking: "2" });
    const c = addPlace(200, 0, { marking: "3" });
    const before = useStore.getState().past.length;
    // Typing "5" then "50" into the shared field is one step, like typing into one field.
    updatePlaces([a, b], { marking: "5" }, "multi-marking");
    updatePlaces([a, b], { marking: "50" }, "multi-marking");
    expect(net().places.map((p) => p.marking)).toEqual(["50", "50", "3"]);
    expect(useStore.getState().past.length).toBe(before + 1);
    undo();
    expect(net().places.map((p) => p.marking)).toEqual(["1", "2", "3"]);
    expect(c).toBeTruthy();
  });

  it("keeps each element's own value where a patch only changes part of it", () => {
    loadNet(emptyNet("timed"), null);
    const a = addTransition(0, 0, { interval: ["0", "5"] });
    const b = addTransition(100, 0, { interval: ["1", "inf"] });
    updateTransitions([a, b], (t) => ({ interval: ["2", t.interval?.[1] ?? "inf"] }));
    expect(net().transitions.map((t) => t.interval)).toEqual([
      ["2", "5"],
      ["2", "inf"],
    ]);
  });

  it("sets the weight of several arcs and switches to an extended net for read arcs", () => {
    const p = addPlace(0, 0);
    const t = addTransition(100, 0);
    const q = addPlace(200, 0);
    addArc(p, t);
    addArc(t, q);
    const ids = net().arcs.map((a) => a.id);
    updateArcs(ids, { inscription: "3" });
    expect(net().arcs.map((a) => a.inscription)).toEqual(["3", "3"]);
    updateArcs([ids[0]], { kind: "read" });
    expect(net().netClass).toBe("xpt");
  });
});

describe("compiling while dragging", () => {
  it("reuses the compiled net when only the layout changed", async () => {
    const S = await import("../src/store");
    S.loadNet(emptyNet("pt", "drag"), null);
    const p = S.addPlace(0, 0);
    S.addTransition(100, 0);
    const before = S.compiled(S.useStore.getState().net);
    S.useStore.setState((s) => ({ net: { ...s.net, places: s.net.places.map((x) => (x.id === p ? { ...x, x: 40 } : x)) } }));
    expect(S.compiled(S.useStore.getState().net)).toBe(before);
    S.updatePlace(p, { marking: "3" });
    expect(S.compiled(S.useStore.getState().net)).not.toBe(before);
  });
});
