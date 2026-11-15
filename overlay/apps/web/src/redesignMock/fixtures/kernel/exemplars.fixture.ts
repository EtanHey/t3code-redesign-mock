// Three exemplars that exercise the DSL end to end: a finished multi-turn conversation, a thread
// that is working and streaming when it is opened, and a thread waiting on a question.
import {
  assistant,
  command,
  exec,
  fileChange,
  hold,
  item,
  question,
  reasoning,
  script,
  step,
  thread,
  turn,
} from "../../api";

const DEBOUNCE_DIFF = `@@ -12,9 +12,14 @@ export function NotesSearch({ onQuery }: NotesSearchProps) {
-  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
-    onQuery(event.target.value);
-  };
+  const debouncedQuery = useDebouncedCallback(onQuery, 180);
+  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
+    setValue(event.target.value);
+    debouncedQuery(event.target.value);
+  };
`;

const conversation = thread({
  id: "k01-debounce-search",
  project: "conversation",
  title: "Debounce the search box on the notes list",
  scenario: { id: "K01", label: "Finished multi-turn conversation", waitForText: "180 ms" },
  turns: [
    turn({
      at: "2h",
      took: "1m 40s",
      user: "Typing in the notes search box re-renders the whole list on every key. Can you debounce it?",
      items: [
        reasoning("The list re-filters on every keystroke because `onQuery` runs inside the change handler."),
        item((base) => ({
          ...base,
          type: "file_search",
          pattern: "onQuery",
          results: [
            { fileName: "src/notes/NotesSearch.tsx", line: 14, preview: "onQuery(event.target.value);" },
            { fileName: "src/notes/NotesList.tsx", line: 31, preview: "<NotesSearch onQuery={setQuery} />" },
          ],
        })),
        fileChange({ path: "src/notes/NotesSearch.tsx", additions: 6, deletions: 2, diff: DEBOUNCE_DIFF }),
        command({ input: "vp test src/notes", output: " ✓ src/notes/NotesSearch.test.tsx (4 tests) 212ms\n\n Test Files  1 passed (1)\n      Tests  4 passed (4)\n" }),
        assistant(
          "Done. The input keeps its own value and calls `onQuery` through a debounced callback, so the list filters **180 ms** after the last key instead of on every key.\n\n- `src/notes/NotesSearch.tsx`: `useDebouncedCallback(onQuery, 180)`\n- The four existing search tests still pass.",
        ),
      ],
    }),
    turn({
      at: "1h 52m",
      took: "35s",
      user: "Does the debounce cancel when the component unmounts?",
      items: [
        reasoning("Checking the hook's cleanup."),
        assistant(
          "Yes. `useDebouncedCallback` clears its pending timer in the effect cleanup, so an unmounted search box never calls `onQuery` late. I added a test for it:\n\n```ts\nunmount();\nvi.advanceTimersByTime(200);\nexpect(onQuery).not.toHaveBeenCalled();\n```",
        ),
      ],
    }),
    turn({
      at: "1h 40m",
      took: "20s",
      user: "Great, thanks.",
      items: [assistant("You're welcome. Everything is committed on `notes/debounce-search`.")],
    }),
  ],
});

const STREAMED_UPDATE =
  "The trace context now flows from the HTTP handler into the orders service, so each span carries the request id. Next I'm wiring the database client so queries show up as child spans, then I'll run the orders tests.";

const working = thread({
  id: "k02-orders-tracing",
  project: "live",
  title: "Add request tracing to the orders endpoint",
  scenario: { id: "K02", label: "Working and streaming when opened", waitForText: "trace context" },
  turns: [
    turn({
      at: "25m",
      took: "2m",
      user: "Add tracing to the orders endpoint so we can see where the time goes.",
      items: [
        reasoning("The service already exports an OpenTelemetry tracer; the orders route never starts a span."),
        assistant("I'll add a span around the handler and pass the context down to the service layer."),
      ],
    }),
    turn({
      at: "40s",
      status: "running",
      user: "Also include the database calls.",
      items: [
        reasoning("The query helper takes an optional context; threading it through covers every call."),
        command({ input: "rg -n \"db.query\" src/orders", output: "src/orders/repository.ts:18:  return db.query(sql, params);\nsrc/orders/repository.ts:41:  return db.query(sql, [id]);\n" }),
        assistant("The trace context", { phase: "commentary", streaming: true }),
      ],
    }),
  ],
  // When first opened, the planted reply keeps streaming, a test run follows, and a watcher stays up.
  onOpen: script([
    ...STREAMED_UPDATE.split(" ")
      .slice(3)
      .map((word, index, words) =>
        step("90ms", (run) => {
          const projection = run.server.projection(run.threadId);
          const streaming = projection?.turnItems.findLast(
            (candidate) => candidate.type === "assistant_message" && candidate.streaming,
          );
          if (!streaming) return;
          const text = `The trace context ${words.slice(0, index + 1).join(" ")}`;
          run.update(streaming.id, (current) => (current.type === "assistant_message" ? { ...current, text } : current));
          if (index === words.length - 1) run.complete(streaming.id);
        }),
      ),
    exec(
      { input: "vp test src/orders", output: " ✓ src/orders/tracing.test.ts (3 tests) 418ms\n\n      Tests  3 passed (3)\n" },
      "2.5s",
    ),
    hold({ input: "vp dev --filter orders-api", output: "orders-api listening on :4100\n" }),
  ]),
});

const waiting = thread({
  id: "k03-settings-migration",
  project: "requests",
  title: "Pick a migration strategy for the settings table",
  scenario: { id: "K03", label: "Waiting on a question", waitForText: "How should existing rows move" },
  runtimeMode: "approval-required",
  turns: [
    turn({
      at: "12m",
      status: "waiting",
      user: "We need to split `settings.value` into typed columns. Plan the migration.",
      items: [
        reasoning("There are 1.2M rows; a single blocking migration would lock the table for minutes."),
        command({ input: "psql -c \"select count(*) from settings\"", output: " count\n---------\n 1204331\n(1 row)\n" }),
        question([
          {
            id: "strategy",
            header: "Strategy",
            question: "How should existing rows move to the new columns?",
            required: true,
            options: [
              {
                label: "Backfill in batches",
                description: "Add nullable columns, backfill 10k rows at a time, then switch reads.",
                value: "batched",
              },
              {
                label: "Single migration",
                description: "One transaction during the maintenance window. Simplest, but locks the table.",
                value: "single",
              },
              {
                label: "Dual write",
                description: "Write both shapes for a release, then drop the old column.",
                value: "dual-write",
              },
            ],
          },
        ]),
      ],
    }),
  ],
});

export default [conversation, working, waiting];
