// A sync that stops at maxPages saves the next page's cursor without
// fetching that page, so the next run does not fetch it twice (BRA-128
// item 4). Before, every boundary page was read by both runs: each page
// twice at maxPages 1.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../../src/index.ts";
import { instantly } from "../../src/instantly/index.ts";
import { memoryCheckpointStore, sync } from "../../src/sync/index.ts";
import { fixtureHandler } from "../helpers/adapter-suite.ts";
import { createClock } from "../helpers/clock.ts";
import { createFetch, json, testAdapter } from "../helpers/http.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { CAMPAIGN, suite } from "./suite.ts";

const PAGE = 2;
const IDS = ["a1", "a2", "b1", "b2", "c1"];

/** Five records two a page, ordered by id, a marker on the last page and then an empty one. */
const pageAfter = (after: string | null | undefined) => {
  const items = IDS.filter(
    (id) => after === undefined || after === null || id > after
  ).slice(0, PAGE);

  return { ids: items, next: items.at(-1) ?? null };
};

const instance = () => {
  const fixtures = fixtureHandler([suite], []);

  const http = createFetch((request: RecordedRequest, index) => {
    const url = new URL(request.url);

    if (
      url.pathname === "/api/v2/leads/list" &&
      !(JSON.parse(request.body ?? "{}") as { contacts?: unknown }).contacts
    ) {
      const { ids, next } = pageAfter(
        (JSON.parse(request.body ?? "{}") as { starting_after?: string })
          .starting_after
      );

      return json({
        items: ids.map((id) => ({
          campaign: CAMPAIGN,
          email: `${id}@example.com`,
          id,
          timestamp_created: "2026-10-01T00:00:00.000Z",
        })),
        next_starting_after: next,
      });
    }

    if (url.pathname === "/api/v2/emails") {
      const { ids, next } = pageAfter(url.searchParams.get("starting_after"));

      return json({
        items: ids.map((id) => ({
          campaign_id: CAMPAIGN,
          id,
          lead: `${id}@example.com`,
          timestamp_created: "2026-10-01T00:00:00.000Z",
          ue_type: 2,
        })),
        next_starting_after: next,
      });
    }

    return fixtures(request, index);
  });

  const clock = createClock();

  const outbound = createOutbound({
    adapter: instantly({ apiKey: "inst_key_for_client_a_0001" }),
    fetch: http.fetch,
    plugins: [sync({ checkpoints: memoryCheckpointStore() })],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
  });

  return { outbound, requests: http.requests, settle: clock.settle };
};

/** The cursor each listing request started from, in order. */
const starts = (requests: readonly RecordedRequest[], path: string) =>
  requests.flatMap((request) => {
    const url = new URL(request.url);

    if (url.pathname !== path) {
      return [];
    }

    const body = JSON.parse(request.body ?? "{}") as {
      contacts?: unknown;
      starting_after?: string;
    };

    if (body.contacts !== undefined) {
      return [];
    }

    return [
      (path === "/api/v2/emails"
        ? url.searchParams.get("starting_after")
        : body.starting_after) ?? "(start)",
    ];
  });

for (const [collection, path] of [
  ["leads", "/api/v2/leads/list"],
  ["replies", "/api/v2/emails"],
] as const) {
  test(`instantly: a ${collection} sync at maxPages 1 fetches each page once across runs`, async () => {
    const { outbound, requests, settle } = instance();
    const results = [];

    for (let run = 0; run < 4; run += 1) {
      // oxlint-disable-next-line no-await-in-loop -- each run resumes from the one before
      results.push(
        await settle(
          outbound.sync.run(collection, {
            campaignId: CAMPAIGN,
            limit: PAGE,
            maxPages: 1,
            onPage: () => {},
          })
        )
      );
    }

    assert.deepEqual(
      starts(requests, path),
      ["(start)", "a2", "b2", "c1"],
      "one request a run, never the same page twice"
    );
    assert.deepEqual(
      results.map((result) => [result.records, result.complete]),
      [
        [2, false],
        [2, false],
        [1, false],
        [0, true],
      ]
    );
  });
}

test("instantly: a leads sync at maxPages 2 asks for two pages, not three", async () => {
  const { outbound, requests, settle } = instance();

  const first = await settle(
    outbound.sync.run("leads", { limit: PAGE, maxPages: 2, onPage: () => {} })
  );

  assert.deepEqual(starts(requests, "/api/v2/leads/list"), ["(start)", "a2"]);
  assert.equal(first.requests, 2);
  assert.equal(first.complete, false);
});

test("instantly: a sync with no maxPages still reads to the end", async () => {
  const { outbound, requests, settle } = instance();

  const result = await settle(
    outbound.sync.run("leads", { limit: PAGE, onPage: () => {} })
  );

  assert.deepEqual(starts(requests, "/api/v2/leads/list"), [
    "(start)",
    "a2",
    "b2",
    "c1",
  ]);
  assert.equal(result.records, 5);
  assert.equal(result.complete, true);
});

test("a run whose pages held nothing to hand out still moves its cursor", async () => {
  const http = createFetch((request) => {
    const offset = Number(new URL(request.url).searchParams.get("offset"));

    return json(
      offset < 2
        ? { items: [], next: offset + 1 }
        : { items: [{ id: "c1", name: "One" }] }
    );
  });

  const outbound = createOutbound({
    adapter: testAdapter(),
    fetch: http.fetch,
    plugins: [sync({ checkpoints: memoryCheckpointStore() })],
    rateLimitStore: new MemoryRateLimitStore(),
  });

  const results = [];

  for (let run = 0; run < 3; run += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each run resumes from the one before
    results.push(
      await outbound.sync.run("campaigns", { maxPages: 1, onPage: () => {} })
    );
  }

  assert.deepEqual(
    http.requests.map((request) =>
      new URL(request.url).searchParams.get("offset")
    ),
    ["0", "1", "2"],
    "each run goes on from the last, empty pages included"
  );
  assert.deepEqual(
    results.map((result) => [result.records, result.complete]),
    [
      [0, false],
      [0, false],
      [1, true],
    ]
  );
});

test("listAll refuses pages that are not a positive integer, before any request", () => {
  const { outbound, requests } = instance();

  for (const pages of [0, -1, 1.5]) {
    assert.throws(
      () => outbound.leads.listAll({ pages }),
      (error) =>
        OutboundError.is(error) &&
        error.code === "Invalid" &&
        error.message.includes("pages")
    );
  }

  assert.equal(requests.length, 0);
});
