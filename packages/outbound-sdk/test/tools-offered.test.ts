// Which tools an instance is offered, and what a tool's `next` hint may name.

import assert from "node:assert/strict";
import { test } from "node:test";

import { heyreach } from "../src/heyreach/index.ts";
import { identity } from "../src/identity/index.ts";
import { createOutbound } from "../src/index.ts";
import type { CapabilityDeclaration, OutboundPlugin } from "../src/index.ts";
import { demoData, memory } from "../src/memory/index.ts";
import { redact } from "../src/redact/index.ts";
import { createTools, UNTRUSTED_NOTE } from "../src/tools/index.ts";
import type { OutboundTool, ToolResult } from "../src/tools/index.ts";

const instance = (
  capabilities: CapabilityDeclaration = {},
  plugins: readonly OutboundPlugin[] = []
) =>
  createOutbound({
    adapter: memory({ capabilities, data: demoData(), workspaceId: "acme" }),
    plugins,
  });

const names = (tools: readonly OutboundTool[]): string[] =>
  tools.map((tool) => tool.name);

const run = async (
  tools: readonly OutboundTool[],
  name: string,
  input: Record<string, boolean | string> = {}
): Promise<ToolResult> => {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `${name} is offered`);

  return await tool.call(input);
};

test("a tool whose reads the adapter lacks is not offered", () => {
  // HeyReach has no per-step stats and cannot read a campaign's settings.
  const onHeyreach = names(
    createTools(
      createOutbound({
        adapter: heyreach({ apiKey: "hr_test_key", workspaceId: "client-a" }),
      })
    )
  );

  assert.ok(!onHeyreach.includes("winning_steps"));
  assert.ok(!onHeyreach.includes("campaign_setup"));
  assert.ok(onHeyreach.includes("campaign_overview"));
  assert.ok(onHeyreach.includes("deliverability_check"));

  for (const [capability, tool] of [
    ["stats.byStep", "winning_steps"],
    ["stats.byDay", "campaign_trend"],
    ["stats.campaign", "campaign_overview"],
    ["campaigns.status", "campaign_overview"],
    ["senders.list", "sender_health"],
    ["replies.list", "reply_samples"],
    ["leads.byCampaign", "lead_runway"],
    ["campaigns.settings", "campaign_setup"],
    ["senders.health", "deliverability_check"],
    ["lists.list", "audience_lists"],
  ] as const) {
    const offered = names(createTools(instance({ [capability]: false })));
    assert.ok(!offered.includes(tool), `${tool} needs ${capability}`);
    assert.ok(offered.length >= 6, "the other tools are still offered");
  }
});

test("a capability a plugin turned off hides the tool too, and so does a redact that stops person()", () => {
  const narrow: OutboundPlugin = {
    capabilities: (capabilities) => ({ ...capabilities, "lists.list": false }),
    name: "narrow",
  };

  assert.ok(
    !names(createTools(instance({}, [narrow]))).includes("audience_lists")
  );
  assert.ok(
    names(createTools(instance({}, [identity()]))).includes(
      "cross_channel_lead"
    )
  );
  assert.ok(
    !names(createTools(instance({}, [redact(), identity()]))).includes(
      "cross_channel_lead"
    ),
    "person() refuses there, so the tool could never answer"
  );
  assert.ok(
    names(
      createTools(instance({}, [redact({ fields: ["name"] }), identity()]))
    ).includes("cross_channel_lead")
  );
});

test("cross_channel_lead returns message text when include_bodies is set", async () => {
  const tools = createTools(instance({}, [identity()]));

  const result = await run(tools, "cross_channel_lead", {
    include_bodies: true,
    person: "person1@example.com",
  });

  assert.ok(result.ok, JSON.stringify(result));

  const { timeline } = result.data as {
    timeline: { body: { note: string; untrusted_content: string } | null }[];
  };

  assert.ok(timeline.length > 0);

  for (const message of timeline) {
    assert.equal(message.body?.note, UNTRUSTED_NOTE);
    assert.ok((message.body?.untrusted_content.length ?? 0) > 0);
  }

  const without = await run(tools, "cross_channel_lead", {
    person: "person1@example.com",
  });

  assert.ok(without.ok);
  assert.deepEqual(
    (without.data as { timeline: { body: unknown }[] }).timeline.map(
      (message) => message.body
    ),
    timeline.map(() => null)
  );
});

test("a next hint never names a tool that is not offered", async () => {
  const withIdentity = createTools(instance({}, [identity()]));
  const hinted = await run(withIdentity, "reply_samples");
  assert.match(hinted.next, /cross_channel_lead/u);

  const plain = createTools(instance());
  assert.ok(!names(plain).includes("cross_channel_lead"));
  const replies = await run(plain, "reply_samples");
  assert.ok(replies.ok);
  assert.doesNotMatch(replies.next, /cross_channel_lead/u);
  assert.match(replies.next, /listed tools/u);

  // The same holds for a tool left out by `only` or by a missing capability.
  const noSteps = createTools(instance({ "stats.byStep": false }));

  const trend = await run(noSteps, "campaign_trend", {
    campaign: "cmp_founders",
    from: "2026-10-01",
    to: "2026-10-07",
  });

  assert.ok(trend.ok, JSON.stringify(trend));
  assert.doesNotMatch(trend.next, /winning_steps/u);

  const only = createTools(instance(), { only: ["audience_lists"] });
  assert.doesNotMatch((await run(only, "audience_lists")).next, /lead_runway/u);
});
