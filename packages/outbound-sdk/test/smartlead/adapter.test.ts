import assert from "node:assert/strict";
import { test } from "node:test";

import { smartlead } from "../../src/smartlead/index.ts";
import { harness, runAdapterSuite } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import { API, CAMPAIGN, KEY, SENDER, suite, urlOf } from "./suite.ts";

runAdapterSuite(suite);

const load = (name: string) =>
  fixture("smartlead", name) as Record<string, unknown>;

test("smartlead: a campaign maps the documented fields, and the list is one request", async () => {
  const { outbound, requests, settle } = harness(suite);
  const campaign = await settle(outbound.campaigns.get(CAMPAIGN));
  assert.equal(campaign.sourceId, "372");
  assert.equal(campaign.name, "My Epic Campaign");
  assert.equal(campaign.status, "active");
  assert.equal(campaign.channel, "email");
  assert.equal(campaign.createdAt, "2025-11-25T10:43:46.826Z");
  assert.deepEqual(campaign.tags, []);

  const page = await settle(outbound.campaigns.list());

  assert.deepEqual(
    page.items.map((item) => [item.sourceId, item.status, item.tags]),
    [
      ["2710262", "active", ["Q1"]],
      ["2710100", "paused", ["Q1"]],
    ]
  );
  assert.equal(page.complete, true, "GET /campaigns/ has no pages");
  const url = urlOf(requests[1]);
  assert.equal(url.pathname, `${API}/campaigns/`);
  assert.equal(url.searchParams.get("include_tags"), "true");
  assert.equal(url.searchParams.get("limit"), null);
  assert.equal(url.searchParams.get("offset"), null);
});

test("smartlead: every documented campaign status maps to a status", async () => {
  const expected = [
    ["DRAFTED", "draft"],
    ["DRAFT", "draft"],
    ["ACTIVE", "active"],
    ["PAUSED", "paused"],
    ["STOPPED", "paused"],
    ["ARCHIVED", "archived"],
    ["COMPLETED", "completed"],
    ["STARTED", "unknown"],
  ] as const;

  for (const [vendor, status] of expected) {
    const { outbound, settle } = harness(suite, () =>
      Response.json({ ...load("getCampaign.json"), status: vendor })
    );

    const campaign = await settle(outbound.campaigns.get(CAMPAIGN));
    assert.equal(campaign.status, status, vendor);
    assert.equal((campaign.raw as { status: string }).status, vendor);
  }
});

test("smartlead: a campaign is read from both documented envelopes", async () => {
  const { outbound, settle } = harness(suite, () =>
    Response.json(load("getCampaign.newdocs.json"))
  );

  const campaign = await settle(outbound.campaigns.get("123"));
  assert.equal(campaign.sourceId, "123");
  assert.equal(campaign.name, "Q2 2026 Outreach");
  assert.equal(campaign.createdAt, "2026-03-15T10:30:00.000Z");

  const broken = harness(suite, () => Response.json(["not", "an", "object"]));

  await assert.rejects(
    broken.settle(broken.outbound.campaigns.get("123", { retries: 0 })),
    { code: "Provider" }
  );
});

test("smartlead: the status filter is applied after fetching, and says so", async () => {
  const { outbound, requests, settle } = harness(suite);
  const page = await settle(outbound.campaigns.list({ status: "paused" }));
  assert.deepEqual(
    page.items.map((item) => item.sourceId),
    ["2710100"]
  );
  assert.equal(page.meta.evidence, "derived");
  assert.equal(urlOf(requests[0]).searchParams.get("status"), null);
});

test("smartlead: a sequence keeps steps, variants and labels from the older shape", async () => {
  const { outbound, requests, settle } = harness(suite);
  const sequence = await settle(outbound.campaign(CAMPAIGN).sequence());
  assert.equal(urlOf(requests[0]).pathname, `${API}/campaigns/372/sequences`);
  assert.equal(sequence.campaignRef, "smartlead:client-a:372");
  assert.equal(sequence.steps.length, 2);
  const [first, second] = sequence.steps;
  assert.equal(first?.index, 0);
  assert.equal(first?.action, "email");
  assert.equal(first?.delayDays, null, "no documented example shows a delay");
  assert.deepEqual(
    first?.variants.map((variant) => [
      variant.variantKey,
      variant.subject,
      variant.body,
    ]),
    [
      [
        "A",
        "Subject",
        "<p>Hi<br><br>How are you?<br><br>Hope you're doing good</p>",
      ],
      ["B", "Ema a", "<p>This is a new game a</p>"],
    ]
  );
  assert.notEqual(
    first?.variants[0]?.contentHash,
    first?.variants[1]?.contentHash
  );
  assert.equal(second?.index, 1);
  assert.deepEqual(
    second?.variants.map((variant) => [
      variant.variantKey,
      variant.subject,
      variant.body,
    ]),
    [["A", null, "<p>Bump up right!</p>"]],
    "a step without variants carries its own copy"
  );
});

const stepWith = (extra: Record<string, unknown>) => ({
  email_body: "<p>Hi</p>",
  sequence_variants: [],
  subject: "Hello",
  ...extra,
});

test("smartlead: a sequence is read from the wrapped shape, sorted, without deleted variants", async () => {
  const wrapped = harness(suite, () =>
    Response.json(load("getCampaignSequences.newdocs.json"))
  );

  const sequence = await wrapped.settle(
    wrapped.outbound.campaign("123").sequence()
  );

  assert.deepEqual(
    sequence.steps.map((step) => [
      step.index,
      step.variants[0]?.variantKey,
      step.variants[0]?.subject,
    ]),
    [
      [0, "A", "Quick question about {{company_name}}"],
      [1, "A", null],
    ]
  );

  const delays = harness(suite, () =>
    Response.json([
      stepWith({ seq_delay_details: { delayInDays: 4 }, seq_number: 3 }),
      stepWith({ seq_delay_details: { delay_in_days: 2 }, seq_number: 2 }),
      stepWith({
        seq_number: 1,
        sequence_variants: [
          { email_body: "old", is_deleted: true, variant_label: "A" },
          { email_body: "new", is_deleted: false, variant_label: "B" },
        ],
      }),
      stepWith({}),
    ])
  );

  const ordered = await delays.settle(
    delays.outbound.campaign("123").sequence()
  );

  assert.deepEqual(
    ordered.steps.map((item) => [
      item.index,
      item.delayDays,
      item.variants.map((variant) => variant.variantKey),
    ]),
    [
      [0, null, ["B"]],
      [1, 2, ["A"]],
      [2, 4, ["A"]],
      [3, null, ["A"]],
    ],
    "a step without seq_number keeps its position"
  );
});

test("smartlead: mailboxes page by offset and limit, and a full page means more", async () => {
  const { outbound, requests, settle } = harness(suite);

  const senders = await settle(
    outbound.senders.listAll({ limit: 2 }).toArray()
  );

  assert.deepEqual(
    senders.map((sender) => [sender.sourceId, sender.address]),
    [
      ["123", "person1@example.com"],
      ["124", "person2@example.com"],
      ["125", "person3@example.com"],
    ]
  );
  assert.deepEqual(
    requests.map((request) => [
      urlOf(request).pathname,
      urlOf(request).searchParams.get("offset"),
      urlOf(request).searchParams.get("limit"),
    ]),
    [
      [`${API}/email-accounts/`, "0", "2"],
      [`${API}/email-accounts/`, "2", "2"],
    ]
  );

  const clamped = harness(suite);
  await clamped.settle(clamped.outbound.senders.list({ limit: 500 }));
  assert.equal(
    urlOf(clamped.requests[0]).searchParams.get("limit"),
    "100",
    "the documented maximum"
  );
});

test("smartlead: a mailbox maps limit, connection and warmup, and never keeps a password", async () => {
  const { outbound, requests, settle } = harness(suite);
  const sender = await settle(outbound.senders.get(SENDER));
  assert.equal(urlOf(requests[0]).pathname, `${API}/email-accounts/123/`);
  assert.equal(sender.address, "person1@example.com");
  assert.equal(sender.name, "Alex Example");
  assert.equal(sender.dailyLimit, 50);
  assert.equal(sender.kind, "mailbox");
  assert.equal(sender.status, "active");
  assert.deepEqual(sender.warmup, { enabled: true, score: 95 });
  assert.deepEqual(await settle(outbound.sender(SENDER).warmup()), {
    enabled: true,
    score: 95,
  });

  const page = await settle(outbound.senders.list());
  assert.deepEqual(page.items[0]?.warmup, { enabled: true, score: 95 }, "95%");

  for (const record of [sender, ...page.items]) {
    const kept = JSON.stringify(record);
    assert.ok(!/password/iu.test(kept), "no password key survives");
    assert.ok(!kept.includes("REDACTED"), "no password value survives");
    assert.equal(
      (record.raw as { smtp_host: string }).smtp_host,
      "smtp.example.com",
      "the rest of the payload is kept"
    );
  }
});

test("smartlead: a mailbox's status comes from its two connection checks", async () => {
  const expected = [
    [{ is_imap_success: true, is_smtp_success: true }, "active"],
    [{ is_imap_success: true, is_smtp_success: false }, "disconnected"],
    [{ is_imap_success: false, is_smtp_success: true }, "disconnected"],
    [{ is_imap_success: null, is_smtp_success: null }, "unknown"],
  ] as const;

  for (const [checks, status] of expected) {
    const { outbound, settle } = harness(suite, () =>
      Response.json({ ...load("getEmailAccount.json"), ...checks })
    );

    const sender = await settle(outbound.senders.get(SENDER));
    assert.equal(sender.status, status, JSON.stringify(checks));
  }

  const warmups = [
    [{ status: "INACTIVE", warmup_reputation: "100%" }, false, 100],
    [{ status: "PAUSED", warmup_reputation: 88 }, false, 88],
    [{ status: "OTHER", warmup_reputation: "excellent" }, null, null],
  ] as const;

  for (const [details, enabled, score] of warmups) {
    const { outbound, settle } = harness(suite, () =>
      Response.json({
        ...load("getEmailAccount.json"),
        warmup_details: details,
      })
    );

    const sender = await settle(outbound.senders.get(SENDER));
    assert.deepEqual(sender.warmup, { enabled, score });
  }

  const none = harness(suite, () =>
    Response.json({ ...load("getEmailAccount.json"), warmup_details: null })
  );

  assert.equal(
    (await none.settle(none.outbound.senders.get(SENDER))).warmup,
    null
  );
});

test("smartlead: a campaign's mailboxes are read from both documented envelopes", async () => {
  const bare = harness(suite);

  const older = await bare.settle(
    bare.outbound.campaign(CAMPAIGN).senders.list()
  );

  assert.equal(
    urlOf(bare.requests[0]).pathname,
    `${API}/campaigns/372/email-accounts`
  );
  assert.deepEqual(
    older.items.map((sender) => [
      sender.sourceId,
      sender.address,
      sender.status,
      sender.dailyLimit,
      sender.warmup,
    ]),
    [
      ["24", "person1@example.com", "active", 100, null],
      ["25", "person2@example.com", "active", 100, null],
    ]
  );

  const wrapped = harness(suite, () =>
    Response.json(load("listCampaignEmailAccounts.newdocs.json"))
  );

  const newer = await wrapped.settle(
    wrapped.outbound.campaign(CAMPAIGN).senders.list()
  );

  assert.deepEqual(
    newer.items.map((sender) => [
      sender.sourceId,
      sender.address,
      sender.name,
      sender.status,
    ]),
    [
      ["2001", "person1@example.com", "Alex Example", "unknown"],
      ["2002", "person2@example.com", "Sam Example", "unknown"],
    ]
  );
});

test("smartlead: clients are listed as workspaces from both documented envelopes", async () => {
  const bare = harness(suite);
  const older = await bare.settle(bare.outbound.workspaces.list());
  assert.equal(urlOf(bare.requests[0]).pathname, `${API}/client/`);
  assert.deepEqual(
    older.items.map((workspace) => [workspace.sourceId, workspace.name]),
    [
      ["6", "Example Client 1"],
      ["298", "Example Client 2"],
    ]
  );

  const wrapped = harness(suite, () =>
    Response.json(load("listClients.newdocs.json"))
  );

  const newer = await wrapped.settle(wrapped.outbound.workspaces.list());
  assert.deepEqual(
    newer.items.map((workspace) => [workspace.sourceId, workspace.name]),
    [
      ["301", "Example Co"],
      ["302", "Example Two Co"],
    ]
  );
});

test("smartlead: the key rides in the URL only, and raw requests carry it too", async () => {
  const { outbound, requests, settle } = harness(suite);
  await settle(outbound.raw.get("/leads/fetch-categories"));
  const [request] = requests;
  assert.equal(urlOf(request).searchParams.get("api_key"), KEY);
  assert.equal(request?.headers.authorization, undefined);
  assert.equal(urlOf(request).pathname, `${API}/leads/fetch-categories`);

  const mutated = harness(suite);
  await mutated.settle(mutated.outbound.campaigns.get(CAMPAIGN));
  assert.equal(
    urlOf(mutated.requests[0]).searchParams.getAll("api_key").length,
    1
  );
});

test("smartlead: only the documented POST reads are declared as reads", () => {
  const { raw } = suite.make();

  const reads = [
    ["GET", "/campaigns/"],
    ["GET", "/campaigns/12/leads-export"],
    ["POST", "/master-inbox/inbox-replies"],
    ["POST", "/master-inbox/unread-replies"],
    ["POST", "/master-inbox/sent"],
    ["POST", "/master-inbox/important"],
    ["POST", "/master-inbox/assigned-me"],
    ["POST", "/master-inbox/archived"],
    ["POST", "/master-inbox/snoozed"],
    ["POST", "/master-inbox/reminders"],
    ["POST", "/master-inbox/scheduled"],
    ["POST", "/master-inbox/views"],
    ["POST", "/api/v1/master-inbox/sent/"],
    ["POST", "master-inbox/inbox-replies?fetch_message_history=true"],
    ["POST", "/campaigns/12/leads/filter"],
    [
      "POST",
      "/campaigns/12/message-history-for-leads/bbfbdsFGHlBr76ruhjvh6fhHL",
    ],
  ] as const;

  const writes = [
    ["POST", "/campaigns/12/leads"],
    ["POST", "/campaigns/create"],
    ["POST", "/campaigns/12/status"],
    ["POST", "/campaigns/abc/leads/filter"],
    ["POST", "/campaigns/12/message-history-for-leads/other"],
    ["POST", "/master-inbox/reply-email-thread"],
    ["POST", "/master-inbox/inbox-replies/extra"],
    ["POST", "/webhook/create"],
    ["POST", "/webhook/7/signing-secret"],
    ["PATCH", "/master-inbox/change-read-status"],
    ["PUT", "/webhook/update/7"],
    ["DELETE", "/webhook/delete"],
  ] as const;

  for (const [method, path] of reads) {
    assert.equal(raw.isRead(method, path), true, `${method} ${path}`);
  }

  for (const [method, path] of writes) {
    assert.equal(raw.isRead(method, path), false, `${method} ${path}`);
  }
});

test("smartlead: documented error bodies map to codes without the key", async () => {
  const cases = [
    [401, load("error.401.json"), "Unauthorized", /Invalid API Key/u],
    [404, load("error.404.campaign.json"), "NotFound", /Campaign not found/u],
    [
      400,
      load("error.400.analytics-by-date.json"),
      "Invalid",
      /max of 30days/u,
    ],
  ] as const;

  for (const [status, body, code, message] of cases) {
    const { outbound, settle } = harness(suite, () =>
      Response.json(body, { status })
    );

    await assert.rejects(
      settle(outbound.campaigns.get(CAMPAIGN, { retries: 0 })),
      (error: Error & { code: string; status: number }) => {
        assert.equal(error.code, code);
        assert.equal(error.status, status);
        assert.match(error.message, message);
        assert.ok(!error.message.includes(KEY));
        assert.ok(!error.message.includes("api_key"));

        return true;
      }
    );
  }
});

test("smartlead: the published limits are declared, with the safe default", async () => {
  const adapter = suite.make();
  assert.deepEqual(adapter.limits.windows, [{ perMs: 60_000, requests: 60 }]);
  assert.deepEqual(adapter.limits.lanes, {
    "all-leads-activities": [{ perMs: 60_000, requests: 10 }],
    "domain-wise-health": [{ perMs: 60_000, requests: 10 }],
    "leads-statistics": [{ perMs: 60_000, requests: 10 }],
  });
  assert.equal(adapter.limits.headers, undefined);
  assert.match(adapter.limits.source, /helpcenter\.smartlead\.ai/u);
  assert.match(adapter.limits.source, /2026-11-14/u);
  assert.equal(adapter.maturity, "unverified");
  assert.ok((adapter.caveats?.length ?? 0) > 0);

  const { outbound, settle } = harness(suite);
  await settle(outbound.campaigns.get(CAMPAIGN));
  const [snapshot] = await outbound.limits();
  assert.deepEqual(
    snapshot?.windows.map((window) => [
      window.lane,
      window.requests,
      window.perMs,
      window.used,
    ]),
    [
      ["default", 60, 60_000, 1],
      ["all-leads-activities", 10, 60_000, 0],
      ["domain-wise-health", 10, 60_000, 0],
      ["leads-statistics", 10, 60_000, 0],
    ],
    "an ordinary read uses no lane"
  );
});

test("smartlead: the factory reads its key and label from the environment", () => {
  const before = {
    key: process.env.SMARTLEAD_API_KEY,
    workspace: process.env.SMARTLEAD_WORKSPACE_ID,
  };

  try {
    delete process.env.SMARTLEAD_API_KEY;
    delete process.env.SMARTLEAD_WORKSPACE_ID;
    assert.throws(() => smartlead(), { code: "Unauthorized" });
    assert.equal(smartlead({ apiKey: KEY }).workspaceId, "default");

    process.env.SMARTLEAD_API_KEY = "sl_env_key_0123456789";
    process.env.SMARTLEAD_WORKSPACE_ID = "client-b";
    const adapter = smartlead();
    assert.deepEqual(adapter.secrets, ["sl_env_key_0123456789"]);
    assert.equal(adapter.workspaceId, "client-b");
    assert.equal(adapter.name, "smartlead");
    assert.equal(adapter.raw.baseUrl, "https://server.smartlead.ai/api/v1");
  } finally {
    process.env.SMARTLEAD_API_KEY = before.key;
    process.env.SMARTLEAD_WORKSPACE_ID = before.workspace;

    if (before.key === undefined) {
      delete process.env.SMARTLEAD_API_KEY;
    }

    if (before.workspace === undefined) {
      delete process.env.SMARTLEAD_WORKSPACE_ID;
    }
  }

  const narrowed = smartlead({
    apiKey: KEY,
    baseUrl: "https://proxy.example.com/api/v1",
    capabilities: { workspaces: false },
  });

  assert.equal(narrowed.capabilities?.workspaces, false);
  assert.equal(narrowed.capabilities?.sequence, true);
  assert.equal(narrowed.raw.baseUrl, "https://proxy.example.com/api/v1");
  assert.throws(() => smartlead({ apiKey: KEY, workspaceId: "a:b" }), {
    code: "Invalid",
  });
});
