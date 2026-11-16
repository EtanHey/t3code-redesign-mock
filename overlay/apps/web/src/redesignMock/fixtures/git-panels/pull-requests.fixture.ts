import { type ThreadPullRequestLink, type ThreadPullRequestWatch } from "@t3tools/contracts";
import { assistant, item, thread, turn } from "~/redesignMock/api";
import { entries, linkFor, projectId, repository, rows, timestamp, branchOf, worktreeOf } from "./data";
import { seedPanelsOnce, type PanelSeed } from "./panel-seed";

const prSurface = (number: number) =>
  ({
    id: `pull-request:${projectId}:github.com:${encodeURIComponent(repository)}:${number}`,
    kind: "pull-request",
    projectId,
    host: "github.com",
    repository,
    number,
    url: `https://github.com/${repository}/pull/${number}`,
    detailTab: "summary",
  }) as const;

const lifecycle = rows.map((row) =>
  thread({
    id: row.id.toLowerCase(),
    project: "git",
    title: `${row.id.startsWith("G02") ? (row.state === "open" ? (row.draft ? "Draft pull request" : "Open pull request: approved and passing") : `${row.state === "merged" ? "Merged" : "Closed"} pull request`) : row.conflicting ? "Pull request with merge conflicts" : row.rebase ? "Pull request needs a rebase" : row.checks === "failing" ? "Failing checks and changes requested" : "Pending checks and review required"}`,
    branch: branchOf[row.number]!,
    worktreePath: worktreeOf(branchOf[row.number]!),
    scenario: { id: row.id, label: row.title, waitForText: "pull request" },
    turns: [
      turn({
        at: "30m",
        user: row.id === "G03-failing"
          ? "Review the failing pull request. Its panel is open: click Summary, Guide, Timeline and Code to explore the review."
          : row.state === "merged"
            ? "Has the filter change landed?"
            : row.state === "closed"
              ? "What happened to the table change?"
              : row.rebase
                ? "Is the pagination branch up to date with main?"
                : "Review the pull request status.",
        items: [
          assistant(
            `Pull request #${row.number} is open beside this chat, on its Summary tab: readiness, checks, reviews, timeline and code are one click away. ${
              row.conflicting
                ? "The query helpers conflict with main."
                : row.rebase
                  ? "The branch is three commits behind main."
                  : row.state === "merged"
                    ? "It was merged into main."
                    : row.state === "closed"
                      ? "It was closed without merging."
                      : row.title + "."
            }`,
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
const panelSeeds: PanelSeed[] = [
  ...rows
    .filter((row) => row.id !== "G03-failing")
    .map((row) => ({
      threadId: row.id.toLowerCase(),
      workspaceName: `Pull request #${row.number}`,
      panel: prSurface(row.number),
    })),
  { threadId: "g04-native-stack", workspaceName: "Pull request stack", panel: prSurface(108) },
  { threadId: "p04-pull-requests", workspaceName: "Pull requests", panel: { page: "pull-requests" } },
];
seedPanelsOnce("pull-requests", panelSeeds);

export default [
  ...lifecycle,
  thread({
    id: "g04-native-stack",
    project: "git",
    title: "Three pull requests in an overview stack",
    branch: branchOf[108]!,
    worktreePath: worktreeOf(branchOf[108]!),
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
            "The stack has three layers: overview (#101), cached totals (#106), then pagination (#108). #108, the top layer, is open beside this chat; its Stack control lists the other two layers and the stack merge.",
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
      branch: branchOf[105]!,
      worktreePath: worktreeOf(branchOf[105]!),
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
                : "Unit tests failed. Typecheck passed; Browser smoke is still pending and Preview deployment is awaiting approval. I'll keep watching until the checks settle.",
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
    branch: branchOf[101]!,
    worktreePath: worktreeOf(branchOf[101]!),
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
            "The **Pull requests page** is open beside this chat. Filter by state, checks, review or label; select a request to inspect Summary, Guide, Timeline and Code. The approved overview has an attachment, checks and two review threads. Other requests show drafts, failures, pending checks, conflicts and a branch behind main.",
          ),
        ],
      }),
    ],
  }),
];
