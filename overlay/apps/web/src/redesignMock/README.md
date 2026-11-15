# redesignMock: how a lane adds states

Add files only, in your own folder; never edit the kernel or another lane's files. Each file
default-exports one definition or an array; import everything from `~/redesignMock/api`.
- `fixtures/<lane>/<name>.fixture.ts`: threads, projects, providers (`provider(...)`).
- `handlers/<lane>/<name>.handler.ts`: `rpc(...)`, `stream(...)`, `onCommand(...)`.

Duplicates (thread id, scenario id, RPC method, command reaction) stop the boot naming both files.
Your handler for a method the kernel answers (VCS status, refs, settings...) replaces the kernel's.
Projects are keys: `start conversation live requests errors agents git sidebar`. The sidebar is a
recency inbox (pinned first), so set `at` to order rows. Kernel scenario ids are `K00`-`K03`.

```ts
// fixtures/errors/provider-failed.fixture.ts
import { assistant, command, item, thread, turn } from "~/redesignMock/api";
export default thread({
  id: "e01-provider-failed", project: "errors", title: "Retry the nightly export",
  scenario: { id: "E01", label: "Run failed with provider error", waitForText: "export job" },
  turns: [turn({ at: "18m", status: "failed", user: "Rerun the export job", items: [
    command({ input: "vp run export", status: "failed", output: "exit 1" }),
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

`server.emit(threadId, [{ type: "turn-item.updated", payload }])` pushes domain events; the shell
row recomputes. `thread({ script })` replaces the always-working loop for runs started there;
`onOpen` runs once on first open. Both: `script([think(), exec(), say(), hold()], { loop })`.

Unhandled RPCs never hang (silent stream, typed empty result, or a "not available" error). Add
`?mockdebug` to any URL, or call `window.__MOCK__.unhandled()`, to see what a blank panel waits on.

`scripts/check.sh` typechecks, builds and smokes: every scenario must render with no errors and no
request to another origin; screenshots land in `docs.local/shots/<scenario-id>.png`.
`SMOKE_ONLY=E01,E02 node scripts/smoke.mjs` reruns a subset. Content is public: invent everything.
