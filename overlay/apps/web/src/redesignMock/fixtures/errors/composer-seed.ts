// Plants an unsent composer draft for a thread, once per browser, before the app's stores load.
// The composer-draft store is an upstream zustand `persist` store in localStorage; we write its
// saved shape and the app decodes it as if a visitor had typed the text. Some banners (the
// branch-changed notice) only show once the composer holds a draft, so the thread opens with it.
// "Reset demo" clears localStorage, marker included, which plants the draft again.
import { ENVIRONMENT_ID } from "~/redesignMock/api";

const DRAFTS_KEY = "t3code:composer-drafts:v1";
const DRAFTS_VERSION = 9;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function seedComposerDraftOnce(threadId: string, prompt: string): void {
  const marker = `t3code-redesign-mock:composer-draft-seeded:${threadId}`;
  try {
    const storage = window.localStorage;
    if (storage.getItem(marker) !== null) return;
    let envelope: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(storage.getItem(DRAFTS_KEY) ?? "null");
      if (isRecord(parsed)) envelope = parsed;
    } catch {
      envelope = {};
    }
    const state = isRecord(envelope.state) ? envelope.state : {};
    const drafts = isRecord(state.draftsByThreadKey) ? state.draftsByThreadKey : {};
    storage.setItem(
      DRAFTS_KEY,
      JSON.stringify({
        version: typeof envelope.version === "number" ? envelope.version : DRAFTS_VERSION,
        state: {
          draftThreadsByThreadKey: {},
          logicalProjectDraftThreadKeyByLogicalProjectKey: {},
          ...state,
          draftsByThreadKey: { ...drafts, [`${ENVIRONMENT_ID}:${threadId}`]: { prompt, attachments: [] } },
        },
      }),
    );
    storage.setItem(marker, new Date().toISOString());
  } catch (error) {
    console.warn("[redesign-mock] could not plant the composer draft", error);
  }
}
