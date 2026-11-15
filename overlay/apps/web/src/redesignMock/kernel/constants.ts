import { EnvironmentId, ProjectId, ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";

/** The primary (planted, local) environment every fixture lands in unless it names another. */
export const ENVIRONMENT_ID = EnvironmentId.make("redesign-preview");
export const ENVIRONMENT_LABEL = "Preview workstation";

export const CODEX = ProviderInstanceId.make("codex");
export const CLAUDE = ProviderInstanceId.make("claudeAgent");

export const MODELS = {
  astra: { instanceId: CODEX, model: "gpt-6-astra" },
  sol: { instanceId: CODEX, model: "gpt-6.1-sol" },
  terra: { instanceId: CODEX, model: "gpt-6.1-terra" },
  opus: { instanceId: CLAUDE, model: "claude-opus-5-5" },
  sonnet: { instanceId: CLAUDE, model: "claude-sonnet-5-5" },
  haiku: { instanceId: CLAUDE, model: "claude-haiku-5-5" },
} as const satisfies Record<string, ModelSelection>;

export const DEFAULT_MODEL: ModelSelection = MODELS.astra;

/**
 * The sidebar is the visitor's table of contents: one planted project per family of states,
 * in this order. A fixture names its project by key.
 */
export const PLANTED_PROJECTS = {
  start: { order: 0, title: "preview-guide", label: "Start here" },
  conversation: { order: 1, title: "lumen-notes", label: "Conversation" },
  live: { order: 2, title: "harbor-api", label: "Live states" },
  requests: { order: 3, title: "quill-cms", label: "Requests and questions" },
  errors: { order: 4, title: "relay-billing", label: "Errors" },
  agents: { order: 5, title: "atlas-workflows", label: "Subagents and workflows" },
  git: { order: 6, title: "orbit-dashboard", label: "Git and pull requests" },
  sidebar: { order: 7, title: "pebble-mobile", label: "Sidebar states" },
} as const;

export type PlantedProjectKey = keyof typeof PLANTED_PROJECTS;

export function projectIdOf(key: PlantedProjectKey): ProjectId {
  return ProjectId.make(`project-${key}`);
}

export function workspaceRootOf(key: PlantedProjectKey): string {
  return `/workspace/${PLANTED_PROJECTS[key].title}`;
}
