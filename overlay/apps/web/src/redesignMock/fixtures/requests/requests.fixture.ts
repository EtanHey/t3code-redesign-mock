// Q01-Q11: approvals and questions, each with a short lead-up (a request, a thought, a couple of
// work rows) so the card reads as the next step of real work. The cards' own wording comes from
// the app: a command approval shows the command itself and "Approve <first two words>" in the
// working bar, so the prompt is the command, not a sentence about it.
import {
  ProviderDriverKind,
  RuntimeRequestId,
  type OrchestrationV2UserInputQuestion,
  type ProviderRequestKind,
} from "@t3tools/contracts";

import { approval, assistant, command, item, question, reasoning, script, thread, turn, type ItemSpec } from "../../api";
import { hold } from "../../api";

type ApprovalOptions = Parameters<typeof approval>[0];

const batchOptions: OrchestrationV2UserInputQuestion["options"] = [
  { label: "Small batches", description: "Process a few records at a time.", preview: "```ts\nbatchSize = 100\n```" },
  { label: "Large batches", description: "Finish sooner with more load.", preview: "```ts\nbatchSize = 1000\n```" },
];
const checkOptions: OrchestrationV2UserInputQuestion["options"] = [
  { label: "Unit tests", description: "Run the focused test suite." },
  { label: "Schema checks", description: "Verify the migrated columns." },
];
const questionSpec = (id: string, text: string): OrchestrationV2UserInputQuestion => ({
  id,
  header: "Choose",
  question: text,
  options: batchOptions,
  required: true,
});

// A run that started five minutes ago and has been working since: the card is the last step, so
// "Paused at ..." counts from the card, not from zero.
const AT = "5m";
const TOOK = "4m";

interface Lead {
  readonly user: string;
  readonly think: string;
  readonly command?: { readonly input: string; readonly output: string };
  readonly say: string;
}

function leadItems(lead: Lead): ItemSpec[] {
  return [
    reasoning(lead.think),
    ...(lead.command ? [command(lead.command)] : []),
    assistant(lead.say, { phase: "commentary" }),
  ];
}

function approvalThread(
  id: string,
  title: string,
  lead: Lead,
  spec: ApprovalOptions,
  extra: { full?: boolean; unavailable?: boolean; waitFor?: string } = {},
) {
  return thread({
    id: `${id.toLowerCase()}-approval`,
    project: "requests",
    title,
    scenario: { id, label: title, waitForText: extra.waitFor ?? lead.user },
    runtimeMode: extra.full ? "full-access" : "approval-required",
    turns: [turn({ at: AT, took: TOOK, status: "waiting", user: lead.user, items: [...leadItems(lead), approval(spec)] })],
    ...(extra.unavailable
      ? {
          projection: (p) => ({
            ...p,
            runtimeRequests: p.runtimeRequests.map((r) => ({
              ...r,
              responseCapability: { type: "not_resumable" as const, reason: "The provider session has ended." },
            })),
          }),
        }
      : {}),
  });
}

const request = (kind: ProviderRequestKind, prompt: string): ApprovalOptions => ({ requestKind: kind, prompt });

function questionsThread(
  id: string,
  title: string,
  lead: Lead,
  questions: OrchestrationV2UserInputQuestion[],
) {
  return thread({
    id: `${id.toLowerCase()}-question`,
    project: "requests",
    title,
    scenario: { id, label: title, waitForText: questions[0]?.question ?? title },
    turns: [turn({ at: AT, took: TOOK, status: "waiting", user: lead.user, items: [...leadItems(lead), question(questions)] })],
  });
}

const configRef = { driver: ProviderDriverKind.make("codex"), nativeId: "edit-config", strength: "strong" as const };

const CONFIG_DIFF = [
  "@@ -6,8 +6,11 @@ export const config = {",
  "   port: Number(process.env.PORT ?? 3000),",
  "   databaseUrl: process.env.DATABASE_URL,",
  "-  requestTimeoutMs: 5_000,",
  "+  requestTimeoutMs: 15_000,",
  "+  // Media uploads were timing out at the shared limit.",
  "+  uploadTimeoutMs: 60_000,",
  "   maxBodyBytes: 1_048_576,",
  " };",
  "@@ -24,6 +27,9 @@ export function loadConfig(env = process.env) {",
  "   const parsed = schema.safeParse({",
  "-    requestTimeoutMs: env.REQUEST_TIMEOUT_MS ?? 5_000,",
  "+    requestTimeoutMs: env.REQUEST_TIMEOUT_MS ?? config.requestTimeoutMs,",
  "+    uploadTimeoutMs: env.UPLOAD_TIMEOUT_MS ?? config.uploadTimeoutMs,",
  "     maxBodyBytes: env.MAX_BODY_BYTES ?? config.maxBodyBytes,",
  "   });",
  "@@ -41,3 +47,4 @@ export function describeConfig() {",
  "   return `port ${config.port}`;",
  "+  // Timeouts are in milliseconds.",
  " }",
  "",
].join("\n");

const q02 = thread({
  id: "q02-file-change",
  project: "requests",
  title: "Approval: review a file change",
  scenario: { id: "Q02", label: "Approval: file change", waitForText: "Raise the request timeout" },
  runtimeMode: "approval-required",
  turns: [
    turn({
      at: AT,
      took: TOOK,
      status: "waiting",
      user: "Uploads of large images keep timing out. Can you raise the limits?",
      items: [
        reasoning("The 5 second request timeout is shared by every route, including uploads."),
        command({
          input: "rg -n \"requestTimeoutMs|REQUEST_TIMEOUT_MS\" src",
          output: "src/config.ts:9:  requestTimeoutMs: 5_000,\nsrc/config.ts:26:    requestTimeoutMs: env.REQUEST_TIMEOUT_MS ?? 5_000,\nsrc/server.ts:14:  timeout: config.requestTimeoutMs,\n",
        }),
        assistant(
          "The limit lives in `src/config.ts`. I'd like to raise it and add a separate, longer one for uploads. Open Review diff under the request to read the exact change before you approve.",
          { phase: "commentary" },
        ),
        item((base) => ({
          ...base,
          type: "file_change",
          nativeItemRef: configRef,
          fileName: "src/config.ts",
          additions: 6,
          deletions: 2,
          diffStr: CONFIG_DIFF,
          changes: [{ operation: "update", path: "src/config.ts" }],
        })),
        approval({ requestKind: "file-change", prompt: "Raise the request timeout and add an upload timeout in src/config.ts", extra: { nativeItemRef: configRef } }),
      ],
    }),
  ],
});

const Q06A_REASON =
  "Your project settings have an ask rule for release commands, so this asks even though the thread has full access.";
const Q06B_REASON =
  "The agent stops for a safety check of its own before it touches a shared database. No setting can skip this one.";

export default [
  approvalThread(
    "Q01",
    "Approval: run a command",
    {
      user: "Run the web tests and tell me what breaks.",
      think: "I'll count the test files first so I know how long the run will take.",
      command: { input: "rg --files -g \"*.test.ts\" src | wc -l", output: "42\n" },
      say: "There are 42 test files. Running them executes project code, so I need your approval first.",
    },
    request("command", "pnpm test --filter @quill/web"),
  ),
  q02,
  approvalThread(
    "Q03",
    "Approval: read a file",
    {
      user: "Why does the preview build fail on my machine but not in CI?",
      think: "CI has no local overrides, so the difference is probably in a file that is not committed.",
      command: { input: "ls -a", output: ".env.example\n.gitignore\nconfig.local.json\npackage.json\nsrc\n" },
      say: "There is a `config.local.json` that git ignores. I'd like to read it to compare it with the CI settings.",
    },
    request("file-read", "/workspace/quill-cms/config.local.json"),
  ),
  approvalThread(
    "Q04",
    "Approval: permission choices (Always allow is under More)",
    {
      user: "Check the dependencies for known security problems.",
      think: "The audit needs the advisory database, which means reaching the network.",
      say: "The check needs network access. Below you can allow it once or for this session. **Always allow** is not in the first row: open **More** to find it, with its warning.",
    },
    {
      requestKind: "permission",
      prompt: "Allow network access for dependency checks?",
      options: [
        { decision: "accept", label: "Allow once" },
        { decision: "acceptForSession", label: "Allow for this session" },
        { decision: "acceptAlways", label: "Always allow", warning: "Future requests will be allowed automatically." },
        { decision: "cancel", label: "Cancel" },
        { decision: "decline", label: "Decline" },
      ],
    },
  ),
  approvalThread(
    "Q05",
    "Approval: integration request",
    {
      user: "Find every page that still links to the old pricing URL.",
      think: "The Docs Search integration keeps an index of the whole site, which is faster than grepping.",
      say: "I can ask the Docs Search integration, but it needs your permission to look at the project index.",
    },
    { requestKind: "mcp-elicitation", prompt: "Allow the integration to inspect the project index?", extra: { appName: "Docs Search" } },
  ),
  approvalThread(
    "Q06A",
    "Approval: required by an ask rule",
    {
      user: "Cut the 3.2 release.",
      think: "The release checklist is a script; I'll run it after the changelog is in place.",
      command: { input: "git log --oneline v3.1.0..HEAD | wc -l", output: "27\n" },
      say: "27 commits since 3.1.0, and the changelog is updated. The last step is the checklist script.",
    },
    { ...request("command", "pnpm release:check"), reason: Q06A_REASON, extra: { fullAccessOverride: "ask_rule" } },
    { full: true },
  ),
  approvalThread(
    "Q06B",
    "Approval: required by provider check",
    {
      user: "Apply the pending migrations to the staging database.",
      think: "Two migrations are pending. Both add columns, nothing is dropped.",
      command: { input: "pnpm db:status --env staging", output: "2 pending: 0043_add_slug, 0044_add_published_at\n" },
      say: "Both migrations only add columns, so they are safe to run. This one touches a shared database.",
    },
    { ...request("command", "pnpm db:migrate --env staging"), reason: Q06B_REASON, extra: { fullAccessOverride: "provider_check" } },
    { full: true },
  ),
  approvalThread(
    "Q07",
    "Approval: session no longer available",
    {
      user: "Run the integration suite against the preview database.",
      think: "The suite needs the preview database, so I'll start it with the project script.",
      say: "I asked for approval to start the suite, but the session that asked has since ended.",
    },
    request("command", "pnpm test:integration"),
    { unavailable: true },
  ),
  questionsThread(
    "Q08A",
    "Question: choose one option",
    {
      user: "Backfill the new slug column for existing posts.",
      think: "The posts table has about 48,000 rows, so the batch size matters.",
      command: { input: "psql -c \"select count(*) from posts\"", output: " count\n-------\n 48210\n" },
      say: "48,210 posts need a slug. One decision before I write the backfill.",
    },
    [questionSpec("batch", "Which batch size should we use?")],
  ),
  questionsThread(
    "Q08B",
    "Question: choose multiple options",
    {
      user: "Check that the new migration did not break anything.",
      think: "There are two kinds of checks I can run after a migration.",
      say: "I can run the unit tests, the schema checks, or both.",
    },
    [{ ...questionSpec("checks", "Which checks should run?"), options: checkOptions, multiSelect: true }],
  ),
  questionsThread(
    "Q08C",
    "Question: write an answer",
    {
      user: "Draft the release notes for 3.2.",
      think: "The commit list has 27 entries; most are fixes.",
      command: { input: "git log --oneline v3.1.0..HEAD | head -5", output: "a41c9e2 fix: slug collisions on import\n7be03d1 feat: draft previews\n19fd2c8 fix: pagination cursor\n0c3e5aa chore: bump deps\nd8821b0 fix: image upload timeout\n" },
      say: "I have the list of changes. The headline is up to you.",
    },
    [{ id: "note", header: "Details", question: "What should the release note say?", options: [], allowCustomAnswer: true, required: true }],
  ),
  questionsThread(
    "Q09",
    "Question: migration wizard",
    {
      user: "Plan the slug backfill and the checks that follow it.",
      think: "Two decisions shape the plan: batch size and verification.",
      say: "I have two short questions before I write the plan.",
    },
    [
      questionSpec("batch", "Which batch size should we use?"),
      { ...questionSpec("checks", "Which checks should run afterward?"), options: checkOptions, multiSelect: true },
    ],
  ),
  // Q10: the question does not block the run. The shell says nothing is pending (a plain message
  // answers it), so the bar keeps counting "Working" instead of "Paused" and the command goes on.
  thread({
    id: "q10-question",
    project: "requests",
    title: "Question: answer while work continues",
    scenario: { id: "Q10", label: "Question: answer while work continues", waitForText: "while I inspect the schema" },
    turns: [
      turn({
        at: AT,
        took: TOOK,
        status: "running",
        user: "Backfill the new slug column for existing posts.",
        items: [
          reasoning("I can inspect the schema while you decide on the batch size."),
          command({ input: "psql -c \"\\d posts\"", output: " slug | text |\n title | text | not null\n" }),
          assistant("I'll keep inspecting the schema. Answer whenever you like; I'll use your choice when I write the script.", {
            phase: "commentary",
          }),
          question([questionSpec("batch", "Which batch size should we use while I inspect the schema?")]),
        ],
      }),
    ],
    onOpen: script([hold({ input: "psql -c \"select count(*) from posts where slug is null\"", output: "" }, "2s")]),
    shell: { pendingRuntimeRequest: null },
    projection: (p) => ({
      ...p,
      runtimeRequests: p.runtimeRequests.map((r) => ({ ...r, responseCapability: { type: "message" as const } })),
    }),
  }),
  thread({
    id: "q11-answered",
    project: "requests",
    title: "Question: answered in history",
    scenario: { id: "Q11", label: "Answered question", waitForText: "The migration uses small batches" },
    turns: [
      turn({
        at: "12m",
        took: "90s",
        user: "Plan the migration.",
        items: [
          reasoning("The table is large, so the batch size is the main decision."),
          item((base) => ({
            ...base,
            type: "user_input_request",
            requestId: RuntimeRequestId.make("q11-request"),
            questions: [questionSpec("batch", "Which batch size should we use?")],
            questionAnswer: {
              requestId: "q11-request",
              questionTextById: { batch: "Which batch size should we use?" },
              answers: { batch: "Small batches" },
              attachmentsByQuestionId: {},
            },
          })),
          assistant("The migration uses small batches: 100 rows at a time, with a pause between batches so the site stays responsive."),
        ],
      }),
    ],
  }),
];
