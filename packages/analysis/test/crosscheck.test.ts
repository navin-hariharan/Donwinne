// Randomised cross-checks of the pruned algorithms against brute force on small nets.
import { describe, expect, it } from "vitest";
import { MersenneTwister, reachabilityGraph } from "@pns/sim";
import { analyseNet, incidenceMatrix, minimalInvariants, minimalSets, toPTNet } from "@pns/analysis";
import { A, P, T, mk } from "./nets";

function randomNet(rng: MersenneTwister, nP: number, nT: number, density: number) {
  const places: P[] = Array.from({ length: nP }, (_, i) => [`p${i}`, rng.random() < 0.4 ? String(1 + Math.floor(rng.random() * 2)) : ""]);
  const transitions: T[] = Array.from({ length: nT }, (_, i) => [`t${i}`]);
  const arcs: A[] = [];
  for (let p = 0; p < nP; p++)
    for (let t = 0; t < nT; t++) {
      if (rng.random() < density) arcs.push([`p${p}`, `t${t}`, String(1 + Math.floor(rng.random() * 2))]);
      if (rng.random() < density) arcs.push([`t${t}`, `p${p}`, String(1 + Math.floor(rng.random() * 2))]);
    }
  return mk("pt", places, transitions, arcs);
}

/** Plain Farkas without intermediate pruning; minimal supports filtered at the end. */
function naiveInvariants(A: number[][], cols: number): string[] {
  const n = A.length;
  let rows = A.map((c, i) => ({ c: c.slice(), y: Array.from({ length: n }, (_, k) => (k === i ? 1 : 0)) }));
  const g = (a: number, b: number): number => (b ? g(b, a % b) : Math.abs(a));
  for (let j = 0; j < cols; j++) {
    const next = rows.filter((r) => r.c[j] === 0);
    for (const p of rows.filter((r) => r.c[j] > 0))
      for (const q of rows.filter((r) => r.c[j] < 0)) {
        const a = p.c[j];
        const b = -q.c[j];
        next.push({ c: p.c.map((v, i) => b * v + a * q.c[i]), y: p.y.map((v, i) => b * v + a * q.y[i]) });
      }
    rows = next;
    if (rows.length > 5000) return ["too big"];
  }
  const ys = rows.map((r) => {
    const d = r.y.reduce((acc, v) => g(acc, v), 0);
    return r.y.map((v) => v / d);
  });
  const sup = (y: number[]) => y.map((v) => v !== 0);
  const minimal = ys.filter((y) => !ys.some((z) => sup(z).every((s, i) => !s || sup(y)[i]) && sup(z).some((s, i) => s !== sup(y)[i])));
  return [...new Set(minimal.map((y) => y.join(",")))].sort();
}

function bruteForceMinimal(n: number, ok: (S: number[]) => boolean): string[] {
  const all: number[][] = [];
  for (let mask = 1; mask < 1 << n; mask++) {
    const S = [...Array(n).keys()].filter((i) => mask & (1 << i));
    if (ok(S)) all.push(S);
  }
  const minimal = all.filter((S) => !all.some((R) => R.length < S.length && R.every((x) => S.includes(x))));
  return minimal.map((S) => S.join(",")).sort();
}

describe("cross-checks on random nets", () => {
  const rng = new MersenneTwister(12345);
  const nets = Array.from({ length: 60 }, (_, i) => randomNet(rng, 3 + (i % 5), 2 + (i % 4), 0.25));

  it("minimal invariants equal plain Farkas + final filtering", () => {
    let compared = 0;
    for (const net of nets) {
      const C = incidenceMatrix(toPTNet(net)).rows;
      const m = net.transitions.length;
      const CT = Array.from({ length: m }, (_, t) => C.map((row) => row[t]));
      for (const [A, cols] of [[C, m], [CT, C.length]] as const) {
        const ref = naiveInvariants(A, cols);
        if (ref[0] === "too big") continue;
        const got = minimalInvariants(A, cols).vectors.map((y) => y.join(",")).sort();
        expect(got).toEqual(ref);
        // Every vector is an invariant.
        for (const y of minimalInvariants(A, cols).vectors) for (let j = 0; j < cols; j++) expect(A.reduce((s, row, i) => s + y[i] * row[j], 0)).toBe(0);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(100);
  });

  it("minimal siphons and traps equal brute-force enumeration", () => {
    for (const net of nets) {
      const pt = toPTNet(net);
      const C = { pre: [] as number[][], post: [] as number[][] };
      for (let t = 0; t < pt.transitions.length; t++) {
        C.pre.push(pt.arcs.filter((a) => a.transition === t && a.dir === "in").map((a) => a.place));
        C.post.push(pt.arcs.filter((a) => a.transition === t && a.dir === "out").map((a) => a.place));
      }
      const T = pt.transitions.length;
      const isSiphon = (S: number[]) => [...Array(T).keys()].every((t) => !C.post[t].some((p) => S.includes(p)) || C.pre[t].some((p) => S.includes(p)));
      const isTrap = (S: number[]) => [...Array(T).keys()].every((t) => !C.pre[t].some((p) => S.includes(p)) || C.post[t].some((p) => S.includes(p)));
      const n = pt.places.length;
      expect(minimalSets(pt, "siphons").sets.map((s) => s.join(",")).sort()).toEqual(bruteForceMinimal(n, isSiphon));
      expect(minimalSets(pt, "traps").sets.map((s) => s.join(",")).sort()).toEqual(bruteForceMinimal(n, isTrap));
    }
  });

  it("state spaces match @pns/sim's reachability graph", () => {
    for (const net of nets.slice(0, 30)) {
      const r = analyseNet(net, { maxStates: 1000 });
      const rg = reachabilityGraph(net, { maxStates: 1000 });
      expect(r.behaviour.exploration === "truncated").toBe(rg.truncated);
      if (rg.truncated) continue;
      expect(r.behaviour.states).toBe(rg.states.length);
      expect(r.behaviour.deadlocks).toBe(rg.states.filter((s) => s.dead).length);
      // Unbounded according to Karp–Miller iff the reachability graph is infinite is not checkable here;
      // but a complete graph must give bounded = yes.
      expect(r.behaviour.bounded).toBe("yes");
    }
  });
});
