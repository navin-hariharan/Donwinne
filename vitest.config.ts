import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
export default defineConfig({
  resolve: {
    alias: {
      "@pns/analysis": r("./packages/analysis/src/index.ts"),
      "@pns/apn": r("./packages/apn/src/index.ts"),
      "@pns/core": r("./packages/core/src/index.ts"),
      "@pns/ft": r("./packages/ft/src/index.ts"),
      "@pns/io": r("./packages/io/src/index.ts"),
      "@pns/sim": r("./packages/sim/src/index.ts"),
    },
  },
  test: { include: ["packages/*/test/**/*.test.ts"], environment: "node", benchmark: { include: ["bench/**/*.bench.ts"] } },
});
