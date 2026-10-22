import { describe, expect, it } from "vitest";
import { sortRows } from "../src/Elements";

describe("element table sorting", () => {
  const rows = [{ n: "P10" }, { n: "p2" }, { n: "P1" }, { n: "" }];
  it("compares digit runs by value and ignores case", () => {
    expect(sortRows(rows, (r) => r.n, false).map((r) => r.n)).toEqual(["", "P1", "p2", "P10"]);
    expect(sortRows(rows, (r) => r.n, true).map((r) => r.n)).toEqual(["P10", "p2", "P1", ""]);
  });

  it("sorts numbers numerically, with no limit (Infinity) last, and keeps ties in order", () => {
    const caps = [{ id: "a", c: Infinity }, { id: "b", c: 5 }, { id: "c", c: 40 }, { id: "d", c: 5 }];
    expect(sortRows(caps, (r) => r.c, false).map((r) => r.id)).toEqual(["b", "d", "c", "a"]);
  });

  it("leaves the order alone without a sort column", () => {
    expect(sortRows(rows, null, false)).toBe(rows);
  });
});
