// Minimal semi-positive invariants by the Farkas algorithm with Martinez–Silva minimal-support
// pruning: rows whose support contains another row's support are dropped at every step.

import { checkAbort, structuralMatrices, type PTNet } from "./ptnet";
import type { IncidenceMatrix, Invariant, InvariantResults, InvariantSet, NodeRef } from "./types";

interface Row {
  /** Remaining constraint values (columns not yet eliminated). */
  c: number[];
  /** Invariant coefficients. */
  y: number[];
  sup: bigint;
  size: number;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

function normalise(r: Row): Row {
  let g = 0;
  for (const v of r.y) if (v) g = gcd(g, v);
  for (const v of r.c) if (v) g = gcd(g, v);
  if (g > 1) {
    r.y = r.y.map((v) => v / g);
    r.c = r.c.map((v) => v / g);
  }
  return r;
}

export interface FarkasOptions {
  /** Stop when more rows than this are alive (default 20000). */
  maxRows?: number;
  signal?: AbortSignal;
}

export class InvariantOverflow extends Error {}

/**
 * All minimal-support semi-positive integer vectors y (one per support, gcd 1) with y·A = 0, where
 * A has one row per item (places for P-invariants) and one column per constraint (transitions).
 */
export function minimalInvariants(A: number[][], cols: number, opts: FarkasOptions = {}): { vectors: number[][]; truncated: boolean } {
  const maxRows = opts.maxRows ?? 20_000;
  const n = A.length;
  let rows: Row[] = A.map((c, i) => {
    const y = new Array<number>(n).fill(0);
    y[i] = 1;
    return { c: c.slice(), y, sup: 1n << BigInt(i), size: 1 };
  });
  const remaining = new Set<number>(Array.from({ length: cols }, (_, j) => j));
  let truncated = false;

  while (remaining.size) {
    checkAbort(opts.signal);
    // Eliminate the column that adds the fewest rows.
    let best = -1;
    let bestCost = Infinity;
    for (const j of remaining) {
      let pos = 0;
      let neg = 0;
      for (const r of rows) {
        if (r.c[j] > 0) pos++;
        else if (r.c[j] < 0) neg++;
      }
      const cost = pos * neg - pos - neg;
      if (cost < bestCost) {
        bestCost = cost;
        best = j;
      }
    }
    const j = best;
    remaining.delete(j);
    const keep: Row[] = [];
    const pos: Row[] = [];
    const neg: Row[] = [];
    for (const r of rows) {
      if (r.c[j] === 0) keep.push(r);
      else (r.c[j] > 0 ? pos : neg).push(r);
    }
    const fresh: Row[] = [];
    for (const p of pos) {
      for (const q of neg) {
        const sup = p.sup | q.sup;
        let dominated = false;
        for (const k of keep)
          if (k.sup !== sup && (k.sup & sup) === k.sup) {
            dominated = true;
            break;
          }
        if (dominated) continue;
        const a = p.c[j];
        const b = -q.c[j];
        const y = p.y.map((v, i) => b * v + a * q.y[i]);
        const c = p.c.map((v, i) => b * v + a * q.c[i]);
        let size = 0;
        for (const v of y) {
          if (!Number.isSafeInteger(v)) throw new InvariantOverflow("Invariant coefficients grew too large");
          if (v) size++;
        }
        c[j] = 0;
        fresh.push(normalise({ c, y, sup, size }));
        if (fresh.length + keep.length > maxRows * 4) {
          truncated = true;
          break;
        }
      }
      if (truncated) break;
    }
    rows = minimalRows([...keep, ...fresh]);
    if (rows.length > maxRows) {
      truncated = true;
      rows = rows.slice(0, maxRows);
    }
    if (truncated) break;
  }
  if (truncated) rows = rows.filter((r) => r.c.every((v) => v === 0));
  return { vectors: rows.map((r) => r.y), truncated };
}

/** Drop rows whose support strictly contains another row's support, and exact duplicates. */
function minimalRows(rows: Row[]): Row[] {
  rows.sort((a, b) => a.size - b.size);
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    let dominated = false;
    for (const o of out) {
      if (o.size >= r.size) break;
      if ((o.sup & r.sup) === o.sup) {
        dominated = true;
        break;
      }
    }
    if (dominated) continue;
    const key = r.y.join(",") + "|" + r.c.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export function incidenceMatrix(pt: PTNet): IncidenceMatrix {
  const { pre, post, ignoredArcs } = structuralMatrices(pt);
  return {
    placeIds: pt.places.map((p) => p.id),
    transitionIds: pt.transitions.map((t) => t.id),
    rows: pre.map((row, p) => row.map((v, t) => post[p][t] - v)),
    ignoredArcs,
  };
}

function fmt(nodes: NodeRef[], y: number[]): string {
  const parts: string[] = [];
  y.forEach((v, i) => {
    if (v) parts.push(v === 1 ? nodes[i].name : `${v}·${nodes[i].name}`);
  });
  return parts.join(" + ");
}

function toSet(kind: "P" | "T", nodes: NodeRef[], vectors: number[][], truncated: boolean, m0?: number[]): InvariantSet {
  const covered = new Array<boolean>(nodes.length).fill(false);
  const invariants: Invariant[] = vectors.map((y) => {
    const weights: Record<string, number> = {};
    const support: NodeRef[] = [];
    let tokenSum = 0;
    y.forEach((v, i) => {
      if (!v) return;
      weights[nodes[i].id] = v;
      support.push(nodes[i]);
      covered[i] = true;
      if (m0) tokenSum += v * m0[i];
    });
    return { weights, support, text: fmt(nodes, y), ...(m0 ? { tokenSum } : {}) };
  });
  const uncovered = nodes.filter((_, i) => !covered[i]);
  return { kind, invariants, truncated, covered: nodes.length > 0 && uncovered.length === 0, uncovered };
}

/** Minimal semi-positive P- and T-invariants of the structural net. */
export function computeInvariants(pt: PTNet, opts: FarkasOptions = {}, incidence = incidenceMatrix(pt)): InvariantResults {
  const C = incidence.rows;
  const n = pt.places.length;
  const m = pt.transitions.length;
  const run = (A: number[][], cols: number, what: string) => {
    try {
      return minimalInvariants(A, cols, opts);
    } catch (e) {
      if (e instanceof InvariantOverflow) {
        pt.warnings.push(`${what}-invariants: ${e.message}; the list is incomplete.`);
        return { vectors: [], truncated: true };
      }
      throw e;
    }
  };
  const pr = run(C, m, "P");
  const CT = Array.from({ length: m }, (_, t) => Array.from({ length: n }, (_, p) => C[p][t]));
  const tr = run(CT, n, "T");
  if (pr.truncated) pt.warnings.push("P-invariant computation hit its size limit; the list is incomplete.");
  if (tr.truncated) pt.warnings.push("T-invariant computation hit its size limit; the list is incomplete.");
  const p = toSet("P", pt.places, pr.vectors, pr.truncated, pt.m0);
  const t = toSet("T", pt.transitions, tr.vectors, tr.truncated);
  return { p, t, cpi: p.covered, cti: t.covered, conservative: p.covered, consistent: t.covered };
}
