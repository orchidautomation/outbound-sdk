// dropped_replies on a window the size the OUT-109 stress test met on a live
// Instantly workspace: 179 replies in 14 days over two pages, 109 of them
// out-of-office and 39 negative, and the one nobody answered 51st in the list.

import assert from "node:assert/strict";
import { test } from "node:test";

import { cardFor } from "../../src/cards/index.ts";
import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { fixtureHandler } from "../helpers/adapter-suite.ts";
import { createClock } from "../helpers/clock.ts";
import { createFetch, json } from "../helpers/http.ts";
import { CAMPAIGN, suite as instantly } from "../instantly/suite.ts";
import { NOW } from "./helpers.ts";

const HOUR = 3_600_000;

const at = (hoursAgo: number): string =>
  new Date(NOW - hoursAgo * HOUR).toISOString();

type Kind = "dropped" | "human" | "negative" | "ooo" | "recent";

// The 177 replies besides the dropped and the recent one, spread through the
// window in a fixed order: 7 is coprime with 177, so each kind lands once.
const OTHERS: readonly Kind[] = [
  ...Array.from({ length: 109 }, (): Kind => "ooo"),
  ...Array.from({ length: 39 }, (): Kind => "negative"),
  ...Array.from({ length: 29 }, (): Kind => "human"),
];

// Position 50 (the 51st reply) waits unanswered; 12 is unanswered but two hours old.
const kindAt = (index: number): Kind => {
  if (index === 50) {
    return "dropped";
  }

  if (index === 12) {
    return "recent";
  }

  const slot = index - (index > 12 ? 1 : 0) - (index > 50 ? 1 : 0);

  return OTHERS[(slot * 7) % OTHERS.length] ?? "ooo";
};

const STATUS: Readonly<Record<Kind, number>> = {
  dropped: 1,
  human: 1,
  negative: -1,
  ooo: 0,
  recent: 1,
};

const email = (index: number, kind: Kind) => {
  const sent = at(kind === "recent" ? 2 : 3 + index);

  return {
    campaign_id: CAMPAIGN,
    content_preview:
      kind === "ooo" ? "I am out of the office until Monday." : "Tell me more.",
    eaccount: "person1@example.com",
    from_address_email: `person${index + 100}@example.com`,
    i_status: STATUS[kind],
    id: `reply-${index}`,
    lead: `person${index + 100}@example.com`,
    step: "0_0_0",
    subject: kind === "ooo" ? "Out of Office: Re: hello" : "Re: hello",
    thread_id: `thread-${index}`,
    timestamp_created: sent,
    timestamp_email: sent,
    ue_type: 2,
  };
};

const REPLIES = Array.from({ length: 179 }, (_, index) =>
  email(index, kindAt(index))
);

// Every human reply but the dropped and the recent one was answered by hand
// an hour later, in the same thread.
const ANSWERS = REPLIES.filter((_, index) => kindAt(index) === "human").map(
  (reply) => {
    const sent = new Date(
      Date.parse(reply.timestamp_email) + HOUR
    ).toISOString();

    return {
      ...reply,
      from_address_email: "person1@example.com",
      id: `answer-${reply.id}`,
      timestamp_created: sent,
      timestamp_email: sent,
      ue_type: 3,
    };
  }
);

// Answers by hand to conversations outside the window's replies, listed first.
const elsewhere = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    ...ANSWERS[0],
    id: `elsewhere-${index}`,
    lead: `person${index + 1000}@example.com`,
    thread_id: `elsewhere-${index}`,
  }));

const leadOf = (address: string) => ({
  campaign: CAMPAIGN,
  email: address,
  first_name: "Sam",
  id: `lead-${address.split("@")[0] ?? address}`,
  last_name: "Sample",
});

const workspace = (padding = 0) => {
  const clock = createClock();
  const unrouted: string[] = [];
  const fixtures = fixtureHandler([instantly], unrouted);

  const http = createFetch((request, index) => {
    const url = new URL(request.url);

    if (url.pathname === "/api/v2/leads/list") {
      const { contacts = [] } = JSON.parse(request.body ?? "{}") as {
        contacts?: string[];
      };

      return json({ items: contacts.map(leadOf) });
    }

    const byId = /^\/api\/v2\/leads\/lead-(?<local>[^/]+)$/u.exec(url.pathname);

    if (byId?.groups?.local !== undefined) {
      return json(leadOf(`${byId.groups.local}@example.com`));
    }

    if (url.pathname !== "/api/v2/emails") {
      return fixtures(request, index);
    }

    const type = url.searchParams.get("email_type");

    if (type === "received") {
      return url.searchParams.get("starting_after") === null
        ? json({ items: REPLIES.slice(0, 100), next_starting_after: "p2" })
        : json({ items: REPLIES.slice(100) });
    }

    if (type === "manual") {
      // Two pages, so a listing read to its end leaves the answer complete.
      if (url.searchParams.get("starting_after") === null) {
        return json({
          items: [...elsewhere(padding), ...ANSWERS.slice(0, 20)],
          next_starting_after: "a2",
        });
      }

      // A campaign send after the dropped reply, in the same listing, is not
      // an answer by hand: it is left out, so that conversation is read.
      return json({
        items: [
          ...ANSWERS.slice(20),
          {
            ...REPLIES[50],
            id: "campaign-send",
            timestamp_created: at(1),
            timestamp_email: at(1),
            ue_type: 1,
          },
        ],
      });
    }

    const thread = url.searchParams.get("search")?.replace(/^thread:/u, "");

    return json({
      items: [...REPLIES, ...ANSWERS].filter(
        (each) => each.thread_id === thread
      ),
    });
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

const urlsOf = (requests: readonly { readonly url: string }[]): URL[] =>
  requests.map((request) => new URL(request.url));

const threadReads = (urls: readonly URL[]): string[] =>
  urls.flatMap((url) => {
    const search = url.searchParams.get("search");

    return search === null ? [] : [search];
  });

test("the window holds the stress test's shape", () => {
  const kinds = REPLIES.map((_, index) => kindAt(index));

  assert.equal(REPLIES.length, 179);
  assert.equal(kinds.filter((kind) => kind === "ooo").length, 109);
  assert.equal(kinds.filter((kind) => kind === "negative").length, 39);
  assert.equal(kinds.filter((kind) => kind === "human").length, 29);
  assert.equal(kinds.indexOf("dropped"), 50);
});

test("dropped_replies reads the whole window by default and finds the 51st reply in a few requests", async () => {
  const { clock, http, outbound, unrouted } = workspace();

  const result = await clock.settle(
    outbound.insights.droppedReplies({}, { now: NOW })
  );

  const urls = urlsOf(http.requests);

  assert.deepEqual(unrouted, []);
  assert.deepEqual(
    result.data.dropped.map((each) => [each.reply, each.checkedBy, each.name]),
    [["instantly:client-a:reply-50", "thread", "Sam Sample"]]
  );
  assert.deepEqual(result.data.totals, {
    answered: 29,
    conversations: 31,
    dropped: 1,
    moreRepliesExist: false,
    notInCampaign: null,
    repliesRead: 179,
    skippedAuto: 0,
    skippedByCategory: 148,
    tooRecent: 1,
    unchecked: 0,
  });
  assert.equal(result.meta.complete, true);
  assert.ok(
    result.meta.notes.every((note) => !note.includes("sent by hand stopped")),
    JSON.stringify(result.meta.notes)
  );

  // Two pages of replies, two of answers sent by hand, and only the dropped
  // conversation read in full.
  assert.deepEqual(
    urls
      .filter((url) => url.pathname === "/api/v2/emails")
      .map((url) => url.searchParams.get("email_type")),
    ["received", "received", "manual", "manual", null]
  );
  assert.deepEqual(threadReads(urls), ["thread:thread-50"]);
  // Each page of emails looks up its leads' ids once (OUT-149); the rest of
  // the read stays within 10 requests.
  const lookups = urls.filter((url) => url.pathname === "/api/v2/leads/list");
  assert.equal(
    lookups.length,
    urls.filter((url) => url.pathname === "/api/v2/emails").length
  );
  assert.ok(
    result.meta.requests - lookups.length <= 10,
    `${result.meta.requests} requests`
  );
  assert.equal(result.meta.requests, http.requests.length);
  assert.ok(clock.elapsed() < 5000, `${clock.elapsed()} ms`);
});

test("dropped_replies with the old cap of 50 replies misses the 51st, and the card does not call that clean", async () => {
  const { clock, outbound } = workspace();

  const result = await clock.settle(
    outbound.insights.droppedReplies({ max_replies: 50 }, { now: NOW })
  );

  assert.equal(result.data.totals.dropped, 0);
  assert.equal(result.data.totals.moreRepliesExist, true);
  assert.equal(result.meta.complete, false);

  const card = JSON.stringify(cardFor("dropped_replies", result));

  assert.match(card, /Could not check every reply/u);
  assert.doesNotMatch(card, /Every reply read has an answer/u);
});

test("dropped_replies without messages.byHand reads every conversation and gives the same answer", async () => {
  const { clock, http, outbound } = workspace();

  const listed = await clock.settle(
    outbound.insights.droppedReplies({}, { now: NOW })
  );

  const adapter = instantly.make();

  const plain = createOutbound({
    adapter: {
      ...adapter,
      capabilities: { ...adapter.capabilities, "messages.byHand": false },
    },
    fetch: http.fetch,
    plugins: [insights()],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  const before = http.requests.length;

  const read = await clock.settle(
    plain.insights.droppedReplies({}, { now: NOW })
  );

  const urls = urlsOf(http.requests.slice(before));

  assert.deepEqual(read.data.dropped, listed.data.dropped);
  assert.deepEqual(read.data.totals, listed.data.totals);
  assert.equal(threadReads(urls).length, 31);
  assert.ok(
    urls.every((url) => url.searchParams.get("email_type") !== "manual")
  );
});

test("dropped_replies whose listing of messages sent by hand stops at max reads the rest in full and drops none of them", async () => {
  const { clock, http, outbound } = workspace(170);

  const result = await clock.settle(
    outbound.insights.droppedReplies({ max_replies: 179 }, { now: NOW })
  );

  const urls = urlsOf(http.requests);

  assert.deepEqual(
    result.data.dropped.map((each) => each.reply),
    ["instantly:client-a:reply-50"]
  );
  assert.equal(result.data.totals.answered, 29);
  assert.equal(result.data.totals.moreRepliesExist, false);
  assert.equal(result.meta.complete, true);
  assert.ok(
    result.meta.notes.includes(
      "The messages sent by hand stopped at 179, so each conversation they did not settle was read in full."
    ),
    JSON.stringify(result.meta.notes)
  );

  // The 20 answers past the stop settle no conversation, so those 20, the
  // dropped one and the recent one, whose answer may lie past the stop, are
  // read by thread.
  assert.equal(threadReads(urls).length, 22);
});

test("dropped_replies whose listing of messages sent by hand stops at max does not count a young answered reply as too recent", async () => {
  const { clock, http, outbound } = workspace(170);

  // Every reply is younger than 200 hours, so none past the stop may be
  // settled as too recent from the listing alone.
  const result = await clock.settle(
    outbound.insights.droppedReplies(
      { max_replies: 179, older_than_hours: 200 },
      { now: NOW }
    )
  );

  assert.deepEqual(result.data.dropped, []);
  assert.equal(result.data.totals.answered, 29);
  assert.equal(result.data.totals.tooRecent, 2);
  assert.equal(threadReads(urlsOf(http.requests)).length, 22);
});
