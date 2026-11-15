import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../../src/combine/index.ts";
import { createOutbound, OutboundError } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { agency, NOW, single } from "./helpers.ts";

// NOW is 2026-11-14T12:00:00Z. Default weights: interest 50, reply 10,
// click 5, open 1, recency 20 fading over 14 days; counts capped at 5.
const DATA: MemoryData = {
  campaigns: [{ id: "c1" }, { id: "c2" }],
  leads: [
    {
      campaignId: "c1",
      company: "Acme",
      email: "person1@example.com",
      engagement: {
        clicks: 1,
        lastRepliedAt: "2026-11-07T12:00:00.000Z",
        opens: 3,
        replies: 2,
      },
      firstName: "Ann",
      id: "h1",
      interest: "Meeting Booked",
      lastName: "Example",
      status: "replied",
      title: "CEO",
    },
    {
      campaignId: "c1",
      email: "person2@example.com",
      engagement: {
        lastRepliedAt: "2026-11-14T12:00:00.000Z",
        opens: 40,
        replies: 1,
      },
      id: "h2",
      interest: "interested",
    },
    {
      campaignId: "c2",
      engagement: { clicks: 3, opens: 2 },
      id: "h3",
      linkedinUrl: "https://www.linkedin.com/in/example-person-3",
    },
    {
      campaignId: "c1",
      email: "person4@example.com",
      engagement: { lastRepliedAt: "2026-10-01T12:00:00.000Z", replies: 1 },
      id: "h4",
      interest: "Not Interested",
    },
    // Only the status says they replied.
    {
      campaignId: "c1",
      email: "person5@example.com",
      id: "h5",
      status: "replied",
    },
    // Nothing known at all, with and without an engagement record.
    { campaignId: "c1", email: "person6@example.com", id: "h6" },
    {
      campaignId: "c1",
      email: "person7@example.com",
      engagement: {},
      id: "h7",
    },
    {
      campaignId: "c1",
      email: "person8@example.com",
      id: "h8",
      interest: "Interested",
      status: "unsubscribed",
    },
    {
      campaignId: "c1",
      email: "person9@example.com",
      engagement: { replies: 4 },
      id: "h9",
      status: "bounced",
    },
    // Known, and known to be nothing.
    {
      campaignId: "c1",
      email: "person10@example.com",
      engagement: { clicks: 0, opens: 0, replies: 0 },
      id: "h10",
    },
  ],
};

const ranking = (leads: readonly { lead: string; score: number }[]) =>
  leads.map((each) => [each.lead.split(":").at(-1), each.score]);

test("hot_leads ranks leads by a score whose parts are returned, and leaves out leads with no data", async () => {
  const result = await single(DATA).insights.hotLeads({}, { now: NOW });
  const { data } = result;

  assert.equal(result.insight, "hot_leads");
  assert.deepEqual(ranking(data.leads), [
    // 50 label + 2 replies x 10 + 1 click x 5 + 3 opens x 1 + 20 x (1 - 7/14).
    ["h1", 88],
    // 50 label + 10 + 5 capped opens + 20 for a reply right now.
    ["h2", 85],
    // 3 clicks x 5 + 2 opens.
    ["h3", 17],
    // h4 is marked Not Interested, so its reply earns nothing and it is not hot.
    // 10 for the reply the status reports.
    ["h5", 10],
  ]);
  assert.deepEqual(data.leads[0], {
    campaign: "memory:agency:c1",
    clicks: 1,
    company: "Acme",
    email: "person1@example.com",
    interest: "Meeting Booked",
    lastRepliedAt: "2026-11-07T12:00:00.000Z",
    lead: "memory:agency:h1",
    linkedinUrl: null,
    name: "Ann Example",
    opens: 3,
    parts: { clicks: 5, interest: 50, opens: 3, recency: 10, replies: 20 },
    reason:
      "marked Meeting Booked, replied 2 time(s), last reply 7 day(s) ago, 1 click(s), 3 open(s).",
    replies: 2,
    score: 88,
    status: "replied",
    title: "CEO",
  });
  // A signal the vendor does not report is null, not 0.
  assert.deepEqual(data.leads[1]?.parts, {
    clicks: null,
    interest: 50,
    opens: 5,
    recency: 20,
    replies: 10,
  });
  assert.deepEqual(data.leads[2]?.parts, {
    clicks: 15,
    interest: null,
    opens: 2,
    recency: null,
    replies: null,
  });
  assert.equal(data.leads[3]?.replies, null);
  assert.equal(data.leads[3]?.reason, "replied 1 time(s).");
  assert.deepEqual(data.totals, {
    autoReplied: 0,
    // h8 unsubscribed and h9 bounced.
    excluded: 2,
    fromReplies: 0,
    hot: 4,
    leadsRead: 10,
    moreLeadsExist: false,
    // h4, marked Not Interested, whose reply earned nothing.
    negative: 1,
    // The four above, h4 and h10, whose counts are all a known 0.
    scored: 6,
    // h6 and h7.
    withoutData: 2,
  });
  assert.equal(result.meta.complete, true);
  assert.deepEqual(result.meta.notes, []);
});

test("hot_leads moves with every weight, the count cap, the recency window and the labels", async () => {
  const outbound = single(DATA);

  const run = async (input: Parameters<typeof outbound.insights.hotLeads>[0]) =>
    ranking((await outbound.insights.hotLeads(input, { now: NOW })).data.leads);

  assert.deepEqual(await run({ weight_interest: 0 }), [
    ["h1", 38],
    ["h2", 35],
    ["h3", 17],
    ["h5", 10],
  ]);
  // One reply, one click and one open at most: h1 is 50 + 10 + 5 + 1 + 10, h2 is 50 + 10 + 1 + 20.
  // h3 drops to 1 click x 5 + 1 open, under the two leads with one reply.
  assert.deepEqual(await run({ count_cap: 1 }), [
    ["h2", 81],
    ["h1", 76],
    ["h5", 10],
    ["h3", 6],
  ]);
  // A 7-day-old reply earns nothing in a 7-day window.
  assert.deepEqual((await run({ recency_days: 7 })).slice(0, 2), [
    ["h2", 85],
    ["h1", 78],
  ]);
  assert.deepEqual(
    (await run({ positive_labels: ["Not Interested"] })).slice(0, 3),
    [
      ["h4", 60],
      ["h1", 38],
      ["h2", 35],
    ]
  );
  // h2: 50 + 10 + 5 opens x 10 + 20. h1: 50 + 20 + 5 + 3 opens x 10 + 10.
  assert.deepEqual((await run({ weight_open: 10 })).slice(0, 2), [
    ["h2", 130],
    ["h1", 115],
  ]);
  // h3: 3 clicks x 100 + 2 opens. h1: 88 + 95 more for its click.
  assert.deepEqual((await run({ weight_click: 100 })).slice(0, 2), [
    ["h3", 302],
    ["h1", 183],
  ]);
  // Without reply and recency points h5 scores 0 and are not hot.
  assert.deepEqual(await run({ weight_recency: 0, weight_reply: 0 }), [
    ["h1", 58],
    ["h2", 55],
    ["h3", 17],
  ]);
  assert.deepEqual(await run({ limit: 2 }), [
    ["h1", 88],
    ["h2", 85],
  ]);
});

test("hot_leads ranks one campaign when given its ref", async () => {
  const result = await single(DATA).insights.hotLeads(
    { campaign: "memory:agency:c2" },
    { now: NOW }
  );

  assert.deepEqual(ranking(result.data.leads), [["h3", 17]]);
  assert.equal(result.data.totals.leadsRead, 1);
  assert.equal(result.data.leads[0]?.name, null);
});

test("hot_leads returns nobody when there are no leads", async () => {
  const result = await single({}).insights.hotLeads({}, { now: NOW });

  assert.deepEqual(result.data, {
    leads: [],
    totals: {
      autoReplied: 0,
      excluded: 0,
      fromReplies: 0,
      hot: 0,
      leadsRead: 0,
      moreLeadsExist: false,
      negative: 0,
      scored: 0,
      withoutData: 0,
    },
  });
  assert.equal(result.meta.complete, true);
});

test("hot_leads says the answer is partial when max_leads stops the read, and limit does not", async () => {
  const capped = await single(DATA).insights.hotLeads(
    { max_leads: 3 },
    { now: NOW }
  );

  assert.deepEqual(ranking(capped.data.leads), [
    ["h1", 88],
    ["h2", 85],
    ["h3", 17],
  ]);
  assert.equal(capped.meta.complete, false);
  assert.deepEqual(capped.meta.notes, [
    "Stopped at 3 leads (max_leads); more exist.",
  ]);

  const limited = await single(DATA).insights.hotLeads({ limit: 1 });
  assert.equal(limited.data.totals.hot, 4, "the count covers every hot lead");
  assert.equal(limited.meta.complete, true);
});

test("hot_leads needs a campaign when the tool cannot list every lead", async () => {
  const outbound = single(DATA, { "leads.list": false });

  await assert.rejects(
    async () => await outbound.insights.hotLeads({}),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      /needs a campaign here.*leads\.list/u.test(error.message)
  );

  const scoped = await outbound.insights.hotLeads(
    { campaign: "memory:agency:c2" },
    { now: NOW }
  );

  assert.deepEqual(ranking(scoped.data.leads), [["h3", 17]]);

  await assert.rejects(
    async () =>
      await single(DATA, { "leads.byCampaign": false }).insights.hotLeads({
        campaign: "memory:agency:c2",
      }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      /leads\.byCampaign/u.test(error.message)
  );
});

test("hot_leads notes when the tool reports no engagement counts", async () => {
  const result = await single(
    {
      campaigns: [{ id: "c1" }],
      leads: [
        {
          campaignId: "c1",
          email: "person1@example.com",
          id: "h1",
          interest: "Interested",
        },
        { campaignId: "c1", email: "person2@example.com", id: "h2" },
      ],
    },
    { "leads.engagement": false }
  ).insights.hotLeads({}, { now: NOW });

  assert.deepEqual(ranking(result.data.leads), [["h1", 50]]);
  assert.equal(result.data.leads[0]?.reason, "marked Interested.");
  assert.equal(result.data.totals.withoutData, 1);
  assert.deepEqual(result.meta.notes, [
    "This tool reports no per-lead open, click or reply counts, so scores rest on the interest label and the lead's status.",
  ]);
});

test("hot_leads ranks leads from two tools together", async () => {
  const result = await agency().insights.hotLeads({}, { now: NOW });

  // Only the first email record carries a label and a reply count: 50 + 10.
  assert.deepEqual(
    result.data.leads.map((each) => [each.lead, each.score]),
    [["mailtool:agency:l1", 60]]
  );
  assert.deepEqual(result.data.totals, {
    autoReplied: 0,
    excluded: 0,
    fromReplies: 0,
    hot: 1,
    leadsRead: 5,
    moreLeadsExist: false,
    negative: 0,
    scored: 1,
    withoutData: 4,
  });
  assert.equal(result.meta.provider, "combined");
  assert.deepEqual(result.meta.notes, []);
});

test("hot_leads on two tools names only the tool whose leads lack the counts", async () => {
  const outbound = createOutbound({
    adapter: combine([
      memory({ data: DATA, name: "mailtool", workspaceId: "agency" }),
      memory({
        capabilities: { "leads.engagement": false },
        data: {
          campaigns: [{ channel: "linkedin", id: "k1" }],
          leads: [{ campaignId: "k1", id: "p1", interest: "Interested" }],
        },
        name: "lntool",
        workspaceId: "agency",
      }),
    ]),
    plugins: [insights()],
  });

  const result = await outbound.insights.hotLeads({}, { now: NOW });

  const top = result.data.leads.find(
    (each) => each.lead === "mailtool:agency:h1"
  );

  // The email tool's lead keeps its counts in the score.
  assert.deepEqual([top?.replies, top?.clicks, top?.opens], [2, 1, 3]);
  assert.deepEqual(result.meta.notes, [
    "lntool reports no per-lead open, click or reply counts, so scores rest on the interest label and the lead's status for its records. Records from the other tools carry what their vendor reports.",
  ]);
});
