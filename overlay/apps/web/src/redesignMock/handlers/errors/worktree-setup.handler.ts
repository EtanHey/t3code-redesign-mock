// The setup card reads a snapshot stream per thread: the "setup script failed" thread (E07) and the
// live lane's preparing thread (L08) have one; every other thread answers null (nothing to show).
import { WS_METHODS, type WorktreeSetupSnapshot } from "@t3tools/contracts";
import * as Stream from "effect/Stream";

import { agoIso, stream } from "~/redesignMock/api";
import { SETUP_FAILED_THREAD_ID } from "../../fixtures/errors/e07-workspace-prep.fixture";
import { PREPARING_THREAD, preparingSnapshot } from "../live/worktree-setup.snapshot";

const done = (id: WorktreeSetupSnapshot["stages"][number]["id"], startedAgo: string, endedAgo: string, detail: string | null) => ({
  id,
  status: "done" as const,
  startedAt: agoIso(startedAgo),
  endedAt: agoIso(endedAgo),
  percent: 100,
  detail,
  tail: [],
});

export default stream(WS_METHODS.subscribeWorktreeSetup, (input) => {
  if (input.threadId === PREPARING_THREAD) {
    return Stream.concat(Stream.make(preparingSnapshot(input.threadId)), Stream.never);
  }
  if (input.threadId !== SETUP_FAILED_THREAD_ID) return Stream.concat(Stream.make(null), Stream.never);
  const snapshot: WorktreeSetupSnapshot = {
    threadId: input.threadId,
    phase: "failed",
    startedAt: agoIso("4m"),
    endedAt: agoIso("3m 20s"),
    branch: "feature/export-split",
    baseRef: "origin/main",
    worktreePath: "/workspace/relay-billing-export-split",
    setupScript: { name: "Install dependencies", command: "pnpm install --frozen-lockfile", terminalId: "setup-1" },
    stages: [
      done("fetch", "4m", "3m 55s", "origin/main at a91c2e4"),
      done("checkout", "3m 55s", "3m 50s", null),
      { id: "submodules", status: "skipped", startedAt: null, endedAt: null, percent: null, detail: "No submodules", tail: [] },
      {
        id: "setup-script",
        status: "failed",
        startedAt: agoIso("3m 50s"),
        endedAt: agoIso("3m 20s"),
        percent: null,
        detail: "Exited with code 1",
        tail: [
          "Progress: resolved 412, reused 398, downloaded 14, added 412",
          "ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with \"frozen-lockfile\" because pnpm-lock.yaml is not up to date with package.json",
          "  Failure reason: specifiers in the lockfile ({\"vitest\":\"^3.1.0\"}) don't match package.json ({\"vitest\":\"^3.2.4\"})",
        ],
      },
      { id: "agent", status: "pending", startedAt: null, endedAt: null, percent: null, detail: null, tail: [] },
    ],
    error: "Setup script exited with code 1",
    sequence: 4,
  };
  return Stream.concat(Stream.make(snapshot), Stream.never);
});
