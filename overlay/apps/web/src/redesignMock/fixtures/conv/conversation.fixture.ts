import { EnvironmentId, MessageId, RunId, ThreadId } from "@t3tools/contracts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import { assistant, command, fileChange, item, MODELS, reasoning, thread, turn, userMessage } from "~/redesignMock/api";

const plain = thread({
  id: "c01-multi-turn", project: "conversation", title: "A finished conversation about note search",
  scenario: { id: "C01", label: "Plain multi-turn conversation", waitForText: "Search is ready" },
  turns: [
    turn({ at: "5h", user: "How should we search notes without slowing down typing?", items: [assistant("Keep the input responsive and debounce the expensive filter.\n\n- Store the input locally.\n- Call `filterNotes` after a short delay.")] }),
    turn({ at: "4h 55m", user: "What delay did you choose?", items: [assistant("Search is ready with a **180 ms** delay. The timer is cancelled on unmount.")] }),
  ],
});

const rich = thread({
  id: "c02-rich-markdown", project: "conversation", title: "Rich markdown: code, tables and diagrams",
  scenario: { id: "C02", label: "Rich markdown", waitForText: "Markdown examples" },
  turns: [turn({ at: "4h", user: "Show the release checklist with examples.", items: [assistant(`## Markdown examples

| Check | Result |
| :--- | ---: |
| Unit tests | 24 passed |
| Build | ready |

\`\`\`ts
export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
\`\`\`

A formula for the area of a square:

$$
A = s^2
$$

\`\`\`mermaid
flowchart LR
  Edit --> Test --> Release
\`\`\`

> [!NOTE]
> Run the checks before publishing.

<details><summary>More detail</summary>

The release includes the search fix and its tests.
</details>`)] })],
});

const steer = thread({
  id: "c05-steered-messages", project: "conversation", title: "Steered and promoted messages",
  scenario: { id: "C05", label: "Steered and promoted messages", waitForText: "Keep the existing shortcut" },
  turns: [turn({ at: "3h", took: "2m", user: "Update the notes keyboard shortcuts.", items: [
    reasoning("Checking the current shortcuts and their tests."),
    userMessage({ text: "Keep the existing shortcut for search.", inputIntent: "steer" }),
    command({ input: "vp test shortcuts", output: "Tests  8 passed (8)" }),
    userMessage({ text: "Also document the new shortcut.", inputIntent: "promoted_queued_to_steer" }),
    assistant("The search shortcut is unchanged, and the new shortcut is documented."),
  ] })],
});

const model = thread({
  id: "c06-model-switch", project: "conversation", title: "A model switch in the conversation",
  scenario: { id: "C06", label: "Model switch", waitForText: "Review the implementation" },
  turns: [turn({ at: "2h 50m", user: "Sketch the implementation.", model: MODELS.sol, items: [assistant("I would debounce the filter and keep the input local.")] }),
    turn({ at: "2h 45m", model: MODELS.terra, user: { text: "Review the implementation.", extra: { modelSwitch: { from: MODELS.sol, to: MODELS.terra } } }, items: [assistant("The cleanup cancels pending work and the test covers unmounting.")] })],
});

const fresh = thread({
  id: "c07-fresh-context", project: "conversation", title: "A message with fresh context",
  scenario: { id: "C07", label: "Fresh context", waitForText: "Start fresh" },
  turns: [turn({ at: "2h 30m", user: "Summarize the old plan.", items: [assistant("The earlier plan used a delayed filter.")] }),
    turn({ at: "2h 25m", user: { text: "Start fresh and explain the note editor.", extra: { freshContext: true } }, run: { freshContext: true }, items: [assistant("The editor stores a draft locally and saves it on request.")] })],
});

const retry = thread({
  id: "c08-retried-run", project: "conversation", title: "A retried run",
  scenario: { id: "C08", label: "Retried run", waitForText: "The retry completed" },
  turns: [turn({ at: "2h 10m", status: "failed", user: "Check the note export.", items: [item(base => ({ ...base, type: "error", status: "failed", failure: { class: "provider_error", message: "The request was interrupted.", code: null, retryable: true } }))] }),
    turn({ at: "2h 8m", user: { text: "Check the note export.", extra: { retryOfRunId: RunId.make("c08-retried-run-run-1") } }, items: [assistant("The retry completed: the export preserves note titles and timestamps.")] })],
});

const long = thread({
  id: "c09-long-conversation", project: "conversation", title: "Long conversation with worked-for summaries",
  scenario: { id: "C09", label: "Long conversation and work folds", waitForText: "All checks are complete" },
  turns: [
    ...Array.from({ length: 9 }, (_, index) => turn({ at: `${100 - index * 6}m`, took: "2m 14s", user: `Improve notes workflow, step ${index + 1}.`, items: [reasoning("Reviewing the existing behavior and tests."), fileChange({ path: `src/notes/step-${index + 1}.ts`, additions: 7, deletions: 2 }), command({ input: "vp test notes", output: "Tests  12 passed (12)" }), assistant(`Step ${index + 1} is complete and covered by tests.`)] })),
    turn({ at: "40m", took: "2m 14s", user: "Summarize the work.", items: [reasoning("Checking the full list of changes."), fileChange({ path: "src/notes/summary.ts", additions: 12, deletions: 3 }), assistant("All checks are complete. The notes workflow is ready to review.")] }),
  ],
});

const commentary = thread({
  id: "c04-commentary", project: "conversation", title: "Commentary and final answer",
  scenario: { id: "C04", label: "Commentary and final answer", waitForText: "The notes are indexed" },
  turns: [turn({ at: "3h 30m", user: "How does note indexing work?", items: [assistant("I'll trace the indexing path.", { phase: "commentary" }), command({ input: "rg index src/notes", output: "src/notes/index.ts: export function indexNote()" }), assistant("The notes are indexed when they are saved, then looked up by title and body.", { phase: "final_answer" })] }),
    turn({ at: "3h 25m", user: `Can you expand on this? ${serializeAssistantCitation({ version: 1, environmentId: EnvironmentId.make("redesign-preview"), threadId: ThreadId.make("c04-commentary"), messageId: MessageId.make("c04-commentary-item-3"), text: "indexed when they are saved", start: 14, end: 41, prefix: "The notes are ", suffix: ", then looked up by title and bo", comment: "Does this happen synchronously?" })}`, items: [assistant("Yes, indexing runs as part of the save operation.")] })],
});

const sent = thread({
  id: "c11-sent-message", project: "conversation", title: "A message sent during a run",
  scenario: { id: "C11", label: "Sent message", waitForText: "The export is ready for review" },
  turns: [turn({ at: "30m", user: "Let me know when the export is ready.", items: [item(base => ({ ...base, type: "dynamic_tool", toolName: "send_to_user", input: { message: "The export is ready for review." }, output: { sentMessage: "The export is ready for review." } })), assistant("The export contains titles, timestamps and note content.")] })],
});

export default [plain, rich, commentary, steer, model, fresh, retry, long, sent];
