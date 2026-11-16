// Independent once-only seed: preserve the panes lane's layouts and visitor changes.
// Write before app stores load, using the same persisted shapes as panes/layout-seed.ts.
import { ENVIRONMENT_ID, projectIdOf } from "~/redesignMock/api";
import type { LayoutWorkspace } from "~/layout/layoutModel";
import type { RightPanelSurface, ThreadRightPanelState } from "~/rightPanelStore";
import { ThreadId } from "@t3tools/contracts";
import { BUILD_INFO, mockRuntime } from "../../kernel/runtime";

const MARKER = "t3code-redesign-mock:environments-pr-layout:v1";
const THREAD = "g03-failing";
const ref = { environmentId: ENVIRONMENT_ID, threadId: ThreadId.make(THREAD) };
const surface: RightPanelSurface = {
  id: "pull-request:project-git:github.com:sample-labs%2Forbit-dashboard:105",
  kind: "pull-request", projectId: projectIdOf("git"), host: "github.com",
  repository: "sample-labs/orbit-dashboard", number: 105,
  url: "https://github.com/sample-labs/orbit-dashboard/pull/105", detailTab: "summary",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
function read(key: string): Record<string, unknown> {
  const raw = localStorage.getItem(key);
  return raw ? record(JSON.parse(raw)) : {};
}

function seed(): void {
  try {
    if (localStorage.getItem(MARKER)) return;
    const panelKey = "t3code:right-panel-state:v2";
    const panel = read(panelKey);
    const state = record(panel.state);
    const threadState: ThreadRightPanelState = { isOpen: true, activeSurfaceId: surface.id, surfaces: [surface] };
    localStorage.setItem(panelKey, JSON.stringify({
      ...panel, version: panel.version ?? 14,
      state: { ...state, byThreadKey: { ...record(state.byThreadKey), [`${ENVIRONMENT_ID}:${THREAD}`]: threadState } },
    }));

    const layoutKey = "t3code:layout-state:v2";
    const envelope = read(layoutKey);
    const layoutState = record(envelope.state);
    const layout = record(layoutState.layout);
    const workspace: LayoutWorkspace = {
      id: "workspace:mock-pr-review", name: "Pull request review", cameraWidth: null,
      focusedPaneId: "pane:mock-pr-chat",
      columns: [
        { id: "column:mock-pr-chat", width: 0.4, panes: [{ id: "pane:mock-pr-chat", size: 1, activeTabId: "tab:mock-pr-chat", tabs: [
          { id: "tab:mock-pr-chat", content: { kind: "chat", target: { kind: "server", threadRef: ref } } },
        ] }] },
        { id: "column:mock-pr-panel", width: 0.6, panes: [{ id: "pane:mock-pr-panel", size: 1, activeTabId: "tab:mock-pr-panel", tabs: [
          { id: "tab:mock-pr-panel", content: { kind: "surface", threadRef: ref, surfaceId: surface.id } },
        ] }] },
      ],
    };
    const saved = Array.isArray(layout.workspaces) ? layout.workspaces : [];
    // If this module loads first, supply a landing workspace for the initial route.
    const start: LayoutWorkspace = { id: "workspace:mock-start", name: null, cameraWidth: null, columns: [], focusedPaneId: null };
    localStorage.setItem(layoutKey, JSON.stringify({
      ...envelope, version: envelope.version ?? 3,
      state: { ...layoutState, layout: { ...layout,
        workspaces: [...(saved.length ? saved : [start]), workspace],
        focusedWorkspaceId: layout.focusedWorkspaceId ?? start.id,
      } },
    }));
    localStorage.setItem(MARKER, "seeded");
  } catch (error) {
    console.warn("[redesign-mock] could not seed the pull request review", error);
  }
}
seed();
// Guide is gated by a server preference, off by default upstream. Seed it on for the
// PR tour, while preserving a visitor's settings saved by the settings lane.
queueMicrotask(() => {
  try {
    if (localStorage.getItem(`redesign-mock:shell-settings:${BUILD_INFO.fixtureVersion}`)) return;
  } catch { /* Without storage, use the showcase default for this page load. */ }
  mockRuntime().primary.updateSettings({ reviewGuidesEnabled: true });
});
export default [];
