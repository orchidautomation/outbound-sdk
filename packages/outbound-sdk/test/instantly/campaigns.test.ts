import assert from "node:assert/strict";
import { test } from "node:test";

import { OutboundError } from "../../src/index.ts";
import { instantly } from "../../src/instantly/index.ts";
import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { CAMPAIGN, KEY, suite } from "./suite.ts";

const pathOf = (request: RecordedRequest): string =>
  `${request.method} ${new URL(request.url).pathname}`;

const campaignWith = (fields: Record<string, unknown>) => ({
  ...(fixture("instantly", "getCampaign.json") as object),
  ...fields,
});

test("instantly: listed campaigns carry the names of their tags", async () => {
  const { outbound, requests, settle } = harness(suite);
  const page = await settle(outbound.campaigns.list());

  assert.deepEqual(
    page.items.map((campaign) => campaign.tags),
    [["Important", "Agency"], []],
    "the mapping gives the tag id, the tag gives its name"
  );
  assert.deepEqual(requests.map(pathOf), [
    "GET /api/v2/campaigns",
    "GET /api/v2/custom-tag-mappings",
    "GET /api/v2/custom-tags",
    "GET /api/v2/custom-tags",
  ]);

  const mappings = new URL(requests[1]?.url ?? "").searchParams;
  assert.equal(
    mappings.get("resource_ids"),
    `${CAMPAIGN},01a1d77f-5e23-7a9a-9112-a6f7089f3290`
  );
  assert.equal(mappings.get("limit"), "100");

  const tags = new URL(requests[2]?.url ?? "").searchParams;
  assert.equal(
    tags.get("tag_ids"),
    "01a1d77f-5e57-7861-bab6-41dac7e7804a,01a1d77f-5e57-7861-bab6-41dac7e7804c",
    "each tag id is asked for once"
  );
  assert.equal(
    new URL(requests[3]?.url ?? "").searchParams.get("starting_after"),
    "01a1d77f-5e57-7861-bab6-41dac7e7804b",
    "a second page of tags is followed"
  );
});

test("instantly: one campaign carries its tags too", async () => {
  const { outbound, requests, settle } = harness(suite);
  const campaign = await settle(outbound.campaigns.get(CAMPAIGN));
  assert.deepEqual(campaign.tags, ["Important", "Agency"]);
  assert.equal(
    new URL(requests[1]?.url ?? "").searchParams.get("resource_ids"),
    CAMPAIGN
  );
});

test("instantly: campaigns with no tag assignments ask for no tag names", async () => {
  const { outbound, requests, settle } = harness(suite, (request) =>
    new URL(request.url).pathname === "/api/v2/custom-tag-mappings"
      ? Response.json({ items: [] })
      : undefined
  );

  const page = await settle(outbound.campaigns.list());
  assert.deepEqual(page.items[0]?.tags, []);
  assert.deepEqual(requests.map(pathOf), [
    "GET /api/v2/campaigns",
    "GET /api/v2/custom-tag-mappings",
  ]);
});

test("instantly: an empty page of campaigns asks for no tags", async () => {
  const { outbound, requests, settle } = harness(suite, () =>
    Response.json({ items: [] })
  );

  assert.deepEqual((await settle(outbound.campaigns.list())).items, []);
  assert.equal(requests.length, 1);
});

test("instantly: a tag assignment whose tag is gone is left out, not invented", async () => {
  const { outbound, settle } = harness(suite, (request) =>
    new URL(request.url).pathname === "/api/v2/custom-tags"
      ? Response.json({ items: [{ id: "tag-without-a-label" }] })
      : undefined
  );

  assert.deepEqual((await settle(outbound.campaigns.get(CAMPAIGN))).tags, []);
});

test("instantly: more tag assignments than the adapter reads is an error, not missing tags", async () => {
  const { outbound, requests, settle } = harness(suite, (request) =>
    new URL(request.url).pathname === "/api/v2/custom-tag-mappings"
      ? Response.json({
          items: [{ resource_id: CAMPAIGN, tag_id: "t" }],
          next_starting_after: "more",
        })
      : undefined
  );

  await assert.rejects(
    async () => await settle(outbound.campaigns.list({ retries: 0 })),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Provider" &&
      /custom-tag-mappings/u.test(error.message)
  );
  assert.equal(
    requests.filter((request) => request.url.includes("/custom-tag-mappings"))
      .length,
    10,
    "ten pages of assignments are read before giving up"
  );
});

test("instantly: with the tags capability off, campaigns make no tag requests", async () => {
  const { outbound, requests, settle } = harness({
    ...suite,
    make: () =>
      instantly({
        apiKey: KEY,
        capabilities: { tags: false },
        workspaceId: "client-a",
      }),
  });

  const page = await settle(outbound.campaigns.list());
  assert.deepEqual(page.items[0]?.tags, []);
  assert.deepEqual((await settle(outbound.campaigns.get(CAMPAIGN))).tags, []);
  assert.deepEqual(requests.map(pathOf), [
    "GET /api/v2/campaigns",
    `GET /api/v2/campaigns/${CAMPAIGN}`,
  ]);
});

test("instantly: a campaign's settings come from the campaign object", async () => {
  const { outbound, requests, settle } = harness(suite);
  const settings = await settle(outbound.campaign(CAMPAIGN).settings());
  assert.deepEqual(requests.map(pathOf), [`GET /api/v2/campaigns/${CAMPAIGN}`]);
  assert.equal(settings.sourceId, CAMPAIGN);
  assert.equal(settings.campaignRef, `instantly:client-a:${CAMPAIGN}`);
  assert.equal(settings.dailyLimit, 120, "daily_limit");
  assert.equal(settings.dailyNewLeads, 35, "daily_max_leads");
  assert.equal(settings.gapMinutes, 7, "email_gap");
  assert.equal(settings.plainText, true, "text_only");
  assert.equal(settings.stopOnReply, true);
  assert.equal(settings.stopOnAutoReply, false);
  assert.deepEqual(settings.tracking, { clicks: false, opens: true });
  assert.equal(settings.startDate, "2025-09-25");
  assert.equal(settings.endDate, "2025-12-19");
  assert.deepEqual(settings.schedule, [
    {
      days: [1, 2, 3, 4, 5],
      from: "09:00",
      name: "Weekdays",
      timezone: "America/Chicago",
      to: "17:30",
    },
    {
      days: [6],
      from: "10:15",
      name: "Saturday morning",
      timezone: "Etc/GMT+12",
      to: "12:45",
    },
  ]);
});

test("instantly: a setting the campaign leaves out is null, and a malformed time is not passed on", async () => {
  const { outbound, settle } = harness(suite, () =>
    Response.json({
      campaign_schedule: {
        end_date: "soon",
        schedules: [{ days: { 7: true, x: true }, timing: { from: "9am" } }],
      },
      id: CAMPAIGN,
    })
  );

  const settings = await settle(outbound.campaign(CAMPAIGN).settings());
  assert.equal(settings.dailyLimit, null);
  assert.equal(settings.dailyNewLeads, null);
  assert.equal(settings.gapMinutes, null);
  assert.equal(settings.plainText, null);
  assert.equal(settings.stopOnReply, null);
  assert.deepEqual(settings.tracking, { clicks: null, opens: null });
  assert.equal(settings.startDate, null);
  assert.equal(settings.endDate, null);
  assert.deepEqual(settings.schedule, [
    { days: [], from: null, name: null, timezone: null, to: null },
  ]);
});

test("instantly: subsequences are listed for one campaign, and the first step waits its pre_delay", async () => {
  const { outbound, requests, settle } = harness(suite);

  const page = await settle(
    outbound.campaign(CAMPAIGN).subsequences.list({ limit: 2 })
  );

  const url = new URL(requests[0]?.url ?? "");
  assert.equal(url.pathname, "/api/v2/subsequences");
  assert.equal(url.searchParams.get("parent_campaign"), CAMPAIGN);
  assert.equal(url.searchParams.get("limit"), "2");
  assert.deepEqual(
    page.items.map((each) => [
      each.sourceId,
      each.kind,
      each.name,
      each.campaignRef,
    ]),
    [
      [
        "01a1d77f-5e80-7e44-bbfc-1c968e7cfe01",
        "subsequence",
        "Interested follow-up",
        `instantly:client-a:${CAMPAIGN}`,
      ],
      [
        "01a1d77f-5e80-7e44-bbfc-1c968e7cfe02",
        "subsequence",
        "Out of office follow-up",
        `instantly:client-a:${CAMPAIGN}`,
      ],
    ]
  );

  const steps = page.items.map((each) =>
    each.steps.map((step) => [
      step.parentIndex,
      step.delayDays,
      step.variants[0]?.subject,
      step.variants[0]?.body,
    ])
  );

  assert.deepEqual(steps, [
    [
      // pre_delay of 90 minutes, then the first step's delay of 3 days.
      [
        null,
        0.0625,
        "Great to hear, {{firstName}}",
        "Here is a link to book a time.",
      ],
      [0, 3, "Did the times work?", "Happy to send more options."],
    ],
    // A subsequence without pre_delay does not say how long it waits.
    [[null, null, "Welcome back", "Picking this up now that you are back."]],
  ]);

  await settle(
    outbound.campaign(CAMPAIGN).subsequences.list({ cursor: page.cursor })
  );
  assert.equal(
    new URL(requests[1]?.url ?? "").searchParams.get("starting_after"),
    "01a1d77f-5e80-7e44-bbfc-1c968e7cfe02"
  );
});

test("instantly: a subsequence without a parent in its payload belongs to the campaign asked for", async () => {
  const { outbound, settle } = harness(suite, () =>
    Response.json({ items: [{ id: "sub-1", sequences: [] }] })
  );

  const [subsequence] = (
    await settle(outbound.campaign(CAMPAIGN).subsequences.list())
  ).items;

  assert.equal(subsequence?.campaignRef, `instantly:client-a:${CAMPAIGN}`);
  assert.equal(subsequence?.name, null);
  assert.deepEqual(subsequence?.steps, []);
});

test("instantly: a campaign's senders are the mailboxes it names by address or by tag", async () => {
  const { outbound, requests, settle } = harness(suite);

  const senders = await settle(
    outbound.campaign(CAMPAIGN).senders.listAll().toArray()
  );

  assert.deepEqual(
    senders.map((sender) => sender.address),
    ["person1@example.com", "person11@example.com"],
    "one is in email_list, one carries a tag in email_tag_list; the third has another tag"
  );
  assert.deepEqual(requests.map(pathOf), [
    `GET /api/v2/campaigns/${CAMPAIGN}`,
    "GET /api/v2/accounts",
    `GET /api/v2/campaigns/${CAMPAIGN}`,
    "GET /api/v2/accounts",
  ]);

  const accounts = new URL(requests[1]?.url ?? "").searchParams;
  assert.equal(accounts.get("include_tags"), "true");
  assert.equal(accounts.get("tag_ids"), null);
});

test("instantly: a campaign that names tags only lets Instantly filter the mailboxes", async () => {
  const { outbound, requests, settle } = harness(suite, (request) =>
    new URL(request.url).pathname === `/api/v2/campaigns/${CAMPAIGN}`
      ? Response.json(
          campaignWith({ email_list: [], email_tag_list: ["tag-a", "tag-b"] })
        )
      : undefined
  );

  const page = await settle(outbound.campaign(CAMPAIGN).senders.list());
  assert.equal(page.items.length, 2, "every mailbox Instantly returns is kept");
  const accounts = new URL(requests[1]?.url ?? "").searchParams;
  assert.equal(accounts.get("tag_ids"), "tag-a,tag-b");
  assert.equal(accounts.get("include_tags"), null);
});

test("instantly: a campaign that names addresses only does not ask for tags", async () => {
  const { outbound, requests, settle } = harness(suite, (request) =>
    new URL(request.url).pathname === `/api/v2/campaigns/${CAMPAIGN}`
      ? Response.json(campaignWith({ email_tag_list: [] }))
      : undefined
  );

  const page = await settle(outbound.campaign(CAMPAIGN).senders.list());
  assert.deepEqual(
    page.items.map((sender) => sender.address),
    ["person1@example.com"]
  );
  assert.equal(
    new URL(requests[1]?.url ?? "").searchParams.get("include_tags"),
    null
  );
});

test("instantly: a campaign with no mailboxes makes no accounts request", async () => {
  const { outbound, requests, settle } = harness(suite, () =>
    Response.json({ id: CAMPAIGN })
  );

  const page = await settle(outbound.campaign(CAMPAIGN).senders.list());
  assert.deepEqual(page.items, []);
  assert.equal(requests.length, 1);
});
