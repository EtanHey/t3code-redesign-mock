// S06: queued messages in the composer tray. Several queued behind a working run (the tray folds
// after three), a queue held after Stop (Resume), and a queue waiting for the agent to be ready
// (Steer). Reordering by drag, Edit, Remove and Send now/Steer all work on these threads.
import { RunId } from "@t3tools/contracts";

import {
  assistant,
  command,
  exec,
  reasoning,
  script,
  thread,
  turn,
  type TurnSpec,
} from "../../api";
import { streamParagraphs } from "./live-kit";

function queuedTurn(text: string, at: string, position: number, run: NonNullable<TurnSpec["run"]> = {}): TurnSpec {
  return turn({
    at,
    status: "queued",
    user: { text, inputIntent: "queued_turn", extra: { status: "pending" } },
    items: [],
    run: { queuePosition: position, ...run },
  });
}

const several = thread({
  id: "s06-queue-several",
  project: "live",
  title: "Queue: four messages waiting behind a working run",
  scenario: { id: "S06", label: "Queued messages in the composer tray", waitForText: "Migrate the user table" },
  turns: [
    turn({
      at: "6m",
      status: "running",
      user: "Migrate the user table to the new id format.",
      items: [
        reasoning("The migration has to keep both id formats readable until the backfill finishes."),
        command({ input: "node scripts/migrate-ids.mjs --dry-run", output: "would update 48210 rows in 97 batches\n" }),
        command({ input: "node scripts/migrate-ids.mjs", status: "running", output: "batch 12/97 ...\n" }),
      ],
    }),
    queuedTurn("After that, update the seed script to create ids in the new format.", "4m", 1),
    queuedTurn("Add a note about the migration to the changelog.", "3m", 2),
    queuedTurn("Then run the whole test suite and tell me if anything is slower than before.", "2m", 3),
    queuedTurn("Last one: open a draft PR with the migration, and list the rollback steps in the description.", "1m", 4),
  ],
  onOpen: script([], {
    loop: [
      ...streamParagraphs(
        "assistant_message",
        [
          "Batch 40 of 97 is done. Each batch takes about two seconds, so the migration needs roughly three more minutes.",
          "Halfway through: no failed batches so far, and the new ids resolve correctly in the read path.",
        ],
        { after: "8s" },
      ),
      ...exec({ input: "node scripts/migrate-ids.mjs --status", output: "batch 52/97, 0 failed\n" }, "1.2s", "2s"),
    ],
  }),
});

const held = thread({
  id: "s06-queue-held",
  project: "live",
  title: "Queue: held after Stop, press Resume to continue",
  scenario: { id: "S06b", label: "Held queue after Stop", waitForText: "Resume" },
  turns: [
    turn({
      at: "8m",
      status: "interrupted",
      took: "1m 30s",
      user: "Rename `getUser` to `findUser` across the repo.",
      items: [
        command({ input: "rg -l getUser src | wc -l", output: "37\n" }),
        assistant("I changed 12 of 37 files before you stopped me."),
      ],
    }),
    queuedTurn("Also update the docs that mention it.", "5m", 1, { queueHeld: true }),
    queuedTurn("And add a deprecation alias for one release.", "4m", 2, { queueHeld: true }),
  ],
});

const READY_ID = "s06-queue-steer";
const steerReady = thread({
  id: READY_ID,
  project: "live",
  title: "Queue: agent still starting, Steer when ready",
  scenario: { id: "S06c", label: "Queued messages, steer when ready", waitForText: "Set up a staging environment" },
  turns: [
    turn({ at: "30s", status: "starting", user: "Set up a staging environment for the preview branch.", items: [] }),
    queuedTurn("Use the smaller database plan for it.", "20s", 1, { steerWhenReadyRunId: RunId.make(`${READY_ID}-run-1`) }),
    queuedTurn("And turn off outgoing emails there.", "10s", 2),
  ],
});

export default [several, held, steerReady];
