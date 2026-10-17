// Reduced ordered binary decision diagrams (BDD) and zero-suppressed BDDs (ZDD) for set families.
//
// Nodes are integers. 0 and 1 are the terminals. A node's children are always created before it,
// so child ids are smaller than parent ids, which lets bottom-up passes run as simple loops.

/** A reduced ordered BDD manager with a unique table and a memoised if-then-else. */
export class Bdd {
  private vars: number[] = [];
  private los: number[] = [];
  private his: number[] = [];
  private unique = new Map<string, number>();
  private iteCache = new Map<string, number>();

  /** Terminal nodes. */
  static readonly ZERO = 0;
  static readonly ONE = 1;

  /** @param varCount number of variables; variable 0 is tested first (top of the diagram). */
  constructor(public readonly varCount: number) {
    this.vars.push(varCount, varCount);
    this.los.push(0, 1);
    this.his.push(0, 1);
  }

  /** Number of nodes created so far (including terminals and garbage). */
  get nodeCount(): number {
    return this.vars.length;
  }
  /** Variable tested by node f (varCount for terminals). */
  varOf(f: number): number {
    return this.vars[f];
  }
  lo(f: number): number {
    return this.los[f];
  }
  hi(f: number): number {
    return this.his[f];
  }

  /** The node (v ? hi : lo), reduced and shared. */
  mk(v: number, lo: number, hi: number): number {
    if (lo === hi) return lo;
    const key = `${v},${lo},${hi}`;
    let id = this.unique.get(key);
    if (id === undefined) {
      id = this.vars.length;
      this.vars.push(v);
      this.los.push(lo);
      this.his.push(hi);
      this.unique.set(key, id);
    }
    return id;
  }

  /** The function that is true iff variable v is true. */
  variable(v: number): number {
    return this.mk(v, 0, 1);
  }

  /** if f then g else h. */
  ite(f: number, g: number, h: number): number {
    if (f === 1) return g;
    if (f === 0) return h;
    if (g === h) return g;
    if (g === 1 && h === 0) return f;
    const key = `${f},${g},${h}`;
    const cached = this.iteCache.get(key);
    if (cached !== undefined) return cached;
    const v = Math.min(this.vars[f], this.vars[g], this.vars[h]);
    const cof = (x: number, b: boolean) => (this.vars[x] === v ? (b ? this.his[x] : this.los[x]) : x);
    const r = this.mk(v, this.ite(cof(f, false), cof(g, false), cof(h, false)), this.ite(cof(f, true), cof(g, true), cof(h, true)));
    this.iteCache.set(key, r);
    return r;
  }

  not(f: number): number {
    return this.ite(f, 0, 1);
  }
  and(f: number, g: number): number {
    return this.ite(f, g, 0);
  }
  or(f: number, g: number): number {
    return this.ite(f, 1, g);
  }
  xor(f: number, g: number): number {
    return this.ite(f, this.not(g), g);
  }
  andAll(fs: number[]): number {
    return fs.reduce((a, b) => this.and(a, b), 1);
  }
  orAll(fs: number[]): number {
    return fs.reduce((a, b) => this.or(a, b), 0);
  }
  /** At least k of the functions are true. */
  atLeast(k: number, fs: number[]): number {
    const memo = new Map<string, number>();
    const rec = (i: number, k: number): number => {
      if (k <= 0) return 1;
      if (fs.length - i < k) return 0;
      const key = `${i},${k}`;
      let r = memo.get(key);
      if (r === undefined) {
        r = this.ite(fs[i], rec(i + 1, k - 1), rec(i + 1, k));
        memo.set(key, r);
      }
      return r;
    };
    return rec(0, k);
  }
  /** Exactly one of the functions is true. */
  exactlyOne(fs: number[]): number {
    return this.and(this.atLeast(1, fs), this.not(this.atLeast(2, fs)));
  }

  /** Nodes reachable from f, children before parents (ascending ids). */
  reachable(f: number): number[] {
    const seen = new Set<number>();
    const stack = [f];
    while (stack.length) {
      const x = stack.pop()!;
      if (x <= 1 || seen.has(x)) continue;
      seen.add(x);
      stack.push(this.los[x], this.his[x]);
    }
    return [...seen].sort((a, b) => a - b);
  }

  /** Number of decision nodes reachable from f. */
  size(f: number): number {
    return this.reachable(f).length;
  }

  /**
   * Probability that f is true when variable v is true with probability p[v], independently
   * (Shannon decomposition: P(f) = p·P(f|v) + (1−p)·P(f|¬v)).
   */
  probability(f: number, p: ArrayLike<number>, nodes = this.reachable(f)): number {
    if (f <= 1) return f;
    const P = new Map<number, number>([
      [0, 0],
      [1, 1],
    ]);
    for (const x of nodes) {
      const q = p[this.vars[x]];
      P.set(x, q * P.get(this.his[x])! + (1 - q) * P.get(this.los[x])!);
    }
    return P.get(f)!;
  }

  /** Evaluate f for an assignment. */
  evaluate(f: number, assignment: ArrayLike<boolean>): boolean {
    while (f > 1) f = assignment[this.vars[f]] ? this.his[f] : this.los[f];
    return f === 1;
  }

  /** The dual function f^d(x) = ¬f(¬x); its minimal solutions are the minimal path sets of f. */
  dual(f: number): number {
    const memo = new Map<number, number>();
    const rec = (x: number): number => {
      if (x <= 1) return 1 - x;
      let r = memo.get(x);
      if (r === undefined) {
        r = this.mk(this.vars[x], rec(this.his[x]), rec(this.los[x]));
        memo.set(x, r);
      }
      return r;
    };
    return rec(f);
  }

  /**
   * Minimal solutions (prime implicants of the monotone closure) as a ZDD, using Rauzy's
   * algorithm. For non-coherent functions this is the coherent approximation: negated
   * literals are dropped. Only solutions with at most `maxOrder` variables are kept.
   */
  minimalSolutions(f: number, z: Zdd, maxOrder = Infinity): number {
    const memo = new Map<string, number>();
    const k0 = Math.min(maxOrder, this.varCount);
    const rec = (x: number, k: number): number => {
      if (x === 0) return 0;
      if (x === 1) return 1;
      if (k <= 0) return 0;
      const key = `${x},${k}`;
      let r = memo.get(key);
      if (r === undefined) {
        const lo = this.los[x];
        const hi = this.or(this.his[x], lo); // monotone closure
        const m0 = rec(lo, k);
        const m1 = z.without(rec(hi, k - 1), m0);
        r = z.mk(this.vars[x], m0, m1);
        memo.set(key, r);
      }
      return r;
    };
    return rec(f, k0);
  }
}

/** A zero-suppressed BDD manager representing families of sets of variables. */
export class Zdd {
  private vars: number[] = [];
  private los: number[] = [];
  private his: number[] = [];
  private unique = new Map<string, number>();
  private cache = new Map<string, number>();

  /** 0 = the empty family, 1 = the family containing only the empty set. */
  constructor(public readonly varCount: number) {
    this.vars.push(varCount, varCount);
    this.los.push(0, 1);
    this.his.push(0, 1);
  }
  varOf(f: number): number {
    return this.vars[f];
  }
  lo(f: number): number {
    return this.los[f];
  }
  hi(f: number): number {
    return this.his[f];
  }

  /** Sets without v from lo, plus sets from hi with v added. */
  mk(v: number, lo: number, hi: number): number {
    if (hi === 0) return lo;
    const key = `${v},${lo},${hi}`;
    let id = this.unique.get(key);
    if (id === undefined) {
      id = this.vars.length;
      this.vars.push(v);
      this.los.push(lo);
      this.his.push(hi);
      this.unique.set(key, id);
    }
    return id;
  }

  private hasEmpty(f: number): boolean {
    while (f > 1) f = this.los[f];
    return f === 1;
  }

  /** Union of two families. */
  union(f: number, g: number): number {
    if (f === 0) return g;
    if (g === 0 || f === g) return f;
    const key = `u${Math.min(f, g)},${Math.max(f, g)}`;
    const c = this.cache.get(key);
    if (c !== undefined) return c;
    const vf = this.vars[f];
    const vg = this.vars[g];
    let r: number;
    if (vf < vg) r = this.mk(vf, this.union(this.los[f], g), this.his[f]);
    else if (vg < vf) r = this.mk(vg, this.union(f, this.los[g]), this.his[g]);
    else r = this.mk(vf, this.union(this.los[f], this.los[g]), this.union(this.his[f], this.his[g]));
    this.cache.set(key, r);
    return r;
  }

  /** The sets of f that contain no set of g. */
  without(f: number, g: number): number {
    if (f === 0 || g === 0) return f;
    if (g === 1) return 0;
    if (f === g) return 0;
    if (f === 1) return this.hasEmpty(g) ? 0 : 1;
    const key = `w${f},${g}`;
    const c = this.cache.get(key);
    if (c !== undefined) return c;
    const vf = this.vars[f];
    const vg = this.vars[g];
    let r: number;
    if (vf < vg) r = this.mk(vf, this.without(this.los[f], g), this.without(this.his[f], g));
    else if (vg < vf) r = this.without(f, this.los[g]);
    else
      r = this.mk(
        vf,
        this.without(this.los[f], this.los[g]),
        this.without(this.without(this.his[f], this.los[g]), this.his[g]),
      );
    this.cache.set(key, r);
    return r;
  }

  /** Number of sets in the family. */
  count(f: number): number {
    const memo = new Map<number, number>();
    const rec = (x: number): number => {
      if (x <= 1) return x;
      let r = memo.get(x);
      if (r === undefined) {
        r = rec(this.los[x]) + rec(this.his[x]);
        memo.set(x, r);
      }
      return r;
    };
    return rec(f);
  }

  /**
   * The sets of the family as arrays of variables, smallest sets first,
   * at most `maxSets` of them.
   */
  sets(f: number, maxSets = Infinity): number[][] {
    // Size of the smallest and largest set below each node, to enumerate by size.
    const minLen = new Map<number, number>([
      [0, Infinity],
      [1, 0],
    ]);
    const maxLen = new Map<number, number>([
      [0, -Infinity],
      [1, 0],
    ]);
    const lens = (x: number) => {
      if (minLen.has(x)) return;
      lens(this.los[x]);
      lens(this.his[x]);
      minLen.set(x, Math.min(minLen.get(this.los[x])!, minLen.get(this.his[x])! + 1));
      maxLen.set(x, Math.max(maxLen.get(this.los[x])!, maxLen.get(this.his[x])! + 1));
    };
    lens(f);
    const out: number[][] = [];
    const lo = minLen.get(f)!;
    const hi = maxLen.get(f)!;
    if (lo === Infinity) return out;
    for (let size = lo; size <= hi && out.length < maxSets; size++) {
      const path: number[] = [];
      const rec = (x: number, need: number) => {
        if (out.length >= maxSets) return;
        if (need < minLen.get(x)! || need > maxLen.get(x)!) return;
        if (x === 1) {
          if (need === 0) out.push([...path]);
          return;
        }
        rec(this.los[x], need);
        path.push(this.vars[x]);
        rec(this.his[x], need - 1);
        path.pop();
      };
      rec(f, size);
    }
    return out;
  }
}
