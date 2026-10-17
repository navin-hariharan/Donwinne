import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Writes the list of built files into dist/sw.js, with a version derived from their contents,
 * so the service worker can keep them for offline use and replace them after an update.
 */
function offlineCache(): Plugin {
  let outDir = "";
  return {
    name: "donwinne-offline-cache",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const swPath = path.join(outDir, "sw.js");
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = path.join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else if (full !== swPath && !name.endsWith(".map")) files.push(path.relative(outDir, full).split(path.sep).join("/"));
        }
      };
      walk(outDir);
      files.sort();
      const hash = createHash("sha256");
      for (const f of files) hash.update(f).update(readFileSync(path.join(outDir, f)));
      const sw = readFileSync(swPath, "utf8")
        .replace('"__SW_VERSION__"', JSON.stringify(hash.digest("hex").slice(0, 16)))
        .replace("/*__SW_PRECACHE__*/ []", JSON.stringify(files));
      writeFileSync(swPath, sw);
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), offlineCache()],
  resolve: {
    alias: [
      { find: "@pns/editor/src/styles.css", replacement: r("../../packages/editor/src/styles.css") },
      { find: "@pns/analysis", replacement: r("../../packages/analysis/src/index.ts") },
      { find: "@pns/apn", replacement: r("../../packages/apn/src/index.ts") },
      { find: "@pns/core", replacement: r("../../packages/core/src/index.ts") },
      { find: "@pns/ft", replacement: r("../../packages/ft/src/index.ts") },
      { find: "@pns/io", replacement: r("../../packages/io/src/index.ts") },
      { find: "@pns/sim", replacement: r("../../packages/sim/src/index.ts") },
      { find: "@pns/editor", replacement: r("../../packages/editor/src/index.ts") },
    ],
  },
  // Safari 14 and the matching Chrome, Firefox and Edge are the oldest browsers supported.
  build: { outDir: "dist", emptyOutDir: true, sourcemap: true, target: ["es2020", "safari14", "chrome87", "firefox78", "edge88"] },
  server: { port: 5173 },
});
