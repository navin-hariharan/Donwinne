// The token trail of the token game: the transitions that fired, the arcs the tokens moved along
// and the places they passed through, so that the route of the tokens through a large net can be
// followed (and a mistake that stops it found). Derived from the token game's history.

import type { Net } from "@pns/core";
import type { SimStep } from "./store";

export interface Trail {
  /** Element id → strength between 0 and 1: 1 for the latest firing, fading for older ones. */
  strength: Map<string, number>;
  /** Number of firings (or steps) the trail covers. */
  firings: number;
}

/** Firings after which an element of the trail has faded to its weakest. */
const FADE_OVER = 25;
/** The weakest an element of the trail gets, so the whole route stays visible. */
const MIN_STRENGTH = 0.35;

/**
 * The trail of the history `sim[from + 1 .. upTo]`. With `full`, every element is drawn at full
 * strength (used when the net is dead, so the whole route to the deadlock stands out). Elements
 * inside subnets also mark the coarse nodes that contain them, so the trail can be followed from
 * the top page down.
 */
export function tokenTrail(net: Net, sim: readonly SimStep[], from: number, upTo: number, full = false): Trail {
  const strength = new Map<string, number>();
  const arcsOf = new Map<string, Net["arcs"]>();
  for (const a of net.arcs) {
    for (const end of [a.source, a.target]) {
      let l = arcsOf.get(end);
      if (!l) arcsOf.set(end, (l = []));
      l.push(a);
    }
  }
  const parentOf = new Map<string, string | undefined>();
  for (const n of [...net.places, ...net.transitions]) parentOf.set(n.id, n.parent);
  const transitionIds = new Set(net.transitions.map((t) => t.id));

  const mark = (id: string, s: number) => {
    // Up the subnet hierarchy as well; a cycle guard keeps a broken hierarchy from looping.
    for (let cur: string | undefined = id, n = 0; cur && n < 64; cur = parentOf.get(cur), n++) {
      if ((strength.get(cur) ?? 0) < s) strength.set(cur, s);
    }
  };

  let firings = 0;
  const last = Math.min(upTo, sim.length - 1);
  for (let k = Math.max(0, from) + 1; k <= last; k++) {
    const step = sim[k];
    const fired = step.transitionIds ?? (step.transitionId ? [step.transitionId] : []);
    if (!fired.length) continue; // a timed wait moves no tokens
    firings++;
    const s = full ? 1 : Math.max(MIN_STRENGTH, 1 - ((last - k) / FADE_OVER) * (1 - MIN_STRENGTH));
    for (const t of fired) {
      if (!transitionIds.has(t)) continue;
      mark(t, s);
      for (const a of arcsOf.get(t) ?? []) {
        // Tokens travel along arcs that take them away or bring them; read, inhibitor, equal and
        // modifier arcs only look at a place.
        const moves = a.target === t ? a.kind === "normal" || a.kind === "reset" : a.kind !== "modifier";
        if (!moves) continue;
        mark(a.id, s);
        mark(a.target === t ? a.source : a.target, s);
      }
    }
  }
  return { strength, firings };
}
