import assert from "node:assert/strict";
import { test } from "node:test";

import { heyreach } from "../../src/heyreach/index.ts";
import { fixture } from "../helpers/fixtures.ts";
import { KEY } from "./suite.ts";

const request = (body: unknown) => {
  const rawBody = JSON.stringify(body);

  return {
    body: JSON.parse(rawBody),
    headers: new Headers(),
    rawBody,
    url: "https://hooks.example.com/x",
  };
};

const events = () => {
  const format = heyreach({ apiKey: KEY, workspaceId: "client-a" }).events;
  assert.ok(format);

  return format;
};

const parseOne = (body: unknown) => {
  const [event] = events().parse(request(body), "client-a");
  assert.ok(event);

  return event;
};

const LEAD_REF =
  "heyreach:client-a:https://www.linkedin.com/in/example-person-1";

test("heyreach: the documented voice note webhook maps its snake_case fields", () => {
  const event = parseOne(
    fixture("heyreach", "webhook.voice_note_received.json")
  );

  assert.equal(event.type, "linkedin.message_received");
  assert.equal(event.occurredAt, "2026-11-10T09:14:11.000Z");
  assert.equal(event.campaignRef, "heyreach:client-a:48213");
  assert.equal(event.senderRef, "heyreach:client-a:7606");
  assert.equal(event.leadRef, LEAD_REF);
  assert.equal(event.messageRef, null, "HeyReach messages have no id");
  assert.deepEqual(event.data, {
    campaignName: "Q4 Founders Outreach",
    conversationId:
      "2-YTNjMDM4ZjctOGVmMS00NTBmLTgzOWMtMGNlZGUwNGY5MTJlXzAxMg==",
    isInmail: false,
    leadLinkedinId: "724131259",
    leadName: "Alex Example",
    recentMessages: [
      {
        isReply: true,
        messageType: "Voice",
        sentAt: "2026-11-10T09:14:03.000Z",
        transcript:
          "Hi Sam, thanks for the note. Happy to jump on a call next Tuesday.",
        transcriptStatus: "DONE",
      },
    ],
    tags: ["Interested"],
    vendorEvent: "voice_note_received",
  });
});

test("heyreach: the third-party message_sent sample parses with the same skeleton", () => {
  const event = parseOne(
    fixture("heyreach", "webhook.message_sent.THIRD_PARTY.json")
  );

  assert.equal(event.type, "linkedin.message_sent");
  assert.equal(event.occurredAt, "2026-06-19T04:51:13.910Z");
  assert.equal(event.campaignRef, "heyreach:client-a:425166");
  assert.equal(event.senderRef, null, "the sample carries no sender id");
  assert.equal(event.leadRef, LEAD_REF);
  assert.deepEqual(event.data, {
    campaignName: "Q2 Outreach",
    leadEmail: "person1@example.com",
    leadName: "Alex Example",
    recentMessages: [
      {
        isReply: false,
        sentAt: "2026-06-19T04:51:13.603Z",
        text: "Hey Alex, thanks for connecting!...",
      },
    ],
    vendorEvent: "message_sent",
  });
});

test("heyreach: each of the 13 documented event types maps by its lowercase name", () => {
  const expected = [
    ["connection_request_sent", "linkedin.connection_sent"],
    ["connection_request_accepted", "linkedin.connection_accepted"],
    ["message_sent", "linkedin.message_sent"],
    ["message_reply_received", "linkedin.message_received"],
    ["inmail_sent", "linkedin.message_sent"],
    ["inmail_reply_received", "linkedin.message_received"],
    ["every_message_reply_received", "linkedin.message_received"],
    ["follow_sent", "unknown"],
    ["liked_post", "unknown"],
    ["viewed_profile", "unknown"],
    ["campaign_completed", "campaign.status_changed"],
    ["lead_tag_updated", "lead.status_changed"],
    ["voice_note_received", "linkedin.message_received"],
    // The REST enum spelling is accepted too.
    ["MESSAGE_SENT", "linkedin.message_sent"],
    // Named only by the MCP tool schema, not by the REST docs.
    ["lead_auto_tagged_interested", "unknown"],
    ["lead_finished_sequence_without_replying", "unknown"],
  ] as const;

  for (const [name, type] of expected) {
    const body = {
      correlation_id: "6f5d0c1e-0000-4000-8000-000000000001",
      event_type: name,
      timestamp: "2026-11-10T09:14:11Z",
    };

    const event = parseOne(body);
    assert.equal(event.type, type, name);
    assert.deepEqual(event.data, { vendorEvent: name });
    assert.deepEqual(event.raw, body);
    assert.equal(event.campaignRef, null);
    assert.equal(event.leadRef, null);
    assert.equal(event.senderRef, null);
  }
});

test("heyreach: the event id comes from correlation_id and the event name", () => {
  const base = {
    correlation_id: "6f5d0c1e-0000-4000-8000-000000000002",
    event_type: "message_reply_received",
    timestamp: "2026-11-10T09:14:11Z",
  };

  const first = parseOne(base);
  const later = parseOne({ ...base, timestamp: "2026-11-10T09:20:00Z" });

  const every = parseOne({
    ...base,
    event_type: "every_message_reply_received",
  });

  const other = parseOne({ ...base, correlation_id: "another" });
  assert.equal(first.id, later.id, "a redelivery keeps its id");
  assert.notEqual(first.id, every.id, "two event types for one reply differ");
  assert.notEqual(first.id, other.id);

  const bare = {
    conversation_id: "2-abc",
    event_type: "message_sent",
    lead: { profile_url: "https://www.linkedin.com/in/example-person-1" },
    timestamp: "2026-11-10T09:14:11Z",
  };

  assert.equal(parseOne(bare).id, parseOne(bare).id);
  assert.notEqual(
    parseOne(bare).id,
    parseOne({ ...bare, conversation_id: "2-xyz" }).id,
    "without a correlation id the conversation, lead and time identify it"
  );
});

test("heyreach: detect claims a HeyReach payload and not an Instantly one", () => {
  const { detect } = events();

  for (const file of [
    "webhook.voice_note_received.json",
    "webhook.message_sent.THIRD_PARTY.json",
  ]) {
    assert.equal(detect(request(fixture("heyreach", file))), true, file);
  }

  for (const file of [
    "webhook.reply_received.json",
    "webhook.email_sent.json",
    "webhook.campaign_completed.json",
  ]) {
    assert.equal(detect(request(fixture("instantly", file))), false, file);
  }

  assert.equal(
    detect(
      request({
        correlation_id: "abc",
        event_type: "email_sent",
        timestamp: "2026-11-10T09:14:11Z",
        workspace: "ws_1",
      })
    ),
    false,
    "a workspace key marks an Instantly payload"
  );
  assert.equal(detect(request({ event_type: "message_sent" })), false);
  assert.equal(detect(request({ correlation_id: "abc" })), false);
  assert.equal(detect(request(["message_sent"])), false);
});

test("heyreach: a body that is not an object yields no events, and there is no verify", () => {
  const format = events();
  assert.deepEqual(format.parse(request(["message_sent"]), "client-a"), []);
  assert.equal(format.verify, undefined, "HeyReach documents no signature");
});
