import assert from "node:assert/strict";
import { test } from "node:test";

import { instantly } from "../../src/instantly/index.ts";
import { fixture } from "../helpers/fixtures.ts";
import { KEY } from "./suite.ts";

test("instantly: a webhook carries the lead address, step and variant, and the reply text", () => {
  const { events } = instantly({ apiKey: KEY, workspaceId: "client-a" });

  const rawBody = JSON.stringify(
    fixture("instantly", "webhook.reply_received.json")
  );

  const [event] =
    events?.parse(
      {
        body: JSON.parse(rawBody),
        headers: new Headers(),
        rawBody,
        url: "https://hooks.example.com/x",
      },
      "client-a"
    ) ?? [];

  assert.equal(event?.type, "reply.received");
  assert.equal(event?.occurredAt, "2026-11-14T00:36:06.650Z");
  assert.equal(
    event?.campaignRef,
    "instantly:client-a:01a1d77b-a332-7a01-8e03-6f1a3f4d7599"
  );
  assert.equal(event?.senderRef, "instantly:client-a:person2@example.com");
  assert.equal(
    event?.messageRef,
    "instantly:client-a:01a1d77b-a37a-7316-9165-874e4863045c"
  );
  assert.equal(
    event?.leadRef,
    null,
    "the webhook names the lead by address only"
  );
  assert.deepEqual(event?.data, {
    campaignName: "My First Campaign",
    isFirst: true,
    leadEmail: "person1@example.com",
    stepIndex: 0,
    subject: "Re: Hello Alex",
    text: "Thanks for reaching out, let's talk next week.",
    variantKey: "A",
    vendorEvent: "reply_received",
  });
});

test("instantly: interest webhooks carry the category, under either spelling of the click event", () => {
  const { events } = instantly({ apiKey: KEY, workspaceId: "client-a" });

  const parse = (body: Record<string, unknown>) =>
    events?.parse(
      {
        body: body as never,
        headers: new Headers(),
        rawBody: JSON.stringify(body),
        url: "https://hooks.example.com/x",
      },
      "client-a"
    )[0];

  const base = fixture("instantly", "webhook.lead_interested.json") as Record<
    string,
    unknown
  >;

  assert.equal(parse(base)?.data.category, "positive");
  assert.equal(
    parse({ ...base, event_type: "lead_not_interested" })?.data.category,
    "negative"
  );
  assert.equal(
    parse({ ...base, event_type: "lead_out_of_office" })?.data.category,
    "ooo"
  );
  assert.equal(
    parse({ ...base, event_type: "link_clicked" })?.type,
    "message.clicked"
  );
  assert.equal(
    parse({ ...base, event_type: "auto_reply_received" })?.data.isAuto,
    true
  );
});
