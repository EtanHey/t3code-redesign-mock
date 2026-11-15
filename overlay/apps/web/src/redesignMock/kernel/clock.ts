// One clock for the whole mock. Fixture times are relative ("5m" ago) and resolve against the
// moment the page booted, so planted data always looks fresh. While the saved visitor log
// replays, the clock reads the time each saved action happened.
import * as DateTime from "effect/DateTime";

const bootedAt = Date.now();
let replayAt: number | null = null;

/** Milliseconds since epoch, or the replayed action's time while the log replays. */
export function nowMs(): number {
  return replayAt ?? Date.now();
}

export function now(): DateTime.Utc {
  return DateTime.makeUnsafe(nowMs());
}

export function isReplaying(): boolean {
  return replayAt !== null;
}

/** Runs `body` with the clock pinned to `at`; used only by the saved-log replay. */
export function atTime<A>(at: number, body: () => A): A {
  const previous = replayAt;
  replayAt = at;
  try {
    return body();
  } finally {
    replayAt = previous;
  }
}

/** A duration such as `"90s"`, `"5m"`, `"2h"`, `"3d"`, `"1h 20m"`, or milliseconds. */
export type Span = string | number;

export function spanMs(span: Span): number {
  if (typeof span === "number") return span;
  let total = 0;
  const pattern = /(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)/g;
  let matched = false;
  for (const match of span.matchAll(pattern)) {
    matched = true;
    const value = Number(match[1]);
    const unit = match[2];
    total +=
      value *
      (unit === "ms"
        ? 1
        : unit === "s"
          ? 1_000
          : unit === "m"
            ? 60_000
            : unit === "h"
              ? 3_600_000
              : unit === "d"
                ? 86_400_000
                : 604_800_000);
  }
  if (!matched) throw new Error(`redesign-mock: cannot read the duration "${span}"`);
  return total;
}

/** The boot time minus `span`, as a DateTime: `ago("5m")`. */
export function ago(span: Span): DateTime.Utc {
  return DateTime.makeUnsafe(bootedAt - spanMs(span));
}

/** The boot time plus `span`, as a DateTime: `fromNow("2h")` for a snooze or reset time. */
export function fromNow(span: Span): DateTime.Utc {
  return DateTime.makeUnsafe(bootedAt + spanMs(span));
}

/** `ago` as an ISO string, for the fields typed `IsoDateTime`. */
export function agoIso(span: Span): string {
  return DateTime.formatIso(ago(span));
}

export function fromNowIso(span: Span): string {
  return DateTime.formatIso(fromNow(span));
}

export function plus(at: DateTime.Utc, span: Span): DateTime.Utc {
  return DateTime.makeUnsafe(DateTime.toEpochMillis(at) + spanMs(span));
}

export function iso(at: DateTime.Utc): string {
  return DateTime.formatIso(at);
}
