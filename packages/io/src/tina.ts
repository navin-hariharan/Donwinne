// TINA .net format (https://projects.laas.fr/tina/manuals/formats.html):
//
//   net name
//   tr t1 [0,w[ p1*2 p3?1 p4?-1 -> p2
//   pl p1 (3)
//
// Input arcs of a transition (from the format grammar): p*n ordinary, p?n test (our read arc),
// p?-n inhibitor, p!n / p!-n stopwatch arcs (no counterpart here). Time intervals of timed nets become
// TINA's static intervals ("w[" for infinity).
//
// Equal arcs (enabled iff M(p) = n) are written as a test arc p?n plus an inhibitor arc p?-(n+1).
// UNVERIFIED: that TINA accepts the same place twice in one transition's input list for a test and an
// inhibitor arc (the grammar allows a list of inputs; we have not run TINA on such a file).
// Reset arcs have no TINA counterpart and are refused. Modifier arcs (stochastic nets) do not change
// the behaviour and are left out.

import { Net } from "@pns/core";
import { ExportError, arcsOf, assignNames, describeArc, evalCount, evalNumber, fmtNumber, requireArcKinds, requireClass, weightOf } from "./text-common";

const INF = /^(inf|infinity|oo|w|∞)$/i;

function name(s: string): string {
  return /^[A-Za-z_][A-Za-z0-9_']*$/.test(s) ? s : `{${s.replace(/[{}\\]/g, (c) => "\\" + c)}}`;
}

export function exportTina(net: Net): string {
  requireClass(net, "TINA", ["pt", "xpt", "timed", "stochastic", "music"]);
  requireArcKinds(net, "TINA", ["normal", "read", "inhibitor", "equal", "modifier"]);
  const names = assignNames(net);
  const lines: string[] = [`net ${name(net.name.trim() || "net")}`];
  const arcs = arcsOf(net, names);
  for (const t of names.transitions) {
    const { pre, post } = arcs.get(t.id)!;
    let interval = "";
    if (net.netClass === "timed" && t.interval) {
      const [lo, hi] = t.interval;
      const eft = evalNumber(net, lo, `The earliest firing time of "${t.name}"`);
      if (eft < 0) throw new ExportError(`The earliest firing time of "${t.name}" is negative.`);
      if (INF.test(hi.trim())) interval = eft === 0 ? "" : ` [${fmtNumber(eft)},w[`;
      else {
        const lft = evalNumber(net, hi, `The latest firing time of "${t.name}"`);
        if (lft < eft) throw new ExportError(`The firing interval of "${t.name}" ends before it starts.`);
        interval = ` [${fmtNumber(eft)},${fmtNumber(lft)}]`;
      }
    }
    const w = (a: (typeof pre)[number]) => evalCount(net, weightOf(a.arc), `The weight of an arc of "${t.name}"`);
    const inputs = pre.flatMap((e) => {
      const n = w(e);
      const p = name(e.place);
      switch (e.arc.kind) {
        case "read":
          return n > 0 ? [`${p}?${n}`] : [];
        case "inhibitor":
          if (n < 1) throw new ExportError(`The inhibitor arc ${describeArc(net, e.arc)} has weight ${n}; it can never be satisfied.`);
          return [`${p}?-${n}`];
        case "equal":
          return n > 0 ? [`${p}?${n}`, `${p}?-${n + 1}`] : [`${p}?-1`];
        default:
          return n === 1 ? [p] : n === 0 ? [] : [`${p}*${n}`];
      }
    });
    const outputs = post.map((e) => (w(e) === 1 ? name(e.place) : `${name(e.place)}*${w(e)}`));
    lines.push(`tr ${name(names.transition.get(t.id)!)}${interval} ${inputs.join(" ")} -> ${outputs.join(" ")}`.replace(/ {2,}/g, " ").trimEnd());
  }
  for (const p of names.places) {
    const m = evalCount(net, p.marking, `The marking of "${p.name}"`);
    lines.push(`pl ${name(names.place.get(p.id)!)}${m ? ` (${m})` : ""}`);
  }
  return lines.join("\n") + "\n";
}
