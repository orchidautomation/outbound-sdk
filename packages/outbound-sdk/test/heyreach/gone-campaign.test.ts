// A campaign HeyReach still lists but can no longer open (seen live
// 2026-11-23): GetConversationsV3 filtered by it, alone or with others,
// answers 400. A walk over the workspace's campaigns leaves it out instead
// of failing the whole listing.

import assert from "node:assert/strict";
import { test } from "node:test";

import { OutboundError } from "../../src/index.ts";
import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import { json } from "../helpers/http.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { suite } from "./suite.ts";

const CONVERSATIONS = "/api/public/inbox/GetConversationsV3";

const GONE = 274_080;

const filterOf = (request: RecordedRequest): readonly number[] | undefined =>
  (JSON.parse(request.body ?? "{}") as { filters?: { campaignIds?: number[] } })
    .filters?.campaignIds;

/** Answers any conversation filter naming the gone campaign as HeyReach does. */
const answering = (body: unknown) => (request: RecordedRequest) =>
  new URL(request.url).pathname === CONVERSATIONS &&
  filterOf(request)?.includes(GONE)
    ? json(body, 400)
    : undefined;

const gone = answering(fixture("heyreach", "error.400.campaign-gone.json"));

test("heyreach: replies skip a campaign HeyReach cannot open, and the inbox filter leaves it out", async () => {
  const { outbound, requests, settle } = harness(suite, gone);

  const replies = await settle(outbound.replies.listAll().toArray());

  assert.ok(replies.length > 0, "the other campaigns' replies are read");
  assert.ok(
    replies.every((reply) => reply.campaignRef !== `heyreach:client-a:${GONE}`)
  );

  const asked = requests.length;
  const withInbox = await settle(
    outbound.replies.listAll({ includeInbox: true }).toArray()
  );

  assert.ok(withInbox.length >= replies.length);

  const filters = requests
    .slice(asked)
    .filter((request) => new URL(request.url).pathname === CONVERSATIONS)
    .map(filterOf);

  assert.equal(
    filters.filter((ids) => ids?.includes(GONE)).length,
    1,
    "asked once, then left out of the filter that sets apart the inbox"
  );
  assert.ok(filters.some((ids) => (ids?.length ?? 0) > 1));
});

test("heyreach: any other 400 from a campaign's conversations still fails the listing", async () => {
  const { outbound, settle } = harness(
    suite,
    answering({ errorMessage: "Invalid filters." })
  );

  await assert.rejects(
    settle(outbound.replies.listAll().toArray()),
    (error) => OutboundError.is(error) && error.code === "Invalid"
  );
});
