// Answers `assets.createUrl` with content a fixture registered through `asset(...)`. Nothing is
// fetched: text becomes a same-origin `blob:` URL with its own content type, a bundled file keeps
// the URL Vite gave it, and an MCP app page becomes a `data:` URL, because the app's frame adds a
// query string to the URL and a `blob:` URL with a query no longer resolves.
import type { AssetCreateUrlResult, AssetResource } from "@t3tools/contracts";
import { injectHtmlRenderBootstrap } from "@t3tools/shared/htmlRender";

import type { AssetDefinition } from "./definitions";

const URL_LIFETIME_MS = 24 * 3_600_000;

const trimPath = (path: string) => path.replace(/^\.\//, "").replace(/\/+$/, "");

function pathMatches(requested: string, registered: string): boolean {
  const left = trimPath(requested);
  const right = trimPath(registered);
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

function matches(resource: AssetResource, definition: AssetDefinition): boolean {
  switch (resource._tag) {
    case "attachment":
      return "attachmentId" in definition && definition.attachmentId === resource.attachmentId;
    case "workspace-file":
    case "media-file":
    case "draft-workspace-file":
      return "path" in definition && pathMatches(resource.path, definition.path);
    case "tool-output-image":
      return "itemId" in definition && definition.itemId === resource.itemId && (definition.index ?? 0) === resource.index;
    default:
      return false;
  }
}

export class MockAssets {
  private readonly blobUrls = new Map<AssetDefinition, string>();

  constructor(private readonly definitions: ReadonlyArray<AssetDefinition>) {}

  /** The registered asset's URL for this request, or undefined when no fixture registered one. */
  createUrl(resource: AssetResource): AssetCreateUrlResult | undefined {
    const definition = this.definitions.find((candidate) => matches(resource, candidate));
    if (!definition) return undefined;
    const mcpApp = resource._tag === "attachment" && resource.renderIntent === "mcp-app";
    return {
      relativeUrl: mcpApp ? this.dataUrl(definition) : this.urlOf(definition),
      expiresAt: Date.now() + URL_LIFETIME_MS,
      fileRevision: `mock-${this.definitions.indexOf(definition)}`,
      ...("path" in definition ? { sourcePath: definition.path } : {}),
      ...(definition.width && definition.height
        ? { imageDimensions: { width: definition.width, height: definition.height } }
        : {}),
    };
  }

  private body(definition: AssetDefinition): string {
    const text = definition.text ?? "";
    return definition.serveAs === "html-render" ? injectHtmlRenderBootstrap(text) : text;
  }

  private urlOf(definition: AssetDefinition): string {
    if (definition.url !== undefined) return definition.url;
    let url = this.blobUrls.get(definition);
    if (url === undefined) {
      url = URL.createObjectURL(new Blob([this.body(definition)], { type: definition.contentType }));
      this.blobUrls.set(definition, url);
    }
    return url;
  }

  private dataUrl(definition: AssetDefinition): string {
    // The frame appends `?t3-color-scheme=...` to the URL, which lands at the end of a `data:`
    // document's text; an open comment keeps it out of the page.
    const html = `${this.body(definition)}<!--`;
    return `data:${definition.contentType};charset=utf-8,${encodeURIComponent(html)}`;
  }
}
