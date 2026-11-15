// Field coverage: what `outbound.fields` says for one adapter and for several
// read as one.

import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../src/combine/index.ts";
import { heyreach } from "../src/heyreach/index.ts";
import {
  createOutbound,
  outboundEventSchema,
  resolveFields,
} from "../src/index.ts";
import type { OutboundPlugin } from "../src/index.ts";
import { insights } from "../src/insights/index.ts";
import { instantly } from "../src/instantly/index.ts";
import { memory } from "../src/memory/index.ts";
import { redact } from "../src/redact/index.ts";

const offline: typeof fetch = () =>
  Promise.reject(new Error("no request is expected"));

test("fields: an adapter that declares nothing reports every field as exact", () => {
  const coverage = resolveFields();

  assert.equal(coverage.lead.email, "exact");
  assert.equal(coverage.metricRow.delivered, "exact");
  assert.equal(
    "ref" in coverage.lead,
    false,
    "identity fields are always filled and are not graded"
  );

  const outbound = createOutbound({ adapter: memory({}), fetch: offline });
  assert.deepEqual(outbound.fields, coverage);
});

test("fields: a declaration grades one field, or a whole record", () => {
  const coverage = resolveFields({
    lead: { phone: false, website: "derived" },
    tag: false,
  });

  assert.equal(coverage.lead.phone, false);
  assert.equal(coverage.lead.website, "derived");
  assert.equal(coverage.lead.email, "exact", "undeclared fields stay exact");
  assert.ok(Object.keys(coverage.tag).length > 0);
  assert.ok(
    Object.values(coverage.tag).every((grade) => grade === false),
    "a record the adapter never returns has no filled field"
  );
});

test("fields: an instance reports its adapter's coverage", () => {
  const email = createOutbound({
    adapter: instantly({ apiKey: "inst_test_key_0123456789abcdef" }),
    fetch: offline,
  });

  assert.equal(email.fields.lead.linkedinUrl, false);
  assert.equal(email.fields.lead.phone, "exact");
  assert.equal(email.fields.senderHealth.blacklisted, false);

  const linkedin = createOutbound({
    adapter: heyreach({ apiKey: "hr_test_key_0123456789abcdef" }),
    fetch: offline,
  });

  assert.equal(linkedin.fields.lead.linkedinUrl, "exact");
  assert.equal(linkedin.fields.lead.phone, false);
  assert.equal(linkedin.fields.reply.category, "derived");
});

test("fields: a combined instance fills a field when any member does", () => {
  const outbound = createOutbound({
    adapter: combine([
      instantly({ apiKey: "inst_test_key_0123456789abcdef" }),
      heyreach({ apiKey: "hr_test_key_0123456789abcdef" }),
    ]),
    fetch: offline,
  });

  assert.equal(
    outbound.fields.lead.linkedinUrl,
    "exact",
    "HeyReach reports it, Instantly does not"
  );
  assert.equal(outbound.fields.lead.phone, "exact", "the other way round");
  assert.equal(
    outbound.fields.senderHealth.blacklisted,
    false,
    "neither member fills it"
  );
  assert.equal(
    outbound.fields.metricRow.delivered,
    false,
    "neither member reports a delivered count"
  );
});

test("stats: the campaign scope with no campaign named returns a row per campaign", async () => {
  const outbound = createOutbound({
    adapter: memory({
      data: {
        campaigns: [{ id: "c1" }, { id: "c2" }],
        stats: [
          { campaignId: "c1", counts: { sent: 10 }, date: "2026-10-01" },
          { campaignId: "c1", counts: { sent: 5 }, date: "2026-10-02" },
          { campaignId: "c2", counts: { sent: 7 }, date: "2026-10-01" },
          {
            campaignId: "c1",
            counts: { sent: 99 },
            date: "2026-10-01",
            senderId: "s1",
          },
        ],
      },
    }),
    fetch: offline,
  });

  const totals = await outbound.stats({ scope: "campaign" });
  assert.deepEqual(
    totals.rows.map((row) => [row.scopeRef, row.sent]),
    [
      ["memory:default:c1", 15],
      ["memory:default:c2", 7],
    ],
    "a per-sender row is not a campaign total and is left out"
  );

  const daily = await outbound.stats({ by: "day", scope: "campaign" });
  assert.equal(daily.rows.length, 3, "a row per campaign per day");

  const off = createOutbound({
    adapter: memory({
      capabilities: { "stats.allCampaigns": false },
      data: {},
    }),
    fetch: offline,
  });

  await assert.rejects(
    async () => await off.stats({ scope: "campaign" }),
    /stats\.allCampaigns/u,
    "refused as unsupported, by the capability's name"
  );
  await assert.rejects(
    async () => await off.stats({ scope: "sender" }),
    /need a scopeId/u,
    "the other scopes still need an id"
  );
});

test("campaigns: a sender's campaigns, on one adapter and routed through a combined one", async () => {
  const data = {
    campaigns: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
    senders: [{ campaignIds: ["c1", "c3"], id: "s1" }, { id: "s2" }],
  };

  const outbound = createOutbound({
    adapter: memory({ data }),
    fetch: offline,
  });

  const mine = await outbound.sender("s1").campaigns.list();
  assert.deepEqual(
    mine.items.map((campaign) => campaign.sourceId),
    ["c1", "c3"]
  );
  assert.deepEqual((await outbound.sender("s2").campaigns.list()).items, []);
  assert.deepEqual(
    (await outbound.campaigns.list({ senderId: "s1" })).items.length,
    2,
    "the same read as a filter on the campaign list"
  );

  const both = createOutbound({
    adapter: combine([
      memory({ data, workspaceId: "acme" }),
      memory({ data: { campaigns: [{ id: "other" }] }, workspaceId: "globex" }),
    ]),
    fetch: offline,
  });

  const routed = await both.sender("memory:acme:s1").campaigns.list();
  assert.deepEqual(
    routed.items.map((campaign) => campaign.ref),
    ["memory:acme:c1", "memory:acme:c3"],
    "only the member that owns the sender is asked"
  );

  const off = createOutbound({
    adapter: memory({ capabilities: { "campaigns.bySender": false }, data }),
    fetch: offline,
  });

  await assert.rejects(
    async () => await off.sender("s1").campaigns.list(),
    /campaigns\.bySender/u
  );
});

test("lists and webhooks: one record by id, in memory, combined and refused", async () => {
  const data = {
    leads: [
      { id: "l1", listIds: ["list1"] },
      { id: "l2", listIds: ["list1"] },
    ],
    lists: [{ id: "list1", name: "Founders" }],
    webhooks: [
      {
        eventTypes: ["reply.received" as const],
        events: ["reply"],
        id: "w1",
        url: "https://hooks.example.com/a",
      },
    ],
  };

  const outbound = createOutbound({
    adapter: memory({ data }),
    fetch: offline,
  });

  const list = await outbound.lists.get("list1");
  assert.equal(list.name, "Founders");
  assert.equal(list.size, 2);
  assert.equal((await outbound.list("list1").get()).ref, list.ref);
  assert.equal(await outbound.lists.exists("nope"), false);
  assert.deepEqual((await outbound.webhooks.get("w1")).eventTypes, [
    "reply.received",
  ]);

  const both = createOutbound({
    adapter: combine([
      memory({ data, workspaceId: "acme" }),
      memory({ data: {}, workspaceId: "globex" }),
    ]),
    fetch: offline,
  });

  assert.equal(
    (await both.webhooks.get("memory:acme:w1")).ref,
    "memory:acme:w1",
    "routed to the member that owns it"
  );

  const off = createOutbound({
    adapter: memory({
      capabilities: { "lists.get": false, "webhooks.get": false },
      data,
    }),
    fetch: offline,
  });

  await assert.rejects(async () => await off.lists.get("list1"), /lists\.get/u);
  await assert.rejects(
    async () => await off.webhooks.get("w1"),
    /webhooks\.get/u
  );
});

test("events: the shared keys of an event's data are checked, and a vendor's extras ride along", () => {
  const event = {
    campaignRef: null,
    data: {
      category: "positive",
      conversationId: "abc",
      recentMessages: [{ text: "hi" }],
      stepIndex: 2,
      vendorEvent: "reply_received",
    },
    id: "e1",
    leadRef: null,
    messageRef: null,
    occurredAt: null,
    provider: "memory",
    raw: null,
    schemaVersion: 1,
    senderRef: null,
    type: "reply.received",
    workspaceId: "default",
  };

  assert.equal(outboundEventSchema.safeParse(event).success, true);

  for (const wrong of [
    { category: "interested" },
    { stepIndex: -1 },
    { stepIndex: "2" },
    { isAuto: "yes" },
    { leadEmail: 7 },
  ]) {
    assert.equal(
      outboundEventSchema.safeParse({
        ...event,
        data: { ...event.data, ...wrong },
      }).success,
      false,
      `${JSON.stringify(wrong)} is not what the key means`
    );
  }
});

test("insights: campaign totals come from one stats request when the vendor's report is full, with the same answer", async () => {
  const data = {
    campaigns: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
    stats: [
      {
        campaignId: "c1",
        counts: { contacted: 100, replied: 9, sent: 120 },
        date: "2026-10-01",
      },
      {
        campaignId: "c2",
        counts: { contacted: 200, replied: 4, sent: 260 },
        date: "2026-10-01",
      },
    ],
  };

  const run = async (grade: "full" | "partial" | false) => {
    const statsCalls: (string | undefined)[] = [];

    const counter: OutboundPlugin = {
      name: "count",
      wrap: (operation, next) => {
        if (operation.kind === "stats") {
          statsCalls.push(operation.query.scopeId);
        }

        return next(operation);
      },
    };

    const outbound = createOutbound({
      adapter: memory({
        capabilities: { "stats.allCampaigns": grade },
        data,
      }),
      fetch: offline,
      plugins: [insights(), counter],
    });

    const answer = await outbound.insights.campaignRanking({ min_sent: 1 });

    return { answer, statsCalls };
  };

  const full = await run("full");
  const partial = await run("partial");
  const off = await run(false);

  assert.deepEqual(
    full.statsCalls,
    [undefined, "memory:default:c3"],
    "one request for every campaign, and the campaign the report left out read on its own"
  );
  assert.equal(partial.statsCalls.length, 3, "one request per campaign");
  assert.equal(off.statsCalls.length, 3);
  assert.deepEqual(full.answer.data, off.answer.data);
  assert.deepEqual(full.answer.data, partial.answer.data);
  assert.equal(
    full.answer.data.ranked.length + full.answer.data.tooFewSends.length,
    2,
    "the two campaigns with counts"
  );
  assert.equal(full.answer.data.unknown.length, 1, "c3 has no counts");
});

test("redact: a lead's phone, website and company LinkedIn page are masked with the rest", async () => {
  const data = {
    leads: [
      {
        company: "Example Co",
        companyLinkedinUrl: "https://www.linkedin.com/company/example-co",
        email: "person1@example.com",
        id: "l1",
        location: "Example City",
        phone: "+15550000000",
        website: "https://example.com",
      },
    ],
  };

  const masked = createOutbound({
    adapter: memory({ data }),
    fetch: offline,
    plugins: [redact()],
  });

  const lead = await masked.leads.get("l1");
  assert.equal(lead.phone, "[redacted]");
  assert.equal(lead.website, "[redacted]");
  assert.equal(lead.companyLinkedinUrl, "[redacted]");
  assert.equal(lead.email, "[redacted]");
  assert.equal(lead.location, "Example City", "left as it is, like a title");
  assert.equal(JSON.stringify(lead).includes("+1555"), false);

  const partly = createOutbound({
    adapter: memory({ data }),
    fetch: offline,
    plugins: [redact({ fields: ["email"] })],
  });

  const kept = await partly.leads.get("l1");
  assert.equal(kept.phone, "+15550000000", "not masked unless asked");
  assert.equal(kept.website, "https://example.com");
});
