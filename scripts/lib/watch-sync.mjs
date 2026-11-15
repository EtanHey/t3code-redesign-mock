// Re-runs scripts/sync.sh whenever a file under overlay/ changes (used by scripts/dev.sh).
import { spawnSync } from "node:child_process";
import { watch } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
let timer = null;
watch(resolve(root, "overlay"), { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const result = spawnSync("bash", [resolve(root, "scripts/sync.sh")], { stdio: "inherit" });
    if (result.status !== 0) console.error("watch-sync: sync failed");
  }, 150);
});
console.log(`watch-sync: watching overlay/ (pid ${process.pid})`);
