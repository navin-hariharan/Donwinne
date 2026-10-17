// Mersenne Twister MT19937 (Matsumoto & Nishimura 1998), the generator Snoopy uses.

/** A seedable MT19937 pseudo-random number generator. */
export class MersenneTwister {
  private readonly mt = new Uint32Array(624);
  private i = 625;

  constructor(seed: number = randomSeed()) {
    this.seed(seed);
  }

  /** Re-initialise the state from a 32-bit seed (init_genrand). */
  seed(s: number): void {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < 624; i++) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
    }
    this.i = 624;
  }

  /** Next 32-bit unsigned integer (genrand_int32). */
  nextU32(): number {
    const mt = this.mt;
    if (this.i >= 624) {
      for (let k = 0; k < 624; k++) {
        const y = (mt[k] & 0x80000000) | (mt[(k + 1) % 624] & 0x7fffffff);
        mt[k] = mt[(k + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      this.i = 0;
    }
    let y = mt[this.i++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** Uniform double in [0, 1) with 53-bit resolution (genrand_res53). */
  random(): number {
    const a = this.nextU32() >>> 5;
    const b = this.nextU32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** Exponentially distributed number with mean 1. */
  exp1(): number {
    return -Math.log(1 - this.random());
  }
}

/** A seed from the clock and Math.random, for runs without an explicit seed. */
export function randomSeed(): number {
  return ((Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0) || 5489;
}
