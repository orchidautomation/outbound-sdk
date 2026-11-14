import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { fixture, fixtureText } from "../helpers/fixtures.ts";
import { suite } from "./suite.ts";

const events = () => {
  const format = suite.make().events;
  assert.ok(format);

  return format;
};

const requestFor = (body: unknown, headers: Record<string, string> = {}) => {
  const rawBody = JSON.stringify(body);

  return {
    body: JSON.parse(rawBody),
    headers: new Headers(headers),
    rawBody,
    url: "https://hooks.example.com/smartlead",
  };
};

const parse = (body: unknown, headers?: Record<string, string>) => {
  const [event] = events().parse(requestFor(body, headers), "client-a");
  assert.ok(event);

  return event;
};

const load = (name: string) =>
  fixture("smartlead", name) as Record<string, unknown>;

test("smartlead: a sent-email webhook carries the campaign, the email and the step", () => {
  const event = parse(load("webhook.EMAIL_SENT.json"));
  assert.equal(event.type, "message.sent");
  assert.equal(event.occurredAt, "2023-09-25T17:27:27.234Z");
  assert.equal(event.campaignRef, "smartlead:client-a:111");
  assert.equal(event.messageRef, "smartlead:client-a:id", "stats_id");
  assert.equal(event.leadRef, null, "the documented example has no lead id");
  assert.equal(event.senderRef, null, "the mailbox is named by address");
  assert.deepEqual(event.data, {
    campaignName: "OR Tracker",
    leadEmail: "person1@example.com",
    senderEmail: "person9@example.com",
    stepIndex: 0,
    subject: "OR",
    vendorEvent: "EMAIL_SENT",
  });
});

test("smartlead: every documented event name maps to an event type", () => {
  const expected = [
    ["EMAIL_SENT", "message.sent"],
    ["FIRST_EMAIL_SENT", "message.sent"],
    ["EMAIL_OPEN", "message.opened"],
    ["EMAIL_LINK_CLICK", "message.clicked"],
    ["EMAIL_REPLY", "reply.received"],
    ["EMAIL_BOUNCE", "message.bounced"],
    ["LEAD_UNSUBSCRIBED", "lead.unsubscribed"],
    ["LEAD_CATEGORY_UPDATED", "reply.categorized"],
    ["CAMPAIGN_STATUS_CHANGED", "campaign.status_changed"],
    ["UNTRACKED_REPLIES", "reply.received"],
    ["MANUAL_STEP_REACHED", "unknown"],
    // Names some documentation pages use that are not real event names.
    ["EMAIL_OPENED", "unknown"],
    ["LEAD_REPLIED", "unknown"],
  ] as const;

  for (const [name, type] of expected) {
    const body = { ...load("webhook.EMAIL_SENT.json"), event_type: name };
    assert.equal(events().detect(requestFor(body)), true, name);
    assert.equal(parse(body).type, type, name);
    assert.equal(parse(body).data.vendorEvent, name);
  }
});

test("smartlead: a reply webhook points at the reply and carries its text", () => {
  const event = parse(load("webhook.EMAIL_REPLY.json"));
  assert.equal(event.type, "reply.received");
  assert.equal(event.occurredAt, "2023-04-04T08:31:22.000Z");
  assert.equal(
    event.messageRef,
    "smartlead:client-a:<id@example.com>",
    "the reply's Message-ID, as in the message lists"
  );
  assert.equal(
    event.data.text,
    "##- Please type your reply above this line -##"
  );
  assert.equal(event.data.leadEmail, "person1@example.com");
  assert.equal(event.data.senderEmail, "person9@example.com");

  const newer = parse(load("webhook.EMAIL_REPLY.newdocs.json"));
  assert.equal(newer.type, "reply.received");
  assert.equal(newer.occurredAt, "2025-01-15T11:00:00.000Z", "time_replied");
  assert.equal(newer.campaignRef, "smartlead:client-a:123");
  assert.equal(newer.messageRef, null);
  assert.equal(newer.data.text, "Thanks for reaching out. I'm interested...");

  const untracked = parse(load("webhook.UNTRACKED_REPLIES.json"));
  assert.equal(untracked.data.untracked, true);
  assert.equal(untracked.campaignRef, null);
  assert.equal(untracked.data.text, "Hi");
  assert.equal(
    untracked.messageRef,
    "smartlead:client-a:<untracked-id@example.com>"
  );
});

test("smartlead: a category webhook carries the lead and the category's sentiment", () => {
  const body = load("webhook.LEAD_CATEGORY_UPDATED.json");
  const event = parse(body);
  assert.equal(event.type, "reply.categorized");
  assert.equal(event.leadRef, "smartlead:client-a:100");
  assert.equal(event.campaignRef, "smartlead:client-a:10");
  assert.equal(event.data.category, "positive");
  assert.equal(event.data.categoryName, "Interested");
  assert.equal(event.occurredAt, null, "the payload has no event time");

  const withCategory = (category: unknown) =>
    parse({
      ...body,
      lead_data: { ...(body.lead_data as object), category },
    }).data.category;

  assert.equal(
    withCategory({ name: "Not Interested", sentiment_type: "negative" }),
    "negative"
  );
  assert.equal(
    withCategory({ name: "Out Of Office", sentiment_type: null }),
    "ooo"
  );
  assert.equal(
    withCategory({ name: "Later", sentiment_type: null }),
    undefined,
    "no sentiment, no category"
  );

  const manual = parse(load("webhook.MANUAL_STEP_REACHED.json"));
  assert.equal(manual.leadRef, "smartlead:client-a:138084");
  assert.equal(manual.data.stepIndex, 0, "current_sequence_number 1");
  assert.equal(manual.data.leadEmail, "person1@example.com");
});

test("smartlead: a status webhook maps both statuses, and a test event says so", () => {
  const event = parse({
    ...load("webhook.CAMPAIGN_STATUS_CHANGED.json"),
    is_test: true,
  });

  assert.equal(event.type, "campaign.status_changed");
  assert.equal(event.campaignRef, "smartlead:client-a:377");
  assert.equal(event.data.previousStatus, "paused");
  assert.equal(event.data.currentStatus, "active");
  assert.equal(event.data.isTest, true);
  assert.equal(event.data.stepIndex, undefined);
});

test("smartlead: the two account notices use their own envelope", () => {
  const disconnected = parse(load("webhook.email.account.disconnected.json"));
  assert.equal(disconnected.type, "sender.status_changed");
  assert.equal(disconnected.occurredAt, "2025-09-07T10:15:00.000Z");
  assert.equal(disconnected.senderRef, "smartlead:client-a:139919");
  assert.deepEqual(disconnected.data, {
    reason: "SMTP Failure - Host unavailable",
    senderEmail: "person1@example.com",
    vendorEvent: "email.account.disconnected",
  });

  const breached = parse(
    load("webhook.campaign.bounce_threshold.breached.json")
  );

  assert.equal(breached.type, "campaign.status_changed");
  assert.equal(breached.campaignRef, "smartlead:client-a:139919");
  assert.equal(breached.data.action, "paused");
  assert.equal(breached.senderRef, null);

  const other = parse({
    ...load("webhook.email.account.disconnected.json"),
    type: "linkedin.account.disconnected",
  });

  assert.equal(other.type, "unknown");
});

test("smartlead: the shared secret is removed from the stored payload", () => {
  for (const file of Object.keys(suite.webhooks)) {
    const original = load(file);
    const event = parse({ ...original, secret_key: "a-shared-secret-value" });
    assert.ok(!JSON.stringify(event).includes("a-shared-secret-value"), file);
    assert.ok(!("secret_key" in (event.raw as object)), file);
    assert.equal(
      (event.raw as { event_type?: string }).event_type,
      original.event_type,
      "the rest of the payload is kept"
    );
  }
});

test("smartlead: detect claims Smartlead payloads only", () => {
  const { detect } = events();

  for (const file of Object.keys(suite.webhooks)) {
    assert.equal(detect(requestFor(load(file))), true, file);
  }

  const others = [
    // Instantly: a lowercase event_type with workspace and timestamp.
    fixture("instantly", "webhook.reply_received.json"),
    { event_type: "email_sent", timestamp: "2026-01-01", workspace: "w" },
    { event_type: "EMAIL_SENT" },
    { event_type: "Email Sent", webhook_id: 1 },
    { event_type: 7, webhook_id: 1 },
    {
      data: {},
      links: { app: "https://app.example.com" },
      meta: {},
      type: "x",
    },
    { data: {}, meta: {}, type: "email.account.disconnected" },
    ["EMAIL_SENT"],
    "EMAIL_SENT",
    null,
  ];

  for (const body of others) {
    assert.equal(detect(requestFor(body)), false, JSON.stringify(body));
  }

  assert.deepEqual(events().parse(requestFor(["EMAIL_SENT"]), "client-a"), []);
});

// The Standard Webhooks scheme, computed here with node:crypto, independently
// of the adapter's own HMAC.
const SECRET_BYTES = Buffer.from("a 24 byte signing secret", "utf-8");
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;

const sign = (
  key: Buffer,
  id: string,
  timestamp: number,
  rawBody: string
): string =>
  `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64")}`;

interface SignatureHeaders {
  readonly id?: string;
  readonly timestamp?: string;
  readonly signature?: string;
}

const signed = (rawBody: string, sent: SignatureHeaders) => {
  const headers = new Headers();

  for (const [name, value] of [
    ["webhook-id", sent.id],
    ["webhook-signature", sent.signature],
    ["webhook-timestamp", sent.timestamp],
  ] as const) {
    if (value !== undefined) {
      headers.set(name, value);
    }
  }

  return {
    body: JSON.parse(rawBody),
    headers,
    rawBody,
    url: "https://hooks.example.com/smartlead",
  };
};

test("smartlead: verify accepts a correct Standard Webhooks signature", () => {
  const { verify } = events();
  assert.ok(verify);

  // Non-ASCII text, so the signature is over UTF-8 bytes.
  const rawBody = fixtureText("smartlead", "webhook.EMAIL_REPLY.json").replace(
    "Alex Example",
    "Aléx Exämple ✓"
  );

  const now = Math.floor(Date.now() / 1000);
  const signature = sign(SECRET_BYTES, "msg_2abc", now, rawBody);

  const request = signed(rawBody, {
    id: "msg_2abc",
    signature,
    timestamp: String(now),
  });

  assert.equal(verify(request, SECRET), true);
  assert.equal(
    verify(request, SECRET_BYTES.toString("base64")),
    true,
    "the prefix is optional"
  );
  assert.equal(
    verify(
      signed(rawBody, {
        id: "msg_2abc",
        signature: `v1,${"A".repeat(43)}= ${signature} v2,ignored`,
        timestamp: String(now),
      }),
      SECRET
    ),
    true,
    "any of several signatures may match while a secret rotates"
  );
});

test("smartlead: verify works with every documented secret length", () => {
  const { verify } = events();
  assert.ok(verify);
  const rawBody = fixtureText("smartlead", "webhook.EMAIL_SENT.json");
  const now = Math.floor(Date.now() / 1000);

  // 24 to 64 bytes are documented; a longer key is hashed first (RFC 2104).
  for (const length of [24, 32, 63, 64, 65, 100]) {
    const key = Buffer.from(
      Array.from({ length }, (_unused, index) => (index * 37 + 11) % 256)
    );

    const request = signed(rawBody, {
      id: `msg_${length}`,
      signature: sign(key, `msg_${length}`, now, rawBody),
      timestamp: String(now),
    });

    assert.equal(
      verify(request, `whsec_${key.toString("base64")}`),
      true,
      `${length} bytes`
    );
  }
});

test("smartlead: verify refuses a wrong, stale or missing signature", () => {
  const { verify } = events();
  assert.ok(verify);
  const rawBody = fixtureText("smartlead", "webhook.EMAIL_REPLY.json");
  const now = Math.floor(Date.now() / 1000);
  const id = "msg_2abc";
  const good = sign(SECRET_BYTES, id, now, rawBody);
  const timestamp = String(now);

  const otherSecret = sign(
    Buffer.from("another signing secret!!"),
    id,
    now,
    rawBody
  );

  const stale = now - 301;
  const early = now + 301;

  const refused = [
    [
      "another secret",
      signed(rawBody, { id, signature: otherSecret, timestamp }),
    ],
    [
      "a changed body",
      signed(rawBody.replace("person1", "person2"), {
        id,
        signature: good,
        timestamp,
      }),
    ],
    [
      "another id",
      signed(rawBody, { id: "msg_other", signature: good, timestamp }),
    ],
    [
      "another timestamp",
      signed(rawBody, { id, signature: good, timestamp: String(now - 1) }),
    ],
    [
      "too old",
      signed(rawBody, {
        id,
        signature: sign(SECRET_BYTES, id, stale, rawBody),
        timestamp: String(stale),
      }),
    ],
    [
      "too far ahead",
      signed(rawBody, {
        id,
        signature: sign(SECRET_BYTES, id, early, rawBody),
        timestamp: String(early),
      }),
    ],
    [
      "an unknown version",
      signed(rawBody, { id, signature: good.replace("v1,", "v2,"), timestamp }),
    ],
    [
      "a truncated signature",
      signed(rawBody, { id, signature: good.slice(0, -4), timestamp }),
    ],
    [
      "no version",
      signed(rawBody, { id, signature: good.slice(3), timestamp }),
    ],
    [
      "a timestamp that is not a number",
      signed(rawBody, { id, signature: good, timestamp: "soon" }),
    ],
    ["no id", signed(rawBody, { signature: good, timestamp })],
    ["no timestamp", signed(rawBody, { id, signature: good })],
    ["no signature", signed(rawBody, { id, timestamp })],
  ] as const;

  for (const [why, request] of refused) {
    assert.equal(verify(request, SECRET), false, why);
  }

  const request = signed(rawBody, { id, signature: good, timestamp });
  assert.equal(verify(request, SECRET), true, "the control case");
  assert.equal(verify(request, "whsec_not base64!"), false);
  assert.equal(verify(request, "whsec_"), false, "an empty secret");
  assert.equal(verify(request, ""), false);
});

test("smartlead: a signed delivery's id comes from webhook-id, so a retry is the same event", () => {
  const body = load("webhook.EMAIL_OPEN.json");
  const first = parse(body, { "webhook-id": "msg_2abc" });

  const retry = parse(
    { ...body, description: "changed on retry" },
    { "webhook-id": "msg_2abc" }
  );

  const other = parse(body, { "webhook-id": "msg_2abd" });
  const unsigned = parse(body);
  assert.equal(first.id, retry.id);
  assert.notEqual(first.id, other.id);
  assert.notEqual(first.id, unsigned.id);
  assert.equal(unsigned.id, parse(body).id);
  assert.notEqual(
    unsigned.id,
    parse({ ...body, event_timestamp: "2023-09-25T18:00:00Z" }).id
  );
});
