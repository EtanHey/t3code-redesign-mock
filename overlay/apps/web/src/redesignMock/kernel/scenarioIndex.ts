// The "Start here" index, generated at boot from the registry: one heading per family, each
// planted scenario as a thread link the app opens in place (`t3-thread://v2/<env>/<thread>`,
// which her markdown renders as an in-app link). A fixture labels itself with
// `scenario: { family, blurb }`; without a family it is inferred from the fixture's directory,
// then from the thread's planted project.
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { formatThreadLink } from "@t3tools/shared/threadLinks";

import { ENVIRONMENT_ID, PLANTED_PROJECTS, projectIdOf, type PlantedProjectKey } from "./constants";
import type { ScenarioFamily, ThreadDefinition } from "./definitions";
import type { Registry } from "./registry";

export const SCENARIO_INDEX_PLACEHOLDER = "{{SCENARIO_INDEX}}";

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

export function scenarioIndexMarkdown(registry: Registry): string {
  const groups = new Map<ScenarioFamily | null, string[]>();
  const entries = registry.threads
    .filter(({ definition }) => definition.scenario && definition.scenario.id !== "K00")
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
  const sections = [
    ...SCENARIO_FAMILIES.map(({ family, heading }) => ({ heading, lines: groups.get(family) ?? [] })),
    { heading: "Other", lines: groups.get(null) ?? [] },
  ].filter(({ lines }) => lines.length > 0);
  return sections.map(({ heading, lines }) => `**${heading}**\n\n${lines.join("\n")}`).join("\n\n");
}

/** Puts the generated index where a planted message says `{{SCENARIO_INDEX}}`. */
export function fillScenarioIndex(
  projection: OrchestrationV2ThreadProjection,
  index: () => string,
): OrchestrationV2ThreadProjection {
  const has = (text: string) => text.includes(SCENARIO_INDEX_PLACEHOLDER);
  if (!projection.messages.some((message) => has(message.text))) return projection;
  const markdown = index();
  const fill = (text: string) => text.replace(SCENARIO_INDEX_PLACEHOLDER, markdown);
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
