// Smoke run over a built dist/: opens every registered scenario, fails on an error boundary,
// an uncaught or console error (CSP violations included), any request attempt to another origin
// (sent, failed or blocked), or any WebSocket, and saves a screenshot per scenario to
// docs.local/shots/<scenario-id>.png; then scrolls each thread end to end so lazy images load
// too. The page is served under a made-up public hostname (mapped to the local server by
// Chromium's host resolver), never 127.0.0.1, so no localhost special case can hide a request.
// Then the interaction tests, at a phone viewport and at desktop width, typed and sent with
// Enter as a visitor would: send in an idle thread (working), send again (a queued tray row, not
// a steer bubble), Stop (idle), reload (still there), and a pasted URL asks no one; and,
// at a phone viewport and at desktop width, answer K03 (no empty bubble, the answer reads as its
// label), Stop and Resume it, and take every approval path on Q01 and Q04, each in a fresh context.
//
// Every scenario gets a fresh browser context (no layout, panel or terminal state carried over
// from the one before), and a few run at once.
//
// Usage: node scripts/smoke.mjs [distDir] [--only K01,K02] [--jobs 4]
//   --only (or env SMOKE_ONLY) runs just those scenarios and skips the interaction test unless
//   the list names `interaction`.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { serve } from "./lib/serve.mjs";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const [value] = args.splice(index, 2).slice(1);
  return value;
};
const onlyArg = option("--only") ?? process.env.SMOKE_ONLY;
const jobs = Math.max(1, Number(option("--jobs") ?? process.env.SMOKE_JOBS ?? 4));
const dist = resolve(root, args[0] ?? "dist");
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

// A made-up name under a public suffix: the app treats loopback and private names specially
// (her favicon code skips them), and the live site is neither.
const SMOKE_HOST = process.env.SMOKE_HOST ?? "redesign-mock-smoke.net";
const { server, origin: localOrigin } = await serve(dist);
const origin = `http://${SMOKE_HOST}:${new URL(localOrigin).port}`;
const browser = await chromium.launch({
  args: [
    `--host-resolver-rules=MAP ${SMOKE_HOST} 127.0.0.1, MAP * ~NOTFOUND`,
    // Plain http on a non-loopback name is not a secure context; the live site (https) is.
    `--unsafely-treat-insecure-origin-as-secure=${origin}`,
  ],
});

// Listeners report against whatever that page is doing now.
function watch(page, initial) {
  let current = initial;
  const label = () => current;
  const elsewhere = (request) => {
    const url = new URL(request.url());
    return url.protocol !== "data:" && url.protocol !== "blob:" && url.origin !== origin;
  };
  // An attempt counts even when the CSP or the resolver stops it before it leaves.
  page.on("request", (request) => {
    if (elsewhere(request)) fail(`${label()}: request to another origin: ${request.url()}`);
  });
  page.on("requestfailed", (request) => {
    if (elsewhere(request)) fail(`${label()}: request to another origin failed (${request.failure()?.errorText}): ${request.url()}`);
  });
  void page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) =>
      console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`),
    );
  });
  page.on("websocket", (socket) => fail(`${label()}: WebSocket opened: ${socket.url()}`));
  page.on("pageerror", (error) => fail(`${label()}: uncaught error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") fail(`${label()}: console error: ${message.text().slice(0, 300)}`);
  });
  return (next) => {
    current = next;
  };
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

/** Scrolls every scrolled box from its top to its end, so lazily loaded images load. */
async function scrollThrough(page) {
  await page
    .evaluate(async () => {
      const pause = () => new Promise((done) => setTimeout(done, 60));
      const boxes = [...document.querySelectorAll("*")].filter((element) => {
        const style = getComputedStyle(element);
        return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 40;
      });
      for (const box of boxes) {
        const end = box.scrollTop;
        for (let top = 0; top < box.scrollHeight; top += Math.max(200, box.clientHeight * 0.8)) {
          box.scrollTop = top;
          await pause();
        }
        box.scrollTop = end;
      }
    })
    .catch(() => {});
  await page.waitForTimeout(400);
}

// Scenarios -----------------------------------------------------------------------------------

const SCENARIO_VIEW = { viewport: { width: 1440, height: 900 }, colorScheme: "dark" };
const bootContext = await browser.newContext(SCENARIO_VIEW);
const page = await bootContext.newPage();
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
await bootContext.close();
const only = onlyArg?.split(",").map((value) => value.trim()).filter(Boolean);
if (only?.length) {
  const unknown = only.filter((id) => id !== "interaction" && !scenarios.some((scenario) => scenario.id === id));
  if (unknown.length) fail(`--only names unknown scenarios: ${unknown.join(", ")}`);
  scenarios = scenarios.filter((scenario) => only.includes(scenario.id));
}
const runInteraction = !only?.length || only.includes("interaction");
const started = Date.now();
console.log(`smoke: ${scenarios.length} scenarios at ${origin}, ${jobs} at a time, each in a fresh context`);

async function runScenario(scenario) {
  const label = `${scenario.id} (${scenario.source})`;
  const before = failures.length;
  const context = await browser.newContext(SCENARIO_VIEW);
  const scenarioPage = await context.newPage();
  watch(scenarioPage, label);
  try {
    await scenarioPage.goto(origin + scenario.path);
    await scenarioPage.waitForFunction(() => window.__MOCK__ !== undefined, null, { timeout: 30_000 });
    if (scenario.waitForText) {
      await scenarioPage.getByText(scenario.waitForText, { exact: false }).first().waitFor({ timeout: 15_000 });
    }
    await scenarioPage.waitForTimeout(1_200);
  } catch (error) {
    fail(`${label}: did not render${scenario.waitForText ? ` "${scenario.waitForText}"` : ""}: ${error.message.split("\n")[0]}`);
  }
  await scenarioPage.screenshot({ path: resolve(shots, `${scenario.id}.png`) });
  await scrollThrough(scenarioPage);
  await checkPage(scenarioPage, label);
  await context.close();
  if (failures.length === before) console.log(`  ✓ ${scenario.id} ${scenario.label}`);
}

const queue = [...scenarios];
await Promise.all(
  Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length > 0) await runScenario(queue.shift());
  }),
);
console.log(`smoke: scenarios took ${Math.round((Date.now() - started) / 1000)}s`);

// Interaction ---------------------------------------------------------------------------------

const VIEWS = [
  { name: "phone", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: "desktop", viewport: { width: 1440, height: 900 } },
];

async function interaction(view) {
  console.log(`smoke: interaction ${view.name} (send, queue, stop, reload, paste a URL)`);
  const context = await browser.newContext({ ...view, colorScheme: "light" });
  const live = await context.newPage();
  const label = `interaction ${view.name}`;
  watch(live, label);
  const first = `Smoke check ${Date.now()}`;
  const second = `Then queue this ${Date.now()}`;
  const step = async (name, body) => {
    try {
      await body();
      console.log(`  ✓ ${view.name}: ${name}`);
    } catch (error) {
      fail(`${label}: ${name}: ${error.message.split("\n")[0]}`);
      await live.screenshot({ path: resolve(shots, `interaction-${view.name}-failed.png`) }).catch(() => {});
    }
  };
  const stop = live.getByRole("button", { name: "Stop generation" });
  // What a visitor does: tap into the composer (a phone shows it collapsed), type, press Enter.
  const type = async (text) => {
    const expand = live.getByRole("button", { name: "Expand composer" });
    if (await expand.isVisible()) await (view.hasTouch ? expand.tap() : expand.click());
    await live.locator('[contenteditable="true"]').last().click();
    await live.keyboard.type(text);
  };
  const queuedRow = (text) => live.locator(".group\\/queued", { hasText: text });
  const bubble = (text) => live.locator("[data-user-message-bubble]", { hasText: text });

  await step("open an idle thread", async () => {
    await live.goto(origin + IDLE_THREAD);
    await live.getByText("180 ms", { exact: false }).first().waitFor({ timeout: 20_000 });
    if (await stop.isVisible()) throw new Error("the idle thread already shows Stop");
  });
  await step("send: the message appears and the thread goes to working", async () => {
    await type(first);
    await live.keyboard.press("Enter");
    await bubble(first).first().waitFor({ timeout: 10_000 });
    await stop.waitFor({ state: "visible", timeout: 10_000 });
    await live.getByText("Working for", { exact: false }).first().waitFor({ timeout: 10_000 });
  });
  await step("send again with Enter: the second message is queued, not steered", async () => {
    await type(second);
    const send = live.getByRole("button", { name: "Queue message" });
    if (!(await send.isVisible())) throw new Error("the busy composer's send button is not \"Queue message\"");
    await live.keyboard.press("Enter");
    await queuedRow(second).first().waitFor({ timeout: 10_000 });
    await live.waitForTimeout(800);
    if (await bubble(second).count()) throw new Error("the second message became a history bubble (steered)");
    if (!(await stop.isVisible())) throw new Error("queueing stopped the run");
  });
  await live.screenshot({ path: resolve(shots, `interaction-${view.name}-queued.png`) });
  await step("stop: the thread goes idle", async () => {
    await (view.hasTouch ? stop.tap() : stop.click());
    await stop.waitFor({ state: "hidden", timeout: 10_000 });
    await live.getByText("Stopped", { exact: false }).first().waitFor({ timeout: 10_000 });
  });
  await live.screenshot({ path: resolve(shots, `interaction-${view.name}.png`) });
  await step("reload: both messages are still there", async () => {
    await live.reload();
    await live.getByText(first).first().waitFor({ timeout: 20_000 });
    await live.getByText(second).first().waitFor({ timeout: 10_000 });
  });
  await step("send pasted URLs: no request to their hosts", async () => {
    const urls = "See https://docs.example-vendor.com/guide and https://github.com/sample-labs/orbit-dashboard and " + origin + "/design-system";
    await type(urls);
    await live.keyboard.press("Enter");
    await bubble("docs.example-vendor.com").first().waitFor({ timeout: 10_000 });
    await scrollThrough(live);
  });
  if (view.name === "desktop") {
    await step("a new thread: send, then Enter again queues", async () => {
      await live.getByRole("button", { name: "New thread", exact: true }).first().click();
      const opener = `New thread ${Date.now()}`;
      const follow = `New thread follow-up ${Date.now()}`;
      await type(opener);
      await live.keyboard.press("Enter");
      await stop.waitFor({ state: "visible", timeout: 15_000 });
      await type(follow);
      await live.keyboard.press("Enter");
      await queuedRow(follow).first().waitFor({ timeout: 10_000 });
      if (await bubble(follow).count()) throw new Error("the follow-up became a history bubble (steered)");
    });
  }
  await checkPage(live, label);
  await context.close();
}

if (runInteraction) for (const view of VIEWS) await interaction(view);

// Requests: answering, approving and resuming, at a phone viewport and at desktop width --------

// A user bubble with no text and no image: what a request answer or a resume must never leave.
const emptyBubbles = (page) =>
  page.locator("[data-user-message-bubble]").evaluateAll((bubbles) =>
    bubbles.filter((bubble) => {
      const body = bubble.querySelector("[data-user-message-body]");
      return !(body?.textContent ?? "").trim() && !bubble.querySelector("img");
    }).length,
  );

async function requestCase(view, name, path, waitFor, body) {
  const context = await browser.newContext({ ...view, colorScheme: "dark" });
  const page = await context.newPage();
  const label = `requests ${view.name}: ${name}`;
  watch(page, label);
  const press = (locator) => (view.hasTouch ? locator.tap() : locator.click());
  try {
    await page.goto(origin + path);
    await page.getByText(waitFor, { exact: false }).first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(600);
    await body(page, press);
    await checkPage(page, label);
    console.log(`  ✓ ${label}`);
  } catch (error) {
    fail(`${label}: ${error.message.split("\n")[0]}`);
    await page.screenshot({ path: resolve(shots, `requests-${view.name}-${name.replace(/\W+/g, "-")}-failed.png`) }).catch(() => {});
  }
  await context.close();
}

const need = (what, locator) =>
  locator.waitFor({ timeout: 10_000 }).catch(() => {
    throw new Error(`expected ${what}`);
  });

const pendingCount = (page, threadId) =>
  page.evaluate(
    (id) => window.__MOCK__.runtime.primary.server.projection(id).runtimeRequests.filter((request) => request.status === "pending").length,
    threadId,
  );
const lastDecision = (page, threadId) =>
  page.evaluate(
    (id) => window.__MOCK__.runtime.primary.server.projection(id).runtimeRequests.at(-1)?.decision ?? null,
    threadId,
  );
const runStatus = (page, threadId) =>
  page.evaluate((id) => window.__MOCK__.runtime.primary.server.projection(id).runs.at(-1)?.status ?? null, threadId);

async function expectResolved(page, threadId, decision, status) {
  await page.waitForFunction((id) => window.__MOCK__.runtime.primary.server.projection(id).runtimeRequests.every((r) => r.status !== "pending"), threadId, { timeout: 10_000 });
  await page.getByText("Waiting for approval").first().waitFor({ state: "hidden", timeout: 10_000 });
  if ((await lastDecision(page, threadId)) !== decision) throw new Error(`decision was ${await lastDecision(page, threadId)}, not ${decision}`);
  const run = await runStatus(page, threadId);
  if (!status.includes(run)) throw new Error(`the run is ${run}, not ${status.join(" or ")}`);
}

if (runInteraction) {
  console.log("smoke: requests (answer, approve, more options, resume) at phone and desktop width");
  const K03 = "k03-settings-migration";
  const Q01 = "q01-approval";
  const Q04 = "q04-approval";
  for (const view of VIEWS) {
    await requestCase(view, "answer K03, then stop and resume", `/redesign-preview/${K03}`, "How should existing rows move", async (page, press) => {
      if (view.name === "phone") await page.screenshot({ path: resolve(shots, "K03-phone-before.png") });
      await press(page.getByText("Backfill in batches").first());
      // The answered row reads the question and the chosen option, not the option's raw value.
      await need("the run picks up", page.getByText("Picking up from your answer").first());
      await need("the answered row shows the chosen label", page.locator('text="Backfill in batches" >> visible=true').first());
      if (await page.getByText("batched", { exact: true }).count()) throw new Error("the answered row shows the raw option value");
      if ((await emptyBubbles(page)) > 0) throw new Error("an empty user bubble appeared after answering");
      if (view.name === "phone") await page.screenshot({ path: resolve(shots, "K03-phone-after.png") });
      await press(page.getByRole("button", { name: "Stop generation" }));
      await need("the stopped row", page.getByText("You stopped after", { exact: false }).first());
      // The composer swaps Stop for Resume as the stop settles; a press during the swap is dropped.
      await page.waitForTimeout(1_500);
      await press(page.getByRole("button", { name: "Resume thread" }));
      await need("a Resumed thread row", page.getByText("Resumed thread").first()).catch(async (error) => {
        const log = await page.evaluate(() => localStorage.getItem("t3code-redesign-mock:visitor-log"));
        console.log(JSON.parse(log).entries.map((entry) => JSON.stringify(entry.command ?? entry).slice(0, 300)).join("\n"));
        throw error;
      });
      await need("the thread works again", page.getByRole("button", { name: "Stop generation" }));
      if ((await emptyBubbles(page)) > 0) throw new Error("Resume thread left an empty user bubble");
    });
    await requestCase(view, "Q01 always allow this session, then approve", `/redesign-preview/${Q01}`, "Command approval", async (page, press) => {
      const always = page.getByRole("button", { name: "Always allow this session" });
      await press(always);
      // Upstream's control is a toggle: it changes what Approve sends and resolves nothing alone.
      if ((await always.getAttribute("aria-pressed")) !== "true") throw new Error("the toggle did not turn on");
      if ((await pendingCount(page, Q01)) !== 1) throw new Error("the toggle alone resolved the request");
      await press(page.getByRole("button", { name: /^Approve/ }));
      await expectResolved(page, Q01, "acceptForSession", ["running"]);
      await page.getByText("Working for", { exact: false }).first().waitFor({ timeout: 10_000 });
    });
    await requestCase(view, "Q01 decline", `/redesign-preview/${Q01}`, "Command approval", async (page, press) => {
      await press(page.getByRole("button", { name: "Decline", exact: true }));
      await expectResolved(page, Q01, "decline", ["running"]);
    });
    await requestCase(view, "Q01 more: cancel", `/redesign-preview/${Q01}`, "Command approval", async (page, press) => {
      await press(page.getByRole("button", { name: "More approval options" }));
      await press(page.getByRole("menuitem", { name: "Cancel" }));
      await expectResolved(page, Q01, "cancel", ["interrupted"]);
      await page.getByRole("button", { name: "Stop generation" }).waitFor({ state: "hidden", timeout: 10_000 });
    });
    await requestCase(view, "Q04 more: always allow", `/redesign-preview/${Q04}`, "Allow network access", async (page, press) => {
      await press(page.getByRole("button", { name: "More approval options" }));
      await press(page.getByRole("menuitem", { name: "Always allow" }));
      await expectResolved(page, Q04, "acceptAlways", ["running"]);
    });
    await requestCase(view, "Q04 allow for this session", `/redesign-preview/${Q04}`, "Allow network access", async (page, press) => {
      await press(page.getByRole("button", { name: "Allow for this session" }));
      await press(page.getByRole("button", { name: /^Allow once/ }));
      await expectResolved(page, Q04, "acceptForSession", ["running"]);
    });
  }
}

await browser.close();
server.close();

if (failures.length > 0) {
  console.log(`smoke: FAILED (${failures.length})`);
  process.exit(1);
}
console.log(`smoke: passed (${scenarios.length} scenarios${runInteraction ? " + interaction" : ""}, 0 requests to other origins, 0 WebSockets)`);
