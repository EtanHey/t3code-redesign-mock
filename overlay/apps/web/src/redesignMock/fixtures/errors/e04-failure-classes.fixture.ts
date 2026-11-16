// E04: the failure classes the provider can report besides usage limits and plain provider errors:
// transport, permission, validation and unknown. Each ends a short run with a distinct message.
import { assistant, command, MODELS, thread, turn } from "../../api";
import { failureItem } from "./errors-kit";

interface ClassSpec {
  readonly id: string;
  readonly scenario: string;
  readonly title: string;
  readonly prompt: string;
  readonly work: string;
  readonly output: string;
  readonly failure: Parameters<typeof failureItem>[0];
  readonly model?: (typeof MODELS)[keyof typeof MODELS];
}

function failing(spec: ClassSpec) {
  return thread({
    id: spec.id,
    project: "errors",
    title: spec.title,
    model: spec.model ?? MODELS.sonnet,
    scenario: { id: spec.scenario, label: spec.title, waitForText: "Run failed" },
    turns: [
      turn({
        at: "18m",
        took: "70s",
        status: "failed",
        user: spec.prompt,
        items: [
          assistant("Taking a look.", { phase: "commentary" }),
          command({ input: spec.work, output: spec.output }),
          failureItem(spec.failure),
        ],
      }),
    ],
  });
}

export default [
  failing({
    id: "e04-transport",
    scenario: "E04",
    title: "Transport error: the connection dropped",
    prompt: "Summarize which webhook handlers have no retry logic.",
    work: "rg -l \"export async function handle\" src/webhooks",
    output: "src/webhooks/stripe.ts\nsrc/webhooks/payouts.ts\nsrc/webhooks/disputes.ts",
    failure: {
      class: "transport_error",
      message: "The connection to the provider closed before the response finished (ECONNRESET).",
      code: "ECONNRESET",
      retryable: true,
    },
  }),
  failing({
    id: "e04-permission",
    scenario: "E04b",
    title: "Permission error: the model is not available",
    prompt: "Draft release notes for 2.8.0 from the merged pull requests.",
    work: "git log --oneline v2.7.0..HEAD | head -5",
    output: "a91c2e4 fix(invoices): round once after discounts\n7d03b18 feat(ledger): invoice index migration\n3be5f60 chore: bump vitest to 3.2",
    failure: {
      class: "permission_error",
      message: "Your organization does not have access to this model. Ask an admin to enable it, or pick another model.",
      code: "model_not_permitted",
      retryable: false,
    },
  }),
  failing({
    id: "e04-validation",
    scenario: "E04c",
    title: "Validation error: the request was rejected",
    prompt: "Read every migration and explain what the schema looks like today.",
    work: "cat db/migrations/*.sql | wc -c",
    output: "3871204",
    failure: {
      class: "validation_error",
      message: "The conversation is too long for this model: 214,380 tokens requested, the limit is 200,000. Start a new thread or compact the context.",
      code: "context_length_exceeded",
      retryable: false,
    },
  }),
  failing({
    id: "e04-unknown",
    scenario: "E04d",
    title: "Unknown error: the provider process stopped",
    prompt: "Check whether the nightly job still writes to the old queue.",
    work: "rg -n \"legacy-queue\" jobs",
    output: "jobs/nightly.ts:58:  await publish(\"legacy-queue\", payload);",
    failure: {
      class: "unknown",
      message: "The provider process exited unexpectedly (signal SIGKILL).",
      code: null,
      retryable: null,
    },
  }),
];
