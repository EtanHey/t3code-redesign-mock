// Four exemplars for `asset(...)`: message attachments (an image, a CSV and a markdown file), an
// image the agent viewed plus the screenshot a tool returned, an html_render page, and an MCP app.
import { TurnItemId } from "@t3tools/contracts";

import { assistant, asset, item, reasoning, thread, turn, workspaceRootOf } from "../../api";
import latencyChart from "./assets/latency-by-route.png";
import settingsScreenshot from "./assets/settings-dark.png";
import settingsDrawing from "./assets/settings-dark.svg?url";

// K04: attachments ------------------------------------------------------------------------------

const LATENCY_CSV = `route,requests,p50_ms,p95_ms,errors
/orders,48211,182,412,37
/orders/:id,91877,64,118,4
/cart,30554,95,240,11
/search,22409,141,388,52
/health,8640,4,9,0
`;

const INCIDENT_NOTES = `# Orders latency, Tuesday

- p95 on \`/orders\` doubled after the 14:10 deploy.
- \`/search\` errors line up with the cache node restart.
- Nothing changed in \`/cart\`; it is slower only because it calls \`/orders\`.

**Ask:** find the regression before Thursday's release.
`;

const attachments = [
  asset({ attachmentId: "k04-latency-chart", contentType: "image/png", url: latencyChart, width: 720, height: 360 }),
  asset({ attachmentId: "k04-latency-csv", contentType: "text/csv", text: LATENCY_CSV }),
  asset({ attachmentId: "k04-incident-notes", contentType: "text/markdown", text: INCIDENT_NOTES }),
];

const withAttachments = thread({
  id: "k04-latency-attachments",
  project: "live",
  title: "Why did orders latency double?",
  scenario: { id: "K04", label: "Message with image, CSV and markdown attachments", waitForText: "N+1 query" },
  turns: [
    turn({
      at: "50m",
      took: "1m 10s",
      user: {
        text: "Latency on /orders doubled after yesterday's deploy. Chart, raw numbers and my notes attached.",
        extra: {
          attachments: [
            { type: "image", id: "k04-latency-chart", name: "latency-by-route.png", mimeType: "image/png", sizeBytes: 23_772 },
            { type: "file", id: "k04-latency-csv", name: "latency-by-route.csv", mimeType: "text/csv", sizeBytes: LATENCY_CSV.length },
            { type: "file", id: "k04-incident-notes", name: "incident-notes.md", mimeType: "text/markdown", sizeBytes: INCIDENT_NOTES.length },
          ],
        },
      },
      items: [
        reasoning("`/orders` p95 went from about 200 ms to 412 ms while `/orders/:id` stayed flat, so the list path is the suspect."),
        assistant(
          "The chart and the CSV agree: only the list endpoint regressed. `/orders` p95 is **412 ms** against 118 ms for `/orders/:id`, and `/cart` is slower only because it calls `/orders`.\n\nThe 14:10 deploy added `customer` to the list response, and the serializer loads it per row: an **N+1 query**. Batch-loading customers with one `IN (...)` query should bring p95 back near 200 ms.",
        ),
      ],
    }),
  ],
});

// K05: an image the agent viewed, and a screenshot a tool returned -----------------------------
// Her timeline lists a viewed image as a "Read" row and shows no picture for it; a tool's image
// output renders inline when the row is expanded. The asset answers both.


const viewedImagePath = `${workspaceRootOf("git")}/docs/screenshots/settings-dark.svg`;

const SCREENSHOT_ITEM = TurnItemId.make("k05-settings-screenshot");

const viewed = [
  asset({ path: "docs/screenshots/settings-dark.svg", contentType: "image/svg+xml", url: settingsDrawing, width: 640, height: 400 }),
  asset({ itemId: SCREENSHOT_ITEM, contentType: "image/png", url: settingsScreenshot, width: 640, height: 400 }),
  thread({
    id: "k05-viewed-screenshot",
    project: "git",
    title: "Save button is unreadable in dark mode",
    scenario: { id: "K05", label: "Viewed image and a screenshot tool output", waitForText: "contrast ratio" },
    turns: [
      turn({
        at: "35m",
        took: "48s",
        user: "QA says the Save button on the settings page is hard to read in dark mode. Screenshot is in docs/screenshots.",
        items: [
          item((base) => ({
            ...base,
            type: "dynamic_tool",
            toolName: "view_image",
            viewedImagePath,
            input: { path: viewedImagePath },
            output: { content: [{ type: "text", text: "Viewed image" }] },
          })),
          item((base) => ({
            ...base,
            id: SCREENSHOT_ITEM,
            type: "dynamic_tool",
            toolName: "mcp__t3-code__preview_snapshot",
            input: { url: "http://localhost:5173/settings", colorScheme: "dark" },
            output: { content: [{ type: "text", text: "Captured 640×400" }, { type: "image", mimeType: "image/png" }] },
          })),
          assistant(
            "I can see it: the disabled Save button uses `gray-600` text on `gray-800`, a contrast ratio of about 2.1:1. The enabled state is fine. I'll switch the disabled text to `gray-400` (4.6:1) in `src/settings/SaveBar.tsx`.",
          ),
        ],
      }),
    ],
  }),
];

// K06: an html_render page ----------------------------------------------------------------------

const BUNDLE_REPORT = `<!doctype html>
<html><head><meta charset="utf-8"><title>Bundle size by route</title>
<style>
  :root { color-scheme: light dark; --fg: #111827; --muted: #6b7280; --bar: #6366f1; --line: #e5e7eb; }
  @media (prefers-color-scheme: dark) { :root { --fg: #f3f4f6; --muted: #9ca3af; --bar: #818cf8; --line: #374151; } }
  body { margin: 0; padding: 16px 18px; font: 14px/1.45 ui-sans-serif, system-ui, sans-serif; color: var(--fg); background: transparent; }
  h1 { font-size: 15px; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 6px 0; border-top: 1px solid var(--line); vertical-align: middle; }
  td.name { font-family: ui-monospace, Menlo, monospace; font-size: 13px; width: 32%; }
  td.kb { text-align: right; width: 18%; color: var(--muted); font-variant-numeric: tabular-nums; }
  .bar { height: 10px; border-radius: 5px; background: var(--bar); }
  .up { color: #dc2626; } .down { color: #16a34a; }
  p { margin: 12px 0 0; color: var(--muted); font-size: 12.5px; }
</style></head>
<body>
  <h1>Bundle size by route (gzip)</h1>
  <table>
    <tr><td class="name">/dashboard</td><td><div class="bar" style="width:92%"></div></td><td class="kb">184 kB <span class="up">+41</span></td></tr>
    <tr><td class="name">/deploys</td><td><div class="bar" style="width:61%"></div></td><td class="kb">122 kB <span class="down">-3</span></td></tr>
    <tr><td class="name">/settings</td><td><div class="bar" style="width:38%"></div></td><td class="kb">76 kB</td></tr>
    <tr><td class="name">/billing</td><td><div class="bar" style="width:33%"></div></td><td class="kb">66 kB</td></tr>
  </table>
  <p>The +41 kB on /dashboard is the charting library, now imported eagerly.</p>
</body></html>`;

const htmlRender = [
  asset({ attachmentId: "k06-bundle-report", contentType: "text/html", text: BUNDLE_REPORT, serveAs: "html-render" }),
  thread({
    id: "k06-bundle-report",
    project: "git",
    title: "Which routes grew in the last release?",
    scenario: { id: "K06", label: "html_render page", waitForText: "lazy-load the chart" },
    turns: [
      turn({
        at: "1h 5m",
        took: "1m 30s",
        user: "Which routes got bigger in the last release? Show me.",
        items: [
          item((base) => ({
            ...base,
            type: "dynamic_tool",
            toolName: "mcp__t3-code__html_render",
            input: { title: "Bundle size by route", html: "(page)" },
            output: { htmlRender: { attachmentId: "k06-bundle-report", title: "Bundle size by route", height: 236 } },
          })),
          assistant("Only `/dashboard` grew: the charting library moved into the main chunk. I can lazy-load the chart panel to take the 41 kB back out."),
        ],
      }),
    ],
  }),
];

// K07: an MCP app frame ---------------------------------------------------------------------------

const PIPELINE_APP = `<!doctype html>
<html><head><meta charset="utf-8"><title>Pipeline</title>
<style>
  body { margin: 0; padding: 14px 16px; font: 13.5px/1.4 ui-sans-serif, system-ui, sans-serif; color: #111827; background: #ffffff; }
  body.dark { color: #e5e7eb; background: #111318; }
  h1 { font-size: 14px; margin: 0 0 2px; } .sub { color: #6b7280; font-size: 12px; margin-bottom: 12px; }
  ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; background: rgba(127,127,127,.08); }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .ok { background: #22c55e; } .run { background: #f59e0b; } .wait { background: #9ca3af; }
  .t { margin-left: auto; color: #6b7280; font-variant-numeric: tabular-nums; }
</style></head>
<body>
  <h1>orbit-dashboard · main · #2187</h1>
  <div class="sub">Triggered by a push 6 minutes ago</div>
  <ol>
    <li><span class="dot ok"></span>Install<span class="t">38s</span></li>
    <li><span class="dot ok"></span>Typecheck<span class="t">1m 12s</span></li>
    <li><span class="dot ok"></span>Unit tests<span class="t">2m 04s</span></li>
    <li><span class="dot run"></span>Browser tests<span class="t">running</span></li>
    <li><span class="dot wait"></span>Deploy preview<span class="t">queued</span></li>
  </ol>
  <script>
    if (new URLSearchParams(location.search).get("t3-color-scheme") === "dark") document.body.classList.add("dark");
  </script>
</body></html>`;

const MCP_APP = {
  attachmentId: "k07-pipeline-app",
  server: "ci-status",
  tool: "show_pipeline",
  resourceUri: "ui://ci-status/pipeline",
  prefersBorder: true,
};

const mcpApp = [
  asset({ attachmentId: MCP_APP.attachmentId, contentType: "text/html", text: PIPELINE_APP }),
  thread({
    id: "k07-pipeline-app",
    project: "git",
    title: "Is the main pipeline green yet?",
    scenario: { id: "K07", label: "MCP app frame", waitForText: "browser tests are still running" },
    turns: [
      turn({
        at: "6m",
        took: "12s",
        user: "Is the main pipeline green yet?",
        items: [
          item((base) => ({
            ...base,
            type: "dynamic_tool",
            toolName: `${MCP_APP.server}.${MCP_APP.tool}`,
            input: { branch: "main" },
            output: { t3McpApp: MCP_APP, result: { content: [{ type: "text", text: "Pipeline #2187: 3 passed, 1 running, 1 queued" }] } },
          })),
          assistant("Not yet: install, typecheck and unit tests passed, and the browser tests are still running. The preview deploy starts after them."),
        ],
      }),
    ],
  }),
];

export default [...attachments, withAttachments, ...viewed, ...htmlRender, ...mcpApp];
