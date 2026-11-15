// Mock preview build: upstream's own config, plus the seam in ./vite/redesignMock.ts.
// Run with `vp build -c vite.mock.config.ts` (scripts/build.sh) or `vp dev -c ...` (scripts/dev.sh).
import { defineConfig, mergeConfig } from "vite-plus";

import { clearHostedEnv, redesignMockConfig } from "./vite/redesignMock";

// Upstream reads these at import time, so clear them before importing it.
clearHostedEnv();

export default defineConfig(async (env) => {
  const upstream = (await import("./vite.config")).default;
  const base = typeof upstream === "function" ? await upstream(env) : await upstream;
  return mergeConfig(base, redesignMockConfig(env.command));
});
