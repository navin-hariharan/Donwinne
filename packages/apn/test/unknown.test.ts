// "Unknown must remain Unknown": what the APN model-property functions report when the graph is
// partial or some transition cannot be evaluated.
import { describe, expect, it } from "vitest";
import { Net, emptyNet } from "@pns/core";
import { findReachable } from "../src/model-properties";

/** P/T net: p (3 tokens) feeds t (weight p - 5, invalid at every reachable marking) and u. */
function badWeight(): Net {
  const net = emptyNet("xpt", "bad weight");
  const place = (id: string, marking: string) => ({ id, name: id, x: 0, y: 0, marking });
  net.places = [place("p", "3"), place("q", ""), place("r", "")];
  net.transitions = [{ id: "t", name: "t", x: 0, y: 0 }, { id: "u", name: "u", x: 0, y: 0 }];
  net.arcs = [
    { id: "a0", source: "p", target: "t", inscription: "p - 5", kind: "normal" },
    { id: "a1", source: "t", target: "q", inscription: "1", kind: "normal" },
    { id: "a2", source: "p", target: "u", inscription: "1", kind: "normal" },
    { id: "a3", source: "u", target: "r", inscription: "1", kind: "normal" },
  ];
  return net;
}

describe("findReachable with evaluation errors", () => {
  it("an invalid marking-dependent weight makes 'not found' incomplete, not 'unreachable'", () => {
    const r = findReachable(badWeight(), { q: ["dot"] });
    expect(r.found).toBe(false);
    expect(r.complete).toBe(false);
    expect(r.unresolved).toBeGreaterThan(0);
    expect(r.error).toMatch(/^t: .*whole number/);
  });

  it("goals behind the evaluable transitions are still found, with a path", () => {
    const r = findReachable(badWeight(), { r: ["dot"] });
    expect(r.found).toBe(true);
    expect(r.path.map((s) => s.transition)).toEqual(["u"]);
  });

  it("a net without evaluation errors still proves unreachability", () => {
    const net = badWeight();
    net.arcs[0].inscription = "5";
    expect(findReachable(net, { q: ["dot"] })).toMatchObject({ found: false, complete: true, unresolved: 0 });
  });
});
