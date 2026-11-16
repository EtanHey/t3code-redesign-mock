import { ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { agoIso, CODEX_PROVIDER, fromNowIso, provider } from "~/redesignMock/api";

const example = (
  id: string,
  displayName: string,
  extra: Partial<ServerProvider>,
): ServerProvider => ({
  ...CODEX_PROVIDER,
  instanceId: ProviderInstanceId.make(id),
  displayName,
  ...extra,
});
const updateAdvisory: ServerProvider["versionAdvisory"] = {
  status: "behind_latest",
  currentVersion: "0.142.0",
  latestVersion: "0.143.0",
  updateCommand: "npm install -g preview-agent@latest",
  canUpdate: true,
  checkedAt: agoIso("4m"),
  message: "A newer runtime is available.",
};
// No provider is planted mid-update: the app shows any running update as a blue "Updating <name>"
// pill at the bottom of the sidebar, on every thread. Failed and finished updates are old enough
// not to raise it, and stay visible in Settings > Providers.
export const shellProviders: ReadonlyArray<ServerProvider> = [
  example("shellReady", "Preview: ready", {
    usageLimits: {
      checkedAt: agoIso("2m"),
      windows: [
        {
          id: "session",
          kind: "session",
          label: "Session",
          usedPercent: 38,
          resetsAt: fromNowIso("2h"),
          windowDurationMins: 300,
        },
        {
          id: "weekly",
          kind: "weekly",
          label: "Weekly",
          usedPercent: 72,
          resetsAt: fromNowIso("3d"),
          windowDurationMins: 10080,
        },
        {
          id: "monthly",
          kind: "monthly",
          label: "Monthly",
          usedPercent: 24,
          resetsAt: fromNowIso("14d"),
        },
        { id: "review", kind: "other", label: "Review allowance", usedPercent: 12 },
      ],
      resetCredits: {
        availableCount: 2,
        nextCreditId: "preview-weekly",
        nextExpiresAt: fromNowIso("7d"),
        options: [
          {
            creditId: "preview-weekly",
            label: "Weekly reset",
            description: "Refill the weekly allowance",
            availableCount: 2,
            expiresAt: fromNowIso("7d"),
          },
        ],
      },
    },
  }),
  example("shellWarning", "Preview: warning", {
    status: "warning",
    message: "The installed runtime is behind the recommended version.",
    versionAdvisory: {
      status: "behind_latest",
      currentVersion: "0.142.0",
      latestVersion: "0.143.0",
      updateCommand: "npm install -g preview-agent@latest",
      canUpdate: true,
      checkedAt: agoIso("4m"),
      message: "A newer runtime is available.",
    },
  }),
  example("shellError", "Preview: error", {
    status: "error",
    message: "The provider could not read its local profile.",
    usageLimits: {
      checkedAt: agoIso("3m"),
      windows: [],
      unavailable: {
        reason: "probeFailed",
        message: "The usage probe timed out. Refresh to try again.",
      },
    },
  }),
  example("shellDisabled", "Preview: disabled", {
    enabled: false,
    status: "disabled",
    message: "Disabled for this workspace.",
  }),
  example("shellMissing", "Preview: not installed", {
    installed: false,
    version: null,
    status: "error",
    auth: { status: "unknown" },
    models: [],
    message: "The provider executable is not installed.",
    setup: { canInstall: true, canAuthenticate: false },
  }),
  example("shellSignedOut", "Preview: signed out", {
    status: "warning",
    auth: { status: "unauthenticated" },
    message: "Sign in to use this provider.",
    setup: { canInstall: false, canAuthenticate: true },
  }),
  example("shellUpdateFailed", "Preview: update failed", {
    versionAdvisory: updateAdvisory,
    updateState: {
      status: "failed",
      startedAt: agoIso("8m"),
      finishedAt: agoIso("7m"),
      message: "The package registry did not respond.",
      output: "Request timed out. The existing runtime is still available.",
    },
  }),
  example("shellUpdated", "Preview: update succeeded", {
    message: "Runtime updated successfully.",
    version: "0.143.0",
    updateState: {
      status: "succeeded",
      startedAt: agoIso("12m"),
      finishedAt: agoIso("11m"),
      message: "Runtime updated successfully.",
      output: "Installed preview runtime 0.143.0",
    },
  }),
  example("shellNoModels", "Preview: no models", {
    models: [],
    message: "No models are enabled in this profile.",
  }),
  example("shellZeroCap", "Preview: zero spend cap", {
    usageLimits: {
      checkedAt: agoIso("2m"),
      windows: [{ id: "free-session", kind: "session", label: "Session", usedPercent: 0 }],
      zeroSpendCap: true,
    },
  }),
];
export default shellProviders.map((value) => provider(value));
