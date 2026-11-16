// L04 and L05: file-change tool rows (single file, several files, rename, new file, deleted
// file, each with a diff) and file and web search rows with results.
import { assistant, command, fileChange, item, reasoning, script, thread, turn } from "../../api";
import { streamParagraphs } from "./live-kit";

const EDIT_DIFF = `@@ -8,11 +8,15 @@ export async function listShipments(db: Database, filter: ShipmentFilter) {
-  const rows = await db.query("select * from shipments");
-  return rows.filter((row) => matches(row, filter));
+  const rows = await db.query(
+    "select * from shipments where status = $1 and created_at >= $2 order by created_at desc limit $3",
+    [filter.status, filter.since, filter.limit ?? 50],
+  );
+  return rows;
 }
`;

const MULTI_A = `@@ -1,6 +1,7 @@
 import { z } from "zod";
+import { Money } from "../lib/money";

 export const InvoiceLine = z.object({
   sku: z.string(),
-  amount: z.number(),
+  amount: Money,
 });
`;

const MULTI_B = `@@ -14,7 +14,7 @@ export function total(lines: InvoiceLine[]): number {
-  return lines.reduce((sum, line) => sum + line.amount, 0);
+  return lines.reduce((sum, line) => sum + line.amount.cents, 0);
 }
`;

const MULTI_C = `@@ -3,4 +3,4 @@ describe("total", () => {
-  expect(total([{ sku: "a", amount: 5 }])).toBe(5);
+  expect(total([{ sku: "a", amount: { cents: 500 } }])).toBe(500);
 });
`;

const NEW_FILE = `export type Money = { readonly cents: number };

export function formatMoney(value: Money): string {
  return \`$\${(value.cents / 100).toFixed(2)}\`;
}
`;

const DELETED_FILE = `export function legacyFormat(amount: number): string {
  return "$" + amount.toFixed(2);
}

export function legacyParse(text: string): number {
  return Number(text.replace("$", ""));
}
`;

const fileChanges = thread({
  id: "l04-file-changes",
  project: "live",
  title: "File changes: edit, several files, new, rename, delete",
  scenario: { id: "L04", label: "File change rows", waitForText: "Switch invoice amounts" },
  turns: [
    turn({
      at: "50m",
      took: "1m",
      user: "Make the shipments query filter in SQL instead of in memory.",
      items: [
        reasoning("The handler loads every row and filters in the process; the filter belongs in the query."),
        fileChange({ path: "src/shipments/list.ts", additions: 7, deletions: 3, diff: EDIT_DIFF }),
        assistant("`listShipments` now filters, orders and limits in SQL, so a request no longer loads the whole table."),
      ],
    }),
    turn({
      at: "3m",
      status: "running",
      user: "Switch invoice amounts to the Money type everywhere, put the helpers in their own module and drop the legacy ones.",
      items: [
        fileChange({ path: "src/billing/invoice.ts", additions: 2, deletions: 1, diff: MULTI_A }),
        fileChange({ path: "src/billing/total.ts", additions: 1, deletions: 1, diff: MULTI_B }),
        fileChange({ path: "src/billing/total.test.ts", additions: 1, deletions: 1, diff: MULTI_C }),
        item((base) => ({
          ...base,
          type: "file_change",
          fileName: "src/lib/money.ts",
          additions: 5,
          deletions: 0,
          diffStr: NEW_FILE,
          changes: [{ operation: "add", path: "src/lib/money.ts" }],
        })),
        item((base) => ({
          ...base,
          type: "file_change",
          fileName: "src/billing/format.ts",
          additions: 0,
          deletions: 0,
          changes: [{ operation: "rename", path: "src/billing/format.ts", oldPath: "src/billing/legacyFormat.ts" }],
        })),
        item((base) => ({
          ...base,
          type: "file_change",
          fileName: "src/lib/legacy-money.ts",
          additions: 0,
          deletions: 7,
          diffStr: DELETED_FILE,
          changes: [{ operation: "delete", path: "src/lib/legacy-money.ts" }],
        })),
        command({ input: "vp test src/billing", status: "running", output: " RUN  v2.4.1\n" }),
      ],
    }),
  ],
  onOpen: script([], {
    loop: streamParagraphs("assistant_message", [
      "The billing tests pass with `Money` in place. Looking for any remaining callers of the legacy helpers.",
      "No other callers of `legacyFormat` or `legacyParse` are left, so the deleted file is safe to drop.",
    ], { after: "7s" }),
  }),
});

const searches = thread({
  id: "l05-file-and-web-search",
  project: "live",
  title: "Search: files in the repo and the web",
  scenario: { id: "L05", label: "File search and web search rows", waitForText: "retry-after" },
  turns: [
    turn({
      at: "90s",
      status: "running",
      user: "How does our HTTP client handle a retry-after header, and what does the spec say?",
      items: [
        reasoning("First the client code, then the standard."),
        item((base) => ({
          ...base,
          type: "file_search",
          pattern: "retry-after",
          results: [
            { fileName: "src/http/client.ts", line: 57, preview: "const wait = parseRetryAfter(response.headers.get(\"retry-after\"));" },
            { fileName: "src/http/retry.ts", line: 12, preview: "export function parseRetryAfter(value: string | null): number | null {" },
            { fileName: "src/http/retry.test.ts", line: 30, preview: "it(\"reads a retry-after date\", () => {" },
            { fileName: "docs/http-client.md", line: 88, preview: "The client honors `Retry-After` up to a ceiling of 30 seconds." },
          ],
        })),
        item((base) => ({
          ...base,
          type: "web_search",
          patterns: ["Retry-After header format delay-seconds HTTP-date"],
          results: [
            {
              title: "RFC 9110: HTTP Semantics, Retry-After",
              url: "https://www.rfc-editor.org/rfc/rfc9110#field.retry-after",
              snippet: "The Retry-After header field indicates how long the user agent ought to wait before making a follow-up request. The value is either an HTTP-date or a number of seconds.",
            },
            {
              title: "Retry-After - HTTP | MDN",
              url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After",
              snippet: "The Retry-After response HTTP header indicates how long the user agent should wait before making a follow-up request.",
            },
          ],
        })),
        assistant(
          "The client reads `retry-after` in `src/http/retry.ts` and accepts both forms the spec allows: a number of seconds or an HTTP date.",
          { phase: "commentary" },
        ),
        command({ input: "sed -n 1,40p src/http/retry.ts", status: "running", output: "" }),
      ],
    }),
  ],
  onOpen: script([], {
    loop: streamParagraphs("assistant_message", [
      "It caps the wait at 30 seconds, which matches the documented ceiling. One gap: a date in the past is treated as zero, not as an error.",
      "The spec allows both forms, so the parser is correct. I'd add a test for the past-date case.",
    ], { after: "6s" }),
  }),
});

export default [fileChanges, searches];
