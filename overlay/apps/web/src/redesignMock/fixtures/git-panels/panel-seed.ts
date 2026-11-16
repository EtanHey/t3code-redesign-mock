// Plants "chat beside an open panel" for the git threads, once per browser, before the app's
// stores load: a workspace whose left column is the thread's chat and whose right column holds the
// panel (the diff, a pull request, the Pull requests page, the file tree), plus the right-panel
// store entry that says what that panel shows and, for a diff, which selection it opens on. All
// three are upstream zustand `persist` stores in localStorage; we write their saved shape, typed
// against upstream's own types, and the app decodes it as if a visitor had arranged it.
//
// Independent of the panes lane's seed (its own marker, appends to whatever layout exists), and
// seeded once so a visitor's later drags and closes are never overwritten. "Reset demo" clears
// localStorage, which plants it again.
import { ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { ENVIRONMENT_ID } from "~/redesignMock/api";
import type { DiffPanelSelection } from "~/diffPanelStore";
import type { LayoutTabContent, LayoutWorkspace } from "~/layout/layoutModel";
import type { RightPanelSurface, ThreadRightPanelState } from "~/rightPanelStore";

const LAYOUT_KEY = "t3code:layout-state:v2";
const LAYOUT_VERSION = 3;
const RIGHT_PANEL_KEY = "t3code:right-panel-state:v2";
const RIGHT_PANEL_VERSION = 14;
const DIFF_KEY = "t3code:diff-panel-state:v1";
const DIFF_VERSION = 2;

export interface PanelSeed {
  readonly threadId: string;
  readonly workspaceName: string;
  /** What the right column shows: a surface of this thread, or the Pull requests page. */
  readonly panel: RightPanelSurface | { readonly page: "pull-requests" };
  readonly diffSelection?: DiffPanelSelection;
  /** Width share of the chat column; the panel takes the rest. */
  readonly chatWidth?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
function read(storage: Storage, key: string): Record<string, unknown> {
  try {
    return record(JSON.parse(storage.getItem(key) ?? "null"));
  } catch {
    return {};
  }
}

const refOf = (threadId: string): ScopedThreadRef => ({
  environmentId: ENVIRONMENT_ID,
  threadId: ThreadId.make(threadId),
});

function workspaceOf(seed: PanelSeed): LayoutWorkspace {
  const ref = refOf(seed.threadId);
  const id = `mock-git-${seed.threadId}`;
  const chatWidth = seed.chatWidth ?? 0.4;
  const content: LayoutTabContent =
    "page" in seed.panel
      ? { kind: "pull-requests" }
      : { kind: "surface", threadRef: ref, surfaceId: seed.panel.id };
  return {
    id: `workspace:${id}`,
    name: seed.workspaceName,
    cameraWidth: null,
    focusedPaneId: `pane:${id}-chat`,
    columns: [
      {
        id: `column:${id}-chat`,
        width: chatWidth,
        panes: [
          {
            id: `pane:${id}-chat`,
            size: 1,
            activeTabId: `tab:${id}-chat`,
            tabs: [{ id: `tab:${id}-chat`, content: { kind: "chat", target: { kind: "server", threadRef: ref } } }],
          },
        ],
      },
      {
        id: `column:${id}-panel`,
        width: 1 - chatWidth,
        panes: [
          {
            id: `pane:${id}-panel`,
            size: 1,
            activeTabId: `tab:${id}-panel`,
            tabs: [{ id: `tab:${id}-panel`, content }],
          },
        ],
      },
    ],
  };
}

export function seedPanelsOnce(markerName: string, seeds: ReadonlyArray<PanelSeed>): void {
  const marker = `t3code-redesign-mock:git-panels-layout:${markerName}:v1`;
  try {
    const storage = window.localStorage;
    if (storage.getItem(marker) !== null) return;

    const layoutEnvelope = read(storage, LAYOUT_KEY);
    const layoutState = record(layoutEnvelope.state);
    const layout = record(layoutState.layout);
    const saved = Array.isArray(layout.workspaces) ? layout.workspaces : [];
    const start: LayoutWorkspace = {
      id: "workspace:mock-start",
      name: null,
      cameraWidth: null,
      columns: [],
      focusedPaneId: null,
    };
    storage.setItem(
      LAYOUT_KEY,
      JSON.stringify({
        ...layoutEnvelope,
        version: layoutEnvelope.version ?? LAYOUT_VERSION,
        state: {
          ...layoutState,
          companionShares: isRecord(layoutState.companionShares) ? layoutState.companionShares : {},
          layout: {
            ...layout,
            workspaces: [...(saved.length > 0 ? saved : [start]), ...seeds.map(workspaceOf)],
            focusedWorkspaceId: layout.focusedWorkspaceId ?? start.id,
          },
        },
      }),
    );

    const panelEnvelope = read(storage, RIGHT_PANEL_KEY);
    const panelState = record(panelEnvelope.state);
    const byThreadKey: Record<string, ThreadRightPanelState> = { ...record(panelState.byThreadKey) } as Record<
      string,
      ThreadRightPanelState
    >;
    for (const seed of seeds) {
      if ("page" in seed.panel) continue;
      byThreadKey[`${ENVIRONMENT_ID}:${seed.threadId}`] = {
        isOpen: true,
        activeSurfaceId: seed.panel.id,
        surfaces: [seed.panel],
      };
    }
    storage.setItem(
      RIGHT_PANEL_KEY,
      JSON.stringify({
        ...panelEnvelope,
        version: panelEnvelope.version ?? RIGHT_PANEL_VERSION,
        state: { threadPanelVisibilityByThreadKey: {}, ...panelState, byThreadKey },
      }),
    );

    if (seeds.some((seed) => seed.diffSelection !== undefined)) {
      const diffEnvelope = read(storage, DIFF_KEY);
      const diffState = record(diffEnvelope.state);
      const selections: Record<string, unknown> = { ...record(diffState.byThreadKey) };
      for (const seed of seeds) {
        if (seed.diffSelection) selections[`${ENVIRONMENT_ID}:${seed.threadId}`] = seed.diffSelection;
      }
      storage.setItem(
        DIFF_KEY,
        JSON.stringify({
          ...diffEnvelope,
          version: diffEnvelope.version ?? DIFF_VERSION,
          state: { branchBaseRefByThreadKey: {}, ...diffState, byThreadKey: selections },
        }),
      );
    }
    storage.setItem(marker, new Date().toISOString());
  } catch (error) {
    console.warn("[redesign-mock] could not plant the git panels layout", error);
  }
}
