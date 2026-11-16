// A negative step wait from EmailBison leaves that step's wait unknown with a
// note instead of failing the sequence read (OUT-110).

import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import { json } from "../helpers/http.ts";
import { CAMPAIGN, suite } from "./suite.ts";

interface StepsBody {
  readonly data: { readonly sequence_steps: Record<string, unknown>[] };
}

test("emailbison: a negative step wait is unknown with a note, and the sequence still reads", async () => {
  const body = fixture("emailbison", "getSequenceSteps.json") as StepsBody;
  const [head, ...rest] = body.data.sequence_steps;

  assert.ok(head !== undefined);

  const { outbound, settle } = harness(suite, (request) =>
    new URL(request.url).pathname ===
    `/api/campaigns/v1.1/${CAMPAIGN}/sequence-steps`
      ? json({
          ...body,
          data: {
            ...body.data,
            sequence_steps: [{ ...head, wait_in_days: "-2" }, ...rest],
          },
        })
      : undefined
  );

  const sequence = await settle(outbound.campaign(CAMPAIGN).sequence());

  assert.equal(sequence.steps[0]?.delayDays, null);
  assert.ok(sequence.steps.length > 1, "the other steps are read");
  assert.deepEqual(sequence.meta.notes, [
    "Step 1's wait is negative in EmailBison (-2 days); left out.",
  ]);
});
