// Help > Docs: the Markdown reader, the pages, their links and pictures, and the search.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Block, Inline, inlineText, parseInline, parseMarkdown, slugify } from "../src/docs/markdown";
import { DOC_PAGES, assetUrl, buildDocs, loadDocs, resolveLink, searchDocs, snippet, words } from "../src/docs/content";
import { Blocks } from "../src/docs/DocsDialog";

const DOCS = fileURLToPath(new URL("../../../docs/", import.meta.url));
const pageText = (file: string) => readFileSync(path.join(DOCS, file), "utf8");
const docs = buildDocs(DOC_PAGES.map((p) => [p, pageText(p.file)] as const));

describe("Markdown reader", () => {
  it("reads headings with GitHub's anchors, repeated ones numbered", () => {
    const b = parseMarkdown("# Title\n\n## Evolution: when does a change need a new check?\n\n### Show: highlighting results\n\n## Notes\n\n## Notes");
    expect(b.filter((x) => x.t === "h").map((x) => (x as { id: string }).id)).toEqual(["title", "evolution-when-does-a-change-need-a-new-check", "show-highlighting-results", "notes", "notes-1"]);
    expect(slugify("Chapter 6: the construction φ")).toBe("chapter-6-the-construction-φ");
    expect(slugify("Steps (Sec. 3.3)")).toBe("steps-sec-33");
  });

  it("reads inline marks, links, images, code, math and escapes", () => {
    const c = parseInline("**Bold** and *it* with `a|b` and [link](editor.md#find), ![pic](assets/x.png) $x_1$ \\*not\\* <kbd>F1</kbd>");
    const kinds = c.filter((x) => x.t !== "text").map((x) => x.t);
    expect(kinds).toEqual(["strong", "em", "code", "link", "img", "math", "kbd"]);
    expect(inlineText(c)).toContain("*not*");
    expect(parseInline("snake_case_name stays").map((x) => x.t)).toEqual(["text"]);
    expect(parseInline("costs $5 and $6").map((x) => x.t)).toEqual(["text"]);
    expect(parseInline('<img src="assets/a.svg" alt="Logo" width="240">')).toEqual([{ t: "img", src: "assets/a.svg", alt: "Logo", width: 240 }]);
  });

  it("reads nested lists, tables with escaped pipes, code fences and quotes", () => {
    const b = parseMarkdown("- one\n  - inner\n- two\n  continued\n\n1. first\n2. second\n\n| A | B |\n| --- | :---: |\n| `x \\| y` | 2 |\n\n```ts\nconst a = 1;\n```\n\n> note");
    expect(b.map((x) => x.t)).toEqual(["ul", "ol", "table", "code", "quote"]);
    const ul = b[0] as Extract<Block, { t: "ul" }>;
    expect(ul.items).toHaveLength(2);
    expect(ul.items[0].c.map((x) => x.t)).toEqual(["p", "ul"]);
    expect(inlineText((ul.items[1].c[0] as { c: Inline[] }).c)).toBe("two continued");
    const table = b[2] as Extract<Block, { t: "table" }>;
    expect(table.align).toEqual([null, "center"]);
    expect(inlineText(table.rows[0][0])).toBe("x | y");
    expect((b[3] as { v: string }).v).toBe("const a = 1;");
  });

  it("never produces script: HTML other than images is dropped", () => {
    const html = renderToStaticMarkup(React.createElement(Blocks, { blocks: parseMarkdown('<script>alert(1)</script> [x](javascript:alert(1)) <b onclick="x">y</b>'), ctx: { page: "faq", marks: null } }));
    expect(html).not.toMatch(/<script|javascript:|onclick/i);
  });
});

describe("the documentation pages", () => {
  it("registers every page in docs/ (except the folder's README)", () => {
    const files = readdirSync(DOCS).filter((f) => f.endsWith(".md") && f !== "README.md");
    expect(DOC_PAGES.map((p) => p.file).sort()).toEqual(files.sort());
    expect(new Set(DOC_PAGES.map((p) => p.id)).size).toBe(DOC_PAGES.length);
  });

  it("loads through the bundler as well", async () => {
    const loaded = await loadDocs();
    expect(loaded.pages.size).toBe(DOC_PAGES.length);
    expect(loaded.sections.length).toBe(docs.sections.length);
  });

  const anchors = new Map<string, Set<string>>();
  for (const [id, blocks] of docs.pages) anchors.set(id, new Set(blocks.filter((b) => b.t === "h").map((b) => (b as { id: string }).id)));

  function* inlinesOf(blocks: readonly Block[]): Generator<Inline> {
    const walk = function* (c: readonly Inline[]): Generator<Inline> {
      for (const x of c) {
        yield x;
        if ("c" in x) yield* walk(x.c);
      }
    };
    for (const b of blocks) {
      if (b.t === "p" || b.t === "images" || b.t === "h") yield* walk(b.c);
      else if (b.t === "ul" || b.t === "ol") for (const it of b.items) yield* inlinesOf(it.c);
      else if (b.t === "quote") yield* inlinesOf(b.c);
      else if (b.t === "table") for (const cell of [...b.head, ...b.rows.flat()]) yield* walk(cell);
    }
  }

  it("every link inside the docs goes to a page and heading that exist", () => {
    const broken: string[] = [];
    for (const [id, blocks] of docs.pages)
      for (const x of inlinesOf(blocks)) {
        if (x.t !== "link") continue;
        const t = resolveLink(x.href, id);
        if (t.kind === "page") {
          if (!anchors.has(t.page)) broken.push(`${id}: ${x.href} (no page)`);
          else if (t.anchor && !anchors.get(t.page)!.has(t.anchor)) broken.push(`${id}: ${x.href} (no heading)`);
        }
      }
    expect(broken).toEqual([]);
  });

  // Links to source files open on GitHub. They can only be checked in a full checkout: a Docker build
  // copies just the packages, the web app and the docs pages.
  const FULL_CHECKOUT = ["README.md", "apps/desktop/src", "docs/thesis"].every((f) => existsSync(path.join(DOCS, "..", f)));
  it.runIf(FULL_CHECKOUT)("every link to a source file names a file that exists", () => {
    const repo = "https://github.com/navin-hariharan/Donwinne/blob/main/";
    const broken: string[] = [];
    for (const [id, blocks] of docs.pages)
      for (const x of inlinesOf(blocks)) {
        if (x.t !== "link") continue;
        const t = resolveLink(x.href, id);
        if (t.kind !== "external" || !t.href.startsWith(repo)) continue;
        const rel = decodeURIComponent(t.href.slice(repo.length).split("#")[0]);
        if (!existsSync(path.join(DOCS, "..", rel))) broken.push(`${id}: ${x.href} (no file ${rel})`);
      }
    expect(broken).toEqual([]);
  });

  it("every picture exists and is bundled with the app", () => {
    const missing: string[] = [];
    let count = 0;
    for (const [id, blocks] of docs.pages)
      for (const x of inlinesOf(blocks)) {
        if (x.t !== "img" || /^https?:/.test(x.src)) continue;
        count++;
        if (!existsSync(path.join(DOCS, x.src))) missing.push(`${id}: ${x.src} (no file)`);
        else if (!assetUrl(x.src)) missing.push(`${id}: ${x.src} (not bundled)`);
      }
    expect(missing).toEqual([]);
    expect(count).toBeGreaterThan(60);
  });

  it("renders every page", () => {
    for (const [id, blocks] of docs.pages) {
      const html = renderToStaticMarkup(React.createElement(Blocks, { blocks, ctx: { page: id, marks: /(net)/gi } }));
      expect(html.length, id).toBeGreaterThan(1000);
      expect(html, id).not.toContain("undefined");
    }
  });

  it("leaves out the pages' own Contents lists", () => {
    for (const blocks of docs.pages.values()) expect(blocks.some((b) => b.t === "h" && /^contents$/i.test(b.text))).toBe(false);
  });
});

describe("search", () => {
  const top = (q: string, n = 3) => searchDocs(docs.sections, q, n).map((h) => `${h.section.page.id}#${h.section.anchor}`);

  it("finds the section about a feature first", () => {
    expect(top("logical place", 5)).toContain("net-classes#places-capacity-and-logical-places");
    expect(top("inhibitor arc", 5)).toContain("net-classes#arc-types");
    expect(top("red token trail")[0]).toBe("simulation#the-red-token-trail-and-deadlocks");
    expect(top("keyboard shortcuts")[0]).toBe("editor#keyboard-shortcuts");
    expect(top("abstract slicing", 5)).toContain("slicing#abstract-slicing-in-detail");
    expect(top("stubborn sets")[0]).toBe("slicing#stubborn-sets");
    expect(top("construct T-APN", 6).some((h) => h.startsWith("ambient-petri-nets#"))).toBe(true);
    expect(top("export PNML", 6)).toContain("file-formats#pnml");
  });

  it("matches word starts, plurals, other spellings and phrases", () => {
    expect(top("subn").length).toBeGreaterThan(0);
    expect(top("subnets")[0]).toContain("subnets");
    expect(top("color sets", 5)).toContain("net-classes#colour-sets");
    expect(searchDocs(docs.sections, '"maximal step"', 50).every((h) => h.section.lower.includes("maximal step") || h.section.lowerTitle.includes("maximal step"))).toBe(true);
    expect(searchDocs(docs.sections, "", 10)).toEqual([]);
    expect(searchDocs(docs.sections, "zzqqxx", 10)).toEqual([]);
  });

  it("finds every menu item of the editor", () => {
    const toolbar = readFileSync(fileURLToPath(new URL("../src/Toolbar.tsx", import.meta.url)), "utf8");
    const labels = new Set<string>();
    for (const m of toolbar.matchAll(/>([^<>{}]+)<\/Item>/g)) {
      const label = m[1].replace(/…$/, "").trim();
      if (label) labels.add(label);
    }
    for (const m of toolbar.matchAll(/"((?:Play|Stop) the (?:step )?token game)"/g)) labels.add(m[1]);
    expect(labels.size).toBeGreaterThan(30);
    const missing = [...labels].filter((l) => !searchDocs(docs.sections, l, 1).length);
    expect(missing).toEqual([]);
  });

  it("gives a snippet around the match", () => {
    const parts = snippet("The quick brown fox jumps over the lazy dog and the fox sleeps", ["fox"], 10)!;
    expect(parts.map((x) => x.text).join("")).toBe("…brown fox jumps…");
    expect(parts.filter((x) => x.mark).map((x) => x.text)).toEqual(["fox"]);
    const both = snippet("A logical place shares its marking with every place of the same name", ["logical", "place"], 40, "logical place")!;
    expect(both.filter((x) => x.mark).map((x) => x.text)).toEqual(["logical", "place", "place"]);
    expect(words("Places, transitions' and Colour-sets")).toEqual(["place", "transition", "and", "colour-set"]);
  });
});
