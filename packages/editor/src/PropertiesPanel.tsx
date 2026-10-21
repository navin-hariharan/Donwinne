import React from "react";
import {
  ARC_KINDS,
  ArcKind,
  ColourSetDecl,
  Declarations,
  FunctionDecl,
  ObserverDecl,
  arcKindsFor,
  FTNodeType,
  NET_CLASS_LABELS,
  NetClass,
  TransitionKind,
  isAmbient,
  isColoured,
  isFaultTree,
  isFuzzy,
  timeBase,
} from "@pns/core";
import {
  adjustTokens,
  alignSelection,
  compiled,
  problemsOf,
  deleteSelection,
  reverseArc,
  enterPage,
  groupIntoSubnet,
  setColor,
  setNetClass,
  ungroupSubnet,
  updateArc,
  updateFTNode,
  updateNet,
  updateNote,
  updatePlace,
  updateTransition,
  useStore,
} from "./store";
import { ARC_KIND_INFO, Icon } from "./Toolbar";
import { NODE_COLORS } from "./ContextMenu";
import { playNote, NOTE_NAMES, INSTRUMENTS } from "./music";

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function problemsFor(id: string) {
  const net = useStore.getState().net;
  return problemsOf(net).filter((p) => p.elementId === id);
}

function Problems({ id }: { id: string }) {
  useStore((s) => s.net);
  const ps = problemsFor(id);
  if (!ps.length) return null;
  return (
    <div className="inline-problems">
      {ps.map((p, i) => (
        <div key={i} className={p.severity}>
          {p.message}
        </div>
      ))}
    </div>
  );
}

export function PropertiesPanel() {
  const net = useStore((s) => s.net);
  const selection = useStore((s) => s.selection);
  const mode = useStore((s) => s.mode);
  const readOnly = mode === "simulate";

  if (selection.length > 1) {
    const nodes = selection.filter(
      (id) =>
        net.places.some((p) => p.id === id) ||
        net.transitions.some((t) => t.id === id),
    ).length;
    const count = (n: number, one: string, many: string) =>
      n ? `${n} ${n === 1 ? one : many}` : null;
    const sel = new Set(selection);
    const parts = [
      count(net.places.filter((p) => sel.has(p.id)).length, "place", "places"),
      count(
        net.transitions.filter((t) => sel.has(t.id)).length,
        "transition",
        "transitions",
      ),
      count(net.arcs.filter((a) => sel.has(a.id)).length, "arc", "arcs"),
      count(
        (net.notes ?? []).filter((n) => sel.has(n.id)).length,
        "note",
        "notes",
      ),
      count(
        (net.faultTree?.nodes ?? []).filter((n) => sel.has(n.id)).length,
        "event or gate",
        "events and gates",
      ),
      count(
        (net.faultTree?.edges ?? []).filter((e) => sel.has(e.id)).length,
        "connection",
        "connections",
      ),
    ].filter(Boolean);
    return (
      <aside className="panel props">
        <h2>{selection.length} items selected</h2>
        <p className="muted">
          {parts.length > 1
            ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
            : parts[0]}
          . Drag to move them together or press Delete to remove them.
        </p>
        {!readOnly && (
          <>
            <h3>Arrange</h3>
            <div className="btn-row">
              <button
                className="icon"
                title="Align left"
                onClick={() => alignSelection("left")}
              >
                <Icon name="alignLeft" />
              </button>
              <button
                className="icon"
                title="Align centres"
                onClick={() => alignSelection("centerX")}
              >
                <Icon name="alignCenterX" />
              </button>
              <button
                className="icon"
                title="Align top"
                onClick={() => alignSelection("top")}
              >
                <Icon name="alignTop" />
              </button>
              <button
                className="icon"
                title="Align middles"
                onClick={() => alignSelection("centerY")}
              >
                <Icon name="alignCenterY" />
              </button>
              <button
                className="icon"
                title="Space evenly left to right"
                onClick={() => alignSelection("distributeX")}
              >
                <Icon name="distributeX" />
              </button>
              <button
                className="icon"
                title="Space evenly top to bottom"
                onClick={() => alignSelection("distributeY")}
              >
                <Icon name="distributeY" />
              </button>
            </div>
            <ColorPicker ids={selection} />
            {!isFaultTree(net.netClass) && nodes > 0 && (
              <button
                onClick={() => groupIntoSubnet("transition")}
                title="Hide the selection behind one coarse transition"
              >
                Group into subnet
              </button>
            )}
            <button className="danger" onClick={deleteSelection}>
              Delete selection
            </button>
          </>
        )}
      </aside>
    );
  }

  const id = selection[0];
  const place = net.places.find((p) => p.id === id);
  const trans = net.transitions.find((t) => t.id === id);
  const arc = net.arcs.find((a) => a.id === id);
  const coloured = isColoured(net.netClass);
  const tb = timeBase(net.netClass);
  const ftNode = net.faultTree?.nodes.find((n) => n.id === id);
  const ftEdge = net.faultTree?.edges.find((e) => e.id === id);
  const note = net.notes?.find((n) => n.id === id);

  if (ftNode) return <FTNodeProps id={ftNode.id} readOnly={readOnly} />;
  if (ftEdge) {
    const a = net.faultTree!.nodes.find((n) => n.id === ftEdge.source)?.name;
    const b = net.faultTree!.nodes.find((n) => n.id === ftEdge.target)?.name;
    return (
      <aside className="panel props">
        <h2>Connection</h2>
        <p className="muted">
          {a} feeds {b}
        </p>
        {!readOnly && (
          <button className="danger" onClick={deleteSelection}>
            Delete connection
          </button>
        )}
      </aside>
    );
  }
  if (note)
    return (
      <aside className="panel props">
        <h2>Note</h2>
        <fieldset disabled={readOnly}>
          <Field label="Text">
            <textarea
              rows={6}
              value={note.text}
              onChange={(e) =>
                updateNote(note.id, { text: e.target.value }, `note-${note.id}`)
              }
            />
          </Field>
          <ColorPicker ids={[note.id]} />
        </fieldset>
      </aside>
    );

  if (place?.coarse || trans?.coarse) {
    const n = (place ?? trans)!;
    const inside = [...net.places, ...net.transitions].filter(
      (x) => x.parent === n.id,
    ).length;
    return (
      <aside className="panel props">
        <h2>Subnet</h2>
        <fieldset disabled={readOnly}>
          <Field label="Name">
            <input
              data-focus-name
              value={n.name}
              onChange={(e) =>
                place
                  ? updatePlace(n.id, { name: e.target.value }, `c-${n.id}`)
                  : updateTransition(
                      n.id,
                      { name: e.target.value },
                      `c-${n.id}`,
                    )
              }
            />
          </Field>
          <p className="muted small">
            Contains {inside} node{inside === 1 ? "" : "s"}. Arcs into the
            subnet are drawn to this node here, and to faded copies of the
            outside nodes inside it.
          </p>
          <div className="btn-row">
            <button className="primary" onClick={() => enterPage(n.id)}>
              Open subnet
            </button>
            <button onClick={() => ungroupSubnet(n.id)}>Ungroup</button>
          </div>
          <ColorPicker ids={[n.id]} />
        </fieldset>
      </aside>
    );
  }

  if (place) {
    const k = (f: string) => `place-${place.id}-${f}`;
    return (
      <aside className="panel props">
        <h2>Place</h2>
        <fieldset disabled={readOnly}>
          <Field label="Name">
            <input
              data-focus-name
              value={place.name}
              onChange={(e) =>
                updatePlace(place.id, { name: e.target.value }, k("name"))
              }
            />
          </Field>
          {coloured && (
            <Field label="Colour set">
              <select
                value={place.colourSet ?? "Dot"}
                onChange={(e) =>
                  updatePlace(place.id, { colourSet: e.target.value })
                }
              >
                {net.declarations.colourSets.map((c) => (
                  <option key={c.name}>{c.name}</option>
                ))}
              </select>
            </Field>
          )}
          <Field
            label={
              place.continuous || tb === "continuous"
                ? "Initial amount"
                : "Initial marking"
            }
            hint={
              coloured
                ? "A multiset, for example 2`red ++ blue or all(Colour)"
                : place.continuous || tb === "continuous"
                  ? "A real number or a constant"
                  : net.netClass === "modulo"
                    ? `Tokens, counted modulo ${net.modulus ?? 2}`
                    : "Number of tokens, or a constant"
            }
          >
            <div className="stepper">
              {!coloured && (
                <button
                  type="button"
                  className="icon"
                  aria-label="Remove a token"
                  title="Remove a token (−)"
                  onClick={() => adjustTokens(place.id, -1)}
                >
                  −
                </button>
              )}
              <input
                className="mono"
                value={place.marking}
                inputMode={coloured ? undefined : "decimal"}
                placeholder={coloured ? "empty" : "0"}
                onChange={(e) =>
                  updatePlace(
                    place.id,
                    { marking: e.target.value },
                    k("marking"),
                  )
                }
                data-testid="marking-input"
              />
              {!coloured && (
                <button
                  type="button"
                  className="icon"
                  aria-label="Add a token"
                  title="Add a token (+)"
                  onClick={() => adjustTokens(place.id, 1)}
                >
                  +
                </button>
              )}
            </div>
          </Field>
          {tb === "hybrid" && (
            <label className="check">
              <input
                type="checkbox"
                checked={!!place.continuous}
                onChange={(e) =>
                  updatePlace(place.id, {
                    continuous: e.target.checked || undefined,
                  })
                }
              />
              Continuous place (holds a real amount)
            </label>
          )}
          {(tb === "continuous" || (tb === "hybrid" && place.continuous)) && (
            <label className="check">
              <input
                type="checkbox"
                checked={!!place.fixed}
                onChange={(e) =>
                  updatePlace(place.id, {
                    fixed: e.target.checked || undefined,
                  })
                }
              />
              Fixed (the amount stays constant during simulation, like a
              boundary condition)
            </label>
          )}
          <Field
            label="Capacity"
            hint={
              coloured
                ? "Maximum tokens of each colour; empty means no limit"
                : tb === "continuous" || place.continuous
                  ? "Maximum amount; empty means no limit"
                  : "Maximum tokens; empty means no limit"
            }
          >
            <input
              type="number"
              min={1}
              value={place.capacity ?? ""}
              onChange={(e) =>
                updatePlace(
                  place.id,
                  {
                    capacity: e.target.value
                      ? Math.max(1, Number(e.target.value))
                      : undefined,
                  },
                  k("cap"),
                )
              }
            />
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={!!place.logical}
              onChange={(e) =>
                updatePlace(place.id, {
                  logical: e.target.checked || undefined,
                })
              }
            />
            Logical place (shares its marking with every logical place of the
            same name)
          </label>
          {isAmbient(net.netClass) && (
            <label className="check">
              <input
                type="checkbox"
                checked={!!place.gluing}
                onChange={(e) =>
                  updatePlace(place.id, {
                    gluing: e.target.checked || undefined,
                  })
                }
                data-testid="gluing-input"
              />
              Gluing (interface) place: where steps are composed (the set G
              of Konios Def. 3), drawn with a double ring and G
            </label>
          )}
          <ColorPicker ids={[place.id]} />
          <Field label="Comment">
            <textarea
              rows={3}
              value={place.comment ?? ""}
              onChange={(e) =>
                updatePlace(
                  place.id,
                  { comment: e.target.value || undefined },
                  k("comment"),
                )
              }
            />
          </Field>
        </fieldset>
        <Problems id={place.id} />
      </aside>
    );
  }

  if (trans) {
    const k = (f: string) => `trans-${trans.id}-${f}`;
    return (
      <aside className="panel props">
        <h2>Transition</h2>
        <fieldset disabled={readOnly}>
          <Field label="Name">
            <input
              data-focus-name
              value={trans.name}
              onChange={(e) =>
                updateTransition(trans.id, { name: e.target.value }, k("name"))
              }
            />
          </Field>
          {coloured && (
            <Field
              label="Guard"
              hint="Boolean condition on the variables, for example x <> y and n > 0"
            >
              <input
                className="mono"
                value={trans.guard ?? ""}
                placeholder="always true"
                onChange={(e) =>
                  updateTransition(
                    trans.id,
                    { guard: e.target.value || undefined },
                    k("guard"),
                  )
                }
              />
            </Field>
          )}
          {tb && <TransitionTiming id={trans.id} />}
          {net.netClass === "timed" && (
            <Field
              label="Firing interval"
              hint="Fires no sooner than the earliest and no later than the latest time after it became enabled. Use inf for no limit."
            >
              <div className="pair">
                <input
                  className="mono"
                  aria-label="Earliest"
                  value={trans.interval?.[0] ?? "0"}
                  onChange={(e) =>
                    updateTransition(
                      trans.id,
                      {
                        interval: [
                          e.target.value,
                          trans.interval?.[1] ?? "inf",
                        ],
                      },
                      k("eft"),
                    )
                  }
                />
                <span>to</span>
                <input
                  className="mono"
                  aria-label="Latest"
                  value={trans.interval?.[1] ?? "inf"}
                  onChange={(e) =>
                    updateTransition(
                      trans.id,
                      {
                        interval: [trans.interval?.[0] ?? "0", e.target.value],
                      },
                      k("lft"),
                    )
                  }
                />
              </div>
            </Field>
          )}
          {net.netClass === "music" && <SoundFields id={trans.id} />}
          <label className="check">
            <input
              type="checkbox"
              checked={!!trans.horizontal}
              onChange={(e) =>
                updateTransition(trans.id, {
                  horizontal: e.target.checked || undefined,
                })
              }
            />
            Draw horizontally
          </label>
          <ColorPicker ids={[trans.id]} />
          <Field label="Comment">
            <textarea
              rows={3}
              value={trans.comment ?? ""}
              onChange={(e) =>
                updateTransition(
                  trans.id,
                  { comment: e.target.value || undefined },
                  k("comment"),
                )
              }
            />
          </Field>
        </fieldset>
        <Problems id={trans.id} />
      </aside>
    );
  }

  if (arc) {
    const src =
      net.places.find((p) => p.id === arc.source)?.name ??
      net.transitions.find((t) => t.id === arc.source)?.name;
    const tgt =
      net.places.find((p) => p.id === arc.target)?.name ??
      net.transitions.find((t) => t.id === arc.target)?.name;
    const fromPlace = net.places.some((p) => p.id === arc.source);
    return (
      <aside className="panel props">
        <h2>Arc</h2>
        <p className="muted">
          {src} → {tgt}
        </p>
        <fieldset disabled={readOnly}>
          <Field label="Type" hint={ARC_KIND_INFO[arc.kind].help}>
            <select
              value={arc.kind}
              onChange={(e) =>
                updateArc(arc.id, { kind: e.target.value as ArcKind })
              }
            >
              {(net.netClass === "pt"
                ? ARC_KINDS.filter((kd) => kd !== "modifier")
                : arcKindsFor(net.netClass)
              )
                .filter((kd) => kd === "normal" || fromPlace)
                .map((kd) => (
                  <option key={kd} value={kd}>
                    {ARC_KIND_INFO[kd].label}
                  </option>
                ))}
            </select>
          </Field>
          {arc.kind !== "reset" &&
            arc.kind !== "modifier" &&
            net.netClass !== "freestyle" && (
              <Field
                label={coloured ? "Inscription" : "Weight"}
                hint={
                  coloured
                    ? "A multiset expression over variables, for example x ++ 2`y"
                    : tb === "continuous" || tb === "hybrid"
                      ? "A number, or an expression over place names such as P0 * 2"
                      : "A whole number, or an expression over place names such as P0 * 2"
                }
              >
                <input
                  className="mono"
                  value={arc.inscription}
                  onChange={(e) =>
                    updateArc(
                      arc.id,
                      { inscription: e.target.value },
                      `arc-${arc.id}-insc`,
                    )
                  }
                />
              </Field>
            )}
          {arc.points?.length ? (
            <button onClick={() => updateArc(arc.id, { points: undefined })}>
              Remove {arc.points.length} bend point
              {arc.points.length > 1 ? "s" : ""}
            </button>
          ) : (
            <p className="muted small">
              Drag the dot in the middle of the selected arc to bend it.
              Alt-click a bend point to remove it.
            </p>
          )}
          {arc.kind === "normal" && (
            <button
              type="button"
              onClick={() => reverseArc(arc.id)}
              title="Swap the arc's source and target"
            >
              Reverse direction
            </button>
          )}
          <ColorPicker ids={[arc.id]} label="Line colour" />
        </fieldset>
        <Problems id={arc.id} />
      </aside>
    );
  }

  // Nothing selected: the net itself.
  return (
    <aside className="panel props">
      <h2>Net</h2>
      <fieldset disabled={readOnly}>
        <Field label="Name">
          <input
            value={net.name}
            onChange={(e) => updateNet({ name: e.target.value }, "net-name")}
          />
        </Field>
        <Field label="Net class">
          <select
            value={net.netClass}
            onChange={(e) => setNetClass(e.target.value as NetClass)}
          >
            {(Object.keys(NET_CLASS_LABELS) as NetClass[]).map((c) => (
              <option key={c} value={c}>
                {NET_CLASS_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        {net.netClass === "modulo" && (
          <Field
            label="Modulus"
            hint="Token counts wrap around: firing adds and subtracts modulo this number"
          >
            <input
              type="number"
              min={2}
              value={net.modulus ?? 2}
              onChange={(e) =>
                updateNet(
                  { modulus: Math.max(2, Number(e.target.value) || 2) },
                  "modulus",
                )
              }
            />
          </Field>
        )}
        <p className="muted small">
          {isFaultTree(net.netClass)
            ? `${plural(net.faultTree?.nodes.length ?? 0, "event or gate", "events and gates")}, ${plural(net.faultTree?.edges.length ?? 0, "connection")}`
            : `${plural(net.places.length, "place")}, ${plural(net.transitions.length, "transition")}, ${plural(net.arcs.length, "arc")}`}
        </p>
        <Field label="Description">
          <textarea
            rows={3}
            value={net.comment ?? ""}
            onChange={(e) =>
              updateNet({ comment: e.target.value || undefined }, "net-comment")
            }
          />
        </Field>
      </fieldset>
      {net.netClass !== "freestyle" && (
        <DeclarationsEditor
          decl={net.declarations}
          readOnly={readOnly}
          colours={coloured}
          fuzzy={isFuzzy(net.netClass)}
          quantitative={!!timeBase(net.netClass)}
          functionsAllowed={!isFaultTree(net.netClass)}
        />
      )}
    </aside>
  );
}

function csDefinition(c: ColourSetDecl): string {
  switch (c.type) {
    case "dot":
      return "dot";
    case "bool":
      return "false, true";
    case "enum":
    case "string":
      return (c.values ?? []).join(", ");
    case "int":
      return `${c.min ?? 0}..${c.max ?? 0}`;
    case "product":
      return (c.components ?? []).join(" * ");
    case "union":
      return (c.components ?? []).join(" | ");
    case "alias":
      return c.components?.[0] ?? "";
    case "subset":
      return `${c.components?.[0] ?? ""} with ${c.predicate ?? ""}`;
  }
}

function parseDefinition(
  type: ColourSetDecl["type"],
  text: string,
): Partial<ColourSetDecl> {
  switch (type) {
    case "dot":
    case "bool":
      return {};
    case "enum":
    case "string":
      return { values: text.split(/[\s,]+/).filter(Boolean) };
    case "int": {
      const m = text.match(/(-?\d+)\s*\.\.\s*(-?\d+)/);
      return m ? { min: Number(m[1]), max: Number(m[2]) } : { min: 0, max: 0 };
    }
    case "product":
      return { components: text.split(/[\s*,]+/).filter(Boolean) };
    case "union":
      return { components: text.split(/[\s|,]+/).filter(Boolean) };
    case "alias":
      return { components: [text.trim()] };
    case "subset": {
      const m = text.match(/^\s*(\w+)\s*(?:with|:)?\s*(.*)$/);
      return m
        ? { components: [m[1]], predicate: m[2].trim() }
        : { components: [], predicate: "" };
    }
  }
}

const CS_TYPES: {
  type: ColourSetDecl["type"];
  label: string;
  placeholder: string;
  defaults: Partial<ColourSetDecl>;
}[] = [
  { type: "dot", label: "dot", placeholder: "", defaults: {} },
  {
    type: "enum",
    label: "enum",
    placeholder: "red, green",
    defaults: { values: ["a", "b"] },
  },
  {
    type: "int",
    label: "int range",
    placeholder: "1..5",
    defaults: { min: 1, max: 3 },
  },
  { type: "bool", label: "bool", placeholder: "", defaults: {} },
  {
    type: "string",
    label: "string",
    placeholder: "in, out",
    defaults: { values: ["s1", "s2"] },
  },
  {
    type: "product",
    label: "product",
    placeholder: "A * B",
    defaults: { components: [] },
  },
  {
    type: "union",
    label: "union",
    placeholder: "A | B",
    defaults: { components: [] },
  },
  {
    type: "alias",
    label: "alias",
    placeholder: "Other set",
    defaults: { components: [] },
  },
  {
    type: "subset",
    label: "subset",
    placeholder: "Base with x > 2",
    defaults: { components: [], predicate: "" },
  },
];

function functionText(f: FunctionDecl): string {
  return `${f.name}(${f.params.join(", ")}) = ${f.body}`;
}

function parseFunction(text: string): FunctionDecl | null {
  const m = text.match(/^\s*([A-Za-z_]\w*)\s*\(([^)]*)\)\s*=\s*(.*)$/);
  if (!m) return null;
  return {
    name: m[1],
    params: m[2]
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    body: m[3].trim(),
  };
}

/** A text row that keeps what the user typed until it parses. */
function DraftInput({
  value,
  parse,
  onCommit,
  placeholder,
  label,
}: {
  value: string;
  parse: (t: string) => boolean;
  onCommit: (t: string) => void;
  placeholder?: string;
  label: string;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const bad = draft !== null && !parse(draft);
  return (
    <input
      className={`mono ${bad ? "invalid" : ""}`}
      aria-label={label}
      value={draft ?? value}
      placeholder={placeholder}
      title={bad ? "Not valid yet: keep typing" : undefined}
      onChange={(e) => {
        setDraft(e.target.value);
        if (parse(e.target.value)) onCommit(e.target.value);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

function AddButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="add-btn"
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden>+</span> {children}
    </button>
  );
}

function RemoveButton({
  onClick,
  what,
}: {
  onClick: () => void;
  what: string;
}) {
  return (
    <button
      type="button"
      className="icon remove"
      title={`Remove ${what}`}
      aria-label={`Remove ${what}`}
      onClick={onClick}
    >
      ×
    </button>
  );
}

function DeclarationsEditor({
  decl,
  readOnly,
  colours,
  fuzzy,
  quantitative,
  functionsAllowed = true,
}: {
  decl: Declarations;
  readOnly: boolean;
  colours: boolean;
  fuzzy: boolean;
  quantitative: boolean;
  functionsAllowed?: boolean;
}) {
  const setDecl = (d: Partial<Declarations>, key?: string) =>
    updateNet({ declarations: { ...decl, ...d } }, key);
  const functions = decl.functions ?? [];
  const observers = decl.observers ?? [];

  return (
    <fieldset disabled={readOnly} className="decl">
      {colours && (
        <>
          <h3>Colour sets</h3>
          <table className="decl-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Values</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {decl.colourSets.map((c, i) => {
                const info =
                  CS_TYPES.find((t) => t.type === c.type) ?? CS_TYPES[0];
                return (
                  <tr key={i}>
                    <td>
                      <input
                        aria-label="Colour set name"
                        value={c.name}
                        onChange={(e) =>
                          setDecl(
                            {
                              colourSets: decl.colourSets.map((x, j) =>
                                j === i ? { ...x, name: e.target.value } : x,
                              ),
                            },
                            `cs-${i}-name`,
                          )
                        }
                      />
                    </td>
                    <td>
                      <select
                        aria-label="Colour set type"
                        value={c.type}
                        onChange={(e) => {
                          const t = CS_TYPES.find(
                            (x) => x.type === e.target.value,
                          )!;
                          setDecl({
                            colourSets: decl.colourSets.map((x, j) =>
                              j === i
                                ? { name: c.name, type: t.type, ...t.defaults }
                                : x,
                            ),
                          });
                        }}
                      >
                        {CS_TYPES.map((t) => (
                          <option key={t.type} value={t.type}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {c.type === "dot" || c.type === "bool" ? (
                        <input
                          className="mono"
                          disabled
                          value={csDefinition(c)}
                          aria-label="Values"
                        />
                      ) : (
                        <DraftInput
                          key={`${i}-${c.type}`}
                          label="Values"
                          value={csDefinition(c)}
                          placeholder={info.placeholder}
                          parse={() => true}
                          onCommit={(t) =>
                            setDecl(
                              {
                                colourSets: decl.colourSets.map((x, j) =>
                                  j === i
                                    ? {
                                        name: x.name,
                                        type: x.type,
                                        // A T-APN's complementary set stays tied to its identity set.
                                        ...(x.complementOf ? { complementOf: x.complementOf } : {}),
                                        ...parseDefinition(x.type, t),
                                      }
                                    : x,
                                ),
                              },
                              `cs-${i}-def`,
                            )
                          }
                        />
                      )}
                    </td>
                    <td>
                      <RemoveButton
                        what={`colour set ${c.name}`}
                        onClick={() =>
                          setDecl({
                            colourSets: decl.colourSets.filter(
                              (_, j) => j !== i,
                            ),
                          })
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <AddButton
            onClick={() =>
              setDecl({
                colourSets: [
                  ...decl.colourSets,
                  {
                    name: `Colour${decl.colourSets.length}`,
                    type: "enum",
                    values: ["red", "green"],
                  },
                ],
              })
            }
          >
            Add colour set
          </AddButton>

          <h3>Variables</h3>
          <table className="decl-table">
            <tbody>
              {decl.variables.map((v, i) => (
                <tr key={i}>
                  <td>
                    <input
                      aria-label="Variable name"
                      value={v.name}
                      onChange={(e) =>
                        setDecl(
                          {
                            variables: decl.variables.map((x, j) =>
                              j === i ? { ...x, name: e.target.value } : x,
                            ),
                          },
                          `var-${i}`,
                        )
                      }
                    />
                  </td>
                  <td>
                    <select
                      aria-label="Variable colour set"
                      value={v.colourSet}
                      onChange={(e) =>
                        setDecl({
                          variables: decl.variables.map((x, j) =>
                            j === i ? { ...x, colourSet: e.target.value } : x,
                          ),
                        })
                      }
                    >
                      {decl.colourSets.map((c) => (
                        <option key={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <RemoveButton
                      what={`variable ${v.name}`}
                      onClick={() =>
                        setDecl({
                          variables: decl.variables.filter((_, j) => j !== i),
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <AddButton
            disabled={!decl.colourSets.length}
            onClick={() => {
              const names = new Set(decl.variables.map((v) => v.name));
              const name =
                ["x", "y", "z", "u", "v", "w"].find((n) => !names.has(n)) ??
                `v${decl.variables.length}`;
              setDecl({
                variables: [
                  ...decl.variables,
                  {
                    name,
                    colourSet: decl.colourSets[decl.colourSets.length - 1].name,
                  },
                ],
              });
            }}
          >
            Add variable
          </AddButton>
        </>
      )}

      <h3>Constants</h3>
      <p className="muted small">
        {fuzzy ? "Use TFN(low, peak, high) for a fuzzy number. " : ""}Use
        constants in markings, weights and rates.
      </p>
      {decl.constants.length > 0 && (
        <table className="decl-table">
          <tbody>
            {decl.constants.map((c, i) => (
              <tr key={i}>
                <td>
                  <input
                    aria-label="Constant name"
                    value={c.name}
                    onChange={(e) =>
                      setDecl(
                        {
                          constants: decl.constants.map((x, j) =>
                            j === i ? { ...x, name: e.target.value } : x,
                          ),
                        },
                        `const-${i}-n`,
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    aria-label="Constant value"
                    className="mono"
                    value={c.value}
                    onChange={(e) =>
                      setDecl(
                        {
                          constants: decl.constants.map((x, j) =>
                            j === i ? { ...x, value: e.target.value } : x,
                          ),
                        },
                        `const-${i}-v`,
                      )
                    }
                  />
                </td>
                <td>
                  <RemoveButton
                    what={`constant ${c.name}`}
                    onClick={() =>
                      setDecl({
                        constants: decl.constants.filter((_, j) => j !== i),
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <AddButton
        onClick={() => {
          const names = new Set(decl.constants.map((c) => c.name));
          let k = decl.constants.length;
          while (names.has(`N${k}`)) k++;
          setDecl({
            constants: [...decl.constants, { name: `N${k}`, value: "1" }],
          });
        }}
      >
        Add constant
      </AddButton>

      {functionsAllowed && (
        <>
          <h3>Functions</h3>
          <p className="muted small">
            Define once, use in rates, weights and inscriptions, e.g. hill(S, K,
            n) = S^n / (K^n + S^n).
          </p>
          {functions.map((f, i) => (
            <div className="decl-row" key={i}>
              <DraftInput
                label="Function"
                value={functionText(f)}
                placeholder="name(a, b) = a * b"
                parse={(t) => !!parseFunction(t)}
                onCommit={(t) =>
                  setDecl(
                    {
                      functions: functions.map((x, j) =>
                        j === i ? parseFunction(t)! : x,
                      ),
                    },
                    `fn-${i}`,
                  )
                }
              />
              <RemoveButton
                what={`function ${f.name}`}
                onClick={() =>
                  setDecl({ functions: functions.filter((_, j) => j !== i) })
                }
              />
            </div>
          ))}
          <AddButton
            onClick={() => {
              const names = new Set(functions.map((f) => f.name));
              let k = functions.length;
              while (names.has(`f${k}`)) k++;
              setDecl({
                functions: [
                  ...functions,
                  { name: `f${k}`, params: ["x"], body: "x" },
                ],
              });
            }}
          >
            Add function
          </AddButton>
        </>
      )}

      {quantitative && (
        <>
          <h3>Observers</h3>
          <p className="muted small">
            Extra curves for the plot: an expression over place markings, or
            over transition rates.
          </p>
          {observers.length > 0 && (
            <table className="decl-table obs-table">
              <tbody>
                {observers.map((o, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        aria-label="Observer name"
                        value={o.name}
                        onChange={(e) =>
                          setDecl(
                            {
                              observers: observers.map((x, j) =>
                                j === i ? { ...x, name: e.target.value } : x,
                              ),
                            },
                            `obs-${i}-n`,
                          )
                        }
                      />
                    </td>
                    <td>
                      <select
                        aria-label="Observer kind"
                        value={o.kind}
                        onChange={(e) =>
                          setDecl({
                            observers: observers.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    kind: e.target
                                      .value as ObserverDecl["kind"],
                                  }
                                : x,
                            ),
                          })
                        }
                      >
                        <option value="place">places</option>
                        <option value="transition">rates</option>
                      </select>
                    </td>
                    <td>
                      <input
                        aria-label="Observer expression"
                        className="mono"
                        value={o.expression}
                        placeholder={o.kind === "place" ? "A + B" : "t1 + t2"}
                        onChange={(e) =>
                          setDecl(
                            {
                              observers: observers.map((x, j) =>
                                j === i
                                  ? { ...x, expression: e.target.value }
                                  : x,
                              ),
                            },
                            `obs-${i}-e`,
                          )
                        }
                      />
                    </td>
                    <td>
                      <RemoveButton
                        what={`observer ${o.name}`}
                        onClick={() =>
                          setDecl({
                            observers: observers.filter((_, j) => j !== i),
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <AddButton
            onClick={() =>
              setDecl({
                observers: [
                  ...observers,
                  {
                    name: `Obs${observers.length}`,
                    kind: "place",
                    expression: "",
                  },
                ],
              })
            }
          >
            Add observer
          </AddButton>
        </>
      )}
    </fieldset>
  );
}

// ---------- shared pieces ----------

export function ColorPicker({
  ids,
  label = "Colour",
}: {
  ids: string[];
  label?: string;
}) {
  const net = useStore((s) => s.net);
  const current = [
    ...net.places,
    ...net.transitions,
    ...net.arcs,
    ...(net.notes ?? []),
    ...(net.faultTree?.nodes ?? []),
  ].find((x) => x.id === ids[0])?.color;
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="swatches">
        {NODE_COLORS.map((c) => (
          <button
            key={c.name}
            type="button"
            className={`swatch ${current === c.value ? "on" : ""}`}
            title={c.name}
            aria-label={`${label} ${c.name}`}
            style={{ background: c.value ?? "var(--node-fill)" }}
            onClick={() => setColor(ids, c.value)}
          />
        ))}
        <input
          type="color"
          title="Custom colour"
          aria-label="Custom colour"
          value={
            current && /^#[0-9a-f]{6}$/i.test(current) ? current : "#ffffff"
          }
          onChange={(e) => setColor(ids, e.target.value)}
        />
      </div>
    </div>
  );
}

const KIND_HELP: Record<TransitionKind, string> = {
  stochastic:
    "Fires after an exponentially distributed delay. The rate may depend on the marking.",
  immediate:
    "Fires as soon as it is enabled, before any timed transition. The value is its weight when several compete.",
  deterministic: "Fires after a fixed delay once enabled.",
  scheduled: "Fires at fixed times: start, repetition interval, end.",
  continuous:
    "A continuous flow; the rate is the speed of the flow (an ODE term).",
};

const RATE_LABEL: Record<TransitionKind, string> = {
  stochastic: "Rate function",
  immediate: "Weight",
  deterministic: "Delay",
  scheduled: "Schedule",
  continuous: "Rate function",
};

const RATE_HINT: Record<TransitionKind, string> = {
  stochastic:
    "MassAction(k), or any expression of constants and place names, e.g. k * P1. Also MichaelisMenten(vmax, km).",
  immediate: "A number, e.g. 1",
  deterministic: "A time, e.g. 2.5",
  scheduled: "start, repetition, end — e.g. 0, 10, 100",
  continuous:
    "MassAction(k), MichaelisMenten(vmax, km), or an expression like k * P1 * P2",
};

function TransitionTiming({ id }: { id: string }) {
  const net = useStore((s) => s.net);
  const t = net.transitions.find((x) => x.id === id)!;
  const tb = timeBase(net.netClass)!;
  const kinds: TransitionKind[] =
    tb === "continuous"
      ? ["continuous"]
      : tb === "hybrid"
        ? [
            "stochastic",
            "continuous",
            "immediate",
            "deterministic",
            "scheduled",
          ]
        : ["stochastic", "immediate", "deterministic", "scheduled"];
  const kind = t.kind ?? kinds[0];
  return (
    <>
      {kinds.length > 1 && (
        <Field label="Kind" hint={KIND_HELP[kind]}>
          <select
            value={kind}
            onChange={(e) => {
              const k = e.target.value as TransitionKind;
              const rate =
                k === "immediate"
                  ? "1"
                  : k === "deterministic"
                    ? "1"
                    : k === "scheduled"
                      ? "0, 1, 10"
                      : t.rate && /\(|[a-z]/i.test(t.rate)
                        ? t.rate
                        : "MassAction(1)";
              updateTransition(id, { kind: k, rate });
            }}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k[0].toUpperCase() + k.slice(1)}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label={RATE_LABEL[kind]} hint={RATE_HINT[kind]}>
        <input
          className="mono"
          value={t.rate ?? ""}
          placeholder="MassAction(1)"
          onChange={(e) =>
            updateTransition(id, { rate: e.target.value }, `rate-${id}`)
          }
          data-testid="rate-input"
        />
      </Field>
    </>
  );
}

function SoundFields({ id }: { id: string }) {
  const t = useStore((s) => s.net.transitions.find((x) => x.id === id))!;
  const sound = t.sound ?? {
    note: "C4",
    duration: 0.3,
    instrument: "piano" as const,
  };
  const set = (p: Partial<typeof sound>) =>
    updateTransition(id, { sound: { ...sound, ...p } });
  return (
    <>
      <Field label="Note" hint="Played when the transition fires">
        <div className="pair">
          <select
            value={sound.note}
            onChange={(e) => set({ note: e.target.value })}
          >
            {NOTE_NAMES.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <button
            type="button"
            className="small"
            onClick={() =>
              playNote(
                sound.note,
                sound.duration ?? 0.3,
                sound.instrument ?? "piano",
              )
            }
          >
            ▶ Play
          </button>
        </div>
      </Field>
      <Field label="Sound">
        <div className="pair">
          <select
            value={sound.instrument ?? "piano"}
            onChange={(e) =>
              set({ instrument: e.target.value as typeof sound.instrument })
            }
          >
            {INSTRUMENTS.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <input
            type="number"
            min={0.05}
            max={4}
            step={0.05}
            aria-label="Duration in seconds"
            title="Duration (seconds)"
            value={sound.duration ?? 0.3}
            onChange={(e) => set({ duration: Number(e.target.value) || 0.3 })}
          />
          <span className="muted small">s</span>
        </div>
      </Field>
    </>
  );
}

const FT_TYPE_LABEL: Record<FTNodeType, string> = {
  top: "Top event",
  intermediate: "Intermediate event",
  basic: "Basic event",
  undeveloped: "Undeveloped event",
  and: "AND gate",
  or: "OR gate",
  xor: "XOR gate",
  not: "NOT gate",
  kofn: "k-out-of-n (voting) gate",
  pand: "Priority AND gate",
  inhibit: "Inhibit gate",
  cond: "Condition",
  spare: "Spare gate",
  fdep: "Functional dependency",
};

function FTNodeProps({ id, readOnly }: { id: string; readOnly: boolean }) {
  const net = useStore((s) => s.net);
  const n = net.faultTree!.nodes.find((x) => x.id === id)!;
  const inputs = net.faultTree!.edges.filter((e) => e.target === id).length;
  const eft = net.netClass === "extendedFaultTree";
  const types = (Object.keys(FT_TYPE_LABEL) as FTNodeType[]).filter(
    (t) => eft || !["pand", "spare", "fdep", "cond"].includes(t),
  );
  const k = (f: string) => `ft-${id}-${f}`;
  const leaf = n.type === "basic" || n.type === "undeveloped";
  return (
    <aside className="panel props">
      <h2>{FT_TYPE_LABEL[n.type]}</h2>
      <fieldset disabled={readOnly}>
        <Field label="Name">
          <input
            data-focus-name
            value={n.name}
            onChange={(e) =>
              updateFTNode(id, { name: e.target.value }, k("name"))
            }
          />
        </Field>
        <Field label="Type">
          <select
            value={n.type}
            onChange={(e) =>
              updateFTNode(id, {
                type: e.target.value as FTNodeType,
                k: e.target.value === "kofn" ? (n.k ?? 2) : n.k,
              })
            }
          >
            {types.map((t) => (
              <option key={t} value={t}>
                {FT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        {n.type === "kofn" && (
          <Field
            label="k (inputs that must fail)"
            hint={`This gate has ${inputs} input${inputs === 1 ? "" : "s"}`}
          >
            <input
              type="number"
              min={1}
              max={Math.max(1, inputs)}
              value={n.k ?? 2}
              onChange={(e) =>
                updateFTNode(
                  id,
                  { k: Math.max(1, Number(e.target.value) || 1) },
                  k("k"),
                )
              }
            />
          </Field>
        )}
        {leaf && (
          <>
            <Field
              label="Failure rate λ"
              hint="Failures per hour; the probability at time t is 1 − e^(−λt)"
            >
              <input
                className="mono"
                value={n.failureRate ?? ""}
                placeholder="e.g. 1e-4"
                onChange={(e) =>
                  updateFTNode(
                    id,
                    {
                      failureRate: e.target.value || undefined,
                      ...(e.target.value ? { probability: undefined } : {}),
                    },
                    k("lambda"),
                  )
                }
              />
            </Field>
            <Field
              label="Or a fixed probability"
              hint="Between 0 and 1; used when no rate is given"
            >
              <input
                className="mono"
                value={n.probability ?? ""}
                placeholder="e.g. 0.01"
                onChange={(e) =>
                  updateFTNode(
                    id,
                    {
                      probability: e.target.value || undefined,
                      ...(e.target.value ? { failureRate: undefined } : {}),
                    },
                    k("p"),
                  )
                }
              />
            </Field>
            {eft && (
              <Field label="Repair rate μ" hint="Repairs per hour">
                <input
                  className="mono"
                  value={n.repairRate ?? ""}
                  placeholder="none"
                  onChange={(e) =>
                    updateFTNode(
                      id,
                      { repairRate: e.target.value || undefined },
                      k("mu"),
                    )
                  }
                />
              </Field>
            )}
          </>
        )}
        {!leaf && (
          <p className="muted small">
            Inputs: {inputs}. Drag the + handle below this node down to an event
            to add an input.
          </p>
        )}
        <ColorPicker ids={[id]} />
        <Field label="Comment">
          <textarea
            rows={3}
            value={n.comment ?? ""}
            onChange={(e) =>
              updateFTNode(id, { comment: e.target.value || undefined }, k("c"))
            }
          />
        </Field>
      </fieldset>
      <Problems id={id} />
    </aside>
  );
}

function plural(n: number, one: string, many = one + "s") {
  return `${n} ${n === 1 ? one : many}`;
}
