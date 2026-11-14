import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../src/combine/index.ts";
import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../src/index.ts";
import type { Adapter } from "../src/index.ts";
import { instantly } from "../src/instantly/index.ts";
import { memory } from "../src/memory/index.ts";
import { createClock } from "./helpers/clock.ts";
import { fixture } from "./helpers/fixtures.ts";
import { createFetch, json, testAdapter } from "./helpers/http.ts";

const email = (workspaceId: string): Adapter =>
  memory({
    data: {
      campaigns: [
        { id: "c1", name: `${workspaceId} one` },
        { id: "c2", name: `${workspaceId} two` },
        { id: "c3" },
      ],
      leads: [
        { campaignId: "c1", email: "person1@example.com", id: "l1" },
        { campaignId: "c2", email: "person2@example.com", id: "l2" },
      ],
      messages: [
        {
          campaignId: "c1",
          direction: "out",
          id: "m1",
          leadId: "l1",
          sentAt: "2026-10-01T00:00:00.000Z",
        },
        {
          campaignId: "c1",
          category: "positive",
          direction: "in",
          id: "m2",
          leadId: "l1",
          sentAt: "2026-10-02T00:00:00.000Z",
        },
      ],
      senders: [{ address: "out@example.com", campaignIds: ["c1"], id: "s1" }],
      stats: [
        {
          campaignId: "c1",
          counts: { replied: 2, sent: 40 },
          date: "2026-10-05",
        },
      ],
    },
    name: "mailtool",
    pageSize: 2,
    workspaceId,
  });

const linkedin = (): Adapter =>
  memory({
    capabilities: {
      "messages.body": false,
      "replies.category": false,
      "stats.byStep": false,
    },
    data: {
      campaigns: [{ channel: "linkedin", id: "c1", name: "LinkedIn one" }],
      leads: [
        {
          campaignId: "c1",
          id: "p1",
          linkedinUrl: "https://www.linkedin.com/in/example-person-1",
        },
      ],
      stats: [
        {
          campaignId: "c1",
          counts: { connectionsAccepted: 5, connectionsSent: 20 },
          date: "2026-10-05",
        },
      ],
    },
    name: "lntool",
    workspaceId: "client-a",
  });

const client = () =>
  createOutbound({
    adapter: combine([email("client-a"), email("client-b"), linkedin()]),
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

test("lists every member's records in one stream, each tagged with its own provider and workspace", async () => {
  const campaigns = await client().campaigns.listAll().toArray();
  assert.deepEqual(
    campaigns.map((campaign) => campaign.ref),
    [
      "mailtool:client-a:c1",
      "mailtool:client-a:c2",
      "mailtool:client-a:c3",
      "mailtool:client-b:c1",
      "mailtool:client-b:c2",
      "mailtool:client-b:c3",
      "lntool:client-a:c1",
    ]
  );
  assert.deepEqual(
    [...new Set(campaigns.map((campaign) => campaign.channel))],
    ["email", "linkedin"]
  );
});

test("a cursor resumes inside the right member", async () => {
  const outbound = client();
  const first = await outbound.campaigns.list();
  const second = await outbound.campaigns.list({ cursor: first.cursor });
  const third = await outbound.campaigns.list({ cursor: second.cursor });
  assert.deepEqual(
    [first, second, third].map((page) => page.items.map((item) => item.ref)),
    [
      ["mailtool:client-a:c1", "mailtool:client-a:c2"],
      ["mailtool:client-a:c3"],
      ["mailtool:client-b:c1", "mailtool:client-b:c2"],
    ]
  );
  assert.equal(first.complete, false);
});

test("a lookup is routed by ref, and a bare id is refused", async () => {
  const outbound = client();
  assert.equal(
    (await outbound.campaigns.get("mailtool:client-b:c1")).name,
    "client-b one"
  );
  assert.equal(
    (await outbound.campaigns.get("lntool:client-a:c1")).name,
    "LinkedIn one"
  );
  assert.equal(
    await outbound.campaigns.exists("mailtool:client-b:nope"),
    false
  );
  const error = await failure(() => outbound.campaigns.get("c1"));
  assert.equal(error.code, "Invalid");
  assert.match(error.message, /must be a ref \(provider:workspace:id\)/u);
  assert.equal(
    (await failure(() => outbound.campaigns.get("other:client-a:c1"))).code,
    "Invalid"
  );
});

test("a campaign handle reads only from the member that owns the campaign", async () => {
  const campaign = client().campaign("mailtool:client-b:c1");
  assert.deepEqual(
    (await campaign.leads.list()).items.map((lead) => lead.ref),
    ["mailtool:client-b:l1"]
  );
  assert.deepEqual(
    (await campaign.senders.list()).items.map((sender) => sender.ref),
    ["mailtool:client-b:s1"]
  );
  assert.equal((await campaign.sequence()).campaignRef, "mailtool:client-b:c1");
  assert.equal(
    (await campaign.replies.list()).items[0]?.ref,
    "mailtool:client-b:m2"
  );
  assert.equal(
    (await campaign.stats()).rows[0]?.scopeRef,
    "mailtool:client-b:c1"
  );
});

test("a lead's timeline and a sender lookup are routed by ref", async () => {
  const outbound = client();
  const timeline = await outbound.lead("mailtool:client-a:l1").timeline();
  assert.deepEqual(
    timeline.items.map((message) => message.ref),
    ["mailtool:client-a:m1", "mailtool:client-a:m2"]
  );
  assert.equal(
    (await outbound.leads.get("lntool:client-a:p1")).linkedinUrl,
    "https://www.linkedin.com/in/example-person-1"
  );
  assert.equal(
    (await outbound.senders.get("mailtool:client-a:s1")).address,
    "out@example.com"
  );
});

test("promises only what every member can do", async () => {
  const outbound = client();
  assert.equal(
    outbound.capabilities["messages.body"],
    false,
    "the LinkedIn tool has no bodies"
  );
  assert.equal(outbound.capabilities["replies.category"], false);
  assert.equal(outbound.capabilities["stats.byStep"], false);
  assert.equal(outbound.capabilities["leads.list"], true);
  assert.equal(
    (await failure(() => outbound.replies.list({ category: "positive" }))).code,
    "Unsupported"
  );
  assert.equal(outbound.provider, "combined");
});

test("workspace stats come back one row per member, never added together", async () => {
  const stats = await client().stats();
  assert.deepEqual(
    stats.rows.map((row) => [
      row.provider,
      row.workspaceId,
      row.sent,
      row.connectionsSent,
    ]),
    [
      ["mailtool", "client-a", 40, null],
      ["mailtool", "client-b", 40, null],
      ["lntool", "client-a", null, 20],
    ]
  );
});

test("workspaces are the members, and workspace(id) scopes to one of them", async () => {
  const outbound = client();
  const workspaces = await outbound.workspaces.list();
  assert.deepEqual(
    workspaces.items.map((workspace) => workspace.ref),
    [
      "mailtool:client-a:client-a",
      "mailtool:client-b:client-b",
      "lntool:client-a:client-a",
    ]
  );
  const scoped = outbound.workspace("client-b");
  assert.equal(scoped.provider, "mailtool");
  assert.equal(scoped.workspaceId, "client-b");
  assert.equal(
    (await scoped.campaigns.get("c1")).name,
    "client-b one",
    "a bare id works once scoped"
  );
  assert.throws(
    () => outbound.workspace("client-z"),
    (error) => OutboundError.is(error) && error.code === "NotFound"
  );
});

test("two adapters with the same provider and workspace label are refused", () => {
  assert.throws(
    () => combine([email("default"), email("default")]),
    (error) =>
      OutboundError.is(error) &&
      /Two adapters are both mailtool:default/u.test(error.message)
  );
  assert.throws(() => combine([]), /needs at least one adapter/u);
  assert.throws(() => combine([combine([email("a")])]), /cannot nest/u);
});

test("each member keeps its own rate budget and credential", async () => {
  const clock = createClock();
  const http = createFetch(() => json({ items: [{ id: "c1" }] }));
  const limits = { source: "test", windows: [{ perMs: 1000, requests: 1 }] };

  const outbound = createOutbound({
    adapter: combine([
      testAdapter({
        key: "sk_test_client_a_key_000001",
        limits,
        workspaceId: "client-a",
      }),
      testAdapter({
        key: "sk_test_client_b_key_000002",
        limits,
        workspaceId: "client-b",
      }),
    ]),
    fetch: http.fetch,
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  const campaigns = await clock.settle(outbound.campaigns.listAll().toArray());
  assert.equal(campaigns.length, 2);
  assert.equal(
    clock.elapsed(),
    0,
    "one request per key fits each key's own 1-per-second budget"
  );
  assert.deepEqual(
    http.requests.map((request) => request.headers.authorization),
    ["Bearer sk_test_client_a_key_000001", "Bearer sk_test_client_b_key_000002"]
  );
  const snapshots = await outbound.limits();
  assert.deepEqual(
    snapshots.map((snapshot) => [
      snapshot.workspaceId,
      snapshot.windows[0]?.used,
    ]),
    [
      ["client-a", 1],
      ["client-b", 1],
    ]
  );
});

test("the weakest member decides maturity, and caveats name their member", () => {
  const outbound = createOutbound({
    adapter: combine([
      email("client-a"),
      instantly({
        apiKey: "inst_key_for_combine_test",
        workspaceId: "client-a",
      }),
    ]),
  });

  assert.equal(outbound.maturity, "unverified");
  assert.match(outbound.caveats[0] ?? "", /^instantly \(client-a\): /u);
});

test("a webhook is parsed by the member whose format matches, under that member's workspace", () => {
  const adapter = combine([
    email("client-a"),
    instantly({ apiKey: "inst_key_for_combine_test", workspaceId: "client-b" }),
  ]);

  const body = fixture("instantly", "webhook.reply_received.json");

  const request = {
    body: body as never,
    headers: new Headers(),
    rawBody: JSON.stringify(body),
    url: "https://hooks.example.com/x",
  };

  assert.equal(adapter.events?.detect(request), true);
  const [event] = adapter.events?.parse(request, "ignored") ?? [];
  assert.equal(event?.provider, "instantly");
  assert.equal(event?.workspaceId, "client-b");
  assert.deepEqual(
    adapter.events?.parse({ ...request, body: { hello: "world" } }, "ignored"),
    []
  );
});
