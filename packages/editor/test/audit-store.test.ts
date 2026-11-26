import { describe, expect, it } from "vitest";
import { compile, emptyNet, initialMarking } from "@pns/core";
import {
  addArc,
  addPlace,
  addTransition,
  adjustTokens,
  adoptMarking,
  advanceTime,
  copySelection,
  enterPage,
  fireTransition,
  groupIntoSubnet,
  loadNet,
  paste,
  setNetClass,
  simGoto,
  startSimulation,
  stopSimulation,
  ungroupSubnet,
  updatePlace,
  updatePlaces,
  updateTransition,
  useStore,
} from "../src/store";

const st = () => useStore.getState();

describe("store audit", () => {
  it("adds the Dot colour set when switching to a coloured class even if other colour sets exist", () => {
    const net = emptyNet("pt");
    net.declarations = { ...net.declarations, colourSets: [{ name: "Colour", type: "enum", values: ["red", "blue"] }] };
    loadNet(net, null);
    addPlace(0, 0, { marking: "2" });
    setNetClass("coloured");
    const n = st().net;
    expect(n.netClass).toBe("coloured");
    expect(n.declarations.colourSets.some((c) => c.name === "Dot")).toBe(true);
    expect(compile(n).problems.filter((p) => p.severity === "error")).toEqual([]);
  });

  it("keeps the timed token game timed after Keep this marking", () => {
    loadNet(emptyNet("timed"), null);
    const p = addPlace(0, 0, { marking: "1" });
    const t = addTransition(100, 0);
    const q = addPlace(200, 0);
    updateTransition(t, { interval: ["2", "5"] });
    addArc(p, t);
    addArc(t, q);
    startSimulation();
    advanceTime(2);
    adoptMarking();
    const step = st().sim[st().simIndex];
    expect(step.timed).toBeDefined();
    expect(step.timed!.time).toBe(0);
    // The transition must wait its earliest firing time again: firing at once is refused.
    fireTransition(t, {});
    expect(st().sim).toHaveLength(1);
    stopSimulation();
  });

  it("copies a subnet together with its contents", () => {
    loadNet(emptyNet("pt"), null);
    const p0 = addPlace(0, 0, { marking: "1" });
    const t0 = addTransition(100, 0);
    const p1 = addPlace(200, 0);
    addArc(p0, t0);
    addArc(t0, p1);
    useStore.setState({ selection: [t0, p1] });
    groupIntoSubnet("transition");
    const coarse = st().net.transitions.find((t) => t.coarse)!;
    useStore.setState({ selection: [coarse.id] });
    expect(copySelection()).toBe(true);
    paste(40, null);
    const net = st().net;
    const coarses = net.transitions.filter((t) => t.coarse);
    expect(coarses).toHaveLength(2);
    const copy = coarses.find((c) => c.id !== coarse.id)!;
    const inside = [...net.places, ...net.transitions].filter((n) => n.parent === copy.id);
    expect(inside.map((n) => n.name).sort()).toEqual(["P1_2", "T0_2"]);
    // The arc inside the subnet is copied too.
    const ids = new Set(inside.map((n) => n.id));
    expect(net.arcs.filter((a) => ids.has(a.source) && ids.has(a.target))).toHaveLength(1);
    // The pasted subnet's contents stay inside it, not on the page it was pasted to.
    expect(net.places.filter((p) => !p.parent).map((p) => p.name)).toEqual(["P0"]);
  });

  it("does not draw arc kinds the class forbids (stale arc kind, APN)", () => {
    loadNet(emptyNet("xpt"), null);
    useStore.setState({ arcKind: "reset" });
    loadNet(emptyNet("apn"), null);
    const p = addPlace(0, 0);
    const t = addTransition(100, 0);
    expect(addArc(p, t)).toBeNull();
    expect(st().net.arcs.map((a) => a.kind)).toEqual(["normal"]);
    expect(addArc(p, t, [], "read")).toMatch(/not allowed|can't|cannot/i);
    expect(st().net.arcs).toHaveLength(1);
    expect(st().net.netClass).toBe("apn");
  });

  it("does not paste Petri net nodes into a fault tree", () => {
    loadNet(emptyNet("pt"), null);
    const p = addPlace(0, 0);
    useStore.setState({ selection: [p] });
    copySelection();
    loadNet(emptyNet("faultTree"), null);
    paste(40, null);
    expect(st().net.places).toHaveLength(0);
  });

  it("restarts the trail at the branch point when firing from an earlier step", () => {
    loadNet(emptyNet("pt"), null);
    const p = addPlace(0, 0, { marking: "5" });
    const t = addTransition(100, 0);
    addArc(p, t);
    startSimulation();
    fireTransition(t, {});
    fireTransition(t, {});
    fireTransition(t, {});
    useStore.setState({ trailFrom: 3 });
    simGoto(1);
    fireTransition(t, {});
    expect(st().simIndex).toBe(2);
    expect(st().trailFrom).toBeLessThanOrEqual(1);
    stopSimulation();
  });

  it("leaves a subnet page that was ungrouped", () => {
    loadNet(emptyNet("pt"), null);
    const p = addPlace(0, 0);
    useStore.setState({ selection: [p] });
    groupIntoSubnet("place");
    const coarse = st().net.places.find((x) => x.coarse)!;
    enterPage(coarse.id);
    ungroupSubnet(coarse.id);
    expect(st().page).toBeNull();
    updatePlace(p, { marking: "1" });
  });

  it("shares the marking of logical places whichever copy is edited", () => {
    loadNet(emptyNet("pt"), null);
    const a = addPlace(0, 0, { name: "Buf", logical: true, marking: "1" });
    const b = addPlace(100, 0, { name: "Buf", logical: true, marking: "1" });
    const tokens = () => {
      const cn = compile(st().net);
      return initialMarking(cn)[cn.places.find((p) => p.id === a)!.slot].size;
    };
    updatePlace(b, { marking: "3" });
    expect(tokens()).toBe(3);
    expect(st().net.places.find((p) => p.id === a)!.marking).toBe("3");
    adjustTokens(b, 1);
    expect(tokens()).toBe(4);
    updatePlaces([b], { capacity: 9 });
    expect(st().net.places.find((p) => p.id === a)!.capacity).toBe(9);
    // A place that joins the group takes the group's marking instead of changing it.
    const c = addPlace(200, 0, { name: "Buf", marking: "7" });
    updatePlace(c, { logical: true });
    expect(st().net.places.find((p) => p.id === c)!.marking).toBe("4");
    expect(tokens()).toBe(4);
  });
});
