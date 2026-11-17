// A marking-dependent arc weight that cannot be evaluated at a marking (it is negative or not a whole
// number there) leaves it unknown whether the transition can fire. The state is then neither dead
// nor fully expanded: every exploration marks it open, and no verdict that depends on it is given.
import { describe, expect, it } from "vitest";
import { analyseNet, checkCtl, deadStates, interleavingSystem, stubbornSystem, toPTNet } from "@pns/analysis";
import { mk } from "./nets";

// p starts with 3 tokens; t takes one at a time. u's weight p - 2 is -1 once p holds 1 token, so

const net = () => mk("xpt", [["p", "3"], ["q", ""]], [["t"], ["u"]], [["p", "t"], ["t", "q"], ["p", "u", "p - 2"]]);

describe("transitions that cannot be evaluated", () => {
  it("do not make a state dead, and leave the state space incomplete", () => {
    const pt = toPTNet(net());
    expect(pt.errors).toEqual([]);
    const ts = interleavingSystem(pt);
    expect(ts.complete).toBe(false);
    expect(deadStates(ts)).toEqual([]);
    expect(ts.notes.join(" ")).toMatch(/could not be evaluated/);
    // Whether the net deadlocks depends on u at p <= 1: unknown, never a definite answer.
    expect(checkCtl(ts, "EF(deadlock)").status).toBe("unknown");
    expect(checkCtl(ts, "AG(!deadlock)").status).toBe("unknown");
    // Verdicts that do not depend on the unknown successors stay definite.
    expect(checkCtl(ts, "EF(q >= 2)").status).toBe("true");
    expect(checkCtl(ts, "AG(p <= 3)").status).toBe("unknown");
  });

  it("are treated the same way by the stubborn-set graph", () => {
    const ts = stubbornSystem(toPTNet(net()));
    expect(ts.complete).toBe(false);
    expect(deadStates(ts)).toEqual([]);
    expect(checkCtl(ts, "EF(deadlock)").status).toBe("unknown");
  });

  it("make the properties report say unknown instead of claiming a deadlock", () => {
    const r = analyseNet(net());
    const dl = r.summary.find((s) => s.key === "deadlockFree")!;
    expect(dl.status).toBe("unknown");
    expect(dl.explanation).toMatch(/could not be evaluated/);
    expect(r.behaviour.deadlocks).toBe(0);
    expect(r.warnings.join(" ")).toMatch(/could not be evaluated/);
  });
});
