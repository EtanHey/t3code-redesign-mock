// The thread the root URL opens: what this preview is, that nothing is real, and what to try.
import { ThreadId } from "@t3tools/contracts";

import { ago, assistant, thread, turn } from "../../api";

export const START_HERE_THREAD_ID = ThreadId.make("start-here");

const WELCOME = `This is an **unofficial, fully mocked preview** of T3 Code as it looks on Maria's redesign branch (\`maria/redesign/6-workspace-panes\`, PRs #28839 to #28845). The real interface runs in your browser against a fake server: there is no backend, no agent and no account, and nothing you type leaves this page.

**Nothing here is real.** The threads and replies are planted. Agents never finish: a message you send starts a run that keeps working until you press Stop.

Things to try:

- Open any thread in the sidebar. It lists recent threads, newest first, with the project as a small label above each title. Each planted thread shows one state: live work, a question, an error, subagents, git, attachments, a rendered page.
- Send a message here or in any thread. While it works, send another to queue it, then press **Stop**.
- Start a new thread, pin or rename one, snooze or settle another.
- Open **Settings** and the command palette.

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
