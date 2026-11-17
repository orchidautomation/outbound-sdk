import assert from "node:assert/strict";
import { test } from "node:test";

import { clients } from "../src/clients/index.ts";
import { identity } from "../src/identity/index.ts";
import { createOutbound } from "../src/index.ts";
import { insightTools } from "../src/insights/index.ts";
import { demoData, memory } from "../src/memory/index.ts";
import { createTools, TOOL_NAMES } from "../src/tools/index.ts";
import type { ToolResult, ToolSuccess } from "../src/tools/index.ts";

const demo = demoData({ now: "2026-10-08T12:00:00.000Z" });
const [founders] = demo.campaigns ?? [];

if (founders === undefined) {
  throw new Error("The demo has a campaign");
}

// The demo plus two more active campaigns, so a limit of 1 cuts the list.
const outbound = createOutbound({
  adapter: memory({
    data: {
      ...demo,
      campaigns: [
        ...(demo.campaigns ?? []),
        { ...founders, id: "cmp_extra_1", name: "Extra one" },
        { ...founders, id: "cmp_extra_2", name: "Extra two" },
      ],
    },
    workspaceId: "acme",
  }),
  plugins: [clients(), identity()],
});

const tools = createTools(outbound, { extra: insightTools(outbound) });

const call = async (name: string, input: unknown): Promise<ToolSuccess> => {
  const tool = tools.find((each) => each.name === name);
  assert.ok(tool, `${name} is offered`);
  const result: ToolResult = await tool.call(input);
  assert.equal(result.ok, true, JSON.stringify(result));

  return result as ToolSuccess;
};

const INPUTS: Record<(typeof TOOL_NAMES)[number], unknown> = {
  audience_lists: {},
  campaign_overview: {},
  campaign_setup: { campaign: "cmp_founders" },
  campaign_trend: { campaign: "cmp_founders" },
  compare_clients: {},
  cross_channel_lead: { person: "person1@example.com" },
  deliverability_check: {},
  lead_runway: { campaign: "cmp_founders" },
  reply_samples: {},
  sender_health: {},
  vendor_read: {},
  winning_steps: { campaign: "cmp_founders" },
};

test("every built-in tool says in meta.complete and meta.notes how much its answer covers", async () => {
  const offered = TOOL_NAMES.filter((name) =>
    tools.some((tool) => tool.name === name)
  );

  // The demo, the clients plugin and identity serve every built-in tool but
  // vendor_read, which needs a vendor's own reads; tools.test.ts covers it.
  assert.deepEqual(
    offered,
    TOOL_NAMES.filter((name) => name !== "vendor_read")
  );

  for (const name of offered) {
    // oxlint-disable-next-line no-await-in-loop -- one tool call at a time keeps failures readable.
    const result = await call(name, INPUTS[name]);

    assert.equal(typeof result.meta.complete, "boolean", name);
    assert.ok(Array.isArray(result.meta.notes), name);

    // Coverage is reported in meta only.
    for (const old of ["truncated", "all_checked", "counting_stopped_at_max"]) {
      assert.ok(
        !Object.hasOwn(result.data as object, old),
        `${name} has no data.${old}`
      );
    }
  }
});

test("campaign_overview reports a cut list in meta.complete and meta.notes", async () => {
  const cut = await call("campaign_overview", { limit: 1 });

  assert.equal(cut.meta.complete, false);
  assert.deepEqual(cut.meta.notes, [
    "Stopped at 1 campaign (limit); more active campaigns exist.",
  ]);

  const whole = await call("campaign_overview", { limit: 10 });
  assert.equal(whole.meta.complete, true);
  // Two campaigns have no stats: their metrics are null, never zero.
  assert.deepEqual(whole.meta.notes, [
    "The vendor reported no stats for 2 campaigns in this range, so metrics is null there: unknown, not zero.",
  ]);
});

const campaignNames = (result: ToolSuccess) =>
  (result.data as { campaigns: { name: string }[] }).campaigns.map(
    (campaign) => campaign.name
  );

test("campaign_overview takes one campaign, by id or by name, as every sibling tool does", async () => {
  const byId = await call("campaign_overview", { campaign: "cmp_extra_1" });
  assert.deepEqual(campaignNames(byId), ["Extra one"]);
  assert.equal(byId.meta.complete, true);

  const byName = await call("campaign_overview", {
    campaign: "extra two",
    limit: 1,
  });

  assert.deepEqual(campaignNames(byName), ["Extra two"]);
  assert.equal(byName.meta.complete, true);
});

test("sender_health says when limit cut the list though every sender was checked", async () => {
  const cut = await call("sender_health", { limit: 1 });

  assert.equal(cut.meta.complete, false);
  assert.deepEqual(cut.meta.notes, [
    "Listed 1 sender (limit); more were checked.",
  ]);

  const whole = await call("sender_health", { limit: 50 });
  assert.equal(whole.meta.complete, true);
  assert.deepEqual(whole.meta.notes, []);
});

test("deliverability_check says in meta, not in next, when not every sender was checked in full", async () => {
  const cut = await call("deliverability_check", { max_checked: 1 });

  assert.equal(cut.meta.complete, false);
  assert.match(
    cut.meta.notes[0] ?? "",
    /^Checked 1 of 2 senders in full \(1 not checked: cap\)/u
  );
  assert.match(cut.next, /^Use sender_health/u);

  const whole = await call("deliverability_check", { limit: 25 });
  assert.equal(whole.meta.complete, true);
  assert.deepEqual(whole.meta.notes, []);
});

test("lead_runway and audience_lists say when their cap stopped the count", async () => {
  const runway = await call("lead_runway", {
    campaign: "cmp_founders",
    max_leads: 1,
  });

  assert.equal(runway.meta.complete, false);
  assert.match(
    runway.meta.notes[0] ?? "",
    /^Counting stopped at 1 lead \(max_leads\)/u
  );

  // audience_lists says it the same way: a note whenever it is not complete.
  const lists = await call("audience_lists", { limit: 1 });
  assert.equal(lists.meta.complete, lists.meta.notes.length === 0);
});

test("an insight served as a tool returns its answer as data, with coverage in meta", async () => {
  const answer = await call("step_funnel", { campaign: "cmp_founders" });
  const data = answer.data as Record<string, unknown>;

  assert.ok(!("result" in data), "the answer is not wrapped");
  assert.ok(!("complete" in data), "coverage is in meta only");
  assert.ok("steps" in data, "the answer's own camelCase fields");
  assert.equal(typeof answer.meta.complete, "boolean");
  assert.ok(Array.isArray(answer.meta.notes));
});

const described = (name: string): string =>
  tools.find((tool) => tool.name === name)?.description ?? "";

test("tool descriptions point to meta.complete", () => {
  for (const name of [
    "campaign_overview",
    "sender_health",
    "reply_samples",
    "deliverability_check",
    "lead_runway",
    "audience_lists",
  ]) {
    assert.match(described(name), /meta\.complete/u, name);
    assert.doesNotMatch(described(name), /truncated: true|all_checked/u, name);
  }

  assert.match(described("step_funnel"), /answer is in data, in camelCase/u);
});
