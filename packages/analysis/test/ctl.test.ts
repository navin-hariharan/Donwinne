import { describe, expect, it } from "vitest";
import {
  CtlChecker,
  CtlError,
  TransitionSystem,
  buildTransitionSystem,
  checkCtl,
  ctlProblems,
  formatCtl,
  parseCtl,
  transitionSystemFromGraph,
} from "@pns/analysis";
import { MersenneTwister } from "@pns/sim";
import { A, P, T, colouredPhilosophers, mk, mutex, philosophers, producerConsumer } from "./nets";

const err = (f: () => unknown): CtlError => {
  try {
    f();
  } catch (e) {
    if (e instanceof CtlError) return e;
    throw e;
  }
  throw new Error("no error");
};

describe("CTL parser", () => {
  it("parses Charlie's syntax with the thesis's precedence", () => {
    // & binds tighter than ->, as Charlie's output for Fig. 7.1 shows.
    expect(formatCtl(parseCtl("AG(entrance==2 -> AX(p1>0&ctrl_p1>0) & (p1==2 -> AX(p2)))"))).toBe("AG(entrance == 2 -> AX(p1 > 0 & ctrl_p1 > 0) & (p1 == 2 -> AX(p2)))");
    // -> associates to the left, as Charlie's output for Fig. 7.19 shows.
    const f = parseCtl("a -> b -> c");
    expect(f.kind).toBe("implies");
    expect(f.kind === "implies" && f.left.kind).toBe("implies");
    expect(formatCtl(f)).toBe("(a -> b) -> c");
    // & tighter than |.
    expect(formatCtl(parseCtl("a & b | c & d"))).toBe("a & b | c & d");
    expect(formatCtl(parseCtl("a & (b | c)"))).toBe("a & (b | c)");
  });

  it("accepts the until forms, Charlie's * and + and bare places", () => {
    expect(formatCtl(parseCtl("AG(Left_p1_2 ->A(Left_p1_2!=0 U db_p1_1_2==0));"))).toBe("AG(Left_p1_2 -> A[Left_p1_2 U db_p1_1_2 == 0])");
    expect(formatCtl(parseCtl("E [true U ! (place9 > 0 * place2 > 0 ) + EX place10 != 0]"))).toBe("E[true U !(place9 > 0 & place2 > 0) | EX(place10)]");
    expect(formatCtl(parseCtl("Left_p1_1 * A1 * Park_A1_1"))).toBe("Left_p1_1 & A1 & Park_A1_1");
    expect(formatCtl(parseCtl("x = 1 & y <> 2 & sum(a, b[c]) >= 2"))).toBe("x == 1 & y != 2 & sum(a, b[c]) >= 2");
    expect(formatCtl(parseCtl("!AX(PC1_off | PC2_off )"))).toBe("!AX(PC1_off | PC2_off)");
    expect(formatCtl(parseCtl('"A" > 0 & fireable(take<x=a>) & !deadlock // comment'))).toBe('"A" > 0 & fireable(take<x=a>) & !deadlock');
    expect(formatCtl(parseCtl("fork[a] > 0 & fork[1,b] == 0"))).toBe("fork[a] > 0 & fork[1,b] == 0");
  });

  it("reports syntax errors with position and expected tokens", () => {
    let e = err(() => parseCtl("AG(p1 > 0 & )"));
    expect(e.kind).toBe("syntax");
    expect(e.line).toBe(1);
    expect(e.column).toBe(13);
    expect(e.found).toBe(")");
    expect(e.expected).toContain("a place name");
    expect(e.message).toMatch(/^Line 1, column 13: expected .* but found "\)"/);

    e = err(() => parseCtl("AG(p1 > 0\n  & EX(p2)"));
    expect(e.line).toBe(2);
    expect(e.message).toContain('expected ")" to close the "(" at line 1, column 3');

    e = err(() => parseCtl("E[p U q"));
    expect(e.expected).toEqual(['"]"']);
    e = err(() => parseCtl("E[p q]"));
    expect(e.message).toContain("expected U");
    e = err(() => parseCtl("p U q"));
    expect(e.message).toContain("U can only be used inside");
    e = err(() => parseCtl("p > 0)"));
    expect(e.message).toContain("no matching opening bracket");
    e = err(() => parseCtl("3"));
    expect(e.message).toContain("a number on its own is not a condition");
    e = err(() => parseCtl("p > 1.5"));
    expect(e.message).toContain("whole numbers");
    e = err(() => parseCtl("  "));
    expect(e.message).toContain("empty");
    e = err(() => parseCtl("p # q"));
    expect(e.message).toContain('unexpected character "#"');
    e = err(() => parseCtl("A > 0"));
    expect(e.message).toContain("must be followed by");
  });

  it("names unknown places and colours with suggestions", () => {
    const ts = buildTransitionSystem(mutex());
    const [e] = ctlProblems("AG(!(crit1 & crti2))", ts);
    expect(e.kind).toBe("name");
    expect(e.suggestions).toContain("crit2");
    expect(e.column).toBe(14);
    expect(e.message).toContain('did you mean "crit2"');
    const c = buildTransitionSystem(colouredPhilosophers());
    const [e2] = ctlProblems("fork[d] > 0", c);
    expect(e2.message).toContain("its colours are a, b, c");
    expect(ctlProblems("fireable(tak)", c)[0].message).toContain('did you mean "take"');
    expect(ctlProblems("AG(fork[a] + eat)", c)).toEqual([]);
    expect(ctlProblems("AG(mutex <= 1) & EF(crit1)", ts)).toEqual([]);
    expect(ctlProblems("AG(mutex <= 1) & EF(nope) & nope2", ts)).toHaveLength(2);
  });
});

describe("CTL model checking", () => {
  it("checks mutual exclusion with a witness and a counterexample", () => {
    const ts = buildTransitionSystem(mutex());
    const ok = checkCtl(ts, "AG(!(crit1 & crit2))");
    expect(ok.status).toBe("true");
    expect(ok.satisfyingStates).toHaveLength(ts.markings.length);
    expect(ok.trace).toBeUndefined();

    const ef = checkCtl(ts, "EF(crit1)");
    expect(ef.status).toBe("true");
    expect(ef.trace?.kind).toBe("witness");
    expect(ef.trace?.steps.map((s) => s.label)).toEqual(["enter1"]);
    expect(ef.trace?.markings[1]).toEqual({ crit1: 1, idle2: 1 });

    const bad = checkCtl(ts, "AG(idle1)");
    expect(bad.status).toBe("false");
    expect(bad.trace?.kind).toBe("counterexample");
    expect(bad.trace?.steps.map((s) => s.label)).toEqual(["enter1"]);

    expect(checkCtl(ts, "AG(EF(idle1 & idle2))").status).toBe("true");
    expect(checkCtl(ts, "AG(crit1 -> AF(idle1))").status).toBe("true"); // while crit1 holds the mutex, exit1 is the only move
    expect(checkCtl(ts, "AG(idle1 -> AF(crit1))").status).toBe("false"); // process 2 may take the mutex forever
    expect(checkCtl(ts, "AG(idle1 -> AF(crit1))").trace?.loopsBackTo).toBeDefined();
  });

  it("gives lasso counterexamples for AF and witnesses for EG", () => {
    // p0 -t0-> p1, p1 -t1-> p0, p0 -t2-> p2 (dead). AF p2 fails by looping t0 t1 forever.
    const net = mk("pt", [["p0", "1"], ["p1", ""], ["p2", ""]], [["t0"], ["t1"], ["t2"]], [["p0", "t0"], ["t0", "p1"], ["p1", "t1"], ["t1", "p0"], ["p0", "t2"], ["t2", "p2"]]);
    const ts = buildTransitionSystem(net);
    const af = checkCtl(ts, "AF(p2)");
    expect(af.status).toBe("false");
    expect(af.trace?.loopsBackTo).toBe(0);
    expect(af.trace?.steps.map((s) => s.label)).toEqual(["t0", "t1"]);
    const eg = checkCtl(ts, "EG(!p1)");
    expect(eg.status).toBe("true");
    expect(eg.trace?.endsInDeadlock).toBe(true);
    expect(eg.trace?.steps.map((s) => s.label)).toEqual(["t2"]);
    const eu = checkCtl(ts, "E[!p1 U p2]");
    expect(eu.trace?.steps.map((s) => s.label)).toEqual(["t2"]);
    const au = checkCtl(ts, "A[p0 | p1 U p2]");
    expect(au.status).toBe("false");
    expect(au.trace?.loopsBackTo).toBe(0);
  });

  it("treats deadlocks as stuttering by default and as path ends on request", () => {
    const net = mk("pt", [["p", "1"], ["q", ""]], [["t"]], [["p", "t"], ["t", "q"]]);
    const ts = buildTransitionSystem(net);
    expect(checkCtl(ts, "AG(q -> EX(q))").status).toBe("true");
    expect(checkCtl(ts, "AG(q -> EX(q))", { deadlocks: "maximal" }).status).toBe("false");
    expect(checkCtl(ts, "AG(q -> AX(false))", { deadlocks: "maximal" }).status).toBe("true");
    expect(checkCtl(ts, "AG(q -> AX(false))").status).toBe("false");
    expect(checkCtl(ts, "EF(deadlock & q)").status).toBe("true");
    expect(checkCtl(ts, "fireable(t) & AX(!fireable(t))").status).toBe("true");
  });

  it("counts coloured places per colour and in total", () => {
    const ts = buildTransitionSystem(colouredPhilosophers());
    expect(checkCtl(ts, "think == 3 & fork[a] == 1 & think[a] == 1").status).toBe("true");
    expect(checkCtl(ts, "AG(sum(think, eat) == 3)").status).toBe("true");
    expect(checkCtl(ts, "AG(eat <= 1)").status).toBe("true");
    const r = checkCtl(ts, "EF(eat[b] > 0)");
    expect(r.trace?.steps[0].label).toBe("take<x=b>");
    expect(r.trace?.steps[0].transitions[0].baseName).toBe("take");
    expect(checkCtl(ts, "fireable(take<x=c>) & fireable(take) & !fireable(release)").status).toBe("true");
    expect(checkCtl(ts, "AG(!(fireable(take<x=c>) & fireable(release)))").status).toBe("true");
  });

  it("works on an externally built step graph", () => {
    // Two independent transitions; the step graph also has the step {a, b}.
    const ts = transitionSystemFromGraph({
      places: ["p", "q", "r", "s"],
      transitions: ["a", "b"],
      markings: [{ p: 1, r: 1 }, { q: 1, r: 1 }, { p: 1, s: 1 }, { q: 1, s: 1 }],
      edges: [
        { from: 0, to: 1, transitions: ["a"] },
        { from: 0, to: 2, transitions: ["b"] },
        { from: 0, to: 3, transitions: ["a", "b"] },
        { from: 1, to: 3, transitions: ["b"] },
        { from: 2, to: 3, transitions: ["a"] },
      ],
    });
    expect(ts.semantics).toBe("step");
    const r = checkCtl(ts, "EX(q & s)");
    expect(r.status).toBe("true");
    expect(r.trace?.steps[0].label).toBe("{a, b}");
    expect(checkCtl(ts, "AF(q & s)").status).toBe("true");
  });

  it("is inconclusive on truncated state spaces except for found witnesses", () => {
    const ts = buildTransitionSystem(philosophers(8), { maxStates: 10 });
    expect(ts.complete).toBe(false);
    expect(checkCtl(ts, "EF(eat0)").status).toBe("true");
    expect(checkCtl(ts, "AG(EF(eat0))").status).toBe("unknown");
    expect(checkCtl(ts, "AG(!eat0)").status).toBe("false");
    expect(checkCtl(ts, "AG(think0 | eat0)").status).toBe("unknown");
  });

  it("honours an abort signal", () => {
    const ac = new AbortController();
    ac.abort();
    expect(() => buildTransitionSystem(producerConsumer(3), { signal: ac.signal })).toThrow(/aborted/);
    const ts = buildTransitionSystem(producerConsumer(3));
    expect(() => checkCtl(ts, "AG(EF(ready))", { signal: ac.signal })).toThrow(/aborted/);
  });
});

// ---- Cross-check the labelling algorithm against a direct evaluation on random graphs.

type F = { k: string; a?: F; b?: F; p?: number };
function randomFormula(rng: MersenneTwister, depth: number): F {
  if (depth === 0 || rng.random() < 0.25) return { k: "atom", p: Math.floor(rng.random() * 3) };
  const ks = ["not", "and", "or", "EX", "AX", "EF", "AF", "EG", "AG", "EU", "AU"];
  const k = ks[Math.floor(rng.random() * ks.length)];
  return { k, a: randomFormula(rng, depth - 1), b: randomFormula(rng, depth - 1) };
}
function text(f: F): string {
  switch (f.k) {
    case "atom": return `x${f.p}`;
    case "not": return `!(${text(f.a!)})`;
    case "and": return `(${text(f.a!)}) & (${text(f.b!)})`;
    case "or": return `(${text(f.a!)}) | (${text(f.b!)})`;
    case "EU": return `E[${text(f.a!)} U ${text(f.b!)}]`;
    case "AU": return `A[${text(f.a!)} U ${text(f.b!)}]`;
    default: return `${f.k}(${text(f.a!)})`;
  }
}
/** Naive semantics: successors with a self-loop on dead states; fixpoints by iteration. */
function naive(ts: TransitionSystem, f: F): boolean[] {
  const n = ts.markings.length;
  const succ = (s: number) => {
    const r: number[] = [];
    for (let e = ts.edgeStart[s]; e < ts.edgeStart[s + 1]; e++) r.push(ts.edgeTo[e]);
    return r.length ? r : [s];
  };
  const S = [...Array(n).keys()];
  const ev = (g: F): boolean[] => {
    if (g.k === "atom") return S.map((s) => ts.markings[s][g.p!] > 0);
    const a = ev(g.a!);
    const b = g.b ? ev(g.b) : [];
    const fix = (init: boolean, step: (z: boolean[]) => boolean[]) => {
      let z = S.map(() => init);
      for (;;) {
        const z2 = step(z);
        if (z2.every((v, i) => v === z[i])) return z;
        z = z2;
      }
    };
    switch (g.k) {
      case "not": return a.map((v) => !v);
      case "and": return a.map((v, i) => v && b[i]);
      case "or": return a.map((v, i) => v || b[i]);
      case "EX": return S.map((s) => succ(s).some((t) => a[t]));
      case "AX": return S.map((s) => succ(s).every((t) => a[t]));
      case "EF": return fix(false, (z) => S.map((s) => a[s] || succ(s).some((t) => z[t])));
      case "AF": return fix(false, (z) => S.map((s) => a[s] || succ(s).every((t) => z[t])));
      case "EG": return fix(true, (z) => S.map((s) => a[s] && succ(s).some((t) => z[t])));
      case "AG": return fix(true, (z) => S.map((s) => a[s] && succ(s).every((t) => z[t])));
      case "EU": return fix(false, (z) => S.map((s) => b[s] || (a[s] && succ(s).some((t) => z[t]))));
      case "AU": return fix(false, (z) => S.map((s) => b[s] || (a[s] && succ(s).every((t) => z[t]))));
    }
    throw new Error(g.k);
  };
  return ev(f);
}

/** Replay a trace on the transition system: every step must be an edge. */
function replays(ts: TransitionSystem, states: number[], steps: { from: number; to: number }[]) {
  return steps.every((st, i) => {
    if (st.from !== states[i]) return false;
    for (let e = ts.edgeStart[st.from]; e < ts.edgeStart[st.from + 1]; e++) if (ts.edgeTo[e] === st.to) return true;
    return false;
  });
}

describe("CTL cross-check on random nets", () => {
  it("agrees with a naive fixpoint evaluation and gives replayable traces", () => {
    const rng = new MersenneTwister(7);
    let checked = 0;
    for (let round = 0; round < 120; round++) {
      const places: P[] = [0, 1, 2, 3].map((i) => [`x${i}`, rng.random() < 0.5 ? "1" : ""]);
      const transitions: T[] = [0, 1, 2, 3].map((i) => [`t${i}`]);
      const arcs: A[] = [];
      for (let p = 0; p < 4; p++)
        for (let t = 0; t < 4; t++) {
          if (rng.random() < 0.3) arcs.push([`x${p}`, `t${t}`]);
          if (rng.random() < 0.3) arcs.push([`t${t}`, `x${p}`]);
        }
      const net = mk("pt", places, transitions, arcs);
      const ts = buildTransitionSystem(net, { maxStates: 200 });
      if (!ts.complete) continue;
      const checker = new CtlChecker(ts);
      for (let k = 0; k < 15; k++) {
        const f = randomFormula(rng, 3);
        const r = checker.check(text(f));
        const want = naive(ts, f);
        expect(r.satisfyingStates).toEqual(want.flatMap((v, i) => (v ? [i] : [])));
        if (r.trace) {
          expect(r.trace.states[0]).toBe(0);
          expect(replays(ts, r.trace.states, r.trace.steps)).toBe(true);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(300);
  });
});

describe("CTL on truncated state spaces", () => {
  it("gives only verdicts that the full state space confirms (three-valued checking)", () => {
    const rng = new MersenneTwister(11);
    let decided = 0;
    let undecided = 0;
    for (let round = 0; round < 500; round++) {
      const places: P[] = [0, 1, 2, 3].map((i) => [`x${i}`, rng.random() < 0.5 ? String(1 + Math.floor(rng.random() * 2)) : ""]);
      const transitions: T[] = [0, 1, 2, 3].map((i) => [`t${i}`]);
      const arcs: A[] = [];
      for (let p = 0; p < 4; p++)
        for (let t = 0; t < 4; t++) {
          if (rng.random() < 0.3) arcs.push([`x${p}`, `t${t}`]);
          if (rng.random() < 0.3) arcs.push([`t${t}`, `x${p}`]);
        }
      const net = mk("pt", places, transitions, arcs);
      const full = buildTransitionSystem(net, { maxStates: 400 });
      if (!full.complete || full.markings.length < 6) continue;
      const cut = buildTransitionSystem(net, { maxStates: 2 + Math.floor(rng.random() * (full.markings.length - 3)) });
      expect(cut.complete).toBe(false);
      for (const deadlocks of ["stutter", "maximal"] as const) {
        const a = new CtlChecker(full, { deadlocks });
        const b = new CtlChecker(cut, { deadlocks });
        for (let k = 0; k < 10; k++) {
          const f = text(randomFormula(rng, 3));
          const r = b.check(f);
          if (r.status === "unknown") {
            undecided++;
            continue;
          }
          decided++;
          expect(r.status, `${f} (${deadlocks})`).toBe(a.check(f).status);
          // The first states are numbered alike, so the trace must replay on the full system too.
          if (r.trace) expect(replays(full, r.trace.states, r.trace.steps)).toBe(true);
        }
      }
    }
    expect(decided).toBeGreaterThan(300);
    expect(undecided).toBeGreaterThan(50);
  });

  it("decides next-state properties of fully expanded states", () => {
    const ts = buildTransitionSystem(philosophers(8), { maxStates: 30 });
    expect(ts.complete).toBe(false);
    expect(ts.open?.[0]).toBe(0);
    // The initial state is fully expanded, so EX and AX about it are conclusive.
    expect(checkCtl(ts, "EX(eat0)").status).toBe("true");
    expect(checkCtl(ts, "AX(eat0)").status).toBe("false");
    expect(checkCtl(ts, "AX(!(eat0 & eat1))").status).toBe("true");
    expect(checkCtl(ts, "AG(EX(true))").status).toBe("unknown");
  });
});
