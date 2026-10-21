import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArcKind, FTNodeType, NET_CLASS_LABELS, NetClass, arcKindsFor, isAmbient, isColoured, isFaultTree, timeBase } from "@pns/core";
import { EXPORT_FORMATS, cmdUnfold, exportProblem, cmdExport, cmdImport, cmdOpen, cmdOpenExample, cmdPrint, cmdSave } from "./fileOps";
import { EXAMPLES } from "./examples";
import { TOOL_MIME, placeTool, zoomBy } from "./Canvas";
import { autoLayout } from "./layout";
import {
  Tool,
  adoptMarking,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  groupIntoSubnet,
  paste,
  redo,
  requestFit,
  selectAll,
  selectKind,
  setNetClass,
  setTool,
  simGoto,
  startSimulation,
  stopSimulation,
  undo,
  updateNet,
  useStore,
} from "./store";
import { stepRandom } from "./simulation";
import { cmdConstructTapn, fireMaximalStep, openAmbientDialog, useAmbient } from "./ambient";
import { propsDocked, useScreenClass } from "./responsive";

export const ARC_KIND_INFO: Record<ArcKind, { label: string; help: string; key: string }> = {
  normal: { label: "Normal", help: "Consumes tokens from the place, or produces them into it.", key: "1" },
  read: { label: "Read", help: "Needs the tokens in the place but does not consume them.", key: "2" },
  inhibitor: { label: "Inhibitor", help: "Blocks the transition while the place holds at least this many tokens (of the given colour).", key: "3" },
  reset: { label: "Reset", help: "Empties the place when the transition fires; never blocks it.", key: "4" },
  equal: { label: "Equal", help: "Enables the transition only when the place holds exactly this many tokens.", key: "5" },
  modifier: { label: "Modifier", help: "Lets the place's marking appear in the transition's rate without testing or changing it.", key: "6" },
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const s = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "select":
      return <svg {...s}><path d="M5 3l14 8-6 2-3 6z" /></svg>;
    case "place":
      return <svg {...s}><circle cx="12" cy="12" r="8" /></svg>;
    case "transition":
      return <svg {...s}><rect x="9" y="3" width="6" height="18" rx="1" /></svg>;
    case "arc":
      return <svg {...s}><path d="M4 20L19 5" /><path d="M12 5h7v7" /></svg>;
    case "note":
      return <svg {...s}><path d="M5 4h14v11l-5 5H5z" /><path d="M14 20v-5h5" /><path d="M8 9h8M8 12h5" /></svg>;
    case "undo":
      return <svg {...s}><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 010 10h-3" /></svg>;
    case "redo":
      return <svg {...s}><path d="M15 14l5-5-5-5" /><path d="M20 9H9a5 5 0 000 10h3" /></svg>;
    case "zoom-in":
      return <svg {...s}><circle cx="11" cy="11" r="7" /><path d="M21 21l-5-5M11 8v6M8 11h6" /></svg>;
    case "zoom-out":
      return <svg {...s}><circle cx="11" cy="11" r="7" /><path d="M21 21l-5-5M8 11h6" /></svg>;
    case "fit":
      return <svg {...s}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>;
    case "play":
      return <svg {...s}><path d="M7 4l13 8-13 8z" /></svg>;
    case "pause":
      return <svg {...s}><path d="M8 4v16M16 4v16" /></svg>;
    case "back":
      return <svg {...s}><path d="M15 5l-7 7 7 7" /></svg>;
    case "forward":
      return <svg {...s}><path d="M9 5l7 7-7 7" /></svg>;
    case "reset":
      return <svg {...s}><path d="M4 4v6h6" /><path d="M5 15a8 8 0 102-8.5L4 10" /></svg>;
    case "maxstep":
      return <svg {...s}><path d="M5 5l6 7-6 7M12 5l6 7-6 7" /></svg>;
    case "collect":
      return <svg {...s}><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M8 12h8M12 8v8" /></svg>;
    case "dice":
      return <svg {...s}><rect x="4" y="4" width="16" height="16" rx="3" /><circle cx="9" cy="9" r="1" fill="currentColor" /><circle cx="15" cy="15" r="1" fill="currentColor" /><circle cx="15" cy="9" r="1" fill="currentColor" /><circle cx="9" cy="15" r="1" fill="currentColor" /></svg>;
    case "stop":
      return <svg {...s}><rect x="6" y="6" width="12" height="12" rx="1" /></svg>;
    case "sun":
      return <svg {...s}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" /></svg>;
    case "moon":
      return <svg {...s}><path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z" /></svg>;
    case "grid":
      return <svg {...s}><path d="M4 4h16v16H4zM4 12h16M12 4v16" /></svg>;
    case "chevron":
      return <svg {...s} width={14} height={14}><path d="M6 9l6 6 6-6" /></svg>;
    case "copy":
      return <svg {...s}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" /></svg>;
    case "trash":
      return <svg {...s}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>;
    case "search":
      return <svg {...s}><circle cx="11" cy="11" r="7" /><path d="M21 21l-5-5" /></svg>;
    case "help":
      return <svg {...s}><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 015 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01" /></svg>;
    case "layout":
      return <svg {...s}><rect x="3" y="4" width="6" height="5" rx="1" /><rect x="15" y="4" width="6" height="5" rx="1" /><rect x="9" y="15" width="6" height="5" rx="1" /><path d="M6 9v3h12V9M12 12v3" /></svg>;
    case "map":
      return <svg {...s}><rect x="3" y="5" width="18" height="14" rx="2" /><rect x="12" y="11" width="6" height="5" rx="1" /></svg>;
    case "chart":
      return <svg {...s}><path d="M4 20V4M4 20h16" /><path d="M7 15l4-5 3 3 5-7" /></svg>;
    case "tree":
      return <svg {...s}><rect x="8" y="3" width="8" height="5" rx="1" /><path d="M12 8v4M6 12h12M6 12v3M18 12v3" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="18" r="3" /></svg>;
    case "music":
      return <svg {...s}><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>;
    case "subnet":
      return <svg {...s}><rect x="4" y="4" width="12" height="12" rx="1" /><rect x="8" y="8" width="12" height="12" rx="1" /></svg>;
    case "alignLeft":
      return <svg {...s}><path d="M4 3v18" /><rect x="7" y="6" width="10" height="4" rx="1" /><rect x="7" y="14" width="6" height="4" rx="1" /></svg>;
    case "alignRight":
      return <svg {...s}><path d="M20 3v18" /><rect x="7" y="6" width="10" height="4" rx="1" /><rect x="11" y="14" width="6" height="4" rx="1" /></svg>;
    case "alignCenterX":
      return <svg {...s}><path d="M12 3v18" /><rect x="6" y="6" width="12" height="4" rx="1" /><rect x="8" y="14" width="8" height="4" rx="1" /></svg>;
    case "alignTop":
      return <svg {...s}><path d="M3 4h18" /><rect x="6" y="7" width="4" height="10" rx="1" /><rect x="14" y="7" width="4" height="6" rx="1" /></svg>;
    case "alignBottom":
      return <svg {...s}><path d="M3 20h18" /><rect x="6" y="7" width="4" height="10" rx="1" /><rect x="14" y="11" width="4" height="6" rx="1" /></svg>;
    case "alignCenterY":
      return <svg {...s}><path d="M3 12h18" /><rect x="6" y="6" width="4" height="12" rx="1" /><rect x="14" y="8" width="4" height="8" rx="1" /></svg>;
    case "distributeX":
      return <svg {...s}><path d="M3 4v16M21 4v16" /><rect x="9" y="8" width="6" height="8" rx="1" /></svg>;
    case "distributeY":
      return <svg {...s}><path d="M4 3h16M4 21h16" /><rect x="8" y="9" width="8" height="6" rx="1" /></svg>;
    case "edit":
      return <svg {...s}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13 7l4 4" /></svg>;
    case "menu":
      return <svg {...s}><path d="M4 6h16M4 12h16M4 18h16" /></svg>;
    case "panel":
      return <svg {...s}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16M17.5 8h1M17.5 11h1" /></svg>;
    case "close":
      return <svg {...s}><path d="M6 6l12 12M18 6L6 18" /></svg>;
    case "logo":
      // The Donwinne mark: a "D" drawn as a transition, two arcs and a place.
      return (
        <svg width={size} height={size} viewBox="64 64 384 384" fill="currentColor">
          <rect x="86" y="100" width="76" height="312" rx="16" />
          <g fill="none" stroke="currentColor" strokeWidth={40} strokeLinecap="round">
            <path d="M162 136C199.6 136 231.7 141.1 258.3 149.8" />
            <path d="M303.1 341.2C279.9 356.4 248.8 367.8 210 373" />
          </g>
          <path d="M303.1 170.8L235.9 164L269.8 112.1Z" />
          <path d="M166 376L226 345L226 407Z" />
          <circle cx="355.5" cy="256" r="74" fill="none" stroke="currentColor" strokeWidth={40} />
        </svg>
      );
  }
  return null;
}

/** Small drawing of a fault tree node, for the palette. */
export function FTIcon({ type, size = 22 }: { type: FTNodeType; size?: number }) {
  const s = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinejoin: "round" as const };
  switch (type) {
    case "top":
      return <svg {...s}><rect x="2" y="7" width="20" height="10" rx="2" strokeWidth={2.2} /></svg>;
    case "intermediate":
      return <svg {...s}><rect x="2" y="7" width="20" height="10" rx="1" /></svg>;
    case "basic":
      return <svg {...s}><circle cx="12" cy="12" r="8" /></svg>;
    case "undeveloped":
      return <svg {...s}><path d="M12 3l9 9-9 9-9-9z" /></svg>;
    case "and":
    case "pand":
      return <svg {...s}><path d="M5 21V12a7 7 0 0114 0v9z" />{type === "pand" && <path d="M5 17h14" />}</svg>;
    case "or":
    case "xor":
    case "kofn":
      return (
        <svg {...s}>
          <path d="M5 21q7-3 14 0Q19 10 12 3 5 10 5 21z" />
          {type === "xor" && <path d="M5 23.5q7-3 14 0" />}
          {type === "kofn" && <text x="12" y="18" fontSize="7" textAnchor="middle" fill="currentColor" stroke="none">k/n</text>}
        </svg>
      );
    case "not":
      return <svg {...s}><path d="M4 20L12 5l8 15z" /></svg>;
    case "inhibit":
      return <svg {...s}><path d="M12 2l8 5v10l-8 5-8-5V7z" /></svg>;
    default:
      return (
        <svg {...s}>
          <rect x="4" y="4" width="16" height="16" rx="1" />
          <text x="12" y="15" fontSize="7" textAnchor="middle" fill="currentColor" stroke="none">{type === "spare" ? "SP" : type === "fdep" ? "FD" : "C"}</text>
        </svg>
      );
  }
}

export function ArcHeadIcon({ kind }: { kind: ArcKind }) {
  const stroke = "currentColor";
  return (
    <svg width={30} height={14} viewBox="0 0 30 14">
      <line x1={2} y1={7} x2={kind === "reset" ? 14 : kind === "equal" ? 17 : kind === "modifier" ? 28 : 20} y2={7} stroke={stroke} strokeWidth={1.6} strokeDasharray={kind === "modifier" ? "4 3" : undefined} />
      {kind === "normal" && <polygon points="28,7 19,3 19,11" fill={stroke} />}
      {kind === "reset" && (
        <>
          <polygon points="28,7 20,3 20,11" fill={stroke} />
          <polygon points="21,7 13,3 13,11" fill={stroke} />
        </>
      )}
      {kind === "read" && <circle cx={24} cy={7} r={4} fill={stroke} />}
      {kind === "inhibitor" && <circle cx={24} cy={7} r={4} fill="none" stroke={stroke} strokeWidth={1.6} />}
      {kind === "equal" && <polygon points="28,7 23,3 18,7 23,11" fill="none" stroke={stroke} strokeWidth={1.6} />}
    </svg>
  );
}

export function Menu({ label, children, title, wide }: { label: React.ReactNode; title?: string; wide?: boolean; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", h);
    window.addEventListener("keydown", k);
    return () => {
      window.removeEventListener("pointerdown", h);
      window.removeEventListener("keydown", k);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className={open ? "active" : ""} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} title={title}>
        {label} <Icon name="chevron" />
      </button>
      {open && (
        <div className={`menu-list ${wide ? "wide" : ""}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function Item({ onClick, close, children, kbd, disabled, title }: { onClick: () => void; close: () => void; children: React.ReactNode; kbd?: string; disabled?: boolean; title?: string }) {
  return (
    <button
      role="menuitem"
      title={title}
      disabled={disabled}
      onClick={() => {
        close();
        onClick();
      }}
    >
      <span>{children}</span>
      {kbd && <kbd>{kbd}</kbd>}
    </button>
  );
}

/** Menus open as drop-downs with fly-out submenus, or (in the small-screen drawer) as one list with expandable submenus. */
const MenuStyle = React.createContext<"flyout" | "inline">("flyout");

function SubMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const style = React.useContext(MenuStyle);
  return style === "inline" ? <InlineSubMenu label={label}>{children}</InlineSubMenu> : <FlyoutSubMenu label={label}>{children}</FlyoutSubMenu>;
}

function InlineSubMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="submenu inline">
      <button role="menuitem" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{label}</span>
        <span className={`sub-arrow ${open ? "open" : ""}`}>›</span>
      </button>
      {open && (
        <div className="sub-inline" role="menu" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}

function FlyoutSubMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  // Keep the submenu on screen: shift it up when it would run off the bottom, or open it to the left near the right edge.
  React.useLayoutEffect(() => {
    const el = listRef.current;
    if (!open || !el) return;
    el.style.top = "";
    el.style.left = "";
    el.style.right = "";
    const r = el.getBoundingClientRect();
    const over = r.bottom - (window.innerHeight - 8);
    if (over > 0) el.style.top = `${-6 - Math.min(over, r.top - 8)}px`;
    if (r.right > window.innerWidth - 8) {
      el.style.left = "auto";
      el.style.right = "100%";
    }
  }, [open]);
  return (
    <div className="submenu" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button role="menuitem" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{label}</span>
        <span className="sub-arrow">›</span>
      </button>
      {open && (
        <div className="menu-list sub" role="menu" ref={listRef}>
          {children}
        </div>
      )}
    </div>
  );
}

export const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

/** Net classes that can be switched between without losing the model's kind. */
const SWITCHABLE: [string, NetClass[]][] = [
  ["Petri nets", ["pt", "xpt", "coloured"]],
  ["Time and rates", ["timed", "stochastic", "continuous", "hybrid"]],
  ["Coloured with rates", ["colouredStochastic", "colouredContinuous", "colouredHybrid"]],
  ["Fuzzy", ["fuzzyStochastic", "fuzzyContinuous", "fuzzyHybrid", "colouredFuzzyStochastic", "colouredFuzzyContinuous", "colouredFuzzyHybrid"]],
  ["Ambient (Konios)", ["apn", "tapn"]],
  ["Other", ["modulo", "music", "freestyle"]],
];

function NetName() {
  const name = useStore((s) => s.net.name);
  const fileName = useStore((s) => s.fileName);
  const dirty = useStore((s) => s.dirty);
  const mode = useStore((s) => s.mode);
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(name);
  if (editing)
    return (
      <input
        className="doc-title-input"
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          if (v.trim() && v !== name) updateNet({ name: v.trim() });
          setEditing(false);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  return (
    <button
      className="doc-title"
      title={fileName ? `${fileName} · click to rename the net` : "Click to rename the net"}
      onClick={() => {
        if (mode !== "edit") return;
        setV(name);
        setEditing(true);
      }}
    >
      <span className="doc-title-text">{name || fileName || "Untitled"}</span>
      {dirty && <span className="dirty" title="Unsaved changes">●</span>}
    </button>
  );
}

function NetClassItems({ close }: { close: () => void }) {
  const netClass = useStore((s) => s.net.netClass);
  const mode = useStore((s) => s.mode);
  return (
    <>
      {SWITCHABLE.map(([heading, group]) => (
        <div key={heading} className="menu-group">
          <div className="menu-heading">{heading}</div>
          {group.map((c) => (
            <Item key={c} close={close} disabled={mode !== "edit"} onClick={() => setNetClass(c)}>
              <span className={c === netClass ? "current" : ""}>
                {c === netClass ? "✓ " : ""}
                {NET_CLASS_LABELS[c]}
              </span>
            </Item>
          ))}
        </div>
      ))}
    </>
  );
}

function ClassBadge() {
  const netClass = useStore((s) => s.net.netClass);
  if (isFaultTree(netClass))
    return (
      <span className="class-badge" title="Fault trees can't be switched to a Petri net class">
        {NET_CLASS_LABELS[netClass]}
      </span>
    );
  return (
    <Menu wide label={<span className="class-badge-label">{NET_CLASS_LABELS[netClass]}</span>} title="Net class: what the model can contain and how it runs">
      {(close) => <NetClassItems close={close} />}
    </Menu>
  );
}

function FileItems({ close }: { close: () => void }) {
  const netClass = useStore((s) => s.net.netClass);
  return (
    <>
      <Item close={close} onClick={() => useStore.setState({ dialog: "new" })} kbd={`${MOD}N`}>New…</Item>
      <Item close={close} onClick={() => openAmbientDialog("blocks")}>New APN from building blocks…</Item>
      <Item close={close} onClick={cmdOpen} kbd={`${MOD}O`}>Open…</Item>
      <Item close={close} onClick={() => cmdSave()} kbd={`${MOD}S`}>Save</Item>
      <Item close={close} onClick={() => cmdSave(true)} kbd={`${MOD}⇧S`}>Save as…</Item>
      <hr />
      <Item close={close} onClick={cmdImport}>Import (Snoopy, PNML, ANDL)…</Item>
      <SubMenu label="Export as">
        {EXPORT_FORMATS.filter((f) => f.applies(netClass)).map((f) => {
          const problem = exportProblem(f.id, useStore.getState().net);
          return (
            <Item key={f.id} close={close} disabled={!!problem} onClick={() => cmdExport(f.id)} title={problem ?? undefined}>
              <span className="item-with-note">
                {f.label}
                {problem && <span className="item-note">{problem.length > 90 ? `${problem.slice(0, 88)}…` : problem}</span>}
              </span>
            </Item>
          );
        })}
      </SubMenu>
      <Item close={close} onClick={cmdPrint} kbd={`${MOD}P`}>Print…</Item>
      <hr />
      <SubMenu label="Examples">
        {EXAMPLES.map((ex) => (
          <Item key={ex.title} close={close} onClick={() => cmdOpenExample(ex.net)}>
            {ex.title}
          </Item>
        ))}
      </SubMenu>
    </>
  );
}

function EditItems({ close }: { close: () => void }) {
  const mode = useStore((s) => s.mode);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const selection = useStore((s) => s.selection);
  const ft = useStore((s) => isFaultTree(s.net.netClass));
  const editing = mode === "edit";
  return (
    <>
      <Item close={close} onClick={undo} disabled={!canUndo || !editing} kbd={`${MOD}Z`}>Undo</Item>
      <Item close={close} onClick={redo} disabled={!canRedo || !editing} kbd={`${MOD}⇧Z`}>Redo</Item>
      <hr />
      <Item close={close} onClick={cutSelection} disabled={!selection.length || !editing} kbd={`${MOD}X`}>Cut</Item>
      <Item close={close} onClick={() => void copySelection()} disabled={!selection.length} kbd={`${MOD}C`}>Copy</Item>
      <Item close={close} onClick={() => paste()} disabled={!editing} kbd={`${MOD}V`}>Paste</Item>
      <Item close={close} onClick={duplicateSelection} disabled={!selection.length || !editing} kbd={`${MOD}D`}>Duplicate</Item>
      <Item close={close} onClick={deleteSelection} disabled={!selection.length || !editing} kbd="Del">Delete</Item>
      <hr />
      <Item close={close} onClick={selectAll} kbd={`${MOD}A`}>Select all</Item>
      {!ft && (
        <SubMenu label="Select only">
          <Item close={close} onClick={() => selectKind("places")}>All places on this page</Item>
          <Item close={close} onClick={() => selectKind("transitions")}>All transitions on this page</Item>
          <Item close={close} onClick={() => selectKind("arcs")}>All arcs on this page</Item>
        </SubMenu>
      )}
      <Item close={close} onClick={() => useStore.setState({ dialog: "search" })} kbd={`${MOD}F`}>Find…</Item>
      {!ft && (
        <Item close={close} onClick={() => groupIntoSubnet("transition")} disabled={selection.length < 1 || !editing} kbd={`${MOD}G`}>
          Group into subnet
        </Item>
      )}
      <hr />
      <Item close={close} onClick={() => void autoLayout("layered")} disabled={!editing} kbd={`${MOD}L`}>Auto layout (flow)</Item>
      <Item close={close} onClick={() => void autoLayout("layeredDown")} disabled={!editing}>Auto layout (top to bottom)</Item>
      <Item close={close} onClick={() => void autoLayout("force")} disabled={!editing}>Auto layout (organic)</Item>
      <Item close={close} onClick={() => void autoLayout("layered", true)} disabled={selection.length < 2 || !editing}>Lay out selection only</Item>
    </>
  );
}

function ViewItems({ close }: { close: () => void }) {
  const theme = useStore((s) => s.theme);
  const showMinimap = useStore((s) => s.showMinimap);
  const snapToGrid = useStore((s) => s.snapToGrid);
  const ft = useStore((s) => isFaultTree(s.net.netClass));
  return (
    <>
      <Item close={close} onClick={() => zoomBy(1.25)} kbd={`${MOD}+`}>Zoom in</Item>
      <Item close={close} onClick={() => zoomBy(1 / 1.25)} kbd={`${MOD}−`}>Zoom out</Item>
      <Item close={close} onClick={requestFit} kbd="F">Zoom to fit</Item>
      <hr />
      <Item close={close} onClick={() => useStore.setState({ showMinimap: !showMinimap })} kbd="M">{showMinimap ? "✓ " : ""}Overview map</Item>
      <Item close={close} onClick={() => useStore.setState({ snapToGrid: !snapToGrid })} kbd="G">{snapToGrid ? "✓ " : ""}Snap to grid</Item>
      <Item close={close} onClick={() => useStore.setState({ bottomOpen: !useStore.getState().bottomOpen })} kbd="B">Bottom panel</Item>
      {!ft && <Item close={close} onClick={() => useStore.setState({ panel: "elements", bottomOpen: true })}>Element table and hierarchy</Item>}
      <hr />
      <Item close={close} onClick={() => useStore.setState({ theme: "light" })}>{theme === "light" ? "✓ " : ""}Light theme</Item>
      <Item close={close} onClick={() => useStore.setState({ theme: "dark" })}>{theme === "dark" ? "✓ " : ""}Dark theme</Item>
      <Item close={close} onClick={() => useStore.setState({ theme: "system" })}>{theme === "system" ? "✓ " : ""}Match system</Item>
    </>
  );
}

function AnalyseItems({ close }: { close: () => void }) {
  const mode = useStore((s) => s.mode);
  const netClass = useStore((s) => s.net.netClass);
  const ft = isFaultTree(netClass);
  const quantitative = !!timeBase(netClass);
  const editing = mode === "edit";
  const ambient = isAmbient(netClass);
  const hasSource = useAmbient((s) => !!s.construction);
  return (
    <>
      {ambient && (
        <div className="menu-group" data-testid="ambient-menu">
          <div className="menu-heading">Ambient (Konios)</div>
          <Item close={close} onClick={() => (editing ? startSimulation() : stopSimulation())} kbd="S">{editing ? "Play the step token game" : "Stop the step token game"}</Item>
          <Item close={close} onClick={() => openAmbientDialog("crg")}>Concurrent reachability graph…</Item>
          <Item close={close} onClick={() => openAmbientDialog("apnProps")}>APN properties…</Item>
          <Item close={close} onClick={() => useStore.setState({ dialog: "ctl" })}>Model checking (CTL)…</Item>
          {netClass === "apn" && <Item close={close} onClick={cmdConstructTapn}>Construct T-APN</Item>}
          <Item close={close} onClick={() => openAmbientDialog("equivalence")} disabled={netClass === "tapn" && !hasSource} title={netClass === "tapn" && !hasSource ? "Open the APN and check equivalence there" : undefined}>
            Check equivalence…
          </Item>
          <Item close={close} onClick={() => openAmbientDialog("blocks")}>Building blocks…</Item>
          {netClass === "apn" && <Item close={close} onClick={() => openAmbientDialog("compose")} disabled={!editing}>Compose steps…</Item>}
          <hr />
        </div>
      )}
      {!ft && netClass !== "freestyle" && (
        <>
          {!ambient && <Item close={close} onClick={() => (editing ? startSimulation() : stopSimulation())} kbd="S">{editing ? "Play the token game" : "Stop the token game"}</Item>}
          {quantitative && (
            <Item close={close} onClick={() => useStore.setState({ panel: "plot", bottomOpen: true })}>
              Simulate over time and plot…
            </Item>
          )}
          <Item close={close} onClick={() => useStore.setState({ dialog: "analysis" })}>Net properties and invariants…</Item>
          <Item close={close} onClick={() => useStore.setState({ dialog: "rg" })}>Reachability graph…</Item>
          {!ambient && <Item close={close} onClick={() => useStore.setState({ dialog: "ctl" })}>Model checking (CTL)…</Item>}
          {isColoured(netClass) && <Item close={close} onClick={() => void cmdUnfold()}>Unfold to an uncoloured net</Item>}
          {netClass === "coloured" && (
            <Item close={close} onClick={() => setNetClass("apn")} disabled={!editing} title="Read this coloured net as Konios's Ambient Petri net, with step semantics">
              Treat as an APN (ambient net)
            </Item>
          )}
        </>
      )}
      {ft && <Item close={close} onClick={() => useStore.setState({ panel: "faultTree", bottomOpen: true })}>Fault tree analysis…</Item>}
      <Item close={close} onClick={() => useStore.setState({ panel: "problems", bottomOpen: true })}>Check the model</Item>
    </>
  );
}

function HelpItems({ close }: { close: () => void }) {
  return (
    <>
      <Item close={close} onClick={() => useStore.setState({ dialog: "help" })} kbd="?">Quick guide and shortcuts</Item>
      <Item close={close} onClick={() => useStore.setState({ dialog: "about" })}>About</Item>
    </>
  );
}

const MENUS: { label: string; Items: React.ComponentType<{ close: () => void }> }[] = [
  { label: "File", Items: FileItems },
  { label: "Edit", Items: EditItems },
  { label: "View", Items: ViewItems },
  { label: "Analyse", Items: AnalyseItems },
  { label: "Help", Items: HelpItems },
];

/** All the menus in one panel that slides in from the left, for screens too narrow for a menu bar. */
function MenuDrawer({ onClose }: { onClose: () => void }) {
  const netClass = useStore((s) => s.net.netClass);
  const [section, setSection] = useState<string | null>("File");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(".drawer-section > button")?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", k, true);
    return () => {
      window.removeEventListener("keydown", k, true);
      prev?.focus?.();
    };
  }, [onClose]);
  const sections = [...MENUS, ...(isFaultTree(netClass) ? [] : [{ label: "Net class", Items: NetClassItems }])];
  return (
    <div className="drawer-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <nav className="drawer menu-drawer" aria-label="Menu" ref={ref}>
        <header className="drawer-head">
          <span className="brand">
            <Icon name="logo" size={20} />
            <span className="brand-name">Donwinne</span>
          </span>
          <span className="class-badge-label">{NET_CLASS_LABELS[netClass]}</span>
          <button className="icon" aria-label="Close menu" title="Close (Esc)" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="drawer-body">
          <MenuStyle.Provider value="inline">
            {sections.map(({ label, Items }) => (
              <div key={label} className={`drawer-section ${section === label ? "open" : ""}`}>
                <button aria-expanded={section === label} onClick={() => setSection(section === label ? null : label)}>
                  <span>{label}</span>
                  <Icon name="chevron" />
                </button>
                {section === label && (
                  <div className="menu-list inline" role="menu" aria-label={label}>
                    <Items close={onClose} />
                  </div>
                )}
              </div>
            ))}
          </MenuStyle.Provider>
        </div>
      </nav>
    </div>
  );
}

export function TopBar() {
  const mode = useStore((s) => s.mode);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const theme = useStore((s) => s.theme);
  const netClass = useStore((s) => s.net.netClass);
  const propsOpen = useStore((s) => s.propsOpen);
  const screen = useScreenClass();
  const [drawer, setDrawer] = useState(false);
  const closeDrawer = React.useCallback(() => setDrawer(false), []);
  const darkNow = theme === "dark" || (theme === "system" && typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches);
  const ft = isFaultTree(netClass);
  const editing = mode === "edit";
  const compact = screen !== "desktop";
  const roomy = screen === "tablet";

  return (
    <header className="topbar">
      <div className="brand">
        <Icon name="logo" size={22} />
        <span className="brand-name">Donwinne</span>
      </div>
      {compact ? (
        <button className="icon menu-btn" aria-label="Menu" title="Menu" aria-haspopup="menu" aria-expanded={drawer} onClick={() => setDrawer(true)} data-testid="menu-button">
          <Icon name="menu" />
        </button>
      ) : (
        <nav className="tb-group menus">
          {MENUS.map(({ label, Items }) => (
            <Menu key={label} label={label}>
              {(close) => <Items close={close} />}
            </Menu>
          ))}
        </nav>
      )}
      <NetName />
      {(!compact || roomy) && <ClassBadge />}
      <div className="tb-group">
        <button className="icon" title={`Undo (${MOD}Z)`} aria-label="Undo" disabled={!canUndo || !editing} onClick={undo}>
          <Icon name="undo" />
        </button>
        <button className="icon" title={`Redo (${MOD}⇧Z)`} aria-label="Redo" disabled={!canRedo || !editing} onClick={redo}>
          <Icon name="redo" />
        </button>
      </div>
      {!compact && (
        <div className="tb-group tb-view">
          <button className="icon" title="Zoom out" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
            <Icon name="zoom-out" />
          </button>
          <button className="icon" title="Zoom in" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
            <Icon name="zoom-in" />
          </button>
          <button className="icon" title="Zoom to fit (F)" aria-label="Zoom to fit" onClick={requestFit}>
            <Icon name="fit" />
          </button>
          <button className="icon" title={`Auto layout (${MOD}L)`} aria-label="Auto layout" disabled={!editing} onClick={() => void autoLayout()}>
            <Icon name="layout" />
          </button>
          <button className="icon" title={`Find (${MOD}F)`} aria-label="Find" onClick={() => useStore.setState({ dialog: "search" })}>
            <Icon name="search" />
          </button>
        </div>
      )}
      {compact && (
        <button className="icon tb-fit" title="Zoom to fit (F)" aria-label="Zoom to fit" onClick={requestFit}>
          <Icon name="fit" />
        </button>
      )}
      <span className="spacer" />
      {!ft && netClass !== "freestyle" && (
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={editing} aria-label="Edit" title="Edit the net" className={editing ? "on" : ""} onClick={stopSimulation}>
            <span className="seg-icon"><Icon name="edit" size={16} /></span>
            <span className="seg-label">Edit</span>
          </button>
          <button role="tab" aria-selected={!editing} aria-label="Simulate" title="Play the token game (S)" className={!editing ? "on" : ""} onClick={() => editing && startSimulation()} data-testid="simulate">
            <span className="seg-icon"><Icon name="play" size={16} /></span>
            <span className="seg-label">Simulate</span>
          </button>
        </div>
      )}
      {ft && (
        <button className="primary small" onClick={() => useStore.setState((s) => ({ panel: "faultTree", bottomOpen: true, ftRunRequest: s.ftRunRequest + 1 }))}>
          Analyse <span className="seg-label">tree</span>
        </button>
      )}
      <button className="icon tb-help" title="Quick guide (?)" aria-label="Help" onClick={() => useStore.setState({ dialog: "help" })}>
        <Icon name="help" />
      </button>
      {!propsDocked(screen) && (
        <button
          className={`icon ${propsOpen ? "active" : ""}`}
          title="Properties"
          aria-label="Properties"
          aria-pressed={propsOpen}
          onClick={() => useStore.setState({ propsOpen: !propsOpen })}
          data-testid="props-toggle"
        >
          <Icon name="panel" />
        </button>
      )}
      <button
        className="icon tb-theme"
        title={`Switch to the ${darkNow ? "light" : "dark"} theme (View menu: Match system follows your computer)`}
        aria-label="Switch theme"
        onClick={() => useStore.setState({ theme: theme === "system" ? (darkNow ? "light" : "dark") : theme === "dark" ? "light" : "dark" })}
      >
        <Icon name={darkNow ? "sun" : "moon"} />
      </button>
      {drawer && <MenuDrawer onClose={closeDrawer} />}
    </header>
  );
}

export function SimControls() {
  const sim = useStore((s) => s.sim);
  const simIndex = useStore((s) => s.simIndex);
  const running = useStore((s) => s.running);
  const speed = useStore((s) => s.speed);
  const sound = useStore((s) => s.sound);
  const music = useStore((s) => s.net.netClass === "music");
  const ambient = useStore((s) => isAmbient(s.net.netClass));
  const collecting = useAmbient((s) => s.collecting);
  return (
    <div className="sim-bar" role="toolbar" aria-label="Token game">
      <button className="icon" title="Back to the initial marking" aria-label="Restart" onClick={() => simGoto(0)} disabled={simIndex === 0}>
        <Icon name="reset" />
      </button>
      <button className="icon" title="Step back (←)" aria-label="Step back" onClick={() => simGoto(simIndex - 1)} disabled={simIndex === 0}>
        <Icon name="back" />
      </button>
      <button className="icon" title="Step forward (→)" aria-label="Step forward" onClick={() => simGoto(simIndex + 1)} disabled={simIndex >= sim.length - 1}>
        <Icon name="forward" />
      </button>
      <button className="icon" title={ambient ? "Fire a random enabled step (R)" : "Fire a random enabled transition (R)"} aria-label="Fire random" onClick={() => stepRandom()}>
        <Icon name="dice" />
      </button>
      {ambient && (
        <>
          <button className="icon" title="Fire a maximal step (X)" aria-label="Fire a maximal step" onClick={() => fireMaximalStep()} data-testid="sim-maximal">
            <Icon name="maxstep" />
          </button>
          <button
            className={`icon ${collecting ? "active" : ""}`}
            title={collecting ? "Stop collecting: taps fire transitions again" : "Collect a step: taps add transitions to one step"}
            aria-label="Collect a step"
            aria-pressed={collecting}
            onClick={() => useAmbient.setState({ collecting: !collecting, pending: collecting ? [] : useAmbient.getState().pending })}
            data-testid="sim-collect"
          >
            <Icon name="collect" />
          </button>
        </>
      )}
      <button className={`icon ${running ? "active" : ""}`} title={running ? "Pause (Space)" : "Run random firings (Space)"} aria-label={running ? "Pause" : "Run"} onClick={() => useStore.setState({ running: !running })} data-testid="run">
        <Icon name={running ? "pause" : "play"} />
      </button>
      <input type="range" min={1} max={30} value={speed} title={`${speed} firings per second`} aria-label="Speed" onChange={(e) => useStore.setState({ speed: Number(e.target.value) })} onPointerUp={(e) => e.currentTarget.blur()} />
      {music && (
        <button className={`icon ${sound ? "active" : ""}`} title={sound ? "Sound on" : "Sound off"} aria-label="Sound" onClick={() => useStore.setState({ sound: !sound })}>
          <Icon name="music" />
        </button>
      )}
      <button className="small" onClick={adoptMarking} title="Make the current marking the net's initial marking">
        Keep this marking
      </button>
    </div>
  );
}

interface PaletteItem {
  tool: Tool;
  label: string;
  icon: React.ReactNode;
  key?: string;
  help: string;
}

const FT_STATIC: [FTNodeType, string, string][] = [
  ["top", "Top event", "The failure being analysed. One per tree."],
  ["intermediate", "Event", "An intermediate event, caused by the gate below it."],
  ["basic", "Basic event", "A component failure with a rate or probability."],
  ["undeveloped", "Unde\u00ADveloped", "An event not analysed further."],
  ["and", "AND", "Fails when all inputs fail."],
  ["or", "OR", "Fails when any input fails."],
  ["xor", "XOR", "Fails when exactly one input fails."],
  ["kofn", "k-of-n", "Fails when at least k inputs fail (voting gate)."],
  ["not", "NOT", "Fails when its input works."],
  ["inhibit", "Inhibit", "Fails when the input fails and the condition holds."],
];
const FT_DYNAMIC: [FTNodeType, string, string][] = [
  ["pand", "Priority AND", "Fails when the inputs fail from left to right."],
  ["spare", "Spare", "The primary input is replaced by spares when it fails."],
  ["fdep", "Func. dep.", "The trigger failure forces its dependent events to fail."],
  ["cond", "Condition", "A condition for an inhibit gate."],
];

function paletteItems(netClass: NetClass): PaletteItem[] {
  if (isFaultTree(netClass)) {
    const list = netClass === "extendedFaultTree" ? [...FT_STATIC, ...FT_DYNAMIC] : FT_STATIC;
    return list.map(([type, label, help]) => ({ tool: `ft:${type}` as Tool, label, icon: <FTIcon type={type} />, help }));
  }
  const tb = timeBase(netClass);
  const items: PaletteItem[] = [
    {
      tool: "place",
      label: tb === "continuous" ? "Continuous place" : "Place",
      icon: <Icon name="place" size={20} />,
      key: "P",
      help: tb === "continuous" ? "Holds a real amount" : "Holds tokens",
    },
    {
      tool: "transition",
      label: tb === "continuous" ? "Continuous transition" : tb ? "Stochastic transition" : "Transition",
      icon: <Icon name="transition" size={20} />,
      key: "T",
      help: tb ? "Fires at a rate given by its rate function" : "Moves tokens when it fires",
    },
  ];
  return items;
}

/**
 * Drag a tool from the palette with a finger. Native drag and drop does not start from touch in most
 * mobile browsers, so touch drags are tracked with pointer events and dropped onto the canvas by hand.
 */
function usePaletteTouchDrag(disabled: boolean) {
  const [ghost, setGhost] = useState<{ x: number; y: number; icon: React.ReactNode } | null>(null);
  const st = useRef<{ id: number; tool: Tool; icon: React.ReactNode; x0: number; y0: number; dragging: boolean } | null>(null);
  const suppressClick = useRef(false);
  /** The ghost (and the drop point) sits above the finger so the finger doesn't hide it. */
  const LIFT = 36;
  const bind = (tool: Tool, icon: React.ReactNode) => ({
    onPointerDown: (e: React.PointerEvent) => {
      suppressClick.current = false;
      if (e.pointerType === "mouse" || disabled) return;
      st.current = { id: e.pointerId, tool, icon, x0: e.clientX, y0: e.clientY, dragging: false };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = st.current;
      if (!s || s.id !== e.pointerId) return;
      if (!s.dragging) {
        if (Math.hypot(e.clientX - s.x0, e.clientY - s.y0) < 10) return;
        s.dragging = true;
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* the pointer may already be gone */
        }
      }
      setGhost({ x: e.clientX, y: e.clientY - LIFT, icon: s.icon });
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = st.current;
      st.current = null;
      setGhost(null);
      if (!s?.dragging || s.id !== e.pointerId) return;
      suppressClick.current = true;
      const x = e.clientX;
      const y = e.clientY - LIFT;
      const svg = document.elementFromPoint(x, y)?.closest("svg.canvas");
      if (!svg || useStore.getState().mode !== "edit") return;
      const r = svg.getBoundingClientRect();
      const v = useStore.getState().view;
      placeTool(s.tool, { x: (x - r.left - v.x) / v.zoom, y: (y - r.top - v.y) / v.zoom });
    },
    onPointerCancel: () => {
      st.current = null;
      setGhost(null);
    },
  });
  /** True (once) when the click that follows a touch drag should be ignored. */
  const swallowClick = () => {
    const s = suppressClick.current;
    suppressClick.current = false;
    return s;
  };
  const ghostEl = ghost && (
    <div className="palette-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden>
      {ghost.icon}
    </div>
  );
  return { bind, swallowClick, ghostEl };
}

/**
 * The Arc tool with its type chooser: one button that shows the current arc type, and a pop-out
 * list of the types the net class allows (the ▾ part, a second click on the active tool, a
 * right-click or a long press opens it). Keys 1–6 still pick a type directly.
 */
function ArcToolButton({ kinds, disabled }: { kinds: ArcKind[]; disabled: boolean }) {
  const tool = useStore((s) => s.tool);
  const arcKind = useStore((s) => s.arcKind);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const anchor = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const press = useRef<number | null>(null);
  const choosable = kinds.length > 1;
  const current = kinds.includes(arcKind) ? arcKind : "normal";
  const active = tool === "arc" && !disabled;

  const place = () => {
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Beside the palette when it is a column; above it when it is a bottom bar.
    if (r.left + r.width + 280 <= vw && r.width < vw / 3 && r.top < vh - 120) {
      setPos({ left: r.right + 8, top: Math.max(8, Math.min(r.top, vh - 380)) });
    } else {
      setPos({ left: Math.max(8, Math.min(r.left, vw - 288)), bottom: vh - r.top + 8 });
    }
  };
  const show = () => {
    if (!choosable || disabled) return;
    place();
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const reflow = () => place();
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", reflow);
    requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>(".arc-choice.on")?.focus());
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", reflow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const choose = (k: ArcKind) => {
    useStore.setState({ arcKind: k, tool: "arc" });
    setOpen(false);
  };
  const info = ARC_KIND_INFO[current];

  return (
    <div className={`arc-tool ${choosable ? "choosable" : ""}`} ref={anchor}>
      <button
        className={`tool ${active ? "on" : ""}`}
        disabled={disabled}
        aria-haspopup={choosable ? "menu" : undefined}
        aria-expanded={choosable ? open : undefined}
        title={choosable ? `Arc (A), type ${info.label}: drag from one node to another. Click again or use ▾ to change the type.` : "Arc (A): drag from one node to another"}
        onClick={() => {
          if (active && choosable) open ? setOpen(false) : show();
          else setTool("arc");
        }}
        onContextMenu={(e) => {
          if (!choosable) return;
          e.preventDefault();
          show();
        }}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" || !choosable) return;
          press.current = window.setTimeout(() => {
            press.current = null;
            setTool("arc");
            show();
          }, 450);
        }}
        onPointerUp={() => press.current !== null && (clearTimeout(press.current), (press.current = null))}
        onPointerLeave={() => press.current !== null && (clearTimeout(press.current), (press.current = null))}
        data-testid="tool-arc"
      >
        {choosable && current !== "normal" ? <ArcHeadIcon kind={current} /> : <Icon name="arc" size={20} />}
        <span>{choosable ? (current === "normal" ? "Arc" : info.label) : "Arc"}</span>
      </button>
      {choosable && (
        <button
          className={`arc-type-toggle ${open ? "on" : ""}`}
          disabled={disabled}
          aria-label={`Arc type: ${info.label}. Choose another type`}
          title="Choose the arc type"
          onClick={() => (open ? setOpen(false) : show())}
          data-testid="arc-type-menu"
        >
          ▾
        </button>
      )}
      {open &&
        createPortal(
          <div className="arc-menu" role="menu" aria-label="Arc type" ref={menu} style={pos} data-testid="arc-menu">
            <div className="arc-menu-title">Arc type</div>
            {kinds.map((k) => (
              <button
                key={k}
                role="menuitemradio"
                aria-checked={current === k}
                className={`arc-choice ${current === k ? "on" : ""}`}
                onClick={() => choose(k)}
                data-testid={`arc-kind-${k}`}
              >
                <span className="arc-choice-icon">
                  <ArcHeadIcon kind={k} />
                </span>
                <span className="arc-choice-text">
                  <span className="arc-choice-label">
                    {ARC_KIND_INFO[k].label}
                    {current === k && <span className="arc-choice-check" aria-hidden> ✓</span>}
                  </span>
                  <span className="arc-choice-help">{ARC_KIND_INFO[k].help}</span>
                </span>
                <kbd>{ARC_KIND_INFO[k].key}</kbd>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function ToolPalette() {
  const tool = useStore((s) => s.tool);
  const mode = useStore((s) => s.mode);
  const netClass = useStore((s) => s.net.netClass);
  const disabled = mode === "simulate";
  const ft = isFaultTree(netClass);
  const items = paletteItems(netClass);
  const kinds = netClass === "freestyle" ? [] : arcKindsFor(netClass);
  const touchDrag = usePaletteTouchDrag(disabled);

  const toolButton = (it: PaletteItem) => (
    <button
      key={it.tool}
      className={`tool ${tool === it.tool && !disabled ? "on" : ""}`}
      disabled={disabled}
      title={`${it.label}${it.key ? ` (${it.key})` : ""}: ${it.help}. Click, then click the canvas; or drag it onto the canvas.`}
      onClick={() => !touchDrag.swallowClick() && setTool(it.tool)}
      draggable={!disabled}
      onDragStart={(e) => {
        e.dataTransfer.setData(TOOL_MIME, it.tool);
        e.dataTransfer.effectAllowed = "copy";
      }}
      {...touchDrag.bind(it.tool, it.icon)}
      data-testid={`tool-${it.tool.replace(":", "-")}`}
    >
      {it.icon}
      <span>{it.label}</span>
    </button>
  );

  return (
    <aside className="palette" aria-label="Tools">
      <button className={`tool ${tool === "select" && !disabled ? "on" : ""}`} disabled={disabled} title="Select and move (V)" onClick={() => setTool("select")} data-testid="tool-select">
        <Icon name="select" size={20} />
        <span>Select</span>
      </button>
      <div className="palette-label">{ft ? "Drag onto the canvas" : "Drag or click"}</div>
      <div className={ft ? "palette-grid" : "palette-col"}>{items.map(toolButton)}</div>
      {!ft && (
        <>
          <ArcToolButton kinds={kinds} disabled={disabled} />
        </>
      )}
      <div className="palette-sep" />
      {toolButton({ tool: "note", label: "Note", icon: <Icon name="note" size={20} />, help: "A free text comment" })}
      {touchDrag.ghostEl}
    </aside>
  );
}

export { redo, undo };
