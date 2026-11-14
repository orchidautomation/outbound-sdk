// The fields added for people and the inbox. HeyReach's documented examples
// show no auto-tag on a conversation, so those payloads are built here from
// the fixture with the three names the help center gives.

import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import { CAMPAIGN, LEAD, suite } from "./suite.ts";

interface Conversations {
  items: Record<string, unknown>[];
}

const conversations = (
  each: (index: number) => Record<string, unknown>
): Conversations => {
  const page = fixture("heyreach", "getConversations.json") as Conversations;

  return {
    ...page,
    hasNextPage: false,
    items: page.items.map((item, index) => ({
      ...item,
      ...each(index),
    })),
  } as Conversations;
};

const tagged = (name: string, creationTime: string) => ({
  campaignId: 274_079,
  creationTime,
  name,
});

test("heyreach: a reply takes the meaning of its lead's newest auto-tag and says it is the lead's", async () => {
  const profile = (
    fixture("heyreach", "getConversations.json") as Conversations
  ).items[0]?.correspondentProfile as Record<string, unknown>;

  const { outbound, settle } = harness(suite, () =>
    Response.json(
      conversations((index) => ({
        correspondentProfile: {
          ...profile,
          autoTags:
            index === 0
              ? [
                  tagged("Interested", "2026-01-01T00:00:00Z"),
                  tagged("Not Interested", "2026-02-01T00:00:00Z"),
                ]
              : [tagged("Some Future Tag", "2026-02-01T00:00:00Z")],
        },
        read: index === 0 ? false : null,
      }))
    )
  );

  const page = await settle(outbound.replies.list());
  const [first, second] = page.items;

  assert.equal(first?.category, "negative", "the newer tag wins");
  assert.equal(first?.categorySource, "lead");
  assert.equal(first?.unread, true, "the conversation is unread");
  assert.equal(
    second?.category,
    "unknown",
    "a name the help center does not list means nothing"
  );
  assert.equal(second?.categorySource, null);
  assert.equal(second?.unread, null, "no read flag is unknown, not read");
});

test("heyreach: Generic is neutral and an untagged lead's reply stays unknown", async () => {
  const profile = (
    fixture("heyreach", "getConversations.json") as Conversations
  ).items[0]?.correspondentProfile as Record<string, unknown>;

  const { outbound, settle } = harness(suite, () =>
    Response.json(
      conversations((index) => ({
        correspondentProfile: {
          ...profile,
          autoTags:
            index === 0 ? [tagged("generic", "2026-01-01T00:00:00Z")] : [],
        },
      }))
    )
  );

  const page = await settle(outbound.replies.list());
  assert.deepEqual(
    page.items.map((reply) => [
      reply.category,
      reply.categorySource,
      reply.unread,
    ]),
    [
      ["neutral", "lead", false],
      ["unknown", null, false],
    ],
    "names are matched without case, and read: true is not unread"
  );
});

test("heyreach: a lead carries its location and the company's LinkedIn page", async () => {
  const { outbound, settle } = harness(suite);
  const page = await settle(outbound.campaign(CAMPAIGN).leads.list());
  const [lead] = page.items;

  assert.equal(lead?.location, "Princetown");
  assert.equal(lead?.companyLinkedinUrl, null, "companyUrl is null here");
  assert.equal(lead?.website, null, "HeyReach reports no company website");
  assert.equal(lead?.phone, null);

  const one = await settle(outbound.leads.get(LEAD));
  assert.equal(
    one.companyLinkedinUrl,
    "https://www.linkedin.com/company/example-co",
    "companyUrl is the company's LinkedIn page"
  );
});

test("heyreach: a LinkedIn account has no mail provider and no tags", async () => {
  const { outbound, settle } = harness(suite);
  const page = await settle(outbound.senders.list());

  for (const sender of page.items) {
    assert.equal(sender.mailProvider, null);
    assert.deepEqual(sender.tags, []);
  }
});
