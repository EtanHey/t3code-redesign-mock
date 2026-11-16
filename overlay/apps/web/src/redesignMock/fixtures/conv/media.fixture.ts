import { ComposerContextId, TurnItemId, type MentionContextRecord } from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { assistant, asset, command, item, thread, turn } from "../../api";
import { openDemoWork } from "./open-state";
import chart from "./assets/search-latency.png";

openDemoWork("c10-search-chart", { itemIds: ["c10-search-chart-item-1", "c10-search-chart-output"] });

const csv = `time,before_p95_ms,indexed_p95_ms
09:00,171,76
09:10,183,68
09:20,191,64
09:30,182,63
09:40,189,62
09:50,184,58
`;
const context = [
  { version: 1, kind: "mention", contextId: ComposerContextId.make("c03-search"), label: "search.ts", path: "/workspace/papertrail/src/search.ts" },
  { version: 1, kind: "mention", contextId: ComposerContextId.make("c03-bench"), label: "search.bench.ts", path: "/workspace/papertrail/bench/search.bench.ts" },
] satisfies MentionContextRecord[];

const attached = thread({
  id: "c03-search-attachments", project: "conversation", title: "Compare search benchmarks: image, CSV and source context",
  scenario: { id: "C03", label: "Image and file attachments with context chips", waitForText: "The indexed path is consistently faster" },
  turns: [turn({ at: "3h 45m", took: "48s", user: {
    text: `Here are the before/after measurements for the shared handbook. Is the improvement consistent? Check ${context.map(formatComposerContextReference).join(" and ")} against the attached chart and CSV.`,
    extra: { context: { version: 1, records: context }, attachments: [
      { type: "image", id: "c03-chart", name: "search-latency.png", mimeType: "image/png", sizeBytes: 28340 },
      { type: "file", id: "c03-csv", name: "search-benchmark.csv", mimeType: "text/csv", sizeBytes: csv.length },
    ] },
  }, items: [assistant("The indexed path is consistently faster across all six samples in the CSV. At 09:50, p95 drops from **184 ms to 58 ms**, a 68% reduction.\n\nThe chart covers a single 12,800-note dataset. Before changing the default, repeat the benchmark on the imported archive and measure index memory as well.")] })],
});

const chartItem = TurnItemId.make("c10-search-chart-output");
const image = thread({
  id: "c10-search-chart", project: "conversation", title: "Tool image: compare search latency before and after indexing",
  scenario: { id: "C10", label: "Zoomable chart returned by a tool", waitForText: "The chart shows a sustained reduction" },
  turns: [turn({ at: "35m", took: "55s", user: "Plot the benchmark samples as an image so I can compare the two paths.", items: [
    command({ input: "python bench/plot_search.py --metric p95 --output search-latency.png", output: "Read 12 samples per series. Wrote search-latency.png (1000×500)." }),
    item(base => ({ ...base, id: chartItem, type: "dynamic_tool", toolName: "render_benchmark_chart",
      input: { path: "/workspace/papertrail/bench/search-benchmark.csv", metric: "p95_ms" },
      output: { content: [{ type: "text", text: "Search benchmark: 12 samples per series, 1000×500 PNG" }, { type: "image", mimeType: "image/png" }] } })),
    assistant("The chart shows a sustained reduction, rather than a single fast sample: the indexed series stays between **57 and 76 ms**, while the old path stays between **166 and 192 ms**. Open the image to inspect the samples at full size."),
  ] })],
});

const dashboard = `<!doctype html><html><head><meta charset="utf-8"><title>Papertrail search report</title><style>
:root{color-scheme:dark light}*{box-sizing:border-box}body{margin:0;padding:20px;font:14px/1.5 system-ui;background:#10252b;color:#e4f2ec}header{display:flex;justify-content:space-between;align-items:center}small,p{color:#a7c2bc}h1{font-size:20px;margin:0}small{font-size:11px;letter-spacing:2px}section{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0}article{border:1px solid #32545a;border-radius:10px;padding:12px}strong{display:block;font-size:27px;color:#7ee2c1}table{width:100%;border-collapse:collapse}td,th{text-align:left;border-bottom:1px solid #32545a;padding:7px}th{font-size:11px;color:#a7c2bc;text-transform:uppercase}.bar{height:8px;background:#7ee2c1;border-radius:6px}button{background:#7ee2c1;color:#10252b;border:0;border-radius:6px;padding:7px 12px;cursor:pointer}footer{display:flex;justify-content:space-between;align-items:center;margin-top:14px}#detail{display:none}</style></head><body>
<header><div><small>PAPERTRAIL / ENGINEERING NOTEBOOK</small><h1>Search release · benchmark report</h1></div><span>Local dataset</span></header>
<section><article><small>p95 latency</small><strong>58 ms</strong>down from 184 ms</article><article><small>Notes indexed</small><strong>12,800</strong>shared handbook</article><article><small>Index size</small><strong>14.6 MiB</strong>archive review pending</article></section>
<table><thead><tr><th>Dataset</th><th>Budget used (100 ms)</th><th>p95</th></tr></thead><tbody><tr><td>Personal notebook</td><td><div class="bar" style="width:5%"></div></td><td>4.8 ms</td></tr><tr><td>Shared handbook</td><td><div class="bar" style="width:58%"></div></td><td>58 ms</td></tr><tr><td>Imported archive</td><td><div class="bar" style="width:73%"></div></td><td>72.9 ms</td></tr></tbody></table>
<footer><span>Handbook budget met · archive memory gate open</span><button onclick="document.querySelector('#detail').style.display='block';this.textContent='Method shown'">Show method</button></footer><p id="detail">Warm index, 12 query samples, same note corpus. Measurements describe this fixture dataset.</p></body></html>`;
const report = thread({
  id: "c11-sent-message", project: "conversation", title: "Rendered search dashboard and a message sent during the run",
  scenario: { id: "C11", label: "html_render dashboard and send_to_user", waitForText: "The search report is ready for review" },
  turns: [turn({ at: "30m", took: "1m 12s", user: "Make a small search benchmark dashboard and send me a note when it is ready.", items: [
    item(base => ({ ...base, type: "dynamic_tool", toolName: "mcp__t3-code__html_render", input: { title: "Search release report", html: "(bundled dashboard)" }, output: { htmlRender: { attachmentId: "c11-search-report", title: "Search release report", height: 408 } } })),
    item(base => ({ ...base, type: "dynamic_tool", toolName: "send_to_user", input: { message: "The search report is ready for review. The handbook meets its latency budget; the archive still needs a memory check." }, output: { sentMessage: "The search report is ready for review. The handbook meets its latency budget; the archive still needs a memory check." } })),
    assistant("The dashboard compares all three datasets. Use **Show method** for the benchmark setup. I left the archive memory gate visible so the report does not imply that every release check is complete."),
  ] })],
});

const appPage = `<!doctype html><html><head><meta charset="utf-8"><title>Index inspector</title><style>body{margin:0;background:#f4f6fb;color:#172338;font:14px/1.5 system-ui;padding:18px}body.dark{background:#151d2c;color:#e2eaf7}header{display:flex;justify-content:space-between;align-items:center}h1{margin:0;font-size:18px}.tag{background:#23624d;color:#bdf6dc;border-radius:20px;padding:3px 10px;font-size:12px}p{color:#8a9bb3;margin:3px 0 14px}label{display:block;font-size:12px;margin-top:12px}input{width:90%;background:transparent;color:inherit;border:1px solid #6d7f99;border-radius:6px;padding:8px;margin:5px 0}table{border-collapse:collapse;width:100%}td,th{padding:8px;border-bottom:1px solid #53637a;text-align:left;font-size:13px}.score{color:#68cdb0}footer{margin-top:14px;color:#8a9bb3;font-size:12px}</style></head><body><header><h1>Papertrail · index inspector</h1><span class="tag">Index current</span></header><p>shared-handbook · 12,800 notes · revision 47</p><label>Filter sample results<input id="query" value="release" aria-label="Filter sample results"></label><table><thead><tr><th>Note</th><th>Matched field</th><th>Score</th></tr></thead><tbody><tr><td>Release checklist</td><td>title + body</td><td class="score">4</td></tr><tr><td>Release rollback notes</td><td>title</td><td class="score">3</td></tr><tr><td>Search tuning journal</td><td>body</td><td class="score">1</td></tr></tbody></table><footer id="count">3 sample results · no remote requests</footer><script>if(new URLSearchParams(location.search).get('t3-color-scheme')==='dark')document.body.classList.add('dark');document.querySelector('input').addEventListener('input',e=>{let n=0;document.querySelectorAll('tbody tr').forEach(row=>{row.hidden=!row.textContent.toLowerCase().includes(e.target.value.toLowerCase());if(!row.hidden)n++});document.querySelector('#count').textContent=n+' sample results · no remote requests'})</script></body></html>`;
const app = { attachmentId: "c12-index-inspector", server: "note-index", tool: "inspect_index", resourceUri: "ui://note-index/inspector", prefersBorder: true };
const mcp = thread({
  id: "c12-index-inspector", project: "conversation", title: "MCP app: inspect and filter sample index matches",
  scenario: { id: "C12", label: "Interactive MCP app frame", waitForText: "The index is current at revision 47" },
  turns: [turn({ at: "20m", took: "32s", user: "Open the index inspector for the shared handbook. Show why release notes rank above body-only matches.", items: [
    item(base => ({ ...base, type: "dynamic_tool", toolName: `${app.server}.${app.tool}`, input: { collection: "shared-handbook", query: "release" }, output: { t3McpApp: app, result: { content: [{ type: "text", text: "Index current: revision 47, 12,800 notes, 3 sample matches" }] } } })),
    assistant("The index is current at revision 47. A title hit is worth three points and a body hit one, so **Release checklist** ranks first with four. The embedded inspector filters the three sample rows locally."),
  ] })],
});

export default [
  asset({ attachmentId: "c03-chart", contentType: "image/png", url: chart, width: 1000, height: 500 }),
  asset({ attachmentId: "c03-csv", contentType: "text/csv", text: csv }),
  asset({ itemId: chartItem, contentType: "image/png", url: chart, width: 1000, height: 500 }),
  asset({ attachmentId: "c11-search-report", contentType: "text/html", text: dashboard, serveAs: "html-render" }),
  asset({ attachmentId: app.attachmentId, contentType: "text/html", text: appPage }),
  attached, image, report, mcp,
];
