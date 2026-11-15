import { assistant, fileChange, thread, turn } from "~/redesignMock/api";

export default thread({
  id: "g01-worktree-changes", project: "git", title: "Review changes in a worktree",
  branch: "feature/dashboard-summary", worktreePath: "/workspace/orbit-dashboard",
  scenario: { id: "G01", label: "Worktree with changed files", waitForText: "dashboard summary" },
  turns: [turn({ at: "15m", user: "Add a dashboard summary.", items: [
    fileChange({ path: "src/summary.ts", additions: 3, deletions: 1, diff: "@@ -1 +1,3 @@\n-export const title = 'Dashboard';\n+export const title = 'Overview';\n+export const summary = 'Recent activity';\n+export const limit = 10;\n" }),
    assistant("The dashboard summary is ready to review in the worktree."),
  ] })],
});
