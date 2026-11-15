// Every outbound-sdk tool and insight, as eve tools: campaign_overview,
// sender_health, deliverability_check, client_report, hot_leads and the rest.
// The set is computed per conversation, because a client's shared channel
// gets tools scoped to that client's workspace, so it cannot read another
// client's numbers whatever someone in the channel asks.
//
// A tool the adapter cannot serve is left out by the SDK, so the model is
// never offered one that could not work. No tool writes to a vendor.

import { defineDynamic, defineTool } from "eve/tools";
import type { JsonObject } from "outbound-sdk";
import { z } from "zod";

import { getOutbound } from "../lib/outbound";
import { clientInScope } from "../lib/scope";

export default defineDynamic(async (ctx) => {
  const [outbound, { createTools }, { insightTools }] = await Promise.all([
    getOutbound(),
    import("outbound-sdk/tools"),
    import("outbound-sdk/insights"),
  ]);

  const client = clientInScope(ctx.channel);

  const scoped =
    client === undefined ? outbound : outbound.workspace(client.id);

  const tools = createTools(scoped, { extra: insightTools(scoped) });

  return Object.fromEntries(
    tools.map((tool) => [
      tool.name,
      defineTool({
        description: tool.description,
        // The SDK hands over each input's fields as Zod schemas. Loose, so a
        // key the tool does not take reaches `call`, which refuses it and
        // lists the inputs it does take, instead of it being dropped.
        inputSchema: z.looseObject(tool.fields),
        // `call` validates again and never throws: a failure comes back as
        // { ok: false, error, next } for the model to read and act on.
        // SAFETY: the input is the model's tool-call arguments, which are JSON.
        execute: (input) => tool.call(input as JsonObject),
      }),
    ])
  );
});
