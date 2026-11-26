// The reversed and dual nets (A. Halder, "A Study of Petri Nets", 2006, §4.2.12 and §4.3.3).
import { describe, expect, it } from "vitest";
import { dualNet, emptyNet, reverseNet, type Arc, type Net } from "../src";

type ArcSpec = [string, string, number?, Arc["kind"]?];
function net(places: Record<string, number>, transitions: string[], arcs: ArcSpec[], cls: Net["netClass"] = "pt"): Net {
  const n = emptyNet(cls, "n") as Net;
  for (const [p, m] of Object.entries(places)) n.places.push({ id: p, name: p, x: 0, y: 0, marking: String(m) });
  for (const t of transitions) n.transitions.push({ id: t, name: t, x: 0, y: 0 });
  arcs.forEach(([s, t, w, kind], i) => n.arcs.push({ id: `a${i}`, source: s, target: t, inscription: String(w ?? 1), kind: kind ?? "normal", points: [{ x: i, y: 0 }, { x: i, y: 1 }] }));
  return n;
}
const edges = (n: Net) => n.arcs.map((a) => `${a.source}>${a.target}:${a.inscription}:${a.kind}`).sort();

describe("reversed net N⁻¹ (I⁻¹ = O, O⁻¹ = I)", () => {
  it("turns every arc round and keeps nodes, weights and marking", () => {
    const n = net({ p: 2, q: 0 }, ["t"], [["p", "t", 2], ["t", "q", 3]]);
    const r = reverseNet(n);
    expect(edges(r)).toEqual(["q>t:3:normal", "t>p:2:normal"]);
    expect(r.places.map((p) => p.marking)).toEqual(["2", "0"]);
    expect(r.arcs[0].points).toEqual([{ x: 0, y: 1 }, { x: 0, y: 0 }]);
  });

  it("is an involution", () => {
    const n = net({ p: 1, q: 0 }, ["t", "u"], [["p", "t"], ["t", "q", 2], ["q", "u", 2], ["u", "p"]]);
    expect(edges(reverseNet(reverseNet(n)))).toEqual(edges(n));
  });

  it("keeps read arcs, refuses arcs that have no reverse", () => {
    const n = net({ p: 1, q: 0 }, ["t"], [["p", "t", 1, "read"], ["t", "q"]], "xpt");
    expect(edges(reverseNet(n))).toEqual(["p>t:1:read", "q>t:1:normal"]);
    expect(() => reverseNet(net({ p: 1 }, ["t"], [["p", "t", 1, "inhibitor"]], "xpt"))).toThrow(/inhibitor arc/);
  });
});

describe("dual net (P^ = T, T^ = P, I^ = O, O^ = I)", () => {
  it("swaps places and transitions, reverses arcs and drops the marking", () => {
    const n = net({ p: 2, q: 0 }, ["t"], [["p", "t", 2], ["t", "q"]]);
    const d = dualNet(n);
    expect(d.places.map((p) => [p.id, p.marking])).toEqual([["t", ""]]);
    expect(d.transitions.map((t) => t.id)).toEqual(["p", "q"]);
    expect(edges(d)).toEqual(["q>t:1:normal", "t>p:2:normal"]);
  });

  it("the dual of the dual is the original structure", () => {
    const n = net({ p: 0, q: 0 }, ["t", "u"], [["p", "t"], ["t", "q", 2], ["q", "u"]]);
    const dd = dualNet(dualNet(n));
    expect(dd.places.map((p) => p.id)).toEqual(["p", "q"]);
    expect(dd.transitions.map((t) => t.id)).toEqual(["t", "u"]);
    expect(edges(dd)).toEqual(edges(n));
  });

  it("refuses what the definition does not cover", () => {
    expect(() => dualNet(net({ p: 1 }, ["t"], [["p", "t", 1, "reset"]], "xpt"))).toThrow(/normal arcs only/);
    expect(() => dualNet(emptyNet("coloured", "c") as Net)).toThrow(/place\/transition/);
    const l = net({ p: 1 }, ["t"], [["p", "t"]]);
    l.places[0].logical = true;
    expect(() => dualNet(l)).toThrow(/logical/);
  });
});
