import { Arc, ArcKind, Net, NetClass, Transition, emptyNet } from "@pns/core";

export type P = [name: string, marking: string, extra?: { continuous?: boolean; colourSet?: string; capacity?: number; fixed?: boolean }];
export type T = [name: string, extra?: Partial<Transition>];
export type A = [source: string, target: string, inscription?: string, kind?: ArcKind];

/** Small net builder: ids equal names. */
export function mk(netClass: NetClass, places: P[], transitions: T[], arcs: A[], constants: [string, string][] = []): Net {
  const net = emptyNet(netClass);
  net.places = places.map(([name, marking, extra]) => ({ id: name, name, x: 0, y: 0, marking, ...extra }));
  net.transitions = transitions.map(([name, extra]) => ({ id: name, name, x: 0, y: 0, ...extra }));
  net.arcs = arcs.map(([source, target, inscription, kind], i): Arc => ({ id: `a${i}`, source, target, inscription: inscription ?? "1", kind: kind ?? "normal" }));
  net.declarations.constants = constants.map(([name, value]) => ({ name, value }));
  return net;
}

export function series(trace: { series: { name: string; values: number[]; aggregate?: boolean }[] }, name: string, aggregate?: boolean) {
  const s = trace.series.find((x) => x.name === name && (aggregate === undefined || !!x.aggregate === aggregate));
  if (!s) throw new Error(`no series ${name}`);
  return s;
}
