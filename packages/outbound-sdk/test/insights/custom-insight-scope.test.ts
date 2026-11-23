// A custom insight takes the campaign scope like the built-in ones, in its
// types as well as at run time (OUT-204). The type check runs over this
// file: each `@ts-expect-error` fails it if the line it marks compiles.

import assert from "node:assert/strict";
import { test } from "node:test";

import { z } from "zod";

import { createOutbound, OutboundError } from "../../src/index.ts";
import { defineInsight, runInsight } from "../../src/insights/index.ts";
import type { CampaignScopeInput } from "../../src/insights/index.ts";
import { demoData, memory } from "../../src/memory/index.ts";
import { NOW } from "./helpers.ts";

const outbound = createOutbound({
  adapter: memory({ data: demoData({ now: NOW }) }),
});

const campaignNames = defineInsight({
  description: "The names of the campaigns in scope.",
  inputSchema: z.object({}),
  key: "campaignNames",
  name: "campaign_names",
  needs: [],
  next: "Nothing.",
  run: async (context) => {
    const campaigns = await context.all(context.outbound.campaigns.listAll());

    return campaigns.map((campaign) => campaign.name);
  },
});

test("a custom insight with an empty schema takes the scope keys in its type", async () => {
  const scope: CampaignScopeInput = { tag: "client-a" };
  const tagged = await runInsight(outbound, campaignNames, scope, { now: NOW });

  assert.deepEqual(tagged.data, ["Q4 SaaS founders"]);

  const named = await runInsight(
    outbound,
    campaignNames,
    {
      campaign_ids: ["memory:default:cmp_founders", "cmp_agencies"],
      campaign_name: "Agency*",
    },
    { now: NOW }
  );

  assert.deepEqual(named.data, ["Agency owners"]);
});

test("a scope key of the wrong type is refused by the compiler and at run time", async () => {
  await assert.rejects(
    // @ts-expect-error -- `tag` is a string
    runInsight(outbound, campaignNames, { tag: 5 }, { now: NOW }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Invalid" &&
      /campaign_names: tag /u.test(error.message)
  );

  await assert.rejects(
    // @ts-expect-error -- `client` is neither an input nor a scope key
    runInsight(outbound, campaignNames, { client: "acme" }, { now: NOW }),
    (error) => OutboundError.is(error) && error.code === "Invalid"
  );
});
