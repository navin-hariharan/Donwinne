// Help > Docs: every page of the documentation inside the app, with a page list, the headings of the
// open page, and a search over every section of every page.

import React, { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { useStore } from "../store";
import { Block, Inline } from "./markdown";
import { DOC_PAGES, DocPage, LoadedDocs, SearchHit, assetUrl, loadDocs, queryTerms, resolveLink, searchDocs } from "./content";

interface DocsState {
  page: string;
  anchor: string;
  query: string;
  /** Pages visited before the current one, for Back. */
  history: { page: string; anchor: string }[];
  /** Words to mark on the page after following a search result. */
  marks: string[];
  /** Bumped on every navigation, so the same anchor scrolls again. */
  nav: number;
}

const useDocs = create<DocsState>(() => ({ page: "getting-started", anchor: "", query: "", history: [], marks: [], nav: 0 }));

/** Open Help > Docs, optionally at a page and heading, or with a search. */
export function openDocs(page?: string, anchor = "", query?: string) {
  const s = useDocs.getState();
  if (page && DOC_PAGES.some((p) => p.id === page)) useDocs.setState({ page, anchor, history: [...s.history, { page: s.page, anchor: s.anchor }].slice(-50), marks: [], nav: s.nav + 1 });
  if (query !== undefined) useDocs.setState({ query });
  useStore.setState({ dialog: "docs" });
}

function go(page: string, anchor: string, marks: string[] = []) {
  const s = useDocs.getState();
  const same = s.page === page && s.anchor === anchor;
  useDocs.setState({
    page,
    anchor,
    query: "",
    marks,
    nav: s.nav + 1,
    history: same ? s.history : [...s.history, { page: s.page, anchor: s.anchor }].slice(-50),
  });
}

function back() {
  const s = useDocs.getState();
  const prev = s.history[s.history.length - 1];
  if (prev) useDocs.setState({ page: prev.page, anchor: prev.anchor, history: s.history.slice(0, -1), marks: [], query: "", nav: s.nav + 1 });
}

// ---------------------------------------------------------------------------------------------
// Rendering a page.

interface RenderCtx {
  page: string;
  marks: RegExp | null;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function marked(text: string, ctx: RenderCtx): React.ReactNode {
  if (!ctx.marks) return text;
  const parts = text.split(ctx.marks);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p));
}

function DocLink({ href, ctx, children }: { href: string; ctx: RenderCtx; children: React.ReactNode }) {
  const target = resolveLink(href, ctx.page);
  if (target.kind === "page")
    return (
      <a
        href={`#docs/${target.page}${target.anchor ? `/${target.anchor}` : ""}`}
        onClick={(e) => {
          e.preventDefault();
          go(target.page, target.anchor);
        }}
      >
        {children}
      </a>
    );
  if (target.kind === "external")
    return (
      <a href={target.href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  return <span>{children}</span>;
}

function DocImage({ src, alt, width }: { src: string; alt: string; width?: number }) {
  const [failed, setFailed] = useState(false);
  const url = /^https?:/.test(src) ? src : assetUrl(src);
  if (!url || failed) return <span className="docs-img-missing">[{alt || "image"}]</span>;
  const isGif = /\.gif$/i.test(src);
  return (
    <figure className={`docs-figure${isGif ? " animated" : ""}`}>
      <img src={url} alt={alt} loading="lazy" style={width ? { width, maxWidth: "100%" } : undefined} onError={() => setFailed(true)} />
      {alt && !width && <figcaption>{alt}</figcaption>}
    </figure>
  );
}

function Inlines({ c, ctx }: { c: readonly Inline[]; ctx: RenderCtx }): React.ReactElement {
  return (
    <>
      {c.map((x, i) => {
        switch (x.t) {
          case "text":
            return <React.Fragment key={i}>{marked(x.v, ctx)}</React.Fragment>;
          case "code":
            return <code key={i}>{marked(x.v, ctx)}</code>;
          case "math":
            return (
              <code key={i} className="docs-math">
                {x.v}
              </code>
            );
          case "kbd":
            return <kbd key={i}>{x.v}</kbd>;
          case "strong":
            return (
              <strong key={i}>
                <Inlines c={x.c} ctx={ctx} />
              </strong>
            );
          case "em":
            return (
              <em key={i}>
                <Inlines c={x.c} ctx={ctx} />
              </em>
            );
          case "del":
            return (
              <del key={i}>
                <Inlines c={x.c} ctx={ctx} />
              </del>
            );
          case "link":
            return (
              <DocLink key={i} href={x.href} ctx={ctx}>
                <Inlines c={x.c} ctx={ctx} />
              </DocLink>
            );
          case "img":
            return <DocImage key={i} src={x.src} alt={x.alt} width={x.width} />;
          case "br":
            return <br key={i} />;
        }
      })}
    </>
  );
}

export function Blocks({ blocks, ctx }: { blocks: readonly Block[]; ctx: RenderCtx }): React.ReactElement {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h": {
            const H = `h${b.level}` as "h1";
            return (
              <H key={i} id={`docs-${b.id}`} className="docs-heading">
                <Inlines c={b.c} ctx={ctx} />
                {b.level > 1 && (
                  <a
                    className="docs-anchor"
                    href={`#docs/${ctx.page}/${b.id}`}
                    aria-label="Link to this section"
                    onClick={(e) => {
                      e.preventDefault();
                      go(ctx.page, b.id);
                      void navigator.clipboard?.writeText(`${location.origin}${location.pathname}#docs/${ctx.page}/${b.id}`).catch(() => undefined);
                    }}
                  >
                    #
                  </a>
                )}
              </H>
            );
          }
          case "p":
            return (
              <p key={i}>
                <Inlines c={b.c} ctx={ctx} />
              </p>
            );
          case "images":
            return (
              <div key={i} className={`docs-images n${Math.min(b.c.length, 3)}`}>
                <Inlines c={b.c} ctx={ctx} />
              </div>
            );
          case "ul":
            return (
              <ul key={i}>
                {b.items.map((it, k) => (
                  <li key={k}>
                    <Blocks blocks={it.c} ctx={ctx} />
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} start={b.start}>
                {b.items.map((it, k) => (
                  <li key={k}>
                    <Blocks blocks={it.c} ctx={ctx} />
                  </li>
                ))}
              </ol>
            );
          case "code":
            return (
              <pre key={i} className="docs-code" data-lang={b.lang || undefined}>
                <code>{b.v}</code>
              </pre>
            );
          case "quote":
            return (
              <blockquote key={i}>
                <Blocks blocks={b.c} ctx={ctx} />
              </blockquote>
            );
          case "table":
            return (
              <div key={i} className="docs-table-wrap">
                <table className="docs-table">
                  <thead>
                    <tr>
                      {b.head.map((h, k) => (
                        <th key={k} style={b.align[k] ? { textAlign: b.align[k]! } : undefined}>
                          <Inlines c={h} ctx={ctx} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, k) => (
                      <tr key={k}>
                        {r.map((cell, j) => (
                          <td key={j} style={b.align[j] ? { textAlign: b.align[j]! } : undefined}>
                            <Inlines c={cell} ctx={ctx} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "hr":
            return <hr key={i} />;
        }
      })}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The dialog.

const GROUPS: DocPage["group"][] = ["Start here", "Using Donwinne", "Analysis and verification", "Reference"];

export function DocsDialog({ close }: { close: () => void }) {
  const { page, anchor, query, history, marks, nav } = useDocs();
  const [docs, setDocs] = useState<LoadedDocs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [active, setActive] = useState(0);
  const deferred = useDeferredValue(query);
  const searchRef = useRef<HTMLInputElement>(null);
  const articleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    loadDocs().then(
      (d) => live && setDocs(d),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, []);

  const hits: SearchHit[] = useMemo(() => (docs && deferred.trim() ? searchDocs(docs.sections, deferred, 60) : []), [docs, deferred]);
  useEffect(() => setActive(0), [deferred]);

  const searching = query.trim().length > 0;
  const pageInfo = DOC_PAGES.find((p) => p.id === page) ?? DOC_PAGES[0];
  const blocks = docs?.pages.get(pageInfo.id);
  const headings = useMemo(() => (blocks ?? []).filter((b): b is Extract<Block, { t: "h" }> => b.t === "h" && (b.level === 2 || b.level === 3)), [blocks]);
  const markRe = useMemo(() => {
    const ws = marks.filter((m) => m.length > 1);
    return ws.length ? new RegExp(`(${ws.map(escapeRe).sort((a, b) => b.length - a.length).join("|")})`, "gi") : null;
  }, [marks]);

  // Scroll to the heading (or the top) after every navigation.
  useLayoutEffect(() => {
    if (!docs || searching) return;
    const el = anchor ? document.getElementById(`docs-${anchor}`) : null;
    const box = articleRef.current;
    if (!box) return;
    if (el) {
      box.scrollTop = el.offsetTop - box.offsetTop - 8;
      el.classList.remove("docs-flash");
      void el.offsetWidth;
      el.classList.add("docs-flash");
    } else box.scrollTop = 0;
  }, [docs, page, anchor, nav, searching]);

  // Keyboard: / or Ctrl+K searches, Esc clears the search first, Alt+← goes back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        if (useDocs.getState().query) useDocs.setState({ query: "" });
        else if (navOpen) setNavOpen(false);
        else close();
        return;
      }
      if ((e.key === "/" && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        e.stopPropagation();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close, navOpen]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const openHit = useCallback((h: SearchHit) => {
    const { words, phrases } = queryTerms(useDocs.getState().query);
    go(h.section.page.id, h.section.anchor, [...h.terms, ...words, ...phrases]);
    setNavOpen(false);
  }, []);

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!hits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(hits.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      openHit(hits[Math.min(active, hits.length - 1)]);
    }
  };

  useEffect(() => {
    document.getElementById(`docs-hit-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const ctx: RenderCtx = { page: pageInfo.id, marks: markRe };
  const idx = DOC_PAGES.indexOf(pageInfo);
  const prev = DOC_PAGES[idx - 1];
  const next = DOC_PAGES[idx + 1];

  return (
    <div className="modal-backdrop docs-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="docs" role="dialog" aria-modal="true" aria-label="Donwinne documentation" data-testid="docs">
        <header className="docs-top">
          <button className="icon docs-menu-btn" aria-label="Pages" title="Pages" onClick={() => setNavOpen((o) => !o)}>
            ☰
          </button>
          <h2>Docs</h2>
          <button className="icon" aria-label="Back" title="Back (Alt+←)" disabled={!history.length} onClick={back}>
            ←
          </button>
          <div className="docs-search">
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => useDocs.setState({ query: e.target.value })}
              onKeyDown={onSearchKey}
              placeholder="Search the docs: a feature, a menu, a shortcut… (/ or Ctrl+K)"
              aria-label="Search the documentation"
              data-testid="docs-search"
            />
          </div>
          <button className="icon" aria-label="Close" title="Close (Esc)" onClick={close}>
            ✕
          </button>
        </header>
        <div className="docs-main">
          <nav className={`docs-nav${navOpen ? " open" : ""}`} aria-label="Documentation pages">
            {GROUPS.map((g) => (
              <div key={g} className="docs-group">
                <div className="docs-group-title">{g}</div>
                {DOC_PAGES.filter((p) => p.group === g).map((p) => (
                  <div key={p.id}>
                    <button
                      className={`docs-page-link${p.id === pageInfo.id && !searching ? " current" : ""}`}
                      onClick={() => {
                        go(p.id, "");
                        setNavOpen(false);
                      }}
                      title={p.summary}
                    >
                      {p.title}
                    </button>
                    {p.id === pageInfo.id && !searching && headings.length > 0 && (
                      <div className="docs-toc">
                        {headings.map((h) => (
                          <button
                            key={h.id}
                            className={`docs-toc-link l${h.level}${h.id === anchor ? " current" : ""}`}
                            onClick={() => {
                              go(p.id, h.id);
                              setNavOpen(false);
                            }}
                          >
                            {h.text}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </nav>
          <div className="docs-article" ref={articleRef}>
            {error && <p className="error-text">The documentation could not be loaded: {error}</p>}
            {!docs && !error && <p className="muted">Loading the documentation…</p>}
            {docs && searching && (
              <div className="docs-results" data-testid="docs-results" role="listbox" aria-label="Search results">
                <p className="muted small">
                  {hits.length ? `${hits.length === 60 ? "60+" : hits.length} result${hits.length === 1 ? "" : "s"} for “${query.trim()}”` : `Nothing found for “${query.trim()}”. Try fewer or shorter words.`}
                </p>
                {hits.map((h, i) => (
                  <button
                    key={`${h.section.page.id}/${h.section.anchor}`}
                    id={`docs-hit-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={`docs-hit${i === active ? " active" : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => openHit(h)}
                  >
                    <span className="docs-hit-trail">{h.section.trail.join(" › ")}</span>
                    <span className="docs-hit-title">{h.section.title}</span>
                    {h.snippet && (
                      <span className="docs-hit-snippet">{h.snippet.map((part, k) => (part.mark ? <mark key={k}>{part.text}</mark> : <React.Fragment key={k}>{part.text}</React.Fragment>))}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {docs && !searching && blocks && (
              <article className="docs-page" data-testid="docs-page" data-page={pageInfo.id}>
                <Blocks blocks={blocks} ctx={ctx} />
                <div className="docs-pager">
                  {prev ? (
                    <button className="small" onClick={() => go(prev.id, "")}>
                      ← {prev.title}
                    </button>
                  ) : (
                    <span />
                  )}
                  {next && (
                    <button className="small" onClick={() => go(next.id, "")}>
                      {next.title} →
                    </button>
                  )}
                </div>
              </article>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
