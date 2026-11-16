// Boots the mock once per page: collects every lane's definitions, plants projects and threads,
// wires the RPC handlers, then replays the visitor's saved log over the planted state.
import {
  ORCHESTRATION_V2_WS_METHODS,
  OrchestrationV2Command,
  OrchestrationV2ThreadLaunchInput,
  OrchestrationV2ThreadProjection,
  ProjectId,
  WS_METHODS,
  type EnvironmentId,
  type OrchestrationV2Run,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { BASELINE_PROVIDERS, baselineDefinitions, handlerMaps } from "./baseline";
import { agoIso, atTime, nowMs } from "./clock";
import { ENVIRONMENT_ID, ENVIRONMENT_LABEL, PLANTED_PROJECTS, projectIdOf, workspaceRootOf } from "./constants";
import { rpc, type AnyCommandReaction, type AnyStreamHandler, type AnyUnaryHandler } from "./definitions";
import { MockAssets } from "./assets";
import { withDefaultContextUsage } from "./defaults";
import { fillScenarioIndex, scenarioIndexMarkdown } from "./scenarioIndex";
import { MockEnvironment } from "./environment";
import { VisitorLog, type LogEntry } from "./persistence";
import { launchThread, reduceCommand } from "./reducer";
import { buildRegistry, type Registry, type Sourced } from "./registry";
import { runScript } from "./script";

export interface RedesignMockBuildInfo {
  readonly branch: string;
  readonly commit: string;
  readonly shortCommit: string;
  readonly committedAt: string;
  readonly builtAt: string;
  readonly fixtureVersion: string;
}

declare const __REDESIGN_MOCK_BUILD__: RedesignMockBuildInfo;

export const BUILD_INFO: RedesignMockBuildInfo =
  typeof __REDESIGN_MOCK_BUILD__ === "undefined"
    ? {
        branch: "unknown",
        commit: "unknown",
        shortCommit: "unknown",
        committedAt: "",
        builtAt: new Date().toISOString(),
        fixtureVersion: "dev",
      }
    : __REDESIGN_MOCK_BUILD__;

export interface MockRuntime {
  readonly registry: Registry;
  readonly primary: MockEnvironment;
  readonly environments: ReadonlyMap<EnvironmentId, MockEnvironment>;
  readonly log: VisitorLog;
  readonly replayed: number;
  readonly replayFailures: ReadonlyArray<string>;
}

let current: MockRuntime | null = null;

export function mockRuntime(): MockRuntime {
  if (current === null) current = boot();
  return current;
}

const LIVE = new Set<OrchestrationV2Run["status"]>(["preparing", "starting", "running", "waiting"]);

function lanesFor(registry: Registry) {
  return {
    unary: new Map<string, Sourced<AnyUnaryHandler>>(registry.unary),
    streams: new Map<string, Sourced<AnyStreamHandler>>(registry.streams),
    reactions: new Map<string, Sourced<AnyCommandReaction>>(registry.reactions),
  };
}

function providersFor(registry: Registry, environmentId: EnvironmentId): ServerProvider[] {
  const byInstance = new Map<string, ServerProvider>(BASELINE_PROVIDERS.map((provider) => [provider.instanceId, provider]));
  for (const { definition } of registry.providers) {
    if ((definition.environmentId ?? ENVIRONMENT_ID) === environmentId) {
      byInstance.set(definition.provider.instanceId, definition.provider);
    }
  }
  return [...byInstance.values()];
}

// The RPC layer types payloads by their wire form; a round trip through the contract schema
// checks the app's value and gives back the contract's own type.
const toCommand = (input: unknown): OrchestrationV2Command =>
  Schema.decodeSync(OrchestrationV2Command)(Schema.encodeUnknownSync(OrchestrationV2Command)(input));
const toLaunchInput = (input: unknown): OrchestrationV2ThreadLaunchInput =>
  Schema.decodeSync(OrchestrationV2ThreadLaunchInput)(Schema.encodeUnknownSync(OrchestrationV2ThreadLaunchInput)(input));

function applyCommand(environment: MockEnvironment, command: OrchestrationV2Command): void {
  reduceCommand(environment.server, command);
  const reaction = environment.reactionFor(command.type);
  // The registry keyed this reaction by the command's own type.
  reaction?.react(command as never, { server: environment.server });
}

function replay(environments: ReadonlyMap<EnvironmentId, MockEnvironment>, entries: ReadonlyArray<LogEntry>) {
  const failures: string[] = [];
  let replayed = 0;
  for (const entry of entries) {
    const environment = environments.get(entry.environmentId);
    if (!environment) continue;
    try {
      atTime(entry.at, () => {
        if (entry.kind === "command") applyCommand(environment, entry.command);
        else if (entry.kind === "launch") launchThread(environment.server, entry.input);
        else environment.updateSettings(entry.patch);
      });
      replayed += 1;
    } catch (error) {
      failures.push(`${entry.kind}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { replayed, failures };
}

function boot(): MockRuntime {
  const registry = buildRegistry();
  const log = new VisitorLog(BUILD_INFO.fixtureVersion);

  const environments = new Map<EnvironmentId, MockEnvironment>();
  const primary = new MockEnvironment(ENVIRONMENT_ID, ENVIRONMENT_LABEL, providersFor(registry, ENVIRONMENT_ID));
  environments.set(ENVIRONMENT_ID, primary);
  for (const { definition } of registry.environments) {
    if (environments.has(definition.environmentId)) continue;
    environments.set(
      definition.environmentId,
      new MockEnvironment(definition.environmentId, definition.label, providersFor(registry, definition.environmentId)),
    );
  }

  // Projects: the planted table of contents, then any lane-defined ones.
  for (const [key, entry] of Object.entries(PLANTED_PROJECTS)) {
    const plantedKey = key as keyof typeof PLANTED_PROJECTS;
    primary.server.upsertProject(
      {
        id: projectIdOf(plantedKey),
        title: entry.title,
        workspaceRoot: workspaceRootOf(plantedKey),
        repositoryIdentity: null,
        defaultModelSelection: null,
        scripts: [],
        createdAt: agoIso("30d"),
        updatedAt: agoIso("1d"),
      },
      entry.order,
    );
  }
  for (const { definition } of registry.environments) {
    for (const [index, project] of (definition.projects ?? []).entries()) {
      environments.get(definition.environmentId)?.server.upsertProject(
        {
          id: ProjectId.make(project.id),
          title: project.title,
          workspaceRoot: `/workspace/${project.title}`,
          repositoryIdentity: null,
          defaultModelSelection: null,
          scripts: [],
          createdAt: agoIso("20d"),
          updatedAt: agoIso("1d"),
        },
        index,
      );
    }
  }
  for (const { definition } of registry.projects) {
    environments.get(definition.environmentId ?? ENVIRONMENT_ID)?.server.upsertProject(definition.project, definition.order);
  }

  // Threads, checked against the contract so a changed schema fails loudly at boot.
  const validate = Schema.decodeUnknownOption(OrchestrationV2ThreadProjection);
  const encode = Schema.encodeUnknownOption(OrchestrationV2ThreadProjection);
  for (const { source, definition } of registry.threads) {
    const environment = environments.get(definition.environmentId ?? ENVIRONMENT_ID);
    if (!environment) throw new Error(`redesign-mock: ${source} names an unknown environment`);
    const encoded = encode(definition.projection);
    if (encoded._tag === "None" || validate(encoded.value)._tag === "None") {
      const message = `redesign-mock: ${source} thread "${definition.projection.thread.id}" does not match the contract`;
      if (import.meta.env.DEV) throw new Error(message);
      console.error(message);
    }
    const planted = fillScenarioIndex(withDefaultContextUsage(definition.projection), () => scenarioIndexMarkdown(registry));
    environment.server.addThread(planted, {
      definition,
      ...(definition.shell ? { shellPatch: definition.shell } : {}),
      ...(definition.olderSettled ? { olderSettled: true } : {}),
    });
  }

  for (const environment of environments.values()) {
    const server = environment.server;
    environment.assets = new MockAssets(
      registry.assets
        .map(({ definition }) => definition)
        .filter((definition) => (definition.environmentId ?? ENVIRONMENT_ID) === environment.environmentId),
    );
    const dispatch = rpc(ORCHESTRATION_V2_WS_METHODS.dispatchCommand, (payload) => {
      const command = toCommand(payload);
      log.append({ kind: "command", at: nowMs(), environmentId: environment.environmentId, command });
      applyCommand(environment, command);
      return { sequence: server.sequence };
    });
    const launch = rpc(ORCHESTRATION_V2_WS_METHODS.launchThread, (payload) => {
      const input = toLaunchInput(payload);
      log.append({ kind: "launch", at: nowMs(), environmentId: environment.environmentId, input });
      return launchThread(server, input);
    });
    const updateSettings = rpc(WS_METHODS.serverUpdateSettings, (input) => {
      log.append({ kind: "settings", at: nowMs(), environmentId: environment.environmentId, patch: input.patch });
      return environment.updateSettings(input.patch);
    });
    environment.install(
      handlerMaps(baselineDefinitions(environment, { dispatch, launch, updateSettings }), "redesignMock/kernel/baseline.ts"),
      lanesFor(registry),
    );
    // A thread's onOpen script runs against its live run the first time it is opened.
    server.onFirstOpen((threadId) => {
      const record = server.thread(threadId);
      const onOpen = record?.definition?.onOpen;
      if (!record || !onOpen) return;
      const run = record.projection.runs.filter((candidate) => LIVE.has(candidate.status)).at(-1);
      if (run) runScript(server, threadId, run.id, onOpen);
    });
  }

  const { replayed, failures } = replay(environments, log.load());
  if (failures.length > 0) console.warn("[redesign-mock] some saved actions did not replay", failures);
  return { registry, primary, environments, log, replayed, replayFailures: failures };
}
