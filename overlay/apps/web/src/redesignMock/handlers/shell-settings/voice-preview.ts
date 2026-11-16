// Voice settings use the environment HTTP API rather than the WebSocket RPC seam. Install this
// after the kernel guard, and answer only same-origin voice metadata; audio never leaves the page.
import {
  CloudSpeechKeys,
  CloudSpeechModels,
  EnvironmentSpeechModels,
  EnvironmentSpeechStatus,
  EnvironmentSpeechModelRequest,
  EnvironmentSpeechAccelerationRequest,
  EnvironmentSpeechModelUnloadTimeoutRequest,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { BUILD_INFO } from "../../kernel/runtime";
let installed = false;
export function installVoicePreview() {
  if (installed) return;
  installed = true;
  const key = `redesign-mock:shell-voice:${BUILD_INFO.fixtureVersion}`;
  let models: EnvironmentSpeechModels = {
    models: [
      {
        id: "preview-small",
        name: "Small multilingual",
        description: "A compact model for everyday dictation.",
        size: 244000000,
        languages: ["en", "es", "fr", "de", "ja"],
        accuracy: 4,
        speed: 5,
        recommended: true,
        supportsStreaming: true,
        supportsLanguageDetection: true,
        supportsTranslation: true,
        active: true,
        state: "installed",
      },
      {
        id: "preview-large",
        name: "Large multilingual",
        description: "Higher accuracy for longer recordings.",
        size: 1550000000,
        languages: ["en", "es", "fr", "de", "ja"],
        accuracy: 5,
        speed: 3,
        recommended: false,
        supportsStreaming: true,
        supportsLanguageDetection: true,
        supportsTranslation: true,
        active: false,
        state: "downloadable",
      },
    ],
  };
  let status: EnvironmentSpeechStatus = {
    supported: true,
    state: "ready",
    modelId: "preview-small",
    model: "Small multilingual",
    size: 244000000,
    supportsStreaming: true,
    supportsBufferedStreaming: true,
    supportsModelLinking: false,
    supportsTranslation: true,
    languages: ["en", "es", "fr", "de", "ja"],
    supportsLanguageDetection: true,
    acceleration: "cpu",
    benchmarkTier: "cpu",
    modelUnloadTimeout: "min_5",
    gpuDevices: [],
  };
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const saved: unknown = JSON.parse(raw);
      const state = Schema.decodeUnknownSync(
        Schema.Struct({ models: EnvironmentSpeechModels, status: EnvironmentSpeechStatus }),
      )(saved);
      models = state.models;
      status = state.status;
    }
  } catch {
    /* Retain the planted catalog. */
  }
  const persist = () => {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          models: Schema.encodeSync(EnvironmentSpeechModels)(models),
          status: Schema.encodeSync(EnvironmentSpeechStatus)(status),
        }),
      );
    } catch {
      /* In-memory edits still work. */
    }
  };
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const request = new Request(
      new URL(input instanceof Request ? input.url : String(input), window.location.href),
      input instanceof Request ? input : init,
    );
    const url = new URL(request.url);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/voice/"))
      return original(input, init);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    if (url.pathname === "/api/voice/status")
      return json(Schema.encodeSync(EnvironmentSpeechStatus)(status));
    if (url.pathname === "/api/voice/models" && request.method === "GET")
      return json(Schema.encodeSync(EnvironmentSpeechModels)(models));
    if (url.pathname === "/api/voice/cloud/keys")
      return json({ openai: false, xai: false, openrouter: false } satisfies CloudSpeechKeys);
    if (url.pathname === "/api/voice/cloud/openrouter/models")
      return json({
        models: [{ id: "preview/transcribe-small", name: "Preview transcription model" }],
      } satisfies CloudSpeechModels);
    if (
      [
        "/api/voice/models/select",
        "/api/voice/models/download",
        "/api/voice/models/remove",
        "/api/voice/models/cancel",
      ].includes(url.pathname)
    ) {
      const body = Schema.decodeUnknownSync(EnvironmentSpeechModelRequest)(await request.json());
      models = {
        models: models.models.map((model) => ({
          ...model,
          ...(model.id === body.modelId
            ? {
                state: url.pathname.endsWith("/remove")
                  ? ("downloadable" as const)
                  : ("installed" as const),
              }
            : {}),
          ...(url.pathname.endsWith("/select") ? { active: model.id === body.modelId } : {}),
        })),
      };
      const active = models.models.find((model) => model.active && model.state === "installed");
      if (status.supported)
        status = {
          ...status,
          state: active ? "ready" : "missing-model",
          ...(active ? { modelId: active.id, model: active.name, size: active.size } : {}),
        };
      persist();
      return json(Schema.encodeSync(EnvironmentSpeechModels)(models));
    }
    if (url.pathname === "/api/voice/acceleration" && status.supported) {
      const body = Schema.decodeUnknownSync(EnvironmentSpeechAccelerationRequest)(
        await request.json(),
      );
      status = { ...status, acceleration: body.acceleration };
      persist();
      return json(Schema.encodeSync(EnvironmentSpeechStatus)(status));
    }
    if (url.pathname === "/api/voice/model-unload-timeout" && status.supported) {
      const body = Schema.decodeUnknownSync(EnvironmentSpeechModelUnloadTimeoutRequest)(
        await request.json(),
      );
      status = { ...status, modelUnloadTimeout: body.timeout };
      persist();
      return json(Schema.encodeSync(EnvironmentSpeechStatus)(status));
    }
    if (url.pathname === "/api/voice/models/prepare") return new Response(null, { status: 204 });
    return original(input, init);
  };
}
