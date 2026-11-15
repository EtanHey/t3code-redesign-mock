// X07: a fork and a side chat. The source thread carries a "Conversation fork" marker that opens
// the fork; the fork carries "Forked from conversation" that opens the source. The side chat is a
// hidden fork (it never shows in the sidebar): it lives as a tab beside the source thread, in the
// right panel's side chats.
import { ProviderThreadId, RunId, ThreadId } from "@t3tools/contracts";

import { assistant, command, item, MODELS, reasoning, thread, turn } from "~/redesignMock/api";

const SOURCE = "x07-fork-source";
const FORK = "x07-fork-copy";
const SIDE_CHAT = "x07-side-chat";

const sourceRun = (index: number) => RunId.make(`${SOURCE}-run-${index}`);
const rootedAt = (parent: string) => ({
  parentThreadId: ThreadId.make(parent),
  rootThreadId: ThreadId.make(SOURCE),
});

const source = thread({
  id: SOURCE,
  project: "agents",
  title: "Fork: storage layer for the notes app",
  model: MODELS.opus,
  scenario: {
    id: "X07",
    label: "Fork marker in the source thread; the fork and a side chat open from it",
    waitForText: "Conversation fork",
  },
  turns: [
    turn({
      at: "50m",
      took: "1m",
      user: "Which storage should the notes app use for offline sync?",
      items: [
        reasoning("SQLite in the browser covers offline. The question is whether to also keep a server database."),
        assistant("SQLite in the browser (via OPFS) for the offline copy, with Postgres on the server. Writes go to SQLite first and sync in the background."),
        // The marker the source shows where a fork was taken: it opens the fork.
        item(({ providerThreadId: _none, ...base }) => ({
          ...base,
          type: "fork",
          source: { type: "provider_thread", providerThreadId: ProviderThreadId.make(`${SOURCE}-provider-thread`) },
          targetThreadId: ThreadId.make(FORK),
        })),
      ],
    }),
    turn({
      at: "35m",
      took: "50s",
      user: "Sketch the sync loop.",
      items: [
        command({
          input: "cat docs/sync-notes.md",
          output: "# Sync\n\n1. Write to SQLite.\n2. Queue a change record.\n3. Flush the queue when online.\n",
        }),
        assistant("The loop is write, queue, flush. I'd keep each change record small and idempotent so a retry never duplicates a note."),
      ],
    }),
  ],
});

const fork = thread({
  id: FORK,
  project: "agents",
  title: "Fork: use Postgres only, no offline copy",
  model: MODELS.opus,
  createdAt: "49m",
  turns: [
    turn({
      at: "50m",
      took: "1m",
      user: "Which storage should the notes app use for offline sync?",
      items: [
        assistant("SQLite in the browser (via OPFS) for the offline copy, with Postgres on the server. Writes go to SQLite first and sync in the background."),
        // The marker the fork shows at its start: it opens the source conversation.
        item(({ providerThreadId: _none, ...base }) => ({
          ...base,
          type: "fork",
          source: { type: "run", threadId: ThreadId.make(SOURCE), runId: sourceRun(1) },
          targetThreadId: ThreadId.make(FORK),
        })),
      ],
    }),
    turn({
      at: "20m",
      took: "45s",
      user: "Actually, drop the offline copy. What does Postgres-only change?",
      items: [
        assistant("The sync queue and the SQLite layer both go away. Notes load from the API; the cost is that the app is read-only without a connection."),
      ],
    }),
  ],
  thread: {
    lineage: { ...rootedAt(SOURCE), relationshipToParent: "fork" },
    forkedFrom: { type: "run", threadId: ThreadId.make(SOURCE), runId: sourceRun(1) },
  },
});

const sideChat = thread({
  id: SIDE_CHAT,
  project: "agents",
  title: "Side chat: what is OPFS?",
  model: MODELS.sonnet,
  createdAt: "30m",
  turns: [
    turn({
      at: "28m",
      took: "30s",
      user: "Quick aside: what does OPFS stand for?",
      items: [assistant("Origin Private File System: a sandboxed file area each site gets in the browser. SQLite builds use it to keep a database across reloads.")],
    }),
  ],
  thread: {
    lineage: { ...rootedAt(SOURCE), relationshipToParent: "fork", sideChat: true },
    forkedFrom: { type: "run", threadId: ThreadId.make(SOURCE), runId: sourceRun(2) },
  },
});

export default [source, fork, sideChat];
