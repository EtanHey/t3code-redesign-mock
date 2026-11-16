// Believable defaults for the thread details card, so planted threads do not read "Context N/A".
// A thread whose fixture already set its active provider thread's context usage keeps it.
import {
  ProviderDriverKind,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ThreadProjection,
  type ServerProviderUsageLimits,
} from "@t3tools/contracts";

import { agoIso, fromNowIso } from "./clock";
import { CLAUDE } from "./constants";
import { providerThreadIdOf } from "./plumbing";

/** A stable number in [0, 1) per thread, so each thread shows its own figure on every visit. */
function spread(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 2 ** 32;
}

export function withDefaultContextUsage(projection: OrchestrationV2ThreadProjection): OrchestrationV2ThreadProjection {
  const thread = projection.thread;
  const claude = thread.modelSelection.instanceId === CLAUDE;
  const maxTokens = claude ? 200_000 : 272_000;
  // A thread with no runs yet (one a visitor just started) holds little more than the system prompt.
  const share =
    projection.runs.length === 0
      ? 0.03 + spread(thread.id) * 0.03
      : 0.08 + spread(thread.id) * 0.55 + Math.min(0.2, projection.turnItems.length * 0.006);
  const usedTokens = Math.round(maxTokens * Math.min(0.9, share));
  const contextUsage = {
    usedTokens,
    maxTokens,
    inputTokens: Math.round(usedTokens * 0.82),
    cachedInputTokens: Math.round(usedTokens * 0.61),
    outputTokens: Math.round(usedTokens * 0.18),
    compactsAutomatically: true,
  };

  const activeId = thread.activeProviderThreadId;
  const active = activeId ? projection.providerThreads.find((candidate) => candidate.id === activeId) : undefined;
  if (active) {
    if (active.contextUsage) return projection;
    return {
      ...projection,
      providerThreads: projection.providerThreads.map((candidate) =>
        candidate === active ? { ...candidate, contextUsage } : candidate,
      ),
    };
  }
  const id = providerThreadIdOf(thread.id);
  const existing = projection.providerThreads.find((candidate) => candidate.id === id);
  if (existing?.contextUsage) {
    return { ...projection, thread: { ...thread, activeProviderThreadId: id } };
  }
  const runs = projection.runs.length;
  const providerThread: OrchestrationV2ProviderThread = existing
    ? { ...existing, contextUsage }
    : {
        id,
        driver: ProviderDriverKind.make(claude ? "claudeAgent" : "codex"),
        providerInstanceId: thread.modelSelection.instanceId,
        providerSessionId: null,
        appThreadId: thread.id,
        ownerNodeId: null,
        nativeThreadRef: null,
        nativeConversationHeadRef: null,
        status: "idle",
        firstRunOrdinal: runs > 0 ? 1 : null,
        lastRunOrdinal: runs > 0 ? runs : null,
        handoffIds: [],
        forkedFrom: null,
        pendingBackgroundTasks: [],
        contextUsage,
        nativeMetadata: null,
        goal: null,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
      };
  return {
    ...projection,
    thread: { ...thread, activeProviderThreadId: id },
    providerThreads: [...projection.providerThreads.filter((candidate) => candidate.id !== id), providerThread],
  };
}

/** Usage limits a signed-in plan would report: a five-hour session window and a weekly one. */
export function usageLimits(session: number, weekly: number): ServerProviderUsageLimits {
  return {
    checkedAt: agoIso("2m"),
    windows: [
      { id: "session", kind: "session", label: "5-hour limit", usedPercent: session, resetsAt: fromNowIso("2h 10m"), windowDurationMins: 300 },
      { id: "weekly", kind: "weekly", label: "Weekly limit", usedPercent: weekly, resetsAt: fromNowIso("3d"), windowDurationMins: 10_080 },
    ],
  };
}
