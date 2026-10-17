import { describe, expect, it } from "vitest";
import { emptyNet } from "@pns/core";
import { arcPath } from "../src/geometry";
import { addArc, addPlace, addTransition, loadNet, problemsOf, setNetClass, updateArc, useStore } from "../src/store";

describe("arcs between the same two nodes", () => {
  it("draws a forward and a backward arc apart instead of on top of each other", () => {
    loadNet(emptyNet("pt"), null);
    const p = addPlace(0, 0);
    const t = addTransition(200, 0);
    expect(addArc(p, t)).toBeNull();
    expect(addArc(t, p)).toBeNull();
    const net = useStore.getState().net;
    const [a, b] = net.arcs;
    const pa = arcPath(net, a)!;
    const pb = arcPath(net, b)!;
    // Both bend through a virtual point off the straight line, on opposite sides.
    expect(pa.length).toBe(3);
    expect(pb.length).toBe(3);
    expect(Math.sign(pa[1].y)).toBe(-Math.sign(pb[1].y));
    expect(Math.abs(pa[1].y)).toBeGreaterThan(5);
  });

  it("keeps a single arc straight", () => {
    loadNet(emptyNet("pt"), null);
    const p = addPlace(0, 0);
    const t = addTransition(200, 0);
    addArc(p, t);
    const net = useStore.getState().net;
    expect(arcPath(net, net.arcs[0])!.length).toBe(2);
  });
});

describe("modifier arcs", () => {
  it("are refused in a place/transition net and allowed in a stochastic one", () => {
    loadNet(emptyNet("pt"), null);
    const p = addPlace(0, 0);
    const t = addTransition(200, 0);
    expect(addArc(p, t, [], "modifier")).toMatch(/stochastic, continuous or hybrid/);
    loadNet(emptyNet("stochastic"), null);
    const p2 = addPlace(0, 0);
    const t2 = addTransition(200, 0);
    expect(addArc(p2, t2, [], "modifier")).toBeNull();
    expect(useStore.getState().net.arcs[0].kind).toBe("modifier");
  });

  it("block switching to a class without them", () => {
    loadNet(emptyNet("stochastic"), null);
    const p = addPlace(0, 0);
    const t = addTransition(200, 0);
    addArc(p, t, [], "modifier");
    setNetClass("pt");
    expect(useStore.getState().net.netClass).toBe("stochastic");
  });
});

describe("arc weight checks", () => {
  function oneArc(w: string) {
    loadNet(emptyNet("pt"), null);
    const p = addPlace(0, 0);
    const t = addTransition(200, 0);
    addArc(p, t);
    const a = useStore.getState().net.arcs[0];
    updateArc(a.id, { inscription: w });
    return problemsOf(useStore.getState().net).filter((x) => x.elementId === a.id);
  }
  it("reports a negative weight as an error", () => {
    expect(oneArc("-2").some((x) => x.severity === "error" && /negative/.test(x.message))).toBe(true);
  });
  it("warns about a zero weight", () => {
    expect(oneArc("0").some((x) => x.severity === "warning" && /no effect/.test(x.message))).toBe(true);
  });
  it("rejects a fractional weight on a discrete place", () => {
    expect(oneArc("1.5").some((x) => x.severity === "error")).toBe(true);
  });
  it("accepts a positive whole weight", () => {
    expect(oneArc("3")).toEqual([]);
  });
});
