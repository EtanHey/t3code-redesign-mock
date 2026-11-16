import {
  ResolvedKeybindingsConfig,
  ServerProvider,
  ServerSettings,
  UsageLimitSourceId,
  type ServerConfig,
  type ServerConfigStreamEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import { agoIso, ENVIRONMENT_ID, type HandlerContext } from "~/redesignMock/api";
import { BUILD_INFO, mockRuntime } from "../../kernel/runtime";
import { shellProviders } from "../../fixtures/shell-settings/providers.fixture";
import { installVoicePreview } from "./voice-preview";

const key = (part: string) => `redesign-mock:shell-${part}:${BUILD_INFO.fixtureVersion}`;
const initialized = new Set<string>();
let bindings: ResolvedKeybindingsConfig | undefined;
export function environment(context: HandlerContext) {
  const env = mockRuntime().environments.get(context.server.environmentId);
  if (!env) throw new Error("Unknown preview environment");
  if (env.environmentId !== ENVIRONMENT_ID) return env;
  if (!initialized.has(env.environmentId)) {
    initialized.add(env.environmentId);
    // Seed before the first client connection. The mock session reads its descriptor directly.
    Object.assign(env.descriptor.capabilities, {
      storageCleanup: true,
      storageCleanupRun: true,
      databaseStorage: true,
      oneTimeSchedules: true,
      scheduledTaskThreadModes: true,
      voiceTranscription: true,
      cloudVoiceTranscription: true,
      shellOlderSettled: true,
    });
    const instances = Object.fromEntries(
      shellProviders.map((p) => [
        p.instanceId,
        { driver: p.driver, displayName: p.displayName, enabled: p.enabled },
      ]),
    );
    let restoredSettings = false;
    try {
      const saved = localStorage.getItem(key("settings"));
      if (saved) {
        env.settings = Schema.decodeUnknownSync(ServerSettings)(JSON.parse(saved));
        restoredSettings = true;
      }
    } catch {
      /* Retain the current settings when storage is unavailable. */
    }
    if (!restoredSettings)
      env.updateSettings({
        providerInstances: { ...instances, ...env.settings.providerInstances },
      });
    try {
      const saved = localStorage.getItem(key("providers"));
      if (saved) {
        const restored = Schema.decodeUnknownSync(Schema.Array(ServerProvider))(JSON.parse(saved));
        env.providers = env.providers.map(
          (p) => restored.find((saved) => saved.instanceId === p.instanceId) ?? p,
        );
      }
      const shortcuts = localStorage.getItem(key("keybindings"));
      if (shortcuts)
        bindings = Schema.decodeUnknownSync(ResolvedKeybindingsConfig)(JSON.parse(shortcuts));
    } catch {
      /* Invalid or unavailable storage keeps the planted examples. */
    }
    installVoicePreview();
    // The in-browser connection lease uses these public factories directly rather than the
    // RPC handlers. Bridge its config factories to this lane's enriched snapshots as well.
    Object.assign(env.session, {
      initialConfig: Effect.sync(() => config(context)),
      subscribeServerConfig: () => Stream.map(env.configStream(), () => configEvent(context)),
    } satisfies Pick<typeof env.session, "initialConfig" | "subscribeServerConfig">);
  }
  return env;
}
export function config(context: HandlerContext): ServerConfig {
  const env = environment(context);
  if (env.environmentId !== ENVIRONMENT_ID) return env.serverConfig();
  return {
    ...env.serverConfig(),
    environment: {
      ...env.descriptor,
      capabilities: {
        ...env.descriptor.capabilities,
        storageCleanup: true,
        storageCleanupRun: true,
        databaseStorage: true,
        oneTimeSchedules: true,
        scheduledTaskThreadModes: true,
        voiceTranscription: true,
        cloudVoiceTranscription: true,
        shellOlderSettled: true,
      },
    },
    ...(bindings ? { keybindings: bindings } : {}),
    usageLimitSources: [
      {
        id: UsageLimitSourceId.make("preview-hub"),
        kind: "cliproxy",
        label: "Preview usage hub",
        checkedAt: agoIso("3m"),
        accounts: [],
        error: "The usage hub is temporarily unreachable. Last checked three minutes ago.",
      },
    ],
  };
}
export function configEvent(context: HandlerContext): ServerConfigStreamEvent {
  return { version: 1, type: "snapshot", config: config(context) };
}
export function persistProviders(context: HandlerContext) {
  const env = environment(context);
  try {
    localStorage.setItem(
      key("providers"),
      JSON.stringify(Schema.encodeSync(Schema.Array(ServerProvider))(env.providers)),
    );
  } catch {
    /* The current page keeps the update. */
  }
  env.updateSettings({});
}
export function persistBindings(context: HandlerContext, next: ResolvedKeybindingsConfig) {
  bindings = next;
  try {
    localStorage.setItem(
      key("keybindings"),
      JSON.stringify(Schema.encodeSync(ResolvedKeybindingsConfig)(next)),
    );
  } catch {
    /* The current page keeps the update. */
  }
  environment(context).updateSettings({});
}

// Registry imports are eager. Defer until boot/install has completed, before the client connects.
queueMicrotask(() => environment({ server: mockRuntime().primary.server }));

export function persistSettings(context: HandlerContext, settings: ServerSettings) {
  const env = environment(context);
  env.settings = settings;
  try {
    localStorage.setItem(
      key("settings"),
      JSON.stringify(Schema.encodeSync(ServerSettings)(settings)),
    );
  } catch {
    /* Current-page editing still works. */
  }
  env.updateSettings({});
  return env.settings;
}
