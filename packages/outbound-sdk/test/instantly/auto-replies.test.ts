// Instantly flags no auto-reply on an email, so a fixed rule decides (OUT-92).
// `listEmails.autoReplies.json` is one campaign, anonymized from a live one:
// a company mailbox that answered every step within seconds, a helpdesk
// autoresponder, and a person who answered the next day.

import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import {
  autoReplyRoutes,
  EMAILS,
  HELPDESK,
  MAILBOX,
  PERSON,
} from "./auto-reply-fixture.ts";
import type { Raw } from "./auto-reply-fixture.ts";
import { suite } from "./suite.ts";

const ref = (address: string): string => `instantly:client-a:${address}`;

test("instantly: a machine mailbox and a helpdesk autoresponder are flagged automatic by rule; the person is not", async () => {
  const { outbound, settle, unrouted } = harness(suite, autoReplyRoutes());
  const page = await settle(outbound.replies.list());

  assert.deepEqual(unrouted, []);

  const seen = page.items
    .map((reply) =>
      [
        reply.leadEmail,
        reply.isAuto,
        reply.isAutoSource,
        reply.leftCompany,
      ].join(" ")
    )
    .toSorted();

  assert.deepEqual(seen, [
    // The company mailbox, 4 times: it says the contact changed.
    ...Array.from({ length: 4 }, () => `${MAILBOX} true rule true`),
    // The helpdesk, twice.
    `${HELPDESK} true rule false`,
    `${HELPDESK} true rule false`,
    // The person, twice, one of them mentioning being out of office.
    `${PERSON} false rule false`,
    `${PERSON} false rule false`,
  ]);
});

test("instantly: in a lead's timeline a reply takes its step from the send it answers, and a reply within a minute is automatic", async () => {
  // Without the canned body and the machine address, only the timing is left.
  const plain = EMAILS.map((item) =>
    item.lead === MAILBOX && item.ue_type === 2
      ? {
          ...item,
          body: { text: "Thanks, noted." },
          content_preview: "Thanks, noted.",
          from_address_email: MAILBOX,
        }
      : item
  );

  const { outbound, settle } = harness(suite, autoReplyRoutes(plain));
  const timeline = await settle(outbound.lead(ref(MAILBOX)).timeline());

  const received = timeline.items.filter((each) => each.direction === "in");

  // The last reply carried step 2 from Instantly but answers step 3.
  assert.deepEqual(
    received.map((each) => [each.stepIndex, each.isAuto, each.isAutoSource]),
    [
      [0, true, "rule"],
      [1, true, "rule"],
      [2, true, "rule"],
      [3, true, "rule"],
    ]
  );

  // A sent message carries no auto flag.
  assert.equal(
    timeline.items.find((each) => each.direction === "out")?.isAuto,
    undefined
  );

  // The person's reply a day later is not automatic.
  const person = await settle(outbound.lead(ref(PERSON)).timeline());

  assert.deepEqual(
    person.items
      .filter((each) => each.direction === "in")
      .map((each) => [each.stepIndex, each.isAuto]),
    [
      [0, false],
      [0, false],
    ]
  );
});

const TEMPLATE = EMAILS.find(
  (item) => item.lead === PERSON && item.ue_type === 2
);

const oneReply = async (changes: Raw) => {
  const { outbound, settle } = harness(
    suite,
    autoReplyRoutes([{ ...TEMPLATE, i_status: null, ...changes }])
  );

  const [reply] = (await settle(outbound.replies.list())).items;

  return reply;
};

test("instantly: the rules flag canned replies and leave people's replies alone", async () => {
  const accepted: [string, Raw, boolean][] = [
    ["a noreply sender", { from_address_email: "noreply@example.com" }, false],
    [
      "a mailer-daemon",
      { from_address_email: "MAILER-DAEMON@example.com" },
      false,
    ],
    [
      "an Automatic reply subject",
      { subject: "Automatic reply: Re: Hello" },
      false,
    ],
    ["an OOO subject", { subject: "OOO Re: Breaking through" }, false],
    ["an Out of Office subject", { subject: "Out of Office Re: Hello" }, false],
    [
      "a no-longer-at subject",
      { subject: "Jordan Example is no longer at Example Co Re: Hello" },
      true,
    ],
    [
      "a canned out-of-office body",
      {
        body: {
          text: "Thank you for your email. I am currently out of the office until Monday with limited access to email.",
        },
      },
      false,
    ],
    [
      "a parental leave body",
      {
        body: { text: "I am on maternity leave and will reply when I return." },
      },
      false,
    ],
    [
      "an automated-message body",
      { body: { text: "This is an automated response. Do not reply." } },
      false,
    ],
    [
      "a contact-has-changed notice",
      {
        body: {
          html: "<p>Your contact with Example Co has changed.</p><p>Please write to info@example.com.</p>",
        },
      },
      true,
    ],
  ];

  for (const [what, changes, left] of accepted) {
    const reply = await oneReply(changes);

    assert.equal(reply?.isAuto, true, what);
    assert.equal(reply?.isAutoSource, "rule", what);
    assert.equal(reply?.leftCompany, left, what);
  }
});

test("instantly: a person's reply that mentions being away, leaving or support is not flagged automatic", async () => {
  const rejected: [string, Raw, boolean][] = [
    ["a plain yes", { body: { text: "Yes, let's talk Tuesday." } }, false],
    [
      "out of office mentioned in passing",
      {
        body: {
          text: "I'm out of office next week, but send me the deck and I'll read it.",
        },
      },
      false,
    ],
    [
      "the person left and answers anyway",
      {
        body: {
          text: "I'm no longer at Example Co, but my new team could use this.",
        },
      },
      false,
    ],
    [
      "a colleague answering for someone who left",
      {
        body: {
          text: "Jordan is no longer with the company. I run partnerships now; happy to talk.",
        },
      },
      true,
    ],
    [
      "our own canned words in the quoted history",
      {
        body: {
          text: "Sounds good.\n\nOn Mon, Nov 2, 2026 at 3:16 PM someone wrote:\n> This is an automated message about our out of the office until Monday sale",
        },
      },
      false,
    ],
    ["a Re: subject", { subject: "Re: Out of curiosity" }, false],
    [
      "a sender with reply in the name",
      { from_address_email: "replyguy@example.com" },
      false,
    ],
  ];

  for (const [what, changes, left] of rejected) {
    const reply = await oneReply(changes);

    assert.equal(reply?.isAuto, false, what);
    assert.equal(reply?.leftCompany, left, what);
  }
});

test("instantly: the vendor's own flag or an Out of Office status wins over the rule", async () => {
  const told = await oneReply({
    from_address_email: "noreply@example.com",
    is_auto_reply: 0,
  });

  assert.deepEqual([told?.isAuto, told?.isAutoSource], [false, "vendor"]);

  const flagged = await oneReply({ is_auto_reply: 1 });

  assert.deepEqual([flagged?.isAuto, flagged?.isAutoSource], [true, "vendor"]);

  const away = await oneReply({ i_status: 0 });

  assert.deepEqual(
    [away?.category, away?.isAuto, away?.isAutoSource],
    ["ooo", true, "vendor"]
  );
});
