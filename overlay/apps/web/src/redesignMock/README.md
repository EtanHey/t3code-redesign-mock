# redesignMock: how a lane adds states

Add files only, in your own folder; never edit the kernel or another lane's files. Each file
default-exports one definition or an array; import everything from `~/redesignMock/api`.
- `fixtures/<lane>/<name>.fixture.ts`: threads, projects, providers (`provider(...)`).
- `handlers/<lane>/<name>.handler.ts`: `rpc(...)`, `stream(...)`, `onCommand(...)`.

Duplicates (thread id, scenario id, RPC method, command reaction) stop the boot naming both files.
Your handler for a method the kernel answers (VCS status, refs, settings...) replaces the kernel's.
`scenario.family` (`conversation live requests errors agents git panes sidebar`) and `blurb` place a
thread in the generated index (one thread per family, linked from "Start here"); the family defaults
to your fixture directory.
Projects are keys: `start conversation live requests errors agents git sidebar`. The sidebar is a
recency inbox (pinned first), so set `at` to order rows. Kernel scenario ids are `K00`-`K08`; `K00-*` are the index threads.

```ts
// fixtures/errors/provider-failed.fixture.ts
import { assistant, command, item, thread, turn } from "~/redesignMock/api";
export default thread({
  id: "e01-provider-failed", project: "errors", title: "Retry the nightly export",
  scenario: { id: "E01", label: "Run failed with provider error", waitForText: "export job" },
  turns: [turn({ at: "18m", status: "failed", user: "Rerun the export job", items: [
    command({ input: "npm run export", status: "failed", output: "exit 1" }),
    item((base) => ({ ...base, type: "error", status: "failed",
      failure: { class: "provider_error", message: "Upstream 502", code: null, retryable: true } })),
  ] })],
  shell: { lastError: "Upstream 502" }, // shell-only fields; `thread: {...}` sets app-thread fields
});
```

`item()` builds any of the 25 turn-item types from `base` (ids, ordinal, times). `ago("5m")` and
`fromNow("2h")` resolve at boot. `projection: (p) => ({ ...p, subagents: [...] })` reaches the rest.

```ts
// handlers/git/vcs-status.handler.ts
import { WS_METHODS } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import { stream } from "~/redesignMock/api";
export default stream(WS_METHODS.subscribeVcsStatus, (input) =>
  Stream.concat(Stream.make({ _tag: "snapshot" as const, local: { /* ... */ }, remote: null }), Stream.never));
```

A thread can answer an RPC for itself only: `thread({ ..., rpc: { "orchestration.getTurnDiff": (input) => ... } })`.

```ts
// handlers/agents/fork.handler.ts: runs after the kernel reducer (which ignores this type)
import { onCommand } from "~/redesignMock/api";
export default onCommand("thread.fork", (command, { server }) => {
  const source = server.projection(command.sourceThreadId);
  if (source) server.addThread({ ...source, thread: { ...source.thread, id: command.targetThreadId } });
});
```

`asset(...)` serves real content for the app's own asset requests (no request leaves the page). It
answers before any handler; one match key each: `attachmentId` (message attachments, html_render
pages, MCP apps), `path` (workspace and media files, by path suffix) or `itemId` + `index` (a
tool's image output). Give `url` (a bundled file: `import shot from "./shot.png"`, or `?url` for
svg/csv; a real static file, safe for `<img>`, frames and the `?revision=` file previews add) or
`text` (blob URL; attachments and pages only). `serveAs: "html-render"` adds the page bootstrap.
Examples: `fixtures/kernel/assets.fixture.ts` (K04 attachments, K05 tool image, K06, K07).

```ts
asset({ attachmentId: "c03-chart", contentType: "image/png", url: chart, width: 720, height: 360 }),
asset({ attachmentId: "c11-page", contentType: "text/html", text: PAGE, serveAs: "html-render" }),
```

`environment(id, label, { connection, projects })` adds an environment the app lists everywhere
(saved in its connection catalog at boot; "Reset demo" clears it). `connection.state`:
`connected` (default), `reconnecting`, `failed` with `message`, `awaiting-approval`. Threads go
there with `thread({ environmentId, project: ProjectId.make(id) })`; see K08 (`env-build-box`).

`server.emit(threadId, [{ type: "turn-item.updated", payload }])` pushes domain events; the shell
row recomputes. `thread({ script })` replaces the always-working loop for runs started there;
`onOpen` runs once on first open. Both: `script([think(), exec(), say(), hold()], { loop })`.

Requests resolve as the server projects them: every approval decision (accept, accept for the
session, accept always, decline, cancel; "Always allow this session" is upstream's toggle that
changes what Approve sends) resolves the card; decline and cancel cancel its item, and a cancel
stops the run. An answered question records `questionAnswer` with `questionTextById`; its row shows
the answer as sent, which is the option's `value` when it has one, else its label (leave `value`
off for a readable row). Secret and link cards answer over `secrets.answerRequest` and
`peerLinks.answerRequest` (logged redacted). "Resume thread" shows a "Resumed thread" row, not a
bubble; a first visit is seeded with `followUpBehavior: "queue"`, so Enter or Send while working
queues and her ⌘/Ctrl-click steers. A running command row reads "Running <program>"
(upstream's `commandProgramName`), so use commands a reader knows (`npm`, `git`, `pytest`).
`/design-system` (her catalog, dev-only upstream) is on in this build.

Unhandled RPCs never hang (silent stream, typed empty result, or a "not available" error). Add
`?mockdebug` to any URL, or call `window.__MOCK__.unhandled()`, to see what a blank panel waits on.

Link and tool favicons are shimmed (`vite/redesignMock.ts`): links show her globe icon, so no URL in
any message asks Google or the linked site for an image.

`scripts/check.sh` typechecks, builds and smokes under a made-up public hostname (not 127.0.0.1):
every scenario must render with no console error and no request attempt to another origin, even a
blocked one, after scrolling the thread end to end; screenshots land in `docs.local/shots/<scenario-id>.png`.
`node scripts/smoke.mjs --only E01,E02` reruns a few in seconds (each scenario gets a fresh
browser); `scripts/update-upstream.sh` moves `upstream/` to her newest tip. Content is public: invent everything.
