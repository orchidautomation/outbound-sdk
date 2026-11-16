import assert from "node:assert/strict";
import { test } from "node:test";

import { run } from "../../src/cli/index.ts";
import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { fixtureHandler } from "../helpers/adapter-suite.ts";
import { createClock } from "../helpers/clock.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { CAMPAIGN, suite } from "./suite.ts";

// The live shape behind OUT-124: GetConversationsV3 lists the sender's whole
// LinkedIn inbox. One conversation belongs to a campaign and names it in
// campaignId; a recruiter's message and an inbound pitch belong to none and
// leave the key out. All three end on the other person's message.
const INBOX = fixture("heyreach", "getConversations.inbox.json") as {
  items: { id: string; campaignId?: number }[];
};

const NOW = Date.parse("2026-11-16T12:00:00.000Z");
const IN_CAMPAIGN = `heyreach:client-a:${CAMPAIGN}`;

/** Serves the inbox fixture, and each of its conversations read alone. */
const inboxFetch = () => {
  const unrouted: string[] = [];
  const fixtures = fixtureHandler([suite], unrouted);

  const http = createFetch((request: RecordedRequest, index) => {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/public/inbox/GetConversationsV3") {
      return json(INBOX);
    }

    const chatroom =
      /^\/api\/public\/inbox\/GetChatroom\/4101\/(?<id>.+)$/u.exec(pathname)
        ?.groups?.id;

    const item = INBOX.items.find(
      (each) => each.id === decodeURIComponent(chatroom ?? "")
    );

    return item === undefined ? fixtures(request, index) : json(item);
  });

  return { http, unrouted };
};

const instance = () => {
  const clock = createClock();
  const { http, unrouted } = inboxFetch();

  const outbound = createOutbound({
    adapter: suite.make(),
    fetch: http.fetch,
    plugins: [insights()],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  return { clock, http, outbound, unrouted };
};

test("heyreach: replies are campaign replies by default and name their campaign; includeInbox adds the inbox's own", async () => {
  const { clock, outbound } = instance();

  assert.equal(outbound.capabilities["replies.inbox"], true);

  const campaign = await clock.settle(outbound.replies.listAll().toArray());

  assert.deepEqual(
    campaign.map((reply) => [reply.leadRef, reply.campaignRef]),
    [
      [
        "heyreach:client-a:https://www.linkedin.com/in/example-person-1",
        IN_CAMPAIGN,
      ],
    ],
    "only the conversation that belongs to a campaign, with its campaign"
  );

  const everything = await clock.settle(
    outbound.replies.listAll({ includeInbox: true }).toArray()
  );

  assert.deepEqual(
    everything.map((reply) => reply.campaignRef),
    [null, null, IN_CAMPAIGN],
    "the inbox's own conversations come back with no campaign"
  );

  const messages = await clock.settle(outbound.messages.listAll().toArray());

  assert.equal(messages.length, 4, "messages.list keeps every conversation");
  assert.deepEqual(
    messages.map((message) => message.campaignRef),
    [null, null, IN_CAMPAIGN, IN_CAMPAIGN]
  );
});

test("heyreach: dropped_replies sets aside conversations in no campaign and counts them, unless include_inbox", async () => {
  const { clock, outbound, unrouted } = instance();

  const result = await clock.settle(
    outbound.insights.droppedReplies({ since: "2026-10-01" }, { now: NOW })
  );

  assert.deepEqual(unrouted, []);
  assert.deepEqual(
    result.data.dropped.map((each) => [each.lead, each.campaign]),
    [
      [
        "heyreach:client-a:https://www.linkedin.com/in/example-person-1",
        IN_CAMPAIGN,
      ],
    ]
  );
  assert.equal(result.data.totals.repliesRead, 3);
  assert.equal(result.data.totals.notInCampaign, 2);
  assert.equal(result.data.totals.dropped, 1);

  const all = instance();

  const inbox = await all.clock.settle(
    all.outbound.insights.droppedReplies(
      { include_inbox: true, since: "2026-10-01" },
      { now: NOW }
    )
  );

  assert.equal(inbox.data.totals.dropped, 3, "the behavior before the fix");
  assert.equal(inbox.data.totals.notInCampaign, 0);
});

test("heyreach: reply_timing leaves the inbox's own conversations out of every figure, unless include_inbox", async () => {
  const { clock, outbound } = instance();

  const result = await clock.settle(
    outbound.insights.replyTiming(
      { since: "2026-10-01T00:00:00Z" },
      { now: NOW }
    )
  );

  assert.equal(result.data.counts.messagesRead, 4);
  assert.equal(result.data.counts.notInCampaign, 2);
  assert.equal(result.data.counts.received, 1);
  assert.equal(result.data.counts.paired, 1);
  assert.equal(result.data.counts.unpaired, 0);

  const all = instance();

  const inbox = await all.clock.settle(
    all.outbound.insights.replyTiming(
      { include_inbox: true, since: "2026-10-01T00:00:00Z" },
      { now: NOW }
    )
  );

  assert.equal(inbox.data.counts.notInCampaign, 0);
  assert.equal(inbox.data.counts.received, 3);
  assert.equal(
    inbox.data.counts.unpaired,
    2,
    "a message that answers no send is the inbox, not a slow reply"
  );
});

/** The replies `outbound` prints for `argv`, over the inbox fixture. */
const cliReplies = async (...argv: string[]) => {
  const out: string[] = [];
  const { http } = inboxFetch();

  const code = await run(argv, {
    adapter: suite.make(),
    fetch: http.fetch,
    stderr: () => {},
    stdout: (text) => {
      out.push(text);
    },
  });

  assert.equal(code, 0);

  return (
    JSON.parse(out.join("\n")) as {
      data: { items: { campaignRef: string | null }[] };
    }
  ).data.items;
};

test("heyreach: outbound replies lists campaign replies, and --include-inbox lists the whole inbox", async () => {
  assert.deepEqual(
    (await cliReplies("replies")).map((reply) => reply.campaignRef),
    [IN_CAMPAIGN]
  );
  assert.deepEqual(
    (await cliReplies("replies", "--include-inbox")).map(
      (reply) => reply.campaignRef
    ),
    [null, null, IN_CAMPAIGN]
  );
});
