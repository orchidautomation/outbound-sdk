// OUT-146: a reply the vendor labels positive that arrived seconds after the
// send it answers is automatic, but only the full thread read can say so: the
// reply listing has no send to time it against. dropped_replies must not
// count it as a reply a person owes.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { fixtureHandler } from "../helpers/adapter-suite.ts";
import { createClock } from "../helpers/clock.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import { suite as instantly } from "../instantly/suite.ts";

const EMAILS = (
  fixture("instantly", "listEmails.timedAuto.json") as {
    items: { lead: string; thread_id: string; ue_type: number }[];
  }
).items;

const LEADS = (
  fixture("instantly", "listLeads.timedAuto.json") as {
    items: { email: string; id: string }[];
  }
).items;

const NOW = Date.parse("2026-11-17T12:00:00.000Z");
const TIMED = "instantly:client-a:01a1d77f-5e65-78a7-8eb0-021400000071";
const PERSON = "instantly:client-a:01a1d77f-5e65-78a7-8eb0-021400000072";

const setup = () => {
  const clock = createClock();
  const unrouted: string[] = [];
  const fixtures = fixtureHandler([instantly], unrouted);

  const http = createFetch((request, index) => {
    const url = new URL(request.url);

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

    const byId = LEADS.find(
      (item) => url.pathname === `/api/v2/leads/${item.id}`
    );

    if (byId !== undefined) {
      return json(byId);
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

  return { clock, outbound, unrouted };
};

test("the reply listing cannot time a reply, so only the thread read marks the timed reply automatic", async () => {
  const { clock, outbound } = setup();

  const listed = await clock.settle(
    outbound.replies.listAll({ since: "2026-11-01" }).toArray()
  );

  const timeline = await clock.settle(outbound.lead(TIMED).timeline());

  const reply = listed.find((each) => each.leadRef === TIMED);
  const read = timeline.items.find((each) => each.ref === reply?.ref);

  assert.equal(reply?.category, "positive");
  assert.equal(reply?.isAuto, false);
  assert.equal(read?.isAuto, true);
  assert.equal(read?.isAutoSource, "rule");
});

test("dropped_replies counts a conversation that ends in an automatic reply in skippedAuto, not as dropped", async () => {
  const { clock, outbound, unrouted } = setup();

  const { data, meta } = await clock.settle(
    outbound.insights.droppedReplies({ since: "2026-11-01" }, { now: NOW })
  );

  assert.deepEqual(unrouted, []);
  assert.deepEqual(
    data.dropped.map((each) => each.lead),
    [PERSON]
  );
  assert.equal(data.dropped[0]?.followUp?.needed, true);
  // Every listed item is owed by a person, and the count says the same.
  assert.equal(
    data.totals.dropped,
    data.dropped.filter((each) => each.followUp?.needed === true).length
  );
  assert.deepEqual(
    {
      answered: data.totals.answered,
      conversations: data.totals.conversations,
      dropped: data.totals.dropped,
      skippedAuto: data.totals.skippedAuto,
      tooRecent: data.totals.tooRecent,
      unchecked: data.totals.unchecked,
    },
    {
      answered: 0,
      conversations: 1,
      dropped: 1,
      skippedAuto: 1,
      tooRecent: 0,
      unchecked: 0,
    }
  );
  assert.ok(
    meta.notes.includes(
      "1 conversation ended in an automatic reply once read in full (such as one within a minute of the email it answers), so its 1 reply is counted in totals.skippedAuto, not as dropped. Pass include_auto: true to list them."
    )
  );
  assert.equal(meta.complete, true);
});

test("dropped_replies with include_auto lists the automatic conversation, marked automatic", async () => {
  const { clock, outbound } = setup();

  const { data } = await clock.settle(
    outbound.insights.droppedReplies(
      { include_auto: true, since: "2026-11-01" },
      { now: NOW }
    )
  );

  const timed = data.dropped.find((each) => each.lead === TIMED);

  assert.equal(data.totals.dropped, 2);
  assert.equal(data.totals.skippedAuto, 0);
  assert.equal(timed?.followUp?.basis, "automatic");
  assert.equal(timed?.followUp?.needed, null);
});

// OUT-156: a request cap that stops the conversation reads part way keeps
// what was read, counts the rest as unchecked and says so, instead of
// throwing the whole answer away.
test("dropped_replies at its request cap returns what it read, with the stopped conversations unchecked", async () => {
  const { clock, outbound } = setup();

  const { data, meta } = await clock.settle(
    outbound.insights.droppedReplies(
      { since: "2026-11-01" },
      { maxRequests: 3, now: NOW }
    )
  );

  assert.equal(meta.complete, false);
  assert.ok(meta.requests <= 3);
  assert.ok(data.totals.unchecked > 0);
  assert.equal(
    data.totals.answered +
      data.totals.dropped +
      data.totals.tooRecent +
      data.totals.unchecked,
    data.totals.conversations
  );
  assert.ok(
    meta.notes.some((note) => note.startsWith("Stopped after 3 requests")),
    meta.notes.join("\n")
  );
});
