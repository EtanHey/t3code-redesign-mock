// X05: a task running in a linked environment. The row reads "on build-box" and has no child
// thread here. The app only opens it when it is connected to that environment; the mock's saved
// connection catalog does not list one (the errors lane plants extra environments), so here the
// row is shown but does not open. The thread on the receiving side is planted locally: it says
// where it was delegated from.
import { EnvironmentId, RunId, ThreadId } from "@t3tools/contracts";

import { assistant, command, MODELS, reasoning, thread, turn } from "~/redesignMock/api";

import { pendingSubagentTask, subagentRow, withSubagents, type SubagentSpec } from "./agent-kit";

const PARENT = "x05-remote-task";
const REMOTE_ENVIRONMENT = EnvironmentId.make("env-build-box");

const remoteBuild: SubagentSpec = {
  key: "remote-build",
  parentId: PARENT,
  origin: "app_owned",
  title: "Build the Linux release",
  prompt: "Build the Linux x64 and arm64 release bundles and attach the checksums.",
  status: "running",
  progress: "Compiling arm64; x64 bundle done.",
  childId: null,
  startedAgo: "7m",
  model: MODELS.sonnet,
  remoteChild: {
    environmentId: REMOTE_ENVIRONMENT,
    threadId: ThreadId.make("remote-linux-release"),
    label: "build-box",
    title: "Build the Linux release",
    runId: RunId.make("remote-linux-release-run-1"),
  },
};

const remoteScan: SubagentSpec = {
  key: "remote-scan",
  parentId: PARENT,
  origin: "app_owned",
  title: "Scan the container image",
  prompt: "Scan registry.example.dev/lumen/app:rc1 for known vulnerabilities and report anything high or critical.",
  status: "completed",
  result: "No high or critical findings. 4 low findings in the base image, none reachable.",
  childId: null,
  startedAgo: "20m",
  ranFor: "3m",
  model: MODELS.haiku,
  remoteChild: {
    environmentId: REMOTE_ENVIRONMENT,
    threadId: ThreadId.make("remote-image-scan"),
    label: "build-box",
    title: "Scan the container image",
    runId: RunId.make("remote-image-scan-run-1"),
    stoppedThere: true,
  },
};

const parent = thread({
  id: PARENT,
  project: "agents",
  title: "Remote task running on build-box",
  model: MODELS.opus,
  scenario: {
    id: "X05",
    label: "Remote task in a linked environment",
    waitForText: "Build the Linux release",
  },
  turns: [
    turn({
      at: "22m",
      status: "running",
      took: "22m",
      user: "Cut the 2.6 release candidate. The Linux builds and the image scan should run on the build machine.",
      items: [
        reasoning("The Linux toolchain lives on build-box, so those two jobs go there as delegated tasks."),
        subagentRow(remoteScan),
        subagentRow(remoteBuild),
      ],
    }),
  ],
  projection: withSubagents([remoteScan, remoteBuild]),
  shell: { pendingBackgroundTasks: [pendingSubagentTask(remoteBuild)] },
});

// The other end of the same hand-off: a thread here that another environment delegated.
const receiving = thread({
  id: "x05-delegated-from-build-box",
  project: "agents",
  title: "Delegated here from build-box: check the docs links",
  model: MODELS.sonnet,
  scenario: {
    id: "X05b",
    label: "Thread delegated from a linked environment",
    waitForText: "docs links",
  },
  turns: [
    turn({
      at: "15m",
      took: "1m 10s",
      user: "Check that every link in docs/ still resolves and list the broken ones.",
      items: [
        command({
          input: "pnpm run docs:links",
          output: "checked 212 links\nbroken: docs/guides/export.md -> /guides/csv (404)\n",
        }),
        assistant("One broken link: `docs/guides/export.md` points to `/guides/csv`, which was renamed to `/guides/export-csv`."),
      ],
    }),
  ],
  thread: {
    createdBy: "agent",
    creationSource: "mcp",
    delegatedFrom: {
      environmentId: REMOTE_ENVIRONMENT,
      threadId: ThreadId.make("remote-release-lead"),
      title: "Cut the 2.6 release candidate",
    },
  },
});

export default [parent, receiving];
