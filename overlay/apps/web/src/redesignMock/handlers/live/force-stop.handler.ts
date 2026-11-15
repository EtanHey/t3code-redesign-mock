// Force stop, offered when the agent does not answer Stop: ends the run, adds the "stopped" result
// row so the "not responding" notice clears, and reports that its processes were killed.
import { ORCHESTRATION_V2_WS_METHODS, ThreadId, TurnItemId } from "@t3tools/contracts";

import { itemBase, now, rpc } from "../../api";
import { interruptRun } from "../../kernel/reducer";

export default rpc(ORCHESTRATION_V2_WS_METHODS.forceStopThread, (input, { server }) => {
  const threadId = ThreadId.make(input.threadId);
  const projection = server.projection(threadId);
  const run = projection?.runs.findLast((candidate) =>
    input.runId === undefined ? candidate.status === "running" : candidate.id === input.runId,
  );
  if (!projection || !run) return { outcome: "released" as const, sharedWithThreadIds: [] };
  interruptRun(server, threadId, run.id);
  const at = now();
  const ordinal = projection.turnItems.reduce((max, candidate) => Math.max(max, candidate.ordinal), -1) + 1;
  server.emit(threadId, [
    {
      type: "turn-item.updated",
      payload: {
        ...itemBase({
          threadId,
          runId: run.id,
          ordinal,
          id: TurnItemId.make(`${run.id}-force-stop-result`),
          at,
          endedAt: at,
        }),
        type: "run_interrupt_result",
        message: "Force stopped: the agent's processes were killed",
      },
    },
  ]);
  return { outcome: "killed" as const, sharedWithThreadIds: [] };
});
