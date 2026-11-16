// Rewinding a message ("Edit from here") dispatches `checkpoint.rollback`. Every thread rewinds
// the way the server's rollback service does (kernel `rollbackToCheckpoint`), except the
// "Rollback failed" thread, which records the failure the way the server does (rollbackFailure on
// the thread, tied to the command), so the app shows the error its rewind flow waits for.
import type { OrchestrationV2AppThread } from "@t3tools/contracts";

import { now, onCommand } from "~/redesignMock/api";
import { rollbackToCheckpoint } from "~/redesignMock/kernel/reducer";
import { ROLLBACK_FAILED_THREAD_ID } from "../../fixtures/errors/e06-checkpoints.fixture";

export default onCommand("checkpoint.rollback", (command, { server }) => {
  if (command.threadId !== ROLLBACK_FAILED_THREAD_ID) {
    rollbackToCheckpoint(server, command);
    return;
  }
  const projection = server.projection(command.threadId);
  if (!projection) return;
  const thread: OrchestrationV2AppThread = {
    ...projection.thread,
    rollbackRequestId: command.commandId,
    rollbackFailure: {
      requestId: command.commandId,
      message:
        command.restoreFiles === true
          ? "Could not restore files: src/ledger/rollup.ts has local changes that would be overwritten. Commit or stash them and try again."
          : `Could not rewind to checkpoint ${command.checkpointId}: the provider session is no longer resumable.`,
    },
    updatedAt: now(),
  };
  server.emit(command.threadId, [{ type: "thread.metadata-updated", payload: thread }]);
});
