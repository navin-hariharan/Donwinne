// Exact linear algebra over the rationals with bigint arithmetic: matrix rank and a small
// fraction-free (integer-preserving) simplex for linear programs. Used by the structural
// (matrix-based) analyses, the state equation and the behavioural checks on coverability graphs.
// Everything is bounded: problems above the size or pivot limits return "limit", never a guess.

import { checkAbort } from "./ptnet";

const abs = (a: bigint) => (a < 0n ? -a : a);

export function gcdBig(a: bigint, b: bigint): bigint {
  a = abs(a);
  b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Rank of an integer matrix: exact (fraction-free Gaussian elimination) up to `maxCells` entries, else modulo three primes. */
export function rank(A: number[][], cols: number, maxCells = 90_000): { rank: number; exact: boolean } {
  const rows = A.length;
  if (!rows || !cols) return { rank: 0, exact: true };
  if (rows * cols <= maxCells) return { rank: rankExact(A, cols), exact: true };
  // Rank modulo p never exceeds the rational rank and equals it for all but finitely many primes.
  let r = 0;
  for (const p of [67_108_859, 67_108_837, 67_108_819]) r = Math.max(r, rankModP(A, cols, p));
  return { rank: r, exact: false };
}

function rankExact(A: number[][], cols: number): number {
  const M = A.map((row) => row.map((v) => BigInt(v)));
  const rows = M.length;
  let r = 0;
  let prev = 1n;
  for (let c = 0; c < cols && r < rows; c++) {
    let piv = -1;
    for (let i = r; i < rows; i++)
      if (M[i][c] !== 0n) {
        piv = i;
        break;
      }
    if (piv < 0) continue;
    [M[r], M[piv]] = [M[piv], M[r]];
    const p = M[r][c];
    for (let i = r + 1; i < rows; i++) {
      const f = M[i][c];
      const row = M[i];
      const pr = M[r];
      for (let j = c; j < cols; j++) row[j] = (row[j] * p - f * pr[j]) / prev;
    }
    prev = p;
    r++;
  }
  return r;
}

function rankModP(A: number[][], cols: number, p: number): number {
  const mod = (v: number) => ((v % p) + p) % p;
  const M = A.map((row) => row.map(mod));
  const rows = M.length;
  const mul = (a: number, b: number) => Number((BigInt(a) * BigInt(b)) % BigInt(p));
  const inv = (a: number) => {
    let [t, nt, r, nr] = [0n, 1n, BigInt(p), BigInt(a)];
    while (nr) {
      const q = r / nr;
      [t, nt] = [nt, t - q * nt];
      [r, nr] = [nr, r - q * nr];
    }
    return Number(((t % BigInt(p)) + BigInt(p)) % BigInt(p));
  };
  let r = 0;
  for (let c = 0; c < cols && r < rows; c++) {
    let piv = -1;
    for (let i = r; i < rows; i++)
      if (M[i][c]) {
        piv = i;
        break;
      }
    if (piv < 0) continue;
    [M[r], M[piv]] = [M[piv], M[r]];
    const iv = inv(M[r][c]);
    for (let i = r + 1; i < rows; i++) {
      if (!M[i][c]) continue;
      const f = mul(M[i][c], iv);
      for (let j = c; j < cols; j++) M[i][j] = mod(M[i][j] - mul(f, M[r][j]));
    }
    r++;
  }
  return r;
}

export type Sense = "<=" | ">=" | "=";

export interface LPRow {
  /** Sparse coefficients: [variable, coefficient] pairs (integers). */
  terms: [number, number][];
  sense: Sense;
  rhs: number;
}

export interface LPProblem {
  vars: number;
  rows: LPRow[];
  /** Maximise Σ objective[j]·x[j] (integers); omitted = feasibility only. */
  objective?: number[];
  /** Pivot limit (default 4000). */
  maxPivots?: number;
  /** Largest tableau (rows × columns) attempted (default 400 000). */
  maxCells?: number;
  signal?: AbortSignal;
}

export interface LPResult {
  status: "optimal" | "infeasible" | "unbounded" | "limit";
  /** A solution x = num / den (vertex of the feasible region), when feasible. */
  num?: bigint[];
  den?: bigint;
}

/**
 * Exact simplex (two phases, Bland's rule, fraction-free tableau: every entry is an integer and the
 * values are entry / D for the last pivot D) for max cᵀx subject to rows and x ≥ 0.
 */
export function solveLP(lp: LPProblem): LPResult {
  const n = lp.vars;
  const rows = lp.rows.map((r) => (r.rhs < 0 ? { terms: r.terms.map(([j, c]) => [j, -c] as [number, number]), sense: (r.sense === "<=" ? ">=" : r.sense === ">=" ? "<=" : "=") as Sense, rhs: -r.rhs } : r));
  const R = rows.length;
  // Columns: originals, then one slack/surplus per inequality, then artificials.
  let cols = n;
  const slackOf: number[] = [];
  for (const r of rows) slackOf.push(r.sense === "=" ? -1 : cols++);
  const artStart = cols;
  const artOf: number[] = [];
  for (const r of rows) artOf.push(r.sense === "<=" ? -1 : cols++);
  const N = cols;
  if ((R + 1) * (N + 1) > (lp.maxCells ?? 400_000)) return { status: "limit" };
  const RHS = N;
  const T: bigint[][] = [];
  T.push(new Array<bigint>(N + 1).fill(0n));
  const basis: number[] = [-1];
  rows.forEach((r, i) => {
    const row = new Array<bigint>(N + 1).fill(0n);
    for (const [j, c] of r.terms) row[j] += BigInt(c);
    if (r.sense === "<=") row[slackOf[i]] = 1n;
    else if (r.sense === ">=") row[slackOf[i]] = -1n;
    if (artOf[i] >= 0) row[artOf[i]] = 1n;
    row[RHS] = BigInt(r.rhs);
    T.push(row);
    basis.push(r.sense === "<=" ? slackOf[i] : artOf[i]);
  });
  let D = 1n;
  const alive = new Array<boolean>(R + 1).fill(true);
  alive[0] = false;
  const maxPivots = lp.maxPivots ?? 4000;
  let pivots = 0;
  const excluded = new Uint8Array(N);

  const pivot = (r: number, s: number) => {
    if (T[r][s] < 0n) for (let j = 0; j <= N; j++) T[r][j] = -T[r][j];
    const p = T[r][s];
    const pr = T[r];
    for (let i = 0; i <= R; i++) {
      if (i === r || (!alive[i] && i !== 0)) continue;
      const row = T[i];
      const f = row[s];
      if (f === 0n) {
        if (p !== D) for (let j = 0; j <= N; j++) if (row[j] !== 0n) row[j] = (row[j] * p) / D;
      } else for (let j = 0; j <= N; j++) row[j] = (row[j] * p - f * pr[j]) / D;
    }
    D = p;
    basis[r] = s;
    pivots++;
    if ((pivots & 31) === 0) checkAbort(lp.signal);
  };

  const setObjective = (c: (j: number) => bigint) => {
    const z = T[0];
    for (let j = 0; j <= N; j++) z[j] = j < N ? -c(j) * D : 0n;
    for (let i = 1; i <= R; i++) {
      if (!alive[i]) continue;
      const cb = c(basis[i]);
      if (cb === 0n) continue;
      const row = T[i];
      for (let j = 0; j <= N; j++) if (row[j] !== 0n) z[j] += cb * row[j];
    }
  };

  /** Run the simplex on row 0; returns false when unbounded, null on the pivot limit. */
  const run = (): boolean | null => {
    for (;;) {
      let s = -1;
      const z = T[0];
      for (let j = 0; j < N; j++)
        if (!excluded[j] && z[j] < 0n) {
          s = j;
          break;
        }
      if (s < 0) return true;
      let r = -1;
      for (let i = 1; i <= R; i++) {
        if (!alive[i] || T[i][s] <= 0n) continue;
        if (r < 0) {
          r = i;
          continue;
        }
        // Compare T[i][RHS]/T[i][s] with T[r][RHS]/T[r][s]; ties by the smallest basic variable (Bland).
        const lhs = T[i][RHS] * T[r][s];
        const rhs = T[r][RHS] * T[i][s];
        if (lhs < rhs || (lhs === rhs && basis[i] < basis[r])) r = i;
      }
      if (r < 0) return false;
      if (pivots >= maxPivots) return null;
      pivot(r, s);
    }
  };

  // Phase 1: maximise −Σ artificials.
  if (artStart < N) {
    setObjective((j) => (j >= artStart ? -1n : 0n));
    const ok = run();
    if (ok === null) return { status: "limit" };
    if (T[0][RHS] < 0n) return { status: "infeasible" };
    // Drive the remaining (zero) artificials out of the basis.
    for (let i = 1; i <= R; i++) {
      if (!alive[i] || basis[i] < artStart) continue;
      let s = -1;
      for (let j = 0; j < artStart; j++)
        if (T[i][j] !== 0n) {
          s = j;
          break;
        }
      if (s < 0) alive[i] = false;
      else pivot(i, s);
    }
    for (let j = artStart; j < N; j++) excluded[j] = 1;
  }

  let status: LPResult["status"] = "optimal";
  if (lp.objective) {
    const obj = lp.objective;
    setObjective((j) => (j < n && obj[j] ? BigInt(obj[j]) : 0n));
    const ok = run();
    if (ok === null) return { status: "limit" };
    if (!ok) status = "unbounded";
  }
  const num = new Array<bigint>(n).fill(0n);
  for (let i = 1; i <= R; i++) if (alive[i] && basis[i] < n) num[basis[i]] = T[i][RHS];
  return { status, num, den: D };
}

/** Scale a rational vector num/den to the smallest proportional non-negative integers (as numbers; null if too large). */
export function integerVector(num: bigint[]): number[] | null {
  let g = 0n;
  for (const v of num) if (v) g = gcdBig(g, v);
  if (!g) return num.map(() => 0);
  const out: number[] = [];
  for (const v of num) {
    const q = v / g;
    if (abs(q) > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    out.push(Number(q));
  }
  return out;
}

export interface ConeSupport {
  /** "limit": the LP was too large; the other fields are then empty. */
  status: "ok" | "limit";
  /** Targets that are positive for some vector of the cone (its maximal support). */
  support: boolean[];
  /** A vector of the cone positive on every target of the support (smallest integers), when representable. */
  witness: number[] | null;
}

/**
 * Maximal support of a polyhedral cone {x ≥ 0 : A x ≥ 0 (or = 0)}: which of the linear forms
 * `targets` (each a list of [variable, coefficient]) can be positive. One LP: maximise Σ z_q with
 * z_q ≤ target_q(x), z_q ≤ 1; the cone is closed under addition and scaling, so z_q = 1 exactly for
 * the targets in the maximal support. `zero` lists variables fixed to 0.
 */
export function coneSupport(
  vars: number,
  A: [number, number][][],
  sense: ">=" | "=",
  targets: [number, number][][],
  opts: { zero?: Iterable<number>; signal?: AbortSignal; maxPivots?: number; maxCells?: number } = {},
): ConeSupport {
  const Q = targets.length;
  const fixed = new Set(opts.zero ?? []);
  const keep = (terms: [number, number][]) => terms.filter(([j]) => !fixed.has(j));
  const rows: LPRow[] = [];
  // Cone rows; "≥ 0" rows are negated into "≤ 0" so that the origin is a feasible start.
  for (const terms of A) {
    const t = keep(terms);
    if (!t.length) continue;
    rows.push(sense === ">=" ? { terms: t.map(([j, c]) => [j, -c]), sense: "<=", rhs: 0 } : { terms: t, sense: "=", rhs: 0 });
  }
  for (let q = 0; q < Q; q++) {
    // z_q − target_q(x) ≤ 0 and z_q ≤ 1.
    rows.push({ terms: [[vars + q, 1], ...keep(targets[q]).map(([j, c]) => [j, -c] as [number, number])], sense: "<=", rhs: 0 });
    rows.push({ terms: [[vars + q, 1]], sense: "<=", rhs: 1 });
  }
  for (const j of fixed) if (j < vars) rows.push({ terms: [[j, 1]], sense: "<=", rhs: 0 });
  const objective = new Array<number>(vars + Q).fill(0);
  for (let q = 0; q < Q; q++) objective[vars + q] = 1;
  const r = solveLP({ vars: vars + Q, rows, objective, signal: opts.signal, maxPivots: opts.maxPivots, maxCells: opts.maxCells });
  if (r.status !== "optimal" || !r.num || !r.den) return { status: "limit", support: [], witness: null };
  const support = targets.map((_, q) => r.num![vars + q] * 2n >= r.den!);
  return { status: "ok", support, witness: integerVector(r.num.slice(0, vars)) };
}
