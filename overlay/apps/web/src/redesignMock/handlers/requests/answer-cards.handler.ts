// Answers for the secret and link cards (Q12, Q13): the card ends as saved / declined / linked and
// the waiting run finishes. Nothing is stored and no machine is linked; the preview only changes
// what the card says. A pairing-code link is not simulated, so it also ends as declined.
import { EnvironmentId, ThreadId, WS_METHODS, type OrchestrationV2TurnItem, type TurnItemId } from "@t3tools/contracts";

import { now, rpc, type MockServer } from "../../api";

function settle(
  server: MockServer,
  threadId: ThreadId,
  turnItemId: TurnItemId,
  change: (current: OrchestrationV2TurnItem) => OrchestrationV2TurnItem,
): void {
  const projection = server.projection(threadId);
  const current = projection?.turnItems.find((candidate) => candidate.id === turnItemId);
  if (!projection || !current) return;
  const at = now();
  const run = projection.runs.findLast((candidate) => candidate.id === current.runId);
  server.emit(threadId, [
    { type: "turn-item.updated", payload: { ...change(current), status: "completed", completedAt: at, updatedAt: at } },
    ...(run && run.status === "waiting"
      ? [{ type: "run.updated" as const, payload: { ...run, status: "completed" as const, completedAt: at } }]
      : []),
  ]);
}

export const answerSecret = rpc(WS_METHODS.secretsAnswerRequest, (input, { server }) => {
  const threadId = ThreadId.make(input.threadId);
  settle(server, threadId, input.turnItemId, (current) =>
    current.type === "secret_request"
      ? { ...current, secretStatus: input.answer.type === "decline" ? "declined" : "saved" }
      : current,
  );
});

export const answerLink = rpc(WS_METHODS.peerLinksAnswerRequest, (input, { server }) => {
  const threadId = ThreadId.make(input.threadId);
  settle(server, threadId, input.turnItemId, (current) => {
    if (current.type !== "link_request") return current;
    if (input.answer.type === "use-existing") {
      return {
        ...current,
        linkStatus: "linked",
        linkedEnvironmentId: EnvironmentId.make(input.answer.environmentId),
        linkedLabel: "build-box",
      };
    }
    return { ...current, linkStatus: "declined" };
  });
});

export default [answerSecret, answerLink];
