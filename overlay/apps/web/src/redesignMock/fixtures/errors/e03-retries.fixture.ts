// E03: the provider retrying. Each retry is an `error` item carrying `retry`; the one in flight is
// running, earlier ones completed, and an exhausted run ends with a failed one on its last attempt.
import { assistant, command, MODELS, thread, turn } from "../../api";
import { failureItem } from "./errors-kit";

const OVERLOADED = {
  class: "provider_error" as const,
  message: "The model is overloaded. Retrying shortly.",
  code: "overloaded_error",
  retryable: true,
};

const CONNECTION = {
  class: "transport_error" as const,
  message: "Connection reset while streaming the response.",
  code: "ECONNRESET",
  retryable: true,
};

const PROMPT = "Split the ledger export into one file per month and compress each file.";

const retrying = thread({
  id: "e03-retrying",
  project: "errors",
  title: "Provider retrying: attempt 3 of 5",
  model: MODELS.sonnet,
  scenario: { id: "E03", label: "Provider retrying (running)", waitForText: "one file per month" },
  turns: [
    turn({
      at: "2m",
      took: "90s",
      status: "running",
      user: PROMPT,
      items: [
        assistant("Checking the size of the export before splitting it.", { phase: "commentary" }),
        command({ input: "ls exports/2026", output: "ledger-2026.csv   412M" }),
        failureItem(CONNECTION, { status: "completed", retry: { attempt: 1, maxAttempts: 5, retryDelayMs: 1_000 } }),
        failureItem(OVERLOADED, { status: "completed", retry: { attempt: 2, maxAttempts: 5, retryDelayMs: 4_000 } }),
        failureItem(OVERLOADED, { status: "running", retry: { attempt: 3, maxAttempts: 5, retryDelayMs: 9_000 } }),
      ],
    }),
  ],
});

const recovered = thread({
  id: "e03-recovered",
  project: "errors",
  title: "Provider retried twice, then the run recovered",
  model: MODELS.sonnet,
  scenario: { id: "E03b", label: "Provider retry recovered", waitForText: "one file per month" },
  turns: [
    turn({
      at: "14m",
      took: "3m",
      user: PROMPT,
      items: [
        command({ input: "ls exports/2026", output: "ledger-2026.csv   412M" }),
        failureItem(CONNECTION, { status: "completed", retry: { attempt: 1, maxAttempts: 5, retryDelayMs: 1_000 } }),
        failureItem(OVERLOADED, { status: "completed", retry: { attempt: 2, maxAttempts: 5, retryDelayMs: 4_000 } }),
        command({
          input: "node scripts/split-export.mjs exports/2026/ledger-2026.csv --by month --gzip",
          output: "wrote exports/2026/ledger-2026-01.csv.gz (31.4M)\nwrote exports/2026/ledger-2026-02.csv.gz (29.0M)\n…\nwrote exports/2026/ledger-2026-11.csv.gz (30.2M)\n11 files, 338M total",
        }),
        assistant("The export is split into 11 compressed monthly files under `exports/2026/`. The provider dropped the connection twice early on; both retries went through (open the \"Worked for\" row above to see them)."),
      ],
    }),
  ],
});

const exhausted = thread({
  id: "e03-exhausted",
  project: "errors",
  title: "Provider retries exhausted: failed after 5 attempts",
  model: MODELS.sonnet,
  scenario: { id: "E03c", label: "Provider retries exhausted", waitForText: "one file per month" },
  turns: [
    turn({
      at: "12m",
      took: "2m",
      status: "failed",
      user: PROMPT,
      items: [
        command({ input: "ls exports/2026", output: "ledger-2026.csv   412M" }),
        failureItem(OVERLOADED, { status: "completed", retry: { attempt: 1, maxAttempts: 5, retryDelayMs: 1_000 } }),
        failureItem(OVERLOADED, { status: "completed", retry: { attempt: 2, maxAttempts: 5, retryDelayMs: 2_000 } }),
        failureItem(OVERLOADED, { status: "completed", retry: { attempt: 3, maxAttempts: 5, retryDelayMs: 4_000 } }),
        failureItem(OVERLOADED, { status: "completed", retry: { attempt: 4, maxAttempts: 5, retryDelayMs: 8_000 } }),
        failureItem(
          { ...OVERLOADED, message: "The model is overloaded. Gave up after 5 attempts.", retryable: false },
          { status: "failed", retry: { attempt: 5, maxAttempts: 5, retryDelayMs: null } },
        ),
      ],
    }),
  ],
});

export default [retrying, recovered, exhausted];
