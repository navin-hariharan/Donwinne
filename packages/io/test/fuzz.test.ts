// Robustness: damaged files must never crash an importer. Each import either returns a net that the
// rest of Donwinne can work with, or throws an Error with a message for the user. A TypeError,
// RangeError or a hang is a bug. Set FUZZ_N for a longer run (the default keeps the suite quick).
import { readdirSync, readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import type { Net } from "@pns/core";
import { analyseNet } from "@pns/analysis";
import { exportAndl, exportCandl, exportPnml, exportSnoopy, importAndl, importPnml, importSnoopy, parseNet, serializeNet } from "../src";
import { importDnf } from "../../ft/src/dnf";
import { EXAMPLES } from "../../editor/src/examples";

const N = Number(process.env.FUZZ_N ?? 150);
const parser = new DOMParser({ onError: () => {} });
const SAMPLES = `${__dirname}/samples`;

/** Small deterministic PRNG (mulberry32), so a failure can be replayed. */
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

const NASTY = ["", "-1", "0", "1e309", "-1e309", "NaN", "999999999999", "1.5", "\u0000", "<", ">", "&amp;", '"', "'", "]]>", "{", "}", "[", "]", "__proto__", "constructor", "∞", "x".repeat(300), "(", ")", ";", ",", "`", "\n", "p[", "t<"];

/** One random edit: cut, duplicate or replace a slice, swap a number, or drop in a nasty token. */
function mutate(src: string, r: () => number): string {
  const at = () => Math.floor(r() * (src.length + 1));
  switch (Math.floor(r() * 6)) {
    case 0: {
      const i = at();
      return src.slice(0, i) + src.slice(Math.min(src.length, i + 1 + Math.floor(r() * 40)));
    }
    case 1: {
      const i = at();
      const j = Math.min(src.length, i + Math.floor(r() * 80));
      return src.slice(0, j) + src.slice(i, j) + src.slice(j);
    }
    case 2: {
      const nums = [...src.matchAll(/-?\d+(\.\d+)?/g)];
      if (!nums.length) return src;
      const m = nums[Math.floor(r() * nums.length)];
      return src.slice(0, m.index) + NASTY[Math.floor(r() * 8)] + src.slice(m.index! + m[0].length);
    }
    case 3: {
      const i = at();
      return src.slice(0, i) + NASTY[Math.floor(r() * NASTY.length)] + src.slice(i);
    }
    case 4:
      return src.slice(0, at());
    default: {
      const strs = [...src.matchAll(/"[^"\n]{0,40}"/g)];
      if (!strs.length) return src;
      const m = strs[Math.floor(r() * strs.length)];
      return src.slice(0, m.index) + JSON.stringify(NASTY[Math.floor(r() * NASTY.length)]) + src.slice(m.index! + m[0].length);
    }
  }
}

/** What a user does with an opened net: analyse it and save it again. None of this may crash. */
function useNet(net: Net) {
  analyseNet(net, { maxStates: 300 });
  expect(parseNet(serializeNet(net)).places.length).toBe(net.places.length);
}

function crashes(fn: () => void): string | null {
  const t = Date.now();
  try {
    fn();
  } catch (e) {
    if (!(e instanceof Error) || e instanceof TypeError || e instanceof RangeError || e instanceof ReferenceError || !e.message) return `${(e as Error)?.name}: ${(e as Error)?.message}\n${(e as Error)?.stack?.split("\n").slice(1, 4).join("\n")}`;
  }
  const ms = Date.now() - t;
  return ms > 5000 ? `took ${ms} ms` : null;
}

function fuzz(name: string, seeds: string[], load: (text: string) => Net | null) {
  it(`${name}: damaged files load or fail with a message`, () => {
    const failures: string[] = [];
    const r = rng(name.length * 7919);
    for (let i = 0; i < N && failures.length < 5; i++) {
      let text = seeds[i % seeds.length];
      const edits = 1 + Math.floor(r() * 4);
      for (let k = 0; k < edits; k++) text = mutate(text, r);
      const err = crashes(() => {
        const net = load(text);
        if (net) useNet(net);
      });
      if (err) failures.push(`#${i}: ${err}\n--- input (first 300 chars) ---\n${text.slice(0, 300)}`);
    }
    expect(failures).toEqual([]);
  }, 600_000);
}

const nets = EXAMPLES.map((e) => e.net);
const sample = (ext: RegExp) => readdirSync(SAMPLES).filter((f) => ext.test(f)).map((f) => readFileSync(`${SAMPLES}/${f}`, "utf8"));

describe("importers survive damaged files", () => {
  fuzz("native", nets.map(serializeNet), (t) => parseNet(t));
  fuzz("PNML", nets.map((n) => { try { return exportPnml(n); } catch { return ""; } }).filter(Boolean), (t) => importPnml(t, parser));
  fuzz(
    "Snoopy",
    [...sample(/\.(spept|pn|xpn|spn|cpn|hpn|colpn|colspn|colcpn|colhpn|fpn|fspn|fcpn|fhpn|sppn|tpn)$/), ...nets.map((n) => { try { return exportSnoopy(n); } catch { return ""; } }).filter(Boolean)],
    (t) => importSnoopy(t, parser).net,
  );
  fuzz("ANDL and CANDL", nets.flatMap((n) => [() => exportAndl(n), () => exportCandl(n)]).map((f) => { try { return f(); } catch { return ""; } }).filter(Boolean), (t) => importAndl(t).net);
  fuzz("DNF fault trees", ["T = a & b | c", "TOP = (x1 & x2) | (x2 & x3) | x4", "a | b & c"], (t) => importDnf(t));
});
