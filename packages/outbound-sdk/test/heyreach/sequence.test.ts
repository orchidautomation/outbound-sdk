import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import { CAMPAIGN, suite } from "./suite.ts";

const sequenceOf = async (tree: unknown) => {
  const { outbound, settle } = harness(suite, () => Response.json(tree));

  return await settle(outbound.campaign(CAMPAIGN).sequence());
};

test("heyreach: a sequence is read from the node tree, and END nodes are not steps", async () => {
  const { outbound, requests, settle } = harness(suite);
  const sequence = await settle(outbound.campaign(CAMPAIGN).sequence());
  const url = new URL(requests[0]?.url ?? "");
  assert.equal(url.pathname, "/api/public/campaign/GetCampaignSequence");
  assert.equal(url.searchParams.get("campaignId"), CAMPAIGN);
  assert.equal(sequence.campaignRef, "heyreach:client-a:274079");
  assert.equal(sequence.sourceId, "274079");
  assert.equal(sequence.kind, "main");
  assert.equal(sequence.name, null);
  assert.deepEqual(
    sequence.steps.map((step) => [
      step.index,
      step.action,
      step.delayDays,
      step.parentIndex,
      step.branch,
    ]),
    [
      [0, "connection_request", 0, null, null],
      [1, "message", 2, 0, "accepted"],
    ],
    "the message is sent once the request is accepted"
  );
  const [variant] = sequence.steps[0]?.variants ?? [];
  assert.equal(variant?.variantKey, "A");
  assert.equal(variant?.body, "Hi {FIRST_NAME}, I'd love to connect!");
  assert.equal(variant?.subject, null);
  assert.equal(variant?.contentHash.length, 32);
  assert.equal(
    sequence.steps[1]?.variants[0]?.body,
    "Thanks for connecting, {FIRST_NAME}!"
  );
});

test("heyreach: a sequence reads V2 message versions, hour delays and several variants", async () => {
  const v2 = fixture("heyreach", "getCampaignSequenceV2.json") as {
    conditionalNode: { payload: { messageVersions: object[] } };
  };

  v2.conditionalNode.payload.messageVersions.push({ message: "Second copy" });

  const { steps } = await sequenceOf({
    ...v2,
    conditionalNode: {
      ...v2.conditionalNode,
      actionDelay: 12,
      actionDelayUnit: "HOUR",
      unconditionalNode: {
        actionDelayUnit: "WEEK",
        nodeType: "VIEW_PROFILE",
      },
    },
  });

  assert.deepEqual(
    steps.map((step) => [step.action, step.delayDays, step.parentIndex]),
    [
      ["connection_request", 0, null],
      ["message", 0.5, 0],
      ["view_profile", null, 1],
    ]
  );
  assert.equal(
    steps[2]?.branch,
    null,
    "the step after a message is on the straight path"
  );
  assert.deepEqual(
    steps[1]?.variants.map((variant) => [variant.variantKey, variant.body]),
    [
      ["A", "Thanks for connecting, {FIRST_NAME}!"],
      ["B", "Second copy"],
    ]
  );
  assert.deepEqual(steps[2]?.variants, [], "a node without a payload");
});

test("heyreach: an empty sequence response is a campaign with no steps", async () => {
  const { outbound, settle } = harness(
    suite,
    () => new Response("", { status: 200 })
  );

  const sequence = await settle(outbound.campaign(CAMPAIGN).sequence());
  assert.deepEqual(sequence.steps, []);
  assert.equal(sequence.raw, null);
});

test("heyreach: a branching sequence keeps every step, with its parent and the outcome that leads to it", async () => {
  const { steps } = await sequenceOf(
    fixture("heyreach", "getCampaignSequence.branching.json")
  );

  assert.deepEqual(
    steps.map((step) => [
      step.index,
      step.action,
      step.parentIndex,
      step.branch,
      step.delayDays,
      step.variants[0]?.body ?? null,
    ]),
    [
      [0, "message", null, "connected", 2, "Already connected: first note"],
      [1, "message", 0, null, 4, "Already connected: follow-up"],
      [2, "connection_request", null, "not_connected", 2.125, null],
      [3, "message", 2, "accepted", 1, "Thanks for accepting"],
      [4, "message", 3, null, 5, "Accepted: follow-up"],
      [5, "view_profile", 2, "not_accepted", 10, null],
      [6, "inmail", 5, "open_profile", 1.25, "An InMail for an open profile"],
      [7, "follow", 5, "not_open_profile", 8, null],
    ],
    "checks are conditions: their wait is added to the step under them"
  );
});

test("heyreach: two branches that hold different steps are both kept, never refused", async () => {
  const { steps } = await sequenceOf({
    conditionalNode: { nodeType: "MESSAGE" },
    nodeType: "CONNECTION_REQUEST",
    unconditionalNode: { nodeType: "INMAIL" },
  });

  assert.deepEqual(
    steps.map((step) => [
      step.index,
      step.action,
      step.parentIndex,
      step.branch,
    ]),
    [
      [0, "connection_request", null, null],
      [1, "message", 0, "accepted"],
      [2, "inmail", 0, "not_accepted"],
    ]
  );
});

test("heyreach: the usual connection check gives each outcome its own steps, even when the messages are the same", async () => {
  const { steps } = await sequenceOf(
    fixture("heyreach", "getCampaignSequence.connectionCheck.json")
  );

  assert.deepEqual(
    steps.map((step) => [
      step.index,
      step.action,
      step.parentIndex,
      step.branch,
      step.delayDays,
      step.variants[0]?.body ?? null,
    ]),
    [
      [
        0,
        "message",
        null,
        "connected",
        1,
        "Hi {FIRST_NAME}, thanks for connecting.",
      ],
      [1, "message", 0, null, 3, "Following up on my note."],
      [2, "connection_request", null, "not_connected", 0, null],
      [
        3,
        "message",
        2,
        "accepted",
        1,
        "Hi {FIRST_NAME}, thanks for connecting.",
      ],
      [4, "message", 3, null, 3, "Following up on my note."],
    ],
    "the check itself is a condition, not a step"
  );
  assert.equal(
    new Set(steps.map((step) => step.index)).size,
    steps.length,
    "indexes are unique"
  );
});

test("heyreach: conditions in a row join their outcomes, and unknown nodes keep HeyReach's words", async () => {
  const end = { nodeType: "END" };

  const { steps } = await sequenceOf({
    conditionalNode: {
      conditionalNode: { nodeType: "INMAIL", unconditionalNode: end },
      nodeType: "CHECK_IS_OPEN_PROFILE",
      unconditionalNode: end,
    },
    nodeType: "CHECK_IS_CONNECTION",
    unconditionalNode: {
      conditionalNode: { nodeType: "FOLLOW" },
      nodeType: "SOMETHING_NEW",
      unconditionalNode: {
        conditionalNode: { nodeType: "LIKE_POST" },
        nodeType: "FIND_EMAIL",
        unconditionalNode: {
          conditionalNode: { nodeType: "VIEW_PROFILE" },
          nodeType: "MESSAGE",
          unconditionalNode: "not a node",
        },
      },
    },
  });

  assert.deepEqual(
    steps.map((step) => [step.action, step.parentIndex, step.branch]),
    [
      ["inmail", null, "connected+open_profile"],
      ["something_new", null, "not_connected"],
      ["follow", 1, "conditional"],
      ["find_email", 1, "unconditional"],
      ["like_post", 3, "email_found"],
      ["message", 3, "email_not_found"],
      ["view_profile", 5, "replied"],
    ]
  );
  assert.equal(steps[0]?.delayDays, null, "a node without a delay");
});

test("heyreach: a node without a type is a step called unknown", async () => {
  const { steps } = await sequenceOf({
    actionDelay: 1,
    actionDelayUnit: "DAY",
  });

  assert.deepEqual(
    steps.map((step) => [step.action, step.delayDays]),
    [["unknown", 1]]
  );
});
