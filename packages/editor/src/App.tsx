import React, { useEffect } from "react";
import { Canvas } from "./Canvas";
import { TopBar, ToolPalette } from "./Toolbar";
import { PropsSheet } from "./PropsSheet";
import { PropertiesPanel } from "./PropertiesPanel";
import { BottomPanel } from "./BottomPanel";
import { useSimulationRunner, stepRandom } from "./simulation";
import { cmdTransform, cmdUnfold, cmdExport, cmdExportPng, cmdExportPnml, cmdExportSvg, cmdImport, cmdImportPnml, cmdNew, cmdOpen, cmdPrint, cmdSave, openText } from "./fileOps";
import { Dialogs } from "./Dialogs";
import { Splitter } from "./Overlays";
import { UpdateBanner } from "./UpdateBanner";
import { autoLayout } from "./layout";
import { parentPage } from "./ContextMenu";
import {
  adjustTokens,
  duplicateSelection,
  enterPage,
  groupIntoSubnet,
  copySelection,
  cutSelection,
  deleteSelection,
  moveSelection,
  paste,
  redo,
  requestFit,
  selectAll,
  setTool,
  simGoto,
  startSimulation,
  stopSimulation,
  toast as showToast,
  undo,
  useStore,
} from "./store";
import { spacePan, zoomBy, zoomToSelection } from "./Canvas";
import { MenuCommand, desktop } from "./platform";
import { propsDocked, useScreenClass, useVisualViewport } from "./responsive";
import { ArcKind, arcKindsFor, isAmbient, isFaultTree } from "@pns/core";
import { cmdConstructTapn, fireMaximalStep, openAmbientDialog } from "./ambient";
import { openDocs } from "./docs/DocsDialog";

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable;
}

/**
 * The key belongs to a focused control: Enter and Space press a button or link, and arrows move
 * within a menu, tab list or list box.
 */
function inControl(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (!t?.closest) return false;
  const control = "button, a[href], summary, [role=button], [role=menuitem], [role=tab], [role=option]";
  if (e.key === "Enter" && t.closest(control)) return true;
  // Space stays the token game's run key on the toolbar buttons (after clicking Simulate, say), and
  // presses buttons only in menus and windows.
  if (e.key === " " && t.closest(control) && t.closest("[role=dialog], [role=menu], .context-menu, .binding-picker")) return true;
  return e.key.startsWith("Arrow") && !!t.closest("[role=menu], [role=menubar], [role=tablist], [role=listbox], [role=radiogroup], .context-menu");
}

const ARC_KEYS: Record<string, ArcKind> = { "1": "normal", "2": "read", "3": "inhibitor", "4": "reset", "5": "equal", "6": "modifier" };

export function runCommand(c: MenuCommand) {
  switch (c) {
    case "new-pt":
      return cmdNew("pt");
    case "new-xpt":
      return cmdNew("xpt");
    case "new-coloured":
      return cmdNew("coloured");
    case "open":
      return cmdOpen();
    case "save":
      return cmdSave();
    case "save-as":
      return cmdSave(true);
    case "import-pnml":
      return cmdImportPnml();
    case "export-pnml":
      return cmdExportPnml();
    case "export-svg":
      return cmdExportSvg();
    case "export-png":
      return cmdExportPng();
    case "undo":
      return undo();
    case "redo":
      return redo();
    case "delete":
      return useStore.getState().mode === "edit" && deleteSelection();
    case "select-all":
      return selectAll();
    case "zoom-in":
      return zoomBy(1.25);
    case "zoom-out":
      return zoomBy(1 / 1.25);
    case "zoom-fit":
      return requestFit();
    case "zoom-selection":
      return zoomToSelection();
    case "about":
      return useStore.setState({ dialog: "about" });
    case "new":
      return useStore.setState({ dialog: "new" });
    case "import":
      return cmdImport();
    case "print":
      return cmdPrint();
    case "duplicate":
      return useStore.getState().mode === "edit" && duplicateSelection();
    case "find":
      return useStore.setState({ dialog: "search" });
    case "help":
      return useStore.setState({ dialog: "help" });
    case "layout":
      return void autoLayout();
    case "group":
      return useStore.getState().mode === "edit" && groupIntoSubnet("transition");
    case "toggle-minimap":
      return useStore.setState({ showMinimap: !useStore.getState().showMinimap });
    case "reachability":
      return useStore.setState({ dialog: "rg" });
    case "simulate":
      return useStore.getState().mode === "edit" ? startSimulation() : stopSimulation();
    case "unfold":
      return void cmdUnfold();
    case "reverse":
    case "dual":
      return cmdTransform(c);
    case "analyse":
      return useStore.setState({ dialog: "analysis" });
    case "elements":
      return useStore.setState({ bottomOpen: true, panel: "elements" });
    case "new-apn":
      return cmdNew("apn");
    case "ctl":
      return useStore.setState({ dialog: "ctl" });
    case "slice":
      return useStore.setState({ dialog: "slice" });
    case "framework":
      return useStore.setState({ dialog: "framework" });
    case "docs":
      return openDocs();
    case "ambient:crg":
      return openAmbientDialog("crg");
    case "ambient:props":
      return openAmbientDialog("apnProps");
    case "ambient:construct":
      return cmdConstructTapn();
    case "ambient:equivalence":
      return openAmbientDialog("equivalence");
    case "ambient:blocks":
      return openAmbientDialog("blocks");
    case "ambient:compose":
      return openAmbientDialog("compose");
  }
  if (c.startsWith("export:")) return cmdExport(c.slice(7));
}

export function App() {
  const toast = useStore((s) => s.toast);
  const theme = useStore((s) => s.theme);
  const dirty = useStore((s) => s.dirty);
  const fileName = useStore((s) => s.fileName);
  const netName = useStore((s) => s.net.name);
  useSimulationRunner();

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    // The browser and phone status bar take the panel colour of the theme in use. Following the
    // system, the page's own light and dark values apply.
    const panel = getComputedStyle(root).getPropertyValue("--panel").trim();
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
      if (!m.dataset.initial) m.dataset.initial = m.content;
      m.content = theme === "system" || !panel ? m.dataset.initial : panel;
    });
  }, [theme]);

  useEffect(() => {
    const title = `${dirty ? "• " : ""}${fileName ?? netName} — Donwinne`;
    document.title = title;
    desktop()?.setTitle(title);
    desktop()?.setDirty(dirty);
  }, [dirty, fileName, netName]);

  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (useStore.getState().dirty && !desktop()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);

  // Desktop menu and files opened from the OS.
  useEffect(() => {
    const d = desktop();
    if (!d) return;
    const off = d.onMenu(runCommand);
    const off2 = d.onOpenPath?.((f) => {
      if (useStore.getState().dirty && !window.confirm("Discard unsaved changes?")) return;
      openText(f.content, f.name, f.path);
    });
    return () => {
      off();
      off2?.();
    };
  }, []);

  // Keyboard shortcuts. In the desktop app the menu accelerators handle the Ctrl/Cmd ones.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const s = useStore.getState();
      if (mod) {
        const k = e.key.toLowerCase();
        if (desktop() && ["n", "o", "s", "z", "y", "a", "p", "d", "f", "g", "l"].includes(k)) {
          if (k === "a" && isTyping(e)) return;
          e.preventDefault();
          return; // handled by the native menu
        }
        if (isTyping(e) && ["z", "y", "a", "c", "x", "v"].includes(k)) return;
        if (k === "s") (e.preventDefault(), cmdSave(e.shiftKey));
        else if (k === "n") (e.preventDefault(), useStore.setState({ dialog: "new" }));
        else if (k === "p") (e.preventDefault(), cmdPrint());
        else if (k === "d") (e.preventDefault(), s.mode === "edit" && duplicateSelection());
        else if (k === "f") (e.preventDefault(), useStore.setState({ dialog: "search" }));
        else if (k === "g") (e.preventDefault(), s.mode === "edit" && groupIntoSubnet("transition"));
        else if (k === "l") (e.preventDefault(), void autoLayout());
        else if (k === "o") (e.preventDefault(), cmdOpen());
        else if (k === "z") (e.preventDefault(), e.shiftKey ? redo() : undo());
        else if (k === "y") (e.preventDefault(), redo());
        else if (k === "a") (e.preventDefault(), selectAll());
        else if (k === "c") copySelection();
        else if (k === "x") s.mode === "edit" && cutSelection();
        else if (k === "v") s.mode === "edit" && paste();
        else if (k === "=" || k === "+") (e.preventDefault(), zoomBy(1.25));
        else if (k === "-") (e.preventDefault(), zoomBy(1 / 1.25));
        else if (k === "0") (e.preventDefault(), requestFit());
        return;
      }
      if (e.key === "F1") {
        e.preventDefault();
        if (s.dialog !== "docs") openDocs();
        return;
      }
      if (isTyping(e)) return;
      // Keys meant for a focused button, link or menu work it, instead of renaming or moving the selection.
      if (inControl(e)) return;
      // An open context menu closes itself on Escape and takes the other keys.
      if (s.contextMenu) return;
      // Escape closes the find box even after focus has left it (after clicking a match), without
      // dropping the selection the click made.
      if (s.dialog === "search" && e.key === "Escape") return useStore.setState({ dialog: null });
      if (s.dialog && s.dialog !== "search") return;
      if (e.key === "?") return useStore.setState({ dialog: "help" });
      const kk = e.key.toLowerCase();
      if (kk === "m" && !e.altKey) return useStore.setState({ showMinimap: !s.showMinimap });
      if (kk === "b" && !e.altKey) return useStore.setState({ bottomOpen: !s.bottomOpen });
      if (s.mode === "simulate") {
        if (e.key === "ArrowLeft") simGoto(s.simIndex - 1);
        else if (e.key === "ArrowRight") simGoto(s.simIndex + 1);
        else if (e.key.toLowerCase() === "r") stepRandom();
        else if (e.key.toLowerCase() === "t") useStore.setState({ showTrail: !useStore.getState().showTrail });
        else if (e.key.toLowerCase() === "x" && isAmbient(s.net.netClass)) fireMaximalStep();
        // Space starts or stops auto-run when it is released (see onKeyUp), so holding it to pan doesn't.
        else if (e.key === " ") e.preventDefault();
        else if (e.key === "Escape") stopSimulation();
        else if (e.key.toLowerCase() === "f") e.shiftKey ? zoomToSelection() : requestFit();
        return;
      }
      const k = e.key.toLowerCase();
      if ((e.key === "Delete" || e.key === "Backspace") && s.selection.length) deleteSelection();
      else if (e.key === "Backspace" && s.page) enterPage(parentPage());
      // (The canvas handles Escape first while an arc is being drawn: then it only cancels the arc.)
      else if (e.key === "Escape" && !e.defaultPrevented) (setTool("select"), useStore.setState({ selection: [], highlight: [], ftFailed: [] }));
      else if ((e.key === "F2" || e.key === "Enter") && s.selection.length === 1) {
        e.preventDefault();
        const id = s.selection[0];
        const isArc = s.net.arcs.some((a) => a.id === id);
        const isNote = s.net.notes?.some((n) => n.id === id);
        const coarse = [...s.net.places, ...s.net.transitions].find((n) => n.id === id)?.coarse;
        if (e.key === "Enter" && coarse) enterPage(id);
        else useStore.setState({ inlineEdit: { id, field: isArc ? "inscription" : isNote ? "note" : "name" } });
      } else if ((e.key === "+" || e.key === "=" || e.key === "-" || e.key === "_") && s.selection.length) {
        // One undo step for all the selected places, however many there are.
        const key = `tokens-${s.selection.join(",")}`;
        for (const id of s.selection) if (s.net.places.some((p) => p.id === id)) adjustTokens(id, e.key === "+" || e.key === "=" ? 1 : -1, key);
      } else if (k === "n") setTool("note");
      else if (k === "g") useStore.setState({ snapToGrid: !s.snapToGrid });
      else if (k === "v") setTool("select");
      else if (k === "p" && !isFaultTree(s.net.netClass)) setTool("place");
      else if (k === "t" && !isFaultTree(s.net.netClass)) setTool("transition");
      else if (k === "a") setTool("arc");
      else if (k === "f") e.shiftKey ? zoomToSelection() : requestFit();
      else if (k === "s") startSimulation();
      else if (ARC_KEYS[e.key]) {
        // A P/T net offers every kind but modifier (drawing one makes it an extended net); other classes only their own.
        const kind = ARC_KEYS[e.key];
        const ok = s.net.netClass === "pt" ? kind !== "modifier" : arcKindsFor(s.net.netClass).includes(kind);
        if (ok) useStore.setState({ arcKind: kind, tool: "arc" });
        else showToast(`${kind[0].toUpperCase()}${kind.slice(1)} arcs are not available in this net class`);
      }
      else if (e.key.startsWith("Arrow") && s.selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        moveSelection(s.selection, dx, dy, "nudge");
      }
    };
    // Token game: a tap of Space starts or stops auto-run; holding it to drag the view does not.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== " " || spacePan.used || isTyping(e) || inControl(e)) return;
      const s = useStore.getState();
      if (s.mode !== "simulate" || s.contextMenu || (s.dialog && s.dialog !== "search")) return;
      useStore.setState({ running: !s.running });
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Drop a file onto the window to open it.
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = async (e: DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      if (useStore.getState().dirty && !window.confirm("Discard unsaved changes?")) return;
      openText(await f.text(), f.name);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  useVisualViewport();

  // Safari zooms the whole page on a pinch even where touch-action forbids it; the canvas has its own pinch zoom.
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", stop);
    return () => document.removeEventListener("gesturestart", stop);
  }, []);

  const screen = useScreenClass();
  const docked = propsDocked(screen);
  const mode = useStore((s) => s.mode);
  const propsWidth = useStore((s) => s.propsWidth);
  return (
    <div className={`app screen-${screen} mode-${mode}`} style={propsWidth ? ({ "--props-w": `${propsWidth}px` } as React.CSSProperties) : undefined}>
      <TopBar />
      <div className="main">
        <ToolPalette />
        <div className="center">
          <Canvas />
          <BottomPanel />
        </div>
        {docked ? (
          <>
            <PropsSplitter />
            <PropertiesPanel />
          </>
        ) : (
          <PropsSheet sheet={screen === "phone"} />
        )}
      </div>
      <Dialogs />
      <UpdateBanner />
      {toast && (
        <div className={`toast ${toast.kind}`} role="status" onClick={() => (toast.onClick ? toast.onClick() : useStore.setState({ toast: null }))}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

function PropsSplitter() {
  const w = useStore((s) => s.propsWidth);
  return (
    <Splitter
      axis="x"
      label="Resize the properties panel"
      value={w ?? 320}
      min={240}
      max={() => Math.min(Math.max(640, window.innerWidth * 0.35), window.innerWidth - 520)}
      onChange={(v) => useStore.setState({ propsWidth: v })}
    />
  );
}
