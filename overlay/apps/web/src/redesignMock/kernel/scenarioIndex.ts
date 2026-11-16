// The scenario index, generated at boot from the registry: one heading per family, each
// planted scenario as a thread link the app opens in place (`t3-thread://v2/<env>/<thread>`,
// which her markdown renders as an in-app link). A fixture labels itself with
// `scenario: { family, blurb }`; without a family it is inferred from the fixture's directory,
// then from the thread's planted project.
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { formatThreadLink } from "@t3tools/shared/threadLinks";

import { ENVIRONMENT_ID, PLANTED_PROJECTS, projectIdOf, type PlantedProjectKey } from "./constants";
import type { ScenarioFamily, ThreadDefinition } from "./definitions";
import type { Registry } from "./registry";

/**
 * `{{SCENARIO_INDEX}}` is the whole index and `{{SCENARIO_INDEX:<family>}}` one family's list;
 * `{{SCENARIO_COUNT}}` and `{{SCENARIO_COUNT:<family>}}` are how many threads those list. Index
 * threads themselves use scenario ids starting `K00` and are left out of every list.
 */
export const SCENARIO_INDEX_PLACEHOLDER = "{{SCENARIO_INDEX}}";
const PLACEHOLDER = /\{\{SCENARIO_(INDEX|COUNT)(?::([a-z]+))?\}\}/g;
export const scenarioIndexPlaceholder = (family: ScenarioFamily) => `{{SCENARIO_INDEX:${family}}}`;
export const scenarioCountPlaceholder = (family?: ScenarioFamily) =>
  family ? `{{SCENARIO_COUNT:${family}}}` : "{{SCENARIO_COUNT}}";

export const SCENARIO_FAMILIES: ReadonlyArray<{ readonly family: ScenarioFamily; readonly heading: string }> = [
  { family: "conversation", heading: "Conversation" },
  { family: "live", heading: "Live work" },
  { family: "requests", heading: "Approvals and questions" },
  { family: "errors", heading: "Errors" },
  { family: "agents", heading: "Subagents and workflows" },
  { family: "git", heading: "Git and pull requests" },
  { family: "panes", heading: "Workspace panes" },
  { family: "sidebar", heading: "Sidebar and settings" },
];

const BY_DIRECTORY: Readonly<Record<string, ScenarioFamily>> = {
  conv: "conversation",
  conversation: "conversation",
  live: "live",
  requests: "requests",
  errors: "errors",
  agents: "agents",
  git: "git",
  "git-panels": "git",
  panes: "panes",
  sidebar: "sidebar",
  settings: "sidebar",
  "sidebar-settings": "sidebar",
};

const BY_PROJECT: Partial<Record<PlantedProjectKey, ScenarioFamily>> = {
  conversation: "conversation",
  live: "live",
  requests: "requests",
  errors: "errors",
  agents: "agents",
  git: "git",
  sidebar: "sidebar",
};

function familyOf(source: string, definition: ThreadDefinition): ScenarioFamily | null {
  if (definition.scenario?.family) return definition.scenario.family;
  const directory = /fixtures\/([^/]+)\//.exec(source)?.[1];
  if (directory && BY_DIRECTORY[directory]) return BY_DIRECTORY[directory];
  const projectId = definition.projection.thread.projectId;
  for (const key of Object.keys(PLANTED_PROJECTS) as PlantedProjectKey[]) {
    if (projectIdOf(key) === projectId) return BY_PROJECT[key] ?? null;
  }
  return null;
}

const byId = (left: string, right: string) => left.localeCompare(right, "en", { numeric: true });

function scenarioGroups(registry: Registry): Map<ScenarioFamily | null, string[]> {
  const groups = new Map<ScenarioFamily | null, string[]>();
  const entries = registry.threads
    .filter(({ definition }) => definition.scenario && !definition.scenario.id.startsWith("K00"))
    .toSorted((left, right) => byId(left.definition.scenario?.id ?? "", right.definition.scenario?.id ?? ""));
  for (const { source, definition } of entries) {
    const scenario = definition.scenario;
    if (!scenario) continue;
    const link = formatThreadLink(
      { environmentId: definition.environmentId ?? ENVIRONMENT_ID, threadId: definition.projection.thread.id },
      scenario.label,
    );
    const line = `- ${link} \`${scenario.id}\`${scenario.blurb ? `: ${scenario.blurb}` : ""}`;
    const family = familyOf(source, definition);
    groups.set(family, [...(groups.get(family) ?? []), line]);
  }
  return groups;
}

export interface ScenarioIndex {
  readonly markdown: (family?: ScenarioFamily) => string;
  readonly count: (family?: ScenarioFamily) => number;
}

/** Built once, on first use: the registry is fixed after boot. */
export function scenarioIndex(registry: Registry): ScenarioIndex {
  let groups: Map<ScenarioFamily | null, string[]> | null = null;
  const get = () => (groups ??= scenarioGroups(registry));
  return {
    markdown: (family) => scenarioIndexMarkdown(get(), family),
    count: (family) =>
      family ? (get().get(family) ?? []).length : [...get().values()].reduce((sum, lines) => sum + lines.length, 0),
  };
}

function scenarioIndexMarkdown(groups: Map<ScenarioFamily | null, string[]>, family?: ScenarioFamily): string {
  if (family) return (groups.get(family) ?? []).join("\n");
  const sections = [
    ...SCENARIO_FAMILIES.map(({ family, heading }) => ({ heading, lines: groups.get(family) ?? [] })),
    { heading: "Other", lines: groups.get(null) ?? [] },
  ].filter(({ lines }) => lines.length > 0);
  return sections.map(({ heading, lines }) => `**${heading}**\n\n${lines.join("\n")}`).join("\n\n");
}

const FAMILIES = new Set<string>(SCENARIO_FAMILIES.map(({ family }) => family));
const isFamily = (value: string | undefined): value is ScenarioFamily => value !== undefined && FAMILIES.has(value);

/** Puts the generated index where a planted message carries a placeholder. */
export function fillScenarioIndex(
  projection: OrchestrationV2ThreadProjection,
  index: ScenarioIndex,
): OrchestrationV2ThreadProjection {
  const has = (text: string) => text.includes("{{SCENARIO_");
  if (!projection.messages.some((message) => has(message.text))) return projection;
  const fill = (text: string) =>
    text.replace(PLACEHOLDER, (match, kind: string, family: string | undefined) => {
      if (family !== undefined && !isFamily(family)) throw new Error(`redesign-mock: unknown index family in ${match}`);
      return kind === "COUNT" ? String(index.count(family)) : index.markdown(family);
    });
  return {
    ...projection,
    messages: projection.messages.map((message) => (has(message.text) ? { ...message, text: fill(message.text) } : message)),
    turnItems: projection.turnItems.map((item) =>
      item.type === "assistant_message" && has(item.text) ? { ...item, text: fill(item.text) } : item,
    ),
    visibleTurnItems: projection.visibleTurnItems.map((visible) =>
      visible.item.type === "assistant_message" && has(visible.item.text)
        ? { ...visible, item: { ...visible.item, text: fill(visible.item.text) } }
        : visible,
    ),
  };
}
