import React, { useMemo, useState } from "react";
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

/**
 * Every place, transition and arc in one sortable, filterable table, with the common fields
 * editable in place (Snoopy's "edit as table"), plus the subnet hierarchy.
 */
export function ElementsPanel() {
  const net = useStore((s) => s.net);
  const selection = useStore((s) => s.selection);
  const readOnly = useStore((s) => s.mode !== "edit");
  const [kind, setKind] = useState<Kind>("places");
  const [filter, setFilter] = useState("");
  const coloured = isColoured(net.netClass);
  const tb = timeBase(net.netClass);
  const hasHierarchy = net.places.some((p) => p.coarse) || net.transitions.some((t) => t.coarse);
  const sel = new Set(selection);
  const f = filter.trim().toLowerCase();
  const match = (...xs: (string | undefined)[]) => !f || xs.some((x) => x?.toLowerCase().includes(f));
  const nameOf = useMemo(() => new Map([...net.places, ...net.transitions].map((n) => [n.id, n.name])), [net]);

  if (isFaultTree(net.netClass)) return <div className="empty">The element table is for Petri nets. Use the fault tree analysis tab for fault trees.</div>;

  const places = net.places.filter((p) => !p.coarse && match(p.name, p.marking, p.colourSet, p.comment));
  const transitions = net.transitions.filter((t) => !t.coarse && match(t.name, t.rate, t.guard, t.comment));
  const arcs = net.arcs.filter((a) => match(nameOf.get(a.source), nameOf.get(a.target), a.inscription, a.kind));
  const row = (id: string) => ({ className: sel.has(id) ? "on" : "", onClick: (e: React.MouseEvent) => (e.target as HTMLElement).tagName !== "INPUT" && revealElement(id) });

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
      </div>
      <div className="elements-body">
        {kind === "places" && (
          <table className="grid-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>{tb === "continuous" ? "Initial amount" : "Initial marking"}</th>
                {coloured && <th>Colour set</th>}
                <th>Capacity</th>
                {hasHierarchy && <th>Subnet</th>}
                <th>Comment</th>
              </tr>
            </thead>
            <tbody>
              {places.map((p) => (
                <tr key={p.id} {...row(p.id)}>
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
            </tbody>
          </table>
        )}
        {kind === "transitions" && (
          <table className="grid-table">
            <thead>
              <tr>
                <th>Name</th>
                {tb && <th>Kind</th>}
                {tb && <th>Rate / weight / delay</th>}
                {coloured && <th>Guard</th>}
                {net.netClass === "timed" && <th>Interval</th>}
                {hasHierarchy && <th>Subnet</th>}
                <th>Comment</th>
              </tr>
            </thead>
            <tbody>
              {transitions.map((t) => (
                <tr key={t.id} {...row(t.id)}>
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
            </tbody>
          </table>
        )}
        {kind === "arcs" && (
          <table className="grid-table">
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Type</th>
                <th>{coloured ? "Inscription" : "Weight"}</th>
              </tr>
            </thead>
            <tbody>
              {arcs.map((a) => (
                <tr key={a.id} {...row(a.id)}>
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
            </tbody>
          </table>
        )}
        {kind === "hierarchy" && <HierarchyTree net={net} />}
        {kind !== "hierarchy" && (kind === "places" ? places : kind === "transitions" ? transitions : arcs).length === 0 && (
          <div className="empty">{f ? "Nothing matches the filter." : `No ${kind} yet.`}</div>
        )}
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
