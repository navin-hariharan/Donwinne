import { describe, expect, it } from "vitest";
import { rgCsv, rgDot, rgSvg } from "../src/rgExport";
import { WATERMARK } from "../src/watermark";

const nodes = [{ name: "M0", text: "p:2" }, { name: "M1", text: "p q", dead: true }];
const edges = [{ from: 0, to: 1, label: "t" }, { from: 1, to: 1, label: 'say "hi"' }];
const laid = {
  nodes: [{ x: 0, y: 0, w: 60, h: 38 }, { x: 0, y: 90, w: 60, h: 38 }],
  edges: [{ points: [{ x: 30, y: 38 }, { x: 30, y: 90 }], label: { x: 30, y: 60 } }, { points: [] }],
  width: 100,
  height: 150,
};

describe("reachability graph export", () => {
  it("draws a standalone SVG with the watermark and the dead state in red", () => {
    const svg = rgSvg(nodes, edges, laid);
    expect(svg).toMatch(/^<\?xml/);
    expect(svg).toContain(`>${WATERMARK}</text>`);
    expect(svg).toContain('stroke="#dc2626"');
    expect(svg).toContain("say &quot;hi&quot;");
  });
  it("writes GraphViz DOT with escaped labels and the watermark", () => {
    const dot = rgDot(nodes, edges, "net");
    expect(dot.split("\n")[0]).toBe(`// ${WATERMARK}`);
    expect(dot).toContain('s0 -> s1 [label="t"];');
    expect(dot).toContain('s1 -> s1 [label="say \\"hi\\""];');
    expect(dot).toContain('s1 [label="M1\\np q", color=red');
  });
  it("writes a CSV table of states", () => {
    const csv = rgCsv(["p", "q"], [{ name: "M0", tokens: ["2", "0"], dead: false, next: ["t->M1"] }]);
    expect(csv).toBe(`# ${WATERMARK}\nstate,p,q,dead,successors\nM0,2,0,no,t->M1\n`);
  });
});
