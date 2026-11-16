// What every environment answers with no lane's help: the shell and thread streams, commands,
// config and settings, lifecycle, an empty but valid VCS status, terminals, assets, families.
// Lane handlers for the same method replace these without a conflict.
import {
  ORCHESTRATION_V2_WS_METHODS,
  ProviderDriverKind,
  ThreadId,
  WS_METHODS,
  type OrchestrationV2ThreadShell,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { agoIso, iso, now } from "./clock";
import { CLAUDE, CODEX } from "./constants";
import { usageLimits } from "./defaults";
import { rpc, stream, type AnyStreamHandler, type AnyUnaryHandler, type MockDefinition } from "./definitions";
import type { MockEnvironment } from "./environment";
import type { Sourced } from "./registry";

function readyProvider(
  instanceId: ServerProvider["instanceId"],
  driver: string,
  version: string,
  models: ReadonlyArray<{ readonly slug: string; readonly name: string; readonly isDefault?: boolean }>,
  extra: Partial<ServerProvider> = {},
): ServerProvider {
  return {
    instanceId,
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: agoIso("2m"),
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
    reportsContextWindow: true,
    supportedRuntimeModes: ["approval-required", "auto-accept-edits", "auto", "full-access"],
    ...extra,
  };
}

export const CODEX_PROVIDER = readyProvider(
  CODEX,
  "codex",
  "0.142.0",
  [
    { slug: "gpt-6-astra", name: "GPT-6 Astra", isDefault: true },
    { slug: "gpt-6.1-sol", name: "GPT-6.1 Sol" },
    { slug: "gpt-6.1-terra", name: "GPT-6.1 Terra" },
    { slug: "gpt-6-luna", name: "GPT-6 Luna" },
  ],
  { usageLimits: usageLimits(38, 61) },
);

export const CLAUDE_PROVIDER = readyProvider(
  CLAUDE,
  "claudeAgent",
  "3.4.1",
  [
    { slug: "claude-opus-5-5", name: "Claude Opus 5.5", isDefault: true },
    { slug: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
    { slug: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
    { slug: "claude-fable-5", name: "Claude Fable 5" },
  ],
  {
    slashCommands: [{ name: "compact", description: "Summarize the conversation so far" }],
    usageLimits: usageLimits(22, 47),
  },
);

export const BASELINE_PROVIDERS: ReadonlyArray<ServerProvider> = [CODEX_PROVIDER, CLAUDE_PROVIDER];

function familyOf(environment: MockEnvironment, threadId: ThreadId): OrchestrationV2ThreadShell[] {
  const server = environment.server;
  const requested = server.shell(threadId);
  if (!requested) return [];
  const root = requested.lineage.rootThreadId;
  return [...server.threads.values()]
    .map((record) => server.shellOf(record))
    .filter((shell) => shell.lineage.rootThreadId === root && shell.deletedAt === null);
}

/** The kernel's own answers, built per environment. Commands and launches come from `boot`. */
export function baselineDefinitions(
  environment: MockEnvironment,
  commands: {
    readonly dispatch: AnyUnaryHandler;
    readonly launch: AnyUnaryHandler;
    readonly updateSettings: AnyUnaryHandler;
  },
): MockDefinition[] {
  const server = environment.server;
  return [
    commands.dispatch,
    commands.launch,
    commands.updateSettings,
    stream(ORCHESTRATION_V2_WS_METHODS.subscribeShell, () => server.subscribeShell()),
    stream(ORCHESTRATION_V2_WS_METHODS.subscribeThread, (input) => server.subscribeThread(input.threadId)),
    rpc(ORCHESTRATION_V2_WS_METHODS.getThreadProjection, (input) => {
      const projection = server.projection(input.threadId);
      return projection ? Effect.succeed(projection) : Effect.die(new Error(`No thread ${input.threadId}`));
    }),
    rpc(ORCHESTRATION_V2_WS_METHODS.getThreadFamily, (input) => ({
      snapshotSequence: server.sequence,
      threads: familyOf(environment, input.threadId),
    })),
    rpc(ORCHESTRATION_V2_WS_METHODS.getThreadTitles, (input) => {
      const titles: Record<ThreadId, string> = {};
      for (const id of input.threadIds) {
        const shell = server.shell(id);
        if (shell && shell.deletedAt === null) titles[id] = shell.title;
      }
      return titles;
    }),
    rpc(ORCHESTRATION_V2_WS_METHODS.getArchivedShellSnapshot, () => ({
      schemaVersion: 1,
      snapshotSequence: server.sequence,
      projects: server.projectList(),
      threads: server.archivedShells(),
    })),
    rpc(ORCHESTRATION_V2_WS_METHODS.getOlderSettledThreads, () => ({
      snapshotSequence: server.sequence,
      threads: [...server.threads.values()]
        .filter((record) => record.olderSettled)
        .map((record) => server.shellOf(record))
        .filter((shell) => shell.settledAt !== null && shell.deletedAt === null && shell.archivedAt === null),
      counts: [],
    })),
    rpc(WS_METHODS.serverGetConfig, () => environment.serverConfig()),
    rpc(WS_METHODS.serverGetSettings, () => environment.settings),
    rpc(WS_METHODS.serverRefreshProviders, () => ({ providers: environment.providers })),
    stream(WS_METHODS.subscribeServerConfig, () => environment.configStream()),
    stream(WS_METHODS.subscribeServerLifecycle, () =>
      Stream.concat(
        Stream.fromIterable([
          {
            version: 1 as const,
            sequence: 1,
            type: "welcome" as const,
            payload: {
              environment: environment.descriptor,
              cwd: "/workspace",
              projectName: "workspace",
              bootstrapStatus: "complete" as const,
            },
          },
        ]),
        Stream.never,
      ),
    ),
    stream(WS_METHODS.subscribeVcsStatus, (input) =>
      Stream.concat(
        Stream.fromIterable([
          {
            _tag: "snapshot" as const,
            local: {
              isRepo: true,
              hasPrimaryRemote: true,
              isDefaultRef: true,
              refName: "main",
              hasWorkingTreeChanges: false,
              workingTree: { rootPath: input.cwd, files: [], insertions: 0, deletions: 0 },
            },
            remote: { hasUpstream: true, aheadCount: 0, behindCount: 0, pr: null },
          },
        ]),
        Stream.never,
      ),
    ),
    stream(WS_METHODS.subscribeTerminalMetadata, () =>
      Stream.concat(Stream.fromIterable([{ type: "snapshot" as const, terminals: [] }]), Stream.never),
    ),
    rpc(WS_METHODS.vcsListRefs, () => ({
      refs: [
        { name: "main", current: true, isDefault: true, worktreePath: null, lastCommitAt: Math.floor(Date.now() / 1000) - 3_600 },
        {
          name: "origin/main",
          isRemote: true,
          remoteName: "origin",
          current: false,
          isDefault: false,
          worktreePath: null,
          lastCommitAt: Math.floor(Date.now() / 1000) - 3_600,
        },
      ],
      isRepo: true,
      hasPrimaryRemote: true,
      nextCursor: null,
      totalCount: 2,
    })),
    rpc(WS_METHODS.reviewGetDiffPreview, (input) => ({ cwd: input.cwd, generatedAt: now(), sources: [] })),
    rpc(WS_METHODS.serverDiscoverSourceControl, () => ({ versionControlSystems: [], sourceControlProviders: [] })),
    rpc(
      WS_METHODS.assetsCreateUrl,
      (input) =>
        // Registered assets are answered before any handler (see environment.ts); anything else
        // gets the guard's placeholder image.
        ({
          relativeUrl: `/api/assets/mock/${encodeURIComponent(JSON.stringify(input).slice(0, 120))}`,
          expiresAt: Date.parse(iso(now())) + 3_600_000,
        }),
    ),
  ];
}

export function handlerMaps(definitions: ReadonlyArray<MockDefinition>, source: string) {
  const unary = new Map<string, Sourced<AnyUnaryHandler>>();
  const streams = new Map<string, Sourced<AnyStreamHandler>>();
  for (const definition of definitions) {
    if (definition.kind === "rpc") unary.set(definition.method, { source, definition });
    if (definition.kind === "stream") streams.set(definition.method, { source, definition });
  }
  return { unary, streams, reactions: new Map() };
}
