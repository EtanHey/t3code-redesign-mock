// E05: system notices, the one-line rows the app adds between work: info, warning and error.
import { assistant, command, thread, turn } from "../../api";
import { noticeItem } from "./errors-kit";

export default thread({
  id: "e05-system-notices",
  project: "errors",
  title: "System notices: info, warning and error",
  scenario: { id: "E05", label: "System notices", waitForText: "payout schedule" },
  turns: [
    turn({
      at: "22m",
      took: "4m",
      user: "Check the payout schedule job against the staging calendar and fix any drift.",
      items: [
        noticeItem("info", "Context compacted automatically: 182k tokens down to 31k."),
        command({ input: "node scripts/print-schedule.mjs --env staging", output: "payout schedule (staging)\n  weekly   Fri 06:00 UTC\n  monthly  1st 06:00 UTC\n  retries  +4h, +1d" }),
        noticeItem("warning", "Approaching the 5-hour usage window: 85% used."),
        assistant("Staging matches the calendar except the monthly run, which fires at 06:00 instead of 09:00 UTC. I couldn't load your project instructions, so I'm following the repo's defaults.", { phase: "commentary" }),
        noticeItem("error", "Could not read AGENTS.md: permission denied. Continuing without project instructions."),
        assistant("The drift is in `jobs/payouts.cron.ts`: the monthly entry uses the old hour. Change `0 6 1 * *` to `0 9 1 * *` and the schedule agrees with the calendar."),
      ],
    }),
  ],
});
