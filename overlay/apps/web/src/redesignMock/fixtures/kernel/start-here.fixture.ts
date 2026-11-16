// The thread the root URL opens: what this preview is, that nothing is real, and what to try.
import { ThreadId } from "@t3tools/contracts";

import { ago, assistant, thread, turn } from "../../api";

export const START_HERE_THREAD_ID = ThreadId.make("start-here");

// Her markdown opens a path such as "/design-system" as a workspace file, so the link is absolute;
// it opens the catalog in a new tab of this same preview.
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

const WELCOME = `This is an **unofficial, fully mocked preview** of T3 Code as it looks on Maria's redesign branch (\`maria/redesign/6-workspace-panes\`, PRs #28839 to #28845). The real interface runs in your browser against a fake server: there is no backend, no agent and no account, and nothing you type leaves this page.

**Design system:** the redesign's primitives, type roles and colours have their own catalog page, [the design system catalog](${DESIGN_SYSTEM_URL}). Upstream shows it in development builds only; this preview turns it on.

**Settings pages:** the floating settings panel is its own part of the redesign. Each of these opens in a new tab: ${SETTINGS_PAGES}.

**Nothing here is real.** The threads and replies are planted. Agents never finish: a message you send starts a run that keeps working until you press Stop.

Things to try: send a message here or in any thread, then send another while it works to queue it, and press **Stop**. Start, pin, rename, snooze or settle threads; open **Settings** and the command palette.

## Every planted state

The sidebar lists threads by recency, with the project as a small label above each title. To find a state, use this list; each link opens its thread.

{{SCENARIO_INDEX}}

What you do is saved in this browser only, so a reload keeps it and nobody else sees it. **Reset demo**, under the **Mock preview** notice, brings back the planted state. The preview rebuilds every hour from Maria's newest commit; its source is at [github.com/EtanHey/t3code-redesign-mock](https://github.com/EtanHey/t3code-redesign-mock).`;

export default thread({
  id: START_HERE_THREAD_ID,
  project: "start",
  title: "Start here: what this preview is",
  scenario: { id: "K00", label: "Start here", waitForText: "Nothing here is real." },
  thread: { pinnedAt: ago("2d"), pinOrderKey: "a0" },
  turns: [
    turn({
      at: "3m",
      took: "6s",
      user: "What am I looking at?",
      items: [assistant(WELCOME)],
    }),
  ],
});
