// The memory adapter is the reference adapter, so every filter it can be
// declared with must narrow what it returns: an adapter that declares a
// filter and ignores it hides bugs in the code above it. Each case declares
// one filter capability, reads through the filter, and checks that every
// record kept matches and that a record that does not match is left out.

import assert from "node:assert/strict";
import { test } from "node:test";

import { CAPABILITY_KEYS, createOutbound } from "../src/index.ts";
import type { CapabilityKey, Outbound } from "../src/index.ts";
import { memory } from "../src/memory/index.ts";
import type { MemoryData } from "../src/memory/index.ts";

const DATA: MemoryData = {
  campaigns: [
    { id: "c1", name: "Founders found", status: "active", tags: ["vip"] },
    { id: "c2", name: "Agencies", status: "paused", tags: ["cold"] },
  ],
  leads: [
    {
      campaignId: "c1",
      createdAt: "2026-11-01T00:00:00.000Z",
      email: "ana@alpha.example",
      id: "l1",
      interestCategory: "positive",
      linkedinUrl: "https://www.linkedin.com/in/example-ana",
      listIds: ["list1"],
      status: "active",
    },
    {
      campaignId: "c2",
      createdAt: "2026-10-01T00:00:00.000Z",
      email: "ben@beta.example",
      id: "l2",
      interestCategory: "negative",
      linkedinUrl: "https://www.linkedin.com/in/example-ben",
      status: "completed",
    },
  ],
  lists: [{ id: "list1", name: "Founders" }],
  messages: [
    {
      campaignId: "c1",
      direction: "out",
      id: "m1",
      leadId: "l1",
      sentAt: "2026-11-01T09:00:00.000Z",
      threadId: "t1",
    },
    {
      campaignId: "c1",
      category: "positive",
      direction: "in",
      id: "m2",
      leadId: "l1",
      sentAt: "2026-11-02T09:00:00.000Z",
      threadId: "t1",
      unread: true,
    },
    {
      byHand: true,
      campaignId: "c1",
      direction: "out",
      id: "m3",
      leadId: "l1",
      sentAt: "2026-11-03T09:00:00.000Z",
      threadId: "t1",
    },
    {
      campaignId: "c2",
      direction: "out",
      id: "m4",
      leadId: "l2",
      sentAt: "2026-10-01T09:00:00.000Z",
      threadId: "t2",
    },
    {
      campaignId: "c2",
      category: "negative",
      direction: "in",
      id: "m5",
      leadId: "l2",
      sentAt: "2026-10-02T09:00:00.000Z",
      threadId: "t2",
      unread: false,
    },
    {
      campaignId: "c2",
      direction: "out",
      id: "m6",
      leadId: "l2",
      sentAt: "2026-10-03T09:00:00.000Z",
      threadId: "t3",
    },
  ],
  senders: [
    { address: "one@example.com", campaignIds: ["c1"], id: "s1" },
    { address: "two@example.com", campaignIds: ["c2"], id: "s2" },
  ],
};

/** The id of a record, from its provider-qualified ref. */
const idOf = (record: { readonly ref: string }): string =>
  record.ref.split(":").at(-1) ?? "";

interface FilterCase {
  readonly key: CapabilityKey;
  /** The records the filter reads, by id. */
  readonly read: (outbound: Outbound) => Promise<readonly string[]>;
  /** Exactly the ids the filter must return. */
  readonly kept: readonly string[];
}

const ids = async <Item extends { readonly ref: string }>(
  page: Promise<{ readonly items: readonly Item[] }>
): Promise<string[]> => (await page).items.map(idOf).toSorted();

const CASES: readonly FilterCase[] = [
  {
    kept: ["c2"],
    key: "campaigns.status",
    read: (o) => ids(o.campaigns.list({ status: "paused" })),
  },
  {
    kept: ["c1"],
    key: "campaigns.byName",
    read: (o) => ids(o.campaigns.list({ name: "found" })),
  },
  {
    kept: ["c1"],
    key: "campaigns.byTag",
    read: (o) => ids(o.campaigns.list({ tag: "vip" })),
  },
  {
    kept: ["c2"],
    key: "campaigns.bySender",
    read: (o) => ids(o.campaigns.list({ senderId: "s2" })),
  },
  {
    kept: ["s1"],
    key: "senders.byCampaign",
    read: (o) => ids(o.senders.list({ campaignId: "c1" })),
  },
  {
    kept: ["l2"],
    key: "leads.byCampaign",
    read: (o) => ids(o.leads.list({ campaignId: "c2" })),
  },
  {
    kept: ["l1"],
    key: "lists.leads",
    read: (o) => ids(o.leads.list({ listId: "list1" })),
  },
  {
    kept: ["l2"],
    key: "leads.lookup",
    read: (o) => ids(o.leads.list({ email: "ben@beta.example" })),
  },
  {
    kept: ["l2"],
    key: "leads.byDomain",
    read: (o) => ids(o.leads.list({ domain: "beta.example" })),
  },
  {
    kept: ["l1"],
    key: "leads.lookupMany",
    read: (o) => ids(o.leads.list({ emails: ["ana@alpha.example"] })),
  },
  {
    kept: ["l1"],
    key: "leads.byInterest",
    read: (o) => ids(o.leads.list({ interest: "positive" })),
  },
  {
    kept: ["l1"],
    key: "leads.byStatus",
    read: (o) => ids(o.leads.list({ status: "active" })),
  },
  {
    kept: ["l1"],
    key: "leads.since",
    read: (o) => ids(o.leads.list({ since: "2026-10-15" })),
  },
  {
    kept: ["m4", "m5", "m6"],
    key: "messages.byCampaign",
    read: (o) => ids(o.messages.list({ campaignId: "c2" })),
  },
  {
    kept: ["m4", "m5"],
    key: "messages.byThread",
    read: (o) => ids(o.messages.list({ threadId: "t2" })),
  },
  {
    kept: ["m3"],
    key: "messages.byHand",
    read: (o) => ids(o.messages.list({ byHand: true })),
  },
  {
    kept: ["m3", "m5"],
    key: "messages.latestOfConversation",
    read: (o) => ids(o.messages.list({ latestOfConversation: true })),
  },
  {
    kept: ["m1", "m2", "m3"],
    key: "messages.since",
    read: (o) => ids(o.messages.list({ since: "2026-10-15" })),
  },
  {
    kept: ["m5"],
    key: "replies.byCampaign",
    read: (o) => ids(o.replies.list({ campaignId: "c2" })),
  },
  {
    kept: ["m2"],
    key: "replies.category",
    read: (o) => ids(o.replies.list({ category: "positive" })),
  },
  {
    kept: ["m2"],
    key: "replies.unread",
    read: (o) => ids(o.replies.list({ unread: true })),
  },
  {
    kept: ["m2"],
    key: "replies.since",
    read: (o) => ids(o.replies.list({ since: "2026-10-15" })),
  },
];

// Every grade a filter can be declared at that says it filters.
const GRADES: Partial<Record<CapabilityKey, readonly (string | boolean)[]>> = {
  "campaigns.byName": ["server", "client"],
  "campaigns.byTag": ["server", "client"],
  "campaigns.status": ["server", "client"],
  "leads.since": ["server", "client"],
  "messages.byCampaign": ["server", "client"],
  "messages.since": ["server", "client"],
  "replies.byCampaign": ["server", "client"],
  "replies.category": ["vendor"],
  "replies.since": ["server", "client"],
  "replies.unread": ["server", "client"],
};

const declared = (key: CapabilityKey, grade: string | boolean): Outbound =>
  createOutbound({
    adapter: memory({ capabilities: { [key]: grade }, data: DATA }),
  });

// A key that narrows what a listing returns, as its name says: by, a status,
// a time, unread, a lookup, a list's leads or a reply's category.
const FILTER_KEY =
  /^(?:campaigns|leads|lists|messages|replies|senders)\.(?:by[A-Z]\w*|status|since|unread|lookup\w*|leads|category|latestOfConversation)$/u;

test("every filter capability has a case here", () => {
  assert.deepEqual(
    CAPABILITY_KEYS.filter((key) => FILTER_KEY.test(key)).toSorted(),
    CASES.map((one) => one.key).toSorted()
  );
});

test("each filter the memory adapter is declared with narrows what it returns", async () => {
  for (const { key, kept, read } of CASES) {
    for (const grade of GRADES[key] ?? [true]) {
      // oxlint-disable-next-line no-await-in-loop -- one declaration at a time keeps a failure's key and grade readable.
      const found = await read(declared(key, grade));

      assert.deepEqual(found, kept, `${key} declared ${String(grade)}`);
    }
  }
});

test("a filter the memory adapter is not declared with is refused, not ignored", async () => {
  const refusable = CASES.filter(
    ({ key }) => key !== "messages.byCampaign" && key !== "replies.byCampaign"
  );

  for (const { key, read } of refusable) {
    // oxlint-disable-next-line no-await-in-loop -- one key at a time keeps a failure readable.
    await assert.rejects(
      read(declared(key, false)),
      { code: "Unsupported" },
      key
    );
  }
});
