import assert from "node:assert/strict";
import { test } from "node:test";

import { budget } from "../src/budget/index.ts";
import { combine } from "../src/combine/index.ts";
import { identity } from "../src/identity/index.ts";
import { createOutbound, OutboundError } from "../src/index.ts";
import type { Adapter, AdapterContext } from "../src/index.ts";
import { insights } from "../src/insights/index.ts";
import { memory } from "../src/memory/index.ts";
import type { MemoryData } from "../src/memory/index.ts";
import { createFetch, json } from "./helpers/http.ts";
import type { Handler } from "./helpers/http.ts";

const PERSON = "person1@example.com";

const toolData = (campaigns: number): MemoryData => ({
  campaigns: Array.from({ length: campaigns }, (_, index) => ({
    id: `c${index + 1}`,
    status: "active",
  })),
  leads: Array.from({ length: campaigns }, (_, index) => ({
    campaignId: `c${index + 1}`,
    email: PERSON,
    id: `l${index + 1}`,
  })),
  stats: Array.from({ length: campaigns }, (_, index) => ({
    campaignId: `c${index + 1}`,
    counts: { replied: index, sent: 100 },
    date: "2026-11-01",
  })),
});

/**
 * A memory tool whose lead listings and campaign stats each cost one HTTP
 * request through the engine first, so a fake fetch can see which reads are
 * in flight together. The request path names the tool and the read.
 */
const slowTool = (
  name: string,
  data: MemoryData,
  pageSize?: number
): Adapter => {
  const inner = memory({ data, name, pageSize, workspaceId: name });

  const touch = async (ctx: AdapterContext, what: string): Promise<void> => {
    await ctx.request({ method: "GET", url: `https://${name}.test/${what}` });
  };

  return {
    ...inner,
    listLeads: async (query, ctx) => {
      await touch(ctx, "leads");

      return await (inner.listLeads?.(query, ctx) ?? { items: [] });
    },
    stats: async (query, ctx) => {
      await touch(ctx, `stats/${query.scopeId ?? "workspace"}`);

      return (await inner.stats?.(query, ctx)) ?? [];
    },
  };
};

/** Answers every request after `delayMs`, and records how many were in flight at once. */
const tracked = (answer: Handler = () => json({}), delayMs = 10) => {
  let inFlight = 0;
  let most = 0;
  const hosts = new Set<string>();
  let mostHosts = 0;

  const http = createFetch(async (request, index) => {
    const { host } = new URL(request.url);
    inFlight += 1;
    hosts.add(host);
    most = Math.max(most, inFlight);
    mostHosts = Math.max(mostHosts, hosts.size);

    await new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });

    inFlight -= 1;
    hosts.delete(host);

    return await answer(request, index);
  });

  return {
    http,
    most: () => most,
    mostHosts: () => mostHosts,
  };
};

test("a person lookup on a combined instance asks every tool at the same time", async () => {
  const fake = tracked();

  const outbound = createOutbound({
    adapter: combine([
      slowTool("alpha", toolData(1)),
      slowTool("beta", toolData(1)),
      slowTool("gamma", toolData(1)),
    ]),
    fetch: fake.http.fetch,
  });

  const leads = await outbound.leads.listAll({ email: PERSON }).toArray();

  assert.deepEqual(leads.map((lead) => lead.ref).toSorted(), [
    "alpha:alpha:l1",
    "beta:beta:l1",
    "gamma:gamma:l1",
  ]);
  assert.equal(fake.mostHosts(), 3, "all three tools were asked at once");
});

test("a combined lookup that spans pages resumes only the tools with more to give", async () => {
  const fake = tracked();

  const outbound = createOutbound({
    adapter: combine([
      // Three records on pages of one: three pages.
      slowTool("alpha", toolData(3), 1),
      // One record: done after the first page.
      slowTool("beta", toolData(1), 1),
    ]),
    fetch: fake.http.fetch,
  });

  const leads = await outbound.leads.listAll({ email: PERSON }).toArray();

  assert.deepEqual(leads.map((lead) => lead.ref).toSorted(), [
    "alpha:alpha:l1",
    "alpha:alpha:l2",
    "alpha:alpha:l3",
    "beta:beta:l1",
  ]);

  const betaReads = fake.http.requests.filter((request) =>
    request.url.startsWith("https://beta.test/")
  );

  assert.equal(betaReads.length, 1, "a finished tool is not asked again");
  assert.equal(fake.http.requests.length, 4, "three alpha pages, one beta");
});

test("a listing that is not a person lookup still reads one tool after another", async () => {
  const fake = tracked();

  const outbound = createOutbound({
    adapter: combine([
      slowTool("alpha", toolData(2)),
      slowTool("beta", toolData(2)),
    ]),
    fetch: fake.http.fetch,
  });

  const leads = await outbound.leads.listAll().toArray();

  assert.deepEqual(
    leads.map((lead) => lead.ref),
    ["alpha:alpha:l1", "alpha:alpha:l2", "beta:beta:l1", "beta:beta:l2"],
    "the first tool's records come first, in order"
  );
  assert.equal(fake.mostHosts(), 1);
});

test("person_summary reads all three tools at once and reports every campaign record", async () => {
  const fake = tracked();

  const outbound = createOutbound({
    adapter: combine([
      slowTool("alpha", toolData(2)),
      slowTool("beta", toolData(1)),
      slowTool("gamma", toolData(1)),
    ]),
    fetch: fake.http.fetch,
    plugins: [insights()],
  });

  const result = await outbound.insights.personSummary({ person: PERSON });

  assert.equal(result.data.found, true);
  assert.deepEqual(
    result.data.campaigns.map((entry) => entry.campaign),
    ["alpha:alpha:c1", "alpha:alpha:c2", "beta:beta:c1", "gamma:gamma:c1"],
    "records keep the tools' order"
  );
  assert.equal(fake.mostHosts(), 3);
});

test("identity's person() asks every tool at once", async () => {
  const fake = tracked();

  const outbound = createOutbound({
    adapter: combine([
      slowTool("alpha", toolData(1)),
      slowTool("beta", toolData(1)),
    ]),
    fetch: fake.http.fetch,
    plugins: [identity()],
  });

  const person = await outbound.person(PERSON, { timeline: false });

  assert.equal(person.records.length, 2);
  assert.equal(fake.mostHosts(), 2);
});

test("an insight reads campaigns side by side, within the engine's cap", async () => {
  const fake = tracked();

  const outbound = createOutbound({
    adapter: slowTool("alpha", toolData(8)),
    fetch: fake.http.fetch,
    plugins: [insights()],
  });

  const result = await outbound.insights.periodComparison({ days: 30 });

  const statsReads = fake.http.requests.filter((request) =>
    request.url.includes("/stats/c")
  ).length;

  assert.equal(statsReads, 16, "two periods for each of eight campaigns");
  assert.ok(fake.most() > 2, "several campaigns were read at once");
  assert.ok(
    fake.most() <= 8,
    "never more than the engine's 8 requests per credential"
  );
  assert.ok(result.meta.requests >= statsReads);
});

test("after one read fails no new read starts, and the failure is what the caller sees", async () => {
  const fake = tracked((request) =>
    request.url.endsWith("/stats/c1")
      ? json({ message: "broken" }, 400)
      : json({})
  );

  const outbound = createOutbound({
    adapter: slowTool("alpha", toolData(10)),
    fetch: fake.http.fetch,
    plugins: [insights()],
  });

  await assert.rejects(
    outbound.insights.periodComparison({ days: 30 }),
    (error) => error instanceof OutboundError
  );

  const started = fake.http.requests.filter((request) =>
    request.url.includes("/stats/c")
  ).length;

  assert.ok(started < 20, `stopped early: ${started} of 20 reads started`);
});

test("a per-run request budget holds while reads run side by side", async () => {
  const fake = tracked();

  const outbound = createOutbound({
    adapter: slowTool("alpha", toolData(8)),
    fetch: fake.http.fetch,
    plugins: [insights(), budget({ maxRequests: 5, per: "run" })],
  });

  // period_comparison keeps what it read when a cap stops it part way.
  const result = await outbound.insights.periodComparison({ days: 30 });

  assert.equal(result.meta.complete, false);
  assert.ok(
    result.data.campaigns.length + result.data.tooFewSends.length <
      result.data.campaignsRead,
    "campaigns past the cap are left out"
  );
  assert.match(result.meta.notes.join(" "), /Read \d of 8 campaigns/u);

  assert.equal(fake.http.requests.length, 5, "not one request past the cap");
  assert.equal(outbound.requestBudget.used(), 5);
});
