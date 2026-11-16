// Q12: an agent asks for a secret (waiting, saved, declined, cancelled). Q13: an agent asks the
// user to link another machine (waiting, linked, declined, failed). The waiting ones answer
// through handlers/requests/answer-cards.handler.ts; the others are plain history.
import { EnvironmentId, type OrchestrationV2TurnItem } from "@t3tools/contracts";

import { assistant, command, item, reasoning, thread, turn, type ItemSpec } from "../../api";

type SecretItem = Extract<OrchestrationV2TurnItem, { type: "secret_request" }>;
type LinkItem = Extract<OrchestrationV2TurnItem, { type: "link_request" }>;

const SECRET_REASON =
  "I need a test-mode Stripe key to run the checkout tests against the sandbox. Create one at https://dashboard.example.com/test/apikeys and paste it here.";

function secretCard(secretStatus: SecretItem["secretStatus"]): ItemSpec {
  return item((base) => ({
    ...base,
    ...(secretStatus === "pending" ? { status: "waiting" as const, completedAt: null } : {}),
    type: "secret_request",
    label: "STRIPE_TEST_KEY",
    reason: SECRET_REASON,
    placeholder: "sk_test_...",
    delivery: "file",
    secretStatus,
  }));
}

const SECRET_USER = "Run the checkout tests against the Stripe sandbox.";
const secretLead = [
  reasoning("The checkout tests call the Stripe sandbox, which needs an API key I do not have."),
  command({
    input: "rg -n \"STRIPE_TEST_KEY\" src .env.example",
    output: ".env.example:4:STRIPE_TEST_KEY=\nsrc/payments/client.ts:6:  apiKey: process.env.STRIPE_TEST_KEY,\n",
  }),
];

function secretThread(
  suffix: string,
  title: string,
  id: string,
  secretStatus: SecretItem["secretStatus"],
  after: string | null,
) {
  const pending = secretStatus === "pending";
  return thread({
    id: `q12-secret-${suffix}`,
    project: "requests",
    title,
    scenario: { id, label: title, waitForText: pending ? "STRIPE_TEST_KEY" : after ?? "STRIPE_TEST_KEY" },
    turns: [
      turn({
        at: "6m",
        took: "3m",
        status: pending ? "waiting" : "completed",
        user: SECRET_USER,
        items: [...secretLead, secretCard(secretStatus), ...(after ? [assistant(after)] : [])],
      }),
    ],
  });
}

const LINK_REASON =
  "The release script runs on the build box. Link it to this environment so I can start the build there and read the logs.";

function linkCard(linkStatus: LinkItem["linkStatus"]): ItemSpec {
  return item((base) => ({
    ...base,
    ...(linkStatus === "pending" ? { status: "waiting" as const, completedAt: null } : {}),
    type: "link_request",
    reason: LINK_REASON,
    hint: "build box",
    requestedAccess: "approval-required",
    linkStatus,
    ...(linkStatus === "linked"
      ? { linkedEnvironmentId: EnvironmentId.make("env-build-box"), linkedLabel: "build-box", linkedAccess: "approval-required" as const }
      : {}),
    ...(linkStatus === "failed" ? { failure: "the pairing code had expired" } : {}),
  }));
}

const LINK_USER = "Build the release on the build box and tell me how long it takes.";
const linkLead = [
  reasoning("The release build needs the signing tools, which only exist on the build box."),
  command({ input: "ssh -G build-box | head -2", output: "ssh: Could not resolve hostname build-box\n" }),
];

function linkThread(
  suffix: string,
  title: string,
  id: string,
  linkStatus: LinkItem["linkStatus"],
  after: string | null,
) {
  const pending = linkStatus === "pending";
  return thread({
    id: `q13-link-${suffix}`,
    project: "requests",
    title,
    scenario: { id, label: title, waitForText: pending ? "Link a machine" : after ?? "build box" },
    turns: [
      turn({
        at: "6m",
        took: "3m",
        status: pending ? "waiting" : "completed",
        user: LINK_USER,
        items: [...linkLead, linkCard(linkStatus), ...(after ? [assistant(after)] : [])],
      }),
    ],
  });
}

export default [
  secretThread("pending", "Secret request: waiting for the key", "Q12", "pending", null),
  secretThread("saved", "Secret request: saved", "Q12b", "saved", "The key is saved. Running the checkout tests against the sandbox now."),
  secretThread("declined", "Secret request: declined", "Q12c", "declined", "Understood, I won't ask for the key again. I'll skip the sandbox tests and run only the ones that use the mock client."),
  secretThread("cancelled", "Secret request: cancelled with the run", "Q12d", "cancelled", null),
  linkThread("pending", "Link request: waiting for you to pick a machine", "Q13", "pending", null),
  linkThread("linked", "Link request: machine linked", "Q13b", "linked", "build-box is linked. Starting the release build there."),
  linkThread("declined", "Link request: declined", "Q13c", "declined", "Okay, I won't use the build box. I'll build locally, which skips the signing step."),
  linkThread("failed", "Link request: linking failed", "Q13d", "failed", "The link did not go through because the pairing code had expired. Ask me again whenever you have a fresh one."),
];
