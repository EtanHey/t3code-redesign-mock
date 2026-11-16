// One mock environment: the server state, its config and settings, and the RPC client the app's
// session talks to. Calls resolve in this order: a thread fixture's own answer, a lane handler,
// the kernel baseline, then a fallback by shape that never hangs and is recorded for ?mockdebug.
import {
  AssetResource,
  AuthStandardClientScopes,
  ExecutionEnvironmentDescriptor,
  ORCHESTRATION_PROTOCOL_VERSION,
  ServerConfig,
  ServerSettings,
  ThreadId,
  WS_METHODS,
  WsRpcGroup,
  type EnvironmentId,
  type ServerConfigStreamEvent,
  type ServerProvider,
} from "@t3tools/contracts";
import type { EnvironmentConnectionLease } from "@t3tools/client-runtime/connection";
import type { WsRpcProtocolClient } from "@t3tools/client-runtime/rpc";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { RpcClientError, RpcSchema } from "effect/rpc";
import { APP_VERSION } from "~/branding";

import { iso, now } from "./clock";
import type { AnyCommandReaction, AnyStreamHandler, AnyUnaryHandler, HandlerContext } from "./definitions";
import { MockAssets } from "./assets";
import type { Sourced } from "./registry";
import { liveStream, MockServer } from "./server";

export const MOCK_AUTH = {
  policy: "loopback-browser",
  bootstrapMethods: ["one-time-token"],
  sessionMethods: ["browser-session-cookie"],
  sessionCookieName: "t3_session",
} as const;

export const MOCK_SESSION_STATE = {
  authenticated: true,
  auth: MOCK_AUTH,
  scopes: AuthStandardClientScopes,
  sessionMethod: "browser-session-cookie",
  expiresAt: "2099-01-01T00:00:00.000Z",
} as const;

export interface UnhandledCall {
  readonly method: string;
  readonly shape: "stream" | "unary" | "unknown";
  readonly outcome: "pending-stream" | "empty-result" | "not-available-error";
  count: number;
  lastInput: unknown;
  readonly firstAt: string;
}

/** Shared by every environment: what fell through to the fallback, by method. */
export const unhandledCalls = new Map<string, UnhandledCall>();

const NOT_AVAILABLE = "is not available in the mock preview";
const EMPTY_CANDIDATES: ReadonlyArray<unknown> = [undefined, null, [], {}];

function threadIdOf(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null || !("threadId" in input)) return undefined;
  const value = input.threadId;
  return typeof value === "string" ? value : undefined;
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (
    typeof base !== "object" ||
    base === null ||
    Array.isArray(base) ||
    typeof patch !== "object" ||
    patch === null ||
    Array.isArray(patch)
  ) {
    return patch === undefined ? base : patch;
  }
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    result[key] = deepMerge(result[key], value);
  }
  return result;
}

export interface EnvironmentHandlers {
  readonly unary: ReadonlyMap<string, Sourced<AnyUnaryHandler>>;
  readonly streams: ReadonlyMap<string, Sourced<AnyStreamHandler>>;
  readonly reactions: ReadonlyMap<string, Sourced<AnyCommandReaction>>;
}

export class MockEnvironment {
  readonly server: MockServer;
  /** Content fixtures registered with `asset(...)` for this environment; set at boot. */
  assets = new MockAssets([]);
  readonly descriptor: ExecutionEnvironmentDescriptor;
  providers: ServerProvider[];
  settings: ServerSettings;
  private readonly configQueues = new Set<Queue.Queue<ServerConfigStreamEvent>>();
  private baseline: EnvironmentHandlers = { unary: new Map(), streams: new Map(), reactions: new Map() };
  private lanes: EnvironmentHandlers = { unary: new Map(), streams: new Map(), reactions: new Map() };
  readonly client: WsRpcProtocolClient;
  readonly session: EnvironmentConnectionLease["session"];

  constructor(
    readonly environmentId: EnvironmentId,
    readonly label: string,
    providers: ReadonlyArray<ServerProvider>,
  ) {
    this.server = new MockServer(environmentId, label);
    this.providers = [...providers];
    this.settings = Schema.decodeSync(ServerSettings)({});
    this.descriptor = Schema.decodeSync(ExecutionEnvironmentDescriptor)({
      environmentId,
      label,
      platform: { os: "linux", arch: "x64" },
      // A matching version, since a mismatch adds an update banner.
      serverVersion: APP_VERSION,
      orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
      capabilities: {
        repositoryIdentity: true,
        sideChats: true,
        inlineMessageContext: true,
        threadSettlement: true,
        threadAutoSettlement: true,
        threadSnooze: true,
        threadPinning: true,
        threadPinReorder: true,
        threadActiveReorder: true,
        threadVisitedTracking: true,
        threadStop: true,
        threadForceStop: true,
        threadTitleRegeneration: true,
        threadPullRequests: true,
        threadPullRequestLinking: true,
        pullRequests: true,
        freshContext: true,
        environmentThemes: true,
      },
    });
    const context: HandlerContext = { server: this.server };
    const client = this.makeClient(context);
    this.client = client;
    this.session = {
      client,
      initialConfig: Effect.sync(() => this.serverConfig()),
      subscribeServerConfig: () => this.configStream(),
      ready: Effect.void,
      probe: Effect.void,
      inboundFrames: Effect.succeed(0),
      closed: Effect.never,
    };
  }

  install(baseline: EnvironmentHandlers, lanes: EnvironmentHandlers): void {
    this.baseline = baseline;
    this.lanes = lanes;
  }

  reactionFor(type: string): AnyCommandReaction | undefined {
    return this.lanes.reactions.get(type)?.definition;
  }

  // Config and settings ------------------------------------------------------------------------

  serverConfig(): ServerConfig {
    const config = Schema.decodeSync(ServerConfig)({
      environment: Schema.encodeSync(ExecutionEnvironmentDescriptor)(this.descriptor),
      auth: MOCK_AUTH,
      cwd: "/workspace",
      keybindingsConfigPath: "/workspace/.t3/keybindings.json",
      keybindings: [],
      issues: [],
      providers: [],
      availableEditors: [],
      observability: {
        logsDirectoryPath: "/workspace/.t3/logs",
        localTracingEnabled: false,
        otlpTracesEnabled: false,
        otlpMetricsEnabled: false,
      },
      settings: Schema.encodeSync(ServerSettings)(this.settings),
      threadSnapshotPagination: true,
      threadResumeCompletionMarker: true,
      shellResumeCompletionMarker: true,
      shellThreadFamilies: true,
      serverTime: iso(now()),
    });
    return { ...config, providers: this.providers, keybindings: DEFAULT_RESOLVED_KEYBINDINGS };
  }

  configStream(): Stream.Stream<ServerConfigStreamEvent> {
    return liveStream<ServerConfigStreamEvent>(
      () => [{ version: 1, type: "snapshot", config: this.serverConfig() }],
      (queue) => {
        this.configQueues.add(queue);
        return () => this.configQueues.delete(queue);
      },
    );
  }

  /** Applies a settings patch in memory and tells every config subscriber. */
  updateSettings(patch: unknown): ServerSettings {
    const merged = deepMerge(Schema.encodeSync(ServerSettings)(this.settings), patch);
    this.settings = Schema.decodeUnknownSync(ServerSettings)(merged);
    for (const queue of this.configQueues) {
      Queue.offerUnsafe(queue, { version: 1, type: "settingsUpdated", payload: { settings: this.settings } });
    }
    return this.settings;
  }

  // The RPC client -----------------------------------------------------------------------------

  private makeClient(context: HandlerContext): WsRpcProtocolClient {
    const call = (method: string, input: unknown): unknown => {
      // The app hands every method its own input; dispatch here is by name, so inputs are
      // passed through to the handler registered for that same name.
      // Content a fixture registered with asset(...) wins over every handler for that request.
      if (method === WS_METHODS.assetsCreateUrl && typeof input === "object" && input !== null && "resource" in input) {
        const resource = Schema.decodeUnknownOption(AssetResource)(input.resource);
        const registered = resource._tag === "Some" ? this.assets.createUrl(resource.value) : undefined;
        if (registered) return Effect.succeed(registered);
      }
      const threadId = threadIdOf(input);
      if (threadId !== undefined) {
        const record = this.server.thread(ThreadId.make(threadId));
        const answers: Record<string, ((input: never) => unknown) | undefined> | undefined = record?.definition?.rpc;
        const answer = answers?.[method];
        if (answer) return Effect.sync(() => answer(input as never));
      }
      for (const handlers of [this.lanes, this.baseline]) {
        const stream = handlers.streams.get(method);
        if (stream) return stream.definition.handle(input as never, context);
        const unary = handlers.unary.get(method);
        if (unary) {
          return Effect.suspend(() => {
            const result = unary.definition.handle(input as never, context);
            // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- each handler keeps its method's error type.
            return Effect.isEffect(result) ? result : Effect.succeed(result);
          });
        }
      }
      return this.fallback(method, input);
    };
    const target: Record<string, unknown> = {};
    return new Proxy(target, {
      get: (_target, method) =>
        typeof method === "string" ? (input: unknown) => call(method, input) : undefined,
    }) as WsRpcProtocolClient;
  }

  private fallback(method: string, input: unknown): unknown {
    const rpc = WsRpcGroup.requests.get(method);
    const record = (shape: UnhandledCall["shape"], outcome: UnhandledCall["outcome"]) => {
      const existing = unhandledCalls.get(method);
      if (existing) {
        existing.count += 1;
        existing.lastInput = input;
      } else {
        unhandledCalls.set(method, { method, shape, outcome, count: 1, lastInput: input, firstAt: iso(now()) });
      }
    };
    if (rpc && RpcSchema.isStreamSchema(rpc.successSchema)) {
      record("stream", "pending-stream");
      return Stream.never;
    }
    if (rpc) {
      for (const candidate of EMPTY_CANDIDATES) {
        const decoded = Schema.decodeUnknownOption(rpc.successSchema)(candidate);
        if (decoded._tag === "Some") {
          record("unary", "empty-result");
          return Effect.succeed(decoded.value);
        }
      }
    }
    record(rpc ? "unary" : "unknown", "not-available-error");
    return Effect.fail(
      new RpcClientError.RpcClientError({
        reason: new RpcClientError.RpcClientDefect({ message: `${method} ${NOT_AVAILABLE}`, cause: null }),
      }),
    );
  }
}
