// Snoopy's CSV export of declarations: semicolon-separated sections for place markings,
// transition functions and constants, each followed by a blank line.
//
//   Place;Marking
//   P;3
//
//   Transition;Main
//   T;MassAction(k)
//
//   Constant Class;Main
//   k;0.5

import { Net, isFaultTree, timeBase } from "@pns/core";
import { ExportError, realPlaces, realTransitions } from "./text-common";

function cell(s: string): string {
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsvDeclarations(net: Net): string {
  if (isFaultTree(net.netClass) || net.netClass === "freestyle")
    throw new ExportError("Only Petri nets have places, rates and constants to export as CSV.");
  const out: string[] = [];
  const seen = new Set<string>();
  const places = realPlaces(net).filter((p) => !(p.logical && seen.has(p.name)) && seen.add(p.name));
  out.push("Place;Marking", ...places.map((p) => `${cell(p.name || p.id)};${cell(p.marking.trim() || "0")}`), "");
  if (timeBase(net.netClass))
    out.push(
      "Transition;Main",
      ...realTransitions(net).map((t) => `${cell(t.name || t.id)};${cell(t.rate?.trim() || "")}`),
      "",
    );
  out.push("Constant Class;Main", ...net.declarations.constants.map((c) => `${cell(c.name)};${cell(c.value.trim())}`), "");
  return out.join("\n") + "\n";
}
