// Connections asks for the access snapshot even on its overview. An empty real snapshot
// renders the empty state; a silent fallback stream leaves "Loading authorized clients" forever.
import { WS_METHODS, type AuthAccessStreamSnapshotEvent, type ProjectCloneListEvent } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import { rpc, stream } from "~/redesignMock/api";

const access: AuthAccessStreamSnapshotEvent = {
  version: 1, revision: 1, type: "snapshot",
  payload: { pairingLinks: [], clientSessions: [], connectDevices: [] },
};
const clones: ProjectCloneListEvent = [];
export default [
  stream(WS_METHODS.subscribeAuthAccess, () => Stream.concat(Stream.make(access), Stream.never)),
  stream(WS_METHODS.subscribeProjectClones, () => Stream.concat(Stream.make(clones), Stream.never)),
  rpc(WS_METHODS.serverReportClientActivity, () => undefined),
];
