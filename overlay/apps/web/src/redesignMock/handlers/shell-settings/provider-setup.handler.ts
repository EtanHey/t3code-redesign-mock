import {
  ProviderDriverKind,
  ProviderInstanceId,
  WS_METHODS,
  type ProviderAuthState,
  type ProviderInstallState,
} from "@t3tools/contracts";
import * as Queue from "effect/Queue";
import { rpc, stream, type HandlerContext } from "~/redesignMock/api";
import { liveStream } from "../../kernel/server";
import { environment, persistProviders } from "./settings-runtime";
const authStates = new Map<string, ProviderAuthState>();
const authQueues = new Map<string, Set<Queue.Queue<ProviderAuthState>>>();
const installStates = new Map<string, ProviderInstallState>();
const installQueues = new Map<string, Set<Queue.Queue<ProviderInstallState>>>();
const auth = (id: string): ProviderAuthState =>
  authStates.get(id) ?? {
    instanceId: ProviderInstanceId.make(id),
    phase: "idle",
    flowId: null,
    authorizationUrl: null,
    expiresAt: null,
    message: null,
    methods: [
      {
        id: "preview",
        name: "Preview sign-in",
        description: "Simulate signing in within this browser.",
        type: "agent",
      },
    ],
    interaction: null,
    credentialOwner: "provider",
  };
const install = (id: string): ProviderInstallState =>
  installStates.get(id) ?? {
    driver: ProviderDriverKind.make("codex"),
    operationId: null,
    phase: "idle",
    downloadedBytes: 0,
    totalBytes: null,
    version: null,
    installedVersion: null,
    executablePath: null,
    source: "managed",
    canRemove: false,
    message: null,
  };
function signedIn(id: string, context: HandlerContext): ProviderAuthState {
  const state: ProviderAuthState = {
    ...auth(id),
    phase: "succeeded",
    flowId: "preview-sign-in",
    message: "Signed in for this browser preview.",
    interaction: null,
  };
  authStates.set(id, state);
  for (const queue of authQueues.get(id) ?? []) Queue.offerUnsafe(queue, state);
  const env = environment(context);
  env.providers = env.providers.map((p) =>
    p.instanceId === id
      ? {
          ...p,
          status: "ready",
          auth: { status: "authenticated" },
          message: "Preview sign-in complete.",
        }
      : p,
  );
  persistProviders(context);
  return state;
}
export default [
  stream(WS_METHODS.providerAuthSubscribe, (input) =>
    liveStream(
      () => [auth(input.instanceId)],
      (queue) => {
        const queues = authQueues.get(input.instanceId) ?? new Set();
        queues.add(queue);
        authQueues.set(input.instanceId, queues);
        return () => {
          queues.delete(queue);
        };
      },
    ),
  ),
  stream(WS_METHODS.providerInstallSubscribe, (input) =>
    liveStream(
      () => [install(input.instanceId)],
      (queue) => {
        const queues = installQueues.get(input.instanceId) ?? new Set();
        queues.add(queue);
        installQueues.set(input.instanceId, queues);
        return () => {
          queues.delete(queue);
        };
      },
    ),
  ),
  rpc(WS_METHODS.providerAuthStart, (input, context) => signedIn(input.instanceId, context)),
  rpc(WS_METHODS.providerInstallStart, (input, context) => {
    const state: ProviderInstallState = {
      ...install(input.instanceId),
      phase: "succeeded",
      operationId: "preview-install",
      downloadedBytes: 18000000,
      totalBytes: 18000000,
      version: "0.143.0",
      installedVersion: "0.143.0",
      executablePath: "/workspace/.t3/bin/preview-agent",
      message: "Installed for this browser preview.",
    };
    installStates.set(input.instanceId, state);
    for (const queue of installQueues.get(input.instanceId) ?? []) Queue.offerUnsafe(queue, state);
    const env = environment(context);
    env.providers = env.providers.map((p) =>
      p.instanceId === input.instanceId
        ? {
            ...p,
            installed: true,
            version: "0.143.0",
            status: "ready",
            message: "Preview runtime installed.",
          }
        : p,
    );
    persistProviders(context);
    return state;
  }),
];
