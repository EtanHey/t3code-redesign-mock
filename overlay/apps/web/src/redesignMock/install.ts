// Runs before upstream's src/bootstrap.ts (injected into index.html by vite/redesignMock.ts):
// boots the in-browser server, puts the network guard in place before router.load(), seeds the
// client settings a first visit needs, and mounts the notice pill.
import { ENVIRONMENT_ID } from "./kernel/constants";
import { mountDebugPanel, exposeDebugHandle } from "./kernel/debug";
import { installNetworkGuard } from "./kernel/network";
import { mountNotice } from "./kernel/notice";
import { mockRuntime } from "./kernel/runtime";
import { START_HERE_THREAD_ID } from "./fixtures/kernel/start-here.fixture";

const CLIENT_SETTINGS_KEY = "t3code:client-settings:v1";

function seedClientSettings(): void {
  try {
    const raw = window.localStorage.getItem(CLIENT_SETTINGS_KEY);
    const settings: Record<string, unknown> = raw ? JSON.parse(raw) : {};
    if (typeof settings.onboardingCompletedAt !== "string") {
      settings.onboardingCompletedAt = new Date().toISOString();
      window.localStorage.setItem(CLIENT_SETTINGS_KEY, JSON.stringify(settings));
    }
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
