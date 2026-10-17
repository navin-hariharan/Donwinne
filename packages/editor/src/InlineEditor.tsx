import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isColoured } from "@pns/core";
import { PLACE_R, arcPath, ftSize, noteSize, pageView, polylineMid, transSize } from "./geometry";
import { endCoalesce, renameElement, toast, updateArc, updateNote, updatePlace, useStore } from "./store";

/** A text box placed over the canvas to edit a name, marking, inscription or note in place. */
export function InlineEditor() {
  const ie = useStore((s) => s.inlineEdit);
  const net = useStore((s) => s.net);
  const page = useStore((s) => s.page);
  const view = useStore((s) => s.view);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [key, setKey] = useState("");
  /** Set once the edit is saved or cancelled, so the blur that follows closing doesn't save it (again). */
  const done = useRef(false);
  const pendingSelect = useRef(false);

  const p = ie ? net.places.find((x) => x.id === ie.id) : undefined;
  const t = ie ? net.transitions.find((x) => x.id === ie.id) : undefined;
  const a = ie ? net.arcs.find((x) => x.id === ie.id) : undefined;
  const n = ie ? net.notes?.find((x) => x.id === ie.id) : undefined;
  const f = ie ? net.faultTree?.nodes.find((x) => x.id === ie.id) : undefined;

  const initial = !ie
    ? ""
    : ie.field === "name"
      ? p?.name ?? t?.name ?? f?.name ?? ""
      : ie.field === "marking"
        ? p?.marking ?? ""
        : ie.field === "inscription"
          ? a?.inscription ?? ""
          : ie.field === "note"
            ? n?.text ?? ""
            : t?.rate ?? "";

  const thisKey = ie ? `${ie.id}:${ie.field}` : "";
  useEffect(() => {
    if (thisKey !== key) {
      setKey(thisKey);
      setValue(initial);
      done.current = false;
      pendingSelect.current = true;
    }
  }, [thisKey, key, initial]);
  // Select the whole text once it is in the box, so typing replaces it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!pendingSelect.current || !el || el.value !== initial) return;
    pendingSelect.current = false;
    el.focus();
    el.select();
  });

  // The on-screen keyboard may cover the box: pan the canvas so it stays in the visible part of the screen.
  const active = !!ie;
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return;
    const keepVisible = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const bottom = vv.offsetTop + vv.height - 12;
      const top = vv.offsetTop + 12;
      let dy = 0;
      if (r.bottom > bottom) dy = bottom - r.bottom;
      else if (r.top < top) dy = top - r.top;
      if (Math.abs(dy) < 1) return;
      const v = useStore.getState().view;
      useStore.setState({ view: { ...v, y: v.y + dy } });
    };
    // Keyboards slide in: check once now and again whenever the visible area changes.
    const t = setTimeout(keepVisible, 350);
    vv.addEventListener("resize", keepVisible);
    return () => {
      clearTimeout(t);
      vv.removeEventListener("resize", keepVisible);
    };
  }, [active, thisKey]);

  if (!ie) return null;

  // World position of the editor.
  let x = 0;
  let y = 0;
  let width = 120;
  let multiline = false;
  if (ie.field === "name" && p) {
    const lo = p.labelOffset ?? { x: 0, y: 0 };
    x = p.x + lo.x;
    y = p.y + PLACE_R + 11 + lo.y;
  } else if (ie.field === "marking" && p) {
    x = p.x;
    y = p.y;
    width = isColoured(net.netClass) ? 200 : 70;
  } else if (ie.field === "name" && t) {
    const lo = t.labelOffset ?? { x: 0, y: 0 };
    x = t.x + lo.x;
    y = t.y - transSize(t).h / 2 - 11 + lo.y;
  } else if (ie.field === "name" && f) {
    x = f.x;
    y = f.type === "top" || f.type === "intermediate" ? f.y : f.y + ftSize(f).h / 2 + 12;
  } else if (ie.field === "inscription" && a) {
    const pts = arcPath(pageView(net, page).net, a);
    if (!pts) return null;
    const mid = polylineMid(pts).p;
    x = mid.x;
    y = mid.y - 12;
    width = isColoured(net.netClass) ? 180 : 80;
  } else if (ie.field === "note" && n) {
    const sz = noteSize(n);
    x = n.x + Math.max(sz.w, 180) / 2;
    y = n.y + Math.max(sz.h, 60) / 2;
    width = Math.max(sz.w, 180);
    multiline = true;
  } else return null;

  const close = () => {
    done.current = true;
    useStore.setState({ inlineEdit: null });
    endCoalesce();
    document.querySelector<SVGSVGElement>("svg.canvas")?.focus();
  };

  const commit = () => {
    if (done.current) return;
    const v = value;
    if (v !== initial) {
      if (ie.field === "name") {
        if (!v.trim()) {
          toast("A name can't be empty", "error");
          return close();
        }
        renameElement(ie.id, v.trim());
      } else if (ie.field === "marking") updatePlace(ie.id, { marking: v.trim() });
      else if (ie.field === "inscription") updateArc(ie.id, { inscription: v.trim() });
      else if (ie.field === "note") updateNote(ie.id, { text: v });
    }
    close();
  };

  const sx = x * view.zoom + view.x;
  const sy = y * view.zoom + view.y;
  const style: React.CSSProperties = {
    left: sx - width / 2,
    top: sy - (multiline ? 40 : 13),
    width,
  };
  const placeholder =
    ie.field === "marking" ? (isColoured(net.netClass) ? "e.g. 2`a ++ b" : "tokens") : ie.field === "inscription" ? (isColoured(net.netClass) ? "e.g. x ++ y" : "weight") : "";
  const common = {
    ref,
    className: "inline-editor",
    style,
    value,
    placeholder,
    spellCheck: false,
    autoCapitalize: "off",
    autoCorrect: "off",
    enterKeyHint: multiline ? undefined : ("done" as const),
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setValue(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") close();
      if (e.key === "Enter" && (!multiline || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        commit();
      }
      if (ie.field === "marking" && !isColoured(net.netClass) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const cur = Number(value || 0) || 0;
        setValue(String(Math.max(0, cur + (e.key === "ArrowUp" ? 1 : -1))));
      }
    },
    "data-testid": "inline-editor",
  };
  return multiline ? <textarea {...common} style={{ ...style, height: 80 }} /> : <input {...common} />;
}
