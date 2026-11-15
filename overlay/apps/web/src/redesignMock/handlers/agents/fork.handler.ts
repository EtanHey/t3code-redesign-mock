// "Fork" and "Side chat" in the UI dispatch `thread.fork`; the kernel does not model it. This
// reaction adds the target thread with its lineage and a fork marker so the new thread opens, shows
// "Forked from conversation" and links back. It does not copy the source's history (the mock has
// no provider to resume), so a forked thread starts at the marker.
import { RunId, TurnItemId } from "@t3tools/contracts";

import { emptyProjection, itemBase, now, onCommand, visibleItemsOf } from "~/redesignMock/api";

export default onCommand("thread.fork", (command, { server }) => {
  const source = server.projection(command.sourceThreadId);
  if (!source || server.thread(command.targetThreadId)) return;
  const at = now();
  const sourceRunId =
    command.sourcePoint.type === "run"
      ? command.sourcePoint.runId
      : (source.runs.findLast((run) => run.status === "completed")?.id ?? RunId.make(`${source.thread.id}-run-1`));
  const target = {
    ...source.thread,
    id: command.targetThreadId,
    title: command.title ?? `Fork: ${source.thread.title}`,
    lineage: {
      parentThreadId: source.thread.id,
      relationshipToParent: "fork" as const,
      rootThreadId: source.thread.lineage.rootThreadId,
      ...(command.sideChat === true ? { sideChat: true } : {}),
    },
    forkedFrom: { type: "run" as const, threadId: source.thread.id, runId: sourceRunId },
    activeProviderThreadId: null,
    pinnedAt: null,
    createdBy: command.createdBy,
    creationSource: command.creationSource,
    createdAt: at,
    updatedAt: at,
    lastVisitedAt: at,
  };
  const { providerThreadId: _none, ...markerBase } = itemBase(
      {
        threadId: target.id,
        runId: null,
        ordinal: 0,
        id: TurnItemId.make(`${target.id}-fork-marker`),
        at,
        endedAt: at,
      },
      "completed",
  );
  const marker = {
    ...markerBase,
    type: "fork" as const,
    source: { type: "run" as const, threadId: source.thread.id, runId: sourceRunId },
    targetThreadId: target.id,
  };
  server.addThread({
    ...emptyProjection(target),
    turnItems: [marker],
    visibleTurnItems: visibleItemsOf([marker]),
  });
});
