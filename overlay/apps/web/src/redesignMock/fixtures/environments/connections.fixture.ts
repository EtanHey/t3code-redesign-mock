// The connected build-box definition and render-farm project belong to kernel K08.
// Reuse them, rather than registering the environment twice.
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { assistant, command, environment, fileChange, thread, turn, ENVIRONMENT_ID } from "~/redesignMock/api";

const BUILD_BOX = EnvironmentId.make("env-build-box");
const RENDER_FARM = ProjectId.make("project-env-build-box-render-farm");
const parent = { environmentId: ENVIRONMENT_ID, threadId: ThreadId.make("x05-remote-task"), title: "Remote task running on build-box" };

export default [
  environment(EnvironmentId.make("env-cache-node"), "cache-node", {
    connection: { state: "reconnecting" },
    projects: [{ id: "project-cache-node", title: "artifact-cache" }],
  }),
  environment(EnvironmentId.make("env-test-lab"), "test-lab", {
    connection: { state: "failed", message: "The saved access token was revoked on test-lab. Add this environment again with a new pairing link to restore access." },
    projects: [{ id: "project-test-lab", title: "device-checks" }],
  }),
  environment(EnvironmentId.make("env-preview-host"), "preview-host", {
    connection: { state: "awaiting-approval" },
    projects: [{ id: "project-preview-host", title: "preview-sites" }],
  }),
  thread({
    id: "s05-environment-tour", project: "sidebar", title: "Environments: local work and the remote build-box",
    scenario: { id: "S05", family: "sidebar", label: "Switch between local and remote projects", waitForText: "render-farm" },
    turns: [turn({ at: "4m", user: "Where is the release work running?", items: [assistant(
      "This chat is on **Preview workstation**, in `pebble-mobile`. The Linux builds and image scan run on **build-box**, in `render-farm`. Open the environment switcher in the sidebar or start a new thread and choose its project to see both machines.\n\nOpen **Remote task running on build-box** to follow its two remote task rows. Settings → Connections also lists cache-node reconnecting, test-lab with a revoked-token diagnosis, and preview-host waiting for approval. Those disconnected machines cannot open their projects until they connect.",
    )] })],
  }),
  thread({
    id: "t04-connection-states", project: "sidebar", title: "Connections: retrying, revoked token and approval code",
    scenario: { id: "T04", family: "sidebar", label: "Connection states and diagnosis in Settings", waitForText: "QX4-7MD" },
    turns: [turn({ at: "5m", user: "Why are the other machines unavailable?", items: [assistant(
      "Open **Settings → Connections** (the Environments page). **build-box** is connected. **cache-node** stopped answering and keeps retrying. **test-lab** has a revoked access token: expand its connection diagnosis to see the authentication failure and HTTP 401. **preview-host** is awaiting host approval; compare code **QX4-7MD** with the host.\n\nRetrying preserves the planted state in this preview. The approval must happen on the host, so it remains pending here.",
    )] })],
  }),
  thread({
    id: "remote-linux-release", environmentId: BUILD_BOX, project: RENDER_FARM,
    title: "Build the Linux release", branch: "release/linux-2.6", worktreePath: "/workspace/render-farm/.worktrees/linux-release",
    scenario: { id: "S05-build", family: "sidebar", label: "Linux release on build-box", waitForText: "Compiling arm64" },
    thread: { createdBy: "agent", creationSource: "mcp", delegatedFrom: parent },
    turns: [turn({ at: "7m", status: "running", took: "7m", user: "Build the Linux x64 and arm64 release bundles and attach the checksums.", items: [
      command({ input: "vp run release:linux --arch x64,arm64", status: "running", output: "x64 bundle complete: dist/app-linux-x64.tar.gz\nCompiling arm64; checksums follow when both bundles finish.\n" }),
      assistant("The x64 bundle is ready. Compiling arm64 on build-box before generating the checksum file.", { phase: "commentary" }),
    ] })],
  }),
  thread({
    id: "remote-image-scan", environmentId: BUILD_BOX, project: RENDER_FARM,
    title: "Scan the container image", branch: "release/image-audit", worktreePath: "/workspace/render-farm/.worktrees/image-audit",
    scenario: { id: "S05-scan", family: "sidebar", label: "Completed image scan on build-box", waitForText: "4 low findings" },
    thread: { createdBy: "agent", creationSource: "mcp", delegatedFrom: parent },
    turns: [turn({ at: "20m", took: "3m", user: "Scan the release candidate image and report high or critical findings.", items: [
      command({ input: "image-audit scan registry.example.dev/lumen/app:rc1", output: "critical: 0\nhigh: 0\nmedium: 0\nlow: 4\n" }),
      fileChange({ path: "reports/image-audit.md", additions: 6, deletions: 1 }),
      assistant("No high or critical findings. There are 4 low findings in the base image, none reachable. The report records the image digest and the package versions."),
    ] })],
  }),
  // X05b's delegatedFrom points here, separately from X05's two task rows.
  thread({
    id: "remote-release-lead", environmentId: BUILD_BOX, project: RENDER_FARM,
    title: "Cut the 2.6 release candidate", branch: "main",
    scenario: { id: "S05-lead", family: "sidebar", label: "Source of the delegated documentation check", waitForText: "documentation check" },
    turns: [turn({ at: "16m", user: "Cut the 2.6 release candidate.", items: [assistant("The Linux build and image audit are on this machine. I delegated the documentation check to Preview workstation, where the docs toolchain is installed.")] })],
  }),
];
