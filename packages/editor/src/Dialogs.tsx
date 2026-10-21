import { AnalysisDialog } from "./Analysis";
import { ApnPropsDialog, BlocksDialog, ComposeDialog, CrgDialog, EquivalenceDialog, TapnDialog } from "./AmbientDialogs";
import { CtlDialog } from "./CtlDialog";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Binding, Marking, NET_CLASS_LABELS, NetClass, enabledBindings, fire, initialMarking, markingKey, showBinding, showTokens } from "@pns/core";
import { cmdOpen, cmdOpenExample } from "./fileOps";
import { EXAMPLES } from "./examples";
import { centerOn } from "./Canvas";
import { FTIcon, Icon, MOD } from "./Toolbar";
import { compiled, enterPage, newNet, pagePath, select, startSimulation, toast, useStore } from "./store";

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="icon" aria-label="Close" title="Close (Esc)" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

const close = () => useStore.setState({ dialog: null });

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  switch (dialog) {
    case "new":
      return <NewNetDialog />;
    case "help":
      return <HelpDialog />;
    case "search":
      return <SearchDialog />;
    case "rg":
      return <ReachabilityDialog />;
    case "about":
      return <AboutDialog />;
    case "analysis":
      return <AnalysisDialog Modal={Modal} close={close} />;
    case "crg":
      return <CrgDialog Modal={Modal} close={close} />;
    case "tapn":
      return <TapnDialog Modal={Modal} close={close} />;
    case "equivalence":
      return <EquivalenceDialog Modal={Modal} close={close} />;
    case "apnProps":
      return <ApnPropsDialog Modal={Modal} close={close} />;
    case "blocks":
      return <BlocksDialog Modal={Modal} close={close} />;
    case "compose":
      return <ComposeDialog Modal={Modal} close={close} />;
    case "ctl":
      return <CtlDialog Modal={Modal} close={close} />;
  }
  return null;
}

// ---------- new net gallery ----------

const CLASS_HELP: Record<NetClass, string> = {
  pt: "Places, transitions and weighted arcs. The classic Petri net.",
  xpt: "Adds read, inhibitor, reset and equal arcs and marking-dependent weights.",
  coloured: "Tokens carry data (colours). Guards and multiset inscriptions.",
  timed: "Each transition fires within a time interval [earliest, latest].",
  stochastic: "Transitions fire after random delays given by rate functions.",
  continuous: "Places hold real amounts; transitions are flows (ODEs).",
  hybrid: "Mixes discrete stochastic and continuous parts.",
  colouredStochastic: "Coloured net with stochastic rates.",
  colouredContinuous: "Coloured net with continuous flows.",
  colouredHybrid: "Coloured net mixing stochastic and continuous parts.",
  fuzzyStochastic: "Stochastic net with uncertain (fuzzy) parameters.",
  fuzzyContinuous: "Continuous net with uncertain (fuzzy) parameters.",
  fuzzyHybrid: "Hybrid net with uncertain (fuzzy) parameters.",
  colouredFuzzyStochastic: "Coloured stochastic net with fuzzy parameters.",
  colouredFuzzyContinuous: "Coloured continuous net with fuzzy parameters.",
  colouredFuzzyHybrid: "Coloured hybrid net with fuzzy parameters.",
  modulo: "Token counts wrap around modulo a number. Used for qualitative models.",
  music: "Transitions play notes when they fire.",
  freestyle: "Draw anything: no rules, no simulation. Good for sketches.",
  faultTree: "Events and logic gates. Cut sets, probabilities, importance.",
  extendedFaultTree: "Adds repair and dynamic gates (priority AND, spare, dependency).",
  apn: "Konios's Ambient Petri nets: coloured tokens as users, colour-sensitive inhibitor arcs and step semantics.",
  tapn: "Transformed Ambient Petri nets: APNs constructed for verification, with the extra control colour.",
};

const GROUPS: { title: string; classes: NetClass[] }[] = [
  { title: "Petri nets", classes: ["pt", "xpt", "coloured"] },
  { title: "Time and rates", classes: ["timed", "stochastic", "continuous", "hybrid"] },
  { title: "Coloured with rates", classes: ["colouredStochastic", "colouredContinuous", "colouredHybrid"] },
  { title: "Fuzzy", classes: ["fuzzyStochastic", "fuzzyContinuous", "fuzzyHybrid", "colouredFuzzyStochastic", "colouredFuzzyContinuous", "colouredFuzzyHybrid"] },
  { title: "Ambient (Konios)", classes: ["apn", "tapn"] },
  { title: "Special", classes: ["modulo", "music", "freestyle"] },
  { title: "Reliability", classes: ["faultTree", "extendedFaultTree"] },
];

function ClassIcon({ c }: { c: NetClass }) {
  if (c === "faultTree" || c === "extendedFaultTree") return <FTIcon type={c === "faultTree" ? "or" : "pand"} size={28} />;
  if (c === "music") return <Icon name="music" size={28} />;
  if (c === "freestyle") return <Icon name="note" size={28} />;
  const coloured = c.startsWith("coloured");
  const cont = /ontinuous|ybrid/.test(c);
  return (
    <svg width={44} height={28} viewBox="0 0 44 28" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <circle cx={10} cy={14} r={8} />
      {cont && <circle cx={10} cy={14} r={5.5} />}
      {!cont && <circle cx={10} cy={14} r={2.2} fill={coloured ? "#e11d48" : "currentColor"} stroke="none" />}
      {coloured && !cont && <circle cx={6.5} cy={14} r={2.2} fill="#2563eb" stroke="none" />}
      <path d="M18 14h10" />
      <path d="M25 11l3 3-3 3" />
      <rect x={31} y={5} width={6} height={18} rx={1} fill={c === "timed" ? "none" : undefined} />
      {c.includes("uzzy") && <path d="M2 26q4-6 8 0t8 0" strokeWidth={1.2} />}
      {c === "modulo" && <text x={34} y={27} fontSize={7} stroke="none" fill="currentColor">mod</text>}
    </svg>
  );
}

function NewNetDialog() {
  const dirty = useStore((s) => s.dirty);
  const hasContent = useStore((s) => s.net.places.length + s.net.transitions.length + (s.net.faultTree?.nodes.length ?? 0) > 0);
  const choose = (c: NetClass) => {
    if (dirty && hasContent && !window.confirm("Discard unsaved changes?")) return;
    newNet(c);
    useStore.setState({ dialog: null, seenWelcome: true });
  };
  return (
    <Modal title="Create a new model" onClose={() => useStore.setState({ dialog: null, seenWelcome: true })} wide>
      <div className="gallery">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            <div className="gallery-row">
              {g.classes.map((c) => (
                <button key={c} className="class-card" onClick={() => choose(c)} data-testid={`new-${c}`}>
                  <ClassIcon c={c} />
                  <strong>{NET_CLASS_LABELS[c]}</strong>
                  <span>{CLASS_HELP[c]}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        <section>
          <h3>Or start from</h3>
          <div className="gallery-row">
            <button className="class-card compact" onClick={() => useStore.setState({ dialog: "blocks", seenWelcome: true })} data-testid="new-from-blocks">
              <strong>Ambient building blocks…</strong>
              <span>An APN from a root net or step net</span>
            </button>
            <button
              className="class-card compact"
              onClick={() => {
                useStore.setState({ dialog: null });
                void cmdOpen();
              }}
            >
              <strong>Open a file…</strong>
              <span>Donwinne, Snoopy, PNML, ANDL</span>
            </button>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.title}
                className="class-card compact"
                onClick={() => {
                  useStore.setState({ dialog: null, seenWelcome: true });
                  cmdOpenExample(ex.net);
                }}
              >
                <strong>{ex.title}</strong>
                <span>Example</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}

// ---------- help ----------

const SHORTCUTS: [string, string][] = [
  ["V · P · T · A · N", "Select, place, transition, arc and note tools"],
  ["1 – 6", "Arc type: normal, read, inhibitor, reset, equal, modifier"],
  ["Double-click canvas", "Add a place (an event in fault trees)"],
  ["Double-click node", "Rename it; inside a place, edit its tokens"],
  ["Double-click arc", "Edit its weight or inscription"],
  ["Double-click subnet", "Open it; Backspace goes back up"],
  ["+ / −", "Add or remove a token on the selected places"],
  ["F2 · Enter", "Rename the selected node"],
  ["Right-click", "Options for the thing under the mouse"],
  ["Delete", "Delete the selection"],
  [`${MOD}Z · ${MOD}⇧Z`, "Undo, redo"],
  [`${MOD}C · X · V · D`, "Copy, cut, paste, duplicate"],
  [`${MOD}A`, "Select everything on this page"],
  [`${MOD}G`, "Group the selection into a subnet"],
  [`${MOD}L`, "Auto layout"],
  [`${MOD}F`, "Find by name"],
  ["Arrows (+Shift)", "Nudge the selection by 1 (10)"],
  ["Space+drag · right-drag", "Pan"],
  [`${MOD}wheel · pinch`, "Zoom"],
  ["F · M · G · B", "Zoom to fit, overview map, snap to grid, bottom panel"],
  ["S", "Start the token game"],
  ["← → · R · Space · Esc", "In the token game: back, forward, random, run, stop"],
  ["X", "Step token game: fire a maximal step"],
];

function HelpDialog() {
  return (
    <Modal title="Quick guide" onClose={close} wide>
      <div className="help-grid">
        <div>
          <h3>Drawing</h3>
          <ol className="help-steps">
            <li>
              <b>Add nodes:</b> drag a place or transition from the left onto the canvas, or double-click empty space.
            </li>
            <li>
              <b>Connect:</b> hover a node and drag its <span className="plus-dot">+</span> handle onto another node. Drop it on empty space to create
              and connect the next node in one go.
            </li>
            <li>
              <b>Edit in place:</b> double-click a name, the inside of a place (tokens) or an arc (weight). Enter saves, Esc cancels.
            </li>
            <li>
              <b>Bend arcs:</b> select an arc and drag the dot in the middle of a segment. Alt-click a bend to remove it.
            </li>
            <li>
              <b>Reconnect:</b> select an arc and drag one of its ends onto another node.
            </li>
            <li>
              <b>Tidy up:</b> select several nodes to align or space them, colour them, or group them into a subnet. Auto layout arranges the whole
              page.
            </li>
          </ol>
          <h3>On a touch screen</h3>
          <p>
            Tap to select and drag to move. Pinch to zoom and drag with two fingers (or one finger on empty space) to pan. Double-tap to rename,
            long-press for the menu, and long-press then drag on empty space to select an area. Tap a tool and then the canvas to add a node, or
            drag the tool onto the canvas. The <b>Properties</b> button opens the details of the selection.
          </p>
          <h3>Running</h3>
          <p>
            Press <b>Simulate</b> and click green transitions to fire them, or press play. For timed, stochastic, continuous and hybrid nets, use
            <b> Analyse › Simulate over time</b> to plot how markings change. Fault trees are analysed with <b>Analyse tree</b>.
          </p>
          <h3>Ambient Petri nets</h3>
          <p>
            In an APN or T-APN the token game fires steps: pick one colour mode (t, c) of a transition, or collect several and fire them together. The
            panel says why a mode cannot fire, for example a colour-sensitive inhibitor arc. <b>Analyse › Ambient</b> has the concurrent reachability
            graph, building blocks, composition, the T-APN construction with its equivalence check, and model checking.
          </p>
        </div>
        <div>
          <h3>Shortcuts</h3>
          <table className="shortcuts">
            <tbody>
              {SHORTCUTS.map(([k, v]) => (
                <tr key={k}>
                  <td>
                    <kbd>{k}</kbd>
                  </td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

function AboutDialog() {
  return (
    <Modal title="About Donwinne" onClose={close}>
      <p>
        <b>Donwinne 0.2</b> is a Petri nets studio: an editor, simulator and analyser for Petri nets and fault trees.
      </p>
      <p>
        <b>Donwinne by Navin Hariharan</b> (
        <a href="https://navin-hariharan.com" target="_blank" rel="noreferrer">
          navin-hariharan.com
        </a>
        ,{" "}
        <a href="https://github.com/navin-hariharan" target="_blank" rel="noreferrer">
          github.com/navin-hariharan
        </a>
        ).
        <br />© 2026 Navin Hariharan. All rights reserved.
      </p>
      <p>
        <b>Licence.</b> Free for educational use (teaching, learning, coursework, academic research and non-commercial
        study). Commercial use, including use inside a company, in a paid product or service, paid consulting or training,
        or selling, hosting or redistributing the software, needs written permission or a commercial licence: contact{" "}
        <a href="https://navin-hariharan.com" target="_blank" rel="noreferrer">
          navin-hariharan.com
        </a>
        . Anyone using Donwinne or any part of it must credit the author as above wherever it is used, shown or published.
        Provided "as is", without warranty. See the{" "}
        <a
          href="https://github.com/navin-hariharan/Donwinne/blob/main/LICENSE.md"
          target="_blank"
          rel="noreferrer"
        >
          full licence
        </a>
        .
      </p>
      <p>
        Inspired by Snoopy (Brandenburg University of Technology Cottbus-Senftenberg), whose net classes it covers. Ambient Petri
        Nets and the related features come from Alexandros Konios's PhD thesis (2015). Snoopy and the thesis are the
        inspiration and source of features, not part of Donwinne. Built with open-source libraries that remain under their own
        licences; see{" "}
        <a
          href="https://github.com/navin-hariharan/Donwinne/blob/main/CREDITS.md"
          target="_blank"
          rel="noreferrer"
        >
          CREDITS.md
        </a>
        .
      </p>
      <p className="muted">
        Runs in the browser and as a desktop app. Your work is saved in this browser automatically; use File › Save to keep a
        file.
      </p>
    </Modal>
  );
}

// ---------- search ----------

interface Hit {
  id: string;
  kind: string;
  name: string;
  detail: string;
  page: string | null;
  x: number;
  y: number;
}

function SearchDialog() {
  const net = useStore((s) => s.net);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const hits = useMemo<Hit[]>(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const out: Hit[] = [];
    const m = (s: string | undefined) => !!s && s.toLowerCase().includes(needle);
    for (const p of net.places)
      if (m(p.name) || m(p.comment) || m(p.marking)) out.push({ id: p.id, kind: "Place", name: p.name, detail: p.marking, page: p.parent ?? null, x: p.x, y: p.y });
    for (const t of net.transitions)
      if (m(t.name) || m(t.comment) || m(t.guard) || m(t.rate)) out.push({ id: t.id, kind: "Transition", name: t.name, detail: t.guard ?? t.rate ?? "", page: t.parent ?? null, x: t.x, y: t.y });
    for (const n of net.faultTree?.nodes ?? []) if (m(n.name) || m(n.comment)) out.push({ id: n.id, kind: n.type, name: n.name, detail: "", page: n.parent ?? null, x: n.x, y: n.y });
    for (const n of net.notes ?? []) if (m(n.text)) out.push({ id: n.id, kind: "Note", name: n.text.split("\n")[0], detail: "", page: n.parent ?? null, x: n.x, y: n.y });
    for (const a of net.arcs)
      if (m(a.inscription)) {
        const s = net.places.find((p) => p.id === a.source) ?? net.transitions.find((t) => t.id === a.source);
        const d = net.places.find((p) => p.id === a.target) ?? net.transitions.find((t) => t.id === a.target);
        if (s && d) out.push({ id: a.id, kind: "Arc", name: `${s.name} → ${d.name}`, detail: a.inscription, page: s.parent ?? null, x: (s.x + d.x) / 2, y: (s.y + d.y) / 2 });
      }
    return out.slice(0, 200);
  }, [q, net]);

  useEffect(() => {
    useStore.setState({ highlight: hits.map((h) => h.id) });
    setActive(0);
  }, [hits]);
  useEffect(() => () => useStore.setState({ highlight: [] }), []);

  const go = (h: Hit) => {
    if (useStore.getState().page !== h.page) enterPage(h.page);
    select([h.id]);
    requestAnimationFrame(() => centerOn({ x: h.x, y: h.y }));
  };

  return (
    <div className="search-pop" role="dialog" aria-label="Find">
      <div className="search-row">
        <Icon name="search" />
        <input
          ref={inputRef}
          value={q}
          placeholder="Find places, transitions, events, notes…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") close();
            if (e.key === "ArrowDown") (e.preventDefault(), setActive(Math.min(hits.length - 1, active + 1)));
            if (e.key === "ArrowUp") (e.preventDefault(), setActive(Math.max(0, active - 1)));
            if (e.key === "Enter" && hits[active]) go(hits[active]);
          }}
          data-testid="search-input"
        />
        <span className="muted small">{q ? `${hits.length} found` : ""}</span>
        <button className="icon" aria-label="Close" onClick={close}>
          ✕
        </button>
      </div>
      {hits.length > 0 && (
        <ul className="search-results">
          {hits.map((h, i) => (
            <li key={h.id} className={i === active ? "on" : ""} onMouseEnter={() => setActive(i)} onClick={() => go(h)}>
              <span className="kind">{h.kind}</span>
              <span className="name">{h.name}</span>
              {h.page && <span className="muted small">in {pagePath(net, h.page).map((n) => n.name).join(" › ")}</span>}
              {h.detail && <span className="muted small mono">{h.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- reachability graph ----------

interface RG {
  states: Marking[];
  edges: { from: number; to: number; label: string; t: string; b: Binding }[];
  parent: (number | null)[];
  parentEdge: (number | null)[];
  complete: boolean;
  dead: number[];
  bound: number;
  error?: string;
}

function buildRG(limit: number): RG {
  const net = useStore.getState().net;
  const cn = compiled(net);
  const M0 = initialMarking(cn);
  const states: Marking[] = [M0];
  const index = new Map([[markingKey(M0), 0]]);
  const edges: RG["edges"] = [];
  const parent: (number | null)[] = [null];
  const parentEdge: (number | null)[] = [null];
  const dead: number[] = [];
  let bound = 0;
  let complete = true;
  for (let i = 0; i < states.length; i++) {
    const M = states[i];
    for (const m of M) bound = Math.max(bound, m.size);
    let any = false;
    for (const t of cn.transitions) {
      const r = enabledBindings(cn, t.index, M);
      if (r.error) return { states, edges, parent, parentEdge, complete: false, dead, bound, error: `${t.name}: ${r.error}` };
      for (const b of r.bindings) {
        any = true;
        const N = fire(cn, t.index, b, M);
        const k = markingKey(N);
        let j = index.get(k);
        if (j === undefined) {
          if (states.length >= limit) {
            complete = false;
            continue;
          }
          j = states.length;
          index.set(k, j);
          states.push(N);
          parent.push(i);
          parentEdge.push(edges.length);
        }
        edges.push({ from: i, to: j, label: `${t.name}${showBinding(b) ? " " + showBinding(b) : ""}`, t: t.id, b });
      }
    }
    if (!any) dead.push(i);
  }
  return { states, edges, parent, parentEdge, complete, dead, bound };
}

function ReachabilityDialog() {
  const net = useStore((s) => s.net);
  const [limit, setLimit] = useState(5000);
  const [rg, setRg] = useState<RG | null>(null);
  const [busy, setBusy] = useState(false);
  const cn = compiled(net);
  const run = () => {
    if (cn.problems.some((p) => p.severity === "error")) {
      toast("Fix the problems in the model first", "error");
      return;
    }
    setBusy(true);
    setTimeout(() => {
      try {
        setRg(buildRG(limit));
      } catch (e) {
        toast((e as Error).message, "error");
      }
      setBusy(false);
    }, 10);
  };
  useEffect(run, []); // eslint-disable-line react-hooks/exhaustive-deps

  const showState = (i: number) => {
    if (!rg) return;
    // Replay the path from the initial marking in the token game.
    const path: number[] = [];
    for (let s: number | null = i; s !== null && rg.parentEdge[s] !== null; s = rg.parent[s]) path.unshift(rg.parentEdge[s]!);
    close();
    startSimulation();
    const st = useStore.getState();
    if (st.mode !== "simulate") return;
    const sim = [...st.sim];
    for (const e of path) {
      const ed = rg.edges[e];
      sim.push({ marking: rg.states[ed.to], label: ed.label, transitionId: ed.t });
    }
    useStore.setState({ sim, simIndex: sim.length - 1 });
  };

  const placeCols = cn.places.filter((p, i, arr) => arr.findIndex((q) => q.slot === p.slot) === i);
  const showRows = rg ? rg.states.slice(0, 300) : [];
  return (
    <Modal title="Reachability graph" onClose={close} wide>
      <div className="rg-head">
        <label>
          Stop after{" "}
          <input type="number" min={10} max={200000} value={limit} onChange={(e) => setLimit(Math.max(10, Number(e.target.value) || 10))} style={{ width: 90 }} /> states
        </label>
        <button className="small" onClick={run} disabled={busy}>
          {busy ? "Exploring…" : "Explore again"}
        </button>
      </div>
      {rg && (
        <>
          {rg.error && <p className="error-text">{rg.error}</p>}
          <div className="stat-row">
            <div className="stat">
              <b>{rg.states.length}</b>
              <span>states{rg.complete ? "" : " (stopped early)"}</span>
            </div>
            <div className="stat">
              <b>{rg.edges.length}</b>
              <span>edges</span>
            </div>
            <div className="stat">
              <b>{rg.dead.length}</b>
              <span>dead states</span>
            </div>
            <div className="stat">
              <b>{rg.complete ? rg.bound : `≥ ${rg.bound}`}</b>
              <span>max tokens in one place</span>
            </div>
            <div className="stat">
              <b>{rg.complete ? (rg.dead.length ? "No" : "Yes") : "?"}</b>
              <span>deadlock-free</span>
            </div>
          </div>
          <p className="muted small">Click a state to replay the path to it in the token game. Dead states are marked.</p>
          <div className="rg-table-wrap">
            <table className="rg-table">
              <thead>
                <tr>
                  <th>#</th>
                  {placeCols.map((p) => (
                    <th key={p.id}>{p.name}</th>
                  ))}
                  <th>Next</th>
                </tr>
              </thead>
              <tbody>
                {showRows.map((M, i) => (
                  <tr key={i} className={rg.dead.includes(i) ? "dead" : ""} onClick={() => showState(i)}>
                    <td>{i === 0 ? "M0" : i}</td>
                    {placeCols.map((p) => (
                      <td key={p.id} className="mono">
                        {showTokens(cn, M[p.slot]) || "·"}
                      </td>
                    ))}
                    <td className="small">
                      {rg.edges
                        .filter((e) => e.from === i)
                        .slice(0, 6)
                        .map((e) => `${e.label}→${e.to}`)
                        .join(", ") || "dead"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rg.states.length > showRows.length && <p className="muted small">Showing the first {showRows.length} states.</p>}
          </div>
        </>
      )}
    </Modal>
  );
}
