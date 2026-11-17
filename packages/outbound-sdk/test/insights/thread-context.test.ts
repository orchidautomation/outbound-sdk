import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import { redact } from "../../src/redact/index.ts";
import { fixtureHandler } from "../helpers/adapter-suite.ts";
import { createClock } from "../helpers/clock.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import { suite as instantly } from "../instantly/suite.ts";

// Two conversations of the OUT-137 handoff, in Instantly's live shape. Both
// carry a vendor-labelled positive reply that nobody answered. The first
// prospect then booked a meeting; in the second, a later message warns that
// an earlier email was fraudulent.
const EMAILS = (
  fixture("instantly", "listEmails.followUp.json") as {
    items: { lead: string; thread_id: string; ue_type: number }[];
  }
).items;

const LEADS = (
  fixture("instantly", "listLeads.followUp.json") as {
    items: { email: string }[];
  }
).items;

const NOW = Date.parse("2026-11-17T12:00:00.000Z");
const BOOKED = "instantly:client-a:person41@example.com";
const WARNED = "instantly:client-a:person42@example.com";

const setup = () => {
  const clock = createClock();
  const unrouted: string[] = [];
  const fixtures = fixtureHandler([instantly], unrouted);

  const http = createFetch((request, index) => {
    const url = new URL(request.url);

    if (url.searchParams.get("lead") === "person43@example.com") {
      return json({ message: "Not found" }, 404);
    }

    if (url.pathname === "/api/v2/emails") {
      const type = url.searchParams.get("email_type");
      const search = url.searchParams.get("search") ?? "";
      const lead = url.searchParams.get("lead");

      return json({
        items: EMAILS.filter(
          (item) =>
            (type !== "received" || item.ue_type === 2) &&
            type !== "manual" &&
            (!search.startsWith("thread:") ||
              item.thread_id === search.slice(7)) &&
            (lead === null || item.lead === lead)
        ),
      });
    }

    if (url.pathname === "/api/v2/leads/list") {
      const body = JSON.parse(request.body ?? "{}") as { contacts?: string[] };

      return json({
        items: LEADS.filter((item) => body.contacts?.includes(item.email)),
      });
    }

    return fixtures(request, index);
  });

  const outbound = createOutbound({
    adapter: instantly.make(),
    fetch: http.fetch,
    plugins: [insights()],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  return { clock, http, outbound, unrouted };
};

/** The dropped reply of one lead, with the thread context dropped_replies always sets. */
const droppedFor = async (lead: string) => {
  const { clock, outbound, unrouted } = setup();

  const { data } = await clock.settle(
    outbound.insights.droppedReplies({ since: "2026-11-01" }, { now: NOW })
  );

  assert.deepEqual(unrouted, []);
  // Nothing was sent after either reply: both stay in the list.
  assert.equal(data.totals.dropped, 2);

  const found = data.dropped.find((each) => each.lead === lead);
  const { activity, followUp, meeting, vendorSentiment } = found ?? {};

  assert.ok(found && activity && followUp && vendorSentiment);

  return { activity, followUp, found, meeting, vendorSentiment };
};

test("dropped_replies says when the vendor records a booked meeting, so a positive reply is not called overdue", async () => {
  const { followUp, found, meeting, vendorSentiment } =
    await droppedFor(BOOKED);

  // The booking comes from Instantly's interest status, not from the label's words.
  assert.equal(meeting, "booked");
  assert.equal(vendorSentiment.replyCategory, "positive");
  assert.equal(followUp.needed, false);
  assert.equal(followUp.basis, "meeting");
  assert.ok(
    followUp.evidence.includes(
      "instantly records the lead's meeting as booked."
    )
  );
  assert.match(
    found.finding,
    /meeting as booked\. Check it before following up\.$/u
  );
});

test("dropped_replies names a later message than the labelled reply, so the agent reads it", async () => {
  const { activity, followUp, found, meeting } = await droppedFor(WARNED);
  const { latest } = activity;

  assert.equal(meeting, null);
  assert.equal(latest?.direction, "in");
  assert.equal(latest?.sentAt, "2026-11-13T15:20:00.000Z");
  assert.notEqual(latest?.ref, found.reply);
  assert.equal(followUp.needed, true);
  assert.deepEqual(followUp.evidence, [
    "The latest message is inbound and unanswered for 3 days (received 2026-11-13 15:20 UTC).",
    "The vendor's positive label is on an earlier reply (2026-11-10 11:00 UTC), 3 days before the latest message, so it may not describe the conversation now.",
    "instantly records no meeting for the lead.",
  ]);
  assert.ok(
    followUp.unchecked.some((each) => each.includes("never the words"))
  );
  assert.match(
    found.finding,
    /The latest message is inbound and unanswered for 3 days .*Read it before following up\.$/u
  );
});

test("thread_context reads the conversations of given leads and threads, with the latest message to read and coverage", async () => {
  const { clock, http, outbound } = setup();
  const thread = EMAILS[0]?.thread_id ?? "";

  const first = await clock.settle(
    outbound.insights.threadContext(
      { leads: [BOOKED, WARNED], page_size: 2, threads: [thread] },
      { now: NOW }
    )
  );

  // No campaign-wide reply listing: one read per conversation, and the leads.
  assert.equal(
    http.requests.filter(
      (request) =>
        new URL(request.url).searchParams.get("email_type") === "received"
    ).length,
    0
  );
  assert.equal(first.meta.complete, false);
  assert.deepEqual(first.data.coverage, {
    checked: 2,
    found: 2,
    nextCursor: "2/3",
    notFound: [],
    remaining: 1,
    requested: 3,
    unchecked: [],
  });

  const [booked, warned] = first.data.threads;

  assert.equal(booked?.followUp.basis, "meeting");
  assert.equal(warned?.followUp.basis, "inbound_unanswered");
  assert.equal(warned?.vendorSentiment.leadLabel, "Interested");
  // The warning is surfaced as text to read, marked untrusted, never classified.
  assert.match(
    String(warned?.messages.at(-1)?.snippet?.untrusted_content),
    /^Please disregard the RFP email/u
  );
  assert.equal(warned?.messages.at(-1)?.snippet?.truncated, false);

  const rest = await clock.settle(
    outbound.insights.threadContext(
      {
        cursor: first.data.coverage.nextCursor,
        leads: [BOOKED, WARNED],
        page_size: 2,
        threads: [thread],
      },
      { now: NOW }
    )
  );

  assert.equal(rest.data.threads[0]?.target.kind, "thread");
  assert.equal(rest.data.threads[0]?.lead, WARNED);
  assert.equal(rest.data.coverage.nextCursor, null);
});

test("thread_context refuses a cursor from other inputs, and an unsupported read, before any request", async () => {
  const { http, outbound } = setup();

  await assert.rejects(
    outbound.insights.threadContext({ cursor: "1/5", leads: [BOOKED] }),
    { code: "Invalid" }
  );
  assert.equal(http.requests.length, 0);

  // A tool that cannot read a thread by its id, as a combined instance cannot.
  const noThreads = createOutbound({
    adapter: memory({ capabilities: { "messages.byThread": false }, data: {} }),
    plugins: [insights()],
  });

  await assert.rejects(noThreads.insights.threadContext({ threads: ["t1"] }), {
    code: "Unsupported",
  });

  // Snippets are message text, which redact masks: refused, and none still reads.
  const redacted = createOutbound({
    adapter: memory({ data: {} }),
    plugins: [redact({}), insights()],
  });

  await assert.rejects(redacted.insights.threadContext({ leads: [BOOKED] }), {
    code: "Unsupported",
  });

  const plain = await redacted.insights.threadContext({
    bodies: "none",
    leads: ["memory:default:nobody"],
  });

  assert.equal(plain.data.coverage.requested, 1);
});

test("thread_context counts a conversation it could not read as unchecked, with why, never as answered", async () => {
  const { clock, outbound } = setup();
  const missing = "instantly:client-a:person43@example.com";

  const { data } = await clock.settle(
    outbound.insights.threadContext(
      { bodies: "none", leads: [missing, WARNED] },
      { now: NOW }
    )
  );

  assert.deepEqual(data.coverage.unchecked, [
    {
      reason: "the read failed with NotFound",
      target: { id: missing, kind: "lead" },
    },
  ]);
  assert.equal(data.coverage.checked, 1);
  assert.equal(data.threads[0]?.followUp.needed, null);
  assert.equal(data.threads[0]?.followUp.basis, "not_read");
  assert.equal(data.threads[1]?.messages.at(-1)?.snippet, null);
});
