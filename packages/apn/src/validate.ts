// Problem checks for APNs and T-APNs, as shown in the editor's Problems tab.

import { Net, Problem, compile, isAmbient } from "@pns/core";
import { classifyStepNet } from "./construction";

export interface ValidateOptions {
  /**
   * Also check that an APN is a composite step net (Def. 13), the class the construction φ and
   * Theorem 1 are stated for. Its findings are warnings. Default false.
   */
  compositeStepNet?: boolean;
}

/**
 * The problems of an APN or T-APN: everything compile() reports, which for these classes includes
 * arcs that are not weight 1 per colour, transitions without a single mode variable, an inhibitor
 * arc next to a directed arc between the same place and transition (Def. 3), markings above the
 * capacity per colour (1 unless set) and the complementary colour sets of T-APNs (Def. 20).
 * Optionally adds warnings where an APN departs from the composite step net structure.
 */
export function validateAmbient(net: Net, opts: ValidateOptions = {}): Problem[] {
  const out = [...compile(net).problems];
  if (!isAmbient(net.netClass)) out.push({ severity: "warning", message: "This is not an APN or T-APN; switch the net class to check the ambient rules" });
  if (opts.compositeStepNet && net.netClass === "apn") {
    const ids = new Map([...net.places, ...net.transitions].map((n) => [n.name, n.id]));
    for (const m of classifyStepNet(net).problems) {
      const named = /^(?:\w+ )*?(?:place|transition) (\S+)/i.exec(m);
      out.push({ severity: "warning", message: m, elementId: named ? ids.get(named[1]) : undefined });
    }
  }
  return out;
}
