import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Net, isColoured, isFaultTree, timeBase } from "@pns/core";
import { enterPage, select, updateArc, updatePlace, updateTransition, useStore } from "./store";
import { centerOn } from "./Canvas";
import { ARC_KIND_INFO } from "./Toolbar";

type Kind = "places" | "transitions" | "arcs" | "hierarchy";

/** Select an element and bring it into view, opening the subnet it lives in. */
export function revealElement(id: string) {
  const s = useStore.getState();
  const net = s.net;
  const arc = net.arcs.find((a) => a.id === id);
  const nodeId = arc ? arc.source : id;
  const n = net.places.find((p) => p.id === nodeId) ?? net.transitions.find((t) => t.id === nodeId) ?? net.faultTree?.nodes.find((f) => f.id === nodeId);
  if (!n) return;
  if ((n.parent ?? null) !== s.page) enterPage(n.parent ?? null);
  select([id]);
  // Let a page switch's fit run first, then centre on the element.
  requestAnimationFrame(() => centerOn({ x: n.x, y: n.y }));
}

function pageName(net: Net, parent: string | undefined): string {
  if (!parent) return "";
  return net.places.find((p) => p.id === parent)?.name ?? net.transitions.find((t) => t.id === parent)?.name ?? "";
}

interface Sort {
  key: string;
  desc: boolean;
}

type SortValue = string | number | undefined;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Numbers compare as numbers, everything else as text with digit runs compared by value (P2 before P10). */
export function compareValues(a: SortValue, b: SortValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a ?? ""), String(b ?? ""));
}

/** A stable sort of `rows` by one column. */
export function sortRows<T>(rows: T[], value: ((x: T) => SortValue) | null | undefined, desc: boolean): T[] {
  if (!value) return rows;
  const keyed = rows.map((x, i) => ({ x, i, v: value(x) }));
  keyed.sort((a, b) => (desc ? compareValues(b.v, a.v) : compareValues(a.v, b.v)) || a.i - b.i);
  return keyed.map((k) => k.x);
}

/** Past this many rows only the rows in view are rendered. */
const WINDOW_FROM = 150;
const OVERSCAN = 12;

/**
 * Every place, transition and arc in one sortable, filterable table, with the common fields
 * editable in place (Snoopy's "edit as table"), plus the subnet hierarchy. Click a header to sort;
 * Ctrl/Cmd-click rows to add or remove them from the selection, Shift-click to select a range.
 */
export function ElementsPanel() {
  const net = useStore((s) => s.net);
  const selection = useStore((s) => s.selection);
  const readOnly = useStore((s) => s.mode !== "edit");
  const [kind, setKind] = useState<Kind>("places");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort | null>(null);
  const anchor = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const firstRow = useRef<HTMLTableRowElement>(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  const [rowH, setRowH] = useState(27);
  const ft = isFaultTree(net.netClass);
  const coloured = isColoured(net.netClass);
  const tb = timeBase(net.netClass);
  const hasHierarchy = net.places.some((p) => p.coarse) || net.transitions.some((t) => t.coarse);
  const sel = new Set(selection);
  const f = filter.trim().toLowerCase();
  const match = (...xs: (string | undefined)[]) => !f || xs.some((x) => x?.toLowerCase().includes(f));
  const nameOf = useMemo(() => new Map([...net.places, ...net.transitions].map((n) => [n.id, n.name])), [net]);

  useEffect(() => {
    setSort(null);
    anchor.current = null;
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [kind]);

  // Track the visible part of the table for windowing.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const update = () => setView({ top: el.scrollTop, height: el.clientHeight });
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [ft]);

  // Rows have one height; measure it once rows are drawn so the spacers match.
  useLayoutEffect(() => {
    const h = firstRow.current?.getBoundingClientRect().height;
    if (h && Math.abs(h - rowH) > 0.5) setRowH(h);
  });

  if (ft) return <div className="empty">The element table is for Petri nets. Use the fault tree analysis tab for fault trees.</div>;

  const markingValue = (m: string) => (m.trim() === "" ? "0" : m);
  const placeCols: Record<string, (p: Net["places"][number]) => SortValue> = {
    name: (p) => p.name,
    marking: (p) => markingValue(p.marking),
    colourSet: (p) => p.colourSet ?? "Dot",
    capacity: (p) => p.capacity ?? Infinity,
    subnet: (p) => pageName(net, p.parent),
    comment: (p) => p.comment,
  };
  const transitionCols: Record<string, (t: Net["transitions"][number]) => SortValue> = {
    name: (t) => t.name,
    kind: (t) => t.kind ?? (tb === "continuous" ? "continuous" : "stochastic"),
    rate: (t) => t.rate,
    guard: (t) => t.guard,
    interval: (t) => `${t.interval?.[0] ?? "0"} ${t.interval?.[1] ?? "inf"}`,
    subnet: (t) => pageName(net, t.parent),
    comment: (t) => t.comment,
  };
  const arcCols: Record<string, (a: Net["arcs"][number]) => SortValue> = {
    from: (a) => nameOf.get(a.source),
    to: (a) => nameOf.get(a.target),
    type: (a) => ARC_KIND_INFO[a.kind].label,
    weight: (a) => (a.kind === "reset" || a.kind === "modifier" ? "" : a.inscription),
  };

  const desc = !!sort?.desc;
  const places = sortRows(
    net.places.filter((p) => !p.coarse && match(p.name, p.marking, p.colourSet, p.comment)),
    sort && placeCols[sort.key],
    desc,
  );
  const transitions = sortRows(
    net.transitions.filter((t) => !t.coarse && match(t.name, t.rate, t.guard, t.comment)),
    sort && transitionCols[sort.key],
    desc,
  );
  const arcs = sortRows(
    net.arcs.filter((a) => match(nameOf.get(a.source), nameOf.get(a.target), a.inscription, a.kind)),
    sort && arcCols[sort.key],
    desc,
  );
  const rows: { id: string }[] = kind === "places" ? places : kind === "transitions" ? transitions : kind === "arcs" ? arcs : [];
  const ordered = rows.map((r) => r.id);

  // Windowing: draw only the rows in view (plus a margin) between two spacer rows.
  const windowed = rows.length > WINDOW_FROM;
  const start = windowed ? Math.max(0, Math.floor(view.top / rowH) - OVERSCAN) : 0;
  const end = windowed ? Math.min(rows.length, Math.ceil((view.top + view.height) / rowH) + OVERSCAN) : rows.length;
  const visible = <T,>(xs: T[]) => xs.slice(start, end);
  const spacer = (n: number) =>
    n > 0 && (
      <tr className="spacer" aria-hidden="true">
        <td colSpan={99} style={{ height: n * rowH }} />
      </tr>
    );

  const onRowClick = (id: string) => (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const add = e.ctrlKey || e.metaKey;
    if (e.shiftKey && anchor.current && ordered.includes(anchor.current)) {
      const i = ordered.indexOf(anchor.current);
      const j = ordered.indexOf(id);
      const range = ordered.slice(Math.min(i, j), Math.max(i, j) + 1);
      select(add ? [...new Set([...selection, ...range])] : range);
      return;
    }
    anchor.current = id;
    if (add) select(sel.has(id) ? selection.filter((x) => x !== id) : [...selection, id]);
    else revealElement(id);
  };
  const row = (id: string, i: number) => ({
    ref: i === 0 ? firstRow : undefined,
    className: sel.has(id) ? "on" : "",
    // Keep Shift-click from selecting the table's text.
    onMouseDown: (e: React.MouseEvent) => e.shiftKey && (e.target as HTMLElement).tagName !== "INPUT" && e.preventDefault(),
    onClick: onRowClick(id),
  });
  const th = (key: string, label: React.ReactNode) => {
    const on = sort?.key === key;
    return (
      <th aria-sort={on ? (sort.desc ? "descending" : "ascending") : "none"}>
        <button className="th-sort" onClick={() => setSort(on ? { key, desc: !sort.desc } : { key, desc: false })} title="Sort by this column">
          {label}
          <span className="sort-mark">{on ? (sort.desc ? "▼" : "▲") : ""}</span>
        </button>
      </th>
    );
  };

  return (
    <div className="elements">
      <div className="elements-bar">
        <div className="segmented small-seg" role="tablist" aria-label="Element type">
          {(["places", "transitions", "arcs", ...(hasHierarchy ? ["hierarchy" as const] : [])] as Kind[]).map((k) => (
            <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
              {k[0].toUpperCase() + k.slice(1)}
              {k !== "hierarchy" && <span className="count">{k === "places" ? places.length : k === "transitions" ? transitions.length : arcs.length}</span>}
            </button>
          ))}
        </div>
        {kind !== "hierarchy" && <input className="elements-filter" placeholder="Filter…" aria-label="Filter elements" value={filter} onChange={(e) => setFilter(e.target.value)} />}
        {kind !== "hierarchy" && selection.length > 1 && <span className="muted small">{selection.length} selected</span>}
      </div>
      <div className="elements-body" ref={bodyRef} onScroll={(e) => setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}>
        {kind === "places" && (
          <table className={`grid-table${windowed ? " windowed" : ""}`}>
            <thead>
              <tr>
                {th("name", "Name")}
                {th("marking", tb === "continuous" ? "Initial amount" : "Initial marking")}
                {coloured && th("colourSet", "Colour set")}
                {th("capacity", "Capacity")}
                {hasHierarchy && th("subnet", "Subnet")}
                {th("comment", "Comment")}
              </tr>
            </thead>
            <tbody>
              {spacer(start)}
              {visible(places).map((p, i) => (
                <tr key={p.id} {...row(p.id, i)}>
                  <td>
                    <input aria-label="Name" disabled={readOnly} value={p.name} onChange={(e) => updatePlace(p.id, { name: e.target.value }, `tbl-${p.id}-n`)} />
                  </td>
                  <td>
                    <input aria-label="Marking" className="mono" disabled={readOnly} value={p.marking} placeholder="0" onChange={(e) => updatePlace(p.id, { marking: e.target.value }, `tbl-${p.id}-m`)} />
                  </td>
                  {coloured && <td className="mono">{p.colourSet ?? "Dot"}</td>}
                  <td>
                    <input
                      aria-label="Capacity"
                      type="number"
                      min={1}
                      disabled={readOnly}
                      value={p.capacity ?? ""}
                      placeholder="∞"
                      onChange={(e) => updatePlace(p.id, { capacity: e.target.value ? Math.max(1, Number(e.target.value)) : undefined }, `tbl-${p.id}-c`)}
                    />
                  </td>
                  {hasHierarchy && <td className="muted">{pageName(net, p.parent)}</td>}
                  <td>
                    <input aria-label="Comment" disabled={readOnly} value={p.comment ?? ""} onChange={(e) => updatePlace(p.id, { comment: e.target.value || undefined }, `tbl-${p.id}-k`)} />
                  </td>
                </tr>
              ))}
              {spacer(places.length - end)}
            </tbody>
          </table>
        )}
        {kind === "transitions" && (
          <table className={`grid-table${windowed ? " windowed" : ""}`}>
            <thead>
              <tr>
                {th("name", "Name")}
                {tb && th("kind", "Kind")}
                {tb && th("rate", "Rate / weight / delay")}
                {coloured && th("guard", "Guard")}
                {net.netClass === "timed" && th("interval", "Interval")}
                {hasHierarchy && th("subnet", "Subnet")}
                {th("comment", "Comment")}
              </tr>
            </thead>
            <tbody>
              {spacer(start)}
              {visible(transitions).map((t, i) => (
                <tr key={t.id} {...row(t.id, i)}>
                  <td>
                    <input aria-label="Name" disabled={readOnly} value={t.name} onChange={(e) => updateTransition(t.id, { name: e.target.value }, `tbl-${t.id}-n`)} />
                  </td>
                  {tb && <td className="muted">{t.kind ?? (tb === "continuous" ? "continuous" : "stochastic")}</td>}
                  {tb && (
                    <td>
                      <input aria-label="Rate" className="mono" disabled={readOnly} value={t.rate ?? ""} placeholder="MassAction(1)" onChange={(e) => updateTransition(t.id, { rate: e.target.value }, `tbl-${t.id}-r`)} />
                    </td>
                  )}
                  {coloured && (
                    <td>
                      <input aria-label="Guard" className="mono" disabled={readOnly} value={t.guard ?? ""} placeholder="true" onChange={(e) => updateTransition(t.id, { guard: e.target.value || undefined }, `tbl-${t.id}-g`)} />
                    </td>
                  )}
                  {net.netClass === "timed" && (
                    <td className="mono">
                      [{t.interval?.[0] ?? "0"}, {t.interval?.[1] ?? "inf"}]
                    </td>
                  )}
                  {hasHierarchy && <td className="muted">{pageName(net, t.parent)}</td>}
                  <td>
                    <input aria-label="Comment" disabled={readOnly} value={t.comment ?? ""} onChange={(e) => updateTransition(t.id, { comment: e.target.value || undefined }, `tbl-${t.id}-k`)} />
                  </td>
                </tr>
              ))}
              {spacer(transitions.length - end)}
            </tbody>
          </table>
        )}
        {kind === "arcs" && (
          <table className={`grid-table${windowed ? " windowed" : ""}`}>
            <thead>
              <tr>
                {th("from", "From")}
                {th("to", "To")}
                {th("type", "Type")}
                {th("weight", coloured ? "Inscription" : "Weight")}
              </tr>
            </thead>
            <tbody>
              {spacer(start)}
              {visible(arcs).map((a, i) => (
                <tr key={a.id} {...row(a.id, i)}>
                  <td>{nameOf.get(a.source)}</td>
                  <td>{nameOf.get(a.target)}</td>
                  <td className="muted">{ARC_KIND_INFO[a.kind].label}</td>
                  <td>
                    {a.kind === "reset" || a.kind === "modifier" ? (
                      <span className="muted">—</span>
                    ) : (
                      <input aria-label="Weight" className="mono" disabled={readOnly} value={a.inscription} onChange={(e) => updateArc(a.id, { inscription: e.target.value }, `tbl-${a.id}-w`)} />
                    )}
                  </td>
                </tr>
              ))}
              {spacer(arcs.length - end)}
            </tbody>
          </table>
        )}
        {kind === "hierarchy" && <HierarchyTree net={net} />}
        {kind !== "hierarchy" && rows.length === 0 && <div className="empty">{f ? "Nothing matches the filter." : `No ${kind} yet.`}</div>}
      </div>
    </div>
  );
}

/** Snoopy's hierarchy browser: the tree of subnets; click to open one. */
function HierarchyTree({ net }: { net: Net }) {
  const page = useStore((s) => s.page);
  const coarse = [...net.places, ...net.transitions].filter((n) => n.coarse);
  const children = (parent: string | null) => coarse.filter((n) => (n.parent ?? null) === parent);
  const count = (id: string) => [...net.places, ...net.transitions].filter((n) => n.parent === id && !n.coarse).length;
  const render = (parent: string | null, depth: number): React.ReactNode =>
    children(parent).map((n) => (
      <React.Fragment key={n.id}>
        <li style={{ paddingLeft: 10 + depth * 18 }} className={page === n.id ? "on" : ""} onClick={() => enterPage(n.id)}>
          <span className="tree-icon">{net.places.some((p) => p.id === n.id) ? "◯" : "▯"}</span>
          {n.name}
          <span className="muted small"> · {count(n.id)} {count(n.id) === 1 ? "node" : "nodes"}</span>
        </li>
        {render(n.id, depth + 1)}
      </React.Fragment>
    ));
  return (
    <ul className="tree">
      <li className={page === null ? "on" : ""} onClick={() => enterPage(null)}>
        <span className="tree-icon">▤</span>
        {net.name || "Top level"}
      </li>
      {render(null, 1)}
    </ul>
  );
}
