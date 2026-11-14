import assert from "node:assert/strict";
import { test } from "node:test";

import { OutboundError } from "../../src/index.ts";
import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import { CAMPAIGN, LIST, SENDER, suite } from "./suite.ts";

const bodyOf = (request: { body: string | undefined } | undefined): unknown =>
  JSON.parse(request?.body ?? "{}");

const pathOf = (request: { url: string }): string =>
  new URL(request.url).pathname.replace("/api/public", "");

const isCode =
  (code: string) =>
  (error: unknown): boolean =>
    OutboundError.is(error) && error.code === code;

test("heyreach: lead lists map their name, kind, size and creation time, and page by offset", async () => {
  const { outbound, requests, settle } = harness(suite);
  const lists = await settle(outbound.lists.listAll().toArray());
  assert.deepEqual(
    lists.map((list) => [
      list.sourceId,
      list.name,
      list.kind,
      list.size,
      list.createdAt,
    ]),
    [
      ["3457", "Example List 1", "leads", 120, "2024-08-29T09:34:56.541Z"],
      [
        "3458",
        "Example Company List",
        "companies",
        45,
        "2024-09-02T11:00:00.250Z",
      ],
      ["3459", "Example List 3", "leads", 0, "2024-09-05T08:15:30.000Z"],
    ]
  );
  assert.equal(lists[0]?.ref, "heyreach:client-a:3457");
  assert.deepEqual(
    requests.map((request) => [
      request.method,
      pathOf(request),
      bodyOf(request),
    ]),
    [
      ["POST", "/list/GetAll", { limit: 100, offset: 0 }],
      ["POST", "/list/GetAll", { limit: 100, offset: 2 }],
    ]
  );
});

test("heyreach: a list's leads carry tags, custom fields, the newest auto-tag and a lowercased email", async () => {
  const { outbound, requests, settle } = harness(suite);
  const page = await settle(outbound.list(LIST).leads.list());
  assert.deepEqual(bodyOf(requests[0]), {
    limit: 1000,
    listId: 3457,
    offset: 0,
  });
  assert.equal(pathOf(requests[0] ?? { url: "" }), "/list/GetLeadsFromList");
  const [first, second] = page.items;
  assert.ok(first && second);
  const { provider, raw, ref, schemaVersion, workspaceId, ...mapped } = first;
  assert.equal(ref, `heyreach:client-a:${first.sourceId}`);
  assert.deepEqual(mapped, {
    campaignRef: null,
    company: "Example Co 11",
    createdAt: null,
    custom: { favorite_color: "blue", plan: "growth" },
    // emailAddress wins over the enriched and the custom address.
    email: "listed11@example.com",
    engagement: null,
    firstName: "Alex",
    // The newest auto-tag.
    interest: "Interested",
    lastName: "Listed",
    linkedinUrl: "https://www.linkedin.com/in/example-person-11",
    // The profile URL is the id, as everywhere else.
    sourceId: "https://www.linkedin.com/in/example-person-11",
    // A list row carries no status.
    status: "unknown",
    tags: ["priority", "warm"],
    title: "Position 11",
  });
  assert.equal(second.email, "custom12@example.com", "the last fallback");
  assert.equal(second.interest, null);
  assert.deepEqual(second.tags, []);
  assert.deepEqual(second.custom, {});
});

test("heyreach: a list's leads page by offset, and the third email source is the enriched one", async () => {
  const { outbound, requests, settle } = harness(suite);

  const leads = await settle(
    outbound.list(LIST).leads.listAll({ limit: 5000 }).toArray()
  );

  assert.deepEqual(
    leads.map((lead) => [lead.firstName, lead.email, lead.tags]),
    [
      ["Alex", "listed11@example.com", ["priority", "warm"]],
      ["Sam", "custom12@example.com", []],
      ["Jo", "enriched13@example.com", ["cold"]],
    ]
  );
  assert.deepEqual(
    requests.map((request) => bodyOf(request)),
    [
      { limit: 1000, listId: 3457, offset: 0 },
      { limit: 1000, listId: 3457, offset: 2 },
    ],
    "the page size is held to the documented 1000"
  );
});

test("heyreach: a date range on a list's leads filters by when the lead was added, on the server", async () => {
  const { outbound, requests, settle } = harness(suite);
  assert.equal(outbound.capabilities["leads.since"], "server");

  await settle(
    outbound.list(LIST).leads.list({
      limit: 10,
      since: "2026-01-01T00:00:00Z",
      until: "2026-02-01T00:00:00Z",
    })
  );
  await settle(outbound.list(LIST).leads.list({ until: "2026-03-01" }));

  assert.deepEqual(
    requests.map((request) => bodyOf(request)),
    [
      {
        createdFrom: "2026-01-01T00:00:00.000Z",
        createdTo: "2026-02-01T00:00:00.000Z",
        limit: 10,
        listId: 3457,
        offset: 0,
      },
      {
        createdTo: "2026-03-01T00:00:00.000Z",
        limit: 1000,
        listId: 3457,
        offset: 0,
      },
    ]
  );
});

test("heyreach: a list id that is not a whole number is refused before any request", async () => {
  const { outbound, requests } = harness(suite);
  await assert.rejects(
    async () => await outbound.list("my-list").leads.list({ retries: 0 }),
    isCode("Invalid")
  );
  assert.equal(requests.length, 0);
});

test("heyreach: an auto-tag without a time loses to one with a time, and odd tags and fields are dropped", async () => {
  const body = fixture("heyreach", "getLeadsFromList.json") as {
    items: Record<string, unknown>[];
  };

  const [lead] = body.items;

  const { outbound, settle } = harness(suite, () =>
    Response.json({
      items: [
        {
          ...lead,
          autoTags: [
            { name: "Generic" },
            { creationTime: "2026-01-01T00:00:00Z", name: "Not Interested" },
          ],
          customFields: [
            { name: "kept", value: 7 },
            { name: "", value: "no name" },
            { name: "empty", value: null },
          ],
          tags: ["kept", 4, null, " "],
        },
      ],
      totalCount: 1,
    })
  );

  const [mapped] = (await settle(outbound.list(LIST).leads.list())).items;
  assert.equal(mapped?.interest, "Not Interested");
  assert.deepEqual(mapped?.custom, { kept: "7" });
  assert.deepEqual(mapped?.tags, ["kept", "4"]);
});

test("heyreach: the blacklist is leads, then companies, each entry with its own kind and value", async () => {
  const { outbound, requests, settle } = harness(suite);
  const entries = await settle(outbound.blocklist.listAll().toArray());
  assert.deepEqual(
    entries.map((entry) => [
      entry.sourceId,
      entry.kind,
      entry.value,
      entry.createdAt,
    ]),
    [
      [
        "lead-1",
        "linkedin",
        "https://www.linkedin.com/in/example-blocked-1",
        "2026-09-16T12:00:01.000Z",
      ],
      ["lead-2", "email", "blocked2@example.com", "2026-09-16T12:00:02.000Z"],
      ["lead-3", "other", "Blocked Three", "2026-09-16T12:00:03.000Z"],
      [
        "company-1",
        "company",
        "Example Blocked Co",
        "2026-09-17T08:00:00.000Z",
      ],
      [
        "company-2",
        "company",
        "https://www.linkedin.com/company/example-pending-co",
        "2026-09-18T09:30:00.000Z",
      ],
    ],
    "lead 1 and company 1 share a number, so the id says which list"
  );
  assert.deepEqual(
    requests.map((request) => [
      request.method,
      pathOf(request),
      bodyOf(request),
    ]),
    [
      ["POST", "/blacklist/GetLeads", { limit: 100, offset: 0 }],
      ["POST", "/blacklist/GetLeads", { limit: 100, offset: 2 }],
      ["POST", "/blacklist/GetCompanies", { limit: 100, offset: 0 }],
    ]
  );
});

test("heyreach: blacklisted companies page by offset too, and an entry with nothing to match is skipped", async () => {
  const { outbound, requests, settle } = harness(suite, (request) => {
    const { offset } = bodyOf(request) as { offset: number };

    if (request.url.endsWith("/blacklist/GetLeads")) {
      return Response.json({
        items: [{ id: 9 }, { email: "noid@example.com" }],
        totalCount: 2,
      });
    }

    return Response.json({
      items: [{ companyName: `Example Co ${offset}`, id: offset + 1 }, {}],
      totalCount: 4,
    });
  });

  const entries = await settle(outbound.blocklist.listAll().toArray());
  assert.deepEqual(
    entries.map((entry) => [entry.sourceId, entry.value]),
    [
      ["company-1", "Example Co 0"],
      ["company-3", "Example Co 2"],
    ]
  );
  assert.deepEqual(
    requests.map((request) => [pathOf(request), bodyOf(request)]),
    [
      ["/blacklist/GetLeads", { limit: 100, offset: 0 }],
      ["/blacklist/GetCompanies", { limit: 100, offset: 0 }],
      ["/blacklist/GetCompanies", { limit: 100, offset: 2 }],
    ]
  );
});

test("heyreach: webhooks map one event each, and never ask for the custom headers", async () => {
  const { outbound, requests, settle } = harness(suite);
  const webhooks = await settle(outbound.webhooks.listAll().toArray());
  assert.deepEqual(
    webhooks.map((webhook) => [
      webhook.sourceId,
      webhook.name,
      webhook.url,
      webhook.events,
      webhook.active,
      webhook.campaignRefs,
    ]),
    [
      [
        "123",
        "Example Webhook 1",
        "https://hooks.example.com/heyreach/one",
        ["CONNECTION_REQUEST_SENT"],
        true,
        ["heyreach:client-a:274079"],
      ],
      [
        "124",
        "Example Webhook 2",
        "https://hooks.example.com/heyreach/two",
        ["EVERY_MESSAGE_REPLY_RECEIVED"],
        false,
        [],
      ],
      [
        "125",
        "Example Webhook 3",
        "https://hooks.example.com/heyreach/three",
        ["CAMPAIGN_COMPLETED"],
        true,
        ["heyreach:client-a:274079", "heyreach:client-a:274080"],
      ],
    ],
    "a webhook for two campaigns names both"
  );
  assert.equal(webhooks[0]?.createdAt, null);
  assert.deepEqual(
    requests.map((request) => [pathOf(request), bodyOf(request)]),
    [
      [
        "/webhooks/GetAllWebhooks",
        { includeCustomHeaders: false, limit: 100, offset: 0 },
      ],
      [
        "/webhooks/GetAllWebhooks",
        { includeCustomHeaders: false, limit: 100, offset: 2 },
      ],
    ]
  );
});

test("heyreach: a campaign's webhooks are the ones limited to it and the ones for every campaign", async () => {
  const { outbound, settle } = harness(suite);

  const forCampaign = async (campaignId: string): Promise<string[]> => {
    const webhooks = await settle(
      outbound.webhooks.listAll({ campaignId }).toArray()
    );

    return webhooks.map((webhook) => webhook.sourceId);
  };

  assert.deepEqual(await forCampaign(CAMPAIGN), ["123", "124", "125"]);
  assert.deepEqual(await forCampaign("274080"), ["124", "125"]);
  assert.deepEqual(await forCampaign("999"), ["124"]);
});

test("heyreach: a webhook without an event, a name or a state maps them as empty", async () => {
  const { outbound, settle } = harness(suite, () =>
    Response.json({
      items: [
        { campaignIds: null, id: 7, webhookUrl: "https://hooks.example.com/x" },
      ],
      totalCount: 1,
    })
  );

  const [webhook] = (await settle(outbound.webhooks.list())).items;
  assert.deepEqual(webhook?.events, []);
  assert.equal(webhook?.name, null);
  assert.equal(webhook?.active, null);
  assert.deepEqual(webhook?.campaignRefs, []);
});

test("heyreach: a sender's health is its connection state, with no DNS, domain or warmup", async () => {
  const { outbound, requests, settle } = harness(suite);
  const health = await settle(outbound.sender(SENDER).health());
  assert.equal(requests[0]?.method, "GET");
  assert.equal(
    pathOf(requests[0] ?? { url: "" }),
    "/li_account/GetAccountStatus/1101"
  );
  assert.equal(health.sourceId, SENDER);
  assert.equal(health.senderRef, "heyreach:client-a:1101");
  assert.equal(health.connected, false, "Disconnected");
  assert.deepEqual(health.issues, ["Session expired, sign in again"]);
  assert.deepEqual(health.dns, {
    dkim: null,
    dmarc: null,
    mx: null,
    spf: null,
  });
  assert.equal(health.domain, null);
  assert.equal(health.blacklisted, null);
  assert.equal(health.checkedAt, null);
  assert.equal(health.warmup, null);
});

test("heyreach: only the two known account statuses decide connected", async () => {
  const cases = [
    ["Connected", true],
    ["Disconnected", false],
    ["PinRequired", null],
    [null, null],
  ] as const;

  for (const [status, connected] of cases) {
    const { outbound, settle } = harness(suite, () =>
      Response.json({ accountId: 1101, failureReason: null, status })
    );

    const health = await settle(outbound.sender(SENDER).health());
    assert.equal(health.connected, connected, String(status));
    assert.deepEqual(health.issues, []);
  }
});

test("heyreach: a sender id that is not a whole number has no health to read", async () => {
  const { outbound, requests } = harness(suite);
  await assert.rejects(
    async () => await outbound.sender("alex").health({ retries: 0 }),
    isCode("Invalid")
  );
  assert.equal(requests.length, 0);
});

test("heyreach: a campaign's senders are the account list narrowed to the campaign's account ids", async () => {
  const { adapter, outbound, requests, settle } = harness(suite);
  assert.equal(outbound.capabilities["senders.byCampaign"], true);

  const senders = await settle(
    outbound.campaign(CAMPAIGN).senders.listAll().toArray()
  );

  assert.deepEqual(
    senders.map((sender) => sender.sourceId),
    ["1101", "1103"],
    "1102 is in the workspace but not on the campaign"
  );
  assert.equal(senders[0]?.kind, "linkedin");
  assert.deepEqual(
    requests.map((request) => [
      request.method,
      pathOf(request),
      request.method === "GET"
        ? new URL(request.url).searchParams.get("campaignId")
        : bodyOf(request),
    ]),
    [
      ["GET", "/campaign/GetById", CAMPAIGN],
      ["POST", "/li_account/GetAll", { limit: 100, offset: 0 }],
      ["POST", "/li_account/GetAll", { limit: 100, offset: 2 }],
    ],
    "the campaign is read once; later pages carry its account ids"
  );
  assert.ok(adapter.costs?.["senders.list"]);
});

test("heyreach: a campaign with no accounts has no senders, and the account list is not read", async () => {
  const { outbound, requests, settle } = harness(suite, () =>
    Response.json({ campaignAccountIds: [], id: 274_079 })
  );

  const page = await settle(outbound.campaign(CAMPAIGN).senders.list());
  assert.deepEqual(page.items, []);
  assert.equal(requests.length, 1);
});

test("heyreach: a campaign's senders need a whole-number campaign id", async () => {
  const { outbound, requests } = harness(suite);
  await assert.rejects(
    async () => await outbound.campaign("spring").senders.list({ retries: 0 }),
    isCode("Invalid")
  );
  assert.equal(requests.length, 0);
});
