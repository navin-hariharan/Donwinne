// A small Markdown parser for the in-app documentation (Help > Docs). It reads the subset the
// pages in docs/ use: ATX headings, paragraphs, bullet and numbered lists (nested by indentation),
// pipe tables, fenced code, block quotes, horizontal rules, images, links, bold, italic, inline
// code and $math$, plus the few HTML tags of the pages (<img>, <p>, <picture>, <br>, <kbd>).
//
// It builds a tree of plain objects, so the renderer can turn it into React elements without ever
// setting HTML: nothing in a page can run script.

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "math"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "del"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "img"; src: string; alt: string; width?: number }
  | { t: "kbd"; v: string }
  | { t: "br" };

interface ListItem {
  c: Block[];
}

export type Block =
  | { t: "h"; level: number; id: string; c: Inline[]; text: string }
  | { t: "p"; c: Inline[] }
  | { t: "ul"; items: ListItem[] }
  | { t: "ol"; start: number; items: ListItem[] }
  | { t: "code"; lang: string; v: string }
  | { t: "quote"; c: Block[] }
  | { t: "table"; align: ("left" | "center" | "right" | null)[]; head: Inline[][]; rows: Inline[][][] }
  | { t: "hr" }
  | { t: "images"; c: Inline[] };

/** GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Plain text of inline content (for anchors, search and alt texts). */
export function inlineText(c: readonly Inline[]): string {
  let out = "";
  for (const x of c) {
    switch (x.t) {
      case "text":
      case "code":
      case "math":
      case "kbd":
        out += x.v;
        break;
      case "strong":
      case "em":
      case "del":
      case "link":
        out += inlineText(x.c);
        break;
      case "img":
        out += x.alt;
        break;
      case "br":
        out += " ";
        break;
    }
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rarr: "→", larr: "←", times: "×", mdash: "—", ndash: "–", hellip: "…" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? (m[2] ?? m[3]) : undefined;
}

/** Inline Markdown. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ t: "text", v: decodeEntities(text) });
    text = "";
  };
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    // Backslash escapes.
    if (ch === "\\" && i + 1 < n && /[\\`*_{}[\]()#+\-.!|<>$~]/.test(src[i + 1])) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    // Inline code: `x` or ``x``.
    if (ch === "`") {
      let k = i;
      while (k < n && src[k] === "`") k++;
      const fence = src.slice(i, k);
      const end = src.indexOf(fence, k);
      if (end > 0) {
        flush();
        out.push({ t: "code", v: src.slice(k, end).replace(/^ (.*) $/, "$1") });
        i = end + fence.length;
        continue;
      }
      text += fence;
      i = k;
      continue;
    }
    // Inline math: $...$ on one line, not a price like "$5".
    if (ch === "$" && src[i + 1] !== " " && src[i + 1] !== "$") {
      const end = src.indexOf("$", i + 1);
      if (end > i + 1 && src[end - 1] !== " " && !/\d/.test(src[end + 1] ?? "")) {
        flush();
        out.push({ t: "math", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // Images and links.
    if (ch === "!" && src[i + 1] === "[") {
      const r = bracket(src, i + 1);
      if (r && src[r.end] === "(") {
        const p = paren(src, r.end);
        if (p) {
          flush();
          out.push({ t: "img", src: p.url, alt: decodeEntities(r.inner) });
          i = p.end;
          continue;
        }
      }
    }
    if (ch === "[") {
      const r = bracket(src, i);
      if (r && src[r.end] === "(") {
        const p = paren(src, r.end);
        if (p) {
          flush();
          out.push({ t: "link", href: p.url, c: parseInline(r.inner) });
          i = p.end;
          continue;
        }
      }
    }
    // Autolinks <https://...> and a few HTML tags.
    if (ch === "<") {
      const close = src.indexOf(">", i);
      if (close > i) {
        const tag = src.slice(i, close + 1);
        const auto = /^<(https?:\/\/[^\s>]+)>$/.exec(tag);
        if (auto) {
          flush();
          out.push({ t: "link", href: auto[1], c: [{ t: "text", v: auto[1] }] });
          i = close + 1;
          continue;
        }
        if (/^<img\b/i.test(tag)) {
          flush();
          const w = Number(attr(tag, "width"));
          out.push({ t: "img", src: attr(tag, "src") ?? "", alt: decodeEntities(attr(tag, "alt") ?? ""), ...(w > 0 ? { width: w } : {}) });
          i = close + 1;
          continue;
        }
        if (/^<br\s*\/?>$/i.test(tag)) {
          flush();
          out.push({ t: "br" });
          i = close + 1;
          continue;
        }
        const kbd = /^<kbd>/i.test(tag) ? src.indexOf("</kbd>", close) : -1;
        if (kbd > 0) {
          flush();
          out.push({ t: "kbd", v: decodeEntities(src.slice(close + 1, kbd)) });
          i = kbd + 6;
          continue;
        }
        // Other tags (<p>, <picture>, <source>, <sub>, ...) are dropped; their text stays.
        if (/^<\/?[a-z][a-z0-9-]*(\s[^<>]*)?\/?>$/i.test(tag) && !/^<\/?(?:x|y|net|place|pnml|name|text|id)\b/i.test(tag)) {
          i = close + 1;
          continue;
        }
      }
    }
    // Emphasis: ** __ * _ ~~ (underscores only at word boundaries).
    if (ch === "*" || ch === "_" || ch === "~") {
      const double = src[i + 1] === ch;
      if (ch === "~" && !double) {
        text += ch;
        i++;
        continue;
      }
      const mark = double ? ch + ch : ch;
      const prev = src[i - 1] ?? " ";
      const next = src[i + mark.length] ?? " ";
      const leftOk = next !== " " && (ch !== "_" || !/[\p{L}\p{N}]/u.test(prev));
      if (leftOk) {
        const end = findClose(src, i + mark.length, mark);
        if (end > 0) {
          flush();
          const c = parseInline(src.slice(i + mark.length, end));
          out.push(ch === "~" ? { t: "del", c } : double ? { t: "strong", c } : { t: "em", c });
          i = end + mark.length;
          continue;
        }
      }
      text += mark;
      i += mark.length;
      continue;
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

function findClose(src: string, from: number, mark: string): number {
  let i = from;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    if (src[i] === "`") {
      const end = src.indexOf("`", i + 1);
      if (end < 0) return -1;
      i = end + 1;
      continue;
    }
    if (src.startsWith(mark, i) && src[i - 1] !== " " && i > from) {
      // A single * inside ** ... ** is not a close of *.
      if (mark.length === 1 && src[i + 1] === mark) {
        const inner = findClose(src, i + 2, mark + mark);
        if (inner > 0) {
          i = inner + 2;
          continue;
        }
      }
      const after = src[i + mark.length] ?? " ";
      if (mark[0] !== "_" || !/[\p{L}\p{N}]/u.test(after)) return i;
    }
    i++;
  }
  return -1;
}

function bracket(src: string, open: number): { inner: string; end: number } | null {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > 0) i = end;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return { inner: src.slice(open + 1, i), end: i + 1 };
  }
  return null;
}

function paren(src: string, open: number): { url: string; end: number } | null {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) {
      // Drop an optional "title".
      const url = src
        .slice(open + 1, i)
        .trim()
        .replace(/\s+"[^"]*"$/, "")
        .replace(/^<(.*)>$/, "$1");
      return { url, end: i + 1 };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Blocks.

const indentOf = (line: string) => {
  let w = 0;
  for (const c of line) {
    if (c === " ") w++;
    else if (c === "\t") w += 4 - (w % 4);
    else break;
  }
  return w;
};

const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const FENCE = /^\s*(```+|~~~+)\s*([\w+-]*)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  let code = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
      continue;
    }
    if (c === "`") code = !code;
    if (c === "|" && !code) {
      cells.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

/** Parse a Markdown document. `ids` collects heading anchors (GitHub's -1, -2 suffixes for repeats). */
export function parseMarkdown(src: string, ids: Map<string, number> = new Map()): Block[] {
  return parseLines(src.replace(/\r\n?/g, "\n").split("\n"), ids);
}

function uniqueId(base: string, ids: Map<string, number>): string {
  const n = ids.get(base);
  ids.set(base, (n ?? -1) + 1);
  return n === undefined ? base : `${base}-${n + 1}`;
}

function parseLines(lines: string[], ids: Map<string, number>): Block[] {
  const out: Block[] = [];
  let i = 0;
  let para: string[] = [];
  const flushPara = () => {
    if (!para.length) return;
    const c = parseInline(para.map((l, k) => (k < para.length - 1 && / {2,}$/.test(l) ? l.trimEnd() + "\u0000" : l.trim())).join(" "));
    // Hard breaks (two trailing spaces) were marked with \0.
    const parts: Inline[] = [];
    for (const x of c) {
      if (x.t === "text" && x.v.includes("\u0000")) {
        x.v.split("\u0000").forEach((v, k) => {
          if (k) parts.push({ t: "br" });
          if (v) parts.push({ t: "text", v: v.replace(/^ /, "") });
        });
      } else parts.push(x);
    }
    const onlyImages = parts.every((x) => x.t === "img" || (x.t === "text" && !x.v.trim()) || x.t === "br");
    out.push(onlyImages && parts.some((x) => x.t === "img") ? { t: "images", c: parts.filter((x) => x.t === "img") } : { t: "p", c: parts });
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      flushPara();
      i++;
      continue;
    }
    // HTML comments.
    if (line.trim().startsWith("<!--")) {
      flushPara();
      while (i < lines.length && !lines[i].includes("-->")) i++;
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      flushPara();
      const ind = indentOf(line);
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${fence[1][0] === "`" ? "`" : "~"}{${fence[1].length},}\\s*$`).test(lines[i])) {
        body.push(lines[i].slice(Math.min(ind, indentOf(lines[i]))));
        i++;
      }
      i++;
      out.push({ t: "code", lang: fence[2] ?? "", v: body.join("\n") });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flushPara();
      const c = parseInline(h[2]);
      const text = inlineText(c);
      out.push({ t: "h", level: h[1].length, id: uniqueId(slugify(text), ids), c, text });
      i++;
      continue;
    }
    if (HR.test(line) && !para.length) {
      flushPara();
      out.push({ t: "hr" });
      i++;
      continue;
    }
    // Setext headings (a line of = or - under text).
    if (para.length === 1 && /^\s*(=+|-+)\s*$/.test(line)) {
      const level = line.trim()[0] === "=" ? 1 : 2;
      const c = parseInline(para[0].trim());
      const text = inlineText(c);
      out.push({ t: "h", level, id: uniqueId(slugify(text), ids), c, text });
      para = [];
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      flushPara();
      const body: string[] = [];
      while (i < lines.length && lines[i].trim() && /^\s*>/.test(lines[i])) body.push(lines[i].replace(/^\s*> ?/, "")), i++;
      out.push({ t: "quote", c: parseLines(body, ids) });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      flushPara();
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null));
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        const cells = splitRow(lines[i]);
        while (cells.length < head.length) cells.push("");
        rows.push(cells.slice(0, head.length).map(parseInline));
        i++;
      }
      out.push({ t: "table", align: head.map((_, k) => align[k] ?? null), head: head.map(parseInline), rows });
      continue;
    }
    const li = LIST.exec(line);
    if (li && (!para.length || indentOf(line) < 4)) {
      flushPara();
      const base = indentOf(line);
      const ordered = /\d/.test(li[2]);
      const items: ListItem[] = [];
      let start = ordered ? parseInt(li[2], 10) : 1;
      while (i < lines.length) {
        const m = LIST.exec(lines[i]);
        if (!m || indentOf(lines[i]) !== base || /\d/.test(m[2]) !== ordered) break;
        if (!items.length && ordered) start = parseInt(m[2], 10);
        const contentIndent = base + m[2].length + 1;
        const body = [m[3]];
        i++;
        // The item continues while lines are indented past the marker, lazy continuation lines
        // follow a paragraph, or blank lines separate indented blocks.
        while (i < lines.length) {
          const l = lines[i];
          if (!l.trim()) {
            const nextIdx = lines.slice(i + 1).findIndex((x) => x.trim());
            const next = nextIdx < 0 ? undefined : lines[i + 1 + nextIdx];
            if (next !== undefined && indentOf(next) >= Math.min(contentIndent, base + 2)) {
              body.push("");
              i++;
              continue;
            }
            break;
          }
          const ind = indentOf(l);
          if (ind >= Math.min(contentIndent, base + 2)) {
            body.push(l.slice(Math.min(ind, contentIndent)));
            i++;
            continue;
          }
          const isList = LIST.test(l);
          if (!isList && !HEADING.test(l) && !FENCE.test(l) && !/^\s*>/.test(l) && !HR.test(l) && body[body.length - 1] !== "" && !(l.includes("|") && lines[i + 1] && TABLE_SEP.test(lines[i + 1]))) {
            body.push(l.trim());
            i++;
            continue;
          }
          break;
        }
        items.push({ c: parseLines(body, ids) });
      }
      out.push(ordered ? { t: "ol", start, items } : { t: "ul", items });
      continue;
    }
    // A block of HTML that is only a wrapper (e.g. <p align="center">, <table>) adds nothing.
    if (/^\s*<\/?(p|picture|source|div|table|tr|td|th|tbody|thead|details|summary)\b[^>]*>\s*$/i.test(line)) {
      flushPara();
      i++;
      continue;
    }
    para.push(line);
    i++;
  }
  flushPara();
  return out;
}
