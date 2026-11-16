// The device panel. A real simulator or emulator cannot run here, so the device service reports a
// ready, set-up host with no devices: the panel settles into its empty state instead of spinning
// on "Finding devices…" (the kernel's silent stream) forever.
import { WS_METHODS } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import { stream } from "~/redesignMock/api";

export default stream(WS_METHODS.subscribeDeviceState, () =>
  Stream.concat(
    Stream.make({
      hostStatus: "ready" as const,
      hostStatusDetail: "Device streaming needs the desktop app; this preview has no simulators.",
      hostStatuses: {},
      hosts: [],
      devices: [],
      sessions: [],
      onboardingCompleted: true,
      agentAccessEnabled: false,
      hubBasePath: "/device-hub",
      revision: 1,
    }),
    Stream.never,
  ),
);
