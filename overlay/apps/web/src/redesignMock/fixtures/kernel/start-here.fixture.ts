// The thread the root URL opens, and the index threads it links to. The app opens a thread at
// its end, so "Start here" ends on a short message (what this is, that nothing is real, what to
// try, where each family of states lives); the long lists live in one index thread per family,
// plus one with everything.
import { ThreadId } from "@t3tools/contracts";
import { formatThreadLink } from "@t3tools/shared/threadLinks";

import { ago, assistant, ENVIRONMENT_ID, thread, turn, type ScenarioFamily } from "../../api";
import {
  SCENARIO_FAMILIES,
  SCENARIO_INDEX_PLACEHOLDER,
  scenarioCountPlaceholder,
  scenarioIndexPlaceholder,
} from "../../kernel/scenarioIndex";

export const START_HERE_THREAD_ID = ThreadId.make("start-here");
const ALL_INDEX_THREAD_ID = ThreadId.make("index-all");
const indexThreadId = (family: ScenarioFamily) => ThreadId.make(`index-${family}`);
const threadLink = (threadId: ThreadId, label: string) =>
  formatThreadLink({ environmentId: ENVIRONMENT_ID, threadId }, label);

// Her markdown opens a path such as "/design-system" as a workspace file, so these links are
// absolute; they open in a new tab of this same preview.
const ORIGIN = typeof window === "undefined" ? "" : window.location.origin;
const DESIGN_SYSTEM_URL = `${ORIGIN}/design-system`;
const SETTINGS_PAGES = [
  ["General", "general"],
  ["Appearance", "appearance"],
  ["Keybindings", "keybindings"],
  ["Providers", "providers"],
  ["Voice", "voice"],
  ["Labs", "labs"],
  ["Connections", "connections"],
  ["Scheduled tasks", "scheduled-tasks"],
  ["Diagnostics", "diagnostics"],
  ["Archived threads", "archived"],
]
  .map(([label, path]) => `[${label}](${ORIGIN}/settings/${path})`)
  .join(" · ");

// Her markdown shows a thread link by the thread's title, so the titles are the link text.
const FAMILY_LINKS = SCENARIO_FAMILIES.map(({ family, heading }) => threadLink(indexThreadId(family), heading)).join(
  " · ",
);

const MORE = `**Beyond the threads.** The redesign's primitives, type roles and colours have their own page, [the design system catalog](${DESIGN_SYSTEM_URL}); upstream shows it in development builds only, and this preview turns it on. The floating settings panel is its own part of the redesign; each page opens in a new tab: ${SETTINGS_PAGES}.

What you do is saved in this browser only, so a reload keeps it and nobody else sees it. The preview rebuilds every hour from Maria's newest commit; its source is at [github.com/EtanHey/t3code-redesign-mock](https://github.com/EtanHey/t3code-redesign-mock).`;

const WELCOME = `An **unofficial, fully mocked preview** of T3 Code on Maria's redesign branch (\`maria/redesign/6-workspace-panes\`). The real interface runs in your browser against a fake server. **Nothing here is real:** no backend, no agent, and nothing you type leaves this page.

**Try it:** send a message, send another while it works (it queues), then press **Stop**.

**Find a state** (${scenarioCountPlaceholder()} planted): ${FAMILY_LINKS} · ${threadLink(ALL_INDEX_THREAD_ID, "all in one list")}.

**Also:** [design system](${DESIGN_SYSTEM_URL}) · [Settings](${ORIGIN}/settings/general). **Reset demo**, under the **Mock preview** notice, brings back the planted state.`;

const BACK = `Back to ${threadLink(START_HERE_THREAD_ID, "Start here")}.`;

const startHere = thread({
  id: START_HERE_THREAD_ID,
  project: "start",
  title: "Start here: what this preview is",
  scenario: { id: "K00", label: "Start here", waitForText: "Nothing here is real:" },
  thread: { pinnedAt: ago("2d"), pinOrderKey: "a0" },
  turns: [
    turn({ at: "4m", took: "5s", user: "What else is in here?", items: [assistant(MORE)] }),
    turn({ at: "3m", took: "6s", user: "What am I looking at?", items: [assistant(WELCOME)] }),
  ],
});

// Index threads sit at the bottom of the inbox: old, unpinned, reached from the links above.
const familyIndexes = SCENARIO_FAMILIES.map(({ family, heading }, order) =>
  thread({
    id: indexThreadId(family),
    project: "start",
    title: heading,
    scenario: { id: `K00-${family}`, label: `Index: ${heading}`, waitForText: BACK.slice(0, 7) },
    turns: [
      turn({
        at: `${30 + order}d`,
        took: "2s",
        user: `Which ${heading.toLowerCase()} states are planted?`,
        items: [
          assistant(
            `**${heading}:** ${scenarioCountPlaceholder(family)} planted threads. Each link opens its thread. ${BACK}\n\n${scenarioIndexPlaceholder(family)}\n\n${BACK}`,
          ),
        ],
      }),
    ],
  }),
);

const allIndex = thread({
  id: ALL_INDEX_THREAD_ID,
  project: "start",
  title: "Every planted state",
  scenario: { id: "K00-all", label: "Index: every planted state", waitForText: BACK.slice(0, 7) },
  turns: [
    turn({
      at: "29d",
      took: "3s",
      user: "List every planted state",
      items: [
        assistant(
          `Every planted thread, ${scenarioCountPlaceholder()} in all, by family. The sidebar lists threads by recency, so use this list to find a state. ${BACK}\n\n${SCENARIO_INDEX_PLACEHOLDER}\n\n${BACK}`,
        ),
      ],
    }),
  ],
});

export default [startHere, ...familyIndexes, allIndex];
