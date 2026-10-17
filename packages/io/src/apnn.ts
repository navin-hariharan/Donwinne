// APNN (Abstract Petri Net Notation, APNN toolbox / Snoopy's APNN export):
//
//   \beginnet{name}
//   \const{\type{double}\name{k}\value{0.5}}
//   \place{P_0}{\name{P} \init{3}}
//   \transition{T_0}{\name{T} \function{MassAction(k)}}
//   \arc{A_0}{\from{P_0} \to{T_0} \weight{1} \type{ordinary}}
//   \endnet
//
// Layout follows Snoopy's APNN exporter (sp_core/export/SP_ExportAPNN.cpp).

import { ArcKind, Net } from "@pns/core";
import { ExportError, arcsOf, assignNames, evalCount, parseInlined, printExpr, requireClass, weightOf } from "./text-common";

// Modifier arcs have no APNN counterpart and are left out (they do not change the behaviour).
const ARC_TYPES: Record<Exclude<ArcKind, "modifier">, string> = {
  normal: "ordinary",
  read: "readarc",
  inhibitor: "inhibitor",
  reset: "resetarc",
  equal: "equalarc",
};

function esc(s: string): string {
  return s.replace(/[{}\\]/g, (c) => "\\" + c);
}

export function exportApnn(net: Net): string {
  requireClass(net, "APNN", ["pt", "xpt", "stochastic", "timed", "music"]);
  const names = assignNames(net);
  const quantitative = net.netClass === "stochastic";
  if (quantitative && net.transitions.some((t) => t.kind && t.kind !== "stochastic"))
    throw new ExportError("APNN only has stochastic transitions; immediate, deterministic and scheduled transitions cannot be exported.");
  const lines: string[] = [`\\beginnet{${esc(net.name)}}`];
  for (const c of net.declarations.constants) {
    const type = /^[+-]?\d+$/.test(c.value.trim()) ? "integer" : "double";
    lines.push(`\\const{\\type{${type}}\\name{${esc(names.constant.get(c.name)!)}}\\value{${esc(c.value.trim())}}}`);
  }
  const pid = new Map<string, string>();
  names.places.forEach((p, i) => {
    const id = `P_${i}`;
    pid.set(names.place.get(p.id)!, id);
    const m = evalCount(net, p.marking, `The marking of "${p.name}"`);
    const cap = p.capacity !== undefined ? ` \\capacity{${p.capacity}}` : "";
    lines.push(`\\place{${id}}{\\name{${esc(names.place.get(p.id)!)}} \\init{${m}}${cap}}`);
  });
  const arcs = arcsOf(net, names);
  let n = 0;
  const arcLines: string[] = [];
  names.transitions.forEach((t, i) => {
    const id = `T_${i}`;
    const rate = t.rate?.trim() || "MassAction(1)";
    // APNN has no user functions: their calls are expanded in place.
    const rateText = net.declarations.functions?.length
      ? printExpr(parseInlined(net, rate, `The rate of "${t.name}"`), { and: "&", or: "|", not: "!", eq: "=", ne: "<>" })
      : rate;
    const fn = quantitative ? ` \\function{${esc(rateText)}}` : "";
    lines.push(`\\transition{${id}}{\\name{${esc(names.transition.get(t.id)!)}}${fn}}`);
    const { pre, post } = arcs.get(t.id)!;
    for (const { place, arc } of pre) {
      const w = arc.kind === "reset" ? 1 : evalCount(net, weightOf(arc), `The weight of an arc of "${t.name}"`);
      arcLines.push(`\\arc{A_${n++}}{\\from{${pid.get(place)}} \\to{${id}} \\weight{${w}} \\type{${ARC_TYPES[arc.kind as Exclude<ArcKind, "modifier">]}}}`);
    }
    for (const { place, arc } of post) {
      const w = evalCount(net, weightOf(arc), `The weight of an arc of "${t.name}"`);
      arcLines.push(`\\arc{A_${n++}}{\\from{${id}} \\to{${pid.get(place)}} \\weight{${w}} \\type{ordinary}}`);
    }
  });
  lines.push(...arcLines, "\\endnet");
  return lines.join("\n") + "\n";
}
