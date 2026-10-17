// The colour-blind projection of a coloured (or ambient) net: the net Snoopy would run if the
// colours were ignored. Every place counts its tokens regardless of colour, every coloured
// transition becomes one uncoloured transition, and an arc's weight is the number of tokens it
// moves in one firing. Konios (2015) analyses the case studies this way in chapter 7: Charlie
// prints uncoloured markings (Figs 7.44-7.49), and any user can take any database token.

import { emptyNet, isColoured, type Net } from "@pns/core";
import { toPTNet, type PTArcKind } from "./ptnet";

export interface ProjectionOptions {
  /**
   * How capacities carry over. "none" (default): dropped, as Snoopy's P/T nets have none and the
   * total bound of Konios (2015, §4.5.1) is not part of the model. "sum": a place's capacity per
   * colour times the number of its colours.
   */
  capacities?: "none" | "sum";
}

export interface Projection {
  /** The uncoloured net (class "pt", or "xpt" when it keeps inhibitor, read or reset arcs). */
  net: Net;
  /** Things the projection had to decide, one sentence each. */
  notes: string[];
}

/**
 * Colour-blind projection of a coloured net: places keep their names and hold the total number of
 * tokens of their initial marking; each transition keeps its name; each arc gets the number of
 * tokens one firing moves along it (1 for an inscription such as `x`). Inhibitor arcs become plain
 * inhibitor arcs (the transition needs the place empty), so a colour-sensitive test "no token of
 * my colour" becomes "no token at all". Arcs whose weight differs between bindings take the largest
 * weight, with a note. Uncoloured nets are returned unchanged. Throws if the net has errors.
 */
export function colourBlindProjection(net: Net, opts: ProjectionOptions = {}): Projection {
  if (!isColoured(net.netClass) && net.netClass !== "apn" && net.netClass !== "tapn") return { net, notes: [] };
  const pt = toPTNet(net);
  if (pt.errors.length) throw new Error(`The net has errors: ${pt.errors[0]}`);
  const notes: string[] = [];
  if (net.netClass === "tapn")
    notes.push("A T-APN's complement places hold the complementary colours; projected, they count tokens of every colour together.");

  const out = emptyNet("pt", `${net.name} (colour-blind)`);
  out.comment = `Colour-blind projection of ${net.name}: token counts summed over colours, one transition per coloured transition.`;
  // Places by base name (logical places already share one slot in the P/T view).
  const placeOf = new Map<string, number>();
  const placeBase = pt.places.map((p) => p.baseName ?? p.name);
  const original = new Map(net.places.map((p) => [p.name, p]));
  const colours = new Map<string, number>();
  pt.places.forEach((p, i) => {
    const b = placeBase[i];
    colours.set(b, (colours.get(b) ?? 0) + 1);
    if (!placeOf.has(b)) {
      placeOf.set(b, out.places.length);
      const o = original.get(b);
      out.places.push({ id: o?.id ?? b, name: b, x: o?.x ?? 0, y: o?.y ?? 0, marking: "0", ...(o?.comment ? { comment: o.comment } : {}) });
    }
  });
  const totals = new Map<string, number>();
  pt.m0.forEach((v, i) => totals.set(placeBase[i], (totals.get(placeBase[i]) ?? 0) + v));
  for (const p of out.places) p.marking = String(totals.get(p.name) ?? 0);
  if (opts.capacities === "sum") {
    for (const p of out.places) {
      const o = original.get(p.name);
      if (o?.capacity !== undefined) p.capacity = o.capacity * (colours.get(p.name) ?? 1);
    }
  } else if (net.places.some((p) => p.capacity !== undefined)) notes.push("Capacities are dropped, as in an uncoloured Snoopy net.");

  // Transitions by base name; arcs from the bindings.
  const transOf = new Map<string, string>();
  const origT = new Map(net.transitions.map((t) => [t.name, t]));
  const bindings = new Map<string, number[]>();
  pt.transitions.forEach((t, i) => {
    const b = t.baseName ?? t.name;
    if (!bindings.has(b)) bindings.set(b, []);
    bindings.get(b)!.push(i);
  });
  for (const [b] of bindings) {
    const o = origT.get(b);
    const id = o?.id ?? b;
    transOf.set(b, id);
    out.transitions.push({ id, name: b, x: o?.x ?? 0, y: o?.y ?? 0, ...(o?.comment ? { comment: o.comment } : {}) });
  }
  for (const t of net.transitions)
    if (!bindings.has(t.name)) notes.push(`${t.name} has no binding (its guard is never true) and is left out.`);

  // Weight per (place, transition, kind, direction) for each binding.
  type Key = string;
  const weights = new Map<Key, number[]>();
  const perBinding = new Map<number, Map<Key, number>>();
  for (const a of pt.arcs) {
    const key = `${placeBase[a.place]}\u0000${pt.transitions[a.transition].baseName ?? pt.transitions[a.transition].name}\u0000${a.kind}\u0000${a.dir}`;
    if (a.weight === null) throw new Error(`Arc ${a.label} has a marking-dependent weight, which the colour-blind projection does not support.`);
    let m = perBinding.get(a.transition);
    if (!m) perBinding.set(a.transition, (m = new Map()));
    // Inhibitor and read arcs test a threshold: keep the largest; normal and reset arcs add up.
    const prev = m.get(key) ?? 0;
    m.set(key, a.kind === "normal" ? prev + a.weight : Math.max(prev, a.weight));
  }
  for (const ts of bindings.values())
    ts.forEach((t, j) => {
      for (const [k, w] of perBinding.get(t) ?? []) {
        if (!weights.has(k)) weights.set(k, Array(ts.length).fill(0));
        weights.get(k)![j] = w;
      }
    });
  let arcNo = 0;
  let extended = false;
  for (const [k, ws] of weights) {
    const [place, trans, kind, dir] = k.split("\u0000") as [string, string, PTArcKind, "in" | "out"];
    const max = Math.max(...ws);
    if (ws.some((w) => w !== max)) notes.push(`The ${kind} arc between ${place} and ${trans} moves different numbers of tokens in different bindings; the largest, ${max}, is used.`);
    const p = out.places[placeOf.get(place)!].id;
    const t = transOf.get(trans)!;
    const inscription = kind === "inhibitor" ? "1" : String(max);
    if (kind !== "normal") extended = true;
    if (kind === "equal") throw new Error(`The equal arc between ${place} and ${trans} has no colour-blind reading.`);
    out.arcs.push({ id: `cb${arcNo++}`, source: dir === "in" ? p : t, target: dir === "in" ? t : p, kind, inscription });
  }
  if (extended) out.netClass = "xpt";
  return { net: out, notes };
}
