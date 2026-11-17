// Under redact person_summary stays on offer and answers a lead ref masked,
// refusing a bare address before any request (OUT-152); a finding's next and
// an Unsupported next only name what is on offer and say what to change
// (OUT-152, OUT-151).

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, MemoryRateLimitStore } from "../src/index.ts";
import type { CapabilityDeclaration } from "../src/index.ts";
import { insights, insightTools } from "../src/insights/index.ts";
import { memory } from "../src/memory/index.ts";
import { redact } from "../src/redact/index.ts";
import { fixtureHandler } from "./helpers/adapter-suite.ts";
import { createClock } from "./helpers/clock.ts";
import { createFetch } from "./helpers/http.ts";
import { suite as instantly } from "./instantly/suite.ts";

const masked = () => {
  const clock = createClock();
  const http = createFetch(fixtureHandler([instantly]));

  const outbound = createOutbound({
    adapter: instantly.make(),
    fetch: http.fetch,
    plugins: [redact(), insights()],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
  });

  return { clock, http, outbound };
};

test("under redact person_summary is offered, answers a lead ref another read returned, masked, and refuses an address before any request", async () => {
  const { clock, http, outbound } = masked();

  assert.ok(
    insightTools(outbound).some((tool) => tool.name === "person_summary")
  );

  await assert.rejects(
    outbound.insights.personSummary({ person: "person1@example.com" }),
    {
      code: "Unsupported",
      message:
        /records come back masked .*give the lead ref another tool returned instead$/u,
    }
  );
  assert.equal(http.requests.length, 0);

  const [lead] = (await clock.settle(outbound.leads.list())).items;

  assert.match(lead?.email ?? "", /^redacted:[\da-f]{16}$/u);

  const result = await clock.settle(
    outbound.insights.personSummary({ person: lead?.ref ?? "" })
  );

  assert.equal(result.data.found, true);
  assert.deepEqual(result.data.identifiers, [`email:${lead?.email ?? ""}`]);
  assert.ok(result.data.totals.campaigns > 0);
  assert.doesNotMatch(JSON.stringify(result), /@example\.com/u);
});

test("under redact person_summary still refuses a lead ref with nothing left to look it up by", async () => {
  // Only LinkedIn is masked, and the lead has no address and no profile.
  const outbound = createOutbound({
    adapter: memory({
      data: {
        campaigns: [{ id: "c1" }],
        leads: [{ campaignId: "c1", id: "l1" }],
      },
    }),
    plugins: [redact({ fields: ["linkedin"] }), insights()],
  });

  await assert.rejects(
    outbound.insights.personSummary({ person: "memory:default:l1" }),
    {
      code: "Unsupported",
      message:
        /masks LinkedIn profiles: the lead has no email address to look it up by$/u,
    }
  );
});

const tool = (outbound: Parameters<typeof insightTools>[0], name: string) => {
  const found = insightTools(outbound).find((each) => each.name === name);

  assert.ok(found, name);

  return found;
};

test("a finding's next names no insight the instance leaves out", async () => {
  // A one-step campaign with a low reply rate: both findings name step_funnel.
  const data = {
    campaigns: [
      {
        id: "c1",
        status: "active" as const,
        steps: [{ delayDays: 0, variants: [{ body: "Hi", subject: "Hello" }] }],
      },
    ],
    stats: [
      {
        campaignId: "c1",
        counts: { replied: 1, sent: 900 },
        date: "2026-11-10",
      },
    ],
  };

  const diagnose = async (capabilities: CapabilityDeclaration) => {
    const outbound = createOutbound({
      adapter: memory({ capabilities, data }),
      plugins: [insights()],
    });

    const result = await tool(outbound, "campaign_diagnosis").call({
      campaign: "memory:default:c1",
    });

    assert.ok(result.ok, JSON.stringify(result));

    return JSON.stringify(result.data);
  };

  assert.match(await diagnose({}), /step_funnel/u);

  const without = await diagnose({ "stats.byStep": false });

  assert.doesNotMatch(without, /step_funnel/u);
  // The sentence that names copy_audit, which is still on offer, stays.
  assert.match(without, /Use copy_audit to check the copy\./u);
  assert.match(without, /Add follow-up steps\./u);
});

test("an Unsupported next gives the error's own remedy, not another tool", async () => {
  const outbound = createOutbound({
    adapter: memory({ data: {} }),
    plugins: [redact(), insights()],
  });

  const result = await tool(outbound, "thread_context").call({
    bodies: "snippet",
    threads: ["t1"],
  });

  assert.equal(result.ok, false);
  assert.equal(result.next, "Call thread_context again and pass bodies: none.");
});
