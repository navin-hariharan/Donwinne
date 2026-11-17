// Performance baselines for the engine packages. Run with `pnpm bench`; compare the numbers on one
// machine (or one CI runner) before and after a change, since absolute times depend on the hardware.
import { bench, describe } from "vitest";
import { buildTransitionSystem, checkCtl, interleavingSystem, sliceNet, stubbornSystem, toPTNet, transitionSystemFromStepGraph } from "@pns/analysis";
import { ambientGarage, ambientGarageFragment, constructTapn, concurrentReachabilityGraph, fig410 } from "@pns/apn";
import { simulate, unfold } from "@pns/sim";
import { emptyNet, type Net } from "@pns/core";

const garage = ambientGarage();
const fragment = ambientGarageFragment();

const decay: Net = {
  ...emptyNet("stochastic", "decay"),
  places: [
    { id: "A", name: "A", x: 0, y: 0, marking: "100" },
    { id: "B", name: "B", x: 100, y: 0, marking: "0" },
  ],
  transitions: [{ id: "t", name: "t", x: 50, y: 0, rate: "MassAction(0.5)" }],
  arcs: [
    { id: "a1", source: "A", target: "t", inscription: "1", kind: "normal" },
    { id: "a2", source: "t", target: "B", inscription: "1", kind: "normal" },
  ],
} as Net;

describe("APN", () => {
  bench("garage CRG, maximal steps (complete)", () => {
    concurrentReachabilityGraph(garage, { maximalOnly: true });
  });
  bench("garage fragment CRG, all steps", () => {
    concurrentReachabilityGraph(fragment, { maxStates: 20_000 });
  });
  bench("garage construction φ", () => {
    constructTapn(garage);
  });
});

describe("state spaces and CTL", () => {
  const crg = concurrentReachabilityGraph(garage, { maximalOnly: true });
  const ts = transitionSystemFromStepGraph(garage, crg);
  bench("garage interleaving state space, first 50,000 states", () => {
    buildTransitionSystem(garage, { maxStates: 50_000 });
  });
  bench("CTL AG(EF(deadlock)) on the garage's maximal-step graph", () => {
    checkCtl(ts, "AG(EF(deadlock))");
  });
});

describe("simulation", () => {
  bench("coloured unfolding of the garage", () => {
    unfold(garage);
  });
  bench("Gillespie, 100 runs of a decay net", () => {
    simulate(decay, { end: 10, points: 101, runs: 100, seed: 1 });
  });
});

describe("slicing and stubborn sets", () => {
  const garagePt = toPTNet(constructTapn(garage).net);
  const chapterPt = toPTNet(constructTapn(fig410()).net);
  const Q = ["p3[b]", "p3[w]", "p3[b_bar]", "p3[w_bar]"];
  bench("abstract slice of the garage T-APN", () => {
    sliceNet(garagePt, { places: ["exit[1]"] }, { algorithm: "abstract" });
  });
  bench("Wangyang slice of the garage T-APN", () => {
    sliceNet(garagePt, { places: ["exit[1]"] }, { algorithm: "wangyang" });
  });
  bench("chapter Fig. 7 T-APN: full interleaving graph (256 states)", () => {
    interleavingSystem(chapterPt);
  });
  bench("chapter Fig. 7 T-APN: abstract slice and its graph (16 states)", () => {
    interleavingSystem(sliceNet(chapterPt, { places: Q }).pt);
  });
  bench("garage T-APN: stubborn-set graph for deadlocks", () => {
    stubbornSystem(garagePt);
  });
});
