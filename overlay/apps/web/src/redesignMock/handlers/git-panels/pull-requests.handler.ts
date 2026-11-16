import {
  SourceControlProviderKind,
  PullRequestDiffInput,
  WS_METHODS,
  type PullRequestActivity,
  type PullRequestListInput,
  type PullRequestDetail,
  type PullRequestFilesViewedResult,
  type PullRequestReviewGuideResult,
} from "@t3tools/contracts";
import { parsePullRequestQuery } from "@t3tools/client-runtime/pull-request-query";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { MODELS, rpc, stream } from "~/redesignMock/api";
import {
  changeFor,
  activityFor,
  author,
  detailFor,
  entries,
  getEntry,
  projectId,
  reviewer,
  testPatch,
  timestamp,
} from "../../fixtures/git-panels/data";

// Detail, checks, timeline and code use one browser-local source of truth. Reload resets PR actions.
const details = new Map<number, PullRequestDetail>();
const activities = new Map<number, PullRequestActivity>();
const viewed = new Map<number, PullRequestFilesViewedResult>();
const detail = (number: number) => {
  let d = details.get(number);
  if (!d) {
    d = detailFor(number);
    details.set(number, d);
  }
  return d;
};
const activity = (number: number) => {
  let a = activities.get(number);
  if (!a) {
    a = activityFor(number);
    activities.set(number, a);
  }
  return a;
};
let diffInstalled = false;
function installDiffEndpoint() {
  if (diffInstalled) return;
  diffInstalled = true;
  const fetch = window.fetch.bind(window);
  window.fetch = async (request, init) => {
    const url = new URL(request instanceof Request ? request.url : String(request), location.href);
    if (url.origin === location.origin && url.pathname === "/api/pull-requests/diff") {
      const body: unknown = await new Request(
        request instanceof Request ? request : url,
        init,
      ).json();
      // Decode the actual HTTP contract instead of accepting arbitrary input as a typed request.
      const input = Schema.decodeUnknownSync(PullRequestDiffInput)(body);
      return Response.json({
        patch: changeFor(input.number).patch,
        truncated: false,
        nextCursor: null,
      });
    }
    return fetch(request, init);
  };
}
// The app captures fetch when its HTTP layer is built. Install after the kernel guard,
// before the next module script bootstraps that layer; waiting for a detail RPC is too late.
queueMicrotask(installDiffEndpoint);

function guide(number: number): PullRequestReviewGuideResult {
  const d = detail(number);
  const change = changeFor(number);
  return {
    currentHeadSha: d.headSha ?? null,
    run: null,
    guide: {
      headSha: d.headSha!,
      generatedAt: timestamp,
      modelSelection: MODELS.sol,
      stops: [
        {
          title: "Read the overview before the tests",
          summary:
            "The summary introduces a clearer label and raises the visible activity limit to ten.",
          attention: {
            kind: "product",
            note: "Check that the empty state still explains the selected date window.",
          },
          excerpts: [
            {
              path: change.path,
              side: "new",
              start: 1,
              end: 3,
              caption: "The overview's public labels and default limit",
            },
          ],
          files: [
            { path: change.path, note: "Labels and display limit" },
            { path: "src/summary.test.ts", note: "Regression coverage" },
          ],
          notes: [
            {
              path: change.path,
              line: 3,
              title: "Visible limit",
              body: "Ten entries fit the compact layout while leaving room for filters.",
            },
          ],
          questions: ["Does the summary remain clear when there are no matching events?"],
        },
      ],
    },
  };
}
const routingIdentity = {
  accountId: "mock-source-control",
  host: "github.com",
  provider: SourceControlProviderKind.make("github"),
  viewer: author.login,
};
const BURST_MS = 120;
const bursts = new Map<string, { size: number }>();
function listPullRequests(input: PullRequestListInput, hidden: boolean) {
    installDiffEndpoint();
    const query = parsePullRequestQuery(input.query ?? "");
    const filters = { ...input.filters, ...query.filters };
    const list = entries
      .map((e) => {
        const d = details.get(e.number);
        return d
          ? {
              ...e,
              title: d.title,
              state: d.state,
              isDraft: d.isDraft,
              labels: d.labels,
              mergeability: d.mergeability,
            }
          : e;
      })
      .filter((e) => {
        if (input.state !== "all" && e.state !== input.state) return false;
        if (input.projectId && input.projectId !== e.projectId) return false;
        if (input.projectIds && !input.projectIds.includes(e.projectId)) return false;
        if (input.involvement === "reviewing" && !e.viewerReviewRequested) return false;
        if (input.involvement === "authored" && e.author?.login !== author.login) return false;
        if ((filters?.draft === "only" && !e.isDraft) || (filters?.draft === "hide" && e.isDraft))
          return false;
        if (filters?.review && filters.review !== e.reviewDecision) return false;
        if (filters?.checks && filters.checks !== e.checksState) return false;
        if (
          filters?.author &&
          e.author?.login !== (/^@?me$/.test(filters.author) ? author.login : filters.author)
        )
          return false;
        if (
          filters?.labels?.some(
            (group) => !group.some((name) => e.labels.some((l) => l.name === name)),
          )
        )
          return false;
        if (filters?.excludedLabels?.some((name) => e.labels.some((l) => l.name === name)))
          return false;
        return (
          !query.text ||
          `${e.title} ${e.number} ${e.headBranch} ${e.author?.login}`
            .toLowerCase()
            .includes(query.text.toLowerCase())
        );
      });
    return {
      viewers: { "github.com": author.login },
      providers: [
        {
          host: "github.com",
          kind: SourceControlProviderKind.make("github"),
          searchesOnHost: true,
          projectCount: 1,
          projectIds: [projectId],
          configured: true,
          detail: null,
        },
      ],
      entries: hidden ? [] : list,
      errors: [],
      truncated: false,
      nextCursors: {},
    };
  }
export default [
  rpc(WS_METHODS.pullRequestsList, (input) => {
    // The page asks every connected environment the same question at once, and a handler cannot
    // tell which one is asking. orbit-dashboard lives on this machine only, so of a burst of
    // identical queries only the last, this machine's, gets the list.
    const key = JSON.stringify(input);
    const burst = bursts.get(key) ?? { size: 0 };
    const index = burst.size++;
    if (index === 0) {
      bursts.set(key, burst);
      setTimeout(() => bursts.delete(key), BURST_MS * 2);
    }
    return Effect.promise(
      () => new Promise<void>((resolve) => setTimeout(resolve, BURST_MS)),
    ).pipe(Effect.map(() => listPullRequests(input, index !== burst.size - 1)));
  }),
  rpc(WS_METHODS.pullRequestsListStats, (input) => ({
    stats: input.refs.map((ref) => {
      const e = getEntry(ref.number);
      return {
        projectId,
        repository: e.repository,
        number: e.number,
        additions: e.additions,
        deletions: e.deletions,
      };
    }),
  })),
  rpc(WS_METHODS.pullRequestsFilterOptions, () => ({
    labels: [
      { name: "enhancement", color: "84b6eb" },
      { name: "performance", color: "d4c5f9" },
    ],
    authors: [author, reviewer],
    references: [],
    truncated: false,
  })),
  rpc(WS_METHODS.pullRequestsRoutingIdentity, () => routingIdentity),
  rpc(WS_METHODS.pullRequestsRouting, (input) => ({
    ...routingIdentity,
    projectTitle: "orbit-dashboard",
    workspaceRoot: detail(input.number).workspaceRoot,
  })),
  rpc(WS_METHODS.pullRequestsDetail, (input) => {
    installDiffEndpoint();
    return detail(input.number);
  }),
  rpc(WS_METHODS.pullRequestsSummary, (input) => ({
    ...getEntry(input.number),
    ...detail(input.number),
  })),
  rpc(WS_METHODS.pullRequestsPreview, (input) => detail(input.number)),
  rpc(WS_METHODS.pullRequestsChecks, (input) => ({
    state: detail(input.number).state,
    checks: detail(input.number).checks,
  })),
  rpc(WS_METHODS.pullRequestsActivity, (input) => activity(input.number)),
  rpc(WS_METHODS.pullRequestsReviewGuide, (input) => guide(input.number)),
  rpc(WS_METHODS.pullRequestsGenerateReviewGuide, (input) => guide(input.number)),
  rpc(WS_METHODS.pullRequestsStack, (input) =>
    [101, 106, 108].includes(input.number)
      ? {
          id: "overview-stack",
          number: 12,
          url: getEntry(101).url,
          base: "main",
          layers: [101, 106, 108].map((n) => ({
            number: n,
            title: detail(n).title,
            headBranch: detail(n).headBranch,
            state: detail(n).state,
          })),
        }
      : null,
  ),
  rpc(WS_METHODS.pullRequestsLinkedThreads, (input, { server }) => ({
    threads: [...server.threads.values()]
      .map((record) => record.projection.thread)
      .filter((t) => t.pullRequests?.some((pr) => pr.number === input.number))
      .map((t) => ({ id: t.id, projectId: t.projectId, title: t.title, archivedAt: null })),
  })),
  rpc(WS_METHODS.pullRequestsDiffFileContents, (input) =>
    input.newPath.endsWith(".test.ts")
      ? {
          oldContents: "",
          newContents:
            testPatch
              .split("@@ -0,0 +1,5 @@\n")[1]!
              .split("\n")
              .filter((line) => line.startsWith("+"))
              .map((line) => line.slice(1))
              .join("\n") + "\n",
        }
      : changeFor(input.number),
  ),
  rpc(
    WS_METHODS.pullRequestsFilesViewed,
    (input) => viewed.get(input.number) ?? { files: [], truncated: false },
  ),
  rpc(WS_METHODS.pullRequestsSetFilesViewed, (input) => {
    const previous = viewed.get(input.number)?.files ?? [];
    viewed.set(input.number, {
      files: [
        ...previous.filter((f) => !input.files.some((v) => v.path === f.path)),
        ...input.files.map((f) => ({
          path: f.path,
          state: f.viewed ? ("viewed" as const) : ("unviewed" as const),
        })),
      ],
      truncated: false,
    });
  }),
  rpc(WS_METHODS.pullRequestsChangeBreakdown, (input) => ({
    code: { additions: 3, deletions: 2 },
    tests: { additions: input.number === 101 ? 5 : 0, deletions: 0 },
    mocks: { additions: 0, deletions: 0 },
    generated: { additions: 0, deletions: 0 },
    docs: { additions: 0, deletions: 0 },
  })),
  rpc(WS_METHODS.pullRequestsUpdate, (input) => {
    details.set(input.number, {
      ...detail(input.number),
      ...(input.title ? { title: input.title } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
    });
  }),
  rpc(WS_METHODS.pullRequestsComment, (input) => {
    const a = activity(input.number);
    activities.set(input.number, {
      ...a,
      commentCount: a.commentCount + 1,
      comments: [
        ...a.comments,
        {
          id: `visitor-${a.commentCount}`,
          kind: "issue-comment",
          author,
          body: input.body,
          createdAt: new Date().toISOString(),
          url: null,
          path: null,
          reviewState: null,
          canEdit: true,
        },
      ],
    });
  }),
  rpc(WS_METHODS.pullRequestsSetThreadResolution, (input) => {
    const a = activity(input.number);
    activities.set(input.number, {
      ...a,
      reviewThreads: a.reviewThreads.map((t) =>
        t.id === input.threadId ? { ...t, isResolved: input.resolved } : t,
      ),
    });
  }),
  rpc(WS_METHODS.pullRequestsReplyToThread, (input) => {
    const a = activity(input.number);
    activities.set(input.number, {
      ...a,
      reviewThreads: a.reviewThreads.map((t) =>
        t.id === input.threadId
          ? {
              ...t,
              comments: [
                ...t.comments,
                {
                  id: `visitor-${t.comments.length}`,
                  author,
                  body: input.body,
                  createdAt: new Date().toISOString(),
                  url: null,
                },
              ],
            }
          : t,
      ),
    });
  }),
  rpc(WS_METHODS.pullRequestsThreadComments, () => ({ comments: [], nextCursor: null })),
  rpc(WS_METHODS.pullRequestsUpdateComment, (input) => {
    const a = activity(input.number);
    activities.set(input.number, {
      ...a,
      comments: a.comments.map((c) => (c.id === input.commentId ? { ...c, body: input.body } : c)),
    });
  }),
  rpc(WS_METHODS.pullRequestsRunAction, (input) => {
    const d = detail(input.number);
    details.set(input.number, {
      ...d,
      state:
        input.action === "merge"
          ? "merged"
          : input.action === "close"
            ? "closed"
            : input.action === "reopen"
              ? "open"
              : d.state,
      isDraft: input.action === "draft" ? true : input.action === "ready" ? false : d.isDraft,
      autoMergeEnabled:
        input.action === "enable-auto-merge"
          ? true
          : input.action === "disable-auto-merge"
            ? false
            : d.autoMergeEnabled,
      ...(input.action === "update-branch"
        ? { baseComparison: "up-to-date", behindBy: 0, rebaseRequired: false }
        : {}),
    });
    return input.replyWithSummary
      ? { ...getEntry(input.number), ...detail(input.number) }
      : undefined;
  }),
  rpc(WS_METHODS.pullRequestsReviewerCandidates, () => ({
    candidates: [{ ...reviewer, id: reviewer.login, kind: "user" as const, isRequested: true }],
    truncated: false,
  })),
  rpc(WS_METHODS.pullRequestsRequestReviewers, (input) => {
    const d = detail(input.number);
    details.set(input.number, { ...d, reviewers: input.requested ? [reviewer] : [] });
  }),
  rpc(WS_METHODS.pullRequestsLabelCandidates, (input) => ({
    candidates: [
      {
        name: "enhancement",
        color: "84b6eb",
        description: "New dashboard behavior",
        isApplied: detail(input.number).labels.some((l) => l.name === "enhancement"),
      },
      {
        name: "performance",
        color: "d4c5f9",
        description: "Activity query performance",
        isApplied: detail(input.number).labels.some((l) => l.name === "performance"),
      },
    ],
    truncated: false,
  })),
  rpc(WS_METHODS.pullRequestsSetLabels, (input) => {
    const d = detail(input.number);
    details.set(input.number, {
      ...d,
      labels: input.applied
        ? [
            ...d.labels.filter((l) => !input.labels.includes(l.name)),
            ...input.labels.map((name) => ({ name, color: "84b6eb" })),
          ]
        : d.labels.filter((l) => !input.labels.includes(l.name)),
    });
  }),
  rpc(WS_METHODS.pullRequestsSetReaction, (input) => {
    const a = activity(input.number);
    const reactions = input.reacted
      ? [{ content: input.content, count: 1, actors: [], viewerHasReacted: true }]
      : [];
    activities.set(input.number, {
      ...a,
      ...(input.subjectId
        ? { comments: a.comments.map((c) => (c.id === input.subjectId ? { ...c, reactions } : c)) }
        : { reactions }),
    });
  }),
  rpc(WS_METHODS.pullRequestsSubmitReview, (input) => {
    const a = activity(input.number);
    activities.set(input.number, {
      ...a,
      comments: [
        ...a.comments,
        {
          id: `visitor-review-${a.comments.length}`,
          kind: "review",
          author,
          body: input.body,
          createdAt: new Date().toISOString(),
          url: null,
          path: null,
          reviewState:
            input.verdict === "approve"
              ? "APPROVED"
              : input.verdict === "request-changes"
                ? "CHANGES_REQUESTED"
                : "COMMENTED",
        },
      ],
      commentCount: a.commentCount + 1,
      reviewThreads: [
        ...a.reviewThreads,
        ...input.comments.map((c, index) => ({
          id: `visitor-thread-${a.reviewThreads.length + index}`,
          path: c.path,
          line: c.position.kind === "deleted" ? c.position.oldLine : c.position.newLine,
          side: c.position.kind === "deleted" ? ("left" as const) : ("right" as const),
          isResolved: false,
          isOutdated: false,
          comments: [
            {
              id: `visitor-inline-${index}`,
              author,
              body: c.body,
              createdAt: new Date().toISOString(),
              url: null,
            },
          ],
        })),
      ],
    });
  }),
  rpc(WS_METHODS.pullRequestsInvalidate, () => {}),
  stream(WS_METHODS.pullRequestsSubscribeRefreshes, () => Stream.never),
  stream(WS_METHODS.pullRequestsSubscribeLinkedThreadRefreshes, () => Stream.never),
];
