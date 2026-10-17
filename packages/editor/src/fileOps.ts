import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NET_CLASS_LABELS, Net, NetClass, isColoured, isFaultTree, timeBase } from "@pns/core";
import * as io from "@pns/io";
import { exportPnml, importPnmlWithWarnings, parseNet, serializeNet } from "@pns/io";
import { exportDnf, importDnf } from "@pns/ft";
import { unfold } from "@pns/sim";
import { autoLayout } from "./layout";
import { EXPORT_PALETTE, NetDrawing } from "./NetDrawing";
import { netBounds, pageView } from "./geometry";
import { compiled, currentMarking, loadNet, markSaved, newNet, toast, useStore } from "./store";
import { FileFilter, desktop } from "./platform";

const NET_FILTER: FileFilter[] = [{ name: "Donwinne model", extensions: ["pns.json", "json"] }];
const PNML_FILTER: FileFilter[] = [{ name: "PNML", extensions: ["pnml", "xml"] }];

function baseName(name: string | null, fallback: string): string {
  return (name ?? fallback).replace(/\.pns\.json$|\.json$|\.pnml$|\.xml$/i, "");
}

function confirmDiscard(): boolean {
  return !useStore.getState().dirty || window.confirm("Discard unsaved changes?");
}

// ---------- browser helpers ----------

type FsHandle = { name: string; getFile(): Promise<File>; createWritable(): Promise<{ write(d: unknown): Promise<void>; close(): Promise<void> }> };
const fsApi = typeof window !== "undefined" && "showSaveFilePicker" in window;

export function downloadText(name: string, data: string, type: string) {
  download(name, data, type);
}

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

// ---------- commands ----------

export function cmdNew(netClass: NetClass) {
  if (!confirmDiscard()) return;
  newNet(netClass);
}

export function cmdOpenExample(net: Net) {
  if (!confirmDiscard()) return;
  // structuredClone arrived in Safari 15.4; a net is plain JSON, so older browsers copy it through JSON.
  loadNet(typeof structuredClone === "function" ? structuredClone(net) : (JSON.parse(JSON.stringify(net)) as Net), null);
}

export function openText(text: string, name: string, path: string | null = null, handle: unknown = null) {
  try {
    const { net, warnings, native } = importAny(text, name);
    if (native) {
      loadNet(net, name, path, handle);
      toast(`Opened ${name}`);
    } else {
      loadNet(net, null, null);
      useStore.setState({ dirty: true });
      toast(warnings.length ? `Imported ${name} with ${warnings.length} warning(s): ${warnings[0]}` : `Imported ${name}`);
    }
  } catch (e) {
    toast(`Could not open ${name}: ${(e as Error).message}`, "error");
  }
}

export async function cmdOpen() {
  if (!confirmDiscard()) return;
  const d = desktop();
  if (d) {
    const f = await d.openFile([...NET_FILTER, ...PNML_FILTER]);
    if (f) openText(f.content, f.name, f.path);
    return;
  }
  if (fsApi) {
    try {
      const [h] = await (window as unknown as { showOpenFilePicker(o: unknown): Promise<FsHandle[]> }).showOpenFilePicker({
        types: [{ description: "Petri net", accept: { "application/json": [".json"], "application/xml": [".pnml", ".xml"] } }],
      });
      const file = await h.getFile();
      openText(await file.text(), file.name, null, file.name.endsWith(".json") ? h : null);
    } catch {
      /* cancelled */
    }
    return;
  }
  const file = await pickFile(".json,.pnml,.xml");
  if (file) openText(await file.text(), file.name);
}

export async function cmdImportPnml() {
  if (!confirmDiscard()) return;
  const d = desktop();
  if (d) {
    const f = await d.openFile(PNML_FILTER);
    if (f) openText(f.content, f.name);
    return;
  }
  const file = await pickFile(".pnml,.xml");
  if (file) openText(await file.text(), file.name);
}

export async function cmdSave(saveAs = false) {
  const s = useStore.getState();
  const content = serializeNet(s.net);
  const suggested = `${baseName(s.fileName, s.net.name || "net")}.pns.json`;
  const d = desktop();
  if (d) {
    const r = await d.saveFile(saveAs ? null : s.filePath, content, suggested, NET_FILTER);
    if (r) {
      markSaved(r.name, r.path);
      toast(`Saved ${r.name}`);
    }
    return;
  }
  if (fsApi) {
    try {
      let h = (saveAs ? null : (s.fileHandle as FsHandle | null)) ?? null;
      if (!h) {
        h = await (window as unknown as { showSaveFilePicker(o: unknown): Promise<FsHandle> }).showSaveFilePicker({
          suggestedName: suggested,
          types: [{ description: "Donwinne model", accept: { "application/json": [".json"] } }],
        });
      }
      const w = await h.createWritable();
      await w.write(content);
      await w.close();
      markSaved(h.name, null, h);
      toast(`Saved ${h.name}`);
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast(`Could not save: ${(e as Error).message}`, "error");
    }
    return;
  }
  download(suggested, content, "application/json");
  markSaved(suggested, null);
}

async function exportData(name: string, data: string | Uint8Array, type: string, filters: FileFilter[]) {
  const d = desktop();
  if (d) {
    if (await d.exportFile(name, data, filters)) toast(`Exported ${name}`);
    return;
  }
  download(name, data as BlobPart, type);
}

export async function cmdExportPnml() {
  const s = useStore.getState();
  try {
    await exportData(`${baseName(s.fileName, s.net.name || "net")}.pnml`, exportPnml(s.net), "application/xml", PNML_FILTER);
  } catch (e) {
    toast(`Could not export PNML: ${(e as Error).message}`, "error");
  }
}

/** Standalone SVG of the net, with the simulation marking if one is showing. */
export function netSvg(full: Net, page: string | null = useStore.getState().page): string {
  const cn = compiled(full);
  const pv = pageView(full, page);
  const net = pv.net;
  const b = netBounds(net, 24);
  const body = renderToStaticMarkup(
    React.createElement(NetDrawing, { net, cn, palette: EXPORT_PALETTE, marking: currentMarking() ?? undefined, ghosts: pv.ghosts }),
  );
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(b.w)}" height="${Math.ceil(b.h)}" viewBox="${b.x} ${b.y} ${b.w} ${b.h}">` +
    `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#ffffff"/>${body}</svg>`
  );
}

export async function cmdExportSvg() {
  const s = useStore.getState();
  await exportData(`${baseName(s.fileName, s.net.name || "net")}.svg`, netSvg(s.net), "image/svg+xml", [{ name: "SVG image", extensions: ["svg"] }]);
}

export async function cmdExportPng(scale = 2) {
  const s = useStore.getState();
  const svg = netSvg(s.net);
  const b = netBounds(pageView(s.net, s.page).net, 24);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("Could not render the image"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(b.w * scale);
    canvas.height = Math.ceil(b.h * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, b.w, b.h);
    const blob: Blob = await new Promise((res, rej) => canvas.toBlob((x) => (x ? res(x) : rej(new Error("PNG encoding failed"))), "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await exportData(`${baseName(s.fileName, s.net.name || "net")}.png`, bytes, "image/png", [{ name: "PNG image", extensions: ["png"] }]);
  } catch (e) {
    toast((e as Error).message, "error");
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- other formats ----------

type IoFn = (net: Net) => string;
/** Look up an exporter by name, so formats appear as soon as the io package provides them. */
function ioFn(name: string): IoFn | undefined {
  const f = (io as unknown as Record<string, unknown>)[name];
  return typeof f === "function" ? (f as IoFn) : undefined;
}

export function snoopyExtension(net: Net): string {
  return io.snoopyExtension(net.netClass, net);
}

export interface ExportFormat {
  id: string;
  label: string;
  ext: (net: Net) => string;
  type: string;
  applies: (c: NetClass) => boolean;
  run: (net: Net) => string | Promise<string | Uint8Array> | null;
}

const petri = (c: NetClass) => !isFaultTree(c) && c !== "freestyle";
const plain = (c: NetClass) => petri(c) && !isColoured(c);
const discrete = (c: NetClass) => ["pt", "xpt", "timed", "stochastic", "music"].includes(c);

export const EXPORT_FORMATS: ExportFormat[] = [
  { id: "snoopy", label: "Snoopy file", ext: (n) => snoopyExtension(n), type: "application/xml", applies: () => !!ioFn("exportSnoopy"), run: (n) => ioFn("exportSnoopy")!(n) },
  { id: "pnml", label: "PNML", ext: () => "pnml", type: "application/xml", applies: petri, run: (n) => exportPnml(n) },
  { id: "andl", label: "ANDL (Charlie, Marcie, Spike)", ext: () => "andl", type: "text/plain", applies: (c) => plain(c) && !!ioFn("exportAndl"), run: (n) => ioFn("exportAndl")!(n) },
  { id: "candl", label: "CANDL (coloured ANDL)", ext: () => "candl", type: "text/plain", applies: (c) => isColoured(c) && !!ioFn("exportCandl"), run: (n) => ioFn("exportCandl")!(n) },
  { id: "lola", label: "LoLA", ext: () => "lola", type: "text/plain", applies: (c) => discrete(c) && !!ioFn("exportLola"), run: (n) => ioFn("exportLola")!(n) },
  { id: "tina", label: "TINA (.net)", ext: () => "net", type: "text/plain", applies: (c) => discrete(c) && !!ioFn("exportTina"), run: (n) => ioFn("exportTina")!(n) },
  { id: "apnn", label: "APNN", ext: () => "apnn", type: "text/plain", applies: (c) => discrete(c) && !!ioFn("exportApnn"), run: (n) => ioFn("exportApnn")!(n) },
  { id: "prism", label: "PRISM model", ext: () => "sm", type: "text/plain", applies: (c) => c === "stochastic" && !!ioFn("exportPrism"), run: (n) => ioFn("exportPrism")!(n) },
  { id: "sbml", label: "SBML", ext: () => "sbml", type: "application/xml", applies: (c) => plain(c) && !!timeBase(c) && !!ioFn("exportSbml"), run: (n) => ioFn("exportSbml")!(n) },
  { id: "csv", label: "Declarations as CSV", ext: () => "csv", type: "text/csv", applies: (c) => petri(c) && !!ioFn("exportCsvDeclarations"), run: (n) => ioFn("exportCsvDeclarations")!(n) },
  { id: "dnf", label: "Minimal cut sets (DNF)", ext: () => "dnf.txt", type: "text/plain", applies: isFaultTree, run: (n) => exportDnf(n) },
  { id: "tikz", label: "LaTeX (TikZ picture)", ext: () => "tex", type: "text/x-tex", applies: () => true, run: (n) => netTikz(n) },
  { id: "svg", label: "SVG image", ext: () => "svg", type: "image/svg+xml", applies: () => true, run: (n) => netSvg(n) },
  { id: "png", label: "PNG image", ext: () => "png", type: "image/png", applies: () => true, run: () => null },
];

const dryRuns = new WeakMap<Net, Map<string, string | null>>();

/**
 * Why a format can't hold this net, found by trying the export (formats raise an error naming what they
 * can't express). null = it exports fine. Image formats always work and aren't tried.
 */
export function exportProblem(id: string, net: Net): string | null {
  if (id === "png" || id === "svg" || id === "tikz") return null;
  let m = dryRuns.get(net);
  if (!m) dryRuns.set(net, (m = new Map()));
  if (m.has(id)) return m.get(id)!;
  const f = EXPORT_FORMATS.find((x) => x.id === id);
  let problem: string | null = null;
  try {
    const r = f?.run(net);
    if (r && typeof (r as Promise<unknown>).then === "function") (r as Promise<unknown>).catch(() => undefined);
  } catch (e) {
    problem = (e as Error).message;
  }
  m.set(id, problem);
  return problem;
}

export async function cmdExport(id: string) {
  if (id === "png") return cmdExportPng();
  const f = EXPORT_FORMATS.find((x) => x.id === id);
  if (!f) return;
  const s = useStore.getState();
  try {
    const data = await f.run(s.net);
    if (data === null) return;
    const name = `${baseName(s.fileName, s.net.name || "net")}.${f.ext(s.net)}`;
    await exportData(name, data, f.type, [{ name: f.label, extensions: [f.ext(s.net).split(".").pop()!] }]);
  } catch (e) {
    toast(`Could not export ${f.label}: ${(e as Error).message}`, "error");
  }
}

const IMPORT_EXTS = ["pns.json", "json", "pnml", "xml", "andl", "candl", "dnf", "txt", ...io.SNOOPY_EXTENSIONS];

/** Open anything we can read: native, Snoopy, PNML, ANDL or a DNF fault tree. */
export async function cmdImport() {
  if (!confirmDiscard()) return;
  const d = desktop();
  if (d) {
    const f = await d.openFile([{ name: "Models", extensions: IMPORT_EXTS }]);
    if (f) openText(f.content, f.name, f.path);
    return;
  }
  const file = await pickFile(IMPORT_EXTS.map((e) => `.${e}`).join(","));
  if (file) openText(await file.text(), file.name);
}

/** Turn imported text into a net, whatever its format. Returns warnings. */
export function importAny(text: string, name: string): { net: Net; warnings: string[]; native: boolean } {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{")) return { net: parseNet(text), warnings: [], native: true };
  if (trimmed.startsWith("<")) {
    if (/<Snoopy[\s>]/i.test(trimmed.slice(0, 2000)) || /^<\?xml[^>]*>\s*(<!--[\s\S]*?-->\s*)*<Snoopy/i.test(trimmed)) {
      const r = io.importSnoopy(text, undefined, { name: baseName(name, "net").replace(/\.[a-z]+$/i, "") });
      return { net: r.net, warnings: r.warnings, native: false };
    }
    const { net, warnings } = importPnmlWithWarnings(text);
    return { net, warnings, native: false };
  }
  if (/\.dnf(\.txt)?$/i.test(name) || /^\s*[A-Za-z_][\w-]*\s*([&|*+,]|and|or)/i.test(trimmed) && !/\[/.test(trimmed.slice(0, 200))) {
    return { net: importDnf(text, { name: baseName(name, "fault tree") }), warnings: [], native: false };
  }
  const andl = (io as unknown as Record<string, unknown>).importAndl as ((t: string) => Net | { net: Net; warnings: string[] }) | undefined;
  if (andl) {
    const r = andl(text);
    return "net" in r ? { net: r.net, warnings: r.warnings, native: false } : { net: r, warnings: [], native: false };
  }
  throw new Error("Unknown file format");
}

/** Print the drawing of the current page (the browser's print dialog also saves as PDF). */
export function cmdPrint() {
  const s = useStore.getState();
  if (desktop()) {
    // The desktop shell opens no extra windows; print the canvas with the print stylesheet.
    useStore.setState({ fitRequest: s.fitRequest + 1, selection: [] });
    setTimeout(() => window.print(), 150);
    return;
  }
  const svg = netSvg(s.net);
  const w = window.open("", "_blank");
  if (!w) {
    toast("Allow pop-ups to print", "error");
    return;
  }
  const title = (s.net.name || "Petri net").replace(/[<>&]/g, "");
  w.document.write(
    `<!doctype html><title>${title}</title><style>@page{margin:12mm}body{margin:0;font-family:sans-serif}h1{font-size:14px;margin:0 0 8px}svg{max-width:100%;height:auto}</style>` +
      `<h1>${title} · ${NET_CLASS_LABELS[s.net.netClass]}</h1>${svg.replace(/^<\?xml[^>]*>/, "")}<script>onload=()=>{print();}<\/script>`,
  );
  w.document.close();
}

/** A TikZ picture of the current page, for LaTeX documents. */
export function netTikz(full: Net): string {
  const { net } = pageView(full, useStore.getState().page);
  const esc = (t: string) => t.replace(/([_#%&$])/g, "\\$1");
  const id = (x: string) => x.replace(/[^A-Za-z0-9]/g, "");
  const k = 1 / 50; // 50 px = 1 cm
  const lines = [
    "% Generated by Donwinne. Needs \\usetikzlibrary{petri,arrows.meta}",
    "\\begin{tikzpicture}[yscale=-1, every place/.style={minimum size=8mm, thick}, every transition/.style={minimum width=2.5mm, minimum height=8mm, thick, fill=white}]",
  ];
  for (const p of net.places) {
    const tokens = isColoured(net.netClass) ? "" : Number(p.marking || 0) > 0 ? `, tokens=${Math.min(6, Number(p.marking))}` : "";
    lines.push(`  \\node[place${tokens}, label=below:{${esc(p.name)}}] (${id(p.id)}) at (${(p.x * k).toFixed(2)}, ${(p.y * k).toFixed(2)}) {};`);
  }
  for (const t of net.transitions)
    lines.push(`  \\node[transition, label=above:{${esc(t.name)}}] (${id(t.id)}) at (${(t.x * k).toFixed(2)}, ${(t.y * k).toFixed(2)}) {};`);
  for (const n of net.faultTree?.nodes ?? [])
    lines.push(`  \\node[draw, ${n.type === "basic" ? "circle" : "rectangle"}, font=\\small] (${id(n.id)}) at (${(n.x * k).toFixed(2)}, ${(n.y * k).toFixed(2)}) {${esc(n.name)}${["and", "or", "xor", "kofn", "not", "pand", "inhibit"].includes(n.type) ? ` (${n.type.toUpperCase()})` : ""}};`);
  const head: Record<string, string> = { normal: "-{Latex}", read: "-{Circle}", inhibitor: "-{Circle[open]}", reset: "-{Latex[]Latex}", equal: "-{Diamond[open]}" };
  for (const a of net.arcs) {
    const via = (a.points ?? []).map((p) => ` -- (${(p.x * k).toFixed(2)}, ${(p.y * k).toFixed(2)})`).join("");
    const lbl = a.inscription && a.inscription !== "1" ? ` node[midway, auto, font=\\small] {${esc(a.inscription)}}` : "";
    lines.push(`  \\draw[${head[a.kind]}, thick] (${id(a.source)})${via} -- (${id(a.target)})${lbl};`);
  }
  for (const e of net.faultTree?.edges ?? []) lines.push(`  \\draw[thick] (${id(e.source)}) |- ++(0,-0.5) -| (${id(e.target)});`);
  lines.push("\\end{tikzpicture}");
  return lines.join("\n") + "\n";
}

/** Snoopy's "unfold": turn a coloured net into the equivalent uncoloured net, opened as a new model. */
export async function cmdUnfold(): Promise<void> {
  const s = useStore.getState();
  if (!isColoured(s.net.netClass)) {
    toast("Only coloured nets can be unfolded");
    return;
  }
  if (s.dirty && !window.confirm("Unfolding opens the result as a new model. Discard unsaved changes to this one?")) return;
  try {
    const { net } = unfold(s.net);
    const places = net.places.length;
    const transitions = net.transitions.length;
    loadNet({ ...net, name: `${s.net.name} (unfolded)` }, null);
    useStore.setState({ dirty: true });
    if (places + transitions <= 400) await autoLayout("layered");
    toast(`Unfolded into ${places} places and ${transitions} transitions`);
  } catch (e) {
    toast(`Could not unfold: ${(e as Error).message}`, "error");
  }
}
