// L08: the workspace setup the app shows while a thread is still "Setting up": the worktree
// stages (fetch, checkout, setup script, start agent) with one of them running. Only the planted
// preparing thread has a setup in flight; every other thread has none.
// The stream itself is answered by handlers/errors/worktree-setup.handler.ts: one RPC, one handler.
import type { WorktreeSetupSnapshot } from "@t3tools/contracts";

import { agoIso } from "../../api";

export const PREPARING_THREAD = "l08-preparing";

export function preparingSnapshot(threadId: WorktreeSetupSnapshot["threadId"]): WorktreeSetupSnapshot {
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
