import React, { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { Net, disabledReasons, enabledBindings, isColoured, isFaultTree, isFuzzy, showBinding, showTokens, timeBase } from "@pns/core";
import { SolverName, Trace, simulateAsync, traceToCsv } from "@pns/sim";
import { faultTreeToPetriNet, importanceMeasures, layoutFaultTree, reliabilityCurve, topEventAnalysis, ImportanceMeasure, TopEventResult } from "@pns/ft";
import { advanceTime, compiled, enterPage, fireTransition, fmtTime, loadNet, problemsOf, select, simGoto, timedEnabled, toast, useStore, edit } from "./store";
import { LinePlot, PlotSeries, SERIES_COLORS, fmt } from "./Plot";
import { downloadText } from "./fileOps";
import { WATERMARK_HEIGHT, markSvgElement } from "./watermark";
import { autoLayout } from "./layout";
import { Splitter } from "./Overlays";
import { ElementsPanel, revealElement } from "./Elements";
import { AmbientSimPanel } from "./AmbientSim";
import { isAmbientNet } from "./ambient";

type Panel = "problems" | "elements" | "simulation" | "plot" | "faultTree";

export function BottomPanel() {
  const panel = useStore((s) => s.panel);
  const open = useStore((s) => s.bottomOpen);
  const mode = useStore((s) => s.mode);
  const net = useStore((s) => s.net);
  const problems = problemsOf(net);
  const errors = problems.filter((p) => p.severity === "error").length;
  const warnings = problems.length - errors;
  const ft = isFaultTree(net.netClass);
  const quantitative = !!timeBase(net.netClass);
  const tabs: { id: Panel; label: string; show: boolean }[] = [
    { id: "problems", label: "Problems", show: true },
    { id: "elements", label: "Elements", show: !ft },
    { id: "simulation", label: net.netClass === "timed" ? "Timed token game" : isAmbientNet(net) ? "Step token game" : "Token game", show: !ft && net.netClass !== "freestyle" },
    { id: "plot", label: "Simulate & plot", show: quantitative },
    { id: "faultTree", label: "Fault tree analysis", show: ft },
  ];
  const visible = tabs.filter((t) => t.show);
  const current = visible.some((t) => t.id === panel) ? panel : "problems";
  const setPanel = (p: Panel) => useStore.setState({ panel: p, bottomOpen: true });
  const userHeight = useStore((s) => s.bottomHeight);
  const roomy = current === "plot" || current === "faultTree" || current === "elements";
  // Plots need room: a height the user picked for the problems list is raised for them. Tall screens get taller defaults.
  const tall = typeof window !== "undefined" && window.innerHeight >= 1200;
  const height = roomy ? Math.max(userHeight ?? (tall ? 440 : 330), 260) : userHeight ?? (tall ? 240 : 180);
  return (
    <>
    {open && (
      <Splitter
        axis="y"
        label="Resize the bottom panel"
        value={height}
        min={110}
        max={() => Math.max(160, window.innerHeight - 260)}
        onChange={(v) => useStore.setState({ bottomHeight: v })}
      />
    )}
    <section className={`bottom ${open ? "" : "collapsed"}`} style={open ? { height } : undefined}>
      <div className="tabs" role="tablist">
        {visible.map((t) => (
          <button key={t.id} role="tab" aria-selected={current === t.id && open} className={current === t.id && open ? "on" : ""} onClick={() => setPanel(t.id)}>
            {t.label}
            {t.id === "problems" && errors > 0 && <span className="badge error">{errors}</span>}
            {t.id === "problems" && warnings > 0 && <span className="badge warning">{warnings}</span>}
          </button>
        ))}
        <span className="spacer" />
        <button className="icon collapse-btn" title={open ? "Hide panel (B)" : "Show panel (B)"} aria-label={open ? "Hide panel" : "Show panel"} onClick={() => useStore.setState({ bottomOpen: !open })}>
          {open ? "▾" : "▴"}
        </button>
      </div>
      {open && (
        <div className="tab-body">
          {current === "problems" && <ProblemsList />}
          {current === "elements" && <ElementsPanel />}
          {current === "simulation" && (mode === "simulate" ? isAmbientNet(net) ? <AmbientSimPanel /> : <SimPanel /> : <SimIdle />)}
          {current === "plot" && <PlotPanel />}
          {current === "faultTree" && <FaultTreePanel />}
        </div>
      )}
    </section>
    </>
  );
}

function goTo(id: string) {
  const net = useStore.getState().net;
  const n = net.places.find((p) => p.id === id) ?? net.transitions.find((t) => t.id === id) ?? net.faultTree?.nodes.find((f) => f.id === id) ?? net.arcs.find((a) => a.id === id);
  if (!n) return;
  revealElement(id);
}

function ProblemsList() {
  const net = useStore((s) => s.net);
  const problems = problemsOf(net);
  if (!problems.length) return <div className="empty ok">✓ No problems found.</div>;
  return (
    <ul className="problems">
      {problems.map((p, i) => (
        <li key={i} className={p.severity} onClick={() => p.elementId && goTo(p.elementId)}>
          <span className="sev">{p.severity === "error" ? "Error" : "Warning"}</span>
          {p.message}
        </li>
      ))}
    </ul>
  );
}

function SimIdle() {
  const ambient = useStore((s) => isAmbientNet(s.net));
  if (ambient)
    return (
      <div className="empty">
        Press <b>Simulate</b> (or S) to play the step token game. Fire one structured transition (t, c) at a time, collect several into a step and fire them together, or fire a maximal step.
      </div>
    );
  return (
    <div className="empty">
      Press <b>Simulate</b> (or S) to play the token game. Click green transitions to fire them, or press play to fire at random.
    </div>
  );
}

function SimPanel() {
  const net = useStore((s) => s.net);
  const sim = useStore((s) => s.sim);
  const simIndex = useStore((s) => s.simIndex);
  const cn = compiled(net);
  const step = sim[simIndex];
  const M = step?.marking;
  const ts = step?.timed;
  const listRef = useRef<HTMLOListElement>(null);
  const [wait, setWait] = useState("1");

  const enabled = useMemo(() => {
    if (!M) return [];
    if (ts) return timedEnabled(ts).enabled.flatMap((t) => t.bindings.map((b) => ({ t: cn.transitions[t.index], b, info: t })));
    return cn.transitions.flatMap((t) => enabledBindings(cn, t.index, M).bindings.map((b) => ({ t, b, info: undefined })));
  }, [cn, M, ts]);

  // Transitions that cannot fire now, with the reason, so a stuck model can be diagnosed.
  const blocked = useMemo(() => {
    if (!M || ts) return [];
    const on = new Set(enabled.map((e) => e.t.index));
    return cn.transitions.filter((t) => !on.has(t.index)).slice(0, 200).map((t) => ({ t, why: disabledReasons(cn, t.index, M) }));
  }, [cn, M, ts, enabled]);

  useEffect(() => {
    listRef.current?.querySelector(".current")?.scrollIntoView({ block: "nearest" });
  }, [simIndex]);

  if (!M) return null;
  const tinfo = ts ? timedEnabled(ts) : null;
  return (
    <div className="sim-panel">
      <div className="sim-col">
        <h4>History ({sim.length - 1} steps)</h4>
        <ol className="history" ref={listRef}>
          {sim.map((s, i) => (
            <li key={i} className={i === simIndex ? "current" : i > simIndex ? "future" : ""} onClick={() => simGoto(i)}>
              <span className="step-no">{i}</span>
              {s.label}
            </li>
          ))}
        </ol>
      </div>
      <div className="sim-col">
        {ts && tinfo && (
          <div className="clock-box">
            <div>
              Time <b className="mono">{fmtTime(ts.time)}</b>
            </div>
            <div className="btn-row">
              <button className="small" disabled={!Number.isFinite(tinfo.minDelay) || tinfo.minDelay === 0} onClick={() => advanceTime()}>
                Wait until something can fire{Number.isFinite(tinfo.minDelay) && tinfo.minDelay > 0 ? ` (+${fmtTime(tinfo.minDelay)})` : ""}
              </button>
              <input className="mono" style={{ width: 60 }} value={wait} onChange={(e) => setWait(e.target.value)} aria-label="Time to wait" />
              <button className="small" onClick={() => advanceTime(Number(wait))} disabled={!(Number(wait) >= 0)}>
                Wait
              </button>
            </div>
            {Number.isFinite(tinfo.maxDelay) && <div className="muted small">Something must fire within {fmtTime(tinfo.maxDelay)}.</div>}
          </div>
        )}
        <h4>Enabled ({enabled.length})</h4>
        {enabled.length === 0 ? (
          <div className="empty">Nothing is enabled. The net is dead in this marking.</div>
        ) : (
          <div className="enabled-list">
            {enabled.slice(0, 200).map(({ t, b, info }, i) => (
              <button key={i} onClick={() => fireTransition(t.id, b)} disabled={info && !info.fireable} title={info ? `Interval [${info.eft}, ${info.lft === Infinity ? "∞" : info.lft}], clock ${fmtTime(info.clock)}` : "Fire"}>
                {t.name} {showBinding(b)}
                {info && !info.fireable && <span className="muted small"> in {fmtTime(info.earliest)}</span>}
              </button>
            ))}
          </div>
        )}
        {blocked.length > 0 && (
          <details className="blocked" open={enabled.length === 0}>
            <summary>Cannot fire ({blocked.length})</summary>
            <ul className="blocked-list">
              {blocked.map(({ t, why }) => (
                <li key={t.id} onClick={() => goTo(t.id)} title="Show on the canvas">
                  <b>{t.name}</b> <span className="muted">{why.join("; ") || "not enabled"}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <div className="sim-col">
        <h4>Marking</h4>
        <table className="marking">
          <tbody>
            {cn.places
              .filter((p, i, arr) => arr.findIndex((q) => q.slot === p.slot) === i)
              .map((p) => (
                <tr key={p.id} onClick={() => goTo(p.id)}>
                  <td>{p.name}</td>
                  <td className="mono">{showTokens(cn, M[p.slot]) || (cn.coloured ? "empty" : "0")}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- quantitative simulation ----------

/** Remove coarse (subnet) nodes, which take no part in simulation. */
export function flatNet(net: Net): Net {
  const coarse = new Set([...net.places, ...net.transitions].filter((n) => n.coarse).map((n) => n.id));
  if (!coarse.size) return net;
  return {
    ...net,
    places: net.places.filter((p) => !coarse.has(p.id)),
    transitions: net.transitions.filter((t) => !coarse.has(t.id)),
    arcs: net.arcs.filter((a) => !coarse.has(a.source) && !coarse.has(a.target)),
  };
}

interface PlotSettings {
  end: number;
  points: number;
  runs: number;
  solver: SolverName;
  seed: string;
  show: "places" | "transitions" | "observers";
  colours: "aggregate" | "unfolded";
  logY: boolean;
}

/**
 * Plot settings and the last result live outside the component so they survive switching tabs,
 * running the token game, or collapsing the panel. They reset when another model is loaded.
 */
const usePlot = create<{ st: PlotSettings | null; trace: Trace | null; netAtRun: Net | null; hidden: Set<string>; forNet: string | null }>(() => ({
  st: null,
  trace: null,
  netAtRun: null,
  hidden: new Set(),
  forNet: null,
}));
// Loading a model replaces the net with an empty undo history: start that model with a clean plot.
useStore.subscribe((s, prev) => {
  if (s.net !== prev.net && s.past.length === 0 && s.future.length === 0) usePlot.setState({ st: null, trace: null, netAtRun: null, hidden: new Set() });
});

function PlotPanel() {
  const net = useStore((s) => s.net);
  const tb = timeBase(net.netClass);
  const plot = usePlot();
  const defaults: PlotSettings = { end: 100, points: 201, runs: tb === "continuous" ? 1 : 20, solver: "rk45", seed: "", show: "places", colours: "aggregate", logY: false };
  const st = plot.st ?? defaults;
  const trace = plot.trace;
  const hidden = plot.hidden;
  const setHidden = (f: (h: Set<string>) => Set<string>) => usePlot.setState({ hidden: f(usePlot.getState().hidden) });
  const [progress, setProgress] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<PlotSettings>) => usePlot.setState({ st: { ...st, ...p } });
  const setTrace = (t: Trace | null) => usePlot.setState({ trace: t, netAtRun: t ? net : null });
  const stale = trace && plot.netAtRun !== net;

  const run = async () => {
    const errs = problemsOf(net).filter((p) => p.severity === "error");
    if (errs.length) {
      setError(`Fix ${errs.length} problem${errs.length > 1 ? "s" : ""} first: ${errs[0].message}`);
      return;
    }
    setError(null);
    abort.current = new AbortController();
    setProgress(0);
    try {
      const t = await simulateAsync(flatNet(net), {
        end: st.end,
        points: st.points,
        runs: tb === "continuous" ? 1 : st.runs,
        solver: st.solver,
        seed: st.seed ? Number(st.seed) : undefined,
        signal: abort.current.signal,
        onProgress: (f) => setProgress(f),
        colouredOutput: isColoured(net.netClass) ? "both" : undefined,
      });
      setTrace(t);
      if (t.warnings.length) toast(t.warnings[0]);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };

  const series: (PlotSeries & { id: string })[] = useMemo(() => {
    if (!trace) return [];
    if (st.show === "observers")
      return (trace.observers ?? []).map((s, i) => ({ id: s.id, name: s.name, values: s.values, bands: s.bands?.map((b) => ({ lower: b.lower, upper: b.upper, alpha: b.alpha })), color: SERIES_COLORS[i % SERIES_COLORS.length] }));
    const kind = st.show === "places" ? "place" : "transition";
    return trace.series
      .filter((s) => s.kind === kind && (!isColoured(net.netClass) || (st.colours === "aggregate" ? s.aggregate || !s.colouredId : !s.aggregate)))
      .map((s, i) => ({ id: s.id, name: s.colour ? `${s.name}` : s.name, values: s.values, bands: s.bands?.map((b) => ({ lower: b.lower, upper: b.upper, alpha: b.alpha })), color: SERIES_COLORS[i % SERIES_COLORS.length] }));
  }, [trace, st.show, st.colours, net.netClass]);
  const shown = series.filter((s) => !hidden.has(s.id));

  const exportCsv = () => {
    if (!trace) return;
    downloadText(`${net.name || "simulation"}.csv`, traceToCsv(trace, {}), "text/csv", "csv");
  };

  return (
    <div className="plot-panel">
      <div className="plot-settings">
        <label>
          End time
          <NumInput min={0.001} value={st.end} onChange={(v) => set({ end: v })} />
        </label>
        <label>
          Points
          <NumInput min={2} max={5000} integer value={st.points} onChange={(v) => set({ points: v })} />
        </label>
        {tb !== "continuous" && (
          <label title="Stochastic runs are averaged">
            Runs
            <NumInput min={1} max={10000} integer value={st.runs} onChange={(v) => set({ runs: v })} />
          </label>
        )}
        {tb !== "stochastic" && (
          <label>
            ODE solver
            <select value={st.solver} onChange={(e) => set({ solver: e.target.value as SolverName })}>
              <option value="rk45">Adaptive (Dormand–Prince)</option>
              <option value="rosenbrock">Stiff (Rosenbrock)</option>
              <option value="rk4">Runge–Kutta 4</option>
              <option value="euler">Euler</option>
            </select>
          </label>
        )}
        {tb !== "continuous" && (
          <label title="Same seed, same result">
            Seed
            <input value={st.seed} placeholder="random" style={{ width: 80 }} onChange={(e) => set({ seed: e.target.value.replace(/[^0-9]/g, "") })} />
          </label>
        )}
        {progress === null ? (
          <button className="primary" onClick={run} data-testid="run-plot">
            ▶ Run simulation
          </button>
        ) : (
          <>
            <progress value={progress} max={1} />
            <button onClick={() => abort.current?.abort()}>Stop</button>
          </>
        )}
        {trace && (
          <>
            <button className="small" onClick={exportCsv} title="All curves as comma-separated values">
              Export CSV
            </button>
            <button className="small" onClick={() => exportPlotImage(`${net.name || "simulation"}-plot`)} title="The plot as it is shown, as an SVG image">
              Save image
            </button>
          </>
        )}
      </div>
      {error && <p className="error-text">{error}</p>}
      {!trace && !error && (
        <div className="empty">
          Simulates the net over time{tb === "stochastic" ? " with the Gillespie algorithm" : tb === "continuous" ? " by solving its ODEs" : " (stochastic parts with Gillespie, continuous parts as ODEs)"}
          {isFuzzy(net.netClass) ? "; fuzzy constants such as TFN(1, 2, 3) give shaded bands" : ""}. Rates use the transitions' rate functions and the constants
          in the Net panel.
        </div>
      )}
      {trace && (
        <div className="plot-body">
          <div className="plot-main">
            <LinePlot fill times={trace.times} series={shown} logY={st.logY} yLabel={st.show === "places" ? (tb === "continuous" ? "amount" : "tokens") : st.show === "observers" ? "value" : tb === "continuous" ? "flux" : "firings per interval"} />
            <div className="muted small">
              {stale ? <span className="warn-text">The model changed since this run. Run again to update. · </span> : null}
              {trace.stats.runs} run{trace.stats.runs === 1 ? "" : "s"}
              {trace.stats.events > 0 ? `, ${trace.stats.events.toLocaleString()} event${trace.stats.events === 1 ? "" : "s"}` : ""}, {trace.stats.ms} ms{trace.truncated ? " · stopped early (step limit)" : ""}
            </div>
          </div>
          <div className="plot-legend">
            <div className="seg small">
              <button className={st.show === "places" ? "on" : ""} onClick={() => set({ show: "places" })}>
                Places
              </button>
              <button className={st.show === "transitions" ? "on" : ""} onClick={() => set({ show: "transitions" })}>
                Transitions
              </button>
              {(trace.observers?.length ?? 0) > 0 && (
                <button className={st.show === "observers" ? "on" : ""} onClick={() => set({ show: "observers" })}>
                  Observers
                </button>
              )}
            </div>
            <label className="check small">
              <input type="checkbox" checked={st.logY} onChange={(e) => set({ logY: e.target.checked })} />
              Log scale
            </label>
            {isColoured(net.netClass) && (
              <div className="seg small">
                <button className={st.colours === "aggregate" ? "on" : ""} onClick={() => set({ colours: "aggregate" })}>
                  Totals
                </button>
                <button className={st.colours === "unfolded" ? "on" : ""} onClick={() => set({ colours: "unfolded" })}>
                  Per colour
                </button>
              </div>
            )}
            <div className="legend-actions">
              <button className="link" onClick={() => setHidden(() => new Set())}>
                All
              </button>
              <button className="link" onClick={() => setHidden(() => new Set(series.map((s) => s.id)))}>
                None
              </button>
            </div>
            <ul>
              {series.map((s) => (
                <li key={s.id}>
                  <label>
                    <input type="checkbox" checked={!hidden.has(s.id)} onChange={() => setHidden((h) => { const n = new Set(h); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })} />
                    <span className="dot" style={{ background: s.color }} />
                    {s.name}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

/** Save the plot currently on screen as an SVG file, with its colours resolved. */
function exportPlotImage(name: string) {
  const svg = document.querySelector<SVGSVGElement>(".plot-main .plot svg");
  if (!svg) return;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const r = svg.getBoundingClientRect();
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(Math.round(r.width)));
  clone.setAttribute("height", String(Math.round(r.height)));
  // Copy computed styles of the classed elements: the file has no access to the app's stylesheet.
  const src = svg.querySelectorAll("*");
  clone.querySelectorAll("*").forEach((el, i) => {
    const cs = getComputedStyle(src[i]);
    const style = (el as SVGElement).style;
    for (const prop of ["fill", "stroke", "stroke-width", "stroke-dasharray", "font-size", "font-family", "opacity", "fill-opacity"]) style.setProperty(prop, cs.getPropertyValue(prop));
  });
  const legend = [...document.querySelectorAll(".plot-legend li label")].filter((l) => (l.querySelector("input") as HTMLInputElement)?.checked);
  legend.forEach((l, i) => {
    const color = (l.querySelector(".dot") as HTMLElement).style.background;
    // Build the legend node by node: names come from the model and must never be read as markup.
    const NS = "http://www.w3.org/2000/svg";
    const g = document.createElementNS(NS, "g");
    const swatch = document.createElementNS(NS, "rect");
    for (const [k, v] of [["x", r.width - 150], ["y", 22 + i * 16], ["width", 10], ["height", 10]] as const) swatch.setAttribute(k, String(v));
    swatch.setAttribute("fill", color);
    const text = document.createElementNS(NS, "text");
    for (const [k, v] of [["x", r.width - 135], ["y", 31 + i * 16], ["font-size", 11], ["font-family", "sans-serif"]] as const) text.setAttribute(k, String(v));
    text.textContent = l.textContent ?? "";
    g.append(swatch, text);
    if (i < 20) clone.appendChild(g);
  });
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", "#ffffff");
  clone.insertBefore(bg, clone.firstChild);
  // A strip below the plot for the watermark, so it never sits on the axis labels.
  const h = Math.round(r.height) + WATERMARK_HEIGHT;
  clone.setAttribute("height", String(h));
  markSvgElement(clone, Math.round(r.width), h);
  downloadText(`${name}.svg`, new XMLSerializer().serializeToString(clone), "image/svg+xml", "svg");
}

/**
 * A number box that lets you type freely (even clear it) and only passes on values in range;
 * on leaving the box it shows the value in use again.
 */
export function NumInput({ value, onChange, min = -Infinity, max = Infinity, integer, style }: { value: number; onChange: (v: number) => void; min?: number; max?: number; integer?: boolean; style?: React.CSSProperties }) {
  const [draft, setDraft] = useState<string | null>(null);
  const valid = (t: string) => {
    const v = Number(t);
    return t.trim() !== "" && Number.isFinite(v) && v >= min && v <= max && (!integer || Number.isInteger(v));
  };
  return (
    <input
      type="number"
      min={Number.isFinite(min) ? min : undefined}
      max={Number.isFinite(max) ? max : undefined}
      step={integer ? 1 : "any"}
      className={draft !== null && !valid(draft) ? "invalid" : ""}
      title={Number.isFinite(max) ? `From ${min} to ${max}` : Number.isFinite(min) ? `At least ${min}` : undefined}
      style={style}
      value={draft ?? String(value)}
      onChange={(e) => {
        setDraft(e.target.value);
        if (valid(e.target.value)) onChange(Number(e.target.value));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

// ---------- fault trees ----------

function FaultTreePanel() {
  const net = useStore((s) => s.net);
  const usesRates0 = net.faultTree?.nodes.some((n) => n.failureRate);
  // Rates need a mission time; start with a sensible one rather than an error.
  const [time, setTime] = useState(usesRates0 ? "1000" : "");
  const runRequest = useStore((s) => s.ftRunRequest);
  const [result, setResult] = useState<{ top: TopEventResult; imp: ImportanceMeasure[]; curve?: { times: number[]; unreliability: number[] } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cutSel, setCutSel] = useState<number | null>(null);
  const name = (id: string) => net.faultTree?.nodes.find((n) => n.id === id)?.name ?? id;
  const usesRates = net.faultTree?.nodes.some((n) => n.failureRate);

  const analyse = () => {
    setError(null);
    setCutSel(null);
    useStore.setState({ ftFailed: [] });
    try {
      const t = time.trim() ? Number(time) : undefined;
      if (t !== undefined && !(t >= 0)) throw new Error("Mission time must be a number of zero or more");
      const top = topEventAnalysis(net, { time: t });
      const imp = importanceMeasures(net, { time: t });
      let curve;
      if (t && usesRates) {
        const c = reliabilityCurve(net, { end: t, points: 101 });
        curve = { times: c.times, unreliability: c.unreliability };
      }
      setResult({ top, imp, curve });
    } catch (e) {
      setResult(null);
      setError((e as Error).message);
    }
  };

  // The toolbar's "Analyse tree" button asks for a run.
  useEffect(() => {
    if (runRequest) analyse();
  }, [runRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  const showCut = (i: number, cut: string[]) => {
    setCutSel(i);
    useStore.setState({ ftFailed: cut });
  };

  return (
    <div className="ft-panel">
      <div className="plot-settings">
        <label title="Needed when basic events have failure rates">
          Mission time
          <input value={time} placeholder={usesRates ? "e.g. 1000 (hours)" : "not needed"} onChange={(e) => setTime(e.target.value)} style={{ width: 130 }} />
        </label>
        <button className="primary" onClick={analyse} data-testid="analyse-ft">
          Analyse
        </button>
        <button
          className="small"
          onClick={() => {
            edit((n) => layoutFaultTree(n));
            useStore.setState({ fitRequest: useStore.getState().fitRequest + 1 });
          }}
        >
          Tidy layout
        </button>
        <button
          className="small"
          title="Replace the fault tree with a stochastic Petri net that has the same behaviour (Undo brings the fault tree back)"
          onClick={() => {
            try {
              const pn = faultTreeToPetriNet(net);
              // An ordinary edit, so Undo brings the fault tree back.
              const base = useStore.getState().past.length;
              edit(() => ({ ...pn, name: `${net.name || "Fault tree"} (Petri net)` }));
              useStore.setState({ selection: [], page: null, ftFailed: [] });
              void autoLayout("layeredDown").then(() => {
                // Converting and laying out is one step: a single undo brings the fault tree back.
                const s = useStore.getState();
                const past = s.past.length === base + 2 ? [...s.past.slice(0, base + 1)] : s.past;
                useStore.setState({ past, fitRequest: s.fitRequest + 1 });
              });
              toast("Converted to a stochastic Petri net. Undo brings the fault tree back.");
            } catch (e) {
              toast((e as Error).message, "error");
            }
          }}
        >
          Convert to Petri net
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {!result && !error && <div className="empty">Analyse computes the top event probability, the minimal cut sets and how much each basic event matters.</div>}
      {result && (
        <div className="ft-results">
          <div className="ft-col">
            <div className="stat-row">
              <div className="stat">
                <b>{fmt(result.top.probability)}</b>
                <span>top event probability{result.top.standardError ? ` ± ${fmt(result.top.standardError)}` : ""}</span>
              </div>
              <div className="stat">
                <b>{result.top.minimalCutSets.length}</b>
                <span>minimal cut sets</span>
              </div>
            </div>
            <p className="muted small">
              {result.top.method === "monteCarlo" ? "Monte Carlo simulation (dynamic gates)" : "Exact (BDD)"}. Rare-event approximation {fmt(result.top.rareEvent)}, min-cut upper bound{" "}
              {fmt(result.top.minCutUpperBound)}.
            </p>
            {result.curve && (
              <>
                <h4>Unreliability over the mission</h4>
                <LinePlot times={result.curve.times} series={[{ name: "Unreliability", values: result.curve.unreliability }]} height={150} xLabel="time (hours)" yLabel="P(top event by t)" />
              </>
            )}
          </div>
          <div className="ft-col">
            <h4>Minimal cut sets</h4>
            <p className="muted small">Click one to highlight its events on the canvas.</p>
            <ol className="cutsets">
              {result.top.minimalCutSets.slice(0, 300).map((c, i) => (
                <li key={i} className={cutSel === i ? "on" : ""} onClick={() => showCut(i, c)}>
                  {"{"}
                  {c.map(name).join(", ")}
                  {"}"}
                </li>
              ))}
            </ol>
          </div>
          <div className="ft-col wide">
            <h4>Importance of basic events</h4>
            <table className="imp-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th title="Probability">p</th>
                  <th title="Birnbaum: how much the top probability changes with this event">Birnbaum</th>
                  <th title="Criticality">Crit.</th>
                  <th title="Fussell–Vesely: share of risk through this event">F–V</th>
                  <th title="Risk achievement worth">RAW</th>
                  <th title="Risk reduction worth">RRW</th>
                </tr>
              </thead>
              <tbody>
                {result.imp.map((m) => (
                  <tr key={m.id} onClick={() => select([m.id])}>
                    <td>{m.name}</td>
                    <td className="mono">{fmt(m.probability)}</td>
                    <td className="mono">{fmt(m.birnbaum)}</td>
                    <td className="mono">{fmt(m.criticality)}</td>
                    <td className="mono">{fmt(m.fussellVesely)}</td>
                    <td className="mono">{fmt(m.raw)}</td>
                    <td className="mono">{fmt(m.rrw)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

