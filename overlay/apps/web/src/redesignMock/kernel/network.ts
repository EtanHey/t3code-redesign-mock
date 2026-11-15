// Nothing leaves the page. The environment's HTTP API is answered here, same-origin static files
// load normally, and anything bound for another origin (fetch, WebSocket, EventSource, beacon)
// is refused and recorded, so the smoke run and ?mockdebug can name it.
import { ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { MOCK_SESSION_STATE, type MockEnvironment } from "./environment";

export interface BlockedRequest {
  readonly kind: "fetch" | "websocket" | "eventsource" | "beacon";
  readonly url: string;
  readonly at: string;
}

export const blockedRequests: BlockedRequest[] = [];

function block(kind: BlockedRequest["kind"], url: string): void {
  blockedRequests.push({ kind, url, at: new Date().toISOString() });
  console.warn(`[redesign-mock] blocked ${kind} to ${url}`);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const PLACEHOLDER_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="#1f2430"/><path d="M0 300 L180 170 L300 260 L420 140 L640 300 L640 400 L0 400 Z" fill="#3b4252"/><circle cx="500" cy="90" r="38" fill="#88c0d0"/><text x="24" y="40" font-family="sans-serif" font-size="20" fill="#d8dee9">Mock asset</text></svg>`;

export function installNetworkGuard(primary: MockEnvironment): void {
  const realFetch = window.fetch.bind(window);
  const descriptor = Schema.encodeSync(ExecutionEnvironmentDescriptor)(primary.descriptor);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, window.location.href);
    if (url.origin !== window.location.origin) {
      block("fetch", url.href);
      throw new TypeError(`The mock preview does not make requests to ${url.origin}`);
    }
    if (url.pathname === "/.well-known/t3/environment") return json(descriptor);
    if (url.pathname === "/api/auth/session") return json(MOCK_SESSION_STATE);
    if (url.pathname.startsWith("/api/assets/")) {
      return new Response(PLACEHOLDER_IMAGE, { headers: { "content-type": "image/svg+xml" } });
    }
    // Snapshot endpoints fall back to the socket, which serves the same state.
    if (/^\/(api|oauth|\.well-known)\//.test(url.pathname)) return json({}, 404);
    return realFetch(input, init);
  };

  const RealWebSocket = window.WebSocket;
  // Vite's dev client keeps its own same-origin socket; production opens none at all.
  const allowSameOriginSocket = import.meta.env.DEV;
  class GuardedWebSocket extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly url: string;
    readyState = 3;
    onopen: ((event: Event) => void) | null = null;
    onclose: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    constructor(url: string | URL) {
      super();
      this.url = String(url);
      block("websocket", this.url);
      setTimeout(() => {
        const error = new Event("error");
        this.onerror?.(error);
        this.dispatchEvent(error);
        const close = new CloseEvent("close", { code: 1006, reason: "mock preview" });
        this.onclose?.(close);
        this.dispatchEvent(close);
      }, 0);
    }
    send(): void {}
    close(): void {}
  }
  const guarded = new Proxy(RealWebSocket, {
    construct(target, args: [string | URL, (string | string[])?]) {
      const url = new URL(String(args[0]), window.location.href);
      if (allowSameOriginSocket && url.host === window.location.host) return new target(...args);
      return new GuardedWebSocket(args[0]);
    },
  });
  window.WebSocket = guarded;

  if (typeof window.EventSource === "function") {
    const RealEventSource = window.EventSource;
    window.EventSource = new Proxy(RealEventSource, {
      construct(target, args: [string | URL, EventSourceInit?]) {
        const url = new URL(String(args[0]), window.location.href);
        if (url.origin === window.location.origin) return new target(...args);
        block("eventsource", url.href);
        return new target("data:text/event-stream,");
      },
    });
  }

  if (typeof navigator.sendBeacon === "function") {
    navigator.sendBeacon = (target: string | URL) => {
      block("beacon", String(target));
      return true;
    };
  }
}
