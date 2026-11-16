// Serve both planted repo images with the kernel's asset registry. Matching by suffix
// covers the project root and each worktree; revision queries remain valid static URLs.
import { asset } from "~/redesignMock/api";
import { REPO_BINARY_FILES } from "../panes/repo";

export default Object.entries(REPO_BINARY_FILES).map(([path]) =>
  asset({ path, contentType: "image/svg+xml", url: "/redesign-mock/dashboard.svg", width: 660, height: 440 }),
);
