import { describe, expect, it } from "vitest";
import {
  Arc,
  ArcKind,
  ColourSetDecl,
  Net,
  NetClass,
  arcKindsFor,
  colourSetDomain,
  compile,
  emptyNet,
  enabledBindings,
  evaluate,
  fire,
  initialMarking,
  inlineFunctions,
  parse,
  showTokens,
} from "@pns/core";

function net(
  netClass: NetClass,
  places: [string, string, Partial<Net["places"][number]>?][],
  transitions: [string, Partial<Net["transitions"][number]>?][],
  arcs: [string, string, string, ArcKind?][],
): Net {
  const n = emptyNet(netClass);
  n.places = places.map(([name, marking, extra]) => ({ id: name, name, x: 0, y: 0, marking, ...extra }));
  n.transitions = transitions.map(([name, extra]) => ({ id: name, name, x: 0, y: 0, ...extra }));
  n.arcs = arcs.map(([source, target, inscription, kind], i): Arc => ({ id: `a${i}`, source, target, inscription, kind: kind ?? "normal" }));
  return n;
}

const errors = (n: Net) => compile(n).problems.filter((p) => p.severity === "error").map((p) => p.message);
const warnings = (n: Net) => compile(n).problems.filter((p) => p.severity === "warning").map((p) => p.message);

function fireAll(n: Net, names: string[]) {
  const cn = compile(n);
  let M = initialMarking(cn);
  for (const name of names) {
    const t = cn.transitions.findIndex((x) => x.name === name);
    const { bindings } = enabledBindings(cn, t, M);
    if (!bindings.length) throw new Error(`${name} not enabled`);
    M = fire(cn, t, bindings[0], M);
  }
  return Object.fromEntries(cn.places.map((p) => [p.name, showTokens(cn, M[p.slot])]));
}

describe("modifier arcs", () => {
  it("are allowed in quantitative classes only", () => {
    expect(arcKindsFor("stochastic")).toContain("modifier");
    expect(arcKindsFor("colouredHybrid")).toContain("modifier");
    expect(arcKindsFor("fuzzyContinuous")).toContain("modifier");
    expect(arcKindsFor("xpt")).not.toContain("modifier");
    expect(arcKindsFor("pt")).toEqual(["normal"]);
  });

  it("never disable a transition and never change the marking", () => {
    const n = net("stochastic", [["E", ""], ["A", "1"], ["B", ""]], [["t"]], [["E", "t", "", "modifier"], ["A", "t", "1"], ["t", "B", "1"]]);
    expect(errors(n)).toEqual([]);
    expect(fireAll(n, ["t"])).toEqual({ E: "0", A: "0", B: "1" });
    // An inscription on a modifier arc is not a weight either.
    n.arcs[0].inscription = "5";
    expect(fireAll(n, ["t"])).toEqual({ E: "0", A: "0", B: "1" });
  });

  it("must go from a place to a transition", () => {
    const n = net("stochastic", [["A", "1"]], [["t"]], [["t", "A", "", "modifier"]]);
    expect(errors(n)).toContain("Arc t → A: a modifier arc must go from a place to a transition");
  });

  it("are flagged in classes without modifier arcs", () => {
    const n = net("xpt", [["A", "1"]], [["t"]], [["A", "t", "", "modifier"]]);
    expect(warnings(n).some((w) => /^Arc A → t: modifier arcs belong to stochastic/.test(w))).toBe(true);
  });
});

describe("fixed places", () => {
  it("are fine in continuous nets and flagged in untimed nets", () => {
    expect(warnings(net("continuous", [["A", "1", { fixed: true }]], [], []))).toEqual([]);
    expect(warnings(net("xpt", [["A", "1", { fixed: true }]], [], [])).some((w) => /Fixed places/.test(w))).toBe(true);
  });

  it("do not influence the token game", () => {
    const n = net("hybrid", [["A", "1", { fixed: true }], ["B", ""]], [["t"]], [["A", "t", "1"], ["t", "B", "1"]]);
    expect(fireAll(n, ["t"])).toEqual({ A: "0", B: "1" });
  });
});

describe("colour sets", () => {
  const domains = (sets: ColourSetDecl[]) => {
    const m = new Map<string, unknown[]>();
    for (const cs of sets) m.set(cs.name, colourSetDomain(cs, m as never));
    return Object.fromEntries(m);
  };

  it("computes bool, string, union, alias and subset domains", () => {
    expect(
      domains([
        { name: "B", type: "bool" },
        { name: "S", type: "string", values: ["alpha", "beta"] },
        { name: "E", type: "enum", values: ["red", "green"] },
        { name: "I", type: "int", min: 1, max: 5 },
        { name: "U", type: "union", components: ["S", "E"] },
        { name: "A", type: "alias", components: ["E"] },
        { name: "Odd", type: "subset", components: ["I"], predicate: "x % 2 = 1" },
        { name: "All", type: "subset", components: ["I"] },
      ]),
    ).toEqual({
      B: [false, true],
      S: ["alpha", "beta"],
      E: ["red", "green"],
      I: [1, 2, 3, 4, 5],
      U: ["alpha", "beta", "red", "green"],
      A: ["red", "green"],
      Odd: [1, 3, 5],
      All: [1, 2, 3, 4, 5],
    });
  });

  it("reports duplicate union values, unknown components and bad predicates", () => {
    const n = emptyNet("coloured");
    n.declarations.colourSets.push(
      { name: "E", type: "enum", values: ["a", "b"] },
      { name: "F", type: "enum", values: ["b", "c"] },
      { name: "U", type: "union", components: ["E", "F"] },
      { name: "Al", type: "alias", components: ["Nope"] },
      { name: "Sub", type: "subset", components: ["E"], predicate: "x +" },
      { name: "Sub2", type: "subset", components: ["E"], predicate: "x" },
      { name: "S", type: "string", values: ["q", "q"] },
    );
    const errs = errors(n);
    expect(errs).toContain("Colour set U contains b more than once");
    expect(errs).toContain('Unknown colour set "Nope" in Al');
    expect(errs.some((e) => /The predicate of colour set Sub:/.test(e))).toBe(true);
    expect(errs.some((e) => /The predicate of colour set Sub2: Expected true or false/.test(e))).toBe(true);
    expect(errs).toContain("Colour set S contains q more than once");
  });

  it("subset predicates may use constants and functions declared anywhere", () => {
    const n = net("coloured", [["P", "all(Big)", { colourSet: "Big" }]], [], []);
    n.declarations.colourSets.push({ name: "I", type: "int", min: 0, max: 9 }, { name: "Big", type: "subset", components: ["I"], predicate: "x >= twice(lim)" });
    n.declarations.constants.push({ name: "lim", value: "3" });
    n.declarations.functions = [{ name: "twice", params: ["v"], body: "2 * v" }];
    const cn = compile(n);
    expect(cn.problems).toEqual([]);
    expect(cn.colourSets.get("Big")).toEqual([6, 7, 8, 9]);
    expect(showTokens(cn, initialMarking(cn)[0])).toBe("6++7++8++9");
  });

  it("binds bool and string variables and uses union colours on places", () => {
    const n = net(
      "coloured",
      [
        ["Flags", "true ++ false", { colourSet: "B" }],
        ["Names", "alpha", { colourSet: "S" }],
        ["Out", "", { colourSet: "U" }],
      ],
      [["t", { guard: "b" }]],
      [
        ["Flags", "t", "b"],
        ["Names", "t", "s"],
        ["t", "Out", "s ++ red"],
      ],
    );
    n.declarations.colourSets.push(
      { name: "B", type: "bool" },
      { name: "S", type: "string", values: ["alpha", "beta"] },
      { name: "E", type: "enum", values: ["red"] },
      { name: "U", type: "union", components: ["S", "E"] },
    );
    n.declarations.variables.push({ name: "b", colourSet: "B" }, { name: "s", colourSet: "S" });
    expect(errors(n)).toEqual([]);
    const cn = compile(n);
    const M = initialMarking(cn);
    const { bindings } = enabledBindings(cn, 0, M);
    expect(bindings).toEqual([{ b: true, s: "alpha" }]);
    expect(fireAll(n, ["t"])).toEqual({ Flags: "false", Names: "", Out: "alpha++red" });
  });
});

describe("user functions", () => {
  const hill = { name: "hill", params: ["S", "K", "n"], body: "S^n / (K^n + S^n)" };

  it("are callable in constants, markings, arc weights and guards", () => {
    const n = net("xpt", [["A", "half(8)"], ["B", ""]], [["t"]], [["A", "t", "half(4)"], ["t", "B", "round(10 * h)"]]);
    n.declarations.functions = [hill, { name: "half", params: ["v"], body: "v / 2" }];
    n.declarations.constants.push({ name: "h", value: "hill(2, 2, 3)" });
    expect(compile(n).problems).toEqual([]);
    expect(compile(n).constants.get("h")).toBe(0.5);
    expect(fireAll(n, ["t", "t"])).toEqual({ A: "0", B: "10" });
  });

  it("work in coloured guards and inscriptions", () => {
    const n = net("coloured", [["P", "1 ++ 2 ++ 3", { colourSet: "I" }], ["Q", "", { colourSet: "I" }]], [["t", { guard: "isOdd(x)" }]], [["P", "t", "x"], ["t", "Q", "next(x)"]]);
    n.declarations.colourSets.push({ name: "I", type: "int", min: 0, max: 9 });
    n.declarations.variables.push({ name: "x", colourSet: "I" });
    n.declarations.functions = [
      { name: "isOdd", params: ["v"], body: "v % 2 = 1" },
      { name: "next", params: ["v"], body: "v + 1" },
    ];
    const cn = compile(n);
    expect(cn.problems).toEqual([]);
    expect(enabledBindings(cn, 0, initialMarking(cn)).bindings).toEqual([{ x: 1 }, { x: 3 }]);
    expect(fireAll(n, ["t"])).toEqual({ P: "2++3", Q: "2" });
  });

  it("can call each other and see constants", () => {
    const n = emptyNet("stochastic");
    n.declarations.constants.push({ name: "k", value: "10" });
    n.declarations.functions = [
      { name: "f", params: ["a"], body: "g(a) + k" },
      { name: "g", params: ["a"], body: "a * a" },
    ];
    n.declarations.constants.push({ name: "r", value: "f(3)" });
    expect(compile(n).constants.get("r")).toBe(19);
  });

  it("report unknown functions, wrong arity, recursion and bad declarations", () => {
    const n = net("xpt", [["A", "1"]], [["t"]], [["A", "t", "hill(1, 2)"]]);
    n.declarations.functions = [
      hill,
      { name: "loop", params: ["x"], body: "loop(x - 1)" },
      { name: "ping", params: ["x"], body: "pong(x)" },
      { name: "pong", params: ["x"], body: "ping(x)" },
      { name: "bad", params: ["x"], body: "nosuch(x)" },
      { name: "dup", params: ["x", "x"], body: "x" },
      { name: "broken", params: [], body: "1 +" },
      { name: "twice", params: [], body: "1" },
      { name: "twice", params: [], body: "2" },
    ];
    n.declarations.constants.push({ name: "c", value: "missing(1)" });
    const errs = errors(n);
    expect(errs).toContain("Arc A → t: hill takes 3 arguments but is called with 2");
    expect(errs).toContain("Function loop calls itself, directly or through other functions (recursion is not allowed)");
    expect(errs).toContain("Function ping calls itself, directly or through other functions (recursion is not allowed)");
    expect(errs).toContain("Function pong calls itself, directly or through other functions (recursion is not allowed)");
    expect(errs).toContain("Function bad: unknown function nosuch");
    expect(errs).toContain("Function dup: the parameter x appears twice");
    expect(errs.some((e) => e.startsWith("Function broken:"))).toBe(true);
    expect(errs).toContain("Function twice is declared twice");
    expect(errs).toContain("Constant c: unknown function missing");
  });

  it("only warn about unknown functions in rates", () => {
    const n = net("stochastic", [["A", "1"]], [["t", { rate: "Foo(1) * MassAction(2)" }], ["u", { rate: "hill(1)" }]], []);
    n.declarations.functions = [hill];
    const cn = compile(n);
    expect(cn.problems).toContainEqual({ severity: "warning", message: "Rate of t: unknown function Foo", elementId: "t" });
    expect(cn.problems).toContainEqual({ severity: "error", message: "Rate of u: hill takes 3 arguments but is called with 1", elementId: "u" });
  });

  it("evaluate with a runtime recursion guard and arity check", () => {
    const fns = new Map([["f", { name: "f", params: ["x"], body: parse("f(x)") }]]);
    expect(() => evaluate(parse("f(1)"), { lookup: () => undefined, functions: fns })).toThrow(/recursion is not allowed/);
    expect(() => evaluate(parse("f(1, 2)"), { lookup: () => undefined, functions: fns })).toThrow(/takes 1 argument but got 2/);
  });

  it("can be expanded in place", () => {
    const fns = new Map([
      ["hill", { name: "hill", params: ["S", "K", "n"], body: parse(hill.body) }],
      ["sq", { name: "sq", params: ["v"], body: parse("v * v") }],
    ]);
    const e = inlineFunctions(parse("k * hill(A, sq(K), 2)"), fns);
    const env = { lookup: (n: string) => ({ k: 2, A: 3, K: 1 })[n] };
    expect(evaluate(e, env)).toBeCloseTo(2 * (9 / (1 + 9)));
    expect(() => inlineFunctions(parse("f(1)"), new Map([["f", { name: "f", params: ["x"], body: parse("f(x)") }]]))).toThrow(/recursion/);
  });
});

describe("math functions", () => {
  it("knows Snoopy's math functions", () => {
    const v = (s: string) => evaluate(parse(s), { lookup: () => undefined }) as number;
    expect(v("pow(2, 10)")).toBe(1024);
    expect(v("sqrt(16) + exp(0) + log(1) + abs(-2)")).toBe(7);
    expect(v("floor(2.7) + ceil(2.2) + min(4, 2, 9) + max(1, 5)")).toBe(12);
    expect(v("sin(0) + cos(0)")).toBe(1);
    expect(v("ln(1) + log10(100) + log2(8) + sqr(3) + sign(-4)")).toBe(13);
    expect(v("tan(0) + asin(0) + acos(1) + atan(0) + sinh(0) + cosh(0) + tanh(0)")).toBe(1);
  });
});

describe("observers", () => {
  it("check names, kinds and expressions", () => {
    const n = net("stochastic", [["A", "1"], ["B", ""]], [["t"]], []);
    n.declarations.constants.push({ name: "k", value: "2" });
    n.declarations.observers = [
      { name: "total", kind: "place", expression: "A + k * B" },
      { name: "flow", kind: "transition", expression: "t / k" },
      { name: "total", kind: "place", expression: "A" },
      { name: "bad", kind: "place", expression: "A +" },
      { name: "wrong", kind: "place", expression: "t" },
      { name: "wrong2", kind: "transition", expression: "A" },
      { name: "fn", kind: "place", expression: "nosuch(A)" },
    ];
    const errs = errors(n);
    expect(errs).toContain("Observer total is declared twice");
    expect(errs.some((e) => e.startsWith("Observer bad:"))).toBe(true);
    expect(errs).toContain('Observer wrong: "t" is not a place or constant (transitions belong in transition observers)');
    expect(errs).toContain('Observer wrong2: "A" is not a transition or constant (places belong in place observers)');
    expect(errs).toContain("Observer fn: unknown function nosuch");
    expect(errs.filter((e) => /total|flow/.test(e) && !/declared twice/.test(e))).toEqual([]);
  });
});
