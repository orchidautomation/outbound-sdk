// Instantly leaves auto-replies unlabeled and counts them in a lead's reply
// count. On one anonymized campaign (OUT-92) a company mailbox and a helpdesk
// autoresponder ranked as hot leads and made the median reply 6 seconds.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import type { OutboundPlugin } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { redact } from "../../src/redact/index.ts";
import { fixtureHandler } from "../helpers/adapter-suite.ts";
import { createClock } from "../helpers/clock.ts";
import { createFetch } from "../helpers/http.ts";
import {
  autoReplyRoutes,
  HELPDESK,
  MAILBOX,
  PERSON,
} from "../instantly/auto-reply-fixture.ts";
import { suite } from "../instantly/suite.ts";
import { single } from "./helpers.ts";

const NOW = Date.parse("2026-11-08T12:00:00.000Z");
const SINCE = "2026-10-29T00:00:00.000Z";
const CAMPAIGN = "instantly:client-a:01a1d77f-5158-772f-ad63-67da136d2a92";

const instantly = (plugins: readonly OutboundPlugin[] = []) => {
  const clock = createClock();
  const unrouted: string[] = [];
  const fixtures = fixtureHandler([suite], unrouted);
  const routes = autoReplyRoutes();

  const http = createFetch(
    (request, index) => routes(request) ?? fixtures(request, index)
  );

  return {
    outbound: createOutbound({
      adapter: suite.make(),
      fetch: http.fetch,
      plugins: [...plugins, insights()],
      rateLimitStore: new MemoryRateLimitStore(),
      runtime: clock.runtime,
      share: 1,
    }),
    settle: clock.settle,
    unrouted,
  };
};

test("hot_leads ranks only the person who replied; the two autoresponders count as autoReplied", async () => {
  const { outbound, settle, unrouted } = instantly();

  // By default candidates come from replies, and an automatic reply makes no
  // one a candidate, so the two autoresponders are not even read.
  const result = await settle(
    outbound.insights.hotLeads({ campaign: CAMPAIGN }, { now: NOW })
  );

  assert.deepEqual(unrouted, []);
  assert.deepEqual(
    result.data.leads.map((each) => each.email),
    [PERSON]
  );
  assert.equal(result.data.totals.hot, 1);
  assert.equal(result.data.totals.autoReplied, 0);

  // Walking the lead list reads them, and their replies earn nothing.
  const walked = await settle(
    outbound.insights.hotLeads(
      { campaign: CAMPAIGN, include_engagement_only: true },
      { now: NOW }
    )
  );

  assert.deepEqual(
    walked.data.leads.map((each) => each.email),
    [PERSON]
  );
  assert.equal(walked.data.totals.autoReplied, 2);
});

for (const strategy of ["mask", "hash"] as const) {
  test(`hot_leads under a ${strategy} redact still counts the two autoresponders as autoReplied`, async () => {
    const { outbound, settle } = instantly([redact({ strategy })]);

    const result = await settle(
      outbound.insights.hotLeads({ campaign: CAMPAIGN }, { now: NOW })
    );

    assert.equal(result.data.leads.length, 1);
    assert.equal(result.data.totals.hot, 1);
    assert.equal(result.data.totals.autoReplied, 2);
  });
}

test("person_summary counts no replies from a mailbox whose every reply was automatic", async () => {
  const { outbound, settle } = instantly();

  const mailbox = await settle(
    outbound.insights.personSummary({ person: MAILBOX }, { now: NOW })
  );

  const [record] = mailbox.data.campaigns;

  assert.equal(record?.autoReplied, true);
  assert.equal(record?.replies, 0);
  assert.equal(record?.replied, false);
  assert.equal(record?.lastRepliedAt, null);
  assert.deepEqual(record?.repliedSteps, []);
  assert.equal(mailbox.data.totals.replies, 0);

  const helpdesk = await settle(
    outbound.insights.personSummary({ person: HELPDESK }, { now: NOW })
  );

  assert.equal(helpdesk.data.campaigns[0]?.autoReplied, true);
  assert.equal(helpdesk.data.campaigns[0]?.replies, 0);

  // The person who answered is still a person who replied, twice.
  const person = await settle(
    outbound.insights.personSummary({ person: PERSON }, { now: NOW })
  );

  assert.equal(person.data.campaigns[0]?.autoReplied, false);
  assert.equal(person.data.campaigns[0]?.replies, 2);
  assert.equal(person.data.campaigns[0]?.replied, true);
});

test("reply_timing leaves auto-replies out by default, so the median is the person's day, not 6 seconds", async () => {
  const { outbound, settle } = instantly();

  const result = await settle(
    outbound.insights.replyTiming(
      { campaign: CAMPAIGN, since: SINCE },
      { now: NOW }
    )
  );

  // Sent 2026-10-30T18:51, answered 2026-10-31T18:40: 23.8167 hours.
  assert.equal(result.data.timeToReply.sample, 1);
  assert.equal(result.data.timeToReply.medianHours, 23.8167);
  assert.equal(result.data.counts.autoReplies, 6);
  assert.equal(result.data.counts.received, 2);
  assert.equal(result.data.counts.followOnReplies, 1);

  const all = await settle(
    outbound.insights.replyTiming(
      { campaign: CAMPAIGN, include_auto: true, since: SINCE },
      { now: NOW }
    )
  );

  // 4 mailbox replies within seconds, 2 helpdesk replies within minutes.
  assert.equal(all.data.timeToReply.sample, 7);
  assert.equal(all.data.counts.autoReplies, 0);
  assert.ok((all.data.timeToReply.medianHours ?? 1) < 0.01);
});

// Two auto-replies and one human reply from the same lead: only the human one counts.
const MIXED: MemoryData = {
  campaigns: [{ id: "c1" }],
  leads: [
    {
      campaignId: "c1",
      email: "person1@example.com",
      engagement: { replies: 3 },
      id: "mixed",
    },
  ],
  messages: [
    {
      campaignId: "c1",
      direction: "out",
      id: "m1",
      leadId: "mixed",
      sentAt: "2026-11-10T09:00:00.000Z",
      stepIndex: 0,
      threadId: "t1",
    },
    {
      campaignId: "c1",
      direction: "in",
      id: "m2",
      isAuto: true,
      leadId: "mixed",
      sentAt: "2026-11-10T09:00:05.000Z",
      threadId: "t1",
    },
    {
      campaignId: "c1",
      direction: "in",
      id: "m3",
      isAuto: true,
      leadId: "mixed",
      sentAt: "2026-11-11T09:00:05.000Z",
      threadId: "t1",
    },
    {
      campaignId: "c1",
      direction: "in",
      id: "m4",
      isAuto: false,
      leadId: "mixed",
      sentAt: "2026-11-12T09:00:00.000Z",
      threadId: "t1",
    },
  ],
};

test("a lead with one human reply among automatic ones still replied, and only the human reply counts", async () => {
  const outbound = single(MIXED);
  const now = Date.parse("2026-11-14T12:00:00.000Z");

  const summary = await outbound.insights.personSummary(
    { person: "person1@example.com" },
    { now }
  );

  assert.equal(summary.data.campaigns[0]?.autoReplied, false);
  assert.equal(summary.data.campaigns[0]?.replies, 1);
  assert.equal(
    summary.data.campaigns[0]?.lastRepliedAt,
    "2026-11-12T09:00:00.000Z"
  );

  const hot = await outbound.insights.hotLeads({}, { now });

  // The vendor counts 3 replies; one was a person, so the lead still scores.
  assert.equal(hot.data.leads[0]?.lead, "memory:agency:mixed");
  assert.equal(hot.data.totals.autoReplied, 0);

  const timing = await outbound.insights.replyTiming(
    { since: "2026-11-01T00:00:00.000Z" },
    { now }
  );

  // The human reply pairs with the send once the automatic ones are left out.
  assert.equal(timing.data.timeToReply.sample, 1);
  assert.equal(timing.data.timeToReply.medianHours, 48);
  assert.equal(timing.data.counts.autoReplies, 2);
});
