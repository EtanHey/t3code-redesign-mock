import { WS_METHODS } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import { stream } from "~/redesignMock/api";

export default stream(WS_METHODS.subscribeVcsStatus, (input) => {
  const ours = input.cwd.startsWith("/workspace/orbit-dashboard");
  return Stream.concat(Stream.make({
    _tag: "snapshot" as const,
    local: {
      isRepo: true, hasPrimaryRemote: true, isDefaultRef: !ours,
      refName: ours ? "feature/dashboard-summary" : "main",
      hasWorkingTreeChanges: ours,
      workingTree: { rootPath: input.cwd, files: ours ? [{ path: "src/summary.ts", insertions: 3, deletions: 1, status: "modified" as const }] : [], insertions: ours ? 3 : 0, deletions: ours ? 1 : 0 },
    },
    remote: { hasUpstream: true, aheadCount: 0, behindCount: 0, pr: null },
  }), Stream.never);
});
