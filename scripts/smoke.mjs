// Smoke run over a built dist/: opens every registered scenario, fails on an error boundary,
// an uncaught or console error, any request to another origin, or any WebSocket, and saves a
// screenshot per scenario to docs.local/shots/<scenario-id>.png. Then one interaction test:
// send in an idle thread (working), send again (queued), Stop (idle), reload (still there).
//
// Usage: node scripts/smoke.mjs [distDir]   (env SMOKE_ONLY=K01,K02 limits the scenarios)
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { serve } from "./lib/serve.mjs";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, process.argv[2] ?? "dist");
const shots = resolve(root, "docs.local/shots");
mkdirSync(shots, { recursive: true });

// The Playwright upstream's browser tests already install; nothing new is added.
const require = createRequire(resolve(root, "upstream/apps/web/package.json"));
const { chromium } = require("playwright");

const ERROR_TEXTS = ["Something went wrong.", "T3 Code failed to start"];
const IDLE_THREAD = "/redesign-preview/k01-debounce-search";
const failures = [];
const fail = (message) => {
  failures.push(message);
  console.log(`  ✗ ${message}`);
};

const { server, origin } = await serve(dist);
const browser = await chromium.launch();

// Listeners report against whatever the page is doing now.
let current = "boot";
function watch(page, initial) {
  current = initial;
  const label = () => current;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    if (url.origin !== origin) fail(`${label()}: request to another origin: ${request.url()}`);
  });
  page.on("websocket", (socket) => fail(`${label()}: WebSocket opened: ${socket.url()}`));
  page.on("pageerror", (error) => fail(`${label()}: uncaught error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") fail(`${label()}: console error: ${message.text().slice(0, 300)}`);
  });
}

async function checkPage(page, label) {
  for (const text of ERROR_TEXTS) {
    if (await page.getByText(text, { exact: false }).first().isVisible().catch(() => false)) {
      fail(`${label}: shows "${text}"`);
    }
  }
  const mock = await page.evaluate(() => ({
    blocked: window.__MOCK__?.blocked() ?? [],
    replayFailures: window.__MOCK__?.runtime.replayFailures ?? [],
  }));
  for (const request of mock.blocked) fail(`${label}: the network guard blocked ${request.kind} ${request.url}`);
  for (const message of mock.replayFailures) fail(`${label}: saved action did not replay: ${message}`);
}

// Scenarios -----------------------------------------------------------------------------------

const scenarioContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const page = await scenarioContext.newPage();
watch(page, "boot");
await page.goto(origin + "/");
try {
  await page.waitForFunction(() => window.__MOCK__ !== undefined, null, { timeout: 30_000 });
} catch {
  fail("boot: the mock never came up (see the errors above)");
  await page.screenshot({ path: resolve(shots, "boot-failed.png") }).catch(() => {});
  await browser.close();
  server.close();
  console.log(`smoke: FAILED (${failures.length})`);
  process.exit(1);
}
let scenarios = await page.evaluate(() => window.__MOCK__.scenarios());
const only = process.env.SMOKE_ONLY?.split(",").map((value) => value.trim()).filter(Boolean);
if (only?.length) scenarios = scenarios.filter((scenario) => only.includes(scenario.id));
console.log(`smoke: ${scenarios.length} scenarios at ${origin}`);

for (const scenario of scenarios) {
  const label = `${scenario.id} (${scenario.source})`;
  current = label;
  const before = failures.length;
  await page.goto(origin + scenario.path);
  try {
    await page.waitForFunction(() => window.__MOCK__ !== undefined, null, { timeout: 30_000 });
    if (scenario.waitForText) {
      await page.getByText(scenario.waitForText, { exact: false }).first().waitFor({ timeout: 15_000 });
    }
    await page.waitForTimeout(1_200);
  } catch (error) {
    fail(`${label}: did not render${scenario.waitForText ? ` "${scenario.waitForText}"` : ""}: ${error.message.split("\n")[0]}`);
  }
  await checkPage(page, label);
  await page.screenshot({ path: resolve(shots, `${scenario.id}.png`) });
  if (failures.length === before) console.log(`  ✓ ${scenario.id} ${scenario.label}`);
}
await scenarioContext.close();

// Interaction ---------------------------------------------------------------------------------

console.log("smoke: interaction (send, queue, stop, reload)");
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const live = await context.newPage();
watch(live, "interaction");
const first = `Smoke check ${Date.now()}`;
const second = `Then queue this ${Date.now()}`;
const step = async (name, body) => {
  try {
    await body();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    fail(`interaction: ${name}: ${error.message.split("\n")[0]}`);
    await live.screenshot({ path: resolve(shots, `interaction-failed.png`) }).catch(() => {});
  }
};
const composer = live.locator('[contenteditable="true"]').last();
const stop = live.getByRole("button", { name: "Stop generation" });

await step("open an idle thread", async () => {
  await live.goto(origin + IDLE_THREAD);
  await live.getByText("180 ms", { exact: false }).first().waitFor({ timeout: 20_000 });
  if (await stop.isVisible()) throw new Error("the idle thread already shows Stop");
});
await step("send: the message appears and the thread goes to working", async () => {
  await composer.click();
  await live.keyboard.type(first);
  await live.keyboard.press("Enter");
  await live.getByText(first).first().waitFor({ timeout: 10_000 });
  await stop.waitFor({ state: "visible", timeout: 10_000 });
  await live.getByText("Working for", { exact: false }).first().waitFor({ timeout: 10_000 });
});
await step("send again: the second message is queued", async () => {
  await composer.click();
  await live.keyboard.type(second);
  await live.keyboard.press("Enter");
  await live.getByText(second).first().waitFor({ timeout: 10_000 });
  if (!(await stop.isVisible())) throw new Error("queueing stopped the run");
});
await step("stop: the thread goes idle", async () => {
  await stop.click();
  await stop.waitFor({ state: "hidden", timeout: 10_000 });
  await live.getByText("Stopped", { exact: false }).first().waitFor({ timeout: 10_000 });
});
await live.screenshot({ path: resolve(shots, "interaction.png") });
await step("reload: both messages are still there", async () => {
  await live.reload();
  await live.getByText(first).first().waitFor({ timeout: 20_000 });
  await live.getByText(second).first().waitFor({ timeout: 10_000 });
});
await checkPage(live, "interaction");
await context.close();

await browser.close();
server.close();

if (failures.length > 0) {
  console.log(`smoke: FAILED (${failures.length})`);
  process.exit(1);
}
console.log(`smoke: passed (${scenarios.length} scenarios, 0 requests to other origins, 0 WebSockets)`);
