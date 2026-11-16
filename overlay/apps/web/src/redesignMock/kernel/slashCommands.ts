// Provider slash commands sent as messages (`/compact`, `/goal clear`, `/review`...). The real
// server hands each to the provider as a turn of its own, and the provider answers with the
// command's result instead of agent work. Here each gets a short scripted run that ends, so the
// client shows its one slash-command row and a result, never the generic "still working" loop.
import {
  isCompactionCommandMessage,
  parseGoalCommand,
  ProviderDriverKind,
  type OrchestrationV2GoalCommand,
  type OrchestrationV2ProviderGoal,
  type OrchestrationV2ProviderThread,
  type ThreadId,
} from "@t3tools/contracts";

import { now } from "./clock";
import {
  exec,
  finish,
  hold,
  runScript,
  say,
  script,
  status,
  step,
  think,
  type RunHandle,
  type RunScript,
  type ScriptPart,
} from "./script";
import type { MockServer } from "./server";

interface CommandText {
  readonly text: string;
  readonly attachments: ReadonlyArray<unknown>;
}

// Reading ------------------------------------------------------------------------------------------

export function activeProviderThread(server: MockServer, threadId: ThreadId): OrchestrationV2ProviderThread | undefined {
  const projection = server.projection(threadId);
  const id = projection?.thread.activeProviderThreadId;
  return id ? projection?.providerThreads.find((candidate) => candidate.id === id) : undefined;
}

export function goalOf(server: MockServer, threadId: ThreadId): OrchestrationV2ProviderGoal | null {
  return activeProviderThread(server, threadId)?.goal ?? null;
}

/** The goal command a message carries, as the server reads it. */
export function goalCommandOf(message: CommandText): OrchestrationV2GoalCommand | null {
  return parseGoalCommand({ text: message.text, attachments: message.attachments });
}

export function isCompaction(message: CommandText): boolean {
  return isCompactionCommandMessage({ role: "user", text: message.text, attachments: message.attachments });
}

/** Provider commands the timeline presents (her `timelineSlashCommands.ts`), other than goal and compact. */
const OTHER_COMMANDS = new Set(["clear", "feedback", "init", "review", "code-review", "security-review", "context", "usage", "mcp"]);

function otherCommandOf(message: CommandText): { readonly name: string; readonly args: string } | null {
  if (message.attachments.length > 0) return null;
  const match = /^\/([a-z-]+)(?:\s+([\s\S]*))?$/u.exec(message.text.trim());
  if (!match || !OTHER_COMMANDS.has(match[1]!)) return null;
  return { name: match[1]!, args: (match[2] ?? "").trim() };
}

/** A message the server sends to the provider as a command turn rather than a prompt. */
export function isCommandMessage(message: CommandText): boolean {
  return isCompaction(message) || goalCommandOf(message) !== null || otherCommandOf(message) !== null;
}

// Writing ------------------------------------------------------------------------------------------

/** Updates the active provider thread, the record the shell reads goal and context from. */
function updateProviderThread(
  handle: RunHandle,
  change: (current: OrchestrationV2ProviderThread) => OrchestrationV2ProviderThread,
): void {
  const current = activeProviderThread(handle.server, handle.threadId);
  if (!current) return;
  handle.server.emit(handle.threadId, [
    { type: "provider-thread.updated", payload: { ...change(current), updatedAt: now() } },
  ]);
}

function setGoal(handle: RunHandle, goal: OrchestrationV2ProviderGoal | null): void {
  updateProviderThread(handle, (current) => ({ ...current, goal }));
}

const startRunning = status("500ms", "running");

// /compact -----------------------------------------------------------------------------------------

const COMPACTION_SUMMARY =
  "Kept: what the thread is for, the decisions made so far and the open questions. Dropped: long command output, file listings and approaches that were abandoned.";

function compactScript(): RunScript {
  const key = {};
  return script([
    startRunning,
    step("300ms", (handle) => {
      const before = activeProviderThread(handle.server, handle.threadId)?.contextUsage?.usedTokens ?? 128_400;
      const driver = activeProviderThread(handle.server, handle.threadId)?.driver ?? ProviderDriverKind.make("codex");
      handle.remember(
        key,
        handle.addRaw((base) => ({
          ...base,
          completedAt: null,
          type: "compaction",
          driver,
          beforeTokenCount: before,
        })),
      );
    }),
    step("3.5s", (handle) => {
      const id = handle.recall(key);
      const item = id ? handle.item(id) : undefined;
      if (!id || item?.type !== "compaction") return;
      const before = item.beforeTokenCount ?? 128_400;
      const after = Math.min(before, Math.round(before * 0.11 + 8_200));
      handle.complete(id, (current) =>
        current.type === "compaction" ? { ...current, summary: COMPACTION_SUMMARY, afterTokenCount: after } : current,
      );
      updateProviderThread(handle, (current) =>
        current.contextUsage
          ? {
              ...current,
              contextUsage: {
                ...current.contextUsage,
                usedTokens: after,
                inputTokens: Math.round(after * 0.82),
                cachedInputTokens: Math.round(after * 0.4),
                outputTokens: Math.round(after * 0.18),
              },
            }
          : current,
      );
    }),
    finish("400ms"),
  ]);
}

// /goal --------------------------------------------------------------------------------------------

const GOAL_STATUS_WORDS: Record<OrchestrationV2ProviderGoal["status"], string> = {
  active: "active",
  paused: "paused",
  blocked: "blocked",
  usage_limited: "stopped by a usage limit",
  budget_limited: "stopped at its token budget",
  complete: "complete",
};

/** Goal work: the agent keeps going toward the objective until it is stopped or cleared. */
function goalWork(objective: string): ReadonlyArray<ScriptPart> {
  return [
    think(`Working toward the goal: ${objective}`, "1.4s"),
    exec({ input: "npm test -- --coverage", output: " Test Files  38 passed (38)\n      Tests  214 passed (214)\n All files  |   84.2 |\n" }),
    say("Working on the goal. This is the mock preview, so the work below keeps running until you stop it or clear the goal."),
    hold({ input: "npm test -- --watch", output: " Waiting for file changes...\n" }),
  ];
}

function goalScript(command: OrchestrationV2GoalCommand): RunScript {
  const reply = (text: string) => [say(text, { phase: "final_answer" }), finish()];
  return script([
    startRunning,
    step("700ms", (handle) => {
      const goal = goalOf(handle.server, handle.threadId);
      // Each branch decides what the rest of the run does: a control ends the turn, goal work goes on.
      const rest: ReadonlyArray<ScriptPart> = (() => {
        switch (command.type) {
          case "show":
            return reply(goal === null ? "No goal is set." : `Goal ${GOAL_STATUS_WORDS[goal.status]}: ${goal.objective}`);
          case "clear":
            if (goal === null) return reply("No goal is set.");
            setGoal(handle, null);
            return [finish()];
          case "pause":
            if (goal === null) return reply("No goal is set.");
            setGoal(handle, { ...goal, status: "paused" });
            return [finish()];
          case "resume":
            if (goal === null) return reply("No goal is set.");
            setGoal(handle, { ...goal, status: "active" });
            return goalWork(goal.objective);
          case "set":
            setGoal(handle, {
              objective: command.objective,
              status: "active",
              tokensUsed: 0,
              timeUsedSeconds: 0,
              checks: 0,
            });
            return goalWork(command.objective);
        }
      })();
      // The rest runs as this run's script from here on.
      continueWith(handle, script(rest));
    }),
  ]);
}

// Other provider commands --------------------------------------------------------------------------

function otherScript(name: string, args: string): RunScript {
  const answer = (text: string, after: ReadonlyArray<ScriptPart> = []) =>
    script([startRunning, ...after, say(text, { phase: "final_answer" }), finish()]);
  switch (name) {
    case "review":
    case "code-review":
      return answer(
        "Reviewed the uncommitted changes in `src/app/routes.ts` and `src/app/loader.ts`. No blocking issues: the loader split keeps the old exports, and the new route test covers the empty query. One suggestion: the debounce delay is duplicated in two files; keep it in one constant.",
        [think("Reading the diff against the base branch.", "1.2s"), ...exec({ input: "git diff --stat", output: " src/app/loader.ts | 14 ++++++++------\n src/app/routes.ts |  6 ++++--\n 2 files changed, 12 insertions(+), 8 deletions(-)\n" })],
      );
    case "security-review":
      return answer(
        "Security review of the pending changes: no secrets, no new network calls and no user input reaching a shell or a query. Nothing to fix.",
        [think("Checking the diff for secrets, injection and unsafe input handling.", "1.4s"), ...exec({ input: "git diff --name-only", output: "src/app/loader.ts\nsrc/app/routes.ts\n" })],
      );
    case "init":
      return answer(
        "In a real session this writes an `AGENTS.md` describing the project's layout, commands and conventions. The preview changes no files.",
        [think("Reading the project layout and its scripts.", "1.2s"), ...exec({ input: "ls", output: "README.md\npackage.json\nsrc\ntests\n" })],
      );
    case "feedback":
      return answer("In a real session this sends the thread and logs to the provider's team. The preview sends nothing anywhere.");
    case "clear":
      return answer("Started a fresh context. Earlier messages stay visible; the agent no longer sees them.");
    case "mcp":
      return answer("No MCP servers are connected in this preview.");
    case "usage":
      return answer("5-hour limit: 38% used, resets in about 2 hours. Weekly limit: 61% used, resets in 3 days.");
    case "context":
    default:
      return script([
        startRunning,
        step("400ms", (handle) => {
          const usage = activeProviderThread(handle.server, handle.threadId)?.contextUsage;
          const text =
            usage && usage.maxTokens
              ? `Context: ${Math.round(usage.usedTokens / 1_000)}k of ${Math.round(usage.maxTokens / 1_000)}k tokens used (${Math.round((usage.usedTokens / usage.maxTokens) * 100)}%). It compacts automatically when it gets close to full.`
              : "Context usage is not reported for this thread.";
          continueWith(handle, script([say(text, { phase: "final_answer" }), finish()]));
        }),
      ]);
  }
}

// Wiring -------------------------------------------------------------------------------------------

/** Swaps the rest of a running script for `next`, starting now. */
function continueWith(handle: RunHandle, next: RunScript): void {
  runScript(handle.server, handle.threadId, handle.runId, next);
}

/** The script for a provider command message, or null for an ordinary prompt. */
export function commandScriptFor(message: CommandText): RunScript | null {
  if (isCompaction(message)) return compactScript();
  const goal = goalCommandOf(message);
  if (goal) return goalScript(goal);
  const other = otherCommandOf(message);
  return other ? otherScript(other.name, other.args) : null;
}
