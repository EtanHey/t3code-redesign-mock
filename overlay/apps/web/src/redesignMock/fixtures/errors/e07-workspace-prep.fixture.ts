// E07: preparing the workspace failed. Two shapes: the worktree could not be created at all (the
// run fails before it starts and offers a retry), and the worktree exists but its setup script
// failed (the setup card shows the stages and the script's last lines; its snapshot comes from
// handlers/errors/worktree-setup.handler.ts).
import { ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE } from "@t3tools/contracts";

import { thread, turn } from "../../api";
import { failureItem } from "./errors-kit";

export const SETUP_FAILED_THREAD_ID = "e07-setup-script-failed";

const notCreated = thread({
  id: "e07-worktree-not-created",
  project: "errors",
  title: "Workspace preparation failed: worktree could not be created",
  branch: "feature/ledger-rollup",
  scenario: { id: "E07", label: "Worktree creation failed", waitForText: "ledger rollup" },
  turns: [
    turn({
      at: "5m",
      took: "6s",
      status: "failed",
      user: "Start the ledger rollup work in its own worktree off origin/main.",
      run: {
        startedAt: null,
        workspacePreparation: { type: "worktree", baseRef: "origin/main", branch: "feature/ledger-rollup" },
      },
      items: [
        failureItem({
          class: "unknown",
          message:
            "Could not create the worktree: branch 'feature/ledger-rollup' is already checked out at /workspace/relay-billing-rollup.",
          code: ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE,
          retryable: true,
        }),
      ],
    }),
  ],
});

const setupFailed = thread({
  id: SETUP_FAILED_THREAD_ID,
  project: "errors",
  title: "Workspace preparation failed: the setup script exited with an error",
  branch: "feature/export-split",
  worktreePath: "/workspace/relay-billing-export-split",
  scenario: { id: "E07b", label: "Worktree setup script failed", waitForText: "export split" },
  turns: [
    turn({
      at: "4m",
      took: "40s",
      status: "failed",
      user: "Work on the export split in a fresh worktree, and make sure dependencies are installed first.",
      run: {
        startedAt: null,
        workspacePreparation: { type: "worktree", baseRef: "origin/main", branch: "feature/export-split" },
      },
      items: [
        failureItem({
          class: "unknown",
          message: "Setup script `pnpm install --frozen-lockfile` exited with code 1 in /workspace/relay-billing-export-split.",
          code: ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE,
          retryable: true,
        }),
      ],
    }),
  ],
});

export default [notCreated, setupFailed];
