import { ORCHESTRATION_V2_WS_METHODS, WS_METHODS } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import { now, rpc, stream, type HandlerContext } from "~/redesignMock/api";
import {
  changeFor,
  entries,
  largePatch,
  newSummary,
  oldSummary,
  summaryPatch,
  testPatch,
  whitespacePatch,
} from "../../fixtures/git-panels/data";

function workspace(cwd: string, { server }: HandlerContext) {
  const records = [...server.threads.values()].filter(({ projection }) => {
    const t = projection.thread;
    const root = server.projects.get(t.projectId)?.project.workspaceRoot;
    return (t.worktreePath ?? root) === cwd;
  });
  // A cwd identifies a worktree. Shared project roots have one branch; do not borrow
  // another worktree's status merely because its project has the same prefix.
  const branch = records.find(({ projection }) => projection.thread.branch)?.projection.thread.branch ?? "main";
  const changes = new Map<string, { path: string; insertions: number; deletions: number; status: "modified" }>();
  for (const { projection } of records) {
    for (const item of projection.turnItems) {
      if (item.type !== "file_change") continue;
      changes.set(item.fileName, { path: item.fileName, insertions: item.additions ?? 0,
        deletions: item.deletions ?? 0, status: "modified" });
    }
  }
  const slug = cwd.split("/").at(-1) ?? "";
  const pr =
    entries.find((entry) => entry.headBranch.endsWith(`/${slug}`)) ??
    (slug.startsWith("g05-")
      ? entries.find((e) => e.number === 105)
      : slug === "g04-stack"
        ? entries.find((e) => e.number === 108)
        : slug === "p04-list"
          ? entries[0]
          : undefined);
  const large = slug === "p03-large-diff";
  const truncated = slug === "p03-truncated-diff";
  const ours = cwd.startsWith("/workspace/orbit-dashboard/");
  const panes = branch === "feature/region-table";
  const change = pr ? changeFor(pr.number) : undefined;
  const files = change
    ? [
        { path: change.path, insertions: 3, deletions: 2, status: "modified" as const },
        ...(pr?.number === 101
          ? [{ path: "src/summary.test.ts", insertions: 5, deletions: 0, status: "added" as const }]
          : []),
      ]
    : large || truncated
      ? Array.from({ length: truncated ? 1 : 24 }, (_, index) => ({
          path: `data/activity-${index + 1}.ts`,
          insertions: 50,
          deletions: 0,
          status: "added" as const,
        }))
      : panes
        ? [{ path: "src/components/RegionTable.tsx", insertions: 7, deletions: 3, status: "modified" as const }]
        : ours
        ? [
            { path: "src/summary.ts", insertions: 3, deletions: 2, status: "modified" as const },
            { path: "src/summary.test.ts", insertions: 5, deletions: 0, status: "added" as const },
          ]
        : [...changes.values()];
  if (slug === "p03-whitespace")
    files.push({ path: "src/theme.ts", insertions: 1, deletions: 1, status: "modified" });
  return {
    pr,
    change,
    ours,
    files,
    large,
    truncated,
    slug,
    branch,
  };
}
export default [
  stream(WS_METHODS.subscribeVcsStatus, (input, context) => {
    const w = workspace(input.cwd, context);
    const insertions = w.files.reduce((sum, f) => sum + f.insertions, 0);
    const deletions = w.files.reduce((sum, f) => sum + f.deletions, 0);
    return Stream.concat(
      Stream.make({
        _tag: "snapshot" as const,
        local: {
          isRepo: true,
          hasPrimaryRemote: true,
          isDefaultRef: w.branch === "main",
          refName: w.branch,
          hasWorkingTreeChanges: w.files.length > 0,
          workingTree: { rootPath: input.cwd, files: w.files, insertions, deletions },
          branchChanges: { baseRef: "main", insertions, deletions },
        },
        remote: {
          hasUpstream: true,
          aheadCount: w.ours ? 2 : 0,
          behindCount: w.pr?.rebaseRequired ? 3 : 0,
          pr: w.pr
            ? {
                number: w.pr.number,
                title: w.pr.title,
                url: w.pr.url,
                baseRef: w.pr.baseBranch,
                headRef: w.pr.headBranch,
                state: w.pr.state,
                isDraft: w.pr.isDraft,
              }
            : null,
        },
      }),
      Stream.never,
    );
  }),
  rpc(WS_METHODS.vcsListRefs, (input, context) => {
    const w = workspace(input.cwd, context);
    return {
      refs: [
        {
          name: w.branch,
          current: true,
          isDefault: w.branch === "main",
          worktreePath: w.branch !== "main" ? input.cwd : null,
          lastCommitAt: 1794770400,
        },
        ...(w.branch !== "main"
          ? [
              {
                name: "main",
                current: false,
                isDefault: true,
                worktreePath: null,
                lastCommitAt: 1794766800,
              },
            ]
          : []),
      ],
      isRepo: true,
      hasPrimaryRemote: true,
      nextCursor: null,
      totalCount: w.branch !== "main" ? 2 : 1,
    };
  }),
  rpc(WS_METHODS.reviewGetBranchCommits, (input, context) => ({
    commits: workspace(input.cwd, context).ours
      ? [
          {
            sha: "a1b2c3d4e5f678901234567890abcdef123456789",
            subject: "Add the activity overview",
            committedAt: "2026-11-15T19:00:00.000Z",
          },
          {
            sha: "b2c3d4e5f678901234567890abcdef123456789a1",
            subject: "Cover the empty activity window",
            committedAt: "2026-11-15T18:00:00.000Z",
          },
        ]
      : [],
    truncated: false,
  })),
  rpc(WS_METHODS.reviewGetDiffPreview, (input, context) => {
    const w = workspace(input.cwd, context);
    const kind =
      input.file?.sourceKind ?? (input.commitSha ? "commit" : (input.sourceKind ?? "branch-range"));
    let patch = w.change
      ? w.change.patch
      : w.large || w.truncated
        ? largePatch
        : summaryPatch +
          testPatch +
          (w.slug === "p03-whitespace" && !input.ignoreWhitespace ? whitespacePatch : "");
    if (w.truncated)
      patch = largePatch.slice(0, largePatch.indexOf("diff --git", 100)) + "\n\n[truncated]";
    if (input.file)
      patch = patch
        .split(/(?=diff --git )/)
        .filter((part) => part.startsWith(`diff --git a/${input.file?.path} b/`))
        .join("");
    return {
      cwd: input.cwd,
      generatedAt: now(),
      sources: w.ours
        ? [
            {
              id: `${w.slug}-${kind}`,
              kind,
              title: kind === "working-tree" ? "Working tree changes" : "Changes from main",
              baseRef: "main",
              headRef: w.branch,
              diff: input.metadataOnly ? "" : patch,
              diffHash: `${w.slug}-${input.ignoreWhitespace ? "ignore" : "all"}`,
              truncated: w.truncated,
              patchesDeferred: input.metadataOnly ?? false,
              files: w.files.map((f) => ({
                path: f.path,
                previousPath: null,
                changeType: f.status === "added" ? ("new" as const) : ("change" as const),
                additions: f.insertions,
                deletions: f.deletions,
              })),
            },
          ]
        : [],
    };
  }),
  rpc(WS_METHODS.reviewGetDiffFileContents, (input, context) => {
    const w = workspace(input.cwd, context);
    if (input.newPath.endsWith(".test.ts"))
      return {
        oldContents: "",
        newContents:
          testPatch
            .split("@@ -0,0 +1,5 @@\n")[1]!
            .split("\n")
            .filter((line) => line.startsWith("+"))
            .map((line) => line.slice(1))
            .join("\n") + "\n",
      };
    if (input.newPath === "src/theme.ts")
      return { oldContents: "export const gap =  8;\n", newContents: "export const gap = 8;\n" };
    if (w.change) return w.change;
    if (input.newPath.startsWith("data/activity-")) {
      const file = Number(input.newPath.match(/activity-(\d+)/)?.[1] ?? 1) - 1;
      return {
        oldContents: "",
        newContents:
          "export const activity = [\n" +
          Array.from(
            { length: 48 },
            (_, line) =>
              `  { day: 'day-${file * 48 + line + 1}', visits: ${20 + line}, source: 'overview' },`,
          ).join("\n") +
          "\n];\n",
      };
    }
    return { oldContents: oldSummary, newContents: newSummary };
  }),
  rpc(ORCHESTRATION_V2_WS_METHODS.getTurnItem, (input, { server }) => ({
    item:
      server.projection(input.threadId)?.turnItems.find((item) => item.id === input.itemId) ?? null,
  })),
];
