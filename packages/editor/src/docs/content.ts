// The pages of Help > Docs: the Markdown files in docs/, split into sections and indexed for search.
// The pages, images and diagrams are bundled with the app (the pages load when Docs first opens),
// so the documentation also works offline and in the desktop app.

import { Block, inlineText, parseMarkdown } from "./markdown";

export interface DocPage {
  id: string;
  title: string;
  /** One line under the title in the page list. */
  summary: string;
  group: "Start here" | "Using Donwinne" | "Analysis and verification" | "Reference";
  file: string;
}

export const DOC_PAGES: readonly DocPage[] = [
  { id: "getting-started", title: "Getting started", summary: "Install or open Donwinne, the screen, your first net, saving", group: "Start here", file: "getting-started.md" },
  { id: "feature-index", title: "Every feature, A to Z", summary: "One line on every feature, where to find it and its shortcut", group: "Start here", file: "feature-index.md" },
  { id: "editor", title: "The editor", summary: "Menus, palette, drawing, editing, subnets, panels, touch, shortcuts", group: "Using Donwinne", file: "editor.md" },
  { id: "net-classes", title: "Net classes", summary: "Every class, the arc types, markings, expressions, declarations", group: "Using Donwinne", file: "net-classes.md" },
  { id: "simulation", title: "Simulation", summary: "Token games, stochastic, continuous, hybrid and fuzzy simulation", group: "Using Donwinne", file: "simulation.md" },
  { id: "file-formats", title: "Files and formats", summary: "The native format, Snoopy, PNML, ANDL and every export", group: "Using Donwinne", file: "file-formats.md" },
  { id: "analysis", title: "Analysis", summary: "Reachability graph, properties, invariants, siphons, fault trees", group: "Analysis and verification", file: "analysis.md" },
  { id: "ctl", title: "CTL model checking", summary: "Syntax, semantics, witnesses, templates, paths, fault tolerance", group: "Analysis and verification", file: "ctl.md" },
  { id: "slicing", title: "Slicing and the framework", summary: "Slicing algorithms, stubborn sets, the APN → T-APN → slice pipeline", group: "Analysis and verification", file: "slicing.md" },
  { id: "ambient-petri-nets", title: "Ambient Petri nets", summary: "APNs, T-APNs, steps, building blocks, composition, the garage", group: "Analysis and verification", file: "ambient-petri-nets.md" },
  { id: "faq", title: "Questions and troubleshooting", summary: "Why can't this fire? Why is the graph cut off? Offline, desktop, files", group: "Reference", file: "faq.md" },
  { id: "architecture", title: "How Donwinne is built", summary: "For developers: packages, data model, building, testing, extending", group: "Reference", file: "architecture.md" },
];

interface DocSection {
  page: DocPage;
  /** Heading anchor; "" for the top of the page. */
  anchor: string;
  title: string;
  /** Page and parent headings, e.g. ["The editor", "Drawing"]. */
  trail: string[];
  level: number;
  text: string;
  /** Lower-case text and title, for search. */
  lower: string;
  lowerTitle: string;
  words: Set<string>;
}

export interface LoadedDocs {
  pages: Map<string, Block[]>;
  sections: DocSection[];
}

// ---------------------------------------------------------------------------------------------
// Loading

const RAW = import.meta.glob("../../../../docs/*.md", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;

/** Bundled images and diagrams of the pages, by their path relative to docs/ (assets/images/x.png). */
const ASSETS: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob("../../../../docs/assets/**/*.{png,svg,gif,jpg,webp}", { query: "?url", import: "default", eager: true }) as Record<string, string>).map(([k, v]) => [
    k.replace(/^.*?\/docs\//, ""),
    v,
  ]),
);

export function assetUrl(path: string): string | undefined {
  const clean = path.replace(/^\.\//, "").replace(/^docs\//, "");
  return ASSETS[clean];
}


let loading: Promise<LoadedDocs> | null = null;

/** Load and index every page (once). */
export function loadDocs(): Promise<LoadedDocs> {
  loading ??= (async () => {
    const texts = await Promise.all(
      DOC_PAGES.map(async (p) => {
        const key = Object.keys(RAW).find((k) => k.endsWith(`/docs/${p.file}`));
        if (!key) throw new Error(`Missing documentation page ${p.file}`);
        return [p, await RAW[key]()] as const;
      }),
    );
    return buildDocs(texts);
  })();
  loading.catch(() => (loading = null));
  return loading;
}

/** Parse and index pages given as text (also used by the tests). */
export function buildDocs(texts: readonly (readonly [DocPage, string])[]): LoadedDocs {
  const pages = new Map<string, Block[]>();
  const sections: DocSection[] = [];
  for (const [page, text] of texts) {
    const blocks = stripContents(parseMarkdown(text));
    pages.set(page.id, blocks);
    sections.push(...sectionsOf(page, blocks));
  }
  return { pages, sections };
}

/** The pages' own "Contents" lists repeat the sidebar, so they are left out. */
function stripContents(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.t === "h" && b.level === 2 && /^(contents|table of contents)$/i.test(b.text)) {
      while (i + 1 < blocks.length && !(blocks[i + 1].t === "h" && (blocks[i + 1] as { level: number }).level <= 2)) i++;
      continue;
    }
    out.push(b);
  }
  return out;
}

function blockText(b: Block): string {
  switch (b.t) {
    case "h":
      return b.text;
    case "p":
    case "images":
      return inlineText(b.c);
    case "ul":
    case "ol":
      return b.items.map((it) => it.c.map(blockText).join(" ")).join(" ");
    case "code":
      return b.v;
    case "quote":
      return b.c.map(blockText).join(" ");
    case "table":
      return [b.head.map(inlineText).join(" "), ...b.rows.map((r) => r.map(inlineText).join(" "))].join(" ");
    case "hr":
      return "";
  }
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'_-]*/gu;

/** Words of a text, lower case, with a plural s dropped (places → place). */
export function words(text: string): string[] {
  return (text.toLowerCase().match(WORD) ?? []).map(stem);
}

function stem(w: string): string {
  w = w.replace(/['’]s?$/, "");
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is")) return w.slice(0, -1);
  return w;
}

function sectionsOf(page: DocPage, blocks: Block[]): DocSection[] {
  const out: DocSection[] = [];
  const trail: { level: number; title: string }[] = [];
  let cur: { anchor: string; title: string; level: number; trail: string[]; parts: string[] } = { anchor: "", title: page.title, level: 1, trail: [page.title], parts: [] };
  const push = () => {
    const text = cur.parts.join(" ").replace(/\s+/g, " ").trim();
    if (!text && cur.level > 1) return;
    out.push({
      page,
      anchor: cur.anchor,
      title: cur.title,
      trail: cur.trail,
      level: cur.level,
      text,
      lower: text.toLowerCase(),
      lowerTitle: cur.title.toLowerCase(),
      words: new Set(words(`${cur.title} ${text}`)),
    });
  };
  for (const b of blocks) {
    if (b.t === "h" && b.level === 1) {
      cur.parts.push("");
      continue;
    }
    if (b.t === "h" && b.level <= 4) {
      push();
      while (trail.length && trail[trail.length - 1].level >= b.level) trail.pop();
      trail.push({ level: b.level, title: b.text });
      cur = { anchor: b.id, title: b.text, level: b.level, trail: [page.title, ...trail.map((t) => t.title)], parts: [] };
      continue;
    }
    cur.parts.push(blockText(b));
  }
  push();
  return out;
}

// ---------------------------------------------------------------------------------------------
// Search

/** Words people type that the pages say differently. */
const SYNONYMS: Record<string, string[]> = {
  shortcut: ["key", "keyboard", "kbd"],
  hotkey: ["shortcut", "key"],
  delete: ["remove"],
  remove: ["delete"],
  token: ["marking"],
  marking: ["token"],
  colour: ["color"],
  color: ["colour"],
  coloured: ["colored"],
  colored: ["coloured"],
  export: ["save"],
  import: ["open"],
  zoom: ["fit"],
  undo: ["redo"],
  dark: ["theme"],
  theme: ["dark", "light"],
  apn: ["ambient"],
  ambient: ["apn"],
  slice: ["slicing"],
  slicing: ["slice"],
  deadlock: ["dead"],
  run: ["simulate", "simulation"],
  simulate: ["simulation", "token"],
  graph: ["reachability"],
  phone: ["touch", "mobile"],
  mobile: ["touch", "phone"],
  install: ["offline", "desktop"],
  print: ["pdf"],
};

export interface SearchHit {
  section: DocSection;
  score: number;
  /** The words to mark in the result and on the page. */
  terms: string[];
  snippet: { text: string; mark: boolean }[] | null;
}

/** Parse a query into terms; "quoted text" stays one phrase. */
export function queryTerms(q: string): { words: string[]; phrases: string[] } {
  const phrases: string[] = [];
  const rest = q.replace(/"([^"]+)"/g, (_, p: string) => {
    phrases.push(p.toLowerCase().trim());
    return " ";
  });
  return { words: words(rest), phrases: phrases.filter(Boolean) };
}

function matchesWord(sec: DocSection, w: string): number {
  if (sec.words.has(w)) return 2;
  // Prefix: "subn" finds "subnet"; also the start of a longer word.
  for (const x of sec.words) if (x.startsWith(w)) return 1;
  return 0;
}

/** Sections that match every word of the query (or a synonym), best first. */
export function searchDocs(sections: readonly DocSection[], query: string, limit = 50): SearchHit[] {
  const { words: ws, phrases } = queryTerms(query);
  if (!ws.length && !phrases.length) return [];
  const raw = query.trim().toLowerCase();
  const hits: SearchHit[] = [];
  for (const sec of sections) {
    let score = 0;
    const terms: string[] = [];
    let ok = true;
    for (const w of ws) {
      let m = matchesWord(sec, w);
      let term = w;
      if (!m)
        for (const s of SYNONYMS[w] ?? []) {
          const ms = matchesWord(sec, s);
          if (ms) {
            m = ms * 0.6;
            term = s;
            break;
          }
        }
      if (!m) {
        ok = false;
        break;
      }
      terms.push(term);
      score += m * 3;
      if (sec.lowerTitle.includes(w)) score += 12;
      const n = countOf(sec.lower, w, 6);
      score += n;
    }
    if (!ok) continue;
    for (const p of phrases) {
      const inTitle = sec.lowerTitle.includes(p);
      if (!inTitle && !sec.lower.includes(p)) {
        ok = false;
        break;
      }
      terms.push(p);
      score += inTitle ? 30 : 10 + countOf(sec.lower, p, 5);
    }
    if (!ok) continue;
    if (raw.length > 2 && sec.lowerTitle === raw) score += 60;
    else if (raw.length > 2 && sec.lowerTitle.includes(raw)) score += 25;
    else if (raw.length > 2 && sec.lower.includes(raw)) score += 8;
    // Prefer sections over whole pages and short focused sections over long ones.
    score -= Math.min(4, sec.text.length / 4000);
    if (sec.page.id === "architecture") score -= 3;
    hits.push({ section: sec, score, terms, snippet: snippet(sec.text, terms, 90, query.trim().replace(/"/g, "")) });
  }
  hits.sort((a, b) => b.score - a.score || a.section.text.length - b.section.text.length);
  return hits.slice(0, limit);
}

function countOf(hay: string, needle: string, cap: number): number {
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0 && n < cap; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

/** A piece of text around the best match, for the result list, with every searched word marked. */
export function snippet(text: string, terms: readonly string[], radius = 90, phrase = ""): SearchHit["snippet"] {
  if (!text) return null;
  const lower = text.toLowerCase();
  // Centre on the whole query when it occurs, else on the first searched word.
  let at = phrase ? lower.indexOf(phrase.toLowerCase()) : -1;
  if (at < 0)
    for (const t of terms) {
      const k = lower.indexOf(t);
      if (k >= 0 && (at < 0 || k < at)) at = k;
    }
  let start = 0;
  let end = Math.min(text.length, radius * 2);
  if (at >= 0) {
    start = Math.max(0, at - radius);
    end = Math.min(text.length, at + radius * 1.4);
  }
  let piece = text.slice(start, end);
  if (start > 0) piece = "…" + piece.replace(/^\S*\s/, "");
  if (end < text.length) piece = piece.replace(/\s\S*$/, "") + "…";
  const parts: { text: string; mark: boolean }[] = [];
  const ws = [...new Set(terms.filter((t) => t.length > 1))].sort((a, b) => b.length - a.length);
  if (!ws.length) return [{ text: piece, mark: false }];
  const re = new RegExp(`(${ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})[\\p{L}\\p{N}]*`, "giu");
  let last = 0;
  for (const m of piece.matchAll(re)) {
    if (m.index! > last) parts.push({ text: piece.slice(last, m.index), mark: false });
    parts.push({ text: m[0], mark: true });
    last = m.index! + m[0].length;
  }
  if (last < piece.length) parts.push({ text: piece.slice(last), mark: false });
  return parts;
}

/** Where a link in a page goes. */
type LinkTarget = { kind: "page"; page: string; anchor: string } | { kind: "external"; href: string } | { kind: "none" };

const REPO = "https://github.com/navin-hariharan/Donwinne/blob/main/";

/** Resolve a link of page `from` (relative to docs/). */
export function resolveLink(href: string, from: string): LinkTarget {
  if (/^(https?:|mailto:)/i.test(href)) return { kind: "external", href };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { kind: "none" }; // javascript:, data: and the like
  if (href.startsWith("#")) return { kind: "page", page: from, anchor: decodeURIComponent(href.slice(1)) };
  const [path, hash = ""] = href.split("#");
  const clean = path.replace(/^\.\//, "");
  if (/^(\.\.\/)?README\.md$/i.test(clean) && clean.startsWith("..")) return { kind: "page", page: "getting-started", anchor: "" };
  const md = /^([\w-]+)\.md$/.exec(clean);
  if (md) {
    const page = DOC_PAGES.find((p) => p.file === `${md[1]}.md`);
    if (page) return { kind: "page", page: page.id, anchor: decodeURIComponent(hash) };
    if (md[1] === "README") return { kind: "page", page: "getting-started", anchor: "" };
  }
  // Source files and other repository paths open on GitHub.
  if (clean.startsWith("../")) return { kind: "external", href: REPO + clean.replace(/^(\.\.\/)+/, "") + (hash ? `#${hash}` : "") };
  if (clean.startsWith("assets/")) {
    const url = assetUrl(clean);
    return url ? { kind: "external", href: url } : { kind: "none" };
  }
  return { kind: "external", href: REPO + "docs/" + clean + (hash ? `#${hash}` : "") };
}
