import { ProjectReadFileError, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { rpc } from "~/redesignMock/api";

const root = "/workspace/orbit-dashboard";
const files: Record<string, string> = {
  "README.md": "# Orbit dashboard\n\nA small dashboard for recent activity.\n",
  "src/summary.ts": "export const title = 'Overview';\nexport const summary = 'Recent activity';\nexport const limit = 10;\n",
  "data/activity.csv": "day,visits\nMonday,42\nTuesday,58\n",
};
export default [
  rpc(WS_METHODS.projectsListEntries, (input) => {
    if (input.cwd !== root) return { entries: [], truncated: false };
    const dir = input.directoryPath ?? "";
    const entries = dir === "" ? [{ path: "README.md", kind: "file" as const }, { path: "src", kind: "directory" as const }, { path: "data", kind: "directory" as const }] :
      dir === "src" ? [{ path: "src/summary.ts", kind: "file" as const }] :
      dir === "data" ? [{ path: "data/activity.csv", kind: "file" as const }] : [];
    return { entries, truncated: false };
  }),
  rpc(WS_METHODS.projectsReadFile, (input) => {
    const contents = input.cwd === root ? files[input.relativePath] : undefined;
    if (contents === undefined) {
      if (input.allowMissing) return { relativePath: input.relativePath, contents: "", byteLength: 0, truncated: false, exists: false };
      return Effect.fail(new ProjectReadFileError({ cwd: input.cwd, relativePath: input.relativePath, failure: "operation_failed" }));
    }
    return { relativePath: input.relativePath, contents, byteLength: new TextEncoder().encode(contents).length, truncated: false, exists: true };
  }),
  rpc(WS_METHODS.filesystemGetMetadata, (input) => ({ entries: input.paths.map((path) => {
    const name = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : "";
    const contents = files[name];
    return contents === undefined ? null : { kind: "file" as const, byteLength: new TextEncoder().encode(contents).length };
  }) })),
];
