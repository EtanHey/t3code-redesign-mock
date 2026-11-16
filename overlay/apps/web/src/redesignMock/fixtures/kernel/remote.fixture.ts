// A second, connected environment with its own project and one thread. It is saved in the app's
// connection catalog at install, so it shows wherever the app lists environments.
import { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { assistant, command, environment, reasoning, thread, turn } from "../../api";

// The agents lane links its remote task rows to this id and label.
const BUILD_BOX = EnvironmentId.make("env-build-box");
const RENDER_FARM = ProjectId.make("project-env-build-box-render-farm");

export default [
  environment(BUILD_BOX, "build-box", {
    connection: { state: "connected" },
    projects: [{ id: RENDER_FARM, title: "render-farm" }],
  }),
  thread({
    id: "k08-remote-gpu-queue",
    environmentId: BUILD_BOX,
    project: RENDER_FARM,
    title: "Drain the stuck GPU render queue",
    scenario: { id: "K08", label: "Thread on a connected remote environment", waitForText: "queue is draining" },
    turns: [
      turn({
        at: "22m",
        took: "1m 5s",
        user: "Jobs on the render queue have been stuck in `claimed` since last night. Can you look?",
        items: [
          reasoning("Claimed jobs with no heartbeat for hours means the worker died without releasing its lease."),
          command({
            input: "render-farm queue ls --state claimed",
            output: "JOB        WORKER     CLAIMED        LAST HEARTBEAT\nr-48120    gpu-03     9h 12m ago     9h 11m ago\nr-48121    gpu-03     9h 12m ago     9h 11m ago\nr-48125    gpu-03     9h 10m ago     9h 10m ago\n",
          }),
          command({
            input: "render-farm queue release --worker gpu-03 --stale 15m",
            output: "released 3 jobs (r-48120, r-48121, r-48125)\n",
          }),
          assistant(
            "All three stuck jobs were held by `gpu-03`, which stopped sending heartbeats 9 hours ago. I released their leases and the queue is draining again.\n\nThe lease never expires on its own because `staleAfter` is unset in `config/queue.toml`; setting it to `15m` would make this recover without help.",
          ),
        ],
      }),
    ],
  }),
];
