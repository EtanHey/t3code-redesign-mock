import {
  WS_METHODS,
  type ResourceTelemetryAggregate,
  type ResourceTelemetryHealth,
  type ResourceTelemetryHistory,
  type ResourceTelemetrySnapshot,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { ago, now, rpc, stream } from "~/redesignMock/api";
const health = (): ResourceTelemetryHealth => ({
  native: { status: "healthy", lastSampleAt: Option.some(now()), lastError: Option.none() },
  desktop: { status: "unavailable", lastSampleAt: Option.none(), lastError: Option.none() },
  sidecarVersion: Option.some("0.1.0-preview"),
  sidecarPid: Option.some(4202),
  restartCount: 0,
  collectionDurationMicros: 720,
  scannedProcessCount: 3,
  retainedProcessCount: 2,
  inaccessibleProcessCount: 0,
});
const aggregate: ResourceTelemetryAggregate = {
  processCount: 2,
  currentCpuPercent: 2.8,
  cpuTimeMs: 24800,
  currentRssBytes: 209715200,
  peakRssBytes: 230686720,
  ioReadBytes: 4800000,
  ioWriteBytes: 1200000,
  ioReadBytesPerSecond: 2400,
  ioWriteBytesPerSecond: 600,
  processStarts: 2,
  processExits: 0,
};
const empty: ResourceTelemetryAggregate = {
  processCount: 0,
  currentCpuPercent: 0,
  cpuTimeMs: 0,
  currentRssBytes: 0,
  peakRssBytes: 0,
  ioReadBytes: 0,
  ioWriteBytes: 0,
  ioReadBytesPerSecond: 0,
  ioWriteBytesPerSecond: 0,
  processStarts: 0,
  processExits: 0,
};
const snapshot = (): ResourceTelemetrySnapshot => ({
  readAt: now(),
  sampleIntervalMs: 5000,
  processes: [],
  groups: {
    backend: aggregate,
    electron: empty,
    monitor: { ...empty, processCount: 1, currentCpuPercent: 0.1, currentRssBytes: 12000000 },
    allT3: { ...aggregate, processCount: 3, currentCpuPercent: 2.9, currentRssBytes: 221715200 },
  },
  power: {
    source: "node-linux",
    idle: "false",
    idleSeconds: 0,
    locked: "false",
    suspended: false,
    onBattery: "false",
    lowPowerMode: "false",
    thermalState: "nominal",
    stale: false,
    updatedAt: now(),
  },
  speedLimitPercent: Option.none(),
  attribution: {
    readAt: now(),
    entries: [
      {
        component: "thread projection",
        operation: "read",
        logicalReadBytes: 4800000,
        logicalWriteBytes: 0,
        count: 124,
        durationMs: 1736,
      },
    ],
  },
  health: health(),
});
export default [
  stream(WS_METHODS.subscribeResourceTelemetry, () =>
    Stream.concat(Stream.make(snapshot()), Stream.never),
  ),
  rpc(WS_METHODS.serverGetResourceTelemetryHistory, (input): ResourceTelemetryHistory => ({
    readAt: now(),
    windowMs: input.windowMs,
    bucketMs: input.bucketMs,
    sampleIntervalMs: 5000,
    retainedSampleCount: 180,
    buckets: Array.from({ length: 12 }, (_, index) => ({
      startedAt: ago(`${12 - index}m`),
      endedAt: ago(`${11 - index}m`),
      avgCpuPercent: 2 + (index % 4),
      maxCpuPercent: 6 + (index % 3),
      maxRssBytes: 221715200,
      ioReadBytes: 144000,
      ioWriteBytes: 36000,
      maxProcessCount: 3,
    })),
    topProcesses: [],
    health: health(),
  })),
  rpc(WS_METHODS.serverGetHostResources, () => ({
    sampledAt: 1794700000000,
    cpuUtilization: 0.12,
    cpuCount: 8,
    availableMemoryBytes: 8000000000,
    totalMemoryBytes: 16000000000,
  })),
];
