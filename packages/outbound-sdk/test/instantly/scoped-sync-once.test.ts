// An Instantly scoped sync of replies or messages costs one GET /emails per
// campaign on the email lane, even with nothing new. Once every campaign has
// finished a run, the next run reads the workspace's emails once from the
// earliest lower bound and keeps the scope's here (BRA-128 item 1; in
// production 23 campaigns took 2m53s for 0 records).

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import { memoryCheckpointStore, sync } from "../../src/sync/index.ts";
import { fixtureHandler } from "../helpers/adapter-suite.ts";
import { createFetch, json } from "../helpers/http.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { suite } from "./suite.ts";

const EMAILS = "/api/v2/emails";

const instance = () => {
  const fixtures = fixtureHandler([suite], []);

  const http = createFetch((request: RecordedRequest, index) =>
    new URL(request.url).pathname === EMAILS
      ? json({ items: [] })
      : fixtures(request, index)
  );

  const outbound = createOutbound({
    adapter: suite.make(),
    fetch: http.fetch,
    plugins: [sync({ checkpoints: memoryCheckpointStore() })],
    rateLimitStore: new MemoryRateLimitStore(),
    retries: 0,
  });

  return { outbound, requests: http.requests };
};

const emailReads = (requests: readonly RecordedRequest[]) =>
  requests.flatMap((request) => {
    const url = new URL(request.url);

    return url.pathname === EMAILS
      ? [url.searchParams.get("campaign_id") ?? "(workspace)"]
      : [];
  });

for (const collection of ["replies", "messages"] as const) {
  test(`instantly: a second scoped ${collection} sync reads the workspace's emails once`, async () => {
    const { outbound, requests } = instance();

    const first = await outbound.sync.run(collection, {
      campaign_name: "*",
      onPage: () => {},
    });

    const campaigns = first.scope?.campaigns.length ?? 0;

    assert.ok(campaigns > 1);
    assert.equal(
      emailReads(requests).length,
      campaigns,
      "one read per campaign"
    );

    requests.length = 0;

    const second = await outbound.sync.run(collection, {
      campaign_name: "*",
      onPage: () => {},
    });

    assert.deepEqual(emailReads(requests), ["(workspace)"]);
    assert.ok(
      new URL(
        requests.find((request) => new URL(request.url).pathname === EMAILS)
          ?.url ?? ""
      ).searchParams.has("min_timestamp_created"),
      "from the earliest lower bound"
    );
    assert.equal(second.complete, true);
    assert.equal(second.records, 0);
    assert.equal(
      second.requests,
      requests.length,
      "the result counts every request, the listing included"
    );
  });
}

test("instantly: a first scoped sync still reads each campaign", async () => {
  const { outbound, requests } = instance();

  const result = await outbound.sync.run("replies", {
    campaign_name: "*",
    onPage: () => {},
  });

  assert.equal(emailReads(requests).includes("(workspace)"), false);
  assert.equal(emailReads(requests).length, result.scope?.campaigns.length);
});
