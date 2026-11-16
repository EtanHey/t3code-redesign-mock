// Stands in for client-runtime's ConnectionDriver (served in its place by vite/redesignMock.ts):
// every connection opens the matching mock environment's in-browser session. No socket, no fetch.
// An `environment(...)` definition can instead keep its connection reconnecting, failed with a
// diagnosis, or waiting for the host to approve this device.
import {
  ConnectionBlockedError,
  ConnectionTransientError,
  type ConnectionAttemptError,
  type ConnectionCatalogEntry,
  type ConnectionDriverProgress,
  type EnvironmentConnectionLease,
  type PreparedConnection,
  type RouteCheck,
} from "@t3tools/client-runtime/connection";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import type { EnvironmentConnection } from "./definitions";
import { mockRuntime } from "./runtime";

/** The code an awaiting-approval environment shows; the host would show the same one. */
export const MOCK_VERIFICATION_CODE = "QX4-7MD";

function connectionFailure(label: string, connection: EnvironmentConnection): ConnectionAttemptError | null {
  switch (connection.state) {
    case "connected":
      return null;
    case "reconnecting":
      return new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: `${label} stopped answering. Retrying.`,
        hop: "server",
        via: "direct",
      });
    case "failed":
      return new ConnectionBlockedError({
        reason: "authentication",
        detail: connection.message,
        hop: "server",
        via: "direct",
        httpStatus: 401,
      });
    case "awaiting-approval":
      return new ConnectionTransientError({
        reason: "approval-pending",
        detail: "This device is waiting for approval on the host.",
        failureCause: "approval_pending",
        verificationCode: MOCK_VERIFICATION_CODE,
        hop: "server",
        via: "direct",
      });
  }
}

export const mockDriver = {
  connect: (
    entry: ConnectionCatalogEntry,
    reportProgress: (progress: ConnectionDriverProgress) => Effect.Effect<void>,
  ): Effect.Effect<EnvironmentConnectionLease, ConnectionAttemptError, Scope.Scope> =>
    Effect.gen(function* () {
      yield* reportProgress({ stage: "preparing" });
      const runtime = mockRuntime();
      const environment =
        runtime.environments.get(entry.target.environmentId) ?? runtime.primary;
      const definition = runtime.registry.environments.find(
        (candidate) => candidate.definition.environmentId === environment.environmentId,
      )?.definition;
      const failure = definition?.connection
        ? connectionFailure(definition.label, definition.connection)
        : null;
      if (failure) return yield* failure;
      const prepared: PreparedConnection = {
        environmentId: environment.environmentId,
        label: environment.label,
        httpBaseUrl: window.location.origin,
        socketUrl: window.location.origin.replace(/^http/, "ws"),
        httpAuthorization: null,
        target: entry.target,
        descriptor: environment.descriptor,
      };
      yield* reportProgress({ stage: "opening", prepared });
      yield* reportProgress({ stage: "synchronizing", prepared });
      return { prepared, session: environment.session };
    }),
  preflight: () => Effect.succeed("ready" as const),
  checkHost: () => Effect.succeed<RouteCheck>("answered"),
};
