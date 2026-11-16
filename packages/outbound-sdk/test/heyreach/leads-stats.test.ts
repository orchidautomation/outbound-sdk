import assert from "node:assert/strict";
import { test } from "node:test";

import { heyreach } from "../../src/heyreach/index.ts";
import { OutboundError } from "../../src/index.ts";
import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import {
  CAMPAIGN,
  KEY,
  LEAD,
  SENDER,
  suite,
  withCampaignLeads,
} from "./suite.ts";

const pathOf = (request: { url: string }): string =>
  new URL(request.url).pathname;

const bodyOf = (request: { body: string | undefined } | undefined): unknown =>
  JSON.parse(request?.body ?? "{}");

const isCode =
  (code: string) =>
  (error: unknown): boolean =>
    OutboundError.is(error) && error.code === code;

test("heyreach: one lead is looked up by its LinkedIn profile URL, which is its id", async () => {
  const { outbound, requests, settle } = harness(suite);
  const lead = await settle(outbound.leads.get(LEAD));
  assert.equal(requests[0]?.method, "POST");
  assert.equal(
    new URL(requests[0]?.url ?? "").pathname,
    "/api/public/lead/GetLead"
  );
  assert.deepEqual(bodyOf(requests[0]), { profileUrl: LEAD });
  assert.equal(lead.sourceId, LEAD);
  assert.equal(lead.ref, `heyreach:client-a:${LEAD}`);
  assert.equal(lead.linkedinUrl, LEAD);
  assert.equal(lead.firstName, "Alex");
  assert.equal(lead.lastName, "Example");
  assert.equal(lead.company, "Example Co");
  assert.equal(lead.title, "Director");
  assert.equal(
    lead.email,
    "person1@example.com",
    "emailAddress is null, so enrichedEmailAddress is used"
  );
  assert.equal(lead.status, "unknown", "GetLead carries no status");
  assert.equal(lead.campaignRef, null);
  assert.equal(lead.createdAt, null);

  assert.equal(lead.interest, null, "GetLead carries no auto-tag");
  assert.equal(lead.engagement, null);
  assert.deepEqual(lead.custom, {});

  await settle(outbound.leads.get(lead.ref));
  assert.deepEqual(
    bodyOf(requests[2]),
    { profileUrl: LEAD },
    "a ref works too"
  );
});

test("heyreach: a looked-up lead's tags come from a second request, GetTags", async () => {
  const { adapter, outbound, requests, settle } = harness(suite);
  const lead = await settle(outbound.leads.get(LEAD));
  assert.deepEqual(
    requests.map((request) => [new URL(request.url).pathname, bodyOf(request)]),
    [
      ["/api/public/lead/GetLead", { profileUrl: LEAD }],
      ["/api/public/lead/GetTags", { profileUrl: LEAD }],
    ]
  );
  assert.deepEqual(lead.tags, ["atag1", "btag2", "ctag3"]);
  assert.equal(adapter.costs?.["leads.get"]?.perPage, 2);
});

test("heyreach: a tags response without a tags array leaves the lead untagged", async () => {
  const { outbound, settle } = harness(suite, (request) =>
    request.url.endsWith("/lead/GetTags") ? Response.json({}) : undefined
  );

  assert.deepEqual((await settle(outbound.leads.get(LEAD))).tags, []);
});

test("heyreach: a lead's own emailAddress wins and is lowercased", async () => {
  const { outbound, settle } = harness(suite, () =>
    Response.json({
      ...(fixture("heyreach", "getLead.json") as object),
      emailAddress: " Person9@Example.com ",
    })
  );

  assert.equal(
    (await settle(outbound.leads.get(LEAD))).email,
    "person9@example.com"
  );
});

test("heyreach: every lead is read by walking the campaigns, one page of one campaign per call", async () => {
  const { outbound, requests, settle } = harness(suite);
  assert.equal(outbound.capabilities["leads.list"], true);

  const first = await settle(outbound.leads.list());
  assert.deepEqual(
    requests.map((request) => [pathOf(request), bodyOf(request)]),
    [
      ["/api/public/campaign/GetAll", { limit: 100, offset: 0 }],
      [
        "/api/public/campaign/GetLeadsFromCampaign",
        { campaignId: 274_079, limit: 100, offset: 0 },
      ],
    ],
    "the first page reads the campaigns, then the first campaign's leads"
  );
  assert.equal(first.items[0]?.campaignRef, "heyreach:client-a:274079");
  assert.equal(first.complete, false);

  const second = await settle(outbound.leads.list({ cursor: first.cursor }));
  assert.deepEqual(
    requests.slice(2).map((request) => [pathOf(request), bodyOf(request)]),
    [
      [
        "/api/public/campaign/GetLeadsFromCampaign",
        { campaignId: 274_079, limit: 100, offset: 2 },
      ],
    ],
    "the campaigns travel in the cursor, so a later page is one request"
  );
  assert.equal(second.items[0]?.campaignRef, "heyreach:client-a:274079");
});

test("heyreach: the walk moves to the next campaign and the next page of campaigns, then ends", async () => {
  const { outbound, requests, settle } = harness(suite);
  const pages: string[][] = [];
  let cursor: string | undefined;

  do {
    // oxlint-disable-next-line no-await-in-loop -- each page needs the previous page's cursor.
    const page = await settle(outbound.leads.list({ cursor }));
    pages.push(page.items.map((lead) => lead.campaignRef ?? ""));
    ({ cursor } = page);
  } while (cursor !== undefined);

  assert.deepEqual(
    [...new Set(pages.flat())],
    [
      "heyreach:client-a:274079",
      "heyreach:client-a:274080",
      "heyreach:client-a:274081",
    ],
    "all three campaigns, the third from the second page of campaigns"
  );
  assert.deepEqual(
    requests
      .filter((request) => pathOf(request).endsWith("/campaign/GetAll"))
      .map((request) => bodyOf(request)),
    [
      { limit: 100, offset: 0 },
      { limit: 100, offset: 2 },
    ],
    "each page of campaigns is read once"
  );
  assert.equal(
    pages.flat().length,
    9,
    "three leads in each of three campaigns"
  );

  const all = await settle(outbound.leads.listAll().toArray());
  assert.equal(
    all.length,
    3,
    "listAll returns a person once, although each fixture campaign holds the same three"
  );
});

test("heyreach: a walk keeps the date filter and an account with no campaigns has no leads", async () => {
  const dated = harness(suite);
  await dated.settle(dated.outbound.leads.list({ since: "2024-09-01" }));
  assert.deepEqual(bodyOf(dated.requests[1]), {
    campaignId: 274_079,
    limit: 100,
    offset: 0,
    timeFilter: "CreationTime",
    timeFrom: "2024-09-01T00:00:00.000Z",
  });

  const empty = harness(suite, () =>
    Response.json({ items: [], totalCount: 0 })
  );

  const page = await empty.settle(empty.outbound.leads.list());
  assert.deepEqual(page.items, []);
  assert.equal(page.cursor, undefined);
  assert.equal(empty.requests.length, 1, "only the campaign list is read");
});

test("heyreach: a campaign's leads are listed with POST by offset", async () => {
  const { outbound, requests, settle } = harness(withCampaignLeads);

  const page = await settle(
    outbound.campaign(CAMPAIGN).leads.list({ limit: 10 })
  );

  assert.equal(requests[0]?.method, "POST");
  assert.equal(
    new URL(requests[0]?.url ?? "").pathname,
    "/api/public/campaign/GetLeadsFromCampaign"
  );
  assert.deepEqual(bodyOf(requests[0]), {
    campaignId: 274_079,
    limit: 10,
    offset: 0,
  });
  const [lead] = page.items;
  assert.equal(lead?.sourceId, "https://www.linkedin.com/in/example-person-1");
  assert.equal(lead?.firstName, "Alex");
  assert.equal(lead?.lastName, "Example");
  assert.equal(lead?.company, "Example Co");
  assert.equal(lead?.title, null, 'position is ""');
  assert.equal(lead?.email, null);
  assert.equal(lead?.status, "completed", "leadCampaignStatus Finished");
  assert.equal(lead?.createdAt, "2024-09-30T21:28:06.933Z");
  assert.equal(lead?.campaignRef, "heyreach:client-a:274079");
  assert.deepEqual(
    (lead?.raw as { linkedInUserProfile?: { linkedin_id: string } } | undefined)
      ?.linkedInUserProfile?.linkedin_id,
    "58344979",
    "the member id stays in raw"
  );

  const all = await settle(
    outbound.campaign(CAMPAIGN).leads.listAll().toArray()
  );

  assert.equal(all.length, 3);
  assert.equal(new Set(all.map((item) => item.ref)).size, 3);
  assert.equal((bodyOf(requests.at(-1)) as { offset: number }).offset, 2);
});

test("heyreach: a date range on a campaign's leads filters by creation time on the server", async () => {
  const { outbound, requests, settle } = harness(withCampaignLeads);

  const page = await settle(
    outbound
      .campaign(CAMPAIGN)
      .leads.list({ since: "2024-09-01", until: "2024-10-31" })
  );

  assert.deepEqual(bodyOf(requests[0]), {
    campaignId: 274_079,
    limit: 100,
    offset: 0,
    timeFilter: "CreationTime",
    timeFrom: "2024-09-01T00:00:00.000Z",
    timeTo: "2024-10-31T23:59:59.999Z",
  });
  assert.equal(page.meta.evidence, "exact");

  await settle(outbound.campaign(CAMPAIGN).leads.list({ since: "2024-09-01" }));
  assert.deepEqual(bodyOf(requests[1]), {
    campaignId: 274_079,
    limit: 100,
    offset: 0,
    timeFilter: "CreationTime",
    timeFrom: "2024-09-01T00:00:00.000Z",
  });
});

test("heyreach: a non-numeric campaign id is refused before any request", async () => {
  const { outbound, requests, settle } = harness(withCampaignLeads);

  await assert.rejects(
    async () => await settle(outbound.campaign("spring-launch").leads.list()),
    (error) =>
      isCode("Invalid")(error) &&
      /campaign ids are whole numbers/u.test((error as Error).message)
  );
  assert.equal(requests.length, 0);
});

test("heyreach: every documented lead status maps to a status", async () => {
  const cases = [
    ["Pending", "None", "active"],
    ["InSequence", "MessageSent", "active"],
    ["Finished", "None", "completed"],
    ["Paused", "None", "paused"],
    ["Failed", "None", "unknown"],
    ["Excluded", "None", "skipped"],
    ["PendingOrExcludedToBeCalculated", "None", "unknown"],
    ["NotADocumentedStatus", "None", "unknown"],
    ["Finished", "MessageReply", "replied"],
    ["InSequence", "MessageReply", "replied"],
  ] as const;

  const base = fixture("heyreach", "getLeadsFromCampaign.page2.json") as {
    items: object[];
  };

  for (const [campaignStatus, messageStatus, status] of cases) {
    const { outbound, settle } = harness(withCampaignLeads, () =>
      Response.json({
        items: base.items.map((item) => ({
          ...item,
          leadCampaignStatus: campaignStatus,
          leadMessageStatus: messageStatus,
        })),
        totalCount: 1,
      })
    );

    const page = await settle(outbound.campaign(CAMPAIGN).leads.list());
    assert.equal(
      page.items[0]?.status,
      status,
      `${campaignStatus} / ${messageStatus}`
    );
  }
});

test("heyreach: a lead without a profile URL falls back to its member id", async () => {
  const { outbound, settle } = harness(withCampaignLeads, () =>
    Response.json({
      items: [{ id: 7, linkedInUserProfile: { linkedin_id: "58344999" } }],
      totalCount: 1,
    })
  );

  const page = await settle(outbound.campaign(CAMPAIGN).leads.list());
  assert.equal(page.items[0]?.sourceId, "58344999");
  assert.equal(page.items[0]?.linkedinUrl, null);
});

// The documented example repeats 0 across fields, so this uses a distinct
// value per field to pin each mapping to exactly one source field.
const DISTINCT = {
  connectionAcceptanceRate: 0.91,
  connectionsAccepted: 18,
  connectionsSent: 17,
  follows: 21,
  inMailReplyRate: 0.92,
  inmailMessagesSent: 14,
  messageReplyRate: 0.93,
  messagesSent: 11,
  postLikes: 20,
  profileViews: 19,
  totalInmailReplies: 16,
  totalInmailStarted: 15,
  totalMessageReplies: 13,
  totalMessageStarted: 12,
};

test("heyreach: each stats field maps to exactly one count, and rates are never read", async () => {
  const { outbound, settle } = harness(suite, () =>
    Response.json({ byDayStats: {}, overallStats: DISTINCT })
  );

  const [row] = (await settle(outbound.stats())).rows;
  assert.equal(row?.sent, 11, "messagesSent");
  assert.equal(row?.inmailsSent, 14, "inmailMessagesSent");
  assert.equal(row?.connectionsSent, 17);
  assert.equal(row?.connectionsAccepted, 18);
  assert.equal(row?.replied, 29, "totalMessageReplies + totalInmailReplies");
  assert.equal(
    row?.contacted,
    null,
    "totalMessageStarted is not defined, and is not read as contacted"
  );

  for (const key of [
    "bounced",
    "clicked",
    "delivered",
    "opened",
    "openedTotal",
    "positive",
    "repliedAuto",
    "unsubscribed",
  ] as const) {
    assert.equal(row?.[key], null, `${key} is email-only or not reported`);
  }

  assert.equal(row?.evidence, "exact");
  assert.equal(row?.date, null);
  assert.equal(row?.timezone, null);
  assert.equal(row?.scope, "workspace");
  assert.equal(row?.scopeRef, "heyreach:client-a:client-a");
});

test("heyreach: unique leads contacted and interested auto-tags are read when the API returns them", async () => {
  const { outbound, settle } = harness(suite, () =>
    Response.json({
      byDayStats: {},
      overallStats: {
        ...DISTINCT,
        autoTaggedInterested: 21,
        autoTaggedInterestedRate: 0.5,
        totalAutoTagged: 22,
        uniqueLeadsContacted: 23,
      },
    })
  );

  const [row] = (await settle(outbound.stats())).rows;
  assert.equal(row?.contacted, 23, "uniqueLeadsContacted");
  assert.equal(row?.positive, 21, "autoTaggedInterested, not totalAutoTagged");
  assert.equal(row?.sent, 11);
});

test("heyreach: a count the response leaves out stays null", async () => {
  const cases = [
    [{ messagesSent: 5 }, 5, null],
    [{ totalInmailReplies: 4 }, null, 4],
    [{ totalMessageReplies: 3 }, null, 3],
  ] as const;

  for (const [overallStats, sent, replied] of cases) {
    const { outbound, settle } = harness(suite, () =>
      Response.json({ overallStats })
    );

    const [row] = (await settle(outbound.stats())).rows;
    assert.equal(row?.sent, sent);
    assert.equal(row?.replied, replied);
    assert.equal(row?.connectionsSent, null);
    assert.equal(row?.inmailsSent, null);
  }
});

test("heyreach: workspace totals come from overallStats, with no filters and no dates", async () => {
  const { outbound, requests, settle } = harness(suite);
  const stats = await settle(outbound.stats());
  assert.equal(requests[0]?.method, "POST");
  assert.equal(
    new URL(requests[0]?.url ?? "").pathname,
    "/api/public/stats/GetOverallStats"
  );
  assert.deepEqual(bodyOf(requests[0]), { accountIds: [], campaignIds: [] });
  assert.equal(stats.rows.length, 1);
  assert.equal(stats.rows[0]?.sent, 2601);
  assert.equal(stats.rows[0]?.replied, 395);
  assert.equal(stats.rows[0]?.connectionsSent, 14_740);
  assert.equal(stats.rows[0]?.connectionsAccepted, 1828);
  assert.equal(stats.rows[0]?.inmailsSent, 0);
});

test("heyreach: daily stats turn the UTC-midnight keys into dated rows, oldest first", async () => {
  const { outbound, requests, settle } = harness(suite);

  const stats = await settle(
    outbound.stats({ by: "day", from: "2024-12-17", to: "2024-12-19" })
  );

  assert.deepEqual(bodyOf(requests[0]), {
    accountIds: [],
    campaignIds: [],
    endDate: "2024-12-19T23:59:59.999Z",
    startDate: "2024-12-17T00:00:00.000Z",
  });
  assert.deepEqual(
    stats.rows.map((row) => [
      row.date,
      row.timezone,
      row.sent,
      row.replied,
      row.connectionsSent,
      row.connectionsAccepted,
    ]),
    [
      ["2024-12-17", "UTC", 723, 136, 4650, 637],
      ["2024-12-18", "UTC", 1033, 119, 5161, 652],
      ["2024-12-19", "UTC", 845, 140, 4929, 539],
    ]
  );
});

test("heyreach: daily keys are sorted and a key that is not a date is skipped", async () => {
  const { outbound, settle } = harness(suite, () =>
    Response.json({
      byDayStats: {
        "2024-12-18T00:00:00Z": { messagesSent: 2 },
        "2024-12-17T00:00:00Z": { messagesSent: 1 },
        "not a day": { messagesSent: 9 },
      },
    })
  );

  const stats = await settle(outbound.stats({ by: "day" }));
  assert.deepEqual(
    stats.rows.map((row) => [row.date, row.sent]),
    [
      ["2024-12-17", 1],
      ["2024-12-18", 2],
    ]
  );

  const empty = harness(suite, () => Response.json({ overallStats: {} }));

  assert.deepEqual(
    (await empty.settle(empty.outbound.stats({ by: "day" }))).rows,
    []
  );
});

test("heyreach: campaign and sender stats filter the same endpoint by one id", async () => {
  const { outbound, requests, settle } = harness(suite);
  const campaign = await settle(outbound.campaign(CAMPAIGN).stats());
  const sender = await settle(outbound.sender(SENDER).stats());
  assert.deepEqual(bodyOf(requests[0]), {
    accountIds: [],
    campaignIds: [274_079],
  });
  assert.deepEqual(bodyOf(requests[1]), {
    accountIds: [1101],
    campaignIds: [],
  });
  assert.equal(campaign.rows[0]?.scope, "campaign");
  assert.equal(campaign.rows[0]?.scopeRef, "heyreach:client-a:274079");
  assert.equal(sender.rows[0]?.scope, "sender");
  assert.equal(sender.rows[0]?.scopeRef, "heyreach:client-a:1101");
  assert.equal(sender.meta.evidence, "exact");
});

test("heyreach: stats refuse half a date range, a non-numeric id and the step scope", async () => {
  const { outbound, requests, settle } = harness(suite);

  await assert.rejects(
    async () => await settle(outbound.stats({ from: "2024-12-17" })),
    (error) =>
      isCode("Invalid")(error) &&
      /both from and to, or neither/u.test((error as Error).message)
  );
  await assert.rejects(
    async () => await settle(outbound.sender("alex").stats()),
    (error) =>
      isCode("Invalid")(error) &&
      /account ids are whole numbers/u.test((error as Error).message)
  );
  await assert.rejects(
    async () => await outbound.campaign(CAMPAIGN).stats({ scope: "step" }),
    isCode("Unsupported")
  );
  assert.equal(requests.length, 0);

  // The wrapper never passes the step scope on; the adapter refuses it too.
  const adapter = heyreach({ apiKey: KEY });

  await assert.rejects(
    async () =>
      await adapter.stats?.(
        { by: "total", scope: "step", scopeId: CAMPAIGN },
        {} as never
      ),
    isCode("Unsupported")
  );
});
