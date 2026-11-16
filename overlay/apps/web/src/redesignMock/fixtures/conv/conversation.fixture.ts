import { EnvironmentId, MessageId, NodeId, ProviderTurnId, RunAttemptId, RunId, ThreadId } from "@t3tools/contracts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import { assistant, command, fileChange, item, MODELS, thread, turn, userMessage, visibleItemsOf } from "~/redesignMock/api";

import { openDemoWork } from "./open-state";

openDemoWork("c08-retried-run", { fromTop: true, runNumbers: [1, 2] });
openDemoWork("c04-commentary", { fromTop: true });
openDemoWork("c05-steered-messages", { fromTop: true });

const plain = thread({
  id: "c01-multi-turn", project: "conversation", title: "A finished conversation about note search",
  scenario: { id: "C01", label: "Plain multi-turn conversation", waitForText: "Search is ready" },
  turns: [
    turn({ at: "5h", user: "How should we search notes without slowing down typing?", items: [assistant("Keep the input responsive and debounce the expensive filter.\n\n- Store the input locally.\n- Call `filterNotes` after a short delay.")] }),
    turn({ at: "4h 55m", user: "What delay did you choose?", items: [assistant("Search is ready with a **180 ms** delay. The timer is cancelled on unmount.")] }),
  ],
});

const rich = thread({
  id: "c02-rich-markdown", project: "conversation", title: "Rich markdown: the search release notebook",
  scenario: { id: "C02", label: "Markdown: code, math, diagrams, alerts and details", waitForText: "Search release notebook" },
  turns: [turn({ at: "4h", user: "Write a release notebook for the new note search. Include examples I can paste into the project.", items: [assistant(String.raw`# Search release notebook

## 1. The ranking model

A title match gets weight $w_t = 3$, while a body match gets $w_b = 1$.
For query terms $Q$, the document score is:

$$
S(d, Q) = \sum_{q \in Q} \left(3\,\mathbf{1}_{q \in title(d)} + \mathbf{1}_{q \in body(d)}\right)
$$

> Fast typing should feel local, even when the index is busy.

### Release checklist

1. Prepare the index
   - Normalize whitespace and case.
   - Preserve the original title for display.
     - Empty titles become “Untitled note”.
     - Archived notes stay out of default results.
2. Verify the interaction
   - Type quickly, then clear the query.
   - Navigate results with the keyboard.
3. Ship after the migration check.

## 2. Query budget by dataset

| Dataset | Indexed notes | Median query (ms) | p95 query (ms) | Index size (MiB) | Title weight | Body weight | Release gate |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | :--- |
| Personal notebook | 240 | 2.1 | 4.8 | 0.3 | 3 | 1 | Pass |
| Shared handbook | 12,800 | 8.4 | 18.2 | 14.6 | 3 | 1 | Pass |
| Imported archive | 95,000 | 31.7 | 72.9 | 108.4 | 3 | 1 | Review memory |

## 3. Implementation snippets

TypeScript keeps the UI query separate from the debounced request:

\`\`\`typescript
const query = signal("");
const results = debounce(query, 180);
const matches = computed(() => index.search(results.value));
\`\`\`

SQL limits the candidate set before ranking:

\`\`\`sql
SELECT id, title, updated_at
FROM notes
WHERE archived_at IS NULL AND search_text LIKE :query
ORDER BY updated_at DESC
LIMIT 50;
\`\`\`

Python checks the exported fixture:

\`\`\`python
from collections import Counter
counts = Counter(note["id"] for note in exported_notes)
assert all(count == 1 for count in counts.values())
\`\`\`

Run the checks from the project root:

\`\`\`bash
pnpm test src/search
pnpm build
\`\`\`

## 4. Data flow

\`\`\`mermaid
flowchart LR
  Input[Query input] --> Debounce[180 ms debounce]
  Debounce --> Index[Local search index]
  Index --> Rank[Rank candidates]
  Rank --> Results[Keyboard-navigable results]
  Save[Save note] --> Index
\`\`\`

## 5. Release notes

> [!NOTE]
> Search excludes archived notes by default.

> [!TIP]
> Use a quoted phrase to keep adjacent words together.

> [!IMPORTANT]
> Rebuild the index once after importing an older export.

> [!WARNING]
> The 95,000-note archive needs a memory review before enabling background indexing.

> [!CAUTION]
> Do not delete the previous index until the replacement has passed its count check.

<details><summary>Why debounce instead of throttle?</summary>

Debounce waits for a pause in typing, so we avoid ranking partial words. Clearing the field is immediate; it cancels the pending search and restores recent notes.

\`\`\`json
{ "debounceMs": 180, "maxResults": 50, "includeArchived": false }
\`\`\`

</details>

See the [query syntax guide](#3-implementation-snippets) and [release checklist](#release-checklist). The archive memory check remains open.`.replaceAll("\\`", "`"))] })],
});

const steer = thread({
  id: "c05-steered-messages", project: "conversation", title: "Steer a shortcut change, then promote a queued note",
  scenario: { id: "C05", label: "Interleaved steered and promoted messages", waitForText: "Shortcut behavior is ready" },
  turns: [turn({ at: "3h", took: "3m 12s", user: "Add keyboard shortcuts for note search and the command menu.", items: [
    assistant("I'll check the existing bindings before changing the keymap.", { phase: "commentary" }),
    command({ input: "rg 'mod\\+|shortcut' src/keymap.ts", output: "12: search: 'mod+k'\n13: commandMenu: 'mod+shift+p'" }),
    userMessage({ text: "Keep the existing shortcut for search. Only add a shortcut for a new note.", inputIntent: "steer" }),
    assistant("Keeping Mod+K for search. I'll bind Mod+Alt+N to a new note and leave the command menu alone.", { phase: "commentary" }),
    fileChange({ path: "src/keymap.ts", additions: 1, deletions: 0, diff: "@@ -12,2 +12,3 @@\n search: 'mod+k',\n commandMenu: 'mod+shift+p',\n+newNote: 'mod+alt+n'," }),
    userMessage({ text: "I queued this earlier: document the new shortcut in the help menu too.", inputIntent: "promoted_queued_to_steer" }),
    assistant("The queued documentation request is now part of this turn. Both the keymap and help menu use Mod+Alt+N.", { phase: "commentary" }),
    command({ input: "pnpm test src/keymap.test.ts", output: "PASS src/keymap.test.ts\n  ✓ search keeps Mod+K\n  ✓ new note opens with Mod+Alt+N\n  ✓ help labels match the keymap\nTests: 9 passed" }),
    assistant("Shortcut behavior is ready: **Mod+K** still opens search, **Mod+Alt+N** creates a note, and the help menu lists both. The nine keymap tests pass."),
  ] })],
});

const model = thread({
  id: "c06-model-switch", project: "conversation", title: "A model switch in the conversation",
  scenario: { id: "C06", label: "Model switch", waitForText: "Review the implementation" },
  turns: [turn({ at: "2h 50m", user: "Sketch the implementation.", model: MODELS.sol, items: [assistant("Keep the input value local, debounce only the expensive filter, and cancel the timer when the editor unmounts. Add cases for clearing the field and navigating away before the delay expires.")] }),
    turn({ at: "2h 45m", model: MODELS.terra, user: { text: "Review the implementation.", extra: { modelSwitch: { from: MODELS.sol, to: MODELS.terra } } }, items: [assistant("The implementation cancels pending work on unmount and bypasses the delay when the query is cleared. The remaining gap is keyboard navigation: preserve the selected note by id when results reorder, then test the ArrowDown → query change sequence.")] })],
});

const fresh = thread({
  id: "c07-fresh-context", project: "conversation", title: "A message with fresh context",
  scenario: { id: "C07", label: "Fresh context", waitForText: "Start fresh" },
  turns: [turn({ at: "2h 30m", user: "Summarize the old plan.", items: [assistant("The earlier plan coupled search to the editor save loop. We agreed to separate those paths: drafts save on an explicit action, while search uses the last indexed version. Carry forward only that decision.")] }),
    turn({ at: "2h 25m", user: { text: "Start fresh and explain the note editor.", extra: { freshContext: true } }, run: { freshContext: true }, items: [assistant("The editor keeps an unsaved draft in local state. Save writes the note and updates the search index in one transaction. Search never reads a half-written draft.\n\n- Escape closes search without discarding the draft.\n- A failed save leaves the draft visible with a retry action.\n- Switching notes asks before replacing unsaved text.")] })],
});

// The user retries a failed run. Its replacement also carries a superseded provider attempt;
// node/provider-turn links let the native timeline fold that interrupted work.
const retry = thread({
  id: "c08-retried-run", project: "conversation", title: "Retry an interrupted export check",
  scenario: { id: "C08", label: "Retried run with superseded attempt fold", waitForText: "The retry completed" },
  turns: [turn({ at: "2h 15m", took: "24s", status: "failed", user: "Check whether the note export preserves titles, Unicode and timestamps.", items: [
    item(base => ({ ...base, type: "error", status: "failed", failure: { class: "transport_error", message: "The provider connection closed before the export check returned a result.", code: null, retryable: true } })),
  ] }), turn({ at: "2h 10m", took: "2m 25s", user: { text: "Retry the interrupted export check with the same saved sample.", extra: { retryOfRunId: RunId.make("c08-retried-run-run-1") } }, items: [
    assistant("I'll inspect the serializer and run a round-trip export.", { phase: "commentary" }),
    command({ input: "pnpm test export-roundtrip", status: "failed", output: "Provider connection lost before a test result was received. No result recorded.", exitCode: 1 }),
    assistant("The first attempt ended without a result. Re-running the same sample now.", { phase: "commentary" }),
    command({ input: "pnpm test export-roundtrip", output: "PASS export-roundtrip.test.ts\n  ✓ preserves titles\n  ✓ round-trips accented and emoji text\n  ✓ retains ISO timestamps\nTests: 3 passed" }),
    assistant("The retry completed: all three round-trip checks pass. The export retains the original title, Unicode body text and ISO timestamp. The interrupted attempt above has no test result."),
  ] })],
  projection: p => {
    const first = p.attempts[1]!;
    const providerTurn = p.providerTurns[1]!;
    const secondId = RunAttemptId.make("c08-export-attempt-2");
    const secondNode = NodeId.make("c08-export-node-2");
    const secondTurn = ProviderTurnId.make("c08-export-turn-2");
    const boundary = p.turnItems[5]!.startedAt!;
    const items = p.turnItems.map(i => i.runId !== first.runId ? i : ({ ...i,
      nodeId: i.ordinal < 5 ? first.rootNodeId : secondNode,
      providerTurnId: i.ordinal < 5 ? first.providerTurnId : secondTurn }));
    return { ...p,
      runs: p.runs.map(r => r.id === first.runId ? { ...r, activeAttemptId: secondId } : r),
      attempts: [p.attempts[0]!, { ...first, status: "superseded", completedAt: boundary }, { ...first, id: secondId,
        attemptOrdinal: 2, reason: "retry", rootNodeId: secondNode, providerTurnId: secondTurn, startedAt: boundary }],
      providerTurns: [p.providerTurns[0]!, { ...providerTurn, status: "cancelled", completedAt: boundary },
        { ...providerTurn, id: secondTurn, nodeId: secondNode, runAttemptId: secondId, startedAt: boundary }],
      turnItems: items, visibleTurnItems: visibleItemsOf(items),
    };
  },
});

const commentary = thread({
  id: "c04-commentary", project: "conversation", title: "Trace indexing: commentary, final answer and a quoted follow-up",
  scenario: { id: "C04", label: "Commentary, final answer and citation", waitForText: "Indexing runs inside the save transaction" },
  turns: [turn({ at: "3h 30m", took: "1m 48s", user: "Does search ever see an old title after I save a note? Trace the indexing path.", items: [
    assistant("I'll trace the save transaction first, then check what happens if updating the index fails.", { phase: "commentary" }),
    command({ input: "rg -n 'indexNote|transaction' src/notes", output: "src/notes/save.ts:18: return db.transaction(async tx => {\nsrc/notes/save.ts:21: await indexNote(tx, saved);\nsrc/notes/index.ts:8: export async function indexNote(tx, note) {" }),
    assistant("The index write uses the same transaction as the note write. I'll check the failure case before treating that as a guarantee.", { phase: "commentary" }),
    command({ input: "pnpm test src/notes/save.test.ts", output: "PASS src/notes/save.test.ts\n  ✓ rolls back the note when index update fails\n  ✓ searches the new title after commit\nTests: 6 passed" }),
    assistant("Indexing runs inside the save transaction. Search sees either the old note and old index, or the new note and new index after commit.\n\nIf indexing fails, the save rolls back and the editor keeps your unsaved draft. The six save tests include rollback and title replacement.", { phase: "final_answer" }),
  ] }),
    turn({ at: "3h 25m", took: "45s", user: `Can you expand on this? ${serializeAssistantCitation({ version: 1, environmentId: EnvironmentId.make("redesign-preview"), threadId: ThreadId.make("c04-commentary"), messageId: MessageId.make("c04-commentary-item-5"), text: "Indexing runs inside the save transaction.", start: 0, end: 42, prefix: "", suffix: " Search sees either the old note", comment: "Does this block typing?" })}`, items: [
      assistant("Typing stays local to the editor; it does not wait on the transaction. Only Save waits for commit. If that fails, the draft stays in place and the save bar shows a retry action."),
    ] })],
});

export default [plain, rich, commentary, steer, model, fresh, retry];
