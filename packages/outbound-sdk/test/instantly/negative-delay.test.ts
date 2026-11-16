// OUT-110: Instantly sent a step delay of -11 days on a live campaign. The
// step's wait becomes unknown with a note, and the rest of the sequence reads.

import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import { json } from "../helpers/http.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { CAMPAIGN, suite } from "./suite.ts";

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
