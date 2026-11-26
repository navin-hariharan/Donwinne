// Audit of the importers and exporters: random nets round-tripped through every format that promises
// to keep them, and the one-way exporters checked against the firing rule and rate semantics of
// @pns/core and @pns/sim on small known nets.
import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { Net, NetClass, compile, defaultTransitionKind, emptyNet, enabledBindings, fire, initialMarking } from "@pns/core";
import { assignNames } from "../src/text-common";
import { EXAMPLES } from "../../editor/src/examples";
import {
  exportAndl,
  exportCsvDeclarations,
  exportLola,
  exportPnml,
  exportPrism,
  exportSbml,
  exportSnoopy,
  exportTina,
  importAndl,
  importPnmlWithWarnings,
  importSnoopy,
  parseNet,
  serializeNet,
} from "../src";

const parser = new DOMParser({ onError: () => {} });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ["A", "B&C", "<p>", 'q"uote', "α β", "x'y", "P1", "rate", "long name", "]]>", "1st"];
const CLASSES: NetClass[] = ["pt", "xpt", "timed", "stochastic", "continuous", "hybrid", "music", "modulo"];

/** A random uncoloured net of the given class with the features that class allows. */
function randomNet(seed: number, netClass: NetClass): Net {
  const r = rng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const net = emptyNet(netClass, pick(["net", "N & <M>", "ünï"]));
  if (r() < 0.5) net.comment = pick(["a comment", 'with "quotes" & <tags>', "two\nlines"]);
  net.declarations.constants = r() < 0.5 ? [{ name: "k", value: pick(["2", "0.5", "1e-4", "3"]) }] : [];
  const nP = 1 + Math.floor(r() * 4);
  const nT = 1 + Math.floor(r() * 3);
  const used = new Set<string>();
  const uname = (pre: string) => {
    let n = r() < 0.4 ? pick(NAMES) : `${pre}${used.size}`;
    while (used.has(n)) n += "_";
    used.add(n);
    return n;
  };
  const continuous = netClass === "continuous";
  for (let i = 0; i < nP; i++)
    net.places.push({
      id: `p${i}`,
      name: uname("P"),
      x: Math.round(r() * 500),
      y: Math.round(r() * 500),
      marking: continuous ? pick(["0", "2.5", "1e-3", "7"]) : String(Math.floor(r() * 4)),
      ...(netClass === "hybrid" && r() < 0.4 ? { continuous: true } : {}),
      ...(continuous ? { continuous: true } : {}),
    });
  const kinds =
    netClass === "pt" ? (["normal"] as const) : continuous || netClass === "stochastic" || netClass === "hybrid" ? (["normal", "read", "inhibitor", "reset", "equal", "modifier"] as const) : (["normal", "read", "inhibitor", "reset", "equal"] as const);
  for (let i = 0; i < nT; i++) {
    const t: Net["transitions"][number] = { id: `t${i}`, name: uname("T"), x: Math.round(r() * 500), y: Math.round(r() * 500) };
    if (netClass === "stochastic" || netClass === "hybrid") {
      t.kind = netClass === "hybrid" && r() < 0.3 ? "continuous" : "stochastic";
      t.rate = pick(["MassAction(1)", "MassAction(2.5)", "0.5"]);
    }
    if (continuous) {
      t.kind = "continuous";
      t.rate = pick(["MassAction(1)", "MassAction(0.25)"]);
    }
    if (netClass === "timed") t.interval = pick([["0", "inf"], ["1", "3"], ["2", "2"]] as [string, string][]);
    net.transitions.push(t);
  }
  let a = 0;
  const seen = new Set<string>();
  for (let i = 0; i < nP * nT * 2; i++) {
    const p = pick(net.places);
    const t = pick(net.transitions);
    const out = r() < 0.4;
    const kind = out ? "normal" : pick([...kinds]);
    const key = out ? `${t.id}>${p.id}` : `${p.id}>${t.id}>${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const k = net.declarations.constants.length && !continuous && net.declarations.constants[0].value.match(/^\d+$/);
    const w = kind === "modifier" ? "" : kind === "reset" ? "1" : k && r() < 0.3 ? "k" : String(1 + Math.floor(r() * 3));
    net.arcs.push({ id: `a${a++}`, source: out ? t.id : p.id, target: out ? p.id : t.id, kind, inscription: w });
  }
  // A logical place drawn twice.
  if (r() < 0.3) {
    const p = net.places[0];
    p.logical = true;
    net.places.push({ ...p, id: "copy", x: p.x + 40, y: p.y + 40 });
  }
  return net;
}

describe("round trips of the shipped examples", () => {
  it("PNML and the native format keep every example exactly", () => {
    for (const { title, net } of EXAMPLES) {
      expect(parseNet(serializeNet(net)), title).toEqual(net);
      const back = importPnmlWithWarnings(exportPnml(net), parser);
      expect(back.warnings, title).toEqual([]);
      expect(back.net, title).toEqual(net);
    }
  });

  it("Snoopy keeps the structure and inscriptions of every example", () => {
    for (const { title, net } of EXAMPLES) {
      const back = importSnoopy(exportSnoopy(net), parser).net;
      expect(back.netClass, title).toBe(net.netClass);
      const sig = (n: Net) => {
        const nm = new Map([...n.places, ...n.transitions, ...(n.faultTree?.nodes ?? [])].map((x) => [x.id, x.name]));
        return {
          places: n.places.map((p) => `${p.name}|${p.marking.trim() || "0"}|${p.colourSet ?? ""}`).sort(),
          transitions: n.transitions.map((t) => `${t.name}|${t.guard ?? ""}|${t.rate ?? ""}|${t.interval ?? ""}`).sort(),
          arcs: n.arcs.map((a) => `${nm.get(a.source)}>${nm.get(a.target)}|${a.kind}|${a.kind === "reset" ? "" : a.inscription.trim() || "1"}`).sort(),
          ft: (n.faultTree?.nodes ?? []).map((x) => `${x.name}|${x.type}|${x.k ?? ""}|${x.probability ?? ""}|${x.failureRate ?? ""}`).sort(),
          ftEdges: (n.faultTree?.edges ?? []).map((e) => `${nm.get(e.source)}>${nm.get(e.target)}`).sort(),
          constants: n.declarations.constants.map((c) => `${c.name}=${c.value}`),
        };
      };
      expect(sig(back), title).toEqual(sig(net));
    }
  });
});

describe("round trips of random nets", () => {
  const N = 60;
  it("native format keeps everything", () => {
    for (let s = 0; s < N; s++)
      for (const c of CLASSES) {
        const net = randomNet(s, c);
        expect(parseNet(serializeNet(net))).toEqual(net);
      }
  });

  it("PNML keeps everything", () => {
    for (let s = 0; s < N; s++)
      for (const c of CLASSES) {
        const net = randomNet(s, c);
        const back = importPnmlWithWarnings(exportPnml(net), parser);
        expect(back.warnings, `seed ${s} ${c}`).toEqual([]);
        expect(back.net, `seed ${s} ${c}`).toEqual(net);
      }
  });

  it("Snoopy keeps names, markings, arcs, rates and intervals", () => {
    for (let s = 0; s < N; s++)
      for (const c of CLASSES) {
        const net = randomNet(s, c);
        const xml = exportSnoopy(net);
        const back = importSnoopy(xml, parser).net;
        const ctx = `seed ${s} ${c}`;
        // Arc kinds the Snoopy class has no edge class for are dropped (with an export warning).
        const edgeClasses = new Set([...xml.matchAll(/<edgeclass count="\d+" name="([^"]+)"/g)].map((m) => m[1]));
        const EDGE: Record<string, string> = { normal: "Edge", read: "Read Edge", inhibitor: "Inhibitor Edge", reset: "Reset Edge", equal: "Equal Edge", modifier: "Modifier Edge" };
        net.arcs = net.arcs.filter((x) => edgeClasses.has(EDGE[x.kind]));
        expect(back.netClass, ctx).toBe(net.netClass === "pt" ? "pt" : net.netClass);
        expect(back.name, ctx).toBe(net.name);
        expect(back.declarations.constants.map((k) => [k.name, k.value]), ctx).toEqual(net.declarations.constants.map((k) => [k.name, k.value]));
        const byName = (n: Net) => new Map([...n.places, ...n.transitions].map((x) => [x.id, x.name]));
        const pm = (n: Net) => n.places.map((p) => [p.name, p.marking.trim() === "" ? "0" : p.marking, !!p.continuous && n.netClass === "hybrid"]).sort();
        expect(pm(back), ctx).toEqual(pm(net));
        const tm = (n: Net) => n.transitions.map((t) => [t.name, t.rate ?? "", t.interval ?? null, t.kind ?? defaultTransitionKind(n.netClass) ?? null]).sort();
        expect(tm(back), ctx).toEqual(tm(net));
        const am = (n: Net) => {
          const nm = byName(n);
          return n.arcs.map((x) => [nm.get(x.source), nm.get(x.target), x.kind, x.kind === "reset" ? "" : x.inscription]).sort();
        };
        expect(am(back).map((x) => (x[2] === "reset" ? [...x.slice(0, 3), ""] : x)), ctx).toEqual(am(net));
      }
  });

  it("ANDL keeps the behaviour (markings, arcs and rates) of nets it can write", () => {
    for (let s = 0; s < N; s++)
      for (const c of ["pt", "xpt", "stochastic", "continuous", "hybrid"] as NetClass[]) {
        const net = randomNet(s, c);
        if (net.places.some((p) => p.logical)) continue; // merged into one place
        let text: string;
        try {
          text = exportAndl(net);
        } catch {
          continue;
        }
        const back = importAndl(text).net;
        const ctx = `seed ${s} ${c}\n${text}`;
        expect(back.places.length, ctx).toBe(net.places.length);
        expect(back.transitions.length, ctx).toBe(net.transitions.length);
        // Compare by position: ANDL keeps the order of places and transitions within their groups
        // (discrete before continuous places; transitions grouped by kind).
        const KO = ["stochastic", "immediate", "deterministic", "scheduled", "continuous"];
        const ordered = <T extends { id: string }>(xs: T[], key: (x: T) => number) => xs.map((x, i) => ({ x, i })).sort((a, b) => key(a.x) - key(b.x) || a.i - b.i).map((e) => e.x);
        const pi = (n: Net) => new Map(ordered(n.places, (p) => (n.netClass === "hybrid" && p.continuous ? 1 : 0)).map((p, i) => [p.id, i]));
        const ti = (n: Net) => new Map(ordered(n.transitions, (t) => KO.indexOf(t.kind ?? "stochastic")).map((t, i) => [t.id, i]));
        const arcs = (n: Net) =>
          n.arcs
            .filter((x) => x.kind !== "modifier")
            .map((x) => {
              const P = pi(n);
              const T = ti(n);
              const src = P.has(x.source) ? `p${P.get(x.source)}` : `t${T.get(x.source)}`;
              const tgt = P.has(x.target) ? `p${P.get(x.target)}` : `t${T.get(x.target)}`;
              return `${src}>${tgt}:${x.kind}:${x.kind === "reset" ? "" : x.inscription}`;
            })
            .sort();
        expect(arcs(back), ctx).toEqual(arcs(net));
        const marks = (n: Net) => [...pi(n)].sort((a, b) => a[1] - b[1]).map(([id]) => Number(n.places.find((p) => p.id === id)!.marking || 0));
        expect(marks(back), ctx).toEqual(marks(net));
      }
  });
});

// ---------------------------------------------------------------------------------------------
// Differential checks: the one-way exporters against the core firing rule. For random nets, every
// reachable marking (bounded search) must enable the same transitions with the same successors in
// the exported model as in Donwinne.

type Vec = Record<string, number>;
interface RefTransition {
  name: string;
  enabled: (m: Vec) => boolean;
  next: (m: Vec) => Vec;
}

function parseLola(text: string): RefTransition[] {
  const out: RefTransition[] = [];
  const list = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => x.split(":").map((y) => y.trim()) as [string, string])
      .map(([p, n]) => [p, Number(n)] as const);
  for (const m of text.matchAll(/TRANSITION (\S+)\s+CONSUME([^;]*);\s+PRODUCE([^;]*);/g)) {
    const c = list(m[2]);
    const p = list(m[3]);
    out.push({
      name: m[1],
      enabled: (v) => c.every(([q, n]) => (v[q] ?? 0) >= n),
      next: (v) => {
        const w = { ...v };
        for (const [q, n] of c) w[q] = (w[q] ?? 0) - n;
        for (const [q, n] of p) w[q] = (w[q] ?? 0) + n;
        return w;
      },
    });
  }
  return out;
}

function parseTina(text: string): RefTransition[] {
  const out: RefTransition[] = [];
  for (const line of text.split("\n")) {
    const m = /^tr (\S+)(?: \[[^\]]*[\][])? ?(.*?) ?-> ?(.*)$/.exec(line);
    if (!m) continue;
    const pre = new Map<string, number>();
    const tests: [string, number][] = [];
    const inhib: [string, number][] = [];
    for (const tok of m[2].split(" ").filter(Boolean)) {
      let r: RegExpExecArray | null;
      if ((r = /^(\w+)\?-(\d+)$/.exec(tok))) inhib.push([r[1], Number(r[2])]);
      else if ((r = /^(\w+)\?(\d+)$/.exec(tok))) tests.push([r[1], Number(r[2])]);
      else if ((r = /^(\w+)\*(\d+)$/.exec(tok))) pre.set(r[1], (pre.get(r[1]) ?? 0) + Number(r[2]));
      else pre.set(tok, (pre.get(tok) ?? 0) + 1);
    }
    const post = new Map<string, number>();
    for (const tok of m[3].split(" ").filter(Boolean)) {
      const r = /^(\w+)(?:\*(\d+))?$/.exec(tok)!;
      post.set(r[1], (post.get(r[1]) ?? 0) + Number(r[2] ?? 1));
    }
    out.push({
      name: m[1],
      enabled: (v) =>
        [...pre].every(([q, n]) => (v[q] ?? 0) >= n) && tests.every(([q, n]) => (v[q] ?? 0) >= n) && inhib.every(([q, n]) => (v[q] ?? 0) < n),
      next: (v) => {
        const w = { ...v };
        for (const [q, n] of pre) w[q] = (w[q] ?? 0) - n;
        for (const [q, n] of post) w[q] = (w[q] ?? 0) + n;
        return w;
      },
    });
  }
  return out;
}

/** PRISM commands "[t] guard -> rate : updates;" evaluated with JavaScript (only the operators the exporter writes). */
function parsePrism(text: string): (RefTransition & { rate: (m: Vec) => number })[] {
  const consts: Vec = {};
  const js = (e: string) =>
    e
      .replace(/!=/g, "§")
      .replace(/([^<>=!])=([^=])/g, "$1===$2")
      .replace(/§/g, "!==")
      .replace(/&/g, "&&")
      .replace(/\|/g, "||")
      .replace(/\bpow\(/g, "Math.pow(")
      .replace(/\bmax\(/g, "Math.max(")
      .replace(/\bmin\(/g, "Math.min(")
      .replace(/\bfloor\(/g, "Math.floor(")
      .replace(/\bceil\(/g, "Math.ceil(")
      .replace(/\bround\(/g, "Math.round(")
      .replace(/\bmod\(/g, "((a,b)=>a%b)(")
      .replace(/\blog\(/g, "((x,b)=>Math.log(x)/Math.log(b))(");
  const evalIn = (e: string, v: Vec) => {
    const env = { ...consts, ...v };
    return Function(...Object.keys(env), `return (${js(e)});`)(...Object.values(env));
  };
  for (const m of text.matchAll(/^const (?:int|double|bool) (\w+) = (.+);$/gm)) consts[m[1]] = evalIn(m[2], {});
  const out: (RefTransition & { rate: (m: Vec) => number })[] = [];
  for (const m of text.matchAll(/^ {2}\[(\w+)\] (.*) -> (.*) : (.*);$/gm)) {
    const [, name, guard, rate, updates] = m;
    const ups = updates === "true" ? [] : [...updates.matchAll(/\((\w+)' = ([^)]*)\)/g)].map((u) => [u[1], u[2]] as const);
    out.push({
      name,
      enabled: (v) => !!evalIn(guard, v),
      rate: (v) => evalIn(rate, v),
      next: (v) => {
        const w = { ...v };
        for (const [q, e] of ups) w[q] = evalIn(e, v);
        return w;
      },
    });
  }
  return out;
}

/** Compares a reference semantics with the core firing rule over every marking reachable within `limit` states. */
function compareWithCore(net: Net, ref: RefTransition[], ctx: string, limit = 200, rename: (n: string) => string = (n) => n) {
  const cn = compile(net);
  if (cn.problems.some((p) => p.severity === "error")) return;
  const names = assignNames(net);
  const tName = new Map(cn.transitions.map((t, i) => [i, rename(names.transition.get(t.id)!)]));
  const slotName = new Map<number, string>();
  for (const p of cn.places) slotName.set(p.slot, rename(names.place.get(p.id)!));
  const toVec = (M: ReturnType<typeof initialMarking>): Vec => Object.fromEntries([...slotName].map(([s, n]) => [n, M[s].size]));
  const byName = new Map(ref.map((t) => [t.name, t]));
  const seen = new Set<string>();
  const queue = [initialMarking(cn)];
  while (queue.length && seen.size < limit) {
    const M = queue.shift()!;
    const key = JSON.stringify(toVec(M));
    if (seen.has(key)) continue;
    seen.add(key);
    const v = toVec(M);
    cn.transitions.forEach((_, i) => {
      const r = byName.get(tName.get(i)!);
      expect(r, `${ctx}: transition ${tName.get(i)} missing`).toBeDefined();
      const on = enabledBindings(cn, i, M).bindings.length > 0;
      expect(r!.enabled(v), `${ctx}: ${tName.get(i)} at ${key}`).toBe(on);
      if (on) {
        const next = fire(cn, i, {}, M);
        expect(r!.next(v), `${ctx}: ${tName.get(i)} from ${key}`).toEqual(toVec(next));
        if (Object.values(toVec(next)).every((x) => x <= 6)) queue.push(next);
      }
    });
  }
}

/** A deterministic coin per seed and arc, to sprinkle weight-0 test arcs. */
function r0(s: number, id: string): boolean {
  return (s * 31 + id.length * 7 + id.charCodeAt(id.length - 1)) % 11 === 0;
}

describe("one-way exporters behave like the net", () => {
  const N = 150;
  it("LoLA: a read arc next to a normal arc on the same place", () => {
    // p holds 2; t consumes 1 and reads 2. Donwinne enables t (2 >= 1 and 2 >= 2); LoLA must too.
    const net = emptyNet("xpt", "n");
    net.places = [{ id: "p", name: "p", x: 0, y: 0, marking: "2" }];
    net.transitions = [{ id: "t", name: "t", x: 0, y: 0 }];
    net.arcs = [
      { id: "a", source: "p", target: "t", kind: "normal", inscription: "1" },
      { id: "b", source: "p", target: "t", kind: "read", inscription: "2" },
    ];
    compareWithCore(net, parseLola(exportLola(net)), "lola");
  });

  it("LoLA agrees with the firing rule on random nets", () => {
    for (let s = 0; s < N; s++) {
      const net = randomNet(1000 + s, "xpt");
      net.arcs = net.arcs.filter((a) => a.kind === "normal" || a.kind === "read");
      net.declarations.constants = [];
      for (const a of net.arcs) if (a.inscription === "k") a.inscription = "2";
      compareWithCore(net, parseLola(exportLola(net)), `seed ${s}`);
    }
  });

  it("TINA agrees with the firing rule on random nets", () => {
    for (let s = 0; s < N; s++) {
      const net = randomNet(2000 + s, "xpt");
      net.arcs = net.arcs.filter((a) => a.kind !== "reset");
      for (const a of net.arcs) if (r0(s, a.id) && a.kind !== "normal") a.inscription = "0";
      const text = exportTina(net);
      compareWithCore(net, parseTina(text), `seed ${s}\n${text}`);
    }
  });

  it("PRISM agrees with the firing rule on random stochastic nets (with capacities)", () => {
    for (let s = 0; s < N; s++) {
      const net = randomNet(3000 + s, "stochastic");
      net.places.forEach((p, i) => {
        if (i % 2 === 0) p.capacity = 4;
      });
      for (const p of net.places) if (Number(p.marking) > 4) p.marking = "4";
      for (const a of net.arcs) if (r0(s, a.id) && a.kind !== "normal") a.inscription = "0";
      // Keyword renaming is checked on its own below; here "A" and "A_" would make "A__2".
      for (const x of [...net.places, ...net.transitions]) x.name = x.name.replace(/^A(_*)$/, "Q$1");
      const text = exportPrism(net);
      // Single-letter PRISM keywords get an underscore.
      compareWithCore(net, parsePrism(text), `seed ${s}\n${text}`, 200, (n) => (/^[ACEFGIPRSUWX]$/.test(n) ? `${n}_` : n));
    }
  });
});

/** S + I -> 2 I at MassAction(k), with a read arc from R: the SIR shape whose names PRISM reserves. */
function sir(netClass: NetClass = "stochastic"): Net {
  const net = emptyNet(netClass, "sir");
  net.declarations.constants = [{ name: "k", value: "0.5" }];
  net.places = [
    { id: "s", name: "S", x: 0, y: 0, marking: "3" },
    { id: "i", name: "I", x: 0, y: 0, marking: "2" },
    { id: "r", name: "R", x: 0, y: 0, marking: "4" },
  ];
  net.transitions = [{ id: "t", name: "infect", x: 0, y: 0, rate: "MassAction(k)" }];
  net.arcs = [
    { id: "1", source: "s", target: "t", kind: "normal", inscription: "2" },
    { id: "2", source: "i", target: "t", kind: "normal", inscription: "1" },
    { id: "3", source: "t", target: "i", kind: "normal", inscription: "2" },
    { id: "4", source: "r", target: "t", kind: "read", inscription: "2" },
  ];
  return net;
}

describe("rates in PRISM and SBML match the simulator", () => {
  it("PRISM MassAction includes read arcs, as the simulator does (k * C(S,2) * C(I,1) * C(R,2))", () => {
    const text = exportPrism(sir());
    const [cmd] = parsePrism(text);
    // 0.5 * 3 * 2 * 6 = 18
    expect(cmd.rate({ S_: 3, I_: 2, R_: 4 }), text).toBeCloseTo(18);
  });

  it("PRISM renames places that are PRISM keywords (S, I, R, P, E, ...)", () => {
    const text = exportPrism(sir());
    expect(text).not.toMatch(/^\s+[SIR] : /m);
    expect(text).toMatch(/^\s+S_ : \[0\.\.Max\] init 3;/m);
    expect(text).toMatch(/^\s+R_ : /m);
  });

  it("PRISM writes %, log, ln, log10 and abs with PRISM's own functions", () => {
    const net = sir();
    net.transitions[0].rate = "k * (S % 2) + log(I) + log10(R) + ln(2) + abs(1 - R)";
    const text = exportPrism(net);
    expect(text).not.toMatch(/%|\babs\(|\bln\(|\blog10\(/);
    expect(text).not.toMatch(/log\([^,()]*\)/);
    const [cmd] = parsePrism(text);
    const v = { S_: 3, I_: 2, R_: 4 };
    expect(cmd.rate(v)).toBeCloseTo(0.5 * 1 + Math.log(2) + Math.log10(4) + Math.log(2) + 3);
  });

  it("SBML MassAction includes read arcs (k * S^2 * I * R^2)", () => {
    const xml = exportSbml(sir("continuous")).replace(/\s+/g, "");
    expect(xml).toContain(
      "<apply><times/><ci>k</ci><apply><power/><ci>S</ci><cn>2</cn></apply><ci>I</ci><apply><power/><ci>R</ci><cn>2</cn></apply></apply>",
    );
  });
});

describe("CSV declarations", () => {
  it("lists a logical place even when an ordinary place has the same name", () => {
    const net = emptyNet("pt", "n");
    net.places = [
      { id: "a", name: "P", x: 0, y: 0, marking: "1" },
      { id: "b", name: "P", x: 0, y: 0, marking: "2", logical: true },
      { id: "c", name: "P", x: 0, y: 0, marking: "2", logical: true },
    ];
    expect(exportCsvDeclarations(net)).toContain("Place;Marking\nP;1\nP;2\n\n");
  });
});

describe("ANDL import of hand-written conditions", () => {
  it("reads [P <= n] as an inhibitor arc of weight n + 1", () => {
    const { net } = importAndl("pn [x] { places: P = 1; Q = 0; transitions: T : [P <= 2] & [Q <= k] : ; constants: all: int k = 1; }");
    const arcs = net.arcs.map((a) => [net.places.find((p) => p.id === a.source)?.name, a.kind, a.inscription]);
    expect(arcs).toEqual([
      ["P", "inhibitor", "3"],
      ["Q", "inhibitor", "k + 1"],
    ]);
  });
});

describe("SBML ids", () => {
  it("does not reuse the compartment's id for a place called compartment", () => {
    const net = sir("continuous");
    net.places[0].name = "compartment";
    const xml = exportSbml(net);
    const ids = [...xml.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBe(new Set(ids).size);
  });
});
