import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, OutboundError } from "../src/index.ts";
import { demoData, memory } from "../src/memory/index.ts";
import { createFetch, json, sequence, testAdapter } from "./helpers/http.ts";

const client = () =>
  createOutbound({
    adapter: memory({ data: demoData(), workspaceId: "client-a" }),
  });

const failure = async (action: () => unknown): Promise<OutboundError> => {
  try {
    await action();
  } catch (error) {
    assert.ok(OutboundError.is(error), String(error));

    return error;
  }

  throw new Error("expected the call to fail");
};

test("a campaign handle scopes every collection to that campaign", async () => {
  const campaign = client().campaign("cmp_founders");
  assert.equal((await campaign.get()).name, "Q4 SaaS founders");
  assert.deepEqual(
    (await campaign.leads.list()).items.map((lead) => lead.sourceId),
    ["lead_1", "lead_2"]
  );
  assert.deepEqual(
    (await campaign.senders.list()).items.map((sender) => sender.address),
    ["outreach1@example.com", "outreach2@example.com"]
  );
  assert.deepEqual(
    (await campaign.messages.listAll().toArray()).map(
      (message) => message.sourceId
    ),
    ["msg_1", "msg_2", "msg_3"]
  );
  assert.deepEqual(
    (await campaign.replies.list()).items.map((reply) => [
      reply.sourceId,
      reply.category,
    ]),
    [["msg_2", "positive"]]
  );
});

test("a sequence returns template text with a content hash per variant", async () => {
  const steps = await client().campaign("cmp_founders").sequence();
  assert.equal(steps.campaignRef, "memory:client-a:cmp_founders");
  assert.deepEqual(
    steps.steps.map((step) => [
      step.index,
      step.delayDays,
      step.variants.length,
    ]),
    [
      [0, 0, 2],
      [1, 3, 1],
    ]
  );
  const [first] = steps.steps;
  assert.deepEqual(
    first?.variants.map((variant) => variant.variantKey),
    ["A", "B"]
  );
  assert.equal(first?.variants[0]?.body, "Hi {{firstName}}, saw your launch.");
  assert.notEqual(
    first?.variants[0]?.contentHash,
    first?.variants[1]?.contentHash
  );
});

test("message bodies are returned only when asked for", async () => {
  const outbound = client();
  const without = await outbound.messages.list({ campaignId: "cmp_founders" });
  assert.equal(without.items[0]?.bodyText, null);

  const withBody = await outbound.messages.list({
    campaignId: "cmp_founders",
    include: ["body"],
  });

  assert.equal(withBody.items[0]?.bodyText, "Hi Alex, saw your launch.");
});

test("replies filter by category and date", async () => {
  const outbound = client();
  assert.equal(
    (await outbound.replies.list({ category: "positive" })).items.length,
    1
  );
  assert.equal(
    (await outbound.replies.list({ category: "negative" })).items.length,
    0
  );
  assert.equal(
    (await outbound.replies.list({ since: "2026-10-07" })).items.length,
    0
  );
  assert.equal(
    (
      await outbound.replies.list({
        since: "2026-10-06",
        until: "2026-10-06T23:59:59Z",
      })
    ).items.length,
    1
  );
});

test("a lead's timeline is every message for that lead, oldest first", async () => {
  const outbound = client();
  const lead = outbound.lead("lead_1");
  assert.equal((await lead.get()).email, "person1@example.com");
  const timeline = await lead.timeline();
  assert.deepEqual(
    timeline.items.map((message) => [message.direction, message.sentAt]),
    [
      ["out", "2026-10-05T14:00:00.000Z"],
      ["in", "2026-10-06T09:30:00.000Z"],
    ]
  );
  assert.equal(timeline.complete, true);
});

test("a sender handle reads the sender, its warmup and its stats", async () => {
  const outbound = createOutbound({
    adapter: memory({
      data: {
        senders: [
          {
            address: " Out@Example.com ",
            id: "s1",
            warmup: { enabled: true, score: 91 },
          },
          { id: "s2" },
        ],
        stats: [
          {
            campaignId: "c1",
            counts: { bounced: 1, sent: 20 },
            date: "2026-10-05",
            senderId: "s1",
          },
          {
            campaignId: "c2",
            counts: { bounced: 0, sent: 10 },
            date: "2026-10-06",
            senderId: "s1",
          },
        ],
      },
    }),
  });

  const sender = outbound.sender("s1");
  assert.equal(
    (await sender.get()).address,
    "out@example.com",
    "lowercased and trimmed"
  );
  assert.deepEqual(await sender.warmup(), { enabled: true, score: 91 });
  const stats = await sender.stats();
  assert.equal(stats.rows.length, 1);
  assert.equal(stats.rows[0]?.sent, 30);
  assert.equal(stats.rows[0]?.bounced, 1);
  assert.equal(
    stats.rows[0]?.replied,
    null,
    "a count nobody reported stays null"
  );
  assert.equal(
    (await failure(() => outbound.sender("s2").warmup())).code,
    "NotFound"
  );
});

test("stats give totals, or one row per day, for a workspace or a campaign", async () => {
  const outbound = client();
  const total = await outbound.stats();
  assert.equal(total.rows.length, 1);
  assert.equal(total.rows[0]?.scope, "workspace");
  assert.equal(total.rows[0]?.sent, 150);
  assert.equal(total.rows[0]?.replied, 8);
  assert.equal(total.rows[0]?.date, null);
  assert.equal(total.meta.evidence, "exact");

  const daily = await outbound.campaign("cmp_founders").stats({ by: "day" });
  assert.deepEqual(
    daily.rows.map((row) => [row.date, row.sent, row.replied, row.timezone]),
    [
      ["2026-10-05", 50, 4, "UTC"],
      ["2026-10-06", 40, 3, "UTC"],
    ]
  );
  assert.equal(daily.rows[0]?.scopeRef, "memory:client-a:cmp_founders");

  const ranged = await outbound.stats({ from: "2026-10-06", to: "2026-10-06" });
  assert.equal(ranged.rows[0]?.sent, 40);
});

test("stats by step need the step scope", async () => {
  const outbound = createOutbound({
    adapter: memory({
      data: {
        stats: [
          {
            campaignId: "c1",
            counts: { replied: 3, sent: 100 },
            date: "2026-10-05",
            stepIndex: 0,
          },
          {
            campaignId: "c1",
            counts: { replied: 1, sent: 60 },
            date: "2026-10-05",
            stepIndex: 1,
          },
        ],
      },
    }),
  });

  const steps = await outbound.campaign("c1").stats({ scope: "step" });
  assert.deepEqual(
    steps.rows.map((row) => [row.stepIndex, row.sent, row.replied]),
    [
      [0, 100, 3],
      [1, 60, 1],
    ]
  );
});

test("workspace(id) returns the instance for that workspace", async () => {
  const outbound = client();
  assert.equal(outbound.workspace("client-a"), outbound);
  assert.throws(
    () => outbound.workspace("client-z"),
    (error) => OutboundError.is(error) && error.code === "NotFound"
  );
  assert.deepEqual(
    (await outbound.workspaces.list()).items.map((workspace) => workspace.name),
    ["client-a"]
  );
});

test("raw reads the vendor's own API and refuses anything that is not a read", async () => {
  const http = createFetch(sequence(json({ ok: true })));

  const outbound = createOutbound({
    adapter: testAdapter(),
    fetch: http.fetch,
  });

  assert.deepEqual(
    await outbound.raw.get("/accounts", {
      query: { limit: 5, skip: undefined },
    }),
    {
      ok: true,
    }
  );
  assert.match(
    http.requests[0]?.url ?? "",
    /^https:\/\/api\.vendor\.test\/accounts\?limit=5&api_key=/u
  );
  // The adapter declares POST /search as a read, as some vendors list with POST.
  await outbound.raw.request("POST", "/search", { body: { q: "x" } });
  assert.equal(http.requests[1]?.method, "POST");
  assert.equal(http.requests[1]?.body, '{"q":"x"}');

  const refused = await failure(() =>
    outbound.raw.request("POST", "/campaigns/1/pause")
  );

  assert.equal(refused.code, "Unsupported");
  assert.match(refused.message, /read-only; pass allowWrites: true/u);
  assert.equal(
    (await failure(() => outbound.raw.request("DELETE", "/leads/1"))).code,
    "Unsupported"
  );
  assert.equal(
    http.requests.length,
    2,
    "a refused request never reaches the network"
  );
});

test("raw allows writes only when the instance opts in", async () => {
  const http = createFetch(sequence(json({ paused: true })));

  const outbound = createOutbound({
    adapter: testAdapter(),
    allowWrites: true,
    fetch: http.fetch,
  });

  assert.deepEqual(await outbound.raw.request("POST", "/campaigns/1/pause"), {
    paused: true,
  });
});

test("estimate returns the request count before reading", () => {
  const base = memory();

  const outbound = createOutbound({
    adapter: {
      ...base,
      costs: { "leads.list": { pageSize: 100, perPage: 1, perRecord: 1 } },
    },
  });

  assert.deepEqual(outbound.estimate({ action: "leads.list", records: 250 }), {
    basis: "3 page(s) of 100 at 1 request(s) each, plus 1 per record",
    requests: 253,
  });
  assert.equal(outbound.estimate({ action: "leads.list" }).requests, null);
  assert.equal(
    outbound.estimate({ action: "campaigns.list", records: 10 }).requests,
    null
  );
});

test("an instance reports its provider, workspace and maturity", () => {
  const outbound = client();
  assert.equal(outbound.provider, "memory");
  assert.equal(outbound.workspaceId, "client-a");
  assert.equal(outbound.maturity, "stable");
});
