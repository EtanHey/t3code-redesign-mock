// E01: a run that ends in a provider error, shown as the clean message in the timeline and the banner.
import { assistant, command, fileChange, thread, turn } from "../../api";
import { failureItem } from "./errors-kit";

// The item carries the provider's message already unwrapped from its JSON error body (the
// timeline prints `failure.message` as is): the request id lives in the details, not the text.
const PROVIDER_MESSAGE = "The server had an error while processing your request. Please try again later.";

export default thread({
  id: "e01-run-failed",
  project: "errors",
  title: "Run failed: the provider returned an error",
  scenario: { id: "E01", label: "Run failed with provider error", waitForText: "Run failed" },
  turns: [
    turn({
      at: "34m",
      took: "2m",
      user: "Invoice totals are off by a cent when a percentage discount is applied. Can you find out why?",
      items: [
        assistant("I'll start with the discount path and the tests around it.", { phase: "commentary" }),
        command({
          input: "rg -n \"applyDiscount\" src",
          output: "src/invoices/totals.ts:41:export function applyDiscount(amount: Money, rate: number): Money {\nsrc/invoices/totals.ts:88:  const discounted = applyDiscount(subtotal, invoice.discountRate);\nsrc/invoices/totals.test.ts:19:  it(\"applies a percentage discount\", () => {",
        }),
        fileChange({
          path: "src/invoices/totals.ts",
          additions: 4,
          deletions: 2,
          diff: "--- a/src/invoices/totals.ts\n+++ b/src/invoices/totals.ts\n@@ -41,5 +41,7 @@\n export function applyDiscount(amount: Money, rate: number): Money {\n-  const cents = Math.round(amount.cents * (1 - rate));\n-  return { ...amount, cents };\n+  // Round once, after the discount, so line items and the total agree.\n+  const exact = amount.cents * (1 - rate);\n+  return { ...amount, cents: Math.round(exact) };\n }\n",
        }),
        assistant("Rounding happened per line item and again on the total, so the two disagreed by a cent. I now round once, after the discount."),
      ],
    }),
    turn({
      at: "9m",
      took: "70s",
      status: "failed",
      user: "Now run the whole billing suite and fix anything the change broke.",
      items: [
        assistant("Running the full suite.", { phase: "commentary" }),
        command({
          input: "pnpm test --filter @relay/billing",
          output: "> @relay/billing@2.8.0 test\n> vitest run\n\n RUN  v3.2.4 /workspace/relay-billing\n\n ✓ src/invoices/totals.test.ts (14 tests) 41ms\n ✓ src/invoices/proration.test.ts (9 tests) 28ms\n ✓ src/ledger/entries.test.ts (22 tests) 63ms",
        }),
        failureItem({
          class: "provider_error",
          message: PROVIDER_MESSAGE,
          code: "upstream_unavailable",
          retryable: true,
        }),
      ],
    }),
  ],
});
