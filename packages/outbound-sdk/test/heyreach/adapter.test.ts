import assert from "node:assert/strict";
import { test } from "node:test";

import { heyreach } from "../../src/heyreach/index.ts";
import { OutboundError } from "../../src/index.ts";
import { harness, runAdapterSuite } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import { CAMPAIGN, KEY, SENDER, suite } from "./suite.ts";

runAdapterSuite(suite);

const bodyOf = (request: { body: string | undefined } | undefined): unknown =>
  JSON.parse(request?.body ?? "{}");

const isCode =
  (code: string, status?: number) =>
  (error: unknown): boolean =>
    OutboundError.is(error) &&
    error.code === code &&
    (status === undefined || error.status === status);

test("heyreach: a campaign maps the documented fields and is a LinkedIn campaign", async () => {
  const { outbound, requests, settle } = harness(suite);
  const campaign = await settle(outbound.campaigns.get(CAMPAIGN));
  const url = new URL(requests[0]?.url ?? "");
  assert.equal(requests[0]?.method, "GET");
  assert.equal(url.pathname, "/api/public/campaign/GetById");
  assert.equal(url.searchParams.get("campaignId"), CAMPAIGN);
  assert.equal(campaign.sourceId, "274079", "the integer id becomes a string");
  assert.equal(campaign.name, "My First Campaign");
  assert.equal(campaign.status, "active", "IN_PROGRESS");
  assert.equal(campaign.channel, "linkedin");
  assert.equal(campaign.createdAt, "2025-12-01T08:06:15.463Z");
  assert.deepEqual(campaign.tags, []);
});

test("heyreach: every documented campaign status maps to a status", async () => {
  const expected = [
    ["DRAFT", "draft"],
    ["IN_PROGRESS", "active"],
    ["PAUSED", "paused"],
    ["FINISHED", "completed"],
    ["CANCELED", "completed"],
    ["FAILED", "unknown"],
    ["STARTING", "active"],
    ["SCHEDULED", "draft"],
    ["SOMETHING_NEW", "unknown"],
  ] as const;

  for (const [vendor, status] of expected) {
    const { outbound, settle } = harness(suite, () =>
      Response.json({
        ...(fixture("heyreach", "getCampaign.json") as object),
        status: vendor,
      })
    );

    const campaign = await settle(outbound.campaigns.get(CAMPAIGN));
    assert.equal(campaign.status, status, vendor);
    assert.equal(
      (campaign.raw as { status: string }).status,
      vendor,
      "the original is kept in raw"
    );
  }
});

test("heyreach: campaigns are listed with POST and paged by an offset computed from totalCount", async () => {
  const { outbound, requests, settle } = harness(suite);
  const first = await settle(outbound.campaigns.list());
  assert.equal(requests[0]?.method, "POST");
  assert.deepEqual(bodyOf(requests[0]), { limit: 100, offset: 0 });
  assert.equal(first.items.length, 2);
  assert.ok(first.cursor, "2 of totalCount 3 leaves another page");

  const last = await settle(outbound.campaigns.list({ cursor: first.cursor }));
  assert.deepEqual(bodyOf(requests[1]), { limit: 100, offset: 2 });
  assert.equal(last.items[0]?.sourceId, "274081");
  assert.equal(last.cursor, undefined, "offset 2 + 1 item reaches totalCount");
});

test("heyreach: the page size is clamped to the documented maximum of 100", async () => {
  const { outbound, requests, settle } = harness(suite);
  await settle(outbound.campaigns.list({ limit: 500 }));
  await settle(outbound.senders.list({ limit: 25 }));
  assert.equal((bodyOf(requests[0]) as { limit: number }).limit, 100);
  assert.equal((bodyOf(requests[1]) as { limit: number }).limit, 25);
});

test("heyreach: a list without totalCount or without items ends the walk", async () => {
  for (const body of [
    { items: [{ id: 1, name: "One", status: "DRAFT" }] },
    { items: [], totalCount: 40 },
    ["unexpected"],
  ]) {
    const { outbound, settle } = harness(suite, () => Response.json(body));
    const page = await settle(outbound.campaigns.list());
    assert.equal(page.cursor, undefined, JSON.stringify(body));
  }
});

test("heyreach: the status filter is sent as HeyReach's status names", async () => {
  const expected = [
    ["active", ["IN_PROGRESS", "STARTING"]],
    ["completed", ["CANCELED", "FINISHED"]],
    ["draft", ["DRAFT", "SCHEDULED"]],
    ["paused", ["PAUSED"]],
    ["unknown", ["FAILED"]],
  ] as const;

  for (const [status, statuses] of expected) {
    const { outbound, requests, settle } = harness(suite);
    await settle(outbound.campaigns.list({ status }));
    assert.deepEqual(
      (bodyOf(requests[0]) as { statuses: string[] }).statuses,
      statuses,
      status
    );
  }

  const { outbound, requests, settle } = harness(suite);

  const archived = await settle(
    outbound.campaigns.list({ status: "archived" })
  );

  assert.deepEqual(archived.items, []);
  assert.equal(requests.length, 0, "HeyReach has no archived campaigns");
});

test("heyreach: a sender is a LinkedIn account with a profile URL and no address", async () => {
  const { outbound, requests, settle } = harness(suite);
  const sender = await settle(outbound.senders.get(SENDER));
  const url = new URL(requests[0]?.url ?? "");
  assert.equal(url.pathname, "/api/public/li_account/GetById");
  assert.equal(url.searchParams.get("accountId"), "1101");
  assert.equal(sender.sourceId, "1101");
  assert.equal(sender.kind, "linkedin");
  assert.equal(sender.address, null);
  assert.equal(
    sender.linkedinUrl,
    "https://www.linkedin.com/in/example-person-1"
  );
  assert.equal(sender.name, "Alex Example");
  assert.equal(sender.status, "active", "authIsValid and isActive are true");
  assert.equal(sender.dailyLimit, null, "no limit is documented as daily");
  assert.equal(sender.warmup, null);
  assert.equal(
    (sender.raw as { accountLimits: { connectioRequestLimit: number } })
      .accountLimits.connectioRequestLimit,
    20,
    "the vendor's misspelled field is kept as it is"
  );
});

test("heyreach: a sender's status comes from authIsValid, then isActive", async () => {
  const cases = [
    [{ authIsValid: false, isActive: true }, "disconnected"],
    [{ authIsValid: true, isActive: false }, "paused"],
    [{ authIsValid: true, isActive: true }, "active"],
    [{ authIsValid: null, isActive: null }, "unknown"],
  ] as const;

  for (const [flags, status] of cases) {
    const { outbound, settle } = harness(suite, () =>
      Response.json({
        ...(fixture("heyreach", "getLinkedInAccount.json") as object),
        ...flags,
        firstName: null,
        lastName: null,
      })
    );

    const sender = await settle(outbound.senders.get(SENDER));
    assert.equal(sender.status, status, JSON.stringify(flags));
    assert.equal(sender.name, null);
  }
});

test("heyreach: senders are listed with POST by offset", async () => {
  const { outbound, requests, settle } = harness(suite);
  const senders = await settle(outbound.senders.listAll().toArray());
  assert.deepEqual(
    senders.map((sender) => sender.sourceId),
    ["1101", "1102", "1103"]
  );
  assert.deepEqual(
    requests.map((request) => [request.method, bodyOf(request)]),
    [
      ["POST", { limit: 100, offset: 0 }],
      ["POST", { limit: 100, offset: 2 }],
    ]
  );
});

test("heyreach: CAMPAIGN_API_NOT_ENABLED is Unsupported, and a missing campaign stays NotFound", async () => {
  const cases = [
    ["CAMPAIGN_API_NOT_ENABLED", "Unsupported"],
    ["CAMPAIGN_NOT_FOUND", "NotFound"],
  ] as const;

  for (const [errorCode, code] of cases) {
    const { outbound, settle } = harness(suite, () =>
      Response.json(
        { errorCode, errorMessage: "The request was refused" },
        { status: 404 }
      )
    );

    const error = await settle(
      outbound
        .campaign(CAMPAIGN)
        .sequence()
        .catch((error_: unknown) => error_)
    );

    assert.ok(isCode(code, 404)(error), errorCode);
    assert.equal((error as OutboundError).provider, "heyreach");
  }
});

test("heyreach: documented error bodies give the error its message", async () => {
  const cases = [
    [{ errorMessage: "Invalid cursor format." }, 400, "Invalid"],
    [
      { detail: "Too many requests", status: 429, title: "Rate limited" },
      429,
      "RateLimited",
    ],
  ] as const;

  for (const [body, status, code] of cases) {
    const { outbound, settle } = harness(suite, () =>
      Response.json(body, { status })
    );

    const error = await settle(
      outbound.campaigns
        .get(CAMPAIGN, { retries: 0 })
        .catch((error_: unknown) => error_)
    );

    assert.ok(isCode(code, status)(error));
    assert.match(
      (error as Error).message,
      /Invalid cursor format\.|Too many requests/u
    );
  }
});

test("heyreach: the documented limit is 300 a minute, with a lane for the Organization API and no headers", async () => {
  const { adapter, outbound, settle } = harness(suite);
  await settle(outbound.campaigns.list());
  const [snapshot] = await outbound.limits();
  assert.deepEqual(
    snapshot?.windows.map((window) => [
      window.lane,
      window.requests,
      window.perMs,
      window.used,
    ]),
    [
      ["default", 300, 60_000, 1],
      ["organization", 300, 60_000, 0],
    ]
  );
  assert.equal(adapter.limits.headers, undefined);
  assert.match(adapter.limits.source, /do not say whether the limit is per/u);
});

test("heyreach: raw allows exactly the documented reads", () => {
  const { raw } = heyreach({ apiKey: KEY });

  const postReads = [
    "/campaign/GetAll",
    "/campaign/GetLeadsFromCampaign",
    "/campaign/GetCampaignsForLead",
    "/li_account/GetAll",
    "/list/GetAll",
    "/list/GetLeadsFromList",
    "/list/GetCompaniesFromList",
    "/list/GetListsForLead",
    "/lead/GetLead",
    "/lead/GetTags",
    "/inbox/GetConversationsV2",
    "/inbox/GetConversationsV3",
    "/stats/GetOverallStats",
    "/stats/GetOverallStatsByCampaign",
    "/webhooks/GetAllWebhooks",
    "/blacklist/GetLeads",
    "/blacklist/GetCompanies",
    "/MyNetwork/GetMyNetworkForSender",
    "/MyNetwork/IsConnection",
    "/management/organizations/users",
    "/management/organizations/users/workspaces/12",
    "/management/organizations/linkedin-accounts",
  ];

  for (const path of postReads) {
    assert.equal(raw.isRead("POST", path), true, path);
  }

  const postWrites = [
    "/campaign/Pause?campaignId=1",
    "/campaign/Resume",
    "/campaign/StartCampaign",
    "/campaign/Create",
    "/campaign/AddLeadsToCampaignV2",
    "/campaign/StopLeadInCampaign",
    "/campaign/UpdateSequence",
    "/inbox/SendMessage",
    "/inbox/SetSeenStatus",
    "/lead/AddTags",
    "/lead/ReplaceTags",
    "/list/AddLeadsToListV2",
    "/list/CreateEmptyList",
    "/li_account/Connect",
    "/webhooks/CreateWebhook",
    "/blacklist/AddLeads",
    "/blacklist/RemoveLeads",
    "/enrichment/enrich-email",
    "/management/organizations/workspaces",
    "/management/organizations/api-keys/workspaces/12",
    "/management/organizations/users/invite/admins",
  ];

  for (const path of postWrites) {
    assert.equal(raw.isRead("POST", path), false, path);
  }

  assert.equal(raw.isRead("GET", "/auth/CheckApiKey"), true);
  assert.equal(raw.isRead("GET", "/inbox/GetChatroom/1101/abc"), true);
  assert.equal(
    raw.isRead("GET", "/api/public/campaign/GetById?campaignId=1"),
    true,
    "a full path with a query is normalized"
  );
  assert.equal(raw.isRead("POST", "/api/public/campaign/GetAll/"), true);
  assert.equal(
    raw.isRead("GET", "/management/organizations/api-keys/workspaces/12"),
    false,
    "the read that returns API keys is refused"
  );
  assert.equal(
    raw.isRead("GET", "/li_account/GetAccountProxy/1101"),
    false,
    "the read that returns a proxy password is refused"
  );
  assert.equal(raw.isRead("DELETE", "/webhooks/DeleteWebhook"), false);
  assert.equal(raw.isRead("PATCH", "/webhooks/UpdateWebhook"), false);
  assert.equal(raw.isRead("PUT", "/voice/SetSenderVoice/1"), false);
});

test("heyreach: raw reads the inbox with POST and checks the key, and refuses to send", async () => {
  const { outbound, requests, settle } = harness(
    suite,
    () => new Response("", { status: 200 })
  );

  assert.equal(await settle(outbound.raw.get("/auth/CheckApiKey")), null);
  await settle(
    outbound.raw.request("POST", "/inbox/GetConversationsV2", {
      body: { filters: {}, limit: 10, offset: 0 },
    })
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[1]?.headers["x-api-key"], KEY);
  assert.equal(
    requests[1]?.url,
    "https://api.heyreach.io/api/public/inbox/GetConversationsV2"
  );
  await assert.rejects(
    async () => await outbound.raw.request("POST", "/inbox/SendMessage"),
    isCode("Unsupported")
  );
  assert.equal(requests.length, 2);
});

test("heyreach: the key comes from the option or the environment, and is required", () => {
  const previous = process.env.HEYREACH_API_KEY;
  delete process.env.HEYREACH_API_KEY;

  try {
    assert.throws(
      () => heyreach(),
      (error) =>
        isCode("Unauthorized")(error) &&
        /pass apiKey or set HEYREACH_API_KEY/u.test((error as Error).message)
    );
    process.env.HEYREACH_API_KEY = "hr_env_key_0123456789";
    process.env.HEYREACH_WORKSPACE_ID = "from-env";
    const adapter = heyreach({ baseUrl: "https://proxy.example.com/hr" });
    assert.deepEqual(adapter.secrets, ["hr_env_key_0123456789"]);
    assert.equal(adapter.workspaceId, "from-env");
    assert.equal(adapter.raw.baseUrl, "https://proxy.example.com/hr");
    delete process.env.HEYREACH_WORKSPACE_ID;
    assert.equal(heyreach().workspaceId, "default");
  } finally {
    delete process.env.HEYREACH_WORKSPACE_ID;

    if (previous === undefined) {
      delete process.env.HEYREACH_API_KEY;
    } else {
      process.env.HEYREACH_API_KEY = previous;
    }
  }
});

test("heyreach: a response that is not an object is a Provider error, not a crash", async () => {
  const { outbound, settle } = harness(suite, () =>
    Response.json(["unexpected"])
  );

  await assert.rejects(
    async () => await settle(outbound.campaigns.get(CAMPAIGN, { retries: 0 })),
    (error) =>
      isCode("Provider")(error) &&
      /returned no object for \/campaign\/GetById/u.test(
        (error as Error).message
      )
  );
});

test("heyreach: an adapter lists what it has not confirmed against the live API", () => {
  const { outbound } = harness(suite);
  assert.equal(outbound.maturity, "beta");
  assert.match(outbound.caveats[0] ?? "", /live HeyReach workspace/u);
  assert.ok(
    outbound.caveats.some((caveat) => /300 requests per minute/u.test(caveat))
  );
  assert.equal(outbound.capabilities["messages.list"], true);
  assert.equal(outbound.capabilities["replies.category"], false);
  assert.equal(outbound.capabilities.workspaces, false);
  assert.equal(outbound.capabilities["events.verify"], "secret");
});
