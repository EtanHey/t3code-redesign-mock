// X04: a workflow run. The parent started a provider-native workflow; its coordinator thread opens
// with the script as the plan, grouped into phases with each agent's state, and the parent row
// carries the totals. Two of the agents have their own child threads.
import { ThreadId, type OrchestrationV2SubagentWorkflow } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { ago, assistant, command, MODELS, reasoning, thread, turn } from "~/redesignMock/api";

import { childThread, pendingSubagentTask, subagentRow, withSubagents, type SubagentSpec } from "./agent-kit";

const PARENT = "x04-workflow-run";
const COORDINATOR = `${PARENT}-coordinator`;
const COLLECT_AGENT = `${PARENT}-collect-api`;
const ANALYZE_AGENT = `${PARENT}-analyze-auth`;

const at = (span: string) => DateTime.toEpochMillis(ago(span));

const SCRIPT = `// Dependency audit across the monorepo
const packages = await listPackages("packages/*");

phase("Collect", async () => {
  await Promise.all(packages.map((pkg) => agent({
    label: \`Inventory \${pkg.name}\`,
    prompt: \`List the direct dependencies of \${pkg.name} with their versions and licenses.\`,
  })));
});

phase("Analyze", async () => {
  for (const area of ["auth", "storage", "http"]) {
    await agent({
      label: \`Check \${area} dependencies\`,
      prompt: \`Flag outdated or unmaintained dependencies used by the \${area} code.\`,
    });
  }
});

phase("Summarize", async () => {
  await agent({ label: "Write the audit report", prompt: "Combine the findings into one report." });
});
`;

const workflow: OrchestrationV2SubagentWorkflow = {
  name: "Dependency audit",
  runHandles: { runId: "wf_8f31c2", scriptPath: "/workspace/atlas-workflows/.workflows/dependency-audit.js" },
  phases: [
    { index: 0, title: "Collect" },
    { index: 1, title: "Analyze" },
    { index: 2, title: "Summarize" },
  ],
  agents: [
    {
      index: 0, label: "Inventory api", state: "completed", phaseIndex: 0, phaseTitle: "Collect",
      childThreadId: ThreadId.make(COLLECT_AGENT),
      model: "claude-haiku-5-5", effort: "low", totalTokens: 18_400, toolCalls: 7, durationMs: 62_000,
      startedAt: at("9m"), completedAt: at("8m"),
      prompt: "List the direct dependencies of api with their versions and licenses.",
      result: "api has 24 direct dependencies; 2 are on a copyleft license.",
    },
    {
      index: 1, label: "Inventory web", state: "completed", phaseIndex: 0, phaseTitle: "Collect",
      model: "claude-haiku-5-5", effort: "low", totalTokens: 21_900, toolCalls: 9, durationMs: 71_000,
      startedAt: at("9m"), completedAt: at("8m"),
      prompt: "List the direct dependencies of web with their versions and licenses.",
      result: "web has 41 direct dependencies; 5 are more than a major version behind.",
    },
    {
      index: 2, label: "Inventory worker", state: "completed", phaseIndex: 0, phaseTitle: "Collect",
      model: "claude-haiku-5-5", effort: "low", totalTokens: 9_800, toolCalls: 4, durationMs: 38_000,
      startedAt: at("9m"), completedAt: at("8m 20s"),
      prompt: "List the direct dependencies of worker with their versions and licenses.",
      result: "worker has 11 direct dependencies, all current.",
    },
    {
      index: 3, label: "Check auth dependencies", state: "failed", phaseIndex: 1, phaseTitle: "Analyze",
      childThreadId: ThreadId.make(ANALYZE_AGENT),
      model: "claude-sonnet-5-5", effort: "medium", attempt: 2, totalTokens: 33_100, toolCalls: 12, durationMs: 95_000,
      startedAt: at("7m"), completedAt: at("5m 30s"),
      prompt: "Flag outdated or unmaintained dependencies used by the auth code.",
      result: "Could not read the registry metadata for 3 packages (rate limited). Retried once.",
    },
    {
      index: 4, label: "Check storage dependencies", state: "running", phaseIndex: 1, phaseTitle: "Analyze",
      model: "claude-sonnet-5-5", effort: "medium", totalTokens: 12_700, toolCalls: 5, durationMs: 41_000,
      startedAt: at("1m"),
      prompt: "Flag outdated or unmaintained dependencies used by the storage code.",
    },
    {
      index: 5, label: "Check http dependencies", state: "queued", phaseIndex: 1, phaseTitle: "Analyze",
      model: "claude-sonnet-5-5", effort: "medium", queuedAt: at("1m"),
      prompt: "Flag outdated or unmaintained dependencies used by the http code.",
    },
    {
      index: 6, label: "Write the audit report", state: "queued", phaseIndex: 2, phaseTitle: "Summarize",
      model: "claude-opus-5-5", effort: "high", queuedAt: at("9m"),
      prompt: "Combine the findings into one report.",
    },
  ],
  totalTokens: 95_900,
  toolCalls: 37,
  durationMs: 307_000,
};

const coordinator: SubagentSpec = {
  key: "workflow",
  parentId: PARENT,
  title: "Dependency audit across the monorepo",
  prompt: "Run the dependency audit workflow: inventory, analyze, summarize.",
  status: "running",
  progress: "Analyze phase: 1 of 3 agents done, 1 failed, 1 running.",
  childId: COORDINATOR,
  startedAgo: "9m",
  model: MODELS.opus,
  workflow,
};

const parent = thread({
  id: PARENT,
  project: "agents",
  title: "Workflow run: dependency audit in three phases",
  model: MODELS.opus,
  turns: [
    turn({
      at: "10m",
      status: "running",
      took: "10m",
      user: "Audit our dependencies across the monorepo and tell me what is outdated or unmaintained.",
      items: [
        reasoning("Three phases: inventory every package, analyze each area, then write one report. A workflow keeps the fan-out under control."),
        assistant("I started the dependency audit as a workflow. Open its row below, or the Lineage card on the right, to see every phase and agent.", { phase: "commentary" }),
        subagentRow(coordinator),
      ],
    }),
  ],
  projection: withSubagents([coordinator]),
  shell: { pendingBackgroundTasks: [pendingSubagentTask(coordinator)] },
});

const coordinatorThread = childThread({
  id: COORDINATOR,
  parentId: PARENT,
  title: coordinator.title,
  native: true,
  model: MODELS.opus,
  // This is the thread X04 opens: its first message is the workflow's plan, shown with every phase
  // and agent expanded. The parent thread (in the sidebar) carries the one-line row that leads here.
  scenario: {
    id: "X04",
    label: "Workflow run with phases and agents",
    waitForText: "Check auth dependencies",
  },
  // The opening block (phases, agents, the script folded below) needs the flag on the message too.
  projection: (projection) => ({
    ...projection,
    messages: projection.messages.map((message) =>
      message.role === "user" ? { ...message, workflowScript: true } : message,
    ),
  }),
  turns: [
    turn({
      at: "9m",
      status: "running",
      took: "9m",
      user: { text: SCRIPT, extra: { workflowScript: true } },
      items: [
        reasoning("Starting phase one: inventory each package in parallel."),
        assistant("Inventory finished for 3 packages. Starting the analysis phase.", { phase: "commentary" }),
      ],
    }),
  ],
});

const inventoryThread = childThread({
  id: COLLECT_AGENT,
  parentId: COORDINATOR,
  rootId: PARENT,
  title: "Inventory api",
  native: true,
  model: MODELS.haiku,
  turns: [
    turn({
      at: "9m",
      took: "1m",
      user: "List the direct dependencies of api with their versions and licenses.",
      items: [
        command({
          input: "jq '.dependencies | keys | length' packages/api/package.json",
          output: "24\n",
        }),
        assistant("api has 24 direct dependencies; 2 are on a copyleft license."),
      ],
    }),
  ],
});

const authThread = childThread({
  id: ANALYZE_AGENT,
  parentId: COORDINATOR,
  rootId: PARENT,
  title: "Check auth dependencies",
  native: true,
  model: MODELS.sonnet,
  turns: [
    turn({
      at: "7m",
      took: "1m 35s",
      status: "failed",
      user: "Flag outdated or unmaintained dependencies used by the auth code.",
      items: [
        command({
          input: "npm info jsonwebtoken --json",
          status: "failed",
          output: "error: 429 Too Many Requests from the registry\n",
        }),
      ],
    }),
  ],
});

export default [parent, coordinatorThread, inventoryThread, authThread];
