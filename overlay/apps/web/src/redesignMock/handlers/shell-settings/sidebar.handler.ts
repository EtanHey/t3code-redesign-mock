import { ORCHESTRATION_V2_WS_METHODS, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Stream from "effect/Stream";
import { agoIso, now, onCommand, rpc, stream, type HandlerContext } from "~/redesignMock/api";

function older(context: HandlerContext): OrchestrationV2ThreadShell[] {
  return [...context.server.threads.values()]
    .filter((record) => record.olderSettled)
    .map((record) => context.server.shellOf(record))
    .filter(
      (shell) => shell.settledAt !== null && shell.archivedAt === null && shell.deletedAt === null,
    );
}
function counts(shells: ReadonlyArray<OrchestrationV2ThreadShell>) {
  return [...new Set(shells.map((shell) => shell.projectId))].map((projectId) => ({
    projectId,
    count: shells.filter((shell) => shell.projectId === projectId).length,
  }));
}
export default [
  stream(ORCHESTRATION_V2_WS_METHODS.subscribeShell, (_input, context) =>
    Stream.map(context.server.subscribeShell(), (frame) =>
      frame.kind !== "snapshot"
        ? frame
        : {
            ...frame,
            snapshot: {
              ...frame.snapshot,
              olderSettled: {
                before: agoIso("7d"),
                asOfSequence: context.server.sequence,
                counts: counts(older(context)),
              },
            },
          },
    ),
  ),
  rpc(ORCHESTRATION_V2_WS_METHODS.getOlderSettledThreads, (input, context) => {
    const shells = older(context).filter(
      (shell) =>
        (!input.projectIds || input.projectIds.includes(shell.projectId)) &&
        shell.settledAt !== null &&
        DateTime.formatIso(shell.settledAt) < input.before.settledAt,
    );
    return {
      snapshotSequence: context.server.sequence,
      threads: input.limit === 0 ? [] : shells.slice(0, input.limit),
      counts: counts(shells),
    };
  }),
  onCommand("thread.guest-message.dismiss", (command, { server }) => {
    const projection = server.projection(command.threadId);
    const share = projection?.thread.guestShare;
    if (!projection || !share) return;
    server.emit(command.threadId, [
      {
        type: "thread.guest-share-updated",
        payload: {
          ...projection.thread,
          guestShare: {
            ...share,
            messages: share.messages.map((message) =>
              message.id === command.guestMessageId ? { ...message, status: "dismissed" } : message,
            ),
          },
        },
      },
    ]);
  }),
  onCommand("thread.guest-share.close", (command, { server }) => {
    const projection = server.projection(command.threadId);
    if (projection)
      server.emit(command.threadId, [
        { type: "thread.guest-share-updated", payload: { ...projection.thread, guestShare: null } },
      ]);
  }),
  onCommand("message.dispatch", (command, { server }) => {
    if (!command.guestMessageId) return;
    const projection = server.projection(command.threadId);
    const share = projection?.thread.guestShare;
    if (!projection || !share) return;
    server.emit(command.threadId, [
      {
        type: "thread.guest-share-updated",
        payload: {
          ...projection.thread,
          guestShare: {
            ...share,
            messages: share.messages.map((message) =>
              message.id === command.guestMessageId ? { ...message, status: "sent" } : message,
            ),
          },
        },
      },
    ]);
  }),
  onCommand("thread.metadata.update", (command, { server }) => {
    if (!command.regenerateTitle) return;
    const projection = server.projection(command.threadId);
    if (!projection) return;
    server.emit(command.threadId, [
      {
        type: "thread.metadata-updated",
        payload: {
          ...projection.thread,
          title:
            command.threadId === "s03-rename-failed"
              ? projection.thread.title
              : "Review compact navigation and focus order",
          titleRegeneration: null,
          lastTitleRegeneration: {
            requestId: command.commandId,
            completedAt: now(),
            status: command.threadId === "s03-rename-failed" ? "failed" : "renamed",
            ...(command.threadId === "s03-rename-failed"
              ? {
                  message:
                    "The preview title generator is unavailable. The original title was kept.",
                }
              : {}),
          },
        },
      },
    ]);
  }),
];
