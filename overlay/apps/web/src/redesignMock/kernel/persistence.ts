// Each visitor's changes live in their own browser and nowhere else: a log of what they did
// (commands, launched threads, settings patches) in localStorage, replayed over the planted
// fixtures at boot. The log is keyed by the fixture version, so a deploy whose fixtures changed
// starts clean instead of replaying actions against threads that no longer match.
import {
  EnvironmentId,
  OrchestrationV2Command,
  OrchestrationV2ThreadLaunchInput,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const STORAGE_KEY = "t3code-redesign-mock:visitor-log";
const MAX_ENTRIES = 2_000;

const LogEntry = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("command"),
    at: Schema.Number,
    environmentId: EnvironmentId,
    command: OrchestrationV2Command,
  }),
  Schema.Struct({
    kind: Schema.Literal("launch"),
    at: Schema.Number,
    environmentId: EnvironmentId,
    input: OrchestrationV2ThreadLaunchInput,
  }),
  Schema.Struct({
    kind: Schema.Literal("settings"),
    at: Schema.Number,
    environmentId: EnvironmentId,
    patch: Schema.Unknown,
  }),
]);
export type LogEntry = typeof LogEntry.Type;

const SavedLog = Schema.Struct({
  fixtureVersion: Schema.String,
  entries: Schema.Array(Schema.Unknown),
});

const encodeEntry = Schema.encodeSync(LogEntry);
const decodeEntry = Schema.decodeUnknownOption(LogEntry);

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export class VisitorLog {
  private encoded: unknown[] = [];

  constructor(readonly fixtureVersion: string) {}

  /** Reads the saved log. A log from other fixtures, or one that will not decode, is dropped. */
  load(): ReadonlyArray<LogEntry> {
    const store = storage();
    if (!store) return [];
    let raw: string | null = null;
    try {
      raw = store.getItem(STORAGE_KEY);
    } catch {
      return [];
    }
    if (raw === null) return [];
    try {
      const saved = Schema.decodeUnknownSync(SavedLog)(JSON.parse(raw));
      if (saved.fixtureVersion !== this.fixtureVersion) {
        this.clear();
        return [];
      }
      const entries: LogEntry[] = [];
      for (const value of saved.entries) {
        const decoded = decodeEntry(value);
        // An entry that no longer decodes is skipped; the rest still replay.
        if (decoded._tag === "Some") {
          entries.push(decoded.value);
          this.encoded.push(value);
        }
      }
      return entries;
    } catch {
      this.clear();
      return [];
    }
  }

  append(entry: LogEntry): void {
    this.encoded.push(encodeEntry(entry));
    if (this.encoded.length > MAX_ENTRIES) this.encoded = this.encoded.slice(-MAX_ENTRIES);
    this.save();
  }

  private save(): void {
    const store = storage();
    if (!store) return;
    try {
      store.setItem(
        STORAGE_KEY,
        JSON.stringify({ fixtureVersion: this.fixtureVersion, entries: this.encoded }),
      );
    } catch {
      // Out of quota or blocked: the session keeps working, it just will not survive a reload.
    }
  }

  clear(): void {
    this.encoded = [];
    const store = storage();
    if (!store) return;
    try {
      store.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clear.
    }
  }

  size(): number {
    return this.encoded.length;
  }
}
