// Translation of fault trees into stochastic Petri nets.

import { Arc, ArcKind, Net, Place, Transition, emptyNet } from "@pns/core";
import { FTModel, buildModel, eventProbability } from "./structure";
import { layoutFaultTree } from "./layout";

/**
 * Translate a fault tree into an equivalent stochastic Petri net for the stochastic simulator.
 *
 * Every event and gate X gets two complementary places `X_ok` and `X_failed` (one token between
 * them), so the net is 1-safe and gates test their inputs with read arcs only:
 * - Basic events with a failure rate: stochastic transition `X_fail` (rate λ) from `X_ok` to
 *   `X_failed`, and `X_repair` (rate μ) back when there is a repair rate. Events with only a
 *   probability p start in `X_init` and immediately choose `X_failed` (weight p) or `X_ok` (1 − p).
 * - Gates: immediate transitions that move the gate's token to `X_failed` as soon as a
 *   failure condition of the gate holds (one transition per condition, e.g. per input of an OR),
 *   and back to `X_ok` as soon as a repair condition holds. Conditions are read from the inputs'
 *   `_ok`/`_failed` places. AND/INHIBIT/COND, OR, XOR (exactly one), NOT and k-of-n are exact.
 * - PAND: progress places `X_p0 … X_p(n−1)` record how many inputs failed in order; an input failing
 *   out of order moves the gate to `X_blocked`, which is left when all inputs are repaired.
 * - SPARE (cold): a place `X_use_U` per unit marks the unit in use; the unit's failure transition
 *   reads it, so dormant spares do not fail. When the unit in use fails, the first working unit
 *   is switched in.
 * - FDEP: each dependent event D is read through an OR node `D_eff` = D ∨ trigger.
 * The top event's state is in `<top>_failed`. Only nodes that influence the top event are
 * translated; constants are copied. The net is laid out top-down like the tree.
 */
export function faultTreeToPetriNet(net: Net): Net {
  const m = buildModel(net);
  const out = emptyNet("stochastic", `${net.name} (Petri net)`);
  out.declarations.constants = net.declarations.constants.map((c) => ({ ...c }));
  out.comment = `Translated from the fault tree ${net.name}. The top event has occurred when ${placeBase(m, m.top)}_failed is marked.`;

  // Positions from a widened tree layout.
  const fanout = Math.max(2, ...[...m.nodes.values()].map((n) => n.inputs.length + 1));
  const DX = Math.max(200, 50 * fanout);
  const DY = 260;
  const laid = layoutFaultTree(net, { dx: DX, dy: DY, x0: 120, y0: 80 });
  const ftPos = new Map(laid.faultTree!.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const posOf = (id: string) => {
    const n = m.nodes.get(id)!;
    const p = ftPos.get(n.source.id)!;
    return n.synthetic ? { x: p.x + DX / 2, y: p.y - DY / 2 } : p;
  };

  const usedNames = new Set(net.declarations.constants.map((c) => c.name));
  const unique = (base: string) => {
    let n = base;
    for (let i = 2; usedNames.has(n); i++) n = `${base}_${i}`;
    usedNames.add(n);
    return n;
  };
  let seq = 0;
  const addPlace = (name: string, x: number, y: number, marking: number): string => {
    const p: Place = { id: `p${++seq}`, name: unique(name), x, y, marking: String(marking) };
    out.places.push(p);
    return p.id;
  };
  const addTransition = (name: string, x: number, y: number, kind: "stochastic" | "immediate", rate: string): string => {
    const t: Transition = { id: `t${++seq}`, name: unique(name), x, y, kind, rate };
    out.transitions.push(t);
    return t.id;
  };
  const arc = (source: string, target: string, kind: ArcKind = "normal") => {
    const a: Arc = { id: `a${++seq}`, source, target, kind, inscription: "1" };
    out.arcs.push(a);
  };

  // Static value of every node with all basic events working: the gates' initial state.
  const init = new Map<string, boolean>();
  for (const id of m.order) {
    const n = m.nodes.get(id)!;
    const v = n.inputs.map((x) => init.get(x)!);
    const cnt = v.filter(Boolean).length;
    const val =
      n.kind === "basic"
        ? false
        : n.kind === "or"
          ? cnt > 0
          : n.kind === "and" || n.kind === "pand" || n.kind === "spare"
            ? cnt === v.length
            : n.kind === "xor"
              ? cnt === 1
              : n.kind === "not"
                ? !v[0]
                : cnt >= (n.k ?? 1);
    init.set(id, val);
  }

  const ok = new Map<string, string>();
  const bad = new Map<string, string>();
  const spareUse = new Map<string, string>(); // basic id -> use place of the spare gate controlling it

  // Places first (gates' spare use places must exist before basic event transitions).
  for (const id of m.order) {
    const { x, y } = posOf(id);
    const base = placeBase(m, id);
    const failedNow = init.get(id)!;
    ok.set(id, addPlace(`${base}_ok`, x + 30, y, failedNow ? 0 : 1));
    bad.set(id, addPlace(`${base}_failed`, x - 30, y, failedNow ? 1 : 0));
  }

  const row = (x: number, y: number, count: number, i: number) => ({ x: x + (i - (count - 1) / 2) * 45, y });
  /** One immediate transition per condition; a condition lists places that must be marked (read arcs). */
  const conditions = (id: string, name: string, conds: string[][], from: string, to: string, yOff: number, extra?: (t: string, i: number) => void) => {
    const { x, y } = posOf(id);
    conds.forEach((c, i) => {
      const p = row(x, y + yOff, conds.length, i);
      const t = addTransition(`${name}${conds.length > 1 ? `_${i + 1}` : ""}`, p.x, p.y, "immediate", "1");
      arc(from, t);
      arc(t, to);
      for (const r of c) arc(r, t, "read");
      extra?.(t, i);
    });
  };
  const subsets = <T,>(xs: T[], k: number): T[][] => {
    if (k === 0) return [[]];
    if (xs.length < k) return [];
    const [h, ...rest] = xs;
    return [...subsets(rest, k - 1).map((s) => [h, ...s]), ...subsets(rest, k)];
  };

  for (const id of m.order) {
    const n = m.nodes.get(id)!;
    if (n.kind !== "spare") continue;
    const { x, y } = posOf(id);
    n.units!.forEach((u, i) => {
      const p = addPlace(`${placeBase(m, id)}_use_${placeBase(m, u)}`, x + (i - (n.units!.length - 1) / 2) * 45, y + 70, i === 0 ? 1 : 0);
      spareUse.set(u, p);
    });
  }

  for (const id of m.order) {
    const n = m.nodes.get(id)!;
    const base = placeBase(m, id);
    const { x, y } = posOf(id);
    const O = ok.get(id)!;
    const F = bad.get(id)!;
    const iO = n.inputs.map((i) => ok.get(i)!);
    const iF = n.inputs.map((i) => bad.get(i)!);
    switch (n.kind) {
      case "basic": {
        const d = m.data.get(id)!;
        const src = n.source;
        if (d.failureRate !== undefined) {
          const t = addTransition(`${base}_fail`, x, y + 45, "stochastic", src.failureRate!.trim());
          arc(O, t);
          arc(t, F);
          if (spareUse.has(id)) arc(spareUse.get(id)!, t, "read");
          if (d.repairRate !== undefined && d.repairRate > 0) {
            const r = addTransition(`${base}_repair`, x, y - 45, "stochastic", src.repairRate!.trim());
            arc(F, r);
            arc(r, O);
          }
        } else {
          const p = eventProbability(d, undefined);
          if (p <= 0) break;
          // Start undecided: remove the ok token and choose.
          const okPlace = out.places.find((pl) => pl.id === O)!;
          okPlace.marking = "0";
          const I = addPlace(`${base}_init`, x, y + 45, 1);
          if (p >= 1) {
            const t = addTransition(`${base}_occurs`, x - 25, y + 90, "immediate", "1");
            arc(I, t);
            arc(t, F);
          } else {
            const t1 = addTransition(`${base}_occurs`, x - 25, y + 90, "immediate", src.probability!.trim());
            arc(I, t1);
            arc(t1, F);
            const t0 = addTransition(`${base}_not_occurs`, x + 25, y + 90, "immediate", `1 - (${src.probability!.trim()})`);
            arc(I, t0);
            arc(t0, O);
          }
        }
        break;
      }
      case "or":
        conditions(id, `${base}_fail`, iF.map((f) => [f]), O, F, 60);
        conditions(id, `${base}_restore`, [iO], F, O, 100);
        break;
      case "and":
        conditions(id, `${base}_fail`, [iF], O, F, 60);
        conditions(id, `${base}_restore`, iO.map((o) => [o]), F, O, 100);
        break;
      case "not":
        conditions(id, `${base}_fail`, [[iO[0]]], O, F, 60);
        conditions(id, `${base}_restore`, [[iF[0]]], F, O, 100);
        break;
      case "kofn": {
        const k = n.k ?? 1;
        const idx = n.inputs.map((_, i) => i);
        conditions(id, `${base}_fail`, subsets(idx, k).map((s) => s.map((i) => iF[i])), O, F, 60);
        conditions(id, `${base}_restore`, subsets(idx, n.inputs.length - k + 1).map((s) => s.map((i) => iO[i])), F, O, 100);
        break;
      }
      case "xor": {
        const idx = n.inputs.map((_, i) => i);
        conditions(id, `${base}_fail`, idx.map((i) => idx.map((j) => (i === j ? iF[j] : iO[j]))), O, F, 60);
        conditions(id, `${base}_restore`, [iO, ...subsets(idx, 2).map((s) => s.map((i) => iF[i]))], F, O, 100);
        break;
      }
      case "pand": {
        const k = n.inputs.length;
        const prog = Array.from({ length: k }, (_, j) => addPlace(`${base}_p${j}`, x + (j - (k - 1) / 2) * 45, y + 70, j === 0 ? 1 : 0));
        const blocked = addPlace(`${base}_blocked`, x + ((k + 1) / 2) * 45, y + 70, 0);
        for (let j = 0; j < k; j++) {
          // Input j fails next, in order.
          const t = addTransition(`${base}_step${j}`, x + (j - (k - 1) / 2) * 45, y + 110, "immediate", "1");
          arc(prog[j], t);
          arc(iF[j], t, "read");
          if (j + 1 < k) arc(t, prog[j + 1]);
          else {
            arc(O, t);
            arc(t, F);
          }
          // A later input fails first: out of order.
          for (let l = j + 1; l < k; l++) {
            const b = addTransition(`${base}_block${j}_${l}`, x + (l - (k - 1) / 2) * 45, y + 150, "immediate", "1");
            arc(prog[j], b);
            arc(iF[l], b, "read");
            arc(b, blocked);
          }
          // An input that had failed in order is repaired: fall back.
          for (let i = 0; i < j; i++) {
            const r = addTransition(`${base}_back${j}_${i}`, x + (i - (k - 1) / 2) * 45, y + 190, "immediate", "1");
            arc(prog[j], r);
            arc(iO[i], r, "read");
            arc(r, prog[i]);
          }
        }
        // Failed gate: any repair falls back to the progress of the inputs still failed in order.
        for (let i = 0; i < k; i++) {
          const r = addTransition(`${base}_restore_${i + 1}`, x + (i - (k - 1) / 2) * 45, y - 60, "immediate", "1");
          arc(F, r);
          arc(iO[i], r, "read");
          arc(r, O);
          arc(r, prog[i]);
        }
        const u = addTransition(`${base}_unblock`, x + ((k + 1) / 2) * 45, y + 110, "immediate", "1");
        arc(blocked, u);
        for (const o of iO) arc(o, u, "read");
        arc(u, prog[0]);
        break;
      }
      case "spare": {
        const us = n.units!;
        // Switch from unit a (failed) to the first working unit b.
        us.forEach((a, ia) => {
          us.forEach((b, ib) => {
            if (a === b) return;
            const t = addTransition(`${base}_switch_${placeBase(m, a)}_${placeBase(m, b)}`, x + (ib - (us.length - 1) / 2) * 45, y + 110 + ia * 30, "immediate", "1");
            arc(spareUse.get(a)!, t);
            arc(t, spareUse.get(b)!);
            arc(iF[ia], t, "read");
            arc(iO[ib], t, "read");
            for (let j = 0; j < ib; j++) if (j !== ia) arc(iF[j], t, "read");
          });
        });
        conditions(id, `${base}_fail`, [iF], O, F, 60);
        conditions(id, `${base}_restore`, iO.map((o) => [o]), F, O, -60);
        break;
      }
    }
  }
  return out;
}

function placeBase(m: FTModel, id: string): string {
  const n = m.nodes.get(id)!;
  const name = (n.source.name || n.source.id).replace(/[^A-Za-z0-9_]/g, "_");
  const safe = /^[A-Za-z_]/.test(name) ? name : `E_${name}`;
  return n.synthetic ? `${safe}_eff` : safe;
}
