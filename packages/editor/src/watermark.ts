// "Exported from Donwinne": every file the app exports carries it. Pictures show it (SVG, PNG, prints
// and TikZ); other formats carry it as a comment or metadata in the format's own syntax, so the file
// still opens in the tools it is meant for.

import { APP_VERSION } from "./version";

export const WATERMARK = "Exported from Donwinne";

/** Room the visible watermark takes below a picture, in drawing units. */
export const WATERMARK_HEIGHT = 16;

const XML_COMMENT = `<!-- ${WATERMARK} -->`;

/** How each text format writes a one-line comment. */
const COMMENT: Record<string, (s: string) => string> = {
  andl: (s) => `// ${s}`,
  candl: (s) => `// ${s}`,
  prism: (s) => `// ${s}`,
  dot: (s) => `// ${s}`,
  lola: (s) => `{ ${s} }`,
  tina: (s) => `# ${s}`,
  apnn: (s) => `% ${s}`,
  tikz: (s) => `% ${s}`,
  csv: (s) => `# ${s}`,
  dnf: (s) => `# ${s}`,
  txt: (s) => s,
};

/**
 * Put the watermark into an exported text file. XML formats (Snoopy, PNML, SBML, SVG) get a comment
 * right after the XML declaration and processing instructions; line formats get a first-line comment.
 */
export function markText(format: string, text: string): string {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<")) {
    // An SVG built in the page may already carry the watermark as metadata and visible text.
    if (text.includes(XML_COMMENT) || text.includes(`<metadata>${WATERMARK}</metadata>`)) return text;
    const m = /^\s*(?:<\?[\s\S]*?\?>\s*)*/.exec(text)!;
    const head = m[0].replace(/\s*$/, "");
    return head ? `${head}\n${XML_COMMENT}\n${text.slice(m[0].length)}` : `${XML_COMMENT}\n${text}`;
  }
  const comment = COMMENT[format];
  if (!comment || text.startsWith(comment(WATERMARK))) return text;
  return `${comment(WATERMARK)}\n${text}`;
}

/**
 * The visible watermark for an SVG picture whose content occupies (x, y, w, h): small grey text at
 * the bottom right, inside a strip of WATERMARK_HEIGHT added below the content, plus the same words
 * as the picture's metadata.
 */
export function svgWatermark(x: number, y: number, w: number, h: number): string {
  return (
    `<metadata>${WATERMARK}</metadata>` +
    `<text x="${x + w - 6}" y="${y + h + WATERMARK_HEIGHT - 5}" text-anchor="end" font-family="sans-serif" font-size="10" fill="#8a94a6" class="donwinne-watermark">${WATERMARK}</text>`
  );
}

/** Add the watermark (visible text and metadata) to an SVG element built in the page. */
export function markSvgElement(svg: SVGSVGElement, width: number, height: number): void {
  const NS = "http://www.w3.org/2000/svg";
  const meta = document.createElementNS(NS, "metadata");
  meta.textContent = WATERMARK;
  const text = document.createElementNS(NS, "text");
  for (const [k, v] of [["x", width - 6], ["y", height - 5], ["text-anchor", "end"], ["font-family", "sans-serif"], ["font-size", 10], ["fill", "#8a94a6"]] as const) text.setAttribute(k, String(v));
  text.setAttribute("class", "donwinne-watermark");
  text.textContent = WATERMARK;
  svg.insertBefore(meta, svg.firstChild);
  svg.appendChild(text);
}

// ---------- PNG metadata ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Add tEXt chunks ("Software: Donwinne <version>", "Comment: Exported from Donwinne") to a PNG, just after its
 * header chunk. The picture itself already shows the watermark; this is the metadata.
 */
export function markPng(png: Uint8Array): Uint8Array {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (png.length < 33 || sig.some((b, i) => png[i] !== b)) return png;
  const ihdrEnd = 8 + 8 + new DataView(png.buffer, png.byteOffset + 8, 4).getUint32(0) + 4;
  const chunks = [text("Software", `Donwinne ${APP_VERSION}`), text("Comment", WATERMARK)];
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(png.length + total);
  out.set(png.subarray(0, ihdrEnd), 0);
  let at = ihdrEnd;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  out.set(png.subarray(ihdrEnd), at);
  return out;
}

function text(keyword: string, value: string): Uint8Array {
  const data = new TextEncoder().encode(`${keyword}\0${value}`);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set([0x74, 0x45, 0x58, 0x74], 4); // "tEXt"
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}
