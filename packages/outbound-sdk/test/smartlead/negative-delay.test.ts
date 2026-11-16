// A negative step delay from Smartlead leaves that step's wait unknown with a
// note instead of failing the sequence read (OUT-110).

import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import { json } from "../helpers/http.ts";
import { CAMPAIGN, suite } from "./suite.ts";

test("smartlead: a negative step delay is unknown with a note, and the sequence still reads", async () => {
  const [first, second, ...rest] = fixture(
    "smartlead",
    "getCampaignSequences.json"
  ) as Record<string, unknown>[];

  assert.ok(first !== undefined && second !== undefined);

  const steps = [
    first,
    { ...second, seq_delay_details: { delay_in_days: -3 } },
    ...rest,
  ];

  const { outbound, settle } = harness(suite, (request) =>
    new URL(request.url).pathname === `/api/v1/campaigns/${CAMPAIGN}/sequences`
      ? json(steps)
      : undefined
  );

  const sequence = await settle(outbound.campaign(CAMPAIGN).sequence());
  const odd = sequence.steps.find((step) => step.index === 1);

  assert.equal(sequence.steps.length, steps.length);
  assert.equal(odd?.delayDays, null);
  assert.deepEqual(sequence.meta.notes, [
    "Step 2's delay is negative in Smartlead (-3 days); left out.",
  ]);
});
