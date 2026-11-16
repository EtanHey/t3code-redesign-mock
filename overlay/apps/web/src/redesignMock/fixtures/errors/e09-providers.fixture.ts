// E09: providers that are not simply ready. The kernel's Codex and Claude stay untouched; these are
// added beside them, one per state, so Settings > Providers and the model picker show the whole
// range, and one thread per state selects its provider so the composer banner shows.
// Pi is planted disabled for Settings > Providers only: a thread cannot select a disabled provider
// and the app shows nothing about it in a chat, so there is no thread for that state.
import { ProviderDriverKind, ProviderInstanceId, type ModelSelection, type ServerProvider } from "@t3tools/contracts";

import { agoIso, assistant, provider, thread, turn } from "../../api";

type Model = { readonly slug: string; readonly name: string; readonly isDefault?: boolean };

function entry(
  instance: string,
  driver: string,
  displayName: string,
  models: ReadonlyArray<Model>,
  extra: Partial<ServerProvider>,
): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instance),
    driver: ProviderDriverKind.make(driver),
    displayName,
    enabled: true,
    installed: true,
    version: "1.4.2",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: agoIso("3m"),
    models: models.map((model) => ({
      slug: model.slug,
      name: model.name,
      isCustom: false,
      ...(model.isDefault ? { isDefault: true } : {}),
      capabilities: null,
    })),
    slashCommands: [],
    skills: [],
    showInteractionModeToggle: true,
    reportsContextWindow: false,
    supportedRuntimeModes: ["approval-required", "full-access"],
    ...extra,
  };
}

const CURSOR = entry("cursor", "cursor", "Cursor", [{ slug: "auto", name: "Auto", isDefault: true }], {
  installed: false,
  version: null,
  status: "error",
  auth: { status: "unknown" },
  setup: { canAuthenticate: false, canInstall: true, documentationUrl: "https://example.invalid/docs/cursor" },
});

const OPENCODE = entry(
  "opencode",
  "opencode",
  "OpenCode",
  [
    { slug: "relay/sonnet", name: "Sonnet via Relay", isDefault: true },
    { slug: "relay/haiku", name: "Haiku via Relay" },
  ],
  {
    version: "0.9.3",
    status: "error",
    auth: { status: "unauthenticated" },
    setup: { canAuthenticate: true, canInstall: false },
  },
);

const GROK = entry("grok", "grok", "Grok", [{ slug: "grok-code", name: "Grok Code", isDefault: true }], {
  version: "2.1.0",
  status: "error",
  message: "The Grok CLI failed its health check: could not reach the local agent socket (connection refused).",
});

const PI = entry("pi", "pi", "Pi", [{ slug: "pi-large", name: "Pi Large", isDefault: true }], {
  enabled: false,
  status: "disabled",
  version: "0.6.0",
  message: "Pi is turned off for this environment.",
});

const KIRO = entry("kiro", "kiro", "Kiro", [], {
  version: "1.0.5",
  status: "ready",
  auth: { status: "authenticated", label: "Kiro workspace" },
});

const MUSE = entry("muse", "muse", "Muse Code", [{ slug: "muse-1", name: "Muse 1", isDefault: true }], {
  version: "0.3.1",
  status: "ready",
  compatibilityAdvisory: {
    status: "unsupported",
    message: "Muse Code 0.3.1 is older than the minimum supported version (0.5.0). Some features may not work.",
    recommendedVersion: "0.5.2",
    recommendedRange: ">=0.5.0",
  },
  versionAdvisory: {
    status: "behind_latest",
    currentVersion: "0.3.1",
    latestVersion: "0.5.2",
    updateCommand: "npm install -g @muse-code/cli@latest",
    canUpdate: true,
    checkedAt: agoIso("10m"),
    message: "Version 0.5.2 is available.",
  },
  updateState: { status: "idle", startedAt: null, finishedAt: null, message: null, output: null },
});

const FX = entry("fx", "fx", "fx", [{ slug: "fx-pro", name: "fx Pro", isDefault: true }], {
  version: "3.0.0",
  status: "warning",
  message: "The model catalog could not be refreshed; showing the last known models.",
});

const ANTIGRAVITY = entry(
  "antigravity",
  "antigravity",
  "Antigravity",
  [{ slug: "gemini-pro", name: "Gemini Pro", isDefault: true }],
  {
    version: "1.7.0",
    versionAdvisory: {
      status: "behind_latest",
      currentVersion: "1.7.0",
      latestVersion: "1.8.2",
      updateCommand: "npm install -g @antigravity/cli@latest",
      canUpdate: true,
      checkedAt: agoIso("10m"),
      message: "Version 1.8.2 is available.",
    },
    updateState: { status: "idle", startedAt: null, finishedAt: null, message: null, output: null },
  },
);

interface StateSpec {
  readonly id: string;
  readonly scenario: string;
  readonly title: string;
  readonly provider: ServerProvider;
  readonly model: string;
  readonly prompt: string;
  readonly answer: string;
  readonly waitForText: string;
}

const STATES: ReadonlyArray<StateSpec> = [
  {
    id: "e09-not-installed",
    scenario: "E09",
    title: "Provider not installed: Cursor",
    provider: CURSOR,
    model: "auto",
    prompt: "Give me a one-paragraph summary of what the ledger package exports.",
    answer: "The ledger package exports `rollup`, `applyEntry`, and the `LedgerEntry` type. `rollup` sums entries into totals and a per-day count.",
    waitForText: "ledger package exports",
  },
  {
    id: "e09-signed-out",
    scenario: "E09b",
    title: "Provider signed out: OpenCode",
    provider: OPENCODE,
    model: "relay/sonnet",
    prompt: "List the public functions in the payouts module.",
    answer: "`schedulePayout`, `cancelPayout`, and `listUpcomingPayouts` are exported from `src/payouts/index.ts`.",
    waitForText: "payouts module",
  },
  {
    id: "e09-provider-error",
    scenario: "E09c",
    title: "Provider error: Grok is unavailable",
    provider: GROK,
    model: "grok-code",
    prompt: "Which tests cover the refund flow?",
    answer: "`src/refunds/refund.test.ts` covers partial and full refunds, and `src/refunds/ledger.test.ts` checks the matching ledger entries.",
    waitForText: "refund flow",
  },
  {
    id: "e09-no-models",
    scenario: "E09d",
    title: "Provider with no models: the picker shows \"default\"",
    provider: KIRO,
    model: "kiro-default",
    prompt: "What does the nightly reconciliation job do?",
    answer: "It compares settled payouts against the ledger and writes any mismatch to `reconciliation_issues` for review.\n\nKiro reported no models, so the model picker in the composer footer reads **default** instead of a model name. Settings > Providers lists the same provider with an empty model list.",
    waitForText: "reconciliation job",
  },
  {
    id: "e09-version-unsupported",
    scenario: "E09e",
    title: "Unsupported version: Muse Code needs an update",
    provider: MUSE,
    model: "muse-1",
    prompt: "Explain how invoice numbers are generated.",
    answer: "Invoice numbers come from a per-tenant sequence, formatted as `INV-<year>-<n>`, and are assigned when the invoice is finalized.",
    waitForText: "invoice numbers",
  },
  {
    id: "e09-degraded",
    scenario: "E09f",
    title: "Limited availability: fx has a stale model list",
    provider: FX,
    model: "fx-pro",
    prompt: "Where is the tax rate table loaded from?",
    answer: "`src/tax/rates.ts` loads it from `config/tax-rates.json` at startup and caches it for the process lifetime.",
    waitForText: "tax rate table",
  },
];

const EXTRA_PROVIDERS: ReadonlyArray<ServerProvider> = [CURSOR, OPENCODE, GROK, PI, KIRO, MUSE, FX, ANTIGRAVITY];

// The app treats a provider instance as off until the server settings name it (only Codex and
// Claude are on by default), and a lane cannot reach the kernel's settings. The public debug handle
// can, so once boot has finished the extra providers are switched on (Pi stays off) in memory.
if (typeof window !== "undefined") {
  window.setTimeout(() => {
    window.__MOCK__?.runtime.primary.updateSettings({
      providerInstances: Object.fromEntries(
        EXTRA_PROVIDERS.map((entry) => [entry.instanceId, { driver: entry.driver, enabled: entry.enabled }]),
      ),
    });
  }, 0);
}

const selection = (providerEntry: ServerProvider, model: string): ModelSelection => ({
  instanceId: providerEntry.instanceId,
  model,
});

export default [
  ...EXTRA_PROVIDERS.map((entry) => provider(entry)),
  ...STATES.map((state) =>
    thread({
      id: state.id,
      project: "errors",
      title: state.title,
      model: selection(state.provider, state.model),
      scenario: { id: state.scenario, label: state.title, waitForText: state.waitForText },
      turns: [turn({ at: "2h", took: "20s", user: state.prompt, items: [assistant(state.answer)] })],
    }),
  ),
];
