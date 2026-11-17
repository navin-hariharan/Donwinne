// Absurdly nested or long input must give a message, never a stack overflow.
import { describe, expect, it } from "vitest";
import { evaluate, parse } from "@pns/core";
import { CtlError, parseCtl } from "../src";

describe("parser limits", () => {
  it("refuses deeply nested expressions with a message", () => {
    for (const src of ["(".repeat(5000) + "1" + ")".repeat(5000), "-".repeat(5000) + "1", "!".repeat(5000) + "true", "f(".repeat(5000) + "1" + ")".repeat(5000)])
      expect(() => parse(src)).toThrow(/nested too deeply/);
  });
  it("refuses expression chains too long to evaluate, and keeps long ones that are fine", () => {
    expect(() => parse(Array(5000).fill("1").join("+"))).toThrow(/too long/);
    expect(evaluate(parse(Array(900).fill("1").join("+")), {} as never)).toBe(900);
    expect(evaluate(parse("(".repeat(150) + "2" + ")".repeat(150)), {} as never)).toBe(2);
  });
  it("refuses deeply nested or very long CTL formulas with a positioned error", () => {
    for (const src of ["(".repeat(5000) + "true" + ")".repeat(5000), "!".repeat(5000) + "true", "EF ".repeat(5000) + "true", Array(5000).fill("p > 0").join(" & ")]) {
      let err: unknown;
      try {
        parseCtl(src);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(CtlError);
    }
    expect(() => parseCtl("AG(" + Array(300).fill("p > 0").join(" & ") + ")")).not.toThrow();
  });
});
