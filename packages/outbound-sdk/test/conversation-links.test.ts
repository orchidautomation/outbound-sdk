// A message or reply links to its conversation in the vendor's app only where
// the vendor's URL scheme is known (OUT-140). Instantly's expected link is the
// unibox_url Instantly itself sent on a reply webhook; the other vendors
// document none, so their link is null and their field coverage says so.

import assert from "node:assert/strict";
import { test } from "node:test";

import { replySchema } from "../src/index.ts";
import { createTools } from "../src/tools/index.ts";
import { suite as emailbison } from "./emailbison/suite.ts";
import type { AdapterSuite } from "./helpers/adapter-suite.ts";
import { harness } from "./helpers/adapter-suite.ts";
import { fixture } from "./helpers/fixtures.ts";
import { suite as heyreach } from "./heyreach/suite.ts";
import { suite as instantly } from "./instantly/suite.ts";
import { suite as smartlead } from "./smartlead/suite.ts";

const delivery = fixture("instantly", "getWebhookEvent.replyReceived.json") as {
  payload: { unibox_url: string };
};

const UNIBOX = new URL(delivery.payload.unibox_url);

const THREAD = (UNIBOX.searchParams.get("thread_search") ?? "").replace(
  /^thread:/u,
  ""
);

const sameLead = (): Record<string, unknown>[] =>
  (
    fixture("instantly", "listReplies.sameLead.json") as {
      items: Record<string, unknown>[];
    }
  ).items;

/** Answers the reply list with `items`, leaving every other read to the fixtures. */
const replies =
  (items: readonly object[]) =>
  (request: { url: string }): Response | undefined => {
    const url = new URL(request.url);

    return url.pathname === "/api/v2/emails" &&
      url.searchParams.get("email_type") === "received"
      ? Response.json({ items })
      : undefined;
  };

test("instantly: a reply links to its thread exactly as Instantly's own unibox_url does", async () => {
  const items = sameLead().map((item) => ({ ...item, thread_id: THREAD }));
  const { outbound, settle } = harness(instantly, replies(items));

  const listed = (await settle(outbound.replies.list())).items;

  assert.equal(listed.length, 2);

  for (const reply of listed) {
    assert.equal(reply.url, delivery.payload.unibox_url);
    assert.ok(replySchema.safeParse(reply).success);
  }

  assert.equal(outbound.fields.reply.url, "derived");
  assert.equal(outbound.fields.message.url, "derived");
});

test("reply_samples: each reply carries its conversation link for an agent to hand on", async () => {
  const items = sameLead().map((item) => ({ ...item, thread_id: THREAD }));
  const { outbound, settle } = harness(instantly, replies(items));

  const tool = createTools(outbound).find(
    (candidate) => candidate.name === "reply_samples"
  );

  assert.ok(tool);

  const result = await settle(tool.call({}));
  assert.ok(result.ok);

  const data = result.data as { replies: { url: string | null }[] };
  assert.deepEqual(
    data.replies.map((reply) => reply.url),
    [delivery.payload.unibox_url, delivery.payload.unibox_url]
  );
});

test("instantly: an email without its thread or workspace has no link", async () => {
  const [first, second] = sameLead();
  const { thread_id: _thread, ...noThread } = first ?? {};
  const { organization_id: _workspace, ...noWorkspace } = second ?? {};

  const { outbound, settle } = harness(
    instantly,
    replies([noThread, noWorkspace])
  );

  const listed = (await settle(outbound.replies.list())).items;

  assert.deepEqual(
    listed.map((reply) => reply.url),
    [null, null]
  );
});

const UNDOCUMENTED: readonly [string, AdapterSuite][] = [
  ["emailbison", emailbison],
  ["heyreach", heyreach],
  ["smartlead", smartlead],
];

for (const [name, suite] of UNDOCUMENTED) {
  test(`${name}: no conversation link is documented, so replies carry null and coverage says it is never filled`, async () => {
    const { outbound, settle } = harness(suite);

    const listed = (await settle(outbound.replies.list({ limit: 50 }))).items;

    assert.ok(listed.length > 0, "the fixtures hold replies");
    assert.ok(listed.every((reply) => reply.url === null));
    assert.equal(outbound.fields.reply.url, false);
    assert.equal(outbound.fields.message.url, false);
    assert.ok(
      outbound.caveats.some((caveat) =>
        caveat.startsWith("A message's or reply's url is null")
      ),
      "the caveats say why"
    );
  });
}
