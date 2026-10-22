import { beforeAll, describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { emptyNet, Net } from "@pns/core";
import { EXPORT_FORMATS, importAny, netTikz } from "../src/fileOps";
import { WATERMARK, markPng, markText } from "../src/watermark";

function sample(netClass: Net["netClass"] = "pt"): Net {
  const net = emptyNet(netClass, "watermarked");
  net.places = [
    { id: "p1", name: "p1", x: 0, y: 0, marking: "1" },
    { id: "p2", name: "p2", x: 200, y: 0, marking: "" },
  ];
  net.transitions = [{ id: "t1", name: "t1", x: 100, y: 0 }];
  net.arcs = [
    { id: "a1", source: "p1", target: "t1", inscription: "1", kind: "normal" },
    { id: "a2", source: "t1", target: "p2", inscription: "1", kind: "normal" },
  ];
  return net;
}

describe("export watermark", () => {
  // The importers read XML with the browser's DOMParser; tests stand in xmldom.
  beforeAll(() => {
    (globalThis as { DOMParser?: unknown }).DOMParser ??= DOMParser;
  });

  it("puts an XML comment after the declaration", () => {
    const out = markText("pnml", '<?xml version="1.0"?>\n<?xml-stylesheet href="x"?>\n<pnml/>');
    expect(out).toBe(`<?xml version="1.0"?>\n<?xml-stylesheet href="x"?>\n<!-- ${WATERMARK} -->\n<pnml/>`);
  });

  it("uses each text format's comment syntax", () => {
    expect(markText("andl", "pn [x]")).toBe(`// ${WATERMARK}\npn [x]`);
    expect(markText("lola", "PLACE")).toBe(`{ ${WATERMARK} }\nPLACE`);
    expect(markText("tina", "net x")).toBe(`# ${WATERMARK}\nnet x`);
    expect(markText("apnn", "\\beginnet")).toBe(`% ${WATERMARK}\n\\beginnet`);
  });

  it("marks every export format of a place/transition net, and the marked files still open", () => {
    const net = sample();
    for (const f of EXPORT_FORMATS) {
      if (f.id === "png" || !f.applies(net.netClass)) continue;
      const raw = f.run(net);
      if (typeof raw !== "string") continue;
      const text = markText(f.id, raw);
      expect(text, f.id).toContain(WATERMARK);
      if (["snoopy", "pnml", "andl"].includes(f.id)) {
        const back = importAny(text, `x.${f.ext(net)}`).net;
        expect(back.places.length, f.id).toBe(2);
        expect(back.transitions.length, f.id).toBe(1);
      }
    }
  });

  it("shows the watermark in SVG and TikZ pictures", () => {
    const svg = EXPORT_FORMATS.find((f) => f.id === "svg")!.run(sample()) as string;
    expect(svg).toMatch(new RegExp(`<text[^>]*>${WATERMARK}</text>`));
    expect(netTikz(sample())).toContain(`{${WATERMARK}}`);
  });

  it("adds tEXt chunks with correct checksums to a PNG", () => {
    // A 1×1 PNG: signature, IHDR, IDAT and IEND.
    const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const png = Uint8Array.from(Buffer.from(b64, "base64"));
    const out = markPng(png);
    const chunks: { type: string; data: Uint8Array; crc: number }[] = [];
    const view = new DataView(out.buffer);
    for (let at = 8; at < out.length; ) {
      const len = view.getUint32(at);
      chunks.push({ type: String.fromCharCode(...out.subarray(at + 4, at + 8)), data: out.subarray(at + 8, at + 8 + len), crc: view.getUint32(at + 8 + len) });
      at += 12 + len;
    }
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "tEXt", "tEXt", "IDAT", "IEND"]);
    expect(new TextDecoder().decode(chunks[2].data)).toBe(`Comment\0${WATERMARK}`);
    // The IHDR's original checksum is kept, so recomputing ours the same way must give a match.
    const crcOf = (type: string, data: Uint8Array) => {
      let c = 0xffffffff;
      for (const b of [...type].map((x) => x.charCodeAt(0)).concat([...data])) {
        c ^= b;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      return (c ^ 0xffffffff) >>> 0;
    };
    for (const c of chunks) expect(crcOf(c.type, c.data), c.type).toBe(c.crc);
  });
});

describe("version", () => {
  it("matches every package.json", async () => {
    const { APP_VERSION } = await import("../src/version");
    const { readFileSync } = await import("node:fs");
    const root = new URL("../../../", import.meta.url);
    for (const f of ["package.json", "apps/web/package.json", "apps/desktop/package.json", "packages/editor/package.json"])
      expect(JSON.parse(readFileSync(new URL(f, root), "utf8")).version, f).toBe(APP_VERSION);
  });
});
