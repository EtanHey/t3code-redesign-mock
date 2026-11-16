// What a fixture or handler file exports. Every `*.fixture.ts` and `*.handler.ts` default-exports
// one definition or an array of them; the registry collects them by glob and rejects duplicates.
import type {
  EnvironmentId,
  OrchestrationProjectShell,
  OrchestrationV2Command,
  OrchestrationV2ThreadProjection,
  OrchestrationV2ThreadShell,
  ServerProvider,
} from "@t3tools/contracts";
import type {
  EnvironmentRpcInput,
  EnvironmentRpcStreamValue,
  EnvironmentRpcSuccess,
  EnvironmentStreamRpcTag,
  EnvironmentUnaryRpcTag,
} from "@t3tools/client-runtime/rpc";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

import type { MockServer } from "./server";
import type { RunScript } from "./script";

/** Shows up in the smoke run (one screenshot each) and in `?mockdebug`. */
export interface ScenarioMeta {
  /** The row id from the scenario checklist, such as `"C01"`, or a lane-chosen id. */
  readonly id: string;
  readonly label: string;
  /** Text the smoke run waits for before it takes the screenshot. */
  readonly waitForText?: string;
  /** The "Start here" index heading it goes under. Default: from the fixture's directory. */
  readonly family?: ScenarioFamily;
  /** One short line shown after the link in the "Start here" index. */
  readonly blurb?: string;
}

export type ScenarioFamily =
  | "conversation"
  | "live"
  | "requests"
  | "errors"
  | "agents"
  | "git"
  | "panes"
  | "sidebar";

export interface ThreadDefinition {
  readonly kind: "thread";
  readonly environmentId?: EnvironmentId;
  readonly projection: OrchestrationV2ThreadProjection;
  /** Shell-only fields (pendingBackgroundTasks, goal, lastError, ...) laid over the derived shell. */
  readonly shell?: Partial<OrchestrationV2ThreadShell>;
  /** Left out of the shell snapshot; only `getThreadFamily` and `getOlderSettledThreads` serve it. */
  readonly olderSettled?: boolean;
  readonly scenario?: ScenarioMeta;
  /** What a run started in this thread does. Defaults to the kernel's always-working loop. */
  readonly script?: RunScript;
  /** Runs once, against the thread's active run, the first time the thread is opened. */
  readonly onOpen?: RunScript;
  /** Thread-scoped RPC answers: they win over every global handler for calls naming this thread. */
  readonly rpc?: ThreadRpcAnswers;
}

export type ThreadRpcAnswers = {
  readonly [M in EnvironmentUnaryRpcTag]?: (
    input: EnvironmentRpcInput<M>,
  ) => EnvironmentRpcSuccess<M>;
};

export interface ProjectDefinition {
  readonly kind: "project";
  readonly environmentId?: EnvironmentId;
  /** Sidebar order among planted projects; lower comes first. */
  readonly order: number;
  readonly project: OrchestrationProjectShell;
}

export interface ProviderDefinition {
  readonly kind: "provider";
  readonly environmentId?: EnvironmentId;
  readonly provider: ServerProvider;
}

export interface EnvironmentDefinition {
  readonly kind: "environment";
  readonly environmentId: EnvironmentId;
  readonly label: string;
  /** How the app sees its connection. Default `{ state: "connected" }`. */
  readonly connection?: EnvironmentConnection;
  /** Projects on this environment; a thread names one with `project: ProjectId.make(id)`. */
  readonly projects?: ReadonlyArray<EnvironmentProject>;
}

export interface EnvironmentProject {
  readonly id: string;
  /** The repository's directory name; the workspace root is `/workspace/<title>`. */
  readonly title: string;
}

/**
 * A saved environment's connection as the app shows it. `failed` carries the diagnosis the app
 * prints; `awaiting-approval` is a remote that has not approved this browser yet.
 */
export type EnvironmentConnection =
  | { readonly state: "connected" }
  | { readonly state: "reconnecting" }
  | { readonly state: "failed"; readonly message: string }
  | { readonly state: "awaiting-approval" };

/** Which asset request a registered file answers. */
export type AssetMatch =
  /** `{ _tag: "attachment", attachmentId }`: message attachments, html_render pages, MCP apps. */
  | { readonly attachmentId: string }
  /** Workspace and media files (viewed images, markdown images, file previews), by path or path suffix. */
  | { readonly path: string }
  /** `{ _tag: "tool-output-image", itemId, index }`: images a tool returned. */
  | { readonly itemId: string; readonly index?: number };

export type AssetSpec = AssetMatch & AssetContent;
export type AssetDefinition = AssetSpec & { readonly kind: "asset" };

export interface AssetContent {
  readonly environmentId?: EnvironmentId;
  /** The served type, such as `"image/png"`, `"text/html"`, `"text/csv"`, `"text/markdown"`. */
  readonly contentType: string;
  /**
   * Text content (HTML, CSV, markdown, plain text), served from a `blob:` URL: for attachments,
   * html_render pages and MCP apps. Not for `path` assets, whose previews add a query string.
   */
  readonly text?: string;
  /** A bundled file (`import shot from "./shot.png"`): a real static file, safe everywhere. */
  readonly url?: string;
  /** `"html-render"` adds the bootstrap html_render pages carry (height, theme, links). */
  readonly serveAs?: "html-render";
  /** Pixel size, for images; the app uses it to reserve space before the image loads. */
  readonly width?: number;
  readonly height?: number;
}

export interface HandlerContext {
  readonly server: MockServer;
}

export interface UnaryHandlerDefinition<M extends EnvironmentUnaryRpcTag = EnvironmentUnaryRpcTag> {
  readonly kind: "rpc";
  readonly method: M;
  readonly handle: (
    input: EnvironmentRpcInput<M>,
    context: HandlerContext,
  ) => EnvironmentRpcSuccess<M> | Effect.Effect<EnvironmentRpcSuccess<M>, unknown>;
}

export interface StreamHandlerDefinition<
  M extends EnvironmentStreamRpcTag = EnvironmentStreamRpcTag,
> {
  readonly kind: "stream";
  readonly method: M;
  readonly handle: (
    input: EnvironmentRpcInput<M>,
    context: HandlerContext,
  ) => Stream.Stream<EnvironmentRpcStreamValue<M>, unknown>;
}

export type CommandType = OrchestrationV2Command["type"];
export type CommandOf<T extends CommandType> = Extract<OrchestrationV2Command, { type: T }>;

/** Runs after the kernel's own reducer for that command type (the kernel ignores most types). */
export interface CommandReactionDefinition<T extends CommandType = CommandType> {
  readonly kind: "command";
  readonly type: T;
  readonly react: (command: CommandOf<T>, context: HandlerContext) => void;
}

// The registry dispatches by method name at runtime, so it holds handlers with their input
// erased; each handler is still checked against its own method where a lane writes it.
export interface AnyUnaryHandler {
  readonly kind: "rpc";
  readonly method: EnvironmentUnaryRpcTag;
  readonly handle: (input: never, context: HandlerContext) => unknown;
}
export interface AnyStreamHandler {
  readonly kind: "stream";
  readonly method: EnvironmentStreamRpcTag;
  readonly handle: (input: never, context: HandlerContext) => Stream.Stream<unknown, unknown>;
}
export interface AnyCommandReaction {
  readonly kind: "command";
  readonly type: CommandType;
  readonly react: (command: never, context: HandlerContext) => void;
}

export type MockDefinition =
  | ThreadDefinition
  | ProjectDefinition
  | ProviderDefinition
  | EnvironmentDefinition
  | AssetDefinition
  | AnyUnaryHandler
  | AnyStreamHandler
  | AnyCommandReaction;

/** Answers a request/response RPC method. */
export function rpc<M extends EnvironmentUnaryRpcTag>(
  method: M,
  handle: UnaryHandlerDefinition<M>["handle"],
): UnaryHandlerDefinition<M> {
  return { kind: "rpc", method, handle };
}

/** Answers a streaming RPC method. */
export function stream<M extends EnvironmentStreamRpcTag>(
  method: M,
  handle: StreamHandlerDefinition<M>["handle"],
): StreamHandlerDefinition<M> {
  return { kind: "stream", method, handle };
}

/** Reacts to a dispatched command, after the kernel reducer has applied it. */
export function onCommand<T extends CommandType>(
  type: T,
  react: CommandReactionDefinition<T>["react"],
): CommandReactionDefinition<T> {
  return { kind: "command", type, react };
}

export function provider(
  value: ServerProvider,
  environmentId?: EnvironmentId,
): ProviderDefinition {
  return { kind: "provider", provider: value, ...(environmentId ? { environmentId } : {}) };
}

/** Another environment, listed beside the primary one with its own projects and threads. */
export function environment(
  environmentId: EnvironmentId,
  label: string,
  options: {
    readonly connection?: EnvironmentConnection;
    readonly projects?: ReadonlyArray<EnvironmentProject>;
  } = {},
): EnvironmentDefinition {
  return {
    kind: "environment",
    environmentId,
    label,
    ...(options.connection ? { connection: options.connection } : {}),
    ...(options.projects ? { projects: options.projects } : {}),
  };
}

/** Registers bundled content the app's own asset requests are answered with. */
export function asset(spec: AssetSpec): AssetDefinition {
  if ((spec.text === undefined) === (spec.url === undefined)) {
    throw new Error("redesign-mock: asset() takes exactly one of `text` or `url`");
  }
  // File previews add `?revision=...` to the URL, which a blob: URL cannot carry.
  if ("path" in spec && spec.url === undefined) {
    throw new Error(`redesign-mock: asset({ path: "${spec.path}" }) needs a bundled file as \`url\``);
  }
  return { kind: "asset", ...spec };
}
