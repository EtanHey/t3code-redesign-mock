// Plants a workspace layout once per browser, before the app's stores load: the layout store
// (workspaces, columns, panes, tabs), the right-panel store (what each surface tab shows) and the
// terminal UI store (which terminals the thread's terminal pane holds). All three are upstream
// zustand `persist` stores in localStorage; we write their saved shape, typed against upstream's
// own types, and the app decodes it as if a visitor had arranged it.
//
// Seeded once: a marker key records it, so a visitor's later drags, closes and splits are never
// overwritten. "Reset demo" clears localStorage (marker included), which plants it again. If the
// visitor already has a saved layout from before this lane shipped, our workspaces are appended
// to theirs instead of replacing it.
import { ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { ENVIRONMENT_ID } from "~/redesignMock/api";
import type * as LayoutModel from "~/layout/layoutModel";
import type { LayoutColumn, LayoutPane, LayoutState, LayoutTab, LayoutWorkspace } from "~/layout/layoutModel";
import type { RightPanelSurface, ThreadRightPanelState } from "~/rightPanelStore";
import type { ThreadTerminalGroup } from "~/types";

const MARKER_KEY = "t3code-redesign-mock:panes-layout-seeded:v1";
const LAYOUT_KEY = "t3code:layout-state:v2";
const LAYOUT_VERSION = 3;
const RIGHT_PANEL_KEY = "t3code:right-panel-state:v2";
const RIGHT_PANEL_VERSION = 14;
const TERMINAL_KEY = "t3code:terminal-state:v1";
const TERMINAL_VERSION = 4;
const RENDER_MARKDOWN_KEY = "t3code.renderMarkdown";
const THREAD_TERMINAL: typeof LayoutModel.THREAD_TERMINAL_SURFACE_ID = "thread-terminal";

/** Mirrors upstream's (unexported) ThreadTerminalUiState in terminalUiStateStore.ts. */
interface TerminalUiState {
  terminalOpen: boolean;
  terminalHeight: number;
  terminalIds: string[];
  activeTerminalId: string;
  terminalGroups: ThreadTerminalGroup[];
  activeTerminalGroupId: string;
}

export interface SeedThread {
  readonly threadId: string;
  /** Surfaces of this thread, in tab order; the layout places them by id. */
  readonly surfaces: ReadonlyArray<RightPanelSurface>;
  readonly activeSurfaceId: string | null;
  readonly terminals?: { readonly ids: ReadonlyArray<string>; readonly active: string };
}

export interface SeedPane {
  readonly id: string;
  /** Each tab: a chat of a thread, or a surface (`surfaceId`) of a thread. */
  readonly tabs: ReadonlyArray<{ readonly chat: string } | { readonly thread: string; readonly surfaceId: string }>;
  readonly active: number;
  readonly size: number;
}

export interface SeedWorkspace {
  readonly id: string;
  readonly name: string;
  readonly columns: ReadonlyArray<{ readonly id: string; readonly width: number; readonly panes: ReadonlyArray<SeedPane> }>;
  readonly focusedPaneId: string;
}

export interface LayoutSeed {
  readonly threads: ReadonlyArray<SeedThread>;
  readonly workspaces: ReadonlyArray<SeedWorkspace>;
}

const refOf = (threadId: string): ScopedThreadRef => ({
  environmentId: ENVIRONMENT_ID,
  threadId: ThreadId.make(threadId),
});
const keyOf = (threadId: string) => `${ENVIRONMENT_ID}:${threadId}`;

function buildWorkspace(seed: SeedWorkspace): LayoutWorkspace {
  const columns: LayoutColumn[] = seed.columns.map((column) => ({
    id: column.id,
    width: column.width,
    panes: column.panes.map((pane): LayoutPane => {
      const tabs: LayoutTab[] = pane.tabs.map((tab, index) => ({
        id: `${pane.id}:tab-${index}`,
        content:
          "chat" in tab
            ? { kind: "chat", target: { kind: "server", threadRef: refOf(tab.chat) } }
            : { kind: "surface", threadRef: refOf(tab.thread), surfaceId: tab.surfaceId },
      }));
      return { id: pane.id, tabs, activeTabId: tabs[pane.active]?.id ?? null, size: pane.size };
    }),
  }));
  return { id: seed.id, name: seed.name, columns, focusedPaneId: seed.focusedPaneId, cameraWidth: null };
}

function readJson(storage: Storage, key: string): unknown {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The `state` object inside a zustand persist envelope, or an empty one. */
function persistedState(value: unknown): Record<string, unknown> {
  return isRecord(value) && isRecord(value.state) ? value.state : {};
}

function persistedVersion(value: unknown, fallback: number): number {
  return isRecord(value) && typeof value.version === "number" ? value.version : fallback;
}

export function seedLayoutOnce(seed: LayoutSeed): void {
  let storage: Storage;
  try {
    storage = window.localStorage;
    if (storage.getItem(MARKER_KEY) !== null) return;
  } catch {
    return; // No storage: the app opens with its default layout.
  }
  try {
    const ours = seed.workspaces.map(buildWorkspace);

    // Layout: append to a saved layout, or start one whose first workspace the route fills.
    const savedLayoutEnvelope = readJson(storage, LAYOUT_KEY);
    const savedState = persistedState(savedLayoutEnvelope);
    const savedLayout = isRecord(savedState.layout) ? savedState.layout : null;
    const savedWorkspaces = savedLayout && Array.isArray(savedLayout.workspaces) ? savedLayout.workspaces : null;
    const layout: LayoutState =
      savedLayout && savedWorkspaces && typeof savedLayout.focusedWorkspaceId === "string"
        ? {
            // Kept as saved; upstream's decoder validates every workspace on load.
            workspaces: [...(savedWorkspaces as LayoutWorkspace[]), ...ours],
            focusedWorkspaceId: savedLayout.focusedWorkspaceId,
          }
        : {
            workspaces: [
              { id: "workspace:mock-start", name: null, columns: [], focusedPaneId: null, cameraWidth: null },
              ...ours,
            ],
            focusedWorkspaceId: "workspace:mock-start",
          };
    storage.setItem(
      LAYOUT_KEY,
      JSON.stringify({
        state: { ...savedState, layout, companionShares: isRecord(savedState.companionShares) ? savedState.companionShares : {} },
        version: persistedVersion(savedLayoutEnvelope, LAYOUT_VERSION),
      }),
    );

    // Right panel: each seeded thread's surfaces, open because the layout shows them.
    const panelEnvelope = readJson(storage, RIGHT_PANEL_KEY);
    const panelState = persistedState(panelEnvelope);
    const byThreadKey: Record<string, ThreadRightPanelState> = isRecord(panelState.byThreadKey)
      ? (panelState.byThreadKey as Record<string, ThreadRightPanelState>)
      : {};
    for (const thread of seed.threads) {
      if (thread.surfaces.length === 0) continue;
      byThreadKey[keyOf(thread.threadId)] = {
        isOpen: true,
        activeSurfaceId: thread.activeSurfaceId,
        surfaces: [...thread.surfaces],
      };
    }
    storage.setItem(
      RIGHT_PANEL_KEY,
      JSON.stringify({
        state: { threadPanelVisibilityByThreadKey: {}, ...panelState, byThreadKey },
        version: persistedVersion(panelEnvelope, RIGHT_PANEL_VERSION),
      }),
    );

    // Terminals: the thread's terminal pane and the shells in it, one group each (tabs).
    const terminalEnvelope = readJson(storage, TERMINAL_KEY);
    const terminalState = persistedState(terminalEnvelope);
    const terminalUiStateByThreadKey: Record<string, TerminalUiState> = isRecord(terminalState.terminalUiStateByThreadKey)
      ? (terminalState.terminalUiStateByThreadKey as Record<string, TerminalUiState>)
      : {};
    for (const thread of seed.threads) {
      if (!thread.terminals) continue;
      const ids = [...thread.terminals.ids];
      terminalUiStateByThreadKey[keyOf(thread.threadId)] = {
        terminalOpen: true,
        terminalHeight: 280,
        terminalIds: ids,
        activeTerminalId: thread.terminals.active,
        terminalGroups: ids.map((id) => ({ id: `group-${id}`, terminalIds: [id] })),
        activeTerminalGroupId: `group-${thread.terminals.active}`,
      };
    }
    storage.setItem(
      TERMINAL_KEY,
      JSON.stringify({
        state: { ...terminalState, terminalUiStateByThreadKey },
        version: persistedVersion(terminalEnvelope, TERMINAL_VERSION),
      }),
    );

    // Markdown opens rendered (the app's own default is Source): the tour shows the README and the
    // mermaid flowchart as a reader sees them. A choice the visitor already made is left alone.
    if (storage.getItem(RENDER_MARKDOWN_KEY) === null) storage.setItem(RENDER_MARKDOWN_KEY, "true");

    storage.setItem(MARKER_KEY, new Date().toISOString());
  } catch (error) {
    console.warn("[redesign-mock] could not plant the panes layout", error);
  }
}

export { THREAD_TERMINAL };
