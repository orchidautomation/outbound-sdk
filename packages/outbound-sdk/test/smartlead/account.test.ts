import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { API, CAMPAIGN, SENDER, suite, urlOf } from "./suite.ts";

const load = (name: string) => fixture("smartlead", name) as never;
const pathOf = (request: RecordedRequest): string => urlOf(request).pathname;

const campaign = (changes: Record<string, unknown>) => ({
  ...(load("getCampaign.json") as Record<string, unknown>),
  ...changes,
});

test("smartlead: campaign settings map the schedule, caps, tracking and stop rule", async () => {
  const { outbound, requests, settle } = harness(suite);
  const settings = await settle(outbound.campaign(CAMPAIGN).settings());

  assert.equal(pathOf(requests[0] as RecordedRequest), `${API}/campaigns/372`);
  assert.equal(requests.length, 1);
  assert.equal(settings.sourceId, "372");
  assert.equal(settings.campaignRef, "smartlead:client-a:372");
  assert.deepEqual(settings.schedule, [
    {
      days: [1, 2, 3, 4, 5],
      from: "09:00",
      name: null,
      timezone: "America/New_York",
      to: "19:00",
    },
  ]);
  assert.equal(settings.gapMinutes, 24, "min_time_btwn_emails");
  assert.equal(settings.dailyNewLeads, 100, "max_leads_per_day");
  assert.equal(settings.dailyLimit, null, "no sending_limit in this shape");
  assert.equal(settings.plainText, false);
  assert.equal(settings.stopOnReply, true, "REPLY_TO_AN_EMAIL");
  assert.equal(settings.stopOnAutoReply, null, "not reported on this read");
  assert.deepEqual(settings.tracking, { clicks: false, opens: false });
  assert.equal(settings.startDate, null);
  assert.equal(settings.endDate, null, "Smartlead has no end date");
});

// Settings read from the wrapped shape, with some fields changed.
const read = async (changes: Record<string, unknown>) => {
  const { outbound, settle } = harness(suite, () =>
    Response.json({ data: campaign(changes), success: true })
  );

  return await settle(outbound.campaign(CAMPAIGN).settings());
};

test("smartlead: every documented settings value maps, in both spellings", async () => {
  const open = await read({
    max_leads_per_day: 41,
    min_time_btwn_emails: 42,
    out_of_office_detection_settings: { ignoreOOOasReply: true },
    schedule_start_time: "2026-02-03T08:30:00.000Z",
    scheduler_cron_value: JSON.stringify({
      days: [0, 6, 9, "x"],
      endHour: "17:45:00",
      startHour: "8:05",
      tz: "Europe/London",
    }),
    send_as_plain_text: true,
    sending_limit: 43,
    stop_lead_settings: "NEVER",
    track_settings: ["DONT_TRACK_LINK_CLICK"],
  });

  assert.equal(open.dailyNewLeads, 41);
  assert.equal(open.gapMinutes, 42);
  assert.equal(open.dailyLimit, 43);
  assert.equal(open.startDate, "2026-02-03");
  assert.equal(open.plainText, true);
  assert.equal(open.stopOnReply, false, "NEVER");
  assert.equal(open.stopOnAutoReply, false, "an out-of-office is ignored");
  assert.deepEqual(open.tracking, { clicks: false, opens: true });
  assert.deepEqual(open.schedule, [
    {
      days: [0, 6],
      from: "08:05",
      name: null,
      timezone: "Europe/London",
      to: "17:45",
    },
  ]);

  const auto = await read({
    out_of_office_detection_settings: { ignoreOOOasReply: false },
    track_settings: ["DONT_EMAIL_OPEN"],
  });

  assert.equal(auto.stopOnAutoReply, true, "it stops like any reply");
  assert.deepEqual(auto.tracking, { clicks: true, opens: false });

  const bare = await read({
    scheduler_cron_value: null,
    stop_lead_settings: "OPENED_EMAIL",
    track_settings: "not json",
  });

  assert.deepEqual(bare.schedule, []);
  assert.equal(bare.stopOnReply, null, "says nothing about a reply");
  assert.deepEqual(bare.tracking, { clicks: null, opens: null });
  assert.deepEqual(
    (await read({ scheduler_cron_value: { startHour: "soon" } })).schedule,
    [{ days: [], from: null, name: null, timezone: null, to: null }]
  );

  const { outbound, settle } = harness(suite, () => Response.json([]));

  await assert.rejects(
    settle(outbound.campaign(CAMPAIGN).settings({ retries: 0 })),
    { code: "Provider" }
  );
});

test("smartlead: subsequences are the campaign's child campaigns, one page each", async () => {
  const { outbound, requests, settle } = harness(suite, (request) =>
    pathOf(request) === `${API}/campaigns/`
      ? Response.json(load("listCampaigns.subsequences.json"))
      : undefined
  );

  const subsequences = await settle(
    outbound.campaign(CAMPAIGN).subsequences.listAll().toArray()
  );

  assert.deepEqual(
    requests.map(pathOf),
    [
      `${API}/campaigns/`,
      `${API}/campaigns/2710301/sequences`,
      `${API}/campaigns/2710302/sequences`,
    ],
    "the campaign list is read once; another campaign's child is left out"
  );
  assert.deepEqual(
    subsequences.map((sequence) => [
      sequence.sourceId,
      sequence.name,
      sequence.kind,
      sequence.campaignRef,
    ]),
    [
      ["2710301", "Pricing follow-up", "subsequence", "smartlead:client-a:372"],
      [
        "2710302",
        "Meeting request follow-up",
        "subsequence",
        "smartlead:client-a:372",
      ],
    ]
  );
  const [first] = subsequences;
  assert.equal(first?.ref, "smartlead:client-a:2710301");
  assert.deepEqual(
    first?.steps.map((step) => [step.index, step.parentIndex, step.branch]),
    [
      [0, null, null],
      [1, 0, null],
    ]
  );
  assert.ok((first?.steps[0]?.variants.length ?? 0) > 0);

  const none = harness(suite);

  const page = await none.settle(
    none.outbound.campaign(CAMPAIGN).subsequences.list()
  );

  assert.deepEqual(page.items, []);
  assert.equal(page.complete, true);
  assert.equal(none.requests.length, 1, "no child campaign, no steps request");
});

test("smartlead: sender health reads the mailbox and its warmup statistics", async () => {
  const { outbound, requests, settle } = harness(suite);
  const health = await settle(outbound.sender(SENDER).health());

  assert.deepEqual(requests.map(pathOf), [
    `${API}/email-accounts/123/`,
    `${API}/email-accounts/123/warmup-stats`,
  ]);
  assert.equal(health.sourceId, "123");
  assert.equal(health.senderRef, "smartlead:client-a:123");
  assert.equal(health.domain, "example.com");
  assert.equal(health.connected, true);
  assert.deepEqual(health.issues, []);
  assert.deepEqual(health.warmup, {
    inbox: 131,
    received: 152,
    score: 95,
    sent: 140,
    spam: 3,
  });
  assert.deepEqual(
    health.dns,
    { dkim: null, dmarc: null, mx: null, spf: null },
    "the API reports no DNS records"
  );
  assert.equal(health.blacklisted, null);
  assert.equal(health.checkedAt, null);
  assert.ok(
    !JSON.stringify(health.raw).includes("REDACTED"),
    "the mailbox password is not kept"
  );
  assert.ok(!JSON.stringify(health.raw).includes("password"));
});

test("smartlead: sender health lists failures and reads the newer warmup shape", async () => {
  const account = {
    ...(load("getEmailAccount.json") as Record<string, unknown>),
    from_email: null,
    imap_failure_error: "IMAP login failed",
    imap_password: "REDACTED",
    is_imap_success: false,
    smtp_failure_error: "SMTP timed out",
    warmup_details: { blocked_reason: "Warmup bounce", warmup_reputation: 71 },
  };

  const broken = harness(suite, (request) =>
    pathOf(request).endsWith("/warmup-stats")
      ? Response.json(load("getEmailAccountWarmupStats.newdocs.json"))
      : Response.json(account)
  );

  const health = await broken.settle(broken.outbound.sender(SENDER).health());
  assert.equal(health.connected, false);
  assert.equal(health.domain, null);
  assert.deepEqual(health.issues, [
    "SMTP timed out",
    "IMAP login failed",
    "Warmup bounce",
  ]);
  assert.deepEqual(health.warmup, {
    inbox: null,
    received: null,
    score: 96,
    sent: 141,
    spam: 4,
  });
  assert.ok(!JSON.stringify(health.raw).includes("REDACTED"));

  const unknown = harness(suite, (request) =>
    pathOf(request).endsWith("/warmup-stats")
      ? Response.json({ sent_count: "7" })
      : Response.json({
          ...account,
          is_imap_success: null,
          is_smtp_success: true,
        })
  );

  const partial = await unknown.settle(
    unknown.outbound.sender(SENDER).health()
  );

  assert.equal(partial.connected, null, "one check is not reported");
  assert.equal(partial.warmup?.score, 71, "warmup_reputation of the mailbox");
  assert.equal(partial.warmup?.sent, 7);

  const without = harness(suite, (request) =>
    pathOf(request).endsWith("/warmup-stats") ? Response.json([]) : undefined
  );

  const none = await without.settle(without.outbound.sender(SENDER).health());
  assert.equal(none.warmup, null);
});

test("smartlead: lead lists page by offset until a short page", async () => {
  const { outbound, requests, settle } = harness(suite);
  const lists = await settle(outbound.lists.listAll({ limit: 2 }).toArray());

  assert.deepEqual(
    requests.map((request) => [
      pathOf(request),
      urlOf(request).searchParams.get("offset"),
      urlOf(request).searchParams.get("limit"),
    ]),
    [
      [`${API}/lead-list/`, "0", "2"],
      [`${API}/lead-list/`, "2", "2"],
    ]
  );
  assert.deepEqual(
    lists.map((list) => [list.sourceId, list.name, list.size, list.createdAt]),
    [
      ["500", "Q1 2025 Enterprise Prospects", 1250, "2025-12-01T10:00:00.000Z"],
      ["501", "SMB Tech Companies", 850, "2025-12-05T14:00:00.000Z"],
      ["502", "Example Co Event Attendees", 40, "2025-12-09T09:30:00.000Z"],
    ]
  );
  assert.equal(lists[0]?.kind, "leads");

  const capped = harness(suite);
  await capped.settle(capped.outbound.lists.list({ limit: 5000 }));
  assert.equal(urlOf(capped.requests[0]).searchParams.get("limit"), "100");
});

test("smartlead: the block list tells addresses from domains and lowercases both", async () => {
  const { outbound, requests, settle } = harness(suite);

  const entries = await settle(
    outbound.blocklist.listAll({ limit: 2 }).toArray()
  );

  assert.deepEqual(
    requests.map((request) => [
      pathOf(request),
      urlOf(request).searchParams.get("offset"),
      urlOf(request).searchParams.get("limit"),
    ]),
    [
      [`${API}/leads/get-domain-block-list`, "0", "2"],
      [`${API}/leads/get-domain-block-list`, "2", "2"],
    ]
  );
  assert.deepEqual(
    entries.map((entry) => [
      entry.sourceId,
      entry.kind,
      entry.value,
      entry.createdAt,
    ]),
    [
      [
        "228361167",
        "domain",
        "blocked.example.com",
        "2025-11-25T12:38:45.193Z",
      ],
      ["228361168", "email", "person7@example.org", "2025-11-26T08:15:00.000Z"],
      [
        "228361169",
        "domain",
        "blocked.example.net",
        "2025-11-27T16:02:10.000Z",
      ],
    ]
  );

  const wide = harness(suite);
  await wide.settle(wide.outbound.blocklist.list({ limit: 5000 }));
  assert.equal(
    urlOf(wide.requests[0]).searchParams.get("limit"),
    "1000",
    "the documented maximum"
  );
});

test("smartlead: tags come in one response and have no description", async () => {
  const { outbound, requests, settle } = harness(suite);
  const page = await settle(outbound.tags.list());

  assert.equal(
    pathOf(requests[0] as RecordedRequest),
    `${API}/email-accounts/tags`
  );
  assert.equal(page.complete, true);
  assert.deepEqual(
    page.items.map((tag) => [tag.sourceId, tag.name, tag.description]),
    [
      ["10", "Winners", null],
      ["15", "Webinar Emails", null],
      ["22", "High Priority", null],
    ]
  );
});

test("smartlead: a campaign's webhooks are one request, in both documented shapes", async () => {
  const { outbound, requests, settle } = harness(suite);
  const page = await settle(outbound.campaign(CAMPAIGN).webhooks.list());

  assert.deepEqual(requests.map(pathOf), [`${API}/campaigns/372/webhooks`]);
  assert.equal(page.complete, true);
  const [first, second] = page.items;
  assert.equal(first?.sourceId, "44");
  assert.equal(first?.name, "Example lead category webhook");
  assert.equal(first?.url, "https://hooks.example.com/smartlead");
  assert.deepEqual(first?.events, ["LEAD_CATEGORY_UPDATED"]);
  assert.equal(first?.createdAt, "2022-09-14T05:08:55.018Z");
  assert.deepEqual(
    first?.campaignRefs,
    ["smartlead:client-a:2180"],
    "its own id"
  );
  assert.equal(first?.active, null, "this shape has no is_active");
  assert.deepEqual(second?.events, ["EMAIL_REPLY", "EMAIL_BOUNCE"]);

  const newer = harness(suite, () =>
    Response.json({
      data: [
        {
          ...(
            load("listCampaignWebhooks.newdocs.json") as {
              data: Record<string, unknown>[];
            }
          ).data[0],
          secret_key: "redacted",
        },
      ],
      success: true,
    })
  );

  const wrapped = await newer.settle(
    newer.outbound.campaign(CAMPAIGN).webhooks.list()
  );

  const [webhook] = wrapped.items;
  assert.equal(webhook?.sourceId, "456");
  assert.equal(webhook?.active, true);
  assert.equal(webhook?.createdAt, null);
  assert.deepEqual(
    webhook?.campaignRefs,
    ["smartlead:client-a:372"],
    "the campaign that was asked"
  );
  assert.deepEqual(webhook?.events, ["LEAD_REPLIED", "LEAD_OPENED"]);
  assert.ok(!JSON.stringify(webhook?.raw).includes("secret_key"));
});

test("smartlead: webhooks without a campaign walk the campaigns and return each once", async () => {
  const extra = [
    {
      event_types: ["EMAIL_SENT"],
      id: 46,
      webhook_url: "https://hooks.example.com/second-campaign",
    },
    { id: 44, webhook_url: "https://hooks.example.com/smartlead" },
  ];

  const { outbound, requests, settle } = harness(suite, (request) =>
    pathOf(request) === `${API}/campaigns/2710100/webhooks`
      ? Response.json(extra)
      : undefined
  );

  const webhooks = await settle(outbound.webhooks.listAll().toArray());

  assert.deepEqual(requests.map(pathOf), [
    `${API}/campaigns/`,
    `${API}/campaigns/2710262/webhooks`,
    `${API}/campaigns/2710100/webhooks`,
  ]);
  assert.deepEqual(
    webhooks.map((webhook) => [webhook.sourceId, webhook.campaignRefs]),
    [
      ["44", ["smartlead:client-a:2180"]],
      ["45", ["smartlead:client-a:2180"]],
      ["46", ["smartlead:client-a:2710100"]],
    ],
    "webhook 44 is listed by both campaigns and returned once"
  );

  const empty = harness(suite, () => Response.json([]));
  const none = await empty.settle(empty.outbound.webhooks.list());
  assert.deepEqual(none.items, []);
  assert.equal(empty.requests.length, 1, "no campaign, no webhook request");
});
