import {
  CommandId,
  GuestMessageId,
  GuestShareId,
  NodeId,
  PlanId,
  ProviderThreadId,
  ProviderDriverKind,
  ScheduledTaskId,
  type RuntimeMode,
  type ThreadTokenUsageSnapshot,
} from "@t3tools/contracts";
import {
  ago,
  agoIso,
  approval,
  assistant,
  fromNow,
  fromNowIso,
  item,
  question,
  thread,
  turn,
  type ThreadSpec,
} from "~/redesignMock/api";

const finished = (text = "The small-screen layout is ready for a second look.") => [
  turn({
    at: "6m",
    user: "Review the compact navigation in pebble-mobile.",
    items: [assistant(text)],
  }),
];
const scene = (id: string, title: string, extra: Partial<ThreadSpec> = {}) =>
  thread({
    id: id.toLowerCase(),
    project: "sidebar",
    title,
    scenario: { id, label: title },
    turns: finished(),
    ...extra,
  });
const plan =
  "## Compact navigation\n\n1. Keep the search field visible.\n2. Collapse secondary actions below 640px.\n3. Check focus order with the keyboard.";
const planId = PlanId.make("s02-plan");
const guest = {
  id: GuestShareId.make("s07-preview-share"),
  host: "preview.example.invalid",
  createdAt: agoIso("20m"),
  expiresAt: fromNowIso("23h"),
  guestName: "Guest reviewer",
  messages: [
    {
      id: GuestMessageId.make("s07-message-1"),
      text: "Could the compact menu keep the search action visible?",
      status: "pending" as const,
      submittedAt: agoIso("2m"),
    },
    {
      id: GuestMessageId.make("s07-message-2"),
      text: "Please check the focus ring on the next button too.",
      status: "pending" as const,
      submittedAt: agoIso("1m"),
    },
  ],
};

const states = [
  scene("S01-pinned", "Pinned: compact navigation checklist", {
    thread: { pinnedAt: ago("10m"), tags: ["navigation", "review"] },
  }),
  scene("S01-active", "Active: polish the search field", {
    thread: { settledOverride: "active", lastVisitedAt: ago("1m") },
  }),
  scene("S01-snoozed", "Snoozed: revisit after the design pass", {
    thread: { snoozedAt: ago("4m"), snoozedUntil: fromNow("2h") },
  }),
  scene("S01-settled", "Settled: align the toolbar icons", {
    thread: { settledOverride: "settled", settledAt: ago("1h") },
  }),
  scene("S01-older", "Older settled: replace the empty state", {
    turns: [
      turn({
        at: "20d",
        user: "Replace the blank empty state.",
        items: [assistant("The empty state now includes a short explanation and one action.")],
      }),
    ],
    thread: { settledOverride: "settled", settledAt: ago("19d") },
    olderSettled: true,
  }),
  scene("S02-approval", "Approval: check the navigation tests", {
    runtimeMode: "approval-required",
    turns: [
      turn({
        at: "4m",
        status: "waiting",
        user: "Check the navigation tests.",
        items: [approval({ requestKind: "command", prompt: "Run vp test navigation?" })],
      }),
    ],
  }),
  scene("S02-input", "Input: choose a compact menu label", {
    turns: [
      turn({
        at: "3m",
        status: "waiting",
        user: "Choose a label for the compact menu.",
        items: [
          question([
            {
              id: "label",
              header: "Menu label",
              question: "Which label should the compact menu use?",
              options: [
                { label: "More", description: "Short and familiar" },
                { label: "Actions", description: "Describes what is inside" },
              ],
            },
          ]),
        ],
      }),
    ],
  }),
  scene("S02-working", "Working: trace the focus order", {
    turns: [
      turn({
        at: "40s",
        status: "running",
        user: "Trace the focus order through the toolbar.",
        items: [
          assistant("I am checking the keyboard path through each toolbar action.", {
            streaming: true,
            phase: "commentary",
          }),
        ],
      }),
    ],
  }),
  scene("S02-connecting", "Connecting: prepare the layout review", {
    turns: [turn({ at: "25s", status: "preparing", user: "Prepare the compact layout review." })],
  }),
  scene("S02-waiting", "Waiting: collect the layout findings", {
    turns: [
      turn({
        at: "50s",
        status: "running",
        user: "Collect the layout findings.",
        items: [assistant("Waiting for the layout audit to finish.")],
      }),
    ],
    shell: { blockedOnThreadWait: true },
  }),
  scene("S02-monitoring", "Monitoring: wait for the preview build", {
    shell: {
      pendingBackgroundTasks: [
        {
          kind: "monitor",
          taskId: "s02-preview-watch",
          description: "Preview build",
          awaited: true,
        },
      ],
    },
  }),
  scene("S02-failed", "Failed: preview build exited early", {
    turns: [
      turn({
        at: "2m",
        status: "failed",
        user: "Build the preview.",
        items: [
          item((base) => ({
            ...base,
            type: "error",
            status: "failed",
            failure: {
              class: "provider_error",
              message: "Preview build stopped: the workspace dependency is missing.",
              retryable: true,
              code: null,
            },
          })),
        ],
      }),
    ],
  }),
  scene("S02-plan", "Plan ready: simplify compact navigation", {
    interactionMode: "plan",
    turns: [
      turn({
        at: "3m",
        user: "Plan the compact navigation changes.",
        items: [
          item((base) => ({
            ...base,
            type: "proposed_plan",
            planId,
            markdown: plan,
            streaming: false,
          })),
        ],
      }),
    ],
    projection: (p) => ({
      ...p,
      plans: [
        {
          id: planId,
          threadId: p.thread.id,
          runId: p.runs[0]!.id,
          nodeId: NodeId.make("s02-plan-node"),
          status: "active",
          kind: "proposed_plan",
          markdown: plan,
        },
      ],
    }),
  }),
  scene("S02-unread", "Completed: keyboard navigation review"),
  scene("S02-woke", "Woke: the layout review is due", {
    thread: {
      snoozedAt: ago("2h"),
      snoozedUntil: ago("2m"),
      lastVisitedAt: ago("3h"),
      settledOverride: "active",
    },
  }),
  scene("S03-tags", "Tags: navigation and accessibility", {
    thread: { tags: ["navigation", "accessibility", "small-screen"] },
  }),
  scene("S03-renaming", "Generating a clearer navigation title", {
    thread: {
      titleRegeneration: { requestId: CommandId.make("s03-renaming"), startedAt: ago("5s") },
    },
  }),
  scene("S03-rename-failed", "Title generation failed: keep the original", {
    thread: {
      lastTitleRegeneration: {
        requestId: CommandId.make("s03-failed"),
        completedAt: ago("1m"),
        status: "failed",
      },
    },
  }),
  scene("S03-scheduled", "Scheduled: daily compact layout check", {
    turns: [
      turn({
        at: "8m",
        user: {
          text: "Check compact layout regressions and summarize any changes.",
          extra: { scheduledTaskId: ScheduledTaskId.make("shell-daily-check") },
        },
        items: [
          assistant(
            "The compact navigation still fits at 390px. Search and primary actions remain reachable.",
          ),
        ],
      }),
    ],
  }),
  scene("S07", "Guest request: review compact navigation", { thread: { guestShare: guest } }),
  scene("T05-archived", "Archived: first compact navigation experiment", {
    thread: { archivedAt: ago("1d") },
  }),
  scene("T05-guide", "Settings: explore every page", {
    turns: finished(
      "Open the floating settings panel with the gear at the bottom left.\n\n- [General](/settings/general), [Appearance](/settings/appearance), [Keyboard shortcuts](/settings/keybindings)\n- [Providers](/settings/providers), [Voice](/settings/voice), [Labs](/settings/labs)\n- [Usage](/usage), [Scheduled tasks](/settings/scheduled-tasks)\n- [Archived threads](/settings/archived), [Storage](/settings/storage), [Diagnostics](/settings/diagnostics)\n\nChanges are saved in this browser. Provider and scheduled task examples are planted preview data.",
    ),
  }),
];

for (const mode of [
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
] satisfies RuntimeMode[]) {
  states.push(
    scene(`S04-${mode}`, `Permissions: ${mode}`, {
      runtimeMode: mode,
      turns: finished(
        `This thread starts in ${mode} mode. Use the permission control beside the composer to try another mode.`,
      ),
    }),
  );
}
states.push(
  scene("S04-plan", "Plan mode: review before implementing", {
    interactionMode: "plan",
    runtimeMode: "approval-required",
    turns: finished("Prepare a plan for compact navigation before making changes."),
  }),
);

const usages: ReadonlyArray<readonly [string, string, ThreadTokenUsageSnapshot]> = [
  [
    "normal",
    "Context: a short navigation review",
    { usedTokens: 24000, maxTokens: 200000, inputTokens: 21000, outputTokens: 3000 },
  ],
  [
    "near-compact",
    "Context: approaching automatic compaction",
    {
      usedTokens: 172000,
      maxTokens: 200000,
      compactsAutomatically: true,
      autoCompactThreshold: 180000,
    },
  ],
  [
    "breakdown",
    "Context: inspect the token breakdown",
    {
      usedTokens: 88000,
      maxTokens: 200000,
      breakdown: [
        { kind: "messages", tokens: 60000 },
        { kind: "system_prompt", tokens: 12000 },
        { kind: "mcp_tools", tokens: 8000 },
        { kind: "skills", tokens: 5000 },
        { kind: "memory_files", tokens: 3000 },
      ],
    },
  ],
  [
    "cost",
    "Context: tokens and session cost",
    {
      usedTokens: 63000,
      maxTokens: 200000,
      inputTokens: 58000,
      cachedInputTokens: 40000,
      outputTokens: 5000,
      totalProcessedTokens: 340000,
      cost: { amount: 1.84, currency: "USD" },
    },
  ],
];
for (const [id, title, contextUsage] of usages) {
  states.push(
    scene(`S08-${id}`, title, {
      projection: (p) => {
        const providerId = ProviderThreadId.make(`${p.thread.id}-context`);
        return {
          ...p,
          thread: { ...p.thread, activeProviderThreadId: providerId },
          providerThreads: [
            {
              id: providerId,
              driver: ProviderDriverKind.make("codex"),
              providerInstanceId: p.thread.providerInstanceId,
              providerSessionId: null,
              appThreadId: p.thread.id,
              ownerNodeId: null,
              nativeThreadRef: null,
              nativeConversationHeadRef: null,
              status: "idle",
              firstRunOrdinal: 1,
              lastRunOrdinal: 1,
              handoffIds: [],
              forkedFrom: null,
              pendingBackgroundTasks: [],
              contextUsage,
              nativeMetadata: null,
              goal: null,
              createdAt: ago("10m"),
              updatedAt: ago("1m"),
            },
          ],
        };
      },
    }),
  );
}
export default states;
