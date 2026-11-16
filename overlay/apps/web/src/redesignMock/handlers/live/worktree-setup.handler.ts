// L08: the workspace setup the app shows while a thread is still "Setting up": the worktree
// stages (fetch, checkout, setup script, start agent) with one of them running. Only the planted
// preparing thread has a setup in flight; every other thread has none.
import { WS_METHODS, type WorktreeSetupSnapshot } from "@t3tools/contracts";
import * as Stream from "effect/Stream";

import { agoIso, stream } from "../../api";

const PREPARING_THREAD = "l08-preparing";

function preparingSnapshot(threadId: WorktreeSetupSnapshot["threadId"]): WorktreeSetupSnapshot {
  return {
    threadId,
    phase: "running",
    startedAt: agoIso("21s"),
    endedAt: null,
    branch: "t3/nightly-digest",
    baseRef: "main",
    worktreePath: "/workspace/harbor-api/.t3/worktrees/nightly-digest",
    setupScript: { name: "pnpm install", command: "pnpm install --frozen-lockfile", terminalId: "setup-1" },
    stages: [
      { id: "fetch", status: "done", startedAt: agoIso("21s"), endedAt: agoIso("18s"), percent: null, detail: null, tail: [] },
      { id: "checkout", status: "done", startedAt: agoIso("18s"), endedAt: agoIso("14s"), percent: null, detail: null, tail: [] },
      { id: "submodules", status: "skipped", startedAt: null, endedAt: null, percent: null, detail: null, tail: [] },
      {
        id: "setup-script",
        status: "running",
        startedAt: agoIso("14s"),
        endedAt: null,
        percent: null,
        detail: null,
        tail: ["Progress: resolved 412, reused 398, downloaded 14"],
      },
      { id: "agent", status: "pending", startedAt: null, endedAt: null, percent: null, detail: null, tail: [] },
    ],
    error: null,
    sequence: 1,
  };
}

export default stream(WS_METHODS.subscribeWorktreeSetup, (input) =>
  Stream.concat(
    Stream.make(input.threadId === PREPARING_THREAD ? preparingSnapshot(input.threadId) : null),
    Stream.never,
  ),
);
