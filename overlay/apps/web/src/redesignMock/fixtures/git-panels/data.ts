import {
  SourceControlProviderKind,
  ProjectId,
  type PullRequestActivity,
  type PullRequestCheck,
  type PullRequestDetail,
  type PullRequestListEntry,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import attachment from "./summary-preview.svg?url&no-inline";

export const repository = "sample-labs/orbit-dashboard";
export const projectId = ProjectId.make("project-git");
export const timestamp = "2026-11-15T19:30:00.000Z";
export const author = { login: "fern-dev", name: "Fern", avatarUrl: null };
export const reviewer = { login: "river-review", name: "River", avatarUrl: null };
export const oldSummary = "export const title = 'Dashboard';\nexport const limit = 5;\n";
export const newSummary =
  "export const title = 'Overview';\nexport const summary = 'Recent activity';\nexport const limit = 10;\n";
export const summaryPatch = `diff --git a/src/summary.ts b/src/summary.ts
index 1234567..2345678 100644
--- a/src/summary.ts
+++ b/src/summary.ts
@@ -1,2 +1,3 @@
-export const title = 'Dashboard';
-export const limit = 5;
+export const title = 'Overview';
+export const summary = 'Recent activity';
+export const limit = 10;
`;
export const testPatch = `diff --git a/src/summary.test.ts b/src/summary.test.ts
new file mode 100644
--- /dev/null
+++ b/src/summary.test.ts
@@ -0,0 +1,5 @@
+import { expect, test } from 'vitest';
+import { limit, title } from './summary';
+test('shows the overview', () => {
+  expect([title, limit]).toEqual(['Overview', 10]);
+});
`;
export const largePatch = Array.from({ length: 24 }, (_, file) => {
  const lines = Array.from(
    { length: 48 },
    (_, line) =>
      `+  { day: 'day-${file * 48 + line + 1}', visits: ${20 + line}, source: 'overview' },`,
  ).join("\n");
  return `diff --git a/data/activity-${file + 1}.ts b/data/activity-${file + 1}.ts\nnew file mode 100644\n--- /dev/null\n+++ b/data/activity-${file + 1}.ts\n@@ -0,0 +1,50 @@\n+export const activity = [\n${lines}\n+];\n`;
}).join("");
export const whitespacePatch = `diff --git a/src/theme.ts b/src/theme.ts\n--- a/src/theme.ts\n+++ b/src/theme.ts\n@@ -1 +1 @@\n-export const gap =  8;\n+export const gap = 8;\n`;
export const rows: ReadonlyArray<{
  id: string;
  number: number;
  title: string;
  state: PullRequestListEntry["state"];
  draft?: boolean;
  checks: NonNullable<PullRequestListEntry["checksState"]>;
  review: NonNullable<PullRequestListEntry["reviewDecision"]>;
  conflicting?: boolean;
  rebase?: boolean;
}> = [
  {
    id: "G02-open",
    number: 101,
    title: "Add the activity overview",
    state: "open",
    checks: "passing",
    review: "approved",
  },
  {
    id: "G02-draft",
    number: 102,
    title: "Draft: explore compact activity cards",
    state: "open",
    draft: true,
    checks: "pending",
    review: "review-required",
  },
  {
    id: "G02-merged",
    number: 103,
    title: "Keep dashboard filters in the URL",
    state: "merged",
    checks: "passing",
    review: "approved",
  },
  {
    id: "G02-closed",
    number: 104,
    title: "Replace activity cards with a table",
    state: "closed",
    checks: "failing",
    review: "changes-requested",
  },
  {
    id: "G03-failing",
    number: 105,
    title: "Handle empty activity windows",
    state: "open",
    checks: "failing",
    review: "changes-requested",
  },
  {
    id: "G03-pending",
    number: 106,
    title: "Cache daily activity totals",
    state: "open",
    checks: "pending",
    review: "review-required",
  },
  {
    id: "G03-conflicts",
    number: 107,
    title: "Rename the activity query helpers",
    state: "open",
    checks: "passing",
    review: "approved",
    conflicting: true,
  },
  {
    id: "G03-rebase",
    number: 108,
    title: "Paginate the recent activity feed",
    state: "open",
    checks: "passing",
    review: "approved",
    rebase: true,
  },
];
export const entries: PullRequestListEntry[] = rows.map((row, index) => ({
  provider: SourceControlProviderKind.make("github"),
  host: "github.com",
  projectId,
  projectTitle: "orbit-dashboard",
  repository,
  number: row.number,
  title: row.title,
  url: `https://github.com/${repository}/pull/${row.number}`,
  author: index % 2 ? reviewer : author,
  headBranch: `feature/${row.id.toLowerCase()}`,
  baseBranch: "main",
  state: row.state,
  isDraft: row.draft ?? false,
  mergeability: row.conflicting ? "conflicting" : "mergeable",
  rebaseRequired: row.rebase ?? false,
  additions: row.number === 101 ? 8 : 3,
  deletions: 2,
  createdAt: "2026-11-14T09:00:00.000Z",
  updatedAt: timestamp,
  viewerReviewRequested: index % 2 === 1,
  labels: [
    { name: index % 2 ? "performance" : "enhancement", color: index % 2 ? "d4c5f9" : "84b6eb" },
  ],
  reviewDecision: row.review,
  checksState: row.checks,
}));
export function checksFor(entry: PullRequestListEntry): PullRequestCheck[] {
  return [
    {
      name: "Typecheck",
      status: "success",
      description: "All packages typecheck",
      required: true,
      url: null,
      startedAt: "2026-11-15T19:20:00.000Z",
      completedAt: "2026-11-15T19:21:12.000Z",
    },
    {
      name: "Unit tests",
      status:
        entry.checksState === "failing"
          ? "failure"
          : entry.checksState === "pending"
            ? "pending"
            : "success",
      description:
        entry.checksState === "failing"
          ? "Empty window should show the zero state: expected 0, received null"
          : "128 tests across 16 files",
      required: true,
      url: null,
    },
    {
      name: "Browser smoke",
      status: entry.isDraft
        ? "action-required"
        : entry.checksState === "pending" || entry.number === 105
          ? "pending"
          : "success",
      description: entry.isDraft
        ? "Workflow needs maintainer approval"
        : "Dashboard and keyboard navigation",
      required: true,
      url: null,
    },
    {
      name: "Optional benchmark",
      status: entry.number === 105 ? "cancelled" : "skipped",
      description: "Only runs for performance changes",
      url: null,
    },
    ...(entry.number === 105
      ? [
          {
            name: "Preview deployment",
            status: "action-required" as const,
            description: "Preview workflow needs maintainer approval",
            url: null,
          },
        ]
      : []),
    {
      name: "Change size",
      status: "neutral",
      description: "Small change, no size restriction",
      url: null,
    },
  ];
}
export const getEntry = (number: number) =>
  entries.find((entry) => entry.number === number) ?? entries[0]!;
export function detailFor(number: number): PullRequestDetail {
  const e = getEntry(number);
  return {
    ...e,
    workspaceRoot: `/workspace/orbit-dashboard/${e.headBranch.split("/")[1]}`,
    changedFiles: number === 101 ? 2 : 1,
    body: `## Summary\n\n${e.title}. The overview now explains recent activity without hiding the empty state.\n\n## Validation\n\n- Keyboard navigation through the filter bar\n- Empty, loading and populated activity windows\n- Unit tests for the summary limits\n\n![Overview with recent activity](${new URL(attachment, window.location.origin).href})\n`,
    capabilities: {
      diff: true,
      comment: true,
      actions: [
        "merge",
        "ready",
        "draft",
        "close",
        "reopen",
        "update-branch",
        "enable-auto-merge",
        "disable-auto-merge",
      ],
      mergeMethods: ["merge", "squash", "rebase"],
      search: true,
      reactions: true,
      viewedFiles: "environment",
      labels: true,
      review: {
        inlineComment: true,
        rangeComment: true,
        reply: true,
        resolve: true,
        verdicts: ["comment", "approve", "request-changes"],
      },
      reviewers: { request: true, listCandidates: true },
      edit: { changeRequest: true, comment: true },
      stacks: true,
    },
    viewerPermissions: {
      actions: ["merge", "ready", "draft", "close", "reopen", "update-branch"],
      comment: true,
      resolve: true,
      verdicts: ["comment", "approve", "request-changes"],
      requestReviewers: true,
      editChangeRequest: true,
      labels: true,
    },
    checks: checksFor(e),
    reviewers: [reviewer],
    mergeCapabilities: { merge: true, squash: true, rebase: true },
    viewer: author.login,
    headSha: "a1b2c3d4e5f678901234567890abcdef123456789",
    mergedAt: e.state === "merged" ? timestamp : null,
    closedAt: e.state === "closed" ? timestamp : null,
    baseComparison: e.rebaseRequired ? "behind" : "up-to-date",
    behindBy: e.rebaseRequired ? 3 : 0,
    autoMergeEnabled: false,
  };
}
export function activityFor(number: number): PullRequestActivity {
  const e = getEntry(number);
  return {
    author: e.author,
    reviewers: [reviewer],
    commentCount: 3,
    commentsTruncated: false,
    reviewThreadsTruncated: false,
    comments: [
      {
        id: `comment-${number}`,
        kind: "issue-comment",
        author,
        body: "Ready for a look. The screenshot above covers the populated state; the tests also cover an empty day.",
        createdAt: "2026-11-15T18:00:00.000Z",
        url: null,
        path: null,
        reviewState: null,
        canEdit: true,
        reactions: [
          { content: "eyes", count: 1, actors: [reviewer.login], viewerHasReacted: false },
        ],
      },
      {
        id: `review-${number}`,
        kind: "review",
        author: reviewer,
        body:
          e.reviewDecision === "changes-requested"
            ? "Please keep the empty window explicit before this lands."
            : "The summary reads well. Thanks for including keyboard coverage.",
        createdAt: "2026-11-15T19:00:00.000Z",
        url: null,
        path: null,
        reviewState:
          e.reviewDecision === "approved"
            ? "APPROVED"
            : e.reviewDecision === "changes-requested"
              ? "CHANGES_REQUESTED"
              : "COMMENTED",
      },
      {
        id: `followup-${number}`,
        kind: "issue-comment",
        author,
        body: "Added a regression case and simplified the label.",
        createdAt: timestamp,
        url: null,
        path: null,
        reviewState: null,
      },
    ],
    reviewThreads: [false, true].map((resolved, index) => ({
      id: `thread-${number}-${index}`,
      path: changeFor(number).path,
      line: index + 2,
      side: "right",
      isResolved: resolved,
      isOutdated: false,
      canResolve: true,
      snippet: changeFor(number)
        .newContents.trimEnd()
        .split("\n")
        .map((text, line) => ({ kind: "added", line: line + 1, text })),
      comments: [
        {
          id: `inline-${number}-${index}`,
          author: reviewer,
          body: resolved
            ? "Could we raise the limit to ten?"
            : "Should this label explain the selected date range?",
          createdAt: "2026-11-15T18:30:00.000Z",
          url: null,
        },
        ...(resolved
          ? [
              {
                id: `reply-${number}`,
                author,
                body: "Updated to ten and covered by the summary test.",
                createdAt: timestamp,
                url: null,
              },
            ]
          : []),
      ],
    })),
    commits: [
      {
        oid: "a1b2c3d4e5f678901234567890abcdef123456789",
        messageHeadline: e.title,
        committedDate: "2026-11-15T17:30:00.000Z",
        additions: e.additions,
        deletions: e.deletions,
        authors: [author],
        checks: {
          state: e.checksState ?? "pending",
          passed: e.checksState === "passing" ? 3 : 1,
          total: 3,
        },
      },
    ],
    reviewRequests: [{ actor: author, reviewer, createdAt: "2026-11-15T17:45:00.000Z" }],
  };
}
export function linkFor(number: number): ThreadPullRequestLink {
  const e = getEntry(number);
  return {
    host: e.host,
    repository,
    number,
    url: e.url,
    source: "manual",
    linkedAt: timestamp,
    stack: null,
    snapshot: {
      state: e.state,
      title: e.title,
      headBranch: e.headBranch,
      baseBranch: e.baseBranch,
      isDraft: e.isDraft,
      updatedAt: timestamp,
      syncedAt: timestamp,
      checksState: e.checksState,
      reviewDecision: e.reviewDecision,
      mergeability: e.mergeability,
      rebaseRequired: e.rebaseRequired,
      additions: e.additions,
      deletions: e.deletions,
      changedFiles: number === 101 ? 2 : 1,
      author: e.author,
    },
  };
}

// Each PR owns a distinct file and change, so switching threads does not reuse another branch's diff.
export function changeFor(number: number) {
  if (number === 101)
    return {
      path: "src/summary.ts",
      oldContents: oldSummary,
      newContents: newSummary,
      patch: summaryPatch + testPatch,
    };
  const changes: Record<number, { path: string; before: string; after: string }> = {
    102: {
      path: "src/cards.ts",
      before: "export const density = 'comfortable';\nexport const showMeta = true;\n",
      after:
        "export const density = 'compact';\nexport const showMeta = true;\nexport const cardGap = 8;\n",
    },
    103: {
      path: "src/filter-state.ts",
      before: "export const storage = 'memory';\nexport const key = 'filters';\n",
      after:
        "export const storage = 'url';\nexport const key = 'activity';\nexport const restoreOnLoad = true;\n",
    },
    104: {
      path: "src/activity-layout.ts",
      before: "export const layout = 'cards';\nexport const columns = 3;\n",
      after:
        "export const layout = 'table';\nexport const columns = 1;\nexport const stickyHeader = true;\n",
    },
    105: {
      path: "src/empty-window.ts",
      before: "export const emptyTotal = null;\nexport const emptyLabel = '';\n",
      after:
        "export const emptyTotal = 0;\nexport const emptyLabel = 'No activity in this window';\nexport const showDateRange = true;\n",
    },
    106: {
      path: "src/daily-cache.ts",
      before: "export const cacheEnabled = false;\nexport const ttl = 0;\n",
      after:
        "export const cacheEnabled = true;\nexport const ttl = 60;\nexport const keyByDate = true;\n",
    },
    107: {
      path: "src/activity-query.ts",
      before: "export const queryKey = 'events';\nexport const queryLimit = 5;\n",
      after:
        "export const queryKey = 'activity';\nexport const queryLimit = 10;\nexport const includeEmptyDays = true;\n",
    },
    108: {
      path: "src/pagination.ts",
      before: "export const pageSize = 5;\nexport const cursor = '';\n",
      after:
        "export const pageSize = 10;\nexport const cursor = null;\nexport const keepPreviousPage = true;\n",
    },
  };
  const c = changes[number] ?? changes[105]!;
  return {
    path: c.path,
    oldContents: c.before,
    newContents: c.after,
    patch: `diff --git a/${c.path} b/${c.path}\n--- a/${c.path}\n+++ b/${c.path}\n@@ -1,2 +1,3 @@\n${c.before
      .trimEnd()
      .split("\n")
      .map((l) => "-" + l)
      .join("\n")}\n${c.after
      .trimEnd()
      .split("\n")
      .map((l) => "+" + l)
      .join("\n")}\n`,
  };
}
