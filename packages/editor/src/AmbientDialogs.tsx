import React, { useEffect, useMemo, useRef, useState } from "react";
import { ColourSetDecl, Net, Place } from "@pns/core";
import {
  BW,
  Check,
  ClassCheck,
  Crg,
  CrgView,
  DecisionPoint,
  EquivalenceResult,
  StateGraph,
  Step,
  backwardCompose,
  basicStepNet,
  checkBackwardComposition,
  checkForwardComposition,
  concurrentReachabilityGraphAsync,
  crgView,
  forwardCompose,
  gluingPlaces,
  isBasicStepNet,
  isCompositeStepNet,
  isForwardCompositeStepNet,
  isKBounded,
  isLive,
  isOneStepNet,
  isOrdinary,
  isPure,
  isReversible,
  isRootNet,
  isStructurallyBounded,
  oneStepNet,
  placeBounds,
  reachabilityGraph,
  rootNet,
  unidirectionalStep,
} from "@pns/apn";
import { compiled, edit, loadNet, requestFit, toast, useStore } from "./store";
import { CSS_PALETTE, NetDrawing } from "./NetDrawing";
import {
  equivalencePair,
  freeName,
  insertBlock,
  netBounds,
  nextNumbered,
  relabelStep,
  reopenApn,
  replaySteps,
  runEquivalence,
  useAmbient,
} from "./ambient";

export type ModalType = React.ComponentType<{ title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }>;

function Verdict({ ok, label }: { ok: boolean | null; label?: string }) {
  return <span className={`pill ${ok === null ? "muted-pill" : ok ? "good" : "bad"}`}>{label ?? (ok === null ? "Unknown" : ok ? "Yes" : "No")}</span>;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** Replay a path in the token game and close the dialog, so the marking shows on the canvas. */
function showPath(steps: Step[], then?: Step) {
  useStore.setState({ dialog: null });
  replaySteps(steps, then);
}

// ---------- concurrent reachability graph ----------

/** For each state, the edge that first reached it in the breadth-first construction. */
function discoveryEdges(g: Crg): (number | null)[] {
  const parent: (number | null)[] = g.states.map(() => null);
  g.edges.forEach((e, i) => {
    if (e.to !== g.initial && parent[e.to] === null && e.to !== e.from) parent[e.to] = i;
  });
  return parent;
}

function pathTo(g: Crg, parent: (number | null)[], i: number): Step[] {
  const out: Step[] = [];
  const seen = new Set<number>();
  for (let s = i; parent[s] !== null && !seen.has(s); s = g.edges[parent[s]!].from) {
    seen.add(s);
    out.unshift(g.edges[parent[s]!].step);
  }
  return out;
}

const REASONS: Record<NonNullable<Crg["reason"]>, string> = {
  states: "stopped at the state limit",
  edges: "stopped at the edge limit",
  steps: "some states have more enabled steps than the per-state limit",
  aborted: "stopped",
};

/** CRG(N) of Konios Def. 5 (eq. 3.1): markings reachable by steps, edges labelled with the steps. */
export function CrgDialog({ Modal, close }: { Modal: ModalType; close: () => void }) {
  const net = useStore((s) => s.net);
  const [maxStates, setMaxStates] = useState(2000);
  const [maxEdges, setMaxEdges] = useState(30000);
  const [maximalOnly, setMaximalOnly] = useState(false);
  const [result, setResult] = useState<{ g: Crg; view: CrgView; net: Net } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [shown, setShown] = useState(150);
  const abort = useRef<AbortController | null>(null);

  const run = async () => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true);
    setError(null);
    setProgress([0, 0]);
    const n = useStore.getState().net;
    try {
      const g = await concurrentReachabilityGraphAsync(n, {
        maxStates,
        maxEdges,
        maximalOnly,
        maxStepsPerState: 2000,
        signal: ac.signal,
        yieldEvery: 40,
        onProgress: (s, e) => setProgress([s, e]),
      });
      if (abort.current === ac) setResult({ g, view: crgView(n, g), net: n });
    } catch (e) {
      setError((e as Error).message);
    }
    if (abort.current === ac) setBusy(false);
  };
  useEffect(() => {
    void run();
    return () => abort.current?.abort();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const parent = useMemo(() => (result ? discoveryEdges(result.g) : []), [result]);
  const states = useMemo(() => {
    if (!result) return [];
    const f = filter.trim().toLowerCase().replace(/\s+/g, "");
    const all = result.view.states;
    return f ? all.filter((s) => s.label.toLowerCase() === f || s.pairs.some((p) => p.toLowerCase().includes(f))) : all;
  }, [result, filter]);
  const outEdges = useMemo(() => {
    const m = new Map<number, number[]>();
    result?.g.edges.forEach((e, i) => (m.get(e.from) ?? m.set(e.from, []).get(e.from)!).push(i));
    return m;
  }, [result]);
  const stale = result && result.net !== net;

  return (
    <Modal title="Concurrent reachability graph" onClose={close} wide>
      <div className="rg-head wrap">
        <label>
          Stop after <input type="number" min={10} max={200000} value={maxStates} onChange={(e) => setMaxStates(Math.max(10, Number(e.target.value) || 10))} style={{ width: 90 }} /> states
        </label>
        <label>
          and <input type="number" min={10} max={2000000} value={maxEdges} onChange={(e) => setMaxEdges(Math.max(10, Number(e.target.value) || 10))} style={{ width: 100 }} /> edges
        </label>
        <label className="check inline">
          <input type="checkbox" checked={maximalOnly} onChange={(e) => setMaximalOnly(e.target.checked)} /> Maximal steps only
        </label>
        {busy ? (
          <button className="small" onClick={() => abort.current?.abort()} data-testid="crg-stop">
            Stop
          </button>
        ) : (
          <button className="small" onClick={() => void run()}>
            Explore again
          </button>
        )}
      </div>
      {busy && (
        <p className="muted small" role="status">
          Exploring… {plural(progress[0], "state")}, {plural(progress[1], "edge")}
        </p>
      )}
      {error && <p className="error-text">{error}</p>}
      {stale && <p className="warn-text small">The model changed since this graph was built. Press Explore again.</p>}
      {result && (
        <>
          <div className="stat-row">
            <div className="stat">
              <b data-testid="crg-states">{result.g.states.length.toLocaleString()}</b>
              <span>states (markings)</span>
            </div>
            <div className="stat">
              <b>{result.g.edges.length.toLocaleString()}</b>
              <span>edges ({maximalOnly ? "maximal steps" : "steps"})</span>
            </div>
            <div className={`stat ${result.g.deadlocks.length ? "bad" : "good"}`}>
              <b>{result.g.deadlocks.length}</b>
              <span>dead states</span>
            </div>
            <div className="stat">
              <b>{result.g.complete ? "Complete" : "Partial"}</b>
              <span>{result.g.complete ? "every reachable marking" : REASONS[result.g.reason ?? "states"]}</span>
            </div>
          </div>
          <p className="muted small">
            States list their structured places (p, c). {maximalOnly ? "Edges carry maximal steps only, so this is a smaller graph than CRG(N). " : ""}Choose a state or an edge to replay the steps to it in the
            token game and see the marking on the canvas.
          </p>
          <div className="rg-head wrap">
            <input className="grow" type="search" placeholder="Find states, e.g. M12 or (p1,b)" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Find states" />
            {filter && <span className="muted small">{plural(states.length, "match", "matches")}</span>}
          </div>
          <div className="crg-list rg-table-wrap" data-testid="crg-list">
            {states.slice(0, shown).map((st) => {
              const outs = outEdges.get(st.id) ?? [];
              return (
                <div key={st.id} className={`crg-state ${st.dead ? "dead" : ""}`}>
                  <div className="crg-state-head">
                    <button className="link-btn mono" onClick={() => showPath(pathTo(result.g, parent, st.id))} title="Show this marking on the canvas">
                      {st.label}
                    </button>
                    {st.initial && <span className="pill muted-pill">initial</span>}
                    {st.dead && <span className="pill bad">dead</span>}
                    <span className="mono small crg-pairs">{st.pairs.join(" ") || "∅"}</span>
                  </div>
                  {outs.length > 0 && (
                    <div className="crg-edges">
                      {outs.slice(0, 12).map((i) => {
                        const e = result.g.edges[i];
                        return (
                          <button key={i} className="edge-chip mono" onClick={() => showPath([...pathTo(result.g, parent, e.from), e.step])} title="Fire this step from this state in the token game">
                            {result.view.edges[i].label} → M{e.to}
                          </button>
                        );
                      })}
                      {outs.length > 12 && <span className="muted small">and {outs.length - 12} more</span>}
                    </div>
                  )}
                </div>
              );
            })}
            {states.length > shown && (
              <button className="small" onClick={() => setShown(shown + 300)}>
                Show more states ({(states.length - shown).toLocaleString()} left)
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------- equivalence ----------

const KIND_TEXT: Record<string, string> = {
  stepOnlyInApn: "A step is enabled in the APN but not in the T-APN",
  stepOnlyInTapn: "A step is enabled in the T-APN but not in the APN",
  stateMismatch: "Two step sequences meet in one net but not in the other",
};

/** Konios Sec. 6.6: are CRG(N) and CRG(φ(N)) isomorphic (Def. 22)? */
export function EquivalencePanel({ autoRun }: { autoRun?: boolean }) {
  const net = useStore((s) => s.net);
  const construction = useAmbient((s) => s.construction);
  const [limit, setLimit] = useState(1000);
  const [result, setResult] = useState<{ r: EquivalenceResult; net: Net } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pair = equivalencePair(net);
  const run = () => {
    setBusy(true);
    setError(null);
    // Paint "Checking…" before the (synchronous) check starts.
    setTimeout(() => {
      const n = useStore.getState().net;
      try {
        setResult({ r: runEquivalence(n, limit), net: n });
      } catch (e) {
        setError((e as Error).message);
      }
      setBusy(false);
    }, 40);
  };
  useEffect(() => {
    if (autoRun && typeof pair !== "string") run();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (typeof pair === "string") return <p className="muted">{pair}</p>;
  const r = result?.r;
  const cex = r?.counterexample;
  const apnNet = pair.apn;
  const replayHere = (steps: Step[], then?: Step) => showPath(steps.map((u) => relabelStep(apnNet, net, u)), then && relabelStep(apnNet, net, then));
  return (
    <div className="equivalence" data-testid="equivalence">
      <div className="rg-head wrap">
        <label>
          Explore up to <input type="number" min={50} max={200000} value={limit} onChange={(e) => setLimit(Math.max(50, Number(e.target.value) || 50))} style={{ width: 90 }} /> state pairs
        </label>
        <button className="small primary" onClick={run} disabled={busy} data-testid="check-equivalence">
          {busy ? "Checking…" : result ? "Check again" : "Check equivalence"}
        </button>
      </div>
      <p className="muted small">
        Compares the concurrent reachability graphs of {pair.tapn ? `the APN “${apnNet.name}” and this T-APN` : "this APN and its T-APN φ(N)"} step by step (Def. 22, Theorem 1).
      </p>
      {busy && <p className="muted small" role="status">Exploring both nets in lock step…</p>}
      {error && <p className="error-text">{error}</p>}
      {r && (
        <>
          {result!.net !== net && <p className="warn-text small">The model changed since this check. Press Check again.</p>}
          <div className="stat-row">
            <div className={`stat ${r.verdict === "equivalent" ? "good" : r.verdict === "not equivalent" ? "bad" : ""}`}>
              <b data-testid="verdict">{r.verdict === "equivalent" ? "Equivalent" : r.verdict === "not equivalent" ? "Not equivalent" : "Unknown"}</b>
              <span>{r.verdict === "unknown" ? `a limit was hit (${r.reason ?? "states"}) before an answer` : r.verdict === "equivalent" ? "the CRGs are isomorphic" : "no isomorphism ψ exists"}</span>
            </div>
            <div className="stat">
              <b>{r.states.toLocaleString()}</b>
              <span>state pairs matched</span>
            </div>
            <div className="stat">
              <b>{r.edges.toLocaleString()}</b>
              <span>edges compared</span>
            </div>
          </div>
          {r.verdict === "unknown" && <p className="muted small">Raise the limit to explore further. The models of Sec. 4.5 have very large state spaces.</p>}
          {cex && (
            <div className="cex" data-testid="counterexample">
              <h4>Counterexample</h4>
              <p>{KIND_TEXT[cex.kind]}.</p>
              <p className="small">{cex.explanation}</p>
              <ol className="cex-steps mono">
                <li>M0</li>
                {cex.steps.map((u, i) => (
                  <li key={i}>
                    [{showStepIn(apnNet, u)}⟩ M{i + 1}
                  </li>
                ))}
                {cex.step && <li className="cex-last">then {showStepIn(apnNet, cex.step)} is enabled in the {cex.kind === "stepOnlyInApn" ? "APN only" : "T-APN only"}</li>}
              </ol>
              {cex.other && (
                <p className="small">
                  Other sequence: <span className="mono">{cex.other.map((u) => showStepIn(apnNet, u)).join(" ") || "ε"}</span>
                </p>
              )}
              <div className="cex-markings">
                <div>
                  <h4>APN marking</h4>
                  <div className="mono small pairs">{cex.apnMarking.join(" ") || "∅"}</div>
                </div>
                <div>
                  <h4>T-APN marking</h4>
                  <div className="mono small pairs">{cex.tapnMarking.join(" ") || "∅"}</div>
                </div>
              </div>
              <div className="btn-row">
                <button className="small" onClick={() => replayHere(cex.steps, cex.step)} data-testid="replay-cex">
                  Replay in this {net.netClass === "tapn" ? "T-APN" : "APN"}
                </button>
                {net.netClass === "tapn" && construction && (
                  <button
                    className="small"
                    onClick={() => {
                      useStore.setState({ dialog: null });
                      reopenApn();
                      if (useStore.getState().net.netClass === "apn") replaySteps(cex.steps, cex.step);
                    }}
                  >
                    Open the APN and replay
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function showStepIn(net: Net, u: Step): string {
  const name = new Map(net.transitions.map((t) => [t.id, t.name]));
  return `{${u.map((s) => `(${name.get(s.transition) ?? s.transition},${String(s.colour)})`).join(",")}}`;
}

export function EquivalenceDialog({ Modal, close }: { Modal: ModalType; close: () => void }) {
  return (
    <Modal title="Behavioural equivalence of APN and T-APN" onClose={close} wide>
      <EquivalencePanel autoRun />
    </Modal>
  );
}

/** The result of Construct T-APN (Konios Def. 21, Sec. 6.3): what changed, its warnings, and the equivalence check. */
export function TapnDialog({ Modal, close }: { Modal: ModalType; close: () => void }) {
  const construction = useAmbient((s) => s.construction);
  const net = useStore((s) => s.net);
  if (!construction)
    return (
      <Modal title="T-APN construction" onClose={close}>
        <p className="muted">Open an APN and choose Construct T-APN.</p>
      </Modal>
    );
  const { result, apn } = construction;
  const sets = result.sets;
  return (
    <Modal title="T-APN φ(N) constructed" onClose={close} wide>
      <p>
        <b>{result.net.name}</b> is open as a new model, built from <b>{apn.name}</b> by the construction φ (Def. 21). Places and transitions keep their names and positions.
      </p>
      {net.netClass !== "tapn" && <p className="warn-text small">The open model is no longer this T-APN.</p>}
      <div className="stat-row">
        <div className="stat">
          <b>{sets.preRep.length}</b>
          <span>inhibitor arcs replaced (Pre_REP)</span>
        </div>
        <div className="stat">
          <b>{sets.postNew.length}</b>
          <span>new arcs (Post_NEW)</span>
        </div>
        <div className="stat">
          <b>{sets.guarded.length}</b>
          <span>guarded step transitions (T_G)</span>
        </div>
        <div className={`stat ${result.problems.length ? "bad" : "good"}`}>
          <b data-testid="tapn-problems">{result.problems.length}</b>
          <span>problems</span>
        </div>
      </div>
      {result.problems.length ? (
        <>
          <h4>Problems</h4>
          <p className="muted small">The construction is defined for composite step nets (Def. 13); these parts of N do not fit one, and were translated by the same rules.</p>
          <ul className="problems compact">
            {result.problems.map((p, i) => (
              <li key={i} className={p.severity}>
                <span className="sev">{p.severity === "error" ? "Error" : "Warning"}</span>
                {p.message}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="ok-text small">N is a composite step net, so Theorem 1 says the two nets are behaviourally equivalent.</p>
      )}
      <details>
        <summary>The sets of Sec. 6.3</summary>
        <dl className="sets">
          <dt>Pre_REP</dt>
          <dd className="mono">{sets.preRep.map(([p, t]) => `(${p},${t})`).join(" ") || "∅"}</dd>
          <dt>Post_NEW</dt>
          <dd className="mono">{sets.postNew.map(([t, p]) => `(${t},${p})`).join(" ") || "∅"}</dd>
          <dt>T_G</dt>
          <dd className="mono">{sets.guarded.join(" ") || "∅"}</dd>
          <dt>T_NG</dt>
          <dd className="mono">{sets.unguarded.join(" ") || "∅"}</dd>
          <dt>B_t</dt>
          <dd className="mono">{sets.bindingPairs.map(([a, b]) => `(${a},${b})`).join(" ") || "∅"}</dd>
          <dt>M′0</dt>
          <dd className="mono">{sets.initialMarking.join(" ") || "∅"}</dd>
        </dl>
      </details>
      <h3 className="section-title">Behavioural equivalence (Sec. 6.6)</h3>
      <EquivalencePanel />
      <div className="btn-row end">
        <button className="small" onClick={() => (close(), reopenApn())}>
          Back to the APN
        </button>
        <button className="small primary" onClick={close}>
          Keep the T-APN open
        </button>
      </div>
    </Modal>
  );
}

// ---------- APN properties ----------

interface Row {
  key: string;
  label: string;
  def: string;
  check: Check | ClassCheck | null;
}

function toStateGraph(g: Crg): StateGraph {
  return { markings: g.states, edges: g.edges.map((e) => ({ from: e.from, to: e.to, transitions: [...new Set(e.step.map((s) => s.transition))] })), complete: g.complete };
}

function safe(f: () => Check | ClassCheck): Check | ClassCheck {
  try {
    return f();
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** Class checks (Defs 6, 7, 9, 11, 13) and general properties (Sec. 4.4) of the current APN. */
export function ApnPropsDialog({ Modal, close }: { Modal: ModalType; close: () => void }) {
  const net = useStore((s) => s.net);
  const [severalRoots, setSeveralRoots] = useState(true);
  const [semantics, setSemantics] = useState<"step" | "interleaving">("step");
  const [limit, setLimit] = useState(3000);
  const [k, setK] = useState(1);
  const [graph, setGraph] = useState<{ g: StateGraph; net: Net; semantics: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const structural: Row[] = useMemo(
    () => [
      { key: "root", label: "Root net", def: "Def. 7", check: safe(() => isRootNet(net)) },
      { key: "basic", label: "Basic step net", def: "Def. 6", check: safe(() => isBasicStepNet(net)) },
      { key: "one", label: "One step net", def: "Def. 11", check: safe(() => isOneStepNet(net)) },
      { key: "fcsn", label: "Forward composite step net", def: "Def. 9", check: safe(() => isForwardCompositeStepNet(net, { severalRoots })) },
      { key: "csn", label: "Composite step net", def: "Def. 13", check: safe(() => isCompositeStepNet(net, { severalRoots })) },
      { key: "pure", label: "Pure", def: "Def. 18", check: safe(() => isPure(net)) },
      { key: "ordinary", label: "Ordinary", def: "Def. 19", check: safe(() => isOrdinary(net)) },
      { key: "sbounded", label: "Structurally bounded", def: "Def. 17", check: safe(() => isStructurallyBounded(net)) },
    ],
    [net, severalRoots],
  );
  const gluing = useMemo(() => {
    try {
      return gluingPlaces(net);
    } catch {
      return [];
    }
  }, [net]);
  const flagged = net.places.some((p) => p.gluing);

  const run = async () => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true);
    setError(null);
    setProgress(0);
    const n = useStore.getState().net;
    try {
      let g: StateGraph;
      if (semantics === "step") {
        const crg = await concurrentReachabilityGraphAsync(n, { maxStates: limit, maxEdges: limit * 40, maxStepsPerState: 2000, signal: ac.signal, yieldEvery: 40, onProgress: (s) => setProgress(s) });
        g = toStateGraph(crg);
      } else {
        await new Promise((r) => setTimeout(r, 30));
        g = reachabilityGraph(n, { semantics: "interleaving", limit });
      }
      if (abort.current === ac) setGraph({ g, net: n, semantics });
    } catch (e) {
      setError((e as Error).message);
    }
    if (abort.current === ac) setBusy(false);
  };
  useEffect(() => {
    void run();
    return () => abort.current?.abort();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const behaviour: Row[] = useMemo(() => {
    if (!graph || graph.net !== net) return [];
    const g = graph.g;
    return [
      { key: "live", label: "Live", def: "Def. 14", check: safe(() => isLive(net, g)) },
      { key: "reversible", label: "Cyclic / reversible", def: "Def. 10", check: safe(() => isReversible(net, g)) },
      { key: "kbounded", label: `${k}-bounded`, def: "Defs 16–17", check: safe(() => isKBounded(net, k, g)) },
    ];
  }, [graph, net, k]);
  const bounds = useMemo(() => {
    if (!graph || graph.net !== net) return [];
    try {
      const b = placeBounds(net, graph.g);
      return net.places.filter((p) => b.has(p.id)).map((p) => ({ name: p.name, ...b.get(p.id)! }));
    } catch {
      return [];
    }
  }, [graph, net]);

  const table = (rows: Row[]) => (
    <table className="props-table">
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} data-testid={`apn-${r.key}`}>
            <th>
              {r.label}
              <span className="muted small"> {r.def}</span>
            </th>
            <td>
              <Verdict ok={r.check ? r.check.ok : null} />
            </td>
            <td className="small">
              {r.check?.reason}
              {r.check && "derivation" in r.check && r.check.derivation && r.check.ok && (
                <details>
                  <summary>Derivation ({r.check.derivation.length} steps)</summary>
                  <ol className="mono small">
                    {r.check.derivation.map((d, i) => (
                      <li key={i}>
                        {d.kind === "root"
                          ? `root net (${nameOf(net, d.place)}, ${nameOf(net, d.control)})`
                          : d.kind === "forward"
                            ? `⊕${nameOf(net, d.gluing)} forward step ${nameOf(net, d.step)}`
                            : `⊕${nameOf(net, d.g1)}/${nameOf(net, d.g2)} backward step ${nameOf(net, d.step)}`}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <Modal title="APN properties" onClose={close} wide>
      <h3 className="section-title">Building blocks and composition</h3>
      <label className="check">
        <input type="checkbox" checked={severalRoots} onChange={(e) => setSeveralRoots(e.target.checked)} /> Accept several root nets side by side (as the N-graph of Fig. 4.11)
      </label>
      {table(structural)}
      <p className="small">
        Gluing (interface) places G: <span className="mono">{gluing.map((id) => nameOf(net, id)).join(", ") || "none"}</span>
        {!flagged && gluing.length > 0 && (
          <>
            {" "}
            <span className="muted">(read from the structure: the net records none)</span>{" "}
            <button
              className="small"
              disabled={useStore.getState().mode !== "edit"}
              onClick={() => {
                const set = new Set(gluing);
                edit((n) => ({ ...n, places: n.places.map((p) => (set.has(p.id) ? { ...p, gluing: true } : p)) }));
                toast(`Marked ${set.size} gluing place${set.size === 1 ? "" : "s"}`);
              }}
            >
              Mark them as gluing places
            </button>
          </>
        )}
      </p>
      <h3 className="section-title">Behaviour</h3>
      <div className="rg-head wrap">
        <label>
          State space{" "}
          <select value={semantics} onChange={(e) => setSemantics(e.target.value as "step" | "interleaving")}>
            <option value="step">steps: CRG(N)</option>
            <option value="interleaving">one transition at a time (smaller)</option>
          </select>
        </label>
        <label>
          up to <input type="number" min={10} max={200000} value={limit} onChange={(e) => setLimit(Math.max(10, Number(e.target.value) || 10))} style={{ width: 90 }} /> states
        </label>
        <label>
          k = <input type="number" min={1} max={1000} value={k} onChange={(e) => setK(Math.max(1, Number(e.target.value) || 1))} style={{ width: 60 }} />
        </label>
        {busy ? (
          <button className="small" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        ) : (
          <button className="small" onClick={() => void run()}>
            Explore again
          </button>
        )}
      </div>
      {busy && (
        <p className="muted small" role="status">
          Exploring… {plural(progress, "state")}
        </p>
      )}
      {error && <p className="error-text">{error}</p>}
      {graph && graph.net !== net && <p className="warn-text small">The model changed. Press Explore again.</p>}
      {graph && graph.net === net && (
        <>
          <p className="muted small">
            {plural(graph.g.markings.length, "reachable marking")} {graph.g.complete ? "(all of them)" : "explored (stopped at the limit: answers cover the explored part)"},{" "}
            {graph.semantics === "step" ? "with the step semantics of Sec. 3.3" : "firing one structured transition at a time"}.
          </p>
          {table(behaviour)}
          {bounds.length > 0 && (
            <details>
              <summary>Most tokens per place</summary>
              <table className="rg-table">
                <thead>
                  <tr>
                    <th>Place</th>
                    <th>of one colour</th>
                    <th>in total</th>
                  </tr>
                </thead>
                <tbody>
                  {bounds.map((b) => (
                    <tr key={b.name}>
                      <td>{b.name}</td>
                      <td>{b.perColour}</td>
                      <td>{b.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}
    </Modal>
  );
}

function nameOf(net: Net, id: string): string {
  return net.places.find((p) => p.id === id)?.name ?? net.transitions.find((t) => t.id === id)?.name ?? id;
}

// ---------- building blocks ----------

type BlockKind = "root" | "basic" | "one" | "uni";

const BLOCK_INFO: Record<BlockKind, { label: string; help: string }> = {
  root: { label: "Root net", help: "Def. 7, Fig. 4.6: the place p with the initial users, and its control place. Every composite step net starts from one." },
  basic: { label: "Basic step net", help: "Def. 6, Figs 4.2 and 4.5: a step p_s → t_s → p_f with a control system of one or more decision points. The operand of forward composition." },
  one: { label: "One step net", help: "Def. 11: a basic step net whose gluing places are p_s and p_f. The operand of backward composition." },
  uni: { label: "Unidirectional step", help: "Fig. 4.1, Sec. 4.1.1: p_s → t_s → p_f without a control system." },
};

/** The values of a finite colour set, as the generators take them. */
export function colourValues(cs: ColourSetDecl | undefined): (string | number)[] {
  if (!cs) return [];
  if (cs.type === "enum" || cs.type === "string") return cs.values ?? [];
  if (cs.type === "int") {
    const out: number[] = [];
    for (let i = cs.min ?? 0; i <= (cs.max ?? -1) && out.length < 32; i++) out.push(i);
    return out;
  }
  return [];
}

/** Colour sets a block can use: the net's finite user colour sets, and BW. */
function userColourSets(net: Net): ColourSetDecl[] {
  const own = net.declarations.colourSets.filter((c) => (c.type === "enum" || c.type === "int" || c.type === "string") && colourValues(c).length > 0);
  return own.some((c) => c.name === BW.name) ? own : [...own, BW];
}

function variableFor(net: Net, cs: string): string {
  const v = net.declarations.variables.find((x) => x.colourSet === cs);
  if (v) return v.name;
  const used = new Set(net.declarations.variables.map((x) => x.name));
  for (const name of ["x", "u", "c", "x2", "x3"]) if (!used.has(name)) return name;
  return `x${used.size + 1}`;
}

function ColourChips({ values, chosen, onChange, label }: { values: (string | number)[]; chosen: (string | number)[]; onChange: (v: (string | number)[]) => void; label: string }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {values.map((v) => {
        const on = chosen.some((c) => String(c) === String(v));
        return (
          <button key={String(v)} type="button" className={`chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => onChange(on ? chosen.filter((c) => String(c) !== String(v)) : [...chosen, v])}>
            {String(v)}
          </button>
        );
      })}
    </div>
  );
}

function NetPreview({ net }: { net: Net }) {
  const b = netBounds(net);
  const pad = 56;
  const cn = useMemo(() => compiled(net), [net]);
  return (
    <svg className="net-preview" viewBox={`${b.x - pad - 60} ${b.y - pad} ${b.w + 2 * pad + 120} ${b.h + 2 * pad + 10}`} role="img" aria-label={`Preview of ${net.name}`}>
      <NetDrawing net={net} cn={cn} palette={CSS_PALETTE} />
    </svg>
  );
}

function DecisionEditor({ values, decisions, onChange }: { values: (string | number)[]; decisions: (string | number)[][]; onChange: (d: (string | number)[][]) => void }) {
  return (
    <div className="decisions">
      {decisions.map((users, i) => (
        <div key={i} className="decision-row">
          <span className="small muted">Decision point {i + 1}: users</span>
          <ColourChips values={values} chosen={users} onChange={(u) => onChange(decisions.map((d, j) => (j === i ? u : d)))} label={`Users of decision point ${i + 1}`} />
          <button type="button" className="icon small" aria-label={`Remove decision point ${i + 1}`} title="Remove this decision point" disabled={decisions.length <= 1} onClick={() => onChange(decisions.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="small" onClick={() => onChange([...decisions, values.slice(0, 1)])}>
        + Decision point
      </button>
    </div>
  );
}

function NameField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value.replace(/\s+/g, "_"))} spellCheck={false} autoCapitalize="off" autoCorrect="off" />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Generators of Sec. 4.1-4.2: add a root net, step net or unidirectional step to the APN, or start a new APN from one. */
export function BlocksDialog({ Modal, close }: { Modal: ModalType; close: () => void }) {
  const net = useStore((s) => s.net);
  const mode = useStore((s) => s.mode);
  const isApn = net.netClass === "apn";
  const empty = net.places.length + net.transitions.length === 0;
  const base = isApn ? net : ({ ...net, places: [], transitions: [], declarations: { colourSets: [], variables: [], constants: [] } } as Net);
  const sets = userColourSets(base);
  const [kind, setKind] = useState<BlockKind>(isApn && net.places.length ? "basic" : "root");
  const [csName, setCsName] = useState(sets[0].name);
  const cs = sets.find((c) => c.name === csName) ?? sets[0];
  const values = colourValues(cs);
  const [names, setNames] = useState(() => {
    const p1 = nextNumbered(base, "p");
    const p2 = nextNumbered(base, "p", [p1]);
    return { place: freeName(base, "p"), start: p1, finish: p2, step: nextNumbered(base, "t") };
  });
  const [users, setUsers] = useState<(string | number)[]>(values);
  const [blocked, setBlocked] = useState<(string | number)[]>([]);
  const [decisions, setDecisions] = useState<(string | number)[][]>(values.map((v) => [v]));
  const [capacity, setCapacity] = useState(1);
  useEffect(() => {
    setUsers(values);
    setBlocked([]);
    setDecisions(values.map((v) => [v]));
  }, [csName]); // eslint-disable-line react-hooks/exhaustive-deps

  const built = useMemo((): { net: Net; check: Check } | { error: string } => {
    try {
      const common = { colourSet: cs, variable: variableFor(base, cs.name), capacity };
      const ds: DecisionPoint[] = decisions.map((u) => ({ users: u }));
      let b: Net;
      if (kind === "root") b = rootNet({ ...common, place: names.place, users, blocked });
      else if (kind === "uni") b = unidirectionalStep({ ...common, start: names.start, finish: names.finish, step: names.step, users });
      else {
        const o = { ...common, start: names.start, finish: names.finish, step: names.step, control: `ctrl_${names.finish}`, decisions: ds };
        b = kind === "basic" ? basicStepNet(o) : oneStepNet(o);
      }
      const check = kind === "root" ? isRootNet(b) : kind === "basic" ? isBasicStepNet(b) : kind === "one" ? isOneStepNet(b) : { ok: true, reason: "Unidirectional step (Fig. 4.1)" };
      return { net: b, check };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [kind, cs, names, users, blocked, decisions, capacity]); // eslint-disable-line react-hooks/exhaustive-deps

  const clash = "net" in built && isApn ? [...built.net.places, ...built.net.transitions].find((n) => net.places.some((p) => p.name === n.name) || net.transitions.some((t) => t.name === n.name)) : undefined;
  const canAdd = mode === "edit" && (isApn || empty) && "net" in built && !clash;
  const addWhy = mode !== "edit" ? "Stop the token game first" : !isApn && !empty ? "This net is not an APN: open the block as a new APN instead" : clash ? `The net already has an element called ${clash.name}` : "";

  const add = () => {
    if (!("net" in built)) return;
    const r = insertBlock(built.net);
    if ("error" in r) return toast(r.error, "error");
    close();
    requestFit();
    toast(`Added the ${BLOCK_INFO[kind].label.toLowerCase()}`);
  };
  const openNew = () => {
    if (!("net" in built)) return;
    const s = useStore.getState();
    const has = s.net.places.length + s.net.transitions.length > 0;
    if (s.dirty && has && !window.confirm("Discard unsaved changes?")) return;
    loadNet({ ...built.net, name: built.net.name }, null);
    useStore.setState({ dirty: true, seenWelcome: true });
  };

  return (
    <Modal title="Building blocks" onClose={close} wide>
      <div className="blocks">
        <div className="blocks-form">
          <div className="seg wrap-seg" role="tablist" aria-label="Building block">
            {(Object.keys(BLOCK_INFO) as BlockKind[]).map((k) => (
              <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)} data-testid={`block-${k}`}>
                {BLOCK_INFO[k].label}
              </button>
            ))}
          </div>
          <p className="muted small">{BLOCK_INFO[kind].help}</p>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Users (colour set)</span>
              <select value={cs.name} onChange={(e) => setCsName(e.target.value)}>
                {sets.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} = {"{"}
                    {colourValues(c).join(", ")}
                    {"}"}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Capacity per colour</span>
              <input type="number" min={1} max={99} value={capacity} onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 1))} />
            </label>
            {kind === "root" ? (
              <NameField label="Place p" value={names.place} onChange={(v) => setNames({ ...names, place: v })} hint={`Its control place is ctrl_${names.place}`} />
            ) : (
              <>
                <NameField label="Starting place p_s" value={names.start} onChange={(v) => setNames({ ...names, start: v })} />
                <NameField label="Step transition t_s" value={names.step} onChange={(v) => setNames({ ...names, step: v })} />
                <NameField label="Finishing place p_f" value={names.finish} onChange={(v) => setNames({ ...names, finish: v })} hint={kind === "uni" ? undefined : `Its control place is ctrl_${names.finish}`} />
              </>
            )}
          </div>
          {(kind === "root" || kind === "uni") && (
            <div className="field">
              <span className="field-label">{kind === "root" ? "Initial users in p" : "Users in p_s"}</span>
              <ColourChips values={values} chosen={users} onChange={setUsers} label="Initial users" />
            </div>
          )}
          {kind === "root" && (
            <div className="field">
              <span className="field-label">Users stopped from proceeding (tokens in the control place, Fig. 4.6(b))</span>
              <ColourChips values={values} chosen={blocked} onChange={setBlocked} label="Blocked users" />
            </div>
          )}
          {(kind === "basic" || kind === "one") && <DecisionEditor values={values} decisions={decisions} onChange={setDecisions} />}
        </div>
        <div className="blocks-preview">
          {"net" in built ? (
            <>
              <NetPreview net={built.net} />
              <p className={`small ${built.check.ok ? "ok-text" : "error-text"}`}>{built.check.reason}</p>
            </>
          ) : (
            <p className="error-text">{built.error}</p>
          )}
        </div>
      </div>
      {addWhy && <p className="muted small">{addWhy}</p>}
      <div className="btn-row end">
        <button className="small" onClick={openNew} disabled={!("net" in built)} data-testid="block-new">
          Open as a new APN
        </button>
        <button className="small primary" onClick={add} disabled={!canAdd} data-testid="block-add">
          Add to this net
        </button>
      </div>
    </Modal>
  );
}

// ---------- composition ----------

function placeColourSet(net: Net, p: Place | undefined): ColourSetDecl | undefined {
  return net.declarations.colourSets.find((c) => c.name === (p?.colourSet ?? ""));
}

/** Forward (Def. 8) and backward (Def. 12) composition of the current APN with a new step net. */
export function ComposeDialog({ Modal, close }: { Modal: ModalType; close: () => void }) {
  const net = useStore((s) => s.net);
  const mode = useStore((s) => s.mode);
  const gluing = useMemo(() => {
    try {
      return gluingPlaces(net);
    } catch {
      return [];
    }
  }, [net]);
  const [op, setOp] = useState<"forward" | "backward">("forward");
  const [g, setG] = useState(gluing[gluing.length - 1] ?? "");
  const [g2, setG2] = useState(gluing[0] ?? "");
  const gp = net.places.find((p) => p.id === g);
  const cs = placeColourSet(net, gp);
  const values = colourValues(cs);
  const [step, setStep] = useState(() => nextNumbered(net, "t"));
  const [finish, setFinish] = useState(() => nextNumbered(net, "p"));
  const [decisions, setDecisions] = useState<(string | number)[][]>(() => values.map((v) => [v]));
  useEffect(() => setDecisions(values.map((v) => [v])), [cs?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const stepNet = useMemo((): Net | { error: string } => {
    if (!gp || !cs) return { error: gluing.length ? "Choose a gluing place" : "This net has no gluing places: start from a root net (Building blocks)" };
    try {
      const nameFor = (what: string, i: number) => `${what}_${step}_${i + 1}`;
      const ds: DecisionPoint[] = decisions.map((u, i) => ({ users: u, database: nameFor("db", i), response: nameFor("advice", i), emptying: nameFor("Tem", i), retrieve: nameFor("Tr", i) }));
      const o = {
        colourSet: cs,
        variable: variableFor(net, cs.name),
        capacity: gp.capacity ?? 1,
        start: `${gp.name}_s`,
        finish: op === "forward" ? finish : `${nameOf(net, g2)}_f`,
        step,
        control: op === "forward" ? `ctrl_${finish}` : `ctrl_${step}`,
        decisions: ds,
        name: `Step ${step}`,
      };
      return op === "forward" ? basicStepNet(o) : oneStepNet(o);
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [op, gp, cs, net, finish, step, decisions, g2, gluing.length]);

  const check: Check = useMemo(() => {
    if ("error" in stepNet) return { ok: false, reason: stepNet.error };
    const names = new Set([...net.places, ...net.transitions].map((n) => n.name));
    const glued = new Set([stepNet.places.find((p) => p.gluing)?.name, ...(op === "backward" ? stepNet.places.filter((p) => p.gluing).map((p) => p.name) : [])]);
    const clash = [...stepNet.places, ...stepNet.transitions].find((n) => !glued.has(n.name) && names.has(n.name));
    if (clash) return { ok: false, reason: `The net already has an element called ${clash.name}; choose another name` };
    return op === "forward" ? checkForwardComposition(net, g, stepNet) : checkBackwardComposition(net, g, g2, stepNet);
  }, [stepNet, net, op, g, g2]);

  const apply = () => {
    if ("error" in stepNet || !check.ok) return;
    try {
      const out = op === "forward" ? forwardCompose(net, g, stepNet, { name: net.name }) : backwardCompose(net, g, g2, stepNet, { name: net.name });
      edit(() => ({ ...out, comment: net.comment }));
      useStore.setState({ selection: [] });
      close();
      requestFit();
      toast(op === "forward" ? `Composed ⊕${gp?.name}: the new step ${step}` : `Composed ⊕${gp?.name}/${nameOf(net, g2)}: the new step ${step}`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  if (net.netClass !== "apn")
    return (
      <Modal title="Compose steps" onClose={close}>
        <p className="muted">Composition works on APNs. Switch the net class to APN, or start from a root net under Building blocks.</p>
      </Modal>
    );
  return (
    <Modal title="Compose steps" onClose={close} wide>
      <div className="seg wrap-seg" role="tablist" aria-label="Composition">
        <button role="tab" aria-selected={op === "forward"} className={op === "forward" ? "on" : ""} onClick={() => setOp("forward")} data-testid="compose-forward">
          Forward (Def. 8)
        </button>
        <button role="tab" aria-selected={op === "backward"} className={op === "backward" ? "on" : ""} onClick={() => setOp("backward")} data-testid="compose-backward">
          Backward (Def. 12)
        </button>
      </div>
      <p className="muted small">
        {op === "forward"
          ? "N ⊕g N_S glues the starting place of a new basic step net onto the gluing place g; the new finishing place becomes a gluing place."
          : "N ⊕g1/g2 N_S glues a new one step net from g1 to g2: a step back (or across) between places that already exist."}
      </p>
      <div className="blocks">
        <div className="blocks-form">
          <div className="form-grid">
            <label className="field">
              <span className="field-label">{op === "forward" ? "Gluing place g" : "From g1 (glued to p_s)"}</span>
              <select value={g} onChange={(e) => setG(e.target.value)} data-testid="compose-g">
                {gluing.map((id) => (
                  <option key={id} value={id}>
                    {nameOf(net, id)}
                  </option>
                ))}
              </select>
            </label>
            {op === "backward" && (
              <label className="field">
                <span className="field-label">To g2 (glued to p_f)</span>
                <select value={g2} onChange={(e) => setG2(e.target.value)} data-testid="compose-g2">
                  {gluing.map((id) => (
                    <option key={id} value={id}>
                      {nameOf(net, id)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <NameField label="Step transition t_s" value={step} onChange={setStep} />
            {op === "forward" && <NameField label="New finishing place p_f" value={finish} onChange={setFinish} />}
          </div>
          {values.length > 0 && <DecisionEditor values={values} decisions={decisions} onChange={setDecisions} />}
        </div>
        <div className="blocks-preview">{"error" in stepNet ? null : <NetPreview net={stepNet} />}</div>
      </div>
      <p className={`small ${check.ok ? "ok-text" : "error-text"}`} role="status" data-testid="compose-check">
        {check.ok ? "✓ " : ""}
        {check.reason}
      </p>
      <div className="btn-row end">
        <button className="small" onClick={close}>
          Cancel
        </button>
        <button className="small primary" onClick={apply} disabled={!check.ok || mode !== "edit"} data-testid="compose-apply">
          Compose
        </button>
      </div>
    </Modal>
  );
}
