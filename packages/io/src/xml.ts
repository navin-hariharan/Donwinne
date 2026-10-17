// Tiny XML string writer and DOM reading helpers (works with the browser DOMParser and @xmldom/xmldom).

export type XmlChild = XmlEl | null | undefined | false | "";

export interface XmlEl {
  name: string;
  attrs?: Record<string, string | number | boolean | undefined>;
  children?: XmlChild[];
  /** Text content; an element has either text or children. */
  text?: string;
}

export function el(name: string, attrs?: XmlEl["attrs"], children: XmlChild[] = []): XmlEl {
  return { name, attrs, children };
}

export function textEl(name: string, text: string, attrs?: XmlEl["attrs"]): XmlEl {
  return { name, attrs, text };
}

// Characters not allowed in XML 1.0 at all (even as references).
// eslint-disable-next-line no-control-regex
const INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function escapeText(s: string): string {
  return s.replace(INVALID, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#13;");
}

export function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;").replace(/\t/g, "&#9;").replace(/\n/g, "&#10;");
}

export function renderXml(root: XmlEl): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  write(root, 0, out);
  return out.join("\n") + "\n";
}

function write(e: XmlEl, depth: number, out: string[]) {
  const pad = "  ".repeat(depth);
  let open = `<${e.name}`;
  for (const [k, v] of Object.entries(e.attrs ?? {})) if (v !== undefined) open += ` ${k}="${escapeAttr(String(v))}"`;
  const kids = (e.children ?? []).filter((c): c is XmlEl => !!c);
  if (e.text !== undefined) {
    out.push(e.text === "" ? `${pad}${open}/>` : `${pad}${open}>${escapeText(e.text)}</${e.name}>`);
  } else if (!kids.length) {
    out.push(`${pad}${open}/>`);
  } else {
    out.push(`${pad}${open}>`);
    for (const k of kids) write(k, depth + 1, out);
    out.push(`${pad}</${e.name}>`);
  }
}

// ---------------------------------------------------------------------------------------------
// Reading

/** Anything with parseFromString: a DOMParser instance, or a DOMParser class. */
export interface DomParserLike {
  parseFromString(source: string, mimeType: string): unknown;
}
export type DomParserOption = DomParserLike | (new () => DomParserLike);

/** Minimal structural view of a DOM node, satisfied by browser DOM and xmldom. */
export interface XNode {
  nodeType: number;
  nodeName: string;
  localName?: string | null;
  textContent: string | null;
  childNodes: ArrayLike<XNode>;
  getAttribute?(name: string): string | null;
}

export function parseXml(xml: string, parser?: DomParserOption): XNode {
  const impl = parser ?? (globalThis as { DOMParser?: new () => DomParserLike }).DOMParser;
  if (!impl) throw new Error("No XML parser is available in this environment (DOMParser is missing).");
  const instance: DomParserLike = typeof impl === "function" ? new impl() : impl;
  let doc: XNode;
  try {
    doc = instance.parseFromString(xml, "application/xml") as XNode;
  } catch (e) {
    throw new Error(`The file is not well-formed XML: ${firstLine((e as Error).message)}`);
  }
  const root = doc && kids(doc)[0];
  if (!root) throw new Error("The file is not well-formed XML: it has no root element.");
  const err = findParserError(doc);
  if (err) throw new Error(`The file is not well-formed XML: ${firstLine(err)}`);
  return root;
}

function firstLine(s: string) {
  return s.trim().split("\n")[0];
}

function findParserError(n: XNode): string | null {
  // Browsers report errors as a <parsererror> element (Firefox: root; Chrome: nested in the root).
  if (local(n) === "parsererror") return n.textContent ?? "parse error";
  for (const k of kids(n)) {
    if (local(k) === "parsererror") return k.textContent ?? "parse error";
    for (const kk of kids(k)) if (local(kk) === "parsererror") return kk.textContent ?? "parse error";
  }
  return null;
}

export function local(n: XNode): string {
  const name = n.localName || n.nodeName;
  const i = name.indexOf(":");
  return i >= 0 ? name.slice(i + 1) : name;
}

/** Element children. */
export function kids(n: XNode, name?: string): XNode[] {
  const out: XNode[] = [];
  const cn = n.childNodes;
  for (let i = 0; i < (cn?.length ?? 0); i++) {
    const c = cn[i];
    if (c.nodeType === 1 && (name === undefined || local(c) === name)) out.push(c);
  }
  return out;
}

export function kid(n: XNode | undefined, name: string): XNode | undefined {
  return n ? kids(n, name)[0] : undefined;
}

/** Follows a path of child element names. */
export function path(n: XNode | undefined, ...names: string[]): XNode | undefined {
  for (const name of names) n = kid(n, name);
  return n;
}

export function attr(n: XNode | undefined, name: string): string | undefined {
  if (!n?.getAttribute) return undefined;
  const v = n.getAttribute(name);
  return v === null || v === "" && !hasAttr(n, name) ? undefined : v;
}

function hasAttr(n: XNode, name: string) {
  return (n as unknown as { hasAttribute?(n: string): boolean }).hasAttribute?.(name) ?? false;
}

export function text(n: XNode | undefined): string | undefined {
  return n ? n.textContent ?? "" : undefined;
}
