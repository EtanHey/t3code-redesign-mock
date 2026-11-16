import {
  UsageDay,
  WS_METHODS,
  ServerSettingsPatch,
  ProviderInstanceMutation,
  ResolvedKeybindingRule,
  type ProviderConsumeResetCreditResult,
  type UsageSummary,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import { compileResolvedKeybindingRule } from "@t3tools/shared/keybindings";
import * as Stream from "effect/Stream";
import { agoIso, projectIdOf, rpc, stream } from "~/redesignMock/api";
import {
  config,
  configEvent,
  environment,
  persistBindings,
  persistProviders,
  persistSettings,
} from "./settings-runtime";

const sameBinding = Schema.toEquivalence(ResolvedKeybindingRule);

export default [
  rpc(WS_METHODS.serverUpdateSettings, (input, context) => {
    const env = environment(context);
    let next = applyServerSettingsPatch(
      env.settings,
      Schema.decodeSync(ServerSettingsPatch)(
        Schema.encodeUnknownSync(ServerSettingsPatch)(input.patch),
      ),
    );
    if (input.providerInstanceMutation) {
      const mutation = Schema.decodeSync(ProviderInstanceMutation)(
        Schema.encodeUnknownSync(ProviderInstanceMutation)(input.providerInstanceMutation),
      );
      const instances = { ...next.providerInstances };
      if (mutation.operation === "remove") delete instances[mutation.instanceId];
      else instances[mutation.instanceId] = mutation.instance;
      next = { ...next, providerInstances: instances };
    }
    return persistSettings(context, next);
  }),
  rpc(WS_METHODS.agentSessionsScan, () => ({
    scannedAt: agoIso("0s"),
    candidates: [
      {
        path: "/workspace/pebble-mobile",
        title: "pebble-mobile",
        projectId: projectIdOf("sidebar"),
        sources: ["codex" as const],
        threadCount: 8,
        lastActiveAt: agoIso("6m"),
        alreadyImported: true,
      },
    ],
  })),
  rpc(WS_METHODS.serverGetConfig, (_input, context) => config(context)),
  stream(WS_METHODS.subscribeServerConfig, (_input, context) =>
    Stream.map(environment(context).configStream(), () => configEvent(context)),
  ),
  rpc(WS_METHODS.serverRefreshProviders, (_input, context) => ({
    providers: environment(context).providers,
  })),
  rpc(WS_METHODS.serverUpdateProvider, (input, context) => {
    const env = environment(context);
    env.providers = env.providers.map((provider) =>
      provider.instanceId === input.instanceId
        ? {
            ...provider,
            updateState: {
              status: "succeeded",
              startedAt: agoIso("2s"),
              finishedAt: agoIso("0s"),
              message: "Preview runtime updated.",
              output: "The local preview update is complete.",
            },
          }
        : provider,
    );
    persistProviders(context);
    return { providers: env.providers };
  }),
  rpc(WS_METHODS.providerConsumeResetCredit, (input, context): ProviderConsumeResetCreditResult => {
    if (!("instanceId" in input)) return { outcome: "noCredit" };
    const env = environment(context);
    const target = env.providers.find((p) => p.instanceId === input.instanceId);
    const limits = target?.usageLimits;
    if (!limits?.resetCredits?.availableCount) return { outcome: "noCredit" };
    env.providers = env.providers.map((p) =>
      p.instanceId !== input.instanceId
        ? p
        : {
            ...p,
            usageLimits: {
              ...limits,
              windows: limits.windows.map((w) =>
                w.kind === "weekly" ? { ...w, usedPercent: 0 } : w,
              ),
              resetCredits: {
                ...limits.resetCredits!,
                availableCount: limits.resetCredits!.availableCount - 1,
                options: limits.resetCredits!.options?.map((option) => ({
                  ...option,
                  availableCount: Math.max(0, option.availableCount - 1),
                })),
              },
            },
          },
    );
    persistProviders(context);
    return { outcome: "reset" };
  }),
  rpc(WS_METHODS.serverUpsertKeybinding, (input, context) => {
    const rule = compileResolvedKeybindingRule(input);
    if (!rule) throw new Error("Invalid preview shortcut");
    const target = compileResolvedKeybindingRule(input.replace ?? input);
    if (!target) throw new Error("Invalid preview shortcut replacement");
    const current = config(context).keybindings;
    const next = [...current.filter((rule) => !sameBinding(rule, target)), rule];
    persistBindings(context, next);
    return { keybindings: next, issues: [] };
  }),
  rpc(WS_METHODS.serverRemoveKeybinding, (input, context) => {
    const target = compileResolvedKeybindingRule(input);
    if (!target) throw new Error("Invalid preview shortcut removal");
    const next = config(context).keybindings.filter((rule) => !sameBinding(rule, target));
    persistBindings(context, next);
    return { keybindings: next, issues: [] };
  }),
  rpc(WS_METHODS.serverGetUsageSummary, (input): UsageSummary => ({
    contractVersion: 6,
    readAt: agoIso("0s"),
    timeZone: input.timeZone,
    sinceDay: UsageDay.make(input.sinceDay),
    untilDay: UsageDay.make(input.untilDay),
    scanDurationMs: 18,
    pricing: {
      status: "cached",
      source: "Preview model pricing",
      fetchedAt: agoIso("2h"),
      knownModels: 12,
    },
    sources: [
      {
        fingerprint: {
          hostId: "preview-workstation",
          provider: "codex",
          resolvedHomePath: "/workspace/.preview",
          volumeId: "preview-volume",
        },
        status: "ok",
        scannedFiles: 12,
        skippedFiles: 0,
        malformedRecords: 0,
        distinctSessions: 8,
        message: null,
      },
    ],
    buckets: [0, 1, 2, 3, 4, 5, 6].map((index) => ({
      day: UsageDay.make(
        new Date(Date.parse(`${input.untilDay}T12:00:00Z`) - index * 86400000)
          .toISOString()
          .slice(0, 10),
      ),
      provider: "codex" as const,
      model: "gpt-6.1-sol",
      totals: {
        uncachedInputTokens: 18000 + index * 2100,
        cachedInputTokens: 92000 - index * 4000,
        cacheCreationTokens: 0,
        outputTokens: 6200 + index * 450,
        reasoningTokens: 2100,
      },
      costUsd: 0.42 + index * 0.08,
      cacheSavingsUsd: 0.31,
      costSource: "modelPriced" as const,
      records: 14,
      unpricedRecords: 0,
      sessions: 2,
    })),
  })),
];
