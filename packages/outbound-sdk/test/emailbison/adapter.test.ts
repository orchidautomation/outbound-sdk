import assert from "node:assert/strict";
import { test } from "node:test";

import { emailbison } from "../../src/emailbison/index.ts";
import { OutboundError } from "../../src/index.ts";
import { harness, runAdapterSuite } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import { json } from "../helpers/http.ts";
import { CAMPAIGN, KEY, LEAD, ORIGIN, SENDER, suite } from "./suite.ts";

runAdapterSuite(suite);

const urlOf = (request: { url: string } | undefined): URL =>
  new URL(request?.url ?? "");

test("emailbison: the key is a bearer header, and the base URL is the customer's own instance", async () => {
  const { outbound, requests, settle } = harness(suite);
  await settle(outbound.campaigns.get(CAMPAIGN));
  const [request] = requests;
  assert.equal(request?.headers.authorization, `Bearer ${KEY}`);
  assert.equal(urlOf(request).origin, ORIGIN);
  assert.equal(urlOf(request).pathname, "/api/campaigns/1");
  assert.equal(urlOf(request).search, "", "the key is never in the URL");

  const own = emailbison({ apiKey: KEY, baseUrl: "https://send.example.com/" });
  assert.equal(own.raw.baseUrl, "https://send.example.com");
  assert.equal(own.maturity, "unverified");
});

test("emailbison: EMAILBISON_BASE_URL sets the instance when no baseUrl is passed", () => {
  const before = process.env.EMAILBISON_BASE_URL;
  process.env.EMAILBISON_BASE_URL = "https://mail.example.com";

  try {
    assert.equal(
      emailbison({ apiKey: KEY }).raw.baseUrl,
      "https://mail.example.com"
    );
  } finally {
    if (before === undefined) {
      delete process.env.EMAILBISON_BASE_URL;
    } else {
      process.env.EMAILBISON_BASE_URL = before;
    }
  }
});

test("emailbison: a campaign maps the documented fields, and lists page by cursor", async () => {
  const { outbound, requests, settle } = harness(suite);
  const campaign = await settle(outbound.campaigns.get(CAMPAIGN));
  assert.equal(campaign.sourceId, "1");
  assert.equal(campaign.name, "Example Campaign A");
  assert.equal(campaign.status, "active", "Active");
  assert.equal(campaign.channel, "email");
  assert.equal(campaign.createdAt, "2025-04-14T16:59:21.000Z");
  assert.deepEqual(campaign.tags, ["VIP"]);

  const all = await settle(outbound.campaigns.listAll().toArray());
  assert.deepEqual(
    all.map((item) => [item.sourceId, item.status]),
    [
      ["1", "active"],
      ["2", "active"],
      ["3", "paused"],
    ]
  );

  const first = urlOf(requests[1]);
  assert.equal(first.searchParams.get("pagination_type"), "cursor");
  assert.equal(first.searchParams.get("cursor"), null);
  const second = urlOf(requests[2]);
  assert.equal(second.searchParams.get("cursor"), "eyJpZCI6Mn0");
});

test("emailbison: every documented campaign status maps, whatever its case", async () => {
  const expected = [
    ["Draft", "draft"],
    ["launching", "active"],
    ["ACTIVE", "active"],
    ["queued", "active"],
    ["Paused", "paused"],
    ["stopped", "completed"],
    ["Completed", "completed"],
    ["archived", "archived"],
    ["failed", "unknown"],
    ["pending deletion", "unknown"],
    ["deleted", "unknown"],
    ["something new", "unknown"],
  ] as const;

  for (const [vendor, status] of expected) {
    const body = fixture("emailbison", "getCampaign.json") as {
      data: Record<string, unknown>;
    };

    const { outbound, settle } = harness(suite, () =>
      json({ data: { ...body.data, status: vendor } })
    );

    // oxlint-disable-next-line no-await-in-loop -- one status at a time keeps a failure readable.
    const campaign = await settle(outbound.campaigns.get(CAMPAIGN));
    assert.equal(campaign.status, status, vendor);
    assert.equal((campaign.raw as { status: string }).status, vendor);
  }
});

test("emailbison: a sender's campaigns are read from the sender, by page number", async () => {
  const { outbound, requests, settle } = harness(suite);

  const page = await settle(
    outbound.sender(SENDER).campaigns.list({ status: "active" })
  );

  assert.deepEqual(
    page.items.map((item) => item.sourceId),
    ["1", "2"]
  );
  const url = urlOf(requests[0]);
  assert.equal(url.pathname, "/api/sender-emails/1/campaigns");
  assert.equal(url.searchParams.get("pagination_type"), null);
  assert.equal(url.searchParams.get("status"), null, "filtered after fetching");
});

test("emailbison: a sequence groups variants under their step, in order", async () => {
  const { outbound, settle } = harness(suite);
  const sequence = await settle(outbound.campaign(CAMPAIGN).sequence());
  assert.equal(sequence.kind, "main");
  assert.equal(sequence.campaignRef, "emailbison:client-a:1");

  assert.deepEqual(
    sequence.steps.map((step) => [
      step.index,
      step.parentIndex,
      step.delayDays,
      step.variants.map((variant) => [variant.variantKey, variant.body]),
    ]),
    [
      [0, null, 1, [["A", "<p>Hi {FIRST_NAME},</p>"]]],
      [
        1,
        0,
        3,
        [
          ["A", "Following up."],
          ["B", "Circling back."],
        ],
      ],
    ]
  );
});

test("emailbison: a variant joins the step its variant_from_step_id names", async () => {
  const steps = [
    { email_body: "one", id: 1, order: "1", variant: false, wait_in_days: 0 },
    { email_body: "two", id: 2, order: "2", variant: false, wait_in_days: 2 },
    {
      email_body: "one-b",
      id: 3,
      order: "3",
      variant: true,
      variant_from_step_id: 1,
      wait_in_days: 0,
    },
  ];

  const { outbound, settle } = harness(suite, () =>
    json({ data: { sequence_id: 9, sequence_steps: steps } })
  );

  const sequence = await settle(outbound.campaign(CAMPAIGN).sequence());

  assert.deepEqual(
    sequence.steps.map((step) => step.variants.map((variant) => variant.body)),
    [["one", "one-b"], ["two"]]
  );
});

test("emailbison: senders map the documented fields and statuses", async () => {
  const { outbound, settle } = harness(suite);
  const senders = await settle(outbound.senders.listAll().toArray());

  assert.deepEqual(
    senders.map((sender) => [
      sender.sourceId,
      sender.address,
      sender.status,
      sender.mailProvider,
      sender.dailyLimit,
      sender.warmup,
    ]),
    [
      [
        "1",
        "sender1@example.com",
        "active",
        "google",
        31,
        { enabled: true, score: null },
      ],
      [
        "2",
        "sender2@example.com",
        "active",
        null,
        32,
        { enabled: false, score: null },
      ],
      [
        "3",
        "sender3@example.com",
        "disconnected",
        "microsoft",
        33,
        { enabled: true, score: null },
      ],
    ]
  );
  assert.deepEqual(senders[0]?.tags, ["Google"]);
  assert.equal(senders[0]?.name, "Sam Sender");
});

test("emailbison: a campaign's senders are read from the campaign", async () => {
  const { outbound, requests, settle } = harness(suite);
  const page = await settle(outbound.campaign(CAMPAIGN).senders.list());
  assert.equal(page.items.length, 2);
  assert.equal(urlOf(requests[0]).pathname, "/api/campaigns/1/sender-emails");
});

test("emailbison: sender health reads the sender, then its warmup over the last 7 days", async () => {
  const { outbound, requests, settle } = harness(suite);
  const health = await settle(outbound.sender(SENDER).health());
  assert.equal(health.connected, true);
  assert.equal(health.domain, "example.com");
  assert.deepEqual(health.warmup, {
    inbox: null,
    received: 52,
    score: 97,
    sent: 140,
    spam: 6,
  });
  assert.deepEqual(health.dns, {
    dkim: null,
    dmarc: null,
    mx: null,
    spf: null,
  });
  const warmup = urlOf(requests[1]);
  assert.equal(warmup.pathname, "/api/warmup/sender-emails/1");

  const start = Date.parse(
    `${warmup.searchParams.get("start_date")}T00:00:00Z`
  );

  const end = Date.parse(`${warmup.searchParams.get("end_date")}T00:00:00Z`);
  assert.equal((end - start) / 86_400_000, 7);
});

test("emailbison: leads map names, custom variables, engagement and verification status", async () => {
  const { outbound, settle } = harness(suite);
  const leads = await settle(outbound.leads.listAll().toArray());

  assert.deepEqual(
    leads.map((lead) => [
      lead.sourceId,
      lead.email,
      lead.status,
      lead.bounced,
      lead.unsubscribed,
      lead.replied,
      lead.progress,
      lead.campaignRef,
    ]),
    [
      [
        "101",
        "person1@example.com",
        "replied",
        null,
        null,
        true,
        "unknown",
        null,
      ],
      [
        "102",
        "person2@example.com",
        "bounced",
        true,
        null,
        false,
        "unknown",
        null,
      ],
      [
        "103",
        "person3@example.com",
        "unsubscribed",
        null,
        true,
        false,
        "unknown",
        null,
      ],
    ]
  );

  const [first] = leads;
  assert.equal(first?.firstName, "Alex");
  assert.equal(first?.company, "Example Co");
  assert.equal(first?.title, "Engineer");
  assert.equal(leads[2]?.title, null);
  assert.deepEqual(first?.custom, {
    company_website: "https://www.example.com",
    linkedin_url: "https://www.linkedin.com/in/example-person-1",
  });
  assert.deepEqual(first?.engagement, {
    clicks: null,
    lastContactedAt: null,
    lastOpenedAt: null,
    lastRepliedAt: null,
    opens: 2,
    replies: 1,
    repliedStepIndex: null,
    stepIndex: null,
  });
});

test("emailbison: a campaign's leads say where they are in it and whether they are interested", async () => {
  const { outbound, requests, settle } = harness(suite);

  const leads = await settle(
    outbound.campaign(CAMPAIGN).leads.listAll().toArray()
  );

  assert.deepEqual(
    leads.map((lead) => [
      lead.sourceId,
      lead.progress,
      lead.interest,
      lead.interestCategory,
      lead.campaignRef,
    ]),
    [
      ["101", "active", "Interested", "positive", "emailbison:client-a:1"],
      ["102", "paused", null, null, "emailbison:client-a:1"],
    ]
  );
  assert.equal(urlOf(requests[0]).pathname, "/api/campaigns/1/leads");
});

test("emailbison: the leadFields option reads a LinkedIn profile from a custom variable", async () => {
  const mapped = {
    ...suite,
    make: () =>
      emailbison({
        apiKey: KEY,
        leadFields: { linkedinUrl: "linkedin_url", website: "company_website" },
        workspaceId: "client-a",
      }),
  };

  const { outbound, settle } = harness(mapped);
  const lead = await settle(outbound.leads.get(LEAD));
  assert.equal(
    lead.linkedinUrl,
    "https://www.linkedin.com/in/example-person-1"
  );
  assert.equal(lead.website, "https://www.example.com");
});

test("emailbison: a lookup by email is one request for that address and never walks leads", async () => {
  const { outbound, requests, settle } = harness(suite);

  const page = await settle(
    outbound.leads.list({ email: "Person1@Example.com" })
  );

  assert.deepEqual(
    page.items.map((lead) => lead.sourceId),
    ["101"]
  );
  assert.equal(requests.length, 1);
  assert.equal(urlOf(requests[0]).pathname, "/api/leads/person1%40example.com");

  const missing = harness(suite, () =>
    json({ data: { message: "Not found" } }, 404)
  );

  const none = await missing.settle(
    missing.outbound.leads.list({ email: "nobody@example.com" })
  );

  assert.deepEqual(none.items, [], "a 404 is no lead");

  const other = harness(suite, () =>
    json({ data: { email: "someone-else@example.com", id: 7 } })
  );

  const loose = await other.settle(
    other.outbound.leads.list({ email: "person1@example.com" })
  );

  assert.deepEqual(loose.items, [], "another address is not the one asked for");

  const linkedin = harness(suite);

  const profile = await linkedin.settle(
    linkedin.outbound.leads.list({
      linkedinUrl: "https://www.linkedin.com/in/example-person-1",
    })
  );

  assert.deepEqual(profile.items, []);
  assert.equal(linkedin.requests.length, 0, "no read finds a LinkedIn profile");
});

test("emailbison: campaign settings combine the campaign's caps with its schedule", async () => {
  const { outbound, requests, settle } = harness(suite);
  const settings = await settle(outbound.campaign(CAMPAIGN).settings());
  assert.equal(settings.dailyLimit, 70);
  assert.equal(settings.dailyNewLeads, 20);
  assert.equal(settings.plainText, true);
  assert.deepEqual(settings.tracking, { clicks: null, opens: false });
  assert.deepEqual(settings.schedule, [
    {
      days: [1, 2, 3, 4, 5],
      from: "08:00",
      name: "Generated",
      timezone: "America/New_York",
      to: "17:00",
    },
  ]);
  assert.deepEqual(
    requests.map((request) => urlOf(request).pathname),
    ["/api/campaigns/1", "/api/campaigns/1/schedule"]
  );
});

test("emailbison: a campaign without a schedule has settings with no window", async () => {
  const { outbound, settle } = harness(suite, (request) =>
    request.url.endsWith("/schedule")
      ? json({ data: { message: "No schedule" } }, 404)
      : undefined
  );

  const settings = await settle(outbound.campaign(CAMPAIGN).settings());
  assert.deepEqual(settings.schedule, []);
  assert.equal(settings.dailyLimit, 70);
});

test("emailbison: a list answer without a data array is a Provider error, not an empty page", async () => {
  for (const body of [{}, { data: null }, { data: { id: 1 } }, "maintenance"]) {
    const { outbound, settle } = harness(suite, () => json(body));

    // oxlint-disable-next-line no-await-in-loop -- one body at a time keeps a failure readable.
    await assert.rejects(
      async () => await settle(outbound.campaigns.list({ retries: 0 })),
      (error) =>
        OutboundError.is(error) &&
        error.code === "Provider" &&
        error.message.includes("/api/campaigns"),
      JSON.stringify(body)
    );
  }
});

test("emailbison: lists, block list entries, tags and webhooks map the documented fields", async () => {
  const { outbound, settle } = harness(suite);

  const lists = await settle(outbound.lists.listAll().toArray());
  assert.deepEqual(
    lists.map((list) => [list.sourceId, list.name, list.size, list.kind]),
    [
      ["1", "Q1 Prospects", 95, "leads"],
      ["2", "Warm Leads", 0, "leads"],
      ["3", "Conference List", 38, "leads"],
    ]
  );

  const blocked = await settle(outbound.blocklist.listAll().toArray());
  assert.deepEqual(
    blocked.map((entry) => [entry.sourceId, entry.kind, entry.value]),
    [
      ["email-1", "email", "blocked1@example.com"],
      ["email-2", "email", "blocked2@example.com"],
      ["email-3", "email", "blocked3@example.com"],
      ["domain-1", "domain", "example.net"],
      ["domain-2", "domain", "example.org"],
    ]
  );

  const tags = await settle(outbound.tags.listAll().toArray());
  assert.deepEqual(
    tags.map((tag) => tag.name),
    ["Important", "Interested", "Meeting Booked"]
  );

  const hooks = await settle(outbound.webhooks.listAll().toArray());
  assert.deepEqual(
    hooks.map((hook) => [hook.sourceId, hook.events, hook.eventTypes]),
    [
      ["1", ["email_sent", "email_opened"], ["message.opened", "message.sent"]],
      [
        "2",
        ["lead_replied", "lead_interested", "something_new"],
        ["reply.categorized", "reply.received"],
      ],
      ["3", ["tag_attached"], []],
    ]
  );
  assert.equal(hooks[0]?.url, "https://hooks.example.com/webhooks");
  assert.equal(hooks[0]?.active, null);
});

test("emailbison: workspaces never keep the webhook signing secret", async () => {
  const { outbound, settle } = harness(suite);
  const page = await settle(outbound.workspaces.list());

  assert.deepEqual(
    page.items.map((workspace) => [workspace.sourceId, workspace.name]),
    [
      ["1", "Example Agency"],
      ["2", "Example Client"],
    ]
  );
  assert.ok(!JSON.stringify(page.items).includes("webhooks_sig"));
  assert.ok(!JSON.stringify(page.items).includes("webhooks_secret_key"));
});
