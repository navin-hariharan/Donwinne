import React, { useMemo, useRef, useState } from "react";

export interface PlotSeries {
  name: string;
  values: number[];
  color?: string;
  /** Shaded envelopes, widest first (fuzzy bands). */
  bands?: { lower: number[]; upper: number[]; alpha: number }[];
  dashed?: boolean;
}

export const SERIES_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5", "#0d9488", "#9333ea"];

function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) return [lo];
  const span = hi - lo;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

export function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(3).replace(/\.?0+e/, "e");
  if (a < 1) return String(Number(v.toPrecision(4)));
  return String(Math.round(v * 1000) / 1000);
}

/** A responsive line chart with a hover read-out. */
export function LinePlot({ times, series, xLabel = "time", yLabel, height = 220, fill = false, logY = false }: { times: number[]; series: PlotSeries[]; xLabel?: string; yLabel?: string; height?: number; fill?: boolean; logY?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(600);
  const [fillH, setFillH] = useState(height);
  React.useEffect(() => {
    const el = ref.current;
    const wrap = box.current;
    if (!el || !wrap) return;
    const ro = new ResizeObserver(() => {
      setWidth(el.getBoundingClientRect().width || 600);
      // fill: take the height the layout gives the wrapper (it is a flex child).
      if (fill) setFillH(Math.max(120, Math.floor(wrap.getBoundingClientRect().height)));
    });
    ro.observe(el);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fill]);

  const m = { l: 56, r: 12, t: 18, b: 32 };
  const W = Math.max(200, width);
  const H = fill ? fillH : height;
  const { y0, y1 } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) {
      for (const v of s.values) if (Number.isFinite(v)) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
      for (const b of s.bands ?? []) for (const v of [...b.lower, ...b.upper]) if (Number.isFinite(v)) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
    }
    if (!Number.isFinite(lo)) return { y0: 0, y1: 1 };
    if (logY) return { y0: Math.max(lo, 1e-12), y1: Math.max(hi, lo * 10) };
    if (lo > 0 && lo < hi * 0.5) lo = 0;
    if (hi === lo) {
      // A flat line: show it against zero rather than magnifying rounding noise.
      lo = Math.min(0, lo);
      hi = Math.max(0, hi) || 1;
      if (hi === lo) hi = lo + 1;
    }
    return { y0: lo, y1: hi + (hi - lo) * 0.05 };
  }, [series, logY]);
  const x0 = times[0] ?? 0;
  const x1 = times[times.length - 1] ?? 1;
  const sx = (t: number) => m.l + ((t - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const sy = (v: number) => {
    const k = logY ? (Math.log10(Math.max(v, 1e-300)) - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0)) : (v - y0) / (y1 - y0);
    return H - m.b - k * (H - m.t - m.b);
  };
  const path = (vals: number[]) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (!Number.isFinite(v) || (logY && v <= 0)) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${sx(times[i]).toFixed(1)},${sy(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const area = (lo: number[], hi: number[]) => {
    const top = hi.map((v, i) => `${i ? "L" : "M"}${sx(times[i]).toFixed(1)},${sy(v).toFixed(1)}`).join("");
    const bot = lo
      .map((v, i) => [i, v] as const)
      .reverse()
      .map(([i, v]) => `L${sx(times[i]).toFixed(1)},${sy(v).toFixed(1)}`)
      .join("");
    return `${top}${bot}Z`;
  };
  const xt = niceTicks(x0, x1, Math.max(2, Math.floor(W / 90)));
  const yt = logY ? [] : niceTicks(y0, y1, 5);

  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = e.clientX - r.left;
    const t = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
    let best = 0;
    for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
    setHover(px < m.l ? null : best);
  };

  return (
    <div className={fill ? "plot fill" : "plot"} ref={box}>
      <svg ref={ref} width="100%" height={H} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label="Plot">
        {yt.map((v) => (
          <g key={`y${v}`}>
            <line x1={m.l} x2={W - m.r} y1={sy(v)} y2={sy(v)} className="plot-grid" />
            <text x={m.l - 6} y={sy(v) + 4} textAnchor="end" className="plot-tick">
              {fmt(v)}
            </text>
          </g>
        ))}
        {xt.map((v) => (
          <g key={`x${v}`}>
            <line y1={m.t} y2={H - m.b} x1={sx(v)} x2={sx(v)} className="plot-grid" />
            <text x={sx(v)} y={H - m.b + 15} textAnchor="middle" className="plot-tick">
              {fmt(v)}
            </text>
          </g>
        ))}
        <line x1={m.l} x2={m.l} y1={m.t} y2={H - m.b} className="plot-axis" />
        <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} className="plot-axis" />
        <text x={W - m.r} y={H - 4} textAnchor="end" className="plot-label">
          {xLabel}
        </text>
        {yLabel && (
          <text x={m.l + 6} y={11} className="plot-label">
            {yLabel}
          </text>
        )}
        {series.map((s, i) =>
          (s.bands ?? []).map((b, j) => <path key={`b${i}-${j}`} d={area(b.lower, b.upper)} style={{ fill: s.color ?? SERIES_COLORS[i % SERIES_COLORS.length], fillOpacity: 0.08 + 0.06 * b.alpha, stroke: "none" }} />),
        )}
        {series.map((s, i) => (
          <path key={i} d={path(s.values)} style={{ fill: "none", stroke: s.color ?? SERIES_COLORS[i % SERIES_COLORS.length], strokeWidth: 1.8, strokeDasharray: s.dashed ? "5 4" : undefined }} />
        ))}
        {hover !== null && <line x1={sx(times[hover])} x2={sx(times[hover])} y1={m.t} y2={H - m.b} className="plot-cursor" />}
      </svg>
      {hover !== null && (
        <div className="plot-readout" style={{ left: Math.min(sx(times[hover]) + 10, W - 180) }}>
          <div className="muted">
            {xLabel} = {fmt(times[hover])}
          </div>
          {series.slice(0, 12).map((s, i) => (
            <div key={i}>
              <span className="dot" style={{ background: s.color ?? SERIES_COLORS[i % SERIES_COLORS.length] }} />
              {s.name}: <b>{fmt(s.values[hover])}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
