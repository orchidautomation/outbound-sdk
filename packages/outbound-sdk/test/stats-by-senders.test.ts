// OUT-143: several senders' stats in one read. Instantly names up to 200
// mailboxes in one GET /accounts/analytics/daily, so 250 senders cost two
// daily reads and one tracking lookup, where one sender at a time cost a
// daily read and a tracking lookup each.

import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../src/combine/index.ts";
import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../src/index.ts";
import { instantly } from "../src/instantly/index.ts";
import { harness } from "./helpers/adapter-suite.ts";
import { createClock } from "./helpers/clock.ts";
import { createFetch, json } from "./helpers/http.ts";
import type { RecordedRequest } from "./helpers/http.ts";
import { suite as heyreachSuite } from "./heyreach/suite.ts";
import { suite } from "./instantly/suite.ts";

const address = (index: number) => `person${index + 1}@d${index}.example.com`;

/** Two days a mailbox, in Instantly's casing, for every mailbox but the 250th. */
const dailyFor = (request: RecordedRequest): Response | undefined => {
  const url = new URL(request.url);

  if (url.pathname !== "/api/v2/accounts/analytics/daily") {
    return undefined;
  }

  return json(
    url.searchParams.getAll("emails").flatMap((email) =>
      email === address(249)
        ? []
        : [
            {
              date: "2026-11-02",
              email_account: email.toUpperCase(),
              sent: 10,
            },
            { date: "2026-11-03", email_account: email.toUpperCase(), sent: 5 },
          ]
    )
  );
};

const dailyReads = (requests: readonly RecordedRequest[]) =>
  requests.flatMap((request) => {
    const url = new URL(request.url);

    return url.pathname === "/api/v2/accounts/analytics/daily" ? [url] : [];
  });

const refOf = (index: number, workspace = "client-a") =>
  `instantly:${workspace}:${address(index)}`;

test("instantly: 250 senders' days come in two daily reads, each row under its own sender", async () => {
  const { outbound, requests, settle, unrouted } = harness(suite, dailyFor);
  const senders = Array.from({ length: 250 }, (_, index) => address(index));

  const result = await settle(
    outbound.stats({
      by: "day",
      from: "2026-11-01",
      scope: "sender",
      scopeIds: [...senders, refOf(0)],
      to: "2026-11-14",
    })
  );

  assert.deepEqual(unrouted, []);

  const reads = dailyReads(requests);
  assert.deepEqual(
    reads.map((url) => url.searchParams.getAll("emails").length),
    [200, 50],
    "each mailbox named once, at most 200 a read"
  );
  assert.equal(reads[0]?.searchParams.get("start_date"), "2026-11-01");
  assert.equal(reads[0]?.searchParams.get("end_date"), "2026-11-14");
  assert.equal(
    requests.filter(
      (request) =>
        new URL(request.url).pathname === "/api/v2/campaigns/analytics"
    ).length,
    1,
    "the workspace's tracking is read once for every sender"
  );
  assert.equal(result.meta.requests, requests.length);

  assert.equal(result.rows.length, 249 * 2);
  assert.deepEqual(
    result.rows
      .filter((row) => row.scopeRef === refOf(0))
      .map((row) => [row.scope, row.date, row.sent]),
    [
      ["sender", "2026-11-02", 10],
      ["sender", "2026-11-03", 5],
    ]
  );
  assert.ok(
    result.rows.every((row) => row.scopeRef !== refOf(249)),
    "a sender the vendor has no days for has no rows"
  );

  const totals = await settle(
    outbound.stats({ scope: "sender", scopeIds: [address(0), address(249)] })
  );

  assert.equal(totals.rows.length, 1);
  assert.equal(totals.rows[0]?.scopeRef, refOf(0));
  assert.equal(totals.rows[0]?.sent, 15);
  assert.equal(totals.rows[0]?.evidence, "derived");
});

test("several senders' stats are refused with no request where the scope, the ids or the adapter do not fit", async () => {
  const { outbound, requests } = harness(suite, dailyFor);

  const refused = [
    outbound.stats({ scope: "campaign", scopeIds: [address(0)] }),
    outbound.stats({
      scope: "sender",
      scopeId: address(0),
      scopeIds: [address(1)],
    }),
    outbound.stats({ scope: "sender", scopeIds: [] }),
  ];

  for (const call of refused) {
    await assert.rejects(
      call,
      (error) => OutboundError.is(error) && error.code === "Invalid"
    );
  }

  const heyreach = harness(heyreachSuite);
  assert.equal(heyreach.outbound.capabilities["stats.bySenders"], false);

  await assert.rejects(
    heyreach.outbound.stats({ scope: "sender", scopeIds: ["1101", "1102"] }),
    (error) => OutboundError.is(error) && error.code === "Unsupported"
  );

  assert.equal(requests.length, 0);
  assert.equal(heyreach.requests.length, 0);
});

test("a combined instance sends each member only its own senders", async () => {
  const clock = createClock();

  const http = createFetch((request) => {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/v2/campaigns/analytics") {
      return json([]);
    }

    return pathname === "/api/v2/campaigns"
      ? json({ items: [] })
      : (dailyFor(request) ?? json({ message: "Not found" }, 404));
  });

  const outbound = createOutbound({
    adapter: combine([
      instantly({ apiKey: "inst_key_for_client_a_0001", workspaceId: "a" }),
      instantly({ apiKey: "inst_key_for_client_b_0002", workspaceId: "b" }),
    ]),
    fetch: http.fetch,
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  assert.notEqual(outbound.capabilities["stats.bySenders"], false);

  const result = await clock.settle(
    outbound.stats({
      by: "day",
      scope: "sender",
      scopeIds: [refOf(0, "a"), refOf(1, "b"), refOf(2, "a")],
    })
  );

  assert.deepEqual(
    dailyReads(http.requests)
      .map((url) => url.searchParams.getAll("emails"))
      .toSorted((left, right) => left.length - right.length),
    [[address(1)], [address(0), address(2)]]
  );
  assert.deepEqual(
    [...new Set(result.rows.map((row) => row.scopeRef))].toSorted(),
    [refOf(0, "a"), refOf(2, "a"), refOf(1, "b")]
  );
});
