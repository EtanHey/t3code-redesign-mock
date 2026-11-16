// Asset URLs. The kernel answers every asset with `/api/assets/mock/...`, which its fetch guard
// serves; but an <img> loads without fetch, so a file preview of an image in the planted repo got
// the dev server's HTML and showed "Unable to load image". Images in a virtual repo point at a
// static drawing shipped with the build (public/redesign-mock/dashboard.svg). A `data:` URL does
// not work: the app appends a revision query to asset URLs, which corrupts one.
// Everything else keeps the kernel's URL.
import { WS_METHODS } from "@t3tools/contracts";
import { rpc } from "~/redesignMock/api";

import { relativeTo, repoFor } from "../../fixtures/panes/repo";

const PLANTED_IMAGE_URL = "/redesign-mock/dashboard.svg";

export default rpc(WS_METHODS.assetsCreateUrl, (input) => {
  const resource = input.resource;
  const path = "path" in resource && typeof resource.path === "string" ? resource.path : null;
  const repo = path ? repoFor(path) : null;
  const binary = repo && path ? repo.binary.get(relativeTo(repo, path)) : undefined;
  if (binary?.mimeType.startsWith("image/")) {
    return {
      relativeUrl: PLANTED_IMAGE_URL,
      expiresAt: Date.now() + 3_600_000,
      imageDimensions: { width: 660, height: 440 },
    };
  }
  // The kernel's answer, unchanged (this handler replaces the kernel's, so it has to give it).
  return {
    relativeUrl: `/api/assets/mock/${encodeURIComponent(JSON.stringify(input).slice(0, 120))}`,
    expiresAt: Date.now() + 3_600_000,
  };
});
