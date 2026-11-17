// Petri net slicing (Khan, Konios and Guelfi, ACM Computing Surveys 2018) and the modelling and
// verification framework of Konios et al. (HCII 2023): the Analyse menu's "Slice the net…" and
// "Framework pipeline…" dialogs.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Net } from "@pns/core";
import { exportPnml } from "@pns/io";
import {
  EvolutionResult,
  NetSlice,
  PTNet,
  SLICING_ALGORITHMS,
  SlicePart,
  SlicingAlgorithm,
  SlicingCriterion,
  changConcurrencySets,
  criterionFromCtl,
  evolutionImpact,
  interleavingSystem,
  leeSlices,
  sliceNet,
  sliceToNet,
  stubbornSystem,
  toPTNet,
} from "@pns/analysis";
import { loadNet, toast, useStore } from "./store";
import { downloadText } from "./fileOps";
import { autoLayout } from "./layout";
import { placeChoices, replayTrace } from "./ctl";
import { CHAPTER_PROPERTIES, CheckSemantics, FrameworkResult, Fulfilled, SPACE_LABEL, SpaceKind, maximalStepsUnsupported, runFramework } from "./framework";
import type { ModalType } from "./AmbientDialogs";

const fmt = (n: number) => n.toLocaleString("en");

/**
 * Open a derived net (a slice, the T-APN) as a new model. Nets taken from an unfolding place every
 * colour of a place at the same spot, so those are laid out again.
 */
async function openDerived(net: Net, unfolded: boolean, message?: string): Promise<boolean> {
  const s = useStore.getState();
  if (s.dirty && !window.confirm("This opens as a new model. Discard unsaved changes to this one?")) return false;
  loadNet(net, null);
  useStore.setState({ dirty: true });
  if (unfolded && net.places.length + net.transitions.length <= 400) await autoLayout("layered");
  if (message) toast(message);
  return true;
}

/** Run fn after the dialog has painted its busy state (the analyses are synchronous). */
function later(fn: () => void) {
  setTimeout(fn, 30);
}

function splitNames(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

interface SliceRun {
  slice: NetSlice;
  /** The net that was sliced, the criterion and the options: kept to check later changes (survey Sec. 8.3). */
  pt: PTNet;
  criterion: SlicingCriterion;
  trace?: string[];
  /** States of the full and the sliced interleaving graphs (with completeness). */
  full?: { states: number; complete: boolean; stubborn: number };
  sliced?: { states: number; complete: boolean; stubborn: number };
  net: unknown;
}

/** What the dialog keeps between openings, so that after editing the net it can say whether the change matters. */
interface SliceMemo {
  algorithm: SlicingAlgorithm;
  criterion: string;
  formula: string;
  trace: string;
  limit: number;
  run: SliceRun | null;
}
let memo: SliceMemo | null = null;

/** The remembered slice belongs to this model while its net is the current one or is in the undo or redo history. */
function sameModel(run: SliceRun): boolean {
  const s = useStore.getState();
  return run.net === s.net || s.past.includes(run.net as Net) || s.future.includes(run.net as Net);
}

export function SlicingDialog({ Modal, close }: { Modal: ModalType; close: () => void }) {
  const net = useStore((s) => s.net);
  const choices = useMemo(() => placeChoices(net), [net]);
  const remembered = memo?.run && sameModel(memo.run) ? memo : null;
  const [algorithm, setAlgorithm] = useState<SlicingAlgorithm>(remembered?.algorithm ?? "abstract");
  const [criterion, setCriterion] = useState(remembered?.criterion ?? "");
  const [formula, setFormula] = useState(remembered?.formula ?? "");
  const [trace, setTrace] = useState(remembered?.trace ?? "");
  const [limit, setLimit] = useState(remembered?.limit ?? 200000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<SliceRun | null>(remembered?.run ?? null);
  useEffect(() => {
    memo = { algorithm, criterion, formula, trace, limit, run };
  }, [algorithm, criterion, formula, trace, limit, run]);
  const [evolution, setEvolution] = useState<{ result: EvolutionResult; net: Net } | null>(null);
  const [parts, setParts] = useState<{ kind: "lee" | "chang"; parts: SlicePart[]; pt: PTNet; net: Net } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const info = SLICING_ALGORITHMS.find((a) => a.id === algorithm)!;

  const go = (compare: boolean) => {
    setBusy(true);
    setError(null);
    abort.current = new AbortController();
    const signal = abort.current.signal;
    later(() => {
      try {
        const current = useStore.getState().net;
        const pt = toPTNet(current);
        if (pt.errors.length) throw new Error(`The net has errors: ${pt.errors[0]}`);
        const places = splitNames(criterion);
        const transitions: string[] = [];
        if (formula.trim()) {
          const c = criterionFromCtl(formula);
          places.push(...c.places);
          transitions.push(...c.transitions);
        }
        if (!places.length && !transitions.length) throw new Error("Give the criterion: places, or a CTL formula whose places it takes.");
        const crit: SlicingCriterion = { places, transitions };
        const steps = info.needsTrace ? splitNames(trace) : undefined;
        const slice = sliceNet(pt, crit, { algorithm, trace: steps, signal });
        const r: SliceRun = { slice, pt, criterion: crit, trace: steps, net: current };
        setEvolution(null);
        if (compare) {
          const visible = slice.criterion.places;
          const f = interleavingSystem(pt, { maxStates: limit, signal });
          const fs = stubbornSystem(pt, { maxStates: limit, signal, visible });
          r.full = { states: f.markings.length, complete: f.complete, stubborn: fs.markings.length };
          const vis = visible.map((p) => slice.placeMap[p]).filter((p) => p >= 0);
          const s = interleavingSystem(slice.pt, { maxStates: limit, signal });
          const ss = stubbornSystem(slice.pt, { maxStates: limit, signal, visible: vis });
          r.sliced = { states: s.markings.length, complete: s.complete, stubborn: ss.markings.length };
        }
        setRun(r);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      }
      setBusy(false);
    });
  };

  const kept = (slice: NetSlice): string[] => {
    const ids = new Set<string>();
    for (const p of slice.pt.places) p.elementIds.forEach((id) => ids.add(id));
    for (const t of slice.pt.transitions) t.elementIds.forEach((id) => ids.add(id));
    return [...ids];
  };

  const openSlice = (slice: NetSlice) =>
    void openDerived(sliceToNet(slice, `${useStore.getState().net.name || "net"} (${info.label} slice)`), slice.pt.unfolded, `Opened the slice: ${slice.stats.places} places, ${slice.stats.transitions} transitions`);

  /** Survey Sec. 8.3: does the change since the last slice touch it, or does the property need checking again? */
  const checkEvolution = (prev: SliceRun) => {
    setError(null);
    try {
      const current = useStore.getState().net;
      const after = toPTNet(current);
      if (after.errors.length) throw new Error(`The net has errors: ${after.errors[0]}`);
      const result = evolutionImpact(prev.pt, after, prev.criterion, { algorithm: prev.slice.algorithm, trace: prev.trace });
      setEvolution({ result, net: current });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** Survey Algs 5 and 6: divide the net into invariant slices (Lee et al.) or concurrency sets (Chang et al.). */
  const divide = (kind: "lee" | "chang") => {
    setBusy(true);
    setError(null);
    abort.current = new AbortController();
    const signal = abort.current.signal;
    later(() => {
      try {
        const current = useStore.getState().net;
        const pt = toPTNet(current);
        if (pt.errors.length) throw new Error(`The net has errors: ${pt.errors[0]}`);
        setParts({ kind, parts: kind === "lee" ? leeSlices(pt, { signal }) : changConcurrencySets(pt, { signal }), pt, net: current });
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      }
      setBusy(false);
    });
  };

  const partIds = (pt: PTNet, part: SlicePart): string[] => [...new Set([...part.places.flatMap((p) => pt.places[p].elementIds), ...part.transitions.flatMap((t) => pt.transitions[t].elementIds)])];

  const space = (x?: { states: number; complete: boolean; stubborn: number }) =>
    x ? (
      <>
        <td>
          {fmt(x.states)}
          {x.complete ? "" : "+"}
        </td>
        <td>{fmt(x.stubborn)}</td>
      </>
    ) : (
      <>
        <td>-</td>
        <td>-</td>
      </>
    );

  const slice = run?.slice;
  return (
    <Modal title="Slice the net" onClose={close} wide>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Algorithm</span>
          <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value as SlicingAlgorithm)} data-testid="slice-algorithm">
            {SLICING_ALGORITHMS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Criterion places</span>
          <input list="slice-places" value={criterion} onChange={(e) => setCriterion(e.target.value)} placeholder="p3, q[a]" data-testid="slice-criterion" />
          <datalist id="slice-places">
            {choices.map((c) => (
              <option key={c.value} value={c.value} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span className="field-label">or the places of a CTL formula</span>
          <input value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="AG(p3[b] > 0 -> EF(p1[b] > 0))" data-testid="slice-formula" />
        </label>
        {info.needsTrace && (
          <label className="field">
            <span className="field-label">Firing sequence</span>
            <input value={trace} onChange={(e) => setTrace(e.target.value)} placeholder="t1 t4 t5" data-testid="slice-trace" />
          </label>
        )}
        <label className="field">
          <span className="field-label">Explore up to (states)</span>
          <input type="number" min={100} max={5000000} step={1000} value={limit} onChange={(e) => setLimit(Math.min(5000000, Math.max(100, Number(e.target.value) || 100)))} />
        </label>
        <p className="muted small span-all">
          {info.kind === "static" ? "Static" : "Dynamic"} slicing for {info.context === "mc" ? "model checking" : info.context === "testing" ? "testing" : "model checking and testing"}. Preserves: {info.preserves}. ({info.source})
        </p>
      </div>
      <div className="rg-head">
        {busy ? (
          <button className="small" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        ) : (
          <>
            <button className="small primary" onClick={() => go(false)} data-testid="slice-run">
              Slice
            </button>
            <button className="small" onClick={() => go(true)}>
              Slice and compare state spaces
            </button>
          </>
        )}
      </div>
      {busy && <p className="muted small">Working…</p>}
      {error && <p className="error-text">{error}</p>}
      {slice && (
        <>
          {run!.net !== net && (
            <div className="evolution">
              <p className="warn-text small">The model changed since this slice. Press Slice again, or find out whether the change matters for the criterion.</p>
              <button className="small" onClick={() => checkEvolution(run!)} data-testid="slice-evolution">
                Does this change need a new check?
              </button>
            </div>
          )}
          {evolution && evolution.net === net && (
            <div className="evolution-result" data-testid="slice-evolution-result">
              <p className={evolution.result.verdict === "preserved" ? "ok-text small" : "warn-text small"}>
                {evolution.result.verdict === "preserved"
                  ? "No: the change lies outside the slice, so every property this slice preserves keeps its verdict (survey Sec. 8.3)."
                  : `Yes: ${touching(evolution.result.relevant.length)} the slice, so check the property again (on the new slice).`}
              </p>
              {evolution.result.changes.length > 0 && (
                <ul className="small">
                  {evolution.result.changes.slice(0, 30).map((c, i) => (
                    <li key={i} className={evolution.result.relevant.includes(c) ? "" : "muted"}>
                      {c.text}
                      {evolution.result.relevant.includes(c) ? " (in the slice)" : ""}
                    </li>
                  ))}
                  {evolution.result.changes.length > 30 && <li className="muted">and {evolution.result.changes.length - 30} more</li>}
                </ul>
              )}
            </div>
          )}
          <table className="rg-table" data-testid="slice-stats">
            <thead>
              <tr>
                <th></th>
                <th>Places</th>
                <th>Transitions</th>
                <th>Arcs</th>
                <th>States</th>
                <th>States, stubborn sets</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Net</td>
                <td>{slice.stats.originalPlaces}</td>
                <td>{slice.stats.originalTransitions}</td>
                <td>{slice.stats.originalArcs}</td>
                {space(run!.full)}
              </tr>
              <tr>
                <td>Slice</td>
                <td>{slice.stats.places}</td>
                <td>{slice.stats.transitions}</td>
                <td>{slice.stats.arcs}</td>
                {space(run!.sliced)}
              </tr>
            </tbody>
          </table>
          <p className="small">
            <b>Kept places:</b> {slice.pt.places.map((p) => p.name).join(", ") || "none"}
          </p>
          <p className="small">
            <b>Kept transitions:</b> {slice.pt.transitions.map((t) => t.name).join(", ") || "none"}
          </p>
          {slice.notes.map((n, i) => (
            <p key={i} className="muted small">
              {n}
            </p>
          ))}
          <div className="rg-head">
            <button className="small" onClick={() => useStore.setState({ highlight: kept(slice), dialog: null })}>
              Highlight the slice
            </button>
            <button className="small" onClick={() => openSlice(slice)}>
              Open the slice as a new net
            </button>
            <button className="small" onClick={() => downloadText(`${net.name || "net"}-slice.pnml`, exportPnml(sliceToNet(slice)), "application/xml", "pnml")}>
              Export the slice (PNML)
            </button>
          </div>
        </>
      )}
      <details className="slice-divide">
        <summary>Divide the net into parts (survey Algs 5 and 6)</summary>
        <p className="muted small">
          Invariant slices (Lee et al.) split the net along its P-invariants for compositional analysis; they do not shrink the state space. Concurrency sets (Chang et al.) join the paths each process needs to
          reach a communication transition, for test generation.
        </p>
        <div className="rg-head">
          <button className="small" disabled={busy} onClick={() => divide("lee")} data-testid="slice-lee">
            Invariant slices
          </button>
          <button className="small" disabled={busy} onClick={() => divide("chang")} data-testid="slice-chang">
            Concurrency sets
          </button>
        </div>
        {parts && (
          <>
            {parts.net !== net && <p className="warn-text small">The model changed since these parts were computed. Press the button again.</p>}
            {parts.parts.length === 0 ? (
              <p className="muted small">{parts.kind === "lee" ? "The net has no places to divide." : "No communication transitions: the processes never synchronise."}</p>
            ) : (
              <table className="rg-table" data-testid="slice-parts">
                <thead>
                  <tr>
                    <th>{parts.kind === "lee" ? "Slice" : "Set"}</th>
                    <th>Places</th>
                    <th>Transitions</th>
                    <th>Formed from</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {parts.parts.map((part, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{part.places.map((p) => parts.pt.places[p].name).join(", ") || "none"}</td>
                      <td>{part.transitions.map((t) => parts.pt.transitions[t].name).join(", ") || "none"}</td>
                      <td className="muted">{part.reason}</td>
                      <td>
                        <button className="small" disabled={parts.net !== net} onClick={() => useStore.setState({ highlight: partIds(parts.pt, part), dialog: null })}>
                          Highlight
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </details>
    </Modal>
  );
}

/** "1 change touches", "3 changes touch", or "the changes alter" when none is listed. */
const touching = (n: number) => (n === 0 ? "the changes alter" : n === 1 ? "1 change touches" : `${n} changes touch`);

const SPACES: SpaceKind[] = ["single", "singleStubborn", "maximal"];

/** One run of the framework, kept with the net it ran on. */
interface FrameworkRun {
  r: FrameworkResult;
  net: Net;
  /** Run number in this model's history (1, 2, …): the figure's loop back to modelling. */
  n: number;
}

/** What the framework dialog keeps between openings: after a "no", the user edits the model and comes back. */
interface FrameworkMemo {
  formulas: string;
  algorithm: SlicingAlgorithm;
  semantics: CheckSemantics;
  limit: number;
  run: FrameworkRun | null;
  /** Earlier runs on this model (oldest first), for the "Runs" list. */
  history: { n: number; fulfilled: Fulfilled; failing: number; total: number; at: string }[];
}
let fwMemo: FrameworkMemo | null = null;

const sameNet = (n: Net) => {
  const s = useStore.getState();
  return n === s.net || s.past.includes(n) || s.future.includes(n);
};

const FULFILLED_TEXT: Record<Fulfilled, string> = { yes: "Yes", no: "No", unknown: "Unknown" };

/** The boxes of the chapter's Fig. 1, with what this run did at each. */
function FrameworkFlow({ r, busy }: { r: FrameworkResult | undefined; busy: boolean }) {
  const stage = (id: string) => r?.stages.find((s) => s.id === id);
  const size = (id: string) => {
    const s = stage(id);
    return s ? `${fmt(s.places)} places, ${fmt(s.transitions)} transitions` : undefined;
  };
  const apn = stage("apn");
  const tapn = stage("tapn");
  const usedTapn = !!r?.construction && !r.construction.problems.length;
  const failing = r ? r.verdicts.filter((v) => v.fulfilled === "no").length : 0;
  const boxes: { key: string; title: string; detail?: string; state: "done" | "skipped" | "todo" | "yes" | "no" | "unknown" }[] = [
    { key: "model", title: "Model APNs", detail: apn ? size("apn") : r ? "not an APN: starts at its own stage" : undefined, state: !r ? "todo" : apn ? "done" : "skipped" },
    {
      key: "tapn",
      title: "T-APNs",
      detail: !r ? undefined : usedTapn ? `${size("tapn")}${r.equivalence ? `; ${r.equivalence} to N` : ""}` : tapn ? "the APN itself (not a composite step net)" : "not an ambient net",
      state: !r ? "todo" : usedTapn ? "done" : "skipped",
    },
    { key: "unfolded", title: "Unfolded T-APNs", detail: size("unfolded"), state: r ? "done" : "todo" },
    { key: "slicing", title: "Slicing", detail: r ? `criterion: ${r.criterion.length} place${r.criterion.length === 1 ? "" : "s"}` : undefined, state: r ? "done" : "todo" },
    { key: "sliced", title: "Sliced net", detail: size("sliced"), state: r ? "done" : "todo" },
    { key: "mc", title: "Model checking", detail: r ? `${r.verdicts.length} propert${r.verdicts.length === 1 ? "y" : "ies"}, ${r.semantics === "maximal" ? "maximal" : "single"} steps` : undefined, state: r ? "done" : "todo" },
    {
      key: "decision",
      title: "Property fulfilled?",
      detail: !r ? undefined : r.fulfilled === "no" ? `no: ${failing} fail${failing === 1 ? "s" : ""}` : r.fulfilled === "yes" ? "yes: end" : "unknown: raise the limit",
      state: r ? r.fulfilled : "todo",
    },
  ];
  return (
    <div className="fw-figure" aria-label="The framework of Fig. 1 of the chapter">
      <ol className="fw-flow" data-testid="framework-flow">
        {boxes.map((b) => (
          <li key={b.key} className={`fw-box ${b.state}${busy ? " busy" : ""}`} data-stage={b.key}>
            <b>{b.title}</b>
            {b.detail && <span>{b.detail}</span>}
          </li>
        ))}
      </ol>
      <p className="fw-inputs small muted">
        <b>Properties</b> feed both slicing (their places are the criterion) and model checking. <b>No</b> leads back to modelling: replay the counterexample, change the model, run again.
      </p>
    </div>
  );
}

function TraceView({ v, run, stale }: { v: FrameworkResult["verdicts"][number]; run: FrameworkRun; stale: boolean }) {
  const t = v.trace!;
  const slicedNet = run.r.stages.find((s) => s.id === "sliced")!.net;
  const replay = async () => {
    if (t.on === "slice") {
      if (!(await openDerived(slicedNet, run.r.slice.pt.unfolded))) return;
    }
    if (replayTrace(t.steps)) toast(`Replayed the ${t.kind} of ${v.formula} in the token game`);
  };
  const last = Object.entries(t.last)
    .map(([k, n]) => (n === 1 ? k : `${n}·${k}`))
    .join(" ");
  return (
    <div className={t.kind === "counterexample" ? "cex" : "cex witness"} data-testid="framework-trace">
      <h4>
        {t.kind === "counterexample" ? "Counterexample" : "Witness"} for <code>{v.formula}</code>
        {t.on === "slice" && " (on the slice)"}
      </h4>
      <p className="small">{t.explanation}</p>
      {t.steps.length ? (
        <ol className="cex-steps mono">
          <li>M0</li>
          {t.steps.map((st, i) => (
            <li key={i}>
              [{st.label}⟩ M{i + 1}
              {t.loopsBackTo !== undefined && i === t.steps.length - 1 && <span className="muted"> then back to M{t.loopsBackTo}, forever</span>}
            </li>
          ))}
          {t.endsInDeadlock && <li className="cex-last">M{t.steps.length} is dead: nothing can fire</li>}
        </ol>
      ) : (
        <p className="small">The initial marking M0 already shows it{t.loopsBackTo !== undefined ? " (the path stays there forever)" : ""}.</p>
      )}
      <p className="small">
        Last marking: <span className="mono">{last || "∅"}</span>
      </p>
      <div className="btn-row">
        {t.replayable && (
          <button className="small primary" onClick={() => void replay()} disabled={t.on === "model" && stale} title={t.on === "model" && stale ? "The model changed since this run: run again first" : undefined} data-testid="framework-replay">
            {t.on === "slice" ? "Open the slice and replay" : "Replay on the model"}
          </button>
        )}
      </div>
      {!t.replayable && <p className="muted small">The path is made of maximal steps, and the token game of this net fires one transition at a time, so it is shown here only.</p>}
      {t.on === "slice" && <p className="muted small">The whole net was too big for this property, so the path is a firing sequence of the slice. Its transitions are transitions of the model, but the slice drops or merges the ones that cannot change the criterion places.</p>}
    </div>
  );
}

/** The framework of Fig. 1 of the chapter, end to end, with the state-space sizes of Figs 11 and 12 and the loop back to modelling. */
export function FrameworkDialog({ Modal, close }: { Modal: ModalType; close: () => void }) {
  const net = useStore((s) => s.net);
  const remembered = fwMemo?.run && sameNet(fwMemo.run.net) ? fwMemo : null;
  const [formulas, setFormulas] = useState(() => remembered?.formulas ?? (net.name.includes("4.10") || net.name.includes("Fig. 7") ? CHAPTER_PROPERTIES.join("\n") : ""));
  const [algorithm, setAlgorithm] = useState<SlicingAlgorithm>(remembered?.algorithm ?? "abstract");
  const [semantics, setSemantics] = useState<CheckSemantics>(remembered?.semantics ?? "single");
  // Why maximal steps cannot be used for this net (reset arcs, marking-dependent weights…), if so.
  const maximalBlocked = useMemo(() => {
    if (semantics !== "maximal") return null;
    try {
      return maximalStepsUnsupported(net);
    } catch {
      return null;
    }
  }, [net, semantics]);
  const [limit, setLimit] = useState(remembered?.limit ?? 200000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FrameworkRun | null>(remembered?.run ?? null);
  const [history, setHistory] = useState<FrameworkMemo["history"]>(remembered?.history ?? []);
  const [open, setOpen] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    fwMemo = { formulas, algorithm, semantics, limit, run: result, history };
  }, [formulas, algorithm, semantics, limit, result, history]);

  const go = () => {
    setBusy(true);
    setError(null);
    abort.current = new AbortController();
    later(() => {
      try {
        const current = useStore.getState().net;
        const list = formulas
          .split("\n")
          .map((f) => f.trim())
          .filter(Boolean);
        if (!list.length) throw new Error("Write at least one CTL property (one per line). Its places form the slicing criterion.");
        const r = runFramework(current, { formulas: list, algorithm, semantics, maxStates: limit, signal: abort.current?.signal });
        const n = (history.at(-1)?.n ?? 0) + 1;
        setResult({ r, net: current, n });
        setHistory((h) => [...h.slice(-19), { n, fulfilled: r.fulfilled, failing: r.verdicts.filter((v) => v.fulfilled === "no").length, total: r.verdicts.length, at: new Date().toLocaleTimeString() }]);
        // Open the first counterexample: it is what the user goes back to the model with.
        setOpen(r.verdicts.find((v) => v.fulfilled === "no" && v.trace)?.formula ?? null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      }
      setBusy(false);
    });
  };

  const r = result?.r;
  const stale = !!result && result.net !== net;
  const cell = (x: FrameworkResult["stages"][number]["sizes"][SpaceKind]) =>
    !x ? "-" : "error" in x ? <span title={x.error}>error</span> : `${fmt(x.states)}${x.complete ? "" : "+"}`;
  const failing = r ? r.verdicts.filter((v) => v.fulfilled === "no") : [];
  const shown = r?.verdicts.find((v) => v.formula === open && v.trace);

  return (
    <Modal title="Framework pipeline: APN → T-APN → unfolding → slice → model checking" onClose={close} wide>
      <p className="muted small">
        Runs the modelling and verification framework of Konios et al. (HCII 2023, Fig. 1): the construction φ(N), its unfolding, a slice for the places the properties mention, model checking of every property, and the size of every state space
        (single steps, with stubborn sets, maximal steps). Properties are CTL over unfolded names, e.g. <code>p3[b]</code>, <code>t1&lt;x=b&gt;</code>.
      </p>
      <FrameworkFlow r={r} busy={busy} />
      <label className="sr-only" htmlFor="framework-formulas">
        Properties, one CTL formula per line
      </label>
      <textarea id="framework-formulas" value={formulas} onChange={(e) => setFormulas(e.target.value)} rows={4} style={{ width: "100%" }} placeholder={CHAPTER_PROPERTIES.join("\n")} data-testid="framework-formulas" />
      <div className="rg-head wrap">
        <button className="small" onClick={() => setFormulas(CHAPTER_PROPERTIES.join("\n"))}>
          Use the chapter's φ1 and φ2
        </button>
        <label>
          Slicing{" "}
          <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value as SlicingAlgorithm)}>
            {SLICING_ALGORITHMS.filter((a) => !a.needsTrace).map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Check with{" "}
          <select value={semantics} onChange={(e) => setSemantics(e.target.value as CheckSemantics)} data-testid="framework-semantics">
            <option value="single">single steps</option>
            <option value="maximal">maximal steps</option>
          </select>
        </label>
        <label>
          up to <input type="number" min={100} max={5000000} step={1000} value={limit} onChange={(e) => setLimit(Math.max(100, Number(e.target.value) || 100))} style={{ width: 110 }} /> states
        </label>
        {busy ? (
          <button className="small" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        ) : (
          <button className="small primary" onClick={go} disabled={!!maximalBlocked} data-testid="framework-run">
            {result ? (stale ? "Run again on the changed model" : "Run again") : "Run"}
          </button>
        )}
      </div>
      {semantics === "maximal" && maximalBlocked && (
        <p className="warn-text small" data-testid="framework-maximal-unsupported">
          {maximalBlocked}
        </p>
      )}
      {busy && (
        <p className="muted small" role="status">
          Running every stage…
        </p>
      )}
      {error && <p className="error-text">{error}</p>}
      {r && result && (
        <>
          {stale && (
            <p className="warn-text small" data-testid="framework-stale">
              The model changed since run {result.n}. Press Run again to check the changed model.
            </p>
          )}
          <div className={`fw-outcome ${r.fulfilled}`} role="status" data-testid="framework-outcome">
            <b>Property fulfilled? {FULFILLED_TEXT[r.fulfilled]}.</b> <span className="muted">({r.semantics === "maximal" ? "maximal steps" : "single steps"})</span>{" "}
            {r.fulfilled === "yes"
              ? `All ${r.verdicts.length === 1 ? "the property holds" : `${r.verdicts.length} properties hold`}: the model meets its requirements.`
              : r.fulfilled === "no"
                ? `${failing.length} of ${r.verdicts.length} ${r.verdicts.length === 1 ? "property fails" : "properties fail"}. Back to modelling: replay the counterexample, change the model, then run again.`
                : "Some properties could not be decided within the state limit and no slice could stand in for the whole net. Raise the limit, or pick a slicing algorithm that preserves them."}
          </div>
          <table className="rg-table" data-testid="framework-verdicts">
            <caption className="sr-only">Verdict of each property</caption>
            <thead>
              <tr>
                <th>Property</th>
                <th>Whole net</th>
                <th>Slice</th>
                <th>Fulfilled?</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {r.verdicts.map((v) => (
                <tr key={v.formula}>
                  <td>
                    <code>{v.formula}</code>
                    {v.notes.map((n, i) => (
                      <div key={i} className="muted small">
                        {n}
                      </div>
                    ))}
                  </td>
                  <td title={`${fmt(v.fullStates)} states, ${v.fullBy}`}>{v.full}</td>
                  <td title={`${fmt(v.sliceStates)} states`} className={v.agree ? "" : "error-text"}>
                    {v.slice}
                  </td>
                  <td>
                    <span className={`pill ${v.fulfilled === "yes" ? "good" : v.fulfilled === "no" ? "bad" : "muted-pill"}`} title={v.decidedBy === "-" ? undefined : `decided on the ${v.decidedBy}`}>
                      {FULFILLED_TEXT[v.fulfilled]}
                    </span>
                  </td>
                  <td>
                    {v.trace ? (
                      <button className="small" aria-expanded={open === v.formula} onClick={() => setOpen(open === v.formula ? null : v.formula)} data-testid="framework-show-trace">
                        {v.trace.kind === "counterexample" ? "Counterexample" : "Witness"} ({v.trace.steps.length} step{v.trace.steps.length === 1 ? "" : "s"})
                      </button>
                    ) : (
                      <span className="muted small">{v.fulfilled === "unknown" ? "-" : "no single path"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown && <TraceView v={shown} run={result} stale={stale} />}
          <details className="fw-details">
            <summary>State spaces of every stage (Figs 11 and 12)</summary>
            <table className="rg-table" data-testid="framework-stages">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Places</th>
                  <th>Transitions</th>
                  {SPACES.map((k) => (
                    <th key={k}>{SPACE_LABEL[k]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.stages.map((s) => (
                  <tr key={s.id}>
                    <td>{s.label}</td>
                    <td>{s.places}</td>
                    <td>{s.transitions}</td>
                    {SPACES.map((k) => (
                      <td key={k}>{cell(s.sizes[k])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">A "+" means the exploration stopped at the limit. Stubborn sets keep the reachable markings of the criterion places.</p>
          </details>
          {r.equivalence && (
            <p className="small">
              N and φ(N) have isomorphic concurrent reachability graphs: <b>{r.equivalence}</b>.
            </p>
          )}
          <p className="small">
            <b>Criterion:</b> {r.criterion.join(", ")}
          </p>
          {r.notes.map((n, i) => (
            <p key={i} className="muted small">
              {n}
            </p>
          ))}
          {history.length > 1 && (
            <div className="fw-history" data-testid="framework-history">
              <b className="small">Runs on this model</b>
              <ol className="small">
                {history.map((h) => (
                  <li key={h.n} value={h.n}>
                    {h.at}: <span className={`pill ${h.fulfilled === "yes" ? "good" : h.fulfilled === "no" ? "bad" : "muted-pill"}`}>{FULFILLED_TEXT[h.fulfilled]}</span>
                    {h.failing ? ` ${h.failing} of ${h.total} failed` : ` ${h.total} checked`}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="rg-head wrap">
            {r.stages
              .filter((s) => s.id === "tapn" || s.id === "sliced")
              .map((s) => (
                <button
                  key={s.id}
                  className="small"
                  onClick={() => void openDerived(s.id === "sliced" ? s.net : { ...s.net, name: `${useStore.getState().net.name} (T-APN)` }, s.id === "sliced" && r.slice.pt.unfolded)}
                >
                  Open the {s.id === "sliced" ? "slice" : "T-APN"}
                </button>
              ))}
            {r.fulfilled === "no" && (
              <button className="small" onClick={close} data-testid="framework-back">
                Back to modelling
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
