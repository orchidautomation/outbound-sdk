// OUT-29: a person lookup on a combined instance returns what the tools that
// answered hold when another tool fails, and says which one failed.

import assert from "node:assert/strict";
import { test } from "node:test";

import { budget } from "../src/budget/index.ts";
import { cache, memoryCacheStore } from "../src/cache/index.ts";
import { combine } from "../src/combine/index.ts";
import { failover } from "../src/failover/index.ts";
import { identity } from "../src/identity/index.ts";
import { createOutbound, OutboundError } from "../src/index.ts";
import type { Adapter, AdapterContext } from "../src/index.ts";
import { insights } from "../src/insights/index.ts";
import { memory } from "../src/memory/index.ts";
import type { MemoryData } from "../src/memory/index.ts";
import { createTools } from "../src/tools/index.ts";
import { createFetch, json } from "./helpers/http.ts";
import type { Handler, Reply } from "./helpers/http.ts";

const PERSON = "person1@example.com";

const toolData = (records: number): MemoryData => ({
  campaigns: Array.from({ length: records }, (_, index) => ({
    id: `c${index + 1}`,
    status: "active",
  })),
  leads: Array.from({ length: records }, (_, index) => ({
    campaignId: `c${index + 1}`,
    email: PERSON,
    id: `l${index + 1}`,
  })),
});

/**
 * A memory tool whose lead listing costs one HTTP request through the engine
 * first, so a fake fetch decides whether the tool answers. The request names
 * the tool by host and the page by `?page=`.
 */
const tool = (name: string, records = 1, pageSize?: number): Adapter => {
  const inner = memory({
    data: toolData(records),
    name,
    pageSize,
    workspaceId: "acme",
  });

  const touch = async (ctx: AdapterContext, page: string): Promise<void> => {
    await ctx.request({
      method: "GET",
      url: `https://${name}.test/leads?page=${page}`,
    });
  };

  return {
    ...inner,
    listLeads: async (query, ctx) => {
      await touch(ctx, query.next === undefined ? "first" : "later");

      return await (inner.listLeads?.(query, ctx) ?? { items: [] });
    },
  };
};

const hostOf = (url: string): string => new URL(url).host;

/** Every tool answers, except that `down` gets `reply`. */
const oneDown =
  (down: string, reply: () => Reply): Handler =>
  (request) =>
    hostOf(request.url) === `${down}.test` ? reply() : json({});

/** Three tools behind one instance, answered by `handler`. */
const setup = (handler: Handler) => {
  const http = createFetch(handler);

  return {
    http,
    options: {
      adapter: combine([
        tool("instantly"),
        tool("heyreach"),
        tool("smartlead"),
      ]),
      fetch: http.fetch,
      // No waiting between attempts: these tests are about the answer.
      retries: { backoff: () => 0, max: 1 },
    },
  };
};

const three = (handler: Handler) => {
  const { http, options } = setup(handler);

  return { http, outbound: createOutbound(options) };
};

const heyreachRejectsKey = oneDown("heyreach", () =>
  json({ message: "bad key" }, 401)
);

const refs = (items: readonly { readonly ref: string }[]): string[] =>
  items.map((item) => item.ref);

const OTHER_TWO = ["instantly:acme:l1", "smartlead:acme:l1"];

test("one tool answering 401 leaves the other two tools' records, and names the tool and its code", async () => {
  const { outbound } = three(heyreachRejectsKey);

  const page = await outbound.leads.list({ email: PERSON });

  assert.deepEqual(refs(page.items), OTHER_TWO);
  assert.deepEqual(page.failures, [
    {
      code: "Unauthorized",
      message: "heyreach responded 401: bad key",
      provider: "heyreach",
      status: 401,
      workspaceId: "acme",
    },
  ]);
  assert.equal(page.complete, false, "the page is marked incomplete");
  assert.equal(page.meta.complete, false);
  assert.equal(page.cursor, undefined, "the failed tool is not asked again");
});

test("one tool answering 503 on every attempt leaves the other two tools' records", async () => {
  const { http, outbound } = three(
    oneDown("heyreach", () => json({ message: "maintenance" }, 503))
  );

  const walk = outbound.leads.listAll({ email: PERSON });
  const leads = await walk.toArray();

  assert.deepEqual(refs(leads), OTHER_TWO);
  assert.deepEqual(
    walk.failures.map((failure) => [
      failure.provider,
      failure.code,
      failure.status,
    ]),
    [["heyreach", "Provider", 503]]
  );

  assert.equal(
    http.requests.filter((request) => hostOf(request.url) === "heyreach.test")
      .length,
    2,
    "the tool was retried before it was given up on"
  );
});

test("one tool that never answers within the timeout leaves the other two tools' records", async () => {
  const { outbound } = three(oneDown("heyreach", () => "hang"));

  const page = await outbound.leads.list({ email: PERSON, timeout: 20 });

  assert.deepEqual(refs(page.items), OTHER_TWO);
  assert.deepEqual(
    page.failures.map((failure) => [
      failure.provider,
      failure.code,
      failure.status,
      failure.message,
    ]),
    [["heyreach", "Provider", null, "heyreach did not answer within 20 ms"]]
  );
  assert.equal(page.complete, false);
});

test("a tool that rate limits us past the retries is reported like any tool that is down", async () => {
  const { outbound } = three(
    oneDown("smartlead", () => json({ message: "slow down" }, 429))
  );

  const page = await outbound.leads.list({ email: PERSON });

  assert.deepEqual(refs(page.items), ["instantly:acme:l1", "heyreach:acme:l1"]);
  assert.deepEqual(
    page.failures.map((failure) => [failure.provider, failure.code]),
    [["smartlead", "RateLimited"]]
  );
});

test("two tools down still returns the one that answered, and names both", async () => {
  const { outbound } = three((request) =>
    hostOf(request.url) === "smartlead.test"
      ? json({})
      : json({ message: "down" }, 503)
  );

  const page = await outbound.leads.list({ email: PERSON });

  assert.deepEqual(refs(page.items), ["smartlead:acme:l1"]);
  assert.deepEqual(
    page.failures.map((failure) => failure.provider),
    ["instantly", "heyreach"]
  );
});

test("when every tool fails the lookup fails, with the first tool's error", async () => {
  const { outbound } = three((request) =>
    hostOf(request.url) === "instantly.test"
      ? json({ message: "bad key" }, 401)
      : json({ message: "down" }, 503)
  );

  await assert.rejects(
    outbound.leads.list({ email: PERSON }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Unauthorized" &&
      error.provider === "instantly"
  );
});

test("a mistake in the call fails the whole lookup, even when the other tools answered", async () => {
  const { outbound } = three(
    oneDown("heyreach", () => json({ message: "bad filter" }, 400))
  );

  await assert.rejects(
    outbound.leads.list({ email: PERSON }),
    (error) => OutboundError.is(error) && error.code === "Invalid"
  );
});

test("the caller's request cap still stops the whole lookup", async () => {
  const { http, outbound } = three(() => json({}));

  await assert.rejects(
    outbound.leads.list({ email: PERSON, maxRequests: 2 }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "RateLimited" &&
      error.message.includes("budget of 2 request(s)")
  );
  assert.equal(http.requests.length, 2);
});

test("a per-run budget from the budget plugin still stops the whole lookup", async () => {
  const outbound = createOutbound({
    ...setup(() => json({})).options,
    plugins: [budget({ maxRequests: 2, per: "run" })],
  });

  await assert.rejects(
    outbound.leads.list({ email: PERSON }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "RateLimited" &&
      error.message.includes("The run used its budget")
  );
});

test("the caller's abort signal still stops the whole lookup", async () => {
  const { outbound } = three(oneDown("heyreach", () => "hang"));
  const controller = new AbortController();

  const reading = outbound.leads.list({
    email: PERSON,
    signal: controller.signal,
  });

  setTimeout(() => {
    controller.abort();
  }, 10);

  await assert.rejects(
    reading,
    (error) => OutboundError.is(error) && error.aborted
  );
});

test("the caller's deadline still stops the whole lookup", async () => {
  const http = createFetch(
    oneDown("heyreach", () => json({ message: "down" }, 503))
  );

  const outbound = createOutbound({
    adapter: combine([tool("instantly"), tool("heyreach"), tool("smartlead")]),
    fetch: http.fetch,
    // The wait before a second attempt is longer than the deadline allows.
    retries: { backoff: () => 60_000, max: 3 },
  });

  await assert.rejects(
    outbound.leads.list({ deadline: 1000, email: PERSON }),
    (error) => OutboundError.is(error) && error.timedOut && error.status === 503
  );
});

test("a tool that fails on a later page keeps what was already read, and is named on the walk", async () => {
  const http = createFetch((request) =>
    request.url === "https://heyreach.test/leads?page=later"
      ? json({ message: "down" }, 503)
      : json({})
  );

  const outbound = createOutbound({
    adapter: combine([tool("instantly"), tool("heyreach", 3, 1)]),
    fetch: http.fetch,
    retries: 0,
  });

  const walk = outbound.leads.listAll({ email: PERSON });
  const leads = await walk.toArray();

  assert.deepEqual(refs(leads), ["instantly:acme:l1", "heyreach:acme:l1"]);
  assert.deepEqual(
    walk.failures.map((failure) => [failure.provider, failure.status]),
    [["heyreach", 503]]
  );
});

test("a listing that is not a person lookup still fails when one tool fails", async () => {
  const { outbound } = three(heyreachRejectsKey);

  await assert.rejects(
    outbound.leads.listAll().toArray(),
    (error) => OutboundError.is(error) && error.code === "Unauthorized"
  );
});

test("a lookup on one adapter fails as before: there is no other tool to answer", async () => {
  const http = createFetch(() => json({ message: "bad key" }, 401));

  const outbound = createOutbound({
    adapter: tool("heyreach"),
    fetch: http.fetch,
  });

  await assert.rejects(
    outbound.leads.list({ email: PERSON }),
    (error) => OutboundError.is(error) && error.code === "Unauthorized"
  );
});

test("person_summary reports the tools that answered and says which one did not", async () => {
  const outbound = createOutbound({
    ...setup(heyreachRejectsKey).options,
    plugins: [insights()],
  });

  const result = await outbound.insights.personSummary({ person: PERSON });

  assert.equal(result.data.found, true);
  assert.deepEqual(
    result.data.campaigns.map((entry) => entry.campaign),
    ["instantly:acme:c1", "smartlead:acme:c1"]
  );
  assert.equal(result.meta.complete, false);
  assert.deepEqual(result.meta.notes, [
    "heyreach (acme) did not answer: Unauthorized (401). Its records are missing from this answer.",
  ]);
});

test("person_summary never reports a person as simply not found while a tool is missing", async () => {
  const http = createFetch(
    oneDown("heyreach", () => json({ message: "down" }, 503))
  );

  // Only the tool that is down holds the person.
  const outbound = createOutbound({
    adapter: combine([tool("instantly", 0), tool("heyreach")]),
    fetch: http.fetch,
    plugins: [insights()],
    retries: 0,
  });

  const result = await outbound.insights.personSummary({ person: PERSON });

  assert.equal(result.data.found, false);
  assert.equal(result.meta.complete, false, "the answer is not a clean no");
  assert.deepEqual(result.meta.notes, [
    "heyreach (acme) did not answer: Provider (503). Its records are missing from this answer.",
  ]);
});

test("identity's person() links the records it could read and lists the tool it could not", async () => {
  const outbound = createOutbound({
    ...setup(heyreachRejectsKey).options,
    plugins: [identity()],
  });

  const person = await outbound.person(PERSON, { timeline: false });

  assert.equal(person.found, true);
  assert.deepEqual(refs(person.records), OTHER_TWO);
  assert.equal(person.complete, false);
  assert.deepEqual(
    person.failures.map((failure) => [
      failure.provider,
      failure.workspaceId,
      failure.code,
      failure.status,
    ]),
    [["heyreach", "acme", "Unauthorized", 401]]
  );
});

test("person() on a healthy combined instance is complete, with no failures", async () => {
  const outbound = createOutbound({
    ...setup(() => json({})).options,
    plugins: [identity()],
  });

  const person = await outbound.person(PERSON, { timeline: false });
  const page = await outbound.leads.list({ email: PERSON });

  assert.equal(person.complete, true);
  assert.deepEqual(person.failures, []);
  assert.equal(page.complete, true);
  assert.deepEqual(page.failures, []);
});

test("the cross_channel_lead tool tells the model which tool is missing", async () => {
  const outbound = createOutbound({
    ...setup(heyreachRejectsKey).options,
    plugins: [identity()],
  });

  const [lookup] = createTools(outbound, { only: ["cross_channel_lead"] });
  assert.ok(lookup);
  const result = await lookup.call({ person: PERSON });

  assert.equal(result.ok, true);
  assert.partialDeepStrictEqual(result, {
    data: {
      complete: false,
      failed_tools: [
        {
          code: "Unauthorized",
          provider: "heyreach",
          status: 401,
          workspace: "acme",
        },
      ],
      found: true,
    },
  });
});

test("an answer a tool is missing from is not cached or kept for failover", async () => {
  let down = true;
  let now = 0;

  const outbound = createOutbound({
    ...setup((request) =>
      down && hostOf(request.url) === "heyreach.test"
        ? json({ message: "down" }, 503)
        : json({})
    ).options,
    plugins: [
      failover({ now: () => now, store: memoryCacheStore() }),
      cache({ now: () => now, ttl: 60 }),
    ],
  });

  const partial = await outbound.leads.list({ email: PERSON });
  assert.equal(partial.items.length, 2);

  // The tool is back a second later, inside the cache's lifetime.
  down = false;
  now += 1000;
  const whole = await outbound.leads.list({ email: PERSON });

  assert.equal(whole.items.length, 3, "the partial answer was not served");
  assert.deepEqual(whole.failures, []);
  assert.equal(whole.complete, true);
});
