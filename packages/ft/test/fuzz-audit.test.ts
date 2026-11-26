// Differential tests: the BDD/ZDD analyses against brute-force enumeration on small random trees,
// plus regression tests for bugs found while auditing the fault tree package.
import { describe, expect, it } from "vitest";
import { Net } from "@pns/core";
import {
  compileFaultTree,
  exportDnf,
  importanceMeasures,
  importDnf,
  layoutFaultTree,
  minimalCutSets,
  minimalPathSets,
  mulberry32,
  orderedInputs,
  parseDnf,
  simulateFaultTree,
  topEventProbability,
  validateFaultTree,
  FTError,
} from "@pns/ft";
import { NodeSpec, p, rate, tree } from "./helpers";

type Gate = { id: string; type: "and" | "or" | "xor" | "kofn" | "not" | "inhibit" | "intermediate"; inputs: string[]; k?: number };

/** A random static tree over `nb` basic events: a DAG of gates, the last one feeding the top event. */
function randomTree(rng: () => number, nb: number, ng: number, probs: number[]) {
  const basics = Array.from({ length: nb }, (_, i) => `B${i}`);
  const pool = [...basics];
  const gates: Gate[] = [];
  const kinds: Gate["type"][] = ["and", "or", "xor", "kofn", "not", "inhibit", "intermediate"];
  for (let g = 0; g < ng; g++) {
    const type = kinds[Math.floor(rng() * kinds.length)];
    const pick = () => pool[Math.floor(rng() * pool.length)];
    const count = type === "not" || type === "intermediate" ? 1 : type === "inhibit" ? 2 : 2 + Math.floor(rng() * 2);
    const inputs: string[] = [];
    for (let guard = 0; inputs.length < count && guard < 50; guard++) {
      const c = pick();
      if (!inputs.includes(c)) inputs.push(c);
    }
    if (inputs.length < count) continue;
    const gate: Gate = { id: `G${g}`, type, inputs };
    if (type === "kofn") gate.k = 1 + Math.floor(rng() * inputs.length);
    gates.push(gate);
    pool.push(gate.id);
  }
  const top = gates.length ? gates[gates.length - 1].id : basics[0];
  const nodes: NodeSpec[] = [["TOP", "top"], ...gates.map((g): NodeSpec => [g.id, g.type, g.k !== undefined ? { k: g.k } : {}])];
  basics.forEach((b, i) => nodes.push([b, "basic", p(probs[i])]));
  const edges: [string, string][] = [[top, "TOP"]];
  for (const g of gates) for (const i of g.inputs) edges.push([i, g.id]);
  const net = tree(nodes, edges);
  // Only keep nodes that feed the top event, so that the tree is valid without warnings mattering.
  const evalTop = (x: Record<string, boolean>): boolean => {
    const v = new Map<string, boolean>(Object.entries(x));
    for (const g of gates) {
      const ins = g.inputs.map((i) => v.get(i)!);
      const c = ins.filter(Boolean).length;
      const r =
        g.type === "and" || g.type === "inhibit"
          ? c === ins.length
          : g.type === "or" || g.type === "intermediate"
            ? c > 0
            : g.type === "xor"
              ? c === 1
              : g.type === "not"
                ? !ins[0]
                : c >= g.k!;
      v.set(g.id, r);
    }
    return v.get(top)!;
  };
  return { net, basics, evalTop };
}

const subsetsOf = (n: number) => Array.from({ length: 1 << n }, (_, m) => m);
const bits = (m: number, n: number) => Array.from({ length: n }, (_, i) => !!(m & (1 << i)));

function bruteMinimal(n: number, ok: (m: number) => boolean): number[] {
  const sols = subsetsOf(n).filter(ok);
  return sols.filter((s) => !sols.some((t) => t !== s && (t & s) === t));
}

const asMasks = (sets: string[][], basics: string[]) =>
  sets.map((s) => s.reduce((m, id) => m | (1 << basics.indexOf(id)), 0)).sort((a, b) => a - b);

describe("BDD analyses against brute force on random trees", () => {
  it("probability, Birnbaum importance, minimal cut sets and path sets agree", () => {
    const rng = mulberry32(2024);
    let nonCoherent = 0;
    for (let trial = 0; trial < 300; trial++) {
      const nb = 2 + Math.floor(rng() * 4);
      const probs = Array.from({ length: nb }, () => Math.round(rng() * 100) / 100);
      const { net, basics, evalTop } = randomTree(rng, nb, 1 + Math.floor(rng() * 6), probs);
      if (validateFaultTree(net).some((x) => x.severity === "error")) continue;
      const f = (m: number) => evalTop(Object.fromEntries(basics.map((b, i) => [b, bits(m, nb)[i]])));
      const prob = (pv: number[]) =>
        subsetsOf(nb).reduce((acc, m) => (f(m) ? acc + bits(m, nb).reduce((q, b, i) => q * (b ? pv[i] : 1 - pv[i]), 1) : acc), 0);
      // The tree may not use every basic event; variables then only cover the used ones.
      const c = compileFaultTree(net);
      const used = c.variables;
      expect(topEventProbability(net)).toBeCloseTo(prob(probs), 10);

      for (const im of importanceMeasures(net)) {
        const i = basics.indexOf(im.id);
        const q1 = prob(probs.map((x, j) => (j === i ? 1 : x)));
        const q0 = prob(probs.map((x, j) => (j === i ? 0 : x)));
        expect(im.birnbaum).toBeCloseTo(q1 - q0, 10);
      }

      // Cut sets: minimal sets whose failure (with the others working) causes the top event.
      const cuts = bruteMinimal(nb, f);
      expect(asMasks(minimalCutSets(net), basics)).toEqual(cuts.sort((a, b) => a - b));
      // Path sets: minimal sets whose working prevents the top event whatever the others do.
      const isPath = (s: number) => subsetsOf(nb).every((m) => (m & s) !== 0 || !f(m));
      const paths = bruteMinimal(nb, isPath);
      // Basic events not used by the tree cannot be in a minimal path set.
      expect(paths.every((s) => basics.every((b, i) => !(s & (1 << i)) || used.includes(b)))).toBe(true);
      expect(asMasks(minimalPathSets(net), basics)).toEqual(paths.sort((a, b) => a - b));
      const coherent = subsetsOf(nb).every((m) => !f(m) || basics.every((_, i) => f(m | (1 << i))));
      if (!coherent) nonCoherent++;
    }
    expect(nonCoherent).toBeGreaterThan(10);
  });

  it("Monte Carlo agrees with the BDD on random static trees with failure rates", () => {
    const rng = mulberry32(77);
    for (let trial = 0; trial < 12; trial++) {
      const nb = 3;
      const { net } = randomTree(rng, nb, 3, [0.5, 0.5, 0.5]);
      for (const n of net.faultTree!.nodes) if (n.type === "basic") Object.assign(n, { probability: undefined }, rate(Math.round(rng() * 20) / 10000));
      net.netClass = "extendedFaultTree";
      if (validateFaultTree(net).some((x) => x.severity === "error")) continue;
      const exact = topEventProbability(net, { time: 1000 });
      const mc = simulateFaultTree(net, { time: 1000, runs: 4000, seed: trial + 1 });
      expect(Math.abs(mc.probability[0] - exact)).toBeLessThanOrEqual(5 * Math.max(mc.standardError[0], 0.004));
    }
  });
});

describe("audit regressions", () => {
  it("a doubled connection counts once (it is only warned about), also for XOR and k-of-n", () => {
    const xor = tree(
      [["T", "top"], ["X", "xor"], ["A", "basic", p(0.1)], ["B", "basic", p(0.2)]],
      [["X", "T"], ["A", "X"], ["A", "X"], ["B", "X"]],
    );
    expect(validateFaultTree(xor).filter((x) => x.severity === "error")).toEqual([]);
    expect(orderedInputs(xor, "X")).toEqual(["A", "B"]);
    expect(topEventProbability(xor)).toBeCloseTo(0.1 * 0.8 + 0.9 * 0.2, 12);
    expect(minimalCutSets(xor)).toEqual([["A"], ["B"]]);
    const k = tree(
      [["T", "top"], ["K", "kofn", { k: 2 }], ["A", "basic", p(0.1)], ["B", "basic", p(0.2)]],
      [["K", "T"], ["A", "K"], ["A", "K"], ["B", "K"]],
    );
    expect(topEventProbability(k)).toBeCloseTo(0.02, 12);
    expect(simulateFaultTree(k, { time: 1, runs: 2000 }).probability[0]).toBeLessThan(0.05);
  });

  it("minimal path sets of a non-coherent tree are sets whose working prevents the top event", () => {
    // T = A and not B: if A works, T cannot occur, so {A} is the only minimal path set.
    const net = tree(
      [["T", "top"], ["G", "and"], ["N", "not"], ["A", "basic", p(0.1)], ["B", "basic", p(0.2)]],
      [["G", "T"], ["A", "G"], ["N", "G"], ["B", "N"]],
    );
    expect(minimalPathSets(net)).toEqual([["A"]]);
  });

  it("DNF: a negation must be followed by an event", () => {
    expect(() => parseDnf("!(a & b)")).toThrow(FTError);
    expect(() => parseDnf("a & ! & b")).toThrow(FTError);
    expect(parseDnf("not a and b").map((t) => t.map((l) => (l.negated ? "!" : "") + l.name))).toEqual([["!a", "b"]]);
  });

  it("DNF export of a tree with no cut sets or with an empty cut set imports back to the same function", () => {
    // Top event always occurs: NOT of an undeveloped event without data.
    const always = tree([["T", "top"], ["N", "not"], ["U", "undeveloped"]], [["N", "T"], ["U", "N"]]);
    expect(topEventProbability(always)).toBe(1);
    expect(() => exportDnf(always)).toThrow(FTError);
    const names: Net = importDnf("a & b");
    expect(exportDnf(names)).toBe("(a & b)");
  });

  it("DNF export of names with spaces (the Water supply example) imports back to the same cut sets", () => {
    const net = tree(
      [["T", "top"], ["G1", "or"], ["Power", "basic", p(0.01)], ["G2", "and"], ["PA", "basic", { ...p(0.1), name: "Pump A" }], ["PB", "basic", { ...p(0.1), name: "Pump B" }], ["X", "basic", { ...p(0.1), name: "or" }]],
      [["G1", "T"], ["Power", "G1"], ["G2", "G1"], ["PA", "G2"], ["PB", "G2"], ["X", "G1"]],
    );
    const text = exportDnf(net);
    expect(text).toBe("or_ | Power | (Pump_A & Pump_B)");
    const back = importDnf(text);
    const nm = new Map(back.faultTree!.nodes.map((n) => [n.id, n.name]));
    expect(minimalCutSets(back).map((s) => s.map((id) => nm.get(id)))).toEqual([["or_"], ["Power"], ["Pump_A", "Pump_B"]]);
  });

  it("tidy layout keeps the left-to-right input order of PAND, SPARE and FDEP gates", () => {
    // B is shared: placed under G1 (left), so a plain tidy layout would put B left of A and
    // turn PAND(A, B) into PAND(B, A); the FDEP trigger D must stay left of its dependent C.
    const net = tree(
      [
        ["T", "top"],
        ["O", "or"],
        ["G1", "and"],
        ["P", "pand"],
        ["F", "fdep"],
        ["C", "basic", rate(1e-3)],
        ["A", "basic", rate(1e-3)],
        ["B", "basic", rate(1e-3)],
        ["D", "basic", rate(1e-3)],
      ],
      [["O", "T"], ["G1", "O"], ["P", "O"], ["B", "G1"], ["C", "G1"], ["A", "P"], ["B", "P"], ["D", "F"], ["C", "F"], ["D", "P"]],
      "extendedFaultTree",
    );
    // Original order by x: C, A, B, D, so PAND(A, B, D) and FDEP with trigger C and dependent D.
    const before = ["P", "F"].map((g) => orderedInputs(net, g));
    const laid = layoutFaultTree(net);
    const after = ["P", "F"].map((g) => orderedInputs(laid, g));
    expect(after).toEqual(before);
    expect(topEventProbability(laid, { time: 500, runs: 3000 })).toBeCloseTo(topEventProbability(net, { time: 500, runs: 3000 }), 12);
  });
});

describe("tidy layout on random extended trees", () => {
  it("never changes the input order of PAND, SPARE or FDEP gates", () => {
    const rng = mulberry32(99);
    for (let trial = 0; trial < 200; trial++) {
      const nb = 3 + Math.floor(rng() * 4);
      const nodes: NodeSpec[] = [["TOP", "top"]];
      const edges: [string, string][] = [];
      const basics = Array.from({ length: nb }, (_, i) => `B${i}`);
      const pool = [...basics];
      const types = ["and", "or", "pand", "spare", "fdep"] as const;
      const gates: string[] = [];
      for (let g = 0; g < 2 + Math.floor(rng() * 4); g++) {
        const type = types[Math.floor(rng() * types.length)];
        const from = type === "spare" || type === "fdep" ? basics : pool;
        const ins = [...new Set(Array.from({ length: 2 + Math.floor(rng() * 2) }, () => from[Math.floor(rng() * from.length)]))];
        if (ins.length < 2) continue;
        nodes.push([`G${g}`, type]);
        for (const i of ins) edges.push([i, `G${g}`]);
        if (type !== "fdep") {
          pool.push(`G${g}`);
          gates.push(`G${g}`);
        }
      }
      if (!gates.length) continue;
      edges.push([gates[gates.length - 1], "TOP"]);
      basics.forEach((b) => nodes.push([b, "basic", rate(1e-3)]));
      const net = tree(nodes, edges, "extendedFaultTree");
      // Shuffle the drawing so that the layout has something to tidy.
      for (const n of net.faultTree!.nodes) n.x = Math.floor(rng() * 1000);
      const laid = layoutFaultTree(net);
      for (const n of net.faultTree!.nodes)
        if (n.type === "pand" || n.type === "spare" || n.type === "fdep") expect(orderedInputs(laid, n.id), `${trial} ${n.id}`).toEqual(orderedInputs(net, n.id));
    }
  });
});
