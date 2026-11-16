import { type ThreadPullRequestLink, type ThreadPullRequestWatch } from "@t3tools/contracts";
import { assistant, item, thread, turn } from "~/redesignMock/api";
import { entries, linkFor, rows, timestamp } from "./data";

const lifecycle = rows.map((row) =>
  thread({
    id: row.id.toLowerCase(),
    project: "git",
    title: `${row.id.startsWith("G02") ? (row.state === "open" ? (row.draft ? "Draft pull request" : "Open pull request: approved and passing") : `${row.state === "merged" ? "Merged" : "Closed"} pull request`) : row.conflicting ? "Pull request with merge conflicts" : row.rebase ? "Pull request needs a rebase" : row.checks === "failing" ? "Failing checks and changes requested" : "Pending checks and review required"}`,
    branch: `feature/${row.id.toLowerCase()}`,
    worktreePath: `/workspace/orbit-dashboard/${row.id.toLowerCase()}`,
    scenario: { id: row.id, label: row.title, waitForText: "pull request" },
    turns: [
      turn({
        at: "30m",
        user: "Review the pull request status.",
        items: [
          assistant(
            `The linked pull request is ready to inspect. Open its badge for the summary, readiness card, checks, reviews, timeline and code. ${row.conflicting ? "The summary helper conflicts with main." : row.rebase ? "The branch is three commits behind main." : row.title + "."}`,
          ),
        ],
      }),
    ],
    thread: { pullRequests: [linkFor(row.number)] },
  }),
);
const stackLinks: ThreadPullRequestLink[] = [101, 106, 108].map((number) => ({
  ...linkFor(number),
  source: "stack",
  stack: {
    kind: "native",
    id: "overview-stack",
    number: 12,
    url: "https://github.com/sample-labs/orbit-dashboard/pull/101",
    base: "main",
    layers: [101, 106, 108].map((n) => ({
      number: n,
      headBranch: entries.find((e) => e.number === n)!.headBranch,
      state: "open",
    })),
  },
}));
const watch: ThreadPullRequestWatch = {
  startedAt: timestamp,
  headSha: "a1b2c3d4",
  failedChecks: ["Unit tests"],
  passed: false,
  passedChecks: ["Typecheck"],
  owedChecks: ["Browser smoke"],
  awaitingApproval: ["Preview deployment"],
  approvalAnnounced: true,
  remarksThrough: timestamp,
  remarkIds: [],
  conflicting: false,
  wakes: 2,
  checksPending: true,
};
export default [
  ...lifecycle,
  thread({
    id: "g04-native-stack",
    project: "git",
    title: "Three pull requests in an overview stack",
    branch: "feature/g03-rebase",
    worktreePath: "/workspace/orbit-dashboard/g04-stack",
    scenario: {
      id: "G04",
      label: "Native stack with three linked PRs",
      waitForText: "three layers",
    },
    thread: { pullRequests: stackLinks },
    turns: [
      turn({
        at: "20m",
        user: "Show how the overview stack fits together.",
        items: [
          assistant(
            "The stack has three layers: overview, cached totals, then pagination. Inspect the linked pull requests to compare their checks and branches.",
          ),
        ],
      }),
    ],
  }),
  ...[false, true].map((ended) =>
    thread({
      id: ended ? "g05-ended-watch" : "g05-pr-watch",
      project: "git",
      title: ended
        ? "Pull request watch ended after a CI wake"
        : "Watching a pull request: tests failed, approval pending",
      branch: "feature/g03-failing",
      worktreePath: `/workspace/orbit-dashboard/g05-${ended ? "ended" : "watch"}`,
      scenario: {
        id: ended ? "G05-ended" : "G05",
        label: "PR watch with CI and approval states",
        waitForText: "Unit tests",
      },
      shell: ended
        ? {}
        : {
            pendingBackgroundTasks: [
              {
                kind: "monitor",
                taskId: "overview-pr-watch",
                description: "Watching PR #105 for CI and review updates",
                awaited: true,
              },
            ],
          },
      thread: {
        pullRequests: [{ ...linkFor(105), ...(ended ? { endedWatch: watch } : { watch }) }],
      },
      turns: [
        turn({
          at: "10m",
          user: "Watch this pull request while CI runs.",
          items: [
            item((base) => ({
              ...base,
              type: "notification",
              source: {
                kind: "monitor",
                pullRequest: {
                  host: "github.com",
                  repository: "sample-labs/orbit-dashboard",
                  number: 105,
                  watchStartedAt: timestamp,
                  headSha: watch.headSha,
                  watchEnded: ended,
                },
              },
              outcome: "updated",
              summary: "Unit tests failed; preview workflow needs approval",
              detail:
                "Typecheck passed. Browser smoke is still owed. The empty-window regression needs attention.",
            })),
            assistant(
              ended
                ? "The watch ended after notifying you about Unit tests. The last observed checks remain available on the pull request."
                : "Unit tests failed. Typecheck passed; Browser smoke is still pending and Preview deployment is awaiting approval. This planted watch stays in that state.",
            ),
          ],
        }),
      ],
    }),
  ),
  thread({
    id: "p04-pull-requests",
    project: "git",
    title: "Browse pull requests, filters and review details",
    branch: "feature/g02-open",
    worktreePath: "/workspace/orbit-dashboard/p04-list",
    scenario: {
      id: "P04",
      label: "Pull requests page entry point",
      waitForText: "Pull requests page",
    },
    thread: { pullRequests: [linkFor(101)] },
    turns: [
      turn({
        at: "5m",
        user: "Where can I explore the pull request redesign?",
        items: [
          assistant(
            "Open the **Pull requests page** from the sidebar. Filter by state, checks, review or label; select a request to inspect Summary, Guide, Timeline and Code. The approved overview has an attachment, checks and two review threads. Other requests show drafts, failures, pending checks, conflicts and a branch behind main.",
          ),
        ],
      }),
    ],
  }),
];
