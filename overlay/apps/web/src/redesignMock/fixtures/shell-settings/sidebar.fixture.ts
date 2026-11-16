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

// "Context breakdown" is collapsed by default in the thread details panel; S08-breakdown is about
// that list, so it opens expanded unless the visitor already chose.
try {
  const BREAKDOWN_KEY = "thread-details:collapsed:Context breakdown";
  if (window.localStorage.getItem(BREAKDOWN_KEY) === null) window.localStorage.setItem(BREAKDOWN_KEY, "false");
} catch {
  /* Without storage the panel opens collapsed. */
}

const finished = (text = "The small-screen layout is ready for a second look.") => [
  turn({
    at: "6m",
    user: "Review the compact navigation in pebble-mobile.",
    items: [assistant(text)],
  }),
];
const chat = (user: string, answer: string, at = "6m") => [
  turn({ at, user, items: [assistant(answer)] }),
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
    turns: chat(
      "Keep a checklist for the compact navigation work so I can find it again.",
      "Checklist: keep the search field visible, collapse secondary actions below 640px, and check the focus order with the keyboard. This thread is pinned, so it stays at the top of the sidebar.",
    ),
    thread: { pinnedAt: ago("10m"), tags: ["navigation", "review"] },
  }),
  scene("S01-active", "Active: polish the search field", {
    turns: chat(
      "Polish the search field in the compact header.",
      "The field now keeps its width when the keyboard opens and the clear button has a 44px target. An active thread sits in the main list and shows how long ago you last touched it.",
      "5m",
    ),
    thread: { settledOverride: "active", lastVisitedAt: ago("1m") },
  }),
  scene("S01-snoozed", "Snoozed: revisit after the design pass", {
    turns: chat(
      "Park the toolbar spacing work until the design pass lands.",
      "Parked. This thread is snoozed for two hours: it moves to the Snoozed section and comes back marked Woke when the time is up.",
      "4m",
    ),
    thread: { snoozedAt: ago("4m"), snoozedUntil: fromNow("2h") },
  }),
  scene("S01-settled", "Settled: align the toolbar icons", {
    turns: chat(
      "Align the toolbar icons to one grid.",
      "All toolbar icons now sit on a 20px grid with 8px gaps. Nothing else is open, so the thread is settled: it moves to the Settled section until you un-settle it.",
      "1h",
    ),
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
        took: "2m 10s",
        items: [
          assistant("I'll run the navigation tests before touching the menu code.", { phase: "commentary" }),
          approval({ requestKind: "command", prompt: "Run npm test -- navigation?" }),
        ],
      }),
    ],
  }),
  scene("S02-input", "Input: choose a compact menu label", {
    turns: [
      turn({
        at: "3m",
        status: "waiting",
        took: "1m 40s",
        user: "Choose a label for the compact menu.",
        items: [
          assistant("Two labels read well at this width; I need your call before I rename it.", { phase: "commentary" }),
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
  scene("S02-monitoring", "Waiting: a monitor is watching the preview build", {
    turns: chat(
      "Tell me when the preview build finishes.",
      "I started a monitor on the preview build and will pick the thread up when it reports. Until then the sidebar shows Waiting: a background monitor holds the thread open.",
      "5m",
    ),
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
  scene("S02-plan", "Proposed plan: simplify compact navigation", {
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
  scene("S02-woke", "Woke: the layout review is due", {
    turns: chat(
      "Wake me when the design pass is done so I can review the layout.",
      "Snoozed until the design pass was due. It is due now: the sidebar marks this thread Woke until you dismiss it.",
      "2h",
    ),
    thread: {
      snoozedAt: ago("2h"),
      snoozedUntil: ago("2m"),
      lastVisitedAt: ago("3h"),
      settledOverride: "active",
    },
  }),
  scene("S03-renaming", "Regenerating the title: the sidebar dims it", {
    turns: chat(
      "Check how the navigation behaves with a screen reader.",
      "Navigation announces each tab with its position. This thread's title is being regenerated from the conversation: the sidebar dims the title until the new one lands.",
      "3m",
    ),
    thread: {
      titleRegeneration: { requestId: CommandId.make("s03-renaming"), startedAt: ago("5s") },
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
  scene("T05-archived", "Archived threads: open the list in Settings", {
    turns: chat(
      "Where do archived threads go?",
      "[Open Settings > Archived threads](/settings/archived) (opens in a new tab).\n\nTwo threads are archived in this project: the first compact navigation experiment and the tab bar prototype. The Archived page lists them.",
      "9m",
    ),
  }),
  thread({
    id: "t05-archived-navigation-experiment",
    project: "sidebar",
    title: "First compact navigation experiment",
    turns: chat("Sketch a first compact navigation.", "A three-item bottom bar with a More menu; archived after the second iteration replaced it.", "26h"),
    thread: { archivedAt: ago("1d") },
  }),
  thread({
    id: "t05-archived-tab-bar",
    project: "sidebar",
    title: "Tab bar prototype",
    turns: chat("Prototype a swipeable tab bar.", "The prototype swipes between four tabs but fights the system back gesture, so it was archived.", "3d"),
    thread: { archivedAt: ago("2d") },
  }),
  scene("T05-guide", "Settings: explore every page", {
    turns: finished(
      "Open the floating settings panel with the gear at the bottom left.\n\n- [General](/settings/general), [Appearance](/settings/appearance), [Keyboard shortcuts](/settings/keybindings)\n- [Providers](/settings/providers), [Voice](/settings/voice), [Labs](/settings/labs)\n- [Usage](/usage), [Scheduled tasks](/settings/scheduled-tasks)\n- [Archived threads](/settings/archived), [Storage](/settings/storage), [Diagnostics](/settings/diagnostics)\n\nChanges are saved in this browser. Provider and scheduled task examples are planted preview data.",
    ),
  }),
];

const permissions: ReadonlyArray<readonly [RuntimeMode, string, string, string]> = [
  [
    "approval-required",
    "Supervised",
    "Rename the NavBar component to CompactNav.",
    "Supervised asks before commands and file changes, so I stopped before running `git mv`. The composer footer shows the mode; its permission control switches it.",
  ],
  [
    "auto-accept-edits",
    "Auto-accept edits",
    "Tighten the spacing in the compact menu.",
    "Auto-accept edits approves file edits and asks before other actions. I changed the menu padding from 12px to 8px and left the build command for you to approve.",
  ],
  [
    "auto",
    "Auto",
    "Run the navigation tests and fix what breaks.",
    "Auto lets supported providers approve routine actions. The tests ran without a prompt and passed (12 of 12), so nothing needed fixing.",
  ],
  [
    "full-access",
    "Full access",
    "Clear the build cache and rebuild the app.",
    "Full access allows commands and edits without prompts. The cache is cleared and the app rebuilt in 41 seconds.",
  ],
];
for (const [mode, label, user, answer] of permissions) {
  states.push(
    scene(`S04-${mode}`, `Permissions: ${label}`, {
      runtimeMode: mode,
      turns: chat(user, answer, "8m"),
    }),
  );
}

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
    "Context: tokens by category in the details panel",
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
];
const usageChats: Record<string, readonly [string, string]> = {
  normal: [
    "Give me a quick read on the compact navigation.",
    "It fits at 390px and the focus order is correct. This was a short exchange, so the context bar in the details panel is barely used.",
  ],
  "near-compact": [
    "Keep going through the rest of the navigation screens.",
    "That was the last of 40 screens. The context window is almost full: the app compacts automatically at the threshold marked on the context bar in the details panel.",
  ],
  breakdown: [
    "How much of the context window is the conversation itself?",
    "Most of it: about 60k tokens of messages, then the system prompt, tool definitions, skills and memory files. The Context row of the details panel lists the same split.",
  ],
};
for (const [id, title, contextUsage] of usages) {
  states.push(
    scene(`S08-${id}`, title, {
      turns: chat(usageChats[id]![0], usageChats[id]![1], "7m"),
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
