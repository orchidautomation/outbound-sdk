// A HeyReach webhook event names its message by the ref sync gives the same
// message, so reconcile can pair them. Messages have no id in HeyReach; both
// sides hash the conversation, the send time, the side and the text.

import assert from "node:assert/strict";
import { test } from "node:test";

import { heyreach } from "../../src/heyreach/index.ts";
import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import type { Reply } from "../../src/index.ts";
import { reconcile } from "../../src/reconcile/index.ts";
import { memoryCheckpointStore, sync } from "../../src/sync/index.ts";
import { parse } from "../../src/webhooks/index.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import { KEY } from "./suite.ts";

const CONVERSATIONS = "/api/public/inbox/GetConversationsV3";

const delivery = (body: unknown) =>
  new Request("https://hooks.example.com/heyreach", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

const instance = () => {
  const http = createFetch((request) =>
    new URL(request.url).pathname === CONVERSATIONS
      ? json(fixture("heyreach", "getConversations.voice.json"))
      : json({ message: "not found" }, 404)
  );

  return createOutbound({
    adapter: heyreach({ apiKey: KEY, workspaceId: "client-a" }),
    fetch: http.fetch,
    plugins: [sync({ checkpoints: memoryCheckpointStore() }), reconcile()],
    rateLimitStore: new MemoryRateLimitStore(),
    retries: 0,
  });
};

const syncedReplies = async (): Promise<Reply[]> => {
  const outbound = instance();
  const replies: Reply[] = [];

  await outbound.sync.run<Reply>("replies", {
    campaignId: "48213",
    onPage: (items) => {
      replies.push(...items);
    },
  });

  return replies;
};

test("heyreach: a reply event's messageRef is the ref sync stores for that reply", async () => {
  const [event] = await parse(
    delivery(fixture("heyreach", "webhook.voice_note_received.json")),
    { provider: "heyreach", workspaceId: "client-a" }
  );

  const replies = await syncedReplies();

  assert.equal(replies.length, 1);
  assert.equal(event?.type, "linkedin.message_received");
  assert.equal(event?.messageRef, replies[0]?.ref);
});

test("heyreach: another reply in the same conversation gets another messageRef", async () => {
  const body = fixture("heyreach", "webhook.voice_note_received.json") as {
    recent_messages: { creation_time: string }[];
  };

  const later = structuredClone(body);
  const [message] = later.recent_messages;
  assert.ok(message);
  message.creation_time = "2026-11-10T09:20:00Z";

  const [event] = await parse(delivery(later), {
    provider: "heyreach",
    workspaceId: "client-a",
  });

  const [reply] = await syncedReplies();

  assert.notEqual(event?.messageRef, null);
  assert.notEqual(event?.messageRef, reply?.ref);
});

test("heyreach: an event without the conversation or a message has no messageRef", async () => {
  const body = fixture(
    "heyreach",
    "webhook.voice_note_received.json"
  ) as Record<string, unknown>;

  for (const broken of [
    { ...body, conversation_id: undefined },
    { ...body, recent_messages: [] },
    { ...body, event_type: "connection_request_sent" },
  ]) {
    const [event] = await parse(delivery(broken), {
      provider: "heyreach",
      workspaceId: "client-a",
    });

    assert.equal(event?.messageRef, null, JSON.stringify(Object.keys(broken)));
  }
});

test("heyreach: reconcile pairs the reply event with the listed message", async () => {
  const events = await parse(
    delivery(fixture("heyreach", "webhook.voice_note_received.json")),
    { provider: "heyreach", workspaceId: "client-a" }
  );

  const report = await instance().reconcile.events({
    campaignId: "48213",
    events,
    since: "2026-11-01T00:00:00.000Z",
  });

  assert.equal(report.checked, 1);
  assert.equal(report.matched, 1);
  assert.equal(report.uncheckable, 0);
  assert.deepEqual(report.unmatchedEvents, []);
});
