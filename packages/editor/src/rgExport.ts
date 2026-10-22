// Saving a reachability graph: as a picture (SVG, PNG), as a GraphViz file to lay out or process
// elsewhere, and as a table of states (CSV). Every file carries the "Exported from Donwinne" mark.

import { Laid, RGEdge, RGNode, clip } from "./RGGraph";
import { WATERMARK, WATERMARK_HEIGHT, markText, svgWatermark } from "./watermark";

/** Graphs larger than this are too big to draw as a picture; DOT and CSV take any size. */
export const RG_PICTURE_LIMIT = 1000;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A standalone SVG of a laid out graph, in the light theme, with the watermark below it. */
export function rgSvg(nodes: RGNode[], edges: RGEdge[], laid: Laid): string {
  const W = laid.width, H = laid.height;
  const out: string[] = [];
  out.push(
    `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + WATERMARK_HEIGHT}" viewBox="-12 -12 ${W} ${H + WATERMARK_HEIGHT}" font-family="sans-serif">`,
    `<title>Reachability graph</title>`,
    `<rect x="-12" y="-12" width="${W}" height="${H + WATERMARK_HEIGHT}" fill="#ffffff"/>`,
    `<defs><marker id="rg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#5f6b7d"/></marker></defs>`,
  );
  const label = (x: number, y: number, t: string, anchor = "middle") =>
    `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="10" fill="#5f6b7d" stroke="#ffffff" stroke-width="3" paint-order="stroke">${esc(clip(t, 18))}</text>`;
  edges.forEach((e, i) => {
    if (e.from === e.to) {
      const n = laid.nodes[e.from];
      const x = n.x + n.w, y = n.y + n.h / 2;
      out.push(`<path d="M${x},${y - 8} C${x + 26},${y - 22} ${x + 26},${y + 22} ${x},${y + 8}" fill="none" stroke="#5f6b7d" stroke-width="1.2" marker-end="url(#rg-arrow)"/>`, label(x + 24, y + 4, e.label, "start"));
      return;
    }
    const r = laid.edges[i];
    if (!r?.points.length) return;
    out.push(`<path d="M${r.points.map((p) => `${p.x},${p.y}`).join(" L")}" fill="none" stroke="#5f6b7d" stroke-width="1.2" marker-end="url(#rg-arrow)"/>`);
    if (r.label) out.push(label(r.label.x, r.label.y + 4, e.label));
  });
  nodes.forEach((n, i) => {
    const b = laid.nodes[i];
    const stroke = n.dead ? "#dc2626" : i === 0 ? "#2563eb" : "#5f6b7d";
    const fill = n.dead ? "#fdecec" : "#ffffff";
    out.push(
      `<g transform="translate(${b.x},${b.y})"><title>${esc(`${n.name}: ${n.text || "no tokens"}${n.dead ? " (dead)" : ""}`)}</title>`,
      `<rect width="${b.w}" height="${b.h}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="${n.dead || i === 0 ? 2 : 1.2}"/>`,
      `<text x="${b.w / 2}" y="14" text-anchor="middle" font-size="11" font-weight="600" fill="#1d2330">${esc(n.name)}</text>`,
      `<text x="${b.w / 2}" y="29" text-anchor="middle" font-size="11" font-family="monospace" fill="#5f6b7d">${esc(clip(n.text || "∅", 32))}</text></g>`,
    );
  });
  out.push(svgWatermark(-12, -12, W, H), `</svg>`);
  return out.join("\n");
}

/** The graph in GraphViz DOT, e.g. for `dot -Tpdf`. Dead states are red, the initial marking blue. */
export function rgDot(nodes: RGNode[], edges: RGEdge[], title: string): string {
  const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  const lines = [
    `digraph ${q(title || "reachability graph")} {`,
    `  label=${q(`${title ? `${title}: ` : ""}reachability graph (${WATERMARK})`)};`,
    `  labelloc=b; fontsize=10; fontcolor=gray45;`,
    `  node [shape=box, style="rounded,filled", fillcolor=white, fontname="Helvetica"];`,
    `  edge [fontname="Helvetica", fontsize=10];`,
  ];
  nodes.forEach((n, i) =>
    lines.push(`  s${i} [label=${q(`${n.name}\n${n.text || "∅"}`)}${n.dead ? ", color=red, fillcolor=mistyrose, penwidth=2" : i === 0 ? ", color=blue, penwidth=2" : ""}];`),
  );
  for (const e of edges) lines.push(`  s${e.from} -> s${e.to} [label=${q(e.label)}];`);
  lines.push("}");
  return markText("dot", lines.join("\n") + "\n");
}

/** A table of states: name, the marking of each place, whether it is dead, and its successors. */
export function rgCsv(places: string[], states: { name: string; tokens: string[]; dead: boolean; next: string[] }[]): string {
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = [["state", ...places, "dead", "successors"].map(cell).join(",")];
  for (const s of states) rows.push([s.name, ...s.tokens, s.dead ? "yes" : "no", s.next.join(" ")].map(cell).join(","));
  return markText("csv", rows.join("\n") + "\n");
}
