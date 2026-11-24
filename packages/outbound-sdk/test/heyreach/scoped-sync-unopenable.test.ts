// A scoped sync on HeyReach skips a campaign HeyReach lists but cannot open
// (OUT-221): GetConversationsV3 filtered to it answers 400 "The campaign you
// are trying to open does not exist." (seen live 2026-11-23). The other
// campaigns sync, the skipped one is marked skipped and not complete, a note
// names it, and any other error still fails the run.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../../src/index.ts";
import type { Checkpoint } from "../../src/sync/index.ts";
import { sync } from "../../src/sync/index.ts";
import { fixtureHandler } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { CAMPAIGN, suite } from "./suite.ts";

const CONVERSATIONS = "/api/public/inbox/GetConversationsV3";

const GONE = 274_080;

const GONE_REF = "heyreach:client-a:274080";

const KEPT_REF = `heyreach:client-a:${CAMPAIGN}`;

const filterOf = (request: RecordedRequest): readonly number[] | undefined =>
  (JSON.parse(request.body ?? "{}") as { filters?: { campaignIds?: number[] } })
    .filters?.campaignIds;

const instance = (gone: unknown) => {
  const fixtures = fixtureHandler([suite], []);
  const saved = new Map<string, Checkpoint>();

  const http = createFetch((request: RecordedRequest, index) =>
    new URL(request.url).pathname === CONVERSATIONS &&
    filterOf(request)?.includes(GONE)
      ? json(gone, 400)
      : fixtures(request, index)
  );

  const outbound = createOutbound({
    adapter: suite.make(),
    fetch: http.fetch,
    plugins: [
      sync({
        checkpoints: {
          delete: (key) => {
            saved.delete(key);

            return Promise.resolve();
          },
          get: (key) => Promise.resolve(saved.get(key)),
          set: (key, checkpoint) => {
            saved.set(key, checkpoint);

            return Promise.resolve();
          },
        },
      }),
    ],
    rateLimitStore: new MemoryRateLimitStore(),
    retries: 0,
  });

  return { outbound, requests: http.requests, saved };
};

const cannotOpen = fixture("heyreach", "error.400.campaign-gone.json");

for (const collection of ["replies", "messages"] as const) {
  test(`a scoped HeyReach ${collection} sync skips a campaign HeyReach cannot open and names it`, async () => {
    const { outbound, saved } = instance(cannotOpen);
    let read = 0;

    const result = await outbound.sync.run(collection, {
      campaign_name: "*",
      onPage: (items) => {
        read += items.length;
      },
    });

    const campaigns = result.scope?.campaigns ?? [];
    const skipped = campaigns.find((each) => each.campaignRef === GONE_REF);

    assert.ok(skipped !== undefined, "the scope lists the campaign");
    assert.ok(campaigns.some((each) => each.campaignRef === KEPT_REF));
    assert.ok(read > 0, "the other campaigns are read");
    assert.equal(result.records, read);
    assert.equal(
      result.complete,
      true,
      "the run is complete: running again would not read it either"
    );
    assert.deepEqual(
      {
        complete: skipped.complete,
        pages: skipped.pages,
        records: skipped.records,
        skipped: skipped.skipped,
      },
      {
        complete: false,
        pages: 0,
        records: 0,
        skipped: { reason: "cannot-open" },
      },
      "the entry says it was not read"
    );
    assert.deepEqual(result.scope?.skipped, [GONE_REF]);
    assert.equal(
      campaigns.filter((each) => each.skipped !== undefined).length,
      1,
      "only the campaign that could not be opened is marked"
    );
    assert.equal(
      campaigns.find((each) => each.campaignRef === KEPT_REF)?.complete,
      true
    );

    const notes = result.notes.filter((note) => note.includes(GONE_REF));

    assert.equal(notes.length, 1);
    assert.match(notes[0] ?? "", /cannot open/u);

    const refs = new Set(
      [...saved.values()].map((checkpoint) => checkpoint.campaignRef)
    );

    assert.equal(refs.has(GONE_REF), false, "no checkpoint for it");
    assert.equal(refs.has(KEPT_REF), true);
  });
}

test("a scoped HeyReach sync still fails on any other 400 from a campaign", async () => {
  const { outbound } = instance({ errorMessage: "Invalid filters." });

  await assert.rejects(
    outbound.sync.run("replies", { campaign_name: "*", onPage: () => {} }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Invalid" &&
      error.status === 400
  );
});

test("a scoped HeyReach sync that reaches no such campaign adds no note", async () => {
  const { outbound } = instance(cannotOpen);

  const result = await outbound.sync.run("replies", {
    campaign_ids: [CAMPAIGN],
    onPage: () => {},
  });

  assert.equal(
    result.notes.some((note) => note.includes("cannot open")),
    false
  );
  assert.deepEqual(result.scope?.skipped, []);
  assert.equal(
    result.scope?.campaigns.some((each) => each.skipped !== undefined),
    false
  );
});

test("reading the replies of a campaign HeyReach cannot open is NotFound", async () => {
  const { outbound, requests } = instance(cannotOpen);

  await assert.rejects(
    outbound.replies.list({ campaignId: String(GONE) }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "NotFound" &&
      error.status === 400 &&
      error.message.includes(String(GONE))
  );
  assert.equal(requests.length, 1, "one request, no retry");
});
