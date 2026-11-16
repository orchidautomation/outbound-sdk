// Smartlead and EmailBison use the same fixed auto-reply rules as Instantly
// when the vendor does not flag a reply itself (OUT-92).

import assert from "node:assert/strict";
import { test } from "node:test";

import { suite as emailbison } from "./emailbison/suite.ts";
import { harness } from "./helpers/adapter-suite.ts";
import { fixture } from "./helpers/fixtures.ts";
import { json } from "./helpers/http.ts";
import { suite as smartlead } from "./smartlead/suite.ts";

type Raw = Record<string, unknown>;

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

test("emailbison: with automated_reply missing, a fixed rule flags a canned reply and not a person", async () => {
  const canned = await bisonReply({
    automated_reply: null,
    from_email_address: "no-reply@example.com",
  });

  assert.deepEqual(
    [canned?.isAuto, canned?.isAutoSource, canned?.leftCompany],
    [true, "rule", false]
  );

  const left = await bisonReply({
    automated_reply: null,
    html_body: null,
    subject: "Jordan Example is no longer at Example Co",
    text_body: "Please write to info@example.com instead.",
  });

  assert.deepEqual([left?.isAuto, left?.leftCompany], [true, true]);

  // The fixture's own reply, "Yes, let's talk on Tuesday.", is a person.
  const person = await bisonReply({ automated_reply: null });

  assert.deepEqual(
    [person?.isAuto, person?.isAutoSource, person?.leftCompany],
    [false, "rule", false]
  );
});

test("emailbison: automated_reply wins over the rule when it is given", async () => {
  const told = await bisonReply({
    automated_reply: false,
    from_email_address: "no-reply@example.com",
  });

  assert.deepEqual([told?.isAuto, told?.isAutoSource], [false, "vendor"]);
});

const smartleadReply = async (lastMessage: Raw) => {
  const { outbound, settle } = harness(smartlead, (request) =>
    request.method === "GET"
      ? json([])
      : json({
          messages: [
            {
              category: null,
              id: "thread_1",
              last_message: {
                received_at: "2025-01-20T14:30:00Z",
                ...lastMessage,
              },
            },
          ],
        })
  );

  const [reply] = (await settle(outbound.replies.list())).items;

  return reply;
};

test("smartlead: with no Out Of Office category, a fixed rule reads the subject and body", async () => {
  const away = await smartleadReply({
    body: "Thank you for your email. I am currently out of the office until Monday.",
    subject: "Automatic reply: Partnership",
  });

  assert.deepEqual([away?.isAuto, away?.isAutoSource], [true, "rule"]);

  const person = await smartleadReply({
    body: "I'm out of office next week, but yes, send the deck.",
    subject: "Re: Partnership",
  });

  assert.deepEqual([person?.isAuto, person?.isAutoSource], [false, "rule"]);
});
