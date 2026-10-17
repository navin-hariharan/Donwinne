import React, { useEffect, useRef, useState } from "react";
import { AnalysisReport, Invariant, NodeRef, Status, SummaryItem, analyseNet } from "@pns/analysis";
import { useStore } from "./store";
import { downloadText } from "./fileOps";

/** Properties where "yes" is bad news, so the colours flip. */
const YES_IS_BAD = new Set(["deadTransitions", "inputTransitions", "outputTransitions", "inputPlaces", "outputPlaces", "isolatedNodes"]);

function tone(item: SummaryItem): "good" | "bad" | "neutral" {
  if (item.status !== "yes" && item.status !== "no") return "neutral";
  // Structural classes (free choice, state machine, …) describe the net's shape; neither answer is a problem.
  if (item.group === "structure") return YES_IS_BAD.has(item.key) && item.status === "yes" ? "bad" : "neutral";
  return (item.status === "yes") !== YES_IS_BAD.has(item.key) ? "good" : "bad";
}

function StatusPill({ status, t }: { status: Status; t: "good" | "bad" | "neutral" }) {
  const text = status === "yes" ? "Yes" : status === "no" ? "No" : status === "unknown" ? "Unknown" : "n/a";
  return <span className={`pill ${t} ${status === "unknown" || status === "n/a" ? "muted-pill" : ""}`}>{text}</span>;
}

type Tab = "summary" | "invariants" | "structure" | "siphons" | "matrix";

/** Qualitative analysis (what Charlie computes for Snoopy users), built in: properties, invariants, siphons and traps. */
export function AnalysisDialog({ Modal, close }: { Modal: React.ComponentType<{ title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }>; close: () => void }) {
  const net = useStore((s) => s.net);
  const [limit, setLimit] = useState(100000);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("summary");
  const abort = useRef<AbortController | null>(null);

  const run = () => {
    setBusy(true);
    setError(null);
    abort.current = new AbortController();
    // Let the dialog paint "Analysing…" before the (synchronous) analysis starts.
    setTimeout(() => {
      try {
        setReport(analyseNet(useStore.getState().net, { maxStates: limit, signal: abort.current?.signal }));
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      }
      setBusy(false);
    }, 30);
  };
  useEffect(run, []); // eslint-disable-line react-hooks/exhaustive-deps

  const show = (ids: string[]) => {
    if (!ids.length) return;
    useStore.setState({ highlight: ids, dialog: null });
  };

  const stale = report && (report.net.name !== net.name || report.net.netClass !== net.netClass);

  return (
    <Modal title="Net properties and invariants" onClose={close} wide>
      <div className="rg-head">
        <label>
          Explore up to{" "}
          <input type="number" min={100} max={2000000} step={1000} value={limit} onChange={(e) => setLimit(Math.max(100, Number(e.target.value) || 100))} style={{ width: 110 }} /> states
        </label>
        <button className="small" onClick={run} disabled={busy}>
          {busy ? "Analysing…" : "Analyse again"}
        </button>
        {report && (
          <button className="small" onClick={() => downloadText(`${net.name || "net"}-analysis.txt`, reportText(report), "text/plain")}>
            Save report
          </button>
        )}
      </div>
      {busy && !report && <p className="muted">Analysing the net…</p>}
      {error && <p className="error-text">{error}</p>}
      {report && (
        <>
          {stale && <p className="warn-text small">The model changed since this analysis. Press Analyse again.</p>}
          <div className="stat-row">
            {(["bounded", "live", "deadlockFree", "reversible"] as const).map((k) => {
              const it = report.summary.find((s) => s.key === k);
              if (!it) return null;
              return (
                <div className={`stat ${tone(it)}`} key={k} title={it.explanation}>
                  <b>{it.status === "yes" ? "Yes" : it.status === "no" ? "No" : it.status === "unknown" ? "?" : "–"}</b>
                  <span>
                    {it.label.toLowerCase()}
                    {it.abbreviation ? ` (${it.abbreviation})` : ""}
                  </span>
                </div>
              );
            })}
            <div className="stat">
              <b>
                {report.behaviour.states.toLocaleString()}
                {report.behaviour.exploration === "truncated" ? "+" : ""}
              </b>
              <span>reachable states</span>
            </div>
            <div className="stat">
              <b>{report.invariants.p.invariants.length}</b>
              <span>P-invariants</span>
            </div>
            <div className="stat">
              <b>{report.invariants.t.invariants.length}</b>
              <span>T-invariants</span>
            </div>
          </div>
          {report.errors.map((e, i) => (
            <p key={`e${i}`} className="error-text small">
              {e}
            </p>
          ))}
          {report.warnings.length > 0 && (
            <details className="analysis-warnings">
              <summary>
                {report.warnings.length} note{report.warnings.length === 1 ? "" : "s"} on what the analysis covers
              </summary>
              <ul>
                {report.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="tabs analysis-tabs" role="tablist">
            {(
              [
                ["summary", "Properties"],
                ["invariants", "Invariants"],
                ["siphons", "Siphons and traps"],
                ["structure", "Structure"],
                ["matrix", "Incidence matrix"],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="analysis-body">
            {tab === "summary" && <SummaryList items={report.summary.filter((s) => s.group !== "structure")} show={show} />}
            {tab === "structure" && <SummaryList items={report.summary.filter((s) => s.group === "structure")} show={show} />}
            {tab === "invariants" && (
              <>
                <InvariantList title="P-invariants" hint="Weighted token sums that never change. Click one to highlight its places." list={report.invariants.p.invariants} truncated={report.invariants.p.truncated} show={show} sum />
                <InvariantList title="T-invariants" hint="Firing counts that reproduce the marking they start from." list={report.invariants.t.invariants} truncated={report.invariants.t.truncated} show={show} />
              </>
            )}
            {tab === "siphons" && (
              <>
                <h3>Minimal siphons {report.siphonsTraps.siphonsTruncated ? "(first ones only)" : `(${report.siphonsTraps.siphons.length})`}</h3>
                <p className="muted small">Once a siphon is empty it stays empty. A siphon without a marked trap inside can empty, and the transitions it feeds then die.</p>
                <ul className="inv-list">
                  {report.siphonsTraps.siphons.map((s, i) => (
                    <li key={i} onClick={() => show(refIds(s.places))}>
                      <span className="mono">{`{${s.places.map((p) => p.name).join(", ")}}`}</span>
                      <span className={`pill ${s.containsMarkedTrap ? "good" : "bad"}`}>{s.containsMarkedTrap ? "has marked trap" : "no marked trap"}</span>
                    </li>
                  ))}
                  {!report.siphonsTraps.siphons.length && <li className="muted">None.</li>}
                </ul>
                <h3>Minimal traps {report.siphonsTraps.trapsTruncated ? "(first ones only)" : `(${report.siphonsTraps.traps.length})`}</h3>
                <p className="muted small">Once a trap holds a token it always will.</p>
                <ul className="inv-list">
                  {report.siphonsTraps.traps.map((s, i) => (
                    <li key={i} onClick={() => show(refIds(s.places))}>
                      <span className="mono">{`{${s.places.map((p) => p.name).join(", ")}}`}</span>
                      <span className="muted small">{s.marked ? "marked" : "unmarked"}</span>
                    </li>
                  ))}
                  {!report.siphonsTraps.traps.length && <li className="muted">None.</li>}
                </ul>
              </>
            )}
            {tab === "matrix" && <Matrix report={report} />}
          </div>
          {report.behaviour.firstDeadlock && (
            <p className="small">
              <b>Shortest path to a deadlock:</b> <span className="mono">{report.behaviour.firstDeadlock.path.map((t) => t.name).join(" → ") || "(the initial marking)"}</span>
            </p>
          )}
        </>
      )}
    </Modal>
  );
}

const refIds = (refs: NodeRef[]) => [...new Set(refs.flatMap((r) => r.elementIds))];

function SummaryList({ items, show }: { items: SummaryItem[]; show: (ids: string[]) => void }) {
  return (
    <table className="prop-table">
      <tbody>
        {items.map((it) => (
          <tr key={it.key} title={it.description}>
            <td className="prop-name">
              {it.abbreviation && <abbr className="abbr-tag" title={`Abbreviation used by Charlie and in Konios (2015, §7.2)`}>{it.abbreviation}</abbr>}
              {it.label}
              <div className="muted small">{it.description}</div>
            </td>
            <td>
              <StatusPill status={it.status} t={tone(it)} />
            </td>
            <td className="small">{it.explanation.replace(/^(Yes|No|Unknown|n\/a): /, "")}</td>
            <td>
              {it.elementIds.length > 0 && (
                <button className="small" onClick={() => show(it.elementIds)} title="Close and highlight these elements on the canvas">
                  Show
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function InvariantList({ title, hint, list, truncated, show, sum }: { title: string; hint: string; list: Invariant[]; truncated: boolean; show: (ids: string[]) => void; sum?: boolean }) {
  return (
    <>
      <h3>
        {title} ({list.length}
        {truncated ? "+" : ""})
      </h3>
      <p className="muted small">{hint}</p>
      <ul className="inv-list">
        {list.map((inv, i) => (
          <li key={i} onClick={() => show(refIds(inv.support))}>
            <span className="mono">{inv.text}</span>
            {sum && inv.tokenSum !== undefined && <span className="muted mono"> = {inv.tokenSum}</span>}
          </li>
        ))}
        {!list.length && <li className="muted">None.</li>}
      </ul>
    </>
  );
}

function Matrix({ report }: { report: AnalysisReport }) {
  const { incidence, places, transitions } = report;
  if (places.length > 80 || transitions.length > 80) return <p className="muted">The matrix is too large to show ({places.length} × {transitions.length}). Save the report to get it as text.</p>;
  return (
    <div className="rg-table-wrap">
      <table className="rg-table matrix">
        <thead>
          <tr>
            <th />
            {transitions.map((t) => (
              <th key={t.id}>{t.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {places.map((p, i) => (
            <tr key={p.id}>
              <th>{p.name}</th>
              {incidence.rows[i].map((v, j) => (
                <td key={j} className={`mono ${v > 0 ? "pos" : v < 0 ? "neg" : "zero"}`}>
                  {v === 0 ? "·" : v > 0 ? `+${v}` : v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Plain-text version of the report, for saving or pasting into a paper. */
export function reportText(r: AnalysisReport): string {
  const out: string[] = [];
  out.push(`Analysis of "${r.net.name}" (${r.net.places} places, ${r.net.transitions} transitions${r.net.unfolded ? ", unfolded" : ""})`, "");
  for (const g of ["behaviour", "invariants", "siphons", "structure"] as const) {
    out.push(`== ${g[0].toUpperCase() + g.slice(1)} ==`);
    for (const s of r.summary.filter((x) => x.group === g)) out.push(`${s.abbreviation ? `[${s.abbreviation}] ` : ""}${s.label}: ${s.explanation}`);
    out.push("");
  }
  out.push("== P-invariants ==", ...r.invariants.p.invariants.map((i) => `${i.text}${i.tokenSum !== undefined ? ` = ${i.tokenSum}` : ""}`), "");
  out.push("== T-invariants ==", ...r.invariants.t.invariants.map((i) => i.text), "");
  out.push("== Minimal siphons ==", ...r.siphonsTraps.siphons.map((s) => `{${s.places.map((p) => p.name).join(", ")}}${s.containsMarkedTrap ? "" : "  (no marked trap)"}`), "");
  out.push("== Minimal traps ==", ...r.siphonsTraps.traps.map((s) => `{${s.places.map((p) => p.name).join(", ")}}`), "");
  out.push("== Incidence matrix ==", ["", ...r.transitions.map((t) => t.name)].join("\t"), ...r.places.map((p, i) => [p.name, ...r.incidence.rows[i]].join("\t")), "");
  if (r.warnings.length) out.push("== Notes ==", ...r.warnings);
  return out.join("\n");
}
