// `window.__MOCK__` and the `?mockdebug` panel: what fell through to the fallback (so a lane can
// see which RPC a blank panel waits on), what the network guard refused, and the scenarios.
import { unhandledCalls } from "./environment";
import { blockedRequests } from "./network";
import { resetDemo } from "./notice";
import { BUILD_INFO, type MockRuntime } from "./runtime";

export interface MockDebugHandle {
  readonly build: typeof BUILD_INFO;
  readonly runtime: MockRuntime;
  /** Calls that no fixture, lane handler or kernel baseline answered, by method. */
  unhandled(): ReadonlyArray<{ method: string; shape: string; outcome: string; count: number; lastInput: unknown }>;
  blocked(): ReadonlyArray<{ kind: string; url: string; at: string }>;
  /** Every planted scenario with its URL path; the smoke run reads this. */
  scenarios(): ReadonlyArray<{ id: string; label: string; path: string; waitForText: string | null; source: string }>;
  reset(): Promise<void>;
}

declare global {
  interface Window {
    __MOCK__?: MockDebugHandle;
  }
}

export function exposeDebugHandle(runtime: MockRuntime): void {
  window.__MOCK__ = {
    build: BUILD_INFO,
    runtime,
    unhandled: () => [...unhandledCalls.values()].toSorted((left, right) => right.count - left.count),
    blocked: () => [...blockedRequests],
    scenarios: () =>
      runtime.registry.threads.flatMap(({ source, definition }) =>
        definition.scenario
          ? [
              {
                id: definition.scenario.id,
                label: definition.scenario.label,
                path: `/${definition.environmentId ?? runtime.primary.environmentId}/${definition.projection.thread.id}`,
                waitForText: definition.scenario.waitForText ?? null,
                source,
              },
            ]
          : [],
      ),
    reset: () => resetDemo(runtime),
  };
}

const PANEL_STYLE = `
.rdm-debug{position:fixed;z-index:2147483001;top:10px;right:10px;width:min(440px,calc(100vw - 20px));max-height:70vh;overflow:auto;padding:10px 12px;border-radius:10px;background:rgba(9,9,11,.92);color:#e4e4e7;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 0 0 1px rgba(255,255,255,.12),0 10px 30px rgba(0,0,0,.4)}
.rdm-debug h4{margin:8px 0 4px;font:600 11px ui-sans-serif,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:#a1a1aa}
.rdm-debug table{width:100%;border-collapse:collapse}
.rdm-debug td{padding:2px 4px;border-top:1px solid rgba(255,255,255,.06);vertical-align:top}
.rdm-debug a{color:#93c5fd}
.rdm-debug button{font:inherit;background:rgba(255,255,255,.1);color:inherit;border:0;border-radius:6px;padding:2px 8px;cursor:pointer}
`;

export function mountDebugPanel(runtime: MockRuntime): void {
  const style = document.createElement("style");
  style.textContent = PANEL_STYLE;
  document.head.append(style);
  const panel = document.createElement("div");
  panel.className = "rdm-debug";
  document.body.append(panel);

  const row = (cells: ReadonlyArray<string>) => {
    const tr = document.createElement("tr");
    for (const cell of cells) {
      const td = document.createElement("td");
      td.textContent = cell;
      tr.append(td);
    }
    return tr;
  };

  const render = () => {
    panel.replaceChildren();
    const title = document.createElement("div");
    title.textContent = `mock ${BUILD_INFO.shortCommit} · fixtures ${BUILD_INFO.fixtureVersion} · seq ${runtime.primary.server.sequence} · log ${runtime.log.size()} (replayed ${runtime.replayed})`;
    const close = document.createElement("button");
    close.textContent = "close";
    close.style.float = "right";
    close.addEventListener("click", () => {
      window.clearInterval(timer);
      panel.remove();
    });
    title.prepend(close);
    panel.append(title);

    const unhandled = window.__MOCK__?.unhandled() ?? [];
    const unhandledTitle = document.createElement("h4");
    unhandledTitle.textContent = `Unhandled RPCs (${unhandled.length})`;
    const unhandledTable = document.createElement("table");
    for (const call of unhandled) unhandledTable.append(row([call.method, call.outcome, `×${call.count}`]));
    panel.append(unhandledTitle, unhandledTable);

    const blocked = blockedRequests;
    const blockedTitle = document.createElement("h4");
    blockedTitle.textContent = `Blocked requests (${blocked.length})`;
    const blockedTable = document.createElement("table");
    for (const request of blocked.slice(-20)) blockedTable.append(row([request.kind, request.url]));
    panel.append(blockedTitle, blockedTable);

    const scenarios = window.__MOCK__?.scenarios() ?? [];
    const scenariosTitle = document.createElement("h4");
    scenariosTitle.textContent = `Scenarios (${scenarios.length})`;
    const list = document.createElement("table");
    for (const scenario of scenarios) {
      const tr = document.createElement("tr");
      const id = document.createElement("td");
      id.textContent = scenario.id;
      const link = document.createElement("td");
      const anchor = document.createElement("a");
      anchor.href = `${scenario.path}?mockdebug`;
      anchor.textContent = scenario.label;
      link.append(anchor);
      tr.append(id, link);
      list.append(tr);
    }
    panel.append(scenariosTitle, list);
  };

  render();
  const timer = window.setInterval(render, 2_000);
}
