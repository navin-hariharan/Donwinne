import { describe, expect, it } from "vitest";
import { emptyNet } from "@pns/core";
import { addArc, addPlace, addTransition, fireTransition, loadNet, startSimulation, updateArc, updatePlace, useStore } from "../src/store";
import { tokenTrail } from "../src/trail";

/** p0 → t0 → p1 → t1 → p2, with a read arc from q to t0 and one token on p0 and q. */
function line() {
  loadNet(emptyNet("xpt"), null);
  const p0 = addPlace(0, 0);
  const t0 = addTransition(100, 0);
  const p1 = addPlace(200, 0);
  const t1 = addTransition(300, 0);
  const p2 = addPlace(400, 0);
  const q = addPlace(100, 100);
  for (const [a, b] of [[p0, t0], [t0, p1], [p1, t1], [t1, p2], [q, t0]]) expect(addArc(a, b)).toBeNull();
  const read = useStore.getState().net.arcs.find((a) => a.source === q)!;
  updateArc(read.id, { kind: "read" });
  updatePlace(p0, { marking: "1" });
  updatePlace(q, { marking: "1" });
  startSimulation();
  return { p0, t0, p1, t1, p2, q, read: read.id };
}

const trailOf = (full = false) => {
  const s = useStore.getState();
  return tokenTrail(s.net, s.sim, s.trailFrom, s.simIndex, full);
};

describe("token trail", () => {
  it("follows the tokens through transitions, arcs and places, but not along read arcs", () => {
    const { p0, t0, p1, t1, p2, q, read } = line();
    expect(trailOf().strength.size).toBe(0);
    fireTransition(t0, {});
    let t = trailOf();
    expect(t.firings).toBe(1);
    expect([p0, t0, p1].every((id) => t.strength.get(id) === 1)).toBe(true);
    expect(t.strength.has(q)).toBe(false);
    expect(t.strength.has(read)).toBe(false);
    expect(t.strength.has(p2)).toBe(false);
    fireTransition(t1, {});
    t = trailOf();
    expect(t.strength.get(p2)).toBe(1);
    // The older firing fades but stays visible.
    expect(t.strength.get(t0)!).toBeLessThan(1);
    expect(t.strength.get(t0)!).toBeGreaterThan(0.3);
    // In a deadlock the whole route is drawn at full strength.
    expect(trailOf(true).strength.get(t0)).toBe(1);
  });

  it("starts again after Clear trail and when going back before it", () => {
    const { t0, t1, p2 } = line();
    fireTransition(t0, {});
    useStore.setState({ trailFrom: useStore.getState().simIndex });
    fireTransition(t1, {});
    const t = trailOf();
    expect(t.firings).toBe(1);
    expect(t.strength.has(t0)).toBe(false);
    expect(t.strength.get(p2)).toBe(1);
  });

  it("marks the subnets that contain the trail", () => {
    const { t0 } = line();
    const s = useStore.getState();
    const net = { ...s.net, transitions: s.net.transitions.map((t) => (t.id === t0 ? { ...t, parent: "sub" } : t)) };
    fireTransition(t0, {});
    expect(tokenTrail(net, useStore.getState().sim, 0, 1).strength.get("sub")).toBe(1);
  });
});
