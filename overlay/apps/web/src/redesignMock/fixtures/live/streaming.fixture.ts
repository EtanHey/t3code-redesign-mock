// L01-L03: text and reasoning that keep arriving, and commands that print live output, end
// cleanly, exit non-zero or fail their tests. The first two and the live command stay alive for as
// long as the thread is open: a script keeps adding words, and it restarts after a reload.
import {
  assistant,
  command,
  exec,
  fileChange,
  hold,
  reasoning,
  say,
  script,
  step,
  type Span,
  think,
  thread,
  turn,
} from "../../api";
import { continueStreaming, finishedCommand, printingCommand, streamParagraphs } from "./live-kit";

const CACHE_REPLY =
  "The cache keys were built from the raw query string, so `?page=2&sort=name` and `?sort=name&page=2` landed in two different entries. I'm sorting the parameters before hashing them, which makes both URLs share one entry. After that I'll add a test that sends the same request with the parameters in a different order and checks that the second call is a cache hit.";

const CACHE_PARAGRAPHS = [
  "While that runs, I checked how invalidation works: the cache is cleared per resource, so the new key format needs no migration. Old entries simply age out after their five minute lifetime.",
  "One more thing worth knowing: the `Vary: Accept-Language` header is not part of the key yet. Two clients asking for different languages could share an entry, so I'm including the header in the hash as well.",
  "The repository tests are green with the new key function. I'm now running the whole suite to be sure nothing else relied on the old key shape.",
  "I also found a second caller that builds keys by hand in `src/export/report.ts`. It now goes through the same helper, so there is exactly one place that decides what a cache key looks like.",
];

const PREFIX_WORDS = 14;

const streamingText = thread({
  id: "l01-streaming-text",
  project: "live",
  title: "Streaming: assistant text arriving",
  scenario: { id: "L01", label: "Assistant text streaming", waitForText: "cache keys were built" },
  turns: [
    turn({
      at: "3m",
      status: "running",
      user: "Two requests for the same list are missing the cache. Can you find out why?",
      items: [
        reasoning("Comparing the cache keys the two requests produce."),
        assistant(CACHE_REPLY.split(/(?<=\s)/).slice(0, PREFIX_WORDS).join(""), {
          phase: "commentary",
          streaming: true,
        }),
      ],
    }),
  ],
  onOpen: script(
    [
      ...continueStreaming("assistant_message", CACHE_REPLY, PREFIX_WORDS),
      exec({ input: "vitest run src/cache", output: " ✓ src/cache/keys.test.ts (6 tests) 88ms\n" }, "2.2s", "900ms"),
    ],
    {
      loop: [
        ...streamParagraphs("assistant_message", CACHE_PARAGRAPHS, { after: "5s" }),
        ...think("Checking the next caller of the key helper.", "1.6s", "1.5s"),
      ],
    },
  ),
});

const THOUGHT =
  "The export job reads the whole table into memory before it writes the first row, which is why the container is killed at about 400k rows. A cursor with a page size of a few thousand would keep memory flat. The writer already accepts an async iterator, so the change is mostly in the query helper, and the existing row-count test still describes the right behaviour.";

const THOUGHTS = [
  "Now checking whether the csv writer flushes between pages. If it buffers the whole file the cursor will not help, so I want to see the stream backpressure handling before I change the query.",
  "The page size should come from config rather than a constant. There is already an `EXPORT_PAGE_SIZE` in the environment schema that nothing reads, so I can wire that one up instead of adding another.",
  "A failed page should not leave a half-written file behind. The writer creates the file up front, so the cleanup belongs in the error path of the job, not in the writer.",
];

const reasoningStream = thread({
  id: "l02-streaming-reasoning",
  project: "live",
  title: "Streaming: reasoning (Thinking, then Thought)",
  scenario: { id: "L02", label: "Reasoning streaming", waitForText: "Memory flat" },
  turns: [
    turn({
      at: "2m",
      took: "1m",
      status: "completed",
      user: "Last night the export job ran out of memory again. Where does the memory go?",
      items: [
        reasoning("The job loads every row before writing. That explains the memory use."),
        assistant("It buffers the whole table in memory. I'll switch it to a cursor in the next step."),
      ],
    }),
    turn({
      at: "90s",
      took: "80s",
      status: "running",
      user: "Memory flat is the goal. Go ahead and think it through before you edit anything.",
      items: [
        // A finished thought sits above the live one: the first reads "Thought", the last "Thinking".
        reasoning("The writer already takes an async iterator, so the change belongs in the query helper, not in the writer."),
        command({
          input: "rg -n \"findAll|toArray\" src/export",
          output: "src/export/query.ts:14:  const rows = await db.select().from(events).toArray();\nsrc/export/job.ts:31:  const rows = await loadRows(range);\n",
        }),
        reasoning(THOUGHT.split(/(?<=\s)/).slice(0, 12).join(""), { streaming: true }),
      ],
    }),
  ],
  onOpen: script(
    [
      ...continueStreaming("reasoning", THOUGHT, 12),
      ...say("I'll move the query to a cursor and write each page as it arrives. Starting with the query helper.", { after: "600ms" }),
      hold({ input: "vitest watch src/export", output: "watching 12 test files\n" }, "700ms"),
    ],
    {
      loop: [
        ...think(THOUGHTS[0]!, "5s", "6s"),
        ...think(THOUGHTS[1]!, "5s", "5s"),
        ...think(THOUGHTS[2]!, "5s", "5s"),
      ],
    },
  ),
});

const TEST_LINES = [
  "RUN  v2.4.1 /workspace/harbor-api",
  " ✓ src/orders/list.test.ts (8 tests) 41ms",
  " ✓ src/orders/create.test.ts (11 tests) 63ms",
  " ✓ src/customers/lookup.test.ts (6 tests) 29ms",
  " ✓ src/billing/invoice.test.ts (14 tests) 117ms",
  " ✓ src/billing/tax.test.ts (9 tests) 35ms",
  " ✓ src/shipping/rates.test.ts (7 tests) 52ms",
  " ✓ src/shipping/labels.test.ts (5 tests) 44ms",
  " ✓ src/webhooks/verify.test.ts (4 tests) 18ms",
  "",
  " Test Files  8 passed (8)",
  "      Tests  64 passed (64)",
];

const liveOutput = thread({
  id: "l03-command-live-output",
  project: "live",
  title: "Command: running with live output",
  scenario: { id: "L03", label: "Command running with live output", waitForText: "Run the whole test suite" },
  turns: [
    turn({
      at: "2m",
      took: "100s",
      status: "running",
      user: "Run the whole test suite and tell me what fails.",
      items: [
        reasoning("The suite takes a while, so I'll run the orders tests first and then everything."),
        command({
          input: "vitest run src/orders",
          output: " ✓ src/orders/list.test.ts (8 tests) 41ms\n ✓ src/orders/create.test.ts (11 tests) 63ms\n\n Test Files  2 passed (2)\n      Tests  19 passed (19)\n",
        }),
        assistant("The orders tests pass. Now the whole suite, which prints a line per file as it finishes.", {
          phase: "commentary",
        }),
        command({
          input: "vitest run",
          status: "running",
          output: `${TEST_LINES.slice(0, 3).join("\n")}\n`,
        }),
      ],
    }),
  ],
  onOpen: script(
    [
      // The planted command is the run's last item and keeps printing; these lines continue it.
      ...TEST_LINES.slice(3).map((_, index) =>
        stepAppend(TEST_LINES, index + 3, "2.6s"),
      ),
      ...say("All 64 tests pass across the eight files. Nothing to fix.", { after: "800ms" }),
    ],
    {
      loop: [
        ...printingCommand({
          input: "vitest run --changed",
          lines: TEST_LINES.slice(0, 6),
          every: "1.1s",
          after: "6s",
        }),
      ],
    },
  ),
});

function stepAppend(lines: ReadonlyArray<string>, upTo: number, after: Span) {
  return step(after, (run) => {
    const projection = run.server.projection(run.threadId);
    const live = projection?.turnItems.findLast(
      (candidate) =>
        candidate.runId === run.runId &&
        candidate.type === "command_execution" &&
        candidate.input === "vitest run" &&
        (candidate.status === "running"),
    );
    if (!live) return;
    const output = `${lines.slice(0, upTo + 1).join("\n")}\n`;
    const last = upTo === lines.length - 1;
    if (last) {
      run.complete(live.id, (current) =>
        current.type === "command_execution" ? { ...current, output, exitCode: 0 } : current,
      );
    } else {
      run.update(live.id, (current) => (current.type === "command_execution" ? { ...current, output } : current));
    }
  });
}

// L03b-d keep a turn open after the command ends, so its row stays on screen with the ending
// that matters: exit 0, a non-zero exit, or failing tests. The agent carries on from there.
function afterCommand(lines: ReadonlyArray<string>) {
  return script([], { loop: streamParagraphs("assistant_message", lines, { after: "6s" }) });
}

const commandSucceeded = thread({
  id: "l03-command-succeeded",
  project: "live",
  title: "Command: finished successfully (exit 0)",
  scenario: { id: "L03b", label: "Command succeeded", waitForText: "Is lint clean" },
  turns: [
    turn({
      at: "2m",
      took: "90s",
      status: "running",
      user: "Is lint clean? Then check the formatting too.",
      items: [
        reasoning("Lint first, then the formatter. Both are quick on this repo."),
        assistant("Running `eslint .` now. It exits 0 when nothing is wrong; click its row to see the output.", {
          phase: "commentary",
        }),
        finishedCommand({
          input: "eslint .",
          output: "Checked 186 files in 412ms.\nFound 0 warnings and 0 errors.\n",
          exitCode: 0,
          after: "9s",
        }),
      ],
    }),
  ],
});

const commandFailed = thread({
  id: "l03-command-nonzero",
  project: "live",
  title: "Command: exited non-zero",
  scenario: { id: "L03c", label: "Command exited with a non-zero code", waitForText: "Build the release bundle" },
  turns: [
    turn({
      at: "3m",
      took: "2m",
      status: "running",
      user: "Build the release bundle.",
      items: [
        reasoning("The release build uses the production config, so I'll build with that mode."),
        assistant("Building with `vite build --mode release`. A failed build turns its row red; click it for the full output.", {
          phase: "commentary",
        }),
        finishedCommand({
          input: "vite build --mode release",
          status: "failed",
          exitCode: 2,
          output:
            "vite v6.0.3 building for production...\n✓ 412 modules transformed.\nerror during build:\nsrc/routes/checkout.tsx (18:9): \"formatMoney\" is not exported by \"src/lib/money.ts\"\n    at Module.error (rollup/dist/shared/rollup.js:213:15)\n",
          after: "14s",
        }),
      ],
    }),
  ],
});

const commandTests = thread({
  id: "l03-command-failed-tests",
  project: "live",
  title: "Command: tests failed (3 failing)",
  scenario: { id: "L03d", label: "Command with failed tests", waitForText: "Run the shipping tests" },
  turns: [
    turn({
      at: "2m",
      status: "running",
      user: "Run the shipping tests.",
      items: [
        command({
          input: "vitest run src/shipping",
          status: "failed",
          exitCode: 1,
          output:
            " ✓ src/shipping/labels.test.ts (5 tests) 44ms\n ❯ src/shipping/rates.test.ts (7 tests | 3 failed) 71ms\n   × rates > applies the weekend surcharge\n   × rates > rounds to whole cents\n   × rates > falls back to the flat rate\n\n Test Files  1 failed | 1 passed (2)\n      Tests  3 failed | 9 passed (12)\n",
          extra: { failedTestCount: 3, outputIndicatesFailure: true },
        }),
        assistant("3 tests fail in `rates.test.ts`. I'm fixing the rounding and the flat-rate fallback in `quote`.", {
          phase: "commentary",
        }),
        fileChange({
          path: "src/shipping/rates.ts",
          additions: 4,
          deletions: 1,
          diff: "@@ -22,7 +22,10 @@ export function quote(weightKg: number, zone: Zone): Cents {\n-  return Math.round(base * surcharge);\n+  const total = base * surcharge;\n+  return zone.flatRate !== null && weightKg > zone.maxKg\n+    ? zone.flatRate\n+    : Math.round(total);\n",
        }),
        command({ input: "vitest run src/shipping", status: "running", output: " RUN  v2.4.1\n" }),
      ],
    }),
  ],
  onOpen: afterCommand([
    "Two of the three now pass. The weekend surcharge test still fails because it expects the surcharge to apply before rounding.",
    "All 12 shipping tests pass now.",
  ]),
});

export default [streamingText, reasoningStream, liveOutput, commandSucceeded, commandFailed, commandTests];
