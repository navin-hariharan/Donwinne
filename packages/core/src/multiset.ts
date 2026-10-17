import type { Value } from "./expr";

function key(v: Value): string {
  return JSON.stringify(v);
}

function show(v: Value): string {
  if (Array.isArray(v)) return `(${v.map(show).join(",")})`;
  return String(v);
}

/** A finite multiset of colour values with positive counts. Immutable. */
export class Multiset {
  private readonly m: Map<string, { v: Value; n: number }>;

  constructor(entries?: Iterable<[Value, number]>) {
    this.m = new Map();
    if (entries) for (const [v, n] of entries) this.addMut(v, n);
  }

  static of(v: Value, n = 1): Multiset {
    return new Multiset([[v, n]]);
  }

  private addMut(v: Value, n: number) {
    if (n === 0) return;
    const k = key(v);
    const cur = this.m.get(k);
    const total = (cur?.n ?? 0) + n;
    if (total <= 0) this.m.delete(k);
    else this.m.set(k, { v, n: total });
  }

  count(v: Value): number {
    return this.m.get(key(v))?.n ?? 0;
  }

  get size(): number {
    let s = 0;
    for (const e of this.m.values()) s += e.n;
    return s;
  }

  get isEmpty(): boolean {
    return this.m.size === 0;
  }

  entries(): [Value, number][] {
    return [...this.m.values()].map((e) => [e.v, e.n]);
  }

  plus(o: Multiset): Multiset {
    const r = new Multiset(this.entries());
    for (const [v, n] of o.entries()) r.addMut(v, n);
    return r;
  }

  /** this - o, clamped at zero. */
  minus(o: Multiset): Multiset {
    const r = new Multiset(this.entries());
    for (const [v, n] of o.entries()) r.addMut(v, -Math.min(n, r.count(v)));
    return r;
  }

  scale(k: number): Multiset {
    return new Multiset(this.entries().map(([v, n]) => [v, n * k]));
  }

  /** this ≤ o, pointwise. */
  leq(o: Multiset): boolean {
    for (const [v, n] of this.entries()) if (o.count(v) < n) return false;
    return true;
  }

  equals(o: Multiset): boolean {
    return this.leq(o) && o.leq(this);
  }

  /** Canonical, sorted text form such as 2`a++b. Empty multiset is "". */
  toString(): string {
    return [...this.m.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, e]) => (e.n === 1 ? show(e.v) : `${e.n}\`${show(e.v)}`))
      .join("++");
  }
}
