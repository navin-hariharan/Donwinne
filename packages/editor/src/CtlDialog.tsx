import React, { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { Net } from "@pns/core";
import {
  AdviceComparison,
  CtlError,
  CtlResult,
  CtlTrace,
  FaultToleranceReport,
  FiringPath,
  PROPERTY_TEMPLATES,
  PathResult,
  PropertyTemplate,
  TemplateArgs,
  TemplateField,
  TemplateValue,
  TransitionSystem,
  checkCtl,
  compareAdvicePaths,
  ctlProblems,
  faultTolerance,
  findPaths,
  instantiateTemplate,
} from "@pns/analysis";
import { useStore } from "./store";
import { CtlSemantics, SEMANTICS_LABEL, buildSystem, placeChoices, replayTrace, semanticsFor, transitionChoices, vocabularyOf } from "./ctl";
import type { ModalType } from "./AmbientDialogs";

interface SavedFormula {
  id: number;
  label: string;
  text: string;
  /** The verdict the thesis expects for a working system, when the formula came from a template. */
  expected?: boolean;
  result?: CtlResult;
  error?: string;
}

/** Formulas and settings survive closing the dialog (e.g. to replay a trace and come back). */
const useCtl = create<{ text: string; label: string; expected?: boolean; list: SavedFormula[]; last: SavedFormula | null; tab: Tab; templateId: string; args: TemplateArgs }>(() => ({
  text: "",
  label: "",
  list: [],
  last: null,
  tab: "formulas",
  templateId: PROPERTY_TEMPLATES[0]?.id ?? "",
  args: {},
}));
let nextId = 1;

type Tab = "formulas" | "paths" | "faults";

/** Model checking of Konios (2015, ch. 7): CTL formulas and templates, path queries and fault tolerance. */
export function CtlDialog({ Modal, close }: { Modal: ModalType; close: () => void }) {
  const net = useStore((s) => s.net);
  const tab = useCtl((s) => s.tab);
  const sems = semanticsFor(net);
  const [semantics, setSemantics] = useState<CtlSemantics>(sems[0]);
  const [limit, setLimit] = useState(sems.length > 1 ? 20000 : 50000);
  const [deadlocks, setDeadlocks] = useState<"stutter" | "maximal">("stutter");
  const [sys, setSys] = useState<{ ts: TransitionSystem; net: Net; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const key = `${semantics}|${limit}`;
  const current = sys && sys.net === net && sys.key === key ? sys.ts : null;

  /** The state space for the current settings, built on first use. */
  const system = async (): Promise<TransitionSystem | null> => {
    if (current) return current;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const ts = await buildSystem(net, semantics, { maxStates: limit, signal: ac.signal, onProgress: setProgress });
      setSys({ ts, net, key });
      return ts;
    } catch (e) {
      setError((e as Error).name === "AbortError" ? "Stopped." : (e as Error).message);
      return null;
    } finally {
      if (abort.current === ac) setBusy(false);
    }
  };

  return (
    <Modal title="Model checking (CTL)" onClose={close} wide>
      <div className="rg-head wrap ctl-settings">
        <label>
          Semantics{" "}
          <select value={semantics} onChange={(e) => setSemantics(e.target.value as CtlSemantics)} data-testid="ctl-semantics">
            {sems.map((s) => (
              <option key={s} value={s}>
                {SEMANTICS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          up to <input type="number" min={100} max={2000000} step={1000} value={limit} onChange={(e) => setLimit(Math.max(100, Number(e.target.value) || 100))} style={{ width: 100 }} /> states
        </label>
        <label title="How paths that end in a dead marking are read">
          Dead markings{" "}
          <select value={deadlocks} onChange={(e) => setDeadlocks(e.target.value as "stutter" | "maximal")}>
            <option value="stutter">repeat forever</option>
            <option value="maximal">end the path</option>
          </select>
        </label>
        {busy && (
          <button className="small" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        )}
      </div>
      <p className="muted small" role="status" data-testid="ctl-status">
        {busy
          ? `Building the state space… ${progress ? `${progress.toLocaleString()} states` : ""}`
          : current
            ? `State space: ${current.markings.length.toLocaleString()} states, ${current.complete ? "complete" : "cut off at the limit (verdicts that depend on the rest are unknown)"}.`
            : "The state space is built when you first check something."}
      </p>
      {error && <p className="error-text small">{error}</p>}
      <div className="tabs analysis-tabs" role="tablist">
        {(
          [
            ["formulas", "Formulas"],
            ["paths", "Paths"],
            ["faults", "Fault tolerance"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => useCtl.setState({ tab: id })}>
            {label}
          </button>
        ))}
      </div>
      {tab === "formulas" && <FormulasTab net={net} system={system} deadlocks={deadlocks} busy={busy} />}
      {tab === "paths" && <PathsTab net={net} system={system} deadlocks={deadlocks} busy={busy} />}
      {tab === "faults" && <FaultsTab net={net} limit={limit} deadlocks={deadlocks} />}
    </Modal>
  );
}

type SystemFn = () => Promise<TransitionSystem | null>;

// ---------- formulas ----------

const CATEGORY_LABEL: Record<string, string> = {
  "ambient guidance": "Ambient guidance (7.1.1.1)",
  "ambient information": "Ambient information (7.1.1.2)",
  "common ambient": "Common ambient (7.1.1.3)",
  "general guidance": "General guidance (7.1.2.1)",
  "common general": "Common general (7.1.2.2)",
  "fault tolerance": "Fault tolerance (7.3.3)",
};

function FormulaBox({ net, value, onChange, testid, rows = 3, placeholder }: { net: Net; value: string; onChange: (v: string) => void; testid?: string; rows?: number; placeholder?: string }) {
  const problems = useMemo(() => {
    if (!value.trim()) return [];
    const v = vocabularyOf(net);
    if (v instanceof Error) return [];
    try {
      return ctlProblems(value, v);
    } catch (e) {
      return [e as CtlError];
    }
  }, [net, value]);
  const p = problems[0];
  const ref = useRef<HTMLTextAreaElement>(null);
  const replace = (s: string) => {
    if (!p || p.start === undefined) return;
    onChange(value.slice(0, p.start) + s + value.slice(p.end));
    requestAnimationFrame(() => ref.current?.focus());
  };
  return (
    <div className="formula-box">
      <textarea
        ref={ref}
        className="mono"
        rows={rows}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!p}
        data-testid={testid}
      />
      {p && (
        <div className="formula-error small" role="alert">
          <span className="error-text">{p.message}</span>
          {p.expected?.length > 0 && <span className="muted"> Expected {p.expected.slice(0, 6).join(", ")}.</span>}
          {p.suggestions?.length > 0 && (
            <span>
              {" "}
              Did you mean{" "}
              {p.suggestions.map((s) => (
                <button key={s} className="link-btn mono" onClick={() => replace(s)}>
                  {s}
                </button>
              ))}
              ?
            </span>
          )}
        </div>
      )}
      {!p && value.trim() && <div className="ok-text small">✓ Well formed</div>}
    </div>
  );
}

function SyntaxHelp() {
  return (
    <details className="syntax-help">
      <summary>Syntax</summary>
      <dl>
        <dt>Atoms</dt>
        <dd className="mono">p · p[c] · sum(p,q) · p == 2 · p != q · &lt; &lt;= &gt; &gt;=</dd>
        <dt>Propositions</dt>
        <dd className="mono">deadlock · fireable(t)</dd>
        <dt>Boolean</dt>
        <dd className="mono">! &amp; | -&gt; &lt;-&gt;</dd>
        <dt>Temporal</dt>
        <dd className="mono">EX AX EF AF EG AG · E[φ U ψ] · A[φ U ψ]</dd>
      </dl>
      <p className="muted small">A place alone means “holds a token”; p[c] counts the tokens of colour c. Coloured transitions read t&lt;x=c&gt;.</p>
    </details>
  );
}

function PlaceSelect({ net, value, onChange, label }: { net: Net; value: string; onChange: (v: string) => void; label: string }) {
  const choices = useMemo(() => placeChoices(net), [net]);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">—</option>
      {value && !choices.some((c) => c.value === value) && <option value={value}>{value} (not in this net)</option>}
      {choices.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

function MultiSelect({ options, value, onChange, label }: { options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; label: string }) {
  return (
    <div className="multi">
      <div className="chips">
        {value.map((v) => (
          <button key={v} type="button" className="chip on" onClick={() => onChange(value.filter((x) => x !== v))} title="Remove" aria-label={`Remove ${v}`}>
            {v} ✕
          </button>
        ))}
      </div>
      <select value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])} aria-label={label}>
        <option value="">+ add…</option>
        {options
          .filter((o) => !value.includes(o.value))
          .map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
      </select>
    </div>
  );
}

function FieldInput({ net, f, value, onChange }: { net: Net; f: TemplateField; value: TemplateValue; onChange: (v: TemplateValue) => void }) {
  const places = useMemo(() => placeChoices(net), [net]);
  switch (f.kind) {
    case "place":
      return <PlaceSelect net={net} value={(value as string) ?? ""} onChange={(v) => onChange(v || undefined)} label={f.label} />;
    case "places":
      return <MultiSelect options={places} value={(value as string[]) ?? []} onChange={onChange} label={f.label} />;
    case "number":
      return <input type="number" min={0} value={value === undefined ? "" : String(value)} placeholder={f.default !== undefined ? String(f.default) : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} aria-label={f.label} />;
    case "choice":
      return (
        <select value={(value as string) ?? String(f.default ?? "")} onChange={(e) => onChange(e.target.value)} aria-label={f.label}>
          {f.options?.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
  }
}

function TemplatePicker({ net, onUse }: { net: Net; onUse: (t: PropertyTemplate, formulas: { label: string; text: string; expected: boolean }[]) => void }) {
  const templateId = useCtl((s) => s.templateId);
  const args = useCtl((s) => s.args);
  const t = PROPERTY_TEMPLATES.find((x) => x.id === templateId) ?? PROPERTY_TEMPLATES[0];
  const [error, setError] = useState<string | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, PropertyTemplate[]>();
    for (const x of PROPERTY_TEMPLATES) (m.get(x.category) ?? m.set(x.category, []).get(x.category)!).push(x);
    return [...m];
  }, []);
  if (!t) return null;
  const setArgs = (a: TemplateArgs) => useCtl.setState({ args: a });
  const use = () => {
    try {
      onUse(t, instantiateTemplate(t.id, args));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="template-picker" data-testid="template-picker">
      <label className="field">
        <span className="field-label">Property template</span>
        <select value={t.id} onChange={(e) => (useCtl.setState({ templateId: e.target.value, args: {} }), setError(null))} data-testid="template-select">
          {groups.map(([cat, list]) => (
            <optgroup key={cat} label={CATEGORY_LABEL[cat] ?? cat}>
              {list.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.section} {x.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <p className="small">{t.summary}</p>
      <p className="muted small template-statement">“{t.statement}” (§{t.section})</p>
      {t.note && <p className="muted small">{t.note}</p>}
      {t.params.map((p) =>
        p.kind === "rules" ? (
          <div key={p.name} className="field">
            <span className="field-label">{p.label}</span>
            <span className="field-hint">{p.description}</span>
            <div className="rules">
              {((args[p.name] as Record<string, TemplateValue>[] | undefined) ?? []).map((row, i, rows) => (
                <div key={i} className="rule-row">
                  {p.fields.map((f) => (
                    <label key={f.name} className="rule-cell" title={f.description}>
                      <span className="small muted">{f.label}</span>
                      <FieldInput net={net} f={f} value={row[f.name]} onChange={(v) => setArgs({ ...args, [p.name]: rows.map((r, j) => (j === i ? { ...r, [f.name]: v } : r)) })} />
                    </label>
                  ))}
                  <button className="icon small" aria-label={`Remove row ${i + 1}`} onClick={() => setArgs({ ...args, [p.name]: rows.filter((_, j) => j !== i) })}>
                    ✕
                  </button>
                </div>
              ))}
              <button className="small" onClick={() => setArgs({ ...args, [p.name]: [...((args[p.name] as Record<string, TemplateValue>[] | undefined) ?? []), {}] })}>
                + Row
              </button>
            </div>
          </div>
        ) : (
          <label key={p.name} className="field" title={p.description}>
            <span className="field-label">
              {p.label}
              {p.optional ? " (optional)" : ""}
            </span>
            <FieldInput net={net} f={p} value={args[p.name] as TemplateValue} onChange={(v) => setArgs({ ...args, [p.name]: v })} />
            <span className="field-hint">{p.description}</span>
          </label>
        ),
      )}
      {error && <p className="error-text small">{error}</p>}
      <div className="btn-row">
        <button className="small" onClick={() => setArgs(JSON.parse(JSON.stringify(t.example)) as TemplateArgs)} title="The arguments the thesis uses for its case study" data-testid="template-example">
          Thesis example
        </button>
        <button className="small primary" onClick={use} data-testid="template-use">
          Use this property
        </button>
      </div>
    </section>
  );
}

function FormulasTab({ net, system, deadlocks, busy }: { net: Net; system: SystemFn; deadlocks: "stutter" | "maximal"; busy: boolean }) {
  const { text, label, expected, list, last } = useCtl();
  const [checking, setChecking] = useState(false);
  const check = async (f: SavedFormula): Promise<SavedFormula> => {
    const ts = await system();
    if (!ts) return { ...f, result: undefined, error: "No state space" };
    try {
      return { ...f, result: checkCtl(ts, f.text, { deadlocks, trace: true }), error: undefined };
    } catch (e) {
      return { ...f, result: undefined, error: (e as Error).message };
    }
  };
  const checkBox = async () => {
    if (!text.trim()) return;
    setChecking(true);
    const r = await check({ id: 0, label: label || "Formula", text, expected });
    useCtl.setState({ last: r });
    setChecking(false);
  };
  const checkAll = async () => {
    setChecking(true);
    const out: SavedFormula[] = [];
    for (const f of useCtl.getState().list) {
      out.push(await check(f));
      await new Promise((r) => setTimeout(r, 0));
    }
    useCtl.setState({ list: out });
    setChecking(false);
  };
  const add = (f: Omit<SavedFormula, "id">) => useCtl.setState((s) => ({ list: [...s.list, { ...f, id: nextId++ }] }));
  return (
    <div className="ctl-formulas">
      <div className="ctl-grid">
        <TemplatePicker
          net={net}
          onUse={(t, fs) => {
            useCtl.setState({ text: fs[0].text, label: fs.length > 1 ? `${t.title}: ${fs[0].label}` : t.title, expected: fs[0].expected, last: null });
            for (const f of fs.slice(1)) add({ label: `${t.title}: ${f.label}`, text: f.text, expected: f.expected });
          }}
        />
        <section className="formula-section">
          <label className="field">
            <span className="field-label">Formula{label ? `: ${label}` : ""}</span>
          </label>
          <FormulaBox net={net} value={text} onChange={(v) => useCtl.setState({ text: v, last: null })} testid="ctl-formula" rows={4} placeholder="e.g. AG(p1 -> EF(p2)) or EF(deadlock)" />
          <SyntaxHelp />
          <div className="btn-row">
            <button className="small primary" onClick={() => void checkBox()} disabled={!text.trim() || checking || busy} data-testid="ctl-check">
              {checking ? "Checking…" : "Check"}
            </button>
            <button className="small" onClick={() => add({ label: label || `Formula ${list.length + 1}`, text, expected })} disabled={!text.trim()} data-testid="ctl-add">
              Add to list
            </button>
          </div>
          {last && (
            <div className="ctl-result-box" data-testid="ctl-result">
              <ResultView f={last} />
            </div>
          )}
        </section>
      </div>
      <section>
        <div className="steps-head">
          <h4>Saved formulas ({list.length})</h4>
          <button className="small" disabled={!list.length || checking || busy} onClick={() => void checkAll()} data-testid="ctl-check-all">
            Check all
          </button>
          {list.length > 0 && (
            <button className="small" onClick={() => useCtl.setState({ list: [] })}>
              Clear
            </button>
          )}
        </div>
        {list.length === 0 ? (
          <p className="muted small">Add formulas to check several at once. Templates that give several formulas add the rest here.</p>
        ) : (
          <div className="rg-table-wrap">
            <table className="rg-table ctl-table" data-testid="ctl-list">
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Result</th>
                  <th>Expected</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((f) => (
                  <tr key={f.id} onClick={() => useCtl.setState({ text: f.text, label: f.label, expected: f.expected, last: f.result || f.error ? f : null })}>
                    <td>
                      <div>{f.label}</div>
                      <div className="mono small muted formula-preview">{f.text}</div>
                    </td>
                    <td>{f.error ? <span className="pill bad">Error</span> : f.result ? <StatusPill status={f.result.status} /> : <span className="muted small">not checked</span>}</td>
                    <td>{f.expected === undefined ? "" : f.result ? <Match f={f} /> : <span className="small muted">{f.expected ? "true" : "false"}</span>}</td>
                    <td>
                      <button
                        className="icon small"
                        aria-label={`Remove ${f.label}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          useCtl.setState({ list: list.filter((x) => x.id !== f.id) });
                        }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: CtlResult["status"] }) {
  return <span className={`pill ${status === "true" ? "good" : status === "false" ? "bad" : "muted-pill"}`}>{status === "true" ? "True" : status === "false" ? "False" : "Unknown"}</span>;
}

function Match({ f }: { f: SavedFormula }) {
  if (!f.result || f.expected === undefined || f.result.status === "unknown") return <span className="small muted">{f.expected ? "true" : "false"}</span>;
  const ok = (f.result.status === "true") === f.expected;
  return <span className={`small ${ok ? "ok-text" : "error-text"}`}>{ok ? "as expected" : `expected ${f.expected ? "true" : "false"}`}</span>;
}

function ResultView({ f }: { f: SavedFormula }) {
  if (f.error) return <p className="error-text small">{f.error}</p>;
  const r = f.result;
  if (!r) return null;
  return (
    <>
      <div className="ctl-verdict">
        <StatusPill status={r.status} />
        <span className="mono small formula-preview">{r.formula}</span>
        {f.expected !== undefined && <Match f={f} />}
      </div>
      {r.status === "unknown" && <p className="muted small">The state space was cut off and the unexplored part could change the answer. On the explored part the formula {r.holds ? "holds" : "fails"}.</p>}
      {r.notes.map((n, i) => (
        <p key={i} className="muted small">
          {n}
        </p>
      ))}
      {r.trace && <TraceView trace={r.trace} />}
    </>
  );
}

function TraceView({ trace }: { trace: CtlTrace | (FiringPath & { kind?: undefined; explanation?: undefined; loopsBackTo?: undefined; endsInDeadlock?: undefined }) }) {
  return (
    <div className="trace" data-testid="ctl-trace">
      {trace.kind && (
        <p className="small">
          <b>{trace.kind === "witness" ? "Witness" : "Counterexample"}:</b> {trace.explanation}
        </p>
      )}
      <ol className="trace-steps mono small">
        <li title={markingText(trace.markings[0])}>M0 {trace.loopsBackTo === 0 ? "↺" : ""}</li>
        {trace.steps.map((s, i) => (
          <li key={i} title={markingText(trace.markings[i + 1])}>
            → {s.label} → M{i + 1}
            {trace.loopsBackTo === i + 1 ? " ↺" : ""}
          </li>
        ))}
        {trace.loopsBackTo !== undefined && <li className="muted">then back to M{trace.loopsBackTo} and around again (↺)</li>}
        {trace.endsInDeadlock && <li className="muted">dead marking: nothing can fire</li>}
      </ol>
      {trace.steps.length > 0 ? (
        <button className="small" onClick={() => replayTrace(trace.steps)} data-testid="ctl-replay">
          Replay in the token game
        </button>
      ) : (
        <p className="muted small">The initial marking alone shows it.</p>
      )}
    </div>
  );
}

function markingText(m: Record<string, number> | undefined): string {
  if (!m) return "";
  return Object.entries(m)
    .map(([p, n]) => (n === 1 ? p : `${p}×${n}`))
    .join(", ");
}

// ---------- paths ----------

function PathsTab({ net, system, deadlocks, busy }: { net: Net; system: SystemFn; deadlocks: "stutter" | "maximal"; busy: boolean }) {
  const transitions = useMemo(() => transitionChoices(net).map((t) => ({ value: t, label: t })), [net]);
  const [target, setTarget] = useState("");
  const [require, setRequire] = useState<string[]>([]);
  const [requireAny, setRequireAny] = useState<string[]>([]);
  const [forbid, setForbid] = useState<string[]>([]);
  const [mode, setMode] = useState<"shortest" | "all">("shortest");
  const [result, setResult] = useState<PathResult | null>(null);
  const [goal, setGoal] = useState("");
  const [ignoring, setIgnoring] = useState<string[]>([]);
  const [advice, setAdvice] = useState<AdviceComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const find = async () => {
    setError(null);
    const ts = await system();
    if (!ts) return;
    try {
      setResult(findPaths(ts, { target, require, requireAny, forbid, mode, deadlocks, limit: 20 }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const compare = async () => {
    setError(null);
    const ts = await system();
    if (!ts) return;
    try {
      setAdvice(compareAdvicePaths(ts, { goal, ignoring, deadlocks }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="ctl-paths">
      <p className="muted small">Firing sequences from the initial marking to a target (§7.3.2), e.g. the shortest way to a parking bay, with transitions that must or must not fire on the way.</p>
      <div className="ctl-grid">
        <section>
          <span className="field-label">Target</span>
          <FormulaBox net={net} value={target} onChange={setTarget} testid="path-target" rows={2} placeholder="e.g. A1 & Park_A1_1" />
          <label className="field">
            <span className="field-label">Must fire (each)</span>
            <MultiSelect options={transitions} value={require} onChange={setRequire} label="Transitions that must fire" />
          </label>
          <label className="field">
            <span className="field-label">Must fire (at least one of)</span>
            <MultiSelect options={transitions} value={requireAny} onChange={setRequireAny} label="Transitions of which one must fire" />
          </label>
          <label className="field">
            <span className="field-label">Must not fire</span>
            <MultiSelect options={transitions} value={forbid} onChange={setForbid} label="Transitions that must not fire" />
          </label>
          <div className="btn-row">
            <select value={mode} onChange={(e) => setMode(e.target.value as "shortest" | "all")} aria-label="Which paths">
              <option value="shortest">Shortest path</option>
              <option value="all">All paths (shortest first)</option>
            </select>
            <button className="small primary" disabled={!target.trim() || busy} onClick={() => void find()} data-testid="path-find">
              Find paths
            </button>
          </div>
        </section>
        <section>
          <h4>Following or ignoring advice</h4>
          <span className="field-label">Goal</span>
          <FormulaBox net={net} value={goal} onChange={setGoal} rows={2} placeholder="e.g. A1 & Park_A1_1" />
          <label className="field">
            <span className="field-label">Moves that ignore an advice</span>
            <MultiSelect options={transitions} value={ignoring} onChange={setIgnoring} label="Transitions that ignore an advice" />
          </label>
          <button className="small" disabled={!goal.trim() || !ignoring.length || busy} onClick={() => void compare()}>
            Compare
          </button>
          {advice && (
            <div className="pad-t">
              <ul className="small">
                {advice.summary.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
              {advice.following.paths[0] && <PathView title="Following" p={advice.following.paths[0]} />}
              {advice.ignoring.paths[0] && <PathView title="Ignoring" p={advice.ignoring.paths[0]} />}
            </div>
          )}
        </section>
      </div>
      {error && <p className="error-text small">{error}</p>}
      {result && (
        <div data-testid="path-result">
          <p className="small">
            {result.found ? `${result.paths.length} path${result.paths.length === 1 ? "" : "s"} found, the shortest with ${result.shortestLength} firing${result.shortestLength === 1 ? "" : "s"}.` : "No path reaches the target."}{" "}
            {result.conclusive ? <span className="ok-text">Conclusive.</span> : <span className="warn-text">Not conclusive: the state space was cut off.</span>}
            {result.truncated && <span className="muted"> More paths may exist.</span>}
          </p>
          {result.notes.map((n, i) => (
            <p key={i} className="muted small">
              {n}
            </p>
          ))}
          {result.paths.map((p, i) => (
            <PathView key={i} title={`Path ${i + 1}`} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function PathView({ title, p }: { title: string; p: FiringPath }) {
  return (
    <details className="path-view" open={title === "Path 1"}>
      <summary>
        {title}: {p.length} firing{p.length === 1 ? "" : "s"}
        {p.reenteredPlaces.length > 0 && <span className="muted small"> · re-enters {p.reenteredPlaces.map((r) => `${r.place.name} ×${r.times}`).join(", ")}</span>}
      </summary>
      <TraceView trace={p} />
    </details>
  );
}

// ---------- fault tolerance ----------

function FaultsTab({ net, limit, deadlocks }: { net: Net; limit: number; deadlocks: "stutter" | "maximal" }) {
  const [faults, setFaults] = useState<{ place: string; tokens: number }[]>([{ place: "", tokens: 1 }]);
  const [wrong, setWrong] = useState("");
  const [goal, setGoal] = useState("");
  const [correct, setCorrect] = useState("");
  const [report, setReport] = useState<FaultToleranceReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    setBusy(true);
    setError(null);
    setTimeout(() => {
      try {
        setReport(
          faultTolerance(net, {
            faults: faults.filter((f) => f.place),
            wrongAdvice: wrong,
            goal: goal.trim() || undefined,
            correctAdvice: correct.trim() || undefined,
            maxStates: limit,
            deadlocks,
          }),
        );
      } catch (e) {
        setError((e as Error).message);
      }
      setBusy(false);
    }, 30);
  };
  const res = (label: string, r: CtlResult | undefined) =>
    r && (
      <tr>
        <td>{label}</td>
        <td>
          <StatusPill status={r.status} />
        </td>
        <td className="mono small formula-preview">{r.formula}</td>
      </tr>
    );
  return (
    <div className="ctl-faults">
      <p className="muted small">
        A faulty sensor gives a wrong advice (§7.3.3): add tokens to database places, then see whether the wrong advice shows, whether users still reach their goal after it, and whether a correct
        advice can follow. The state spaces are explored one transition at a time.
      </p>
      <div className="field">
        <span className="field-label">Faults: extra initial tokens</span>
        {faults.map((f, i) => (
          <div key={i} className="rule-row">
            <PlaceSelect net={net} value={f.place} onChange={(v) => setFaults(faults.map((x, j) => (j === i ? { ...x, place: v } : x)))} label={`Fault ${i + 1} place`} />
            <input type="number" value={f.tokens} onChange={(e) => setFaults(faults.map((x, j) => (j === i ? { ...x, tokens: Math.round(Number(e.target.value) || 0) } : x)))} style={{ width: 70 }} aria-label={`Fault ${i + 1} tokens`} />
            <button className="icon small" aria-label={`Remove fault ${i + 1}`} disabled={faults.length < 2} onClick={() => setFaults(faults.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button className="small" onClick={() => setFaults([...faults, { place: "", tokens: 1 }])}>
          + Fault
        </button>
      </div>
      <span className="field-label">Wrong advice (a state formula)</span>
      <FormulaBox net={net} value={wrong} onChange={setWrong} rows={2} placeholder="e.g. p2 == 2 & Back_p2_1 == 2" />
      <span className="field-label">User's goal (optional)</span>
      <FormulaBox net={net} value={goal} onChange={setGoal} rows={2} placeholder="e.g. exit & Bye_exit_12" />
      <span className="field-label">Correct advice (optional)</span>
      <FormulaBox net={net} value={correct} onChange={setCorrect} rows={2} />
      <div className="btn-row">
        <button className="small primary" disabled={busy || !wrong.trim() || !faults.some((f) => f.place)} onClick={run}>
          {busy ? "Checking…" : "Check fault tolerance"}
        </button>
      </div>
      {error && <p className="error-text small">{error}</p>}
      {report && (
        <div>
          <ul className="small">
            {report.summary.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <table className="rg-table">
            <tbody>
              {res("Wrong advice without the fault", report.wrongAdviceWithoutFault)}
              {res("Wrong advice with the fault", report.wrongAdviceWithFault)}
              {res("Goal after the wrong advice", report.goalAfterWrongAdvice)}
              {res("Correct advice after the wrong one", report.correctAfterWrongAdvice)}
            </tbody>
          </table>
          <p className="muted small">
            Fault-free: {report.faultFree.states.toLocaleString()} states{report.faultFree.complete ? "" : " (cut off)"}, {report.faultFree.deadStates} dead. With the fault:{" "}
            {report.faulty.states.toLocaleString()} states{report.faulty.complete ? "" : " (cut off)"}, {report.faulty.deadStates} dead, {report.newDeadMarkings.length} new dead marking{report.newDeadMarkings.length === 1 ? "" : "s"}.
          </p>
          {report.wrongAdviceWithFault.trace && (
            <details>
              <summary>How the wrong advice comes about (in the faulty net)</summary>
              <ol className="trace-steps mono small">
                {report.wrongAdviceWithFault.trace.steps.map((s, i) => (
                  <li key={i}>
                    → {s.label} → M{i + 1}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
