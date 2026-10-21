import { describe, expect, it } from "vitest";
import { compile, emptyNet, initialMarking } from "@pns/core";
import { pageView } from "../src/geometry";
import { addArc, addFTEdge, addFTNode, addPlace, addTransition, alignSelection, copySelection, groupIntoSubnet, loadNet, paste, redo, undo, useStore, ungroupSubnet } from "../src/store";

function chain() {
  loadNet(emptyNet("pt"), null);
  const p0 = addPlace(0, 0);
  const t0 = addTransition(100, 0);
  const p1 = addPlace(200, 0);
  const t1 = addTransition(300, 0);
  expect(addArc(p0, t0)).toBeNull();
  expect(addArc(t0, p1)).toBeNull();
  expect(addArc(p1, t1)).toBeNull();
  return { p0, t0, p1, t1 };
}

describe("editing", () => {
  it("keeps fault tree connections when copying and pasting", () => {
    loadNet(emptyNet("faultTree"), null);
    const gate = addFTNode("and", 0, 0);
    const a = addFTNode("basic", -50, 100);
    const b = addFTNode("basic", 50, 100);
    expect(addFTEdge(a, gate)).toBeNull();
    expect(addFTEdge(b, gate)).toBeNull();
    useStore.setState({ selection: [gate, a] });
    expect(copySelection()).toBe(true);
    paste();
    const ft = useStore.getState().net.faultTree!;
    expect(ft.nodes).toHaveLength(5);
    expect(ft.edges).toHaveLength(3);
    const pasted = new Set(useStore.getState().selection);
    const copy = ft.edges.at(-1)!;
    expect(pasted.has(copy.source) && pasted.has(copy.target)).toBe(true);
  });

  it("rejects place-to-place arcs and duplicate arcs", () => {
    const { p0, p1, t0 } = chain();
    expect(addArc(p0, p1)).toMatch(/place and a transition/);
    expect(addArc(p0, t0)).toMatch(/already exists/);
  });

  it("groups nodes into a subnet without changing behaviour", () => {
    const { t0, p1 } = chain();
    const before = compile(useStore.getState().net);
    useStore.setState({ selection: [t0, p1] });
    groupIntoSubnet("transition");
    const net = useStore.getState().net;
    const coarse = net.transitions.find((t) => t.coarse)!;
    expect(coarse).toBeTruthy();
    const after = compile(net);
    expect(after.transitions.map((t) => t.name).sort()).toEqual(before.transitions.map((t) => t.name).sort());
    expect(after.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(initialMarking(after).length).toBe(initialMarking(before).length);

    // Top level: arcs to hidden nodes are drawn to the coarse transition.
    const top = pageView(net, null);
    expect(top.net.transitions.map((t) => t.id)).toContain(coarse.id);
    expect(top.net.arcs.some((a) => a.target === coarse.id)).toBe(true);
    // Inside: outside nodes appear as ghosts.
    const inside = pageView(net, coarse.id);
    expect(inside.ghosts.size).toBe(2);

    ungroupSubnet(coarse.id);
    expect(useStore.getState().net.transitions.some((t) => t.coarse)).toBe(false);
    expect(useStore.getState().net.places.every((p) => !p.parent)).toBe(true);
  });

  it("aligns and undoes", () => {
    const { p0, p1 } = chain();
    useStore.setState({ selection: [p0, p1] });
    alignSelection("top");
    const ys = useStore.getState().net.places.map((p) => p.y);
    expect(new Set(ys).size).toBe(1);
    undo();
    redo();
    expect(new Set(useStore.getState().net.places.map((p) => p.y)).size).toBe(1);
  });
});
