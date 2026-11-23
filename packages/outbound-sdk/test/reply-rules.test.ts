// The fixed reply rules (OUT-195): each auto-reply and bounce rule with a
// message it flags and one it leaves alone, and the verdict an adapter keeps
// in `rule` beside the vendor's own flag.

import assert from "node:assert/strict";
import { test } from "node:test";

import { detectAutoReply, detectBounce } from "../src/index.ts";
import { suite as emailbison } from "./emailbison/suite.ts";
import { harness } from "./helpers/adapter-suite.ts";
import { fixture } from "./helpers/fixtures.ts";
import { json } from "./helpers/http.ts";
import { suite as heyreach } from "./heyreach/suite.ts";

type Raw = Record<string, unknown>;

const none = { body: null, from: null, subject: null };

const AUTO_CASES = [
  {
    flagged: { ...none, from: "auto-responder@example.com" },
    person: { ...none, from: "jordan@example.com" },
    reason: "machine_sender",
  },
  {
    flagged: { ...none, subject: "Automatic reply: Re: Partnership" },
    person: { ...none, subject: "Re: Partnership" },
    reason: "automatic_subject",
  },
  {
    flagged: {
      ...none,
      body: "I am currently out of the office until Monday with limited access to email.",
    },
    person: { ...none, body: "I'm out next week, but yes, send the deck." },
    reason: "automatic_body",
  },
  {
    flagged: {
      ...none,
      body: "Your contact with Example Co has changed. Please write to info@example.com.",
    },
    person: { ...none, body: "I changed teams, but I still run this." },
    reason: "left_company",
  },
] as const;

for (const { flagged, person, reason } of AUTO_CASES) {
  test(`detectAutoReply: ${reason} flags the canned message and not a person`, () => {
    assert.equal(detectAutoReply(flagged).reason, reason);
    assert.deepEqual(detectAutoReply(person), {
      isAuto: false,
      leftCompany: false,
      reason: null,
    });
  });
}

const BOUNCE_CASES = [
  {
    flagged: { ...none, from: "MAILER-DAEMON@mail.example.com" },
    person: { ...none, from: "daemon.fan@example.com" },
    reason: "bounce_sender",
  },
  {
    flagged: { ...none, subject: "Undeliverable: Partnership" },
    person: { ...none, subject: "Re: Partnership, delivered as promised" },
    reason: "bounce_subject",
  },
  {
    flagged: {
      ...none,
      body: "550 5.1.1 The email account that you tried to reach does not exist.",
    },
    person: { ...none, body: "We have 550 seats and 5 offices." },
    reason: "bounce_body",
  },
] as const;

for (const { flagged, person, reason } of BOUNCE_CASES) {
  test(`detectBounce: ${reason} flags a delivery failure notice and not a person`, () => {
    assert.deepEqual(detectBounce(flagged), { bounce: true, reason });
    assert.deepEqual(detectBounce(person), { bounce: false, reason: null });
  });
}

test("detectAutoReply: a bounce notice is not an auto-reply, and a quoted bounce in our own copy is not theirs", () => {
  const bounce = { ...none, subject: "Undeliverable: Partnership" };

  assert.equal(detectAutoReply(bounce).isAuto, false);
  assert.equal(
    detectBounce({
      ...none,
      body: "Yes, let's talk.\n\nOn Mon, Jan 5, Alex wrote:\n> Your message could not be delivered",
    }).bounce,
    false
  );
});

const [BISON_REPLY] = (
  fixture("emailbison", "listReplies.json") as { data: Raw[] }
).data;

const bisonReply = async (changes: Raw) => {
  const { outbound, settle } = harness(emailbison, (request) =>
    new URL(request.url).pathname === "/api/replies"
      ? json({ data: [{ ...BISON_REPLY, ...changes }], links: {}, meta: {} })
      : undefined
  );

  const [reply] = (await settle(outbound.replies.list())).items;

  return reply;
};

test("emailbison: a bounce sets isAuto by the rule, and rule says it bounced", async () => {
  const bounced = await bisonReply({
    automated_reply: null,
    from_email_address: "mailer-daemon@example.com",
  });

  assert.deepEqual(
    [bounced?.isAuto, bounced?.isAutoSource, bounced?.rule],
    [true, "rule", { autoReply: false, bounce: true, reason: "bounce_sender" }]
  );

  const person = await bisonReply({ automated_reply: null });

  assert.deepEqual(person?.rule, {
    autoReply: false,
    bounce: false,
    reason: null,
  });
});

test("emailbison: the vendor's flag keeps isAuto, and rule still gives the fixed rules' verdict", async () => {
  const told = await bisonReply({
    automated_reply: false,
    subject: "Automatic reply: Partnership",
  });

  assert.deepEqual(
    [told?.isAuto, told?.isAutoSource, told?.rule],
    [
      false,
      "vendor",
      { autoReply: true, bounce: false, reason: "automatic_subject" },
    ]
  );
});

const CONVERSATIONS = fixture("heyreach", "getConversations.json") as {
  items: Raw[];
};

const withLeadSaying = (body: string) => ({
  ...CONVERSATIONS,
  hasNextPage: false,
  items: CONVERSATIONS.items.map((item) => ({
    ...item,
    messages: (item.messages as Raw[]).map((message) =>
      message.sender === "CORRESPONDENT" ? { ...message, body } : message
    ),
  })),
});

const heyreachReplies = (body: string) => {
  const { outbound, settle } = harness(heyreach, (request) =>
    new URL(request.url).pathname === "/api/public/inbox/GetConversationsV3"
      ? Response.json(withLeadSaying(body))
      : undefined
  );

  return settle(outbound.replies.listAll({ include: ["body"] }).toArray());
};

test("heyreach: the fixed rules flag a lead's out-of-office message and not a person's answer", async () => {
  const [away] = await heyreachReplies(
    "This is an automatic reply. I am out of the office until Monday."
  );

  assert.deepEqual(
    [away?.isAuto, away?.isAutoSource, away?.leftCompany, away?.rule?.reason],
    [true, "rule", false, "automatic_body"]
  );

  const [person] = await heyreachReplies("Happy to chat. Send me details.");

  assert.deepEqual(
    [person?.isAuto, person?.isAutoSource, person?.rule?.autoReply],
    [false, "rule", false]
  );
});
