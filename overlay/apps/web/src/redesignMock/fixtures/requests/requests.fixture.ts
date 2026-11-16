import { ProviderDriverKind, RuntimeRequestId, type OrchestrationV2UserInputQuestion, type ProviderRequestKind } from "@t3tools/contracts";
import { approval, assistant, hold, item, question, script, thread, turn } from "../../api";
type ApprovalOptions = Parameters<typeof approval>[0];

const options: OrchestrationV2UserInputQuestion["options"] = [
  { label: "Small batches", description: "Process a few records at a time.", value: "small", preview: "```ts\nbatchSize = 100\n```" },
  { label: "Large batches", description: "Finish sooner with more load.", value: "large", preview: "```ts\nbatchSize = 1000\n```" },
];
const checks: OrchestrationV2UserInputQuestion["options"] = [
  { label: "Unit tests", description: "Run the focused test suite.", value: "unit" },
  { label: "Schema checks", description: "Verify the migrated columns.", value: "schema" },
];
const questionSpec = (id: string, text: string): OrchestrationV2UserInputQuestion => ({ id, header: "Choose", question: text, options, required: true });
const approvalThread = (id: string, title: string, spec: ApprovalOptions, extra: { full?: boolean; unavailable?: boolean } = {}) => thread({
  id: `${id.toLowerCase()}-approval`, project: "requests", title,
  scenario: { id, label: title, waitForText: spec.prompt ?? title },
  runtimeMode: extra.full ? "full-access" : "approval-required",
  turns: [turn({ at: "5m", status: "waiting", user: "Please continue with the requested change.", items: [approval(spec)] })],
  ...(extra.unavailable ? { projection: (p) => ({ ...p, runtimeRequests: p.runtimeRequests.map((r) => ({ ...r, responseCapability: { type: "not_resumable" as const, reason: "The provider session has ended." } })) }) } : {}),
});
const request = (kind: ProviderRequestKind, prompt: string): ApprovalOptions => ({ requestKind: kind, prompt });
const questionsThread = (id: string, title: string, questions: OrchestrationV2UserInputQuestion[], async = false) => thread({
  id: `${id.toLowerCase()}-question`, project: "requests", title,
  scenario: { id, label: title, waitForText: questions[0]?.question ?? title },
  turns: [turn({ at: "5m", status: async ? "running" : "waiting", user: "Choose how the update should proceed.", items: [question(questions)] })],
  ...(async ? { onOpen: script([hold({ input: "Inspecting the schema", output: "Checking column definitions..." })]), projection: (p) => ({ ...p, runtimeRequests: p.runtimeRequests.map((r) => ({ ...r, responseCapability: { type: "message" as const } })) }) } : {}),
});

const ref = { driver: ProviderDriverKind.make("codex"), nativeId: "edit-settings", strength: "strong" as const };
export default [
  approvalThread("Q01", "Approval: run a command", request("command", "Run `npm test` in /workspace/harbor?")),
  thread({ id: "q02-file-change", project: "requests", title: "Approval: review a file change", scenario: { id: "Q02", label: "Approval: file change", waitForText: "Update the default timeout" }, runtimeMode: "approval-required", turns: [turn({ at: "5m", status: "waiting", user: "Increase the request timeout.", items: [
    item((base) => ({ ...base, type: "file_change", nativeItemRef: ref, fileName: "src/config.ts", additions: 1, deletions: 1, diffStr: "@@ -1 +1 @@\n-export const timeout = 5000;\n+export const timeout = 10000;\n", changes: [{ operation: "update", path: "src/config.ts" }] })),
    approval({ requestKind: "file-change", prompt: "Update the default timeout", extra: { nativeItemRef: ref } }),
  ] })] }),
  approvalThread("Q03", "Approval: read a file", request("file-read", "Read /workspace/harbor/config.local.json?")),
  approvalThread("Q04", "Approval: permission choices", { requestKind: "permission", prompt: "Allow network access for dependency checks?", options: [
    { decision: "accept", label: "Allow once" }, { decision: "acceptForSession", label: "Allow for this session" }, { decision: "acceptAlways", label: "Always allow", warning: "Future requests will be allowed automatically." }, { decision: "decline", label: "Decline" },
  ] }),
  approvalThread("Q05", "Approval: integration request", request("mcp-elicitation", "Allow the integration to inspect the project index?")),
  approvalThread("Q06A", "Approval: required by an ask rule", { ...request("command", "Run the release checklist?"), extra: { fullAccessOverride: "ask_rule" } }, { full: true }),
  approvalThread("Q06B", "Approval: required by provider check", { ...request("command", "Run the database migration?"), extra: { fullAccessOverride: "provider_check" } }, { full: true }),
  approvalThread("Q07", "Approval: session no longer available", request("command", "Run the integration suite?"), { unavailable: true }),
  questionsThread("Q08A", "Question: choose one option", [questionSpec("batch", "Which batch size should we use?")]),
  questionsThread("Q08B", "Question: choose multiple options", [{ ...questionSpec("checks", "Which checks should run?"), options: checks, multiSelect: true }]),
  questionsThread("Q08C", "Question: write an answer", [{ id: "note", header: "Details", question: "What should the release note say?", options: [], allowCustomAnswer: true, required: true }]),
  questionsThread("Q09", "Question: migration wizard", [questionSpec("batch", "Which batch size should we use?"), { ...questionSpec("checks", "Which checks should run afterward?"), options: checks, multiSelect: true }]),
  questionsThread("Q10", "Question: answer while work continues", [questionSpec("batch", "Which batch size should we use while I inspect the schema?")], true),
  thread({ id: "q11-answered", project: "requests", title: "Question: answered in history", scenario: { id: "Q11", label: "Answered question", waitForText: "The migration uses small batches" }, turns: [turn({ at: "12m", user: "Plan the migration.", items: [item((base) => ({ ...base, type: "user_input_request", requestId: RuntimeRequestId.make("q11-request"), questions: [questionSpec("batch", "Which batch size should we use?")], questionAnswer: { requestId: "q11-request", questionTextById: { batch: "Which batch size should we use?" }, answers: { batch: "small" }, attachmentsByQuestionId: {} } })), assistant("The migration uses small batches.")] })] }),
];
