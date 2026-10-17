// ODE steppers for autonomous systems y' = f(y): Dormand–Prince 5(4), explicit Euler,
// classic RK4 and the L-stable linearly implicit Rosenbrock method ROS2 for stiff systems.

export type Rhs = (y: Float64Array, dy: Float64Array) => void;

export type OdeSolverName = "rk45" | "euler" | "rk4" | "rosenbrock";

export interface Stepper {
  readonly adaptive: boolean;
  /** Exponent for step size control, 1 / (order of the error estimate + 1). */
  readonly exponent: number;
  /** One step of size h from y into out. Returns the scaled error norm (0 for fixed-step methods). */
  step(y: Float64Array, h: number, out: Float64Array): number;
}

/**
 * Create a stepper for an n-dimensional system. Only the `active` components change;
 * the others are copied through unchanged. atol/rtol scale the error norm.
 */
export function makeStepper(name: OdeSolverName, n: number, f: Rhs, active: Int32Array, atol: number, rtol: number): Stepper {
  const norm = (y: Float64Array, out: Float64Array, err: Float64Array) => {
    let s = 0;
    for (let k = 0; k < active.length; k++) {
      const i = active[k];
      const sc = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(out[i]));
      const e = err[i] / sc;
      s += e * e;
    }
    return active.length ? Math.sqrt(s / active.length) : 0;
  };
  const buf = () => new Float64Array(n);
  switch (name) {
    case "euler": {
      const k1 = buf();
      return {
        adaptive: false,
        exponent: 0.5,
        step(y, h, out) {
          f(y, k1);
          for (let i = 0; i < n; i++) out[i] = y[i] + h * k1[i];
          return 0;
        },
      };
    }
    case "rk4": {
      const k1 = buf(), k2 = buf(), k3 = buf(), k4 = buf(), t = buf();
      return {
        adaptive: false,
        exponent: 0.2,
        step(y, h, out) {
          f(y, k1);
          for (let i = 0; i < n; i++) t[i] = y[i] + 0.5 * h * k1[i];
          f(t, k2);
          for (let i = 0; i < n; i++) t[i] = y[i] + 0.5 * h * k2[i];
          f(t, k3);
          for (let i = 0; i < n; i++) t[i] = y[i] + h * k3[i];
          f(t, k4);
          for (let i = 0; i < n; i++) out[i] = y[i] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
          return 0;
        },
      };
    }
    case "rk45": {
      const k1 = buf(), k2 = buf(), k3 = buf(), k4 = buf(), k5 = buf(), k6 = buf(), k7 = buf(), t = buf(), err = buf();
      const a21 = 1 / 5;
      const a31 = 3 / 40, a32 = 9 / 40;
      const a41 = 44 / 45, a42 = -56 / 15, a43 = 32 / 9;
      const a51 = 19372 / 6561, a52 = -25360 / 2187, a53 = 64448 / 6561, a54 = -212 / 729;
      const a61 = 9017 / 3168, a62 = -355 / 33, a63 = 46732 / 5247, a64 = 49 / 176, a65 = -5103 / 18656;
      const b1 = 35 / 384, b3 = 500 / 1113, b4 = 125 / 192, b5 = -2187 / 6784, b6 = 11 / 84;
      const e1 = 71 / 57600, e3 = -71 / 16695, e4 = 71 / 1920, e5 = -17253 / 339200, e6 = 22 / 525, e7 = -1 / 40;
      return {
        adaptive: true,
        exponent: 0.2,
        step(y, h, out) {
          f(y, k1);
          for (let i = 0; i < n; i++) t[i] = y[i] + h * a21 * k1[i];
          f(t, k2);
          for (let i = 0; i < n; i++) t[i] = y[i] + h * (a31 * k1[i] + a32 * k2[i]);
          f(t, k3);
          for (let i = 0; i < n; i++) t[i] = y[i] + h * (a41 * k1[i] + a42 * k2[i] + a43 * k3[i]);
          f(t, k4);
          for (let i = 0; i < n; i++) t[i] = y[i] + h * (a51 * k1[i] + a52 * k2[i] + a53 * k3[i] + a54 * k4[i]);
          f(t, k5);
          for (let i = 0; i < n; i++) t[i] = y[i] + h * (a61 * k1[i] + a62 * k2[i] + a63 * k3[i] + a64 * k4[i] + a65 * k5[i]);
          f(t, k6);
          for (let i = 0; i < n; i++) out[i] = y[i] + h * (b1 * k1[i] + b3 * k3[i] + b4 * k4[i] + b5 * k5[i] + b6 * k6[i]);
          f(out, k7);
          for (let i = 0; i < n; i++) err[i] = h * (e1 * k1[i] + e3 * k3[i] + e4 * k4[i] + e5 * k5[i] + e6 * k6[i] + e7 * k7[i]);
          return norm(y, out, err);
        },
      };
    }
    case "rosenbrock": {
      // ROS2 (Verwer et al. 1999), gamma = 1 + 1/sqrt(2), with the embedded first-order
      // linearly implicit Euler solution for the error estimate. Numerical Jacobian over the
      // active components, cached while y does not change (rejected steps reuse it).
      const m = active.length;
      const gamma = 1 + Math.SQRT1_2;
      const f0 = buf(), f1 = buf(), t = buf(), err = buf();
      const J = new Float64Array(m * m);
      const A = new Float64Array(m * m);
      const piv = new Int32Array(m);
      const k1 = new Float64Array(m), k2 = new Float64Array(m);
      const jacAt = new Float64Array(n);
      let jacValid = false;
      const sameAsJac = (y: Float64Array) => {
        if (!jacValid) return false;
        for (let i = 0; i < n; i++) if (y[i] !== jacAt[i]) return false;
        return true;
      };
      return {
        adaptive: true,
        exponent: 0.5,
        step(y, h, out) {
          f(y, f0);
          if (!sameAsJac(y)) {
            t.set(y);
            for (let c = 0; c < m; c++) {
              const j = active[c];
              const yj = y[j];
              const d = 1.4901161193847656e-8 * Math.max(Math.abs(yj), 1e-6);
              t[j] = yj + d;
              f(t, f1);
              t[j] = yj;
              for (let r = 0; r < m; r++) J[r * m + c] = (f1[active[r]] - f0[active[r]]) / d;
            }
            jacAt.set(y);
            jacValid = true;
          }
          for (let i = 0; i < m * m; i++) A[i] = -gamma * h * J[i];
          for (let i = 0; i < m; i++) A[i * m + i] += 1;
          if (!luFactor(A, m, piv)) return Infinity;
          for (let r = 0; r < m; r++) k1[r] = f0[active[r]];
          luSolve(A, m, piv, k1);
          t.set(y);
          for (let r = 0; r < m; r++) t[active[r]] += h * k1[r];
          f(t, f1);
          for (let r = 0; r < m; r++) k2[r] = f1[active[r]] - 2 * k1[r];
          luSolve(A, m, piv, k2);
          out.set(y);
          err.fill(0);
          for (let r = 0; r < m; r++) {
            const i = active[r];
            out[i] = y[i] + h * (1.5 * k1[r] + 0.5 * k2[r]);
            err[i] = 0.5 * h * (k1[r] + k2[r]);
          }
          return norm(y, out, err);
        },
      };
    }
  }
}

/** In-place LU factorisation with partial pivoting of an m×m row-major matrix. */
export function luFactor(a: Float64Array, m: number, piv: Int32Array): boolean {
  for (let k = 0; k < m; k++) {
    let p = k;
    let best = Math.abs(a[k * m + k]);
    for (let i = k + 1; i < m; i++) {
      const v = Math.abs(a[i * m + k]);
      if (v > best) {
        best = v;
        p = i;
      }
    }
    if (best === 0 || !Number.isFinite(best)) return false;
    piv[k] = p;
    if (p !== k)
      for (let j = 0; j < m; j++) {
        const tmp = a[k * m + j];
        a[k * m + j] = a[p * m + j];
        a[p * m + j] = tmp;
      }
    const d = a[k * m + k];
    for (let i = k + 1; i < m; i++) {
      const l = (a[i * m + k] /= d);
      if (l !== 0) for (let j = k + 1; j < m; j++) a[i * m + j] -= l * a[k * m + j];
    }
  }
  return true;
}

/** Solve A x = b in place using the factors from luFactor. */
export function luSolve(a: Float64Array, m: number, piv: Int32Array, b: Float64Array): void {
  for (let k = 0; k < m; k++) {
    const p = piv[k];
    if (p !== k) {
      const tmp = b[k];
      b[k] = b[p];
      b[p] = tmp;
    }
  }
  for (let k = 0; k < m; k++) for (let i = k + 1; i < m; i++) b[i] -= a[i * m + k] * b[k];
  for (let i = m - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < m; j++) s -= a[i * m + j] * b[j];
    b[i] = s / a[i * m + i];
  }
}
