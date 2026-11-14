import { createOutbound } from "outbound-sdk";
import {
  compareRates,
  defineInsight,
  rate,
  runInsight,
  wilson,
} from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";
import { z } from "zod";

import { seed } from "../insights-operations/seed.ts";

// Is one campaign's reply rate above another's by more than chance?
const headToHead = defineInsight({
  description:
    "Compares the reply rate of two campaigns with a two-proportion test. Costs 2 requests.",
  inputSchema: z.object({
    first: z.string().describe("A campaign ref"),
    second: z.string().describe("The campaign ref to compare it with"),
  }),
  key: "headToHead",
  name: "head_to_head",
  // Checked before any request. Without it the call is `Unsupported`.
  needs: ["stats.campaign"],
  next: "Use campaign_diagnosis on the campaign that is behind.",
  run: async (context, { first, second }) => {
    const read = async (campaign: string) => {
      // `context.rows` records what the read cost and how exact it was.
      const [row] = context.rows(
        await context.outbound.campaign(campaign).stats()
      );

      const replied = row?.replied ?? null;
      const contacted = row?.contacted ?? null;

      if (rate(replied, contacted) === null) {
        // A note travels with the answer in `meta.notes`.
        context.note(`${campaign} reports no reply or lead count.`);
      }

      return {
        campaign,
        interval: wilson(replied, contacted),
        rate: rate(replied, contacted),
        sample: { successes: replied, trials: contacted },
      };
    };

    const left = await read(first);
    const right = await read(second);

    return {
      sides: [left, right],
      test: compareRates(left.sample, right.sample),
    };
  },
});

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
});

const { data, meta } = await runInsight(outbound, headToHead, {
  first: "memory:acme:agencies",
  second: "memory:acme:founders",
});

for (const side of data.sides) {
  console.log(side.campaign, side.rate, side.interval);
}

console.log("test:", data.test);

console.log("evidence:", meta.evidence, "complete:", meta.complete);
