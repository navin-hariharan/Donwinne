import React, { useLayoutEffect, useMemo, useRef } from "react";
import { Marking, Net, showTokens, showValue } from "@pns/core";
import { StructuredTransition, asAmbient, conflicts, markingPairs, showStep, sortSteps } from "@pns/apn";
import { compiled, simGoto, useStore } from "./store";
import { revealElement } from "./Elements";
import {
  BlockReason,
  allStructured,
  conflictReason,
  enabledAt,
  fireAmbientStep,
  fireMaximalStep,
  firePending,
  pendingStatus,
  showST,
  stKey,
  stepsAt,
  togglePending,
  useAmbient,
  whyBlocked,
} from "./ambient";

/** The step token game of an APN or T-APN (Konios Sec. 3.3, 5.2), in the bottom panel. */
export function AmbientSimPanel() {
  const net = useStore((s) => s.net);
  const sim = useStore((s) => s.sim);
  const simIndex = useStore((s) => s.simIndex);
  const pending = useAmbient((s) => s.pending);
  const maximalOnly = useAmbient((s) => s.maximalOnly);
  const M = sim[simIndex]?.marking;
  const listRef = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => {
    listRef.current?.querySelector(".current")?.scrollIntoView({ block: "nearest" });
  }, [simIndex]);
  if (!M) return null;
  return (
    <div className="sim-panel ambient">
      <div className="sim-col">
        <h4>History ({sim.length - 1} steps)</h4>
        <ol className="history" ref={listRef} data-testid="step-history">
          {sim.map((s, i) => (
            <li key={i} className={i === simIndex ? "current" : i > simIndex ? "future" : ""} onClick={() => simGoto(i)}>
              <span className="step-no">{i}</span>
              {s.label}
            </li>
          ))}
        </ol>
      </div>
      <FireColumn net={net} M={M} pending={pending} maximalOnly={maximalOnly} />
      <WhyColumn net={net} M={M} />
      <MarkingColumn net={net} M={M} />
    </div>
  );
}

function FireColumn({ net, M, pending, maximalOnly }: { net: Net; M: Marking; pending: StructuredTransition[]; maximalOnly: boolean }) {
  const enabled = enabledAt(net, M);
  const steps = useMemo(() => {
    const r = stepsAt(net, M, maximalOnly);
    return { ...r, steps: sortSteps(net, r.steps) };
  }, [net, M, maximalOnly]);
  const pendingKeys = new Set(pending.map(stKey));
  const status = pendingStatus(net, M, pending);
  return (
    <div className="sim-col">
      <h4>Structured transitions ({enabled.length} enabled)</h4>
      {enabled.length === 0 ? (
        <div className="empty">No step is enabled. The net is dead in this marking.</div>
      ) : (
        <ul className="st-list" data-testid="st-list">
          {enabled.map((st) => {
            const k = stKey(st);
            const label = showST(net, st);
            return (
              <li key={k}>
                <label className="st-pick">
                  <input type="checkbox" checked={pendingKeys.has(k)} onChange={() => togglePending(st)} aria-label={`Add ${label} to the step`} />
                  <span className="mono">{label}</span>
                </label>
                <button className="small fire-btn" onClick={() => fireAmbientStep([st])} title={`Fire the step {${label}}`}>
                  Fire
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {pending.length > 0 && (
        <div className={`step-box ${status.ok ? "ok" : "bad"}`} data-testid="pending-step">
          <div className="mono">U = {showStep(net, pending)}</div>
          <div className="small">{status.text}</div>
          <div className="btn-row">
            <button className="small primary" disabled={!status.ok} onClick={firePending}>
              Fire this step
            </button>
            <button className="small" onClick={() => useAmbient.setState({ pending: [] })}>
              Clear
            </button>
          </div>
        </div>
      )}
      <div className="steps-head">
        <h4>Enabled steps</h4>
        <div className="seg mini" role="tablist" aria-label="Which steps to list">
          <button role="tab" aria-selected={!maximalOnly} className={!maximalOnly ? "on" : ""} onClick={() => useAmbient.setState({ maximalOnly: false })}>
            All
          </button>
          <button role="tab" aria-selected={maximalOnly} className={maximalOnly ? "on" : ""} onClick={() => useAmbient.setState({ maximalOnly: true })} data-testid="maximal-toggle">
            Maximal
          </button>
        </div>
      </div>
      <div className="enabled-list">
        {steps.steps.slice(0, 120).map((U, i) => (
          <button key={i} onClick={() => fireAmbientStep(U)} title={U.length > 1 ? "Fire these structured transitions together" : "Fire"}>
            {showStep(net, U)}
          </button>
        ))}
      </div>
      {(steps.truncated || steps.steps.length > 120) && <div className="muted small">Showing {Math.min(120, steps.steps.length)} steps; there are more.</div>}
      <div className="btn-row">
        <button className="small" onClick={() => fireMaximalStep()} disabled={!enabled.length} data-testid="fire-maximal">
          Fire a maximal step
        </button>
      </div>
    </div>
  );
}

function WhyColumn({ net, M }: { net: Net; M: Marking }) {
  const enabled = enabledAt(net, M);
  const blocked = useMemo(() => {
    const on = new Set(enabled.map(stKey));
    return allStructured(net)
      .filter((st) => !on.has(stKey(st)))
      .map((st) => ({ st, reasons: whyBlocked(net, M, st) }));
  }, [net, M, enabled]);
  const pairs = useMemo(() => {
    try {
      return conflicts(net, M);
    } catch {
      return [];
    }
  }, [net, M]);
  const inhibited = blocked.filter((b) => b.reasons.some((r) => r.kind === "inhibitor"));
  const others = blocked.filter((b) => !b.reasons.some((r) => r.kind === "inhibitor"));
  return (
    <div className="sim-col">
      <h4>Conflicts (Def. 4)</h4>
      {pairs.length === 0 ? (
        <div className="muted small pad-b">None: every pair of enabled structured transitions can fire together.</div>
      ) : (
        <ul className="why-list" data-testid="conflicts">
          {pairs.map(([a, b], i) => (
            <li key={i}>
              <span className="mono">
                {showST(net, a)} # {showST(net, b)}
              </span>
              <span className="muted small"> {conflictReason(net, M, a, b)}</span>
            </li>
          ))}
        </ul>
      )}
      <h4>Blocked by colour-sensitive inhibitors</h4>
      {inhibited.length === 0 ? (
        <div className="muted small pad-b">No inhibitor arc blocks a colour mode here.</div>
      ) : (
        <ul className="why-list" data-testid="inhibited">
          {inhibited.map(({ st, reasons }) => (
            <WhyItem key={stKey(st)} net={net} st={st} reasons={reasons} />
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <details className="why-more">
          <summary>Other structured transitions that cannot fire ({others.length})</summary>
          <ul className="why-list">
            {others.slice(0, 300).map(({ st, reasons }) => (
              <WhyItem key={stKey(st)} net={net} st={st} reasons={reasons} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function WhyItem({ net, st, reasons }: { net: Net; st: StructuredTransition; reasons: BlockReason[] }) {
  const target = reasons.find((r) => r.kind === "inhibitor")?.arcId ?? reasons[0]?.placeId ?? st.transition;
  return (
    <li onClick={() => revealElement(target)} title="Show it on the canvas">
      <span className="mono">{showST(net, st)}</span>
      {reasons.slice(0, 3).map((r, i) => (
        <span key={i} className={`why ${r.kind}`}>
          {r.kind === "inhibitor" && <span className="pill bad">inhibitor</span>} {r.text}
        </span>
      ))}
    </li>
  );
}

function MarkingColumn({ net, M }: { net: Net; M: Marking }) {
  const cn = compiled(net);
  const pairs = useMemo(() => markingPairs(net, M), [net, M]);
  return (
    <div className="sim-col">
      <h4>Marking</h4>
      <table className="marking">
        <tbody>
          {cn.places
            .filter((p, i, arr) => arr.findIndex((q) => q.slot === p.slot) === i)
            .map((p) => (
              <tr key={p.id} onClick={() => revealElement(p.id)}>
                <td>{p.name}</td>
                <td className="mono">{showTokens(cn, M[p.slot]) || "empty"}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <h4 className="pad-t">As structured places</h4>
      <div className="mono small pairs">{pairs.join(" ") || "∅"}</div>
    </div>
  );
}

/** Colour modes of a transition tapped in the step token game: fire one, add it to the step, or see why not. */
export function StepPicker() {
  const picker = useAmbient((s) => s.picker);
  const pending = useAmbient((s) => s.pending);
  const net = useStore((s) => s.net);
  const M = useStore((s) => (s.mode === "simulate" ? s.sim[s.simIndex]?.marking : undefined));
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.offsetParent as HTMLElement | null;
    if (!picker || !el || !box) return;
    el.style.left = `${Math.max(4, Math.min(picker.x + 12, box.clientWidth - el.offsetWidth - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(picker.y + 12, box.clientHeight - el.offsetHeight - 4))}px`;
  }, [picker]);
  if (!picker || !M) return null;
  const t = asAmbient(net).transitions.find((x) => x.id === picker.transitionId);
  if (!t) return null;
  const on = new Set(enabledAt(net, M).map(stKey));
  const inStep = new Set(pending.map(stKey));
  return (
    <div className="binding-picker step-picker" ref={ref} style={{ left: picker.x + 12, top: picker.y + 12 }} role="menu" data-testid="step-picker">
      <div className="binding-title">{t.name}: colour modes</div>
      {t.modes.length === 0 && <div className="why small">This transition has no colour mode.</div>}
      {t.modes.map((c) => {
        const st = { transition: t.id, colour: c };
        const k = stKey(st);
        const label = `(${t.name},${showValue(c)})`;
        if (!on.has(k)) {
          const r = whyBlocked(net, M, st);
          return (
            <div key={k} className="picker-row blocked">
              <span className="mono">{label}</span>
              <span className={`why small ${r[0]?.kind ?? ""}`}>{r[0]?.text ?? "Not enabled"}</span>
            </div>
          );
        }
        return (
          <div key={k} className="picker-row">
            <button role="menuitem" className="pick-fire" onClick={() => fireAmbientStep([st])}>
              Fire {label}
            </button>
            <button role="menuitemcheckbox" aria-checked={inStep.has(k)} className={`pick-add ${inStep.has(k) ? "on" : ""}`} onClick={() => togglePending(st)} title={inStep.has(k) ? "Take it out of the step" : "Add it to the step"}>
              {inStep.has(k) ? "✓ in step" : "+ step"}
            </button>
          </div>
        );
      })}
      <button className="ghost" onClick={() => useAmbient.setState({ picker: null })}>
        Close
      </button>
    </div>
  );
}

/** The step being collected, over the canvas: fire it or clear it without opening the bottom panel. */
export function StepTray() {
  const pending = useAmbient((s) => s.pending);
  const collecting = useAmbient((s) => s.collecting);
  const net = useStore((s) => s.net);
  const M = useStore((s) => (s.mode === "simulate" ? s.sim[s.simIndex]?.marking : undefined));
  if (!M || (!pending.length && !collecting)) return null;
  const status = pendingStatus(net, M, pending);
  return (
    <div className={`step-tray ${pending.length ? (status.ok ? "ok" : "bad") : ""}`} role="status" data-testid="step-tray">
      {pending.length ? (
        <>
          <span className="mono step-tray-text" title={status.text}>
            {showStep(net, pending)}
          </span>
          <button className="small primary" disabled={!status.ok} onClick={firePending} title={status.text}>
            Fire step
          </button>
          <button className="small" onClick={() => useAmbient.setState({ pending: [] })}>
            Clear
          </button>
        </>
      ) : (
        <span className="muted small">Tap green transitions to collect a step</span>
      )}
      {pending.length > 0 && !status.ok && <span className="step-tray-why small">{status.text}</span>}
    </div>
  );
}

/** Handle a click or tap on a transition in the step token game. */
export function ambientTransitionClick(net: Net, M: Marking, transitionId: string, at: { x: number; y: number }) {
  const t = asAmbient(net).transitions.find((x) => x.id === transitionId);
  if (!t) return;
  const en = enabledAt(net, M).filter((st) => st.transition === transitionId);
  const { collecting } = useAmbient.getState();
  if (en.length === 1 && (t.modes.length === 1 || !collecting)) {
    if (collecting) togglePending(en[0]);
    else fireAmbientStep([en[0]]);
    return;
  }
  useAmbient.setState({ picker: { transitionId, x: at.x, y: at.y } });
}
