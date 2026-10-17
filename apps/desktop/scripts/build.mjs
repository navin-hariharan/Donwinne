// Bundles src/main.ts and src/preload.ts into build/*.cjs with esbuild.
// `--copy-web` also copies ../web/dist into ./web for electron-builder (extraResources).
import { build } from "esbuild";
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
  sourcemap: "linked",
  logLevel: "info",
};

rmSync(path.join(root, "build"), { recursive: true, force: true });
await build({ ...common, entryPoints: [path.join(root, "src/main.ts")], outfile: path.join(root, "build/main.cjs") });
// Sandboxed preloads may only require a few built-in modules ("electron" among them), so
// everything else is inlined into this one file.
await build({ ...common, entryPoints: [path.join(root, "src/preload.ts")], outfile: path.join(root, "build/preload.cjs") });

if (process.argv.includes("--copy-web")) {
  const src = path.resolve(root, "../web/dist");
  const dest = path.join(root, "web");
  if (!existsSync(path.join(src, "index.html"))) {
    console.error(`Missing ${path.join(src, "index.html")}. Run \`pnpm build\` at the repository root first.`);
    process.exit(1);
  }
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  console.log(`Copied ${src} -> ${dest}`);
}
