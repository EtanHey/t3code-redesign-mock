import { OrchestrationV2ThreadHistoryPage } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { assistant, command, fileChange, item, script, plus, step, thread, turn, visibleItemsOf, type ItemSpec } from "../../api";

// Each request is a small, distinct change in one notes project. Tool output is planted data.
const changes = [
  { ask: "Search jumps while I type. Keep the text field responsive.", path: "src/search/input.ts", before: "setResults(filterNotes(value));", after: "setQuery(value);\nscheduleSearch(value, 180);", test: "search-input", output: "9 passed: immediate input, delayed filter, clear cancels timer", answer: "Typing now updates local state immediately; the expensive filter waits for a 180 ms pause." },
  { ask: "Clearing the query should restore recent notes immediately.", path: "src/search/results.ts", before: "return index.search(query);", after: "if (!query.trim()) return recentNotes;\nreturn index.search(query);", test: "empty-query", output: "4 passed: whitespace, empty text, recent order, cancelled work", answer: "Empty and whitespace-only queries restore the recent list without waiting for the debounce." },
  { ask: "Keep the selected result when an edited note moves in the list.", path: "src/search/selection.ts", before: "selectedIndex = previousIndex;", after: "selectedId = previousId;\nselectedIndex = matches.findIndex(note => note.id === selectedId);", test: "result-selection", output: "6 passed: reorder, removed selection, ArrowDown after refresh", answer: "Selection follows the note id. If it leaves the results, selection moves to the first available note." },
  { ask: "Archived notes still appear in ordinary searches.", path: "src/search/query.sql", before: "WHERE search_text LIKE :query", after: "WHERE archived_at IS NULL\n  AND search_text LIKE :query", test: "archive-filter", output: "5 passed: archived excluded, unarchive restores, explicit archive view", answer: "Ordinary search now excludes archived notes. The archive view keeps its explicit include-archived path." },
  { ask: "A failed save must not leave a stale title in the search index.", path: "src/notes/save.ts", before: "await saveNote(note);\nawait indexNote(note);", after: "await db.transaction(async tx => {\n  await saveNote(tx, note);\n  await indexNote(tx, note);\n});", test: "save-transaction", output: "6 passed: commit, rollback, index failure, title replacement", answer: "Saving and indexing share a transaction. An index failure rolls back the note write and preserves the editor draft." },
  { ask: "The empty state needs to distinguish no notes from no matches.", path: "src/search/EmptyState.tsx", before: "return <p>No notes</p>;", after: "return query ? <p>No matches. Try fewer words.</p> : <p>Create your first note.</p>;", test: "empty-state", output: "3 passed: empty notebook, no matches, clearing query", answer: "An empty notebook offers a first-note action. A query with no matches suggests fewer words." },
  { ask: "Can exported notes keep emoji and accented titles intact?", path: "src/export/encode.ts", before: "return encodeAscii(notes);", after: "return new TextEncoder().encode(JSON.stringify(notes));", test: "unicode-export", output: "7 passed: accented titles, emoji, combining marks, round-trip", answer: "Exports use UTF-8 and retain Unicode titles and body text through a round trip." },
  { ask: "Importing the same export twice creates duplicate notes.", path: "src/import/merge.ts", before: "await insert(note);", after: "await upsert(note.id, note, { preserveLocalNewer: true });", test: "idempotent-import", output: "8 passed: repeated import, newer local edit, missing ids rejected", answer: "Import merges on stable note ids and preserves a newer local edit. Repeating the same import adds no duplicates." },
  { ask: "Add a visible count to the search heading.", path: "src/search/Heading.tsx", before: "return <h2>Search</h2>;", after: "return <h2>Search <span aria-live=\"polite\">{matches.length} results</span></h2>;", test: "result-count", output: "4 passed: singular, plural, zero, announcement after debounce", answer: "The heading shows the result count and announces settled updates politely." },
  { ask: "Escape should close search without losing the editor draft.", path: "src/search/keys.ts", before: "if (key === 'Escape') resetEditor();", after: "if (key === 'Escape') closeSearch({ restoreFocus: true });", test: "escape-search", output: "5 passed: closes overlay, restores focus, preserves draft", answer: "Escape closes the search overlay, restores focus, and leaves the unsaved draft intact." },
  { ask: "The index rebuild should report progress rather than freeze the page.", path: "src/search/rebuild.ts", before: "for (const note of notes) index.add(note);", after: "for (const batch of chunks(notes, 200)) {\n  await index.addBatch(batch);\n  reportProgress(index.count);\n}", test: "rebuild-progress", output: "6 passed: batch progress, cancellation, old index retained on error", answer: "Rebuild works in batches of 200, reports progress, and keeps the previous index if replacement fails." },
  { ask: "What changed in the benchmark after those fixes?", path: "bench/search.bench.ts", before: "bench('search', () => filterNotes(query));", after: "bench('search', () => index.search(query));\nrecordMemory(index.byteLength);", test: "search-benchmark", output: "shared handbook: 12,800 notes\np95 184ms → 58ms\nindex 14.6 MiB\narchive memory gate: pending", answer: "The shared handbook falls from 184 ms to 58 ms p95. Archive memory remains an open gate; latency alone is insufficient." },
  { ask: "Add a plain-language troubleshooting section for stale results.", path: "docs/search.md", before: "## Search", after: "## Search\nIf a saved note is missing, check the archive filter first.\nRebuild the index only after verifying the export count.", test: "docs-links", output: "11 internal links checked, no missing anchors", answer: "The guide now starts with the archive filter and count check before suggesting a rebuild." },
  { ask: "Check the final import and rebuild interaction before I review.", path: "src/search/import.test.ts", before: "expect(index.count).toBeGreaterThan(0);", after: "expect(index.count).toBe(notes.length);\nexpect(new Set(index.ids).size).toBe(notes.length);", test: "import-rebuild", output: "12 passed: duplicate import, rollback, cancelled rebuild, exact count", answer: "Import and rebuild agree on note count and identity. The final checks include cancellation and rollback, with no duplicate ids." },
];

function work(change: typeof changes[number]): ItemSpec[] {
  return [
    item(base => ({ ...base, type: "file_search", pattern: change.test, results: [
      { fileName: change.path, line: 12, preview: change.before.split("\n")[0]! },
      { fileName: `tests/${change.test}.test.ts`, line: 8, preview: `describe('${change.test}', () => {` },
    ] })),
    command({ input: `sed -n '1,65p' ${change.path}`, output: change.before }),
    fileChange({ path: change.path, additions: change.after.split("\n").length, deletions: change.before.split("\n").length,
      diff: `@@ -12,${change.before.split("\n").length} +12,${change.after.split("\n").length} @@\n${change.before.split("\n").map(l => `-${l}`).join("\n")}\n${change.after.split("\n").map(l => `+${l}`).join("\n")}` }),
    command({ input: `pnpm test ${change.test}`, output: change.output }),
  ];
}

const full = thread({
  id: "c09-long-conversation", project: "conversation", title: "A notebook search sprint: long history and expandable work",
  scenario: { id: "C09", label: "Long thread, worked-for folds and deferred work", waitForText: "Ready for a focused review" },
  turns: [
    ...changes.map((change, index) => turn({ at: `${240 - index * 12}m`, took: index % 2 === 0 ? "2m 14s" : "3m 8s",
      user: change.ask, items: [...work(change), assistant(change.answer)] })),
    turn({ at: "60m", took: "1m 26s", status: "running", user: "Give me a short review handoff, including anything still deferred.", items: [
      command({ input: "pnpm test search import export", output: "84 passed across 14 suites\nNo failures. Archive memory benchmark not run." }),
      assistant("Ready for a focused review: search responsiveness, stable selection, transactional indexing, Unicode export and repeatable imports are covered. Expand the **Worked for** rows to inspect commands and patches.\n\n**Still deferred:** archive memory measurement and a browser check on a low-memory device. No release claim until those are checked."),
    ] }),
  ],
  // History is an HTTP surface on this tip, not an RPC. Answer only this fixture's opaque cursor.
  onOpen: script([step("0ms", handle => {
    installHistory();
    const run = handle.run();
    const projection = handle.server.projection(handle.threadId);
    if (!run || !projection) return;
    const endedAt = plus(run.requestedAt, 86_000);
    handle.server.emit(handle.threadId, [
      ...projection.turnItems.filter(i => i.runId === run.id && i.status === "running").map(i =>
        ({ type: "turn-item.updated" as const, payload: { ...i, status: "completed" as const, completedAt: endedAt, updatedAt: endedAt } })),
      ...projection.attempts.filter(a => a.runId === run.id).map(a =>
        ({ type: "run-attempt.updated" as const, payload: { ...a, status: "completed" as const, completedAt: endedAt } })),
      ...projection.providerTurns.filter(t => t.runAttemptId === run.activeAttemptId).map(t =>
        ({ type: "provider-turn.updated" as const, payload: { ...t, status: "completed" as const, completedAt: endedAt } })),
      { type: "run.updated", payload: { ...run, status: "completed", completedAt: endedAt } },
    ]);
  })]),
});

// Collapse the last implementation turn's four work rows into a wire anchor. Expanding the native
// Worked-for disclosure fetches and replaces it with the full, typed rows below.
const workRun = full.projection.runs[13]!.id;
const hidden = full.projection.turnItems.filter(i => i.runId === workRun && i.type !== "user_message" && i.type !== "assistant_message");
const anchor = hidden[0]!;
const hiddenIds = new Set(hidden.map(i => i.id));
const bounded = full.projection.turnItems.flatMap(i => i.id === anchor.id
  ? [{ ...anchor, deferredWork: { cursor: "c09-import-work-v1", itemCount: hidden.length, lastOrdinal: hidden.at(-1)!.ordinal } }]
  : hiddenIds.has(i.id) ? [] : [i]);
const page = Schema.encodeSync(OrchestrationV2ThreadHistoryPage)({
  snapshotSequence: 0, items: visibleItemsOf(hidden), nextCursor: null, hasMoreHistory: false,
});
let installed = false;
function installHistory() {
  if (installed) return;
  installed = true;
  const fetchPrevious = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin === location.origin && url.pathname === "/api/orchestration/threads/c09-long-conversation/history" && url.searchParams.get("cursor") === "c09-import-work-v1") {
      return new Response(JSON.stringify(page), { headers: { "content-type": "application/json" } });
    }
    return fetchPrevious(input, init);
  };
}

export default { ...full, projection: { ...full.projection, turnItems: bounded, visibleTurnItems: visibleItemsOf(bounded) } };
