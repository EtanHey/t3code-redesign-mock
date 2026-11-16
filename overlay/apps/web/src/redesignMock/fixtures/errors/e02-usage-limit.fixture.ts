// E02: usage limit reached. The banner reads the failure's resetAt and the thread's limitRecovery;
// each fixture picks one combination: auto-resume on, off, snoozed until the reset, a ChatGPT plan
// limit, a workspace limit, no reset time known, and a run that resumed after the reset.
import { RunId, type ModelSelection } from "@t3tools/contracts";
import { CHATGPT_USAGE_LIMIT_CODE, CHATGPT_WORKSPACE_USAGE_LIMIT_CODE } from "@t3tools/shared/usageLimits";
import * as DateTime from "effect/DateTime";

import { agoIso, assistant, command, fileChange, fromNow, MODELS, thread, turn } from "../../api";
import { failureItem } from "./errors-kit";

const EARLIER = turn({
  at: "70m",
  took: "2m",
  user: "Add an `invoice_id` index to the ledger entries table.",
  items: [
    command({ input: "ls db/migrations | tail -3", output: "0041_add_credit_notes.sql\n0042_backfill_tax_codes.sql\n0043_ledger_entry_kinds.sql" }),
    fileChange({
      path: "db/migrations/0044_ledger_invoice_index.sql",
      additions: 3,
      deletions: 0,
      diff: "--- /dev/null\n+++ b/db/migrations/0044_ledger_invoice_index.sql\n@@ -0,0 +1,3 @@\n+CREATE INDEX CONCURRENTLY IF NOT EXISTS ledger_entries_invoice_id_idx\n+  ON ledger_entries (invoice_id);\n",
    }),
    assistant("Added migration `0044_ledger_invoice_index.sql`. It builds the index concurrently so writes are not blocked."),
  ],
});

interface LimitSpec {
  readonly id: string;
  readonly scenario: string;
  readonly label: string;
  readonly title: string;
  readonly model: ModelSelection;
  readonly message: string;
  readonly code?: string;
  readonly resetIn: string | null;
  readonly autoResume?: boolean;
  readonly snooze?: boolean;
  /** Said by the assistant just before the run stops (the banner's own wording is cut short). */
  readonly note?: string;
}

const LIMIT_PROMPT = "Backfill the new index for every tenant, one tenant at a time, and report the timings.";

function limited(spec: LimitSpec) {
  const resetAt = spec.resetIn === null ? null : fromNow(spec.resetIn);
  const resetIso = resetAt === null ? null : DateTime.formatIso(resetAt);
  return thread({
    id: spec.id,
    project: "errors",
    title: spec.title,
    model: spec.model,
    scenario: { id: spec.scenario, label: spec.label, waitForText: "Backfill the new index" },
    turns: [
      EARLIER,
      turn({
        at: "6m",
        took: "50s",
        status: "failed",
        user: LIMIT_PROMPT,
        items: [
          assistant("Listing the tenants first so I can work through them in order.", { phase: "commentary" }),
          command({ input: "psql \"$DATABASE_URL\" -Atc \"select count(*) from tenants\"", output: "312" }),
          ...(spec.note === undefined ? [] : [assistant(spec.note)]),
          failureItem({
            class: "usage_limit",
            message: spec.message,
            code: spec.code ?? "usage_limit_reached",
            retryable: false,
            resetAt: resetIso,
          }),
        ],
      }),
    ],
    thread: {
      ...(spec.autoResume === undefined && spec.snooze === undefined
        ? {}
        : {
            limitRecovery: {
              runId: RunId.make(`${spec.id}-run-2`),
              resetAt: resetIso ?? "",
              autoResume: spec.autoResume ?? false,
              ...(spec.snooze === undefined ? {} : { snooze: spec.snooze }),
            },
          }),
      ...(spec.snooze === true && resetAt !== null ? { snoozedUntil: resetAt } : {}),
    },
  });
}

const CLAUDE_LIMIT =
  "You've reached your usage limit for the 5-hour window. Your limit resets in about 2 hours.";

const resumed = thread({
  id: "e02-limit-resumed",
  project: "errors",
  title: "Usage limit: resumed after the reset",
  model: MODELS.sonnet,
  scenario: { id: "E02f", label: "Run resumed after a usage limit", waitForText: "Backfill" },
  turns: [
    EARLIER,
    turn({
      at: "3h",
      took: "40s",
      status: "failed",
      user: LIMIT_PROMPT,
      items: [
        command({ input: "psql \"$DATABASE_URL\" -Atc \"select count(*) from tenants\"", output: "312" }),
        failureItem({
          class: "usage_limit",
          message: CLAUDE_LIMIT,
          code: "usage_limit_reached",
          retryable: false,
          resetAt: agoIso("1h"),
        }),
      ],
    }),
    turn({
      at: "1h",
      took: "4m",
      user: "Continue from where you left off.",
      run: { usageLimitContinuationOfRunId: RunId.make("e02-limit-resumed-run-2") },
      items: [
        command({
          input: "node scripts/backfill-invoice-index.mjs --tenants all --batch 25",
          output: "tenant 001..025 ok (1.8s)\ntenant 026..050 ok (1.7s)\n…\ntenant 301..312 ok (1.4s)\n312 tenants in 22.6s",
        }),
        assistant("The run resumed automatically after the reset and finished the backfill: 312 tenants in 22.6s, no lock waits above 40ms."),
      ],
    }),
  ],
});

export default [
  limited({
    id: "e02-limit-auto-resume",
    scenario: "E02",
    label: "Usage limit with auto-resume scheduled",
    title: "Usage limit reached: resumes automatically at the reset",
    model: MODELS.sonnet,
    message: CLAUDE_LIMIT,
    resetIn: "2h",
    autoResume: true,
  }),
  limited({
    id: "e02-limit-manual",
    scenario: "E02b",
    label: "Usage limit, nothing scheduled",
    title: "Usage limit reached: choose to resume or snooze",
    model: MODELS.sonnet,
    message: CLAUDE_LIMIT,
    resetIn: "2h 40m",
  }),
  limited({
    id: "e02-limit-snoozed",
    scenario: "E02c",
    label: "Usage limit, thread snoozed until the reset",
    title: "Usage limit reached: snoozed until the reset",
    model: MODELS.opus,
    message: "You've reached your weekly usage limit for Claude Opus. Your limit resets in about 5 hours.",
    resetIn: "5h",
    autoResume: true,
    snooze: true,
  }),
  limited({
    id: "e02-limit-no-reset",
    scenario: "E02d",
    label: "Usage limit with no reset time",
    title: "Usage limit reached: reset time unknown",
    model: MODELS.haiku,
    message: "Usage limit reached. Try again later.",
    resetIn: null,
  }),
  limited({
    id: "e02-limit-chatgpt",
    scenario: "E02e",
    label: "ChatGPT plan usage limit",
    title: "ChatGPT usage limit reached",
    model: MODELS.astra,
    message: "You've reached your ChatGPT usage limit. It resets in about 3 hours.",
    code: CHATGPT_USAGE_LIMIT_CODE,
    resetIn: "3h",
  }),
  limited({
    id: "e02-limit-workspace",
    scenario: "E02g",
    label: "ChatGPT workspace usage limit",
    title: "ChatGPT workspace limit reached: ask an admin",
    model: MODELS.sol,
    message: "Your workspace has reached its limit for using ChatGPT plans in other apps.",
    code: CHATGPT_WORKSPACE_USAGE_LIMIT_CODE,
    resetIn: null,
    note: "I have to stop here: your ChatGPT workspace has used up its allowance for other apps, and only a workspace admin can raise it. Use **Copy request for admin** in the banner above the composer and send the copied text to them.",
  }),
  resumed,
];
