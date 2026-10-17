// LoLA 2 net format (https://theo.informatik.uni-rostock.de/theo-forschung/tools/lola/):
//
//   PLACE p1, p2;
//   MARKING p1 : 1;
//   TRANSITION t1
//     CONSUME p1 : 1;
//     PRODUCE p2 : 1;
//
// LoLA has only ordinary arcs. Read arcs are written as a consume/produce pair of the same weight,
// which has the same interleaving behaviour; inhibitor, reset and equal arcs cannot be written.
// Modifier arcs (stochastic nets) do not change the behaviour and are left out.

import { Net } from "@pns/core";
import { arcsOf, assignNames, evalCount, requireArcKinds, requireClass, weightOf } from "./text-common";

export function exportLola(net: Net): string {
  requireClass(net, "LoLA", ["pt", "xpt", "timed", "stochastic", "music"]);
  // Classic LoLA has only ordinary arcs (read arcs are rewritten below); inhibitor, reset and equal
  // arcs change the behaviour and cannot be written.
  requireArcKinds(net, "LoLA", ["normal", "read", "modifier"]);
  const names = assignNames(net);
  const lines: string[] = [];
  lines.push(`{ ${net.name.replace(/[{}]/g, "")} - exported by Donwinne }`);
  // Places, grouped by capacity (SAFE n:).
  const byCap = new Map<number | undefined, string[]>();
  for (const p of names.places) {
    const cap = p.capacity;
    byCap.set(cap, [...(byCap.get(cap) ?? []), names.place.get(p.id)!]);
  }
  if (!names.places.length) lines.push("PLACE ;");
  else {
    const groups = [...byCap].map(([cap, ps]) => (cap === undefined ? ps.join(", ") : `SAFE ${cap}: ${ps.join(", ")}`));
    lines.push(`PLACE ${groups.join("; ")};`);
  }
  const marked = names.places
    .map((p) => [names.place.get(p.id)!, evalCount(net, p.marking, `The marking of "${p.name}"`)] as const)
    .filter(([, m]) => m > 0);
  lines.push(`MARKING ${marked.map(([p, m]) => `${p} : ${m}`).join(", ")};`);
  const arcs = arcsOf(net, names);
  for (const t of names.transitions) {
    const { pre, post } = arcs.get(t.id)!;
    const consume = new Map<string, number>();
    const produce = new Map<string, number>();
    const add = (m: Map<string, number>, p: string, w: number) => m.set(p, (m.get(p) ?? 0) + w);
    for (const { place, arc } of pre) {
      const w = evalCount(net, weightOf(arc), `The weight of an arc of "${t.name}"`);
      add(consume, place, w);
      if (arc.kind === "read") add(produce, place, w);
    }
    for (const { place, arc } of post) add(produce, place, evalCount(net, weightOf(arc), `The weight of an arc of "${t.name}"`));
    const list = (m: Map<string, number>) => [...m].filter(([, w]) => w > 0).map(([p, w]) => `${p} : ${w}`).join(", ");
    lines.push(`TRANSITION ${names.transition.get(t.id)}`);
    lines.push(`  CONSUME ${list(consume)};`);
    lines.push(`  PRODUCE ${list(produce)};`);
  }
  return lines.join("\n") + "\n";
}
