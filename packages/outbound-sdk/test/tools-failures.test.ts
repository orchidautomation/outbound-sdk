import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound } from "../src/index.ts";
import { insightTools } from "../src/insights/index.ts";
import { demoData, memory } from "../src/memory/index.ts";
import { createTools } from "../src/tools/index.ts";

const NOW = "2026-10-08T12:00:00.000Z";

// The record the stress test met live: Instantly reported a step whose delay
// mapped below zero, which the Sequence schema refuses.
const withBadStep = () => {
  const base = memory({ data: demoData({ now: NOW }) });
  const read = base.getSequence;

  if (read === undefined) {
    throw new Error("The memory adapter reads sequences");
  }

  return createOutbound({
    adapter: {
      ...base,
      getSequence: async (id, ctx) => {
        const sequence = await read(id, ctx);

        return {
          ...sequence,
          steps: sequence.steps.map((step, index) =>
            index === sequence.steps.length - 1
              ? { ...step, delayDays: -2 }
              : step
          ),
        };
      },
    },
  });
};

test("a vendor record the SDK cannot read is not retryable, and next does not blame the input", async () => {
  const outbound = withBadStep();

  const tool = createTools(outbound, { extra: insightTools(outbound) }).find(
    (candidate) => candidate.name === "campaign_diagnosis"
  );

  assert.ok(tool);

  const result = await tool.call({ campaign: "cmp_founders" });

  assert.ok(!result.ok);
  assert.equal(result.error.code, "Provider");
  assert.match(
    result.error.message,
    /invalid record for sequence\.get at steps\.\d+\.delayDays/u
  );
  assert.equal(result.error.retryable, false);
  assert.doesNotMatch(result.next, /Check the input/u);
  assert.match(result.next, /Do not call again with the same input/u);
  assert.match(result.next, /report the field the message names/u);
});

test("a vendor failure that can pass on a retry is still retryable", async () => {
  const base = memory({ data: demoData({ now: NOW }) });

  const outbound = createOutbound({
    adapter: {
      ...base,
      listSenders: () => Promise.reject(new TypeError("socket hang up")),
    },
  });

  const tool = createTools(outbound).find(
    (candidate) => candidate.name === "sender_health"
  );

  assert.ok(tool);

  const result = await tool.call({});

  assert.ok(!result.ok);
  assert.equal(result.error.code, "Provider");
  assert.equal(result.error.retryable, true);
});
