import { beforeEach, describe, expect, it } from "vitest";
import { fig411, rootNet, basicStepNet, thesisFig3_1 } from "@pns/apn";
import { loadNet, newNet, startSimulation, stopSimulation, useStore } from "../src/store";
import { blockingInhibitors, conflictReason, enabledAt, fireAmbientStep, insertBlock, pendingStatus, showST, useAmbient, whyBlocked } from "../src/ambient";
import { stepRandom } from "../src/simulation";

const M = () => {
  const s = useStore.getState();
  return s.sim[s.simIndex].marking;
};

beforeEach(() => {
  stopSimulation();
  useAmbient.setState({ pending: [], collecting: false, maximalOnly: false, picker: null });
});

describe("step token game", () => {
  it("explains the colour-sensitive inhibitor of Fig. 3.1", () => {
    loadNet(thesisFig3_1(), null);
    startSimulation();
    const net = useStore.getState().net;
    const en = enabledAt(net, M());
    expect(en.map((st) => showST(net, st))).toEqual(["(t,b)"]);
    const w = { transition: en[0].transition, colour: "w" };
    const why = whyBlocked(net, M(), w);
    expect(why.some((r) => r.kind === "inhibitor" && /p5 holds w/.test(r.text))).toBe(true);
    const arcs = blockingInhibitors(net, M());
    expect([...arcs.values()]).toEqual([["w"]]);
  });

  it("fires a step and records it as {(t,c),…}", () => {
    loadNet(fig411(), null);
    startSimulation();
    const net = useStore.getState().net;
    const en = enabledAt(net, M());
    expect(en.length).toBeGreaterThan(1);
    // Find two that can fire together.
    let pair = null as null | typeof en;
    for (let i = 0; i < en.length && !pair; i++) for (let j = i + 1; j < en.length && !pair; j++) if (pendingStatus(net, M(), [en[i], en[j]]).ok) pair = [en[i], en[j]];
    expect(pair).not.toBeNull();
    expect(fireAmbientStep(pair!)).toBe(true);
    const s = useStore.getState();
    expect(s.simIndex).toBe(1);
    expect(s.sim[1].label).toMatch(/^\{\(.+,.+\),\(.+,.+\)\}$/);
    expect(s.sim[1].transitionIds).toHaveLength(2);
  });

  it("names the reason for a conflict (Def. 4)", () => {
    loadNet(fig411(), null);
    startSimulation();
    const net = useStore.getState().net;
    const en = enabledAt(net, M());
    let found = false;
    for (let i = 0; i < en.length; i++)
      for (let j = i + 1; j < en.length; j++) {
        const st = pendingStatus(net, M(), [en[i], en[j]]);
        if (!st.ok) {
          expect(st.text).toMatch(/conflict/);
          expect(conflictReason(net, M(), en[i], en[j])).toMatch(/both/);
          found = true;
        }
      }
    expect(found).toBe(true);
  });

  it("fires random steps until something happens", () => {
    loadNet(fig411(), null);
    startSimulation();
    expect(stepRandom()).toBe(true);
    expect(useStore.getState().sim[1].step?.length).toBeGreaterThan(0);
  });
});

describe("building blocks", () => {
  it("starts an APN with users b and w", () => {
    newNet("apn");
    const d = useStore.getState().net.declarations;
    expect(d.colourSets.map((c) => c.name)).toContain("BW");
    expect(d.variables).toEqual([{ name: "x", colourSet: "BW" }]);
  });

  it("adds a root net and a step net next to each other without clashes", () => {
    newNet("apn");
    const a = insertBlock(rootNet({ users: ["b", "w"] }));
    expect("ids" in a).toBe(true);
    const b = insertBlock(basicStepNet({ start: "p1", finish: "p2", step: "t1" }));
    expect("ids" in b).toBe(true);
    const net = useStore.getState().net;
    expect(new Set(net.places.map((p) => p.id)).size).toBe(net.places.length);
    expect(net.declarations.colourSets.filter((c) => c.name === "BW")).toHaveLength(1);
    // A second block with the same names is refused.
    const c = insertBlock(basicStepNet({ start: "p1", finish: "p2", step: "t1" }));
    expect("error" in c).toBe(true);
  });
});
