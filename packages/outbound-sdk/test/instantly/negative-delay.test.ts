// OUT-110: Instantly sent a step delay of -11 days on a live campaign. The
// step's wait becomes unknown with a note, and the rest of the sequence reads.

import assert from "node:assert/strict";
import { test } from "node:test";

import { cache } from "../../src/cache/index.ts";
import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import { createTools } from "../../src/tools/index.ts";
import { fixtureHandler, harness } from "../helpers/adapter-suite.ts";
import { createClock } from "../helpers/clock.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { CAMPAIGN, SENDER, suite } from "./suite.ts";

const NEGATIVE = fixture("instantly", "getCampaign.negativeDelay.json");

const campaignRead =
  (body: unknown) =>
  (request: RecordedRequest): Response | undefined =>
    new URL(request.url).pathname === `/api/v2/campaigns/${CAMPAIGN}`
      ? json(body)
      : undefined;

const steps = (delays: readonly [unknown, unknown][]) => ({
  id: CAMPAIGN,
  name: "Odd delays",
  sequences: [
    {
      steps: delays.map(([delay, unit]) => ({
        delay,
        delay_unit: unit,
        type: "email",
        variants: [{ body: "Hello", subject: "Hi" }],
      })),
    },
  ],
});

test("instantly: a negative step delay leaves that step's wait unknown, with a note", async () => {
  const { outbound, settle } = harness(suite, campaignRead(NEGATIVE));
  const sequence = await settle(outbound.campaign(CAMPAIGN).sequence());

  // Step 3's delay of -11 is the wait before step 4.
  assert.deepEqual(
    sequence.steps.map((step) => step.delayDays),
    [0, 2, 2, null]
  );
  assert.deepEqual(
    sequence.steps.map((step) => step.variants.length),
    [1, 1, 1, 1],
    "every step's copy is still read"
  );
  assert.deepEqual(sequence.meta.notes, [
    "Step 4's delay is negative in Instantly (-11 days); left out.",
  ]);
  assert.equal(sequence.meta.complete, true);
});

test("instantly: a sequence with only documented delays has no notes", async () => {
  const { outbound, settle } = harness(suite);
  const sequence = await settle(outbound.campaign(CAMPAIGN).sequence());

  assert.deepEqual(sequence.meta.notes, []);
  assert.ok(sequence.steps.every((step) => step.delayDays !== null));
});

test("instantly: an undocumented unit leaves the wait unknown with a note, and a missing delay stays silent", async () => {
  const { outbound, settle } = harness(
    suite,
    campaignRead(
      steps([
        [1, "weeks"],
        [null, "days"],
        [-30, "minutes"],
        [3, "hours"],
      ])
    )
  );

  const sequence = await settle(outbound.campaign(CAMPAIGN).sequence());

  assert.deepEqual(
    sequence.steps.map((step) => step.delayDays),
    [0, null, null, null]
  );
  assert.deepEqual(sequence.meta.notes, [
    "Step 2's delay is in a unit Instantly does not document (weeks); left out.",
    "Step 4's delay is negative in Instantly (-30 minutes); left out.",
  ]);
});

test("instantly: a subsequence's negative pre_delay leaves its first wait unknown, with a note", async () => {
  const listed = fixture("instantly", "listSubsequences.json") as {
    items: { sequences: { steps: Record<string, unknown>[] }[] }[];
  };

  const [first, ...rest] = listed.items;
  assert.ok(first !== undefined);

  const [head, ...tail] = first.sequences[0]?.steps ?? [];

  const odd = {
    ...first,
    sequences: [{ steps: [{ ...head, pre_delay: -2 }, ...tail] }],
  };

  const { outbound, settle } = harness(suite, (request) =>
    new URL(request.url).pathname === "/api/v2/subsequences"
      ? json({ items: [odd, ...rest] })
      : undefined
  );

  const subsequences = outbound.campaign(CAMPAIGN).subsequences.listAll();
  const items = await settle(subsequences.toArray());

  assert.equal(items[0]?.steps[0]?.delayDays, null);
  assert.equal(items.length, listed.items.length);
  assert.match(
    subsequences.meta?.notes.join(" ") ?? "",
    /Step 1's delay is negative in Instantly \(-2 /u
  );
});

test("instantly: a cached sequence keeps the note its first read gave", async () => {
  const clock = createClock();
  const unrouted: string[] = [];
  const fromFixtures = fixtureHandler([suite], unrouted);

  const http = createFetch(
    (request, index) =>
      campaignRead(NEGATIVE)(request) ?? fromFixtures(request, index)
  );

  const outbound = createOutbound({
    adapter: suite.make(),
    fetch: http.fetch,
    plugins: [cache({ now: () => 0, ttl: 60 })],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  const first = await clock.settle(outbound.campaign(CAMPAIGN).sequence());
  const second = await clock.settle(outbound.campaign(CAMPAIGN).sequence());

  assert.equal(http.requests.length, 1, "the second read is a cache hit");
  assert.deepEqual(second.meta.notes, first.meta.notes);
  assert.deepEqual(second.meta.notes, [
    "Step 4's delay is negative in Instantly (-11 days); left out.",
  ]);
});

const ACCOUNT = fixture("instantly", "getAccount.json") as object;

test("instantly: a negative daily limit on a mailbox is unknown with a note, and the mailbox still reads", async () => {
  const { outbound, settle } = harness(suite, (request) =>
    decodeURIComponent(new URL(request.url).pathname) ===
    `/api/v2/accounts/${SENDER}`
      ? json({ ...ACCOUNT, daily_limit: -5, email: SENDER })
      : undefined
  );

  const sender = await settle(outbound.senders.get(SENDER));

  assert.equal(sender.dailyLimit, null);
  assert.equal(sender.address, SENDER);
  assert.deepEqual(sender.meta.notes, [
    `The daily limit of ${SENDER} is negative in Instantly (-5); left out.`,
  ]);
});

test("instantly: negative campaign limits are unknown with a note, and the settings still read", async () => {
  const campaign = fixture("instantly", "getCampaign.json") as object;

  const { outbound, settle } = harness(
    suite,
    campaignRead({
      ...campaign,
      daily_limit: -1,
      daily_max_leads: -2,
      email_gap: -3,
    })
  );

  const settings = await settle(outbound.campaign(CAMPAIGN).settings());

  assert.deepEqual(
    [settings.dailyLimit, settings.dailyNewLeads, settings.gapMinutes],
    [null, null, null]
  );
  assert.ok(settings.schedule.length > 0, "the rest of the settings are read");
  assert.deepEqual(settings.meta.notes, [
    "The campaign's daily limit is negative in Instantly (-1); left out.",
    "The campaign's daily limit of new leads is negative in Instantly (-2); left out.",
    "The gap between emails is negative in Instantly (-3 minutes); left out.",
  ]);
});

const toolCall = async (
  answer: (request: RecordedRequest) => Response | undefined,
  name: string,
  input: Record<string, string | number>
) => {
  const { outbound, settle } = harness(suite, answer);
  const tool = createTools(outbound).find((each) => each.name === name);

  assert.ok(tool, `${name} is offered`);
  const result = await settle(tool.call(input));
  assert.ok(result.ok, JSON.stringify(result));

  return result;
};

test("instantly: campaign_setup carries the note for a negative campaign limit", async () => {
  const campaign = fixture("instantly", "getCampaign.json") as object;

  const result = await toolCall(
    campaignRead({ ...campaign, daily_limit: -1 }),
    "campaign_setup",
    { campaign: CAMPAIGN }
  );

  assert.deepEqual(result.meta.notes, [
    "The campaign's daily limit is negative in Instantly (-1); left out.",
  ]);
});

test("instantly: sender_health carries the note for a negative mailbox limit", async () => {
  const listed = fixture("instantly", "listAccounts.json") as {
    items: Record<string, unknown>[];
  };

  const [first, ...rest] = listed.items;
  assert.ok(first !== undefined);

  const result = await toolCall(
    (request) =>
      new URL(request.url).pathname === "/api/v2/accounts"
        ? json({ items: [{ ...first, daily_limit: -5 }, ...rest] })
        : undefined,
    "sender_health",
    { limit: 10 }
  );

  assert.ok(
    result.meta.notes.includes(
      `The daily limit of ${String(first.email)} is negative in Instantly (-5); left out.`
    ),
    result.meta.notes.join("\n")
  );
});
