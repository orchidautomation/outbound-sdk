import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, OutboundError } from "../src/index.ts";
import { insights, runInsightByName } from "../src/insights/index.ts";
import { demoData, memory } from "../src/memory/index.ts";

// Every Promise-returning method must hand a refusal to the promise, so a
// caller's `.catch()` sees it. `call` is run outside any `await` or `try`.
const rejection = async (
  call: () => Promise<unknown>
): Promise<OutboundError> => {
  let pending: Promise<unknown> = Promise.resolve();

  assert.doesNotThrow(() => {
    pending = call();
  }, "the refusal was thrown at call time");

  try {
    await pending;
  } catch (error) {
    assert.ok(OutboundError.is(error), String(error));

    return error;
  }

  throw new Error("expected the call to be refused");
};

const narrow = () =>
  createOutbound({
    adapter: memory({
      capabilities: {
        "campaigns.settings": false,
        "leads.get": false,
        "leads.timeline": false,
        "messages.byThread": false,
        "senders.get": false,
        "senders.health": false,
        "senders.warmup": false,
        sequence: false,
        "stats.byDay": false,
        "stats.byStep": false,
        "stats.bySender": false,
        "stats.workspace": false,
      },
      data: demoData({ now: "2026-10-08T12:00:00.000Z" }),
    }),
    plugins: [insights()],
  });

test("a capability refusal rejects the promise on every handle method, lookup and stats read", async () => {
  const outbound = narrow();
  const campaign = outbound.campaign("cmp_founders");
  const sender = outbound.sender("mbx_1");
  const lead = outbound.lead("lead_1");

  const refused: [string, () => Promise<unknown>][] = [
    ["campaigns.settings", () => campaign.settings()],
    ["sequence", () => campaign.sequence()],
    ["stats.byStep", () => campaign.stats({ scope: "step" })],
    ["stats.byDay", () => campaign.stats({ by: "day" })],
    ["stats.workspace", () => outbound.stats()],
    ["senders.get", () => sender.get()],
    ["senders.health", () => sender.health()],
    ["senders.warmup", () => sender.warmup()],
    ["stats.bySender", () => sender.stats()],
    ["leads.get", () => lead.get()],
    ["leads.timeline", () => lead.timeline()],
    ["messages.byThread", () => outbound.thread("thr_1").messages()],
    ["messages.byHand", () => outbound.messages.list({ byHand: true })],
    ["senders.get", () => outbound.senders.get("mbx_1")],
    ["senders.get", () => outbound.senders.exists("mbx_1")],
    ["leads.get", () => outbound.leads.getMany(["lead_1"])],
  ];

  for (const [key, call] of refused) {
    // oxlint-disable-next-line no-await-in-loop -- one refusal at a time keeps a failure's message readable.
    const error = await rejection(call);

    assert.equal(error.code, "Unsupported", key);
    assert.ok(error.message.includes(`(${key})`), error.message);
  }
});

test("an input refusal rejects the promise too", async () => {
  const outbound = createOutbound({
    adapter: memory({ data: demoData({ now: "2026-10-08T12:00:00.000Z" }) }),
    plugins: [insights()],
  });

  const refused: [RegExp, () => Promise<unknown>][] = [
    [/from must be a date/u, () => outbound.stats({ from: "yesterday" })],
    [
      /from must not be after to/u,
      () => outbound.stats({ from: "2026-10-02", to: "2026-10-01" }),
    ],
    [/need a scopeId/u, () => outbound.stats({ scope: "step" })],
    [
      /limit must be a positive integer/u,
      () => outbound.leads.list({ limit: 0 }),
    ],
    [/There is no insight "nope"/u, () => runInsightByName(outbound, "nope")],
  ];

  for (const [message, call] of refused) {
    // oxlint-disable-next-line no-await-in-loop -- one refusal at a time keeps a failure's message readable.
    const error = await rejection(call);

    assert.equal(error.code, "Invalid");
    assert.match(error.message, message);
  }
});

test("the stats refusal reads as a sentence", async () => {
  const error = await rejection(() =>
    narrow().campaign("cmp_founders").stats({ scope: "step" })
  );

  assert.equal(
    error.message,
    "Reading stats for the step scope is not available: the memory adapter does not support it (stats.byStep)"
  );
});

test("exists and getMany do not report a missing record to onError, and get does", async () => {
  const actions: string[] = [];
  const errors: string[] = [];

  const outbound = createOutbound({
    adapter: memory({ data: demoData({ now: "2026-10-08T12:00:00.000Z" }) }),
    hooks: {
      onAction: (event) => {
        actions.push(event.action);
      },
      onError: (event) => {
        errors.push(`${event.action}:${event.error.message}`);
      },
    },
  });

  assert.equal(await outbound.campaigns.exists("nope"), false);
  assert.equal(await outbound.campaigns.exists("cmp_founders"), true);

  const many = await outbound.campaigns.getMany(["cmp_founders", "nope"]);

  assert.deepEqual(
    many.errors.map((each) => [each.id, each.error.code]),
    [["nope", "NotFound"]]
  );
  // A missing record there is an answer: each lookup is a finished action, not an error.
  assert.deepEqual(errors, []);
  assert.deepEqual(actions, [
    "campaigns.get",
    "campaigns.get",
    "campaigns.get",
    "campaigns.get",
  ]);

  await assert.rejects(outbound.campaigns.get("nope"));
  assert.deepEqual(errors, ["campaigns.get:Campaign nope was not found"]);
});

test("exists and getMany still report a failure that is not a missing record", async () => {
  const errors: string[] = [];

  const outbound = createOutbound({
    adapter: memory({ data: demoData({ now: "2026-10-08T12:00:00.000Z" }) }),
    hooks: {
      onError: (event) => {
        errors.push(event.action);
      },
    },
  });

  await assert.rejects(outbound.campaigns.exists(" "), /must not be empty/u);

  const many = await outbound.campaigns.getMany([" "]);

  assert.equal(many.errors[0]?.error.code, "Invalid");
  assert.deepEqual(errors, ["campaigns.get", "campaigns.get"]);
});

test("replies.list with includeInbox is refused before any read where the tool has no inbox, and lists where it has one", async () => {
  const data = demoData({ now: "2026-10-08T12:00:00.000Z" });
  const without = createOutbound({ adapter: memory({ data }) });
  const error = await rejection(() =>
    without.replies.list({ includeInbox: true })
  );

  assert.equal(error.code, "Unsupported");
  assert.match(error.message, /replies\.inbox/u);

  const withInbox = createOutbound({
    adapter: memory({ capabilities: { "replies.inbox": true }, data }),
  });
  const page = await withInbox.replies.list({ includeInbox: true });

  assert.ok(page.items.length > 0);
});
