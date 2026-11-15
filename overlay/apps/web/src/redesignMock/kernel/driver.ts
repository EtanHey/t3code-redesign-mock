// Stands in for client-runtime's ConnectionDriver (served in its place by vite/redesignMock.ts):
// every connection opens the matching mock environment's in-browser session. No socket, no fetch.
import type {
  ConnectionAttemptError,
  ConnectionCatalogEntry,
  ConnectionDriverProgress,
  EnvironmentConnectionLease,
  PreparedConnection,
  RouteCheck,
} from "@t3tools/client-runtime/connection";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import { mockRuntime } from "./runtime";

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
