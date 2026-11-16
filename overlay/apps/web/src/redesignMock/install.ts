// Runs before upstream's src/bootstrap.ts (injected into index.html by vite/redesignMock.ts):
// boots the in-browser server, puts the network guard in place before router.load(), seeds the
// client settings a first visit needs and the saved connections for extra environments, and
// mounts the notice pill.
import type { ClientSettings } from "@t3tools/contracts";

import { ENVIRONMENT_ID } from "./kernel/constants";
import { seedConnectionCatalog } from "./kernel/catalog";
import { mountDebugPanel, exposeDebugHandle } from "./kernel/debug";
import { installNetworkGuard } from "./kernel/network";
import { mountNotice } from "./kernel/notice";
import { mockRuntime } from "./kernel/runtime";
import { START_HERE_THREAD_ID } from "./fixtures/kernel/start-here.fixture";

const CLIENT_SETTINGS_KEY = "t3code:client-settings:v1";

/**
 * A first visit starts with renderers that are off by default but safe, so planted content shows
 * as it would for someone who turned them on. Layout labs (Scrolling workspaces, the grouped
 * "boring" sidebar) stay as she ships them.
 */
const SHOWCASE_SETTINGS: Partial<ClientSettings> = {
  mathRenderingEnabled: true,
  // The demo is "send a message, queue a message": a plain send while the agent works queues it.
  // Steer stays one modifier away (her ⌘/Ctrl-click and shortcut), and Settings can flip it.
  followUpBehavior: "queue",
};

/** Set once per browser, so a visitor who later picks Steer in Settings keeps that choice. */
const FOLLOW_UP_SEEDED_KEY = "t3code-redesign-mock:follow-up-seeded";

function seedClientSettings(): void {
  try {
    const raw = window.localStorage.getItem(CLIENT_SETTINGS_KEY);
    const settings: Record<string, unknown> = raw ? JSON.parse(raw) : { ...SHOWCASE_SETTINGS };
    let changed = raw === null;
    if (typeof settings.onboardingCompletedAt !== "string") {
      settings.onboardingCompletedAt = new Date().toISOString();
      changed = true;
    }
    // Visitors from before queue became the default still get it, once.
    if (window.localStorage.getItem(FOLLOW_UP_SEEDED_KEY) === null) {
      settings.followUpBehavior = SHOWCASE_SETTINGS.followUpBehavior;
      window.localStorage.setItem(FOLLOW_UP_SEEDED_KEY, "1");
      changed = true;
    }
    if (changed) window.localStorage.setItem(CLIENT_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Without storage the app still boots; it just shows its first-run choices.
  }
}

const runtime = mockRuntime();
installNetworkGuard(runtime.primary);
seedClientSettings();

// The root URL opens the "Start here" thread.
if (window.location.pathname === "/" || window.location.pathname === "/index.html") {
  window.history.replaceState(null, "", `/${ENVIRONMENT_ID}/${START_HERE_THREAD_ID}${window.location.search}`);
}

exposeDebugHandle(runtime);
const mount = () => {
  mountNotice(runtime);
  if (new URLSearchParams(window.location.search).has("mockdebug")) mountDebugPanel(runtime);
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
else mount();

// Last, and awaited: the app reads its saved connections as it boots, and the build runs this
// module before her bootstrap in one chunk, so her code starts once the catalog is written.
await seedConnectionCatalog(runtime.registry.environments.map(({ definition }) => definition));
