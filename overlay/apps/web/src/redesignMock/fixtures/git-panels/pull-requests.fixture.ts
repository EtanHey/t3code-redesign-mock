import { assistant, thread, turn } from "~/redesignMock/api";

const now = new Date().toISOString();
const scenarios = [
  { id: "G02-open", title: "Open pull request", state: "open" as const, draft: false, checks: "passing" as const, review: "approved" as const },
  { id: "G02-draft", title: "Draft pull request", state: "open" as const, draft: true, checks: "pending" as const, review: "review-required" as const },
  { id: "G02-merged", title: "Merged pull request", state: "merged" as const, draft: false, checks: "passing" as const, review: "approved" as const },
  { id: "G02-closed", title: "Closed pull request", state: "closed" as const, draft: false, checks: "failing" as const, review: "changes-requested" as const },
];
export default scenarios.map((scenario, index) => thread({
  id: scenario.id.toLowerCase(), project: "git", title: scenario.title,
  scenario: { id: scenario.id, label: scenario.title, waitForText: "pull request" },
  turns: [turn({ at: "30m", user: "Review the pull request status.", items: [assistant("Open thread details to inspect the linked pull request.")] })],
  thread: { pullRequests: [{
    host: "github.com", repository: "sample-labs/orbit-dashboard", number: 101 + index,
    url: `https://github.com/sample-labs/orbit-dashboard/pull/${101 + index}`,
    source: "manual", linkedAt: now, stack: null,
    snapshot: { state: scenario.state, title: "Add dashboard summary", headBranch: "feature/dashboard-summary", baseBranch: "main", isDraft: scenario.draft, updatedAt: now, syncedAt: now, checksState: scenario.checks, reviewDecision: scenario.review, mergeability: "mergeable" },
  }] },
}));
