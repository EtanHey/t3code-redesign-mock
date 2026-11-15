// X03: nested subagents with a child's approval waiting in the parent. The parent spawned a
// coordinator, the coordinator spawned a worker, and the worker wants to run a command. The
// approval rolls up: the parent (and the coordinator) show "needs approval" and the card can be
// answered from the parent, without opening the grandchild.
import { approval, command, fileChange, MODELS, reasoning, thread, turn } from "~/redesignMock/api";

import { childThread, pendingSubagentTask, subagentRow, withSubagents, type SubagentSpec } from "./agent-kit";

const PARENT = "x03-nested-approval";
const COORDINATOR = `${PARENT}-coordinator`;
const WORKER = `${PARENT}-worker`;

const coordinator: SubagentSpec = {
  key: "coordinator",
  parentId: PARENT,
  origin: "app_owned",
  title: "Coordinate the cache migration",
  prompt: "Move the session cache from in-memory maps to Redis. Split the work across helpers and report when the tests pass.",
  status: "running",
  progress: "A helper is switching the cache client; waiting on its approval.",
  childId: COORDINATOR,
  startedAgo: "8m",
  model: MODELS.opus,
};

const worker: SubagentSpec = {
  key: "worker",
  parentId: COORDINATOR,
  origin: "app_owned",
  title: "Swap the cache client",
  prompt: "Replace SessionCache with the Redis client and delete the in-memory fallback.",
  status: "waiting",
  progress: "Waiting for approval to install the redis package.",
  childId: WORKER,
  startedAgo: "4m",
  model: MODELS.sonnet,
};

const parent = thread({
  id: PARENT,
  project: "agents",
  title: "Nested subagents: approval waiting in a grandchild",
  model: MODELS.opus,
  runtimeMode: "approval-required",
  scenario: {
    id: "X03",
    label: "Nested subagents, child approval pending in the parent",
    waitForText: "Coordinate the cache migration",
  },
  turns: [
    turn({
      at: "9m",
      status: "running",
      took: "9m",
      user: "Move our session cache to Redis. Delegate as much as you like, but I want to approve anything that changes dependencies.",
      items: [
        reasoning("This splits into a client swap and a test pass. A coordinator can manage both."),
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
  rootId: PARENT,
  title: coordinator.title,
  native: false,
  model: MODELS.opus,
  runtimeMode: "approval-required",
  turns: [
    turn({
      at: "8m",
      status: "running",
      took: "8m",
      user: coordinator.prompt,
      items: [
        reasoning("The client swap is the risky part, so it goes first and alone."),
        command({
          input: "rg -n \"SessionCache\" src",
          output: "src/session/cache.ts:8:export class SessionCache {\nsrc/session/store.ts:21:  private cache = new SessionCache();\n",
        }),
        subagentRow(worker),
      ],
    }),
  ],
  projection: withSubagents([worker]),
  shell: { pendingBackgroundTasks: [pendingSubagentTask(worker)] },
});

const workerThread = childThread({
  id: WORKER,
  parentId: COORDINATOR,
  rootId: PARENT,
  title: worker.title,
  native: false,
  model: MODELS.sonnet,
  runtimeMode: "approval-required",
  turns: [
    turn({
      at: "4m",
      status: "waiting",
      took: "4m",
      user: worker.prompt,
      items: [
        fileChange({
          path: "src/session/cache.ts",
          additions: 22,
          deletions: 31,
          diff: "@@ -1,8 +1,12 @@\n-export class SessionCache {\n-  private entries = new Map<string, Session>();\n+import { createClient } from \"redis\";\n+\n+export class SessionCache {\n+  private client = createClient({ url: process.env.REDIS_URL });\n",
        }),
        reasoning("The `redis` package is not installed yet."),
        approval({
          requestKind: "command",
          prompt: "vp add redis@5",
          reason: "Install the redis client package",
        }),
      ],
    }),
  ],
});

export default [parent, coordinatorThread, workerThread];
